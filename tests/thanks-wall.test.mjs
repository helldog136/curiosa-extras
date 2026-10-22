// Mur des remerciements — le mur lui-même : ce qu'on lit dans Contacts (double fakeContactBook, jamais modifié), ce qu'on en garde, ce que voit le visiteur,
// « ne pas montrer », Contacts muet ou absent, fusion / suppression de catégories et de fiches, pagination, échappement. Aucun réseau.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { makeWorld, reset, restore, P, C, D, View, def, htmlOf, people, TW_PHOTO, YT_PHOTO, EVIL_PHOTO } from "./helpers/thanks-wall-world.mjs";

beforeEach(() => reset());
afterEach(() => restore());

const page = (ctx, ...segments) => def.page(ctx, { segments });
const names = (html) => [...html.matchAll(/<p class="tw-name">([^<]*)<\/p>/g)].map((m) => m[1]);
const count = (html, re) => (html.match(re) ?? []).length;

/* ───────────── Les petites fonctions ───────────── */

test("photos : une photo à la main est permise en https ou sur le site ; une photo d'un réseau seulement depuis ses serveurs d'images connus ; le reste devient des initiales", () => {
  assert.equal(P.photoSrc({ url: "https://moi.example.test/p.png", source: "manual" }), "https://moi.example.test/p.png", "choisie à la main : n'importe quel serveur https");
  assert.equal(P.photoSrc({ url: "/uploads/2026/alice.png", source: "manual" }), "/uploads/2026/alice.png", "image envoyée sur le site");
  assert.equal(P.photoSrc({ url: "//evil.example/x.png", source: "manual" }), null, "adresse sans protocole : refusée");
  assert.equal(P.photoSrc({ url: "/uploads/../../etc/passwd", source: "manual" }), null);
  assert.equal(P.photoSrc({ url: "http://moi.example.test/p.png", source: "manual" }), null, "http : refusé");
  assert.equal(P.photoSrc({ url: "javascript:alert(1)", source: "manual" }), null);
  assert.equal(P.photoSrc({ url: "data:image/png;base64,AAAA", source: "manual" }), null);
  assert.equal(P.photoSrc({ url: "https://moi.example.test/a\"onerror=\"x", source: "manual" }), null, "guillemet : refusé");
  assert.equal(P.photoSrc({ url: TW_PHOTO, source: "twitch" }), TW_PHOTO);
  assert.equal(P.photoSrc({ url: YT_PHOTO, source: "youtube" }), YT_PHOTO);
  assert.equal(P.photoSrc({ url: EVIL_PHOTO, source: "twitch" }), null, "une photo de réseau sur un serveur inconnu : jamais chargée chez le visiteur");
  assert.equal(P.photoSrc({ url: `${TW_PHOTO}?track=1`, source: "twitch" }), null, "pas de paramètre");
  assert.equal(P.photoSrc(null), null);
  assert.equal(P.photoSrc({ url: "https://static-cdn.jtvnw.net:8443/jtv_user_pictures/a.png", source: "twitch" }), null, "pas de port");
  assert.equal(P.photoSrc({ url: "x".repeat(600), source: "manual" }), null);
});

test("noms : comme la fiche, prénom seulement, ou pseudo du compte ; les initiales et le tri suivent la langue", () => {
  const card = { id: "a", name: "Sophie  Martin", accounts: [{ id: "a1", network: "youtube", handle: "@sophie_yt" }, { id: "a2", network: "twitch", handle: "sophie_tv", displayName: "Sophie_TV" }], photo: null };
  const p = P.reduceCard(card);
  assert.deepEqual([P.shownName(p, "card"), P.shownName(p, "first"), P.shownName(p, "nickname")], ["Sophie Martin", "Sophie", "Sophie_TV"]);
  assert.equal(P.shownName(P.reduceCard({ id: "b", name: "Élodie", accounts: [] }), "nickname"), "Élodie", "pas de compte : le nom de la fiche");
  assert.equal(P.initials("Sophie Martin"), "SM");
  assert.equal(P.initials("élodie"), "É");
  assert.equal(P.initials("@dark_wolf"), "DW");
  assert.equal(P.initials(""), "♥");
  const sorted = P.sortPeople([{ id: "1", shown: "Zoé" }, { id: "2", shown: "élodie" }, { id: "3", shown: "Anne" }], "alpha", "fr");
  assert.deepEqual(sorted.map((x) => x.shown), ["Anne", "élodie", "Zoé"], "é se range avec e");
  assert.deepEqual(P.sortPeople([{ id: "1", shown: "b" }, { id: "2", shown: "a" }], "newest", "fr").map((x) => x.id), ["2", "1"]);
});

test("la fiche réduite ne garde ni e-mail, ni téléphone, ni rôle, ni organisation, ni pseudo en clair (sauf le pseudo choisi pour l'affichage)", () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  const { id } = book.seedContact({ name: "Alice Martin", email: "alice@example.test", phone: "+32 470 00 00 00", role: "Directrice", organisation: "Acme", categoryIds: [cat], accounts: [{ network: "twitch", handle: "alice_tv", displayName: "Alice TV", avatar: TW_PHOTO }] });
  const reduced = P.reduceCard({ ...book.dump().contacts[0], photo: { url: TW_PHOTO, source: "twitch" } });
  const dump = JSON.stringify(reduced);
  for (const secret of ["alice@example.test", "470", "Directrice", "Acme", "alice_tv"]) assert.ok(!dump.includes(secret), `« ${secret} » ne doit pas être gardé`);
  assert.equal(reduced.id, id);
});

test("mois : ajout, étiquettes, textes par langue", () => {
  assert.equal(P.addMonths("2026-11", 2), "2027-01");
  assert.equal(P.addMonths("2026-01", -1), "2025-12");
  assert.equal(P.monthKey(new Date(Date.UTC(2026, 9, 31, 23, 59))), "2026-10");
  assert.equal(P.monthName("2026-10", "fr"), "octobre");
  assert.equal(P.monthLabel("2026-10", "en"), "October 2026");
  assert.ok(P.monthOk("2026-12") && !P.monthOk("2026-13") && !P.monthOk("26-10") && !P.monthOk(null));
  assert.equal(P.pickText({ fr: "Merci", en: "Thanks" }, "en", "fr"), "Thanks");
  assert.equal(P.pickText({ fr: "Merci" }, "en", "fr"), "Merci", "langue du site en repli");
  assert.equal(P.pickText({ nl: "Dank" }, "en", "fr"), "Dank", "n'importe quelle langue plutôt que rien");
  assert.equal(P.pickText(null, "en", "fr"), "");
});

test("chemins : le mur, un groupe, une page ; le reste est introuvable", () => {
  assert.deepEqual(View.parseRoute([]), { kind: "wall" });
  assert.deepEqual(View.parseRoute(["g", "2"]), { kind: "group", n: 2, page: 1 });
  assert.deepEqual(View.parseRoute(["g", "2", "page", "3"]), { kind: "group", n: 2, page: 3 });
  for (const bad of [["g"], ["g", "0"], ["g", "7"], ["g", "x"], ["g", "1", "page"], ["g", "1", "page", "0"], ["g", "1", "page", "x"], ["g", "1", "page", "2", "z"], ["autre"], ["g", "1", "2"]]) assert.equal(View.parseRoute(bad), null, JSON.stringify(bad));
});

/* ───────────── Le mur, sans réglage ───────────── */

test("sans aucun réglage : une seule catégorie dans Contacts est prise toute seule, les personnes, leurs photos et leurs noms viennent de Contacts", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Modérateurs");
  book.seedContact({ name: "Zoé Dupont", categoryIds: [cat], accounts: [{ network: "twitch", handle: "zoe_tv", avatar: TW_PHOTO }] });
  book.seedContact({ name: "Anne Lambert", categoryIds: [cat], photo: "https://moi.example.test/anne.png" });
  book.seedContact({ name: "Pas rangée", accounts: [{ network: "twitch", handle: "autre_tv" }] });
  const { ctx } = makeWorld({ book });
  const r = await page(ctx);
  const html = htmlOf(r);
  assert.equal(r.title, "Merci !");
  assert.deepEqual(names(html), ["Anne Lambert", "Zoé Dupont"], "ordre alphabétique, et seulement la catégorie");
  assert.ok(html.includes("Modérateurs"), "le titre du groupe est le nom de la catégorie");
  assert.ok(html.includes(`src="${TW_PHOTO}"`) && html.includes('src="https://moi.example.test/anne.png"'));
  assert.ok(!html.includes("Pas rangée"));
  assert.ok(!html.includes("<script"), "aucun script");
  assert.equal(count(html, /<img /g), 2);
  assert.equal(count(html, /alt=""/g), 2, "le nom est écrit à côté : l'image est décorative");
  assert.ok(html.includes('referrerpolicy="no-referrer"') && html.includes('loading="lazy"'));
});

test("plusieurs catégories dans Contacts et rien de choisi : message aimable côté visiteur, la consigne côté administration", async () => {
  const book = fakeContactBook();
  book.seedCategory("A"); book.seedCategory("B");
  const { ctx } = makeWorld({ book });
  const r = await page(ctx);
  assert.ok(!r.notFound && htmlOf(r).includes("Le mur des remerciements se prépare"));
  const wall = await C.getWall(ctx);
  assert.deepEqual([wall.state, wall.reason], ["unready", "choose"]);
});

test("aucune catégorie du tout : le mur se prépare (pas d'erreur), et l'administration dit de créer le groupe dans les réglages", async () => {
  const { ctx } = makeWorld();
  assert.ok(htmlOf(await page(ctx)).includes("se prépare"));
  assert.equal((await C.getWall(ctx)).reason, "no_category");
});

test("un mur vide (la catégorie n'a encore personne) dit que le mur se remplit bientôt", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  const r = await page(ctx);
  assert.ok(htmlOf(r).includes("se remplit bientôt"));
});

test("groupes : titres de la propriétaire, titre par défaut = nom de la catégorie, une catégorie utilisée deux fois n'est montrée qu'une fois, un groupe vide n'est pas montré", async () => {
  const book = fakeContactBook();
  const mod = book.seedCategory("Modérateurs"), sup = book.seedCategory("Soutiens"), vide = book.seedCategory("Vide");
  people(book, mod, 2, { prefix: "Mod" });
  people(book, sup, 3, { prefix: "Sou" });
  const { ctx } = makeWorld({ book, settings: { category: mod, groupTitle: "Modération", category2: sup, category3: sup, category4: vide, groupTitle4: "Personne" } });
  const html = htmlOf(await page(ctx));
  assert.ok(html.includes(">Modération<") && html.includes(">Soutiens<"));
  assert.ok(!html.includes(">Personne<"), "un groupe sans personne n'est pas montré");
  assert.equal(count(html, /<section class="tw-group"/g), 2);
  assert.equal(names(html).length, 5);
  const wall = await C.getWall(ctx);
  assert.ok(wall.problems.some((p) => p.n === 3 && p.problem === "duplicate"));
});

test("la mise en page : textes en entier, jamais un nombre de personnes au singulier faux", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  people(book, cat, 1);
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  assert.ok(htmlOf(await page(ctx)).includes(">1 personne<"));
});

/* ───────────── « Ne pas montrer » ───────────── */

test("ne pas montrer : une fiche rangée dans la catégorie choisie disparaît, même si elle est dans un groupe remercié ; la remettre la fait revenir", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Modérateurs"), hide = book.seedCategory("Discrets");
  const [a, b, c] = people(book, cat, 3, { prefix: "P" });
  book.admin.setCategories(b.id, [cat, hide]);
  const { ctx } = makeWorld({ book, settings: { category: cat, hide } });
  assert.deepEqual(names(htmlOf(await page(ctx))), [a.name, c.name]);
  const wall = await C.getWall(ctx, { maxAgeMs: 0 });
  assert.equal(wall.groups[0].hidden, 1);
  assert.equal(wall.hideHow, "chosen");
  book.admin.setCategories(b.id, [cat]);
  C.resetWall();
  assert.deepEqual(names(htmlOf(await page(ctx))), [a.name, b.name, c.name]);
});

test("ne pas montrer sans réglage : une catégorie qui s'appelle « Ne pas montrer » (ou « Do not show ») est utilisée toute seule", async () => {
  for (const label of ["Ne pas montrer", "do not SHOW", "Ne pas montrer", "Do not show"]) {
    const book = fakeContactBook();
    const cat = book.seedCategory("Soutiens"), hide = book.seedCategory(label);
    book.seedCategory("Autre chose");
    const [a, b] = people(book, cat, 2, { prefix: "S" });
    book.admin.setCategories(b.id, [cat, hide]);
    const { ctx } = makeWorld({ book, settings: { category: cat } });
    assert.deepEqual(names(htmlOf(await page(ctx))), [a.name], label);
    reset();
  }
});

test("ne pas montrer l'emporte sur tout : la personne à l'honneur cachée n'apparaît pas non plus, ni sa carte dans la page d'un groupe", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens"), hide = book.seedCategory("Ne pas montrer");
  const [a, b] = people(book, cat, 2, { prefix: "S" });
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  await D.setHonor(ctx, { month: P.monthKey(), contactId: b.id, why: { fr: "Merci pour tout" } });
  let html = htmlOf(await page(ctx));
  assert.ok(html.includes("tw-spot") && html.includes("Merci pour tout"), "à l'honneur d'abord");
  book.admin.setCategories(b.id, [cat, hide]);
  C.resetWall();
  html = htmlOf(await page(ctx));
  assert.ok(!html.includes("tw-spot") && !html.includes(b.name) && !html.includes("Merci pour tout"));
  assert.deepEqual(names(html), [a.name]);
  assert.ok(htmlOf(await page(ctx, "g", "1")).includes(a.name) && !htmlOf(await page(ctx, "g", "1")).includes(b.name));
});

test("ne pas montrer : la personne à l'honneur qui n'est dans aucun groupe est lue dans Contacts, et la catégorie cachée la masque aussi", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens"), hide = book.seedCategory("Ne pas montrer");
  people(book, cat, 1);
  const lone = book.seedContact({ name: "Seule", categoryIds: [] });
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  await D.setHonor(ctx, { month: P.monthKey(), contactId: lone.id, why: {} });
  assert.ok(htmlOf(await page(ctx)).includes("Seule"));
  book.admin.setCategories(lone.id, [hide]);
  C.resetWall();
  assert.ok(!htmlOf(await page(ctx)).includes("Seule"));
});

test("une fiche arrivée par le formulaire et pas encore relue (« à vérifier ») n'apparaît jamais", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  const [a] = people(book, cat, 1);
  book.seedContact({ name: "Inconnue du formulaire", status: "to_review", categoryIds: [cat] });
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  assert.deepEqual(names(htmlOf(await page(ctx))), [a.name]);
});

test("ne pas montrer, en cas de doute : si Contacts ne dit pas QUI est caché, rien de nouveau n'est publié (le dernier mur connu reste)", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  const [a, b] = people(book, cat, 2, { prefix: "S" });
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  assert.deepEqual(names(htmlOf(await page(ctx))), [a.name, b.name]);
  book.seedContact({ name: "Nouvelle", categoryIds: [cat] });
  book.faults.hang.add("categories");     // impossible de chercher la catégorie « Ne pas montrer »
  C.timing.freshMs = 0;
  const after = htmlOf(await page(ctx));
  assert.ok(!after.includes("Nouvelle"), "pas de publication d'une liste dont on ne peut pas vérifier les exclusions");
  assert.deepEqual(names(after), [a.name, b.name], "le dernier mur connu");
});

test("la catégorie « ne pas montrer » choisie puis supprimée : plus personne n'est caché, et l'administration le dit", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens"), hide = book.seedCategory("Discrets");
  const [a, b] = people(book, cat, 2);
  book.admin.setCategories(b.id, [cat, hide]);
  const { ctx } = makeWorld({ book, settings: { category: cat, hide } });
  assert.equal(names(htmlOf(await page(ctx))).length, 1);
  book.admin.deleteCategory(hide);
  C.resetWall();
  const wall = await C.getWall(ctx);
  assert.equal(wall.hideHow, "gone");
  assert.equal(wall.groups[0].people.length, 2);
  void a;
});

test("la catégorie « ne pas montrer » fusionnée dans une autre : on suit la fusion", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens"), hide = book.seedCategory("Discrets"), other = book.seedCategory("Autres discrets");
  const [, b] = people(book, cat, 2);
  book.admin.setCategories(b.id, [cat, hide]);
  const { ctx } = makeWorld({ book, settings: { category: cat, hide } });
  book.admin.mergeCategories(other, hide);
  C.resetWall();
  assert.equal(names(htmlOf(await page(ctx))).length, 1, "toujours caché après la fusion");
});

/* ───────────── Aucune copie ───────────── */

test("rien n'est recopié : après affichage, messages et mise à l'honneur, le stockage du module ne contient ni nom, ni photo, ni pseudo, ni e-mail", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  const { id } = book.seedContact({ name: "Alice Martin", email: "alice@example.test", categoryIds: [cat], accounts: [{ network: "twitch", handle: "alice_tv", displayName: "Alice TV", avatar: TW_PHOTO }] });
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  await page(ctx);
  await D.setMessage(ctx, id, { fr: "Merci Alice" });
  await D.setHonor(ctx, { month: P.monthKey(), contactId: id, why: { fr: "Toujours là" } });
  await page(ctx);
  const dump = JSON.stringify(ctx.dumpStore());
  for (const copy of ["Alice Martin", "Alice TV", "alice_tv", "alice@example.test", "jtv_user_pictures", TW_PHOTO]) assert.ok(!dump.includes(copy), `« ${copy} » ne doit pas être dans le stockage`);
  assert.ok(dump.includes(id), "seul l'identifiant de la fiche est gardé");
});

/* ───────────── Nom, photos, ordre : les réglages d'affichage ───────────── */

test("réglages d'affichage : prénom seulement, pseudo, sans photos, ordre de Contacts, nombre d'aperçus", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  book.seedContact({ name: "Zoé Dupont", categoryIds: [cat], accounts: [{ network: "twitch", handle: "zoe_tv", displayName: "Zoe_TV", avatar: TW_PHOTO }] });
  book.seedContact({ name: "Anne Lambert", categoryIds: [cat] });
  const { ctx, settings } = makeWorld({ book, settings: { category: cat, nameStyle: "first" } });
  assert.deepEqual(names(htmlOf(await page(ctx))), ["Anne", "Zoé"]);
  settings.nameStyle = "nickname"; settings.order = "oldest";
  assert.deepEqual(names(htmlOf(await page(ctx))), ["Zoe_TV", "Anne Lambert"], "plus ancienne d'abord ; pas de compte : le nom de la fiche");
  settings.order = "newest"; settings.photos = false;
  const html = htmlOf(await page(ctx));
  assert.deepEqual(names(html), ["Anne Lambert", "Zoe_TV"]);
  assert.equal(count(html, /<img /g), 0, "sans photos : les initiales seulement");
  assert.ok(html.includes(">ZT<") || html.includes(">Z<"));
  settings.nameStyle = "n'importe quoi"; settings.order = 7; settings.preview = "abc";
  assert.equal(names(htmlOf(await page(ctx))).length, 2, "valeurs absurdes : retour aux défauts");
});

test("une photo de réseau sur un serveur inconnu n'est pas chargée chez le visiteur : les initiales à la place", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  book.seedContact({ name: "Louis", categoryIds: [cat], accounts: [{ network: "twitch", handle: "louis_tv", avatar: EVIL_PHOTO }] });
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  const html = htmlOf(await page(ctx));
  assert.ok(!html.includes("evil.example") && !html.includes("<img"));
  assert.ok(html.includes(">L<"));
});

/* ───────────── Échappement ───────────── */

test("tout ce qui vient de Contacts ou de la propriétaire est échappé : nom, message, mot, titres, introduction", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("<img src=x onerror=alert(1)>");
  const evil = `<script>alert("x")</script>&"'`;
  const { id } = book.seedContact({ name: evil, categoryIds: [cat], photo: "https://moi.example.test/a.png" });
  const { ctx } = makeWorld({ book, settings: { category: cat, groupTitle: evil, title: evil, intro: "*Bonjour*" } });
  await D.setMessage(ctx, id, { fr: evil });
  await D.setHonor(ctx, { month: P.monthKey(), contactId: id, why: { fr: evil } });
  for (const r of [await page(ctx), await page(ctx, "g", "1")]) {
    const html = htmlOf(r);
    assert.ok(!html.includes("<script") && !/<img src=x/.test(html), html.slice(0, 400));
    assert.ok(html.includes("&lt;script&gt;"));
  }
});

/* ───────────── Pagination ───────────── */

test("un groupe de 120 personnes : l'aperçu en montre 12, la page d'un groupe 50 par page, avec précédent / suivant ; une page de trop est introuvable", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  people(book, cat, 120, { prefix: "P" });
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  const main = htmlOf(await page(ctx));
  assert.equal(names(main).length, 12);
  assert.ok(main.includes("Voir tout le monde (120)") && main.includes('href="/merci/g/1"'));
  const p1 = htmlOf(await page(ctx, "g", "1"));
  assert.equal(names(p1).length, 50);
  assert.ok(p1.includes('rel="next" href="/merci/g/1/page/2"') && !p1.includes('rel="prev"'));
  const p3 = htmlOf(await page(ctx, "g", "1", "page", "3"));
  assert.equal(names(p3).length, 20);
  assert.ok(p3.includes('rel="prev" href="/merci/g/1/page/2"') && !p3.includes('rel="next"'));
  assert.ok((await page(ctx, "g", "1", "page", "4")).notFound);
  assert.ok((await page(ctx, "g", "2")).notFound, "un groupe qui n'existe pas");
  assert.ok((await page(ctx, "n-importe-quoi")).notFound);
  const sorted = names(p1).concat(names(htmlOf(await page(ctx, "g", "1", "page", "2"))), names(p3));
  assert.equal(new Set(sorted).size, 120, "chaque personne une seule fois");
});

test("l'aperçu à la racine du site : les liens ne commencent pas par un double slash", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  people(book, cat, 60);
  const { ctx } = makeWorld({ book, settings: { category: cat }, basePath: "" });
  const main = htmlOf(await page(ctx));
  assert.ok(main.includes('href="/g/1"'));
  const p = htmlOf(await page(ctx, "g", "1"));
  assert.ok(p.includes('href="/"') && p.includes('href="/g/1/page/2"'));
});

test("un très gros groupe : lu par pages de 500 au plus (curseur), 1 000 fiches au plus, et on le dit", async () => {
  const book = fakeContactBook({ maxContacts: 5000 });
  const cat = book.seedCategory("Foule");
  people(book, cat, 1250, { prefix: "F" });
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  const wall = await C.getWall(ctx);
  assert.equal(wall.groups[0].people.length, 1000);
  assert.equal(wall.groups[0].truncated, true);
  const lists = book.calls.filter((c) => c[1] === "list");
  assert.equal(lists.length, 2, "deux lectures de 500");
  assert.ok(lists.every((c) => c[2].limit <= 500 && c[2].categoryId === cat));
  assert.ok(lists[1][2].cursor, "la deuxième page part du curseur de Contacts");
});

/* ───────────── La mémoire du mur ───────────── */

test("mémoire : deux visites rapprochées = une seule lecture ; dix visiteurs en même temps = une seule lecture", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  people(book, cat, 5);
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  await Promise.all(Array.from({ length: 10 }, () => page(ctx)));
  const reads = () => book.calls.filter((c) => c[1] === "list").length;
  assert.equal(reads(), 1);
  await page(ctx); await page(ctx, "g", "1");
  assert.equal(reads(), 1, "le mur est gardé en mémoire");
  C.timing.freshMs = 0;
  await page(ctx);
  assert.equal(reads(), 2, "une fois périmé, il est relu");
});

test("changer un réglage change le mur tout de suite (la mémoire ne sert jamais à un autre réglage)", async () => {
  const book = fakeContactBook();
  const a = book.seedCategory("A"), b = book.seedCategory("B");
  people(book, a, 1, { prefix: "Alpha" }); people(book, b, 1, { prefix: "Beta" });
  const { ctx, settings } = makeWorld({ book, settings: { category: a } });
  assert.ok(htmlOf(await page(ctx)).includes("Alpha"));
  settings.category = b;
  const html = htmlOf(await page(ctx));
  assert.ok(html.includes("Beta") && !html.includes("Alpha"));
});

test("la mémoire est bornée : jamais plus de 20 murs gardés", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  people(book, cat, 1);
  for (let i = 0; i < 30; i++) { const { ctx } = makeWorld({ book, settings: { category: cat }, key: `m${i}` }); await C.getWall(ctx); }
  const probe = makeWorld({ book, settings: { category: cat }, key: "m0" });
  const before = book.calls.length;
  await C.getWall(probe.ctx);
  assert.ok(book.calls.length > before, "les plus anciens ont été oubliés");
});

/* ───────────── Contacts muet, absent, en panne ───────────── */

test("Contacts qui ne répond jamais : la page garde le dernier mur connu, vite", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  const [a] = people(book, cat, 1);
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  assert.deepEqual(names(htmlOf(await page(ctx))), [a.name]);
  for (const m of ["list", "categories", "categoriesResolve", "resolve", "search"]) book.faults.hang.add(m);
  C.timing.freshMs = 0;
  const t0 = Date.now();
  const html = htmlOf(await page(ctx));
  assert.ok(Date.now() - t0 < 2500, "borné");
  assert.deepEqual(names(html), [a.name], "dernier contenu connu");
  assert.ok(!html.includes("se prépare"));
});

test("Contacts muet depuis plus de 24 h : le dernier mur connu expire, message aimable (jamais une erreur)", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  people(book, cat, 2);
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  await page(ctx);
  for (const m of ["list", "categories", "categoriesResolve", "providers"]) book.faults.hang.add(m);
  C.timing.freshMs = 0; C.timing.staleMs = 0;
  const r = await page(ctx);
  assert.ok(!r.notFound && htmlOf(r).includes("Le mur des remerciements se prépare"));
});

test("Contacts qui plante (au lieu de se taire) : même chose, sans rien lever", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  people(book, cat, 2);
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  for (const m of ["list", "categories", "categoriesResolve", "resolve", "search"]) book.faults.throw.add(m);
  const r = await page(ctx);
  assert.ok(htmlOf(r).includes("se prépare"));
});

test("Contacts absent : la page publique reste aimable, l'administration propose de l'installer (par service, jamais par nom)", async () => {
  const { ctx } = makeWorld({ withBook: false });
  const r = await page(ctx);
  assert.ok(!r.notFound && htmlOf(r).includes("se prépare"));
  const blocks = await def.adminPanel(ctx, { query: {} });
  const s = blocks.find((b) => b.type === "suggestInstall");
  assert.deepEqual([s?.service, s?.min], ["contact.book", 2]);
  assert.ok(typeof s.reason === "string" && s.reason.length > 10);
  assert.ok(blocks.some((b) => b.type === "banner"));
});

test("un groupe en panne garde son dernier contenu pendant que les autres se rafraîchissent", async () => {
  const book = fakeContactBook();
  const a = book.seedCategory("A"), b = book.seedCategory("B");
  const pa = people(book, a, 2, { prefix: "Alpha" }); people(book, b, 1, { prefix: "Beta" });
  const { ctx } = makeWorld({ book, settings: { category: a, category2: b } });
  await C.getWall(ctx);
  book.seedContact({ name: "Beta Nouveau", categoryIds: [b] });
  // La lecture du groupe A ne répond plus ; celle du groupe B continue.
  const real = book.services["contact.book"].list;
  book.services["contact.book"].list = (args) => (args.categoryId === a ? new Promise(() => {}) : real(args));
  C.timing.freshMs = 0;
  const wall = await C.getWall(ctx);
  book.services["contact.book"].list = real;
  const [ga, gb] = wall.groups;
  assert.equal(ga.stale, true);
  assert.deepEqual(ga.people.map((p) => p.name), pa.map((p) => p.name));
  assert.equal(gb.people.length, 2, "le groupe B est à jour");
  assert.equal(wall.partial, true);
});

/* ───────────── Catégories et fiches qui changent ───────────── */

test("catégorie fusionnée dans une autre : le mur suit ; catégorie supprimée : le groupe disparaît et l'administration le dit", async () => {
  const book = fakeContactBook();
  const a = book.seedCategory("A"), b = book.seedCategory("B"), c = book.seedCategory("C");
  book.seedCategory("D"); book.seedCategory("E");   // il reste plusieurs catégories : le cœur ne choisit pas à la place de la propriétaire
  people(book, a, 2, { prefix: "A" }); people(book, b, 1, { prefix: "B" }); people(book, c, 1, { prefix: "C" });
  const { ctx, settings } = makeWorld({ book, settings: { category: a, category2: b } });
  book.admin.mergeCategories(c, b);
  C.resetWall();
  let wall = await C.getWall(ctx);
  assert.deepEqual(wall.groups.map((g) => g.categoryId), [a, c], "le groupe 2 suit la fusion");
  assert.equal(wall.groups[1].people.length, 2);
  book.admin.deleteCategory(c);
  C.resetWall();
  wall = await C.getWall(ctx);
  assert.deepEqual(wall.groups.map((g) => g.n), [1]);
  assert.ok(wall.problems.some((p) => p.n === 2 && p.problem === "gone"));
  void settings;
});

test("la catégorie du groupe 1 supprimée : le mur se prépare, et il reste une consigne pour la propriétaire", async () => {
  const book = fakeContactBook();
  const a = book.seedCategory("A"), b = book.seedCategory("B");
  people(book, a, 1);
  const { ctx } = makeWorld({ book, settings: { category: a } });
  book.admin.deleteCategory(a);
  book.seedCategory("D");
  C.resetWall();
  const wall = await C.getWall(ctx);
  assert.deepEqual([wall.state, wall.reason], ["unready", "gone"]);
  void b;
});

test("une fiche fusionnée ou supprimée dans Contacts disparaît du mur au prochain rafraîchissement", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  const [a, b, c] = people(book, cat, 3, { prefix: "S" });
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  assert.equal(names(htmlOf(await page(ctx))).length, 3);
  await book.methods.merge({ keep: a.id, drop: b.id });
  book.admin.deleteContact(c.id);
  C.resetWall();
  assert.deepEqual(names(htmlOf(await page(ctx))), [a.name]);
});

/* ───────────── Mise à l'honneur sur la page ───────────── */

test("à l'honneur : seule la personne du mois en cours est en haut ; un mois futur ou passé n'apparaît pas ; son mot, sinon son message ; la langue du visiteur", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  const [a, b] = people(book, cat, 2, { prefix: "S" });
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  const now = P.monthKey();
  await D.setHonor(ctx, { month: P.addMonths(now, 1), contactId: a.id, why: { fr: "Le mois prochain" } });
  await D.setHonor(ctx, { month: P.addMonths(now, -1), contactId: a.id, why: { fr: "Le mois dernier" } });
  assert.ok(!htmlOf(await page(ctx)).includes("tw-spot"));
  await D.setHonor(ctx, { month: now, contactId: b.id, why: { fr: "Toujours là", en: "Always there" } });
  let html = htmlOf(await page(ctx));
  assert.ok(html.includes("tw-spot") && html.includes("Toujours là") && html.includes(P.esc(`À l'honneur en ${P.monthName(now, "fr")}`)));
  assert.ok(!html.includes("Le mois prochain") && !html.includes("Le mois dernier"));
  const en = makeWorld({ book, settings: { category: cat }, locale: "en" });
  html = htmlOf(await page(en.ctx));
  assert.ok(html.includes("Always there") && html.includes(`In the spotlight in ${P.monthName(now, "en")}`));
  // Sans mot : le message de la personne le remplace.
  await D.setHonor(ctx, { month: now, contactId: b.id, why: {} });
  await D.setMessage(ctx, b.id, { fr: "Un message doux" });
  assert.ok(htmlOf(await page(ctx)).includes("tw-spot-why\">Un message doux"));
});

test("messages sur les cartes : dans la langue du visiteur, sinon celle du site", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  const [a, b] = people(book, cat, 2, { prefix: "S" });
  const fr = makeWorld({ book, settings: { category: cat } });
  await D.setMessage(fr.ctx, a.id, { fr: "Merci pour les blagues", en: "Thanks for the jokes" });
  await D.setMessage(fr.ctx, b.id, { fr: "Merci d'être là" });
  assert.ok(htmlOf(await page(fr.ctx)).includes("Merci pour les blagues"));
  const en = makeWorld({ book, settings: { category: cat }, locale: "en" });
  const html = htmlOf(await page(en.ctx));
  assert.ok(html.includes("Thanks for the jokes") && html.includes("Merci d&#39;être là"), "repli sur la langue du site");
});

test("introduction : un texte de la propriétaire (markdown) sous le titre, et le titre se règle", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  people(book, cat, 1);
  const { ctx } = makeWorld({ book, settings: { category: cat, title: "Nos héros", intro: "Sans vous, rien de tout cela n'existerait." } });
  const r = await page(ctx);
  assert.equal(r.title, "Nos héros");
  assert.equal(r.blocks[0].type, "markdown");
  assert.ok(r.blocks[0].text.includes("Sans vous"));
  assert.ok(r.description.includes("Sans vous"));
});
