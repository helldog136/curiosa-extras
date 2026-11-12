// What the module offers to the others: the topic `twitch.event` (the journal, newest first, as plain items), and the two ways to add a line that did not come from Twitch:
// a TEST (a realistic sample with invented names) and a REPLAY (a copy of a past line, with the same data). Both are flagged in the journal and in the topic, and removed after a day.
import { randomBytes } from "node:crypto";
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const es = await import(`./eventsub.mjs${v}`);
const st = await import(`./state.mjs${v}`);

export const TOPIC = "twitch.event";
export const LIMITS = { topic: 200, topicDefault: 50, replaysPerMinute: 10, testsPerMinute: 20 };

/** Realistic samples, with invented names only (never a real person). */
export function samples(kind, now = Date.now()) {
  const S = {
    follow: { kind: "follow", name: "Camille", login: "camille" },
    sub: { kind: "sub", name: "etoile_nord", login: "etoile_nord", tier: "1" },
    resub: { kind: "resub", name: "lune_douce", login: "lune_douce", tier: "1", months: 12, streak: 12, text: "Already a year, thank you for the good times." },
    gift: { kind: "gift", name: "Camille", login: "camille", tier: "1", count: 5, cumulative: 25, anonymous: false },
    cheer: { kind: "cheer", name: "etoile_nord", login: "etoile_nord", amount: 500, text: "Cheer500 well played" },
    raid: { kind: "raid", name: "lune_douce", login: "lune_douce", viewers: 42 },
    online: { kind: "online", name: "Camille", login: "camille", streamType: "live" },
    offline: { kind: "offline", name: "Camille", login: "camille" },
    hype_begin: { kind: "hype_begin", level: 1, total: 600, goal: 1800, progress: 600, trainType: "regular", shared: false, top: [{ name: "etoile_nord", kind: "bits", total: 300 }, { name: "lune_douce", kind: "subscription", total: 300 }] },
    hype_progress: { kind: "hype_progress", level: 3, total: 4200, goal: 5400, progress: 1400, trainType: "regular", shared: false },
    hype_end: { kind: "hype_end", level: 4, total: 9100, trainType: "regular", shared: false, top: [{ name: "etoile_nord", kind: "bits", total: 3000 }, { name: "lune_douce", kind: "subscription", total: 2500 }, { name: "Camille", kind: "other", total: 900 }] },
    redeem: { kind: "redeem", name: "lune_douce", login: "lune_douce", title: "Hydrate", amount: 500, text: "" },
  };
  return S[kind] ? { ...S[kind], at: now } : null;
}
/** The kinds a "Test" button of a type sends. */
export const testKinds = (typeId) => (typeId === "hype" ? ["hype_begin", "hype_end"] : es.typeOf(typeId)?.kinds ?? []);

const rid = (p) => `${p}-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;

/** Sends the test of one type. Returns { ok: true, ids } or { ok: false, code: "unknown" | "rate" }. Works even when the type is switched off (a test shows what it would look like). */
export async function sendTest(ctx, typeId, { now = Date.now() } = {}) {
  const kinds = testKinds(typeId);
  if (!kinds.length) return { ok: false, code: "unknown" };
  if (!st.allow(ctx, "tests", { max: LIMITS.testsPerMinute, windowMs: 60_000, now })) return { ok: false, code: "rate" };
  const ids = [];
  for (const [i, k] of kinds.entries()) {
    const id = rid("test");
    await st.record(ctx, id, samples(k, now + i), { source: "test", now });
    ids.push(id);
  }
  return { ok: true, ids };
}

/**
 * Replays a past line: a NEW line with the same data, dated now, flagged "replay" and pointing at the original (`of`). Works whatever the state of the type (a manual replay is wanted).
 * Rate limited (10 a minute) and de-bounced: replaying the same line twice within 3 seconds answers the first one again (a double click never sends two alerts).
 * { ok: true, id, again? } or { ok: false, code: "unknown" | "rate" }.
 */
export async function replay(ctx, id, { now = Date.now() } = {}) {
  const orig = await st.byId(ctx, id);
  if (!orig) return { ok: false, code: "unknown" };
  const m = st.memoryOf(ctx);
  const recent = (m.lastReplay ??= new Map()).get(orig.id);
  if (recent && now - recent.at < 3000) return { ok: true, id: recent.id, again: true };
  if (!st.allow(ctx, "replays", { max: LIMITS.replaysPerMinute, windowMs: 60_000, now })) return { ok: false, code: "rate" };
  const nid = rid("replay");
  m.lastReplay.set(orig.id, { at: now, id: nid });
  if (m.lastReplay.size > 200) m.lastReplay.delete(m.lastReplay.keys().next().value);
  await st.record(ctx, nid, { ...orig, at: now }, { source: "replay", of: orig.of ?? orig.id, now });
  return { ok: true, id: nid };
}

/* ───────────── The topic ───────────── */
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
/** A journal line → an item of the topic `twitch.event`. Only plain values; the consumer keeps the fields of its own schema. */
export function toItem(d) {
  const o = {
    id: String(d.id), type: d.kind, at: new Date(Number.isFinite(d.at) ? d.at : Date.now()).toISOString(),
    test: d.source === "test", replay: d.source === "replay", missed: d.missed === true,
  };
  for (const k of ["name", "login", "tier", "text", "title", "trainType", "streamType"]) if (typeof d[k] === "string" && d[k]) o[k] = d[k];
  for (const k of ["months", "streak", "count", "cumulative", "amount", "viewers", "level", "total", "goal", "progress", "bestLevel"]) if (num(d[k]) !== undefined) o[k] = d[k];
  for (const k of ["anonymous", "gifted", "shared"]) if (d[k] === true) o[k] = true;
  if (Array.isArray(d.top) && d.top.length) o.contributors = d.top.map((c) => c.name).filter(Boolean).slice(0, 3);
  if (d.of) o.of = String(d.of);
  return o;
}
const cache = new Map();   // instance → { at, limit, items }  (the consumers ask every couple of seconds: one read a second is enough)
/** `exports["twitch.event"]`: the newest lines first. Types switched off are not hidden: they were on when the line arrived. */
export async function topicItems(ctx, opts = {}, now = Date.now()) {
  const limit = Math.min(LIMITS.topic, Math.max(1, Math.trunc(Number(opts.limit)) || LIMITS.topicDefault));
  const k = ctx.instance.key, hit = cache.get(k);
  let items;
  if (hit && now - hit.at < 1000 && hit.limit >= limit) items = hit.items;
  else { items = (await st.recent(ctx, limit)).map(toItem); cache.set(k, { at: now, limit, items }); }
  const from = opts.from instanceof Date ? opts.from.getTime() : undefined, to = opts.to instanceof Date ? opts.to.getTime() : undefined;
  return items.filter((i) => (from === undefined || Date.parse(i.at) >= from) && (to === undefined || Date.parse(i.at) <= to)).slice(0, limit);
}
export const forgetCache = () => cache.clear();
