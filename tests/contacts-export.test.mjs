// Contacts (lot K2) — l'export CSV complet : mêmes colonnes que l'import, aller-retour sans perte, par pages de 500, droits (« exporter le carnet », e-mails et
// téléphones), protection des formules, jamais de secret, stockage muet.
import test from "node:test";
import assert from "node:assert/strict";
import { memStore } from "./helpers/contactsStore.mjs";
import { makeCtx, def, B, C, svc, importAll, exportText, collect, allCards, shiftIds, readJson } from "./helpers/contactsK2.mjs";

async function seed(ctx) {
  const cat1 = (await B.createCategory(ctx, { label: "Amis" }, { allowed: true })).id;
  const cat2 = (await B.createCategory(ctx, { label: "Cible | de raid" }, { allowed: true })).id;
  const org = await svc.create(ctx, { name: "Studio « Lune », SARL", kind: "org", email: "contact@studio.example.test" });
  const ada = await svc.create(ctx, { name: "Ada Éléonore", email: "ada@example.test", phone: "+32 470 11 22 33", organisation: "Studio « Lune », SARL", role: "Productrice", relation: "Rencontrée à un salon", others: "=HYPERLINK(\"http://x.example\")\nligne 2, avec virgule" });
  for (const [network, handle] of [["twitch", "ada_live"], ["youtube", "@ada-chan"], ["bluesky", "ada.example.test"], ["tiktok", "ada.dance"], ["instagram", "ada.photos"], ["x", "ada_x"], ["mastodon", "ada@social.example"], ["discord", "ada.d"], ["web", "ada.example.test/blog?a=1|2"], ["other", "Mon | blog 100% à moi"]]) {
    const r = await B.addAccount(ctx, { id: ada.id, network, handle });
    assert.equal(r.ok, true, `${network}: ${r.error}`);
  }
  await B.setCategories(ctx, ada.id, [cat1, cat2]);
  await svc.note(ctx, { id: ada.id, text: "Premier échange.\n---\nAvec une ligne de tirets.\n\\--- et un antislash", author: "admin" });
  await svc.note(ctx, { id: ada.id, text: "Deuxième note, avec \"guillemets\" et ; point-virgule.", author: "contact-form" });
  await B.setManualPhoto(ctx, ada.id, "https://img.example.test/ada.jpg");
  const bob = await svc.create(ctx, { name: "Bob Sans Rien" });
  const toReview = await svc.create(ctx, { name: "Chloé À Vérifier", email: "chloe@example.test" });
  await def.adminActions.verify(ctx, { id: ada.id });
  await B.update(ctx, { id: toReview.id, status: "to_review" }, { allowStatus: true });
  void org; void bob;
  return { ada: ada.id };
}
const stripId = (csv, delimiter) => {
  const rows = [...C.parseCsv(csv.replace(/^﻿/, ""), delimiter)].map((r) => r.cells);
  const i = rows[0].findIndex((h) => h === "id");
  return rows.map((r) => r.filter((_, j) => j !== i));
};

test("colonnes : les mêmes titres que l'import (français / anglais), BOM, séparateur du tableur (point-virgule en français), une ligne par fiche", async () => {
  for (const [locale, delimiter] of [["fr", ";"], ["en", ","]]) {
    const ctx = makeCtx({ locale });
    await seed(ctx);
    const csv = await exportText(ctx);
    assert.equal(csv.charCodeAt(0), 0xfeff, "BOM : Excel lit les accents");
    const rows = [...C.parseCsv(csv, delimiter)].map((r) => r.cells);
    assert.deepEqual(rows[0], C.headerLabels(locale));
    assert.deepEqual(C.readHeader(rows[0]).unknown, [], "l'import comprend chaque titre de l'export");
    assert.equal(rows.length, 1 + 4, "titres + l'organisation « Studio » + 3 personnes");
    assert.ok(rows.every((r) => r.length === rows[0].length));
    assert.equal(csv.split("\r\n").length, 6, "lignes terminées par CRLF");
  }
});

test("aller-retour : exporter puis réimporter dans un carnet vide redonne les mêmes fiches (comptes, catégories, notes datées, photo, formules, accents, retours à la ligne)", async () => {
  for (const locale of ["fr", "en"]) {
    const a = makeCtx({ locale });
    await seed(a);
    const csv1 = await exportText(a);
    const b = makeCtx({ locale: locale === "fr" ? "en" : "fr", rights: ["email.view", "categories.create", "export"] });
    await shiftIds(b, 60); // autre carnet : jamais les mêmes identifiants
    const r = await importAll(b, csv1.replace(/^﻿/, ""));
    assert.deepEqual(r.counts, { created: 4, linked: 0, skipped: 0, error: 0 }, JSON.stringify(r.counts));
    assert.deepEqual(r.preview, r.counts);
    // On exporte le nouveau carnet dans la langue de départ : le fichier est identique, identifiants mis à part.
    b.locale = locale; // même langue d'export
    const csv2 = await exportText(Object.assign(makeCtx({ locale, store: b.api.store }), { instance: b.instance }));
    const d = locale === "fr" ? ";" : ",";
    assert.deepEqual(stripId(csv2, d), stripId(csv1, d));
    // Point par point sur la fiche la plus chargée.
    const ada = (await allCards(b)).find((c) => c.name === "Ada Éléonore");
    const full = (await svc.get(b, { id: ada.id })).contact;
    assert.equal(full.accounts.length, 10);
    assert.equal(full.notes.length, 2);
    assert.deepEqual(full.notes.map((n) => n.author).sort(), ["admin", "contact-form"]);
    assert.equal(full.notes.find((n) => n.author === "admin").text, "Premier échange.\n---\nAvec une ligne de tirets.\n\\--- et un antislash");
    assert.equal(full.others, "=HYPERLINK(\"http://x.example\")\nligne 2, avec virgule", "la protection de la formule est retirée à l'import");
    assert.equal(full.photo.url, "https://img.example.test/ada.jpg");
    assert.equal(full.orgName, "Studio « Lune », SARL");
    assert.equal((await svc.categories(b, {})).items.map((c) => c.label).sort().join("/"), "Amis/Cible | de raid");
    assert.equal(full.accounts.find((x) => x.network === "web").handle, "ada.example.test/blog?a=1|2");
    assert.equal(full.accounts.find((x) => x.network === "other").handle, "Mon | blog 100% à moi");
    // Les statuts reviennent aussi.
    assert.equal((await allCards(b)).find((c) => c.name.startsWith("Chloé")).status, "to_review");
  }
});

test("formules : une cellule qui commence par = + - @ est protégée par une apostrophe dans le fichier (sauf un numéro de téléphone)", async () => {
  const ctx = makeCtx({ locale: "en" });
  await svc.create(ctx, { name: "=1+1", phone: "+32 470 00 00 00", role: "-cmd", others: "@x" });
  const csv = await exportText(ctx);
  assert.match(csv, /\r\n'=1\+1,/);
  assert.match(csv, /,\+32 470 00 00 00,/);
  assert.match(csv, /,'-cmd,/);
  assert.match(csv, /,'@x,/);
});

test("droits : sans « voir les e-mails et téléphones » le fichier n'en contient aucun ; le téléchargement exige « exporter le carnet » ; un modèle sans donnée est offert aux administrateurs", async () => {
  const full = makeCtx({ locale: "en" });
  await seed(full);
  const limited = makeCtx({ locale: "en", store: full.api.store, rights: ["export"] });
  limited.instance = full.instance;
  const csv = await exportText(limited);
  assert.ok(!csv.includes("@example.test") && !csv.includes("+32 470") && !csv.includes("contact@studio"), "ni e-mail ni téléphone");
  assert.match(csv, /Ada Éléonore/, "les fiches y sont");
  assert.equal(def.adminDownloads.contacts.right, "export");
  assert.equal(def.adminDownloads.person.right, "export");
  assert.equal(def.adminDownloads.template.right, undefined, "le modèle ne contient aucune donnée personnelle");
  assert.equal(def.adminDownloads.importReport.right, undefined);
  assert.ok(readJson("module.json").rights.some((r) => r.id === "export"));
  // Le bouton n'est montré qu'à ceux qui ont le droit.
  const noRight = await def.adminPanel(makeCtx({ rights: [] }), { query: { view: "import" } });
  assert.ok(!noRight.some((b) => b.type === "download" && b.name === "contacts"));
  assert.match(JSON.stringify(noRight), /Your role cannot export the address book/);
  assert.ok((await def.adminPanel(limited, { query: { view: "import" } })).some((b) => b.type === "download" && b.name === "contacts"));
  assert.match(JSON.stringify(await def.adminPanel(limited, { query: { view: "import" } })), /E-mails and phone numbers will not be in the file/);
  const tpl = (await collect(def.adminDownloads.template.generate(makeCtx({ locale: "fr" })))).join("");
  assert.match(tpl, /^﻿nom;type;fonction/);
  assert.ok(!/@(?!exemple\.test|studio-exemple)/.test(tpl.replace(/twitch:[^;]*|youtube:@[^;]*/g, "")), "que des exemples inventés");
});

test("modèle : les lignes d'exemple s'importent telles quelles (français et anglais)", async () => {
  for (const locale of ["fr", "en"]) {
    const ctx = makeCtx({ locale });
    const tpl = (await collect(def.adminDownloads.template.generate(ctx))).join("").replace(/^﻿/, "");
    const r = await importAll(ctx, tpl);
    assert.deepEqual(r.counts, { created: 3, linked: 0, skipped: 0, error: 0 }, `${locale} ${JSON.stringify(r.counts)}`);
    const first = (await allCards(ctx)).find((c) => /Exemple|Example/.test(c.name) && c.kind === "person");
    const full = (await svc.get(ctx, { id: first.id })).contact;
    assert.equal(full.notes.length, 1);
    assert.equal(full.accounts.length, 2);
  }
});

test("par pages : 1 200 fiches = 1 titre + 3 morceaux de 500 au plus ; lectures du stockage bornées ; le fichier se lit comme un flux", async () => {
  const store = memStore();
  const ctx = makeCtx({ store });
  await store.addMany("contacts", Array.from({ length: 1200 }, (_, i) => ({ data: { kind: "person", name: `Person ${i}`, status: "active", source: "t", role: "", email: "", phone: "", others: "", relation: "", orgId: null, categoryIds: [], accounts: [], photo: null } })));
  const seen = { page: 0, maxList: 0, maxPage: 0 };
  const page = store.page, listByKey = store.listByKey;
  store.page = async (c, o) => { seen.page++; seen.maxPage = Math.max(seen.maxPage, o?.limit ?? 100); return page(c, o); };
  store.listByKey = async (c, k, o) => { seen.maxList = Math.max(seen.maxList, o?.limit ?? 100); return listByKey(c, k, o); };
  const chunks = await collect(def.adminDownloads.contacts.generate(ctx));
  assert.equal(chunks.length, 1 + 3);
  for (const c of chunks.slice(1)) assert.ok(c.split("\r\n").length - 1 <= 500);
  assert.ok(seen.maxPage <= 1000 && seen.maxList <= 50, JSON.stringify(seen));
  const names = chunks.join("").split("\r\n").slice(1, -1).map((l) => l.split(",")[0]);
  assert.equal(new Set(names).size, 1200, "chaque fiche une fois, sans trou");
  // Le carnet bouge pendant le téléchargement : pas de doublon ni de trou pour ce qui existait déjà.
  const gen = def.adminDownloads.contacts.generate(ctx);
  const got = [(await gen.next()).value, (await gen.next()).value];
  await svc.create(ctx, { name: "Arrivée en cours de route" });
  for await (const c of gen) got.push(c);
  const lines = got.join("").split("\r\n").slice(1, -1).map((l) => l.split(",")[0]);
  assert.equal(new Set(lines).size, lines.length, "aucun doublon");
  assert.ok(["Person 0", "Person 1199"].every((n) => lines.includes(n)));
});

test("jamais de secret ni de donnée de cache : seulement les colonnes de la fiche (pas d'abonnés, de photo tierce, de jeton)", async () => {
  const ctx = makeCtx({ locale: "en", settings: { apiKey: "SECRET-VALUE-123" } });
  const a = await svc.upsertByAccount(ctx, { network: "youtube", handle: "@somebody", source: "test-suite", name: "Somebody" });
  await svc.setAccountProfile(ctx, { id: a.id, accountId: a.accountId, avatar: "https://yt3.example.test/x.jpg", followers: 12345, displayName: "Some Body", source: "test-suite", at: new Date().toISOString() });
  const csv = await exportText(ctx);
  assert.ok(!/SECRET|12345|yt3\.example|Some Body|profile/i.test(csv), csv);
  assert.match(csv, /youtube:@somebody/);
});

test("trou noir : un stockage qui ne répond plus coupe le fichier avec une erreur (jamais un fichier tronqué qui aurait l'air complet) dans le temps imparti", async () => {
  const store = memStore();
  const ctx = makeCtx({ store, test: { exportPageMs: 80, indexWaitMs: 80, storeCallMs: 60 } });
  await seed(ctx);
  const gen = def.adminDownloads.contacts.generate(ctx);
  const head = await gen.next();
  assert.match(head.value, /^﻿name,type/);
  store.faults.hang.add("get");
  const t = Date.now();
  await assert.rejects(gen.next(), (e) => e?.code === "busy");
  assert.ok(Date.now() - t < 1500);
});

test("aller-retour de gros carnets : 2 000 puis 10 000 fiches — fichier identique, aucune perte", { timeout: 120_000 }, async () => {
  for (const n of [2000, 10_000]) {
    const a = makeCtx({ locale: "en", test: { importStepMs: 20_000 } });
    const rows = Array.from({ length: n }, (_, i) => ({ data: { kind: "person", name: `Personne Élodie ${i}`, status: i % 9 === 0 ? "to_review" : "active", source: "migration", role: i % 3 ? "Rôle, avec virgule" : "", email: i % 4 ? `p${i}@example.test` : "", phone: "", others: i % 11 ? "" : "texte\nsur deux lignes", relation: "", orgId: null, categoryIds: [], accounts: i % 2 ? [{ id: `acc${i}`, network: "twitch", handle: `user_${String(i).padStart(6, "0")}`, url: `https://www.twitch.tv/user_${String(i).padStart(6, "0")}` }] : [], photo: null }, key: i % 4 ? `e:p${i}@example.test` : undefined }));
    for (let i = 0; i < rows.length; i += 4000) await a.api.store.addMany("contacts", rows.slice(i, i + 4000));
    const csv1 = await exportText(a);
    const b = makeCtx({ locale: "en", test: { importStepMs: 20_000 } });
    await shiftIds(b, 30);
    const r = await importAll(b, csv1.replace(/^﻿/, ""), { budgetMs: 20_000 });
    assert.deepEqual(r.counts, { created: n, linked: 0, skipped: 0, error: 0 }, `${n}`);
    const csv2 = await exportText(b);
    assert.deepEqual(stripId(csv2, ","), stripId(csv1, ","), `${n} fiches`);
  }
});
