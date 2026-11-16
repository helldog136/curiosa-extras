// Alerts overlay 1.12.0 and Twitch activity: "Place the text" (compositions, core 0.19.0). The compositions live in their own collection (never in the
// configuration), the service `alerts.reaction` carries them additively, an alert of a file with a placed text carries it filled by the server, the page
// draws it with the core's engine, the new "Large alerts" element, and NOTHING changes without a composition (byte for byte the page of before).
// The fake context is the core's own (`ctx.overlay` is the real composition kit, never a stand-in).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import zlib from "node:zlib";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const DIR = new URL("../modules/alerts-overlay", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json");
const OLD = process.env.COMPOSE_GOLDEN_DIR;   // generating the golden hashes from the version before (1.10.1)
const base = OLD ?? DIR;
const tw = await import(`${base}/twitch.mjs`);
const mod = await import(`${base}/index.mjs`);
const def = mod.default;
const cp = OLD ? null : await import("../modules/alerts-overlay/compose.mjs");
const rxEvents = OLD ? null : await import("../modules/twitch-events/reaction.mjs");
const enEvents = JSON.parse(fs.readFileSync(new URL("../modules/twitch-events/locales/en.json", import.meta.url), "utf8"));
const frEvents = JSON.parse(fs.readFileSync(new URL("../modules/twitch-events/locales/fr.json", import.meta.url), "utf8"));
/** The core under test has the composition kit (0.19.0); with an older core only the "nothing changes" checks run. */
const COMPOSE = !!fakeCtx({ key: "probe" }).overlay;
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const U = (n, ext) => `/uploads/${String(n).padStart(8, "0")}-0123-4567-89ab-0123456789ab.${ext}`;
const PIC = U(1, "png"), GIF = U(2, "gif"), VID = U(3, "webm");
const HERE = [{ id: "te", key: "events", module: "twitch-events", basePath: "", name: "Twitch activity", adminPath: "/admin/instances/te" }];
const NOW = Date.parse("2026-11-15T20:00:00Z");
let n = 0;
function world({ settings = {}, locale = "en", items = [], overlay, config, key = `cmp${++n}` } = {}) {
  const state = { items };
  tw.resetTwitchState(); cp?.resetComposeCache();
  const ctx = fakeCtx({ key, locale, messages: readJson(`locales/${locale}.json`), settings: { pushToken: "secret", groupSeconds: 0, minGapSeconds: 0, ...settings }, instances: HERE, uploads: [{ url: PIC, by: "u1" }, { url: GIF, by: "u1" }, { url: VID, by: "u1" }], topics: { "twitch.event": () => state.items.slice() }, permissions: manifest.permissions, ...(overlay === null ? { overlay: null } : {}) });
  if (config) ctx.api.store.add("twitchAlerts", { name: "config", ...config });
  return { key, ctx, state };
}
const svc = (name) => def.services[name];
const item = (type, o = {}) => ({ id: `i${++n}`, type, at: new Date(NOW - 1000).toISOString(), name: "etoile_nord", login: "etoile_nord", ...o });
const comp = (src, boxes = [{ id: "t1" }]) => ({ v: 1, backdrop: { src }, boxes });
const QUERY = (fit) => new URLSearchParams(`ov-w=${fit === "scale" ? 640 : 1280}&ov-h=${fit === "scale" ? 260 : 720}&ov-fit=${fit}&ov-lang=fr&ov-text=light&ov-surface=transparent&ov-corners=round`);
const CONFIGS = {
  twitch: {},
  gifs: { types: { follow: { variants: [PIC, GIF], present: "gif", image: PIC, pick: "random" }, sub: { present: "gif", image: GIF } } },
};

// ── 1. Without a composition: byte for byte the page of before (golden hashes made with 1.10.1) ───────────────────────────
const GOLDEN = {
  "twitch,page,neon": ["d398beb773b787b1", "a8bea0036397b752", "1b2d6bea7ca430c6"],
  "twitch,page,plain": ["d398beb773b787b1", "a8bea0036397b752", "f15c8e07bcf13fdf"],
  "twitch,scale,neon": ["14ecc5a6f985b9e8", "b9aabf34dbcd2d2a", "0a2a27204d90074a"],
  "twitch,scale,plain": ["14ecc5a6f985b9e8", "b5b038416eb738e0", "1e110e6c16a36794"],
  "gifs,page,neon": ["d398beb773b787b1", "a8bea0036397b752", "1b2d6bea7ca430c6"],
  "gifs,page,plain": ["d398beb773b787b1", "a8bea0036397b752", "f15c8e07bcf13fdf"],
  "gifs,scale,neon": ["14ecc5a6f985b9e8", "b9aabf34dbcd2d2a", "0a2a27204d90074a"],
  "gifs,scale,plain": ["14ecc5a6f985b9e8", "b5b038416eb738e0", "1e110e6c16a36794"],
};
test("migration: without a composition, the page is byte for byte the page of 1.10.1 (Twitch activity, pictures, module page and element)", async () => {
  const got = {};
  for (const [name, config] of Object.entries(CONFIGS)) for (const where of ["page", "scale"]) for (const visual of ["neon", "plain"]) {
    const w = world({ key: "gold", settings: { visual, durationSeconds: 7, accentColor: "#12ab34" }, config });
    const out = await def.overlay(w.ctx, where === "page" ? undefined : { query: QUERY("scale") });
    got[`${name},${where},${visual}`] = [hash(out.html), hash(out.css), hash(out.script)];
  }
  if (OLD) { console.log(JSON.stringify(got, null, 1)); return; }
  assert.deepEqual(got, GOLDEN);
  // an older core (no ctx.overlay) with compositions saved: still the page of before
  const w = world({ key: "gold", overlay: null, config: CONFIGS.gifs, settings: { visual: "neon", durationSeconds: 7, accentColor: "#12ab34" } });
  w.ctx.api.store.add("compositions", { key: `event:follow|${PIC}`, place: "event:follow", src: PIC, composition: comp(PIC) });
  const out = await def.overlay(w.ctx);
  assert.deepEqual([hash(out.html), hash(out.css), hash(out.script)], GOLDEN["gifs,page,neon"]);
});

if (!OLD && COMPOSE) {
  // ── 2. The service: compositions in their own collection, additive, a file taken out loses its text ─────────────────────
  test("alerts.reaction: get and set carry placed texts; they live in the collection `compositions`, never in the configuration", async () => {
    const w = world();
    const R = svc("alerts.reaction");
    const empty = await R.get(w.ctx, { type: "follow" });
    assert.equal(empty.compose, true);
    assert.deepEqual(empty.compositions, {});
    const set = await R.set(w.ctx, { type: "follow", patch: { variants: [PIC, GIF], compositions: { [PIC]: comp(PIC, [{ id: "t1", content: { kind: "custom", text: "Merci {name}" } }]), [GIF]: null } } });
    assert.equal(set.ok, true, JSON.stringify(set));
    assert.equal(set.placed, 1);
    const rows = w.ctx.dumpStore();
    assert.equal(rows.filter((r) => r.collection === "compositions").length, 1);
    assert.ok(!JSON.stringify(rows.filter((r) => r.collection !== "compositions")).includes('"boxes"'), "never in the configuration (an older module would drop it on save)");
    const got = await R.get(w.ctx, { type: "follow" });
    assert.deepEqual(Object.keys(got.compositions), [PIC]);
    assert.equal(got.compositions[PIC].boxes[0].content.text, "Merci {name}");
    assert.equal((await R.list(w.ctx)).types.find((x) => x.type === "follow").placed, 1);
    // a caller that sends no compositions (an older Twitch activity) changes none
    assert.equal((await R.set(w.ctx, { type: "follow", patch: { variants: [PIC, GIF], pick: "rotate" } })).ok, true);
    assert.deepEqual(Object.keys((await R.get(w.ctx, { type: "follow" })).compositions), [PIC]);
    // a file taken out of the list loses its text
    assert.equal((await R.set(w.ctx, { type: "follow", patch: { variants: [GIF] } })).ok, true);
    assert.deepEqual((await R.get(w.ctx, { type: "follow" })).compositions, {});
    assert.equal(w.ctx.dumpStore().filter((r) => r.collection === "compositions").length, 0);
  });

  test("alerts.reaction: a bad composition is refused before anything is saved (unknown value, another file, a file outside the list)", async () => {
    const w = world();
    const R = svc("alerts.reaction");
    const bad = [
      { [PIC]: comp(PIC, [{ id: "t1", content: { kind: "custom", text: "{pseudo}" } }]) },
      { [PIC]: comp(GIF) },
      { [VID]: comp(VID) },
      { [PIC]: { v: 1, backdrop: { src: PIC }, boxes: [{ id: "t1", size: 999 }] } },
    ];
    for (const compositions of bad) {
      const r = await R.set(w.ctx, { type: "follow", patch: { variants: [PIC], compositions } });
      assert.deepEqual(r, { ok: false, errors: { variants: "compose" } });
    }
    assert.deepEqual(w.ctx.dumpStore().filter((r) => r.collection === "compositions"), []);
    // an older core cannot check: nothing is placed, nothing breaks
    const old = world({ overlay: null });
    assert.equal((await svc("alerts.reaction").set(old.ctx, { type: "follow", patch: { variants: [PIC], compositions: { [PIC]: comp(PIC) } } })).ok, true);
    assert.equal((await svc("alerts.reaction").get(old.ctx, { type: "follow" })).compose, false);
    assert.deepEqual(old.ctx.dumpStore().filter((r) => r.collection === "compositions"), []);
  });

  // ── 3. The alert carries the filled composition of THE file shown ──────────────────────────────────────────────────────
  test("an alert of a file with a placed text carries it, texts filled by the server; the other files and the text alerts do not", async () => {
    const w = world();
    await svc("alerts.reaction").set(w.ctx, { type: "follow", patch: { variants: [PIC, GIF], pick: "rotate", compositions: { [PIC]: comp(PIC, [{ id: "t1" }, { id: "t2", y: 5, h: 15, content: { kind: "custom", text: "{name} · {amount}" } }]) } } });
    const sent = [];
    for (let k = 0; k < 2; k++) { w.state.items = [item("follow", { at: new Date().toISOString() })]; tw.resetTwitchState(); await tw.pullTwitch(w.ctx, (a) => sent.push(a), { ...mod.twitchEnv(w.ctx), compose: cp.composerOf(w.ctx, await cp.allByKey(w.ctx)) }); }
    const withText = sent.find((a) => a.image === PIC), without = sent.find((a) => a.image === GIF);
    assert.ok(withText && without, JSON.stringify(sent.map((a) => a.image)));
    assert.equal(without.compose, undefined);
    assert.equal(withText.compose.backdrop.src, PIC);
    assert.deepEqual(withText.compose.boxes.map((b) => b.text), [withText.message, "etoile_nord"], "the sentence, then the person's own text (a value with no value leaves no separator)");
    assert.ok(withText.compose.boxes.every((b) => !/[{}]/.test(b.text) && !("content" in b)), "no braces reach the page, only filled texts");
    // groups keep it too (three follows in a burst)
    const g = tw.groupBurst([1, 2, 3].map(() => ({ type: "follow", item: item("follow") })), { config: await tw.loadConfig(w.ctx), text: (k) => w.ctx.t(`tw_text_${k}`), title: () => "", pick: () => 0, compose: cp.composerOf(w.ctx, await cp.allByKey(w.ctx)) });
    assert.equal(g[0].compose.backdrop.src, PIC);
  });

  test("test on the overlay: the composition of the window (not saved) on the file asked, without touching the saved ones", async () => {
    const w = world();
    const R = svc("alerts.reaction");
    await R.set(w.ctx, { type: "sub", patch: { variants: [PIC, GIF] } });
    const before = JSON.stringify(w.ctx.dumpStore());
    const cursor = mod.readFeed(w.key, "now").cursor;
    const r = await R.test(w.ctx, { type: "sub", patch: { variants: [PIC, GIF], compositions: { [GIF]: comp(GIF, [{ id: "t1", content: { kind: "custom", text: "Merci {name}" } }]) }, composeFor: GIF } });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(JSON.stringify(w.ctx.dumpStore()), before, "nothing saved");
    const [shown] = mod.readFeed(w.key, cursor).events;
    assert.equal(shown.image, GIF, "the file asked");
    assert.match(shown.compose.boxes[0].text, /^Merci \S+/);
    assert.equal((await R.test(w.ctx, { type: "sub", patch: { variants: [PIC, GIF], compositions: { [GIF]: comp(PIC) }, composeFor: GIF } })).ok, false, "checked like a save");
  });

  // ── 4. The page draws it with the core's engine; the Large alerts element ───────────────────────────────────────────────
  test("the page carries the engine only when a composition exists; Large alerts is a free frame on the same page", async () => {
    const w = world({ config: CONFIGS.gifs });
    await svc("alerts.reaction").set(w.ctx, { type: "follow", patch: { variants: [PIC, GIF], compositions: { [PIC]: comp(PIC) } } });
    const out = await def.overlay(w.ctx, { query: QUERY("fluid") });
    assert.ok(out.script.startsWith(w.ctx.overlay.composeScript()), "the engine first");
    assert.ok(out.css.includes(w.ctx.overlay.composeCss()));
    assert.match(out.script, /if\(e\.compose&&window\.CuriosaCompose\)\{card=document\.createElement\("div"\);card\.className="al-cmp"/);
    assert.match(out.script, /window\.CuriosaCompose\.mount\(card,card\._cmp,\{seconds:secs\}\)/);
    assert.match(out.script, /CuriosaCompose\.unmount\(cr\)/, "the frame is emptied at the end of the alert (skip, clear, next)");
    assert.match(out.html, /data-ov-region="element"/, "fluid is an element page too");
    const el = manifest.overlayElements.find((e) => e.id === "alerts-stage");
    assert.deepEqual([el.fit, el.followsStyle, el.demo], ["fluid", true, true]);
    assert.ok(el.label.fr === "Alertes en grand" && el.label.en === "Large alerts");
    assert.deepEqual(def.overlayElements["alerts-stage"](w.ctx, { lang: "fr" }), { url: `/overlays/${w.key}?lang=fr` });
    assert.deepEqual(Object.keys(def.overlayElements), manifest.overlayElements.map((e) => e.id));
  });

  // ── 5. Twitch activity: the window offers "Place the text" and sends the placed texts only when the core could place them ──
  test("Twitch activity: the gallery declares compose (values of the type, never braces), and the patch carries placed texts only when the core says so", async () => {
    const ctx = fakeCtx({ key: "ev", locale: "fr", messages: frEvents });
    const opt = rxEvents.composeOptionOf(ctx, "cheer", { text: "", textDefault: "{name} : {amount} bits" });
    assert.deepEqual(opt.variables.map((v) => v.token), ["name", "amount", "text"]);
    assert.deepEqual(opt.variables.map((v) => v.label), ["Pseudo", "Montant", "Texte du public"]);
    assert.equal(opt.phrase.sample, "etoile_nord : 500 bits");
    assert.equal(opt.testAction, "testReaction");
    for (const id of Object.keys(rxEvents.TYPE_WORDS)) for (const w of rxEvents.TYPE_WORDS[id]) assert.ok(rxEvents.WORDS.includes(w) && tw.VARS.includes(w), `${id}: ${w}`);
    for (const [k, v] of Object.entries(frEvents)) if (k.startsWith("rx_var_") || k === "rx_compose_phrase") assert.doesNotMatch(v, /[{}]/, k);
    const variants = JSON.stringify([{ src: PIC, compose: comp(PIC) }, { src: GIF }]);
    const older = rxEvents.patchOf({ variants });
    assert.equal(older.compositions, undefined, "an older core: no mark, nothing changes");
    const p = rxEvents.patchOf({ variants, variants__compose: "1", variants__composeFor: GIF });
    assert.deepEqual(Object.keys(p.compositions), [PIC, GIF]);
    assert.equal(p.compositions[GIF], null, "a file without text says so");
    assert.equal(p.composeFor, GIF);
    assert.equal(rxEvents.patchOf({ variants, variants__compose: "1", variants__composeFor: "https://x" }).composeFor, undefined);
    assert.equal(rxEvents.summaryText(ctx, { images: 3, videos: 0, placed: 2, pick: "random" }), "3 GIF, 2 avec texte · Au hasard");
    assert.equal(rxEvents.errorsOf(ctx, { variants: "compose" }).variants, frEvents.rx_err_compose);
    for (const k of Object.keys(frEvents)) assert.ok(k in enEvents, `en ${k}`);
  });
}

// ── 6. A real Chromium: the alert of a picture with its placed text, on a bright and a dark busy picture, in both elements ──
let pw = null;
if (!OLD) { try { const lib = await import(`${process.env.CURIOSA_DIR ?? "../Curiosa"}/scripts/visual/lib/playwright.mjs`); pw = { chromium: lib.loadPlaywright().chromium, path: lib.chromiumPath(), args: lib.CHROMIUM_ARGS }; } catch { pw = null; } }
function busyPng(w, h, bright) {
  const row = w * 3 + 1, px = Buffer.alloc(row * h);
  let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const dots = Array.from({ length: 70 }, () => ({ x: rnd() * w, y: rnd() * h, r: 8 + rnd() * 70, c: [rnd(), rnd(), rnd()].map((v) => Math.round(bright ? 140 + v * 115 : v * 110)) }));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let c = bright ? [244, 240, 224] : [12, 12, 20]; for (const d of dots) if ((x - d.x) ** 2 + (y - d.y) ** 2 < d.r ** 2) c = d.c; px.set(c, y * row + 1 + x * 3); }
  const T = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(px)), chunk("IEND", Buffer.alloc(0))]);
}
test("real browser: the alert shows the picture with its text placed and readable, whole in the Alerts element and full size in Large alerts", { skip: OLD ? "golden" : !COMPOSE ? "core without ctx.overlay (before 0.19.0)" : pw ? false : "Chromium or playwright not found", timeout: 90000 }, async () => {
  const w = world({ settings: { durationSeconds: 30 }, config: CONFIGS.gifs });
  await svc("alerts.reaction").set(w.ctx, { type: "follow", patch: { variants: [PIC, GIF], pick: "rotate", compositions: {
    [PIC]: comp(PIC, [{ id: "t1", look: "readable" }]),
    [GIF]: comp(GIF, [{ id: "t1", y: 40, h: 25, size: 72, look: "bare" }]),
  } } });
  const pages = { scale: await def.overlay(w.ctx, { query: QUERY("scale") }), fluid: await def.overlay(w.ctx, { query: QUERY("fluid") }) };
  const files = { [PIC]: busyPng(480, 270, true), [GIF]: busyPng(480, 270, false) };
  let queue = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (files[u.pathname]) { res.setHeader("content-type", "image/png"); return res.end(files[u.pathname]); }
    if (u.pathname.endsWith("/feed")) { res.setHeader("content-type", "application/json"); const events = queue; queue = []; return res.end(JSON.stringify({ events, cursor: "a.1" })); }
    const p = pages[u.searchParams.get("p")];
    if (!p) { res.statusCode = 404; return res.end(); }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<!doctype html><meta charset="utf-8"><style>${p.css}</style>${p.html}<script>${p.script}</script>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await pw.chromium.launch({ executablePath: pw.path, args: pw.args });
  try {
    const out = [];
    for (const src of [PIC, GIF]) {
      const alert = (await tw.alertFor(item("follow", { test: true }), { config: await tw.loadConfig(w.ctx), text: (k) => w.ctx.t(`tw_text_${k}`), title: () => "", pick: () => (src === PIC ? 0 : 1), compose: cp.composerOf(w.ctx, await cp.allByKey(w.ctx)) })).alert;
      for (const [p, size] of [["scale", { width: 640, height: 260 }], ["fluid", { width: 1280, height: 720 }]]) {
        const page = await (await browser.newContext({ viewport: size })).newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/?p=${p}`);
        queue = [alert];
        await page.waitForSelector('[data-ov-region="composition"] .cmp-box', { timeout: 10000 });
        await page.waitForTimeout(500);
        out.push(await page.evaluate(() => {
          const r = document.querySelector('[data-ov-region="composition"]'), s = r.querySelector(".cmp-txt"), cs = getComputedStyle(s), rr = r.getBoundingClientRect();
          return { w: Math.round(rr.width), h: Math.round(rr.height), font: parseFloat(cs.fontSize), color: cs.color, bg: cs.backgroundColor, shadow: cs.textShadow !== "none", text: s.textContent, card: !!document.querySelector('[data-ov-part="card"]'), img: r.querySelector("img").complete && r.querySelector("img").naturalWidth };
        }));
        if (process.env.COMPOSE_SHOTS) await page.screenshot({ path: `${process.env.COMPOSE_SHOTS}/alert-${p}-${src === PIC ? "bright" : "dark"}.png` });
        await page.close();
      }
    }
    const [brightScale, brightFluid, darkScale, darkFluid] = out;
    for (const o of out) { assert.equal(o.card, false, "a composition is never a card"); assert.equal(o.img, 480); assert.match(o.text, /etoile_nord/); }
    assert.deepEqual([brightScale.w, brightScale.h], [462, 260], "16:9 whole in 640×260, transparent bands");
    assert.deepEqual([brightFluid.w, brightFluid.h], [1280, 720]);
    assert.ok(Math.abs(brightFluid.font - 56 * 720 / 1080) < 0.6);
    assert.match(brightFluid.bg, /^rgba\(20, 23, 28, 0\.85\)$/, "Readable everywhere: a band at 85 %");
    assert.ok(Math.abs(darkFluid.font - 72 * 720 / 1080) < 0.6);
    assert.equal(darkFluid.bg, "rgba(0, 0, 0, 0)");
    assert.ok(darkFluid.shadow && darkScale.shadow, "bare text keeps its outline");
    assert.equal(darkFluid.color, "rgb(255, 255, 255)");
  } finally { await browser.close(); server.close(); }
});
