// Alerts overlay 1.22.3: the clock of a placed text on a VIDEO backdrop is the video's own (`in.at` / `out.at` are seconds of video time), the length of the
// alert counts from the video's start, and a video played once is never cut before its end. The REAL page script runs against a fake engine and a fake video
// element whose readyState / currentTime / events the test controls. Pictures and GIFs keep the former behaviour exactly.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { runOverlayPage } from "./helpers/overlayPageDom.mjs";
import http from "node:http";
import { El } from "./helpers/remoteDom.mjs";

const DIR = new URL("../modules/alerts-overlay", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const tw = await import("../modules/alerts-overlay/twitch.mjs");
const cp = await import("../modules/alerts-overlay/compose.mjs");
const mod = await import("../modules/alerts-overlay/index.mjs");
const def = mod.default;
const R = () => mod.reactionService;
const VIDEO = (fakeCtx({ key: "probe" }).overlay?.features ?? []).includes("video");
const U = (n, ext) => `/uploads/${String(n).padStart(8, "0")}-0123-4567-89ab-0123456789ab.${ext}`;
const PIC = U(1, "png"), VID = U(3, "webm");
const HERE = [{ id: "te", key: "events", module: "twitch-events", basePath: "", name: "Twitch activity", adminPath: "/admin/instances/te" }];
const QUERY = () => new URLSearchParams("ov-w=1280&ov-h=720&ov-fit=fluid&ov-lang=en");
let n = 0;

function world(patch) {
  tw.resetTwitchState(); cp.resetComposeCache();
  const key = `vclk${++n}`;
  const ctx = fakeCtx({ key, locale: "en", messages: JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8")), settings: { pushToken: "secret", groupSeconds: 0, minGapSeconds: 0 }, instances: HERE, uploads: [{ url: PIC, by: "u1" }, { url: VID, by: "u1" }], topics: { "twitch.event": () => [] }, permissions: manifest.permissions });
  return { key, ctx, patch };
}

/** A fake engine: `mount` builds what the real one builds (a root, a backdrop, two boxes with a running CSS animation) and records it. */
function fakeEngine() {
  const mounted = [];
  const engine = {
    version: 1, features: ["video"], preload() { return true; }, unmount(root) { root.parent?.children.splice(root.parent.children.indexOf(root), 1); },
    mount(card, c, opts) {
      const doc = card.doc, root = new El("div", doc);
      root.setAttribute("data-ov-region", "composition");
      const isVideo = /\.(mp4|webm)$/.test(c.backdrop.src);
      const bg = new El(isVideo ? "video" : "img", doc);
      Object.assign(bg, { readyState: 0, networkState: 2, paused: true, currentTime: 0, duration: 12, error: null });
      root.appendChild(bg);
      const boxes = [0, 1].map(() => {
        const b = new El("div", doc); b.className = "cmp-box"; b.style = {};
        const anim = { currentTime: 0 }; b.anims = [anim]; b.getAnimations = () => b.anims; root.appendChild(b); return b;
      });
      card.appendChild(root);
      mounted.push({ root, bg, boxes, opts, c });
      return root;
    },
  };
  return { engine, mounted };
}

/** Runs the page with an alert of `src` (video or picture) and returns helpers to drive time and the video. `rel()` = ms since the card was drawn. */
async function scene({ src = VID, play = "once", seconds = 9, mode = "media", videoDuration = 12 } = {}) {
  const w = world();
  const set = await R().set(w.ctx, { type: "follow", patch: { variants: [src], seconds: "4", compositions: { [src]: { v: 1, backdrop: src === VID ? { src, play } : { src }, ...(src === VID ? { duration: { mode, seconds } } : {}), boxes: [{ id: "t1" }] } } } });
  assert.equal(set.ok, true, JSON.stringify(set));
  const out = await def.overlay(w.ctx, { query: QUERY() });
  const { engine, mounted } = fakeEngine();
  const page = runOverlayPage(out, { dispatch: (url) => def.routes.feed(new Request(url), w.ctx), globals: { CuriosaCompose: engine } });
  await page.advance(10);
  assert.equal((await R().test(w.ctx, { type: "follow", patch: { variants: [src], compositions: { [src]: { v: 1, backdrop: src === VID ? { src, play } : { src }, ...(src === VID ? { duration: { mode, seconds } } : {}), boxes: [{ id: "t1" }] } }, composeFor: src } })).ok, true);
  let waited = 0;
  while (!mounted.length && waited < 5000) { await page.advance(50); waited += 50; }
  assert.equal(mounted.length, 1, "the alert is drawn");
  const m = mounted[0];
  m.bg.duration = videoDuration;
  let since = 0;
  const step = async (ms) => { since += ms; await page.advance(ms); };
  const emit = (type) => m.bg.dispatch(type);
  const gone = () => page.stage.children.length === 0;
  return { page, m, step, emit, gone, rel: () => since, anim: () => m.boxes[0].anims[0], state: () => m.boxes[0].style.animationPlayState };
}
const tests = { skip: VIDEO ? false : "core before 0.21.0" };

test("video: the text is held until the video plays, then runs from the VIDEO's time", tests, async () => {
  const s = await scene();
  assert.equal(s.m.opts.seconds, 9);
  assert.equal(s.state(), "paused", "held right after the mount: nothing of the text moves");
  await s.step(700);                                                  // data loading, readyState 0 (the measured case)
  assert.equal(s.state(), "paused"); assert.equal(s.anim().currentTime, 0);
  Object.assign(s.m.bg, { readyState: 3, paused: false, currentTime: 0.15 });
  s.emit("playing");
  assert.equal(s.state(), "running");
  assert.equal(s.m.boxes[1].style.animationPlayState, "running", "every box");
  assert.ok(Math.abs(s.anim().currentTime - 150) < 1, "the animation is put at the video's time, in ms");
});

test("video: the length of the alert counts from the video start, and a video played once is never cut before its end", tests, async () => {
  const s = await scene({ seconds: 9, videoDuration: 12 });
  await s.step(800);
  Object.assign(s.m.bg, { readyState: 3, paused: false, currentTime: 0 });
  s.emit("playing");                                                  // started 0.8 s after the card was drawn
  await s.step(12000);
  assert.equal(s.gone(), false, "9 s of text clock would have removed it; the 12 s video is still playing");
  await s.step(2500);
  assert.equal(s.gone(), true, "gone shortly after the end of the video (+ margin), never forever");
});

test("video: a length chosen by hand longer than the video counts from the start too", tests, async () => {
  const s = await scene({ mode: "fixed", seconds: 20, videoDuration: 5, play: "hold" });
  await s.step(900);
  Object.assign(s.m.bg, { readyState: 3, paused: false }); s.emit("playing");
  await s.step(18500);
  assert.equal(s.gone(), false, "20 s from the video start, not from the card");
  await s.step(3000);
  assert.equal(s.gone(), true);
});

test("video: the safety cap, a video of an hour does not keep the card for an hour", tests, async () => {
  const s = await scene({ seconds: 9, videoDuration: 3600 });
  Object.assign(s.m.bg, { readyState: 3, paused: false }); s.emit("playing");
  await s.step(125000);
  assert.equal(s.gone(), true);
});

test("fallback: a video that never starts releases the text after about a second, and the length counts from then", tests, async () => {
  const s = await scene({ seconds: 6, videoDuration: 4 });
  s.m.bg.networkState = 1;                                            // idle: nothing is loading, nothing will play
  await s.step(1000);
  assert.equal(s.state(), "paused");
  await s.step(400);
  assert.equal(s.state(), "running", "released");
  assert.equal(s.anim().currentTime, 0, "from the start of the text");
  Object.assign(s.m.bg, { readyState: 3, paused: false, currentTime: 0 }); s.emit("playing");   // a late start does not move the text back
  assert.equal(s.anim().currentTime, 0);
  await s.step(4000);                                                 // 5.2 s after the release (at 1.2 s): 6 s of alert not over
  assert.equal(s.gone(), false, "counted from the release, not from the card");
  await s.step(2500);
  assert.equal(s.gone(), true);
});

test("fallback: a video still loading is given a little longer, but not forever", tests, async () => {
  const s = await scene({ seconds: 6 });
  s.m.bg.networkState = 2;                                            // loading, nothing buffered
  await s.step(2000);
  assert.equal(s.state(), "paused", "still loading at 2 s: waits");
  await s.step(1200);
  assert.equal(s.state(), "running", "released at 3 s at the latest");
});

test("fallback: an error of the video releases the text at once", tests, async () => {
  const s = await scene();
  await s.step(100);
  s.m.bg.error = { code: 4 }; s.emit("error");
  assert.equal(s.state(), "running"); assert.equal(s.anim().currentTime, 0);
});

test("a stall pauses the text, the video's next start puts it back at the video's time", tests, async () => {
  const s = await scene();
  Object.assign(s.m.bg, { readyState: 3, paused: false, currentTime: 0 }); s.emit("playing");
  s.m.bg.currentTime = 2; s.emit("timeupdate"); s.emit("waiting");
  assert.equal(s.state(), "paused");
  s.m.bg.currentTime = 2.4; s.emit("playing");
  assert.equal(s.state(), "running"); assert.ok(Math.abs(s.anim().currentTime - 2400) < 1);
});

test("a looping video: the text clock goes on, it does not start again", tests, async () => {
  const s = await scene({ videoDuration: 5 });
  Object.assign(s.m.bg, { readyState: 3, paused: false, currentTime: 0 }); s.emit("playing");
  s.m.bg.currentTime = 4.9; s.emit("timeupdate");
  s.m.bg.currentTime = 0.1; s.emit("timeupdate");                      // the video wrapped
  assert.equal(s.state(), "running");
  s.emit("waiting"); s.m.bg.currentTime = 1; s.emit("playing");
  assert.ok(Math.abs(s.anim().currentTime - 6000) < 1, "5 s of the first lap + 1 s");
});

test("no video (picture or GIF): exactly the former behaviour, nothing held, the length counts from the card", tests, async () => {
  const s = await scene({ src: PIC });
  assert.equal(s.state(), undefined, "no play state touched");
  await s.step(3900);
  assert.equal(s.gone(), false);
  await s.step(1500);
  assert.equal(s.gone(), true, "the 4 s of the type, from the draw, as before");
});

test("the clock is skipped for a card that is gone: a late event of an old video does nothing", tests, async () => {
  const s = await scene({ seconds: 9, videoDuration: 3 });
  Object.assign(s.m.bg, { readyState: 3, paused: false, currentTime: 0 }); s.emit("playing");
  await s.step(14000);
  assert.equal(s.gone(), true);
  s.emit("playing"); s.emit("error");
  await s.step(20000);
  assert.equal(s.gone(), true, "no timer was armed on an empty stage");
});

test("the page script keeps the engine call as before and defines the clock only with compositions", tests, async () => {
  const w = world();
  const plain = await def.overlay(w.ctx, { query: QUERY() });
  assert.doesNotMatch(plain.script, /cmpClock/);
  await R().set(w.ctx, { type: "follow", patch: { variants: [VID], compositions: { [VID]: { v: 1, backdrop: { src: VID }, boxes: [{ id: "t1" }] } } } });
  const out = await def.overlay(w.ctx, { query: QUERY() });
  assert.match(out.script, /window\.CuriosaCompose\.mount\(card,card\._cmp,\{seconds:secs\}\);cmpClock\(card,secs,/);
});

// ── A real Chromium and the core's real engine: the text really starts at the video's time (the video itself is held back so the test controls it) ──
let pw = null;
try { const lib = await import(`${process.env.CURIOSA_DIR ?? "../Curiosa"}/scripts/visual/lib/playwright.mjs`); pw = { chromium: lib.loadPlaywright().chromium, path: lib.chromiumPath(), args: lib.CHROMIUM_ARGS }; } catch { pw = null; }
test("real browser: text with in.at = 1 s stays hidden until the video plays, then appears 1 s of VIDEO time later", { skip: !pw ? "no Chromium" : VIDEO ? false : "core before 0.21.0" }, async () => {
  const w = world();
  await R().set(w.ctx, { type: "follow", patch: { variants: [VID], compositions: { [VID]: { v: 1, backdrop: { src: VID, play: "once" }, duration: { mode: "fixed", seconds: 30 }, boxes: [{ id: "t1" }] } } } });
  const page0 = await def.overlay(w.ctx, { query: QUERY() });
  const alert = { kind: "follow", message: "etoile_nord", queued: true, id: "a1", video: VID, present: "media", duration: 30, title: "", compose: { v: 1, backdrop: { src: VID, play: "once" }, duration: { mode: "fixed", seconds: 30 }, boxes: [{ id: "t1", text: "etoile_nord", in: { anim: "fade", at: 1, dur: 0.4 } }] } };
  let queue = [alert];
  const hung = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === VID) { res.setHeader("content-type", "video/webm"); res.flushHeaders(); hung.push(res); return; }   // the video never arrives: loading, readyState 0
    if (u.pathname.endsWith("/feed")) { res.setHeader("content-type", "application/json"); const events = queue; queue = []; return res.end(JSON.stringify({ events, cursor: "a.1" })); }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<!doctype html><meta charset="utf-8"><style>${page0.css}</style>${page0.html}<script>${page0.script}</script>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await pw.chromium.launch({ executablePath: pw.path, args: pw.args });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('[data-ov-region="composition"] .cmp-box', { timeout: 10000 });
    const read = () => page.evaluate(() => { const b = document.querySelector(".cmp-box"), a = b.getAnimations()[0]; return { opacity: parseFloat(getComputedStyle(b).opacity), t: a ? a.currentTime : null, state: b.style.animationPlayState }; });
    await page.waitForTimeout(700);
    const held = await read();
    assert.equal(held.opacity, 0, "700 ms after the draw, before the video: the text is not there");
    assert.equal(held.state, "paused"); assert.equal(held.t, 0);
    // the video starts, 1.5 s into its own time: the text (in.at 1 s, 0.4 s) is already fully in, and keeps running from there
    await page.evaluate(() => { const v = document.querySelector("video"); Object.defineProperty(v, "currentTime", { value: 1.5, configurable: true }); v.dispatchEvent(new Event("playing")); });
    const started = await read();
    assert.equal(started.state, "running");
    assert.ok(started.t >= 1500 && started.t < 1700, `put at the video's time, got ${started.t}`);
    assert.equal(started.opacity, 1);
    // and a video started at 0: the text enters 1 s later
    await page.evaluate(() => { const v = document.querySelector("video"); Object.defineProperty(v, "currentTime", { value: 0.2, configurable: true }); v.dispatchEvent(new Event("waiting")); v.dispatchEvent(new Event("playing")); });
    const back = await read();
    assert.ok(back.t >= 200 && back.t < 400, `resumed at the video's time, got ${back.t}`);
    assert.equal(back.opacity, 0, "0.2 s of video: before in.at");
  } finally { for (const r of hung) r.destroy(); await browser.close(); server.close(); }
});
