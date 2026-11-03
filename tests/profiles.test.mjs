// PROFILS DE DÉPART (catalogue/profiles.json) et MODÈLES DE PAGES (modules/pages, content.templates).
// Le cœur lit ce fichier à l'exécution (assistant d'installation : « Vous êtes… ? ») ; un cœur plus ancien l'ignore, et un dépôt sans ce fichier ne pose simplement pas la question.
// Ce test garde le contrat : des modules suggérés, des modèles qui existent, FR et EN à parité, des textes neutres et sans texte juridique, rien d'obligatoire ni de payant.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { forbiddenWords, labelProblems, toneProblems } from "./helpers/ergonomics.mjs";

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const file = read("catalogue/profiles.json");
const suggested = read("catalogue/suggested.json");
const pages = read("modules/pages/module.json");
const templates = pages.content.templates;
const ID = /^[a-z][a-z0-9-]{1,39}$/;
const both = (v, where) => { assert.ok(v && typeof v === "object" && v.fr?.trim() && v.en?.trim(), `${where} : texte français ET anglais`); return v; };
const strings = (v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);

test("profils : 4 à 5 profils (+ « Autre », celui du cœur), identifiants valides et uniques, jamais « other »", () => {
  assert.equal(file.version, 1);
  assert.ok(file.profiles.length >= 4 && file.profiles.length <= 5, "6 cartes au plus avec « Autre »");
  const ids = file.profiles.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, ID);
  assert.ok(!ids.includes("other"), "« Autre » ne change rien : il appartient au cœur");
});

test("profils : chaque extension existe et est suggérée à l'assistant, chaque page d'exemple est un modèle déclaré par le module pages", () => {
  const ids = new Set(templates.map((t) => t.id));
  for (const p of file.profiles) {
    assert.ok(p.modules.length >= 1 && p.modules.length <= 8, p.id);
    for (const m of p.modules) assert.ok(suggested.includes(m), `${p.id} : « ${m} » n'est pas dans catalogue/suggested.json (l'assistant ne le proposerait pas)`);
    assert.ok(p.samples.length <= 8, p.id);
    for (const s of p.samples) {
      const [mod, tpl] = s.split(":");
      assert.equal(mod, "pages", `${p.id} : seuls les modèles du module pages existent pour l'instant`);
      assert.ok(ids.has(tpl), `${p.id} : le modèle « ${s} » n'existe pas`);
      assert.ok(p.modules.includes(mod), `${p.id} : un exemple de « ${mod} » suppose que ${mod} soit coché`);
    }
  }
});

test("profils : le profil ne change rien d'obligatoire — aucun module en dehors des suggérés, aucun réglage, aucune clé inconnue", () => {
  for (const p of file.profiles) assert.deepEqual(Object.keys(p).sort(), ["description", "icon", "id", "modules", "name", "samples"], p.id);
});

test("profils : textes FR et EN, libellés courts sans deux-points, mots de la personne, ton neutre (vouvoiement, sans point d'exclamation)", () => {
  for (const p of file.profiles) {
    const name = both(p.name, `${p.id}.name`), help = both(p.description, `${p.id}.description`);
    for (const l of ["fr", "en"]) {
      assert.ok(name[l].length <= 60 && help[l].length <= 140, `${p.id} (${l}) : trop long`);
      assert.deepEqual(labelProblems(name[l]), [], `${p.id}.name ${l}`);
      for (const text of [name[l], help[l]]) {
        assert.deepEqual(forbiddenWords(text), [], `${p.id} : ${text}`);
        assert.deepEqual(toneProblems(text), [], `${p.id} : ${text}`);
        assert.doesNotMatch(text, /!|veuillez|(?<![\p{L}'’])(?:tu|ta|tes|ton)(?![\p{L}])/iu, text);
      }
    }
    assert.ok(Array.from(p.icon).length >= 1 && Array.from(p.icon).length <= 8);
  }
});

test("modèles de pages : 5 modèles (Qui sommes-nous, Infos pratiques, Chronologie, À propos de moi, Ce que je propose), bornés comme le cœur les lit", () => {
  assert.deepEqual(templates.map((t) => t.id), ["about-us", "practical-info", "timeline", "about-me", "showcase"]);
  assert.ok(templates.length <= 8);
  for (const t of templates) {
    assert.match(t.id, ID);
    const name = both(t.name, `${t.id}.name`), desc = both(t.description, `${t.id}.description`), title = both(t.title, `${t.id}.title`), sum = both(t.summary, `${t.id}.summary`), body = both(t.body, `${t.id}.body`);
    for (const l of ["fr", "en"]) {
      assert.ok(name[l].length <= 60 && desc[l].length <= 120 && title[l].length <= 120 && sum[l].length <= 300 && body[l].length <= 6000, `${t.id} (${l}) : hors des bornes du cœur`);
      assert.deepEqual(labelProblems(name[l]), [], `${t.id}.name ${l}`);
      assert.deepEqual(forbiddenWords(name[l]), [], `${t.id}.name`);
      assert.deepEqual(forbiddenWords(desc[l]), [], `${t.id}.description`);
    }
  }
});

test("modèles de pages : un exemple se reconnaît (texte d'exemple à modifier), reste neutre, sans personne ni site réel, sans texte juridique ni paiement ni collecte", () => {
  const FORBIDDEN = [
    [/!/, "point d'exclamation"], [/veuillez/i, "« Veuillez »"], [/(?<![\p{L}'’])(?:tu|ta|tes|ton)(?![\p{L}])/iu, "tutoiement"],
    [/mentions légales|politique de confidentialité|conditions générales|\bCGV\b|\bCGU\b|RGPD|GDPR|legal notice|privacy policy|terms (?:of|and) (?:use|service|conditions)|cookies?/i, "texte juridique ou collecte de données"],
    [/paiement|payer|acheter|commander|panier|tarif|prix|€|\$|paypal|stripe|\bpay(?:ment)?\b|\bbuy\b|\border\b|\bprice\b/i, "paiement"],
    [/newsletter|inscrivez-vous|abonnez-vous|subscribe|sign up/i, "collecte d'adresses"],
    [/https?:\/\/(?!example\.com)/i, "site réel (seul example.com est permis)"],
    [/@(?!example\.com)[\w.-]+\.\w+/i, "adresse e-mail réelle"],
  ];
  for (const t of templates) for (const l of ["fr", "en"]) {
    const body = t.body[l];
    assert.match(body, /^\*(?:Texte d'exemple|Example text)[^\n]*\*\n/, `${t.id} (${l}) : la première ligne dit que c'est un exemple`);
    for (const [re, why] of FORBIDDEN) assert.doesNotMatch(body + " " + t.summary[l] + " " + t.title[l], re, `${t.id} (${l}) : ${why}`);
    assert.deepEqual(forbiddenWords(t.title[l]), [], `${t.id}.title`);
    for (const sentence of body.replace(/https?:\/\/\S+/g, " ").split(/(?<=[.?])\s+|\n+/)) assert.ok(sentence.trim().split(/\s+/).length <= 20, `${t.id} (${l}) : phrase trop longue « ${sentence.trim().slice(0, 50)}… »`);
  }
});

test("modèles de pages : FR et EN gardent la même structure (mêmes titres de section, mêmes liens)", () => {
  const shape = (b) => ({ h: (b.match(/^#{1,3} /gm) ?? []).length, links: (b.match(/\]\(/g) ?? []).length, items: (b.match(/^- /gm) ?? []).length });
  for (const t of templates) assert.deepEqual(shape(t.body.fr), shape(t.body.en), t.id);
});

test("le module pages reste un module à contenu sans code : aucune permission de plus, version 1.2.0 (ajouts compatibles)", () => {
  assert.deepEqual([...pages.permissions].sort(), ["pages", "sections"]);
  assert.equal(pages.version, "1.2.0");
  assert.ok(!("minCore" in pages) && !pages.requires, "un cœur plus ancien ignore la clé `templates` : aucun cœur minimal à exiger");
  assert.ok(!fs.existsSync(new URL("../modules/pages/index.mjs", import.meta.url)), "aucun code ajouté à la page d'administration");
  for (const s of strings(file)) assert.ok(typeof s === "string");
});

test("compatibilité : suggested.json garde sa forme de liste (un cœur ancien lit le même dépôt) et l'index ne mentionne pas les profils", () => {
  assert.ok(Array.isArray(suggested) && suggested.every((x) => typeof x === "string"));
  assert.ok(!/"profiles?"/.test(fs.readFileSync(new URL("../catalogue/index.json", import.meta.url), "utf8")), "l'index ne porte aucune clé de profil");
});
