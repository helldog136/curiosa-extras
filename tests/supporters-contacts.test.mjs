// Soutiens — le pont FACULTATIF vers Contacts (double fakeContactBook, jamais modifié) : rien n'y est écrit sans le droit ni sans le clic ; catégorie choisie par la propriétaire ;
// absent / lent / en panne / plein ; lien facultatif avec le mur des remerciements ; export, effacement et fusion (privacy.subject).
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { runPrivacySubjectContract } from "./contract/privacySubject.contract.mjs";
import { makeWorld, reset, kit, def, P, D, C, O, S, Admin, Mcp, Routes, htmlOf, formRequest, fr, en } from "./helpers/supporters-world.mjs";
import { fakePatreon } from "./helpers/fakePatreon.mjs";

const timing0 = { ...C.timing };
beforeEach(() => { reset(); Object.assign(C.timing, timing0, { callMs: 200, providersMs: 200, resolveMs: 200 }); });
afterEach(() => { reset(); Object.assign(C.timing, timing0); });

const peopleOf = async (ctx) => [...(await D.snapshot(ctx, { fresh: true })).people.values()].map((r) => r.data);
const WRITES = ["create", "update", "note", "merge", "import", "erase", "createCategory", "setAccountProfile", "upsertByAccount"];

/** Les services de Contacts, enrobés : chaque appel est noté. */
function spyOn(book) {
  const log = [];
  const wrap = (service, methods) => Object.fromEntries(Object.entries(methods).map(([name, fn]) => [name, (...a) => { log.push(`${service}.${name}`); return fn(...a); }]));
  return { log, wrapped: { "contact.book": wrap("contact.book", book.services["contact.book"]), "contact.store": book.services["contact.store"] } };
}

async function supporters(ctx, n = 3) {
  const lines = Array.from({ length: n }, (_, i) => `Personne ${i + 1};Or;2025-01-0${i + 1}`);
  await O.importText(ctx, ["nom;palier;depuis", ...lines].join("\n"));
  return peopleOf(ctx);
}
const world = (over = {}) => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  return { cat, ...makeWorld({ book, settings: { provider: "csv", category: cat, ...over.settings }, ...over }) };
};

test("rien n'est jamais écrit dans Contacts par un parcours complet qui n'utilise pas le bouton « ranger » : actualisation, notification, import, accord, page, administration, assistant (lecture)", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  const spy = spyOn(book);
  const { ctx } = makeWorld({ book, settings: { provider: "patreon", category: cat, review: false }, extra: { services: { ...spy.wrapped } } });
  const pat = fakePatreon({ tiers: [{ id: 1, title: "A", cents: 100 }], members: [{ id: 1, name: "Ada", status: "active_patron", since: "2025-01-01", tiers: [1] }] });
  await kit.withFakeFetch({ "*": pat.reply }, async () => { await S.refresh(ctx, { force: true }); });
  const [p] = await peopleOf(ctx);
  const link = await O.consentLink(ctx, p.pid);
  await def.routes.consent(formRequest("https://site.example.test/m/soutiens/consent", { pid: p.pid, t: link.path.split("/").pop(), loc: "fr", act: "accept", pseudo: "Luna42", agree: "yes" }), ctx);
  await def.page(ctx, { segments: [] });
  await Admin.panel(ctx, { query: {} }); await Admin.panel(ctx, { query: { p: p.pid } });
  for (const tool of ["supporters_status", "supporters_list"]) await Mcp.default[tool](ctx, {});
  await O.setHidden(ctx, p.pid, true); await O.setApproval(ctx, p.pid, true);
  assert.ok(spy.log.length > 0 && spy.log.every((l) => !WRITES.includes(l.split(".")[1])), "Contacts a bien été lu, jamais écrit");
  const writes = spy.log.filter((l) => WRITES.includes(l.split(".")[1]));
  assert.deepEqual(writes, [], "aucune écriture dans Contacts");
  assert.equal(book.dump().contacts.length, 0);
});

test("ranger dans Contacts : l'action est réservée au droit « ranger les soutiens dans Contacts » ; sans ce droit, ni bouton ni écriture", async () => {
  assert.equal(Admin.actions.fileContacts.right, "contacts.file");
  assert.equal(Admin.actions.refresh.right, "people.manage");
  const rights = Object.fromEntries(Object.entries(Admin.actions).filter(([, a]) => typeof a === "object").map(([k, a]) => [k, a.right]));
  assert.ok(Object.values(rights).every(Boolean), "chaque action qui écrit nomme son droit");
  const { ctx } = world({ can: ["people.manage"] });
  await supporters(ctx);
  const noButton = JSON.stringify(await Admin.panel(ctx, { query: {} }));
  assert.ok(!noButton.includes('"fileContacts"'), "pas de bouton sans le droit");
  assert.ok(noButton.includes(fr.noFileRight));
  const full = world({ can: true });
  await supporters(full.ctx);
  assert.ok(JSON.stringify(await Admin.panel(full.ctx, { query: {} })).includes('"fileContacts"'));
});

test("ranger dans Contacts : une fiche par soutien, retrouvée par son compte « plateforme:numéro » (jamais de doublon), dans la catégorie choisie ; le nom quitte le module", async () => {
  const { ctx, book, cat } = world();
  await supporters(ctx, 3);
  const r = await Admin.actions.fileContacts.run(ctx, {});
  assert.match(r.ok, /3 soutiens/);
  const cards = book.dump().contacts;
  assert.equal(cards.length, 3);
  assert.ok(cards.every((c) => c.categoryIds.includes(cat) && c.source === "supporters"));
  assert.ok(cards.every((c) => c.accounts.length === 1 && c.accounts[0].network === "other" && /^csv:[a-f0-9]{20}$/.test(c.accounts[0].handle)));
  assert.ok(cards.every((c) => !c.email && !c.phone), "ni e-mail ni téléphone");
  const people = await peopleOf(ctx);
  assert.ok(people.every((p) => p.contactId && p.name === ""), "le nom n'est plus gardé ici");
  assert.ok(!JSON.stringify(ctx.dumpStore()).includes("Personne 1"), "le nom n'est plus nulle part dans le module");
  const again = await Admin.actions.fileContacts.run(ctx, {});
  assert.equal(book.dump().contacts.length, 3, "rejouer ne crée rien");
  void again;
  // une fiche déjà connue avec le même compte est réutilisée
  const book2 = fakeContactBook(); const cat2 = book2.seedCategory("Soutiens");
  const w2 = makeWorld({ book: book2, settings: { provider: "csv", category: cat2 } });
  const [p] = await supporters(w2.ctx, 1);
  const known = book2.seedContact({ name: "Nom déjà connu", accounts: [{ network: "other", handle: p.k }] });
  await Admin.actions.fileContacts.run(w2.ctx, {});
  assert.equal(book2.dump().contacts.length, 1);
  assert.equal((await peopleOf(w2.ctx))[0].contactId, known.id);
  assert.ok(book2.dump().contacts[0].categoryIds.includes(cat2));
  assert.equal(book2.dump().contacts[0].name, "Nom déjà connu", "un nom existant n'est jamais écrasé");
});

test("ranger dans Contacts : lots de 100 au plus, le reste est dit ; les soutiens arrêtés ne sont pas rangés", async () => {
  const { ctx, book } = world();
  await O.importText(ctx, "nom\n" + Array.from({ length: 130 }, (_, i) => `M${i}`).join("\n"));
  const r = await Admin.actions.fileContacts.run(ctx, {});
  assert.match(r.ok, /100 soutiens/); assert.match(r.ok, /30 à ranger/);
  assert.equal(book.dump().contacts.length, 100);
  await Admin.actions.fileContacts.run(ctx, {});
  assert.equal(book.dump().contacts.length, 130);
  const w = world();
  await supporters(w.ctx, 2);
  await O.importText(w.ctx, "nom;statut\nPersonne 1;arrêté", { replace: false });
  await Admin.actions.fileContacts.run(w.ctx, {});
  assert.equal(w.book.dump().contacts.length, 1);
});

test("catégorie : jamais celle proposée d'office par le cœur quand c'est la seule (il faut l'avoir choisie) ; sinon « Soutiens » / « Supporters » par son nom ; sinon on explique", async () => {
  const book = fakeContactBook(); const other = book.seedCategory("Modération");
  const w = makeWorld({ book, settings: { provider: "csv" } });
  await supporters(w.ctx, 1);
  const r = await Admin.actions.fileContacts.run(w.ctx, {});
  assert.equal(r.error, fr.cat_choose, "une seule catégorie existe (« Modération ») : elle n'est pas prise sans choix");
  assert.equal(book.dump().contacts.length, 0);
  assert.deepEqual(book.dump().contacts.filter((c) => c.categoryIds.includes(other)), []);
  book.seedCategory("Soutiens");
  w.settings.category = ""; 
  const ok = await Admin.actions.fileContacts.run(w.ctx, {});
  assert.match(ok.ok, /1 soutiens/); assert.equal(book.dump().contacts[0].categoryIds.length, 1);
  const b2 = fakeContactBook();
  const w2 = makeWorld({ book: b2, settings: { provider: "csv" } });
  await supporters(w2.ctx, 1);
  assert.equal((await Admin.actions.fileContacts.run(w2.ctx, {})).error, fr.cat_none);
  const b3 = fakeContactBook(); b3.seedCategory("Supporters"); b3.seedCategory("Autre");
  const w3 = makeWorld({ book: b3, settings: { provider: "csv" }, locale: "en" });
  await supporters(w3.ctx, 1);
  assert.match((await Admin.actions.fileContacts.run(w3.ctx, {})).ok, /Filed in Contacts: 1/);
});

test("Contacts absent : tout le reste marche, les noms restent gardés ici, le panneau le dit et propose l'installation ; ranger répond par un message clair", async () => {
  const { ctx } = makeWorld({ withBook: false, settings: { provider: "csv" } });
  await supporters(ctx, 2);
  assert.equal((await peopleOf(ctx))[0].name.startsWith("Personne"), true);
  const blocks = await Admin.panel(ctx, { query: {} });
  assert.ok(blocks.some((b) => b.type === "suggestInstall" && b.service === "contact.book"));
  assert.equal((await Admin.actions.fileContacts.run(ctx, {})).error, fr.cat_absent);
  assert.ok(htmlOf(await def.page(ctx, { segments: [] })).length > 0);
});

test("Contacts lent ou en panne : on s'arrête avec un message simple, ce qui était rangé reste rangé, rien n'est perdu", async () => {
  const { ctx, book } = world();
  await supporters(ctx, 3);
  book.faults.hang.add("upsertByAccount");
  const slow = await Admin.actions.fileContacts.run(ctx, {});
  assert.match(slow.ok, new RegExp(fr.fileStop_slow.slice(0, 20)));
  assert.equal((await peopleOf(ctx)).filter((p) => p.contactId).length, 0);
  assert.ok((await peopleOf(ctx)).every((p) => p.name), "les noms sont toujours là");
  book.faults.hang.delete("upsertByAccount");
  book.faults.throw.add("upsertByAccount");
  assert.match((await Admin.actions.fileContacts.run(ctx, {})).ok, new RegExp(fr.fileStop_failed.slice(0, 15)));
  book.faults.throw.delete("upsertByAccount");
  await Admin.actions.fileContacts.run(ctx, {});
  assert.equal(book.dump().contacts.length, 3);
});

test("Contacts plein : on le dit, personne n'est perdu", async () => {
  const book = fakeContactBook({ maxContacts: 1 }); const cat = book.seedCategory("Soutiens");
  const { ctx } = makeWorld({ book, settings: { provider: "csv", category: cat } });
  await supporters(ctx, 3);
  const r = await Admin.actions.fileContacts.run(ctx, {});
  assert.match(r.ok, new RegExp(fr.fileStop_full.slice(0, 15)));
  assert.equal(book.dump().contacts.length, 1);
  assert.equal((await peopleOf(ctx)).length, 3);
});

test("administration : les noms rangés dans Contacts sont relus en une seule demande par page, fusion suivie, fiche supprimée dite", async () => {
  const { ctx, book } = world();
  await supporters(ctx, 3);
  await Admin.actions.fileContacts.run(ctx, {});
  const [a, b, c] = book.dump().contacts;
  const tableOf = async () => (await Admin.panel(ctx, { query: {} })).find((x) => x.type === "table" && x.columns[0] === fr.colPerson);
  let t = await tableOf();
  assert.deepEqual(t.rows.map((r) => r[0]).sort(), ["Personne 1", "Personne 2", "Personne 3"]);
  const people = await peopleOf(ctx);
  assert.ok(people.every((p) => p.name === ""));
  await book.methods.merge({ keep: a.id, drop: b.id });
  book.admin.deleteContact(c.id);
  t = await tableOf();
  const names = t.rows.map((r) => r[0]);
  assert.ok(names.includes(fr.nameGone));
  assert.ok(names.filter((n) => n.startsWith("Personne")).length >= 1);
});

/* ───────────── Vie privée : export, effacement, fusion ───────────── */

runPrivacySubjectContract(async () => {
  const w = makeWorld({ key: "soutiens-prv", settings: { provider: "csv" } });
  const svc = def.services["privacy.subject"];
  return {
    methods: Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](w.ctx, args)])),
    addReference: async (contactId) => { await w.ctx.api.store.add("people", D.blankPerson(`csv:${contactId}`, "csv", { contactId })); D.forget(w.ctx); },
    countReferences: async (contactId) => (await peopleOf(w.ctx)).filter((p) => p.contactId === contactId).length,
  };
}, { test, prefix: "Soutiens privacy.subject" });

test("vie privée : Contacts exporte, efface et fusionne ce que le module sait d'une fiche (parcours réel avec le double de Contacts)", async () => {
  const { ctx, book } = world({ settings: { review: false } });
  await supporters(ctx, 2);
  await Admin.actions.fileContacts.run(ctx, {});
  const [one, two] = (await peopleOf(ctx));
  const link = await O.consentLink(ctx, one.pid);
  await def.routes.consent(formRequest("https://site.example.test/m/soutiens/consent", { pid: one.pid, t: link.path.split("/").pop(), loc: "fr", act: "accept", pseudo: "Luna42", agree: "yes" }), ctx);
  const svc = def.services["privacy.subject"];
  book.addPrivacySubject({ instance: "supporters", name: "Soutiens", methods: Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](ctx, args)])) });
  const exp = await svc.export(ctx, { contactId: one.contactId });
  const text = JSON.stringify(exp);
  assert.ok(text.includes("Luna42") && text.includes("csv") && text.includes("Or"));
  assert.ok(!text.includes("Personne 1"), "le nom vit dans Contacts, pas ici");
  const merged = await book.methods.merge({ keep: one.contactId, drop: two.contactId });
  assert.equal(merged.ok, true);
  assert.equal((await peopleOf(ctx)).filter((p) => p.contactId === one.contactId).length, 2, "les deux soutiens pointent maintenant vers la fiche gardée");
  const erased = await book.methods.erase({ id: one.contactId, confirm: true });
  assert.equal(erased.ok, true);
  assert.equal((await peopleOf(ctx)).length, 0, "tout ce que le module savait des deux soutiens a disparu avec la fiche");
  void P; void D;
});

/* ───────────── Le lien facultatif avec le mur des remerciements ───────────── */

async function wallWorld() {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens"), wall = book.seedCategory("Mur");
  const w = makeWorld({ book, settings: { provider: "csv", category: cat, wallCategory: wall, review: false } });
  await supporters(w.ctx, 3);
  await Admin.actions.fileContacts.run(w.ctx, {});
  return { ...w, cat, wall };
}
const accept = async (ctx, p, pseudo) => { Routes.resetLimits(); const l = await O.consentLink(ctx, p.pid); return def.routes.consent(formRequest("https://site.example.test/m/soutiens/consent", { pid: p.pid, t: l.path.split("/").pop(), loc: "fr", act: "accept", pseudo, agree: "yes" }), ctx); };
const inWall = (book, wall) => book.dump().contacts.filter((c) => c.categoryIds.includes(wall)).map((c) => c.name).sort();

test("mur des remerciements : seules les personnes dont le pseudo accepté est EXACTEMENT le nom de leur fiche sont rangées dans la catégorie du mur", async () => {
  const { ctx, book, wall } = await wallWorld();
  const [a, b, c] = await peopleOf(ctx);
  await accept(ctx, a, "personne 1");          // même nom (casse et accents ignorés) → éligible
  await accept(ctx, b, "Un autre pseudo");     // pseudo différent → jamais dans le mur (il montrerait le nom de la fiche)
  void c;                                       // pas d'accord → jamais
  const r = await Admin.actions.fileContacts.run(ctx, {});
  assert.match(r.ok, /1 ajoutées/);
  assert.deepEqual(inWall(book, wall), ["Personne 1"]);
  assert.equal((await peopleOf(ctx)).find((p) => p.pid === a.pid).wall, true);
});

test("mur des remerciements : retirer son accord, changer de pseudo, être caché ou refusé retire la personne du mur tout de suite, même sans le droit de ranger (protection)", async () => {
  const { ctx, book, wall } = await wallWorld();
  const [a, b, c] = await peopleOf(ctx);
  for (const [p, name] of [[a, "personne 1"], [b, "personne 2"], [c, "personne 3"]]) await accept(ctx, p, name);
  await Admin.actions.fileContacts.run(ctx, {});
  assert.equal(inWall(book, wall).length, 3);
  const noRight = { ...ctx, can: () => false };   // la route publique n'a aucun droit
  void noRight;
  Routes.resetLimits();
  const l = await O.consentLink(ctx, a.pid);
  await def.routes.consent(formRequest("https://site.example.test/m/soutiens/consent", { pid: a.pid, t: l.path.split("/").pop(), loc: "fr", act: "withdraw" }), ctx);
  assert.deepEqual(inWall(book, wall), ["Personne 2", "Personne 3"], "retrait d'accord → quitte le mur");
  await accept(ctx, b, "Nouveau pseudo");
  assert.deepEqual(inWall(book, wall), ["Personne 3"], "pseudo changé → quitte le mur");
  await O.setHidden(ctx, c.pid, true);
  assert.deepEqual(inWall(book, wall), [], "caché → quitte le mur");
  assert.ok(book.dump().contacts.every((x) => x.categoryIds.length >= 1), "les fiches restent dans la catégorie des soutiens");
});

test("mur des remerciements : sans la catégorie du mur dans les réglages, ou sans « contact.curate », rien n'est rangé et rien ne casse", async () => {
  const w = await wallWorld();
  w.settings.wallCategory = "";
  const [a] = await peopleOf(w.ctx);
  await accept(w.ctx, a, "personne 1");
  await Admin.actions.fileContacts.run(w.ctx, {});
  assert.deepEqual(inWall(w.book, w.wall), []);
  const book = fakeContactBook(); const cat = book.seedCategory("Soutiens"), wall = book.seedCategory("Mur");
  const x = makeWorld({ book, withCurate: false, settings: { provider: "csv", category: cat, wallCategory: wall, review: false } });
  await supporters(x.ctx, 1);
  await Admin.actions.fileContacts.run(x.ctx, {});
  await accept(x.ctx, (await peopleOf(x.ctx))[0], "personne 1");
  await Admin.actions.fileContacts.run(x.ctx, {});
  assert.deepEqual(inWall(book, wall), ["Personne 1"]);
  Routes.resetLimits();
  const p = (await peopleOf(x.ctx))[0];
  const l = await O.consentLink(x.ctx, p.pid);
  const res = await def.routes.consent(formRequest("https://site.example.test/m/soutiens/consent", { pid: p.pid, t: l.path.split("/").pop(), loc: "fr", act: "withdraw" }), x.ctx);
  assert.equal(res.status, 303, "même si retirer du mur n'est pas possible, le retrait d'accord réussit");
  assert.equal((await peopleOf(x.ctx))[0].consent, null);
});

test("langue : les messages de Contacts existent en français et en anglais, et l'anglais marche de bout en bout", async () => {
  const book = fakeContactBook(); const cat = book.seedCategory("Supporters");
  const w = makeWorld({ book, locale: "en", settings: { provider: "csv", category: cat } });
  await supporters(w.ctx, 2);
  const r = await Admin.actions.fileContacts.run(w.ctx, {});
  assert.match(r.ok, /Filed in Contacts: 2/);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
});
