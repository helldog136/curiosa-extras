// Raid Twitch 2.1 : ajout rapide d'une chaîne (un nom, un pseudo, un lien, plusieurs lignes collées), nom et photo repris sur Twitch, « Retirer », liste par pages,
// catégorie « Cible de raid » créée toute seule. Contacts est TOUJOURS le double du contrat (contact.book v2) + celui de l'extension (contact.curate v1) ;
// Twitch : un faux service `twitch.api` (jamais de réseau). Les droits de la personne qui clique (`asCaller`) sont simulés par tests/helpers/callerRights.mjs.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { fakeContactCurate } from "./helpers/fakeContactCurate.mjs";
import { carryRights } from "./helpers/callerRights.mjs";

const DIR = new URL("../modules/twitch-raid", import.meta.url).pathname;
const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const def = (await import("../modules/twitch-raid/index.mjs")).default;
const admin = await import("../modules/twitch-raid/admin.mjs");
const source = await import("../modules/twitch-raid/source.mjs");
const quick = await import("../modules/twitch-raid/quick.mjs");
const profiles = await import("../modules/twitch-raid/profiles.mjs");
const pure = await import("../modules/twitch-raid/pure.mjs");
const live = await import("../modules/twitch-raid/live.mjs");

/* ───────────── Faux Twitch : GET users (jusqu'à 100 pseudos), 429, trou noir ───────────── */
let api;
function fakeApi() {
  const a = {
    users: new Map(), calls: [], reply: null, hang: false,
    methods: {
      account: async () => ({ ok: true, channel: "emma_live", ready: true }),
      request: async (args) => {
        a.calls.push(args);
        if (a.hang) return new Promise(() => {});
        if (a.reply) return a.reply;
        if (args.path !== "users") return { ok: true, status: 200, json: { data: [] } };
        assert.ok(args.query.login.length <= 100, "Twitch refuse plus de 100 pseudos par appel");
        return { ok: true, status: 200, json: { data: args.query.login.filter((l) => a.users.has(l)).map((l) => ({ login: l, display_name: a.users.get(l).name, profile_image_url: a.users.get(l).avatar ?? `https://static.example.test/${l}.png` })) } };
      },
    },
  };
  return a;
}
const nice = (login) => login.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const known = (...logins) => { for (const l of logins) api.users.set(l, { name: nice(l) }); };

let sites = 0;
/** Un site : son Contacts (double), l'extension, la simulation d'asCaller, un faux Twitch. `twitch: false` : pas de Connecteur. `lang` : langue par défaut du site. */
function site({ category = false, lang = "fr", twitch = true, curate = true, settings = {}, rights = ["categories.create"], carried = true } = {}) {
  const book = fakeContactBook();
  const cur = fakeContactCurate(book);
  const cat = category ? book.seedCategory(lang === "fr" ? "Cible de raid" : "Raid target") : null;
  const ctx = fakeCtx({
    key: `quick${++sites}`, moduleId: "twitch-raid", locale: lang, defaultLocale: lang, messages: { ...(lang === "fr" ? fr : en) }, settings, siteUrl: "https://site.example.test", permissions: manifest.permissions,
    services: { "contact.book": book.methods, ...(curate ? { "contact.curate": cur.methods } : {}) },
    serviceInstances: twitch ? { "twitch.api": [{ instance: "tw", name: "Chaîne Twitch", methods: api.methods }] } : {},
  });
  const seen = carryRights(ctx, book, { rights, carried });
  return { ctx, book, cur, cat, seen };
}
const act = (ctx, n, values = {}) => admin.actions[n](ctx, values);
const panel = (ctx, query = {}) => def.adminPanel(ctx, { query });
const dumpOf = (book) => book.dump();
const byHandle = (book, handle) => dumpOf(book).contacts.find((c) => c.accounts.some((a) => a.handle === handle));
const HUNG = Symbol("hung");
const within = (p, ms = 4000) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(HUNG), ms); })]).finally(() => clearTimeout(t)); };
const timing0 = { source: { ...source.timing }, quick: { ...quick.timing }, profiles: { ...profiles.timing } };

beforeEach(() => { api = fakeApi(); live.resetLive(); source.resetSource(); });
afterEach(() => { Object.assign(source.timing, timing0.source); Object.assign(quick.timing, timing0.quick); Object.assign(profiles.timing, timing0.profiles); });

/* ───────────── Lire ce que la personne a tapé ───────────── */

test("explainLogin : indulgent (espaces, majuscules, @, lien, puce, guillemets) et clair sur la raison d'un refus ; la règle des 4 à 25 caractères du contrat", () => {
  for (const x of ["  Camille_TV ", "@Camille_TV", "https://www.twitch.tv/Camille_TV/", "twitch.tv/camille_tv?sr=a", "http://m.twitch.tv/CAMILLE_TV", "- camille_tv", "• camille_tv", "\"camille_tv\",", "camille_tv​", " camille_tv "]) assert.deepEqual(pure.explainLogin(x), { login: "camille_tv" }, JSON.stringify(x));
  assert.deepEqual(pure.explainLogin("abc"), { error: "short" }); assert.deepEqual(pure.explainLogin("abcd"), { login: "abcd" });
  assert.deepEqual(pure.explainLogin("a".repeat(25)), { login: "a".repeat(25) }); assert.deepEqual(pure.explainLogin("a".repeat(26)), { error: "long" });
  assert.deepEqual(pure.explainLogin("jean dupont"), { error: "chars" }); assert.deepEqual(pure.explainLogin("é_tre"), { error: "chars" });
  assert.deepEqual(pure.explainLogin("twitch.tv/videos"), { error: "not_channel" }); assert.deepEqual(pure.explainLogin(""), { error: "empty" }); assert.deepEqual(pure.explainLogin("   "), { error: "empty" });
  assert.equal(pure.looksLikeChannel("twitch.tv/x"), true); assert.equal(pure.looksLikeChannel("@alice"), true); assert.equal(pure.looksLikeChannel("Alice"), false); assert.equal(pure.looksLikeChannel("camille_tv"), false);
  const p = pure.splitLines("a\r\n\r\n b \nc", 2); assert.deepEqual([p.lines, p.total, p.over], [["a", "b"], 3, true]);
});

test("parsePaste : sans doublon, lignes invalides numérotées avec leur raison, 200 lignes au plus", () => {
  const p = quick.parsePaste(["camille_tv", "@Camille_TV", "https://twitch.tv/alice_tv", "ab", "jean dupont", "twitch.tv/videos", "", "x".repeat(30)].join("\n"));
  assert.deepEqual(p.logins, [{ login: "camille_tv", line: 1 }, { login: "alice_tv", line: 3 }]);
  assert.equal(p.dups, 1); assert.equal(p.invalidCount, 4); assert.equal(p.total, 7);
  assert.deepEqual(p.invalid.map((x) => [x.line, x.reason]), [[4, "short"], [5, "chars"], [6, "not_channel"], [7, "long"]]);
  assert.equal(quick.parsePaste(Array.from({ length: 250 }, (_, i) => `name_${i}`).join("\n")).over, true);
  assert.equal(quick.parsePaste(Array.from({ length: 250 }, (_, i) => `name_${i}`).join("\n")).logins.length, 200);
});

/* ───────────── Un pseudo ou un lien : ajouté tout de suite ───────────── */

test("un lien twitch.tv : la catégorie « Cible de raid » est créée toute seule (nom dans la langue du site), la fiche est créée avec le nom et la photo de Twitch, rien n'est copié dans Raid", async () => {
  known("camille_tv");
  const { ctx, book, seen } = site();
  const r = await act(ctx, "find", { q: "  https://www.twitch.tv/Camille_TV/ " });
  assert.match(r.ok, /C'est fait : camille_tv est ajoutée à votre liste de raid\. La liste « Cible de raid » a été créée dans Contacts\./);
  assert.equal(r.redirect, "?");
  const d = dumpOf(book);
  assert.deepEqual(d.categories.map((k) => k.name), ["Cible de raid"]);
  const c = byHandle(book, "camille_tv");
  assert.deepEqual([c.name, c.source, c.kind, c.categoryIds], ["Camille Tv", "twitch-raid", "person", [d.categories[0].id]]);
  assert.deepEqual([c.accounts[0].displayName, c.accounts[0].avatar], ["Camille Tv", "https://static.example.test/camille_tv.png"], "déposés dans la fiche de Contacts (setAccountProfile)");
  assert.equal(api.calls.length, 1, "un seul appel à Twitch");
  assert.deepEqual(api.calls[0], { as: "app", method: "GET", path: "users", query: { login: ["camille_tv"] }, channel: "emma_live" });
  assert.deepEqual(seen.filter((x) => x.asCaller).map((x) => x.method), ["createCategory"], "seul createCategory demande les droits de la personne");
  // rien de copié dans le stockage de Raid
  assert.ok(!JSON.stringify(ctx.dumpStore()).match(/Camille|static\.example/), "ni nom ni photo chez Raid");
});

test("catégorie créée dans la langue par défaut du site : « Raid target » pour un site en anglais ; une catégorie existante est préférée, jamais de doublon", async () => {
  known("camille_tv", "alice_tv");
  const en1 = site({ lang: "en" });
  assert.match((await act(en1.ctx, "find", { q: "@camille_tv" })).ok, /Done: camille_tv is added to your raid list\. The “Raid target” list was created in Contacts\./);
  assert.deepEqual(dumpOf(en1.book).categories.map((k) => k.name), ["Raid target"]);
  const withCat = site({ category: true });
  await act(withCat.ctx, "find", { q: "@alice_tv" });
  assert.deepEqual(dumpOf(withCat.book).categories.map((k) => k.name), ["Cible de raid"], "l'existante est utilisée");
  assert.equal(withCat.seen.filter((x) => x.asCaller).length, 0, "aucun droit demandé quand rien n'est à créer");
  const ch = site({});
  const other = ch.book.seedCategory("Autre liste"), second = ch.book.seedCategory("Troisième");
  await act(ch.ctx, "find", { q: "@alice_tv" });
  assert.deepEqual(dumpOf(ch.book).categories.map((k) => k.name).sort(), ["Autre liste", "Cible de raid", "Troisième"], "plusieurs catégories sans « Cible de raid » : elle est créée");
  void other; void second;
});

test("l'unique catégorie de Contacts (celle que lit le dock) est utilisée telle quelle : on n'en crée pas une deuxième qui vide le dock", async () => {
  known("alice_tv");
  const { ctx, book } = site({});
  const fam = book.seedCategory("Famille");
  await act(ctx, "find", { q: "@alice_tv" });
  assert.deepEqual(dumpOf(book).categories.map((k) => k.name), ["Famille"]);
  assert.deepEqual(byHandle(book, "alice_tv").categoryIds, [fam]);
});

test("rejouer ne double rien : « déjà dans votre liste », une seule fiche, aucun nouvel appel à Twitch", async () => {
  known("camille_tv");
  const { ctx, book } = site({ category: true });
  await act(ctx, "find", { q: "@camille_tv" });
  const calls = api.calls.length;
  const again = await act(ctx, "find", { q: "twitch.tv/CAMILLE_TV" });
  assert.match(again.ok, /camille_tv est déjà dans votre liste de raid\. Rien n'a changé\./);
  assert.equal(dumpOf(book).contacts.length, 1);
  assert.equal(api.calls.length, calls, "le nom et la photo sont déjà là : Twitch n'est pas redemandé");
});

test("une fiche qui a déjà un nom n'est jamais renommée : elle rejoint la liste, son compte reçoit le nom et la photo de Twitch", async () => {
  known("alice_tv");
  const { ctx, book, cat } = site({ category: true });
  const { id } = book.seedContact({ name: "Alice Martin", accounts: [{ network: "twitch", handle: "alice_tv" }] });
  const r = await act(ctx, "find", { q: "@Alice_TV" });
  assert.match(r.ok, /était déjà dans Contacts, elle rejoint votre liste/);
  const c = dumpOf(book).contacts.find((x) => x.id === id);
  assert.deepEqual([c.name, c.categoryIds, dumpOf(book).contacts.length], ["Alice Martin", [cat], 1]);
  assert.equal(c.accounts[0].displayName, "Alice Tv");
});

test("pseudo refusé : l'erreur dit pourquoi, sous le champ, avec un exemple ; rien n'est créé", async () => {
  const { ctx, book } = site({ category: true });
  assert.deepEqual(await act(ctx, "find", { q: "" }), { errors: { q: "Tapez un nom, un pseudo ou un lien Twitch." } });
  assert.match((await act(ctx, "find", { q: "twitch.tv/ab" })).errors.q, /« twitch\.tv\/ab » est trop court : un pseudo Twitch a 4 caractères au moins\./);
  assert.match((await act(ctx, "find", { q: "@" + "a".repeat(26) })).errors.q, /trop long.*25 caractères au plus/);
  assert.match((await act(ctx, "find", { q: "@jean dupont" })).errors.q, /lettres sans accent, des chiffres et _ \(par exemple camille_tv\)/);
  assert.match((await act(ctx, "find", { q: "twitch.tv/videos" })).errors.q, /n'est pas une chaîne Twitch.*twitch\.tv\/camille_tv/);
  assert.equal(dumpOf(book).contacts.length, 0);
});

test("Twitch ne connaît pas ce pseudo (faute de frappe) : erreur sous le champ, aucune fiche ; sans réponse de Twitch, on ajoute quand même", async () => {
  known("alice_tv");
  const { ctx, book } = site({ category: true });
  assert.match((await act(ctx, "find", { q: "@alise_tv" })).errors.q, /Twitch ne connaît pas « alise_tv »\. Vérifiez l'orthographe/);
  assert.equal(dumpOf(book).contacts.length, 0);
  api.reply = { ok: false, error: "network" };
  const r = await act(ctx, "find", { q: "@alise_tv" });
  assert.match(r.ok, /alise_tv est ajoutée.*Le nom et la photo n'ont pas pu être repris sur Twitch pour l'instant/);
  assert.equal(byHandle(book, "alise_tv").name, "alise_tv", "sans Twitch : le pseudo sert de nom");
});

/* ───────────── Un nom : chercher dans Contacts ───────────── */

test("un nom : redirection vers les résultats ; la page montre qui a une chaîne Twitch (bouton Ajouter), qui n'en a pas, qui est déjà dans la liste", async () => {
  known("camille_tv");
  const { ctx, book, cat } = site({ category: true });
  book.seedContact({ name: "Camille Dubois", accounts: [{ network: "twitch", handle: "camille_tv" }] });
  book.seedContact({ name: "Camille Roux", accounts: [{ network: "youtube", handle: "@camille_roux" }] });
  const inList = book.seedContact({ name: "Camille Lambert", accounts: [{ network: "twitch", handle: "camille_lam" }], categoryIds: [cat] });
  void inList;
  assert.deepEqual(await act(ctx, "find", { q: "Camille" }), { ok: undefined, redirect: "?add=Camille" });
  const blocks = await panel(ctx, { add: "Camille" });
  const tables = blocks.filter((b) => b.type === "table" && b.rowActions?.[0]?.action === "pick");
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].rows, [["Camille Dubois", "@camille_tv"]]);
  assert.match(tables[0].rowIds[0], /~camille_tv$/);
  assert.ok(blocks.some((b) => b.type === "markdown" && /Déjà dans votre liste : Camille Lambert \(@camille_lam\)/.test(b.text)));
  const noTw = blocks.find((b) => b.type === "table" && b.rowActions?.[0]?.href);
  assert.deepEqual(noTw.rows, [["Camille Roux", "pas de chaîne Twitch"]]);
  assert.match(noTw.rowActions[0].href, /^\?add=Camille&who=\{id\}$/);
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "create"));
  // clic sur « Ajouter à ma liste »
  const r = await act(ctx, "pick", { id: tables[0].rowIds[0] });
  assert.match(r.ok, /camille_tv est ajoutée|était déjà dans Contacts, elle rejoint/);
  assert.deepEqual(dumpOf(book).contacts.find((c) => c.name === "Camille Dubois").categoryIds, [cat]);
  assert.equal(dumpOf(book).contacts.filter((c) => c.name.startsWith("Camille D")).length, 1, "pas de doublon");
});

test("une personne sans compte Twitch : son pseudo est ajouté à SA fiche (jamais de doublon), puis elle rejoint la liste ; pseudo déjà pris : on dit sur quelle fiche", async () => {
  known("roux_tv", "dubois_tv");
  const { ctx, book, cat } = site({ category: true });
  const camille = book.seedContact({ name: "Camille Roux", accounts: [{ network: "youtube", handle: "@camille_roux" }] }).id;
  const before = dumpOf(book).contacts.length;
  const blocks = await panel(ctx, { add: "Camille", who: camille });
  assert.ok(blocks.some((b) => b.type === "heading" && b.text === "Pseudo Twitch de Camille Roux"));
  const form = blocks.find((b) => b.type === "adminForm" && b.action === "attach");
  assert.deepEqual(form.fields.map((f) => [f.name, f.kind]), [["id", "hidden"], ["handle", "text"]]);
  assert.match((await act(ctx, "attach", { id: camille, handle: "" })).errors.handle, /Tapez le pseudo Twitch/);
  assert.match((await act(ctx, "attach", { id: camille, handle: "x" })).errors.handle, /trop court/);
  const r = await act(ctx, "attach", { id: camille, handle: "https://twitch.tv/Roux_TV" });
  assert.match(r.ok, /roux_tv est ajoutée|elle rejoint/);
  const c = dumpOf(book).contacts.find((x) => x.id === camille);
  assert.deepEqual([dumpOf(book).contacts.length, c.name, c.categoryIds, c.accounts.map((a) => a.handle).sort()], [before, "Camille Roux", [cat], ["@camille_roux", "roux_tv"]]);
  assert.equal(c.accounts.find((a) => a.handle === "roux_tv").displayName, "Roux Tv");
  // pseudo déjà sur une autre fiche
  const bob = book.seedContact({ name: "Bob" }).id;
  assert.match((await act(ctx, "attach", { id: bob, handle: "roux_tv" })).errors.handle, /déjà sur la fiche de « Camille Roux »\. Cherchez cette personne par son nom/);
  // personne effacée entre-temps
  book.admin.deleteContact(bob);
  assert.match((await act(ctx, "attach", { id: bob, handle: "dubois_tv" })).errors.handle, /n'existe plus dans Contacts/);
});

test("rien trouvé : UN bouton « Créer <ce que j'ai tapé> » ; un pseudo suffit (le nom vient de Twitch) ; un nom demande seulement son pseudo Twitch", async () => {
  known("zoe_tv");
  const { ctx, book, cat } = site({ category: true });
  let blocks = await panel(ctx, { add: "zoe_tv" });
  const f1 = blocks.find((b) => b.type === "adminForm" && b.action === "create");
  assert.equal(f1.submitLabel, "Créer « zoe_tv »");
  assert.deepEqual(f1.fields.map((f) => f.name), ["q"], "aucun autre champ pour un pseudo");
  assert.match(blocks.find((b) => b.type === "markdown" && /Personne ne s'appelle/.test(b.text)).text, /« zoe_tv »/);
  assert.match((await act(ctx, "create", { q: "zoe_tv" })).ok, /zoe_tv est ajoutée/);
  assert.deepEqual([byHandle(book, "zoe_tv").name, byHandle(book, "zoe_tv").categoryIds, byHandle(book, "zoe_tv").source], ["Zoe Tv", [cat], "twitch-raid"], "le nom vient de Twitch");
  // un nom : un seul champ de plus, le pseudo
  blocks = await panel(ctx, { add: "Zoé Dupont" });
  const f2 = blocks.find((b) => b.type === "adminForm" && b.action === "create");
  assert.deepEqual(f2.fields.map((f) => f.name), ["q", "handle"]);
  assert.equal(f2.submitLabel, "Créer « Zoé Dupont »");
  assert.match((await act(ctx, "create", { q: "Zoé Dupont", handle: "" })).errors.handle, /Tapez le pseudo Twitch/);
  known("zoedupont");
  assert.match((await act(ctx, "create", { q: "Zoé Dupont", handle: "@ZoeDupont" })).ok, /Zoé Dupont est ajoutée/);
  const z = byHandle(book, "zoedupont");
  assert.deepEqual([z.name, z.categoryIds, z.accounts.length], ["Zoé Dupont", [cat], 1], "le nom tapé est gardé (jamais écrasé par celui de Twitch)");
});

test("résultats : 10 par étape, « Voir plus » jusqu'à 30 (le maximum de Contacts), puis plus de lien ; jamais plus de résultats que demandé", async () => {
  const { ctx, book } = site({ category: true });
  for (let i = 0; i < 45; i++) book.seedContact({ name: `Camille ${String(i).padStart(2, "0")}`, accounts: [{ network: "twitch", handle: `camille_${String(i).padStart(2, "0")}` }] });
  const rows = async (more) => { const b = await panel(ctx, { add: "camille", ...(more ? { more } : {}) }); return { n: b.find((x) => x.type === "table" && x.rowActions?.[0]?.action === "pick").rows.length, more: b.filter((x) => x.type === "links").flatMap((x) => x.items).find((l) => /^\?add=/.test(l.href))?.href }; };
  assert.deepEqual(await rows(), { n: 10, more: "?add=camille&more=20" });
  assert.deepEqual(await rows("20"), { n: 20, more: "?add=camille&more=30" });
  assert.deepEqual(await rows("30"), { n: 30, more: undefined });
  assert.deepEqual(await rows("500"), { n: 10, more: "?add=camille&more=20" }, "une valeur forgée est ramenée à 10");
  const search = book.calls.filter(([, m]) => m === "search").map(([, , a]) => a.limit);
  assert.ok(search.every((l) => l <= 30));
});

/* ───────────── Coller plusieurs lignes ───────────── */

test("coller plusieurs lignes : aperçu exact (nouvelles / déjà dans Contacts / déjà dans la liste / invalides avec raison et exemple) SANS rien écrire dans Contacts", async () => {
  const { ctx, book, cat } = site({ category: true });
  book.seedContact({ name: "Dans Contacts", accounts: [{ network: "twitch", handle: "dans_contacts" }] });
  book.seedContact({ name: "Dans Liste", accounts: [{ network: "twitch", handle: "dans_liste" }], categoryIds: [cat] });
  const lines = ["new_one", "https://twitch.tv/New_Two", "@new_three", "dans_contacts", "dans_liste", "NEW_ONE", "ab", "jean dupont", "twitch.tv/videos"];
  const before = JSON.stringify(dumpOf(book));
  assert.deepEqual(await act(ctx, "bulkPreview", { lines: lines.join("\n") }), { ok: undefined, redirect: "?" });
  assert.equal(JSON.stringify(dumpOf(book)), before, "l'aperçu n'écrit rien dans Contacts");
  const blocks = await panel(ctx);
  const text = blocks.find((b) => b.type === "markdown" && /Aperçu/.test(b.text)).text;
  assert.match(text, /\*\*Nouvelles\*\* : 3/); assert.match(text, /\*\*Déjà dans Contacts\*\* : 1/); assert.match(text, /\*\*Déjà dans votre liste\*\* : 1/); assert.match(text, /\*\*Invalides\*\* : 3/);
  assert.match(text, /Lignes en double ignorées : 1\./);
  assert.match(text, /Invalide : ligne 7, « ab » \(trop court, 4 caractères au moins\)\./);
  assert.match(text, /Invalide : ligne 8, « jean dupont » \(lettres sans accent, chiffres et _ seulement\)\./);
  assert.match(text, /Invalide : ligne 9, « twitch\.tv\/videos » \(ce n'est pas une chaîne\)\./);
  const apply = blocks.find((b) => b.type === "adminForm" && b.action === "bulkApply");
  assert.equal(apply.submitLabel, "Ajouter ces 4 chaînes");
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "bulkCancel"));
  assert.ok(!blocks.some((b) => b.type === "adminForm" && b.action === "bulkPreview"), "un envoi attend : on ne colle pas par-dessus");
  // le document en attente ne garde que des pseudos publics
  const doc = (await ctx.api.store.list(quick.BATCH))[0].data;
  assert.deepEqual(doc.todo.map((x) => x.login), ["new_one", "new_two", "new_three", "dans_contacts"]);
  assert.ok(!JSON.stringify(doc).includes("Dans Contacts"));
});

test("valider l'envoi : nouvelles fiches (nom et photo de Twitch en UN appel), la fiche existante rejoint la liste, rien de doublé ; rejouable ; le document disparaît", async () => {
  known("new_one", "new_two", "new_three");
  const { ctx, book, cat } = site({ category: true });
  const old = book.seedContact({ name: "Dans Contacts", accounts: [{ network: "twitch", handle: "dans_contacts" }] }).id;
  await act(ctx, "bulkPreview", { lines: "new_one\nnew_two\nnew_three\ndans_contacts\nnew_one" });
  const r = await act(ctx, "bulkApply");
  assert.match(r.ok, /Terminé\. Nouvelles fiches : 3\. Déjà dans Contacts et ajoutées à la liste : 1\. Déjà dans la liste : 0\./);
  assert.equal(r.redirect, "?");
  assert.equal(api.calls.length, 1, "un seul appel groupé à Twitch");
  assert.deepEqual(api.calls[0].query.login.sort(), ["dans_contacts", "new_one", "new_three", "new_two"]);
  const d = dumpOf(book);
  assert.equal(d.contacts.length, 4);
  assert.ok(d.contacts.every((c) => c.categoryIds.includes(cat)));
  assert.equal(d.contacts.find((c) => c.id === old).name, "Dans Contacts");
  assert.equal(byHandle(book, "new_two").accounts[0].displayName, "New Two");
  assert.equal(await quick.readBatch(ctx), null, "terminé : plus rien en attente");
  assert.match((await act(ctx, "bulkApply")).error, /l'aperçu a expiré/);
  // recoller les mêmes lignes : tout est déjà là
  await act(ctx, "bulkPreview", { lines: "new_one\nnew_two\nnew_three\ndans_contacts" });
  const again = (await panel(ctx)).find((b) => b.type === "markdown" && /Aperçu/.test(b.text)).text;
  assert.match(again, /\*\*Nouvelles\*\* : 0/); assert.match(again, /\*\*Déjà dans votre liste\*\* : 4/);
  assert.equal(dumpOf(book).contacts.length, 4);
});

test("200 lignes au plus : 201 sont refusées sous le champ avec leur nombre ; 200 passent, Twitch est interrogé par paquets de 100", async () => {
  const { ctx, book } = site({ category: true });
  const names = Array.from({ length: 201 }, (_, i) => `chaine_${String(i).padStart(4, "0")}`);
  assert.match((await act(ctx, "bulkPreview", { lines: names.join("\n") })).errors.lines, /Vous avez collé 201 lignes : 200 au plus à la fois/);
  assert.equal(await quick.readBatch(ctx), null);
  for (const n of names.slice(0, 200)) known(n);
  await act(ctx, "bulkPreview", { lines: names.slice(0, 200).join("\n") });
  const r = await act(ctx, "bulkApply");
  assert.match(r.ok, /Nouvelles fiches : 200/);
  assert.deepEqual(api.calls.map((c) => c.query.login.length), [100, 100]);
  assert.equal(dumpOf(book).contacts.length, 200);
  assert.match((await act(ctx, "bulkPreview", { lines: "" })).errors.lines, /Collez au moins une chaîne/);
  assert.match((await act(ctx, "bulkPreview", { lines: "ab\ncd" })).errors.lines, /Aucune de ces lignes n'est un pseudo Twitch.*4 à 25 caractères/);
});

test("un envoi trop long pour un clic : une partie est faite, « Continuer » reprend là où il en était, sans rien refaire ni doubler ; barre de progression", async () => {
  const { ctx, book } = site({ category: true });
  const names = Array.from({ length: 40 }, (_, i) => `chaine_${String(i).padStart(3, "0")}`);
  await act(ctx, "bulkPreview", { lines: names.join("\n") });
  // Contacts un peu lent (5 ms par fiche) et un budget de 60 ms par clic : quelques fiches par clic seulement
  const slow = ctx.api.services.call;
  ctx.api.services.call = async (service, method, args, opts) => { if (method === "upsertByAccount") await new Promise((r) => setTimeout(r, 5)); return slow(service, method, args, opts); };
  quick.timing.budgetMs = 60;
  for (const n of names) known(n);
  const r1 = await act(ctx, "bulkApply");
  assert.match(r1.ok, /C'est long : une partie est faite, il en reste \d+\./);
  const mid = await panel(ctx);
  const bar = mid.find((b) => b.type === "html");
  assert.match(bar.html, /<progress value="\d+" max="40"/);
  assert.ok(mid.some((b) => b.type === "adminForm" && b.action === "bulkApply" && /^Continuer \(\d+ restantes\)$/.test(b.submitLabel)));
  const doneMid = dumpOf(book).contacts.length;
  assert.ok(doneMid > 0 && doneMid < 40, `partiel : ${doneMid}`);
  let guard = 0, last;
  do { last = await act(ctx, "bulkApply"); } while (/C'est long/.test(last.ok ?? "") && ++guard < 40);
  assert.match(last.ok, /Terminé\. Nouvelles fiches : \d+\./);
  assert.equal(dumpOf(book).contacts.length, 40, "aucun doublon, aucun oubli");
  assert.equal(await quick.readBatch(ctx), null);
});

test("un envoi en attente expire au bout de 30 minutes ; « Annuler cet envoi » l'efface", async () => {
  const { ctx } = site({ category: true });
  await act(ctx, "bulkPreview", { lines: "chaine_aaa\nchaine_bbb" });
  assert.ok(await quick.readBatch(ctx));
  const doc = (await ctx.api.store.list(quick.BATCH))[0];
  await ctx.api.store.update(doc.id, { ...doc.data, at: Date.now() - 31 * 60_000 });
  assert.equal(await quick.readBatch(ctx), null);
  assert.equal((await ctx.api.store.list(quick.BATCH)).length, 0, "effacé à la lecture");
  await act(ctx, "bulkPreview", { lines: "chaine_aaa" });
  assert.deepEqual(await act(ctx, "bulkCancel"), { ok: undefined, redirect: "?" });
  assert.equal(await quick.readBatch(ctx), null);
});

/* ───────────── Twitch en panne, absent, limité ───────────── */

test("sans Connecteur Twitch : l'ajout marche, la fiche prend le pseudo comme nom, un message le dit ; en envoi groupé aussi", async () => {
  const { ctx, book } = site({ category: true, twitch: false });
  const r = await act(ctx, "find", { q: "@alice_tv" });
  assert.match(r.ok, /alice_tv est ajoutée.*Contacts la complétera à sa première ouverture/);
  assert.equal(byHandle(book, "alice_tv").name, "alice_tv");
  await act(ctx, "bulkPreview", { lines: "bob_tv\ncarol_tv" });
  assert.match((await act(ctx, "bulkApply")).ok, /Nouvelles fiches : 2.*Contacts la complétera/);
});

test("trou noir : Twitch ne répond jamais → l'ajout aboutit sans nom ni photo, en moins d'une seconde avec des délais courts ; 429 → message « patienter »", async () => {
  Object.assign(profiles.timing, { channelMs: 100, packetMs: 120, totalMs: 300 });
  const { ctx, book } = site({ category: true });
  api.hang = true;
  const t0 = performance.now();
  const r = await within(act(ctx, "find", { q: "@alice_tv" }));
  assert.notEqual(r, HUNG); assert.ok(performance.now() - t0 < 1500, `${Math.round(performance.now() - t0)} ms`);
  assert.match(r.ok, /alice_tv est ajoutée/); assert.equal(byHandle(book, "alice_tv").name, "alice_tv");
  api.hang = false; api.reply = { ok: true, status: 429, json: {} };
  assert.match((await act(ctx, "find", { q: "@bob_tv" })).ok, /Twitch demande de patienter.*prochaine ouverture de la fiche/);
  assert.equal(byHandle(book, "bob_tv").name, "bob_tv");
  api.reply = { ok: false, error: "rate" };
  assert.match((await act(ctx, "find", { q: "@carol_tv" })).ok, /Twitch demande de patienter/);
  api.reply = { ok: true, status: 500, json: {} };
  assert.match((await act(ctx, "find", { q: "@dave_tv" })).ok, /n'ont pas pu être repris sur Twitch/);
  api.reply = { ok: true, status: 200, json: { data: "n'importe quoi" } };
  assert.match((await act(ctx, "find", { q: "@erin_tv" })).ok, /n'ont pas pu être repris sur Twitch/);
  assert.equal(dumpOf(book).contacts.length, 5);
});

test("une réponse de Twitch n'est jamais crue sur parole : nom coupé, photo non https écartée, pseudos étrangers ignorés", async () => {
  const { ctx, book } = site({ category: true });
  api.reply = { ok: true, status: 200, json: { data: [
    { login: "alice_tv", display_name: "A".repeat(100), profile_image_url: "http://insecure.example.test/a.png" },
    { login: "autre_pseudo", display_name: "Intrus", profile_image_url: "https://x.example.test/x.png" },
    { login: "<b>x</b>", display_name: "Piège" }, 42, null,
  ] } };
  await act(ctx, "find", { q: "@alice_tv" });
  const c = byHandle(book, "alice_tv");
  assert.equal(c.name, "A".repeat(40)); assert.equal(c.accounts[0].avatar, undefined);
  assert.equal(dumpOf(book).contacts.length, 1);
});

/* ───────────── Contacts absent, ancien, muet, plein ───────────── */

test("Contacts absent : message clair en haut, proposition d'installer par service, aucun champ qui échouera ; ancien (sans l'extension) ou muet : message sous le champ", async () => {
  const none = site({ category: true });
  none.ctx.api.services.call = async () => ({ ok: false, reason: "unavailable" });
  const blocks = await panel(none.ctx);
  assert.ok(blocks.some((b) => b.type === "suggestInstall" && b.service === "contact.book"));
  assert.ok(blocks.some((b) => b.type === "markdown" && /a besoin de Contacts/.test(b.text)));
  assert.ok(!blocks.some((b) => b.type === "adminForm" && b.action === "find"), "pas de champ qui ne peut que échouer");
  assert.match((await act(none.ctx, "find", { q: "@alice_tv" })).errors.q, /qui n'est pas installé/);
  // Contacts d'avant l'extension : méthodes de contact.curate inconnues
  known("alice_tv");
  const old = site({ category: true, curate: false });
  assert.match((await act(old.ctx, "find", { q: "@alice_tv" })).errors.q, /Contacts n'est pas assez récent/);
  assert.equal(dumpOf(old.book).contacts.length, 0);
  // muet
  Object.assign(source.timing, { callMs: 80, readMs: 200 });
  const mute = site({ category: true });
  mute.cur.faults.hang.add("lookupAccounts");
  const t0 = performance.now();
  const r = await within(act(mute.ctx, "find", { q: "@alice_tv" }));
  assert.notEqual(r, HUNG); assert.ok(performance.now() - t0 < 1500);
  assert.match(r.errors.q, /Contacts ne répond pas pour le moment/);
  mute.book.faults.hang.add("search");
  const p = await within(panel(mute.ctx, { add: "Camille" }), 6000);
  assert.notEqual(p, HUNG);
  assert.ok(p.some((b) => b.type === "banner" && /Contacts ne répond pas/.test(b.text)));
});

test("catégorie choisie puis supprimée : l'ajout dit quoi faire ; Contacts plein : message, ce qui reste est gardé pour plus tard", async () => {
  known("alice_tv");
  const { ctx, book } = site({});
  const gone = book.seedCategory("Disparue");
  const withSetting = fakeCtx({ ...{}, key: "quickset", moduleId: "twitch-raid", locale: "fr", defaultLocale: "fr", messages: { ...fr }, settings: { category: gone }, permissions: manifest.permissions, services: { "contact.book": book.methods, "contact.curate": site().cur.methods } });
  book.admin.deleteCategory(gone);
  const r = await act(withSetting, "find", { q: "@alice_tv" });
  assert.match(r.errors.q, /La catégorie choisie n'existe plus, choisissez-en une dans le réglage « Liste de raid »/);
  void ctx;
  const full = fakeContactBook({ maxContacts: 3 });
  const f = fakeCtx({ key: "quickfull", moduleId: "twitch-raid", locale: "fr", defaultLocale: "fr", messages: { ...fr }, permissions: manifest.permissions, services: { "contact.book": full.methods, "contact.curate": fakeContactCurate(full).methods }, serviceInstances: { "twitch.api": [{ instance: "tw", methods: api.methods }] } });
  carryRights(f, full);
  full.seedCategory("Cible de raid");
  known("aaaa_tv", "bbbb_tv", "cccc_tv", "dddd_tv", "eeee_tv");
  await act(f, "bulkPreview", { lines: "aaaa_tv\nbbbb_tv\ncccc_tv\ndddd_tv\neeee_tv" });
  const r2 = await act(f, "bulkApply");
  assert.match(r2.error, /Contacts est plein \(100 000 fiches\)/);
  assert.equal(full.dump().contacts.length, 3);
  assert.equal(await quick.readBatch(f), null);
});

/* ───────────── Ma liste : pages, recherche, Retirer ───────────── */

test("la liste : 50 par page avec un curseur, « Page suivante » / « Début de la liste », jamais tout d'un coup ; un curseur forgé est ignoré", async () => {
  const { ctx, book, cat } = site({ category: true });
  for (let i = 0; i < 120; i++) book.seedContact({ name: `Membre ${String(i).padStart(3, "0")}`, accounts: [{ network: "twitch", handle: `membre_${String(i).padStart(3, "0")}` }], categoryIds: [cat] });
  const seen = []; let cur = "", pages = 0;
  do {
    const blocks = await panel(ctx, cur ? { cur } : {});
    const t = blocks.find((b) => b.type === "table" && b.rowActions?.[0]?.action === "remove");
    assert.ok(t.rows.length <= 50);
    seen.push(...t.rowIds);
    const next = blocks.filter((b) => b.type === "links").flatMap((b) => b.items).find((l) => /cur=/.test(l.href));
    cur = next ? decodeURIComponent(/cur=([^&]+)/.exec(next.href)[1]) : "";
    if (pages > 0) assert.ok(blocks.flatMap((b) => (b.type === "links" ? b.items : [])).some((l) => l.label === "Début de la liste"));
    pages++;
  } while (cur && pages < 10);
  assert.equal(pages, 3); assert.equal(new Set(seen).size, 120);
  const bad = await panel(ctx, { cur: "<script>alert(1)</script>" });
  assert.equal(bad.find((b) => b.type === "table" && b.rowActions?.[0]?.action === "remove").rows.length, 50, "curseur illisible : retour à la première page");
  assert.ok(book.calls.filter(([, m]) => m === "accounts" && Number(m.length) >= 0).every(([, , a]) => a.limit <= 500));
});

test("la liste avec recherche : seulement les chaînes de la liste qui correspondent (nom ou pseudo) ; aucune correspondance : un message et un lien pour effacer", async () => {
  const { ctx, book, cat } = site({ category: true });
  book.seedContact({ name: "Anna Petit", accounts: [{ network: "twitch", handle: "anna_live" }], categoryIds: [cat] });
  book.seedContact({ name: "Anna Hors Liste", accounts: [{ network: "twitch", handle: "anna_autre" }] });
  book.seedContact({ name: "Bob", accounts: [{ network: "twitch", handle: "bob_live" }], categoryIds: [cat] });
  assert.deepEqual(await act(ctx, "listSearch", { lq: " Anna " }), { ok: undefined, redirect: "?lq=Anna" });
  const t = (await panel(ctx, { lq: "Anna" })).find((b) => b.type === "table" && b.rowActions?.[0]?.action === "remove");
  assert.deepEqual(t.rows, [["Anna Petit", "@anna_live"]]);
  const none = await panel(ctx, { lq: "zzzz" });
  assert.ok(none.some((b) => b.type === "markdown" && /Aucune chaîne de votre liste ne correspond à « zzzz »/.test(b.text)));
  assert.ok(none.some((b) => b.type === "links" && b.items[0].label === "Effacer la recherche"));
  assert.deepEqual(await act(ctx, "listSearch", { lq: "" }), { ok: undefined, redirect: "?" });
});

test("Retirer : la fiche sort de la catégorie Cible de raid et d'elle seule ; la fiche, ses comptes et ses autres catégories restent ; rejouable ; le dock suit tout de suite", async () => {
  const { ctx, book, cat } = site({ category: true });
  const other = book.seedCategory("Amis");
  const id = book.seedContact({ name: "Anna Petit", accounts: [{ network: "twitch", handle: "anna_live" }, { network: "youtube", handle: "@anna_yt" }], categoryIds: [cat, other] }).id;
  book.seedContact({ name: "Bob", accounts: [{ network: "twitch", handle: "bob_live" }], categoryIds: [cat] });
  assert.equal((await source.targets(ctx)).partners.length, 2);
  const r = await act(ctx, "remove", { id });
  assert.match(r.ok, /Retirée de la liste « Cible de raid »\. Sa fiche reste dans Contacts\./);
  assert.equal(r.redirect, undefined, "la page reste où elle est (pas de retour à la première page)");
  const c = dumpOf(book).contacts.find((x) => x.id === id);
  assert.deepEqual([c.name, c.categoryIds, c.accounts.length], ["Anna Petit", [other], 2]);
  assert.deepEqual((await source.targets(ctx)).partners.map((p) => p.login), ["bob_live"], "le cache de la liste est invalidé tout de suite");
  assert.match((await act(ctx, "remove", { id })).ok, /n'était plus dans la liste/);
  assert.match((await act(ctx, "remove", { id: "inconnue" })).ok, /n'était plus dans la liste/);
  assert.equal(dumpOf(book).contacts.length, 2, "aucune fiche supprimée");
  // le bouton demande confirmation en mots simples
  const t = (await panel(ctx)).find((b) => b.type === "table" && b.rowActions?.[0]?.action === "remove");
  assert.deepEqual([t.rowActions[0].label, t.rowActions[0].confirm, t.rowActions[0].danger], ["Retirer", "Retirer de la liste « Cible de raid » ? La fiche reste dans Contacts.", undefined]);
});

test("l'ajout vide le cache de la liste : le dock voit tout de suite la nouvelle chaîne ; le dock lui-même n'a pas changé (même module de lecture)", async () => {
  known("alice_tv");
  const { ctx } = site({ category: true });
  assert.equal((await source.targets(ctx)).partners.length, 0);
  await act(ctx, "find", { q: "@alice_tv" });
  assert.deepEqual((await source.targets(ctx)).partners.map((p) => [p.login, p.name]), [["alice_tv", "Alice Tv"]]);
  assert.deepEqual(Object.keys(def.routes).sort(), ["dock", "live", "pick"]);
});

/* ───────────── Textes, FR + EN, rien d'affiché en secret ───────────── */

test("textes : toutes les clés utilisées existent en FR et EN ; le panneau anglais parle anglais ; aucune clé manquante affichée", async () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
  const used = new Set([...files.matchAll(/\bt\("([a-z_0-9]+)"/g)].map((m) => m[1]));
  for (const k of used) assert.ok(fr[k] !== undefined && en[k] !== undefined, `clé manquante : ${k}`);
  for (const k of ["add_err_chars", "add_err_short", "add_err_long", "add_err_not_channel", "batch_reason_chars", "batch_reason_short", "batch_reason_long", "batch_reason_not_channel"]) assert.ok(fr[k] && en[k], k);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  known("camille_tv");
  const e = site({ lang: "en", category: true });
  const blocks = await panel(e.ctx);
  assert.ok(blocks.some((b) => b.type === "heading" && b.text === "Add a channel"));
  assert.equal(blocks.find((b) => b.type === "adminForm" && b.action === "find").fields[0].label, "Name, Twitch name or link");
  assert.match((await act(e.ctx, "find", { q: "twitch.tv/ab" })).errors.q, /too short: a Twitch name has at least 4 characters/);
  const seenText = JSON.stringify(blocks) + JSON.stringify(await act(e.ctx, "find", { q: "@camille_tv" }));
  assert.ok(!/undefined|\[object|add_[a-z_]+|res_[a-z_]+|batch_[a-z_]+|mylist_[a-z_]+/.test(seenText.replace(/"action":"[a-zA-Z]+"/g, "")), "aucune clé de traduction ni undefined affiché");
});

test("le champ est le premier bloc d'action de la page (mobile d'abord) et la liste n'est pas lue quand rien ne la demande trop", async () => {
  const { ctx } = site({ category: true });
  const blocks = await panel(ctx);
  const first = blocks.findIndex((b) => b.type === "adminForm");
  assert.equal(blocks[first].action, "find");
  assert.ok(blocks.findIndex((b) => b.type === "heading" && b.text === "Ajouter une chaîne") < blocks.findIndex((b) => b.type === "heading" && b.text === "Votre dock"), "ajouter avant l'adresse du dock");
});
