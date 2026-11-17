// One reaction per channel point reward (Twitch activity 1.12.0, Alerts overlay 1.17.0, Twitch bot 1.22.0, Twitch connector 1.6.0; 1.18.0: Twitch activity is
// part of the alerts overlay). Two real modules talk through their real service code: the alerts overlay (the Rewards tab, the reactions and the alerts) and the
// Twitch bot (`twitch.rewards`, the creation on Twitch). Twitch itself is the fake of fakeRewards.mjs: full Twitch reward shapes, rewards made by
// hand on Twitch (listed, never manageable), the connector's permission check (reading takes "read" or "manage", writing "manage"), 403 without channel points.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeRewardsApi } from "./helpers/fakeRewards.mjs";
import { world as evWorld, EV, deliver, S as evS, P as evP, mod as evMod, NOW } from "./helpers/eventsWorld.mjs";
import { assertAdminPageErgonomics } from "./helpers/ergonomics.mjs";

const json = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), "utf8"));
const alMan = json("../modules/alerts-overlay/module.json"), alEn = json("../modules/alerts-overlay/locales/en.json");
const evMan = alMan, evEn = alEn, evFr = json("../modules/alerts-overlay/locales/fr.json");
const botMan = json("../modules/twitch-bot/module.json"), botEn = json("../modules/twitch-bot/locales/en.json"), botFr = json("../modules/twitch-bot/locales/fr.json");
const tw = await import("../modules/alerts-overlay/twitch.mjs");
const rx = await import("../modules/alerts-overlay/reaction.mjs");
const rwo = await import("../modules/alerts-overlay/rewards.mjs");
const cp = await import("../modules/alerts-overlay/compose.mjs");
const md = await import("../modules/alerts-overlay/media.mjs");
const alIndex = await import("../modules/alerts-overlay/index.mjs");
const alDef = alIndex.default;
const evRw = await import("../modules/alerts-overlay/twitch/rewards.mjs");
const evRx = await import("../modules/alerts-overlay/twitch/reaction.mjs");
const botDef = (await import("../modules/twitch-bot/index.mjs")).default;
const botEs = await import("../modules/twitch-bot/eventsub.mjs");
const botR = await import("../modules/twitch-bot/rewards.mjs");
const botA = await import("../modules/twitch-bot/actions.mjs");
const botJ = await import("../modules/twitch-bot/redeem.mjs");
const botS = await import("../modules/twitch-bot/state.mjs");

const HYD = "92af127c-7326-4483-a52b-b0da0be61c01", CONF = "5f1c7e2a-0b8d-4a51-9a3e-0e7c2d4b9f10", OLD = "0c2e9d41-77aa-4f4b-8d0e-9b1a2c3d4e5f";
const U = (n, ext) => `/uploads/${String(n).padStart(8, "0")}-0123-4567-89ab-0123456789ab.${ext}`;
const G = (n) => U(n, "gif"), V = (n) => U(100 + n, "webm");
const isoNow = () => new Date().toISOString();
const item = (over = {}) => ({ id: `x${Math.random()}`, type: "redeem", name: "lune_douce", login: "lune_douce", title: "Hydrate", amount: 500, at: isoNow(), ...over });
const env = { text: (k) => `t_${k}`, title: (p) => p };

let n = 0;
/**
 * The three modules and the fake Twitch. `o.api`: options of the fake Twitch; `o.scopes`: the permissions of Twitch activity's account (default: what its types ask);
 * `o.noBot`, `o.noOverlay`, `o.botScopes`, `o.can` (the person holds the bot's right), `o.uploads`.
 */
function sites(o = {}) {
  tw.resetTwitchState(); rwo.resetRewardCache(); evRw.resetRewardsCache(); cp.resetComposeCache(); md.resetValve(); botR.resetRewards(); botS.resetMemory(); botJ.resetRedeem();
  const api = fakeRewardsApi({ foreign: [{ id: HYD, title: "Hydrate", cost: 500 }, { id: CONF, title: "Confettis", cost: 1000, is_paused: true }], ...o.api });
  const botAcct = { ok: true, channel: "emma_test", ready: true, https: true, status: "ok", login: "emma_test", userId: "100", scopes: o.botScopes ?? [...botEs.SCOPES.own, ...botEs.REWARD_SCOPES], wanted: [], adminPath: "/admin/instances/tw1" };
  const bot = fakeCtx({
    key: "bot", moduleId: "twitch-bot", locale: "en", messages: botEn, siteUrl: "https://site.example.org", settings: { onlyWhenLive: true }, logEvents: botMan.logEvents,
    topics: { "social.stat": [], "planning.slot": [], "social.link": [], "ha.result": [], "ha.state": [] },
    serviceInstances: {
      "twitch.api": [{ instance: "emma", name: "emma", methods: { account: (a) => (a?.slot === "bot" ? { ...botAcct, status: "none", userId: null, scopes: [] } : botAcct), wantScopes: () => ({ ok: true }), connectLink: () => ({ ok: true, url: "https://id.twitch.tv/oauth2/authorize?x=1" }), request: (a) => { api.state.scopes = botAcct.scopes; return api.request(a); } } }],
      "twitch.live": [{ instance: "emma", name: "emma", methods: { status: () => ({ channel: "emma_test", configured: true, known: true, live: true }), channel: () => ({ channel: "emma_test", ready: true }) } }],
    },
  });
  bot.can = (right) => o.can !== false && right === "rewards.manage";
  // (1.18.0) the overlay and the former Twitch activity are ONE copy: `al` and `ev` are the same context
  const w = evWorld({ locale: o.locale ?? "en", uploads: o.uploads ?? [], tw: { rewardsApi: api, ...(o.scopes ? { scopes: o.scopes } : {}) } });
  const al = w.ctx;
  const sent = []; globalThis.__curiosaAlertsBus?.on?.(al.instance.key, (e) => sent.push(e));
  const base = w.ctx.api.services, calls = [];
  const svc = { "twitch.rewards": o.noBot ? null : [botDef.services["twitch.rewards"], bot] };
  w.ctx.api.services = {
    ...base,
    providers: async (name) => (name in svc ? (svc[name] ? [{ id: `id-${name}`, key: name, name, module: name, version: 1, each: true, master: true }] : []) : base.providers(name)),
    call: async (name, method, args, opts) => {
      if (!(name in svc)) return base.call(name, method, args, opts);
      calls.push(`${name}.${method}${opts?.asCaller ? ":asCaller" : ""}`);
      if (!svc[name] || typeof svc[name][0][method] !== "function") return { ok: false, reason: "no-provider" };
      try { return { ok: true, value: await svc[name][0][method](svc[name][1], args) }; } catch { return { ok: false, reason: "failed" }; }
    },
  };
  return { api, al, bot, ev: w.ctx, tw: w.tw, sent, calls };
}
const tab = async (s, query = {}) => (await evMod.adminPanel(s.ev, { query: { tab: "rewards", ...query } })).filter((b) => b.tab === "rewards");
const tableOf = (blocks) => blocks.find((b) => b.type === "table");
const dialogOf = (blocks, action = "saveReaction") => blocks.find((b) => b.presentation === "dialog" && b.action === action);
const enableRedeem = (s) => evS.updateState(s.ev, (x) => { x.enabled = { ...(x.enabled ?? {}), redeem: true }; });

/* ───────────── the reward of a redemption, from Twitch to the alert ───────────── */

test("a redemption keeps the id of its reward: journal, topic, and the alerts overlay reads it (schema)", async () => {
  const s = sites();
  await enableRedeem(s);
  await evS.ensureSecret(s.ev);
  assert.equal((await deliver(s.ev, "channel.channel_points_custom_reward_redemption.add", EV.redeem())).status, 204);
  const [line] = await evS.recent(s.ev, 5);
  assert.deepEqual([line.kind, line.rewardId, line.title, line.amount], ["redeem", HYD, "Hydrate", 500]);
  assert.equal(evP.toItem(line).rewardId, HYD);
  assert.ok(alMan.consumes.find((c) => c.topic === "twitch.event").schema.some((f) => f.key === "rewardId" && f.type === "string"), "the overlay keeps the field");
  // an id Twitch would never send is dropped, the line stays
  await deliver(s.ev, "channel.channel_points_custom_reward_redemption.add", EV.redeem({ id: "<b>x</b>", title: "Odd", cost: 5 }), { id: "m-odd" });
  const odd = (await evS.recent(s.ev, 5)).find((l) => l.title === "Odd");
  assert.equal(odd.rewardId, undefined);
});

test("alert: a reward with its own reaction shows ITS file, ITS placed text and ITS turn; anything else shows the reaction of the type, byte for byte as before", async () => {
  const s = sites({ uploads: [G(1), G(2), G(3)].map((url) => ({ url, by: "u1" })) });
  assert.ok((await rx.set(s.al, "redeem", { variants: [G(1)] })).ok);
  const cfg = await tw.loadConfig(s.al);
  const before = { noId: tw.alertFor(item({ id: "a" }), { config: cfg, ...env }), unknown: tw.alertFor(item({ id: "a", rewardId: CONF }), { config: cfg, ...env }) };
  assert.deepEqual(before.unknown, before.noId);
  assert.ok((await rx.setReward(s.al, HYD, { title: "Hydrate", cost: 500 }, { variants: [G(2), G(3)], pick: "rotate", text: "{name} drinks water" })).ok);
  const rewards = await rwo.byId(s.al), pick = tw.pickerOf(tw.stateOf(s.al));
  const shown = [1, 2, 3].map((i) => tw.alertFor(item({ id: `h${i}`, rewardId: HYD }), { config: cfg, ...env, rewards, pick }).alert);
  assert.deepEqual(shown.map((a) => a.image), [G(2), G(3), G(2)], "its own files, in turn");
  assert.equal(shown[0].message, "lune_douce drinks water");
  const other = tw.alertFor(item({ id: "o", rewardId: CONF }), { config: cfg, ...env, rewards, pick }).alert;
  assert.equal(other.image, G(1), "another reward: the reaction of all the others");
  assert.deepEqual(tw.alertFor(item({ id: "a" }), { config: cfg, ...env, rewards }), before.noId, "no id (an older Twitch activity): exactly as before");
  // the compositions follow the place of the reward
  const places = [];
  tw.alertFor(item({ id: "c", rewardId: HYD }), { config: cfg, ...env, rewards, compose: (place) => { places.push(place); return null; } });
  tw.alertFor(item({ id: "d", rewardId: CONF }), { config: cfg, ...env, rewards, compose: (place) => { places.push(place); return null; } });
  assert.deepEqual(places, [`event:redeem:${HYD}`, "event:redeem"]);
  // its switch: off → nothing for that reward only; the switch of all the others does not touch it
  await rx.setReward(s.al, HYD, {}, { on: false });
  const r2 = await rwo.byId(s.al);
  assert.equal(tw.alertFor(item({ rewardId: HYD }), { config: cfg, ...env, rewards: r2 }).skip, "off");
  assert.ok(tw.alertFor(item({ rewardId: HYD, test: true }), { config: cfg, ...env, rewards: r2 }).alert, "a test still shows");
  await rx.setReward(s.al, HYD, {}, { on: true });
  await rx.set(s.al, "redeem", { on: false });
  const cfg2 = await tw.loadConfig(s.al), r3 = await rwo.byId(s.al);
  assert.equal(tw.alertFor(item({ rewardId: CONF }), { config: cfg2, ...env, rewards: r3 }).skip, "off");
  assert.ok(tw.alertFor(item({ rewardId: HYD }), { config: cfg2, ...env, rewards: r3 }).alert, "a reward with its own row keeps its own switch");
});

test("overlay service: the files of a reward are kept HERE, released when it lets go of them (never while another reaction uses them); forget removes the row and its placed texts", async () => {
  const s = sites({ uploads: [G(1), G(2), V(1)].map((url) => ({ url, by: "u1" })) });
  const r = await rx.setReward(s.al, HYD, { title: "Hydrate", cost: 500 }, { variants: [G(1), V(1)], videoSound: true });
  assert.ok(r.ok); assert.deepEqual([r.images, r.videos], [1, 1]);
  assert.equal(s.al.calls.files.filter((c) => c.op === "claim" && c.result.ok).length, 2);
  assert.deepEqual((await rx.setReward(s.al, HYD, {}, { variants: [G(9)] })).errors, { variants: "kept" }, "a file the person did not just send");
  assert.deepEqual((await rx.setReward(s.al, "../x", {}, {})).code, "reward");
  const got = await rx.getReward(s.al, HYD);
  assert.deepEqual([got.own, got.title, got.cost, got.variants.map((x) => x.src)], [true, "Hydrate", 500, [G(1), V(1)]]);
  const fresh = await rx.getReward(s.al, CONF);
  assert.deepEqual([fresh.own, fresh.variants, fresh.text], [false, [], ""], "a reward without its own reaction starts empty, never with the others' files");
  // the same GIF on the type: removing it from the reward keeps the file
  await rx.set(s.al, "redeem", { variants: [G(1)] });
  await rx.setReward(s.al, HYD, {}, { variants: [V(1)] });
  const removed = () => s.al.calls.files.filter((c) => c.op === "remove").map((c) => c.url);
  assert.deepEqual(removed(), [], "G1 is still the reaction of the others");
  // a type change that drops G1 does not drop V1, which the reward still uses
  await rx.set(s.al, "redeem", { variants: [] });
  assert.deepEqual(removed(), [G(1)]);
  assert.equal((await tw.releaseFile(s.al, V(1))).kept, true, "the reward still uses the video");
  // placed text on the reward's file, then forget
  if (cp.available(s.al)) {
    const comp = s.al.overlay.defaultComposition(V(1));
    assert.ok((await rx.setReward(s.al, HYD, {}, { variants: [V(1)], compositions: { [V(1)]: comp } })).ok);
    assert.equal(Object.keys(await cp.forPlace(s.al, `event:redeem:${HYD}`)).length, 1);
    assert.equal(Object.keys(await cp.forPlace(s.al, "event:redeem")).length, 0, "never on the place of the others");
  }
  const list = await rx.rewards(s.al);
  assert.deepEqual(list.rewards.map((x) => [x.reward, x.own, x.on]), [[HYD, true, true]]);
  assert.ok((await rx.forgetReward(s.al, HYD)).removed);
  assert.ok(removed().includes(V(1)), "its last file is let go");
  assert.deepEqual(await cp.forPlace(s.al, `event:redeem:${HYD}`), {});
  assert.deepEqual((await rx.rewards(s.al)).rewards, []);
  // a configuration saved by an older overlay never touches the rows (separate collection)
  await rx.setReward(s.al, CONF, { title: "Confettis" }, { on: false });
  await tw.saveConfig(s.al, tw.normaliseConfig({ types: {} }));
  rwo.resetRewardCache();
  assert.equal((await rwo.one(s.al, CONF)).on, false);
});

test("overlay service: the test of a reward shows that reward's reaction with its title and cost; nothing saved", async () => {
  const s = sites({ uploads: [G(1), G(2)].map((url) => ({ url, by: "u1" })) });
  await rx.set(s.al, "redeem", { variants: [G(1)] });
  const svc = alIndex.reactionService, claims = () => s.al.calls.files.filter((c) => c.op === "claim").length, before = claims();
  assert.ok((await svc.test(s.al, { type: "redeem", reward: HYD, title: "Hydrate", cost: 500, patch: { variants: [{ src: G(2) }], text: "{title} for {name}" } })).ok);
  const a = s.sent.at(-1);
  assert.deepEqual([a.image, a.message], [G(2), "Hydrate for lune_douce"]);
  assert.equal(await rwo.one(s.al, HYD), null, "nothing saved"); assert.equal(claims(), before, "nothing claimed");
  assert.ok((await svc.test(s.al, { type: "redeem", reward: HYD, title: "Hydrate", cost: 500, patch: {} })).ok);
  assert.equal(s.sent.at(-1).image, G(1), "without its own reaction: the reaction of all the others, as a real redemption would show");
});

/* ───────────── Twitch activity: the Rewards tab ───────────── */

test("rewards list: every reward of the channel from Twitch (made by hand or by the bot), with its reaction; a reward gone from Twitch keeps its line while it has a reaction", async () => {
  const s = sites({ uploads: [G(1)].map((url) => ({ url, by: "u1" })) });
  await rx.setReward(s.al, HYD, { title: "Hydrate", cost: 500 }, { variants: [G(1)] });
  await rx.setReward(s.al, OLD, { title: "Old reward", cost: 50 }, { on: true });
  const list = await evRw.list(s.ev);
  assert.equal(list.twitch.ok, true);
  assert.deepEqual(list.items.map((x) => [x.title, x.cost, x.gone, !!x.row?.own]), [["Confettis", 1000, false, false], ["Hydrate", 500, false, true], ["Old reward", 50, true, false]]);
  assert.equal(list.items[0].paused, true);
  const call = s.tw.calls.find((c) => c.path === "channel_points/custom_rewards");
  assert.deepEqual([call.method, call.as, call.slot, call.query], ["GET", "user", "main", { broadcaster_id: "100" }], "every reward, not only the manageable ones");
  // read once every 30 s at most
  await evRw.list(s.ev); await evRw.list(s.ev);
  assert.equal(s.tw.calls.filter((c) => c.path === "channel_points/custom_rewards").length, 1);
});

test("rewards list without the permission to read them: the connector refuses before Twitch, the page says what to do, the rewards seen in the journal are still listed", async () => {
  const s = sites({ scopes: ["moderator:read:followers"] });
  await enableRedeem(s);
  await evS.ensureSecret(s.ev);
  await deliver(s.ev, "channel.channel_points_custom_reward_redemption.add", EV.redeem());
  const list = await evRw.list(s.ev);
  assert.deepEqual(list.twitch, { ok: false, code: "scope" });
  assert.equal(s.api.log.filter((l) => l.path.startsWith("channel_points")).length, 0, "nothing left for Twitch");
  assert.deepEqual(list.items.map((x) => [x.id, x.title, x.gone]), [[HYD, "Hydrate", false]], "never called gone when Twitch could not be read");
  await enableRedeem(s);
  const blocks = await tab(s);
  assert.ok(blocks.some((b) => b.type === "links" && b.items[0].label === evEn.rw_scope && b.items[0].href === "?tab=twitch"));
  // a channel without channel points (Twitch 403)
  const na = sites({ api: { affiliate: false } });
  assert.deepEqual((await evRw.list(na.ev)).twitch, { ok: false, code: "na" });
  await enableRedeem(na);
  const nb = await tab(na);
  assert.ok(nb.some((b) => b.type === "markdown" && b.text === evEn.rw_na));
  assert.ok(!nb.some((b) => b.type === "links" && b.items.some((i) => i.label === evEn.rw_add_btn)), "no Add button for a channel without points");
});

test("Rewards tab: one sentence, Add a reward, a searchable table with All other rewards first, a switch per line, two visible actions; ergonomics", async () => {
  const s = sites({ uploads: [G(1)].map((url) => ({ url, by: "u1" })) });
  await enableRedeem(s);
  await rx.setReward(s.al, HYD, { title: "Hydrate", cost: 500 }, { variants: [G(1)] });
  const blocks = await tab(s);
  assert.equal(blocks[0].text, evEn.rw_intro);
  const add = blocks.find((b) => b.type === "links" && b.items[0].label === evEn.rw_add_btn);
  assert.deepEqual([add.items[0].href, add.items[0].presentation], ["?tab=rewards&new=1", "dialog"]);
  const t = tableOf(blocks);
  assert.equal(t.searchable, true); assert.equal(t.searchPlaceholder, evEn.rw_search); assert.equal(t.empty, evEn.rw_empty);
  assert.deepEqual(t.rowIds, ["*", CONF, HYD]);
  assert.deepEqual(t.rows.map((r) => r[0].text), [evEn.rw_others, "Confettis", "Hydrate"]);
  assert.deepEqual(t.rows.map((r) => r[2].text), ["Text", "—", "GIF"], "a reward without its own reaction says nothing special (R14)");
  assert.equal(t.rows[1][0].title, evEn.rw_paused_title, "paused on Twitch: said in the tooltip only");
  assert.ok(t.rows.every((r) => r[3].switch?.action === "setRewardOn"));
  assert.deepEqual(t.rowActions.map((a) => [a.label, !!a.inMenu, !!a.danger]), [["Edit", false, false], [evEn.test_btn, true, false], [evEn.rw_forget_btn, true, true]]);
  assert.match(t.rowActions[0].href, /reaction=\{id\}/);
  assertAdminPageErgonomics(blocks);
  // the Types tab: the channel points cell leads here
  const types = (await evMod.adminPanel(s.ev, { query: { tab: "twitch" } })).find((b) => b.tab === "twitch" && b.type === "table");
  const col = types.columns.indexOf("Reaction"), row = types.rows[types.rowIds.indexOf("redeem")];
  assert.equal(row[col].href, "?tab=rewards");
  assert.match(row[col].text, /own: 1$/);
});

test("Rewards tab: the empty state says what to do; without the bot one line with a link; bot without the permission: a link to authorize it", async () => {
  const empty = sites({ api: { foreign: [] } });
  await enableRedeem(empty);
  const t = tableOf(await tab(empty));
  assert.deepEqual(t.rows, []); assert.equal(t.empty, evEn.rw_empty);
  const noBot = sites({ noBot: true });
  await enableRedeem(noBot);
  const nb = await tab(noBot);
  assert.ok(nb.some((b) => b.type === "links" && b.items[0].label === evEn.rw_add_need_bot && b.items[0].href === "/admin/catalogue"));
  const weak = sites({ botScopes: botEs.SCOPES.own });
  await enableRedeem(weak);
  const wb = await tab(weak);
  assert.ok(wb.some((b) => b.type === "links" && b.items[0].label === evEn.rw_add_need_scope && /tab=rewards$/.test(b.items[0].href)));
  const off = sites();
  assert.ok((await tab(off)).some((b) => b.type === "links" && b.items[0].label === evEn.rw_type_off), "Channel points switched off: say where to switch them on");
  // (1.18.0) "old overlay: update it" is gone: the reactions are the overlay's own
});

test("reaction window of a reward: its title, the gallery with the preview following the sentence, the reward carried in hidden fields; save and test go to THAT reward", async () => {
  const s = sites({ uploads: [G(1), G(2)].map((url) => ({ url, by: "u1" })) });
  await enableRedeem(s);
  const blocks = await tab(s, { reaction: HYD });
  const f = dialogOf(blocks);
  assert.equal(f.title, "Reaction to “Hydrate”"); assert.equal(f.cancelHref, "?tab=rewards"); assert.equal(f.tab, "rewards");
  const hidden = Object.fromEntries(f.fields.filter((x) => x.kind === "hidden").map((x) => [x.name, x.value]));
  assert.deepEqual([hidden.id, hidden.reward, hidden.rewardTitle, hidden.rewardCost], ["redeem", HYD, "Hydrate", "500"]);
  const g = f.fields.find((x) => x.kind === "gallery");
  if (g.compose) { assert.equal(g.compose.phraseField, "text"); assert.ok(g.compose.variables.some((v) => v.token === "title" && v.sample === "Hydrate"), "the reward's own title is the example"); }
  assert.deepEqual(f.fields.filter((x) => x.kind !== "hidden" && !x.folded).map((x) => x.kind), ["gallery", "segmented"]);
  assertAdminPageErgonomics(blocks);
  const values = { id: "redeem", reward: HYD, rewardTitle: "Hydrate", rewardCost: "500", variants: JSON.stringify([{ src: G(2) }]), pick: "random", text: "", sound: "", audio: "", seconds: "" };
  const saved = await evMod.adminActions.saveReaction(s.ev, values);
  assert.equal(saved.ok, "Reaction of “Hydrate” saved.");
  assert.deepEqual((await rwo.one(s.al, HYD)).cfg.image, G(2));
  assert.equal((await tw.loadConfig(s.al)).types.redeem.image, "", "the type is untouched");
  assert.ok((await evMod.adminActions.testReaction(s.ev, values)).ok);
  assert.equal(s.sent.at(-1).image, G(2));
  assert.deepEqual(await evMod.adminActions.saveReaction(s.ev, { ...values, reward: "../../x" }), { error: evEn.rw_err_unknown });
  // the window of all the other rewards, from either tab
  const others = dialogOf(await tab(s, { reaction: "*" }));
  assert.equal(others.title, evEn.rx_title_others);
  assert.ok(!others.fields.some((x) => x.name === "reward"));
  const fromTypes = dialogOf((await evMod.adminPanel(s.ev, { query: { tab: "twitch", reaction: "redeem" } })).filter((b) => b.tab === "twitch"));
  assert.equal(fromTypes.title, evEn.rx_title_others);
});

test("switch, test and remove a reward's reaction from its line; All other rewards cannot be removed", async () => {
  const s = sites({ uploads: [G(1)].map((url) => ({ url, by: "u1" })) });
  await enableRedeem(s);
  assert.deepEqual(await evMod.adminActions.setRewardOn(s.ev, { id: CONF, enabled: "0" }), { ok: "Alert of “Confettis” off." });
  assert.deepEqual([(await rwo.one(s.al, CONF)).on, (await rwo.one(s.al, CONF)).cfg, (await rwo.one(s.al, CONF)).title], [false, null, "Confettis"], "a row that only holds the switch");
  assert.ok((await evMod.adminActions.setRewardOn(s.ev, { id: "*", enabled: "0" })).ok);
  assert.equal((await tw.loadConfig(s.al)).types.redeem.on, false);
  assert.deepEqual(await evMod.adminActions.setRewardOn(s.ev, { id: "nope", enabled: "1" }), { error: evEn.rw_err_unknown });
  assert.ok((await evMod.adminActions.testReward(s.ev, { id: HYD })).ok);
  const line = (await evS.recent(s.ev, 3)).find((l) => l.source === "test");
  assert.deepEqual([line.rewardId, line.title, line.amount], [HYD, "Hydrate", 500]);
  await rx.setReward(s.al, HYD, { title: "Hydrate" }, { variants: [G(1)] });
  assert.deepEqual(await evMod.adminActions.forgetReward(s.ev, { id: HYD }), { ok: "Reaction of “Hydrate” removed." });
  assert.equal(await rwo.one(s.al, HYD), null);
  assert.deepEqual(await evMod.adminActions.forgetReward(s.ev, { id: "*" }), { error: evEn.rw_err_others });
});

/* ───────────── Add a reward: created on Twitch by the Twitch bot ───────────── */

test("Add a reward: two fields; the bot creates it on Twitch (alert only, skips the request queue), audited; the reaction window of the new reward opens", async () => {
  const s = sites();
  await enableRedeem(s);
  const f = dialogOf(await tab(s, { new: "1" }), "createReward");
  assert.equal(f.tab, "rewards");
  assert.deepEqual(f.fields.map((x) => [x.name, x.kind ?? "text", !!x.folded]), [["title", "text", false], ["cost", "number", false]]);
  assert.equal(f.submitLabel, evEn.rw_new_btn);
  const r = await evMod.adminActions.createReward(s.ev, { title: "Lucky dice", cost: "250" });
  const made = [...s.api.rewards.values()].find((x) => x.title === "Lucky dice");
  assert.ok(made, "created at Twitch");
  assert.deepEqual([made.cost, made.should_redemptions_skip_request_queue, made.is_user_input_required], [250, true, false]);
  assert.deepEqual(r, { redirect: `?tab=rewards&reaction=${made.id}` });
  assert.ok(s.calls.includes("twitch.rewards.create:asCaller"), "the person's right is carried");
  const doc = (await botR.list(s.bot)).find((x) => x.title === "Lucky dice");
  assert.equal(doc.action, botA.ALERT_ACTION);
  assert.deepEqual(s.bot.dumpLog().map((l) => [l.action, l.data.title]), [["reward.created", "Lucky dice"]]);
  assert.ok(!JSON.stringify(s.bot.dumpLog()).match(/token|secret/i));
  // the list sees it at once (read again)
  assert.ok((await evRw.list(s.ev)).items.some((x) => x.title === "Lucky dice"));
  // errors under the fields, in words
  assert.deepEqual(await evMod.adminActions.createReward(s.ev, { title: "hydrate", cost: "10" }), { errors: { title: evEn.rw_e_dup } }, "the same name as a reward made by hand: Twitch refuses, said under the name");
  assert.deepEqual(await evMod.adminActions.createReward(s.ev, { title: "", cost: "x" }), { errors: { title: evEn.rw_e_title, cost: evEn.rw_e_cost } });
  const denied = sites({ can: false });
  assert.deepEqual(await evMod.adminActions.createReward(denied.ev, { title: "Lucky dice", cost: "250" }), { error: evEn.rw_e_denied });
  assert.equal([...denied.api.rewards.values()].some((x) => x.title === "Lucky dice"), false);
  const weak = sites({ botScopes: botEs.SCOPES.own });
  assert.deepEqual(await evMod.adminActions.createReward(weak.ev, { title: "Lucky dice", cost: "250" }), { error: evEn.rw_e_need_scope });
  const na = sites({ api: { affiliate: false } });
  assert.deepEqual(await evMod.adminActions.createReward(na.ev, { title: "Lucky dice", cost: "250" }), { error: evEn.rw_e_na });
  const noBot = sites({ noBot: true });
  assert.deepEqual(await evMod.adminActions.createReward(noBot.ev, { title: "Lucky dice", cost: "250" }), { error: evEn.rw_add_need_bot });
});

test("Twitch bot: an alert-only reward does nothing in the chat or at home, is never refunded, and shows in its Rewards tab as 'Show the alert only'", async () => {
  const s = sites();
  const made = await botDef.services["twitch.rewards"].create(s.bot, { title: "Lucky dice", cost: 250 });
  assert.ok(made.ok);
  assert.equal(botA.isHome(botA.ALERT_ACTION), false);
  assert.equal(botEs.rewardBody({ title: "x", cost: 1, cooldown: 0, action: botA.ALERT_ACTION }).should_redemptions_skip_request_queue, true);
  assert.equal(botEs.rewardBody({ title: "x", cost: 1, cooldown: 0, action: botA.BOT_ACTION }).should_redemptions_skip_request_queue, false, "other rewards: as before");
  assert.equal(botEs.ALERT_ONLY, botA.ALERT_ACTION);
  // a redemption that arrives UNFULFILLED anyway (the queue setting changed on Twitch) is fulfilled, never refunded
  const r = await botJ.processRedemption(s.bot, { id: "red-1", rewardId: made.reward.id, broadcasterId: "100", login: "lune_douce", name: "lune_douce", status: "unfulfilled", at: Date.now() });
  assert.deepEqual([r.handled, r.reason], [true, "ok"]);
  assert.ok(s.api.settled.get("red-1") === "FULFILLED" || r.result === "settling");
  const fulfilled = await botJ.processRedemption(s.bot, { id: "red-2", rewardId: made.reward.id, broadcasterId: "100", login: "x", name: "x", status: "fulfilled", at: Date.now() });
  assert.equal(fulfilled.handled, false, "the usual case: it skipped the queue, nothing to do");
  assert.equal(botEn.act_alerte_seule, "Show the alert only"); assert.equal(botFr.act_alerte_seule, "Montrer l'alerte seulement");
  const st = await botDef.services["twitch.rewards"].status(s.bot);
  assert.deepEqual([st.canCreate, st.count, st.max], [true, 1, 20]);
  assert.ok(botMan.offers.some((o) => o.service === "twitch.rewards" && o.callerRights.includes("create") && o.readOnly.includes("status")));
  assert.ok(evMan.requires.some((r) => r.service === "twitch.rewards" && r.optional === true), "Twitch activity works without the bot");
});

/* ───────────── assistant tools ───────────── */

test("MCP: reaction_set/get/test take a reward (id or exact title); composition_places lists the reward's place; twitch_events_rewards gives each reward and its reaction", async () => {
  const s = sites({ uploads: [G(1)].map((url) => ({ url, by: "u1" })) });
  const lib = await md.add(s.al, { name: "Water", kind: "picture", url: G(1) });
  assert.ok(lib.ok);
  const mcp = alDef.mcp;
  const set = await mcp.reaction_set(s.al, { type: "redeem", reward: HYD, media: ["Water"], text: "{name} drinks" }, { name: "assistant" });
  assert.deepEqual([set.reward.id, set.ownReaction, set.media.map((m) => m.name)], [HYD, true, ["Water"]]);
  await rx.setReward(s.al, HYD, { title: "Hydrate", cost: 500 }, {});
  const byTitle = await mcp.reaction_get(s.al, { type: "redeem", reward: "hydrate" });
  assert.equal(byTitle.reward.id, HYD);
  const all = await mcp.reaction_get(s.al, { type: "redeem" });
  assert.deepEqual(all.rewardsWithOwnReaction.map((x) => x.id), [HYD]);
  await assert.rejects(mcp.reaction_get(s.al, { type: "follow", reward: HYD }), (e) => e.expose && /redeem/.test(e.message));
  await assert.rejects(mcp.reaction_get(s.al, { type: "redeem", reward: "Nope" }), (e) => e.expose && /Hydrate/.test(e.message));
  assert.ok((await mcp.reaction_test(s.al, { type: "redeem", reward: HYD })).sent);
  assert.equal(s.sent.at(-1).image, G(1));
  if (cp.available(s.al)) {
    const places = await mcp.composition_places(s.al, {});
    const p = places.places.find((x) => x.place === `event:redeem:${HYD}`);
    assert.deepEqual([p.label, p.reward.id, p.files.map((f) => f.src)], ["Hydrate", HYD, [G(1)]]);
    const got = await mcp.composition_get(s.al, { place: "event:redeem", reward: "Hydrate", src: G(1) });
    assert.equal(got.place, `event:redeem:${HYD}`);
  }
  for (const n of ["reaction_get", "reaction_set", "reaction_test", "composition_get", "composition_set"]) assert.ok(alMan.mcp.find((t) => t.name === n).input.properties.reward, n);
  assert.ok(alMan.mcp.filter((t) => !t.readOnly).every((t) => t.default === false), "write tools stay off");
  // Twitch activity's read tool
  const out = await evMod.mcp.twitch_events_rewards(s.ev, {});
  assert.equal(out.readFromTwitch, true);
  assert.deepEqual(out.rewards.map((x) => [x.title, x.ownReaction]), [["Confettis", false], ["Hydrate", true]]);
  assert.equal(out.canCreateFromAdmin, true);
  const tool = evMan.mcp.find((t) => t.name === "twitch_events_rewards");
  assert.deepEqual([tool.readOnly, tool.default], [true, false]);
  assert.ok(evMan.i18n.fr["mcp.twitch_events_rewards"]);
});

test("texts: FR and EN parity, no code words, short labels, glossary words", () => {
  const keys = Object.keys(evEn).filter((k) => k.startsWith("rw_") || k.startsWith("rx_title_"));
  assert.ok(keys.length > 40);
  const vars = (x) => [...String(x).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of keys) {
    assert.ok(evFr[k], k); assert.equal(vars(evFr[k]), vars(evEn[k]), k);
    assert.doesNotMatch(`${evFr[k]} ${evEn[k]}`, /\b(id|ID|API|token|jeton|scope|service|webhook|EventSub|JSON|identifiant)\b/, k);
    assert.doesNotMatch(evFr[k], /!$/, k);
  }
  for (const k of ["rw_add_btn", "rw_new_btn", "rw_f_title", "rw_f_cost", "rw_col_reward", "rw_col_alert", "rw_others", "rw_gone", "rw_forget_btn", "rw_search"]) assert.ok(evFr[k].length <= 60 && !evFr[k].endsWith(":"), k);
  assert.deepEqual(Object.keys(evEn).sort(), Object.keys(evFr).sort());
  assert.deepEqual(Object.keys(botEn).sort(), Object.keys(botFr).sort());
  assert.equal(evFr.rw_gone, "Supprimée sur Twitch"); assert.equal(evFr.rw_others, "Toutes les autres récompenses");
  assert.ok(evMan.tabs.some((t) => t.id === "rewards" && t.label.fr === "Récompenses"));
});
