import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/maze-overlay", import.meta.url).pathname;
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
  assert.equal(r.manifest.id, "maze-overlay");
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
const def = (await import("../modules/maze-overlay/index.mjs")).default;
const R = await import("../modules/maze-overlay/web/random.js");
const G = await import("../modules/maze-overlay/web/generate.js");
const T = await import("../modules/maze-overlay/web/types.js");
const E = await import("../modules/maze-overlay/web/embed.js");

const overlayOf = (settings = {}, query = "", opts = {}) => {
  const ctx = ctxFor("en", { key: "maze", name: "Mon labyrinthe", settings, ...opts });
  return { ctx, out: def.overlay(ctx, { query: new URLSearchParams(query) }) };
};
/** Configuration insérée dans le script : `window.__MAZE__=<json>;import(...)`. */
const cfgOf = (out) => {
  const m = out.script.match(/^window\.__MAZE__=(\{.*\});import\("\/m\/maze\/main\.js"\);$/s);
  assert.ok(m, "script au format attendu");
  return JSON.parse(m[1]);
};

test("manifeste : overlay, sujets consommés, route par fichier web/*.js + items, réglages tous lus par le code", () => {
  assert.equal(manifestJson.type, "overlay");
  assert.deepEqual(manifestJson.consumes.map((c) => c.topic).sort(), ["core.entry", "maze.poster"]);
  assert.deepEqual(manifestJson.permissions.sort(), ["admin", "overlay", "routes", "storage", "topics"]);
  const webFiles = fs.readdirSync(`${DIR}/web`).filter((f) => /^[a-z-]+\.js$/.test(f));
  assert.deepEqual(Object.keys(def.routes).sort(), [...webFiles, "items", "map"].sort());
  for (const s of manifestJson.settings) assert.ok(source.includes(`"${s.key}"`), `réglage ${s.key} jamais lu`);
  assert.equal(manifestJson.settings.find((s) => s.key === "devMode").default, false);
  assert.deepEqual(manifestJson.settings.find((s) => s.key === "size").options.map((o) => o.value), ["small", "medium", "large"]);
  assert.deepEqual(manifestJson.consumes[1].schema.map((s) => s.key).sort(), ["badge", "image", "kind", "text", "title", "url"]);
  const en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8")), fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort(), "parité en/fr");
  for (const m of source.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in en, m[1]);
  for (const k of ["errInvalid", "errNoPath", "errTooBig"]) assert.ok(k in en, k);
});

test("routes web : chaque fichier est servi en JavaScript, sans cache, avec son contenu exact", async () => {
  for (const f of fs.readdirSync(`${DIR}/web`).filter((x) => x.endsWith(".js"))) {
    const res = def.routes[f]();
    assert.equal(res.headers.get("content-type"), "text/javascript; charset=utf-8", f);
    assert.equal(res.headers.get("cache-control"), "no-cache");
    assert.equal(await res.text(), fs.readFileSync(`${DIR}/web/${f}`, "utf8"), f);
  }
  assert.equal(def.routes["../index.mjs"], undefined, "rien en dehors de web/");
  assert.equal(def.routes["index.mjs"], undefined);
});

test("overlay : configuration par défaut", () => {
  const { out } = overlayOf();
  assert.deepEqual(cfgOf(out), { itemsUrl: "/m/maze/items?lang=en", mapUrl: "/m/maze/map", size: "medium", moveSpeed: 1.4, turnSpeed: 220, stopMin: 12, stopMax: 25, hold: 8, fov: 66, accent: "#e8a23b", wallColor: "#2a2118", floorColor: "#181310", wall: [], floor: [], portal: [], hands: null, dev: null });
  assert.equal(out.title, "Mon labyrinthe");
  assert.match(out.html, /id="vm-canvas"/);
  assert.match(out.css, /border:2px solid #e8a23b/);
  assert.doesNotThrow(() => new vm.Script(out.script.replace(/;import\(.*$/s, ";")));
});

test("overlay : valeurs bornées (vitesse, rotation, pauses, durée, champ de vision) et taille inconnue → moyen", () => {
  const lo = cfgOf(overlayOf({ moveSpeed: 0.01, turnSpeed: 1, stopMin: 0.5, stopMax: 1, hold: 1, fov: 1 }).out);
  assert.deepEqual([lo.moveSpeed, lo.turnSpeed, lo.stopMin, lo.stopMax, lo.hold, lo.fov], [0.2, 30, 2, 3, 3, 40]);
  const hi = cfgOf(overlayOf({ moveSpeed: 99, turnSpeed: 9999, stopMin: 9999, stopMax: 9999, hold: 999, fov: 999 }).out);
  assert.deepEqual([hi.moveSpeed, hi.turnSpeed, hi.stopMin, hi.stopMax, hi.hold, hi.fov], [5, 720, 300, 600, 60, 120]);
  const junk = cfgOf(overlayOf({ moveSpeed: "abc", hold: null, size: "gigantic" }).out);
  assert.deepEqual([junk.moveSpeed, junk.hold, junk.size], [1.4, 8, "medium"]);
  for (const size of ["small", "medium", "large"]) assert.equal(cfgOf(overlayOf({ size }).out).size, size);
});

test("overlay : textures — seulement http(s) ou /uploads/, 4 murs supplémentaires max, une seule main", () => {
  const extra = ["https://a.test/1.png", "  /uploads/2.png ", "javascript:alert(1)", "data:image/png;base64,AAA", "//evil.test/x.png", "/etc/passwd", "", "http://b.test/3.png", "https://c.test/4.png", "https://d.test/5.png"].join("\n");
  const c = cfgOf(overlayOf({ wallTexture: "https://w.test/w.png", extraWall: extra, floorTexture: "javascript:1", portalTexture: "/uploads/p.png", handsSprite: "https://h.test/h.png" }).out);
  assert.deepEqual(c.wall, ["https://w.test/w.png", "https://a.test/1.png", "/uploads/2.png", "http://b.test/3.png", "https://c.test/4.png"]);
  assert.deepEqual(c.floor, []);
  assert.deepEqual(c.portal, ["/uploads/p.png"]);
  assert.equal(c.hands, "https://h.test/h.png");
  assert.equal(cfgOf(overlayOf({ handsSprite: "javascript:1" }).out).hands, null);
});

test("overlay : couleur d'accent hexadécimale seulement (aucune injection dans le CSS)", () => {
  assert.match(overlayOf({ accent: "#0A1b2C" }).out.css, /border:2px solid #0A1b2C/);
  for (const bad of ["red", "#abc", "#12345g", "}</style><script>alert(1)</script>", 7]) {
    const { out } = overlayOf({ accent: bad });
    assert.match(out.css, /border:2px solid #e8a23b/, String(bad));
    assert.ok(!out.css.includes("<script>"));
    assert.equal(cfgOf(out).accent, "#e8a23b");
  }
});

test("overlay : `</script>` dans un réglage ne peut pas sortir de la balise script (< échappé)", () => {
  const evil = "https://x.test/</script><script>alert(1)</script>.png";
  const { out } = overlayOf({ wallTexture: evil, extraWall: evil });
  assert.ok(!/<\/script/i.test(out.script) && !out.script.includes("<"), "aucun `<` brut");
  assert.deepEqual(cfgOf(out).wall, [evil, evil], "valeur intacte une fois décodée");
});

test("mode développeur : paramètres ignorés si le réglage est désactivé", () => {
  assert.equal(cfgOf(overlayOf({}, "dev=1&seed=42&luck=always&fast=1").out).dev, null);
});

test("mode développeur : seed / luck / fast / dev et leurs combinaisons", () => {
  const dev = (q) => cfgOf(overlayOf({ devMode: true }, q).out).dev;
  assert.deepEqual(dev(""), { fast: false });
  assert.deepEqual(dev("seed=42"), { seed: 42, fast: false });
  assert.deepEqual(dev("dev=1"), { luck: "always", fast: true });
  assert.deepEqual(dev("dev=1&luck=never"), { luck: "never", fast: true });
  assert.deepEqual(dev("dev=1&seed=7"), { seed: 7, luck: "always", fast: true });
  assert.deepEqual(dev("luck=0.3"), { luck: 0.3, fast: false });
  assert.deepEqual(dev("fast=1"), { fast: true });
  assert.deepEqual(dev("seed=3.9"), { seed: 3, fast: false });
  assert.deepEqual(dev("seed=abc&luck=peut-etre"), { fast: false }, "valeurs invalides ignorées");
  assert.deepEqual(dev("fast=0"), { fast: false });
});

// ── route items ───────────────────────────────────────────────────────────────
const itemsOf = async (topics, opts = {}) => {
  const ctx = ctxFor("en", { key: "maze", topics, site: { name: "S", tagline: "", logo: "/uploads/logo.png" }, ...opts });
  const res = await def.routes.items(new Request("https://example.test/m/maze/items"), ctx);
  return { ctx, res, body: await res.json() };
};

test("items : aucune source → liste vide, logo du site, jamais mis en cache", async () => {
  const { res, body } = await itemsOf({});
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(body, { items: [], logoUrl: "/uploads/logo.png" });
});

test("items : entrées core.entry → code ou article, URL de repli sur le site, couverture filtrée, QR", async () => {
  const { ctx, body } = await itemsOf({
    "core.entry": [
      { title: "Promo", summary: "S", path: "/codes/a", code: "ABC", cover: "/uploads/c.png" },
      { title: "Billet", path: "/blog/b", url: "https://ext.test/x", cover: "javascript:alert(1)" },
    ],
  });
  assert.deepEqual(body.items[0], { kind: "code", title: "Promo", text: "S", url: "https://example.test/codes/a", imageUrl: "/uploads/c.png", qrSvg: '<svg data-qr="https://example.test/codes/a"></svg>' });
  assert.equal(body.items[1].kind, "article");
  assert.equal(body.items[1].text, "");
  assert.equal(body.items[1].url, "https://ext.test/x");
  assert.equal(body.items[1].imageUrl, null);
  assert.deepEqual(ctx.calls.qr, ["https://example.test/codes/a", "https://ext.test/x"]);
});

test("items : affiches maze.poster — genre par défaut article, badge, URL par défaut = site, textes bruts", async () => {
  const { body } = await itemsOf({
    "maze.poster": [
      { title: "<b>Clip</b>", text: "<i>x</i>", kind: "clip", badge: "NOUVEAU", url: "https://twitch.tv/clip/abc", image: "https://img.test/t.jpg" },
      { title: "Sans rien" },
    ],
  });
  assert.deepEqual(body.items[0], { kind: "clip", badge: "NOUVEAU", title: "<b>Clip</b>", text: "<i>x</i>", url: "https://twitch.tv/clip/abc", imageUrl: "https://img.test/t.jpg", qrSvg: '<svg data-qr="https://twitch.tv/clip/abc"></svg>' });
  assert.equal(body.items[1].kind, "article");
  assert.equal(body.items[1].url, "https://example.test");
  assert.equal(body.items[1].badge, undefined);
  assert.equal(body.items[1].imageUrl, null);
});

test("items : entrées d'abord puis affiches ; 60 éléments maximum demandés par sujet", async () => {
  const { ctx, body } = await itemsOf({ "core.entry": [{ title: "E", path: "/e" }], "maze.poster": [{ title: "P" }] });
  assert.deepEqual(body.items.map((i) => i.title), ["E", "P"]);
  assert.deepEqual(ctx.calls.topics.map((c) => [c[0], c[1].limit]).sort(), [["core.entry", 60], ["maze.poster", 60]]);
});

test("items : une URL d'affiche dangereuse n'est relayée telle quelle ni au QR ni au client", async () => {
  const { body } = await itemsOf({ "maze.poster": [{ title: "X", url: "javascript:alert(1)" }] });
  assert.ok(!/^javascript:/i.test(String(body.items[0].url)));
});

test("items : image protocole-relatif `//hôte/x` refusée", async () => {
  const { body } = await itemsOf({ "maze.poster": [{ title: "X", image: "//evil.test/x.png" }] });
  assert.equal(body.items[0].imageUrl, null);
});

// ── hasard déterministe ───────────────────────────────────────────────────────
const draw = (n) => Array.from({ length: n }, () => R.random());

test("random : même graine → même suite, graines différentes → suites différentes, valeurs dans [0, 1[", () => {
  R.configureRandom({ seed: 42 }); const a = draw(20);
  R.configureRandom({ seed: 42 }); const b = draw(20);
  R.configureRandom({ seed: 43 }); const c = draw(20);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  for (const n of [...a, ...c]) assert.ok(n >= 0 && n < 1);
  assert.equal(R.getSeed(), 43);
  R.configureRandom(null);
});

test("random : valeurs de référence de Mulberry32 (non-régression de l'algorithme)", () => {
  R.configureRandom({ seed: 1 });
  const first = draw(3);
  R.configureRandom({ seed: 1 });
  assert.deepEqual(draw(3), first);
  // Mulberry32(1) : 0.6270739405881613, 0.002735721180215478, 0.5274470399599522
  assert.ok(Math.abs(first[0] - 0.6270739405881613) < 1e-12, String(first[0]));
  assert.ok(Math.abs(first[1] - 0.002735721180215478) < 1e-12, String(first[1]));
  R.configureRandom(null);
});

test("random : sans configuration, aucune graine ; configureRandom(null) réinitialise tout", () => {
  R.configureRandom({ seed: 9, luck: "always", fast: true });
  assert.equal(R.getSeed(), 9);
  const real = Math.random; let called = 0;
  Math.random = () => { called++; return 0.25; };
  try {
  R.configureRandom(null);
  assert.equal(R.getSeed(), null);
  assert.notEqual(R.random("timing"), 0, "plus de délais figés");
  called = 0;
  assert.equal(R.random(), 0.25); assert.equal(R.roll(0.5), true); assert.equal(R.roll(0.1), false); } finally { Math.random = real; }
  assert.equal(called, 3, "production = Math.random");
});

test("random : luck always/never/nombre et fast figent les tirages d'arrêt et de délai", () => {
  R.configureRandom({ luck: "always" }); assert.ok(Array.from({ length: 50 }, () => R.roll(0)).every(Boolean));
  R.configureRandom({ luck: "never" }); assert.ok(Array.from({ length: 50 }, () => R.roll(1)).every((v) => !v));
  R.configureRandom({ luck: 0 }); assert.equal(R.roll(1), false);
  R.configureRandom({ luck: 1.5 }); // hors plage : ignoré, retombe sur la probabilité demandée
  assert.equal(R.roll(1), true); assert.equal(R.roll(0), false);
  R.configureRandom({ luck: "peut-etre" }); assert.equal(R.roll(1), true);
  R.configureRandom({ fast: true }); assert.equal(R.random("timing"), 0); assert.notEqual(R.random(), 0);
  R.configureRandom({ fast: "true" }); assert.notEqual(R.random("timing"), 0, "fast strictement booléen");
  R.configureRandom({ seed: Number.NaN }); assert.equal(R.getSeed(), null);
  R.configureRandom(null);
});

test("random : roll consomme un tirage de la suite même quand la chance est forcée", () => {
  R.configureRandom({ seed: 5, luck: "always" });
  R.roll(0.1); const after = R.random();
  R.configureRandom({ seed: 5 });
  draw(1);
  assert.equal(R.random(), after);
  R.configureRandom(null);
});

// ── génération du labyrinthe ──────────────────────────────────────────────────
const counts = (grid) => { const c = {}; for (const v of grid.walls) c[v] = (c[v] ?? 0) + 1; return c; };
const reachable = (grid) => {
  const start = grid.walls.findIndex((v) => v === T.CELL_PATH);
  const seen = new Set([start]); const queue = [start];
  while (queue.length) {
    const i = queue.pop(); const x = i % grid.width, y = (i / grid.width) | 0;
    for (const d of T.DIRECTIONS) {
      if (!G.isOpen(grid, x + d.x, y + d.y)) continue;
      const j = (y + d.y) * grid.width + x + d.x;
      if (!seen.has(j)) { seen.add(j); queue.push(j); }
    }
  }
  return seen;
};

test("génération : dimensions selon la taille, aucun couloir sur l'enceinte, 4 types de cases seulement", () => {
  R.configureRandom({ seed: 1 });
  for (const size of ["small", "medium", "large"]) {
    const g = G.generateMaze(size);
    const n = T.SIZE_CELLS[size] * 2 + 1;
    assert.deepEqual([g.width, g.height, g.walls.length], [n, n, n * n], size);
    for (let i = 0; i < n; i++) for (const [x, y] of [[i, 0], [i, n - 1], [0, i], [n - 1, i]]) assert.notEqual(g.walls[y * n + x], T.CELL_PATH, `bord ${x},${y} : aucun couloir sur l'enceinte`);
    assert.ok(g.walls.every((v) => v >= 0 && v <= 3));
  }
  R.configureRandom(null);
});

test("génération : même graine → même labyrinthe, graines différentes → labyrinthes différents", () => {
  const gen = (seed, size = "medium") => { R.configureRandom({ seed }); return Array.from(G.generateMaze(size).walls).join(""); };
  assert.equal(gen(42), gen(42));
  assert.equal(gen(7, "large"), gen(7, "large"));
  const variants = new Set([1, 2, 3, 4, 5].map((s) => gen(s)));
  assert.ok(variants.size >= 4);
  R.configureRandom(null);
});

test("génération : tout chemin est atteignable, au moins 3 affiches, portails dans les bornes de la taille", () => {
  const bounds = { small: [1, 2], medium: [2, 3], large: [2, 4] };
  for (const size of ["small", "medium", "large"]) for (const seed of [1, 2, 3, 99, 12345]) {
    R.configureRandom({ seed });
    const g = G.generateMaze(size);
    const open = g.walls.reduce((n, v) => n + (v === T.CELL_PATH || v === T.CELL_PORTAL ? 1 : 0), 0);
    assert.equal(reachable(g).size, open, `${size}/${seed} : labyrinthe connexe`);
    const c = counts(g);
    assert.ok((c[T.CELL_PROMO] ?? 0) >= 3, `${size}/${seed} : affiches`);
    const [lo, hi] = bounds[size];
    assert.ok(c[T.CELL_PORTAL] >= lo && c[T.CELL_PORTAL] <= hi, `${size}/${seed} : ${c[T.CELL_PORTAL]} portails`);
  }
  R.configureRandom(null);
});

test("génération : affiches et portails sont toujours des murs adjacents à un chemin", () => {
  R.configureRandom({ seed: 77 });
  const g = G.generateMaze("medium");
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) {
    if (!G.isPromoCell(g, x, y) && !G.isPortalCell(g, x, y)) continue;
    assert.ok(T.DIRECTIONS.some((d) => g.walls[(y + d.y) * g.width + x + d.x] === T.CELL_PATH), `case ${x},${y} isolée`);
  }
  R.configureRandom(null);
});

test("grille : isOpen / isPromoCell / isPortalCell hors limites = faux ; sérialisation aller-retour ; case de départ ouverte", () => {
  R.configureRandom({ seed: 3 });
  const g = G.generateMaze("small");
  for (const [x, y] of [[-1, 0], [0, -1], [g.width, 0], [0, g.height]]) assert.deepEqual([G.isOpen(g, x, y), G.isPromoCell(g, x, y), G.isPortalCell(g, x, y)], [false, false, false]);
  const copy = G.deserializeMazeGrid(JSON.parse(JSON.stringify(G.serializeMazeGrid(g))));
  assert.deepEqual(Array.from(copy.walls), Array.from(g.walls));
  assert.ok(copy.walls instanceof Uint8Array);
  const cell = G.randomOpenCell(g);
  assert.equal(g.walls[cell.y * g.width + cell.x], T.CELL_PATH);
  R.configureRandom({ seed: 3 }); G.generateMaze("small");
  const p1 = G.randomOpenCell(g);
  R.configureRandom({ seed: 3 }); G.generateMaze("small");
  assert.deepEqual(G.randomOpenCell(g), p1, "point de départ reproductible");
  R.configureRandom(null);
});

// ── liens vidéo (embed.js) ────────────────────────────────────────────────────
test("embed YouTube : youtu.be, watch?v=, shorts → identifiant, miniature et URL d'embed", () => {
  assert.equal(E.getYouTubeVideoId("https://youtu.be/abc123"), "abc123");
  assert.equal(E.getYouTubeVideoId("https://www.youtube.com/watch?v=xyz789&t=3"), "xyz789");
  assert.equal(E.getYouTubeVideoId("https://www.youtube.com/shorts/short1?feature=share"), "short1");
  assert.equal(E.getYouTubeEmbedUrl("https://youtu.be/abc123"), "https://www.youtube.com/embed/abc123?autoplay=1&mute=1");
  assert.equal(E.getYouTubeThumbnailUrl("https://youtu.be/abc123"), "https://img.youtube.com/vi/abc123/hqdefault.jpg");
});

test("embed YouTube : adresses invalides, autres sites ou dangereuses → null", () => {
  for (const u of ["", "pas une url", "javascript:alert(1)", "https://vimeo.com/123", "https://www.youtube.com/", "https://youtu.be/"]) {
    assert.equal(E.getYouTubeVideoId(u), null, u);
    assert.equal(E.getYouTubeEmbedUrl(u), null, u);
    assert.equal(E.getYouTubeThumbnailUrl(u), null, u);
  }
});

test("embed YouTube : l'hôte doit être YouTube (pas un domaine qui le contient)", () => {
  assert.equal(E.getYouTubeVideoId("https://youtube.com.evil.test/watch?v=abc"), null);
  assert.equal(E.getYouTubeVideoId("https://notyoutu.be.evil.test/abc"), null);
});

test("embed YouTube : l'identifiant ne peut pas sortir du chemin /embed/ (caractères interdits)", () => {
  const url = E.getYouTubeEmbedUrl("https://www.youtube.com/watch?v=" + encodeURIComponent("../x?y"));
  assert.ok(url === null || /^https:\/\/www\.youtube\.com\/embed\/[\w-]+\?autoplay=1&mute=1$/.test(url), String(url));
});

test("embed Twitch : clip par clips.twitch.tv ou /clip/<slug>, parent obligatoire", () => {
  assert.equal(E.getTwitchClipEmbedUrl("https://clips.twitch.tv/FunnySlug-abc", "site.test"), "https://clips.twitch.tv/embed?clip=FunnySlug-abc&parent=site.test&autoplay=true&muted=true");
  assert.equal(E.getTwitchClipEmbedUrl("https://www.twitch.tv/chaine/clip/Slug2?filter=clips", "site.test"), "https://clips.twitch.tv/embed?clip=Slug2&parent=site.test&autoplay=true&muted=true");
  assert.equal(E.getTwitchClipEmbedUrl("https://clips.twitch.tv/Slug", ""), null);
  assert.equal(E.getTwitchClipEmbedUrl("https://clips.twitch.tv/Slug", null), null);
  for (const u of ["", "nope", "https://www.twitch.tv/chaine", "https://clips.twitch.tv/", "javascript:alert(1)"]) assert.equal(E.getTwitchClipEmbedUrl(u, "site.test"), null, u);
});

// ── Tracé personnalisé (éditeur de grille de l'admin) ────────────────────────────────────────────────────────────
const P = def.adminActions;
const mazeCtx = (settings = {}) => ctxFor("en", { key: "maze", settings });
const form = (width, height, cells) => ({ width: String(width), height: String(height), cells });
const grid5 = "0".repeat(25).split("").map((_, i) => (i === 12 ? "1" : "0")).join("");

test("tracé : validation — taille bornée, un chiffre 0-3 par case, au moins un chemin", async () => {
  const { parseMap } = await import("../modules/maze-overlay/index.mjs");
  assert.deepEqual(parseMap(form(5, 5, grid5)), { width: 5, height: 5, cells: grid5 });
  for (const [v, err] of [[form(4, 5, grid5), "errTooBig"], [form(42, 5, grid5), "errTooBig"], [form("x", 5, grid5), "errTooBig"], [form(5, 5, grid5.slice(1)), "errInvalid"], [form(5, 5, "9".repeat(25)), "errInvalid"], [form(5, 5, "a".repeat(25)), "errInvalid"], [form(5, 5, "0".repeat(25)), "errNoPath"], [{}, "errTooBig"]]) assert.equal(parseMap(v).error, err, JSON.stringify(v).slice(0, 60));
});

test("tracé : enregistrer, relire par la route /map, remplacer (un seul tracé), enregistrer `auto` supprime le tracé", async () => {
  const c = mazeCtx();
  assert.deepEqual(await (await def.routes.map(new Request("https://x.test/m/maze/map"), c)).json(), { grid: null });
  assert.equal((await P.saveMap(c, form(5, 5, grid5))).ok, "Layout saved.");
  const out = await (await def.routes.map(new Request("https://x.test/m/maze/map"), c)).json();
  assert.deepEqual([out.grid.width, out.grid.height, out.grid.walls.length, out.grid.walls[12]], [5, 5, 25, 1]);
  assert.ok(out.grid.walls.every((n) => Number.isInteger(n)));
  assert.ok((await P.saveMap(c, form(5, 5, "0".repeat(25)))).error, "tracé sans chemin refusé");
  await P.saveMap(c, form(6, 5, grid5 + "1".repeat(5)));
  assert.equal(await c.api.store.count("map"), 1, "un seul tracé par instance");
  assert.equal((await P.saveMap(c, { auto: "true" })).ok, "Back to the automatic layout.");
  assert.equal(await c.api.store.count("map"), 0);
  assert.equal((await P.saveMap(c, { auto: "true" })).ok, "Back to the automatic layout.", "sans tracé : sans effet, sans erreur");
});

test("tracé : `auto` prime sur la grille postée, mais seule la valeur exacte « true » compte ; les validations de la grille sont conservées", async () => {
  const c = mazeCtx();
  await P.saveMap(c, form(5, 5, grid5));
  assert.ok((await P.saveMap(c, { ...form(5, 5, "0".repeat(25)), auto: "false" })).error, "auto≠true : la grille est validée (aucun chemin)");
  assert.equal(await c.api.store.count("map"), 1, "refus : le tracé enregistré est intact");
  assert.ok((await P.saveMap(c, { ...form(4, 5, grid5), auto: "" })).error);
  assert.ok((await P.saveMap(c, {})).error, "ni grille ni auto : refus");
  assert.equal(await c.api.store.count("map"), 1);
  assert.equal((await P.saveMap(c, { ...form(5, 5, grid5), auto: "true" })).ok, "Back to the automatic layout.");
  assert.equal(await c.api.store.count("map"), 0);
});

test("tracé : « générer » RENVOIE un tracé jouable (portails et affiches compris) à la taille réglée, sans rien enregistrer", async () => {
  const c = mazeCtx({ size: "small" });
  const res = await P.generate(c);
  assert.equal(res.redirect, undefined);
  assert.equal(res.ok, undefined);
  const { grid } = res;
  assert.equal(grid.width, 15);   // petit : 7 cellules → 15 cases
  assert.equal(grid.cells.length, grid.width * grid.height);
  assert.match(grid.cells, /^[0-3]+$/);
  assert.ok(grid.cells.includes("1"));
  assert.ok(grid.cells.includes("2") || grid.cells.includes("3"), "affiches ou portails présents");
  const { parseMap } = await import("../modules/maze-overlay/index.mjs");
  assert.ok(!parseMap(grid).error, "le tracé généré passe la validation d'enregistrement");
  assert.equal(await c.api.store.count("map"), 0, "rien n'est persisté par la génération");
  await P.saveMap(c, form(5, 5, grid5));
  await P.generate(c);
  const kept = await (await def.routes.map(new Request("https://x.test/m/maze/map"), c)).json();
  assert.equal(kept.grid.walls.join(""), grid5, "générer ne touche pas au tracé enregistré");
  assert.equal(P.clear, undefined, "l'ancien « clear » destructif a disparu");
});

test("tracé : panneau d'admin — un seul éditeur (aucun formulaire séparé) ; sans tracé il démarre en mode automatique, avec tracé il affiche le tracé enregistré", async () => {
  const c = mazeCtx();
  const none = await def.adminPanel(c);
  assert.deepEqual(none.filter((b) => b.type === "adminForm"), [], "plus de boutons « generate »/« clear » séparés");
  const e0 = none.find((b) => b.type === "gridEditor");
  assert.deepEqual([e0.action, e0.generateAction, e0.autoActive, e0.generateLabel, e0.width, e0.cells.length], ["saveMap", "generate", true, "Generate a random layout to edit", 15, 225]);
  await P.saveMap(c, form(5, 5, grid5));
  const some = await def.adminPanel(c);
  assert.deepEqual(some.filter((b) => b.type === "adminForm"), []);
  const editor = some.find((b) => b.type === "gridEditor");
  assert.deepEqual([editor.action, editor.width, editor.height, editor.cells, editor.palette.map((p) => p.value)], ["saveMap", 5, 5, grid5, ["0", "1", "2", "3"]]);
  assert.deepEqual([editor.autoActive, editor.generateAction, editor.generateLabel, editor.autoLabel], [false, "generate", "Generate a new random layout", "Delete the layout and randomize at every display"]);
  assert.match(editor.autoNotice, /Nothing changes until you save/);
  assert.ok(editor.labels.generateError);
  assert.equal(some.filter((b) => b.type === "markdown").length, 1);
  assert.match(some.find((b) => b.type === "markdown").text, /Custom layout in use/);
  assert.match(none.find((b) => b.type === "markdown").text, /No custom layout/);
});

test("tracé : textes fr — libellés demandés par le propriétaire", () => {
  const fr = loadMessages("fr");
  assert.equal(fr.generateAgain, "Générer un nouveau tracé au hasard");
  assert.equal(fr.generate, "Générer un tracé au hasard à retoucher");
  assert.equal(fr.clear, "Supprimer le tracé et randomiser à chaque affichage");
  assert.equal(fr.autoNotice, "Le labyrinthe sera généré au hasard à chaque affichage. Rien n'est changé tant que vous n'avez pas enregistré.");
  assert.equal(fr.saved, "Tracé enregistré.");
  assert.equal(fr.cleared, "Retour au tracé automatique.");
  assert.equal(fr.lblReset, "Annuler les modifications");
});

test("manifeste : le tracé dépend des nouvelles propriétés du bloc gridEditor → cœur 0.1.10 minimum", () => {
  assert.equal(manifestJson.minCore, "0.1.10");
  assert.equal(manifestJson.version, "1.0.1");
});

test("tracé : la page de l'overlay le réclame au démarrage (route /map), main.js retombe sur un tracé automatique s'il est invalide", () => {
  const { out } = overlayOf();
  assert.equal(cfgOf(out).mapUrl, "/m/maze/map");
  const main = fs.readFileSync(`${DIR}/web/main.js`, "utf8");
  assert.match(main, /\(await fetchCustomGrid\(\)\) \?\? generateMaze\(cfg\.size\)/);
  assert.match(main, /g\.walls\.length === g\.width \* g\.height && g\.walls\.includes\(1\)/);
});
