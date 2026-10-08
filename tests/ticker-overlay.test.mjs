import test from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./helpers/moduleLoader.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { assertValidManifest, assertDefinitionMatchesManifest, assertSettingsSane, assertLocalesParity, settingsDefaults } from "./helpers/builtinChecks.mjs";

const tk = await loadModule("modules/ticker-overlay");
const { definition: def, manifest, locales } = tk;
const defaults = settingsDefaults(manifest);
const ov = (settings = {}, o = {}) => def.overlay(fakeCtx({ key: "ticker", name: "Mon ticker", locale: "fr", settings: { ...defaults, ...settings }, ...o }), { query: new URLSearchParams() });

test("ticker-overlay : manifeste valide, type overlay, permissions overlay/routes/topics, aucune section", async () => {
  const m = await assertValidManifest(manifest);
  assertDefinitionMatchesManifest(m, def);
  assertSettingsSane(m);
  assert.equal(m.type, "overlay");
  assert.deepEqual(m.sections, []);
  assert.deepEqual([...m.permissions].sort(), ["overlay", "routes", "topics"]);
  assert.deepEqual(Object.keys(def.routes), ["items"]);
  assert.equal(typeof def.overlay, "function");
  assert.deepEqual(locales, {});
  assertLocalesParity(locales);
});

test("ticker-overlay : sujets consommés valides, schéma overlay.item avec titre obligatoire, tags sur core.entry", async () => {
  const m = await assertValidManifest(manifest);
  const by = Object.fromEntries(m.consumes.map((c) => [c.topic, c]));
  assert.deepEqual(Object.keys(by).sort(), ["core.entry", "overlay.item"]);
  assert.equal(by["core.entry"].tags, true);
  assert.deepEqual(by["overlay.item"].schema.filter((f) => f.required).map((f) => f.key), ["title"]);
  assert.deepEqual(by["overlay.item"].schema.filter((f) => f.type === "url").map((f) => f.key).sort(), ["image", "url"]);
});

test("ticker-overlay : défauts — 8 s, couleurs qui suivent le thème du site, bas gauche", () => {
  assert.deepEqual(defaults, { interval: 8, textColor: "theme:fg", cardColor: "theme:surface", position: "bottom-left" });
});

test("items : fusionne les entrées du cœur et les overlay.item", async () => {
  const ctx = fakeCtx({
    topics: {
      "core.entry": [
        { title: "Article", summary: "Résumé", cover: "https://cdn.test/a.png" },
        { title: "Promo", code: "ABC", summary: "ignoré", cover: "/uploads/p.png" },
      ],
      "overlay.item": [{ title: "Annonce", text: "Ce soir", image: "https://cdn.test/i.png" }, { title: "Seul" }],
    },
  });
  const res = await def.routes.items(new Request("https://x.test/m/t/items"), ctx);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual((await res.json()).items, [
    { title: "Article", subtitle: "Résumé", image: "https://cdn.test/a.png" },
    { title: "Promo", subtitle: "Code ABC", image: "/uploads/p.png" },
    { title: "Annonce", subtitle: "Ce soir", image: "https://cdn.test/i.png" },
    { title: "Seul", subtitle: "" },
  ]);
  assert.deepEqual(ctx.calls.topics.map((c) => c[0]).sort(), ["core.entry", "overlay.item"]);
});

test("items : aucun sujet alimenté → liste vide", async () => {
  const res = await def.routes.items(new Request("https://x.test/i"), fakeCtx());
  assert.deepEqual(await res.json(), { items: [] });
});

test("items : images non sûres écartées (javascript:, data:, //hôte, chemin non /uploads)", async () => {
  const bad = ["javascript:alert(1)", "data:image/svg+xml,<svg onload=alert(1)>", "//evil.test/x.png", "/etc/passwd", "ftp://x/y.png", 42, null, { a: 1 }];
  const ctx = fakeCtx({ topics: { "core.entry": bad.map((cover) => ({ title: "t", cover })), "overlay.item": bad.map((image) => ({ title: "t", image })) } });
  const { items } = await (await def.routes.items(new Request("https://x.test/i"), ctx)).json();
  assert.equal(items.length, bad.length * 2);
  for (const it of items) assert.ok(!("image" in it), JSON.stringify(it));
});

test("items : le texte reste une donnée JSON (balises non interprétées, types forcés en chaîne)", async () => {
  const evil = `</script><img src=x onerror=alert(1)>`;
  const ctx = fakeCtx({ topics: { "core.entry": [{ title: evil, summary: evil }], "overlay.item": [{ title: 12, text: undefined }] } });
  const { items } = await (await def.routes.items(new Request("https://x.test/i"), ctx)).json();
  assert.equal(items[0].title, evil);
  assert.deepEqual(items[1], { title: "12", subtitle: "" });
});

test("overlay : retourne titre d'instance, html, css et script ; le HTML est statique (aucune donnée utilisateur)", () => {
  const out = ov({}, { name: `<b>Nom</b>` });
  assert.equal(out.title, "<b>Nom</b>", "titre = donnée, échappée par la page d'overlay");
  assert.match(out.html, /id="vt-card"/);
  assert.ok(!out.html.includes("Nom"));
  assert.match(out.script, /^\(function\(\)\{var c=\{"url":"\/m\/ticker\/items\?lang=fr","ms":8000\}/);
  assert.match(out.css, /background:transparent/);
});

test("overlay : le script remplit le DOM avec textContent (jamais innerHTML) et n'affecte img.src qu'avec l'image reçue", () => {
  const { script } = ov();
  assert.ok(!/innerHTML|outerHTML|document\.write|eval\(/.test(script));
  assert.match(script, /t\.textContent=it\.title/);
  assert.match(script, /s\.textContent=/);
});

test("overlay : intervalle borné 2..120 s ; défaut 8 s si invalide", () => {
  const ms = (v) => Number(ov({ interval: v }).script.match(/"ms":(\d+)/)[1]);
  assert.equal(ms(1), 2000);
  assert.equal(ms(5), 5000);
  assert.equal(ms(100000), 120000);
  assert.equal(ms("abc"), 8000);
  assert.equal(ms(0), 8000);
  assert.equal(ms(undefined), 8000);
});

test("overlay : position → côté et sens ; inconnue → bas gauche", () => {
  const css = (p) => ov({ position: p }).css.match(/position:fixed;(\w+):32px;(\w+):32px/).slice(1, 3).join(",");
  assert.equal(css("bottom-left"), "left,bottom");
  assert.equal(css("bottom-right"), "right,bottom");
  assert.equal(css("top-left"), "left,top");
  assert.equal(css("top-right"), "right,top");
  assert.equal(css("n'importe quoi"), "left,bottom");
  assert.equal(css(undefined), "left,bottom");
});

test("overlay : couleurs — seuls #rrggbb acceptés, sinon défaut (pas d'injection CSS)", () => {
  let css = ov({ textColor: "#ff0000", cardColor: "#00ff00" }).css;
  assert.match(css, /background:#00ff00;color:#ff0000/);
  for (const evil of ["red", "#fff", "#12345g", "#ffffff;}body{display:none", "url(javascript:alert(1))", "expression(1)", 5, null]) {
    css = ov({ textColor: evil, cardColor: evil }).css;
    assert.match(css, /background:#1b1b1d;color:#f4f4f5/, String(evil));
    assert.ok(!css.includes("display:none") || css.includes("html,body"), String(evil));
    assert.ok(!/expression|javascript/.test(css));
  }
});

test("overlay : l'URL de rafraîchissement utilise la clé d'instance et la locale", () => {
  const url = JSON.parse(ov({}, { key: "abc", locale: "en" }).script.match(/var c=(\{.*?\}),card/)[1]).url;
  assert.equal(url, "/m/abc/items?lang=en");
});

test("overlay : injection </script> par la clé d'instance ou la locale neutralisée dans le script inline", () => {
  for (const o of [{ key: "x</script><script>alert(1)</script>" }, { locale: "</script><img src=x onerror=alert(1)>" }]) {
    const { script } = ov({}, o);
    assert.ok(!/<\/script/i.test(script), "aucun </script littéral dans le script inline");
    assert.ok(!/<!--/.test(script));
  }
});
