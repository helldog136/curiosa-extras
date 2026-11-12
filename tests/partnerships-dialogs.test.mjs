// Partnerships: forms open in a window above the page (new, edit, delete, journal entry), deleting a partner, and the ergonomics of what is shown.
// Everything is invented data. People live in the Contacts module (a real one, behind the real service).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { assertAdminPageErgonomics } from "./helpers/ergonomics.mjs";

const PDIR = new URL("../modules/partnerships", import.meta.url).pathname;
const CDIR = new URL("../modules/contacts", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const manifest = readJson(`${PDIR}/module.json`);
const messages = { en: readJson(`${PDIR}/locales/en.json`), fr: readJson(`${PDIR}/locales/fr.json`) };
const contactsEn = readJson(`${CDIR}/locales/en.json`);
const def = (await import("../modules/partnerships/index.mjs")).default;
const book = (await import("../modules/contacts/index.mjs")).default.services["contact.book"];
const find = (blocks, type) => blocks.filter((b) => b.type === type);
const shown = (form) => form.fields.filter((f) => f.kind !== "hidden" && !f.folded);

/** A Partnerships context plugged on a real Contacts address book; `logged` collects what the module writes in the core log. */
function setup({ locale = "en", withBook = true } = {}) {
  const bookCtx = fakeCtx({ key: "contacts", messages: contactsEn });
  const services = withBook ? { "contact.book": Object.fromEntries(Object.keys(book).map((m) => [m, (args) => book[m](bookCtx, args)])) } : {};
  const ctx = fakeCtx({ key: "partnerships", locale, messages: messages[locale], services });
  const logged = [];
  ctx.api.log = { write: async (e) => { logged.push(e); return true; } };
  return { ctx, bookCtx, logged, addContact: async (c) => (await book.create(bookCtx, c)).id };
}
/** A partner with `n` journal entries and the given linked people. */
async function partner(ctx, brand, { entries = 0, contactIds = [] } = {}) {
  const id = await ctx.api.store.add("partners", { brand, status: "discussion", contactIds });
  for (let i = 0; i < entries; i++) await ctx.api.store.add("journal", { partnerId: id, date: "2026-01-01", author: "admin", text: `note ${i}` });
  return id;
}
const panel = (ctx, query) => def.adminPanel(ctx, { query });
const dialogOf = (blocks) => find(blocks, "adminForm").find((f) => f.presentation === "dialog");

test("minCore covers the window (0.6.7), and the module declares the log line of a deletion with counts only", () => {
  assert.equal(manifest.minCore, "0.6.7");
  const ev = manifest.logEvents.find((e) => e.key === "partner.deleted");
  assert.deepEqual(ev.fields.map((f) => f.key).sort(), ["contacts", "journal"], "counts only: never the brand, a note or a person");
});

test("overview: no inline form, a 'New partner' button opening a window, live search, status filter, and a row menu with the deletion", async () => {
  const { ctx } = setup();
  const a = await partner(ctx, "Moonlight Games");
  const blocks = await panel(ctx, {});
  assert.deepEqual(find(blocks, "adminForm").map((f) => f.action), ["importPartners"], "the only inline form left is the import");
  assert.deepEqual(find(blocks, "links")[0].items, [{ label: "Add a partner", href: "?new=1", presentation: "dialog" }]);
  const table = find(blocks, "table")[0];
  assert.equal(table.searchable, true);
  assert.deepEqual(table.filters, [{ column: 1 }]);
  assert.deepEqual(table.rowIds, [a]);
  const [open, edit, del] = table.rowActions;
  assert.deepEqual([open.label, open.href, open.presentation], ["Open", "?partner={id}", undefined]);
  assert.deepEqual([edit.label, edit.href, edit.presentation], ["Edit", "?edit={id}", "dialog"]);
  assert.deepEqual([del.label, del.href, del.presentation, del.danger, del.inMenu], ["Delete the partner", "?delete={id}", "dialog", true, true]);
  assert.equal(del.action, undefined, "the row never deletes by itself: it opens the confirmation window");
});

test("new partner: a window with four fields in sight (brand, status, chance, website), the rare ones folded, and a precise button", async () => {
  const { ctx } = setup();
  const form = dialogOf(await panel(ctx, { new: "1" }));
  assert.equal(form.action, "savePartner");
  assert.equal(form.title, "New partner");
  assert.equal(form.submitLabel, "Add the partner");
  assert.equal(form.cancelHref, "?");
  assert.deepEqual(shown(form).map((f) => f.name), ["brand", "status", "chances", "url"]);
  assert.deepEqual(form.fields.filter((f) => f.folded).map((f) => f.name), ["sector", "country", "contact", "logo", "products", "benefits", "brief", "mail", "source"]);
  const chance = form.fields.find((f) => f.name === "chances");
  assert.deepEqual([chance.kind, chance.min, chance.max, chance.unit], ["number", 0, 100, "%"], "a bounded number that says its unit");
  assert.equal(form.fields.find((f) => f.name === "id").value, "", "no id: it creates");
});

test("edit: the window names the partner, comes back to the list, and from a partner page comes back to that page", async () => {
  const { ctx } = setup();
  const a = await partner(ctx, "Moonlight Games");
  const fromList = dialogOf(await panel(ctx, { edit: a }));
  assert.equal(fromList.title, "Edit — Moonlight Games");
  assert.equal(fromList.submitLabel, "Save the partner");
  assert.equal(fromList.cancelHref, "?");
  assert.equal(fromList.fields.find((f) => f.name === "id").value, a);
  const behind = await panel(ctx, { edit: a });
  assert.equal(find(behind, "table").length, 1, "the list stays behind the window");
  const fromPage = dialogOf(await panel(ctx, { partner: a, edit: a }));
  assert.equal(fromPage.cancelHref, `?partner=${a}`);
  assert.equal(dialogOf(await panel(ctx, { edit: "nope" })), undefined, "unknown partner: the list, no window");
});

test("save answers { ok } without a redirect (the core closes the window and marks the row), also for a new partner", async () => {
  const { ctx } = setup();
  assert.deepEqual(await def.adminActions.savePartner(ctx, { id: "", brand: "Nova" }), { ok: "Saved." });
  const [row] = await ctx.api.store.list("partners");
  assert.deepEqual(await def.adminActions.savePartner(ctx, { id: row.id, brand: "Nova 2", status: "envoye", chances: "30" }), { ok: "Saved." });
  const d = (await ctx.api.store.get(row.id)).data;
  assert.deepEqual([d.brand, d.status, d.chances], ["Nova 2", "envoye", 30]);
});

test("partner page: no inline journal form (a window), the deletion is last under its own heading and opens a window", async () => {
  const { ctx } = setup();
  const a = await partner(ctx, "Moonlight Games", { entries: 2 });
  const blocks = await panel(ctx, { partner: a });
  const links = find(blocks, "links").flatMap((l) => l.items);
  assert.ok(links.find((l) => l.href === `?partner=${a}&log=1` && l.presentation === "dialog"));
  assert.ok(links.find((l) => l.href === `?partner=${a}&edit=${a}` && l.presentation === "dialog"));
  assert.deepEqual(blocks.at(-1).items, [{ label: "Delete the partner", href: `?partner=${a}&delete=${a}`, presentation: "dialog" }]);
  const headings = blocks.filter((b) => b.type === "heading").map((b) => b.text);
  assert.equal(headings.at(-1), "Delete this partner");
  assert.match(blocks.at(-2).text, /linked contacts stay in your address book/);
  const journal = find(blocks, "table").find((t) => t.columns[0] === "Date");
  assert.equal(journal.searchable, true);
  assert.equal(journal.rowActions[0].confirm, "Delete this journal entry? This cannot be undone.");
  assert.equal(JSON.stringify(blocks).includes('"action":"deletePartner"'), false, "no button on the page deletes a partner directly");
});

test("journal entry: a window with three fields, which returns to the partner page; the action answers { ok }", async () => {
  const { ctx } = setup();
  const a = await partner(ctx, "Moonlight Games");
  assert.equal(dialogOf(await panel(ctx, { log: "1" })), undefined, "without an open partner there is nothing to write in");
  const form = dialogOf(await panel(ctx, { partner: a, log: "1" }));
  assert.equal(form.action, "addJournal");
  assert.equal(form.title, "Add to the journal — Moonlight Games");
  assert.equal(form.cancelHref, `?partner=${a}`);
  assert.deepEqual(shown(form).map((f) => f.name), ["date", "text", "link"]);
  assert.equal(form.fields.find((f) => f.name === "partnerId").value, a);
  assert.deepEqual(await def.adminActions.addJournal(ctx, { partnerId: a, text: "Called them" }), { ok: "Saved." });
});

test("delete window: says what is lost (counts) and what stays (linked people), asks for a tick, and opening it deletes nothing", async () => {
  const { ctx, addContact } = setup();
  const c1 = await addContact({ name: "etoile_nord" }), c2 = await addContact({ name: "lune_douce" });
  const a = await partner(ctx, "Moonlight Games", { entries: 12, contactIds: [c1, c2] });
  const before = [await ctx.api.store.count("partners"), await ctx.api.store.count("journal")];
  const form = dialogOf(await panel(ctx, { delete: a }));
  assert.equal(form.action, "deletePartner");
  assert.equal(form.title, "Delete — Moonlight Games");
  assert.equal(form.submitLabel, "Delete the partner", "a precise verb that names what goes");
  assert.equal(form.cancelHref, "?");
  const tick = form.fields.find((f) => f.name === "confirm");
  assert.deepEqual([tick.kind, tick.required], ["checkbox", true]);
  assert.equal(tick.label, "Delete this partner and its 12 journal entries");
  assert.equal(tick.help, "The 2 linked contacts stay in your address book.");
  assert.deepEqual(shown(form).map((f) => f.name), ["confirm"]);
  assert.deepEqual([await ctx.api.store.count("partners"), await ctx.api.store.count("journal")], before, "a page view (GET) never deletes");
  assert.equal(dialogOf(await panel(ctx, { partner: a, delete: a })).cancelHref, `?partner=${a}`);
  assert.equal(dialogOf(await panel(ctx, { delete: "nope" })), undefined);
});

test("delete window: wording for none, one and several", async () => {
  const { ctx, addContact } = setup();
  const c1 = await addContact({ name: "Camille" });
  const none = await partner(ctx, "A");
  const one = await partner(ctx, "B", { entries: 1, contactIds: [c1] });
  const texts = async (id) => { const f = dialogOf(await panel(ctx, { delete: id })).fields.find((x) => x.name === "confirm"); return [f.label, f.help]; };
  assert.deepEqual(await texts(none), ["Delete this partner (it has no journal entry)", "Your address book is not changed."]);
  assert.deepEqual(await texts(one), ["Delete this partner and its 1 journal entry", "The linked contact stays in your address book."]);
  const { ctx: fr } = setup({ locale: "fr" });
  const p = await partner(fr, "Jeux Clair de Lune", { entries: 3 });
  const f = dialogOf(await panel(fr, { delete: p })).fields.find((x) => x.name === "confirm");
  assert.equal(f.label, "Supprimer ce partenaire et ses 3 entrées de journal");
});

test("deletePartner: refused without the tick (nothing is deleted), then deletes the file and ITS journal only, never a person of Contacts", async () => {
  const { ctx, bookCtx, logged, addContact } = setup();
  const c1 = await addContact({ name: "etoile_nord", email: "etoile@example.org" });
  const a = await partner(ctx, "Moonlight Games", { entries: 3, contactIds: [c1] });
  const b = await partner(ctx, "Other Brand", { entries: 2, contactIds: [c1] });
  for (const v of [{ id: a }, { id: a, confirm: "" }, { id: a, confirm: "off" }]) {
    assert.deepEqual(await def.adminActions.deletePartner(ctx, v), { error: "Tick the box to confirm the deletion." });
  }
  assert.equal(await ctx.api.store.count("partners"), 2);
  assert.equal(await ctx.api.store.count("journal"), 5);
  assert.deepEqual(await def.adminActions.deletePartner(ctx, { id: a, confirm: "on" }), { ok: "Moonlight Games was deleted. Its contacts stay in your address book.", redirect: "?" });
  assert.equal(await ctx.api.store.get(a), null);
  assert.equal(await ctx.api.store.count("journal"), 2, "the other partner keeps its entries");
  assert.ok(await ctx.api.store.get(b));
  assert.equal(await bookCtx.api.store.count("contacts"), 1, "the person is still in the address book");
  assert.equal((await ctx.api.store.get(b)).data.contactIds[0], c1, "and still linked to the other partner");
  assert.deepEqual(logged, [{ action: "partner.deleted", data: { journal: 3, contacts: 1 } }], "one log line, counts only");
  assert.ok(!JSON.stringify(logged).includes("Moonlight") && !JSON.stringify(logged).includes("etoile"));
});

test("deletePartner: an unknown id, or the id of a journal entry, deletes nothing", async () => {
  const { ctx, logged } = setup();
  const a = await partner(ctx, "Moonlight Games", { entries: 1 });
  const [entry] = await ctx.api.store.list("journal");
  for (const id of ["nope", entry.id, "", undefined, 42, "x".repeat(200)]) {
    assert.deepEqual(await def.adminActions.deletePartner(ctx, { id, confirm: "on" }), { error: "Not found." }, String(id));
  }
  assert.equal(await ctx.api.store.count("partners"), 1);
  assert.equal(await ctx.api.store.count("journal"), 1);
  assert.deepEqual(logged, []);
  assert.ok(await ctx.api.store.get(a));
});

test("deletePartner works when the log or the Contacts module is missing", async () => {
  const { ctx } = setup({ withBook: false });
  delete ctx.api.log;
  const a = await partner(ctx, "Moonlight Games", { entries: 1, contactIds: ["c1"] });
  assert.match((await def.adminActions.deletePartner(ctx, { id: a, confirm: "on" })).ok, /was deleted/);
  assert.equal(await ctx.api.store.count("journal"), 0);
  const boom = setup();
  boom.ctx.api.log = { write: async () => { throw new Error("log down"); } };
  const b = await partner(boom.ctx, "B");
  assert.match((await def.adminActions.deletePartner(boom.ctx, { id: b, confirm: "on" })).ok, /was deleted/);
});

test("MCP partner_delete: same function, counts returned, a journal entry id is refused, still off by default and destructive", async () => {
  const { ctx, bookCtx, logged, addContact } = setup();
  const c1 = await addContact({ name: "lune_douce" });
  const a = await partner(ctx, "Moonlight Games", { entries: 2, contactIds: [c1] });
  const [entry] = await ctx.api.store.list("journal");
  await assert.rejects(() => def.mcp.partner_delete(ctx, { id: entry.id }), (e) => e.expose && e.message === "partnership not found");
  assert.equal(await ctx.api.store.count("journal"), 2);
  assert.deepEqual(await def.mcp.partner_delete(ctx, { id: a }), { deleted: a, journalEntries: 2, contactLinks: 1 });
  assert.equal(await bookCtx.api.store.count("contacts"), 1);
  assert.equal(logged.length, 1);
  const tool = manifest.mcp.find((x) => x.name === "partner_delete");
  assert.deepEqual([tool.default, tool.destructive, tool.input.properties.id.maxLength], [false, true, 60]);
});

test("the pages obey the ergonomics rules (R4 field budget, wording, window with a way back), in English and in French", async () => {
  for (const locale of ["en", "fr"]) {
    const { ctx, addContact } = setup({ locale });
    const c1 = await addContact({ name: "Camille" });
    const a = await partner(ctx, "Jeux Clair de Lune", { entries: 3, contactIds: [c1] });
    for (let i = 0; i < 15; i++) await ctx.api.store.add("partners", { brand: `Marque ${i}`, status: i % 2 ? "envoye" : "publie" });
    for (const query of [{}, { new: "1" }, { edit: a }, { delete: a }, { partner: a }, { partner: a, edit: a }, { partner: a, log: "1" }, { partner: a, delete: a }]) {
      assertAdminPageErgonomics(await panel(ctx, query));
    }
  }
});

test("every wording variant of the deletion exists in both languages", () => {
  for (const lang of ["en", "fr"]) for (const base of ["deleteConfirm", "deleteKeep"]) for (const k of ["0", "1", "N"]) assert.ok(messages[lang][`${base}${k}`], `${lang}:${base}${k}`);
  assert.match(messages.en.deleteConfirmN, /\{n\}/);
  assert.match(messages.fr.deleteKeepN, /\{n\}/);
});

test("edit window (core 0.12.0): the delete button is a secondaryAction with a precise label and a confirm that says what is lost; the new window and the row menu are unchanged", async () => {
  const { ctx, addContact } = setup();
  const c1 = await addContact({ name: "etoile_nord" }), c2 = await addContact({ name: "lune_douce" });
  const a = await partner(ctx, "Moonlight Games", { entries: 12, contactIds: [c1, c2] });
  const edit = dialogOf(await panel(ctx, { edit: a }));
  assert.equal(edit.presentation, "dialog");
  assert.deepEqual(edit.secondaryAction, { label: "Delete the partner", action: "removePartner", confirm: "Delete this partner and its 12 journal entries? The 2 linked contacts stay in your address book." });
  assert.ok(def.adminActions[edit.secondaryAction.action], "the action exists");
  assert.equal(edit.submitLabel, "Save the partner", "the main button is still the save");
  assert.equal(dialogOf(await panel(ctx, { new: "1" })).secondaryAction, undefined, "nothing to delete in the new window");
  const none = dialogOf(await panel(ctx, { edit: await partner(ctx, "A") })).secondaryAction.confirm;
  assert.equal(none, "Delete this partner? It has no journal entry. Your address book is not changed.");
  const table = find(await panel(ctx, {}), "table")[0];
  assert.deepEqual(table.rowActions.at(-1).label, "Delete the partner", "the row menu keeps its deletion for cores older than 0.12.0");
  const { ctx: fr } = setup({ locale: "fr" });
  const p = await partner(fr, "Jeux Clair de Lune", { entries: 1 });
  const sa = dialogOf(await panel(fr, { edit: p })).secondaryAction;
  assert.equal(sa.label, "Supprimer le partenaire");
  assert.match(sa.confirm, /^Supprimer ce partenaire et son entrée de journal \?/);
});

test("removePartner: the core's confirmation box replaces the tick; it deletes the file and ITS journal only, never a person of Contacts, and an unknown id changes nothing", async () => {
  const { ctx, bookCtx, addContact } = setup();
  const c1 = await addContact({ name: "etoile_nord" });
  const a = await partner(ctx, "Moonlight Games", { entries: 3, contactIds: [c1] });
  await partner(ctx, "Other Brand", { entries: 2 });
  assert.deepEqual(await def.adminActions.removePartner(ctx, { id: "nope" }), { error: "Not found." });
  assert.equal(await ctx.api.store.count("partners"), 2);
  assert.deepEqual(await def.adminActions.removePartner(ctx, { id: a }), { ok: "Moonlight Games was deleted. Its contacts stay in your address book.", redirect: "?" });
  assert.equal(await ctx.api.store.get(a), null);
  assert.equal(await ctx.api.store.count("journal"), 2);
  assert.ok((await book.get(bookCtx, { id: c1 })), "the person stays in the address book");
});
