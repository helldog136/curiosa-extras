// Contacts (lot K2) — le format CSV : lecture au fil de l'eau, titres en français ET en anglais, comptes écrits de plusieurs façons, notes, protection des
// formules de tableur, et les phrases des lignes en erreur (la raison + un exemple, dans les deux langues).
import test from "node:test";
import assert from "node:assert/strict";
import { C, readJson } from "./helpers/contactsK2.mjs";
import { describeError, ERROR_CODES } from "../modules/contacts/messages.mjs";

const rows = (text, d) => [...C.parseCsv(text, d)];

test("lecture : guillemets, guillemets doublés, retours à la ligne dans une cellule, CRLF, BOM, lignes vides sautées, numéro de ligne comme dans un tableur", () => {
  const got = rows('﻿a,b\r\n"x,1","dit ""oui"""\r\n\r\n"deux\nlignes",fin\n');
  assert.deepEqual(got.map((r) => r.cells), [["a", "b"], ["x,1", 'dit "oui"'], ["deux\nlignes", "fin"]]);
  assert.deepEqual(got.map((r) => r.record), [1, 2, 4], "la ligne vide compte dans la numérotation");
  assert.deepEqual(rows("a;b;c\n1;;3", ";")[1].cells, ["1", "", "3"]);
  assert.deepEqual(rows("a\tb\n1\t2", "\t")[1].cells, ["1", "2"]);
  assert.deepEqual(rows("a,b\n1,")[1].cells, ["1", ""], "dernière cellule vide");
});

test("lecture : un guillemet jamais refermé donne une erreur avec le numéro de la ligne (pas un fichier avalé en silence)", () => {
  assert.throws(() => rows('a,b\n1,"oups\n2,3\n'), (e) => e instanceof C.CsvError && e.code === "quote" && e.record === 2);
});

test("lecture : c'est un générateur — on peut s'arrêter après la première ligne sans avoir lu le reste", () => {
  const big = `a,b\n${"x,y\n".repeat(500_000)}`;
  const it = C.parseCsv(big, ",");
  assert.deepEqual(it.next().value.cells, ["a", "b"]);
  assert.equal(it.next().value.record, 2);
  assert.equal(typeof it[Symbol.iterator], "function");
});

test("séparateur : détecté sur la première ligne (point-virgule d'un tableur français, virgule, tabulation), pas dans les guillemets", () => {
  assert.equal(C.detectDelimiter("nom;comptes;note\nx"), ";");
  assert.equal(C.detectDelimiter("name,accounts\nx"), ",");
  assert.equal(C.detectDelimiter("name\taccounts\nx"), "\t");
  assert.equal(C.detectDelimiter('"a;b";c,d,e\n'), ",");
  assert.equal(C.detectDelimiter("seule colonne\nx"), ",");
});

test("titres : français, anglais, synonymes, accents et majuscules ignorés ; une colonne inconnue est ignorée (jamais une erreur)", () => {
  const fr = C.readHeader(["Nom", "Type", "Fonction", "Organisation", "E-mail", "Téléphone", "Comptes", "Catégories", "Notes", "Statut", "Relation", "Autres canaux", "Photo", "Origine", "Id"]);
  const en = C.readHeader(["name", "type", "role", "organisation", "email", "phone", "accounts", "categories", "notes", "status", "relation", "others", "photo", "source", "id"]);
  assert.deepEqual(Object.keys(fr.map).sort(), C.COLUMNS.map((c) => c.key).sort());
  assert.deepEqual(fr.map, en.map);
  const odd = C.readHeader(["COURRIEL", "tel", "Entreprise", "Réseaux", "Commentaire", "Couleur préférée", ""]);
  assert.deepEqual(odd.map, { email: 0, phone: 1, organisation: 2, accounts: 3, note: 4 });
  assert.deepEqual(odd.unknown, ["Couleur préférée"]);
  assert.deepEqual(C.headerLabels("fr"), C.COLUMNS.map((c) => c.fr));
  assert.deepEqual(C.headerLabels("en"), C.COLUMNS.map((c) => c.en));
});

test("comptes : « réseau:pseudo », lien collé, alias de réseau, pseudo sans réseau refusé avec la valeur fautive", () => {
  const ok = (t) => { const a = C.parseAccountToken(t); return a && !a.error ? `${a.network}:${a.handle}` : a; };
  assert.equal(ok("twitch:Marie_Live"), "twitch:marie_live");
  assert.equal(ok("https://www.twitch.tv/Marie_Live/videos"), "twitch:marie_live");
  assert.equal(ok("youtube:@Marie"), "youtube:@marie");
  assert.equal(ok("twitter:abc"), "x:abc");
  assert.equal(ok("bsky:marie"), "bluesky:marie.bsky.social");
  assert.equal(ok("@marie@social.example"), "mastodon:marie@social.example");
  assert.equal(ok("monsite.be/page"), "web:monsite.be/page");
  assert.equal(ok("web:https://www.monsite.be/"), "web:monsite.be");
  assert.deepEqual(C.parseAccountToken("@marie"), { error: "network", value: "@marie" });
  assert.deepEqual(C.parseAccountToken("twitch:a b"), { error: "handle", value: "twitch:a b", network: "twitch" });
  assert.equal(C.parseAccountToken("   "), null);
  assert.equal(ok("other:un | texte"), "other:un | texte", "un « | » dans un pseudo passe par l'écriture %7C de l'export");
});

test("ligne : tous les champs lus, valeurs par défaut, premier problème trouvé avec la valeur fautive", () => {
  const { map } = C.readHeader(["nom", "type", "organisation", "e-mail", "comptes", "catégories", "notes", "statut", "photo"]);
  const good = C.rowInput(map, ["Marie Exemple", "personne", "Studio", "MARIE@Example.test", "twitch:marie_live | youtube:@marie", "Amis | Raid", "2026-01-02 · moi\nBonjour", "à vérifier", "https://img.example.test/m.jpg"]);
  assert.equal(good.ok, true);
  assert.deepEqual([good.input.kind, good.input.name, good.input.organisation, good.input.email, good.input.status, good.input.categories], ["person", "Marie Exemple", "Studio", "marie@example.test", "to_review", ["Amis", "Raid"]]);
  assert.deepEqual(good.input.accounts.map((a) => `${a.network}:${a.handle}`), ["twitch:marie_live", "youtube:@marie"]);
  assert.deepEqual(good.input.notes, [{ date: "2026-01-02", author: "moi", text: "Bonjour" }]);
  const bare = C.rowInput(map, ["", "", "", "", "twitch:seul_pseudo", "", "", "", ""]);
  assert.equal(bare.input.name, "seul_pseudo", "sans nom, le pseudo du premier compte sert de nom");
  const err = (cells) => C.rowInput(map, cells).error;
  assert.deepEqual(err(["", "", "", "", "", "", "", "", ""]), { code: "name" });
  assert.deepEqual(err(["A", "robot", "", "", "", "", "", "", ""]), { code: "kind", value: "robot" });
  assert.deepEqual(err(["A", "", "", "oups@", "", "", "", "", ""]), { code: "email", value: "oups@" });
  assert.deepEqual(err(["A", "", "", "", "@marie", "", "", "", ""]), { code: "account_network", value: "@marie" });
  assert.deepEqual(err(["A", "", "", "", "twitch:a", "", "", "", ""]), { code: "account_handle", value: "twitch:a", network: "twitch" });
  assert.deepEqual(err(["A", "", "", "", "", "", "", "peut-être", ""]), { code: "status", value: "peut-être" });
  assert.deepEqual(err(["A", "", "", "", "", "", "", "", "javascript:alert(1)"]), { code: "photo", value: "javascript:alert(1)" });
  assert.equal(err(["A", "", "", "", Array.from({ length: 21 }, (_, i) => `twitch:user_${1000 + i}`).join(" | "), "", "", "", ""]).code, "too_many_accounts");
  assert.equal(err(["A", "", "", "", "", Array.from({ length: 51 }, (_, i) => `Cat ${i}`).join(" | "), "", "", ""]).code, "too_many_categories");
  assert.equal(C.rowInput(map, ["A", "", "", "", "", "", "", "", "", "texte en trop"], 9).error.code, "columns", "un séparateur oublié dans un texte non mis entre guillemets");
  assert.equal(C.rowInput(map, ["A", "", "", "", "", "", "", "", "", ""], 9).ok, true, "des cellules vides en trop ne gênent pas");
});

test("notes : plusieurs notes datées dans une cellule, une ligne « --- » dans un texte est protégée, aller-retour exact", () => {
  const notes = [{ date: "2026-02-01", author: "admin", text: "Premier contact.\n---\nsuite" }, { date: "2026-02-03", author: "module x", text: "\\--- reste tel quel\n\\autre" }, { date: "2026-02-04", author: "moi", text: "Simple." }];
  assert.deepEqual(C.parseNotes(C.formatNotes(notes)), notes);
  assert.deepEqual(C.parseNotes("Une note sans date"), [{ text: "Une note sans date" }]);
  assert.deepEqual(C.parseNotes("a\n---\nb").map((n) => n.text), ["a", "b"]);
  assert.deepEqual(C.parseNotes("  \n "), []);
});

test("tableur : une valeur qui commence par = + - @ reçoit une apostrophe (sauf un numéro de téléphone) et la retrouve à l'import ; guillemets seulement si besoin", () => {
  assert.equal(C.cell("=1+1"), "'=1+1");
  assert.equal(C.cell("@nom"), "'@nom");
  assert.equal(C.cell("-5"), "'-5");
  assert.equal(C.cell("+32 470 12 34 56"), "+32 470 12 34 56", "un numéro de téléphone reste lisible");
  assert.equal(C.cell("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0", "une vraie formule reste protégée");
  assert.equal(C.cell("a,b"), '"a,b"');
  assert.equal(C.cell("a;b", ";"), '"a;b"');
  assert.equal(C.cell('dit "oui"'), '"dit ""oui"""');
  assert.equal(C.cell("simple"), "simple");
  assert.equal(C.unguard("'=1+1"), "=1+1");
  assert.equal(C.unguard("'bonjour"), "'bonjour", "une apostrophe ordinaire est laissée");
  assert.equal(C.cell("'Allo"), "''Allo", "une valeur qui commence par une apostrophe est protégée aussi : l'aller-retour est exact");
  for (const v of ["'Allo", "=x", "+cmd", "-1", "@a", "'+32 470 123456", "plain", " lead", "a\"b"]) assert.equal(C.unguard(C.cell(v).replace(/^"(.*)"$/s, "$1").replace(/""/g, '"')), v, v);
  assert.equal(C.exportDelimiter("fr"), ";");
  assert.equal(C.exportDelimiter("en-US"), ",");
});

test("phrases : chaque raison d'erreur de ligne existe en français et en anglais, donne le numéro de ligne, la valeur fautive et dit quoi faire (avec un exemple)", () => {
  const fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
  for (const [locale, messages] of [["fr", fr], ["en", en]]) {
    const ctx = { t: (k, vars = {}) => (messages[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => vars[n] ?? `{${n}}`) };
    for (const code of ERROR_CODES) {
      const text = describeError(ctx, { line: 42, code, value: "VALEUR", network: "twitch", a: "Alice", b: "Bruno", width: "9" });
      assert.match(text, /42/, `${locale} ${code} : numéro de ligne`);
      assert.doesNotMatch(text, /\{\w+\}|impE_/, `${locale} ${code} : variable ou clé non remplacée`);
      if (!["vanished", "too_many"].includes(code)) assert.match(text, locale === "fr" ? /(exemple|Exemple|comme|Écrivez|Créez|Réunissez|Retirez|Corrigez|Gardez|Raccourcissez|Réutilisez)/ : /(xample|like|Write|Create|merge|Remove|Fix|Keep|Shorten|Reuse|First)/, `${locale} ${code} : dit quoi faire`);
    }
    assert.match(describeError(ctx, { line: 3, code: "nouveau-code-inconnu" }), /3/, `${locale} : un code inconnu reste lisible`);
    assert.match(describeError(ctx, { line: 5, code: "account_handle", network: "youtube", value: "x" }), /YouTube|youtube/, `${locale} : l'aide du réseau est reprise`);
  }
  // Les erreurs sous le champ du formulaire d'import donnent aussi un exemple.
  for (const [locale, messages] of [["fr", fr], ["en", en]]) {
    for (const k of ["impErrEmpty", "impErrHeader", "impErrQuote", "impErrTooMany", "impErrNoRows", "impErrBusy"]) assert.match(messages[k], locale === "fr" ? /(Exemple|exemple|ou |Ajoutez|Coupez|Terminez)/ : /(xample|or |Add|Split|Finish)/, `${locale} ${k}`);
  }
});
