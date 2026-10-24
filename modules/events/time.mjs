// Événements : tout ce qui touche au TEMPS, en un seul endroit, sans dépendance.
//
// Principe central : un événement est gardé comme « jour + heure du mur + nom du fuseau » (2026-03-29, 21:00, Europe/Paris), jamais comme un décalage fixe
// (+01:00). L'instant exact se calcule À LA LECTURE avec les règles de l'heure d'été de CE jour-là. Une répétition garde donc la même heure du mur, été comme hiver.

const DAY = 86_400_000;

export const baseLang = (l) => String(l || "en").slice(0, 2).toLowerCase();
export const pad2 = (n) => (n < 10 ? `0${n}` : `${n}`);
export const cap = (s) => { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); };

const partsCache = new Map();
/** Les éléments du calendrier mural d'un instant dans un fuseau : { y, mo (1-12), d, h, mi, s, wd (0 = dimanche) }. */
export function zoneParts(ms, tz) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
    if (partsCache.size > 80) partsCache.clear();
    partsCache.set(tz, f);
  }
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}

const fmtCache = new Map();
/** Formate un instant dans un fuseau avec Intl (les formateurs sont gardés : en créer un coûte cher). Langue inconnue → anglais. */
export function fmtIn(ms, tz, lang, opts) {
  const key = `${tz}|${lang}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) {
    try { f = new Intl.DateTimeFormat(lang, { ...opts, timeZone: tz }); } catch { f = new Intl.DateTimeFormat("en", { ...opts, timeZone: tz }); }
    if (fmtCache.size > 200) fmtCache.clear();
    fmtCache.set(key, f);
  }
  return f.format(new Date(ms));
}

/** L'heure en toutes lettres : « 21 h », « 21 h 30 », « minuit » (fr) · « 9 pm », « 9:30 pm », « noon » (en) · « 21:30 » (autres langues). */
export function clockText(h, mi, lang) {
  const l = baseLang(lang);
  if (l === "fr") {
    if (mi === 0 && h === 0) return "minuit";
    if (mi === 0 && h === 12) return "midi";
    return mi === 0 ? `${h} h` : `${h} h ${pad2(mi)}`;
  }
  if (l === "en") {
    if (mi === 0 && h === 0) return "midnight";
    if (mi === 0 && h === 12) return "noon";
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${mi === 0 ? hh : `${hh}:${pad2(mi)}`} ${h < 12 ? "am" : "pm"}`;
  }
  return `${pad2(h)}:${pad2(mi)}`;
}

/** Le nom lisible d'un fuseau (« heure d'Europe centrale », « Central European Time »). */
export function zoneName(ms, tz, lang) {
  for (const kind of ["longGeneric", "short"]) {
    try {
      for (const p of new Intl.DateTimeFormat(lang, { timeZone: tz, timeZoneName: kind }).formatToParts(new Date(ms))) if (p.type === "timeZoneName") return p.value;
    } catch { /* on essaie la forme suivante */ }
  }
  return tz;
}

/** Un vrai nom de fuseau (Europe/Paris, America/Argentina/Buenos_Aires, UTC) — jamais un décalage (+01:00) ni un texte libre. */
export function isValidZone(tz) {
  if (typeof tz !== "string" || tz.length < 3 || tz.length > 64) return false;
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/** Le nom d'un fuseau avec ses bonnes majuscules (« asia/kolkata » → « Asia/Kolkata »), ou « » s'il n'existe pas. `known` : noms préférés. */
export function canonicalZone(tz, known = []) {
  if (!isValidZone(tz)) return "";
  const lower = tz.toLowerCase();
  const hit = known.find((z) => z.toLowerCase() === lower);
  if (hit) return hit;
  if (/^(?:UTC|[A-Z][A-Za-z0-9_+-]*(?:\/[A-Z0-9][A-Za-z0-9_+-]*){1,2})$/.test(tz)) return tz;
  try { return new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone; } catch { return ""; }
}

const offsetMemo = new Map();
/** Décalage (ms) de l'heure du mur sur l'heure universelle à cet instant : +3 600 000 pour Paris en hiver, +7 200 000 en été. */
export function offsetAt(ms, tz) {
  // Le décalage ne change qu'à une heure pile ou à un quart d'heure : on le retient par tranche de 15 minutes (2 000 événements = quelques milliers de calculs).
  const key = `${tz}|${Math.floor(ms / 900_000)}`;
  const hit = offsetMemo.get(key);
  if (hit !== undefined) return hit;
  const p = zoneParts(ms, tz);
  const value = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
  if (offsetMemo.size > 20_000) offsetMemo.clear();
  offsetMemo.set(key, value);
  return value;
}

/**
 * « 21:00 le 29 mars à Paris » → l'instant exact (ms depuis 1970).
 *  - kind "ok"   : l'heure existe une fois ;
 *  - kind "gap"  : l'heure n'existe pas (passage à l'heure d'été : 02:30 saute à 03:30) → on prend l'heure d'après, comme les agendas ;
 *  - kind "fold" : l'heure existe deux fois (retour à l'heure d'hiver) → on prend la première (heure d'été).
 */
export function zonedToUtc(y, mo, d, h, mi, tz) {
  const wall = Date.UTC(y, mo - 1, d, h, mi, 0);
  const before = offsetAt(wall - DAY, tz), after = offsetAt(wall + DAY, tz);
  const valid = [...new Set(before === after ? [before] : [before, after])].map((o) => wall - o).filter((t) => offsetAt(t, tz) === wall - t).sort((a, b) => a - b);
  if (valid.length === 1) return { ms: valid[0], kind: "ok" };
  if (valid.length > 1) return { ms: valid[0], kind: "fold" };
  const ms = wall - before;
  const p = zoneParts(ms, tz);
  return { ms, kind: "gap", shifted: { h: p.h, mi: p.mi } };
}

/** « 2026-03-29 » → { y, mo, d } si le jour existe vraiment (pas de 30 février) et reste entre 2000 et 2100. */
export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (y < 2000 || y > 2100 || t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, mo, d };
}

/** Une date tapée à la main : « 2026-03-29 », « 29/03/2026 », « 29.03.2026 », « 29-03-2026 » → « 2026-03-29 », ou null. */
export function readDate(raw) {
  const s = String(raw ?? "").trim();
  let iso = null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) iso = `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) iso = `${m[3]}-${pad2(+m[2])}-${pad2(+m[1])}`;
  return iso && parseDate(iso) ? iso : null;
}

/** Une heure tapée à la main : « 21:00 », « 21h », « 21h30 », « 21 h 30 », « 9pm », « 9:30 pm » → « 21:00 », ou null. */
export function readTime(raw) {
  const m = /^(\d{1,2})\s*(?:[:h.]\s*(\d{2})?)?\s*(am|pm)?$/.exec(String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " "));
  if (!m) return null;
  let h = +m[1];
  const mi = m[2] === undefined ? 0 : +m[2];
  if (mi > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === "pm" ? 12 : 0);
  } else if (h > 23) return null;
  return `${pad2(h)}:${pad2(mi)}`;
}

/** Le jour d'après (ou d'avant) un jour « 2026-03-29 ». */
export function addDays(dateStr, n) {
  const p = parseDate(dateStr);
  if (!p) return null;
  return new Date(Date.UTC(p.y, p.mo - 1, p.d) + n * DAY).toISOString().slice(0, 10);
}

/** Nombre de jours entre deux jours « AAAA-MM-JJ » (b - a). */
export function daysBetween(a, b) {
  const x = parseDate(a), y = parseDate(b);
  return x && y ? Math.round((Date.UTC(y.y, y.mo - 1, y.d) - Date.UTC(x.y, x.mo - 1, x.d)) / DAY) : NaN;
}

/** Le jour d'un instant, dans un fuseau, sous la forme 2026-03-29. */
export function dayIn(ms, tz) {
  const p = zoneParts(ms, tz);
  return `${String(p.y).padStart(4, "0")}-${pad2(p.mo)}-${pad2(p.d)}`;
}

export const daysInMonth = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

/** Jour de la semaine d'un jour « AAAA-MM-JJ » : 0 = dimanche. */
export function weekdayOf(dateStr) {
  const p = parseDate(dateStr);
  return p ? new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay() : 0;
}

/** Ajoute `n` mois à un jour : même quantième, ou le dernier jour du mois quand il n'existe pas (31 janvier + 1 mois = 28 ou 29 février). */
export function addMonths(dateStr, n) {
  const p = parseDate(dateStr);
  if (!p) return null;
  const total = p.y * 12 + (p.mo - 1) + n;
  const y = Math.floor(total / 12), mo = (total % 12) + 1;
  return `${String(y).padStart(4, "0")}-${pad2(mo)}-${pad2(Math.min(p.d, daysInMonth(y, mo)))}`;
}

/** « 2026-03-29T01:30:00Z » sous la forme des agendas : 20260329T013000Z. */
export function icsStamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** L'instant avec son décalage, pour les moteurs de recherche : « 2026-11-14T21:00:00+01:00 ». */
export function isoWithOffset(ms, tz) {
  const p = zoneParts(ms, tz);
  const off = Math.round(offsetAt(ms, tz) / 60000);
  const sign = off < 0 ? "-" : "+";
  const a = Math.abs(off);
  return `${String(p.y).padStart(4, "0")}-${pad2(p.mo)}-${pad2(p.d)}T${pad2(p.h)}:${pad2(p.mi)}:${pad2(p.s)}${sign}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
}

/** Un jour « AAAA-MM-JJ » écrit pour la langue (« samedi 14 novembre 2026 »). Pas de fuseau : le jour ne bouge pas. */
export function dayText(dateStr, lang, opts = { weekday: "long", day: "numeric", month: "long", year: "numeric" }) {
  const p = parseDate(dateStr);
  if (!p) return "";
  return fmtIn(Date.UTC(p.y, p.mo - 1, p.d, 12), "UTC", lang, opts);
}

/** « 14:30 » → { h, mi }. */
export function splitTime(t) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(t ?? ""));
  return m ? { h: +m[1], mi: +m[2] } : null;
}

/** L'heure d'un « HH:MM » en toutes lettres pour la langue. */
export function timeText(t, lang) {
  const p = splitTime(t);
  return p ? clockText(p.h, p.mi, lang) : "";
}

/** Les semaines d'un mois pour un calendrier : un tableau de semaines, chacune de 7 jours { date, inMonth }. weekStart : 1 = lundi, 0 = dimanche, 6 = samedi. */
export function monthWeeks(y, mo, weekStart = 1) {
  const first = `${String(y).padStart(4, "0")}-${pad2(mo)}-01`;
  const lead = (weekdayOf(first) - weekStart + 7) % 7;
  const total = daysInMonth(y, mo);
  const cells = Math.ceil((lead + total) / 7) * 7;
  const weeks = [];
  for (let i = 0; i < cells; i += 7) {
    weeks.push(Array.from({ length: 7 }, (_, k) => {
      const date = addDays(first, i + k - lead);
      return { date, inMonth: date.slice(0, 7) === first.slice(0, 7) };
    }));
  }
  return weeks;
}

/** « 2026-11 » → { y, mo }, ou null. */
export function parseMonth(s) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(s ?? ""));
  if (!m) return null;
  const y = +m[1], mo = +m[2];
  return y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 ? { y, mo } : null;
}

export const monthKey = (y, mo) => `${String(y).padStart(4, "0")}-${pad2(mo)}`;
export function shiftMonth(key, n) {
  const m = parseMonth(key);
  if (!m) return null;
  const total = m.y * 12 + (m.mo - 1) + n;
  return monthKey(Math.floor(total / 12), (total % 12) + 1);
}
