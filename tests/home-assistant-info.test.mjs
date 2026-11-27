// Home Assistant: the `home.info` topic (small display information from other modules) and the `info` field of `pull`.
// No network: the topic is a stub, the clock is simulated, a fake Home Assistant (helpers/fakeHaClient.mjs) speaks the HTTP contract. Invented names only.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { FakeHaClient, directTransport } from "./helpers/fakeHaClient.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/home-assistant", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json"), fr = readJson("locales/fr.json");
const def = (await import("../modules/home-assistant/index.mjs")).default;
const B = await import("../modules/home-assistant/bridge.mjs");
const L = await import("../modules/home-assistant/live.mjs");
const I = await import("../modules/home-assistant/info.mjs");

const T0 = Date.parse("2026-10-14T20:00:00Z");
const defaults = Object.fromEntries(manifest.settings.filter((s) => s.default !== undefined).map((s) => [s.key, s.default]));

/** A site with the bridge installed; `info` is what the topic `home.info` answers (a function of the options; every read is counted in `calls`); `live` is what the live source answers. */
function world(info = () => [], { live = true } = {}) {
  B.resetMemory(); L.resetLive();
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: T0 });
  const calls = [];
  const ctx = fakeCtx({
    key: "ha", moduleId: "home-assistant", name: "Home Assistant", basePath: "", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: fr,
    settings: { ...defaults }, permissions: manifest.permissions, siteUrl: "https://site.example.org",
    serviceInstances: { "twitch.live": [{ instance: "chan", methods: { status: () => ({ known: true, live }) } }] },
    topics: { "home.info": (opts) => { calls.push(opts); return info(opts); } },
  });
  ctx.can = () => true;
  return { ctx, calls, tick: (ms) => mock.timers.tick(ms), done: () => mock.timers.reset() };
}
async function pairUp(w) {
  const { code } = await B.createPairing(w.ctx);
  const ha = new FakeHaClient({ send: directTransport(def, w.ctx), bindings: {} });
  assert.equal((await ha.pair(code, "Maison")).status, 200);
  return ha;
}
/** A bare context for the unit tests of info.mjs: only what `infoNow` reads. */
const stub = (collect, key = "ha") => ({ instance: { key }, api: { topics: { collect } } });

/* ───────────── cleanInfo ───────────── */

test("cleanInfo: a clean item keeps key, label and value; the label falls back to the key", () => {
  assert.deepEqual(I.cleanInfo([{ key: "sponsor.etoile_nord", label: "Sponsor on screen", value: "Etoile Nord" }, { key: "no-label", value: 3 }]), [
    { key: "sponsor.etoile_nord", label: "Sponsor on screen", value: "Etoile Nord" },
    { key: "no-label", label: "no-label", value: 3 },
  ]);
  assert.deepEqual(I.cleanInfo(null), []);
  assert.deepEqual(I.cleanInfo("x"), []);
  assert.deepEqual(I.cleanInfo({ key: "a" }), []);
});

test("cleanInfo: keys outside the allowed form are dropped, the first of a repeated key wins", () => {
  const bad = ["", "A", "Upper", "-start", ".start", "has space", "slash/slash", "é", "x".repeat(61), 12, null, undefined, {}, ["a"]];
  assert.deepEqual(I.cleanInfo(bad.map((key) => ({ key, label: "L", value: "v" }))), []);
  assert.deepEqual(I.cleanInfo([null, undefined, 3, "s", [], { label: "no key" }]), []);
  const ok = ["a", "0", "a.b", "a:b", "a_b", "a-b", "x".repeat(60)];
  assert.equal(I.cleanInfo(ok.map((key) => ({ key }))).length, ok.length);
  assert.deepEqual(I.cleanInfo([{ key: "dup", label: "first", value: 1 }, { key: "dup", label: "second", value: 2 }, { key: "other", value: 3 }]).map((i) => [i.key, i.label]), [["dup", "first"], ["other", "other"]]);
});

test("cleanInfo: 20 items at most", () => {
  const out = I.cleanInfo(Array.from({ length: 25 }, (_, n) => ({ key: `k${n}`, label: `L${n}`, value: n })));
  assert.equal(out.length, 20);
  assert.equal(out[19].key, "k19");
  const withBad = I.cleanInfo([...Array.from({ length: 10 }, (_, n) => ({ key: `BAD${n}` })), ...Array.from({ length: 25 }, (_, n) => ({ key: `k${n}` }))]);
  assert.equal(withBad.length, 20, "dropped items do not count");
});

test("cleanInfo: label and string value are cleaned text, cut by code points", () => {
  const [a] = I.cleanInfo([{ key: "a", label: "abcdefghij".repeat(20), value: "klmnopqrst".repeat(50) }]);
  assert.equal([...a.label].length, 60);
  assert.equal([...a.value].length, 120);
  const [b] = I.cleanInfo([{ key: "b", label: "\u{1F600}".repeat(100), value: "\u{1F31F}".repeat(300) }]);
  assert.ok([...b.label].length <= 60 && [...b.value].length <= 120, "cut by code points, never in the middle of one");
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(b.label + b.value), "no lone surrogate");
  const [c] = I.cleanInfo([{ key: "c", label: "<b>Bold</b>  label​", value: "  see https://evil.example/x and @someone  " }]);
  assert.equal(c.label, "Bold label");
  assert.ok(!/https?:|evil\.example|@/.test(c.value), c.value);
  const [d] = I.cleanInfo([{ key: "d", label: "   ", value: "   " }]);
  assert.deepEqual(d, { key: "d", label: "d", value: null }, "empty after cleaning: label = key, value = null");
  const [e] = I.cleanInfo([{ key: "e", label: { toString: () => "object label" }, value: "ok" }]);
  assert.equal(e.label, "e", "a label that is not a text is not trusted");
});

test("cleanInfo: a value is a string, a finite number below 1e12, a boolean or null; anything else is null", () => {
  const value = (v) => I.cleanInfo([{ key: "v", value: v }])[0].value;
  assert.equal(value("text"), "text");
  assert.equal(value(0), 0);
  assert.equal(value(-12.5), -12.5);
  assert.equal(value(999_999_999_999), 999_999_999_999);
  assert.equal(value(true), true);
  assert.equal(value(false), false);
  assert.equal(value(null), null);
  assert.equal(value(undefined), null);
  for (const hostile of [1e12, -1e12, 1e300, Infinity, -Infinity, NaN, {}, { a: 1 }, [], ["x"], () => "x", Symbol("s"), 10n, new Date(0), { toString: () => "x" }]) assert.equal(value(hostile), null, String(typeof hostile));
  assert.equal(value("​​"), null, "empty after cleaning is null");
  assert.ok(!/<|>/.test(value("<script>alert(1)</script>") ?? ""), "markup is stripped");
});

test("cleanInfo: the unit is kept only for a number, cleaned, 12 code points at most", () => {
  const one = (x) => I.cleanInfo([{ key: "u", ...x }])[0];
  assert.deepEqual(one({ value: 12, unit: "viewers" }), { key: "u", label: "u", value: 12, unit: "viewers" });
  assert.equal(one({ value: 12, unit: "abcdefghij".repeat(4) }).unit.length, 12);
  assert.ok(!("unit" in one({ value: "text", unit: "kg" })), "string value: no unit");
  assert.ok(!("unit" in one({ value: true, unit: "kg" })));
  assert.ok(!("unit" in one({ value: null, unit: "kg" })));
  assert.ok(!("unit" in one({ value: Infinity, unit: "kg" })), "a refused number is null: no unit");
  assert.ok(!("unit" in one({ value: 3, unit: "   " })));
  assert.ok(!("unit" in one({ value: 3, unit: { a: 1 } })));
  assert.ok(!("unit" in one({ value: 3 })));
  assert.deepEqual(Object.keys(one({ value: 3, unit: "kg", extra: "ignored" })).sort(), ["key", "label", "unit", "value"], "nothing else is passed along");
});

/* ───────────── infoNow: cache, delay, failure ───────────── */

test("infoNow: asks the topic with a limit of 20, keeps the answer 5 s", async () => {
  I.resetInfo();
  const seen = [];
  const ctx = stub(async (topic, opts) => { seen.push([topic, opts]); return [{ key: "a", label: "A", value: seen.length }]; });
  assert.deepEqual(await I.infoNow(ctx, T0 + 1_000), [{ key: "a", label: "A", value: 1 }]);
  assert.deepEqual(seen[0], ["home.info", { limit: 20 }]);
  assert.deepEqual(await I.infoNow(ctx, T0 + 5_999), [{ key: "a", label: "A", value: 1 }], "under 5 s: the memory");
  assert.equal(seen.length, 1);
  assert.deepEqual(await I.infoNow(ctx, T0 + 6_000), [{ key: "a", label: "A", value: 2 }], "5 s: read again");
  assert.equal(seen.length, 2);
  assert.deepEqual(await I.infoNow(ctx, T0 + 10_000, { fetch: false }), [{ key: "a", label: "A", value: 2 }], "fetch: false only reads the memory");
  assert.equal(seen.length, 2);
});

test("infoNow: the cache is per instance", async () => {
  I.resetInfo();
  const mk = (value) => stub(async () => [{ key: "k", value }], `inst-${value}`);
  const a = mk("one"), b = mk("two");
  assert.equal((await I.infoNow(a, T0 + 1000))[0].value, "one");
  assert.equal((await I.infoNow(b, T0 + 1000))[0].value, "two");
  assert.equal((await I.infoNow(a, T0 + 2000))[0].value, "one");
});

test("infoNow: a failure keeps the last known list and waits 15 s before trying again", async () => {
  I.resetInfo();
  let mode = "ok", n = 0;
  const ctx = stub(async () => { n++; if (mode === "throw") throw new Error("boom"); if (mode === "none") return null; if (mode === "garbage") return { not: "a list" }; return [{ key: "a", label: "A", value: "kept" }]; });
  assert.equal((await I.infoNow(ctx, T0 + 0))[0].value, "kept");
  mode = "throw";
  assert.equal((await I.infoNow(ctx, T0 + 5_000))[0].value, "kept", "a throwing provider: the last list");
  assert.equal(n, 2);
  mode = "ok";
  assert.equal((await I.infoNow(ctx, T0 + 19_999))[0].value, "kept");
  assert.equal(n, 2, "no new try before 15 s");
  mode = "none";
  assert.equal((await I.infoNow(ctx, T0 + 20_000)).length, 1, "nothing answered: the last list");
  assert.equal(n, 3);
  mode = "garbage";
  assert.equal((await I.infoNow(ctx, T0 + 35_000)).length, 1, "not a list: the last list");
  assert.equal(n, 4);
  mode = "ok";
  assert.equal((await I.infoNow(ctx, T0 + 50_000))[0].value, "kept");
  assert.equal(n, 5);
  assert.deepEqual(await I.infoNow(ctx, T0 + 50_001), [{ key: "a", label: "A", value: "kept" }]);
  assert.equal(n, 5, "a good answer is cached again");
});

test("infoNow: an empty list from the provider replaces the old one (the provider has nothing to say)", async () => {
  I.resetInfo();
  let list = [{ key: "a", value: 1 }];
  const ctx = stub(async () => list);
  assert.equal((await I.infoNow(ctx, T0 + 0)).length, 1);
  list = [];
  assert.deepEqual(await I.infoNow(ctx, T0 + 6_000), []);
});

test("infoNow: no topic API gives an empty list; a provider that never answers is given up after 1.5 s", async () => {
  I.resetInfo();
  assert.deepEqual(await I.infoNow({ instance: { key: "none" }, api: {} }, T0 + 0), []);
  assert.deepEqual(await I.infoNow({ instance: { key: "none2" } }, T0 + 0), []);
  const ctx = stub(() => new Promise(() => {}), "slow");
  const t0 = performance.now();
  assert.deepEqual(await I.infoNow(ctx, T0 + 0), []);
  const took = performance.now() - t0;
  assert.ok(took >= 1400 && took < 4000, `waited ${Math.round(took)} ms`);
});

/* ───────────── pull ───────────── */

test("pull: `info` is always there, additive, empty without any provider", async () => {
  const w = world(() => []);
  const ha = await pairUp(w);
  const r = await ha.pull();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["actions", "catalog", "cursor", "enabled", "info", "live", "pollSeconds", "serverTime"]);
  assert.deepEqual(r.body.info, []);
  w.done();
});

test("pull: carries the cleaned items of the topic, next to `catalog`", async () => {
  const w = world(() => [
    { key: "sponsor-ticker.sponsors", label: "Sponsor on screen", value: "Etoile Nord" },
    { key: "BAD KEY", label: "x", value: "y" },
    { key: "viewers", label: "Viewers", value: 42, unit: "people" },
    { key: "hostile", label: "<i>H</i>", value: { a: 1 } },
  ]);
  const ha = await pairUp(w);
  const r = await ha.pull();
  assert.deepEqual(r.body.info, [
    { key: "sponsor-ticker.sponsors", label: "Sponsor on screen", value: "Etoile Nord" },
    { key: "viewers", label: "Viewers", value: 42, unit: "people" },
    { key: "hostile", label: "H", value: null },
  ]);
  assert.deepEqual(r.body.catalog, []);
  w.done();
});

test("pull: `info` is display data, never filtered by `enabled`", async () => {
  const w = world(() => [{ key: "a", label: "A", value: "shown" }]);
  const ha = await pairUp(w);
  await ha.pull(); w.tick(1100);
  assert.equal((await def.services["home-assistant.bridge"].stop(w.ctx, { by: "owner" })).ok, true);
  w.tick(1100);
  const cut = await ha.pull();
  assert.equal(cut.body.enabled, false);
  assert.deepEqual(cut.body.actions, []);
  assert.deepEqual(cut.body.info.map((i) => i.value), ["shown"], "everything is cut: the information is still there");
  w.done();
});

test("pull: `info` is also there when the channel is not live", async () => {
  const w = world(() => [{ key: "a", label: "A", value: true }], { live: false });
  const ha = await pairUp(w);
  const r = await ha.pull();
  assert.equal(r.body.live, false);
  assert.deepEqual(r.body.info, [{ key: "a", label: "A", value: true }]);
  w.done();
});

test("pull: the topic is read at most every 5 s however often Home Assistant comes", async () => {
  const w = world(() => [{ key: "n", label: "N", value: w.calls.length }]);
  const ha = await pairUp(w);
  const first = await ha.pull();
  assert.equal(w.calls.length, 1);
  assert.deepEqual(w.calls[0], { limit: 20 });
  for (let i = 0; i < 3; i++) { w.tick(1100); const r = await ha.pull(); assert.deepEqual(r.body.info, first.body.info); }
  assert.equal(w.calls.length, 1, "four pulls in 3.3 s, one read");
  w.tick(2000);
  const later = await ha.pull();
  assert.equal(w.calls.length, 2);
  assert.equal(later.body.info[0].value, 2, "the new answer");
  w.done();
});

test("pull: a failing provider does not break the poll and keeps the last list; retried after 15 s only", async () => {
  let fail = false;
  const w = world(() => { if (fail) throw new Error("provider down"); return [{ key: "a", label: "A", value: "last" }]; });
  const ha = await pairUp(w);
  assert.deepEqual((await ha.pull()).body.info.map((i) => i.value), ["last"]);
  fail = true; w.tick(6000);
  const r = await ha.pull();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.info.map((i) => i.value), ["last"]);
  const n = w.calls.length;
  w.tick(6000); await ha.pull();
  assert.equal(w.calls.length, n, "no new try within 15 s of the failure");
  w.tick(10_000); await ha.pull();
  assert.equal(w.calls.length, n + 1);
  w.done();
});

test("pull: an unauthenticated call gets no `info` and never wakes the provider", async () => {
  const w = world(() => [{ key: "secret", label: "Secret", value: "must not leak" }]);
  await pairUp(w);
  for (const headers of [{}, { Authorization: "Bearer " + "z".repeat(43) }, { Authorization: "Basic abc" }]) {
    const res = await def.routes.pull(new Request("https://site.example.org/m/ha/pull", { headers }), w.ctx);
    assert.equal(res.status, 401);
    const text = await res.text();
    assert.ok(!/info|must not leak|secret/i.test(text), text);
    w.tick(1100);
  }
  assert.equal(w.calls.length, 0, "the topic is not read for a caller that is not authenticated");
  w.done();
});

test("manifest: `home.info` is consumed (optional topic, no new need), FR and EN labels", () => {
  const r = parseManifest(manifest);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.version, "1.5.1");
  const c = manifest.consumes.find((x) => x.topic === "home.info");
  assert.ok(c, "declared under consumes");
  assert.ok(c.label.fr?.trim() && c.label.en?.trim());
  assert.deepEqual(c.schema.map((s) => s.key), ["key", "label", "value", "unit"]);
  assert.ok(manifest.permissions.includes("topics"));
  assert.ok(manifest.consumes.some((x) => x.topic === "home.actions"), "home.actions is still there");
  assert.deepEqual(manifest.requires.map((x) => x.optional), [true, true], "no new hard need");
});
