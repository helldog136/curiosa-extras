// The reaction of an event type on screen (a GIF on a follow…), set from the Types tab. Everything is READ and WRITTEN through the service `alerts.reaction` of the alerts overlay:
// it owns the settings, the files, the sounds and the queue; this module never imports it and holds no file. Without it (not installed, no copy, too old) the column says so once.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const es = await import(`./eventsub.mjs${v}`);

export const SERVICE = "alerts.reaction";
export const MAX = 12;
export const WORDS = ["name", "count", "amount", "tier", "months", "viewers", "level", "title", "text", "total"];
export const CATALOGUE = "/admin/catalogue";

/** Where the alerts overlay stands: { state: "ready" | "old" | "absent", adminPath }. `old`: a copy exists but does not offer the service yet (update it). */
export async function alertsState(ctx) {
  let providers = [];
  try { providers = await ctx.api.services.providers(SERVICE); } catch { providers = []; }
  let copy = null;
  try { copy = (await ctx.api.instances.list({ module: "alerts-overlay" }))?.[0] ?? null; } catch { copy = null; }
  if (providers.length) return { state: "ready", adminPath: copy?.adminPath ?? CATALOGUE };
  return { state: copy ? "old" : "absent", adminPath: copy?.adminPath ?? CATALOGUE };
}
const call = async (ctx, method, args, opts) => {
  try { const r = await ctx.api.services.call(SERVICE, method, args, opts); return r?.ok ? r.value : null; } catch { return null; }
};
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
  if (s.pick) base += ` · ${t(`rx_pick_${s.pick}`)}`;
  return s.sound ? `${base} + ${t("rx_sum_sound")}` : base;
}

/** The sentence of an error code returned by the service, under the field it belongs to. */
export function errorsOf(ctx, errors = {}) {
  const t = ctx.t, out = {};
  const map = {
    variants: { limit: t("rx_err_limit", { max: MAX }), file: t("rx_err_file"), kept: t("rx_err_kept") },
    audio: { file: t("rx_err_audio"), kept: t("rx_err_kept") },
    text: { words: t("rx_err_words", { vars: WORDS.map((w) => `{${w}}`).join(" ") }), long: t("rx_err_long") },
    seconds: { range: t("rx_err_seconds") }, sound: { choice: t("rx_err_choice") }, pick: { choice: t("rx_err_choice") },
  };
  for (const [field, code] of Object.entries(errors)) out[field] = map[field]?.[code] ?? t("rx_err_choice");
  return out;
}

/** The files of the window, read from the form with care: the core has already checked the list, but a form is never trusted. */
export function patchOf(values) {
  let list = [];
  try { const p = JSON.parse(String(values.variants ?? "[]")); list = Array.isArray(p) ? p : []; } catch { list = []; }
  const variants = list.map((x) => ({ src: String(typeof x === "string" ? x : x?.src ?? "") })).filter((x) => /^\/uploads\/[0-9a-f-]{36}\.[a-z0-9]{3,4}$/.test(x.src)).slice(0, 60);
  return { variants, pick: values.pick === "rotate" ? "rotate" : "random", text: String(values.text ?? ""), sound: String(values.sound ?? ""), audio: String(values.audio ?? ""), seconds: String(values.seconds ?? ""), videoSound: values.videoSound === "on" };
}

/** The window of one type. `null` when the type is unknown or the overlay does not answer. */
export async function dialog(ctx, id, { query } = {}) {
  const t = ctx.t;
  if (!es.typeOf(id)) return null;
  const [cur, media] = await Promise.all([call(ctx, "get", { type: id }), call(ctx, "media", {})]);
  if (!cur?.ok) return null;
  const sounds = ["", ...(media?.tones ?? [])];
  return {
    type: "adminForm", tab: "types", presentation: "dialog", action: "saveReaction", cancelHref: "?tab=types", title: t("rx_title", { type: t(`type_${id}`) }), submitLabel: t("rx_save_btn"),
    extraActions: [{ label: t("rx_test_btn"), action: "testReaction" }],
    fields: [
      { name: "id", kind: "hidden", label: "id", value: id },
      { name: "variants", kind: "gallery", accept: ["image", "video"], max: cur.max ?? MAX, label: t("rx_f_files"), help: t("rx_f_files_help"), value: JSON.stringify((cur.variants ?? []).map((x) => ({ src: x.src }))), library: (media?.pictures ?? []).slice(0, 500) },
      { name: "pick", kind: "segmented", label: t("rx_f_pick"), help: t("rx_f_pick_help"), value: cur.pick === "rotate" ? "rotate" : "random", options: [{ value: "random", label: t("rx_pick_random") }, { value: "rotate", label: t("rx_pick_rotate") }] },
      { name: "text", folded: true, label: t("rx_f_text"), value: cur.text ?? "", placeholder: cur.textDefault ?? "", example: cur.textDefault ?? "", help: t("rx_f_text_help") },
      { name: "sound", kind: "select", folded: true, label: t("rx_f_sound"), value: cur.sound ?? "", options: sounds.map((x) => ({ value: x, label: x ? t(`rx_tone_${x}`) : t("rx_sound_none") })) },
      { name: "audio", kind: "audio", folded: true, label: t("rx_f_audio"), value: cur.audio ?? "", help: t("rx_f_audio_help") },
      { name: "seconds", kind: "number", folded: true, label: t("rx_f_seconds"), min: 2, max: 60, step: 1, unit: t("rx_unit_seconds"), value: cur.seconds || "", placeholder: t("rx_f_seconds_default") },
      { name: "videoSound", kind: "switch", folded: true, label: t("rx_f_video_sound"), value: cur.videoSound ? "on" : "" },
    ],
  };
}

export const actions = {
  /** Saves through the service, carrying the person so the overlay keeps the new files. */
  async saveReaction(ctx, values) {
    const id = String(values.id ?? "");
    if (!es.typeOf(id)) return { error: ctx.t("err_unknown_type") };
    const r = await ctx.api.services.call(SERVICE, "set", { type: id, patch: patchOf(values) }, { asCaller: true });
    if (!r?.ok) return { error: ctx.t("rx_err_unavailable") };
    if (!r.value?.ok) return r.value?.errors ? { errors: errorsOf(ctx, r.value.errors) } : { error: ctx.t("err_unknown_type") };
    return { ok: ctx.t("rx_saved", { type: ctx.t(`type_${id}`) }) };
  },
  /** Tests what is typed in the window, saved or not: the overlay builds the alert through the same path as "Send a test". */
  async testReaction(ctx, values) {
    const id = String(values.id ?? "");
    if (!es.typeOf(id)) return { error: ctx.t("err_unknown_type") };
    const r = await ctx.api.services.call(SERVICE, "test", { type: id, patch: patchOf(values) });
    if (!r?.ok) return { error: ctx.t("rx_err_unavailable") };
    if (!r.value?.ok) return r.value?.errors ? { errors: errorsOf(ctx, r.value.errors) } : { error: ctx.t("err_unknown_type") };
    return { ok: ctx.t("rx_test_ok") };
  },
};

/** What the first tab says about the way to the screen: the steps and where each one stands (null when all is in place). Whether the element sits in an overlay page cannot be read from here: no step for it. */
export async function checklist(ctx, { authorized, listening, authorizeHref }) {
  const a = await alertsState(ctx), t = ctx.t, added = a.state !== "absent";
  if (authorized && listening && added) return null;
  const done = (ok) => ({ text: ok ? t("cl_done") : t("cl_todo"), badge: ok ? "ok" : "warn" });
  return { type: "table", columns: [t("cl_col_step"), t("cl_col_state"), t("cl_col_action")], pageSize: 0, truncate: [0], rowIds: ["authorized", "listening", "overlay"],
    rows: [
      [t("cl_authorized"), done(authorized), !authorized && authorizeHref ? { text: t("cl_authorize_link"), href: authorizeHref } : ""],
      [t("cl_listening"), done(listening), ""],
      [t("cl_overlay"), done(added), added ? "" : { text: t("cl_add_link"), href: CATALOGUE }],
    ] };
}
