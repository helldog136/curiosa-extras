// Le vrai module `home-assistant` branché au vrai `twitch-bot` (1.3.0) : le contrat de service tel qu'il est RÉELLEMENT servi, pas celui du faux (helpers/fakeHaBridge.mjs).
// Une simulation de récompense passe par `enqueue({ …, test: true })` du vrai pont : marquée, possible hors direct, jamais coupe-circuit actif ni sans appairage ; Twitch n'est jamais appelé.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeRewardsApi } from "./helpers/fakeRewards.mjs";
import { FakeHaClient, directTransport } from "./helpers/fakeHaClient.mjs";

const read = (m, p) => JSON.parse(fs.readFileSync(new URL(`../modules/${m}/${p}`, import.meta.url), "utf8"));
const haManifest = read("home-assistant", "module.json"), haFr = read("home-assistant", "locales/fr.json");
const botFr = read("twitch-bot", "locales/fr.json");
const haDef = (await import("../modules/home-assistant/index.mjs")).default;
const HB = await import("../modules/home-assistant/bridge.mjs");
const HL = await import("../modules/home-assistant/live.mjs");
const es = await import("../modules/twitch-bot/eventsub.mjs");
const S = await import("../modules/twitch-bot/state.mjs");
const SRC = await import("../modules/twitch-bot/sources.mjs");
const R = await import("../modules/twitch-bot/rewards.mjs");
const J = await import("../modules/twitch-bot/redeem.mjs");
const A = await import("../modules/twitch-bot/admin.mjs");
const { settingsOf } = await import("../modules/twitch-bot/settings.mjs");

const T0 = Date.parse("2026-10-14T20:00:00Z");
const defaults = Object.fromEntries(haManifest.settings.filter((s) => s.default !== undefined).map((s) => [s.key, s.default]));

function world({ twitchLive = true, ytLive } = {}) {
  HB.resetMemory(); HL.resetLive(); S.resetMemory(); SRC.resetSources(); R.resetRewards(); J.resetRedeem(); J.resetSims();
  mock.timers.reset(); mock.timers.enable({ apis: ["Date"], now: T0 });
  const ha = fakeCtx({
    key: "ha", moduleId: "home-assistant", name: "Home Assistant", basePath: "", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: haFr, settings: defaults,
    permissions: haManifest.permissions, siteUrl: "https://site.example.org",
    serviceInstances: {
      ...(twitchLive === null ? {} : { "twitch.live": [{ instance: "emma", methods: { status: () => ({ known: true, live: twitchLive }) } }] }),
      ...(ytLive === undefined ? {} : { "youtube.live": [{ instance: "yt", methods: { current: () => ({ ok: true, live: ytLive }) } }] }),
    },
  });
  ha.can = () => true;
  const svc = haDef.services["home-assistant.bridge"];
  const tw = fakeRewardsApi();
  const acct = { ok: true, channel: "emma", ready: true, https: true, status: "ok", login: "emma", userId: "100", scopes: [...es.SCOPES.own, ...es.REWARD_SCOPES], wanted: [], adminPath: "/admin/instances/tw1" };
  const bot = fakeCtx({
    key: "bot", moduleId: "twitch-bot", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: botFr, siteUrl: "https://site.example.org", settings: { onlyWhenLive: true, timezone: "Europe/Paris" },
    topics: {
      "social.stat": [], "planning.slot": [], "social.link": [],
      "ha.result": (opts) => haDef.exports["ha.result"](ha, opts), "ha.state": (opts) => haDef.exports["ha.state"](ha, opts),
    },
    services: { "home-assistant.bridge": Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](ha, args)])) },
    serviceInstances: {
      "twitch.api": [{ instance: "emma", name: "emma", methods: { account: () => acct, wantScopes: () => ({ ok: true }), connectLink: () => ({ ok: true, url: "https://id.twitch.tv/x" }), disconnect: () => ({ ok: true }), request: (a) => tw.request(a) } }],
      "twitch.live": [{ instance: "emma", name: "emma", methods: { status: () => ({ channel: "emma", configured: true, known: true, live: twitchLive === true, title: "T", game: "G", startedAt: new Date(T0 - 3_600_000).toISOString() }) } }],
    },
  });
  bot.can = () => true;
  return { ha, bot, tw, svc };
}
async function pairUp(w) {
  const { code } = await HB.createPairing(w.ha);
  const client = new FakeHaClient({ send: directTransport(haDef, w.ha), bindings: { "lumieres:rouge": async () => {}, "tts:lire": async () => {} } });
  assert.equal((await client.pair(code, "Maison")).status, 200);
  await client.pull(); mock.timers.tick(1100);
  return client;
}
const mkReward = async (w, over = {}) => {
  await A.actions.rewardsEnable.run(w.bot, {});
  const r = await A.actions.rewardCreate.run(w.bot, { title: "Rouge", cost: "500", cooldownMin: "1", prompt: "", action: "lumieres:rouge", ...over });
  assert.ok(r.ok, JSON.stringify(r));
  return (await R.list(w.bot)).find((x) => x.title === "Rouge");
};

test("le vrai pont : une simulation de récompense passe par le test du pont (hors direct), arrive à Home Assistant marquée `test`, et Twitch n'est pas appelé", async () => {
  const w = world({ twitchLive: false });
  const client = await pairUp(w);
  const rw = await mkReward(w);
  const before = w.tw.log.length;
  const p = J.simulate(w.bot, settingsOf(w.bot), rw.id, { now: T0, waitMs: 4000, pollMs: 20 });
  await new Promise((ok) => setTimeout(ok, 80));
  mock.timers.tick(1100);
  const step = await client.step();
  assert.equal(step.actions.length, 1);
  assert.equal(step.actions[0].test, true);
  assert.equal(step.actions[0].viewer, "Test");
  assert.equal(step.live, false, "hors direct, et le test est livré quand même");
  const r = await p;
  assert.deepEqual([r.ok, r.mode, r.status], [true, "result", "done"]);
  assert.equal(w.tw.log.length, before, "aucun appel à Twitch");
  mock.timers.reset();
});

test("le vrai pont : simulation refusée avec le coupe-circuit actif ou sans appairage ; un vrai échange hors direct reste refusé", async () => {
  const w = world({ twitchLive: false });
  const rw = await mkReward(w);
  const s = settingsOf(w.bot);
  let r = await J.simulate(w.bot, s, rw.id, { now: T0, waitMs: 0 });
  assert.deepEqual([r.ok, r.code, r.reason], [false, "refused", "not_paired"]);
  await pairUp(w);
  await w.svc.stop(w.ha, { by: "owner" });
  r = await J.simulate(w.bot, s, rw.id, { now: T0 + 4000, waitMs: 0 });
  assert.deepEqual([r.ok, r.code, r.reason], [false, "refused", "off"]);
  await w.svc.start(w.ha, { by: "owner" });
  assert.deepEqual(await w.svc.enqueue(w.ha, { key: "lumieres:rouge", ref: "red-1" }), { ok: false, reason: "not_live" });
  mock.timers.reset();
});

test("le vrai pont : une personne qui ne diffuse que sur YouTube — un vrai échange passe quand YouTube dit direct", async () => {
  const w = world({ twitchLive: null, ytLive: true });
  await pairUp(w);
  assert.equal((await w.svc.enqueue(w.ha, { key: "lumieres:rouge", ref: "red-2" })).ok, true);
  assert.equal((await w.svc.status(w.ha)).live, true);
  mock.timers.reset();
});
