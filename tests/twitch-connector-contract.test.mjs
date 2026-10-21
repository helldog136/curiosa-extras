// Contrat `twitch.api` : le Connecteur Twitch (version 3) reste un SUR-ENSEMBLE de ce que les modules qui s'en servent appellent aujourd'hui.
// On fait tourner le vrai code de ces modules (Bot Twitch, Raid Twitch, Statut live par Ma Chaîne Twitch) contre le VRAI Connecteur, branché sur le faux Twitch.
// Raid 1.3.0 et Bot 1.2.0 demandent `twitch.api` v3 et passent la chaîne voulue (`account({ channel })`) : voir aussi twitch-connexions-e2e.test.mjs (deux chaînes).
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeTwitch } from "./helpers/fakeTwitch.mjs";
import { connector, connectorModule, connectorCallback } from "./helpers/twitchConnector.mjs";

const manifestOf = (id) => JSON.parse(fs.readFileSync(new URL(`../modules/${id}/module.json`, import.meta.url), "utf8"));
const L = await import("../modules/twitch-bot/listen.mjs");
const botSettings = await import("../modules/twitch-bot/settings.mjs");
const raidLive = await import("../modules/twitch-raid/live.mjs");
const raidSource = await import("../modules/twitch-raid/source.mjs");
const channelMod = await import("../modules/twitch-channel/index.mjs");
const liveStatus = (await import("../modules/live-status/index.mjs")).default;
const OWN = connectorCallback("https://site.example.org");
const PIC = "https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png";
const realFetch = globalThis.fetch;
let tw, C;
beforeEach(() => {
  connectorModule.resetCache(); channelMod.resetCache(); raidLive.resetLive(); raidSource.resetSource();
  tw = fakeTwitch({ redirects: new Set([OWN]), users: [{ login: "alice", name: "Alice", picture: PIC }, { login: "bob_x", name: "Bob" }], streams: [{ login: "alice", title: "Chez Alice", game: "Zelda", viewers: 3 }] });
  globalThis.fetch = (u, i) => tw.fetch(u, i);
  C = connector({ siteUrl: "https://site.example.org" });
});
afterEach(() => { globalThis.fetch = realFetch; });

/** Un consommateur : `callAll` et `call` aboutissent au Connecteur (une seule instance, service NON each). */
const consumer = (o = {}) => fakeCtx({ siteUrl: "https://site.example.org", locale: "fr", services: { "twitch.api": C.methods, ...(o.services ?? {}) }, serviceInstances: { "twitch.api": [C.instance], ...(o.serviceInstances ?? {}) }, ...o.ctx });
const approve = async (url, who) => { const r = await C.callback(new Request(tw.approve(url, who))); assert.equal(r.status, 303); };

test("versions : les besoins déclarés (Raid, Bot et Ma Chaîne Twitch : min 3) sont satisfaits par twitch.api v3 ; le service n'est plus « each »", () => {
  const offer = manifestOf("twitch-connector").offers.find((o) => o.service === "twitch.api");
  for (const id of ["twitch-raid", "twitch-bot", "twitch-channel"]) {
    const need = manifestOf(id).requires.find((r) => r.service === "twitch.api");
    assert.ok((need.min ?? 1) <= offer.version, id);
    assert.equal(need.min, 3, `${id} : exige le Connecteur (une application, plusieurs chaînes)`);
  }
  assert.equal(offer.each ?? false, false);
  // aucun autre module du dépôt n'offre twitch.api : pas de mélange each / non-each, pas de maître à choisir
  const others = fs.readdirSync(new URL("../modules", import.meta.url)).filter((d) => d !== "twitch-connector" && fs.existsSync(new URL(`../modules/${d}/module.json`, import.meta.url)));
  for (const d of others) assert.ok(!(manifestOf(d).offers ?? []).some((o) => o.service === "twitch.api"), d);
});

test("Bot Twitch (compte de la chaîne) : account, wantScopes, connectLink, diagnose → ready ; EventSub créé, vérifié, rien en double ; message envoyé", async () => {
  await C.methods.register({ channel: "machaine" });
  const ctx = consumer({ ctx: { key: "bot", moduleId: "twitch-bot", settings: { channel: "machaine", replyAs: "own" } } });
  const s = botSettings.settingsOf(ctx);
  assert.equal((await L.diagnose(ctx, s)).code, "need_connect");
  const link = (await ctx.api.services.callAll("twitch.api", "connectLink", { channel: "machaine", slot: "main" })).find((x) => x.ok && x.value?.ok).value.url;
  assert.deepEqual(new URL(link).searchParams.get("scope").split(" ").sort(), ["channel:bot", "user:bot", "user:read:chat", "user:write:chat"], "les autorisations du bot, déclarées par wantScopes");
  assert.equal(new URL(link).searchParams.get("redirect_uri"), OWN);
  await approve(link);
  const d = await L.diagnose(ctx, s);
  assert.deepEqual([d.code, d.broadcasterId, d.senderId, d.slot], ["ready", "777", "777", "main"]);
  assert.equal((await L.ensureListening(ctx, s)).code, "pending");
  assert.equal((await L.ensureListening(ctx, s)).code, "pending", "pas de doublon tant que Twitch vérifie");
  assert.equal(tw.subs.length, 1);
  assert.equal(tw.subs[0].transport.callback, "https://site.example.org/m/bot/webhook");
  tw.subs[0].status = "enabled";
  assert.equal((await L.ensureListening(ctx, s)).code, "listening");
  const sent = await L.sendChat(ctx, d, "Bonjour le chat");
  assert.equal(sent.sent, true);
  assert.deepEqual(tw.chat.map((m) => [m.message, m.as]), [["Bonjour le chat", "machaine"]]);
  // aucun jeton n'est jamais remonté au Bot
  assert.ok(!JSON.stringify(await ctx.api.services.callAll("twitch.api", "account", {})).match(/at_\d|rt_\d|SEC-RET/));
});

test("Bot Twitch (compte bot séparé) : connexion du compte bot pour la chaîne, message envoyé PAR le bot ; « disconnect » du bot", async () => {
  await C.methods.register({ channel: "machaine" });
  const ctx = consumer({ ctx: { key: "bot", moduleId: "twitch-bot", settings: { channel: "machaine", replyAs: "bot" } } });
  const s = botSettings.settingsOf(ctx);
  await L.diagnose(ctx, s);   // déclare les besoins des deux emplacements
  await approve((await C.methods.connectLink({ channel: "machaine", slot: "main" })).url);
  assert.equal((await L.diagnose(ctx, s)).code, "bot_need_connect");
  await approve((await ctx.api.services.callAll("twitch.api", "connectLink", { channel: "machaine", slot: "bot" }))[0].value.url, { login: "monbot", userId: "555" });
  const d = await L.diagnose(ctx, s);
  assert.deepEqual([d.code, d.senderId, d.slot], ["ready", "555", "bot"]);
  assert.equal((await L.sendChat(ctx, d, "Je suis le bot")).sent, true);
  assert.equal(tw.chat.at(-1).as, "monbot");
  await ctx.api.services.callAll("twitch.api", "disconnect", { channel: "machaine", slot: "bot" });
  assert.equal((await L.diagnose(ctx, s)).code, "bot_need_connect");
  assert.equal((await C.methods.account({ channel: "machaine" })).status, "ok", "la chaîne reste connectée");
});

test("Bot Twitch : Connecteur sans application → « creds_missing » ; ce que le Bot lit dans le résultat d'une connexion ratée", async () => {
  C = connector({ settings: {}, siteUrl: "https://site.example.org" });
  await C.methods.register({ channel: "machaine" });
  const ctx = consumer({ ctx: { key: "bot", moduleId: "twitch-bot", settings: { channel: "machaine", replyAs: "own" } } });
  assert.equal((await L.diagnose(ctx, botSettings.settingsOf(ctx))).code, "creds_missing");
});

test("Raid Twitch : pickChannel (account) puis « qui est en direct » (GET streams, 100 pseudos) par le Connecteur (2.0 : plus de GET users, les photos viennent de Contacts)", async () => {
  await C.methods.register({ channel: "machaine" });
  const ctx = consumer({ ctx: { key: "raid", moduleId: "twitch-raid" } });
  assert.deepEqual(await raidLive.pickChannel(ctx, ""), { channel: "machaine" });
  const partners = [{ login: "alice", name: "", note: "" }, { login: "bob_x", name: "", note: "" }];
  const r = await raidLive.liveNow(ctx, partners, {});
  assert.equal(r.state, "ok");
  assert.deepEqual(r.live.map((x) => x.login), ["alice"]);
  assert.ok(tw.log.some((c) => c.path === "/helix/streams" && c.search.includes("first=100")));
  // Connecteur sans application : le Raid dit quoi faire (pas d'exception)
  connectorModule.resetCache(); raidLive.resetLive();
  C = connector({ settings: {}, siteUrl: "https://site.example.org" });
  await C.methods.register({ channel: "machaine" });
  const p = await raidLive.pickChannel(consumer({ ctx: { key: "raid" } }), "");
  assert.equal(p.problem, "setup");
  assert.equal(p.adminPath, "/admin/instances/id-twitch-connector", "le Raid renvoie vers la page où se règle l'application");
});

test("Statut live (twitch.live de Ma Chaîne Twitch, qui passe par le Connecteur) : la bannière « en direct » s'affiche", async () => {
  tw.state.streams = [{ login: "machaine", title: "Soirée", game: "Zelda", viewers: 3 }];
  const pctx = fakeCtx({ key: "tw", settings: { channel: "machaine" }, services: { "twitch.api": C.methods } });
  const svc = channelMod.default.services["twitch.live"];
  const methods = Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](pctx, args)]));
  const ctx = fakeCtx({ key: "live-status", settings: {}, messages: { live: "{channel} est en direct" }, services: { "twitch.live": methods }, serviceInstances: { "twitch.live": [{ instance: "tw", name: "tw", methods }] } });
  const banner = await liveStatus.slots["layout.banner"](ctx);
  assert.equal(banner[0].href, "https://twitch.tv/machaine");
});
