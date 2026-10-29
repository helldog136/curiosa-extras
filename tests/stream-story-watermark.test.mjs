// Story d'annonce 2.2.0 — la mention « Made with Curiosa » : case DÉCOCHÉE par défaut, choix retenu, paramètre MCP `watermark`, dessin demandé (ou pas) au moteur de rendu sur
// TOUTES les images, placée dans la zone sûre, lisible sur fond clair et sombre, sans mouvement ; parité FR/EN. Aucun réseau : tout est factice.
// Le rendu réel (netteté, police) a été relu à part dans un vrai Chromium (voir le rapport de la branche).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeCanvasContext, fakeImage } from "./helpers/fakeCanvas.mjs";

const DIR = new URL("../modules/stream-story", import.meta.url).pathname;
const read = (f) => fs.readFileSync(`${DIR}/${f}`, "utf8");
const manifest = JSON.parse(read("module.json")), fr = JSON.parse(read("locales/fr.json")), en = JSON.parse(read("locales/en.json"));
const def = (await import("../modules/stream-story/index.mjs")).default;
const P = await import("../modules/stream-story/pure.mjs");
const S = await import("../modules/stream-story/scenes.mjs");
const data = await import("../modules/stream-story/data.mjs");
const page = await import("../modules/stream-story/page.mjs");
const tools = await import("../modules/stream-story/mcp.mjs");

const SITE = "https://site.example.test", TEXT = "Made with Curiosa", NOW = Date.parse("2026-10-22T10:00:00Z");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mkCtx = (extra = {}) => fakeCtx({
  key: "story", moduleId: "stream-story", locale: "fr", messages: { ...fr }, permissions: manifest.permissions, siteUrl: SITE, topics: { "planning.slot": () => [] },
  instances: [{ id: "id-story", key: "story", module: "stream-story", basePath: "", name: "Story", adminPath: "/admin/instances/id-story" }],
  theme: { accent: "#7c5cff", accentFg: "#ffffff", bg: "#101018", fg: "#f2f2f2", accent2: "#ff4d8d", font: "Inter, sans-serif" }, ...extra,
});
const call = (ctx, route, { method = "GET", token, body } = {}) => def.routes[route](new Request(`${SITE}/m/story/${route}`, { method, headers: { ...(token ? { "x-story-token": token } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), ctx);
const json = async (r) => ({ status: r.status, ...(await r.json()) });
const act = async (ctx, token, body) => json(await call(ctx, "act", { method: "POST", token, body }));
const prepare = (ctx, args) => def.mcp.story_prepare(ctx, args);
const prepOf = async (ctx, r) => data.readPrep(ctx, /prep=([A-Za-z0-9_-]{22})/.exec(r.link)[1]);

/* ───────────── Le manifeste, les textes, la case ───────────── */

test("manifeste : version 2.5.0, réglage « watermark » (oui/non, NON par défaut, mode avancé : rien de visible en mode simple), paramètre MCP facultatif décrit ; la mention n'est pas un élément", () => {
  assert.equal(manifest.version, "2.5.1");
  const s = manifest.settings.find((x) => x.key === "watermark");
  assert.deepEqual([s.type, s.default, s.advanced], ["boolean", false, true]);
  assert.ok(s.label.fr && s.label.en && s.help.fr && s.help.en);
  const t = manifest.mcp.find((x) => x.name === "story_prepare");
  assert.equal(t.input.properties.watermark.type, "boolean"); assert.ok(!(t.input.required ?? []).includes("watermark"), "facultatif : les anciens appels restent valables");
  assert.ok(!P.ELEMENTS.includes("watermark"), "la mention n'est pas un des éléments cochables de la vidéo");
  assert.equal(P.WATERMARK_TEXT, TEXT);
});

test("parité FR/EN : mêmes clés dans les deux langues, la case et son aide existent partout, la page n'écrit aucune phrase en dur, la mention de marque n'est PAS traduite", async () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of ["ui_watermark_label", "ui_watermark_help"]) { assert.ok(fr[k] && en[k], k); assert.ok(page.KEYS.includes(k.replace(/^ui_/, "")), `${k} est donnée à la page`); }
  assert.equal(fr.ui_watermark_label, "Ajouter la mention “Made with Curiosa” en bas de la vidéo");
  assert.equal(en.ui_watermark_label, "Add a small “Made with Curiosa” mark at the bottom of the video");
  for (const [lang, ctx] of [["fr", mkCtx()], ["en", mkCtx({ locale: "en", messages: { ...en } })]]) {
    const html = await (await page.studioPage(ctx, { base: "/m/story", colors: {}, timezone: "", font: "", accent: "#4f46e5", accentFg: "#ffffff" })).text();
    assert.ok(html.includes(`<span>${(lang === "fr" ? fr : en).ui_watermark_label}</span>`), lang);
    assert.ok(html.includes(`<p id="watermark-help" class="muted" style="margin-top:0">${(lang === "fr" ? fr : en).ui_watermark_help.replace(/'/g, "&#39;")}</p>`), lang);
  }
});

test("la page : la case est DÉCOCHÉE (aucun attribut checked), fait au moins 44 px de haut (toute la ligne se touche), se règle au clavier (vraie case native, dans l'ordre du document)", async () => {
  const html = await (await page.studioPage(mkCtx(), { base: "/m/story", colors: {}, timezone: "", font: "", accent: "#4f46e5", accentFg: "#ffffff" })).text();
  const box = /<input type="checkbox" id="watermark"[^>]*>/.exec(html)[0];
  assert.ok(!/checked/.test(box), box); assert.ok(!/tabindex/.test(box), "dans l'ordre naturel du clavier");
  assert.match(html, /label\.check\.tap\{[^}]*min-height:44px/);
  assert.ok(html.indexOf('id="text"') < html.indexOf('id="watermark"') && html.indexOf('id="watermark"') < html.indexOf('id="members-box"'), "dans « Personnaliser », juste après le style et la phrase, avant les co-streamers");
  assert.ok(html.indexOf('id="watermark"') < html.indexOf('id="advanced"'), "le choix de la mention n'est pas rangé dans les options avancées");
  assert.ok(/aria-describedby="watermark-help"/.test(box) && html.includes('id="watermark-help"'));
});

/* ───────────── Décochée par défaut, choix retenu ───────────── */

test("par défaut : la configuration n'ajoute rien (décochée) ; seul un vrai booléen vrai l'ajoute ; la route de données le dit", async () => {
  assert.equal(P.DEFAULT_CONFIG.watermark, false); assert.equal(P.cleanConfig({}).watermark, false); assert.equal(P.cleanConfig(null).watermark, false);
  for (const v of ["true", 1, "on", {}, [], null]) assert.equal(P.cleanConfig({ watermark: v }).watermark, false, JSON.stringify(v));
  assert.equal(P.cleanConfig({ watermark: true }).watermark, true);
  assert.equal(P.cleanConfig({}, { watermark: true }).watermark, true, "valeur de repli");
  assert.equal(P.cleanConfig({ watermark: false }, { watermark: true }).watermark, false);
  const ctx = mkCtx(), token = await data.mintToken(ctx);
  const r = await json(await call(ctx, "data", { token }));
  assert.equal(r.defaults.watermark, false); assert.equal(await data.watermarkDefault(ctx), false);
  assert.equal((await ctx.api.store.list("story_prefs")).length, 0, "lire ne crée rien");
});

test("valeur retenue : cocher puis décocher est gardé (un seul document, un simple oui/non) ; il l'emporte sur le réglage du module ; sans choix, le réglage donne la valeur de départ", async () => {
  const ctx = mkCtx(), token = await data.mintToken(ctx);
  let r = await act(ctx, token, { op: "prefs.watermark", watermark: true });
  assert.deepEqual([r.status, r.ok, r.watermark], [200, true, true]);
  assert.equal((await json(await call(ctx, "data", { token }))).defaults.watermark, true, "la prochaine ouverture : cochée");
  r = await act(ctx, token, { op: "prefs.watermark", watermark: false });
  assert.equal(r.watermark, false); assert.equal((await json(await call(ctx, "data", { token }))).defaults.watermark, false);
  const docs = await ctx.api.store.list("story_prefs"); assert.equal(docs.length, 1); assert.deepEqual(docs[0].data, { watermark: false });
  const withSetting = mkCtx({ settings: { watermark: true } });
  assert.equal(await data.watermarkDefault(withSetting), true, "le réglage du module = valeur de départ");
  await data.setWatermarkPref(withSetting, false);
  assert.equal(await data.watermarkDefault(withSetting), false, "le choix de la personne l'emporte");
  for (const bad of ["true", 1, null, undefined, "yes"]) { const x = await act(ctx, token, { op: "prefs.watermark", watermark: bad }); assert.deepEqual([x.status, x.ok], [400, false], JSON.stringify(bad)); }
  assert.equal((await act(ctx, "", { op: "prefs.watermark", watermark: true })).status, 401, "jeton obligatoire");
  assert.equal((await ctx.api.store.list("story_prefs"))[0].data.watermark, false, "un refus n'écrit rien");
});

/* ───────────── MCP ───────────── */

test("MCP : `watermark` facultatif (défaut = le choix de la personne), vrai/faux acceptés, tout autre type refusé ; les anciens appels et outils ne changent pas ; un modèle n'emporte jamais la mention", async () => {
  const ctx = mkCtx(), token = await data.mintToken(ctx);
  let r = await prepare(ctx, {});
  assert.equal(r.prepared.watermark, false); assert.equal((await prepOf(ctx, r)).config.watermark, false);
  assert.deepEqual(Object.keys(r.prepared).sort(), ["costreamers", "durationSeconds", "elements", "format", "stream", "style", "text", "watermark"], "un seul champ ajouté, rien retiré");
  r = await prepare(ctx, { watermark: true }); assert.equal(r.prepared.watermark, true); assert.equal((await prepOf(ctx, r)).config.watermark, true);
  await act(ctx, token, { op: "prefs.watermark", watermark: true });
  r = await prepare(ctx, {}); assert.equal(r.prepared.watermark, true, "défaut = réglage retenu");
  r = await prepare(ctx, { watermark: false }); assert.equal(r.prepared.watermark, false, "l'IA peut le retirer pour cette vidéo");
  assert.equal(await data.watermarkDefault(ctx), true, "et ne change pas le choix retenu");
  for (const bad of ["true", 1, 0, null, {}, []]) await assert.rejects(prepare(ctx, { watermark: bad }), /'watermark' must be true or false/, JSON.stringify(bad));
  const saved = await act(ctx, token, { op: "model.save", name: "Avec marque", config: { ...P.DEFAULT_CONFIG, watermark: true } });
  assert.equal(saved.items[0].config.watermark, false, "jamais dans un modèle");
  r = await prepare(ctx, { model: "Avec marque" }); assert.equal(r.prepared.watermark, true, "un modèle n'ôte ni n'ajoute rien : le choix retenu s'applique");
  assert.equal(Object.hasOwn((await def.mcp.story_models(ctx)).models[0], "watermark"), false, "story_models inchangé");
  assert.equal(tools.strictPrepare({}, { models: [], tz: "UTC" }).config.watermark, false, "sans information : NON");
});

/* ───────────── Le dessin ───────────── */

const THEME = { accent: "#7c5cff", accent2: "#ff4d8d", bg: "#101018", fg: "#f2f2f2" };
const members = ["Alice", "Bob"].map((name, i) => ({ login: `chaine_${i}`, name }));
function scene({ style = "neon", format = "vertical", watermark, colors = THEME, n = 2, text = "Ce soir, on rigole bien !", duration = 15, font, wordmarkFont = "CuriosaWordmark" } = {}) {
  const content = P.buildContent({ ...P.DEFAULT_CONFIG, style, format, text, costreamers: members.slice(0, n).map((m) => m.login) }, { stream: { title: "Grande soirée découverte", startMs: Date.parse("2026-10-22T17:30:00Z"), allDay: false, games: ["Hades"], timezone: "Europe/Brussels" }, coStreamers: members.slice(0, n), site: { name: "Emma Live" }, nowMs: NOW, tz: "Europe/Brussels" });
  return S.createScene({ style, format, duration, content, assets: { logo: fakeImage(200, 200), cover: fakeImage(600, 338), avatars: {} }, colors, font, measureContext: fakeCanvasContext(), wordmarkFont, ...(watermark === undefined ? {} : { watermark }) });
}
const frame = (sc, t) => { const ctx = fakeCanvasContext(); sc.draw(ctx, t); return ctx.log; };
/** Les mentions d'une image : des paires [« Made with », « Curiosa »] (deux dessins de texte qui se suivent). */
const marks = (log) => log.flatMap((l, i) => (l[0] === "fillText" && l[1] === P.WATERMARK_LEAD && log[i + 1]?.[1] === P.WATERMARK_NAME ? [[l, log[i + 1]]] : []));
const px = (font) => Number(/(\d+(?:\.\d+)?)px/.exec(font)[1]);

test("pas de case cochée, pas de mention : ni dessin ni place réservée, la mise en page est identique à celle de la 2.1 (aucun ajout sans la case)", () => {
  for (const style of P.STYLES) for (const format of ["vertical", "passeport"]) {
    const plain = scene({ style, format }), off = scene({ style, format, watermark: false }), junk = scene({ style, format, watermark: "true" });
    assert.equal(plain.watermark, null); assert.equal(off.watermark, null); assert.equal(junk.watermark, null, "seul un vrai `true` compte");
    for (const t of [0, 0.5, 3, 7, 15]) assert.equal(marks(frame(plain, t)).length, 0, `${style}/${format}/${t}`);
    assert.deepEqual(plain.boxes, off.boxes); assert.deepEqual(frame(plain, 5), frame(off, 5));
  }
});

test("la mention est demandée au moteur de rendu sur TOUTES les images (du premier au dernier instant), une seule fois par image, immobile, opaque, sans animation", () => {
  for (const style of P.STYLES) for (const format of ["vertical", "passeport"]) {
    const sc = scene({ style, format, watermark: true }), first = marks(frame(sc, 0));
    assert.equal(first.length, 1, `${style}/${format} : présente dès la première image`);
    assert.equal(first[0][0][5], "left"); assert.equal(first[0][0][6], 1); assert.equal(first[0][1][6], 1, "pleinement opaque (jamais en fondu)");
    for (let i = 0; i <= 15 * 30; i++) {
      const m = marks(frame(sc, i / 30));
      assert.equal(m.length, 1, `${style}/${format} image ${i}`);
      assert.deepEqual(m[0], first[0], `${style}/${format} image ${i} : même place, même police, même opacité (aucun mouvement)`);
    }
    const lenient = scene({ style, format, watermark: true, duration: 5 });
    assert.equal(marks(frame(lenient, 5)).length, 1, "et à la toute dernière image d'une vidéo courte");
  }
});

test("la place : centrée, en bas de la zone sûre (au-dessus de la zone qu'Instagram recouvre), dans les marges, sans toucher le contenu ni une zone cachée, 28 à 32 px, police de la vidéo", () => {
  for (const style of P.STYLES) for (const format of ["vertical", "passeport"]) for (const n of [0, 3, 6]) for (const text of ["", "Une phrase de trois lignes pour remplir au maximum la zone sûre de la vidéo, vraiment !"]) {
    const sc = scene({ style, format, n, text, watermark: true, font: "Inter, sans-serif" }), f = P.formatOf(format), A = P.safeArea(f), w = sc.watermark, where = `${style}/${format}/${n}/${text.length}`;
    const [lead, name] = marks(frame(sc, 3))[0], font = lead[4], x = lead[2], [p1, p2] = w.parts;
    assert.equal(lead[3], name[3], `${where} : même ligne de base`);
    const w1 = P.WATERMARK_LEAD.length * px(lead[4]) * 0.55, w2 = P.WATERMARK_NAME.length * px(name[4]) * 0.55;
    assert.ok(Math.abs(x + (w1 + w2) / 2 - f.width / 2) <= 1.5, `${where} : l'ensemble est centré (${x})`);
    assert.ok(Math.abs(name[2] - (x + w1)) <= 1, "« Curiosa » suit « Made with » sans trou");
    assert.match(name[4], /^italic 600 34\.5px "CuriosaWordmark", Georgia, serif$/, "Fraunces italique 600, 1,15 fois plus grand");
    assert.ok(p1.x === x && p2.x === name[2]);
    assert.ok(w.x >= A.x && w.x + w.w <= A.x + A.w && w.y >= A.y && w.y + w.h <= A.y + A.h + 0.5, `${where} : dans la zone sûre`);
    assert.ok(Math.abs(w.x + w.w / 2 - f.width / 2) <= 1);
    assert.ok(A.y + A.h - (w.y + w.h) < 1, `${where} : tout en bas de la zone sûre, donc juste au-dessus de la barre de réponse d'Instagram`);
    if (format === "vertical") assert.ok(w.y + w.h <= 1920 - 250 && w.y + w.h <= 1580, `${where} : au-dessus des 250 px (et des 340 px) recouverts par Instagram`);
    for (const z of f.zones) assert.ok(w.x + w.w <= z.x || w.x >= z.x + z.w || w.y + w.h <= z.y || w.y >= z.y + z.h, `${where} : hors de la zone « ${z.id} »`);
    for (const b of sc.boxes) assert.ok(b.y + b.h <= w.y, `${where} : ${b.id} reste au-dessus de la mention`);
    assert.ok(px(font) >= 28 && px(font) <= 32, `${where} : ${font}`);
    assert.match(font, /Inter, sans-serif$/, "« Made with » : la police du reste de la vidéo");
    assert.ok(w1 + w2 + 40 < w.w && x > w.x && name[2] + w2 < w.x + w.w, `${where} : les deux segments tiennent dans leur pastille`);
    assert.ok(lead[3] > w.y && lead[3] < w.y + w.h, "le texte est dans sa pastille");
  }
});

test("contraste : le texte est lisible (≥ 4,5:1) sur la couleur de fond du modèle, pour chaque style et pour des fonds sombres, clairs et colorés du style « Minimal » ; la pastille a la couleur du fond", () => {
  for (const style of ["neon", "poster", "countdown"]) for (const accent of ["#7c5cff", "#ffd400", "#00c2a8", "#ffffff", "#000000"]) {
    const w = scene({ style, watermark: true, colors: { ...THEME, accent, accent2: accent } }).watermark;
    assert.ok(w.contrast >= 4.5, `${style}/${accent} : le pire fond du dégradé garde ${w.contrast.toFixed(2)}`);
  }
  const seen = new Set();
  for (const bg of ["#ffffff", "#f8f6ef", "#e9d8a6", "#ffcc00", "#777777", "#767676", "#00a050", "#101018", "#000000", "#1b1b3a", "#808080", "#5a5a5a", "#b0b0b0"]) {
    const w = scene({ style: "minimal", watermark: true, colors: { ...THEME, bg, fg: P.readableOn(bg) } }).watermark;
    const over = P.mix(bg, w.background, 0.6);
    assert.ok(P.contrast(w.color, over) >= 4.5 && w.contrast >= 4.5, `fond ${bg} : texte ${w.color} sur pastille ${w.background} → ${P.contrast(w.color, over).toFixed(2)}`);
    if (P.contrast(w.color, bg) >= 4.5) assert.equal(w.background, bg, "quand le fond suffit, la pastille reprend exactement le fond du modèle");
    seen.add(w.color);
  }
  assert.deepEqual([...seen].sort(), ["#111111", "#ffffff"], "texte blanc sur fond sombre, presque noir sur fond clair");
});

test("anti-crénelage et coût : positions entières, aucun flou ni ombre résiduelle, une pastille arrondie + un trait + un texte par image (≤ 12 appels de plus, toujours les mêmes) ; le dessin reste dans save/restore", () => {
  const sc = scene({ style: "poster", watermark: true }), base = scene({ style: "poster" });
  const [lead] = marks(frame(sc, 1))[0], x = lead[2], y = lead[3];
  assert.ok(Number.isInteger(sc.watermark.x) && Number.isInteger(sc.watermark.y) && Number.isInteger(sc.watermark.w) && Number.isInteger(x), "x entier");
  assert.ok(Number.isInteger(y * 2), "y au demi-pixel au plus");
  const counts = [0, 0.4, 3, 9, 15].map((t) => frame(sc, t).length - frame(base, t).length);
  assert.ok(counts.every((c) => c === counts[0]) && counts[0] > 0 && counts[0] <= 12, `appels ajoutés par image : ${counts}`);
  const ctx = fakeCanvasContext(); ctx.shadowBlur = 40; ctx.globalAlpha = 0.5; sc.draw(ctx, 2);
  assert.equal(ctx.state.shadowBlur, 40, "l'état du contexte est restitué"); 
  assert.equal(ctx.state.globalAlpha, 0.5, "l'opacité aussi");
});

test("la vidéo entière : chaque image d'un enregistrement 30 i/s contient la mention (aussi au format passeport) ; l'aperçu de l'éditeur utilise le même dessin", () => {
  const sc = scene({ style: "countdown", format: "passeport", watermark: true, duration: 5 });
  let n = 0; for (let i = 0; i < 5 * sc.fps; i++) { assert.equal(marks(frame(sc, i / sc.fps)).length, 1, `image ${i}`); n++; }
  assert.equal(n, 150);
});

/* ───────────── L'éditeur (faux navigateur) ───────────── */
/* ───────────── Un faux navigateur, juste assez ───────────── */
class Text { constructor(t) { this.nodeType = 3; this.textContent = String(t); } }
class El {
  constructor(tag) { this.nodeType = 1; this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this._text = ""; this.hidden = false; this.value = ""; this.checked = false; this.disabled = false; this.className = ""; this.dataset = {}; this.style = {}; this.open = false; this.ctx = null; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
  set textContent(v) { this.children = []; this._text = String(v); }
  append(...kids) { for (const k of kids) this.children.push(k); }
  replaceChildren(...kids) { this.children = []; this._text = ""; this.append(...kids); }
  setAttribute(k, v) { this.attrs[k] = v; if (k === "id") this.id = v; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type, ev = {}) { for (const fn of this.listeners[type] ?? []) fn({ key: "", preventDefault() {}, target: this, ...ev }); }
  click() { if (!this.isDisabled) this.fire("click"); }
  get isDisabled() { return this.disabled || "disabled" in this.attrs; }
  focus() {}
  getContext() { return (this.ctx ??= fakeCanvasContext()); }
  querySelectorAll() { return []; }
}
const walk = (el, out = []) => { out.push(el); for (const c of el.children ?? []) if (c.nodeType === 1) walk(c, out); return out; };
const buttons = (root) => walk(root).filter((e) => e.tagName === "button");

function installDom(html, token) {
  const els = new Map();
  for (const m of html.matchAll(/<(\w+)([^>]*?)>/g)) {
    const id = /\sid="([^"]+)"/.exec(m[2])?.[1];
    if (!id || els.has(id)) continue;
    const el = new El(m[1]); el.id = id; el.hidden = /(^|\s)hidden(\s|=|$)/.test(m[2]);
    els.set(id, el);
  }
  els.get("story-config").textContent = /<script type="application\/json" id="story-config">(.*?)<\/script>/s.exec(html)[1];
  const body = new El("body"); body.classList = { toggle() {} };
  const document = { getElementById: (id) => els.get(id) ?? null, createElement: (t) => new El(t), createTextNode: (t) => new Text(t), querySelectorAll: () => [], body, fonts: globalThis.__fonts };
  Object.assign(globalThis, {
    document, Image: class { set src(v) { this._src = v; setTimeout(() => this.onload?.(), 0); } get src() { return this._src; } width = 100; height = 100; naturalWidth = 100; naturalHeight = 100; },
    location: { hash: `#t=${token}`, pathname: "/m/story/studio", search: "" }, history: { replaceState() {} }, matchMedia: () => ({ matches: true }) /* mouvement réduit : la vidéo est dessinée au repos */, requestAnimationFrame: () => 0,
  });
  return els;
}

/** Un serveur : les routes du module derrière un faux fetch (les images d'ailleurs rendent un PNG). */
function installServer(ctx, token) {
  const log = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), SITE);
    if (url.origin !== SITE) return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    const route = url.pathname.replace(/^\/m\/story\//, "");
    log.push([init.method ?? "GET", route + url.search]);
    return def.routes[route](new Request(url, { method: init.method ?? "GET", headers: init.headers, body: init.body }), ctx);
  };
  return { log, restore: () => { globalThis.fetch = realFetch; } };
}

async function boot(ctx, tag) {
  const token = await data.mintToken(ctx);
  const html = await (await def.routes.studio(new Request(`${SITE}/m/story/studio`), ctx)).text();
  const server = installServer(ctx, token), els = installDom(html, token);
  await import(`../modules/stream-story/app.mjs?${tag}`);
  await wait(600);
  return { els, server, token };
}

const drawnMarks = (els) => els.get("preview").getContext().log.filter((l) => l[0] === "fillText" && l[1] === P.WATERMARK_NAME).length;
const bootStudio = async (ctx, tag, { prep } = {}) => {
  const token = await data.mintToken(ctx);
  const html = await (await def.routes.studio(new Request(`${SITE}/m/story/studio`), ctx)).text();
  const server = installServer(ctx, token), els = installDom(html, token + (prep ? `&p=${prep}` : ""));
  await import(`../modules/stream-story/app.mjs?wm-${tag}`);
  await wait(700);
  return { els, server };
};
const manualEvent = async (els) => { els.get("event-manual-toggle").click(); els.get("m-title").value = "Soirée"; els.get("m-title").fire("input"); els.get("m-date").value = "2030-01-05"; els.get("m-date").fire("input"); els.get("m-time").value = "20:00"; els.get("m-time").fire("input"); await wait(500); };

test("éditeur : la case est décochée à l'ouverture, l'aperçu n'a pas la mention ; cocher l'ajoute à l'aperçu et le choix est envoyé et RETENU ; à la prochaine ouverture elle est cochée ; décocher la retire", async () => {
  const ctx = mkCtx();
  let { els, server } = await bootStudio(ctx, "a");
  try {
    await manualEvent(els);
    const box = els.get("watermark");
    assert.equal(box.checked, false, "décochée par défaut"); assert.equal(drawnMarks(els), 0, "aucune mention sans la case");
    box.checked = true; box.fire("change"); await wait(500);
    assert.ok(drawnMarks(els) >= 1, "l'aperçu montre la mention");
    assert.deepEqual(server.log.filter(([m]) => m === "POST").length, 1);
    assert.equal((await ctx.api.store.list("story_prefs"))[0].data.watermark, true, "choix retenu côté module");
  } finally { server.restore(); }
  ({ els, server } = await bootStudio(ctx, "b"));
  try {
    await manualEvent(els);
    assert.equal(els.get("watermark").checked, true, "la case reprend le choix de la dernière fois"); assert.ok(drawnMarks(els) >= 1, "et l'aperçu avec");
    els.get("watermark").checked = false; els.get("watermark").fire("change"); await wait(300);
    const before = drawnMarks(els); els.get("preview").getContext().log.length = 0; await wait(10);
    els.get("duration").value = "9"; els.get("duration").fire("input"); await wait(400);
    assert.equal(drawnMarks(els), 0, `retirée (avant : ${before})`);
    assert.equal((await ctx.api.store.list("story_prefs"))[0].data.watermark, false);
  } finally { server.restore(); }
});

test("éditeur : un modèle enregistré ne garde pas la mention et ne change pas la case en le chargeant ; une demande d'assistant arrive avec sa propre valeur (cochée) sans changer le choix retenu", async () => {
  const ctx = mkCtx();
  let { els, server } = await bootStudio(ctx, "c");
  try {
    await manualEvent(els);
    els.get("watermark").checked = true; els.get("watermark").fire("change"); await wait(300);
    els.get("model-name").value = "Mon modèle"; buttons(els.get("model-list")); els.get("model-save").click(); await wait(500);
    assert.equal((await ctx.api.store.list("story_models"))[0].data.items[0].config.watermark, false);
    const load = buttons(els.get("model-list")).find((b) => b.textContent === "Charger"); load.click(); await wait(300);
    assert.equal(els.get("watermark").checked, true, "charger un modèle ne décoche pas la case");
  } finally { server.restore(); }
  const ctx2 = mkCtx(), r = await prepare(ctx2, { watermark: true, streamTitle: "Marathon", streamDate: "2030-02-01", streamTime: "14:00" });
  ({ els, server } = await bootStudio(ctx2, "d", { prep: /prep=([A-Za-z0-9_-]{22})/.exec(r.link)[1] }));
  try {
    assert.equal(els.get("watermark").checked, true, "la préparation de l'assistant demandait la mention"); assert.ok(drawnMarks(els) >= 1);
    assert.equal(await data.readWatermarkPref(ctx2), null, "ouvrir ne change pas le choix retenu");
  } finally { server.restore(); }
  const ctx3 = mkCtx(), r3 = await prepare(ctx3, { streamTitle: "Marathon", streamDate: "2030-02-01", streamTime: "14:00" });
  ({ els, server } = await bootStudio(ctx3, "e", { prep: /prep=([A-Za-z0-9_-]{22})/.exec(r3.link)[1] }));
  try { assert.equal(els.get("watermark").checked, false); assert.equal(drawnMarks(els), 0); } finally { server.restore(); }
});

test("éditeur en anglais : la case et son aide sont traduites, la mention dessinée reste « Made with Curiosa »", async () => {
  const ctx = mkCtx({ locale: "en", messages: { ...en } });
  const { els, server } = await bootStudio(ctx, "f");
  try {
    await manualEvent(els);
    els.get("watermark").checked = true; els.get("watermark").fire("change"); await wait(500);
    assert.ok(drawnMarks(els) >= 1);
    const texts = els.get("preview").getContext().log.filter((l) => l[0] === "fillText").map((l) => l[1]);
    assert.ok(texts.includes(P.WATERMARK_LEAD) && texts.includes(P.WATERMARK_NAME) && !texts.some((t) => /Fait avec|Créé avec/.test(t)));
  } finally { server.restore(); }
});

/* ───────────── La police du nom « Curiosa » (charte du logo) ───────────── */

test("police du nom : copie EXACTE du fichier du cœur (Fraunces italique, ≈ 1,7 Ko) avec sa licence SIL OFL à côté ; servie par une route du module, sans jeton ni appel extérieur", async () => {
  const bytes = fs.readFileSync(`${DIR}/curiosa-wordmark.woff2`);
  assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2"); assert.ok(bytes.length > 1000 && bytes.length < 3000, String(bytes.length));
  const core = process.env.CURIOSA_DIR ? `${process.env.CURIOSA_DIR}/src/components/brand/curiosa-wordmark.woff2` : "";
  if (core && fs.existsSync(core)) assert.ok(bytes.equals(fs.readFileSync(core)), "identique à celle du cœur");
  assert.match(read("curiosa-wordmark.OFL.txt"), /SIL Open Font License, Version 1\.1/); assert.match(read("curiosa-wordmark.OFL.txt"), /Fraunces/);
  const real = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw new Error("réseau"); };
  try {
    const r = await def.routes.wordmark(new Request(`${SITE}/m/story/wordmark`), mkCtx());
    assert.deepEqual([r.status, r.headers.get("content-type")], [200, "font/woff2"]); assert.ok(Buffer.from(await r.arrayBuffer()).equals(bytes));
    assert.equal((await def.routes.wordmark(new Request(`${SITE}/m/story/wordmark`, { method: "POST" }), mkCtx())).status, 405);
  } finally { globalThis.fetch = real; }
  assert.equal(calls, 0, "aucun appel réseau");
  assert.match(read("README.md"), /OFL/);
});

test("deux segments : « Made with » dans la police de la vidéo, « Curiosa » en Fraunces italique 600 (C majuscule, 1,15×), même ligne de base ; sans la police chargée, Georgia italique 600 prend le relais", () => {
  const ok = scene({ watermark: true, font: "Inter, sans-serif" }), [lead, name] = marks(frame(ok, 2))[0];
  assert.match(lead[4], /^600 30px Inter, sans-serif$/); assert.match(name[4], /^italic 600 34\.5px "CuriosaWordmark", Georgia, serif$/); assert.equal(name[1][0], "C");
  const fb = scene({ watermark: true, font: "Inter, sans-serif", wordmarkFont: "" }), [, name2] = marks(frame(fb, 2))[0];
  assert.equal(name2[4], "italic 600 34.5px Georgia, serif", "repli propre");
  const bad = scene({ watermark: true, wordmarkFont: 'x"; evil' }), [, name3] = marks(frame(bad, 2))[0];
  assert.ok(!name3[4].includes("evil"), "nom de police inconnu refusé");
  assert.ok(fb.watermark.w >= 0 && ok.watermark.parts.length === 2);
});

const namesDrawn = (els) => els.get("preview").getContext().log.filter((l) => l[0] === "fillText" && l[1] === P.WATERMARK_NAME).map((l) => l[4]);
async function withFont(mode, tag) {
  const faces = [], added = [];
  globalThis.FontFace = class { constructor(family, data, desc) { this.family = family; this.bytes = data.byteLength; this.desc = desc; faces.push(this); } load() { return mode === "ok" ? Promise.resolve(this) : mode === "fail" ? Promise.reject(new Error("police illisible")) : new Promise(() => {}); } };
  globalThis.__fonts = { add: (f) => added.push(f) };
  const ctx = mkCtx(); await data.setWatermarkPref(ctx, true);
  const { els, server } = await bootStudio(ctx, tag);
  try { await manualEvent(els); await wait(mode === "slow" ? 3600 : 300); return { faces, added, drawn: namesDrawn(els), log: server.log, generate: els.get("generate") }; }
  finally { server.restore(); delete globalThis.FontFace; delete globalThis.__fonts; }
}

test("éditeur : la police du nom est chargée avant le premier dessin (FontFace depuis le fichier du module, via sa route), et le dessin l'utilise", async () => {
  const r = await withFont("ok", "g");
  assert.equal(r.faces.length, 1); assert.deepEqual([r.faces[0].family, r.faces[0].desc], ["CuriosaWordmark", { style: "italic", weight: "600" }]);
  assert.ok(r.faces[0].bytes > 1000 && r.faces[0].bytes < 3000, "le fichier du module, pas autre chose");
  assert.equal(r.added.length, 1, "ajoutée à document.fonts");
  assert.ok(r.log.some(([m, route]) => m === "GET" && route === "wordmark"));
  assert.ok(r.drawn.length > 0 && r.drawn.every((f) => /^italic 600 34\.5px "CuriosaWordmark", Georgia, serif$/.test(f)), r.drawn[0]);
});

test("éditeur : police illisible → repli Georgia italique 600, la mention est dessinée et la génération reste possible", async () => {
  const r = await withFont("fail", "h");
  assert.equal(r.added.length, 0);
  assert.ok(r.drawn.length > 0 && r.drawn.every((f) => f === "italic 600 34.5px Georgia, serif"), r.drawn[0]);
  assert.equal(r.generate.isDisabled, false, "le bouton « Générer la vidéo » n'est pas bloqué");
});

test("éditeur : police trop lente (délai de 3 s) → repli, rien ne reste bloqué ; navigateur sans FontFace → repli aussi", async () => {
  const t0 = Date.now(), r = await withFont("slow", "i");
  assert.ok(Date.now() - t0 < 9000);
  assert.ok(r.drawn.length > 0 && r.drawn.every((f) => f === "italic 600 34.5px Georgia, serif"));
  const ctx = mkCtx(); await data.setWatermarkPref(ctx, true);
  const { els, server } = await bootStudio(ctx, "j");
  try { await manualEvent(els); await wait(300); assert.ok(namesDrawn(els).every((f) => f === "italic 600 34.5px Georgia, serif") && namesDrawn(els).length > 0); } finally { server.restore(); }
});
