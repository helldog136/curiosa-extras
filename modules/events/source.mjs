// Événements : ce que ce module OFFRE aux autres — la liste de ses événements à venir (service `event.source`, lue par exemple par la Story d'annonce)
// et les lieux des événements qui ont des coordonnées (sujet `map.place`, lu par une carte). Lecture seule, bornée, ne lève jamais.
//
// Contrat `event.source` (voir le README du dépôt) : { ok, source: { kind, label }, state: "ok" | "setup" | "down", message?, note?, events: [{ id, title, start (UTC), timezone, end?, allDay?, day?, type, url?, image? }] }.
const q = new URL(import.meta.url).search;
const X = await import(`./text.mjs${q}`);
const D = await import(`./data.mjs${q}`);
const U = await import(`./urls.mjs${q}`);

export const LIMITS = { perAnswer: 100, defaultLimit: 50, places: 200 };

const iso = (ms) => new Date(ms).toISOString();
const asMs = (v) => { const t = v instanceof Date ? v.getTime() : Date.parse(v ?? ""); return Number.isFinite(t) ? t : NaN; };
const httpsOnly = (v) => (typeof v === "string" && /^https:\/\//i.test(v) ? v : "");

/** Le nom montré par la source : celui de l'instance (son nom public), sinon le mot « événements » du site. */
const label = (ctx) => X.clean(ctx.instance.name, 40) || X.clean(ctx.setting("wordMany"), 40) || ctx.t("wordManyDefault");

/** Un événement tel que le contrat le veut. L'identifiant est stable (celui du stockage), préfixé par la source. */
export function sourceEvent(ctx, ev) {
  const out = {
    id: `events:${ctx.instance.key}:${ev.id}`.slice(0, 100),
    title: ev.title,
    start: iso(ev.startMs),
    timezone: ev.zone,
    end: iso(ev.endMs),
    type: "event",
  };
  if (ev.allDay) { out.allDay = true; out.day = ev.date; }
  const url = httpsOnly(U.eventUrl(ctx, ev));
  if (url) out.url = url;
  const image = httpsOnly(U.absolute(ctx, ev.image));
  if (image) out.image = image;
  return out;
}

/**
 * Les événements publiés à venir (ou en cours), du plus proche au plus lointain. Un événement annulé ou reporté n'est pas une annonce à faire : il n'y est pas.
 * `args` : { from, to, limit, locale } (tout est facultatif et vérifié ; n'importe quoi est ignoré).
 */
export async function upcomingAnswer(ctx, args) {
  const a = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const source = { kind: "events", label: label(ctx) };
  try {
    const data = await D.load(ctx);
    const now = Date.now();
    const from = asMs(a.from), to = asMs(a.to);
    const limit = Math.min(LIMITS.perAnswer, Math.max(1, Math.trunc(Number(a.limit)) || LIMITS.defaultLimit));
    const since = Number.isFinite(from) ? from : now;
    const events = [];
    for (const ev of D.visible(data)) {
      if (ev.endMs <= since) continue;
      if (ev.state === "cancelled" || ev.state === "postponed") continue;
      if (Number.isFinite(to) && ev.startMs > to) continue;
      events.push(sourceEvent(ctx, ev));
      if (events.length >= limit) break;
    }
    return { ok: true, source, state: "ok", events };
  } catch {
    return { ok: true, source, state: "down", events: [] };
  }
}

/** Les lieux (sujet `map.place`) : un par événement publié, à venir ou en cours, qui a des coordonnées. Jamais d'adresse de personne : un lieu d'événement seulement. */
export async function places(ctx, args) {
  const data = await D.load(ctx);
  const now = Date.now();
  const limit = Math.min(LIMITS.places, Math.max(1, Math.trunc(Number(args?.limit)) || 50));
  const out = [];
  for (const ev of D.visible(data)) {
    if (out.length >= limit) break;
    if (ev.endMs <= now || ev.lat === null || ev.lng === null || ev.state === "cancelled") continue;
    const item = { id: `events:${ctx.instance.key}:${ev.id}`.slice(0, 100), title: ev.title, lat: ev.lat, lng: ev.lng, kind: "event", at: iso(ev.startMs) };
    const path = U.eventHref(ctx, ev, false);
    if (path) item.url = path;
    if (ev.place) item.note = ev.place;
    out.push(item);
  }
  return out;
}
