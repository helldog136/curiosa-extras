// The Twitch alerts of the overlay: the topic `twitch.event` (offered by Twitch activity, never required) turned into alerts. This file holds the whole engine, so that the
// overlay page itself changes very little: per-type switches, text templates, duration, minimums and an ignore list; a staging area that groups bursts ("5 gifts by Camille",
// "12 new followers"); a pause that HOLDS the alerts (they come out when resumed); and the memory of what was already shown (it survives a restart).
// Pure functions first (tested alone), then the stateful part, keyed by overlay instance.
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
export const LIMITS = { template: 120, seconds: { min: 2, max: 60 }, min: 1_000_000, maxAgeMs: 5 * 60_000, maxAgeMissedMs: 60 * 60_000, seenKeep: 400, held: 50, ignore: 50, groupFollows: 3, gapMs: { min: 0, max: 30_000 }, groupMs: { min: 0, max: 30_000 } };

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
    };
  }
  return out;
}
/** Names to ignore, from the setting: separated by commas, spaces or new lines, without @, lower case, 50 at most. */
export const ignoreOf = (text) => new Set(String(text ?? "").toLowerCase().split(/[\s,;]+/).map((s) => s.replace(/^@/, "")).filter((s) => /^[a-z0-9_]{2,25}$/.test(s)).slice(0, LIMITS.ignore));

/** The look of a type: its picture, its sound and its way of entering (each only when chosen). */
const look = (cfg) => ({ ...(cfg.image ? { image: cfg.image } : {}), ...(cfg.sound && cfg.sound !== "none" ? { sound: cfg.sound } : {}), ...(cfg.anim ? { anim: cfg.anim } : {}) });

/**
 * One item of the topic → what to do with it: { alert } (to show now or to stage), or { skip: reason }.
 * `text(typeId, phase)` gives the default template and `title(phase)` the title of a hype train line; `now` is for the age limit.
 * Tests and replays (`item.test`, `item.replay`) skip the switches, the minimums, the ignore list and the age limit: a person who asks to see an alert sees it.
 */
export function alertFor(item, { config, ignore = new Set(), showText = false, locale = "en", text, title, seconds = 0, now = Date.now() }) {
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
  const detail = showText && ["resub", "cheer", "redeem"].includes(type) ? clean(item.text, 140) : "";
  const secs = cfg.seconds || seconds || 0;
  return { alert: { kind: KIND[type], message, ...(detail ? { detail } : {}), ...(phase ? { title: title(phase) } : {}), ...(secs ? { duration: secs } : {}), ...look(cfg), queued: true, id: String(item.id ?? "") }, type, group: type === "gift" || type === "follow" };
}

/**
 * Groups a burst that waited in the staging area: gifts by the same person (same tier) become one alert with the sum; three or more follows become "N new followers".
 * `staged`: [{ alert, item, type }]; returns the alerts to show, in order. Each group keeps the place of its first member.
 */
export function groupBurst(staged, { config, locale = "en", text, title, seconds = 0 }) {
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
  return out.map((o) => {
    if (o.alert || o.message) return o;
    if (o.n !== undefined) {
      const cfg = config.types.follow;
      return { kind: KIND.follow, message: fillTemplate(text("follow_many"), { name: clean(o.first.name, 60), count: num(o.n, locale) }), ...(cfg.seconds || seconds ? { duration: cfg.seconds || seconds } : {}), ...look(cfg), queued: true, id: `group-${o.first.id}` };
    }
    // a (merged) gift: the alert is rebuilt with the total
    const cfg = config.types.gift, item = o.item;
    const vars = varsOf({ ...item, count: o.count }, locale);
    if (item.anonymous === true) vars.name = text("anonymous");
    return { kind: KIND.gift, message: fillTemplate(cfg.template || text("gift"), vars), ...(cfg.seconds || seconds ? { duration: cfg.seconds || seconds } : {}), ...look(cfg), queued: true, id: `gift-${item.id}` };
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
  if (!states.has(k)) states.set(k, { seen: new Set(), staged: [], held: [], paused: false, loaded: null, config: null, configAt: 0 });
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
        if (d) { for (const id of Array.isArray(d.seen) ? d.seen : []) s.seen.add(String(id)); s.paused = d.paused === true; s.held = (Array.isArray(d.held) ? d.held : []).slice(-LIMITS.held); }
      } catch { /* a fresh start is fine */ }
    })();
  }
  await s.loaded;
  return s;
}
const persist = (ctx, s) => serial(ctx.instance.key, () => save(ctx, "state", { seen: [...s.seen].slice(-LIMITS.seenKeep), paused: s.paused, held: s.held.slice(-LIMITS.held) })).catch(() => {});
const remember = (s, key) => { s.seen.add(key); while (s.seen.size > LIMITS.seenKeep) s.seen.delete(s.seen.values().next().value); };

/* ───────────── The queue controls (for the admin page, the dock and the service `alerts.queue`) ───────────── */

export async function queueState(ctx) {
  const s = await loadState(ctx);
  return { paused: s.paused, held: s.held.length, staged: s.staged.length };
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
  const shared = { config, ignore: env.ignore, showText: env.showText, locale: env.locale, text, title, seconds: env.seconds, now };
  let changed = false;
  const stagedIds = new Set(s.staged.map((x) => x.key));
  const fresh = [];
  for (const item of items.slice().sort((a, b) => Date.parse(a.at ?? "") - Date.parse(b.at ?? ""))) {
    if (typeof item?.id !== "string" || !item.id || item.id.length > 100) continue;
    const key = `${item.source?.instance ?? ""}|${item.id}`;
    if (s.seen.has(key) || stagedIds.has(key)) continue;
    const r = alertFor(item, shared);
    if (!r.alert) { remember(s, key); changed = true; continue; }
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
    const grouped = groupBurst(ready, { config, locale: env.locale, text, title, seconds: env.seconds });
    fresh.push(...grouped);
  }
  let sent = 0;
  for (const a of fresh) {
    if (s.paused) { s.held.push(a); if (s.held.length > LIMITS.held) s.held.shift(); changed = true; } else { emit(a); sent++; }
  }
  if (changed) await persist(ctx, s);
  return sent;
}
