// Contacts 1.1.1 → 2.0.0 : migration des données (dataVersion 2). Rejouable (deux passes = même résultat), sans doublon ni perte, identifiants
// de fiches CONSERVÉS, 2 000 puis 10 000 fiches ; échec en cours de route = rien d'effacé, et la reprise finit le travail sans doublon.
// Deux stockages : le stockage en mémoire fidèle au contrat 5 (rapide), puis le VRAI stockage SQLite du cœur (createStore, base jetable).
import test from "node:test";
import assert from "node:assert/strict";
import { coreHelper } from "./helpers/core.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { memStore } from "./helpers/contactsStore.mjs";

const { useTestDb } = await coreHelper("db.mjs");
const db = await useTestDb();
const { createStore } = await import("@/core/services/store");
const def = (await import("../modules/contacts/index.mjs")).default;
const B = await import("../modules/contacts/book.mjs");
const { fold } = await import("../modules/contacts/networks.mjs");

const ORGS = ["Studio Nord", "Atelier Sud", "Écurie Ouest", "Maison Est", "Collectif Lune", "Agence Soleil", "Club Pixel", "Label Onde"];
const variant = (s, i) => [s, s.toUpperCase(), ` ${s.toLowerCase()} `, s.replace(" ", "   "), s.normalize("NFD").replace(/\p{M}/gu, "")][i % 5];
/** Données d'un carnet 1.1.1 : n fiches (organisation en texte, e-mail pour une sur deux, « autres canaux » parfois), ~0,75 n notes. Déterministe. */
function v1Rows(n) {
  const contacts = [], notes = [];
  for (let i = 0; i < n; i++) {
    const orgBase = i % 7 === 0 ? "" : `${ORGS[i % ORGS.length]} ${Math.floor(i / 40)}`; // ≈ n/40 × 8 noms distincts
    contacts.push({
      name: `Personne ${i}`, role: i % 3 ? "Chargée de projet" : "", organisation: orgBase ? variant(orgBase, i) : "", email: i % 2 ? `p${i}@example.test` : "", phone: i % 5 ? "" : `+00 ${i}`,
      others: i % 11 === 0 ? `twitch.tv/chaine_${i}\nDiscord: pseudo${i}` : "", relation: i % 13 === 0 ? "Rencontre au salon" : "", status: i % 9 === 0 ? "to_review" : "active",
      source: ["manual", "contact-form", "agent", "partnerships"][i % 4], ...(i % 17 === 0 ? { updatedBy: "assistant" } : {}),
    });
  }
  return { contacts, notes, noteFor: (k) => ({ date: `2026-0${1 + (k % 9)}-1${k % 10}`, author: k % 2 ? "admin" : "contact-form", text: `Note numéro ${k}` }) };
}
/** Sème un carnet 1.1.1 dans un stockage (sans clés : comme la 1.x l'écrivait). Rend les ids des fiches dans l'ordre. */
async function seedV1(seed, n) {
  const { contacts, noteFor } = v1Rows(n);
  const ids = await seed("contacts", contacts);
  const notes = [];
  for (let k = 0; k < Math.floor(n * 0.75); k++) notes.push({ contactId: ids[(k * 7) % ids.length], ...noteFor(k) });
  const noteIds = await seed("notes", notes);
  return { ids, contacts, notes, noteIds };
}
const distinctOrgs = (contacts) => new Set(contacts.map((c) => fold(c.organisation)).filter(Boolean)).size;

/** Vue normalisée du stockage (sans le tampon d'écriture) : comparer deux passes, ou une passe interrompue puis reprise et une passe propre. */
async function view(store) {
  const all = async (collection) => { const out = []; let cursor = null; do { const p = await store.page(collection, { limit: 1000, order: "asc", cursor }); out.push(...p.items); cursor = p.next; } while (cursor); return out; };
  const orgs = await all("orgs");
  const orgName = new Map(orgs.map((o) => [o.id, fold(o.data.name)]));
  const persons = (await all("contacts")).map((r) => ({ id: r.id, key: r.key, data: { ...r.data, orgId: r.data.orgId ? orgName.get(r.data.orgId) ?? "?" : null } }));
  const notes = (await all("notes")).map((r) => ({ id: r.id, key: r.key, data: r.data }));
  return { persons, notes, orgs: orgs.map((o) => fold(o.data.name)).sort() };
}

async function checkMigrated(ctx, store, seeded) {
  const v = await view(store);
  // Fiches : mêmes ids, mêmes noms, forme 2.0, organisation devenue un lien vers la bonne fiche organisation.
  assert.equal(v.persons.length, seeded.ids.length, "aucune fiche perdue ni ajoutée");
  const byId = new Map(v.persons.map((p) => [p.id, p]));
  seeded.ids.forEach((id, i) => {
    const p = byId.get(id), src = seeded.contacts[i];
    assert.ok(p, `fiche ${id} conservée avec son identifiant`);
    assert.equal(p.data.name, src.name);
    assert.equal(p.data.kind, "person");
    assert.ok(!("organisation" in p.data), "le texte organisation est devenu un lien");
    assert.equal(p.data.orgId, fold(src.organisation) || null, `organisation de ${src.name}`);
    assert.equal(p.data.others, src.others, "autres canaux gardés tels quels");
    assert.equal(p.key, src.email ? `e:${src.email}` : null, "clé e-mail");
    assert.deepEqual([p.data.accounts, p.data.categoryIds, p.data.status, p.data.source, p.data.email], [[], [], src.status, src.source, src.email]);
  });
  assert.equal(v.orgs.length, distinctOrgs(seeded.contacts), "une fiche organisation par nom (casse, accents, espaces ignorés)");
  assert.equal(new Set(v.orgs).size, v.orgs.length, "aucune organisation en double");
  // Notes : mêmes ids, mêmes données, rangées par fiche.
  assert.equal(v.notes.length, seeded.notes.length, "aucune note perdue ni doublée");
  const notesById = new Map(v.notes.map((n) => [n.id, n]));
  seeded.noteIds.forEach((id, k) => { const n = notesById.get(id); assert.ok(n); assert.deepEqual(n.data, seeded.notes[k]); assert.equal(n.key, seeded.notes[k].contactId); });
  // Lu par le service 2.0 : alias « organisation », notes, organisation retrouvée.
  const i = 1;
  const got = await def.services["contact.book"].get(ctx, { id: seeded.ids[i] });
  assert.equal(got.ok, true);
  assert.equal(fold(got.contact.organisation), fold(seeded.contacts[i].organisation));
  const withNotes = seeded.notes[0].contactId;
  assert.ok((await def.services["contact.book"].get(ctx, { id: withNotes })).contact.notes.some((n) => n.text === seeded.notes[0].text));
  return v;
}

let k = 0;
const ctxWith = (store) => { const c = fakeCtx({ moduleId: "contacts", key: `contacts-mig-${++k}`, migration: true, messages: {} }); c.api.store = store; return c; };

for (const n of [2000, 10_000]) {
  test(`migration 1 → 2 (stockage fidèle en mémoire) : ${n} fiches, deux passes identiques, ids conservés, organisations dédoublonnées, notes rangées`, async (t) => {
    const store = memStore();
    const seeded = await seedV1(async (collection, rows) => store.seed(rows.map((data) => ({ collection, data }))), n);
    const ctx = ctxWith(store);
    const t0 = Date.now();
    await def.migrations[2](ctx);
    const first = await checkMigrated(ctx, store, seeded);
    const t1 = Date.now();
    await def.migrations[2](ctx);
    const second = await view(store);
    assert.deepEqual(second, first, "rejouer ne change rien");
    t.diagnostic(`${n} fiches : 1re passe ${t1 - t0} ms, 2e passe ${Date.now() - t1} ms`);
  });
}

test("migration interrompue en cours de route : rien n'est effacé ; la reprise termine sans doublon (même résultat qu'une passe propre)", async () => {
  const n = 2000;
  const clean = memStore();
  const seededClean = await seedV1(async (collection, rows) => clean.seed(rows.map((data) => ({ collection, data }))), n);
  await def.migrations[2](ctxWith(clean));
  const expected = await view(clean);
  for (const failAfter of [10, 1500, 2400]) {
    const store = memStore();
    const seeded = await seedV1(async (collection, rows) => store.seed(rows.map((data) => ({ collection, data }))), n);
    const ctx = ctxWith(store);
    store.faults.countdown.set("update", failAfter);
    await assert.rejects(def.migrations[2](ctx), /fault injected/);
    store.faults.countdown.delete("update");
    // Rien d'effacé (le cœur remet de toute façon l'instance dans son état d'avant ; même sans lui, aucune donnée n'a disparu).
    assert.equal(await store.count("contacts"), n);
    assert.equal(await store.count("notes"), seeded.notes.length);
    await def.migrations[2](ctx);
    const after = await checkMigrated(ctx, store, seeded);
    assert.deepEqual(after.orgs, expected.orgs, `reprise après ${failAfter} écritures : mêmes organisations, aucune en double`);
    assert.deepEqual(after.persons.map((p) => [p.data.name, p.data.orgId]), expected.persons.map((p) => [p.data.name, p.data.orgId]));
    assert.equal(seededClean.ids.length, seeded.ids.length);
  }
});

test("migration : un carnet vide, et un carnet déjà en 2.0, passent sans rien changer", async () => {
  const store = memStore();
  const ctx = ctxWith(store);
  await def.migrations[2](ctx);
  assert.equal((await store.dump()).filter((r) => r.collection !== "meta").length, 0);
  await B.create(ctx, { name: "Nouvelle", organisation: "Org 2.0" });
  const before = await view(store);
  await def.migrations[2](ctx);
  assert.deepEqual(await view(store), before);
});

for (const n of [2000, 10_000]) {
  test(`migration 1 → 2 sur le VRAI stockage SQLite du cœur : ${n} fiches, deux passes identiques`, { timeout: 600_000 }, async (t) => {
    const instanceId = `inst-contacts-${n}`;
    const store = createStore(instanceId);
    let seq = 0;
    const seeded = await seedV1(async (collection, rows) => {
      const ids = [];
      const base = Date.parse("2025-06-01T00:00:00Z");
      for (let i = 0; i < rows.length; i += 2000) {
        const chunk = rows.slice(i, i + 2000).map((data) => ({ id: `v1${n}${collection.slice(0, 1)}${String(++seq).padStart(7, "0")}`, instanceId, collection, data: JSON.stringify(data), createdAt: new Date(base + seq * 1000) }));
        await db.prisma.moduleRecord.createMany({ data: chunk });
        ids.push(...chunk.map((r) => r.id));
      }
      return ids;
    }, n);
    const ctx = ctxWith(store);
    const t0 = Date.now();
    await def.migrations[2](ctx);
    const first = await checkMigrated(ctx, store, seeded);
    const t1 = Date.now();
    await def.migrations[2](ctx);
    assert.deepEqual(await view(store), first, "rejouer ne change rien");
    t.diagnostic(`SQLite ${n} fiches : 1re passe ${t1 - t0} ms, 2e passe ${Date.now() - t1} ms`);
    // Le service 2.0 sur le vrai stockage : recherche par e-mail (clé), notes par clé, pagination complète des fiches.
    assert.equal((await def.services["contact.book"].find(ctx, { email: "P3@example.test" })).contacts[0].id, seeded.ids[3]);
    let cursor = null, seen = 0;
    do { const r = await def.services["contact.book"].list(ctx, { limit: 500, cursor, kind: "person" }); seen += r.items.length; cursor = r.next; } while (cursor);
    assert.equal(seen, n);
  });
}

test.after(() => db.close());
