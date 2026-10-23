// Mur des remerciements — l'administration (panneau et actions), les outils de l'assistant, la vie privée (contrat privacy.subject) et le manifeste.
// Contacts est le double fakeContactBook (jamais modifié). Aucun réseau.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { runPrivacySubjectContract } from "./contract/privacySubject.contract.mjs";
import { makeWorld, reset, restore, manifest, P, C, D, def, Admin, people } from "./helpers/thanks-wall-world.mjs";

beforeEach(() => reset());
afterEach(() => restore());

const panel = (ctx, query = {}) => def.adminPanel(ctx, { query });
const run = (ctx, name, values) => { const a = def.adminActions[name]; return (typeof a === "function" ? a : a.run)(ctx, values); };
const byType = (blocks, type) => blocks.filter((b) => b.type === type);
const text = (blocks) => JSON.stringify(blocks);

function setup(n = 3, over = {}) {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  const list = people(book, cat, n, { prefix: "P" });
  const w = makeWorld({ book, settings: { category: cat, ...over.settings }, ...over });
  return { ...w, cat, list };
}

/* ───────────── Le panneau ───────────── */

test("panneau : le mur, ses groupes, le lien vers le mur et vers Contacts, la section « ne pas montrer »", async () => {
  const { ctx, list } = setup(3);
  const blocks = await panel(ctx);
  const t = text(blocks);
  assert.ok(t.includes("Personnes sur le mur : 3. Groupes : 1."));
  const groups = byType(blocks, "table")[0];
  assert.deepEqual(groups.columns, ["Groupe", "Personnes", "Cachées"]);
  assert.deepEqual(groups.rows, [["Soutiens", "3", "0"]]);
  const links = byType(blocks, "links")[0].items;
  assert.equal(links[0].href, "/merci");
  assert.ok(links[1].href.startsWith("/admin/instances/"));
  assert.ok(t.includes("créez une catégorie « Ne pas montrer »"), "sans catégorie : on explique comment faire");
});

test("panneau : avec une catégorie « Ne pas montrer », la consigne cite son nom et le nombre de personnes cachées", async () => {
  const { ctx, book, cat, list } = setup(3);
  const hide = book.seedCategory("Ne pas montrer");
  book.admin.setCategories(list[1].id, [cat, hide]);
  const t = text(await panel(ctx));
  assert.ok(t.includes("la catégorie « Ne pas montrer »") && t.includes("Personnes cachées en ce moment : 1"));
});

test("panneau : rien n'est réglé → une consigne vers l'onglet Réglages (jamais d'erreur)", async () => {
  const book = fakeContactBook();
  book.seedCategory("A"); book.seedCategory("B");
  const { ctx } = makeWorld({ book });
  const blocks = await panel(ctx);
  const banner = blocks.find((b) => b.type === "banner");
  assert.equal(banner.tone, "warning");
  assert.ok(banner.text.includes("onglet Réglages") && banner.href === "?tab=settings");
  assert.ok(!byType(blocks, "adminForm").some((f) => f.action === "messageSave"));
});

test("panneau : Contacts absent → une bannière et la proposition de l'installer ; muet → une phrase, sans lever", async () => {
  const { ctx } = makeWorld({ withBook: false });
  const blocks = await panel(ctx);
  assert.deepEqual(blocks.map((b) => b.type), ["banner", "suggestInstall"]);
  const { ctx: c2, book } = setup(2);
  await panel(c2);                                  // le mur est connu
  for (const m of ["list", "categories", "categoriesResolve", "resolve", "search"]) book.faults.hang.add(m);
  C.timing.adminFreshMs = 0;
  const t0 = Date.now();
  const again = await panel(c2);
  assert.ok(Date.now() - t0 < 4000, "borné");
  assert.ok(text(again).includes("le dernier contenu connu"), "dit que le mur public garde le dernier contenu");
});

test("panneau : un groupe de plus de 1 000 fiches est signalé", async () => {
  const book = fakeContactBook({ maxContacts: 2000 });
  const cat = book.seedCategory("Foule");
  people(book, cat, 1100);
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  assert.ok(text(await panel(ctx)).includes("seules les 1000 premières sont montrées"));
});

test("liste des messages : 25 par page, recherche sans accents, pages précédente / suivante ; seul « Écrire » est proposé, avec le droit", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  people(book, cat, 59, { prefix: "P" });
  book.seedContact({ name: "Élodie Test", categoryIds: [cat] });
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  const t1 = byType(await panel(ctx, {}), "table").find((t) => t.columns.includes("Message"));
  assert.equal(t1.rows.length, 25);
  assert.deepEqual(t1.rowActions, [{ label: "Écrire", href: "?msg={id}" }]);
  const p3 = await panel(ctx, { page: "3" });
  assert.equal(byType(p3, "table").find((t) => t.columns.includes("Message")).rows.length, 10);
  assert.ok(byType(p3, "links").some((l) => l.items.some((i) => i.label === "← Page précédente" && i.href === "?page=2")));
  const found = await panel(ctx, { q: "elodie" });
  assert.deepEqual(byType(found, "table").find((t) => t.columns.includes("Message")).rows.map((r) => r[0]), ["Élodie Test"]);
  assert.ok(text(await panel(ctx, { q: "zzzz" })).includes("Personne ne correspond"));
  const ro = makeWorld({ book, settings: { category: cat }, can: false });
  const roBlocks = await panel(ro.ctx, {});
  assert.deepEqual(byType(roBlocks, "table").find((t) => t.columns.includes("Message")).rowActions, [], "sans le droit : pas de bouton");
  assert.ok(!byType(roBlocks, "adminForm").some((f) => f.action === "honorSearch"));
});

test("l'écran d'un message : un formulaire par langue du site, le texte actuel, un identifiant caché ; sans le droit, une phrase", async () => {
  const { ctx, list } = setup(2);
  await D.setMessage(ctx, list[0].id, { fr: "Merci !" });
  const blocks = await panel(ctx, { msg: list[0].id });
  assert.ok(blocks[0].text.includes(list[0].name));
  const form = byType(blocks, "adminForm")[0];
  assert.equal(form.action, "messageSave");
  assert.deepEqual(form.fields.map((f) => f.name), ["contactId", "text_fr", "text_en"]);
  assert.equal(form.fields[1].value, "Merci !");
  assert.ok(form.fields[1].help.includes("160 caractères") && form.fields[1].label.endsWith("(FR)"));
  const noRight = setup(1, { can: false });
  const b2 = await panel(noRight.ctx, { msg: noRight.list[0].id });
  assert.ok(text(b2).includes("pas le modifier") && !byType(b2, "adminForm").length);
  const gone = await panel(ctx, { msg: "inconnu-123" });
  assert.ok(text(gone).includes("n'existe plus"));
});

/* ───────────── Les actions : messages ───────────── */

test("action messageSave : enregistre le message de CETTE fiche, par langue ; message vide = message retiré ; 160 caractères au plus (erreur sous le champ)", async () => {
  const { ctx, list } = setup(2);
  let r = await run(ctx, "messageSave", { contactId: list[0].id, text_fr: "  Merci pour tout  ", text_en: "Thanks" });
  assert.equal(r.redirect, "?");
  assert.ok(r.ok.includes(list[0].name));
  let data = await D.readData(ctx, { fresh: true });
  assert.deepEqual(data.messages.get(list[0].id).texts, { fr: "Merci pour tout", en: "Thanks" });
  assert.equal(data.messages.size, 1);
  r = await run(ctx, "messageSave", { contactId: list[0].id, text_fr: "x".repeat(161), text_en: "" });
  assert.deepEqual(Object.keys(r.errors), ["text_fr"]);
  assert.ok(r.errors.text_fr.includes("160 caractères") && !r.ok);
  assert.equal((await D.readData(ctx, { fresh: true })).messages.get(list[0].id).texts.fr, "Merci pour tout", "rien n'a changé");
  r = await run(ctx, "messageSave", { contactId: list[0].id, text_fr: "", text_en: "" });
  assert.ok(r.ok.includes("retiré"));
  assert.equal((await D.readData(ctx, { fresh: true })).messages.size, 0);
  r = await run(ctx, "messageSave", { contactId: "inconnu", text_fr: "Salut" });
  assert.ok(r.error.includes("n'existe plus"));
  assert.equal(ctx.dumpStore().length, 0, "une fiche inconnue ne laisse rien");
});

test("action messageSave : le texte est nettoyé (caractères de contrôle, espaces) et reste du texte", async () => {
  const { ctx, list } = setup(1);
  await run(ctx, "messageSave", { contactId: list[0].id, text_fr: "a\u0000b‮  c\n\nd", text_en: "" });
  assert.equal((await D.readData(ctx, { fresh: true })).messages.get(list[0].id).texts.fr, "ab c d");
});

test("action messageSave : une fiche fusionnée est suivie (le message va sur la fiche gardée)", async () => {
  const { ctx, book, list } = setup(2);
  await book.methods.merge({ keep: list[0].id, drop: list[1].id });
  await run(ctx, "messageSave", { contactId: list[1].id, text_fr: "Suivi" });
  const data = await D.readData(ctx, { fresh: true });
  assert.deepEqual([...data.messages.keys()], [list[0].id]);
});

test("au plus 1 000 messages : le suivant est refusé avec une phrase claire", async () => {
  const { ctx, list } = setup(1);
  for (let i = 0; i < 1000; i++) await ctx.api.store.add("messages", { contactId: `fiche-${i}`, texts: { fr: "x" } });
  const r = await run(ctx, "messageSave", { contactId: list[0].id, text_fr: "de trop" });
  assert.ok(r.error.includes("1000 messages"));
  assert.equal(await ctx.api.store.count("messages"), 1000);
});

test("action messageSearch : renvoie vers la liste filtrée", async () => {
  const { ctx } = setup(1);
  assert.deepEqual(await run(ctx, "messageSearch", { q: " élodie " }), { redirect: "?q=%C3%A9lodie" });
  assert.deepEqual(await run(ctx, "messageSearch", { q: "" }), { redirect: "?" });
});

/* ───────────── Les actions : à l'honneur ───────────── */

test("à l'honneur : chercher (2 lettres au moins, erreur sous le champ), choisir, enregistrer pour un mois proposé, remplacer, retirer", async () => {
  const { ctx, list } = setup(2);
  assert.ok((await run(ctx, "honorSearch", { q: "p" })).errors.q.includes("deux lettres"));
  assert.deepEqual(await run(ctx, "honorSearch", { q: "P 00" }), { redirect: "?hq=P%2000" });
  const found = await panel(ctx, { hq: "P 00" });
  const table = byType(found, "table").find((t) => t.columns.length === 1);
  assert.deepEqual(table.rows.map((r) => r[0]).sort(), [list[0].name, list[1].name]);
  assert.deepEqual(table.rowActions, [{ label: "Mettre à l'honneur", href: "?honor={id}" }]);
  assert.ok(text(await panel(ctx, { hq: "zzzz" })).includes("Aucune fiche ne correspond"));
  const screen = await panel(ctx, { honor: list[0].id });
  const form = byType(screen, "adminForm")[0];
  assert.deepEqual(form.fields.map((f) => f.name), ["contactId", "month", "why_fr", "why_en"]);
  assert.equal(form.fields[1].options.length, 6, "ce mois-ci et les cinq suivants");
  assert.equal(form.fields[1].value, P.monthKey());

  const now = P.monthKey();
  let r = await run(ctx, "honorSave", { contactId: list[0].id, month: now, why_fr: "Toujours là" });
  assert.equal(r.redirect, "?");
  assert.deepEqual((await D.readData(ctx, { fresh: true })).honors.map((h) => [h.month, h.contactId, h.why.fr]), [[now, list[0].id, "Toujours là"]]);
  r = await run(ctx, "honorSave", { contactId: list[1].id, month: now, why_fr: "" });
  const honors = (await D.readData(ctx, { fresh: true })).honors;
  assert.equal(honors.length, 1, "un seul par mois : le nouveau remplace l'ancien");
  assert.equal(honors[0].contactId, list[1].id);
  assert.ok((await run(ctx, "honorSave", { contactId: list[0].id, month: P.addMonths(now, -1) })).errors.month, "un mois passé n'est pas proposé");
  assert.ok((await run(ctx, "honorSave", { contactId: list[0].id, month: "n'importe quoi" })).errors.month);
  assert.ok((await run(ctx, "honorSave", { contactId: list[0].id, month: P.addMonths(now, 6) })).errors.month, "au-delà de six mois : refusé");
  assert.ok((await run(ctx, "honorSave", { contactId: list[0].id, month: now, why_fr: "x".repeat(301) })).errors.why_fr.includes("300 caractères"));
  assert.ok((await run(ctx, "honorSave", { contactId: "inconnu", month: now })).error.includes("n'existe plus"));
  // Le tableau des mises à l'honneur.
  const t = byType(await panel(ctx), "table").find((x) => x.columns[0] === "Mois");
  assert.deepEqual([t.rows[0][1], t.rows[0][0].endsWith("(ce mois-ci)")], [list[1].name, true]);
  assert.equal(t.rowIds[0], now);
  r = await run(ctx, "honorClear", { id: now });
  assert.equal(r.redirect, "?");
  assert.equal((await D.readData(ctx, { fresh: true })).honors.length, 0);
  assert.ok((await run(ctx, "honorClear", { id: "pas-un-mois" })).error);
});

test("à l'honneur : 24 mises à l'honneur au plus, les plus anciennes sont retirées pour faire de la place", async () => {
  const { ctx, list } = setup(1);
  for (let i = 0; i < 24; i++) await D.setHonor(ctx, { month: P.addMonths("2020-01", i), contactId: list[0].id, why: {} });
  assert.equal((await D.readData(ctx, { fresh: true })).honors.length, 24);
  await D.setHonor(ctx, { month: P.addMonths("2020-01", 40), contactId: list[0].id, why: {} });
  const honors = (await D.readData(ctx, { fresh: true })).honors;
  assert.equal(honors.length, 24);
  assert.ok(!honors.some((h) => h.month === "2020-01") && honors.some((h) => h.month === P.addMonths("2020-01", 40)));
});

test("les actions qui écrivent sont réservées par un droit du module, déclaré dans le manifeste", () => {
  assert.deepEqual(manifest.rights.map((r) => r.id), ["messages.edit"]);
  for (const name of ["honorSearch", "honorSave", "honorClear", "messageSearch", "messageSave", "tidy"]) assert.equal(def.adminActions[name].right, "messages.edit", name);
  assert.equal(Admin.RIGHT, "messages.edit");
  assert.deepEqual(manifest.rights[0].default, { admin: true, editor: false });
});

/* ───────────── Remettre en ordre : fiche fusionnée ou supprimée (moved / missing) ───────────── */

test("remettre en ordre : un message sur une fiche fusionnée la suit ; sur une fiche supprimée, il est retiré ; le reste est intact", async () => {
  const { ctx, book, list } = setup(4);
  const [keep, drop, gone, stay] = list;
  const now = P.monthKey();
  await D.setMessage(ctx, drop.id, { fr: "Message de la fiche absorbée" });
  await D.setMessage(ctx, gone.id, { fr: "Message de la fiche supprimée" });
  await D.setMessage(ctx, stay.id, { fr: "Message qui reste" });
  await D.setHonor(ctx, { month: now, contactId: gone.id, why: { fr: "Mot" } });
  await D.setHonor(ctx, { month: P.addMonths(now, 1), contactId: drop.id, why: { fr: "Mot 2" } });
  await book.methods.merge({ keep: keep.id, drop: drop.id });     // aucun fournisseur « privacy.subject » branché : le module n'a rien reçu
  book.admin.deleteContact(gone.id);
  const r = await run(ctx, "tidy", {});
  assert.equal(r.redirect, "?");
  assert.ok(r.ok.includes("Fiches fusionnées suivies : 1") && r.ok.includes("Fiches supprimées nettoyées : 1"), r.ok);
  const data = await D.readData(ctx, { fresh: true });
  assert.deepEqual([...data.messages.keys()].sort(), [keep.id, stay.id].sort());
  assert.equal(data.messages.get(keep.id).texts.fr, "Message de la fiche absorbée");
  assert.deepEqual(data.honors.map((h) => [h.month, h.contactId]), [[P.addMonths(now, 1), keep.id]], "la mise à l'honneur de la fiche supprimée a disparu, l'autre a suivi");
  assert.ok((await run(ctx, "tidy", {})).ok.includes("rien à changer"), "rejouer ne change rien");
});

test("remettre en ordre : Contacts muet → une phrase, et rien n'est retiré par erreur", async () => {
  const { ctx, book, list } = setup(2);
  await D.setMessage(ctx, list[0].id, { fr: "Garde-moi" });
  book.faults.hang.add("resolve");
  const r = await run(ctx, "tidy", {});
  assert.ok(r.error.includes("ne répond pas"));
  assert.equal((await D.readData(ctx, { fresh: true })).messages.size, 1);
});

test("remettre en ordre : un très grand nombre de messages = au plus 10 lectures (paquets de 100)", async () => {
  const { ctx, book } = setup(1);
  for (let i = 0; i < 1000; i++) await ctx.api.store.add("messages", { contactId: `fiche-${i}`, texts: { fr: "x" } });
  const r = await run(ctx, "tidy", {});
  assert.equal(book.calls.filter((c) => c[1] === "resolve").length, 10);
  assert.ok(r.ok.includes("Fiches supprimées nettoyées : 1000"));
  assert.equal(await ctx.api.store.count("messages"), 0);
});

/* ───────────── Vie privée (privacy.subject) ───────────── */

runPrivacySubjectContract(async () => {
  const { ctx } = makeWorld();
  const svc = def.services["privacy.subject"];
  return {
    methods: Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](ctx, args)])),
    addReference: async (contactId) => { await D.setMessage(ctx, contactId, { fr: "Merci" }); },
    countReferences: async (contactId) => { const refs = await D.referencesOf(ctx, contactId); return (refs.message ? 1 : 0) + refs.honors.length; },
  };
}, { prefix: "thanks-wall privacy.subject" });

test("vie privée : Contacts efface une fiche → message et mise à l'honneur partent avec ; fusionne → ils suivent ; exporter dit ce qui est gardé", async () => {
  const { ctx, book, list } = setup(3);
  const sub = def.services["privacy.subject"];
  book.addPrivacySubject({ instance: "merci", methods: { export: (a) => sub.export(ctx, a), erase: (a) => sub.erase(ctx, a), remap: (a) => sub.remap(ctx, a) } });
  const [a, b, c] = list;
  await D.setMessage(ctx, a.id, { fr: "Un", en: "One" });
  await D.setMessage(ctx, b.id, { fr: "Deux" });
  await D.setMessage(ctx, c.id, { fr: "Trois" });
  await D.setHonor(ctx, { month: P.monthKey(), contactId: b.id, why: { fr: "Pourquoi" } });
  const exported = await sub.export(ctx, { contactId: b.id });
  assert.equal(exported.label, "Mur des remerciements");
  assert.deepEqual(exported.data, { message: { fr: "Deux" }, honoured: [{ month: P.monthKey(), text: { fr: "Pourquoi" } }] });
  assert.ok(JSON.stringify(exported).length < 100_000);
  const merged = await book.methods.merge({ keep: a.id, drop: b.id });
  assert.deepEqual(merged.remapped, [{ module: "merci", ok: true }]);
  let data = await D.readData(ctx, { fresh: true });
  assert.equal(data.messages.get(a.id).texts.fr, "Un", "le message déjà écrit pour la fiche gardée n'est jamais écrasé");
  assert.ok(!data.messages.has(b.id));
  assert.deepEqual(data.honors.map((h) => h.contactId), [a.id]);
  const erased = await book.methods.erase({ id: a.id, confirm: true });
  assert.deepEqual(erased.modules, [{ module: "merci", ok: true, removed: 2 }]);
  data = await D.readData(ctx, { fresh: true });
  assert.deepEqual([...data.messages.keys()], [c.id]);
  assert.equal(data.honors.length, 0);
});

test("vie privée : des arguments absurdes ne lèvent jamais et ne changent rien", async () => {
  const { ctx, list } = setup(1);
  await D.setMessage(ctx, list[0].id, { fr: "Là" });
  const sub = def.services["privacy.subject"];
  for (const bad of [undefined, null, {}, { contactId: 5 }, { contactId: "" }, { contactId: "x".repeat(200) }, { contactId: ["a"] }]) {
    assert.deepEqual(await sub.erase(ctx, bad), { removed: 0 });
    assert.equal((await sub.export(ctx, bad)).data && Object.keys((await sub.export(ctx, bad)).data).length, 0);
  }
  for (const bad of [undefined, { from: "a" }, { from: "a", to: "a" }, { from: 1, to: 2 }]) assert.deepEqual(await sub.remap(ctx, bad), { updated: 0 });
  assert.equal((await D.readData(ctx, { fresh: true })).messages.size, 1);
});

/* ───────────── L'assistant IA ───────────── */

test("outils : l'état du mur, la liste des personnes d'un groupe (50 par page), sans jamais d'e-mail ni de téléphone", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  for (let i = 0; i < 70; i++) book.seedContact({ name: `P ${String(i).padStart(3, "0")}`, email: `p${i}@example.test`, phone: "0470", categoryIds: [cat] });
  const { ctx } = makeWorld({ book, settings: { category: cat } });
  const { list } = { list: book.dump().contacts };
  await D.setMessage(ctx, list[0].id, { fr: "Un mot" });
  const st = await def.mcp.wall_status(ctx, {});
  assert.deepEqual([st.state, st.messages], ["ok", 1]);
  assert.deepEqual(st.groups, [{ group: 1, title: "Soutiens", category: "Soutiens", people: 70, hidden: 0, truncated: false }]);
  const p1 = await def.mcp.wall_people(ctx, { group: 1 });
  const p2 = await def.mcp.wall_people(ctx, { group: 1, page: 2 });
  assert.deepEqual([p1.people.length, p2.people.length, p1.pages], [50, 20, 2]);
  assert.equal(p1.people[0].message, "Un mot");
  const dump = JSON.stringify([st, p1, p2]);
  assert.ok(!dump.includes("example.test") && !dump.includes("0470"));
  await assert.rejects(def.mcp.wall_people(ctx, { group: 4 }), /No such group/);
});

test("outils : écrire un message, le remplacer par langue, le retirer ; fiche inconnue et texte trop long refusés avec une phrase utile", async () => {
  const { ctx, list } = setup(2);
  const id = list[0].id;
  assert.equal((await def.mcp.message_set(ctx, { contactId: id, text: "Merci" })).locale, "fr");
  await def.mcp.message_set(ctx, { contactId: id, text: "Thanks", locale: "en" });
  assert.deepEqual((await D.readData(ctx, { fresh: true })).messages.get(id).texts, { fr: "Merci", en: "Thanks" });
  await def.mcp.message_set(ctx, { contactId: id, text: "Merci beaucoup", locale: "klingon" });
  assert.equal((await D.readData(ctx, { fresh: true })).messages.get(id).texts.fr, "Merci beaucoup", "langue inconnue : celle du site");
  await assert.rejects(def.mcp.message_set(ctx, { contactId: "inconnu", text: "x" }), (e) => e.expose === true && /No such card/.test(e.message));
  await assert.rejects(def.mcp.message_set(ctx, { contactId: id, text: "x".repeat(161) }), (e) => e.expose === true && /160/.test(e.message));
  await assert.rejects(def.mcp.message_set(ctx, { contactId: id, text: "  " }), (e) => e.expose === true);
  assert.deepEqual(await def.mcp.message_clear(ctx, { contactId: id, locale: "en" }), { removed: true, contactId: id, locale: "en" });
  assert.deepEqual((await D.readData(ctx, { fresh: true })).messages.get(id).texts, { fr: "Merci beaucoup" });
  await def.mcp.message_clear(ctx, { contactId: id });
  assert.equal((await D.readData(ctx, { fresh: true })).messages.size, 0);
  assert.deepEqual(await def.mcp.message_clear(ctx, { contactId: id }), { removed: false });
});

test("outils : mettre à l'honneur (ce mois-ci ou l'un des onze suivants), retirer ; mois absurde refusé", async () => {
  const { ctx, list } = setup(2);
  const now = P.monthKey();
  const r = await def.mcp.honor_set(ctx, { contactId: list[0].id, why: "Toujours là" });
  assert.deepEqual([r.saved, r.month], [true, now]);
  await def.mcp.honor_set(ctx, { contactId: list[1].id, month: P.addMonths(now, 11) });
  await assert.rejects(def.mcp.honor_set(ctx, { contactId: list[1].id, month: P.addMonths(now, 12) }), /month must be one of/);
  await assert.rejects(def.mcp.honor_set(ctx, { contactId: list[1].id, month: "2020-01" }), /month must be one of/);
  await assert.rejects(def.mcp.honor_set(ctx, { contactId: list[1].id, month: "demain" }), /month must be one of/);
  await assert.rejects(def.mcp.honor_set(ctx, { contactId: list[1].id, why: "x".repeat(301) }), /too long/);
  assert.equal((await D.readData(ctx, { fresh: true })).honors.length, 2);
  assert.deepEqual(await def.mcp.honor_clear(ctx, { month: now }), { removed: true, month: now });
  await assert.rejects(def.mcp.honor_clear(ctx, { month: "x" }), /month is required/);
});

test("outils : Contacts muet → une phrase claire, jamais d'écriture à l'aveugle", async () => {
  const { ctx, book, list } = setup(2);
  book.faults.hang.add("resolve");
  await assert.rejects(def.mcp.message_set(ctx, { contactId: list[0].id, text: "x" }), /does not answer/);
  assert.equal(ctx.dumpStore().length, 0);
});

/* ───────────── Le manifeste ───────────── */

test("manifeste : Contacts v2 obligatoire, vie privée offerte, groupes et catégorie cachée en « choix parmi » (jamais un nom à taper), cœur 0.2.5", () => {
  assert.equal(manifest.minCore, "0.2.5");
  assert.deepEqual(manifest.requires.map((r) => [r.service, r.min, r.optional]), [["contact.book", 2, undefined]]);
  assert.deepEqual(manifest.offers.map((o) => [o.service, o.each]), [["privacy.subject", true]]);
  for (const key of ["category", "category2", "category3", "category4", "category5", "category6", "hide"]) {
    const f = manifest.settings.find((s) => s.key === key);
    assert.equal(f.type, "choice", key);
    assert.deepEqual(f.source, { kind: "service", service: "contact.book", list: "categories", get: "categoriesResolve", create: "createCategory" });
    assert.equal(f.refersTo, "category");
    assert.equal(f.allowCreate, true);
  }
  assert.equal(manifest.settings.find((s) => s.key === "category").optional, undefined, "le groupe 1 est à remplir (ou pris d'office s'il n'y a qu'une catégorie)");
  assert.equal(manifest.settings.find((s) => s.key === "hide").optional, true);
  assert.equal(manifest.optionalGroups.length, 5);
  for (const g of manifest.optionalGroups) for (const k of g.fields) assert.ok(manifest.settings.some((s) => s.key === k), k);
  assert.deepEqual(manifest.tabs, [{ id: "use", label: { fr: "Mon mur", en: "My wall" } }]);
  assert.equal(manifest.basePath, "merci");
  assert.deepEqual(manifest.permissions.sort(), ["admin", "mcp", "pages", "storage"], "ni routes, ni réseau, ni courriel");
});

test("manifeste : les outils qui écrivent ne sont jamais accordés d'office ; ceux qui effacent sont marqués ; les noms sont courts", () => {
  const by = Object.fromEntries(manifest.mcp.map((m) => [m.name, m]));
  assert.deepEqual(Object.keys(by).sort(), Object.keys(def.mcp).sort());
  for (const name of ["wall_status", "wall_people"]) assert.equal(by[name].readOnly, true);
  for (const name of ["message_set", "honor_set"]) assert.ok(!by[name].readOnly && by[name].default !== true, name);
  for (const name of ["message_clear", "honor_clear"]) assert.ok(by[name].destructive === true && by[name].default === false, name);
  for (const m of manifest.mcp) assert.ok(`thanks-wall__${m.name}`.length <= 64);
});

test("la page publique, la racine et les groupes n'écrivent rien (aucune route, aucun stockage modifié)", async () => {
  const { ctx } = setup(3);
  assert.equal(def.routes, undefined);
  const before = JSON.stringify(ctx.dumpStore());
  await def.page(ctx, { segments: [] }); await def.page(ctx, { segments: ["g", "1"] });
  assert.equal(JSON.stringify(ctx.dumpStore()), before);
  assert.equal(ctx.calls.writes.length, 0);
});
