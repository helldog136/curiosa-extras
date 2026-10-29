// Contacts 2.3 — « Nouvelle personne » en deux onglets : « Ajouter via » (plateforme + pseudo ou lien, nom facultatif) et « Ajout manuel » (les détails).
// Couvre : la vérification lien ↔ plateforme (fonction pure), les plateformes proposées selon les connecteurs installés, l'ajout rapide complet, la plateforme
// mémorisée, le doublon (ouvrir la fiche existante), le nom repris d'une plateforme branchée, l'ajout manuel avec comptes, la parité FR/EN et la non-régression.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { memStore } from "./helpers/contactsStore.mjs";

const DIR = new URL("../modules/contacts", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json");
const def = (await import("../modules/contacts/index.mjs")).default;
const N = await import("../modules/contacts/networks.mjs");
const svc = def.services["contact.book"];

let n = 0;
function makeCtx({ locale = "fr", services = {}, rights = ["email.view", "categories.create", "export"], store = memStore() } = {}) {
  const c = fakeCtx({ moduleId: "contacts", key: `contacts-q${++n}`, locale, messages: readJson(`locales/${locale}.json`), services });
  c.api.store = store;
  c.can = (r) => rights.includes(r);
  return c;
}
const twitchApi = (rows) => ({ "twitch.api": { request: () => ({ ok: true, json: { data: rows } }) } });
const youtubeApi = { "youtube.api": { channels: () => ({ ok: true, items: [] }) } };
const form = (blocks, action) => blocks.find((b) => b.action === action);
const select = (f, name) => f.fields.find((x) => x.name === name);
const idOf = (redirect) => decodeURIComponent(/contact=([^&]+)/.exec(redirect)[1]);
const all = async (ctx) => (await svc.list(ctx, {})).items;

// ── Fonction pure ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("checkAccountInput : chaque plateforme — pseudo, @pseudo, lien avec/sans https, www, mobile, majuscules, espaces", () => {
  const ok = (net, input, handle) => { const r = N.checkAccountInput(net, input); assert.equal(r.status, "ok", `${net} ${JSON.stringify(input)}`); assert.equal(r.handle, handle, `${net} ${JSON.stringify(input)}`); };
  for (const i of ["some_name", "@Some_Name", " SOME_NAME ", "twitch.tv/some_name", "https://www.twitch.tv/Some_Name", "http://m.twitch.tv/some_name/videos", "WWW.TWITCH.TV/some_name/", "<https://twitch.tv/some_name>."]) ok("twitch", i, "some_name");
  for (const i of ["@Chan_One", "chan_one", "youtube.com/@chan_one", "https://www.youtube.com/@Chan_One/videos", "https://m.youtube.com/@chan_one"]) ok("youtube", i, "@chan_one");
  ok("youtube", "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv", "UCabcdefghijklmnopqrstuv");
  for (const i of ["@Une.Chaine", "une.chaine", "tiktok.com/@une.chaine", "https://www.tiktok.com/@Une.Chaine?lang=fr", "https://m.tiktok.com/@une.chaine"]) ok("tiktok", i, "une.chaine");
  for (const i of ["@Mon.Insta", "mon.insta", "instagram.com/mon.insta", "https://www.instagram.com/Mon.Insta/", "https://instagram.com/mon.insta?hl=fr"]) ok("instagram", i, "mon.insta");
  for (const i of ["@Nom_X", "nom_x", "x.com/nom_x", "https://twitter.com/Nom_X", "https://www.x.com/nom_x/status"]) ok("x", i, "nom_x");
  for (const i of ["nom.joueur", "@Nom.Joueur", " NOM.JOUEUR "]) ok("discord", i, "nom.joueur");
  ok("discord", "https://discord.gg/AbCd12", "invite/AbCd12");
  ok("discord", "discord.com/invite/AbCd12", "invite/AbCd12");
  for (const i of ["nom.bsky.social", "@Nom.Bsky.Social", "https://bsky.app/profile/nom.bsky.social", "bsky.app/profile/Nom.bsky.social/post/3k", "nom"]) ok("bluesky", i, "nom.bsky.social");
  ok("mastodon", "@Toot@Social.Example", "toot@social.example");
  ok("mastodon", "https://social.example/@toot", "toot@social.example");
  ok("web", "https://www.exemple.com/page/", "exemple.com/page");
});

test("checkAccountInput : vide, lien d'une AUTRE plateforme, liens qui ne sont pas des profils, e-mail, espaces — jamais de réseau", () => {
  assert.deepEqual(N.checkAccountInput("twitch", "   "), { status: "empty" });
  assert.deepEqual(N.checkAccountInput("twitch", ""), { status: "empty" });
  assert.deepEqual(N.checkAccountInput("twitch", undefined), { status: "empty" });
  assert.deepEqual(N.checkAccountInput("twitch", "https://www.youtube.com/@chan_one"), { status: "other_network", detected: "youtube" });
  assert.deepEqual(N.checkAccountInput("youtube", "twitch.tv/some_name"), { status: "other_network", detected: "twitch" });
  assert.deepEqual(N.checkAccountInput("web", "https://x.com/nom_x"), { status: "other_network", detected: "x" });
  assert.deepEqual(N.checkAccountInput("instagram", "https://twitter.com/nom_x"), { status: "other_network", detected: "x" });
  for (const [net, input] of [
    ["twitch", "twitch.tv/directory"], ["twitch", "abc"], ["twitch", "deux mots"], ["twitch", "a".repeat(26)], ["twitch", "nom@exemple.com"], ["twitch", "https://kick.com/some_name"],
    ["youtube", "https://www.youtube.com/watch?v=abc"], ["youtube", "https://youtu.be/abc"], ["youtube", "ab"],
    ["tiktok", "https://www.tiktok.com/discover"], ["instagram", "https://www.instagram.com/p/Cxyz/"], ["instagram", "instagram.com/reel/abc"], ["x", "https://x.com/home"], ["x", "x.com/i/lists"],
    ["discord", "x"], ["bluesky", "https://bsky.app/"], ["mastodon", "pseudo"], ["web", "pas une adresse"], ["twitch", "x".repeat(400)], ["inconnue", "pseudo"],
  ]) assert.equal(N.checkAccountInput(net, input).status, "invalid", `${net} ${input.slice(0, 40)}`);
});

// ── Plateformes proposées ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const via = async (ctx) => form(await def.adminPanel(ctx, { query: { new: "person" } }), "addVia");

test("« Ajouter via » par défaut : 3 champs (plateforme, pseudo ou lien, nom facultatif), un onglet « Ajout manuel » et l'ajout d'une organisation inchangé", async () => {
  const ctx = makeCtx();
  const blocks = await def.adminPanel(ctx, { query: { new: "person" } });
  const f = form(blocks, "addVia");
  assert.deepEqual(f.fields.map((x) => x.name), ["network", "handle", "name"]);
  assert.deepEqual(f.fields.filter((x) => x.required).map((x) => x.name), ["network", "handle"], "le nom est facultatif");
  assert.equal(f.submitLabel, "Enregistrer");
  const html = blocks.map((b) => b.html ?? "").join("");
  assert.match(html, /aria-current="page">Ajouter via</);
  assert.match(html, /href="\?new=person&amp;mode=manual">Ajout manuel</);
  const org = await def.adminPanel(ctx, { query: { new: "org" } });
  assert.ok(form(org, "save") && !form(org, "addVia"), "une organisation garde son formulaire");
  assert.ok(!org.map((b) => b.html ?? "").join("").includes("Ajouter via"));
});

test("plateformes proposées : connecteurs installés d'abord, sinon celles déjà dans le carnet, sinon les courantes avec une phrase vers l'ajout manuel", async () => {
  const list = async (ctx) => (await via(ctx)).fields[0].options.map((o) => o.value);
  const bare = makeCtx();
  assert.deepEqual(await list(bare), ["twitch", "youtube", "instagram", "tiktok", "discord", "x", "bluesky"], "rien d'installé, carnet vide : les plateformes courantes");
  assert.ok(JSON.stringify(await def.adminPanel(bare, { query: { new: "person" } })).includes("Aucune plateforme n'est encore branchée"));
  const twitchOnly = makeCtx({ services: twitchApi([]) });
  assert.deepEqual(await list(twitchOnly), ["twitch"]);
  assert.ok(!JSON.stringify(await def.adminPanel(twitchOnly, { query: { new: "person" } })).includes("Aucune plateforme"));
  assert.deepEqual(await list(makeCtx({ services: { ...youtubeApi, ...twitchApi([]) } })), ["twitch", "youtube"], "Twitch d'abord");
  assert.deepEqual(await list(makeCtx({ services: youtubeApi })), ["youtube"]);
  // Sans connecteur, les plateformes qui ont déjà un compte dans le carnet.
  const used = makeCtx();
  await svc.upsertByAccount(used, { network: "instagram", handle: "mon.insta", source: "test-suite" });
  await svc.upsertByAccount(used, { network: "bluesky", handle: "nom.bsky.social", source: "test-suite" });
  assert.deepEqual(await list(used), ["instagram", "bluesky"]);
  // Un connecteur facultatif qui disparaît ou qui plante ne bloque jamais le formulaire.
  const broken = makeCtx();
  broken.api.services.providers = async () => { throw new Error("boom"); };
  assert.equal((await list(broken)).length, 7);
});

test("« Ajout manuel » : le formulaire complet, sans « Statut » ; deux emplacements de compte ; fiche existante : pas d'emplacement de compte", async () => {
  const ctx = makeCtx();
  const f = form(await def.adminPanel(ctx, { query: { new: "person", mode: "manual" } }), "save");
  const names = f.fields.map((x) => x.name);
  for (const k of ["name", "role", "organisation", "email", "phone", "relation", "acc1_network", "acc1_handle", "acc2_network", "acc2_handle", "newCategory"]) assert.ok(names.includes(k), k);
  assert.ok(!names.includes("status"), "le statut ne se choisit plus ici");
  const created = await def.adminActions.save(ctx, { kind: "person", name: "Zoé" });
  const id = idOf(created.redirect);
  const edit = form(await def.adminPanel(ctx, { query: { contact: id, edit: "1" } }), "save");
  assert.ok(!edit.fields.some((x) => /^acc\d_/.test(x.name) || x.name === "status"));
  assert.ok(JSON.stringify(await def.adminPanel(ctx, { query: { new: "person", mode: "manual" } })).includes("aria-current=\\\"page\\\">Ajout manuel"));
});

// ── Ajout rapide ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("ajout rapide complet : lien Twitch collé → fiche + compte au bon endroit, la fiche s'ouvre avec un message ; nom = pseudo par défaut ; nom écrit respecté", async () => {
  const ctx = makeCtx();
  const r = await def.adminActions.addVia(ctx, { network: "twitch", handle: "  https://www.Twitch.tv/Some_Name/videos ", name: "" });
  assert.match(r.redirect, /^\?contact=[^&]+&fresh=1$/);
  const c = (await svc.get(ctx, { id: idOf(r.redirect) })).contact;
  assert.equal(c.name, "some_name");
  assert.deepEqual(c.accounts.map((a) => [a.network, a.handle, a.url]), [["twitch", "some_name", "https://www.twitch.tv/some_name"]]);
  assert.equal(c.status, "active");
  const page = JSON.stringify(await def.adminPanel(ctx, { query: { contact: c.id, fresh: "1" } }));
  assert.match(page, /La fiche est créée/);
  assert.ok(!JSON.stringify(await def.adminPanel(ctx, { query: { contact: c.id } })).includes("La fiche est créée"));
  const named = await def.adminActions.addVia(ctx, { network: "youtube", handle: "@Chan_One", name: "  Chaîne  Un " });
  const c2 = (await svc.get(ctx, { id: idOf(named.redirect) })).contact;
  assert.deepEqual([c2.name, c2.accounts[0].handle], ["Chaîne Un", "@chan_one"]);
  assert.equal((await all(ctx)).length, 2);
});

test("ajout rapide : erreurs SOUS le champ avec un exemple (vide, lien d'une autre plateforme, pas un profil, plateforme inconnue) ; rien n'est créé", async () => {
  const ctx = makeCtx();
  const e = async (v) => (await def.adminActions.addVia(ctx, v)).errors;
  assert.deepEqual(await e({ network: "twitch", handle: " " }), { handle: "Collez un lien ou tapez un pseudo." });
  assert.match((await e({ network: "twitch", handle: "https://www.youtube.com/@chan_one" })).handle, /Ce lien est un lien YouTube, mais la plateforme choisie est Twitch\. Changez de plateforme, ou collez un lien Twitch\./);
  assert.match((await e({ network: "twitch", handle: "twitch.tv/directory" })).handle, /twitch\.tv\/nom/);
  assert.match((await e({ network: "youtube", handle: "https://www.youtube.com/watch?v=abc" })).handle, /youtube\.com\/@nom/);
  assert.match((await e({ network: "tiktok", handle: "x.com/home" })).handle, /Ce lien est un lien X/);
  assert.deepEqual(await e({ network: "kick", handle: "abcde" }), { network: "Choisissez une plateforme dans la liste." });
  assert.equal((await all(ctx)).length, 0);
});

test("la dernière plateforme choisie est mémorisée (stockage du module) et préselectionnée ; une erreur ne la change pas", async () => {
  const store = memStore();
  const ctx = makeCtx({ store });
  assert.equal(select(await via(ctx), "network").value, "twitch");
  await def.adminActions.addVia(ctx, { network: "youtube", handle: "@Chan_One" });
  assert.equal(select(await via(ctx), "network").value, "youtube");
  await def.adminActions.addVia(ctx, { network: "instagram", handle: "https://twitter.com/abc" }); // refusé
  assert.equal(select(await via(ctx), "network").value, "youtube");
  const again = makeCtx({ store }); again.instance = ctx.instance; // autre appareil, même carnet
  assert.equal(select(await via(again), "network").value, "youtube");
  assert.equal((await store.page("meta", { limit: 10 })).items.filter((x) => x.key === "quick").length, 1, "un seul document mémorisé");
  await def.adminActions.addVia(ctx, { network: "twitch", handle: "pseudo_un" });
  assert.equal(select(await via(ctx), "network").value, "twitch");
  assert.equal((await store.page("meta", { limit: 10 })).items.filter((x) => x.key === "quick").length, 1);
});

test("doublon : un compte déjà sur une fiche propose d'ouvrir cette fiche (aucune seconde fiche), quelle que soit l'écriture du compte", async () => {
  const ctx = makeCtx();
  const first = idOf((await def.adminActions.addVia(ctx, { network: "twitch", handle: "twitch.tv/some_name", name: "Sam" })).redirect);
  for (const handle of ["@SOME_NAME", "https://m.twitch.tv/some_name/about"]) {
    const r = await def.adminActions.addVia(ctx, { network: "twitch", handle, name: "Autre" });
    assert.equal(r.redirect, `?new=person&same=${first}`);
    assert.equal(r.error, undefined);
  }
  assert.equal((await all(ctx)).length, 1);
  const page = await def.adminPanel(ctx, { query: { new: "person", same: first } });
  assert.match(JSON.stringify(page), /Ce compte est déjà dans votre carnet, sur la fiche « Sam »/);
  const html = page.map((b) => b.html ?? "").join("");
  assert.match(html, new RegExp(`href="\\?contact=${first}">Ouvrir la fiche<`));
  assert.match(html, /href="\?new=person">Revenir au formulaire</);
  assert.ok(!form(page, "addVia"));
  assert.ok(JSON.stringify(await def.adminPanel(ctx, { query: { new: "person", same: "inconnu" } })).includes("addVia"), "fiche disparue : retour au formulaire");
  // Même règle depuis l'ajout manuel.
  const m = await def.adminActions.save(ctx, { kind: "person", name: "Autre", acc1_network: "", acc1_handle: "twitch.tv/some_name" });
  assert.equal(m.redirect, `?new=person&same=${first}`);
  assert.equal((await all(ctx)).length, 1);
});

test("nom et photo repris de la plateforme SEULEMENT si son connecteur est installé (service existant) ; sans connecteur ou en panne : la fiche est créée quand même", async () => {
  const withApi = makeCtx({ services: twitchApi([{ login: "some_name", display_name: "Some_Name ✨", profile_image_url: "https://img.example.test/a.png" }]) });
  const r = await def.adminActions.addVia(withApi, { network: "twitch", handle: "some_name" });
  const c = (await svc.get(withApi, { id: idOf(r.redirect) })).contact;
  assert.equal(c.name, "Some_Name ✨");
  assert.equal(c.accounts[0].displayName, "Some_Name ✨");
  assert.deepEqual(withApi.calls.services.map((x) => x[0]), ["twitch.api"], "un seul service, celui qui existe déjà");
  // Un nom écrit n'est jamais remplacé.
  const typed = makeCtx({ services: twitchApi([{ login: "other_one", display_name: "Autre" }]) });
  const t = await def.adminActions.addVia(typed, { network: "twitch", handle: "other_one", name: "Mon nom" });
  assert.equal((await svc.get(typed, { id: idOf(t.redirect) })).contact.name, "Mon nom");
  // Sans connecteur : aucun appel.
  const none = makeCtx();
  const n1 = await def.adminActions.addVia(none, { network: "twitch", handle: "some_name" });
  assert.equal((await svc.get(none, { id: idOf(n1.redirect) })).contact.name, "some_name");
  assert.deepEqual(none.calls.services, []);
  assert.deepEqual(none.calls.net, [], "aucun appel réseau pour deviner quoi que ce soit");
  // Connecteur qui plante.
  const down = makeCtx({ services: { "twitch.api": { request: () => { throw new Error("down"); } } } });
  const d = await def.adminActions.addVia(down, { network: "twitch", handle: "some_name" });
  assert.match(d.redirect, /fresh=1/);
  assert.equal((await svc.get(down, { id: idOf(d.redirect) })).contact.name, "some_name");
});

// ── Ajout manuel ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("ajout manuel : détails + deux comptes d'emblée (plateforme choisie ou trouvée dans le lien), erreurs sous le bon champ, rien d'écrit en cas d'erreur", async () => {
  const ctx = makeCtx();
  const bad = await def.adminActions.save(ctx, { kind: "person", name: "Léa", acc1_network: "twitch", acc1_handle: "ab", acc2_network: "", acc2_handle: "pseudo_seul" });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["acc1_handle", "acc2_network"]);
  assert.match(bad.errors.acc1_handle, /twitch\.tv\/nom/);
  assert.match(bad.errors.acc2_network, /Choisissez la plateforme/);
  assert.equal((await all(ctx)).length, 0);
  const r = await def.adminActions.save(ctx, { kind: "person", name: "Léa", role: "Graphiste", organisation: "Studio Lune", email: "lea@example.test", relation: "Rencontrée à un festival", acc1_network: "twitch", acc1_handle: "@Lea_Draw", acc2_network: "", acc2_handle: "https://www.youtube.com/@LeaDraw", cats: "1" });
  assert.equal(r.redirect.includes("fresh"), false, "l'ajout manuel garde le retour d'avant");
  const c = (await svc.get(ctx, { id: idOf(r.redirect) })).contact;
  assert.deepEqual(c.accounts.map((a) => `${a.network}:${a.handle}`), ["twitch:lea_draw", "youtube:@leadraw"]);
  assert.deepEqual([c.role, c.orgName, c.email], ["Graphiste", "Studio Lune", "lea@example.test"]);
  assert.equal(select(await via(ctx), "network").value, "twitch", "le compte 1 est mémorisé comme dernier choix");
  // Un emplacement vide est ignoré ; une fiche sans compte reste possible.
  const plain = await def.adminActions.save(ctx, { kind: "person", name: "Sans compte", acc1_network: "youtube", acc1_handle: "" });
  assert.equal((await svc.get(ctx, { id: idOf(plain.redirect) })).contact.accounts.length, 0);
});

// ── Statut et catégories ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("statut et catégories : plus de « Statut » dans le formulaire (la fiche garde « C'est vérifié »), l'ancien paramètre status est toujours compris, catégories en phrases claires", async () => {
  const ctx = makeCtx();
  await def.adminActions.createCategory.run(ctx, { label: "Cible de raid", color: "#e8a23b" });
  const f = form(await def.adminPanel(ctx, { query: { new: "person", mode: "manual" } }), "save");
  const box = f.fields.find((x) => x.kind === "checkbox");
  assert.equal(box.label, "Dans la catégorie « Cible de raid »");
  assert.match(box.help, /Une catégorie regroupe des personnes/);
  const old = await def.adminActions.save(ctx, { kind: "person", name: "Ancien", status: "to_review", cats: "1" });
  const id = idOf(old.redirect);
  assert.equal((await svc.get(ctx, { id })).contact.status, "to_review", "les anciens appels qui envoient un statut marchent encore");
  assert.ok((await def.adminPanel(ctx, { query: { contact: id } })).some((b) => b.action === "verify"));
});

// ── Textes : parité FR/EN, mots neutres ───────────────────────────────────────────────────────────────────────────────────────────────────
test("parité FR/EN exacte (mêmes clés, mêmes variables {…}), aucune clé vide ; textes de l'ajout sans accord de genre", () => {
  const fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of Object.keys(fr)) { assert.ok(fr[k] && en[k], k); assert.equal(vars(fr[k]), vars(en[k]), k); }
  const keys = ["tabVia", "tabManual", "newTabsLabel", "viaNoConnector", "viaPlatform", "viaHandle", "viaHandleHelp", "viaName", "viaNameHelp", "viaOther", "viaPickNetwork", "viaWrongNetwork", "sameBanner", "sameOpen", "sameBack", "slotPlatform", "slotNone", "slotHandle", "slotHelp", "slotNeedNetwork", "freshBanner", "helpEmail", "helpCategories", "helpRole", "helpOrganisation", "categoriesField", "newCategory", "helpNewCategory"];
  for (const k of keys) assert.ok(k in fr, k);
  assert.equal(fr.helpRole, "Par exemple : responsable des partenariats.");
  assert.equal(fr.helpOrganisation, "Écrivez le nom de l'organisation : la fiche est créée si elle n'existe pas encore.");
  for (const k of keys) assert.doesNotMatch(fr[k], /chargée|\(e\)|·e\b|\bTapez\b|\bil\/elle\b|\bélu\b|\bconnecté\b|\bcréé\b/i, k);
});

// ── Non-régression ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("non-régression : outils MCP et service inchangés (contact_create, contact_add_account), manifeste 2.3.0 sans changement d'apiVersion ni de droits", async () => {
  const ctx = makeCtx();
  const created = await def.mcp.contact_create(ctx, { name: "Ada", role: "Dev", organisation: "Studio", email: "ada@example.test" });
  assert.equal(created.created, true);
  const acc = await def.mcp.contact_add_account(ctx, { id: created.id, network: "twitch", handle: "twitch.tv/Ada_Dev" });
  assert.equal(acc.account.handle, "ada_dev");
  await assert.rejects(() => def.mcp.contact_add_account(ctx, { id: (await def.mcp.contact_create(ctx, { name: "Bob" })).id, network: "twitch", handle: "ada_dev" }), /already on contact/);
  // Le compte posé par l'ajout rapide est celui que voient les autres modules.
  const q = await def.adminActions.addVia(ctx, { network: "youtube", handle: "@Chan_One" });
  const found = await svc.find(ctx, { q: "chan_one" });
  assert.equal(found.contacts[0].id, idOf(q.redirect));
  assert.equal(manifest.version, "2.3.0");
  assert.equal(manifest.apiVersion, 2);
  assert.deepEqual(manifest.rights.map((x) => x.id), ["email.view", "export", "categories.create"]);
  assert.deepEqual(Object.keys(def.mcp).sort(), manifest.mcp.map((t) => t.name).sort());
  assert.deepEqual(manifest.requires.map((r) => [r.service, !!r.optional]), [["privacy.subject", true], ["twitch.api", true], ["youtube.api", true]], "les connecteurs restent facultatifs");
});

test("parcours court : une plateforme préchoisie, 2 champs à remplir (pseudo, puis Enregistrer), jamais plus de 3 champs visibles ; FR et EN", async () => {
  for (const locale of ["fr", "en"]) {
    const ctx = makeCtx({ locale });
    const f = await via(ctx);
    assert.equal(f.fields.length, 3);
    assert.ok(f.fields[0].value, "plateforme déjà choisie");
    const r = await def.adminActions.addVia(ctx, { network: f.fields[0].value, handle: "some_name" });
    assert.ok(r.redirect && !r.errors, locale);
  }
});
