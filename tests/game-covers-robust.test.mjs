// Jaquettes de jeux 1.2.0 : robustesse aux pannes de RAWG. Les jaquettes trouvées toutes seules sont gardées (stockage privé, borné), servies même « périmées » quand RAWG ne répond pas,
// un échec de réseau n'est jamais gardé comme « aucun résultat », un disjoncteur sobre évite d'insister, l'état se lit en mots simples et le passage panne → retour est écrit une fois au journal.
// Faux RAWG : fakeFetch du kit du cœur, à travers le VRAI client réseau (ctx.api.net de fakeCtx). Jamais le vrai RAWG, jamais une vraie clé. L'heure est simulée (Date seulement).
import test, { afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs")).href);
const { fakeFetch, assertAdminPageErgonomics } = kit;
const DIR = new URL("../modules/game-covers/", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}module.json`, "utf8"));
const read = (f) => JSON.parse(fs.readFileSync(`${DIR}locales/${f}.json`, "utf8"));
const fr = read("fr"), en = read("en");
const mod = (await import("../modules/game-covers/index.mjs")).default;
const rawg = await import("../modules/game-covers/rawg.mjs");
const fixes = await import("../modules/game-covers/fixes.mjs");
const ops = await import("../modules/game-covers/ops.mjs");
const svc = mod.services["game.cover"];

const KEY = "FAKE-RAWG-KEY-0123456789";
const T0 = Date.parse("2026-11-03T10:00:00Z");
const MIN = 60_000, HOUR = 3_600_000;
const img = (id) => `https://media.rawg.io/media/games/${String(id).padStart(3, "0")}/jeu-${id}.jpg`;
const g = (id, name, released, plats = ["PC"]) => ({ id, name, released, platforms: plats.map((p) => ({ platform: { name: p } })), background_image: img(id) });
const DB = {
  hades: [g(21, "Hades", "2020-09-17"), g(22, "Hades II", "2024-05-06")],
  celeste: [g(31, "Celeste", "2018-01-25")],
  tunic: [g(41, "Tunic", "2022-03-16")],
  playrooms: [g(11, "Astro's Playroom", "2020-11-12"), g(12, "Playroom Mania", "2019-03-02"), g(14, "The Playroom", "2013-11-29"), g(15, "Playroom Dreams", "2017-06-01")],
  nothing: [],
};
const realFetch = globalThis.fetch;
let f;
let mode = "up";   // "up" | "500" | "down" (réseau coupé) | "empty" (RAWG répond, sans rien)
const serve = () => {
  f = fakeFetch({ "*": (url) => {
    const u = new URL(url);
    if (u.hostname !== "api.rawg.io") return { status: 404 };
    if (mode === "500") return { status: 500, json: {} };
    if (mode === "down") throw new TypeError("fetch failed");
    if (mode === "empty") return { json: { results: [] } };
    return { json: { results: DB[(u.searchParams.get("search") ?? "").toLowerCase()] ?? [] } };
  } });
  globalThis.fetch = f;
};
const makeCtx = (extra = {}) => {
  const c = fakeCtx({ moduleId: "game-covers", key: "game-covers", name: "Jaquettes", messages: fr, locale: "fr", settings: { rawgKey: KEY }, permissions: ["storage", "admin", "mcp"], logEvents: manifest.logEvents, ...extra });
  c.can = () => true;
  return c;
};
const settle = () => new Promise((ok) => setTimeout(ok, 25));
const tick = (ms) => mock.timers.tick(ms);
const autos = async (c) => (await c.api.store.list("autoCovers", { limit: 5000 })).map((r) => r.data);
const logged = (c) => c.calls.log.map((l) => l.action);
const tabOf = (blocks, tab) => blocks.filter((b) => (b.tab ?? "use") === tab);

beforeEach(() => { mock.timers.enable({ apis: ["Date"], now: T0 }); rawg.clearCache(); rawg.resetBreaker(); ops.resetRate(); mode = "up"; serve(); });
afterEach(() => { mock.timers.reset(); globalThis.fetch = realFetch; });

test("manifeste 1.2.0 : version mineure, aucune permission ni dashboard de plus, deux lignes de journal pour la panne, FR et EN alignés", () => {
  assert.equal(manifest.version, "1.2.0");
  assert.deepEqual(manifest.permissions, ["storage", "admin", "mcp"]);
  assert.equal(manifest.dashboard, undefined, "rien qu'on ne puisse pas agir dessus : pas de carte ni de tâche");
  assert.deepEqual(manifest.logEvents.map((e) => e.key).slice(-2), ["cover.outage", "cover.back"]);
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  for (const k of ["all_fine", "last_ok", "outage", "outage_since", "outage_never", "outage_saved"]) assert.ok(fr[k] && en[k], k);
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of Object.keys(fr)) assert.equal(vars(fr[k]), vars(en[k]), `mêmes {variables} : ${k}`);
});

test("une jaquette trouvée est gardée (chemin, nom, date), jamais l'image ni la clé ; après un « redémarrage » elle est servie sans aucune requête", async () => {
  const c = makeCtx();
  const first = await svc.cover(c, { title: "Hades" });
  assert.equal(first.status, "found");
  await settle();
  const docs = await autos(c);
  assert.equal(docs.length, 1);
  assert.deepEqual(Object.keys(docs[0]).sort(), ["ambiguous", "at", "candidates", "img", "name", "rawgId", "title", "until"]);
  assert.equal(docs[0].img, "/media/games/021/jeu-21.jpg");
  assert.equal(Date.parse(docs[0].until) - Date.parse(docs[0].at), 24 * HOUR);
  assert.ok(!JSON.stringify(c.dumpStore()).includes(KEY), "la clé n'est jamais copiée");
  assert.ok(!JSON.stringify(docs).includes("https://"), "on garde un chemin, pas une adresse");
  // « Redémarrage » : un autre chargement du module (mémoire vide, disjoncteur neuf), le même stockage.
  const reborn = (await import("../modules/game-covers/index.mjs?v=restart-1")).default.services["game.cover"];
  rawg.clearCache();
  f.calls.length = 0;
  assert.deepEqual(await reborn.cover(c, { title: "hades" }), first);
  assert.equal(f.calls.length, 0, "mémoire vide, mais le stockage répond : RAWG n'est pas interrogé");
  assert.equal((await autos(c)).length, 1, "jamais doublé");
});

test("RAWG injoignable : la jaquette gardée sert même après 24 h, sans être supprimée ; elle est rafraîchie au retour de RAWG, à la demande d'une page", async () => {
  const c = makeCtx();
  await svc.cover(c, "Hades"); await settle();
  const before = (await autos(c))[0];
  tick(30 * HOUR);   // bien plus de 24 h
  rawg.clearCache();
  for (const m of ["500", "down"]) {
    mode = m; rawg.resetBreaker();
    const r = await svc.cover(c, "Hades");
    assert.deepEqual(r, { status: "found", url: img(21), name: "Hades", id: 21, ambiguous: false }, `périmée mais utilisable (${m})`);
    assert.equal((await autos(c)).length, 1, "pas supprimée");
  }
  assert.equal((await autos(c))[0].at, before.at, "la date de la trouvaille ne bouge pas pendant la panne");
  // Retour de RAWG : la première demande rafraîchit (une requête), les suivantes viennent du stockage.
  mode = "up"; rawg.resetBreaker(); rawg.clearCache(); f.calls.length = 0;
  assert.equal((await svc.cover(c, "Hades")).status, "found");
  await settle();
  assert.equal(f.calls.length, 1);
  const after = await autos(c);
  assert.equal(after.length, 1);
  assert.ok(Date.parse(after[0].at) > Date.parse(before.at) && Date.parse(after[0].until) > Date.now());
  rawg.clearCache(); f.calls.length = 0;
  await svc.cover(c, "Hades");
  assert.equal(f.calls.length, 0, "de nouveau fraîche : aucun appel");
});

test("un échec de réseau n'est JAMAIS gardé comme « aucun résultat » : ni en mémoire, ni dans le stockage ; la jaquette vient dès que RAWG revient", async () => {
  const c = makeCtx();
  for (const m of ["500", "down"]) {
    mode = m; rawg.resetBreaker(); rawg.clearCache();
    assert.deepEqual(await svc.cover(c, "Celeste"), { status: "unreachable", url: null }, m);
    assert.equal(rawg.cacheSize(), 0, "rien en mémoire");
    assert.equal((await autos(c)).length, 0, "rien en stockage");
  }
  mode = "up"; rawg.resetBreaker();
  assert.equal((await svc.cover(c, "Celeste")).id, 31, "pas figée comme absente");
  // Les statuts « pause » du client réseau (trop de demandes, quota) ne sont pas non plus des absences.
  f = fakeFetch({ "*": () => ({ status: 429, headers: { "retry-after": "30" }, json: {} }) }); globalThis.fetch = f; rawg.clearCache(); rawg.resetBreaker();
  assert.equal((await svc.cover(c, "Tunic")).status, "unreachable");
  assert.equal(rawg.cacheSize(), 0);
  assert.equal(rawg.breakerInfo().fails, 0, "une pause « trop de demandes » n'est pas une panne : le disjoncteur ne compte pas");
});

test("RAWG répond « rien » alors qu'une jaquette est gardée : on la garde et on réessaie dans une heure ; sans jaquette gardée, « aucun résultat » reste court (1 h)", async () => {
  const c = makeCtx();
  await svc.cover(c, "Hades"); await settle();
  tick(25 * HOUR); rawg.clearCache(); mode = "empty"; f.calls.length = 0;
  assert.equal((await svc.cover(c, "Hades")).id, 21);
  await settle();
  assert.equal(f.calls.length, 1);
  assert.equal((await autos(c)).length, 1);
  rawg.clearCache(); await svc.cover(c, "Hades");
  assert.equal(f.calls.length, 1, "pas redemandé tout de suite");
  tick(61 * MIN); rawg.clearCache(); await svc.cover(c, "Hades");
  assert.equal(f.calls.length, 2, "redemandé après une heure");
  // Sans rien de gardé : « aucun résultat », en mémoire seulement, 1 h.
  assert.deepEqual(await svc.cover(c, "Nothing"), { status: "none", url: null });
  assert.equal((await autos(c)).filter((a) => a.title === "Nothing").length, 0);
  const n = f.calls.length;
  await svc.cover(c, "Nothing");
  assert.equal(f.calls.length, n);
  tick(61 * MIN);
  await svc.cover(c, "Nothing");
  assert.equal(f.calls.length, n + 1);
});

test("disjoncteur : 3 échecs d'affilée, puis plus aucune requête ; pauses de 1, 2, 5, 15, 15 minutes ; un seul essai de reprise à la fois", async () => {
  const c = makeCtx();
  mode = "500";
  const titles = ["Hades", "Celeste", "Tunic"];
  for (const t of titles) await svc.cover(c, t);
  assert.equal(f.calls.length, 3);
  assert.equal(rawg.breakerInfo().open, true);
  // 50 demandes pendant la pause : aucune requête, réponse immédiate.
  const t0 = performance.now();
  const many = await Promise.all(Array.from({ length: 50 }, (_, i) => svc.cover(c, `Jeu ${i}`)));
  assert.ok(many.every((r) => r.status === "unreachable"));
  assert.equal(f.calls.length, 3);
  assert.ok(performance.now() - t0 < 1000, "repli immédiat");
  // Chaque essai de reprise qui échoue double la pause, jusqu'à 15 minutes.
  for (const pause of [1, 2, 5, 15, 15]) {
    tick(pause * MIN - 1000);
    await svc.cover(c, "Autre");
    const seen = f.calls.length;
    tick(1000);   // la pause est finie
    const racers = await Promise.all(Array.from({ length: 8 }, (_, i) => svc.cover(c, `Course ${pause}-${i}`)));
    assert.equal(f.calls.length, seen + 1, `un seul essai de reprise après ${pause} min`);
    assert.ok(racers.every((r) => r.status === "unreachable"));
  }
  const info = rawg.breakerInfo();
  assert.equal(info.until - Date.now(), 15 * MIN, "la pause ne dépasse jamais 15 minutes");
});

test("reprise : un essai réussi referme le disjoncteur ; « panne » et « retour » sont écrits une seule fois au journal, avec la date de la dernière réponse correcte", async () => {
  const c = makeCtx();
  await svc.cover(c, "Hades"); await settle();
  assert.deepEqual(logged(c), [], "rien au journal quand tout va bien");
  const okAt = new Date(Date.now()).toISOString();
  tick(HOUR);
  mode = "down"; rawg.clearCache();
  for (let i = 0; i < 12; i++) await svc.cover(c, `Jeu ${i}`);
  assert.equal(logged(c).filter((a) => a === "cover.outage").length, 1, "une seule fois, pas à chaque requête");
  assert.equal(c.calls.log.find((l) => l.action === "cover.outage").level, "warn");
  const state = await rawg.readState(c);
  assert.equal(state.state, "unreachable"); assert.equal(state.okAt, okAt, "la dernière réponse correcte est gardée");
  assert.equal((await svc.status(c)).state, "unreachable");
  // Retour.
  mode = "up"; tick(2 * MIN);
  assert.equal((await svc.cover(c, "Celeste")).status, "found");
  assert.equal(rawg.breakerInfo().open, false);
  assert.equal(rawg.breakerInfo().fails, 0);
  await svc.cover(c, "Tunic");
  assert.equal(logged(c).filter((a) => a === "cover.back").length, 1);
  assert.deepEqual(logged(c), ["cover.outage", "cover.back"]);
  assert.ok(c.calls.log.every((l) => !JSON.stringify(l).includes(KEY)));
});

test("« Tester la clé » passe outre la pause (c'est la personne qui le demande) et la referme si RAWG répond", async () => {
  const c = makeCtx();
  mode = "500";
  for (const t of ["Hades", "Celeste", "Tunic"]) await svc.cover(c, t);
  assert.equal(rawg.breakerInfo().open, true);
  mode = "up"; f.calls.length = 0;
  assert.equal((await mod.adminActions.testKey(c)).redirect, "?saved=tested");
  assert.equal(f.calls.length, 1);
  assert.equal(rawg.breakerInfo().open, false);
  assert.equal((await svc.status(c)).state, "ok");
  // Pendant une pause, les propositions de l'écran de correction ne cherchent pas non plus (mais la mémoire sert).
  mode = "500"; rawg.clearCache(); for (const t of ["A1", "A2", "A3"]) await svc.cover(c, t);
  f.calls.length = 0;
  assert.equal((await svc.candidates(c, { title: "Hades" })).status, "unreachable");
  assert.equal(f.calls.length, 0);
});

test("les corrections de la personne passent avant tout ; une correction retire la jaquette automatique ; « Oublier » retire aussi celle qui est gardée", async () => {
  const c = makeCtx();
  await svc.cover(c, "Hades"); await settle();
  assert.equal((await autos(c)).length, 1);
  assert.equal((await ops.chooseGame(c, "t", "Hades", 22)).ok, true);
  assert.equal((await autos(c)).length, 0, "la correction a remplacé le choix automatique");
  tick(40 * HOUR); mode = "500";
  assert.equal((await svc.cover(c, "Hades")).id, 22, "même en panne, même après 24 h");
  mode = "up";
  await ops.forget(c, "t", "hades", "Hades");
  assert.equal((await svc.cover(c, "Hades")).id, 21);
  await settle();
  assert.equal((await autos(c)).length, 1);
  assert.equal((await mod.adminActions.forget(c, { id: "Hades" })).redirect, "?tab=saved&saved=forgot");
  assert.equal((await autos(c)).length, 0, "oubliée : le site cherchera de nouveau");
  assert.match((await mod.adminActions.forget(c, { id: "Hades" })).error, /plus enregistrée/);
  // Une correction enregistrée entre-temps n'est pas écrasée par une trouvaille tardive.
  await ops.chooseNone(c, "t", "Celeste");
  assert.equal(await fixes.saveAuto(c, { title: "Celeste", url: img(31), ttlMs: HOUR }), false);
  // Clé refusée : on le dit (la jaquette gardée ne cache pas un problème de clé).
  await svc.cover(c, "Tunic"); await settle();
  tick(40 * HOUR); rawg.clearCache(); f = fakeFetch({ "*": () => ({ status: 403, json: {} }) }); globalThis.fetch = f;
  assert.equal((await svc.cover(c, "Tunic")).status, "refused");
});

test("données bornées : 1 000 jaquettes automatiques au plus, les plus anciennes sortent à l'écriture par tranche, la plus récente reste ; aucun minuteur", async () => {
  const c = makeCtx();
  for (let k = 0; k < fixes.MAX_AUTO; k++) await c.api.store.add("autoCovers", { title: `Vieux ${k}`, img: "/media/games/001/a.jpg", at: new Date(T0 - (2000 - k) * 1000).toISOString(), until: new Date(T0 + HOUR).toISOString() }, { key: `vieux ${k}` });
  assert.equal(await c.api.store.count("autoCovers"), fixes.MAX_AUTO);
  assert.equal(await fixes.saveAuto(c, { title: "Tout neuf", url: img(5), ttlMs: HOUR }), true);
  const n = await c.api.store.count("autoCovers");
  assert.ok(n <= fixes.MAX_AUTO && n >= fixes.MAX_AUTO - fixes.AUTO_EVICT, `borné (${n})`);
  assert.ok((await fixes.autoFor(c, "Tout neuf")), "la plus récente reste");
  assert.equal(await fixes.autoFor(c, "Vieux 0"), null, "la plus ancienne est sortie");
  assert.ok(await fixes.autoFor(c, "Vieux 999"));
  // Rafraîchir une jaquette la remet parmi les plus récentes (elle sort en dernier).
  await fixes.saveAuto(c, { title: "Vieux 500", url: img(6), ttlMs: HOUR });
  assert.equal((await fixes.autoFor(c, "Vieux 500")).img, "/media/games/006/jeu-6.jpg");
  assert.equal((await c.api.store.list("autoCovers", { limit: 5000 })).filter((r) => r.data.title === "Vieux 500").length, 1, "jamais doublée");
  const code = fs.readdirSync(DIR).filter((x) => x.endsWith(".mjs")).map((x) => fs.readFileSync(`${DIR}${x}`, "utf8")).join("\n");
  assert.ok(!/setInterval/.test(code));
});

test("lignes illisibles ou piégées dans le stockage : écartées (mauvais hôte, mauvaise date, mauvais titre), jamais d'exception", async () => {
  const c = makeCtx();
  const good = { title: "Bon", img: "/media/games/001/a.jpg", at: new Date(T0).toISOString(), until: new Date(T0).toISOString() };
  await c.api.store.add("autoCovers", good, { key: "bon" });
  await c.api.store.add("autoCovers", { ...good, title: "Evil", img: "//evil.example/x.jpg" }, { key: "evil" });
  await c.api.store.add("autoCovers", { ...good, title: "Date", at: "pas une date" }, { key: "date" });
  await c.api.store.add("autoCovers", { ...good, title: "Autre" }, { key: "pas la bonne cle" });
  await c.api.store.add("autoCovers", "texte", { key: "texte" });
  assert.deepEqual((await fixes.readAutoAll(c)).map((a) => a.title), ["Bon"]);
  assert.equal(await fixes.autoFor(c, "Evil"), null);
  assert.equal(await fixes.autoFor(c, "Autre"), null, "la clé doit être celle du titre");
  const rows = await fixes.savedEntries(c);
  assert.deepEqual(rows.map((r) => r.title), ["Bon"]);
});

test("onglet « Jaquettes enregistrées » : les jaquettes automatiques gardées y sont (Voir, Changer, Oublier), recherche en direct sur tout, 50 par page, poids de la page borné", async () => {
  const c = makeCtx();
  await svc.cover(c, "Hades"); await svc.cover(c, "Playrooms"); await settle();
  await ops.chooseNone(c, "t", "Sans image");
  const saved = tabOf(await mod.adminPanel(c, { query: {} }), "saved");
  const t = saved.find((b) => b.type === "table");
  const byTitle = Object.fromEntries(t.rows.map((r) => [r[0], r]));
  assert.deepEqual(Object.keys(byTitle).sort(), ["Hades", "Playrooms", "Sans image"]);
  assert.deepEqual([byTitle.Hades[2].text, byTitle.Hades[2].badge, byTitle.Hades[1]], ["Automatique", "info", "Hades"]);
  assert.equal(t.searchable, true); assert.equal(t.pageSize, 50);
  assert.deepEqual(t.rowActions.map((a) => a.label), ["Voir", "Changer", "Oublier cette jaquette"]);
  // Voir / Changer / Oublier sur une jaquette automatique qui n'est PAS dans « à vérifier ».
  const view = await mod.adminPanel(c, { query: { tab: "saved", voir: "Hades" } });
  assert.ok(view.find((b) => b.type === "html").html.includes(img(21)));
  assert.ok(view.find((b) => b.type === "html").html.includes("Automatique"));
  const change = await mod.adminPanel(c, { query: { tab: "saved", titre: "Hades" } });
  assert.ok(change.some((b) => b.type === "adminForm" && b.action === "confirm"), "« Ce choix est bon » pour une jaquette automatique");
  assert.ok(change.find((b) => b.type === "html" && /current/.test(b.html)).html.includes("Choix automatique actuel"));
  assert.equal((await mod.adminActions.confirm(c, { id: "Hades", tab: "saved" })).redirect, "?tab=saved&saved=confirm");
  assert.equal((await fixes.fixFor(c, "Hades")).kind, "game");
  assert.equal((await autos(c)).filter((a) => a.title === "Hades").length, 0);
  const ask = await mod.adminPanel(c, { query: { tab: "saved", oublier: "Playrooms" } });
  assert.ok(ask.some((b) => b.type === "markdown" && /sera oubliée/.test(b.text)));
  assert.equal((await mod.adminActions.forget(c, { id: "Playrooms" })).redirect, "?tab=saved&saved=forgot");
  assert.equal((await autos(c)).length, 0);
  assert.equal((await fixes.readToCheck(c)).length, 0, "le titre « à vérifier » est retiré aussi : il ne revient pas");
  // « Changer » sur un titre douteux ne plante pas (les deux formulaires sont là).
  await svc.cover(c, "Playrooms"); await settle();
  const doubtful = await mod.adminPanel(c, { query: { titre: "Playrooms" } });
  assert.deepEqual(doubtful.filter((b) => b.type === "adminForm").map((b) => b.action), ["confirm", "search", "chooseNone"]);
});

test("beaucoup de lignes : 1 000 corrections + 100 à vérifier + 1 000 automatiques tiennent dans la page (recherche en direct sur tout), vite et sans excès de poids", async () => {
  const c = makeCtx();
  for (let k = 0; k < 1000; k++) {
    await c.api.store.add("fixes", { title: `Correction numero ${k}`, kind: "none", at: new Date(T0 - k * 1000).toISOString() }, { key: `correction numero ${k}` });
    await c.api.store.add("autoCovers", { title: `Trouvaille numero ${k}`, name: `Un jeu au nom assez long numero ${k}`, rawgId: 1000 + k, img: "/media/games/001/a.jpg", at: new Date(T0 - k * 1000 - 500).toISOString(), until: new Date(T0).toISOString() }, { key: `trouvaille numero ${k}` });
  }
  for (let k = 0; k < 100; k++) await c.api.store.add("todo", { key: `douteux ${k}`, title: `Douteux ${k}`, name: `Un autre jeu ${k}`, img: "/media/games/002/b.jpg", candidates: 3, at: new Date(T0 - k * 1000 - 250).toISOString() }, { key: `douteux ${k}` });
  const t0 = performance.now();
  const blocks = await mod.adminPanel(c, { query: {} });
  const ms = performance.now() - t0;
  const table = tabOf(blocks, "saved").find((b) => b.type === "table");
  assert.equal(table.rows.length, 2100);
  assert.equal(table.rows.length, table.rowIds.length);
  assert.equal(table.pageSize, 50);
  const kb = JSON.stringify(table).length / 1024;
  console.log(`# 2 100 lignes : ${kb.toFixed(0)} Ko de blocs, ${ms.toFixed(0)} ms (stockage en mémoire)`);
  assert.ok(kb < 450, `poids de la page : ${kb} Ko`);
  assert.ok(ms < 3000);
  // L'outil de l'assistant voit les automatiques, 100 au plus par appel.
  const list = await mod.mcp.rawg_covers_list(c, { origin: "auto", limit: 100 }, { name: "essai", tokenId: "t" });
  assert.equal(list.total, 1100); assert.equal(list.items.length, 100);
  assert.ok(list.items.every((i) => i.origin === "auto" && i.coverUrl.startsWith("https://media.rawg.io/media/")));
});

test("l'état en mots simples : « Tout fonctionne » avec la date, puis la phrase de panne avec la dernière réponse correcte, dans les deux onglets ; aucun mot du code, aucune clé", async () => {
  const c = makeCtx();
  await svc.cover(c, "Hades"); await settle();
  const ok = await mod.adminPanel(c, { query: {} });
  assert.ok(ok.some((b) => b.type === "banner" && b.tone === "success" && b.text === "Tout fonctionne."));
  assert.ok(ok.some((b) => b.type === "markdown" && /^Dernière réponse de RAWG : /.test(b.text)));
  assert.ok(!ok.some((b) => b.type === "banner" && b.tone === "warning"));
  tick(3 * HOUR); mode = "down"; rawg.clearCache();
  for (const t of ["A", "B", "C"]) await svc.cover(c, `Titre ${t}`);
  const down = await mod.adminPanel(c, { query: {} });
  const warn = down.find((b) => b.type === "banner" && b.tone === "warning");
  assert.equal(warn.text, "RAWG, la base de jaquettes, ne répond pas pour le moment. Les jaquettes déjà trouvées restent affichées.");
  assert.ok(down.some((b) => b.type === "markdown" && /^Dernière réponse de RAWG : .*réessaie tout de suite/.test(b.text)));
  assert.ok(down.some((b) => b.type === "adminForm" && b.action === "testKey"), "le bouton pour réessayer est là");
  assert.ok(tabOf(down, "saved").some((b) => b.type === "banner" && b.tone === "warning"), "l'autre onglet le dit aussi");
  assert.ok(!JSON.stringify(down).includes(KEY));
  for (const text of [warn.text, fr.all_fine, fr.outage_since, fr.outage_never, fr.outage_saved, en.outage, en.all_fine]) {
    assert.ok(!/\b(api|cache|service|jeton|token|identifiant|webhook|instance|disjoncteur|timeout)\b/i.test(text), text);
    assert.ok(text.split(/[.!?]/).every((s) => s.trim().split(/\s+/).length <= 20), "phrases de 20 mots au plus");
    assert.ok(!text.includes("!"));
  }
  // Retour : la phrase de panne disparaît.
  mode = "up"; tick(5 * MIN);
  await mod.adminActions.testKey(c);
  const back = await mod.adminPanel(c, { query: {} });
  assert.ok(back.some((b) => b.type === "banner" && b.text === "Tout fonctionne."));
  assert.ok(!back.some((b) => b.type === "banner" && b.tone === "warning"));
  // Jamais d'état avant la première réponse : la phrase d'avant.
  const fresh = makeCtx();
  assert.ok((await mod.adminPanel(fresh, { query: {} })).some((b) => b.type === "markdown" && b.text === fr.never_checked));
});

test("ergonomie des écrans modifiés : onglets, état « injoignable », voir, changer (kit du cœur)", async () => {
  const c = makeCtx();
  await svc.cover(c, "Hades"); await svc.cover(c, "Playrooms"); await settle();
  mode = "down"; rawg.clearCache();
  for (const t of ["A", "B", "C"]) await svc.cover(c, `Titre ${t}`);
  for (const query of [{}, { tab: "saved", voir: "Hades" }, { tab: "saved", titre: "Hades" }, { tab: "saved", oublier: "Hades" }]) {
    const blocks = await mod.adminPanel(c, { query });
    if (query.titre) { mode = "up"; rawg.resetBreaker(); }
    assertAdminPageErgonomics(blocks.filter((b) => b.type !== "html"));
  }
});

test("rien de plus : aucun nouvel hôte, aucune image téléchargée, aucun cookie, aucune donnée de visiteur", () => {
  const code = fs.readdirSync(DIR).filter((x) => x.endsWith(".mjs")).map((x) => fs.readFileSync(`${DIR}${x}`, "utf8")).join("\n");
  const hosts = new Set([...code.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()));
  assert.deepEqual([...hosts].filter((h) => !/(^|\.)rawg\.io$/.test(h)), []);
  assert.ok(!/\bfetch\(/.test(code) && !/arrayBuffer|\.blob\(|createWriteStream|writeFile/.test(code), "aucune image n'est téléchargée ni écrite");
  assert.ok(!/cookie|fingerprint|x-forwarded|\bip\b/i.test(code.replace(/\/\/.*$/gm, "")), "rien sur les personnes qui visitent");
});
