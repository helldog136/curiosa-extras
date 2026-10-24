// Galeries photos : les deux petits scripts envoyés au navigateur (visionneuse et outil d'envoi). Ils ne peuvent pas être essayés ici dans un vrai navigateur
// (c'est fait à la main, voir docs/ideas/gallery.md) ; ces tests gardent ce qu'on peut garder : ils se chargent, restent petits et sobres, n'écrivent rien
// d'inconnu dans la page, ne contactent personne, et lisent seulement des textes que la page leur donne.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { ctxFor, makeAlbum, def, messages, view } from "./helpers/galleryKit.mjs";

const DIR = new URL("../modules/gallery/scripts/", import.meta.url).pathname;
const read = (f) => fs.readFileSync(`${DIR}${f}`, "utf8");
const FILES = ["gallery.js", "gallery-studio.js"];
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");

test("les scripts sont de vrais fichiers, d'au plus 32 Ko, en mode strict, qui se chargent sans erreur", () => {
  assert.deepEqual(fs.readdirSync(DIR).sort(), [...FILES].sort());
  for (const f of FILES) {
    const code = read(f);
    assert.ok(Buffer.byteLength(code) <= 32 * 1024, `${f} : ${Buffer.byteLength(code)} octets`);
    assert.match(code, /"use strict"/);
    assert.doesNotThrow(() => new vm.Script(code, { filename: f }));
  }
});

test("sobriété : ni eval, ni innerHTML, ni cookie, ni stockage du navigateur, ni appel vers un autre site, ni adresse en dur", () => {
  for (const f of FILES) {
    const code = strip(read(f));
    for (const bad of [/\beval\s*\(/, /new\s+Function/, /\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /document\.cookie/, /localStorage|sessionStorage|indexedDB/, /https?:\/\//, /\bimportScripts\b/, /\.src\s*=\s*["'`]https?/]) {
      assert.doesNotMatch(code, bad, `${f} : ${bad}`);
    }
  }
  assert.doesNotMatch(strip(read("gallery.js")), /credentials:\s*["']include/);
  assert.match(strip(read("gallery.js")), /credentials: "omit"/, "la demande de retrait n'envoie aucun cookie");
});

test("chargement à vide : sur une page sans galerie, ni l'un ni l'autre ne fait ou ne change quoi que ce soit", () => {
  for (const f of FILES) {
    const listeners = [];
    const doc = { readyState: "complete", addEventListener: (t) => listeners.push(t), querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}) };
    const win = { __x: 1, document: doc, addEventListener: (t) => listeners.push(`win:${t}`), navigator: {}, history: {}, location: { href: "https://example.org/" } };
    win.window = win;
    assert.doesNotThrow(() => vm.runInNewContext(read(f), { window: win, document: doc }, { filename: f }), f);
    if (f === "gallery-studio.js") assert.deepEqual(listeners, [], "pas de coquille d'envoi : aucun écouteur");
  }
});

test("la page donne au script tous les textes qu'il lit (aucun texte en dur), dans les deux langues", async () => {
  const wanted = [...read("gallery.js").matchAll(/\b(?:d|dataset|root\.dataset|r\.dataset)\.t([A-Z][A-Za-z]*)/g)].map((m) => m[1]);
  const fromGetAttr = [...read("gallery.js").matchAll(/getAttribute\("data-t-([a-z-]+)"\)/g)].map((m) => m[1]);
  assert.ok(wanted.length >= 12, `textes lus par le script : ${wanted.length}`);
  for (const locale of ["fr", "en"]) {
    const ctx = ctxFor({}, { locale });
    const a = await makeAlbum(ctx, { n: 2 });
    const page = await def.page(ctx, { segments: [a.album.slug] });
    const html = page.blocks[0].html;
    const names = [...new Set([...wanted.map((n) => n.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^-/, "")), ...fromGetAttr])];
    for (const n of names) {
      const m = new RegExp(`data-t-${n}="([^"]*)"`).exec(html);
      assert.ok(m && m[1].length > 0, `[${locale}] data-t-${n} manque ou est vide`);
    }
  }
});

test("l'outil d'envoi lit seulement des textes que la page lui donne, en français comme en anglais", async () => {
  const used = [...new Set([...read("gallery-studio.js").matchAll(/\bT\.(studio[A-Za-z]+)/g)].map((m) => m[1]))];
  assert.ok(used.length >= 25, `textes lus : ${used.length}`);
  for (const locale of ["fr", "en"]) {
    const ctx = ctxFor({}, { locale });
    const page = view.renderStudio(ctx, "abc123");
    const cfg = JSON.parse(/data-config="([^"]*)"/.exec(page.html)[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
    for (const key of used) assert.ok(cfg.texts[key] && cfg.texts[key] !== key, `[${locale}] ${key}`);
    for (const [key, text] of Object.entries(cfg.texts)) assert.equal(text, messages(locale)[key], `[${locale}] ${key} vient du fichier de langue`);
  }
});

test("les ordres et les noms que le script utilise existent côté serveur : actions, champs, route du cœur", () => {
  const code = read("gallery-studio.js");
  const actions = [...code.matchAll(/call\("([A-Za-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(actions)].sort(), ["addPhoto", "studioInfo"]);
  for (const a of actions) assert.ok(def.adminActions[a], a);
  for (const field of ["album", "caption", "alt", "name"]) assert.match(code, new RegExp(`\\b${field}:`), `champ ${field} envoyé`);
  for (const file of ["photo", "thumb"]) assert.match(code, new RegExp(`\\b${file}:`), `fichier ${file} envoyé`);
  assert.match(code, /"\/action\/"/, "route du cœur pour les actions avec fichier");
});
