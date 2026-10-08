import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/sponsor-ticker", import.meta.url).pathname;
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
  assert.equal(r.manifest.id, "sponsor-ticker");
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

import vm from "node:vm";
const def = (await import("../modules/sponsor-ticker/index.mjs")).default;

const overlayOf = (settings = {}, query = "", opts = {}) => {
  const ctx = ctxFor("en", { key: "ticker", name: "Mon ticker", settings, ...opts });
  return { ctx, out: def.overlay(ctx, { query: new URLSearchParams(query) }) };
};
/** Extrait l'objet de configuration inséré dans <script>. */
const cfgOf = (out) => {
  const m = out.script.match(/^\(function\(\)\{var c=(\{.*?\}),slider=/s);
  assert.ok(m, "configuration trouvée en tête du script");
  return JSON.parse(m[1]);
};

test("manifeste : overlay avec route, sujets consommés (sponsor.card, core.entry), tous les réglages utilisés", () => {
  assert.equal(manifestJson.type, "overlay");
  assert.equal(typeof def.overlay, "function");
  assert.deepEqual(Object.keys(def.routes), ["items"]);
  assert.deepEqual(manifestJson.consumes.map((c) => c.topic).sort(), ["core.entry", "sponsor.card"]);
  assert.deepEqual(manifestJson.permissions.sort(), ["overlay", "routes", "topics"]);
  const keys = manifestJson.settings.map((s) => s.key).sort();
  assert.deepEqual(keys, ["accentColor", "devMode", "holdSeconds", "periodSeconds", "showQr", "visual"]);
  const used = [...source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)].map((m) => m[1]);
  for (const k of keys) assert.ok(used.includes(k), `réglage ${k} déclaré mais jamais lu`);
  assert.equal(manifestJson.settings.find((s) => s.key === "devMode").default, false);
  assert.deepEqual(manifestJson.settings.find((s) => s.key === "visual").options.map((o) => o.value), ["neon", "cine", "broadcast"]);
});

test("overlay : configuration par défaut", () => {
  const { out } = overlayOf();
  const c = cfgOf(out);
  assert.deepEqual(c, { itemsUrl: "/m/ticker/items?lang=en", period: 90, hold: 10, startDelay: 5, visual: "neon", showQr: true, seed: null, badge: "Sponsor", isNew: "New" });
  assert.equal(out.title, "Mon ticker");
  assert.match(out.html, /id="tk-stage"/);
  assert.match(out.html, /--ticker-accent:#e8a23b/);
});

test("overlay : langue du visiteur dans l'URL des éléments et les libellés", () => {
  const ctx = ctxFor("fr", { key: "ticker" });
  const c = cfgOf(def.overlay(ctx, { query: new URLSearchParams() }));
  assert.equal(c.itemsUrl, "/m/ticker/items?lang=fr");
  assert.equal(c.isNew, "Nouveau");
});

test("overlay : réglages bornés (période 5-3600 s, durée 3-120 s), style inconnu → néon, QR désactivable", () => {
  assert.deepEqual([cfgOf(overlayOf({ periodSeconds: 1, holdSeconds: 1 }).out).period, cfgOf(overlayOf({ periodSeconds: 1, holdSeconds: 1 }).out).hold], [5, 3]);
  const big = cfgOf(overlayOf({ periodSeconds: 99999, holdSeconds: 99999 }).out);
  assert.deepEqual([big.period, big.hold], [3600, 120]);
  const junk = cfgOf(overlayOf({ periodSeconds: "abc", holdSeconds: null, visual: "<x>" }).out);
  assert.deepEqual([junk.period, junk.hold, junk.visual], [90, 10, "neon"]);
  assert.equal(cfgOf(overlayOf({ visual: "broadcast" }).out).visual, "broadcast");
  assert.equal(cfgOf(overlayOf({ showQr: false }).out).showQr, false);
  assert.equal(cfgOf(overlayOf({ showQr: undefined }).out).showQr, true);
});

test("overlay : couleur d'accent hexadécimale seulement (aucune injection CSS/HTML)", () => {
  assert.match(overlayOf({ accentColor: "#12abEF" }).out.html, /--ticker-accent:#12abEF[;"]/);
  for (const bad of ['red;}</style><script>x</script>', '#fff', 'url(javascript:1)', '"><img src=x>', 42]) {
    const { out } = overlayOf({ accentColor: bad });
    assert.match(out.html, /--ticker-accent:#e8a23b[;"]/, String(bad));
    assert.ok(!out.html.includes("<img") && !out.css.includes("javascript:"));
  }
});

test("mode développeur : paramètres d'URL ignorés tant que le réglage est désactivé", () => {
  const c = cfgOf(overlayOf({}, "dev=1&seed=42").out);
  assert.equal(c.seed, null);
  assert.equal(c.period, 90);
  assert.equal(c.startDelay, 5);
});

test("mode développeur : ?dev=1 accélère (0,5 s / 4 s / 2,5 s), ?seed=N fixe la graine", () => {
  const fast = cfgOf(overlayOf({ devMode: true }, "dev=1").out);
  assert.deepEqual([fast.startDelay, fast.period, fast.hold, fast.seed], [0.5, 4, 2.5, null]);
  const seeded = cfgOf(overlayOf({ devMode: true }, "seed=42").out);
  assert.deepEqual([seeded.seed, seeded.period, seeded.startDelay], [42, 90, 5]);
  const both = cfgOf(overlayOf({ devMode: true }, "dev=1&seed=7").out);
  assert.deepEqual([both.seed, both.period], [7, 4]);
  assert.equal(cfgOf(overlayOf({ devMode: true }, "seed=3.9").out).seed, 3, "graine entière");
  assert.equal(cfgOf(overlayOf({ devMode: true }, "seed=-5").out).seed, -5);
  assert.equal(cfgOf(overlayOf({ devMode: true }, "seed=abc").out).seed, null);
  assert.equal(cfgOf(overlayOf({ devMode: true }, "dev=0").out).period, 90);
  assert.equal(cfgOf(overlayOf({ devMode: true }, "").out).seed, null);
});

test("JSON dans le script : `</script>` et `<!--` dans un libellé ne peuvent pas en sortir", () => {
  const evil = "</script><script>alert(1)</script><!--";
  const { out } = overlayOf({}, "", { messages: { badge: evil, new: evil } });
  const head = out.script.split(",slider=")[0];
  assert.ok(!head.includes("<"), "aucun `<` brut dans la configuration");
  assert.ok(!/<\/script/i.test(out.script));
  assert.equal(cfgOf(out).badge, evil, "mais la valeur est restituée intacte une fois lue");
});

test("script : syntaxe JavaScript valide, graine reproductible (même suite avec la même graine)", () => {
  const { out } = overlayOf({ devMode: true }, "seed=123");
  assert.doesNotThrow(() => new vm.Script(out.script));
  // On rejoue le générateur embarqué avec deux graines identiques / différentes.
  const gen = (seed) => {
    const src = out.script.match(/var rnd=Math\.random;if\(c\.seed!==null\)\{(.*?)\}\s*\n/s)[1];
    const sandbox = { c: { seed }, rnd: null };
    vm.runInNewContext(src, sandbox);
    return Array.from({ length: 5 }, () => sandbox.rnd());
  };
  assert.deepEqual(gen(123), gen(123));
  assert.notDeepEqual(gen(123), gen(124));
  for (const n of gen(5)) assert.ok(n >= 0 && n < 1);
});

test("script : le contenu venu du serveur est inséré en texte (textContent), jamais en HTML — sauf le QR généré par le cœur", () => {
  const { out } = overlayOf();
  assert.ok(!/\.innerHTML\s*=/.test(out.script.replace("q.innerHTML=s.qrSvg", "")), "innerHTML uniquement pour le QR");
  assert.match(out.script, /q\.innerHTML=s\.qrSvg/);
  assert.match(out.script, /textContent=text/);
});

test("overlay : fond transparent pour OBS, respect de prefers-reduced-motion", () => {
  const { out } = overlayOf();
  assert.match(out.css, /background:transparent/);
  assert.match(out.css, /prefers-reduced-motion/);
});

// ── route items ───────────────────────────────────────────────────────────────
const itemsOf = async (topics, opts = {}) => {
  const ctx = ctxFor("en", { key: "ticker", topics, ...opts });
  const res = await def.routes.items(new Request("https://example.test/m/ticker/items"), ctx);
  return { ctx, res, body: await res.json() };
};

test("items : aucune source → liste vide en JSON, jamais mise en cache", async () => {
  const { res, body } = await itemsOf({});
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(res.headers.get("content-type"), /json/);
  assert.deepEqual(body, { items: [] });
});

test("items : cartes sponsor.card — id, valeurs absentes → null, QR de l'URL, logo filtré", async () => {
  const { ctx, body } = await itemsOf({
    "sponsor.card": [
      { id: "a", name: "Acme", text: "Super", url: "https://acme.test", code: "ACME10", logo: "https://img.test/l.png", publishedAt: "2026-01-01T00:00:00.000Z" },
      { name: "Sans id", logo: "javascript:alert(1)" },
      { id: "c", name: "Upload", logo: "/uploads/x.png", url: "https://c.test" },
      { id: "d", name: "Data", logo: "data:image/png;base64,AAAA" },
    ],
  });
  const [a, b, c, d] = body.items;
  assert.deepEqual(a, { id: "s:a", name: "Acme", text: "Super", url: "https://acme.test", code: "ACME10", logo: "https://img.test/l.png", publishedAt: "2026-01-01T00:00:00.000Z", qrSvg: '<svg data-qr="https://acme.test"></svg>' });
  assert.equal(b.id, "s:Sans id", "sans id : repli sur le nom");
  assert.deepEqual([b.text, b.url, b.code, b.logo, b.publishedAt, b.qrSvg], ["", null, null, null, null, null]);
  assert.equal(c.logo, "/uploads/x.png");
  assert.equal(d.logo, null, "data: refusé");
  assert.deepEqual(ctx.calls.qr, ["https://acme.test", "https://c.test"], "un QR seulement pour ce qui a une URL");
});

test("items : entrées core.entry — seules celles avec code ou lien, URL de repli = page du site", async () => {
  const { body } = await itemsOf({
    "core.entry": [
      { path: "/blog/a", title: "Article", summary: "x" },
      { path: "/codes/b", title: "Code", summary: "Promo", code: "XYZ", cover: "/uploads/c.png", publishedAt: "2026-02-02T00:00:00.000Z" },
      { path: "/links/c", title: "Lien", url: "https://ext.test/p", cover: "javascript:1" },
    ],
  });
  assert.deepEqual(body.items.map((i) => i.id), ["e:/codes/b", "e:/links/c"]);
  const [code, link] = body.items;
  assert.equal(code.url, "https://example.test/codes/b");
  assert.equal(code.code, "XYZ"); assert.equal(code.logo, "/uploads/c.png");
  assert.equal(link.url, "https://ext.test/p"); assert.equal(link.logo, null); assert.equal(link.code, null);
});

test("items : sponsors d'abord puis entrées ; limites de collecte demandées (60) ; textes bruts conservés", async () => {
  const { ctx, body } = await itemsOf({ "sponsor.card": [{ id: "1", name: "<b>S</b>", text: "<i>t</i>" }], "core.entry": [{ path: "/p", title: "E", code: "C" }] });
  assert.deepEqual(body.items.map((i) => i.id), ["s:1", "e:/p"]);
  assert.equal(body.items[0].name, "<b>S</b>", "pas d'interprétation HTML côté serveur ; le client utilise textContent");
  assert.deepEqual(ctx.calls.topics.map((c) => c.join(":") === "" ? c : [c[0], c[1].limit]).sort(), [["core.entry", 60], ["sponsor.card", 60]]);
});

test("items : une URL dangereuse n'est jamais transformée en lien cliquable (seul le nom de domaine est affiché)", async () => {
  const { body } = await itemsOf({ "sponsor.card": [{ id: "1", name: "X", url: "javascript:alert(1)" }] });
  assert.ok(!/^javascript:/i.test(String(body.items[0].url)));
});
