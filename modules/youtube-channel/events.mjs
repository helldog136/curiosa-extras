// Les vidéos et directs PROGRAMMÉS de la chaîne (premières et directs publics), donnés aux modules qui annoncent des événements : le service `event.source`, méthode `upcoming`.
// Ce fichier ne parle ni à YouTube ni au cœur : il reçoit `call(méthode, arguments)` (l'appel au service `youtube.api`, voir index.mjs, borné, qui ne lève jamais) et rend des événements.
//
// CE QUE YOUTUBE PERMET, EN HONNÊTETÉ : avec la clé du site (accès aux données PUBLIQUES), on voit une vidéo programmée seulement si elle est publique (une première ou un direct
// annoncé au public). Une vidéo PRIVÉE ou « non répertoriée » programmée n'est PAS visible avec une clé : elle ne le sera jamais sans connexion au compte YouTube de la personne,
// que ce module ne demande pas. Le texte `note` rendu avec les événements le dit à la personne.
// Trois appels de 1 unité de quota chacun (la chaîne, ses 50 derniers envois, le détail de ces 50 vidéos), gardés 10 minutes : jamais un appel par visite.
export const CHANNEL_RE = /^UC[\w-]{22}$/;
const VIDEO_RE = /^[\w-]{11}$/;
export const TTL = 10 * 60_000;
export const MAX_EVENTS = 50;
const SOURCE = { kind: "youtube", label: "YouTube" };
const HORIZON = 90 * 86_400_000;
const cache = new Map();   // identifiant de chaîne → { at, events } (au plus 50 chaînes)
export const resetEvents = () => cache.clear();

/**
 * Le détail des vidéos (`videos.list` avec snippet, contentDetails, liveStreamingDetails) → les événements à venir.
 * Une vidéo compte si YouTube la dit « upcoming » ET donne une heure de début programmée valide, entre maintenant (moins 3 h : un direct en retard reste annoncé) et 90 jours.
 * Sans durée (« P0D ») c'est un direct, avec une durée c'est une première.
 */
export function scheduledEvents(items, now = Date.now()) {
  const out = [];
  for (const v of Array.isArray(items) ? items : []) {
    if (!v || typeof v !== "object" || !VIDEO_RE.test(String(v.id ?? ""))) continue;
    if (v.snippet?.liveBroadcastContent !== "upcoming") continue;
    const startMs = Date.parse(v.liveStreamingDetails?.scheduledStartTime ?? "");
    if (!Number.isFinite(startMs) || startMs < now - 3 * 3_600_000 || startMs > now + HORIZON) continue;
    const title = String(v.snippet?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    const duration = String(v.contentDetails?.duration ?? "");
    const isLive = !duration || /^P0D$|^PT0S$/.test(duration);
    const endMs = Date.parse(v.liveStreamingDetails?.scheduledEndTime ?? "");
    out.push({
      id: `youtube:${v.id}`, title, start: new Date(startMs).toISOString(), ...(Number.isFinite(endMs) && endMs > startMs ? { end: new Date(endMs).toISOString() } : {}),
      timezone: "", type: isLive ? "live" : "premiere", url: `https://www.youtube.com/watch?v=${v.id}`, image: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    });
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.id < b.id ? -1 : 1)).slice(0, MAX_EVENTS);
}

/** Le code d'erreur du fournisseur de `youtube.api` → ce que la personne doit savoir : "setup" (à régler : `reason`) ou "down" (panne passagère). */
function failure(error) {
  if (error === "unavailable") return { state: "setup", reason: "connector" };
  if (error === "config") return { state: "setup", reason: "key" };
  if (error === "invalid") return { state: "setup", reason: "update" };
  if (error === "auth") return { state: "setup", reason: "refused" };
  return { state: "down", reason: error === "quota" || error === "rate" ? "limit" : "network" };
}

/**
 * Lit les événements d'une chaîne : { events } ou { state: "setup" | "down", reason }. Ne lève jamais. 10 minutes de cache par chaîne ; en panne, rien d'inventé (le cache périmé n'est pas resservi ici :
 * c'est le lecteur qui garde la dernière liste connue, et le dit).
 */
export async function readUpcoming(call, channelId, now = Date.now()) {
  if (!CHANNEL_RE.test(channelId ?? "")) return { state: "setup", reason: "channel" };
  const hit = cache.get(channelId);
  if (hit && now - hit.at < TTL) return { events: hit.events };
  const ch = await call("request", { endpoint: "channels.list", params: { part: "contentDetails", id: channelId } });
  if (!ch.ok || ch.status !== 200) return failure(ch.error);
  const playlist = ch.json?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (typeof playlist !== "string") return { state: "setup", reason: "channel" };
  const list = await call("request", { endpoint: "playlistItems.list", params: { part: "snippet", playlistId: playlist, maxResults: 50 } });
  if (!list.ok || list.status !== 200) return failure(list.error);
  const ids = [...new Set((Array.isArray(list.json?.items) ? list.json.items : []).map((i) => i?.snippet?.resourceId?.videoId).filter((id) => VIDEO_RE.test(String(id ?? ""))))].slice(0, 50);
  if (!ids.length) { cache.set(channelId, { at: now, events: [] }); return { events: [] }; }
  const vids = await call("request", { endpoint: "videos.list", params: { part: "snippet,contentDetails,liveStreamingDetails", id: ids } });
  if (!vids.ok || vids.status !== 200) return failure(vids.error);
  const events = scheduledEvents(vids.json?.items, now);
  if (vids.stale || list.stale || ch.stale) return { events, state: "down", reason: "network" };   // dernière lecture connue du fournisseur : servie, mais dite « ne répond pas »
  cache.delete(channelId); cache.set(channelId, { at: now, events });
  while (cache.size > 50) cache.delete(cache.keys().next().value);
  return { events };
}

/** La réponse du service : { ok: true, source, state, message?, note?, events }. `t(clé)` : les phrases de la langue demandée. Ne lève jamais. */
export async function upcomingAnswer({ call, channelId, t, now = Date.now(), limit = MAX_EVENTS }) {
  const r = await readUpcoming(call, channelId, now);
  const n = Math.min(MAX_EVENTS, Math.max(1, Math.trunc(Number(limit)) || MAX_EVENTS));
  if (r.state === "setup") return { ok: true, source: SOURCE, state: "setup", message: t(`events_setup_${r.reason}`), events: [] };
  if (r.state === "down" && !r.events) return { ok: true, source: SOURCE, state: "down", events: [] };
  return { ok: true, source: SOURCE, state: r.state === "down" ? "down" : "ok", note: t("events_note"), events: (r.events ?? []).slice(0, n) };
}
