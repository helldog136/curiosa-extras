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
/** The sample evening of "What the stream sees". */
const SIMULATION = ["follow", "sub", "gift", "cheer", "raid"];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Three sample cards, as the overlay draws them (the card, the kind in the accent colour, the sentence, the picture when there is one). Everything escaped; only site pictures. */
function previewHtml(ctx, cfg, shown) {
  const cards = ["follow", "cheer", "raid"].filter((id) => cfg.types[id].on).map((id) => {
    const c = cfg.types[id], img = c.image && tw.IMAGE_RE.test(c.image) ? `<img src="${esc(c.image)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px">` : "";
    return `<div role="img" aria-label="${esc(typeName(ctx, id))}" style="display:flex;align-items:center;gap:12px;padding:12px 16px;border:1px solid var(--v-line,#8884);border-radius:12px;background:var(--v-surface,transparent);min-width:0">${img}<div style="min-width:0"><div style="font-weight:700;color:var(--v-accent,inherit)">${esc(ctx.t(`kind_${tw.KIND[id]}`))}</div><div style="overflow-wrap:anywhere">${esc(shown[id])}</div></div></div>`;
  });
  return cards.length ? `<div style="display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));margin:0 0 12px">${cards.join("")}</div>` : "";
}
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
    return [{ text: typeName(ctx, id), badge: BADGE[id] }, { text: shown[id] || c.template || t(`tw_text_${id}`), title: c.template || t("tw_default_note"), ...(c.image ? { image: { src: c.image, alt: t("tw_image_alt", { type: typeName(ctx, id) }) } } : {}) }, c.seconds ? t("tw_seconds", { n: c.seconds }) : "", minText(ctx, id, c.min),
      { text: c.on ? t("tw_on") : t("tw_off"), switch: { on: c.on, action: "setType", label: t("tw_switch_label", { type: typeName(ctx, id) }), onText: t("tw_on"), offText: t("tw_off") } }];
  });
  const fields = edit ? [
    { name: "id", kind: "hidden", label: "id", value: edit },
    { name: "template", label: t("tw_f_template"), value: cfg.types[edit].template, placeholder: t(`tw_text_${edit}`), example: t(`tw_text_${edit}`), help: t("tw_f_template_help") },
    { name: "seconds", kind: "number", label: t("tw_f_seconds"), min: tw.LIMITS.seconds.min, max: tw.LIMITS.seconds.max, step: 1, unit: t("tw_unit_seconds"), value: cfg.types[edit].seconds || "", placeholder: t("tw_f_seconds_default"), help: t("tw_f_seconds_help") },
    { name: "sound", kind: "select", folded: true, label: t("tw_f_sound"), value: cfg.types[edit].sound === "none" ? "" : cfg.types[edit].sound, options: tw.SOUNDS.map((x) => ({ value: x === "none" ? "" : x, label: t(`tw_sound_${x}`) })),   // "no sound" is the empty choice: the folded panel stays shut until something is chosen
    help: t("tw_f_sound_help") },
    { name: "anim", kind: "select", folded: true, label: t("tw_f_anim"), value: cfg.types[edit].anim, options: tw.ANIMS.map((x) => ({ value: x, label: t(`tw_anim_${x || "module"}`) })) },
    { name: "image", kind: "image", folded: true, label: t("tw_f_image"), value: cfg.types[edit].image, help: t("tw_f_image_help") },
    ...(tw.MINIMUM[edit] ? [{ name: "min", kind: "number", label: t(`tw_f_min_${edit}`), min: 1, max: tw.LIMITS.min, step: 1, value: cfg.types[edit].min || "", placeholder: t("tw_f_min_default"), help: t("tw_f_min_help") }] : []),
  ] : [];
  return [
    { type: "markdown", tab: "twitch", text: t("tw_intro") },
    here ? { type: "links", tab: "twitch", items: [{ label: t("tw_linked"), href: here.adminPath }] } : { type: "markdown", tab: "twitch", text: t("tw_absent") },
    { type: "adminForm", tab: "twitch", action: "applyPreset", title: t("tw_preset_title"), submitLabel: t("tw_preset_btn"), fields: [{ name: "preset", kind: "segmented", label: t("tw_preset"), value: cfg.preset || "simple", options: tw.PRESETS.map((p) => ({ value: p, label: t(`tw_preset_${p}`) })) }] },
    ...(previewHtml(ctx, cfg, shown) ? [{ type: "html", tab: "twitch", html: previewHtml(ctx, cfg, shown) }] : []),
    { type: "adminForm", tab: "twitch", action: "simulate", submitLabel: t("tw_simulate_btn"), fields: [] },
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
  if (ch.sound !== undefined) {
    if (!tw.SOUNDS.includes(ch.sound)) return { errors: { sound: ctx.t("tw_err_choice") } };
    next.sound = ch.sound;
  }
  if (ch.anim !== undefined) {
    if (!tw.ANIMS.includes(ch.anim)) return { errors: { anim: ctx.t("tw_err_choice") } };
    next.anim = ch.anim;
  }
  if (ch.image !== undefined) {
    const url = String(ch.image ?? "").trim().replace(/\?.*$/, "");
    if (url === "") {
      if (cur.image) await ctx.api.files?.remove?.(cur.image);
      next.image = "";
    } else if (url !== cur.image) {
      // The picture must be one the site holds: uploaded by this person a moment ago, then KEPT by this module (and the previous one is let go).
      if (!tw.IMAGE_RE.test(url)) return { errors: { image: ctx.t("tw_err_image") } };
      const claim = typeof ctx.api.files?.claim === "function" ? await ctx.api.files.claim(url) : { ok: false };
      if (!claim.ok) return { errors: { image: ctx.t("tw_err_image") } };
      if (cur.image) await ctx.api.files.remove(cur.image);
      next.image = url;
    }
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
    async saveType(ctx, values) { return changeType(ctx, String(values.id ?? ""), { template: values.template ?? "", seconds: values.seconds ?? "", min: values.min ?? "", sound: values.sound || "none", anim: values.anim ?? "", image: values.image ?? "" }); },
    /** "What the stream sees": a short sample evening goes through the real path (texts, pictures, sounds, durations, queue), one alert after the other. */
    async simulate(ctx) {
      let n = 0;
      for (const id of SIMULATION) { const a = await sampleAlert(ctx, id); if (a) { emit(ctx.instance.key, a); n++; } }
      return { ok: ctx.t("tw_simulate_ok", { n }) };
    },
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
  const view = (cfg, id) => ({ type: id, enabled: cfg.types[id].on, text: cfg.types[id].template || null, durationSeconds: cfg.types[id].seconds || null, minimum: tw.MINIMUM[id] ? cfg.types[id].min || null : undefined, sound: cfg.types[id].sound, animation: cfg.types[id].anim || "default", hasPicture: !!cfg.types[id].image });
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
      if (a.sound !== undefined) ch.sound = a.sound;
      if (a.animation !== undefined) ch.anim = a.animation === "default" ? "" : a.animation;
      if (!Object.keys(ch).length) throw expose("Give at least one of: enabled, text, durationSeconds, minimum, sound, animation.");
      const r = await changeType(ctx, a.type, ch);
      if (r.error) throw expose(r.error);
      if (r.errors) throw expose(Object.values(r.errors).join(" "));
      return view(await tw.loadConfig(ctx), a.type);
    },
  };
}
