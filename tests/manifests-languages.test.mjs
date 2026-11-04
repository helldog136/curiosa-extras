// LANGUES DES MANIFESTES ET DE L'INDEX : tout texte que la personne lit (nom, description, libellés, aides, exemples, légendes…) existe en français ET en anglais, dans la bonne langue.
// Cause d'origine d'un défaut vu dans l'assistant d'installation en anglais : l'index du Catalogue ne gardait que la chaîne française de chaque module (`pick` préférait « fr »),
// et le cœur l'affichait telle quelle. L'index porte maintenant un texte par langue (`names`, `descriptions`) en plus des chaînes simples (cœurs plus anciens).
// Ce test lit les fichiers du dépôt seulement (aucun code du cœur : le dépôt est testé contre un cœur publié).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const GROUPS = ["modules", "examples"];
const manifests = GROUPS.flatMap((g) => fs.readdirSync(path.join(root, g)).sort().filter((id) => fs.existsSync(path.join(root, g, id, "module.json"))).map((id) => ({ dir: `${g}/${id}`, m: read(`${g}/${id}/module.json`) })));
const index = read("catalogue/index.json");

// Mots-sentinelles : des mots entiers, en minuscules, qui n'existent que dans une des deux langues. Un nom de lieu (« Nouméa », « Réunion »), de marque ou d'adresse n'en contient pas.
const FR = /(?<![\p{L}\p{N}_/.-])(vous|votre|vos|une|des|les|pour|avec|sans|dans|sont|cette|ajoutez|chaque|aussi|nous|leurs|libres|affiche|afficher|activez|choisissez)(?![\p{L}\p{N}_/-])/u;
const EN = /(?<![\p{L}\p{N}_/.-])(the|your|you|with|and|are|this|will|that|from|when|for)(?![\p{L}\p{N}_/-])/u;
// Ce qui est entre guillemets est cité tel quel (la mention « Made with Curiosa », un titre de page, un exemple) : il n'est jamais dans la langue de la phrase.
const unquoted = (text) => text.replace(/«[^»]*»|“[^”]*”|"[^"]*"/g, " ");
const LOCALE_KEY = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/** Les textes par langue d'un manifeste : tout objet dont les clés sont des codes de langue (dont fr ou en) et dont les valeurs sont du texte. */
function localizedTexts(value, where = "", out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => localizedTexts(v, `${where}[${i}]`, out));
  else if (value && typeof value === "object") {
    const keys = Object.keys(value);
    const isTexts = keys.length > 0 && keys.every((k) => LOCALE_KEY.test(k) && typeof value[k] === "string") && (keys.includes("fr") || keys.includes("en"));
    if (isTexts) out.push({ where, texts: value });
    else for (const [k, v] of Object.entries(value)) localizedTexts(v, `${where}.${k}`, out);
  }
  return out;
}

/** Texte simple là où un texte par langue est attendu : seulement les cas ci-dessous, chacun avec sa raison. Toute autre chaîne simple dans un champ de texte fait échouer le test. */
const TEXT_KEYS = new Set(["label", "help", "description", "title", "name", "placeholder", "example", "summary", "alt", "caption", "reason", "privacy", "unit", "hint", "tagline", "body", "empty", "intro"]);
const PLAIN_ALLOWED = [
  { re: /\.social\.name$/, why: "nom de marque d'un réseau (Twitch, Mastodon…) : le même dans toutes les langues" },
  { re: /^\.overlayElements\[\d+\]\.options\[\d+\]\.example$/, why: "exemple d'option d'overlay : le cœur n'accepte qu'un texte simple (60 caractères) ; un repère court, pas une phrase" },
  { re: /^\.content\.fieldSchema\[\d+\]\.label$/, why: "le cœur n'accepte qu'un texte simple pour le libellé d'un champ personnalisé (voir le rapport de la PR)" },
  { re: /^\.shortLink\.name$/, why: "nom du réglage (clé), pas un texte visible" },
  { re: /^\.settings\[\d+\]\.example$/, why: "exemple d'adresse ou de pseudo, identique dans toutes les langues", only: ["examples/announcement-banner", "modules/twitch-bot"] },
];
function plainTexts(value, where = "", out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => plainTexts(v, `${where}[${i}]`, out));
  else if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.includes("fr") || keys.includes("en")) return out;
    for (const [k, v] of Object.entries(value)) {
      if (k === "mcp") continue;                              // actions pour les assistants (texte pour une IA, en anglais)
      if (typeof v === "string" && TEXT_KEYS.has(k) && /\p{L}{3,}/u.test(v)) out.push({ where: `${where}.${k}`, text: v });
      else plainTexts(v, `${where}.${k}`, out);
    }
  }
  return out;
}

test("chaque module a un nom et une description en français ET en anglais (c'est ce que l'assistant d'installation et le Catalogue affichent)", () => {
  assert.ok(manifests.length >= 60);
  for (const { dir, m } of manifests) {
    for (const key of ["name", "description"]) {
      const v = m[key];
      assert.ok(v && typeof v === "object", `${dir} : « ${key} » doit être { "en": …, "fr": … } (une chaîne simple n'a qu'une langue)`);
      for (const l of ["en", "fr"]) assert.ok(typeof v[l] === "string" && v[l].trim(), `${dir} : ${key}.${l} absent ou vide`);
      assert.deepEqual(Object.keys(v).sort(), ["en", "fr"], `${dir} : ${key} : exactement en et fr`);
      assert.ok(v.en.length <= (key === "name" ? 60 : 500) && v.fr.length <= (key === "name" ? 60 : 500), `${dir} : ${key} trop long`);
    }
  }
});

test("tous les textes par langue : français ET anglais présents, non vides, et chacun dans SA langue (mots-sentinelles)", () => {
  let count = 0;
  for (const { dir, m } of manifests) {
    for (const { where, texts } of localizedTexts(m)) {
      count++;
      const at = `${dir}${where}`;
      assert.ok(texts.fr?.trim() && texts.en?.trim(), `${at} : il manque ${texts.fr?.trim() ? "l'anglais" : "le français"} → ${JSON.stringify(texts)}`);
      const fr = FR.exec(unquoted(texts.en))?.[0];
      assert.equal(fr, undefined, `${at} : le texte ANGLAIS contient « ${fr} » (français ?) → ${texts.en}`);
      const en = EN.exec(unquoted(texts.fr))?.[0];
      assert.equal(en, undefined, `${at} : le texte FRANÇAIS contient « ${en} » (anglais ?) → ${texts.fr}`);
      if (texts.fr.length > 24 && texts.fr === texts.en) assert.match(texts.en, /[/@:()]|[A-Z][a-z]+, [A-Z]/, `${at} : texte identique dans les deux langues (oubli de traduction ?) → ${texts.en}`);
    }
  }
  assert.ok(count > 500, `seulement ${count} textes lus : le parcours a-t-il cassé ?`);
});

test("aucune chaîne simple dans un champ de texte (elle n'aurait qu'une langue), sauf les cas listés avec leur raison", () => {
  for (const { dir, m } of manifests) {
    for (const { where, text } of plainTexts(m)) {
      const rule = PLAIN_ALLOWED.find((a) => a.re.test(where) && (!a.only || a.only.includes(dir)));
      assert.ok(rule, `${dir}${where} : « ${text.slice(0, 60)} » est une chaîne simple ; écrivez { "en": …, "fr": … }`);
    }
  }
});

test("index du Catalogue : chaque module porte un nom et une description dans chaque langue de son manifeste (names, descriptions), et les chaînes simples restent pour les cœurs plus anciens", () => {
  const byId = new Map(index.modules.map((e) => [e.id, e]));
  assert.equal(byId.size, manifests.length, "toutes les entrées de l'index sont des modules du dépôt");
  for (const { dir, m } of manifests) {
    const e = byId.get(m.id);
    assert.ok(e, `${m.id} : absent de l'index`);
    assert.deepEqual(e.names, m.name, `${m.id} : names ≠ name du manifeste (node scripts/build-index.mjs)`);
    assert.deepEqual(e.descriptions, m.description, `${m.id} : descriptions ≠ description du manifeste (node scripts/build-index.mjs)`);
    assert.equal(e.name, m.name.fr, `${m.id} : name (chaîne simple) = le français, comme avant`);
    assert.equal(e.description, m.description.fr, `${m.id} : description (chaîne simple) = le français, comme avant`);
    assert.ok(e.names.en && e.names.fr && e.descriptions.en && e.descriptions.fr, `${dir} : langues manquantes dans l'index`);
  }
});

test("le générateur de l'index n'écrit plus jamais « une seule langue » : sa sortie contient names et descriptions pour tout module", () => {
  const src = fs.readFileSync(path.join(root, "scripts/build-index.mjs"), "utf8");
  assert.match(src, /languages\("names"/);
  assert.match(src, /languages\("descriptions"/);
});

test("profils de départ : textes en français ET en anglais, chacun dans sa langue", () => {
  const profiles = read("catalogue/profiles.json").profiles;
  assert.ok(profiles.length >= 4);
  for (const p of profiles) for (const key of ["name", "description"]) {
    assert.ok(p[key].fr?.trim() && p[key].en?.trim(), `${p.id}.${key}`);
    assert.equal(FR.exec(p[key].en)?.[0], undefined, `${p.id}.${key} (en) : ${p[key].en}`);
    assert.equal(EN.exec(p[key].fr)?.[0], undefined, `${p.id}.${key} (fr) : ${p[key].fr}`);
  }
});
