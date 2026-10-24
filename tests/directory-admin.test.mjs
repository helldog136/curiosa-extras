// Annuaire — l'administration : le panneau, les écrans, les actions (gabarit, catégories publiques, équipe, fiches publiques, masquer, remettre en ordre),
// les erreurs sous le champ, les droits, la carte (ville → coordonnées arrondies, seulement avec accord). Contacts est le double fakeContactBook (jamais modifié). Aucun vrai réseau.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { makeWorld, reset, restore, publish, people, page, htmlOf, panel, run, P, C, D, Geo, def, manifest } from "./helpers/directory-world.mjs";

const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs")).href);
const { withFakeFetch, netReplies } = kit;

beforeEach(() => reset());
afterEach(() => restore());

const text = (blocks) => JSON.stringify(blocks);
const byType = (blocks, type) => blocks.filter((b) => b.type === type);
const names = (html) => [...html.matchAll(/<p class="dr-name"><a [^>]*>([^<]*)<\/a><\/p>/g)].map((m) => m[1]);
const cfg = async (ctx) => (await D.readData(ctx, { fresh: true })).config;

function setup({ n = 3, rights = [], can = true, settings = {} } = {}) {
  const book = fakeContactBook({ rights });
  const cat = book.seedCategory("Membres");
  const list = people(book, cat, n, { prefix: "P" });
  const w = makeWorld({ book, can, settings });
  return { ...w, cat, list };
}

/* ───────────── Le panneau ───────────── */

test("panneau : Contacts absent → une bannière et la proposition de l'installer", async () => {
  const { ctx } = makeWorld({ withBook: false });
  const blocks = await panel(ctx);
  assert.equal(blocks[0].type, "banner");
  assert.equal(byType(blocks, "suggestInstall")[0].service, "contact.book");
});

test("panneau : un annuaire vide propose un gabarit ; les sections catégories, équipe et remise en ordre s'expliquent", async () => {
  const { ctx } = setup();
  const blocks = await panel(ctx);
  const t = text(blocks);
  assert.ok(t.includes("Commencer avec un modèle"));
  const form = byType(blocks, "adminForm").find((f) => f.action === "template");
  assert.deepEqual(form.fields[0].options.map((o) => o.value), ["association", "collective", "empty"]);
  assert.ok(t.includes("Aucune catégorie publique pour l'instant") && t.includes("Personne dans l'équipe pour l'instant"));
  assert.ok(t.includes("Choisissez d'abord une catégorie à rendre publique"));
});

test("panneau : sans droit d'écriture, on voit tout mais aucun formulaire ni bouton de changement", async () => {
  const { ctx, cat } = setup({ can: false });
  await publish(ctx, [{ id: cat, label: "Membres" }]);
  const blocks = await panel(ctx);
  assert.equal(byType(blocks, "adminForm").length, 0);
  for (const tbl of byType(blocks, "table")) assert.deepEqual(tbl.rowActions ?? [], []);
  assert.ok(!text(blocks).includes("Choisir des catégories"));
  assert.ok(text(await panel(ctx, { cats: "1" })).includes("pas le droit"));
});

test("panneau : le droit « masquer » seul donne le bouton Masquer, pas la fiche publique", async () => {
  const { ctx, cat } = setup({ can: ["hide"] });
  await publish(ctx, [{ id: cat, label: "Membres" }]);
  const t = byType(await panel(ctx), "table").at(-1);
  assert.deepEqual(t.rowActions.map((a) => a.label), ["Masquer"]);
});

test("panneau : le résumé, la phrase « ne pas montrer » avec le nom de la catégorie, les liens vers l'annuaire et vers Contacts", async () => {
  const { ctx, book, cat, list } = setup({ n: 3 });
  await publish(ctx, [{ id: cat, label: "Membres" }]);
  const hide = book.seedCategory("Ne pas montrer");
  book.admin.setCategories(list[1].id, [cat, hide]);
  const blocks = await panel(ctx);
  const t = text(blocks);
  assert.ok(t.includes("2 personne(s) dans la liste, 0 dans l'équipe, 1 catégorie(s) publique(s)"));
  assert.ok(t.includes("La catégorie « Ne pas montrer » de Contacts cache les personnes qui y sont rangées (1 en ce moment)"));
  const links = byType(blocks, "links")[0].items;
  assert.equal(links[0].href, "/annuaire");
  assert.ok(links[1].href.startsWith("/admin/instances/"));
});

test("panneau : les personnes visibles, recherche, pages de 25, masquées ici", async () => {
  const { ctx, cat } = setup({ n: 60 });
  await publish(ctx, [{ id: cat, label: "Membres" }]);
  let blocks = await panel(ctx);
  assert.equal(byType(blocks, "table").at(-1).rows.length, 25);
  assert.ok(text(blocks).includes("Page 1 sur 3"));
  blocks = await panel(ctx, { ppage: "3" });
  assert.equal(byType(blocks, "table").at(-1).rows.length, 10);
  blocks = await panel(ctx, { pq: "p 042" });
  assert.deepEqual(byType(blocks, "table").at(-1).rows.map((r) => r[0].split(" · ")[0]), ["P 042"]);
  await run(ctx, "hide", { id: byType(await panel(ctx, { pq: "p 007" }), "table").at(-1).rowIds[0] });
  blocks = await panel(ctx, { show: "hidden" });
  assert.deepEqual(byType(blocks, "table").at(-1).rows, [["P 007"]]);
});

/* ───────────── Les gabarits ───────────── */

test("gabarit « Association » : mots, catégories créées dans Contacts et publiques, vides à remplir ; l'annuaire s'affiche dès qu'on y range des fiches", async () => {
  const { ctx, book } = setup({ rights: ["categories.create"], n: 0 });
  const r = await run(ctx, "template", { template: "association" });
  assert.ok(r.ok.includes("3 catégorie(s) créée(s) dans Contacts"), r.ok ?? r.error);
  const c = await cfg(ctx);
  assert.equal(c.template, "association");
  assert.deepEqual(c.cats.map((x) => x.label.fr), ["Membres", "Bénévoles", "Anciens membres"]);
  assert.ok(c.cats.every((x) => x.catId), "chaque catégorie de départ est reliée à Contacts");
  assert.equal(c.vocab.fr.nouns, "membres"); assert.equal(c.vocab.en.nouns, "members");
  book.seedContact({ name: "Alice", categoryIds: [c.cats[0].catId] });
  C.resetModel();
  const html = htmlOf(await page(ctx));
  assert.ok(html.includes("1 membre<") && html.includes("Alice"), "les mots du gabarit");
  assert.equal((await page(ctx)).title, "Annuaire");
  assert.ok((await run(ctx, "template", { template: "collective" })).error?.length > 0, "pas deux fois");
});

test("gabarit sans le droit de créer des catégories dans Contacts : les catégories restent « à relier », puis on les relie", async () => {
  const { ctx, book } = setup({ n: 0 });
  const r = await run(ctx, "template", { template: "collective" });
  assert.ok(r.ok.includes("2 à relier vous-même"), r.ok ?? r.error);
  let c = await cfg(ctx);
  assert.deepEqual(c.cats.map((x) => x.catId), [null, null]);
  assert.ok(text(await panel(ctx)).includes("à relier"));
  assert.ok(text(await panel(ctx)).includes("Reliez vos catégories de départ"));
  const mine = book.seedCategory("Les gens");
  const screen = await panel(ctx, { bind: c.cats[0].slug });
  assert.ok(byType(screen, "table")[0].rowIds.includes(`${c.cats[0].slug}:${mine}`));
  assert.ok((await run(ctx, "bindPick", { id: `${c.cats[0].slug}:${mine}` })).ok);
  c = await cfg(ctx);
  assert.equal(c.cats[0].catId, mine);
  assert.ok((await run(ctx, "bindPick", { id: `${c.cats[1].slug}:${mine}` })).error, "une catégorie de Contacts ne sert qu'une fois");
});

test("gabarit « Vide » : rien n'est créé ; un gabarit inconnu → erreur sous le champ", async () => {
  const { ctx } = setup({ rights: ["categories.create"], n: 0 });
  assert.ok((await run(ctx, "template", { template: "nimporte" })).errors?.template?.length > 0);
  assert.ok((await run(ctx, "template", { template: "empty" })).ok);
  assert.deepEqual((await cfg(ctx)).cats, []);
});

/* ───────────── Les catégories publiques ───────────── */

test("catégories : cases à cocher avec recherche, ajout, retrait, libellé public par langue, ordre", async () => {
  const { ctx, book } = setup({ n: 0 });
  const a = book.seedCategory("Créatrices");
  book.seedCategory("Bénévoles"); book.seedCategory("Zèbres");
  let screen = await panel(ctx, { cats: "1" });
  const form = byType(screen, "adminForm").find((f) => f.action === "catPick");
  const boxes = form.fields.filter((f) => f.kind === "checkbox");
  assert.deepEqual(boxes.map((f) => f.label).sort(), ["Bénévoles", "Créatrices", "Membres", "Zèbres"]);
  screen = await panel(ctx, { cats: "1", cq: "zeb" });
  assert.deepEqual(byType(screen, "adminForm").find((f) => f.action === "catPick").fields.filter((f) => f.kind === "checkbox").map((f) => f.label), ["Zèbres"], "recherche sans accents");
  const pick = (labels) => Object.fromEntries(form.fields.flatMap((f) => (f.kind === "hidden" ? [[f.name, f.value]] : [])).concat(form.fields.filter((f) => f.kind === "checkbox" && labels.includes(f.label)).map((f) => [f.name, "on"])));
  let r = await run(ctx, "catPick", pick(["Créatrices", "Bénévoles"]));
  assert.ok(r.ok.includes("2 catégorie(s) ajoutée(s)"));
  assert.deepEqual((await cfg(ctx)).cats.map((x) => x.slug), ["benevoles", "creatrices"], "dans l'ordre de la liste de Contacts");
  await run(ctx, "catUp", { id: "creatrices" });
  assert.deepEqual((await cfg(ctx)).cats.map((x) => x.slug), ["creatrices", "benevoles"]);
  await run(ctx, "catDown", { id: "creatrices" });
  await run(ctx, "catUp", { id: "creatrices" });
  assert.ok((await run(ctx, "catLabel", { slug: "creatrices", label_fr: "Créatrices", label_en: "Creators" })).ok);
  assert.equal((await cfg(ctx)).cats[0].label.en, "Creators");
  assert.ok((await run(ctx, "catLabel", { slug: "creatrices", label_fr: "x".repeat(80) })).errors.label_fr.includes("60"), "l'erreur est sous le champ de la langue");
  assert.equal((await cfg(ctx)).cats[0].slug, "creatrices", "l'adresse ne change jamais quand on renomme");
  r = await run(ctx, "catPick", { id_0: a, name_0: "Créatrices" }); // décochée : retirée
  assert.ok(r.ok.includes("1 retirée"));
  assert.deepEqual((await cfg(ctx)).cats.map((x) => x.slug), ["benevoles"]);
  assert.ok((await run(ctx, "catRemove", { id: "inconnue" })).error);
});

test("catégories : créer une catégorie dans Contacts d'ici (avec le droit) ; sans le droit, l'erreur est sous le champ avec quoi faire", async () => {
  const denied = setup({ n: 0 });
  assert.ok((await run(denied.ctx, "catCreate", { name: "Partenaires" })).errors.name.includes("pas le droit"));
  assert.ok((await run(denied.ctx, "catCreate", { name: "" })).errors.name.includes("Membres"));
  const { ctx, book } = setup({ n: 0, rights: ["categories.create"] });
  assert.ok((await run(ctx, "catCreate", { name: "Partenaires" })).ok.includes("Partenaires"));
  assert.equal((await book.methods.categories({ q: "Partenaires" })).items.length, 1);
  assert.deepEqual((await cfg(ctx)).cats.map((x) => x.slug), ["partenaires"]);
  assert.ok((await run(ctx, "catCreate", { name: "Partenaires" })).ok, "la même catégorie : on la reprend sans doublon");
  assert.equal((await cfg(ctx)).cats.length, 1);
});

test("catégories : 40 au plus, l'erreur dit le maximum", async () => {
  const { ctx, book } = setup({ n: 0 });
  const items = Array.from({ length: 45 }, (_, i) => ({ catId: book.seedCategory(`Cat ${i}`), label: `Cat ${i}` }));
  const r = await D.addCategories(ctx, items);
  assert.equal(r.added, 40); assert.equal(r.full, true);
  assert.equal((await cfg(ctx)).cats.length, 40);
});

test("catégorie supprimée ou fusionnée dans Contacts : signalée, puis « Vérifier mon annuaire » suit la fusion", async () => {
  const { ctx, book, cat } = setup({ n: 2 });
  const other = book.seedCategory("Autres");
  await publish(ctx, [{ id: cat, label: "Membres" }, { id: other, label: "Autres" }]);
  book.admin.mergeCategories(other, cat);
  C.resetModel();
  assert.ok(!text(await panel(ctx)).includes("n'existe plus"), "une fusion n'est pas une disparition");
  const r = await run(ctx, "tidy", {});
  assert.ok(r.ok.includes("1 catégorie(s) suivie(s)"), r.ok ?? r.error);
  const c = await cfg(ctx);
  assert.deepEqual(c.cats.map((x) => x.slug), ["autres"], "le doublon est retiré");
  assert.equal(c.cats[0].catId, other);
  book.admin.deleteCategory(other);
  C.resetModel();
  assert.ok(text(await panel(ctx)).includes("n'existe plus"));
});

/* ───────────── L'équipe ───────────── */

test("équipe : chercher, ajouter avec un titre par langue, changer l'ordre, retirer ; les erreurs sont sous le champ", async () => {
  const { ctx, book, list } = setup({ n: 3 });
  assert.ok((await run(ctx, "teamSearch", { q: "p" })).errors.q.includes("deux lettres"));
  assert.equal((await run(ctx, "teamSearch", { q: "P 00" })).redirect, "?team=1&tq=P%2000");
  assert.equal(byType(await panel(ctx, { team: "1", tq: "P 00" }), "table")[0].rows.length, 3);
  const screen = await panel(ctx, { role: list[0].id });
  assert.equal(byType(screen, "adminForm")[0].fields.filter((f) => f.name.startsWith("role_")).length, 2, "un champ par langue");
  assert.ok((await run(ctx, "teamSave", { contactId: list[0].id, role_fr: "x".repeat(120) })).errors.role_fr.includes("80"));
  assert.ok((await run(ctx, "teamSave", { contactId: list[0].id, role_fr: "Présidente", role_en: "President" })).ok.includes("est dans l'équipe"));
  await run(ctx, "teamSave", { contactId: list[1].id, role_fr: "Trésorier" });
  assert.deepEqual((await cfg(ctx)).team.map((m) => m.contactId), [list[0].id, list[1].id]);
  await run(ctx, "teamUp", { id: list[1].id });
  assert.deepEqual((await cfg(ctx)).team.map((m) => m.contactId), [list[1].id, list[0].id]);
  const again = await run(ctx, "teamSave", { contactId: list[0].id, role_fr: "Vice-présidente" });
  assert.ok(again.ok.includes("Titre enregistré") && (await cfg(ctx)).team.length === 2, "ajouter deux fois = modifier");
  assert.ok(text(await panel(ctx)).includes("Vice-présidente"));
  await run(ctx, "teamRemove", { id: list[1].id });
  assert.equal((await cfg(ctx)).team.length, 1);
  book.admin.setCategories(list[2].id, [book.seedCategory("Ne pas montrer")]);
  assert.ok((await run(ctx, "teamSave", { contactId: list[2].id, role_fr: "X" })).error.includes("cachée"), "une fiche cachée ne rejoint pas l'équipe");
  assert.ok((await run(ctx, "teamSave", { contactId: "nimporte", role_fr: "X" })).error.includes("n'existe plus"));
});

test("équipe : 60 au plus ; une fiche de l'équipe supprimée dans Contacts est signalée puis oubliée par « Vérifier »", async () => {
  const { ctx, book } = setup({ n: 0 });
  const ids = people(book, [], 62, { prefix: "T" }).map((x) => x.id);
  for (const id of ids.slice(0, 60)) assert.ok((await D.addTeamMember(ctx, id, {})).ok);
  assert.equal((await D.addTeamMember(ctx, ids[60], {})).code, "too_many");
  book.admin.deleteContact(ids[0]);
  C.resetModel();
  assert.ok(text(await panel(ctx)).includes("1 personne(s) de l'équipe n'existent plus"));
  await run(ctx, "tidy", {});
  assert.equal((await cfg(ctx)).team.length, 59);
});

/* ───────────── Les fiches publiques ───────────── */

test("fiche publique : présentation par langue et ville ; trop long → erreur sous le champ ; vide → la fiche est retirée", async () => {
  const { ctx, cat, list } = setup({ n: 1 });
  await publish(ctx, [{ id: cat, label: "Membres" }]);
  const screen = await panel(ctx, { person: list[0].id });
  assert.equal(byType(screen, "adminForm")[0].fields.find((f) => f.name === "bio_fr").kind, "textarea");
  assert.ok((await run(ctx, "personSave", { contactId: list[0].id, bio_fr: "x".repeat(400), city: "" })).errors.bio_fr.includes("280"));
  assert.ok((await run(ctx, "personSave", { contactId: list[0].id, city: "y".repeat(120) })).errors.city.includes("80"));
  assert.ok((await run(ctx, "personSave", { contactId: list[0].id, bio_fr: "Elle joue.", bio_en: "She plays.", city: "Namur" })).ok.includes("P 001"));
  const p = (await D.readData(ctx, { fresh: true })).profiles.get(list[0].id);
  assert.equal(p.bio.en, "She plays."); assert.equal(p.city, "Namur"); assert.equal(p.geo, null, "pas d'accord pour la carte : jamais de coordonnées");
  await run(ctx, "personSave", { contactId: list[0].id, city: "" });
  assert.equal((await D.readData(ctx, { fresh: true })).profiles.size, 0);
});

test("carte : avec l'accord (catégorie), la ville est située (nom de ville seulement envoyé), arrondie ; sans accord, aucun appel ni coordonnée", async () => {
  const { ctx, book, cat, list, settings } = setup({ n: 2 });
  await publish(ctx, [{ id: cat, label: "Membres" }]);
  const ok = book.seedCategory("Accepte la carte");
  settings.mapConsent = ok;
  book.admin.setCategories(list[0].id, [cat, ok]);
  await withFakeFetch({ "https://geocoding-api.open-meteo.com/": { json: { results: [{ name: "Namur", country: "Belgique", latitude: 50.46691, longitude: 4.86746 }] } } }, async (f) => {
    assert.ok((await run(ctx, "personSave", { contactId: list[1].id, city: "Namur" })).ok);
    assert.equal(f.calls.length, 0, "pas d'accord : aucun appel réseau");
    const yes = await run(ctx, "personSave", { contactId: list[0].id, city: "Namur" });
    assert.ok(yes.ok.includes("Namur, Belgique"), yes.ok ?? JSON.stringify(yes));
    assert.equal(f.calls.length, 1);
    assert.ok(f.calls[0].url.includes("name=Namur") && !f.calls[0].url.includes("P%20001"), "seule la ville part");
    assert.ok((await run(ctx, "personSave", { contactId: list[0].id, city: "Namur", bio_fr: "Salut" })).ok);
    assert.equal(f.calls.length, 1, "même ville : pas de nouvel appel");
  });
  assert.deepEqual((await D.readData(ctx, { fresh: true })).profiles.get(list[0].id).geo, { lat: 50.47, lng: 4.87 });
  assert.equal((await D.readData(ctx)).profiles.get(list[1].id).geo, null);
});

test("carte : ville introuvable ou service muet → erreur sous le champ « Ville », rien n'est enregistré à moitié", async () => {
  const { ctx, book, cat, list, settings } = setup({ n: 1 });
  await publish(ctx, [{ id: cat, label: "Membres" }]);
  const ok = book.seedCategory("Accepte la carte");
  settings.mapConsent = ok;
  book.admin.setCategories(list[0].id, [cat, ok]);
  await withFakeFetch({ "https://geocoding-api.open-meteo.com/": { json: { generationtime_ms: 1 } } }, async () => {
    assert.ok((await run(ctx, "personSave", { contactId: list[0].id, city: "Nullepartville" })).errors.city.includes("pas trouvé"));
  });
  await withFakeFetch({ "https://geocoding-api.open-meteo.com/": netReplies.down() }, async () => {
    assert.ok((await run(ctx, "personSave", { contactId: list[0].id, city: "Namur" })).errors.city.includes("ne répond pas"));
  });
  assert.equal((await D.readData(ctx, { fresh: true })).profiles.size, 0);
});

test("géolocalisation : seulement un nom de ville, borné ; une réponse absurde est refusée", async () => {
  const { ctx } = setup({ n: 0 });
  await withFakeFetch({ "https://geocoding-api.open-meteo.com/": { json: { results: [{ name: "X", latitude: 999, longitude: 4 }] } } }, async () => {
    assert.equal((await Geo.lookupCity(ctx, "X")).ok, false);
  });
  assert.equal((await Geo.lookupCity(ctx, "")).why, "invalid");
});

/* ───────────── Masquer, remettre en ordre ───────────── */

test("masquer / remontrer : un clic, sans toucher Contacts ; la personne masquée reste listée dans « masquées ici »", async () => {
  const { ctx, book, cat, list } = setup({ n: 3 });
  await publish(ctx, [{ id: cat, label: "Membres" }]);
  assert.ok((await run(ctx, "hide", { id: list[1].id })).ok);
  assert.deepEqual(names(htmlOf(await page(ctx))), ["P 001", "P 003"]);
  assert.ok(text(await panel(ctx)).includes("Voir les personnes masquées ici (1)"));
  assert.equal((await book.methods.get({ id: list[1].id })).contact.name, "P 002");
  assert.equal((await run(ctx, "unhide", { id: list[1].id })).redirect, "?show=hidden");
  assert.equal(names(htmlOf(await page(ctx))).length, 3);
});

test("remettre en ordre : une fiche fusionnée dans Contacts garde sa présentation, une fiche supprimée est oubliée", async () => {
  const { ctx, book, cat, list } = setup({ n: 3 });
  await publish(ctx, [{ id: cat, label: "Membres" }]);
  await D.patchProfile(ctx, list[0].id, { bio: { fr: "Garde-moi" } });
  await D.patchProfile(ctx, list[1].id, { bio: { fr: "Je pars" } });
  await D.addTeamMember(ctx, list[1].id, { fr: "Secrétaire" });
  await book.methods.merge({ keep: list[0].id, drop: list[1].id });
  book.admin.deleteContact(list[2].id);
  await D.patchProfile(ctx, list[2].id, { city: "Ghost" });
  const r = await run(ctx, "tidy", {});
  assert.ok(r.ok.includes("fiche(s) suivie(s)"), r.ok ?? r.error);
  const data = await D.readData(ctx, { fresh: true });
  assert.equal(data.profiles.get(list[0].id).bio.fr, "Garde-moi", "la présentation déjà écrite pour la fiche gardée n'est jamais écrasée");
  assert.equal(data.profiles.has(list[1].id), false);
  assert.equal(data.profiles.has(list[2].id), false);
  assert.deepEqual(data.config.team.map((m) => m.contactId), [list[0].id]);
  assert.equal((await run(ctx, "tidy", {})).ok, "Tout est en ordre.");
});

/* ───────────── Le manifeste ───────────── */

test("les droits et actions du manifeste correspondent au code ; chaque action d'écriture exige un droit", () => {
  const rights = new Set(manifest.rights.map((r) => r.id));
  assert.deepEqual([...rights].sort(), ["edit", "hide"]);
  for (const [name, a] of Object.entries(def.adminActions)) {
    assert.equal(typeof a, "object", name);
    assert.ok(rights.has(a.right), `${name} : droit « ${a.right} » déclaré`);
  }
  assert.deepEqual(Object.entries(def.adminActions).filter(([, a]) => a.right === "hide").map(([n]) => n).sort(), ["hide", "unhide"]);
});
