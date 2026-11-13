// The media library of the overlay: pictures, GIFs and sounds sent from the "Media" tab (plus the videos of the six video fields), each with a name. Other modules of the site
// (the Twitch bot) pick a media by its id through the service `alerts.show` and never hold a file themselves: ONE place to send and name media, the files stay owned by this module.
// What a media does on screen goes through the same queue as the alerts (waiting turn, pause, skip, "Empty the queue"), so everything the page already honours keeps working.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const tw = await import(new URL(`./twitch.mjs${v}`, import.meta.url).href);

export const COLLECTION = "mediaLib";
export const LIMITS = { items: 100, name: 40, perMinute: 30, soundOnlySeconds: 4 };
export const KINDS = ["picture", "video", "sound"];
/** The synthesised sounds of the page, offered next to the sound files (nothing is uploaded for them). */
export const TONES = tw.SOUNDS.filter((x) => x !== "none");

const clean = (x, max) => String(x ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/** The name as it is compared: no accents, no capitals, no punctuation noise. */
export const fold = (x) => String(x ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
export const cleanName = (x) => clean(x, LIMITS.name);
const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const rowsOf = async (ctx) => (await ctx.api.store.list(COLLECTION, { limit: 200 })).filter((r) => r?.data && typeof r.data.id === "string" && ["picture", "sound"].includes(r.data.kind));
const urlRe = { picture: tw.IMAGE_RE, sound: tw.AUDIO_RE };

/** The files of the library, as the service lists them: [{ id, name, kind, url, builtin? }], videos and synthesised sounds included, sorted by kind then name. */
export async function list(ctx, { tones = true } = {}) {
  const t = ctx.t;
  const own = (await rowsOf(ctx)).filter((r) => urlRe[r.data.kind].test(String(r.data.url ?? ""))).map((r) => ({ id: r.data.id, name: cleanName(r.data.name) || r.data.id, kind: r.data.kind, url: r.data.url }));
  const videos = tw.videosOf(ctx.setting).flatMap((url, i) => (url ? [{ id: `video:${i + 1}`, name: t("tw_video_slot", { n: i + 1 }), kind: "video", url }] : []));
  const sounds = tones ? TONES.map((x) => ({ id: `tone:${x}`, name: t(`tw_sound_${x}`), kind: "sound", builtin: true })) : [];
  const order = (a) => KINDS.indexOf(a.kind);
  return [...own, ...videos, ...sounds].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name, ctx.locale));
}
/** Does the page need the media code? Only when there is something in the library or in a video field (otherwise the page stays what it was). */
export async function hasMedia(ctx) {
  try { return (await rowsOf(ctx)).length > 0 || tw.videosOf(ctx.setting).some(Boolean); } catch { return false; }
}
/** One file of the library by id, or null. */
export async function find(ctx, id) { return (await list(ctx)).find((m) => m.id === id) ?? null; }
/** A file asked for by id OR by name (case and accents ignored): for the assistants, who read names. */
export function pick(items, ref) {
  const s = String(ref ?? "").trim();
  return items.find((m) => m.id === s) ?? items.find((m) => fold(m.name) === fold(s)) ?? null;
}

/* ───────────── Adding, renaming, removing (administration) ───────────── */

const taken = (items, name, exceptId) => items.some((m) => m.id !== exceptId && fold(m.name) === fold(name));

/** Adds a file the person has just sent. `kind`: picture | sound. Rends { ok, id } or { code } (name, dup, file, full). The file is KEPT by this module (files.claim). */
export async function add(ctx, { name, kind, url }) {
  if (!["picture", "sound"].includes(kind)) return { code: "file" };
  const n = cleanName(name);
  if (!n) return { code: "name" };
  const all = await list(ctx, { tones: false });
  if (all.length >= LIMITS.items) return { code: "full" };
  if (taken(await list(ctx), n)) return { code: "dup" };
  const clean0 = String(url ?? "").trim().replace(/\?.*$/, "");
  if (!urlRe[kind].test(clean0)) return { code: "file" };
  const claim = typeof ctx.api.files?.claim === "function" ? await ctx.api.files.claim(clean0) : { ok: false };
  if (!claim.ok) return { code: "file" };
  const id = newId();
  await ctx.api.store.add(COLLECTION, { id, name: n, kind, url: clean0 });
  return { ok: true, id };
}
export async function rename(ctx, id, name) {
  const row = (await rowsOf(ctx)).find((r) => r.data.id === id);
  if (!row) return { code: "unknown" };
  const n = cleanName(name);
  if (!n) return { code: "name" };
  if (taken(await list(ctx), n, id)) return { code: "dup" };
  await ctx.api.store.update(row.id, { ...row.data, name: n });
  return { ok: true };
}
export async function remove(ctx, id) {
  const row = (await rowsOf(ctx)).find((r) => r.data.id === id);
  if (!row) return { code: "unknown" };
  await ctx.api.store.remove(row.id);
  await tw.releaseFile(ctx, row.data.url);   // kept when a reaction still uses the file
  return { ok: true, name: row.data.name };
}

/* ───────────── Showing a media (service `alerts.show`) ───────────── */

const sent = (globalThis.__curiosaAlertsMediaSent ??= new Map());   // overlay key → times of the last shows (a safety valve against a loop somewhere else)
function valve(key, now) {
  const l = (sent.get(key) ?? []).filter((t) => now - t < 60_000);
  if (l.length >= LIMITS.perMinute) { sent.set(key, l); return false; }
  l.push(now); sent.delete(key); sent.set(key, l);
  while (sent.size > 50) sent.delete(sent.keys().next().value);
  return true;
}
export const resetValve = () => sent.clear();

/** The alert the page draws for a media: the picture or the video alone (a video plays with its own sound), and/or a sound; `own` makes the page use the volume of the media, not the one of the Twitch sounds. */
export function alertOf({ visual, sound, seconds, secondsDefault }) {
  const secs = seconds ?? (visual ? secondsDefault : LIMITS.soundOnlySeconds);
  const snd = sound ? (sound.builtin ? { sound: sound.id.slice(5) } : { audio: sound.url }) : {};
  const shape = !visual ? { present: "sound" } : visual.kind === "video" ? { present: "media", video: visual.url, videoSound: true } : { present: "media", image: visual.url };
  return { kind: "alert", message: (visual ?? sound).name, own: true, queued: true, id: `media-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, duration: secs, ...shape, ...snd };
}

/**
 * Shows a media on the overlay: `input` = { visual?: id, sound?: id, seconds?: 2..60 }. Rends { ok: true, state: "shown" | "held" } or { ok: false, code }:
 * "empty" (nothing asked), "missing" (an id is not in the library any more: `missing` lists them), "seconds", "busy" (too many in a minute).
 * `emit(alert)` sends to the pages; a pause holds the media with the alerts.
 */
export async function show(ctx, input, emit, now = Date.now()) {
  const items = await list(ctx);
  const ask = (id) => (id === undefined || id === null || id === "" ? null : items.find((m) => m.id === String(id)) ?? false);
  const visual = ask(input?.visual), sound = ask(input?.sound);
  const missing = [visual === false ? String(input.visual) : null, sound === false ? String(input.sound) : null].filter(Boolean);
  if (missing.length) return { ok: false, code: "missing", missing };
  if (visual && visual.kind === "sound") return { ok: false, code: "missing", missing: [visual.id] };
  if (sound && sound.kind !== "sound") return { ok: false, code: "missing", missing: [sound.id] };
  if (!visual && !sound) return { ok: false, code: "empty" };
  let seconds;
  if (input?.seconds !== undefined && input.seconds !== null && input.seconds !== "") {
    const n = Number(input.seconds);
    if (!Number.isInteger(n) || n < tw.LIMITS.seconds.min || n > tw.LIMITS.seconds.max) return { ok: false, code: "seconds" };
    seconds = n;
  }
  if (!valve(ctx.instance.key, now)) return { ok: false, code: "busy" };
  const secondsDefault = Math.min(60, Math.max(2, Number(ctx.setting("durationSeconds")) || 6));
  const state = await tw.showOrHold(ctx, alertOf({ visual, sound, seconds, secondsDefault }), emit);
  return { ok: true, state };
}
