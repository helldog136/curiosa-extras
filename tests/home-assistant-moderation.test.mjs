// Home Assistant : la modération du texte lu à voix haute (fonctions pures), y compris un passage au hasard borné.
import test from "node:test";
import assert from "node:assert/strict";
import { moderate, buildMatcher, clean, cleanName, hasNumber, fold, parseWordList, MAX_CHARS, EMOJI_MAX } from "../modules/home-assistant/moderation.mjs";
import { DEFAULT_WORDS } from "../modules/home-assistant/words.mjs";

const base = { maxChars: 140, blockNumbers: true, matcher: buildMatcher(), viewer: "Lea", prefixViewer: false };
const ok = (text, o = {}) => moderate(text, { ...base, ...o });

test("un texte normal passe tel quel, avec le pseudo devant si demandé", () => {
  assert.deepEqual(ok("Bonjour tout le monde !").text, "Bonjour tout le monde !");
  const r = ok("Coucou", { prefixViewer: true, prefixOf: (n) => `${n} dit : `, anonymous: "Quelqu'un" });
  assert.equal(r.text, "Lea dit : Coucou");
  assert.equal(ok("Coucou", { viewer: "", prefixViewer: true, prefixOf: (n) => `${n} dit : `, anonymous: "Quelqu'un" }).text, "Quelqu'un dit : Coucou");
});

test("nettoyage NFKC : lettres pleine chasse, ligatures et exposants sont ramenés à des lettres normales", () => {
  assert.equal(clean("ｂｏｎｊｏｕｒ").text, "bonjour");
  assert.equal(clean("ﬁn").text, "fin");
  assert.equal(ok("ｆｕｃｋ").code, "word");
  assert.equal(ok("𝐟𝐮𝐜𝐤").code, "word");
});

test("caractères de contrôle et invisibles retirés", () => {
  assert.equal(clean("a\u0000b\u0007c​d\u202ee").text, "abcde");
  assert.equal(clean("ligne1\nligne2\ttab").text, "ligne1 ligne2 tab");
  assert.equal(ok("hi​t​ler").code, "word");
});

test("URL, adresses et e-mails retirés", () => {
  for (const s of ["va sur https://evil.com/x ok", "va sur http://1.2.3.4/x ok", "va sur www.evil.com ok", "va sur evil.com/chemin ok", "va sur evil.com ok", "ecris a moi@evil.com ok", "va sur evil [dot] com ok", "va sur javascript:alert(1) ok", "va sur data:text/html;base64,AAAA ok"]) {
    const r = ok(s);
    assert.equal(r.ok, true, s);
    assert.ok(!/evil|alert|base64|@|:\/\//.test(r.text), `${s} -> ${r.text}`);
  }
  assert.equal(ok("https://evil.com").code, "empty");
});

test("mentions retirées", () => {
  assert.equal(ok("salut @pierre ca va").text, "salut ca va");
  assert.equal(ok("salut ＠pierre ca va").text, "salut ca va");
  assert.ok(!ok("a @@@ b @ c").text.includes("@"));
});

test("balisage SSML, HTML et Markdown retiré", () => {
  assert.equal(ok("<speak>coucou<break time='5s'/></speak>").text, "coucou");
  assert.equal(ok("<prosody rate='x-slow'>lent</prosody> &amp; &#x41; fin").text, "lent fin");
  assert.equal(ok("<<speak>>vite<</speak>>").text, "vite");
  assert.equal(ok("**gras** et _italique_ et `code` [lien](http://x.example) ![img](http://y.example)").text, "gras et italique et code lien img");
  for (const bad of ["<", ">", "{", "}"]) assert.ok(!clean(`a${bad}b`).text.includes(bad));
});

test("leet, accents, majuscules, lettres espacées ou répétées ne trompent pas la liste", () => {
  for (const s of ["m3rde", "MERDE", "mérde", "m e r d e", "m.e.r.d.e", "merrrrde", "FUUUCK", "sh1t", "5hit", "b!tch", "Cunt", "ｎａｚｉ", "nаzi", "ta gueule", "TA  GUEULE", "kill yourself", "k y s"]) {
    const r = ok(s);
    assert.equal(r.code, "word", `${s} devrait être refusé`);
  }
});

test("pas de faux positifs sur des mots courants", () => {
  for (const s of ["violette", "violon", "En retard", "classe", "assez", "scunthorpe", "bonjour", "Il est en retard de 5 min", "assistance", "cumulus", "analyse", "bite of pizza", "Dickens", "grass", "passer"]) assert.equal(ok(s).ok, true, s);
});

test("liste : mots en plus, mots toujours acceptés, liste fournie désactivée", () => {
  const extra = buildMatcher({ extra: "spoiler\nfin du*" });
  assert.equal(moderate("pas de spoiler svp", { ...base, matcher: extra }).code, "word");
  assert.equal(moderate("la fin du jeu", { ...base, matcher: extra }).code, "word");
  const allowed = buildMatcher({ allowed: "con\nmerdique" });
  assert.equal(moderate("c'est con", { ...base, matcher: allowed }).ok, true);
  assert.equal(moderate("c'est merdique", { ...base, matcher: allowed }).ok, true);
  assert.equal(moderate("c'est de la merde", { ...base, matcher: allowed }).code, "word");
  assert.equal(moderate("merde", { ...base, matcher: buildMatcher({ useDefaults: false }) }).ok, true);
  assert.equal(buildMatcher({ useDefaults: false }).size, 0);
  assert.ok(buildMatcher().size > 100);
});

test("la liste est lisible : virgules, lignes, jokers, bornes", () => {
  const list = parseWordList("un, deux\n*trois*;quatre*\n  \n" + "x".repeat(200) + "\n" + Array.from({ length: 700 }, (_, i) => `mot${i}`).join("\n"));
  assert.equal(list.length, 500);
  assert.equal(list[2].start && list[2].end, true);
  assert.ok(DEFAULT_WORDS.length > 100 && new Set(DEFAULT_WORDS).size === DEFAULT_WORDS.length);
});

test("répétitions : plus de 4 caractères identiques, plus de 3 mots identiques", () => {
  assert.equal(ok("aaaaaaaaaaaa wow").text, "aaa wow");
  assert.equal(ok("aaaa wow").text, "aaaa wow");
  assert.equal(ok("!!!!!!!!!!").code, "empty");
  assert.equal(ok("spam spam spam spam spam").text, "spam spam");
  assert.equal(ok("oui oui oui").text, "oui oui oui");
});

test("emojis : trois au plus", () => {
  const r = ok("😀😀😀😀😀😀 oui 🎉🎉");
  assert.equal([...r.text.matchAll(/\p{Extended_Pictographic}/gu)].length, EMOJI_MAX);
  assert.equal(ok("👨‍👩‍👧 famille").text, "👨‍👩‍👧 famille");
});

test("longueur : refus au-delà du maximum (réglable de 20 à 300), après nettoyage", () => {
  assert.equal(ok("a".repeat(140).replace(/a/g, "ab")).code, "too_long");
  assert.equal(ok("abcd efgh ".repeat(13).trim(), { maxChars: 140 }).ok, true);
  assert.equal(ok("abcd efgh ".repeat(15).trim(), { maxChars: 140 }).code, "too_long");
  assert.equal(ok("abcdefghij ".repeat(3), { maxChars: 5 }).code, "too_long", "5 est ramené à 20");
  assert.equal(ok("abcd efgh ".repeat(31).trim(), { maxChars: 1000 }).code, "too_long", "1000 est ramené à 300");
  assert.equal(MAX_CHARS.max, 300);
  assert.equal(ok("court " + "https://x.example/" + "a".repeat(500)).ok, true, "un lien retiré ne compte pas");
});

test("numéros : suites de chiffres, séparateurs, chiffres dits en lettres", () => {
  for (const s of ["appelle le 0612345678", "0 6 12 34 56 78", "06.12.34.56.78", "+33 6 12 34 56 78", "06-12-34-56-78", "un deux trois quatre cinq six", "one two three four five six", "ma carte 4970 1234 5678"]) assert.equal(ok(s).code, "number", s);
  for (const s of ["j'ai 12 ans et 3 chats", "episode 2024", "rendez vous a 18h30", "un deux trois"]) assert.equal(ok(s).ok, true, s);
  assert.equal(ok("0612345678", { blockNumbers: false }).ok, true);
  assert.equal(hasNumber("2024-10-14"), true);
});

test("pseudo : nettoyé, 25 caractères, remplacé s'il est lui-même refusé", () => {
  assert.equal(cleanName("@Léa https://x.com <b>Dupont</b> Jr"), "Dupont Jr");
  assert.ok([...cleanName("a".repeat(100))].length <= 25);
  const r = moderate("salut", { ...base, viewer: "nazi_boy", prefixViewer: true, prefixOf: (n) => `${n}: `, anonymous: "Quelqu'un" });
  assert.equal(r.text, "Quelqu'un: salut");
  assert.equal(r.viewer, "");
});

test("tout est refusé ou nettoyé proprement : vide, symboles, valeurs inattendues", () => {
  for (const v of [undefined, null, 42, {}, [], "", "   ", "!!!", "😀", "…"]) {
    const r = ok(v);
    assert.equal(typeof r.ok, "boolean");
    if (!r.ok) assert.ok(["empty", "word", "number", "too_long"].includes(r.code));
  }
});

test("passage au hasard : jamais d'erreur, jamais de balise ni de lien, toujours rapide", () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pieces = ["<speak>", "</speak>", "<", ">", "&amp;", "http://x.example/", "www.a.fr", "@bob", "**", "_", "​", "\u202e", "\u0000", "😀", "👨‍👩‍👧", "０６１２", "m3rde", "f u c k", "aaaaaaa", " ", "\n", "é", "ß", "ﷺ", "ǅ", "a".repeat(50), "[x](y)", "{{x}}", "javascript:", "09 12 34", "ｆｕｃｋ", "\uD800"];
  const started = Date.now();
  for (let i = 0; i < 4000; i++) {
    const n = 1 + Math.floor(rnd() * 25);
    let s = "";
    for (let j = 0; j < n; j++) s += pieces[Math.floor(rnd() * pieces.length)];
    const r = moderate(s, { ...base, viewer: s.slice(0, 30), prefixViewer: true, prefixOf: (x) => `${x} dit : `, anonymous: "Quelqu'un" });
    assert.equal(typeof r.ok, "boolean");
    if (r.ok) {
      const body = r.text.replace(/^.* dit : /su, "");
      assert.ok(!/[<>]|:\/\/|@|[\u0000-\u0008​\u202e]/u.test(body), JSON.stringify([s, r.text]));
      assert.ok([...r.text].length <= MAX_CHARS.max + 40);
    }
  }
  assert.ok(Date.now() - started < 8000, "le passage au hasard doit rester rapide");
});

test("très gros texte : coupé à 2 000 caractères avant tout travail, et rapide", () => {
  const t0 = Date.now();
  const r = moderate("ﷺ".repeat(100_000), base);
  assert.equal(r.ok, false);
  assert.ok(Date.now() - t0 < 1500);
  const big = clean("a-".repeat(50_000) + "b.".repeat(50_000));
  assert.ok([...big.text].length <= 4000);
  assert.ok(fold("é".repeat(10)).length === 10);
});
