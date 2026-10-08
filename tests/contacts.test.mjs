import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/contacts", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifestJson = readJson("module.json");
const source = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
const def = (await import("../modules/contacts/index.mjs")).default;
const ctx = () => fakeCtx({ key: "contacts", messages: readJson("locales/en.json") });
const svc = def.services["contact.store"];

test("manifeste valide, offre contact.store, parité en/fr, clés ctx.t existantes, actions MCP implémentées, aucune destructive par défaut", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual(r.manifest.offers.map((o) => o.service), ["contact.store"]);
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

test("service : plafond de contacts", async () => {
  const c = ctx();
  for (let i = 0; i < 5000; i++) await c.api.store.add("contacts", { name: `n${i}`, status: "active" });
  await assert.rejects(svc.add(c, { name: "De trop", email: "z@z.io" }), /too many contacts/);
});

test("MCP : liste filtrée par statut et recherche, fiche avec notes, mise à jour partielle, passage « actif », note, suppression avec ses notes", async () => {
  const c = ctx();
  const a = (await svc.add(c, { name: "Alice", email: "a@x.io", message: "hello", source: "contact-form" })).id;
  await def.mcp.contact_create(c, { name: "Bob", organisation: "Acme" });
  assert.deepEqual((await def.mcp.contacts_list(c, { status: "to_review" })).map((x) => x.name), ["Alice"]);
  assert.deepEqual((await def.mcp.contacts_list(c, { search: "acme" })).map((x) => x.name), ["Bob"]);
  const full = await def.mcp.contact_get(c, { id: a });
  assert.equal(full.notes.length, 1);
  await def.mcp.contact_update(c, { id: a, organisation: "Initech", status: "active" }, { name: "assistant" });
  const upd = await def.mcp.contact_get(c, { id: a });
  assert.deepEqual([upd.organisation, upd.status, upd.name], ["Initech", "active", "Alice"], "les autres champs ne bougent pas");
  await def.mcp.contact_update(c, { id: a, status: "nimporte" });
  assert.equal((await def.mcp.contact_get(c, { id: a })).status, "active", "statut invalide ignoré");
  await def.mcp.contact_note(c, { id: a, text: "Vérifié sur LinkedIn" }, { name: "assistant" });
  assert.equal((await def.mcp.contact_get(c, { id: a })).notes.length, 2);
  await assert.rejects(def.mcp.contact_get(c, { id: "inconnu" }), /not found/);
  assert.deepEqual(await def.mcp.contact_delete(c, { id: a }), { id: a, deleted: true });
  assert.equal(await c.api.store.count("notes"), 0);
  assert.equal(await c.api.store.count("contacts"), 1);
});

test("admin : vue d'ensemble (à vérifier d'abord), fiche, formulaire ; activer, noter, supprimer", async () => {
  const c = ctx();
  const id = (await svc.add(c, { name: "Alice", email: "a@x.io", message: "hello", source: "contact-form" })).id;
  await def.mcp.contact_create(c, { name: "Bob" });
  const overview = await def.adminPanel(c, { query: {} });
  assert.equal(overview.find((b) => b.type === "heading").text, "Contacts (2, 1 to review)");
  assert.equal(overview.find((b) => b.type === "table").rows[0][1], "Alice", "à vérifier en premier");
  assert.ok(overview.some((b) => b.type === "adminForm" && b.action === "save"));
  const detail = await def.adminPanel(c, { query: { contact: id } });
  assert.ok(detail.some((b) => b.type === "adminForm" && b.action === "note"));
  assert.ok(JSON.stringify(detail).includes("Activate") || JSON.stringify(detail).includes("Mark active"));
  assert.equal((await def.adminActions.activate(c, { id })).ok, "Saved.");
  assert.equal((await c.api.store.get(id)).data.status, "active");
  assert.equal((await def.adminActions.note(c, { contactId: id, text: "ok" })).ok, "Saved.");
  assert.ok((await def.adminActions.save(c, { name: "" })).error);
  assert.equal((await def.adminActions.save(c, { id, name: "Alice Martin", phone: "123" })).redirect, `?contact=${id}`);
  assert.equal((await c.api.store.get(id)).data.email, "a@x.io", "modification : le reste est conservé");
  assert.equal((await def.adminActions.remove(c, { id })).ok, "Deleted.");
  assert.equal(await c.api.store.count("notes"), 0);
});

test("sauvegarde lisible : CSV avec notes, cellules neutralisées", async () => {
  const c = ctx();
  await svc.add(c, { name: "=cmd()", email: "a@x.io", message: "hello" });
  const [f] = await def.backup.readable(c);
  assert.equal(f.path, "contacts.csv");
  assert.match(f.content, /"'=cmd\(\)"/);
  assert.match(f.content, /hello/);
});
