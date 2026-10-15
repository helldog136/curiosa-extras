// Chaîne Twitch : followers et abonnés payants (« social.stat »), connexion du compte (flux « code d'autorisation » avec l'application Twitch de l'utilisateur).
// Aucun réseau : un faux Twitch (tests/helpers/fakeTwitch.mjs) répond à la place d'id.twitch.tv et d'api.twitch.tv.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeTwitch } from "./helpers/fakeTwitch.mjs";
import { problemsOfList } from "./helpers/socialStatContract.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/twitch-channel", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const mod = await import("../modules/twitch-channel/index.mjs");
const def = mod.default;
const callback = def.routes["oauth/callback"];
const realFetch = globalThis.fetch;
const consoleSpies = {};
const heard = [];
let tw;
beforeEach(() => {
  mod.resetCache();
  tw = fakeTwitch();
  globalThis.fetch = (u, i) => tw.fetch(u, i);
  heard.length = 0;
  for (const m of ["log", "info", "warn", "error", "debug"]) { consoleSpies[m] = console[m]; console[m] = (...a) => heard.push(a.map(String).join(" ")); }
});
afterEach(() => { globalThis.fetch = realFetch; for (const m of Object.keys(consoleSpies)) console[m] = consoleSpies[m]; });

const settingsOf = (extra = {}) => ({ channel: "MaChaine", clientId: "cid", clientSecret: "SEC-RET", trackStats: true, statsFollowers: true, statsPaying: false, ...extra });
const mk = (extra = {}, key = "tw") => fakeCtx({ key, locale: "fr", messages: fr, settings: settingsOf(extra) });
/** Le bouton « Connecter » d'un panneau : { href, label } ou null. */
const unesc = (v) => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const buttonOf = (blocks) => { const b = blocks.find((x) => x.type === "html" && x.html.includes("data-twitch-connect")); return b ? { href: unesc(/href="([^"]+)"/.exec(b.html)[1]), label: unesc(/>([^<]+)<\/a>/.exec(b.html)[1]) } : null; };
const linkOf = async (ctx) => buttonOf(await def.adminPanel(ctx))?.href;
const stat = (ctx) => def.exports["social.stat"](ctx, { limit: 50 });
const req = (url, init) => new Request(url, init);
/** Le parcours complet : le panneau donne le lien, l'utilisateur autorise chez Twitch, Twitch rappelle. */
async function connectAs(ctx, who) {
  const link = await linkOf(ctx);
  const res = await callback(req(tw.approve(link, who)), ctx);
  return { link, res };
}
const count = (pred) => tw.log.filter(pred).length;
const tokenCalls = (grant) => tw.log.filter((c) => c.path === "/oauth2/token" && c.body?.grant_type === grant);
const everything = async (ctx) => JSON.stringify([await def.adminPanel(ctx), await stat(ctx), await def.services["twitch.live"].channel(ctx), heard]);
const SECRETS = (extra = []) => ["SEC-RET", ...extra];

// ── Manifeste, réglages, textes ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("manifeste : valide, 1.3.0, fournit social.stat, déclare routes + storage, réglages sûrs par défaut (éteint tant que le compte n'est pas connecté)", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.version, "1.3.0");
  assert.ok(manifest.provides.some((p) => p.topic === "social.stat" && p.label.fr && p.label.en));
  for (const p of ["routes", "storage", "admin", "topics"]) assert.ok(manifest.permissions.includes(p), p);
  const s = Object.fromEntries(manifest.settings.map((x) => [x.key, x]));
  assert.deepEqual([s.trackStats.default, s.statsFollowers.default, s.statsPaying.default], [false, true, false]);
  assert.ok(!s.trackStats.advanced && !s.statsFollowers.advanced && !s.statsPaying.advanced, "visibles en mode simple");
  assert.equal(manifest.minCore, "0.1.14", "pas plus haut que nécessaire");
  assert.ok(!manifest.settings.some((x) => /token|jeton|access|refresh/i.test(x.key)), "aucun jeton dans les réglages");
  assert.deepEqual(manifest.offers.map((o) => [o.service, o.each]), [["twitch.live", true]]);
});

test("locales : fr et en alignées, toutes les clés utilisées par le code existent", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  const code = ["index", "connect", "helix", "oauth"].map((f) => fs.readFileSync(`${DIR}/${f}.mjs`, "utf8")).join("\n");
  for (const m of code.matchAll(/\bt\("([a-zA-Z_]+)"/g)) assert.ok(m[1] in fr, m[1]);
  for (const k of ["err_auth", "err_rate", "err_network", "err_config_affiliate", "err_config_credentials", "res_denied", "res_refused", "res_network", "res_rate", "res_expired", "res_wrongAccount", "res_scope", "stat_followers", "stat_paying"]) assert.ok(fr[k] && en[k], k);
});

test("mots simples : aucun jargon dans les textes de connexion et d'erreur, en français comme en anglais", () => {
  const JARGON = /\b(m[ée]trique|sujet|topic|api|scope|token|jeton|oauth|callback|secret key|endpoint|helix|http|json)\b/i;
  const keys = Object.keys(fr).filter((k) => /^(conn_|err_|res_|cb_|connect|connected|reconnect|morePermission|disconnect|notReadyCreds|needHttps|chooseOne|stat_|col_)/.test(k));
  assert.ok(keys.length > 20);
  for (const k of keys) for (const [l, d] of [["fr", fr], ["en", en]]) assert.ok(!JARGON.test(d[k]), `${l}.${k} : « ${d[k]} »`);
  for (const s of manifest.settings.filter((x) => ["trackStats", "statsFollowers", "statsPaying"].includes(x.key))) for (const v of [s.label.fr, s.label.en, s.help?.fr ?? "", s.help?.en ?? ""]) assert.ok(!JARGON.test(v), v);
  assert.equal(fr.connect, "Connecter ma chaîne Twitch");
  assert.equal(fr.disconnect, "Déconnecter");
  assert.match(fr.connected, /Connectée en tant que \{login\} depuis le \{date\}/);
});

// ── Panneau : guide, adresse à copier, lien d'autorisation aux portées minimales ──────────────────────────────────────────────────────

test("interrupteur éteint : aucun guide, aucun chiffre, aucune requête ; chaîne non réglée : rien", async () => {
  const off = mk({ trackStats: false });
  assert.deepEqual(await def.adminPanel(off), []);
  assert.deepEqual(await stat(off), []);
  assert.deepEqual(await stat(mk({ channel: "" })), []);
  assert.equal(tw.log.length, 0);
});

test("guide : l'adresse de retour exacte est affichée avec un bouton de copie (bloc « copy »), et le lien de connexion est unique", async () => {
  const ctx = mk();
  const blocks = await def.adminPanel(ctx);
  const copy = blocks.find((b) => b.type === "copy");
  assert.equal(copy.text, "https://example.test/m/tw/oauth/callback");
  assert.equal(blocks.filter((b) => b.type === "html" && b.html.includes("data-twitch-connect")).length, 1);
  assert.equal(buttonOf(blocks).label, "Connecter ma chaîne Twitch");
  assert.match(buttonOf(blocks).href, /^https:\/\/id\.twitch\.tv\/oauth2\/authorize\?/);
  const md = blocks.filter((b) => b.type === "markdown").map((b) => b.text).join("\n");
  assert.match(md, /dev\.twitch\.tv\/console/);
  assert.match(md, /Autoriser/);
  assert.equal(tw.log.length, 0, "afficher le guide n'appelle pas Twitch");
  // une adresse de site avec « / » final ou une autre instance : l'adresse suit
  assert.equal((await def.adminPanel(fakeCtx({ key: "autre", siteUrl: "https://site.test/", locale: "fr", messages: fr, settings: settingsOf() }))).find((b) => b.type === "copy").text, "https://site.test/m/autre/oauth/callback");
});

test("lien de connexion : application de l'utilisateur, adresse de retour exacte, state aléatoire, portées MINIMALES selon ce qui est coché", async () => {
  const cases = [
    [{ statsFollowers: true, statsPaying: false }, ["moderator:read:followers"]],
    [{ statsFollowers: false, statsPaying: true }, ["channel:read:subscriptions"]],
    [{ statsFollowers: true, statsPaying: true }, ["channel:read:subscriptions", "moderator:read:followers"]],
  ];
  const states = new Set();
  for (const [extra, scopes] of cases) {
    const u = new URL(await linkOf(mk(extra)));
    assert.equal(u.origin + u.pathname, "https://id.twitch.tv/oauth2/authorize");
    assert.equal(u.searchParams.get("client_id"), "cid");
    assert.equal(u.searchParams.get("redirect_uri"), "https://example.test/m/tw/oauth/callback");
    assert.equal(u.searchParams.get("response_type"), "code");
    assert.deepEqual(u.searchParams.get("scope").split(" ").sort(), scopes);
    assert.match(u.searchParams.get("state"), /^[A-Za-z0-9_-]{43}$/, "256 bits aléatoires");
    assert.ok(!u.href.includes("SEC-RET"), "le secret ne quitte jamais le serveur par le navigateur");
    states.add(u.searchParams.get("state"));
  }
  assert.equal(states.size, 3, "un state neuf par instance de panneau");
});

test("le state est réutilisé tant qu'il est valable et identique (plusieurs rechargements), renouvelé si ce qui est coché change ; un seul en attente", async () => {
  const ctx = mk();
  const a = await linkOf(ctx), b = await linkOf(ctx);
  assert.equal(a, b);
  assert.equal(await ctx.api.store.count("twitchPending"), 1);
  const settings = { channel: "MaChaine", clientId: "cid", clientSecret: "SEC-RET", trackStats: true, statsFollowers: true, statsPaying: true };
  const ctx2 = fakeCtx({ key: "tw", locale: "fr", messages: fr, settings }); ctx2.api.store = ctx.api.store;
  assert.notEqual(await linkOf(ctx2), a);
  assert.equal(await ctx.api.store.count("twitchPending"), 1, "l'ancien est retiré");
});

test("sans identifiants, sans case cochée, ou site en http : pas de lien, un message qui dit quoi faire", async () => {
  const blocks = async (c) => await def.adminPanel(c);
  const noLink = async (c) => { const b = await blocks(c); assert.equal(buttonOf(b), null); return b.find((x) => x.type === "banner")?.text; };
  assert.equal(await noLink(mk({ clientSecret: "" })), fr.notReadyCreds);
  assert.equal(await noLink(mk({ clientId: "" })), fr.notReadyCreds);
  assert.equal(await noLink(mk({ statsFollowers: false, statsPaying: false })), fr.chooseOne);
  assert.equal(await noLink(fakeCtx({ key: "tw", siteUrl: "http://exemple.org", locale: "fr", messages: fr, settings: settingsOf() })), fr.needHttps);
  assert.ok(buttonOf(await blocks(fakeCtx({ key: "tw", siteUrl: "http://localhost:3000", locale: "fr", messages: fr, settings: settingsOf() }))), "localhost est accepté par Twitch pour les essais");
});

// ── Rappel : state valide / expiré / rejoué / forgé / autre instance ────────────────────────────────────────────────────────────────

test("connexion réussie : le code est échangé avec l'application de l'utilisateur, le compte est vérifié, on revient à la page d'admin de l'instance", async () => {
  const ctx = mk();
  const { link, res } = await connectAs(ctx);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/admin/instances/id-tw", "toujours la page d'admin de cette instance");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(res.headers.get("cache-control"), "no-store");
  const ex = tokenCalls("authorization_code");
  assert.equal(ex.length, 1);
  assert.deepEqual(ex[0].body, { client_id: "cid", client_secret: "SEC-RET", code: ex[0].body.code, grant_type: "authorization_code", redirect_uri: "https://example.test/m/tw/oauth/callback" });
  assert.equal(await ctx.api.store.count("twitchPending"), 0, "le state est consommé");
  const panel = await def.adminPanel(ctx);
  const banner = panel.find((b) => b.type === "banner");
  assert.match(banner.text, /^Connectée en tant que machaine depuis le \d{1,2}(er)? \p{L}+ \d{4}\.$/u);
  assert.ok(panel.some((b) => b.type === "adminForm" && b.action === "disconnect" && b.submitLabel === "Déconnecter"));
  assert.equal(buttonOf(panel), null, "plus de bouton quand c'est connecté");
  assert.ok(link.includes("state="));
});

test("state rejoué : le même lien ne sert qu'une fois (réponse 400, rien n'est écrit, Twitch n'est pas rappelé)", async () => {
  const ctx = mk();
  const { link } = await connectAs(ctx);
  const again = tw.approve(link);   // Twitch donnerait un nouveau code, mais le state a été consommé
  const before = tw.log.length;
  const res = await callback(req(again), ctx);
  assert.equal(res.status, 400);
  assert.equal(tw.log.length, before);
  assert.equal(await ctx.api.store.count("twitchResult"), 0);
});

test("state forgé, vide, mal formé, d'un autre format : 400 identique, aucune écriture, aucun appel à Twitch ; au-delà de 20 essais : 429", async () => {
  const ctx = mk();
  await linkOf(ctx);
  const before = await ctx.api.store.count("twitchPending");
  const url = (q) => `https://example.test/m/tw/oauth/callback?${q}`;
  const bodies = new Set();
  for (const q of ["code=abcdefghijkl&state=" + "A".repeat(43), "code=abcdefghijkl", "code=abcdefghijkl&state=", "code=abcdefghijkl&state=" + "A".repeat(500), "code=abcdefghijkl&state=%00%0A<script>", "state[]=x&code=abcdefghijkl", ""]) {
    const res = await callback(req(url(q)), ctx);
    assert.equal(res.status, 400, q);
    bodies.add(await res.text());
  }
  assert.equal(bodies.size, 1, "même réponse quel que soit le motif");
  assert.equal(tw.log.length, 0);
  assert.equal(await ctx.api.store.count("twitchPending"), before);
  assert.equal(await ctx.api.store.count("twitchConnection"), 0);
  assert.equal(await ctx.api.store.count("twitchResult"), 0, "un inconnu ne peut pas faire apparaître un message dans l'admin");
  for (let i = 0; i < 20; i++) await callback(req(url("state=zzz")), ctx);
  assert.equal((await callback(req(url("state=zzz")), ctx)).status, 429);
});

test("state d'une AUTRE instance : refusé (chaque instance ne connaît que ses propres états)", async () => {
  const a = mk({}, "tw"), b = mk({ channel: "autre" }, "tw2");
  tw.state.redirects.add("https://example.test/m/tw2/oauth/callback");
  const linkA = await linkOf(a);
  const state = new URL(linkA).searchParams.get("state");
  const res = await callback(req(`https://example.test/m/tw2/oauth/callback?code=abcdefghijkl&state=${state}`), b);
  assert.equal(res.status, 400);
  assert.equal(tokenCalls("authorization_code").length, 0);
  assert.equal(await a.api.store.count("twitchPending"), 1, "l'état de A est intact");
});

test("state expiré (10 minutes) : pas de connexion, message « le lien avait expiré », l'état est consommé", async () => {
  const ctx = mk();
  const link = await linkOf(ctx);
  const doc = (await ctx.api.store.list("twitchPending"))[0];
  assert.ok(doc.data.expiresAt - doc.data.createdAt === 10 * 60_000);
  await ctx.api.store.update(doc.id, { ...doc.data, expiresAt: Date.now() - 1 });
  const res = await callback(req(tw.approve(link)), ctx);
  assert.equal(res.status, 303);
  assert.equal(tokenCalls("authorization_code").length, 0, "un état expiré n'ouvre rien");
  assert.equal(await ctx.api.store.count("twitchConnection"), 0);
  assert.equal(await ctx.api.store.count("twitchPending"), 0);
  assert.equal((await def.adminPanel(ctx)).find((b) => b.type === "banner").text, fr.res_expired);
});

test("rappel : seule la méthode GET, la redirection ne vient jamais de la requête (pas de redirection ouverte)", async () => {
  const ctx = mk();
  const { link } = await connectAs(mk());
  assert.equal((await callback(req("https://example.test/m/tw/oauth/callback", { method: "POST", body: "x" }), ctx)).status, 405);
  const ctx2 = mk();
  const l2 = await linkOf(ctx2);
  const evil = tw.approve(l2) + "&redirect=https://evil.example/&next=https://evil.example/&redirect_uri=https://evil.example/&return_to=//evil.example";
  const res = await callback(req(evil), ctx2);
  assert.equal(res.headers.get("location"), "/admin/instances/id-tw");
  assert.ok(link);
});

test("l'application de Twitch redirige exactement vers l'adresse enregistrée : une autre adresse est refusée par Twitch lui-même (faux Twitch), et notre échange renvoie la même", async () => {
  const ctx = mk();
  const link = await linkOf(ctx);
  tw.state.redirects.clear();
  assert.throws(() => tw.approve(link), /redirect_uri non enregistrée/);
});

test("refus de l'utilisateur chez Twitch, erreur de Twitch, code absent ou piégé : message humain, aucun jeton, aucun échange pour un code invalide", async () => {
  for (const [qs, expected] of [["error=access_denied&error_description=The+user+denied+you+access", "res_denied"], ["error=server_error", "res_refused"], ["", "res_refused"], ["code=%3Cscript%3E", "res_refused"]]) {
    const ctx = mk();
    const link = await linkOf(ctx);
    const state = new URL(link).searchParams.get("state");
    const res = await callback(req(`https://example.test/m/tw/oauth/callback?${qs}${qs ? "&" : ""}state=${state}`), ctx);
    assert.equal(res.status, 303);
    assert.equal(await ctx.api.store.count("twitchConnection"), 0, expected);
    assert.equal((await def.adminPanel(ctx)).find((b) => b.type === "banner").text, fr[expected], expected);
  }
  assert.equal(tokenCalls("authorization_code").length, 0);
});

test("mauvais compte Twitch : refusé, les jetons obtenus sont aussitôt révoqués, le message dit quel compte et quoi faire", async () => {
  const ctx = mk();
  const { res } = await connectAs(ctx, { login: "quelquun_dautre", userId: "999" });
  assert.equal(res.status, 303);
  assert.equal(await ctx.api.store.count("twitchConnection"), 0);
  assert.equal(tw.revoked.length, 2, "accès + renouvellement révoqués");
  assert.match((await def.adminPanel(ctx)).find((b) => b.type === "banner").text, /quelquun_dautre.*Reconnectez-vous avec le bon compte/);
});

test("autorisation incomplète chez Twitch (case décochée) : refusé et révoqué ; mauvais secret : refus humain, rien de stocké", async () => {
  const ctx = mk({ statsPaying: true });
  await connectAs(ctx, { dropScopes: ["channel:read:subscriptions"] });
  assert.equal(await ctx.api.store.count("twitchConnection"), 0);
  assert.equal((await def.adminPanel(ctx)).find((b) => b.type === "banner").text, fr.res_scope);
  assert.ok(tw.revoked.length >= 2);
  const wrong = mk({ clientSecret: "faux" });
  const link = await linkOf(wrong);
  const res = await callback(req(tw.approve(link)), wrong);
  assert.equal(res.status, 303);
  assert.equal(await wrong.api.store.count("twitchConnection"), 0);
  assert.equal((await def.adminPanel(wrong)).find((b) => b.type === "banner").text, fr.res_refused);
});

test("Twitch injoignable pendant la connexion : message « ne répond pas », on peut recommencer", async () => {
  const ctx = mk();
  const link = await linkOf(ctx);
  const back = tw.approve(link);
  tw.state.down = true;
  await callback(req(back), ctx);
  assert.equal((await def.adminPanel(ctx)).find((b) => b.type === "banner").text, fr.res_network);
  tw.state.down = false;
  const { res } = await connectAs(ctx);
  assert.equal(res.status, 303);
  assert.equal(await ctx.api.store.count("twitchConnection"), 1);
  assert.equal((await def.adminPanel(ctx)).filter((b) => b.type === "banner").length, 1, "plus de message d'erreur une fois connecté");
});

test("une instance = une connexion : se reconnecter remplace la précédente (une seule donnée), l'ancienne est révoquée", async () => {
  const ctx = mk();
  await connectAs(ctx);
  const doc = (await ctx.api.store.list("twitchConnection"))[0];
  const first = doc.data.access;
  await ctx.api.store.update(doc.id, { ...doc.data, status: "reconnect" });   // Twitch ne reconnaît plus l'autorisation : le bouton réapparaît
  mod.resetCache();
  await connectAs(ctx);
  assert.equal(await ctx.api.store.count("twitchConnection"), 1);
  assert.ok(tw.revoked.includes(first));
});

// ── Les chiffres ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("connecté : followers (et abonnés payants si coché) au bon format social.stat, valeur entière, jamais de jeton", async () => {
  const ctx = mk({ statsPaying: true });
  await connectAs(ctx);
  const items = await stat(ctx);
  assert.deepEqual(problemsOfList(items, { module: "twitch-channel", platform: "twitch" }), []);
  const byMetric = Object.fromEntries(items.map((i) => [i.metric, i]));
  assert.equal(byMetric.followers.value, 1234);
  assert.equal(byMetric.paying.value, 56);
  assert.equal(byMetric.followers.id, "twitch-channel:tw:followers");
  assert.deepEqual([byMetric.followers.label, byMetric.paying.label], ["Followers Twitch", "Abonnés payants Twitch"]);
  assert.deepEqual([byMetric.followers.account, byMetric.followers.accountKey, byMetric.followers.url], ["machaine", "tw", "https://twitch.tv/machaine"]);
  const h = tw.log.find((c) => c.path === "/helix/channels/followers");
  assert.equal(new URL(h.url).searchParams.get("broadcaster_id"), "777");
  assert.match(h.headers.Authorization, /^Bearer at_/);
  assert.ok(!h.url.includes("at_"), "jamais le jeton dans l'adresse");
});

test("seuls les chiffres cochés sont lus : followers seul → une requête, pas d'abonnés ; abonnés seuls → l'inverse", async () => {
  const a = mk();
  await connectAs(a);
  assert.deepEqual((await stat(a)).map((i) => i.metric), ["followers"]);
  assert.equal(count((c) => c.path === "/helix/subscriptions"), 0);
  mod.resetCache(); tw = fakeTwitch(); globalThis.fetch = (u, i) => tw.fetch(u, i);
  const b = mk({ statsFollowers: false, statsPaying: true });
  await connectAs(b);
  assert.deepEqual((await stat(b)).map((i) => i.metric), ["paying"]);
  assert.equal(count((c) => c.path === "/helix/channels/followers"), 0);
});

test("pas connecté : error « auth » sans valeur et sans appel à Twitch ; identifiants manquants : « config »", async () => {
  const ctx = mk();
  const items = await stat(ctx);
  assert.deepEqual(problemsOfList(items, { module: "twitch-channel" }), []);
  assert.deepEqual(items.map((i) => [i.metric, i.error, "value" in i]), [["followers", "auth", false]]);
  assert.equal(tw.log.length, 0);
  assert.deepEqual((await stat(mk({ clientSecret: "" }))).map((i) => i.error), ["config"]);
});

test("chiffres : un appel par chaîne et par statistique, même simultanés ; le cache évite de rappeler Twitch", async () => {
  const ctx = mk({ statsPaying: true });
  await connectAs(ctx);
  mod.resetCache();   // repart d'un cache vide (la connexion reste dans le stockage)
  await Promise.all([stat(ctx), stat(ctx), stat(ctx)]);
  await stat(ctx);
  assert.equal(count((c) => c.path === "/helix/channels/followers"), 1);
  assert.equal(count((c) => c.path === "/helix/subscriptions"), 1);
});

test("abonnés payants : une chaîne non affiliée (403) donne « config » avec le message simple ; les followers restent servis", async () => {
  tw.state.affiliate = false;
  const ctx = mk({ statsPaying: true });
  await connectAs(ctx);
  const items = await stat(ctx);
  assert.deepEqual(problemsOfList(items, { module: "twitch-channel" }), []);
  assert.equal(items.find((i) => i.metric === "followers").value, 1234);
  const paying = items.find((i) => i.metric === "paying");
  assert.deepEqual([paying.error, "value" in paying], ["config", false]);
  const table = (await def.adminPanel(ctx)).find((b) => b.type === "table");
  assert.ok(table.rows.some((r) => r[1] === "Les abonnements ne sont disponibles que pour les affiliés et partenaires Twitch."));
});

test("erreurs de Twitch : 429 → rate, réseau coupé → network, jamais de valeur, pas de harcèlement (cache d'erreur), reprise ensuite", async () => {
  const ctx = mk();
  await connectAs(ctx);
  mod.resetCache();
  tw.state.rateLimited = true;
  let [it] = await stat(ctx);
  assert.deepEqual([it.error, "value" in it], ["rate", false]);
  await stat(ctx);
  assert.equal(count((c) => c.path === "/helix/channels/followers"), 1, "un seul essai pendant le délai");
  mod.resetCache(); tw.state.rateLimited = false; tw.state.down = true;
  [it] = await stat(ctx);
  assert.deepEqual([it.error, "value" in it], ["network", false]);
  mod.resetCache(); tw.state.down = false;
  [it] = await stat(ctx);
  assert.equal(it.value, 1234, "dès que Twitch répond de nouveau");
});

test("jamais de valeur périmée : un chiffre déjà lu n'est plus servi une fois son délai passé, même si Twitch tombe", async () => {
  const realNow = Date.now;
  try {
    const ctx = mk();
    await connectAs(ctx);
    assert.equal((await stat(ctx))[0].value, 1234);
    const t0 = realNow();
    Date.now = () => t0 + 6 * 60_000;   // 6 minutes plus tard (délai : 5)
    tw.state.down = true;
    const [it] = await stat(ctx);
    assert.deepEqual([it.error, "value" in it], ["network", false]);
  } finally { Date.now = realNow; }
});

// ── Jetons : renouvellement automatique, fusionné, échec → « à reconnecter » ─────────────────────────────────────────────────────

test("jeton proche de l'expiration : renouvelé AVANT l'appel, une seule fois même pour plusieurs appels simultanés, les nouveaux jetons sont gardés", async () => {
  tw.state.accessTtl = 30;   // expire dans moins de 2 minutes : à renouveler
  const ctx = mk({ statsPaying: true });
  await connectAs(ctx);
  const before = (await ctx.api.store.list("twitchConnection"))[0].data;
  mod.resetCache();
  await Promise.all([stat(ctx), stat(ctx), stat(ctx), def.adminPanel(ctx)]);
  assert.equal(tokenCalls("refresh_token").length, 1, "un seul renouvellement pour tous les appels simultanés");
  const after = (await ctx.api.store.list("twitchConnection"))[0].data;
  assert.notEqual(after.access, before.access);
  assert.notEqual(after.refresh, before.refresh, "le nouveau jeton de renouvellement remplace l'ancien");
  assert.equal(after.status, "ok");
  const body = tokenCalls("refresh_token")[0].body;
  assert.deepEqual(Object.keys(body).sort(), ["client_id", "client_secret", "grant_type", "refresh_token"]);
  assert.equal(body.refresh_token, before.refresh);
  assert.ok((await stat(ctx)).every((i) => !i.error));
});

test("401 reçu de Twitch (jeton révoqué côté Twitch) : UN renouvellement puis UNE nouvelle tentative, fusionnés entre appels simultanés", async () => {
  const ctx = mk({ statsPaying: true });
  await connectAs(ctx);
  tw.expireAccess((await ctx.api.store.list("twitchConnection"))[0].data.access);
  mod.resetCache();
  const items = await stat(ctx);
  assert.ok(items.every((i) => !i.error && Number.isInteger(i.value)), JSON.stringify(items));
  assert.equal(tokenCalls("refresh_token").length, 1, "followers et abonnés en même temps : un seul renouvellement");
  assert.equal(count((c) => c.path === "/helix/channels/followers"), 2, "refusé puis accepté, pas plus");
});

test("renouvellement refusé par Twitch : état « À reconnecter » visible avec le bouton, error auth sans valeur, aucune boucle de tentatives", async () => {
  tw.state.accessTtl = 30;
  const ctx = mk();
  await connectAs(ctx);
  mod.resetCache();
  tw.state.refreshFails = true;
  const [it] = await stat(ctx);
  assert.deepEqual([it.error, "value" in it], ["auth", false]);
  assert.equal((await ctx.api.store.list("twitchConnection"))[0].data.status, "reconnect");
  mod.resetCache();
  await stat(ctx); await stat(ctx);
  assert.equal(tokenCalls("refresh_token").length, 1, "plus de tentative tant qu'on n'a pas reconnecté");
  const panel = await def.adminPanel(ctx);
  assert.equal(panel.find((b) => b.type === "banner").text, fr.reconnect);
  assert.equal(buttonOf(panel).label, "Connecter ma chaîne Twitch");
  assert.ok(panel.some((b) => b.type === "adminForm" && b.action === "disconnect"));
  tw.state.refreshFails = false;
  await connectAs(ctx);   // reconnexion : tout repart
  mod.resetCache();
  assert.equal((await stat(ctx))[0].value, 1234);
  assert.equal((await ctx.api.store.list("twitchConnection"))[0].data.status, "ok");
});

test("renouvellement impossible faute de réseau : pas d'état « À reconnecter » (c'est passager), error network", async () => {
  tw.state.accessTtl = 30;
  const ctx = mk();
  await connectAs(ctx);
  mod.resetCache(); tw.state.down = true;
  assert.equal((await stat(ctx))[0].error, "network");
  assert.equal((await ctx.api.store.list("twitchConnection"))[0].data.status, "ok");
});

test("on ajoute une statistique après coup : « il faut autoriser de nouveau », la statistique manquante est en error auth, l'autre continue", async () => {
  const ctx = mk();
  await connectAs(ctx);
  const settings = { channel: "MaChaine", clientId: "cid", clientSecret: "SEC-RET", trackStats: true, statsFollowers: true, statsPaying: true };
  const more = fakeCtx({ key: "tw", locale: "fr", messages: fr, settings }); more.api.store = ctx.api.store;
  const items = await stat(more);
  assert.deepEqual(items.map((i) => [i.metric, i.error ?? i.value]), [["followers", 1234], ["paying", "auth"]]);
  const panel = await def.adminPanel(more);
  assert.equal(panel.find((b) => b.type === "banner").text, fr.morePermission);
  const u = new URL(buttonOf(panel).href);
  assert.deepEqual(u.searchParams.get("scope").split(" ").sort(), ["channel:read:subscriptions", "moderator:read:followers"]);
});

test("l'application Twitch change (autre client id) : l'ancienne autorisation n'est plus utilisée, « À reconnecter »", async () => {
  const ctx = mk();
  await connectAs(ctx);
  const other = fakeCtx({ key: "tw", locale: "fr", messages: fr, settings: settingsOf({ clientId: "autre-app" }) }); other.api.store = ctx.api.store;
  mod.resetCache();
  const before = tw.log.length;
  assert.equal((await stat(other))[0].error, "auth");
  assert.equal(tw.log.length, before);
  assert.equal((await def.adminPanel(other)).find((b) => b.type === "banner").text, fr.reconnect);
});

// ── Déconnexion ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("Déconnecter : les deux jetons sont révoqués chez Twitch (avec le client id), puis effacés ; les chiffres redeviennent « auth »", async () => {
  const ctx = mk();
  await connectAs(ctx);
  const d = (await ctx.api.store.list("twitchConnection"))[0].data;
  const r = await def.adminActions.disconnect(ctx);
  assert.deepEqual([r.ok, r.redirect], [fr.disconnected, "?"]);
  const calls = tw.log.filter((c) => c.path === "/oauth2/revoke");
  assert.deepEqual(calls.map((c) => c.body).sort((a, b) => a.token.localeCompare(b.token)), [{ client_id: "cid", token: d.access }, { client_id: "cid", token: d.refresh }].sort((a, b) => a.token.localeCompare(b.token)));
  assert.equal(await ctx.api.store.count("twitchConnection"), 0);
  assert.equal(await ctx.api.store.count("twitchPending"), 0);
  mod.resetCache();
  assert.equal((await stat(ctx))[0].error, "auth");
  assert.ok(buttonOf(await def.adminPanel(ctx)), "on peut reconnecter");
});

test("Déconnecter sans pouvoir joindre Twitch : effacé ici quand même, et le message dit comment retirer l'accès chez Twitch", async () => {
  const ctx = mk();
  await connectAs(ctx);
  tw.state.offlineRevoke = true;
  const r = await def.adminActions.disconnect(ctx);
  assert.equal(r.ok, fr.disconnectedOffline);
  assert.match(r.ok, /Paramètres/);
  assert.equal(await ctx.api.store.count("twitchConnection"), 0);
});

// ── Secrets : jamais affichés, renvoyés ni journalisés ───────────────────────────────────────────────────────────────────────────

test("jetons, secret et code jamais dans le panneau, les chiffres, les services, les réponses du rappel ni les journaux", async () => {
  const ctx = mk({ statsPaying: true });
  const { res, link } = await connectAs(ctx);
  const stored = (await ctx.api.store.list("twitchConnection"))[0].data;
  const code = tokenCalls("authorization_code")[0].body.code;
  const secrets = SECRETS([stored.access, stored.refresh, code]);
  const dump = await everything(ctx);
  const resp = JSON.stringify([res.status, [...res.headers], await res.text()]);
  for (const s of secrets) { assert.ok(!dump.includes(s), `dump contient ${s}`); assert.ok(!resp.includes(s), `réponse contient ${s}`); }
  // le state, lui, n'existait que dans le lien du panneau (réservé aux administrateurs) : une fois la connexion faite il est consommé, et il ne se retrouve nulle part
  const state = new URL(link).searchParams.get("state");
  assert.equal(await ctx.api.store.count("twitchPending"), 0);
  assert.ok(!dump.includes(state) && !resp.includes(state));
  for (const r of [await def.services["twitch.live"].status(ctx), await def.services["twitch.live"].channel(ctx), await def.exports["stream.live"](ctx), await def.exports["social.link"](ctx)]) for (const s of secrets) assert.ok(!JSON.stringify(r).includes(s));
  // les échecs ne les mettent pas non plus dans les erreurs ni les journaux
  tw.state.down = true; mod.resetCache();
  const failing = JSON.stringify([await stat(ctx), await def.adminPanel(ctx), heard]);
  for (const s of secrets) assert.ok(!failing.includes(s));
  assert.deepEqual(heard.filter((l) => secrets.some((s) => l.includes(s))), []);
});

test("jetons uniquement dans le stockage privé de l'instance : ni réglage, ni autre collection ; le manifeste ne déclare aucun réglage de jeton", async () => {
  const ctx = mk();
  await connectAs(ctx);
  const all = {};
  for (const c of ["adopted", "borrowed", "twitchPending", "twitchResult", "twitchConnection"]) all[c] = await ctx.api.store.count(c);
  assert.equal(all.twitchConnection, 1);
  assert.equal(all.adopted + all.borrowed + all.twitchResult, 0);
  const code = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
  assert.ok(!/console\.(log|info|warn|error|debug)/.test(code), "le module n'écrit jamais dans les journaux");
  assert.ok(!/localStorage|document\.cookie|Set-Cookie/i.test(code));
  // un autre module n'a aucun moyen de lire ce stockage : pas de service, d'export ni d'outil qui rende un jeton
  assert.ok(!(manifest.mcp ?? []).length);
  for (const o of manifest.offers) assert.ok(!/token|jeton|access|refresh/i.test(JSON.stringify(o.readOnly ?? [])));
  assert.deepEqual(Object.keys(def.services["twitch.live"]).sort(), ["adopt", "channel", "status"]);
});

test("deux instances (deux chaînes) : chacune sa connexion, ses états, ses chiffres ; le stockage de l'une ne contient rien de l'autre", async () => {
  const a = mk({}, "tw"), b = mk({ channel: "rascane" }, "rasc");
  tw.state.redirects.add("https://example.test/m/rasc/oauth/callback");
  await connectAs(a);
  assert.equal((await stat(b))[0].error, "auth", "B n'est pas connectée du seul fait que A l'est");
  await connectAs(b, { login: "rascane", userId: "888" });
  const [sa, sb] = [(await a.api.store.list("twitchConnection"))[0].data, (await b.api.store.list("twitchConnection"))[0].data];
  assert.notEqual(sa.access, sb.access);
  assert.deepEqual([sa.login, sb.login], ["machaine", "rascane"]);
  assert.equal(JSON.stringify(await a.api.store.list("twitchConnection")).includes(sb.access), false);
  mod.resetCache();
  assert.deepEqual([(await stat(a))[0].account, (await stat(b))[0].account], ["machaine", "rascane"]);
});

test("identifiants partagés entre instances : la connexion reste propre à l'instance, mais l'application (client id, secret) est celle partagée", async () => {
  const donor = mk({}, "tw");
  await def.services["twitch.live"].channel(donor);   // « prête » ses identifiants en mémoire
  tw.state.redirects.add("https://example.test/m/rasc/oauth/callback");
  const friend = fakeCtx({ key: "rasc", locale: "fr", messages: fr, settings: { channel: "rascane", useCredentialsOf: "machaine", trackStats: true, statsFollowers: true } });
  const { res } = await connectAs(friend, { login: "rascane", userId: "888" });
  assert.equal(res.status, 303);
  assert.equal(tokenCalls("authorization_code")[0].body.client_id, "cid");
  assert.equal(await friend.api.store.count("twitchConnection"), 1);
  assert.equal(await donor.api.store.count("twitchConnection"), 0);
});

test("les caches existants restent valables : une requête de live par chaîne, un seul jeton d'application, quel que soit le nombre de chiffres suivis", async () => {
  const ctx = mk({ statsPaying: true });
  await connectAs(ctx);
  await Promise.all([stat(ctx), def.services["twitch.live"].status(ctx), def.exports["stream.live"](ctx)]);
  assert.equal(count((c) => c.path === "/oauth2/token" && c.body.grant_type === "client_credentials"), 1);
  assert.equal(count((c) => c.path === "/helix/streams"), 1, "une seule demande de live par chaîne pour le service et stream.live");
});
