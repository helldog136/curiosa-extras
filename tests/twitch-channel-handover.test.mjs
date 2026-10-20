// Ma Chaîne Twitch 2.0, migration des données vers la version 2 (handover.mjs) : l'application Twitch (réglages devenus masqués), les connexions
// (chaîne et bot) et les demandes d'autorisations passent au Connecteur Twitch par son service `adopt`, SANS ressaisie ni fuite ; on n'efface
// qu'après la confirmation `ready`. Rejouable, sans perte en cas d'échec, plusieurs instances, conflit d'application, adresse de retour conservée, EventSub.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeTwitch } from "./helpers/fakeTwitch.mjs";
import { connector, connectorModule, connectorCallback } from "./helpers/twitchConnector.mjs";

const DIR = new URL("../modules/twitch-channel", import.meta.url).pathname;
const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
const mod = await import("../modules/twitch-channel/index.mjs");
const def = mod.default;
const migrate = (ctx) => def.migrations[2](ctx);
const OLD = (key = "tw") => `https://example.test/m/${key}/oauth/callback`;
const OWN = connectorCallback();
const realFetch = globalThis.fetch;
const spies = {};
const heard = [];
let tw, C;
beforeEach(() => {
  mod.resetCache(); connectorModule.resetCache();
  tw = fakeTwitch({ redirects: new Set([OLD(), OLD("tw2"), OWN]) });
  globalThis.fetch = (u, i) => tw.fetch(u, i);
  C = connector({ settings: {} });   // le Connecteur vient d'être installé par la mise à jour (requires satisfaits AVANT les migrations) : il est vide
  heard.length = 0;
  for (const m of ["log", "info", "warn", "error", "debug"]) { spies[m] = console[m]; console[m] = (...a) => heard.push(a.map(String).join(" ")); }
});
afterEach(() => { globalThis.fetch = realFetch; for (const m of Object.keys(spies)) console[m] = spies[m]; });

/** Des jetons valables chez le faux Twitch, comme une connexion faite avec « Chaîne Twitch » 1.7. */
function grant(access, refresh, who = {}) {
  const g = { login: who.login ?? "machaine", userId: who.userId ?? "777", scopes: who.scopes ?? ["moderator:read:followers"], valid: true };
  tw.access.set(access, g); tw.refresh.set(refresh, { ...g });
  return { access, refresh, expiresAt: Date.now() + 3_600_000, scopes: g.scopes, userId: g.userId, login: g.login, connectedAt: "2026-01-01T00:00:00Z", clientId: "cid", status: "ok" };
}
/** Une instance « Chaîne Twitch » 1.7 telle que la trouve la migration : réglages masqués (legacy) et documents de son stockage. */
function oldInstance({ key = "tw", channel = "machaine", legacy = { clientId: "cid", clientSecret: "SEC-RET", useCredentialsOf: null }, rows = {}, services = true } = {}) {
  return fakeCtx({ key, locale: "fr", messages: fr, settings: { channel, trackStats: true }, legacy, rows, ...(services ? { services: { "twitch.api": C.methods } } : {}) });
}
const withConnections = () => ({
  twitchConnection: [grant("OLD-ACCESS-1", "OLD-REFRESH-1")],
  twitchBotConnection: [grant("BOT-ACCESS-1", "BOT-REFRESH-1", { login: "monbot", userId: "555", scopes: ["user:write:chat", "user:bot"] })],
  twitchWants: [{ consumer: "twitch-bot", slot: "bot", scopes: ["user:write:chat", "user:bot"], returnTo: "/admin/instances/bot1" }],
  twitchResult: [{ code: "denied", slot: "main", at: "2026-01-01T00:00:00Z" }],
});
const SECRETS = ["SEC-RET", "OLD-ACCESS-1", "OLD-REFRESH-1", "BOT-ACCESS-1", "BOT-REFRESH-1"];
const followers = () => C.methods.request({ as: "user", channel: "machaine", method: "GET", path: "channels/followers", query: { broadcaster_id: ["777"], first: ["1"] } });

test("migration : application, connexions (chaîne et bot) et demandes confiées au Connecteur SANS ressaisie ; effacé ici seulement après « ready »", async () => {
  const ctx = oldInstance({ rows: withConnections() });
  assert.equal(await migrate(ctx), undefined, "une migration ne rend rien");
  // le Connecteur a tout
  assert.equal((await C.methods.status()).ready, true);
  assert.deepEqual((await C.methods.connections()).map((c) => [c.slot, c.channel, c.login]).sort(), [["bot", "machaine", "monbot"], ["main", "machaine", "machaine"]]);
  assert.deepEqual((await C.methods.account({ channel: "machaine", slot: "bot" })).wanted, ["user:bot", "user:write:chat"]);
  assert.equal((await followers()).json.total, 1234, "la connexion reprise sert tout de suite, sans reconnecter");
  // ici, plus rien
  assert.deepEqual(ctx.calls.legacyCleared.sort(), ["clientId", "clientSecret"], "les valeurs remplies sont effacées (une valeur vide est effacée par le cœur au démarrage)");
  for (const col of ["twitchConnection", "twitchBotConnection", "twitchWants", "twitchResult", "twitchPending", "borrowed"]) assert.equal(await ctx.api.store.count(col), 0, col);
  assert.deepEqual((await ctx.api.store.list("handover"))[0].data.state, "done");
});

test("l'ancienne adresse de retour reste valable : les liens de cette chaîne la gardent, et le retour relayé aboutit", async () => {
  const ctx = oldInstance({ rows: withConnections() });
  await migrate(ctx);
  await C.methods.wantScopes({ channel: "machaine", consumer: "x1", slot: "main", scopes: ["channel:read:subscriptions"] });
  const link = (await C.methods.connectLink({ channel: "machaine", slot: "main", returnTo: "/admin/instances/id-tw" })).url;
  assert.equal(new URL(link).searchParams.get("redirect_uri"), OLD());
  const res = await def.routes["oauth/callback"](new Request(tw.approve(link)), ctx);
  assert.equal(res.status, 303);
  assert.equal((await C.methods.account({ channel: "machaine" })).status, "ok");
  assert.ok((await C.methods.account({ channel: "machaine" })).scopes.includes("channel:read:subscriptions"));
  // la page du Connecteur liste cette adresse : à laisser chez Twitch
  assert.ok(JSON.stringify(await connectorModule.default.adminPanel(C.ctx)).includes(OLD()));
});

test("migration rejouée deux fois (idempotente) : rien de plus n'est écrit ni effacé, aucun appel en plus", async () => {
  const ctx = oldInstance({ rows: withConnections() });
  await migrate(ctx);
  const snap = JSON.stringify([C.ctx.dumpStore(), ctx.dumpStore(), ctx.calls.legacyCleared]);
  const n = tw.log.length;
  await migrate(ctx);
  await migrate(ctx);
  assert.equal(JSON.stringify([C.ctx.dumpStore(), ctx.dumpStore(), ctx.calls.legacyCleared]), snap);
  assert.equal(tw.log.length, n);
  // même si la marque « fait » disparaissait (restauration partielle), un nouveau passage ne double rien
  for (const d of await ctx.api.store.list("handover")) await ctx.api.store.remove(d.id);
  await migrate(ctx);
  assert.equal(await C.ctx.api.store.count("twitchConnections"), 2);
  assert.equal(await C.ctx.api.store.count("twitchApp"), 1);
});

test("échec de la reprise → RIEN n'est effacé : Connecteur absent, Connecteur en panne, application incomplète ; la reprise réussit plus tard (ouverture de l'administration)", async () => {
  // 1. Connecteur absent
  const a = oldInstance({ rows: withConnections(), services: false });
  await migrate(a);
  assert.deepEqual(a.calls.legacyCleared, []);
  assert.equal(await a.api.store.count("twitchConnection"), 1);
  assert.deepEqual([(await a.api.store.list("handover"))[0].data.state, (await a.api.store.list("handover"))[0].data.reason], ["pending", "connector"]);
  // 2. Connecteur qui échoue
  const b = oldInstance({ rows: withConnections() });
  b.api.services.call = async () => ({ ok: false, reason: "failed" });
  await migrate(b);
  assert.deepEqual(b.calls.legacyCleared, []);
  assert.equal(await b.api.store.count("twitchBotConnection"), 1);
  // 3. application incomplète (secret vide) : pas « ready »
  const c = oldInstance({ legacy: { clientId: "cid", clientSecret: "", useCredentialsOf: null }, rows: withConnections() });
  await migrate(c);
  assert.deepEqual(c.calls.legacyCleared, []);
  assert.equal(await c.api.store.count("twitchConnection"), 1);
  assert.equal((await c.api.store.list("handover"))[0].data.reason, "incomplete");
  assert.ok((await def.adminPanel(c)).some((x) => x.type === "banner" && x.text === fr.handover_incomplete));
  // plus tard, l'application est complétée dans le Connecteur : l'ouverture de l'administration termine la reprise
  await C.methods.adopt({ clientId: "cid", clientSecret: "SEC-RET" });
  mod.resetCache();
  await def.adminPanel(c);
  assert.equal((await c.api.store.list("handover"))[0].data.state, "done");
  assert.equal(await c.api.store.count("twitchConnection"), 0);
  assert.deepEqual(c.calls.legacyCleared.sort(), ["clientId"]);
});

test("aucune fuite : ni secret ni jeton dans le journal, les réponses de service, les blocs, le journal réseau du cœur", async () => {
  const ctx = oldInstance({ rows: withConnections() });
  const seen = [];
  ctx.api.services.call = async (s, m, a) => { const value = await C.methods[m](a); seen.push(value); return { ok: true, value }; };
  await migrate(ctx);
  seen.push(await def.adminPanel(ctx), await connectorModule.default.adminPanel(C.ctx), await C.methods.connections(), await C.methods.account({}), await def.services["twitch.live"].channel(ctx));
  const dump = JSON.stringify([seen, heard, C.ctx.calls.netLog, ctx.calls.netLog]);
  for (const v of SECRETS) assert.ok(!dump.includes(v), v);
  // et grep des journaux : rien du tout n'a été écrit sur la console
  assert.deepEqual(heard, []);
});

test("useCredentialsOf (application d'une autre chaîne) et reprise depuis Statut live : repris aussi ; la chaîne reprise reste, son secret part", async () => {
  const ctx = oldInstance({ legacy: { clientId: "", clientSecret: "", useCredentialsOf: "autre_chaine" }, rows: { borrowed: [{ from: "autre_chaine", clientId: "cid", clientSecret: "SEC-RET" }] } });
  await migrate(ctx);
  assert.equal((await C.methods.status()).ready, true);
  assert.equal(await ctx.api.store.count("borrowed"), 0);
  assert.ok(ctx.calls.legacyCleared.includes("useCredentialsOf"));
  connectorModule.resetCache(); C = connector({ settings: {} });
  const fromLive = oldInstance({ channel: "", legacy: { clientId: "", clientSecret: "", useCredentialsOf: null }, rows: { adopted: [{ channel: "machaine", clientId: "cid", clientSecret: "SEC-RET" }] } });
  await migrate(fromLive);
  assert.equal((await C.methods.status()).ready, true);
  assert.deepEqual((await fromLive.api.store.list("adopted"))[0].data, { channel: "machaine" });
  assert.equal((await def.services["twitch.live"].channel(fromLive)).channel, "machaine");
});

test("instance jamais réglée (ni application ni connexion) : rien n'est confié, la migration se termine (« done »)", async () => {
  const ctx = oldInstance({ legacy: { clientId: "", clientSecret: "", useCredentialsOf: null } });
  await migrate(ctx);
  assert.equal((await ctx.api.store.list("handover"))[0].data.state, "done");
  assert.equal((await C.methods.status()).ready, false);
  assert.equal(await C.ctx.api.store.count("twitchApp"), 0);
});

test("plusieurs instances (même application) : une application au Connecteur, une connexion par chaîne, chacune garde SON adresse de retour", async () => {
  const one = oldInstance({ rows: withConnections() });
  tw.state.login = "deuxieme"; tw.state.userId = "888";
  const two = oldInstance({ key: "tw2", channel: "deuxieme", legacy: { clientId: "", clientSecret: "", useCredentialsOf: "machaine" }, rows: {
    borrowed: [{ from: "machaine", clientId: "cid", clientSecret: "SEC-RET" }], twitchConnection: [grant("TWO-A", "TWO-R", { login: "deuxieme", userId: "888" })] } });
  await Promise.all([migrate(one), migrate(two)]);
  assert.equal(await C.ctx.api.store.count("twitchApp"), 1, "une seule application, même en même temps");
  assert.deepEqual((await C.methods.connections()).filter((c) => c.slot === "main").map((c) => c.channel).sort(), ["deuxieme", "machaine"]);
  for (const [ch, key] of [["machaine", "tw"], ["deuxieme", "tw2"]]) {
    await C.methods.wantScopes({ channel: ch, consumer: "x1", slot: "main", scopes: ["user:read:chat"] });
    assert.equal(new URL((await C.methods.connectLink({ channel: ch, slot: "main" })).url).searchParams.get("redirect_uri"), OLD(key), ch);
  }
  assert.equal((await C.methods.account({})).channel, "machaine", "la première chaîne reste celle par défaut des autres modules");
});

test("instance avec une AUTRE application : « conflict », rien n'est effacé ; une fois la chaîne reconnectée avec l'application du Connecteur, l'ancien accès est révoqué puis effacé", async () => {
  C = connector();   // le Connecteur a déjà l'application « cid »
  tw.state.login = "deuxieme"; tw.state.userId = "888";
  const other = oldInstance({ key: "tw2", channel: "deuxieme", legacy: { clientId: "autre-app", clientSecret: "AUTRE-SECRET", useCredentialsOf: null }, rows: { twitchConnection: [{ ...grant("X-A", "X-R", { login: "deuxieme", userId: "888" }), clientId: "autre-app" }] } });
  await migrate(other);
  assert.equal((await other.api.store.list("handover"))[0].data.state, "conflict");
  assert.deepEqual(other.calls.legacyCleared, []);
  assert.equal(await other.api.store.count("twitchConnection"), 1);
  const panel = await def.adminPanel(other);
  assert.ok(panel.some((b) => b.type === "banner" && b.text === fr.handover_conflict));
  // le bouton passe par l'application du Connecteur et SON adresse (l'ancienne appartient à l'autre application)
  const html = panel.find((b) => b.type === "html" && b.html.includes("data-twitch-connect"));
  const link = html.html.match(/href="([^"]+)"/)[1].replace(/&amp;/g, "&");
  assert.equal(new URL(link).searchParams.get("client_id"), "cid");
  assert.equal(new URL(link).searchParams.get("redirect_uri"), OWN);
  await C.callback(new Request(tw.approve(link)));
  mod.resetCache();
  await def.adminPanel(other);
  assert.equal((await other.api.store.list("handover"))[0].data.state, "done");
  assert.ok(tw.revoked.includes("X-A") && tw.revoked.includes("X-R"), "ancien accès révoqué chez Twitch");
  assert.equal(await other.api.store.count("twitchConnection"), 0);
  assert.deepEqual(other.calls.legacyCleared.sort(), ["clientId", "clientSecret"]);
  assert.ok(!JSON.stringify([panel, heard]).includes("AUTRE-SECRET"));
});

test("EventSub du bot : les abonnements sont liés à l'application ; le Connecteur reprend la MÊME application, il les voit donc tels quels (rien à recréer)", async () => {
  tw.subs.push({ id: "sub1", status: "enabled", type: "channel.chat.message", version: "1", condition: { broadcaster_user_id: "777", user_id: "555" }, transport: { method: "webhook", callback: "https://example.test/m/bot/eventsub" }, secret: "whsec" });
  await migrate(oldInstance({ rows: withConnections() }));
  const r = await C.methods.request({ as: "app", method: "GET", path: "eventsub/subscriptions", query: { type: "channel.chat.message" } });
  assert.deepEqual(r.json.data.map((s) => s.id), ["sub1"]);
  assert.equal(tw.log.find((c) => c.path === "/helix/eventsub/subscriptions").headers["client-id"], "cid");
});
