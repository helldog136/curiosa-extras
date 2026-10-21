// Contacts 2.0 face au CONTRAT EXÉCUTABLE de « contact.book » v2 (tests/contract/contactBook.contract.mjs) : la même suite que le double en mémoire,
// contre le VRAI module (stockage fidèle au contrat 5 du cœur : tests/helpers/contactsStore.mjs). Et la convention « privacy.subject » vue
// depuis l'APPELANT (Contacts) : un fournisseur conforme, appelé à travers l'appel borné de Contacts, reste conforme.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { memStore } from "./helpers/contactsStore.mjs";
import { fakePrivacySubject } from "./helpers/fakeContactBook.mjs";
import { runContactBookContract } from "./contract/contactBook.contract.mjs";
import { runPrivacySubjectContract } from "./contract/privacySubject.contract.mjs";

const def = (await import("../modules/contacts/index.mjs")).default;
const B = await import("../modules/contacts/book.mjs");
const { callSubjects } = await import("../modules/contacts/subjects.mjs");

let n = 0;
/** Un contexte Contacts neuf (instance distincte : l'index mémoire est par instance), avec le stockage fidèle et les options de test internes. */
export function contactsCtx({ rights = [], privacySubjects = [], privacyTimeoutMs, maxContacts, store = memStore() } = {}) {
  const ctx = fakeCtx({ moduleId: "contacts", key: `contacts-${++n}`, serviceInstances: { "privacy.subject": privacySubjects }, messages: { formNote: "Message from the contact form" } });
  ctx.api.store = store;
  ctx.can = (r) => rights.includes(r);
  ctx.__contactsTest = { privacyTimeoutMs, maxContacts };
  return ctx;
}

runContactBookContract(async ({ rights, privacySubjects, privacyTimeoutMs, maxContacts }) => {
  const ctx = contactsCtx({ rights, privacySubjects, privacyTimeoutMs, maxContacts });
  const svc = def.services["contact.book"];
  return {
    methods: Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](ctx, args)])),
    admin: {
      renameCategory: (id, label) => B.renameCategory(ctx, id, label),
      mergeCategories: (keep, drop) => B.mergeCategories(ctx, keep, drop),
      deleteCategory: (id) => B.deleteCategory(ctx, id),
      setManualPhoto: (id, url) => B.setManualPhoto(ctx, id, url),
      removeAccount: (id, accountId) => B.removeAccount(ctx, id, accountId),
      deleteContact: (id) => B.deleteContact(ctx, id),
    },
    supports: { maxContacts: true },
  };
}, { prefix: "Contacts 2.0 contact.book v2" });

// La suite « privacy.subject » vise un FOURNISSEUR. Contacts n'en est pas un (il est l'appelant) : on la fait tourner contre un fournisseur
// conforme APPELÉ À TRAVERS Contacts (callSubjects : providers() puis call(…, { provider }), borné) — ce que Contacts transmet et rapporte reste conforme.
runPrivacySubjectContract(async () => {
  const sub = fakePrivacySubject("consumer");
  const ctx = contactsCtx({ privacySubjects: [sub] });
  const through = (method) => async (args) => { const [r] = await callSubjects(ctx, method, args); assert.equal(r.module, "consumer"); return r.ok ? r.value : null; };
  return {
    methods: { export: through("export"), erase: through("erase"), remap: through("remap") },
    addReference: async (id) => sub.refs.set(id, (sub.refs.get(id) ?? 0) + 1),
    countReferences: async (id) => sub.refs.get(id) ?? 0,
  };
}, { prefix: "Contacts 2.0 → privacy.subject (appel borné)" });

test("manifeste : contact.book version 2 déclarée, méthodes de lecture en readOnly, contact.store gardé", async () => {
  const { loadModule } = await import("./helpers/moduleLoader.mjs");
  const { manifest } = await loadModule("modules/contacts");
  const book = manifest.offers.find((o) => o.service === "contact.book");
  assert.equal(book.version, 2);
  const { READ_ONLY, METHODS } = await import("./contract/contactBook.contract.mjs");
  assert.deepEqual([...book.readOnly].sort(), [...READ_ONLY].sort());
  assert.ok(manifest.offers.some((o) => o.service === "contact.store"));
  assert.deepEqual(Object.keys(def.services["contact.book"]).sort(), [...METHODS].sort());
});
