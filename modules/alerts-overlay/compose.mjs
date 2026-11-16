// Compositions (1.12.0): the text placed on a picture or a GIF of a reaction ("Place the text", core 0.19.0). ONE owner: this overlay.
// They live in their OWN collection, never in the configuration: `normaliseConfig` rebuilds the configuration key by key, so an older version of this
// module that saves its settings would wipe them. Here an older module simply never reads them and the alert shows the media alone, as before.
// Row: { key: "<place>|<src>", place: "event:<type>", src, composition, updatedAt, by }. One composition per file of a place (the files of a reaction differ).
// The checker, the filling of the texts and the engine of the page come from the core (`ctx.overlay`, core 0.19.0): an older core has none, and nothing here
// does anything (the alert stays "media alone").
export const COLLECTION = "compositions";
export const PLACE_RE = /^(event:[a-z]{2,12}|show:[a-z0-9-]{1,40}:[a-z]{2,10}:[A-Za-z0-9_-]{1,40})$/;
/** (1.16.0) The place of a media another module shows (`alerts.show`): "<its instance key>:<its kind>:<its id>", e.g. "twitch-bot:custom:k3x9". */
export const SHOW_RE = /^[a-z0-9-]{1,40}:[a-z]{2,10}:[A-Za-z0-9_-]{1,40}$/;
/** (1.16.0) The places other modules declared (`alerts.show.place`, or the first `show` of a command): { place, label, files, variables, phrase }. */
export const PLACES = "composePlaces";
const TOKEN_RE = /^[a-z][a-zA-Z0-9_]{0,23}$/;
const SRC_RE = /^\/uploads\/[0-9a-f-]{36}\.(png|jpg|webp|gif|mp4|webm)$/;
const cache = (globalThis.__curiosaAlertsCompose ??= new Map());   // overlay key → { at, rows: Map<key, row> }
const TTL = 10_000;
export const resetComposeCache = () => cache.clear();

/** Whether the core of the site can check and draw compositions. */
export const available = (ctx) => typeof ctx?.overlay?.composeScript === "function" && typeof ctx.overlay.checkComposition === "function";
export const keyOf = (place, src) => `${place}|${src}`;
/** (1.14.0) Whether the core also places text on VIDEOS (core 0.21.0: how they play, their sound, the alert as long as the video). */
export const videoReady = (ctx) => available(ctx) && Array.isArray(ctx.overlay.features) && ctx.overlay.features.includes("video");

async function rowsOf(ctx, now = Date.now()) {
  const k = ctx.instance.key, c = cache.get(k);
  if (c && now - c.at < TTL) return c.rows;
  const rows = new Map();
  try {
    for (const r of await ctx.api.store.list(COLLECTION, { limit: 500 })) {
      const d = r?.data;
      if (d && typeof d.key === "string" && d.composition && typeof d.composition === "object") rows.set(d.key, { id: r.id, ...d });
    }
  } catch { /* none yet */ }
  cache.set(k, { at: now, rows });
  return rows;
}
/** Whether this overlay holds at least one composition (the page then carries the engine; otherwise it is byte for byte the page of before). */
export async function hasAny(ctx) { return available(ctx) && (await rowsOf(ctx)).size > 0; }

/** (1.15.0) The rows of a place (with `updatedAt` and `by`), for the assistant tools. */
export async function rowsFor(ctx, place) { return [...(await rowsOf(ctx)).values()].filter((r) => r.place === place); }

/** The compositions of a place, by file: { [src]: composition }. */
export async function forPlace(ctx, place) {
  const out = {};
  for (const r of (await rowsOf(ctx)).values()) if (r.place === place) out[r.src] = r.composition;
  return out;
}

/**
 * Checks what a window sends for a place: { [src]: composition | null } (null = no text on that file). Returns { ok, value } (checked compositions, by src)
 * or { ok: false, errors: { [src]: [{ path, code }] } }. Only files of `files` may carry one.
 */
export function check(ctx, given, { files, variables }) {
  const value = {}, errors = {};
  for (const [src, raw] of Object.entries(given ?? {})) {
    if (!SRC_RE.test(src) || !files.includes(src)) { errors[src] = [{ path: "backdrop.src", code: "file" }]; continue; }
    if (raw === null || raw === undefined) { value[src] = null; continue; }
    const r = ctx.overlay.checkComposition(raw, { src, variables });
    if (r.ok) value[src] = r.value; else errors[src] = r.errors;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

/**
 * Saves the compositions of a place: `value` from `check` (null removes), and every row of the place whose file is no longer in `files` goes too
 * (a file taken out of a reaction loses its text). `by`: "person" or "assistant:<name>". Never throws.
 */
export async function save(ctx, place, value, { files, by = "person", now = Date.now() } = {}) {
  const rows = await rowsOf(ctx, now);
  const keep = new Set(files);
  for (const r of [...rows.values()]) {
    if (r.place !== place) continue;
    if (!keep.has(r.src) || value[r.src] === null) { try { await ctx.api.store.remove(r.id); } catch { /* already gone */ } rows.delete(r.key); }
  }
  for (const [src, composition] of Object.entries(value)) {
    if (!composition || !keep.has(src)) continue;
    const key = keyOf(place, src), data = { key, place, src, composition, updatedAt: new Date(now).toISOString(), by };
    const cur = rows.get(key);
    try {
      if (cur) await ctx.api.store.update(cur.id, data); else { const id = await ctx.api.store.add(COLLECTION, data); rows.set(key, { id: typeof id === "string" ? id : id?.id, ...data }); continue; }
      rows.set(key, { ...cur, ...data });
    } catch { /* the next save tries again */ }
  }
  cache.delete(ctx.instance.key);
}

/** How the engine fills a composition for an alert: `(place, src, message, vars)` → the resolved composition, or null (no text placed on that file). */
export function composerOf(ctx, byKey) {
  if (!available(ctx)) return null;
  return (place, src, message, vars) => {
    const c = byKey.get(keyOf(place, src));
    if (!c) return null;
    try { return ctx.overlay.resolveComposition(c, { phrase: message, values: vars }); } catch { return null; }
  };
}
/** All compositions of the overlay as a Map key → composition (for the engine). */
export async function allByKey(ctx) {
  const out = new Map();
  if (!available(ctx)) return out;
  for (const [k, r] of await rowsOf(ctx)) out.set(k, r.composition);
  return out;
}

/* ───────────── (1.16.0) Places of other modules (the Twitch bot's commands and words) ───────────── */

const clean = (x, max) => String(x ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/** A place declaration, bounded: label 80, 12 files of this site, 20 automatic values, a sample sentence of 200. Null when the place is not valid. */
export function readPlace(input) {
  const show = String(input?.place ?? "");
  if (!SHOW_RE.test(show)) return null;
  const files = [...new Set((Array.isArray(input?.files) ? input.files : []).map(String).filter((s) => SRC_RE.test(s)))].slice(0, 12);
  const variables = [...new Set((Array.isArray(input?.variables) ? input.variables : []).map(String).filter((t) => TOKEN_RE.test(t)))].slice(0, 20);
  return { place: `show:${show}`, label: clean(input?.label, 80) || show, files, variables, phrase: clean(input?.phrase, 200) };
}
async function placeRows(ctx) {
  try { return (await ctx.api.store.list(PLACES, { limit: 500 })).filter((r) => r?.data && typeof r.data.place === "string"); } catch { return []; }
}
/** Every declared place: [{ place, label, files, variables, phrase, updatedAt }]. */
export async function showPlaces(ctx) { return (await placeRows(ctx)).map((r) => r.data); }
export async function showPlace(ctx, place) { return (await placeRows(ctx)).find((r) => r.data.place === place)?.data ?? null; }
/** Declares (or updates) a place; nothing is written when it did not change (a command shown often costs one read). The compositions of files no longer listed go. */
export async function declarePlace(ctx, decl, now = Date.now()) {
  const rows = await placeRows(ctx), cur = rows.find((r) => r.data.place === decl.place);
  const data = { ...decl, updatedAt: new Date(now).toISOString() };
  const same = cur && JSON.stringify([cur.data.label, cur.data.files, cur.data.variables, cur.data.phrase]) === JSON.stringify([decl.label, decl.files, decl.variables, decl.phrase]);
  if (same) return false;
  try { if (cur) await ctx.api.store.update(cur.id, data); else await ctx.api.store.add(PLACES, data); } catch { return false; }
  // a file taken out of a command loses its text
  const placed = await forPlace(ctx, decl.place);
  if (Object.keys(placed).some((src) => !decl.files.includes(src))) await save(ctx, decl.place, {}, { files: decl.files, now });
  return true;
}
/** Forgets a place and its texts (the command or the word was deleted). */
export async function forgetPlace(ctx, place) {
  for (const r of await placeRows(ctx)) if (r.data.place === place) { try { await ctx.api.store.remove(r.id); } catch { /* gone */ } }
  await save(ctx, place, {}, { files: [] });
}

