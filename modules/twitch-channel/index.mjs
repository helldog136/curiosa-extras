// Chaîne Twitch — module communautaire de Curiosa. Porté de l'ancien site (Helix, client-credentials).
// Il ne fait QUE fournir des informations : `stream.live` (le live en cours, vide sinon) et `maze.poster` (derniers clips).
// Sans identifiants valides, tout est vide plutôt qu'en erreur.
const LOGIN = /^[a-zA-Z0-9_]{3,25}$/;
const CLIPS_TTL = 10 * 60_000;
const LIVE_TTL = 30_000;
const state = { tokens: new Map(), ids: new Map(), live: new Map(), clips: new Map() };
export const resetCache = () => { state.tokens.clear(); state.ids.clear(); state.live.clear(); state.clips.clear(); };

const get = (url, init = {}) => fetch(url, { signal: AbortSignal.timeout(5000), ...init });
const cfg = (ctx) => ({ channel: String(ctx.setting("channel") ?? "").trim().toLowerCase(), clientId: String(ctx.setting("clientId") ?? "").trim(), secret: String(ctx.setting("clientSecret") ?? "").trim() });
const valid = (c) => LOGIN.test(c.channel) && c.clientId && c.secret;

async function token(c) {
  const key = `${c.clientId}|${c.secret}`;
  // Un jeton par couple d'identifiants : plusieurs instances (une par chaîne) peuvent avoir des identifiants différents sans se disputer le jeton.
  const known = state.tokens.get(key);
  if (known && known.expiresAt > Date.now()) return known.value;
  try {
    const res = await get("https://id.twitch.tv/oauth2/token", { method: "POST", body: new URLSearchParams({ client_id: c.clientId, client_secret: c.secret, grant_type: "client_credentials" }) });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.access_token) return null;
    state.tokens.set(key, { value: json.access_token, expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000 });
    return json.access_token;
  } catch { return null; }
}
const headers = (c, t) => ({ "Client-Id": c.clientId, Authorization: `Bearer ${t}` });

/** Le live en cours ({ id, title, startedAt, game }) ou null (hors ligne, identifiants invalides ou erreur). */
export async function currentStream(c) {
  if (!valid(c)) return null;
  const hit = state.live.get(c.channel);
  if (hit && Date.now() - hit.at < LIVE_TTL) return hit.value;
  const t = await token(c);
  if (!t) return null;
  try {
    const res = await get(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(c.channel)}`, { headers: headers(c, t) });
    if (!res.ok) return null;
    const s = (await res.json()).data?.[0];
    const value = s ? { id: String(s.id), title: String(s.title ?? ""), startedAt: s.started_at, game: s.game_name?.trim() || null } : null;
    state.live.set(c.channel, { value, at: Date.now() });
    return value;
  } catch { return null; }
}

export async function recentClips(c) {
  if (!valid(c)) return [];
  const hit = state.clips.get(c.channel);
  if (hit && Date.now() - hit.at < CLIPS_TTL) return hit.items;
  const t = await token(c);
  if (!t) return hit?.items ?? [];
  try {
    let id = state.ids.get(c.channel);
    if (!id) {
      const u = await get(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(c.channel)}`, { headers: headers(c, t) });
      id = u.ok ? (await u.json()).data?.[0]?.id : null;
      if (!id) return hit?.items ?? [];
      state.ids.set(c.channel, id);
    }
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const res = await get(`https://api.twitch.tv/helix/clips?broadcaster_id=${encodeURIComponent(id)}&started_at=${encodeURIComponent(since)}&first=20`, { headers: headers(c, t) });
    if (!res.ok) return hit?.items ?? [];
    const items = ((await res.json()).data ?? []).filter((x) => /^https:\/\/(clips|www)\.twitch\.tv\//.test(x.url ?? "")).map((x) => ({ title: String(x.title ?? ""), url: x.url, image: /^https:\/\//.test(x.thumbnail_url ?? "") ? x.thumbnail_url : null, publishedAt: x.created_at }));
    state.clips.set(c.channel, { items, at: Date.now() });
    return items;
  } catch { return hit?.items ?? []; }
}

export default {
  exports: {
    /** Le bouton de la chaîne pour le cœur (en-tête) : rien tant que la chaîne n'est pas réglée. */
    "social.link"(ctx) {
      const channel = String(ctx.setting("channel") ?? "").trim().toLowerCase();
      return LOGIN.test(channel) ? [{ label: `Twitch · ${channel}`, url: `https://twitch.tv/${channel}`, icon: "twitch" }] : [];
    },
    async "stream.live"(ctx) {
      const c = cfg(ctx);
      const s = await currentStream(c);
      return s ? [{ id: s.id, title: s.title, url: `https://twitch.tv/${c.channel}`, startedAt: s.startedAt, game: s.game ?? undefined }] : [];
    },
    async "maze.poster"(ctx, { limit }) {
      return (await recentClips(cfg(ctx))).slice(0, limit ?? 10).map((x) => ({ title: x.title, url: x.url, ...(x.image ? { image: x.image } : {}), kind: "clip" }));
    },
  },
};
