// Aide de test (propre à ce dépôt, sans réseau) : fabrique des agendas iCal et les sert comme le ferait le module « Agenda en ligne » (créneaux du sujet
// `planning.slot`), pour tester un LECTEUR (le Planning, le bot) avec de vrais créneaux de fournisseur — le lecteur ne sait pas d'où ils viennent.
import { parseCalendar, expand, toSlot, extractGameNames } from "../../modules/calendar-ical/index.mjs";

export const icsDate = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
export const hoursFromNow = (n) => new Date(Date.now() + n * 3_600_000);
export const vevent = (uid, start, end, summary, extra = []) => ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`, `SUMMARY:${summary}`, ...extra, "END:VEVENT"].join("\r\n");
export const calendar = (...events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join("\r\n")}\r\nEND:VCALENDAR\r\n`;

/** Texte iCal -> créneaux du sujet pour la plage demandée, comme l'export de l'Agenda en ligne (une source). Texte illisible ou vide : liste vide. */
export function slotsFromIcs(text, { from, to, limit = 200, timeZone = "UTC" } = {}) {
  if (!String(text ?? "").includes("BEGIN:VCALENDAR")) return [];
  const lo = from ? new Date(from) : new Date(), hi = to ? new Date(to) : new Date(lo.getTime() + 60 * 86_400_000);
  return expand(parseCalendar(text), { timeZone, from: lo, to: hi, keepCancelled: true }).slice(0, limit).map((e) => toSlot(e, { timeZone, untitled: "(Sans titre)", gamesOf: extractGameNames }));
}

/** Option `topics` de fakeCtx : le sujet `planning.slot` servi par un ou plusieurs agendas. `sources()` : texte iCal, ou liste de { text | items, timeZone? } (relue à chaque appel : modifiable). */
export function feedTopics(sources, { timeZone = "UTC" } = {}) {
  return {
    "planning.slot": (o) => {
      const list = sources();
      return (Array.isArray(list) ? list : [{ text: list }]).flatMap((s) => (s.items ?? slotsFromIcs(s.text ?? "", { ...o, timeZone: s.timeZone ?? timeZone })));
    },
  };
}
