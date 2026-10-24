// Faux fournisseur du sujet `map.place` (publication), pour essayer les modules qui le lisent (Carte) sans installer les modules qui le publient (événements, annuaire…).
// Il joue le rôle du cœur : il garde ce que le schéma du consommateur accepte (champs inconnus supprimés, éléments invalides écartés) et ajoute la provenance (`source`).
// Les cas à essayer côté consommateur : présent, absent, en panne, lent, réponse illisible.
//
//   const provider = fakeMapPlaces([{ id: "ev-1", title: "Rencontre", lat: 12.3, lng: 4.5, kind: "event", at: "2030-05-01" }], { source: { instance: "events", module: "events", name: "Événements" } });
//   const ctx = fakeCtx({ topics: { "map.place": provider.topic }, ... });
//   provider.mode = "down" | "slow" | "garbage" | "absent" | "ok"

/** Le format que Carte annonce dans son manifeste (`consumes`) : id, title, lat, lng obligatoires ; kind, url, at, note facultatifs. */
export const SCHEMA = [
  { key: "id", type: "string", required: true }, { key: "title", type: "string", required: true }, { key: "lat", type: "number", required: true }, { key: "lng", type: "number", required: true },
  { key: "kind", type: "string" }, { key: "url", type: "url" }, { key: "at", type: "datetime" }, { key: "note", type: "string" },
];

const isIso = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) && Number.isFinite(Date.parse(v));
const valid = {
  string: (v) => typeof v === "string", number: (v) => typeof v === "number" && Number.isFinite(v), url: (v) => typeof v === "string" && (/^https?:\/\//i.test(v) || /^\/(?!\/)/.test(v)),
  datetime: isIso, boolean: (v) => typeof v === "boolean",
};

/** Ce que le cœur remet au consommateur : champs du schéma seulement, éléments invalides écartés, provenance ajoutée. */
export function deliver(items, source, schema = SCHEMA) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = {};
    let bad = false;
    for (const f of schema) {
      const v = raw[f.key];
      if (v === undefined || v === null) { if (f.required) bad = true; continue; }
      if (!valid[f.type](v)) { bad = true; break; }
      item[f.key] = v;
    }
    if (!bad) out.push({ ...item, source });
  }
  return out;
}

export function fakeMapPlaces(items = [], { source = { instance: "fake-events", module: "fake-events", name: "Fake events" }, slowMs = 20_000 } = {}) {
  const provider = {
    mode: "ok",
    items,
    source,
    calls: [],
    /** À passer à fakeCtx : `topics: { "map.place": provider.topic }`. */
    topic: async (opts) => {
      provider.calls.push(opts);
      if (provider.mode === "absent") return [];
      if (provider.mode === "down") throw new Error("provider is down");
      if (provider.mode === "garbage") return "this is not a list";
      if (provider.mode === "slow") await new Promise((r) => setTimeout(r, slowMs));
      return deliver(provider.items, provider.source).slice(0, opts?.limit ?? 50);
    },
  };
  return provider;
}
