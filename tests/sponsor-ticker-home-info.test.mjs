// Sponsor ticker 1.6.0: the overlay tells the site which sponsor is on screen (route `shown`), and the module provides it as the topic `home.info` (read by the Home Assistant connector).
// No network, no browser: the clock is simulated (Date only), the topics are stubs. Invented names only.
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
const def = tk.default;
const { cleanInfo } = await import("../modules/home-assistant/info.mjs");

const T0 = Date.parse("2026-10-14T20:00:00Z");
const CARDS = [{ id: "n", name: "Etoile Nord", text: "A short text", url: "https://etoile-nord.test", page: "https://site.example.org/sponsors/etoile-nord", code: "NORD10" }, { id: "l", name: "Lune Douce" }];
const ENTRIES = [{ path: "/codes/camille", title: "Offre Camille", code: "CAM5" }, { path: "/blog/no-code", title: "Not a sponsor" }];

/** A ticker instance (`key`) with the real texts; `cards` and `entries` are what the two topics answer. */
function make({ key = "ticker", locale = "en", settings = {}, cards = CARDS, entries = ENTRIES } = {}) {
  const ctx = fakeCtx({ key, name: "Sponsors", locale, messages: locale === "fr" ? fr : en, settings, topics: { "sponsor.card": () => cards, "core.entry": () => entries } });
  ctx.api.siteUrl = "https://site.example.org";
  ctx.api.qr = async (t) => `<svg data-qr="${t}"></svg>`;
  return ctx;
}
const clock = () => { tk.resetShown(); mock.timers.reset(); mock.timers.enable({ apis: ["Date"], now: T0 }); return { tick: (ms) => mock.timers.tick(ms), done: () => mock.timers.reset() }; };
const post = (ctx, body, init = {}) => def.routes.shown(new Request(`https://site.example.org/m/${ctx.instance.key}/shown`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body), ...init }), ctx);
const valueOf = async (ctx) => (await def.exports["home.info"](ctx))[0].value;

/* ───────────── the route ───────────── */

test("shown: a valid id is accepted, answered {ok:true} without cache, and the NAME comes from the server", async () => {
  const w = clock();
  const ctx = make();
  assert.equal(await valueOf(ctx), null, "nothing reported yet");
  const res = await post(ctx, { id: "s:n", name: "Hacked name", until: 1e15 });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(res.headers.get("content-type"), /json/);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(await valueOf(ctx), "Etoile Nord", "never the name sent by the caller");
  assert.equal(tk.shownSponsor(ctx).until, T0 + 10_000 + 10_000, "until = now + holdSeconds + 10 s");
  w.done();
});

test("shown: ids are those of the items: `s:<id>` for a sponsor card, `e:<path>` for an entry, `s:<name>` when a card has no id", async () => {
  const w = clock();
  const ctx = make({ cards: [{ name: "Sans id" }, ...CARDS] });
  assert.equal((await post(ctx, { id: "e:/codes/camille" })).status, 200);
  assert.equal(await valueOf(ctx), "Offre Camille");
  assert.equal((await post(ctx, { id: "s:Sans id" })).status, 200);
  assert.equal(await valueOf(ctx), "Sans id");
  const items = (await (await def.routes.items(new Request("https://site.example.org/m/ticker/items"), ctx)).json()).items;
  for (const i of items) { w.tick(2100); assert.equal((await post(ctx, { id: i.id })).status, 200, `the id ${i.id} sent by /items is accepted by /shown`); assert.equal(await valueOf(ctx), i.name); }
  w.done();
});

test("shown: an unknown id, an entry without code or link, or the demo card are refused (400) and change nothing", async () => {
  const w = clock();
  const ctx = make();
  await post(ctx, { id: "s:l" });
  for (const id of ["s:nobody", "e:/blog/no-code", "e:/codes/camille ", "S:l", "n", "", "demo", "s:", "x".repeat(400)]) {
    w.tick(500);
    const res = await post(ctx, { id });
    assert.equal(res.status, 400, `id ${JSON.stringify(id.slice(0, 20))}`);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { ok: false, error: "bad_request" });
  }
  assert.equal(await valueOf(ctx), "Lune Douce", "what was shown before is untouched");
  w.done();
});

test("shown: a card that is no longer an item is refused", async () => {
  const w = clock();
  const cards = [...CARDS];
  const ctx = make({ cards });
  assert.equal((await post(ctx, { id: "s:l" })).status, 200);
  cards.length = 0;
  w.tick(2100);
  assert.equal((await post(ctx, { id: "s:l" })).status, 400);
  w.done();
});

test("shown: { id: null } clears", async () => {
  const w = clock();
  const ctx = make();
  await post(ctx, { id: "s:n" });
  assert.equal(await valueOf(ctx), "Etoile Nord");
  const res = await post(ctx, { id: null });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(await valueOf(ctx), null);
  assert.equal(tk.shownSponsor(ctx), null);
  w.done();
});

test("shown: a body that is not { id: string | null } is a bad request (400), without touching what was shown", async () => {
  const w = clock();
  const ctx = make();
  await post(ctx, { id: "s:n" });
  const bad = ["not json", "", "{", "null", "[]", "[\"s:n\"]", "\"s:n\"", "12", "true", "{}", "{\"name\":\"x\"}", "{\"id\":12}", "{\"id\":true}", "{\"id\":{}}", "{\"id\":[\"s:n\"]}", "{\"id\":undefined}"];
  for (const body of bad) {
    w.tick(500);
    const res = await post(ctx, body);
    assert.equal(res.status, 400, body);
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
  assert.equal(await valueOf(ctx), "Etoile Nord");
  w.done();
});

test("shown: a body over 512 bytes is refused (413), declared or not", async () => {
  const w = clock();
  const ctx = make();
  const big = JSON.stringify({ id: "s:n", pad: "x".repeat(600) });
  const res = await post(ctx, big);
  assert.equal(res.status, 413);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(await valueOf(ctx), null);
  w.tick(2100);
  assert.equal((await post(ctx, big, { headers: { "content-type": "application/json", "content-length": "9999" } })).status, 413);
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{\"id\":\"s:n\",\"pad\":\"")); c.enqueue(new TextEncoder().encode("y".repeat(600) + "\"}")); c.close(); } });
  w.tick(2100);
  assert.equal((await def.routes.shown(new Request("https://site.example.org/m/ticker/shown", { method: "POST", body: stream, duplex: "half" }), ctx)).status, 413);
  w.tick(2100);
  const exact = JSON.stringify({ id: "s:n", pad: "x".repeat(512 - JSON.stringify({ id: "s:n", pad: "" }).length) });
  assert.equal(Buffer.byteLength(exact), 512);
  assert.equal((await post(ctx, exact)).status, 200, "512 bytes pass");
  w.done();
});

test("shown: only POST (405 with Allow), whatever the rest", async () => {
  const w = clock();
  const ctx = make();
  for (const method of ["GET", "PUT", "DELETE", "PATCH", "HEAD"]) {
    const res = await def.routes.shown(new Request("https://site.example.org/m/ticker/shown", { method }), ctx);
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "POST");
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
  assert.equal(await valueOf(ctx), null);
  w.done();
});

test("shown: 30 calls a minute per instance, then 429 with Retry-After; the window slides", async () => {
  const w = clock();
  const ctx = make();
  for (let i = 0; i < 30; i++) { const res = await post(ctx, { id: i % 2 ? null : "s:n" }); assert.equal(res.status, 200, `call ${i + 1}`); w.tick(1000); }
  // 30 calls in 30 s: the 31st is too early (the first call is 30 s old, 30 s to wait)
  const limited = await post(ctx, { id: "s:n" });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("cache-control"), "no-store");
  assert.equal(limited.headers.get("retry-after"), "30");
  assert.deepEqual(await limited.json(), { ok: false, error: "rate_limited" });
  assert.equal(await valueOf(ctx), null, "a refused call changes nothing (the last accepted one cleared it)");
  w.tick(29_000);
  assert.equal((await post(ctx, { id: "s:n" })).status, 429, "still inside the minute of the first call");
  w.tick(1000);
  assert.equal((await post(ctx, { id: "s:n" })).status, 200, "the first call left the window");
  w.done();
});

test("shown: calls refused for a bad body or the wrong method count too, and one instance does not slow another", async () => {
  const w = clock();
  const a = make({ key: "ticker" }), b = make({ key: "other" });
  for (let i = 0; i < 30; i++) await post(a, "garbage");
  assert.equal((await post(a, { id: "s:n" })).status, 429);
  assert.equal((await def.routes.shown(new Request("https://site.example.org/m/ticker/shown"), a)).status, 405, "the wrong method is answered first, without counting");
  assert.equal((await post(b, { id: "s:n" })).status, 200, "another instance has its own limit");
  assert.equal(await valueOf(b), "Etoile Nord");
  assert.equal(await valueOf(a), null);
  w.done();
});

test("shown: the answer expires after the display time plus 10 s (the OBS page may be closed without a clear)", async () => {
  const w = clock();
  const ctx = make();   // holdSeconds default: 10
  await post(ctx, { id: "s:n" });
  w.tick(19_999);
  assert.equal(await valueOf(ctx), "Etoile Nord");
  w.tick(1);
  assert.equal(await valueOf(ctx), null, "20 s after: forgotten");
  assert.equal(tk.shownSponsor(ctx), null);
  w.done();
});

test("shown: the delay follows the module setting, clamped like the overlay does (3 to 120 s)", async () => {
  const w = clock();
  for (const [setting, hold] of [[30, 30], [1, 3], [500, 120], [undefined, 10], ["abc", 10]]) {
    tk.resetShown();
    const ctx = make({ settings: { holdSeconds: setting } });
    const t = Date.now();
    await post(ctx, { id: "s:n" });
    assert.equal(tk.shownSponsor(ctx).until, t + hold * 1000 + 10_000, `holdSeconds ${setting}`);
    w.tick(61_000);   // keeps the rate limit out of the way
  }
  w.done();
});

test("shown: a new card replaces the previous one, and the memory is per instance", async () => {
  const w = clock();
  const a = make({ key: "ticker" }), b = make({ key: "other" });
  await post(a, { id: "s:n" });
  await post(b, { id: "e:/codes/camille" });
  w.tick(2100);
  await post(a, { id: "s:l" });
  assert.equal(await valueOf(a), "Lune Douce");
  assert.equal(await valueOf(b), "Offre Camille");
  assert.equal((await def.exports["home.info"](a))[0].key, "sponsor-ticker.ticker");
  assert.equal((await def.exports["home.info"](b))[0].key, "sponsor-ticker.other");
  w.done();
});

test("shown: a topic that fails answers 503 (never an internal error) and changes nothing", async () => {
  const w = clock();
  const ctx = make();
  ctx.api.topics.collect = async () => { throw new Error("secret internal detail"); };
  const res = await post(ctx, { id: "s:n" });
  assert.equal(res.status, 503);
  assert.ok(!(await res.text()).includes("secret"));
  assert.equal(await valueOf(ctx), null);
  w.done();
});

/* ───────────── the provided topic ───────────── */

test("home.info: one item with the instance key, the label in the language of the site, and null when nothing is shown", async () => {
  const w = clock();
  for (const [locale, label] of [["en", "Sponsor on screen"], ["fr", "Sponsor \u00e0 l'\u00e9cran"]]) {
    const ctx = make({ locale });
    assert.deepEqual(await def.exports["home.info"](ctx), [{ key: "sponsor-ticker.ticker", label, value: null }]);
  }
  const ctx = make();
  await post(ctx, { id: "s:n" });
  assert.deepEqual(await def.exports["home.info"](ctx), [{ key: "sponsor-ticker.ticker", label: "Sponsor on screen", value: "Etoile Nord" }]);
  assert.deepEqual(cleanInfo(await def.exports["home.info"](ctx)), [{ key: "sponsor-ticker.ticker", label: "Sponsor on screen", value: "Etoile Nord" }], "what the Home Assistant connector keeps of it");
  w.done();
});

test("manifest: provides home.info (EN and FR labels), 1.6.0, still valid, locales in parity", () => {
  const r = parseManifest(manifest);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.version, "1.6.0");
  const p = manifest.provides.find((x) => x.topic === "home.info");
  assert.ok(p && p.label.en?.trim() && p.label.fr?.trim());
  assert.ok(manifest.permissions.includes("topics") && manifest.permissions.includes("routes"));
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  assert.ok(fr.homeInfoLabel && en.homeInfoLabel);
  assert.deepEqual(Object.keys(def.routes).sort(), ["items", "shown"]);
  assert.equal(typeof def.exports["home.info"], "function");
});

/* ───────────── the overlay page ───────────── */

const pageOf = (settings = {}, query = "", key = "ticker") => def.overlay(make({ key, settings }), { query: new URLSearchParams(query) });
const cfgOf = (out) => JSON.parse(out.script.match(/^\(function\(\)\{var c=(\{.*?\}),slider=/s)[1]);
const compiles = (out) => assert.doesNotThrow(() => new vm.Script(out.script), "the page script is valid JavaScript");

test("page: the standalone overlay reports to /m/<key>/shown", () => {
  const out = pageOf();
  assert.equal(cfgOf(out).reportUrl, "/m/ticker/shown");
  assert.equal(cfgOf(pageOf({}, "", "my-ticker")).reportUrl, "/m/my-ticker/shown");
  compiles(out);
  assert.match(out.script, /function report\(id\)\{try\{fetch\(c\.reportUrl,\{method:"POST",keepalive:true,headers:\{"content-type":"application\/json"\},body:JSON\.stringify\(\{id:id\}\)\}\)\.catch\(function\(\)\{\}\)\}catch\(e\)\{\}\}/);
  // the card is reported right when it goes in, and the clear is sent when it starts to leave
  assert.match(out.script, /go\("in"\);report\(s\.id\);clearTimeout\(hold\);hold=setTimeout\(function\(\)\{report\(null\);go\("out"\)\}/);
});

test("page: also reports inside an overlay page (element), with its options", () => {
  for (const q of ["ov-w=720&ov-h=180&ov-tv=1", "ov-w=720&ov-h=180&ov-tv=2&opt-qr=0&ov-text=dark&ov-surface=soft"]) {
    const out = pageOf({}, q);
    assert.equal(cfgOf(out).reportUrl, "/m/ticker/shown", q);
    compiles(out);
  }
});

test("page: no reporting in the test page (ov-demo=1) nor in the fast developer mode (dev=1 with the setting on)", () => {
  for (const [settings, q] of [[{}, "ov-w=720&ov-h=180&ov-demo=1"], [{ devMode: true }, "dev=1"], [{ devMode: true }, "dev=1&seed=7"], [{ devMode: true }, "ov-w=720&ov-h=180&dev=1"]]) {
    const out = pageOf(settings, q);
    assert.ok(!("reportUrl" in cfgOf(out)), `${JSON.stringify(settings)} ${q}`);
    assert.ok(!/report|\/shown/.test(out.script), "not a trace of the feature in the script");
    compiles(out);
  }
});

test("page: the developer mode setting alone, or dev=1 while the setting is off, do not switch reporting off", () => {
  assert.equal(cfgOf(pageOf({ devMode: true }, "")).reportUrl, "/m/ticker/shown");
  assert.equal(cfgOf(pageOf({ devMode: true }, "seed=3")).reportUrl, "/m/ticker/shown", "a seed alone is not the fast mode");
  assert.equal(cfgOf(pageOf({}, "dev=1")).reportUrl, "/m/ticker/shown", "dev=1 is ignored while the setting is off");
});

test("page: with reporting off the script is the one without the feature (the config has no reportUrl, nothing else differs from the reporting page)", () => {
  const on = pageOf({}, "ov-w=720&ov-h=180&ov-tv=1"), off = pageOf({}, "ov-w=720&ov-h=180&ov-tv=1&ov-demo=1");
  const strip = (s) => s.replace(",\"reportUrl\":\"/m/ticker/shown\"", "").replace(/ function report\(id\)\{try\{.*?\}catch\(e\)\{\}\}/, "").replace("report(s.id);", "").replace("report(null);", "");
  assert.equal(strip(on.script).length > 0 && !/report/.test(strip(on.script)), true, "everything the feature adds is accounted for");
  assert.equal(on.html, off.html);
  assert.equal(on.css, off.css);
  assert.ok(on.script.length > off.script.length);
  // the demo page differs by its own config (period, hold, startDelay, itemsUrl) only: after the same stripping, the code around is the same text
  const code = (s) => s.replace(/^\(function\(\)\{var c=\{.*?\},slider=/s, "(function(){var c={},slider=");
  assert.equal(code(strip(on.script)), code(off.script));
});
