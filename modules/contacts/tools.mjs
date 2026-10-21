// Contacts — les outils MCP pour les assistants. Lectures paginées (maximum déclaré dans module.json + curseur) ; `contacts_list` et `contact_get`
// ne donnent JAMAIS d'e-mail ni de téléphone (`contact_get_private`, non accordé d'office, les donne) ; toutes les écritures sont non accordées d'office.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const B = await import(`./book.mjs${v}`);
const { NETWORKS, clean } = await import(`./networks.mjs${v}`);

const fail = (m) => Object.assign(new Error(m), { expose: true });
const MAX = 100;
const lim = (v, def = 30) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 1 ? Math.min(MAX, n) : def; };
const offCursor = { enc: (n) => Buffer.from(JSON.stringify(["q", n])).toString("base64url"), dec: (c) => { try { const v = JSON.parse(Buffer.from(String(c), "base64url").toString("utf8")); return Array.isArray(v) && v[0] === "q" && Number.isInteger(v[1]) && v[1] >= 0 ? v[1] : 0; } catch { return 0; } } };
/** Une fiche pour un assistant, sans e-mail ni téléphone (sauf `privateFields`). */
const brief = (c, privateFields = false) => {
  const { email, phone, photo, source: _s, ...rest } = c;
  return { ...rest, accounts: c.accounts.map(({ id, network, handle, url, displayName, followers }) => ({ id, network, handle, url, ...(displayName ? { displayName } : {}), ...(followers !== undefined ? { followers } : {}) })), photo: photo?.url ?? null, ...(privateFields ? { email, phone } : {}) };
};
async function getOrFail(ctx, id) {
  const r = await B.get(ctx, { id });
  if (!r.ok) throw fail(r.movedTo ? `contact merged into ${r.movedTo}` : "contact not found");
  return r;
}
const explain = (r) => { if (!r.ok) throw fail(r.error === "taken" ? `account already on contact ${r.id}` : r.error); return r; };

export default {
  mcp: {
    async contacts_list(ctx, args) {
      const a = args && typeof args === "object" ? args : {};
      const idx = await B.getIndex(ctx);
      if (a.network !== undefined && !NETWORKS.includes(a.network)) throw fail("unknown network");
      let cat = null;
      if (a.categoryId) { cat = B.liveCategory(idx, a.categoryId); if (!cat) throw fail("category not found"); }
      const filter = { cat, network: a.network, kind: B.KINDS.includes(a.kind) ? a.kind : undefined, review: a.status === "to_review" };
      const limit = lim(a.limit);
      let ids, next;
      const q = B.searchKey(a.q ?? a.search);
      if (q) {
        const offset = a.cursor ? offCursor.dec(a.cursor) : 0;
        const r = B.searchIds(idx, { q, limit, offset, ...filter });
        ids = r.ids; next = offset + limit < r.total ? offCursor.enc(offset + limit) : null;
      } else {
        const r = B.indexPage(idx, { cursor: a.cursor, limit, tag: "mcp", reverse: true, ...filter });
        ids = r.ids; next = r.next;
      }
      const recs = await B.readMany(ctx, ids);
      const items = ids.filter((id) => recs.has(id)).map((id) => B.card(ctx, idx, recs.get(id))).filter((c) => a.status !== "active" || c.status === "active").map((c) => brief(c));
      return { items, next, total: idx.list.length };
    },
    async contact_get(ctx, args) {
      const r = await getOrFail(ctx, args?.id);
      return { ...brief(r.contact), others: r.contact.others, relation: r.contact.relation, notes: r.notes };
    },
    async contact_get_private(ctx, args) {
      const r = await getOrFail(ctx, args?.id);
      return { ...brief(r.contact, true), others: r.contact.others, relation: r.contact.relation, notes: r.notes };
    },
    async contact_categories(ctx, args) {
      const r = await B.categories(ctx, { q: args?.q, cursor: args?.cursor, limit: lim(args?.limit, 100) });
      return { items: r.items.map(({ id, label, color, icon }) => ({ id, label, color, icon })), next: r.next };
    },
    async contact_create(ctx, args) {
      const a = args && typeof args === "object" ? args : {};
      const r = explain(await B.create(ctx, { ...a, source: "agent", status: "active" }, { defaultSource: "agent" }));
      return { id: r.id, created: r.created, ...(r.matchedBy ? { matchedBy: r.matchedBy } : {}) };
    },
    async contact_update(ctx, args) {
      const a = args && typeof args === "object" ? args : {};
      const r = explain(await B.update(ctx, a, { allowStatus: true }));
      return { id: r.contact.id };
    },
    async contact_note(ctx, args, actor) {
      if (!clean(args?.text, 5000)) throw fail("empty note");
      explain(await B.note(ctx, { id: args?.id, text: args.text, author: actor?.name || "agent" }));
      return { id: args.id };
    },
    async contact_add_account(ctx, args) {
      const r = explain(await B.addAccount(ctx, { id: args?.id, network: args?.network, handle: args?.handle }));
      return { id: args.id, account: r.account, existed: r.existed };
    },
    async contact_delete(ctx, args) {
      const r = explain(await B.erase(ctx, { id: args?.id, confirm: true }));
      return { id: args.id, deleted: true, modules: r.modules.map(({ name, ok }) => ({ module: name, ok })) };
    },
  },
};
