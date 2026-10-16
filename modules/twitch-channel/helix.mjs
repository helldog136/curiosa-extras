// Client de l'API Twitch (Helix) — le SEUL endroit de Curiosa qui parle à Twitch : jeton d'application, appels, caches, quotas.
// Aucune connaissance de Curiosa ici (ni ctx, ni réglages) : on lui donne des identifiants { channel, clientId, secret }, il rend des données.
// Un seul jeton par couple d'identifiants, un seul appel par chaîne et par fenêtre de cache, quel que soit le nombre de consommateurs.
export const LOGIN = /^[a-zA-Z0-9_]{3,25}$/;
const CLIPS_TTL = 10 * 60_000;
const LIVE_TTL = 30_000;
const FAIL_TTL = 20_000;   // après une erreur : on ne harcèle pas Twitch à chaque affichage de page
const RATE_TTL = 60_000;   // après un 429
const STAT_TTL = 5 * 60_000;   // followers / abonnés payants : une requête par chaîne et par statistique toutes les 5 minutes
const LIST_TTL = 30 * 60_000;   // vidéos et clips (vues par vidéo) : une série de requêtes par chaîne toutes les 30 minutes
const state = { tokens: new Map(), ids: new Map(), live: new Map(), clips: new Map(), stats: new Map(), inflight: new Map(), backoff: new Map(), videos: new Map(), topClips: new Map(), games: new Map() };
// Le fichier voisin est importé avec la même « version » que celui-ci (jamais d'ancien oauth.mjs resté en mémoire après une mise à jour).
const oauth = await import(new URL(`./oauth.mjs${new URL(import.meta.url).search}`, import.meta.url).href);
export const { SCOPES } = oauth;
export const resetCache = () => { for (const m of Object.values(state)) m.clear(); };

const get = (url, init = {}) => fetch(url, { signal: AbortSignal.timeout(5000), ...init });
export const hasCredentials = (c) => !!(c.clientId && c.secret);
export const valid = (c) => LOGIN.test(c.channel) && hasCredentials(c);
const tokenKey = (c) => `${c.clientId}|${c.secret}`;
const headers = (c, t) => ({ "Client-Id": c.clientId, Authorization: `Bearer ${t}` });

/** Jeton d'application. Renvoie { token } ou { error: "auth" | "rate" | "network" }. Deux chaînes aux mêmes identifiants, demandées en même temps, partagent la même demande. */
async function token(c) {
  const known = state.tokens.get(tokenKey(c));
  if (known && known.expiresAt > Date.now()) return { token: known.value };
  const k = `token|${tokenKey(c)}`;
  const pending = state.inflight.get(k);
  if (pending) return pending;
  const run = fetchToken(c).finally(() => state.inflight.delete(k));
  state.inflight.set(k, run);
  return run;
}
async function fetchToken(c) {
  try {
    const res = await get("https://id.twitch.tv/oauth2/token", { method: "POST", body: new URLSearchParams({ client_id: c.clientId, client_secret: c.secret, grant_type: "client_credentials" }) });
    if (res.status === 429) return { error: "rate" };
    if (!res.ok) return { error: "auth" };
    const json = await res.json();
    if (!json.access_token) return { error: "auth" };
    state.tokens.set(tokenKey(c), { value: json.access_token, expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000 });
    return { token: json.access_token };
  } catch { return { error: "network" }; }
}

const thumb = (u) => { const s = String(u ?? "").replace("{width}", "440").replace("{height}", "248"); return /^https:\/\//.test(s) ? s : null; };

/** Nom d'affichage de la chaîne (casse d'origine) : texte court, sinon rien. */
const shortName = (v) => { const s = typeof v === "string" ? v.trim() : ""; return s && s.length <= 40 ? s : null; };

async function fetchStatus(c) {
  const t = await token(c);
  if (t.error) return { error: t.error };
  try {
    const res = await get(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(c.channel)}`, { headers: headers(c, t.token) });
    if (res.status === 401) { state.tokens.delete(tokenKey(c)); return { error: "auth" }; }
    if (res.status === 429) return { error: "rate" };
    if (!res.ok) return { error: "network" };
    const s = (await res.json()).data?.[0];
    return { stream: s ? { id: String(s.id), title: String(s.title ?? ""), startedAt: s.started_at, game: s.game_name?.trim() || null, viewers: Number.isFinite(s.viewer_count) ? s.viewer_count : null, thumbnail: thumb(s.thumbnail_url), displayName: shortName(s.user_name) } : null };
  } catch { return { error: "network" }; }
}

/**
 * État de la chaîne : { stream } (stream = null hors ligne) ou { error: "auth" | "rate" | "network" } ; ne lève jamais.
 * Succès mis en cache 30 s, erreur 20 s (60 s pour un 429) ; deux demandes simultanées partagent le même appel.
 */
export async function liveStatus(c) {
  if (!valid(c)) return { error: "config" };
  const hit = state.live.get(c.channel);
  if (hit && hit.until > Date.now()) return hit.value;
  const pending = state.inflight.get(c.channel);
  if (pending) return pending;
  const run = fetchStatus(c).then((value) => {
    state.live.set(c.channel, { value, until: Date.now() + (value.error === "rate" ? RATE_TTL : value.error ? FAIL_TTL : LIVE_TTL) });
    return value;
  }).finally(() => state.inflight.delete(c.channel));
  state.inflight.set(c.channel, run);
  return run;
}

/** Le live en cours ({ id, title, startedAt, game, … }) ou null (hors ligne, identifiants invalides ou erreur). */
export const currentStream = async (c) => (await liveStatus(c)).stream ?? null;

export async function recentClips(c) {
  if (!valid(c)) return [];
  const hit = state.clips.get(c.channel);
  if (hit && Date.now() - hit.at < CLIPS_TTL) return hit.items;
  const t = await token(c);
  if (t.error) return hit?.items ?? [];
  try {
    let id = state.ids.get(c.channel);
    if (!id) {
      const u = await get(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(c.channel)}`, { headers: headers(c, t.token) });
      id = u.ok ? (await u.json()).data?.[0]?.id : null;
      if (!id) return hit?.items ?? [];
      state.ids.set(c.channel, id);
    }
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const res = await get(`https://api.twitch.tv/helix/clips?broadcaster_id=${encodeURIComponent(id)}&started_at=${encodeURIComponent(since)}&first=20`, { headers: headers(c, t.token) });
    if (!res.ok) return hit?.items ?? [];
    const items = ((await res.json()).data ?? []).filter((x) => /^https:\/\/(clips|www)\.twitch\.tv\//.test(x.url ?? "")).map((x) => ({ title: String(x.title ?? ""), url: x.url, image: /^https:\/\//.test(x.thumbnail_url ?? "") ? x.thumbnail_url : null, publishedAt: x.created_at }));
    state.clips.set(c.channel, { items, at: Date.now() });
    return items;
  } catch { return hit?.items ?? []; }
}

/* ───────────── Statistiques de la chaîne (jeton d'UTILISATEUR, obtenu par la connexion du compte) ───────────── */

/**
 * `conn` : { key (instance), channel, clientId, secret, load(), save(doc) } — `load` rend le document de connexion ({ access, refresh, expiresAt, scopes, userId, clientId, status }) ou null,
 * `save` le remplace. Ce fichier ne sait pas où il est gardé (c'est le stockage privé de l'instance, voir connect.mjs) et n'écrit jamais un jeton ailleurs.
 */
async function userToken(conn, usedAccess) {
  const doc = await conn.load();
  if (!doc || !doc.access || doc.status === "reconnect" || doc.clientId !== conn.clientId) return { error: "auth" };
  if (usedAccess ? doc.access !== usedAccess : doc.expiresAt - Date.now() > 120_000) return { token: doc.access, doc };   // encore valable (ou déjà renouvelé par un autre appel)
  const k = `refresh|${conn.key}`;   // renouvellement fusionné : tous les appels simultanés d'une instance attendent le même
  let run = state.inflight.get(k);
  if (!run) { run = renewTokens(conn, usedAccess).finally(() => state.inflight.delete(k)); state.inflight.set(k, run); }
  return run;
}
async function renewTokens(conn, usedAccess) {
  const doc = await conn.load();
  if (!doc) return { error: "auth" };
  if (usedAccess && doc.access !== usedAccess) return { token: doc.access, doc };
  const r = await oauth.refreshTokens({ clientId: conn.clientId, secret: conn.secret, refresh: doc.refresh });
  if (r.error === "invalid") { await conn.save({ ...doc, status: "reconnect" }); return { error: "auth" }; }   // Twitch ne reconnaît plus l'autorisation : il faut reconnecter
  if (r.error) return { error: r.error };
  const next = { ...doc, access: r.tokens.access, refresh: r.tokens.refresh, expiresAt: r.tokens.expiresAt, status: "ok" };
  await conn.save(next);
  return { token: next.access, doc: next };
}

const STAT_PATH = { followers: "channels/followers", paying: "subscriptions" };
async function fetchUserStat(conn, metric) {
  let t = await userToken(conn);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (t.error) return { error: t.error };
    if (!Array.isArray(t.doc.scopes) || !t.doc.scopes.includes(oauth.SCOPES[metric])) return { error: "auth" };
    const res = await get(`https://api.twitch.tv/helix/${STAT_PATH[metric]}?broadcaster_id=${encodeURIComponent(t.doc.userId)}&first=1`, { headers: headers(conn, t.token) });
    if (res.status === 401) {
      if (attempt === 0) { t = await userToken(conn, t.token); continue; }   // une seule nouvelle tentative, après renouvellement
      await conn.save({ ...t.doc, status: "reconnect" });
      return { error: "auth" };
    }
    if (res.status === 429) return { error: "rate" };
    if (metric === "paying" && (res.status === 403 || res.status === 400)) return { error: "config", reason: "affiliate" };   // pas affilié ni partenaire
    if (res.status === 403) return { error: "auth" };
    if (!res.ok) return { error: "network" };
    const total = (await res.json()).total;
    return Number.isInteger(total) && total >= 0 ? { value: total } : { error: "network" };
  }
  return { error: "auth" };
}

/**
 * Une statistique de la chaîne : { value, at } ou { error: "auth" | "rate" | "network" | "config", reason?, at } ; `at` : quand Twitch a répondu ; ne lève jamais, ne rend JAMAIS une valeur périmée.
 * `metric` : "followers" | "paying". Une requête par chaîne et par statistique (5 min ; 20 s après une erreur, 60 s après un « trop de requêtes »).
 */
export async function userStat(conn, metric, { maxAge } = {}) {
  if (!valid(conn)) return { error: "config", reason: "credentials" };
  const k = `${conn.channel}|${metric}`;
  const hit = state.stats.get(k);
  if (hit && hit.until > Date.now() && (maxAge == null || Date.now() - hit.value.at <= maxAge)) return hit.value;   // maxAge : l'enregistreur de directs veut un chiffre récent, pas celui d'il y a 5 minutes
  const pending = state.inflight.get(`stat|${k}`);
  if (pending) return pending;
  const run = fetchUserStat(conn, metric).catch(() => ({ error: "network" })).then((found) => {
    const value = { ...found, at: Date.now() };
    state.stats.set(k, { value, until: Date.now() + (value.error === "rate" ? RATE_TTL : value.error ? FAIL_TTL : STAT_TTL) });
    return value;
  }).finally(() => state.inflight.delete(`stat|${k}`));
  state.inflight.set(`stat|${k}`, run);
  return run;
}
/** À appeler quand la connexion change (connexion, déconnexion) : les anciennes réponses ne servent plus. */
export const forgetStats = (channel) => { for (const k of [...state.stats.keys()]) if (!channel || k.startsWith(`${channel}|`)) state.stats.delete(k); };

/* ───────────── Directs, vidéos et clips (jeton d'APPLICATION) : l'enregistreur de directs et « vues par vidéo » ───────────── */

/** Un appel Helix avec le jeton d'application : { json } ou { error: "config" | "auth" | "rate" | "network" }. Un 401 renouvelle le jeton une fois ; un 429 suspend TOUS les appels de cette application 60 s. */
async function appGet(c, pathAndQuery) {
  if (!valid(c)) return { error: "config" };
  if ((state.backoff.get(tokenKey(c)) ?? 0) > Date.now()) return { error: "rate" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await token(c);
    if (t.error) { if (t.error === "rate") state.backoff.set(tokenKey(c), Date.now() + RATE_TTL); return { error: t.error }; }
    try {
      const res = await get(`https://api.twitch.tv/helix/${pathAndQuery}`, { headers: headers(c, t.token) });
      if (res.status === 401) { state.tokens.delete(tokenKey(c)); if (attempt === 0) continue; return { error: "auth" }; }
      if (res.status === 429) { state.backoff.set(tokenKey(c), Date.now() + RATE_TTL); return { error: "rate" }; }
      if (!res.ok) return { error: "network" };
      return { json: await res.json() };
    } catch { return { error: "network" }; }
  }
  return { error: "auth" };
}

/* ───────────── Appels généraux, pour le service `twitch.api` (le module ne laisse JAMAIS un jeton sortir : il fait l'appel lui-même) ───────────── */

const API = "https://api.twitch.tv/helix/";
const readJson = async (res) => { try { return await res.json(); } catch { return null; } };
function target(path, query) {
  const u = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) for (const x of [].concat(v)) u.searchParams.append(k, String(x));
  return u.href;
}
const init = (c, tokenValue, { method, body }) => ({ method, headers: { ...headers(c, tokenValue), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const answer = async (res) => (res.status >= 500 ? { error: "network" } : { status: res.status, json: await readJson(res) });

/**
 * Un appel Helix avec le jeton d'APPLICATION : { status, json } (Twitch a répondu, y compris 4xx : à l'appelant d'interpréter) ou { error: "config" | "auth" | "rate" | "network" }.
 * Un 401 renouvelle le jeton une fois ; un 429 suspend tous les appels de cette application 60 s.
 */
export async function appCall(c, req) {
  if (!valid(c)) return { error: "config" };
  if ((state.backoff.get(tokenKey(c)) ?? 0) > Date.now()) return { error: "rate" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await token(c);
    if (t.error) { if (t.error === "rate") state.backoff.set(tokenKey(c), Date.now() + RATE_TTL); return { error: t.error }; }
    try {
      const res = await get(target(req.path, req.query), init(c, t.token, req));
      if (res.status === 401) { state.tokens.delete(tokenKey(c)); if (attempt === 0) continue; return { error: "auth" }; }
      if (res.status === 429) { state.backoff.set(tokenKey(c), Date.now() + RATE_TTL); return { error: "rate" }; }
      return await answer(res);
    } catch { return { error: "network" }; }
  }
  return { error: "auth" };
}

/**
 * Un appel Helix avec le jeton d'UTILISATEUR de la connexion `conn` (voir userToken) : même forme que appCall, plus { error: "scope" } si l'autorisation donnée ne couvre pas `req.scopes`.
 * Un 401 renouvelle le jeton une fois, puis demande de reconnecter ; un 429 n'est pas retenté (l'appelant a sa propre cadence).
 */
export async function userCall(conn, req) {
  if (!hasCredentials(conn)) return { error: "config" };
  let t = await userToken(conn);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (t.error) return { error: t.error };
    if ((req.scopes ?? []).some((s) => !Array.isArray(t.doc.scopes) || !t.doc.scopes.includes(s))) return { error: "scope" };
    try {
      const res = await get(target(req.path, req.query), init(conn, t.token, req));
      if (res.status === 401) {
        if (attempt === 0) { t = await userToken(conn, t.token); continue; }
        await conn.save({ ...t.doc, status: "reconnect" });
        return { error: "auth" };
      }
      if (res.status === 429) return { error: "rate" };
      return await answer(res);
    } catch { return { error: "network" }; }
  }
  return { error: "auth" };
}

/** Numéro Twitch de la chaîne (gardé en mémoire : il ne change pas). */
async function channelId(c) {
  const known = state.ids.get(c.channel);
  if (known) return { id: known };
  const r = await appGet(c, `users?login=${encodeURIComponent(c.channel)}`);
  if (r.error) return r;
  const id = r.json.data?.[0]?.id;
  if (!id) return { error: "network" };
  state.ids.set(c.channel, String(id));
  return { id: String(id) };
}

/**
 * L'état EXACT de la chaîne pour l'enregistreur (jamais servi par le cache de 30 s) :
 * { stream: { id, title, startedAt, game, gameId, viewers, language } } | { stream: null } (hors ligne) | { error }. Une réponse sans nombre de spectateurs valide est une erreur, pas un zéro.
 */
export async function streamNow(c) {
  const who = await channelId(c);
  if (who.error) return who;
  const r = await appGet(c, `streams?user_id=${encodeURIComponent(who.id)}&first=1`);
  if (r.error) return r;
  const s = r.json.data?.find((x) => x.type === "live") ?? r.json.data?.[0];
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
  const k = `videos|${c.channel}`;
  if (state.inflight.has(k)) return state.inflight.get(k);
  const run = (async () => {
    const who = await channelId(c);
    let error = who.error, items = [];
    if (!error) {
      let after = "";
      for (let page = 0; page < MAX_VIDEOS / 100 && items.length < MAX_VIDEOS; page++) {
        const r = await appGet(c, `videos?user_id=${encodeURIComponent(who.id)}&first=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
        if (r.error) { error = r.error; break; }
        for (const x of r.json.data ?? []) {
          if (items.length >= MAX_VIDEOS) break;
          if (!TYPES.has(x.type) || !/^https:\/\/(www\.)?twitch\.tv\//.test(x.url ?? "") || !Number.isInteger(x.view_count) || x.view_count < 0) continue;
          items.push({ id: String(x.id), title: String(x.title ?? "").slice(0, 140), publishedAt: x.published_at ?? x.created_at, durationSec: SEC(x.duration), views: x.view_count, type: x.type, url: x.url });
        }
        after = r.json.pagination?.cursor ?? "";
        if (!after) break;
      }
    }
    const prev = hit?.value;
    const value = error ? { items: prev?.items ?? [], at: prev?.at ?? null, error } : { items, at: Date.now() };
    state.videos.set(c.channel, { value, until: Date.now() + (error === "rate" ? RATE_TTL : error ? FAIL_TTL : LIST_TTL) });
    return value;
  })().finally(() => state.inflight.delete(k));
  state.inflight.set(k, run);
  return run;
}

/** Noms de jeux à partir de leurs numéros (un appel pour tous les inconnus, 100 au plus). */
async function gameNames(c, ids) {
  const unknown = [...new Set(ids.filter((i) => i && !state.games.has(i)))].slice(0, 100);
  if (unknown.length) {
    const r = await appGet(c, `games?${unknown.map((i) => `id=${encodeURIComponent(i)}`).join("&")}`);
    if (!r.error) for (const g of r.json.data ?? []) state.games.set(String(g.id), String(g.name ?? "").slice(0, 100));
  }
  return (id) => state.games.get(id) ?? null;
}

/** Les clips les plus regardés de la chaîne (100 au plus, une page) : { items, at, error? }, 30 minutes de cache. */
export async function channelClips(c) {
  if (!valid(c)) return { items: [], at: null, error: "config" };
  const hit = state.topClips.get(c.channel);
  if (hit && hit.until > Date.now()) return hit.value;
  const k = `topclips|${c.channel}`;
  if (state.inflight.has(k)) return state.inflight.get(k);
  const run = (async () => {
    const who = await channelId(c);
    let error = who.error, items = [];
    if (!error) {
      const r = await appGet(c, `clips?broadcaster_id=${encodeURIComponent(who.id)}&first=${MAX_CLIPS}`);
      if (r.error) error = r.error;
      else {
        const raw = (r.json.data ?? []).filter((x) => /^https:\/\/(clips|www)\.twitch\.tv\//.test(x.url ?? "") && Number.isInteger(x.view_count) && x.view_count >= 0).slice(0, MAX_CLIPS);
        const name = await gameNames(c, raw.map((x) => String(x.game_id ?? "")));
        items = raw.map((x) => ({ id: String(x.id ?? x.url), title: String(x.title ?? "").slice(0, 140), publishedAt: x.created_at, views: x.view_count, game: name(String(x.game_id ?? "")), url: x.url, durationSec: Number.isFinite(x.duration) ? Math.round(x.duration) : null }));
      }
    }
    const prev = hit?.value;
    const value = error ? { items: prev?.items ?? [], at: prev?.at ?? null, error } : { items, at: Date.now() };
    state.topClips.set(c.channel, { value, until: Date.now() + (error === "rate" ? RATE_TTL : error ? FAIL_TTL : LIST_TTL) });
    return value;
  })().finally(() => state.inflight.delete(k));
  state.inflight.set(k, run);
  return run;
}
