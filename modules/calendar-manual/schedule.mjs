// Évènements saisis à la main — logique PURE : validation de la saisie, répétition hebdomadaire, conversion en évènements du sujet `calendar.event`.
// Aucune dépendance, ni stockage, ni horloge cachée. Heures saisies en heure du fuseau de l'instance (« heure murale ») : la conversion tient compte de l'heure d'été.
const V = new URL(import.meta.url).search;
const { zonedTimeToUtc, weekdayOf, addDaysToWall } = await import(`./dates.mjs${V}`);

const DAY = 86_400_000;
const pad = (n) => String(n).padStart(2, "0");
export const dateOf = (w) => `${w.y}-${pad(w.m)}-${pad(w.d)}`;
const str = (v, max) => String(v ?? "").trim().slice(0, max);

/** "2026-10-14" -> { y, m, d } si la date existe, sinon null. */
export function parseDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const w = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  const back = new Date(Date.UTC(w.y, w.m - 1, w.d));
  return back.getUTCFullYear() === w.y && back.getUTCMonth() === w.m - 1 && back.getUTCDate() === w.d && w.y >= 1970 && w.y <= 2100 ? w : null;
}
/** "21:30" ou "21h30" ou "9:05" -> { h, mi } sinon null. */
export function parseTime(v) {
  const m = /^(\d{1,2})\s*[:hH]\s*(\d{2})?$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2] ?? 0);
  return h <= 23 && mi <= 59 ? { h, mi } : null;
}
const dayNumber = (w) => Math.round(Date.UTC(w.y, w.m - 1, w.d) / DAY);

const WEEKDAYS = { lun: 1, mon: 1, mar: 2, tue: 2, mer: 3, wed: 3, jeu: 4, thu: 4, ven: 5, fri: 5, sam: 6, sat: 6, dim: 0, sun: 0 };
/** « lun, mer ven » -> [1, 3, 5] ; ce qui n'est pas un jour est ignoré. */
export function parseWeekdays(v) {
  const found = String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/).map((w) => WEEKDAYS[w.slice(0, 3)]).filter((d) => d !== undefined);
  return [...new Set(found)].sort((a, b) => a - b);
}

/**
 * La saisie du formulaire -> évènement à stocker, ou { error: <clé de message> }.
 * Journée entière : la date de fin est la DERNIÈRE journée (incluse), vide = un seul jour.
 */
export function cleanEvent(v) {
  const title = str(v.title, 120);
  if (!title) return { error: "errTitle" };
  const start = parseDate(v.startDate);
  if (!start) return { error: "errStartDate" };
  const allDay = v.allDay === "yes" || v.allDay === true || v.allDay === "true";
  const out = { title, allDay, startDate: dateOf(start), startTime: "", endDate: "", endTime: "", description: str(v.description, 5000), location: str(v.location, 200), url: "", category: str(v.category, 100), cancelled: v.cancelled === "yes" || v.cancelled === true, repeat: "none", repeatDays: [], repeatUntil: "", repeatCount: 0 };
  const url = str(v.url, 2000);
  if (url) { if (!/^https?:\/\/\S+$/i.test(url)) return { error: "errUrl" }; out.url = url; }
  const endDay = str(v.endDate, 10) ? parseDate(v.endDate) : null;
  if (str(v.endDate, 10) && !endDay) return { error: "errEndDate" };
  if (endDay && dayNumber(endDay) < dayNumber(start)) return { error: "errEndBeforeStart" };
  if (allDay) {
    if (endDay && dayNumber(endDay) > dayNumber(start)) out.endDate = dateOf(endDay);
  } else {
    const t = parseTime(v.startTime);
    if (!t) return { error: "errStartTime" };
    out.startTime = `${pad(t.h)}:${pad(t.mi)}`;
    const hasEndTime = !!str(v.endTime, 10);
    const e = hasEndTime ? parseTime(v.endTime) : null;
    if (hasEndTime && !e) return { error: "errEndTime" };
    if (e) {
      const endWall = endDay ?? start;
      if (dayNumber(endWall) === dayNumber(start) && (e.h < t.h || (e.h === t.h && e.mi <= t.mi))) return { error: "errEndBeforeStart" };
      out.endDate = dateOf(endWall);
      out.endTime = `${pad(e.h)}:${pad(e.mi)}`;
    } else if (endDay) return { error: "errEndTime" };   // une date de fin sans heure de fin : ambigu
  }
  if (v.repeat === "weekly") {
    out.repeat = "weekly";
    const days = parseWeekdays(v.repeatDays);
    if (str(v.repeatDays, 100) && !days.length) return { error: "errDays" };
    out.repeatDays = days.length ? days : [weekdayOf(start.y, start.m, start.d)];
    if (str(v.repeatUntil, 10)) {
      const until = parseDate(v.repeatUntil);
      if (!until || dayNumber(until) < dayNumber(start)) return { error: "errUntil" };
      out.repeatUntil = dateOf(until);
    }
    const n = Math.trunc(Number(v.repeatCount));
    if (str(v.repeatCount, 6) && !(n >= 1 && n <= 520)) return { error: "errCount" };
    out.repeatCount = str(v.repeatCount, 6) ? n : 0;
  }
  return { event: out };
}

/** Dates (heure murale) des occurrences : {y,m,d}, de la première à la dernière, bornées par `hiDay` (numéro de jour) et plafonnées. */
function* occurrenceDays(ev, hiDay) {
  const start = parseDate(ev.startDate);
  if (!start) return;
  if (ev.repeat !== "weekly") { yield start; return; }
  const days = (Array.isArray(ev.repeatDays) && ev.repeatDays.length ? ev.repeatDays : [weekdayOf(start.y, start.m, start.d)]).filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  const until = ev.repeatUntil ? parseDate(ev.repeatUntil) : null;
  const max = Number(ev.repeatCount) > 0 ? Number(ev.repeatCount) : Infinity;
  let { y, m, d } = addDaysToWall(start.y, start.m, start.d, -weekdayOf(start.y, start.m, start.d));
  let n = 0;
  for (let week = 0; week < 6000; week++) {
    for (const wd of days) {
      const occ = addDaysToWall(y, m, d, wd);
      if (dayNumber(occ) < dayNumber(start)) continue;
      if (until && dayNumber(occ) > dayNumber(until)) return;
      if (dayNumber(occ) > hiDay) return;
      if (++n > max) return;
      yield occ;
    }
    ({ y, m, d } = addDaysToWall(y, m, d, 7));
  }
}

/**
 * Les évènements du sujet `calendar.event` d'une saisie, pour la plage [from, to] (chevauchement). `id` : identifiant du document, suivi de
 * la date pour une répétition. Journée entière : dates, fin EXCLUE (comme iCal) ; sinon instants ISO 8601 UTC.
 */
export function occurrencesOf(id, ev, { from, to, timeZone = "UTC", untitled = "" }) {
  const start = parseDate(ev.startDate);
  if (!start) return [];
  const endDay = ev.endDate ? parseDate(ev.endDate) : null;
  const spanDays = endDay ? dayNumber(endDay) - dayNumber(start) : 0;
  const t = ev.allDay ? null : parseTime(ev.startTime);
  if (!ev.allDay && !t) return [];
  const e = !ev.allDay && ev.endTime ? parseTime(ev.endTime) : null;
  const hiDay = Math.floor(to.getTime() / DAY) + 2;
  const loMs = from.getTime(), hiMs = to.getTime();
  const out = [];
  for (const occ of occurrenceDays(ev, hiDay)) {
    const last = addDaysToWall(occ.y, occ.m, occ.d, spanDays);
    let item;
    if (ev.allDay) {
      const exclusive = addDaysToWall(last.y, last.m, last.d, 1);
      const s = zonedTimeToUtc(occ.y, occ.m, occ.d, 0, 0, 0, timeZone).getTime(), x = zonedTimeToUtc(exclusive.y, exclusive.m, exclusive.d, 0, 0, 0, timeZone).getTime();
      if (x < loMs || s > hiMs) continue;
      item = { start: dateOf(occ), end: dateOf(exclusive) };
    } else {
      const s = zonedTimeToUtc(occ.y, occ.m, occ.d, t.h, t.mi, 0, timeZone);
      const x = e ? zonedTimeToUtc(last.y, last.m, last.d, e.h, e.mi, 0, timeZone) : null;
      if ((x ? x.getTime() : s.getTime()) < loMs || s.getTime() > hiMs) continue;
      item = { start: s.toISOString(), ...(x ? { end: x.toISOString() } : {}) };
    }
    out.push({
      id: ev.repeat === "weekly" ? `${id}@${dateOf(occ)}` : id, title: ev.title || untitled, ...item, allDay: !!ev.allDay, status: ev.cancelled ? "cancelled" : "confirmed",
      ...(ev.description ? { description: ev.description } : {}), ...(ev.location ? { location: ev.location } : {}), ...(ev.url ? { url: ev.url } : {}), ...(ev.category ? { category: ev.category } : {}),
    });
  }
  return out;
}
