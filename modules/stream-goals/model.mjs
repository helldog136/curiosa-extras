// Stream goals: the PURE rules (no ctx, no storage, no clock of its own: `now` is always given). Everything a test needs to check the arithmetic lives here.
//
// THE RULE AGAINST DOUBLE COUNTING (documented in README.md, "How the value is counted"):
//   displayed = last reference value + the events counted since its `asOf`
//   - the reference value is the channel's figure read by My Twitch channel (topic `social.stat`, `asOf` = when Twitch was read), or the value you set by hand;
//   - the events are the lines of the ledger (this module's own copy of the Twitch events it counted), unique by the Twitch message id, then by person:
//     a follow counts once per login (an unfollow and follow again, or the same follow found again by a catch-up, does not count twice), a sub, a renewal or
//     the end of a sub once per login within 10 minutes, a gift or a cheer once per (login, amount) within 10 seconds (two copies of the same event delivered
//     to two listening modules carry two message ids);
//   - an event dated at or before `asOf` is already in the reference value: it is not added again;
//   - a new reference value never plays a celebration: the bar glides to it (`rebase`), up or down;
//   - tests and replays never change a value: they play a short rehearsal that goes back by itself.

export const TIER = { 1: 1, 2: 2, 3: 5 };   // a tier 2 sub buys twice the time of a tier 1, a tier 3 five times (close to their prices)
export const FP_WINDOW = { follow: Infinity, sub: 600_000, resub: 600_000, sub_end: 600_000, gift: 10_000, cheer: 10_000 };
export const SHOW_DELAY_MS = 1600;    // a highlight starts this long after the event reached this module (every page polls every 1.5 s: all show it, together)
export const FRESH_MS = 60_000;       // an event older than this when it is first seen (a catch-up, the first reading after install) counts silently
export const TEST_HOLD_MS = 8000;     // a rehearsal lasts this long, then the value glides back
export const LIMITS = { highlights: 30, ledger: 20_000, tests: 10, label: 60, pauses: 200 };
export const METRICS = ["followers", "subs", "manual"];
const KINDS = ["follow", "sub", "resub", "gift", "cheer", "sub_end"];

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : NaN);
const login = (v) => (typeof v === "string" && /^[a-z0-9_]{1,40}$/i.test(v) ? v.toLowerCase() : "");

/** One item of the topic `twitch.event` → an event of ours, or null (a kind we never count). Tests and replays keep their flag. */
export function eventOf(item) {
  if (!item || typeof item !== "object" || !KINDS.includes(item.type)) return null;
  const at = Date.parse(item.at ?? "");
  const id = String(item.id ?? "").slice(0, 100);
  if (!Number.isFinite(at) || !id) return null;
  const tier = ["1", "2", "3"].includes(String(item.tier)) ? Number(item.tier) : 1;
  const ev = { eid: id, kind: item.type, at, login: login(item.login), tier };
  if (item.gifted === true) ev.gifted = true;
  if (item.type === "gift") ev.count = Math.max(1, Math.min(10_000, Math.round(num(item.count)) || 1));
  if (item.type === "cheer") ev.bits = Math.max(0, Math.min(1_000_000_000, Math.round(num(item.amount)) || 0));
  if (item.test === true) ev.test = true;
  if (item.replay === true) ev.replay = true;
  return ev;
}

/** The "same person" fingerprint of an event (see the rule above). */
export function fingerprint(ev) {
  const who = ev.login || "anonymous";
  if (ev.kind === "gift") return `g:${who}:${ev.count}`;
  if (ev.kind === "cheer") return `c:${who}:${ev.bits}`;
  if (!ev.login) return null;   // a follow or a sub always has a login; without one, only the message id counts
  return `${ev.kind}:${ev.login}`;
}

/** Is this event already in the ledger (same message id, or same person within the window of its kind)? `ledger`: rows { eid, fp, at }. */
export function isDuplicate(ev, ledger) {
  const fp = fingerprint(ev), w = FP_WINDOW[ev.kind] ?? 0;
  for (const r of ledger) {
    if (r.eid === ev.eid) return true;
    if (fp && r.fp === fp && Math.abs(r.at - ev.at) <= w) return true;
  }
  return false;
}

/** How much one ledger row moves the goal of this metric (the follower count, or the number of paid subs). */
export function goalUnits(row, metric) {
  if (metric === "followers") return row.kind === "follow" ? 1 : 0;
  if (metric === "subs") return row.kind === "sub" ? 1 : row.kind === "sub_end" ? -1 : 0;   // a gift's subs arrive one by one as "sub": the gift line is not counted again
  return 0;
}

/** The displayed goal value: the reference value plus the rows dated after its `asOf`. `base`: { value, asOf } (asOf in ms). */
export function goalValue(base, ledger, metric) {
  const b = base && Number.isFinite(base.value) ? base : { value: 0, asOf: 0 };
  let v = b.value;
  for (const r of ledger) if (r.at > (b.asOf ?? 0)) v += goalUnits(r, metric);
  return v;
}

/** The next round number above a value (the automatic target): 63 → 70, 512 → 550, 1234 → 1500, 9 → 10. */
export function nextRound(v) {
  const x = Math.max(0, Math.floor(Number(v) || 0));
  if (x < 10) return 10;
  const digits = String(x).length, s = digits >= 3 ? 10 ** (digits - 1) / 2 : 10 ** (digits - 1);
  return (Math.floor(x / s) + 1) * s;
}

/** Ticks at a quarter, half and three quarters of the way from `min` to `target` (whole numbers, distinct, strictly inside). */
export function milestonesOf(min, target) {
  if (!(target > min)) return [];
  return [...new Set([0.25, 0.5, 0.75].map((f) => Math.round(min + (target - min) * f)))].filter((m) => m > min && m < target);
}

/** What crossing from `before` to `after` celebrates: "complete" (the target), "milestone" (a tick), or null. Never on the way down. */
export function crossing(before, after, { min, target }) {
  if (!(after > before)) return null;
  if (before < target && after >= target) return "complete";
  return milestonesOf(min, target).some((m) => before < m && after >= m) ? "milestone" : null;
}

/* ───────────── Subathon ───────────── */
/**
 * The rules: seconds a tier 1 sub (or renewal, or each gifted sub) adds, seconds per 100 bits, seconds a new follower adds, and the cap (0: none) on the
 * whole length (start length + added time). Read from the settings with their bounds.
 */
export function rulesOf(s) {
  const n = (v, def, min, max) => { const x = Math.round(num(v)); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def; };
  return {
    lengthS: n(s.subathonLength, 4 * 3600, 60, 30 * 86400),
    capS: n(s.subathonCap, 0, 0, 60 * 86400),
    perSubS: n(s.secondsPerSub, 300, 0, 86400),
    perHundredBitsS: n(s.secondsPerHundredBits, 60, 0, 86400),
    perFollowS: n(s.secondsPerFollow, 0, 0, 86400),
  };
}

/** The seconds one ledger row asks to add to the subathon (before the cap): its rule times the tier; a manual row carries its own (may be negative). */
export function subathonSeconds(row, rules) {
  const tier = TIER[row.tier] ?? 1;
  switch (row.kind) {
    case "sub": return row.gifted ? 0 : rules.perSubS * tier;            // gifted subs are counted by their gift line
    case "resub": return rules.perSubS * tier;
    case "gift": return rules.perSubS * tier * (row.count ?? 1);
    case "cheer": return Math.floor(((row.bits ?? 0) / 100) * rules.perHundredBitsS);
    case "follow": return rules.perFollowS;
    case "manual": return Math.round(num(row.seconds)) || 0;
    default: return 0;
  }
}

/** Milliseconds of pause before instant `t` (an open pause counts up to `t`). `pauses`: [{ from, to|null }] in ms. */
export function pausedBefore(pauses, t) {
  let ms = 0;
  for (const p of pauses ?? []) { if (!(p.from < t)) continue; ms += Math.min(t, p.to ?? t) - p.from; }
  return Math.max(0, ms);
}

/**
 * The subathon at `now`, folded from its rows in time order (the same rows give the same result on every page and after a reload):
 *   - nothing before `startAt` counts; the clock runs from `startAt` for `lengthS` plus the time added, and stands still while paused;
 *   - a row counts if the subathon was still running when it happened (time left > 0 at its instant);
 *   - the cap bounds the whole length (start length + added): what goes beyond is noted (`capped`) but not added;
 *   - a negative correction removes time, never below "ends now".
 * Returns { started, startAt, endsAt (with the pauses closed so far), pausedAt|null, addedS, ended, remainingS, capped, applied: [{ id, showAt, seconds, want }] }.
 */
export function subathonFold({ startAt, rules, rows, pauses = [], now }) {
  if (!Number.isFinite(startAt)) return { started: false, startAt: null, addedS: 0, applied: [], ended: false, remainingS: rules.lengthS, capped: 0, pausedAt: null, endsAt: null };
  const ps = (pauses ?? []).filter((p) => Number.isFinite(p.from) && p.from >= startAt).sort((a, b) => a.from - b.from);
  const base = startAt + rules.lengthS * 1000;
  let added = 0, capped = 0;
  const applied = [];
  const sorted = (rows ?? []).filter((r) => r.at >= startAt && r.at <= now).sort((a, b) => a.at - b.at || String(a.id).localeCompare(String(b.id)));
  for (const r of sorted) {
    const leftMs = base + added * 1000 + pausedBefore(ps, r.at) - r.at;
    if (leftMs <= 0) continue;                                   // the subathon was over: nothing more counts
    const want = subathonSeconds(r, rules);
    if (!want) continue;
    let apply = want;
    if (want > 0 && rules.capS > 0) apply = Math.max(0, Math.min(want, rules.capS - rules.lengthS - added));
    if (want < 0) apply = Math.max(want, -Math.floor(leftMs / 1000));
    capped += want - apply > 0 && want > 0 ? want - apply : 0;
    added += apply;
    applied.push({ id: r.id, showAt: r.showAt ?? null, seconds: apply, want });
  }
  const open = ps.find((p) => p.to === null || p.to === undefined);
  const pausedAt = open && now >= startAt ? open.from : null;
  // with a pause open, the end is computed with the pauses CLOSED so far: the engine holds the time left at endsAt - pausedAt
  const endsAt = base + added * 1000 + pausedBefore(ps.filter((p) => p !== open), now);
  const ref = pausedAt ?? now;
  const remainingMs = now < startAt ? rules.lengthS * 1000 : endsAt - ref;
  return { started: now >= startAt, startAt, endsAt, pausedAt, addedS: added, ended: now >= startAt && pausedAt === null && remainingMs <= 0, remainingS: Math.max(0, Math.round(remainingMs / 1000)), capped, applied };
}

/* ───────────── What the engine receives ───────────── */
/**
 * Rehearsals (tests) as highlights: a step (or "+time") with its amount at `at`, then the same amount going back ("drop", never celebrated) TEST_HOLD_MS later.
 * The VALUE is left as it is: the engine counts a highlight's amount out until it arrives, so the two highlights together lift the bar for the rehearsal and
 * bring it back, without a jump, and a page opened afterwards shows the real value.
 */
export function rehearsal(tests, now, which) {
  const hl = [];
  for (const x of tests ?? []) {
    if (x.for !== which || !(now < x.at + TEST_HOLD_MS + 5000)) continue;
    hl.push({ id: `${x.id}`, at: x.at, kind: which === "subathon" ? "extend" : "step", amount: x.amount });
    hl.push({ id: `${x.id}-back`, at: x.at + TEST_HOLD_MS, kind: "drop", amount: -x.amount });
  }
  return hl;
}

/** The gauge state of the goal. */
export function goalView({ value, min, target, rows, rebase, tests, label, now, metric }) {
  const hl = [];
  for (const r of rows) {
    const u = goalUnits(r, metric);
    if (!u || !Number.isFinite(r.showAt) || now - r.showAt > 60_000) continue;
    hl.push({ id: r.eid, at: r.showAt, kind: u < 0 ? "drop" : "step", amount: u });
    if (r.cross) hl.push({ id: `${r.eid}-${r.cross}`, at: r.showAt, kind: r.cross });
  }
  const t = rehearsal(tests, now, "goal");
  return {
    genre: "gauge", format: "count", value, min, target, milestones: milestonesOf(min, target),
    highlights: [...hl, ...t].sort((a, b) => a.at - b.at).slice(-LIMITS.highlights),
    ...(rebase && Number.isFinite(rebase.from) && Number.isFinite(rebase.at) && now - rebase.at < 10_000 ? { rebase: { from: rebase.from, at: rebase.at } } : {}),
    ...(label ? { label: String(label).slice(0, LIMITS.label) } : {}),
  };
}

/** The countdown gauge of the subathon. */
export function subathonView({ fold, rules, tests, label, now }) {
  const t = rehearsal(tests, now, "subathon");
  const hl = [];
  for (const a of fold.applied) {
    if (!Number.isFinite(a.showAt) || now - a.showAt > 60_000) continue;
    if (a.seconds > 0) hl.push({ id: a.id, at: a.showAt, kind: "extend", amount: a.seconds });
    else if (a.seconds < 0) hl.push({ id: a.id, at: a.showAt, kind: "drop", amount: a.seconds });
    else hl.push({ id: a.id, at: a.showAt, kind: "step" });   // over the cap: a reaction, no time
  }
  const lengthS = rules.lengthS + Math.max(0, fold.addedS);
  const target = rules.capS > 0 ? Math.max(rules.capS, rules.lengthS) : Math.max(lengthS, fold.remainingS);
  let timer;
  if (!fold.started) {
    // not started (no start, or a start to come): the full length, held
    const at = Number.isFinite(fold.startAt) ? fold.startAt : now;
    timer = { endsAt: at + rules.lengthS * 1000, total: target * 1000, pausedAt: at };
  } else {
    timer = { endsAt: fold.endsAt, total: target * 1000, ...(fold.pausedAt !== null ? { pausedAt: fold.pausedAt } : {}) };
  }
  return {
    genre: "gauge", format: "time", value: fold.remainingS, target, min: 0, timer,
    highlights: [...hl, ...(fold.started ? t : [])].sort((a, b) => a.at - b.at).slice(-LIMITS.highlights),
    ...(fold.ended ? { ended: true } : {}),
    ...(label ? { label: String(label).slice(0, LIMITS.label) } : {}),
  };
}

/* ───────────── Site time ───────────── */
/** "2026-11-30T18:30" in the site's time zone → milliseconds (UTC), or NaN. Two passes give the right offset, daylight saving included. */
export function siteTime(s, timeZone = "UTC") {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(s ?? ""));
  if (!m) return NaN;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const offset = (t) => {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
    } catch { return 0; }
  };
  const guess = wall - offset(wall);
  return wall - offset(guess);
}
