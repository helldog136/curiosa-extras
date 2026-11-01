// Bot Twitch 1.3.0 : les récompenses en points de chaîne. Aucun réseau : un faux Twitch (fakeRewards.mjs) et un faux pont (fakeHaBridge.mjs) répondent, les évènements
// de Twitch sont fabriqués avec de vraies signatures. Rien n'est joué par un minuteur : chaque lecture est provoquée par un évènement ou l'ouverture de l'administration.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeRewardsApi } from "./helpers/fakeRewards.mjs";
import { fakeHaBridge } from "./helpers/fakeHaBridge.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/twitch-bot", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json"), fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
const source = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
const def = (await import("../modules/twitch-bot/index.mjs")).default;
const es = await import("../modules/twitch-bot/eventsub.mjs");
const S = await import("../modules/twitch-bot/state.mjs");
const SRC = await import("../modules/twitch-bot/sources.mjs");
const E = await import("../modules/twitch-bot/engine.mjs");
const W = await import("../modules/twitch-bot/webhook.mjs");
const R = await import("../modules/twitch-bot/rewards.mjs");
const J = await import("../modules/twitch-bot/redeem.mjs");
const A = await import("../modules/twitch-bot/admin.mjs");
const tools = (await import("../modules/twitch-bot/tools.mjs")).default;

const NOW = Date.parse("2026-10-14T20:00:00Z");
let clock = NOW;
const tick = (s = 120) => (clock += s * 1000);
const iso = (ms) => new Date(ms).toISOString();

/* ───────────── Le faux monde ───────────── */

function world(o = {}) {
  S.resetMemory(); SRC.resetSources(); R.resetRewards(); J.resetRedeem(); J.resetSims();
  clock = NOW;
  const tw = fakeRewardsApi(o.tw);
  const ha = o.noHa ? null : fakeHaBridge(o.ha);
  const acct = { ok: true, channel: "emma", ready: true, https: true, status: "ok", login: "emma", userId: "100", scopes: [...es.SCOPES.own, ...(o.noRewardScope ? [] : es.REWARD_SCOPES)], wanted: [], adminPath: "/admin/instances/tw1", ...o.account };
  const wants = [];
  const ctx = fakeCtx({
    key: "bot", moduleId: "twitch-bot", locale: o.locale ?? "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: o.locale === "en" ? en : fr, siteUrl: "https://site.example.org",
    settings: { onlyWhenLive: true, timezone: "Europe/Paris", ...o.settings },
    topics: { "social.stat": [], "planning.slot": [], "social.link": [], ...(ha ? ha.topics : { "ha.result": [], "ha.state": [] }) },
    services: ha ? { "home-assistant.bridge": ha.methods } : {},
    serviceInstances: {
      "twitch.api": [{ instance: "emma", name: "emma", methods: {
        account: (a) => (a?.channel && a.channel !== "emma" ? { ok: false, error: "other_channel" } : a?.slot === "bot" ? { ...acct, status: "none", userId: null, scopes: [] } : acct),
        wantScopes: (a) => { wants.push(a); return { ok: true }; },
        connectLink: () => ({ ok: true, url: "https://id.twitch.tv/oauth2/authorize?main=1" }),
        disconnect: () => ({ ok: true }),
        request: (a) => tw.request(a),
      } }],
      "twitch.live": [{ instance: "emma", name: "emma", methods: { status: () => ({ channel: "emma", configured: true, known: true, live: o.offline ? false : true, title: "T", game: "G", startedAt: iso(NOW - 3_600_000) }) } }],
    },
  });
  ctx.can = () => o.can !== false;
  return { ctx, tw, ha, wants, acct };
}
const enable = (ctx) => A.actions.rewardsEnable.run(ctx, {});
const mk = async (w, over = {}) => {
  const r = await A.actions.rewardCreate.run(w.ctx, { title: "Rouge", cost: "500", cooldownMin: "1", prompt: "", action: "lumieres:rouge", ...over });
  assert.ok(r.ok, JSON.stringify(r));
  return (await R.list(w.ctx)).find((x) => x.title === (over.title ?? "Rouge"));
};
const setup = async (o) => { const w = world(o); await enable(w.ctx); return w; };

/* Un évènement signé de Twitch */
let seq = 0;
async function post(w, body, { type = "notification", id, at = clock, secret, ts } = {}) {
  const raw = JSON.stringify(body), mid = id ?? `msg-${++seq}`, stamp = ts ?? iso(at);
  const sec = secret ?? (await S.ensureSecret(w.ctx));
  const headers = new Headers({ "twitch-eventsub-message-id": mid, "twitch-eventsub-message-timestamp": stamp, "twitch-eventsub-message-type": type, "twitch-eventsub-message-signature": es.sign(sec, mid, stamp, raw) });
  const out = await W.handle(new Request("https://site.example.org/m/bot/webhook", { method: "POST", headers, body: raw }), w.ctx, { now: at });
  await out.done;
  return out.response;
}
const redemption = (rw, over = {}) => ({ subscription: { type: es.TYPE_REDEEM }, event: { id: `red-${++seq}-aaaa`, broadcaster_user_id: "100", user_login: "viewer", user_name: "Viewer", user_input: "", status: "unfulfilled", reward: { id: rw.tid, title: rw.title, cost: rw.cost }, redeemed_at: iso(clock), ...over } });
const redeem = async (w, rw, over = {}, opts = {}) => { const b = redemption(rw, over); const res = await post(w, b, opts); return { res, id: b.event.id }; };
const chatMsg = (text, over = {}) => ({ subscription: { type: es.TYPE }, event: { message_id: `cm-${++seq}`, broadcaster_user_id: "100", chatter_user_id: "200", chatter_user_login: "viewer", chatter_user_name: "Viewer", message: { text }, message_type: "text", badges: [], ...over } });
const settled = (w) => w.tw.log.filter((c) => c.path.endsWith("/redemptions")).map((c) => [c.query.id, c.body.status]);
const journal = (w) => J.journal(w.ctx);
const byRid = async (w, id) => (await journal(w)).find((e) => e.rid === id);
const noise = async (w) => post(w, chatMsg("bonjour"));   // un évènement quelconque : c'est lui qui déclenche la lecture suivante

/* ───────────── Manifeste, textes, rien de caché ───────────── */

test("manifeste : valide, versions, onglet ajouté, besoin FACULTATIF du pont, droit, sujets, outils MCP ≤ 64 caractères et écritures non accordées d'office", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.version, "1.6.0");
  assert.equal(manifest.minCore, "0.2.5");
  assert.deepEqual(manifest.requires.find((x) => x.service === "home-assistant.bridge"), { service: "home-assistant.bridge", optional: true });
  assert.ok(manifest.requires.filter((x) => !x.optional).every((x) => x.service.startsWith("twitch.")), "seul Twitch est indispensable");
  assert.deepEqual(manifest.tabs.map((x) => x.id), ["use", "timers", "rewards"]);
  assert.ok(manifest.tabs.length - 1 <= 4);
  assert.deepEqual(manifest.rights.map((x) => x.id), ["rewards.manage", "timers.manage"]);
  assert.deepEqual(manifest.consumes.filter((c) => c.topic.startsWith("ha.")).map((c) => c.topic).sort(), ["ha.result", "ha.state"]);
  const mcp = Object.fromEntries(manifest.mcp.map((m) => [m.name, m]));
  for (const n of ["rewards_list", "reward_create", "reward_update", "reward_simulate"]) { assert.ok(mcp[n], n); assert.ok(n.length <= 64); assert.ok(typeof tools[n] === "function"); }
  assert.equal(mcp.rewards_list.readOnly, true);
  for (const n of ["reward_create", "reward_update", "reward_simulate"]) { assert.ok(!mcp[n].readOnly); assert.equal(mcp[n].default, false); }
  assert.ok(mcp.reward_create.input.properties.name.maxLength <= 64);
  for (const k of ["rewardCreate", "rewardSave", "rewardToggle", "rewardRemove", "rewardsEnable", "rewardSimulate", "rewardLogClear"]) assert.equal(A.actions[k].right, "rewards.manage", k);
});

test("textes : parité exacte FR/EN (clés et {variables}) ; toute clé écrite dans le code existe ; aucun jargon pour Emma", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of Object.keys(fr)) assert.equal(vars(fr[k]), vars(en[k]), k);
  const used = new Set([...source.matchAll(/\bt\("([a-z0-9_]+)"/g)].map((m) => m[1]));
  for (const k of used) assert.ok(k in fr, `clé manquante : ${k}`);
  for (const [k, text] of Object.entries(fr)) if (/^(rw_|kill_|redeem_|act_)/.test(k)) assert.ok(!/webhook|eventsub|token|jeton|payload|endpoint/i.test(text), `${k} : jargon`);
  for (const [k, text] of Object.entries(en)) if (/^(rw_|kill_|redeem_|act_)/.test(k)) assert.ok(!/webhook|eventsub|token|payload|endpoint/i.test(text), `${k} : jargon`);
});

test("aucun minuteur de fond : ni setInterval, ni tâche nouvelle pour les récompenses ; les tâches du bot restent celles d'avant", () => {
  assert.ok(!/setInterval/.test(source));
  assert.deepEqual(Object.keys(def.tasks).sort(), ["listen", "tidy"]);
  assert.ok(!/fetch\(/.test(source.replace(/\/\/.*$/gm, "")), "pas de fetch direct");
});

/* ───────────── Créer, modifier, supprimer chez Twitch ───────────── */

test("activer : note le choix et demande à Twitch l'autorisation de gérer les récompenses SANS retirer celles du chat ; avant, le chat ne demande que les siennes", async () => {
  const w = world();
  const { diagnose } = await import("../modules/twitch-bot/listen.mjs");
  await diagnose(w.ctx, (await import("../modules/twitch-bot/settings.mjs")).settingsOf(w.ctx));
  assert.deepEqual(w.wants.at(-2).scopes.sort(), [...es.SCOPES.own].sort(), "avant d'activer : rien de plus");
  const r = await enable(w.ctx);
  assert.ok(r.ok);
  const main = w.wants.filter((x) => x.slot === "main").at(-1);
  assert.ok(main.scopes.includes("channel:manage:redemptions"));
  for (const s of es.SCOPES.own) assert.ok(main.scopes.includes(s), s);
  assert.equal((await S.readState(w.ctx)).rewardsOn, true);
});

test("créer « Rouge » : la bonne demande part chez Twitch (jeton de la chaîne, échange laissé en attente), la récompense est notée et l'écoute des échanges est créée avec la même route", async () => {
  const w = await setup();
  const rw = await mk(w, { prompt: "Les lumières passent au rouge" });
  const call = w.tw.log.find((c) => c.method === "POST" && c.path === "channel_points/custom_rewards");
  assert.equal(call.as, "user"); assert.equal(call.slot, "main");
  assert.deepEqual(call.body, { title: "Rouge", cost: 500, prompt: "Les lumières passent au rouge", is_enabled: true, is_user_input_required: false, is_global_cooldown_enabled: true, global_cooldown_seconds: 60, should_redemptions_skip_request_queue: false });
  assert.equal(rw.action, "lumieres:rouge"); assert.equal(R.statusOf(rw), "active");
  const sub = w.tw.subs.find((x) => x.type === es.TYPE_REDEEM);
  assert.ok(sub, "abonnement aux échanges");
  assert.equal(sub.transport.callback, "https://site.example.org/m/bot/webhook", "même route que le chat, pas de seconde");
  assert.equal(w.tw.lastSecret, await S.ensureSecret(w.ctx));
  assert.deepEqual(sub.condition, { broadcaster_user_id: "100" });
  assert.equal((await S.readState(w.ctx)).redeemSub.code, "listening");
});

test("erreurs sous le champ, avec un exemple, et RIEN n'est envoyé à Twitch tant que c'est faux", async () => {
  const w = await setup();
  const n = () => w.tw.log.filter((c) => c.path.includes("custom_rewards")).length;
  const bad = async (over) => A.actions.rewardCreate.run(w.ctx, { title: "Ok", cost: "10", action: "chat:repondre", reply: "Merci {utilisateur}", ...over });
  let r = await bad({ title: "" }); assert.match(r.errors.title, /Exemple/);
  r = await bad({ title: "x".repeat(46) }); assert.match(r.errors.title, /45/);
  r = await bad({ cost: "0" }); assert.match(r.errors.cost, /Exemple/);
  r = await bad({ cost: "abc" }); assert.ok(r.errors.cost);
  r = await bad({ cost: "1.5" }); assert.ok(r.errors.cost);
  r = await bad({ cooldownMin: "-3" }); assert.match(r.errors.cooldown, /Exemple/);
  r = await bad({ cooldownMin: "5000" }); assert.ok(r.errors.cooldown);
  r = await bad({ prompt: "p".repeat(201) }); assert.ok(r.errors.prompt);
  r = await bad({ action: "lumieres:fuchsia" }); assert.match(r.errors.action, /Exemple/);
  r = await bad({ action: "Pas Valide!" }); assert.ok(r.errors.action);
  r = await bad({ reply: "" }); assert.match(r.errors.reply, /Exemple/);
  r = await bad({ reply: "Salut {secret}" }); assert.match(r.errors.reply, /\{secret\}/);
  r = await bad({ reply: "/ban tout le monde" }); assert.ok(r.errors.reply);
  assert.equal(n(), 0);
  assert.equal((await R.list(w.ctx)).length, 0);
  // un message qui dit tout : plusieurs champs d'un coup
  r = await bad({ title: "", cost: "0" }); assert.ok(r.errors.title && r.errors.cost);
});

test("titre déjà pris : refusé ici (sans appel) ET, si Twitch le refuse, sous le champ titre", async () => {
  const w = await setup();
  await mk(w);
  let r = await A.actions.rewardCreate.run(w.ctx, { title: "rouge", cost: "10", action: "lumieres:bleu" });
  assert.match(r.errors.title, /déjà/);
  // une récompense du même titre créée ailleurs (invisible pour nous) : c'est Twitch qui refuse
  w.tw.rewards.set("00000000-0000-4000-8000-0000000000aa", { id: "00000000-0000-4000-8000-0000000000aa", title: "Bleu" });
  r = await A.actions.rewardCreate.run(w.ctx, { title: "Bleu", cost: "10", action: "lumieres:bleu" });
  assert.match(r.errors.title, /Twitch/);
  assert.equal((await R.list(w.ctx)).length, 1);
});

test("action de la maison sans Home Assistant : refusée sous le champ Action, avec la marche à suivre ; le bloc « installer » est proposé ; une réponse dans le chat marche quand même", async () => {
  const w = await setup({ noHa: true });
  const r = await A.actions.rewardCreate.run(w.ctx, { title: "Rouge", cost: "10", action: "lumieres:rouge" });
  assert.match(r.errors.action, /Home Assistant/);
  assert.equal((await R.list(w.ctx)).length, 0);
  const ok = await A.actions.rewardCreate.run(w.ctx, { title: "Merci", cost: "10", action: "chat:repondre", reply: "Merci {utilisateur} !" });
  assert.ok(ok.ok);
  const info = await A.context(w.ctx, { declare: false });
  const panel = await (await import("../modules/twitch-bot/rewardsAdmin.mjs")).blocks(w.ctx, info);
  const s = panel.find((b) => b.type === "suggestInstall");
  assert.equal(s.service, "home-assistant.bridge"); assert.ok(s.reason);
  assert.ok(panel.every((b) => b.tab === "rewards"));
  // les actions de maison sont signalées dans la liste de choix
  const form = panel.find((b) => b.type === "adminForm" && b.action === "rewardCreate");
  assert.ok(form.fields.find((f) => f.name === "what").options.some((o) => /Connecteur Home Assistant/.test(o.label)));
});

test("avec Home Assistant installé : pas de bloc « installer » ; la voix impose le message du viewer ; la saisie libre vient des réglages avancés", async () => {
  const w = await setup({ settings: { extraActions: "lumieres:turquoise, cle!, scene:cinema" } });
  const panel = await (await import("../modules/twitch-bot/rewardsAdmin.mjs")).blocks(w.ctx, await A.context(w.ctx, { declare: false }));
  assert.ok(!panel.some((b) => b.type === "suggestInstall"));
  assert.ok(panel.some((b) => b.type === "banner" && /cle!/.test(b.text)), "la clé mal écrite est signalée avec un exemple");
  const opts = panel.find((b) => b.action === "rewardCreate").fields.find((f) => f.name === "what").options.map((o) => o.value);
  assert.ok(opts.includes("named:lumieres:turquoise") && opts.includes("named:scene:cinema") && !opts.some((o) => o.includes("cle!")), "l'ancien réglage continue de marcher : ses mots sont dans « Vos actions »");
  const tts = await mk(w, { title: "Parle", action: "tts:lire", cost: "100" });
  assert.equal(tts.needsInput, true);
  assert.equal(w.tw.log.find((c) => c.body?.title === "Parle").body.is_user_input_required, true);
  const free = await mk(w, { title: "Turquoise", action: "lumieres:turquoise" });
  assert.equal(free.action, "lumieres:turquoise");
  const r = await A.actions.rewardCreate.run(w.ctx, { title: "Autre", cost: "5", action: "inconnu:truc" });
  assert.ok(r.errors.action);
});

test("compte sans points de chaîne : phrase simple (Affilié ou Partenaire), rien de créé, bandeau dans l'onglet ; ça repart tout seul quand Twitch l'accorde", async () => {
  const w = await setup({ tw: { affiliate: false } });
  const r = await A.actions.rewardCreate.run(w.ctx, { title: "Rouge", cost: "10", action: "lumieres:rouge" });
  assert.match(r.error, /Affilié ou Partenaire/);
  assert.equal((await R.list(w.ctx)).length, 0);
  assert.ok((await S.readState(w.ctx)).rewardsNA);
  const RA = await import("../modules/twitch-bot/rewardsAdmin.mjs");
  await mk({ ...w, ctx: w.ctx }, {}).catch(() => {});   // (échoue : affilié faux) — rien d'écrit
  w.tw.state.affiliate = true;
  const ok = await A.actions.rewardCreate.run(w.ctx, { title: "Rouge", cost: "10", action: "lumieres:rouge" });
  assert.ok(ok.ok);
  assert.ok(!(await S.readState(w.ctx)).rewardsNA, "le constat « non disponible » disparaît");
  w.tw.state.affiliate = false;
  await R.sync(w.ctx, (await import("../modules/twitch-bot/settings.mjs")).settingsOf(w.ctx), { force: true });
  const blocks = await RA.blocks(w.ctx, await A.context(w.ctx, { declare: false }));
  assert.ok(blocks.some((b) => b.type === "banner" && /Affilié ou Partenaire/.test(b.text)));
});

test("429, Twitch muet, autorisation retirée : des phrases, jamais d'exception, et rien de noté en trop", async () => {
  let w = await setup({ tw: { rateLimited: true } });
  let r = await A.actions.rewardCreate.run(w.ctx, { title: "Rouge", cost: "10", action: "lumieres:rouge" });
  assert.match(r.error, /attendre/);
  w = await setup({ tw: { down: true } });
  r = await A.actions.rewardCreate.run(w.ctx, { title: "Rouge", cost: "10", action: "lumieres:rouge" });
  assert.match(r.error, /ne répond pas/);
  assert.equal((await R.list(w.ctx)).length, 0);
  w = await setup({ noRewardScope: true });
  r = await A.actions.rewardCreate.run(w.ctx, { title: "Rouge", cost: "10", action: "lumieres:rouge" });
  assert.match(r.error, /autorisation/i);
  assert.equal(w.tw.log.filter((c) => c.path.includes("custom_rewards")).length, 0, "pas d'appel sans l'autorisation");
  const dump = JSON.stringify(await (await import("../modules/twitch-bot/rewardsAdmin.mjs")).blocks(w.ctx, await A.context(w.ctx, { declare: false })));
  assert.match(dump, /Autoriser/);
});

test("au plus 20 récompenses : la 21e est refusée avant tout appel", async () => {
  const w = await setup();
  for (let i = 0; i < R.MAX_REWARDS; i++) await mk(w, { title: `R${i}`, action: "chat:repondre", reply: "ok" });
  const n = w.tw.log.length;
  const r = await A.actions.rewardCreate.run(w.ctx, { title: "R-de-trop", cost: "5", action: "chat:repondre", reply: "ok" });
  assert.match(r.error, /20/);
  assert.equal(w.tw.log.length, n);
});

test("modifier, mettre en pause, reprendre, supprimer : de vraies demandes ; une récompense disparue chez Twitch est marquée telle quelle", async () => {
  const w = await setup();
  const rw = await mk(w);
  let r = await A.actions.rewardSave.run(w.ctx, { id: rw.id, title: "Rouge vif", cost: "900", cooldownMin: "0", action: "lumieres:rouge" });
  assert.ok(r.ok);
  assert.equal(w.tw.rewards.get(rw.tid).title, "Rouge vif"); assert.equal(w.tw.rewards.get(rw.tid).cost, 900);
  assert.equal(w.tw.rewards.get(rw.tid).is_global_cooldown_enabled, false);
  r = await A.actions.rewardToggle.run(w.ctx, { id: rw.id });
  assert.ok(r.ok); assert.equal(w.tw.rewards.get(rw.tid).is_paused, true);
  assert.equal(R.statusOf((await R.list(w.ctx))[0]), "paused");
  r = await A.actions.rewardToggle.run(w.ctx, { id: rw.id });
  assert.equal(w.tw.rewards.get(rw.tid).is_paused, false);
  // pause faite chez Twitch : reconnue à la lecture
  w.tw.rewards.get(rw.tid).is_paused = true;
  await R.sync(w.ctx, (await import("../modules/twitch-bot/settings.mjs")).settingsOf(w.ctx), { force: true });
  assert.equal(R.statusOf((await R.list(w.ctx))[0]), "paused");
  // supprimée chez Twitch
  w.tw.rewards.delete(rw.tid);
  await R.sync(w.ctx, (await import("../modules/twitch-bot/settings.mjs")).settingsOf(w.ctx), { force: true });
  assert.equal(R.statusOf((await R.list(w.ctx))[0]), "gone");
  r = await A.actions.rewardRemove.run(w.ctx, { id: rw.id });
  assert.ok(r.ok); assert.equal((await R.list(w.ctx)).length, 0);
  // suppression d'une récompense vivante
  const b = await mk(w, { title: "Bleu", action: "lumieres:bleu" });
  await A.actions.rewardRemove.run(w.ctx, { id: b.id });
  assert.equal(w.tw.rewards.size, 0);
});

test("la lecture de l'état (sync) est bornée : au plus une demande toutes les 30 s", async () => {
  const w = await setup();
  await mk(w);
  const s = (await import("../modules/twitch-bot/settings.mjs")).settingsOf(w.ctx);
  await R.sync(w.ctx, s, { force: true });
  const gets = () => w.tw.log.filter((c) => c.method === "GET" && c.path === "channel_points/custom_rewards").length;
  const g = gets();
  for (let i = 0; i < 5; i++) await R.sync(w.ctx, s, { now: Date.now() });
  assert.ok(gets() - g <= 1);
});

/* ───────────── Un échange arrive ───────────── */

test("échange : l'action part au pont avec { key, viewer, ref }, l'échange attend ; le résultat « done » valide (FULFILLED) à l'évènement suivant", async () => {
  const w = await setup();
  const rw = await mk(w);
  const { res, id } = await redeem(w, rw);
  assert.equal(res.status, 204);
  const call = w.ha.calls.find((c) => c[0] === "enqueue")[1];
  assert.deepEqual(call, { key: "lumieres:rouge", viewer: "Viewer", ref: id });
  assert.equal((await byRid(w, id)).status, "waiting");
  assert.deepEqual(settled(w), [], "rien n'est validé tant que la maison n'a pas répondu");
  w.ha.resolve(id, "done");
  assert.deepEqual(settled(w), [], "et aucun minuteur ne le fait à notre place");
  tick(); await noise(w);
  assert.deepEqual(settled(w), [[id, "FULFILLED"]]);
  assert.equal((await byRid(w, id)).status, "done");
  assert.equal(w.tw.settled.get(id), "FULFILLED");
});

test("le texte du viewer n'est transmis QUE pour la voix, nettoyé, et n'est jamais gardé ; sans texte la voix est remboursée", async () => {
  const w = await setup();
  const tts = await mk(w, { title: "Parle", action: "tts:lire", cost: "100" });
  const { id } = await redeem(w, tts, { user_input: "  Bonjour\u0000   le   salon  " });
  const call = w.ha.calls.find((c) => c[0] === "enqueue")[1];
  assert.equal(call.key, "tts:lire"); assert.equal(call.text, "Bonjour le salon");
  assert.ok(!JSON.stringify(await journal(w)).includes("Bonjour"), "le message n'est pas dans le journal");
  assert.ok(!JSON.stringify(await w.ctx.api.store.list("redeem", { limit: 50 })).includes("salon"));
  const red = await redeem(w, tts, { user_input: "" });
  assert.equal((await byRid(w, red.id)).reason, "no_text");
  assert.equal(w.tw.settled.get(red.id), "CANCELED");
  const long = await redeem(w, tts, { user_input: "a".repeat(600) });
  assert.equal(w.ha.calls.filter((c) => c[0] === "enqueue").at(-1)[1].text.length, 300);
  const lights = await mk(w, { title: "Bleu", action: "lumieres:bleu" });
  await redeem(w, lights, { user_input: "ne doit pas passer" });
  assert.ok(!("text" in w.ha.calls.filter((c) => c[0] === "enqueue").at(-1)[1]));
});

test("pont qui REFUSE : chaque motif du contrat donne CANCELED (points rendus), le motif est noté ; un motif inconnu est une erreur", async () => {
  const w = await setup();
  const rw = await mk(w);
  const cases = { off: { enabled: false }, offline: { offline: true }, not_live: { live: false }, busy: { busy: true }, not_paired: { paired: false } };
  for (const [reason, st] of Object.entries(cases)) {
    Object.assign(w.ha.state, { enabled: true, live: true, paired: true, offline: false, busy: false }, st);
    tick(); const { id } = await redeem(w, rw);
    assert.equal(w.tw.settled.get(id), "CANCELED", reason);
    const e = await byRid(w, id);
    assert.deepEqual([e.status, e.reason], ["refunded", reason]);
  }
  Object.assign(w.ha.state, { enabled: true, live: true, paired: true, busy: false });
  const tts = await mk(w, { title: "Parle", action: "tts:lire", cost: "9" });
  const b = await redeem(w, tts, { user_input: "un gros-mot ici" });
  assert.equal((await byRid(w, b.id)).reason, "blocked"); assert.equal(w.tw.settled.get(b.id), "CANCELED");
  w.ha.state.knownKeys = ["lumieres:bleu"];
  const u = await redeem(w, rw);
  assert.equal((await byRid(w, u.id)).reason, "unknown_key"); assert.equal(w.tw.settled.get(u.id), "CANCELED");
  w.ha.methods.enqueue = () => ({ ok: false, reason: "quelque chose de neuf" });
  const o = await redeem(w, rw);
  assert.equal((await byRid(w, o.id)).reason, "error"); assert.equal(w.tw.settled.get(o.id), "CANCELED");
  w.ha.methods.enqueue = () => { throw new Error("panne du pont"); };
  const x = await redeem(w, rw);
  assert.equal(w.tw.settled.get(x.id), "CANCELED", "un pont en panne rembourse aussi");
});

test("sans Home Assistant : une récompense de la maison est remboursée (« non installé »), une réponse dans le chat est jouée puis validée", async () => {
  const w = await setup({ noHa: true });
  const chat = await mk(w, { title: "Merci", action: "chat:repondre", reply: "Merci {utilisateur} pour {recompense} !" });
  const a = await redeem(w, chat);
  assert.deepEqual(w.tw.chat, ["Merci Viewer pour Merci !"]);
  assert.equal(w.tw.settled.get(a.id), "FULFILLED");
  // une récompense de la maison créée avant le départ du module
  const w2 = await setup();
  const rw = await mk(w2);
  const w3 = world({ noHa: true }); await enable(w3.ctx);
  const fake = { ...rw, tid: "00000000-0000-4000-8000-0000000000bb" };
  await w3.ctx.api.store.add("reward", { tid: fake.tid, title: "Rouge", cost: 1, cooldown: 0, prompt: "", needsInput: false, action: "lumieres:rouge", reply: "", pause: null, gone: false, refused: null });
  w3.tw.rewards.set(fake.tid, { id: fake.tid, title: "Rouge" });
  const b = await redeem(w3, fake);
  assert.equal((await byRid(w3, b.id)).reason, "not_installed");
  assert.equal(w3.tw.settled.get(b.id), "CANCELED");
});

test("message de remboursement dans le chat : seulement si la propriétaire l'a activé, une fois, en mots simples", async () => {
  let w = await setup({ ha: { enabled: false } });
  let rw = await mk(w);
  await redeem(w, rw);
  assert.deepEqual(w.tw.chat, [], "désactivé par défaut");
  w = await setup({ ha: { enabled: false }, settings: { rewardsNotice: true } });
  rw = await mk(w);
  await redeem(w, rw);
  assert.equal(w.tw.chat.length, 1);
  assert.match(w.tw.chat[0], /Viewer.*Rouge.*points sont rendus/);
  tick(); await noise(w);
  assert.equal(w.tw.chat.length, 1, "pas de répétition");
});

test("résultats de la maison : failed / ignored / expired / refused remboursent ; done valide ; un résultat inconnu est ignoré", async () => {
  const w = await setup({ settings: { rewardWaitSeconds: 600 } });
  const rw = await mk(w);
  const ids = [];
  for (let i = 0; i < 5; i++) { tick(); ids.push((await redeem(w, rw)).id); }
  w.ha.resolve(ids[0], "failed"); w.ha.resolve(ids[1], "ignored"); w.ha.resolve(ids[2], "expired"); w.ha.resolve(ids[3], "refused"); w.ha.resolve(ids[4], "done");
  w.ha.results.push({ ref: "inconnu-0001", id: "x", status: "done", code: "ok" });
  tick(); await noise(w);
  assert.deepEqual(ids.map((i) => w.tw.settled.get(i)), ["CANCELED", "CANCELED", "CANCELED", "CANCELED", "FULFILLED"]);
  assert.deepEqual((await Promise.all(ids.map((i) => byRid(w, i)))).map((e) => e.reason), ["failed", "ignored", "expired", "refused", "ok"]);
  assert.equal(w.tw.settled.size, 5);
});

test("sans résultat après le délai : remboursé à la lecture suivante (évènement OU ouverture de l'administration), pas avant, aucun minuteur", async () => {
  const w = await setup({ settings: { rewardWaitSeconds: 60 } });
  const rw = await mk(w);
  const { id } = await redeem(w, rw);
  tick(30); await noise(w);
  assert.equal(w.tw.settled.size, 0, "30 s : on attend encore");
  tick(120);
  assert.equal(w.tw.settled.size, 0, "le temps seul ne fait rien");
  await noise(w);
  assert.equal(w.tw.settled.get(id), "CANCELED"); assert.equal((await byRid(w, id)).reason, "timeout");
  // par l'administration
  const r2 = await redeem(w, rw);
  const later = Date.now();
  await J.reconcile(w.ctx, { now: clock + 10_000_000, force: true });
  assert.equal(w.tw.settled.get(r2.id), "CANCELED");
  void later;
});

test("ouverture de l'administration : rattrape le retard (résultat reçu, échange trop long) avant d'afficher", async () => {
  const w = await setup();
  const rw = await mk(w);
  const a = await redeem(w, rw);
  w.ha.resolve(a.id, "done");
  const RA = await import("../modules/twitch-bot/rewardsAdmin.mjs");
  await RA.blocks(w.ctx, await A.context(w.ctx, { declare: false }));
  assert.equal(w.tw.settled.get(a.id), "FULFILLED");
});

test("une réponse de Twitch qui échoue : le verdict est renvoyé à la lecture suivante, 5 essais au plus, jamais de boucle", async () => {
  const w = await setup();
  const rw = await mk(w);
  const { id } = await redeem(w, rw);
  w.ha.resolve(id, "done");
  w.tw.state.rateLimited = true;
  for (let i = 0; i < 8; i++) { tick(); await J.reconcile(w.ctx, { now: clock, force: true }); }
  assert.equal((await byRid(w, id)).status, "failed", "abandon après 5 essais");
  const attempts = w.tw.log.filter((c) => c.path.endsWith("/redemptions")).length;
  assert.ok(attempts <= 5, `${attempts} essais`);
  w.tw.state.rateLimited = false;
  const again = await redeem(w, rw);
  w.ha.resolve(again.id, "done");
  tick(); await noise(w);
  assert.equal(w.tw.settled.get(again.id), "FULFILLED");
});

/* ───────────── Sécurité : signature, rejeu, idempotence ───────────── */

test("signature : une requête mal signée, trop ancienne ou sans secret est refusée et ne fait RIEN ; un secret d'ailleurs aussi", async () => {
  const w = await setup();
  const rw = await mk(w);
  const body = redemption(rw);
  assert.equal((await post(w, body, { secret: "pas-le-bon" })).status, 403);
  assert.equal((await post(w, body, { ts: iso(clock - 11 * 60_000), at: clock })).status, 403);
  const raw = JSON.stringify(body);
  const out = await W.handle(new Request("https://x/m/bot/webhook", { method: "POST", headers: { "twitch-eventsub-message-id": "z", "twitch-eventsub-message-timestamp": iso(clock), "twitch-eventsub-message-type": "notification", "twitch-eventsub-message-signature": "sha256=00" }, body: raw }), w.ctx, { now: clock });
  assert.equal(out.response.status, 403);
  assert.equal((await W.handle(new Request("https://x/m/bot/webhook", { method: "GET" }), w.ctx, { now: clock })).response.status, 405);
  assert.deepEqual(w.ha.calls.filter((c) => c[0] === "enqueue"), []);
  assert.equal((await journal(w)).length, 0);
});

test("rejeu : le même message de Twitch renvoyé n'est traité qu'une fois ; le même échange sous un autre message aussi, même après un redémarrage (mémoire vidée)", async () => {
  const w = await setup();
  const rw = await mk(w);
  const body = redemption(rw);
  await post(w, body, { id: "same-message" });
  await post(w, body, { id: "same-message" });
  assert.equal(w.ha.calls.filter((c) => c[0] === "enqueue").length, 1);
  await post(w, body, { id: "autre-message" });
  assert.equal(w.ha.calls.filter((c) => c[0] === "enqueue").length, 1, "un échange = une action");
  S.resetMemory();
  await post(w, body, { id: "encore-un-autre" });
  assert.equal(w.ha.calls.filter((c) => c[0] === "enqueue").length, 1, "même après redémarrage");
  assert.equal((await journal(w)).length, 1);
  // et une rafale simultanée
  const b2 = redemption(rw);
  await Promise.all([1, 2, 3, 4].map((i) => post(w, b2, { id: `rafale-${i}` })));
  assert.equal(w.ha.calls.filter((c) => c[0] === "enqueue").length, 2);
});

test("ce qui n'est pas pour nous est ignoré : récompense d'un autre, échange déjà traité, trop ancien, autre chaîne", async () => {
  const w = await setup();
  const rw = await mk(w);
  await post(w, redemption({ tid: "00000000-0000-4000-8000-00000000dead", title: "Autre", cost: 1 }));
  await post(w, redemption(rw, { status: "fulfilled" }));
  await post(w, redemption(rw, { status: "canceled" }));
  await post(w, redemption(rw, { redeemed_at: iso(clock - 3_600_000) }));
  await post(w, redemption(rw, { broadcaster_user_id: "999" }));
  await post(w, { subscription: { type: es.TYPE_REDEEM }, event: { id: "pas assez" } });
  assert.deepEqual(w.ha.calls.filter((c) => c[0] === "enqueue"), []);
  assert.equal(w.tw.settled.size, 0);
  assert.equal((await journal(w)).length, 0);
});

test("bornes : au plus 100 échanges en attente (le suivant est remboursé), journal de 50 résolus avec purge à la lecture", async () => {
  const w = await setup({ ha: { maxQueue: 1000 } });
  const rw = await mk(w);
  const ids = [];
  for (let i = 0; i < J.MAX_WAITING; i++) ids.push((await redeem(w, rw, {}, { at: clock })).id);
  assert.equal(w.ha.calls.filter((c) => c[0] === "enqueue").length, 100);
  const extra = await redeem(w, rw);
  assert.equal((await byRid(w, extra.id)).reason, "busy");
  assert.equal(w.tw.settled.get(extra.id), "CANCELED");
  assert.equal(w.ha.calls.filter((c) => c[0] === "enqueue").length, 100, "le 101e n'est pas confié à la maison");
  for (const id of ids) w.ha.resolve(id, "done");
  for (let i = 0; i < 8; i++) { tick(); await J.reconcile(w.ctx, { now: clock, force: true }); }   // 20 verdicts au plus par lecture
  const rows = await w.ctx.api.store.list("redeem", { limit: 400 });
  assert.ok(rows.length > J.KEEP_RESOLVED);
  const shown = await journal(w);
  assert.ok(shown.length <= J.KEEP_RESOLVED);
  assert.equal((await w.ctx.api.store.list("redeem", { limit: 400 })).length, J.KEEP_RESOLVED, "purgé à la lecture");
});

/* ───────────── Pause automatique (ha.state) ───────────── */

test("hors direct ou coupe-circuit : les récompenses de la maison sont MISES EN PAUSE (une seule fois) ; les autres non ; reprise quand enabled+live, seulement celles mises en pause par nous", async () => {
  const w = await setup();
  const red = await mk(w), blue = await mk(w, { title: "Bleu", action: "lumieres:bleu" }), say = await mk(w, { title: "Merci", action: "chat:repondre", reply: "ok" });
  const pauses = () => w.tw.log.filter((c) => c.method === "PATCH" && c.body && "is_paused" in c.body);
  await noise(w);
  assert.equal(pauses().length, 0, "maison prête : rien à faire");
  // le propriétaire met « Bleu » en pause à la main
  await A.actions.rewardToggle.run(w.ctx, { id: blue.id });
  const n0 = pauses().length;
  w.ha.state.live = false;
  tick(); await noise(w);
  assert.equal(w.tw.rewards.get(red.tid).is_paused, true);
  assert.equal(w.tw.rewards.get(say.tid).is_paused, false, "une réponse dans le chat n'a pas besoin de la maison");
  assert.equal(pauses().length, n0 + 1, "« Bleu » déjà en pause, « Merci » ignorée");
  tick(); await noise(w); tick(); await noise(w);
  assert.equal(pauses().length, n0 + 1, "pas de répétition");
  assert.equal((await R.list(w.ctx)).find((r) => r.id === red.id).pause, "auto");
  w.ha.state.live = true;
  tick(); await noise(w);
  assert.equal(w.tw.rewards.get(red.tid).is_paused, false, "reprise");
  assert.equal(w.tw.rewards.get(blue.tid).is_paused, true, "celle du propriétaire reste en pause");
  // coupe-circuit
  w.ha.state.enabled = false;
  tick(); await noise(w);
  assert.equal(w.tw.rewards.get(red.tid).is_paused, true);
  w.ha.state.enabled = true;
  tick(); await noise(w);
  assert.equal(w.tw.rewards.get(red.tid).is_paused, false);
  assert.equal(R.statusOf((await R.list(w.ctx)).find((r) => r.id === red.id)), "active");
});

test("une récompense de la maison créée pendant la pause naît en pause ; l'ouverture de l'administration relit aussi l'état ; sans ha.state rien ne bouge", async () => {
  const w = await setup({ ha: { live: false } });
  await noise(w);
  const rw = await mk(w);
  assert.equal(w.tw.rewards.get(rw.tid).is_paused, true);
  assert.equal((await R.list(w.ctx))[0].pause, "auto");
  w.ha.state.live = true;
  await (await import("../modules/twitch-bot/rewardsAdmin.mjs")).blocks(w.ctx, await A.context(w.ctx, { declare: false }));
  assert.equal(w.tw.rewards.get(rw.tid).is_paused, false);
  const w2 = await setup({ noHa: true });
  const chat = await mk(w2, { title: "Merci", action: "chat:repondre", reply: "ok" });
  await noise(w2);
  assert.equal(w2.tw.rewards.get(chat.tid).is_paused, false);
});

test("un refus 'off' au moment de l'échange déclenche tout de suite la lecture de l'état (pause) sans attendre", async () => {
  const w = await setup();
  const rw = await mk(w);
  w.ha.state.enabled = false;
  await redeem(w, rw);
  assert.equal(w.tw.rewards.get(rw.tid).is_paused, true);
});

/* ───────────── !stop / !start ───────────── */

const say = (w, text, over = {}) => E.processChat(w.ctx, { messageId: `k${++seq}`, broadcasterId: "100", chatterId: "200", login: "viewer", name: "Viewer", text, kind: "text", foreign: false, badges: [], ...over }, { now: clock });

test("!stop : la propriétaire et les modérateurs DÉSIGNÉS ; !start : la propriétaire seulement ; réponse brève ; le badge « modérateur » ne suffit pas", async () => {
  const w = await setup({ settings: { stopMods: "@Marie_Mod, paul_mod" } });
  const owner = { chatterId: "100", login: "emma", badges: ["broadcaster"] };
  let r = await say(w, "!stop", { chatterId: "300", login: "random", badges: ["moderator"] });
  assert.equal(r.reason, "role"); assert.deepEqual(w.ha.stops, []); assert.deepEqual(w.tw.chat, [], "aucune réponse à qui n'a pas le droit");
  r = await say(w, "!stop", { chatterId: "301", login: "marie_mod", badges: ["moderator"] });
  assert.equal(r.result, "sent"); assert.deepEqual(w.ha.stops, [["stop", "Viewer"]]);
  assert.equal(w.tw.chat.length, 1); assert.match(w.tw.chat[0], /coupée/);
  r = await say(w, "!start", { chatterId: "301", login: "marie_mod", badges: ["moderator"] });
  assert.equal(r.reason, "role"); assert.equal(w.ha.state.enabled, false, "un modérateur ne rebranche pas");
  r = await say(w, "!start", owner);
  assert.equal(r.result, "sent"); assert.equal(w.ha.state.enabled, true);
  assert.match(w.tw.chat.at(-1), /branchée/);
  r = await say(w, "!stop", owner);
  assert.equal(w.ha.state.enabled, false);
  // ni un faux badge, ni un pseudo qui ressemble
  r = await say(w, "!stop", { chatterId: "400", login: "emma", badges: ["broadcaster"] });
  assert.equal(r.reason, "role", "le badge seul ne suffit pas : c'est le compte de la chaîne qui compte");
  r = await say(w, "!stop", { chatterId: "401", login: "paul_mod2" });
  assert.equal(r.reason, "role");
  assert.equal(w.tw.chat.length, 3 + 0);
});

test("!stop marche hors direct, même bot muet (sans répondre) ; refuse proprement sans Home Assistant ; ne se confond pas avec une commande perso", async () => {
  let w = await setup({ offline: true });
  const owner = { chatterId: "100", login: "emma" };
  let r = await say(w, "!stop", owner);
  assert.equal(r.result, "sent"); assert.equal(w.ha.state.enabled, false, "hors direct aussi");
  await S.setMuted(w.ctx, true);
  const n = w.tw.chat.length;
  r = await say(w, "!start", owner);
  assert.equal(w.ha.state.enabled, true); assert.equal(w.tw.chat.length, n, "muet : il agit sans parler");
  w = await setup({ noHa: true });
  r = await say(w, "!stop", owner);
  assert.equal(r.reason, "not_installed");
  assert.match(w.tw.chat.at(-1), /pas installé/);
  const C = await import("../modules/twitch-bot/commands.mjs");
  const info = await A.context(w.ctx, { declare: false });
  for (const name of ["stop", "start"]) {
    const x = await C.saveCommand(w.ctx, { kind: "custom" }, { name, text: "x", enabled: true }, info.env);
    assert.equal(x.ok, false); assert.equal(x.code, "collision");
  }
  const y = await C.saveCommand(w.ctx, { kind: "custom" }, { name: "autre", aliases: "stop", text: "x", enabled: true }, info.env);
  assert.equal(y.ok, false);
  // chaîne partagée / autre chaîne : rien
  w = await setup();
  r = await say(w, "!stop", { chatterId: "100", login: "emma", broadcasterId: "999" });
  assert.equal(r.handled, false); assert.deepEqual(w.ha.stops, []);
});

/* ───────────── Simulation ───────────── */

test("simulation : même chemin que le vrai (enqueue avec test:true, pseudo Test), AUCUN appel à Twitch, pastille Test dans le journal ; le résultat vient du pont", async () => {
  const w = await setup();
  const rw = await mk(w);
  const before = w.tw.log.length;
  const p = J.simulate(w.ctx, (await import("../modules/twitch-bot/settings.mjs")).settingsOf(w.ctx), rw.id, { now: clock, waitMs: 3000, pollMs: 20 });
  await new Promise((ok) => setTimeout(ok, 60));
  const q = w.ha.queue[0];
  assert.deepEqual([q.key, q.viewer, q.test], ["lumieres:rouge", "Test", true]);
  assert.match(q.ref, /^test-/);
  w.ha.resolve(q.ref, "done");
  const r = await p;
  assert.deepEqual([r.ok, r.mode, r.status], [true, "result", "done"]);
  assert.equal(w.tw.log.length, before, "pas un seul appel à Twitch");
  const e = (await journal(w))[0];
  assert.deepEqual([e.test, e.user, e.status], [true, "Test", "done"]);
  const RA = await import("../modules/twitch-bot/rewardsAdmin.mjs");
  const table = (await RA.blocks(w.ctx, await A.context(w.ctx, { declare: false }))).find((b) => b.type === "table" && b.columns.includes(fr.rw_log_who));
  assert.match(table.rows[0][0], /\[Test\] Test/);
});

test("simulation : refusée si le coupe-circuit est actif (motif expliqué), permise hors direct, texte exigé pour la voix, jamais de remboursement ni de validation", async () => {
  const w = await setup();
  const s = (await import("../modules/twitch-bot/settings.mjs")).settingsOf(w.ctx);
  const rw = await mk(w), tts = await mk(w, { title: "Parle", action: "tts:lire", cost: "9" });
  const sim = (id, text, o = {}) => J.simulate(w.ctx, s, id, { now: (clock += 4000), waitMs: 0, pollMs: 10, text, ...o });
  w.ha.state.enabled = false;
  let r = await sim(rw.id);
  assert.deepEqual([r.ok, r.code, r.reason], [false, "refused", "off"]);
  const RA = await import("../modules/twitch-bot/rewardsAdmin.mjs");
  assert.match(RA.simResult(w.ctx, r).error, /coupée/);
  w.ha.state.enabled = true; w.ha.state.live = false;
  r = await sim(rw.id);
  assert.equal(r.ok, true, "hors direct : accepté par la maison de test");
  w.ha.state.live = true;
  assert.equal((await sim(tts.id, "")).code, "no_text");
  r = await sim(tts.id, "Coucou");
  assert.equal(r.mode, "pending");
  assert.equal(w.ha.queue.at(-1).text, "Coucou");
  assert.equal(w.tw.settled.size, 0);
  // l'échange de test se termine tout seul, sans Twitch
  w.ha.resolve(w.ha.queue.at(-1).ref, "done");
  tick(); await J.reconcile(w.ctx, { now: clock, force: true });
  assert.equal(w.tw.log.filter((c) => c.path.endsWith("/redemptions")).length, 0);
  assert.ok((await journal(w)).every((e) => !e.test || ["done", "failed", "waiting"].includes(e.status)));
});

test("simulation : sans Home Assistant on propose de l'installer ; une réponse dans le chat est seulement montrée", async () => {
  const w = await setup({ noHa: true });
  const s = (await import("../modules/twitch-bot/settings.mjs")).settingsOf(w.ctx);
  const chat = await mk(w, { title: "Merci", action: "chat:repondre", reply: "Merci {utilisateur} !" });
  const r = await J.simulate(w.ctx, s, chat.id, { now: clock });
  assert.deepEqual([r.mode, r.text], ["preview", "Merci Test !"]);
  assert.deepEqual(w.tw.chat, [], "rien n'est envoyé");
  const w2 = await setup();
  const rw = await mk(w2);
  const w3 = world({ noHa: true }); await enable(w3.ctx);
  await w3.ctx.api.store.add("reward", { ...rw, id: undefined, tid: "00000000-0000-4000-8000-0000000000cc" });
  const doc = (await R.list(w3.ctx))[0];
  const x = await J.simulate(w3.ctx, s, doc.id, { now: clock });
  assert.equal(x.code, "not_installed");
  assert.match((await import("../modules/twitch-bot/rewardsAdmin.mjs")).simResult(w3.ctx, x).error, /Home Assistant/);
});

test("simulation : 1 toutes les 3 s, 30 par heure", async () => {
  const w = await setup();
  const s = (await import("../modules/twitch-bot/settings.mjs")).settingsOf(w.ctx);
  const rw = await mk(w);
  const t0 = NOW + 10_000_000;
  assert.equal((await J.simulate(w.ctx, s, rw.id, { now: t0, waitMs: 0 })).ok, true);
  assert.equal((await J.simulate(w.ctx, s, rw.id, { now: t0 + 1000, waitMs: 0 })).code, "too_fast");
  let ok = 1;
  for (let i = 1; i < 40; i++) { const r = await J.simulate(w.ctx, s, rw.id, { now: t0 + i * 3100, waitMs: 0 }); if (r.ok) ok++; else assert.equal(r.code, "too_many"); }
  assert.equal(ok, 30);
  assert.equal((await J.simulate(w.ctx, s, rw.id, { now: t0 + 3_700_000, waitMs: 0 })).ok, true, "une heure plus tard");
});

/* ───────────── MCP ───────────── */

test("MCP : lister, créer, modifier, simuler ; refus clairs ; aucun jeton", async () => {
  const w = await setup();
  const created = await tools.reward_create(w.ctx, { name: "Rouge", costPoints: 500, action: "lumieres:rouge", delaySeconds: 30, helpText: "Ça rougit" });
  assert.deepEqual(created, { created: true, name: "Rouge" });
  assert.equal(w.tw.rewards.size, 1);
  const list = await tools.rewards_list(w.ctx, {});
  assert.deepEqual([list.rewards[0].name, list.rewards[0].costPoints, list.rewards[0].delaySeconds, list.rewards[0].action, list.rewards[0].state], ["Rouge", 500, 30, "lumieres:rouge", "active"]);
  assert.ok(list.allowedActions.includes("tts:lire"));
  await tools.reward_update(w.ctx, { name: "rouge", newName: "Rouge vif", costPoints: 700 });
  assert.equal([...w.tw.rewards.values()][0].title, "Rouge vif");
  await assert.rejects(tools.reward_update(w.ctx, { name: "inconnue", costPoints: 1 }), (e) => e.expose === true);
  await assert.rejects(tools.reward_create(w.ctx, { name: "x".repeat(60), costPoints: 5, action: "lumieres:rouge" }), (e) => e.expose && /45/.test(e.message));
  await assert.rejects(tools.reward_create(w.ctx, { name: "Z", costPoints: 5, action: "pas:permise" }), (e) => e.expose);
  await assert.rejects(tools.reward_create(w.ctx, { name: "Z", costPoints: 0, action: "lumieres:rouge" }), (e) => e.expose);
  const sim = await tools.reward_simulate(w.ctx, { name: "Rouge vif" });
  assert.equal(sim.simulated, true);
  await assert.rejects(tools.reward_simulate(w.ctx, { name: "nope" }), (e) => e.expose);
  assert.ok(!/at_|rt_|SEC-RET|secret/i.test(JSON.stringify([created, list, sim])));
});

/* ───────────── L'écran ───────────── */

test("l'onglet : avant activation une explication et un bouton ; ensuite liste, formulaire, journal ; en anglais aussi ; aucun secret ; droit absent = pas de formulaire", async () => {
  const RA = await import("../modules/twitch-bot/rewardsAdmin.mjs");
  const w = world();
  let blocks = await RA.blocks(w.ctx, await A.context(w.ctx, { declare: false }));
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "rewardsEnable"));
  assert.ok(blocks.every((b) => b.tab === "rewards"));
  await enable(w.ctx);
  const rw = await mk(w);
  await redeem(w, rw);
  for (const locale of ["fr", "en"]) {
    const x = world({ locale }); await enable(x.ctx);
    await mk(x);
    const b = await RA.blocks(x.ctx, await A.context(x.ctx, { declare: false }));
    const types = b.map((y) => y.type);
    for (const t of ["table", "adminForm", "heading"]) assert.ok(types.includes(t), `${locale} ${t}`);
    const dump = JSON.stringify(b);
    assert.ok(!/SEC-RET|access_token|refresh|secret/i.test(dump));
    assert.ok(!/\{[a-z_]+\}/.test(dump.replace(/\{utilisateur\}|\{recompense\}|\{jeu\}|\{titre\}|\{uptime\}|\{followers\}|\{prochain_stream\}|\{id\}/g, "")), `variable non remplacée (${locale})`);
  }
  const ro = world({ can: false }); await enable(ro.ctx);
  const b = await RA.blocks(ro.ctx, await A.context(ro.ctx, { declare: false }));
  assert.ok(!b.some((y) => y.type === "adminForm" && y.action === "rewardCreate"));
  // la page entière : l'onglet ajouté reçoit ses blocs, les commandes gardent les leurs
  const page = await A.panel(w.ctx, { query: {} });
  assert.ok(page.some((y) => !y.tab) && page.some((y) => y.tab === "rewards"));
});

test("la page de modification d'une récompense charge ses valeurs ; la simulation a son bouton sur la page de chaque récompense", async () => {
  const RA = await import("../modules/twitch-bot/rewardsAdmin.mjs");
  const w = await setup();
  const rw = await mk(w, { cooldownMin: "2.5" });
  const b = await RA.blocks(w.ctx, await A.context(w.ctx, { declare: false }), { rewardEdit: rw.id, rewardTest: rw.id });
  const form = b.find((x) => x.type === "adminForm" && x.action === "rewardSave");
  assert.equal(form.fields.find((f) => f.name === "title").value, "Rouge");
  assert.equal(form.fields.find((f) => f.name === "cooldownMin").value, 2.5);
  const t = b.find((x) => x.type === "adminForm" && x.action === "rewardSimulate");
  assert.equal(t.fields.find((f) => f.name === "id").value, rw.id);
  const table = b.find((x) => x.type === "table" && x.rowIds);
  assert.equal(table.rowActions.length, 1, "un seul bouton par ligne : rien ne déborde sur un téléphone");
  assert.equal(table.columns.length, 2);
  const mine = b.filter((x) => x.type === "adminForm" && x.fields.some((f) => f.name === "id" && f.kind === "hidden" && f.value === rw.id)).map((x) => x.action).sort();
  assert.deepEqual(mine, ["rewardSave", "rewardSimulate", "rewardToggle"], "pause, simulation et suppression sur la page de la récompense");
  assert.ok(b.some((x) => x.type === "table" && x.rowActions?.[0]?.action === "rewardRemove"));
});
