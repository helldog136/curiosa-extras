// (1.18.0) The four options of the Twitch alerts (sounds, viewer messages, names to ignore, burst grouping). Until 1.17.0 they were settings of the module, shown in
// the tab "Twitch events" even on a site without Twitch. They now live in the store of the copy (collection `twitchOptions`, one document) and are set by a form of
// that tab, which only shows when the site has Twitch. Data version 2 (index.mjs `migrations[2]`) copies the four settings here once (`ctx.legacy`), then clears them.
// Read: the stored value; without it, the value the context gives (the tests give them as settings), then the default. `load` fills the memory read by `get`.
export const COL = "twitchOptions";
export const KEYS = ["twitchSounds", "twitchText", "ignoreNames", "groupSeconds"];
export const DEFAULTS = { twitchSounds: false, twitchText: false, ignoreNames: "", groupSeconds: 5 };
export const LIMITS = { ignore: 2000, group: [0, 30] };
const cache = (globalThis.__curiosaAlertsOptions ??= new Map());   // overlay key → stored options
export const resetOptions = () => cache.clear();

const row = async (ctx) => (await ctx.api.store.list(COL, { limit: 1 }))[0] ?? null;
/** The stored options, made safe (only the known keys, each of its type). */
export function normalise(raw) {
  const o = {}, r = raw && typeof raw === "object" ? raw : {};
  if (typeof r.twitchSounds === "boolean") o.twitchSounds = r.twitchSounds;
  if (typeof r.twitchText === "boolean") o.twitchText = r.twitchText;
  if (typeof r.ignoreNames === "string") o.ignoreNames = r.ignoreNames.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, LIMITS.ignore);
  const g = Math.trunc(Number(r.groupSeconds));
  if (r.groupSeconds !== undefined && r.groupSeconds !== null && r.groupSeconds !== "" && Number.isFinite(g)) o.groupSeconds = Math.min(LIMITS.group[1], Math.max(LIMITS.group[0], g));
  return o;
}
/** Reads the stored options into memory and returns them with their defaults. Never throws. */
export async function load(ctx) {
  let o = {};
  try { o = normalise((await row(ctx))?.data); } catch { o = {}; }
  cache.set(ctx.instance.key, o);
  return values(ctx);
}
/** One option: stored, else given by the context, else the default. Synchronous (call `load` first in a page, a task or an action). */
export function get(ctx, key) {
  const o = cache.get(ctx.instance.key) ?? {};
  if (o[key] !== undefined) return o[key];
  const s = typeof ctx.setting === "function" ? ctx.setting(key) : undefined;
  return s !== undefined && s !== null ? s : DEFAULTS[key];
}
export const values = (ctx) => Object.fromEntries(KEYS.map((k) => [k, get(ctx, k)]));
/** Saves options (a partial change), made safe. */
export async function save(ctx, change) {
  const r = await row(ctx);
  const next = normalise({ ...(r?.data ?? {}), ...normalise(change) });
  if (r) await ctx.api.store.update(r.id, next); else await ctx.api.store.add(COL, next);
  cache.set(ctx.instance.key, next);
  return values(ctx);
}
/** Data version 2: the four settings of 1.17.0 (now `legacySettings`) are copied here once, then cleared. Idempotent (a value already stored wins). */
export async function migrateFromSettings(ctx) {
  if (!ctx.legacy) return { copied: 0 };
  const from = {};
  for (const k of KEYS) {
    const v = await ctx.legacy.get(k);
    if (v === null || v === undefined || v === "") continue;
    from[k] = k === "groupSeconds" ? Number(v) : k === "ignoreNames" ? String(v) : v === true || v === "true";
  }
  const r = await row(ctx);
  const next = normalise({ ...from, ...(r?.data ?? {}) });
  if (r) await ctx.api.store.update(r.id, next); else if (Object.keys(next).length) await ctx.api.store.add(COL, next);
  for (const k of KEYS) await ctx.legacy.clear(k);
  cache.delete(ctx.instance.key);
  return { copied: Object.keys(from).length };
}
