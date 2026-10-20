// Ma Chaîne Twitch 2.0 (identifiant technique `twitch-channel`) : bouton, live en cours, clips, service `twitch.live` — tout passe par le Connecteur Twitch
// (service `twitch.api`, ici le VRAI Connecteur branché sur le faux Twitch). Sans Connecteur : bouton et lien seulement, aucun appel, suggestion d'installation.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeTwitch } from "./helpers/fakeTwitch.mjs";
import { connector, connectorModule } from "./helpers/twitchConnector.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/twitch-channel", import.meta.url).pathname;
const manifestJson = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const source = ["index", "connect", "helix", "live", "analytics", "handover"].map((f) => fs.readFileSync(`${DIR}/${f}.mjs`, "utf8")).join("\n");
const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const mod = await import("../modules/twitch-channel/index.mjs");
const def = mod.default;
const svc = def.services["twitch.live"];
const realFetch = globalThis.fetch;
let tw, C;
beforeEach(() => {
  mod.resetCache(); connectorModule.resetCache();
  tw = fakeTwitch({ streams: [{ login: "machaine", title: "Soirée", game: "Zelda", viewers: 12, startedAt: "2030-01-01T10:00:00Z", name: "MaChaine" }],
    clips: [{ title: "Beau clip", url: "https://clips.twitch.tv/abc", thumbnail_url: "https://static-cdn.jtvnw.net/x.jpg", created_at: "2030-01-01T00:00:00Z", view_count: 3 }, { title: "Piège", url: "javascript:alert(1)", thumbnail_url: "javascript:x", created_at: "2030-01-01T00:00:00Z" }] });
  globalThis.fetch = (u, i) => tw.fetch(u, i);
  C = connector();
});
afterEach(() => { globalThis.fetch = realFetch; });

const ctx = (settings = {}, o = {}) => fakeCtx({ key: "tw", locale: "fr", messages: fr, settings: { channel: "MaChaine", ...settings }, services: { "twitch.api": C.methods }, ...o });
const bare = (settings = {}) => fakeCtx({ key: "tw", locale: "fr", messages: fr, settings: { channel: "MaChaine", ...settings } });   // sans Connecteur
const helix = (path) => tw.log.filter((c) => c.path === `/helix/${path}`).length;

test("manifeste : valide ; « Ma Chaîne Twitch », identifiant conservé ; 2.0.0, minCore 0.2.0, données en version 2 ; n'offre plus twitch.api, exige le Connecteur (v3) ; anciens réglages masqués", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifestJson.id, "twitch-channel");
  assert.deepEqual(manifestJson.name, { en: "My Twitch channel", fr: "Ma Chaîne Twitch" });
  assert.deepEqual([manifestJson.version, manifestJson.minCore, manifestJson.dataVersion], ["2.0.0", "0.2.0", 2]);
  assert.deepEqual(manifestJson.offers.map((o) => [o.service, o.each]), [["twitch.live", true]]);
  assert.deepEqual(manifestJson.requires.map((x) => [x.service, x.min, x.optional ?? false]), [["twitch.api", 3, false]]);
  assert.deepEqual(manifestJson.legacySettings, [{ key: "clientId" }, { key: "clientSecret", secret: true }, { key: "useCredentialsOf" }]);
  assert.ok(!manifestJson.settings.some((s) => ["clientId", "clientSecret", "useCredentialsOf"].includes(s.key)));
  const declared = new Set(manifestJson.settings.map((s) => s.key));
  for (const m of source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(declared.has(m[1]), m[1]);
  assert.equal(manifestJson.instances, "multiple");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
});

test("Ma Chaîne Twitch ne parle jamais à Twitch elle-même : aucune adresse de Twitch, aucun fetch, aucun jeton dans son code", () => {
  assert.ok(!/fetch\s*\(|api\.twitch\.tv\/|oauth2\/|Bearer|client_secret|grant_type/.test(source.replace(/^\s*\/\/.*$/gm, "")));
  assert.ok(!fs.existsSync(`${DIR}/oauth.mjs`) && !fs.existsSync(`${DIR}/access.mjs`));
});

test("stream.live : le live en cours, avec le jeu et l'adresse de la chaîne ; vide hors ligne", async () => {
  assert.deepEqual(await def.exports["stream.live"](ctx()), [{ id: "9000", title: "Soirée", url: "https://twitch.tv/machaine", startedAt: "2030-01-01T10:00:00Z", game: "Zelda" }]);
  mod.resetCache(); tw.state.streams = [];
  assert.deepEqual(await def.exports["stream.live"](ctx()), []);
});

test("clips : affiches https Twitch uniquement, miniature non http(s) écartée, cache 10 min", async () => {
  const posters = await def.exports["maze.poster"](ctx(), { limit: 10 });
  assert.deepEqual(posters, [{ title: "Beau clip", url: "https://clips.twitch.tv/abc", image: "https://static-cdn.jtvnw.net/x.jpg", kind: "clip" }]);
  const n = tw.log.length;
  await def.exports["maze.poster"](ctx(), { limit: 10 });
  assert.equal(tw.log.length, n, "second appel servi par le cache");
});

test("social.link : le bouton de la chaîne, même SANS Connecteur ; rien si la chaîne n'est pas réglée ou invalide", async () => {
  assert.deepEqual(await def.exports["social.link"](bare({ channel: "Rascane" })), [{ label: "Twitch · rascane", url: "https://twitch.tv/rascane", icon: "twitch" }]);
  for (const bad of ["", "  ", "a", "pas valide!", "../x"]) assert.deepEqual(await def.exports["social.link"](ctx({ channel: bad })), [], JSON.stringify(bad));
});

test("sans Connecteur : bouton et lien seulement, aucun appel ; l'administration suggère d'installer un module qui offre le SERVICE (jamais un nom de module)", async () => {
  const c = bare();
  assert.deepEqual(await def.exports["stream.live"](c), []);
  assert.deepEqual(await def.exports["maze.poster"](c, {}), []);
  assert.deepEqual(await svc.channel(c), { channel: "machaine", url: "https://twitch.tv/machaine", configured: false, ready: false, missing: ["clientId", "clientSecret"] });
  const st = await svc.status(c);
  assert.deepEqual([st.known, st.live, st.error], [false, false, "config"]);
  const panel = await def.adminPanel(c);
  const s = panel.find((b) => b.type === "suggestInstall");
  assert.deepEqual([s.service, s.min], ["twitch.api", 3]);
  assert.ok(s.reason && !/connect(eur|or)|twitch-connector/i.test(s.reason), "la raison dit ce qu'il faut, pas quel module");
  assert.equal(tw.log.length, 0);
});

test("Connecteur sans application : « config », aucun appel ; social.stat dit pourquoi", async () => {
  C = connector({ settings: {} });
  const st = await svc.status(ctx());
  assert.deepEqual([st.configured, st.known, st.error], [false, false, "config"]);
  assert.deepEqual(await def.exports["stream.live"](ctx()), []);
  const stats = await def.exports["social.stat"](ctx({ trackStats: true }), { limit: 10 });
  assert.equal(stats[0].error, "auth", "sans application, pas d'autorisation de la chaîne");
  assert.equal(tw.log.length, 0);
});

test("le jeton est transmis en en-tête par le Connecteur, jamais dans l'adresse ; le secret jamais dans une réponse", async () => {
  await def.exports["stream.live"](ctx());
  const h = tw.log.find((c) => c.path === "/helix/streams");
  assert.equal(h.headers.authorization, "Bearer app_tok");
  assert.ok(!h.url.includes("app_tok") && !h.url.includes("SEC-RET"));
  const dump = JSON.stringify([await svc.status(ctx()), await svc.channel(ctx()), await def.adminPanel(ctx())]);
  assert.ok(!dump.includes("SEC-RET") && !dump.includes("app_tok"));
});

// ── Service `twitch.live` ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("service twitch.live : channel() sans réseau ; status() en direct (titre, jeu, spectateurs, début, miniature https, nom affiché) puis hors ligne", async () => {
  assert.deepEqual(await svc.channel(ctx()), { channel: "machaine", url: "https://twitch.tv/machaine", configured: true, ready: true, missing: [] });
  assert.equal(tw.log.length, 0);
  assert.deepEqual(await svc.status(ctx()), { configured: true, known: true, live: true, channel: "machaine", url: "https://twitch.tv/machaine", id: "9000", title: "Soirée", game: "Zelda", viewers: 12, startedAt: "2030-01-01T10:00:00Z", thumbnail: "https://static-cdn.jtvnw.net/previews-ttv/live_user_x-440x248.jpg", displayName: "MaChaine" });
  mod.resetCache(); tw.state.streams = [];
  assert.deepEqual(await svc.status(ctx()), { configured: true, known: true, live: false, channel: "machaine", url: "https://twitch.tv/machaine" });
  assert.deepEqual((await svc.channel(ctx({ channel: "pas valide" }))).missing, ["channel"]);
});

test("un SEUL jeton et UN SEUL appel Helix pour le service, stream.live et plusieurs consommateurs, y compris simultanés", async () => {
  const c = ctx();
  await Promise.all([svc.status(c), svc.status(c), def.exports["stream.live"](c), svc.status(ctx())]);
  await svc.status(c);
  assert.equal(tw.log.filter((x) => x.body?.grant_type === "client_credentials").length, 1);
  assert.equal(helix("streams"), 1);
});

test("status({ channel }) : une autre chaîne ; deux instances = deux chaînes, une requête chacune, un seul jeton (une application)", async () => {
  tw.state.streams = [{ login: "rascane", title: "Chez Rascane" }];
  const mine = ctx({ channel: "chaine_a" });
  assert.equal((await svc.status(mine, { channel: "Rascane" })).channel, "rascane");
  assert.equal((await svc.status(mine, { channel: "pas valide" })).channel, "chaine_a", "chaîne invalide ignorée");
  const friend = fakeCtx({ key: "tw2", settings: { channel: "rascane" }, services: { "twitch.api": C.methods } });
  const r = await svc.status(friend);
  assert.deepEqual([r.channel, r.live, r.title], ["rascane", true, "Chez Rascane"]);
  assert.equal(tw.log.filter((x) => x.body?.grant_type === "client_credentials").length, 1);
  assert.equal(tw.log.filter((x) => x.search.includes("user_login=rascane")).length, 1, "même chaîne demandée par deux instances : un appel");
});

test("erreurs : réseau coupé, 429 → jamais d'exception, erreur explicite, pas de harcèlement (cache d'erreur, pause du Connecteur)", async () => {
  tw.state.down = true;
  const r = await svc.status(ctx());
  assert.deepEqual([r.known, r.live, r.error], [false, false, "network"]);
  const n = tw.log.length;
  await svc.status(ctx());
  assert.equal(tw.log.length, n, "une seconde demande immédiate ne rappelle pas Twitch");
  mod.resetCache(); connectorModule.resetCache(); C = connector(); tw.state.down = false; tw.state.rateLimited = true; tw.state.retryAfter = 120;
  assert.equal((await svc.status(ctx())).error, "rate");
  mod.resetCache();
  const m = tw.log.length;
  assert.equal((await svc.status(ctx())).error, "rate", "même sans le cache de ce module, la pause du Connecteur tient");
  assert.equal(tw.log.length, m);
  assert.deepEqual(await def.exports["stream.live"](ctx()), [], "stream.live reste vide, sans erreur");
});

// ── Reprise depuis « Statut live » (twitch.live.adopt, status({ legacy })) ─────────────────────────────────────────────────────────────

test("adopt (depuis Statut live) : la chaîne remplit celle de l'instance si elle est vide ; l'application va au Connecteur (champs vides seulement) ; jamais une valeur", async () => {
  C = connector({ settings: {} });
  const c = ctx({ channel: "" });
  const r1 = await svc.adopt(c, { channel: "Ma_Chaine", clientId: "cid", clientSecret: "SEC-RET" });
  assert.deepEqual(r1, { adopted: ["channel", "clientId", "clientSecret"], ready: true });
  assert.ok(!JSON.stringify(r1).includes("SEC-RET"));
  assert.deepEqual(await svc.adopt(c, { channel: "Ma_Chaine", clientId: "cid", clientSecret: "SEC-RET" }), { adopted: [], ready: true }, "deuxième fois : rien");
  assert.deepEqual(await svc.adopt(c, { channel: "autre_chaine", clientId: "autre", clientSecret: "x" }), { adopted: [], ready: true }, "jamais d'écrasement");
  assert.equal((await svc.channel(c)).channel, "ma_chaine");
  assert.equal((await def.exports["social.link"](c))[0].url, "https://twitch.tv/ma_chaine");
  const own = ctx({ channel: "saisie" });
  assert.deepEqual((await svc.adopt(own, { channel: "Ma_Chaine" })).adopted, [], "chaîne saisie : intacte");
  assert.deepEqual(await svc.adopt(ctx({ channel: "" }), null), { adopted: [], ready: false });
});

test("status({ legacy }) : la chaîne d'un consommateur pas encore repris sert si l'instance n'en a pas ; ses identifiants vont au Connecteur s'il n'en a pas", async () => {
  C = connector({ settings: {} });
  const r = await svc.status(ctx({ channel: "" }), { legacy: { channel: "MaChaine", clientId: "cid", clientSecret: "SEC-RET" } });
  assert.deepEqual([r.known, r.live, r.channel, r.configured], [true, true, "machaine", true]);
  assert.equal((await C.methods.status()).ready, true);
  // le Connecteur a déjà son application : les identifiants du consommateur ne remplacent rien
  C = connector();
  await svc.status(ctx(), { legacy: { channel: "x_y_z", clientId: "autre", clientSecret: "autre" } });
  assert.equal(await C.ctx.api.store.count("twitchApp"), 0);
});

test("admin : une chaîne reprise est signalée ; « oublier » rend la main au réglage", async () => {
  const c = ctx({ channel: "" });
  await svc.adopt(c, { channel: "ma_chaine" });
  const blocks = await def.adminPanel(c);
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "forgetAdopted"));
  assert.equal((await def.adminActions.forgetAdopted(c)).redirect, "?");
  assert.equal((await svc.channel(c)).channel, null);
});

test("chaque instance répond pour SA chaîne (each) : status() et channel() sans argument, aucun « maître »", async () => {
  tw.state.streams = [{ login: "rascane" }];
  const a = fakeCtx({ key: "a", settings: { channel: "chaine_a" }, services: { "twitch.api": C.methods } });
  const b = fakeCtx({ key: "b", settings: { channel: "rascane" }, services: { "twitch.api": C.methods } });
  const [ra, rb] = await Promise.all([svc.status(a), svc.status(b)]);
  assert.deepEqual([ra.channel, ra.live, rb.channel, rb.live], ["chaine_a", false, "rascane", true]);
  assert.equal(helix("streams"), 2, "une requête par chaîne");
});

test("instance supprimée : la chaîne n'est plus proposée par défaut aux autres modules (ses autorisations restent au Connecteur)", async () => {
  await def.adminPanel(ctx());
  assert.equal((await C.methods.account({})).channel, "machaine");
  await def.hooks.onInstanceDelete(ctx());
  assert.equal((await C.methods.account({})).channel, null);
});
