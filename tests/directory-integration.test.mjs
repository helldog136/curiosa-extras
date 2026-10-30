// Annuaire — les liens avec le reste du site : le sujet `map.place` (seulement avec accord), les outils de l'assistant (lecture seule), les deux routes publiques (recherche, CSV),
// « Proposer ma fiche », la vie privée (privacy.subject), la sauvegarde lisible, et la mise à jour à chaud. Contacts : double fakeContactBook. Aucun réseau.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { runPrivacySubjectContract } from "./contract/privacySubject.contract.mjs";
import { makeWorld, reset, restore, publish, people, page, htmlOf, P, C, D, View, def, manifest, Privacy, TW_PHOTO } from "./helpers/directory-world.mjs";
import { makeTempDir } from "./helpers/tmp.mjs";

beforeEach(() => reset());
afterEach(() => restore());

const here = path.dirname(new URL(import.meta.url).pathname);
const get = (ctx, route, qs = "", init = {}) => def.routes[route](new Request(`https://site.example.test/m/${ctx.instance.key}/${route}${qs}`, init), ctx);
const mcp = (ctx, name, args = {}) => def.mcp[name](ctx, args, { name: "test" });

async function world({ n = 6, settings = {}, can = true } = {}) {
  const book = fakeContactBook();
  const cat = book.seedCategory("Créateurs"), cat2 = book.seedCategory("Invités");
  const list = people(book, cat, n, { prefix: "P" });
  const w = makeWorld({ book, settings, can });
  await publish(w.ctx, [{ id: cat, label: "Créateurs" }, { id: cat2, label: "Invités" }]);
  return { ...w, cat, cat2, list };
}

/* ───────────── La carte : map.place ───────────── */

test("map.place : rien par défaut ; avec la catégorie d'accord, seulement les personnes qui ont une ville et des coordonnées arrondies ; jamais d'adresse", async () => {
  const { ctx, book, cat, list, settings } = await world({ n: 5 });
  const place = (limit) => def.exports["map.place"](ctx, { locale: "fr", limit });
  await D.patchProfile(ctx, list[0].id, { city: "Namur", geo: { lat: 50.46691, lng: 4.86746 } });
  assert.deepEqual(await place(), [], "pas de catégorie d'accord réglée : aucune coordonnée publiée");
  const ok = book.seedCategory("Accepte la carte");
  settings.mapConsent = ok;
  assert.deepEqual(await place(), [], "réglée, mais personne n'y est rangé");
  book.admin.setCategories(list[0].id, [cat, ok]);
  book.admin.setCategories(list[1].id, [cat, ok]); // d'accord mais sans ville
  book.admin.setCategories(list[2].id, [cat, ok]); // d'accord, ville mais masquée
  await D.patchProfile(ctx, list[2].id, { city: "Liège", geo: { lat: 50.63, lng: 5.57 }, hidden: true });
  await D.patchProfile(ctx, list[3].id, { city: "Gand", geo: { lat: 51.05, lng: 3.72 } }); // une ville mais pas d'accord
  C.resetModel();
  const places = await place();
  assert.equal(places.length, 1);
  const p = places[0];
  assert.deepEqual({ lat: p.lat, lng: p.lng, title: p.title, kind: p.kind, note: p.note }, { lat: 50.47, lng: 4.87, title: "P 001", kind: "member", note: "Namur" });
  assert.match(p.id, /^directory:annuaire-\d+:[0-9a-f]{10}$/);
  assert.equal(p.url, `/annuaire/p/${P.personSlug("P 001", P.personHash(list[0].id))}`);
  assert.deepEqual(Object.keys(p).sort(), ["id", "kind", "lat", "lng", "note", "title", "url"], "aucune autre donnée");
  assert.equal((await place(1)).length, 1);
  assert.ok(manifest.provides.some((x) => x.topic === "map.place"));
});

test("map.place : deux annuaires donnent des identifiants différents pour la même personne ; une personne retirée du consentement disparaît", async () => {
  const a = await world({ n: 1 }), b = await world({ n: 1 });
  for (const w of [a, b]) {
    const ok = w.book.seedCategory("Accepte la carte");
    w.settings.mapConsent = ok;
    w.book.admin.setCategories(w.list[0].id, [w.cat, ok]);
    await D.patchProfile(w.ctx, w.list[0].id, { city: "Namur", geo: { lat: 50.4, lng: 4.8 } });
  }
  assert.notEqual((await def.exports["map.place"](a.ctx, {}))[0].id, (await def.exports["map.place"](b.ctx, {}))[0].id);
  a.book.admin.setCategories(a.list[0].id, [a.cat]);
  C.resetModel();
  assert.deepEqual(await def.exports["map.place"](a.ctx, {}), []);
});

test("fiche publique : sans ville, plus de coordonnées ; les coordonnées enregistrées sont toujours arrondies", async () => {
  const { ctx, list } = await world({ n: 1 });
  await D.patchProfile(ctx, list[0].id, { city: "Namur", geo: { lat: 50.466912345, lng: 4.867461234 } });
  assert.deepEqual((await D.readData(ctx, { fresh: true })).profiles.get(list[0].id).geo, { lat: 50.47, lng: 4.87 });
  await D.patchProfile(ctx, list[0].id, { city: "" });
  assert.equal((await D.readData(ctx, { fresh: true })).profiles.size, 0);
});

/* ───────────── Les outils de l'assistant ───────────── */

test("outils : cinq outils, tous en lecture seule, tous déclarés et réalisés ; aucun ne modifie quoi que ce soit", async () => {
  const names = manifest.mcp.map((m) => m.name).sort();
  assert.deepEqual(names, ["directory_categories", "directory_person", "directory_search", "directory_status", "directory_team"]);
  assert.ok(manifest.mcp.every((m) => m.readOnly === true && !m.destructive));
  assert.deepEqual(Object.keys(def.mcp).sort(), names);
  assert.ok(names.every((n) => `annuaire-partenaires__${n}`.length <= 64));
  const { ctx } = await world({ n: 3 });
  const writes = ctx.calls.writes.length;
  for (const n of names) await mcp(ctx, n, n === "directory_person" ? { slug: "x-0123456789" } : {}).catch(() => {});
  assert.equal(ctx.calls.writes.length, writes);
});

test("outils : l'état, la recherche (accents ignorés, catégories, curseur), une fiche, l'équipe — seulement ce qu'un visiteur voit", async () => {
  const { ctx, book, cat, list } = await world({ n: 7 });
  const accent = book.seedContact({ name: "Hélène Secrète", email: "secret@example.test", phone: "0470 00 00 00", role: "privé", categoryIds: [cat], accounts: [{ network: "twitch", handle: "helene_tv" }] });
  await D.patchProfile(ctx, accent.id, { bio: { fr: "Bonjour" }, city: "Namur" });
  await D.addTeamMember(ctx, list[0].id, { fr: "Présidente" });
  book.admin.setCategories(list[6].id, [cat, book.seedCategory("Ne pas montrer")]);
  const st = await mcp(ctx, "directory_status");
  assert.equal(st.state, "ok"); assert.equal(st.visible, 7); assert.equal(st.team, 1); assert.equal(st.hiddenByContacts, 1);
  assert.deepEqual(st.categories.map((c) => c.slug), ["createurs", "invites"]);
  const found = await mcp(ctx, "directory_search", { q: "helene" });
  assert.equal(found.count, 1);
  const who = found.people[0];
  assert.deepEqual([who.name, who.city, who.categories[0].slug], ["Hélène Secrète", "Namur", "createurs"]);
  const dump = JSON.stringify(found);
  for (const secret of ["secret@example.test", "0470", "privé", "helene_tv"]) assert.ok(!dump.includes(secret), `${secret} ne sort pas de la liste`);
  const one = await mcp(ctx, "directory_person", { slug: who.slug });
  assert.equal(one.person.presentation, "Bonjour");
  assert.equal(one.person.links[0].url, "https://www.twitch.tv/helene_tv");
  assert.ok(!JSON.stringify(one).includes("secret@example.test"));
  await assert.rejects(() => mcp(ctx, "directory_person", { slug: "personne-0000000000" }), (e) => e.expose === true);
  const page1 = await mcp(ctx, "directory_search", { limit: 3 });
  assert.equal(page1.people.length, 3); assert.ok(page1.next);
  assert.ok((await mcp(ctx, "directory_search", { limit: 3, cursor: page1.next })).people[0].slug !== page1.people[0].slug);
  assert.equal((await mcp(ctx, "directory_search", { categories: ["invites"] })).count, 0);
  assert.equal((await mcp(ctx, "directory_search", { categories: ["inconnue"] })).count, 7, "catégorie inconnue ignorée");
  assert.deepEqual((await mcp(ctx, "directory_team")).team.map((m) => [m.name, m.role]), [["P 001", "Présidente"]]);
  assert.ok(!(await mcp(ctx, "directory_search", { q: "P 007" })).people.length, "la personne cachée n'est jamais renvoyée");
});

test("outils : Contacts absent ou rien de réglé → un état clair, jamais une erreur", async () => {
  const none = makeWorld({ withBook: false });
  assert.equal((await mcp(none.ctx, "directory_status")).state, "absent");
  assert.deepEqual((await mcp(none.ctx, "directory_search", {})).people, []);
  const st = await mcp(makeWorld({ book: fakeContactBook() }).ctx, "directory_status");
  assert.equal(st.state, "unready"); assert.equal(st.reason, "no_categories");
});

/* ───────────── Les routes publiques ───────────── */

test("route de recherche : refait l'adresse à partir de valeurs vérifiées ; jamais de redirection ailleurs ; seulement GET", async () => {
  const { ctx } = await world({ n: 3 });
  const go = (qs) => get(ctx, "go", qs);
  let r = await go("?q=h%C3%A9l%C3%A8ne&c=createurs&s=new");
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/annuaire/c/createurs/q/h%C3%A9l%C3%A8ne/s/new");
  r = await go("?q=a%2Fb&c=createurs%2Binvites%2Binconnue&ph=1");
  assert.equal(r.headers.get("location"), "/annuaire/c/createurs+invites/q/a%20b/photos");
  for (const evil of ["//evil.example", "https://evil.example", "\\\\evil.example", "javascript:alert(1)"]) {
    const loc = (await go(`?q=${encodeURIComponent(evil)}&next=${encodeURIComponent(evil)}&redirect=${encodeURIComponent(evil)}`)).headers.get("location");
    assert.ok(loc.startsWith("/annuaire/") && !/^\/\/|^\/\\/.test(loc) && !loc.includes("://"), loc);
  }
  assert.equal((await go("")).headers.get("location"), "/annuaire");
  assert.equal((await get(ctx, "go", "", { method: "POST", body: "x" })).status, 405);
  assert.ok((await go("?q=" + "x".repeat(5000))).headers.get("location").length < 200, "borné");
});

test("CSV : les champs publics seulement, BOM, formules neutralisées, tri et filtres de la page", async () => {
  const { ctx, book, cat } = await world({ n: 2 });
  const evil = book.seedContact({ name: "=HYPERLINK(\"http://evil.example\")", email: "secret@example.test", phone: "0470 11 22 33", role: "privé", categoryIds: [cat], accounts: [{ network: "twitch", handle: "evil_tv" }] });
  await D.patchProfile(ctx, evil.id, { bio: { fr: "SECRET-BIO" }, city: "Namur" });
  const r = await get(ctx, "csv", "?s=az", { headers: { "x-forwarded-for": "203.0.113.5" } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /^text\/csv/);
  assert.match(r.headers.get("content-disposition"), /^attachment; filename="annuaire-\d+\.csv"$/);
  const raw = new Uint8Array(await r.arrayBuffer());
  assert.deepEqual([...raw.slice(0, 3)], [0xef, 0xbb, 0xbf], "BOM : Excel lit l'UTF-8");
  const body = new TextDecoder().decode(raw);
  assert.ok(body.startsWith("\"Nom\",\"Titre\",\"Catégories\",\"Ville\",\"Fiche\""));
  assert.ok(body.includes("\"'=HYPERLINK("), "une formule n'est jamais exécutée par le tableur");
  assert.ok(body.includes("Namur") && body.includes("https://site.example.test/annuaire/p/"));
  for (const secret of ["secret@example.test", "0470", "privé", "SECRET-BIO"]) assert.ok(!body.includes(secret), secret);
  assert.ok(body.includes("https://www.twitch.tv/evil_tv"), "les liens publics de la fiche sont dans le fichier");
  ctx.setting = ((orig) => (k) => (k === "links" ? "none" : orig(k)))(ctx.setting);
  const none = await (await get(ctx, "csv", "")).text();
  assert.ok(!none.includes("twitch.tv") && !none.includes("\"Liens\""), "réglage « liens nulle part » : ni colonne ni liens");
});

test("CSV : 429 après 10 demandes par minute pour un même visiteur, un autre visiteur n'est pas gêné ; désactivé → 404 ; pas prêt → 503", async () => {
  const { ctx, settings } = await world({ n: 2 });
  const as = (ip) => get(ctx, "csv", "", { headers: { "x-forwarded-for": ip } });
  for (let i = 0; i < 10; i++) assert.equal((await as("203.0.113.9")).status, 200);
  const limited = await as("203.0.113.9");
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("retry-after"));
  assert.equal((await as("203.0.113.10")).status, 200);
  settings.downloads = false;
  assert.equal((await as("203.0.113.11")).status, 404);
  assert.equal((await get(ctx, "csv", "", { method: "POST", body: "x" })).status, 405);
  assert.equal((await get(makeWorld({ book: fakeContactBook() }).ctx, "csv")).status, 503);
  assert.ok(!(await limited.text()).includes("annuaire"), "la réponse d'erreur ne dit rien d'interne");
});

test("CSV : 5 000 lignes au plus", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Membres");
  for (let i = 0; i < 5200; i++) book.seedContact({ name: `N ${String(i).padStart(5, "0")}`, categoryIds: [cat] });
  const { ctx } = makeWorld({ book });
  await publish(ctx, [{ id: cat, label: "Membres" }]);
  assert.equal((await (await get(ctx, "csv")).text()).trim().split("\r\n").length, 1 + 5000);
});

/* ───────────── « Proposer ma fiche » ───────────── */

test("« Proposer ma fiche » : la page choisie, sinon le formulaire de contact du site, sinon l'e-mail réglé, sinon celui du site, sinon aucun bouton", async () => {
  const { ctx, settings } = await world({ n: 2 });
  const btn = async () => /class="dr-btn" href="([^"]+)">(Proposer ma fiche|[^<]+)</.exec(htmlOf(await page(ctx)))?.[1];
  assert.equal(await btn(), undefined, "ni formulaire ni e-mail : pas de bouton");
  settings.proposeEmail = "contact@asso.example.test";
  assert.match(await btn(), /^mailto:contact@asso\.example\.test\?subject=/);
  ctx.api.brand = async () => ({ contactEmail: "site@example.test" });
  settings.proposeEmail = "pas un e-mail";
  assert.match(await btn(), /^mailto:site@example\.test/);
  ctx.api.instances = { list: async ({ module }) => (module === "contact-form" ? [{ key: "contact", basePath: "contact", module }] : []) };
  assert.equal(await btn(), "/contact");
  settings.proposeLabel = "Rejoignez-nous";
  assert.ok(htmlOf(await page(ctx)).includes(">Rejoignez-nous<"));
  settings.proposeLink = "/nous-ecrire";
  assert.equal(await btn(), "/nous-ecrire", "la page choisie passe avant tout");
  for (const bad of ["javascript:alert(1)", "//evil.example/x", "data:text/html,x", "http://x.example", "/a b"]) { settings.proposeLink = bad; assert.equal(View.safeTarget(bad), null, bad); assert.equal(await btn(), "/contact", "une destination refusée est ignorée"); }
  assert.equal(View.safeTarget("mailto:contact@asso.example.test"), "mailto:contact@asso.example.test");
  assert.equal(View.safeTarget("https://forms.example.test/join"), "https://forms.example.test/join");
  settings.proposeLink = "";
  ctx.api.instances = { list: async () => { throw new Error("boom"); } };
  assert.match(await btn(), /^mailto:/, "le formulaire en panne ne casse pas la page");
});

test("« Retirer ma fiche » : un lien sur chaque fiche vers le même contact, avec l'adresse de la fiche", async () => {
  const { ctx, list, settings } = await world({ n: 1 });
  settings.proposeEmail = "contact@asso.example.test";
  const html = htmlOf(await page(ctx, "p", P.personSlug("P 001", P.personHash(list[0].id))));
  const href = /href="(mailto:[^"]+)">Demander la modification/.exec(html)[1];
  assert.ok(decodeURIComponent(href).includes("https://site.example.test/annuaire/p/"));
});

/* ───────────── Vie privée ───────────── */

runPrivacySubjectContract(async () => {
  const w = makeWorld({ book: fakeContactBook() });
  const svc = def.services["privacy.subject"];
  return {
    methods: Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](w.ctx, args)])),
    addReference: async (contactId) => { await D.patchProfile(w.ctx, contactId, { bio: { fr: "x" }, city: "Namur" }); await D.addTeamMember(w.ctx, contactId, { fr: "Rôle" }); },
    countReferences: async (contactId) => { const r = await D.referencesOf(w.ctx, contactId); return r.profile || r.team ? 1 : 0; },
  };
}, { test, prefix: "annuaire privacy.subject" });

test("privacy.subject : l'export dit tout ce qui est gardé, l'effacement retire tout, la fusion ne remplace jamais ce qui existe déjà", async () => {
  const { ctx } = makeWorld({ book: fakeContactBook() });
  await D.patchProfile(ctx, "c-a", { bio: { fr: "Bio A" }, city: "Namur", geo: { lat: 50.4, lng: 4.8 }, hidden: true });
  await D.addTeamMember(ctx, "c-a", { fr: "Président" });
  const x = await Privacy.subject.export(ctx, { contactId: "c-a" });
  assert.deepEqual(x.data, { presentation: { bio: { fr: "Bio A" }, city: "Namur", mapPosition: { lat: 50.4, lng: 4.8 }, hiddenHere: true }, team: { role: { fr: "Président" } } });
  await D.patchProfile(ctx, "c-b", { bio: { fr: "Bio B" } });
  assert.equal((await Privacy.subject.remap(ctx, { from: "c-a", to: "c-b" })).updated, 2);
  const kept = await D.readData(ctx, { fresh: true });
  assert.equal(kept.profiles.get("c-b").bio.fr, "Bio B", "la présentation de la fiche gardée n'est pas écrasée");
  assert.equal(kept.profiles.has("c-a"), false);
  assert.deepEqual(kept.config.team.map((m) => m.contactId), ["c-b"]);
  assert.equal((await Privacy.subject.erase(ctx, { contactId: "c-b" })).removed, 2);
  const after = await D.readData(ctx, { fresh: true });
  assert.equal(after.profiles.size, 0); assert.equal(after.config.team.length, 0);
  for (const bad of [undefined, null, {}, { contactId: 42 }, { contactId: "x".repeat(500) }]) assert.deepEqual(await Privacy.subject.erase(ctx, bad), { removed: 0 });
});

test("le module ne copie jamais un nom, une photo, un compte, un e-mail ni un téléphone dans son stockage", async () => {
  const { ctx, book, cat } = await world({ n: 0 });
  const a = book.seedContact({ name: "Alice Unique", email: "alice.unique@example.test", phone: "0470 99 88 77", categoryIds: [cat], accounts: [{ network: "twitch", handle: "alice_unique_tv", avatar: TW_PHOTO }], photo: "https://moi.example.test/alice.png" });
  await D.patchProfile(ctx, a.id, { bio: { fr: "Courte" }, city: "Namur" });
  await D.addTeamMember(ctx, a.id, { fr: "Chef" });
  await page(ctx); await def.adminPanel(ctx, { query: {} }); await def.adminPanel(ctx, { query: { person: a.id } });
  const stored = JSON.stringify(ctx.dumpStore());
  for (const x of ["Alice", "Unique", "alice.unique@example.test", "0470", "alice_unique_tv", "moi.example.test", "twitch"]) assert.ok(!stored.includes(x), `« ${x} » ne doit pas être dans le stockage`);
});

test("sauvegarde lisible : catégories, équipe, fiches publiques — sans noms (ils restent dans Contacts), formules neutralisées", async () => {
  const { ctx, list } = await world({ n: 2 });
  await D.patchProfile(ctx, list[0].id, { bio: { fr: "=SOMME(A1)", en: "Hi" }, city: "Namur", hidden: true });
  await D.addTeamMember(ctx, list[1].id, { fr: "Trésorier" });
  const files = await def.backup.readable(ctx);
  assert.deepEqual(files.map((f) => f.path), ["categories.csv", "team.csv", "profiles.csv"]);
  const t = Object.fromEntries(files.map((f) => [f.path, f.content]));
  assert.ok(t["categories.csv"].includes("createurs") && t["team.csv"].includes("Trésorier") && t["profiles.csv"].includes("Namur"));
  assert.ok(t["profiles.csv"].includes("\"'=SOMME(A1)\""));
  assert.ok(!Object.values(t).join("").includes("P 001"), "aucun nom");
});

/* ───────────── Mise à jour à chaud, langues ───────────── */

const copy = (from, to) => { fs.rmSync(to, { recursive: true, force: true }); fs.cpSync(from, to, { recursive: true }); };
const load = (dir, v) => import(`${pathToFileURL(path.join(dir, "index.mjs")).href}?v=${v}`);

test("mise à jour dans un site qui tourne : le cœur importe index.mjs?v=…, tous les fichiers voisins prennent la même version (aucun ancien code gardé en mémoire)", async () => {
  const dir = makeTempDir("directory-update-");
  try {
    copy(path.join(here, "../modules/directory"), dir);
    assert.equal(typeof (await load(dir, "ancien")).default.page, "function");
    // La nouvelle version change un fichier voisin ; le cœur remplace les fichiers puis importe avec la nouvelle version.
    const p = path.join(dir, "templates.mjs");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("empty: { vocab: {}, cats: [] },", "empty: { vocab: {}, cats: [] },\n  nouveau: { vocab: {}, cats: [] },"));
    await load(dir, "nouveau");
    const T = await import(`${pathToFileURL(path.join(dir, "templates.mjs")).href}?v=nouveau`);
    assert.ok(T.TEMPLATE_IDS.includes("nouveau"));
    const admin = await import(`${pathToFileURL(path.join(dir, "admin.mjs")).href}?v=nouveau`);
    const r = await admin.actions.template.run(makeWorld({ book: fakeContactBook() }).ctx, { template: "nouveau" });
    assert.ok(!r.errors, "le fichier admin.mjs de la NOUVELLE version utilise le templates.mjs de la nouvelle version");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("aucun fichier du module n'importe un voisin sans la version du fichier principal", () => {
  const dir = path.join(here, "../modules/directory");
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".mjs"))) {
    const code = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!/^\s*(import|export)\b[^\n]*\bfrom\s+["']\.\.?\//m.test(code), `${f} : import statique d'un fichier voisin (sans ?v=)`);
    for (const m of code.matchAll(/import\(\s*([`"'])(\.[^`"']*)\1\s*\)/g)) if (!m[2].includes("${v}")) assert.fail(`${f} : import dynamique d'un voisin sans version : ${m[2]}`);
  }
});

test("langues : mêmes clés en français et en anglais, aucune phrase vide, mêmes variables", () => {
  const dir = path.join(here, "../modules/directory/locales");
  const fr = JSON.parse(fs.readFileSync(path.join(dir, "fr.json"), "utf8")), en = JSON.parse(fs.readFileSync(path.join(dir, "en.json"), "utf8"));
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of Object.keys(fr)) { assert.ok(fr[k].trim() && en[k].trim(), k); assert.equal(vars(fr[k]), vars(en[k]), `${k} : mêmes variables dans les deux langues`); }
});

test("anglais : la page publique et le panneau s'affichent dans la langue du visiteur", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Members");
  people(book, cat, 2, { prefix: "P" });
  const { ctx } = makeWorld({ book, locale: "en" });
  await publish(ctx, [{ id: cat, label: "Members" }]);
  const html = htmlOf(await page(ctx));
  assert.ok(html.includes("2 people") && html.includes("Search") && html.includes("Newest"));
  assert.equal((await page(ctx)).title, "Directory");
  assert.ok(JSON.stringify(await def.adminPanel(ctx, { query: {} })).includes("Public categories"));
});
