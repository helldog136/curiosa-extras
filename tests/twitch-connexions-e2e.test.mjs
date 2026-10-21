// De bout en bout, entre modules, contre le faux Twitch : la mise à jour « Connexions » d'un site qui a DEUX chaînes Twitch.
//   1. le Connecteur Twitch arrive vide (installé par la mise à jour) ; les deux « Ma Chaîne Twitch » migrent (application et connexions reprises, sans ressaisie) ;
//   2. Raid Twitch et Bot Twitch étaient réglés, à la main, sur la DEUXIÈME chaîne (un pseudo tapé) : leur migration note à quelle instance de Ma Chaîne Twitch
//      il correspond, et ils servent bien cette chaîne-là (le Connecteur répond pour la chaîne demandée, pas pour la première qu'il connaît) ;
//   3. une fois le choix confirmé dans l'administration (réglage `choice`, l'id de l'instance), rien ne change.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeTwitch } from "./helpers/fakeTwitch.mjs";
import { connector, connectorModule, connectorCallback } from "./helpers/twitchConnector.mjs";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), "utf8"));
const channelMod = await import("../modules/twitch-channel/index.mjs");
const channelDef = channelMod.default;
const raidDef = (await import("../modules/twitch-raid/index.mjs")).default;
const raidLive = await import("../modules/twitch-raid/live.mjs");
const raidSource = await import("../modules/twitch-raid/source.mjs");
const raidAdmin = await import("../modules/twitch-raid/admin.mjs");
const botDef = (await import("../modules/twitch-bot/index.mjs")).default;
const L = await import("../modules/twitch-bot/listen.mjs");
const botSettings = await import("../modules/twitch-bot/settings.mjs");
const liveStatus = (await import("../modules/live-status/index.mjs")).default;
const twFr = read("../modules/twitch-channel/locales/fr.json");

const OLD = (key) => `https://example.test/m/${key}/oauth/callback`;
const realFetch = globalThis.fetch;
let tw, C;
beforeEach(() => {
  channelMod.resetCache(); connectorModule.resetCache(); raidLive.resetLive(); raidSource.resetSource();
  tw = fakeTwitch({
    redirects: new Set([OLD("tw"), OLD("tw2"), connectorCallback()]),
    users: [{ login: "alice", name: "Alice" }, { login: "machaine", name: "MaChaine" }],
    streams: [{ login: "alice", title: "Chez Alice", viewers: 3 }, { login: "machaine", title: "Ma soirée", viewers: 9 }, { login: "autre", title: "L'autre", viewers: 4 }],
  });
  globalThis.fetch = (u, i) => tw.fetch(u, i);
  C = connector({ settings: {} });   // installé par la mise à jour, AVANT les migrations : vide
});
afterEach(() => { globalThis.fetch = realFetch; });

/** Des jetons valables chez le faux Twitch, comme une connexion faite avec « Chaîne Twitch » 1.x. */
function grant(access, refresh, login, userId, scopes = ["moderator:read:followers"]) {
  const g = { login, userId, scopes, valid: true };
  tw.access.set(access, g); tw.refresh.set(refresh, { ...g });
  return { access, refresh, expiresAt: Date.now() + 3_600_000, scopes, userId, login, connectedAt: "2026-01-01T00:00:00Z", clientId: "cid", status: "ok" };
}
/** Une « Chaîne Twitch » 1.x telle que la trouve sa migration : application dans les réglages masqués, connexion dans son stockage. */
const oldChannel = (key, channel, conn) => fakeCtx({ key, locale: "fr", messages: twFr, settings: { channel }, legacy: { clientId: "cid", clientSecret: "SEC-RET", useCredentialsOf: null }, rows: { twitchConnection: [conn] }, services: { "twitch.api": C.methods } });
const bind = (pctx) => { const svc = channelDef.services["twitch.live"]; return Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](pctx, args)])); };

/** Le site après la migration de ses deux chaînes : { first, second } (contextes des instances de Ma Chaîne Twitch) et les instances de service. */
async function upgradedSite() {
  const first = oldChannel("tw", "machaine", grant("A1", "R1", "machaine", "777"));
  const second = oldChannel("tw2", "autre", grant("A2", "R2", "autre", "888"));
  await channelDef.migrations[2](first);
  await channelDef.migrations[2](second);
  const live = [{ instance: "tw", name: "Ma Chaîne Twitch", module: "twitch-channel", methods: bind(first) }, { instance: "tw2", name: "Ma Chaîne Twitch 2", module: "twitch-channel", methods: bind(second) }];
  return { first, second, live };
}
/** Un consommateur (Raid, Bot, Statut live) : `twitch.api` → le Connecteur ; `twitch.live` → les deux instances de Ma Chaîne Twitch (ids « id-tw », « id-tw2 »). */
const consumer = (site, { key, moduleId, settings = {}, choice, migration = false, messages = {}, book }) => fakeCtx({
  key, moduleId, locale: "fr", settings, messages, migration,
  services: { "twitch.api": C.methods, "twitch.live": site.live[0].methods, ...(book ? { "contact.book": book.methods } : {}) },
  serviceInstances: { "twitch.api": [C.instance], "twitch.live": site.live },
  ...(choice ? { choices: { channel: choice } } : {}),
});

test("mise à jour : le Connecteur reprend l'application et les DEUX connexions ; sans `channel`, il ne répond que pour la première (d'où le réglage des consommateurs)", async () => {
  const site = await upgradedSite();
  assert.equal((await C.methods.status()).ready, true);
  assert.deepEqual((await C.methods.connections()).filter((c) => c.slot === "main").map((c) => c.channel).sort(), ["autre", "machaine"]);
  for (const ctx of [site.first, site.second]) assert.deepEqual(ctx.calls.legacyCleared.sort(), ["clientId", "clientSecret"], "effacé seulement après « ready »");
  assert.equal((await C.methods.account({})).channel, "machaine", "sans `channel` : la première chaîne connue");
  assert.equal((await C.methods.account({ channel: "autre" })).userId, "888");
  assert.deepEqual((await site.live[1].methods.channel()).channel, "autre");
});

test("Raid Twitch réglé sur la DEUXIÈME chaîne (pseudo tapé) : la migration note l'instance ; le dock exclut CETTE chaîne et interroge Twitch par le Connecteur", async () => {
  const site = await upgradedSite();
  // le cœur 0.2.0 : une valeur texte qui n'est l'étiquette d'aucune instance (deux options) → « missing », l'admin demandera de confirmer
  // Raid 2.0 : la liste vient de Contacts (double du contrat), catégorie « Cible de raid »
  const book = fakeContactBook(), cat = book.seedCategory("Cible de raid");
  book.seedContact({ name: "Alice", accounts: [{ network: "twitch", handle: "alice", avatar: "https://static-cdn.jtvnw.net/jtv_user_pictures/alice.png" }], categoryIds: [cat] });
  for (const login of ["machaine", "autre"]) book.seedContact({ name: login, accounts: [{ network: "twitch", handle: login }], categoryIds: [cat] });
  const ctx = consumer(site, { key: "raid", moduleId: "twitch-raid", settings: { channel: "autre" }, choice: { status: "missing" }, migration: true, book });
  await raidDef.migrations[2](ctx);
  assert.deepEqual((await ctx.api.store.list("typedChannel")).map((d) => d.data), [{ from: "autre", login: "autre", id: "id-tw2" }]);
  await raidDef.migrations[2](ctx);
  assert.equal(await ctx.api.store.count("typedChannel"), 1, "rejouée : rien de plus");
  assert.deepEqual(await raidLive.pickChannel(ctx, raidAdmin.settingsOf(ctx).channel), { channel: "autre" });
  const partners = (await raidSource.targets(ctx)).partners;
  assert.deepEqual(partners.map((p) => p.login), ["alice", "machaine", "autre"]);
  const r = await raidLive.liveNow(ctx, partners, raidAdmin.settingsOf(ctx));
  assert.equal(r.state, "ok");
  assert.deepEqual(r.live.map((x) => x.login).sort(), ["alice", "machaine"], "la chaîne servie (« autre ») n'est pas dans son propre dock ; la première chaîne, si");
  assert.ok(tw.log.some((c) => c.path === "/helix/streams"), "GET streams fait par le Connecteur");
  const items = await raidDef.exports["stream.partner"](ctx, {});
  assert.deepEqual(items.find((x) => x.login === "alice"), { id: "alice", login: "alice", title: "Alice", image: "https://static-cdn.jtvnw.net/jtv_user_pictures/alice.png" }, "nom et photo lus dans Contacts (plus de GET users)");
  assert.ok(!tw.log.some((c) => c.path === "/helix/users" && c.search.includes("login=alice")));
  // l'administration ne signale aucun problème de chaîne
  const blocks = await raidDef.adminPanel(ctx, { query: {} });
  assert.ok(!blocks.some((b) => b.type === "banner" && b.tone === "warning"), JSON.stringify(blocks.filter((b) => b.type === "banner")));
});

test("Raid Twitch : choix confirmé dans l'administration (id de la deuxième instance) → même chaîne ; instance supprimée → « channel_unknown », jamais la première en silence", async () => {
  const site = await upgradedSite();
  const chosen = consumer(site, { key: "raid", moduleId: "twitch-raid", settings: { channel: "id-tw2" }, choice: { status: "chosen", id: "id-tw2", label: "Ma Chaîne Twitch 2" } });
  assert.deepEqual(await raidLive.pickChannel(chosen, "id-tw2"), { channel: "autre" });
  const gone = consumer(site, { key: "raid", moduleId: "twitch-raid", settings: { channel: "id-zzz" }, choice: { status: "missing" } });
  assert.deepEqual(await raidLive.pickChannel(gone, "id-zzz"), { problem: "channel_unknown" });
  const empty = consumer(site, { key: "raid", moduleId: "twitch-raid", choice: { status: "ambiguous" } });
  assert.deepEqual(await raidLive.pickChannel(empty, ""), { channel: "machaine" }, "rien de choisi avec deux chaînes : la première prête, comme avant");
});

test("Bot Twitch réglé sur la DEUXIÈME chaîne : migration, autorisations demandées pour CETTE chaîne, EventSub pour son numéro, message envoyé dans SON chat", async () => {
  const site = await upgradedSite();
  const ctx = consumer(site, { key: "bot", moduleId: "twitch-bot", settings: { channel: "autre", replyAs: "own" }, choice: { status: "missing" }, migration: true });
  await botDef.migrations[2](ctx);
  assert.deepEqual((await ctx.api.store.list("typedChannel")).map((d) => d.data), [{ from: "autre", login: "autre", id: "id-tw2" }]);
  const s = botSettings.settingsOf(ctx);
  const before = await L.diagnose(ctx, s);
  assert.deepEqual([before.code, before.channel], ["need_more", "autre"], "la connexion reprise n'a pas encore les droits du chat");
  // l'autorisation passe par l'adresse de retour que cette chaîne avait déjà chez Twitch (relayée par SA Ma Chaîne Twitch)
  const link = (await C.methods.connectLink({ channel: "autre", slot: "main" })).url;
  assert.equal(new URL(link).searchParams.get("redirect_uri"), OLD("tw2"));
  assert.ok(new URL(link).searchParams.get("scope").split(" ").includes("user:write:chat"), "les droits demandés par le Bot pour cette chaîne");
  const back = await channelDef.routes["oauth/callback"](new Request(tw.approve(link, { login: "autre", userId: "888" })), site.second);
  assert.equal(back.status, 303);
  const d = await L.diagnose(ctx, s);
  assert.deepEqual([d.code, d.channel, d.broadcasterId, d.senderId], ["ready", "autre", "888", "888"]);
  assert.equal((await L.ensureListening(ctx, s)).code, "pending");
  assert.equal(tw.subs.length, 1);
  assert.equal(tw.subs[0].condition.broadcaster_user_id, "888");
  tw.subs[0].status = "enabled";
  assert.equal((await L.ensureListening(ctx, s)).code, "listening");
  assert.equal((await L.sendChat(ctx, d, "Bonjour")).sent, true);
  assert.deepEqual(tw.chat.map((m) => [m.broadcaster, m.as, m.message]), [["888", "autre", "Bonjour"]]);
  // la première chaîne n'a rien reçu : ni autorisation en plus, ni message
  assert.ok(!(await C.methods.account({ channel: "machaine" })).scopes.includes("user:write:chat"));
});

test("Bot Twitch : compte bot séparé sur la deuxième chaîne ; choix confirmé (id) → même résultat", async () => {
  const site = await upgradedSite();
  const ctx = consumer(site, { key: "bot", moduleId: "twitch-bot", settings: { channel: "id-tw2", replyAs: "bot" }, choice: { status: "chosen", id: "id-tw2", label: "Ma Chaîne Twitch 2" } });
  const s = botSettings.settingsOf(ctx);
  await L.diagnose(ctx, s);
  const main = (await C.methods.connectLink({ channel: "autre", slot: "main" })).url;
  await channelDef.routes["oauth/callback"](new Request(tw.approve(main, { login: "autre", userId: "888" })), site.second);
  assert.equal((await L.diagnose(ctx, s)).code, "bot_need_connect");
  const bot = (await C.methods.connectLink({ channel: "autre", slot: "bot" })).url;
  await channelDef.routes["oauth/callback"](new Request(tw.approve(bot, { login: "monbot", userId: "555" })), site.second);
  const d = await L.diagnose(ctx, s);
  assert.deepEqual([d.code, d.channel, d.broadcasterId, d.senderId, d.slot], ["ready", "autre", "888", "555", "bot"]);
  assert.equal((await L.sendChat(ctx, d, "Je suis le bot")).sent, true);
  assert.deepEqual(tw.chat.map((m) => [m.broadcaster, m.as]), [["888", "monbot"]]);
});

test("Statut live sur le même site : les deux chaînes sont annoncées, l'administration ne demande rien", async () => {
  const site = await upgradedSite();
  const ctx = consumer(site, { key: "live-status", moduleId: "live-status", messages: { live: "{channel} est en direct", liveMany: "En direct", watch: "Regarder", viewersOne: "{count} spectateur", viewersMany: "{count} spectateurs" } });
  const banner = await liveStatus.slots["layout.banner"](ctx);
  assert.equal(banner[0].type, "html");
  assert.ok(banner[0].html.includes("twitch.tv/machaine") && banner[0].html.includes("twitch.tv/autre"));
  assert.deepEqual(await liveStatus.adminPanel(ctx), []);
});

// ── channel.mjs (le même fichier dans Raid et Bot) : cas limites, sans perte et toujours bornés ─────────────────────────────────────────
const raidChannel = await import("../modules/twitch-raid/channel.mjs");
const HUNG = new Promise(() => {});
/** Un consommateur avec de fausses instances de Ma Chaîne Twitch : `chans` = [{ key, channel, ready, hang }]. */
const fakeSite = (chans, { settings = {}, choice, api = { account: async () => ({ ok: true, channel: null, ready: false }), status: async () => ({ ready: false }) } } = {}) => fakeCtx({
  key: "raid", settings, migration: true,
  services: { "twitch.api": api },
  serviceInstances: { "twitch.live": chans.map((c) => ({ instance: c.key, name: c.key, methods: { channel: () => (c.hang ? HUNG : { channel: c.channel ?? null, ready: c.ready !== false }) } })) },
  ...(choice ? { choices: { channel: choice } } : {}),
});

test("channel.mjs : Raid et Bot portent exactement le même fichier", () => {
  assert.equal(fs.readFileSync(new URL("../modules/twitch-raid/channel.mjs", import.meta.url), "utf8"), fs.readFileSync(new URL("../modules/twitch-bot/channel.mjs", import.meta.url), "utf8"));
});

test("channel.mjs : migration sans correspondance → le pseudo tapé est gardé (id null) et sert encore s'il est connu du Connecteur ; rien n'est jamais effacé", async () => {
  const api = { account: async (a) => ({ ok: true, channel: a?.channel ?? "connue", ready: true }), connections: async () => [{ channel: "connue", slot: "main" }] };
  const ctx = fakeSite([{ key: "tw", channel: "machaine" }], { settings: { channel: "Connue" }, choice: { status: "missing" }, api });
  await raidChannel.rememberTypedChannel(ctx);
  assert.deepEqual((await ctx.api.store.list(raidChannel.TYPED)).map((d) => d.data), [{ from: "Connue", login: "connue", id: null }]);
  assert.deepEqual(await raidChannel.resolveChannel(ctx), { channel: "connue" });
  assert.equal(ctx.calls.cleared.length + ctx.calls.legacyCleared.length, 0);
  // un pseudo inconnu partout, sans note de migration : jamais une autre chaîne en silence
  const lost = fakeSite([{ key: "tw", channel: "machaine" }], { settings: { channel: "inconnue" }, choice: { status: "missing" } });
  assert.deepEqual(await raidChannel.resolveChannel(lost), { problem: "channel_unknown" });
});

test("channel.mjs : migration rejouée après le choix (la valeur est déjà un id d'instance) → rien n'est noté ; valeur illisible → rien", async () => {
  const chosen = fakeSite([{ key: "tw", channel: "machaine" }, { key: "tw2", channel: "autre" }], { settings: { channel: "id-tw2" } });
  await raidChannel.rememberTypedChannel(chosen);
  assert.equal(await chosen.api.store.count(raidChannel.TYPED), 0);
  const junk = fakeSite([{ key: "tw", channel: "machaine" }], { settings: { channel: "pas un pseudo !" } });
  await raidChannel.rememberTypedChannel(junk);
  assert.equal(await junk.api.store.count(raidChannel.TYPED), 0);
});

test("channel.mjs : trou noir (Ma Chaîne Twitch ou le cœur ne répondent jamais) → la migration et la résolution finissent dans leur borne", async () => {
  const saved = { ...raidChannel.timing };
  Object.assign(raidChannel.timing, { choiceMs: 80, callMs: 80, migrationMs: 200 });
  const alive = setInterval(() => {}, 1000);   // les bornes du module ne retiennent pas le processus (unref) : le test, lui, le garde en vie
  try {
    const ctx = fakeSite([{ key: "tw", hang: true }, { key: "tw2", hang: true }], { settings: { channel: "autre" }, choice: () => HUNG });
    const t0 = Date.now();
    await raidChannel.rememberTypedChannel(ctx);
    assert.deepEqual((await ctx.api.store.list(raidChannel.TYPED)).map((d) => d.data), [{ from: "autre", login: "autre", id: null }], "noté quand même, sans instance");
    assert.deepEqual(await raidChannel.resolveChannel(ctx), { channel: "autre" }, "la note de migration suffit");
    const chosen = fakeSite([{ key: "tw", hang: true }], { settings: { channel: "id-tw" }, choice: { status: "chosen", id: "id-tw", label: "tw" } });
    assert.deepEqual(await raidChannel.resolveChannel(chosen), { problem: "slow" }, "l'instance choisie ne répond pas : on le dit, on ne prend pas une autre chaîne");
    const unverified = fakeSite([{ key: "tw", channel: "machaine" }], { settings: { channel: "id-tw" }, choice: () => HUNG });
    assert.deepEqual(await raidChannel.resolveChannel(unverified), { problem: "slow" });
    assert.ok(Date.now() - t0 < 2000);
  } finally { clearInterval(alive); Object.assign(raidChannel.timing, saved); }
});

test("channel.mjs : chaîne choisie sans pseudo → « no_channel » ; rien de connu et Connecteur sans application → « setup » (son lien) ; sans Connecteur → « no_channel »", async () => {
  assert.deepEqual(await raidChannel.resolveChannel(fakeSite([{ key: "tw", channel: null }], { settings: { channel: "id-tw" }, choice: { status: "chosen", id: "id-tw", label: "tw" } })), { problem: "no_channel" });
  const setup = await raidChannel.resolveChannel(fakeSite([], { choice: { status: "none" }, api: { account: async () => ({ ok: true, channel: null, ready: false, adminPath: "/admin/instances/id-twitch-connector" }), status: async () => ({ ready: false }) } }));
  assert.deepEqual([setup.problem, setup.account.adminPath], ["setup", "/admin/instances/id-twitch-connector"]);
  assert.deepEqual(await raidChannel.resolveChannel(fakeSite([], { choice: { status: "none" }, api: { account: async () => ({ ok: true, channel: null, ready: false }), status: async () => ({ ready: true }) } })), { problem: "no_channel" }, "application prête : il manque la chaîne");
  assert.deepEqual(await raidChannel.resolveChannel(fakeCtx({ key: "raid" })), { problem: "no_channel" });
});
