// Contacts — module communautaire de Curiosa : un carnet d'adresses privé, et le fournisseur du service « contact.store ».
//
// Le formulaire de contact du site (ou tout autre module qui `requires` ce service) y range ce qu'il reçoit : un contact « à vérifier » dont la
// note est le message. Un assistant (MCP) peut ensuite se renseigner sur la personne, compléter la fiche et la passer « active », ou la supprimer
// si c'est du spam. Aucune page publique.
const STATUSES = ["to_review", "active"];
const SOURCES = ["manual", "contact-form", "agent"];
const FIELDS = { name: 120, role: 120, organisation: 200, email: 200, phone: 60, others: 1000, relation: 300 };
const fail = (m) => Object.assign(new Error(m), { expose: true });
const clean = (v, max, multiline = false) => {
  let t = String(v ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "");
  t = multiline ? t.replace(/\n{3,}/g, "\n\n") : t.replace(/\s+/g, " ");
  return t.trim().slice(0, max);
};
const validEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const MAX_CONTACTS = 5000;

const contacts = async (ctx) => ctx.api.store.list("contacts", { limit: 1000 });
const notesOf = async (ctx, id) => (await ctx.api.store.list("notes", { limit: 1000 })).filter((n) => n.data.contactId === id);

function cleanContact(input, previous = {}) {
  const out = { ...previous };
  for (const [key, max] of Object.entries(FIELDS)) {
    if (input[key] === undefined) continue;
    const value = clean(input[key], max, key === "others");
    out[key] = key === "email" ? (validEmail(value) ? value.toLowerCase() : "") : value;
  }
  if (input.status !== undefined && STATUSES.includes(input.status)) out.status = input.status;
  return out;
}

async function addNote(ctx, contactId, text, author) {
  const t = clean(text, 5000, true);
  if (t) await ctx.api.store.add("notes", { contactId, date: new Date().toISOString().slice(0, 10), author, text: t });
}

const summary = (r) => ({ id: r.id, name: r.data.name, role: r.data.role || null, organisation: r.data.organisation || null, email: r.data.email || null, phone: r.data.phone || null, status: r.data.status, source: r.data.source, createdAt: r.createdAt.toISOString() });

export default {
  // SERVICE offert aux autres modules. Idempotent par e-mail : un deuxième message de la même adresse ajoute une note, pas un doublon.
  services: {
    "contact.store": {
      async add(ctx, args) {
        const a = args && typeof args === "object" ? args : {};
        const name = clean(a.name, FIELDS.name), email = clean(a.email, FIELDS.email).toLowerCase();
        if (!name) throw fail("name required");
        const source = SOURCES.includes(a.source) ? a.source : "manual";
        const known = email && validEmail(email) ? (await contacts(ctx)).find((c) => c.data.email === email) : null;
        let id = known?.id, created = false;
        if (!known) {
          if ((await ctx.api.store.count("contacts")) >= MAX_CONTACTS) throw fail("too many contacts");
          id = await ctx.api.store.add("contacts", { ...cleanContact({ name, email, organisation: a.organisation, phone: a.phone }), status: "to_review", source });
          created = true;
        }
        if (a.message) await addNote(ctx, id, `${ctx.t("formNote")}\n\n${clean(a.message, 5000, true)}`, source);
        return { id, created };
      },
    },
  },

  // Pastille du menu d'admin : les messages reçus et pas encore vérifiés.
  async adminBadge(ctx) {
    return (await contacts(ctx)).filter((c) => c.data.status === "to_review").length;
  },

  async adminPanel(ctx, { query }) {
    const t = ctx.t;
    const list = await contacts(ctx);
    const form = (c) => ({
      type: "adminForm", action: "save", title: c ? `${t("edit")} — ${c.data.name}` : t("add"), submitLabel: t("save"), cancelHref: c ? `?contact=${c.id}` : undefined,
      fields: [
        { name: "id", kind: "hidden", value: c?.id ?? "" },
        { name: "name", label: t("name"), required: true, value: c?.data.name ?? "" },
        { name: "role", label: t("role"), value: c?.data.role ?? "" },
        { name: "organisation", label: t("organisation"), value: c?.data.organisation ?? "" },
        { name: "email", label: t("email"), kind: "email", value: c?.data.email ?? "" },
        { name: "phone", label: t("phone"), value: c?.data.phone ?? "" },
        { name: "others", label: t("others"), kind: "textarea", value: c?.data.others ?? "" },
        { name: "relation", label: t("relation"), value: c?.data.relation ?? "" },
        { name: "status", label: t("status"), kind: "select", options: STATUSES.map((s) => ({ value: s, label: t(`status_${s}`) })), value: c?.data.status ?? "active" },
      ],
    });
    const editing = query.edit && list.find((c) => c.id === query.edit);
    if (editing) return [form(editing)];

    const open = query.contact && list.find((c) => c.id === query.contact);
    if (open) {
      const d = open.data;
      const notes = (await notesOf(ctx, open.id)).sort((a, b) => String(b.data.date).localeCompare(String(a.data.date)));
      const lines = [`**${t("status")}** : ${t(`status_${d.status}`)} · ${t(`source_${d.source}`)}`, d.role && `**${t("role")}** : ${d.role}`, d.organisation && `**${t("organisation")}** : ${d.organisation}`, d.email && `**${t("email")}** : ${d.email}`, d.phone && `**${t("phone")}** : ${d.phone}`, d.others && `**${t("others")}** :\n\n${d.others}`, d.relation && `**${t("relation")}** : ${d.relation}`].filter(Boolean);
      return [
        { type: "markdown", text: `[${t("back")}](?)` },
        { type: "heading", text: d.name },
        { type: "markdown", text: lines.join("\n\n") },
        { type: "table", columns: [t("name")], rows: [[d.name]], rowIds: [open.id], rowActions: [{ label: t("actEdit"), href: "?edit={id}" }, ...(d.status === "to_review" ? [{ label: t("actActivate"), action: "activate" }] : []), { label: t("actDelete"), action: "remove", confirm: t("confirmDelete"), danger: true }] },
        { type: "heading", text: t("notes") },
        { type: "table", columns: ["", ""], rows: notes.map((n) => [`${n.data.date} · ${n.data.author}`, n.data.text]), rowIds: notes.map((n) => n.id), rowActions: [{ label: t("noteDelete"), action: "removeNote", confirm: t("confirmDelete"), danger: true }] },
        { type: "adminForm", action: "note", title: t("noteAdd"), submitLabel: t("noteAdd"), fields: [{ name: "contactId", kind: "hidden", value: open.id }, { name: "text", label: t("noteText"), kind: "textarea", required: true }] },
      ];
    }

    const sorted = [...list].sort((a, b) => (a.data.status === "to_review" ? 0 : 1) - (b.data.status === "to_review" ? 0 : 1) || b.createdAt - a.createdAt);
    return [
      { type: "markdown", text: `*${t("private")}*` },
      { type: "heading", text: t("title", { count: list.length, review: list.filter((c) => c.data.status === "to_review").length }) },
      sorted.length
        ? { type: "table", columns: [t("colDate"), t("colName"), t("colOrg"), t("colEmail"), t("colStatus"), t("colSource")], rows: sorted.map((c) => [c.createdAt.toISOString().slice(0, 10), c.data.name, c.data.organisation ?? "", c.data.email ?? "", t(`status_${c.data.status}`), t(`source_${c.data.source}`)]), rowIds: sorted.map((c) => c.id), rowActions: [{ label: t("actOpen"), href: "?contact={id}" }, { label: t("actEdit"), href: "?edit={id}" }] }
        : { type: "markdown", text: t("none") },
      form(null),
    ];
  },

  adminActions: {
    async save(ctx, v) {
      if (!clean(v.name, 120)) return { error: ctx.t("nameRequired") };
      if (v.id) {
        const row = await ctx.api.store.get(v.id);
        if (!row) return { error: ctx.t("notFound") };
        await ctx.api.store.update(v.id, cleanContact(v, row.data));
        return { ok: ctx.t("saved"), redirect: `?contact=${v.id}` };
      }
      const id = await ctx.api.store.add("contacts", { ...cleanContact(v), status: STATUSES.includes(v.status) ? v.status : "active", source: "manual" });
      return { ok: ctx.t("saved"), redirect: `?contact=${id}` };
    },
    async activate(ctx, v) {
      const row = v.id ? await ctx.api.store.get(v.id) : null;
      if (!row) return { error: ctx.t("notFound") };
      await ctx.api.store.update(row.id, { ...row.data, status: "active" });
      return { ok: ctx.t("saved") };
    },
    async note(ctx, v) {
      if (!(await ctx.api.store.get(v.contactId))) return { error: ctx.t("notFound") };
      await addNote(ctx, v.contactId, v.text, "admin");
      return { ok: ctx.t("saved") };
    },
    async removeNote(ctx, v) { await ctx.api.store.remove(v.id); return { ok: ctx.t("deleted") }; },
    async remove(ctx, v) {
      if (!v.id || !(await ctx.api.store.get(v.id))) return { error: ctx.t("notFound") };
      for (const n of await notesOf(ctx, v.id)) await ctx.api.store.remove(n.id);
      await ctx.api.store.remove(v.id);
      return { ok: ctx.t("deleted"), redirect: "?" };
    },
  },

  mcp: {
    async contacts_list(ctx, args) {
      const q = clean(args?.search, 100).toLowerCase();
      return (await contacts(ctx))
        .filter((c) => (!args?.status || c.data.status === args.status) && (!q || [c.data.name, c.data.organisation, c.data.email].some((x) => String(x ?? "").toLowerCase().includes(q))))
        .slice(0, Math.min(100, Math.max(1, Math.trunc(Number(args?.limit)) || 30))).map(summary);
    },
    async contact_get(ctx, args) {
      const row = typeof args?.id === "string" ? await ctx.api.store.get(args.id) : null;
      if (!row || row.data.name === undefined) throw fail("contact not found");
      return { ...summary(row), others: row.data.others || null, relation: row.data.relation || null, notes: (await notesOf(ctx, row.id)).map((n) => ({ id: n.id, date: n.data.date, author: n.data.author, text: n.data.text })) };
    },
    async contact_create(ctx, args) {
      if (!clean(args?.name, 120)) throw fail("name required");
      const id = await ctx.api.store.add("contacts", { ...cleanContact(args), status: "active", source: "agent" });
      return { id };
    },
    async contact_update(ctx, args, actor) {
      const row = typeof args?.id === "string" ? await ctx.api.store.get(args.id) : null;
      if (!row) throw fail("contact not found");
      await ctx.api.store.update(row.id, { ...cleanContact(args, row.data), updatedBy: actor?.name });
      return { id: row.id };
    },
    async contact_note(ctx, args, actor) {
      const row = typeof args?.id === "string" ? await ctx.api.store.get(args.id) : null;
      if (!row || !clean(args?.text, 5000)) throw fail("contact not found or empty note");
      await addNote(ctx, row.id, args.text, actor?.name || "agent");
      return { id: row.id };
    },
    async contact_delete(ctx, args) {
      const row = typeof args?.id === "string" ? await ctx.api.store.get(args.id) : null;
      if (!row) throw fail("contact not found");
      for (const n of await notesOf(ctx, row.id)) await ctx.api.store.remove(n.id);
      await ctx.api.store.remove(row.id);
      return { id: row.id, deleted: true };
    },
  },

  backup: {
    async readable(ctx) {
      const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
      const list = await contacts(ctx), notes = await ctx.api.store.list("notes", { limit: 1000 });
      const rows = list.map((c) => [c.id, c.createdAt.toISOString(), c.data.status, c.data.source, c.data.name, c.data.role, c.data.organisation, c.data.email, c.data.phone, c.data.others, c.data.relation, notes.filter((n) => n.data.contactId === c.id).map((n) => `${n.data.date} ${n.data.text}`).join("\n---\n")].map(cell).join(","));
      return [{ path: "contacts.csv", content: `\uFEFF${[["id", "added", "status", "source", "name", "role", "organisation", "email", "phone", "others", "relation", "notes"].map(cell).join(","), ...rows].join("\r\n")}\r\n` }];
    },
  },
};
