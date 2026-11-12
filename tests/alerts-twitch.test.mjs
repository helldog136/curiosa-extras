// Alerts overlay 1.4.0: the Twitch alerts (topic `twitch.event`): templates, switches, minimums, ignore list, burst grouping, pause that holds, memory across a restart,
// the page that queues (never replaces an alert on screen), the admin tab, the queue service and the tools for assistants.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { runOverlayPage } from "./helpers/overlayPageDom.mjs";

const DIR = new URL("../modules/alerts-overlay", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json");
const tw = await import("../modules/alerts-overlay/twitch.mjs");
const adminTw = await import("../modules/alerts-overlay/twitch-admin.mjs");
const mod = await import("../modules/alerts-overlay/index.mjs");
const def = mod.default;

const NOW = Date.parse("2026-11-12T20:00:00Z");
let n = 0;
const HERE = [{ id: "te", key: "events", module: "twitch-events", basePath: "", name: "Twitch activity", adminPath: "/admin/instances/te" }];
function world({ settings = {}, locale = "en", here = true, items = [] } = {}) {
  const key = `tw${++n}`, state = { items };
  const ctx = fakeCtx({ key, locale, messages: readJson(`locales/${locale}.json`), settings: { pushToken: "secret", groupSeconds: 0, ...settings }, instances: here ? HERE : [], topics: { "twitch.event": () => state.items.slice() }, permissions: manifest.permissions });
  const out = []; const emit = (a) => out.push(a);
  return { key, ctx, state, out, emit, pull: (now = NOW) => tw.pullTwitch(ctx, emit, mod.twitchEnv(ctx, now)) };
}
let seq = 0;
const item = (type, o = {}) => ({ id: `e${++seq}`, type, at: new Date(NOW - 1000).toISOString(), ...o });
const T = (ctx) => ctx.t;

test("templates: unknown words are found, values are filled, nothing is left over, the result is plain and bounded", () => {
  assert.deepEqual(tw.unknownWords("{name} {oops} {count} {}"), ["oops", ""]);
  assert.equal(tw.fillTemplate("{name} sends {amount} bits{tier}", { name: "Camille", amount: "500" }), "Camille sends 500 bits");
  assert.equal(tw.fillTemplate("{name}‮\u0007  hello", { name: "Camille" }), "Camille hello");
  assert.equal(tw.fillTemplate("x".repeat(500), {}).length, 200);
  assert.equal(tw.fillTemplate("{__proto__} {constructor}", { name: "a" }), "");
});

test("config: unknown types dropped, switches boolean, template bounded, numbers in range, minimum only where it exists", () => {
  const c = tw.normaliseConfig({ preset: "zzz", types: { follow: { on: false, template: "x".repeat(500), seconds: "9999", min: 5 }, cheer: { min: "250", seconds: 1 }, bogus: { on: true } } });
  assert.equal(c.preset, "");
  assert.equal(c.types.follow.on, false); assert.equal(c.types.follow.template.length, tw.LIMITS.template); assert.equal(c.types.follow.seconds, 60); assert.equal(c.types.follow.min, 0);
  assert.equal(c.types.cheer.min, 250); assert.equal(c.types.cheer.seconds, 0, "below 2 seconds = the default");
  assert.equal(c.types.bogus, undefined); assert.equal(c.types.raid.on, true);
});

const base = (ctx, over = {}) => ({ config: tw.normaliseConfig({}), ignore: new Set(), showText: false, locale: "en", text: (k) => ctx.t(`tw_text_${k}`), title: (p) => ctx.t(`tw_title_${p}`), seconds: 0, now: NOW, ...over });

test("alertFor: every type reads well; anonymous, hype title, duration, viewer text only when allowed", () => {
  const { ctx } = world();
  const f = (it, o) => tw.alertFor(it, base(ctx, o));
  assert.equal(f(item("follow", { name: "Camille" })).alert.message, "Camille follows you");
  assert.equal(f(item("sub", { name: "etoile_nord", tier: "2" })).alert.message, "etoile_nord subscribed · tier 2");
  assert.equal(f(item("resub", { name: "lune_douce", months: 12, text: "hello" })).alert.message, "lune_douce renews · 12 months");
  assert.equal(f(item("resub", { name: "lune_douce", months: 12, text: "hello" })).alert.detail, undefined, "the viewer's message stays hidden by default");
  assert.equal(f(item("resub", { name: "lune_douce", months: 12, text: "hello" }), { showText: true }).alert.detail, "hello");
  assert.equal(f(item("gift", { name: "Camille", count: 1250 })).alert.message, "Camille gifts 1,250 subs");
  assert.equal(f(item("gift", { anonymous: true, count: 5 })).alert.message, "Anonymous gifts 5 subs");
  assert.equal(f(item("cheer", { name: "etoile_nord", amount: 500 })).alert.message, "etoile_nord sends 500 bits");
  assert.equal(f(item("raid", { name: "lune_douce", viewers: 42 })).alert.message, "lune_douce raids with 42 viewers");
  assert.equal(f(item("online", { name: "Camille" })).alert.message, "The stream starts");
  assert.equal(f(item("redeem", { name: "lune_douce", title: "Hydrate" })).alert.message, "lune_douce redeems Hydrate");
  const h = f(item("hype_begin", { level: 1, total: 600 })).alert;
  assert.equal(h.title, "Hype train starts"); assert.equal(h.message, "Level 1 · 600 points");
  assert.equal(f(item("hype_end", { level: 3, total: 5400 })).alert.title, "Hype train over");
  assert.equal(f(item("follow", { name: "Camille" }), { seconds: 9 }).alert.duration, 9);
  assert.equal(f(item("follow", { name: "<img src=x onerror=1>" })).alert.message.includes("\n"), false);
  assert.equal(f(item("zzz")).skip, "unknown");
});

test("alertFor: switches, minimums, ignore list, gifted subs, age; a test or a replay skips every filter", () => {
  const { ctx } = world();
  const config = tw.normaliseConfig({ types: { follow: { on: false }, cheer: { min: 100 }, gift: { min: 3 }, raid: { min: 20 } } });
  const f = (it, o = {}) => tw.alertFor(it, base(ctx, { config, ...o }));
  assert.equal(f(item("follow", { name: "Camille" })).skip, "off");
  assert.ok(f(item("follow", { name: "Camille", test: true })).alert, "a test ignores the switch");
  assert.ok(f(item("follow", { name: "Camille", replay: true })).alert, "a replay ignores the switch too");
  assert.equal(f(item("cheer", { name: "a", amount: 99 })).skip, "small"); assert.ok(f(item("cheer", { name: "a", amount: 100 })).alert);
  assert.equal(f(item("gift", { name: "a", count: 2 })).skip, "small"); assert.equal(f(item("raid", { name: "a", viewers: 5 })).skip, "small");
  assert.equal(f(item("sub", { name: "a", gifted: true })).skip, "gifted");
  const ignore = tw.ignoreOf("@Etoile_Nord, lune_douce;x");
  assert.deepEqual([...ignore].sort(), ["etoile_nord", "lune_douce"], "short names are not names");
  assert.equal(f(item("sub", { name: "Etoile_Nord", login: "etoile_nord" }), { ignore }).skip, "ignored");
  assert.ok(f(item("sub", { name: "Etoile_Nord", login: "etoile_nord", test: true }), { ignore }).alert);
  assert.equal(f(item("sub", { name: "a", at: new Date(NOW - 6 * 60_000).toISOString() })).skip, "old");
  assert.equal(f(item("sub", { name: "a", at: new Date(NOW + 5 * 60_000).toISOString() })).skip, "old", "an event dated in the future is not trusted");
  assert.ok(f(item("sub", { name: "a", replay: true, at: new Date(NOW - 3600_000).toISOString() })).alert);
  assert.ok(f(item("sub", { name: "a", missed: true, at: new Date(NOW - 40 * 60_000).toISOString() })).alert, "a line found after a gap is kept up to an hour");
  assert.equal(f(item("sub", { name: "a", missed: true, at: new Date(NOW - 70 * 60_000).toISOString() })).skip, "old");
});

test("groupBurst: gifts by the same person become one alert with the total; three follows become one; fewer stay as they are", () => {
  const { ctx } = world();
  const shared = base(ctx);
  const stage = (its) => its.map((it) => { const r = tw.alertFor(it, shared); return { alert: r.alert, item: it, type: r.type }; });
  const g = tw.groupBurst(stage([item("gift", { name: "Camille", login: "camille", tier: "1", count: 1 }), item("raid", { name: "lune_douce", viewers: 30 }), item("gift", { name: "Camille", login: "camille", tier: "1", count: 4 }), item("gift", { name: "etoile_nord", login: "etoile_nord", tier: "1", count: 2 })]), { ...shared, config: shared.config });
  assert.deepEqual(g.map((a) => a.message), ["Camille gifts 5 subs", "lune_douce raids with 30 viewers", "etoile_nord gifts 2 subs"]);
  const f3 = tw.groupBurst(stage(["a", "b", "c", "d"].map((x) => item("follow", { name: `fan_${x}` }))), { ...shared });
  assert.equal(f3.length, 1); assert.equal(f3[0].message, "4 new followers, including fan_a");
  const f2 = tw.groupBurst(stage(["a", "b"].map((x) => item("follow", { name: `fan_${x}` }))), { ...shared });
  assert.deepEqual(f2.map((a) => a.message), ["fan_a follows you", "fan_b follows you"]);
});

test("pull: each event once, in order; filtered ones are remembered too; a restart (memory lost) does not show them again", async () => {
  const w = world();
  w.state.items = [item("follow", { name: "Camille", at: new Date(NOW - 3000).toISOString() }), item("sub", { name: "etoile_nord", tier: "1", at: new Date(NOW - 2000).toISOString() }), item("cheer", { name: "x", amount: 1, at: new Date(NOW - 1000).toISOString() })];
  await tw.saveConfig(w.ctx, { types: { cheer: { on: false } } });
  assert.equal(await w.pull(), 2);
  assert.deepEqual(w.out.map((a) => a.message), ["Camille follows you", "etoile_nord subscribed · tier 1"]);
  assert.equal(await w.pull(NOW + 2500), 0, "nothing new");
  tw.resetTwitchState();                                  // the server restarts: memory lost, the store remains
  assert.equal(await w.pull(NOW + 5000), 0, "already shown: not shown again");
  w.state.items.push(item("follow", { name: "lune_douce", at: new Date(NOW + 5000).toISOString() }));
  assert.equal(await w.pull(NOW + 6000), 1);
});

test("pull: the staging window groups a burst; events that wait are not lost by a restart", async () => {
  const w = world({ settings: { groupSeconds: 5 } });
  w.state.items = ["a", "b", "c"].map((x, i) => item("follow", { name: `fan_${x}`, at: new Date(NOW - 3000 + i).toISOString() }));
  w.state.items.push(item("gift", { name: "Camille", login: "camille", tier: "1", count: 3, at: new Date(NOW - 2000).toISOString() }), item("gift", { name: "Camille", login: "camille", tier: "1", count: 2, at: new Date(NOW - 1900).toISOString() }), item("raid", { name: "lune_douce", viewers: 40, at: new Date(NOW - 1000).toISOString() }));
  assert.equal(await w.pull(NOW), 1, "the raid is immediate; follows and gifts wait for the window");
  assert.equal(w.out[0].message, "lune_douce raids with 40 viewers");
  tw.resetTwitchState();                                  // restart while they wait: they come back from the topic
  assert.equal(await w.pull(NOW + 1000), 0);
  assert.equal(await w.pull(NOW + 6500), 2, "after the window: one group of followers and one total of gifts");
  assert.deepEqual(w.out.slice(1).map((a) => a.message).sort(), ["3 new followers, including fan_a", "Camille gifts 5 subs"]);
  assert.equal(await w.pull(NOW + 20_000), 0);
});

test("pause HOLDS the alerts (and keeps them across a restart); resume releases them in order; empty drops them and tells the pages", async () => {
  const w = world();
  assert.deepEqual(await tw.pause(w.ctx), { paused: true, held: 0 });
  w.state.items = [item("follow", { name: "Camille" }), item("sub", { name: "etoile_nord", tier: "1" })];
  assert.equal(await w.pull(), 0);
  assert.deepEqual(await tw.queueState(w.ctx), { paused: true, held: 2, staged: 0 });
  tw.resetTwitchState();
  assert.deepEqual(await tw.queueState(w.ctx), { paused: true, held: 2, staged: 0 }, "pause and held alerts survive a restart");
  const r = await tw.resume(w.ctx, w.emit);
  assert.equal(r.released, 2); assert.deepEqual(w.out.map((a) => a.message), ["Camille follows you", "etoile_nord subscribed · tier 1"]);
  await tw.pause(w.ctx);
  w.state.items.push(item("follow", { name: "lune_douce" }));
  await w.pull();
  const c = await tw.clearQueue(w.ctx, w.emit);
  assert.equal(c.dropped, 1); assert.equal(w.out.at(-1).control, "clear");
  assert.equal((await tw.queueState(w.ctx)).held, 0);
  assert.equal((await tw.resume(w.ctx, w.emit)).released, 0);
});

test("the page: every alert waits for the one on screen, with a pause between, a title and a duration of its own, and 'empty the queue' clears it", async (t) => {
  let clock = NOW;
  t.mock.method(Date, "now", () => clock);
  const w = world({ settings: { minGapSeconds: 2, durationSeconds: 6 } });
  await tw.saveConfig(w.ctx, { types: { raid: { seconds: 10 } } });
  const out = await def.overlay(w.ctx, { query: new URLSearchParams({ "ov-w": "640", "ov-h": "260", "ov-fit": "scale", "ov-lang": "en", "ov-text": "light" }) });
  const page = runOverlayPage(out, { dispatch: (url) => def.routes.feed(new Request(url), w.ctx) });
  const adv = async (ms) => { clock += ms; await page.advance(ms); };
  await adv(10);
  const at = (s) => new Date(clock - s).toISOString();
  w.state.items = [item("follow", { name: "Camille", at: at(3000) }), item("raid", { name: "lune_douce", viewers: 7, at: at(2000) }), item("hype_begin", { level: 1, total: 600, at: at(1000) })];
  await adv(2100);
  assert.deepEqual(page.shown.map((s) => s.message), ["Camille follows you"], "the others wait, none replaces it");
  await adv(5000);
  assert.deepEqual(page.shown.map((s) => s.message), ["Camille follows you"], "still on screen");
  await adv(3000);                                        // 6 s on screen, then 2 s of pause
  assert.deepEqual(page.shown.map((s) => s.message), ["Camille follows you", "lune_douce raids with 7 viewers"]);
  assert.equal(page.shown[1].kind, "Raid");
  await adv(9000);                                        // the raid lasts 10 s: still there
  assert.equal(page.shown.length, 2);
  await adv(4000);
  assert.equal(page.shown.at(-1).kind, "Hype train starts", "a hype train line carries its own title");
  assert.match(out.script, /"between":2000/);
  // empty the queue: what waits is dropped and the card on screen goes away
  w.state.items.push(item("follow", { name: "fan_1", at: at(500) }), item("follow", { name: "fan_2", at: at(400) }));
  await adv(2100);
  const before = page.shown.length;
  await tw.clearQueue(w.ctx, (a) => mod.emit(w.key, a));
  await adv(2100);
  await adv(30_000);
  assert.equal(page.shown.length, before, "nothing more appears after the queue is emptied");
});

test("without Twitch activity the page and the pushed alerts are exactly as before (no title, no pause, no clear)", async () => {
  const w = world({ here: false });
  const out = await def.overlay(w.ctx, { query: new URLSearchParams({ "ov-w": "640", "ov-h": "260", "ov-fit": "scale" }) });
  assert.ok(!/between|e\.title|control/.test(out.script));
  assert.ok(!out.script.includes("tw_"));
});

test("pull route: reads the topic only when asked, at most every 2 seconds, and a broken topic never breaks the page", async () => {
  const w = world();
  w.state.items = [item("follow", { name: "Camille" })];
  const got = []; globalThis.__curiosaAlertsBus.on(w.key, (e) => got.push(e));
  const r = await mod.pullLive(w.ctx, NOW);
  assert.equal(r.sent, 1); assert.equal(got[0].message, "Camille follows you");
  assert.equal((await mod.pullLive(w.ctx, NOW + 500)).throttled, true);
  const bad = world(); bad.ctx.api.topics.collect = async () => { throw new Error("boom"); };
  assert.equal((await mod.pullLive(bad.ctx, NOW)).sent, 0);
});

test("admin tab: types table with switches, search, edit window with errors under the fields, presets, tests, queue buttons", async () => {
  const { assertAdminPageErgonomics } = await import("./helpers/ergonomics.mjs");
  for (const locale of ["en", "fr"]) {
    const w = world({ locale });
    const blocks = await def.adminPanel(w.ctx, { query: {} });
    const table = blocks.find((b) => b.type === "table" && b.tab === "twitch");
    assert.equal(table.rows.length, 10); assert.equal(table.searchable, true); assert.ok(table.rows.every((r) => r[4].switch));
    assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "pause") && blocks.some((b) => b.action === "clearQueue"));
    assert.equal(blocks.find((b) => b.type === "links" && b.tab === "twitch").items[0].href, "/admin/instances/te");
    const dlg = (await def.adminPanel(w.ctx, { query: { edit: "cheer" } })).find((b) => b.presentation === "dialog");
    assert.equal(dlg.fields.filter((f) => f.kind !== "hidden").length, 3); assert.equal(dlg.cancelHref, "?tab=twitch");
    assert.equal((await def.adminPanel(w.ctx, { query: { edit: "follow" } })).find((b) => b.presentation === "dialog").fields.length, 3, "no minimum for a follow");
    const errors = [];
    errors.push(...Object.values((await def.adminActions.saveType(w.ctx, { id: "follow", template: "{name} {nope}", seconds: "", min: "" })).errors));
    errors.push(...Object.values((await def.adminActions.saveType(w.ctx, { id: "follow", template: "x", seconds: "1", min: "" })).errors));
    errors.push(...Object.values((await def.adminActions.saveType(w.ctx, { id: "cheer", template: "x", seconds: "", min: "-4" })).errors));
    errors.push((await def.adminActions.setType(w.ctx, { id: "zzz", enabled: "1" })).error);
    assertAdminPageErgonomics(blocks, { errors });
    assertAdminPageErgonomics(await def.adminPanel(w.ctx, { query: { edit: "cheer" } }));
    await tw.pause(w.ctx); assertAdminPageErgonomics(await def.adminPanel(world({ locale, here: false }).ctx, { query: {} }));
  }
});

test("admin actions: switch says the wanted state, save, preset, test goes through the same writing, queue buttons", async () => {
  const w = world();
  const A = def.adminActions;
  assert.ok((await A.setType(w.ctx, { id: "follow", enabled: "0" })).ok); assert.ok((await A.setType(w.ctx, { id: "follow", enabled: "0" })).ok);
  assert.equal((await tw.loadConfig(w.ctx, NOW + 20_000)).types.follow.on, false);
  assert.ok((await A.setType(w.ctx, { id: "follow", enabled: "1" })).ok);
  assert.ok((await A.saveType(w.ctx, { id: "cheer", template: "Thanks {name}: {amount}", seconds: "8", min: "100" })).ok);
  const cfg = await tw.loadConfig(w.ctx, NOW + 40_000);
  assert.deepEqual(cfg.types.cheer, { on: true, template: "Thanks {name}: {amount}", seconds: 8, min: 100 });
  const got = []; globalThis.__curiosaAlertsBus.on(w.key, (e) => got.push(e));
  assert.ok((await A.testType(w.ctx, { id: "cheer" })).ok);
  assert.equal(got[0].message, "Thanks etoile_nord: 500"); assert.equal(got[0].duration, 8); assert.equal(got[0].queued, true);
  assert.ok((await A.testType(w.ctx, { id: "hype" })).ok); assert.equal(got[1].title, "Hype train starts");
  assert.ok((await A.testType(w.ctx, { id: "zzz" })).error);
  assert.ok((await A.applyPreset(w.ctx, { preset: "thanks" })).ok);
  assert.equal((await tw.loadConfig(w.ctx, NOW + 60_000)).types.follow.template, "Welcome {name}");
  assert.equal((await tw.loadConfig(w.ctx, NOW + 60_000)).preset, "thanks");
  await A.applyPreset(w.ctx, { preset: "simple" });
  assert.equal((await tw.loadConfig(w.ctx, NOW + 80_000)).types.follow.template, "");
  assert.ok((await A.pause(w.ctx)).ok); assert.equal((await tw.queueState(w.ctx)).paused, true);
  assert.ok((await A.resume(w.ctx)).ok); assert.ok((await A.clearQueue(w.ctx)).ok);
});

test("service alerts.queue and the tools for assistants", async () => {
  const w = world();
  const S = def.services["alerts.queue"];
  assert.deepEqual(await S.state(w.ctx), { paused: false, held: 0, staged: 0 });
  assert.equal((await S.pause(w.ctx)).paused, true); assert.equal((await S.resume(w.ctx)).paused, false); assert.equal((await S.clear(w.ctx)).cleared, true);
  assert.deepEqual(manifest.offers[0], { service: "alerts.queue", version: 1, each: true, readOnly: ["state"], label: manifest.offers[0].label });
  const get = await def.mcp.alert_templates_get(w.ctx);
  assert.equal(get.types.length, 10); assert.ok(get.words.includes("name"));
  const up = await def.mcp.alert_template_update(w.ctx, { type: "gift", text: "{name} offers {count}", minimum: 3, durationSeconds: 7, enabled: true });
  assert.deepEqual(up, { type: "gift", enabled: true, text: "{name} offers {count}", durationSeconds: 7, minimum: 3 });
  await assert.rejects(def.mcp.alert_template_update(w.ctx, { type: "gift", text: "{secret}" }), (e) => e.expose === true);
  await assert.rejects(def.mcp.alert_template_update(w.ctx, { type: "nope" }), (e) => e.expose === true);
  await assert.rejects(def.mcp.alert_template_update(w.ctx, { type: "gift" }), (e) => e.expose === true);
  assert.deepEqual(manifest.mcp.map((m) => m.name), Object.keys(def.mcp));
  assert.ok(manifest.mcp.filter((m) => !m.readOnly).every((m) => m.default === false && !m.destructive));
});

test("manifest: version, tab, four more settings (one advanced), the topic and its schema, FR and EN texts", () => {
  assert.equal(manifest.version, "1.4.1");
  const t = manifest.consumes.find((c) => c.topic === "twitch.event");
  assert.ok(t.schema.find((f) => f.key === "id" && f.required) && t.schema.find((f) => f.key === "at" && f.type === "datetime"));
  const en = readJson("locales/en.json"), fr = readJson("locales/fr.json");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  for (const id of tw.TYPES) for (const k of [`tw_type_${id}`, `tw_text_${id}`, `tw_preset_short_${id}`, `tw_preset_thanks_${id}`]) assert.ok(en[k] && fr[k], k);
  for (const k of tw.TWITCH_KINDS.filter((x) => x.startsWith("tw_"))) assert.ok(en[`kind_${k}`] && fr[`kind_${k}`], k);
  assert.ok(manifest.settings.filter((s) => s.tab === "twitch").length === 4);
  for (const p of tw.PRESETS.filter((x) => x !== "simple")) for (const id of tw.TYPES) assert.deepEqual(tw.unknownWords(en[`tw_preset_${p}_${id}`]), [], `${p} ${id}`);
});
