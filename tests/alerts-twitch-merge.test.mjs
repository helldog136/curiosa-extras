// Alerts overlay 1.18.0 absorbs Twitch activity (twitch-events 1.13.0 is the bridge). The upgrade is replayed from the REAL code of release v1.94.0
// (Alerts overlay 1.17.0 and Twitch activity 1.12.0, extracted from the git history) on a populated site: journal, flags, switches, options, dock address,
// subscriptions at a fake Twitch that signs like the real one, reactions per type and per reward, the four Twitch options of the overlay.
// Then: the hand-over (once, idempotent), what the owner sees, the old module retired, a site without Twitch, another copy of the overlay. Invented names only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, EV, TYPES, NOW, es, S, P, L, D, mod, manifest, en } from "./helpers/eventsWorld.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { makeTempDir } from "./helpers/tmp.mjs";
import { publishedTags, extractRelease } from "./helpers/hotUpdate.mjs";
import { assertAdminPageErgonomics } from "./helpers/ergonomics.mjs";

const REPO = path.resolve(new URL("..", import.meta.url).pathname);
const TAG = "v1.94.0";
const json = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const index = await import("../modules/alerts-overlay/index.mjs");
const def = index.default;
const tw = await import("../modules/alerts-overlay/twitch.mjs");
const home = await import("../modules/alerts-overlay/twitch/home.mjs");
const opts = await import("../modules/alerts-overlay/options.mjs");
const bridge = (await import("../modules/twitch-events/index.mjs")).default;
const bridgeMan = json(new URL("../modules/twitch-events/module.json", import.meta.url).pathname);
const bridgeEn = json(new URL("../modules/twitch-events/locales/en.json", import.meta.url).pathname);

/* ───────────── The release v1.94.0, from the git history ───────────── */
const history = publishedTags(REPO);
const hasTag = history.tags.includes(TAG);
const needHistory = process.env.HOT_UPDATE_REQUIRE_HISTORY === "1";
let OLD = null;
if (hasTag) {
  const dir = makeTempDir("merge-");
  extractRelease(REPO, TAG, "alerts-overlay", path.join(dir, "alerts-overlay"));
  extractRelease(REPO, TAG, "twitch-events", path.join(dir, "twitch-events"));
  const at = (m, f) => import(`file://${path.join(dir, m, f)}`);
  OLD = {
    alMan: json(path.join(dir, "alerts-overlay/module.json")), evMan: json(path.join(dir, "twitch-events/module.json")),
    alEn: json(path.join(dir, "alerts-overlay/locales/en.json")), evEn: json(path.join(dir, "twitch-events/locales/en.json")),
    al: (await at("alerts-overlay", "index.mjs")), tw: await at("alerts-overlay", "twitch.mjs"),
    ev: (await at("twitch-events", "index.mjs")).default, evS: await at("twitch-events", "state.mjs"), evL: await at("twitch-events", "listen.mjs"),
    evW: await at("twitch-events", "webhook.mjs"), evP: await at("twitch-events", "publish.mjs"), evD: await at("twitch-events", "dockapi.mjs"), evEs: await at("twitch-events", "eventsub.mjs"),
  };
}
const skip = !hasTag ? `history unavailable (${history.reason || `no tag ${TAG}`})` : false;
test("the git history has the release replayed here", (t) => { if (!hasTag) { if (needHistory) assert.fail(skip); t.skip(skip); } });

const U = (n, ext) => `/uploads/${String(n).padStart(8, "0")}-0123-4567-89ab-0123456789ab.${ext}`;
const G = (n) => U(n, "gif");
const HYD = "92af127c-7326-4483-a52b-b0da0be61c01";
const SITE = "https://site.example.org";
/** (1.18.1) A message id as Twitch really sends it: base64, with `=`, `+`, `/`, `-` or `_` (1.18.0 refused them all and copied 0 lines on a real site). */
const RID = ["I3KaI0a8YcZaxOx9j2RcWpQqBSe7jwG8D1W1P1dJBFE=", "GCpS4i2XKeH6l6Y9Gz3VUBMUbVevqfI0-HloQ0wOG3Y=", "S1me+6UHV0Xn3LGxqy6sveqNZWN/GwREHWqcDi5y_bs=", "jf9PyuuxOHBFvXpKjIHg_LO1f9NjiZ343GMGF4LkZd4=", "Qm9uam91cg-YWxlcnRlcw_dHdpdGNoK2V2ZW50cw=="];

/** A delivery signed like Twitch, to a webhook module (old or new): `W` its webhook file, `St` its state file, `E` its eventsub file. */
async function deliverTo({ W, St, E }, ctx, type, event, { id, at = NOW, version = "1", now = NOW } = {}) {
  const sec = (await St.readState(ctx)).secret;
  const body = JSON.stringify({ subscription: { id: "s1", type, version, status: "enabled" }, event });
  const ts = new Date(at).toISOString();
  const headers = { "twitch-eventsub-message-id": id, "twitch-eventsub-message-type": "notification", "twitch-eventsub-message-timestamp": ts, "twitch-eventsub-message-signature": E.sign(sec, id, ts, body) };
  const r = await W.handle(new Request(`${SITE}/m/${ctx.instance.key}/webhook`, { method: "POST", headers, body }), ctx, { now });
  await r.done;
  return r.response.status;
}

/**
 * The site of the owner before the update: Twitch activity 1.12.0 (key `twitch-events`) and Alerts overlay 1.17.0 (key `alerts-overlay`), both populated by their OWN
 * code. Returns the contexts and what the overlay showed before. The two old modules talk through their real services (alerts.reaction, twitch.journal).
 */
async function oldSite() {
  OLD.evS.resetMemory(); OLD.evP.forgetCache(); OLD.tw.resetTwitchState();   // a fresh process for the old code too (its memory of seen messages)
  const ev = world({ key: "twitch-events", moduleId: "twitch-events", manifest: OLD.evMan, messages: OLD.evEn, locale: "en", settings: { retentionDays: 60, healthMail: false, silentHours: 5 }, instances: [{ id: "id-al", key: "alerts-overlay", module: "alerts-overlay", adminPath: "/admin/instances/id-al" }, { id: "id-ev", key: "twitch-events", module: "twitch-events", adminPath: "/admin/instances/id-ev" }] });
  const twFake = ev.tw;
  twFake.autoEnable = true;
  const evCtx = ev.ctx;
  // the overlay 1.17.0, with its four Twitch options as settings, a picture uploaded for the follow and for a reward
  const al = fakeCtx({ key: "alerts-overlay", moduleId: "alerts-overlay", locale: "en", messages: OLD.alEn, permissions: OLD.alMan.permissions, siteUrl: SITE,
    settings: { pushToken: "x", twitchSounds: true, twitchText: true, ignoreNames: "a_bot, another_bot", groupSeconds: 3, minGapSeconds: 0, soundVolume: 70 },
    uploads: [G(1), G(2)].map((url) => ({ url, by: "u1" })),
    instances: [{ id: "id-ev", key: "twitch-events", module: "twitch-events", basePath: "", name: "Twitch activity", adminPath: "/admin/instances/id-ev" }],
    services: { "twitch.journal": { flag: (a) => OLD.ev.services["twitch.journal"].flag(evCtx, a) } },
    topics: { "twitch.event": async () => (await OLD.evP.topicItems(evCtx, { limit: 200 }, Date.now())).map((i) => ({ ...i, source: { instance: "twitch-events", module: "twitch-events" } })) } });
  const svc = OLD.al.default.services["alerts.reaction"];
  assert.ok((await svc.set(al, { type: "follow", patch: { variants: [{ src: G(1) }], text: "Welcome {name}", sound: "chime" } })).ok);
  assert.ok((await svc.set(al, { type: "redeem", reward: HYD, title: "Hydrate", cost: 500, patch: { variants: [{ src: G(2) }] } })).ok);
  assert.ok((await svc.set(al, { type: "cheer", patch: { min: "100", tts: "both", viewer: true } })).ok);
  // Twitch activity: listening (subscriptions at its own address), a type switched off, the dock address, events in the journal
  await OLD.evS.updateState(evCtx, (d) => { d.enabled = { ...OLD.evS.enabledOf(d), cheer: true, redeem: true, offline: false }; });
  await OLD.evS.ensureSecret(evCtx);
  await OLD.evL.ensureListening(evCtx, { channel: "" });   // created (pending), then confirmed by Twitch
  assert.equal((await OLD.evL.ensureListening(evCtx, { channel: "" })).code, "listening");
  const dockKey = await OLD.evD.dockSecret(evCtx);
  const files = { W: OLD.evW, St: OLD.evS, E: OLD.evEs };
  for (const [i, [type, event]] of [[TYPES.follow, EV.follow], [TYPES.sub, EV.sub], [TYPES.cheer, { ...EV.cheer, message: "Cheer500 see www.example.com" }], [TYPES.raid, EV.raid], ["channel.channel_points_custom_reward_redemption.add", EV.redeem()]].entries()) {
    assert.equal(await deliverTo(files, evCtx, type, event, { id: RID[i], at: Date.now() - 60_000 + i, now: Date.now() }), 204);
  }
  // the overlay shows them (its seen-set remembers them under the key of Twitch activity); the cheer's link is hidden and the journal line marked
  const shown = [];
  const env = { ...OLD.al.twitchEnv(al), rewards: null };
  await OLD.tw.pullTwitch(al, (a) => shown.push(a), env);
  await new Promise((go) => setImmediate(go));
  return { evCtx, al, twFake, dockKey, shown };
}

/** The same site after the update: Alerts overlay 1.18.0 on the SAME store (same copy), with the four settings of 1.17.0 now `legacySettings`; Twitch activity 1.13.0 (bridge). */
async function update(old) {
  tw.resetTwitchState();
  const ctx = world({ key: "alerts-overlay", locale: "en", keepMemory: true, twFake: old.twFake, settings: { pushToken: "x", minGapSeconds: 0, soundVolume: 70 }, legacy: { twitchSounds: true, twitchText: true, ignoreNames: "a_bot, another_bot", groupSeconds: 3 },
    instances: [{ id: "id-al", key: "alerts-overlay", module: "alerts-overlay", adminPath: "/admin/instances/id-al" }, { id: "id-ev", key: "twitch-events", module: "twitch-events", adminPath: "/admin/instances/id-ev" }],
    services: { [home.HANDOVER]: Object.fromEntries(Object.entries(bridge.services[home.HANDOVER]).map(([k, fn]) => [k, (a) => fn(old.evCtx, a)])) } }).ctx;
  ctx.api.store = old.al.api.store;   // the same copy: its store is kept by the update
  return ctx;
}

test("upgrade from the real 1.94.0: data version 2 moves the four Twitch options to the store, the alerts read them as before", { skip }, async () => {
  const old = await oldSite();
  const ctx = await update(old);
  const before = OLD.al.twitchEnv(old.al);
  await def.migrations[2](ctx);
  assert.deepEqual(ctx.calls.legacyCleared.sort(), ["groupSeconds", "ignoreNames", "twitchSounds", "twitchText"]);
  opts.resetOptions();
  await opts.load(ctx);
  assert.deepEqual(opts.values(ctx), { twitchSounds: true, twitchText: true, ignoreNames: "a_bot, another_bot", groupSeconds: 3 });
  const after = index.twitchEnv(ctx);
  assert.deepEqual([after.showText, [...after.ignore], after.groupMs, after.baseSeconds], [before.showText, [...before.ignore], before.groupMs, before.baseSeconds]);
  await def.migrations[2](ctx);   // replayed after a failure: nothing changes
  await opts.load(ctx);
  assert.deepEqual(opts.values(ctx).ignoreNames, "a_bot, another_bot");
});

test("upgrade from the real 1.94.0: the reactions per type and per reward, and the alerts they make, are byte for byte those of 1.17.0", { skip }, async () => {
  const old = await oldSite();
  const ctx = await update(old);
  await def.migrations[2](ctx);
  await opts.load(ctx);   // as every page, action and tool does first
  const svcOld = OLD.al.default.services["alerts.reaction"];
  for (const [type, reward] of [["follow", ""], ["cheer", ""], ["redeem", HYD], ["redeem", ""], ["raid", ""]]) {
    const args = { type, ...(reward ? { reward } : {}) };
    assert.deepEqual(await index.reactionService.get(ctx, args), await svcOld.get(old.al, args), `${type} ${reward}`);
  }
  assert.deepEqual(await index.reactionService.rewards(ctx), await svcOld.rewards(old.al));
  assert.deepEqual(await index.reactionService.list(ctx), await svcOld.list(old.al));
  const item = { id: "cmp", type: "follow", name: "Camille", login: "camille", at: new Date().toISOString(), test: true };
  const pick = () => 0;
  assert.deepEqual(tw.alertFor(item, { config: await tw.loadConfig(ctx), text: (k) => k, title: (p) => p, pick }), OLD.tw.alertFor(item, { config: await OLD.tw.loadConfig(old.al), text: (k) => k, title: (p) => p, pick }));
});

test("upgrade from the real 1.94.0: before the hand-over the new overlay keeps showing Twitch activity's alerts; the hand-over takes the journal, the switches, the options and the dock address once", { skip }, async () => {
  const old = await oldSite();
  const ctx = await update(old);
  await def.migrations[2](ctx);
  // 1. Twitch activity 1.12.0 (no hand-over yet): the overlay waits, reads its topic, never listens itself
  const noHandover = world({ key: "alerts-overlay", locale: "en", keepMemory: true, twFake: old.twFake, instances: [{ id: "id-al", key: "alerts-overlay", module: "alerts-overlay" }, { id: "id-ev", key: "twitch-events", module: "twitch-events", adminPath: "/admin/instances/id-ev" }] }).ctx;
  noHandover.api.store = old.al.api.store;
  assert.equal(await home.mode(noHandover), "waiting");
  assert.deepEqual(await home.takeOver(noHandover), { done: false, code: "old" });
  const page0 = await def.adminPanel(noHandover, { query: {} });
  assert.equal(page0[0].type, "banner"); assert.equal(page0[0].text, en.ho_need_update);
  assert.deepEqual(page0[1].items[0].href, "/admin/instances/id-ev");
  await def.tasks.listen.run(noHandover);
  assert.ok(old.twFake.subs.every((x) => x.transport.callback === `${SITE}/m/twitch-events/webhook`), "nothing created at the new address while waiting");
  // 2. Twitch activity 1.13.0 (the bridge): one pass of the task hands over, then listens at the new address
  const journalBefore = (await old.evCtx.api.store.list(OLD.evS.COL, { limit: 100 })).map((r) => r.data);
  await def.tasks.listen.run(ctx);
  const ho = await home.handoverOf(ctx);
  assert.ok(journalBefore.length === 5 && journalBefore.every((l) => RID.includes(l.id)), "the old journal holds the five lines, with real Twitch ids");
  assert.deepEqual([ho.state, ho.from, ho.lines, ho.importVersion], ["done", "twitch-events", journalBefore.length, 2]);
  const lines = await S.recent(ctx, 100);
  assert.deepEqual(lines.map((l) => l.id).sort(), journalBefore.map((l) => l.id).sort());
  for (const b of journalBefore) {
    const a = lines.find((l) => l.id === b.id);
    for (const k of Object.keys(b)) assert.deepEqual(a[k], b[k], `${b.id}.${k}`);
    assert.equal(a.from, "twitch-events");
  }
  assert.equal(lines.find((l) => l.kind === "cheer").flag.reason, "link", "the mark of the moderation came along");
  const state = await S.readState(ctx), oldState = await OLD.evS.readState(old.evCtx);
  assert.deepEqual(S.enabledOf(state), OLD.evS.enabledOf(oldState));
  assert.equal(state.dockSecret, old.dockKey);
  assert.deepEqual(state.options, { retentionDays: 60, healthMail: false, silentHours: 5 });
  assert.ok(oldState.retired && oldState.retired.by === "alerts-overlay", "Twitch activity is retired");
  // the subscriptions: the old address is gone, the new one holds every type that is on (no 409, nothing "taken")
  const cbs = old.twFake.subs.map((x) => x.transport.callback);
  assert.ok(cbs.length > 0 && cbs.every((c) => c === `${SITE}/m/alerts-overlay/webhook`), cbs.join());
  assert.ok(!Object.values(state.types ?? {}).some((x) => x.code === "taken"));
  assert.deepEqual(old.twFake.wants.filter((w) => w.consumer === "twitch-events").at(-1).scopes, [], "the old permission wish is withdrawn");
  assert.ok(old.twFake.wants.some((w) => w.consumer === "alerts-overlay" && w.scopes.length > 0), "the same permissions are wished by the overlay");
  // 3. idempotent: a second pass copies nothing more
  await def.tasks.listen.run(ctx);
  assert.equal((await S.recent(ctx, 100)).length, journalBefore.length);
  assert.equal(await home.mode(ctx), "on");
});

test("upgrade from the real 1.94.0: no alert shows twice across the hand-over, a new event shows once, the journal is marked by the overlay itself", { skip }, async (t) => {
  const old = await oldSite();
  const ctx = await update(old);
  await def.migrations[2](ctx);
  await def.tasks.listen.run(ctx);
  const shown = [];
  const pull = async (now = Date.now()) => tw.pullTwitch(ctx, (a) => shown.push(a), { ...index.twitchEnv(ctx, now), items: await index.twitchItems(ctx), rewards: null });
  assert.equal(await pull(), 0, `the lines shown before the update stay shown (${old.shown.length} of them)`);
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 1000);
  assert.equal(await deliverTo({ W: (await import("../modules/alerts-overlay/twitch/webhook.mjs")), St: S, E: es }, ctx, TYPES.raid, { ...EV.raid, from_broadcaster_user_login: "camille", from_broadcaster_user_name: "Camille" }, { id: "new-raid", at: now, now }), 204);
  await pull(now + 1000);
  assert.deepEqual(shown.map((a) => a.message), ["Camille raids with 120 viewers"]);
  await tw.decideText(ctx, RID[2], "accept", () => {});
  await new Promise((go) => setImmediate(go));
  assert.equal((await S.byId(ctx, RID[2])).flag.state, "accepted", "the overlay marks its own journal");
});

test("upgrade from the real 1.94.0: the old module is retired: no listening, its page says where to go, its dock address leads to the new dock with the same key", { skip }, async () => {
  const old = await oldSite();
  const ctx = await update(old);
  await def.tasks.listen.run(ctx);
  const ev = old.evCtx;
  ev.api.instances = { ...ev.api.instances, list: async () => [{ id: "id-al", key: "alerts-overlay", module: "alerts-overlay", adminPath: "/admin/instances/id-al" }] };
  assert.equal((await bridge.routes.webhook(new Request(`${SITE}/m/twitch-events/webhook`, { method: "POST", body: "{}" }), ev)).status, 410);
  const r = await bridge.routes.dock(new Request(`${SITE}/m/twitch-events/dock?k=${encodeURIComponent(old.dockKey)}&scheme=dark`), ev);
  assert.equal(r.status, 302); assert.equal(r.headers.get("location"), `/m/alerts-overlay/dock?k=${encodeURIComponent(old.dockKey)}&scheme=dark`);
  const newDock = await def.routes.dock(new Request(`${SITE}/m/alerts-overlay/dock?k=${encodeURIComponent(old.dockKey)}`), ctx);
  assert.equal(newDock.status, 200, "the OBS dock keeps its key: only the address changes");
  assert.deepEqual(await bridge.exports["twitch.event"](ev, {}), []);
  const page = await bridge.adminPanel(ev, { query: {} });
  assert.deepEqual(page.map((b) => b.type), ["banner", "markdown"], "R33: the banner is the link, no second button");
  assert.equal(page[0].href, "/admin/instances/id-al");
  assert.equal(await bridge.adminBadge(ev), 0);
  const subs = old.twFake.subs.length, calls = old.twFake.calls.length;
  await bridge.tasks.listen.run(ev); await bridge.tasks.purge.run(ev);
  assert.deepEqual([old.twFake.subs.length, old.twFake.calls.length], [subs, calls], "the retired module calls Twitch no more");
  assertAdminPageErgonomics(page);
});

test("the hand-over after a removal without it: a subscription left at Twitch activity's address is deleted, never reported as taken", async () => {
  const w = world({ key: "alerts-overlay", locale: "en", tw: { autoEnable: true } });
  const { ctx, tw: fake } = w;
  await S.ensureSecret(ctx);
  await S.updateState(ctx, (x) => { x.handover = { state: "done", from: "twitch-events", at: NOW, lines: 0, callback: `${SITE}/m/twitch-events/webhook` }; });
  fake.subs.push({ id: "left", type: "channel.follow", version: "2", status: "enabled", condition: { broadcaster_user_id: "100", moderator_user_id: "100" }, transport: { method: "webhook", callback: `${SITE}/m/twitch-events/webhook` }, created_at: new Date(NOW).toISOString() });
  fake.subs.push({ id: "bot", type: "channel.chat.message", version: "1", status: "enabled", condition: { broadcaster_user_id: "100", user_id: "100" }, transport: { method: "webhook", callback: `${SITE}/m/twitch-bot/webhook` } });
  await L.ensureListening(ctx, { channel: "" });
  assert.equal((await L.ensureListening(ctx, { channel: "" })).code, "listening");
  assert.ok(!fake.subs.some((x) => x.id === "left")); assert.ok(fake.subs.some((x) => x.id === "bot"), "another module's subscription is never touched");
  assert.ok(fake.subs.some((x) => x.type === "channel.follow" && x.transport.callback === `${SITE}/m/alerts-overlay/webhook`));
});

test("1.18.1: the ids of the journal are Twitch's real message ids (base64 with = + / - _); test and replay lines are not copied", () => {
  for (const id of RID) assert.ok(home.importLine({ id, kind: "follow", at: NOW, receivedAt: NOW, source: "twitch" }, "twitch-events"), id);
  for (const id of ["", "a b", "x\u0000", "é", "a".repeat(101)]) assert.equal(home.importLine({ id, kind: "follow", at: NOW, source: "twitch" }, "x"), null, JSON.stringify(id));
  for (const source of ["test", "replay"]) assert.equal(home.importLine({ id: "test-abc", kind: "follow", at: NOW, source }, "x"), null, source);
  assert.equal(home.importLine({ id: RID[0], kind: "follow", at: NOW, source: "catchup", missed: true }, "x").missed, true);
});

test("1.18.1: a hand-over of 1.18.0 that copied 0 lines copies the journal again, once, without release; the lines received since stay, newest first; no duplicate, nothing shown again", { skip }, async (t) => {
  const old = await oldSite();
  // a test line in the old journal (it must not come back: a test always shows on screen)
  await OLD.evP.sendTest(old.evCtx, "raid");
  const ctx = await update(old);
  await def.migrations[2](ctx);
  await def.tasks.listen.run(ctx);   // the hand-over of 1.18.1 (copies the five lines)…
  // …turned back into what 1.18.0 left on the site: the state taken over, the subscriptions moved, but NO journal line and no importVersion
  for (const r of await ctx.api.store.list(S.COL, { limit: 100 })) await ctx.api.store.remove(r.id);
  await S.updateState(ctx, (x) => { x.handover = { state: "done", from: "twitch-events", at: Date.now() - 3_600_000, lines: 0, releasedAt: Date.now() - 3_600_000, callback: `${SITE}/m/twitch-events/webhook` }; });
  // two events received here since then (the 4 recent lines of the site, in short)
  const W = await import("../modules/alerts-overlay/twitch/webhook.mjs");
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  for (const [i, id] of ["bmV3LWZvbGxvdw==", "bmV3LXJlZGVlbQ=="].entries()) assert.equal(await deliverTo({ W, St: S, E: es }, ctx, i ? "channel.channel_points_custom_reward_redemption.add" : TYPES.follow, i ? EV.redeem() : EV.follow, { id, at: now - 1000 + i, now }), 204);
  const recentBefore = (await S.recent(ctx, 10)).map((l) => l.id);
  const shown = [];
  const pull = async () => tw.pullTwitch(ctx, (a) => shown.push(a), { ...index.twitchEnv(ctx, Date.now()), items: await index.twitchItems(ctx), rewards: null });
  await pull();
  const shownBefore = shown.length;
  const subs = old.twFake.subs.map((x) => `${x.id}:${x.transport.callback}`).sort();
  const releasesBefore = (await OLD.evS.readState(old.evCtx)).retired.at;
  // the update to 1.18.1: the next pass copies the journal again
  await def.tasks.listen.run(ctx);
  const lines = await S.recent(ctx, 100);
  assert.deepEqual(lines.map((l) => l.id), [...recentBefore, ...RID.slice().reverse()], "the recent lines first (newest first), then the copied ones, each once");
  assert.ok(lines.filter((l) => RID.includes(l.id)).every((l) => l.from === "twitch-events"));
  assert.ok(!lines.some((l) => l.source === "test"), "the test line of the old journal is not copied");
  const ho = await home.handoverOf(ctx);
  assert.deepEqual([ho.lines, ho.importVersion], [5, 2]);
  assert.equal((await OLD.evS.readState(old.evCtx)).retired.at, releasesBefore, "no second release");
  assert.deepEqual(old.twFake.subs.map((x) => `${x.id}:${x.transport.callback}`).sort(), subs, "the subscriptions are untouched");
  // nothing is shown again: the copied lines are older than the alerts' age limit
  await pull();
  assert.equal(shown.length, shownBefore, "no old line shows on screen");
  // once: a third pass copies nothing, the page opens without copying
  await def.tasks.listen.run(ctx);
  await def.adminPanel(ctx, { query: {} });
  assert.equal((await S.recent(ctx, 100)).length, 7);
  const log = (ctx.calls.log ?? []).filter((l) => l.action === "twitch.handover").map((l) => Number(l.data.lines));
  assert.deepEqual(log.slice(-1), [5], "the log says how many lines were copied again");
});

test("1.18.1: without Twitch activity any more, a hand-over of 1.18.0 stays as it is (nothing to copy, nothing fails)", async () => {
  const w = world({ key: "alerts-overlay", locale: "en" });
  await S.updateState(w.ctx, (x) => { x.handover = { state: "done", from: "twitch-events", at: NOW, lines: 0 }; });
  assert.deepEqual(await home.takeOver(w.ctx), { done: true, lines: 0, already: true, reimport: "nothing" });
  assert.equal(await home.mode(w.ctx), "on");
});

/* ───────────── A site without Twitch ───────────── */

function noTwitch(o = {}) {
  tw.resetTwitchState(); opts.resetOptions();
  return fakeCtx({ key: o.key ?? "solo", moduleId: "alerts-overlay", locale: o.locale ?? "en", messages: json(new URL(`../modules/alerts-overlay/locales/${o.locale ?? "en"}.json`, import.meta.url).pathname), settings: { pushToken: "x" }, permissions: manifest.permissions, requires: manifest.requires, instances: o.instances ?? [] });
}

test("a site without Twitch: nothing Twitch shows (no Twitch, Rewards or Voice tab, no journal, no dock), nothing runs, nothing is asked of Twitch", async () => {
  for (const locale of ["en", "fr"]) {
    const ctx = noTwitch({ locale });
    assert.equal(await home.mode(ctx), "off");
    const page = await def.adminPanel(ctx, { query: {} });
    const tabs = new Set(page.map((b) => b.tab ?? "use"));
    assert.deepEqual([...tabs].sort(), ["media", "use"], [...tabs].join());
    assert.ok(!manifest.settings.some((s) => ["twitch", "rewards", "viewers"].includes(s.tab)), "no setting keeps a Twitch tab on screen");
    assert.ok(!page.some((b) => /twitch|dock/i.test(JSON.stringify(b.action ?? ""))), "no Twitch action");
    assert.ok(page.some((b) => b.action === "pause") && page.some((b) => b.action === "test"), "the queue and the test of the overlay stay");
    assertAdminPageErgonomics(page);
    await def.tasks.listen.run(ctx); await def.tasks.purge.run(ctx);
    assert.deepEqual(ctx.calls.services.filter(([name]) => name === "twitch.api"), [], "Twitch is never called");
    assert.deepEqual(await def.exports["twitch.event"](ctx, {}), []);
    assert.ok((await def.routes.webhook(new Request("https://example.test/m/solo/webhook", { method: "POST", body: "{}" }), ctx)).status >= 400, "nothing is accepted without a secret");
    assert.equal(await def.adminBadge(ctx), 0);
    assert.ok(manifest.requires.every((r) => r.optional === true), "nothing Twitch is installed with the overlay");
  }
});

test("another copy of the overlay on a Twitch site: its own editor and a link to the copy that listens; it never listens itself", async () => {
  const instances = [{ id: "id-1", key: "first", module: "alerts-overlay", adminPath: "/admin/instances/id-1" }, { id: "id-2", key: "second", module: "alerts-overlay", adminPath: "/admin/instances/id-2" }];
  const w = world({ key: "second", locale: "en", instances });
  assert.equal(await home.mode(w.ctx), "guest");
  const page = await def.adminPanel(w.ctx, { query: {} });
  assert.ok(page.some((b) => b.type === "links" && b.tab === "twitch" && b.items[0].href === "/admin/instances/id-1"));
  assert.ok(page.some((b) => b.type === "table" && b.tab === "twitch" && b.rowActions?.[0]?.href === "?tab=twitch&edit={id}"), "the overlay's own editor");
  assert.ok(!page.some((b) => b.tab === "rewards"), "the rewards are set where the listening is");
  assert.equal((await def.routes.webhook(new Request(`${SITE}/m/second/webhook`, { method: "POST", body: "{}" }), w.ctx)).status, 404);
  await def.tasks.listen.run(w.ctx);
  assert.equal(w.tw.calls.length, 0, "Twitch is never called from another copy");
  assertAdminPageErgonomics(page);
});

test("the copy that listens: one Twitch events tab (one alert switch per type, the reaction window), the journal and the dock first, the options folded", async () => {
  const w = world({ locale: "en" });
  await S.ensureSecret(w.ctx);
  const page = await def.adminPanel(w.ctx, { query: {} });
  const types = page.filter((b) => b.tab === "twitch" && b.type === "table");
  assert.equal(types.length, 1, "ONE table of types");
  assert.deepEqual(types[0].rows[0].filter((c) => c?.switch).map((c) => c.switch.action), ["setType"], "one switch: the alert (listening has none)");
  assert.ok(!page.some((b) => b.action === "saveType"), "no second editor");
  assert.ok(page.some((b) => b.action === "applyPreset") && page.some((b) => b.action === "simulate"));
  assert.ok(page.some((b) => b.action === "saveTwitchOptions" && b.tab === "twitch"));
  const journal = page.find((b) => b.type === "table" && !b.tab && b.filters);
  assert.ok(journal && page.indexOf(journal) < page.findIndex((b) => b.type === "adminForm" && b.action === "test"), "the journal comes before the test alert");
  const optionsForm = page.find((b) => b.action === "saveJournal");
  assert.ok(optionsForm.fields.every((f) => f.folded));
  assert.ok((await def.adminActions.saveJournal(w.ctx, { retentionDays: "400", silentHours: "2" })).errors.retentionDays);
  assert.ok((await def.adminActions.saveJournal(w.ctx, { retentionDays: "90", silentHours: "2", healthMail: "on" })).ok);
  assert.deepEqual((await S.readState(w.ctx)).options, { retentionDays: 90, silentHours: 2, healthMail: true });
  assertAdminPageErgonomics(page, { errors: [(await def.adminActions.saveJournal(w.ctx, { retentionDays: "x", silentHours: "1" })).errors.retentionDays] });
});

test("the Reaction window edits what the overlay tab edited: minimum, animation, voice, viewer text (all folded), saved in the overlay", async () => {
  for (const locale of ["en", "fr"]) {
    const w = world({ locale });
    const msgs = locale === "en" ? en : (await import("./helpers/eventsWorld.mjs")).fr;
    const dlg = (await def.adminPanel(w.ctx, { query: { tab: "twitch", reaction: "cheer" } })).find((b) => b.presentation === "dialog" && b.action === "saveReaction");
    const byName = Object.fromEntries(dlg.fields.map((f) => [f.name, f]));
    for (const k of ["min", "anim", "tts", "viewer", "viewerMax"]) assert.equal(byName[k]?.folded, true, k);
    assert.equal(dlg.fields.filter((f) => f.kind !== "hidden" && !f.folded).length, 2, "the short path stays files and order (R2)");
    assert.equal(byName.min.label, msgs.rx_f_min_cheer);
    const r = await def.adminActions.saveReaction(w.ctx, { id: "cheer", variants: "[]", pick: "random", text: "", sound: "", audio: "", seconds: "", more: "2", min: "500", anim: "fade", tts: "both", viewer: "on", viewerMax: "80" });
    assert.ok(r.ok, JSON.stringify(r));
    const c = (await tw.loadConfig(w.ctx)).types.cheer;
    assert.deepEqual([c.min, c.anim, c.tts, c.viewer, c.viewerMax], [500, "fade", "both", true, 80]);
    const bad = await def.adminActions.saveReaction(w.ctx, { id: "cheer", variants: "[]", pick: "random", more: "2", min: "-3", anim: "zzz", tts: "", viewerMax: "9" });
    assert.deepEqual(Object.keys(bad.errors).sort(), ["anim", "min", "viewerMax"]);
  }
});

/* ───────────── Contracts with the other modules ───────────── */

test("public contracts: the same tools (names and inputs) as the two modules of 1.94.0, the same services for the Twitch bot, nothing required", { skip }, async () => {
  const names = (m) => (m.mcp ?? []).map((x) => x.name);
  assert.deepEqual(names(manifest), [...names(OLD.alMan), ...names(OLD.evMan)], "every tool keeps its name (now under the overlay's key)");
  for (const t of manifest.mcp) {
    const was = [...OLD.alMan.mcp, ...OLD.evMan.mcp].find((x) => x.name === t.name);
    assert.deepEqual([t.input, t.readOnly, t.default, t.destructive, t.uploads], [was.input, was.readOnly, was.default, was.destructive, was.uploads], t.name);
    assert.equal(typeof def.mcp[t.name], "function", t.name);
  }
  const offer = (m, s) => m.offers.find((o) => o.service === s);
  for (const s of ["alerts.show", "alerts.queue"]) assert.deepEqual(offer(manifest, s), offer(OLD.alMan, s), s);
  assert.deepEqual(offer(manifest, "twitch.journal"), offer(OLD.evMan, "twitch.journal"));
  assert.deepEqual(manifest.provides, OLD.evMan.provides);
  // (1.20.0) two animated elements are added after them; the ones already placed are unchanged
  assert.deepEqual(manifest.overlayElements.slice(0, OLD.alMan.overlayElements.length), OLD.alMan.overlayElements, "the elements placed on the overlay pages are unchanged");
  // who still needs what: the Twitch bot (alerts.show, optional) and live status (twitch.live, from My Twitch channel) are untouched; nobody needs the old protocol
  const all = fs.readdirSync(path.join(REPO, "modules")).map((id) => json(path.join(REPO, "modules", id, "module.json")));
  const needs = all.flatMap((m) => (m.requires ?? []).map((r) => [m.id, r.service]));
  // (Twitch activity 1.13.0, the bridge, keeps its optional needs of 1.12.0 until it hands over: it is not counted)
  assert.deepEqual(needs.filter(([id, s]) => id !== "twitch-events" && ["alerts.reaction", "alerts.reaction.editor"].includes(s)), []);
  assert.deepEqual(needs.filter(([id, s]) => id !== "twitch-events" && s.startsWith("alerts.")).map(([id, s]) => `${id}:${s}`).sort(), ["stream-goals:alerts.queue", "twitch-bot:alerts.show"], "(1.97.0) Live goals needs the queue only to know the overlay is there (optional)");
  assert.ok(json(path.join(REPO, "modules/live-status/module.json")).requires.every((r) => r.service !== "twitch.journal"));
});

test("the bridge 1.13.0: offers only the hand-over, keeps working as 1.12.0 until it is called, says it moved, FR/EN parity", () => {
  assert.equal(bridgeMan.version, "1.15.0");
  assert.deepEqual(bridgeMan.offers.map((o) => [o.service, o.version]), [["twitch.events.handover", 1]]);
  assert.equal(bridgeMan.mcp, undefined, "its tools are the overlay's now");
  assert.ok(!bridgeMan.permissions.includes("mcp"));
  const fr = json(new URL("../modules/twitch-events/locales/fr.json", import.meta.url).pathname);
  assert.deepEqual(Object.keys(bridgeEn).sort(), Object.keys(fr).sort());
  for (const k of ["moved_banner", "moved_remove"]) assert.ok(bridgeEn[k] && fr[k], k);
  assert.match(bridgeMan.description.fr, /journal/);
});
