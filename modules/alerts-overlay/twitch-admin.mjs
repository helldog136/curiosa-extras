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

/** Whether the viewer text shows for a type: its own choice, or (when never chosen) the older setting. */
const viewerOn = (c, ctx) => (c.viewer === null ? ctx.setting("twitchText") === true : c.viewer);
const typeName = (ctx, id) => ctx.t(`tw_type_${id}`);
/** What a person sees as the minimum of a type: "500 bits", "3 subs", "20 viewers", or nothing. */
const minText = (ctx, id, n) => (!tw.MINIMUM[id] || !n ? "" : ctx.t(`tw_min_${id}`, { n }));

/** The blocks of the tab. */
export async function panel(ctx, { query = {} } = {}) {
  const t = ctx.t, cfg = await tw.loadConfig(ctx), q = await tw.queueState(ctx);
  const here = await hasProvider(ctx);
  const videos = tw.videosOf(ctx.setting);
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
    { name: "audio", kind: "audio", folded: true, label: t("tw_f_audio"), value: cfg.types[edit].audio, help: t("tw_f_audio_help") },
    { name: "present", kind: "select", folded: true, label: t("tw_f_present"), value: cfg.types[edit].present === "text" ? "" : cfg.types[edit].present, options: tw.PRESENT.map((x) => ({ value: x === "text" ? "" : x, label: t(`tw_present_${x}`) })) }   // the usual choice is the empty one: the folded panel stays shut until something else is chosen
    ,
    { name: "video", kind: "select", folded: true, label: t("tw_f_video"), value: cfg.types[edit].video ? String(cfg.types[edit].video) : "", options: [{ value: "", label: t("tw_video_none") }, ...videos.map((u, i) => ({ value: String(i + 1), label: t("tw_video_slot", { n: i + 1 }) })).filter((_, i) => videos[i])], help: t("tw_f_video_help") },
    { name: "videoSound", kind: "switch", folded: true, label: t("tw_f_video_sound"), value: cfg.types[edit].videoSound ? "on" : "" },
    { name: "tts", kind: "select", folded: true, label: t("tw_f_tts"), value: cfg.types[edit].tts === "off" ? "" : cfg.types[edit].tts, options: tw.TTS_MODES.map((x) => ({ value: x === "off" ? "" : x, label: t(`tw_tts_${x}`) })), help: t("tw_f_tts_help") },
    ...(tw.VIEWER_TYPES.includes(edit) ? [
      { name: "viewer", kind: "switch", folded: true, label: t("tw_f_viewer"), value: viewerOn(cfg.types[edit], ctx) ? "on" : "", help: t("tw_f_viewer_help") },
      { name: "viewerMax", kind: "number", folded: true, label: t("tw_f_viewer_max"), min: tw.TTS_LIMITS.viewerMax[0], max: tw.TTS_LIMITS.viewerMax[1], step: 1, unit: t("tw_unit_chars"), value: cfg.types[edit].viewerMax === 140 ? "" : cfg.types[edit].viewerMax, placeholder: t("tw_f_viewer_max_default") },
    ] : []),
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
    ...(await viewersBlocks(ctx, cfg)),
  ];
}

/** The tab "Viewers' texts and voice": the state of the voice, the voice form, the moderation form and the texts that were hidden or held. */
async function viewersBlocks(ctx, cfg) {
  const t = ctx.t, tab = "viewers";
  const rep = await tw.loadReport(ctx), vs = await tw.voiceState(ctx), list = await tw.textsList(ctx);
  const voices = rep?.voices ?? [];
  const state = !cfg.tts.on ? ["info", t("tts_state_off")] : !rep ? ["warning", t("tts_state_unknown")] : !rep.supported ? ["warning", t("tts_state_nosupport")] : !voices.length ? ["warning", t("tts_state_novoice")] : vs.muted ? ["info", t("tts_state_muted")] : ["info", t("tts_state_ok", { n: voices.length })];
  const voiceOptions = [{ value: "", label: t("tts_voice_auto") }, ...voices.map((x) => ({ value: x.n, label: `${x.n} (${x.l})` })), ...(cfg.tts.voice && !voices.some((x) => x.n === cfg.tts.voice) ? [{ value: cfg.tts.voice, label: cfg.tts.voice }] : [])];
  // the state is said only when it is the unusual one (R14): a held alert; a hidden text is the usual case and is not repeated on every line
  const rows = list.map((x) => [{ text: typeName(ctx, x.type), badge: BADGE[x.type] ?? "neutral" }, x.name, { text: x.text, title: x.text }, { text: x.hold ? t("mod_reason_held", { reason: t(`mod_reason_${x.reason}`) }) : t(`mod_reason_${x.reason}`), badge: x.hold ? "warn" : "neutral" }]);
  return [
    { type: "heading", tab, text: t("vw_head") },
    { type: "markdown", tab, text: t("vw_intro") },
    { type: "banner", tab, tone: state[0], text: state[1] },
    { type: "heading", tab, text: t("tts_title") },
    { type: "adminForm", tab, action: "saveVoice", submitLabel: t("tts_save_btn"), fields: [
      { name: "on", kind: "switch", label: t("tts_f_on"), value: cfg.tts.on ? "on" : "", help: t("tts_f_on_help") },
      { name: "voice", kind: "select", label: t("tts_f_voice"), value: cfg.tts.voice, options: voiceOptions, help: t("tts_f_voice_help") },
      { name: "rate", kind: "number", label: t("tts_f_rate"), min: tw.TTS_LIMITS.rate[0], max: tw.TTS_LIMITS.rate[1], step: 0.1, value: cfg.tts.rate },
      { name: "volume", kind: "number", label: t("tts_f_volume"), min: 0, max: 100, step: 5, unit: "%", value: cfg.tts.volume },
      { name: "pitch", kind: "number", folded: true, label: t("tts_f_pitch"), min: tw.TTS_LIMITS.pitch[0], max: tw.TTS_LIMITS.pitch[1], step: 0.1, value: cfg.tts.pitch },
      { name: "lang", kind: "text", folded: true, label: t("tts_f_lang"), value: cfg.tts.lang, example: t("tts_f_lang_example"), help: t("tts_f_lang_help") },
      { name: "max", kind: "number", folded: true, label: t("tts_f_max"), min: tw.TTS_LIMITS.max[0], max: tw.TTS_LIMITS.max[1], step: 10, unit: t("tw_unit_chars"), value: cfg.tts.max },
      { name: "readName", kind: "switch", folded: true, label: t("tts_f_name"), value: cfg.tts.readName ? "on" : "" },
    ] },
    { type: "adminForm", tab, action: "testVoice", submitLabel: t("tts_test_btn"), fields: [] },
    { type: "heading", tab, text: t("mod_title") },
    { type: "adminForm", tab, action: "saveModeration", submitLabel: t("mod_save_btn"), fields: [
      { name: "hold", kind: "segmented", label: t("mod_f_hold"), value: cfg.moderation.hold ? "hold" : "hide", options: [{ value: "hide", label: t("mod_hold_hide") }, { value: "hold", label: t("mod_hold_hold") }], help: t("mod_f_hold_help") },
      { name: "links", kind: "switch", label: t("mod_f_links"), value: cfg.moderation.links ? "on" : "" },
      { name: "caps", kind: "switch", label: t("mod_f_caps"), value: cfg.moderation.caps ? "on" : "" },
      { name: "repeats", kind: "switch", label: t("mod_f_repeats"), value: cfg.moderation.repeats ? "on" : "" },
      { name: "words", kind: "textarea", folded: true, label: t("mod_f_words"), value: cfg.moderation.wordsText, example: t("mod_f_words_example"), help: t("mod_f_words_help") },
    ] },
    { type: "markdown", tab, text: t("mod_limits") },
    rows.length
      ? { type: "table", tab, columns: [t("tw_col_type"), t("mod_col_name"), t("mod_col_text"), t("mod_col_reason")], rows, rowIds: list.map((x) => x.id), truncate: [2], pageSize: 0, searchable: true, searchPlaceholder: t("tw_search"),
        rowActions: [{ label: t("mod_accept_btn"), action: "acceptText" }, { label: t("mod_dismiss_btn"), action: "dismissText" }] }
      : { type: "markdown", tab, text: t("mod_empty") },
  ];
}

const fail = (ctx, key, vars) => ({ error: ctx.t(key, vars) });
const unknownError = (ctx, words) => ({ errors: { template: ctx.t("tw_err_template", { words: words.map((w) => `{${w}}`).join(", "), vars: tw.VARS.map((w) => `{${w}}`).join(" ") }) } });
const toNumber = (x) => { const n = Math.trunc(Number(String(x ?? "").trim())); return String(x ?? "").trim() === "" ? 0 : n; };

/** Changes the voice. Validates each number against its bounds; returns { ok } or { errors }. */
export async function changeVoice(ctx, ch) {
  const cfg = await tw.loadConfig(ctx), cur = cfg.tts, next = { ...cur }, errors = {};
  const num = (key, label, [lo, hi]) => { if (ch[key] === undefined) return; const n = Number(String(ch[key]).trim()); if (String(ch[key]).trim() === "" || !Number.isFinite(n) || n < lo || n > hi) errors[key] = ctx.t("tts_err_range", { min: lo, max: hi }); else next[key] = n; };
  if (ch.on !== undefined) next.on = ch.on === true;
  if (ch.readName !== undefined) next.readName = ch.readName === true;
  num("rate", "rate", tw.TTS_LIMITS.rate); num("pitch", "pitch", tw.TTS_LIMITS.pitch); num("volume", "volume", tw.TTS_LIMITS.volume); num("max", "max", tw.TTS_LIMITS.max);
  if (ch.voice !== undefined) next.voice = String(ch.voice).slice(0, 120);
  if (ch.lang !== undefined) { const l = String(ch.lang).trim(); if (l && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(l)) errors.lang = ctx.t("tts_err_lang"); else next.lang = l; }
  if (Object.keys(errors).length) return { errors };
  await tw.saveConfig(ctx, { ...cfg, tts: next });
  return { ok: ctx.t("tts_saved") };
}
/** Changes the moderation: the choice (hide the text / hold the alert), the three structural rules and the list of blocked words. */
export async function changeModeration(ctx, ch) {
  const cfg = await tw.loadConfig(ctx), next = { ...cfg.moderation };
  if (ch.hold !== undefined) next.hold = ch.hold === true;
  for (const k of ["links", "caps", "repeats"]) if (ch[k] !== undefined) next[k] = ch[k] === true;
  if (ch.words !== undefined) { const w = String(ch.words); if (w.length > 4000) return { errors: { words: ctx.t("mod_err_words") } }; next.wordsText = w; }
  await tw.saveConfig(ctx, { ...cfg, moderation: next });
  return { ok: ctx.t("mod_saved") };
}

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
  if (ch.audio !== undefined) {
    const url = String(ch.audio ?? "").trim().replace(/\?.*$/, "");
    if (url === "") {
      if (cur.audio) await ctx.api.files?.remove?.(cur.audio);
      next.audio = "";
    } else if (url !== cur.audio) {
      // The sound must be one the site holds: uploaded by this person a moment ago, then KEPT by this module (and the previous one is let go).
      if (!tw.AUDIO_RE.test(url)) return { errors: { audio: ctx.t("tw_err_audio") } };
      const claim = typeof ctx.api.files?.claim === "function" ? await ctx.api.files.claim(url) : { ok: false };
      if (!claim.ok) return { errors: { audio: ctx.t("tw_err_audio") } };
      if (cur.audio) await ctx.api.files.remove(cur.audio);
      next.audio = url;
    }
  }
  if (ch.present !== undefined) {
    if (!tw.PRESENT.includes(ch.present)) return { errors: { present: ctx.t("tw_err_choice") } };
    next.present = ch.present;
  }
  if (ch.video !== undefined) {
    const n = toNumber(ch.video);
    if (n !== 0 && !(n >= 1 && n <= tw.VIDEO_SLOTS && tw.videosOf(ctx.setting)[n - 1])) return { errors: { video: ctx.t("tw_err_video") } };
    next.video = n;
  }
  if (ch.videoSound !== undefined) next.videoSound = ch.videoSound === true;
  if (ch.tts !== undefined) {
    if (!tw.TTS_MODES.includes(ch.tts)) return { errors: { tts: ctx.t("tw_err_choice") } };
    next.tts = ch.tts;
  }
  if (ch.viewer !== undefined && tw.VIEWER_TYPES.includes(id)) next.viewer = ch.viewer === true;
  if (ch.viewerMax !== undefined && tw.VIEWER_TYPES.includes(id)) {
    const n = toNumber(ch.viewerMax) || 140, [lo, hi] = tw.TTS_LIMITS.viewerMax;
    if (n < lo || n > hi) return { errors: { viewerMax: ctx.t("tw_err_viewer_max", { min: lo, max: hi }) } };
    next.viewerMax = n;
  }
  if (next.present === "video" && !next.video) return { errors: { video: ctx.t("tw_err_video") } };
  if (next.present === "gif" && !next.image) return { errors: { image: ctx.t("tw_err_gif") } };
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
    async saveType(ctx, values) { return changeType(ctx, String(values.id ?? ""), { template: values.template ?? "", seconds: values.seconds ?? "", min: values.min ?? "", sound: values.sound || "none", anim: values.anim ?? "", image: values.image ?? "", audio: values.audio ?? undefined, present: values.present === undefined ? undefined : values.present || "text", video: values.video ?? undefined, videoSound: values.videoSound === undefined ? undefined : values.videoSound === "on", tts: values.tts === undefined ? undefined : values.tts || "off", viewer: values.viewer === undefined ? undefined : values.viewer === "on", viewerMax: values.viewerMax ?? undefined }); },
    async saveVoice(ctx, values) { return changeVoice(ctx, { on: values.on === "on", voice: values.voice, rate: values.rate, volume: values.volume, pitch: values.pitch, lang: values.lang, max: values.max, readName: values.readName === "on" }); },
    async saveModeration(ctx, values) { return changeModeration(ctx, { hold: values.hold === "hold", links: values.links === "on", caps: values.caps === "on", repeats: values.repeats === "on", words: values.words ?? "" }); },
    /** A sample sentence goes through the real path: the page reads it if the voice is on and a voice exists. */
    async testVoice(ctx) {
      const cfg = await tw.loadConfig(ctx);
      if (!cfg.tts.on) return fail(ctx, "tts_err_off");
      emit(ctx.instance.key, { kind: "test", message: ctx.t("tts_test_message"), say: ctx.t("tts_test_message"), seconds: 6 });
      return { ok: ctx.t("tts_test_ok") };
    },
    async acceptText(ctx, values) { const r = await tw.decideText(ctx, String(values.id ?? ""), "accept", (a) => emit(ctx.instance.key, a)); return r.ok ? { ok: ctx.t("mod_accepted") } : fail(ctx, "mod_err_unknown"); },
    async dismissText(ctx, values) { const r = await tw.decideText(ctx, String(values.id ?? ""), "dismiss", (a) => emit(ctx.instance.key, a)); return r.ok ? { ok: ctx.t("mod_dismissed") } : fail(ctx, "mod_err_unknown"); },
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
export function tools(emit) {
  const view = (cfg, id) => ({ type: id, enabled: cfg.types[id].on, text: cfg.types[id].template || null, durationSeconds: cfg.types[id].seconds || null, minimum: tw.MINIMUM[id] ? cfg.types[id].min || null : undefined, sound: cfg.types[id].sound, animation: cfg.types[id].anim || "default", hasPicture: !!cfg.types[id].image, hasSoundFile: !!cfg.types[id].audio });
  const self = {
    async alert_templates_get(ctx) {
      const cfg = await tw.loadConfig(ctx), q = await tw.queueState(ctx);
      return { words: tw.VARS, types: tw.TYPES.map((id) => view(cfg, id)), preset: cfg.preset || null, queue: q };
    },
    async voice_moderation_get(ctx) {
      const cfg = await tw.loadConfig(ctx), v = await tw.voiceState(ctx), rep = await tw.loadReport(ctx), list = await tw.textsList(ctx);
      return {
        voice: { on: cfg.tts.on, muted: v.muted, voice: cfg.tts.voice || null, language: cfg.tts.lang || null, rate: cfg.tts.rate, pitch: cfg.tts.pitch, volume: cfg.tts.volume, maxCharacters: cfg.tts.max, readName: cfg.tts.readName, pageReport: rep ? { supported: rep.supported, voices: rep.voices.length } : null },
        perType: tw.TYPES.map((id) => ({ type: id, presentation: cfg.types[id].present, speak: cfg.types[id].tts, viewerText: tw.VIEWER_TYPES.includes(id) ? cfg.types[id].viewer : undefined })),
        moderation: { holdWholeAlert: cfg.moderation.hold, blockLinks: cfg.moderation.links, blockCaps: cfg.moderation.caps, blockRepeats: cfg.moderation.repeats, blockedWordsCount: cfg.moderation.rules.words.length },
        flagged: list.map((x) => ({ id: x.id, type: x.type, name: x.name, reason: x.reason, held: x.hold, text: x.text })),
      };
    },
    async voice_moderation_update(ctx, a) {
      const voice = {}, mod = {};
      for (const [k, to] of [["on", "on"], ["voice", "voice"], ["language", "lang"], ["rate", "rate"], ["pitch", "pitch"], ["volume", "volume"], ["maxCharacters", "max"], ["readName", "readName"]]) if (a[k] !== undefined) voice[to] = a[k];
      for (const [k, to] of [["holdWholeAlert", "hold"], ["blockLinks", "links"], ["blockCaps", "caps"], ["blockRepeats", "repeats"], ["blockedWords", "words"]]) if (a[k] !== undefined) mod[to] = k === "blockedWords" ? (Array.isArray(a[k]) ? a[k].join("\n") : String(a[k])) : a[k];
      if (!Object.keys(voice).length && !Object.keys(mod).length) throw expose("Give at least one setting to change.");
      if (Object.keys(voice).length) { const r = await changeVoice(ctx, voice); if (r.errors) throw expose(Object.values(r.errors).join(" ")); }
      if (Object.keys(mod).length) { const r = await changeModeration(ctx, mod); if (r.errors) throw expose(Object.values(r.errors).join(" ")); }
      return self.voice_moderation_get(ctx);
    },
    async held_text_decide(ctx, a) {
      const r = await tw.decideText(ctx, String(a.id ?? ""), a.action === "accept" ? "accept" : "dismiss", (x) => emit(ctx.instance.key, x));
      if (!r.ok) throw expose("Unknown id. Read voice_moderation_get for the ids of the texts waiting.");
      return { done: true, action: r.action, type: r.type };
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
  return self;
}
