// Carte : ce que peut faire un assistant IA. Lire les lieux et les types, et PROPOSER un lieu : un brouillon que l'équipe relit et publie elle-même.
// L'assistant ne publie jamais. Ce qu'il écrit est du texte : il n'est affiché qu'échappé, et il ne peut pas toucher aux lieux venus d'autres modules.
// Les fichiers voisins sont importés avec la même « version » que celui-ci.

const q = new URL(import.meta.url).search;
const { clean, fold, num, LIMITS } = await import(new URL(`./text.mjs${q}`, import.meta.url).href);
const { world, typeName, ensureSeed } = await import(new URL(`./data.mjs${q}`, import.meta.url).href);
const { checkPlace, addPlace, ASSISTANT_DRAFTS } = await import(new URL(`./ops.mjs${q}`, import.meta.url).href);

const refuse = (message) => Object.assign(new Error(message), { expose: true });

export const mcp = {
  async map_places_list(ctx, args) {
    const w = await world(ctx);
    const status = ["published", "draft"].includes(args.status) ? args.status : "all";
    const terms = fold(clean(args.q, LIMITS.search)).split(/\s+/).filter(Boolean);
    let list = w.places;
    if (status !== "all") list = list.filter((p) => p.status === status);
    if (terms.length) list = list.filter((p) => terms.every((t) => p.hay.includes(t)));
    const limit = num(args.limit, 30, 1, 100);
    const start = /^\d{1,5}$/.test(String(args.cursor ?? "")) ? Number(args.cursor) : 0;
    const items = list.slice(start, start + limit).map((p) => ({
      id: p.code, name: p.name, type: p.type, lat: p.lat, lng: p.lng, address: p.address, description: p.desc, hours: p.hours, url: p.url, status: p.status, addedBy: p.by,
    }));
    const next = start + limit < list.length ? String(start + limit) : null;
    return { total: list.length, items, next };
  },

  async map_types_list(ctx) {
    const w = await world(ctx);
    return { types: w.types.map((t) => ({ id: t.id, name: typeName(ctx, t) || t.id, symbol: t.sym })) };
  },

  async map_place_add(ctx, args) {
    await ensureSeed(ctx);
    const w = await world(ctx);
    const r = checkPlace(ctx, { name: args.name, type: args.type, mapLink: args.mapLink, lat: args.lat === undefined ? "" : String(args.lat), lng: args.lng === undefined ? "" : String(args.lng), address: args.address, description: args.description, hours: args.hours, url: args.url }, w.types);
    if (!r.ok) throw refuse(Object.entries(r.errors).map(([field, message]) => `${field}: ${message}`).join(" | "));
    // ni doublon exact (même nom, même endroit), ni plus que ce que l'équipe peut relire
    const same = w.places.find((p) => fold(p.name) === fold(r.value.name) && Math.abs(p.lat - r.value.lat) < 1e-5 && Math.abs(p.lng - r.value.lng) < 1e-5);
    if (same) return { created: false, reason: "duplicate", id: same.code, status: same.status };
    const res = await addPlace(ctx, r.value, { status: "draft", by: "assistant" });
    if (!res.ok) throw refuse(res.reason === "drafts" ? `Too many drafts are waiting for review (${ASSISTANT_DRAFTS} at most): ask the site team to publish or delete some.` : `The place limit (${LIMITS.places}) is reached.`);
    return { created: true, id: res.code, status: "draft", note: "This place is a draft: the site team must review and publish it." };
  },
};
