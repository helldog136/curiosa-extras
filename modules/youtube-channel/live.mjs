// Le direct EN COURS de la chaîne : « est-elle en direct, quelle vidéo, quel chat ? » — le service `youtube.live`, méthode `current`.
// Ce fichier ne parle ni à YouTube ni au cœur : il reçoit `call(méthode, arguments)` (l'appel au service `youtube.api`, voir index.mjs, borné, qui ne lève jamais).
//
// COMMENT : les 5 derniers envois de la chaîne (liste « uploads », 1 unité de limite) puis le détail de ces vidéos (1 unité) : une vidéo que YouTube dit « live »
// est le direct, et `activeLiveChatId` est l'identifiant de son chat. Deux unités par vérification, JAMAIS en cache chez le connecteur (demande « fresh ») ;
// ici une réponse est gardée 45 secondes : plusieurs modules ou plusieurs onglets ne font qu'une vérification.
// HYPOTHÈSES NON VÉRIFIÉES AVEC LE VRAI YOUTUBE : un direct public apparaît tout de suite dans la liste des envois ; la clé du site suffit à lire `activeLiveChatId`.
// Un direct privé ou non répertorié n'est pas visible avec une clé (voir events.mjs). Un direct sans chat (chat désactivé) rend `chatId: null`.
export const CHANNEL_RE = /^UC[\w-]{22}$/;
const VIDEO_RE = /^[\w-]{11}$/;
const CHAT_RE = /^[\w.=-]{6,200}$/;
export const LIVE_TTL = 45_000;
const cache = new Map();   // identifiant de chaîne → { at, value } (au plus 20 chaînes)
export const resetLive = () => cache.clear();
/** La liste « envois » d'une chaîne a toujours l'identifiant de la chaîne avec « UU » à la place de « UC » : aucun appel pour le connaître. */
export const uploadsOf = (channelId) => `UU${channelId.slice(2)}`;

/** Le détail des vidéos → le direct en cours (la plus récemment commencée si YouTube en annonce plusieurs) ou null. */
export function pickLive(items) {
  let best = null;
  for (const v of Array.isArray(items) ? items : []) {
    if (!v || typeof v !== "object" || !VIDEO_RE.test(String(v.id ?? "")) || v.snippet?.liveBroadcastContent !== "live") continue;
    const d = v.liveStreamingDetails ?? {};
    if (d.actualEndTime) continue;
    const startedMs = Date.parse(d.actualStartTime ?? "");
    const chatId = typeof d.activeLiveChatId === "string" && CHAT_RE.test(d.activeLiveChatId) ? d.activeLiveChatId : null;
    const cand = { videoId: v.id, title: String(v.snippet?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 100), chatId, startedAt: Number.isFinite(startedMs) ? new Date(startedMs).toISOString() : null, startedMs: Number.isFinite(startedMs) ? startedMs : 0 };
    if (!best || cand.startedMs > best.startedMs) best = cand;
  }
  if (!best) return null;
  const { startedMs, ...rest } = best;
  return rest;
}

/** Le code d'erreur du fournisseur de `youtube.api` → un code court pour le lecteur. */
const failure = (error) => (["unavailable", "config", "auth", "quota", "rate", "timeout", "network", "invalid"].includes(error) ? error : "network");

/**
 * { ok: true, live: false, channelId, at } | { ok: true, live: true, videoId, title, chatId|null, startedAt|null, channelId, at, cost }
 * | { ok: false, error: "channel" | "unavailable" | "config" | "auth" | "quota" | "rate" | "timeout" | "network" | "invalid" }. Ne lève jamais.
 */
export async function readLive(call, channelId, { now = Date.now(), fresh = false } = {}) {
  if (!CHANNEL_RE.test(channelId ?? "")) return { ok: false, error: "channel" };
  const hit = cache.get(channelId);
  if (!fresh && hit && now - hit.at < LIVE_TTL) return { ...hit.value };
  const list = await call("request", { endpoint: "playlistItems.list", params: { part: "snippet", playlistId: uploadsOf(channelId), maxResults: 5 }, fresh: true });
  let cost = list.ok ? list.cost ?? 0 : 0;
  if (!list.ok || list.stale) return { ok: false, error: failure(list.error) };
  const ids = list.status === 200 ? [...new Set((Array.isArray(list.json?.items) ? list.json.items : []).map((i) => i?.snippet?.resourceId?.videoId).filter((id) => VIDEO_RE.test(String(id ?? ""))))].slice(0, 5) : [];
  let value = { ok: true, live: false, channelId, at: new Date(now).toISOString(), cost };
  if (list.status !== 200 && list.status !== 404) return { ok: false, error: "network" };
  if (ids.length) {
    const vids = await call("request", { endpoint: "videos.list", params: { part: "snippet,liveStreamingDetails", id: ids }, fresh: true });
    if (!vids.ok || vids.stale || vids.status !== 200) return { ok: false, error: failure(vids.error) };
    cost += vids.cost ?? 0;
    const live = pickLive(vids.json?.items);
    value = live ? { ok: true, live: true, ...live, channelId, at: new Date(now).toISOString(), cost } : { ...value, cost };
  }
  cache.delete(channelId); cache.set(channelId, { at: now, value });
  while (cache.size > 20) cache.delete(cache.keys().next().value);
  return { ...value };
}
