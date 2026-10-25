// Contacts (lot K2) — l'import CSV : lecture, aperçu AVANT d'importer, import par lots qui reprend, idempotence, fiches existantes complétées (jamais renommées),
// erreurs actionnables (sous le champ pour le fichier, par ligne avec la raison), plafond, stockage muet (« trou noir »), écran et actions.
import test from "node:test";
import assert from "node:assert/strict";
import { memStore } from "./helpers/contactsStore.mjs";
import { makeCtx, def, B, D, I, svc, drain, importAll, htmlOf, textOf, allCards, shiftIds } from "./helpers/contactsK2.mjs";

const HEAD = "nom;type;organisation;e-mail;comptes;catégories;notes\n";
const logOf = async (ctx, outcome) => { const out = []; let cursor; do { const p = await I.logPage(ctx, outcome, cursor); out.push(...p.items); cursor = p.next; } while (cursor); return out; };

const FILE = `${HEAD}Marie Exemple;personne;Studio Lune;marie@example.test;twitch:marie_live | youtube:@marie;Amis | Cible de raid;"2026-01-02 · moi\nRencontrée au salon."
Jean Test;;Studio Lune;;https://www.twitch.tv/jean_stream;Amis;
Studio Lune;organisation;;contact@studio-lune.test;web:studio-lune.test;Partenaires;
;;;;bluesky:zoe;;
Mauvais Mail;;;oups@;;;
Marie Exemple;;Studio Lune;;twitch:marie_live;;
`;

test("aperçu puis import : créées / rattachées / ignorées / en erreur, par lignes avec la raison ; l'aperçu annonce exactement ce que fait l'import", async () => {
  const ctx = makeCtx({ locale: "fr" });
  const r = await importAll(ctx, FILE);
  assert.equal(r.stage.ok, true);
  assert.equal(r.stage.job.data.total, 6);
  assert.deepEqual(r.preview, { created: 3, linked: 1, skipped: 1, error: 1 }, "la ligne « Studio Lune » complète l'organisation déjà créée par les personnes");
  assert.deepEqual(r.counts, r.preview, "l'import fait ce que l'aperçu avait annoncé");
  const errors = await logOf(ctx, "error");
  assert.deepEqual(errors.map((e) => [e.line, e.code, e.value]), [[6, "email", "oups@"]]);
  const skipped = await logOf(ctx, "skipped");
  assert.deepEqual(skipped.map((e) => [e.line, e.via]), [[7, "account"]], "la dernière ligne retrouve la fiche créée par la ligne 2 : rien à ajouter");
  const cards = await allCards(ctx);
  const byName = Object.fromEntries(cards.map((c) => [c.name, c]));
  assert.deepEqual(Object.keys(byName).sort(), ["Jean Test", "Marie Exemple", "Studio Lune", "zoe.bsky.social"], "le pseudo sert de nom quand il n'y en a pas");
  assert.deepEqual(byName["Marie Exemple"].accounts.map((a) => `${a.network}:${a.handle}`), ["twitch:marie_live", "youtube:@marie"]);
  assert.equal(byName["Marie Exemple"].orgName, "Studio Lune");
  assert.equal(byName["Jean Test"].orgId, byName["Marie Exemple"].orgId, "une seule fiche organisation « Studio Lune »");
  assert.equal(byName["Studio Lune"].kind, "org");
  assert.equal(cards.filter((c) => c.name === "Studio Lune").length, 1, "l'organisation de la ligne 4 est la même que celle des personnes");
  assert.equal(byName["Studio Lune"].email, "contact@studio-lune.test");
  const cats = (await svc.categories(ctx, {})).items.map((c) => c.label).sort();
  assert.deepEqual(cats, ["Amis", "Cible de raid", "Partenaires"], "les catégories inconnues sont créées (droit « créer des catégories »)");
  assert.equal(byName["Marie Exemple"].categoryIds.length, 2);
  const notes = (await svc.get(ctx, { id: byName["Marie Exemple"].id })).contact.notes;
  assert.deepEqual(notes, [{ date: "2026-01-02", author: "moi", text: "Rencontrée au salon." }], "la date et l'auteur de la note sont gardés");
  assert.equal(byName["Marie Exemple"].source, "import");
});

test("idempotent : réimporter le même fichier ne crée rien, ne double aucune note, ne change rien", async () => {
  const ctx = makeCtx({ locale: "fr" });
  await importAll(ctx, FILE);
  const before = JSON.stringify(await allCards(ctx));
  const notesBefore = await ctx.api.store.count("notes");
  await I.cancel(ctx);
  const again = await importAll(ctx, FILE);
  assert.deepEqual(again.preview, { created: 0, linked: 0, skipped: 5, error: 1 });
  assert.deepEqual(again.counts, again.preview);
  assert.equal(JSON.stringify(await allCards(ctx)), before);
  assert.equal(await ctx.api.store.count("notes"), notesBefore, "la note n'est pas doublée");
  assert.equal((await svc.categories(ctx, {})).items.length, 3, "aucune catégorie en double");
});

test("fiche existante : on lui AJOUTE ce qui manque (compte, catégorie, note, champs vides), jamais de renommage ni d'écrasement ; les comptes d'une même ligne rattachent à la même fiche", async () => {
  const ctx = makeCtx({ locale: "en" });
  const ada = await svc.create(ctx, { name: "Ada Original", email: "ada@example.test", role: "Producer" });
  await B.addAccount(ctx, { id: ada.id, network: "twitch", handle: "ada_live" });
  const csv = "name,role,phone,accounts,categories,notes,email\nAda Renamed,CEO,+32 470 00 00 00,twitch:ada_live | youtube:@ada,Friends,Hello there,\n";
  const r = await importAll(ctx, csv);
  assert.deepEqual(r.counts, { created: 0, linked: 1, skipped: 0, error: 0 });
  const entry = (await logOf(ctx, "linked"))[0];
  assert.deepEqual([entry.line, entry.via, entry.changes.sort()], [2, "account", ["a", "c", "f", "n"]]);
  const c = (await svc.get(ctx, { id: ada.id })).contact;
  assert.equal(c.name, "Ada Original", "le nom n'est jamais écrasé");
  assert.equal(c.role, "Producer", "un champ déjà rempli n'est pas écrasé");
  assert.equal(c.phone, "+32 470 00 00 00", "un champ vide est complété");
  assert.deepEqual(c.accounts.map((a) => `${a.network}:${a.handle}`), ["twitch:ada_live", "youtube:@ada"]);
  assert.equal(c.categoryIds.length, 1);
  assert.equal(c.notes.length, 1);
  assert.equal((await allCards(ctx)).length, 1, "aucune fiche de plus");
  // Rejouer : plus rien à ajouter.
  await I.cancel(ctx);
  assert.deepEqual((await importAll(ctx, csv)).counts, { created: 0, linked: 0, skipped: 1, error: 0 });
  // Même e-mail, pas de compte : rattaché par l'e-mail.
  await I.cancel(ctx);
  const byMail = await importAll(ctx, "name,email,accounts\nSomeone Else,ADA@example.test,instagram:ada.photos\n");
  assert.deepEqual(byMail.counts, { created: 0, linked: 1, skipped: 0, error: 0 });
  assert.equal((await logOf(ctx, "linked"))[0].via, "email");
  // Même nom dans la même organisation, sans e-mail : rattaché ; avec un e-mail différent : une autre personne.
  await svc.create(ctx, { name: "Bob Same", organisation: "Acme" });
  await I.cancel(ctx);
  const names = await importAll(ctx, "name,organisation,email\nBob Same,Acme,\nBob Same,Acme,bob2@example.test\nBob Same,Acme,bob3@example.test\nBob Same,Other Org,\n");
  assert.deepEqual(names.preview, { created: 2, linked: 1, skipped: 1, error: 0 });
  assert.deepEqual(names.counts, names.preview, "l'aperçu sait déjà que la ligne 3 complète l'e-mail de la fiche : la ligne 4 est une autre personne");
  assert.equal((await svc.search(ctx, { q: "bob same" })).items.length, 3);
});

test("conflits : comptes sur deux fiches, compte déjà ailleurs, e-mail d'une autre sorte de fiche → ligne en erreur, avec la raison et le nom des fiches", async () => {
  const ctx = makeCtx({ locale: "fr" });
  const a = await svc.create(ctx, { name: "Alice A" });
  const b = await svc.create(ctx, { name: "Bruno B", email: "bruno@example.test" });
  const org = await svc.create(ctx, { name: "Studio Z", kind: "org", email: "studio@example.test" });
  await B.addAccount(ctx, { id: a.id, network: "twitch", handle: "alice_live" });
  await B.addAccount(ctx, { id: b.id, network: "twitch", handle: "bruno_live" });
  const csv = "nom,comptes,e-mail,type\nX,twitch:alice_live | twitch:bruno_live,,\nY,twitch:alice_live,bruno@example.test,\nZ,,studio@example.test,personne\n";
  const r = await importAll(ctx, csv);
  assert.deepEqual(r.counts, { created: 0, linked: 0, skipped: 0, error: 3 });
  const errs = await logOf(ctx, "error");
  assert.deepEqual(errs.map((e) => [e.line, e.code]), [[2, "accounts_two"], [3, "email_elsewhere"], [4, "email_kind"]]);
  assert.deepEqual([errs[0].a, errs[0].b], ["Alice A", "Bruno B"]);
  const ctxT = { t: ctx.t };
  const { describeError } = await import("../modules/contacts/messages.mjs");
  assert.match(describeError(ctxT, errs[0]), /Ligne 2 : ces comptes sont déjà sur deux fiches différentes \(« Alice A » et « Bruno B »\)\. Réunissez d'abord ces deux fiches dans l'onglet Doublons\./);
  assert.match(describeError(ctxT, errs[1]), /Ligne 3 : l'e-mail bruno@example\.test est déjà sur la fiche « Bruno B », alors que les comptes de cette ligne sont sur une autre fiche\./);
  assert.match(describeError(ctxT, errs[2]), /Ligne 4 : l'e-mail studio@example\.test est déjà sur la fiche « Studio Z »/);
  void org;
});

test("catégories : sans le droit « créer des catégories », la ligne dit comment faire ; avec le droit, créées une seule fois ; l'aperçu les annonce", async () => {
  const denied = makeCtx({ locale: "fr", rights: ["email.view"] });
  const r = await importAll(denied, "nom,catégories\nA,Nouvelle\nB,\n");
  assert.deepEqual(r.counts, { created: 1, linked: 0, skipped: 0, error: 1 });
  const e = (await logOf(denied, "error"))[0];
  assert.equal(e.code, "category_denied");
  const { describeError } = await import("../modules/contacts/messages.mjs");
  assert.match(describeError(denied, e), /la catégorie « Nouvelle » n'existe pas, et votre rôle ne permet pas d'en créer\. Créez-la d'abord dans l'onglet Catégories/);
  const ok = makeCtx();
  await I.stage(ok, "name,categories\nA,New one\nB,new ONE\nC,Other\n", { locale: "en" });
  const prev = (await drain(ok, "preview")).job;
  assert.deepEqual(prev.data.newCategories.sort(), ["New one", "Other"], "l'aperçu annonce les catégories à créer, sans les créer");
  assert.equal((await svc.categories(ok, {})).items.length, 0);
  await drain(ok, "run");
  assert.deepEqual((await svc.categories(ok, {})).items.map((c) => c.label).sort(), ["New one", "Other"]);
});

test("l'aperçu ne touche à rien ; annuler efface tout ce qui était rangé (les fiches déjà créées restent) ; un seul import à la fois", async () => {
  const ctx = makeCtx();
  const csv = `name\n${Array.from({ length: 450 }, (_, i) => `Person ${i}`).join("\n")}\n`;
  const s = await I.stage(ctx, csv, { locale: "en" });
  assert.equal(s.ok, true);
  assert.equal(await ctx.api.store.count("importRows"), 3, "450 lignes rangées en 3 paquets de 200 au plus");
  assert.deepEqual(await I.stage(ctx, csv, { locale: "en" }), { ok: false, error: { code: "busy_job" } });
  await drain(ctx, "preview");
  assert.equal((await allCards(ctx)).length, 0, "l'aperçu n'a rien créé");
  assert.equal(await ctx.api.store.count("contacts"), 0);
  await I.step(ctx, "run", { budgetMs: 8000 });
  await I.cancel(ctx);
  assert.equal(await ctx.api.store.count("importRows"), 0);
  assert.equal(await ctx.api.store.count("imports"), 0);
  assert.equal(await ctx.api.store.count("importLog"), 0);
  assert.equal((await allCards(ctx)).length, 450, "les fiches créées restent");
  assert.equal((await I.stage(ctx, csv, { locale: "en" })).ok, true, "un nouvel import peut commencer");
});

test("reprise : par petits lots (temps épuisé à chaque pas), avec redémarrage du site au milieu — même résultat qu'en un seul pas, aucun doublon, rien de perdu", async () => {
  const store = memStore();
  const ctx = makeCtx({ store, test: { importLockRows: 7 } });
  const lines = Array.from({ length: 530 }, (_, i) => `Person ${i},${i % 5 === 0 ? "" : `p${i}@example.test`},twitch:user_${String(i).padStart(5, "0")}`);
  const csv = `name,email,accounts\n${lines.join("\n")}\nPerson 3,,twitch:user_00003\nBroken,nope@,\n`;
  await I.stage(ctx, csv, { locale: "en" });
  // Aperçu en pas minuscules (1 ms) : il avance quand même, d'un lot à chaque fois.
  const p = await drain(ctx, "preview", { budgetMs: 1 });
  assert.ok(p.steps > 3, `aperçu repris en ${p.steps} pas`);
  const expectPreview = { created: 530, linked: 0, skipped: 1, error: 1 };
  assert.deepEqual(p.job.data.counts, expectPreview);
  // Import : quelques pas, puis « redémarrage » (mémoire du module perdue), puis la suite.
  for (let i = 0; i < 4; i++) await I.step(ctx, "run", { budgetMs: 1 });
  const mid = (await I.getJob(ctx)).data;
  assert.equal(mid.state, "running");
  assert.ok(mid.processed > 0 && mid.processed < 532, `à mi-chemin : ${mid.processed}`);
  D.forgetIndex(ctx);
  const restarted = makeCtx({ store, test: { importLockRows: 7 } });
  restarted.instance = ctx.instance; // même instance, autre processus
  const done = await drain(restarted, "run", { budgetMs: 1 });
  assert.deepEqual(done.job.data.counts, expectPreview, "même résultat qu'annoncé");
  const cards = await allCards(restarted);
  assert.equal(cards.length, 530);
  assert.equal(new Set(cards.map((c) => c.id)).size, 530);
  assert.equal(new Set(cards.map((c) => c.name)).size, 530);
  assert.equal(await restarted.api.store.count("importRows"), 0, "les lignes rangées sont effacées à la fin");
});

test("aperçu après un redémarrage du site : repart du début (rapide, ne touche à rien) et donne le même résultat", async () => {
  const store = memStore();
  const ctx = makeCtx({ store, test: { importLockRows: 20 } });
  const csv = `name,accounts\n${Array.from({ length: 300 }, (_, i) => `P ${i},twitch:user_${String(i).padStart(5, "0")}`).join("\n")}\nP 1,twitch:user_00001\n`;
  await I.stage(ctx, csv, { locale: "en" });
  await I.step(ctx, "preview", { budgetMs: 1 });
  assert.equal((await I.getJob(ctx)).data.state, "previewing");
  // La mémoire de l'aperçu (doublons dans le même fichier) disparaît : un nouveau pas recommence au début.
  const mod = await import(`../modules/contacts/import.mjs?fresh=${Math.random()}`);
  const done = await (async () => { let r; for (let i = 0; i < 1000; i++) { r = await mod.step(ctx, "preview", { budgetMs: 100 }); if (r.job.data.state === "previewed") return r; } })();
  assert.deepEqual(done.job.data.counts, { created: 300, linked: 0, skipped: 1, error: 0 });
});

test("plafond technique du carnet (100 000 en vrai) appliqué à l'import : les lignes au-delà sont refusées avec leur numéro et la raison", async () => {
  assert.equal(D.LIMITS.maxContacts, 100_000);
  const ctx = makeCtx({ locale: "fr", test: { maxContacts: 5 } });
  const csv = `nom\n${Array.from({ length: 8 }, (_, i) => `Fiche ${i}`).join("\n")}\n`;
  const r = await importAll(ctx, csv);
  assert.deepEqual(r.preview, { created: 5, linked: 0, skipped: 0, error: 3 });
  assert.deepEqual(r.counts, r.preview);
  assert.deepEqual((await logOf(ctx, "error")).map((e) => [e.line, e.code]), [[7, "too_many"], [8, "too_many"], [9, "too_many"]]);
  assert.equal((await allCards(ctx)).length, 5);
});

test("fichier : erreurs SOUS le champ avec un exemple — vide, titres inconnus, guillemet ouvert, aucune ligne, trop de lignes", async () => {
  const ctx = makeCtx({ locale: "fr" });
  const start = (v) => def.adminActions.importStart(ctx, v);
  assert.deepEqual((await start({ csv: "  " })).errors, { csv: "Collez des lignes ou choisissez un fichier. Exemple de première ligne : nom;comptes;catégories" });
  assert.match((await start({ csv: "couleur;taille\nbleu;grand\n" })).errors.csv, /^Je ne reconnais aucune colonne dans la première ligne \(j'ai lu : couleur, taille\)\. Commencez par une ligne de titres, par exemple : nom;comptes;catégories/);
  assert.match((await start({ file: 'nom,note\nA,"jamais fermé\nB,c\n' })).errors.file, /^Un guillemet n'est pas refermé à la ligne 2\./, "l'erreur est sous le champ du fichier quand c'est lui qu'on a utilisé");
  assert.match((await start({ csv: "nom;comptes\n" })).errors.csv, /Je ne vois aucune ligne sous les titres\. Ajoutez au moins une personne, par exemple : Marie Exemple;twitch:marie_exemple/);
  const huge = `n\n${"a\n".repeat(C_MAX + 1)}`;
  assert.match((await start({ file: huge.replace("n\n", "nom\n") })).errors.file, /Ce fichier a plus de 100\s?000 lignes/);
  assert.equal(await ctx.api.store.count("importRows"), 0, "un fichier refusé ne laisse rien derrière lui");
  assert.equal(await ctx.api.store.count("imports"), 0);
  // Un import déjà en cours.
  assert.equal((await start({ csv: "nom\nA\n" })).ok.length > 0, true);
  assert.match((await start({ csv: "nom\nB\n" })).errors.csv, /Un import est déjà en cours\./);
  const en = makeCtx({ locale: "en" });
  assert.match((await def.adminActions.importStart(en, { csv: "x" })).errors.csv, /^I do not recognise any column in the first row \(I read: x\)\. Start with a row of titles, for example: name,accounts,categories/);
});
const C_MAX = 100_000;

test("écran : formulaire (collage + fichier de 5 Mo), modèle à télécharger ; l'import se déroule en pas avec barre de progression, résumé, lignes à corriger et rapport", async () => {
  const ctx = makeCtx({ locale: "fr", test: { importLockRows: 5, importStepMs: 0 } }); // 0 ms : un seul lot par pas, quelle que soit la vitesse de la machine (1 ms laissait parfois tout passer dans la même milliseconde)
  const first = await def.adminPanel(ctx, { query: { view: "import" } });
  const form = first.find((b) => b.action === "importStart");
  assert.deepEqual(form.fields.map((f) => [f.name, f.kind]), [["csv", "textarea"], ["file", "file"]]);
  assert.equal(form.fields[1].maxBytes, 5 * 1024 * 1024);
  assert.deepEqual(first.filter((b) => b.type === "download").map((b) => b.name), ["template", "contacts"]);
  assert.match(htmlOf(first), /aria-current="page">Importer \/ exporter</);
  const csv = `nom;comptes\n${Array.from({ length: 40 }, (_, i) => `Fiche ${i};twitch:user_${String(i).padStart(5, "0")}`).join("\n")}\nSans réseau;@pseudo\n`;
  const started = await def.adminActions.importStart(ctx, { csv });
  assert.equal(started.redirect, "?view=import");
  assert.match(started.ok, /^41 lignes lues\./);
  assert.equal(I.stepMs(ctx), 0);
  let page = await def.adminPanel(ctx, { query: { view: "import" } });
  assert.match(htmlOf(page), /role="progressbar"[^>]*aria-valuenow="\d+"/, "la barre de progression de la vérification");
  assert.match(htmlOf(page), /Vérification en cours/);
  assert.ok(page.some((b) => b.action === "importStep" && b.submitLabel === "Continuer la vérification"));
  for (let i = 0; i < 100 && !/Voici ce qui va se passer/.test(htmlOf(page)); i++) { await def.adminActions.importStep(ctx, { mode: "preview" }); page = await def.adminPanel(ctx, { query: { view: "import" } }); }
  assert.ok(page.some((b) => b.action === "importStep" && b.submitLabel === "Importer maintenant"));
  assert.ok(page.some((b) => b.type === "download" && b.name === "importReport"), "les lignes à corriger se téléchargent");
  assert.match(htmlOf(page), /<b>40<\/b><span>fiches créées<\/span>/);
  assert.match(htmlOf(page), /<b>1<\/b><span>lignes à corriger<\/span>/);
  assert.match(htmlOf(page), /Ligne 42 : « @pseudo » : on ne sait pas de quel réseau il s(&#39;|')agit\. Écrivez le réseau devant, par exemple twitch:marie_exemple/);
  assert.equal((await allCards(ctx)).length, 0, "rien n'est ajouté avant le clic « Importer maintenant »");
  const cancel = page.find((b) => b.type === "table");
  assert.deepEqual([cancel.columns.length, cancel.rowActions[0].action, cancel.rowActions[0].danger, typeof cancel.rowActions[0].confirm], [1, "importCancel", true, "string"]);
  await def.adminActions.importStep(ctx, { mode: "run" });
  page = await def.adminPanel(ctx, { query: { view: "import" } });
  assert.match(htmlOf(page), /Import en cours/);
  assert.ok(page.some((b) => b.action === "importStep" && b.submitLabel === "Continuer l'import"));
  for (let i = 0; i < 100 && !/Import terminé/.test(htmlOf(page)); i++) { await def.adminActions.importStep(ctx, { mode: "run" }); page = await def.adminPanel(ctx, { query: { view: "import" } }); }
  assert.ok(page.some((b) => b.action === "importClose"));
  assert.equal((await allCards(ctx)).length, 40);
  assert.equal((await def.adminActions.importClose(ctx, {})).ok, "Rapport fermé.");
  assert.ok((await def.adminPanel(ctx, { query: { view: "import" } })).some((b) => b.action === "importStart"));
});

test("rapport des lignes à corriger : un CSV qu'on corrige puis réimporte tel quel (colonne « problème » ignorée)", async () => {
  const ctx = makeCtx({ locale: "fr" });
  await def.adminActions.importStart(ctx, { csv: "nom;e-mail;comptes\nAnne;anne@;twitch:anne_live\nBen;ben@example.test;\nCamille;;@camille\n" });
  await def.adminActions.importStep(ctx, { mode: "run" });
  const out = [];
  for await (const c of def.adminDownloads.importReport.generate(ctx)) out.push(c);
  const text = out.join("");
  const lines = text.replace(/^﻿/, "").trim().split("\r\n");
  assert.match(lines[0], /^problème;nom;type;fonction;organisation;e-mail/);
  assert.equal(lines.length, 3, "titres + 2 lignes en erreur");
  assert.match(lines[1], /^"?Ligne 2 : l'e-mail « anne@ » n'est pas complet/);
  assert.match(lines[2], /Ligne 4 : « @camille »/);
  assert.ok(lines[1].includes("twitch:anne_live"), "la ligne d'origine est reprise");
  // On corrige dans le tableur, on réimporte : Ben (déjà importé) n'est pas doublé.
  await def.adminActions.importClose(ctx, {});
  const fixed = text.replace("anne@;", "anne@example.test;").replaceAll("'@camille", "twitch:camille_live");
  const r = await importAll(ctx, fixed.replace(/^﻿/, ""));
  assert.deepEqual(r.counts, { created: 2, linked: 0, skipped: 0, error: 0 });
  assert.equal((await allCards(ctx)).length, 3);
});

test("trou noir : un stockage qui ne répond jamais ne bloque pas l'import — le pas rend « occupé » dans le temps imparti, et la suite repart", async () => {
  const store = memStore();
  const ctx = makeCtx({ locale: "fr", store, test: { importHardMs: 150, lockWaitMs: 60, lockHoldMs: 100, indexWaitMs: 60, storeCallMs: 60, buildMaxMs: 100 } });
  await I.stage(ctx, `nom\n${Array.from({ length: 30 }, (_, i) => `Fiche ${i}`).join("\n")}\n`, { locale: "fr" });
  await drain(ctx, "preview");
  store.faults.hang.add("page");
  const t = Date.now();
  const r = await I.step(ctx, "run", { budgetMs: 100 });
  assert.deepEqual([r.ok, r.error], [false, "busy"]);
  assert.ok(Date.now() - t < 1500, "borné");
  const action = await def.adminActions.importStep(ctx, { mode: "run" });
  assert.equal(action.error, "Le carnet se prépare. Réessayez dans quelques secondes.", "message en mots simples");
  store.faults.hang.delete("page");
  await new Promise((res) => setTimeout(res, 300));
  const done = await drain(ctx, "run", { budgetMs: 2000 });
  assert.equal(done.job.data.counts.created, 30);
  assert.equal((await allCards(ctx)).length, 30, "aucun doublon après la panne");
});

test("deux onglets : un second pas en même temps est refusé gentiment (jamais deux pas qui se marchent dessus)", async () => {
  const ctx = makeCtx({ locale: "fr" });
  await I.stage(ctx, `nom\n${Array.from({ length: 50 }, (_, i) => `Fiche ${i}`).join("\n")}\n`, { locale: "fr" });
  const [a, b] = await Promise.all([I.step(ctx, "preview"), I.step(ctx, "preview")]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.equal([a, b].find((r) => !r.ok).error, "working");
  assert.match((await def.adminActions.importStep(ctx, { mode: "preview" })).ok, /./);
});

test("fichier d'un autre site : les identifiants de la colonne « id » ne rapprochent que de la même sorte de fiche ; un id inconnu est ignoré", async () => {
  const a = makeCtx();
  const x = await svc.create(a, { name: "Xavier", email: "x@example.test" });
  const b = makeCtx();
  await shiftIds(b, 40);
  const stranger = await svc.create(b, { name: "Autre Personne" });
  const r = await importAll(b, `name,id,email\nXavier,${x.id},x@example.test\nNobody,id-inconnu,\n`);
  assert.deepEqual(r.counts, { created: 2, linked: 0, skipped: 0, error: 0 });
  assert.ok((await allCards(b)).some((c) => c.id === stranger.id && c.name === "Autre Personne"));
});
