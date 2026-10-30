// Labyrinthe 3D (1.2.0) : l'ÉLÉMENT « Labyrinthe 3D » des pages d'overlay du cœur 0.5.0 (comportement « s'adapte au ratio », hauteur de référence 1080).
// Ce que ce fichier prouve : le manifeste et l'adresse, la géométrie du cœur à 3440×1440 / 21:9 (le rendu remplit son cadre), le champ de vision qui s'adapte au ratio SANS déformer
// (le moteur réel dessine, on compare les images), et la NON-RÉGRESSION de l'overlay existant (mêmes octets, 16:9 inchangé).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";
import { parseAddress } from "@/core/overlays/address";
import { frameLayout, constrainRect } from "@/core/overlays/layout";
import { MazeEngine } from "../modules/maze-overlay/web/engine.js";
import { configureRandom } from "../modules/maze-overlay/web/random.js";
import { gridFromAscii } from "./maze-sim.mjs";

const DIR = new URL("../modules/maze-overlay", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifestJson = readJson("module.json");
const def = (await import("../modules/maze-overlay/index.mjs")).default;
const golden = JSON.parse(fs.readFileSync(new URL("./fixtures/overlay-elements-golden.json", import.meta.url), "utf8")).maze;
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
const ctxFor = (settings = {}, key = "mz") => fakeCtx({ key, locale: "fr", messages: readJson("locales/fr.json"), settings });
const [decl] = manifestJson.overlayElements;
const cfgOf = (out) => JSON.parse(/window\.__MAZE__=(\{.*\});import/.exec(out.script)[1]);
const RATIO = (w, h) => new URLSearchParams({ "ov-w": String(w), "ov-h": String(h), "ov-fit": "ratio", "ov-lang": "fr" });

// ── Manifeste et adresse ─────────────────────────────────────────────────────────────────────────────────────────────────
test("manifeste : valide au sens du cœur 0.5.0, un élément « maze » qui s'adapte au ratio (hauteur 1080, de 4:3 à 32:9), ne suit pas le style commun", () => {
  const r = parseManifest(manifestJson);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifestJson.overlayElements.length, 1);
  assert.equal(decl.id, "maze");
  assert.equal(decl.fit, "ratio");
  assert.equal(decl.referenceHeight, 1080);
  assert.ok(decl.ratios.min <= 4 / 3 && decl.ratios.min >= 1.3, "4:3 est accepté");
  assert.ok(decl.ratios.max >= 32 / 9 && decl.ratios.max < 3.6, "32:9 est accepté");
  assert.equal(decl.followsStyle, false, "une scène 3D ne suit pas le style commun et le dit");
  assert.equal((decl.options ?? []).length, 0, "aucune option : le contenu et l'apparence restent réglés dans le module");
  for (const k of ["label", "description"]) assert.ok(decl[k].fr && decl[k].en, k);
  assert.deepEqual(Object.keys(def.overlayElements), ["maze"]);
});

test("adresse de l'élément : l'adresse de l'overlay (c'est la seule du module), avec la langue seulement si elle est valable ; acceptée par le cœur", () => {
  const c = ctxFor();
  const a = def.overlayElements.maze(c, { element: "maze", fit: "ratio", width: 2580, height: 1080, style: null, options: {}, lang: "en" });
  assert.deepEqual(a, { url: "/overlays/mz?lang=en" });
  assert.ok(parseAddress(a));
  for (const lang of [undefined, "", "fr/../x", "en&dev=1", "<x>"]) assert.deepEqual(def.overlayElements.maze(c, { lang }), { url: "/overlays/mz" });
});

// ── La géométrie du cœur : le rendu remplit son cadre ─────────────────────────────────────────────────────────────────────────
test("3440×1440 (21:9) : fenêtre virtuelle de hauteur 1080 et de largeur ≈ 2580, mise à l'échelle 1,3333, le cadre est rempli sans bande", () => {
  const l = frameLayout(decl, { w: 3440, h: 1440 });
  assert.equal(l.iframeH, 1080);
  assert.equal(l.iframeW, 2580);
  assert.equal(l.scale, 1.3333);
  assert.ok(Math.abs(l.boxW - 3440) < 0.5 && Math.abs(l.boxH - 1440) < 0.5, `${l.boxW}×${l.boxH}`);
  assert.ok(Math.abs(l.offsetX) < 0.5 && Math.abs(l.offsetY) < 0.5, "aucune bande autour");
  const s = frameLayout(decl, { w: 2520, h: 1080 });          // vrai 21:9
  assert.deepEqual([s.iframeW, s.iframeH, s.scale], [2520, 1080, 1]);
});

test("autres ratios : 16:9 (1920×1080) et 4:3 tels quels, 32:9 dans la plage, un cadre hors plage (1280×1080) est ramené à 4:3 sans déformer ni déborder", () => {
  const full = frameLayout(decl, { w: 1920, h: 1080 });
  assert.deepEqual([full.iframeW, full.iframeH, full.scale], [1920, 1080, 1]);
  const four3 = frameLayout(decl, { w: 1440, h: 1080 });
  assert.deepEqual([four3.iframeW, four3.iframeH, four3.scale], [1440, 1080, 1]);
  const wide = frameLayout(decl, { w: 3840, h: 1080 });       // 32:9 (3,556) : accepté tel quel
  assert.deepEqual([wide.iframeW, wide.iframeH, wide.scale], [3840, 1080, 1]);
  const beyond = frameLayout(decl, { w: 5120, h: 1080 });     // plus large que 32:9 : plafonné, le reste du cadre reste transparent
  assert.equal(beyond.iframeW, Math.round(1080 * decl.ratios.max));
  const out = frameLayout(decl, { w: 1280, h: 1080 });        // 1,185 : plus étroit que 4:3
  assert.equal(out.iframeW, Math.round(1080 * decl.ratios.min));
  assert.ok(out.boxW <= 1280.5 && out.boxH <= 1080 && out.scale < 1);
  assert.ok(Math.abs(out.boxW / out.boxH - out.iframeW / out.iframeH) < 0.01, "même proportion que la fenêtre : rien n'est étiré");
  // L'éditeur et le serveur ramènent un cadre hors plage dans la plage.
  const r = constrainRect(decl, { x: 0, y: 0, w: 2000, h: 200 }, { width: 3440, height: 1440 });
  assert.ok(r.w / r.h <= decl.ratios.max + 0.01);
});

// ── Le champ de vision s'adapte au ratio, sans déformer ───────────────────────────────────────────────────────────────────────
const TEXTURE = { width: 8, height: 8, data: { data: Uint8ClampedArray.from({ length: 8 * 8 * 4 }, (_, i) => (i % 4 === 3 ? 255 : 90 + ((i >> 2) % 8) * 20)) } };
const canvasFor = () => ({ clientWidth: 640, clientHeight: 360, width: 0, height: 0, getContext: () => ({ imageSmoothingEnabled: false, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, drawImage() {}, fillRect() {} }) });
// Une salle à piliers : beaucoup d'arêtes verticales à comparer.
const GRID = ["###############", "#.............#", "#..#..#..#..#.#", "#.............#", "#..#..#..#..#.#", "#.............#", "###############"];
function engineAt(w, h, o = {}) {
  configureRandom({ seed: 3, luck: "never", fast: true });
  const e = new MazeEngine({ canvas: canvasFor(), grid: gridFromAscii(GRID), wallTextures: [TEXTURE], floorTextures: [TEXTURE], portalTextures: [TEXTURE], moveSpeed: 1.4, turnSpeedDegrees: 220, fovDegrees: 66, stopMinSeconds: 12, stopMaxSeconds: 25, lookHoldSeconds: 8, onFocusChange() {}, ...o });
  e.resize(w, h);
  e.pos = { x: 1.5, y: 3.5 }; e.camAngle = 0.2;
  return e;
}
/** Colonnes où la hauteur du mur change (les arêtes verticales de la scène), en degrés autour du centre de l'image (indépendant de la largeur). */
function edges(e) {
  e.render();
  const { width, height } = e;
  const top = (x) => { const d = e.imageData.data; let y = 0; while (y < height && d[(y * width + x) * 4] === 10 && d[(y * width + x) * 4 + 1] === 8) y++; return y; };
  const out = [];
  let prev = top(0);
  for (let x = 1; x < width; x++) { const t = top(x); if (Math.abs(t - prev) > 2) out.push(x - width / 2); prev = t; }
  return out;
}

test("moteur : sans l'option, le champ de vision est celui du réglage (tan(fov/2)) à tout ratio, comme avant ; avec l'option, il est proportionnel au ratio, 16:9 inchangé", () => {
  const base = Math.tan((66 * Math.PI) / 180 / 2);
  for (const [w, h] of [[1920, 1080], [2580, 1080], [1440, 1080], [3840, 1080]]) assert.equal(engineAt(w, h).planeLength(), base, `${w}×${h} sans l'option`);
  assert.ok(Math.abs(engineAt(1920, 1080, { followAspect: true }).planeLength() - base) < base * 0.005, "16:9 : identique à l'overlay existant");
  const wide = engineAt(2580, 1080, { followAspect: true }), w169 = engineAt(1920, 1080, { followAspect: true });
  assert.ok(wide.planeLength() > w169.planeLength() * 1.3, "21:9 : la vue s'étend sur les côtés");
  // Même largeur angulaire par colonne à tout ratio = aucune déformation.
  const perColumn = (e) => e.planeLength() / (e.width / 2);
  for (const [w, h] of [[1440, 1080], [2580, 1080], [3840, 1080]]) assert.ok(Math.abs(perColumn(engineAt(w, h, { followAspect: true })) / perColumn(w169) - 1) < 0.01, `${w}×${h}`);
});

test("rendu réel : au centre d'une image 21:9 (2580×1080), la scène est la même qu'en 16:9 (mêmes arêtes, même échelle) ; sans l'option elle est étirée de 34 %", () => {
  const narrow = edges(engineAt(1920, 1080, { followAspect: true }));
  const wide = edges(engineAt(2580, 1080, { followAspect: true }));
  const inCentre = (list, half) => list.filter((x) => Math.abs(x) < half);
  const half = engineAt(1920, 1080).width / 2 - 8;
  const a = inCentre(narrow, half), b = inCentre(wide, half);
  assert.ok(a.length >= 4, `la scène de test a des arêtes (${a.length})`);
  assert.equal(b.length, a.length, "mêmes arêtes dans le cadre central");
  a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) <= 3, `arête ${i} : ${x} / ${b[i]} colonnes`));
  assert.ok(wide.length >= a.length, "et la vue plus large montre au moins autant de décor");
  // Témoin : sans l'option, la même scène en 21:9 est étirée (le test saurait voir une déformation).
  const stretched = inCentre(edges(engineAt(2580, 1080)), half);
  const err = (l) => Math.max(...l.map((x, i) => Math.abs(x - a[i])));
  assert.ok(stretched.length !== a.length || err(stretched) > 8, "sans l'option, l'image est déformée : le test le voit");
});

test("rendu réel : 4:3, 16:9, 21:9 et 32:9 se dessinent sans erreur, canvas à la proportion de la fenêtre (200 lignes), mains plafonnées", () => {
  for (const [w, h] of [[1440, 1080], [1920, 1080], [2580, 1080], [3840, 1080]]) {
    const e = engineAt(w, h, { followAspect: true });
    e.render();
    assert.equal(e.height, 200);
    assert.equal(e.width, Math.max(160, Math.round(200 * (w / h))));
    assert.ok(e.canvas.width === e.width && e.canvas.height === 200);
  }
  const hands = { complete: true, naturalWidth: 100, naturalHeight: 50 };
  const drawn = [];
  for (const follow of [false, true]) {
    const e = engineAt(3840, 1080, { followAspect: follow });
    e.ctx.drawImage = (img, x, y, w) => drawn.push([follow, w]);
    e.handsSprite = hands; e.drawHandsSprite();
  }
  const [off, on] = drawn;
  assert.ok(on[1] < off[1] && Math.abs(on[1] - 200 * (16 / 9) * 0.55) < 1, "à 32:9 les mains gardent la taille qu'elles ont en 16:9");
});

// ── La page de l'élément ────────────────────────────────────────────────────────────────────────────────────────────────────
test("page de l'élément : la config demande l'adaptation au ratio ; carte d'affiche plafonnée ; le reste de l'overlay est le même fichier", () => {
  const out = def.overlay(ctxFor(), { query: RATIO(2580, 1080) });
  assert.equal(cfgOf(out).followAspect, true);
  assert.match(out.css, /\.vm-card\{width:min\(72%,1382px\)\}/);
  assert.match(out.css, /#vm-root\{position:fixed;inset:0/, "la scène remplit toute la fenêtre qu'on lui donne");
  assert.match(out.script, /import\("\/m\/mz\/main\.js"\)/);
  assert.ok(!/--sk-|data-skin|<link|@import/.test(`${out.html}${out.css}${out.script}`), "ni skin de site ni chargement tiers");
  // Une valeur d'un autre comportement n'active rien.
  assert.equal(cfgOf(def.overlay(ctxFor(), { query: new URLSearchParams({ "ov-fit": "scale" }) })).followAspect, undefined);
  // Les réglages du module (taille, couleurs, affiches) restent ceux de l'instance.
  const custom = cfgOf(def.overlay(ctxFor({ size: "large", fov: 90 }), { query: RATIO(2580, 1080) }));
  assert.equal(custom.size, "large");
  assert.equal(custom.fov, 90);
  const main = fs.readFileSync(`${DIR}/web/main.js`, "utf8");
  assert.match(main, /followAspect: cfg\.followAspect === true/);
  assert.match(main, /new ResizeObserver\(\(\) => engine\.resize\(root\.clientWidth, root\.clientHeight\)\)/, "la scène suit la taille de sa fenêtre");
});

// ── Non-régression ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test("NON-RÉGRESSION : l'overlay existant rend les MÊMES octets qu'avant (1.1.1), réglages par défaut, personnalisés, et mode développeur", () => {
  const cases = { defaut: [{}, ""], reglages: [{ size: "large", fov: 90, hold: 5, wallColor: "#112233", wallTexture: "https://x.test/w.png" }, ""], dev: [{ devMode: true }, "dev=1&seed=7"] };
  for (const [name, [settings, q]] of Object.entries(cases)) {
    const out = def.overlay(ctxFor(settings), { query: new URLSearchParams(q) });
    const was = golden[name];
    assert.equal(hash(out.html), was.html, `${name} : html`);
    assert.equal(hash(out.css), was.css, `${name} : css`);
    assert.equal(hash(out.script), was.script, `${name} : script`);
    assert.equal(cfgOf(out).followAspect, undefined);
  }
});

test("NON-RÉGRESSION : le moteur sans l'option dessine exactement comme avant (champ de vision fixe), à tout ratio", () => {
  const e = engineAt(1920, 1080);
  e.render();
  assert.equal(e.followAspect, false);
  assert.equal(e.planeLength(), Math.tan((66 * Math.PI) / 180 / 2));
});
