// Partenariats 2.0 : reprise unique des contacts de l'ancien carnet vers Contacts (migration dataVersion 2), contre le double « fakeContactBook » du contrat.
// Cas sûrs → créés / liés ; cas douteux → fiches « à vérifier » avec note d'origine ; Contacts absent, trop ancien ou muet → rien n'est écrit et la reprise recommence plus tard ;
// rejouable sans doublon ; rien n'est perdu. Toutes les données sont factices.
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
const mod = await import("../modules/partnerships/index.mjs");
const def = mod.default;
const NOTE_CHECK = "Brought over from Partnerships: to check";

/** Un site : Partenariats branché sur un carnet de test (ou sur rien / un carnet muet…). `services` est modifiable après coup (Contacts qui arrive). */
function setup({ book = fakeContactBook(), connected = true } = {}) {
  const services = connected ? { ...book.services } : {};
  const ctx = fakeCtx({ key: "partnerships", locale: "en", messages: en, services, migration: true });
  return { book, ctx, services, connect: () => { Object.assign(services, book.services); } };
}

/** La situation : des personnes déjà dans Contacts, et un ancien carnet de 10 contacts (cas sûrs et douteux). */
async function seed({ book, ctx }) {
  const ada = book.seedContact({ name: "Ada Lovelace", email: "ada@x.org", organisation: "Acme" }).id;
  const zed = book.seedContact({ name: "Zed", email: "zed@x.org" }).id;
  const eve = book.seedContact({ name: "Eve", organisation: "Org A" }).id;
  book.seedContact({ name: "Twin", organisation: "Org T" });
  book.seedContact({ name: "Twin", organisation: "Org T" });
  const P = {};
  for (let i = 1; i <= 10; i++) P[i] = await ctx.api.store.add("partners", { brand: `Marque ${i}`, status: "envoye" });
  await ctx.api.store.update(P[1], { brand: "Marque 1", status: "envoye", contactIds: ["id-deja-lie"] });
  const old = {};
  const L = async (n, data) => { old[n] = await ctx.api.store.add("contacts", { partnerId: P[n], status: "active", ...data }); };
  await L(1, { name: "Ada", email: "ADA@x.org", role: "CEO" });                                      // sûr : liée à Ada Lovelace (même e-mail)
  await L(2, { name: "Bob Martin", email: "bob@x.org", role: "CTO", organisation: "BobCo", notes: "à rappeler" }); // sûr : créée
  await L(3, { name: "Bob Martin", email: "BOB@x.org" });                                            // sûr : la même, sur une autre fiche partenaire
  await L(4, { name: "Quelqu'un", email: "zed@x.org" });                                             // douteux : e-mail de Zed, autre nom
  await L(5, { name: "Eve", organisation: "Org B" });                                                // douteux : même nom, autre organisation
  await L(6, { name: "", email: "x@x.org" });                                                        // douteux : sans nom
  await L(7, { name: "Twin", organisation: "Org T" });                                               // douteux : deux candidats
  await L(8, { name: "Sans Mail", status: "to_review", relation: "salon" });                         // sûr : créée, garde son « à vérifier » d'avant
  await L(9, { name: "Eve", organisation: "Org A" });                                                // sûr : liée à Eve
  await L(10, { name: "Raw", email: "pas-un-mail" });                                                // sûr : créée, l'adresse illisible est gardée en note
  return { ada, zed, eve, P, old };
}
const persons = (book) => book.dump().contacts.filter((c) => c.kind === "person");
const byName = (book, name) => persons(book).filter((c) => c.name === name);
const links = async (ctx, partnerId) => (await ctx.api.store.get(partnerId)).data.contactIds ?? [];
const meta = async (ctx) => (await ctx.api.store.list("meta")).find((r) => r.data.kind === "contactsMerge")?.data;

test("manifeste 2.0.0 : dataVersion 2, minCore 0.2.1, collection héritée déclarée, privacy.subject offert, valide", () => {
  const r = parseManifest(manifestJson);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual([manifestJson.version, manifestJson.dataVersion, manifestJson.minCore], ["2.0.0", 2, "0.2.1"]);
  assert.deepEqual(manifestJson.legacyCollections, ["contacts", "legacyContacts", "meta"]);
  assert.deepEqual(manifestJson.offers.map((o) => [o.service, o.each]), [["privacy.subject", true]]);
  assert.equal(typeof def.migrations[2], "function");
  assert.equal(manifestJson.requires[0].min ?? 1, 1, "Partenariats garde min 1 : il marche (liens conservés) même sans Contacts 2");
});

test("reprise : cas sûrs créés ou liés, cas douteux en « à vérifier » avec note d'origine, identifiants de fiches conservés, rien de perdu", async () => {
  const s = setup();
  const { book, ctx } = s;
  const { ada, zed, eve, P, old } = await seed(s);
  const before = Object.fromEntries((await ctx.api.store.list("contacts", { limit: 50 })).map((r) => [r.id, r.data]));
  await def.migrations[2](ctx);

  // Les liens : l'identifiant déjà présent reste (et reste en premier), les personnes reprises s'y ajoutent.
  assert.deepEqual((await links(ctx, P[1]))[0], "id-deja-lie");
  assert.deepEqual(await links(ctx, P[1]), ["id-deja-lie", ada]);
  assert.deepEqual(await links(ctx, P[9]), [eve]);
  const [bob] = byName(book, "Bob Martin");
  assert.equal(byName(book, "Bob Martin").length, 1, "Bob créé une seule fois");
  assert.deepEqual([await links(ctx, P[2]), await links(ctx, P[3])], [[bob.id], [bob.id]], "la même personne sur deux fiches partenaires");
  assert.deepEqual([bob.email, bob.role, bob.source, bob.status], ["bob@x.org", "CTO", "partnerships", "active"]);
  assert.ok(bob.notes.some((n) => /Brought over from Partnerships \(Marque 2\)/.test(n.text) && /à rappeler/.test(n.text)));
  const adaCard = book.dump().contacts.find((c) => c.id === ada);
  assert.ok(adaCard.notes.some((n) => /CEO/.test(n.text)), "ce que la fiche existante ne savait pas est ajouté en note, sans rien écraser");
  assert.equal(adaCard.role, "", "la fonction de la fiche existante n'est pas écrasée");

  // Les cas douteux : jamais fusionnés avec une fiche existante, statut « à vérifier », note d'origine, adresse en note.
  const quelquun = byName(book, "Quelqu'un")[0];
  assert.deepEqual([quelquun.status, quelquun.email, quelquun.source], ["to_review", "", "partnerships"]);
  assert.ok(quelquun.notes.some((n) => n.text.startsWith(NOTE_CHECK) && /zed@x\.org/.test(n.text) && /Marque 4/.test(n.text) && /already in Contacts, under another name/.test(n.text)));
  const zedCard = book.dump().contacts.find((c) => c.id === zed);
  assert.deepEqual([zedCard.email, zedCard.name, zedCard.notes.length], ["zed@x.org", "Zed", 0], "Zed n'est pas touché");
  assert.deepEqual(await links(ctx, P[4]), [quelquun.id]);
  const eveB = persons(book).find((c) => c.name === "Eve" && c.id !== eve);
  assert.deepEqual([eveB.status, book.dump().contacts.find((c) => c.id === eveB.orgId).name], ["to_review", "Org B"]);
  const unnamed = persons(book).find((c) => c.name === "x@x.org");
  assert.equal(unnamed.status, "to_review", "sans nom : l'adresse sert de nom, à vérifier");
  assert.ok(unnamed.notes[0].text.startsWith(NOTE_CHECK));
  assert.equal(byName(book, "Twin").length, 2, "deux candidats : aucune fiche de plus");
  assert.ok(byName(book, "Twin").some((c) => c.notes.some((n) => n.text.startsWith(NOTE_CHECK))), "la fiche existante reçoit une note, sans changer de statut");
  assert.ok(byName(book, "Twin").every((c) => c.status === "active"));
  assert.equal((await links(ctx, P[7])).length, 1);

  // Les autres cas sûrs.
  assert.equal(byName(book, "Sans Mail")[0].status, "to_review");
  assert.ok(!byName(book, "Sans Mail")[0].notes.some((n) => n.text.startsWith(NOTE_CHECK)), "un cas sûr n'est pas « douteux »");
  assert.ok(byName(book, "Raw")[0].notes.some((n) => /pas-un-mail/.test(n.text)));
  assert.equal(persons(book).length, 5 + 6, "5 déjà là + 6 nouvelles personnes");

  // Rien de perdu : copie identique, originaux retirés, état noté.
  assert.equal(await ctx.api.store.count("contacts"), 0);
  const kept = await ctx.api.store.list("legacyContacts", { limit: 50 });
  assert.equal(kept.length, 10);
  for (const k of kept) { const { _legacyId, _createdAt, ...data } = k.data; assert.deepEqual(data, before[_legacyId]); assert.ok(old[Object.keys(old).find((n) => old[n] === _legacyId)]); }
  const m = await meta(ctx);
  assert.equal(m.v2.done, true);
  assert.deepEqual(m.v2.report, { link: 3, created: 3, check: 4, failed: 0, unlinked: 0 });
  assert.equal(Object.keys(m.mapping).length, 10);
});

test("rejouable deux fois : aucun doublon, aucune écriture de plus, même après un arrêt en cours de route", async () => {
  const s = setup();
  const { book, ctx } = s;
  await seed(s);
  await def.migrations[2](ctx);
  const store1 = JSON.stringify(ctx.dumpStore()), book1 = JSON.stringify(book.dump().contacts), calls1 = book.calls.length;
  await def.migrations[2](ctx);
  await mod.runMigration(ctx);
  assert.equal(JSON.stringify(ctx.dumpStore()), store1);
  assert.equal(JSON.stringify(book.dump().contacts), book1);
  assert.equal(book.calls.length, calls1, "terminée : on n'appelle plus Contacts");

  // Arrêt en cours de route : la création échoue (Contacts plante) à partir du 3e appel, puis revient.
  const t = setup();
  await seed(t);
  let n = 0;
  const create = t.book.services["contact.book"].create;
  t.services["contact.book"] = { ...t.book.services["contact.book"], create: async (a) => { if (++n > 2) throw new Error("boom"); return create(a); } };
  await def.migrations[2](t.ctx);
  const half = await meta(t.ctx);
  assert.equal(half.v2.done, false);
  assert.ok(await t.ctx.api.store.count("contacts") > 0, "les originaux sont encore là");
  assert.equal(await t.ctx.api.store.count("legacyContacts"), 10, "copie faite avant tout");
  assert.ok(Object.keys(half.mapping).length >= 1 && Object.keys(half.mapping).length < 10);
  t.services["contact.book"] = t.book.services["contact.book"];
  await def.migrations[2](t.ctx);
  await def.migrations[2](t.ctx);
  assert.equal(persons(t.book).length, 5 + 6, "mêmes personnes qu'en une passe : pas de doublon");
  assert.equal(byName(t.book, "Bob Martin").length, 1);
  assert.equal(await t.ctx.api.store.count("contacts"), 0);
  assert.equal(await t.ctx.api.store.count("legacyContacts"), 10);
  const notes = (name) => byName(t.book, name)[0].notes.length;
  assert.equal(notes("Quelqu'un"), 1, "une seule note d'origine");
});

test("Contacts ABSENT : rien n'est écrit, un message le dit, et la reprise se fait toute seule quand Contacts arrive", async () => {
  const s = setup({ connected: false });
  const { ctx } = s;
  await seed({ ...s, book: s.book });
  const before = JSON.stringify(ctx.dumpStore());
  await def.migrations[2](ctx);
  assert.equal(JSON.stringify(ctx.dumpStore()), before, "aucune écriture, aucune collection créée");
  const panel = await def.adminPanel(ctx, { query: {} });
  const banner = panel.find((b) => b.type === "banner" && /waiting to be brought into Contacts/.test(b.text));
  assert.ok(banner, "message actionnable dans l'administration");
  assert.match(banner.text, /^10 Partnerships contact\(s\)/);
  assert.equal(JSON.stringify(ctx.dumpStore()), before, "ouvrir l'administration ne change rien tant que Contacts manque");
  s.connect();
  const after = await def.adminPanel(ctx, { query: {} });
  assert.equal(await ctx.api.store.count("contacts"), 0);
  assert.equal((await meta(ctx)).v2.done, true);
  assert.ok(!after.some((b) => b.type === "banner" && /waiting/.test(b.text)));
  assert.ok(after.some((b) => b.type === "markdown" && /Your contacts are now in Contacts/.test(b.text) && /4 file\(s\)/.test(b.text)), "bilan : 4 fiches à vérifier");
  assert.equal(persons(s.book).length, 5 + 6);
});

test("Contacts trop ancien (sans les méthodes de la v2) : même attente, rien n'est écrit", async () => {
  const s = setup();
  const { ctx } = s;
  await seed(s);
  const v1 = Object.fromEntries(Object.entries(s.book.services["contact.book"]).filter(([m]) => !["categories", "categoriesResolve", "upsertByAccount", "accounts"].includes(m)));
  s.services["contact.book"] = v1;
  const before = JSON.stringify(ctx.dumpStore());
  await def.migrations[2](ctx);
  assert.equal(JSON.stringify(ctx.dumpStore()), before);
  assert.equal(persons(s.book).length, 5);
  s.services["contact.book"] = s.book.services["contact.book"];
  await def.migrations[2](ctx);
  assert.equal(persons(s.book).length, 5 + 6);
});

test("Contacts MUET (trou noir) : l'attente est bornée, rien n'est écrit ; muet en cours de route : on s'arrête là et on reprend ensuite", async () => {
  const saved = { ...mod.timing };
  mod.timing.callMs = 40;
  try {
    const s = setup();
    await seed(s);
    s.book.faults.hang.add("categories");
    const before = JSON.stringify(s.ctx.dumpStore());
    const t0 = Date.now();
    await def.migrations[2](s.ctx);
    const panel = await def.adminPanel(s.ctx, { query: {} });
    assert.ok(Date.now() - t0 < 3000, "pas d'attente sans fin");
    assert.equal(JSON.stringify(s.ctx.dumpStore()), before);
    assert.ok(panel.some((b) => b.type === "banner" && /waiting/.test(b.text)));
    assert.equal(persons(s.book).length, 5);

    // Il répond à la première question mais plus à « create » : les cas déjà réglés sont notés, le reste attend.
    s.book.faults.hang.delete("categories");
    s.book.faults.hang.add("create");
    await def.migrations[2](s.ctx);
    const part = await meta(s.ctx);
    assert.equal(part.v2.done, false);
    assert.equal(await s.ctx.api.store.count("legacyContacts"), 10, "copie faite");
    assert.ok(await s.ctx.api.store.count("contacts") > 0, "originaux conservés");
    s.book.faults.hang.clear();
    await def.migrations[2](s.ctx);
    assert.equal((await meta(s.ctx)).v2.done, true);
    assert.equal(persons(s.book).length, 5 + 6);
    assert.equal(byName(s.book, "Bob Martin").length, 1);
  } finally { Object.assign(mod.timing, saved); }
});

test("temps imparti : une reprise trop longue s'arrête proprement, et continue à la visite suivante", async () => {
  const saved = { ...mod.timing };
  try {
    const s = setup();
    await seed(s);
    mod.timing.budgetMs = -1;
    await def.migrations[2](s.ctx);
    assert.equal((await meta(s.ctx)).v2.done, false);
    assert.equal(persons(s.book).length, 5);
    mod.timing.budgetMs = saved.budgetMs;
    await def.adminPanel(s.ctx, { query: {} });
    assert.equal((await meta(s.ctx)).v2.done, true);
    assert.equal(persons(s.book).length, 5 + 6);
  } finally { Object.assign(mod.timing, saved); }
});

test("site neuf ou sans ancien contact : rien n'est créé, aucun message, aucun appel à Contacts", async () => {
  const s = setup();
  const { ctx, book } = s;
  const p = await ctx.api.store.add("partners", { brand: "Acme" });
  await def.migrations[2](ctx);
  const panel = await def.adminPanel(ctx, { query: {} });
  const fiche = await def.adminPanel(ctx, { query: { partner: p } });
  assert.ok(![...panel, ...fiche].some((b) => b.type === "banner"));
  for (const c of ["contacts", "legacyContacts", "meta"]) assert.equal(await ctx.api.store.count(c), 0, c);
  assert.deepEqual(book.calls.filter(([, m]) => m === "create" || m === "note" || m === "categories"), []);
  const none = setup({ connected: false });
  await def.migrations[2](none.ctx);
  assert.deepEqual(none.ctx.dumpStore(), []);
});

test("après une fusion faite par la version précédente : les cas réglés restent réglés, seuls les cas en attente sont repris", async () => {
  const s = setup();
  const { ctx, book } = s;
  const ada = book.seedContact({ name: "Ada", email: "ada@x.org" }).id;
  const p = await ctx.api.store.add("partners", { brand: "Acme", contactIds: [ada] });
  // Ada a déjà été reprise (copie « legacyContacts » + état de la fusion) ; Bob attendait (cas ambigu laissé de côté) ; Cléo n'a jamais été vue.
  const a = await ctx.api.store.add("legacyContacts", { partnerId: p, name: "Ada", email: "ada@x.org", _legacyId: "old-a", _createdAt: "2026-01-01T00:00:00.000Z" });
  const b = await ctx.api.store.add("legacyContacts", { partnerId: p, name: "Bob", email: "bob@x.org", _legacyId: "old-b", _createdAt: "2026-01-02T00:00:00.000Z" });
  await ctx.api.store.add("legacyContacts", { partnerId: p, name: "Dan", _legacyId: "old-d", _createdAt: "2026-01-03T00:00:00.000Z" });
  await ctx.api.store.add("meta", { kind: "contactsMerge", at: "2026-02-01T00:00:00.000Z", mapping: { "old-a": ada }, added: {}, created: [], dismissed: ["old-d"], report: null });
  await ctx.api.store.add("contacts", { partnerId: p, name: "Cléo", email: "cleo@x.org", status: "active" });
  void a; void b;
  await def.migrations[2](ctx);
  assert.deepEqual(persons(book).map((c) => c.name).sort(), ["Ada", "Bob", "Cléo"], "Dan (laissé de côté) n'est pas repris, Ada n'est pas recréée");
  const m = await meta(ctx);
  assert.equal(m.v2.done, true);
  assert.deepEqual(Object.keys(m.mapping).sort(), ["old-a", "old-b", expectCleo(m)].sort());
  assert.equal(await ctx.api.store.count("contacts"), 0);
  assert.equal(await ctx.api.store.count("legacyContacts"), 4, "la copie de la 1.x + celle de Cléo, inertes");
});
const expectCleo = (m) => Object.keys(m.mapping).find((k) => k !== "old-a" && k !== "old-b");

test("50 liens par fiche au plus : la personne est créée dans Contacts, le surplus est compté, rien n'est perdu", async () => {
  const s = setup();
  const { ctx, book } = s;
  const ids = Array.from({ length: 50 }, (_, i) => `lien-${i}`);
  const p = await ctx.api.store.add("partners", { brand: "Pleine", contactIds: ids });
  await ctx.api.store.add("contacts", { partnerId: p, name: "Zoé", email: "zoe@x.org" });
  await def.migrations[2](ctx);
  assert.equal(byName(book, "Zoé").length, 1);
  assert.deepEqual(await links(ctx, p), ids);
  assert.equal((await meta(ctx)).v2.report.unlinked, 1);
});

test("une fiche partenaire supprimée entre-temps : la personne est quand même reprise dans Contacts", async () => {
  const s = setup();
  await s.ctx.api.store.add("contacts", { partnerId: "disparue", name: "Orphan", email: "o@x.org", status: "active" });
  await def.migrations[2](s.ctx);
  assert.equal(byName(s.book, "Orphan").length, 1);
});

test("100 personnes : lues par pages, reprises une fois chacune, rejouable", async () => {
  const s = setup();
  const p = await s.ctx.api.store.add("partners", { brand: "Grande" });
  for (let i = 0; i < 120; i++) await s.ctx.api.store.add("contacts", { partnerId: p, name: `Personne ${i}`, email: `p${i}@x.org`, status: "active" });
  await def.migrations[2](s.ctx);
  await def.migrations[2](s.ctx);
  assert.equal(persons(s.book).length, 120);
  assert.equal((await s.ctx.api.store.get(p)).data.contactIds.length, 50, "50 liens au plus");
  assert.equal(await s.ctx.api.store.count("legacyContacts"), 120);
});

test("plus d'écran de fusion : ni lien, ni sauvegarde lisible de l'ancien carnet, ni mention dans les outils", async () => {
  const s = setup();
  const p = await s.ctx.api.store.add("partners", { brand: "Acme" });
  await s.ctx.api.store.add("contacts", { partnerId: p, name: "Ada", email: "ada@x.org" });
  s.services["contact.book"] = undefined; delete s.services["contact.book"];
  const text = JSON.stringify([await def.adminPanel(s.ctx, { query: { merge: "1" } }), await def.adminPanel(s.ctx, { query: { partner: p } }), await def.mcp.partner_get(s.ctx, { id: p })]);
  assert.ok(!/merge=1|unmergedContacts|Merge your contacts|Undo the merge|legacy-contacts/i.test(text));
  assert.equal(def.backup, undefined);
  assert.ok(!/merge|fusion|legacy/i.test(JSON.stringify(manifestJson.mcp)));
  assert.ok(!fs.existsSync(`${PDIR}/merge.mjs`));
});
