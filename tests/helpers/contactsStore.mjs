// Stockage en mémoire FIDÈLE au contrat 5 du cœur 0.2.0 (ctx.api.store) : `key`, `page` (curseur « date|id », ordre asc/desc, filtre par clé),
// `getByKey` (le plus ancien), `listByKey`, `addMany` (même date pour toute la tranche, ids croissants), `generation`, `count`, `list`.
// Le faux contexte du kit (fakeCtx) n'a pas encore `key` ni `generation` : les tests de Contacts 2.0 le remplacent par celui-ci (`ctx.api.store = memStore()`).
//
// Pannes pour les tests « trou noir » : `store.faults.hang.add("page")` (la méthode ne répond jamais), `store.faults.throw.add("update")`.
// `store.bumpGeneration()` simule une restauration de sauvegarde. `store.dump(collection)` lit tout pour les assertions.
export function memStore({ start = Date.parse("2026-01-01T00:00:00Z") } = {}) {
  const rows = new Map(); // id → { id, collection, createdAt (ms), data (texte JSON), key }
  let seq = 0, clock = start, generation = 0;
  const faults = { hang: new Set(), throw: new Set(), countdown: new Map() };
  const nextId = () => `r${String(++seq).padStart(7, "0")}`;
  const tick = () => (clock += 1);
  const view = (r) => ({ id: r.id, createdAt: new Date(r.createdAt), data: JSON.parse(r.data), key: r.key });
  const cleanKey = (k) => { if (k === undefined || k === null || k === "") return null; if (typeof k !== "string" || k.length > 200) throw new Error("store: bad key"); return k; };
  const enc = (r) => Buffer.from(`${new Date(r.createdAt).toISOString()}|${r.id}`).toString("base64url");
  const dec = (c) => { try { const s = Buffer.from(c, "base64url").toString("utf8"); const i = s.indexOf("|"); const t = Date.parse(s.slice(0, i)); return i > 0 && !Number.isNaN(t) ? { t, id: s.slice(i + 1) } : null; } catch { return null; } };
  const cmp = (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const guard = (name, fn) => async (...args) => {
    if (faults.hang.has(name)) return new Promise(() => {});
    if (faults.throw.has(name)) throw new Error(`fault injected in store.${name}`);
    const n = faults.countdown.get(name);
    if (n !== undefined) { if (n <= 0) throw new Error(`fault injected in store.${name} (countdown)`); faults.countdown.set(name, n - 1); }
    return fn(...args);
  };
  // Index de test (pour rester rapide à 100 000 lignes) : lignes triées par collection, ids par (collection, clé).
  const sorted = new Map(); // collection → lignes triées (null = à retrier)
  const byKey = new Map();  // collection \0 clé → Set d'ids
  const kk = (c, k) => `${c}\u0000${k}`;
  const touch = (c) => sorted.set(c, null);
  const keyAdd = (r) => { if (r.key === null) return; const k = kk(r.collection, r.key); if (!byKey.has(k)) byKey.set(k, new Set()); byKey.get(k).add(r.id); };
  const keyDel = (r) => { if (r.key === null) return; byKey.get(kk(r.collection, r.key))?.delete(r.id); };
  const sortedOf = (c) => { let l = sorted.get(c); if (!l) { l = [...rows.values()].filter((r) => r.collection === c).sort(cmp); sorted.set(c, l); } return l; };
  function page(collection, o = {}) {
    const limit = Math.min(Math.max(Math.floor(Number(o.limit) || 100), 1), 1000);
    const asc = o.order === "asc";
    let c = null;
    if (o.cursor) { c = dec(o.cursor); if (!c) return { items: [], next: null }; }
    let all = o.key === undefined ? sortedOf(collection) : [...(byKey.get(kk(collection, o.key)) ?? [])].map((id) => rows.get(id)).sort(cmp);
    if (!asc) all = [...all].reverse();
    let from = 0;
    if (c) { from = all.findIndex((r) => (asc ? cmp(r, { createdAt: c.t, id: c.id }) > 0 : cmp(r, { createdAt: c.t, id: c.id }) < 0)); if (from < 0) return { items: [], next: null }; }
    const items = all.slice(from, from + limit);
    return { items: items.map(view), next: all.length > from + limit ? enc(items[items.length - 1]) : null };
  }
  const store = {
    add: guard("add", async (collection, data, opts) => { const id = nextId(); const r = { id, collection, createdAt: tick(), data: JSON.stringify(data), key: cleanKey(opts?.key) }; rows.set(id, r); keyAdd(r); touch(collection); return id; }),
    get: guard("get", async (id) => { const r = rows.get(id); return r ? view(r) : null; }),
    update: guard("update", async (id, data, opts) => {
      const r = rows.get(id);
      if (!r) return false;
      r.data = JSON.stringify(data);
      if (opts && "key" in opts && opts.key !== undefined) { const k = cleanKey(opts.key); keyDel(r); r.key = k; keyAdd(r); }
      return true;
    }),
    list: guard("list", async (collection, o) => page(collection, { limit: Math.min(o?.limit ?? 100, 10_000) }).items),
    page: guard("page", async (collection, o) => page(collection, o)),
    getByKey: guard("getByKey", async (collection, key) => page(collection, { key, order: "asc", limit: 1 }).items[0] ?? null),
    listByKey: guard("listByKey", async (collection, key, o) => page(collection, { ...o, key })),
    addMany: guard("addMany", async (collection, list) => {
      if (!Array.isArray(list) || list.length > 5000) throw new Error("store: addMany");
      const at = tick();
      const prepared = list.map((r) => ({ id: nextId(), collection, createdAt: at, data: JSON.stringify(r.data), key: cleanKey(r.key) }));
      for (const p of prepared) { rows.set(p.id, p); keyAdd(p); }
      touch(collection);
      return prepared.map((p) => p.id);
    }),
    generation: guard("generation", async () => generation),
    remove: guard("remove", async (id) => { const r = rows.get(id); if (r) { keyDel(r); rows.delete(id); touch(r.collection); } }),
    count: guard("count", async (collection) => sortedOf(collection).length),
  };
  return Object.assign(store, {
    faults,
    bumpGeneration: () => { generation++; },
    /** Remplace tout le contenu (restauration simulée) : [{ collection, data, key?, createdAt? }]. Incrémente la génération. */
    restore(list) { rows.clear(); sorted.clear(); byKey.clear(); for (const r of list) { const id = r.id ?? nextId(); const row = { id, collection: r.collection, createdAt: r.createdAt ?? tick(), data: typeof r.data === "string" ? r.data : JSON.stringify(r.data), key: r.key ?? null }; rows.set(id, row); keyAdd(row); } generation++; },
    dump: (collection) => [...rows.values()].filter((r) => !collection || r.collection === collection).sort(cmp).map((r) => ({ ...view(r), collection: r.collection })),
    /** Ajoute des lignes « anciennes » (données d'une version précédente) sans passer par l'API : [{ collection, data, key? }]. */
    seed(list) { const ids = []; for (const r of list) { const id = nextId(); const row = { id, collection: r.collection, createdAt: tick(), data: JSON.stringify(r.data), key: r.key ?? null }; rows.set(id, row); keyAdd(row); touch(r.collection); ids.push(id); } return ids; },
    snapshot: () => [...rows.values()].map((r) => ({ ...r })),
  });
}
