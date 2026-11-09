// The small rules of "Announcement story", with no knowledge of Curiosa, Twitch or the browser (no ctx, no network, no hidden clock:
// the "now" time is always given by the caller). This file is run EXACTLY as it is by the server, by the editor page and by the tests
// (it also works in a blank `vm`: no import, no Node or browser API other than `Intl`).

/* ───────────── The formats: ONE table ─────────────
 * `margins`: the safe area, where everything essential goes (in pixels of the format). `zones`: what is hidden or cropped (shown on the preview only).
 * Vertical: the top (250 px) and the bottom (340 px) of a story are covered by the account name and the reply bar.
 * Passport (4:5, the almost-square portrait): the profile grid crops the centre to 3:4, so 34 px are lost on each side; margins of 64 px, top and bottom of 60 px.
 * Changing the ratio = changing one line of this table. */
export const FORMATS = [
  { id: "vertical", width: 1080, height: 1920, margins: { top: 250, bottom: 340, left: 64, right: 64 },
    zones: [{ id: "ui", x: 0, y: 0, w: 1080, h: 250 }, { id: "ui", x: 0, y: 1580, w: 1080, h: 340 }] },
  { id: "passeport", width: 1080, height: 1350, margins: { top: 60, bottom: 60, left: 64, right: 64 },
    zones: [{ id: "grid", x: 0, y: 0, w: 34, h: 1350 }, { id: "grid", x: 1046, y: 0, w: 34, h: 1350 }] },
];
/** The animation styles: the first four since 1.0, then six styles of very different character (2.7.0). The order is the one of the editor's picker. */
export const STYLES = ["neon", "poster", "countdown", "minimal", "broadcast", "kinetic", "cinema", "arcade", "collage", "geometric"];
export const ELEMENTS = ["title", "when", "countdown", "game", "brand", "text", "costreamers"];
/**
 * The style of the preview while the person edits the event and the information (steps 1 and 2), before any style is chosen. Minimal: a plain background, left-aligned blocks
 * that stack in a fixed order, no frame, bar, stamp or ticker that would look wrong around a missing field, and nothing but the text moves. It is also the style that "Generate now" uses
 * until a style is chosen, so a video is never made in a style that the person has not seen in the preview.
 */
export const EDIT_STYLE = "minimal";
/** The style a person remembered as their default, or null (never chosen, or a value that is no longer a style). */
export const defaultStyleOf = (v) => (typeof v === "string" && STYLES.includes(v) ? v : null);
/** The style drawn in the preview: on the last step, or once a style is chosen, the style of the cards; before that, the person's default style, else the plain editing style. */
export const previewStyleFor = ({ step, styleChosen, style, defaultStyle }) => (step === 3 || styleChosen ? style : defaultStyleOf(defaultStyle) ?? EDIT_STYLE);
/** What a NEW video shows: everything but the countdown (a person who wants it ticks it). Saved models keep what they stored. */
export const DEFAULT_ELEMENTS = Object.freeze(ELEMENTS.filter((e) => e !== "countdown"));
/** The element a style needs to be itself: the "countdown" style draws big numbers that come from the "countdown" element. */
export const STYLE_NEEDS = Object.freeze({ countdown: "countdown" });
/** The list of elements to show for this style: the one given, plus the element the style needs (nothing is ever removed). */
export function elementsForStyle(style, elements) {
  const list = Array.isArray(elements) ? elements : DEFAULT_ELEMENTS, need = STYLE_NEEDS[style];
  return need && !list.includes(need) ? ELEMENTS.filter((e) => e === need || list.includes(e)) : ELEMENTS.filter((e) => list.includes(e));
}
export const LANGS = ["fr", "en"];
export const LIMITS = { title: 80, text: 140, channelName: 40, modelName: 60, displayName: 40, costreamers: 6, partners: 5, adhoc: 20, handle: 40, memberId: 80, models: 30, durationMin: 5, durationMax: 15, durationDefault: 15, fps: 30, streams: 12 };

export const formatOf = (id) => FORMATS.find((f) => f.id === id) ?? FORMATS[0];
/** The area where essential content can be placed: { x, y, w, h }. */
export function safeArea(format) {
  const f = typeof format === "string" ? formatOf(format) : format, m = f.margins;
  return { x: m.left, y: m.top, w: f.width - m.left - m.right, h: f.height - m.top - m.bottom };
}

/* ───────────── Text ───────────── */

/** One line of text: no control characters, spaces collapsed, cut at `max` (whole characters, never in the middle of an emoji). */
export function oneLine(v, max) {
  const s = String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return [...s].slice(0, max).join("");
}
/** A free sentence: up to 3 lines (line breaks kept), no control characters, cut at `max` characters in total. */
export function freeText(v, max) {
  const lines = String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ").replace(/\p{Zl}|\p{Zp}/gu, "\n").split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  return [...lines.slice(0, 3).join("\n")].slice(0, max).join("");
}

/** A Twitch handle: 4 to 25 characters, letters, digits and _ (lowercase). */
export const LOGIN = /^[a-z0-9_]{4,25}$/;
const NOT_CHANNELS = new Set(["videos", "directory", "downloads", "settings", "subscriptions", "friends", "wallet", "inventory", "drops", "prime", "turbo", "jobs", "store", "team", "popout", "embed", "moderator", "dashboard", "broadcast", "login", "signup", "search"]);
/** Reads what the person typed: `handle`, `@handle` or `twitch.tv/handle`. Returns { login } or { error: "empty" | "invalid" | "not_channel" }. */
export function normalizeLogin(input) {
  let s = String(input ?? "").trim();
  if (!s) return { error: "empty" };
  const url = /^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([^/?#\s]*)/i.exec(s);
  if (url) { try { s = decodeURIComponent(url[1]); } catch { s = url[1]; } if (!s) return { error: "invalid" }; } else s = s.replace(/^@/, "");
  s = s.toLowerCase();
  if (NOT_CHANNELS.has(s)) return { error: "not_channel" };
  return LOGIN.test(s) ? { login: s } : { error: "invalid" };
}

/** An image address the page can use: a site path (`/uploads/…`) or an https address. Nothing else (never `javascript:` or `data:`). */
export function safeImageUrl(v) {
  const s = String(v ?? "").trim();
  if (!s || s.length > 500 || /[\u0000-\u001f\u007f\s"'<>\\]/.test(s)) return "";
  if (/^\/(?!\/)/.test(s)) return s;
  return /^https:\/\/[^/]+\//.test(s) ? s : "";
}

/* ───────────── The guest streamers of a video ─────────────
 * An entry is ONE of these two forms:
 *   { id }                          a REFERENCE to a Contacts card (opaque identifier: nothing is assumed about its shape). Name, handle and photo stay in Contacts;
 *   { login, name, image }          a guest streamer "for this video only": typed by hand, never a card. `login` is a free handle, `name` a name, `image` an https address
 *                                   (the server only relays it if the host is allowed); at least one of the two, handle or name.
 * A version 1 model kept a simple list of Twitch handles ("alice_tv"): it is read as "for this video only" entries (they are kept as such: the conversion into references was removed in 2.9.0). */
const MEMBER_ID = /^[^\s\u0000-\u001f\u007f]{1,80}$/;
export const NETWORKS = ["twitch", "youtube", "tiktok", "instagram", "discord", "x", "bluesky", "mastodon", "web", "other"];
const httpsImage = (v) => { const u = safeImageUrl(v); return /^https:\/\//.test(u) ? u : ""; };
/** An entry put in the right format, or null. */
export function cleanMember(x) {
  if (typeof x === "string") { const n = normalizeLogin(x); return n.login ? { login: n.login, name: "", image: "" } : null; }
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  if (x.id !== undefined) return typeof x.id === "string" && MEMBER_ID.test(x.id) ? { id: x.id } : null;
  const login = oneLine(x.login, LIMITS.handle).replace(/^@+/, ""), name = oneLine(x.name, LIMITS.displayName);
  return login || name ? { login, name, image: httpsImage(x.image) } : null;
}
/** What makes two entries "the same person" in a video. */
export const memberKey = (m) => (m.id ? `id:${m.id}` : `x:${(m.login || m.name).toLowerCase()}`);

/* ───────────── The settings of a generation ───────────── */

/** The identifier of an event (given by its source, stable) and the type of its source ("calendar", "youtube"…): short safe strings, never an address. */
export const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,99}$/;
export const SOURCE_KIND = /^[a-z][a-z0-9-]{0,19}$/;
export const DEFAULT_CONFIG = Object.freeze({ style: "neon", format: "vertical", duration: LIMITS.durationDefault, elements: DEFAULT_ELEMENTS.slice(), text: "", channelName: "", costreamers: [], streamKey: "", eventId: "", eventSource: "", lang: "fr", watermark: false, schedulePeople: true });

/** The brand mention, drawn at the bottom of the video when the box is ticked. It is a brand name: it is NEVER translated (so it is absent from the locales). */
export const WATERMARK_LEAD = "Made with ", WATERMARK_NAME = "Curiosa", WATERMARK_TEXT = WATERMARK_LEAD + WATERMARK_NAME;
/** The name "Curiosa" follows the logo's style: Fraunces italic 600 (module file, SIL OFL licence), at 1.15 times the size of the neighbouring text as in the site's footer. */
export const WORDMARK = { family: "CuriosaWordmark", weight: 600, scale: 1.15, fallback: "Georgia, serif" };

/** Puts any input (saved model, AI, browser) in the right format: unknown values dropped, durations and lengths bounded. Never throws. */
export function cleanConfig(raw, fallback = DEFAULT_CONFIG) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const d = fallback && typeof fallback === "object" ? fallback : DEFAULT_CONFIG;
  const style = STYLES.includes(r.style) ? r.style : STYLES.includes(d.style) ? d.style : DEFAULT_CONFIG.style;
  const format = FORMATS.some((f) => f.id === r.format) ? r.format : FORMATS.some((f) => f.id === d.format) ? d.format : DEFAULT_CONFIG.format;
  const dn = Number(r.duration);
  const duration = Number.isInteger(dn) && dn >= LIMITS.durationMin && dn <= LIMITS.durationMax ? dn : Number.isFinite(dn) && dn > 0 ? Math.min(LIMITS.durationMax, Math.max(LIMITS.durationMin, Math.round(dn))) : cleanConfigDuration(d.duration);
  const elements = Array.isArray(r.elements) ? ELEMENTS.filter((e) => r.elements.includes(e)) : ELEMENTS.filter((e) => (Array.isArray(d.elements) ? d.elements : DEFAULT_ELEMENTS).includes(e));
  const members = [], seen = new Set();
  for (const x of Array.isArray(r.costreamers) ? r.costreamers : Array.isArray(d.costreamers) ? d.costreamers : []) {
    const m = cleanMember(x);
    if (m && !seen.has(memberKey(m)) && members.length < LIMITS.costreamers) { seen.add(memberKey(m)); members.push(m); }
  }
  return {
    style, format, duration, elements,
    text: freeText(r.text ?? d.text, LIMITS.text),
    channelName: oneLine(r.channelName ?? d.channelName, LIMITS.channelName),
    costreamers: members,
    streamKey: /^[a-z0-9]{1,20}$/.test(String(r.streamKey ?? "")) ? String(r.streamKey) : /^[a-z0-9]{1,20}$/.test(String(d.streamKey ?? "")) && r.streamKey === undefined ? String(d.streamKey) : "",
    // The event chosen for the video: its identifier (given by its source) and the type of its source. One without the other makes no sense: both valid, otherwise nothing.
    ...pickEvent(r, d),
    lang: LANGS.includes(r.lang) ? r.lang : LANGS.includes(d.lang) ? d.lang : "fr",
    // The "Made with Curiosa" mention: a simple yes/no, NO by default. Only an explicit `true` adds it (never a string, a 1 or an object).
    watermark: typeof r.watermark === "boolean" ? r.watermark : r.watermark === undefined && d.watermark === true,
    // The people the schedule lists for this stream ("With …"): YES by default; only an explicit `false` removes them (a model saved before this option shows them too).
    schedulePeople: r.schedulePeople === false ? false : r.schedulePeople === undefined ? d.schedulePeople !== false : true,
  };
}
function pickEvent(r, d) {
  const read = (x) => (typeof x?.eventId === "string" && EVENT_ID.test(x.eventId) && typeof x?.eventSource === "string" && SOURCE_KIND.test(x.eventSource) ? { eventId: x.eventId, eventSource: x.eventSource } : null);
  const own = read(r);
  if (own) return own;
  if (r.eventId === undefined && r.eventSource === undefined) return read(d) ?? { eventId: "", eventSource: "" };
  return { eventId: "", eventSource: "" };
}
const cleanConfigDuration = (n) => (Number.isInteger(n) && n >= LIMITS.durationMin && n <= LIMITS.durationMax ? n : LIMITS.durationDefault);

/** A small text fingerprint (FNV-1a), in base 36: used as the short identifier of a stream. */
export function shortHash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text ?? "")) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
export const streamKeyOf = (slot) => shortHash(`${slot?.id ?? ""}|${slot?.start ?? ""}|${slot?.title ?? ""}`);

/* ───────────── Dates and times (Intl only) ───────────── */

export function validZone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 60) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
const pad = (n) => String(n).padStart(2, "0");
const dtfCache = new Map();
function dtf(tz, key, opts) {
  const k = `${tz}|${key}`;
  let f = dtfCache.get(k);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", ...opts }); dtfCache.set(k, f); }
  return f;
}
/** The date and time "on the clock" of the time zone: { y, m, d, h, mi, wd } (wd: 0 = Sunday). */
export function wallParts(ms, tz) {
  const parts = dtf(tz, "wall", { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" }).formatToParts(new Date(ms));
  const g = (t) => parts.find((p) => p.type === t)?.value ?? "0";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  return { y: Number(g("year")), m: Number(g("month")), d: Number(g("day")), h: Number(g("hour")) % 24, mi: Number(g("minute")), wd };
}
/** The instant (in ms) when the clock of time zone `tz` shows this date and time. A daylight-saving day is handled (two tries). */
export function zonedToUtc(y, m, d, h, mi, tz) {
  const asUtc = Date.UTC(y, m - 1, d, h, mi);
  let guess = asUtc;
  for (let i = 0; i < 3; i++) {
    const w = wallParts(guess, tz);
    const shown = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi);
    const diff = asUtc - shown;
    if (diff === 0) return guess;
    guess += diff;
  }
  return guess;
}
const dayNumber = (p) => Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86_400_000);
/** Number of calendar days between "now" and the start, on the clock of the time zone (0 = the same day, 1 = tomorrow, -1 = yesterday). */
export const dayDiff = (startMs, nowMs, tz) => dayNumber(wallParts(startMs, tz)) - dayNumber(wallParts(nowMs, tz));

const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** "Samedi 24 octobre" / "Saturday, October 24". */
export function formatDay(ms, tz, lang) {
  const loc = lang === "en" ? "en-GB" : "fr-FR";
  const f = new Intl.DateTimeFormat(loc, { timeZone: tz, weekday: "long", day: "numeric", month: "long" });
  return capital(f.format(new Date(ms)));
}
/** "19 h 30" ("19 h" exactly) in French; "7:30 PM" in English. */
export function formatTime(ms, tz, lang) {
  const w = wallParts(ms, tz);
  if (lang === "en") return `${w.h % 12 === 0 ? 12 : w.h % 12}:${pad(w.mi)} ${w.h < 12 ? "AM" : "PM"}`;
  return w.mi === 0 ? `${w.h} h` : `${w.h} h ${pad(w.mi)}`;
}
/** "2026-10-22": the date of the stream on the clock of the time zone (used for the file name). */
export function isoDay(ms, tz) { const w = wallParts(ms, tz); return `${w.y}-${pad(w.m)}-${pad(w.d)}`; }

/**
 * The countdown text, computed at the instant `nowMs` (the one of the generation) for a stream that starts at `startMs`.
 * "Dans 45 min" · "Dans 2 h 15" · "Ce soir à 19 h 30" · "Aujourd'hui à 14 h" · "Demain à 19 h 30" · "Dans 4 jours" · "C'est maintenant" (English: "In 45 min", "Tonight at 7:30 PM", "Tomorrow"…).
 * A stream more than 3 hours in the past: nothing ("").
 */
export function countdownText({ startMs, nowMs, tz, lang, allDay = false }) {
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs) || !validZone(tz)) return "";
  const en = lang === "en";
  const diff = startMs - nowMs, days = dayDiff(startMs, nowMs, tz);
  if (allDay) {
    if (days < 0) return "";
    if (days === 0) return en ? "Today" : "Aujourd'hui";
    if (days === 1) return en ? "Tomorrow" : "Demain";
    return en ? `In ${days} days` : `Dans ${days} jours`;
  }
  if (diff < -3 * 3_600_000) return "";
  if (diff <= 60_000) return en ? "Starting now" : "C'est maintenant";
  const mins = Math.ceil(diff / 60_000);
  if (diff < 3_600_000) return en ? `In ${mins} min` : `Dans ${mins} min`;
  const time = formatTime(startMs, tz, lang);
  if (diff < 6 * 3_600_000) {
    const h = Math.floor(mins / 60), m = mins % 60;
    return en ? `In ${h}h${m ? ` ${pad(m)}m` : ""}` : `Dans ${h} h${m ? ` ${pad(m)}` : ""}`;
  }
  if (days === 0) return wallParts(startMs, tz).h >= 18 ? (en ? `Tonight at ${time}` : `Ce soir à ${time}`) : (en ? `Today at ${time}` : `Aujourd'hui à ${time}`);
  if (days === 1) return en ? `Tomorrow at ${time}` : `Demain à ${time}`;
  if (days < 0) return en ? "Starting now" : "C'est maintenant";
  return en ? `In ${days} days` : `Dans ${days} jours`;
}
/** The three figures of the big countdown: { days, hours, minutes, started }. Beyond 99 days: 99 days. */
export function countdownParts(startMs, nowMs) {
  const diff = Number.isFinite(startMs) && Number.isFinite(nowMs) ? startMs - nowMs : 0;
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, started: true };
  const total = Math.ceil(diff / 60_000), days = Math.min(99, Math.floor(total / 1440));
  return { days, hours: Math.floor((total % 1440) / 60), minutes: total % 60, started: false };
}

/* ───────────── The streams ───────────── */

/**
 * The items of the `planning.slot` topic → the next streams { key, title, start (ISO), startMs, allDay, day, games, timezone }, from `nowMs`.
 * A cancelled or unreadable stream is dropped alone; a stream that started less than 3 h ago is still offered; two identical announcements make one.
 */
/** The Twitch handles of the people of an event (list given by the schedule): cleaned by the same rule as the input, no duplicates, 5 at most. */
export function partnerLogins(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const n = typeof x === "string" ? normalizeLogin(x) : null;
    if (n?.login && !out.includes(n.login) && out.length < LIMITS.partners) out.push(n.login);
  }
  return out;
}
export function upcomingStreams(items, nowMs, fallbackZone = "UTC", max = LIMITS.streams) {
  const out = [], seen = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== "object" || it.status === "cancelled") continue;
    const parsed = typeof it.start === "string" ? Date.parse(it.start) : NaN;
    if (!Number.isFinite(parsed)) continue;
    const allDay = it.allDay === true, slotZone = validZone(it.timezone) ? it.timezone : "";
    const tz = slotZone || (validZone(fallbackZone) ? fallbackZone : "UTC");
    const day = allDay && typeof it.day === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(it.day) : null;
    const startMs = day ? zonedToUtc(Number(day[1]), Number(day[2]), Number(day[3]), 0, 0, tz) : parsed;
    if (!Number.isFinite(startMs)) continue;
    const endParsed = typeof it.end === "string" ? Date.parse(it.end) : NaN;
    const endMs = Number.isFinite(endParsed) && endParsed > startMs ? endParsed : startMs + (allDay ? 86_400_000 : 3_600_000);
    if (endMs < nowMs && startMs < nowMs - 3 * 3_600_000) continue;
    if (startMs < nowMs - 3 * 3_600_000) continue;
    const title = oneLine(it.title, LIMITS.title);
    const games = (Array.isArray(it.games) ? it.games : []).filter((g) => typeof g === "string").map((g) => oneLine(g, 80)).filter(Boolean).slice(0, 3);
    const dedupe = `${title}|${startMs}|${allDay}`;
    if (seen.has(dedupe)) { const first = out.find((x) => `${x.title}|${x.startMs}|${x.allDay}` === dedupe); if (first) first.partners = partnerLogins([...first.partners, ...(Array.isArray(it.partners) ? it.partners : [])]); continue; }   // the same stream in two schedules: their people are merged
    seen.add(dedupe);
    out.push({ key: streamKeyOf({ id: it.id, start: it.start, title: it.title }), title, start: new Date(startMs).toISOString(), startMs, allDay, day: day ? it.day : "", games, partners: allDay ? [] : partnerLogins(it.partners), timezone: slotZone || (allDay ? tz : "") });
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.title.localeCompare(b.title)).slice(0, max);
}

/**
 * When an event given by a source starts (and ends): { startMs, endMs, allDay, day, zone } or null if it is unreadable.
 * `start` / `end`: ISO 8601 instants (UTC preferably); `allDay` + `day` (YYYY-MM-DD): a whole day on the clock of `timezone` (or `fallbackZone`).
 * Same rule as for the streams of the schedules: a whole day starts at midnight of the time zone, and lasts 24 h (23 or 25 h on a daylight-saving day, but here it is only used for sorting).
 */
export function eventTimes(it, fallbackZone = "UTC") {
  if (!it || typeof it !== "object") return null;
  const parsed = typeof it.start === "string" ? Date.parse(it.start) : NaN;
  const allDay = it.allDay === true, own = validZone(it.timezone) ? it.timezone : "";
  const zone = own || (validZone(fallbackZone) ? fallbackZone : "UTC");
  const d = allDay && typeof it.day === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(it.day) : null;
  const startMs = d ? zonedToUtc(Number(d[1]), Number(d[2]), Number(d[3]), 0, 0, zone) : parsed;
  if (!Number.isFinite(startMs) || startMs < Date.UTC(1971, 0, 1) || startMs > Date.UTC(2099, 0, 1)) return null;
  const endParsed = typeof it.end === "string" ? Date.parse(it.end) : NaN;
  const endMs = Number.isFinite(endParsed) && endParsed > startMs ? endParsed : startMs + (allDay ? 86_400_000 : 3_600_000);
  return { startMs, endMs, allDay, day: d ? it.day : "", zone: own || (allDay ? zone : "") };
}

/** A hand-written stream (title, day YYYY-MM-DD, time HH:MM) → a stream as above, or { error }. */
export function manualStream({ title, date, time }, tz) {
  const t = oneLine(title, LIMITS.title);
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? "")), h = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? ""));
  if (!t) return { error: "title" };
  if (!d || Number(d[2]) < 1 || Number(d[2]) > 12 || Number(d[3]) < 1 || Number(d[3]) > 31) return { error: "date" };
  const zone = validZone(tz) ? tz : "UTC";
  const allDay = !String(time ?? "").trim();
  if (!allDay && (!h || Number(h[1]) > 23 || Number(h[2]) > 59)) return { error: "time" };
  const startMs = zonedToUtc(Number(d[1]), Number(d[2]), Number(d[3]), allDay ? 0 : Number(h[1]), allDay ? 0 : Number(h[2]), zone);
  const w = wallParts(startMs, zone);
  if (w.d !== Number(d[3]) || w.m !== Number(d[2])) return { error: "date" };   // a 31 February
  return { key: "manual", title: t, start: new Date(startMs).toISOString(), startMs, allDay, day: allDay ? String(date) : "", games: [], timezone: zone, manual: true };
}

/**
 * The editable information of a video ("step 2"): { title, date (YYYY-MM-DD), time (HH:MM, empty = whole day), game }, read from a stream on the clock of its own
 * time zone (or `tz`). With no stream, everything is empty.
 */
export function infoFromStream(stream, tz = "UTC") {
  const empty = { title: "", date: "", time: "", game: "" };
  if (!stream || typeof stream !== "object") return empty;
  const zone = validZone(stream.timezone) ? stream.timezone : validZone(tz) ? tz : "UTC", has = Number.isFinite(stream.startMs);
  const w = has ? wallParts(stream.startMs, zone) : null;
  return {
    title: oneLine(stream.title, LIMITS.title),
    date: has ? (stream.allDay && /^\d{4}-\d{2}-\d{2}$/.test(String(stream.day ?? "")) ? stream.day : isoDay(stream.startMs, zone)) : "",
    time: has && !stream.allDay ? `${pad(w.h)}:${pad(w.mi)}` : "",
    game: oneLine(Array.isArray(stream.games) ? stream.games[0] : "", 80),
  };
}

/**
 * The stream that the video is made from, drawn from the editable information. `base`: the event the information came from (or null for "no event"); when the day and the time
 * are still the event's own, its exact start (and zone) is kept. Returns { stream, error }: `stream` is null when there is nothing to say about an event (no title, day or game);
 * `error` is "date" (a time without a valid day, or a day that does not exist) or "time", the stream then being built without its day.
 */
export function streamFromInfo(info, { base = null, tz = "UTC" } = {}) {
  const i = info && typeof info === "object" ? info : {};
  const title = oneLine(i.title, LIMITS.title), game = oneLine(i.game, 80), date = String(i.date ?? "").trim(), time = String(i.time ?? "").trim();
  const zone = base && validZone(base.timezone) ? base.timezone : validZone(tz) ? tz : "UTC";
  let when = null, error = "";
  if (date) {
    const own = base ? infoFromStream(base, tz) : null;
    if (own && own.date === date && own.time === time && Number.isFinite(base.startMs)) when = { startMs: base.startMs, allDay: base.allDay === true, day: base.day || "" };
    else {
      const m = manualStream({ title: "x", date, time }, zone);
      if (m.error) error = m.error; else when = { startMs: m.startMs, allDay: m.allDay, day: m.day };
    }
  } else if (time) error = "date";
  if (!title && !game && !when) return { stream: null, error };
  return {
    stream: { key: base?.key || "manual", title, start: when ? new Date(when.startMs).toISOString() : "", startMs: when ? when.startMs : null, allDay: when ? when.allDay : false, day: when ? when.day : "", games: game ? [game] : [], timezone: base?.timezone || "", manual: !base },
    error,
  };
}

/* ───────────── What the video says ───────────── */

/**
 * Everything the video writes, ready to draw: an element is present only if it is chosen AND has something to show.
 * `stream`: a stream (see above) or null; `coStreamers`: [{ login, name }] already chosen; `site`: { name }; `nowMs`: the instant of the generation.
 */
export function buildContent(config, { stream, coStreamers = [], site = {}, nowMs, tz }) {
  const c = cleanConfig(config), has = (e) => c.elements.includes(e);
  const zone = validZone(stream?.timezone) ? stream.timezone : validZone(tz) ? tz : "UTC";
  const out = { lang: c.lang, title: "", dayLine: "", timeLine: "", countdown: "", parts: null, game: "", brand: "", text: "", costreamers: [], zone, startMs: stream?.startMs ?? null };
  if (stream) {
    if (has("title")) out.title = oneLine(stream.title, LIMITS.title);
    const dated = Number.isFinite(stream.startMs);   // an event written by hand may have no day yet
    if (has("when") && dated) { out.dayLine = formatDay(stream.startMs, zone, c.lang); out.timeLine = stream.allDay ? "" : formatTime(stream.startMs, zone, c.lang); }
    if (has("countdown") && dated) { out.countdown = countdownText({ startMs: stream.startMs, nowMs, tz: zone, lang: c.lang, allDay: stream.allDay }); out.parts = stream.allDay ? null : countdownParts(stream.startMs, nowMs); }
    if (has("game") && stream.games?.[0]) out.game = oneLine(stream.games[0], 80);
  }
  if (has("brand")) out.brand = oneLine(c.channelName || site.name, LIMITS.channelName);
  if (has("text")) out.text = freeText(c.text, LIMITS.text);
  if (has("costreamers")) {
    // 6 at most: beyond that, the first 5 then a last "+N" pill (never a sixth person hidden without saying so).
    const all = coStreamers.filter((x) => x && (x.login || x.name)), shown = all.length > LIMITS.costreamers ? all.slice(0, LIMITS.costreamers - 1) : all;
    out.costreamers = shown.map((x) => ({ login: String(x.login || x.name), name: oneLine(x.name || x.login, LIMITS.displayName) }));
    if (all.length > shown.length) out.costreamers.push({ login: "+more", name: `+${all.length - shown.length}`, more: true });
  }
  return out;
}

/** The file name: annonce-2026-10-22-vertical.mp4 (announcement-… in English). */
export function fileName({ startMs, tz, format, lang, ext, nowMs }) {
  const day = Number.isFinite(startMs) && validZone(tz) ? isoDay(startMs, tz) : isoDay(nowMs ?? 0, "UTC");
  return `${lang === "en" ? "announcement" : "annonce"}-${day}-${FORMATS.some((f) => f.id === format) ? format : "vertical"}.${ext === "webm" ? "webm" : "mp4"}`;
}

/* ───────────── Breaking into lines ───────────── */

/**
 * Breaks a text into lines that fit `maxWidth` (`measure(text)` returns the width). Wanted line breaks are respected; a word that is too long is cut;
 * beyond `maxLines`, the last line ends with "…". Returns an array of lines (never empty for a non-empty text).
 */
export function wrapText(measure, text, maxWidth, maxLines = 3) {
  const lines = [];
  for (const para of String(text ?? "").split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { if (lines.length) lines.push(""); continue; }
    let cur = "";
    const push = () => { lines.push(cur); cur = ""; };
    for (let w of words) {
      while (measure(w) > maxWidth && [...w].length > 1) {
        // a word wider than a line: it is cut at the last character that fits
        let k = [...w].length - 1;
        while (k > 1 && measure([...w].slice(0, k).join("")) > maxWidth) k--;
        const head = [...w].slice(0, k).join(""), rest = [...w].slice(k).join("");
        if (cur) push();
        cur = head; push(); w = rest;
      }
      const tryLine = cur ? `${cur} ${w}` : w;
      if (measure(tryLine) <= maxWidth || !cur) cur = tryLine; else { push(); cur = w; }
    }
    if (cur) push();
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = [...kept[maxLines - 1]].join("");
  while (last && measure(`${last}…`) > maxWidth) last = [...last].slice(0, -1).join("");
  kept[maxLines - 1] = `${last.replace(/\s+$/, "")}…`;
  return kept;
}
/** Cuts a single-line text so that it fits `maxWidth` (… at the end). */
export function ellipsize(measure, text, maxWidth) {
  const s = String(text ?? "");
  if (measure(s) <= maxWidth) return s;
  let k = [...s].length;
  while (k > 1 && measure(`${[...s].slice(0, k).join("").replace(/\s+$/, "")}…`) > maxWidth) k--;
  return `${[...s].slice(0, k).join("").replace(/\s+$/, "")}…`;
}

/**
 * The biggest scale `u` (up to `max`) for which `heightAt(u)` fits in `avail`. `heightAt` must grow with `u`. Searches by bisection; returns at least `min`.
 */
export function solveScale(heightAt, avail, max = 1, min = 0.3) {
  if (heightAt(max) <= avail) return max;
  let lo = min, hi = max;
  for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (heightAt(mid) <= avail) lo = mid; else hi = mid; }
  return lo;
}

/**
 * The cells of the guest streamers in the area `box` ({ x, y, w, h }): from 0 to 6 round badges (one row up to 3, two rows beyond), all inside the area,
 * not touching. Each cell: { cx, cy, d (diameter), labelY (top of the name), labelW (width allowed for the name) }.
 */
export function layoutCostreamers(n, box, { maxD = 190, gap = 28, labelH = 44 } = {}) {
  const count = Math.max(0, Math.min(LIMITS.costreamers, Math.floor(Number(n) || 0)));
  if (!count) return [];
  const rows = count <= 3 ? [count] : [Math.ceil(count / 2), Math.floor(count / 2)];
  const rowGap = Math.min(gap, 20);
  const widest = Math.max(...rows);
  const d = Math.max(36, Math.min(maxD, (box.w - (widest - 1) * gap) / widest, (box.h - (rows.length - 1) * rowGap) / rows.length - labelH));
  const cellW = Math.max(d, Math.min(box.w / widest, d + gap + 30)), rowH = d + labelH + 8;
  const total = rows.length * rowH + (rows.length - 1) * rowGap;
  let y = box.y + Math.max(0, (box.h - total) / 2);
  const cells = [];
  for (const cols of rows) {
    const rowW = cols * cellW + (cols - 1) * Math.max(0, gap - (cellW - d));
    const step = cols > 1 ? (Math.min(box.w, rowW) - cellW) / (cols - 1) : 0;
    let x = box.x + (box.w - (cellW + step * (cols - 1))) / 2;
    for (let i = 0; i < cols; i++) { cells.push({ cx: x + cellW / 2, cy: y + d / 2, d, labelY: y + d + 14, labelW: cellW }); x += step; }
    y += rowH + rowGap;
  }
  return cells;
}

/** The initials of a name ("Alice Martin" → "AM", "zoe_live" → "Z"), for the badge when the image is missing. */
export function initials(name) {
  const parts = String(name ?? "").replace(/[_\-.]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const first = [...(parts[0] ?? "?")][0] ?? "?", second = parts.length > 1 ? [...parts[1]][0] : "";
  return (first + second).toUpperCase();
}

/* ───────────── Colours and motion ───────────── */

export function parseHex(hex) {
  const s = String(hex ?? "").trim().replace(/^#/, "");
  const full = /^[0-9a-f]{3}$/i.test(s) ? s.split("").map((c) => c + c).join("") : /^[0-9a-f]{6}$/i.test(s) ? s : null;
  return full ? [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)] : null;
}
export const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
export const mix = (a, b, t) => { const x = parseHex(a) ?? [0, 0, 0], y = parseHex(b) ?? [0, 0, 0]; return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
export const rgba = (hex, a) => { const c = parseHex(hex) ?? [0, 0, 0]; return `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`; };
export function luminance(hex) {
  const c = (parseHex(hex) ?? [0, 0, 0]).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export const contrast = (a, b) => { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
/** The text (white or near-black) that reads best on this background. */
export const readableOn = (bg) => (contrast(bg, "#ffffff") >= contrast(bg, "#111111") ? "#ffffff" : "#111111");
/** Lightens or darkens a colour until it is readable (≥ `ratio`) on `bg`; otherwise returns the readable white or black. */
export function ensureContrast(color, bg, ratio = 4.5) {
  if (!parseHex(color)) return readableOn(bg);
  if (contrast(color, bg) >= ratio) return color;
  const target = readableOn(bg);
  for (let i = 1; i <= 10; i++) { const c = mix(color, target, i / 10); if (contrast(c, bg) >= ratio) return c; }
  return target;
}

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const easeOutCubic = (x) => 1 - (1 - clamp01(x)) ** 3;
export const easeInOutCubic = (x) => { const t = clamp01(x); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };
export const easeOutBack = (x) => { const t = clamp01(x), c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; };
/** Progress (0 to 1) of a move that starts at `start` and lasts `len` seconds. */
export const progress = (t, start, len) => clamp01((t - start) / (len > 0 ? len : 1));
/** A small "reproducible" random generator: the same seed always gives the same sequence (the video is deterministic). */
export function seeded(seed) {
  let a = (Number(seed) || 0) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** An event is "upcoming" if it has not started yet; a whole day counts until the end of the day. `e`: { startMs, allDay, day }. */
export function isUpcoming(e, nowMs, tz = "UTC") {
  if (!e || !Number.isFinite(e.startMs)) return false;
  if (e.allDay) return typeof e.day === "string" && e.day >= isoDay(nowMs, validZone(tz) ? tz : "UTC");
  return e.startMs > nowMs;
}
/** The next event of a list already sorted by date: the first one that has not started; failing that (everything is under way), the first one. Never throws. */
export function nextEvent(items, nowMs, tz = "UTC") {
  const list = Array.isArray(items) ? items : [];
  return list.find((e) => isUpcoming(e, nowMs, tz)) ?? list[0] ?? null;
}
