// Enregistreur de directs : relève la chaîne à intervalle régulier et reconstitue chaque direct comme une SESSION (début, fin, pic, moyenne, heures regardées, followers),
// découpée en SEGMENTS par jeu. C'est le site qui mesure, à partir du jour où le suivi est activé : Twitch ne donne pas l'historique.
// Seul helix.mjs parle à Twitch ; ce fichier ne connaît que ses réponses et le stockage de l'instance (collections « twitchLive… », à ce module seul).
//
// Règles qui évitent les chiffres faux :
//  - une mesure en erreur (401, 429, réseau) n'écrit RIEN : pas de zéro, pas de direct fermé à tort ;
//  - chaque mesure vaut jusqu'à la suivante ; un trou de plus de 3 intervalles n'est jamais comblé (il est compté à part et le direct est marqué « approximatif ») ;
//  - fermeture d'un direct : 3 vérifications consécutives hors direct (une coupure brève ne le coupe pas en deux) ; un direct interrompu par un arrêt du site est refermé à sa DERNIÈRE mesure.
// Volume (voir le README) : mesures brutes par jour (≈ 35 octets chacune, 90 jours par défaut), un résumé par direct (≈ 1 à 3 Ko, 5 ans par défaut).
const version = new URL(import.meta.url).search;
const helix = await import(new URL(`./helix.mjs${version}`, import.meta.url).href);

export const COLLECTIONS = { state: "twitchLiveState", sessions: "twitchLiveSessions", days: "twitchLiveDays", lists: "twitchLiveLists" };
const MIN = 60_000;
export const CLOSE_AFTER = 3;           // vérifications consécutives hors direct avant de fermer
export const IDLE_MINUTES = 4;          // hors direct : une vérification toutes les 4 minutes
export const FOLLOWERS_EVERY = 10 * MIN; // followers : au plus toutes les 10 minutes (et à l'ouverture, au changement de jeu, à la fermeture)
export const MAX_RESUME = 30 * MIN;     // au-delà de 30 minutes sans mesure, le direct est refermé (interrompu) plutôt que prolongé
export const MAX_SEGMENTS = 40;         // segments par direct (les suivants restent dans le dernier)
export const MAX_DAY_POINTS = 1500;     // mesures brutes par jour
export const MAX_SESSIONS = 3000;       // résumés gardés au plus
export const MIN_RATE_SECONDS = 600;    // pas de « followers par heure » sur moins de 10 minutes de direct
export const INTERVALS = [1, 2, 3, 5];
export const RAW_DAYS = [30, 90, 180, 365];
export const KEEP_YEARS = [1, 2, 5, 10];

export const intervalOf = (ctx) => { const n = Number(ctx.setting("liveEveryMinutes")); return INTERVALS.includes(n) ? n : 2; };
export const rawDaysOf = (ctx) => { const n = Number(ctx.setting("rawDays")); return RAW_DAYS.includes(n) ? n : 90; };
export const keepYearsOf = (ctx) => { const n = Number(ctx.setting("keepYears")); return KEEP_YEARS.includes(n) ? n : 5; };
/** Un trou de plus de 3 intervalles (6 minutes par défaut) n'est pas une mesure continue. */
export const toleranceMs = (ctx) => 3 * intervalOf(ctx) * MIN;

const first = async (ctx, col) => { try { return (await ctx.api.store.list(col, { limit: 1 }))[0] ?? null; } catch { return null; } };
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const round1 = (n) => Math.round(n * 10) / 10;
const gameKey = (x) => x.gameId ?? x.game ?? "";

async function loadState(ctx) {
  const row = await first(ctx, COLLECTIONS.state);
  return { id: row?.id ?? null, d: { since: null, openId: null, offChecks: 0, lastCheckAt: 0, lastOkAt: null, followers: null, endReading: null, purgedDay: null, lastError: null, ...(row?.data ?? {}) } };
}
async function saveState(ctx, st) {
  if (st.id && (await ctx.api.store.update(st.id, st.d))) return;
  st.id = await ctx.api.store.add(COLLECTIONS.state, st.d);
}

const newSegment = (live, at, followers) => ({ gameId: live.gameId ?? null, game: live.game ?? null, startAt: at, endAt: at, peak: 0, viewerSec: 0, coveredSec: 0, samples: 0, followersStart: followers, followersEnd: null });

/** Ajoute une mesure à la session (en mémoire) : l'intervalle depuis la mesure précédente est attribué à celle-ci (chaque mesure vaut jusqu'à la suivante). */
function addSample(session, live, now, tol, cut, holdSeg) {
  const seg = session.segments.at(-1), hold = holdSeg ?? seg;   // l'intervalle écoulé appartient au jeu de la mesure précédente
  if (session.samples > 0) {
    const dt = now - session.lastAt;
    if (cut) session.cutSec += dt / 1000;   // le direct s'est vraiment arrêté un instant (coupure brève) : ces minutes ne comptent pas comme regardées
    else if (dt <= tol) {
      session.viewerSec += (session.lastViewers * dt) / 1000; session.coveredSec += dt / 1000;
      hold.viewerSec += (session.lastViewers * dt) / 1000; hold.coveredSec += dt / 1000;
    } else {
      session.gapSec += dt / 1000;
      if (!session.approx.includes("gaps")) session.approx.push("gaps");
    }
  }
  session.samples++; seg.samples++;
  session.peak = Math.max(session.peak, live.viewers); seg.peak = Math.max(seg.peak, live.viewers);
  session.lastAt = now; session.lastViewers = live.viewers; seg.endAt = now;
  session.title = live.title || session.title; session.language = live.language ?? session.language;
}

/** Ferme la session à `at` (sa dernière mesure) ; `reasons` : pourquoi elle est approximative. */
function finish(session, followersEnd, reasons) {
  const at = session.lastAt;
  session.open = false; session.endedAt = at;
  const seg = session.segments.at(-1);
  seg.endAt = at; seg.followersEnd = followersEnd;
  session.followersEnd = followersEnd;
  for (const r of reasons) if (!session.approx.includes(r)) session.approx.push(r);
}

async function saveSession(ctx, st, session) {
  if (session.docId) { await ctx.api.store.update(session.docId, strip(session)); return; }
  session.docId = await ctx.api.store.add(COLLECTIONS.sessions, strip(session));
  st.d.openId = session.docId;
}
const strip = ({ docId, ...rest }) => rest;
async function loadSession(ctx, id) {
  const row = id ? await ctx.api.store.get(id) : null;
  return row ? { ...row.data, docId: row.id } : null;
}

/** Mesure brute du jour (gardée 90 jours par défaut) : [secondes, spectateurs, numéro du jeu, followers ou null]. */
async function saveRaw(ctx, now, live, followers) {
  const day = dayOf(now);
  const row = (await ctx.api.store.list(COLLECTIONS.days, { limit: 2 })).find((r) => r.data.day === day) ?? null;
  const data = row ? row.data : { day, games: {}, points: [] };
  if (data.points.length >= MAX_DAY_POINTS) return;
  if (live.gameId && live.game) data.games[live.gameId] = live.game;
  data.points.push([Math.floor(now / 1000), live.viewers, live.gameId ?? "", followers]);
  if (row) await ctx.api.store.update(row.id, data); else await ctx.api.store.add(COLLECTIONS.days, data);
}

/** Suppression de ce qui dépasse la durée choisie (une fois par jour) ; les résumés des 3000 derniers directs au plus. */
export async function purge(ctx, now) {
  const rawCut = dayOf(now - rawDaysOf(ctx) * 86_400_000);
  for (const r of await ctx.api.store.list(COLLECTIONS.days, { limit: 800 })) if (String(r.data.day) < rawCut) await ctx.api.store.remove(r.id);
  const keepCut = now - keepYearsOf(ctx) * 365 * 86_400_000;
  const rows = await ctx.api.store.list(COLLECTIONS.sessions, { limit: MAX_SESSIONS + 200 });
  let kept = 0;
  for (const r of rows) {   // du plus récent au plus ancien
    if (r.data.open) continue;
    kept++;
    if ((r.data.endedAt ?? r.data.lastAt) < keepCut || kept > MAX_SESSIONS) await ctx.api.store.remove(r.id);
  }
}

/** « Effacer les mesures » : tout ce que l'enregistreur a gardé (état compris : le suivi repart de zéro). */
export async function eraseAll(ctx) {
  let n = 0;
  for (const col of Object.values(COLLECTIONS)) for (let guard = 0; guard < 20; guard++) {
    const rows = await ctx.api.store.list(col, { limit: 500 });
    if (!rows.length) break;
    for (const r of rows) { await ctx.api.store.remove(r.id); n++; }
  }
  return n;
}

const LISTS_EVERY = 30 * MIN;
/** Vidéos et clips avec leurs vues : une série de requêtes toutes les 30 minutes (5 minutes après une erreur), gardée ici pour que ni l'écran ni l'IA n'appellent Twitch. */
async function refreshLists(ctx, creds, now) {
  const row = await first(ctx, COLLECTIONS.lists);
  const d = row?.data ?? {};
  if (d.tryAt && now - d.tryAt < (d.error ? 5 * MIN : LISTS_EVERY) - 5_000) return;
  const [v, c] = [await helix.channelVideos(creds), await helix.channelClips(creds)];
  const keep = (fresh, old) => (fresh.error && !fresh.items.length && old ? { ...old, error: fresh.error } : fresh);
  const next = { tryAt: now, videos: keep(v, d.videos), clips: keep(c, d.clips), error: v.error ?? c.error ?? null };
  if (row) await ctx.api.store.update(row.id, next); else await ctx.api.store.add(COLLECTIONS.lists, next);
}
/** Les dernières vidéos et clips connus : { videos: { items, at, error? }, clips: {…} } ou null. */
export async function readLists(ctx) { return (await first(ctx, COLLECTIONS.lists))?.data ?? null; }

const running = new Set();
/**
 * Un passage de l'enregistreur. `now` : l'horloge (tests). Ne lève pas pour une erreur de Twitch.
 * Renvoie { status: "off" | "wait" | "busy" | "error" | "idle" | "live" | "closed", … }.
 */
export async function trackNow(ctx, creds, conn, { now = Date.now(), force = false } = {}) {
  if (ctx.setting("trackStats") !== true || !helix.valid(creds)) return { status: "off" };
  const key = ctx.instance.key;
  if (running.has(key)) return { status: "busy" };
  running.add(key);
  try {
    const st = await loadState(ctx);
    const d = st.d;
    const wait = (d.openId ? intervalOf(ctx) : IDLE_MINUTES) * MIN - 5_000;
    if (!force && now - d.lastCheckAt < wait) return { status: "wait" };
    if (now <= d.lastCheckAt) return { status: "wait" };
    if (!d.since) d.since = now;
    const prevCheck = d.lastCheckAt;
    d.lastCheckAt = now;
    const tol = toleranceMs(ctx);
    const wantsFollowers = ctx.setting("statsFollowers") !== false;
    const readFollowers = async () => {
      if (!wantsFollowers) return null;
      const r = await helix.userStat(conn, "followers", { maxAge: 30_000 });
      if (r.error || !Number.isInteger(r.value)) return null;
      d.followers = { n: r.value, at: now };
      return r.value;
    };

    const got = await helix.streamNow(creds);
    if (got.error) { d.lastError = { code: got.error, at: now }; await saveState(ctx, st); return { status: "error", error: got.error }; }
    d.lastError = null; d.lastOkAt = now;
    let open = await loadSession(ctx, d.openId);
    if (d.openId && !open) { d.openId = null; d.offChecks = 0; }
    const live = got.stream;
    let status = "idle";

    if (live) {
      if (open) {
        const gap = now - open.lastAt;
        if (gap > MAX_RESUME || (open.streamId !== live.id && d.offChecks === 0)) {
          finish(open, recentFollowers(d, open), gap > MAX_RESUME ? ["interrupted"] : []);
          await saveSession(ctx, st, open); d.openId = null; d.offChecks = 0; d.endReading = null; open = null;
        }
      }
      const resumed = !!open && d.offChecks > 0, holdSeg = open?.segments.at(-1);
      if (open) open.streamId = live.id;   // après une coupure, Twitch peut avoir donné un nouveau numéro : c'est toujours le même direct
      const changed = !!open && gameKey(open.segments.at(-1)) !== gameKey(live);
      const due = !d.followers || now - d.followers.at >= FOLLOWERS_EVERY;
      const f = !open || changed || due ? await readFollowers() : null;
      if (!open) {
        const joinedLate = Date.parse(live.startedAt) < now - tol;
        const startAt = joinedLate ? now : Math.min(now, Date.parse(live.startedAt));
        open = { open: true, streamId: live.id, startedAt: Date.parse(live.startedAt), firstAt: now, lastAt: now, lastViewers: live.viewers, endedAt: null, title: live.title, language: live.language,
          peak: 0, viewerSec: 0, coveredSec: 0, gapSec: 0, cutSec: 0, samples: 0, approx: joinedLate ? ["partial_start"] : [], followersStart: f, followersEnd: null, segments: [newSegment(live, startAt, f)] };
        d.offChecks = 0; d.endReading = null;
      } else {
        if (d.offChecks > 0) { d.offChecks = 0; d.endReading = null; }
        if (changed) {
          if (open.segments.length < MAX_SEGMENTS) {
            const seg = open.segments.at(-1);
            seg.endAt = now; seg.followersEnd = f;
            open.segments.push(newSegment(live, now, f));
          }
        }
      }
      addSample(open, live, now, tol, resumed, holdSeg);
      await saveSession(ctx, st, open);
      await saveRaw(ctx, now, live, f);
      status = "live";
    } else if (open) {
      const gap = now - open.lastAt;
      if (now - prevCheck > tol || (d.offChecks === 0 && gap > tol)) {   // le site n'a pas regardé pendant un moment (ou le dernier relevé en direct est trop ancien)
        finish(open, recentFollowers(d, open), ["interrupted"]);   // on ne sait pas quand le direct s'est arrêté : à la dernière mesure
        await saveSession(ctx, st, open); d.openId = null; d.offChecks = 0; d.endReading = null; status = "closed";
      } else {
        d.offChecks++;
        if (d.offChecks === 1) { const n = await readFollowers(); d.endReading = n == null ? null : { n, at: now }; }
        if (d.offChecks >= CLOSE_AFTER) {
          finish(open, d.endReading ? d.endReading.n : recentFollowers(d, open), []);
          await saveSession(ctx, st, open); d.openId = null; d.offChecks = 0; d.endReading = null; status = "closed";
        } else status = "live";
      }
    }

    const today = dayOf(now);
    if (d.purgedDay !== today) { await purge(ctx, now); d.purgedDay = today; }
    try { await refreshLists(ctx, creds, now); } catch { /* un plus : les vidéos ne doivent jamais empêcher la mesure des directs */ }
    await saveState(ctx, st);
    return { status };
  } finally { running.delete(key); }
}

/** Les followers connus au moment de la fin d'un direct : la dernière lecture si elle date de moins de 12 minutes avant la dernière mesure. */
const recentFollowers = (d, session) => (d.followers && d.followers.at >= session.lastAt - 12 * MIN && d.followers.at <= session.lastAt + 12 * MIN ? d.followers.n : null);

/* ───────────── Lecture : résumés ───────────── */

/** Un direct tel que les écrans et l'IA le lisent (dates ISO, durées en secondes, moyennes pondérées par le temps). */
export function summarize(s) {
  const end = s.endedAt ?? s.lastAt;
  const durationSec = Math.max(0, Math.round((end - s.startedAt) / 1000));
  const avg = s.coveredSec > 0 ? s.viewerSec / s.coveredSec : s.lastViewers ?? 0;
  const gained = s.followersStart != null && s.followersEnd != null ? s.followersEnd - s.followersStart : null;
  const segments = s.segments.map((g) => {
    const dur = Math.max(0, Math.round((g.endAt - g.startAt) / 1000));
    const gg = g.followersStart != null && g.followersEnd != null ? g.followersEnd - g.followersStart : null;
    return { gameId: g.gameId, game: g.game, startedAt: new Date(g.startAt).toISOString(), endedAt: new Date(g.endAt).toISOString(), durationSec: dur,
      avgViewers: g.coveredSec > 0 ? round1(g.viewerSec / g.coveredSec) : g.samples ? g.peak : 0, peakViewers: g.peak, viewerSeconds: Math.round(g.viewerSec), coveredSec: Math.round(g.coveredSec),
      hoursWatched: round1(g.viewerSec / 3600), followersGained: gg, followersPerHour: gg != null && dur >= MIN_RATE_SECONDS ? round1(gg / (dur / 3600)) : null };
  });
  return { id: s.docId, streamId: s.streamId, open: !!s.open, startedAt: new Date(s.startedAt).toISOString(), endedAt: s.endedAt ? new Date(s.endedAt).toISOString() : null, lastMeasureAt: new Date(s.lastAt).toISOString(),
    durationSec, currentViewers: s.lastViewers ?? 0, title: s.title, language: s.language ?? null, peakViewers: s.peak, avgViewers: round1(avg), viewerSeconds: Math.round(s.viewerSec), coveredSec: Math.round(s.coveredSec), gapSec: Math.round(s.gapSec), cutSec: Math.round(s.cutSec ?? 0),
    hoursWatched: round1(s.viewerSec / 3600), followersStart: s.followersStart, followersEnd: s.followersEnd, followersGained: gained, approximate: s.approx.length > 0, approxReasons: s.approx, samples: s.samples, segments };
}

/** Les directs commencés depuis `since` (ms), du plus récent au plus ancien : { sessions, truncated }. */
export async function listSessions(ctx, { since = 0, limit = 100 } = {}) {
  const rows = await ctx.api.store.list(COLLECTIONS.sessions, { limit: Math.min(limit, MAX_SESSIONS) + 1 });
  const out = [];
  for (const r of rows) { if (r.data.startedAt < since) continue; out.push(summarize({ ...r.data, docId: r.id })); }
  const truncated = rows.length > limit && out.length > limit;
  return { sessions: out.slice(0, limit), truncated };
}

export const trackingSince = async (ctx) => (await loadState(ctx)).d.since;
export const trackingState = async (ctx) => (await loadState(ctx)).d;

/** Les jeux d'une liste de directs : fusion des segments par jeu (moyenne pondérée, followers par heure sur les seuls segments dont les followers sont connus). */
export function gamesOf(sessions) {
  const by = new Map();
  for (const s of sessions) {
    const seen = new Set();
    for (const g of s.segments) {
      const k = g.gameId ?? g.game ?? "";
      const a = by.get(k) ?? { gameId: g.gameId, game: g.game, streams: 0, liveSec: 0, viewerSeconds: 0, coveredSec: 0, peakViewers: 0, followersGained: 0, knownSec: 0, hasFollowers: false };
      if (!seen.has(k)) { a.streams++; seen.add(k); }
      a.liveSec += g.durationSec; a.viewerSeconds += g.viewerSeconds; a.coveredSec += g.coveredSec; a.peakViewers = Math.max(a.peakViewers, g.peakViewers);
      if (g.followersGained != null) { a.followersGained += g.followersGained; a.knownSec += g.durationSec; a.hasFollowers = true; }
      if (g.game) a.game = g.game;
      by.set(k, a);
    }
  }
  return [...by.values()].map((a) => ({ gameId: a.gameId, game: a.game, streams: a.streams, hoursLive: round1(a.liveSec / 3600), avgViewers: a.coveredSec > 0 ? round1(a.viewerSeconds / a.coveredSec) : 0, peakViewers: a.peakViewers,
    hoursWatched: round1(a.viewerSeconds / 3600), followersGained: a.hasFollowers ? a.followersGained : null, followersPerHour: a.hasFollowers && a.knownSec >= 3600 ? round1(a.followersGained / (a.knownSec / 3600)) : null, liveSec: a.liveSec }));
}

/**
 * Les chiffres de synthèse sur `days` jours glissants (directs commencés dans la période). Durées en MINUTES entières (valeurs de `social.stat`).
 * followers_gained : somme des gains des directs dont les followers sont connus, jamais négative.
 */
export function periodFigures(sessions) {
  const sumSec = (f) => sessions.reduce((n, s) => n + f(s), 0);
  const covered = sumSec((s) => s.coveredSec);
  const known = sessions.filter((s) => s.followersGained != null);
  return {
    avg_viewers: covered > 0 ? Math.round(sumSec((s) => s.viewerSeconds) / covered) : Math.round(sessions.length ? sessions.reduce((m, s) => Math.max(m, s.avgViewers), 0) : 0),
    peak_viewers: sessions.reduce((m, s) => Math.max(m, s.peakViewers), 0),
    hours_streamed: Math.round(sumSec((s) => s.durationSec) / 60),
    hours_watched: Math.round(sumSec((s) => s.viewerSeconds) / 60),
    followers_gained: Math.max(0, known.reduce((n, s) => n + s.followersGained, 0)),
    sessions: sessions.length, knownFollowers: known.length,
  };
}
