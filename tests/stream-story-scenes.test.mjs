// Story d'annonce 1.0.0 — les quatre animations : chaque image est une FONCTION DU TEMPS (même temps = mêmes dessins), tout l'essentiel reste dans la zone sûre de chaque format
// (0 à 6 co-streamers, titre et phrase longs, avec ou sans jaquette et logo), le texte est dessiné avec fillText (jamais du HTML), les couleurs restent lisibles.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fakeCanvasContext, fakeImage } from "./helpers/fakeCanvas.mjs";

const DIR = new URL("../modules/stream-story", import.meta.url).pathname;
const P = await import("../modules/stream-story/pure.mjs");
const S = await import("../modules/stream-story/scenes.mjs");

const TZ = "Europe/Brussels", NOW = Date.parse("2026-10-22T10:00:00Z");
const LONG_TITLE = "Grande soirée découverte de Hollow Knight Silksong : on explore Pharloom !";
const LONG_TEXT = "Venez nombreux, ça va être une soirée incroyable avec plein de surprises, de rires et de moments forts à partager ensemble !";
const NAMES = ["Alice", "Bob le Bricoleur", "Carl", "Dave_Du_Nord_Extrêmement_Long", "Eve", "Fay"];
const members = (n) => NAMES.slice(0, n).map((name, i) => ({ login: `chaine_${i}${"x".repeat(i)}`, name }));
const stream = (over = {}) => ({ title: LONG_TITLE, startMs: Date.parse("2026-10-22T17:30:00Z"), allDay: false, games: ["Hollow Knight: Silksong"], timezone: TZ, ...over });
const THEME = { accent: "#7c5cff", accent2: "#ff4d8d", bg: "#101018", fg: "#f2f2f2" };

function scene({ style, format, n = 0, text = "", title = LONG_TITLE, cover = true, logo = true, config = {}, colors = THEME, withStream = true, duration = 15, streamOver = {} }) {
  const content = P.buildContent({ ...P.DEFAULT_CONFIG, ...config, style, format, text, costreamers: members(n).map((m) => m.login) }, { stream: withStream ? stream({ title, ...streamOver }) : null, coStreamers: members(n), site: { name: "Emma Live, la chaîne" }, nowMs: NOW, tz: TZ });
  const assets = { logo: logo ? fakeImage(200, 200) : null, cover: cover ? fakeImage(600, 338) : null, avatars: Object.fromEntries(members(n).filter((_, i) => i % 2 === 0).map((m) => [m.login, fakeImage(300, 300)])) };
  return S.createScene({ style, format, duration, content, assets, colors, measureContext: fakeCanvasContext() });
}
const run = (sc, t) => { const ctx = fakeCanvasContext(); sc.draw(ctx, t); return ctx.log; };
/** Les extrémités horizontales et verticales d'un texte noté (selon son alignement). */
function extent(entry) {
  const [, text, x, y, font, align] = entry, px = Number(/(\d+(?:\.\d+)?)px/.exec(font)[1]), w = [...text].length * px * 0.55;
  const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  return { left, right: left + w, top: y - px * 0.6, bottom: y + px * 0.6, px };
}
const CASES = [];
for (const style of P.STYLES) for (const format of P.FORMATS.map((f) => f.id)) for (const n of [0, 1, 2, 3, 4, 5, 6]) CASES.push({ style, format, n });

test("zone sûre : pour chaque style × format × 0 à 6 co-streamers (titre et phrase longs), aucun élément essentiel ne sort de la zone sûre ni n'entre dans une zone cachée", () => {
  assert.equal(CASES.length, 56);
  for (const c of CASES) for (const variant of [{ text: LONG_TEXT }, { text: "", cover: false, logo: false }, { text: "Court", title: "Oui" }]) {
    const sc = scene({ ...c, ...variant }), A = P.safeArea(c.format), f = P.formatOf(c.format), where = `${c.style}/${c.format}/${c.n} co-streamers/${JSON.stringify(variant).slice(0, 40)}`;
    assert.ok(sc.boxes.length >= 4, `${where} : des éléments sont posés`);
    for (const b of sc.boxes) {
      assert.ok(b.x >= A.x - 0.5 && b.x + b.w <= A.x + A.w + 0.5, `${where} : ${b.id} dans la largeur sûre (${Math.round(b.x)}→${Math.round(b.x + b.w)})`);
      assert.ok(b.y >= A.y - 0.5 && b.y + b.h <= A.y + A.h + 0.5, `${where} : ${b.id} dans la hauteur sûre (${Math.round(b.y)}→${Math.round(b.y + b.h)})`);
      for (const z of f.zones) assert.ok(b.x + b.w <= z.x + 0.5 || b.x >= z.x + z.w - 0.5 || b.y + b.h <= z.y + 0.5 || b.y >= z.y + z.h - 0.5, `${where} : ${b.id} n'entre pas dans la zone « ${z.id} »`);
      assert.ok(b.w > 0 && b.h > 0 && Number.isFinite(b.x + b.y + b.w + b.h));
    }
    const sorted = [...sc.boxes].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].y >= sorted[i - 1].y + sorted[i - 1].h - 0.5, `${where} : ${sorted[i - 1].id} et ${sorted[i].id} ne se chevauchent pas`);
    // tous les textes dessinés une fois l'animation posée (le néon peut « trembler » de quelques pixels pendant un parasite)
    const tol = c.style === "neon" ? 80 : 2;
    for (const t of [sc.restTime, sc.duration]) for (const e of run(sc, t).filter((x) => x[0] === "fillText")) {
      const x = extent(e);
      assert.ok(x.left >= A.x - tol && x.right <= A.x + A.w + tol, `${where} t=${t} : « ${e[1].slice(0, 20)} » dans la largeur (${Math.round(x.left)}→${Math.round(x.right)})`);
      assert.ok(x.top >= A.y - tol && x.bottom <= A.y + A.h + tol, `${where} t=${t} : « ${e[1].slice(0, 20)} » dans la hauteur (${Math.round(x.top)}→${Math.round(x.bottom)})`);
    }
  }
});

test("lisibilité : aucun texte plus petit que 20 px (sur 1080 de large), même avec tout le contenu dans le format le plus court", () => {
  for (const c of CASES.filter((x) => x.n === 6 || x.n === 0)) {
    const sc = scene({ ...c, text: LONG_TEXT });
    for (const e of run(sc, sc.restTime).filter((x) => x[0] === "fillText")) assert.ok(extent(e).px >= 20, `${c.style}/${c.format}/${c.n} : « ${e[1].slice(0, 20)} » ${extent(e).px}px`);
  }
});

test("une fonction du temps : le même instant donne exactement les mêmes dessins ; deux instants différents donnent des images différentes ; hors de la durée, c'est le début ou la fin", () => {
  for (const style of P.STYLES) for (const format of ["vertical", "passeport"]) {
    const a = scene({ style, format, n: 3, text: LONG_TEXT }), b = scene({ style, format, n: 3, text: LONG_TEXT });
    for (const t of [0, 0.4, 1.7, 5, 11.2, 15]) assert.deepEqual(run(a, t), run(b, t), `${style}/${format} t=${t} : reproductible`);
    assert.notDeepEqual(run(a, 0.3), run(a, 6), `${style} : l'animation bouge`);
    assert.deepEqual(run(a, -5), run(a, 0)); assert.deepEqual(run(a, 99), run(a, 15)); assert.deepEqual(run(a, NaN), run(a, 0));
    assert.deepEqual(run(a, 3), run(a, 3), "même scène, deux appels : mêmes dessins (aucun état caché)");
  }
});

test("dessin sûr : aucun nombre absurde (NaN, infini) dans les images, du début à la fin, pour toutes les combinaisons ; le texte vient de fillText seulement", () => {
  for (const c of CASES.filter((x) => x.n % 3 === 0)) {
    const sc = scene({ ...c, text: LONG_TEXT });
    for (let t = 0; t <= 15; t += 0.5) for (const entry of run(sc, t)) for (const v of entry.slice(1)) if (typeof v === "number") assert.ok(Number.isFinite(v), `${c.style}/${c.format} t=${t} ${entry[0]} : ${v}`);
  }
  const code = fs.readFileSync(`${DIR}/scenes.mjs`, "utf8").replace(/\/\/.*$/gm, "");
  for (const forbidden of ["innerHTML", "document.", "insertAdjacentHTML", "eval(", "new Function"]) assert.ok(!code.includes(forbidden), `scenes.mjs ne doit pas employer « ${forbidden} »`);
  // un texte piégé est dessiné tel quel, comme du texte
  const sc = scene({ style: "minimal", format: "vertical", text: "<img src=x onerror=alert(1)>", n: 1 });
  assert.ok(run(sc, sc.duration).some((e) => e[0] === "fillText" && e[1].includes("<img")), "le texte piégé est dessiné comme du texte");
});

test("contenu absent : sans stream, sans jaquette, sans logo, sans co-streamers, texte vide : la vidéo se dessine quand même ; rien du tout : aucun plantage", () => {
  for (const style of P.STYLES) for (const format of ["vertical", "passeport"]) {
    const noStream = scene({ style, format, withStream: false, cover: false });
    assert.ok(noStream.boxes.length >= 1 && noStream.boxes.every((b) => ["brand"].includes(b.id)), `${style} : sans stream, seulement le nom`);
    assert.doesNotThrow(() => run(noStream, 5));
    const nothing = scene({ style, format, withStream: false, cover: false, logo: false, config: { elements: [] } });
    assert.equal(nothing.boxes.length, 0); assert.doesNotThrow(() => run(nothing, 5));
    const allDay = scene({ style, format, streamOver: { allDay: true, startMs: Date.parse("2026-10-22T22:00:00Z") }, n: 2 });
    assert.ok(!allDay.boxes.some((b) => b.id === "when" && b.h > 300), `${style} : une journée entière n'a pas de grande heure`);
    assert.doesNotThrow(() => run(allDay, 7));
  }
});

test("compte à rebours animé : les chiffres défilent puis se posent sur les vraies valeurs (heures et minutes), jours ajoutés quand il y en a", () => {
  const sc = scene({ style: "countdown", format: "vertical" });
  assert.ok(sc.boxes.some((b) => b.id === "digits"));
  const texts = (t) => run(sc, t).filter((e) => e[0] === "fillText").map((e) => e[1]);
  const settled = texts(sc.duration).filter((x) => /^\d$/.test(x));
  assert.ok(settled.includes("0") && settled.includes("7") && settled.includes("3"), `07:30 attendu, vu : ${settled}`);
  assert.deepEqual(texts(sc.duration).filter((x) => ["HEURES", "MIN", "JOURS"].includes(x)), ["HEURES", "MIN"]);
  const days = scene({ style: "countdown", format: "passeport", streamOver: { startMs: Date.parse("2026-10-25T17:30:00Z") } });
  assert.ok(run(days, days.duration).some((e) => e[1] === "JOURS"), "des jours en plus quand le stream est dans plus de 24 h");
  const en = scene({ style: "countdown", format: "vertical", config: { lang: "en" } });
  assert.ok(run(en, en.duration).some((e) => e[1] === "HOURS"));
  assert.notDeepEqual(run(sc, 0.8).filter((e) => e[0] === "fillText"), run(sc, sc.duration).filter((e) => e[0] === "fillText"), "ça défile");
});

test("minimal : le texte apparaît lettre par lettre (de plus en plus de lettres avec le temps), tout est écrit avant la fin ; neon : parasites reproductibles", () => {
  const sc = scene({ style: "minimal", format: "vertical", text: LONG_TEXT });
  const count = (t) => run(sc, t).filter((e) => e[0] === "fillText").reduce((s, e) => s + [...e[1]].length, 0);
  let prev = -1;
  for (const t of [0, 0.5, 1, 2, 4, 8, 15]) { const c = count(t); assert.ok(c >= prev, `t=${t}`); prev = c; }
  assert.ok(count(0.5) < count(15) / 2, "au début, peu de lettres");
  const full = run(sc, 15).filter((e) => e[0] === "fillText").map((e) => e[1]).join(" ");
  assert.ok(full.includes("Hollow Knight") && full.includes("Venez nombreux"), "tout est écrit avant la fin");
  assert.ok(count(sc.duration * 0.7) >= count(15) - 2, "à 70 % de la durée, le texte est complet");
  const neon = scene({ style: "neon", format: "vertical" });
  const burst = run(neon, 1.35).filter((e) => e[0] === "fillText").length, calm = run(neon, 0.1).filter((e) => e[0] === "fillText").length;
  assert.ok(burst >= calm, "plus de copies de texte pendant un parasite (décalage des couleurs)");
  assert.deepEqual(run(neon, 1.35), run(scene({ style: "neon", format: "vertical" }), 1.35));
});

test("couleurs : le texte reste lisible sur le fond de chaque style, même avec un thème clair, une couleur d'accent pâle ou sombre, ou une couleur invalide", () => {
  const themes = [THEME, { accent: "#ffee88", accent2: "#ffee88", bg: "#ffffff", fg: "#222222" }, { accent: "#101010", accent2: "#202020", bg: "#fafafa", fg: "#eeeeee" }, { accent: "rouge", accent2: undefined, bg: "n'importe quoi", fg: "#ffffff" }, { accent: "#00ff00", accent2: "#00ff00", bg: "#00ff00", fg: "#00ff00" }];
  for (const style of P.STYLES) for (const th of themes) {
    const pal = S.paletteFor(style, th);
    for (const k of ["text", "accent", "soft"]) {
      const need = style === "countdown" && k === "accent" ? 4.5 : 4.5;
      assert.ok(P.contrast(pal[k], pal.base) >= need - 0.01, `${style} ${k} ${pal[k]} sur ${pal.base} : ${P.contrast(pal[k], pal.base).toFixed(2)}`);
    }
    if (style === "countdown") for (const bg of [pal.bg0, pal.bg1]) assert.ok(P.contrast("#ffffff", bg) >= 4.5, `dégradé ${bg}`);
    for (const k of ["base", "text", "accent"]) assert.match(pal[k], /^#[0-9a-f]{6}$/i);
  }
  assert.ok(P.contrast(S.paletteFor("minimal", { bg: "#ffffff", fg: "#cccccc", accent: "#eeeeee" }).text, "#ffffff") >= 7, "texte du style minimal : contraste renforcé");
});

test("durée : toujours entre 5 et 15 secondes ; le format et le style inconnus retombent sur ceux par défaut ; une famille de police piégée est refusée", () => {
  for (const [d, want] of [[5, 5], [15, 15], [1, 5], [60, 15], ["x", 15], [undefined, 15]]) assert.equal(scene({ style: "minimal", format: "vertical", duration: d }).duration, want);
  const odd = S.createScene({ style: "<b>", format: "paysage", duration: 15, content: { lang: "fr", title: "x", dayLine: "", timeLine: "", countdown: "", costreamers: [] }, assets: {}, font: "x; background:url(evil)", measureContext: fakeCanvasContext() });
  assert.deepEqual([odd.style, odd.format, odd.width, odd.height], ["neon", "vertical", 1080, 1920]);
  const ctx = fakeCanvasContext(); odd.draw(ctx, 3);
  assert.ok(ctx.log.filter((e) => e[0] === "fillText").every((e) => !String(e[4]).includes("evil")), "la police n'est jamais celle d'une valeur piégée");
});

test("vm vierge : pure.mjs + scenes.mjs concaténés (sans import ni export) dessinent la même chose, sans Node ni navigateur", () => {
  const strip = (f) => fs.readFileSync(`${DIR}/${f}`, "utf8").replace(/^import .*$/gm, "").replace(/^export /gm, "");
  const code = `${strip("pure.mjs")}\n${strip("scenes.mjs")}`;
  const ctx = vm.createContext({ Intl, Date, Math, Number, String, Array, Object, Set, Map, JSON, RegExp, parseInt, isFinite, Boolean, fakeCanvasContext, fakeImage });
  const out = vm.runInContext(`${code}
    const mctx = fakeCanvasContext(), c = fakeCanvasContext();
    const content = buildContent(DEFAULT_CONFIG, { stream: { title: "Soirée", startMs: ${Date.parse("2026-10-22T17:30:00Z")}, allDay: false, games: ["Hades"], timezone: "Europe/Brussels" }, coStreamers: [{ login: "alice_tv", name: "Alice" }], site: { name: "Emma" }, nowMs: ${NOW}, tz: "Europe/Brussels" });
    const sc = createScene({ style: "poster", format: "passeport", duration: 15, content, assets: { cover: fakeImage(600, 338), avatars: {} }, colors: ${JSON.stringify(THEME)}, measureContext: mctx });
    sc.draw(c, 9); JSON.stringify(c.log);`, ctx);
  const ref = (() => {
    const content = P.buildContent(P.DEFAULT_CONFIG, { stream: { title: "Soirée", startMs: Date.parse("2026-10-22T17:30:00Z"), allDay: false, games: ["Hades"], timezone: TZ }, coStreamers: [{ login: "alice_tv", name: "Alice" }], site: { name: "Emma" }, nowMs: NOW, tz: TZ });
    const sc = S.createScene({ style: "poster", format: "passeport", duration: 15, content, assets: { cover: fakeImage(600, 338), avatars: {} }, colors: THEME, measureContext: fakeCanvasContext() });
    const c = fakeCanvasContext(); sc.draw(c, 9); return JSON.stringify(c.log);
  })();
  assert.equal(out, ref);
});
