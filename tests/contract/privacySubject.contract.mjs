// SUITE DE CONTRAT de la convention « privacy.subject » (contrat 11.4), pour les modules qui gardent des RÉFÉRENCES à des fiches Contacts
// (Raid, Story, Partenariats…). Contrat expliqué : tests/contract/README.md.
//
// Dans le test de VOTRE module :
//
//   import { runPrivacySubjectContract } from "./contract/privacySubject.contract.mjs";
//   runPrivacySubjectContract(async () => {
//     const ctx = fakeCtx({ key: "my-module" });
//     const svc = def.services["privacy.subject"];
//     return {
//       methods: Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](ctx, args)])),
//       addReference: async (contactId) => { /* range une référence à cette fiche dans VOS données */ },
//       countReferences: async (contactId) => { /* combien de références à cette fiche restent dans VOS données */ },
//     };
//   }, { prefix: "my-module privacy.subject" });
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { privacyReplyProblems } from "../helpers/fakeContactBook.mjs";

export function runPrivacySubjectContract(makeConsumer, { test = nodeTest, prefix = "privacy.subject" } = {}) {
  const ok = (method, value) => assert.deepEqual(privacyReplyProblems(method, value), [], `${method} → ${JSON.stringify(value)}`);

  test(`${prefix} : export / erase / remap existent et répondent dans la forme du contrat, même pour une fiche inconnue`, async () => {
    const c = await makeConsumer();
    for (const m of ["export", "erase", "remap"]) assert.equal(typeof c.methods[m], "function", m);
    ok("export", await c.methods.export({ contactId: "unknown-contact" }));
    const e = await c.methods.erase({ contactId: "unknown-contact" });
    ok("erase", e);
    assert.equal(e.removed, 0);
    const r = await c.methods.remap({ from: "unknown-contact", to: "other-contact" });
    ok("remap", r);
    assert.equal(r.updated, 0);
  });

  test(`${prefix} : export dit ce que le module garde sur la fiche (≤ 1 Mo), sans rien modifier`, async () => {
    const c = await makeConsumer();
    await c.addReference("contact-a");
    const x = await c.methods.export({ contactId: "contact-a" });
    ok("export", x);
    assert.equal(await c.countReferences("contact-a"), 1);
  });

  test(`${prefix} : erase retire TOUTES les références à la fiche, et seulement elles ; rejouer ne retire rien de plus`, async () => {
    const c = await makeConsumer();
    await c.addReference("contact-a");
    await c.addReference("contact-b");
    const e = await c.methods.erase({ contactId: "contact-a" });
    ok("erase", e);
    assert.ok(e.removed >= 1);
    assert.equal(await c.countReferences("contact-a"), 0);
    assert.equal(await c.countReferences("contact-b"), 1);
    assert.equal((await c.methods.erase({ contactId: "contact-a" })).removed, 0, "idempotent");
  });

  test(`${prefix} : remap déplace les références de « from » vers « to » (fusion de fiches), sans doublon ; rejouer ne change rien`, async () => {
    const c = await makeConsumer();
    await c.addReference("contact-old");
    const r = await c.methods.remap({ from: "contact-old", to: "contact-new" });
    ok("remap", r);
    assert.ok(r.updated >= 1);
    assert.equal(await c.countReferences("contact-old"), 0);
    assert.equal(await c.countReferences("contact-new"), 1);
    assert.equal((await c.methods.remap({ from: "contact-old", to: "contact-new" })).updated, 0, "idempotent");
  });

  test(`${prefix} : arguments absurdes → réponse conforme (0), jamais d'exception`, async () => {
    const c = await makeConsumer();
    for (const junk of [undefined, null, {}, { contactId: 42 }, { contactId: "x".repeat(10_000) }]) {
      const e = await c.methods.erase(junk);
      ok("erase", e);
      assert.equal(e.removed, 0);
    }
    for (const junk of [undefined, {}, { from: "a" }, { from: "a", to: "a" }, { from: 1, to: 2 }]) ok("remap", await c.methods.remap(junk));
  });
}
