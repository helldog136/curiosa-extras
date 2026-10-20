// Ma Chaîne Twitch 2.0 : followers et abonnés payants (« social.stat »), et la connexion de la chaîne — l'autorisation est gardée par le Connecteur Twitch
// (vrai module, branché sur le faux Twitch) ; Ma Chaîne Twitch montre le bouton, l'état et les chiffres, et relaie le retour de Twitch pour une installation
// d'avant la 2.0 (même adresse de retour). Le détail de la sécurité de la connexion (state, compte vérifié…) est testé dans twitch-connector.test.mjs.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeTwitch } from "./helpers/fakeTwitch.mjs";
import { connector, connectorModule, connectorCallback } from "./helpers/twitchConnector.mjs";
import { problemsOfList } from "./helpers/socialStatContract.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/twitch-channel", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const mod = await import("../modules/twitch-channel/index.mjs");
const def = mod.default;
const relay = def.routes["oauth/callback"];
const OLD = "https://example.test/m/tw/oauth/callback";
const OWN = connectorCallback();
const realFetch = globalThis.fetch;
const spies = {};
const heard = [];
let tw, C;
beforeEach(() => {
  mod.resetCache(); connectorModule.resetCache();
  tw = fakeTwitch({ redirects: new Set([OLD, OWN]) });
  globalThis.fetch = (u, i) => tw.fetch(u, i);
  C = connector();
  heard.length = 0;
  for (const m of ["log", "info", "warn", "error", "debug"]) { spies[m] = console[m]; console[m] = (...a) => heard.push(a.map(String).join(" ")); }
});
afterEach(() => { globalThis.fetch = realFetch; for (const m of Object.keys(spies)) console[m] = spies[m]; });

const settingsOf = (extra = {}) => ({ channel: "MaChaine", trackStats: true, statsFollowers: true, statsPaying: false, ...extra });
const mk = (extra = {}, key = "tw") => fakeCtx({ key, locale: "fr", messages: fr, settings: settingsOf(extra), services: { "twitch.api": C.methods } });
const unesc = (v) => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const buttonOf = (blocks) => { const b = blocks.find((x) => x.type === "html" && x.html.includes("data-twitch-connect")); return b ? { href: unesc(/href="([^"]+)"/.exec(b.html)[1]), label: unesc(/>([^<]+)<\/a>/.exec(b.html)[1]) } : null; };
const linkOf = async (ctx) => buttonOf(await def.adminPanel(ctx))?.href;
const stat = (ctx) => def.exports["social.stat"](ctx, { limit: 50 });
/** Le retour de Twitch arrive à l'adresse donnée dans le lien : celle de Ma Chaîne Twitch (installation d'avant) ou celle du Connecteur (nouvelle). */
async function connectAs(ctx, who) {
  const link = await linkOf(ctx);
  assert.ok(link, "bouton attendu");
  const back = tw.approve(link, who);
  const res = back.startsWith(OLD) ? await relay(new Request(back), ctx) : await C.callback(new Request(back));
  return { link, res };
}
/** Une installation d'avant la 2.0 (application réglée dans l'instance, connexion déjà essayée) passée au Connecteur par la migration : son adresse de retour reste valable. */
async function migrated(extra = {}) {
  C = connector({ settings: {} });
  const c = fakeCtx({ key: "tw", locale: "fr", messages: fr, settings: settingsOf(extra), services: { "twitch.api": C.methods },
    legacy: { clientId: "cid", clientSecret: "SEC-RET", useCredentialsOf: null }, rows: { twitchResult: [{ code: "denied", slot: "main", at: "2026-01-01T00:00:00Z" }] } });
  await def.migrations[2](c);
  return c;
}
const count = (pred) => tw.log.filter(pred).length;
const everything = async (ctx) => JSON.stringify([await def.adminPanel(ctx), await stat(ctx), await def.services["twitch.live"].channel(ctx), heard, C.ctx.calls.netLog]);

// ── Manifeste, réglages, textes ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("manifeste : fournit social.stat, déclare routes + storage, réglages sûrs par défaut (éteint tant que le compte n'est pas connecté), aucun réglage de jeton", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.ok(manifest.provides.some((p) => p.topic === "social.stat" && p.label.fr && p.label.en));
  for (const p of ["routes", "storage", "admin", "topics"]) assert.ok(manifest.permissions.includes(p), p);
  const s = Object.fromEntries(manifest.settings.map((x) => [x.key, x]));
  assert.deepEqual([s.trackStats.default, s.statsFollowers.default, s.statsPaying.default], [false, true, false]);
  assert.ok(!s.trackStats.advanced && !s.statsFollowers.advanced && !s.statsPaying.advanced, "visibles en mode simple");
  assert.ok(!manifest.settings.some((x) => /token|jeton|access|refresh|secret|client/i.test(x.key)), "ni jeton ni identifiant d'application dans les réglages");
});

test("locales : fr et en alignées, toutes les clés utilisées par le code existent", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  const code = ["index", "connect", "helix", "handover", "analytics"].map((f) => fs.readFileSync(`${DIR}/${f}.mjs`, "utf8")).join("\n");
  for (const m of code.matchAll(/\bt\("([a-zA-Z_]+)"/g)) assert.ok(m[1] in fr, m[1]);
  for (const k of ["err_auth", "err_rate", "err_network", "err_config_affiliate", "err_config_credentials", "res_denied", "res_refused", "res_network", "res_rate", "res_expired", "res_wrongAccount", "res_scope", "stat_followers", "stat_paying", "noConnector", "suggestReason", "notReadyConnector", "handover_conflict", "handover_incomplete", "cb_noConnector", "cb_down"]) assert.ok(fr[k] && en[k], k);
});

test("mots simples : aucun jargon dans les textes de connexion et d'erreur, en français comme en anglais", () => {
  const JARGON = /\b(m[ée]trique|sujet|topic|api|scope|token|jeton|oauth|callback|secret key|endpoint|helix|http|json)\b/i;
  const keys = Object.keys(fr).filter((k) => /^(conn_|err_|res_|cb_|connect|connected|reconnect|morePermission|disconnect|notReady|needHttps|chooseOne|stat_|col_|noConnector|suggestReason|handover_)/.test(k));
  assert.ok(keys.length > 20);
  for (const k of keys) for (const [l, d] of [["fr", fr], ["en", en]]) assert.ok(!JARGON.test(d[k]), `${l}.${k} : « ${d[k]} »`);
  assert.equal(fr.connect, "Connecter ma chaîne Twitch");
  assert.match(fr.connected, /Connectée en tant que \{login\} depuis le \{date\}/);
});

// ── Panneau et connexion ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("interrupteur éteint : aucun bouton, aucun chiffre, aucune requête ; chaîne non réglée : rien", async () => {
  const off = mk({ trackStats: false });
  assert.ok(!(await def.adminPanel(off)).some((b) => b.type === "heading"));
  assert.deepEqual(await stat(off), []);
  assert.deepEqual(await stat(mk({ channel: "" })), []);
  assert.equal(tw.log.length, 0);
});

test("nouvelle configuration : un seul bouton, lien vers Twitch avec l'adresse du CONNECTEUR, autorisations MINIMALES selon ce qui est coché ; afficher n'appelle pas Twitch", async () => {
  const cases = [[{}, ["moderator:read:followers"]], [{ statsPaying: true }, ["channel:read:subscriptions", "moderator:read:followers"]], [{ statsFollowers: false, statsPaying: true }, ["channel:read:subscriptions"]]];
  for (const [extra, scopes] of cases) {
    mod.resetCache(); connectorModule.resetCache(); C = connector();
    const blocks = await def.adminPanel(mk(extra));
    assert.equal(blocks.filter((b) => b.type === "html" && b.html.includes("data-twitch-connect")).length, 1);
    const u = new URL(buttonOf(blocks).href);
    assert.equal(u.searchParams.get("redirect_uri"), OWN);
    assert.equal(u.searchParams.get("client_id"), "cid");
    assert.deepEqual(u.searchParams.get("scope").split(" ").sort(), scopes, JSON.stringify(extra));
  }
  assert.equal(tw.log.length, 0);
});

test("connexion (nouvelle configuration) : retour sur le Connecteur, puis sur la page de CETTE instance ; « Connectée en tant que… » et les chiffres", async () => {
  const ctx = mk();
  const { res } = await connectAs(ctx);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/admin/instances/id-tw");
  const blocks = await def.adminPanel(ctx);
  assert.ok(blocks.some((b) => b.type === "banner" && b.tone === "success" && /machaine/.test(b.text)));
  assert.deepEqual(blocks.find((b) => b.type === "table").rows, [["Followers Twitch", (1234).toLocaleString("fr")]]);
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "disconnect"));
  assert.equal(await ctx.api.store.count("twitchConnection"), 0, "aucun jeton chez Ma Chaîne Twitch");
});

test("installation d'avant la 2.0 : MÊME adresse de retour ; le retour arrive sur Ma Chaîne Twitch et est relayé au Connecteur, qui garde l'autorisation", async () => {
  const ctx = await migrated();
  const link = await linkOf(ctx);
  assert.equal(new URL(link).searchParams.get("redirect_uri"), OLD, "l'adresse enregistrée chez Twitch reste valable");
  const back = tw.approve(link);
  assert.ok(back.startsWith(OLD));
  const res = await relay(new Request(back), ctx);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/admin/instances/id-tw");
  assert.equal((await C.methods.account({ channel: "machaine" })).status, "ok");
  assert.equal((await stat(ctx))[0].value, 1234);
  assert.equal(tw.log.find((c) => c.body?.grant_type === "authorization_code").body.redirect_uri, OLD, "l'échange utilise exactement l'adresse de l'autorisation");
});

test("relais : seule la méthode GET ; state absent, forgé ou d'une AUTRE instance → 400 neutre ; la redirection ne vient jamais de la requête ; trop d'essais → 429", async () => {
  const ctx = await migrated();
  assert.equal((await relay(new Request(OLD, { method: "POST" }), ctx)).status, 405);
  for (const q of ["", "?state=", "?state=abc", `?state=${"x".repeat(43)}&code=abcdefghijk`]) assert.equal((await relay(new Request(`${OLD}${q}`), ctx)).status, 400, q);
  // un state créé pour le Connecteur (autre adresse) n'est pas accepté par ce relais
  await C.methods.register({ channel: "autre_x" });
  await C.methods.wantScopes({ channel: "autre_x", consumer: "x1", slot: "main", scopes: ["moderator:read:followers"] });
  const other = new URL((await C.methods.connectLink({ channel: "autre_x", slot: "main" })).url).searchParams.get("state");
  assert.equal((await relay(new Request(`${OLD}?code=abcdefghijkl&state=${other}`), ctx)).status, 400);
  const link = await linkOf(ctx);
  const res = await relay(new Request(`${tw.approve(link)}&returnTo=https://evil.example`), ctx);
  assert.equal(res.headers.get("location"), "/admin/instances/id-tw");
  for (let i = 0; i < 25; i++) await relay(new Request(`${OLD}?state=${"z".repeat(43)}`), ctx);
  assert.equal((await relay(new Request(`${OLD}?state=${"z".repeat(43)}`), ctx)).status, 429);
});

test("relais sans Connecteur : page simple (503), rien d'écrit", async () => {
  const ctx = fakeCtx({ key: "tw", locale: "fr", messages: fr, settings: settingsOf() });
  const r = await relay(new Request(`${OLD}?code=abcdefghijkl&state=${"s".repeat(43)}`), ctx);
  assert.equal(r.status, 503);
  assert.match(await r.text(), /Connecteur Twitch/);
});

test("mauvais compte : refusé par le Connecteur, le panneau dit lequel ; Connecteur sans application : message simple avec le chemin vers le Connecteur", async () => {
  const ctx = mk();
  await connectAs(ctx, { login: "autre_compte" });
  assert.ok((await def.adminPanel(ctx)).some((b) => b.type === "banner" && b.text.includes("autre_compte")));
  C = connector({ settings: {} });
  const p = await def.adminPanel(mk());
  const b = p.find((x) => x.type === "banner" && x.text === fr.notReadyConnector);
  assert.ok(b, "message « réglez votre application dans le Connecteur »");
  assert.equal(b.href, "/admin/instances/id-twitch-connector");
  assert.ok(!buttonOf(p));
});

// ── Chiffres ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("connecté : followers (et abonnés payants si coché) au bon format social.stat, valeur entière, jamais de jeton", async () => {
  const ctx = mk({ statsPaying: true });
  await connectAs(ctx);
  const items = await stat(ctx);
  assert.deepEqual(problemsOfList(items, { module: "twitch-channel", platform: "twitch" }), []);
  const by = Object.fromEntries(items.map((x) => [x.metric, x]));
  assert.deepEqual([by.followers.value, by.paying.value], [1234, 56]);
  assert.equal(by.followers.id, "twitch-channel:tw:followers");
  assert.ok(!/at_\d|rt_\d|SEC-RET/.test(JSON.stringify(items)));
});

test("seuls les chiffres cochés sont lus ; pas connecté : « auth » sans valeur et sans appel à Twitch", async () => {
  const ctx = mk();
  const before = tw.log.length;
  const [f] = await stat(ctx);
  assert.deepEqual([f.metric, f.error, "value" in f], ["followers", "auth", false]);
  assert.equal(tw.log.length, before);
  await connectAs(ctx);
  mod.resetCache();
  await stat(ctx);
  assert.equal(count((c) => c.path === "/helix/subscriptions"), 0);
  assert.equal(count((c) => c.path === "/helix/channels/followers"), 1);
});

test("chiffres : un appel par chaîne et par statistique, même simultanés ; le cache évite de rappeler Twitch", async () => {
  const ctx = mk();
  await connectAs(ctx);
  mod.resetCache();
  await Promise.all([stat(ctx), stat(ctx), stat(ctx)]);
  await stat(ctx);
  assert.equal(count((c) => c.path === "/helix/channels/followers"), 1);
});

test("abonnés payants : une chaîne non affiliée (403) donne « config » avec le message simple ; les followers restent servis", async () => {
  tw.state.affiliate = false;
  const ctx = mk({ statsPaying: true });
  await connectAs(ctx);
  mod.resetCache();
  const by = Object.fromEntries((await stat(ctx)).map((x) => [x.metric, x]));
  assert.deepEqual([by.paying.error, by.followers.value], ["config", 1234]);
  assert.ok(JSON.stringify((await def.adminPanel(ctx)).find((b) => b.type === "table").rows).includes(fr.err_config_affiliate));
});

test("erreurs de Twitch : 429 → rate, réseau coupé → network, jamais de valeur, pas de harcèlement", async () => {
  const ctx = mk();
  await connectAs(ctx);
  mod.resetCache();
  tw.state.rateLimited = true; tw.state.retryAfter = 120;
  assert.equal((await stat(ctx))[0].error, "rate");
  const n = tw.log.length;
  mod.resetCache();
  assert.equal((await stat(ctx))[0].error, "rate");
  assert.equal(tw.log.length, n, "pause du Connecteur : aucun appel");
  // un autre site (client réseau neuf), même application et même connexion, Twitch injoignable
  mod.resetCache(); connectorModule.resetCache();
  const store = C.ctx.api.store;
  C = connector(); C.ctx.api.store = store;
  tw.state.rateLimited = false; tw.state.down = true;
  const [x] = await stat(mk());
  assert.deepEqual([x.error, "value" in x], ["network", false]);
});

test("on ajoute une statistique après coup : « il faut autoriser de nouveau », la statistique manquante est en erreur auth, l'autre continue", async () => {
  const ctx = mk();
  await connectAs(ctx);
  mod.resetCache();
  const more = mk({ statsPaying: true });
  more.api.store = ctx.api.store;
  const p = await def.adminPanel(more);
  assert.ok(p.some((b) => b.type === "banner" && b.text === fr.morePermission));
  assert.ok(buttonOf(p));
  const by = Object.fromEntries((await stat(more)).map((x) => [x.metric, x]));
  assert.deepEqual([by.paying.error, by.followers.value], ["auth", 1234]);
});

test("renouvellement refusé par Twitch : « À reconnecter » visible avec le bouton, erreur auth sans valeur", async () => {
  const ctx = mk();
  await connectAs(ctx);
  const [d] = await C.ctx.api.store.list("twitchConnections");
  tw.expireAccess(d.data.access); tw.state.refreshFails = true;
  mod.resetCache();
  const [f] = await stat(ctx);
  assert.deepEqual([f.error, "value" in f], ["auth", false]);
  const p = await def.adminPanel(ctx);
  assert.ok(p.some((b) => b.type === "banner" && b.text === fr.reconnect));
  assert.ok(buttonOf(p));
});

test("Déconnecter (depuis Ma Chaîne Twitch) : le Connecteur révoque et efface ; les chiffres redeviennent « auth »", async () => {
  const ctx = mk();
  await connectAs(ctx);
  const [d] = await C.ctx.api.store.list("twitchConnections");
  const r = await def.adminActions.disconnect(ctx);
  assert.equal(r.ok, fr.disconnected);
  assert.ok(tw.revoked.includes(d.data.access) && tw.revoked.includes(d.data.refresh));
  assert.equal(await C.ctx.api.store.count("twitchConnections"), 0);
  assert.equal((await stat(ctx))[0].error, "auth");
});

test("jetons, secret et code jamais dans le panneau, les chiffres, les services, les réponses du relais ni les journaux", async () => {
  const ctx = await migrated();
  const { res } = await connectAs(ctx);
  const codes = tw.log.filter((c) => c.body?.code).map((c) => c.body.code);
  const dump = (await everything(ctx)) + JSON.stringify([res.headers.get("location"), await res.text()]);
  for (const v of ["SEC-RET", "app_tok", ...codes, ...[...tw.access.keys()], ...[...tw.refresh.keys()]]) assert.ok(!dump.includes(v), v);
});

test("deux instances (deux chaînes) : chacune sa connexion dans le Connecteur, ses chiffres ; une seule application", async () => {
  const a = mk({}, "a");
  await connectAs(a);
  tw.state.login = "deuxieme"; tw.state.userId = "888"; tw.state.followers = 7;
  const b = fakeCtx({ key: "b", locale: "fr", messages: fr, settings: settingsOf({ channel: "deuxieme" }), services: { "twitch.api": C.methods } });
  await connectAs(b);
  mod.resetCache();
  assert.deepEqual((await C.methods.connections()).map((x) => x.channel).sort(), ["deuxieme", "machaine"]);
  assert.equal((await stat(b))[0].value, 7);
  assert.equal((await stat(a))[0].value, 7, "le faux Twitch rend le même total à chaque compte connecté");
  assert.equal(count((c) => c.body?.grant_type === "authorization_code"), 2);
});
