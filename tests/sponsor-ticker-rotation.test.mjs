// Sponsor ticker 1.6.0: the SERVER decides which sponsor is on screen from its clock (modules/sponsor-ticker/rotation.mjs); the overlay page computes the same answer
// and sends nothing back; the topic `home.info` gives the scheduled sponsor to Home Assistant. Invented names only. No network, no browser: the clock is simulated.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/sponsor-ticker", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json"), en = readJson("locales/en.json"), fr = readJson("locales/fr.json");
const tk = await import("../modules/sponsor-ticker/index.mjs");
const rot = await import("../modules/sponsor-ticker/rotation.mjs");
const def = tk.default;
const { cleanInfo } = await import("../modules/home-assistant/info.mjs");
const { rotationPick, scheduledId, slotMs } = rot;

const idsOf = (n) => Array.from({ length: n }, (_, i) => `s:${String.fromCharCode(97 + i)}${i}`);
const seq = (ids, from, count) => Array.from({ length: count }, (_, i) => rotationPick(ids, from + i));

/* ───────────── the rotation ───────────── */

test("rotation: edge cases (no item, one item, two items)", () => {
  assert.equal(rotationPick([], 0), null);
  assert.equal(rotationPick([], 12345), null);
  for (const slot of [0, 1, 99, 1e9]) assert.equal(rotationPick(["s:only"], slot), "s:only");
  const s = seq(["s:b", "s:a"], 0, 10);
  assert.deepEqual(s, ["s:a", "s:b", "s:a", "s:b", "s:a", "s:b", "s:a", "s:b", "s:a", "s:b"], "two sponsors alternate");
});

test("rotation: deterministic, whatever the order of the ids and the duplicates", () => {
  const ids = idsOf(7);
  const shuffled = [ids[4], ids[0], ids[6], ids[2], ids[1], ids[5], ids[3], ids[2], ids[4]];
  assert.deepEqual(seq(ids, 1000, 60), seq(ids, 1000, 60));
  assert.deepEqual(seq(shuffled, 1000, 60), seq(ids, 1000, 60));
  assert.deepEqual(seq(ids.slice().reverse(), 0, 60), seq(ids, 0, 60));
  assert.equal(rotationPick(ids, 12.7), rotationPick(ids, 12), "a fractional slot is the slot below");
});

test("rotation: fair, every sponsor exactly once in each cycle of n slots", () => {
  for (const n of [1, 2, 3, 4, 5, 8, 13]) {
    const ids = idsOf(n);
    for (const cycle of [0, 1, 2, 7, 1000, 3_400_000, 2 ** 31, 2 ** 32 + 5]) {
      const got = seq(ids, cycle * n, n);
      assert.deepEqual(got.slice().sort(), ids.slice().sort(), `n=${n} cycle ${cycle}`);
    }
  }
});

test("rotation: the first of a cycle never repeats the last of the previous one", () => {
  for (const n of [2, 3, 4, 5, 6, 9, 20]) {
    const ids = idsOf(n);
    for (let c = 1; c < 400; c++) assert.notEqual(rotationPick(ids, c * n), rotationPick(ids, c * n - 1), `n=${n} cycle ${c}`);
  }
  // no repeat anywhere in a long run
  for (const n of [2, 3, 5, 11]) { const s = seq(idsOf(n), 5000, 3000); for (let i = 1; i < s.length; i++) assert.notEqual(s[i], s[i - 1]); }
});

test("rotation: the shuffle really changes from one cycle to the next (not always the same order)", () => {
  const ids = idsOf(6);
  const orders = new Set(Array.from({ length: 50 }, (_, c) => seq(ids, c * 6, 6).join()));
  assert.ok(orders.size > 25, `${orders.size} different orders in 50 cycles`);
});

test("rotation: slot length = the period, never less than the hold time plus 2 seconds", () => {
  assert.equal(slotMs(90, 10), 90_000);
  assert.equal(slotMs(5, 10), 12_000);
  assert.equal(slotMs(10, 8), 10_000);
  assert.equal(slotMs(10, 9), 11_000);
});

test("scheduledId: the sponsor of the slot during the first `hold` seconds of the slot, null after", () => {
  const ids = idsOf(4), P = 90_000, slot = 123_456;
  const t0 = slot * P;
  const want = rotationPick(ids, slot);
  assert.equal(scheduledId(ids, t0, 90, 10), want);
  assert.equal(scheduledId(ids, t0 + 9_999, 90, 10), want);
  assert.equal(scheduledId(ids, t0 + 10_000, 90, 10), null);
  assert.equal(scheduledId(ids, t0 + 89_999, 90, 10), null);
  assert.equal(scheduledId(ids, t0 + P, 90, 10), rotationPick(ids, slot + 1));
  assert.equal(scheduledId([], t0, 90, 10), null);
  // period shorter than hold + 2: the slot is stretched
  assert.equal(scheduledId(ids, 5 * 12_000 + 11_999, 5, 10), null);
  assert.equal(scheduledId(ids, 5 * 12_000 + 9_999, 5, 10), rotationPick(ids, 5));
});

/* ───────────── the topic home.info ───────────── */

const T0 = Date.parse("2026-10-14T20:00:00Z");
const CARDS = [{ id: "n", name: "Etoile Nord", text: "A short text", url: "https://etoile-nord.test", page: "https://site.example.org/sponsors/etoile-nord", code: "NORD10" }, { id: "l", name: "Lune Douce" }, { id: "c", name: "Camille Outdoor" }];
const ENTRIES = [{ path: "/codes/camille", title: "Offre Camille", code: "CAM5" }, { path: "/blog/no-code", title: "Not a sponsor" }];
const ITEM_IDS = ["s:n", "s:l", "s:c", "e:/codes/camille"];
const NAMES = { "s:n": "Etoile Nord", "s:l": "Lune Douce", "s:c": "Camille Outdoor", "e:/codes/camille": "Offre Camille" };

function make({ key = "ticker", locale = "en", settings = {}, cards = CARDS, entries = ENTRIES } = {}) {
  const ctx = fakeCtx({ key, name: "Sponsors", locale, messages: locale === "fr" ? fr : en, settings, topics: { "sponsor.card": () => cards, "core.entry": () => entries } });
  ctx.api.siteUrl = "https://site.example.org";
  ctx.api.qr = async (t) => `<svg data-qr="${t}"></svg>`;
  return ctx;
}
const at = (ms) => { mock.timers.reset(); mock.timers.enable({ apis: ["Date"], now: ms }); };
const valueOf = async (ctx) => (await def.exports["home.info"](ctx))[0].value;
const slotStart = (slot, p = 90_000) => slot * p;

test("home.info: one item with the instance key, the label in the language of the site", async () => {
  at(T0);
  for (const [locale, label] of [["en", "Sponsor on screen"], ["fr", "Sponsor \u00e0 l'\u00e9cran"]]) {
    const items = await def.exports["home.info"](make({ locale }));
    assert.equal(items.length, 1);
    assert.deepEqual([items[0].key, items[0].label], ["sponsor-ticker.ticker", label]);
  }
  assert.equal((await def.exports["home.info"](make({ key: "other" })))[0].key, "sponsor-ticker.other");
  mock.timers.reset();
});

test("home.info: the scheduled sponsor during its display time, null between two displays, from the server clock only", async () => {
  const ctx = make();
  const slot = 19_000_000;
  const want = NAMES[rotationPick(ITEM_IDS, slot)];
  for (const [dt, expected] of [[0, want], [5_000, want], [9_999, want], [10_000, null], [45_000, null], [89_999, null]]) {
    at(slotStart(slot) + dt);
    assert.equal(await valueOf(ctx), expected, `+${dt} ms`);
  }
  at(slotStart(slot + 1) + 100);
  assert.equal(await valueOf(ctx), NAMES[rotationPick(ITEM_IDS, slot + 1)]);
  mock.timers.reset();
});

test("home.info: follows the module settings (period and hold time, clamped like the overlay)", async () => {
  const slot = 4_000_000;
  const ctx = make({ settings: { periodSeconds: 30, holdSeconds: 20 } });
  at(slotStart(slot, 30_000) + 19_999); assert.equal(await valueOf(ctx), NAMES[rotationPick(ITEM_IDS, slot)]);
  at(slotStart(slot, 30_000) + 20_000); assert.equal(await valueOf(ctx), null);
  // period 5 s with hold 10 s: slots last 12 s
  const short = make({ settings: { periodSeconds: 5, holdSeconds: 10 } });
  at(slotStart(slot, 12_000) + 9_999); assert.equal(await valueOf(short), NAMES[rotationPick(ITEM_IDS, slot)]);
  at(slotStart(slot, 12_000) + 10_000); assert.equal(await valueOf(short), null);
  mock.timers.reset();
});

test("home.info: null without any sponsor, and when the topics fail (never an error), the demo card is not a sponsor", async () => {
  at(slotStart(77));
  assert.equal(await valueOf(make({ cards: [], entries: [] })), null);
  const ctx = make();
  ctx.api.topics.collect = async () => { throw new Error("secret internal detail"); };
  assert.equal(await valueOf(ctx), null);
  mock.timers.reset();
});

test("home.info: nothing depends on what a page did (no state, no route to report)", async () => {
  at(slotStart(12_345));
  const ctx = make();
  const a = await valueOf(ctx), b = await valueOf(make());
  assert.equal(a, b);
  assert.deepEqual(Object.keys(def.routes), ["items"]);
  assert.deepEqual(cleanInfo(await def.exports["home.info"](ctx)).map((i) => i.key), ["sponsor-ticker.ticker"], "what the Home Assistant connector keeps of it");
  mock.timers.reset();
});

test("manifest: provides home.info (EN and FR labels), 1.6.0, still valid, locales in parity, no `shown` anywhere", () => {
  const r = parseManifest(manifest);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.version, "1.6.0");
  const p = manifest.provides.find((x) => x.topic === "home.info");
  assert.ok(p && p.label.en?.trim() && p.label.fr?.trim());
  assert.ok(manifest.permissions.includes("topics") && manifest.permissions.includes("routes"));
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  assert.ok(fr.homeInfoLabel && en.homeInfoLabel);
  assert.equal(typeof def.exports["home.info"], "function");
  assert.ok(!/\/shown|"shown"/.test(JSON.stringify(manifest)));
  for (const f of ["index.mjs", "rotation.mjs"]) assert.ok(!/reportUrl|SHOWN|shownNow|readBody|routes\.shown/.test(fs.readFileSync(`${DIR}/${f}`, "utf8")), f);
});

/* ───────────── the items route and the overlay page ───────────── */

test("items route: answers the items AND the server time in ms", async () => {
  at(T0 + 1234);
  const ctx = make();
  const res = await def.routes.items(new Request("https://site.example.org/m/ticker/items"), ctx);
  const body = await res.json();
  assert.equal(body.serverTime, T0 + 1234);
  assert.deepEqual(body.items.map((i) => i.id), ["s:n", "s:l", "s:c", "e:/codes/camille"]);
  mock.timers.reset();
});

const pageOf = (settings = {}, query = "", key = "ticker") => def.overlay(make({ key, settings }), { query: new URLSearchParams(query) });
const cfgOf = (out) => JSON.parse(out.script.match(/^\(function\(\)\{var c=(\{.*?\}),slider=/s)[1]);
const compiles = (out) => assert.doesNotThrow(() => new vm.Script(out.script), "the page script is valid JavaScript");

test("page: sends nothing to the server (no POST, no report, no reportUrl), whatever the mode", () => {
  for (const [settings, q] of [[{}, ""], [{}, "ov-w=720&ov-h=180&ov-tv=1"], [{}, "ov-w=720&ov-h=180&ov-demo=1"], [{ devMode: true }, "dev=1"], [{ devMode: true }, "seed=3"]]) {
    const out = pageOf(settings, q);
    assert.ok(!/reportUrl|report\(|\/shown|POST|keepalive|sendBeacon/.test(out.script), `${JSON.stringify(settings)} ${q}`);
    assert.ok(!("reportUrl" in cfgOf(out)));
    compiles(out);
  }
});

test("page: the server clock decides, except in the test page, the fast developer mode and with a seed (random as before, flagged `free`)", () => {
  assert.ok(!("free" in cfgOf(pageOf())), "default: scheduled by the server clock");
  assert.ok(!("free" in cfgOf(pageOf({}, "ov-w=720&ov-h=180&ov-tv=1"))), "inside an overlay page too");
  assert.ok(!("free" in cfgOf(pageOf({}, "dev=1&seed=3"))), "dev query ignored while the setting is off");
  assert.equal(cfgOf(pageOf({}, "ov-w=720&ov-h=180&ov-demo=1")).free, true);
  assert.equal(cfgOf(pageOf({ devMode: true }, "dev=1")).free, true);
  assert.equal(cfgOf(pageOf({ devMode: true }, "dev=1&seed=7")).free, true);
  assert.equal(cfgOf(pageOf({ devMode: true }, "seed=7")).free, true);
  assert.equal(cfgOf(pageOf({ devMode: true }, "seed=7")).seed, 7, "the seed stays valid");
  assert.ok(!("free" in cfgOf(pageOf({ devMode: true }, ""))), "the setting alone changes nothing");
  assert.equal(cfgOf(pageOf({ devMode: true }, "dev=1")).period, 4);
});

/** The page's copy of a function of rotation.mjs, taken out of the real page script. */
function pageFn(out, name) {
  const i = out.script.indexOf(`function ${name}(`);
  assert.ok(i > 0, `${name} is in the page script`);
  let depth = 0, j = out.script.indexOf("{", i);
  for (let k = j; k < out.script.length; k++) { if (out.script[k] === "{") depth++; else if (out.script[k] === "}" && --depth === 0) { j = k + 1; break; } }
  return new vm.Script(`(${out.script.slice(i, j)})`).runInThisContext();
}

test("page and server agree: the function in the page script is the one of the server, on many slots, ids and orders", () => {
  const out = pageOf();
  assert.ok(out.script.includes(rotationPick.toString()), "the very same source text");
  assert.ok(out.script.includes(slotMs.toString()));
  const pagePick = pageFn(out, "rotationPick"), pageSlot = pageFn(out, "slotMs");
  let n = 0;
  for (const count of [0, 1, 2, 3, 4, 7, 12]) {
    const ids = idsOf(count);
    for (const from of [0, 1, 19_000_000, 2 ** 31 - 10, 2 ** 32 - 10, 1.7e12 / 5000]) {
      const reversed = ids.slice().reverse();
      for (let k = 0; k < 40; k++, n++) {
        assert.equal(pagePick(reversed, from + k), rotationPick(ids, from + k), `n=${count} slot ${from + k}`);
        const now = (from + k) * 90_000 + (k * 2_731) % 90_000;
        assert.equal(pageSlot(90, 10), slotMs(90, 10));
        assert.equal(pagePick(ids, Math.floor(now / pageSlot(90, 10))) === (scheduledId(ids, now, 90, 10) ?? pagePick(ids, Math.floor(now / 90_000))), true);
      }
    }
  }
  assert.ok(n > 1000);
});

/* The real page script, run against the real `items` route with a simulated browser and a simulated clock. */
function fakeDom() {
  const shown = [];
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.style = { setProperty() {}, getPropertyValue: () => "", cssText: "" }; this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; this.className = ""; this.textContent = ""; this.offsetWidth = 400; this.offsetHeight = 100; this.scrollWidth = 200; this.clientWidth = 300; }
    append(...n) { this.children.push(...n); }
    appendChild(n) { this.children.push(n); return n; }
    replaceChildren(...n) { this.children = n; if (n[0]) shown.push(n[0].find("ticker-name")?.textContent ?? null); }
    find(cls) { for (const c of this.children) { if (String(c.className).split(" ").includes(cls)) return c; const d = c.find?.(cls); if (d) return d; } return null; }
    querySelector(sel) { return this.find(sel.replace(".", "")) ?? new El("div"); }
    getBoundingClientRect() { return { width: 400, height: 100, left: 0, top: 0, right: 400, bottom: 100 }; }
    animate() { return { finished: Promise.resolve(), cancel() {}, onfinish: null }; }
    addEventListener() {}
  }
  const slider = new El("div");
  const document = { getElementById: (id) => (id === "tk-slider" ? slider : new El("div")), createElement: (t) => new El(t), createElementNS: (n, t) => new El(t), documentElement: new El("html"), body: new El("body") };
  return { document, shown, slider };
}
const flush = () => new Promise((r) => setImmediate(r));

/** Runs the page for `seconds` of simulated time; the page clock is `skewMs` behind the server clock. Returns the list of { at (server ms), name }. */
async function runPage({ settings = {}, query = "", seconds, skewMs = 0, start = T0, cards = CARDS, entries = ENTRIES }) {
  const ctx = make({ settings, cards, entries }), out = def.overlay(ctx, { query: new URLSearchParams(query) });
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date", "setTimeout"], now: start });
  const dom = fakeDom(), log = [], posts = [];
  const RealDate = Date;
  const pageDate = { now: () => RealDate.now() - skewMs, parse: RealDate.parse };
  const orig = dom.slider.replaceChildren.bind(dom.slider);
  dom.slider.replaceChildren = (...n) => { orig(...n); log.push({ at: RealDate.now(), name: dom.shown.at(-1) }); };
  const win = {
    document: dom.document, Date: pageDate, JSON, Math, Number, String, Promise, Object, Array, Set, parseFloat, parseInt, Error, encodeURIComponent,
    window: null, addEventListener() {}, MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: (f) => setTimeout(f, 16), matchMedia: () => ({ matches: false }), innerWidth: 1920, innerHeight: 1080, getComputedStyle: () => ({ getPropertyValue: () => "" }),
    setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a),
    fetch: async (url, init) => { if (init?.method || !String(url).includes("/items")) posts.push([url, init]); return await def.routes.items(new Request(new URL(url, "https://site.example.org").href), ctx); },
  };
  win.window = win;
  vm.createContext(win);
  new vm.Script(out.script).runInContext(win);
  for (let t = 0; t < seconds * 4; t++) { mock.timers.tick(250); for (let i = 0; i < 6; i++) await flush(); }
  mock.timers.reset();
  return { log, posts, out };
}

test("page run: shows exactly the scheduled sponsor, at the slot boundaries of the SERVER clock, sends nothing", async () => {
  const settings = { periodSeconds: 20, holdSeconds: 6, showQr: false };
  const start = slotStart(88_000, 20_000) + 3_000;   // 3 s into a slot
  for (const skewMs of [0, 7_000, -4_500]) {
    const r = await runPage({ settings, seconds: 400, skewMs, start });
    assert.deepEqual(r.posts, [], "nothing sent");
    assert.ok(r.log.length >= 18, `${r.log.length} displays in 400 s (skew ${skewMs})`);
    for (const { at: t, name } of r.log) {
      const slot = Math.floor(t / 20_000), into = t - slot * 20_000;
      assert.ok(into < 1500 || into >= 20_000 - 1500, `shown on a slot boundary (+${into} ms, skew ${skewMs})`);
      const k = into < 1500 ? slot : slot + 1;
      assert.equal(name, NAMES[rotationPick(ITEM_IDS, k)], `slot ${k} skew ${skewMs}`);
    }
    // consecutive slots, every slot once
    const slots = r.log.map(({ at: t }) => Math.round(t / 20_000));
    for (let i = 1; i < slots.length; i++) assert.equal(slots[i], slots[i - 1] + 1, "one display per slot, no gap");
  }
});

test("page run: a page loaded in the middle of a display time shows the planned sponsor right away, else waits for the next slot", async () => {
  const settings = { periodSeconds: 20, holdSeconds: 6, showQr: false };
  // startDelay is 5 s. Loaded at +0.1 s of the slot: 5.1 s in, 0.9 s left (< 2 s): waits for the next slot.
  const late = await runPage({ settings, seconds: 30, start: slotStart(50_000, 20_000) + 100 });
  assert.equal(Math.round(late.log[0].at / 20_000) * 20_000 - late.log[0].at < 1500, true);
  assert.equal(late.log[0].name, NAMES[rotationPick(ITEM_IDS, 50_001)]);
  // loaded 1.5 s before a slot: 5 s later we are 3.5 s into the slot, 2.5 s left: shown at once with the planned sponsor
  const mid = await runPage({ settings, seconds: 30, start: slotStart(60_000, 20_000) - 1_500 });
  assert.equal(mid.log[0].name, NAMES[rotationPick(ITEM_IDS, 60_000)]);
  assert.ok(Math.abs(mid.log[0].at - (slotStart(60_000, 20_000) + 3_500)) < 600, "at the start delay, not at the next slot");
});

test("page run: without any sponsor nothing is shown and nothing breaks", async () => {
  const none = make({ cards: [], entries: [] });
  assert.equal(await (async () => { at(T0); return valueOf(none); })(), null);
  mock.timers.reset();
  const r = await runPage({ settings: { periodSeconds: 20, holdSeconds: 6, showQr: false }, seconds: 60, start: T0, cards: [], entries: [] });
  assert.deepEqual(r.log, []);
});

test("page run: the test page and the developer modes keep their own random start (nothing scheduled by the clock)", async () => {
  const demo = await runPage({ settings: { showQr: false }, query: "ov-w=720&ov-h=180&ov-demo=1", seconds: 3 });
  assert.equal(demo.log.length, 1, "the card appears after 0.4 s");
  assert.ok(demo.log[0].at - T0 < 1000);
  const fast = await runPage({ settings: { devMode: true, showQr: false }, query: "dev=1&seed=7", seconds: 13 });
  assert.ok(fast.log.length >= 3, "every 4 s");
  const again = await runPage({ settings: { devMode: true, showQr: false }, query: "dev=1&seed=7", seconds: 13 });
  assert.deepEqual(fast.log.map((l) => l.name), again.log.map((l) => l.name), "the same seed, the same order");
  assert.deepEqual([...fast.posts, ...again.posts, ...demo.posts], []);
});
