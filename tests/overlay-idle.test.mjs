// Rule: an overlay element with nothing to say is INVISIBLE on stream: no title, no label, no "no data" text, no border, no background, no space taken.
// This file walks over EVERY overlay element declared by a module of this repository, renders it in its idle state (no draw, no poll, no data, nothing planned...)
// and checks that nothing visible is produced. A new element must either be added to IDLE (with a real idle render) or to EXEMPT (with the reason): the coverage test fails otherwise.
// The editor preview (`ov-demo=1`) must still show a sample so the element can be placed: it is checked here for the elements that render on the server.
import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { El } from "./helpers/remoteDom.mjs";
import { vevent, calendar, feedTopics } from "./helpers/icalFeed.mjs";
import { makeTempDir, removeTempDir } from "./helpers/tmp.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, "..");
const MODULES = path.join(ROOT, "modules");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const msgs = (id, l = "fr") => readJson(path.join(MODULES, id, `locales/${l}.json`));

/** The text a person could read in a page: no style, no script, no tag. */
const visibleText = (html) => String(html).replace(/<head[\s\S]*?<\/head>/g, "").replace(/<title[\s\S]*?<\/title>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
/** A panel that carries a background or a border (`#p`, `#tw`, `#dw-box`) must be hidden when it is empty. */
const panelHidden = (html, id) => new RegExp(`id="${id}"[^>]*\\bhidden\\b`).test(html);
const q = (extra = {}) => new URLSearchParams({ lang: "fr", "ov-w": "900", "ov-h": "300", "ov-fit": "fluid", "ov-lang": "fr", "ov-text": "light", "ov-surface": "soft", "ov-corners": "round", ...extra });
const route = async (id, slug, ctx, query) => {
  const def = (await import(`../modules/${id}/index.mjs`)).default;
  const r = await def.routes["element/:slug"](new Request(`https://site.test/m/x/element/${slug}?${query}`), Object.assign(ctx, { params: { slug } }));
  assert.equal(r.status, 200); return r.text();
};

/** element key → async () => { idle: html, demo?: html, panel?: id of a hidden-when-empty panel }. */
const IDLE = {
  "community-stats/counters": async () => {
    const ctx = () => fakeCtx({ key: "cs", locale: "fr", locales: ["fr", "en"], messages: msgs("community-stats"), topics: { "social.stat": () => [] } });
    return { idle: await route("community-stats", "counters", ctx(), q()), demo: await route("community-stats", "counters", ctx(), q({ "ov-demo": "1" })), panel: "p" };
  },
  "game-suggestions/top": async () => {
    const ctx = () => fakeCtx({ key: "gs", basePath: "suggestions", moduleId: "game-suggestions", locale: "fr", locales: ["fr", "en"], defaultLocale: "fr", messages: msgs("game-suggestions") });
    return { idle: await route("game-suggestions", "top", ctx(), q()), demo: await route("game-suggestions", "top", ctx(), q({ "ov-demo": "1" })), panel: "p" };
  },
  "thanks-wall/thanks": async () => {
    const ctx = () => fakeCtx({ key: "tw", locale: "fr", locales: ["fr", "en"], defaultLocale: "fr", messages: msgs("thanks-wall") });
    return { idle: await route("thanks-wall", "thanks", ctx(), q()), demo: await route("thanks-wall", "thanks", ctx(), q({ "ov-demo": "1" })), panel: "p" };
  },
  "planning/week": () => planning("week"),
  "planning/next": () => planning("next"),
  "testimonials/reviews": async () => {
    const ctx = () => fakeCtx({ key: "rv", locale: "fr", locales: ["fr", "en"], messages: msgs("testimonials") });
    return { idle: await route("testimonials", "reviews", ctx(), q()), demo: (await route("testimonials", "reviews", ctx(), q({ "ov-demo": "1" }))).replace(/<script[^>]*>([\s\S]*?)<\/script>/g, " $1 ") /* the reviews travel as data in the page */ };
  },
  "mascot/mascot": async () => {
    const ctx = () => fakeCtx({ key: "mc", locale: "fr", locales: ["fr", "en"], messages: msgs("mascot") });
    return { idle: await route("mascot", "mascot", ctx(), q()) };
  },
  "sponsor-ticker/sponsors": async () => {
    const def = (await import("../modules/sponsor-ticker/index.mjs")).default;
    const o = def.overlay(fakeCtx({ key: "sp", locale: "fr", messages: msgs("sponsor-ticker"), topics: { "sponsor.card": [], "core.entry": [] } }), { query: q() });
    return { idle: o.html };
  },
  "ticker-overlay/banner": async () => {
    const def = (await import("../modules/ticker-overlay/index.mjs")).default;
    const o = def.overlay(fakeCtx({ key: "tk", locale: "fr", messages: msgs("ticker-overlay") }), { query: q() });
    return { idle: o.html };
  },
  "twitch-channel/stats": () => twitch("stats", { rows: [] }),
  "twitch-channel/live": () => twitch("live", { state: "unknown" }),
  "twitch-raid/featured": () => raid("featured", { state: "ok", rows: [] }),
  "twitch-raid/live": () => raid("live", { state: "ok", rows: [] }),
  "events/next": async () => {
    const ov = await import("../modules/events/element.mjs");
    return { idle: runPanel(ov.page(q(), { lang: "fr", first: { state: "none" }, data: "/x", labels: { title: "Next" } }), "events next") };
  },
  "audience/draw": async () => {
    // the runtime states (none / open / closed / drawn) are checked in audience-draw-overlay.test.mjs ; here the page skeleton
    const { audienceCtx } = await import("./helpers/audienceHarness.mjs");
    const D = await import("../modules/audience/draw.mjs"), V = await import("../modules/audience/drawview.mjs"), def = (await import("../modules/audience/index.mjs")).default;
    const ctx = audienceCtx();
    const page = await def.overlay(ctx, { query: q({ k: await D.screenKey(ctx) }) });
    assert.ok(page.script.includes("window.__DW="), "the real page, not the empty frame");
    assert.ok(V.OVERLAY_JS.includes("box.hidden = true"), "the box is hidden again when there is nothing to show");
    return { idle: page.html, panel: "dw-box" };
  },
};

/** Elements that cannot be "idle", and why. */
const EXEMPT = {
  "alerts-overlay/alerts": "event-driven: a card exists only while an alert plays; the stage is empty and transparent otherwise (overlay-elements-alerts.test.mjs: 'sans ov-demo, la scène est vide')",
  "alerts-overlay/alerts-stage": "the same page as the Alerts element in a free frame: event-driven, the stage is empty and transparent between two alerts (alerts-overlay-compose.test.mjs)",
  "countdown/countdown": "hidden until an event is chosen and hidden again after its end message (hideAt); starts with `hidden` (countdown-client.test.mjs)",
  "polls/poll": "the box is empty when there is no poll (`empty` answer); a finished poll shows its final results on purpose (polls-overlay-element.test.mjs)",
  "maze-overlay/maze": "a generative scene that always plays: it has no data to wait for, so no idle state",
  // (1.97.0) animated elements drawn by the core's engine on a canvas: the page has no text of its own and its stage starts hidden until the state arrives
  "alerts-overlay/hype-train": "hidden while no train is on (state route answers visible: false; the stage starts hidden): alerts-gauges.test.mjs",
  "alerts-overlay/session-counter": "a total of the session is always something to say (0 at the start of a live); drawn by the engine, no placeholder text",
  "stream-goals/goal": "a goal is always something to say (the value towards the target); drawn by the engine, no placeholder text",
  "stream-goals/subathon": "hidden while no start is chosen (state route answers visible: false; the stage starts hidden): stream-goals.test.mjs",
};

async function planning(slug) {
  const mod = await import("../modules/planning/index.mjs");
  const def = mod.default;
  const ov = await import("../modules/planning/overlay.mjs");
  const mk = () => fakeCtx({ key: "planning", params: { slug }, settings: { days: 7, timezone: "UTC" }, topics: feedTopics(() => calendar()), messages: msgs("planning"), locale: "fr", rawgConfigured: false });
  ov.resetOverlayCache();
  const get = async (extra) => (await def.routes["element/:slug"](new Request(`https://site.test/m/planning/element/${slug}?${q(extra)}`), mk())).text();
  return { idle: await get({}), demo: await get({ "ov-demo": "1" }), panel: "p" };
}

/** Runs the real script of a page whose panel starts hidden, against a tiny fake document: with nothing to show, the panel must stay (or become) hidden and empty. */
function runPanel(html, what) {
  const doc = { hidden: false, body: null };
  const p = new El("div", doc); p.style = { setProperty() {}, getPropertyValue: () => "20" }; doc.body = p; doc.getElementById = () => p; doc.createElement = (t) => new El(t, doc);
  const win = { document: doc, JSON, Math, Number, String, Intl, Promise, Object, Array, AbortSignal, parseFloat, setTimeout() { return 1; }, addEventListener() {}, getComputedStyle: () => ({ paddingLeft: "0", paddingRight: "0", paddingTop: "0", paddingBottom: "0" }), fetch: async () => ({ ok: false }) };
  win.window = win;
  vm.runInContext(/<script>([\s\S]*)<\/script>/.exec(html)[1], vm.createContext(win));
  assert.equal(p.hidden, true, `${what}: the panel is hidden when there is nothing to show`);
  assert.equal(p.children.length, 0, `${what}: nothing inside`);
  return html.replace(/<script>[\s\S]*<\/script>/, "");
}

async function twitch(kind, first) {
  const ov = await import("../modules/twitch-channel/overlay.mjs");
  return { idle: runPanel(ov.page(kind, q(), { lang: "fr", first, data: "/x", labels: { live: "Live", offline: "Offline" } }), `twitch ${kind}`) };
}

async function raid(kind, first) {
  const ov = await import("../modules/twitch-raid/element.mjs");
  return { idle: runPanel(ov.page(kind, q(), { lang: "fr", first, data: "/x", labels: { title: "T", viewers_one: "{n} viewer", viewers_other: "{n} viewers", more: "+{n}" } }), `raid ${kind}`) };
}

test("coverage: every overlay element declared in the repository is either checked idle or exempt with a reason", () => {
  const declared = [];
  for (const m of fs.readdirSync(MODULES)) {
    const f = path.join(MODULES, m, "module.json");
    if (!fs.existsSync(f)) continue;
    for (const e of readJson(f).overlayElements ?? []) declared.push(`${m}/${e.id}`);
  }
  assert.ok(declared.length >= 19, `found ${declared.length} elements`);
  for (const k of declared) assert.ok(k in IDLE || k in EXEMPT, `${k}: add an idle check to IDLE or a reason to EXEMPT (an overlay with nothing to say shows nothing)`);
  for (const k of [...Object.keys(IDLE), ...Object.keys(EXEMPT)]) assert.ok(declared.includes(k), `${k} is not a declared element any more`);
  for (const [k, why] of Object.entries(EXEMPT)) assert.ok(why.length > 30, `${k}: say why`);
});

// With core 0.17.0 the core adopts its appearance kit into every element that follows the style (a background on the containers, tokens forced on every
// node). Checked in a REAL Chromium when the core under test has the kit and a browser is available: the idle page must still paint nothing.
let kit = null;
try {
  const core = path.resolve(process.env.CURIOSA_DIR ?? process.cwd());
  const K = await import(pathToFileURL(path.join(core, "src/core/overlays/appearance.ts")).href);
  const lib = await import(pathToFileURL(path.join(core, "scripts/visual/lib/playwright.mjs")).href);
  kit = { css: K.lookCss(K.appliedLook({ preset: "readable" }, { style: { text: "light", background: "transparent" }, skin: false }, true)), chromium: lib.loadPlaywright().chromium, exe: lib.chromiumPath(), args: lib.CHROMIUM_ARGS, browser: null };
} catch { kit = null; }
// The browser is closed by an `after` hook of the SUITE below, never by a root-level `test.after`: this file registers a test, then awaits imports (top-level await),
// then registers the idle tests. A root hook runs as soon as the tests registered so far are done, so it can run BEFORE the idle tests launch Chromium (on Node 24 it did,
// every time): it then closed nothing and Chromium kept the test process alive, so the file never exited. A suite hook runs after the tests of that suite, whatever the timing.
async function paintedWithKit(html) {
  // Chromium gets its own TMPDIR: it removes its `.org.chromium.Chromium.*` folder a moment AFTER close() returns, which sometimes tripped the TMPDIR guard of `npm test`.
  kit.tmp ??= makeTempDir("overlay-idle-chromium-");
  kit.browser ??= await kit.chromium.launch({ executablePath: kit.exe, args: kit.args, env: { ...process.env, TMPDIR: kit.tmp } });
  const ctx = await kit.browser.newContext({ javaScriptEnabled: false, viewport: { width: 900, height: 300 } });
  try {
    const p = await ctx.newPage();
    await p.setContent(html);
    return await p.evaluate((css) => {
      const s = new CSSStyleSheet(); s.replaceSync(css); document.adoptedStyleSheets = [...document.adoptedStyleSheets, s]; document.documentElement.setAttribute("data-ov-look", "1");
      return [...document.querySelectorAll("html, body, body *")].filter((n) => { const st = getComputedStyle(n), r = n.getBoundingClientRect(); if (st.display === "none" || st.visibility === "hidden" || r.width === 0 || r.height === 0) return false; for (let x = n; x && x.nodeType === 1; x = x.parentElement) if (getComputedStyle(x).opacity === "0") return false; return (st.backgroundColor !== "rgba(0, 0, 0, 0)" && st.backgroundColor !== "transparent") || st.backgroundImage !== "none" || (parseFloat(st.borderTopWidth) > 0 && st.borderTopColor !== "rgba(0, 0, 0, 0)") || st.boxShadow !== "none"; }).map((n) => n.id || n.getAttribute("data-ov-part") || n.tagName);
    }, kit.css);
  } finally { await ctx.close(); }
}

describe("idle elements in the real browser", () => {
  after(async () => { await kit?.browser?.close(); if (kit?.tmp) removeTempDir(kit.tmp); });
  for (const [key, run] of Object.entries(IDLE)) {
    test(`idle: ${key} shows nothing (no text, no placeholder, empty hidden frame); the editor preview still shows a sample`, async () => {
      const r = await run();
      assert.equal(visibleText(r.idle), "", `${key}: visible text while idle: « ${visibleText(r.idle)} »`);
      if (r.panel) assert.ok(panelHidden(r.idle, r.panel), `${key}: the panel #${r.panel} must be hidden when empty (no background, no border)`);
      if (r.demo !== undefined) {
        assert.notEqual(visibleText(r.demo), "", `${key}: the preview must show a sample`);
        if (r.panel) assert.ok(!panelHidden(r.demo, r.panel), `${key}: the preview panel is visible`);
      }
      if (kit) assert.deepEqual(await paintedWithKit(r.idle), [], `${key}: with the core appearance kit (0.17.0), the idle page paints nothing`);
    });
  }
});
