// Stream goals: the admin page. Two tabs, one task each (R1): « Objectif » (the bar towards a number) and « Subathon » (the countdown that grows).
// The settings of each tab are drawn by the core under these blocks, with its one « Enregistrer » bar (R3); the blocks here only show the state and the
// few live actions (set the value by hand, pause, add time, test), all secondary buttons.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const S = await import(new URL(`./store.mjs${v}`, import.meta.url).href);
const M = await import(new URL(`./model.mjs${v}`, import.meta.url).href);

const fmtNum = (ctx, n) => new Intl.NumberFormat(ctx.locale).format(Math.round(n));
/** "3:42:10", "12:05", "0:30" */
export function clock(sec) {
  const s = Math.max(0, Math.round(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
const fmtWhen = (ctx, ms) => new Date(ms).toLocaleString(ctx.locale, { dateStyle: "medium", timeStyle: "short", timeZone: ctx.timezone ?? "UTC" });

/** The state line of the goal, in words. */
export function goalLine(ctx, g) {
  const t = ctx.t;
  const unit = g.metric === "manual" ? "" : t(`unit_${g.metric}`);
  const parts = [t("goal_now", { value: fmtNum(ctx, g.value), target: fmtNum(ctx, g.target), unit }).trim()];
  if (g.base?.source === "twitch") parts.push(t("goal_read", { when: fmtWhen(ctx, g.base.asOf) }));
  else if (g.base?.source === "manual") parts.push(t("goal_manual", { when: fmtWhen(ctx, g.base.asOf) }));
  if (g.value >= g.target) parts.push(t("goal_reached"));
  return parts.join(" · ");
}

/** The state line of the subathon, in words. */
export function subathonLine(ctx, x) {
  const t = ctx.t, f = x.fold;
  if (!Number.isFinite(x.startAt)) return t("sub_nostart");
  if (!f.started) return t("sub_waiting", { when: fmtWhen(ctx, x.startAt), length: clock(x.rules.lengthS) });
  if (f.ended) return t("sub_ended", { added: clock(Math.max(0, f.addedS)) });
  const parts = [t(f.pausedAt !== null ? "sub_paused" : "sub_left", { left: clock(f.remainingS) }), t("sub_added", { added: clock(Math.max(0, f.addedS)) })];
  if (f.capped > 0) parts.push(t("sub_capped"));
  return parts.join(" · ");
}

export async function panel(ctx) {
  const t = ctx.t, now = Date.now();
  await S.sync(ctx, { now, force: true });
  const g = await S.goalNow(ctx, now), x = await S.subathonNow(ctx, now);
  const [events, figures] = await Promise.all([S.hasSource(ctx, "events"), S.hasSource(ctx, "figures")]);
  const blocks = [];
  // ── Goal ──
  blocks.push({ type: "markdown", tab: "goal", text: `**${goalLine(ctx, g)}**` });
  // R25: what feeds the bar, with a direct way to add it when it is missing (never installed without the owner's click)
  if (g.metric !== "manual" && !figures) blocks.push({ type: "suggestInstall", tab: "goal", service: S.SERVICES.figures, reason: t("suggest_figures") });
  if (g.metric !== "manual" && !events) blocks.push({ type: "suggestInstall", tab: "goal", service: S.SERVICES.events, reason: t("suggest_events") });
  if (g.metric === "manual" || !figures) {
    blocks.push({ type: "adminForm", tab: "goal", action: "setValue", submitLabel: t("set_value_submit"), submitStyle: "secondary",
      fields: [{ name: "value", kind: "number", label: t("set_value_label"), value: String(g.value), min: 0, max: 1_000_000_000, step: 1, ...(g.metric === "manual" ? {} : { unit: t(`unit_${g.metric}`) }), example: "120" }] });
  }
  blocks.push({ type: "adminForm", tab: "goal", action: "testGoal", submitLabel: t("test_goal_submit"), submitStyle: "secondary", fields: [] });
  // ── Subathon ──
  blocks.push({ type: "markdown", tab: "subathon", text: `**${subathonLine(ctx, x)}**` });
  if (!events) blocks.push({ type: "suggestInstall", tab: "subathon", service: S.SERVICES.events, reason: t("suggest_events_sub") });
  if (x.fold.started && !x.fold.ended) {
    const paused = x.fold.pausedAt !== null;
    blocks.push({ type: "adminForm", tab: "subathon", action: paused ? "resume" : "pause", submitLabel: t(paused ? "resume_submit" : "pause_submit"), submitStyle: "secondary", fields: [] });
  }
  if (Number.isFinite(x.startAt)) {
    blocks.push({ type: "adminForm", tab: "subathon", action: "addTime", submitLabel: t("add_time_submit"), submitStyle: "secondary",
      extraActions: [{ label: t("test_sub_submit"), action: "testSubathon" }],
      fields: [{ name: "minutes", kind: "number", label: t("add_time_label"), help: t("add_time_help"), min: -600, max: 600, step: 1, unit: t("unit_minutes"), example: "5", value: "" }] });
  } else blocks.push({ type: "adminForm", tab: "subathon", action: "testSubathon", submitLabel: t("test_sub_submit"), submitStyle: "secondary", fields: [] });
  return blocks;
}

const whole = (raw, min, max) => {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!/^-?\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
};

export const actions = {
  async setValue(ctx, input) {
    const n = whole(input?.value, 0, 1_000_000_000);
    if (n === null) return { errors: { value: ctx.t("err_value") } };
    await S.setValue(ctx, n);
    return { ok: ctx.t("set_value_done", { value: new Intl.NumberFormat(ctx.locale).format(n) }) };
  },
  async testGoal(ctx) { await S.rehearse(ctx, "goal"); return { ok: ctx.t("test_done") }; },
  async testSubathon(ctx) { await S.rehearse(ctx, "subathon"); return { ok: ctx.t("test_done") }; },
  async pause(ctx) { await S.setPaused(ctx, true); return { ok: ctx.t("pause_done") }; },
  async resume(ctx) { await S.setPaused(ctx, false); return { ok: ctx.t("resume_done") }; },
  async addTime(ctx, input) {
    const n = whole(input?.minutes, -600, 600);
    if (n === null || n === 0) return { errors: { minutes: ctx.t("err_minutes") } };
    const x = await S.subathonNow(ctx);
    if (!Number.isFinite(x.startAt)) return { errors: { minutes: ctx.t("err_nostart") } };
    await S.addTime(ctx, n * 60);
    return { ok: ctx.t(n > 0 ? "add_time_done" : "remove_time_done", { minutes: Math.abs(n) }) };
  },
};
export { M };
