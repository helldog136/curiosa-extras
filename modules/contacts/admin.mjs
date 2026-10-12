// Contacts — l'interface d'administration (pastille, panneau, actions).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { STATUSES, SOURCES, FIELDS, MAX_CONTACTS, ID_MAX, fail, clean, validEmail, contacts, notesOf, cleanContact, addNote, key, sameEmail, sameNameOrg, isCard, idOf, card, summary } = await import(`./book.mjs${v}`);

export default {
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
};
