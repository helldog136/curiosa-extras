// Contacts 2.8.0 — the people who log in to the site (the core topic `core.user`) have a linked card.
// Covers: the sync (create, link an unambiguous e-mail, flag an ambiguous one, never twice), what follows the account (name, e-mail, role) and what stays the
// owner's, the deletion rules (a linked card is never deleted; a deleted account leaves an unlinked card with a note), an older core (nothing happens), the badge and
// notes of the administration, the export (an extra last column, the import ignores it), and privacy (nothing public, nothing new for the assistant tools).
// Only invented people (etoile_nord, lune_douce, Camille) and example.org addresses.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeCtx, def, B, D, C, svc, htmlOf, plain, collect, exportText, importAll } from "./helpers/contactsK2.mjs";
import { memStore } from "./helpers/contactsStore.mjs";

const A = await import("../modules/contacts/accounts.mjs");
const manifest = JSON.parse(fs.readFileSync(new URL("../modules/contacts/module.json", import.meta.url), "utf8"));

const NORD = { id: "acc_nord", name: "Etoile Nord", email: "etoile_nord@example.org", level: "owner", roles: ["Owner"], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const DOUCE = { id: "acc_douce", name: "Lune Douce", email: "lune_douce@example.org", level: "editor", roles: ["Editorial"], createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" };
const CAMILLE = { id: "acc_camille", name: "Camille", email: "camille@example.org", level: "none", roles: ["Moderation"], createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z" };
const PERMISSIONS = ["admin", "storage", "mcp", "topics"];

/** A Contacts context whose `core.user` topic answers `world.accounts` (change it between two syncs, like the accounts of a real site). */
function setup({ accounts = [NORD, DOUCE], store = memStore(), locale = "en", ...rest } = {}) {
  const world = { accounts: [...accounts] };
  const ctx = makeCtx({ store, locale, permissions: PERMISSIONS, topics: { "core.user": () => world.accounts }, ...rest });
  return { ctx, world, store };
}
const all = async (ctx) => (await svc.list(ctx, {})).items;
const sync = (ctx, opts) => A.syncAccounts(ctx, { force: true, ...opts });
const dataOf = async (ctx, id) => (await B.get(ctx, { id })).record.data;
const linkedCards = async (ctx) => { const out = []; for (const c of await all(ctx)) { const d = await dataOf(ctx, c.id); if (d.account) out.push({ ...c, data: d }); } return out; };
const writesOf = (ctx) => ctx.calls.writes.length;
const notesOf = async (ctx, id) => (await B.get(ctx, { id })).notes.map((n) => n.text);

test("sync : a new account gets a card (name, e-mail, link), a second sync changes nothing and writes nothing", async () => {
  const { ctx } = setup();
  const first = await sync(ctx);
  assert.deepEqual([first.state, first.created, first.linked, first.updated, first.unlinked, first.flagged], ["ok", 2, 0, 0, 0, 0]);
  const cards = await linkedCards(ctx);
  assert.deepEqual(cards.map((c) => c.name).sort(), ["Etoile Nord", "Lune Douce"]);
  const nord = cards.find((c) => c.name === "Etoile Nord");
  assert.equal(nord.email, "etoile_nord@example.org");
  assert.equal(nord.source, "account");
  assert.equal(nord.status, "active");
  assert.equal(nord.role, null, "the function of the card is the owner's: the account role is the badge, not a function");
  assert.deepEqual({ ...nord.data.account, at: "x" }, { id: "acc_nord", name: "Etoile Nord", email: "etoile_nord@example.org", level: "owner", roles: ["Owner"], at: "x" });
  const writes = writesOf(ctx);
  const again = await sync(ctx);
  assert.deepEqual([again.created, again.linked, again.updated, again.unlinked, again.flagged], [0, 0, 0, 0, 0]);
  assert.equal(writesOf(ctx), writes, "a sync with nothing to do writes nothing");
  assert.equal((await all(ctx)).length, 2, "never a duplicate");
});

test("sync : an existing card with the same e-mail is LINKED, and only the link is added (nothing else of the card moves)", async () => {
  const { ctx } = setup({ accounts: [NORD] });
  const made = await svc.create(ctx, { name: "Nord, ma voisine", email: "ETOILE_NORD@example.org", role: "Illustratrice", organisation: "Atelier", relation: "Amie", others: "twitch.tv/etoile_nord" });
  await B.note(ctx, { id: made.id, text: "Une note à moi.", author: "admin" });
  const before = await dataOf(ctx, made.id);
  const r = await sync(ctx);
  assert.deepEqual([r.linked, r.created, r.flagged], [1, 0, 0]);
  const after = await dataOf(ctx, made.id);
  const { account, ...rest } = after;
  assert.deepEqual(rest, before, "every other field is exactly as it was");
  assert.equal(account.id, "acc_nord");
  assert.equal((await all(ctx)).filter((c) => c.kind === "person").length, 1, "no extra person card (the organisation card comes from the form)");
  assert.deepEqual(await notesOf(ctx, made.id), ["Une note à moi."], "no note added by a plain link");
  assert.equal((await sync(ctx)).linked, 0, "idempotent");
});

test("sync : an ambiguous e-mail (two cards, an organisation, a card of another account) creates a flagged card, merges nothing, changes nothing", async () => {
  const { ctx, world } = setup({ accounts: [NORD] });
  // Two person cards with the same e-mail (older data: the store key is not unique).
  const one = await svc.create(ctx, { name: "Nord un", email: "etoile_nord@example.org" });
  const store = ctx.api.store;
  const twinId = await store.add("contacts", { kind: "person", name: "Nord deux", status: "active", source: "manual", role: "", email: "etoile_nord@example.org", phone: "", others: "", relation: "", orgId: null, categoryIds: [], accounts: [], photo: null }, { key: "e:etoile_nord@example.org" });
  D.forgetIndex(ctx);
  const snapshot = JSON.stringify([await dataOf(ctx, one.id), await dataOf(ctx, twinId)]);
  const r = await sync(ctx);
  assert.deepEqual([r.created, r.linked, r.flagged], [1, 0, 1]);
  assert.equal(JSON.stringify([await dataOf(ctx, one.id), await dataOf(ctx, twinId)]), snapshot, "the existing cards are untouched");
  const [created] = await linkedCards(ctx);
  assert.equal(created.status, "to_review");
  assert.equal(created.data.account.flag, "email_shared");
  assert.equal(created.email, "etoile_nord@example.org", "it keeps the e-mail so the duplicates page finds the three");
  assert.equal((await notesOf(ctx, created.id)).length, 1);
  assert.equal((await sync(ctx)).flagged, 0, "flagged once");
  assert.equal((await all(ctx)).length, 3);
  void world;
});

test("sync : an organisation that has the e-mail is never linked; a card already linked to another account is not taken", async () => {
  const { ctx } = setup({ accounts: [NORD, DOUCE] });
  await svc.create(ctx, { name: "Atelier Nord", kind: "org", email: "etoile_nord@example.org" });
  const r = await sync(ctx);
  assert.deepEqual([r.created, r.linked, r.flagged], [2, 0, 1], "NORD is flagged (the only card with its e-mail is an organisation), DOUCE gets a plain card");
  const flagged = (await linkedCards(ctx)).find((c) => c.data.account.flag);
  assert.equal(flagged.data.account.id, "acc_nord");
  const orgs = (await all(ctx)).filter((c) => c.kind === "org");
  assert.equal(orgs.length, 1);
  assert.equal(orgs[0].orgName ?? null, null);
  assert.ok(!(await dataOf(ctx, orgs[0].id)).account, "an organisation never carries a link");
});

test("sync : an account of the site that is renamed or changes e-mail or role updates the linked card; what the owner edited stays until the account changes", async () => {
  const { ctx, world } = setup({ accounts: [NORD, DOUCE] });
  await sync(ctx);
  const card = (name) => linkedCards(ctx).then((l) => l.find((c) => c.name === name));
  const douce = await card("Lune Douce");
  // The owner renames the card and adds data of their own.
  await B.update(ctx, { id: douce.id, name: "Lune (ma voisine)", role: "Illustratrice" });
  await B.note(ctx, { id: douce.id, text: "Note perso.", author: "admin" });
  assert.equal((await sync(ctx)).updated, 0, "no account change: the owner's name stays");
  assert.equal((await dataOf(ctx, douce.id)).name, "Lune (ma voisine)");
  // The account changes: name, e-mail and role.
  world.accounts = [NORD, { ...DOUCE, name: "Lune Douce-Nord", email: "lune_nord@example.org", level: "admin", roles: ["Administration"] }];
  const r = await sync(ctx);
  assert.equal(r.updated, 1);
  const after = await dataOf(ctx, douce.id);
  assert.equal(after.name, "Lune Douce-Nord");
  assert.equal(after.email, "lune_nord@example.org");
  assert.equal(after.account.level, "admin");
  assert.equal(after.role, "Illustratrice", "the function is not the account role: never overwritten");
  assert.deepEqual(await notesOf(ctx, douce.id), ["Note perso."], "notes stay the owner's");
  assert.equal((await svc.find(ctx, { email: "lune_nord@example.org" })).total, 1, "the card is found by its new e-mail");
  assert.equal((await svc.find(ctx, { email: "lune_douce@example.org" })).total, 0, "and no longer by the old one");
  assert.equal((await sync(ctx)).updated, 0);
});

test("sync : a new e-mail already on ANOTHER card keeps the card's e-mail, flags it once, and asks for a merge", async () => {
  const { ctx, world } = setup({ accounts: [NORD, DOUCE] });
  await sync(ctx);
  const other = await svc.create(ctx, { name: "Quelqu'un d'autre", email: "partage@example.org" });
  world.accounts = [NORD, { ...DOUCE, email: "partage@example.org" }];
  const r = await sync(ctx);
  assert.deepEqual([r.updated, r.flagged], [1, 1]);
  const douce = (await linkedCards(ctx)).find((c) => c.data.account.id === "acc_douce");
  assert.equal(douce.email, "lune_douce@example.org");
  assert.equal(douce.status, "to_review");
  assert.equal(douce.data.account.flag, "email_shared");
  assert.equal((await dataOf(ctx, other.id)).email, "partage@example.org", "the other card is untouched");
  const writes = writesOf(ctx);
  assert.deepEqual([(await sync(ctx)).updated, writesOf(ctx)], [0, writes], "flagged once, then quiet");
});

test("deletion : a linked card cannot be deleted, by any way in (administration, privacy page, service, assistant); nothing else is told to forget it", async () => {
  const { ctx } = setup({ accounts: [NORD] });
  await sync(ctx);
  const [nord] = await linkedCards(ctx);
  const asked = [];
  const quiet = makeCtx({ store: ctx.api.store, permissions: PERMISSIONS, subjects: [{ instance: "raid-one", name: "Raid", methods: { erase: () => { asked.push("erase"); return { removed: 1 }; }, remap: () => ({}), export: () => ({ label: "Raid", data: {} }) } }] });
  quiet.instance = ctx.instance;
  assert.equal((await B.erase(quiet, { id: nord.id, confirm: true })).error, "account_linked");
  assert.equal((await B.deleteContact(ctx, nord.id)).error, "account_linked");
  assert.equal((await svc.erase(quiet, { id: nord.id, confirm: true })).error, "account_linked");
  await assert.rejects(() => def.mcp.contact_delete(ctx, { id: nord.id }), /login account.*cannot be deleted/);
  const done = await def.adminActions.remove(ctx, { id: nord.id });
  assert.match(done.error, /cannot be deleted/);
  const erase = await def.adminActions.erase(ctx, { id: nord.id, confirm: "on" });
  assert.match(erase.error, /cannot be deleted/);
  assert.deepEqual(asked, [], "the other modules were not asked to forget the person");
  assert.ok((await B.get(ctx, { id: nord.id })).ok, "the card is still there");
  const page = plain(await def.adminPanel(ctx, { query: { contact: nord.id, erase: "1" } }));
  assert.match(page, /cannot be deleted/);
  assert.match(page, /href=\\"\/admin\/users\\"/, "the refusal page links to the Team page, where the account is removed");
  assert.ok(!page.includes('"action":"erase"'), "no erase form on a linked card");
});

test("deletion : when the account is deleted the card stays, unlinked, with a note and a banner, and can then be deleted", async () => {
  const { ctx, world } = setup({ accounts: [NORD, DOUCE] });
  await sync(ctx);
  world.accounts = [NORD];
  const r = await sync(ctx);
  assert.equal(r.unlinked, 1);
  const cards = await all(ctx);
  assert.equal(cards.length, 2, "the card stays");
  const gone = cards.find((c) => c.name === "Lune Douce");
  const data = await dataOf(ctx, gone.id);
  assert.ok(!data.account, "unlinked");
  assert.ok(data.accountGone, "remembers when");
  assert.deepEqual(await notesOf(ctx, gone.id), ["Login account deleted: this card is no longer linked."]);
  assert.equal(gone.email, "lune_douce@example.org", "its own data is kept");
  assert.match(plain(await def.adminPanel(ctx, { query: { contact: gone.id } })), /was deleted on .* no longer linked/);
  assert.equal((await sync(ctx)).unlinked, 0, "once");
  assert.equal((await B.deleteContact(ctx, gone.id)).ok, true, "now an ordinary card");
});

test("deletion : an empty answer (older core, nothing readable) or a cut list never unlinks anybody", async () => {
  const { ctx, world } = setup({ accounts: [NORD, DOUCE] });
  await sync(ctx);
  world.accounts = [];
  assert.deepEqual(await sync(ctx), { state: "unsupported" });
  assert.equal((await linkedCards(ctx)).length, 2);
  // A list as long as the limit may be cut: an account missing from it is not proven gone.
  const filler = Array.from({ length: A.LIMIT }, (_, i) => ({ id: `acc_x${i}`, name: `Personne ${i}`, email: `p${i}@example.org`, level: "editor", roles: [] }));
  world.accounts = filler;
  const r = await sync(ctx);
  assert.equal(r.unlinked, 0);
  assert.equal((await linkedCards(ctx)).filter((c) => ["acc_nord", "acc_douce"].includes(c.data.account.id)).length, 2);
});

test("older core : the topic does not exist (empty answer) or ctx.api.topics is missing or the read fails: nothing is written, nothing breaks", async () => {
  const empty = makeCtx({ permissions: PERMISSIONS, topics: {} });
  assert.deepEqual(await sync(empty), { state: "unsupported" });
  assert.equal((await all(empty)).length, 0);
  assert.equal(writesOf(empty), 0);
  const noTopics = makeCtx({ permissions: PERMISSIONS });
  delete noTopics.api.topics;
  assert.deepEqual(await sync(noTopics), { state: "unsupported" });
  const failing = makeCtx({ permissions: PERMISSIONS, topics: { "core.user": () => { throw new Error("core fell"); } } });
  assert.deepEqual(await sync(failing), { state: "error" });
  assert.equal(writesOf(failing), 0);
  // The panel and the task keep working.
  assert.ok(Array.isArray(await def.adminPanel(failing, { query: {} })));
  await def.tasks.accounts.run(failing);
  await def.tasks.accounts.run(empty);
});

test("sync : whatever the core says is checked again (bad ids, bad e-mails, long texts, wrong level, duplicates)", () => {
  const out = A.cleanAccounts([
    { id: "a1", name: "  Camille  ", email: "CAMILLE@Example.org", level: "owner", roles: ["Owner", 3, "x".repeat(200)] },
    { id: "a1", name: "Doublon", email: "dup@example.org" },
    { id: "", name: "Sans id", email: "x@example.org" },
    { id: "a2", name: "", email: "etoile@example.org", level: "root" },
    { id: "a3", name: "Sans e-mail", email: "pas-un-email", level: "admin" },
    null, "texte", { id: "a4" },
  ]);
  assert.deepEqual(out.map((a) => [a.id, a.name, a.email, a.level]), [["a1", "Camille", "camille@example.org", "owner"], ["a2", "etoile", "etoile@example.org", "none"], ["a3", "Sans e-mail", "", "admin"]]);
  assert.equal(out[0].roles.length, 2);
  assert.ok(out[0].roles.every((r) => r.length <= 60));
  assert.deepEqual(A.cleanAccounts("nope"), []);
});

test("sync : an account without a usable e-mail still gets a card; the same account never twice, even in two runs at once", async () => {
  const { ctx } = setup({ accounts: [{ ...CAMILLE, email: "" }] });
  const [x, y] = await Promise.all([A.syncAccounts(ctx, { force: true }), A.syncAccounts(ctx, { force: true })]);
  assert.equal(x, y, "one run shared");
  assert.equal(x.created, 1);
  const [c] = await linkedCards(ctx);
  assert.equal(c.email, null);
  assert.equal((await sync(ctx)).created, 0);
});

test("sync : the account comes back with the same e-mail after being deleted: the unlinked card is linked again (no duplicate)", async () => {
  const { ctx, world } = setup({ accounts: [NORD, DOUCE] });
  await sync(ctx);
  world.accounts = [NORD];
  await sync(ctx);
  world.accounts = [NORD, { ...DOUCE, id: "acc_douce_2" }];
  const r = await sync(ctx);
  assert.deepEqual([r.linked, r.created], [1, 0]);
  const back = (await linkedCards(ctx)).find((c) => c.data.account.id === "acc_douce_2");
  assert.ok(back && !back.data.accountGone);
  assert.equal((await all(ctx)).length, 2);
});

test("merge : a linked card that is merged into another passes its link on; two linked cards are never merged", async () => {
  const { ctx } = setup({ accounts: [NORD, DOUCE] });
  const mine = await svc.create(ctx, { name: "Nord à moi" });
  await sync(ctx);
  const [nord, douce] = (await linkedCards(ctx)).sort((a, b) => a.data.account.id.localeCompare(b.data.account.id)).reverse();
  assert.equal((await B.merge(ctx, { keep: nord.id, drop: douce.id })).error, "both_linked");
  const r = await B.merge(ctx, { keep: mine.id, drop: nord.id });
  assert.equal(r.ok, true);
  const kept = await dataOf(ctx, mine.id);
  assert.equal(kept.account.id, nord.data.account.id, "the link followed the merge");
  assert.equal((await B.deleteContact(ctx, mine.id)).error, "account_linked");
  assert.equal((await sync(ctx)).updated, 0);
});

test("administration : the badge « Account · role » is in the list (coloured and written) and on the card; a filter keeps only the accounts", async () => {
  const { ctx } = setup({ accounts: [NORD, CAMILLE] });
  await svc.create(ctx, { name: "Un contact" });
  const blocks = await def.adminPanel(ctx, { query: {} });
  const table = blocks.find((b) => b.type === "table");
  const col = table.columns.indexOf("Login account");
  assert.ok(col > 0, "the column exists because a row needs it");
  const cells = table.rows.map((r) => r[col]);
  assert.ok(cells.some((c) => c && c.badge === "info" && c.text === "Account · Owner"));
  assert.ok(cells.some((c) => c && c.text === "Account · Moderation"), "an account with only a custom role shows that role");
  assert.ok(cells.some((c) => c === ""), "a plain contact has an empty cell");
  assert.match(plain(blocks), /Login accounts \(2\)/);
  const only = (await def.adminPanel(ctx, { query: { acc: "1" } })).find((b) => b.type === "table");
  assert.equal(only.rows.length, 2);
  const nord = (await linkedCards(ctx)).find((c) => c.data.account.id === "acc_nord");
  const card = plain(await def.adminPanel(ctx, { query: { contact: nord.id } }));
  assert.match(card, /Account · Owner/);
  assert.match(card, /href=\\"\/admin\/users\\"/);
  assert.match(card, /cannot be deleted/);
});

test("administration : without any linked card, the list and the card look exactly as before (no empty column, no badge)", async () => {
  const ctx = makeCtx({ permissions: PERMISSIONS, topics: {} });
  const made = await svc.create(ctx, { name: "Un contact", email: "un@example.org" });
  const list = (await def.adminPanel(ctx, { query: {} })).find((b) => b.type === "table");
  assert.ok(!list.columns.includes("Login account"));
  assert.ok(!plain(await def.adminPanel(ctx, { query: { contact: made.id } })).includes("Account ·"));
  assert.ok(!plain(await def.adminPanel(ctx, { query: {} })).includes("Login accounts"));
});

test("administration : opening the address book looks at the accounts (at most every few seconds, never blocking); the flagged card says what to do", async () => {
  const { ctx } = setup({ accounts: [NORD] });
  assert.equal((await all(ctx)).length, 0);
  await def.adminPanel(ctx, { query: {} });
  assert.equal((await all(ctx)).length, 1, "the account has its card as soon as the book opens");
  const reads = ctx.calls.topics.length;
  await def.adminPanel(ctx, { query: {} });
  assert.equal(ctx.calls.topics.length, reads, "throttled");
  const dup = setup({ accounts: [NORD] });
  await svc.create(dup.ctx, { name: "A", email: NORD.email });
  await svc.create(dup.ctx, { name: "B", email: "autre@example.org" });
  const twin = await dup.ctx.api.store.add("contacts", { kind: "person", name: "A bis", status: "active", source: "manual", role: "", email: NORD.email, phone: "", others: "", relation: "", orgId: null, categoryIds: [], accounts: [], photo: null }, { key: `e:${NORD.email}` });
  D.forgetIndex(dup.ctx);
  void twin;
  await sync(dup.ctx);
  const flagged = (await linkedCards(dup.ctx))[0];
  const page = plain(await def.adminPanel(dup.ctx, { query: { contact: flagged.id } }));
  assert.match(page, /already on another card\. Merge the two cards/);
  assert.match(page, /See duplicates/);
});

test("task : the task reads the accounts every few minutes and never fails; it forces the read", async () => {
  assert.equal(typeof def.tasks.accounts.run, "function");
  assert.ok(def.tasks.accounts.everyMinutes >= 1 && def.tasks.accounts.everyMinutes <= 15);
  const { ctx } = setup({ accounts: [NORD] });
  await def.tasks.accounts.run(ctx);
  await def.tasks.accounts.run(ctx);
  assert.equal((await all(ctx)).length, 1, JSON.stringify((await all(ctx)).map((c) => [c.name, c.kind, c.email])));
  assert.ok(ctx.calls.topics.length >= 2, "forced: not throttled");
  assert.deepEqual(ctx.calls.topics[0], ["core.user", { limit: A.LIMIT }]);
});

test("export : one extra last column « site account » (older columns keep their place); a linked card carries its role, the import ignores the column", async () => {
  const { ctx } = setup({ accounts: [NORD] });
  await svc.create(ctx, { name: "Un contact", email: "un@example.org" });
  await sync(ctx);
  const text = await exportText(ctx);
  const [head, ...lines] = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const cols = head.split(",");
  assert.equal(cols[cols.length - 1], "site account");
  assert.deepEqual(cols.slice(0, 15), ["name", "type", "role", "organisation", "email", "phone", "accounts", "categories", "notes", "status", "relation", "others", "photo", "source", "id"]);
  assert.ok(lines.some((l) => l.endsWith(',Owner')), "the linked card says Owner");
  assert.ok(lines.some((l) => l.endsWith(",")), "the other one is empty");
  assert.equal(C.readHeader(cols).map.siteAccount, cols.length - 1, "known to the import");
  const fresh = makeCtx({ permissions: PERMISSIONS, topics: {} });
  const imported = await importAll(fresh, text);
  assert.ok(imported, "an exported file is still accepted");
  for (const c of await all(fresh)) assert.ok(!(await dataOf(fresh, c.id)).account, "an import never creates a link");
});

test("backup : the readable backup keeps its columns and adds the role at the end", async () => {
  const { ctx } = setup({ accounts: [NORD] });
  await sync(ctx);
  const files = await def.backup.readable(ctx);
  const csv = files.find((f) => f.path === "contacts.csv").content.replace(/^\uFEFF/, "").split("\r\n");
  assert.equal(csv[0].split(",").pop(), '"site_account"');
  assert.ok(csv[1].endsWith('"Owner"'));
});

test("privacy : nothing new is public and nothing new is handed to other modules or to the assistant", async () => {
  // No public surface: no page, section, slot, route, overlay, feed, link, export of a topic.
  for (const k of ["page", "sections", "slots", "routes", "overlay", "exports", "filters"]) assert.equal(def[k], undefined, `no ${k}`);
  assert.equal(manifest.page, false);
  assert.deepEqual(manifest.provides ?? [], []);
  const { ctx } = setup({ accounts: [NORD, DOUCE] });
  await sync(ctx);
  const [nord] = await linkedCards(ctx);
  // The card as the other modules see it, and the assistant tools without the private right: no account marker, no level, no flag, no e-mail.
  // `source: "account"` (where the card came from, like "partnerships" or "manual") is the one visible trace: no id, level, role or flag.
  const view = JSON.stringify([(await svc.get(ctx, { id: nord.id })), await svc.list(ctx, {}), await svc.search(ctx, { q: "nord" }), await svc.resolve(ctx, { ids: [nord.id] })]);
  assert.ok(!/"account":|accountGone|email_shared|"level"|acc_nord/.test(view.replace(nord.email ?? "", "")), `service views carry no account marker: ${view.match(/.{40}("account":|accountGone|email_shared|"level"|acc_nord).{40}/)?.[0]}`);
  const assistant = JSON.stringify([await def.mcp.contacts_list(ctx, {}), await def.mcp.contact_get(ctx, { id: nord.id })]);
  assert.ok(!/etoile_nord@example\.org|"account"|acc_nord|"level"/.test(assistant), "no e-mail, no link detail for the assistant without the private right");
  const priv = JSON.stringify(await def.mcp.contact_get_private(ctx, { id: nord.id }));
  assert.ok(priv.includes("etoile_nord@example.org") && !/acc_nord|"account"/.test(priv), "the private tool is as it was: the e-mail, not the link");
  // The grants of the assistant tools are unchanged.
  const byName = Object.fromEntries(manifest.mcp.map((t) => [t.name, t]));
  assert.equal(byName.contact_get_private.default, false);
  for (const w of ["contact_create", "contact_update", "contact_note", "contact_add_account", "contact_delete"]) assert.equal(byName[w].default, false, w);
  for (const r of ["contacts_list", "contact_get", "contact_categories"]) assert.equal(byName[r].readOnly, true, r);
  // An assistant can still write to a linked card like to any card (explicit grants), but not delete it.
  assert.deepEqual(await def.mcp.contact_note(ctx, { id: nord.id, text: "Rappeler." }, { name: "assistant" }), { id: nord.id });
  await assert.rejects(() => def.mcp.contact_delete(ctx, { id: nord.id }), /cannot be deleted/);
  // The person export (privacy page) keeps its fields: no link detail is added.
  const person = JSON.parse((await collect(def.adminDownloads.person.generate(ctx, { id: nord.id }))).join(""));
  assert.ok(!JSON.stringify(person.contacts).includes("acc_nord"));
});

test("wiring : the manifest consumes the core topic with the topics permission and does not raise minCore; the texts are in both languages", () => {
  const decl = manifest.consumes.find((c) => c.topic === "core.user");
  assert.ok(decl, "consumes core.user");
  assert.deepEqual(decl.schema.map((f) => f.key), ["id", "name", "email", "level", "roles", "createdAt", "updatedAt"]);
  assert.ok(manifest.permissions.includes("topics"));
  assert.equal(manifest.minCore, "0.38.0", "an older core still runs the module (the topic is optional)");
  assert.equal(manifest.version, "2.8.0");
  const en = JSON.parse(fs.readFileSync(new URL("../modules/contacts/locales/en.json", import.meta.url), "utf8"));
  const fr = JSON.parse(fs.readFileSync(new URL("../modules/contacts/locales/fr.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of Object.keys(en).filter((x) => x.startsWith("acc") || x === "colLogin" || x === "filterAccounts" || x === "source_account")) assert.equal(vars(en[k]), vars(fr[k]), k);
  for (const l of ["owner", "coordinator", "admin", "editor", "none"]) assert.ok(en[`accLevel_${l}`] && fr[`accLevel_${l}`]);
});

test("the French administration says the same things", async () => {
  const { ctx } = setup({ accounts: [NORD], locale: "fr" });
  await def.adminPanel(ctx, { query: {} });
  const [nord] = await linkedCards(ctx);
  const page = plain(await def.adminPanel(ctx, { query: { contact: nord.id } }));
  assert.match(page, /Compte · Propriétaire/);
  assert.match(page, /ne peut pas être supprimée/);
});
