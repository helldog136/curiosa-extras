// Service « contact.book » du module Contacts : lire, chercher, créer sans doublon, corriger, annoter — validations et règle de dédoublonnage.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/contacts", import.meta.url).pathname;
const manifestJson = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const def = (await import("../modules/contacts/index.mjs")).default;
const svc = def.services["contact.book"];
const store = def.services["contact.store"];
const ctx = () => fakeCtx({ key: "contacts", messages: en });

test("manifeste : offre contact.store ET contact.book (lectures déclarées readOnly), valide", () => {
  const r = parseManifest(manifestJson);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual(r.manifest.offers.map((o) => o.service), ["contact.store", "contact.book", "contact.curate"]);
  assert.deepEqual(r.manifest.offers[1].readOnly, ["get", "resolve", "find", "accounts", "search", "list", "categories", "categoriesResolve"], "2.0 : toutes les lectures");
  assert.equal(r.manifest.offers[1].version, 2, "contact.book version 2 (sur-ensemble de la v1)");
  for (const m of ["get", "find", "resolve", "create", "update", "note"]) assert.equal(typeof svc[m], "function", m);
});

test("create : fiche active, source partenariats, e-mail en minuscules ; renvoie la fiche avec un lien d'admin", async () => {
  const c = ctx();
  const r = await svc.create(c, { name: "  Ada  Lovelace ", email: " ADA@Example.ORG ", role: "CEO", organisation: "Acme", phone: "123" });
  assert.deepEqual([r.ok, r.created], [true, true]);
  assert.equal(r.contact.email, "ada@example.org");
  assert.equal(r.contact.name, "Ada Lovelace");
  assert.equal(r.contact.adminPath, `/admin/instances/id-contacts?contact=${r.id}`);
  const row = await c.api.store.get(r.id);
  assert.deepEqual([row.data.status, row.data.source], ["active", "partnerships"]);
  const r2 = await svc.create(c, { name: "Bob", source: "n'importe quoi", status: "to_review" });
  assert.deepEqual([(await c.api.store.get(r2.id)).data.source, (await c.api.store.get(r2.id)).data.status], ["partnerships", "to_review"], "source inconnue → partenariats ; statut valide accepté");
});

test("create : dédoublonnage par e-mail sans tenir compte des majuscules → renvoie l'existant, ne modifie rien", async () => {
  const c = ctx();
  const a = await svc.create(c, { name: "Ada", email: "ada@x.org", phone: "1" });
  const b = await svc.create(c, { name: "Ada Autre", email: "ADA@X.ORG", phone: "2" });
  assert.deepEqual([b.ok, b.created, b.id, b.matchedBy], [true, false, a.id, "email"]);
  assert.equal(await c.api.store.count("contacts"), 1);
  assert.deepEqual([(await c.api.store.get(a.id)).data.name, (await c.api.store.get(a.id)).data.phone], ["Ada", "1"], "l'existant n'est pas écrasé");
});

test("create : sans e-mail, dédoublonnage par nom + organisation (casse, accents, espaces ignorés) ; autre organisation = autre personne", async () => {
  const c = ctx();
  const a = await svc.create(c, { name: "Hélène Martin", organisation: "Acme" });
  const same = await svc.create(c, { name: "  helene   MARTIN ", organisation: "ACME" });
  assert.deepEqual([same.created, same.id, same.matchedBy], [false, a.id, "name+organisation"]);
  const other = await svc.create(c, { name: "Hélène Martin", organisation: "Globex" });
  assert.equal(other.created, true);
  const noOrg = await svc.create(c, { name: "Hélène Martin" });
  assert.equal(noOrg.created, true, "organisation vide ≠ Acme");
  assert.equal((await svc.create(c, { name: "Hélène Martin" })).created, false, "deux organisations vides sont identiques");
  assert.equal(await c.api.store.count("contacts"), 3);
});

test("create : validations (nom obligatoire, e-mail valide) et plafond ; rien n'est enregistré", async () => {
  const c = ctx();
  assert.deepEqual(await svc.create(c, { name: "   " }), { ok: false, error: "name_required" });
  assert.deepEqual(await svc.create(c, { email: "a@b.io" }), { ok: false, error: "name_required" });
  assert.deepEqual(await svc.create(c, { name: "X", email: "pas-un-mail" }), { ok: false, error: "invalid_email" });
  for (const bad of [undefined, null, "texte", 42]) assert.equal((await svc.create(c, bad)).ok, false);
  assert.equal(await c.api.store.count("contacts"), 0);
  // 2.0 : plafond technique 100 000 fiches, abaissé ici par l'option de test interne (jamais un réglage visible).
  c.__contactsTest = { maxContacts: 3 };
  for (let i = 0; i < 3; i++) assert.equal((await svc.create(c, { name: `n${i}` })).created, true);
  assert.deepEqual(await svc.create(c, { name: "De trop" }), { ok: false, error: "too_many" });
  assert.equal(await c.api.store.count("contacts"), 3);
});

test("create : champs tronqués, caractères de contrôle retirés, note initiale facultative", async () => {
  const c = ctx();
  const r = await svc.create(c, { name: "A\u0000B", phone: "1".repeat(300), note: "Repris de X", evil: "<script>" });
  const row = await c.api.store.get(r.id);
  assert.equal(row.data.name, "AB"); assert.equal(row.data.phone.length, 60); assert.ok(!("evil" in row.data));
  assert.equal((await c.api.store.list("notes"))[0].data.text, "Repris de X");
});

test("get : fiche complète avec notes (récentes d'abord) ; introuvable, note ou identifiant absurde → not_found", async () => {
  const c = ctx();
  const { id } = await svc.create(c, { name: "Ada", others: "Discord: ada" });
  await svc.note(c, { id, text: "premier", author: "partnerships" });
  const r = await svc.get(c, { id });
  assert.equal(r.ok, true);
  assert.deepEqual(r.contact.notes.map((n) => [n.text, n.author]), [["premier", "partnerships"]]);
  assert.equal(r.contact.others, "Discord: ada");
  const noteId = (await c.api.store.list("notes"))[0].id;
  for (const bad of [{ id: "nope" }, { id: noteId }, { id: "" }, { id: "x".repeat(500) }, {}, null]) assert.deepEqual(await svc.get(c, bad), { ok: false, error: "not_found" });
});

test("find : critères cumulés (e-mail exact sans casse, nom exact sans accents, q = morceau), limite, e-mail invalide refusé", async () => {
  const c = ctx();
  await svc.create(c, { name: "Ada", email: "ada@x.org", organisation: "Acme" });
  await svc.create(c, { name: "Éloïse", organisation: "Acme" });
  await svc.create(c, { name: "Bob", organisation: "Globex" });
  assert.deepEqual((await svc.find(c, { email: "ADA@x.org" })).contacts.map((x) => x.name), ["Ada"]);
  assert.deepEqual((await svc.find(c, { name: "eloise" })).contacts.map((x) => x.name), ["Éloïse"]);
  assert.deepEqual((await svc.find(c, { organisation: "acme" })).total, 2);
  assert.deepEqual((await svc.find(c, { q: "glob" })).contacts.map((x) => x.name), ["Bob"]);
  assert.deepEqual((await svc.find(c, { q: "acme", name: "ada" })).contacts.map((x) => x.name), ["Ada"]);
  const r = await svc.find(c, { limit: 1 });
  assert.deepEqual([r.contacts.length, r.total], [1, 3]);
  assert.deepEqual(await svc.find(c, { email: "xx" }), { ok: false, error: "invalid_email" });
  assert.deepEqual((await svc.find(c, { q: "zzz" })).contacts, []);
});

test("find / resolve n'exposent que le résumé : ni notes, ni autres canaux, ni relation", async () => {
  const c = ctx();
  const { id } = await svc.create(c, { name: "Ada", others: "secret", relation: "ami", note: "privé" });
  const found = (await svc.find(c, {})).contacts[0];
  // 2.0 : la fiche v1 + kind, orgId, orgName, categoryIds, accounts (sans e-mail ni téléphone), photo.
  assert.deepEqual(Object.keys(found).sort(), ["accounts", "adminPath", "categoryIds", "createdAt", "email", "id", "kind", "name", "orgId", "orgName", "organisation", "phone", "photo", "role", "source", "status"]);
  assert.ok(!JSON.stringify(await svc.resolve(c, { ids: [id] })).match(/secret|ami|privé/));
});

test("resolve : plusieurs fiches d'un coup, ordre libre, manquantes signalées, 100 au plus", async () => {
  const c = ctx();
  const a = (await svc.create(c, { name: "A" })).id, b = (await svc.create(c, { name: "B" })).id;
  const r = await svc.resolve(c, { ids: [b, "nope", a, a, 7] });
  assert.deepEqual(r.contacts.map((x) => x.id).sort(), [a, b].sort());
  assert.deepEqual(r.missing, ["nope"]);
  assert.deepEqual(await svc.resolve(c, { ids: Array(101).fill("x") }), { ok: false, error: "invalid" });
  assert.deepEqual(await svc.resolve(c, {}), { ok: false, error: "invalid" });
});

test("update : seuls les champs donnés changent ; e-mail pris par un autre → email_taken ; nom vide, e-mail invalide, rien à changer refusés ; le statut ne passe pas par là", async () => {
  const c = ctx();
  const a = (await svc.create(c, { name: "Ada", email: "ada@x.org", role: "CEO" })).id;
  const b = (await svc.create(c, { name: "Bob", email: "bob@x.org" })).id;
  const r = await svc.update(c, { id: a, phone: "42", role: "", status: "to_review", source: "agent" });
  assert.deepEqual([r.ok, r.contact.phone, r.contact.role], [true, "42", null]);
  assert.deepEqual([(await c.api.store.get(a)).data.status, (await c.api.store.get(a)).data.source], ["active", "partnerships"]);
  assert.deepEqual(await svc.update(c, { id: a, email: "BOB@x.org" }), { ok: false, error: "email_taken", id: b });
  assert.equal((await svc.update(c, { id: a, email: "ADA@x.org" })).ok, true, "son propre e-mail reste permis");
  assert.deepEqual(await svc.update(c, { id: a, name: " " }), { ok: false, error: "name_required" });
  assert.deepEqual(await svc.update(c, { id: a, email: "nope" }), { ok: false, error: "invalid_email" });
  assert.deepEqual(await svc.update(c, { id: a }), { ok: false, error: "nothing_to_update" });
  assert.deepEqual(await svc.update(c, { id: "nope", name: "x" }), { ok: false, error: "not_found" });
  assert.equal((await c.api.store.get(a)).data.name, "Ada");
});

test("note : ajoutée avec date et auteur (60 caractères), vide ou fiche inconnue refusées", async () => {
  const c = ctx();
  const { id } = await svc.create(c, { name: "Ada" });
  assert.deepEqual(await svc.note(c, { id, text: "  Rappelé  ", author: "a".repeat(100) }), { ok: true, id });
  const n = (await c.api.store.list("notes"))[0].data;
  assert.deepEqual([n.contactId, n.text, n.author.length, n.date], [id, "Rappelé", 60, new Date().toISOString().slice(0, 10)]);
  assert.deepEqual(await svc.note(c, { id, text: "   " }), { ok: false, error: "text_required" });
  assert.deepEqual(await svc.note(c, { id: "nope", text: "x" }), { ok: false, error: "not_found" });
  assert.equal((await svc.note(c, { id, text: "ok" })).ok, true);
  assert.equal((await c.api.store.list("notes")).find((x) => x.data.text === "ok").data.author, "module");
});

test("contact.store reste inchangé (formulaire) : à vérifier, même e-mail → note ajoutée ; le carnet voit ces fiches via contact.book", async () => {
  const c = ctx();
  const first = await store.add(c, { name: "Alice", email: "Alice@x.org", message: "Bonjour", source: "contact-form" });
  const again = await store.add(c, { name: "Alice", email: "alice@x.org", message: "Re", source: "contact-form" });
  assert.deepEqual([first.created, again.created, again.id], [true, false, first.id]);
  const found = (await svc.find(c, { email: "alice@x.org" })).contacts[0];
  assert.deepEqual([found.status, found.source], ["to_review", "contact-form"]);
  assert.equal((await svc.create(c, { name: "Alice", email: "ALICE@x.org" })).created, false, "le formulaire et les partenariats ne se doublonnent pas");
});

test("MCP : descriptions qui disent quand utiliser l'outil et quand passer par Partenariats ; aucune écriture accordée d'office (2.0)", () => {
  const by = Object.fromEntries(manifestJson.mcp.map((t) => [t.name, t]));
  for (const t of manifestJson.mcp) assert.ok(t.description.length > 60 && t.description.length < 1000, t.name);
  assert.match(by.contacts_list.description, /Partnerships|partnership/);
  assert.match(by.contact_create.description, /partner_link_contact/);
  assert.match(by.contact_create.description, /contacts_list/, "chercher avant de créer");
  assert.match(by.contact_note.description, /partner_log/);
  assert.deepEqual([by.contact_create.default, by.contact_note.default, by.contact_update.default, by.contact_delete.default, by.contact_add_account.default, by.contact_get_private.default], [false, false, false, false, false, false]);
  assert.equal(by.contact_delete.destructive, true);
});

test("admin : la source « partenariats » a un libellé dans les deux langues ; la page liste le contact avec cette origine", async () => {
  for (const l of ["en", "fr"]) assert.ok(JSON.parse(fs.readFileSync(`${DIR}/locales/${l}.json`, "utf8")).source_partnerships);
  const c = ctx();
  await svc.create(c, { name: "<b>Ada</b>", email: "a@x.org" });
  // 2.0 : la liste est faite de cartes (bloc html, texte échappé par le module) ; l'origine se lit sur la fiche.
  const list = (await def.adminPanel(c, { query: {} })).map((b) => b.html ?? "").join("");
  assert.match(list, /&lt;b&gt;Ada&lt;\/b&gt;/);
  assert.doesNotMatch(list, /<b>Ada/);
  const id = (await svc.find(c, {})).contacts[0].id;
  const card = (await def.adminPanel(c, { query: { contact: id } })).map((b) => b.html ?? b.text ?? "").join("");
  assert.match(card, /Partnerships/);
});
