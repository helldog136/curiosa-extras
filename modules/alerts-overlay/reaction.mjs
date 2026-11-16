// The service `alerts.reaction` (1.9.0): what an event type of Twitch activity shows on screen, read and changed by another module (Twitch activity) without it ever holding a file.
// ONE source of truth: the per-type settings of this module (twitch.mjs). A saved single picture is simply a list of one; nothing is migrated.
// The files stay owned by this overlay: `set` is listed in `callerRights`, so `files.claim` receives the person who just uploaded them (core 0.14.0).
// Errors are CODES per field ({ errors: { variants: "limit" } }): the caller writes the sentence in its own words and languages.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const tw = await import(new URL(`./twitch.mjs${v}`, import.meta.url).href);
const md = await import(new URL(`./media.mjs${v}`, import.meta.url).href);
const cp = await import(new URL(`./compose.mjs${v}`, import.meta.url).href);
const rw = await import(new URL(`./rewards.mjs${v}`, import.meta.url).href);
// (1.12.0, additive) `get` also gives `compose` (whether the core can place text), `compositions` ({ [src]: composition }) and `words`; `set` and `test` take
// `patch.compositions` ({ [src]: composition | null }, only when the window could place text) and `test` takes `patch.composeFor` (the file to show).
// A caller that sends no `compositions` changes none (an older Twitch activity keeps every placed text); a file taken out of the list loses its text.
// (1.13.0, version 2, additive) `get` also gives what only the "Twitch events" tab used to edit: the minimum, the animation, what is read aloud and the viewer text
// (`min`, `anim`, `tts`, `viewer`, `viewerMax`, with their choices and bounds); `set` and `test` take them in `patch`. A version 1 caller sends none of them and changes none.
// With an editor of the reactions active (service `alerts.reaction.editor`, Twitch activity 1.10.0), the "Twitch events" tab shows a summary and links there: one editor per type.
// (1.17.0, version 3, additive) A reaction PER channel point reward: `get`, `set` and `test` of the type `redeem` take `reward` (the Twitch id) with `title` and `cost`
// (what the caller knows of it); `rewards` lists the rewards that have a row; `forget` removes one row (its files and its placed texts go too). Without `reward`, the
// type `redeem` is "all the other rewards", exactly as before. A reward's row without its own reaction (`cfg` null) only holds its switch.

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
  const placed = cp.available(ctx) ? await Promise.all(tw.TYPES.map(async (id) => Object.keys(await cp.forPlace(ctx, `event:${id}`)).length)) : [];
  const own = [...(await rw.byId(ctx)).values()].filter((r) => r.cfg).length;
  return { types: tw.TYPES.map((id, i) => ({ type: id, enabled: cfg.types[id].on, ...summaryOf(cfg.types[id], videos), ...(placed[i] ? { placed: placed[i] } : {}), ...(id === "redeem" && own ? { rewards: own } : {}) })), max: LIMITS.variants };
}
/** One type, for its window. `editPath` is where this overlay's own page is (for a link back). */
export async function get(ctx, type, reward = "") {
  if (!tw.TYPES.includes(type)) return { ok: false, code: "type" };
  if (reward) return getReward(ctx, reward);
  const cfg = await tw.loadConfig(ctx), c = cfg.types[type], videos = tw.videosOf(ctx.setting);
  return {
    ok: true, type, max: LIMITS.variants, words: tw.VARS, variants: variantsOf(c, videos).filter((u) => !(c.present === "video" && !c.variants?.length)).map((src) => ({ src })), legacyVideo: c.present === "video" && !c.variants?.length && !!c.video,
    pick: c.pick ?? "random", text: c.template, textDefault: ctx.t(`tw_text_${type}`), sound: c.sound === "none" ? "" : c.sound, audio: c.audio, seconds: c.seconds, videoSound: c.videoSound, ...summaryOf(c, videos), editPath: ctx.instance.basePath,
    compose: cp.available(ctx), ...(cp.videoReady(ctx) ? { composeVideo: true } : {}), compositions: cp.available(ctx) ? await cp.forPlace(ctx, `event:${type}`) : {},
    ...moreOf(ctx, type, c),
  };
}
/** (version 2) The settings of a type that only the "Twitch events" tab of this overlay used to edit, with their choices and bounds. */
export function moreOf(ctx, type, c) {
  return {
    version: 2,
    min: tw.MINIMUM[type] ? c.min || 0 : null, minMax: tw.LIMITS.min,
    anim: c.anim ?? "", anims: tw.ANIMS.slice(),
    tts: c.tts ?? "off", ttsModes: tw.TTS_MODES.slice(),
    viewer: tw.VIEWER_TYPES.includes(type) ? (c.viewer === null || c.viewer === undefined ? ctx.setting("twitchText") === true : c.viewer === true) : null,
    viewerMax: tw.VIEWER_TYPES.includes(type) ? c.viewerMax ?? 140 : null, viewerMaxLimits: tw.TTS_LIMITS.viewerMax.slice(),
  };
}
/* ───────────── (version 3) One reaction per reward ───────────── */

/** Where a reward's own reaction starts: the voice and viewer-text choices of the type, but no file, no sound, the sentence of the type, the usual length. */
const freshStart = (cfg) => ({ ...cfg.types.redeem, variants: undefined, pick: "random", image: "", audio: "", present: "text", video: 0, sound: "none", template: "", seconds: 0, min: 0 });

/** The reaction of one reward, for its window: its own settings, or a fresh start (no file, the sentence of the type) when it has none yet. */
export async function getReward(ctx, rid) {
  if (!rw.validId(rid)) return { ok: false, code: "reward" };
  const row = await rw.one(ctx, rid), cfg = await tw.loadConfig(ctx), base = row?.cfg ?? freshStart(cfg);
  const c = rw.normalCfg(base), videos = tw.videosOf(ctx.setting), place = tw.rewardPlace(rid);
  return {
    ok: true, type: "redeem", reward: rid, title: row?.title ?? "", cost: row?.cost ?? 0, own: !!row?.cfg, on: row ? row.on : true, max: LIMITS.variants, words: tw.VARS,
    variants: variantsOf(c, videos).map((src) => ({ src })), legacyVideo: false, pick: c.pick ?? "random", text: c.template, textDefault: ctx.t("tw_text_redeem"), sound: c.sound === "none" ? "" : c.sound, audio: c.audio,
    seconds: c.seconds, videoSound: c.videoSound, ...summaryOf(c, videos), editPath: ctx.instance.basePath,
    compose: cp.available(ctx), ...(cp.videoReady(ctx) ? { composeVideo: true } : {}), compositions: cp.available(ctx) ? await cp.forPlace(ctx, place) : {}, ...moreOf(ctx, "redeem", c),
  };
}
/** The rewards that have a row: [{ reward, title, cost, on, own, images, videos, sound, pick, placed }]; and the switch of all the other rewards. */
export async function rewards(ctx) {
  const rows = [...(await rw.byId(ctx)).values()], videos = tw.videosOf(ctx.setting), cfg = await tw.loadConfig(ctx);
  const out = await Promise.all(rows.map(async (r) => ({ reward: r.rid, title: r.title, cost: r.cost, on: r.on, own: !!r.cfg, ...(r.cfg ? summaryOf(r.cfg, videos) : {}), ...(r.cfg && cp.available(ctx) ? { placed: Object.keys(await cp.forPlace(ctx, tw.rewardPlace(r.rid))).length } : {}) })));
  return { rewards: out, others: { on: cfg.types.redeem.on, ...summaryOf(cfg.types.redeem, videos) }, max: rw.MAX };
}
/** Saves the reaction (or only the switch, `patch.on`) of one reward. Same checks, same keeping of files, same placed texts as a type. */
export async function setReward(ctx, rid, info, patch) {
  if (!rw.validId(rid)) return { ok: false, code: "reward" };
  const row = await rw.one(ctx, rid), keys = Object.keys(patch ?? {}).filter((k) => k !== "on");
  const meta = { ...(info?.title !== undefined ? { title: info.title } : {}), ...(info?.cost !== undefined ? { cost: info.cost } : {}) };
  if (!keys.length) {
    const r = await rw.put(ctx, rid, { ...meta, ...(patch?.on !== undefined ? { on: patch.on === true } : {}) });
    return r ? { ok: true, on: r.on, own: !!r.cfg } : { ok: false, code: "full" };
  }
  const cur = rw.normalCfg(row?.cfg ?? freshStart(await tw.loadConfig(ctx)));
  const r = validate(ctx, "redeem", patch, cur);
  if (r.errors) return { ok: false, errors: r.errors };
  const place = tw.rewardPlace(rid), files = variantsOf(r.next, tw.videosOf(ctx.setting));
  let placed = {};
  if (patch?.compositions && typeof patch.compositions === "object" && cp.available(ctx)) {
    const c = cp.check(ctx, patch.compositions, { files, variables: tw.VARS });
    if (!c.ok) return { ok: false, errors: { variants: "compose" } };
    placed = c.value;
  }
  const had = new Set(row?.cfg ? [row.cfg.image, row.cfg.audio, ...(row.cfg.variants ?? [])].filter(Boolean) : []);
  const errors = {};
  for (const u of [...new Set([r.next.image, r.next.audio, ...(r.next.variants ?? [])].filter(Boolean))].filter((x) => !had.has(x))) {
    if (await ctx.api.files?.owns?.(u)) continue;
    const claim = typeof ctx.api.files?.claim === "function" ? await ctx.api.files.claim(u) : { ok: false };
    if (!claim.ok) errors[tw.AUDIO_RE.test(u) ? "audio" : "variants"] = "kept";
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const saved = await rw.put(ctx, rid, { ...meta, ...(patch?.on !== undefined ? { on: patch.on === true } : {}), cfg: r.next });
  if (!saved) return { ok: false, code: "full" };
  delete stateOf(ctx).picks[`redeem:${rid}`];
  const now = new Set([r.next.image, r.next.audio, ...(r.next.variants ?? [])].filter(Boolean));
  for (const u of had) if (!now.has(u)) await tw.releaseFile(ctx, u);
  await cp.save(ctx, place, placed, { files });
  return { ok: true, ...summaryOf(r.next, tw.videosOf(ctx.setting)), placed: Object.keys(await cp.forPlace(ctx, place)).length };
}
/** Removes the row of a reward: its reaction, its switch, its placed texts; its files go when nothing else uses them. The reward then shows the reaction of all the others. */
export async function forgetReward(ctx, rid) {
  if (!rw.validId(rid)) return { ok: false, code: "reward" };
  const cur = await rw.drop(ctx, rid);
  if (!cur) return { ok: true, removed: false };
  await cp.save(ctx, tw.rewardPlace(rid), {}, { files: [] });
  for (const u of cur.cfg ? [cur.cfg.image, cur.cfg.audio, ...(cur.cfg.variants ?? [])].filter(Boolean) : []) await tw.releaseFile(ctx, u);
  return { ok: true, removed: true };
}

/** What can be picked "from the site": the pictures and sounds of the Media tab, by name (the files this overlay already owns). */
export async function media(ctx) {
  const items = await md.list(ctx, { tones: false });
  return {
    pictures: items.filter((m) => m.kind === "picture" || m.kind === "video").map((m) => ({ label: m.name, value: m.url, kind: m.kind === "video" ? "video" : "image" })),
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
  if (patch.on !== undefined) next.on = patch.on === true;   // (version 3) the switch of the type (the Rewards tab's "all the other rewards")
  // (version 2) what only the "Twitch events" tab used to edit
  if (patch.min !== undefined && tw.MINIMUM[type]) {
    const raw = String(patch.min ?? "").trim(), n = raw === "" ? 0 : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > tw.LIMITS.min) errors.min = "range"; else next.min = n;
  }
  if (patch.anim !== undefined) { if (tw.ANIMS.includes(patch.anim)) next.anim = patch.anim; else errors.anim = "choice"; }
  if (patch.tts !== undefined) { const m = patch.tts === "" ? "off" : patch.tts; if (tw.TTS_MODES.includes(m)) next.tts = m; else errors.tts = "choice"; }
  if (patch.viewer !== undefined && tw.VIEWER_TYPES.includes(type)) next.viewer = patch.viewer === true;
  if (patch.viewerMax !== undefined && tw.VIEWER_TYPES.includes(type)) {
    const raw = String(patch.viewerMax ?? "").trim(), n = raw === "" ? 140 : Number(raw), [lo, hi] = tw.TTS_LIMITS.viewerMax;
    if (!Number.isInteger(n) || n < lo || n > hi) errors.viewerMax = "range"; else next.viewerMax = n;
  }
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
  // placed texts: checked against the files the type will have, before anything is saved
  const place = `event:${type}`, files = variantsOf(r.next, tw.videosOf(ctx.setting));
  let placed = {};
  if (patch?.compositions && typeof patch.compositions === "object" && cp.available(ctx)) {
    const c = cp.check(ctx, patch.compositions, { files, variables: tw.VARS });
    if (!c.ok) return { ok: false, errors: { variants: "compose" } };
    placed = c.value;
  }
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
  await cp.save(ctx, place, placed, { files });
  return { ok: true, ...summaryOf(r.next, tw.videosOf(ctx.setting)), placed: Object.keys(await cp.forPlace(ctx, place)).length };
}
const stateOf = (ctx) => tw.stateOf(ctx);

/** A test alert of this type with the patch applied IN MEMORY (nothing saved, no file claimed): `sample(type, config)` builds it through the real path, `emit` shows it. */
export async function test(ctx, type, patch, { sample, emit, reward = "", info = {} }) {
  if (!tw.TYPES.includes(type)) return { ok: false, code: "type" };
  if (reward && !rw.validId(reward)) return { ok: false, code: "reward" };
  const cfg = await tw.loadConfig(ctx);
  let types = cfg.types;
  // (version 3) a reward: its own reaction (saved, or the one of the window) stands in a copy of the rows, nothing is written
  const rows = new Map(await rw.byId(ctx)), row = reward ? rows.get(reward) ?? null : null;
  let own = reward ? row?.cfg ?? null : null;
  const base = reward ? rw.normalCfg(row?.cfg ?? freshStart(cfg)) : cfg.types[type];
  if (patch && Object.keys(patch).length) {
    const r = validate(ctx, type, patch, base);
    if (r.errors) return { ok: false, errors: r.errors };
    if (reward) own = r.next; else types = { ...cfg.types, [type]: r.next };
  }
  if (reward) rows.set(reward, { rid: reward, title: row?.title ?? "", cost: row?.cost ?? 0, on: true, cfg: own });
  const place = reward && own ? tw.rewardPlace(reward) : `event:${type}`;
  // the placed texts of the window (not saved) and the file it asks to see
  let extra = { ...(reward ? { rewards: rows, reward: { id: reward, title: String(info.title ?? row?.title ?? ""), cost: Number(info.cost ?? row?.cost) || 0 } } : {}) };
  if (cp.available(ctx) && patch && (patch.compositions || patch.composeFor)) {
    const files = variantsOf(reward && own ? own : types[type], tw.videosOf(ctx.setting));
    const c = cp.check(ctx, patch.compositions ?? {}, { files, variables: tw.VARS });
    if (!c.ok) return { ok: false, errors: { variants: "compose" } };
    const byKey = await cp.allByKey(ctx);
    for (const [src, comp] of Object.entries(c.value)) { if (comp) byKey.set(cp.keyOf(place, src), comp); else byKey.delete(cp.keyOf(place, src)); }
    const at = files.indexOf(String(patch.composeFor ?? ""));
    extra = { ...extra, compose: cp.composerOf(ctx, byKey), ...(at >= 0 ? { pick: () => at } : {}) };
  }
  const a = await sample(ctx, type, { ...cfg, types }, extra);
  if (!a) return { ok: false, code: "type" };
  emit(a);
  return { ok: true };
}
