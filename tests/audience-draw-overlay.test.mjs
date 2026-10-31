// Participation 1.2.0 — l'ÉCRAN du tirage au sort : le « direct » (même mécanique que Sondages), l'overlay seul (personnes tirées 20 secondes) et l'ÉLÉMENT « Tirage au sort » des pages d'overlay
// (cœur 0.5.0, docs/OVERLAY-ELEMENTS.md) : manifeste, adresse, page (jetons --ov-*, jamais le skin du site), comportement dans un navigateur factice, plusieurs lecteurs (assertMultiReaders), mise à jour douce.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { audienceCtx, def, fr, en, K, req, manifest } from "./helpers/audienceHarness.mjs";
import { El } from "./helpers/remoteDom.mjs";
import { parseManifest } from "@/core/modules/manifest";
import { parseAddress, finalAddress } from "@/core/overlays/address";

const core = path.resolve(process.env.CURIOSA_DIR ?? process.cwd());
const { assertMultiReaders } = await import(pathToFileURL(path.join(core, "testsupport/index.mjs")).href);
const D = await import("../modules/audience/draw.mjs");
const P = await import("../modules/audience/drawlib.mjs");
const decl = manifest.overlayElements[0];

const FORM = { title: "Cadeau du jour", keyword: "!cadeau", level: "all", site: true, minutes: null, winners: 1 };
const open = async (c, over = {}, now = Date.now()) => { const r = await D.openNew(c, { ...FORM, ...over }, { now }); assert.ok(r.ok); return r.draw; };
const chat = (c, name) => def.services["audience.draw"].enter(c, { pseudo: name, platform: "twitch", login: name.toLowerCase() });
const resetThrottle = () => globalThis.__curiosaAudienceDraw.sync.clear();
const STYLE = { text: "light", background: "transparent", corners: "round" };
const request = (over = {}) => ({ element: "draw", fit: "fluid", width: 900, height: 300, style: STYLE, options: { keep: false }, lang: "fr", ...over });
const elementQuery = async (c, extra = {}) => new URLSearchParams({ k: await D.screenKey(c), "ov-w": "900", "ov-h": "300", "ov-fit": "fluid", "ov-lang": "fr", "ov-text": "light", "ov-surface": "transparent", "ov-corners": "round", "opt-keep": "0", ...extra });
const confOf = (o) => JSON.parse(/window\.__DW=(\{.*?\});\(function/s.exec(o.script)[1].replace(/\\u003c/g, "<"));
const directUrl = (c, key, rev = "") => `https://x.test/m/${c.instance.key}/direct?room=draw&channel=screen&k=${encodeURIComponent(key)}${rev ? `&rev=${rev}` : ""}`;
let ipn = 0;
const direct = async (c, key, rev = "") => (await def.routes.direct(req(directUrl(c, key, rev), undefined, { ip: `9.8.${Math.floor(ipn / 200)}.${(ipn++ % 200) + 1}` }), c)).json();

/* ───────────── Manifeste et adresse ───────────── */

test("manifeste : un élément « draw », fluide, plage de ratios et taille minimale, suit le style, contenu d'exemple, une option « garder à l'écran » ; minCore 0.5.0 ; permission overlay", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.minCore, "0.5.0"); assert.ok(manifest.permissions.includes("overlay"));
  assert.equal(manifest.overlayElements.length, 1);
  assert.deepEqual([decl.id, decl.fit, decl.followsStyle, decl.demo], ["draw", "fluid", true, true]);
  assert.deepEqual(decl.minSize, { width: 280, height: 160 });
  assert.ok(decl.ratios.min <= 400 / 700 && decl.ratios.max >= 1600 / 400, "les cadres 400×700, 900×300 et 1600×400 sont dans la plage");
  assert.deepEqual(decl.options.map((o) => [o.id, o.type, o.default]), [["keep", "boolean", false]]);
  for (const k of ["fr", "en"]) { assert.ok(decl.label[k] && decl.description[k] && decl.options[0].label[k] && decl.options[0].help[k]); }
  assert.equal(typeof def.overlayElements.draw, "function"); assert.equal(typeof def.overlay, "function");
  assert.deepEqual(Object.keys(def.overlayElements), manifest.overlayElements.map((e) => e.id));
  const words = JSON.stringify([decl.label, decl.description, decl.options.map((o) => [o.label, o.help])]);
  assert.ok(!/\bfluid\b|\bscale\b|iframe|\bfit\b/i.test(words), "pas de mot technique montré aux personnes");
  assert.ok(!/\btu\b|\bton\b|\bta\b|\btes\b/i.test(JSON.stringify(decl.options[0].help.fr + decl.description.fr)), "vouvoiement");
});

test("overlayElements.draw : l'adresse de l'overlay avec le code secret ajouté côté serveur ; chemin accepté par le cœur ; stable ; « nouvelle adresse » coupe l'ancienne", async () => {
  const c = audienceCtx(); const c2 = audienceCtx();
  const a = await def.overlayElements.draw(c, request()); const key = await D.screenKey(c);
  assert.equal(a.url, `/overlays/${c.instance.key}?k=${encodeURIComponent(key)}&lang=fr`);
  const parsed = parseAddress(a); assert.ok(parsed); assert.equal(parsed.path, `/overlays/${c.instance.key}`); assert.equal(parsed.search.get("k"), key);
  assert.equal((await def.overlayElements.draw(c, request())).url, a.url, "un seul code, pas un par lecteur");
  assert.notEqual((await def.overlayElements.draw(c2, request())).url, a.url);
  assert.ok(!(await def.overlayElements.draw(c, request({ lang: 'x"><script>' }))).url.includes("script"));
  const fin = finalAddress(parsed, { decl, layout: { iframeW: 900, iframeH: 300 }, style: STYLE, options: { keep: true }, lang: "fr" });
  const q = new URL(fin, "https://x.test").searchParams;
  assert.deepEqual([q.get("k"), q.get("ov-fit"), q.get("ov-w"), q.get("ov-h"), q.get("opt-keep"), q.get("ov-text")], [key, "fluid", "900", "300", "1", "light"]);
  await open(c); await D.syncLive(c);
  assert.ok((await direct(c, key)).data, "l'ancienne adresse lit");
  await D.regenerateScreenKey(c);
  assert.equal((await direct(c, key)).empty, true, "l'ancienne adresse ne lit plus rien");
  const fresh = await D.screenKey(c); assert.notEqual(fresh, key);
  resetThrottle(); assert.equal((await direct(c, fresh)).data.title, FORM.title, "la nouvelle adresse lit tout de suite (publié à la lecture)");
});

/* ───────────── La page ───────────── */

test("page de l'élément : remplit le cadre, jetons --ov-* avec repli, attributs data-ov-part, jamais le skin du site ; sans le bon code, un cadre vide ; l'overlay seul reste en bas à gauche", async () => {
  const c = audienceCtx(); await open(c);
  const el = await def.overlay(c, { query: await elementQuery(c) });
  assert.ok(el.css.includes("--ov-fg:#ffffff") && el.css.includes("--ov-surface:transparent") && el.css.includes("--ov-radius:12px"));
  assert.ok(el.css.includes('[data-ov-region="element"]{position:fixed;inset:0') && el.css.includes("var(--ov-fg,"));
  assert.ok(el.html.includes('data-ov-region="element"'));
  for (const part of ["panel", "body", "status", "title", "how", "foot", "winners", "winner", "clock"]) assert.ok(el.css.includes(`data-ov-part="${part}"`), part);
  assert.ok(!/--sk-|data-skin|skin/i.test(el.css + el.html + el.script), "ni --sk-* ni data-skin-*");
  assert.ok(!/<link|@import|https?:\/\//.test(el.css + el.html), "aucun chargement tiers");
  const dark = await def.overlay(c, { query: await elementQuery(c, { "ov-text": "dark", "ov-surface": "soft", "ov-corners": "square" }) });
  assert.ok(dark.css.includes("--ov-fg:#111111") && dark.css.includes("rgba(255,255,255,.7)") && dark.css.includes("--ov-radius:0px"));
  const conf = confOf(el); assert.deepEqual([conf.el, conf.keep], [true, false]);
  assert.equal(conf.url, `/m/${c.instance.key}/direct?room=draw&channel=screen&k=${encodeURIComponent(await D.screenKey(c))}`);
  assert.equal(confOf(await def.overlay(c, { query: await elementQuery(c, { "opt-keep": "1" }) })).keep, true);
  assert.ok(el.script.includes("window.__DW=") && !el.script.includes(await D.screenKey(c)) === false, "le code est dans l'adresse de lecture donnée à la page");
  // sans le bon code : rien (élément) ou un message (overlay seul)
  const wrong = await def.overlay(c, { query: new URLSearchParams({ k: "nimporte", "ov-fit": "fluid" }) });
  assert.equal(wrong.html, ""); assert.ok(!wrong.script);
  const lone = await def.overlay(c, { query: new URLSearchParams({ k: "nimporte" }) });
  assert.ok(lone.html.includes(fr.drawScreenIncomplete.replace(/'/g, "&#39;")) && !lone.script);
  const solo = await def.overlay(c, { query: new URLSearchParams({ k: await D.screenKey(c) }) });
  assert.ok(solo.css.includes("#dw-box{position:fixed;left:32px;bottom:32px") && !solo.css.includes("inset:0") && confOf(solo).el === false);
  assert.equal(def.overlay.length >= 0, true);
});

test("valeurs extrêmes : options et paramètres hostiles ne font jamais lever la page ni l'adresse", async () => {
  const c = audienceCtx();
  for (const keep of ["", "x", "1", "0", "<script>", "é\u0000"]) {
    const o = await def.overlay(c, { query: await elementQuery(c, { "opt-keep": keep, "ov-text": keep, "ov-surface": keep }) });
    assert.ok(typeof o.css === "string" && o.script.includes("__DW"));
  }
  for (const k of [undefined, "", "x".repeat(500), "../../etc"]) assert.ok(typeof (await def.overlay(c, { query: new URLSearchParams(k === undefined ? {} : { k }) })).html === "string");
});

/* ───────────── Le direct ───────────── */

test("direct : l'état publié (titre, mot, inscriptions, échéance, personnes tirées + fin d'affichage 20 s), lu avec le bon code seulement ; aucun secret ni adresse dedans", async () => {
  const c = audienceCtx(); const key = await D.screenKey(c);
  resetThrottle(); let d = await direct(c, key); assert.equal(d.data.state, "none");
  const T = Date.now();
  await open(c, { minutes: 30 }, T); for (const n of ["Lune", "Soleil", "Etoile"]) await chat(c, n);
  resetThrottle(); d = await direct(c, key);
  assert.deepEqual([d.data.state, d.data.title, d.data.keyword, d.data.site, d.data.count, d.data.winners], ["open", FORM.title, "!cadeau", true, 3, []]);
  assert.equal(d.data.until, new Date(T + 30 * 60_000).toISOString());
  assert.ok((await direct(c, "mauvais-code-123")).empty && (await direct(c, "")).empty, "sans le bon code : rien, et on ne sait pas si le canal existe");
  const w = await D.pick(c, { now: T + 5000 });
  resetThrottle(); d = await direct(c, key);
  assert.deepEqual([d.data.state, d.data.winners, d.data.showUntil], ["drawn", w.winners, new Date(T + 5000 + 20_000).toISOString()]);
  assert.equal(d.data.until, null);
  assert.ok(!/secret|token|"k"|key|pid|ip/i.test(JSON.stringify(d.data).replace(/"keyword"/, "")), "aucun secret");
  assert.ok(JSON.stringify(d.data).length < 600, "petit");
  // pas de tirage affiché si on vide, état fermé affiché
  await D.openNew(c, { ...FORM, title: "Suivant" }, { now: T + 6000 }); resetThrottle();
  assert.deepEqual([(await direct(c, key)).data.state, (await direct(c, key)).data.title], ["open", "Suivant"]);
});

test("direct : l'échéance et le nombre d'inscriptions sont constatés à la lecture, sans minuteur ; relire sans changement ne publie rien", async () => {
  const c = audienceCtx(); const key = await D.screenKey(c);
  await open(c, { minutes: 1 }); await chat(c, "Lune");
  resetThrottle(); const first = await direct(c, key); assert.equal(first.data.count, 1);
  const writes = () => c.api.store.writes.filter(([op, col]) => op !== "add" && col === "live").length + c.api.store.writes.filter(([op, col]) => op === "add" && col === "live").length;
  const base = writes();
  for (let i = 0; i < 20; i++) { resetThrottle(); const r = await direct(c, key, first.rev); assert.equal(r.unchanged, true); }
  assert.equal(writes(), base, "lire sans changement ne publie rien");
  await chat(c, "Soleil"); resetThrottle();
  const second = await direct(c, key, first.rev); assert.equal(second.data.count, 2); assert.notEqual(second.rev, first.rev);
  // l'heure passe : le tirage est fermé par la lecture
  const rec = (await c.api.store.list("draws")).find((r) => r.key === "cur");
  await c.api.store.update(rec.id, { ...rec.data, expiresAt: new Date(Date.now() - 1000).toISOString() }, { key: "cur" });
  resetThrottle(); const third = await direct(c, key, second.rev);
  assert.equal(third.data.state, "closed"); assert.equal((await D.status(c)).open, false);
  // plusieurs lectures en même temps : une seule publication
  await D.openNew(c, FORM, { now: Date.now() }); await chat(c, "Neuf");
  resetThrottle(); const before = writes();
  await Promise.all(Array.from({ length: 12 }, () => direct(c, key, third.rev)));
  assert.ok(writes() - before <= 2, `au plus la publication de l'état (${writes() - before})`);
});

/* ───────────── Un navigateur factice pour la page de l'écran ───────────── */

class PEl extends El {
  constructor(tag, doc) { super(tag, doc); this.style = { setProperty() {} }; this.clientWidth = 600; this.clientHeight = 300; this.offsetHeight = 100; this.scrollWidth = 400; }
  get firstElementChild() { return this.children[0] ?? null; }
}
/** Fait tourner le VRAI script de la page contre les VRAIES routes. L'horloge (Date.now et minuteurs) n'avance que quand le test l'ordonne. */
function runScreen(page, c) {
  const doc = { active: null, hidden: false, listeners: {} };
  doc.body = new PEl("body", doc);
  const box = new PEl("div", doc); box.id = "dw-box"; doc.body.appendChild(box);
  doc.getElementById = (id) => (id === "dw-box" ? box : null);
  doc.createElement = (t) => new PEl(t, doc);
  doc.addEventListener = () => {};
  const start = Date.now(); let clock = 0, tid = 0, calls = 0;
  const timers = [];
  const win = {
    document: doc, JSON, Math, Number, String, Promise, Object, Array, Error, AbortSignal, encodeURIComponent, parseInt, parseFloat,
    Date: { now: () => start + clock, parse: Date.parse },
    getComputedStyle: () => ({ paddingLeft: "0", paddingRight: "0", paddingTop: "0", paddingBottom: "0" }),
    addEventListener() {},
    setTimeout: (fn, ms) => { timers.push({ id: ++tid, at: clock + (ms || 0), fn }); return tid; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    fetch: async (url) => { calls++; const r = await def.routes.direct(req(new URL(url, "https://x.test").href, undefined, { ip: `9.7.${Math.floor(ipn / 200)}.${(ipn++ % 200) + 1}` }), c); return { ok: r.status === 200, status: r.status, headers: r.headers, json: () => r.json() }; },
  };
  win.window = win; vm.runInContext(page.script, vm.createContext(win));
  const flush = async () => { for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r)); };
  const text = () => box.all("[data-ov-part]").map((n) => `${n.getAttribute("data-ov-part")}=${n.textContent}`);
  const part = (p) => box.all(`[data-ov-part="${p}"]`).map((n) => n.textContent);
  return {
    box, text, part, get fetches() { return calls; }, flush, get now() { return start + clock; },
    async advance(ms) { const end = clock + ms; await flush(); for (;;) { timers.sort((a, b) => a.at - b.at || a.id - b.id); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); clock = Math.max(clock, t.at); resetThrottle(); t.fn(); await flush(); } clock = end; await flush(); },
  };
}

test("écran (élément) : le tirage en cours (titre, mot à taper, nombre), puis les personnes tirées pendant 20 secondes, puis le tirage terminé ; l'option « garder à l'écran » les laisse", async () => {
  for (const keep of [false, true]) {
    const c = audienceCtx(); await open(c); await chat(c, "Lune"); await chat(c, "Soleil");
    resetThrottle();
    const page = runScreen(await def.overlay(c, { query: await elementQuery(c, { "opt-keep": keep ? "1" : "0" }) }), c);
    await page.advance(100);
    assert.deepEqual(page.part("status"), [fr.drawOvOpen]); assert.deepEqual(page.part("title"), [FORM.title]);
    assert.deepEqual(page.part("how"), [fr.drawOvBoth.replace("{keyword}", "!cadeau")]); assert.deepEqual(page.part("foot"), ["2 personnes inscrites"]);
    await chat(c, "Etoile"); await page.advance(5000);
    assert.deepEqual(page.part("foot"), ["3 personnes inscrites"], "le nombre se met à jour tout seul, doucement");
    await D.close(c, { now: page.now }); await page.advance(10_000);
    assert.deepEqual(page.part("status"), [fr.drawOvClosed]);
    const w = await D.pick(c, { now: page.now });
    await page.advance(10_000);
    assert.deepEqual(page.part("status"), [fr.drawOvWinner]); assert.deepEqual(page.part("winner"), w.winners, "la personne tirée s'affiche");
    await page.advance(25_000);
    if (keep) assert.deepEqual(page.part("winner"), w.winners, "gardée à l'écran");
    else { assert.deepEqual(page.part("winner"), [], "après 20 secondes, elle disparaît"); assert.deepEqual(page.part("status"), [fr.drawOvDone]); }
    assert.ok(page.fetches < 30, `mise à jour douce (${page.fetches} lectures)`);
  }
});

test("écran (overlay seul) : rien à l'écran tant que personne n'est tiré ; les personnes tirées s'affichent 20 secondes puis disparaissent", async () => {
  const c = audienceCtx(); await open(c, { winners: 3 }); for (const n of ["Lune", "Soleil", "Etoile", "Comete"]) await chat(c, n);
  resetThrottle();
  const page = runScreen(await def.overlay(c, { query: new URLSearchParams({ k: await D.screenKey(c) }) }), c);
  await page.advance(100); assert.deepEqual(page.text(), [], "pas de tirage visible avant le résultat");
  const w = await D.pick(c, { now: page.now });
  await page.advance(8000);
  assert.deepEqual(page.part("status"), [fr.drawOvWinners]); assert.deepEqual(page.part("winner"), w.winners); assert.equal(w.winners.length, 3);
  assert.deepEqual(page.part("foot"), [FORM.title]);
  await page.advance(20_000);
  assert.deepEqual(page.text(), [], "au bout de 20 secondes, l'écran est vide");
});

test("écran : mode test (ov-demo) = un tirage d'exemple sans rien demander au site ; page cachée = on attend ; erreur du site = on réessaie plus tard", async () => {
  const c = audienceCtx();
  const demo = runScreen(await def.overlay(c, { query: await elementQuery(c, { "ov-demo": "1" }) }), c);
  await demo.advance(30_000);
  assert.equal(demo.fetches, 0, "le mode test ne demande rien");
  assert.deepEqual(demo.part("title"), [fr.drawDemoTitle]); assert.deepEqual(demo.part("how"), [fr.drawOvBoth.replace("{keyword}", "!cadeau")]); assert.deepEqual(demo.part("foot"), ["42 personnes inscrites"]);
  assert.ok(!demo.box.all("[data-ov-part]").some((n) => /<|>/.test(n.textContent)));
  // un titre piégé est du texte, jamais du code
  const evil = audienceCtx(); await open(evil, { title: "<img src=x onerror=alert(1)>" }); resetThrottle();
  const page = runScreen(await def.overlay(evil, { query: await elementQuery(evil) }), evil); await page.advance(100);
  assert.deepEqual(page.part("title"), ["<img src=x onerror=alert(1)>"]); assert.equal(page.box.all("img").length, 0, "textContent, jamais innerHTML");
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(/.test(page.box ? (await def.overlay(evil, { query: await elementQuery(evil) })).script : ""));
});

/* ───────────── Plusieurs lecteurs ───────────── */

test("plusieurs pages d'overlay lisent le même tirage (point de direct) : mêmes événements pour tous, chaque lecteur avec son propre repère, rien de consommé (assertMultiReaders)", async () => {
  const c = audienceCtx(); await open(c); const key = await D.screenKey(c);
  let entries = 0;
  const feed = {
    // le « flux » : chaque inscription est un événement « evt-N » ; le repère d'un lecteur est SON dernier nombre d'inscriptions vu
    publish: async (event) => { const n = Number(event.split("-")[1]); entries = Math.max(entries, n); assert.equal((await chat(c, `Personne${String(n).padStart(3, "a")}x${n}`)).ok, true); },
    open: async () => {
      resetThrottle(); let seen = (await direct(c, key)).data?.count ?? 0, rev = "";
      return { read: async () => { resetThrottle(); const d = await direct(c, key, rev); if (d.unchanged) return []; rev = d.rev; const out = []; for (let i = seen + 1; i <= d.data.count; i++) out.push(`evt-${i}`); seen = Math.max(seen, d.data.count); return out; } };
    },
  };
  await assertMultiReaders({ ...feed, readers: 6 });
});

test("mise à jour douce : l'écart conseillé reste borné et s'allonge avec le nombre de lecteurs ; les réponses sans changement sont minuscules", async () => {
  const c = audienceCtx(); const key = await D.screenKey(c); await open(c); await chat(c, "Lune");
  resetThrottle(); const first = await direct(c, key);
  const nexts = []; for (let i = 0; i < 30; i++) { resetThrottle(); const d = await direct(c, key, first.rev); assert.equal(d.unchanged, true); assert.equal(d.data, undefined); nexts.push(d.next); }
  assert.ok(nexts.every((n) => n >= 3000 && n <= 30_000));
  for (let i = 0; i < 250; i++) await direct(c, key, first.rev);
  const crowded = await direct(c, key, first.rev); assert.ok(crowded.next > nexts[0] && crowded.next <= 30_000, `${nexts[0]} → ${crowded.next}`);
});

/* ───────────── Textes ───────────── */

test("textes de l'écran : parité FR/EN, mêmes variables, neutres, une seule forme de « Vous participez ! »", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of ["drawOvWinner", "drawOvWinners", "drawOvOpen", "drawOvClosed", "drawOvDone", "drawOvBoth", "drawOvChat", "drawOvSiteOnly", "drawDemoTitle", "drawCountOne", "drawCountMany", "drawScreenIncomplete"]) assert.ok(fr[k] && en[k], k);
  assert.ok(fr.drawOvBoth.includes("{keyword}") && en.drawOvBoth.includes("{keyword}") && fr.drawOvChat.includes("{keyword}"));
  assert.equal(fr.drawStateIn, "Vous participez !");
  const mine = [fr.drawOvWinner, fr.drawOvWinners, fr.drawOvOpen, fr.drawOvClosed, fr.drawOvDone, fr.drawOvBoth, fr.drawOvChat, fr.drawOvSiteOnly].join(" ");
  assert.ok(!/gagnant|participant|\btu\b/i.test(mine));
  assert.ok(P.DRAW.showMs === 20_000);
});
