// DOUBLE EN MÉMOIRE de l'extension « contact.curate » v1 de Contacts (additive : le contrat « contact.book » v2 et son double ne changent pas).
// Texte du contrat : tests/contract-ext/README.md ; suite exécutable : tests/contract-ext/contactCurate.contract.mjs (elle passe contre ce double ET contre le vrai module).
//
// Il se construit SUR le double de « contact.book » (tests/helpers/fakeContactBook.mjs) en n'utilisant que ses méthodes publiques et ses gestes d'admin,
// donc le même carnet sert aux deux services :
//   const book = fakeContactBook();
//   const curate = fakeContactCurate(book);
//   const ctx = fakeCtx({ services: { ...book.services, "contact.curate": curate.methods } });
// Pannes : curate.faults.hang.add("addAccount") (ne répond jamais), curate.faults.throw.add("lookupAccounts") (le cœur rend « failed »).
import { normalizeAccount, fold, NETWORKS } from "./fakeContactBook.mjs";

export const CURATE_METHODS = ["lookupAccounts", "searchAccounts", "addAccount", "removeCategory"];
export const CURATE_READ_ONLY = ["lookupAccounts", "searchAccounts"];
export const CURATE_LIMITS = { lookup: 200, search: 50 };
const err = (error, extra = {}) => ({ ok: false, error, ...extra });
const obj = (a) => (a && typeof a === "object" && !Array.isArray(a) ? a : null);
const idOk = (v) => typeof v === "string" && v.length > 0 && v.length <= 80;

export function fakeContactCurate(book) {
  const faults = { hang: new Set(), throw: new Set() };
  const calls = [];
  const dump = () => book.dump();
  /** La catégorie actuelle (suit les fusions) ou null. */
  const liveCat = async (id) => {
    if (!idOk(id)) return null;
    const r = await book.methods.categoriesResolve({ ids: [id] });
    const hit = r.items?.find((x) => x.id === id);
    return hit ? id : (r.moved?.[id] ?? null);
  };
  const owners = () => { const m = new Map(); for (const c of dump().contacts) for (const a of c.accounts) m.set(`${a.network}:${a.handle}`, { c, a }); return m; };

  const impl = {
    async lookupAccounts(a) {
      a = obj(a);
      if (!a || !Array.isArray(a.handles) || a.handles.length > CURATE_LIMITS.lookup) return err("invalid");
      if (!NETWORKS.includes(a.network)) return err("invalid_network");
      let cat = null;
      if (a.categoryId !== undefined && a.categoryId !== null) { cat = await liveCat(a.categoryId); if (!cat) return err("not_found"); }
      const own = owners();
      return {
        ok: true,
        items: a.handles.map((h) => {
          const input = typeof h === "string" ? h.slice(0, 100) : "";
          const n = typeof h === "string" ? normalizeAccount(a.network, h) : { error: "invalid_handle" };
          if (n.error) return { input, error: n.error };
          const hit = own.get(`${n.network}:${n.handle}`);
          if (!hit) return { input, handle: n.handle, id: null };
          return { input, handle: n.handle, id: hit.c.id, accountId: hit.a.id, hasProfile: !!(hit.a.displayName || hit.a.avatar), ...(cat ? { inCategory: hit.c.categoryIds.includes(cat) } : {}) };
        }),
      };
    },
    async addAccount(a) {
      a = obj(a);
      if (!a || !idOk(a.id) || typeof a.network !== "string") return err("invalid");
      const n = normalizeAccount(a.network, a.handle);
      if (n.error) return err(n.error);
      const got = await book.methods.get({ id: a.id });
      if (!got.ok) return err("not_found");
      const hit = owners().get(`${n.network}:${n.handle}`);
      if (hit) return hit.c.id === a.id ? { ok: true, accountId: hit.a.id, existed: true } : err("taken", { id: hit.c.id });
      // Avec le seul contrat public : un compte neuf arrive sur une fiche provisoire, qu'on réunit à la fiche visée (la fiche visée garde tout).
      const tmp = await book.methods.upsertByAccount({ network: n.network, handle: n.handle, kind: got.contact.kind, source: "curate-fake" });
      if (!tmp.ok) return err(tmp.error);
      const merged = await book.methods.merge({ keep: a.id, drop: tmp.id });
      if (!merged.ok) return err(merged.error);
      return { ok: true, accountId: tmp.accountId, existed: false };
    },
    async removeCategory(a) {
      a = obj(a);
      if (!a || !idOk(a.id) || !idOk(a.categoryId)) return err("invalid");
      const cat = await liveCat(a.categoryId);
      if (!cat) return err("not_found");
      const got = await book.methods.get({ id: a.id });
      if (!got.ok) return err("not_found");
      if (!got.contact.categoryIds.includes(cat)) return { ok: true, removed: false };
      book.admin.setCategories(a.id, got.contact.categoryIds.filter((k) => k !== cat));
      return { ok: true, removed: true };
    },
    async searchAccounts(a) {
      a = obj(a);
      if (!a) return err("invalid");
      if (!NETWORKS.includes(a.network)) return err("invalid_network");
      const q = fold(String(a.q ?? "").slice(0, 100)).replace(/^@/, "");
      const lim = Math.min(CURATE_LIMITS.search, Math.max(1, Math.trunc(Number(a.limit)) || 10));
      let offset = 0;
      if (a.cursor !== undefined && a.cursor !== null && a.cursor !== "") {
        const m = /^o(\d{1,6})$/.exec(String(a.cursor));
        if (!m) return { ok: true, items: [], next: null };
        offset = Number(m[1]);
      }
      if (!q) return { ok: true, items: [], next: null };
      let cat = null;
      if (a.categoryId !== undefined && a.categoryId !== null) { cat = await liveCat(a.categoryId); if (!cat) return err("not_found"); }
      const scored = [];
      for (const c of dump().contacts) {
        const accs = c.accounts.filter((x) => x.network === a.network);
        if (!accs.length || (cat && !c.categoryIds.includes(cat))) continue;
        const texts = [fold(c.name), ...accs.flatMap((x) => [x.handle, x.handle.replace(/^@/, ""), fold(x.displayName ?? "")])];
        const s = texts.some((t) => t === q) ? 0 : texts.some((t) => t.startsWith(q)) ? 1 : texts.some((t) => t.includes(q)) ? 2 : -1;
        if (s >= 0) scored.push([s, c]);
      }
      scored.sort((x, y) => x[0] - y[0] || (fold(x[1].name) < fold(y[1].name) ? -1 : fold(x[1].name) > fold(y[1].name) ? 1 : 0));
      const page = scored.slice(offset, offset + lim).map(([, c]) => c);
      const items = page.flatMap((c) => c.accounts.filter((x) => x.network === a.network).map((x) => ({ id: c.id, accountId: x.id, name: c.name, handle: x.handle, ...(x.displayName ? { displayName: x.displayName } : {}), ...(x.avatar ? { avatar: x.avatar } : {}) })));
      return { ok: true, items, next: offset + page.length < scored.length ? `o${offset + page.length}` : null };
    },
  };
  const methods = Object.fromEntries(CURATE_METHODS.map((n) => [n, async (args) => {
    calls.push([n, structuredClone(args ?? null)]);
    if (faults.hang.has(n)) return new Promise(() => {});
    if (faults.throw.has(n)) throw new Error(`fault injected in ${n}`);
    return impl[n](args);
  }]));
  return { methods, services: { "contact.curate": methods }, faults, calls };
}
