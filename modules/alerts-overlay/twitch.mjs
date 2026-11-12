// The Twitch alerts of the overlay: the topic `twitch.event` (offered by Twitch activity, never required) turned into alerts. This file holds the whole engine, so that the
// overlay page itself changes very little: per-type switches, text templates, duration, minimums and an ignore list; a staging area that groups bursts ("5 gifts by Camille",
// "12 new followers"); a pause that HOLDS the alerts (they come out when resumed); and the memory of what was already shown (it survives a restart).
// Pure functions first (tested alone), then the stateful part, keyed by overlay instance.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const mod = await import(new URL(`./moderation.mjs${v}`, import.meta.url).href);
const clean = (v, max) => String(v ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export const TOPIC = "twitch.event";
/** The types a person switches on and off. `hype` covers the three phases of a hype train. */
export const TYPES = ["follow", "sub", "resub", "gift", "cheer", "raid", "online", "offline", "hype", "redeem"];
/** What the page draws as the kind of each type (the label comes from `kind_<kind>` in the locales). */
export const KIND = { follow: "follow", sub: "sub", raid: "raid", resub: "tw_resub", gift: "tw_gift", cheer: "tw_cheer", online: "tw_online", offline: "tw_offline", hype: "tw_hype", redeem: "tw_redeem" };
export const TWITCH_KINDS = Object.values(KIND);
/** The words a template may use, replaced by the real values. */
export const VARS = ["name", "count", "amount", "tier", "months", "viewers", "level", "title", "text", "total"];
/** The type whose alerts have a minimum, and the field it applies to. */
export const MINIMUM = { cheer: "amount", gift: "count", raid: "viewers", redeem: "amount" };
export const PRESETS = ["simple", "short", "thanks"];
/** Sounds are made by the page itself (small synthesised notes): nothing is loaded, nothing is uploaded. `none` is the default. */
export const SOUNDS = ["none", "chime", "bell", "pop", "fanfare"];
/** How an alert of this type enters and leaves; empty = the module setting (the shared transition helper's modes, except `auto`). */
export const ANIMS = ["", "slide", "slideLeft", "slideRight", "slideTop", "slideBottom", "fade", "jiggle", "pop", "none"];
/** A picture is one that the site itself holds (uploaded in the administration, then kept by this module): never an address from elsewhere. */
export const IMAGE_RE = /^\/uploads\/[0-9a-f-]{36}\.(png|jpg|webp|gif)$/;
/** How an alert of a type is presented: text (default, with an optional picture and sound), a picture/GIF alone, or one of the site's videos alone. */
export const PRESENT = ["text", "gif", "video"];
/** A video is an upload of the site (mp4 or webm, sent in the "Videos" tab): never an address from elsewhere. Six slots, each type picks one. */
export const VIDEO_RE = /^\/uploads\/[0-9a-f-]{36}\.(mp4|webm)$/;
export const VIDEO_SLOTS = 6;
/** What is read aloud: nothing, the sentence of the alert, the text written by the viewer, or both. */
export const TTS_MODES = ["off", "sentence", "text", "both"];
/** The types that can carry a text written by the viewer (Twitch gives one for these only: a resub message, a cheer message, the text of a reward). */
export const VIEWER_TYPES = ["resub", "cheer", "redeem"];
export const TTS_LIMITS = { rate: [0.5, 2], pitch: [0, 2], volume: [0, 100], max: [20, 300], viewerMax: [20, 250] };
export const LIMITS = { template: 120, seconds: { min: 2, max: 60 }, min: 1_000_000, maxAgeMs: 5 * 60_000, maxAgeMissedMs: 60 * 60_000, seenKeep: 400, held: 50, texts: 50, ignore: 50, groupFollows: 3, gapMs: { min: 0, max: 30_000 }, groupMs: { min: 0, max: 30_000 } };

/** The type (switch) of an item of the topic; null for something we do not know. */
export function typeOf(item) {
  const t = String(item?.type ?? "");
  if (t.startsWith("hype_")) return "hype";
  return TYPES.includes(t) ? t : null;
}

/* ───────────── Templates ───────────── */

/** `{name}`-style words of a template that are not allowed. */
export function unknownWords(template) {
  return [...String(template ?? "").matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).filter((w) => !VARS.includes(w));
}
/** Fills a template. A word with no value gives nothing (never a leftover `{count}`); the result is plain text, cleaned and bounded. */
export function fillTemplate(template, vars, max = 200) {
  const text = String(template ?? "").replace(/\{([^{}]*)\}/g, (_, w) => (VARS.includes(w) && vars[w] !== undefined && vars[w] !== null ? String(vars[w]) : ""));
  // a word without a value can leave a separator hanging: "Camille ·" or "· ·"
  return clean(text.replace(/(?:\s*·\s*){2,}/g, " · ").replace(/^[\s·,:;]+|[\s·,:;]+$/g, ""), max);
}
const num = (n, locale) => { try { return new Intl.NumberFormat(locale || "en").format(n); } catch { return String(n); } };
/** The values of an item for a template. */
export function varsOf(item, locale = "en") {
  const v = { name: clean(item.name, 60), tier: item.tier, months: item.months, viewers: item.viewers === undefined ? undefined : num(item.viewers, locale), level: item.level, title: clean(item.title, 80), text: clean(item.text, 140) };
  if (item.count !== undefined) v.count = num(item.count, locale);
  if (item.amount !== undefined) v.amount = num(item.amount, locale);
  if (item.total !== undefined) v.total = num(item.total, locale);
  return v;
}

/* ───────────── Configuration (per type) ───────────── */

/** A saved configuration, made safe: unknown types dropped, switches boolean, template bounded, numbers in range. */
export function normaliseConfig(raw) {
  const out = { types: {}, preset: PRESETS.includes(raw?.preset) ? raw.preset : "" };
  for (const id of TYPES) {
    const r = raw?.types?.[id] ?? {};
    const sec = Math.trunc(Number(r.seconds)), min = Math.trunc(Number(r.min));
    out.types[id] = {
      on: r.on !== false,
      template: clean(r.template, LIMITS.template),
      seconds: Number.isFinite(sec) && sec >= LIMITS.seconds.min ? Math.min(LIMITS.seconds.max, sec) : 0,
      min: MINIMUM[id] && Number.isFinite(min) && min > 0 ? Math.min(LIMITS.min, min) : 0,
      sound: SOUNDS.includes(r.sound) ? r.sound : "none",
      anim: ANIMS.includes(r.anim) ? r.anim : "",
      image: typeof r.image === "string" && IMAGE_RE.test(r.image) ? r.image : "",
      present: PRESENT.includes(r.present) ? r.present : "text",
      video: Number.isInteger(r.video) && r.video >= 1 && r.video <= VIDEO_SLOTS ? r.video : Number.isInteger(Number(r.video)) && Number(r.video) >= 1 && Number(r.video) <= VIDEO_SLOTS ? Number(r.video) : 0,
      videoSound: r.videoSound === true,
      viewer: VIEWER_TYPES.includes(id) ? (typeof r.viewer === "boolean" ? r.viewer : null) : false,   // null = follows the older setting "Show the messages that come with an alert"
      viewerMax: bound(r.viewerMax, TTS_LIMITS.viewerMax, 140),
      tts: TTS_MODES.includes(r.tts) ? r.tts : "off",
    };
  }
  const t = raw?.tts ?? {};
  out.tts = { on: t.on === true, voice: clean(t.voice, 120), lang: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(String(t.lang ?? "")) ? t.lang : "", rate: boundF(t.rate, TTS_LIMITS.rate, 1), pitch: boundF(t.pitch, TTS_LIMITS.pitch, 1), volume: bound(t.volume, TTS_LIMITS.volume, 80), max: bound(t.max, TTS_LIMITS.max, 140), readName: t.readName !== false };
  const m = raw?.moderation ?? {};
  const wordsText = String(m.wordsText ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, 4000);
  out.moderation = { wordsText, hold: m.hold === true, links: m.links !== false, caps: m.caps !== false, repeats: m.repeats !== false };
  out.moderation.rules = { words: mod.wordsOf(wordsText), links: out.moderation.links, caps: out.moderation.caps, repeats: out.moderation.repeats };
  return out;
}
const bound = (v, [lo, hi], def) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && v !== "" && v !== null && v !== undefined ? Math.min(hi, Math.max(lo, n)) : def; };
const boundF = (v, [lo, hi], def) => { const n = Number(v); return Number.isFinite(n) && v !== "" && v !== null && v !== undefined ? Math.min(hi, Math.max(lo, Math.round(n * 10) / 10)) : def; };
/** Names to ignore, from the setting: separated by commas, spaces or new lines, without @, lower case, 50 at most. */
export const ignoreOf = (text) => new Set(String(text ?? "").toLowerCase().split(/[\s,;]+/).map((s) => s.replace(/^@/, "")).filter((s) => /^[a-z0-9_]{2,25}$/.test(s)).slice(0, LIMITS.ignore));

/** The look of a type: its picture, its sound and its way of entering (each only when chosen). */
const look = (cfg, env = {}) => {
  // a video alone replaces the picture; a picture alone (a GIF) hides the text; otherwise the text, with its optional picture
  const video = cfg.present === "video" && cfg.video ? env.videos?.[cfg.video - 1] : null;
  const media = video && VIDEO_RE.test(video) ? { present: "media", video, ...(cfg.videoSound ? { videoSound: true } : {}) } : cfg.present === "gif" && cfg.image ? { present: "media" } : null;
  return { ...(cfg.image && !(media && media.video) ? { image: cfg.image } : {}), ...(media ?? {}), ...(cfg.sound && cfg.sound !== "none" ? { sound: cfg.sound } : {}), ...(cfg.anim ? { anim: cfg.anim } : {}) };
};
const escapeRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** What is read aloud for an alert (empty = nothing): the sentence and/or the viewer text, as the type asks, the name replaced when "read the name" is off, cut at the maximum. */
export function sayOf(cfg, config, env, message, detail, name) {
  const t = config.tts;
  if (!t.on || cfg.tts === "off") return "";
  const parts = [];
  if (cfg.tts === "sentence" || cfg.tts === "both") parts.push(!t.readName && name ? message.replace(new RegExp(escapeRe(name), "gi"), env.text("someone")) : message);
  if ((cfg.tts === "text" || cfg.tts === "both") && detail) parts.push(detail);
  return mod.cut(clean(parts.join(". "), 600), t.max);
}
/** The seconds an alert needs to be read aloud (about 13 characters a second at normal speed, plus two). */
export const speechSeconds = (say, rate = 1) => Math.ceil((say.length * 0.075) / Math.max(0.5, rate)) + 2;

/**
 * One item of the topic → what to do with it: { alert } (to show now or to stage), or { skip: reason }.
 * `text(typeId, phase)` gives the default template and `title(phase)` the title of a hype train line; `now` is for the age limit.
 * Tests and replays (`item.test`, `item.replay`) skip the switches, the minimums, the ignore list and the age limit: a person who asks to see an alert sees it.
 */
export function alertFor(item, { config, ignore = new Set(), showText = false, locale = "en", text, title, seconds = 0, baseSeconds = 0, videos = [], now = Date.now() }) {
  const type = typeOf(item);
  if (!type) return { skip: "unknown" };
  const forced = item.test === true || item.replay === true, cfg = config.types[type];
  const at = Date.parse(item.at ?? "");
  // a line Twitch activity found after a gap (`missed`) may be older: it is still worth saying "thank you" within the hour
  if (!forced && (!Number.isFinite(at) || now - at > (item.missed === true ? LIMITS.maxAgeMissedMs : LIMITS.maxAgeMs) || at - now > 60_000)) return { skip: "old" };
  if (!forced && !cfg.on) return { skip: "off" };
  if (item.type === "hype_progress" && !forced && false) return { skip: "off" };
  if (type === "sub" && item.gifted === true && !forced) return { skip: "gifted" };   // the gift line announces them
  const who = [item.login, item.name].map((s) => String(s ?? "").toLowerCase());
  if (!forced && ["follow", "sub", "resub", "gift", "cheer", "raid", "redeem"].includes(type) && who.some((w) => ignore.has(w))) return { skip: "ignored" };
  const field = MINIMUM[type];
  if (!forced && field && cfg.min > 0 && !(Number(item[field]) >= cfg.min)) return { skip: "small" };
  const phase = type === "hype" ? item.type.slice(5) : "";
  const vars = varsOf(item, locale);
  if (item.anonymous === true) vars.name = text("anonymous");
  const message = fillTemplate(cfg.template || text(type), vars);
  if (!message) return { skip: "empty" };
  const env = { text, videos };
  // The text written by the viewer: shown only if this type asks for it (or, for the older setting, if that one is ticked), cut, then looked at by the moderation.
  const asks = VIEWER_TYPES.includes(type) && (cfg.viewer ?? showText) === true;
  const raw = asks ? mod.cut(clean(item.text, 250), cfg.viewerMax) : "";
  const reason = raw && item.approved !== true ? mod.flag(raw, config.moderation.rules) : null;
  const build = (detail) => {
    const say = sayOf(cfg, config, env, message, detail, vars.name);
    let secs = cfg.seconds || seconds || 0;
    if (say) secs = Math.min(LIMITS.seconds.max, Math.max(secs || baseSeconds || 6, speechSeconds(say, config.tts.rate)));
    return { kind: KIND[type], message, ...(detail ? { detail } : {}), ...(phase ? { title: title(phase) } : {}), ...(secs ? { duration: secs } : {}), ...look(cfg, env), ...(say ? { say } : {}), ...(reason && !detail ? { flag: reason } : {}), queued: true, id: String(item.id ?? "") };
  };
  const base = { type, group: type === "gift" || type === "follow" };
  if (!reason) return { alert: build(raw), ...base };
  const whole = { with: build(raw), reason, type, name: clean(item.name, 60), text: raw };
  // flagged: the alert shows WITHOUT the text (nothing of it is read), or, if the owner chose so, the whole alert waits for a decision
  if (config.moderation.hold) return { held: whole, ...base, group: false };
  return { alert: build(""), flagged: whole, ...base };
}

/**
 * Groups a burst that waited in the staging area: gifts by the same person (same tier) become one alert with the sum; three or more follows become "N new followers".
 * `staged`: [{ alert, item, type }]; returns the alerts to show, in order. Each group keeps the place of its first member.
 */
export function groupBurst(staged, { config, locale = "en", text, title, seconds = 0, baseSeconds = 0, videos = [] }) {
  const out = [], gifts = new Map(), follows = staged.filter((s) => s.type === "follow");
  const groupFollows = follows.length >= LIMITS.groupFollows;
  let followSlot = null;
  for (const s of staged) {
    if (s.type === "gift") {
      const key = `${s.item.anonymous ? "" : String(s.item.login || s.item.name).toLowerCase()}|${s.item.tier ?? ""}`;
      const g = gifts.get(key);
      if (g) { g.count += Number(s.item.count) || 0; g.item = { ...g.item, count: g.count }; continue; }
      const entry = { count: Number(s.item.count) || 0, item: s.item, slot: out.length };
      gifts.set(key, entry); out.push(entry);
    } else if (s.type === "follow" && groupFollows) {
      if (followSlot === null) { followSlot = { n: 0, first: s.item, slot: out.length }; out.push(followSlot); }
      followSlot.n += 1;
    } else out.push(s.alert);
  }
  const env = { text, videos };
  const done = (cfg, message, name, id, extra = {}) => {
    const say = sayOf(cfg, config, env, message, "", name);
    let secs = cfg.seconds || seconds || 0;
    if (say) secs = Math.min(LIMITS.seconds.max, Math.max(secs || baseSeconds || 6, speechSeconds(say, config.tts.rate)));
    return { kind: extra.kind, message, ...(secs ? { duration: secs } : {}), ...look(cfg, env), ...(say ? { say } : {}), queued: true, id };
  };
  return out.map((o) => {
    if (o.alert || o.message) return o;
    if (o.n !== undefined) {
      const cfg = config.types.follow;
      return done(cfg, fillTemplate(text("follow_many"), { name: clean(o.first.name, 60), count: num(o.n, locale) }), clean(o.first.name, 60), `group-${o.first.id}`, { kind: KIND.follow });
    }
    // a (merged) gift: the alert is rebuilt with the total
    const cfg = config.types.gift, item = o.item;
    const vars = varsOf({ ...item, count: o.count }, locale);
    if (item.anonymous === true) vars.name = text("anonymous");
    return done(cfg, fillTemplate(cfg.template || text("gift"), vars), vars.name, `gift-${item.id}`, { kind: KIND.gift });
  });
}

/* ───────────── The state of one overlay (memory + a small stored document) ───────────── */

const states = (globalThis.__curiosaAlertsTwitch ??= new Map());   // overlay key → { seen: Set, staged: [], held: [], paused, loaded, config, configAt, dirty }
export const resetTwitchState = () => states.clear();
const chain = new Map();
const serial = (key, fn) => { const run = (chain.get(key) ?? Promise.resolve()).catch(() => {}).then(fn); chain.set(key, run); return run; };
const COL = "twitchAlerts";
const one = async (ctx, name) => (await ctx.api.store.list(COL, { limit: 20 })).find((r) => r.data?.name === name) ?? null;
async function save(ctx, name, data) {
  const r = await one(ctx, name);
  if (r) await ctx.api.store.update(r.id, { name, ...data }); else await ctx.api.store.add(COL, { name, ...data });
}

/** The configuration of the types (stored), read at most every 10 seconds. */
export async function loadConfig(ctx, now = Date.now()) {
  const s = stateOf(ctx);
  if (s.config && now - s.configAt < 10_000) return s.config;
  let raw = null;
  try { raw = (await one(ctx, "config"))?.data ?? null; } catch { raw = null; }
  s.config = normaliseConfig(raw); s.configAt = now;
  return s.config;
}
export async function saveConfig(ctx, config) {
  const s = stateOf(ctx), safe = normaliseConfig(config);
  await serial(ctx.instance.key, () => save(ctx, "config", safe));
  s.config = safe; s.configAt = Date.now();
  return safe;
}
export function stateOf(ctx) {
  const k = ctx.instance.key;
  if (!states.has(k)) states.set(k, { seen: new Set(), staged: [], held: [], texts: [], ttsMuted: false, stop: 0, skip: 0, paused: false, loaded: null, config: null, configAt: 0 });
  const s = states.get(k);
  states.delete(k); states.set(k, s);
  while (states.size > 50) states.delete(states.keys().next().value);
  return s;
}
/** Reads what survived a restart: the ids already shown, the pause and the held alerts. Once per process. */
export async function loadState(ctx) {
  const s = stateOf(ctx);
  if (!s.loaded) {
    s.loaded = (async () => {
      try {
        const d = (await one(ctx, "state"))?.data;
        if (d) { for (const id of Array.isArray(d.seen) ? d.seen : []) s.seen.add(String(id)); s.paused = d.paused === true; s.held = (Array.isArray(d.held) ? d.held : []).slice(-LIMITS.held); s.texts = (Array.isArray(d.texts) ? d.texts : []).slice(-LIMITS.texts); s.ttsMuted = d.ttsMuted === true; s.stop = Number(d.stop) || 0; s.skip = Number(d.skip) || 0; }
      } catch { /* a fresh start is fine */ }
    })();
  }
  await s.loaded;
  return s;
}
const persist = (ctx, s) => serial(ctx.instance.key, () => save(ctx, "state", { seen: [...s.seen].slice(-LIMITS.seenKeep), paused: s.paused, held: s.held.slice(-LIMITS.held), texts: s.texts.slice(-LIMITS.texts), ttsMuted: s.ttsMuted, stop: s.stop, skip: s.skip })).catch(() => {});
const remember = (s, key) => { s.seen.add(key); while (s.seen.size > LIMITS.seenKeep) s.seen.delete(s.seen.values().next().value); };

/* ───────────── The queue controls (for the admin page, the dock and the service `alerts.queue`) ───────────── */

export async function queueState(ctx) {
  const s = await loadState(ctx);
  return { paused: s.paused, held: s.held.length, staged: s.staged.length };
}

/* ───────────── The voice and the texts of viewers: controls (dock, administration) ───────────── */

/** What the pages obey at once (they read it with each poll): the pause, the voice (on, muted, its settings), and the two counters that say "stop speaking" and "skip this alert". */
export async function ctlOf(ctx) {
  const s = await loadState(ctx), t = (await loadConfig(ctx)).tts;
  return { paused: s.paused, tts: { on: t.on, muted: s.ttsMuted, voice: t.voice, lang: t.lang, rate: t.rate, pitch: t.pitch, volume: t.volume }, stop: s.stop, skip: s.skip };
}
export async function voiceState(ctx) {
  const s = await loadState(ctx), t = (await loadConfig(ctx)).tts;
  return { on: t.on, muted: s.ttsMuted, pending: s.texts.filter((x) => x.hold).length, flagged: s.texts.length };
}
/** Mute: the speech in progress stops and nothing is read until it is unmuted (alerts still show). */
export async function setMuted(ctx, muted) {
  const s = await loadState(ctx);
  s.ttsMuted = muted === true;
  if (s.ttsMuted) s.stop += 1;
  await persist(ctx, s);
  return voiceState(ctx);
}
/** The voice on or off for good (the setting of the administration, saved): off stops reading entirely. */
export async function setVoiceOn(ctx, on) {
  const cfg = await loadConfig(ctx);
  await saveConfig(ctx, { ...cfg, tts: { ...cfg.tts, on: on === true } });
  if (on !== true) { const s = await loadState(ctx); s.stop += 1; await persist(ctx, s); }
  return voiceState(ctx);
}
/** Stops the speech in progress. */
export async function stopSpeech(ctx) { const s = await loadState(ctx); s.stop += 1; await persist(ctx, s); return { stopped: true }; }
/** Skips the alert on screen (and what is read of it). */
export async function skipAlert(ctx) { const s = await loadState(ctx); s.skip += 1; s.stop += 1; await persist(ctx, s); return { skipped: true }; }

/** The flagged and held texts, for the dock and the administration: [{ id, reason, type, name, text, at, hold }], newest first. */
export async function textsList(ctx) {
  const s = await loadState(ctx);
  return s.texts.slice().reverse().map((x) => ({ id: x.id, reason: x.reason, type: x.type, name: x.name, text: x.text, at: x.at, hold: x.hold === true }));
}
/**
 * "Accept anyway" shows (and reads) the text; "Dismiss" keeps it hidden. A held alert waits for the decision: accepted, it comes out with its text; dismissed, it comes out WITHOUT the text
 * (the event is not lost). A flagged alert already showed without the text: accepted, it comes again with the text; dismissed, only the entry goes.
 */
export async function decideText(ctx, id, action, emit, now = Date.now()) {
  const s = await loadState(ctx);
  const i = s.texts.findIndex((x) => x.id === id);
  if (i < 0) return { ok: false, code: "unknown" };
  const x = s.texts[i];
  s.texts.splice(i, 1);
  if (action === "accept") emit({ ...x.with, approved: true, id: `${x.id}-ok`, ...(x.repeat ? {} : {}) });
  else if (x.hold) emit(x.without);
  await persist(ctx, s);
  journalFlag(ctx, x.id, x.reason, action === "accept" ? "accepted" : "dismissed");
  return { ok: true, action, reason: x.reason, type: x.type, id: x.id, hold: x.hold === true };
}
/** Pauses: alerts keep being collected, but are HELD (kept, in order) instead of shown. */
export async function pause(ctx) { const s = await loadState(ctx); if (!s.paused) { s.paused = true; await persist(ctx, s); } return { paused: true, held: s.held.length }; }
/** Resumes: the held alerts come out, oldest first (the page queues them one after the other). */
export async function resume(ctx, emit) {
  const s = await loadState(ctx);
  const out = s.held.splice(0);
  s.paused = false;
  for (const a of out) emit(a);
  await persist(ctx, s);
  return { paused: false, released: out.length };
}
/** Empties what waits (held and staged alerts) and tells the pages to empty their own queue and the card on screen. */
export async function clearQueue(ctx, emit) {
  const s = await loadState(ctx);
  const dropped = s.held.length + s.staged.length;
  s.held = []; s.staged = [];
  emit({ control: "clear", kind: "alert", message: "" });
  await persist(ctx, s);
  return { cleared: true, dropped };
}

/** Tells the journal of Twitch activity (when it is there) that a text was hidden, held, accepted or dismissed, so its page can mark the line. Never blocks, never fails. */
export function journalFlag(ctx, id, reason, state) {
  try { Promise.resolve(ctx.api.services.call("twitch.journal", "flag", { id: String(id), reason, state })).catch(() => {}); } catch { /* the journal is optional */ }
}

/* ───────────── What the overlay page reports about the voice (voices it sees, support) ───────────── */

/** The page tells which voices it sees (route tts-report): kept in memory and in a small document, so the administration can offer them. */
export async function saveReport(ctx, body, now = Date.now()) {
  const voices = (Array.isArray(body?.voices) ? body.voices : []).slice(0, 60).map((v) => ({ n: String(v?.n ?? "").slice(0, 80), l: String(v?.l ?? "").slice(0, 20) })).filter((v) => v.n);
  const rep = { supported: body?.supported === true, voices, at: now };
  stateOf(ctx).report = rep;
  await serial(ctx.instance.key, () => save(ctx, "report", rep)).catch(() => {});
  return rep;
}
export async function loadReport(ctx) {
  const s = stateOf(ctx);
  if (s.report) return s.report;
  try { const d = (await one(ctx, "report"))?.data; if (d) s.report = { supported: d.supported === true, voices: Array.isArray(d.voices) ? d.voices : [], at: Number(d.at) || 0 }; } catch { /* none yet */ }
  return s.report ?? null;
}
/** The six video slots of the settings (media of the site only), as a list that alertFor indexes (slot 1 is index 0). */
export const VIDEO_KEYS = ["video1", "video2", "video3", "video4", "video5", "video6"];
export const videosOf = (setting) => VIDEO_KEYS.map((key) => { const v = String(setting(key) ?? ""); return VIDEO_RE.test(v) ? v : ""; });

/* ───────────── The pull: from the topic to the pages ───────────── */

/**
 * Reads the topic and sends what is new. `emit(alert)` shows an alert (or `s.held` keeps it when paused). Returns the number of alerts sent now.
 * The engine is told how to write with `env` = { t(key, vars), locale, seconds (default duration), showText, ignore (a Set), groupMs, now }.
 */
export async function pullTwitch(ctx, emit, env) {
  const s = await loadState(ctx);
  const now = env.now ?? Date.now();
  let items = [];
  try { const r = await ctx.api.topics.collect(TOPIC, { limit: 200 }); /* the most the topic gives: a burst of up to 200 lines between two reads is not lost */ items = Array.isArray(r) ? r : []; } catch { items = []; }
  const config = await loadConfig(ctx, now);
  const t = env.t, text = (id) => t(`tw_text_${id}`), title = (phase) => t(`tw_title_${phase}`);
  const shared = { config, ignore: env.ignore, showText: env.showText, locale: env.locale, text, title, seconds: env.seconds, baseSeconds: env.baseSeconds, videos: env.videos ?? [], now };
  let changed = false;
  const stagedIds = new Set(s.staged.map((x) => x.key));
  const fresh = [];
  for (const item of items.slice().sort((a, b) => Date.parse(a.at ?? "") - Date.parse(b.at ?? ""))) {
    if (typeof item?.id !== "string" || !item.id || item.id.length > 100) continue;
    const key = `${item.source?.instance ?? ""}|${item.id}`;
    if (s.seen.has(key) || stagedIds.has(key)) continue;
    const r = alertFor(item, shared);
    if (r.held) {
      // the whole alert waits for a decision (the owner chose "hold the alert"): kept, never shown or read until then
      const entry = { id: String(item.id), at: now, reason: r.held.reason, type: r.held.type, name: r.held.name, text: r.held.text, hold: true, with: r.held.with, without: { ...r.held.with, detail: undefined, say: undefined } };
      delete entry.without.detail; delete entry.without.say;
      s.texts.push(entry); if (s.texts.length > LIMITS.texts) s.texts.shift();
      remember(s, key); changed = true;
      env.onFlag?.(item, r.held.reason, "held");
      continue;
    }
    if (!r.alert) { remember(s, key); changed = true; continue; }
    if (r.flagged) {
      s.texts.push({ id: String(item.id), at: now, reason: r.flagged.reason, type: r.flagged.type, name: r.flagged.name, text: r.flagged.text, hold: false, with: r.flagged.with });
      if (s.texts.length > LIMITS.texts) s.texts.shift();
      env.onFlag?.(item, r.flagged.reason, "hidden");
    }
    const forced = item.test === true || item.replay === true;
    if (r.group && env.groupMs > 0 && !forced) { s.staged.push({ key, item, alert: r.alert, type: r.type, readyAt: now + env.groupMs }); continue; }
    remember(s, key); changed = true;
    fresh.push(r.alert);
  }
  // staged items whose wait is over, in one burst
  const ready = s.staged.filter((x) => x.readyAt <= now);
  if (ready.length) {
    s.staged = s.staged.filter((x) => x.readyAt > now);
    for (const x of ready) remember(s, x.key);
    changed = true;
    const grouped = groupBurst(ready, { config, locale: env.locale, text, title, seconds: env.seconds, baseSeconds: env.baseSeconds, videos: env.videos ?? [] });
    fresh.push(...grouped);
  }
  let sent = 0;
  for (const a of fresh) {
    if (s.paused) { s.held.push(a); if (s.held.length > LIMITS.held) s.held.shift(); changed = true; } else { emit(a); sent++; }
  }
  if (changed) await persist(ctx, s);
  return sent;
}
