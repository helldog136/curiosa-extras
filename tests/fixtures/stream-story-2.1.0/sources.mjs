// Ce que « Story d'annonce » lit chez les autres, sans jamais les connaître par leur nom : les streams à venir (sujet `planning.slot`, fourni par n'importe quel agenda),
// et les jaquettes (service du cœur, via ctx.api.rawg). Les co-streamers, eux, viennent de Contacts (contacts.mjs). Chaque lecture est facultative et BORNÉE :
// un agenda ou un service qui ne répond jamais rend « slow » au bout de quelques secondes, jamais une attente sans fin.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const P = await import(`./pure.mjs${v}`);
const images = await import(`./images.mjs${v}`);
const E = await import(`./events.mjs${v}`);

/** Les délais (en millisecondes), dans un objet pour que les tests puissent les raccourcir. */
// sourceMs : un appel à UNE source d'événements (les autres ne l'attendent pas au-delà) ; eventsMs : toute la liste des événements ; freshMs : la liste est gardée aussi longtemps avant de
// redemander aux sources ; staleMs : une source qui ne répond plus est remplacée par sa dernière liste connue, pendant ce temps seulement.
export const timing = { collectMs: 6000, coverMs: 5000, bookMs: 5000, providersMs: 2000, migrateMs: 45_000, brandMs: 2000, authMs: 4000, routeMs: 20_000, sourceMs: 8000, eventsMs: 12_000, freshMs: 45_000, minRefreshMs: 5000, staleMs: 15 * 60_000 };
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

/** Le nom du site et son logo (un chemin du site : le navigateur peut le dessiner sans passer par le relais). */
export async function brandOf(ctx) {
  const fallback = { name: "", logo: "" };
  const b = await within(Promise.resolve().then(() => ctx.api.brand(ctx.locale)), timing.brandMs, null);
  if (!b || typeof b !== "object") return fallback;
  const logos = Array.isArray(b.logos) ? b.logos : [];
  const pick = ["square", "squareDark", "wide", "wideDark"].map((k) => logos.find((l) => l?.kind === k)?.src).find((s) => typeof s === "string" && /^\/(?!\/)/.test(s) && s.length < 300) ?? (typeof b.logo === "string" && /^\/(?!\/)/.test(b.logo) ? b.logo : "");
  return { name: P.oneLine(b.name, P.LIMITS.channelName), logo: P.safeImageUrl(pick) };
}

/* ───────────── Les événements de toutes les sources ───────────── */

const CALENDAR = { kind: "calendar" };
const HORIZON = 90 * DAY;
const state = { cache: new Map(), good: new Map(), inflight: new Map() };
export const resetEvents = () => { state.cache.clear(); state.good.clear(); state.inflight.clear(); };
const remember = (map, k, val, max) => { map.delete(k); map.set(k, val); while (map.size > max) map.delete(map.keys().next().value); };

/** Le planning : les streams des agendas installés (sujet `planning.slot`). Un agenda muet est une source « en panne », pas une erreur. */
async function readCalendar(ctx, { zone, now }) {
  const label = String(ctx.t?.("src_calendar") ?? "") || "Planning";
  const source = { ...CALENDAR, label };
  const FAILED = Symbol("failed");
  const read = Promise.resolve().then(() => ctx.api.topics.collect("planning.slot", { limit: 100, from: new Date(now - 6 * HOUR), to: new Date(now + HORIZON) }));
  const items = await within(read, timing.collectMs, FAILED);
  if (items === FAILED || !Array.isArray(items)) return { ...source, state: "down", message: "", note: "", events: [] };
  return { ...source, state: "ok", message: "", note: "", events: E.calendarEvents(items, now, zone || "UTC", source) };
}

/** Une source qui offre le service `event.source` : un appel borné, et sa dernière bonne liste si elle ne répond plus (pendant `staleMs` seulement). */
async function readProvider(ctx, provider, { zone, now, locale }) {
  const fallback = { kind: "other", label: String(provider.name ?? "") };
  const FAILED = Symbol("failed");
  const call = Promise.resolve().then(() => ctx.api.services.call(E.SERVICE, "upcoming", { from: new Date(now - 6 * HOUR).toISOString(), to: new Date(now + HORIZON).toISOString(), limit: E.LIMITS.perSource, locale }, { provider: provider.id }));
  const r = await within(call, timing.sourceMs, FAILED);
  const memo = state.good.get(provider.id);
  if (r !== FAILED && r?.ok) {
    const answer = E.readAnswer(r.value, fallback, { fallbackZone: zone || "UTC" });
    if (answer.state === "ok") remember(state.good, provider.id, { at: now, answer }, 40);
    else if (answer.state === "down" && memo && now - memo.at <= timing.staleMs) return { ...memo.answer, state: "down", stale: true, message: answer.message, note: memo.answer.note };
    return answer;
  }
  if (memo && now - memo.at <= timing.staleMs) return { ...memo.answer, state: "down", stale: true };
  return { ...cleanFallback(fallback), state: "down", message: "", note: "", events: [] };
}
const cleanFallback = (f) => E.cleanSource({}, f);

/**
 * Tous les événements à venir : { events (agrégés, triés, dédoublonnés), sources: [{ kind, label, state, message, note, count, stale? }], at }.
 * Aucune attente sans fin : chaque source a son délai, la liste entière aussi. Aucun minuteur de fond : la liste est gardée `freshMs`, puis redemandée à la demande suivante.
 * Deux demandes en même temps partagent le même travail.
 */
export async function loadEvents(ctx, { zone = "", now = Date.now(), force = false } = {}) {
  const k = String(ctx.instance?.key ?? "story");
  const hit = state.cache.get(k);
  if (hit && hit.zone === zone && now - hit.at < (force ? timing.minRefreshMs : timing.freshMs)) return hit.value;   // « Réessayer » ne passe pas outre avant quelques secondes
  const running = state.inflight.get(k);
  if (running) return running;
  const locale = ctx.locale === "en" ? "en" : "fr";
  const work = Promise.resolve().then(async () => {
    let providers = [];
    try { providers = await within(Promise.resolve().then(() => (typeof ctx.api.services?.providers === "function" ? ctx.api.services.providers(E.SERVICE) : [])), timing.providersMs, []); } catch { providers = []; }
    providers = (Array.isArray(providers) ? providers : []).filter((p) => p && typeof p.id === "string").slice(0, E.LIMITS.sources);
    const answers = await Promise.all([readCalendar(ctx, { zone, now }), ...providers.map((p) => readProvider(ctx, p, { zone, now, locale }))]);
    const events = E.aggregate(answers.map((a) => a.events), now);
    const sources = [];
    for (const a of answers) {
      const count = events.filter((e) => e.source === a.kind || e.alsoIn.some((s) => s.kind === a.kind)).length;
      const mine = sources.find((s) => s.kind === a.kind);
      if (!mine) sources.push({ kind: a.kind, label: a.label, state: a.state, message: a.message, note: a.note, count, ...(a.stale ? { stale: true } : {}) });
      else if (a.state !== "ok" && mine.state === "ok") Object.assign(mine, { state: a.state, message: a.message, ...(a.stale ? { stale: true } : {}) });   // deux chaînes d'un même type : la panne de l'une se voit
    }
    sources.sort((a, b) => E.sourceRank(a.kind) - E.sourceRank(b.kind) || a.label.localeCompare(b.label));
    return { events, sources, at: now, zone };
  });
  const bounded = within(work, timing.eventsMs, null).then((value) => value ?? { events: [], sources: [{ kind: "calendar", label: String(ctx.t?.("src_calendar") ?? "") || "Planning", state: "down", message: "", note: "", count: 0 }], at: now, zone, late: true });
  state.inflight.set(k, bounded);
  try {
    const value = await bounded;
    if (!value.late) remember(state.cache, k, { at: now, zone, value }, 8);
    return value;
  } finally { state.inflight.delete(k); }
}

/** La jaquette d'un jeu (service du cœur), bornée : { cover, coverState: "" | "no_key" | "down" }. */
export async function coverOf(ctx, game) {
  const name = P.oneLine(game, 80);
  if (!name) return { cover: "", coverState: "" };
  const configured = await within(Promise.resolve().then(() => ctx.api?.rawg?.configured?.()), timing.coverMs, false);
  if (!configured) return { cover: "", coverState: "no_key" };
  const r = await within(Promise.resolve().then(() => ctx.api.rawg.cover(name)), timing.coverMs, null);
  if (r?.status === "found" && images.allowedUrl(r.url)) return { cover: String(r.url), coverState: "" };
  return { cover: "", coverState: r?.status === "unreachable" || r?.status === "refused" || r === null ? "down" : "" };
}
