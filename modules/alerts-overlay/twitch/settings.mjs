// The options of the Twitch listening, read with care. (1.18.0) They were settings of the module "Twitch activity"; since it lives in this overlay they are kept in
// the state of the listening (`options`), set from the first tab (a site without Twitch never sees them) and taken over once from Twitch activity (see home.mjs).
// `channel` stays a setting of this module (a choice among the copies of My Twitch channel, asked only when there are several).
// A value of the state wins; without it, the value given by the context (the tests give them as settings), then the default. Each is converted, bounded, and falls back to its default.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const st = await import(`./state.mjs${v}`);

const int = (v, min, max, def) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : def; };
export const RETENTION = { min: 1, max: 365, def: 30 };
export const SILENT = { min: 0, max: 48, def: 3 };
export const KEYS = ["retentionDays", "healthMail", "silentHours"];
const cache = (globalThis.__curiosaAlertsTwitchOptions ??= new Map());   // overlay key → the options of the state
export const resetOptions = () => cache.clear();

/** Reads the options of the state into memory (call it before `settingsOf` in a task, a page or an action). Never throws. */
export async function loadOptions(ctx) {
  let o = {};
  try { const s = await st.readState(ctx); o = s.options && typeof s.options === "object" ? s.options : {}; } catch { o = {}; }
  cache.set(ctx.instance.key, o);
  return o;
}
/** Saves options (already checked): only the known keys. */
export async function saveOptions(ctx, change) {
  const keep = Object.fromEntries(Object.entries(change ?? {}).filter(([k]) => KEYS.includes(k)));
  const d = await st.updateState(ctx, (x) => { x.options = { ...(x.options ?? {}), ...keep }; });
  cache.set(ctx.instance.key, d.options ?? {});
  return d.options;
}
export function settingsOf(ctx) {
  const o = cache.get(ctx.instance.key) ?? {};
  const pick = (k) => (o[k] !== undefined ? o[k] : ctx.setting(k));
  return {
    channel: String(ctx.setting("channel") ?? o.channel ?? "").trim().slice(0, 200),   // the id of an instance of My Twitch channel (see channel.mjs)
    silentHours: int(pick("silentHours"), SILENT.min, SILENT.max, SILENT.def),   // live this long without any event: the owner is told (0 = never)
    healthMail: pick("healthMail") !== false,
    retentionDays: int(pick("retentionDays"), RETENTION.min, RETENTION.max, RETENTION.def),
  };
}
