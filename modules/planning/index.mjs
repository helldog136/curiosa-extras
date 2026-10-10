// Planning des streams — module communautaire de Curiosa, porté d'un planning existant.
//
// Lit un calendrier iCal (adresse secrète d'un Google Agenda), en tire les créneaux à venir et les montre :
// page publique jour par jour, section d'accueil « prochains streams », sujet `planning.slot` pour d'autres
// modules, action MCP. Un seul fichier, sans dépendance. La logique pure (lecteur iCal, fuseaux, grille de jours,
// noms de jeux, garde-fous d'URL) est exportée pour être testée ; le module lui-même est l'export par défaut.
//
// Jaquettes : pour chaque jeu nommé dans la description d'un événement, la jaquette est demandée au service RAWG du cœur
// (`ctx.api.rawg`, permission `rawg` ; la clé se règle dans Admin → Réglages, le module ne la voit jamais) et montrée sur la page,
// les morceaux d'accueil, l'admin et l'image PNG de la semaine (`/m/<clé>/image`, pour un panneau Twitch). Au mieux : sans clé,
// clé refusée ou RAWG injoignable, on affiche simplement le nom du jeu. Le cache et la limite de demandes sont ceux du cœur.

/* ───────────────────────────── Fuseaux et dates de calendrier ───────────────────────────── */

function tzOffsetMillis(utcMillis, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(utcMillis))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - utcMillis;
}

/** Heure murale dans un fuseau -> instant UTC (deux passes : correct autour d'un changement d'heure). */
export function zonedTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const pass1 = guess - tzOffsetMillis(guess, timeZone);
  const pass2 = guess - tzOffsetMillis(pass1, timeZone);
  return new Date(pass2);
}

/** Date de calendrier « aujourd'hui » dans un fuseau. */
export function wallDateNow(timeZone, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

/** 0 = dimanche … 6 = samedi. */
export const weekdayOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

export function addDaysToWall(y, m, d, days) {
  const next = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
}

function addMonthsToWall(y, m, d, months) {
  const total = y * 12 + (m - 1) + months;
  const dt = new Date(Date.UTC(Math.floor(total / 12), (total % 12), d)); // le débordement de jour est absorbé, comme Google Agenda
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

const compareWall = (a, b) => a.y - b.y || a.m - b.m || a.d - b.d;

/* ───────────────────────────── Lecteur iCal (sous-ensemble de la RFC 5545) ───────────────────────────── */
// Taillé pour Google Agenda : VEVENT, RRULE simples (DAILY/WEEKLY[BYDAY]/MONTHLY/YEARLY, COUNT, UNTIL, INTERVAL),
// EXDATE, RECURRENCE-ID (occurrence modifiée ou annulée). Volontairement pas une implémentation complète.

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// Une ligne repliée continue sur la suivante, qui commence par une espace ou une tabulation.
const unfold = (text) => text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
const unescapeText = (v) => v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\;/g, ";").replace(/\\\\/g, "\\");

function parseLine(line) {
  const colon = line.indexOf(":");
  if (colon === -1) return null;
  const [name, ...paramParts] = line.slice(0, colon).split(";");
  const params = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq !== -1) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return { name: (name ?? "").toUpperCase(), params, value: line.slice(colon + 1) };
}

function parseIcsDate(prop, defaultTimeZone) {
  const value = prop.value.trim();
  const allDay = prop.params.VALUE === "DATE" || /^\d{8}$/.test(value);
  const m = allDay ? value.match(/^(\d{4})(\d{2})(\d{2})$/) : value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (allDay) return { date: zonedTimeToUtc(year, month, day, 0, 0, 0, defaultTimeZone), allDay: true };
  const [hour, minute, second] = [Number(m[4]), Number(m[5]), Number(m[6])];
  if (m[7] === "Z") return { date: new Date(Date.UTC(year, month - 1, day, hour, minute, second)), allDay: false };
  return { date: zonedTimeToUtc(year, month, day, hour, minute, second, prop.params.TZID || defaultTimeZone), allDay: false };
}

function wallParts(prop) {
  const m = prop.value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), h: Number(m[4] ?? "0"), mi: Number(m[5] ?? "0"), s: Number(m[6] ?? "0") } : null;
}

function parseRRule(value, defaultTimeZone) {
  const parts = {};
  for (const kv of value.split(";")) {
    const [k, v] = kv.split("=");
    if (k) parts[k.toUpperCase()] = v ?? "";
  }
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(parts.FREQ)) return null;
  const rrule = { freq: parts.FREQ, interval: Number(parts.INTERVAL) || 1 };
  if (parts.COUNT) rrule.count = Number(parts.COUNT);
  if (parts.UNTIL) {
    const parsed = parseIcsDate({ name: "UNTIL", params: {}, value: parts.UNTIL }, defaultTimeZone);
    if (parsed) rrule.until = parsed.date;
  }
  if (parts.BYDAY) rrule.byDay = parts.BYDAY.split(",").map((c) => WEEKDAY_CODES.indexOf(c.replace(/^[+-]?\d+/, "").toUpperCase())).filter((i) => i !== -1);
  return rrule;
}

// Dates de calendrier candidates d'une règle, plafonnées : jamais de boucle infinie sur une règle sans COUNT ni UNTIL.
function* candidateWallDates(rrule, dtstart) {
  const MAX = 2000;
  if (rrule.freq === "WEEKLY" && rrule.byDay && rrule.byDay.length > 0) {
    const days = [...rrule.byDay].sort((a, b) => a - b);
    let { y, m, d } = addDaysToWall(dtstart.y, dtstart.m, dtstart.d, -weekdayOf(dtstart.y, dtstart.m, dtstart.d));
    for (let i = 0; i < MAX; i++) {
      for (const wd of days) {
        const occ = addDaysToWall(y, m, d, wd);
        if (compareWall(occ, dtstart) >= 0) yield occ;
      }
      ({ y, m, d } = addDaysToWall(y, m, d, 7 * rrule.interval));
    }
    return;
  }
  let cur = { y: dtstart.y, m: dtstart.m, d: dtstart.d };
  for (let i = 0; i < MAX; i++) {
    yield cur;
    if (rrule.freq === "DAILY") cur = addDaysToWall(cur.y, cur.m, cur.d, rrule.interval);
    else if (rrule.freq === "WEEKLY") cur = addDaysToWall(cur.y, cur.m, cur.d, 7 * rrule.interval);
    else if (rrule.freq === "MONTHLY") cur = addMonthsToWall(cur.y, cur.m, cur.d, rrule.interval);
    else cur = addMonthsToWall(cur.y, cur.m, cur.d, 12 * rrule.interval);
  }
}

function expandRRule(rrule, dtstart, timeZone, windowEnd, exdates) {
  const results = [];
  let n = 0;
  for (const { y, m, d } of candidateWallDates(rrule, dtstart)) {
    n++;
    if (rrule.count && n > rrule.count) break;
    const occurrence = zonedTimeToUtc(y, m, d, dtstart.h, dtstart.mi, dtstart.s, timeZone);
    if (rrule.until && occurrence.getTime() > rrule.until.getTime()) break;
    if (occurrence.getTime() > windowEnd.getTime()) break;
    if (!exdates.has(occurrence.getTime())) results.push(occurrence);
  }
  return results;
}

/** Texte iCal -> événements datés (récurrences développées jusqu'à `windowEnd`), triés par début. */
export function parseIcs(text, opts) {
  const lines = unfold(String(text)).split("\n").filter((l) => l.length > 0);
  const rawEvents = [];
  let current = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") current = [];
    else if (line === "END:VEVENT") {
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
    const summary = unescapeText(get("SUMMARY")?.value ?? "(Sans titre)");
    const descriptionRaw = get("DESCRIPTION")?.value;
    const description = descriptionRaw ? unescapeText(descriptionRaw) : null;
    const dtend = get("DTEND");
    const status = get("STATUS")?.value.toUpperCase() ?? null;
    const recurrenceId = get("RECURRENCE-ID");
    if (recurrenceId) {
      overrides.set(uid, [...(overrides.get(uid) ?? []), { recurrenceId, summary, description, dtstart, dtend, status }]);
    } else {
      masters.push({ uid, summary, description, dtstart, dtend, rrule: get("RRULE")?.value ?? null, exdates: props.filter((p) => p.name === "EXDATE"), status });
    }
  }

  const results = [];
  for (const master of masters) {
    if (master.status === "CANCELLED") continue;
    const start = parseIcsDate(master.dtstart, opts.timeZone);
    if (!start) continue;
    const end = master.dtend ? parseIcsDate(master.dtend, opts.timeZone) : null;
    const durationMs = end ? end.date.getTime() - start.date.getTime() : 60 * 60 * 1000;

    const overrideByOriginal = new Map();
    for (const o of overrides.get(master.uid) ?? []) {
      const parsed = parseIcsDate(o.recurrenceId, opts.timeZone);
      if (parsed) overrideByOriginal.set(parsed.date.getTime(), o);
    }

    let starts = [start.date];
    if (master.rrule) {
      const rrule = parseRRule(master.rrule, opts.timeZone);
      const wall = wallParts(master.dtstart);
      if (rrule && wall) {
        const ex = new Set(master.exdates.map((p) => parseIcsDate(p, opts.timeZone)?.date.getTime()).filter((t) => t !== undefined));
        starts = expandRRule(rrule, wall, opts.timeZone, opts.windowEnd, ex);
      }
    }

    for (const occStart of starts) {
      const override = overrideByOriginal.get(occStart.getTime());
      if (override) {
        if (override.status === "CANCELLED") continue;
        const oStart = parseIcsDate(override.dtstart, opts.timeZone);
        if (!oStart) continue;
        const oEnd = override.dtend ? parseIcsDate(override.dtend, opts.timeZone) : null;
        results.push({ uid: master.uid, title: override.summary, description: override.description, start: oStart.date, end: oEnd ? oEnd.date : new Date(oStart.date.getTime() + durationMs), allDay: oStart.allDay });
      } else {
        results.push({ uid: master.uid, title: master.summary, description: master.description, start: occStart, end: new Date(occStart.getTime() + durationMs), allDay: start.allDay });
      }
    }
  }
  return results.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/* ───────────────────────────── Planning : noms de jeux, grille de jours ───────────────────────────── */

export const MAX_GAMES_PER_STREAM = 3;

const decodeEntities = (s) => s.replace(/&lt;br\s*\/?&gt;/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/**
 * Convention à écrire dans la description d'un événement : une ligne « Jeu : <nom> » (ou « Game : »), ou plusieurs
 * jeux séparés par une virgule ou « + ». Rien n'est deviné depuis le titre : mieux vaut ne rien afficher qu'un mauvais jeu.
 */
export function extractGameNames(description) {
  if (!description) return [];
  const matches = [...decodeEntities(description).matchAll(/^[ \t]*(?:Jeux?|Games?)\s*:\s*(.+)$/gim)];
  return matches
    .flatMap((m) => (m[1] ?? "").split(/,|\s+\+\s+/))
    .map((n) => n.trim())
    .filter((n) => n.length >= 2)
    .slice(0, MAX_GAMES_PER_STREAM);
}

/** `count` jours consécutifs à partir de `startWall`, chacun avec ses créneaux (début dans la journée, dans le fuseau). */
export function buildDays(startWall, count, events, timeZone) {
  const days = [];
  for (let i = 0; i < count; i++) {
    const wall = addDaysToWall(startWall.y, startWall.m, startWall.d, i);
    const dayStart = zonedTimeToUtc(wall.y, wall.m, wall.d, 0, 0, 0, timeZone);
    const dayEnd = zonedTimeToUtc(wall.y, wall.m, wall.d, 23, 59, 59, timeZone);
    days.push({ wall, streams: events.filter((s) => s.start >= dayStart && s.start <= dayEnd).sort((a, b) => a.start - b.start) });
  }
  return days;
}

/** Semaine lundi → dimanche contenant « aujourd'hui » (+ décalage en semaines, jamais négatif). */
export function getWeekRange(weekOffset, timeZone, now = new Date()) {
  const offset = Math.max(0, Math.floor(weekOffset));
  const today = wallDateNow(timeZone, now);
  const wd = weekdayOf(today.y, today.m, today.d);
  const monday = addDaysToWall(today.y, today.m, today.d, (wd === 0 ? -6 : 1 - wd) + offset * 7);
  const sunday = addDaysToWall(monday.y, monday.m, monday.d, 6);
  return { start: zonedTimeToUtc(monday.y, monday.m, monday.d, 0, 0, 0, timeZone), end: zonedTimeToUtc(sunday.y, sunday.m, sunday.d, 23, 59, 59, timeZone), startWall: monday, endWall: sunday };
}

/* ───────────────────────────── Garde-fous ───────────────────────────── */

/** Fuseau IANA valide ? (un nom inconnu ferait lever Intl) */
export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return typeof tz === "string" && tz.length > 0;
  } catch {
    return false;
  }
}

/**
 * Adresse de calendrier acceptable : https uniquement, sans identifiants, et jamais une machine locale ou privée
 * (le serveur va la télécharger : pas de requête vers le réseau interne).
 */
export function isPublicHttpsUrl(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host.includes(":")) return !/^(::1?$|f[cd]|fe80)/.test(host); // IPv6 : pas de boucle locale / privée / lien local
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return false;
  }
  return host.includes(".");
}

/* ───────────────────────────── Jaquettes (service RAWG du cœur) ───────────────────────────── */

const STATUS = { found: "found", none: "none", "no-key": "no_key", refused: "denied", unreachable: "down" };

/** Une jaquette via le cœur. Jamais d'exception ; https seulement. `status` : found · none · no_key · denied (clé refusée) · down (injoignable). */
export async function coverFor(ctx, title) {
  const svc = ctx.api?.rawg;
  if (!svc || typeof svc.cover !== "function") return { status: "no_key", url: null };   // cœur sans service RAWG : comme « pas de clé »
  try {
    const r = await svc.cover(title);
    const url = typeof r?.url === "string" && /^https:\/\//.test(r.url) ? r.url : null;
    const status = STATUS[r?.status] ?? "down";
    return status === "found" && !url ? { status: "none", url: null } : { status, url: status === "found" ? url : null };
  } catch { return { status: "down", url: null }; }
}

const MAX_LOOKUPS = 30;

/**
 * Jaquettes des jeux de ces créneaux. Renvoie { covers: Map(nom -> url), states: Map(nom -> status) }.
 * Les événements « toute la journée » n'ont pas de jeu. Cache et cadence : ceux du cœur (au plus 30 jeux différents par appel).
 */
export async function coversForSlots(ctx, slots) {
  const names = [...new Set(slots.filter((s) => !s.allDay).flatMap((s) => extractGameNames(s.description)))].slice(0, MAX_LOOKUPS);
  const covers = new Map(), states = new Map();
  if (!names.length) return { covers, states };
  let configured = false;
  try { configured = !!(await ctx.api?.rawg?.configured?.()); } catch { configured = false; }
  if (!configured) { for (const n of names) states.set(n, "no_key"); return { covers, states }; }
  await Promise.all(names.map(async (n) => { const r = await coverFor(ctx, n); states.set(n, r.status); if (r.url) covers.set(n, r.url); }));
  return { covers, states };
}

/** Les jaquettes d'un créneau, dans l'ordre des jeux (ceux sans jaquette sont simplement omis). */
const coversOf = (slot, covers) => (slot.allDay ? [] : extractGameNames(slot.description).map((n) => covers.get(n)).filter(Boolean));

/* ───────────────────────────── Lecture du calendrier ───────────────────────────── */

const CACHE_MS = 5 * 60_000;
const cache = new Map(); // url -> { at, text }

/** Télécharge le calendrier (cache court, délai borné). Ne lève jamais : `null` si illisible. */
export async function fetchIcs(url, fetchImpl = fetch) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;
  try {
    // Redirections suivies à la main : chaque étape doit rester une adresse https publique (sinon une
    // adresse publique pourrait renvoyer vers le réseau interne).
    let current = url;
    let res = null;
    for (let hop = 0; hop <= 3; hop++) {
      if (!isPublicHttpsUrl(current)) return null;
      res = await fetchImpl(current, { signal: AbortSignal.timeout(8000), redirect: "manual" });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) break;
      current = new URL(location, current).toString();
      res = null;
    }
    if (!res || !res.ok) return null;
    const text = await res.text();
    if (!text.includes("BEGIN:VCALENDAR")) return null;
    cache.set(url, { at: Date.now(), text: text.slice(0, 5_000_000) });
    return text;
  } catch {
    return null;
  }
}
export const clearIcsCache = () => cache.clear();

async function loadSlots(ctx, days) {
  const url = String(ctx.setting("icsUrl") ?? "").trim();
  if (!url || !isPublicHttpsUrl(url)) return { configured: !!url, ok: false, slots: [] };
  const timeZone = isValidTimeZone(ctx.setting("timezone")) ? ctx.setting("timezone") : "UTC";
  const text = await fetchIcs(url);
  if (text === null) return { configured: true, ok: false, slots: [], timeZone };
  const now = Date.now();
  const windowEnd = new Date(now + days * 86_400_000);
  const slots = parseIcs(text, { timeZone, windowEnd }).filter((e) => e.end.getTime() >= now && e.start.getTime() <= windowEnd.getTime());
  return { configured: true, ok: true, slots, timeZone };
}

const clampDays = (v, def = 7) => Math.min(60, Math.max(1, Math.trunc(Number(v)) || def));

/* ───────────────────────────── Le module ───────────────────────────── */

const fmtTime = (d, locale, tz) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d);
const fmtDay = (wall, locale, tz) => new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(zonedTimeToUtc(wall.y, wall.m, wall.d, 12, 0, 0, tz));
const escMd = (s) => String(s).replace(/([\\`*_[\]<>])/g, "\\$1");

function slotLine(slot, ctx, tz) {
  const when = slot.allDay ? ctx.t("allDay") : fmtTime(slot.start, ctx.locale, tz);
  const games = extractGameNames(slot.description);
  return `**${when}** — ${escMd(slot.title)}${games.length ? ` · _${games.map(escMd).join(", ")}_` : ""}`;
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const coverImg = (url) => `<img src="${esc(url)}" alt="" loading="lazy" width="44" height="58" style="width:44px;height:58px;object-fit:cover;border-radius:6px;flex-shrink:0">`;

/** Un créneau avec ses jaquettes (petites, à gauche) : comme sur la page de l'ancien site. */
function slotHtml(slot, ctx, tz, covers, prefix = "", vis = null) {
  const when = slot.allDay ? ctx.t("allDay") : fmtTime(slot.start, ctx.locale, tz);
  const games = extractGameNames(slot.description);
  const imgs = covers.length ? `<span style="display:flex;gap:4px;flex-shrink:0">${covers.map(coverImg).join("")}</span>` : vis ? placeholderHtml(vis, true) : "";
  return `<div style="display:flex;gap:12px;align-items:center;margin:8px 0">${imgs}<div style="min-width:0;overflow-wrap:anywhere">${prefix ? `<span style="color:var(--v-muted)">${esc(prefix)} · </span>` : ""}<strong>${esc(when)}</strong> — ${esc(slot.title)}` +
    `${games.length ? `<div style="color:var(--v-muted);font-style:italic;font-size:.9em">${games.map(esc).join(", ")}</div>` : ""}</div></div>`;
}
const anyCover = (slots, covers) => slots.some((s) => coversOf(s, covers).length > 0);

/* ───────────────────────────── Cartes de l'accueil (« prochain stream », « prochains streams ») ─────────────────────────────
 * HTML + classes `cpl-*` du module, uniquement avec les variables de thème du cœur (--v-*) : clair, sombre, avec ou sans couleur
 * secondaire. Les valeurs entre parenthèses de var() ne sont qu'un secours si le thème n'est pas chargé. La mise en page
 * s'adapte à la largeur de la case (container query), pas à celle de l'écran. Aucune animation sans prefers-reduced-motion. */

const CARD_CSS = `
.cpl{container-type:inline-size;width:100%;font-family:var(--v-font,inherit);color:var(--v-fg,inherit)}
.cpl *{box-sizing:border-box}
.cpl p,.cpl h3,.cpl ul{margin:0;padding:0}
.cpl ul{list-style:none}
.cpl-card,.cpl-list{position:relative;overflow:hidden;background:var(--v-surface,#1c1c1f);border:1px solid var(--v-line,#333);border-radius:1rem;box-shadow:0 1px 2px color-mix(in srgb,var(--v-fg,#000) 12%,transparent),0 10px 28px -14px color-mix(in srgb,var(--v-fg,#000) 35%,transparent)}
.cpl-card::before,.cpl-list::before{content:"";position:absolute;inset:0 0 auto 0;height:4px;background:var(--v-gradient,var(--v-accent,#e8a23b))}
.cpl-card{display:flex;gap:1rem;align-items:flex-start;padding:1.25rem 1rem 1rem}
.cpl-covers{display:flex;flex:0 0 auto;padding-left:.75rem}
.cpl-covers img{display:block;width:5.25rem;aspect-ratio:3/4;object-fit:cover;border-radius:.6rem;border:2px solid var(--v-surface,#1c1c1f);box-shadow:0 4px 12px -4px color-mix(in srgb,var(--v-fg,#000) 45%,transparent);background:var(--v-line,#333);margin-left:-.75rem}
.cpl-covers img+img{margin-left:-2.5rem}
.cpl-body{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:.4rem;overflow-wrap:anywhere}
.cpl-ph{--cpl-twitch:#9146ff;--cpl-on:#fff;position:relative;display:flex;flex:0 0 auto;align-items:center;justify-content:center;width:5.25rem;aspect-ratio:3/4;overflow:hidden;border-radius:.6rem;border:2px solid var(--v-surface,#1c1c1f);color:var(--cpl-on);font-weight:800;font-size:2.25rem;line-height:1;background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--cpl-on) 7%,transparent) 0 .5rem,transparent .5rem 1rem),linear-gradient(160deg,var(--cpl-twitch),color-mix(in srgb,var(--cpl-twitch) 72%,black))}
.cpl-ph img{display:block;width:72%;height:auto;max-height:72%;object-fit:contain}
.cpl-ph-disc{display:flex;align-items:center;justify-content:center;width:70%;aspect-ratio:1;border-radius:50%;background:var(--cpl-on);padding:12%}
.cpl-ph-disc img{width:100%;max-height:100%}
.cpl-ph-s{width:2.5rem;border-radius:.4rem;border-width:0;font-size:1.1rem}
.cpl-badge{display:inline-block;padding:.15rem .6rem;border-radius:999px;background:var(--v-accent,#e8a23b);color:var(--v-accent-fg,#111);font-size:.78rem;font-weight:700;letter-spacing:.02em;line-height:1.4}
[data-accent2] .cpl-badge{background:var(--v-accent2,#e8a23b);color:var(--v-accent2-fg,#111)}
.cpl-title{font-size:1.25rem;font-weight:700;line-height:1.25}
.cpl-when{display:flex;flex-wrap:wrap;align-items:baseline;gap:.1rem .75rem}
.cpl-hour{font-size:1.75rem;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums}
.cpl-day{color:var(--v-muted,#aaa);font-size:1rem}
.cpl-games,.cpl-also{color:var(--v-muted,#aaa);font-size:.9rem}
.cpl-btn,.cpl-link{display:inline-flex;align-items:center;gap:.4rem;font-weight:600;text-decoration:none}
.cpl-btn{margin-top:.35rem;padding:.55rem 1rem;border-radius:.65rem;background:var(--v-accent,#e8a23b);color:var(--v-accent-fg,#111);min-height:2.75rem}
[data-accent2] .cpl-btn{background:var(--v-accent2,#e8a23b);color:var(--v-accent2-fg,#111)}
.cpl-link{color:var(--v-fg,inherit);text-decoration:underline;text-underline-offset:.2em}
.cpl-btn:focus-visible,.cpl-link:focus-visible{outline:2px solid var(--v-fg,currentColor);outline-offset:3px}
@media (prefers-reduced-motion:no-preference){.cpl-btn{transition:transform .15s ease,filter .15s ease}.cpl-btn:hover{transform:translateY(-1px);filter:brightness(1.08)}}
.cpl-empty{display:block;padding:1.5rem 1rem 1.25rem;border-style:dashed;text-align:center}
.cpl-empty-t{font-size:1.1rem;font-weight:700}
.cpl-empty-s{color:var(--v-muted,#aaa);margin:.25rem 0 1rem}
.cpl-list{padding-top:4px}
.cpl-row{display:flex;gap:.75rem;align-items:center;padding:.75rem 1rem}
.cpl-row+.cpl-row{border-top:1px solid var(--v-line,#333)}
.cpl-tile{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;width:3.25rem;padding:.3rem 0;border:1px solid var(--v-line,#333);border-radius:.6rem;background:color-mix(in srgb,var(--v-fg,#fff) 6%,var(--v-surface,#1c1c1f));line-height:1.15}
.cpl-tw{font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;color:var(--v-muted,#aaa)}
.cpl-td{font-size:1.25rem;font-weight:800}
.cpl-thumb{flex:0 0 auto;width:2.5rem;aspect-ratio:3/4;object-fit:cover;border-radius:.4rem;background:var(--v-line,#333)}
.cpl-info{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:.15rem;overflow-wrap:anywhere}
.cpl-row .cpl-title{font-size:1rem}
.cpl-meta{color:var(--v-muted,#aaa);font-size:.9rem}
.cpl-meta time{color:var(--v-fg,inherit);font-weight:700}
.cpl-foot{padding:.75rem 1rem;border-top:1px solid var(--v-line,#333)}
@container (min-width:30rem){.cpl-card{gap:1.5rem;padding:1.5rem 1.5rem 1.25rem}.cpl-covers img,.cpl-ph:not(.cpl-ph-s){width:7.5rem}.cpl-ph:not(.cpl-ph-s){font-size:3rem}.cpl-covers img+img{margin-left:-3.5rem}.cpl-title{font-size:1.5rem}.cpl-hour{font-size:2.25rem}.cpl-row{padding:.85rem 1.25rem}.cpl-foot{padding:.75rem 1.25rem}}
`.replace(/\n/g, "");

const wallDay = (w) => Date.UTC(w.y, w.m - 1, w.d);

/** « En cours » · « Dans 40 min » · « Dans 3 h » · « Aujourd'hui » · « Demain » · « Dans 4 jours » ; rien au-delà d'une semaine. */
export function relativeLabel(slot, now, tz, t) {
  if (!slot.allDay && slot.start.getTime() <= now.getTime() && slot.end.getTime() >= now.getTime()) return t("relLive");
  if (slot.allDay && slot.start.getTime() <= now.getTime() && slot.end.getTime() > now.getTime()) return t("relToday");
  const diff = Math.round((wallDay(wallDateNow(tz, slot.start)) - wallDay(wallDateNow(tz, now))) / 86_400_000);
  if (diff < 0) return null;
  if (diff === 0) {
    if (slot.allDay) return t("relToday");
    const mins = Math.max(1, Math.ceil((slot.start.getTime() - now.getTime()) / 60_000));
    if (mins < 60) return t("relMinutes", { n: mins });
    const hours = Math.floor(mins / 60);
    return hours < 6 ? t("relHours", { n: hours }) : t("relToday");
  }
  if (diff === 1) return t("relTomorrow");
  return diff <= 6 ? t("relDays", { n: diff }) : null;
}

const isoOf = (slot, tz) => { if (!slot.allDay) return slot.start.toISOString(); const w = wallDateNow(tz, slot.start); return `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`; };
const gameCovers = (slot, covers) => (slot.allDay ? [] : extractGameNames(slot.description).map((name) => ({ name, url: covers.get(name) })).filter((g) => g.url));
const safeHttps = (v) => { const u = String(v ?? "").trim(); return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null; };
const planningHref = (ctx) => { const b = ctx.instance?.basePath; return b === null || b === undefined ? null : b ? `/${b}` : "/"; };
const wrapCards = (inner) => `<div class="cpl"><style>${CARD_CSS}</style>${inner}</div>`;

/** Le logo du site à poser sur le mauve Twitch : la variante « fond sombre » (logo clair) si elle existe, sinon le logo principal sur un disque blanc. */
const logoUrl = (v) => (typeof v === "string" && /^(https:\/\/[^\s"'<>]+|\/(?!\/)[^\s"'<>]*)$/.test(v.trim()) ? v.trim() : null);
export async function brandVisual(ctx) {
  let b = null;
  try { b = typeof ctx.api?.brand === "function" ? await ctx.api.brand(ctx.locale) : null; } catch { b = null; }
  const logos = Array.isArray(b?.logos) ? b.logos : [];
  const of = (kind) => logoUrl(logos.find((l) => l?.kind === kind)?.src);
  const light = of("squareDark") ?? of("wideDark");
  const plain = logoUrl(b?.logo) ?? of("square") ?? of("wide");
  const name = String(b?.name ?? "").trim();
  return { src: light ?? plain, light: !!light, initial: (name ? [...name][0].toUpperCase() : "▶") };
}

/** Visuel de repli d'un stream sans jeu : mêmes proportions que la jaquette. Décoratif (le titre dit déjà tout). */
function placeholderHtml(vis, small = false) {
  const inner = vis?.src
    ? (vis.light ? `<img src="${esc(vis.src)}" alt="" loading="lazy" width="120" height="120">` : `<span class="cpl-ph-disc"><img src="${esc(vis.src)}" alt="" loading="lazy" width="120" height="120"></span>`)
    : `<span>${esc(vis?.initial ?? "▶")}</span>`;
  return `<span class="cpl-ph${small ? " cpl-ph-s" : ""}" aria-hidden="true">${inner}</span>`;
}

function badgeHtml(label) { return label ? `<p><span class="cpl-badge">${esc(label)}</span></p>` : ""; }

/** La grande carte du prochain stream. `others` : les autres créneaux du même jour. */
function nextCardHtml(slot, others, ctx, tz, covers, now, vis) {
  const t = ctx.t;
  const gc = gameCovers(slot, covers).slice(0, 3);
  const games = extractGameNames(slot.description);
  const day = new Intl.DateTimeFormat(ctx.locale, { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(slot.start);
  const hour = slot.allDay ? t("allDay") : fmtTime(slot.start, ctx.locale, tz);
  const channel = safeHttps(ctx.setting("channelUrl"));
  const imgs = !gc.length ? placeholderHtml(vis) : `<span class="cpl-covers">${gc.map((g) => `<img src="${esc(g.url)}" alt="${esc(t("coverAlt", { game: g.name }))}" loading="lazy" width="120" height="160">`).join("")}</span>`;
  const also = others.length ? `<p class="cpl-also">${esc(t("alsoToday"))} ${others.map((o) => `<time datetime="${esc(isoOf(o, tz))}">${esc(o.allDay ? t("allDay") : fmtTime(o.start, ctx.locale, tz))}</time> ${esc(o.title)}`).join(" · ")}</p>` : "";
  return wrapCards(`<article class="cpl-card">${imgs}<div class="cpl-body">${badgeHtml(relativeLabel(slot, now, tz, t))}` +
    `<h3 class="cpl-title">${esc(slot.title)}</h3>` +
    `<p class="cpl-when"><time class="cpl-hour" datetime="${esc(isoOf(slot, tz))}">${esc(hour)}</time><span class="cpl-day">${esc(day)}</span></p>` +
    `${games.length ? `<p class="cpl-games">${esc(t("gamesLabel"))} ${games.map(esc).join(", ")}</p>` : ""}${also}` +
    `${channel ? `<a class="cpl-btn" href="${esc(channel)}" target="_blank" rel="noopener noreferrer">${esc(t("watch"))}</a>` : ""}` +
    `</div></article>`);
}

/** Une liste de créneaux à venir (une ligne par stream : jour, jaquette, titre, heure). */
function upcomingListHtml(slots, ctx, tz, covers, now, vis) {
  const t = ctx.t;
  const href = planningHref(ctx);
  const rows = slots.map((s) => {
    const wd = new Intl.DateTimeFormat(ctx.locale, { weekday: "short", timeZone: tz }).format(s.start);
    const dn = new Intl.DateTimeFormat(ctx.locale, { day: "numeric", timeZone: tz }).format(s.start);
    const gc = gameCovers(s, covers)[0];
    const games = s.allDay ? [] : extractGameNames(s.description);
    const hour = s.allDay ? t("allDay") : fmtTime(s.start, ctx.locale, tz);
    const rel = relativeLabel(s, now, tz, t);
    return `<li class="cpl-row"><time class="cpl-tile" datetime="${esc(isoOf(s, tz))}"><span class="cpl-tw">${esc(wd)}</span><span class="cpl-td">${esc(dn)}</span></time>` +
      `${gc ? `<img class="cpl-thumb" src="${esc(gc.url)}" alt="${esc(t("coverAlt", { game: gc.name }))}" loading="lazy" width="40" height="54">` : placeholderHtml(vis, true)}` +
      `<div class="cpl-info"><span class="cpl-title">${esc(s.title)}</span><span class="cpl-meta"><time datetime="${esc(isoOf(s, tz))}">${esc(hour)}</time>${games.length ? ` · ${games.map(esc).join(", ")}` : ""}</span></div>` +
      `${rel ? `<span class="cpl-badge">${esc(rel)}</span>` : ""}</li>`;
  }).join("");
  return wrapCards(`<div class="cpl-list"><ul>${rows}</ul>${href ? `<div class="cpl-foot"><a class="cpl-link" href="${esc(href)}">${esc(t("fullPlanning"))}</a></div>` : ""}</div>`);
}

/* ───────────────────────────── Aide à la saisie : tutoriel d'admin et SKILL.md pour une IA ───────────────────────────── */

const TUTO_CSS = `.cpt{margin:1rem 0}.cpt *{box-sizing:border-box}.cpt summary,.cpt .cpt-dl{display:inline-flex;align-items:center;min-height:2.75rem;padding:.55rem 1rem;border:1px solid color-mix(in srgb,currentColor 35%,transparent);border-radius:.65rem;font-weight:600;cursor:pointer;text-decoration:none;color:inherit}.cpt summary:hover,.cpt .cpt-dl:hover{background:color-mix(in srgb,currentColor 8%,transparent)}.cpt summary:focus-visible,.cpt .cpt-dl:focus-visible{outline:2px solid currentColor;outline-offset:3px}.cpt-body{margin-top:1rem;max-width:60rem;line-height:1.5}.cpt-body h4{margin:1.25rem 0 .4rem;font-size:1.05rem}.cpt-body ol,.cpt-body ul{margin:.25rem 0;padding-left:1.4rem}.cpt-body li{margin:.25rem 0}.cpt-row{padding:.75rem 0;border-top:1px solid color-mix(in srgb,currentColor 18%,transparent)}.cpt-row dt{font-weight:700}.cpt-row dd{margin:.15rem 0 0}.cpt-row .cpt-k{display:block;opacity:.75;font-size:.9rem}.cpt-ex{margin:.5rem 0;padding:.75rem 1rem;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:.75rem}.cpt-ex dt{font-weight:700}.cpt-ex dd{margin:0 0 .4rem}.cpt-help{margin:.5rem 0 0;opacity:.8;font-size:.9rem}`;

const TUTO_FIELDS = ["Title", "When", "End", "Game", "Desc", "Place", "AllDay", "Repeat", "Cancel"];

/** Le tutoriel « Comment remplir mon agenda Google ? » (repliable) et le bouton de téléchargement du SKILL.md. Tout ce qui est dit ici est ce que le module lit. */
export function tutorialHtml(ctx, tz) {
  const t = (k, v) => esc(ctx.t(k, v));
  const rows = TUTO_FIELDS.map((f) => `<dl class="cpt-row"><dt>${t(`tuto${f}What`)}</dt><dd><span class="cpt-k">${t("tutoColWhere")}</span>${t(`tuto${f}Where`)}</dd><dd><span class="cpt-k">${t("tutoColDoes")}</span>${t(`tuto${f}Does`, { tz })}</dd></dl>`).join("");
  const li = (prefix, n) => Array.from({ length: n }, (_, i) => `<li>${t(`${prefix}${i + 1}`)}</li>`).join("");
  const ex = (title, when, place, desc) => `<dl class="cpt-ex"><dt>${t("tutoExFieldTitle")}</dt><dd>${esc(title)}</dd><dt>${t("tutoExFieldWhen")}</dt><dd>${esc(when)}</dd><dt>${t("tutoExFieldPlace")}</dt><dd>${esc(place)}</dd><dt>${t("tutoExFieldDesc")}</dt><dd>${esc(desc)}</dd></dl>`;
  const href = `/m/${encodeURIComponent(ctx.instance.key)}/skill?lang=${encodeURIComponent(ctx.locale)}`;
  return `<div class="cpt"><style>${TUTO_CSS}</style>` +
    `<details><summary>${t("tutoBtn")}</summary><div class="cpt-body"><p>${t("tutoIntro")}</p>${rows}` +
    `<h4>${t("tutoStepsTitle")}</h4><ol>${li("tutoStep", 5)}</ol>` +
    `<h4>${t("tutoExampleTitle")}</h4>${ex(ctx.t("tutoExTitle"), ctx.t("tutoExWhen"), ctx.t("tutoExPlace"), ctx.t("tutoExDesc"))}<p>${t("tutoExNoGameTitle")}</p>${ex(ctx.t("tutoExTitle"), ctx.t("tutoExWhen"), ctx.t("tutoExPlace"), ctx.t("tutoExNoGameDesc"))}` +
    `<h4>${t("tutoErrTitle")}</h4><ul>${li("tutoErr", 5)}</ul></div></details>` +
    `<p style="margin-top:.75rem"><a class="cpt-dl" href="${esc(href)}" download="SKILL.md">${t("skillBtn")}</a></p><p class="cpt-help">${t("skillHelp")}</p></div>`;
}

const oneLine = (v, max = 80) => String(v ?? "").replace(/[\u0000-\u001f\u007f`<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Le SKILL.md : généré à partir des réglages réels (fuseau, nom du site). Aucun secret : ni l'adresse du calendrier, ni aucune clé. */
export async function skillMarkdown(ctx) {
  const tz = isValidTimeZone(ctx.setting("timezone")) ? ctx.setting("timezone") : "UTC";
  let site = "";
  try { site = oneLine((await ctx.api.site(ctx.locale))?.name); } catch { site = ""; }
  const vars = { site: site || "ce site", tz };
  // L'en-tête YAML : chaînes JSON (guillemets doubles, échappées) = YAML valide quel que soit le nom du site.
  return `---\nname: ${ctx.t("skillName")}\ndescription: ${JSON.stringify(oneLine(ctx.t("skillDesc", vars), 400))}\n---\n\n${ctx.t("skillBody", vars)}\n`;
}

function emptyCardHtml(ctx) {
  const t = ctx.t;
  const href = planningHref(ctx);
  return wrapCards(`<div class="cpl-card cpl-empty"><p class="cpl-empty-t">${esc(t("noStream"))}</p><p class="cpl-empty-s">${esc(t("noStreamHint"))}</p>${href ? `<a class="cpl-link" href="${esc(href)}">${esc(t("fullPlanning"))}</a>` : ""}</div>`);
}

/** Une semaine (lundi → dimanche) de créneaux, passés compris : pour l'image à partager. */
async function loadWeek(ctx, weekOffset) {
  const url = String(ctx.setting("icsUrl") ?? "").trim();
  if (!url || !isPublicHttpsUrl(url)) return null;
  const timeZone = isValidTimeZone(ctx.setting("timezone")) ? ctx.setting("timezone") : "UTC";
  const text = await fetchIcs(url);
  if (text === null) return null;
  const range = getWeekRange(weekOffset, timeZone);
  const slots = parseIcs(text, { timeZone, windowEnd: range.end }).filter((e) => e.end >= range.start && e.start <= range.end);
  return { timeZone, range, days: buildDays(range.startWall, 7, slots, timeZone) };
}

/**
 * L'arborescence de l'image « semaine du X au Y » (voir ctx.api.png) : 900 px de large, mêmes couleurs que le site, une ligne par jour
 * en zigzag, au plus 2 streams par jour, jaquettes (3 au plus par stream) à gauche de l'heure et du titre — comme l'image de l'ancien site.
 * Un stream sans jaquette garde le nom de son jeu en petit sous le titre. `covers` : Map(nom du jeu -> adresse https).
 */
export function weekImage(ctx, week, site, covers = new Map()) {
  const c = ctx.theme, tz = week.timeZone;
  const box = (style, ...children) => ({ type: "div", props: { style: { display: "flex", ...style }, children } });
  const day = (d) => new Intl.DateTimeFormat(ctx.locale, { weekday: "long", timeZone: tz }).format(zonedTimeToUtc(d.wall.y, d.wall.m, d.wall.d, 12, 0, 0, tz));
  const short = (d) => new Intl.DateTimeFormat(ctx.locale, { day: "numeric", month: "short", timeZone: tz }).format(zonedTimeToUtc(d.wall.y, d.wall.m, d.wall.d, 12, 0, 0, tz));
  const label = `${short({ wall: week.range.startWall })} – ${short({ wall: week.range.endWall })}`;
  const empty = week.days.every((d) => d.streams.length === 0);
  const WIDTH = 900, PAD = 32, HEADER = 100, GAP = 16, LABEL = 170, INNER_GAP = 14, ROW_GAP = 10, PAD_X = 20, PAD_Y = 14, STREAM_GAP = 14, COVER_GAP = 6, COVER_ROW_GAP = 14, FOOTER = 50, EMPTY = 220;
  const BOX_WIDTH = WIDTH - PAD * 2 - LABEL - INNER_GAP;
  const ROW = Math.max(1, ...week.days.map((d) => Math.min(2, d.streams.length))) >= 2 ? 270 : 150;
  const height = empty ? PAD * 2 + HEADER + GAP + EMPTY + FOOTER + 24 : PAD * 2 + HEADER + GAP + week.days.length * ROW + (week.days.length - 1) * ROW_GAP + FOOTER + 24;
  const page = typeof ctx.instance.basePath === "string" && ctx.instance.basePath ? `/${ctx.instance.basePath}` : "";
  const footer = `${String(ctx.api.siteUrl ?? "").replace(/^https?:\/\//, "")}${page}`.slice(0, 80);

  const stream = (s, coverH) => {
    const list = coversOf(s, covers).slice(0, MAX_GAMES_PER_STREAM);
    const coverW = Math.round(coverH * (40 / 54));
    const textW = BOX_WIDTH - PAD_X * 2 - (list.length ? list.length * coverW + (list.length - 1) * COVER_GAP + COVER_ROW_GAP : 0);
    const games = list.length || s.allDay ? "" : extractGameNames(s.description).join(", ");
    return box({ alignItems: "center", gap: COVER_ROW_GAP },
      ...(list.length ? [box({ gap: COVER_GAP, flexShrink: 0 }, ...list.map((src) => ({ type: "img", props: { src, width: coverW, height: coverH, style: { borderRadius: 6, objectFit: "cover" } } })))] : []),
      box({ flexDirection: "column", justifyContent: "center", gap: 2, width: textW, ...(list.length ? { height: coverH } : {}) },
        box({ fontSize: 24, color: c.accent, fontWeight: 700 }, s.allDay ? ctx.t("allDay") : fmtTime(s.start, ctx.locale, tz)),
        box({ fontSize: 32, color: c.fg, lineHeight: 1.25, height: 32 * 1.25 * 2, overflow: "hidden" }, String(s.title).slice(0, 90)),
        ...(games ? [box({ fontSize: 22, color: c.muted }, games.slice(0, 60))] : [])));
  };
  const rows = week.days.map((d, i) => {
    const content = ROW - PAD_Y * 2;
    const shown = d.streams.slice(0, 2);
    const coverH = Math.round(shown.length === 2 ? (content - STREAM_GAP) / 2 : content);
    const label_ = box({ flexDirection: "column", justifyContent: "center", width: LABEL, height: ROW, flexShrink: 0 }, box({ fontSize: 34, color: c.fg, fontWeight: 700 }, day(d)), box({ fontSize: 24, color: c.muted }, short(d)));
    const card = box({ width: BOX_WIDTH, height: ROW, overflow: "hidden", alignItems: "center", backgroundColor: c.surface, borderRadius: 20, padding: `${PAD_Y}px ${PAD_X}px` },
      shown.length ? box({ flexDirection: "column", gap: STREAM_GAP, width: "100%" }, ...shown.map((s) => stream(s, coverH))) : box({ fontSize: 28, color: c.muted }, ctx.t("none")));
    return box({ gap: INNER_GAP, alignItems: "center" }, ...(i % 2 === 0 ? [label_, card] : [card, label_]));
  });
  const logo = site.logo ? [{ type: "img", props: { src: site.logo, width: 56, height: 56, style: { borderRadius: 28, objectFit: "cover" } } }] : [];
  const tree = box({ width: "100%", height: "100%", flexDirection: "column", backgroundColor: c.bg, padding: PAD },
    box({ justifyContent: "space-between", alignItems: "flex-start", height: HEADER },
      box({ flexDirection: "column" }, box({ fontSize: 60, fontWeight: 700, color: c.fg }, ctx.t("imageTitle")), box({ fontSize: 28, color: c.accent, marginTop: 4 }, label)),
      box({ alignItems: "center", gap: 14 }, box({ fontSize: 30, fontWeight: 700, color: c.fg }, String(site.name).slice(0, 30)), ...logo)),
    empty
      ? box({ flexDirection: "column", alignItems: "center", justifyContent: "center", height: EMPTY, marginTop: GAP, backgroundColor: c.surface, borderRadius: 20, gap: 10 }, box({ fontSize: 32, color: c.fg, fontWeight: 700 }, ctx.t("imageEmpty")), box({ fontSize: 24, color: c.muted }, ctx.t("imageEmptyHint")))
      : box({ flexDirection: "column", gap: ROW_GAP, marginTop: GAP }, ...rows),
    box({ marginTop: "auto", paddingTop: 24, fontSize: 22, color: c.accent, fontWeight: 700 }, footer));
  return { width: WIDTH, height, tree };
}

/** L'état du calendrier et les prochains créneaux (haut du panneau d'admin). */
async function adminStatusBlocks(ctx) {
    const t = ctx.t;
    const url = String(ctx.setting("icsUrl") ?? "").trim();
    const days = clampDays(ctx.setting("days"));
    const blocks = [{ type: "heading", text: t("adminStatus") }];
    if (!url) return [...blocks, { type: "markdown", text: t("adminNotSet") }];
    if (!isPublicHttpsUrl(url)) return [...blocks, { type: "markdown", text: t("badUrl") }];
    const { ok, slots, timeZone } = await loadSlots(ctx, Math.max(days, 14));
    const tz = timeZone ?? "UTC";
    blocks.push({ type: "markdown", text: t("adminHint", { hint: url.slice(-6) }) });
    if (!ok) return [...blocks, { type: "markdown", text: `⚠️ ${t("adminError")}` }, { type: "adminForm", action: "refresh", submitLabel: t("refresh"), fields: [] }];
    blocks.push({ type: "markdown", text: t("adminOk", { n: slots.filter((s) => s.start.getTime() <= Date.now() + days * 86_400_000).length, days }) });
    blocks.push({ type: "heading", text: t("adminNext") });
    blocks.push({ type: "table", columns: [t("date"), t("time"), t("slot"), t("games")], rows: slots.slice(0, 20).map((s) => [new Intl.DateTimeFormat(ctx.locale, { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(s.start), s.allDay ? t("allDay") : fmtTime(s.start, ctx.locale, tz), s.title, extractGameNames(s.description).join(", ")]) });
    // Jaquettes : un message clair plutôt qu'un manque silencieux (clé absente, refusée, RAWG injoignable, jeux inconnus de RAWG).
    const next = slots.slice(0, 20);
    const { covers, states } = await coversForSlots(ctx, next);
    if (states.size) {
      const all = [...states.entries()];
      const has = (st) => all.some(([, v]) => v === st);
      const lost = all.filter(([n, v]) => v === "none" && !covers.has(n)).map(([n]) => n);
      blocks.push({ type: "heading", text: t("coversTitle") });
      if (has("no_key")) blocks.push({ type: "markdown", text: t("coversNoKey") });
      else if (has("denied")) blocks.push({ type: "markdown", text: `⚠️ ${t("coversDenied")}` });
      else if (has("down") && !covers.size) blocks.push({ type: "markdown", text: `⚠️ ${t("coversDown")}` });
      else blocks.push({ type: "markdown", text: t("coversOk", { found: covers.size, total: states.size }) });
      if (lost.length) blocks.push({ type: "markdown", text: t("coversNone", { games: lost.map(escMd).join(", ") }) });
      const withCovers = next.filter((s) => coversOf(s, covers).length > 0);
      if (withCovers.length) blocks.push({ type: "html", html: withCovers.map((s) => slotHtml(s, ctx, tz, coversOf(s, covers), new Intl.DateTimeFormat(ctx.locale, { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(s.start))).join("") });
    }
    blocks.push({ type: "adminForm", action: "refresh", submitLabel: t("refresh"), fields: [] });
    return blocks;
}

export default {
  // Image PNG de la semaine (aussi pour une extension de panneau Twitch) : /m/<clé>/image?week=0 (0 = cette semaine, jusqu'à 8).
  routes: {
    // SKILL.md pour une IA (« Télécharger le skill »). Public : le contenu est généré à partir du fuseau et du nom du site, jamais de secret.
    async skill(request, ctx) {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      return new Response(request.method === "HEAD" ? null : await skillMarkdown(ctx), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": 'attachment; filename="SKILL.md"', "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" } });
    },
    async image(request, ctx) {
      const offset = Math.min(8, Math.max(0, Math.trunc(Number(new URL(request.url).searchParams.get("week"))) || 0));
      const week = await loadWeek(ctx, offset);
      if (!week) return new Response("Calendar not available", { status: 404 });
      const site = await ctx.api.site(ctx.locale);
      const shown = week.days.flatMap((d) => d.streams.slice(0, 2));
      const { covers } = await coversForSlots(ctx, shown);
      let res;
      // Une jaquette que le générateur d'images n'arrive pas à charger ne doit pas coûter l'image entière : on la refait sans jaquettes.
      try { res = await ctx.api.png(weekImage(ctx, week, site, covers)); } catch (e) { if (!covers.size) throw e; res = await ctx.api.png(weekImage(ctx, week, site)); }
      res.headers.set("Cache-Control", "public, max-age=300");
      return res;
    },
  },

  async page(ctx) {
    const days = clampDays(ctx.setting("days"));
    const { configured, ok, slots, timeZone } = await loadSlots(ctx, days);
    const tz = timeZone ?? "UTC";
    const blocks = [];
    if (!configured || !ok) {
      blocks.push({ type: "markdown", text: ctx.t("notConfigured") });
      return { title: ctx.t("title"), blocks };
    }
    blocks.push({ type: "markdown", text: ctx.t("intro", { days, tz }) });
    const { covers } = await coversForSlots(ctx, slots);
    let vis;   // logo du site : chargé seulement si un jour mêle streams avec et sans jaquette
    for (const day of buildDays(wallDateNow(tz), days, slots, tz)) {
      blocks.push({ type: "heading", text: fmtDay(day.wall, ctx.locale, tz) });
      const mixed = anyCover(day.streams, covers) && day.streams.some((s) => !coversOf(s, covers).length);
      if (mixed) vis ??= await brandVisual(ctx);
      blocks.push(anyCover(day.streams, covers)
        ? { type: "html", html: (mixed ? `<style>${CARD_CSS}</style>` : "") + day.streams.map((s) => slotHtml(s, ctx, tz, coversOf(s, covers), "", mixed ? vis : null)).join("") }
        : { type: "markdown", text: day.streams.length ? day.streams.map((s) => `- ${slotLine(s, ctx, tz)}`).join("\n") : `*${ctx.t("none")}*` });
    }
    return { title: ctx.t("title"), blocks };
  },

  sections: {
    // Le prochain stream, seul : une carte (jaquette, heure, indication relative, bouton vers la chaîne). Calendrier lisible mais vide : carte « rien de prévu ».
    async next(ctx) {
      const { ok, slots, timeZone } = await loadSlots(ctx, 30);
      if (!ok) return null;
      const heading = { type: "heading", text: ctx.t("nextUp") };
      if (slots.length === 0) return [heading, { type: "html", html: emptyCardHtml(ctx) }];
      const tz = timeZone ?? "UTC";
      const s = slots[0];
      const sameDay = (o) => { const a = wallDateNow(tz, s.start), b = wallDateNow(tz, o.start); return a.y === b.y && a.m === b.m && a.d === b.d; };
      const others = slots.slice(1).filter(sameDay).slice(0, 4);
      const { covers } = await coversForSlots(ctx, [s]);
      const vis = gameCovers(s, covers).length ? null : await brandVisual(ctx);
      return [heading, { type: "html", html: nextCardHtml(s, others, ctx, tz, covers, new Date(), vis) }];
    },

    // Miniature des X prochains jours : un jour par ligne, les créneaux à la suite.
    async days(ctx, options) {
      const count = Math.min(7, Math.max(1, Math.trunc(Number(options.count)) || 3));
      const { ok, slots, timeZone } = await loadSlots(ctx, count);
      if (!ok) return null;
      const tz = timeZone ?? "UTC";
      const rows = buildDays(wallDateNow(tz), count, slots, tz).map((day) => {
        const label = new Intl.DateTimeFormat(ctx.locale, { weekday: "short", day: "numeric", timeZone: tz }).format(zonedTimeToUtc(day.wall.y, day.wall.m, day.wall.d, 12, 0, 0, tz));
        return `- **${label}** · ${day.streams.length ? day.streams.map((s) => slotLine(s, ctx, tz)).join(" · ") : ctx.t("noneToday")}`;
      });
      return [{ type: "heading", text: ctx.t("daysTitle") }, { type: "markdown", text: rows.join("\n") }];
    },

    async upcoming(ctx, options) {
      const count = Math.min(20, Math.max(1, Math.trunc(Number(options.count)) || 5));
      const { ok, slots, timeZone } = await loadSlots(ctx, 30);
      if (!ok) return null;
      const heading = { type: "heading", text: ctx.t("nextTitle") };
      if (slots.length === 0) return [heading, { type: "html", html: emptyCardHtml(ctx) }];
      const tz = timeZone ?? "UTC";
      const shown = slots.slice(0, count);
      const { covers } = await coversForSlots(ctx, shown);
      const vis = shown.some((x) => !gameCovers(x, covers).length) ? await brandVisual(ctx) : null;
      return [heading, { type: "html", html: upcomingListHtml(shown, ctx, tz, covers, new Date(), vis) }];
    },
  },

  exports: {
    async "planning.slot"(ctx, { limit }) {
      const { slots } = await loadSlots(ctx, 30);
      return slots.slice(0, limit).map((s) => ({ title: s.title, text: extractGameNames(s.description).join(", ") || undefined, start: s.start.toISOString(), end: s.end.toISOString(), allDay: s.allDay, games: extractGameNames(s.description) }));
    },
  },

  async adminPanel(ctx) {
    const blocks = await adminStatusBlocks(ctx);
    const tz = isValidTimeZone(ctx.setting("timezone")) ? ctx.setting("timezone") : "UTC";
    return [...blocks, { type: "html", html: tutorialHtml(ctx, tz) }];
  },

  adminActions: {
    async refresh(ctx) {
      clearIcsCache();
      return { ok: ctx.t("refreshed") };
    },
  },

  mcp: {
    async planning_upcoming(ctx, args) {
      const days = clampDays(args.days);
      const { ok, slots } = await loadSlots(ctx, days);
      if (!ok) throw Object.assign(new Error("the calendar is not configured or cannot be read"), { expose: true });
      return slots.map((s) => ({ title: s.title, start: s.start.toISOString(), end: s.end.toISOString(), allDay: s.allDay, games: extractGameNames(s.description) }));
    },
  },
};
