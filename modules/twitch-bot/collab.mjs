// Collaboration mode: when you stream with other people in a shared chat, the bot talks less on its own. One switch, kept in the state document (it survives a restart and an update),
// plus a few choices (kept next to it). Nothing here is a Twitch detail and nothing here sends a message.
//
// What the mode changes while it is ON (everything else is untouched; a reply to a command typed by a viewer is NEVER muted):
//   - timers (automatic repeats): "pause" (nothing goes out) or "thin" (only one due send out of 2 or 3, counted per timer: see timers.mjs);
//   - optional "More options": the delays of the commands are multiplied (`factor`), the other automatic messages of the bot are muted (`quiet`: the notice that points were given back,
//     and the chat answer of a reward, which is then refunded), and an automatic end after `hours` hours (a safety net so that the mode is not left on by mistake).
// The module has no thank-you for a follow, a raid or a subscription and no automatic message about the game or the title: there is nothing else to mute.
// The switch is remembered as { on, since, by, until }; the choices as { mode, ratio, factor, quiet, hours }. `by` is where the last change came from.
// For the person the timers choice is ONE notion with four values (TIMERS): "pause", or one send out of 2, 3 or 5 ("2", "3", "5"); it is stored as { mode, ratio } (the form stored since 1.14.0, still read as is).
// The automatic end is a number of hours kept as before (0 to 24); the remote control offers a short list of it (HOURS_LIST).
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbouring files (otherwise the old code would stay cached after an update)
const st = await import(`./state.mjs${v}`);

export const MODES = ["thin", "pause"];
export const RATIOS = [2, 3, 5];
export const TIMERS = ["pause", "2", "3", "5"];
export const HOURS_LIST = [2, 4, 6, 0];   // what the remote control offers (0 = never); any whole number from 0 to 24 is still valid and is kept
export const FACTOR = { min: 1, max: 5 };
export const HOURS = { min: 0, max: 24 };
export const DEFAULTS = { mode: "thin", ratio: 3, factor: 1, quiet: false, hours: 6 };
export const HISTORY_MAX = 10;
export const BY = ["admin", "remote", "assistant", "auto"];
const rec = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
const int = (x, min, max, def) => { const n = Number(x); return Number.isInteger(n) && n >= min && n <= max ? n : def; };

/** The choices, always valid (a missing or damaged value falls back to its default). */
export function choicesOf(state) {
  const c = rec(rec(state).collabCfg);
  return {
    mode: MODES.includes(c.mode) ? c.mode : DEFAULTS.mode,
    ratio: RATIOS.includes(c.ratio) ? c.ratio : DEFAULTS.ratio,
    factor: int(c.factor, FACTOR.min, FACTOR.max, DEFAULTS.factor),
    quiet: c.quiet === true,
    hours: int(c.hours, HOURS.min, HOURS.max, DEFAULTS.hours),
  };
}

/** The timers choice as one value: "pause", "2", "3" or "5" (from the stored { mode, ratio }). */
export const timersOf = (c) => (c.mode === "pause" ? "pause" : String(c.ratio));
/** The stored { mode, ratio } of one timers value (null when the value is not one of TIMERS). */
export const fromTimers = (x, cur = DEFAULTS) => (String(x) === "pause" ? { mode: "pause", ratio: cur.ratio } : RATIOS.includes(Number(x)) ? { mode: "thin", ratio: Number(x) } : null);

/** What counts right now: { on, since, by, until, ...choices }. A mode whose automatic end has passed is off, even before anybody wrote it down. Pure: reads nothing, writes nothing. */
export function effective(state, now = Date.now()) {
  const c = rec(rec(state).collab), choices = choicesOf(state);
  const since = Number.isFinite(c.since) ? c.since : null;
  const until = Number.isFinite(c.until) ? c.until : null;
  const on = c.on === true && since !== null && !(until !== null && now >= until);
  return { ...choices, on, since: on ? since : null, until: on ? until : null, by: on && BY.includes(c.by) ? c.by : null, expired: c.on === true && !on };
}

/** The state to show: { ...effective, history }. Writes down an automatic end that has come. */
export async function current(ctx, now = Date.now()) {
  const state = await st.readState(ctx);
  const e = effective(state, now);
  if (e.expired) await setOn(ctx, false, "auto", { now }).catch(() => {});
  return { ...e, history: historyOf(state) };
}

export const historyOf = (state) => (Array.isArray(rec(state).collabLog) ? state.collabLog : []).filter((h) => h && Number.isFinite(h.at)).slice(0, HISTORY_MAX);

/**
 * Switches the mode on or off. `by`: where the press came from (admin, remote, assistant, auto). A repeated press changes nothing (the date stays). The journal of the core (who and when) is written
 * only when something changed. Rends { changed, on }.
 */
export async function setOn(ctx, on, by, { now = Date.now() } = {}) {
  const who = BY.includes(by) ? by : "admin";
  let changed = false;
  await st.updateState(ctx, (d) => {
    const was = effective(d, now).on;
    if (was === on && !(!on && rec(d.collab).on === true)) return;   // nothing to change (a mode ended by the clock but not yet written down is a change: it is written now)
    changed = true;
    const hours = choicesOf(d).hours;
    d.collab = on ? { on: true, since: now, by: who, until: hours > 0 ? now + hours * 3_600_000 : null } : { on: false, since: null, by: who, until: null };
    d.collabLog = [{ at: now, on, by: who }, ...historyOf(d)].slice(0, HISTORY_MAX);
  });
  if (changed) { try { await ctx.api.log?.write({ action: on ? "collab.on" : "collab.off", data: { by: who } }); } catch { /* the journal is a plus */ } }
  return { changed, on };
}

/** Saves the choices (already checked by `check`). When the mode is on and the automatic end changed, the end moves with it (counted from the start). */
export async function saveChoices(ctx, next, { now = Date.now() } = {}) {
  await st.updateState(ctx, (d) => {
    d.collabCfg = { mode: next.mode, ratio: next.ratio, factor: next.factor, quiet: next.quiet === true, hours: next.hours };
    const c = rec(d.collab);
    if (c.on === true && Number.isFinite(c.since)) d.collab = { ...c, until: next.hours > 0 ? c.since + next.hours * 3_600_000 : null };
  });
  return next;
}

/** Checks the values of the form (strings). Rends { ok: true, value } or { ok: false, errors: { field: code } } (the codes are turned into sentences by the page). */
export function check(values, cur = DEFAULTS) {
  const errors = {};
  let mode = values.mode === undefined ? cur.mode : String(values.mode);
  let ratio = values.ratio === undefined ? cur.ratio : Number(values.ratio);
  if (values.timers !== undefined) {   // the one-value form ("pause", "2", "3", "5") wins over the two older fields
    const t = fromTimers(values.timers, { ...cur, ratio });
    if (t) ({ mode, ratio } = t); else errors.collabTimers = "timers";
  } else {
    if (!MODES.includes(mode)) errors.collabMode = "mode";
    if (!RATIOS.includes(ratio)) errors.collabRatio = "ratio";
  }
  const num = (raw, def) => (raw === undefined ? def : String(raw).trim() === "" ? def : Number(raw));
  const factor = num(values.factor, cur.factor);
  if (!Number.isInteger(factor) || factor < FACTOR.min || factor > FACTOR.max) errors.collabFactor = "factor";
  const hours = num(values.hours, cur.hours);
  if (!Number.isInteger(hours) || hours < HOURS.min || hours > HOURS.max) errors.collabHours = "hours";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { mode, ratio, factor, hours, quiet: values.quiet === undefined ? cur.quiet : values.quiet === "on" || values.quiet === true } };
}

/** The delay of a command while the mode is on: multiplied by the factor (never above a day). */
export const stretch = (seconds, e) => (e?.on && e.factor > 1 ? Math.min(86_400, seconds * e.factor) : seconds);

/** "5 h 20", "2 h", "40 min": the time left, rounded up to the minute (for a sentence that says when the mode stops). */
export function leftText(t, ms) {
  const m = Math.max(1, Math.ceil(ms / 60_000)), h = Math.floor(m / 60), r = m % 60;
  return h === 0 ? t("co_left_m", { m }) : r === 0 ? t("co_left_h", { h }) : t("co_left_hm", { h, m: r });
}

/** The few words that say what the timers do ("timers paused" / "timers 1 in 3"). */
export const timersText = (t, c) => (c.mode === "pause" ? t("co_t_pause") : t("co_t_thin", { n: c.ratio }));

/** The state line of the remote control: says exactly what is active now ("On — timers 1 in 3 — stops in 5 h 20"). */
export function stateLine(t, e, now = Date.now()) {
  if (!e.on) return t("co_line_off");
  return t("co_line_on", { timers: timersText(t, e), end: e.until ? t("co_line_end", { left: leftText(t, e.until - now) }) : t("co_line_noend") });
}
