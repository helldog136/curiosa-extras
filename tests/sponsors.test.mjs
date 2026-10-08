import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/sponsors", import.meta.url).pathname;
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
  assert.equal(r.manifest.id, "sponsors");
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

const def = (await import("../modules/sponsors/index.mjs")).default;
const date = new Date("2026-05-01T10:00:00Z");
const entry = (o = {}) => ({ id: "e1", title: "Marque", summary: "Un résumé", path: "/sponsors/marque", url: null, code: null, cover: null, publishedAt: null, tags: [], fields: {}, ...o });

test("manifeste : contenu avec codes, liens /go, sujets fournis/consommés cohérents avec le code", () => {
  assert.equal(manifestJson.type, "content");
  assert.equal(manifestJson.instances, "multiple");
  assert.equal(manifestJson.content.display, "codes");
  assert.equal(manifestJson.content.allowGoLinks, true);
  assert.ok(manifestJson.content.features.includes("code") && manifestJson.content.features.includes("url"));
  assert.deepEqual(manifestJson.provides.map((p) => p.topic).sort(), Object.keys(def.exports).sort());
  assert.deepEqual(manifestJson.permissions.sort(), ["pages", "slots", "topics"]);
  const ref = manifestJson.content.fieldSchema.find((f) => f.key === "partner");
  assert.equal(ref.type, "ref");
  assert.ok(manifestJson.consumes.some((c) => c.topic === ref.topic), "le champ ref pointe un sujet consommé");
  assert.ok(!def.sections && !def.mcp && !def.routes && !def.overlay);
});

test("manifeste : les champs consommés couvrent ce que le code lit du partenaire (id, logo)", () => {
  const keys = manifestJson.consumes[0].schema.map((s) => s.key);
  assert.ok(keys.includes("id") && keys.includes("logo"));
});

test("manifeste : le réglage disclosure est traduisible (une mention par langue)", () => {
  const s = manifestJson.settings.find((x) => x.key === "disclosure");
  assert.equal(s.translatable, true);
  assert.equal(s.default, undefined, "pas de défaut dans le manifeste : repli sur le texte de la langue");
});

test("slots : mention affichée sur les pages de ses propres entrées, dans la langue courante", () => {
  for (const [lang, expect] of [["en", "Commercial partnership"], ["fr", "Partenariat commercial"]]) {
    const ctx = ctxFor(lang, { key: "sponsors" });
    ctx.page = { key: "sponsors" };
    for (const slot of ["page.top", "entry.top"]) {
      const out = def.slots[slot](ctx);
      assert.equal(out.length, 1);
      assert.equal(out[0].type, "markdown");
      assert.ok(out[0].text.startsWith("> ℹ️ "), "présentée en citation");
      assert.ok(out[0].text.includes(expect), `${slot}/${lang}`);
    }
  }
});

test("slots : rien sur les pages d'une autre instance ni hors page", () => {
  const ctx = ctxFor("en", { key: "sponsors" });
  ctx.page = { key: "blog" };
  assert.equal(def.slots["page.top"](ctx), null);
  assert.equal(def.slots["entry.top"](ctx), null);
  ctx.page = undefined;
  assert.equal(def.slots["page.top"](ctx), null);
});

test("slots : deux instances de sponsors ne se mélangent pas (clé de l'instance)", () => {
  const a = ctxFor("en", { key: "sponsors-a" }); a.page = { key: "sponsors-b" };
  const b = ctxFor("en", { key: "sponsors-b" }); b.page = { key: "sponsors-b" };
  assert.equal(def.slots["page.top"](a), null);
  assert.ok(def.slots["page.top"](b));
});

test("mention : le réglage de l'instance remplace le texte par défaut ; vide → texte par défaut", () => {
  const custom = ctxFor("en", { key: "s", settings: { disclosure: "Lien de parrainage." } });
  custom.page = { key: "s" };
  assert.equal(def.slots["page.top"](custom)[0].text, "> ℹ️ Lien de parrainage.");
  const empty = ctxFor("en", { key: "s", settings: { disclosure: "" } });
  empty.page = { key: "s" };
  assert.match(def.slots["page.top"](empty)[0].text, /Commercial partnership/);
});

test("mention : texte saisi transmis comme texte (pas de HTML ajouté par le module)", () => {
  const ctx = ctxFor("en", { key: "s", settings: { disclosure: "<script>alert(1)</script> **gras**" } });
  ctx.page = { key: "s" };
  const [block] = def.slots["page.top"](ctx);
  assert.equal(block.type, "markdown", "rendu par le Markdown du cœur, jamais en bloc html");
  assert.equal(block.text, "> ℹ️ <script>alert(1)</script> **gras**");
  assert.ok(!("html" in block));
});

test("mention : une mention multi-lignes reste entièrement dans la citation", () => {
  const ctx = ctxFor("en", { key: "s", settings: { disclosure: "Ligne 1\n# Titre" } });
  ctx.page = { key: "s" };
  const text = def.slots["page.top"](ctx)[0].text;
  assert.ok(text.split("\n").every((l) => l.startsWith(">")));
});

test("sponsor.card : champs de la carte, repli sur l'URL de la page, date ISO, étiquettes", async () => {
  const ctx = ctxFor("en", { entries: [entry({ code: "PROMO10", cover: "https://img.test/a.png", url: "https://shop.test/?ref=me", publishedAt: date, tags: ["jeux"] }), entry({ id: "e2", title: "Sans lien", summary: "", path: "/sponsors/x" })] });
  const cards = await def.exports["sponsor.card"](ctx, { limit: 5 });
  assert.deepEqual(cards[0], { id: "e1", name: "Marque", text: "Un résumé", url: "https://shop.test/?ref=me", code: "PROMO10", logo: "https://img.test/a.png", publishedAt: "2026-05-01T10:00:00.000Z", tags: ["jeux"] });
  assert.equal(cards[1].url, "https://example.test/sponsors/x");
  assert.equal(cards[1].text, undefined, "résumé vide → absent");
  assert.equal(cards[1].code, undefined);
  assert.equal(cards[1].logo, undefined);
  assert.equal(cards[1].publishedAt, undefined);
  assert.deepEqual(ctx.calls.entries, [{ limit: 5 }], "la limite demandée est transmise");
});

test("sponsor.card : aucune entrée → liste vide", async () => {
  assert.deepEqual(await def.exports["sponsor.card"](ctxFor(), { limit: 10 }), []);
});

test("sponsor.card : le logo du partenaire lié sert de repli, la couverture du sponsor garde la priorité", async () => {
  const ctx = ctxFor("en", {
    entries: [entry({ id: "a", fields: { partner: "p1" } }), entry({ id: "b", cover: "/uploads/own.png", fields: { partner: "p1" } }), entry({ id: "c", fields: { partner: "inconnu" } }), entry({ id: "d", fields: {} })],
    topics: { "partnership.partner": [{ id: "p1", title: "Acme", logo: "/uploads/acme.png" }] },
  });
  const cards = await def.exports["sponsor.card"](ctx, {});
  assert.deepEqual(cards.map((c) => c.logo), ["/uploads/acme.png", "/uploads/own.png", undefined, undefined]);
  assert.deepEqual(ctx.calls.topics[0], ["partnership.partner", { limit: 200 }]);
});

test("sponsor.card : module Partenariats absent ou en erreur → les sponsors restent affichés", async () => {
  const ctx = ctxFor("en", { entries: [entry({ fields: { partner: "p1" } })] });
  ctx.api.topics.collect = async () => { throw new Error("topic indisponible"); };
  const cards = await def.exports["sponsor.card"](ctx, {});
  assert.equal(cards.length, 1);
  assert.equal(cards[0].logo, undefined);
});

test("sponsor.card : textes bruts conservés tels quels (jamais interprétés comme du HTML par le module)", async () => {
  const ctx = ctxFor("en", { entries: [entry({ title: "<b>Gras</b>", summary: "<script>x</script>", code: "A&B" })] });
  const [card] = await def.exports["sponsor.card"](ctx, {});
  assert.equal(card.name, "<b>Gras</b>");
  assert.equal(card.text, "<script>x</script>");
  assert.equal(card.code, "A&B");
});

test("sponsor.card : une URL de lien dangereuse n'est pas relayée aux overlays", async () => {
  const ctx = ctxFor("en", { entries: [entry({ url: "javascript:alert(1)", cover: "javascript:alert(2)" })] });
  const [card] = await def.exports["sponsor.card"](ctx, {});
  assert.ok(!/^javascript:/i.test(String(card.url)));
  assert.ok(!/^javascript:/i.test(String(card.logo)));
});
