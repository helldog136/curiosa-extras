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

/** The seven days that hold `now`, in the zone `tz`, from the first day of the week (`weekStart`: 1 Monday, 0 Sunday, 6 Saturday; the same setting as the week grid). */
export function getWeekRangeOf(tz, now = new Date(), weekStart = 1) {
  const first = [0, 1, 6].includes(Number(weekStart)) ? Number(weekStart) : 1;
  const today = wallDateNow(tz, now);
  const wd = weekdayOf(today.y, today.m, today.d);
  const first0 = addDaysToWall(today.y, today.m, today.d, -((wd - first + 7) % 7));
  const last = addDaysToWall(first0.y, first0.m, first0.d, 6);
  return { start: zonedTimeToUtc(first0.y, first0.m, first0.d, 0, 0, 0, tz), end: zonedTimeToUtc(last.y, last.m, last.d, 23, 59, 59, tz) };
}

export const SERVICE = "discord.api";
export const OWNER = "planning";
export const COLLECTION = "discordSync";
export const timing = { settleMs: 6000, callMs: 15_000 };
export const LIMITS = { slots: 60, lines: 5, description: 3800, title: 80, game: 40, content: 1900, verifyMs: 3_600_000, backoffMs: [60_000, 300_000, 900_000, 3_600_000] };

const SNOWFLAKE = /^\d{15,25}$/;
const truthy = (v) => v === true || v === "true" || v === 1 || v === "1" || v === "on";
const setting = (ctx, k) => { try { return ctx.setting?.(k); } catch { return undefined; } };

export const discordOn = (ctx) => truthy(setting(ctx, "discordPost"));
export const eventsOn = (ctx) => truthy(setting(ctx, "discordEvents"));
/** Silent unless the owner chose "notify" (the safe default also covers an unknown value). */
export const notifies = (ctx) => setting(ctx, "discordNotify") === "notify";
export const channelOf = (ctx) => { const v = String(setting(ctx, "discordChannel") ?? "").trim(); return SNOWFLAKE.test(v) ? v : ""; };

/** Markdown from a calendar is data: neither bold, links nor a mention can come out of a title. */
// `<` is followed by an invisible space so that nothing can become a timestamp (<t:), a channel (<#), a command (</), an emoji (<:, <a:) or a mention (<@).
const esc = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f\u061c\u200e\u200f\u202A-\u202E\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim().replace(/([\\`*_~|>[\]()#])/g, "\\$1").replace(/</g, "<\u200b").replace(/@/g, "@\u200b");
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Whole lines only, so a limit never cuts a timestamp or a bold mark in two; the last line says how many were left out. */
const fit = (lines, max, more) => {
  const size = (l) => l.reduce((n, x) => n + x.length + 1, 0);
  if (size(lines) <= max) return lines;
  if (!more) { const out = []; for (const l of lines) { if (size([...out, l]) > max) break; out.push(l); } return out; }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const tail = more(lines.length - i);
    if (size([...out, lines[i], tail]) > max) { out.push(tail); return out; }
    out.push(lines[i]);
  }
  return out;
};
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
      return { key: n > 1 ? `${base}#${n}` : base, title: clip(String(s.title ?? ""), LIMITS.title), games: Array.isArray(s.games) ? s.games.slice(0, 3).map((g) => clip(String(g ?? ""), LIMITS.game)) : [], start: s.start, allDay: s.allDay === true, cancelled: s.cancelled === true };
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
  return { title, description: fit(lines, LIMITS.description, (n) => t("discordMore", { n })).join("\n") };
}

/** A short text that changes whenever what members would read changes (and only then). */
export function digestOf(rows, week, tz, where = {}) {
  const s = JSON.stringify([where.channelId ?? "", where.key ?? "", dayKey(week.start, tz), rows.map((r) => [r.key, r.title, r.games, r.start.getTime(), r.allDay, r.cancelled])]);
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}.${s.length}`;
}

/**
 * What changed between the snapshot of the last pass and now: new, moved (same stream, other start) and cancelled streams.
 * Only streams of THIS week and of the part of it the calendars were read for: a stream that leaves the window, a week that rolls over or a stream that has
 * already started is never announced as cancelled. `scope` = { week, from, to, now }; a snapshot of another week gives nothing (the new week starts silently).
 */
export function changesOf(prev, rows, scope) {
  const list = Array.isArray(prev) ? prev : [];
  const inScope = (ms) => !scope || (ms >= scope.week.start.getTime() && ms <= scope.week.end.getTime() && ms >= scope.from && ms <= scope.to);
  const before = new Map(list.filter((p) => inScope(p.s)).map((p) => [p.k, p]));
  const out = [];
  for (const r of rows) {
    const p = before.get(r.key);
    if (scope && r.start.getTime() <= scope.now) continue;   // already started: not news
    if (r.cancelled) { if (p && !p.c) out.push({ kind: "cancelled", row: r }); continue; }
    if (!p) { out.push({ kind: "added", row: r }); continue; }
    if (p.c) out.push({ kind: "added", row: r });
    else if (p.s !== r.start.getTime()) out.push({ kind: "moved", row: r });
  }
  const now = new Set(rows.map((r) => r.key));
  for (const p of before.values()) if (!now.has(p.k) && !p.c && (!scope || p.s > scope.now)) out.push({ kind: "cancelled", row: { key: p.k, title: p.t, games: [], start: new Date(p.s), allDay: p.a === true, cancelled: true } });
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
  return fit(shown, LIMITS.content).join("\n");
}

/* ───────────── The document the module keeps ───────────── */
/** The one document `state`. A second one (two passes that raced before this guard existed) is removed, the newest kept. */
const doc = async (ctx) => {
  try {
    if (typeof ctx.api.store.listByKey === "function") {
      const rows = (await ctx.api.store.listByKey(COLLECTION, "state", { limit: 20 }))?.items ?? [];   // newest first
      for (const extra of rows.slice(1)) { try { await ctx.api.store.remove(extra.id); } catch { /* next pass */ } }
      if (rows.length) return rows[0];
    }
    return (await ctx.api.store.getByKey(COLLECTION, "state")) ?? null;
  } catch { return null; }
};
async function save(ctx, d, data) {
  try { const again = d ?? (await ctx.api.store.getByKey(COLLECTION, "state").catch(() => null)); if (again) await ctx.api.store.update(again.id, data, { key: "state" }); else await ctx.api.store.add(COLLECTION, data, { key: "state" }); } catch { /* the next pass writes it again */ }
}
/**
 * The last result for the admin page: { at, ok, reason?, retryAt? }, or null when it is about another channel than the one chosen now (so the page never says
 * "posted" about a channel that has not been written yet).
 */
export async function lastResult(ctx) {
  const last = (await doc(ctx))?.data?.last ?? null;
  if (!last) return null;
  return last.channelId && last.channelId !== channelOf(ctx) ? null : last;
}

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

const running = new Set();   // one pass at a time per instance, whatever calls it (the core already guards its own scheduler)
const keyOf = (ctx) => `week-${ctx.instance?.key ?? "main"}`;

/**
 * One pass of the task. `deps`: `read(from, to)` gives { items, failed } (the calendars), `toSlots(items, tz)` and `displayZone(setting, items)` are those of
 * the schedule, `weekStart(ctx)` (1, 0 or 6) and `showCancelled(ctx)` are the page's own settings.
 * Returns what happened ("off", "no_channel", "no_read", "same", "settling", "posted", "failed", "backoff", "busy") for the tests and the task history. Never throws.
 */
export async function syncDiscord(ctx, deps, now = Date.now()) {
  const guard = `${ctx.moduleId ?? "planning"}:${ctx.instance?.id ?? ctx.instance?.key ?? "main"}`;
  if (running.has(guard)) return "busy";
  running.add(guard);
  try { return await pass(ctx, deps, now); } catch { return "failed"; } finally { running.delete(guard); }
}

async function pass(ctx, deps, now) {
  const d0 = await doc(ctx);
  if (!discordOn(ctx)) {
    // Switched off: forget what was posted, so that switching it on again writes (and checks) the message instead of trusting an old digest.
    if (d0?.data?.digest || d0?.data?.snapshot) await save(ctx, d0, { last: d0.data.last, off: true });
    return "off";
  }
  const channelId = channelOf(ctx);
  if (!channelId) return "no_channel";
  const key = keyOf(ctx);
  const day = 86_400_000;
  const weekStart = typeof deps.weekStart === "function" ? deps.weekStart(ctx) : 1;
  const showCancelled = typeof deps.showCancelled === "function" ? deps.showCancelled(ctx) === true : false;
  const world = async () => {
    // The whole week is read, from its first day (never "since 24 hours": on a Thursday Monday to Wednesday still belong to the message), with a day on each side for the zone.
    const from = new Date(now - 8 * day), to = new Date(now + 16 * day);
    const probe = await deps.read(from, to);
    if (probe.failed) return null;
    const tz = deps.displayZone(setting(ctx, "timezone"), probe.items);
    const week = getWeekRangeOf(tz, new Date(now), weekStart);
    const all = weekRows(deps.toSlots(probe.items, tz), week);
    const rows = showCancelled ? all : all.filter((r) => !r.cancelled);
    return { tz, week, all, rows, from: from.getTime(), to: to.getTime(), digest: digestOf(rows, week, tz, { channelId, key }), weekKey: dayKey(week.start, tz) };
  };
  const first = await world();
  if (!first) return "no_read";   // the calendars do not answer: the message stays as it is
  const state = d0?.data ?? {};
  // After a failure: wait (1, 5, 15, then 60 minutes) instead of writing and failing again every minute. Another channel or a changed week cancels the wait.
  if (state.retryAt && now < state.retryAt && state.retryDigest === first.digest) return "backoff";
  const verifyDue = !state.verifiedAt || now - state.verifiedAt >= LIMITS.verifyMs || state.verifiedAt > now;
  if (state.digest === first.digest && !verifyDue) return "same";
  if (state.digest !== first.digest) {
    await (deps.sleep ?? ((ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); })))(timing.settleMs);   // a burst of edits: wait, then read again
    const again = await world();
    if (!again) return "no_read";
    if (again.digest !== first.digest) return "settling";   // still moving: the next pass reads it again
  }
  const w = first;
  const text = { t: ctx.t, locale: ctx.defaultLocale ?? ctx.locale ?? "en", tz: w.tz };
  const silent = !notifies(ctx);
  const verify = state.digest === w.digest;   // nothing new to say: only check the message is still there (a person may have deleted it)
  const r = await call(ctx, "upsertManagedMessage", { owner: OWNER, key, label: "Weekly planning", channelId, embeds: [weekEmbed(w.rows, w.week, text)], silent, verify });
  const ok = r.ok === true;
  // After a failure: the wait grows 1, 5, 15, 60 minutes; the connector's own end of pause (an ISO date) is honoured when it is later.
  const trouble = (res, fails) => {
    const asked = typeof res.retryAt === "string" ? Date.parse(res.retryAt) : Number(res.retryAt);
    const wait = LIMITS.backoffMs[Math.min(fails - 1, LIMITS.backoffMs.length - 1)];
    const retryAt = Number.isFinite(asked) && asked > now ? Math.max(asked, now + 60_000) : now + wait;
    const reason = res.reason === "forbidden" && res.scope === "channel" ? "forbidden_channel" : String(res.reason ?? "failed");
    return { fails, retryAt, retryDigest: w.digest, last: { at: new Date(now).toISOString(), ok: false, channelId, reason, retryAt } };
  };
  const fails = (Number(state.fails) || 0) + 1;
  const next = ok
    ? { ...state, off: undefined, last: { at: new Date(now).toISOString(), ok: true, channelId }, fails: 0, retryAt: 0, retryDigest: "" }
    : { ...state, off: undefined, ...trouble(r, fails) };
  if (!ok) { await save(ctx, d0, next); return "failed"; }
  next.digest = w.digest; next.verifiedAt = now; next.channelId = channelId;
  const sameWeek = state.week === w.weekKey;
  if (eventsOn(ctx) && Array.isArray(state.snapshot) && sameWeek && !verify) {
    const changes = changesOf(state.snapshot, w.all, { week: w.week, from: w.from, to: w.to, now });
    if (changes.length) {
      const e = await call(ctx, "postMessage", { channelId, content: eventsText(changes, text), silent });
      if (e.ok !== true) {   // the edit is done; the line is retried after the same wait as any failure, and the page says so
        await save(ctx, d0, { ...next, ...trouble(e, fails), snapshot: state.snapshot, week: state.week, digest: state.digest ?? "", verifiedAt: now });
        return "failed";
      }
    }
  }
  if (!verify || !Array.isArray(state.snapshot)) { next.snapshot = snapshotOf(w.all); next.week = w.weekKey; }
  await save(ctx, d0, next);
  return "posted";
}
