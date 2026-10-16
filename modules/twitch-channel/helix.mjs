// Client de l'API Twitch (Helix) — le SEUL endroit de Curiosa qui parle à Twitch : jeton d'application, appels, caches, quotas.
// Aucune connaissance de Curiosa ici (ni ctx, ni réglages) : on lui donne des identifiants { channel, clientId, secret }, il rend des données.
// Un seul jeton par couple d'identifiants, un seul appel par chaîne et par fenêtre de cache, quel que soit le nombre de consommateurs.
export const LOGIN = /^[a-zA-Z0-9_]{3,25}$/;
const CLIPS_TTL = 10 * 60_000;
const LIVE_TTL = 30_000;
const FAIL_TTL = 20_000;   // après une erreur : on ne harcèle pas Twitch à chaque affichage de page
const RATE_TTL = 60_000;   // après un 429
const SCHEDULE_TTL = 5 * 60_000;   // le planning de diffusion change rarement
const SCHEDULE_PAGES = 4;          // 25 segments par page : 100 au plus, jamais de boucle sur la pagination
const state = { tokens: new Map(), ids: new Map(), live: new Map(), clips: new Map(), schedule: new Map(), inflight: new Map() };
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

/** Identifiant numérique de la chaîne (mis en cache). Renvoie { id } ou { error: "auth" | "rate" | "network" }. Peut lever (réseau) : l'appelant a son try/catch. */
async function broadcasterId(c, tokenValue) {
  const known = state.ids.get(c.channel);
  if (known) return { id: known };
  const u = await get(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(c.channel)}`, { headers: headers(c, tokenValue) });
  if (u.status === 401) { state.tokens.delete(tokenKey(c)); return { error: "auth" }; }
  if (u.status === 429) return { error: "rate" };
  if (!u.ok) return { error: "network" };
  const id = (await u.json()).data?.[0]?.id;
  if (!id) return { error: "network" };
  state.ids.set(c.channel, id);
  return { id };
}

export async function recentClips(c) {
  if (!valid(c)) return [];
  const hit = state.clips.get(c.channel);
  if (hit && Date.now() - hit.at < CLIPS_TTL) return hit.items;
  const t = await token(c);
  if (t.error) return hit?.items ?? [];
  try {
    const b = await broadcasterId(c, t.token);
    if (!b.id) return hit?.items ?? [];
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const res = await get(`https://api.twitch.tv/helix/clips?broadcaster_id=${encodeURIComponent(b.id)}&started_at=${encodeURIComponent(since)}&first=20`, { headers: headers(c, t.token) });
    if (!res.ok) return hit?.items ?? [];
    const items = ((await res.json()).data ?? []).filter((x) => /^https:\/\/(clips|www)\.twitch\.tv\//.test(x.url ?? "")).map((x) => ({ title: String(x.title ?? ""), url: x.url, image: /^https:\/\//.test(x.thumbnail_url ?? "") ? x.thumbnail_url : null, publishedAt: x.created_at }));
    state.clips.set(c.channel, { items, at: Date.now() });
    return items;
  } catch { return hit?.items ?? []; }
}

/** Un segment du planning de diffusion Twitch -> forme neutre. Un segment sans début lisible est écarté. */
const segmentOf = (s) => {
  const start = Date.parse(s?.start_time);
  if (!Number.isFinite(start)) return null;
  const end = s.end_time ? Date.parse(s.end_time) : NaN;
  return { id: String(s.id ?? start), start: new Date(start).toISOString(), end: Number.isFinite(end) && end > start ? new Date(end).toISOString() : null, title: String(s.title ?? "").trim().slice(0, 200), category: typeof s.category?.name === "string" && s.category.name.trim() ? s.category.name.trim().slice(0, 100) : null, recurring: !!s.is_recurring, canceled: !!s.canceled_until };
};

async function fetchSchedule(c) {
  const t = await token(c);
  if (t.error) return { error: t.error };
  try {
    const b = await broadcasterId(c, t.token);
    if (!b.id) return { error: b.error ?? "network" };
    // Twitch ne rend que les segments qui COMMENCENT après `start_time` : on remonte un peu pour garder un stream déjà en cours.
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const segments = [];
    let displayName = null, after = "";
    for (let page = 0; page < SCHEDULE_PAGES; page++) {
      const res = await get(`https://api.twitch.tv/helix/schedule?broadcaster_id=${encodeURIComponent(b.id)}&first=25&start_time=${encodeURIComponent(since)}${after ? `&after=${encodeURIComponent(after)}` : ""}`, { headers: headers(c, t.token) });
      if (res.status === 404) break;   // « cette chaîne n'a pas de planning » : une liste vide, pas une erreur
      if (res.status === 401) { state.tokens.delete(tokenKey(c)); return { error: "auth" }; }
      if (res.status === 429) return { error: "rate" };
      if (!res.ok) return { error: "network" };
      const json = await res.json();
      displayName ??= shortName(json.data?.broadcaster_name);
      for (const s of Array.isArray(json.data?.segments) ? json.data.segments : []) { const seg = segmentOf(s); if (seg) segments.push(seg); }
      after = typeof json.pagination?.cursor === "string" ? json.pagination.cursor : "";
      if (!after) break;
    }
    return { segments, displayName };
  } catch { return { error: "network" }; }
}

/**
 * Planning de diffusion de la chaîne : { segments: [{ id, start, end, title, category, recurring, canceled }], displayName } ou
 * { error: "auth" | "rate" | "network" | "config" } ; ne lève jamais. Une chaîne sans planning donne une liste vide.
 * UNE requête par chaîne : succès gardé 5 min, erreur 20 s (60 s après un « trop de requêtes »), demandes simultanées groupées.
 */
export async function schedule(c) {
  if (!valid(c)) return { error: "config" };
  const hit = state.schedule.get(c.channel);
  if (hit && hit.until > Date.now()) return hit.value;
  const k = `schedule|${c.channel}`;
  const pending = state.inflight.get(k);
  if (pending) return pending;
  const run = fetchSchedule(c).then((value) => {
    state.schedule.set(c.channel, { value, until: Date.now() + (value.error === "rate" ? RATE_TTL : value.error ? FAIL_TTL : SCHEDULE_TTL) });
    return value;
  }).finally(() => state.inflight.delete(k));
  state.inflight.set(k, run);
  return run;
}

/** Ce que l'on sait SANS appel réseau du dernier planning lu : { state: "unknown" | "ok" | "error", error?, displayName? }. */
export function scheduleStatus(c) {
  const v = state.schedule.get(c.channel)?.value;
  if (!v) return { state: "unknown" };
  return v.error ? { state: "error", error: v.error } : { state: "ok", displayName: v.displayName ?? undefined };
}
