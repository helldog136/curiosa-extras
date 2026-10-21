// Partenariats 2.0 : « privacy.subject » (export / erase / remap de ses liens vers une fiche Contacts), fiches supprimées (« missing ») et fusionnées (« moved »),
// contre le double « fakeContactBook » et la suite de contrat commune. Toutes les données sont factices.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeContactBook, privacyReplyProblems } from "./helpers/fakeContactBook.mjs";
import { runPrivacySubjectContract } from "./contract/privacySubject.contract.mjs";

const PDIR = new URL("../modules/partnerships", import.meta.url).pathname;
const en = JSON.parse(fs.readFileSync(`${PDIR}/locales/en.json`, "utf8"));
const def = (await import("../modules/partnerships/index.mjs")).default;
const svc = def.services["privacy.subject"];

const newCtx = (services = {}) => fakeCtx({ key: "partnerships", locale: "en", messages: en, services });
const holdersOf = async (ctx, id) => (await ctx.api.store.list("partners", { limit: 1000 })).filter((p) => (p.data.contactIds ?? []).includes(id)).length;

// ── La suite de contrat commune, contre le vrai service ────────────────────────────────────────────────────────────────────
runPrivacySubjectContract(async () => {
  const ctx = newCtx();
  return {
    methods: Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](ctx, args)])),
    addReference: async (contactId) => { await ctx.api.store.add("partners", { brand: `Marque ${contactId}`, contactIds: [contactId, "autre-fiche"] }); },
    countReferences: (contactId) => holdersOf(ctx, contactId),
  };
}, { test, prefix: "Partenariats privacy.subject" });

test("manifeste = code : le service est offert (une réponse par instance), export en lecture seule", () => {
  const manifest = JSON.parse(fs.readFileSync(`${PDIR}/module.json`, "utf8"));
  assert.deepEqual(Object.keys(svc).sort(), ["erase", "export", "remap"]);
  const offer = manifest.offers.find((o) => o.service === "privacy.subject");
  assert.deepEqual([offer.each, offer.readOnly], [true, ["export"]]);
});

test("export : les fiches partenaires liées à la personne, libellé lisible, JSON petit, rien d'autre (ni journal, ni brouillon)", async () => {
  const ctx = newCtx();
  const a = await ctx.api.store.add("partners", { brand: "Acme", status: "discussion", contactIds: ["c1", "c2"], mail: "brouillon secret", brief: "privé" });
  await ctx.api.store.add("partners", { brand: "Autre", contactIds: ["c2"] });
  await ctx.api.store.add("journal", { partnerId: a, text: "texte privé", date: "2026-01-01" });
  const x = await svc.export(ctx, { contactId: "c1" });
  assert.deepEqual(privacyReplyProblems("export", x), []);
  assert.equal(x.label, "Partnerships");
  assert.deepEqual(x.data, { count: 1, partnerships: [{ id: a, brand: "Acme", status: "discussion" }] });
  assert.ok(!/secret|privé/.test(JSON.stringify(x)));
  assert.equal((await svc.export(ctx, { contactId: "c2" })).data.count, 2);
  assert.equal((await svc.export(ctx, { contactId: "inconnue" })).data.count, 0);
  const big = newCtx();
  for (let i = 0; i < 700; i++) await big.api.store.add("partners", { brand: "M".repeat(120), contactIds: ["gros"] });
  const y = await svc.export(big, { contactId: "gros" });
  assert.equal(y.data.count, 700);
  assert.deepEqual(privacyReplyProblems("export", y), [], "reste sous 1 Mo");
});

test("erase : retire le lien de toutes les fiches, garde les fiches, leur journal et les autres liens ; rejouer ne retire rien", async () => {
  const ctx = newCtx();
  const a = await ctx.api.store.add("partners", { brand: "A", contactIds: ["c1", "c2"] });
  const b = await ctx.api.store.add("partners", { brand: "B", contactIds: ["c1"] });
  await ctx.api.store.add("journal", { partnerId: a, text: "x", date: "2026-01-01" });
  assert.deepEqual(await svc.erase(ctx, { contactId: "c1" }), { removed: 2 });
  assert.deepEqual([(await ctx.api.store.get(a)).data.contactIds, (await ctx.api.store.get(b)).data.contactIds], [["c2"], []]);
  assert.equal(await ctx.api.store.count("journal"), 1);
  assert.equal((await ctx.api.store.get(a)).data.brand, "A");
  assert.deepEqual(await svc.erase(ctx, { contactId: "c1" }), { removed: 0 });
});

test("remap : redirige sans doublon (la cible déjà liée n'est pas ajoutée deux fois), garde l'ordre, rejouable", async () => {
  const ctx = newCtx();
  const a = await ctx.api.store.add("partners", { brand: "A", contactIds: ["x", "old", "y"] });
  const b = await ctx.api.store.add("partners", { brand: "B", contactIds: ["old", "new"] });
  const c = await ctx.api.store.add("partners", { brand: "C", contactIds: ["z"] });
  assert.deepEqual(await svc.remap(ctx, { from: "old", to: "new" }), { updated: 2 });
  assert.deepEqual((await ctx.api.store.get(a)).data.contactIds, ["x", "new", "y"]);
  assert.deepEqual((await ctx.api.store.get(b)).data.contactIds, ["new"]);
  assert.deepEqual((await ctx.api.store.get(c)).data.contactIds, ["z"]);
  assert.deepEqual(await svc.remap(ctx, { from: "old", to: "new" }), { updated: 0 });
});

test("branché sur le carnet : la fusion de deux fiches redirige les liens (remap), l'effacement les retire (erase), les autres modules muets sont listés", async () => {
  const book = fakeContactBook();
  const ctx = newCtx(book.services);
  const keep = book.seedContact({ name: "Ada", email: "ada@x.org" }).id;
  const drop = book.seedContact({ name: "Ada L.", email: "ada2@x.org" }).id;
  const p = await ctx.api.store.add("partners", { brand: "Acme", contactIds: [drop] });
  const q = await ctx.api.store.add("partners", { brand: "Beta", contactIds: [keep, drop] });
  book.addPrivacySubject({ instance: "partnerships", name: "Partenariats", methods: Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](ctx, args)])) });
  const merged = await book.methods.merge({ keep, drop });
  assert.equal(merged.ok, true);
  assert.deepEqual(merged.remapped, [{ module: "partnerships", ok: true }]);
  assert.deepEqual([(await ctx.api.store.get(p)).data.contactIds, (await ctx.api.store.get(q)).data.contactIds], [[keep], [keep]]);
  const erased = await book.methods.erase({ id: keep, confirm: true });
  assert.deepEqual(erased.modules, [{ module: "partnerships", ok: true, removed: 2 }]);
  assert.deepEqual([(await ctx.api.store.get(p)).data.contactIds, (await ctx.api.store.get(q)).data.contactIds], [[], []]);
});

test("« missing » : une fiche supprimée de Contacts est dite telle (admin et MCP), peut être déliée ; rien ne plante", async () => {
  const book = fakeContactBook();
  const ctx = newCtx(book.services);
  const ada = book.seedContact({ name: "Ada", email: "ada@x.org" }).id;
  const bob = book.seedContact({ name: "Bob", email: "bob@x.org" }).id;
  const p = await ctx.api.store.add("partners", { brand: "Acme", contactIds: [ada, bob] });
  book.admin.deleteContact(bob);
  const got = await def.mcp.partner_get(ctx, { id: p });
  assert.deepEqual(got.contacts.map((c) => [c.id, c.name, !!c.missing]), [[ada, "Ada", false], [bob, null, true]]);
  const table = (await def.adminPanel(ctx, { query: { partner: p } })).find((b) => b.type === "table" && b.columns[0] === "Name");
  assert.deepEqual(table.rows.map((r) => r[0]), ["Ada", "Deleted from the address book"]);
  assert.deepEqual(table.rowIds, [`${p}~${ada}`, `${p}~${bob}`]);
  assert.match((await def.adminActions.unlinkContact(ctx, { id: `${p}~${bob}` })).ok, /./);
  assert.deepEqual((await ctx.api.store.get(p)).data.contactIds, [ada]);
});

test("« moved » : sans remap reçu, une fiche fusionnée est suivie (affichage juste) et le lien se corrige tout seul", async () => {
  const book = fakeContactBook();
  const ctx = newCtx(book.services);
  const keep = book.seedContact({ name: "Ada", email: "ada@x.org" }).id;
  const drop = book.seedContact({ name: "Ada L.", email: "ada2@x.org" }).id;
  const p = await ctx.api.store.add("partners", { brand: "Acme", contactIds: [drop, keep] });
  await book.methods.merge({ keep, drop }); // aucun fournisseur privacy.subject branché : le lien est resté sur l'ancien identifiant
  assert.deepEqual((await ctx.api.store.get(p)).data.contactIds, [drop, keep]);
  const got = await def.mcp.partner_get(ctx, { id: p });
  assert.deepEqual(got.contacts.map((c) => [c.id, c.name]), [[keep, "Ada"]], "une seule personne, la fiche gardée");
  assert.deepEqual(got.contactIds, [keep]);
  assert.deepEqual((await ctx.api.store.get(p)).data.contactIds, [keep]);
  const q = await ctx.api.store.add("partners", { brand: "Beta", contactIds: [drop] });
  const table = (await def.adminPanel(ctx, { query: { partner: q } })).find((b) => b.type === "table" && b.columns[0] === "Name");
  assert.deepEqual(table.rows.map((r) => r[0]), ["Ada"]);
  assert.deepEqual((await ctx.api.store.get(q)).data.contactIds, [keep]);
});

test("Contacts muet : la fiche s'affiche quand même (liens conservés), attente bornée", async () => {
  const book = fakeContactBook();
  const ctx = newCtx(book.services);
  const p = await ctx.api.store.add("partners", { brand: "Acme", contactIds: ["c1"] });
  const link = await import("../modules/partnerships/contacts-link.mjs");
  const saved = link.timing.callMs;
  link.timing.callMs = 40;
  try {
    book.faults.hang.add("resolve");
    const t0 = Date.now();
    const got = await def.mcp.partner_get(ctx, { id: p });
    assert.ok(Date.now() - t0 < 3000);
    assert.deepEqual([got.contactsAvailable, got.contactIds], [false, ["c1"]]);
    assert.deepEqual((await ctx.api.store.get(p)).data.contactIds, ["c1"], "les liens sont intacts");
  } finally { link.timing.callMs = saved; }
});
