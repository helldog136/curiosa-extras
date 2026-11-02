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
const mod = await import("../examples/announcement-banner/index.mjs");
const def = mod.default;
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
  assert.deepEqual(Object.keys(byKey).sort(), ["enabled", "homeText", "link", "period", "text", "tone"]);
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

/* ───────────── Bandeau daté : réglage « period » (Limiter dans le temps) ───────────── */

const at = (iso) => new Date(iso);
/** Ce que voit le visiteur à cet instant (heure mockée, comme le serveur) : la bannière, la note d'accueil et l'élément d'overlay. */
function shown(t, iso, settings, tz) {
  if (!t.mock.timers.__on) { t.mock.timers.enable({ apis: ["Date"], now: at(iso).getTime() }); t.mock.timers.__on = true; } else t.mock.timers.setTime(at(iso).getTime());
  const ctx = Object.assign(withSettings({ enabled: true, text: "Soldes", homeText: "Note", ...settings }), tz ? { timezone: tz } : {});
  return { banner: def.slots["layout.banner"](ctx) !== null, note: def.sections.note(ctx) !== null, overlay: def.exports["overlay.item"](ctx).length === 1 };
}
const ALL = { banner: true, note: true, overlay: true }, NONE = { banner: false, note: false, overlay: false };
const PARIS = "Europe/Paris";

test("dates : le manifeste déclare UN seul réglage « period », rare, facultatif, sans valeur par défaut, avec exemple et textes courts en fr et en", () => {
  const f = manifestJson.settings.find((x) => x.key === "period");
  assert.equal(f.type, "period");
  assert.equal(f.rare, true);
  assert.equal(f.optional, true);
  assert.ok(!("default" in f), "sans dates, le bandeau marche comme avant");
  assert.ok(!f.translatable && !f.advanced);
  assert.equal(manifestJson.minCore, "0.6.0", "le type period demande le cœur 0.6.0");
  assert.ok(!manifestJson.settings.some((x) => ["datetime", "period"].includes(x.type) && x.key !== "period"), "pas de second champ de date");
  for (const lang of ["fr", "en"]) {
    for (const k of ["label", "help", "example"]) assert.ok(f[k][lang] && f[k][lang].length <= 60, `${k}.${lang}`);
    assert.ok(!f.label[lang].includes(":"));
  }
  assert.equal(f.label.fr, "Limiter dans le temps");
});

test("dates : au plus 7 réglages simples (les réglages rares ne comptent pas)", () => {
  const simple = manifestJson.settings.filter((s) => !s.rare && !s.advanced);
  assert.ok(simple.length <= 7, String(simple.length));
  assert.deepEqual(simple.map((s) => s.key), ["enabled", "text", "link", "tone", "homeText"], "les cinq réglages d'avant, dans le même ordre");
});

test("dates : les champs libres ont un exemple, sans point d'exclamation ni site réel", () => {
  for (const key of ["text", "link", "homeText"]) {
    const f = manifestJson.settings.find((x) => x.key === key);
    assert.ok(f.example, key);
    for (const v of typeof f.example === "string" ? [f.example] : Object.values(f.example)) assert.ok(v.trim() && !v.includes("!"), `${key} : ${v}`);
  }
});

test("dates : sans période (absente, vide, espaces) le bandeau, la note et l'overlay marchent exactement comme avant", (t) => {
  for (const period of [undefined, "", "   ", null]) assert.deepEqual(shown(t, "2026-11-02T10:00:00Z", { period }), ALL);
  const [b] = def.slots["layout.banner"](withSettings({ enabled: true, text: "Hi", link: "https://x.test", tone: "success" }));
  assert.deepEqual(b, { type: "banner", text: "Hi", href: "https://x.test", tone: "success" });
});

test("dates : une période unique inclut le premier et le dernier jour entiers (de 00:00 à 23:59, heure du site)", (t) => {
  const period = "2026-12-01/2026-12-24";
  assert.deepEqual(shown(t, "2026-11-30T22:59:59Z", { period }, PARIS), NONE, "la veille à 23:59:59");
  assert.deepEqual(shown(t, "2026-11-30T23:00:00Z", { period }, PARIS), ALL, "le 1er à 00:00");
  assert.deepEqual(shown(t, "2026-12-24T22:59:59Z", { period }, PARIS), ALL, "le 24 à 23:59:59");
  assert.deepEqual(shown(t, "2026-12-24T23:00:00Z", { period }, PARIS), NONE, "le 25 à 00:00");
});

test("dates : bandeau programmé dans le futur → rien aujourd'hui, visible le jour venu, sans minuteur", (t) => {
  const period = "2027-01-10/2027-01-20";
  assert.deepEqual(shown(t, "2026-11-02T10:00:00Z", { period }, PARIS), NONE);
  assert.deepEqual(shown(t, "2027-01-10T08:00:00Z", { period }, PARIS), ALL);
  assert.deepEqual(shown(t, "2027-01-21T08:00:00Z", { period }, PARIS), NONE, "terminé");
});

test("dates : période « chaque année » (12-20/01-05) enjambe le 31 décembre", (t) => {
  const period = "12-20/01-05";
  for (const [iso, ok] of [["2026-12-19T12:00:00Z", false], ["2026-12-20T12:00:00Z", true], ["2026-12-31T12:00:00Z", true], ["2027-01-05T12:00:00Z", true], ["2027-01-06T12:00:00Z", false], ["2027-07-01T12:00:00Z", false]]) {
    assert.deepEqual(shown(t, iso, { period }, PARIS), ok ? ALL : NONE, iso);
  }
});

test("dates : « chaque année » avec le 29 février couvre tout février, bissextile ou non", (t) => {
  const period = "02-01/02-29";
  assert.deepEqual(shown(t, "2027-02-28T12:00:00Z", { period }, PARIS), ALL);
  assert.deepEqual(shown(t, "2027-03-01T12:00:00Z", { period }, PARIS), NONE);
  assert.deepEqual(shown(t, "2028-02-29T12:00:00Z", { period }, PARIS), ALL);
});

test("dates : changement de fuseau — le même instant tombe dans un autre jour selon le fuseau du site", (t) => {
  const period = "2026-12-24/2026-12-24";
  const instant = "2026-12-24T23:30:00Z"; // 00:30 le 25 à Paris, 18:30 le 24 à New York, 08:30 le 25 à Tokyo
  assert.deepEqual(shown(t, instant, { period }, "Europe/Paris"), NONE);
  assert.deepEqual(shown(t, instant, { period }, "America/New_York"), ALL);
  assert.deepEqual(shown(t, instant, { period }, "Asia/Tokyo"), NONE);
  assert.deepEqual(shown(t, instant, { period }, "UTC"), ALL);
});

test("dates : passage à l'heure d'été (28 mars 2027, Paris) — le jour compte 23 heures, ni trou ni doublon", (t) => {
  const period = "2027-03-28/2027-03-28";
  assert.deepEqual(shown(t, "2027-03-27T22:59:59Z", { period }, PARIS), NONE, "27 mars 23:59:59 (UTC+1)");
  assert.deepEqual(shown(t, "2027-03-27T23:00:00Z", { period }, PARIS), ALL, "28 mars 00:00 (UTC+1)");
  assert.deepEqual(shown(t, "2027-03-28T01:00:00Z", { period }, PARIS), ALL, "03:00 (UTC+2) juste après le saut");
  assert.deepEqual(shown(t, "2027-03-28T21:59:59Z", { period }, PARIS), ALL, "28 mars 23:59:59 (UTC+2)");
  assert.deepEqual(shown(t, "2027-03-28T22:00:00Z", { period }, PARIS), NONE, "29 mars 00:00 (UTC+2)");
});

test("dates : retour à l'heure d'hiver (25 octobre 2026, Paris) — le jour compte 25 heures et l'heure doublée reste dans le jour", (t) => {
  const period = "2026-10-25/2026-10-25";
  assert.deepEqual(shown(t, "2026-10-24T21:59:59Z", { period }, PARIS), NONE, "24 octobre 23:59:59 (UTC+2)");
  assert.deepEqual(shown(t, "2026-10-24T22:00:00Z", { period }, PARIS), ALL, "25 octobre 00:00 (UTC+2)");
  assert.deepEqual(shown(t, "2026-10-25T00:30:00Z", { period }, PARIS), ALL, "02:30 la première fois");
  assert.deepEqual(shown(t, "2026-10-25T01:30:00Z", { period }, PARIS), ALL, "02:30 la seconde fois");
  assert.deepEqual(shown(t, "2026-10-25T22:59:59Z", { period }, PARIS), ALL, "25 octobre 23:59:59 (UTC+1)");
  assert.deepEqual(shown(t, "2026-10-25T23:00:00Z", { period }, PARIS), NONE, "26 octobre 00:00 (UTC+1)");
});

test("dates : un fuseau inconnu ou absent ne casse rien (repli sur celui de la machine)", (t) => {
  for (const tz of [undefined, "", "Mars/Olympus", 42]) {
    assert.doesNotThrow(() => shown(t, "2026-12-10T12:00:00Z", { period: "2026-12-01/2026-12-24" }, tz));
    assert.deepEqual(shown(t, "2026-12-10T12:00:00Z", { period: "2026-12-01/2026-12-24" }, tz), ALL, "milieu de période : vrai dans tous les fuseaux");
  }
  assert.ok(typeof mod.zoneOf({ timezone: "Mars/Olympus" }) === "string");
  assert.equal(mod.zoneOf({ timezone: "Europe/Brussels" }), "Europe/Brussels");
});

test("dates : une valeur illisible ou à l'envers n'éteint jamais l'annonce", (t) => {
  for (const period of ["n'importe quoi", "2026-12-24/2026-12-01", "2026-12-01/", "/2026-12-24", "2026-13-40/2026-14-01"]) {
    assert.deepEqual(shown(t, "2026-12-10T12:00:00Z", { period }, PARIS), ALL, period);
  }
});

test("dates : l'activation reste prioritaire — désactivée ou sans texte, une période en cours n'affiche rien", (t) => {
  assert.equal(shown(t, "2026-12-10T12:00:00Z", { period: "2026-12-01/2026-12-24", enabled: false }, PARIS).banner, false);
  assert.equal(shown(t, "2026-12-10T12:00:00Z", { period: "2026-12-01/2026-12-24", text: "" }, PARIS).banner, false);
  assert.equal(shown(t, "2026-12-10T12:00:00Z", { period: "2026-12-01/2026-12-24", text: "" }, PARIS).overlay, false);
});

test("dates : deux instances ont chacune leur période", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-12-10T12:00:00Z").getTime() });
  const a = withSettings({ enabled: true, text: "A", period: "2026-12-01/2026-12-24" }, "a");
  const b = withSettings({ enabled: true, text: "B", period: "2027-01-01/2027-01-31" }, "b");
  assert.equal(def.slots["layout.banner"](a)[0].text, "A");
  assert.equal(def.slots["layout.banner"](b), null);
});

test("dates : aucun minuteur ni tâche de fond — la décision se prend à l'affichage", () => {
  assert.ok(!/setTimeout|setInterval|setImmediate|cron/i.test(source));
  assert.ok(!def.tasks && !def.hooks && !manifestJson.tasks);
});

test("dates : le cœur refuse une fin avant le début, sous le champ, avec un exemple (en et fr)", async () => {
  const { checkFieldInput } = await import("@/core/modules/settingValues");
  const field = manifestJson.settings.find((x) => x.key === "period");
  assert.deepEqual(checkFieldInput(field, "2026-12-24/2026-12-01"), { ok: false, reason: "period" });
  assert.deepEqual(checkFieldInput(field, "2026-12-01/"), { ok: false, reason: "period" }, "un début seul ou une fin seule ne s'enregistre pas : le contrôle demande les deux");
  assert.deepEqual(checkFieldInput(field, "2026-12-01/2026-12-24"), { ok: true, value: "2026-12-01/2026-12-24" });
  assert.deepEqual(checkFieldInput(field, "12-20/01-05"), { ok: true, value: "12-20/01-05" });
  const core = process.env.CURIOSA_DIR;
  for (const [lang, example] of [["fr", /par exemple/], ["en", /for example/]]) {
    const msg = JSON.parse(fs.readFileSync(`${core}/src/locales/${lang}.json`, "utf8"))["instances.error.period"];
    assert.match(msg, example);
  }
});

test("dates : le réglage a ses trois textes en fr et en (l'aperçu en une phrase vient du contrôle du cœur)", () => {
  const f = manifestJson.settings.find((x) => x.key === "period");
  for (const k of ["label", "help", "example"]) assert.deepEqual(Object.keys(f[k]).sort(), ["en", "fr"]);
});
