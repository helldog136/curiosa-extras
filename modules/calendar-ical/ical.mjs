// Calendrier iCal — lecteur iCal (sous-ensemble de la RFC 5545) et développement des répétitions. Fonctions PURES : ni réseau, ni horloge cachée.
//
// Taillé pour Google Agenda : VEVENT, RRULE simples (DAILY / WEEKLY[BYDAY] / MONTHLY / YEARLY, COUNT, UNTIL, INTERVAL), EXDATE, RECURRENCE-ID
// (occurrence modifiée ou annulée), STATUS:CANCELLED, fuseaux (TZID), journées entières. Volontairement pas une implémentation complète
// (pas de BYMONTHDAY, BYSETPOS, RDATE…). Aucune exception sur un contenu absurde : un événement illisible est ignoré, les autres sont servis.
const V = new URL(import.meta.url).search;   // le cœur recharge index.mjs avec ?v=<version> : les fichiers voisins suivent
const { zonedTimeToUtc, wallDateNow, weekdayOf, addDaysToWall } = await import(`./dates.mjs${V}`);

const DAY = 86_400_000;
const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MAX_CANDIDATES = 20_000;   // garde-fou : jamais de boucle infinie sur une règle sans COUNT ni UNTIL

/** Fuseau IANA valide ? (un nom inconnu, comme les « (UTC+01:00) Bruxelles » d'Outlook, ferait lever Intl) */
export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return typeof tz === "string" && tz.length > 0;
  } catch {
    return false;
  }
}

function addMonthsToWall(y, m, d, months) {
  const total = y * 12 + (m - 1) + months;
  const dt = new Date(Date.UTC(Math.floor(total / 12), (total % 12), d));   // le débordement de jour est absorbé, comme Google Agenda
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
const compareWall = (a, b) => a.y - b.y || a.m - b.m || a.d - b.d;
const wallKey = (w) => `${w.y}-${w.m}-${w.d}`;
const pad = (n) => String(n).padStart(2, "0");
const dateString = (w) => `${w.y}-${pad(w.m)}-${pad(w.d)}`;

// Une ligne repliée continue sur la suivante, qui commence par une espace ou une tabulation.
const unfold = (text) => text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
const unescapeText = (v) => v.replace(/\\([nN,;\\])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));

function parseLine(line) {
  const colon = line.indexOf(":");
  if (colon === -1) return null;
  const [name, ...paramParts] = line.slice(0, colon).split(";");
  const params = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq !== -1) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: (name ?? "").toUpperCase(), params, value: line.slice(colon + 1) };
}

const zoneOf = (prop, fallback) => (prop.params.TZID && isValidTimeZone(prop.params.TZID) ? prop.params.TZID : fallback);

/** Une date iCal -> { date (instant), allDay }. Heure sans fuseau ni « Z » : heure du fuseau par défaut de l'instance. */
function parseIcsDate(prop, defaultTimeZone) {
  const value = prop.value.trim();
  const allDay = prop.params.VALUE === "DATE" || /^\d{8}$/.test(value);
  const m = allDay ? value.match(/^(\d{4})(\d{2})(\d{2})$/) : value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (allDay) return { date: zonedTimeToUtc(year, month, day, 0, 0, 0, defaultTimeZone), allDay: true };
  const [hour, minute, second] = [Number(m[4]), Number(m[5]), Number(m[6])];
  if (m[7] === "Z") return { date: new Date(Date.UTC(year, month - 1, day, hour, minute, second)), allDay: false };
  return { date: zonedTimeToUtc(year, month, day, hour, minute, second, zoneOf(prop, defaultTimeZone)), allDay: false };
}

function wallParts(prop) {
  const m = prop.value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), h: Number(m[4] ?? "0"), mi: Number(m[5] ?? "0"), s: Number(m[6] ?? "0") } : null;
}

/** « PT2H30M », « P1D », « P1W » -> millisecondes (sinon null). */
function parseDuration(value) {
  const m = String(value).trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const ms = ((Number(m[2] ?? 0) * 7 + Number(m[3] ?? 0)) * 24 * 3600 + Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

function parseRRule(value, defaultTimeZone) {
  const parts = {};
  for (const kv of value.split(";")) {
    const [k, v] = kv.split("=");
    if (k) parts[k.toUpperCase()] = v ?? "";
  }
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(parts.FREQ)) return null;
  const rrule = { freq: parts.FREQ, interval: Math.max(1, Number(parts.INTERVAL) || 1) };
  if (parts.COUNT) rrule.count = Number(parts.COUNT);
  if (parts.UNTIL) {
    const parsed = parseIcsDate({ name: "UNTIL", params: {}, value: parts.UNTIL }, defaultTimeZone);
    if (parsed) rrule.until = parts.UNTIL.length === 8 ? new Date(parsed.date.getTime() + DAY - 1) : parsed.date;   // UNTIL=20261231 : ce jour-là inclus
  }
  if (parts.BYDAY) rrule.byDay = parts.BYDAY.split(",").map((c) => WEEKDAY_CODES.indexOf(c.replace(/^[+-]?\d+/, "").toUpperCase())).filter((i) => i !== -1);
  return rrule;
}

// Dates de calendrier candidates d'une règle, dans l'ordre.
function* candidateWallDates(rrule, dtstart) {
  if (rrule.freq === "WEEKLY" && rrule.byDay && rrule.byDay.length > 0) {
    const days = [...new Set(rrule.byDay)].sort((a, b) => a - b);
    let { y, m, d } = addDaysToWall(dtstart.y, dtstart.m, dtstart.d, -weekdayOf(dtstart.y, dtstart.m, dtstart.d));
    for (let i = 0; i < MAX_CANDIDATES; i++) {
      for (const wd of days) {
        const occ = addDaysToWall(y, m, d, wd);
        if (compareWall(occ, dtstart) >= 0) yield occ;
      }
      ({ y, m, d } = addDaysToWall(y, m, d, 7 * rrule.interval));
    }
    return;
  }
  let cur = { y: dtstart.y, m: dtstart.m, d: dtstart.d };
  for (let i = 0; i < MAX_CANDIDATES; i++) {
    yield cur;
    if (rrule.freq === "DAILY") cur = addDaysToWall(cur.y, cur.m, cur.d, rrule.interval);
    else if (rrule.freq === "WEEKLY") cur = addDaysToWall(cur.y, cur.m, cur.d, 7 * rrule.interval);
    else if (rrule.freq === "MONTHLY") cur = addMonthsToWall(cur.y, cur.m, cur.d, rrule.interval);
    else cur = addMonthsToWall(cur.y, cur.m, cur.d, 12 * rrule.interval);
  }
}

/**
 * Occurrences (instants de début) d'une règle qui tombent près de la plage [from, to]. Les candidats loin de la plage ne sont pas convertis
 * en heure UTC (la conversion de fuseau est le coût) ; ceux d'une occurrence modifiée (`keep`) le sont toujours pour être remplacés.
 */
function expandRRule(rrule, dtstart, timeZone, { from, to, durationMs }, exdates, keep) {
  const results = [];
  const lo = from.getTime() - durationMs - 2 * DAY, hi = to.getTime() + 2 * DAY;
  let n = 0;
  for (const wall of candidateWallDates(rrule, dtstart)) {
    n++;
    if (rrule.count && n > rrule.count) break;
    const approx = Date.UTC(wall.y, wall.m - 1, wall.d);
    if (approx > hi) break;
    if (approx < lo && !keep.has(wallKey(wall))) continue;
    const occurrence = zonedTimeToUtc(wall.y, wall.m, wall.d, dtstart.h, dtstart.mi, dtstart.s, timeZone);
    if (rrule.until && occurrence.getTime() > rrule.until.getTime()) break;
    if (!exdates.has(occurrence.getTime())) results.push(occurrence);
  }
  return results;
}

/** Texte iCal -> événements bruts (propriétés), prêts à être développés. Sans exception. */
export function parseCalendar(text) {
  const lines = unfold(String(text ?? "")).split("\n").filter((l) => l.length > 0);
  const rawEvents = [];
  let current = null;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") current = [];
    else if (upper === "END:VEVENT") {
      if (current) rawEvents.push(current);
      current = null;
    } else if (current) {
      const prop = parseLine(line);
      if (prop) current.push(prop);
    }
  }
  const masters = [];
  const overrides = new Map();
  for (const props of rawEvents) {
    const get = (name) => props.find((p) => p.name === name) ?? null;
    const uid = get("UID")?.value ?? "";
    const dtstart = get("DTSTART");
    if (!uid || !dtstart) continue;
    const text = (name) => { const v = get(name)?.value; return v ? unescapeText(v) : null; };
    const url = (get("URL")?.value ?? "").trim();
    const info = {
      summary: text("SUMMARY") ?? "", description: text("DESCRIPTION"), location: text("LOCATION"), url: /^https?:\/\/\S+$/i.test(url) ? url : null,
      dtstart, dtend: get("DTEND"), duration: get("DURATION")?.value ?? null, status: get("STATUS")?.value.trim().toUpperCase() ?? null,
    };
    const recurrenceId = get("RECURRENCE-ID");
    if (recurrenceId) overrides.set(uid, [...(overrides.get(uid) ?? []), { recurrenceId, ...info }]);
    else masters.push({ uid, ...info, rrule: get("RRULE")?.value ?? null, exdates: props.filter((p) => p.name === "EXDATE") });
  }
  return { masters, overrides };
}

/**
 * Événements de la plage [from, to] (chevauchement : fin >= from et début <= to), récurrences développées, triés par début.
 * @param opts.timeZone  fuseau des heures « flottantes » (sans fuseau ni Z) et des journées entières
 * @param opts.keepCancelled  garder les événements annulés (marqués `cancelled: true`)
 */
export function expand(model, { timeZone = "UTC", from, to, keepCancelled = false }) {
  const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const results = [];
  for (const master of model.masters) {
    try {
      if (master.status === "CANCELLED" && !keepCancelled) continue;
      const start = parseIcsDate(master.dtstart, tz);
      if (!start) continue;
      const end = master.dtend ? parseIcsDate(master.dtend, tz) : null;
      const explicit = !end && master.duration ? parseDuration(master.duration) : null;
      const durationMs = end ? end.date.getTime() - start.date.getTime() : explicit ?? (start.allDay ? DAY : 3_600_000);
      const base = { uid: master.uid, allDay: start.allDay };

      const overrideByOriginal = new Map(), keep = new Set();
      for (const o of model.overrides.get(master.uid) ?? []) {
        const parsed = parseIcsDate(o.recurrenceId, tz);
        if (!parsed) continue;
        overrideByOriginal.set(parsed.date.getTime(), o);
        const w = wallParts(o.recurrenceId);
        if (w) keep.add(wallKey(w));
      }

      let starts = [start.date];
      if (master.rrule) {
        const rrule = parseRRule(master.rrule, tz);
        const wall = wallParts(master.dtstart);
        if (rrule && wall) {
          const ruleZone = start.allDay ? tz : /Z$/i.test(master.dtstart.value.trim()) ? "UTC" : zoneOf(master.dtstart, tz);   // une règle se répète à l'heure murale de son DTSTART
          const ex = new Set(master.exdates.flatMap((p) => p.value.split(",").map((v) => parseIcsDate({ ...p, value: v }, tz)?.date.getTime())).filter((t) => t !== undefined));
          starts = expandRRule(rrule, wall, ruleZone, { from, to, durationMs }, ex, keep);
        }
      }

      for (const occStart of starts) {
        const override = overrideByOriginal.get(occStart.getTime());
        if (override) {
          if (override.status === "CANCELLED") {
            if (keepCancelled) results.push({ ...base, title: master.summary, description: master.description, location: master.location, url: master.url, start: occStart, end: new Date(occStart.getTime() + durationMs), cancelled: true });
            continue;
          }
          const oStart = parseIcsDate(override.dtstart, tz);
          if (!oStart) continue;
          const oEnd = override.dtend ? parseIcsDate(override.dtend, tz) : null;
          results.push({ ...base, allDay: oStart.allDay, title: override.summary, description: override.description, location: override.location, url: override.url, start: oStart.date, end: oEnd ? oEnd.date : new Date(oStart.date.getTime() + durationMs), cancelled: false });
        } else {
          results.push({ ...base, title: master.summary, description: master.description, location: master.location, url: master.url, start: occStart, end: new Date(occStart.getTime() + durationMs), cancelled: master.status === "CANCELLED" });
        }
      }
    } catch { /* un événement illisible (fuseau absurde…) ne coûte pas les autres */ }
  }
  return results
    .filter((e) => e.end.getTime() >= from.getTime() && e.start.getTime() <= to.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Texte iCal -> événements de la plage (raccourci : `parseCalendar` puis `expand`). Plage par défaut : de 1970 à `windowEnd`. */
export function parseIcs(text, opts) {
  const to = opts.to ?? opts.windowEnd ?? new Date(Date.now() + 60 * DAY);
  const from = opts.from ?? new Date(0);
  return expand(parseCalendar(text), { timeZone: opts.timeZone, from, to, keepCancelled: !!opts.keepCancelled });
}

/**
 * Un événement développé -> élément du sujet `calendar.event` (voir le README du dépôt). Journée entière : `start` / `end` sont des DATES
 * (`2026-10-14`, fin EXCLUE comme en iCal) ; sinon des instants ISO 8601 en UTC.
 */
export function toCalendarEvent(e, { timeZone = "UTC", untitled = "" } = {}) {
  const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const dayOf = (d) => dateString(wallDateNow(tz, d));
  const out = {
    id: `${e.uid}@${e.allDay ? dayOf(e.start) : e.start.toISOString()}`,
    title: e.title || untitled,
    start: e.allDay ? dayOf(e.start) : e.start.toISOString(),
    allDay: e.allDay,
    status: e.cancelled ? "cancelled" : "confirmed",
  };
  const endDay = e.allDay ? dayOf(e.end) : null;
  if (e.allDay) { if (endDay > out.start) out.end = endDay; }
  else out.end = e.end.toISOString();
  if (e.description) out.description = e.description;
  if (e.location) out.location = e.location;
  if (e.url) out.url = e.url;
  return out;
}
