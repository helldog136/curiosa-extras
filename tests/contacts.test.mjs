import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/contacts", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifestJson = readJson("module.json");
const source = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n"); // le code tient en plusieurs fichiers
const def = (await import("../modules/contacts/index.mjs")).default;
const ctx = () => fakeCtx({ key: "contacts", messages: readJson("locales/en.json") });
const svc = def.services["contact.store"];

test("manifeste valide, offre contact.store, parité en/fr, clés ctx.t existantes, actions MCP implémentées, aucune destructive par défaut", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual(r.manifest.offers.map((o) => o.service), ["contact.store", "contact.book"]);
  const en = readJson("locales/en.json");
  assert.deepEqual(Object.keys(readJson("locales/fr.json")).sort(), Object.keys(en).sort());
  for (const m of source.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in en, m[1]);
  for (const a of manifestJson.mcp) { assert.equal(typeof def.mcp[a.name], "function", a.name); if (a.destructive) assert.notEqual(a.default, true); }
});

test("service contact.store : crée un contact « à vérifier » avec le message en note ; même e-mail → note ajoutée, pas de doublon", async () => {
  const c = ctx();
  const first = await svc.add(c, { name: "  Alice  ", email: "Alice@Example.org", message: "Bonjour\nje cherche un partenariat", source: "contact-form" });
  assert.equal(first.created, true);
  const [row] = await c.api.store.list("contacts");
  assert.deepEqual([row.data.name, row.data.email, row.data.status, row.data.source], ["Alice", "alice@example.org", "to_review", "contact-form"]);
  const notes = await c.api.store.list("notes");
  assert.equal(notes.length, 1);
  assert.match(notes[0].data.text, /Message received through the website form:\n\nBonjour/);
  const second = await svc.add(c, { name: "Alice B.", email: "alice@example.org", message: "Deuxième message", source: "contact-form" });
  assert.deepEqual([second.created, second.id], [false, first.id]);
  assert.equal(await c.api.store.count("contacts"), 1);
  assert.equal(await c.api.store.count("notes"), 2);
});

test("service : nom obligatoire, origine inconnue → manuelle, e-mail invalide ignoré, champs bornés", async () => {
  const c = ctx();
  await assert.rejects(svc.add(c, { name: "  " }), /name required/);
  await assert.rejects(svc.add(c, null), /name required/);
  await svc.add(c, { name: "x".repeat(500), email: "pas-un-email", source: "piratage" });
  const [row] = await c.api.store.list("contacts");
  assert.equal(row.data.name.length, 120);
  assert.equal(row.data.email, "");
  assert.equal(row.data.source, "manual");
});

test("service : plafond du carnet (100 000 fiches en vrai, abaissé ici par l'option de test interne)", async () => {
  const c = ctx();
  c.__contactsTest = { maxContacts: 2 };
  await svc.add(c, { name: "Un" });
  await svc.add(c, { name: "Deux" });
  await assert.rejects(svc.add(c, { name: "De trop", email: "z@z.io" }), /too many contacts/);
  assert.equal(await c.api.store.count("contacts"), 2);
});

test("MCP : liste paginée filtrée par statut et recherche (sans e-mail ni téléphone), fiche avec notes, mise à jour partielle, passage « actif », note, suppression avec ses notes", async () => {
  const c = ctx();
  const a = (await svc.add(c, { name: "Alice", email: "a@x.io", phone: "0102", message: "hello", source: "contact-form" })).id;
  await def.mcp.contact_create(c, { name: "Bob", organisation: "Acme" });
  const reviewList = await def.mcp.contacts_list(c, { status: "to_review" });
  assert.deepEqual(reviewList.items.map((x) => x.name), ["Alice"]);
  assert.ok(!JSON.stringify(reviewList).includes("a@x.io") && !JSON.stringify(reviewList).includes("0102"), "ni e-mail ni téléphone dans la liste");
  assert.deepEqual((await def.mcp.contacts_list(c, { q: "acme", kind: "person" })).items.map((x) => x.name), ["Bob"]);
  assert.deepEqual((await def.mcp.contacts_list(c, { search: "acme", kind: "person" })).items.map((x) => x.name), ["Bob"], "ancien nom du paramètre accepté");
  const full = await def.mcp.contact_get(c, { id: a });
  assert.equal(full.notes.length, 1);
  assert.ok(!("email" in full) && !("phone" in full), "contact_get : pas d'e-mail ni de téléphone");
  const priv = await def.mcp.contact_get_private(c, { id: a });
  assert.deepEqual([priv.email, priv.phone], ["a@x.io", "0102"]);
  await def.mcp.contact_update(c, { id: a, organisation: "Initech", status: "active" }, { name: "assistant" });
  const upd = await def.mcp.contact_get(c, { id: a });
  assert.deepEqual([upd.organisation, upd.status, upd.name], ["Initech", "active", "Alice"], "les autres champs ne bougent pas");
  await def.mcp.contact_update(c, { id: a, status: "nimporte" });
  assert.equal((await def.mcp.contact_get(c, { id: a })).status, "active", "statut invalide ignoré");
  await def.mcp.contact_note(c, { id: a, text: "Vérifié sur LinkedIn" }, { name: "assistant" });
  assert.equal((await def.mcp.contact_get(c, { id: a })).notes.length, 2);
  await assert.rejects(def.mcp.contact_get(c, { id: "inconnu" }), /not found/);
  const added = await def.mcp.contact_add_account(c, { id: a, network: "twitch", handle: "twitch.tv/Alice_Live" });
  assert.equal(added.account.handle, "alice_live");
  await assert.rejects(def.mcp.contact_add_account(c, { id: a, network: "twitch", handle: "a b" }), /invalid_handle/);
  assert.deepEqual(await def.mcp.contact_delete(c, { id: a }), { id: a, deleted: true, modules: [] });
  assert.equal(await c.api.store.count("notes"), 0);
  assert.equal(await c.api.store.count("contacts"), 1);
});

test("sauvegarde lisible : contacts.csv et notes.csv, cellules neutralisées", async () => {
  const c = ctx();
  await svc.add(c, { name: "=cmd()", email: "a@x.io", message: "hello" });
  const [f, notes] = await def.backup.readable(c);
  assert.equal(f.path, "contacts.csv");
  assert.match(f.content, /"'=cmd\(\)"/);
  assert.equal(notes.path, "notes.csv");
  assert.match(notes.content, /hello/);
});
