// Aide de test (propre à ce dépôt, sans réseau) : fabrique des calendriers iCal et les sert comme le ferait le module « Calendrier iCal »
// (évènements du sujet `calendar.event`), pour tester un CONSOMMATEUR (le Planning) avec de vrais évènements de fournisseur.
import { parseCalendar, expand, toCalendarEvent } from "../../modules/calendar-ical/index.mjs";

export const icsDate = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
export const hoursFromNow = (n) => new Date(Date.now() + n * 3_600_000);
export const vevent = (uid, start, end, summary, extra = []) => ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`, `SUMMARY:${summary}`, ...extra, "END:VEVENT"].join("\r\n");
export const calendar = (...events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join("\r\n")}\r\nEND:VCALENDAR\r\n`;

/** Texte iCal -> évènements du sujet pour la plage demandée, comme l'export du Calendrier iCal (une source). Texte illisible : liste vide. */
export function itemsFromIcs(text, { from, to, limit = 200, label, color, timeZone = "UTC" } = {}) {
  if (!String(text).includes("BEGIN:VCALENDAR")) return [];
  const lo = from ? new Date(from) : new Date(), hi = to ? new Date(to) : new Date(lo.getTime() + 60 * 86_400_000);
  return expand(parseCalendar(text), { timeZone, from: lo, to: hi, keepCancelled: true }).slice(0, limit)
    .map((e) => ({ ...toCalendarEvent(e, { timeZone, untitled: "(Sans titre)" }), ...(label ? { sourceLabel: label } : {}), ...(color ? { color } : {}) }));
}

/** Options de fakeCtx pour un Planning branché sur ces sources : `sources` = [{ text (iCal) | items, label?, color?, state? }] (lues à chaque appel, donc modifiables). */
export function feedOptions(sources) {
  return {
    topics: { "calendar.event": (o) => sources().flatMap((s) => (s.items ?? itemsFromIcs(s.text ?? "", { ...o, label: s.label, color: s.color }))).sort((a, b) => String(a.start).localeCompare(String(b.start))) },
    serviceInstances: { "calendar.provider": sources().map((s, i) => ({ instance: `src${i}`, name: s.label ?? `Source ${i}`, methods: { describe: () => ({ kind: s.kind ?? "ical", label: s.label ?? null, color: s.color ?? null, active: true, state: s.state ?? "ok" }) } })) },
  };
}
