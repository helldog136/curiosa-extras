// Suggestions de jeux 1.5.0 : l'administration ajoute elle-même un jeu (ou une liste, un par ligne). Un seul champ obligatoire (le nom), « déjà joué » par défaut,
// jaquette automatique (service du module, sinon ancienne interface du cœur, sinon rien), doublon refusé sous le champ, tout ou rien, plafond de 2000, pas de nouvelle surface publique.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const DIR = new URL("../modules/game-suggestions", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const mod = await import("../modules/game-suggestions/index.mjs");
const def = mod.default;
let n = 0;
const ctxIn = (lang) => (settings = {}, over = {}) => fakeCtx({ key: `ga${++n}`, basePath: "suggestions", messages: readJson(`locales/${lang}.json`), settings, locale: lang, ...over });
const ctx = ctxIn("fr"), ctxEn = ctxIn("en");
const COVER = "https://media.example.test/cover.jpg";
const all = (c) => c.api.store.list("games", { limit: 5000 });
const formReq = (url, fields) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.set(k, v); return new Request(url, { method: "POST", body: fd, headers: { "x-forwarded-for": "1.1.1.1" } }); };

test("un seul champ obligatoire : le nom ; « déjà joué » par défaut ; marqué administration, sans pseudo ; jaquette trouvée toute seule", async () => {
  const c = ctx({}, { rawgCover: { status: "found", url: COVER } });
  const r = await def.adminActions.addGame(c, { title: "  Hollow\u0007   Knight " });
  assert.match(r.ok, /Hollow Knight/); assert.match(r.ok, /Déjà joué/); assert.match(r.ok, /trouvée toute seule/);
  const [g] = await all(c);
  assert.deepEqual([g.data.title, g.data.status, g.data.origin, g.data.submitterName, g.data.coverUrl, g.data.replayVotes], ["Hollow Knight", "already_played", "admin", null, COVER, 0]);
  assert.equal(g.data.coverResult, "found"); assert.equal(g.data.coverTries, 1);
  assert.deepEqual(c.calls.rawg, ["Hollow Knight"]);
});

test("le formulaire d'ajout : champs, valeur par défaut, aide et libellés simples ; note et image repliées, plusieurs jeux derrière le lien", async () => {
  const c = ctx();
  const blocks = await def.adminPanel(c, { query: {} });
  const form = blocks.find((b) => b.type === "adminForm" && b.action === "addGame");
  assert.deepEqual(form.fields.map((f) => f.name), ["title", "status", "note", "image"]);
  assert.deepEqual(form.fields.filter((f) => f.folded).map((f) => f.name), ["note", "image"], "la note et l'image, rares, sont repliées sous « Plus d'options » : deux champs visibles");
  assert.equal(form.fields.filter((f) => f.required).length, 1);
  const status = form.fields.find((f) => f.name === "status");
  assert.equal(status.value, "already_played"); assert.equal(status.options[0].value, "already_played");
  assert.deepEqual(status.options.map((o) => o.value).sort(), ["accepted", "already_played", "finished", "planned", "proposed", "rejected"]);
  assert.equal(form.submitLabel, "Ajouter le jeu");
  const many = (await def.adminPanel(c, { query: { ajout: "plusieurs" } })).find((b) => b.action === "addGames");
  assert.equal(many.fields.find((f) => f.name === "titles").kind, "textarea");
  assert.equal((await def.adminPanel(c, { query: { ajout: "<script>" } })).find((b) => b.action === "addGame").fields.length, 4, "un mode inconnu retombe sur le formulaire simple");
  for (const f of [...form.fields, ...many.fields]) assert.ok(def.adminActions[form.action] && def.adminActions[many.action] && f.label);
});

test("statuts au choix, note facultative ; note trop longue, statut inconnu : erreur sous le champ", async () => {
  const c = ctx({}, { rawgCover: { status: "none", url: null } });
  await def.adminActions.addGame(c, { title: "A", status: "planned", note: "Pour le week-end" });
  await def.adminActions.addGame(c, { title: "B", status: "rejected" });
  const rows = await all(c);
  assert.deepEqual(rows.map((g) => [g.data.title, g.data.status, g.data.note]).sort(), [["A", "planned", "Pour le week-end"], ["B", "rejected", null]]);
  const long = await def.adminActions.addGame(c, { title: "C", note: "x".repeat(281) });
  assert.match(long.errors.note, /280/);
  assert.ok((await def.adminActions.addGame(c, { title: "C", status: "nimporte" })).errors.status);
  assert.equal(await c.api.store.count("games"), 2);
});

test("erreur sous le champ avec un exemple : nom vide ou trop long", async () => {
  const c = ctx();
  assert.match((await def.adminActions.addGame(c, { title: "   " })).errors.title, /par exemple : Celeste/);
  assert.match((await def.adminActions.addGame(c, { title: "x".repeat(101) })).errors.title, /100 caractères.*Celeste/);
  assert.match((await def.adminActions.addGames(c, { titles: " \n \n" })).errors.titles, /un par ligne.*Celeste/);
  const en = ctxEn();
  assert.match((await def.adminActions.addGame(en, { title: "" })).errors.title, /for example: Celeste/);
  assert.equal(await c.api.store.count("games"), 0);
});

test("doublon : comparaison sans accents, majuscules ni ponctuation, lignes rejetées comprises ; dit où est le jeu et que faire ; rien d'ajouté", async () => {
  const c = ctx({}, { rawgCover: { status: "none", url: null } });
  await c.api.store.add("games", { title: "Pokémon : Rouge", status: "rejected", replayVotes: 0 });
  const dup = await def.adminActions.addGame(c, { title: "pokemon rouge!" });
  assert.match(dup.errors.title, /« Pokémon : Rouge » est déjà dans la liste \(Rejeté\)/);
  assert.match(dup.errors.title, /menu ⋯ de sa ligne/);
  assert.equal(dup.ok, undefined);
  assert.equal(await c.api.store.count("games"), 1);
  assert.equal(mod.titleKey("Pokémon : Rouge"), mod.titleKey("POKEMON-rouge"));
  assert.notEqual(mod.titleKey("Zelda 2"), mod.titleKey("Zelda 3"));
  assert.ok(mod.titleKey("???"), "un titre sans lettre garde une clé");
  assert.match((await def.adminActions.addGame(ctxEn(), { title: "x" })).ok ?? "", /./);
});

test("plusieurs jeux : une ligne = un jeu, puces et lignes vides ignorées, statut commun, 50 au plus, tout ou rien", async () => {
  const c = ctx({}, { rawgCover: { status: "found", url: COVER } });
  const r = await def.adminActions.addGames(c, { titles: "Celeste\n\n- Hollow Knight\r\n* Hades\n• Tunic\n", status: "finished" });
  assert.match(r.ok, /4 jeux ajoutés \(Fini\)/); assert.match(r.ok, /Jaquettes trouvées : 4/);
  assert.deepEqual((await all(c)).map((g) => g.data.title).sort(), ["Celeste", "Hades", "Hollow Knight", "Tunic"]);
  assert.ok((await all(c)).every((g) => g.data.status === "finished" && g.data.origin === "admin" && g.data.note === null));
  assert.match((await def.adminActions.addGames(ctx(), { titles: "Un seul" })).ok, /^« Un seul » est dans la liste/, "une liste d'une ligne se dit comme un seul jeu");
  const lines = Array.from({ length: 51 }, (_, i) => `Jeu ${i}`).join("\n");
  const tooMany = await def.adminActions.addGames(c, { titles: lines });
  assert.match(tooMany.errors.titles, /51 lignes, 50 au plus/);
  const ok50 = ctx({}, { rawgCover: { status: "none", url: null } });
  assert.match((await def.adminActions.addGames(ok50, { titles: lines.split("\n").slice(0, 50).join("\n") })).ok, /50 jeux ajoutés/);
  assert.equal(await ok50.api.store.count("games"), 50);
});

test("plusieurs jeux : doublons dans la base ou dans la liste, nom trop long → rien n'est ajouté, les lignes fautives sont citées, 5 au plus", async () => {
  const c = ctx({}, { rawgCover: { status: "none", url: null } });
  await c.api.store.add("games", { title: "Celeste", status: "proposed", replayVotes: 0 });
  const r = await def.adminActions.addGames(c, { titles: `Hades\ncéleste\nTunic\nhades\n${"y".repeat(101)}\nA\nB` });
  const msg = r.errors.titles;
  assert.match(msg, /^Rien n'a été ajouté\./);
  assert.match(msg, /Ligne 2 : « Celeste » est déjà dans la liste \(Proposé\)/);
  assert.match(msg, /Ligne 4 : « hades » est déjà écrit à la ligne 1/);
  assert.match(msg, /Ligne 5 : nom trop long/);
  assert.match(msg, /Retirez ou corrigez ces lignes/);
  assert.equal(await c.api.store.count("games"), 1, "tout ou rien");
  const many = await def.adminActions.addGames(c, { titles: Array.from({ length: 8 }, () => "Celeste").join("\n") });
  assert.match(many.errors.titles, /… et 3 autres lignes\./);
  const one = await def.adminActions.addGames(c, { titles: "Celeste\nCeleste\nCeleste\nCeleste\nCeleste\nCeleste" });
  assert.match(one.errors.titles, /… et 1 autre ligne\./);
});

test("plafond de 2000 : liste pleine → message général ; trop de lignes pour la place restante → sous le champ (pluriel et singulier)", async () => {
  const c = ctx({}, { rawgCover: { status: "none", url: null } });
  await c.api.store.addMany("games", Array.from({ length: 1998 }, (_, i) => ({ data: { title: `Existant ${i}`, status: "proposed", replayVotes: 0 } })));
  assert.match((await def.adminActions.addGames(c, { titles: "A\nB\nC" })).errors.titles, /place que pour 2 jeux/);
  const one = ctx({}, { rawgCover: { status: "none", url: null } });
  await one.api.store.addMany("games", Array.from({ length: 1999 }, (_, i) => ({ data: { title: `Existant ${i}`, status: "proposed", replayVotes: 0 } })));
  assert.match((await def.adminActions.addGames(one, { titles: "A\nB" })).errors.titles, /place que pour 1 jeu \(/);
  assert.match((await def.adminActions.addGame(one, { title: "A" })).ok, /dans la liste/);
  const full = await def.adminActions.addGame(one, { title: "B" });
  assert.match(full.error, /La liste est pleine \(2000 jeux\)/);
  assert.equal(await one.api.store.count("games"), 2000);
});

test("doublon détecté même au-delà de 1000 lignes (la liste d'admin va jusqu'à 2000)", async () => {
  const c = ctx({}, { rawgCover: { status: "none", url: null } });
  await c.api.store.addMany("games", Array.from({ length: 1500 }, (_, i) => ({ data: { title: `Jeu numéro ${i}`, status: "proposed", replayVotes: 0 } })));
  assert.ok((await def.adminActions.addGame(c, { title: "jeu numéro 0" })).errors.title);
  assert.ok((await def.adminActions.addGame(c, { title: "jeu numéro 1499" })).errors.title);
  const panel = await def.adminPanel(c, { query: {} });
  assert.match(panel.find((b) => b.type === "heading" && /1500/.test(b.text)).text, /1500/);
});

test("jaquette : service du module d'abord, puis ancienne interface du cœur, puis rien ; en lot, 10 recherches au plus (le reste est laissé au rattrapage)", async () => {
  const viaModule = ctx({}, { services: { "game.cover": { cover: () => ({ status: "found", url: "https://media.example.test/module.jpg" }), status: () => ({ configured: true }) } }, rawgCover: { status: "found", url: COVER } });
  await def.adminActions.addGame(viaModule, { title: "Celeste" });
  assert.equal((await all(viaModule))[0].data.coverUrl, "https://media.example.test/module.jpg");
  assert.deepEqual(viaModule.calls.rawg, [], "le cœur n'est pas appelé quand le module répond");
  const viaCore = ctx({}, { rawgCover: { status: "found", url: COVER } });
  await def.adminActions.addGame(viaCore, { title: "Celeste" });
  assert.equal((await all(viaCore))[0].data.coverUrl, COVER);
  const noKey = ctx({}, { rawgConfigured: false, rawgCover: { status: "no-key", url: null } });
  const r = await def.adminActions.addGame(noKey, { title: "Celeste" });
  assert.match(r.ok, /cherchée un peu plus tard/);
  const row = (await all(noKey))[0].data;
  assert.equal(row.coverUrl, null); assert.equal(row.coverKey, undefined, "pas d'essai compté : le rattrapage s'en charge");
  const none = ctx({}, { rawgCover: { status: "none", url: null } });
  assert.match((await def.adminActions.addGame(none, { title: "Inconnu" })).ok, /Aucune jaquette trouvée.*Changer la jaquette/);
  const bad = ctx({}, { rawgCover: { status: "found", url: "javascript:alert(1)" } });
  await def.adminActions.addGame(bad, { title: "X" });
  assert.equal((await all(bad))[0].data.coverUrl, null, "https seulement");
  const boom = ctx({}, { rawgCover: () => { throw new Error("réseau"); } });
  assert.ok((await def.adminActions.addGame(boom, { title: "Y" })).ok, "une panne du service ne bloque jamais l'ajout");
  const bulk = ctx({}, { rawgCover: { status: "found", url: COVER } });
  await def.adminActions.addGames(bulk, { titles: Array.from({ length: 30 }, (_, i) => `Lot ${i}`).join("\n") });
  assert.equal(bulk.calls.rawg.length, 10);
  assert.equal((await all(bulk)).filter((g) => g.data.coverUrl).length, 10);
  const down = ctx({}, { rawgCover: { status: "unreachable", url: null } });
  await def.adminActions.addGames(down, { titles: "A1\nA2\nA3" });
  assert.equal(down.calls.rawg.length, 1, "RAWG injoignable : on arrête de chercher");
  assert.equal(await down.api.store.count("games"), 3);
});

test("rattrapage : un jeu ajouté sans jaquette est cherché ensuite par la tâche existante, comme une suggestion", async () => {
  const c = ctx({}, { rawgConfigured: false, rawgCover: { status: "no-key", url: null } });
  await def.adminActions.addGames(c, { titles: "Celeste\nHades" });
  const c2 = Object.assign(c, {});
  c2.api.rawg.cover = async () => ({ status: "found", url: COVER });
  c2.api.rawg.configured = async () => true;
  const r = await mod.catchUpCovers(c2, { force: true, pauseMs: 0 });
  assert.equal(r.found, 2);
  assert.ok((await all(c2)).every((g) => g.data.coverUrl === COVER && g.data.origin === "admin"));
});

test("image à la main : https seulement, sans espace ; erreur sous le champ avec un exemple ; elle remplace la recherche et n'est jamais écrasée", async () => {
  const c = ctx({}, { rawgCover: { status: "found", url: COVER } });
  for (const bad of ["exemple.org/a.jpg", "http://exemple.org/a.jpg", "javascript:alert(1)", "https://exemple.org/a b.jpg", `https://exemple.org/"onerror=x`, "https://exemple.org/" + "a".repeat(500)]) {
    const r = await def.adminActions.addGame(c, { title: "Celeste", image: bad });
    assert.match(r.errors.image, /https:\/\/exemple\.org\/jaquette\.jpg/, bad);
  }
  assert.equal(await c.api.store.count("games"), 0);
  const ok = await def.adminActions.addGame(c, { title: "Celeste", image: " https://exemple.org/a.jpg " });
  assert.match(ok.ok, /Votre image est enregistrée/);
  const g = (await all(c))[0];
  assert.equal(g.data.coverUrl, "https://exemple.org/a.jpg"); assert.equal(g.data.coverResult, "manual");
  assert.deepEqual(c.calls.rawg, [], "pas de recherche quand l'image est donnée");
  assert.equal(mod.imageUrlOf("https://exemple.org/a.jpg?x=1&y=2"), "https://exemple.org/a.jpg?x=1&y=2");
});

test("écran « Jaquette… » d'une ligne : lien « Ce n'est pas le bon jeu ? » encodé, image à la main (setImage) ; ligne inconnue refusée", async () => {
  const c = ctx({}, { rawgCover: { status: "found", url: COVER } });
  await def.adminActions.addGame(c, { title: "Zelda (Tears) & l'été !" });
  const [g] = await all(c);
  const panel = await def.adminPanel(c, { query: { jaquette: g.id } });
  const md = panel.filter((b) => b.type === "markdown").map((b) => b.text).join("\n");
  assert.ok(md.includes(`](${mod.wrongCoverHref("Zelda (Tears) & l'été !")})`) && md.includes("Ce n'est pas le bon jeu ?"));
  const table = panel.find((b) => b.type === "table");
  assert.ok(table.rowActions.some((a) => a.href === "?tab=use&jaquette={id}"));
  const f = panel.find((b) => b.action === "setImage");
  assert.deepEqual(f.fields.map((x) => x.name), ["id", "image"]);
  assert.match((await def.adminActions.setImage(c, { id: g.id, image: "nope" })).errors.image, /https:\/\//);
  assert.equal((await def.adminActions.setImage(c, { id: g.id, image: "https://exemple.org/b.jpg" })).ok, "Image enregistrée.");
  assert.equal((await c.api.store.get(g.id)).data.coverUrl, "https://exemple.org/b.jpg");
  assert.ok((await def.adminActions.setImage(c, { id: "inconnu", image: "https://exemple.org/b.jpg" })).error);
  const ghost = await def.adminPanel(c, { query: { jaquette: "inconnu" } });
  assert.ok(!ghost.some((b) => b.action === "setImage"), "ligne inconnue : pas d'écran");
});

test("la ligne ajoutée compte comme les autres : page publique sans pseudo, vote « rejoue-le » si déjà joué, caché si rejeté, CSV avec l'origine, MCP", async () => {
  const c = ctx({}, { rawgCover: { status: "none", url: null } });
  await def.adminActions.addGame(c, { title: "Celeste" });
  await def.adminActions.addGame(c, { title: "Caché", status: "rejected" });
  await def.adminActions.addGame(c, { title: "Prévu", status: "planned" });
  const html = (await def.page(c, { segments: [] })).blocks.find((b) => b.type === "html").html;
  assert.ok(html.includes("Celeste") && html.includes("Prévu") && !html.includes("Caché"));
  assert.ok(!/ · par /.test(html) && !/ · by /.test(html), "pas de pseudo");
  assert.equal((html.match(/\/vote"/g) ?? []).length, 1, "le vote n'existe que pour le jeu déjà joué");
  const id = (await all(c)).find((g) => g.data.title === "Celeste").id;
  assert.equal((await def.routes.vote(formReq("https://x.test/m/k/vote", { id }), c)).status, 303);
  assert.equal((await c.api.store.get(id)).data.replayVotes, 1);
  const [file] = await def.backup.readable(c);
  const lines = file.content.replace("﻿", "").trim().split("\r\n");
  assert.match(lines[0], /"votes","origin"$/);
  assert.match(lines.find((l) => l.includes("Celeste")), /"admin"$/);
  const listed = await def.mcp.game_suggestions_list(c, {});
  assert.deepEqual(listed.map((g) => g.origin), ["admin", "admin", "admin"]);
  const table = (await def.adminPanel(c, { query: {} })).find((b) => b.type === "table");
  assert.ok(table.rows.every((r) => r[2].text === "Vous" && r[2].badge === "accent"), "origine : pastille colorée et écrite");
  assert.equal(JSON.stringify(await def.adminPanel(c, { query: {} })).includes("à traiter"), true);
  assert.match((await def.adminPanel(c, { query: {} })).find((b) => b.type === "heading" && /\(3,/.test(b.text)).text, /0 à traiter/, "les jeux ajoutés par l'administration ne gonflent pas « à traiter »");
});

test("une suggestion de visiteur reste inchangée : pas d'origine administration, comptée « à traiter »", async () => {
  const c = ctx({}, { rawgCover: { status: "none", url: null } });
  const fd = new FormData(); fd.set("title", "Visiteur"); fd.set("name", "Alice");
  assert.equal((await def.routes.suggest(new Request("https://x.test/m/k/suggest", { method: "POST", body: fd, headers: { "x-forwarded-for": "5.5.5.5" } }), c)).status, 200);
  const [g] = await all(c);
  assert.equal(g.data.origin, undefined);
  const list = await def.mcp.game_suggestions_list(c, {});
  assert.deepEqual([list[0].origin, list[0].submitter], ["visitor", "Alice"]);
  assert.match((await def.adminPanel(c, { query: {} })).find((b) => b.type === "heading" && /\(1,/.test(b.text)).text, /1 à traiter/);
});

test("une ligne d'avant 1.5.0 (sans origin) reste lisible, et le panneau s'ouvre sans paramètre (ancien appel)", async () => {
  const c = ctx();
  await c.api.store.add("games", { title: "Ancien", status: "already_played", submitterName: "Bob", replayVotes: 2 });
  const blocks = await def.adminPanel(c);
  const first = blocks.find((b) => b.type === "table").rows[0];
  assert.equal(first[2].text, "Public"); assert.match(first[0].title, /par Bob/, "le pseudo est dans l'info-bulle (et donc cherchable)");
});

test("tableau d'admin : toutes les lignes sont envoyées, le cœur pagine par 50 et la recherche couvre tout ; plus de pagination à la main", async () => {
  const c = ctx({}, { rawgCover: { status: "none", url: null } });
  await c.api.store.addMany("games", Array.from({ length: 120 }, (_, i) => ({ data: { title: `Jeu ${i}`, status: "proposed", replayVotes: 0 } })));
  const blocks = await def.adminPanel(c, { query: { page: "3" } });
  const table = blocks.find((b) => b.type === "table");
  assert.equal(table.rows.length, 120); assert.equal(table.rowIds.length, 120);
  assert.equal(table.pageSize, 50); assert.equal(table.searchable, true);
  assert.deepEqual(table.filters.map((f) => f.column), [1]);
  assert.ok(!blocks.some((b) => b.type === "html" && /Jeux \d+ à/.test(b.html)), "plus de pagination faite à la main");
});

test("statut : une pastille colorée ET écrite par ligne, six changements dans le menu ⋯ (jamais huit boutons), suppression en danger", async () => {
  const c = ctx({}, { rawgCover: { status: "none", url: null } });
  await def.adminActions.addGame(c, { title: "Celeste", status: "planned" });
  const table = (await def.adminPanel(c, { query: {} })).find((b) => b.type === "table");
  assert.deepEqual(table.rows[0][1], { text: "Planifié", badge: "info" });
  const visible = table.rowActions.filter((a) => !a.inMenu && !a.danger);
  assert.deepEqual(visible.map((a) => a.label), ["Changer la jaquette"], "un seul bouton visible");
  assert.equal(table.rowActions.filter((a) => a.inMenu && /^status_/.test(a.action)).length, 6);
  assert.ok(table.rowActions.find((a) => a.action === "remove").danger);
  assert.ok(table.rowActions.every((a) => !/^→/.test(a.label)), "plus de « → Proposé »");
});

test("liens de l'administration : cibles d'au moins 44 px, aucun lien ne sort du module", async () => {
  const c = ctx();
  const html = (await def.adminPanel(c, { query: {} })).filter((b) => b.type === "html").map((b) => b.html).join("");
  assert.match(html, /min-height:44px/);
  for (const m of html.matchAll(/href="([^"]*)"/g)) assert.match(m[1], /^\?/, m[1]);
});

test("MCP : game_suggestions_add — un jeu, une liste, mêmes refus que le formulaire ; erreurs exposées", async () => {
  const c = ctx({}, { rawgCover: { status: "found", url: COVER } });
  const one = await def.mcp.game_suggestions_add(c, { title: "Celeste", note: "Super" });
  assert.deepEqual([one.added, one.status, one.titles], [1, "already_played", ["Celeste"]]);
  const many = await def.mcp.game_suggestions_add(c, { titles: ["Hades", "Tunic"], status: "finished" });
  assert.deepEqual([many.added, many.status], [2, "finished"]);
  await assert.rejects(def.mcp.game_suggestions_add(c, { title: "celeste" }), (e) => e.expose === true && /déjà dans la liste|already in the list/.test(e.message));
  await assert.rejects(def.mcp.game_suggestions_add(c, {}), (e) => e.expose === true);
  await assert.rejects(def.mcp.game_suggestions_add(c, { title: "X", status: "nimporte" }), (e) => e.expose === true);
  await assert.rejects(def.mcp.game_suggestions_add(c, { titles: ["A", "B"], imageUrl: "https://exemple.org/a.jpg" }), /single title/);
  await assert.rejects(def.mcp.game_suggestions_add(c, { titles: Array.from({ length: 51 }, (_, i) => `J${i}`) }), (e) => e.expose === true);
  assert.equal(await c.api.store.count("games"), 3);
  const img = await def.mcp.game_suggestions_add(c, { title: "Avec image", imageUrl: "https://exemple.org/i.jpg" });
  assert.equal(img.added, 1);
  assert.equal((await all(c)).find((g) => g.data.title === "Avec image").data.coverUrl, "https://exemple.org/i.jpg");
  const spec = readJson("module.json").mcp.find((t) => t.name === "game_suggestions_add");
  assert.ok(spec && !spec.readOnly && !spec.input.required);
});

test("aucune nouvelle surface publique : mêmes routes, aucune action d'ajout dans routes ni dans la page publique", async () => {
  assert.deepEqual(Object.keys(def.routes).sort(), ["element/:slug", "suggest", "vote"]);   // « element/:slug » : la page de l'élément d'overlay (1.6.0), rien d'autre de public
  const c = ctx();
  const page = JSON.stringify(await def.page(c, { segments: [] }));
  assert.ok(!page.includes("addGame") && !page.includes("adminForm"));
  assert.deepEqual(readJson("module.json").permissions.sort(), ["admin", "mcp", "pages", "rawg", "routes", "storage"]);
});

test("parité FR/EN des textes de l'ajout : mêmes clés, mêmes variables {x}, variantes _one présentes des deux côtés", () => {
  const fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of Object.keys(fr)) assert.equal(vars(fr[k]), vars(en[k]), k);
  for (const k of Object.keys(fr).filter((k) => k.endsWith("_one"))) assert.ok(k.slice(0, -4) in fr && k.slice(0, -4) in en, k);
  assert.ok(["errManyMore", "errRoom"].every((k) => `${k}_one` in en && `${k}_one` in fr));
  const source = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
  for (const m of source.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in en, m[1]);
  for (const m of source.matchAll(/plural\(ctx, "([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in en && `${m[1]}_one` in en, m[1]);
  for (const k of ["manyLabel", "addGameLabel"]) assert.ok(!/[Ss]tatut technique|JSON|API/.test(fr[k]));
});
