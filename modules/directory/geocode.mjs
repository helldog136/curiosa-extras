// Annuaire — situer une VILLE (jamais une adresse) pour la carte, seulement à la demande de la propriétaire, depuis l'administration, et seulement pour une personne qui a accepté d'être sur la carte.
// Le service interrogé ne reçoit que le NOM de la ville et la langue : aucune donnée sur la personne. Résultat arrondi à la ville (2 décimales). Appel borné par le client réseau du cœur
// (délai, pauses, disjoncteur) ; jamais depuis une page publique.
const v = new URL(import.meta.url).search;
const { roundGeo, clean } = await import(`./pure.mjs${v}`);

export const HOST = "https://geocoding-api.open-meteo.com/v1/search";

/** Rend { ok: true, lat, lng, label } ou { ok: false, why: "none" | "down" | "invalid" }. */
export async function lookupCity(ctx, city) {
  const name = clean(city, 80);
  if (!name) return { ok: false, why: "invalid" };
  if (typeof ctx.api?.net?.request !== "function") return { ok: false, why: "down" };
  const url = `${HOST}?name=${encodeURIComponent(name)}&count=1&format=json&language=${encodeURIComponent(/^[a-z]{2}$/.test(ctx.locale) ? ctx.locale : "en")}`;
  const r = await ctx.api.net.request({ url, timeoutMs: 6000, maxBytes: 100_000, priority: "interactive" });
  if (!r?.ok || r.status !== 200) return { ok: false, why: "down" };
  const hit = Array.isArray(r.json?.results) ? r.json.results[0] : null;
  const g = hit ? roundGeo(hit.latitude, hit.longitude) : null;
  if (!g) return { ok: false, why: r.json && typeof r.json === "object" ? "none" : "down" };
  return { ok: true, ...g, label: [hit.name, hit.country].map((x) => clean(x, 60)).filter(Boolean).join(", ") };
}
