// Alerts overlay 1.14.0 and Twitch activity 1.11.0: "Place the text" on VIDEOS (core 0.21.0). The service says when the core can place text on a video,
// Twitch activity then offers it in its window, an alert of a video with a placed text lasts as the composition says (the video's own length or a chosen
// one), the reaction's "Sound of the videos" still turns the sound on, and the page loads the next alert's backdrop ahead. With a core of 0.19.0 (no
// "video" feature) nothing of this shows. The fake context is the core's own (`ctx.overlay` is the real kit).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const DIR = new URL("../modules/alerts-overlay", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const tw = await import("../modules/alerts-overlay/twitch.mjs");
const mod = await import("../modules/alerts-overlay/index.mjs");
const cp = await import("../modules/alerts-overlay/compose.mjs");
const rxEvents = await import("../modules/twitch-events/reaction.mjs");
const def = mod.default;
const VIDEO = (fakeCtx({ key: "probe" }).overlay?.features ?? []).includes("video");
const U = (n, ext) => `/uploads/${String(n).padStart(8, "0")}-0123-4567-89ab-0123456789ab.${ext}`;
const PIC = U(1, "png"), VID = U(3, "webm"), VID2 = U(4, "webm");
let n = 0;
function world({ key = `vid${++n}`, settings = {}, items = [] } = {}) {
  const state = { items };
  tw.resetTwitchState(); cp.resetComposeCache();
  const ctx = fakeCtx({ key, locale: "en", messages: JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8")), settings: { pushToken: "secret", groupSeconds: 0, minGapSeconds: 0, ...settings }, instances: [{ id: "te", key: "events", module: "twitch-events", basePath: "", name: "Twitch activity", adminPath: "/admin/instances/te" }], uploads: [{ url: PIC, by: "u1" }, { url: VID, by: "u1" }, { url: VID2, by: "u1" }], topics: { "twitch.event": () => state.items.slice() }, permissions: manifest.permissions });
  return { key, ctx, state };
}
const R = () => mod.reactionService;   // (1.18.0) the former service `alerts.reaction`, now internal: same methods, same answers
const vcomp = (src, extra = {}) => ({ v: 1, backdrop: { src, play: "once" }, duration: { mode: "media", seconds: 9 }, boxes: [{ id: "t1" }], ...extra });
const item = (type, o = {}) => ({ id: `i${++n}`, type, at: new Date().toISOString(), name: "etoile_nord", login: "etoile_nord", ...o });
async function pull(w) {
  const sent = [];
  tw.resetTwitchState();
  await tw.pullTwitch(w.ctx, (a) => sent.push(a), { ...mod.twitchEnv(w.ctx), compose: cp.composerOf(w.ctx, await cp.allByKey(w.ctx)) });
  return sent;
}

test("alerts.reaction says when videos can carry text: core with the video feature only", { skip: VIDEO ? false : "core before 0.21.0" }, async () => {
  const w = world();
  assert.equal((await R().get(w.ctx, { type: "sub" })).composeVideo, true);
  // a core of 0.19.0: the kit without `features`
  const old = world();
  const { features, ...kit019 } = old.ctx.overlay;
  assert.ok(features);
  old.ctx.overlay = kit019;
  const got = await R().get(old.ctx, { type: "sub" });
  assert.equal(got.compose, true);
  assert.equal("composeVideo" in got, false);
});

test("Twitch activity offers Place the text on videos only when the overlay says so", () => {
  const ctx = fakeCtx({ key: "ev", locale: "fr", messages: JSON.parse(fs.readFileSync(new URL("../modules/twitch-events/locales/fr.json", import.meta.url), "utf8")) });
  assert.equal(rxEvents.composeOptionOf(ctx, "sub", { text: "", textDefault: "{name}", composeVideo: true }).video, true);
  assert.equal("video" in rxEvents.composeOptionOf(ctx, "sub", { text: "", textDefault: "{name}" }), false, "an overlay before 1.14.0: pictures only");
});

test("an alert of a video with placed text: the composition's length, the reaction's sound switch, the playback as placed", { skip: VIDEO ? false : "core before 0.21.0" }, async () => {
  const w = world();
  const set = await R().set(w.ctx, { type: "follow", patch: { variants: [VID], seconds: "4", compositions: { [VID]: vcomp(VID) } } });
  assert.equal(set.ok, true, JSON.stringify(set));
  w.state.items = [item("follow")];
  let [a] = await pull(w);
  assert.equal(a.video, VID);
  assert.equal(a.compose.backdrop.play, "once");
  assert.equal(a.duration, 9, "the video's own length (9 s), not the type's 4 s");
  assert.equal(a.compose.backdrop.sound, undefined, "muted unless asked");
  // the reaction's switch "Sound of the videos" still turns the sound on
  await R().set(w.ctx, { type: "follow", patch: { variants: [VID], videoSound: true } });
  w.state.items = [item("follow")];
  [a] = await pull(w);
  assert.equal(a.compose.backdrop.sound, true);
  // a chosen length
  await R().set(w.ctx, { type: "follow", patch: { variants: [VID], compositions: { [VID]: vcomp(VID, { backdrop: { src: VID, play: "hold" }, duration: { mode: "fixed", seconds: 15 } }) } } });
  w.state.items = [item("follow")];
  [a] = await pull(w);
  assert.equal(a.duration, 15); assert.equal(a.compose.backdrop.play, "hold");
  // a picture's composition without a length keeps the type's length, as before
  await R().set(w.ctx, { type: "follow", patch: { variants: [PIC], seconds: "5", compositions: { [PIC]: { v: 1, backdrop: { src: PIC }, boxes: [{ id: "t1" }] } } } });
  w.state.items = [item("follow")];
  [a] = await pull(w);
  assert.equal(a.duration, 5);
  // refused: a playback on a picture, "the video's own length" on a picture
  const bad = await R().set(w.ctx, { type: "follow", patch: { variants: [PIC], compositions: { [PIC]: { v: 1, backdrop: { src: PIC, play: "once" }, boxes: [{ id: "t1" }] } } } });
  assert.deepEqual(bad, { ok: false, errors: { variants: "compose" } });
});

test("the page loads the next alert's backdrop ahead, only when it holds compositions", { skip: VIDEO ? false : "core before 0.21.0" }, async () => {
  const w = world();
  const q = new URLSearchParams("ov-w=1280&ov-h=720&ov-fit=fluid&ov-lang=fr");
  const before = await def.overlay(w.ctx, { query: q });
  assert.doesNotMatch(before.script, /preload|ahead\(/);
  await R().set(w.ctx, { type: "follow", patch: { variants: [VID, VID2], compositions: { [VID]: vcomp(VID), [VID2]: vcomp(VID2) } } });
  const out = await def.overlay(w.ctx, { query: q });
  assert.match(out.script, /function ahead\(\)\{var n=q\[0\];if\(n&&n\.compose&&window\.CuriosaCompose&&window\.CuriosaCompose\.preload\)window\.CuriosaCompose\.preload\(n\.compose\)\}/);
  assert.match(out.script, /function next\(\)\{if\(!busy\)\{var e=q\.shift\(\);if\(e\)\{busy=true;draw\(e\)\}\}ahead\(\)\}/);
  assert.ok(out.script.includes("preload:preload") || out.script.includes("preload: preload"), "the core's engine has preload");
});
