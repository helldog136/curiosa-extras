// DOUBLE EN MÉMOIRE du service « gallery.albums » (version 1, lecture seule) : celui qu'une galerie photo offre aux autres modules.
// Contrat : list({ limit, cursor, q? }) → { ok, albums: [{ id, title, cover?, count, url }], next? } · get({ id }) → { ok, album: { id, title, count, url, cover? } | null }.
//
//   const gallery = fakeGallery({ albums: [{ id: "a1", title: "Soirée d'ouverture", count: 24, url: "/galerie/ouverture" }] });
//   const ctx = fakeCtx({ services: gallery.services });
//   Pannes : gallery.faults.hang.add("get") (ne répond jamais : testez votre attente bornée) · .throw.add("list") (le cœur rend « failed ») · .garbage.add("list") (réponse illisible)
//            .slow.set("list", 50) (répond après 50 ms) · .notOk.add("list") (répond { ok: false }).
// Le double ne fait AUCUN appel réseau.
export function fakeGallery({ albums = [] } = {}) {
  const list = albums.map((a) => ({ cover: undefined, ...a }));
  const faults = { hang: new Set(), throw: new Set(), garbage: new Set(), notOk: new Set(), slow: new Map() };
  const calls = [];
  const guard = async (method, args, run) => {
    calls.push([method, args]);
    if (faults.hang.has(method)) return new Promise(() => {});
    if (faults.slow.has(method)) await new Promise((r) => setTimeout(r, faults.slow.get(method)));
    if (faults.throw.has(method)) throw new Error("boom");
    if (faults.garbage.has(method)) return "n'importe quoi";
    if (faults.notOk.has(method)) return { ok: false, error: "down" };
    return run();
  };
  const services = {
    "gallery.albums": {
      list: (args) => guard("list", args, () => {
        const q = String(args?.q ?? "").toLowerCase();
        const matching = list.filter((a) => !q || a.title.toLowerCase().includes(q));
        const limit = Math.min(500, Math.max(1, Number(args?.limit) || 50));
        const from = Number(args?.cursor ?? 0) || 0;
        const page = matching.slice(from, from + limit);
        return { ok: true, albums: page, ...(from + limit < matching.length ? { next: String(from + limit) } : {}) };
      }),
      get: (args) => guard("get", args, () => ({ ok: true, album: list.find((a) => a.id === args?.id) ?? null })),
    },
  };
  return { services, faults, calls, albums: list };
}
