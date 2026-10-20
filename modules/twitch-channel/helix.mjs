// Ce que « Ma Chaîne Twitch » demande à Twitch, et ses caches. Depuis la 2.0, ce fichier ne parle plus à Twitch lui-même : chaque appel passe par
// le Connecteur Twitch (service `twitch.api`), qui possède l'application, les autorisations et la pause partagée après « trop de demandes ».
// Aucune connaissance de Curiosa ici : on lui donne un « client » { channel, call(req), account() } (voir index.mjs), il rend des données.
// Un seul appel par chaîne et par fenêtre de cache, quel que soit le nombre de consommateurs ; aucun travail partagé n'est éternel.
export const LOGIN = /^[a-zA-Z0-9_]{3,25}$/;
export const SCOPES = { followers: "moderator:read:followers", paying: "channel:read:subscriptions" };
const CLIPS_TTL = 10 * 60_000;
const LIVE_TTL = 30_000;
const FAIL_TTL = 20_000;   // après une erreur : on ne harcèle pas Twitch à chaque affichage de page
const RATE_TTL = 60_000;   // après un 429
const STAT_TTL = 5 * 60_000;   // followers / abonnés payants : une requête par chaîne et par statistique toutes les 5 minutes
const LIST_TTL = 30 * 60_000;   // vidéos et clips (vues par vidéo) : une série de requêtes par chaîne toutes les 30 minutes
const state = { ids: new Map(), live: new Map(), clips: new Map(), stats: new Map(), inflight: new Map(), videos: new Map(), topClips: new Map(), games: new Map() };
/** Délais (ms), modifiables par les tests : `sharedMs` borne tout travail partagé par plusieurs demandes. */
export const timing = { sharedMs: 15000 };
export const resetCache = () => { for (const m of Object.values(state)) m.clear(); };
const cap = (m, max = 500) => { while (m.size > max) m.delete(m.keys().next().value); };

/** Attend `p` au plus `ms`, sinon refuse. Le minuteur est libéré dans tous les cas et ne retient pas le processus. */
export function within(p, ms) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); timer.unref?.(); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/**
 * Un travail partagé entre demandes simultanées, JAMAIS éternel : si `make` ne se termine pas dans `timing.sharedMs`, tout le monde reçoit `fallback()`
 * et l'entrée est retirée. `record` range le résultat (cache) ; un travail resté en arrière-plan qui finirait plus tard n'écrit rien.
 */
function share(k, make, fallback, record = (v) => v, ms = timing.sharedMs) {
  const pending = state.inflight.get(k);
  if (pending) return pending;
  let timer;
  const expiry = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback()), ms); timer.unref?.(); });
  const work = Promise.resolve().then(make).catch(() => fallback());
  const run = Promise.race([work, expiry]).then(record).finally(() => { clearTimeout(timer); if (state.inflight.get(k) === run) state.inflight.delete(k); });
  state.inflight.set(k, run);
  return run;
}
const NETWORK = () => ({ error: "network" });
/** La chaîne est réglée et le Connecteur Twitch est là pour faire les appels. */
export const valid = (c) => !!c && LOGIN.test(c.channel ?? "") && typeof c.call === "function";

/** Un appel « application » par le Connecteur : { json } ou { error: "config" | "auth" | "rate" | "network" }. Une réponse autre que 200 est une panne passagère. */
async function appGet(c, path, query) {
  const r = await c.call({ as: "app", method: "GET", path, query });
  if (r.error) return { error: r.error };
  if (r.status !== 200 || !r.json || typeof r.json !== "object") return { error: "network" };
  return { json: r.json };
}

const thumb = (u) => { const s = String(u ?? "").replace("{width}", "440").replace("{height}", "248"); return /^https:\/\//.test(s) ? s : null; };
/** Nom d'affichage de la chaîne (casse d'origine) : texte court, sinon rien. */
const shortName = (v) => { const s = typeof v === "string" ? v.trim() : ""; return s && s.length <= 40 ? s : null; };

async function fetchStatus(c) {
  const r = await appGet(c, "streams", { user_login: [c.channel] });
  if (r.error) return { error: r.error };
  const s = Array.isArray(r.json.data) ? r.json.data[0] : null;
  return { stream: s ? { id: String(s.id), title: String(s.title ?? ""), startedAt: s.started_at, game: String(s.game_name ?? "").trim() || null, viewers: Number.isFinite(s.viewer_count) ? s.viewer_count : null, thumbnail: thumb(s.thumbnail_url), displayName: shortName(s.user_name) } : null };
}

/**
 * État de la chaîne : { stream } (stream = null hors ligne) ou { error: "config" | "auth" | "rate" | "network" } ; ne lève jamais.
 * Succès mis en cache 30 s, erreur 20 s (60 s pour un 429) ; deux demandes simultanées partagent le même appel.
 */
export async function liveStatus(c) {
  if (!valid(c)) return { error: "config" };
  const hit = state.live.get(c.channel);
  if (hit && hit.until > Date.now()) return hit.value;
  return share(`live|${c.channel}`, () => fetchStatus(c), NETWORK, (value) => {
    state.live.set(c.channel, { value, until: Date.now() + (value.error === "rate" ? RATE_TTL : value.error ? FAIL_TTL : LIVE_TTL) });
    cap(state.live);
    return value;
  });
}

/** Le live en cours ({ id, title, startedAt, game, … }) ou null (hors ligne, Connecteur absent ou erreur). */
export const currentStream = async (c) => (await liveStatus(c)).stream ?? null;

/** Numéro Twitch de la chaîne (gardé en mémoire : il ne change pas). */
async function channelId(c) {
  const known = state.ids.get(c.channel);
  if (known) return { id: known };
  const r = await appGet(c, "users", { login: [c.channel] });
  if (r.error) return r;
  const id = Array.isArray(r.json.data) ? r.json.data[0]?.id : null;
  if (!id || !/^[0-9]{1,20}$/.test(String(id))) return { error: "network" };
  state.ids.set(c.channel, String(id));
  cap(state.ids);
  return { id: String(id) };
}

export async function recentClips(c) {
  if (!valid(c)) return [];
  const hit = state.clips.get(c.channel);
  if (hit && Date.now() - hit.at < CLIPS_TTL) return hit.items;
  const got = await share(`clips|${c.channel}`, async () => {
    const who = await channelId(c);
    if (who.error) return { error: who.error };
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const r = await appGet(c, "clips", { broadcaster_id: [who.id], started_at: [since], first: ["20"] });
    if (r.error) return { error: r.error };
    return { items: (Array.isArray(r.json.data) ? r.json.data : []).filter((x) => /^https:\/\/(clips|www)\.twitch\.tv\//.test(x.url ?? "")).map((x) => ({ title: String(x.title ?? ""), url: x.url, image: /^https:\/\//.test(x.thumbnail_url ?? "") ? x.thumbnail_url : null, publishedAt: x.created_at })) };
  }, NETWORK);
  // en cas d'erreur : les derniers connus, et pas de nouvel essai avant 20 s
  state.clips.set(c.channel, got.error ? { items: hit?.items ?? [], at: Date.now() - CLIPS_TTL + FAIL_TTL } : { items: got.items, at: Date.now() });
  cap(state.clips);
  return got.error ? hit?.items ?? [] : got.items;
}

/* ───────────── Statistiques de la chaîne (autorisation du compte, gardée par le Connecteur) ───────────── */

const STAT_PATH = { followers: "channels/followers", paying: "subscriptions" };
async function fetchUserStat(c, metric) {
  const acc = await c.account();
  if (acc.error) return { error: acc.error };
  if (!["ok", "more"].includes(acc.status) || !acc.userId || !Array.isArray(acc.scopes) || !acc.scopes.includes(SCOPES[metric])) return { error: "auth" };
  const r = await c.call({ as: "user", slot: "main", method: "GET", path: STAT_PATH[metric], query: { broadcaster_id: [acc.userId], first: ["1"] } });
  if (r.error) return { error: ["rate", "network", "config"].includes(r.error) ? r.error : "auth" };
  if (metric === "paying" && (r.status === 403 || r.status === 400)) return { error: "config", reason: "affiliate" };   // pas affilié ni partenaire
  if (r.status === 403) return { error: "auth" };
  if (r.status !== 200) return { error: "network" };
  const total = r.json?.total;
  return Number.isInteger(total) && total >= 0 ? { value: total } : { error: "network" };
}

/**
 * Une statistique de la chaîne : { value, at } ou { error: "auth" | "rate" | "network" | "config", reason?, at } ; `at` : quand Twitch a répondu ; ne lève jamais, ne rend JAMAIS une valeur périmée.
 * `metric` : "followers" | "paying". Une requête par chaîne et par statistique (5 min ; 20 s après une erreur, 60 s après un « trop de requêtes »).
 */
export async function userStat(c, metric, { maxAge } = {}) {
  if (!valid(c)) return { error: "config", reason: "credentials" };
  const k = `${c.channel}|${metric}`;
  let hit = state.stats.get(k);
  // un refus « auth » gardé en cache ne survit pas à une connexion faite depuis (par exemple sur la page du Connecteur) : on demande l'état, sans réseau
  if (hit && hit.until > Date.now() && hit.value.error === "auth") {
    const acc = await c.account();
    if (acc.status === "ok" && Date.parse(acc.connectedAt ?? "") >= hit.value.at - 1000) { state.stats.delete(k); hit = null; }
  }
  if (hit && hit.until > Date.now() && (maxAge == null || Date.now() - hit.value.at <= maxAge)) return hit.value;   // maxAge : l'enregistreur de directs veut un chiffre récent
  return share(`stat|${k}`, () => fetchUserStat(c, metric), NETWORK, (found) => {
    const value = { ...found, at: Date.now() };
    state.stats.set(k, { value, until: Date.now() + (value.error === "rate" ? RATE_TTL : value.error ? FAIL_TTL : STAT_TTL) });
    cap(state.stats);
    return value;
  });
}
/** À appeler quand la connexion change (connexion, déconnexion) : les anciennes réponses ne servent plus. */
export const forgetStats = (channel) => { for (const k of [...state.stats.keys()]) if (!channel || k.startsWith(`${channel}|`)) state.stats.delete(k); };

/* ───────────── Directs, vidéos et clips : l'enregistreur de directs et « vues par vidéo » ───────────── */

/**
 * L'état EXACT de la chaîne pour l'enregistreur (jamais servi par le cache de 30 s) :
 * { stream: { id, title, startedAt, game, gameId, viewers, language } } | { stream: null } (hors ligne) | { error }. Une réponse sans nombre de spectateurs valide est une erreur, pas un zéro.
 */
export async function streamNow(c) {
  if (!valid(c)) return { error: "config" };
  const who = await channelId(c);
  if (who.error) return who;
  const r = await appGet(c, "streams", { user_id: [who.id], first: ["1"] });
  if (r.error) return r;
  const data = Array.isArray(r.json.data) ? r.json.data : [];
  const s = data.find((x) => x.type === "live") ?? data[0];
  if (!s) return { stream: null };
  if (!Number.isInteger(s.viewer_count) || s.viewer_count < 0 || !s.started_at || !Number.isFinite(Date.parse(s.started_at))) return { error: "network" };
  return { stream: { id: String(s.id), title: String(s.title ?? "").slice(0, 140), startedAt: s.started_at, game: String(s.game_name ?? "").trim().slice(0, 100) || null, gameId: String(s.game_id ?? "") || null, viewers: s.viewer_count, language: /^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(s.language ?? "") ? s.language : null } };
}

const SEC = (d) => { const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(String(d ?? "")); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : null; };
const TYPES = new Set(["archive", "highlight", "upload"]);
export const MAX_VIDEOS = 300, MAX_CLIPS = 100;

/** Les vidéos de la chaîne (rediffusions, temps forts, mises en ligne) avec leurs vues : { items, at, error? }. Trois pages de 100 au plus ; 30 minutes de cache ; en cas d'erreur, les dernières vidéos connues et leur date. */
export async function channelVideos(c) {
  if (!valid(c)) return { items: [], at: null, error: "config" };
  const hit = state.videos.get(c.channel);
  if (hit && hit.until > Date.now()) return hit.value;
  const prev = hit?.value;
  const failed = (error) => ({ items: prev?.items ?? [], at: prev?.at ?? null, error });
  return share(`videos|${c.channel}`, async () => {
    const who = await channelId(c);
    let error = who.error, items = [];
    if (!error) {
      let after = "";
      for (let page = 0; page < MAX_VIDEOS / 100 && items.length < MAX_VIDEOS; page++) {
        const r = await appGet(c, "videos", { user_id: [who.id], first: ["100"], ...(after ? { after: [after] } : {}) });
        if (r.error) { error = r.error; break; }
        for (const x of Array.isArray(r.json.data) ? r.json.data : []) {
          if (items.length >= MAX_VIDEOS) break;
          if (!TYPES.has(x.type) || !/^https:\/\/(www\.)?twitch\.tv\//.test(x.url ?? "") || !Number.isInteger(x.view_count) || x.view_count < 0) continue;
          items.push({ id: String(x.id), title: String(x.title ?? "").slice(0, 140), publishedAt: x.published_at ?? x.created_at, durationSec: SEC(x.duration), views: x.view_count, type: x.type, url: x.url });
        }
        after = typeof r.json.pagination?.cursor === "string" ? r.json.pagination.cursor : "";
        if (!after) break;
      }
    }
    return error ? failed(error) : { items, at: Date.now() };
  }, () => failed("network"), (value) => {
    state.videos.set(c.channel, { value, until: Date.now() + (value.error === "rate" ? RATE_TTL : value.error ? FAIL_TTL : LIST_TTL) });
    cap(state.videos);
    return value;
  }, timing.sharedMs * 3);   // jusqu'à trois pages de 100 : un peu plus de temps, mais une borne quand même (tâche de fond, pas une page)
}

/** Noms de jeux à partir de leurs numéros (un appel pour tous les inconnus, 100 au plus). */
async function gameNames(c, ids) {
  const unknown = [...new Set(ids.filter((i) => /^[0-9]{1,20}$/.test(i) && !state.games.has(i)))].slice(0, 100);
  if (unknown.length) {
    const r = await appGet(c, "games", { id: unknown });
    if (!r.error) for (const g of Array.isArray(r.json.data) ? r.json.data : []) state.games.set(String(g.id), String(g.name ?? "").slice(0, 100));
    cap(state.games, 2000);
  }
  return (id) => state.games.get(id) ?? null;
}

/** Les clips les plus regardés de la chaîne (100 au plus, une page) : { items, at, error? }, 30 minutes de cache. */
export async function channelClips(c) {
  if (!valid(c)) return { items: [], at: null, error: "config" };
  const hit = state.topClips.get(c.channel);
  if (hit && hit.until > Date.now()) return hit.value;
  const prev = hit?.value;
  const failed = (error) => ({ items: prev?.items ?? [], at: prev?.at ?? null, error });
  return share(`topclips|${c.channel}`, async () => {
    const who = await channelId(c);
    let error = who.error, items = [];
    if (!error) {
      const r = await appGet(c, "clips", { broadcaster_id: [who.id], first: [String(MAX_CLIPS)] });
      if (r.error) error = r.error;
      else {
        const raw = (Array.isArray(r.json.data) ? r.json.data : []).filter((x) => /^https:\/\/(clips|www)\.twitch\.tv\//.test(x.url ?? "") && Number.isInteger(x.view_count) && x.view_count >= 0).slice(0, MAX_CLIPS);
        const name = await gameNames(c, raw.map((x) => String(x.game_id ?? "")));
        items = raw.map((x) => ({ id: String(x.id ?? x.url), title: String(x.title ?? "").slice(0, 140), publishedAt: x.created_at, views: x.view_count, game: name(String(x.game_id ?? "")), url: x.url, durationSec: Number.isFinite(x.duration) ? Math.round(x.duration) : null }));
      }
    }
    return error ? failed(error) : { items, at: Date.now() };
  }, () => failed("network"), (value) => {
    state.topClips.set(c.channel, { value, until: Date.now() + (value.error === "rate" ? RATE_TTL : value.error ? FAIL_TTL : LIST_TTL) });
    cap(state.topClips);
    return value;
  });
}
