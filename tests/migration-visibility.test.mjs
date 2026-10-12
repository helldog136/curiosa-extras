// Migration temporaire (fusion des contacts) : rien n'en est visible quand il n'y a aucune fusion à faire ; 30 jours d'annulation possibles après la fusion.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const PDIR = new URL("../modules/partnerships", import.meta.url).pathname;
const CDIR = new URL("../modules/contacts", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const def = (await import("../modules/partnerships/index.mjs")).default;
const book = (await import("../modules/contacts/index.mjs")).default.services["contact.book"];
const manifest = readJson(`${PDIR}/module.json`);

function setup() {
  const bookCtx = fakeCtx({ key: "contacts", messages: readJson(`${CDIR}/locales/en.json`) });
  const services = { "contact.book": Object.fromEntries(Object.keys(book).map((m) => [m, (args) => book[m](bookCtx, args)])) };
  return { ctx: fakeCtx({ key: "partnerships", locale: "en", messages: readJson(`${PDIR}/locales/en.json`), services }), bookCtx };
}
const text = (x) => JSON.stringify(x);
const MERGE = /Merge your contacts|merge=1|Contacts merged|legacy|unmergedContacts|to check by hand/i;
async function everything(ctx, p) {
  const get = await def.mcp.partner_get(ctx, { id: p });
  return { overview: await def.adminPanel(ctx, { query: {} }), fiche: await def.adminPanel(ctx, { query: { partner: p } }), get, backup: await def.backup.readable(ctx) };
}
const withLegacy = async (ctx, p) => ctx.api.store.add("contacts", { partnerId: p, name: "Ada", email: "ada@x.org", status: "active" });

test("site neuf : aucune trace de la fusion (ni affichage, ni MCP, ni sauvegarde lisible, ni collection créée)", async () => {
  const { ctx } = setup();
  const p = await ctx.api.store.add("partners", { brand: "Acme" });
  const r = await everything(ctx, p);
  assert.ok(!MERGE.test(text(r.overview)) && !MERGE.test(text(r.fiche)));
  assert.ok(!("unmergedContacts" in r.get));
  assert.deepEqual(r.backup, []);
  assert.equal(await ctx.api.store.count("legacyContacts"), 0);
  assert.equal(await ctx.api.store.count("meta"), 0);
  assert.equal(await ctx.api.store.count("contacts"), 0);
  assert.ok(!/merge|fusion|legacy/i.test(JSON.stringify(manifest.mcp)), "aucune mention de la fusion dans les outils MCP");
});

test("anciens contacts : bandeau, ancien carnet en lecture, unmergedContacts, CSV lisible", async () => {
  const { ctx } = setup();
  const p = await ctx.api.store.add("partners", { brand: "Acme" });
  await withLegacy(ctx, p);
  const r = await everything(ctx, p);
  assert.match(text(r.overview), /Merge your contacts/);
  assert.match(text(r.fiche), /Old contacts \(not merged yet\)/);
  assert.equal(r.get.unmergedContacts[0].name, "Ada");
  assert.equal(r.backup[0].path, "legacy-contacts.csv");
});

test("fusion faite avec des cas en attente : lien « Contacts à vérifier » et lien de pied de page, même après 30 jours", async () => {
  const { ctx, bookCtx } = setup();
  const p = await ctx.api.store.add("partners", { brand: "Acme" });
  await book.create(bookCtx, { name: "Autre Nom", email: "ada@x.org" });
  await withLegacy(ctx, p); // même e-mail, autre nom : ambigu
  await def.adminActions.mergeRun(ctx, {});
  const meta = (await ctx.api.store.list("meta"))[0];
  await ctx.api.store.update(meta.id, { ...meta.data, at: new Date(Date.now() - 90 * 86_400_000).toISOString() });
  const o = text(await def.adminPanel(ctx, { query: {} }));
  assert.match(o, /Contacts to check by hand/);
  assert.match(o, /Contacts merged with the Contacts module/);
  assert.equal((await def.backup.readable(ctx))[0].path, "legacy-contacts.csv");
});

test("fusion faite sans attente : lien d'annulation 30 jours, puis plus rien — l'annulation reste possible par adresse", async () => {
  const { ctx } = setup();
  const p = await ctx.api.store.add("partners", { brand: "Acme" });
  await withLegacy(ctx, p);
  await def.adminActions.mergeRun(ctx, {});
  let r = await everything(ctx, p);
  assert.ok(!/Merge your contacts|Contacts to check/.test(text(r.overview)), "ni bandeau ni cas en attente");
  assert.match(text(r.overview), /Contacts merged with the Contacts module on \d{4}-\d\d-\d\d.*merge=1/, "lien d'annulation < 30 jours");
  assert.ok(!("unmergedContacts" in r.get));
  assert.equal(r.backup[0].path, "legacy-contacts.csv");
  const meta = (await ctx.api.store.list("meta"))[0];
  await ctx.api.store.update(meta.id, { ...meta.data, at: new Date(Date.now() - 31 * 86_400_000).toISOString() });
  r = await everything(ctx, p);
  assert.ok(!MERGE.test(text(r.overview)) && !MERGE.test(text(r.fiche)), "plus aucun lien après 30 jours");
  assert.deepEqual(r.backup, []);
  assert.equal(await ctx.api.store.count("legacyContacts"), 1, "la copie reste conservée");
  const page = text(await def.adminPanel(ctx, { query: { merge: "1" } }));
  assert.match(page, /Undo the merge/, "la page reste atteignable par adresse");
  assert.match((await def.adminActions.mergeUndo(ctx, {})).ok, /Merge undone/);
  assert.equal(await ctx.api.store.count("contacts"), 1);
});

test("migrationActive : états purs", async () => {
  const m = await import("../modules/partnerships/merge.mjs");
  const items = [{ id: "a" }];
  assert.equal(m.migrationActive({ items: [], meta: null, pending: [] }), false);
  assert.equal(m.migrationActive({ items, meta: null, pending: items }), true);
  const meta = (days) => ({ data: { at: new Date(Date.now() - days * 86_400_000).toISOString() } });
  assert.equal(m.migrationActive({ items, meta: meta(5), pending: [] }), true);
  assert.equal(m.migrationActive({ items, meta: meta(40), pending: [] }), false);
  assert.equal(m.migrationActive({ items, meta: meta(40), pending: items }), true);
});
