// Twitch bot 1.11.0: "the bot reacts faster". Measured on the real bot and the real Twitch connector over a fake Twitch (helpers/latencyWorld.mjs):
// where the time goes between a chat event and the reply, and that going faster changed no behaviour (cooldowns, permissions, order, nothing lost).
// The bounds are generous (they must hold on a slow CI machine): they catch a return to "the reply waits for another module / for Twitch / for the journal",
// not a few milliseconds. Run the benchmark itself with tests/twitch-bot-latency.bench.mjs.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { latencyWorld, sleep, now, stageTable } from "./helpers/latencyWorld.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeRewardsApi } from "./helpers/fakeRewards.mjs";
import { fakeHaBridge } from "./helpers/fakeHaBridge.mjs";
import { fr, es, S, SRC, E, C } from "./helpers/botWorld.mjs";
import fs from "node:fs";

const L = await import("../modules/twitch-bot/listen.mjs");
const J = await import("../modules/twitch-bot/redeem.mjs");
const R = await import("../modules/twitch-bot/rewards.mjs");
const W = await import("../modules/twitch-bot/webhook.mjs");
const T = await import("../modules/twitch-bot/timers.mjs");
const def = (await import("../modules/twitch-bot/index.mjs")).default;

const LIGHT = { storeMs: 1, serviceMs: 1, topicMs: 1, helixMs: 10 };
const worlds = [];
const make = async (o) => { const w = await latencyWorld(o); worlds.push(w); return w; };
afterEach(() => { while (worlds.length) worlds.pop().close(); SRC.timing.ttlMs = 15_000; L.timing.diagnoseMs = 5000; });
const replied = (r) => r.sentAt !== null;
const stage = (r, name) => stageTable(r.spansBefore).find((x) => x.stage.startsWith(name));

/* ───────────── Latency ───────────── */

test("latency: on an idle fake a command is answered within 150 ms of receipt, and the webhook acknowledges at once", async () => {
  const w = await make({ ...LIGHT });
  await w.say("!discord", "etoile_nord");   // the first command after a restart also fills the caches
  const r = await w.say("!discord", "lune_douce");
  assert.deepEqual(r.sent, ["Salut lune_douce, rejoignez-nous sur discord.example.org"]);
  assert.ok(r.ackAt - r.t0 < 50, `ack ${r.ackAt - r.t0} ms`);
  assert.ok(r.sentAt - r.t0 < 150, `reply ${r.sentAt - r.t0} ms`);
  // the bot's own work before the reply is a handful of calls: the state read, and the send (account check and config are remembered)
  assert.ok(r.spansBefore.filter((s) => /^(store|svc|topics|instances|entries)/.test(s.label)).length <= 4, r.spansBefore.map((s) => s.label).join(" | "));
});

test("latency: with no wait on the database or Twitch at all, the bot's own work stays under 40 ms per command", async () => {
  const w = await make({});
  await w.say("!discord", "etoile_nord");
  const times = [];
  for (let i = 0; i < 10; i += 1) { const r = await w.say("!discord", `lune_douce${i}`); times.push(r.sentAt - r.t0); }
  times.sort((a, b) => a - b);
  assert.ok(times[5] < 40, `median ${times[5].toFixed(1)} ms`);
});

test("latency: a quiet chat is answered from the last snapshot and never waits for Twitch (the live check refreshes in the background)", async () => {
  SRC.timing.ttlMs = 1;
  const w = await make({ ...LIGHT });
  await w.say("!discord", "etoile_nord");
  await sleep(5); w.expireChannel();   // everything is now older than its freshness window, as after a minute of silence
  w.lat.streamsMs = 400;                                      // and Twitch is slow right now
  const helix = w.stamps.helix;
  const r = await w.say("!discord", "lune_douce", { waitDone: false });
  await r.finish;
  assert.ok(replied(r) && r.sentAt - r.t0 < 250, `reply ${r.sentAt - r.t0} ms`);
  await sleep(600);
  assert.ok(w.stamps.helix - helix >= 2, "the live state was refreshed in the background (GET /streams) after the reply");
});

test("latency: a command that does not mention the calendar never waits for the calendar module", async () => {
  const w = await make({ ...LIGHT, slowTopics: { "planning.slot": 1500, "social.link": 1500, "social.stat": 1500 } });
  const r = await w.say("!discord", "etoile_nord");   // cold: nothing is known yet
  assert.ok(r.sentAt - r.t0 < 500, `reply ${r.sentAt - r.t0} ms`);
  assert.equal(stageTable(r.spansBefore).find((x) => x.stage.startsWith("other modules")), undefined, "no read of another module before the reply");
});

test("latency: a message that is not a command costs no account check, no module read and no reply", async () => {
  const w = await make({ ...LIGHT });
  for (const text of ["!pas_une_commande", "bonjour tout le monde", "!"]) {
    const r = await w.say(text, "etoile_nord");
    assert.equal(r.sent.length, 0);
    assert.deepEqual(r.spansBefore.filter((s) => /^(svc|topics|instances|entries)/.test(s.label)), [], text);
  }
});

test("latency: the journal is written after the reply and is never lost", async () => {
  const w = await make({ ...LIGHT });
  await w.say("!discord", "etoile_nord");
  w.lat.logMs = 500;   // a slow database for the journal only
  const r = await w.say("!discord", "lune_douce", { waitDone: false });
  await r.finish;
  assert.ok(r.sentAt - r.t0 < 250, `reply ${r.sentAt - r.t0} ms`);
  assert.ok(r.doneAt - r.t0 >= 450, "the call only ends once the journal is written");
  const log = await S.readLog(w.ctx);
  assert.deepEqual(log.slice(0, 2).map((x) => [x.user, x.command, x.result, x.reason]), [["lune_douce", "discord", "sent", "ok"], ["etoile_nord", "discord", "sent", "ok"]]);
});

test("latency: 100 messages at once are all processed, the reply budget is respected and nothing is lost", async () => {
  const w = await make({ ...LIGHT });
  await w.say("!discord", "warmup");
  w.reset();
  const rs = await Promise.all(Array.from({ length: 100 }, (_, i) => w.say(i % 2 ? "!quoi" : "!discord", `viewer_${String(i).padStart(3, "0")}`, { waitDone: false })));
  const done = await Promise.all(rs.map((r) => r.finish));
  assert.equal(w.stamps.chat.length, 18, "18 replies per 30 s at most, the others are refused");
  assert.equal(done.filter(replied).length, 18);
  assert.ok(Math.max(...done.map((r) => r.doneAt - r.t0)) < 3000, "every message processed within 3 s");
  const log = await S.readLog(w.ctx);
  assert.equal(log.length, 30, "the journal keeps its 30 newest lines");
  assert.ok(log.filter((x) => x.reason === "rate").length >= 12, "the messages over the budget are refused with a reason, not dropped silently");
});

test("latency: a burst of replies leaves through a short queue: none refused by the network client, started in arrival order, at most 3 at a time", async () => {
  const w = await make({ ...LIGHT, helixMs: 30 });
  await w.say("!discord", "warmup");
  w.reset();
  w.stamps.maxPosting = 0;
  const users = Array.from({ length: 18 }, (_, i) => `viewer_${String(i).padStart(3, "0")}`);
  const rs = await Promise.all(users.map((who) => w.say("!discord", who, { waitDone: false })));
  await Promise.all(rs.map((r) => r.finish));
  assert.equal(w.stamps.chat.length, 18, "no reply lost to the network client's 16-per-host limit");
  assert.ok(w.stamps.maxPosting <= 3, `${w.stamps.maxPosting} sends at once`);
  const started = w.stamps.chat.map((m) => users.findIndex((u) => m.message.includes(u)));
  assert.equal(new Set(started).size, 18);
  const inversions = started.filter((x, i) => i && x < started[i - 1]).length;
  assert.ok(inversions <= 6, `the order of the replies follows the order of the messages (${inversions} swaps among messages processed at the same instant)`);
});

/* ───────────── Behaviour kept ───────────── */

test("behaviour: two simultaneous identical commands are answered once (per-person delay), different people share the global delay", async () => {
  const w = await make({ ...LIGHT, settings: { cooldownGlobal: 0, cooldownUser: 60 } });
  const [a, b] = await Promise.all([w.say("!discord", "etoile_nord", { waitDone: false }), w.say("!discord", "etoile_nord", { waitDone: false })]);
  await Promise.all([a.finish, b.finish]);
  assert.equal([a, b].filter(replied).length, 1);
  assert.equal((await S.readLog(w.ctx)).filter((x) => x.reason === "cooldown").length, 1);

  const g = await make({ ...LIGHT, settings: { cooldownGlobal: 20, cooldownUser: 0 } });
  const rs = await Promise.all(["lune_douce", "etoile_nord", "camille"].map((who) => g.say("!discord", who, { waitDone: false })));
  await Promise.all(rs.map((r) => r.finish));
  assert.equal(rs.filter(replied).length, 1, "the global delay lets one person through");
});

test("behaviour: a reply refused by Twitch gives the delay back, the next try answers", async () => {
  const w = await make({ ...LIGHT, settings: { cooldownGlobal: 0, cooldownUser: 60 } });
  await w.say("!discord", "lune_douce");
  w.tw.state.chatDown = true;
  const bad = await w.say("!quoi", "etoile_nord");
  assert.equal(bad.sent.length, 0);
  w.tw.state.chatDown = false;
  const ok = await w.say("!quoi", "etoile_nord");
  assert.equal(ok.sent.length, 1, "no wait is imposed after a failed send");
  const log = await S.readLog(w.ctx);
  assert.deepEqual(log.slice(0, 2).map((x) => x.result), ["sent", "error"]);
});

test("behaviour: replies come out in the order the messages arrived", async () => {
  const w = await make({ ...LIGHT });
  const users = ["u1", "u2", "u3", "u4", "u5", "u6"];
  for (const [i, who] of users.entries()) await w.say(i % 2 ? "!quoi" : "!discord", who);
  assert.deepEqual(w.stamps.chat.map((m) => users.find((u) => m.message.includes(u))), users);
  const log = await S.readLog(w.ctx);
  assert.deepEqual(log.map((x) => x.user), [...users].reverse(), "the journal lists them newest first, none missing");
});

test("behaviour: permissions, silence outside the live and the emergency stop are unchanged", async () => {
  const w = await make({ ...LIGHT, commands: [{ name: "modo", text: "ok {utilisateur}", extra: { role: "mods" } }, { name: "tous", text: "salut {utilisateur}" }] });
  assert.equal((await w.say("!modo", "lune_douce")).sent.length, 0);
  assert.equal((await S.readLog(w.ctx))[0].reason, "role");
  assert.equal((await w.say("!tous", "lune_douce")).sent.length, 1);
  await S.setMuted(w.ctx, true);
  assert.equal((await w.say("!tous", "etoile_nord")).sent.length, 0);
  assert.equal((await S.readLog(w.ctx))[0].reason, "muted");
  await S.setMuted(w.ctx, false);
  w.tw.state.streams = [];   // not live any more: Twitch answers with no stream
  const off = await make({ ...LIGHT, streams: [] });
  assert.equal((await off.say("!discord", "camille")).sent.length, 0);
  assert.equal((await S.readLog(off.ctx))[0].reason, "offline");
});

test("behaviour: a message delivered twice by Twitch is answered once; a message received while the accounts are not ready is refused with a reason, then the next one works", async () => {
  const w = await make({ ...LIGHT });
  const ev = w.chatEvent("!quoi", "camille");
  const once = w.request(ev), again = once.clone();   // the very same delivery (same message id), received twice
  const one = await W.handle(once, w.ctx); await one.done;
  const twice = await W.handle(again, w.ctx);
  assert.equal(twice.response.status, 204); await twice.done;
  assert.equal(w.stamps.chat.filter((m) => m.message.includes("camille")).length, 1);

  // the account needs a new connection: the message is refused with a reason (never silently lost), and the next one works as soon as it is back
  const doc = (await w.K.ctx.api.store.list("twitchConnections", { limit: 5 }))[0];
  await w.K.ctx.api.store.update(doc.id, { ...doc.data, scopes: ["user:read:chat"] });
  const denied = await w.say("!discord", "lune_douce");   // within the 5 s the ready check is remembered: the send itself is refused, and that makes the bot forget the check
  assert.equal(denied.sent.length, 0);
  assert.equal((await S.readLog(w.ctx))[0].reason, "send_denied");   // the permission to write in the chat is missing
  const bad = await w.say("!discord", "etoile_nord");
  assert.equal(bad.sent.length, 0);
  assert.equal((await S.readLog(w.ctx))[0].reason, "not_ready");
  await w.K.ctx.api.store.update(doc.id, { ...doc.data });
  assert.equal((await w.say("!discord", "etoile_nord")).sent.length, 1);
});

test("behaviour: the account check is shared by a burst, forgotten by a failed send, and never hides a missing connection", async () => {
  const w = await make({ ...LIGHT });
  const r = await Promise.all(["a1", "a2", "a3", "a4"].map((who) => w.say("!discord", who, { waitDone: false })));
  await Promise.all(r.map((x) => x.finish));
  assert.equal(w.spans.filter((s) => s.label === "svc:twitch.api.account").length, 1, "one account check for the whole burst");
  w.tw.state.chatDown = true;
  await w.say("!quoi", "b1");   // the send fails (503): the check is forgotten
  const before = w.spans.filter((s) => s.label === "svc:twitch.api.account").length;
  w.tw.state.chatDown = false;
  await w.say("!quoi", "b2");
  assert.equal(w.spans.filter((s) => s.label === "svc:twitch.api.account").length, before + 1, "checked again at the next message");
});

test("behaviour: editing a command (admin) is used by the very next message; the configuration is not re-read for every message", async () => {
  const w = await make({ ...LIGHT });
  await w.say("!discord", "etoile_nord");
  const reads = () => w.spans.filter((s) => s.label === "store.list:botConfig").length;
  const n = reads();
  await w.say("!discord", "lune_douce");
  await w.say("!discord", "camille");
  assert.equal(reads(), n, "no read of the configuration for the next messages");
  await C.mutate(w.ctx, (cfg) => { cfg.custom[0].text = "Nouveau texte pour {utilisateur}"; });
  const r = await w.say("!discord", "etoile_du_soir");
  assert.deepEqual(r.sent, ["Nouveau texte pour etoile_du_soir"]);
  C.forgetConfig(w.ctx);
  assert.ok(reads() >= n + 1);
});

test("behaviour: planning, partners, networks and followers are read only by the commands that use them, and kept when the module is slow or absent", async () => {
  const w = await make({ ...LIGHT, commands: [{ name: "suivis", text: "{utilisateur} : {followers} personnes" }, { name: "simple", text: "bonjour {utilisateur}" }] });
  const topics = () => w.spans.filter((s) => s.label.startsWith("topics:")).map((s) => s.label);
  await w.say("!simple", "lune_douce");
  assert.deepEqual(topics(), []);
  const r = await w.say("!suivis", "etoile_nord");
  assert.deepEqual(topics(), ["topics:social.stat"]);
  assert.match(r.sent[0], /^etoile_nord : 1.234 personnes$/);
  // an old value answers at once while the module is slow, and a failed refresh keeps the old value
  SRC.timing.ttlMs = 1; await sleep(5);
  w.slowTopics["social.stat"] = 800;
  const t0 = now();
  const second = await w.say("!suivis", "camille", { waitDone: false });
  await second.finish;
  assert.ok(second.sentAt - t0 < 300, `reply ${second.sentAt - t0} ms`);
  assert.match(second.sent[0], /camille : 1.234 personnes/);
});

/* ───────────── Rewards and timers ───────────── */

function homeWorld() {
  S.resetMemory(); SRC.resetSources(); R.resetRewards(); J.resetRedeem(); J.resetSims();
  const tw = fakeRewardsApi({});
  const ha = fakeHaBridge({});
  const acct = { ok: true, channel: "emma", ready: true, https: true, status: "ok", login: "emma", userId: "100", scopes: [...es.SCOPES.own, ...es.REWARD_SCOPES], wanted: [], adminPath: "/admin/instances/tw1" };
  const manifest = JSON.parse(fs.readFileSync(new URL("../modules/twitch-bot/module.json", import.meta.url), "utf8"));
  const ctx = fakeCtx({
    key: "bot", moduleId: "twitch-bot", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: fr, siteUrl: "https://site.example.org", settings: { onlyWhenLive: true, timezone: "Europe/Paris" }, logEvents: manifest.logEvents,
    topics: { "social.stat": [], "planning.slot": [], "social.link": [], ...ha.topics },
    services: { "home-assistant.bridge": ha.methods },
    serviceInstances: { "twitch.api": [{ instance: "emma", name: "emma", methods: { account: (a) => (a?.slot === "bot" ? { ...acct, status: "none", userId: null, scopes: [] } : acct), wantScopes: () => ({ ok: true }), connectLink: () => ({ ok: true, url: null }), disconnect: () => ({ ok: true }), request: (a) => tw.request(a) } }],
      "twitch.live": [{ instance: "emma", name: "emma", methods: { channel: () => ({ channel: "emma", ready: true }), status: () => ({ channel: "emma", configured: true, known: true, live: true, title: "T", game: "G", startedAt: new Date(Date.now() - 3_600_000).toISOString() }) } }] },
  });
  ctx.can = () => true;
  return { ctx, tw, ha };
}

test("rewards: a home reward is validated by itself a few seconds after the home answered, without waiting for another chat event", async () => {
  const saved = [...J.followTiming.delays];
  J.followTiming.delays = [20, 40, 80, 160, 320];
  try {
    const { ctx, tw, ha } = homeWorld();
    await S.updateState(ctx, (d) => { d.rewardsOn = true; d.secret = "bench-secret"; });
    const doc = { tid: "tid-0009-aaaa", title: "Lumiere rouge", cost: 100, cooldown: 0, prompt: "", action: "lumieres:rouge", reply: "", needsInput: false, pause: null, gone: false, refused: null };
    await ctx.api.store.add("reward", doc);
    tw.rewards.set("tid-0009-aaaa", { id: "tid-0009-aaaa", title: "Lumiere rouge", is_paused: false });
    const ev = { id: "red-0001-aaaa", broadcaster_user_id: "100", user_login: "lune_douce", user_name: "lune_douce", user_input: "", status: "unfulfilled", reward: { id: "tid-0009-aaaa", title: "Lumiere rouge", cost: 100, prompt: "" }, redeemed_at: new Date().toISOString() };
    const ts = new Date().toISOString(), body = JSON.stringify({ subscription: { type: es.TYPE_REDEEM }, event: ev });
    const headers = new Headers({ "twitch-eventsub-message-id": "m-red-0001", "twitch-eventsub-message-timestamp": ts, "twitch-eventsub-message-type": "notification", "twitch-eventsub-message-signature": es.sign("bench-secret", "m-red-0001", ts, body) });
    const out = await W.handle(new Request("https://site.example.org/m/bot/webhook", { method: "POST", headers, body }), ctx);
    await out.done;
    assert.equal(out.response.status, 204);
    assert.equal(ha.queue.length, 1, "the action was handed to the home; " + JSON.stringify((await ctx.api.store.list("redeem", { limit: 5 })).map((r) => r.data)));
    assert.deepEqual(tw.log.filter((c) => c.path.endsWith("/redemptions")), [], "not settled yet: the home has not answered");
    ha.resolve(ha.queue[0].ref, "done");
    const t0 = now();
    while (now() - t0 < 2000 && !tw.log.some((c) => c.path.endsWith("/redemptions"))) await sleep(10);
    const call = tw.log.find((c) => c.path.endsWith("/redemptions"));
    assert.ok(call, "settled without any other event");
    assert.equal(call.body.status, "FULFILLED");
    assert.ok(now() - t0 < 600, `settled ${(now() - t0).toFixed(0)} ms after the answer`);
  } finally { J.followTiming.delays = saved; }
});

test("rewards: a chat command never waits for rewards work (the reconcile and the house sync run beside it)", async () => {
  const w = await make({ ...LIGHT });
  await w.say("!discord", "etoile_nord");
  // there is something to settle and the home is slow to answer its state: the reply must not care
  await S.updateState(w.ctx, (d) => { d.rewardsOn = true; });
  w.slowTopics["ha.state"] = 600; w.slowTopics["ha.result"] = 600;
  J.resetRedeem();
  const r = await w.say("!discord", "lune_douce", { waitDone: false });
  await r.finish;
  assert.ok(r.sentAt - r.t0 < 250, `reply ${r.sentAt - r.t0} ms`);
});

test("timers: the one-minute task sends a repeat whose chat lines are already counted, at its time; it never counts a line and never writes into a silent chat", async () => {
  const w = await make({ ...LIGHT });
  await C.mutate(w.ctx, (cfg) => {
    cfg.custom[0].repeat = { minutes: 1, lines: 2, when: "always", enabled: true };
    cfg.custom.push({ id: "cz", name: "rappel", text: "pensez a boire", enabled: true, role: "everyone", aliases: [], repeat: { minutes: 1, lines: 0, when: "always", enabled: true } });
  });
  T.resetTimersMemory();
  const t0 = Date.now();
  const line = (n) => ({ messageId: `l${n}`, broadcasterId: "100", chatterId: `c${n}`, login: `lune${n}`, name: `lune${n}`, text: "bonjour", kind: "text", foreign: false, badges: [] });
  assert.equal((await T.processTimers(w.ctx, line(1), { now: t0 })).sent, false);
  assert.equal((await T.processTimers(w.ctx, line(2), { now: t0 + 10_000 })).sent, false, "interval not elapsed");
  const sentBefore = w.stamps.chat.length;
  const tick = await T.processTimers(w.ctx, null, { now: t0 + 61_000, tick: true });
  assert.equal(tick.sent, true, JSON.stringify(tick));
  assert.equal(tick.timer, "custom:c0", "the repeat that asks for lines, not the one that asks for none");
  assert.equal(w.stamps.chat.length, sentBefore + 1);
  // a second tick finds nothing due; a silent chat gets nothing from the task, even for the repeat that needs no lines
  assert.equal((await T.processTimers(w.ctx, null, { now: t0 + 125_000, tick: true })).sent, false);
  assert.equal(w.stamps.chat.length, sentBefore + 1);
  // a tick and a chat line at the same moment send once
  const [a, b] = await Promise.all([T.processTimers(w.ctx, null, { now: t0 + 200_000, tick: true }), T.processTimers(w.ctx, line(3), { now: t0 + 200_000 })]);
  assert.ok(a.sent !== b.sent || (!a.sent && !b.sent), "never twice");
});

test("timers: without a message or a tick nothing changes (a line still decides for the repeats that need none)", async () => {
  const w = await make({ ...LIGHT });
  await C.mutate(w.ctx, (cfg) => { cfg.custom[1].repeat = { minutes: 1, lines: 0, when: "always", enabled: true }; });
  T.resetTimersMemory();
  const t0 = Date.now();
  const line = { messageId: "x1", broadcasterId: "100", chatterId: "c1", login: "lune_douce", name: "lune_douce", text: "bonjour", kind: "text", foreign: false, badges: [] };
  await T.processTimers(w.ctx, line, { now: t0 });
  assert.equal((await T.processTimers(w.ctx, null, { now: t0 + 90_000, tick: true })).sent, false, "no line: no message, as before");
  assert.equal((await T.processTimers(w.ctx, { ...line, messageId: "x2" }, { now: t0 + 90_000 })).sent, true, "a line: sent");
});

test("tick: the one-minute task keeps the readings warm, so the next command of a quiet chat finds them ready, and writes nothing when nothing is due", async () => {
  const w = await make({ ...LIGHT });
  assert.equal(def.tasks.tick.everyMinutes, 1);
  await def.tasks.tick.run(w.ctx);
  const topics = w.spans.filter((s) => s.label.startsWith("topics:")).map((s) => s.label).sort();
  assert.deepEqual([...new Set(topics)], ["topics:planning.slot", "topics:social.link", "topics:social.stat"]);
  assert.equal(w.stamps.chat.length, 0, "nothing to say, nothing said");
  SRC.timing.ttlMs = 1; await sleep(5); w.expireChannel(); w.lat.streamsMs = 400; w.lat.topicMs = 500;
  const r = await w.say("!discord", "etoile_nord");
  assert.ok(r.sentAt - r.t0 < 250, `reply ${r.sentAt - r.t0} ms`);
});

test("sources: an old reading answers at once and is renewed in the background; a failed renewal keeps the old value; two readers share one read", async () => {
  SRC.resetSources();
  const ctx = (await make({})).ctx;
  let calls = 0, fail = false;
  ctx.api.topics.collect = async (topic) => { calls += 1; await sleep(50); if (fail) throw new Error("down"); return topic === "social.stat" ? [{ platform: "twitch", account: "emma", metric: "followers", value: 10 + calls }] : []; };
  SRC.timing.ttlMs = 1;
  const [a, b] = await Promise.all([SRC.followersCount(ctx, "emma"), SRC.followersCount(ctx, "emma")]);
  assert.deepEqual([a, b, calls], [11, 11, 1], "two readers, one read");
  await sleep(5);
  const t0 = now();
  assert.equal(await SRC.followersCount(ctx, "emma"), 11, "the old value, at once");
  assert.ok(now() - t0 < 30);
  await sleep(120);
  assert.equal(await SRC.followersCount(ctx, "emma"), 12, "renewed in the background");
  fail = true; await sleep(5);
  assert.equal(await SRC.followersCount(ctx, "emma"), 12);
  await sleep(120);
  assert.equal(await SRC.followersCount(ctx, "emma"), 12, "a failed renewal keeps the old value");
});
