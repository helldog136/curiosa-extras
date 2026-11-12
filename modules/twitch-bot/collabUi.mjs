// The collaboration mode on the administration page: one line under the status bar (state, since when, one button) and, under it, the one choice that matters (what the timers do: paused,
// or one out of 2, 3 or 5 still goes out) with the rare ones folded under "More options". The remote control offers the same choices. The mode itself lives in collab.mjs.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbouring files (otherwise the old code would stay cached after an update)
const C = await import(`./collab.mjs${v}`);
const K = await import(`./adminkit.mjs${v}`);

const stamp = (ctx, s, at) => new Date(at).toLocaleString(ctx.locale, { dateStyle: "short", timeStyle: "short", timeZone: s.timeZone });

/** The sentence that says what the mode does right now ("1 timer in 3 goes out" / "Timers are paused"). */
export const effectText = (t, e) => (e.mode === "pause" ? t("co_fx_pause") : t("co_fx_thin", { n: e.ratio }));

/** The line under the status bar. `e`: the current state (collab.current). */
export function bar(ctx, s, e) {
  const t = ctx.t, fail = t("err_toggle");
  const texts = e.on
    ? [t(`co_since_${e.by ?? "admin"}`, { date: stamp(ctx, s, e.since) }), effectText(t, e), e.until ? t("co_ends", { date: stamp(ctx, s, e.until) }) : t("co_no_end")]
    : [t("co_off_text")];
  const button = e.on
    ? K.actionButton({ label: t("co_stop_btn"), act: "collabOff", cls: "small primary", fail })
    : K.actionButton({ label: t("co_start_btn"), act: "collabOn", cls: "small", fail, title: t("co_start_tip") });
  return K.statusBar(ctx, { kind: e.on ? "warn" : "builtin", pill: t(e.on ? "co_pill_on" : "co_pill_off"), texts, buttons: button });
}

/** The choices form. One visible field; the rest is folded (R4, R7). */
export function form(ctx, e) {
  const t = ctx.t;
  return {
    type: "adminForm", action: "collabSave", title: t("co_form_title"), submitLabel: t("co_save_btn"),
    fields: [
      { name: "collabTimers", label: t("co_f_timers"), kind: "segmented", value: C.timersOf(e), options: C.TIMERS.map((x) => ({ value: x, label: x === "pause" ? t("co_o_pause") : t("co_o_ratio", { n: x }) })) },
      { name: "collabFactor", label: t("co_f_factor"), kind: "number", value: e.factor, placeholder: String(C.DEFAULTS.factor), min: C.FACTOR.min, max: C.FACTOR.max, step: 1, unit: t("co_unit_times"), help: t("co_f_factor_help"), folded: true },
      { name: "collabQuiet", label: t("co_f_quiet"), kind: "switch", value: e.quiet ? "on" : "", help: t("co_f_quiet_help"), folded: true },
      { name: "collabHours", label: t("co_f_hours"), kind: "number", value: e.hours, placeholder: String(C.DEFAULTS.hours), min: C.HOURS.min, max: C.HOURS.max, step: 1, unit: t("co_unit_hours"), help: t("co_f_hours_help"), folded: true },
    ],
  };
}

/** Turns the codes of `collab.check` into sentences placed under the field. */
export function errors(ctx, codes) {
  const t = ctx.t, out = {};
  for (const [field, code] of Object.entries(codes)) out[field] = t(`co_e_${code}`);
  return out;
}

/** The two blocks of the page. */
export const blocks = (ctx, s, e) => [bar(ctx, s, e), form(ctx, e)];
