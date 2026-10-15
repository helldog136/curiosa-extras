// Client de l'API Twitch (Helix) — le SEUL endroit de Curiosa qui parle à Twitch : jeton d'application, appels, caches, quotas.
// Aucune connaissance de Curiosa ici (ni ctx, ni réglages) : on lui donne des identifiants { channel, clientId, secret }, il rend des données.
// Un seul jeton par couple d'identifiants, un seul appel par chaîne et par fenêtre de cache, quel que soit le nombre de consommateurs.
export const LOGIN = /^[a-zA-Z0-9_]{3,25}$/;
const CLIPS_TTL = 10 * 60_000;
const LIVE_TTL = 30_000;
const FAIL_TTL = 20_000;   // après une erreur : on ne harcèle pas Twitch à chaque affichage de page
const RATE_TTL = 60_000;   // après un 429
const STAT_TTL = 5 * 60_000;   // followers / abonnés payants : une requête par chaîne et par statistique toutes les 5 minutes
const state = { tokens: new Map(), ids: new Map(), live: new Map(), clips: new Map(), stats: new Map(), inflight: new Map() };
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
export async function userStat(conn, metric) {
  if (!valid(conn)) return { error: "config", reason: "credentials" };
  const k = `${conn.channel}|${metric}`;
  const hit = state.stats.get(k);
  if (hit && hit.until > Date.now()) return hit.value;
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
