// Extension « contact.curate » v1 (tests/contract-ext/README.md) : la même suite contre le double ET contre le vrai module Contacts 2.2,
// et le manifeste de Contacts (service offert, lectures en readOnly, createCategory ouvert à l'appelant). Le contrat « contact.book » v2 n'est pas touché.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { memStore } from "./helpers/contactsStore.mjs";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { fakeContactCurate, CURATE_METHODS as FAKE_METHODS, CURATE_READ_ONLY as FAKE_READ_ONLY } from "./helpers/fakeContactCurate.mjs";
import { runContactCurateContract, CURATE_METHODS, CURATE_READ_ONLY } from "./contract-ext/contactCurate.contract.mjs";

const def = (await import("../modules/contacts/index.mjs")).default;
const B = await import("../modules/contacts/book.mjs");

runContactCurateContract(() => {
  const book = fakeContactBook({ rights: ["categories.create"] });
  const curate = fakeContactCurate(book);
  return { book: book.methods, curate: curate.methods, admin: { mergeCategories: (k, d) => book.admin.mergeCategories(k, d), deleteCategory: (id) => book.admin.deleteCategory(id) } };
}, { prefix: "double contact.curate v1" });

let n = 0;
runContactCurateContract(() => {
  const ctx = fakeCtx({ moduleId: "contacts", key: `contacts-curate-${++n}`, messages: { formNote: "Message" } });
  ctx.api.store = memStore();
  ctx.can = (r) => r === "categories.create";
  const bookSvc = def.services["contact.book"], curateSvc = def.services["contact.curate"];
  return {
    book: Object.fromEntries(Object.keys(bookSvc).map((m) => [m, (args) => bookSvc[m](ctx, args)])),
    curate: Object.fromEntries(Object.keys(curateSvc).map((m) => [m, (args) => curateSvc[m](ctx, args)])),
    admin: { mergeCategories: (k, d) => B.mergeCategories(ctx, k, d), deleteCategory: (id) => B.deleteCategory(ctx, id) },
  };
}, { prefix: "Contacts 2.2 contact.curate v1" });

test("le double et la suite parlent des mêmes méthodes ; le vrai module les offre toutes", () => {
  assert.deepEqual(FAKE_METHODS, CURATE_METHODS);
  assert.deepEqual(FAKE_READ_ONLY, CURATE_READ_ONLY);
  assert.deepEqual(Object.keys(def.services["contact.curate"]).sort(), [...CURATE_METHODS].sort());
});

test("manifeste de Contacts : contact.curate v1 offert (lectures en readOnly), contact.book v2 intact, createCategory ouvert à l'appelant (callerRights)", async () => {
  const { loadModule } = await import("./helpers/moduleLoader.mjs");
  const { manifest } = await loadModule("modules/contacts");
  const curate = manifest.offers.find((o) => o.service === "contact.curate");
  assert.equal(curate.version, 1);
  assert.deepEqual([...curate.readOnly].sort(), [...CURATE_READ_ONLY].sort());
  const book = manifest.offers.find((o) => o.service === "contact.book");
  assert.equal(book.version, 2);
  assert.deepEqual(book.callerRights, ["createCategory"], "seule l'écriture voulue accepte les droits de l'appelant");
  assert.ok(manifest.rights.some((r) => r.id === "categories.create"));
});

test("Contacts : un module qui n'a pas le droit ne crée toujours pas de catégorie (les droits viennent du cœur, jamais du service)", async () => {
  const ctx = fakeCtx({ moduleId: "contacts", key: "contacts-nocan", messages: { formNote: "Message" } });
  ctx.api.store = memStore();
  assert.deepEqual(await def.services["contact.book"].createCategory(ctx, { label: "Cible de raid" }), { ok: false, error: "denied" });
  ctx.can = (r) => r === "categories.create";
  assert.equal((await def.services["contact.book"].createCategory(ctx, { label: "Cible de raid" })).ok, true);
});

test("Contacts : 10 000 comptes, lookupAccounts de 200 pseudos et searchAccounts restent rapides (index seulement)", async () => {
  const ctx = fakeCtx({ moduleId: "contacts", key: "contacts-curate-volume", messages: { formNote: "Message" } });
  ctx.api.store = memStore();
  ctx.can = () => true;
  const book = def.services["contact.book"], curate = def.services["contact.curate"];
  const c = (await book.createCategory(ctx, { label: "Gros" })).id;
  const rows = Array.from({ length: 1000 }, (_, i) => ({ name: `Personne ${i}`, accounts: [{ network: "twitch", handle: `chaine_${String(i).padStart(5, "0")}` }], categoryIds: i % 2 ? [c] : [] }));
  for (let k = 0; k < 10; k++) assert.equal((await book.import(ctx, { rows: rows.map((r, i) => ({ ...r, name: `${r.name} ${k}`, accounts: [{ network: "twitch", handle: `chaine_${String(k * 1000 + i).padStart(5, "0")}` }] })) })).ok, true);
  const t0 = performance.now();
  const handles = Array.from({ length: 200 }, (_, i) => `chaine_${String(i * 25).padStart(5, "0")}`);
  const r = await curate.lookupAccounts(ctx, { network: "twitch", handles, categoryId: c });
  assert.equal(r.items.filter((x) => x.id).length, 200);
  assert.equal(r.items.filter((x) => x.inCategory).length, 100);
  const s = await curate.searchAccounts(ctx, { network: "twitch", q: "chaine_0123", categoryId: c, limit: 50 });
  assert.ok(s.items.length >= 1 && s.items.every((x) => x.handle.startsWith("chaine_0123")));
  assert.ok(performance.now() - t0 < 5000, `trop lent : ${Math.round(performance.now() - t0)} ms`);
});
