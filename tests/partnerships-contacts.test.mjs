// Partenariats ↔ Contacts : fiches qui ne font que RÉFÉRENCER des personnes, outils MCP, module Contacts absent, (la reprise de l'ancien carnet est testée dans partnerships-migration.test.mjs).
// Toutes les données sont factices.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const PDIR = new URL("../modules/partnerships", import.meta.url).pathname;
const CDIR = new URL("../modules/contacts", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const manifest = readJson(`${PDIR}/module.json`);
const partnersEn = readJson(`${PDIR}/locales/en.json`);
const contactsEn = readJson(`${CDIR}/locales/en.json`);
const def = (await import("../modules/partnerships/index.mjs")).default;
const mod = await import("../modules/partnerships/index.mjs");
const book = (await import("../modules/contacts/index.mjs")).default.services["contact.book"];
const actor = { name: "claude" };
const find = (blocks, type) => blocks.filter((b) => b.type === type);

/** Un carnet Contacts (son propre contexte) et un contexte Partenariats branché dessus par le vrai service. */
function setup({ withBook = true } = {}) {
  const bookCtx = fakeCtx({ key: "contacts", messages: contactsEn });
  const services = withBook ? { "contact.book": Object.fromEntries(Object.keys(book).map((m) => [m, (args) => book[m](bookCtx, args)])) } : {};
  const ctx = fakeCtx({ key: "partnerships", locale: "en", messages: partnersEn, services });
  return { ctx, bookCtx, add: async (c) => (await book.create(bookCtx, c)).id };
}
const panelText = (blocks) => JSON.stringify(blocks);

test("manifeste : Partenariats REQUIERT contact.book (comme contact-form requiert contact.store) ; valide", () => {
  const r = parseManifest(manifest);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual(r.manifest.requires.map((x) => x.service), ["contact.book"]);
  assert.deepEqual(r.manifest.offers.map((x) => x.service), ["privacy.subject"], "Partenariats n'offre que privacy.subject : il ne possède que ses fiches");
});

test("fiche : contacts liés résolus par le service (nom, fonction, e-mail, lien vers Contacts) ; formulaires lier / créer présents", async () => {
  const { ctx, add } = setup();
  const c1 = await add({ name: "Ada", role: "CEO", email: "ada@x.org" });
  const c2 = await add({ name: "Bob", email: "bob@x.org" });
  const p = await ctx.api.store.add("partners", { brand: "Acme", status: "discussion", contactIds: [c1] });
  const blocks = await def.adminPanel(ctx, { query: { partner: p } });
  const people = find(blocks, "table").find((t) => t.columns[0] === "Name");
  assert.deepEqual(people.rows, [["Ada", "CEO", "ada@x.org", ""]]);
  assert.deepEqual(people.rowIds, [`${p}~${c1}`]);
  assert.deepEqual(people.rowActions.map((a) => a.action), ["unlinkContact"]);
  assert.match(blocks.find((b) => b.type === "markdown" && /Open in Contacts/.test(b.text)).text, new RegExp(`\\[Ada\\]\\(/admin/instances/id-contacts\\?contact=${c1}\\)`));
  assert.deepEqual(find(blocks, "adminForm").map((f) => f.action), ["addJournal", "linkContact", "createContact"]);
  const pick = find(blocks, "adminForm")[1].fields.find((f) => f.name === "contactId");
  assert.deepEqual(pick.options.map((o) => o.value), ["", c2], "la liste ne propose pas les personnes déjà liées");
});

test("lier : par la liste, par la recherche (un seul résultat), idempotent ; plusieurs / aucun résultat → message clair ; fiche inconnue refusée", async () => {
  const { ctx, add } = setup();
  const c1 = await add({ name: "Ada", email: "ada@x.org" });
  await add({ name: "Adam", email: "adam@x.org" });
  const p = await ctx.api.store.add("partners", { brand: "Acme" });
  assert.match((await def.adminActions.linkContact(ctx, { partnerId: p, contactId: c1 })).ok, /"Ada" is linked/);
  assert.match((await def.adminActions.linkContact(ctx, { partnerId: p, contactId: c1 })).ok, /already linked/);
  assert.deepEqual((await ctx.api.store.get(p)).data.contactIds, [c1]);
  assert.match((await def.adminActions.linkContact(ctx, { partnerId: p, search: "ADAM@x.org" })).ok, /Adam/);
  assert.equal((await ctx.api.store.get(p)).data.contactIds.length, 2);
  const q = await ctx.api.store.add("partners", { brand: "B" });
  assert.match((await def.adminActions.linkContact(ctx, { partnerId: q, search: "ada" })).error, /Several contacts match/);
  assert.match((await def.adminActions.linkContact(ctx, { partnerId: q, search: "zzz" })).error, /No contact matches "zzz"/);
  assert.match((await def.adminActions.linkContact(ctx, { partnerId: q })).error, /Pick a contact/);
  assert.match((await def.adminActions.linkContact(ctx, { partnerId: q, contactId: "inconnu" })).error, /no longer exists/);
  assert.deepEqual(await def.adminActions.linkContact(ctx, { partnerId: "nope", contactId: c1 }), { error: "Not found." });
  assert.equal((await ctx.api.store.get(q)).data.contactIds, undefined);
});

test("créer : la personne naît dans Contacts (source partenariats) puis est liée ; même e-mail → l'existante est liée, aucun doublon ; validations", async () => {
  const { ctx, bookCtx, add } = setup();
  const p = await ctx.api.store.add("partners", { brand: "Acme" });
  const r = await def.adminActions.createContact(ctx, { partnerId: p, name: "Ada", role: "CEO", email: "Ada@X.org", organisation: "Acme" });
  assert.match(r.ok, /created in Contacts and linked/);
  const [row] = await bookCtx.api.store.list("contacts");
  assert.deepEqual([row.data.name, row.data.email, row.data.source, row.data.status], ["Ada", "ada@x.org", "partnerships", "active"]);
  assert.deepEqual((await ctx.api.store.get(p)).data.contactIds, [row.id]);
  assert.equal(await ctx.api.store.count("contacts"), 0, "Partenariats ne garde aucune personne");
  const q = await ctx.api.store.add("partners", { brand: "Globex" });
  assert.match((await def.adminActions.createContact(ctx, { partnerId: q, name: "Ada B.", email: "ada@x.org" })).ok, /already existed in Contacts/);
  assert.equal(await bookCtx.api.store.count("contacts"), 1);
  assert.deepEqual((await ctx.api.store.get(q)).data.contactIds, [row.id], "la même personne sur deux fiches");
  assert.match((await def.adminActions.createContact(ctx, { partnerId: q, name: "  " })).error, /name is required/);
  assert.match((await def.adminActions.createContact(ctx, { partnerId: q, name: "Z", email: "pas-un-mail" })).error, /not valid/);
  assert.equal(await bookCtx.api.store.count("contacts"), 1);
});

test("délier : la fiche perd la référence, la personne reste dans Contacts ; supprimer la fiche ne supprime jamais une personne", async () => {
  const { ctx, bookCtx, add } = setup();
  const c1 = await add({ name: "Ada" }), c2 = await add({ name: "Bob" });
  const p = await ctx.api.store.add("partners", { brand: "Acme", contactIds: [c1, c2] });
  assert.match((await def.adminActions.unlinkContact(ctx, { id: `${p}~${c1}` })).ok, /unlinked/);
  assert.deepEqual((await ctx.api.store.get(p)).data.contactIds, [c2]);
  assert.ok(await bookCtx.api.store.get(c1), "la personne est toujours dans le carnet");
  assert.deepEqual(await def.adminActions.unlinkContact(ctx, { id: "nope~x" }), { error: "Not found." });
  await def.adminActions.deletePartner(ctx, { id: p });
  assert.equal(await ctx.api.store.get(p), null);
  assert.equal(await bookCtx.api.store.count("contacts"), 2);
});

test("savePartner / import CSV ne touchent pas aux liens et ne laissent pas écrire contactIds depuis un formulaire", async () => {
  const { ctx } = setup();
  const p = await ctx.api.store.add("partners", { brand: "Acme", contactIds: ["c1"] });
  await def.adminActions.savePartner(ctx, { id: p, brand: "Acme 2", contactIds: "evil" });
  assert.deepEqual((await ctx.api.store.get(p)).data.contactIds, ["c1"]);
  await mod.importPartners(ctx, "brand,contactIds\nNova,evil");
  assert.equal((await ctx.api.store.list("partners")).find((x) => x.data.brand === "Nova").data.contactIds, undefined);
});

test("module Contacts ABSENT : la fiche s'affiche (liens conservés, noms indisponibles, message clair), aucune exception, plus de formulaires", async () => {
  const { ctx } = setup({ withBook: false });
  const p = await ctx.api.store.add("partners", { brand: "Acme", contactIds: ["c1", "c2"] });
  const blocks = await def.adminPanel(ctx, { query: { partner: p } });
  assert.match(panelText(blocks), /Contacts module is not available/);
  const people = find(blocks, "table").find((t) => t.columns[0] === "Name");
  assert.deepEqual(people.rows.map((r) => r[0]), ["Contact unavailable", "Contact unavailable"]);
  assert.match(panelText(blocks), /2 contact\(s\) linked to this file/);
  assert.deepEqual(find(blocks, "adminForm").map((f) => f.action), ["addJournal"]);
  await def.adminPanel(ctx, { query: {} });
  assert.match((await def.adminActions.linkContact(ctx, { partnerId: p, contactId: "c9" })).error, /Enable it/);
  assert.match((await def.adminActions.createContact(ctx, { partnerId: p, name: "Ada" })).error, /Enable it/);
  assert.deepEqual((await ctx.api.store.get(p)).data.contactIds, ["c1", "c2"], "les liens sont intacts");
});

test("module Contacts DÉSACTIVÉ en cours de route / service qui plante : même comportement, aucune exception", async () => {
  const { ctx } = setup();
  ctx.api.services.call = async () => { throw new Error("boom"); };
  ctx.api.services.available = async () => { throw new Error("boom"); };
  const p = await ctx.api.store.add("partners", { brand: "Acme", contactIds: ["c1"] });
  const blocks = await def.adminPanel(ctx, { query: { partner: p } });
  assert.match(panelText(blocks), /Contact unavailable/);
  const got = await def.mcp.partner_get(ctx, { id: p });
  assert.deepEqual([got.contactsAvailable, got.contactIds], [false, ["c1"]]);
});

test("un contact supprimé de Contacts : la ligne le dit et peut être déliée", async () => {
  const { ctx, bookCtx, add } = setup();
  const c1 = await add({ name: "Ada" });
  const p = await ctx.api.store.add("partners", { brand: "Acme", contactIds: [c1] });
  await bookCtx.api.store.remove(c1);
  const people = find(await def.adminPanel(ctx, { query: { partner: p } }), "table").find((t) => t.columns[0] === "Name");
  assert.equal(people.rows[0][0], "Deleted from the address book");
  assert.equal((await def.mcp.partner_get(ctx, { id: p })).contacts[0].missing, true);
});

test("échappement : noms piégés en texte brut dans les cellules, liens markdown neutralisés", async () => {
  const { ctx, add } = setup();
  const c1 = await add({ name: "[x](javascript:alert(1)) <img src=x onerror=1> *g*", email: "e@x.org" });
  const p = await ctx.api.store.add("partners", { brand: "<script>alert(1)</script>", contactIds: [c1] });
  const blocks = await def.adminPanel(ctx, { query: { partner: p } });
  const md = blocks.find((b) => b.type === "markdown" && /Open in Contacts/.test(b.text)).text;
  assert.ok(!/\[\[|\]\(javascript/.test(md) && md.includes("\\[x\\]\\(javascript"), md);
  assert.ok(md.includes("\\<img") && md.includes("\\*g\\*"), md);
  assert.equal(blocks.find((b) => b.type === "heading" && b.text.includes("script")).text, "<script>alert(1)</script>", "texte brut : le rendu du cœur l'échappe");
});

// ── MCP ───────────────────────────────────────────────────────────────────────
test("MCP : outils de personnes retirés (contacts_list, contact_create/update/delete), liens ajoutés ; manifeste = code", () => {
  const names = manifest.mcp.map((t) => t.name);
  for (const gone of ["contacts_list", "contact_create", "contact_update", "contact_delete"]) { assert.ok(!names.includes(gone), gone); assert.equal(def.mcp[gone], undefined, gone); }
  assert.deepEqual(names, ["partners_list", "partner_get", "partner_create", "partner_update", "partner_log", "partner_link_contact", "partner_unlink_contact", "partner_delete"]);
  assert.deepEqual(Object.keys(def.mcp).sort(), [...names].sort());
});

test("MCP : lier / délier = écritures non destructives (réversibles, ne touchent pas aux personnes)  ; descriptions qui orientent l'assistant", () => {
  const by = Object.fromEntries(manifest.mcp.map((t) => [t.name, t]));
  for (const n of ["partner_link_contact", "partner_unlink_contact"]) { assert.equal(by[n].default, false, n); assert.ok(!by[n].destructive && !by[n].readOnly, n); assert.deepEqual(by[n].input.required, ["id", "contact_id"]); }
  assert.match(by.partner_link_contact.description, /Contacts/);
  assert.match(by.partner_unlink_contact.description, /NOT deleted/);
  assert.match(by.partner_get.description, /contact_get/);
  assert.match(by.partner_create.description, /contact_create/);
  assert.match(by.partner_delete.description, /NOT deleted/);
  assert.equal(by.partner_delete.default, false);
  for (const t of manifest.mcp) assert.ok(t.description.length > 60 && t.description.length < 1000, t.name);
});

test("MCP partner_link_contact : lie (idempotent), personne inconnue / Contacts absent / fiche inconnue → erreurs exposées", async () => {
  const { ctx, add } = setup();
  const c1 = await add({ name: "Ada", role: "CEO", email: "ada@x.org", phone: "123" });
  const p = await ctx.api.store.add("partners", { brand: "Acme" });
  const r = await def.mcp.partner_link_contact(ctx, { id: p, contact_id: c1 }, actor);
  assert.deepEqual(r, { id: p, linked: true, contact: { id: c1, name: "Ada", role: "CEO", email: "ada@x.org" }, contactIds: [c1] });
  assert.equal((await def.mcp.partner_link_contact(ctx, { id: p, contact_id: c1 }, actor)).linked, false);
  assert.deepEqual((await ctx.api.store.get(p)).data.contactIds, [c1]);
  await assert.rejects(def.mcp.partner_link_contact(ctx, { id: p, contact_id: "nope" }, actor), (e) => e.expose && /not found in the Contacts module/.test(e.message));
  await assert.rejects(def.mcp.partner_link_contact(ctx, { id: "nope", contact_id: c1 }, actor), (e) => e.expose && /partnership not found/.test(e.message));
  const off = setup({ withBook: false }).ctx;
  const q = await off.api.store.add("partners", { brand: "B" });
  await assert.rejects(def.mcp.partner_link_contact(off, { id: q, contact_id: c1 }, actor), (e) => e.expose && /not available/.test(e.message));
  assert.equal((await off.api.store.get(q)).data.contactIds, undefined);
});

test("MCP partner_unlink_contact : délie sans supprimer la personne ; déjà délié → unlinked:false", async () => {
  const { ctx, bookCtx, add } = setup();
  const c1 = await add({ name: "Ada" });
  const p = await ctx.api.store.add("partners", { brand: "Acme", contactIds: [c1] });
  assert.deepEqual(await def.mcp.partner_unlink_contact(ctx, { id: p, contact_id: c1 }, actor), { id: p, unlinked: true, contactIds: [] });
  assert.equal((await def.mcp.partner_unlink_contact(ctx, { id: p, contact_id: c1 }, actor)).unlinked, false);
  assert.ok(await bookCtx.api.store.get(c1));
  await assert.rejects(def.mcp.partner_unlink_contact(ctx, { id: "nope", contact_id: c1 }, actor), (e) => e.expose);
});

test("MCP partner_get : renvoie les contacts liés (id, nom, fonction, e-mail) et rien de plus ; au plus 50 liens", async () => {
  const { ctx, add } = setup();
  const c1 = await add({ name: "Ada", role: "CEO", email: "ada@x.org", phone: "123", others: "secret" });
  const p = await ctx.api.store.add("partners", { brand: "Acme", contactIds: [c1] });
  const r = await def.mcp.partner_get(ctx, { id: p });
  assert.deepEqual(r.contacts, [{ id: c1, name: "Ada", role: "CEO", email: "ada@x.org" }]);
  assert.deepEqual([r.contactsAvailable, r.contactIds], [true, [c1]]);
  assert.ok(!JSON.stringify(r).includes("secret") && !JSON.stringify(r).includes("123"));
  for (let i = 0; i < 49; i++) await def.mcp.partner_link_contact(ctx, { id: p, contact_id: await add({ name: `P${i}` }) }, actor);
  await assert.rejects(def.mcp.partner_link_contact(ctx, { id: p, contact_id: await add({ name: "de trop" }) }, actor), (e) => /too many/.test(e.message));
});

test("MCP partners_list : la recherche ne cherche pas dans les identifiants de contacts", async () => {
  const { ctx } = setup();
  await ctx.api.store.add("partners", { brand: "Acme", contactIds: ["zzzid"] });
  assert.deepEqual(await def.mcp.partners_list(ctx, { q: "zzzid" }), []);
});
