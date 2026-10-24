// Mascotte — les règles pures : phrases (140 caractères, variables), pages, liens, images, bornes.
import test from "node:test";
import assert from "node:assert/strict";
import { model as M, starters, manifest, messages } from "./helpers/mascotKit.mjs";

test("une phrase : 140 caractères au plus, comptés en vrais caractères (pas en octets)", () => {
  assert.ok(M.checkPhrase({ text: "a".repeat(140) }).value);
  assert.equal(M.checkPhrase({ text: "a".repeat(141) }).errors.text[0], "errTextLong");
  assert.ok(M.checkPhrase({ text: "é".repeat(140) }).value);
  assert.ok(M.checkPhrase({ text: "😀".repeat(140) }).value);
  assert.equal(M.checkPhrase({ text: "   " }).errors.text[0], "errTextEmpty");
});

test("une phrase refuse une variable inconnue et une accolade isolée, avec un message qui dit quoi faire", () => {
  const e = M.checkPhrase({ text: "Salut {prenom}" }, { locale: "fr" }).errors.text;
  assert.equal(e[0], "errVariable");
  assert.match(e[1].list, /\{nom_du_site\}/);
  assert.match(M.checkPhrase({ text: "Salut {prenom}" }, { locale: "en" }).errors.text[1].list, /\{site_name\}/);
  assert.equal(M.checkPhrase({ text: "Salut { toi" }).errors.text[0], "errBraces");
  assert.ok(M.checkPhrase({ text: "Salut {nom} et {name} et {next_event}" }).value);
});

test("les variables : une variable sans valeur rend la phrase impossible (null), jamais un trou", () => {
  assert.equal(M.fillText("Bonjour {nom}", { name: "Pixel" }), "Bonjour Pixel");
  assert.equal(M.fillText("Prochain : {prochain_evenement}", { name: "x" }), null);
  assert.equal(M.fillText("Prochain : {next_event}", { event: "" }), null);
  assert.equal(M.fillText("Sans variable", {}), "Sans variable");
  assert.equal(M.fillText("{nom_du_site} / {site_name}", { site: "Demo" }), "Demo / Demo");
});

test("un texte venu d'ailleurs perd ses accolades (il ne peut pas forger une variable ni un repère de date)", () => {
  assert.equal(M.outside("Fête {{t:2026-01-01T00:00:00Z}} {nom}", 80), "Fête t:2026-01-01T00:00:00Z nom");
  assert.ok(!/[{}]/.test(M.outside("{{x}}{", 80)));
  assert.equal(M.outside("a\u0000b\nc", 10), "a b c");
});

test("les pages : /page exacte, /blog/* (le blog et dessous), /jeu* (préfixe) ; adresses invalides refusées", () => {
  assert.deepEqual(M.parsePages("/Agenda\n/blog/*, /jeu*;/agenda/").list, ["/agenda", "/blog/*", "/jeu*"]);
  assert.deepEqual(M.parsePages("agenda").bad, ["agenda"]);
  assert.deepEqual(M.parsePages("/a*b").bad, ["/a*b"]);
  assert.deepEqual(M.parsePages("/a//b").bad, ["/a//b"]);
  assert.equal(M.parsePages(Array.from({ length: 25 }, (_, i) => `/p${i}`).join("\n")).tooMany, true);
  assert.equal(M.checkPhrase({ text: "ok", pages: "agenda" }).errors.pages[0], "errPages");
  const ok = (list, p) => M.pathMatches(list, p);
  assert.ok(ok(["/blog/*"], "/blog") && ok(["/blog/*"], "/blog/un-article") && !ok(["/blog/*"], "/blogue"));
  assert.ok(ok(["/jeu*"], "/jeu") && ok(["/jeu*"], "/jeux/du-jour") && !ok(["/jeu*"], "/le-jeu"));
  assert.ok(ok(["/"], "/") && !ok(["/"], "/a"));
  assert.ok(!ok([], "/"));
});

test("où elle apparaît : tout, l'accueil seulement, ou certaines pages", () => {
  assert.equal(M.placeAllows("all", [], "/n-importe"), true);
  assert.equal(M.placeAllows("home", [], "/"), true);
  assert.equal(M.placeAllows("home", [], "/faq"), false);
  assert.equal(M.placeAllows("some", ["/faq"], "/faq"), true);
  assert.equal(M.placeAllows("some", ["/faq"], "/"), false);
  assert.equal(M.placeAllows("some", [], "/"), false);
});

test("l'adresse reçue du navigateur devient un chemin propre, jamais une adresse complète", () => {
  assert.equal(M.cleanPath("/Blog/?a=1#x"), "/blog");
  assert.equal(M.cleanPath("//evil.example/x"), "/");
  assert.equal(M.cleanPath("https://evil.example/x"), "/");
  assert.equal(M.cleanPath(undefined), "/");
  assert.equal(M.cleanPath("/a<b>/c\"d"), "/ab/cd");
  assert.ok(M.cleanPath("/" + "a".repeat(500)).length <= 200);
});

test("liens et images : https ou chemin du site ; javascript:, data:, // et http refusés", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "http://example.org", "ftp://x", "https://u:p@example.org/", "/a b", "https://example.org/\"x"]) assert.equal(M.safeLink(bad), "", bad);
  assert.equal(M.safeLink("/agenda"), "/agenda");
  assert.equal(M.safeLink("https://www.example.org/x"), "https://www.example.org/x");
  const up = "/uploads/123e4567-e89b-12d3-a456-426614174000.png?c=1.0_1_0.5_0.5_ffffff";
  assert.equal(M.safeImage(up), up);
  assert.equal(M.safeImage("/uploads/../etc/passwd"), "");
  assert.equal(M.safeImage("javascript:alert(1)"), "");
  assert.equal(M.safeImage("http://example.org/a.png"), "");
  assert.equal(M.safeImage("https://example.org/a.png"), "https://example.org/a.png");
});

test("les réglages à valeur bornée sont ramenés dans leur plage", () => {
  assert.equal(M.num(0, M.RANGES.delay), 3);
  assert.equal(M.num(9999, M.RANGES.delay), 60);
  assert.equal(M.num("abc", M.RANGES.max), 3);
  assert.equal(M.num(null, M.RANGES.show), 8);
  assert.equal(M.num("5", M.RANGES.max), 5);
  assert.equal(M.num(99, M.RANGES.max), 10);
});

test("la cellule de tableur neutralise les formules et double les guillemets", () => {
  assert.equal(M.cell("=1+1"), "\"'=1+1\"");
  assert.equal(M.cell('a"b'), '"a""b"');
});

test("gabarits : « Bienvenue discrète » (tout est valide) et « Vide »", () => {
  const set = starters.templatePhrases("welcome", ["fr", "en"], "fr");
  assert.ok(set.length >= 10 && set.length <= 100);
  for (const p of set) assert.ok(M.checkPhrase({ ...p, pages: "" }, { locales: ["fr", "en"] }).value, p.text);
  assert.deepEqual(new Set(set.map((p) => p.lang)), new Set(["fr", "en"]));
  assert.ok(set.some((p) => p.kind === "hello") && set.some((p) => p.kind === "tip") && set.some((p) => p.kind === "news"));
  assert.ok(set.some((p) => p.state === "draft"));
  assert.deepEqual(starters.templatePhrases("empty", ["fr"], "fr"), []);
  assert.deepEqual(starters.templatePhrases("inconnu", ["fr"], "fr"), []);
  assert.deepEqual(new Set(starters.templatePhrases("welcome", ["fr"], "fr").map((p) => p.lang)), new Set(["fr"]));
  assert.deepEqual(new Set(starters.templatePhrases("welcome", ["nl"], "nl").map((p) => p.lang)), new Set(["nl"]));
});

test("neutralité : aucun nom de site, région ou vocabulaire d'association dans les phrases de départ, textes et manifeste", () => {
  const all = JSON.stringify([starters.templatePhrases("welcome", ["fr", "en"], "fr"), messages("fr"), messages("en"), manifest]);
  for (const word of ["asbl", "belgique", "belgium", "association", "emma", "rosalia"]) assert.ok(!all.toLowerCase().includes(word), word);
});

test("manifeste et langues : parité exacte, version du script = version du module, instance unique, liens facultatifs", async () => {
  assert.deepEqual(Object.keys(messages("fr")).sort(), Object.keys(messages("en")).sort());
  const { VERSION } = await import("../modules/mascot/assets.mjs");
  assert.equal(VERSION, manifest.version);
  assert.equal(manifest.instances, "single");
  assert.ok(manifest.requires.every((r) => r.optional === true));
});
