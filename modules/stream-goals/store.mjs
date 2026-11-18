// Stream goals: what is kept (the state document and the ledger) and how the Twitch events and figures come in. Reading only when someone looks:
// an overlay page (every 1.5 s), the admin page or the assistant. Nothing runs in the background.
//
// Concurrency: two overlay pages open at once (a test page during the live) ask at the same time. The reading of the sources is serialised per instance and
// throttled (one reading per 1.4 s whatever the number of pages); a ledger row is keyed by the Twitch message id, so a second writer finds it and stops.
// Both pages then compute the same state from the same rows and the same server clock: no double count, no double celebration.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const M = await import(new URL(`./model.mjs${v}`, import.meta.url).href);
import { randomBytes } from "node:crypto";

export const LEDGER = "ledger", STATE = "state";
export const EVENTS = "twitch.event", STATS = "social.stat";
export const SERVICES = { events: "alerts.queue", figures: "twitch.live" };
export const TIMING = { syncMs: 1400, statsMs: 60_000, retentionDays: 60 };

const chain = new Map();
export function serial(ctx, name, fn) {
  const k = `${ctx.instance.key}|${name}`;
  const run = (chain.get(k) ?? Promise.resolve()).catch(() => {}).then(fn);
  chain.set(k, run);
  return run;
}
const mem = new Map();
export const memoryOf = (ctx) => { const k = ctx.instance.key; if (!mem.has(k)) mem.set(k, { syncedAt: 0, statsAt: 0, rows: null, seenTests: new Set() }); return mem.get(k); };
export const resetMemory = () => mem.clear();

/* ───────────── The settings, read with their bounds ───────────── */
export function settingsOf(ctx) {
  const s = (k) => ctx.setting(k);
  const metric = M.METRICS.includes(s("goalMetric")) ? s("goalMetric") : "followers";
  const t = Math.round(Number(s("goalTarget")));
  return {
    metric,
    target: Number.isFinite(t) && t > 0 ? Math.min(1_000_000_000, t) : null,
    goalLabel: String(s("goalLabel") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 60),
    subathonLabel: String(s("subathonLabel") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 60),
    start: M.siteTime(s("subathonStart"), ctx.timezone ?? "UTC"),
    rules: M.rulesOf({ subathonLength: s("subathonLength"), subathonCap: s("subathonCap"), secondsPerSub: s("secondsPerSub"), secondsPerHundredBits: s("secondsPerHundredBits"), secondsPerFollow: s("secondsPerFollow") }),
  };
}

/* ───────────── State document ───────────── */
const rec = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
const stateRow = async (ctx) => (await ctx.api.store.list(STATE, { limit: 1 }))[0] ?? null;
export async function readState(ctx) { return rec((await stateRow(ctx))?.data); }
export function updateState(ctx, fn) {
  return serial(ctx, "state", async () => {
    const r = await stateRow(ctx);
    const data = rec(r?.data);
    await fn(data);
    if (r) await ctx.api.store.update(r.id, data); else await ctx.api.store.add(STATE, data);
    return data;
  });
}
/** The secret of the element addresses (an overlay page can be opened by anyone who has its address; the numbers it reads need this secret too). */
export async function secretOf(ctx) {
  const s = await readState(ctx);
  if (typeof s.secret === "string" && s.secret.length >= 16) return s.secret;
  let out = "";
  await updateState(ctx, (d) => { if (!(typeof d.secret === "string" && d.secret.length >= 16)) d.secret = randomBytes(18).toString("base64url"); out = d.secret; });
  return out;
}

/* ───────────── Ledger ───────────── */
const rowOf = (r) => ({ ...r.data, rowId: r.id });
/** Every row (kept in memory after the first reading: the module is the only writer). */
export async function rows(ctx) {
  const m = memoryOf(ctx);
  if (m.rows) return m.rows;
  const out = [];
  let cursor;
  for (let guard = 0; guard < 40; guard++) {
    const page = await ctx.api.store.page(LEDGER, { limit: 1000, cursor, order: "asc" });
    out.push(...page.items.map(rowOf));
    if (!page.next) break;
    cursor = page.next;
  }
  m.rows = out;
  return out;
}
/** Adds a row once (key = its id). Returns true when added. */
async function addRow(ctx, row) {
  const all = await rows(ctx);
  if (all.some((r) => r.id === row.id)) return false;
  if (await ctx.api.store.getByKey(LEDGER, row.id)) { memoryOf(ctx).rows = null; return false; }
  const r = await ctx.api.store.add(LEDGER, row, { key: row.id });
  all.push({ ...row, rowId: typeof r === "string" ? r : r?.id });
  return true;
}
/** Old rows go (60 days, then the size cap). Called by the hourly task. */
export function purge(ctx, now = Date.now()) {
  return serial(ctx, "ledger", async () => {
    const all = await rows(ctx);
    const cut = now - TIMING.retentionDays * 86_400_000;
    const drop = all.filter((r) => (r.seenAt ?? r.at) < cut);
    const over = Math.max(0, all.length - drop.length - M.LIMITS.ledger);
    const extra = all.filter((r) => !drop.includes(r)).slice(0, over);
    for (const r of [...drop, ...extra]) if (r.rowId) await ctx.api.store.remove(r.rowId);
    memoryOf(ctx).rows = null;
    return drop.length + extra.length;
  });
}

/* ───────────── The sources ───────────── */
/** Is a module that gives this present (`events`: the Twitch events, `figures`: the channel's figures)? Never throws. */
export async function hasSource(ctx, which) {
  try { const p = await ctx.api.services.providers(SERVICES[which]); return Array.isArray(p) && p.length > 0; } catch { return false; }
}
/** The channel's figure for a metric from `social.stat` (My Twitch channel): { value, asOf } or null. */
export function pickStat(items, metric) {
  const want = metric === "subs" ? "paying" : metric === "followers" ? "followers" : null;
  if (!want) return null;
  const ok = (Array.isArray(items) ? items : []).filter((s) => s?.platform === "twitch" && s.metric === want && Number.isFinite(s.value) && !s.error && Number.isFinite(Date.parse(s.asOf ?? "")));
  if (!ok.length) return null;
  const s = ok[0];
  return { value: Math.round(s.value), asOf: Date.parse(s.asOf) };
}

/**
 * A new reference value for a metric. Older than the one kept: ignored. Otherwise kept, and when the displayed value changes, a glide (`rebase`) from the
 * old displayed value, without a celebration. Pure on `state` (edited in place); returns true when something changed.
 */
export function applyBase(state, metric, base, ledger, now) {
  state.bases ??= {};
  const old = state.bases[metric];
  if (old && !(base.asOf > old.asOf)) return false;
  const before = old ? M.goalValue(old, ledger, metric) : null;
  state.bases[metric] = { value: base.value, asOf: base.asOf, source: base.source ?? "twitch" };
  const after = M.goalValue(state.bases[metric], ledger, metric);
  state.rebases ??= {};
  if (before !== null && before !== after) state.rebases[metric] = { from: before, at: now };
  return true;
}

/** The target and the start of the bar for a metric: the setting, else an automatic round number kept until it is reached for an hour. Edits `state`. */
export function spanOf(state, { metric, target }, value, now) {
  state.spans ??= {};
  const sig = `${metric}:${target ?? "auto"}`;
  let sp = state.spans[metric];
  if (!sp || sp.sig !== sig) sp = state.spans[metric] = { sig, min: Math.min(value, target ?? value), target: target ?? M.nextRound(value), at: now };
  if (target === null) {
    if (value >= sp.target) { sp.reachedAt ??= now; if (now - sp.reachedAt > 3_600_000) sp = state.spans[metric] = { sig, min: value, target: M.nextRound(value), at: now }; }
    else delete sp.reachedAt;
  }
  if (value < sp.min) sp.min = value;
  return { min: sp.min, target: sp.target };
}

/** A rehearsal (a test line of the Twitch events, or the Test buttons): what it shows on each gauge of this instance. */
export function testsFor(ev, s, now) {
  const out = [];
  const goal = s.metric === "followers" ? (ev.kind === "follow" ? 1 : 0) : s.metric === "subs" ? (ev.kind === "sub" || ev.kind === "resub" ? 1 : ev.kind === "gift" ? ev.count ?? 1 : 0) : ev.kind === "manual" ? 1 : 0;
  if (goal) out.push({ id: `t-${ev.eid}-g`, at: now + M.SHOW_DELAY_MS, for: "goal", amount: goal });
  const secs = M.subathonSeconds({ ...ev, gifted: false }, s.rules);
  if (secs > 0) out.push({ id: `t-${ev.eid}-s`, at: now + M.SHOW_DELAY_MS, for: "subathon", amount: secs });
  return out;
}
export function keepTests(state, add, now) {
  state.tests = [...(Array.isArray(state.tests) ? state.tests : []).filter((x) => now - x.at < 60_000), ...add].slice(-M.LIMITS.tests);
}

/**
 * Reads the sources once (throttled, serialised): the Twitch events into the ledger, the channel's figure every minute. Returns nothing; never throws.
 * `force`: read now (admin page, assistant).
 */
export async function sync(ctx, { now = Date.now(), force = false } = {}) {
  const m = memoryOf(ctx);
  // a second page asking within the throttle waits for the reading in progress, so it shows the same state
  if (!force && now - m.syncedAt < TIMING.syncMs) { await m.running?.catch(() => {}); return; }
  m.syncedAt = now;
  m.running = serial(ctx, "ledger", async () => {
    const s = settingsOf(ctx);
    let items = [];
    try { items = await ctx.api.topics.collect(EVENTS, { limit: 100 }); } catch { items = []; }
    const evs = (Array.isArray(items) ? items : []).map(M.eventOf).filter(Boolean).sort((a, b) => a.at - b.at || a.eid.localeCompare(b.eid));
    let stat = null;
    if (s.metric !== "manual" && (force || now - m.statsAt >= TIMING.statsMs)) {
      m.statsAt = now;
      try { stat = M.METRICS.includes(s.metric) ? pickStat(await ctx.api.topics.collect(STATS, { limit: 200 }), s.metric) : null; } catch { stat = null; }
    }
    const tests = [];
    const fresh = [];
    const ledger = await rows(ctx);
    for (const ev of evs) {
      if (ev.test || ev.replay) {
        if (m.seenTests.has(ev.eid) || now - ev.at > M.FRESH_MS) continue;
        m.seenTests.add(ev.eid);
        if (m.seenTests.size > 300) m.seenTests.delete(m.seenTests.values().next().value);
        tests.push(...testsFor(ev, s, now));
        continue;
      }
      if (M.isDuplicate(ev, ledger) || M.isDuplicate(ev, fresh.map((x) => ({ eid: x.eid, fp: M.fingerprint(x), at: x.at })))) continue;
      fresh.push(ev);
    }
    if (!fresh.length && !stat && !tests.length) return;
    await updateState(ctx, async (d) => {
      if (stat) applyBase(d, s.metric, { ...stat, source: "twitch" }, ledger, now);
      for (const ev of fresh) {
        const row = { id: `e:${ev.eid}`, eid: ev.eid, fp: M.fingerprint(ev), kind: ev.kind, at: ev.at, seenAt: now, login: ev.login || undefined, tier: ev.tier, ...(ev.gifted ? { gifted: true } : {}), ...(ev.count ? { count: ev.count } : {}), ...(ev.bits ? { bits: ev.bits } : {}) };
        // an event seen long after it happened (a catch-up, the first reading after the install) counts, silently: no reaction for the past
        if (now - ev.at < M.FRESH_MS) row.showAt = now + M.SHOW_DELAY_MS;
        const base = d.bases?.[s.metric];
        const counts = M.goalUnits(row, s.metric) !== 0 && (!base || row.at > base.asOf);
        if (counts && row.showAt) {
          const before = M.goalValue(base ?? { value: 0, asOf: 0 }, ledger, s.metric);
          const span = spanOf(d, s, before, now);
          const cross = M.crossing(before, before + M.goalUnits(row, s.metric), span);
          if (cross) row.cross = cross;
        }
        await addRow(ctx, row);   // `ledger` is the same list: the row is in it once added
      }
      if (tests.length) keepTests(d, tests, now);
    });
  }).catch((e) => console.error(`[stream-goals] ${ctx.instance.key}: reading failed (${e?.message ?? e})`));
  await m.running;
}

/* ───────────── What the elements, the admin page and the assistant see ───────────── */
/** The goal now: { metric, value, min, target, base, source, rows, state }. */
export async function goalNow(ctx, now = Date.now()) {
  const s = settingsOf(ctx), st = await readState(ctx), ledger = await rows(ctx);
  const base = st.bases?.[s.metric] ?? null;
  const value = s.metric === "manual" ? (base?.value ?? 0) : M.goalValue(base ?? { value: 0, asOf: 0 }, ledger, s.metric);
  const sp = st.spans?.[s.metric];
  const span = sp && sp.sig === `${s.metric}:${s.target ?? "auto"}` ? { min: sp.min, target: sp.target } : { min: Math.min(value, s.target ?? value), target: s.target ?? M.nextRound(value) };
  return { settings: s, metric: s.metric, value, ...span, base, rebase: st.rebases?.[s.metric] ?? null, tests: st.tests ?? [], ledger, state: st, now };
}
export async function goalState(ctx, now = Date.now()) {
  const g = await goalNow(ctx, now);
  return M.goalView({ value: g.value, min: g.min, target: g.target, rows: g.ledger, rebase: g.rebase, tests: g.tests, label: g.settings.goalLabel || ctx.t(`label_${g.metric}`), now, metric: g.metric });
}
/** The subathon now: { fold, rules, startAt, pauses }. */
export async function subathonNow(ctx, now = Date.now()) {
  const s = settingsOf(ctx), st = await readState(ctx), ledger = await rows(ctx);
  const startAt = Number.isFinite(s.start) ? s.start : null;
  const pauses = Array.isArray(st.pauses) ? st.pauses : [];
  const subRows = ledger.filter((r) => r.kind !== "sub_end" && (r.kind !== "follow" || s.rules.perFollowS > 0));
  const fold = M.subathonFold({ startAt, rules: s.rules, rows: subRows, pauses, now });
  return { settings: s, rules: s.rules, startAt, pauses, fold, tests: st.tests ?? [], now };
}
export async function subathonState(ctx, now = Date.now()) {
  const x = await subathonNow(ctx, now);
  return M.subathonView({ fold: x.fold, rules: x.rules, tests: x.tests, label: x.settings.subathonLabel || ctx.t("label_subathon"), now });
}

/* ───────────── Changes asked by the owner (admin page, assistant) ───────────── */
/** Sets the value by hand (the reference value of the current metric, dated now). */
export async function setValue(ctx, value, now = Date.now()) {
  const s = settingsOf(ctx);
  const ledger = await rows(ctx);
  await updateState(ctx, (d) => { d.bases ??= {}; const old = d.bases[s.metric]; const before = old ? M.goalValue(old, ledger, s.metric) : null; d.bases[s.metric] = { value, asOf: now, source: "manual" }; if (before !== null && before !== value) { d.rebases ??= {}; d.rebases[s.metric] = { from: before, at: now }; } });
  return goalNow(ctx, now);
}
/** Adds (or, negative, removes) time to the subathon by hand: a ledger row, so it is shown and counted like an event. */
export async function addTime(ctx, seconds, now = Date.now()) {
  const id = `m:${now.toString(36)}-${randomBytes(3).toString("hex")}`;
  await serial(ctx, "ledger", () => addRow(ctx, { id, eid: id, kind: "manual", at: now, seenAt: now, showAt: now + M.SHOW_DELAY_MS, seconds }));
  return subathonNow(ctx, now);
}
/** Pauses or resumes the subathon. */
export async function setPaused(ctx, paused, now = Date.now()) {
  await updateState(ctx, (d) => {
    const ps = (d.pauses = Array.isArray(d.pauses) ? d.pauses : []);
    const open = ps.find((p) => p.to === null || p.to === undefined);
    if (paused && !open) ps.push({ from: now, to: null });
    if (!paused && open) open.to = now;
    if (ps.length > M.LIMITS.pauses) ps.splice(0, ps.length - M.LIMITS.pauses);
  });
  return subathonNow(ctx, now);
}
/** A rehearsal from the Test buttons: `which` = "goal" | "subathon". Nothing is counted. */
export async function rehearse(ctx, which, now = Date.now()) {
  const s = settingsOf(ctx);
  const id = `t-${now.toString(36)}-${randomBytes(3).toString("hex")}`;
  const amount = which === "subathon" ? Math.max(60, s.rules.perSubS) : 1;
  await updateState(ctx, (d) => keepTests(d, [{ id, at: now + M.SHOW_DELAY_MS, for: which, amount }], now));
  return { id, amount };
}
