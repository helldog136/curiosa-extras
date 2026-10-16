// Partenariats ↔ Contacts : fiches qui ne font que RÉFÉRENCER des personnes, outils MCP, module Contacts absent, et fusion de l'ancien carnet.
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
  assert.equal(r.manifest.offers, undefined, "Partenariats n'offre rien : il ne possède que ses fiches");
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
  await def.adminPanel(ctx, { query: { merge: "1" } });
  assert.match((await def.adminActions.linkContact(ctx, { partnerId: p, contactId: "c9" })).error, /Enable it/);
  assert.match((await def.adminActions.createContact(ctx, { partnerId: p, name: "Ada" })).error, /Enable it/);
  assert.match((await def.adminActions.mergeRun(ctx, {})).error, /Nothing to merge|not available|No partnership contact/);
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

// ── Fusion de l'ancien carnet ───────────────────────────────────────────────────
/** La situation du propriétaire, en FACTICE : 46 fiches ; 7 contacts dans Contacts ; des contacts de partenariats dont 5 recopiés dans Contacts. */
async function owner() {
  const s = setup();
  const { ctx, bookCtx } = s;
  const partners = [];
  for (let i = 1; i <= 46; i++) partners.push(await ctx.api.store.add("partners", { brand: `Marque ${i}`, status: "envoye" }));
  const existing = [];
  for (let i = 1; i <= 7; i++) existing.push((await book.create(bookCtx, { name: `Personne ${i}`, email: `personne${i}@exemple.test`, organisation: `Marque ${i}` })).id);
  const legacy = {};
  const L = async (key, partner, data) => { legacy[key] = await ctx.api.store.add("contacts", { partnerId: partners[partner], status: "active", ...data }); };
  for (let i = 1; i <= 5; i++) await L(`dup${i}`, i - 1, { name: `Personne ${i}`, email: i % 2 ? `PERSONNE${i}@exemple.test` : `personne${i}@exemple.test`, role: "Responsable", phone: `01 00 00 00 0${i}`, notes: `note ${i}` });
  for (let i = 1; i <= 10; i++) await L(`new${i}`, 10 + i, { name: `Nouveau ${i}`, email: `nouveau${i}@exemple.test`, role: "Chargé", organization: `Marque ${10 + i + 1}`, notes: i === 1 ? "à rappeler" : "" });
  await L("twin", 30, { name: "Nouveau 1", email: "NOUVEAU1@exemple.test" });                   // même personne sur une deuxième fiche
  await L("sameEmailOtherName", 31, { name: "Quelqu'un d'autre", email: "personne6@exemple.test" }); // ambigu
  await L("sameNameOtherOrg", 32, { name: "Personne 7", organisation: "Autre société" });          // ambigu
  await L("noName", 33, { name: "", email: "x@exemple.test" });                                    // ambigu
  await L("noEmailNew", 34, { name: "Sans Mail", status: "to_review", relation: "rencontré en salon" });
  return { ...s, partners, existing, legacy };
}
const snapshot = async (c) => JSON.stringify(Object.fromEntries(await Promise.all(["partners", "contacts", "legacyContacts", "meta", "journal"].map(async (k) => [k, (await c.api.store.list(k, { limit: 5000 })).map((r) => [r.id, r.data])]))));

test("fusion — aperçu exact : 19 anciens contacts → 5 liés, 11 créés, 1 déjà compté, 3 ambigus ; AUCUNE modification", async () => {
  const { ctx, bookCtx } = await owner();
  const before = [await snapshot(ctx), await snapshot(bookCtx)];
  const blocks = await def.adminPanel(ctx, { query: { merge: "1" } });
  const preview = find(blocks, "table")[0];
  const count = (label) => Number(preview.rows.find((r) => r[0].startsWith(label))[1]);
  assert.deepEqual([count("Partnership contacts to process"), count("Already in Contacts"), count("New:"), count("Already counted"), count("Ambiguous")], [20, 5, 11, 1, 3]);
  const amb = find(blocks, "table")[1];
  assert.equal(amb.rows.length, 3);
  assert.deepEqual(amb.rows.map((r) => r[2]).sort(), ["Missing name.", "Same email as an existing contact, but another name.", "Same name as an existing contact, with another organisation."].sort());
  assert.ok(amb.rows.every((r) => /^Marque \d+$/.test(r[1])), "la fiche concernée est nommée");
  const run = find(blocks, "table").at(-1);
  assert.deepEqual(run.rowActions.map((a) => [a.action, !!a.confirm]), [["mergeRun", true]], "bouton avec confirmation (askConfirm côté cœur)");
  assert.match(run.rowActions[0].confirm, /5 contact\(s\) will be linked.*11 will be created.*3 ambiguous/s);
  assert.deepEqual([await snapshot(ctx), await snapshot(bookCtx)], before, "l'aperçu ne modifie rien");
});

test("fusion — avant : bandeau « Fusionnez vos contacts » et anciens contacts affichés en lecture ; aucun nouveau contact tant que la fusion n'est pas faite", async () => {
  const { ctx, partners } = await owner();
  const overview = await def.adminPanel(ctx, { query: {} });
  assert.match(overview.find((b) => b.type === "markdown" && /Merge your contacts/.test(b.text)).text, /20 partnership contacts.*\(\?merge=1\)/);
  const fiche = await def.adminPanel(ctx, { query: { partner: partners[0] } });
  assert.match(panelText(fiche), /Merge your contacts/);
  const old = find(fiche, "table").find((t) => t.columns[0] === "Name" && t.rowActions === undefined);
  assert.deepEqual(old.rows[0].slice(0, 2), ["Personne 1", "Responsable"]);
  assert.match(panelText(fiche), /Old contacts \(not merged yet\)/);
  const g = await def.mcp.partner_get(ctx, { id: partners[0] });
  assert.equal(g.unmergedContacts[0].name, "Personne 1", "l'assistant voit aussi les anciens contacts");
});

test("fusion — exécution : aucune perte, copie legacyContacts identique, liens posés, pas de doublon dans Contacts", async () => {
  const { ctx, bookCtx, partners } = await owner();
  const originals = new Map((await ctx.api.store.list("contacts", { limit: 5000 })).map((r) => [r.id, r.data]));
  const r = await def.adminActions.mergeRun(ctx, {});
  assert.match(r.ok, /5 contact\(s\) linked to people already present, 11 new person\(s\) created in Contacts, 1 linked to a person already counted, 3 to check by hand, 0 failure\(s\)/);
  assert.equal(r.redirect, "?merge=1");
  // Contacts : 7 + 11 nouvelles personnes (Nouveau 1..10 + Sans Mail), pas une de plus
  assert.equal(await bookCtx.api.store.count("contacts"), 18);
  const cards = (await book.find(bookCtx, { limit: 100 })).contacts;
  const emails = cards.map((c) => c.email).filter(Boolean);
  assert.equal(new Set(emails).size, emails.length, "aucun e-mail en double");
  // ancienne collection conservée, intacte, sous un autre nom
  assert.equal(await ctx.api.store.count("contacts"), 0);
  const kept = await ctx.api.store.list("legacyContacts", { limit: 5000 });
  assert.equal(kept.length, 20);
  for (const k of kept) { const { _legacyId, _createdAt, ...data } = k.data; assert.deepEqual(data, originals.get(_legacyId), "copie identique à l'original"); assert.ok(_createdAt); }
  // liens : chaque fiche pointe vers la bonne personne
  const first = (await ctx.api.store.get(partners[0])).data.contactIds;
  assert.equal(first.length, 1);
  assert.equal((await bookCtx.api.store.get(first[0])).data.email, "personne1@exemple.test", "lié à la personne EXISTANTE (e-mail insensible à la casse)");
  const twinLink = (await ctx.api.store.get(partners[30])).data.contactIds, newLink = (await ctx.api.store.get(partners[11])).data.contactIds;
  assert.deepEqual(twinLink, newLink, "la même personne sur deux fiches = une seule fiche Contacts");
  for (const i of [31, 32, 33]) assert.equal((await ctx.api.store.get(partners[i])).data.contactIds, undefined, "ambigu : rien lié");
  // les créés gardent le détail (statut à vérifier, relation, note de provenance et notes)
  const sans = cards.find((c) => c.name === "Sans Mail");
  assert.equal(sans.status, "to_review");
  const full = (await book.get(bookCtx, { id: sans.id })).contact;
  assert.equal(full.relation, "rencontré en salon");
  assert.match(full.notes[0].text, /Taken over from partnership tracking \(file: Marque 35\)/);
  const n1 = cards.find((c) => c.name === "Nouveau 1");
  assert.match((await book.get(bookCtx, { id: n1.id })).contact.notes[0].text, /à rappeler/);
  assert.equal(n1.organisation, "Marque 12", "l'organisation de l'ancien contact (champ organization) est reprise");
  // les existants reçoivent une NOTE (téléphone, fonction…), leurs champs ne sont pas modifiés
  const p1 = (await book.get(bookCtx, { id: first[0] })).contact;
  assert.equal(p1.phone, null);
  assert.match(p1.notes[0].text, /01 00 00 00 01/);
  // fiche : plus d'ancien contact affiché (sauf ambigus), plus de bandeau « Fusionnez » mais « à vérifier à la main »
  const overview = await def.adminPanel(ctx, { query: {} });
  assert.ok(!/Merge your contacts/.test(panelText(overview)));
  assert.match(panelText(overview), /Contacts to check by hand.*3 old contact/s);
  assert.ok(!/Old contacts \(not merged yet\)/.test(panelText(await def.adminPanel(ctx, { query: { partner: partners[0] } }))));
  assert.match(panelText(await def.adminPanel(ctx, { query: { partner: partners[31] } })), /Old contacts to match by hand/);
});

test("fusion — idempotente : relancer ne crée aucun doublon, ne reperd rien, ne recopie pas l'archive", async () => {
  const { ctx, bookCtx, partners } = await owner();
  await def.adminActions.mergeRun(ctx, {});
  const after = [await snapshot(ctx), await snapshot(bookCtx)];
  const r = await def.adminActions.mergeRun(ctx, {});
  assert.match(r.ok, /0 contact\(s\) linked.*0 new person\(s\).*3 to check by hand/);
  assert.equal(await bookCtx.api.store.count("contacts"), 18);
  assert.equal(await ctx.api.store.count("legacyContacts"), 20);
  assert.equal(await ctx.api.store.count("meta"), 1);
  const strip = (s) => JSON.parse(s);
  assert.deepEqual(strip((await snapshot(bookCtx))), strip(after[1]), "Contacts inchangé");
  assert.deepEqual(strip(await snapshot(ctx)).partners, strip(after[0]).partners, "fiches inchangées");
  void partners;
});

test("fusion — fusion partielle reprise plus tard : un module Contacts qui revient, deux lancements successifs", async () => {
  const { ctx, bookCtx } = await owner();
  const services = ctx.api.services.call;
  ctx.api.services.call = async () => ({ ok: false, reason: "unavailable" });
  ctx.api.services.available = async () => false;
  const before = await snapshot(ctx);
  assert.match((await def.adminActions.mergeRun(ctx, {})).error, /not available/);
  assert.equal(await snapshot(ctx), before, "Contacts absent : rien n'a été modifié, pas même la copie");
  ctx.api.services.call = services; ctx.api.services.available = async () => true;
  assert.equal((await def.adminActions.mergeRun(ctx, {})).ok.includes("11 new"), true);
  assert.equal(await bookCtx.api.store.count("contacts"), 18);
});

test("fusion — cas ambigus : résolus à la main (lier à l'existant, ou laisser de côté), jamais fusionnés tout seuls", async () => {
  const { ctx, bookCtx, existing, partners, legacy } = await owner();
  await def.adminActions.mergeRun(ctx, {});
  const page = find(await def.adminPanel(ctx, { query: { merge: "1" } }), "table");
  const single = page.find((t) => t.rowActions?.some((a) => a.action === "mergeResolve"));
  assert.equal(single.rows.length, 2, "e-mail identique + même nom/autre organisation : un seul candidat chacun");
  const legacyIdOf = async (key) => (await ctx.api.store.list("legacyContacts", { limit: 5000 })).find((r) => r.data._legacyId === legacy[key]).data._legacyId;
  const emailCase = `${await legacyIdOf("sameEmailOtherName")}~${existing[5]}`;
  assert.ok(single.rowIds.includes(emailCase));
  assert.match((await def.adminActions.mergeResolve(ctx, { id: emailCase })).ok, /Saved/);
  assert.deepEqual((await ctx.api.store.get(partners[31])).data.contactIds, [existing[5]]);
  assert.match((await def.adminActions.mergeDismiss(ctx, { id: await legacyIdOf("noName") })).ok, /Saved/);
  const left = await def.adminPanel(ctx, { query: { merge: "1" } });
  assert.match(panelText(left), /Ambiguous contacts \(1\)/);
  assert.deepEqual((await def.adminActions.mergeResolve(ctx, { id: "nope~nope" })), { error: "Not found." });
  assert.equal(await bookCtx.api.store.count("contacts"), 18, "rien créé par la résolution");
  // la copie conservée n'a jamais été touchée
  assert.equal(await ctx.api.store.count("legacyContacts"), 20);
});

test("fusion — annuler : les liens posés par la fusion disparaissent, l'ancien carnet revient identique, Contacts ne perd personne ; refaire la fusion ne duplique rien", async () => {
  const { ctx, bookCtx, partners } = await owner();
  const originals = (await ctx.api.store.list("contacts", { limit: 5000 })).map((r) => JSON.stringify(r.data)).sort();
  await ctx.api.store.update(partners[0], { brand: "Marque 1", status: "envoye", contactIds: ["lien-manuel"] });
  await def.adminActions.mergeRun(ctx, {});
  assert.deepEqual((await ctx.api.store.get(partners[0])).data.contactIds.length, 2);
  const undo = await def.adminActions.mergeUndo(ctx, {});
  assert.match(undo.ok, /Merge undone/);
  assert.deepEqual((await ctx.api.store.get(partners[0])).data.contactIds, ["lien-manuel"], "un lien posé à la main reste");
  assert.deepEqual((await ctx.api.store.list("contacts", { limit: 5000 })).map((r) => JSON.stringify(r.data)).sort(), originals);
  assert.equal(await ctx.api.store.count("legacyContacts"), 0);
  assert.equal(await ctx.api.store.count("meta"), 0);
  assert.equal(await bookCtx.api.store.count("contacts"), 18, "les personnes créées restent dans Contacts");
  assert.match(panelText(await def.adminPanel(ctx, { query: {} })), /Merge your contacts/);
  await def.adminActions.mergeRun(ctx, {});
  assert.equal(await bookCtx.api.store.count("contacts"), 18, "refaire la fusion : aucun doublon (dédoublonnage)");
  assert.deepEqual(await def.adminActions.mergeUndo(setup().ctx, {}), { error: "Not found." });
});

test("fusion — sauvegarde lisible : legacy-contacts.csv (avant et après), vide si rien", async () => {
  const empty = await def.backup.readable(setup().ctx);
  assert.deepEqual(empty, []);
  const { ctx } = await owner();
  const [before] = await def.backup.readable(ctx);
  assert.equal(before.path, "legacy-contacts.csv");
  assert.equal(before.content.trim().split("\r\n").length, 21);
  await def.adminActions.mergeRun(ctx, {});
  const [after] = await def.backup.readable(ctx);
  assert.equal(after.content.trim().split("\r\n").length, 21, "toujours dans la sauvegarde après la fusion");
  assert.match(after.content, /Marque 1"/);
});

test("fusion — cellules CSV : une formule n'est pas exécutable", async () => {
  const { ctx } = setup();
  const p = await ctx.api.store.add("partners", { brand: "A" });
  await ctx.api.store.add("contacts", { partnerId: p, name: "=HYPERLINK(\"x\")", email: "" });
  assert.match((await def.backup.readable(ctx))[0].content, /"'=HYPERLINK/);
});

test("fusion — cas limites : fiche supprimée (contact orphelin) créé sans lien ; e-mail invalide conservé dans la note ; page de fusion sans ancien contact", async () => {
  const { ctx, bookCtx } = setup();
  assert.match(panelText(await def.adminPanel(ctx, { query: { merge: "1" } })), /No partnership contact to merge/);
  await ctx.api.store.add("contacts", { partnerId: "fiche-supprimee", name: "Orphelin", email: "pas-un-mail", status: "active" });
  const r = await def.adminActions.mergeRun(ctx, {});
  assert.match(r.ok, /1 new person\(s\)/);
  const [c] = (await book.find(bookCtx, {})).contacts;
  assert.deepEqual([c.name, c.email], ["Orphelin", null]);
  assert.match((await book.get(bookCtx, { id: c.id })).contact.notes[0].text, /pas-un-mail/);
  assert.match(panelText(await def.adminPanel(ctx, { query: { merge: "1" } })), /All your contacts are in the Contacts module/);
});

test("fusion — le panneau en français : bandeau, aperçu et bouton lisibles par le propriétaire", async () => {
  const { ctx, bookCtx } = await owner();
  const fr = fakeCtx({ key: "partnerships", locale: "fr", messages: readJson(`${PDIR}/locales/fr.json`), services: { "contact.book": Object.fromEntries(Object.keys(book).map((m) => [m, (args) => book[m](bookCtx, args)])) } });
  for (const r of await ctx.api.store.list("partners", { limit: 100 })) await fr.api.store.add("partners", r.data);
  for (const r of await ctx.api.store.list("contacts", { limit: 100 })) await fr.api.store.add("contacts", r.data);
  const text = panelText(await def.adminPanel(fr, { query: { merge: "1" } }));
  for (const s of ["Fusionner mes contacts avec le module Contacts", "Aperçu", "Ambigus", "Déjà dans Contacts : seraient simplement liés", "Nouveaux : seraient créés dans Contacts"]) assert.ok(text.includes(s), s);
  assert.match(panelText(await def.adminPanel(fr, { query: {} })), /Fusionnez vos contacts/);
});
