// The service `alerts.reaction` (1.9.0): what an event type of Twitch activity shows on screen, read and changed by another module (Twitch activity) without it ever holding a file.
// ONE source of truth: the per-type settings of this module (twitch.mjs). A saved single picture is simply a list of one; nothing is migrated.
// The files stay owned by this overlay: `set` is listed in `callerRights`, so `files.claim` receives the person who just uploaded them (core 0.14.0).
// Errors are CODES per field ({ errors: { variants: "limit" } }): the caller writes the sentence in its own words and languages.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const tw = await import(new URL(`./twitch.mjs${v}`, import.meta.url).href);
const md = await import(new URL(`./media.mjs${v}`, import.meta.url).href);

export const LIMITS = { variants: tw.VARIANT_MAX };
const srcOf = (x) => String(typeof x === "string" ? x : x?.src ?? "").trim().replace(/\?.*$/, "");

/** The pictures and videos of a type, as a list (a single legacy picture is a list of one; a legacy video slot is read through the settings). */
export function variantsOf(cfg, videos = []) {
  if (cfg.variants?.length) return cfg.variants.slice();
  if (cfg.present === "gif" && cfg.image) return [cfg.image];
  if (cfg.present === "video" && cfg.video && videos[cfg.video - 1]) return [videos[cfg.video - 1]];
  return [];
}
/** What a row of the table says: how many pictures and videos, whether there is a sound, the rule when there are several. */
export function summaryOf(cfg, videos = []) {
  const list = variantsOf(cfg, videos);
  const clips = list.filter((u) => tw.VIDEO_RE.test(u)).length;
  return { images: list.length - clips, videos: clips, sound: !!(cfg.audio || (cfg.sound && cfg.sound !== "none")), pick: list.length > 1 ? cfg.pick ?? "random" : null, hasText: !!cfg.template };
}

export async function list(ctx) {
  const cfg = await tw.loadConfig(ctx), videos = tw.videosOf(ctx.setting);
  return { types: tw.TYPES.map((id) => ({ type: id, enabled: cfg.types[id].on, ...summaryOf(cfg.types[id], videos) })), max: LIMITS.variants };
}
/** One type, for its window. `editPath` is where this overlay's own page is (for a link back). */
export async function get(ctx, type) {
  if (!tw.TYPES.includes(type)) return { ok: false, code: "type" };
  const cfg = await tw.loadConfig(ctx), c = cfg.types[type], videos = tw.videosOf(ctx.setting);
  return {
    ok: true, type, max: LIMITS.variants, words: tw.VARS, variants: variantsOf(c, videos).filter((u) => !(c.present === "video" && !c.variants?.length)).map((src) => ({ src })), legacyVideo: c.present === "video" && !c.variants?.length && !!c.video,
    pick: c.pick ?? "random", text: c.template, textDefault: ctx.t(`tw_text_${type}`), sound: c.sound === "none" ? "" : c.sound, audio: c.audio, seconds: c.seconds, videoSound: c.videoSound, ...summaryOf(c, videos), editPath: ctx.instance.basePath,
  };
}
/** What can be picked "from the site": the pictures and sounds of the Media tab, by name (the files this overlay already owns). */
export async function media(ctx) {
  const items = await md.list(ctx, { tones: false });
  return {
    pictures: items.filter((m) => m.kind === "picture").map((m) => ({ label: m.name, value: m.url, kind: "image" })),
    sounds: items.filter((m) => m.kind === "sound").map((m) => ({ label: m.name, value: m.url, kind: "audio" })),
    tones: tw.SOUNDS.filter((x) => x !== "none"),
  };
}

/** Checks a patch against the type. Returns { next } (the new settings of the type, nothing saved, no file touched) or { errors }. */
export function validate(ctx, type, patch, cur) {
  const errors = {}, next = { ...cur };
  if (patch.text !== undefined) {
    const text = String(patch.text ?? "").trim();
    if (tw.unknownWords(text).length) errors.text = "words"; else if (text.length > tw.LIMITS.template) errors.text = "long"; else next.template = text;
  }
  if (patch.pick !== undefined) { if (tw.PICK.includes(patch.pick)) next.pick = patch.pick; else errors.pick = "choice"; }
  if (patch.sound !== undefined) { const s = patch.sound === "" ? "none" : patch.sound; if (tw.SOUNDS.includes(s)) next.sound = s; else errors.sound = "choice"; }
  if (patch.audio !== undefined) { const a = srcOf(patch.audio); if (a === "" || tw.AUDIO_RE.test(a)) next.audio = a; else errors.audio = "file"; }
  if (patch.seconds !== undefined) {
    const raw = String(patch.seconds ?? "").trim(), n = raw === "" ? 0 : Number(raw);
    if (n !== 0 && (!Number.isInteger(n) || n < tw.LIMITS.seconds.min || n > tw.LIMITS.seconds.max)) errors.seconds = "range"; else next.seconds = n;
  }
  if (patch.videoSound !== undefined) next.videoSound = patch.videoSound === true;
  if (patch.variants !== undefined) {
    const raw = Array.isArray(patch.variants) ? patch.variants : [];
    const urls = [...new Set(raw.map(srcOf).filter(Boolean))];
    if (urls.length > LIMITS.variants) errors.variants = "limit";
    else if (urls.some((u) => !(tw.IMAGE_RE.test(u) || tw.VIDEO_RE.test(u)))) errors.variants = "file";
    else {
      const clips = urls.filter((u) => tw.VIDEO_RE.test(u)), pics = urls.filter((u) => !tw.VIDEO_RE.test(u));
      if (!urls.length) {
        // text again; a picture that goes with the sentence in the older window is not touched
        if (cur.present !== "text") { next.image = ""; next.present = "text"; }
        next.video = 0; delete next.variants;
      } else if (urls.length === 1 && !clips.length) { next.image = pics[0]; next.present = "gif"; next.video = 0; delete next.variants; }
      else { next.variants = urls; next.present = clips.length && !pics.length ? "video" : "gif"; next.video = 0; next.image = pics[0] ?? ""; }
    }
  }
  return Object.keys(errors).length ? { errors } : { next };
}

/** Saves: validates, keeps the new files (claim, or already ours), saves, then lets go of what is no longer used. Returns { ok, summary } or { errors }. */
export async function set(ctx, type, patch) {
  if (!tw.TYPES.includes(type)) return { ok: false, code: "type" };
  const cfg = await tw.loadConfig(ctx), cur = cfg.types[type];
  const r = validate(ctx, type, patch ?? {}, cur);
  if (r.errors) return { ok: false, errors: r.errors };
  const had = new Set([cur.image, cur.audio, ...(cur.variants ?? [])].filter(Boolean));
  const want = [...new Set([r.next.image, r.next.audio, ...(r.next.variants ?? [])].filter(Boolean))].filter((u) => !had.has(u));
  const errors = {};
  for (const u of want) {
    const claim = typeof ctx.api.files?.claim === "function" ? await ctx.api.files.claim(u) : { ok: false };
    if (!claim.ok && !(await ctx.api.files?.owns?.(u))) errors[tw.AUDIO_RE.test(u) ? "audio" : "variants"] = "kept";
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const picks = stateOf(ctx).picks;
  delete picks[type];   // the turn starts again when the list changes
  await tw.saveConfig(ctx, { ...cfg, preset: patch.text !== undefined ? "" : cfg.preset, types: { ...cfg.types, [type]: r.next } });
  const now = new Set([r.next.image, r.next.audio, ...(r.next.variants ?? [])].filter(Boolean));
  for (const u of had) if (!now.has(u)) await tw.releaseFile(ctx, u);
  return { ok: true, ...summaryOf(r.next, tw.videosOf(ctx.setting)) };
}
const stateOf = (ctx) => tw.stateOf(ctx);

/** A test alert of this type with the patch applied IN MEMORY (nothing saved, no file claimed): `sample(type, config)` builds it through the real path, `emit` shows it. */
export async function test(ctx, type, patch, { sample, emit }) {
  if (!tw.TYPES.includes(type)) return { ok: false, code: "type" };
  const cfg = await tw.loadConfig(ctx);
  let types = cfg.types;
  if (patch && Object.keys(patch).length) {
    const r = validate(ctx, type, patch, cfg.types[type]);
    if (r.errors) return { ok: false, errors: r.errors };
    types = { ...cfg.types, [type]: r.next };
  }
  const a = await sample(ctx, type, { ...cfg, types });
  if (!a) return { ok: false, code: "type" };
  emit(a);
  return { ok: true };
}
