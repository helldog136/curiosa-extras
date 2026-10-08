// Partenariats — module communautaire de Curiosa (suivi interne, aucune page publique).
//
// Les fiches vivent dans le stockage privé de l'instance (ctx.api.store) : collections
// « partners », « journal » et « contacts ». Le module ne montre RIEN sur le site : il expose
//   • un panneau d'admin complet (adminPanel + adminActions),
//   • le sujet « partnership.partner » pour que d'autres modules (sponsors…) s'y réfèrent,
//   • des actions MCP pour les assistants (jamais de suppression).
const STATUSES = ["a_contacter", "envoye", "discussion", "accepte", "publie", "refuse_marque", "decline", "sans_reponse", "termine"];
const CLOSED = new Set(["refuse_marque", "decline", "sans_reponse", "termine"]);
const DAY = 86_400_000;

// Erreur lisible par l'agent MCP (les autres erreurs sont masquées : jamais de détail interne).
const fail = (message) => Object.assign(new Error(message), { expose: true });
const clip = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const today = () => new Date().toISOString().slice(0, 10);
const validDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? v : today());
const safeUrl = (v) => (/^https?:\/\//i.test(String(v ?? "").trim()) ? String(v).trim().slice(0, 500) : "");

const PARTNER_FIELDS = { brand: 120, status: 30, url: 500, sector: 120, country: 80, contact: 500, brief: 10000, mail: 10000, source: 500, products: 3000, benefits: 3000, logo: 500 };

/** Garde seulement les champs connus, nettoyés (jamais de HTML ni de champ inattendu dans la fiche). */
function cleanPartner(input, previous = {}) {
  const out = { ...previous };
  for (const [key, max] of Object.entries(PARTNER_FIELDS)) {
    if (input[key] === undefined) continue;
    out[key] = key === "url" || key === "logo" ? safeUrlOrUpload(input[key]) : clip(String(input[key]), max);
  }
  if (input.status !== undefined && !STATUSES.includes(out.status)) out.status = previous.status ?? "a_contacter";
  if (input.chances !== undefined) {
    const n = Number(input.chances);
    out.chances = input.chances === "" || !Number.isFinite(n) ? null : Math.min(100, Math.max(0, Math.round(n)));
  }
  return out;
}
const safeUrlOrUpload = (v) => (String(v ?? "").startsWith("/uploads/") ? String(v).slice(0, 200) : safeUrl(v));

/** CSV minimal (RFC 4180) : séparateur « , » ou « ; » détecté sur l'en-tête, guillemets doublés, retours à la ligne entre guillemets. */
export function parseCsv(text) {
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (first.match(/;/g) ?? []).length > (first.match(/,/g) ?? []).length ? ";" : ",";
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
    else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const IMPORT_MAX_ROWS = 500;
/** Import en masse : un partenaire par ligne (colonne `brand` obligatoire). Relançable : une marque déjà connue n'est que COMPLÉTÉE (champs vides), jamais écrasée. */
export async function importPartners(ctx, text) {
  const table = parseCsv(String(text ?? "").slice(0, 1_000_000));
  if (table.length < 2) return { created: 0, completed: 0, skipped: 0, error: "empty" };
  const header = table[0].map((h) => h.trim().toLowerCase());
  if (!header.includes("brand")) return { created: 0, completed: 0, skipped: 0, error: "noBrand" };
  const known = new Map((await ctx.api.store.list("partners", { limit: 1000 })).map((r) => [String(r.data.brand).trim().toLowerCase(), r]));
  let created = 0, completed = 0, skipped = 0;
  for (const cells of table.slice(1, IMPORT_MAX_ROWS + 1)) {
    const input = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]).filter(([h]) => h === "brand" || h in PARTNER_FIELDS || h === "chances"));
    const brand = clip(input.brand ?? "", 120);
    if (!brand) { skipped++; continue; }
    const existing = known.get(brand.toLowerCase());
    if (!existing) {
      const data = cleanPartner({ ...input, brand, status: input.status || "a_contacter" });
      const id = await ctx.api.store.add("partners", { ...data, updatedBy: "import" });
      known.set(brand.toLowerCase(), { id, data });
      created++;
    } else {
      const fill = Object.fromEntries(Object.entries(input).filter(([k, v]) => k !== "brand" && String(v).trim() !== "" && (existing.data[k] === undefined || existing.data[k] === "" || existing.data[k] === null)));
      const next = cleanPartner(fill, existing.data);
      if (JSON.stringify(next) !== JSON.stringify(existing.data)) { await ctx.api.store.update(existing.id, { ...next, updatedBy: "import" }); completed++; } else skipped++;
    }
  }
  return { created, completed, skipped: skipped + Math.max(0, table.length - 1 - IMPORT_MAX_ROWS) };
}

async function all(ctx, collection) {
  return ctx.api.store.list(collection, { limit: 1000 });
}

function lastActivity(partner, journal) {
  const dates = journal.filter((j) => j.data.partnerId === partner.id).map((j) => Date.parse(j.data.date)).filter(Number.isFinite);
  return dates.length ? Math.max(...dates) : partner.createdAt.getTime();
}
function followUpDue(ctx, partner, journal) {
  const days = Number(ctx.setting("followUpDays")) || 14;
  return partner.data.status === "envoye" && Date.now() - lastActivity(partner, journal) > days * DAY;
}
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);

export default {
  exports: {
    "partnership.partner": async (ctx) =>
      (await all(ctx, "partners")).map((p) => ({ id: p.id, title: p.data.brand, status: p.data.status, url: safeUrl(p.data.url) || undefined, logo: p.data.logo || undefined })),
  },

  // ── Panneau d'admin ───────────────────────────────────────────────────────────
  async adminPanel(ctx, { query }) {
    const t = ctx.t;
    const [partners, journal, contacts] = await Promise.all([all(ctx, "partners"), all(ctx, "journal"), all(ctx, "contacts")]);
    const statusOptions = STATUSES.map((s) => ({ value: s, label: t(`s_${s}`) }));
    const blocks = [{ type: "markdown", text: `*${t("private")}*` }];

    const partnerForm = (p) => ({
      type: "adminForm",
      action: "savePartner",
      title: p ? `${t("edit")} — ${p.data.brand}` : t("add"),
      submitLabel: t("save"),
      cancelHref: p ? `?partner=${p.id}` : undefined,
      fields: [
        { name: "id", kind: "hidden", value: p?.id ?? "" },
        { name: "brand", label: t("brand"), required: true, value: p?.data.brand ?? "" },
        { name: "status", label: t("status"), kind: "select", options: statusOptions, value: p?.data.status ?? "a_contacter" },
        { name: "chances", label: t("chances"), kind: "number", value: String(p?.data.chances ?? "") },
        { name: "url", label: t("url"), kind: "url", value: p?.data.url ?? "" },
        { name: "sector", label: t("sector"), value: p?.data.sector ?? "" },
        { name: "country", label: t("country"), value: p?.data.country ?? "" },
        { name: "contact", label: t("contact"), value: p?.data.contact ?? "" },
        { name: "logo", label: t("logo"), kind: "image", value: p?.data.logo ?? "" },
        { name: "products", label: t("products"), kind: "textarea", value: p?.data.products ?? "" },
        { name: "benefits", label: t("benefits"), kind: "textarea", value: p?.data.benefits ?? "" },
        { name: "brief", label: t("brief"), kind: "textarea", value: p?.data.brief ?? "" },
        { name: "mail", label: t("mail"), kind: "textarea", value: p?.data.mail ?? "" },
        { name: "source", label: t("source"), value: p?.data.source ?? "" },
      ],
    });

    // Modification d'une fiche
    const editing = query.edit && partners.find((p) => p.id === query.edit);
    if (editing) return [...blocks, partnerForm(editing)];

    // Fiche détaillée : journal + contacts
    const open = query.partner && partners.find((p) => p.id === query.partner);
    if (open) {
      const d = open.data;
      const mine = journal.filter((j) => j.data.partnerId === open.id).sort((a, b) => String(b.data.date).localeCompare(String(a.data.date)));
      const people = contacts.filter((c) => c.data.partnerId === open.id);
      const lines = [d.status && `**${t("status")}** : ${t(`s_${d.status}`)}${followUpDue(ctx, open, journal) ? ` ⏰ ${t("followUp")}` : ""}`, d.chances != null && `**${t("chances")}** : ${d.chances}`, d.url && `**${t("url")}** : ${d.url}`, d.sector && `**${t("sector")}** : ${d.sector}`, d.country && `**${t("country")}** : ${d.country}`, d.contact && `**${t("contact")}** : ${d.contact}`, d.products && `**${t("products")}** : ${d.products}`, d.benefits && `**${t("benefits")}** : ${d.benefits}`, d.brief && `**${t("brief")}** :\n\n${d.brief}`].filter(Boolean);
      return [
        ...blocks,
        { type: "markdown", text: `[${t("back")}](?)` },
        { type: "heading", text: d.brand },
        { type: "markdown", text: lines.join("\n\n") },
        { type: "table", columns: [t("edit")], rows: [[d.brand]], rowIds: [open.id], rowActions: [{ label: t("edit"), href: "?edit={id}" }, { label: t("delete"), action: "deletePartner", confirm: t("confirm"), danger: true }] },
        { type: "heading", text: t("journal") },
        { type: "table", columns: [t("date"), t("author"), t("text")], rows: mine.map((j) => [j.data.date, j.data.author, j.data.text + (j.data.link ? `\n${j.data.link}` : "")]), rowIds: mine.map((j) => j.id), rowActions: [{ label: t("delete"), action: "deleteJournal", confirm: t("confirm"), danger: true }] },
        { type: "adminForm", action: "addJournal", title: t("journalAdd"), submitLabel: t("journalAdd"), fields: [{ name: "partnerId", kind: "hidden", value: open.id }, { name: "date", label: t("date"), kind: "date", value: today() }, { name: "text", label: t("text"), kind: "textarea", required: true }, { name: "link", label: t("link"), kind: "url" }] },
        { type: "heading", text: t("contacts") },
        { type: "table", columns: [t("name"), t("role"), t("email"), t("phone")], rows: people.map((c) => [c.data.name + (c.data.status === "to_review" ? ` (${t("toReview")})` : ""), c.data.role ?? "", c.data.email ?? "", c.data.phone ?? ""]), rowIds: people.map((c) => c.id), rowActions: [{ label: t("delete"), action: "deleteContact", confirm: t("confirm"), danger: true }] },
        { type: "adminForm", action: "saveContact", title: t("contactAdd"), submitLabel: t("contactAdd"), fields: [{ name: "partnerId", kind: "hidden", value: open.id }, { name: "name", label: t("name"), required: true }, { name: "role", label: t("role") }, { name: "email", label: t("email"), kind: "email" }, { name: "phone", label: t("phone") }, { name: "relation", label: t("relation") }] },
      ];
    }

    // Vue d'ensemble : triée par urgence (discussion > accepté > envoyé > à contacter > publié > clos)
    const rank = (s) => ({ discussion: 0, accepte: 1, envoye: 2, a_contacter: 3, publie: 4 })[s] ?? 5;
    const sorted = [...partners].sort((a, b) => rank(a.data.status) - rank(b.data.status) || String(a.data.brand).localeCompare(String(b.data.brand)));
    blocks.push(
      { type: "heading", text: `${t("overview")} (${partners.filter((p) => !CLOSED.has(p.data.status)).length})` },
      sorted.length
        ? { type: "table", columns: [t("brand"), t("status"), t("chances"), t("lastActivity")], rows: sorted.map((p) => [p.data.brand, `${t(`s_${p.data.status}`)}${followUpDue(ctx, p, journal) ? " ⏰" : ""}`, p.data.chances != null ? `${p.data.chances} %` : "", fmt(lastActivity(p, journal))]), rowIds: sorted.map((p) => p.id), rowActions: [{ label: t("open"), href: "?partner={id}" }, { label: t("edit"), href: "?edit={id}" }] }
        : { type: "markdown", text: t("none") },
      partnerForm(null),
      { type: "adminForm", action: "importPartners", title: t("importTitle"), submitLabel: t("importSubmit"), fields: [{ name: "csv", label: t("importCsv"), kind: "textarea", required: true }] },
      { type: "markdown", text: t("importHelp") },
    );
    return blocks;
  },

  adminActions: {
    async savePartner(ctx, v) {
      if (!clip(v.brand, 120)) return { error: ctx.t("brandRequired") };
      if (v.id) {
        const row = await ctx.api.store.get(v.id);
        if (!row) return { error: ctx.t("notFound") };
        await ctx.api.store.update(v.id, { ...cleanPartner(v, row.data), updatedBy: "admin" });
        return { ok: ctx.t("saved"), redirect: `?partner=${v.id}` };
      }
      const id = await ctx.api.store.add("partners", { ...cleanPartner({ ...v, status: v.status || "a_contacter" }), updatedBy: "admin" });
      return { ok: ctx.t("saved"), redirect: `?partner=${id}` };
    },
    async importPartners(ctx, v) {
      const r = await importPartners(ctx, v.csv);
      if (r.error) return { error: ctx.t(r.error === "noBrand" ? "importNoBrand" : "importEmpty") };
      return { ok: ctx.t("importDone", { created: r.created, completed: r.completed, skipped: r.skipped }) };
    },
    async deletePartner(ctx, v) {
      for (const collection of ["journal", "contacts"]) for (const r of await all(ctx, collection)) if (r.data.partnerId === v.id) await ctx.api.store.remove(r.id);
      await ctx.api.store.remove(v.id);
      return { ok: ctx.t("deleted"), redirect: "?" };
    },
    async addJournal(ctx, v) {
      if (!(await ctx.api.store.get(v.partnerId)) || !clip(v.text, 5000)) return { error: ctx.t("notFound") };
      await ctx.api.store.add("journal", { partnerId: v.partnerId, date: validDate(v.date), author: "admin", text: clip(v.text, 5000), link: safeUrl(v.link) });
      return { ok: ctx.t("saved") };
    },
    async deleteJournal(ctx, v) {
      await ctx.api.store.remove(v.id);
      return { ok: ctx.t("deleted") };
    },
    async saveContact(ctx, v) {
      if (!clip(v.name, 120)) return { error: ctx.t("brandRequired") };
      await ctx.api.store.add("contacts", { partnerId: v.partnerId || "", name: clip(v.name, 120), role: clip(v.role, 120), email: clip(v.email, 200), phone: clip(v.phone, 60), relation: clip(v.relation, 300), status: "active" });
      return { ok: ctx.t("saved") };
    },
    async deleteContact(ctx, v) {
      await ctx.api.store.remove(v.id);
      return { ok: ctx.t("deleted") };
    },
  },

  // ── Actions MCP (déclarées dans module.json) ────────────────────────────────────
  // `partner_delete` et `contact_delete` sont IMPLÉMENTÉES mais déclarées `default: false` : un jeton ne
  // les a que si un administrateur les lui accorde, une à une, dans l'admin (API & MCP → Accès du jeton).
  mcp: {
    async partners_list(ctx, a) {
      const [partners, journal] = await Promise.all([all(ctx, "partners"), all(ctx, "journal")]);
      const q = String(a.q ?? "").toLowerCase();
      return partners
        .filter((p) => (!a.status || p.data.status === a.status) && (!q || JSON.stringify(p.data).toLowerCase().includes(q)))
        .map((p) => ({ id: p.id, brand: p.data.brand, status: p.data.status, chances: p.data.chances ?? null, lastActivity: fmt(lastActivity(p, journal)), followUpDue: followUpDue(ctx, p, journal) }));
    },
    async partner_get(ctx, a) {
      const p = await ctx.api.store.get(a.id);
      if (!p) throw fail("partnership not found");
      const [journal, contacts] = await Promise.all([all(ctx, "journal"), all(ctx, "contacts")]);
      return { id: p.id, ...p.data, journal: journal.filter((j) => j.data.partnerId === p.id).map((j) => ({ id: j.id, ...j.data })), contacts: contacts.filter((c) => c.data.partnerId === p.id).map((c) => ({ id: c.id, ...c.data })) };
    },
    async partner_create(ctx, a, actor) {
      if (!String(a.brand ?? "").trim()) throw fail("brand is required");
      const id = await ctx.api.store.add("partners", { ...cleanPartner({ ...a, status: a.status ?? "a_contacter" }), updatedBy: `agent:${actor.name}` });
      return { id };
    },
    async partner_update(ctx, a, actor) {
      const { id, ...fields } = a;
      const row = await ctx.api.store.get(id);
      if (!row) throw fail("partnership not found");
      if (fields.brand !== undefined && !String(fields.brand).trim()) throw fail("brand cannot be empty");
      await ctx.api.store.update(id, { ...cleanPartner(fields, row.data), updatedBy: `agent:${actor.name}` });
      return { id, updated: Object.keys(fields) };
    },
    async partner_log(ctx, a, actor) {
      if (!(await ctx.api.store.get(a.id))) throw fail("partnership not found");
      if (!String(a.text ?? "").trim()) throw fail("text is required");
      const entry = await ctx.api.store.add("journal", { partnerId: a.id, date: validDate(a.date), author: `agent:${actor.name}`, text: clip(a.text, 5000), link: safeUrl(a.link) });
      return { id: entry };
    },
    async contacts_list(ctx, a) {
      return (await all(ctx, "contacts")).filter((c) => !a.partner_id || c.data.partnerId === a.partner_id).map((c) => ({ id: c.id, ...c.data }));
    },
    async contact_create(ctx, a, actor) {
      const { partner_id, ...rest } = a;
      if (!String(rest.name ?? "").trim()) throw fail("name is required");
      const id = await ctx.api.store.add("contacts", { partnerId: partner_id ?? "", name: clip(rest.name, 120), role: clip(rest.role, 120), organization: clip(rest.organization, 120), email: clip(rest.email, 200), phone: clip(rest.phone, 60), relation: clip(rest.relation, 300), notes: clip(rest.notes, 5000), status: "to_review", updatedBy: `agent:${actor.name}` });
      return { id, status: "to_review" };
    },
    async partner_delete(ctx, a) {
      if (!(await ctx.api.store.get(a.id))) throw fail("partnership not found");
      for (const collection of ["journal", "contacts"]) for (const r of await all(ctx, collection)) if (r.data.partnerId === a.id) await ctx.api.store.remove(r.id);
      await ctx.api.store.remove(a.id);
      return { deleted: a.id };
    },
    async contact_delete(ctx, a) {
      if (!(await ctx.api.store.get(a.id))) throw fail("contact not found");
      await ctx.api.store.remove(a.id);
      return { deleted: a.id };
    },
    async contact_update(ctx, a, actor) {
      const { id, partner_id, ...rest } = a;
      const row = await ctx.api.store.get(id);
      if (!row) throw fail("contact not found");
      const next = { ...row.data, updatedBy: `agent:${actor.name}` };
      if (partner_id !== undefined) next.partnerId = partner_id;
      for (const k of ["name", "role", "organization", "email", "phone", "relation", "notes"]) if (rest[k] !== undefined) next[k] = clip(rest[k], k === "notes" ? 5000 : 300);
      await ctx.api.store.update(id, next);
      return { id };
    },
  },
};
