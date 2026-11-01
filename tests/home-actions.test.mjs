// Le parcours « récompense de points de chaîne → ordre pour la maison », tel qu'Emma (une personne qui n'est pas technicienne) le vit : Bot Twitch 1.4.0 + Connecteur Home Assistant 1.1.0.
// Les VRAIS deux modules sont branchés l'un à l'autre (sujet `home.actions`, service `home-assistant.bridge`, sujets `ha.result` et `ha.state`) ; seuls Twitch et Home Assistant sont des faux.
//   - formulaire : chaque choix de « Que se passe-t-il quand une personne prend cette récompense ? », erreurs sous le champ avec un exemple ;
//   - clé fabriquée à partir du nom : forme, unicité (-2), stabilité quand le nom change, jamais montrée hors mode avancé ;
//   - migration « Autres actions » → actions nommées (rien ne casse, rien n'est perdu, rejouable) ;
//   - sujet `home.actions` (50 au plus, libellé de 60 caractères) et champ additif `catalog` de `pull` ;
//   - « pas encore de script » (ignored/unmapped) visible sur la récompense et dans le journal, points rendus, liste « Actions en attente de liaison » du connecteur ;
//   - liens croisés, renommage « Connecteur Home Assistant », parité FR/EN.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeRewardsApi } from "./helpers/fakeRewards.mjs";
import { FakeHaClient, directTransport } from "./helpers/fakeHaClient.mjs";
import { parseManifest } from "@/core/modules/manifest";

const read = (m, p) => JSON.parse(fs.readFileSync(new URL(`../modules/${m}/${p}`, import.meta.url), "utf8"));
const botManifest = read("twitch-bot", "module.json"), botFr = read("twitch-bot", "locales/fr.json"), botEn = read("twitch-bot", "locales/en.json");
const haManifest = read("home-assistant", "module.json"), haFr = read("home-assistant", "locales/fr.json"), haEn = read("home-assistant", "locales/en.json");
const haDef = (await import("../modules/home-assistant/index.mjs")).default;
const botDef = (await import("../modules/twitch-bot/index.mjs")).default;
const HB = await import("../modules/home-assistant/bridge.mjs");
const HL = await import("../modules/home-assistant/live.mjs");
const HA = await import("../modules/home-assistant/admin.mjs");
const HC = await import("../modules/home-assistant/catalog.mjs");
const es = await import("../modules/twitch-bot/eventsub.mjs");
const S = await import("../modules/twitch-bot/state.mjs");
const SRC = await import("../modules/twitch-bot/sources.mjs");
const R = await import("../modules/twitch-bot/rewards.mjs");
const J = await import("../modules/twitch-bot/redeem.mjs");
const ACT = await import("../modules/twitch-bot/actions.mjs");
const BotAdmin = await import("../modules/twitch-bot/admin.mjs");
const RA = await import("../modules/twitch-bot/rewardsAdmin.mjs");
const botTools = (await import("../modules/twitch-bot/tools.mjs")).default;
const { settingsOf } = await import("../modules/twitch-bot/settings.mjs");

const T0 = Date.parse("2026-10-14T20:00:00Z");
const defaults = Object.fromEntries(haManifest.settings.filter((s) => s.default !== undefined).map((s) => [s.key, s.default]));
const KEY_RE = /^[a-z0-9][a-z0-9:_-]{0,39}$/;

/** Le site d'Emma : le vrai Connecteur Home Assistant et le vrai Bot Twitch, branchés l'un à l'autre. `noHa` : pas de connecteur ; `noBot` : le connecteur sans Bot Twitch. */
function world(o = {}) {
  HB.resetMemory(); HL.resetLive(); S.resetMemory(); SRC.resetSources(); R.resetRewards(); J.resetRedeem(); J.resetSims();
  mock.timers.reset(); mock.timers.enable({ apis: ["Date"], now: T0 });
  const locale = o.locale ?? "fr";
  const ha = fakeCtx({
    key: "ha", moduleId: "home-assistant", name: "Connecteur Home Assistant", basePath: "", locale, defaultLocale: "fr", locales: ["fr", "en"], messages: locale === "en" ? haEn : haFr, settings: defaults,
    permissions: haManifest.permissions, siteUrl: "https://site.example.org",
    topics: { "home.actions": (opts) => (o.noBot ? [] : botDef.exports["home.actions"](bot, opts)) },
    instances: o.noBot ? [] : [{ id: "b1", key: "bot", module: "twitch-bot", basePath: null, name: "Bot Twitch", adminPath: "/admin/instances/b1" }],
    serviceInstances: { "twitch.live": [{ instance: "emma", methods: { status: () => ({ known: true, live: o.live !== false }) } }] },
  });
  ha.can = () => true;
  const svc = haDef.services["home-assistant.bridge"];
  const tw = fakeRewardsApi();
  const acct = { ok: true, channel: "emma", ready: true, https: true, status: "ok", login: "emma", userId: "100", scopes: [...es.SCOPES.own, ...es.REWARD_SCOPES], wanted: [], adminPath: "/admin/instances/tw1" };
  const bot = fakeCtx({
    key: "bot", moduleId: "twitch-bot", locale, defaultLocale: "fr", locales: ["fr", "en"], messages: locale === "en" ? botEn : botFr, siteUrl: "https://site.example.org",
    settings: { onlyWhenLive: true, timezone: "Europe/Paris", ...o.settings },
    instances: o.noHa ? [] : [{ id: "h1", key: "ha", module: "home-assistant", basePath: null, name: "Connecteur Home Assistant", adminPath: "/admin/instances/h1" }],
    topics: { "social.stat": [], "planning.slot": [], "social.link": [], "ha.result": (opts) => haDef.exports["ha.result"](ha, opts), "ha.state": (opts) => haDef.exports["ha.state"](ha, opts) },
    services: o.noHa ? {} : { "home-assistant.bridge": Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](ha, args)])) },
    serviceInstances: {
      "twitch.api": [{ instance: "emma", name: "emma", methods: { account: () => acct, wantScopes: () => ({ ok: true }), connectLink: () => ({ ok: true, url: "https://id.twitch.tv/x" }), disconnect: () => ({ ok: true }), request: (a) => tw.request(a) } }],
      "twitch.live": [{ instance: "emma", name: "emma", methods: { status: () => ({ channel: "emma", configured: true, known: true, live: o.live !== false, title: "T", game: "G", startedAt: new Date(T0 - 3_600_000).toISOString() }) } }],
    },
  });
  bot.can = () => o.can !== false;
  return { ha, bot, tw, svc, tick: (ms) => mock.timers.tick(ms) };
}
const done = () => mock.timers.reset();
async function pairUp(w, bindings = {}) {
  const { code } = await HB.createPairing(w.ha);
  const client = new FakeHaClient({ send: directTransport(haDef, w.ha), bindings });
  assert.equal((await client.pair(code, "Maison")).status, 200);
  await client.pull(); w.tick(1100);
  w.client = client;
  return client;
}
const enable = (w) => BotAdmin.actions.rewardsEnable.run(w.bot, {});
const create = (w, over) => RA.actions.rewardCreate.run(w.bot, { title: "R", cost: "100", cooldownMin: "", prompt: "", ...over });
const rewards = (w) => R.list(w.bot);
const named = (w) => ACT.named(w.bot, settingsOf(w.bot));
const panel = async (w, query = {}) => RA.blocks(w.bot, await BotAdmin.context(w.bot, { declare: false }), query);
const hapanel = (w) => HA.panel(w.ha);
let n = 0;
/** Un échange de points tel que Twitch le donne, réduit par parseRedemption. */
const redemption = (rw, over = {}) => es.parseRedemption({ id: `red-${++n}-aaaa`, broadcaster_user_id: "100", user_login: "viewer", user_name: "Viewer", user_input: "", status: "unfulfilled", reward: { id: rw.tid, title: rw.title, cost: rw.cost }, redeemed_at: new Date(Date.now()).toISOString(), ...over });
/** Le texte VISIBLE d'un lot de blocs : sans les valeurs des champs, les identifiants de lignes ni les adresses (que la personne ne lit pas). */
const visible = (blocks) => JSON.stringify(blocks).replace(/"value":"[^"]*"/g, '"value":""').replace(/"rowIds":\[[^\]]*\]/g, "").replace(/"href":"[^"]*"/g, "");
const fieldsOf = (blocks, action) => blocks.find((b) => b.type === "adminForm" && b.action === action).fields;

/* ───────────── A. Le formulaire ───────────── */

test("formulaire : la question simple, quatre choix lisibles, huit couleurs, un nom pour « Autre chose chez moi » ; aucune clé hors mode avancé", async () => {
  const w = world(); await enable(w);
  await create(w, { title: "Parle", what: "voice" });
  assert.ok((await create(w, { title: "Aspi", what: "custom", actionName: "Lancer l'aspirateur" })).ok);
  const f = fieldsOf(await panel(w), "rewardCreate");
  const what = f.find((x) => x.name === "what");
  assert.equal(what.label, "Que se passe-t-il quand une personne prend cette récompense ?");
  assert.deepEqual(what.options.map((o) => o.label), ["Répondre dans le chat", "Changer la couleur des lumières", "Lire son message à voix haute", "Autre chose chez moi", "Vos actions : Lancer l'aspirateur"]);
  assert.deepEqual(what.options.map((o) => o.value), ["chat", "lights", "voice", "custom", "named:perso:lancer-l-aspirateur"]);
  assert.deepEqual(f.find((x) => x.name === "color").options.map((o) => o.label), ["Rouge", "Vert", "Bleu", "Jaune", "Orange", "Violet", "Rose", "Blanc"]);
  assert.equal(f.find((x) => x.name === "actionName").label, "Donnez un nom à cette action");
  assert.ok(!f.some((x) => x.name === "action" || x.name === "actionKey"), "ni liste de clés brutes, ni champ de clé hors mode avancé");
  assert.ok(!/perso:|lumieres:|tts:lire|chat:repondre|clé d'action|webhook|token|jeton/i.test(visible(await panel(w))), "jamais de clé ni de jargon à l'écran");
  done();
});

test("formulaire : chaque choix crée la bonne action ; la voix impose le message ; un nom d'action neuf est fabriqué et dit quoi faire ensuite", async () => {
  const w = world(); await enable(w);
  assert.ok((await create(w, { title: "Merci", what: "chat", reply: "Merci {utilisateur} !" })).ok);
  assert.ok((await create(w, { title: "Bleu", what: "lights", color: "bleu" })).ok);
  assert.ok((await create(w, { title: "Parle", what: "voice" })).ok);
  const r = await create(w, { title: "Aspi", what: "custom", actionName: "Lancer l'aspirateur" });
  assert.ok(r.ok);
  assert.match(r.ok, /Home Assistant/); assert.match(r.ok, /Curiosa > Configurer/); assert.match(r.ok, /Lancer l'aspirateur/, "le message dit l'étape suivante, avec le NOM de l'action");
  const by = Object.fromEntries((await rewards(w)).map((x) => [x.title, x]));
  assert.deepEqual([by.Merci.action, by.Bleu.action, by.Parle.action, by.Aspi.action], ["chat:repondre", "lumieres:bleu", "tts:lire", "perso:lancer-l-aspirateur"]);
  assert.equal(by.Parle.needsInput, true);
  assert.deepEqual((await named(w)).map((a) => [a.key, a.label]), [["perso:lancer-l-aspirateur", "Lancer l'aspirateur"]]);
  for (const c of ["rouge", "vert", "bleu", "jaune", "orange", "violet", "rose", "blanc"]) {
    const x = await create(w, { title: `C-${c}`, what: "lights", color: c });
    assert.ok(x.ok, c);
  }
  assert.equal((await rewards(w)).filter((x) => x.action.startsWith("lumieres:")).length, 9);
  done();
});

test("formulaire : les erreurs sont sous le bon champ, en mots simples, avec un exemple", async () => {
  const w = world(); await enable(w);
  let r = await create(w, { title: "A", what: "custom", actionName: "" });
  assert.match(r.errors.actionName, /Donnez un nom à cette action\. Exemple : Lancer l'aspirateur/);
  r = await create(w, { title: "A", what: "custom", actionName: "x".repeat(61) });
  assert.match(r.errors.actionName, /60 caractères au plus\. Exemple/);
  r = await create(w, { title: "A", what: "lights", color: "turquoise" });
  assert.match(r.errors.color, /Choisissez une couleur dans la liste\. Exemple : Rouge/);
  r = await create(w, { title: "A", what: "n'importe quoi" });
  assert.match(r.errors.what, /Exemple/);
  r = await create(w, { title: "A", what: "chat", reply: "" });
  assert.ok(r.errors.reply);
  r = await create(w, { title: "A", what: "named:perso:inconnue" });
  assert.ok(r.errors.what);
  assert.equal((await rewards(w)).length, 0);
  assert.deepEqual(await named(w), [], "un essai refusé ne laisse aucune action derrière lui");
  const noHa = world({ noHa: true }); await enable(noHa);
  const x = await create(noHa, { title: "Aspi", what: "custom", actionName: "Lancer l'aspirateur" });
  assert.match(x.errors.what, /Connecteur Home Assistant/);
  assert.deepEqual(await named(noHa), []);
  assert.ok((await create(noHa, { title: "Merci", what: "chat", reply: "Merci !" })).ok, "répondre dans le chat marche sans la maison");
  done();
});

test("une création refusée par Twitch ne laisse pas d'action nommée derrière elle", async () => {
  const w = world(); await enable(w);
  w.tw.state.affiliate = false;
  const r = await create(w, { title: "Aspi", what: "custom", actionName: "Lancer l'aspirateur" });
  assert.ok(r.error && !r.ok);
  assert.deepEqual(await named(w), []);
  done();
});

/* ───────────── La clé fabriquée ───────────── */

test("clé : fabriquée à partir du nom (minuscules sans accents), de la bonne forme, unique avec -2, -3 ; un nom déjà utilisé reprend la même action", async () => {
  assert.equal(ACT.keyFor("Lancer l'aspirateur", new Set()), "perso:lancer-l-aspirateur");
  assert.equal(ACT.keyFor("Ouvrir les volets du séjour !", new Set()), "perso:ouvrir-les-volets-du-sejour");
  assert.equal(ACT.keyFor("Cœur à l'œuvre", new Set()), "perso:coeur-a-l-oeuvre");
  assert.equal(ACT.keyFor("🎉🎉", new Set()), "perso:action", "rien de lisible : une clé neutre");
  assert.equal(ACT.keyFor("Café", new Set(["perso:cafe"])), "perso:cafe-2");
  assert.equal(ACT.keyFor("Café", new Set(["perso:cafe", "perso:cafe-2"])), "perso:cafe-3");
  const long = "Une action au nom vraiment très très long pour voir la coupe de la clé";
  const k1 = ACT.keyFor(long, new Set()), k2 = ACT.keyFor(long, new Set([k1])), k3 = ACT.keyFor(long, new Set([k1, k2]));
  for (const k of [k1, k2, k3]) assert.match(k, KEY_RE);
  assert.ok(k1.length <= 40 && k2.length <= 40 && k3.length <= 40 && new Set([k1, k2, k3]).size === 3 && k2.endsWith("-2") && k3.endsWith("-3"));
  for (const name of ["", "a", "é", "###", "Ça ?", "x".repeat(300), "日本語", "perso:déjà", "  Espaces   multiples  "]) assert.match(ACT.keyFor(name, new Set()), KEY_RE, name);

  const w = world(); await enable(w);
  assert.ok((await create(w, { title: "A1", what: "custom", actionName: "Lancer l'aspirateur" })).ok);
  assert.ok((await create(w, { title: "A2", what: "custom", actionName: "  lancer L’ASPIRATEUR " })).ok, "mêmes mots, autre écriture : la même action");
  assert.ok((await create(w, { title: "A3", what: "custom", actionName: "Lancer l'aspirateur du salon" })).ok);
  assert.deepEqual((await named(w)).map((a) => a.key), ["perso:lancer-l-aspirateur", "perso:lancer-l-aspirateur-du-salon"]);
  assert.deepEqual((await rewards(w)).map((x) => x.action), ["perso:lancer-l-aspirateur", "perso:lancer-l-aspirateur", "perso:lancer-l-aspirateur-du-salon"]);
  // deux noms différents dont les 34 premiers caractères donnent la même clé : -2
  assert.ok((await create(w, { title: "L1", what: "custom", actionName: "Une action au nom vraiment très long pour la coupe A" })).ok);
  assert.ok((await create(w, { title: "L2", what: "custom", actionName: "Une action au nom vraiment très long pour la coupe B" })).ok);
  const keys = (await named(w)).map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of keys) assert.match(k, KEY_RE);
  assert.ok(keys.at(-1).endsWith("-2"));
  done();
});

test("clé : un mot de l'ancien réglage ou une clé déjà prise n'est jamais refabriqué par hasard", async () => {
  const w = world({ settings: { extraActions: "perso:lancer" } }); await enable(w);
  const p = await ACT.plan(w.bot, settingsOf(w.bot), "Lancer", {});
  assert.equal(p.action.key, "perso:lancer-2");
  done();
});

test("clé : stable quand le nom change — la liaison côté maison ne casse pas — et le renommage refuse un nom déjà pris", async () => {
  const w = world(); await enable(w);
  const client = await pairUp(w, { "perso:lancer-l-aspirateur": async () => {} });
  assert.ok((await create(w, { title: "Aspi", what: "custom", actionName: "Lancer l'aspirateur" })).ok);
  assert.ok((await create(w, { title: "Volets", what: "custom", actionName: "Ouvrir les volets" })).ok);
  let r = await RA.actions.actionSave.run(w.bot, { ref: "perso:lancer-l-aspirateur", name: "Aspirer le salon" });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual((await named(w)).map((a) => [a.key, a.label]), [["perso:lancer-l-aspirateur", "Aspirer le salon"], ["perso:ouvrir-les-volets", "Ouvrir les volets"]], "le nom change, la clé jamais");
  assert.equal((await rewards(w))[0].action, "perso:lancer-l-aspirateur");
  r = await RA.actions.actionSave.run(w.bot, { ref: "perso:lancer-l-aspirateur", name: "ouvrir les VOLETS" });
  assert.match(r.errors.name, /porte déjà ce nom/);
  r = await RA.actions.actionSave.run(w.bot, { ref: "perso:lancer-l-aspirateur", name: "" });
  assert.match(r.errors.name, /Exemple/);
  // le nouveau nom arrive à la maison, la liaison existante (par clé) marche toujours
  w.tick(31_000);
  const step = await client.step();
  assert.deepEqual(step.catalog.find((c) => c.key === "perso:lancer-l-aspirateur"), { key: "perso:lancer-l-aspirateur", label: "Aspirer le salon" });
  assert.deepEqual(client.proposals().map((c) => c.key), ["perso:ouvrir-les-volets"], "seule l'action sans script est proposée");
  done();
});

test("« Vos actions » : la liste avec l'état de la maison, renommer, retirer une action qui ne sert plus (jamais une qui sert)", async () => {
  const w = world(); await enable(w);
  await create(w, { title: "Aspi", what: "custom", actionName: "Lancer l'aspirateur" });
  let blocks = await panel(w, {});
  const i = blocks.findIndex((b) => b.type === "heading" && b.text === "Vos actions");
  assert.ok(i > 0);
  const table = blocks[i + 2];
  assert.equal(table.type, "table");
  assert.deepEqual(table.rows[0], ["Lancer l'aspirateur", "Aspi", "Pas encore essayée"]);
  assert.deepEqual(table.rowActions.map((a) => a.label), ["Renommer", "Retirer"]);
  assert.match(table.rowActions[0].href, /actionEdit=\{id\}/);
  blocks = await panel(w, { actionEdit: "perso:lancer-l-aspirateur" });
  assert.ok(blocks.some((b) => b.type === "heading" && /Renommer « Lancer l'aspirateur »/.test(b.text)));
  assert.deepEqual(fieldsOf(blocks, "actionSave").map((f) => f.name), ["ref", "name"], "pas de champ de clé hors mode avancé");
  assert.match((await RA.actions.actionRemove.run(w.bot, { id: "perso:lancer-l-aspirateur" })).error, /encore cette action/);
  await RA.actions.rewardRemove.run(w.bot, { id: (await rewards(w))[0].id });
  assert.ok((await RA.actions.actionRemove.run(w.bot, { id: "perso:lancer-l-aspirateur" })).ok);
  assert.deepEqual(await named(w), []);
  done();
});

/* ───────────── Mode avancé ───────────── */

test("mode avancé : la clé se voit et s'écrit ; hors mode avancé jamais", async () => {
  const w = world({ settings: { showKeys: true } }); await enable(w);
  const f = fieldsOf(await panel(w), "rewardCreate");
  assert.ok(f.find((x) => x.name === "actionKey"), "le champ de clé n'existe qu'en mode avancé");
  assert.ok((await create(w, { title: "Aspi", what: "custom", actionName: "Lancer l'aspirateur", actionKey: "aspirateur:lancer" })).ok);
  assert.deepEqual((await named(w)).map((a) => [a.key, a.label]), [["aspirateur:lancer", "Lancer l'aspirateur"]], "la clé voulue est gardée telle quelle");
  assert.match((await create(w, { title: "B", what: "custom", actionName: "Autre", actionKey: "Pas Bon!" })).errors.actionKey, /Exemple : aspirateur:lancer/);
  assert.match((await create(w, { title: "B", what: "custom", actionName: "Autre", actionKey: "aspirateur:lancer" })).errors.actionKey, /déjà pris/);
  const blocks = await panel(w);
  assert.match(JSON.stringify(blocks), /Lancer l'aspirateur \(aspirateur:lancer\)/, "avec le mode avancé, la clé est entre parenthèses à côté du nom");
  // changer la clé d'une action existante : les récompenses la suivent
  const edit = fieldsOf(await panel(w, { actionEdit: "aspirateur:lancer" }), "actionSave");
  assert.ok(edit.find((x) => x.name === "actionKey"));
  const r = await RA.actions.actionSave.run(w.bot, { ref: "aspirateur:lancer", name: "Lancer l'aspirateur", actionKey: "aspi:go" });
  assert.ok(r.ok);
  assert.equal((await rewards(w))[0].action, "aspi:go");
  assert.deepEqual((await named(w)).map((a) => a.key), ["aspi:go"]);
  done();
});

test("mode avancé : le réglage de clés est avancé, facultatif par défaut, et expliqué en mots simples", () => {
  const s = botManifest.settings.find((x) => x.key === "showKeys");
  assert.deepEqual([s.type, s.default, s.advanced, s.tab], ["boolean", false, true, "rewards"]);
  assert.ok(s.label.fr && s.label.en && s.help.fr && s.help.en);
  assert.ok(botManifest.settings.find((x) => x.key === "extraActions").advanced, "l'ancien réglage reste avancé");
});

/* ───────────── Migration de l'ancien réglage « Autres actions » ───────────── */

test("migration : les mots de l'ancien réglage et les clés déjà portées par des récompenses deviennent des actions nommées ; rien ne casse, rien n'est perdu, rejouable", async () => {
  const w = world({ settings: { extraActions: "scene:cinema, lumieres:orange, cle!, lumieres:turquoise, scene:cinema" } }); await enable(w);
  // avant : des récompenses créées « à l'ancienne » avec une clé de l'ancien réglage ; aucune action nommée
  assert.ok((await create(w, { title: "Cinéma", action: "scene:cinema" })).ok);
  assert.ok((await create(w, { title: "Orange", action: "lumieres:orange" })).ok);
  assert.ok((await create(w, { title: "Turquoise", action: "lumieres:turquoise" })).ok);
  assert.deepEqual(await ACT.list(w.bot), []);
  const before = JSON.stringify((await rewards(w)).map((x) => [x.id, x.title, x.action, x.tid, x.cost]));
  assert.equal(botManifest.dataVersion, 5);
  await botDef.migrations[3](w.bot);
  assert.deepEqual((await ACT.list(w.bot)).map((a) => [a.key, a.label]), [["scene:cinema", "scene:cinema"], ["lumieres:turquoise", "lumieres:turquoise"]], "le mot est le nom ; une action de base ou un mot mal écrit n'en devient pas une");
  assert.equal(JSON.stringify((await rewards(w)).map((x) => [x.id, x.title, x.action, x.tid, x.cost])), before, "aucune récompense ne change");
  await botDef.migrations[3](w.bot);
  assert.equal((await ACT.list(w.bot)).length, 2, "rejouée, elle n'ajoute rien");
  // elles se choisissent dans « Vos actions » et marchent comme avant
  const what = fieldsOf(await panel(w), "rewardCreate").find((f) => f.name === "what").options.map((o) => o.value);
  assert.ok(what.includes("named:scene:cinema") && what.includes("named:lumieres:turquoise"));
  assert.ok((await create(w, { title: "Cinéma 2", what: "named:scene:cinema" })).ok);
  assert.ok((await create(w, { title: "Cinéma 3", action: "scene:cinema" })).ok, "l'ancienne façon (assistant) marche toujours");
  // le réglage supprimé plus tard : les actions déjà converties restent
  const later = world({ settings: {} }); await enable(later);
  await later.bot.api.store.add("homeAction", { key: "scene:cinema", label: "scene:cinema", at: 1 });
  assert.deepEqual((await named(later)).map((a) => a.key), ["scene:cinema"]);
  done();
});

test("migration : une clé portée par une récompense mais absente du réglage est elle aussi gardée ; une instance sans rien à convertir ne fait rien", async () => {
  const w = world(); await enable(w);
  assert.ok((await create(w, { title: "Vieille", action: "chat:repondre", reply: "Salut" })).ok);
  await botDef.migrations[3](w.bot);
  assert.deepEqual(await ACT.list(w.bot), []);
  // une récompense dont la clé n'est plus dans le réglage (réglage modifié depuis)
  const rows = await w.bot.api.store.list("reward", { limit: 5 });
  await w.bot.api.store.update(rows[0].id, { ...rows[0].data, action: "volets:fermer" });
  await botDef.migrations[3](w.bot);
  assert.deepEqual((await ACT.list(w.bot)).map((a) => a.key), ["volets:fermer"]);
  assert.equal((await rewards(w))[0].action, "volets:fermer");
  done();
});

/* ───────────── C. Le sujet `home.actions` et le champ `catalog` ───────────── */

test("sujet `home.actions` : { key, label }, les actions de base seulement si une récompense les utilise, 50 au plus, libellé de 60 caractères, langue du site", async () => {
  const w = world(); await enable(w);
  assert.deepEqual(await botDef.exports["home.actions"](w.bot, {}), [], "rien tant qu'aucune récompense ne demande la maison");
  await create(w, { title: "Merci", what: "chat", reply: "Merci" });
  await create(w, { title: "Rouge", what: "lights", color: "rouge" });
  await create(w, { title: "Aspi", what: "custom", actionName: "Lancer l'aspirateur" });
  assert.deepEqual(await botDef.exports["home.actions"](w.bot, {}), [{ key: "lumieres:rouge", label: "Lumières : rouge" }, { key: "perso:lancer-l-aspirateur", label: "Lancer l'aspirateur" }], "pas l'action du chat, pas les couleurs inutilisées");
  const en = world({ locale: "en" }); await enable(en);
  await create(en, { title: "Red", what: "lights", color: "rouge" });
  assert.deepEqual(await botDef.exports["home.actions"](en.bot, {}), [{ key: "lumieres:rouge", label: "Lights: red" }]);
  // bornes
  const big = world(); await enable(big);
  for (let i = 0; i < 60; i += 1) await big.bot.api.store.add("homeAction", { key: `perso:a${i}`, label: `Action ${i} ` + "é".repeat(80), at: i });
  const items = await botDef.exports["home.actions"](big.bot, {});
  assert.equal(items.length, 50);
  for (const it of items) { assert.match(it.key, KEY_RE); assert.ok([...it.label].length <= 60); assert.deepEqual(Object.keys(it).sort(), ["key", "label"]); }
  assert.ok(!/SEC-RET|token|secret|refresh/i.test(JSON.stringify(items)));
  done();
});

test("manifestes : le Bot Twitch publie `home.actions`, le Connecteur le consomme en option (aucun nouveau besoin dur)", () => {
  assert.ok(parseManifest(botManifest).ok && parseManifest(haManifest).ok);
  assert.deepEqual(botManifest.provides.map((p) => p.topic), ["home.actions"]);
  assert.deepEqual(haManifest.consumes.map((c) => c.topic), ["home.actions"]);
  assert.deepEqual(haManifest.consumes[0].schema.map((x) => x.key), ["key", "label"]);
  assert.deepEqual(haManifest.requires.map((r) => r.optional), [true, true], "le connecteur ne dépend de personne en dur");
  assert.deepEqual(Object.keys(haDef.exports).sort(), ["ha.result", "ha.state"], "le connecteur n'invente aucun sujet de plus : un propriétaire par donnée");
});

test("champ additif `catalog` de pull : les noms donnés par le Bot Twitch, nettoyés, 50 au plus ; un ancien client l'ignore ; le simulateur le lit", async () => {
  const w = world(); await enable(w);
  const client = await pairUp(w);
  let r = await client.pull();
  assert.deepEqual(r.body.catalog, [], "sans action : liste vide, le champ est toujours là");
  await create(w, { title: "Aspi", what: "custom", actionName: "Lancer l'aspirateur" });
  await create(w, { title: "Rouge", what: "lights", color: "rouge" });
  w.tick(31_000);
  r = await client.pull();
  assert.deepEqual(Object.keys(r.body).sort(), ["actions", "catalog", "cursor", "enabled", "live", "pollSeconds", "serverTime"]);
  assert.deepEqual(r.body.catalog, [{ key: "lumieres:rouge", label: "Lumières : rouge" }, { key: "perso:lancer-l-aspirateur", label: "Lancer l'aspirateur" }]);
  assert.ok(r.body.catalog.length <= 50 && r.body.catalog.every((c) => [...c.label].length <= 60 && KEY_RE.test(c.key)));
  // un ancien client ne lit que les champs qu'il connaît : ceux d'avant n'ont pas bougé
  const { actions, cursor, enabled, live, serverTime, pollSeconds } = r.body;
  assert.ok(Array.isArray(actions) && Number.isInteger(cursor) && enabled === true && live === true && serverTime && pollSeconds === 3);
  // le simulateur lit le champ
  w.tick(1100);
  const step = await client.step();
  assert.deepEqual(step.catalog, r.body.catalog);
  assert.deepEqual(client.proposals().map((c) => c.label), ["Lumières : rouge", "Lancer l'aspirateur"], "« Lancer l'aspirateur → [choisir un script] »");
  client.bindings["perso:lancer-l-aspirateur"] = async () => {};
  assert.deepEqual(client.proposals().map((c) => c.key), ["lumieres:rouge"]);
  assert.deepEqual(FakeHaClient.readCatalog({ catalog: [{ key: "ok:1", label: "A" }, { key: "Pas bon", label: "B" }, { key: "ok:2" }, null, { key: "ok:3", label: "x".repeat(61) }] }), [{ key: "ok:1", label: "A" }]);
  assert.deepEqual(FakeHaClient.readCatalog({}), []);
  done();
});

test("catalogue : nettoyé aussi côté connecteur (jamais confiance au texte d'un autre module), 50 au plus, lu au plus toutes les 30 s et en 1,5 s au plus", async () => {
  const w = world(); const t = Date.now();
  const hostile = [
    { key: "perso:a", label: "<b>Bonjour</b> https://exemple.org/x @quelquun " + "é".repeat(100) },
    { key: "Mauvaise Clé!", label: "refusée" }, { key: "perso:a", label: "doublon" }, { key: "perso:vide", label: "" }, null, 5, "x",
    ...Array.from({ length: 80 }, (_, i) => ({ key: `perso:n${i}`, label: `N${i}` })),
  ];
  const items = HC.cleanCatalog(hostile);
  assert.equal(items.length, 50);
  assert.equal(items[0].key, "perso:a");
  assert.ok([...items[0].label].length <= 60 && !/<|https?:|@/.test(items[0].label), items[0].label);
  assert.equal(items.find((i) => i.key === "perso:vide").label, "perso:vide", "sans libellé : la clé, jamais rien");
  let calls = 0;
  const ctx = fakeCtx({ key: "ha2", moduleId: "home-assistant", topics: { "home.actions": () => { calls += 1; return hostile; } } });
  await HC.catalogNow(ctx, t); await HC.catalogNow(ctx, t + 5000); await HC.catalogNow(ctx, t + 29_000);
  assert.equal(calls, 1, "relu au plus toutes les 30 s");
  await HC.catalogNow(ctx, t + 31_000);
  assert.equal(calls, 2);
  // un fournisseur qui plante garde la dernière liste, sans réessayer avant 15 s
  let boom = 0;
  const ctx2 = fakeCtx({ key: "ha3", moduleId: "home-assistant", topics: { "home.actions": () => { boom += 1; throw new Error("panne"); } } });
  assert.deepEqual(await HC.catalogNow(ctx2, t), []);
  await HC.catalogNow(ctx2, t + 3000);
  assert.equal(boom, 1);
  await HC.catalogNow(ctx2, t + 16_000);
  assert.equal(boom, 2);
  // un fournisseur muet ne retient pas l'interrogation plus de 1,5 s
  const ctx3 = fakeCtx({ key: "ha4", moduleId: "home-assistant", topics: { "home.actions": () => new Promise(() => {}) } });
  const t0 = performance.now(), keepAlive = setInterval(() => {}, 100);   // (le minuteur borné du module ne retient pas le processus : ici, quelque chose doit le faire à sa place)
  assert.deepEqual(await HC.catalogNow(ctx3, t), []);
  clearInterval(keepAlive);
  assert.ok(performance.now() - t0 < 2500);
  done();
});

test("sans Bot Twitch : le connecteur marche comme avant (catalogue vide, aucune erreur)", async () => {
  const w = world({ noBot: true });
  const client = await pairUp(w, { "lumieres:rouge": async () => {} });
  const r = await client.pull();
  assert.equal(r.status, 200); assert.deepEqual(r.body.catalog, []);
  done();
});

/* ───────────── D. « Pas encore de script » ───────────── */

const UNMAPPED = "Home Assistant n'a pas encore de script pour cette action. Ouvrez Home Assistant > Curiosa > Configurer pour la relier.";

test("pas encore de script : la récompense le dit (liste et journal), les points sont rendus, le connecteur liste l'action à relier ; une fois reliée, tout rentre dans l'ordre", async () => {
  const w = world(); await enable(w);
  const client = await pairUp(w, {});
  await create(w, { title: "Aspi", what: "custom", actionName: "Lancer l'aspirateur" });
  const rw = (await rewards(w))[0];
  w.tick(31_000);
  // un viewer prend la récompense ; Home Assistant n'a aucun script pour cette action
  const first = await J.processRedemption(w.bot, redemption(rw), { now: Date.now() });
  assert.deepEqual([first.handled, first.result], [true, "waiting"]);
  w.tick(1100);
  const step = await client.step();
  assert.deepEqual(step.acks.map((a) => [a.status, a.code]), [["ignored", "unmapped"]]);
  w.tick(1100);
  await J.reconcile(w.bot, { force: true });
  const e = (await J.journal(w.bot))[0];
  assert.deepEqual([e.status, e.reason], ["refunded", "unmapped"]);
  assert.equal(w.tw.settled.size, 1); assert.equal([...w.tw.settled.values()][0], "CANCELED", "les points sont rendus");
  // la liste des récompenses et le journal le disent en mots simples, avec le NOM de l'action
  let blocks = await panel(w);
  const list = blocks.find((b) => b.type === "table" && b.columns[0] === "Récompense");
  assert.match(list.rows[0][0], /Aspi · 100 points · Lancer l'aspirateur/);
  assert.ok(list.rows[0][1].includes(UNMAPPED), list.rows[0][1]);
  const log = blocks.find((b) => b.type === "table" && b.columns[2] === "Résultat");
  assert.match(log.rows[0][1], /Aspi · Lancer l'aspirateur/);
  assert.ok(log.rows[0][2].includes(UNMAPPED), log.rows[0][2]);
  assert.ok(blocks.some((b) => b.type === "banner" && /Lancer l'aspirateur/.test(b.text) && /Curiosa > Configurer/.test(b.text)), "un bandeau nomme les actions à relier");
  assert.ok(!/perso:/.test(visible(blocks)));
  assert.equal(ACT.linkOf(await S.readState(w.bot), "perso:lancer-l-aspirateur"), "unmapped");
  const acts = blocks.find((b) => b.type === "table" && b.columns[0] === "Action");
  assert.equal(acts.rows[0][2], "À relier dans Home Assistant");
  // le connecteur affiche « Actions en attente de liaison », avec le nom
  const ha = await hapanel(w);
  const i = ha.findIndex((b) => b.type === "heading" && b.text === "Actions en attente de liaison");
  assert.ok(i >= 0);
  assert.deepEqual(ha[i + 2].rows.map((r) => r[0]), ["Lancer l'aspirateur"]);
  assert.ok(ha[i + 2].rows.length <= 20);
  // Emma relie le script dans Home Assistant : le prochain échange marche
  client.bindings["perso:lancer-l-aspirateur"] = async () => {};
  w.tick(61_000);
  await client.pull(); w.tick(1100);   // Home Assistant se montre de nouveau
  const second = await J.processRedemption(w.bot, redemption(rw), { now: Date.now() });
  assert.equal(second.result, "waiting");
  w.tick(1100);
  assert.deepEqual((await client.step()).acks.map((a) => a.status), ["done"]);
  w.tick(1100);
  await J.reconcile(w.bot, { force: true });
  assert.equal((await J.journal(w.bot))[0].status, "done");
  assert.equal(ACT.linkOf(await S.readState(w.bot), "perso:lancer-l-aspirateur"), "ok");
  assert.ok(!(await panel(w)).some((b) => b.type === "banner" && /Curiosa > Configurer/.test(b.text)));
  assert.ok(!(await hapanel(w)).some((b) => b.type === "heading" && b.text === "Actions en attente de liaison"), "plus rien à relier");
  assert.equal((await panel(w)).find((b) => b.type === "table" && b.columns[0] === "Action").rows[0][2], "Reliée à Home Assistant");
  done();
});

test("pas encore de script : aussi pour une action de base, une simulation et le journal en anglais ; les autres refus gardent leur phrase", async () => {
  const w = world({ locale: "en" }); await enable(w);
  await pairUp(w, {});
  await create(w, { title: "Red", what: "lights", color: "rouge" });
  const rw = (await rewards(w))[0];
  const p = J.simulate(w.bot, settingsOf(w.bot), rw.id, { now: Date.now(), waitMs: 3000, pollMs: 20 });
  await new Promise((ok) => setTimeout(ok, 60));
  w.tick(1100);
  await w.client.step();
  const r = await p;
  assert.deepEqual([r.ok, r.status, r.reason], [true, "failed", "unmapped"]);
  assert.match(RA.simResult(w.bot, r).error, /Home Assistant does not have a script for this action yet\. Open Home Assistant > Curiosa > Configure to link it/);
  const blocks = await panel(w);
  assert.match(blocks.find((b) => b.type === "table" && b.columns[0] === "Reward").rows[0][0], /Lights: red/);
  assert.ok(blocks.some((b) => b.type === "banner" && /Lights: red/.test(b.text)));
  done();
});

test("ack ignored/unmapped côté connecteur : 20 actions au plus, la plus récente en tête, retirées quand l'action marche ou quand un autre appareil est associé", async () => {
  const w = world(); const client = await pairUp(w, { "perso:ok": async () => {} });
  w.tick(31_000);
  for (let i = 0; i < 25; i += 1) {
    assert.equal((await w.svc.enqueue(w.ha, { key: `perso:a${i}`, ref: `r${i}`, test: true })).ok, true);
    w.tick(3100);
    await client.step();
  }
  let o = await HA.overview(w.ha);
  assert.equal(o.unmapped.length, 20);
  assert.equal(o.unmapped[0].key, "perso:a24");
  assert.equal(o.unmapped.at(-1).key, "perso:a5");
  await w.svc.enqueue(w.ha, { key: "perso:ok", ref: "ok1", test: true });
  w.tick(3100); await client.step();
  await w.svc.enqueue(w.ha, { key: "perso:a24", ref: "again", test: true });
  w.tick(3100); client.bindings["perso:a24"] = async () => {}; await client.step();
  o = await HA.overview(w.ha);
  assert.ok(!o.unmapped.some((u) => u.key === "perso:a24"), "reliée puis réussie : elle sort de la liste");
  assert.equal(o.unmapped.length, 19);
  await HB.unpair(w.ha, { by: "admin" });
  assert.deepEqual((await HA.overview(w.ha)).unmapped, []);
  done();
});

/* ───────────── E. Liens croisés ───────────── */

test("liens : le Connecteur mène à l'onglet Récompenses du Bot Twitch, le Bot mène à la page du Connecteur ; chacun propose l'installation de l'autre", async () => {
  const w = world(); await enable(w);
  // Bot Twitch -> Connecteur
  let blocks = await panel(w);
  let i = blocks.findIndex((b) => b.type === "links" && b.items[0].label === "Relier à votre maison");
  assert.ok(i > 0, "le lien « Relier à votre maison »");
  assert.equal(blocks[i].items[0].href, "/admin/instances/h1");
  assert.match(blocks[i - 1].text, /Tout couper/, "il dit ce qu'on y trouve : l'association, le coupe-circuit");
  assert.ok(blocks.every((b) => b.tab === "rewards"));
  // Connecteur -> Bot Twitch : « Étape suivante », une fois associé
  await pairUp(w, {});
  let ha = await hapanel(w);
  i = ha.findIndex((b) => b.type === "heading" && b.text === "Étape suivante");
  assert.ok(i >= 0);
  assert.deepEqual(ha[i + 2], { type: "links", items: [{ label: "Créer ou modifier vos récompenses", href: "/admin/instances/b1?tab=rewards" }] });
  // pas de Connecteur : la proposition d'installation existante
  const noHa = world({ noHa: true }); await enable(noHa);
  blocks = await panel(noHa);
  const s = blocks.find((b) => b.type === "suggestInstall");
  assert.equal(s.service, "home-assistant.bridge"); assert.ok(s.reason);
  assert.ok(!blocks.some((b) => b.type === "links" && b.items[0].label === "Relier à votre maison"));
  assert.match(JSON.stringify(blocks), /il faut le Connecteur Home Assistant/);
  // pas de Bot Twitch : une phrase simple et le chemin du Catalogue
  const noBot = world({ noBot: true }); await pairUp(noBot, {});
  ha = await hapanel(noBot);
  i = ha.findIndex((b) => b.type === "heading" && b.text === "Étape suivante");
  assert.match(ha[i + 1].text, /n'est pas installé/);
  assert.deepEqual(ha[i + 3], { type: "links", items: [{ label: "Ouvrir le Catalogue", href: "/admin/catalogue" }] });
  assert.ok(!JSON.stringify(ha).includes("tab=rewards"));
  done();
});

test("liens : seuls des chemins d'administration du site sont utilisés (jamais une adresse venue d'ailleurs)", async () => {
  const w = world(); await enable(w);
  w.bot.api.instances.list = async () => [{ module: "home-assistant", adminPath: "https://mauvais.example/x" }];
  assert.ok(!(await panel(w)).some((b) => b.type === "links" && b.items[0].label === "Relier à votre maison"));
  w.ha.api.instances.list = async () => [{ module: "twitch-bot", adminPath: "//mauvais.example" }];
  assert.ok(!JSON.stringify(await hapanel(w)).includes("mauvais"));
  done();
});

/* ───────────── G. Mise en route ───────────── */

test("mise en route : trois étapes (intégration HACS, code, première récompense avec son bouton) tant que rien n'est associé", async () => {
  const w = world();
  const blocks = await hapanel(w);
  const text = JSON.stringify(blocks);
  assert.match(text, /Mise en route en 3 étapes/);
  assert.match(text, /1\. Installer l'intégration/); assert.ok(text.includes("https://github.com/helldog136/homeassistant-curiosa"));
  assert.match(text, /2\. Associer/); assert.match(text, /3\. Créer une première récompense/);
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "pair"));
  const i = blocks.findIndex((b) => b.type === "markdown" && /3\. Créer une première récompense/.test(b.text));
  assert.deepEqual(blocks[i + 1], { type: "links", items: [{ label: "Créer ou modifier vos récompenses", href: "/admin/instances/b1?tab=rewards" }] });
  assert.ok(!blocks.some((b) => b.type === "heading" && b.text === "Étape suivante"), "une seule porte vers le Bot Twitch à la fois");
  done();
});

/* ───────────── B. Libellés, outils ───────────── */

test("outils MCP : le nom de l'action partout, une action nommée par son nom, jamais de secret", async () => {
  const w = world(); await enable(w);
  const made = await botTools.reward_create(w.bot, { name: "Aspi", costPoints: 100, customActionName: "Lancer l'aspirateur" });
  assert.deepEqual(made, { created: true, name: "Aspi", action: "perso:lancer-l-aspirateur", actionName: "Lancer l'aspirateur" });
  await botTools.reward_create(w.bot, { name: "Aspi 2", costPoints: 100, customActionName: "lancer l'aspirateur" });
  assert.equal((await named(w)).length, 1, "le même nom reprend la même action");
  const list = await botTools.rewards_list(w.bot, {});
  assert.deepEqual(list.rewards.map((r) => [r.name, r.action, r.actionName]), [["Aspi", "perso:lancer-l-aspirateur", "Lancer l'aspirateur"], ["Aspi 2", "perso:lancer-l-aspirateur", "Lancer l'aspirateur"]]);
  assert.ok(list.allowedActions.includes("perso:lancer-l-aspirateur"));
  assert.deepEqual(list.actions.find((a) => a.key === "lumieres:rouge"), { key: "lumieres:rouge", name: "Lumières : rouge" });
  await assert.rejects(botTools.reward_create(w.bot, { name: "X", costPoints: 5, customActionName: "" }), (e) => e.expose && /Donnez un nom/.test(e.message));
  await botTools.reward_update(w.bot, { name: "Aspi 2", customActionName: "Ouvrir les volets" });
  assert.equal((await rewards(w)).find((r) => r.title === "Aspi 2").action, "perso:ouvrir-les-volets");
  const mcp = Object.fromEntries(botManifest.mcp.map((m) => [m.name, m]));
  assert.ok(mcp.reward_create.input.properties.customActionName && mcp.reward_update.input.properties.customActionName);
  assert.ok(!/token|secret|SEC-RET/i.test(JSON.stringify([list, made])));
  done();
});

test("le journal garde le nom de l'action au moment de l'échange ; une action disparue s'appelle « Action inconnue », jamais sa clé", async () => {
  const w = world(); await enable(w);
  await pairUp(w, { "perso:lancer-l-aspirateur": async () => {} });
  await create(w, { title: "Aspi", what: "custom", actionName: "Lancer l'aspirateur" });
  const rw = (await rewards(w))[0];
  w.tick(31_000);
  await J.processRedemption(w.bot, redemption(rw), { now: Date.now() });
  assert.equal((await J.journal(w.bot))[0].an, "Lancer l'aspirateur");
  await RA.actions.rewardRemove.run(w.bot, { id: rw.id });
  await RA.actions.actionRemove.run(w.bot, { id: "perso:lancer-l-aspirateur" });
  const log = (await panel(w)).find((b) => b.type === "table" && b.columns[2] === "Résultat");
  assert.match(log.rows[0][1], /Aspi · Lancer l'aspirateur/, "le nom gardé");
  assert.ok(!/perso:/.test(visible(await panel(w))));
  done();
});

/* ───────────── F. Renommage et textes ───────────── */

test("renommage : « Connecteur Home Assistant » / « Home Assistant connector », identifiant et service inchangés, aucun ancien nom « module Home Assistant » dans les textes", () => {
  assert.deepEqual(haManifest.name, { fr: "Connecteur Home Assistant", en: "Home Assistant connector" });
  assert.equal(haManifest.id, "home-assistant");
  assert.deepEqual(haManifest.offers.map((o) => [o.service, o.version]), [["home-assistant.bridge", 1]]);
  assert.deepEqual(Object.keys(haDef.routes).sort(), ["ack", "pair", "pull"]);
  const root = new URL("../modules/", import.meta.url).pathname;
  const index = JSON.parse(fs.readFileSync(new URL("../catalogue/index.json", import.meta.url), "utf8")).modules.find((m) => m.id === "home-assistant");
  assert.equal(index.name, "Connecteur Home Assistant");
  assert.equal(index.subdir, "modules/home-assistant");
  assert.equal(index.version, haManifest.version);
  assert.match(index.description, /Relie vos points de chaîne à votre maison/);
  // aucun texte (manifeste, textes, README, outils) ne parle encore du « module Home Assistant »
  const OLD = /module Home Assistant|module « Home Assistant »|Home Assistant module|“Home Assistant” module|module « Home Assistant/i;
  const files = [];
  for (const m of fs.readdirSync(root)) for (const f of ["README.md", "module.json", "locales/fr.json", "locales/en.json"]) if (fs.existsSync(`${root}${m}/${f}`)) files.push(`${root}${m}/${f}`);
  for (const f of files) assert.ok(!OLD.test(fs.readFileSync(f, "utf8")), `ancien nom dans ${f}`);
});

test("textes : parité EXACTE FR/EN (mêmes clés, mêmes {variables}), rien de vide, aucun jargon dans le parcours, tous les textes écrits dans le code existent", () => {
  for (const [fr, en, dir] of [[botFr, botEn, "twitch-bot"], [haFr, haEn, "home-assistant"]]) {
    assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort(), dir);
    const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const k of Object.keys(fr)) { assert.ok(fr[k] && en[k], `${dir} ${k}`); assert.equal(vars(fr[k]), vars(en[k]), `${dir} ${k}`); }
    const src = fs.readdirSync(new URL(`../modules/${dir}/`, import.meta.url)).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(new URL(`../modules/${dir}/${f}`, import.meta.url), "utf8")).join("\n");
    for (const m of src.matchAll(/\bt\("([a-z0-9_]+)"/g)) assert.ok(m[1] in fr, `${dir} : texte manquant ${m[1]}`);
  }
  // Emma ne lit jamais ces mots : pas de « clé d'action », de webhook, de token / jeton, ni de clé technique dans les textes du parcours (le mode avancé parle d'« identifiant technique »)
  const journey = /^(rw_w_|rw_f_what|rw_f_color|rw_color_|rw_f_an|rw_acts_|rw_link_|rw_e_what|rw_e_color|rw_e_an_|rw_unmapped|rw_reason_unmapped|rw_house_link|rw_created_link|rw_action_)/;
  for (const [k, text] of Object.entries(botFr)) if (journey.test(k)) assert.ok(!/clé|webhook|token|jeton|payload|endpoint|entité|entity|script d'action/i.test(text), `${k} : ${text}`);
  for (const [k, text] of Object.entries(botEn)) if (journey.test(k)) assert.ok(!/\bkey\b|webhook|token|payload|endpoint|entity/i.test(text), `${k} : ${text}`);
  for (const k of ["wiz_title", "wiz_1", "wiz_2", "wiz_3", "next_title", "next_text", "next_btn", "next_no_bot", "pend_title", "pend_help"]) {
    assert.ok(!/clé|webhook|token|jeton|payload|endpoint|entité/i.test(haFr[k]), `${k}: ${haFr[k]}`);
    assert.ok(!/\bkey\b|webhook|token|payload|endpoint|entity/i.test(haEn[k]), `${k}: ${haEn[k]}`);
  }
  // les textes exacts demandés
  assert.equal(botFr.rw_f_what, "Que se passe-t-il quand une personne prend cette récompense ?");
  assert.equal(botFr.rw_reason_unmapped, UNMAPPED);
  assert.equal(botFr.rw_house_link, "Relier à votre maison");
  assert.equal(haFr.next_btn, "Créer ou modifier vos récompenses");
  assert.equal(haFr.pend_title, "Actions en attente de liaison");
});

test("textes neutres en genre : aucune forme à accorder dans les textes nouveaux (pas de « (e) », pas de « prêt/connecté/seul(e) » pour une personne)", () => {
  const fresh = [...Object.entries(botFr).filter(([k]) => /^(rw_w_|rw_f_what|rw_f_color|rw_f_an|rw_f_key|rw_acts_|rw_link_|rw_e_what|rw_e_color|rw_e_an_|rw_e_key|rw_unmapped|rw_reason_unmapped|rw_house_link|rw_created_link|rw_action_)/.test(k)), ...Object.entries(haFr).filter(([k]) => /^(wiz_|next_|pend_)/.test(k))];
  for (const [k, text] of fresh) assert.ok(!/\(e\)|\(s\)|·e\b|\bseule?\b|\bprête?\b|\bconnectée?\b|\bsûre?\b|\bcontente?\b/i.test(text.replace(/Home Assistant est connecté|la maison est prête|une seule fois/g, "")), `${k} : ${text}`);
});
