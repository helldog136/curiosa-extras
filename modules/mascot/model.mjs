// Mascot — the pure rules: limits, sentences, variables, pages, and (1.2.0) animation, reading time and voice. No access to storage or to the network (testable alone).

/** The hard limits of the module (anything beyond is refused or ignored). */
export const LIMITS = { phrases: 100, text: 140, name: 40, alt: 125, pages: 20, path: 100, link: 300, line: 260, hints: 10, items: 30 };
/** Settings with a bounded value: [minimum, maximum, default]. */
export const RANGES = { delay: [3, 60, 8], show: [4, 20, 8], max: [1, 10, 3] };
export const KINDS = ["hello", "tip", "news"];
export const STATES = ["published", "draft"];

/**
 * The variables of a sentence. Each variable has a French AND an English name (both work in every language); it only exists
 * when its source answers: a sentence that uses a missing one is simply not said (never an error, never a hole in the sentence).
 *   site = name of the site · name = name of the mascot · event / date = next event and its date · live / liveTitle = live stream going on
 *   news = the latest published news (article, video… offered to the feed of the site, less than 3 weeks old)
 */
export const VARIABLES = [
  { key: "site", names: ["nom_du_site", "site_name"] },
  { key: "name", names: ["nom", "name"] },
  { key: "event", names: ["prochain_evenement", "next_event"] },
  { key: "date", names: ["date_evenement", "event_date"] },
  { key: "live", names: ["en_direct", "live_now"] },
  { key: "liveTitle", names: ["titre_direct", "live_title"] },
  { key: "news", names: ["derniere_nouveaute", "latest_news"] },
];
/** The name of a variable in the language of the person (French for "fr", English otherwise), in braces: for the examples of the help texts. */
export const example = (locale, key) => `{${VARIABLES.find((x) => x.key === key).names[locale === "fr" ? 0 : 1]}}`;
const BY_NAME = new Map(VARIABLES.flatMap((v) => v.names.map((n) => [n, v.key])));
/** Which source to ask to answer each variable (the others are always known). */
export const SOURCE_OF = { event: "event", date: "event", live: "live", liveTitle: "live", news: "latest" };

const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]", "g");
/** One line of text with no control character, spaces squeezed, length bounded. */
export function oneLine(value, max) {
  return String(value ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
/** A text that comes from elsewhere (title of an event…): one line, no braces (they are reserved for variables). */
export const outside = (value, max) => oneLine(String(value ?? "").replace(/[{}]/g, ""), max);

/** Variables used by a text: { keys: [known keys], unknown: [unknown names], stray: a lone brace? }. */
export function variablesIn(text) {
  const keys = [], unknown = [];
  const rest = String(text ?? "").replace(/\{([^{}]{0,40})\}/g, (all, name) => {
    const key = BY_NAME.get(name);
    if (key) { if (!keys.includes(key)) keys.push(key); } else if (!unknown.includes(name)) unknown.push(name);
    return "";
  });
  return { keys, unknown, stray: /[{}]/.test(rest) };
}

/** Fills the variables of a sentence with `facts` ({ site, name, event, date, live, liveTitle, news }). Returns null when a variable used has no value. */
export function fillText(text, facts) {
  let missing = false;
  const out = String(text ?? "").replace(/\{([^{}]{0,40})\}/g, (all, name) => {
    const key = BY_NAME.get(name);
    const value = key ? facts?.[key] : undefined;
    if (value === undefined || value === null || value === "") { missing = true; return ""; }
    return String(value);
  });
  return missing ? null : oneLine(out, LIMITS.line + 40);
}

/** Pages: "/faq" (this page), "/blog/*" (the blog and everything in it), "/game*" (everything that starts with /game). Lower case. */
const PAGE_RE = /^\/[a-z0-9_\-.~%/]{0,96}\*?$/;
export function parsePages(raw) {
  const parts = String(raw ?? "").split(/[\n,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const list = [], bad = [];
  for (const part of parts) {
    let p = part.replace(/^https?:\/\/[^/]+/, "");
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    if (!PAGE_RE.test(p) || p.length > LIMITS.path || p.includes("//") || p.includes("..") || /\*./.test(p)) { bad.push(part.slice(0, 40)); continue; }
    if (!list.includes(p)) list.push(p);
  }
  return { list: list.slice(0, LIMITS.pages), bad, tooMany: list.length > LIMITS.pages };
}

/**
 * Is this address (without the language, without "?" or "#") in the list?
 * SELF-CONTAINED: its source is also sent to the browser, which uses it to decide without asking the server anything.
 */
export function pathMatches(list, path) {
  var p = String(path || "/").toLowerCase();
  for (var i = 0; i < list.length; i++) {
    var x = list[i];
    if (x.slice(-2) === "/*") { var b = x.slice(0, -2); if (p === b || p.indexOf(b + "/") === 0) return true; }
    else if (x.slice(-1) === "*") { if (p.indexOf(x.slice(0, -1)) === 0) return true; }
    else if (p === x) return true;
  }
  return false;
}

/** The address received from the browser → a clean path ("/blog/article"), or "/". Never a full address, never more than 200 characters. */
export function cleanPath(raw) {
  let p = String(raw ?? "").slice(0, 200).split(/[?#]/)[0];
  if (!p.startsWith("/") || p.startsWith("//")) return "/";
  p = p.toLowerCase().replace(/[^a-z0-9_\-.~%/]/g, "");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

/** Must the mascot show on this page? where = all | home | some. */
export function placeAllows(where, pages, path) {
  if (where === "home") return path === "/";
  if (where === "some") return pathMatches(pages, path);
  return true;
}

export const num = (value, [min, max, fallback]) => {
  const n = value === null || value === undefined || value === "" || typeof value === "boolean" ? NaN : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

const BAD_LINK = new RegExp("[\\u0000-\\u0020\"'<>\\\\`]");
/** A link address for a sentence: https, or a page of the site ("/events"). Empty when it does not fit. */
export function safeLink(value) {
  const s = String(value ?? "").trim();
  if (!s || s.length > LIMITS.link || BAD_LINK.test(s)) return "";
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  try { const u = new URL(s); return u.protocol === "https:" && !u.username && !u.password ? u.href : ""; } catch { return ""; }
}
/** A picture of the mascot: a file sent to the site (with its possible crop) or an https address. */
export function safeImage(value) {
  const s = String(value ?? "").trim();
  if (/^\/uploads\/[0-9a-f-]{36}\.(?:png|jpe?g|webp|gif)(?:\?c=[0-9a-z._-]{1,60}(?:&s=1)?)?$/.test(s)) return s;
  return s.startsWith("https://") ? safeLink(s) : "";
}

/**
 * Checks a sentence written by the person. → { value } or { errors: { field: [message key, variables] } }.
 * `locales`: the languages of the site. Nothing is ever "fixed in silence": we say what to change.
 */
export function checkPhrase(raw, { locales = [], locale = "en" } = {}) {
  const errors = {};
  const text = oneLine(raw?.text, 2000);
  if (!text) errors.text = ["errTextEmpty"];
  else if ([...text].length > LIMITS.text) errors.text = ["errTextLong", { max: LIMITS.text, n: [...text].length }];
  else {
    const v = variablesIn(text);
    if (v.unknown.length) errors.text = ["errVariable", { name: `{${v.unknown[0]}}`, list: VARIABLES.map((x) => `{${x.names[locale === "fr" ? 0 : 1]}}`).join(" ") }];
    else if (v.stray) errors.text = ["errBraces", { ex1: example(locale, "site") }];
  }
  const kind = KINDS.includes(raw?.kind) ? raw.kind : "hello";
  const lang = String(raw?.lang ?? "");
  if (lang !== "" && !locales.includes(lang)) errors.lang = ["errLang"];
  const pages = parsePages(raw?.pages);
  if (pages.bad.length) errors.pages = ["errPages", { bad: pages.bad[0] }];
  else if (pages.tooMany) errors.pages = ["errPagesMany", { max: LIMITS.pages }];
  const linkRaw = String(raw?.link ?? "").trim();
  const link = safeLink(linkRaw);
  if (linkRaw && !link) errors.link = ["errLink"];
  if (Object.keys(errors).length) return { errors };
  return { value: { kind, lang, text, pages: pages.list, link, state: raw?.state === "draft" ? "draft" : "published" } };
}

/** A small fingerprint of a text (FNV-1a, 8 characters): changes when the text changes; protects nothing. */
export function hash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/** A safe spreadsheet cell (quotes doubled, formulas neutralised). */
export const cell = (value) => {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};


/* ───────────────────────────── Animation, reading time and voice (1.2.0) ───────────────────────────── */

/** Hard caps of one animation. Frames are uploaded pictures of the site; the byte budget is checked when a file is claimed (the core tells its size). */
export const ANIM = { frames: 24, bytes: 3 * 1024 * 1024, fps: [1, 24, 8] };
export const ANIM_MODES = ["none", "gif", "frames"];
/** Reading speed, in characters per second (a bubble is read, not studied: about 180 to 260 words per minute for the three speeds). */
export const SPEEDS = { slow: 10, normal: 15, fast: 22 };
/** Shortest and longest time (seconds) the mascot "talks", whatever the length of the sentence: [min, max, default]. */
export const TALK = { min: [1, 10, 2], max: [2, 30, 12] };
/** "custom" = the blip is the sound file of the site ("Your own sound"), played once per letter and pitched. */
export const BLIP_CHOICES = [...Object.keys({ soft: 0, squeaky: 0, deep: 0, robotic: 0, bubbly: 0 }), "custom"];
/** Longest part of a sound file used as one blip (seconds), and the keys of the pitch range in semitones: a voice is never pushed beyond what a sample can bear. */
export const SAMPLE = { len: 0.2, minRate: 0.5, maxRate: 2.5, voices: 6 };
export const VOICE_MODES = ["none", "blips", "speech", "custom"];
/** Blip presets: the page makes the sounds itself (no file). `base` Hz, `wave` the shape, `glide` the pitch slide during one blip (ratio), `len` seconds. */
export const BLIP_PRESETS = {
  soft: { wave: "sine", base: 420, glide: 1, len: 0.07 },
  squeaky: { wave: "triangle", base: 880, glide: 1.12, len: 0.05 },
  deep: { wave: "sawtooth", base: 150, glide: 0.95, len: 0.09 },
  robotic: { wave: "square", base: 300, glide: 1, len: 0.06 },
  bubbly: { wave: "sine", base: 520, glide: 1.35, len: 0.08 },
};
/** The friendly choices of the voice forms and the numbers behind them. */
export const PITCHES = { low: -5, normal: 0, high: 5 };           // semitones, for the blips
export const VARIATIONS = { none: 0, some: 0.35, lots: 0.8 };
export const BLIP_RATES = { slow: 8, normal: 12, fast: 18 };      // blips per second
export const SPEECH_RATES = { slow: 0.85, normal: 1, fast: 1.25 };
export const SPEECH_PITCHES = { low: 0.8, normal: 1, high: 1.3 };
export const VOLUME = [1, 100, 40];

/**
 * How long the mascot "talks" for a sentence: its length in characters (letters, digits, marks; spaces squeezed) over a reading speed (`cps`, characters per second), plus half a second
 * to start, kept between `min` and `max` seconds, to a tenth of a second. An empty sentence gives `min`. SELF-CONTAINED: the page runs the very same source.
 */
export function talkSeconds(text, cps, min, max) {
  var chars = Array.from(String(text === null || text === undefined ? "" : text).replace(/\s+/g, " ").trim()).length;
  var s = chars / (cps > 0 ? cps : 15) + 0.5;
  s = Math.min(max, Math.max(min, s));
  return Math.round(s * 10) / 10;
}
/** The same, from the settings of the module: `{ speed: "slow"|"normal"|"fast", min, max }` (anything else falls back to the defaults; `min` never goes above `max`). */
export function talkDuration(text, reading) {
  const r = readingOf(reading);
  return talkSeconds(text, SPEEDS[r.speed], r.min, r.max);
}
export function readingOf(raw) {
  const speed = Object.hasOwn(SPEEDS, raw?.speed) ? raw.speed : "normal";
  const min = num(raw?.min, TALK.min);
  const max = Math.max(min, num(raw?.max, TALK.max));
  return { speed, min, max };
}

/**
 * The blips of one sentence: one per letter or digit (spaces and marks are silent pauses), spread over at most `seconds`, never faster than `rate` per second.
 * → [{ t, f, s, len }]: start (seconds from the beginning), frequency (Hz), the same as semitones from the natural pitch (for a sound file: playbackRate = 2^(s/12)) and length. The pitch of a blip depends on its letter (always the same letter, the same note), so a sentence sounds
 * like a voice and not like a metronome. SELF-CONTAINED: the page runs the very same source.
 */
export function blipPlan(text, seconds, p) {
  var chars = Array.from(String(text === null || text === undefined ? "" : text)), out = [], step = 1 / (p.rate > 0 ? p.rate : 12), t = 0, shift = Math.pow(2, (p.pitch || 0) / 12);
  for (var i = 0; i < chars.length && t < seconds - p.len; i++) {
    var c = chars[i], code = c.toLowerCase().codePointAt(0);
    if (/[\s.,;:!?…\-–—()"'«»]/.test(c)) { t += step * (/[.!?…]/.test(c) ? 2.2 : /[,;:]/.test(c) ? 1.4 : 0.8); continue; }
    var wobble = (((code * 7 + i) % 9) - 4) / 4;                       // -1 .. 1, fixed for a given letter at a given place
    var st = (p.pitch || 0) + wobble * (p.vary || 0) * 7;               // semitones from the natural pitch of the sound
    out.push({ t: Math.round(t * 1000) / 1000, f: Math.round(p.base * shift * Math.pow(2, (wobble * (p.vary || 0) * 7) / 12)), s: Math.round(st * 100) / 100, len: p.len });
    t += step;
  }
  return out;
}

const UPLOAD_IMAGE = /^\/uploads\/[0-9a-f-]{36}\.(?:png|jpe?g|webp|gif)(?:\?c=[0-9a-z._-]{1,60}(?:&s=1)?)?$/;
/** A picture of THIS site (an upload of the core), never an outside address. Empty when it does not fit. */
export const uploadImage = (value) => { const s = String(value ?? "").trim(); return UPLOAD_IMAGE.test(s) ? s : ""; };
/** The files accepted for "Your own sound". Since core 0.10.0 the core takes audio files (`AUDIO_EXTS`, what the Voice form and the `audio` setting store). Short MP4 / WebM files sent
 *  before (1.2.x, as a video) are still read, so no existing configuration needs a conversion: `SOUND_EXTS` = both. */
export const AUDIO_EXTS = "mp3|ogg|wav|m4a|aac";
export const SOUND_EXTS = `${AUDIO_EXTS}|mp4|webm`;
const UPLOAD_SOUND = new RegExp(`^/uploads/[0-9a-f-]{36}\\.(?:${SOUND_EXTS})$`);
const UPLOAD_AUDIO = new RegExp(`^/uploads/[0-9a-f-]{36}\\.(?:${AUDIO_EXTS})$`);
/** A sound file the Voice form may store: an audio upload of the core, nothing else (the action checks it again, a browser is never trusted). */
export const uploadAudio = (value) => { const s = String(value ?? "").trim(); return UPLOAD_AUDIO.test(s) ? s : ""; };
/** Weight limit of the sound of the mascot (the core takes 10 MB): it is played for every sentence, and as a blip it must be short. */
export const SOUND_BYTES = 4 * 1024 * 1024;
export const uploadSound = (value) => { const s = String(value ?? "").trim(); return UPLOAD_SOUND.test(s) ? s : ""; };

const bytes = (n) => Math.min(ANIM.bytes * 4, Math.max(0, Math.round(Number(n)) || 0));
/** One animation as stored: { mode, gif, gifBytes, frames: [{ src, bytes }], fps (0 = default), once }. A mode without its content plays nothing (see `animForPage`). */
export function normalizeAnim(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const gif = uploadImage(r.gif);
  const frames = (Array.isArray(r.frames) ? r.frames : []).map((f) => ({ src: uploadImage(f?.src ?? f), bytes: bytes(f?.bytes) })).filter((f) => f.src).slice(0, ANIM.frames);
  const mode = ANIM_MODES.includes(r.mode) ? r.mode : "none";
  const fps = Number(r.fps) >= ANIM.fps[0] ? Math.min(ANIM.fps[1], Math.round(Number(r.fps))) : 0;
  return { mode, gif, gifBytes: gif ? bytes(r.gifBytes) : 0, frames, fps, once: r.once === true };
}
export const animBytes = (a) => (a.mode === "gif" ? a.gifBytes : a.frames.reduce((n, f) => n + f.bytes, 0));
/** What the page needs to play it: null when there is nothing to play. */
export function animForPage(a) {
  if (a.mode === "gif" && a.gif) return { kind: "gif", src: a.gif, fps: 0, once: a.once };
  if (a.mode === "frames" && a.frames.length) return { kind: "frames", frames: a.frames.map((f) => f.src), fps: a.fps || ANIM.fps[2], once: a.once };
  return null;
}

/** The sound file in use: the one sent in the Voice form, else the one of the older setting (1.2.x) so that nothing has to be converted. */
export const soundOf = (voice, setting) => uploadSound(voice?.file) || uploadSound(setting);

/** The voice as stored. Every number is one of the friendly choices above (or a bounded percentage). */
export function normalizeVoice(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const pick = (table, v, fallback) => (Object.hasOwn(table, v) ? v : fallback);
  const b = r.blips && typeof r.blips === "object" ? r.blips : {}, s = r.speech && typeof r.speech === "object" ? r.speech : {};
  return {
    mode: VOICE_MODES.includes(r.mode) ? r.mode : "none",
    volume: num(r.volume, VOLUME),
    file: uploadSound(r.file), fileBytes: uploadSound(r.file) ? bytes(r.fileBytes) : 0,
    blips: { preset: BLIP_CHOICES.includes(b.preset) ? b.preset : "soft", pitch: pick(PITCHES, b.pitch, "normal"), vary: pick(VARIATIONS, b.vary, "some"), rate: pick(BLIP_RATES, b.rate, "normal") },
    speech: { lang: /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(String(s.lang ?? "")) ? s.lang : "", name: oneLine(s.name, 80), rate: pick(SPEECH_RATES, s.rate, "normal"), pitch: pick(SPEECH_PITCHES, s.pitch, "normal") },
  };
}

/** The voice as the page of an overlay element needs it, or `{ mode: "none" }`. `soundFile` is the setting "Your own sound" (a short video of the site); without a valid file that mode is silent. */
export function voiceForPage(voice, soundFile, locale) {
  const v = normalizeVoice(voice), volume = v.volume / 100;
  if (v.mode === "blips") {
    const sample = v.blips.preset === "custom" ? uploadSound(soundFile) : "";
    const preset = BLIP_PRESETS[sample ? "soft" : BLIP_PRESETS[v.blips.preset] ? v.blips.preset : "soft"];
    const blips = { wave: preset.wave, base: preset.base, glide: preset.glide, len: preset.len, pitch: PITCHES[v.blips.pitch], vary: VARIATIONS[v.blips.vary], rate: BLIP_RATES[v.blips.rate] };
    if (sample) Object.assign(blips, { sample, len: SAMPLE.len, glide: 1 });
    return { mode: "blips", volume, blips };
  }
  if (v.mode === "speech") return { mode: "speech", volume, lang: String(locale ?? "").slice(0, 5), blips: voiceForPage({ mode: "blips", volume: v.volume }, "", locale).blips, speech: { lang: v.speech.lang, name: v.speech.name, rate: SPEECH_RATES[v.speech.rate], pitch: SPEECH_PITCHES[v.speech.pitch] } };
  if (v.mode === "custom" && uploadSound(soundFile)) return { mode: "custom", volume, custom: uploadSound(soundFile) };
  return { mode: "none" };
}
