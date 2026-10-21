// Contacts (lot K2) — l'administration : onglet « Mes contacts », cinq sections, accessibilité des nouveaux écrans (FR et EN), tableaux d'une seule colonne
// (lisibles sur téléphone), catégories d'une fiche en deux gestes, droits du module.
import test from "node:test";
import assert from "node:assert/strict";
import { makeCtx, def, B, svc, readJson, htmlOf, plain, exportText } from "./helpers/contactsK2.mjs";
import { fakePrivacySubject } from "./helpers/fakeContactBook.mjs";

const manifest = readJson("module.json");

test("manifeste : l'onglet « Utiliser » s'appelle « Mes contacts » / « My contacts » (un seul onglet renommé, aucun ajouté), minCore 0.2.2, deux fichiers d'export déclarés", () => {
  assert.deepEqual(manifest.tabs, [{ id: "use", label: { fr: "Mes contacts", en: "My contacts" } }]);
  assert.ok(manifest.tabs.filter((t) => !["use", "settings", "sources", "general"].includes(t.id)).length <= 3, "tabs.reasonable : 3 onglets ajoutés au plus");
  assert.ok(manifest.tabs.every((t) => t.label.fr.length <= 20 && t.label.en.length <= 20), "noms courts");
  assert.equal(manifest.minCore, "0.2.2");
  assert.deepEqual(Object.keys(def.adminDownloads).sort(), ["contacts", "importReport", "person", "template"]);
  assert.deepEqual(manifest.rights.map((r) => r.id), ["email.view", "export", "categories.create"]);
  assert.deepEqual(manifest.requires.map((r) => [r.service, r.optional === true]), [["privacy.subject", true], ["twitch.api", true], ["youtube.api", true]], "connecteurs en dépendance FACULTATIVE");
});

test("les cinq sections (Contacts, Organisations, Catégories, Doublons, Importer / exporter) sont sur chaque écran, avec la bonne page marquée", async () => {
  for (const [locale, labels] of [["fr", ["Contacts", "Organisations", "Catégories", "Doublons", "Importer / exporter"]], ["en", ["Contacts", "Organisations", "Categories", "Duplicates", "Import / export"]]]) {
    const ctx = makeCtx({ locale });
    const views = { contacts: {}, orgs: { kind: "org" }, categories: { view: "categories" }, dupes: { view: "dupes" }, import: { view: "import" } };
    for (const [name, query] of Object.entries(views)) {
      const html = htmlOf(await def.adminPanel(ctx, { query }));
      for (const l of labels) assert.match(html, new RegExp(`>${l.replace("/", "\\/")}</a>`), `${locale} ${name} : ${l}`);
      assert.equal([...html.matchAll(/aria-current="page"/g)].length >= 1, true);
    }
  }
});

async function book(ctx) {
  const org = await svc.create(ctx, { name: "Acme", kind: "org" });
  const a = await svc.create(ctx, { name: "Marie Dupont", organisation: "Acme", email: "m@example.test" });
  const b = await svc.create(ctx, { name: "Marie Dupond", organisation: "Acme" });
  await B.addAccount(ctx, { id: a.id, network: "twitch", handle: "marie_live" });
  await B.createCategory(ctx, { label: "Amis" }, { allowed: true });
  await svc.note(ctx, { id: a.id, text: "Note", author: "admin" });
  return { org: org.id, a: a.id, b: b.id };
}

test("accessibilité (FR et EN) des écrans ajoutés : images avec alt, liens avec un texte, champs étiquetés, navigation nommée, ids uniques, barre de progression nommée, aucun script", async () => {
  for (const locale of ["fr", "en"]) {
    const sub = fakePrivacySubject("raid-like");
    const ctx = makeCtx({ locale, subjects: [sub] });
    const { a, b } = await book(ctx);
    await def.adminActions.importStart(ctx, { csv: "name,accounts\nA,twitch:aaaa_live\nB,@bad\n" });
    const queries = [{ view: "dupes" }, { view: "merge", a, b }, { view: "merge", keep: a, drop: b }, { view: "import" }, { view: "import", show: "created" }, { view: "erased" }, { contact: a, erase: "1" }, { contact: a }, { view: "merge", a, b: "x" }];
    for (const query of queries) {
      const blocks = await def.adminPanel(ctx, { query });
      const html = htmlOf(blocks);
      for (const img of html.match(/<img\b[^>]*>/g) ?? []) assert.match(img, /\salt="[^"]*"/, `${locale} ${JSON.stringify(query)}`);
      for (const [, attrs, inner] of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) assert.ok(inner.replace(/<[^>]+>/g, "").trim() || /aria-label|title=/.test(attrs), `lien sans texte : ${attrs}`);
      for (const input of html.match(/<input\b(?![^>]*type="hidden")[^>]*>/g) ?? []) { const id = /id="([^"]+)"/.exec(input)?.[1]; assert.ok(id && html.includes(`for="${id}"`), `champ sans étiquette : ${input}`); }
      for (const nav of html.match(/<nav\b[^>]*>/g) ?? []) assert.match(nav, /aria-label="[^"]+"/);
      for (const bar of html.match(/<div class="ct-bar"[^>]*>/g) ?? []) assert.match(bar, /role="progressbar"[^>]*aria-label="[^"]+"[^>]*aria-valuenow="\d+"/);
      for (const ul of html.match(/<ul class="ct-stats"[^>]*>/g) ?? []) assert.match(ul, /aria-label="[^"]+"/);
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      assert.equal(new Set(ids).size, ids.length, "ids uniques");
      for (const f of blocks.filter((x) => x.type === "adminForm")) for (const field of f.fields) if (field.kind !== "hidden") assert.ok(field.label && field.label.length > 1, `champ ${field.name} étiqueté`);
      for (const t of blocks.filter((x) => x.type === "table")) for (const act of t.rowActions ?? []) if (act.danger) assert.ok(act.confirm, `${act.label} : confirmation`);
      for (const f of blocks.filter((x) => x.type === "adminForm")) assert.ok(f.submitLabel && f.submitLabel.length > 2, "bouton nommé");
      assert.doesNotMatch(html, /<script/i);
    }
  }
});

test("téléphone : tout tableau des écrans de Contacts n'a qu'UNE colonne, aucun <table> en HTML brut, les grilles passent à une colonne sous 700 px", async () => {
  const ctx = makeCtx({ locale: "fr" });
  const { a, b } = await book(ctx);
  await def.adminActions.importStart(ctx, { csv: "name\nA\n" });
  const all = [];
  for (const query of [{}, { kind: "org" }, { view: "categories" }, { view: "dupes" }, { view: "merge", a, b }, { view: "merge", keep: a, drop: b }, { view: "import" }, { contact: a }, { contact: a, erase: "1" }, { view: "erased" }]) all.push(...(await def.adminPanel(ctx, { query })));
  for (const t of all.filter((x) => x.type === "table")) assert.equal(t.columns.length, 1, `tableau « ${t.columns[0]} » à une colonne`);
  assert.doesNotMatch(htmlOf(all), /<table/);
  const css = htmlOf(all.slice(0, 1));
  assert.match(css, /\.ct-cmp\{[^}]*grid-template-columns:1fr/);
  assert.match(css, /@media \(min-width:700px\)\{\.ct-cmp\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\}/);
  assert.match(css, /\.ct-stats\{[^}]*repeat\(2,minmax\(0,1fr\)\)/, "les chiffres de l'import : deux par ligne sur téléphone");
  assert.match(css, /overflow-wrap:anywhere/);
});

test("catégories d'une fiche, simplement : la liste avec « Retirer », un choix et un bouton pour ajouter — rien à cocher parmi des centaines", async () => {
  const ctx = makeCtx({ locale: "fr" });
  const { a } = await book(ctx);
  const cats = [];
  for (const l of ["Raid", "Zèbres", "Amis proches"]) cats.push((await B.createCategory(ctx, { label: l }, { allowed: true })).id);
  let page = await def.adminPanel(ctx, { query: { contact: a } });
  const form = page.find((b) => b.action === "addToCategory");
  assert.deepEqual(form.fields.map((f) => [f.name, f.kind]), [["id", "hidden"], ["category", "select"]]);
  assert.deepEqual(form.fields[1].options.map((o) => o.label), ["Amis", "Amis proches", "Raid", "Zèbres"], "triées, sans accents ni casse");
  assert.equal(form.submitLabel, "Ajouter à la catégorie");
  assert.equal((await def.adminActions.addToCategory(ctx, { id: a, category: cats[0] })).ok, "Catégorie ajoutée.");
  assert.equal((await def.adminActions.addToCategory(ctx, { id: a, category: cats[1] })).ok, "Catégorie ajoutée.");
  page = await def.adminPanel(ctx, { query: { contact: a } });
  const list = page.find((b) => b.type === "table" && b.rowActions?.[0]?.action === "removeFromCategory");
  assert.deepEqual(list.rows.map((r) => r[0]).sort(), ["Raid", "Zèbres"]);
  assert.equal(page.find((b) => b.action === "addToCategory").fields[1].options.some((o) => o.label === "Raid"), false, "une catégorie déjà là n'est plus proposée");
  assert.equal((await def.adminActions.removeFromCategory(ctx, { id: list.rowIds[0] })).ok, "Catégorie retirée de la fiche.");
  assert.equal((await svc.get(ctx, { id: a })).contact.categoryIds.length, 1);
  assert.deepEqual((await def.adminActions.addToCategory(ctx, { id: a, category: "inconnue" })).errors, { category: "Cette catégorie n'existe plus." });
  // Aucune catégorie du tout : on dit où en créer une.
  const empty = makeCtx({ locale: "fr" });
  const x = await svc.create(empty, { name: "Seul" });
  assert.match(plain(await def.adminPanel(empty, { query: { contact: x.id } })), /Aucune catégorie n'existe encore\. Créez-en une dans l'onglet/);
  // La catégorie vue depuis Raid (`?category=`) liste les fiches ajoutées ainsi.
  const raid = (await svc.get(ctx, { id: a })).contact.categoryIds[0];
  assert.match(htmlOf(await def.adminPanel(ctx, { query: { category: raid } })), /Marie Dupont/);
});

test("un module installé sans les connecteurs reste utilisable : aucun besoin dur autre que le contrat ; la page ne casse pas si `privacy.subject` n'existe pas", async () => {
  const ctx = makeCtx({ locale: "en", subjects: [] });
  const { a } = await book(ctx);
  assert.ok((await def.adminPanel(ctx, { query: { contact: a, erase: "1" } })).some((b) => b.action === "erase"));
  assert.equal((await def.adminActions.erase(ctx, { id: a, confirm: "on" })).ok, "Card deleted.");
  assert.ok((await exportText(ctx)).includes("Marie Dupond"));
});
