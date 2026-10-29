// Contacts 2.0 : ce que la suite de contrat ne couvre pas. Normalisation indulgente, index mémoire (borné, invalidé, reconstruit une seule fois,
// attente avec expiration), « trou noir » (stockage ou module qui ne répond jamais), verrou d'écriture, plafond à l'import, administration
// (cartes, recherche GET, filtres, « Voir la suite », fiche, comptes avec erreurs sous le champ, catégories, photo, droits), accessibilité du HTML,
// outils MCP paginés.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { memStore } from "./helpers/contactsStore.mjs";
import { fakePrivacySubject } from "./helpers/fakeContactBook.mjs";

const DIR = new URL("../modules/contacts", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json");
const def = (await import("../modules/contacts/index.mjs")).default;
const B = await import("../modules/contacts/book.mjs");
const N = await import("../modules/contacts/networks.mjs");
const D = await import("../modules/contacts/data.mjs");
const svc = def.services["contact.book"];

let n = 0;
function makeCtx({ locale = "en", rights = ["email.view", "categories.create", "export"], store = memStore(), test: opts = {}, subjects = [] } = {}) {
  const c = fakeCtx({ moduleId: "contacts", key: `contacts-t${++n}`, locale, messages: readJson(`locales/${locale}.json`), serviceInstances: { "privacy.subject": subjects } });
  c.api.store = store;
  c.can = (r) => rights.includes(r);
  c.__contactsTest = opts;
  return c;
}
const htmlOf = (blocks) => blocks.map((b) => b.html ?? "").join("\n");
const textOf = (blocks) => JSON.stringify(blocks);

// ── Réseaux ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("normalisation indulgente : lien collé avec guillemets, chevrons, ponctuation, sous-pages ; détection du réseau d'un lien", () => {
  assert.equal(N.normalizeAccount("twitch", " <https://www.twitch.tv/Some_Streamer/videos>. ").handle, "some_streamer");
  assert.equal(N.normalizeAccount("twitch", "« twitch.tv/some_streamer »").handle, "some_streamer");
  assert.equal(N.normalizeAccount("youtube", "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/videos").handle, "UCabcdefghijklmnopqrstuv");
  assert.equal(N.normalizeAccount("bluesky", "https://bsky.app/profile/sky.example.test/post/3k").handle, "sky.example.test");
  assert.equal(N.normalizeAccount("bluesky", "@someone").handle, "someone.bsky.social", "un nom sans point devient nom.bsky.social");
  assert.equal(N.normalizeAccount("twitch", "abc").error, "invalid_handle", "Twitch : 4 caractères au moins");
  assert.equal(N.normalizeAccount("twitch", "a".repeat(26)).error, "invalid_handle", "Twitch : 25 caractères au plus");
  assert.deepEqual(["https://youtu.be/x", "twitch.tv/a_b_c", "https://x.com/abc", "https://mastodon.example/@toot", "https://example.test/page"].map(N.detectNetwork), ["youtube", "twitch", "x", "mastodon", "web"]);
  assert.equal(N.detectNetwork("just a name"), null);
  assert.deepEqual(N.accountsInText("Twitch : twitch.tv/chaine_one\nMastodon @toot@social.example\nyoutube.com/@Chan_One et encore twitch.tv/chaine_one").map((a) => `${a.network}:${a.handle}`), ["twitch:chaine_one", "youtube:@chan_one", "mastodon:toot@social.example"]);
});

// ── Index mémoire ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("index : mesure en processus séparé (100 000 fiches) — mémoire bornée par fiche, reconstruction et recherche rapides", { timeout: 120_000 }, () => {
  const r = spawnSync(process.execPath, ["--expose-gc", new URL("./helpers/contactsIndexMemory.mjs", import.meta.url).pathname, "100000"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(m.n, 100_000);
  assert.ok(m.bytesPerCard < 600, `index : ${m.bytesPerCard} octets par fiche`);
  assert.ok(m.buildMs < 15_000, `reconstruction : ${m.buildMs} ms`);
  assert.ok(m.searchMs < 1000, `recherche : ${m.searchMs} ms`);
  assert.equal(m.first, true);
});

test("index : jeté quand la génération change (restauration) ; relu quand une autre copie du module écrit (tampon) ; une seule reconstruction partagée", async () => {
  const store = memStore();
  const ctx = makeCtx({ store });
  const a = await svc.upsertByAccount(ctx, { network: "twitch", handle: "first_one", source: "test-suite" });
  assert.equal((await svc.list(ctx, {})).items.length, 1);
  // Restauration : tout le contenu change, la génération augmente.
  const snapshot = store.snapshot();
  await svc.upsertByAccount(ctx, { network: "twitch", handle: "second_one", source: "test-suite" });
  store.restore(snapshot);
  assert.deepEqual((await svc.list(ctx, {})).items.map((c) => c.id), [a.id], "après restauration, l'index relit le stockage");
  // Une autre copie du module (autre processus) écrit : nouvelle fiche + nouveau tampon.
  const other = { instance: ctx.instance, api: { store }, __contactsTest: {} };
  D.forgetIndex(other); // (même instance : on simule une copie qui n'a pas d'index)
  await B.upsertByAccount(other, { network: "twitch", handle: "from_other_copy", source: "test-suite" });
  assert.equal((await svc.accounts(ctx, { network: "twitch" })).items.length, 2);
  // Plusieurs appels pendant une reconstruction : une seule lecture du stockage.
  D.forgetIndex(ctx);
  let pages = 0;
  const page = store.page;
  store.page = async (...x) => { pages++; return page(...x); };
  await Promise.all(Array.from({ length: 10 }, () => svc.search(ctx, { q: "one" })));
  store.page = page;
  assert.ok(pages <= 4, `une seule reconstruction (contacts, orgs, catégories) : ${pages} lectures`);
});

test("trou noir : un stockage qui ne répond jamais → réponse « busy » dans le temps imparti, jamais d'attente sans fin ; la suite repart", async () => {
  const store = memStore();
  const ctx = makeCtx({ store, test: { indexWaitMs: 80, buildMaxMs: 150, storeCallMs: 60, lockWaitMs: 80, lockHoldMs: 120 } });
  await svc.upsertByAccount(ctx, { network: "twitch", handle: "steady_one", source: "test-suite" });
  D.forgetIndex(ctx);
  store.faults.hang.add("page");
  let t = Date.now();
  assert.deepEqual(await svc.list(ctx, {}), { ok: false, error: "busy" });
  assert.deepEqual(await svc.accounts(ctx, { network: "twitch" }), { ok: false, error: "busy" });
  assert.ok(Date.now() - t < 1500, "borné");
  assert.equal(await def.adminBadge(ctx), 0, "la pastille ne bloque pas l'admin");
  assert.equal((await def.adminPanel(ctx, { query: {} }))[0].type, "banner", "l'admin explique au lieu d'attendre");
  store.faults.hang.delete("page");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await svc.list(ctx, {})).items.length, 1, "la reconstruction suivante repart de zéro");
  // Une écriture qui ne finit jamais : le verrou est rendu, l'écriture suivante passe.
  store.faults.hang.add("update");
  t = Date.now();
  const stuck = await svc.update(ctx, { id: (await svc.list(ctx, {})).items[0].id, role: "x" });
  assert.deepEqual(stuck, { ok: false, error: "busy" });
  store.faults.hang.delete("update");
  assert.equal((await svc.upsertByAccount(ctx, { network: "twitch", handle: "after_stuck", source: "test-suite" })).ok, true);
  assert.ok(Date.now() - t < 2000);
  // Génération illisible (réglage qui ne répond pas) : on relit, on ne reste pas bloqué.
  store.faults.hang.add("generation");
  assert.equal((await svc.list(ctx, {})).ok, true);
  store.faults.hang.delete("generation");
});

test("trou noir : un module « privacy.subject » muet ne bloque ni l'effacement ni la fusion (borné par fournisseur, listé dans le bilan)", async () => {
  const good = fakePrivacySubject("good-one");
  const mute = { instance: "mute-one", name: "Mute", methods: { erase: () => new Promise(() => {}), remap: () => new Promise(() => {}), export: () => new Promise(() => {}) } };
  const ctx = makeCtx({ subjects: [good, mute], test: { privacyTimeoutMs: 60 } });
  const x = await svc.upsertByAccount(ctx, { network: "twitch", handle: "forget_me", source: "test-suite" });
  good.refs.set(x.id, 2);
  const t = Date.now();
  const r = await def.adminActions.remove(ctx, { id: x.id });
  assert.ok(Date.now() - t < 1000);
  assert.match(r.ok, /Did not answer in time: Mute/);
  assert.equal(good.refs.has(x.id), false);
  assert.equal(D.privacyMs(makeCtx()), 8000, "8 s par fournisseur en vrai");
});

test("verrou : 20 écritures simultanées du même compte → une seule fiche ; un compte n'appartient qu'à une fiche", async () => {
  const ctx = makeCtx();
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => svc.upsertByAccount(ctx, { network: "twitch", handle: i % 2 ? "Same_Channel" : "twitch.tv/same_channel", source: "test-suite", note: "Once." })));
  assert.equal(new Set(rs.map((r) => r.id)).size, 1);
  assert.equal(rs.filter((r) => r.created).length, 1);
  assert.equal((await svc.get(ctx, { id: rs[0].id })).contact.notes.length, 1);
  const other = await svc.create(ctx, { name: "Someone Else" });
  assert.deepEqual([(await B.addAccount(ctx, { id: other.id, network: "twitch", handle: "same_channel" })).error], ["taken"]);
});

test("plafond technique appliqué à l'import (100 000 en vrai) : les lignes au-delà sont refusées avec leur numéro, rien n'est perdu en silence", async () => {
  assert.equal(D.LIMITS.maxContacts, 100_000);
  const ctx = makeCtx({ test: { maxContacts: 5 } });
  const r = await svc.import(ctx, { rows: Array.from({ length: 8 }, (_, i) => ({ name: `Row ${i}`, accounts: [{ network: "x", handle: `row_${i}` }] })) });
  assert.deepEqual([r.added, r.existing, r.invalid.map((x) => x.line)], [5, 0, [6, 7, 8]]);
  assert.ok(r.invalid.every((x) => x.reason === "too_many"));
});

test("recherche sans accents ni casse, par pseudo, nom affiché ou organisation ; find v1 ne rend que des personnes", async () => {
  const ctx = makeCtx();
  const p = await svc.create(ctx, { name: "Élodie Fèvre", organisation: "Équipe Rouge" });
  await B.addAccount(ctx, { id: p.id, network: "twitch", handle: "elo_plays" });
  for (const q of ["elodie", "FEVRE", "@elo_plays", "elo", "equipe rouge"]) assert.ok((await svc.search(ctx, { q })).items.some((x) => x.id === p.id), q);
  assert.deepEqual((await svc.find(ctx, { q: "equipe" })).contacts.map((c) => c.id), [p.id], "l'organisation elle-même n'est pas une « personne »");
  assert.equal((await svc.find(ctx, { q: "equipe", kind: "org" })).contacts[0].kind, "org");
});

test("compatibilité Partenariats (min 1) : champs v1 gardés, « organisation » = nom de la fiche organisation, mise à jour par texte", async () => {
  const ctx = makeCtx();
  const r = await svc.create(ctx, { name: "Ada", email: "ada@example.test", organisation: "Acme Studio", role: "CEO", source: "partnerships" });
  const c = (await svc.resolve(ctx, { ids: [r.id] })).contacts[0];
  for (const k of ["id", "name", "role", "organisation", "email", "phone", "status", "source", "createdAt", "adminPath"]) assert.ok(k in c, k);
  assert.equal(c.organisation, "Acme Studio");
  await svc.update(ctx, { id: r.id, organisation: "Globex" });
  assert.equal((await svc.get(ctx, { id: r.id })).contact.organisation, "Globex");
  assert.equal((await svc.update(ctx, { id: r.id, status: "to_review" })).ok, false, "le statut ne passe pas par le service (1.x) : rien à changer");
});

// ── Administration ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function seedBook(ctx, count = 0) {
  const cat = (await B.createCategory(ctx, { label: "Raid target" }, { allowed: true })).id;
  const ada = await svc.create(ctx, { name: "Ada Example", email: "ada@example.test", phone: "+00 1", organisation: "Acme Studio", role: "Producer", others: "twitch.tv/ada_live\nDiscord: ada" });
  const yt = await B.addAccount(ctx, { id: ada.id, network: "youtube", handle: "@ada_channel" });
  await B.addAccount(ctx, { id: ada.id, network: "twitch", handle: "ada_streams" });
  await svc.setAccountProfile(ctx, { id: ada.id, accountId: yt.accountId, avatar: "https://cdn.example.test/ada.png", followers: 12400, source: "test-suite", at: new Date().toISOString() });
  await B.setCategories(ctx, ada.id, [cat]);
  for (let i = 0; i < count; i++) await svc.upsertByAccount(ctx, { network: "twitch", handle: `bulk_${String(i).padStart(3, "0")}`, source: "test-suite" });
  return { cat, ada: ada.id };
}

test("admin — liste : cartes (nom, organisation, pastilles de réseaux, photo), recherche en formulaire GET, filtres, « See more » sans doublon ni trou", async () => {
  const ctx = makeCtx();
  const { cat, ada } = await seedBook(ctx, 45);
  const blocks = await def.adminPanel(ctx, { query: {} });
  const html = htmlOf(blocks);
  assert.match(html, /<form class="ct-search" method="get" role="search">/);
  assert.match(html, /<label class="ct-sr" for="ct-q">Search the address book<\/label>/);
  assert.match(html, /47 cards/, "45 + Ada + Acme Studio");
  assert.match(html, /bulk_044/, "les plus récentes d'abord");
  const adaCard = htmlOf(await def.adminPanel(ctx, { query: { q: "ada" } }));
  assert.match(adaCard, /Ada Example/);
  assert.match(adaCard, /Producer · Acme Studio/);
  assert.match(adaCard, /<img class="ct-photo" src="https:\/\/cdn\.example\.test\/ada\.png" alt=""/);
  assert.match(adaCard, /<span class="ct-sr">YouTube<\/span>/);
  // Pagination par liens : on suit « See more » jusqu'au bout.
  const seen = [];
  let query = {};
  for (let guard = 0; guard < 10; guard++) {
    const h = htmlOf(await def.adminPanel(ctx, { query }));
    seen.push(...[...h.matchAll(/href="\?contact=([^"]+)"/g)].map((m) => decodeURIComponent(m[1])));
    const more = /<a class="ct-btn" href="\?([^"]*)">See more<\/a>/.exec(h);
    if (!more) break;
    query = Object.fromEntries(new URLSearchParams(more[1].replace(/&amp;/g, "&")));
  }
  assert.equal(seen.length, 47);
  assert.equal(new Set(seen).size, 47, "aucun doublon");
  // Recherche, filtres (catégorie, réseau, ?category= venu d'un autre module), organisations.
  assert.match(htmlOf(await def.adminPanel(ctx, { query: { q: "ada" } })), /1 result/);
  for (const q of [{ cat }, { category: cat }]) assert.deepEqual([...htmlOf(await def.adminPanel(ctx, { query: q })).matchAll(/href="\?contact=([^"]+)"/g)].map((m) => m[1]), [encodeURIComponent(ada)]);
  assert.match(htmlOf(await def.adminPanel(ctx, { query: { net: "youtube" } })), /1 card</);
  const orgs = htmlOf(await def.adminPanel(ctx, { query: { kind: "org" } }));
  assert.match(orgs, /Acme Studio/);
  assert.doesNotMatch(orgs, /Ada Example/);
  assert.match(orgs, /aria-current="page">Organisations</);
});

test("admin — fiche : photo et son origine, comptes, encadré d'installation par SERVICE, texte d'avant avec « Ajouter comme compte », notes", async () => {
  const ctx = makeCtx({ locale: "fr" });
  const { ada } = await seedBook(ctx);
  const blocks = await def.adminPanel(ctx, { query: { contact: ada } });
  const all = textOf(blocks);
  assert.match(all, /Photo YouTube \(12 400 abonnés\)/);
  assert.deepEqual(blocks.filter((b) => b.type === "suggestInstall").map((b) => [b.service, b.min]), [["twitch.api", 3], ["youtube.api", undefined]]);
  assert.ok(!all.includes("twitch-channel") && !all.includes("youtube-channel"), "on nomme un service, jamais un module");
  const accounts = blocks.find((b) => b.type === "table" && b.rowActions?.[0]?.action === "removeAccount");
  assert.deepEqual(accounts.rows.map((r) => r[0].split(" · ")[0]), ["YouTube", "Twitch"]);
  assert.match(accounts.rows[0][0], /^YouTube · @ada_channel · 12.400 abonnés$/);
  assert.match(all, /Autres canaux \(texte d'avant\)/);
  const found = blocks.find((b) => b.type === "table" && b.rowActions?.[0]?.action === "addFromText");
  assert.deepEqual(found.rows, [["Twitch · ada_live"]]);
  const r = await def.adminActions.addFromText(ctx, { id: found.rowIds[0] });
  assert.equal(r.ok, "Compte ajouté.");
  assert.ok((await svc.get(ctx, { id: ada })).contact.accounts.some((a) => a.handle === "ada_live"));
  assert.ok(!blocks.some((b) => b.action === "photoAuto"), "pas de retour à la photo automatique sans photo choisie");
  assert.equal((await def.adminActions.photo(ctx, { id: ada, photo: "/uploads/ada.jpg" })).ok, "Photo enregistrée.");
  const after = await def.adminPanel(ctx, { query: { contact: ada } });
  assert.match(textOf(after), /Photo choisie à la main/);
  assert.ok(after.some((b) => b.action === "photoAuto" && b.submitLabel === "Revenir à la photo automatique"));
  await def.adminActions.photoAuto(ctx, { id: ada });
  assert.equal((await svc.get(ctx, { id: ada })).contact.photo.source, "youtube");
  assert.deepEqual((await def.adminActions.photo(ctx, { id: ada, photo: "javascript:alert(1)" })).errors, { photo: "Cette image n'est pas utilisable : envoyez une image depuis votre appareil, ou collez une adresse https." });
  assert.equal((await def.adminActions.note(ctx, { contactId: ada, text: "Appelée." })).ok, "Note ajoutée.");
  assert.deepEqual((await def.adminActions.note(ctx, { contactId: ada, text: " " })).errors, { text: "Écrivez la note." });
});

test("admin — ajouter un compte : lien OU pseudo, erreur actionnable SOUS le champ (mauvais réseau, pseudo invalide, déjà pris)", async () => {
  const ctx = makeCtx({ locale: "fr" });
  const { ada } = await seedBook(ctx);
  const b = await svc.create(ctx, { name: "Bob" });
  assert.equal((await def.adminActions.addAccount(ctx, { id: b.id, network: "tiktok", handle: "https://www.tiktok.com/@Bob.Dance" })).ok, "Compte ajouté.");
  assert.deepEqual((await def.adminActions.addAccount(ctx, { id: b.id, network: "twitch", handle: "https://www.youtube.com/@bob" })).errors, { handle: "Ce lien est un lien YouTube : choisissez « YouTube » dans la liste Réseau." });
  assert.deepEqual((await def.adminActions.addAccount(ctx, { id: b.id, network: "web", handle: "twitch.tv/bob_live" })).errors, { handle: "Ce lien est un lien Twitch : choisissez « Twitch » dans la liste Réseau." });
  assert.match((await def.adminActions.addAccount(ctx, { id: b.id, network: "twitch", handle: "a b" })).errors.handle, /^Ce n'est pas une chaîne Twitch\. Collez l'adresse/);
  assert.deepEqual((await def.adminActions.addAccount(ctx, { id: b.id, network: "twitch", handle: "  " })).errors, { handle: "Collez un lien ou tapez un pseudo." });
  assert.match((await def.adminActions.addAccount(ctx, { id: b.id, network: "twitch", handle: "ADA_STREAMS" })).errors.handle, /déjà sur la fiche « Ada Example »/);
  assert.equal((await def.adminActions.addAccount(ctx, { id: ada, network: "twitch", handle: "@ada_streams" })).ok, "Ce compte est déjà sur la fiche.");
  const form = (await def.adminPanel(ctx, { query: { contact: b.id } })).find((x) => x.action === "addAccount");
  assert.deepEqual(form.fields.map((f) => f.name), ["id", "network", "handle"]);
  assert.equal(form.fields[1].options.length, 10);
});

test("admin — droits : sans « voir les e-mails et téléphones », ni e-mail ni téléphone affichés, et enregistrer ne les efface pas", async () => {
  const full = makeCtx();
  const { ada } = await seedBook(full);
  const limited = makeCtx({ store: full.api.store, rights: [] });
  limited.instance = full.instance; // même carnet, autre personne
  const page = textOf(await def.adminPanel(limited, { query: { contact: ada } }));
  assert.ok(!page.includes("ada@example.test") && !page.includes("+00 1"));
  assert.match(page, /see e-mails and phone numbers/);
  const form = (await def.adminPanel(limited, { query: { contact: ada, edit: "1" } })).find((b) => b.action === "save");
  assert.ok(!form.fields.some((f) => f.name === "email" || f.name === "phone"));
  assert.ok(!form.fields.some((f) => f.name === "newCategory"), "sans droit, pas de création de catégorie");
  const r = await def.adminActions.save(limited, { id: ada, kind: "person", name: "Ada E.", email: "forged@example.test", phone: "", cats: "1" });
  assert.equal(r.ok, "Saved.");
  const after = (await svc.get(full, { id: ada })).contact;
  assert.deepEqual([after.name, after.email, after.phone], ["Ada E.", "ada@example.test", "+00 1"]);
  assert.deepEqual(after.categoryIds, [], "cases décochées : catégories retirées");
  assert.ok(textOf(await def.adminPanel(full, { query: { contact: ada } })).includes("ada@example.test"));
  assert.deepEqual(manifest.rights.map((x) => x.id), ["email.view", "export", "categories.create"]);
});

test("admin — créer / modifier une fiche : erreurs sous le champ, organisation tapée = trouvée ou créée, nouvelle catégorie en une fois, « à vérifier »", async () => {
  const ctx = makeCtx({ locale: "fr" });
  assert.deepEqual((await def.adminActions.save(ctx, { kind: "person", name: " " })).errors, { name: "Écrivez un nom." });
  assert.deepEqual((await def.adminActions.save(ctx, { kind: "person", name: "Zoé", email: "zoe@" })).errors, { email: "Cette adresse e-mail n'est pas complète : écrivez-la comme nom@exemple.com." });
  const r = await def.adminActions.save(ctx, { kind: "person", name: "Zoé", organisation: "Studio Lune", role: "Graphiste", newCategory: "Amis", cats: "1", status: "to_review" });
  const id = decodeURIComponent(r.redirect.split("=")[1]);
  const c = (await svc.get(ctx, { id })).contact;
  assert.deepEqual([c.orgName, c.role, c.status], ["Studio Lune", "Graphiste", "to_review"]);
  assert.equal((await svc.categoriesResolve(ctx, { ids: c.categoryIds })).items[0].label, "Amis");
  const page = await def.adminPanel(ctx, { query: { contact: id } });
  assert.ok(page.some((b) => b.action === "verify"));
  assert.equal((await def.adminActions.verify(ctx, { id })).ok, "Fiche vérifiée.");
  assert.equal((await svc.get(ctx, { id })).contact.status, "active");
  const org = await def.adminPanel(ctx, { query: { contact: c.orgId } });
  assert.match(htmlOf(org), /Zoé/, "la fiche organisation montre ses personnes");
  assert.equal((await def.adminActions.save(ctx, { kind: "person", name: "Yann", email: "zoe2@example.test" })).ok, "Enregistré.");
  assert.deepEqual((await def.adminActions.save(ctx, { kind: "person", name: "Xavier", email: "ZOE2@example.test" })).errors, { email: "Cette adresse est déjà sur une autre fiche." });
});

test("admin — catégories : créer (droit), renommer, « Mettre dans… », supprimer (« Les fiches ne sont pas supprimées ») ; les ids suivent", async () => {
  const ctx = makeCtx({ locale: "fr" });
  const { cat, ada } = await seedBook(ctx);
  const page = await def.adminPanel(ctx, { query: { view: "categories" } });
  assert.match(htmlOf(page), new RegExp(`href="\\?view=categories&amp;edit=${cat}"[\\s\\S]*Raid target[\\s\\S]*1 fiche`));
  assert.ok(page.some((b) => b.action === "createCategory"));
  assert.equal(def.adminActions.createCategory.right, "categories.create", "le cœur vérifie le droit avant l'action");
  assert.equal((await def.adminActions.createCategory.run(ctx, { label: "Amis", color: "#58b368" })).ok, "Catégorie créée.");
  assert.deepEqual((await def.adminActions.createCategory.run(ctx, { label: "AMIS" })).errors, { label: "Cette catégorie existe déjà." });
  const amis = (await svc.categories(ctx, { q: "amis" })).items[0];
  assert.equal(amis.color, "#58b368");
  const one = await def.adminPanel(ctx, { query: { view: "categories", edit: amis.id } });
  assert.ok(one.some((b) => b.action === "renameCategory"));
  assert.ok(one.some((b) => b.action === "mergeCategory" && b.fields.find((f) => f.name === "keep").options[0].label === "Raid target"));
  const del = one.find((b) => b.type === "table");
  assert.deepEqual([del.rowActions[0].action, del.rowActions[0].confirm], ["deleteCategory", "Supprimer cette catégorie ? Les fiches ne sont pas supprimées."]);
  assert.match(textOf(one), /Mettre les fiches de « Amis » dans…/);
  assert.equal((await def.adminActions.renameCategory(ctx, { id: cat, label: "Cible de raid" })).ok, "Catégorie renommée.");
  assert.equal((await def.adminActions.mergeCategory(ctx, { drop: amis.id, keep: cat })).ok, "C'est fait : les fiches ont rejoint l'autre catégorie.");
  assert.deepEqual((await svc.categoriesResolve(ctx, { ids: [amis.id] })).moved, { [amis.id]: cat });
  assert.equal((await def.adminActions.deleteCategory(ctx, { id: cat })).ok, "Catégorie supprimée. Les fiches ne sont pas supprimées.");
  assert.equal((await svc.get(ctx, { id: ada })).ok, true);
  assert.deepEqual((await svc.get(ctx, { id: ada })).contact.categoryIds, []);
  assert.match(textOf(await def.adminPanel(ctx, { query: { view: "categories" } })), /Aucune catégorie pour l(&#39;|')instant/);
});

test("accessibilité du HTML de l'admin (FR et EN) : images avec alt, liens avec un texte, champ de recherche étiqueté, onglets nommés, ids uniques, titres", async () => {
  for (const locale of ["fr", "en"]) {
    const ctx = makeCtx({ locale });
    const { ada } = await seedBook(ctx, 3);
    const org = (await svc.get(ctx, { id: ada })).contact.orgId;
    for (const query of [{}, { q: "ada" }, { kind: "org" }, { contact: ada }, { contact: org }, { contact: ada, edit: "1" }, { new: "person" }, { view: "categories" }, { view: "categories", edit: "x" }, { cat: "nope" }, { contact: "missing" }]) {
      const blocks = await def.adminPanel(ctx, { query });
      const html = htmlOf(blocks);
      for (const img of html.match(/<img\b[^>]*>/g) ?? []) assert.match(img, /\salt="[^"]*"/, `${locale} ${JSON.stringify(query)} : ${img}`);
      for (const [, attrs, inner] of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) assert.ok(inner.replace(/<[^>]+>/g, "").trim() || /aria-label|title=/.test(attrs), `lien sans texte : ${attrs}`);
      for (const input of html.match(/<input\b(?![^>]*type="hidden")[^>]*>/g) ?? []) { const id = /id="([^"]+)"/.exec(input)?.[1]; assert.ok(id && html.includes(`for="${id}"`), `champ sans étiquette : ${input}`); }
      for (const nav of html.match(/<nav\b[^>]*>/g) ?? []) assert.match(nav, /aria-label="[^"]+"/);
      for (const svg of html.match(/<svg\b[^>]*>/g) ?? []) assert.match(svg, /aria-hidden="true"/, "icônes décoratives : le nom du réseau est dit en texte");
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      assert.equal(new Set(ids).size, ids.length, "ids uniques");
      for (const b of blocks.filter((x) => x.type === "adminForm")) for (const f of b.fields) if (f.kind !== "hidden") assert.ok(f.label && f.label.length > 1, `champ ${f.name} étiqueté`);
      for (const b of blocks.filter((x) => x.type === "table")) for (const a of b.rowActions ?? []) if (a.danger) assert.ok(a.confirm, `${a.label} : confirmation`);
      assert.doesNotMatch(html, /<script/i);
    }
    // Un nom piégé est échappé partout.
    await svc.create(ctx, { name: `<img src=x onerror=alert(1)>"'` });
    assert.doesNotMatch(htmlOf(await def.adminPanel(ctx, { query: {} })), /<img src=x/);
  }
});

// ── MCP ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("MCP : outils de lecture paginés (maximum 100 déclaré + curseur), parcours complet sans doublon ; écritures et lecture privée non accordées d'office", async () => {
  const ctx = makeCtx();
  for (let i = 0; i < 230; i++) await svc.upsertByAccount(ctx, { network: "twitch", handle: `mcp_${String(i).padStart(3, "0")}`, source: "test-suite" });
  const ids = [];
  let cursor;
  do { const r = await def.mcp.contacts_list(ctx, { limit: 1000, cursor }); assert.ok(r.items.length <= 100); ids.push(...r.items.map((x) => x.id)); cursor = r.next; } while (cursor);
  assert.deepEqual([ids.length, new Set(ids).size], [230, 230]);
  const found = [];
  cursor = undefined;
  do { const r = await def.mcp.contacts_list(ctx, { q: "mcp_1", limit: 7, cursor }); found.push(...r.items.map((x) => x.id)); cursor = r.next; } while (cursor);
  assert.equal(new Set(found).size, 100);
  for (const t of manifest.mcp) {
    if (t.input?.properties?.limit) assert.equal(t.input.properties.limit.maximum, 100, t.name);
    if (t.name.startsWith("contacts_list") || t.name === "contact_categories") assert.ok(t.input.properties.cursor, `${t.name} : curseur`);
    if (!t.readOnly) assert.equal(t.default, false, `${t.name} : écriture non accordée d'office`);
  }
  assert.equal(manifest.mcp.find((t) => t.name === "contact_get_private").default, false);
  assert.ok(!JSON.stringify(await def.mcp.contacts_list(ctx, {})).match(/"email"|"phone"/));
  await B.createCategory(ctx, { label: "Raid target" }, { allowed: true });
  assert.deepEqual((await def.mcp.contact_categories(ctx, {})).items.map((x) => x.label), ["Raid target"]);
});

test("manifeste 2.1 : version, minCore 0.2.2, dataVersion 2, besoins facultatifs (privacy.subject, connecteurs), droits du module", () => {
  assert.deepEqual([manifest.version, manifest.minCore, manifest.dataVersion], ["2.3.0", "0.2.2", 2]);
  assert.deepEqual(manifest.requires, [{ service: "privacy.subject", optional: true }, { service: "twitch.api", min: 3, optional: true }, { service: "youtube.api", optional: true }]);
  for (const r of manifest.rights) { assert.ok(r.label.fr && r.label.en); assert.ok(!r.id.includes(":"), "le cœur ajoute le préfixe du module"); }
  assert.equal(typeof def.migrations[2], "function");
});
