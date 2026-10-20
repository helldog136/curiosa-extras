// Connecteur Twitch 1.0.0 : le service `twitch.api` v3 (liste fermée, jetons gardés ici), la connexion des comptes (state, retour, vérification du compte),
// le renouvellement, la reprise (adopt) sans fuite, l'administration. Aucun réseau : le faux Twitch (tests/helpers/fakeTwitch.mjs) répond à la place
// d'id.twitch.tv et d'api.twitch.tv, derrière le VRAI client réseau du cœur (ctx.api.net : pauses 429, disjoncteur, délais).
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeTwitch } from "./helpers/fakeTwitch.mjs";
import { connector, connectorModule, connectorCallback } from "./helpers/twitchConnector.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/twitch-connector", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const oauth = await import("../modules/twitch-connector/oauth.mjs");
const helix = await import("../modules/twitch-connector/helix.mjs");
const def = connectorModule.default;
const OWN = connectorCallback();
const OLD = "https://example.test/m/tw/oauth/callback";   // l'adresse d'une installation « Chaîne Twitch » d'avant
const realFetch = globalThis.fetch;
const saved = { ...oauth.timing };
const heard = [];
const spies = {};
let tw;
beforeEach(() => {
  connectorModule.resetCache();
  tw = fakeTwitch({ redirects: new Set([OWN, OLD]), users: [{ login: "alice", name: "Alice", picture: "https://static-cdn.jtvnw.net/a.png" }], streams: [{ login: "alice", viewers: 3 }] });
  globalThis.fetch = (u, i) => tw.fetch(u, i);
  heard.length = 0;
  for (const m of ["log", "info", "warn", "error", "debug"]) { spies[m] = console[m]; console[m] = (...a) => heard.push(a.map(String).join(" ")); }
});
afterEach(() => { globalThis.fetch = realFetch; Object.assign(oauth.timing, saved); for (const m of Object.keys(spies)) console[m] = spies[m]; });

const mk = (o = {}) => connector({ messages: fr, locale: "fr", ...o });
const app = (C, path, query, extra = {}) => C.methods.request({ as: "app", method: "GET", path, query, ...extra });
const CHAT = ["user:read:chat", "user:write:chat", "user:bot", "channel:bot"];
const FOL = "moderator:read:followers";
/** Le parcours : un module demande le lien, l'utilisateur autorise chez Twitch, Twitch revient sur la route du Connecteur. */
async function connect(C, { channel = "machaine", slot = "main", scopes = [FOL], who, returnTo } = {}) {
  await C.methods.register({ channel });
  const link = await C.methods.connectLink({ channel, slot, scopes, returnTo });
  assert.ok(link.url, `lien attendu (${link.reason})`);
  const res = await C.callback(new Request(tw.approve(link.url, who)));
  return { link: link.url, res };
}
const helixCalls = (path) => tw.log.filter((c) => c.path === `/helix/${path}`).length;
const tokenCalls = (grant) => tw.log.filter((c) => c.path === "/oauth2/token" && c.body?.grant_type === grant).length;

// ── Manifeste ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("manifeste : valide, une seule instance, twitch.api v3 NON each, minCore 0.2.0, réglages de l'application facultatifs (secret masqué), aucun réglage de jeton", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.id, "twitch-connector");
  assert.deepEqual(manifest.name, { en: "Twitch connector", fr: "Connecteur Twitch" });
  assert.equal(manifest.instances, "single");
  assert.equal(manifest.minCore, "0.2.0");
  assert.equal(manifest.type, "integration");
  assert.deepEqual(manifest.offers.map((o) => [o.service, o.version, o.each ?? false]), [["twitch.api", 3, false]]);
  assert.ok(!manifest.requires, "le fournisseur ne dépend de personne");
  assert.deepEqual(manifest.settings.map((s) => [s.key, s.type, s.optional]), [["appClientId", "text", true], ["appSecret", "secret", true]]);
  assert.ok(!manifest.settings.some((s) => /token|jeton|access|refresh/i.test(s.key)));
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
});

test("service : sur-ensemble de la version 2 (account, connectLink, disconnect, request, wantScopes) + connections, exchangeCode, adopt, status, register, retire", () => {
  const names = Object.keys(def.services["twitch.api"]).sort();
  for (const m of ["account", "connectLink", "disconnect", "request", "wantScopes", "connections", "exchangeCode", "adopt", "status"]) assert.ok(names.includes(m), m);
});

// ── Liste fermée ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("liste fermée : tout ce que la version 2 permettait passe encore ; ce que Ma Chaîne Twitch utilise aussi ; le reste est refusé sans réseau", () => {
  const ok = (args) => assert.ok(!helix.check(args).error, JSON.stringify(args));
  const no = (args, error) => assert.equal(helix.check(args).error, error, JSON.stringify(args));
  // version 2
  ok({ as: "app", method: "GET", path: "users", query: { login: ["alice", "bob_x"] } });
  ok({ as: "app", method: "GET", path: "streams", query: { user_login: Array.from({ length: 100 }, (_, i) => `user_${i}x`), first: 100 } });
  ok({ as: "app", method: "GET", path: "eventsub/subscriptions", query: { type: "channel.chat.message" } });
  ok({ as: "app", method: "POST", path: "eventsub/subscriptions", body: { type: "channel.chat.message", version: "1", condition: {}, transport: {} } });
  ok({ as: "app", method: "DELETE", path: "eventsub/subscriptions", query: { id: "abc" } });
  ok({ as: "user", method: "POST", path: "chat/messages", body: { broadcaster_id: "1", sender_id: "1", message: "hi" } });
  // version 3 (Ma Chaîne Twitch)
  ok({ as: "app", method: "GET", path: "streams", query: { user_id: ["777"], first: ["1"] } });
  ok({ as: "app", method: "GET", path: "users", query: { id: ["777"] } });
  ok({ as: "app", method: "GET", path: "games", query: { id: ["1", "509658"] } });
  ok({ as: "app", method: "GET", path: "channels", query: { broadcaster_id: ["777"] } });
  ok({ as: "app", method: "GET", path: "videos", query: { user_id: ["777"], first: ["100"], after: ["abc=="] } });
  ok({ as: "app", method: "GET", path: "clips", query: { broadcaster_id: ["777"], started_at: ["2026-08-01T00:00:00.000Z"], first: ["20"] } });
  ok({ as: "user", method: "GET", path: "channels/followers", query: { broadcaster_id: ["777"], first: ["1"] } });
  ok({ as: "user", method: "GET", path: "subscriptions", query: { broadcaster_id: ["777"], first: ["1"] } });
  // refus
  no({ as: "app", method: "GET", path: "streams", query: { user_login: ["alice"], after: ["x"] } }, "invalid");
  no({ as: "app", method: "GET", path: "streams", query: { user_login: ["alice"], game_id: ["1"] } }, "invalid");
  no({ as: "app", method: "GET", path: "streams", query: { user_login: ["alice"], user_id: ["1"] } }, "invalid");
  no({ as: "app", method: "GET", path: "streams", query: { user_login: Array.from({ length: 101 }, (_, i) => `user_${i}x`) } }, "invalid");
  no({ as: "app", method: "GET", path: "users", query: { login: ["pas valide!"] } }, "invalid");
  no({ as: "app", method: "GET", path: "users", query: {} }, "invalid");
  no({ as: "app", method: "GET", path: "users", query: { login: ["alice"] }, body: { x: 1 } }, "invalid");
  no({ as: "app", method: "POST", path: "eventsub/subscriptions", body: { big: "x".repeat(10_001) } }, "invalid");
  no({ as: "app", method: "GET", path: "channels/followers", query: { broadcaster_id: ["1"] } }, "forbidden");
  no({ as: "user", method: "GET", path: "users", query: { login: ["alice"] } }, "forbidden");
  no({ as: "app", method: "PATCH", path: "channels", query: { broadcaster_id: ["1"] } }, "forbidden");
  no({ as: "app", method: "GET", path: "../oauth2/token" }, "forbidden");
  no({ method: "GET", path: "users", query: { login: ["alice"] } }, "invalid");
});

test("request (application) : un seul jeton d'application, en-têtes (jamais dans l'adresse), réponse de Twitch telle quelle ; journal du cœur sans requête ni secret", async () => {
  const C = mk();
  const r = await app(C, "users", { login: ["alice"] });
  assert.equal(r.ok, true); assert.equal(r.status, 200); assert.equal(r.json.data[0].login, "alice");
  assert.equal((await app(C, "streams", { user_login: ["alice"], first: 100 })).json.data[0].user_login, "alice");
  await app(C, "streams", { user_login: ["bob_x"] });
  assert.equal(tokenCalls("client_credentials"), 1, "un seul jeton d'application");
  const h = tw.log.find((c) => c.path === "/helix/streams");
  assert.equal(h.headers.authorization, "Bearer app_tok"); assert.equal(h.headers["client-id"], "cid");
  for (const c of tw.log) assert.ok(!c.url.includes("SEC-RET") && !c.url.includes("app_tok"));
  assert.ok(C.ctx.calls.netLog.length >= 3);
  for (const line of C.ctx.calls.netLog) assert.ok(!/SEC-RET|app_tok|\?|login=/.test(line), line);
  assert.deepEqual(await C.methods.request({ as: "app", method: "GET", path: "users", query: { login: ["x y"] } }), { ok: false, error: "invalid" });
  assert.equal(tw.log.length, 4, "une demande refusée ne touche pas au réseau");
});

test("request : cache de 10 minutes pour GET users / GET games (identités), jamais pour GET streams", async () => {
  const C = mk();
  await app(C, "users", { login: ["alice"] }); await app(C, "users", { login: ["alice"] });
  await app(C, "streams", { user_login: ["alice"] }); await app(C, "streams", { user_login: ["alice"] });
  assert.equal(helixCalls("users"), 1);
  assert.equal(helixCalls("streams"), 2);
});

test("sans application réglée : « config », aucun appel ; mauvais secret : « config » (Twitch refuse le jeton d'application)", async () => {
  assert.deepEqual(await app(mk({ settings: {} }), "users", { login: ["alice"] }), { ok: false, error: "config" });
  assert.equal(tw.log.length, 0);
  assert.deepEqual(await app(mk({ settings: { appClientId: "cid", appSecret: "faux" } }), "users", { login: ["alice"] }), { ok: false, error: "config" });
});

// ── Faux Twitch : 429, silence, JSON coupé ───────────────────────────────────────────────────────────────────────────────────────────

test("429 avec Retry-After : « rate », puis PLUS AUCUN appel réseau pour toute l'application (même seau), quel que soit le module qui demande", async () => {
  const C = mk();
  await app(C, "users", { login: ["alice"] });
  tw.state.rateLimited = true; tw.state.retryAfter = 120;
  assert.deepEqual(await app(C, "streams", { user_login: ["alice"] }), { ok: false, error: "rate" });
  const n = tw.log.length;
  // un autre consommateur (Raid, Bot…) passe par le même Connecteur : même application, même pause
  assert.deepEqual(await app(C, "streams", { user_login: ["bob_x"] }), { ok: false, error: "rate" });
  assert.deepEqual(await C.methods.request({ as: "app", method: "GET", path: "eventsub/subscriptions", query: { type: "x" } }), { ok: false, error: "rate" });
  assert.equal(tw.log.length, n, "aucun appel pendant la pause");
  assert.ok((await C.methods.status()).health.some((h) => h.host === "api.twitch.tv" && h.state === "rate"), "la santé dit la pause");
});

test("Twitch muet (trou noir) : « network » dans la borne, pour tous les appelants simultanés ; la demande suivante repart", async () => {
  Object.assign(oauth.timing, { requestMs: 150, sharedMs: 400 });
  const C = mk();
  tw.state.silence = true;
  const t0 = Date.now();
  const rs = await Promise.all([app(C, "users", { login: ["alice"] }), app(C, "streams", { user_login: ["alice"] }), C.methods.request({ as: "user", method: "POST", path: "chat/messages", body: { message: "x" } })]);
  assert.ok(Date.now() - t0 < 1500, `borné (${Date.now() - t0} ms)`);
  assert.deepEqual(rs.map((r) => r.error), ["network", "network", "auth"]);
  tw.state.silence = false;
  assert.equal((await app(C, "users", { login: ["alice"] })).ok, true, "plus rien n'attend l'ancienne demande");
});

test("JSON coupé : jamais d'exception ; jeton d'application illisible = « network » ; réponse Helix coupée = { ok, status, json: null }", async () => {
  const C = mk();
  tw.state.truncated = (u) => u.includes("/oauth2/token");
  assert.deepEqual(await app(C, "users", { login: ["alice"] }), { ok: false, error: "network" });
  tw.state.truncated = (u) => u.includes("/helix/users");
  assert.deepEqual(await app(C, "users", { login: ["alice"] }), { ok: true, status: 200, json: null });
});

// ── Connexion d'un compte ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("connexion : lien (application, adresse du Connecteur, state aléatoire), retour sur la route du Connecteur, compte vérifié, retour vers la page demandée", async () => {
  const C = mk();
  const { link, res } = await connect(C, { returnTo: "/admin/instances/abc" });
  const u = new URL(link);
  assert.equal(u.origin + u.pathname, "https://id.twitch.tv/oauth2/authorize");
  assert.equal(u.searchParams.get("client_id"), "cid");
  assert.equal(u.searchParams.get("redirect_uri"), OWN);
  assert.equal(u.searchParams.get("scope"), FOL);
  assert.match(u.searchParams.get("state"), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/admin/instances/abc");
  assert.equal(res.headers.get("cache-control"), "no-store");
  const a = await C.methods.account({ channel: "machaine" });
  assert.deepEqual([a.status, a.login, a.userId, a.ready, a.https], ["ok", "machaine", "777", true, true]);
  assert.ok(!JSON.stringify(a).includes("at_") && !JSON.stringify(a).includes("rt_"));
  assert.deepEqual((await C.methods.connections()).map((c) => [c.slot, c.channel, c.login, c.status]), [["main", "machaine", "machaine", "ok"]]);
  assert.deepEqual(await C.methods.connectLink({ channel: "machaine", slot: "main", scopes: [FOL] }), { ok: true, url: null, reason: "connected" });
});

test("state : rejoué → 400 sans rien appeler ; forgé, vide, mal formé → 400 identique, aucune écriture ; au-delà de 20 essais → 429", async () => {
  const C = mk();
  const { link } = await connect(C);
  const back = tw.approve(link);   // nouveau code pour le même state : déjà consommé
  const before = tw.log.length;
  assert.equal((await C.callback(new Request(back))).status, 400);
  assert.equal(tw.log.length, before);
  const writes = C.ctx.calls.writes.length;
  for (const q of ["", "?state=", "?state=abc", `?state=${"x".repeat(43)}&code=abcdefghijkl`, "?state=<script>"]) assert.equal((await C.callback(new Request(`${OWN}${q}`))).status, 400, q);
  assert.equal(C.ctx.calls.writes.length, writes, "aucune écriture");
  for (let i = 0; i < 20; i++) await C.callback(new Request(`${OWN}?state=${"y".repeat(43)}`));
  assert.equal((await C.callback(new Request(`${OWN}?state=${"y".repeat(43)}`))).status, 429);
  assert.equal((await C.callback(new Request(OWN, { method: "POST" }))).status, 405);
});

test("state lié à l'adresse : un retour arrivé par une AUTRE adresse est refusé et ne consomme pas le state (le bon retour passe ensuite)", async () => {
  const C = mk();
  await C.methods.register({ channel: "machaine" });
  const { url } = await C.methods.connectLink({ channel: "machaine", slot: "main", scopes: [FOL] });
  const back = new URL(tw.approve(url));
  const p = back.searchParams;
  assert.deepEqual(await C.methods.exchangeCode({ code: p.get("code"), state: p.get("state"), redirectUri: OLD }), { ok: false, error: "state" });
  assert.equal((await C.methods.exchangeCode({ code: p.get("code"), state: p.get("state"), redirectUri: OWN })).ok, true);
});

test("state expiré (10 minutes) : pas de connexion, résultat « expired » dans account(), state consommé", async () => {
  const C = mk();
  await C.methods.register({ channel: "machaine" });
  const { url } = await C.methods.connectLink({ channel: "machaine", slot: "main", scopes: [FOL] });
  const [p] = await C.ctx.api.store.list("twitchPending");
  await C.ctx.api.store.update(p.id, { ...p.data, expiresAt: Date.now() - 1 });
  assert.equal((await C.callback(new Request(tw.approve(url)))).status, 303);
  const a = await C.methods.account({ channel: "machaine" });
  assert.deepEqual([a.status, a.result], ["none", { code: "expired" }]);
  assert.equal(await C.ctx.api.store.count("twitchPending"), 0);
});

test("mauvais compte (emplacement « main ») : refusé, jetons aussitôt révoqués, le résultat dit quel compte ; le compte « bot » peut être n'importe lequel", async () => {
  const C = mk();
  await connect(C, { who: { login: "autre_compte", userId: "999" } });
  const a = await C.methods.account({ channel: "machaine" });
  assert.deepEqual([a.status, a.result], ["none", { code: "wrongAccount", login: "autre_compte" }]);
  assert.equal(tw.revoked.length, 2);
  await connect(C, { slot: "bot", scopes: ["user:write:chat", "user:bot"], who: { login: "monbot", userId: "555" } });
  const b = await C.methods.account({ channel: "machaine", slot: "bot" });
  assert.deepEqual([b.status, b.login, b.userId], ["ok", "monbot", "555"]);
});

test("refus chez Twitch, autorisation incomplète, mauvais secret : message humain gardé, aucun jeton gardé", async () => {
  const C = mk();
  await C.methods.register({ channel: "machaine" });
  let { url } = await C.methods.connectLink({ channel: "machaine", slot: "main", scopes: [FOL] });
  const st = new URL(url).searchParams.get("state");
  await C.callback(new Request(`${OWN}?error=access_denied&state=${st}`));
  assert.deepEqual((await C.methods.account({ channel: "machaine" })).result, { code: "denied" });
  ({ url } = await C.methods.connectLink({ channel: "machaine", slot: "main", scopes: [FOL] }));
  await C.callback(new Request(tw.approve(url, { dropScopes: [FOL] })));
  assert.deepEqual((await C.methods.account({ channel: "machaine" })).result, { code: "scope" });
  const D = mk({ settings: { appClientId: "cid", appSecret: "mauvais" } });
  await connect(D);
  assert.deepEqual((await D.methods.account({ channel: "machaine" })).result, { code: "refused" });
  assert.equal(await C.ctx.api.store.count("twitchConnections") + await D.ctx.api.store.count("twitchConnections"), 0);
});

test("se reconnecter remplace la connexion (une seule par compte) et révoque l'ancienne", async () => {
  const C = mk();
  await connect(C);
  const [first] = await C.ctx.api.store.list("twitchConnections");
  await C.methods.wantScopes({ channel: "machaine", consumer: "bot1", slot: "main", scopes: ["user:write:chat"] });
  assert.equal((await C.methods.account({ channel: "machaine" })).status, "more");
  await connect(C, { scopes: [FOL] });
  assert.equal(await C.ctx.api.store.count("twitchConnections"), 1);
  assert.ok(tw.revoked.includes(first.data.access) && tw.revoked.includes(first.data.refresh));
  assert.equal((await C.methods.account({ channel: "machaine" })).status, "ok");
});

// ── Jetons des comptes : renouvellement ──────────────────────────────────────────────────────────────────────────────────────────────

const followers = (C) => C.methods.request({ as: "user", slot: "main", channel: "machaine", method: "GET", path: "channels/followers", query: { broadcaster_id: ["777"], first: ["1"] } });

test("compte connecté : appel « user » avec SON jeton ; autorisation manquante → « scope » sans réseau ; chaîne inconnue → « auth »", async () => {
  const C = mk();
  await connect(C);
  const r = await followers(C);
  assert.deepEqual([r.ok, r.status, r.json.total], [true, 200, 1234]);
  const n = tw.log.length;
  assert.deepEqual(await C.methods.request({ as: "user", channel: "machaine", method: "GET", path: "subscriptions", query: { broadcaster_id: ["777"] } }), { ok: false, error: "scope" });
  assert.deepEqual(await C.methods.request({ as: "user", channel: "inconnue", method: "GET", path: "subscriptions", query: { broadcaster_id: ["777"] } }), { ok: false, error: "auth" });
  assert.equal(tw.log.length, n);
});

test("jeton proche de l'expiration : renouvelé AVANT l'appel avec le secret, une seule fois pour plusieurs appels simultanés, les nouveaux jetons gardés", async () => {
  const C = mk();
  await connect(C);
  const [d] = await C.ctx.api.store.list("twitchConnections");
  await C.ctx.api.store.update(d.id, { ...d.data, expiresAt: Date.now() + 30_000 });
  const rs = await Promise.all([followers(C), followers(C), followers(C)]);
  assert.ok(rs.every((r) => r.ok && r.json.total === 1234));
  assert.equal(tokenCalls("refresh_token"), 1);
  const [after] = await C.ctx.api.store.list("twitchConnections");
  assert.notEqual(after.data.access, d.data.access);
  assert.equal(tw.log.find((c) => c.body?.grant_type === "refresh_token").body.client_secret, "SEC-RET", "le renouvellement se fait avec le secret de l'application");
});

test("401 (jeton révoqué chez Twitch) : UN renouvellement puis UNE nouvelle tentative, fusionnés entre appels simultanés", async () => {
  const C = mk();
  await connect(C);
  const [d] = await C.ctx.api.store.list("twitchConnections");
  tw.expireAccess(d.data.access);
  const rs = await Promise.all([followers(C), followers(C)]);
  assert.ok(rs.every((r) => r.ok && r.status === 200));
  assert.equal(tokenCalls("refresh_token"), 1);
});

test("renouvellement refusé : « À reconnecter » (account et connections), erreur « auth », aucune boucle ; panne réseau pendant le renouvellement : passager", async () => {
  const C = mk();
  await connect(C);
  const [d] = await C.ctx.api.store.list("twitchConnections");
  tw.expireAccess(d.data.access); tw.state.refreshFails = true;
  assert.deepEqual(await followers(C), { ok: false, error: "auth" });
  assert.equal((await C.methods.account({ channel: "machaine" })).status, "reconnect");
  assert.equal((await C.methods.connections())[0].status, "expired");
  const n = tw.log.length;
  assert.deepEqual(await followers(C), { ok: false, error: "auth" });
  assert.equal(tw.log.length, n, "plus aucun appel tant qu'on n'a pas reconnecté");
  const D = mk();
  await connect(D);
  const [e] = await D.ctx.api.store.list("twitchConnections");
  await D.ctx.api.store.update(e.id, { ...e.data, expiresAt: Date.now() });
  tw.state.refreshFails = false; tw.state.down = true;
  assert.deepEqual(await followers(D), { ok: false, error: "network" });
  tw.state.down = false;
  assert.equal((await D.methods.account({ channel: "machaine" })).status, "ok", "pas « À reconnecter » pour une panne");
});

test("déconnecter : emplacement explicite, les deux jetons révoqués chez Twitch puis effacés ; Twitch injoignable : effacé quand même", async () => {
  const C = mk();
  await connect(C);
  const [d] = await C.ctx.api.store.list("twitchConnections");
  assert.deepEqual(await C.methods.disconnect({ channel: "machaine" }), { ok: false, error: "forbidden" });
  assert.deepEqual(await C.methods.disconnect({ channel: "machaine", slot: "main" }), { ok: true, reached: true });
  assert.ok(tw.revoked.includes(d.data.access) && tw.revoked.includes(d.data.refresh));
  assert.equal(await C.ctx.api.store.count("twitchConnections"), 0);
  await connect(C);
  tw.state.offlineRevoke = true;
  const [row] = await C.ctx.api.store.list("twitchConnections");
  const r = await def.adminActions.disconnect(C.ctx, { id: row.id });
  assert.equal(r.ok, fr.disconnectedOffline);
  assert.equal(await C.ctx.api.store.count("twitchConnections"), 0);
});

// ── Plusieurs chaînes, chaîne par défaut, demandes d'autorisations ───────────────────────────────────────────────────────────────────

test("plusieurs chaînes : une application, une connexion par chaîne ; account() sans chaîne = la première connue ; wantScopes par chaîne (liste fermée, idempotent)", async () => {
  const C = mk();
  await connect(C, { channel: "machaine" });
  tw.state.login = "deuxieme"; tw.state.userId = "888";
  await connect(C, { channel: "deuxieme" });
  assert.deepEqual((await C.methods.connections()).map((c) => c.channel).sort(), ["deuxieme", "machaine"]);
  assert.equal((await C.methods.account({})).channel, "machaine");
  assert.equal((await C.methods.account({ channel: "deuxieme" })).userId, "888");
  const w = await C.methods.wantScopes({ channel: "deuxieme", consumer: "bot2", slot: "main", scopes: [...CHAT, "channel:manage:broadcast"] });
  assert.deepEqual(w.scopes, [...CHAT].sort(), "hors liste écarté");
  const before = C.ctx.calls.writes.length;
  await C.methods.wantScopes({ channel: "deuxieme", consumer: "bot2", slot: "main", scopes: CHAT });
  assert.equal(C.ctx.calls.writes.length, before, "même demande = aucune écriture");
  assert.deepEqual((await C.methods.account({ channel: "deuxieme" })).wanted, [...CHAT].sort());
  assert.deepEqual((await C.methods.account({ channel: "machaine" })).wanted, [], "les demandes d'une chaîne ne touchent pas l'autre");
  assert.deepEqual(await C.methods.wantScopes({ channel: "deuxieme", consumer: "Pas Valable!", slot: "main", scopes: CHAT }), { ok: false, error: "invalid" });
  await C.methods.register({ channel: "machaine", remove: true });
  assert.equal((await C.methods.account({})).channel, "deuxieme", "chaîne retirée : la suivante devient celle par défaut");
});

test("connectLink : raisons « not_ready » (pas d'application), « https » (site en http), « nothing » (aucune autorisation demandée)", async () => {
  assert.equal((await mk({ settings: {} }).methods.connectLink({ channel: "machaine", slot: "main", scopes: [FOL] })).reason, "not_ready");
  assert.equal((await mk({ siteUrl: "http://exemple.test" }).methods.connectLink({ channel: "machaine", slot: "main", scopes: [FOL] })).reason, "https");
  assert.equal((await mk().methods.connectLink({ channel: "machaine", slot: "main" })).reason, "nothing");
  assert.equal((await mk().methods.connectLink({ slot: "main", scopes: [FOL] })).reason, "not_ready", "aucune chaîne connue");
});

// ── Reprise (adopt) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const legacyConn = (over = {}) => ({ slot: "main", login: "machaine", userId: "777", accessToken: "OLD-ACCESS-tok", refreshToken: "OLD-REFRESH-tok", scopes: [FOL], expiresAt: Date.now() + 3_600_000, clientId: "cid", ...over });

test("adopt : application et connexions reprises SANS ressaisie, jamais une valeur en retour, idempotent, jamais d'écrasement", async () => {
  const C = mk({ settings: {} });
  const r = await C.methods.adopt({ clientId: "cid", clientSecret: "SEC-RET", channel: "machaine", redirectUri: OLD, connections: [legacyConn(), legacyConn({ slot: "bot", login: "monbot", userId: "555", accessToken: "BOT-A", refreshToken: "BOT-R" })] });
  assert.deepEqual(r, { ok: true, adopted: ["clientId", "clientSecret", "main", "bot"], ready: true });
  for (const v of ["SEC-RET", "OLD-ACCESS", "OLD-REFRESH", "BOT-A"]) assert.ok(!JSON.stringify(r).includes(v));
  assert.deepEqual(await C.methods.adopt({ clientId: "cid", clientSecret: "SEC-RET", channel: "machaine", redirectUri: OLD, connections: [legacyConn()] }), { ok: true, adopted: [], ready: true }, "deuxième fois : rien");
  assert.equal(await C.ctx.api.store.count("twitchApp"), 1);
  assert.equal(await C.ctx.api.store.count("twitchConnections"), 2);
  // la connexion reprise sert tout de suite, avec l'adresse de retour reprise
  assert.equal((await followers(C)).ok, false, "le jeton « OLD-ACCESS » n'existe pas chez le faux Twitch : renouvellement tenté");
  const link = await C.methods.connectLink({ channel: "machaine", slot: "main", scopes: [FOL, "user:write:chat"] });
  assert.equal(new URL(link.url).searchParams.get("redirect_uri"), OLD, "même adresse de retour qu'avant");
});

test("adopt : autre application déjà réglée → « conflict », rien n'est écrit ; un réglage saisi n'est jamais remplacé ; secret sans identifiant assorti refusé", async () => {
  const C = mk();
  const writes = C.ctx.calls.writes.length;
  assert.deepEqual(await C.methods.adopt({ clientId: "autre", clientSecret: "x", connections: [legacyConn({ clientId: "autre" })] }), { ok: false, error: "conflict", adopted: [], ready: false });
  assert.equal(C.ctx.calls.writes.length, writes);
  const D = mk({ settings: { appClientId: "cid" } });
  assert.deepEqual(await D.methods.adopt({ clientId: "cid", clientSecret: "SEC-RET" }), { ok: true, adopted: ["clientSecret"], ready: true });
  const E = mk({ settings: {} });
  assert.deepEqual(await E.methods.adopt({ clientId: "cid" }), { ok: true, adopted: ["clientId"], ready: false }, "incomplet : pas prêt");
  assert.deepEqual(await E.methods.adopt({ clientId: "cid", clientSecret: "SEC-RET", connections: [legacyConn({ clientId: "autre-app" })] }), { ok: true, adopted: ["clientSecret"], ready: false }, "un jeton d'une autre application n'est pas repris");
  assert.deepEqual(await E.methods.adopt(null), { ok: true, adopted: [], ready: true });
});

test("adopt : jamais de fuite (journal, réponses, panneau, statut, comptes) ; register et retire ne rendent aucune valeur", async () => {
  const C = mk({ settings: {} });
  const all = [];
  all.push(await C.methods.adopt({ clientId: "cid", clientSecret: "SEC-RET", channel: "machaine", connections: [legacyConn()] }));
  all.push(await C.methods.status(), await C.methods.connections(), await C.methods.account({}), await def.adminPanel(C.ctx));
  all.push(await C.methods.retire({ clientId: "cid", tokens: ["OLD-ACCESS-tok"] }));
  all.push(await C.methods.register({ channel: "machaine", redirectUri: OLD }));
  const dump = JSON.stringify([all, heard, C.ctx.calls.netLog]);
  for (const v of ["SEC-RET", "OLD-ACCESS", "OLD-REFRESH", "app_tok"]) assert.ok(!dump.includes(v), v);
  assert.deepEqual(all.at(-2), { revoked: 1 });
  assert.ok(tw.revoked.includes("OLD-ACCESS-tok"));
});

// ── Administration ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("panneau : guide pas à pas, adresse du Connecteur avec un bouton « Copier » ; prêt : la consigne de la garder ; adresses reprises listées ; santé de Twitch", async () => {
  const empty = await def.adminPanel(mk({ settings: {} }).ctx);
  const copy = empty.find((b) => b.type === "copy");
  assert.equal(copy.text, OWN);
  assert.match(copy.label, /Redirect URLs/);
  assert.ok(empty.some((b) => b.type === "markdown" && /dev\.twitch\.tv\/console/.test(b.text) && /Register Your Application/.test(b.text)));
  assert.ok(empty.some((b) => b.type === "markdown" && /Client ID/.test(b.text) && /New Secret/.test(b.text)));
  const C = mk({ settings: {} });
  await C.methods.adopt({ clientId: "cid", clientSecret: "SEC-RET", channel: "machaine", redirectUri: OLD });
  const p = await def.adminPanel(C.ctx);
  assert.ok(p.some((b) => b.type === "banner" && b.tone === "success"));
  assert.ok(p.some((b) => b.type === "table" && JSON.stringify(b.rows).includes(OLD)), "l'ancienne adresse est listée : à garder chez Twitch");
  assert.ok(p.some((b) => b.type === "adminForm" && b.action === "forgetApp"));
  const health = p.find((b) => b.type === "netHealth");
  assert.deepEqual(health.items.map((i) => i.host), ["api.twitch.tv", "id.twitch.tv"]);
  assert.ok(!JSON.stringify(p).includes("SEC-RET") && !JSON.stringify(p).includes('"cid"'));
  await def.adminActions.forgetApp(C.ctx);
  assert.equal((await C.methods.status()).ready, false);
  assert.deepEqual((await C.methods.status()).missing, ["clientId", "clientSecret"]);
});

test("panneau : comptes connectés en tableau (chaîne, compte, état) avec « Déconnecter » ; aucun jeton", async () => {
  const C = mk();
  await connect(C);
  const p = await def.adminPanel(C.ctx);
  const t = p.find((b) => b.type === "table" && b.rowActions);
  assert.deepEqual(t.rows, [["machaine", `machaine · ${fr.slot_main}`, fr.conn_state_ok]]);
  assert.equal(t.rowActions[0].action, "disconnect");
  assert.ok(!/at_\d|rt_\d/.test(JSON.stringify(p)));
});

test("mots simples : aucun terme technique dans les textes de l'administration (fr et en)", () => {
  for (const d of [fr, en]) for (const [k, v] of Object.entries(d)) assert.ok(!/\b(jetons?|tokens?|oauth|api|scope|json|helix)\b/i.test(v.replace(/https?:\/\/\S+/g, "")), `${k} : ${v}`);
});
