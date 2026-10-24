// Annuaire — le cœur : ce qu'on lit dans Contacts (double fakeContactBook, jamais modifié), qui est visible, la recherche sans accents, les filtres, le tri, les curseurs,
// ce que voit le visiteur (liste, fiche, équipe, version imprimable), Contacts muet ou absent, échappement. Aucun réseau.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { makeWorld, reset, restore, publish, people, page, htmlOf, P, C, D, Dir, TW_PHOTO, EVIL_PHOTO } from "./helpers/directory-world.mjs";

beforeEach(() => reset());
afterEach(() => restore());

const names = (html) => [...html.matchAll(/<p class="dr-name"><a [^>]*>([^<]*)<\/a><\/p>/g)].map((m) => m[1]);
const count = (html, re) => (html.match(re) ?? []).length;

/* ───────────── Les petites fonctions ───────────── */

test("recherche : sans accents ni majuscules, plusieurs mots, pertinence", () => {
  assert.equal(P.fold("  Hélène   MARTIN "), "helene martin");
  assert.deepEqual(P.tokens("  ÉLODIE   du  Pré "), ["elodie", "du", "pre"]);
  const e = (name) => ({ fname: P.fold(name), key: P.fold(name) });
  assert.equal(P.score(e("Hélène Martin"), P.tokens("helene")), 0, "le nom commence par le mot");
  assert.equal(P.score(e("Anne-Hélène Martin"), P.tokens("helene")), 2, "un mot collé par un tiret : ailleurs dans le nom");
  assert.equal(P.score(e("Anne Hélène"), P.tokens("helene")), 1, "un mot du nom commence par lui");
  assert.equal(P.score(e("Anne Martin"), P.tokens("helene")), null);
  assert.equal(P.score(e("Anne Martin"), P.tokens("mar anne")), 1, "tous les mots doivent être présents (l'ordre n'importe pas)");
  assert.equal(P.score(e("Anne Martin"), P.tokens("mar zoe")), null);
});

test("adresses : lisible mais seul l'identifiant public compte ; jamais l'identifiant de Contacts", () => {
  const h = P.personHash("c0001");
  assert.match(h, /^[0-9a-f]{10}$/);
  assert.ok(!h.includes("c0001"));
  const slug = P.personSlug("Hélène Martin-Dupont", h);
  assert.equal(slug, `helene-martin-dupont-${h}`);
  assert.equal(P.hashOfSlug(slug), h);
  assert.equal(P.hashOfSlug(P.personSlug("Élodie renommée", h)), h, "un autre nom donne la même fiche");
  assert.equal(P.hashOfSlug("pas-un-identifiant"), null);
  assert.equal(P.personSlug("", h), h);
  assert.equal(P.hashOfSlug(h), h);
});

test("curseur : lisible seulement s'il a la bonne forme", () => {
  assert.deepEqual(P.readCursor("12.0123456789"), { pos: 12, hash: "0123456789" });
  for (const bad of ["", "x", "12", "12.zz", "-1.0123456789", "12.0123456789;drop", "1234567.0123456789", null, undefined]) assert.equal(P.readCursor(bad), null, String(bad));
});

test("photos : à la main en https ou sur le site ; d'un réseau seulement depuis ses serveurs connus ; l'origine dit si le site prévient un tiers", () => {
  assert.deepEqual(P.photoOf({ url: "/uploads/a.png", source: "manual" }), { src: "/uploads/a.png", own: true });
  assert.deepEqual(P.photoOf({ url: "https://moi.example.test/p.png", source: "manual" }), { src: "https://moi.example.test/p.png", own: false });
  assert.deepEqual(P.photoOf({ url: TW_PHOTO, source: "twitch" }), { src: TW_PHOTO, own: false });
  for (const bad of [{ url: EVIL_PHOTO, source: "twitch" }, { url: "//evil.example/x.png", source: "manual" }, { url: "javascript:alert(1)", source: "manual" }, { url: "http://x.example/p.png", source: "manual" }, { url: "/uploads/../x", source: "manual" }, null]) assert.equal(P.photoOf(bad), null, JSON.stringify(bad));
});

test("liens : https seulement, sans identifiant ; jamais d'e-mail ni de téléphone dans ce qu'on garde d'une fiche", async () => {
  assert.equal(P.linkUrl("https://www.twitch.tv/alice_tv"), "https://www.twitch.tv/alice_tv");
  for (const bad of ["http://x.example/a", "javascript:alert(1)", "https://user:pw@x.example/", "https://x.example/a b", "https://x.example/\"onmouseover=\"x", "https://localhost/", "x".repeat(400)]) assert.equal(P.linkUrl(bad), null, bad);
  const book = fakeContactBook();
  const { id } = book.seedContact({ name: "Alice Martin", email: "alice@example.test", phone: "+32 470 00 00 00", role: "plombière", organisation: "Atelier X", accounts: [{ network: "twitch", handle: "alice_tv" }] });
  const r = await book.methods.resolve({ ids: [id] });
  const p = C.reduceCard(r.contacts[0], new Set());
  const dump = JSON.stringify(p);
  for (const secret of ["alice@example.test", "+32 470", "plombi", "Atelier X"]) assert.ok(!dump.includes(secret), secret);
  assert.equal(p.links[0].u, "https://www.twitch.tv/alice_tv");
});

test("CSV : une cellule qui commence par = + - @ ne devient jamais une formule ; guillemets doublés", () => {
  assert.equal(P.cell("=1+1"), "\"'=1+1\"");
  assert.equal(P.cell("+33"), "\"'+33\"");
  assert.equal(P.cell("@x"), "\"'@x\"");
  assert.equal(P.cell("a \"b\"\nc"), "\"a \"\"b\"\" c\"");
});

test("coordonnées : arrondies à la ville, absurdes refusées", () => {
  assert.deepEqual(P.roundGeo(50.46691, 4.86746), { lat: 50.47, lng: 4.87 });
  for (const [a, b] of [[91, 0], [0, 181], ["x", 1], [null, null]]) assert.equal(P.roundGeo(a, b), null);
});

/* ───────────── Qui est visible ───────────── */

async function setup({ n = 5, settings = {}, cats = ["Membres"] } = {}) {
  const book = fakeContactBook();
  const ids = cats.map((c) => book.seedCategory(c));
  const list = people(book, ids[0], n, { prefix: "P" });
  const w = makeWorld({ book, settings });
  await publish(w.ctx, ids.map((id, i) => ({ id, label: cats[i] })));
  return { ...w, ids, list };
}

test("une catégorie publique : ses personnes apparaissent, triées de A à Z, avec le compteur", async () => {
  const { ctx } = await setup({ n: 5 });
  const html = htmlOf(await page(ctx));
  assert.deepEqual(names(html), ["P 001", "P 002", "P 003", "P 004", "P 005"]);
  assert.ok(html.includes("5 personnes"));
});

test("une personne qui n'est dans aucune catégorie publique n'apparaît pas ; l'équipe peut y échapper", async () => {
  const { ctx, book } = await setup({ n: 2 });
  const { id } = book.seedContact({ name: "Zoé Hors" });
  assert.ok(!htmlOf(await page(ctx)).includes("Zoé Hors"));
  await D.addTeamMember(ctx, id, { fr: "Présidente", en: "President" });
  C.resetModel();
  const html = htmlOf(await page(ctx));
  assert.ok(html.includes("Zoé Hors") && html.includes("Présidente"), "l'équipe est en tête, avec son titre");
  assert.deepEqual(names(html).slice(0, 3), ["Zoé Hors", "P 001", "P 002"], "l'équipe d'abord, puis la liste");
  assert.equal(count(html, /dr-team/g) > 0, true);
});

test("« Ne pas montrer » l'emporte : même dans l'équipe, même dans une catégorie publique ; les fiches à relire ne sortent jamais", async () => {
  const { ctx, book, ids, list } = await setup({ n: 3 });
  const hide = book.seedCategory("Ne pas montrer");
  book.admin.setCategories(list[0].id, [ids[0], hide]);
  await D.addTeamMember(ctx, list[0].id, { fr: "Trésorière" });
  book.seedContact({ name: "À relire", status: "to_review", categoryIds: [ids[0]] });
  const html = htmlOf(await page(ctx));
  assert.ok(!html.includes("P 001") && !html.includes("Trésorière") && !html.includes("À relire"));
  assert.deepEqual(names(html), ["P 002", "P 003"]);
});

test("« Ne pas montrer » choisie dans les réglages : on la suit ; supprimée : plus personne n'est caché (dit à l'administration)", async () => {
  const { ctx, book, ids, list, settings } = await setup({ n: 2 });
  const stop = book.seedCategory("Retrait demandé");
  settings.hide = stop;
  book.admin.setCategories(list[1].id, [ids[0], stop]);
  assert.deepEqual(names(htmlOf(await page(ctx))), ["P 001"]);
  book.admin.deleteCategory(stop);
  C.resetModel();
  assert.deepEqual(names(htmlOf(await page(ctx))), ["P 001", "P 002"], "catégorie supprimée : plus personne n'est caché");
  const model = await C.getModel(ctx);
  assert.equal(model.hideHow, "gone");
});

test("masquer ici : la personne disparaît de la liste, de l'équipe et de sa fiche, sans toucher Contacts ; remontrer la ramène", async () => {
  const { ctx, book, list } = await setup({ n: 3 });
  const hash = P.personHash(list[1].id);
  assert.ok(htmlOf(await page(ctx, "p", P.personSlug("P 002", hash))).includes("P 002"));
  await D.patchProfile(ctx, list[1].id, { hidden: true });
  const html = htmlOf(await page(ctx));
  assert.deepEqual(names(html), ["P 001", "P 003"]);
  assert.equal((await page(ctx, "p", P.personSlug("P 002", hash))).notFound, true, "sa fiche n'existe plus pour les visiteurs");
  assert.equal((await book.methods.get({ id: list[1].id })).ok, true, "Contacts n'a pas bougé");
  await D.patchProfile(ctx, list[1].id, { hidden: false });
  assert.equal(names(htmlOf(await page(ctx))).length, 3);
});

test("accord obligatoire (réglage « a accepté d'apparaître ») : seules les personnes des deux catégories ; catégorie disparue : personne", async () => {
  const { ctx, book, ids, list, settings } = await setup({ n: 3 });
  const ok = book.seedCategory("A accepté");
  settings.consent = ok;
  book.admin.setCategories(list[0].id, [ids[0], ok]);
  assert.deepEqual(names(htmlOf(await page(ctx))), ["P 001"]);
  book.admin.deleteCategory(ok);
  C.resetModel();
  assert.deepEqual(names(htmlOf(await page(ctx))), [], "l'accord est exigé mais sa catégorie a disparu : personne n'est montré");
});

test("noms : comme la fiche, prénom seulement ou pseudo du compte ; une organisation garde son nom entier", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Membres");
  book.seedContact({ name: "Sophie Martin", categoryIds: [cat], accounts: [{ network: "twitch", handle: "sophie_tv", displayName: "Sophie_TV" }] });
  book.seedContact({ name: "Atelier Du Nord", kind: "org", categoryIds: [cat] });
  const { ctx, settings } = makeWorld({ book });
  await publish(ctx, [{ id: cat, label: "Membres" }]);
  assert.deepEqual(names(htmlOf(await page(ctx))), ["Atelier Du Nord", "Sophie Martin"]);
  settings.nameStyle = "first"; C.resetModel();
  assert.deepEqual(names(htmlOf(await page(ctx))), ["Atelier Du Nord", "Sophie"]);
  settings.nameStyle = "nickname"; C.resetModel();
  assert.deepEqual(names(htmlOf(await page(ctx))).sort(), ["Atelier Du Nord", "Sophie_TV"]);
});

/* ───────────── Recherche, filtres, tri, pages ───────────── */

test("recherche par le chemin /q/… : accents ignorés, compteur « sur », aucune correspondance → message et lien pour tout afficher", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Membres");
  for (const n of ["Hélène Martin", "Helena Rossi", "Zoé Durand", "Élodie Hélène"]) book.seedContact({ name: n, categoryIds: [cat] });
  const { ctx } = makeWorld({ book });
  await publish(ctx, [{ id: cat, label: "Membres" }]);
  const html = htmlOf(await page(ctx, "q", "helene"));
  assert.deepEqual(names(html), ["Hélène Martin", "Élodie Hélène"], "Hélène en tête (le nom commence par le mot), puis ailleurs");
  assert.ok(html.includes("2 personnes sur 4"));
  const none = htmlOf(await page(ctx, "q", "zzz"));
  assert.ok(none.includes("Personne ne correspond") && none.includes("Tout afficher"));
});

test("filtres : une ou plusieurs catégories (l'une OU l'autre), pastilles actives, catégorie inconnue → 404", async () => {
  const book = fakeContactBook();
  const a = book.seedCategory("Créateurs"), b = book.seedCategory("Bénévoles"), c = book.seedCategory("Invités");
  book.seedContact({ name: "Alice", categoryIds: [a] });
  book.seedContact({ name: "Bob", categoryIds: [b] });
  book.seedContact({ name: "Carl", categoryIds: [c] });
  book.seedContact({ name: "Dina", categoryIds: [a, b] });
  const { ctx } = makeWorld({ book });
  await publish(ctx, [{ id: a, label: "Créateurs" }, { id: b, label: "Bénévoles" }, { id: c, label: "Invités" }]);
  const slugs = (await D.readData(ctx)).config.cats.map((x) => x.slug);
  assert.deepEqual(slugs, ["createurs", "benevoles", "invites"], "adresses stables lisibles");
  assert.deepEqual(names(htmlOf(await page(ctx, "c", "createurs"))), ["Alice", "Dina"]);
  assert.deepEqual(names(htmlOf(await page(ctx, "c", "createurs+benevoles"))), ["Alice", "Bob", "Dina"]);
  const html = htmlOf(await page(ctx, "c", "benevoles"));
  assert.ok(/aria-current="true">Bénévoles/.test(html), "la pastille active");
  assert.equal((await page(ctx, "c", "inconnue")).notFound, true);
  assert.equal((await page(ctx, "c", "createurs+createurs")).notFound, true, "doublon refusé");
});

test("tri : A–Z, récents d'abord, au hasard mais le même toute la journée", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Membres");
  for (const n of ["Zoé", "Anne", "Marc", "Léa", "Bob", "Cleo", "Dan", "Eve"]) book.seedContact({ name: n, categoryIds: [cat] });
  const { ctx } = makeWorld({ book });
  await publish(ctx, [{ id: cat, label: "Membres" }]);
  assert.deepEqual(names(htmlOf(await page(ctx))), ["Anne", "Bob", "Cleo", "Dan", "Eve", "Léa", "Marc", "Zoé"]);
  assert.deepEqual(names(htmlOf(await page(ctx, "s", "new"))), ["Eve", "Dan", "Cleo", "Bob", "Léa", "Marc", "Anne", "Zoé"], "le plus récemment créé d'abord");
  const mix1 = names(htmlOf(await page(ctx, "s", "mix")));
  const mix2 = names(htmlOf(await page(ctx, "s", "mix")));
  assert.deepEqual(mix1, mix2, "stable");
  assert.deepEqual([...mix1].sort(), ["Anne", "Bob", "Cleo", "Dan", "Eve", "Léa", "Marc", "Zoé"]);
  const view = Dir.getView(ctx, await C.getModel(ctx), await D.readData(ctx));
  assert.notDeepEqual(Dir.sorted(view, "mix", "2026-01-01").map((e) => e.name), Dir.sorted(view, "mix", "2026-01-02").map((e) => e.name), "un autre jour, un autre ordre");
});

test("pages par curseur : 24 par page, précédent / suivant, aucun doublon ni trou, curseur périmé ou illisible sans erreur", async () => {
  const { ctx } = await setup({ n: 60 });
  const p1 = htmlOf(await page(ctx));
  assert.equal(names(p1).length, 24);
  assert.ok(p1.includes("60 personnes") && p1.includes("1 à 24 sur 60"));
  const next = /rel="next" href="([^"]+)"/.exec(p1)[1];
  assert.match(next, /\/annuaire\/after\/24\.[0-9a-f]{10}$/);
  const seg = (href) => href.split("/").slice(2).map(decodeURIComponent);
  const p2 = htmlOf(await page(ctx, ...seg(next)));
  assert.deepEqual(names(p2).slice(0, 2), ["P 025", "P 026"]);
  assert.ok(/rel="prev" href="\/annuaire"/.test(p2), "retour à la première page = l'adresse sans curseur");
  const p3 = htmlOf(await page(ctx, ...seg(/rel="next" href="([^"]+)"/.exec(p2)[1])));
  assert.equal(names(p3).length, 12);
  assert.ok(!/rel="next"/.test(p3) && /aria-disabled="true">Suivant/.test(p3));
  assert.equal(new Set([...names(p1), ...names(p2), ...names(p3)]).size, 60);
  // Une fiche cachée entre-temps : le curseur retombe sur la bonne place (par l'identifiant, pas par le rang).
  await D.patchProfile(ctx, (await C.getModel(ctx)).people.keys().next().value, { hidden: true });
  assert.ok(names(htmlOf(await page(ctx, ...seg(next)))).length >= 23);
  assert.equal((await page(ctx, "after", "12.zzzzzzzzzz")).notFound, true, "illisible : introuvable");
  assert.equal(names(htmlOf(await page(ctx, "after", "9.0123456789"))).length, 24, "curseur inconnu : on repart du début");
});

test("la liste n'affiche jamais plus de 50 personnes, même si le réglage dit davantage", async () => {
  const { ctx, settings } = await setup({ n: 80 });
  settings.perPage = 500;
  assert.equal(names(htmlOf(await page(ctx))).length, 50);
  settings.perPage = 2;
  assert.equal(names(htmlOf(await page(ctx))).length, 6, "au moins 6");
});

/* ───────────── La fiche, l'équipe, l'impression ───────────── */

test("fiche : nom, titre, ville, catégories, présentation, liens ; « autres de la même catégorie » ; adresse qui survit à un changement de nom", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Créateurs");
  const { id } = book.seedContact({ name: "Alice Martin", categoryIds: [cat], accounts: [{ network: "twitch", handle: "alice_tv" }], photo: "/uploads/alice.png" });
  for (const n of ["Bob", "Cleo", "Dan"]) book.seedContact({ name: n, categoryIds: [cat] });
  const { ctx } = makeWorld({ book });
  await publish(ctx, [{ id: cat, label: "Créateurs" }]);
  await D.patchProfile(ctx, id, { bio: { fr: "Elle <b>crée</b> des jeux." }, city: "Namur" });
  const hash = P.personHash(id);
  const p = await page(ctx, "p", P.personSlug("Alice Martin", hash));
  const html = htmlOf(p);
  assert.ok(html.includes("Alice Martin") && html.includes("Namur") && html.includes("Créateurs"));
  assert.ok(html.includes("Elle &lt;b&gt;crée&lt;/b&gt; des jeux."), "la présentation est échappée");
  assert.ok(html.includes('href="https://www.twitch.tv/alice_tv"') && html.includes('rel="noopener noreferrer nofollow"'));
  assert.ok(html.includes("Autres personnes : Créateurs") && html.includes("Bob"));
  assert.ok(html.includes('src="/uploads/alice.png"'), "une photo du site se charge sans prévenir personne");
  assert.equal(p.title, "Alice Martin — Annuaire");
  assert.equal(htmlOf(await page(ctx, "p", P.personSlug("Autre nom", hash))).includes("Alice Martin"), true, "seul l'identifiant public compte");
  assert.equal((await page(ctx, "p", "alice-0000000000")).notFound, true);
  assert.equal((await page(ctx, "p", "nimporte")).notFound, true);
});

test("photos hébergées ailleurs : jamais chargées sans l'accord du visiteur (lien « photos »), sauf réglage « Toujours » ; « Jamais » = initiales", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Membres");
  book.seedContact({ name: "Alice", categoryIds: [cat], accounts: [{ network: "twitch", handle: "alice_tv", avatar: TW_PHOTO }] });
  book.seedContact({ name: "Bob", categoryIds: [cat], photo: "/uploads/b.png" });
  const { ctx, settings } = makeWorld({ book });
  await publish(ctx, [{ id: cat, label: "Membres" }]);
  let html = htmlOf(await page(ctx));
  assert.ok(!html.includes(TW_PHOTO) && html.includes("/uploads/b.png"));
  assert.ok(html.includes("Afficher les photos"), "le lien existe");
  html = htmlOf(await page(ctx, "photos"));
  assert.ok(html.includes(TW_PHOTO) && html.includes('referrerpolicy="no-referrer"'));
  assert.ok(html.includes(`/annuaire/p/`) && html.includes("/photos\""), "les liens gardent le choix");
  settings.photos = "always"; assert.ok(htmlOf(await page(ctx)).includes(TW_PHOTO));
  settings.photos = "never"; html = htmlOf(await page(ctx, "photos")); assert.ok(!html.includes(TW_PHOTO) && !html.includes("/uploads/b.png"));
});

test("liens vers les comptes : dans la fiche (défaut), dans la liste, ou nulle part", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Membres");
  const { id } = book.seedContact({ name: "Alice", categoryIds: [cat], accounts: [{ network: "twitch", handle: "alice_tv" }] });
  const { ctx, settings } = makeWorld({ book });
  await publish(ctx, [{ id: cat, label: "Membres" }]);
  const slug = P.personSlug("Alice", P.personHash(id));
  assert.ok(!htmlOf(await page(ctx)).includes("twitch.tv"));
  assert.ok(htmlOf(await page(ctx, "p", slug)).includes("twitch.tv"));
  settings.links = "list"; assert.ok(htmlOf(await page(ctx)).includes("twitch.tv"));
  settings.links = "none"; assert.ok(!htmlOf(await page(ctx, "p", slug)).includes("twitch.tv"));
});

test("présentation courte : cachée si le réglage la coupe", async () => {
  const { ctx, list, settings } = await setup({ n: 1 });
  await D.patchProfile(ctx, list[0].id, { bio: { fr: "Un petit mot." } });
  const slug = P.personSlug("P 001", P.personHash(list[0].id));
  assert.ok(htmlOf(await page(ctx, "p", slug)).includes("Un petit mot."));
  settings.bio = false; assert.ok(!htmlOf(await page(ctx, "p", slug)).includes("Un petit mot."));
});

test("données structurées : seulement si le réglage est activé, Person ou Organization, avec ce que la fiche montre", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Membres");
  const a = book.seedContact({ name: "Alice Martin", categoryIds: [cat], accounts: [{ network: "twitch", handle: "alice_tv" }] });
  const o = book.seedContact({ name: "Atelier Nord", kind: "org", categoryIds: [cat] });
  const { ctx, settings } = makeWorld({ book });
  await publish(ctx, [{ id: cat, label: "Membres" }]);
  await D.patchProfile(ctx, a.id, { bio: { fr: "Elle crée." }, city: "Namur" });
  await D.addTeamMember(ctx, a.id, { fr: "Présidente" });
  const pa = P.personSlug("Alice Martin", P.personHash(a.id)), po = P.personSlug("Atelier Nord", P.personHash(o.id));
  assert.ok(!htmlOf(await page(ctx, "p", pa)).includes("ld+json"), "désactivé par défaut");
  settings.structured = true;
  const ld = (html) => JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);
  const person = ld(htmlOf(await page(ctx, "p", pa)));
  assert.equal(person["@type"], "Person"); assert.equal(person.name, "Alice Martin"); assert.equal(person.jobTitle, "Présidente"); assert.equal(person.description, "Elle crée.");
  assert.deepEqual(person.sameAs, ["https://www.twitch.tv/alice_tv"]);
  assert.equal(person.url, `https://site.example.test/annuaire/p/${pa}`);
  assert.equal(ld(htmlOf(await page(ctx, "p", po)))["@type"], "Organization");
  assert.ok(!JSON.stringify(person).includes("</script"));
});

test("équipe : en tête, dans l'ordre choisi, avec le titre ; page /team ; titre réglable", async () => {
  const { ctx, book, settings } = await setup({ n: 2 });
  const a = book.seedContact({ name: "Alice" }), b = book.seedContact({ name: "Bob" });
  await D.addTeamMember(ctx, b.id, { fr: "Trésorier", en: "Treasurer" });
  await D.addTeamMember(ctx, a.id, { fr: "Présidente", en: "President" });
  const html = htmlOf(await page(ctx));
  assert.deepEqual(names(html).slice(0, 2), ["Bob", "Alice"], "l'ordre choisi, pas l'ordre alphabétique");
  assert.ok(html.includes("Trésorier") && html.includes(">Équipe<"));
  settings.teamTitle = "Le bureau";
  assert.ok(htmlOf(await page(ctx)).includes(">Le bureau<"));
  assert.ok(htmlOf(await page(ctx, "team")).includes("Présidente"));
  assert.equal((await page(ctx, "team", "photos")).notFound, undefined);
  const none = (await setup({ n: 1 })).ctx;
  assert.equal((await page(none, "team")).notFound, true, "pas d'équipe : pas de page");
});

test("version imprimable : un tableau, filtré comme la liste, avec le bouton Imprimer et sans le curseur", async () => {
  const { ctx } = await setup({ n: 3 });
  const html = htmlOf(await page(ctx, "print"));
  assert.ok(html.includes("<table") && html.includes("P 001") && html.includes("Imprimer"));
  assert.equal((await page(ctx, "print", "after", "1.0123456789")).notFound, true);
  assert.equal(count(htmlOf(await page(ctx, "print", "q", "p 002")), /<tr><td>/g), 1);
});

/* ───────────── Les mots, les états ───────────── */

test("vocabulaire : les mots du gabarit, puis les réglages de la propriétaire, puis les mots neutres de la langue", async () => {
  const { ctx, settings } = await setup({ n: 2 });
  assert.ok(htmlOf(await page(ctx)).includes("2 personnes"));
  assert.equal((await page(ctx)).title, "Annuaire");
  await D.updateConfig(ctx, (c) => { c.vocab = { fr: { title: "Créateurs", noun: "créateur", nouns: "créateurs", team: "Équipe" } }; return { ok: true }; });
  assert.ok(htmlOf(await page(ctx)).includes("2 créateurs")); assert.equal((await page(ctx)).title, "Créateurs");
  settings.nouns = "membres"; settings.title = "Nos membres";
  assert.ok(htmlOf(await page(ctx)).includes("2 membres")); assert.equal((await page(ctx)).title, "Nos membres");
  const one = (await setup({ n: 1 })).ctx;
  assert.ok(htmlOf(await page(one)).includes("1 personne<"));
});

test("Contacts absent, muet, ou rien de réglé : un message aimable, jamais une erreur", async () => {
  const none = makeWorld({ withBook: false });
  const r1 = await page(none.ctx);
  assert.ok(!r1.notFound && htmlOf(r1).includes("se prépare"));
  const book = fakeContactBook();
  const cat = book.seedCategory("Membres");
  people(book, cat, 2);
  const w = makeWorld({ book });
  assert.ok(htmlOf(await page(w.ctx)).includes("se remplit bientôt"), "rien n'est réglé");
  await publish(w.ctx, [{ id: cat, label: "Membres" }]);
  book.faults.hang.add("list");
  assert.ok(htmlOf(await page(w.ctx)).includes("se prépare"), "Contacts muet et rien de connu");
});

test("Contacts devient muet : le dernier annuaire connu reste (24 h au plus)", async () => {
  const { ctx, book } = await setup({ n: 3 });
  assert.equal(names(htmlOf(await page(ctx))).length, 3);
  book.faults.hang.add("list");
  C.timing.freshMs = 0; // tout est périmé : on veut reconstruire
  assert.equal(names(htmlOf(await page(ctx))).length, 3, "le dernier annuaire connu");
  C.timing.staleMs = -1;
  C.resetModel();
  assert.ok(htmlOf(await page(ctx)).includes("se prépare"));
});

test("tout ce qui vient de Contacts ou de la propriétaire est échappé ; une recherche piégée n'est ni gardée ni exécutée", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("<img src=x onerror=alert(1)>");
  const { id } = book.seedContact({ name: "<script>alert(1)</script> Eve", categoryIds: [cat] });
  const { ctx } = makeWorld({ book });
  await publish(ctx, [{ id: cat, label: "<img src=x onerror=alert(1)>" }]);
  await D.patchProfile(ctx, id, { city: "<b>Ville</b>" });
  const html = htmlOf(await page(ctx)) + htmlOf(await page(ctx, "p", P.personSlug("x", P.personHash(id))));
  assert.ok(!/<script>alert|<img src=x|<b>Ville/.test(html), "pas de balise injectée");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!htmlOf(await page(ctx, "q", "\"><script>alert(1)</script>")).includes("<script>alert(1)</script>"));
  assert.equal((await D.readData(ctx)).profiles.size, 1, "la recherche n'écrit rien");
});

test("adresses de la page : autre chose que le contrat → 404 ; une adresse sans paramètre est canonique", async () => {
  const { ctx } = await setup({ n: 2 });
  for (const bad of [["x"], ["c"], ["q"], ["s", "nimporte"], ["p"], ["p", "a", "b", "c"], ["team", "x"], ["q", "a", "q", "b"], ["print", "print"]]) assert.equal((await page(ctx, ...bad)).notFound, true, bad.join("/"));
  assert.equal(Dir.listPath("/annuaire", { cats: ["a", "b"], q: "hélène/x", sort: "new", photos: true, cursor: "12.0123456789" }), "/annuaire/c/a+b/q/h%C3%A9l%C3%A8ne%20x/s/new/photos/after/12.0123456789");
  assert.equal(Dir.listPath("", {}), "/");
});
