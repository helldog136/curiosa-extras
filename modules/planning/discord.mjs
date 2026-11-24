// Planning: "Post the week's planning to Discord". One message in the chosen channel, written once and then edited in place (never a second post
// for the same week), through the service `discord.api` of the Discord connector (an OPTIONAL need: without it, or with the option off, nothing happens
// and the schedule works as before). The module never talks to Discord itself and never sees a bot code.
//   - Pull, no event: the core sends no event when a calendar changes. A task (every minute) reads the week, compares a digest with the last one posted,
//     and does nothing (no network call) while they are equal. A change is confirmed after a short pause (`settleMs`) so that a burst of edits in the
//     calendar gives one edit of the message, not five. The week is Monday to Sunday in the display zone: the digest holds its first day, so the message
//     is rewritten at the week rollover with no other trigger.
//   - Notification: the message is posted silent unless the owner chose "notify". An edit never notifies anybody. No mention is ever possible (the
//     connector neutralises every ping and sends an empty `allowed_mentions`).
//   - Optional second message (setting `discordEvents`): a short line for a stream added, moved or cancelled since the last pass, as a separate message.
//     Nothing is said at the first pass or when the option is turned on: the first snapshot is taken silently.
//   - The module keeps one small document (`discordSync`): the last digest, a snapshot of the week, and the last result for the admin page.
const V = new URL(import.meta.url).search;
const { zonedTimeToUtc, wallDateNow, weekdayOf, addDaysToWall } = await import(`./dates.mjs${V}`);

/** Monday to Sunday of the week that holds `now`, in the zone `tz` (same rule as the week grid of the schedule). */
export function getWeekRangeOf(tz, now = new Date()) {
  const today = wallDateNow(tz, now);
  const wd = weekdayOf(today.y, today.m, today.d);
  const monday = addDaysToWall(today.y, today.m, today.d, wd === 0 ? -6 : 1 - wd);
  const sunday = addDaysToWall(monday.y, monday.m, monday.d, 6);
  return { start: zonedTimeToUtc(monday.y, monday.m, monday.d, 0, 0, 0, tz), end: zonedTimeToUtc(sunday.y, sunday.m, sunday.d, 23, 59, 59, tz) };
}

export const SERVICE = "discord.api";
export const OWNER = "planning";
export const COLLECTION = "discordSync";
export const timing = { settleMs: 6000, callMs: 15_000 };
export const LIMITS = { slots: 60, lines: 5, description: 3800, title: 80 };

const SNOWFLAKE = /^\d{15,25}$/;
const truthy = (v) => v === true || v === "true" || v === 1 || v === "1" || v === "on";
const setting = (ctx, k) => { try { return ctx.setting?.(k); } catch { return undefined; } };

export const discordOn = (ctx) => truthy(setting(ctx, "discordPost"));
export const eventsOn = (ctx) => truthy(setting(ctx, "discordEvents"));
/** Silent unless the owner chose "notify" (the safe default also covers an unknown value). */
export const notifies = (ctx) => setting(ctx, "discordNotify") === "notify";
export const channelOf = (ctx) => { const v = String(setting(ctx, "discordChannel") ?? "").trim(); return SNOWFLAKE.test(v) ? v : ""; };

/** Markdown from a calendar is data: neither bold, links nor a mention can come out of a title. */
const esc = (s) => String(s ?? "").replace(/\s+/g, " ").trim().replace(/([\\`*_~|>[\]()#])/g, "\\$1");
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const epoch = (d) => Math.floor(d.getTime() / 1000);

/**
 * The slots that start in the week, as plain rows, sorted. A whole-day stream has no hour. `key` tells a stream from another between two passes (the
 * calendar's own number when it gives one, else the title, with a rank when two streams share a title).
 */
export function weekRows(slots, week) {
  const seen = new Map();
  return (Array.isArray(slots) ? slots : [])
    .filter((s) => s && s.start instanceof Date && s.start.getTime() >= week.start.getTime() && s.start.getTime() <= week.end.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, LIMITS.slots)
    .map((s) => {
      const base = s.uid || `t:${s.title}`;
      const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
      return { key: n > 1 ? `${base}#${n}` : base, title: String(s.title ?? ""), games: Array.isArray(s.games) ? s.games.slice(0, 3) : [], start: s.start, allDay: s.allDay === true, cancelled: s.cancelled === true };
    });
}

const fmtDay = (d, locale, tz) => new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(d);
const dayKey = (d, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);

/** The embed of the week: a title with the dates, then one heading per day with a stream. Hours are Discord timestamps: each member reads them in their own time zone. */
export function weekEmbed(rows, week, { t, locale, tz }) {
  const range = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: tz });
  const title = clip(t("discordWeekTitle", { from: range.format(week.start), to: range.format(week.end) }), LIMITS.title);
  if (!rows.length) return { title, description: t("discordNone") };
  const lines = []; let day = "";
  for (const r of rows) {
    const k = dayKey(r.start, tz);
    if (k !== day) { day = k; if (lines.length) lines.push(""); lines.push(`**${esc(fmtDay(r.start, locale, tz))}**`); }
    const name = `**${esc(r.title) || "?"}**`;
    const games = r.games.length ? ` · ${r.games.map(esc).join(", ")}` : "";
    const when = r.allDay ? "" : `<t:${epoch(r.start)}:t> `;
    lines.push(r.cancelled ? `• ${when}~~${name}~~ (${t("discordCancelled")})` : `• ${when}${name}${games}`);
  }
  return { title, description: clip(lines.join("\n"), LIMITS.description) };
}

/** A short text that changes whenever what members would read changes (and only then). */
export function digestOf(rows, week, tz) {
  const s = JSON.stringify([dayKey(week.start, tz), rows.map((r) => [r.key, r.title, r.games, r.start.getTime(), r.allDay, r.cancelled])]);
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}.${s.length}`;
}

/** What changed between the snapshot of the last pass and now: new, moved (same stream, other start) and cancelled streams. Cancelled before = not repeated. */
export function changesOf(prev, rows) {
  const before = new Map((Array.isArray(prev) ? prev : []).map((p) => [p.k, p]));
  const out = [];
  for (const r of rows) {
    const p = before.get(r.key);
    if (r.cancelled) { if (!p || !p.c) out.push({ kind: "cancelled", row: r }); continue; }
    if (!p || p.c) out.push({ kind: "added", row: r });
    else if (p.s !== r.start.getTime()) out.push({ kind: "moved", row: r });
  }
  const now = new Set(rows.map((r) => r.key));
  for (const p of before.values()) if (!now.has(p.k) && !p.c) out.push({ kind: "cancelled", row: { key: p.k, title: p.t, games: [], start: new Date(p.s), allDay: p.a === true, cancelled: true } });
  return out;
}
const snapshotOf = (rows) => rows.map((r) => ({ k: r.key, t: clip(r.title, 100), s: r.start.getTime(), c: r.cancelled, a: r.allDay }));

/** The short message: one line per change, 5 at most. */
export function eventsText(changes, { t }) {
  const line = (c) => {
    const when = c.row.allDay ? "" : ` · <t:${epoch(c.row.start)}:f>`;
    return `• ${t(c.kind === "added" ? "discordAdded" : c.kind === "moved" ? "discordMoved" : "discordCancelledLine")} — **${esc(c.row.title) || "?"}**${c.kind === "cancelled" ? "" : when}`;
  };
  const shown = changes.slice(0, LIMITS.lines).map(line);
  if (changes.length > LIMITS.lines) shown.push(t("discordMore", { n: changes.length - LIMITS.lines }));
  return shown.join("\n");
}

/* ───────────── The document the module keeps ───────────── */
const doc = async (ctx) => { try { return (await ctx.api.store.getByKey(COLLECTION, "state")) ?? null; } catch { return null; } };
async function save(ctx, d, data) {
  try { if (d) await ctx.api.store.update(d.id, data, { key: "state" }); else await ctx.api.store.add(COLLECTION, data, { key: "state" }); } catch { /* the next pass writes it again */ }
}
/** The last result, for the admin page: { at, ok, reason? } or null. */
export async function lastResult(ctx) { return (await doc(ctx))?.data?.last ?? null; }

/* ───────────── The pass ───────────── */
const within = (p, ms) => { let t; return Promise.race([Promise.resolve(p), new Promise((r) => { t = setTimeout(() => r({ ok: false, reason: "timeout" }), ms); t.unref?.(); })]).finally(() => clearTimeout(t)); };
/** One call of the connector; the answer of the provider ({ ok, ... }), or { ok: false, reason } when there is none. Never throws. */
async function call(ctx, method, args) {
  try {
    const r = await within(ctx.api.services.call(SERVICE, method, args), timing.callMs);
    if (r && r.ok === true && r.value && typeof r.value === "object") return r.value;
    return { ok: false, reason: r?.reason === "unavailable" || r?.reason === "undeclared" ? "no_connector" : "failed" };
  } catch { return { ok: false, reason: "failed" }; }
}

/**
 * One pass of the task. `read(from, to)` gives { items, failed } (the calendars), `toSlots(items, tz)` and `displayZone(setting, items)` are those of the schedule.
 * Returns what happened ("off", "no_channel", "no_read", "same", "settling", "posted", "failed") for the tests and the task history. Never throws.
 */
export async function syncDiscord(ctx, deps, now = Date.now()) {
  try {
    if (!discordOn(ctx)) return "off";
    const channelId = channelOf(ctx);
    if (!channelId) return "no_channel";
    const world = async () => {
      const probe = await deps.read(new Date(now - 86_400_000), new Date(now + 16 * 86_400_000));
      if (probe.failed) return null;
      const tz = deps.displayZone(setting(ctx, "timezone"), probe.items);
      const week = getWeekRangeOf(tz, new Date(now));
      const rows = weekRows(deps.toSlots(probe.items, tz), week);
      return { tz, week, rows, digest: digestOf(rows, week, tz) };
    };
    const first = await world();
    if (!first) return "no_read";   // the calendars do not answer: the message stays as it is
    const d = await doc(ctx);
    const state = d?.data ?? {};
    if (state.digest === first.digest) return "same";
    await (deps.sleep ?? ((ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); })))(timing.settleMs);   // a burst of edits: wait, then read again
    const w = await world();
    if (!w) return "no_read";
    if (w.digest !== first.digest) return "settling";   // still moving: the next pass reads it again
    const text = { t: ctx.t, locale: ctx.defaultLocale ?? ctx.locale ?? "en", tz: w.tz };
    const silent = !notifies(ctx);
    const r = await call(ctx, "upsertManagedMessage", { owner: OWNER, key: `week-${ctx.instance?.key ?? "main"}`, label: "Weekly planning", channelId, embeds: [weekEmbed(w.rows, w.week, text)], silent });
    const next = { ...state, last: { at: new Date(now).toISOString(), ok: r.ok === true, ...(r.ok === true ? {} : { reason: String(r.reason ?? "failed") }) } };
    if (r.ok !== true) { await save(ctx, d, next); return "failed"; }
    next.digest = w.digest;
    if (eventsOn(ctx) && Array.isArray(state.snapshot)) {
      const changes = changesOf(state.snapshot, w.rows);
      if (changes.length) {
        const e = await call(ctx, "postMessage", { channelId, content: eventsText(changes, text), silent });
        if (e.ok !== true) { next.snapshot = state.snapshot; await save(ctx, d, { ...next, digest: state.digest ?? "" }); return "failed"; }   // the edit is done; the line is retried next pass
      }
    }
    next.snapshot = snapshotOf(w.rows);
    await save(ctx, d, next);
    return "posted";
  } catch { return "failed"; }
}
