import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../examples/announcement-banner", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifestJson = readJson("module.json");
const localeFiles = () => (fs.existsSync(`${DIR}/locales`) ? fs.readdirSync(`${DIR}/locales`).filter((f) => f.endsWith(".json")) : []);
const loadMessages = (lang) => (fs.existsSync(`${DIR}/locales/${lang}.json`) ? readJson(`locales/${lang}.json`) : {});
const source = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
/** Contexte factice avec les vrais textes du module (langue donnée). */
const ctxFor = (lang = "en", opts = {}) => fakeCtx({ locale: lang, messages: loadMessages(lang), ...opts });

test("manifeste : valide pour parseManifest", () => {
  const r = parseManifest(manifestJson);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(r.manifest.id, "announcement-banner");
});

test("manifeste : aucune action destructive n'est activée par défaut, aucune lecture seule n'est destructive", () => {
  for (const a of manifestJson.mcp ?? []) {
    if (a.destructive) assert.notEqual(a.default, true, `${a.name} destructive mais activée par défaut`);
    assert.ok(!(a.readOnly && a.destructive), a.name);
  }
});

test("manifeste : les réglages lus par le code (ctx.setting) existent tous dans module.json", () => {
  const declared = new Set([...(manifestJson.settings ?? []), ...(manifestJson.sections ?? []).flatMap((s) => s.options ?? [])].map((s) => s.key));
  const used = [...source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)].map((m) => m[1]);
  for (const key of used) assert.ok(declared.has(key), `réglage ${key} lu mais non déclaré`);
});

test("langues : les fichiers locales ont exactement les mêmes clés (parité en/fr)", () => {
  const files = localeFiles();
  if (!files.length) return;
  const keys = (f) => Object.keys(readJson(`locales/${f}`)).sort();
  assert.ok(files.includes("en.json") && files.includes("fr.json"));
  assert.deepEqual(keys("fr.json"), keys("en.json"));
  for (const f of files) for (const [k, v] of Object.entries(readJson(`locales/${f}`))) assert.ok(typeof v === "string" && v.trim(), `${f}:${k} vide`);
});

test("langues : chaque clé ctx.t(\"…\") utilisée statiquement par le code existe dans les textes", () => {
  const en = loadMessages("en");
  if (!Object.keys(en).length) return;
  for (const m of source.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in en, `clé ${m[1]} absente de en.json`);
});

import { safeHref } from "@/core/url";
const def = (await import("../examples/announcement-banner/index.mjs")).default;
const withSettings = (settings, key = "banner") => fakeCtx({ key, settings });

test("manifeste : slot, section et sujet déclarés = implémentés ; permissions correspondantes", () => {
  assert.deepEqual(Object.keys(def.slots), ["layout.banner"]);
  assert.deepEqual(manifestJson.sections.map((s) => s.id).sort(), Object.keys(def.sections).sort());
  assert.deepEqual(manifestJson.provides.map((p) => p.topic).sort(), Object.keys(def.exports).sort());
  assert.deepEqual(manifestJson.permissions.sort(), ["sections", "slots", "topics"]);
  assert.equal(manifestJson.instances, "multiple");
  assert.ok(!def.mcp && !def.routes && !def.overlay);
});

test("manifeste : réglages (types, défauts, traductibles) cohérents avec l'usage du code", () => {
  const byKey = Object.fromEntries(manifestJson.settings.map((s) => [s.key, s]));
  assert.deepEqual(Object.keys(byKey).sort(), ["enabled", "homeText", "link", "text", "tone"]);
  assert.equal(byKey.enabled.default, true);
  assert.equal(byKey.text.translatable, true);
  assert.equal(byKey.homeText.translatable, true);
  assert.equal(byKey.link.type, "url");
  assert.equal(byKey.tone.default, "info");
  assert.deepEqual(byKey.tone.options.map((o) => o.value), ["info", "success", "warning"]);
  const used = [...source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)].map((m) => m[1]);
  for (const k of Object.keys(byKey)) assert.ok(used.includes(k), `réglage ${k} jamais lu`);
});

test("bannière : texte + lien + style → un bloc banner", () => {
  const out = def.slots["layout.banner"](withSettings({ enabled: true, text: "Soldes !", link: "https://shop.test/soldes", tone: "warning" }));
  assert.deepEqual(out, [{ type: "banner", text: "Soldes !", href: "https://shop.test/soldes", tone: "warning" }]);
});

test("bannière : lien vide ou absent → pas de href", () => {
  for (const link of ["", undefined, null]) {
    const [b] = def.slots["layout.banner"](withSettings({ enabled: true, text: "Hi", link, tone: "info" }));
    assert.equal(b.href, undefined);
  }
});

test("bannière : désactivée, sans texte ou réglages vides → rien", () => {
  assert.equal(def.slots["layout.banner"](withSettings({ enabled: false, text: "Hi" })), null);
  assert.equal(def.slots["layout.banner"](withSettings({ enabled: true, text: "" })), null);
  assert.equal(def.slots["layout.banner"](withSettings({ enabled: true })), null);
  assert.equal(def.slots["layout.banner"](withSettings({})), null);
});

test("bannière : le texte déjà traduit par le cœur est utilisé tel quel (une langue vide n'affiche rien)", () => {
  const fr = fakeCtx({ locale: "fr", settings: { enabled: true, text: "Bonjour" } });
  const en = fakeCtx({ locale: "en", settings: { enabled: true, text: "" } });
  assert.equal(def.slots["layout.banner"](fr)[0].text, "Bonjour");
  assert.equal(def.slots["layout.banner"](en), null);
});

test("bannière : le texte saisi reste du texte (bloc banner, jamais de HTML construit par le module)", () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const [b] = def.slots["layout.banner"](withSettings({ enabled: true, text: evil }));
  assert.equal(b.type, "banner");
  assert.equal(b.text, evil, "échappé à l'affichage par le composant du cœur");
  assert.deepEqual(Object.keys(b).sort(), ["href", "text", "tone", "type"]);
  assert.ok(!("html" in b));
});

test("bannière : un lien dangereux est neutralisé à l'affichage par safeHref du cœur", () => {
  const [b] = def.slots["layout.banner"](withSettings({ enabled: true, text: "x", link: "javascript:alert(1)" }));
  assert.equal(safeHref(b.href), "#");
  assert.equal(safeHref("data:text/html,<b>"), "#");
  assert.equal(safeHref("https://ok.test/a"), "https://ok.test/a");
  assert.equal(safeHref("/page"), "/page");
  assert.equal(safeHref("//evil.test"), "#");
});

test("bannière : le module lui-même ne relaie pas un lien javascript:", () => {
  const [b] = def.slots["layout.banner"](withSettings({ enabled: true, text: "x", link: "javascript:alert(1)" }));
  assert.ok(!b.href || /^(https?:|\/)/i.test(b.href));
});

test("section note : Markdown de l'accueil, rien si vide", () => {
  assert.deepEqual(def.sections.note(withSettings({ homeText: "**Bienvenue**" })), [{ type: "markdown", text: "**Bienvenue**" }]);
  for (const homeText of ["", undefined]) assert.equal(def.sections.note(withSettings({ homeText })), null);
});

test("section note : le texte est un bloc markdown (le HTML brut est géré par le rendu du cœur), pas un bloc html", () => {
  const [b] = def.sections.note(withSettings({ homeText: "<script>alert(1)</script>" }));
  assert.equal(b.type, "markdown");
});

test("sujet overlay.item : texte et lien de la bannière ; vide si désactivée ou sans texte", () => {
  const item = def.exports["overlay.item"];
  assert.deepEqual(item(withSettings({ enabled: true, text: "Annonce", link: "https://x.test" })), [{ title: "Annonce", url: "https://x.test" }]);
  assert.deepEqual(item(withSettings({ enabled: true, text: "Annonce" })), [{ title: "Annonce", url: undefined }]);
  assert.deepEqual(item(withSettings({ enabled: true, text: "Annonce", link: "" })), [{ title: "Annonce", url: undefined }]);
  assert.deepEqual(item(withSettings({ enabled: false, text: "Annonce" })), []);
  assert.deepEqual(item(withSettings({ enabled: true, text: "" })), []);
  assert.deepEqual(item(withSettings({})), []);
});

test("sujet overlay.item : la forme correspond au schéma consommé par les overlays (title, url)", () => {
  const [i] = def.exports["overlay.item"](withSettings({ enabled: true, text: "T", link: "https://x.test" }));
  assert.deepEqual(Object.keys(i).sort(), ["title", "url"]);
});

test("instances : chaque instance lit ses propres réglages (deux bannières indépendantes)", () => {
  const a = withSettings({ enabled: true, text: "A" }, "a");
  const b = withSettings({ enabled: true, text: "B" }, "b");
  assert.equal(def.slots["layout.banner"](a)[0].text, "A");
  assert.equal(def.slots["layout.banner"](b)[0].text, "B");
});

test("textes du module : fichiers en/fr valides (clé d'exemple « hello »)", () => {
  assert.equal(readJson("locales/en.json").hello, "Hello");
  assert.equal(readJson("locales/fr.json").hello, "Bonjour");
});
