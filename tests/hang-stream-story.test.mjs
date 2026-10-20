// Story d'annonce 1.0.0 et Raid Twitch 1.1.0 : des « trous noirs » (un agenda, RAWG, le Raid, un serveur d'images, Chaîne Twitch qui ne répondent JAMAIS, qui ignorent même le signal d'abandon)
// ne doivent bloquer personne : la page d'administration et les routes répondent quand même, en erreur propre, en quelques secondes.
// Leçon d'un incident de production : une promesse partagée jamais résolue avait bloqué tout un site. Ici : aucune attente sans borne, aucune promesse partagée sans expiration,
// aucun appel à la suite sans plafond global — et une demande après la panne repart de zéro.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const DIR = new URL("../modules/stream-story", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8")), fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
const raidManifest = JSON.parse(fs.readFileSync(new URL("../modules/twitch-raid/module.json", import.meta.url), "utf8")), raidFr = JSON.parse(fs.readFileSync(new URL("../modules/twitch-raid/locales/fr.json", import.meta.url), "utf8"));
const def = (await import("../modules/stream-story/index.mjs")).default;
const data = await import("../modules/stream-story/data.mjs");
const src = await import("../modules/stream-story/sources.mjs");
const images = await import("../modules/stream-story/images.mjs");
const raid = (await import("../modules/twitch-raid/index.mjs")).default;
const raidData = await import("../modules/twitch-raid/data.mjs");
const partners = await import("../modules/twitch-raid/partners.mjs");
const live = await import("../modules/twitch-raid/live.mjs");

const HUNG = Symbol("hung"), SITE = "https://site.example.test", NOW_ISO = new Date(Date.now() + 86_400_000).toISOString();
const within = (p, ms = 3000) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(HUNG), ms); })]).finally(() => clearTimeout(t)); };
const blackHole = () => new Promise(() => {});
const SLOTS = [{ id: "a", title: "Demain", start: NOW_ISO, end: NOW_ISO, allDay: false, games: ["Hades"], status: "confirmed", timezone: "Europe/Brussels" }];
const PIC = "https://static-cdn.jtvnw.net/jtv_user_pictures/u1-profile_image-300x300.png";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

const mk = (extra = {}) => fakeCtx({ key: "story", moduleId: "stream-story", locale: "fr", messages: { ...fr }, permissions: manifest.permissions, siteUrl: SITE, topics: { "planning.slot": () => SLOTS, "stream.partner": () => [] }, instances: [{ id: "id-story", key: "story", module: "stream-story", adminPath: "/admin/instances/id-story" }], rawgCover: { status: "found", url: "https://media.rawg.io/media/games/a/b.jpg" }, ...extra });
const call = (ctx, route, token, search = "") => def.routes[route](new Request(`${SITE}/m/story/${route}${search}`, { headers: { "x-story-token": token } }), ctx);
const timing0 = { ...src.timing }, img0 = { ...images.timing }, partners0 = { ...partners.timing }, live0 = { ...live.timing };
const realFetch = globalThis.fetch;
beforeEach(() => { Object.assign(src.timing, timing0, { collectMs: 150, coverMs: 150, partnersMs: 150, brandMs: 150, authMs: 150, routeMs: 400 }); Object.assign(images.timing, img0, { fetchMs: 100, totalMs: 160 }); Object.assign(partners.timing, partners0, { iconsMs: 150 }); images.resetImages(); partners.resetPartners(); live.resetLive(); });
afterEach(() => { globalThis.fetch = realFetch; Object.assign(src.timing, timing0); Object.assign(images.timing, img0); Object.assign(partners.timing, partners0); Object.assign(live.timing, live0); });

test("agenda qui ne répond jamais : la route des streams répond « slow » dans le délai, la page d'administration s'ouvre quand même, l'outil de l'IA répond ; la demande suivante repart de zéro", async () => {
  let hang = true;
  const ctx = mk({ topics: { "planning.slot": () => (hang ? blackHole() : SLOTS), "stream.partner": () => [] } }), token = await data.mintToken(ctx);
  const t0 = Date.now();
  const r = await within(call(ctx, "streams", token));
  assert.notEqual(r, HUNG, "la route ne doit pas attendre l'agenda");
  assert.deepEqual(await r.json(), { ok: true, state: "slow", streams: [], coverState: "" });
  assert.ok(Date.now() - t0 < 1500);
  assert.notEqual(await within(def.adminPanel(ctx, { query: {} })), HUNG, "la page d'administration ne dépend pas de l'agenda");
  const tool = await within(def.mcp.story_next_streams(ctx)); assert.notEqual(tool, HUNG); assert.deepEqual([tool.state, tool.streams], ["slow", []]);
  const prepared = await within(def.mcp.story_prepare(ctx, { text: "Salut" })); assert.notEqual(prepared, HUNG, "préparer ne lit pas l'agenda : jamais bloqué");
  hang = false;
  const again = await within(call(ctx, "streams", token)); assert.notEqual(again, HUNG);
  assert.equal((await again.json()).state, "ok", "après la panne, tout repart (aucune promesse partagée restée en attente)");
});

test("RAWG qui ne répond jamais : les streams sont rendus quand même, sans jaquette, dans le délai", async () => {
  const ctx = mk({ rawgCover: () => blackHole() }), token = await data.mintToken(ctx), t0 = Date.now();
  const r = await within(call(ctx, "streams", token)); assert.notEqual(r, HUNG);
  const body = await r.json();
  assert.equal(body.state, "ok"); assert.ok(body.streams.length >= 1 && body.streams.every((s) => s.cover === ""));
  assert.ok(Date.now() - t0 < 1500);
  const none = mk({ rawgConfigured: false }); none.api.rawg.configured = blackHole;
  const r2 = await within(call(none, "streams", await data.mintToken(none))); assert.notEqual(r2, HUNG);
  assert.equal((await r2.json()).coverState, "no_key");
});

test("Raid Twitch, site (identité) ou partenaires qui ne répondent jamais : les données de l'éditeur arrivent quand même (co-streamers et modèles enregistrés), sans le bouton de reprise", async () => {
  const ctx = mk({ topics: { "planning.slot": () => SLOTS, "stream.partner": () => blackHole() } }); ctx.api.brand = blackHole;
  const token = await data.mintToken(ctx);
  await ctx.api.store.add("story_costreamers", { items: [{ login: "alice_tv", name: "Alice", image: "" }] });
  const r = await within(call(ctx, "data", token)); assert.notEqual(r, HUNG);
  const body = await r.json();
  assert.deepEqual([body.ok, body.partners, body.brand, body.costreamers.map((c) => c.login)], [true, 0, { name: "", logo: "" }, ["alice_tv"]]);
  const imp = await within(def.routes.act(new Request(`${SITE}/m/story/act`, { method: "POST", headers: { "x-story-token": token, "content-type": "application/json" }, body: JSON.stringify({ op: "costreamers.import" }) }), ctx));
  assert.notEqual(imp, HUNG); assert.deepEqual(await imp.json(), { ok: false, error: "network" });
  assert.equal((await within(def.mcp.story_prepare(ctx, {})))?.ok, true);
});

test("la route entière est bornée : même si le stockage ne répond jamais, la route rend « network » (504) au plus tard à `timing.routeMs`", async () => {
  const ctx = mk(), token = await data.mintToken(ctx);
  const real = ctx.api.store.list; ctx.api.store.list = async (c, o) => (c === "story_costreamers" ? blackHole() : real(c, o));
  const t0 = Date.now(), r = await within(call(ctx, "data", token)); assert.notEqual(r, HUNG);
  const body = await r.json(); assert.equal(body.ok, false); assert.equal(r.status, 504); assert.ok(Date.now() - t0 < 1500);
  const dead = mk(); dead.api.store.list = blackHole;
  const r2 = await within(call(dead, "data", "1234567890123.abcdefghijklmnopqrstuvwxyz"), 2000); assert.notEqual(r2, HUNG, "un stockage muet : l'accès est refusé dans le délai");
  assert.equal(r2.status, 401);
  const panel = await within(def.adminPanel(dead, { query: {} }), 3000); assert.notEqual(panel, HUNG, "la page d'administration répond (avec une phrase d'erreur)");
  assert.equal(panel[0].text, fr.admin_error);
});

test("serveur d'images qui ne répond jamais (même en ignorant le signal d'abandon) : la route répond 502 dans le délai, l'entrée partagée est retirée, la demande suivante réussit", async () => {
  const ctx = mk(), token = await data.mintToken(ctx), u = encodeURIComponent(PIC);
  let hang = true, calls = 0;
  globalThis.fetch = async () => { calls++; if (hang) return blackHole(); return { status: 200, headers: new Headers({ "content-type": "image/png" }), body: new Response(PNG).body }; };
  const t0 = Date.now();
  const [a, b] = await Promise.all([within(call(ctx, "img", token, `?u=${u}`)), within(call(ctx, "img", token, `?u=${u}`))]);
  assert.notEqual(a, HUNG); assert.notEqual(b, HUNG); assert.equal(a.status, 502); assert.equal(b.status, 502);
  assert.equal(calls, 1, "deux demandes simultanées : un seul téléchargement partagé… qui expire");
  assert.ok(Date.now() - t0 < 1500);
  hang = false; images.resetImages();
  assert.equal((await within(call(ctx, "img", token, `?u=${u}`))).status, 200, "après la panne, l'image se télécharge (rien de bloqué)");
  // corps de réponse qui ne se termine jamais
  images.resetImages();
  globalThis.fetch = async () => ({ status: 200, headers: new Headers({ "content-type": "image/png" }), body: { getReader: () => ({ read: blackHole, cancel: async () => {} }) } });
  const c = await within(call(ctx, "img", token, `?u=${encodeURIComponent(PIC.replace("u1", "u2"))}`)); assert.notEqual(c, HUNG); assert.equal(c.status, 502);
  // fetch qui lève
  images.resetImages(); globalThis.fetch = async () => { throw new Error("coupé"); };
  assert.equal((await within(call(ctx, "img", token, `?u=${u}`))).status, 502);
});

test("Raid Twitch 1.1.0 : Chaîne Twitch qui ne répond jamais → les partenaires sont rendus sans photo dans le délai (sujet « stream.partner »), sans bloquer ; ensuite tout repart ; la liste des partenaires reste lisible", async () => {
  let hang = true;
  const methods = { account: async () => ({ ok: true, channel: "emma_live", ready: true }), request: async (args) => (hang ? blackHole() : { ok: true, status: 200, json: { data: args.query.login.map((l) => ({ login: l, display_name: l.toUpperCase(), profile_image_url: PIC })) } }) };
  const rctx = fakeCtx({ key: "raid", moduleId: "twitch-raid", locale: "fr", messages: { ...raidFr }, permissions: raidManifest.permissions, siteUrl: SITE, serviceInstances: { "twitch.api": [{ instance: "tw", name: "Chaîne Twitch", methods }] } });
  await raidData.addPartners(rctx, "alice_tv bob_x");
  const t0 = Date.now(), items = await within(raid.exports["stream.partner"](rctx, { limit: 100 }));
  assert.notEqual(items, HUNG, "le sujet ne doit pas attendre Chaîne Twitch");
  assert.deepEqual(items.map((x) => [x.login, x.title, x.image]), [["alice_tv", "alice_tv", undefined], ["bob_x", "bob_x", undefined]]);
  assert.ok(Date.now() - t0 < 1500);
  // plusieurs lecteurs en même temps : une seule demande partagée, qui expire pour tous
  partners.resetPartners();
  const many = await within(Promise.all([raid.exports["stream.partner"](rctx, {}), raid.exports["stream.partner"](rctx, {}), raid.exports["stream.partner"](rctx, {})])); assert.notEqual(many, HUNG);
  hang = false; partners.timing.failMs = 1; await new Promise((r) => setTimeout(r, 20)); partners.resetPartners();
  const ok = await within(raid.exports["stream.partner"](rctx, {})); assert.notEqual(ok, HUNG);
  assert.deepEqual(ok.map((x) => [x.title, x.image]), [["ALICE_TV", PIC], ["BOB_X", PIC]], "après la panne : les photos reviennent");
  // l'administration du Raid (liste) et le service de comptes muet
  hang = true; methods.account = blackHole; partners.resetPartners();
  const items2 = await within(raid.exports["stream.partner"](rctx, {}), 3000); assert.notEqual(items2, HUNG, "même un compte qui ne répond jamais");
  assert.equal(items2.length, 2);
});

test("aucun appel sans plafond : pas de boucle d'attente sans fin dans le code du module, et le relais d'images coupe chaque téléchargement par un signal d'abandon", () => {
  const code = ["index.mjs", "sources.mjs", "images.mjs", "admin.mjs", "data.mjs", "mcp.mjs"].map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8").replace(/\/\/.*$/gm, "")).join("\n");
  assert.ok(!/while\s*\(\s*true\s*\)/.test(code));
  assert.match(fs.readFileSync(`${DIR}/images.mjs`, "utf8"), /AbortController/);
  assert.ok(!/setInterval/.test(code), "aucun minuteur qui tourne en arrière-plan");
});
