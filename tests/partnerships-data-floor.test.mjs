// Partnerships 2.2.0: the reprise of the pre-2.0 address book is gone (data floor 2, bridge tag v1.50.0, see docs/MIGRATIONS.md).
// What stays true: the manifest is valid and declares the leftovers, nothing reads or writes them, the module never calls Contacts for them,
// and there is still no merge screen. All data is made up.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { parseManifest } from "@/core/modules/manifest";

const PDIR = new URL("../modules/partnerships", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const manifestJson = readJson(`${PDIR}/module.json`);
const en = readJson(`${PDIR}/locales/en.json`);
const def = (await import("../modules/partnerships/index.mjs")).default;

test("manifest 2.3.0: data version 2 with floor 2, leftovers declared (one of them inert), privacy.subject offered, valid", () => {
  const r = parseManifest(manifestJson);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual([manifestJson.version, manifestJson.dataVersion, manifestJson.dataFloor, manifestJson.minCore], ["2.4.0", 2, 2, "0.6.7"]);
  assert.deepEqual(manifestJson.legacyCollections, ["contacts", "legacyContacts", "meta"]);
  assert.deepEqual(manifestJson.inertLegacyCollections, ["legacyContacts"], "only the safety copy is promised inert");
  assert.deepEqual(manifestJson.offers.map((o) => [o.service, o.each]), [["privacy.subject", true]]);
  assert.equal(manifestJson.requires[0].min ?? 1, 1, "Partnerships keeps min 1: it works (links kept) even without Contacts 2");
});

test("the empty marker of migration 2 writes nothing, and the leftover collections are left exactly as they were", async () => {
  assert.equal(typeof def.migrations[2], "function");
  const book = fakeContactBook();
  const ctx = fakeCtx({ key: "partnerships", locale: "en", messages: en, services: { ...book.services }, migration: true });
  const p = await ctx.api.store.add("partners", { brand: "Acme" });
  await ctx.api.store.add("contacts", { partnerId: p, name: "Camille", email: "camille@example.test" });
  await ctx.api.store.add("legacyContacts", { partnerId: p, name: "Camille" });
  await ctx.api.store.add("meta", { kind: "contactsMerge" });
  const before = JSON.stringify([await ctx.api.store.list("contacts"), await ctx.api.store.list("legacyContacts"), await ctx.api.store.list("meta")]);
  await def.migrations[2](ctx);
  await def.adminPanel(ctx, { query: {} });
  await def.adminPanel(ctx, { query: { partner: p } });
  assert.equal(JSON.stringify([await ctx.api.store.list("contacts"), await ctx.api.store.list("legacyContacts"), await ctx.api.store.list("meta")]), before);
  assert.equal(book.dump().contacts.length, 0, "no person is created in Contacts from the leftovers");
});

test("no merge screen: no link, no readable backup of the old address book, no mention in the tools", async () => {
  const ctx = fakeCtx({ key: "partnerships", locale: "en", messages: en, services: {}, migration: true });
  const p = await ctx.api.store.add("partners", { brand: "Acme" });
  await ctx.api.store.add("contacts", { partnerId: p, name: "Ada", email: "ada@example.test" });
  const text = JSON.stringify([await def.adminPanel(ctx, { query: { merge: "1" } }), await def.adminPanel(ctx, { query: { partner: p } }), await def.mcp.partner_get(ctx, { id: p })]);
  assert.ok(!/merge=1|unmergedContacts|Merge your contacts|Undo the merge|legacy-contacts/i.test(text));
  assert.equal(def.backup, undefined);
  assert.ok(!/merge|fusion|legacy/i.test(JSON.stringify(manifestJson.mcp)));
  assert.ok(!fs.existsSync(`${PDIR}/merge.mjs`));
  assert.ok(!fs.existsSync(`${PDIR}/migrate.mjs`), "the conversion code is gone");
});
