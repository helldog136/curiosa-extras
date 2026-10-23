// Témoignages : l'administration (lire, décider, modifier, ajouter, partager), le fichier à télécharger, le ménage et les actions pour assistants.
import test from "node:test";
import assert from "node:assert/strict";
import { def, manifestJson, messages, L, D, A, ctxFor, seed, seedMany, review, send, htmlOf, flat, stored, NOW, DAY } from "./helpers/testimonials.mjs";

const rows = (blocks) => blocks.filter((b) => b.type === "table").flatMap((t) => t.rows);
const table = (blocks) => blocks.find((b) => b.type === "table");
const act = (name) => def.adminActions[name];
const run = (ctx, name, values) => (typeof act(name) === "function" ? act(name) : act(name).run)(ctx, values);
const ids = async (ctx) => (await D.readAll(ctx)).map((r) => r.id);
const status = async (ctx, id) => (await D.readOne(ctx, id)).status;
const lines = async (gen) => { let out = ""; for await (const c of gen) out += c; return out; };

test("droits : chaque action d'écriture exige un droit déclaré du module ; seule la recherche est ouverte à tous les administrateurs", () => {
  const declared = new Set(manifestJson.rights.map((r) => r.id));
  for (const [name, entry] of Object.entries(def.adminActions)) {
    if (typeof entry === "function") { assert.equal(name, "search", `${name} : une fonction seule = réservée aux administrateurs`); continue; }
    assert.ok(declared.has(entry.right), `${name} → ${entry.right}`);
    assert.ok(!entry.right.includes(":"), "un droit d'un autre module est impossible");
  }
  assert.equal(def.adminActions.remove.right, "reviews.delete");
  assert.equal(def.adminDownloads.reviews.right, "reviews.export");
});

// ── Le panneau ───────────────────────────────────────────────────────────────────────────────────────────────────
test("panneau : avis à valider d'abord, bandeau clair, actions adaptées à chaque état, e-mails cachés sans le droit", async () => {
  const ctx = ctxFor({ locale: "fr", rights: ["reviews.moderate", "reviews.delete"] });
  await seed(ctx, { name: "Attente", status: "pending", email: "ada@example.org" });
  await seed(ctx, { name: "Publié", status: "approved", featured: true });
  await seed(ctx, { name: "Refusé", status: "rejected" });
  const blocks = await def.adminPanel(ctx, { query: {} });
  assert.equal(blocks[0].type, "banner"); assert.match(blocks[0].text, /1 avis attendent votre lecture\. Rien n'est publié/);
  const t = table(blocks);
  assert.deepEqual(t.rows.map((r) => r[1]), ["Attente"]);
  assert.deepEqual(t.columns, ["Date", "Prénom ou pseudo", "Note", "Avis"], "pas de colonne e-mail sans le droit");
  assert.deepEqual(t.rowActions.map((a) => a.action ?? a.href), ["approve", "reject", "?edit={id}", "remove"]);
  assert.ok(!flat(blocks).includes("ada@example.org"), "l'e-mail n'apparaît nulle part");
  const published = table(await def.adminPanel(ctx, { query: { status: "approved" } }));
  assert.deepEqual(published.rowActions.map((a) => a.action ?? a.href), ["feature", "unpublish", "?edit={id}", "remove"]);
  assert.match(published.rows[0][4], /Publié · ★ Favori/);
  const refused = table(await def.adminPanel(ctx, { query: { status: "rejected" } }));
  assert.deepEqual(refused.rowActions.map((a) => a.action ?? a.href), ["restore", "remove"]);
  // sans le droit de supprimer, le bouton n'existe pas
  const limited = ctxFor({ rights: ["reviews.moderate"] }); await seed(limited, { status: "pending" });
  assert.ok(!table(await def.adminPanel(limited, { query: {} })).rowActions.some((a) => a.action === "remove"));
  // avec le droit, la colonne e-mail existe
  const withEmail = ctxFor({ rights: "all" }); await seed(withEmail, { status: "pending", email: "ada@example.org" });
  const t2 = table(await def.adminPanel(withEmail, { query: {} }));
  assert.equal(t2.columns.at(-1), "E-mail (private)"); assert.equal(t2.rows[0].at(-1), "ada@example.org");
  // aucun avis : un mot qui dit quoi faire
  assert.match(flat(await def.adminPanel(ctxFor({ locale: "fr" }), { query: {} })), /Partagez le lien/);
  // sans aucun avis en attente : l'onglet des avis publiés s'ouvre
  const calm = ctxFor({ locale: "fr" }); await seed(calm, { name: "Seul" });
  assert.equal(table(await def.adminPanel(calm, { query: {} })).rows[0][1], "Seul");
});

test("liste d'administration : 50 par page, pages numérotées, filtre par note, recherche (l'e-mail seulement avec le droit), requête hostile sans effet", async () => {
  const ctx = ctxFor({ rights: "all" });
  await seedMany(ctx, 120, (i) => ({ status: "pending", rating: (i % 5) + 1, email: i === 7 ? "findme@example.org" : null }));
  const p1 = await def.adminPanel(ctx, { query: { status: "pending" } });
  assert.equal(rows(p1).length, 50);
  assert.match(flat(p1), /Reviews 1 to 50 of 120/);
  assert.match(flat(p1), /"href":"\?status=pending&page=2"/);
  assert.ok(!flat(p1).includes("Previous page"));
  const p3 = await def.adminPanel(ctx, { query: { status: "pending", page: "3" } });
  assert.equal(rows(p3).length, 20);
  assert.match(flat(p3), /Reviews 101 to 120 of 120/);
  assert.match(flat(p3), /Previous page/); assert.ok(!flat(p3).includes("Next page"));
  assert.equal(rows(await def.adminPanel(ctx, { query: { status: "pending", page: "99" } })).length, 20, "une page trop loin retombe sur la dernière");
  assert.equal(rows(await def.adminPanel(ctx, { query: { status: "pending", page: "-4" } })).length, 50);
  const five = await def.adminPanel(ctx, { query: { status: "pending", stars: "5" } });
  assert.equal(rows(five).length, 24); assert.ok(rows(five).every((r) => r[2] === "5/5"));
  assert.equal(rows(await def.adminPanel(ctx, { query: { status: "pending", q: "findme" } })).length, 1);
  const blind = ctxFor({ rights: [] }); await seed(blind, { status: "pending", email: "findme@example.org" });
  assert.equal(rows(await def.adminPanel(blind, { query: { status: "pending", q: "findme" } })).length, 0, "on ne cherche pas dans ce qu'on n'a pas le droit de voir");
  const hostile = await def.adminPanel(ctx, { query: { status: "<script>", stars: "9", q: "<img onerror=x>", page: "NaN", edit: "../../etc", add: "1" } });
  assert.match(flat(hostile), /No review matches this filter/);
  assert.ok(rows(await def.adminPanel(ctx, { query: { status: "<script>", stars: "9", page: "NaN", edit: "../../etc" } })).length > 0, "des valeurs absurdes retombent sur les réglages par défaut");
  // la recherche renvoie vers la même page avec les filtres
  assert.deepEqual(await run(ctx, "search", { status: "approved", stars: "4", q: " ada " }), { redirect: "?status=approved&stars=4&q=ada" });
  assert.deepEqual(await run(ctx, "search", { status: "x", stars: "9", q: "" }), { redirect: "?" });
  assert.ok((await run(ctx, "search", { q: "https://evil.example" })).redirect.startsWith("?"));
});

test("onglet Partager : lien à copier, QR code sur fond blanc, téléchargement ; blocs rangés dans des onglets qui existent", async () => {
  const ctx = ctxFor({ rights: "all", locale: "fr" });
  const blocks = await def.adminPanel(ctx, { query: {} });
  const share = blocks.filter((b) => b.tab === "share");
  assert.ok(share.length >= 4);
  assert.deepEqual(share.find((b) => b.type === "copy").text, "https://example.test/avis/laisser");
  assert.match(share.find((b) => b.type === "html").html, /background:#fff/);
  assert.match(flat(share), /\/m\/tm\d+\/qr/);
  const tabIds = new Set(["use", "settings", "sources", "general", ...manifestJson.tabs.map((x) => x.id)]);
  for (const b of blocks) if (b.tab) assert.ok(tabIds.has(b.tab), b.tab);
  assert.equal(manifestJson.tabs.find((x) => x.id === "share").panel, true);
  const none = ctxFor({ rights: "all" }); none.instance.basePath = null;
  assert.equal((await def.adminPanel(none, { query: {} })).find((b) => b.tab === "share").type, "banner");
  assert.match(A.framedQr('<svg viewBox="0 0 25 25"><path d="x"/></svg>'), /viewBox="-4 -4 33 33"/);
  assert.equal(A.framedQr("<svg></svg>"), "<svg></svg>", "un dessin inattendu est rendu tel quel");
});

// ── Les décisions ────────────────────────────────────────────────────────────────────────────────────────────────
test("publier, refuser, remettre à valider, favori : chaque clic fait ce qu'il dit, rien n'est publié sans accord", async () => {
  const ctx = ctxFor({ rights: "all" });
  const id = await seed(ctx, { status: "pending", publishedAt: null, decidedAt: null });
  assert.ok((await run(ctx, "approve", { id })).ok);
  let r = await D.readOne(ctx, id);
  assert.equal(r.status, "approved"); assert.ok(r.publishedAt > 0 && r.decidedAt > 0);
  assert.ok((await run(ctx, "feature", { id })).ok); assert.equal((await D.readOne(ctx, id)).featured, true);
  assert.ok((await run(ctx, "feature", { id })).ok); assert.equal((await D.readOne(ctx, id)).featured, false, "le même bouton bascule");
  await run(ctx, "feature", { id });
  assert.ok((await run(ctx, "unpublish", { id })).ok);
  r = await D.readOne(ctx, id);
  assert.equal(r.status, "pending"); assert.equal(r.featured, false, "retiré du site = plus de favori");
  assert.ok((await run(ctx, "reject", { id })).ok); assert.equal(await status(ctx, id), "rejected");
  assert.ok((await run(ctx, "restore", { id })).ok); assert.equal(await status(ctx, id), "pending");
  // sans accord enregistré : impossible de publier
  const noConsent = await seed(ctx, { status: "pending", consent: null });
  const refused = await run(ctx, "approve", { id: noConsent });
  assert.match(refused.error, /no permission to publish/);
  assert.equal(await status(ctx, noConsent), "pending");
  // inconnu
  for (const name of ["approve", "reject", "unpublish", "restore", "feature", "remove"]) assert.match((await run(ctx, name, { id: "nope" })).error, /no longer exists/, name);
  assert.match((await run(ctx, "approve", {})).error, /no longer exists/);
});

test("plafond de publication : au-delà de 500 avis publiés, publier est refusé avec une phrase claire", async () => {
  const ctx = ctxFor();
  for (let i = 0; i < L.MAX_PUBLISHED; i++) await ctx.api.store.add("reviews", review({ name: `P${i}` }));
  const id = await seed(ctx, { status: "pending" });
  assert.match((await run(ctx, "approve", { id })).error, /already many reviews/);
  assert.equal(await status(ctx, id), "pending");
});

test("supprimer : tout part (avis, e-mail, accord) ; modifier : erreurs sous chaque champ, photo sûre, e-mail effaçable, avis conservé", async () => {
  const ctx = ctxFor({ rights: "all" });
  const id = await seed(ctx, { status: "approved", email: "ada@example.org", emailUntil: new Date(NOW + DAY).toISOString() });
  const bad = await run(ctx, "save", { id, name: " ", text: "", rating: "9", position: "0" });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["name", "position", "rating", "text"]);
  assert.match(bad.errors.name, /Camille/); assert.match(bad.errors.position, /for example 1/);
  assert.equal(bad.error, undefined, "pas de message général : chaque erreur est sous son champ");
  const ok = await run(ctx, "save", { id, name: "Camille B.", text: "Texte corrigé, sans faute.", rating: "4", photo: "javascript:alert(1)", featured: "on", position: "3", clearEmail: "on" });
  assert.equal(ok.ok, "Saved."); assert.equal(ok.redirect, "?");
  const r = await D.readOne(ctx, id);
  assert.deepEqual([r.name, r.rating, r.featured, r.position, r.photo, r.email, r.status], ["Camille B.", 4, true, 3, null, null, "approved"]);
  assert.ok(r.editedAt > 0); assert.ok(r.consentAt > 0, "l'accord reste");
  assert.ok((await run(ctx, "save", { id, name: "Camille B.", text: "Texte corrigé, sans faute.", rating: "4", photo: "/uploads/a.png?c=1", featured: "", position: "" })).ok);
  assert.equal((await D.readOne(ctx, id)).photo, "/uploads/a.png?c=1");
  assert.equal((await D.readOne(ctx, id)).featured, false);
  const untouched = await D.readOne(ctx, id);
  await run(ctx, "save", { id, name: "Camille B.", text: "Texte corrigé, sans faute.", rating: "4" });
  assert.equal((await D.readOne(ctx, id)).editedAt, untouched.editedAt, "rien de changé dans les mots : pas de « modifié »");
  assert.ok((await run(ctx, "remove", { id })).ok);
  assert.equal(stored(ctx).length, 0);
  // le formulaire de modification rappelle comment l'accord a été donné
  const again = await seed(ctx, { status: "pending", email: "ada@example.org" });
  const panel = await def.adminPanel(ctx, { query: { edit: again } });
  const form = panel.find((b) => b.type === "adminForm" && b.action === "save");
  assert.match(panel.find((b) => b.type === "markdown").text, /permission given on .*: “J'accepte”/);
  assert.ok(form.fields.find((f) => f.name === "clearEmail").label.includes("ada@example.org"));
  const blind = ctxFor({ rights: ["reviews.moderate"] }); const b2 = await seed(blind, { status: "pending", email: "ada@example.org" });
  assert.ok(!flat(await def.adminPanel(blind, { query: { edit: b2 } })).includes("ada@example.org"));
});

test("ajouter un avis reçu ailleurs : l'accord de la personne est exigé, l'avis entre « à valider » avec la mention « recueilli par vous »", async () => {
  const ctx = ctxFor({ rights: "all" });
  const none = await run(ctx, "add", { name: "Ada", text: "Un très bon moment passé ici.", rating: "5" });
  assert.match(none.errors.consent, /without the person's permission/);
  assert.equal(stored(ctx).length, 0);
  const empty = await run(ctx, "add", { name: "", text: "", consent: "on" });
  assert.deepEqual(Object.keys(empty.errors).sort(), ["name", "text"]);
  const ok = await run(ctx, "add", { name: "Ada", text: "Un très bon moment passé ici.", rating: "5", consent: "on" });
  assert.equal(ok.redirect, "?status=pending");
  const [r] = stored(ctx);
  assert.equal(r.data.status, "pending"); assert.equal(r.data.consent.by, "owner"); assert.equal(r.data.tokenHash, "");
  assert.ok(!flat(await def.page(ctx, { segments: [] })).includes("Ada"), "il n'est pas encore publié");
  assert.ok((await def.adminPanel(ctx, { query: { add: "1" } })).some((b) => b.type === "adminForm" && b.action === "add"));
});

// ── Fichier à télécharger et sauvegarde ───────────────────────────────────────────────────────────────────────────────
test("fichier CSV : preuve d'accord incluse, séparateur du pays, formules neutralisées, e-mails seulement avec le droit ET la case, lu morceau par morceau", async () => {
  const ctx = ctxFor({ locale: "fr", rights: ["reviews.export"] });
  await seed(ctx, { name: "=HYPERLINK(\"x\")", text: "@cmd|' /C calc'!A0 ; avec \"guillemets\"", email: "ada@example.org", emailUntil: new Date(NOW + DAY).toISOString(), featured: true });
  const dl = def.adminDownloads.reviews;
  const csv = await lines(dl.generate(ctx, { emails: "0" }));
  assert.ok(csv.startsWith("﻿\"Date\";\"État\";\"Favori\""), "BOM et point-virgule en français");
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(csv, /"'@cmd\|' \/C calc'!A0 ; avec ""guillemets"""/);
  assert.match(csv, /"2\d{3}-\d\d-\d\d";"Publié";"oui";"5";/);
  assert.match(csv, /"J'accepte"/); assert.match(csv, /donné sur le formulaire/);
  assert.ok(!csv.includes("ada@example.org"));
  assert.ok(!(await lines(dl.generate(ctx, { emails: "1" }))).includes("ada@example.org"), "la case ne suffit pas : il faut aussi le droit de voir les e-mails");
  const all = ctxFor({ locale: "fr", rights: ["reviews.export", "email.view"] }); await seed(all, { email: "ada@example.org", emailUntil: new Date(NOW + DAY).toISOString() });
  assert.match(await lines(dl.generate(all, { emails: "1" })), /ada@example\.org/);
  assert.ok(!(await lines(dl.generate(all, { emails: "0" }))).includes("ada@example.org"));
  const en = ctxFor({ locale: "en" }); await seed(en, {});
  assert.ok((await lines(dl.generate(en, {}))).startsWith('﻿"Date","Status"'), "virgule en anglais");
  assert.match(dl.filename(en), /^reviews-\d{4}-\d\d-\d\d$/);
  // 700 avis : tout sort, en plusieurs lectures
  const big = ctxFor({ locale: "en" });
  for (let i = 0; i < 700; i++) await big.api.store.add("reviews", review({ name: `N${i}` }));
  const out = await lines(dl.generate(big, {}));
  assert.equal(out.trim().split("\r\n").length, 701);
  // le panneau annonce les deux boutons au bon public
  const panelAll = await def.adminPanel(all, { query: {} });
  assert.equal(panelAll.filter((b) => b.type === "download").length, 2);
  assert.equal((await def.adminPanel(ctxFor({ rights: ["reviews.export"] }), { query: {} })).filter((b) => b.type === "download").length, 1);
});

test("sauvegarde lisible : un tableur des avis, sans aucune adresse e-mail", async () => {
  const ctx = ctxFor({ locale: "fr" });
  await seed(ctx, { email: "ada@example.org", emailUntil: new Date(NOW + DAY).toISOString() });
  const [file] = await def.backup.readable(ctx);
  assert.equal(file.path, "reviews.csv");
  assert.ok(!file.content.includes("ada@example.org"));
  assert.match(file.content, /Camille/);
});

// ── Ménage et durées de conservation ───────────────────────────────────────────────────────────────────────────────
test("ménage : l'e-mail s'efface à sa date (l'avis reste), les refusés partent après 30 jours, les brouillons après 30 minutes ; rejouer ne change plus rien", async () => {
  const ctx = ctxFor();
  const old = await seed(ctx, { status: "approved", email: "old@example.org", emailUntil: new Date(NOW - 1000).toISOString() });
  const young = await seed(ctx, { status: "approved", email: "young@example.org", emailUntil: new Date(NOW + 5 * DAY).toISOString() });
  const nodate = await seed(ctx, { status: "approved", email: "nodate@example.org", emailUntil: null });
  const rej = await seed(ctx, { status: "rejected", decidedAt: new Date(NOW - 31 * DAY).toISOString() });
  const rejYoung = await seed(ctx, { status: "rejected", decidedAt: new Date(NOW - 5 * DAY).toISOString() });
  const pend = await seed(ctx, { status: "pending", decidedAt: null, at: NOW - 90 * DAY });
  const freshDraft = await D.saveDraft(ctx, { name: "Ada", text: "Texte", email: "z@example.org", rating: 3 }, { text: "textShort" });
  await ctx.api.store.add("drafts", { ref: "a".repeat(24), at: new Date(NOW - 31 * 60_000).toISOString(), values: { name: "x" }, errors: {} });
  const report = await D.tidy(ctx, NOW);
  assert.deepEqual(report, { emails: 2, refused: 1, drafts: 1 });
  assert.equal((await D.readOne(ctx, old)).email, null); assert.equal((await D.readOne(ctx, old)).status, "approved", "l'avis reste");
  assert.equal((await D.readOne(ctx, young)).email, "young@example.org");
  assert.equal((await D.readOne(ctx, nodate)).email, null, "une adresse sans date de fin n'est pas gardée");
  assert.equal(await D.readOne(ctx, rej), null); assert.ok(await D.readOne(ctx, rejYoung)); assert.ok(await D.readOne(ctx, pend), "un avis en attente n'est jamais effacé tout seul");
  assert.equal(ctx.dumpStore().filter((r) => r.collection === "drafts").length, 1);
  assert.ok(freshDraft);
  assert.deepEqual(await D.tidy(ctx, NOW), { emails: 0, refused: 0, drafts: 0 });
  assert.equal(typeof def.tasks.tidy.run, "function"); assert.equal(def.tasks.tidy.everyMinutes, 1440);
  await def.tasks.tidy.run(ctx);
});

test("brouillons : jamais plus de 100, jamais l'accord, jamais plus que la taille d'un avis", async () => {
  const ctx = ctxFor();
  for (let i = 0; i < 130; i++) await D.saveDraft(ctx, { name: `n${i}`, text: "x".repeat(50_000), email: "e".repeat(5000), rating: 4, consent: true }, { consent: "consent" });
  const drafts = ctx.dumpStore().filter((r) => r.collection === "drafts");
  assert.ok(drafts.length <= L.MAX_DRAFTS, `${drafts.length} brouillons`);
  assert.ok(drafts.every((d) => d.data.values.text.length <= L.FIELD_MAX.text && !("consent" in d.data.values)));
});

// ── Assistants ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test("actions pour assistants : jamais d'e-mail, pages à curseur, publier exige l'accord, supprimer est destructive", async () => {
  const ctx = ctxFor();
  await seedMany(ctx, 45, (i) => ({ status: i % 3 === 0 ? "pending" : "approved", email: "secret@example.org", emailUntil: new Date(NOW + DAY).toISOString(), rating: (i % 5) + 1 }));
  const first = await def.mcp.testimonials_list(ctx, { limit: 20 });
  assert.equal(first.items.length, 20); assert.equal(first.next, "20");
  const second = await def.mcp.testimonials_list(ctx, { limit: 20, cursor: first.next });
  const third = await def.mcp.testimonials_list(ctx, { limit: 20, cursor: second.next });
  assert.equal(third.items.length, 5); assert.equal(third.next, null);
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map((x) => x.id)).size, 45);
  assert.ok(!JSON.stringify([first, second, third]).includes("secret@example.org"));
  assert.ok(!JSON.stringify(first.items[0]).match(/email|tokenHash/i));
  const pending = await def.mcp.testimonials_list(ctx, { status: "pending", limit: 100 });
  assert.equal(pending.items.length, 15); assert.ok(pending.items.every((x) => x.status === "pending"));
  assert.ok((await def.mcp.testimonials_list(ctx, { stars: 5, limit: 100 })).items.every((x) => x.rating === 5));
  assert.equal((await def.mcp.testimonials_list(ctx, { cursor: "x;drop", limit: 3 })).items.length, 3, "un curseur illisible repart du début");
  const sum = await def.mcp.testimonials_summary(ctx);
  assert.deepEqual([sum.pending, sum.published, sum.refused], [15, 30, 0]);
  assert.equal(sum.rated, 30); assert.equal(typeof sum.average, "number"); assert.equal(Object.keys(sum.distribution).length, 5);
  const target = pending.items[0];
  assert.equal((await def.mcp.testimonials_decide(ctx, { id: target.id, action: "approve" })).status, "approved");
  assert.equal((await def.mcp.testimonials_decide(ctx, { id: target.id, action: "feature" })).featured, true);
  assert.equal((await def.mcp.testimonials_decide(ctx, { id: target.id, action: "reject" })).status, "rejected");
  const noConsent = await seed(ctx, { status: "pending", consent: null });
  await assert.rejects(def.mcp.testimonials_decide(ctx, { id: noConsent, action: "approve" }), (e) => e.expose === true && /no permission/.test(e.message));
  await assert.rejects(def.mcp.testimonials_decide(ctx, { id: "nope", action: "approve" }), (e) => e.expose === true);
  await assert.rejects(def.mcp.testimonials_decide(ctx, { id: target.id, action: "explode" }), (e) => e.expose === true);
  assert.deepEqual(await def.mcp.testimonials_delete(ctx, { id: target.id }), { id: target.id, deleted: true });
  await assert.rejects(def.mcp.testimonials_delete(ctx, { id: target.id }), (e) => e.expose === true);
  assert.equal(await def.adminBadge(ctx), 15 - 1 + 1, "pastille = avis à valider");
});

test("la pastille du menu compte les avis à valider, et rien d'autre", async () => {
  const ctx = ctxFor();
  assert.equal(await def.adminBadge(ctx), 0);
  await seed(ctx, { status: "pending" }); await seed(ctx, { status: "approved" }); await seed(ctx, { status: "rejected" });
  assert.equal(await def.adminBadge(ctx), 1);
});
