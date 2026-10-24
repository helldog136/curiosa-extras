// DOUBLE EN MÉMOIRE du service « videos.library » (version 1, lecture seule) : celui qu'une bibliothèque de vidéos offre aux autres modules.
// Contrat : list({ limit, cursor, q?, category? }) → { ok, items: [{ id, title, thumb?, url }], next? }.
//
//   const videos = fakeVideos({ items: [{ id: "v1", title: "Masterclass d'ouverture", url: "/videos/ouverture" }] });
//   const ctx = fakeCtx({ services: videos.services });
//   Pannes : videos.faults.hang.add("list") · .throw.add("list") · .garbage.add("list") · .notOk.add("list") · .slow.set("list", 50).
// Le double ne fait AUCUN appel réseau.
export function fakeVideos({ items = [] } = {}) {
  const all = items.map((v) => ({ ...v }));
  const faults = { hang: new Set(), throw: new Set(), garbage: new Set(), notOk: new Set(), slow: new Map() };
  const calls = [];
  const services = {
    "videos.library": {
      list: async (args) => {
        calls.push(["list", args]);
        if (faults.hang.has("list")) return new Promise(() => {});
        if (faults.slow.has("list")) await new Promise((r) => setTimeout(r, faults.slow.get("list")));
        if (faults.throw.has("list")) throw new Error("boom");
        if (faults.garbage.has("list")) return 42;
        if (faults.notOk.has("list")) return { ok: false, error: "down" };
        const q = String(args?.q ?? "").toLowerCase();
        const matching = all.filter((v) => !q || v.title.toLowerCase().includes(q));
        const limit = Math.min(500, Math.max(1, Number(args?.limit) || 50));
        const from = Number(args?.cursor ?? 0) || 0;
        return { ok: true, items: matching.slice(from, from + limit), ...(from + limit < matching.length ? { next: String(from + limit) } : {}) };
      },
    },
  };
  return { services, faults, calls, items: all };
}
