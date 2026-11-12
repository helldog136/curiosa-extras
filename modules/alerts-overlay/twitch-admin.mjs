// The "Twitch events" tab of the alerts overlay and the queue controls: the types with a switch each, an edit window per type (text, duration, minimum), ready-made text styles,
// a test per type, and the pause / empty buttons. Also the two tools for assistants. The engine itself is in twitch.mjs.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const tw = await import(new URL(`./twitch.mjs${v}`, import.meta.url).href);

const BADGE = { follow: "ok", sub: "accent", resub: "accent", gift: "accent", cheer: "warn", raid: "info", online: "ok", offline: "neutral", hype: "warn", redeem: "neutral" };
const SAMPLE = {
  follow: { type: "follow", name: "Camille", login: "camille" }, sub: { type: "sub", name: "etoile_nord", login: "etoile_nord", tier: "1" },
  resub: { type: "resub", name: "lune_douce", login: "lune_douce", tier: "1", months: 12, text: "Already a year, thank you." }, gift: { type: "gift", name: "Camille", login: "camille", tier: "1", count: 5 },
  cheer: { type: "cheer", name: "etoile_nord", login: "etoile_nord", amount: 500, text: "Cheer500 well played" }, raid: { type: "raid", name: "lune_douce", login: "lune_douce", viewers: 42 },
  online: { type: "online", name: "Camille" }, offline: { type: "offline", name: "Camille" }, hype: { type: "hype_begin", level: 1, total: 600 }, redeem: { type: "redeem", name: "lune_douce", login: "lune_douce", title: "Hydrate", amount: 500 },
};
const hasProvider = async (ctx) => { try { return (await ctx.api.instances.list({ module: "twitch-events" }))?.[0] ?? null; } catch { return null; } };

const typeName = (ctx, id) => ctx.t(`tw_type_${id}`);
/** What a person sees as the minimum of a type: "500 bits", "3 subs", "20 viewers", or nothing. */
const minText = (ctx, id, n) => (!tw.MINIMUM[id] || !n ? "" : ctx.t(`tw_min_${id}`, { n }));

/** The blocks of the tab. */
export async function panel(ctx, { query = {} } = {}) {
  const t = ctx.t, cfg = await tw.loadConfig(ctx), q = await tw.queueState(ctx);
  const here = await hasProvider(ctx);
  const edit = tw.TYPES.includes(query.edit) ? query.edit : null;
  const shown = Object.fromEntries(await Promise.all(tw.TYPES.map(async (id) => [id, (await sampleAlert(ctx, id))?.message ?? ""])));
  const rows = tw.TYPES.map((id) => {
    const c = cfg.types[id];
    // what the alert would say with a sample (never the raw `{name}` words); the tooltip gives the text as written
    return [{ text: typeName(ctx, id), badge: BADGE[id] }, { text: shown[id] || c.template || t(`tw_text_${id}`), title: c.template || t("tw_default_note") }, c.seconds ? t("tw_seconds", { n: c.seconds }) : "", minText(ctx, id, c.min),
      { text: c.on ? t("tw_on") : t("tw_off"), switch: { on: c.on, action: "setType", label: t("tw_switch_label", { type: typeName(ctx, id) }), onText: t("tw_on"), offText: t("tw_off") } }];
  });
  const fields = edit ? [
    { name: "id", kind: "hidden", label: "id", value: edit },
    { name: "template", label: t("tw_f_template"), value: cfg.types[edit].template, placeholder: t(`tw_text_${edit}`), example: t(`tw_text_${edit}`), help: t("tw_f_template_help") },
    { name: "seconds", kind: "number", label: t("tw_f_seconds"), min: tw.LIMITS.seconds.min, max: tw.LIMITS.seconds.max, step: 1, unit: t("tw_unit_seconds"), value: cfg.types[edit].seconds || "", placeholder: t("tw_f_seconds_default"), help: t("tw_f_seconds_help") },
    ...(tw.MINIMUM[edit] ? [{ name: "min", kind: "number", label: t(`tw_f_min_${edit}`), min: 1, max: tw.LIMITS.min, step: 1, value: cfg.types[edit].min || "", placeholder: t("tw_f_min_default"), help: t("tw_f_min_help") }] : []),
  ] : [];
  return [
    { type: "markdown", tab: "twitch", text: t("tw_intro") },
    here ? { type: "links", tab: "twitch", items: [{ label: t("tw_linked"), href: here.adminPath }] } : { type: "markdown", tab: "twitch", text: t("tw_absent") },
    { type: "adminForm", tab: "twitch", action: "applyPreset", title: t("tw_preset_title"), submitLabel: t("tw_preset_btn"), fields: [{ name: "preset", kind: "segmented", label: t("tw_preset"), value: cfg.preset || "simple", options: tw.PRESETS.map((p) => ({ value: p, label: t(`tw_preset_${p}`) })) }] },
    ...(edit ? [{ type: "adminForm", tab: "twitch", presentation: "dialog", action: "saveType", cancelHref: "?tab=twitch", title: t("tw_edit_title", { type: typeName(ctx, edit) }), submitLabel: t("tw_save_btn"), fields }] : []),
    { type: "table", tab: "twitch", columns: [t("tw_col_type"), t("tw_col_text"), t("tw_col_duration"), t("tw_col_min"), t("tw_col_on")], rows, rowIds: tw.TYPES.slice(), truncate: [1], pageSize: 0, searchable: true, searchPlaceholder: t("tw_search"),
      rowActions: [{ label: t("tw_edit_btn"), href: "?tab=twitch&edit={id}", presentation: "dialog" }, { label: t("tw_test_btn"), action: "testType", inMenu: true }] },
    // the queue, at the top of the first tab
    { type: "banner", tone: q.paused ? "warning" : "info", text: q.paused ? t("q_paused", { n: q.held }) : t("q_running", { n: q.staged }) },
    { type: "adminForm", action: q.paused ? "resume" : "pause", submitLabel: q.paused ? t("q_resume_btn") : t("q_pause_btn"), fields: [] },
    { type: "adminForm", action: "clearQueue", submitLabel: t("q_clear_btn"), fields: [] },
  ];
}

const fail = (ctx, key, vars) => ({ error: ctx.t(key, vars) });
const unknownError = (ctx, words) => ({ errors: { template: ctx.t("tw_err_template", { words: words.map((w) => `{${w}}`).join(", "), vars: tw.VARS.map((w) => `{${w}}`).join(" ") }) } });
const toNumber = (x) => { const n = Math.trunc(Number(String(x ?? "").trim())); return String(x ?? "").trim() === "" ? 0 : n; };

/** Changes one type: { on?, template?, seconds?, min? }. Validates; returns { ok } or { error / errors }. */
export async function changeType(ctx, id, ch) {
  if (!tw.TYPES.includes(id)) return fail(ctx, "tw_err_type");
  const cfg = await tw.loadConfig(ctx), cur = cfg.types[id], next = { ...cur };
  if (ch.on !== undefined) next.on = ch.on === true;
  if (ch.template !== undefined) {
    const text = String(ch.template).trim();
    const bad = tw.unknownWords(text);
    if (bad.length) return unknownError(ctx, bad);
    if (text.length > tw.LIMITS.template) return { errors: { template: ctx.t("tw_err_long", { n: tw.LIMITS.template }) } };
    next.template = text;
  }
  if (ch.seconds !== undefined) {
    const n = toNumber(ch.seconds);
    if (n !== 0 && (n < tw.LIMITS.seconds.min || n > tw.LIMITS.seconds.max)) return { errors: { seconds: ctx.t("tw_err_seconds", { min: tw.LIMITS.seconds.min, max: tw.LIMITS.seconds.max }) } };
    next.seconds = n;
  }
  if (ch.min !== undefined && tw.MINIMUM[id]) {
    const n = toNumber(ch.min);
    if (n < 0 || n > tw.LIMITS.min) return { errors: { min: ctx.t("tw_err_min", { max: tw.LIMITS.min }) } };
    next.min = n;
  }
  await tw.saveConfig(ctx, { ...cfg, preset: ch.template !== undefined ? "" : cfg.preset, types: { ...cfg.types, [id]: next } });
  return { ok: ctx.t("tw_saved", { type: typeName(ctx, id) }) };
}

/** The sample alert of a type, written with the current text (a test goes through the same path as a real alert, minus the switches and minimums). */
export async function sampleAlert(ctx, id, now = Date.now()) {
  const sample = SAMPLE[id];
  if (!sample) return null;
  const cfg = await tw.loadConfig(ctx, now);
  const r = tw.alertFor({ ...sample, id: `test-${now}`, at: new Date(now).toISOString(), test: true }, { config: cfg, ignore: new Set(), showText: ctx.setting("twitchText") === true, locale: ctx.locale, text: (k) => ctx.t(`tw_text_${k}`), title: (p) => ctx.t(`tw_title_${p}`), seconds: 0, now });
  return r.alert ?? null;
}

/** The admin actions, given the function that shows an alert on the pages of this overlay. */
export function actions(emit) {
  return {
    async setType(ctx, values) { return changeType(ctx, String(values.id ?? ""), { on: values.enabled === "1" }); },
    async saveType(ctx, values) { return changeType(ctx, String(values.id ?? ""), { template: values.template ?? "", seconds: values.seconds ?? "", min: values.min ?? "" }); },
    async testType(ctx, values) {
      const a = await sampleAlert(ctx, String(values.id ?? ""));
      if (!a) return fail(ctx, "tw_err_type");
      emit(ctx.instance.key, a);
      return { ok: ctx.t("tw_test_ok") };
    },
    async applyPreset(ctx, values) {
      const p = String(values.preset ?? "");
      if (!tw.PRESETS.includes(p)) return fail(ctx, "tw_err_type");
      const cfg = await tw.loadConfig(ctx);
      const types = Object.fromEntries(tw.TYPES.map((id) => [id, { ...cfg.types[id], template: p === "simple" ? "" : ctx.t(`tw_preset_${p}_${id}`) }]));
      await tw.saveConfig(ctx, { preset: p, types });
      return { ok: ctx.t("tw_preset_ok", { style: ctx.t(`tw_preset_${p}`) }) };
    },
    async pause(ctx) { await tw.pause(ctx); return { ok: ctx.t("q_pause_ok") }; },
    async resume(ctx) { const r = await tw.resume(ctx, (a) => emit(ctx.instance.key, a)); return { ok: ctx.t("q_resume_ok", { n: r.released }) }; },
    async clearQueue(ctx) { const r = await tw.clearQueue(ctx, (a) => emit(ctx.instance.key, a)); return { ok: ctx.t("q_clear_ok", { n: r.dropped }) }; },
  };
}

const expose = (message) => Object.assign(new Error(message), { expose: true });
/** Tools for assistants: read the texts of the alerts, change one type. Never a deletion. */
export function tools() {
  const view = (cfg, id) => ({ type: id, enabled: cfg.types[id].on, text: cfg.types[id].template || null, durationSeconds: cfg.types[id].seconds || null, minimum: tw.MINIMUM[id] ? cfg.types[id].min || null : undefined });
  return {
    async alert_templates_get(ctx) {
      const cfg = await tw.loadConfig(ctx), q = await tw.queueState(ctx);
      return { words: tw.VARS, types: tw.TYPES.map((id) => view(cfg, id)), preset: cfg.preset || null, queue: q };
    },
    async alert_template_update(ctx, a) {
      if (!tw.TYPES.includes(a.type)) throw expose("Unknown type. Use one of: " + tw.TYPES.join(", "));
      const ch = {};
      if (a.enabled !== undefined) ch.on = a.enabled === true;
      if (a.text !== undefined) ch.template = a.text;
      if (a.durationSeconds !== undefined) ch.seconds = a.durationSeconds;
      if (a.minimum !== undefined) ch.min = a.minimum;
      if (!Object.keys(ch).length) throw expose("Give at least one of: enabled, text, durationSeconds, minimum.");
      const r = await changeType(ctx, a.type, ch);
      if (r.error) throw expose(r.error);
      if (r.errors) throw expose(Object.values(r.errors).join(" "));
      return view(await tw.loadConfig(ctx), a.type);
    },
  };
}
