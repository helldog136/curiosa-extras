// Ce que le bot lit chez les autres modules — jamais de copie : le direct et les followers (Chaîne Twitch), le prochain stream (les agendas de streams, ou le Planning), les fiches des partenaires (Sponsors),
// les liens des réseaux (modules de réseaux sociaux). Chaque lecture est facultative : un module absent donne « indisponible », jamais une erreur.
// Les lectures sont gardées quelques secondes (un chat animé ne doit pas faire travailler les autres modules à chaque message).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { stripScheme } = await import(`./commands.mjs${v}`);

/**
 * Milliseconds, in an object so that tests can shorten them.
 *   collectMs   : reading the streams from the calendars (a calendar that does not answer must never hold back a chat command);
 *   ttlMs       : a reading is "fresh" for this long;
 *   staleMs     : planning, partners, networks and followers rarely change: past `ttlMs`, the previous reading answers AT ONCE (up to `staleMs`) and is renewed in the background,
 *                 instead of making the person who typed a command wait while the other modules answer;
 *   liveStaleMs : same principle for the "only when live" check alone (never for {jeu}, {titre}… which need a fresh reading).
 */
export const timing = { collectMs: 5000, ttlMs: 15_000, staleMs: 600_000, liveStaleMs: 60_000, retryMs: 3_000 };
const within = (p, ms, fallback) => { let timer; const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); timer.unref?.(); }); return Promise.race([p, late]).finally(() => clearTimeout(timer)); };
const cache = new Map();     // key → { value, at, until }
const flights = new Map();   // key → reading in progress (two simultaneous requests share it)
export const resetSources = () => { cache.clear(); flights.clear(); };
const isNone = (v) => v === null || v === undefined;

/** Reads (one at a time per key) and stores the result. On failure, an older useful value is kept (if `keep`), otherwise `null` for a few seconds. */
function load(ctx, k, loader, { ttl, keep }) {
  const running = flights.get(k);
  if (running) return running;
  const run = (async () => {
    let value, failed = false;
    try { value = await loader(); } catch { value = null; failed = true; }
    const old = cache.get(k);
    const at = Date.now();
    if (keep && isNone(value) && old && !isNone(old.value)) { cache.set(k, { value: old.value, at: old.at, until: at + timing.retryMs }); return old.value; }
    // A reading that gave nothing (a module that is starting, a figure not measured yet) is kept only a few seconds: we do not stay "unavailable" for a quarter of a minute for nothing.
    cache.set(k, { value: failed ? null : value, at, until: at + (isNone(value) ? timing.retryMs : ttl) });
    return failed ? null : value;
  })().finally(() => { if (flights.get(k) === run) flights.delete(k); });
  flights.set(k, run);
  return run;
}
/**
 * The reading `name`. Fresh: returned as is. Old but still "usable" (`stale` ms): returned at once, and renewed in the background. Otherwise: we wait for the reading.
 * `stale`: 0 = never an old value.
 */
function cached(ctx, name, loader, { ttl = timing.ttlMs, stale = 0 } = {}) {
  const k = `${ctx.instance.key}|${name}`;
  const hit = cache.get(k);
  const now = Date.now();
  if (hit && hit.until > now) return Promise.resolve(hit.value);
  if (hit && stale > 0 && !isNone(hit.value) && now - hit.at < stale) { load(ctx, k, loader, { ttl, keep: true }).catch(() => {}); return Promise.resolve(hit.value); }
  return load(ctx, k, loader, { ttl, keep: stale > 0 });
}
/** The readings from other modules, kept as described above (see `warm` for the task that keeps them warm). */
const slow = (ctx, name, loader) => cached(ctx, name, loader, { stale: timing.staleMs });

/* ───────────── Twitch : le direct et les followers ───────────── */

/** L'état du direct de la chaîne : { known, live, title, game, startedAt, viewers, displayName } ou null (Chaîne Twitch absente ou muette). Une chaîne = une instance de Chaîne Twitch qui répond pour elle-même. */
const readLive = (ctx, channel) => async () => {
  const all = await ctx.api.services.callAll("twitch.live", "status", {});
  const mine = all.find((r) => r.ok && r.value?.channel === channel);
  if (!mine) return null;
  const v = mine.value;
  return { known: v.known === true, live: v.live === true, title: v.title ?? null, game: v.game ?? null, startedAt: v.startedAt ?? null, viewers: Number.isInteger(v.viewers) ? v.viewers : null, displayName: typeof v.displayName === "string" ? v.displayName : null };
};
/** A FRESH reading (at most `ttlMs` old): for what the reply says ({jeu}, {titre}, {uptime}, {viewers}). */
export const liveState = (ctx, channel) => cached(ctx, `live|${channel}`, readLive(ctx, channel));
/**
 * For the "only when live" check alone: a reading under a minute old is enough and answers without waiting for Twitch (renewed in the background);
 * the answer comes in a few milliseconds instead of a round trip to Twitch for every command of a quiet chat.
 */
export const liveGate = (ctx, channel) => cached(ctx, `live|${channel}`, readLive(ctx, channel), { stale: timing.liveStaleMs });

/** Le nombre de followers publié par Chaîne Twitch (chiffre `followers` de la chaîne), ou null s'il n'est pas disponible (suivi des statistiques éteint, chaîne non connectée…). */
export const followersCount = (ctx, channel) => slow(ctx, `followers|${channel}`, async () => {
  const items = await ctx.api.topics.collect("social.stat", { limit: 200 });
  const row = items.find((s) => s.platform === "twitch" && s.metric === "followers" && String(s.account ?? "").toLowerCase() === channel && Number.isInteger(s.value) && !s.error);
  return row ? row.value : null;
});

/* ───────────── Planning ───────────── */

const hasInstance = async (ctx, ...modules) => {
  for (const module of modules) if ((await ctx.api.instances.list({ module })).length > 0) return true;
  return false;
};

/**
 * { installed, next } : `next` = { start (Date), title, allDay } du prochain stream annoncé, ou null. Les streams viennent du sujet `planning.slot`, que fournissent les agendas de
 * streams (Agenda en ligne, Streams saisis à la main) : un agenda suffit, le Planning n'est pas nécessaire. Un stream annulé n'est jamais annoncé.
 */
export const planning = (ctx) => slow(ctx, "planning", async () => {
  if (!(await hasInstance(ctx, "calendar-ical", "calendar-manual", "planning"))) return { installed: false, next: null };
  const slots = await within(Promise.resolve().then(() => ctx.api.topics.collect("planning.slot", { limit: 50 })).catch(() => []), timing.collectMs, []);
  const now = Date.now();
  const future = slots.filter((s) => s.status !== "cancelled").map((s) => ({ start: new Date(s.start), title: s.title ?? "", allDay: s.allDay === true })).filter((s) => Number.isFinite(s.start.getTime()) && s.start.getTime() > now).sort((a, b) => a.start - b.start);
  return { installed: true, next: future[0] ?? null };
});

/* ───────────── Partenaires (Sponsors) ───────────── */

/** { installed, items: [{ id, title, slug, path, address, instance }] } — les fiches PUBLIÉES de toutes les instances de Sponsors. `ok: false` si la lecture a échoué (on ne retire alors rien). */
export const partners = (ctx) => slow(ctx, "partners", async () => {
  const instances = await ctx.api.instances.list({ module: "sponsors" });
  const site = String(ctx.api.siteUrl ?? "").replace(/\/+$/, "");
  const items = [];
  for (const inst of instances) {
    for (const e of await ctx.api.entries.list({ instance: inst.key, limit: 200 })) {
      if (!e?.id || !e.path) continue;
      items.push({ id: String(e.id), title: String(e.title ?? "").slice(0, 120) || String(e.slug ?? ""), slug: String(e.slug ?? ""), path: String(e.path), address: stripScheme(`${site}${e.path}`), instance: inst.key, instanceName: inst.name });
    }
  }
  return { installed: instances.length > 0, ok: true, items };
}).then((v) => v ?? { installed: false, ok: false, items: [] });

/* ───────────── Réseaux sociaux ───────────── */

const NAME_FROM_LABEL = (label) => String(label ?? "").split("·")[0].trim().slice(0, 40);
/** { items: [{ key (instance du module de réseau), module, name, label, url, adminPath }], ok } — un lien par module de réseau actif ET réglé (un module sans adresse ne fournit rien). */
export const networks = (ctx) => slow(ctx, "networks", async () => {
  const links = await ctx.api.topics.collect("social.link", { limit: 100 });
  // Où régler l'adresse de chaque réseau : la page de réglages de son instance (le cœur la donne, `adminPath`) ; absente = simplement pas de lien.
  const adminPaths = new Map((await ctx.api.instances.list().catch(() => [])).map((i) => [i.key, typeof i.adminPath === "string" && i.adminPath.startsWith("/admin/") ? i.adminPath : null]));
  const items = [];
  for (const l of links) {
    const instance = l.source?.instance;
    if (!instance || !/^https:\/\//i.test(l.url ?? "")) continue;
    const name = NAME_FROM_LABEL(l.label) || String(l.source?.name ?? instance);
    items.push({ key: String(instance), module: String(l.source?.module ?? ""), name, label: String(l.label ?? name), url: String(l.url), adminPath: adminPaths.get(String(instance)) ?? null });
  }
  return { ok: true, items };
}).then((v) => v ?? { ok: false, items: [] });

export const ALL = ["partners", "networks", "planning", "followers"];
const NOTHING = () => ({ partners: { installed: false, ok: false, items: [] }, networks: { ok: false, items: [] }, planning: { installed: false, next: null }, followers: { available: false, value: null } });
/** Empty sources: enough to know the NAMES of the commands (they come from the configuration alone) without asking anybody. */
export const noSources = NOTHING;

/**
 * Everything needed to build the catalogue of commands (see commands.mjs). `channel`: the bot's channel (or a promise of it), for the followers.
 * `need`: the readings wanted (all by default); the others are NOT done and stay "absent". A command that does not mention them makes no other module wait.
 */
export async function gather(ctx, channel, need = ALL) {
  const want = new Set(need), empty = NOTHING();
  const [p, n, pl, f] = await Promise.all([
    want.has("partners") ? partners(ctx) : null,
    want.has("networks") ? networks(ctx) : null,
    want.has("planning") ? planning(ctx) : null,
    want.has("followers") ? Promise.resolve(channel).then((c) => (c ? followersCount(ctx, c) : null)) : null,
  ]);
  return { partners: p ?? empty.partners, networks: n ?? empty.networks, planning: pl ?? empty.planning, followers: { available: Number.isInteger(f), value: f } };
}

/** Keeps every reading warm (the one-minute task): the next command of a quiet chat finds them ready. Never throws. */
export async function warm(ctx, channel) {
  try { await Promise.all([partners(ctx), networks(ctx), planning(ctx), channel ? followersCount(ctx, channel) : null, channel ? liveState(ctx, channel) : null]); } catch { /* the next command will read again */ }
}
