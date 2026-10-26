// Jaquettes de jeux : le module qui détient la clé RAWG, cherche les jaquettes, garde les corrections et offre le service `game.cover`.
// Faux RAWG : fakeFetch du kit du cœur, à travers le VRAI client réseau (ctx.api.net de fakeCtx). Jamais le vrai RAWG, jamais une vraie clé.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs")).href);
const { fakeFetch } = kit;
const DIR = new URL("../modules/game-covers/", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}module.json`, "utf8"));
const read = (f) => JSON.parse(fs.readFileSync(`${DIR}locales/${f}.json`, "utf8"));
const fr = read("fr");
const mod = (await import("../modules/game-covers/index.mjs")).default;
const rawg = await import("../modules/game-covers/rawg.mjs");
const fixes = await import("../modules/game-covers/fixes.mjs");
const ops = await import("../modules/game-covers/ops.mjs");
const svc = mod.services["game.cover"];

const KEY = "FAKE-RAWG-KEY-0123456789";
const img = (id) => `https://media.rawg.io/media/games/${String(id).padStart(3, "0")}/jeu-${id}.jpg`;
const g = (id, name, released, plats = ["PC"]) => ({ id, name, released, platforms: plats.map((p) => ({ platform: { name: p } })), background_image: img(id) });
const DB = {
  hades: [g(21, "Hades", "2020-09-17", ["PC", "Switch", "PlayStation 5", "Xbox One"]), g(22, "Hades II", "2024-05-06")],
  playrooms: [g(11, "Astro's Playroom", "2020-11-12", ["PlayStation 5"]), g(12, "Playroom Mania", "2019-03-02"), g(14, "The Playroom", "2013-11-29"), g(15, "Playroom Dreams", "2017-06-01")],
  "astro's playroom": [g(11, "Astro's Playroom", "2020-11-12", ["PlayStation 5"])],
  nothing: [],
};
const realFetch = globalThis.fetch;
let f;
/** Faux RAWG : `answer(search, url)` donne la réponse (voir fakeFetch) ; par défaut la petite base ci-dessus. */
const serve = (answer = (s) => ({ json: { results: DB[s.toLowerCase()] ?? [] } })) => {
  f = fakeFetch({ "*": (url) => { const u = new URL(url); return u.hostname === "api.rawg.io" ? answer(u.searchParams.get("search") ?? "", url) : { status: 404 }; } });
  globalThis.fetch = f;
  return f;
};
let n = 0;
const makeCtx = (extra = {}) => {
  const c = fakeCtx({ moduleId: "game-covers", key: "game-covers", name: "Jaquettes", messages: fr, locale: "fr", settings: { rawgKey: KEY }, permissions: ["storage", "admin", "mcp"], ...extra });
  c.can = () => true;
  return c;
};
const titles = () => f.calls.map((c) => new URL(c.url).searchParams.get("search"));
beforeEach(() => { rawg.clearCache(); ops.resetRate(); serve(); n++; });
afterEach(() => { globalThis.fetch = realFetch; });

test("manifeste : valide, service game.cover v1 (lecture seule + droit « fix »), clé en réglage secret facultatif, deux outils pour l'assistant, FR et EN alignés", () => {
  const parsed = parseManifest(manifest);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
  assert.equal(manifest.id, "game-covers");
  assert.deepEqual(manifest.offers.map((o) => [o.service, o.version]), [["game.cover", 1]]);
  assert.deepEqual(manifest.offers[0].readOnly.sort(), ["candidates", "cover", "status"]);
  assert.deepEqual(manifest.offers[0].callerRights, ["fix"]);
  const key = manifest.settings.find((s) => s.key === "rawgKey");
  assert.equal(key.type, "secret"); assert.equal(key.optional, true);
  assert.deepEqual(manifest.mcp.map((t) => t.name), ["rawg_covers_to_check", "rawg_cover_set"]);
  assert.equal(manifest.mcp.find((t) => t.name === "rawg_cover_set").default, false, "l'écriture n'est jamais accordée d'office");
  assert.deepEqual(Object.keys(read("en")).sort(), Object.keys(fr).sort(), "mêmes clés en français et en anglais");
  for (const k of Object.keys(fr)) assert.ok(fr[k].trim() && read("en")[k].trim(), k);
  assert.ok(!/[\u2028\u2029]/.test(fs.readFileSync(`${DIR}fixes.mjs`, "utf8")));
});

test("sans clé : no-key, aucune requête ; clé mal formée : refused, aucune requête", async () => {
  const none = makeCtx({ settings: {} });
  assert.deepEqual(await svc.cover(none, { title: "Hades" }), { status: "no-key", url: null });
  assert.deepEqual(await svc.candidates(none, { title: "Hades" }), { status: "no-key", candidates: [] });
  assert.deepEqual(await svc.status(none), { ready: false, configured: false, source: null, state: null });
  const bad = makeCtx({ settings: { rawgKey: "pas bon !" } });
  assert.equal((await svc.cover(bad, { title: "Hades" })).status, "refused");
  assert.equal(f.calls.length, 0);
});

test("jaquette trouvée : le titre ressemblant gagne, la clé part vers RAWG (https) et nulle part ailleurs", async () => {
  const c = makeCtx();
  const r = await svc.cover(c, { title: "Hades" });
  assert.deepEqual(r, { status: "found", url: img(21), name: "Hades", id: 21, ambiguous: false });
  assert.equal(f.calls.length, 1);
  const u = new URL(f.calls[0].url);
  assert.equal(u.origin + u.pathname, "https://api.rawg.io/api/games");
  assert.equal(u.searchParams.get("key"), KEY);
  assert.equal(u.searchParams.get("page_size"), "8");
  // La clé n'est dans aucune valeur rendue, aucun journal du client réseau, aucun bloc, aucun état gardé.
  assert.ok(!JSON.stringify(r).includes(KEY));
  assert.ok(!JSON.stringify(c.calls.netLog).includes(KEY), "le journal du réseau ne contient pas la clé");
  assert.ok(!JSON.stringify(c.dumpStore()).includes(KEY), "la clé du réglage n'est pas copiée dans le stockage");
  assert.ok(!JSON.stringify(await svc.status(c)).includes(KEY));
  assert.deepEqual((await svc.status(c)), { ready: true, configured: true, source: "setting", state: "ok", at: (await svc.status(c)).at });
});

test("la cover accepte aussi un simple texte, et un titre vide ou démesuré ne casse rien", async () => {
  const c = makeCtx();
  assert.equal((await svc.cover(c, "Hades")).status, "found");
  assert.equal((await svc.cover(c, { title: "   " })).status, "none");
  assert.equal((await svc.cover(c, {})).status, "none");
  assert.equal((await svc.cover(c, { title: "x".repeat(5000) })).status, "none", "RAWG ne connaît pas ce titre-là");
  const asked = titles().at(-1);
  assert.ok(asked.length <= 100);
});

test("titre ambigu : jeu le plus ressemblant, ambiguous: true, noté dans « à vérifier » une seule fois ; le cache évite de réinterroger RAWG", async () => {
  const c = makeCtx();
  const r = await svc.cover(c, { title: "Playrooms" });
  assert.equal(r.status, "found"); assert.equal(r.ambiguous, true);
  await new Promise((ok) => setTimeout(ok, 20));
  const todo = await fixes.readToCheck(c);
  assert.equal(todo.length, 1); assert.equal(todo[0].title, "Playrooms"); assert.ok(todo[0].candidates >= 2);
  await svc.cover(c, { title: "Playrooms" });
  assert.equal(f.calls.length, 1, "la deuxième réponse vient du cache");
  assert.equal((await fixes.readToCheck(c)).length, 1, "jamais doublé");
});

test("aucun résultat, clé refusée (401 et 403), RAWG en panne (500 et réseau coupé) : les bons statuts, jamais d'exception", async () => {
  const c = makeCtx();
  assert.deepEqual(await svc.cover(c, { title: "Nothing" }), { status: "none", url: null });
  for (const status of [401, 403]) { serve(() => ({ status, json: {} })); rawg.clearCache(); assert.equal((await svc.cover(c, { title: "Hades" })).status, "refused"); }
  serve(() => ({ status: 500, json: {} })); rawg.clearCache();
  assert.equal((await svc.cover(makeCtx(), { title: "Hades" })).status, "unreachable");
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  assert.equal((await svc.cover(makeCtx(), { title: "Hades" })).status, "unreachable");
  const state = await svc.status(c);
  assert.ok(["refused", "ok", "unreachable"].includes(state.state));
});

test("réponse hostile de RAWG : images en http ou sans nom ignorées, listes trop longues coupées, types faux écartés", async () => {
  serve(() => ({ json: { results: [{ id: "x", name: 5, background_image: "http://media.rawg.io/a.jpg" }, null, "texte", g(1, "Hades", "pas une date"), ...Array.from({ length: 50 }, (_, i) => g(100 + i, `Jeu ${i}`, "2020-01-01"))] } }));
  const c = makeCtx();
  const r = await svc.cover(c, { title: "Hades" });
  assert.equal(r.status, "found"); assert.equal(r.url, img(1));
  const list = await svc.candidates(c, { title: "Hades" });
  assert.ok(list.candidates.length <= 6);
  assert.ok(list.candidates.every((x) => x.url.startsWith("https://media.rawg.io/media/")));
});

test("candidats : 6 au plus, jaquette obligatoire, sans doublon, du plus ressemblant au moins ressemblant", async () => {
  serve(() => ({ json: { results: [g(1, "Alpha", "2001-01-01"), g(1, "Alpha", "2001-01-01"), { ...g(2, "Beta"), background_image: null }, ...Array.from({ length: 6 }, (_, i) => g(10 + i, `Alpha ${i + 2}`, "2005-05-05"))] } }));
  const out = await svc.candidates(makeCtx(), { title: "Alpha" });
  assert.equal(out.status, "found"); assert.equal(out.candidates.length, 6);
  assert.equal(out.candidates[0].id, 1);
  assert.deepEqual(new Set(out.candidates.map((x) => x.id)).size, 6);
  assert.deepEqual(Object.keys(out.candidates[0]).sort(), ["id", "name", "platforms", "url", "year"]);
});

test("« C'est ce jeu » : la correction passe avant le cache et avant RAWG ; « Aucune jaquette » ; « Oublier » ; le jeu doit venir des propositions de RAWG", async () => {
  const c = makeCtx();
  assert.equal((await mod.adminActions.choose(c, { id: `22|${encodeURIComponent("Hades")}|` })).redirect, "?saved=game");
  f.calls.length = 0;
  const r = await svc.cover(c, { title: "hades" });
  assert.deepEqual(r, { status: "found", url: img(22), name: "Hades II", id: 22, ambiguous: false });
  assert.equal(f.calls.length, 0, "aucune requête : la correction suffit");
  assert.ok((await fixes.readToCheck(c)).length === 0);
  // Un jeu qui n'est pas parmi les propositions est refusé.
  const bad = await mod.adminActions.choose(c, { id: `999|${encodeURIComponent("Hades")}|` });
  assert.match(bad.error, /plus dans la liste/);
  // Aucune jaquette
  assert.equal((await mod.adminActions.chooseNone(c, { id: "Hades" })).redirect, "?saved=none");
  assert.deepEqual(await svc.cover(c, { title: "Hades" }), { status: "none", url: null });
  // Oublier : le choix automatique revient.
  assert.equal((await mod.adminActions.forget(c, { id: "Hades" })).redirect, "?saved=forgot");
  assert.equal((await svc.cover(c, { title: "Hades" })).id, 21);
  assert.ok((await mod.adminActions.forget(c, { id: "Hades" })).error, "plus rien à oublier");
});

test("« Ce choix est bon » garde le jeu trouvé pour un titre douteux ; « Tout oublier » demande une confirmation", async () => {
  const c = makeCtx();
  await svc.cover(c, { title: "Playrooms" });
  await new Promise((ok) => setTimeout(ok, 20));
  assert.equal((await mod.adminActions.confirm(c, { id: "Playrooms" })).redirect, "?saved=confirm");
  assert.equal((await svc.cover(c, { title: "Playrooms" })).ambiguous, false);
  assert.equal((await fixes.readToCheck(c)).length, 0);
  assert.equal(await fixes.countFixes(c), 1);
  assert.ok((await mod.adminActions.forgetAll(c, {})).errors.confirm);
  assert.equal((await mod.adminActions.forgetAll(c, { confirm: "on" })).redirect, "?saved=forgot");
  assert.equal(await fixes.countFixes(c), 0);
});

test("1000 corrections au plus ; titre invalide refusé ; image à la main : seulement media.rawg.io", async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ title: `Jeu numero ${i}`, kind: "none", at: new Date().toISOString() }));
  const c = makeCtx();
  for (const r of rows) await c.api.store.add("fixes", r, { key: `jeu numero ${i(r)}` });
  function i(r) { return r.title.split(" ").at(-1); }
  const full = await fixes.saveFix(c, "Un autre", { kind: "none" });
  assert.deepEqual(full, { ok: false, error: "full" });
  // Remplacer une correction existante reste permis.
  assert.equal((await fixes.saveFix(c, "Jeu numero 7", { kind: "none" })).ok, true);
  assert.equal((await ops.chooseNone(c, "t", "")).error, "title");
  assert.equal((await ops.chooseNone(c, "t", "x".repeat(121))).error, "title");
  assert.equal((await ops.chooseNone(c, "t", "!!!")).error, "title");
  for (const bad of ["http://media.rawg.io/media/a.jpg", "https://evil.example/media/a.jpg", "https://media.rawg.io/media/../a.jpg", "https://media.rawg.io:444/media/a.jpg", "https://media.rawg.io/media/a.jpg?x=1", "https://media.rawg.io/other/a.jpg", "javascript:alert(1)", "https://media.rawg.io/media/a.svg"]) {
    assert.equal(fixes.rawgImagePath(bad), null, bad);
  }
  assert.equal(fixes.rawgImagePath("https://media.rawg.io/media/games/a/b.jpg"), "/media/games/a/b.jpg");
});

test("cadence limitée par personne : 60 écritures par minute, puis « rate »", async () => {
  const c = makeCtx();
  for (let k = 0; k < 60; k++) assert.equal((await ops.chooseNone(c, "moi", `Jeu ${k}`)).ok, true);
  assert.equal((await ops.chooseNone(c, "moi", "Encore")).error, "rate");
  assert.equal((await ops.chooseNone(c, "un autre", "Encore")).ok, true);
});

test("service fix : réservé à une personne qui a le droit « fix » ; choisir, aucune jaquette, oublier", async () => {
  const c = makeCtx();
  const noRight = makeCtx(); noRight.can = () => false;
  assert.deepEqual(await svc.fix(noRight, { title: "Hades", none: true }), { ok: false, error: "denied" });
  const bare = makeCtx(); delete bare.can;
  assert.deepEqual(await svc.fix(bare, { title: "Hades", none: true }), { ok: false, error: "denied" });
  assert.deepEqual(await svc.fix(c, { title: "Hades", rawgId: 22 }), { ok: true, choice: "game", title: "Hades" });
  assert.equal((await svc.cover(c, "Hades")).id, 22);
  assert.deepEqual(await svc.fix(c, { title: "Hades", forget: true }), { ok: true, forgotten: true });
  assert.equal((await svc.fix(c, { title: "Hades", rawgId: 999 })).error, "candidate");
});

test("adopt (reprise des données du site) : clé et corrections reprises, rien de remplacé, rien de rendu, rejouable", async () => {
  const c = makeCtx({ settings: {} });
  const good = { title: "Hades", kind: "game", rawgId: 22, name: "Hades II", img: "/media/games/022/jeu-22.jpg", at: "2026-01-02T00:00:00.000Z" };
  const input = {
    key: KEY,
    fixes: { hades: good, mauvais: { title: "Evil", kind: "image", img: "//evil.example/x.jpg", at: "2026-01-01T00:00:00.000Z" }, rien: { title: "Rien", kind: "none", at: "2026-01-03T00:00:00.000Z" } },
    todo: [{ key: "x", title: "Doom", name: "DOOM (2016)", rawgId: 31, img: "/media/games/031/jeu-31.jpg", candidates: 3, at: new Date().toISOString() }, { title: "Hades", name: "x", img: "/media/games/022/jeu-22.jpg", at: new Date().toISOString() }, { title: "Mauvaise image", name: "x", img: "/etc/passwd", at: new Date().toISOString() }],
  };
  const r = await svc.adopt(c, input);
  assert.deepEqual(r, { ok: true, keyHeld: true, keyAdopted: true, fixes: 2, todo: 1, ready: true });
  assert.ok(!JSON.stringify(r).includes(KEY));
  // Sans réglage saisi ici, la clé reprise sert.
  assert.equal((await svc.cover(c, "Hades")).id, 22);
  assert.deepEqual(await svc.status(c), { ready: true, configured: true, source: "adopted", state: null });
  // Rejoué : rien de plus.
  const again = await svc.adopt(c, input);
  assert.deepEqual([again.keyAdopted, again.fixes, again.todo, again.ready], [false, 0, 0, true]);
  assert.equal(await fixes.countFixes(c), 2);
  // Un choix fait ici n'est jamais écrasé par la reprise.
  await fixes.saveFix(c, "Rien", { kind: "game", rawgId: 11, name: "Astro's Playroom", img: "/media/games/011/jeu-11.jpg" });
  await svc.adopt(c, input);
  assert.equal((await fixes.fixFor(c, "Rien")).kind, "game");
  // La clé saisie dans les réglages l'emporte sur la clé reprise ; une autre clé ne remplace pas la reprise.
  const own = makeCtx({ settings: { rawgKey: "UNE-AUTRE-CLE-1234" }, rows: { adoptedKey: [{ key: KEY, at: "x" }] } });
  assert.equal((await rawg.keyOf(own)).key, "UNE-AUTRE-CLE-1234");
  const other = await svc.adopt(makeCtx({ settings: {} }), { key: "n'importe quoi" });
  assert.equal(other.keyAdopted, false); assert.equal(other.ready, false);
  // Rien d'utile à reprendre : jamais d'exception.
  assert.equal((await svc.adopt(makeCtx({ settings: {} }), undefined)).ok, true);
  assert.equal((await svc.adopt(makeCtx({ settings: {} }), { fixes: "texte", todo: 5, key: 5 })).ok, true);
});

test("l'administration : jamais la clé ; guide sans clé ; état avec clé ; clé reprise (avec « Oublier »)", async () => {
  const none = makeCtx({ settings: {} });
  const blocks = await mod.adminPanel(none, { query: {} });
  assert.ok(blocks.some((b) => b.type === "banner" && /Aucune clé/.test(b.text)));
  assert.ok(blocks.some((b) => b.type === "markdown" && /rawg\.io\/apidocs/.test(b.text)));
  const c = makeCtx();
  const withKey = await mod.adminPanel(c, { query: {} });
  assert.ok(!JSON.stringify(withKey).includes(KEY));
  assert.ok(withKey.some((b) => b.type === "adminForm" && b.action === "testKey"));
  assert.ok(withKey.some((b) => b.type === "netHealth"));
  const adopted = makeCtx({ settings: {} });
  await svc.adopt(adopted, { key: KEY });
  const shown = await mod.adminPanel(adopted, { query: {} });
  assert.ok(!JSON.stringify(shown).includes(KEY));
  assert.ok(shown.some((b) => b.type === "adminForm" && b.action === "forgetKey"));
  assert.match((await mod.adminActions.forgetKey(adopted)).ok, /oubliée/);
  assert.equal((await svc.status(adopted)).configured, false);
});

test("« Tester la clé » : ok, refusée, injoignable, absente, mal formée ; le résultat est mémorisé", async () => {
  const c = makeCtx();
  assert.equal((await mod.adminActions.testKey(c)).redirect, "?saved=tested");
  assert.equal((await svc.status(c)).state, "ok");
  serve(() => ({ status: 403, json: {} }));
  assert.match((await mod.adminActions.testKey(c)).error, /refuse/);
  assert.equal((await svc.status(c)).state, "refused");
  serve(() => ({ status: 500, json: {} }));
  assert.match((await mod.adminActions.testKey(makeCtx())).error, /injoignable/);
  assert.match((await mod.adminActions.testKey(makeCtx({ settings: {} }))).error, /Aucune clé/);
  assert.match((await mod.adminActions.testKey(makeCtx({ settings: { rawgKey: "x y" } }))).error, /format/);
});

test("écran « Quel est le bon jeu ? » : titre, jaquettes proposées (images de RAWG seulement), boutons de choix, recherche d'un autre nom", async () => {
  const c = makeCtx();
  const blocks = await mod.adminPanel(c, { query: { titre: "Hades" } });
  const html = blocks.find((b) => b.type === "html" && /candidates/.test(b.html)).html;
  assert.equal((html.match(/<img /g) ?? []).length, 2);
  assert.ok(html.includes(img(21)) && html.includes(img(22)));
  assert.ok(!/<script|onerror|javascript:/i.test(html));
  const table = blocks.find((b) => b.type === "table");
  assert.deepEqual(table.rowActions.map((a) => a.action), ["choose"]);
  assert.equal(table.rowIds[0], `21|${encodeURIComponent("Hades")}|`);
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "chooseNone"));
  // Autre recherche
  const s = await mod.adminActions.search(c, { id: "Playrooms", q: "Astro's Playroom" });
  assert.equal(s.redirect, "?titre=Playrooms&q=Astro%27s%20Playroom".replace("%27", "%27"));
  const again = await mod.adminPanel(c, { query: { titre: "Playrooms", q: "Astro's Playroom" } });
  assert.equal(again.find((b) => b.type === "table").rows.length, 1);
  assert.ok((await mod.adminActions.search(c, { id: "Playrooms", q: "x".repeat(101) })).errors.q);
  // Titre invalide
  const bad = await mod.adminPanel(c, { query: { titre: "!!!" } });
  assert.ok(bad.some((b) => b.type === "banner" && /pas valable/.test(b.text)));
  assert.ok(!bad.some((b) => b.type === "html"));
  // Un titre piégé est échappé dans le HTML.
  const evil = await mod.adminPanel(c, { query: { titre: '<img src=x onerror=alert(1)> Hades' } });
  assert.ok(!evil.filter((b) => b.type === "html").some((b) => /<img src=x/.test(b.html)));
});

test("les listes : titres à vérifier avec « Corriger » (lien) et « Ce choix est bon », corrections avec « Changer » / « Oublier », page suivante", async () => {
  const c = makeCtx();
  await svc.cover(c, { title: "Playrooms" });
  await new Promise((ok) => setTimeout(ok, 20));
  for (let k = 0; k < 30; k++) await fixes.saveFix(c, `Jeu ${k}`, { kind: "none" });
  const blocks = await mod.adminPanel(c, { query: {} });
  const tables = blocks.filter((b) => b.type === "table");
  assert.deepEqual(tables[0].rowActions.map((a) => a.href ?? a.action), ["?titre={id}", "confirm"]);
  assert.deepEqual(tables[0].rowIds, ["Playrooms"]);
  assert.equal(tables[1].rows.length, 25);
  assert.deepEqual(tables[1].rowActions.map((a) => a.href ?? a.action), ["?titre={id}", "forget"]);
  const next = blocks.find((b) => b.type === "markdown" && /cursor=/.test(b.text));
  assert.ok(next);
  const cursor = /cursor=([^)]+)\)/.exec(next.text)[1];
  const page2 = await mod.adminPanel(c, { query: { cursor } });
  assert.equal(page2.filter((b) => b.type === "table").at(-1).rows.length, 5);
  assert.ok(page2.some((b) => b.type === "adminForm" && b.action === "forgetAll"));
});

test("outils de l'assistant : lister (lecture), proposer des jeux pour un titre, corriger (une seule façon à la fois), oublier ; erreurs lisibles, jamais la clé", async () => {
  const c = makeCtx();
  const actor = { name: "essai", tokenId: "t1" };
  await svc.cover(c, { title: "Playrooms" });
  await new Promise((ok) => setTimeout(ok, 20));
  const list = await mod.mcp.rawg_covers_to_check(c, {}, actor);
  assert.equal(list.total, 1); assert.equal(list.items[0].title, "Playrooms"); assert.ok(list.items[0].coverUrl.startsWith("https://media.rawg.io/media/"));
  const withTitle = await mod.mcp.rawg_covers_to_check(c, { title: "Playrooms" }, actor);
  assert.equal(withTitle.status, "found"); assert.ok(withTitle.candidates.length >= 2); assert.deepEqual(Object.keys(withTitle.candidates[0]).sort(), ["coverUrl", "name", "platforms", "rawgId", "year"]);
  const set = await mod.mcp.rawg_cover_set(c, { title: "Playrooms", rawgId: 11, search: "Astro's Playroom" }, actor);
  assert.deepEqual([set.saved, set.choice, set.game], [true, "game", "Astro's Playroom"]);
  await assert.rejects(mod.mcp.rawg_cover_set(c, { title: "Playrooms", none: true, rawgId: 11 }, actor), /exactly one/);
  await assert.rejects(mod.mcp.rawg_cover_set(c, { title: "", none: true }, actor), (e) => e.expose === true && /title/.test(e.message));
  await assert.rejects(mod.mcp.rawg_cover_set(c, { title: "Playrooms", imageUrl: "https://evil.example/a.jpg" }, actor), (e) => e.expose === true && /media\.rawg\.io/.test(e.message));
  assert.deepEqual(await mod.mcp.rawg_cover_set(c, { title: "Playrooms", forget: true }, actor), { forgotten: true, title: "Playrooms" });
  await assert.rejects(mod.mcp.rawg_cover_set(makeCtx({ settings: {} }), { title: "Hades", rawgId: 21 }, actor), /No RAWG key/);
  assert.ok(![list, withTitle, set].some((x) => JSON.stringify(x).includes(KEY)));
});

test("mise à jour à chaud : l'ancienne et la nouvelle version se chargent l'une après l'autre dans le même processus, sans mélange", async () => {
  const a = (await import(`../modules/game-covers/index.mjs?v=1.0.0`)).default;
  const b = (await import(`../modules/game-covers/index.mjs?v=1.0.1`)).default;
  assert.notEqual(a.services["game.cover"].cover, b.services["game.cover"].cover, "chaque version a ses propres fichiers");
  const c = makeCtx();
  assert.equal((await a.services["game.cover"].cover(c, "Hades")).status, "found");
  assert.equal((await b.services["game.cover"].cover(c, "Hades")).status, "found");
  assert.ok(Array.isArray(await b.adminPanel(c, { query: {} })));
});

test("aucun nom de site, aucune clé réelle, aucun minuteur dans le code du module", () => {
  const files = fs.readdirSync(DIR).filter((x) => x.endsWith(".mjs"));
  const code = files.map((x) => fs.readFileSync(`${DIR}${x}`, "utf8")).join("\n");
  assert.ok(!/setInterval/.test(code), "pas de minuteur de fond");
  assert.ok(!/\bfetch\(/.test(code), "tout passe par ctx.api.net");
  assert.ok(!/console\.(log|info|warn|error)\([^)]*\bkey\b(?!\w)/.test(code.replace(/error\?\.name/g, "")), "la clé n'est jamais journalisée");
});
