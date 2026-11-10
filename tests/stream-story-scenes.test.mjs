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
const X = await import("../modules/stream-story/scenes-extra.mjs");

const TZ = "Europe/Brussels", NOW = Date.parse("2026-10-22T10:00:00Z");
const LONG_TITLE = "Grande soirée découverte de Hollow Knight Silksong : on explore Pharloom !";
const LONG_TEXT = "Venez nombreux, ça va être une soirée incroyable avec plein de surprises, de rires et de moments forts à partager ensemble !";
const NAMES = ["Alice", "Bob le Bricoleur", "Carl", "Dave_Du_Nord_Extrêmement_Long", "Eve", "Fay"];
const members = (n) => NAMES.slice(0, n).map((name, i) => ({ login: `chaine_${i}${"x".repeat(i)}`, name }));
const stream = (over = {}) => ({ title: LONG_TITLE, startMs: Date.parse("2026-10-22T17:30:00Z"), allDay: false, games: ["Hollow Knight: Silksong"], timezone: TZ, ...over });
const THEME = { accent: "#7c5cff", accent2: "#ff4d8d", bg: "#101018", fg: "#f2f2f2" };

function scene({ style, format, n = 0, text = "", title = LONG_TITLE, cover = true, logo = true, config = {}, colors = THEME, withStream = true, duration = 15, streamOver = {} }) {
  const content = P.buildContent({ ...P.DEFAULT_CONFIG, elements: P.ELEMENTS, ...config, style, format, text, costreamers: members(n).map((m) => m.login) }, { stream: withStream ? stream({ title, ...streamOver }) : null, coStreamers: members(n), site: { name: "Emma Live, la chaîne" }, nowMs: NOW, tz: TZ });
  const assets = { logo: logo ? fakeImage(200, 200) : null, cover: cover ? fakeImage(600, 338) : null, avatars: Object.fromEntries(members(n).filter((_, i) => i % 2 === 0).map((m) => [m.login, fakeImage(300, 300)])) };
  return S.createScene({ style, format, duration, content, assets, colors, measureContext: fakeCanvasContext() });
}
const run = (sc, t) => { const ctx = fakeCanvasContext(); sc.draw(ctx, t); return ctx.log; };
/** Les extrémités horizontales et verticales d'un texte noté (selon son alignement). */
function extent(entry) {
  const [, text, x0, y, font, align, , baseline, sx = 1, tx = 0] = entry, px = Number(/(\d+(?:\.\d+)?)px/.exec(font)[1]), w = [...text].length * px * 0.55 * sx, x = tx + sx * x0;   // sx, tx: a squeezed text (the Arena style) is measured where it really lands
  const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  // la hauteur dépend de la ligne de base du texte : « middle » (les quatre premiers styles) ±0,6 em ; « alphabetic » (les six autres) de 0,8 em au-dessus à 0,25 em au-dessous ; « top » de 0 à 0,8 em au-dessous
  const [up, down] = baseline === "alphabetic" ? [0.8, 0.25] : baseline === "top" ? [0, 0.8] : [0.6, 0.6];
  return { left, right: left + w, top: y - px * up, bottom: y + px * down, px };
}
const CASES = [];
for (const style of P.STYLES) for (const format of P.FORMATS.map((f) => f.id)) for (const n of [0, 1, 2, 3, 4, 5, 6]) CASES.push({ style, format, n });

test("zone sûre : pour chaque style × format × 0 à 6 co-streamers (titre et phrase longs), aucun élément essentiel ne sort de la zone sûre ni n'entre dans une zone cachée", () => {
  assert.equal(CASES.length, P.STYLES.length * 2 * 7);
  assert.equal(P.STYLES.length, 12, "les quatre styles d'origine et les huit nouveaux");
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
    const tol = c.style === "neon" ? 80 : c.style === "cinema" ? 20 : 2;   // cinéma : la poussée lente grossit l'image de 4 % au plus (la zone de mise en page est réduite d'autant)
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
  for (const file of ["scenes.mjs", "scenes-extra.mjs"]) {
    const code = fs.readFileSync(`${DIR}/${file}`, "utf8").replace(/\/\/.*$/gm, "");
    for (const forbidden of ["innerHTML", "document.", "insertAdjacentHTML", "eval(", "new Function", "Date.now", "Math.random", "performance.now"]) assert.ok(!code.includes(forbidden), `${file} ne doit pas employer « ${forbidden} »`);
  }
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
  const themes = [THEME, { accent: "#ffee88", accent2: "#ffee88", bg: "#ffffff", fg: "#222222" }, { accent: "#101010", accent2: "#202020", bg: "#fafafa", fg: "#eeeeee" }, { accent: "rouge", accent2: undefined, bg: "n'importe quoi", fg: "#ffffff" }, { accent: "#00ff00", accent2: "#00ff00", bg: "#00ff00", fg: "#00ff00" }, { accent: "#ff0000", accent2: "#0000ff", bg: "#ff00ff", fg: "#00ffff" }, { accent: "#7f7f7f", accent2: "#808080", bg: "#808080", fg: "#7f7f7f" }];
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

test("vm vierge : pure.mjs + scenes-extra.mjs + scenes.mjs concaténés (sans import ni export) dessinent la même chose, sans Node ni navigateur", () => {
  const strip = (f) => fs.readFileSync(`${DIR}/${f}`, "utf8").replace(/^import .*$/gm, "").replace(/^export /gm, "");
  const code = `${strip("pure.mjs")}\n${strip("scenes-extra.mjs")}\n${strip("scenes.mjs")}`;
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

/* ───────────── 2.7.0: the six new styles ───────────── */
const NEW_STYLES = ["broadcast", "kinetic", "cinema", "arcade", "collage", "geometric", "epic", "arena"];
const textsAt = (sc, t) => run(sc, t).filter((e) => e[0] === "fillText").map((e) => [e[1], e[2], e[3], e[4], e[5]]);   // text, x, y, font, align (not the alpha)

test("eight new styles: ids, order and the four first styles untouched", () => {
  assert.deepEqual(P.STYLES, ["neon", "poster", "countdown", "minimal", ...NEW_STYLES]);
  assert.deepEqual(X.EXTRA_STYLES, NEW_STYLES, "scenes-extra.mjs draws exactly the eight new ones");
});

test("hold: from restTime to the end every text is at exactly the same place (the composition is still), and all of them are drawn well before", () => {
  for (const style of NEW_STYLES) for (const format of ["vertical", "passeport"]) for (const duration of [5, 15]) {
    const sc = scene({ style, format, n: 3, text: LONG_TEXT, duration });
    assert.ok(Math.abs(sc.restTime - duration * 0.78) < 1e-9);
    const at = textsAt(sc, sc.restTime), end = textsAt(sc, duration), mid = textsAt(sc, sc.restTime + (duration - sc.restTime) / 2);
    assert.ok(at.length >= 6, `${style}: text is drawn`);
    assert.deepEqual(end, at, `${style}/${format}/${duration} s: still from restTime to the end`);
    assert.deepEqual(mid, at, `${style}/${format}/${duration} s: still in the middle of the hold`);
    // entrances are over before the hold: at 62 % of the video the texts are already where they will stay
    const late = textsAt(sc, duration * 0.7), key = (x) => JSON.stringify(x);
    assert.ok(late.every((x) => at.map(key).includes(key(x))), `${style}/${format}/${duration} s: at 70 % every text drawn is already at its final place`);
    assert.notDeepEqual(run(sc, 0.1), run(sc, sc.restTime), `${style}: the start is not the end`);
  }
});

test("determinism: the same t gives the same drawing for the new styles, also across two scenes, with grain, paper, jitter and weave", () => {
  for (const style of NEW_STYLES) {
    const a = scene({ style, format: "vertical", n: 4, text: "Court" }), b = scene({ style, format: "vertical", n: 4, text: "Court" });
    for (const t of [0, 0.37, 1.2, 3.3, 7.77, 11.7, 14.9, 15]) assert.deepEqual(run(a, t), run(b, t), `${style} t=${t}`);
    assert.notDeepEqual(run(a, 0.5), run(a, 5), `${style}: it moves`);
  }
});

test("watermark: in vertical and passport, no box of the new styles touches the mention, and everything stays in the safe area", () => {
  for (const style of NEW_STYLES) for (const format of ["vertical", "passeport"]) for (const n of [0, 3, 6]) {
    const sc = scene({ style, format, n, text: LONG_TEXT, config: {} });
    const wm = S.createScene({ style, format, duration: 15, watermark: true, content: P.buildContent({ ...P.DEFAULT_CONFIG, elements: P.ELEMENTS, style, format, text: LONG_TEXT, costreamers: members(n).map((m) => m.login) }, { stream: stream(), coStreamers: members(n), site: { name: "Emma Live" }, nowMs: NOW, tz: TZ }), assets: { logo: fakeImage(200, 200), cover: fakeImage(600, 338), avatars: {} }, colors: THEME, measureContext: fakeCanvasContext() });
    const A = P.safeArea(format), m = wm.watermark;
    assert.ok(m && wm.boxes.length >= 4 && sc.boxes.length >= 4);
    for (const b of wm.boxes) {
      assert.ok(b.y + b.h <= m.y + 0.5 && b.y >= A.y - 0.5 && b.x >= A.x - 0.5 && b.x + b.w <= A.x + A.w + 0.5, `${style}/${format}/${n}: ${b.id} above the mention (${Math.round(b.y + b.h)} vs ${m.y})`);
    }
    assert.ok(run(wm, wm.restTime).some((e) => e[0] === "fillText" && e[1].startsWith("Made with")), `${style}: the mention is drawn`);
  }
});

test("content combinations: no title, no game, no logo, no brand, no text, all-day event, English, 0 to 6 guests: always drawn, inside the safe area, never an exception", () => {
  for (const style of NEW_STYLES) for (const format of ["vertical", "passeport"]) {
    const A = P.safeArea(format);
    for (const variant of [{ title: "", cover: false }, { title: "x" }, { cover: false, logo: false, config: { channelName: "" } }, { streamOver: { allDay: true, startMs: Date.parse("2026-10-22T22:00:00Z") }, n: 2 }, { config: { lang: "en" }, n: 6, text: LONG_TEXT }, { n: 1, text: "a" }, { withStream: false, cover: false }]) {
      const sc = scene({ style, format, ...variant });
      assert.doesNotThrow(() => { for (const t of [0, 3, 8, 12, 15]) run(sc, t); }, `${style}/${format}/${JSON.stringify(variant).slice(0, 50)}`);
      for (const b of sc.boxes) assert.ok(b.x >= A.x - 0.5 && b.x + b.w <= A.x + A.w + 0.5 && b.y >= A.y - 0.5 && b.y + b.h <= A.y + A.h + 0.5, `${style}/${format}: ${b.id} in the safe area`);
    }
    const none = scene({ style, format, withStream: false, cover: false, logo: false, config: { elements: [] } });
    assert.equal(none.boxes.length, 0);
  }
});

test("words written by the styles themselves: neutral, in both languages, drawn in the right one", () => {
  const W = X.EXTRA_WORDS;
  assert.deepEqual(Object.keys(W.fr).sort(), Object.keys(W.en).sort(), "same keys in French and English");
  for (const lang of ["fr", "en"]) for (const w of Object.values(W[lang])) assert.match(w, /^[A-ZÀ-Ü ]+$/, "short capitals, no punctuation, no exclamation");
  const fr = textsAt(scene({ style: "broadcast", format: "vertical" }), 15).map((x) => x[0]).join(""), en = textsAt(scene({ style: "broadcast", format: "vertical", config: { lang: "en" } }), 15).map((x) => x[0]).join("");
  assert.ok(fr.includes("À SUIVRE") && !fr.includes("UP NEXT"));
  assert.ok(en.includes("UP NEXT") && !en.includes("À SUIVRE"));
  assert.ok(textsAt(scene({ style: "arcade", format: "vertical" }), 15).some((x) => x[0] === "START"));
});

test("text size: no word of the new styles under 20 px even in the crowded worst case, and names are shrunk before being cut", () => {
  for (const style of NEW_STYLES) for (const format of ["vertical", "passeport"]) {
    const sc = scene({ style, format, n: 6, text: LONG_TEXT, title: LONG_TITLE });
    for (const e of run(sc, sc.restTime).filter((x) => x[0] === "fillText")) assert.ok(extent(e).px >= 20, `${style}/${format}: « ${e[1].slice(0, 20)} » ${extent(e).px}px`);
  }
});

test("palettes of the new styles: the site colours, text at 4.5:1 or more on the style's own background, whatever the accent (pale, dark, saturated, grey, the same twice)", () => {
  for (const style of NEW_STYLES) for (const th of [THEME, { accent: "#ffe27a", accent2: "#ffd1e8", bg: "#ffffff", fg: "#222222" }, { accent: "#12172b", accent2: "#12172b", bg: "#0b0b10", fg: "#eeeeee" }, { accent: "#ff0000", accent2: "#ff0000", bg: "#ff0000", fg: "#ff0000" }, { accent: "#808080", accent2: "#808080", bg: "#808080", fg: "#808080" }, {}]) {
    const pal = S.paletteFor(style, th);
    for (const k of ["text", "accent", "soft"]) assert.ok(P.contrast(pal[k], pal.base) >= 4.5 - 0.01, `${style} ${k} ${pal[k]} on ${pal.base}: ${P.contrast(pal[k], pal.base).toFixed(2)}`);
    for (const k of ["fill", "fill2", "s1", "s2"]) if (pal[k]) assert.ok(Math.max(P.contrast(pal[k], "#ffffff"), P.contrast(pal[k], "#111111")) >= 4.7, `${style} ${k} ${pal[k]} carries text`);
  }
});

test("hold, whole drawing: for the styles without grain, EVERY drawing call (shapes, masks, transforms, not only the texts) is the same from just after restTime to the end", () => {
  for (const style of ["broadcast", "kinetic", "arcade", "geometric", "collage", "epic", "arena"]) for (const duration of [5, 15]) {
    const sc = scene({ style, format: "vertical", n: 3, text: LONG_TEXT, duration });
    const a = run(sc, duration * 0.8), b = run(sc, duration * 0.9), c = run(sc, duration);
    assert.deepEqual(b, a, `${style}/${duration} s: still at 80 % and 90 %`); assert.deepEqual(c, a, `${style}/${duration} s: still at the end`);
  }
  // cinema: only the film grain (small rectangles) and the weave move; no text
  const sc = scene({ style: "cinema", format: "vertical", n: 3, text: LONG_TEXT });
  assert.deepEqual(textsAt(sc, 12), textsAt(sc, 15));
});


/* ───────────── 2.11.0: Epic fantasy and Hero arena ───────────── */
test("epic and arena: drawn only from lines, fills and text (no picture of their own), no brand or game name anywhere in the module, the locales or the showcase entry", () => {
  const words = [["war", "craft"], ["azer", "oth"], ["over", "watch"], ["bliz", "zard"], ["wo", "w"]].map((p) => p.join(""));
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${f.name}`; if (f.isDirectory()) { if (f.name !== "shots") walk(p); } else if (/\.(mjs|json|md)$/.test(f.name)) files.push(p); } };
  walk(DIR); walk(new URL("../showcase/modules/stream-story", import.meta.url).pathname);
  for (const f of files) { const text = fs.readFileSync(f, "utf8").toLowerCase(); for (const w of words) assert.ok(!new RegExp(`\\b${w}\\b`).test(text), `${f.split("/").slice(-2).join("/")} does not mention « ${w} »`); }
  for (const style of ["epic", "arena"]) for (const format of ["vertical", "passeport"]) {
    const log = run(scene({ style, format, n: 3, text: "Court", config: {} }), 15);
    assert.ok(!log.some((e) => e[0] === "drawImage" && e[1] !== "[objet]"), `${style}: only the editor's own images are drawn`);
    assert.ok(log.some((e) => e[0] === "fillText"), `${style}: text is drawn with fillText`);
  }
});

test("epic and arena: the words are in both languages, the names in the picker are neutral, and the style is listed in the MCP description", () => {
  for (const id of ["epic", "arena"]) for (const dict of [JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"))]) {
    assert.ok(dict[`ui_style_${id}`] && dict[`ui_style_${id}_hint`], id);
    assert.ok(dict[`ui_style_${id}_hint`].length <= 70 && !/[!]/.test(dict[`ui_style_${id}_hint`]), `${id}: short hint, no exclamation`);
  }
  const en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8")), fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
  assert.deepEqual([en.ui_style_epic, en.ui_style_arena, fr.ui_style_epic, fr.ui_style_arena], ["Epic fantasy", "Hero arena", "Épique", "Héros"]);
});

test("epic and arena: panel and ribbon fills carry their text (4.5:1 or more) whatever the site colours, and the hot and cool colours stay apart", () => {
  const themes = [THEME, { accent: "#ffe27a", accent2: "#ffd1e8", bg: "#ffffff", fg: "#222222" }, { accent: "#12172b", accent2: "#12172b", bg: "#0b0b10", fg: "#eeeeee" }, { accent: "#ff0000", accent2: "#ff0000", bg: "#101018", fg: "#ffffff" }, { accent: "#808080", accent2: "#808080", bg: "#777777", fg: "#000000" }];
  for (const style of ["epic", "arena"]) for (const th of themes) {
    const pal = S.paletteFor(style, th);
    for (const k of ["fill", "fill2"]) assert.ok(P.contrast(P.readableOn(pal[k]), pal[k]) >= 4.5, `${style} ${JSON.stringify(th.accent)} ${k} carries its ink: ${P.contrast(P.readableOn(pal[k]), pal[k]).toFixed(2)}`);
    for (const k of ["text", "accent", "accent2", "soft"]) assert.ok(P.contrast(pal[k], pal.base) >= 4.5 - 0.01, `${style} ${k} on the base`);
  }
});

test("epic and arena: very long title, game and text, one-word guests, 0 to 6 guests, in both formats and both languages: the layout never fails and keeps its boxes in the safe area", () => {
  const huge = "Mégasoirée".repeat(12);
  for (const style of ["epic", "arena"]) for (const format of ["vertical", "passeport"]) for (const lang of ["fr", "en"]) for (const n of [0, 6]) {
    const sc = scene({ style, format, n, title: huge, text: huge, config: { lang }, streamOver: { games: [huge] } }), A = P.safeArea(format);
    for (const b of sc.boxes) assert.ok(b.x >= A.x - 0.5 && b.x + b.w <= A.x + A.w + 0.5 && b.y >= A.y - 0.5 && b.y + b.h <= A.y + A.h + 0.5, `${style}/${format}/${lang}/${n}: ${b.id}`);
    assert.doesNotThrow(() => { for (const t of [0, 1, 4, 9, 12, 15]) run(sc, t); });
  }
});
