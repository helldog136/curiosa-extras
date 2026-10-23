// Stockage en mémoire pour les tests de « Sondages » : celui du vrai cœur (collections, clés, pages par curseur, le plus ancien d'abord pour une clé),
// ce que le faux contexte du kit n'a pas encore. Se branche par `ctx.api.store = pollsStore()`.
export function pollsStore() {
  const rows = new Map();
  let seq = 0, clock = Date.parse("2026-01-01T00:00:00Z");
  const writes = [];
  const view = (r) => ({ id: r.id, createdAt: new Date(r.createdAt), data: structuredClone(r.data), key: r.key });
  const sorted = (collection, asc) => [...rows.values()].filter((r) => r.collection === collection).sort((a, b) => (asc ? 1 : -1) * (a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)));
  const store = {
    async add(collection, data, o) { const id = `r${String(++seq).padStart(6, "0")}`; writes.push(["add", collection]); rows.set(id, { id, collection, createdAt: (clock += 1), data: structuredClone(data), key: o?.key ?? null }); return id; },
    async get(id) { const r = rows.get(id); return r ? view(r) : null; },
    async update(id, data, o) { const r = rows.get(id); if (!r) return false; writes.push(["update", r.collection]); r.data = structuredClone(data); if (o && "key" in o) r.key = o.key; return true; },
    async remove(id) { const r = rows.get(id); if (r) writes.push(["remove", r.collection]); rows.delete(id); },
    async list(collection, o) { return sorted(collection, false).slice(0, Math.min(o?.limit ?? 100, 10000)).map(view); },
    async page(collection, o) {
      const all = sorted(collection, o?.order === "asc");
      const start = Math.max(0, Number(o?.cursor ?? 0) || 0), limit = Math.min(Math.max(1, o?.limit ?? 100), 1000);
      return { items: all.slice(start, start + limit).map(view), next: start + limit < all.length ? String(start + limit) : null };
    },
    async getByKey(collection, key) { const r = sorted(collection, true).find((x) => x.key === key); return r ? view(r) : null; },
    async listByKey(collection, key, o) { const all = sorted(collection, false).filter((x) => x.key === key); return { items: all.slice(0, o?.limit ?? 100).map(view), next: null }; },
    async count(collection) { return [...rows.values()].filter((r) => r.collection === collection).length; },
    async generation() { return 0; },
  };
  return Object.assign(store, { writes, dump: (collection) => sorted(collection, true).map(view), all: () => [...rows.values()].map(view) });
}
