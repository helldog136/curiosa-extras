// The memory of the module: the state of the listening (document `state`: secret, which types are on, how each subscription is doing) and the EVENT JOURNAL (collection `events`).
// The journal is keyed by the Twitch message id: a message delivered twice (Twitch delivers "at least once") or after a restart is stored once. Nothing here is a setting.
import { randomBytes } from "node:crypto";
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const es = await import(`./eventsub.mjs${v}`);

export const COL = "events", STATE = "state";
export const JOURNAL_MAX = 5000;       // most events kept, whatever the retention
export const TEST_KEEP_MS = 24 * 3_600_000;   // test and replay lines are short-lived
const chain = new Map();
/** One write after the other for one instance and one name (events arriving together never overwrite each other). */
export function serial(ctx, name, fn) {
  const k = `${ctx.instance.key}|${name}`;
  const run = (chain.get(k) ?? Promise.resolve()).catch(() => {}).then(fn);
  chain.set(k, run);
  return run;
}
const rec = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
const row = async (ctx, name) => (await ctx.api.store.list(name, { limit: 1 }))[0] ?? null;

/* ───────────── State ───────────── */
export async function readState(ctx) { return rec((await row(ctx, STATE))?.data); }
/** Changes the state: `fn(state)` edits it in place. */
export function updateState(ctx, fn) {
  return serial(ctx, "state", async () => {
    const r = await row(ctx, STATE);
    const data = rec(r?.data);
    await fn(data);
    if (r) await ctx.api.store.update(r.id, data); else await ctx.api.store.add(STATE, data);
    return data;
  });
}
/** The secret shared with Twitch to sign its messages (ASCII, 64 characters; Twitch asks for 10 to 100): created once, never shown. */
export async function ensureSecret(ctx, { renew = false } = {}) {
  const s = await readState(ctx);
  if (s.secret && !renew) return s.secret;
  const secret = randomBytes(32).toString("hex");
  await updateState(ctx, (d) => { d.secret = secret; });
  return secret;
}
/** Which types are on: the stored choice over the defaults. */
export const enabledOf = (state) => Object.fromEntries(es.TYPES.map((t) => [t.id, typeof state.enabled?.[t.id] === "boolean" ? state.enabled[t.id] : t.default]));

/* ───────────── Journal ───────────── */
const KEEP = ["kind", "name", "login", "anonymous", "tier", "gifted", "months", "streak", "count", "cumulative", "amount", "viewers", "text", "title", "level", "total", "goal", "progress", "trainType", "shared", "top", "streamType", "bestLevel"];
/** What is stored: the normalised event minus anything not listed above, plus the bookkeeping. `source`: twitch | test | replay | catchup. */
export function toDoc(id, ev, { source = "twitch", of = null, now = Date.now(), missed = false } = {}) {
  const d = { id, at: Number.isFinite(ev.at) ? ev.at : now, receivedAt: now, source };
  for (const k of KEEP) if (ev[k] !== undefined && ev[k] !== null && ev[k] !== "") d[k] = ev[k];
  if (of) d.of = String(of).slice(0, 100);
  if (missed) d.missed = true;
  return d;
}
/**
 * Stores an event once. { stored: true, id } or { stored: false, duplicate: true }. Idempotent on `id` (the Twitch message id): the check and the write are one step.
 * Old lines are NOT purged here (see `purge`).
 */
export function record(ctx, id, ev, opts = {}) {
  const key = String(id).slice(0, 100);
  return serial(ctx, "journal", async () => {
    if (await ctx.api.store.getByKey(COL, key)) return { stored: false, duplicate: true };
    await ctx.api.store.add(COL, toDoc(key, ev, opts), { key });
    return { stored: true, id: key };
  });
}
export const view = (r) => ({ ...r.data, rowId: r.id });
/** The newest events first. `limit` up to 1000. */
export async function recent(ctx, limit = 100) {
  const out = [];
  let cursor;
  while (out.length < limit) {
    const page = await ctx.api.store.page(COL, { limit: Math.min(1000, limit - out.length), cursor, order: "desc" });
    out.push(...page.items.map(view));
    if (!page.next) break;
    cursor = page.next;
  }
  return out.slice(0, limit);
}
export async function byId(ctx, id) { const r = await ctx.api.store.getByKey(COL, String(id).slice(0, 100)); return r ? view(r) : null; }
export async function count(ctx) { return ctx.api.store.count(COL); }
export async function removeRow(ctx, rowId) { return serial(ctx, "journal", () => ctx.api.store.remove(rowId)); }

/**
 * The purge policy: lines older than the retention (default 30 days) go; test and replay lines go after a day; never more than JOURNAL_MAX lines.
 * Reads oldest first and stops at the first line that stays, so a quiet hour costs one read. Returns the number removed.
 */
export function purge(ctx, { retentionDays = 30, now = Date.now() } = {}) {
  return serial(ctx, "journal", async () => {
    let removed = 0, cursor;
    const cut = now - retentionDays * 86_400_000;
    for (let guard = 0; guard < 20; guard++) {
      const page = await ctx.api.store.page(COL, { limit: 200, cursor, order: "asc" });
      for (const r of page.items) {
        const d = r.data, old = (d.receivedAt ?? d.at ?? 0) < cut, temp = d.source === "test" || d.source === "replay";
        if (old || (temp && (d.receivedAt ?? 0) < now - TEST_KEEP_MS)) { await ctx.api.store.remove(r.id); removed++; }
      }
      if (!page.next) break;
      cursor = page.next;
      // the lines are ordered by creation: after a page without any old line, the rest is newer except tests (cleaned on the next pass)
      if (!page.items.some((r) => (r.data.receivedAt ?? r.data.at ?? 0) < cut)) break;
    }
    let total = await ctx.api.store.count(COL);
    while (total > JOURNAL_MAX) {
      const page = await ctx.api.store.page(COL, { limit: Math.min(200, total - JOURNAL_MAX), order: "asc" });
      if (!page.items.length) break;
      for (const r of page.items) { await ctx.api.store.remove(r.id); removed++; total--; }
    }
    return removed;
  });
}

/* ───────────── In memory ───────────── */
const mem = new Map();
export const memoryOf = (ctx) => { const k = ctx.instance.key; if (!mem.has(k)) mem.set(k, { seen: new Map(), hits: [], bad: [], hype: null, diag: null, replays: [] }); return mem.get(k); };
export const resetMemory = () => mem.clear();
/** Was this message already handled by this process? Marks it. Keeps 30 minutes, 2000 ids (the journal remembers beyond that). */
export function seenBefore(ctx, id, now = Date.now()) {
  const m = memoryOf(ctx);
  if (m.seen.has(id)) return true;
  m.seen.set(id, now);
  if (m.seen.size > 2000) for (const [k, t] of m.seen) { if (now - t > 1_800_000 || m.seen.size > 2000) m.seen.delete(k); else break; }
  return false;
}
/** A sliding window: allows at most `max` calls per `windowMs` for this bucket. */
export function allow(ctx, bucket, { max, windowMs, now = Date.now() }) {
  const m = memoryOf(ctx);
  const list = (m[bucket] = (m[bucket] ?? []).filter((t) => now - t < windowMs));
  if (list.length >= max) return false;
  list.push(now);
  return true;
}
