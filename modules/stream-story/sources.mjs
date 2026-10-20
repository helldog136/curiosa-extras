// Ce que « Story d'annonce » lit chez les autres, sans jamais les connaître par leur nom : les streams à venir (sujet `planning.slot`, fourni par n'importe quel agenda),
// les partenaires (sujet `stream.partner`, fourni par le Raid Twitch) et les jaquettes (service du cœur, via ctx.api.rawg). Chaque lecture est facultative et BORNÉE :
// un agenda ou un service qui ne répond jamais rend « slow » au bout de quelques secondes, jamais une attente sans fin.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const P = await import(`./pure.mjs${v}`);
const images = await import(`./images.mjs${v}`);

/** Les délais (en millisecondes), dans un objet pour que les tests puissent les raccourcir. */
export const timing = { collectMs: 6000, coverMs: 5000, partnersMs: 4000, brandMs: 2000, authMs: 4000, routeMs: 20_000 };
const HOUR = 3_600_000, DAY = 86_400_000;

/** Attend `p` au plus `ms` ; passé ce délai, rend `fallback` (et le résultat tardif n'est jamais utilisé). Le minuteur ne retient pas le processus. */
export function within(p, ms, fallback) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); timer.unref?.(); });
  return Promise.race([Promise.resolve(p).catch(() => fallback), late]).finally(() => clearTimeout(timer));
}

/**
 * Les prochains streams, avec la jaquette du premier jeu quand elle est connue.
 * { state: "ok" | "empty" | "slow", streams: [...], coverState: "" | "no_key" | "down" }
 */
export async function loadStreams(ctx, { zone = "", now = Date.now(), max = P.LIMITS.streams } = {}) {
  const FAILED = Symbol("failed");
  const read = Promise.resolve().then(() => ctx.api.topics.collect("planning.slot", { limit: 100, from: new Date(now - 6 * HOUR), to: new Date(now + 90 * DAY) }));
  const items = await within(read, timing.collectMs, FAILED);
  if (items === FAILED || !Array.isArray(items)) return { state: "slow", streams: [], coverState: "" };
  const streams = P.upcomingStreams(items, now, zone || "UTC", max).map((s) => ({ ...s, cover: "" }));
  if (!streams.length) return { state: "empty", streams: [], coverState: "" };
  let coverState = "";
  const names = [...new Set(streams.slice(0, 8).map((s) => s.games[0]).filter(Boolean))];
  if (names.length) {
    const configured = await within(Promise.resolve().then(() => ctx.api?.rawg?.configured?.()), timing.coverMs, false);
    if (!configured) coverState = "no_key";
    else {
      const found = new Map();
      await within(Promise.all(names.map(async (n) => {
        const r = await ctx.api.rawg.cover(n);
        if (r?.status === "found" && images.allowedUrl(r.url)) found.set(n, String(r.url));
        else if (r?.status === "unreachable" || r?.status === "refused") coverState = "down";
      })), timing.coverMs, null);
      for (const s of streams) s.cover = found.get(s.games[0]) ?? "";
    }
  }
  return { state: "ok", streams, coverState };
}

/** Les partenaires fournis par un autre module : { state: "ok" | "none" | "slow", items: [{ login, name, image }] }. Les images ne sont gardées que si le relais sait les servir. */
export async function loadPartners(ctx) {
  const FAILED = Symbol("failed");
  const items = await within(Promise.resolve().then(() => ctx.api.topics.collect("stream.partner", { limit: 100 })), timing.partnersMs, FAILED);
  if (items === FAILED || !Array.isArray(items)) return { state: "slow", items: [] };
  const out = [], seen = new Set();
  for (const it of items) {
    const n = P.normalizeLogin(it?.login ?? it?.id);
    if (!n.login || seen.has(n.login)) continue;
    seen.add(n.login);
    out.push({ login: n.login, name: P.oneLine(it?.title, P.LIMITS.displayName), image: images.allowedUrl(it?.image)?.href ?? "" });
  }
  return { state: out.length ? "ok" : "none", items: out.slice(0, P.LIMITS.savedCostreamers) };
}

/** Le nom du site et son logo (un chemin du site : le navigateur peut le dessiner sans passer par le relais). */
export async function brandOf(ctx) {
  const fallback = { name: "", logo: "" };
  const b = await within(Promise.resolve().then(() => ctx.api.brand(ctx.locale)), timing.brandMs, null);
  if (!b || typeof b !== "object") return fallback;
  const logos = Array.isArray(b.logos) ? b.logos : [];
  const pick = ["square", "squareDark", "wide", "wideDark"].map((k) => logos.find((l) => l?.kind === k)?.src).find((s) => typeof s === "string" && /^\/(?!\/)/.test(s) && s.length < 300) ?? (typeof b.logo === "string" && /^\/(?!\/)/.test(b.logo) ? b.logo : "");
  return { name: P.oneLine(b.name, P.LIMITS.channelName), logo: P.safeImageUrl(pick) };
}
