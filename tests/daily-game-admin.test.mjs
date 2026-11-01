// Jeu du jour — l'administration : gabarits et packs, formulaire et erreurs sous les champs, planning, ordre, liste, aperçu, import/export CSV, classement, assistant.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeAudience } from "./helpers/fakeAudience.mjs";
import { def, D, K, PK, L, manifest, ctxFor, addQuestion, addMany, rows, at, NOON, textOf } from "./helpers/dailyGameKit.mjs";

const clockAt = (ms) => { D.clock.now = () => ms; };
test.afterEach(() => { D.clock.now = () => Date.now(); });
const act = (ctx, name, values = {}) => def.adminActions[name].run(ctx, values);
const panel = (ctx, query = {}) => def.adminPanel(ctx, { query });
const qs = (ctx) => rows(ctx, "dg_questions");
const tables = (blocks) => blocks.filter((b) => b.type === "table");
const form = (blocks, action) => blocks.find((b) => b.type === "adminForm" && b.action === action);
const good = (extra = {}) => ({ state: "published", q_fr: "Quelle couleur donne le bleu et le jaune ?", a1_fr: "Le vert", a2_fr: "Le violet", a3_fr: "L'orange", correct: "1", e_fr: "Le bleu et le jaune donnent du vert.", ...extra });
const csv = (...lines) => `${lines.join("\r\n")}\r\n`;

test("départ : « Par où commencer ? » propose les gabarits ; seuls ceux qui peuvent écrire ET publier le voient", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  const blocks = await panel(ctx);
  assert.ok(blocks.some((b) => b.type === "heading" && b.text === "Par où commencer ?"));
  assert.equal(blocks[0].type, "markdown", "une phrase dit à quoi sert la page");
  const t = tables(blocks)[0];
  assert.deepEqual(t.rowIds, ["games", "empty"]);
  assert.equal(t.rows[0][0], "Culture jeu vidéo"); assert.match(t.rows[0][1], /30 questions prêtes/);
  assert.equal(t.rowActions[0].action, "applyTemplate");
  assert.ok(!textOf(await panel(ctxFor({}, { rights: [] }))).includes("Par où commencer"));
});

test("gabarit « Culture jeu vidéo » : 30 questions publiées en un clic, le choix de départ disparaît", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  assert.equal((await act(ctx, "applyTemplate", { id: "games" })).ok, "Parfait : 30 questions sont prêtes et publiées.");
  assert.equal(qs(ctx).length, 30);
  assert.ok(qs(ctx).every((q) => q.status === "published" && q.by === "pack" && /^games:\d+$/.test(q.pack)));
  const blocks = await panel(ctx);
  assert.ok(!textOf(blocks).includes("Par où commencer"));
  assert.match(textOf(blocks), /29 jours/);
  assert.equal(rows(ctx, "dg_plan")[0].tpl, "games");
});

test("gabarit « Vide » : rien n'est ajouté, le choix ne revient pas ; gabarit inconnu refusé", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  assert.match((await act(ctx, "applyTemplate", { id: "empty" })).ok, /page vide/);
  assert.equal(qs(ctx).length, 0);
  const blocks = await panel(ctx);
  assert.ok(!textOf(blocks).includes("Par où commencer"));
  assert.match(textOf(blocks), /Aucune question n'est prête/);
  assert.match((await act(ctx, "applyTemplate", { id: "inconnu" })).error, /n'existe plus/);
});

test("packs : activer, réactiver sans doublon, compléter, retirer", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  assert.equal((await act(ctx, "activatePack", { id: "streaming" })).ok, "30 questions ajoutées et publiées.");
  assert.equal((await act(ctx, "activatePack", { id: "streaming" })).ok, "Ce pack est déjà activé en entier.");
  await ctx.api.store.remove(qs(ctx)[0].id); D.invalidate(ctx);
  assert.equal((await act(ctx, "activatePack", { id: "streaming" })).ok, "1 questions ajoutées et publiées.");
  await act(ctx, "activatePack", { id: "games" });
  assert.equal(qs(ctx).length, 60);
  assert.match(tables(await panel(ctx)).find((t) => t.rowIds?.join() === "games,streaming").rows[0][2].text, /30 sur 30 questions/);
  assert.equal((await act(ctx, "removePack", { id: "games" })).ok, "30 questions retirées.");
  assert.ok(qs(ctx).every((q) => q.pack.startsWith("streaming:")));
});

test("packs : la banque ne dépasse jamais 2 000 questions", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  for (let i = 0; i < 1990; i++) await ctx.api.store.add("dg_questions", { type: "quiz", status: "draft", pos: i, by: "admin", d: { tr: { fr: { q: `Q${i}`, a: ["a", "b"] } }, correct: 0 } });
  assert.match((await act(ctx, "activatePack", { id: "games" })).error, /La banque est pleine \(2000 questions\)/);
  assert.equal(qs(ctx).length, 1990);
});

test("formulaire : les champs dans l'ordre d'une personne qui écrit", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  const f = form(await panel(ctx, { new: "1" }), "saveQuestion");
  assert.deepEqual(f.fields.map((x) => x.name), ["id", "q_fr", "answers_fr", "correct", "e_fr", "q_en", "answers_en", "e_en", "image", "alt_fr", "alt_en", "cat", "lvl", "date", "state"]);
  assert.deepEqual(f.fields.filter((x) => x.kind !== "hidden" && !x.folded).map((x) => x.name), ["q_fr", "answers_fr", "correct"], "chemin court : la question, les réponses, la bonne ; tout le reste est replié");
  assert.equal(f.fields.find((x) => x.name === "correct").kind, "segmented");
  assert.equal(f.submitLabel, "Ajouter la question");
  assert.equal(f.fields.find((x) => x.name === "date").kind, "date");
  assert.equal(f.fields.find((x) => x.name === "image").kind, "image");
  assert.equal(f.cancelHref, `/admin/instances/${ctx.instance.id}`);
  for (const x of f.fields) if (x.kind !== "hidden") assert.ok(x.label && !x.label.includes("{"), x.name);
});

test("question : écrite, publiée, modifiée ; l'ordre et l'origine sont gardés", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  const r = await act(ctx, "saveQuestion", good({ cat: "Couleurs", lvl: "easy" }));
  assert.deepEqual([r.ok, r.redirect], ["Publiée : la question entre dans le jeu.", "?"]);
  const [q] = qs(ctx);
  assert.deepEqual([q.status, q.cat, q.lvl, q.by, q.d.correct, Object.keys(q.d.tr)], ["published", "Couleurs", "easy", "admin", 0, ["fr"]]);
  assert.equal((await act(ctx, "saveQuestion", { ...good({ q_fr: "Quelle couleur fait bleu plus jaune ?" }), id: q.id })).ok, "Enregistré.");
  assert.equal(qs(ctx)[0].pos, q.pos);
  assert.match((await act(ctx, "saveQuestion", { ...good(), id: "inconnu" })).error, /n'existe plus/);
});

test("question : deux langues — même nombre de réponses", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  assert.ok((await act(ctx, "saveQuestion", good({ q_en: "Which colour?", a1_en: "Green", a2_en: "Purple", a3_en: "Orange" }))).ok);
  const bad = await act(ctx, "saveQuestion", good({ q_en: "Which colour?", a1_en: "Green", a2_en: "Purple" }));
  assert.match(bad.errors.a1_en, /En anglais, il y a 2 réponses mais 3 en français/);
  assert.equal(qs(ctx).length, 1);
});

test("erreurs sous le bon champ, avec un exemple, et rien n'est enregistré", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  const check = async (values, field, re) => { const r = await act(ctx, "saveQuestion", values); assert.ok(r.errors?.[field], `${field} : ${JSON.stringify(r)}`); assert.match(r.errors[field], re); assert.equal(r.ok, undefined); };
  await check(good({ q_fr: "" }), "q_fr", /Écrivez la question en français, par exemple/);
  await check(good({ a1_fr: "", a2_fr: "", a3_fr: "" }), "a1_fr", /Il faut au moins deux réponses en français/);
  await check(good({ a2_fr: "" }), "a2_fr", /Remplissez les réponses dans l'ordre : la réponse 2 est vide/);
  await check(good({ a2_fr: "le vert" }), "a2_fr", /même que la réponse 1/);
  await check(good({ correct: "4" }), "correct", /La bonne réponse est la n° 4, mais il n'y a que 3 réponses/);
  await check(good({ correct: "" }), "correct", /Choisissez la bonne réponse/);
  await check(good({ image: "https://autre.example/x.png" }), "image", /image envoyée sur ce site/);
  await check(good({ image: "/uploads/chat.png" }), "alt_fr", /Décrivez l'image en français/);
  await check(good({ date: "2026-02-30" }), "date", /vraie date, par exemple 2026-12-31/);
  await check(good({ date: "2026-10-01" }), "date", /à partir d'aujourd'hui/);
  await check(good({ q_fr: "", a1_fr: "", a2_fr: "", a3_fr: "", e_fr: "" }), "q_fr", /Écrivez au moins une question/);
  await check(good({ lvl: "extreme" }), "lvl", /Choisissez un niveau/);
  assert.equal(qs(ctx).length, 0);
  assert.ok((await act(ctx, "saveQuestion", { state: "draft", q_fr: "À finir", correct: "1" })).ok);
  assert.ok((await act(ctx, "saveQuestion", good({ q_fr: "x".repeat(900), a1_fr: "y".repeat(900) }))).ok);
  assert.equal(qs(ctx)[1].d.tr.fr.q.length, 300);
  assert.equal(qs(ctx)[1].d.tr.fr.a[0].length, 120);
  assert.ok((await act(ctx, "saveQuestion", good({ q_fr: "Avec image ?", image: "/uploads/chat.png", alt_fr: "Un chat noir" }))).ok);
  assert.equal(qs(ctx)[2].d.img, "/uploads/chat.png");
});

test("droits : sans le droit de publier, tout reste en brouillon ; chaque action est protégée par le bon droit", async () => {
  clockAt(NOON);
  const ctx = ctxFor({}, { rights: ["edit"] });
  assert.match((await act(ctx, "saveQuestion", good())).errors.state, /pas le droit de publier/);
  assert.equal((await act(ctx, "saveQuestion", good({ state: "draft" }))).ok, "Enregistré.");
  for (const n of ["publish", "unpublish", "useToday", "applyTemplate", "activatePack", "removePack", "restartPlan"]) assert.equal(def.adminActions[n].right, "publish", n);
  for (const n of ["saveQuestion", "removeQuestion", "importCsv", "moveUp", "moveDown", "moveTop", "clearDate"]) assert.equal(def.adminActions[n].right, "edit", n);
  for (const n of ["removeBoardRow", "clearBoard"]) assert.equal(def.adminActions[n].right, "moderate", n);
  assert.deepEqual(manifest.rights.map((r) => r.id), ["edit", "publish", "moderate"]);
});

test("publier, retirer, supprimer : une question incomplète ne se publie pas", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  await act(ctx, "saveQuestion", { state: "draft", q_fr: "À finir", a1_fr: "Seule réponse", correct: "1" });
  const id = qs(ctx)[0].id;
  assert.match((await act(ctx, "publish", { id })).error, /n'est pas complète/);
  await act(ctx, "saveQuestion", { ...good({ state: "draft" }), id });
  assert.equal((await act(ctx, "publish", { id })).ok, "Publiée : la question entre dans le jeu.");
  assert.equal((await act(ctx, "unpublish", { id })).ok, "Retirée : la question est redevenue un brouillon.");
  assert.equal((await act(ctx, "removeQuestion", { id })).ok, "Question supprimée.");
  assert.match((await act(ctx, "removeQuestion", { id })).error, /n'existe plus/);
});

test("planning : une date précise, une question par date, pas dans le passé, 365 jours au plus", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  assert.ok((await act(ctx, "saveQuestion", good({ date: "2026-12-25" }))).ok);
  assert.match((await act(ctx, "saveQuestion", good({ q_fr: "Autre ?", date: "2026-12-25" }))).errors.date, /Cette date a déjà une question : « Quelle couleur donne/);
  assert.ok((await act(ctx, "saveQuestion", good({ q_fr: "À la française ?", date: "26/12/2026" }))).ok);
  assert.equal(qs(ctx)[1].date, "2026-12-26");
  for (let i = 0; i < 363; i++) await ctx.api.store.add("dg_questions", { type: "quiz", status: "draft", pos: i, by: "admin", date: L.addDays("2027-01-01", i), d: { tr: { fr: { q: `P${i}`, a: ["a", "b"] } }, correct: 0 } });
  D.invalidate(ctx);
  assert.match((await act(ctx, "saveQuestion", good({ q_fr: "De trop ?", date: "2028-06-01" }))).errors.date, /365 jours planifiés/);
  assert.ok((await act(ctx, "saveQuestion", { ...good({ date: "2026-12-25" }), id: qs(ctx)[0].id })).ok);
  assert.equal((await act(ctx, "clearDate", { id: qs(ctx)[0].id })).ok, "Date retirée : la question entre dans la rotation.");
});

test("planning : la question planifiée passe à sa date, et la liste est dans le panneau", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  await addMany(ctx, 3);
  await addQuestion(ctx, { q: "Noël ?", a: ["Oui", "Non"], date: "2026-10-25" });
  const blocks = await panel(ctx);
  assert.ok(blocks.some((b) => b.type === "heading" && b.text.startsWith("Jours planifiés (1 sur 365)")));
  assert.match(textOf(blocks), /dimanche 25 octobre/);
  clockAt(at("2026-10-25"));
  assert.equal((await D.getToday(ctx)).item.d.tr.fr.q, "Noël ?");
});

test("ordre : monter, descendre, mettre en premier — la rotation suit", async () => {
  clockAt(NOON);
  const ctx = ctxFor({ order: "sequence" });
  const [a, b, c] = await addMany(ctx, 3);
  const next = async () => (await D.outlook(ctx, { count: 3, fresh: true })).days.map((d) => d.id);
  assert.deepEqual(await next(), [a, b, c]);
  assert.equal((await act(ctx, "moveDown", { id: a })).ok, "Ordre modifié.");
  assert.deepEqual(await next(), [b, a, c]);
  await act(ctx, "moveUp", { id: c });
  assert.deepEqual(await next(), [b, c, a]);
  await act(ctx, "moveTop", { id: a });
  assert.deepEqual(await next(), [a, b, c]);
  assert.equal((await act(ctx, "moveUp", { id: a })).ok, "Cette question est déjà la première.");
  assert.equal((await act(ctx, "moveDown", { id: c })).ok, "Cette question est déjà la dernière.");
  const view = await panel(ctx, { order: "1" });
  assert.match(view[0].text, /Ordre de passage \(3 questions\)/);
  assert.deepEqual(view[2].rowActions.map((x) => x.action), ["moveUp", "moveDown", "moveTop"]);
});

test("ordre : deux questions à la même place peuvent être échangées ; « au hasard » n'a pas de boutons", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  const a = await addQuestion(ctx, { q: "A ?", a: ["x", "y"], pos: 5 });
  const b = await addQuestion(ctx, { q: "B ?", a: ["x", "y"], pos: 5 });
  await act(ctx, "moveDown", { id: a });
  assert.deepEqual((await D.outlook(ctx, { count: 2, fresh: true })).days.map((d) => d.id), [b, a]);
  const rnd = ctxFor({ order: "random" });
  await addMany(rnd, 3);
  assert.ok(!textOf(await panel(rnd)).includes("Changer l'ordre de passage"));
});

test("tableau de bord : question du jour, « il reste N jours », 7 prochains jours, avertissement et pastille", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  await addMany(ctx, 2);
  const blocks = await panel(ctx);
  const text = textOf(blocks);
  assert.match(text, /Aujourd'hui : samedi 24 octobre/);
  assert.match(text, /Question du jour : « Q1 \?/);
  assert.match(text, /Il reste \*\*1 jours\*\* de questions à venir sans répétition \(dans l'ordre\)/);
  assert.equal(blocks.find((b) => b.type === "banner").tone, "warning");
  const seven = tables(blocks).find((t) => t.columns[0] === "Jour");
  assert.equal(seven.rows.length, 7);
  assert.match(seven.rows[2][1], /le tour recommence/);
  assert.equal(await def.adminBadge(ctx), 1);
  await addMany(ctx, 10);
  assert.equal(await def.adminBadge(ctx), 0);
});

test("« Utiliser aujourd'hui » change la question du jour ; « recommencer le tour » oublie le passé", async () => {
  clockAt(NOON);
  const ctx = ctxFor({ order: "random" });
  const [a, b] = await addMany(ctx, 30);
  assert.match(textOf(await panel(ctx)), /\(au hasard\)/);
  const first = (await D.getToday(ctx)).item.id;
  const other = first === a ? b : a;
  assert.equal((await act(ctx, "useToday", { id: other })).ok, "C'est la question d'aujourd'hui.");
  assert.equal((await D.getToday(ctx)).item.id, other);
  assert.match((await act(ctx, "useToday", { id: "inconnu" })).error, /n'est pas complète/);
  await act(ctx, "restartPlan");
  assert.deepEqual(rows(ctx, "dg_plan")[0].hist, {});
});

test("liste : un tableau avec recherche en direct, pastilles d'état avec leur nombre, 50 par page", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  for (let i = 1; i <= 120; i++) await addQuestion(ctx, { q: `Question numéro ${i} ?`, a: [`Réponse${i}`, "Autre"], cat: i % 2 ? "Impair" : "Pair", status: i % 10 === 0 ? "draft" : "published", pos: i });
  const blocks = await panel(ctx);
  const list = tables(blocks).find((t) => t.columns[0] === "Question" && t.rows.length > 0 && t.rowActions?.some((x) => x.href === "?edit={id}"));
  assert.equal(list.rows.length, 120, "toutes les questions sont envoyées : la recherche du cœur couvre tout");
  assert.equal(list.rowIds.length, 120);
  assert.deepEqual([list.searchable, list.pageSize, list.truncate], [true, 50, [0]]);
  assert.equal(list.columns[list.filters[0].column], "État", "pastilles d'état (le cœur y met leur nombre)");
  assert.deepEqual([...new Set(list.rows.map((r) => r[4].text))].sort(), ["Brouillon", "Publiée"]);
  assert.ok(list.rows.every((r) => r[4].badge), "état : pastille colorée ET écrite");
  assert.match(list.rows.find((r) => r[0].text === "Question numéro 77 ?")[0].title, /Réponse77/, "les réponses sont cherchables (info-bulle)");
  assert.equal(list.rows.filter((r) => r[1] === "Pair").length, 60);
  assert.ok(list.rows.every((r) => r[2] === "Manque : EN"), "seule la langue qui manque est dite, et seulement quand elle manque");
  assert.ok(!blocks.some((b) => b.type === "adminForm" && b.action === "search"), "plus de formulaire « Chercher » avec bouton");
  assert.equal(def.adminActions.search, undefined);
  assert.match((await panel(ctx)).find((b) => b.type === "heading" && b.text.startsWith("Mes questions")).text, /\(120 sur 2000\)/);
});

test("aperçu : la bonne réponse est marquée — seulement ici", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  const id = await addQuestion(ctx, { q: "Capitale ?", a: ["Paris", "Rome"], correct: 2, e: "Rome est la capitale.", en: { q: "Capital?", a: ["Paris", "Rome"], e: "Rome is the capital.", alt: "" } });
  const blocks = await panel(ctx, { preview: id });
  const html = blocks.find((b) => b.type === "html").html;
  assert.match(html, /dg-opt is-correct/);
  assert.match(html, /\(bonne réponse\)/);
  assert.ok(!html.includes("data-dg-submit"));
  assert.match(textOf(blocks), /Voir en anglais/);
  assert.match((await panel(ctx, { preview: id, lang: "en" })).find((b) => b.type === "html").html, /Capital\?/);
});

test("import CSV : le fichier d'exemple s'importe tel quel, en brouillon", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  const sample = K.sampleCsv(ctx, D.typeOf(ctx), D.localesOf(ctx));
  assert.match(sample, /^﻿"status","date","category","difficulty","correct","image","question_fr"/);
  assert.equal((await act(ctx, "importCsv", { file: sample, lang: "fr", state: "draft" })).ok, "2 questions importées (0 déjà présentes, ignorées).");
  assert.ok(qs(ctx).every((q) => q.status === "draft" && q.by === "import"));
});

test("import CSV : noms français, point-virgule, guillemets, retours à la ligne, lettre ou texte, dates à la française", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  const file = csv(
    "Question;Réponse 1;Réponse 2;Réponse 3;Bonne réponse;Explication;Catégorie;Difficulté;Date;État",
    `"Quelle est la capitale ; de l'Italie ?";Paris;Rome;Oslo;B;"Rome, depuis 1871,\nest la capitale.";Géographie;facile;;publié`,
    "Combien font 2+2 ?;3;4;5;4;;Maths;moyen;31/12/2026;brouillon",
    "Couleur du ciel ?;Bleu;Vert;;Bleu;;;;;",
  );
  assert.equal((await act(ctx, "importCsv", { file, lang: "fr", state: "draft" })).ok, "3 questions importées (0 déjà présentes, ignorées).");
  const [a, b, c] = qs(ctx);
  assert.equal(a.d.correct, 1);
  assert.equal(a.d.tr.fr.e, "Rome, depuis 1871,\nest la capitale.");
  assert.deepEqual([a.status, a.cat, a.lvl], ["published", "Géographie", "easy"]);
  assert.equal(b.d.correct, 1);
  assert.deepEqual([b.status, b.date, b.lvl], ["draft", "2026-12-31", "medium"]);
  assert.equal(c.d.correct, 0);
  assert.equal(c.status, "draft");
});

test("import CSV : plusieurs langues par suffixe ; une colonne sans suffixe suit la langue choisie", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  assert.ok((await act(ctx, "importCsv", { file: csv("question_fr,answer1_fr,answer2_fr,question_en,answer1_en,answer2_en,correct", "Oui ?,Oui,Non,Yes?,Yes,No,1"), lang: "fr", state: "published" })).ok);
  assert.deepEqual(Object.keys(qs(ctx)[0].d.tr), ["fr", "en"]);
  assert.ok((await act(ctx, "importCsv", { file: csv("question,answer1,answer2,correct", "Only English?,Yes,No,2"), lang: "en", state: "published" })).ok);
  assert.deepEqual(Object.keys(qs(ctx)[1].d.tr), ["en"]);
});

test("import CSV : tout ou rien — chaque erreur dit la ligne", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  const file = csv(
    "question,answer1,answer2,answer3,correct,difficulty,date,status",
    "Bonne ?,Oui,Non,,1,easy,,",
    "Sans bonne réponse ?,Oui,Non,,9,easy,,",
    "Une seule réponse ?,Oui,,,1,,,",
    ",Oui,Non,,1,,,",
    "Niveau ?,Oui,Non,,1,monstrueux,,",
    "Date ?,Oui,Non,,1,,pas-une-date,",
    "Passé ?,Oui,Non,,1,,2020-01-01,",
    "État ?,Oui,Non,,1,,,peut-être",
    "Doublon de réponse ?,Oui,oui,,1,,,",
  );
  const msg = (await act(ctx, "importCsv", { file, lang: "fr", state: "published" })).errors.file;
  for (const re of [/Ligne 3 : La bonne réponse \(colonne correct\) est un numéro de 1 à 2/, /Ligne 4 : Il faut au moins deux réponses non vides/, /Ligne 5 : Il manque la question/, /Ligne 6 : Difficulté inconnue « monstrueux »/, /Ligne 7 : Date illisible « pas-une-date »/, /Ligne 8 : La date 2020-01-01 est passée/, /Ligne 9 : État inconnu « peut-être »/, /Ligne 10 : Deux réponses sont identiques/, /Rien n'a été importé/]) assert.match(msg, re);
  assert.equal(qs(ctx).length, 0);
});

test("import CSV : fichier vide, sans colonne « question », guillemet non refermé, trop gros, trop de lignes", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  const err = async (file) => (await act(ctx, "importCsv", { file, lang: "fr", state: "draft" })).errors.file;
  assert.match(await err(""), /Le fichier est vide/);
  assert.match(await err(csv("a,b", "1,2")), /Je ne trouve pas de colonne « question »/);
  assert.match(await err(csv("question,answer1,answer2,correct", '"ouverte,a,b,1')), /guillemet n'est pas refermé/);
  assert.match(await err(`question\n${"x".repeat(1_100_000)}`), /trop gros/);
  assert.match(await err(csv("question,answer1,answer2,correct", ...Array.from({ length: 2001 }, (_, i) => `Q${i},a,b,1`))), /trop de lignes \(2000 questions au plus\)/);
  assert.equal(qs(ctx).length, 0);
});

test("import CSV : sans le droit de publier, publier à l'import est refusé (même par une colonne d'état)", async () => {
  clockAt(NOON);
  const ctx = ctxFor({}, { rights: ["edit"] });
  const file = csv("question,answer1,answer2,correct", "Q ?,a,b,1");
  assert.match((await act(ctx, "importCsv", { file, lang: "fr", state: "published" })).errors.state, /pas le droit de publier/);
  assert.match((await act(ctx, "importCsv", { file: csv("question,answer1,answer2,correct,status", "Q ?,a,b,1,published"), lang: "fr", state: "draft" })).errors.state, /pas le droit de publier/);
  assert.equal(qs(ctx).length, 0);
  assert.ok((await act(ctx, "importCsv", { file, lang: "fr", state: "draft" })).ok);
});

test("export puis import : aucun doublon, tout revient identique ; les formules sont neutralisées", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  await addQuestion(ctx, { q: "=SOMME(A1:A2) ?", a: ["+1", "-2", "@x"], correct: 3, e: 'Avec "guillemets", virgules\net ligne.', cat: "Calcul", lvl: "hard", date: "2026-12-24", en: { q: "English?", a: ["+1", "-2", "@x"], e: "Yes.", alt: "" } });
  await addQuestion(ctx, { q: "Simple ?", a: ["a", "b"], status: "draft" });
  let text = "";
  for await (const chunk of def.adminDownloads.export.generate(ctx)) text += chunk;
  assert.match(text, /"'=SOMME\(A1:A2\) \?"/);
  assert.match(text, /"'\+1"/);
  assert.ok(text.startsWith("﻿"));
  assert.equal(def.adminDownloads.export.right, "edit");
  const other = ctxFor();
  assert.equal((await act(other, "importCsv", { file: text, lang: "fr", state: "published" })).ok, "2 questions importées (0 déjà présentes, ignorées).");
  const [x, y] = qs(other);
  assert.equal(x.d.tr.fr.q, "=SOMME(A1:A2) ?");
  assert.deepEqual(x.d.tr.fr.a, ["+1", "-2", "@x"]);
  assert.equal(x.d.tr.fr.e, 'Avec "guillemets", virgules\net ligne.');
  assert.deepEqual([x.cat, x.lvl, x.date, x.d.correct, x.status], ["Calcul", "hard", "2026-12-24", 2, "published"]);
  assert.equal(y.status, "draft");
  assert.equal((await act(other, "importCsv", { file: text, lang: "fr", state: "published" })).ok, "0 questions importées (2 déjà présentes, ignorées).");
  assert.equal(qs(other).length, 2);
});

test("sauvegarde lisible et fichier d'exemple", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  await addMany(ctx, 3);
  const files = await def.backup.readable(ctx);
  assert.equal(files[0].path, "questions.csv");
  assert.equal(files[0].content.split("\r\n").filter(Boolean).length, 4);
  let sample = "";
  for await (const chunk of def.adminDownloads.sample.generate(ctx)) sample += chunk;
  assert.match(sample, /Exemple/);
});

test("import CSV : ne dépasse jamais 2 000 questions", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  for (let i = 0; i < 1999; i++) await ctx.api.store.add("dg_questions", { type: "quiz", status: "draft", pos: i, by: "admin", d: { tr: { fr: { q: `Q${i}`, a: ["a", "b"] } }, correct: 0 } });
  assert.match((await act(ctx, "importCsv", { file: csv("question,answer1,answer2,correct", "N1 ?,a,b,1", "N2 ?,a,b,1"), lang: "fr", state: "draft" })).errors.file, /Ligne 3 : La banque serait pleine/);
  assert.equal(qs(ctx).length, 1999);
});

test("assistant : lire la banque (sans les réponses sauf demande) et ajouter un BROUILLON seulement", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  await addQuestion(ctx, { q: "Existante ?", a: ["Oui", "Non"], correct: 2, e: "Parce que." });
  const list = await def.mcp.daily_questions_list(ctx, {});
  assert.deepEqual(list.items[0].questions, { fr: "Existante ?" });
  assert.ok(!JSON.stringify(list).includes("Parce que."));
  const full = await def.mcp.daily_questions_list(ctx, { full: true });
  assert.equal(full.items[0].correct, 2);
  const added = await def.mcp.daily_question_add(ctx, { question: "Nouvelle ?", answers: ["A", "B", "C"], correct: 3, explanation: "Car C.", category: "Test", level: "easy" }, { name: "Mon assistant" });
  assert.equal(added.status, "draft");
  const saved = qs(ctx).find((q) => q.id === added.id);
  assert.deepEqual([saved.status, saved.by, saved.cat, saved.lvl, saved.d.correct], ["draft", "assistant", "Test", "easy", 2]);
  assert.equal((await D.getToday(ctx)).item.d.tr.fr.q, "Existante ?");
});

test("assistant : refus clairs et plafonds", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  const add = (args) => def.mcp.daily_question_add(ctx, args, { name: "x" });
  const refused = async (args, re) => assert.rejects(() => add(args), (e) => { assert.equal(e.expose, true); assert.match(e.message, re); return true; });
  await refused({ answers: ["a", "b"], correct: 1 }, /'question' is required/);
  await refused({ question: "Q ?", answers: ["a"], correct: 1 }, /2 to 4/);
  await refused({ question: "Q ?", answers: ["a", "A"], correct: 1 }, /different/);
  await refused({ question: "Q ?", answers: ["a", "b"], correct: 3 }, /must be the number \(1 to 2\)/);
  await refused({ question: "Q ?", answers: ["a", "b"], correct: 1, lang: "de" }, /Unknown language/);
  await refused({ question: "Q ?", answers: ["a", "b"], correct: 1, level: "epic" }, /'level' must be one of/);
  await add({ question: "Unique ?", answers: ["a", "b"], correct: 1 });
  await refused({ question: "unique ?", answers: ["a", "b"], correct: 1 }, /already exists/);
  for (let i = 0; i < 49; i++) await ctx.api.store.add("dg_questions", { type: "quiz", status: "draft", pos: i, by: "assistant", d: { tr: { fr: { q: `A${i}`, a: ["a", "b"] } }, correct: 0 } });
  D.invalidate(ctx);
  await refused({ question: "Encore ?", answers: ["a", "b"], correct: 1 }, /Too many assistant drafts/);
});

test("assistant : lecture seule pour la liste, écriture non accordée d'office pour l'ajout", () => {
  const list = manifest.mcp.find((x) => x.name === "daily_questions_list");
  const add = manifest.mcp.find((x) => x.name === "daily_question_add");
  assert.equal(list.readOnly, true);
  assert.ok(!add.readOnly && !add.default && !add.destructive);
  assert.ok(manifest.mcp.every((x) => `quiz-du-jour-numero-trois__${x.name}`.length <= 64));
});

test("classement (administration) : voir, retirer une ligne, vider ; sans Participation, une suggestion", async () => {
  clockAt(NOON);
  const audience = fakeAudience();
  const ctx = ctxFor({ leaderboard: true }, { services: audience.services });
  await addMany(ctx, 2);
  await D.boardAdd(ctx, { week: "2026-W43", pid: "p1", nick: "Alice", pts: 120, win: true, day: "2026-10-24" });
  await D.boardAdd(ctx, { week: "2026-W43", pid: "p2", nick: "Bruno", pts: 100, win: true, day: "2026-10-24" });
  const blocks = await panel(ctx);
  const t = tables(blocks).find((x) => x.columns[0] === "Pseudo");
  assert.deepEqual(t.rowIds, ["p1", "p2"]);
  assert.match(t.rows[0][0], /1\. Alice\n120 pts · 1 bonne\(s\) réponse\(s\) sur 1 partie\(s\)/);
  assert.equal((await act(ctx, "removeBoardRow", { id: "p1" })).ok, "Ligne retirée du classement.");
  assert.match((await act(ctx, "removeBoardRow", { id: "p1" })).error, /n'existe plus/);
  assert.equal((await act(ctx, "clearBoard")).ok, "Classement de la semaine vidé.");
  assert.equal(rows(ctx, "dg_board").length, 0);
  const viewer = ctxFor({ leaderboard: true }, { services: audience.services, rights: ["edit"] });
  await D.boardAdd(viewer, { week: "2026-W43", pid: "p1", nick: "Alice", pts: 120, win: true, day: "2026-10-24" });
  assert.deepEqual(tables(await panel(viewer)).find((x) => x.columns[0] === "Pseudo").rowActions, []);
  const absent = ctxFor({ leaderboard: true });
  await addMany(absent, 1);
  const b = await panel(absent);
  assert.equal(b.find((x) => x.type === "suggestInstall").service, "audience.session");
  const off = ctxFor({});
  await addMany(off, 1);
  assert.ok(!(await panel(off)).some((x) => x.type === "suggestInstall"));
});

test("onglets : les blocs « packs et fichiers » vont dans leur onglet", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  await addMany(ctx, 2);
  const blocks = await panel(ctx);
  const tools = blocks.filter((b) => b.tab === "tools");
  assert.ok(tools.length >= 8);
  assert.ok(tools.some((b) => b.type === "download" && b.name === "export"));
  assert.ok(tools.some((b) => b.type === "adminForm" && b.action === "importCsv" && b.fields.find((f) => f.kind === "file")));
  assert.ok(blocks.filter((b) => !b.tab).length >= 5);
  assert.equal(PK.PACKS.length, 2);
});
