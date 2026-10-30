// Ma Chaîne Twitch 2.2.0 : deux ÉLÉMENTS pour les pages d'overlay (cœur 0.5.0, docs/OVERLAY-ELEMENTS.md) : « Followers et abonnements » (stats) et « Pastille En direct » (live).
// Le module n'a pas d'overlay à lui : ces éléments n'existent que dans les pages d'overlay. Ce fichier vérifie le manifeste, l'adresse (code secret côté serveur), la page, et SURTOUT que
// rien n'est montré que la personne propriétaire n'a pas autorisé (réglages « Suivre mes statistiques », « Compter mes followers », « Compter mes abonnements payants »),
// qu'un chiffre manquant n'est jamais inventé, et que plusieurs pages d'overlay peuvent lire le même élément en même temps.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeTwitch } from "./helpers/fakeTwitch.mjs";
import { connector, connectorModule, connectorCallback } from "./helpers/twitchConnector.mjs";
import { parseManifest } from "@/core/modules/manifest";
import { parseAddress, finalAddress } from "@/core/overlays/address";

const core = path.resolve(process.env.CURIOSA_DIR ?? process.cwd());
const { assertMultiReaders } = await import(pathToFileURL(path.join(core, "testsupport/index.mjs")).href);
const DIR = new URL("../modules/twitch-channel", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const mod = await import("../modules/twitch-channel/index.mjs");
const def = mod.default;
const OLD = "https://example.test/m/tw/oauth/callback";
const realFetch = globalThis.fetch;
let tw, C;
beforeEach(() => {
  mod.resetCache(); connectorModule.resetCache();
  tw = fakeTwitch({ redirects: new Set([OLD, connectorCallback()]), streams: [{ login: "machaine", title: "Soirée", game: "Zelda", viewers: 12, startedAt: "2030-01-01T10:00:00Z", name: "MaChaine" }] });
  globalThis.fetch = (u, i) => tw.fetch(u, i);
  C = connector();
});
afterEach(() => { globalThis.fetch = realFetch; });

const settingsOf = (extra = {}) => ({ channel: "MaChaine", trackStats: true, statsFollowers: true, statsPaying: true, ...extra });
const mk = (extra = {}, o = {}) => fakeCtx({ key: "tw", locale: "fr", messages: fr, settings: settingsOf(extra), services: { "twitch.api": C.methods }, ...o });
const unesc = (v) => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** La chaîne est connectée à Twitch (avec les deux autorisations) comme la personne propriétaire le ferait. */
async function connect(ctx) {
  const blocks = await def.adminPanel(ctx);
  const b = blocks.find((x) => x.type === "html" && x.html.includes("data-twitch-connect"));
  assert.ok(b, "bouton « Connecter ma chaîne Twitch » attendu");
  await C.callback(new Request(tw.approve(unesc(/href="([^"]+)"/.exec(b.html)[1]), {})));
}
const count = (pred) => tw.log.filter(pred).length;
const helixCalls = (p) => count((c) => c.path === `/helix/${p}`);
const STYLE = { text: "light", background: "transparent", corners: "round" };
const request = (element, over = {}) => ({ element, fit: "fluid", width: 900, height: 300, style: STYLE, options: {}, lang: "fr", ...over });
const flagsQuery = (o = {}) => new URLSearchParams(Object.entries({ "ov-fit": "fluid", "ov-w": "900", "ov-h": "300", "ov-text": "light", "ov-surface": "transparent", "ov-corners": "round", ...o }));
const call = async (ctx, slug, { data = true, k, extra = {}, method = "GET" } = {}) => {
  const key = k ?? new URL(`https://x.test${(await def.overlayElements[slug](ctx, request(slug))).url}`).searchParams.get("k");
  const q = flagsQuery({ k: key, ...extra });
  ctx.params = { slug };
  return def.routes[data ? "element-data/:slug" : "element/:slug"](new Request(`https://example.test/m/tw/element${data ? "-data" : ""}/${slug}?${q}`, { method }), ctx);
};
const dataOf = async (ctx, slug, extra) => (await call(ctx, slug, { extra })).json();

/* ───────────── Manifeste et textes ───────────── */

test("manifeste : valide ; 2.2.0, minCore 0.5.0 ; deux éléments fluides (stats, live) qui suivent le style, avec contenu d'exemple ; options minimales ; chaque élément a sa fonction", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.version, "2.2.0"); assert.equal(manifest.minCore, "0.5.0");
  assert.deepEqual(manifest.overlayElements.map((e) => [e.id, e.fit]), [["stats", "fluid"], ["live", "fluid"]]);
  assert.deepEqual(Object.keys(def.overlayElements), manifest.overlayElements.map((e) => e.id));
  for (const e of manifest.overlayElements) {
    assert.ok(e.label.fr && e.label.en && e.description.fr && e.description.en, e.id);
    assert.equal(e.followsStyle, true); assert.equal(e.demo, true);
    assert.ok(e.ratios.min <= 400 / 600 && e.ratios.max >= 1600 / 400, `${e.id} : les cadres 400×600, 900×300 et 1600×400 sont dans la plage`);
    assert.ok(e.minSize.width <= 400 && e.minSize.height <= 300);
    assert.ok(e.options.length <= 2 && e.options.every((o) => o.type === "boolean" && o.label.fr && o.label.en), `${e.id} : jeu d'options minimal`);
  }
  assert.deepEqual(manifest.overlayElements[0].options.map((o) => [o.id, o.default]), [["followers", true], ["paying", true]]);
  assert.deepEqual(manifest.overlayElements[1].options.map((o) => [o.id, o.default]), [["game", false], ["offline", false]]);
  assert.ok(manifest.overlayElements[0].options.every((o) => /réglages/.test(o.help.fr) && /settings/.test(o.help.en)), "l'aide dit que les réglages décident");
  assert.ok(!/\bfluid\b|iframe|overlay\b/i.test(JSON.stringify(manifest.overlayElements.map((e) => [e.label.fr, e.description.fr, ...e.options.map((o) => o.label.fr)]))));
  assert.equal(manifest.instances, "multiple");
  assert.ok(manifest.permissions.includes("routes") && manifest.permissions.includes("storage"));
});

test("textes : parité FR/EN, clés de l'élément présentes, vouvoiement", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of ["ov_followers", "ov_paying", "ov_live", "ov_offline", "ov_demoGame"]) assert.ok(fr[k] && en[k], k);
  const src = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
  for (const m of src.matchAll(/ctx\.t\("(ov_[A-Za-z]+)"/g)) assert.ok(m[1] in en, m[1]);
  assert.ok(!/\btu\b|\bton\b|\bta\b|\btes\b/i.test(JSON.stringify(manifest.overlayElements.map((e) => [e.description.fr, ...e.options.map((o) => [o.label.fr, o.help?.fr])]))));
});

/* ───────────── Adresse et accès ───────────── */

test("adresse de l'élément : un chemin du site accepté par le cœur, avec un code secret propre au module ajouté côté serveur ; stable, propre à chaque instance, jamais montré ailleurs", async () => {
  const a = mk(), b = mk({}, { key: "tw2" });
  const x = await def.overlayElements.stats(a, request("stats")), y = await def.overlayElements.live(a, request("live"));
  for (const r of [x, y]) assert.ok(parseAddress(r), r.url);
  const kx = new URL(`https://x.test${x.url}`).searchParams.get("k"), ky = new URL(`https://x.test${y.url}`).searchParams.get("k");
  assert.equal(kx, ky); assert.ok(kx.length >= 20);
  assert.match(x.url, /^\/m\/tw\/element\/stats\?k=/); assert.match(y.url, /^\/m\/tw\/element\/live\?k=.*&lang=fr$/);
  assert.equal((await def.overlayElements.stats(a, request("stats"))).url, x.url, "stable (un seul code, pas un par lecteur)");
  assert.notEqual(new URL(`https://x.test${(await def.overlayElements.stats(b, request("stats"))).url}`).searchParams.get("k"), kx);
  assert.equal((await a.api.store.list("twitchElementKey")).length, 1, "un seul document");
  // le code n'apparaît dans aucun panneau d'administration ni dans aucun chiffre publié
  await connect(a);
  const seen = JSON.stringify([await def.adminPanel(a), await def.exports["social.stat"](a, { limit: 50 }), await def.exports["social.link"](a)]);
  assert.ok(!seen.includes(kx));
  assert.ok(!JSON.stringify(a.calls ?? "").includes(kx));
  const q = new URL(`https://x.test${finalAddress(parseAddress(x), { decl: manifest.overlayElements[0], layout: { iframeW: 900, iframeH: 300 }, style: STYLE, options: { followers: true, paying: false }, lang: "fr" })}`).searchParams;
  assert.deepEqual([q.get("opt-followers"), q.get("opt-paying"), q.get("ov-fit")], ["1", "0", "fluid"]);
});

test("la page et ses chiffres répondent seulement avec le bon code : sans code, mauvais code, autre élément, autre méthode = comme si la route n'existait pas ; rien n'est lu chez Twitch", async () => {
  const c = mk(); await connect(c); const before = tw.log.length;
  for (const slug of ["stats", "live"]) for (const data of [false, true]) {
    assert.equal((await call(c, slug, { data, k: "" })).status, 404);
    assert.equal((await call(c, slug, { data, k: "mauvais-code-aaaaaaaaaaaaaa" })).status, 404);
  }
  const key = new URL(`https://x.test${(await def.overlayElements.stats(c, request("stats"))).url}`).searchParams.get("k");
  c.params = { slug: "autre" };
  assert.equal((await def.routes["element/:slug"](new Request(`https://example.test/m/tw/element/autre?k=${key}`), c)).status, 404);
  assert.equal((await call(c, "stats", { method: "POST", data: false })).status, 405);
  assert.equal(tw.log.length, before, "aucune demande à Twitch pour une requête refusée");
  const fresh = mk({}, { key: "tw3" });   // jamais d'élément demandé : aucun code n'existe, tout est refusé (et rien n'est créé)
  fresh.params = { slug: "stats" };
  assert.equal((await def.routes["element/:slug"](new Request("https://example.test/m/tw3/element/stats?k=x"), fresh)).status, 404);
  assert.equal((await fresh.api.store.list("twitchElementKey")).length, 0);
});

test("page de l'élément : remplit la fenêtre, jetons --ov-* avec repli, attributs data-ov-part, politique de sécurité propre, jamais le skin du site ni de chargement tiers", async () => {
  const c = mk(); await connect(c);
  for (const slug of ["stats", "live"]) {
    const res = await call(c, slug, { data: false });
    assert.equal(res.status, 200);
    const html = await res.text();
    const csp = res.headers.get("content-security-policy");
    assert.match(csp, /default-src 'none'/); assert.match(csp, /connect-src 'self'/); assert.match(csp, /frame-ancestors 'self'/); assert.ok(!/https?:/.test(csp));
    assert.equal(res.headers.get("referrer-policy"), "no-referrer"); assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(html, /<html[^>]*data-ov-region="element"/); assert.match(html, /data-ov-part="panel"/);
    assert.match(html, /--ov-fg:#ffffff/); assert.match(html, /var\(--ov-fg,#fff\)/); assert.match(html, /var\(--ov-surface,transparent\)/);
    assert.match(html, /position:fixed;inset:0/);
    assert.ok(!/--sk-|data-skin|<link|@import|url\(|<img|src="http|https?:\/\/(?!x\.test)/.test(html.replace(/<meta[^>]*>/g, "")), "aucun skin, aucun chargement tiers");
    assert.ok(!/\.[a-z][\w-]*\s*\{/.test(html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/@keyframes[^}]*\{[^}]*\}\}/g, "")), "aucune classe en dur dans la feuille de style");
    assert.match(html, /min-aspect-ratio:9\/5/);
    // style sombre, fond doux, angles droits
    const dark = await (await call(c, slug, { data: false, extra: { "ov-text": "dark", "ov-surface": "soft", "ov-corners": "square" } })).text();
    assert.ok(dark.includes("--ov-fg:#111111") && dark.includes("--ov-surface:rgba(255,255,255,.7)") && dark.includes("--ov-radius:0px"));
    // le texte d'ailleurs est écrit par textContent (aucun innerHTML)
    assert.ok(!/innerHTML|document\.write|eval\(/.test(html));
  }
});

/* ───────────── Rien n'est montré sans accord ───────────── */

test("« Followers et abonnements » : rien tant que « Suivre mes statistiques » est éteint ; aucun appel à Twitch", async () => {
  const c = mk({ trackStats: false });
  assert.deepEqual(await dataOf(c, "stats"), { rows: [] });
  assert.deepEqual(await dataOf(c, "stats", { "ov-demo": "1" }), { rows: [] }, "même le mode test ne montre pas un chiffre non autorisé");
  assert.equal(tw.log.length, 0);
});

test("« Followers et abonnements » : seulement les chiffres cochés dans les réglages ET demandés par l'élément ; les autres ne sont même pas demandés à Twitch", async () => {
  const both = mk(); await connect(both);
  assert.deepEqual((await dataOf(both, "stats")).rows.map((r) => [r.id, r.value, r.label]), [["followers", 1234, "Followers"], ["paying", 56, "Abonnements payants"]]);
  // l'élément peut cacher un chiffre
  mod.resetCache();
  assert.deepEqual((await dataOf(both, "stats", { "opt-paying": "0" })).rows.map((r) => r.id), ["followers"]);
  assert.deepEqual((await dataOf(both, "stats", { "opt-followers": "0" })).rows.map((r) => r.id), ["paying"]);
  assert.deepEqual((await dataOf(both, "stats", { "opt-followers": "0", "opt-paying": "0" })).rows, []);
  // la personne propriétaire n'a PAS coché les abonnements payants : même si l'élément les demande, ils ne sont ni montrés ni demandés à Twitch
  mod.resetCache(); const subsBefore = helixCalls("subscriptions");
  const onlyFollowers = mk({ statsPaying: false });
  assert.deepEqual((await dataOf(onlyFollowers, "stats", { "opt-paying": "1", "opt-followers": "1" })).rows.map((r) => r.id), ["followers"]);
  assert.equal(helixCalls("subscriptions"), subsBefore, "aucune demande d'abonnements payants à Twitch");
  // et l'inverse : les followers non cochés
  mod.resetCache(); const folBefore = helixCalls("channels/followers");
  const onlyPaying = mk({ statsFollowers: false });
  assert.deepEqual((await dataOf(onlyPaying, "stats")).rows.map((r) => r.id), ["paying"]);
  assert.equal(helixCalls("channels/followers"), folBefore, "aucune demande de followers à Twitch");
  // rien de coché : rien
  const none = mk({ statsFollowers: false, statsPaying: false });
  assert.deepEqual((await dataOf(none, "stats", { "ov-demo": "1" })).rows, []);
});

test("« Followers et abonnements » : un chiffre que Twitch ne donne pas manque, sans message ni valeur inventée (pas connecté, Twitch en panne, chaîne sans programme d'affiliation)", async () => {
  const notConnected = mk();   // jamais connecté : Twitch demande l'autorisation
  assert.deepEqual(await dataOf(notConnected, "stats"), { rows: [] });
  const c = mk(); await connect(c); mod.resetCache();
  tw.state.affiliate = false;   // pas d'abonnements pour cette chaîne : les followers restent
  assert.deepEqual((await dataOf(c, "stats")).rows.map((r) => [r.id, r.value]), [["followers", 1234]]);
  mod.resetCache(); tw.state.affiliate = true; tw.state.down = true;
  assert.deepEqual(await dataOf(c, "stats"), { rows: [] });
  const page = await (await call(c, "stats", { data: false })).text();
  const sent = JSON.parse(/window\.__TW=(\{.*?\});\(function/s.exec(page)[1].replace(/\\u003c/g, "<"));
  assert.deepEqual(sent.first, { rows: [] }); assert.deepEqual(Object.keys(sent.t), ["live", "offline"], "aucun message d'erreur dans le direct : seulement les mots de la pastille");
  const none = mk({ channel: "" }); assert.deepEqual(await dataOf(none, "stats"), { rows: [] });
  const bare = fakeCtx({ key: "tw", locale: "fr", messages: fr, settings: settingsOf() });   // sans Connecteur
  assert.deepEqual(await dataOf(bare, "stats"), { rows: [] });
});

test("mode test (ov-demo=1) : des chiffres d'exemple, seulement pour ce qui serait montré ; jamais de vraie valeur ni d'appel à Twitch", async () => {
  const c = mk(); const before = tw.log.length;
  assert.deepEqual((await dataOf(c, "stats", { "ov-demo": "1" })).rows.map((r) => r.id), ["followers", "paying"]);
  assert.deepEqual((await dataOf(mk({ statsPaying: false }), "stats", { "ov-demo": "1" })).rows.map((r) => r.id), ["followers"]);
  assert.deepEqual(await dataOf(c, "live", { "ov-demo": "1", "opt-game": "1" }), { state: "live", game: fr.ov_demoGame });
  assert.equal(tw.log.length, before);
});

test("« Pastille En direct » : en direct = la pastille (le jeu seulement si l'élément le demande) ; hors ligne = rien, sauf option « Hors ligne » ; Twitch muet = rien (jamais un « hors ligne » inventé)", async () => {
  const c = mk();
  assert.deepEqual(await dataOf(c, "live"), { state: "live" });
  assert.deepEqual(await dataOf(c, "live", { "opt-game": "1" }), { state: "live", game: "Zelda" });
  mod.resetCache(); tw.state.streams = [];
  assert.deepEqual(await dataOf(c, "live"), { state: "unknown" }, "hors ligne : rien");
  assert.deepEqual(await dataOf(c, "live", { "opt-offline": "1" }), { state: "offline" });
  mod.resetCache(); tw.state.down = true;
  assert.deepEqual(await dataOf(c, "live", { "opt-offline": "1" }), { state: "unknown" }, "Twitch ne répond pas : on ne sait pas, on n'affirme rien");
  assert.deepEqual(await dataOf(mk({ channel: "" }), "live", { "opt-offline": "1" }), { state: "unknown" });
  const bare = fakeCtx({ key: "tw", locale: "fr", messages: fr, settings: settingsOf() });
  assert.deepEqual(await dataOf(bare, "live", { "opt-offline": "1" }), { state: "unknown" });
  // la pastille n'a besoin d'aucun suivi de statistiques
  mod.resetCache(); tw.state.down = false; tw.state.streams = [{ login: "machaine", title: "x", game: "Zelda", viewers: 1, startedAt: "2030-01-01T10:00:00Z", name: "MaChaine" }];
  assert.deepEqual(await dataOf(mk({ trackStats: false }), "live"), { state: "live" });
  // options inconnues ou hostiles : ignorées
  assert.deepEqual(await dataOf(mk(), "live", { "opt-game": "<script>", "opt-zzz": "1" }), { state: "live" });
});

/* ───────────── Plusieurs lecteurs ───────────── */

test("plusieurs pages d'overlay lisent le même élément : chaque lecteur voit les mêmes chiffres, rien n'est consommé (assertMultiReaders) ; Twitch n'est interrogé qu'une fois par fenêtre de cache", async () => {
  const c = mk(); await connect(c); mod.resetCache();
  tw.state.followers = 1000;
  const feed = {
    publish: async (event) => { tw.state.followers = 1000 + Number(event.split("-")[1]); mod.resetCache(); /* la fenêtre de cache de 5 minutes est passée */ },
    open: async () => {
      let seen = (await dataOf(c, "stats", { "opt-paying": "0" })).rows[0].value - 1000;
      return { read: async () => { const v = (await dataOf(c, "stats", { "opt-paying": "0" })).rows[0].value - 1000; const out = []; for (let i = seen + 1; i <= v; i++) out.push(`evt-${i}`); seen = Math.max(seen, v); return out; } };
    },
  };
  await assertMultiReaders({ ...feed, readers: 6 });
  // dix lecteurs en même temps : une seule demande chez Twitch par chiffre
  mod.resetCache(); const f0 = helixCalls("channels/followers"), s0 = helixCalls("subscriptions"), l0 = helixCalls("streams");
  await Promise.all(Array.from({ length: 10 }, async () => { await dataOf(c, "stats"); await dataOf(c, "live"); }));
  await Promise.all(Array.from({ length: 10 }, async () => { await dataOf(c, "stats"); await dataOf(c, "live"); }));
  assert.equal(helixCalls("channels/followers") - f0, 1); assert.equal(helixCalls("subscriptions") - s0, 1); assert.equal(helixCalls("streams") - l0, 1);
});

/* ───────────── Mise à jour à chaud et rien ne change pour l'existant ───────────── */

test("mise à jour à chaud : le module rechargé avec ?v= sert les éléments (le fichier voisin suit la version) ; ce qui existait est inchangé", async () => {
  const hot = (await import("../modules/twitch-channel/index.mjs?v=2.2.0-hot")).default;
  const c = mk();
  assert.match((await hot.overlayElements.stats(c, request("stats"))).url, /^\/m\/tw\/element\/stats\?k=/);
  assert.deepEqual(Object.keys(hot.routes).sort(), ["element-data/:slug", "element/:slug", "oauth/callback"]);
  assert.deepEqual(Object.keys(hot.exports).sort(), ["maze.poster", "social.link", "social.stat", "stream.live"]);
  assert.deepEqual(Object.keys(hot.services).sort(), ["event.source", "twitch.live"]);
  assert.deepEqual(await hot.exports["social.link"](c), [{ label: "Twitch · machaine", url: "https://twitch.tv/machaine", icon: "twitch" }]);
  const src = fs.readFileSync(`${DIR}/overlay.mjs`, "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/from "\.\//.test(src), "aucun import statique d'un voisin");
});
