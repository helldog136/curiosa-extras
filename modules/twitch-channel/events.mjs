// Le planning Twitch de la chaîne (les rendez-vous que la personne a publiés sur Twitch) donné aux modules qui annoncent des événements : le service `event.source`, méthode `upcoming`.
// Ce fichier ne parle ni à Twitch ni au cœur : il transforme la réponse de `GET schedule` en événements. L'appel se fait dans helix.mjs (Connecteur Twitch, jeton d'application, rien de privé).
const SOURCE = { kind: "twitch", label: "Twitch" };
export const MAX_EVENTS = 50;
const HORIZON = 90 * 86_400_000;

/** Petite empreinte de texte (FNV-1a, base 36) : l'identifiant d'un rendez-vous Twitch est trop long et trop libre pour servir tel quel. */
function shortHash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text ?? "")) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/**
 * La réponse de Twitch (`data` de GET schedule) → les événements à venir. Un rendez-vous annulé (`canceled_until`), pendant des vacances, ou sans heure lisible est écarté ;
 * un rendez-vous commencé depuis moins de 3 h reste annoncé. `channel` : le pseudo de la chaîne. Rend au plus 50 événements, du plus proche au plus lointain.
 */
export function scheduleEvents(data, { channel, untitled = "Stream", now = Date.now() }) {
  const vacation = data?.vacation && typeof data.vacation === "object" ? { from: Date.parse(data.vacation.start_time ?? ""), to: Date.parse(data.vacation.end_time ?? "") } : null;
  const out = [];
  for (const s of Array.isArray(data?.segments) ? data.segments : []) {
    if (!s || typeof s !== "object" || typeof s.id !== "string" || !s.id) continue;
    if (s.canceled_until) continue;
    const startMs = Date.parse(s.start_time ?? "");
    if (!Number.isFinite(startMs) || startMs < now - 3 * 3_600_000 || startMs > now + HORIZON) continue;
    if (vacation && Number.isFinite(vacation.from) && Number.isFinite(vacation.to) && startMs >= vacation.from && startMs < vacation.to) continue;
    const endMs = Date.parse(s.end_time ?? "");
    const game = typeof s.category?.name === "string" ? s.category.name.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    out.push({
      id: `twitch:${channel}:${shortHash(s.id)}`, title: String(s.title ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || untitled, start: new Date(startMs).toISOString(),
      ...(Number.isFinite(endMs) && endMs > startMs ? { end: new Date(endMs).toISOString() } : {}), timezone: "", type: "stream", url: `https://www.twitch.tv/${channel}`, ...(game ? { games: [game] } : {}),
    });
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.id < b.id ? -1 : 1)).slice(0, MAX_EVENTS);
}

/** Ce que la personne doit savoir quand ça ne marche pas : "setup" (à régler : `reason`) ou "down" (panne passagère). */
export function failure(error) {
  if (error === "config") return { state: "setup", reason: "connector" };
  if (error === "auth") return { state: "setup", reason: "refused" };
  if (error === "forbidden") return { state: "setup", reason: "update" };
  return { state: "down", reason: error === "rate" ? "limit" : "network" };
}

/** La réponse du service : { ok: true, source, state, message?, note?, events }. `t(clé)` : les phrases de la langue demandée. */
export function answer({ state, reason, events = [], t, limit = MAX_EVENTS }) {
  const n = Math.min(MAX_EVENTS, Math.max(1, Math.trunc(Number(limit)) || MAX_EVENTS));
  if (state === "setup") return { ok: true, source: SOURCE, state: "setup", message: t(`events_setup_${reason}`), events: [] };
  if (state === "down") return { ok: true, source: SOURCE, state: "down", events: [] };
  return { ok: true, source: SOURCE, state: "ok", ...(events.length ? {} : { note: t("events_empty") }), events: events.slice(0, n) };
}
