// Streams saisis à la main — logique PURE : validation de la saisie, répétition chaque semaine, conversion en créneaux du sujet `planning.slot`.
// Aucune dépendance, ni stockage, ni horloge cachée. Les heures sont saisies en heure du fuseau de l'instance (« heure murale ») : la conversion tient
// compte de l'heure d'été.
const V = new URL(import.meta.url).search;
const { zonedTimeToUtc, addDaysToWall } = await import(`./dates.mjs${V}`);

const DAY = 86_400_000;
export const DEFAULT_MINUTES = 120;   // un stream sans heure de fin dure 2 h
export const MAX_GAMES = 3;
export const MAX_SKIPS = 60;
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
/** "21:30" ou "21h30" ou "9:05" ou "21h" -> { h, mi } sinon null. */
export function parseTime(v) {
  const m = /^(\d{1,2})\s*[:hH]\s*(\d{2})?$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2] ?? 0);
  return h <= 23 && mi <= 59 ? { h, mi } : null;
}
const dayNumber = (w) => Math.round(Date.UTC(w.y, w.m - 1, w.d) / DAY);

/** « Celeste, Hades + Hollow Knight » -> ["Celeste", "Hades", "Hollow Knight"] (3 au plus, comme partout). */
export function parseGames(v) {
  return String(v ?? "").split(/,|\s+\+\s+|\n/).map((n) => n.trim().slice(0, 80)).filter((n) => n.length >= 2).slice(0, MAX_GAMES);
}
const NOT_TWITCH = new Set(["videos", "directory", "downloads", "settings", "subscriptions", "friends", "wallet", "inventory", "drops", "prime", "turbo", "jobs", "store", "team", "popout", "embed", "moderator", "dashboard", "broadcast", "login", "signup", "search"]);
export const MAX_PARTNERS = 5;
const LOGIN_RE = /^[a-z0-9_]{4,25}$/;

/** « @Pseudo », « twitch.tv/pseudo », « https://www.twitch.tv/Pseudo/ » ou « pseudo » -> « pseudo » (minuscules, 4 à 25 lettres, chiffres ou _), sinon null. Même règle que Contacts. */
export function normalizeLogin(raw) {
  let s = String(raw ?? "").normalize("NFC").replace(/[​-‍﻿]/g, "").trim().replace(/^[<"'«“‘\s]+|[>"'»”’\s]+$/g, "").trim();
  if (!s || s.length > 300) return null;
  const m = /^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([^?#\s/]*)/i.exec(s);
  s = (m ? m[1] : s.replace(/^@/, "")).toLowerCase();
  return LOGIN_RE.test(s) && !NOT_TWITCH.has(s) ? s : null;
}

/** Sépare une liste écrite à la main : virgule, point-virgule, retour à la ligne, « + », « & », « et » / « and ». */
export const splitList = (text) => String(text ?? "").slice(0, 1000).split(/[,;\n\r]+|\s+(?:\+|&|et|and)\s+/i).map((x) => x.trim()).filter(Boolean);

/** « etoile_nord, @lune_douce » -> { list } (5 au plus, sans doublon) ou { error: "errPartners" | "errPartnersMax", pseudo? } : une saisie illisible est refusée, jamais devinée. */
export function parsePartners(v) {
  const out = [];
  for (const part of splitList(v)) {
    const login = normalizeLogin(part);
    if (!login) return { error: "errPartners", pseudo: part.slice(0, 40) };
    if (!out.includes(login)) out.push(login);
  }
  return out.length > MAX_PARTNERS ? { error: "errPartnersMax" } : { list: out };
}
/** « 2026-11-05, 2026-11-12 » -> dates valides (sans doublon). Une date illisible : null (la saisie est refusée). */
export function parseSkips(v) {
  const parts = String(v ?? "").split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length > MAX_SKIPS) return null;
  const out = [];
  for (const p of parts) { const d = parseDate(p); if (!d) return null; out.push(dateOf(d)); }
  return [...new Set(out)].sort();
}

/**
 * La saisie du formulaire -> stream à stocker, ou { error: <clé de message> }.
 * Un stream : titre, jour, heure de début, heure de fin (facultative : avant le début = le lendemain), jeux, toute la journée, annulé,
 * « chaque semaine » (jusqu'à une date facultative, en sautant des dates facultatives).
 */
export function cleanStream(v) {
  const title = str(v.title, 120);
  if (!title) return { error: "errTitle" };
  const day = parseDate(v.startDate);
  if (!day) return { error: "errDate" };
  const partners = parsePartners(v.partners);
  if (partners.error) return partners;
  const allDay = v.allDay === "yes" || v.allDay === true || v.allDay === "true";
  const out = { title, startDate: dateOf(day), allDay, startTime: "", endTime: "", games: parseGames(v.games), partners: partners.list, cancelled: v.cancelled === "yes" || v.cancelled === true, repeat: "none", repeatUntil: "", skip: [] };
  if (!allDay) {
    const t = parseTime(v.startTime);
    if (!t) return { error: "errStartTime" };
    out.startTime = `${pad(t.h)}:${pad(t.mi)}`;
    if (str(v.endTime, 10)) {
      const e = parseTime(v.endTime);
      if (!e) return { error: "errEndTime" };
      out.endTime = `${pad(e.h)}:${pad(e.mi)}`;
    }
  }
  if (v.repeat === "weekly") {
    out.repeat = "weekly";
    if (str(v.repeatUntil, 10)) {
      const until = parseDate(v.repeatUntil);
      if (!until || dayNumber(until) < dayNumber(day)) return { error: "errUntil" };
      out.repeatUntil = dateOf(until);
    }
    const skips = parseSkips(v.skip);
    if (skips === null) return { error: "errSkip" };
    out.skip = skips;
  }
  return { stream: out };
}

/** Jours (heure murale) des occurrences : de la première à la dernière, bornés par `hiDay` (numéro de jour) et plafonnés. Une date sautée n'est pas rendue. */
function* occurrenceDays(s, hiDay) {
  const start = parseDate(s.startDate);
  if (!start) return;
  if (s.repeat !== "weekly") { yield start; return; }
  const until = s.repeatUntil ? parseDate(s.repeatUntil) : null;
  const skip = new Set(Array.isArray(s.skip) ? s.skip : []);
  let cur = start;
  for (let week = 0; week < 6000; week++) {
    if (until && dayNumber(cur) > dayNumber(until)) return;
    if (dayNumber(cur) > hiDay) return;
    if (!skip.has(dateOf(cur))) yield cur;
    cur = addDaysToWall(cur.y, cur.m, cur.d, 7);
  }
}

/**
 * Les créneaux (sujet `planning.slot`) d'un stream saisi, pour la plage [from, to] (chevauchement). `id` : identifiant du document, suivi de la date pour une
 * répétition. Journée entière : `day` donne la date, `start` / `end` sont minuit local et le minuit suivant ; sinon des instants ISO 8601 UTC.
 */
export function slotsOf(id, s, { from, to, timeZone = "UTC", untitled = "" }) {
  const start = parseDate(s.startDate);
  if (!start) return [];
  const t = s.allDay ? null : parseTime(s.startTime);
  if (!s.allDay && !t) return [];
  const e = !s.allDay && s.endTime ? parseTime(s.endTime) : null;
  const hiDay = Math.floor(to.getTime() / DAY) + 2, loDay = Math.floor(from.getTime() / DAY) - 3;   // les jours trop éloignés ne sont pas convertis en heure UTC
  const loMs = from.getTime(), hiMs = to.getTime();
  const games = Array.isArray(s.games) ? s.games.filter((g) => typeof g === "string").slice(0, MAX_GAMES) : [];
  const partners = Array.isArray(s.partners) ? [...new Set(s.partners.map(normalizeLogin).filter(Boolean))].slice(0, MAX_PARTNERS) : [];
  const out = [];
  for (const occ of occurrenceDays(s, hiDay)) {
    if (dayNumber(occ) < loDay) continue;
    let startMs, endMs;
    if (s.allDay) {
      const next = addDaysToWall(occ.y, occ.m, occ.d, 1);
      startMs = zonedTimeToUtc(occ.y, occ.m, occ.d, 0, 0, 0, timeZone).getTime();
      endMs = zonedTimeToUtc(next.y, next.m, next.d, 0, 0, 0, timeZone).getTime();
    } else {
      startMs = zonedTimeToUtc(occ.y, occ.m, occ.d, t.h, t.mi, 0, timeZone).getTime();
      if (e) {
        const sameDay = e.h > t.h || (e.h === t.h && e.mi > t.mi);   // une fin « avant » le début : le stream finit le lendemain
        const last = sameDay ? occ : addDaysToWall(occ.y, occ.m, occ.d, 1);
        endMs = zonedTimeToUtc(last.y, last.m, last.d, e.h, e.mi, 0, timeZone).getTime();
      } else endMs = startMs + DEFAULT_MINUTES * 60_000;
    }
    if (endMs < loMs || startMs > hiMs) continue;
    out.push({
      id: s.repeat === "weekly" ? `${id}@${dateOf(occ)}` : id,
      title: s.title || untitled, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), allDay: !!s.allDay,
      status: s.cancelled ? "cancelled" : "confirmed", timezone: timeZone, games,
      ...(games.length ? { text: games.join(", ") } : {}), ...(partners.length ? { partners } : {}), ...(s.allDay ? { day: dateOf(occ) } : {}),
    });
  }
  return out;
}
