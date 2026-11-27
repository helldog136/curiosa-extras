// Extra small pieces of information for Home Assistant: the `home.info` topic that OTHER modules may provide (optional), for example "the sponsor currently on the OBS overlay".
// Added to the `pull` response (field `info`) next to `catalog`. It is display data, not an action: it is never filtered by `enabled` or `live`, and nothing ever comes from the house.
// The topic is read at most every 5 s (15 s after a failure), waiting 1.5 s at most; 20 items; every text is cleaned HERE too (never trust the text of another module).
const v = new URL(import.meta.url).search; // the module version propagates to its neighbour files (otherwise the old code would stay cached after an update)
const { clean } = await import(`./moderation.mjs${v}`);

export const INFO = { max: 20, label: 60, value: 120, unit: 12, ttlMs: 5_000, retryMs: 15_000, waitMs: 1500, maxAbs: 1e12 };
const KEY_RE = /^[a-z0-9][a-z0-9._:-]{0,59}$/;
const topic = "home.info";

const state = new Map();   // instance -> { at, failAt, items } (memory only)
export const resetInfo = () => state.clear();
const of = (ctx) => { const k = ctx.instance.key; if (!state.has(k)) state.set(k, { at: 0, failAt: 0, items: [] }); return state.get(k); };

const cutCodePoints = (text, n) => [...text].slice(0, n).join("").trim();
const text = (x, n) => (typeof x === "string" ? cutCodePoints(clean(x, { maxRaw: 400 }).text, n) : "");

/** The received items, cleaned: { key, label, value, unit? }. Invalid or repeated keys are dropped (the first wins), 20 at most. */
export function cleanInfo(raw) {
  const out = [], seen = new Set();
  for (const x of Array.isArray(raw) ? raw : []) {
    if (out.length >= INFO.max) break;
    const key = x && typeof x === "object" && typeof x.key === "string" ? x.key : "";
    if (!KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    let value = null;
    if (typeof x.value === "string") value = text(x.value, INFO.value) || null;
    else if (typeof x.value === "number") value = Number.isFinite(x.value) && Math.abs(x.value) < INFO.maxAbs ? x.value : null;
    else if (typeof x.value === "boolean") value = x.value;
    const item = { key, label: text(x.label, INFO.label) || key, value };
    const unit = typeof value === "number" ? text(x.unit, INFO.unit) : "";
    if (unit) item.unit = unit;
    out.push(item);
  }
  return out;
}

/** Waits for `p` at most `ms` (the timer is always stopped and does not hold the process); past that delay, or on an error: `fallback`. */
function within(p, ms, fallback) {
  let t;
  return Promise.race([Promise.resolve().then(() => p).catch(() => fallback), new Promise((r) => { t = setTimeout(() => r(fallback), ms); t.unref?.(); })]).finally(() => clearTimeout(t));
}

/**
 * The known information: the list kept in memory if it is less than 5 s old, otherwise read again. A failure or the absence of any provider keeps the last known list (empty at first)
 * and is not retried before 15 s: a poll from Home Assistant never waits more than 1.5 s for this. `fetch: false`: only what is in memory.
 */
export async function infoNow(ctx, now = Date.now(), { fetch = true } = {}) {
  const c = of(ctx);
  if (!fetch || (now >= c.at && now - c.at < INFO.ttlMs) || (now >= c.failAt && now - c.failAt < INFO.retryMs)) return c.items;
  let raw = null;
  try { raw = typeof ctx.api?.topics?.collect === "function" ? await within(ctx.api.topics.collect(topic, { limit: INFO.max }), INFO.waitMs, null) : null; } catch { raw = null; }
  if (Array.isArray(raw)) { c.items = cleanInfo(raw); c.at = now; c.failAt = 0; }
  else c.failAt = now;
  return c.items;
}
