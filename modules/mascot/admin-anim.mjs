// Mascot — the "Animation" and "Voice" tabs of the administration (1.2.0).
// The preview is the REAL overlay page in a frame (test mode `ov-demo=1&ov-test=1`): the administration runs no script of a module, the page of the element does. Its two buttons
// ("Play talking animation", "Test the voice") and its status line live there. Nothing is published by these forms: they only change how the mascot moves and speaks.
const v = new URL(import.meta.url).search;
const M = await import(new URL(`./model.mjs${v}`, import.meta.url).href);
const S = await import(new URL(`./store.mjs${v}`, import.meta.url).href);
const O = await import(new URL(`./overlay.mjs${v}`, import.meta.url).href);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const langName = (ctx, code) => { try { return new Intl.DisplayNames([ctx.locale], { type: "language" }).of(code) || code; } catch { return code; } };
const WHICH = ["idle", "talk"];
export const RIGHT = "edit";

/** The preview: the real overlay element, in test mode, in a frame. */
export function previewFrame(ctx, tab) {
  const addr = O.elementAddress(ctx, "mascot", null).url;
  const src = `${addr}?lang=${encodeURIComponent(ctx.locale)}&ov-demo=1&ov-test=1&ov-text=light&ov-surface=soft&ov-corners=round&ov-w=440&ov-h=320`;
  return {
    type: "html", tab,
    html: `<iframe title="${esc(ctx.t("previewFrameTitle"))}" src="${esc(src)}" allow="autoplay" loading="lazy" style="display:block;width:100%;max-width:520px;height:340px;border:1px solid var(--v-line,#d5d8e0);border-radius:12px;background:var(--v-bg,transparent)"></iframe>`,
  };
}

/* ───────────── Animation ───────────── */

function animForm(ctx, config, which) {
  const a = config.anim[which];
  const fields = [
    { name: "which", kind: "hidden", label: "which", value: which },
    { name: "mode", kind: "segmented", label: ctx.t("anModeLabel"), value: a.mode, options: M.ANIM_MODES.map((m) => ({ value: m, label: ctx.t(`anMode_${m}`) })) },
    { name: "gif", kind: "image", label: ctx.t("anGifLabel"), value: a.gif, help: ctx.t("anGifHelp") },
    { name: "fps", kind: "number", label: ctx.t("anFpsLabel"), value: a.fps || "", min: M.ANIM.fps[0], max: M.ANIM.fps[1], step: 1, placeholder: String(M.ANIM.fps[2]), unit: ctx.t("anFpsUnit"), folded: true },
    ...(which === "idle" ? [{ name: "once", kind: "switch", label: ctx.t("anOnceLabel"), value: a.once ? "on" : "", folded: true }] : []),
  ];
  return { type: "adminForm", action: "saveAnim", tab: "animation", title: ctx.t(`an_${which}`), submitLabel: ctx.t("anSave"), fields };
}

function framesBlocks(ctx, config, which) {
  const a = config.anim[which];
  if (a.mode !== "frames") return [];
  const out = [];
  out.push({
    type: "table", tab: "animation", searchable: true, columns: [ctx.t("anColNumber"), ctx.t("anColSize")], empty: ctx.t("anNoFrames"),
    rowIds: a.frames.map((f) => `${which}|${f.src}`),
    rows: a.frames.map((f, i) => [{ text: ctx.t("anFrameName", { n: i + 1 }), image: { src: f.src, alt: ctx.t("anFrameAlt", { n: i + 1 }) } }, f.bytes ? kb(f.bytes) : ""]),
    rowActions: [{ label: ctx.t("anUp"), action: "frameUp" }, { label: ctx.t("anDown"), action: "frameDown" }, { label: ctx.t("anRemove"), action: "frameRemove", danger: true, confirm: ctx.t("anRemoveConfirm") }],
  });
  if (a.frames.length < M.ANIM.frames) {
    out.push({ type: "adminForm", action: "addFrame", tab: "animation", title: ctx.t("anAddTitle"), submitLabel: ctx.t("anAdd"), fields: [{ name: "which", kind: "hidden", label: "which", value: which }, { name: "image", kind: "image", label: ctx.t("anFrameLabel"), value: "", help: ctx.t("anFrameHelp", { max: M.ANIM.frames }) }] });
  } else out.push({ type: "banner", tone: "info", text: ctx.t("anFull", { max: M.ANIM.frames }), tab: "animation" });
  return out;
}

function readingForm(ctx, config) {
  const r = config.reading;
  return {
    type: "adminForm", action: "saveReading", tab: "animation", title: ctx.t("rdTitle"), submitLabel: ctx.t("rdSave"),
    fields: [
      { name: "speed", kind: "segmented", label: ctx.t("rdSpeedLabel"), value: r.speed, options: Object.keys(M.SPEEDS).map((k) => ({ value: k, label: ctx.t(`rdSpeed_${k}`) })) },
      { name: "min", kind: "number", label: ctx.t("rdMinLabel"), value: r.min === M.TALK.min[2] ? "" : r.min, min: M.TALK.min[0], max: M.TALK.min[1], step: 1, placeholder: String(M.TALK.min[2]), unit: ctx.t("secondsUnit"), folded: true },
      { name: "max", kind: "number", label: ctx.t("rdMaxLabel"), value: r.max === M.TALK.max[2] ? "" : r.max, min: M.TALK.max[0], max: M.TALK.max[1], step: 1, placeholder: String(M.TALK.max[2]), unit: ctx.t("secondsUnit"), folded: true },
    ],
  };
}

/** "20 characters: 2.0 s · 60 characters: 4.5 s…": the live example of the reading time, from the saved settings. */
export const readingExample = (ctx, config) => [20, 60, 140].map((n) => ctx.t("rdExample", { n, s: M.talkDuration("x".repeat(n), config.reading) })).join(" · ");

export function animationBlocks(ctx, config, canEdit) {
  const out = [{ type: "heading", text: ctx.t("animTitle"), tab: "animation" }, { type: "markdown", text: ctx.t("animIntro"), tab: "animation" }, previewFrame(ctx, "animation")];
  if (!canEdit) return out;
  for (const which of WHICH) out.push(animForm(ctx, config, which), ...framesBlocks(ctx, config, which));
  out.push({ type: "markdown", text: ctx.t("rdExampleLine", { example: readingExample(ctx, config) }), tab: "animation" }, readingForm(ctx, config));
  return out;
}

const REASONS = ["no-permission", "no-person", "invalid", "unknown", "not-uploader", "expired", "missing", "taken", "quota"];
/** Keeps a picture of the site for this mascot. → { ok, bytes } | { error }. A site without the file service still works (the size is then unknown). */
async function keep(ctx, url) {
  if (!ctx.api.files?.claim) return { ok: true, bytes: 0 };
  const r = await ctx.api.files.claim(url);
  if (r.ok) return { ok: true, bytes: Number(r.bytes) || 0 };
  return { error: ctx.t(`anClaim_${REASONS.includes(r.reason) ? r.reason : "unknown"}`) };
}
const release = async (ctx, url) => { if (url && ctx.api.files?.remove) await ctx.api.files.remove(url); };
const stillUsed = (config, url) => WHICH.some((w) => config.anim[w].gif === url || config.anim[w].frames.some((f) => f.src === url));

async function saveAnim(ctx, values) {
  const which = WHICH.includes(values.which) ? values.which : "idle";
  const config = await S.loadConfig(ctx);
  const old = config.anim[which];
  const mode = M.ANIM_MODES.includes(values.mode) ? values.mode : "none";
  const errors = {};
  let gif = old.gif, gifBytes = old.gifBytes;
  const typed = String(values.gif ?? "").trim();
  if (mode === "gif") {
    const url = M.uploadImage(typed);
    if (!typed) errors.gif = ctx.t("errAnGifEmpty");
    else if (!url) errors.gif = ctx.t("errAnGifBad");
    else if (url !== old.gif) {
      const k = await keep(ctx, url);
      if (k.error) errors.gif = k.error;
      else if (k.bytes > M.ANIM.bytes) errors.gif = ctx.t("errAnHeavy", { size: kb(k.bytes), max: kb(M.ANIM.bytes) });
      else { gif = url; gifBytes = k.bytes; }
    }
  } else if (typed && typed !== old.gif) {
    // The mode is not "one animated picture": a picture typed here is kept for later only if it is a valid one of the site.
    const url = M.uploadImage(typed);
    if (!url) errors.gif = ctx.t("errAnGifBad");
    else { const k = await keep(ctx, url); if (k.error) errors.gif = k.error; else if (k.bytes > M.ANIM.bytes) errors.gif = ctx.t("errAnHeavy", { size: kb(k.bytes), max: kb(M.ANIM.bytes) }); else { gif = url; gifBytes = k.bytes; } }
  }
  const fpsRaw = String(values.fps ?? "").trim();
  let fps = 0;
  if (fpsRaw) {
    const n = Number(fpsRaw);
    if (!Number.isInteger(n) || n < M.ANIM.fps[0] || n > M.ANIM.fps[1]) errors.fps = ctx.t("errAnFps", { min: M.ANIM.fps[0], max: M.ANIM.fps[1] });
    else fps = n;
  }
  if (Object.keys(errors).length) return { errors };
  const next = M.normalizeAnim({ ...old, mode, gif, gifBytes, fps, once: values.once === "on" });
  const saved = await S.saveConfig(ctx, { anim: { ...config.anim, [which]: next } });
  if (old.gif && old.gif !== next.gif && !stillUsed(saved, old.gif)) await release(ctx, old.gif);
  return { ok: ctx.t("anSaved") };
}

async function addFrame(ctx, values) {
  const which = WHICH.includes(values.which) ? values.which : "idle";
  const config = await S.loadConfig(ctx);
  const a = config.anim[which];
  const typed = String(values.image ?? "").trim();
  const url = M.uploadImage(typed);
  if (!typed) return { errors: { image: ctx.t("errAnFrameEmpty") } };
  if (!url) return { errors: { image: ctx.t("errAnGifBad") } };
  if (a.frames.length >= M.ANIM.frames) return { errors: { image: ctx.t("anFull", { max: M.ANIM.frames }) } };
  if (a.frames.some((f) => f.src === url)) return { errors: { image: ctx.t("errAnDuplicate") } };
  const k = await keep(ctx, url);
  if (k.error) return { errors: { image: k.error } };
  const total = M.animBytes(a) + k.bytes;
  if (total > M.ANIM.bytes) return { errors: { image: ctx.t("errAnTotal", { size: kb(total), max: kb(M.ANIM.bytes) }) } };
  await S.saveConfig(ctx, { anim: { ...config.anim, [which]: { ...a, frames: [...a.frames, { src: url, bytes: k.bytes }] } } });
  return { ok: ctx.t("anAdded") };
}

/** A row id is "idle|/uploads/…": the picture itself, so that an old page never moves or removes another one. */
function target(values, config) {
  const [which, src] = String(values.id ?? "").split("|");
  if (!WHICH.includes(which)) return null;
  const i = config.anim[which].frames.findIndex((f) => f.src === src);
  return i < 0 ? null : { which, i };
}
async function frameMove(ctx, values, dir) {
  const config = await S.loadConfig(ctx);
  const t = target(values, config);
  if (!t) return { error: ctx.t("errGone") };
  const frames = [...config.anim[t.which].frames], j = t.i + dir;
  if (j < 0 || j >= frames.length) return { ok: ctx.t(dir < 0 ? "anAlreadyFirst" : "anAlreadyLast") };
  [frames[t.i], frames[j]] = [frames[j], frames[t.i]];
  await S.saveConfig(ctx, { anim: { ...config.anim, [t.which]: { ...config.anim[t.which], frames } } });
  return { ok: ctx.t("anMoved", { n: j + 1 }) };
}
async function frameRemove(ctx, values) {
  const config = await S.loadConfig(ctx);
  const t = target(values, config);
  if (!t) return { error: ctx.t("errGone") };
  const a = config.anim[t.which], gone = a.frames[t.i];
  const saved = await S.saveConfig(ctx, { anim: { ...config.anim, [t.which]: { ...a, frames: a.frames.filter((_, i) => i !== t.i) } } });
  if (!stillUsed(saved, gone.src)) await release(ctx, gone.src);
  return { ok: ctx.t("anRemoved") };
}

async function saveReading(ctx, values) {
  const errors = {};
  const read = (name, range, label) => {
    const raw = String(values[name] ?? "").trim();
    if (!raw) return range[2];
    const n = Number(raw);
    if (!Number.isInteger(n) || n < range[0] || n > range[1]) { errors[name] = ctx.t("errRdNumber", { min: range[0], max: range[1], example: range[2] }); return range[2]; }
    return n;
  };
  const min = read("min", M.TALK.min), max = read("max", M.TALK.max);
  if (!errors.min && !errors.max && min > max) errors.max = ctx.t("errRdOrder", { min });
  const speed = Object.hasOwn(M.SPEEDS, values.speed) ? values.speed : "normal";
  if (Object.keys(errors).length) return { errors };
  await S.saveConfig(ctx, { reading: { speed, min, max } });
  return { ok: ctx.t("rdSaved") };
}

/* ───────────── Voice ───────────── */

const seg = (ctx, prefix, table, name, label, value) => ({ name, kind: "segmented", label, value, options: Object.keys(table).map((k) => ({ value: k, label: ctx.t(`${prefix}_${k}`) })) });
const volumeField = (ctx, voice) => ({ name: "volume", kind: "number", label: ctx.t("voVolumeLabel"), value: voice.volume === M.VOLUME[2] ? "" : voice.volume, min: M.VOLUME[0], max: M.VOLUME[1], step: 1, placeholder: String(M.VOLUME[2]), unit: "%", example: String(M.VOLUME[2]) });

function voiceForm(ctx, config) {
  const vo = config.voice, mode = vo.mode;
  const hidden = { name: "mode", kind: "hidden", label: "mode", value: mode };
  let fields = null;
  if (mode === "blips") {
    fields = [
      { name: "preset", kind: "select", label: ctx.t("voPresetLabel"), value: vo.blips.preset, options: M.BLIP_CHOICES.map((k) => ({ value: k, label: ctx.t(`voPreset_${k}`) })) },
      seg(ctx, "voPitch", M.PITCHES, "pitch", ctx.t("voPitchLabel"), vo.blips.pitch),
      seg(ctx, "voRate", M.BLIP_RATES, "rate", ctx.t("voRateLabel"), vo.blips.rate),
      volumeField(ctx, vo),
      { ...seg(ctx, "voVary", M.VARIATIONS, "vary", ctx.t("voVaryLabel"), vo.blips.vary), folded: true },
    ];
  } else if (mode === "speech") {
    fields = [
      { name: "lang", kind: "select", label: ctx.t("voLangLabel"), value: vo.speech.lang, options: [{ value: "", label: ctx.t("voLangPage") }, ...ctx.locales.slice(0, 12).map((l) => ({ value: l, label: langName(ctx, l) }))] },
      seg(ctx, "voSpeechRate", M.SPEECH_RATES, "srate", ctx.t("voSpeechRateLabel"), vo.speech.rate),
      seg(ctx, "voSpeechPitch", M.SPEECH_PITCHES, "spitch", ctx.t("voSpeechPitchLabel"), vo.speech.pitch),
      volumeField(ctx, vo),
      { name: "vname", kind: "text", label: ctx.t("voNameLabel"), value: vo.speech.name, help: ctx.t("voNameHelp"), example: ctx.t("voNameExample"), folded: true },
    ];
  } else if (mode === "custom") fields = [volumeField(ctx, vo)];
  if (!fields) return null;
  return { type: "adminForm", action: "saveVoice", tab: "voice", title: ctx.t(`vo_${mode}`), submitLabel: ctx.t("voSave"), fields: [hidden, ...fields] };
}

export function voiceBlocks(ctx, config, canEdit) {
  const mode = config.voice.mode;
  const out = [{ type: "heading", text: ctx.t("voiceTitle"), tab: "voice" }, { type: "markdown", text: ctx.t("voiceIntro"), tab: "voice" }];
  out.push({ type: "banner", tone: mode === "none" ? "info" : "success", text: ctx.t(`voState_${mode}`), tab: "voice" });
  out.push(previewFrame(ctx, "voice"));
  if (!canEdit) return out;
  out.push({
    type: "adminForm", action: "saveVoiceMode", tab: "voice", title: ctx.t("voModeTitle"), submitLabel: ctx.t("voModeSave"),
    fields: [{ name: "mode", kind: "segmented", label: ctx.t("voModeLabel"), value: mode, options: M.VOICE_MODES.map((m) => ({ value: m, label: ctx.t(`voMode_${m}`) })) }],
  });
  const form = voiceForm(ctx, config);
  if (form) out.push(form);
  if (mode === "custom" || (mode === "blips" && config.voice.blips.preset === "custom")) out.push({ type: "markdown", text: ctx.t(M.uploadSound(ctx.setting("voiceFile")) ? "voCustomReady" : "voCustomMissing"), tab: "voice" });
  return out;
}

async function saveVoiceMode(ctx, values) {
  const mode = M.VOICE_MODES.includes(values.mode) ? values.mode : "none";
  const config = await S.loadConfig(ctx);
  await S.saveConfig(ctx, { voice: { ...config.voice, mode } });
  return { ok: ctx.t("voModeSaved") };
}

async function saveVoice(ctx, values) {
  const config = await S.loadConfig(ctx);
  const vo = config.voice, errors = {};
  const raw = String(values.volume ?? "").trim();
  let volume = M.VOLUME[2];
  if (raw) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < M.VOLUME[0] || n > M.VOLUME[1]) errors.volume = ctx.t("errVolume", { min: M.VOLUME[0], max: M.VOLUME[1], example: M.VOLUME[2] });
    else volume = n;
  }
  const pick = (table, value, current) => (Object.hasOwn(table, value) ? value : current);
  const next = { ...vo, volume };
  if (vo.mode === "blips") {
    if (values.preset !== undefined && !M.BLIP_CHOICES.includes(values.preset)) errors.preset = ctx.t("errChoice");
    next.blips = { preset: M.BLIP_CHOICES.includes(values.preset) ? values.preset : vo.blips.preset, pitch: pick(M.PITCHES, values.pitch, vo.blips.pitch), rate: pick(M.BLIP_RATES, values.rate, vo.blips.rate), vary: pick(M.VARIATIONS, values.vary, vo.blips.vary) };
  } else if (vo.mode === "speech") {
    const lang = String(values.lang ?? "");
    if (lang && !ctx.locales.includes(lang)) errors.lang = ctx.t("errLang");
    const name = M.oneLine(values.vname, 200);
    if ([...name].length > 80) errors.vname = ctx.t("errVoName", { max: 80, example: ctx.t("voNameExample") });
    next.speech = { lang: lang && ctx.locales.includes(lang) ? lang : "", name: name.slice(0, 80), rate: pick(M.SPEECH_RATES, values.srate, vo.speech.rate), pitch: pick(M.SPEECH_PITCHES, values.spitch, vo.speech.pitch) };
  }
  if (Object.keys(errors).length) return { errors };
  await S.saveConfig(ctx, { voice: next });
  return { ok: ctx.t("voSaved") };
}

export const animActions = {
  saveAnim: { right: RIGHT, run: saveAnim },
  addFrame: { right: RIGHT, run: addFrame },
  frameUp: { right: RIGHT, run: (ctx, values) => frameMove(ctx, values, -1) },
  frameDown: { right: RIGHT, run: (ctx, values) => frameMove(ctx, values, 1) },
  frameRemove: { right: RIGHT, run: frameRemove },
  saveReading: { right: RIGHT, run: saveReading },
  saveVoiceMode: { right: RIGHT, run: saveVoiceMode },
  saveVoice: { right: RIGHT, run: saveVoice },
};
