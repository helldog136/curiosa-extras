// The reaction of an event type on screen (a GIF on a follow…), set from the Twitch events tab. (1.18.0) This was the module "Twitch activity", which read and wrote
// through the service `alerts.reaction` of the alerts overlay. Both live in the overlay now: `service(ctx, method, input)` calls the overlay's own reaction code
// (../reaction.mjs) with the SAME methods, inputs and answers as that service (so every window, test and reward works as before), without any service between them.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const es = await import(`./eventsub.mjs${v}`);
const home = await import(`./home.mjs${v}`);
const rxo = await import(new URL(`../reaction.mjs${v}`, import.meta.url).href);

export const MAX = 12;
export const WORDS = ["name", "count", "amount", "tier", "months", "viewers", "level", "title", "text", "total"];
/** (1.x, "Place the text") The automatic values each type offers in a placed text, shown as chips with an example (never with braces). */
export const TYPE_WORDS = { follow: ["name"], sub: ["name", "tier"], resub: ["name", "months", "tier", "text"], gift: ["name", "count", "tier", "total"], cheer: ["name", "amount", "text"], raid: ["name", "viewers"], online: ["title"], offline: [], hype: ["level", "total"], redeem: ["name", "title", "amount", "text"] };
const fillSample = (template, samples) => String(template ?? "").replace(/\{([^{}]*)\}/g, (_, w) => samples[w] ?? "");
export const OVERLAY_PAGES = "/admin/overlay-pages";

/** The reactions of this overlay, method by method, as the service `alerts.reaction` (version 3) answered them. */
export const methods = {
  list: (ctx) => rxo.list(ctx),
  get: (ctx, input) => rxo.get(ctx, String(input?.type ?? ""), input?.type === "redeem" && input?.reward ? String(input.reward) : ""),
  media: (ctx) => rxo.media(ctx),
  set: (ctx, input) => (input?.type === "redeem" && input?.reward ? rxo.setReward(ctx, String(input.reward), { title: input.title, cost: input.cost }, input?.patch ?? {}) : rxo.set(ctx, String(input?.type ?? ""), input?.patch ?? {})),
  test: (ctx, input) => rxo.test(ctx, String(input?.type ?? ""), input?.patch ?? {}, { sample: (c, id, cfg, extra) => home.sampler()(c, id, Date.now(), cfg, extra), emit: home.emitter(ctx), ...(input?.type === "redeem" && input?.reward ? { reward: String(input.reward), info: { title: input.title, cost: input.cost } } : {}) }),
  rewards: (ctx) => rxo.rewards(ctx),
  forget: (ctx, input) => rxo.forgetReward(ctx, String(input?.reward ?? "")),
};
/** { ok: true, value } or { ok: false, reason } — the shape of a service call, so the callers did not change. Never throws. */
export async function service(ctx, method, input = {}) {
  const fn = methods[method];
  if (!fn) return { ok: false, reason: "no_method" };
  try { return { ok: true, value: await fn(ctx, input) }; } catch (e) { console.error(`[alerts-overlay] reaction ${method} failed:`, e?.message); return { ok: false, reason: "failed" }; }
}
const call = async (ctx, method, args) => { const r = await service(ctx, method, args); return r.ok ? r.value : null; };
/** The summaries of every type: { follow: { images, videos, sound, pick }, … } or null. */
export async function summaries(ctx) {
  const r = await call(ctx, "list", {});
  return r?.types ? Object.fromEntries(r.types.map((x) => [x.type, x])) : null;
}

/** "GIF", "3 GIF · at random", "Video + sound", "Text": what a row says. */
export function summaryText(ctx, s) {
  const t = ctx.t, n = (s?.images ?? 0) + (s?.videos ?? 0);
  if (!s) return "—";
  let base = !n ? t("rx_sum_text") : s.videos && s.images ? t("rx_sum_media", { n }) : s.videos ? (s.videos === 1 ? t("rx_sum_video") : t("rx_sum_videos", { n })) : s.images === 1 ? t("rx_sum_gif") : t("rx_sum_gifs", { n });
  if (s.placed) base += `, ${s.placed === 1 ? t("rx_sum_placed_one") : t("rx_sum_placed", { n: s.placed })}`;
  if (s.pick) base += ` · ${t(`rx_pick_${s.pick}`)}`;
  return s.sound ? `${base} + ${t("rx_sum_sound")}` : base;
}

/** The sentence of an error code returned by the service, under the field it belongs to. */
export function errorsOf(ctx, errors = {}) {
  const t = ctx.t, out = {};
  const map = {
    variants: { limit: t("rx_err_limit", { max: MAX }), file: t("rx_err_file"), kept: t("rx_err_kept"), compose: t("rx_err_compose") },
    audio: { file: t("rx_err_audio"), kept: t("rx_err_kept") },
    text: { words: t("rx_err_words", { vars: WORDS.map((w) => `{${w}}`).join(" ") }), long: t("rx_err_long") },
    seconds: { range: t("rx_err_seconds") }, sound: { choice: t("rx_err_choice") }, pick: { choice: t("rx_err_choice") },
    min: { range: t("rx_err_min") }, anim: { choice: t("rx_err_choice") }, tts: { choice: t("rx_err_choice") }, viewerMax: { range: t("rx_err_viewer_max") },
  };
  for (const [field, code] of Object.entries(errors)) out[field] = map[field]?.[code] ?? t("rx_err_choice");
  return out;
}

/** The files of the window, read from the form with care: the core has already checked the list, but a form is never trusted. */
export function patchOf(values) {
  let list = [];
  try { const p = JSON.parse(String(values.variants ?? "[]")); list = Array.isArray(p) ? p : []; } catch { list = []; }
  const variants = list.map((x) => ({ src: String(typeof x === "string" ? x : x?.src ?? "") })).filter((x) => /^\/uploads\/[0-9a-f-]{36}\.[a-z0-9]{3,4}$/.test(x.src)).slice(0, 60);
  const patch = { variants, pick: values.pick === "rotate" ? "rotate" : "random", text: String(values.text ?? ""), sound: String(values.sound ?? ""), audio: String(values.audio ?? ""), seconds: String(values.seconds ?? ""), videoSound: values.videoSound === "on" };
  // Placed texts: only when the core's window could place them (it says so with `variants__compose`); otherwise an older core sent none and nothing changes.
  if (values.variants__compose === "1") patch.compositions = Object.fromEntries(list.filter((x) => x && typeof x === "object").map((x) => [String(x.src ?? ""), x.compose && typeof x.compose === "object" ? x.compose : null]).filter(([src]) => variants.some((v) => v.src === src)));
  if (/^\/uploads\/[0-9a-f-]{36}\.[a-z0-9]{3,4}$/.test(String(values.variants__composeFor ?? ""))) patch.composeFor = String(values.variants__composeFor);
  // (1.10.0) The settings of version 2 of the service: only when the window showed them (`more`), so an older overlay never receives them.
  if (values.more === "2") {
    if (values.min !== undefined) patch.min = String(values.min ?? "");
    if (values.anim !== undefined) patch.anim = String(values.anim ?? "");
    if (values.tts !== undefined) patch.tts = String(values.tts ?? "");
    if (values.viewerMax !== undefined) { patch.viewer = values.viewer === "on"; patch.viewerMax = String(values.viewerMax ?? ""); }
  }
  return patch;
}

/** (1.12.0) The reward of a reaction window (hidden fields): { reward, title, cost }, null for a type, false for a value that is not a reward id. */
export function rewardOfForm(values, id) {
  const r = String(values.reward ?? "");
  if (!r) return null;
  if (id !== "redeem" || !es.REWARD_ID.test(r)) return false;
  const cost = Math.trunc(Number(values.rewardCost));
  return { reward: r, title: String(values.rewardTitle ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 45), cost: Number.isFinite(cost) && cost > 0 ? cost : 0 };
}

/** The `compose` option of the gallery ("Place the text"), for a type: its automatic values with an example, and the sentence as the editor shows it. */
export function composeOptionOf(ctx, id, cur, reward = null) {
  const t = ctx.t, words = TYPE_WORDS[id] ?? [];
  const samples = Object.fromEntries(WORDS.map((w) => [w, t(`rx_sample_${w}`)]));
  // (1.12.0) a reward's window: its own title and cost are the examples
  if (reward?.title) samples.title = reward.title;
  if (reward?.cost) samples.amount = new Intl.NumberFormat(ctx.locale).format(reward.cost);
  return {
    variables: words.map((w) => ({ token: w, label: t(`rx_var_${w}`), sample: samples[w] })),
    phrase: { label: t("rx_compose_phrase"), sample: fillSample(cur.text || cur.textDefault, samples).replace(/\s+/g, " ").trim() },
    formats: ["media", "16:9", "9:16", "1:1", "4:3", "21:9"], defaultFormat: "media", maxBoxes: 4, testAction: "testReaction",
    // (1.12.0, core 0.27.0) the preview under the files follows the sentence as it is typed (an older core ignores the key)
    phraseField: "text",
    // (1.11.0) videos too, when the overlay plays them as the core's editor says (Alerts overlay 1.14.0 on core 0.21.0)
    ...(cur.composeVideo === true ? { video: true } : {}),
  };
}

/** The window of one type. `null` when the type is unknown or the overlay does not answer. */
export async function dialog(ctx, id, { reward = null } = {}) {
  const t = ctx.t;
  if (!es.typeOf(id)) return null;
  // (1.12.0) the window of ONE reward (`reward`: { id, title, cost }), from the Rewards tab; the type `redeem` alone is "all the other rewards"
  const own = id === "redeem" && reward?.id ? reward : null;
  const [cur, media] = await Promise.all([call(ctx, "get", { type: id, ...(own ? { reward: own.id } : {}) }), call(ctx, "media", {})]);
  if (!cur?.ok || (own && cur.reward !== own.id)) return null;
  const sounds = ["", ...(media?.tones ?? [])];
  const tab = reward ? "rewards" : "twitch";
  const title = own ? t("rx_title_reward", { reward: own.title }) : id === "redeem" ? t("rx_title_others") : t("rx_title", { type: t(`type_${id}`) });
  return {
    type: "adminForm", tab, presentation: "dialog", action: "saveReaction", cancelHref: `?tab=${tab}`, title, submitLabel: t("rx_save_btn"),
    extraActions: [{ label: t("rx_test_btn"), action: "testReaction" }],
    fields: [
      { name: "id", kind: "hidden", label: "id", value: id },
      ...(own ? [{ name: "reward", kind: "hidden", label: "reward", value: own.id }, { name: "rewardTitle", kind: "hidden", label: "rewardTitle", value: own.title }, { name: "rewardCost", kind: "hidden", label: "rewardCost", value: String(own.cost ?? 0) }] : []),
      { name: "variants", kind: "gallery", accept: ["image", "video"], max: cur.max ?? MAX, label: t("rx_f_files"), help: t("rx_f_files_help"), value: JSON.stringify((cur.variants ?? []).map((x) => ({ src: x.src, ...(cur.compositions?.[x.src] ? { compose: cur.compositions[x.src] } : {}) }))), library: (media?.pictures ?? []).slice(0, 500),
        // "Place the text" on the pictures (core 0.19.0; an older core ignores the key): only when the alerts overlay can keep placed texts
        ...(cur.compose === true ? { compose: composeOptionOf(ctx, id, cur, own) } : {}) },
      { name: "pick", kind: "segmented", label: t("rx_f_pick"), help: t("rx_f_pick_help"), value: cur.pick === "rotate" ? "rotate" : "random", options: [{ value: "random", label: t("rx_pick_random") }, { value: "rotate", label: t("rx_pick_rotate") }] },
      { name: "text", folded: true, label: t("rx_f_text"), value: cur.text ?? "", placeholder: cur.textDefault ?? "", example: cur.textDefault ?? "", help: t("rx_f_text_help") },
      { name: "sound", kind: "select", folded: true, label: t("rx_f_sound"), value: cur.sound ?? "", options: sounds.map((x) => ({ value: x, label: x ? t(`rx_tone_${x}`) : t("rx_sound_none") })) },
      { name: "audio", kind: "audio", folded: true, label: t("rx_f_audio"), value: cur.audio ?? "", help: t("rx_f_audio_help") },
      { name: "seconds", kind: "number", folded: true, label: t("rx_f_seconds"), min: 2, max: 60, step: 1, unit: t("rx_unit_seconds"), value: cur.seconds || "", placeholder: t("rx_f_seconds_default") },
      { name: "videoSound", kind: "switch", folded: true, label: t("rx_f_video_sound"), value: cur.videoSound ? "on" : "" },
      ...moreFields(ctx, id, cur),
    ],
  };
}

/**
 * (1.10.0) What only the "Twitch events" tab of the alerts overlay used to edit (minimum, animation, voice, viewer text): here when the overlay offers version 2 of the service,
 * so this window is the only editor of a type. All folded (R7). An older overlay gives none of it: nothing is shown and nothing is sent.
 */
export function moreFields(ctx, id, cur) {
  if (!(Number(cur?.version) >= 2)) return [];
  const t = ctx.t, out = [{ name: "more", kind: "hidden", label: "more", value: "2" }];
  if (cur.min !== null && cur.min !== undefined) out.push({ name: "min", kind: "number", folded: true, label: t(`rx_f_min_${id}`), min: 0, max: cur.minMax ?? 1000000, step: 1, value: cur.min || "", placeholder: t("rx_f_min_default"), help: t("rx_f_min_help") });
  const anims = (Array.isArray(cur.anims) ? cur.anims : []).filter((x) => ANIMS.includes(x));
  if (anims.length) out.push({ name: "anim", kind: "select", folded: true, label: t("rx_f_anim"), value: anims.includes(cur.anim) ? cur.anim : "", options: anims.map((x) => ({ value: x, label: t(`rx_anim_${x || "module"}`) })) });
  const modes = (Array.isArray(cur.ttsModes) ? cur.ttsModes : []).filter((x) => TTS.includes(x));
  // "off" is the empty choice: the folded panel stays shut until something is chosen
  if (modes.length) out.push({ name: "tts", kind: "select", folded: true, label: t("rx_f_tts"), value: cur.tts === "off" ? "" : cur.tts ?? "", options: modes.map((x) => ({ value: x === "off" ? "" : x, label: t(`rx_tts_${x}`) })), help: t("rx_f_tts_help") });
  if (cur.viewer !== null && cur.viewer !== undefined) {
    const [lo, hi] = Array.isArray(cur.viewerMaxLimits) ? cur.viewerMaxLimits : [20, 250];
    out.push({ name: "viewer", kind: "switch", folded: true, label: t("rx_f_viewer"), value: cur.viewer ? "on" : "", help: t("rx_f_viewer_help") },
      { name: "viewerMax", kind: "number", folded: true, label: t("rx_f_viewer_max"), min: lo, max: hi, step: 1, unit: t("rx_unit_chars"), value: cur.viewerMax === 140 ? "" : cur.viewerMax ?? "", placeholder: t("rx_f_viewer_max_default") });
  }
  return out;
}
/** The animations and voice modes this window has words for; a value the overlay adds later is simply not offered here. */
export const ANIMS = ["", "slide", "slideLeft", "slideRight", "slideTop", "slideBottom", "fade", "jiggle", "pop", "none"];
export const TTS = ["off", "sentence", "text", "both"];

export const actions = {
  /** Saves (the person of the action is carried, so the overlay keeps the new files). */
  async saveReaction(ctx, values) {
    const id = String(values.id ?? "");
    if (!es.typeOf(id)) return { error: ctx.t("err_unknown_type") };
    const rw = rewardOfForm(values, id);
    if (rw === false) return { error: ctx.t("rw_err_unknown") };
    const r = await service(ctx, "set", { type: id, patch: patchOf(values), ...(rw ?? {}) });
    if (!r?.ok) return { error: ctx.t("rx_err_unavailable") };
    if (!r.value?.ok) return r.value?.errors ? { errors: errorsOf(ctx, r.value.errors) } : { error: ctx.t(r.value?.code === "full" ? "rw_err_full" : "err_unknown_type") };
    return { ok: rw ? ctx.t("rw_saved", { reward: rw.title || rw.reward }) : ctx.t("rx_saved", { type: ctx.t(`type_${id}`) }) };
  },
  /** Tests what is typed in the window, saved or not: the overlay builds the alert through the same path as "Send a test". */
  async testReaction(ctx, values) {
    const id = String(values.id ?? "");
    if (!es.typeOf(id)) return { error: ctx.t("err_unknown_type") };
    const rw = rewardOfForm(values, id);
    if (rw === false) return { error: ctx.t("rw_err_unknown") };
    const r = await service(ctx, "test", { type: id, patch: patchOf(values), ...(rw ?? {}) });
    if (!r?.ok) return { error: ctx.t("rx_err_unavailable") };
    if (!r.value?.ok) return r.value?.errors ? { errors: errorsOf(ctx, r.value.errors) } : { error: ctx.t("err_unknown_type") };
    return { ok: ctx.t("rx_test_ok") };
  },
};

