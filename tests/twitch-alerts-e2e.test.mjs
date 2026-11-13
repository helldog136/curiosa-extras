// END TO END, both modules together, with a FAKE TWITCH that signs like the real one: Twitch → signed webhook → journal → topic `twitch.event` → alerts overlay → the alerts the
// pages receive. A busy evening: follow, sub, resub, a gift bomb (the gift and its 25 gifted subs), raid, bits, hype train; the same message delivered twice; the site restarting in
// the middle (memory of both modules lost, storage kept); an expired token and its repair; a revoked subscription; a burst of 150 follows.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { world, deliver, EV, TYPES, NOW, S, P, L, C, mod as eventsMod } from "./helpers/eventsWorld.mjs";

const ADIR = new URL("../modules/alerts-overlay", import.meta.url).pathname;
const tw = await import("../modules/alerts-overlay/twitch.mjs");
const alertsMod = await import("../modules/alerts-overlay/index.mjs");
const aManifest = JSON.parse(fs.readFileSync(`${ADIR}/module.json`, "utf8"));
const aEn = JSON.parse(fs.readFileSync(`${ADIR}/locales/en.json`, "utf8"));
const S0 = { channel: "", retentionDays: 30, silentHours: 3, healthMail: true };
let n = 0;

/** A site with both modules: the alerts overlay reads the topic through the events module, like the core does (the topic lives in the events module's storage). */
async function site() {
  const w = world({ alerts: true, locale: "en" });
  await S.ensureSecret(w.ctx);
  const key = `e2e${++n}`;
  const shown = [];
  const actx = fakeCtx({
    key, locale: "en", messages: aEn, settings: { groupSeconds: 5, minGapSeconds: 0 }, instances: [{ id: "te", key: "ev", module: "twitch-events", basePath: "", name: "Twitch activity", adminPath: "/admin/instances/te" }], permissions: aManifest.permissions,
    services: { "twitch.journal": { flag: (a) => eventsMod.services["twitch.journal"].flag(w.ctx, a) } },
    topics: { "twitch.event": async () => (await P.topicItems(w.ctx, { limit: 200 }, Date.now())).map((i) => ({ ...i, source: { instance: "ev" } })) },
  });
  const pull = (now) => tw.pullTwitch(actx, (a) => shown.push(a), alertsMod.twitchEnv(actx, now));
  return { ...w, actx, shown, pull };
}
const T = (ms) => NOW + ms;
/** The site restarts: the memory of both modules is lost (and the process-wide topic cache), the storage stays. */
const restart = () => { S.resetMemory(); P.forgetCache(); tw.resetTwitchState(); };
const send = (w, type, event, o = {}) => deliver(w.ctx, type, event, { now: NOW + (o.t ?? 0), at: NOW + (o.t ?? 0), ...o });
const texts = (w) => w.shown.map((a) => a.message);
const iso = (ms) => new Date(ms).toISOString();

test("a whole evening: every kind arrives, once, in order, as the alert the person configured", async (t) => {
  const w = await site();
  t.mock.method(Date, "now", () => NOW + 60_000);
  assert.equal((await send(w, TYPES.online, { ...EV.online, started_at: iso(NOW) }, { t: 0 })).status, 204);
  await send(w, TYPES.follow, { ...EV.follow, followed_at: iso(T(1000)) }, { t: 1000, id: "m-follow" });
  await send(w, TYPES.sub, EV.sub, { t: 2000 });
  await send(w, TYPES.resub, EV.resub, { t: 3000 });
  await send(w, TYPES.raid, EV.raid, { t: 4000 });
  await send(w, TYPES.cheer, EV.cheer, { t: 5000 });
  await send(w, "channel.hype_train.begin", { ...EV.hypeBegin, started_at: iso(T(6000)) }, { t: 6000, version: "2" });
  await send(w, "channel.hype_train.end", { ...EV.hypeEnd, ended_at: iso(T(9000)) }, { t: 9000, version: "2" });
  // a GIFT BOMB: Twitch sends one gift line (25) AND one sub line per recipient (is_gift)
  await send(w, TYPES.gift, EV.gift, { t: 7000, id: "bomb" });
  for (let i = 0; i < 25; i++) await send(w, TYPES.sub, { ...EV.giftedSub, user_login: `gift_${i}`, user_name: `Gift_${i}` }, { t: 7000 + i, id: `g${i}` });
  assert.equal((await S.recent(w.ctx, 1000)).length, 34, "every line is in the journal (the bomb: 1 gift + 25 gifted subs)");
  await w.pull(NOW + 60_000);
  assert.equal(w.shown.length, 7, "stream start, sub, resub, raid, bits and the two hype lines show at once; the gift and the follow wait for the burst window");
  await w.pull(NOW + 60_000 + 10_000);
  const all = texts(w);
  assert.ok(all.includes("The stream starts") && all.includes("Etoile_Nord gifts 25 subs"), all.join(" | "));
  assert.ok(all.includes("Lune_Douce subscribed · tier 2") && all.includes("Lune_Douce renews · 12 months") && all.includes("Lune_Douce raids with 120 viewers") && all.includes("Etoile_Nord sends 500 bits") && all.includes("Etoile_Nord follows you"));
  assert.ok(!all.some((x) => /Gift_\d+/.test(x)), "the 25 gifted subs are not announced one by one: the gift line says it");
  assert.equal(w.shown.filter((a) => a.title).map((a) => a.title).join(), "Hype train starts,Hype train over");
  assert.equal(w.shown.length, 9, "nine alerts for the whole evening (the 25 gifted subs add none)");
  assert.equal((await w.pull(NOW + 90_000)), 0, "nothing shown twice");
});

test("the same message delivered twice, and a restart of the whole site in the middle, show each alert once and lose none", async (t) => {
  const w = await site();
  t.mock.method(Date, "now", () => NOW + 30_000);
  await send(w, TYPES.sub, EV.sub, { t: 1000, id: "twice" });
  await send(w, TYPES.sub, EV.sub, { t: 1500, id: "twice" });
  await w.pull(NOW + 30_000);
  assert.deepEqual(texts(w), ["Lune_Douce subscribed · tier 2"]);
  // a raid arrives, the site restarts before the overlay page read it (memory of both modules lost, storage kept)
  await send(w, TYPES.raid, EV.raid, { t: 5000, id: "raid1" });
  restart();
  await send(w, TYPES.raid, EV.raid, { t: 5500, id: "raid1" });      // Twitch retries the same message after the restart
  await send(w, TYPES.cheer, EV.cheer, { t: 6000 });
  assert.equal((await w.pull(NOW + 31_000)), 2);
  assert.deepEqual(texts(w).slice(1), ["Lune_Douce raids with 120 viewers", "Etoile_Nord sends 500 bits"]);
  restart();                                                           // and a second restart: still nothing twice
  assert.equal((await w.pull(NOW + 40_000)), 0);
  assert.equal((await S.recent(w.ctx, 100)).filter((l) => l.id === "raid1").length, 1);
});

test("an expired token and a revoked subscription: said clearly, repaired, and what was missed comes back flagged", async () => {
  const w = await site();
  w.tw.autoEnable = true; w.tw.subscribers = [{ user_login: "etoile_nord", user_name: "Etoile_Nord", tier: "1000" }];
  await L.ensureListening(w.ctx, S0); await C.check(w.ctx, S0, { now: NOW });
  assert.equal((await S.readState(w.ctx)).listen.code, "listening");
  // the token expires: the page says so, the owner is told after the delay
  w.tw.status = "reconnect";
  const down = await C.check(w.ctx, S0, { now: NOW + 2 * 60_000 });
  assert.equal(down.code, "need_reconnect");
  const page = await eventsMod.adminPanel(w.ctx, { query: {} });
  assert.ok(page.some((b) => b.type === "banner" && /expired/i.test(b.text)));
  assert.ok(page.some((b) => b.type === "html" && /data-twitch-connect.*Authorize again with Twitch/s.test(b.html)));
  await C.check(w.ctx, S0, { now: NOW + 15 * 60_000 });
  assert.equal(w.ctx.calls.mail.length, 1);
  // the person reconnects; someone followed meanwhile
  w.tw.status = "ok";
  w.tw.followers = [{ user_id: "5", user_login: "camille", user_name: "Camille", followed_at: iso(NOW + 8 * 60_000) }];
  const back = await C.check(w.ctx, S0, { now: NOW + 20 * 60_000 });
  assert.equal(back.code, "listening"); assert.equal(back.caught.follows, 1);
  assert.equal(w.ctx.calls.mail.length, 2, "and the 'all is back' mail");
  // Twitch revokes a subscription (the person removed the authorisation, then gave it back)
  await S.ensureSecret(w.ctx);
  await deliver(w.ctx, "channel.raid", "authorization_revoked", { messageType: "revocation", now: NOW + 21 * 60_000, at: NOW + 21 * 60_000 });
  const st = await S.readState(w.ctx);
  assert.equal(st.revoked.status, "authorization_revoked");
  assert.ok(w.tw.subs.length > 0, "the subscriptions were checked again at once");
  // the missed follow reaches the overlay, within the hour, with the same sentence
  const items = await P.topicItems(w.ctx, { limit: 10 }, NOW + 22 * 60_000);
  assert.equal(items.find((i) => i.missed).type, "follow");
  w.actx.api.topics.collect = async () => items.map((i) => ({ ...i, source: { instance: "ev" } }));
  assert.equal(await w.pull(NOW + 22 * 60_000), 0, "grouping window first");
  assert.equal(await w.pull(NOW + 30 * 60_000), 1);
  assert.equal(w.shown[0].message, "Camille follows you");
});

test("a burst of 150 follows and a raid at the same time: one alert for the follows, the raid at once, nothing lost, the page never floods", async (t) => {
  const w = await site();
  t.mock.method(Date, "now", () => NOW + 20_000);
  for (let i = 0; i < 150; i++) await send(w, TYPES.follow, { ...EV.follow, user_login: `fan_${i}`, user_name: `fan_${i}`, followed_at: iso(T(100 + i)) }, { t: 100 + i, id: `burst${i}` });
  await send(w, TYPES.raid, EV.raid, { t: 500 });
  assert.equal(await w.pull(NOW + 20_000), 1, "the raid shows at once");
  assert.equal(await w.pull(NOW + 30_000), 1, "after the window: ONE alert for the 150 follows");
  assert.equal(w.shown[1].message, "150 new followers, including fan_0");
  assert.equal(await w.pull(NOW + 60_000), 0);
});

test("moderation end to end: a signed cheer with a link in its message shows without the text and nothing of it is read, the journal marks the line, and Accept anyway shows it once", async (t) => {
  const w = await site();
  t.mock.method(Date, "now", () => NOW + 30_000);
  await tw.saveConfig(w.actx, { tts: { on: true }, types: { cheer: { viewer: true, tts: "both" } } });
  await send(w, TYPES.cheer, { ...EV.cheer, message: "Cheer500 visit www.example.com now" }, { t: 1000, id: "bits-link" });
  await send(w, TYPES.cheer, { ...EV.cheer, message: "Cheer500 well played" }, { t: 2000, id: "bits-fine" });
  await w.pull(NOW + 30_000);
  const [flagged, fine] = w.shown;
  assert.ok(!("detail" in flagged) && flagged.flag === "link" && !/example/.test(flagged.say), "no text, nothing of it read");
  assert.match(fine.detail, /well played/); assert.match(fine.say, /well played/);
  await new Promise((r) => setImmediate(r));
  const line = await S.byId(w.ctx, "bits-link");
  assert.deepEqual([line.flag.reason, line.flag.state], ["link", "hidden"], "the journal marks the line");
  assert.equal((await S.byId(w.ctx, "bits-fine")).flag, undefined);
  const waiting = await tw.textsList(w.actx);
  assert.deepEqual(waiting.map((x) => [x.id, x.reason, x.hold]), [["bits-link", "link", false]]);
  const again = [];
  assert.equal((await tw.decideText(w.actx, "bits-link", "accept", (a) => again.push(a))).ok, true);
  await new Promise((r) => setImmediate(r));
  assert.match(again[0].detail, /example\.com/); assert.equal((await S.byId(w.ctx, "bits-link")).flag.state, "accepted");
  assert.equal((await tw.decideText(w.actx, "bits-link", "accept", () => {})).ok, false, "once");
});
