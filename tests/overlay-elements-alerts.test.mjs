// Overlay alertes (1.2.0) : l'ÉLÉMENT « Alertes » des pages d'overlay du cœur 0.5.0 (docs/OVERLAY-ELEMENTS.md du cœur).
// Ce que ce fichier prouve : le manifeste et l'adresse de l'élément, la page de l'élément (jetons --ov-*, attributs, pas de classes en dur, pas de skin de site),
// le MULTI-LECTEURS (test du kit `assertMultiReaders` sur le vrai flux, par la route d'envoi puis par le sujet `live.event`, et des pages entières qui tournent en même temps),
// la limite « au plus une lecture du sujet toutes les 2 secondes par overlay » avec plusieurs lecteurs, et la NON-RÉGRESSION de l'overlay existant (mêmes octets, même flux).
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { runOverlayPage } from "./helpers/overlayPageDom.mjs";
import { parseManifest } from "@/core/modules/manifest";
import { parseAddress } from "@/core/overlays/address";

const core = path.resolve(process.env.CURIOSA_DIR ?? process.cwd());
const { assertMultiReaders } = await import(pathToFileURL(path.join(core, "testsupport/index.mjs")).href);

const DIR = new URL("../modules/alerts-overlay", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifestJson = readJson("module.json");
const mod = await import("../modules/alerts-overlay/index.mjs");
const def = mod.default;
const golden = JSON.parse(fs.readFileSync(new URL("./fixtures/overlay-elements-golden.json", import.meta.url), "utf8")).alerts;

let n = 0;
const PROVIDER = [{ id: "i1", key: "yt", module: "youtube-live-actions", basePath: "", name: "Actions", adminPath: "/admin/instances/i1" }];
/** Un overlay neuf (clé neuve : le flux et la mémoire des alertes déjà vues sont par clé). */
function world({ settings = {}, provider = false, locale = "fr", items = [], key = `ov${++n}` } = {}) {
  const state = { items, reads: 0 };
  const ctx = fakeCtx({ key, locale, messages: readJson(`locales/${locale}.json`), settings: { pushToken: "secret", ...settings }, instances: provider ? PROVIDER : [], topics: { "live.event": () => { state.reads++; return state.items; } } });
  return { key, ctx, state };
}
const push = (w, message, kind = "alert") => def.routes.push(new Request(`https://x.test/m/${w.key}/push`, { method: "POST", headers: { Authorization: "Bearer secret", "Content-Type": "application/json" }, body: JSON.stringify({ kind, message }) }), w.ctx);
const feed = async (w, after, pull = false) => (await def.routes.feed(new Request(`https://x.test/m/${w.key}/feed?after=${encodeURIComponent(after)}${pull ? "&pull=1" : ""}`), w.ctx)).json();
const STYLE = { "ov-w": "640", "ov-h": "260", "ov-fit": "scale", "ov-lang": "fr", "ov-text": "light", "ov-surface": "soft", "ov-corners": "round" };
const query = (extra = {}) => new URLSearchParams({ ...STYLE, ...extra });
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

// ── Manifeste et adresse ─────────────────────────────────────────────────────────────────────────────────────────────────
test("manifeste : valide au sens du cœur 0.5.0, un élément « alertes » (garde ses proportions), libellés et descriptions en français et en anglais", () => {
  const r = parseManifest(manifestJson);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifestJson.version, "1.2.0");
  assert.equal(manifestJson.minCore, "0.5.0");
  const [el, ...others] = manifestJson.overlayElements;
  assert.equal(others.length, 0);
  assert.equal(el.id, "alerts");
  assert.equal(el.fit, "scale");
  assert.deepEqual(el.size, { width: 640, height: 260 });
  assert.equal(el.followsStyle, true);
  assert.equal(el.demo, true);
  for (const k of ["label", "description"]) assert.ok(el[k].fr && el[k].en, k);
  assert.deepEqual(Object.keys(def.overlayElements), manifestJson.overlayElements.map((e) => e.id), "autant de fonctions que d'éléments déclarés");
  // Jeu d'options minimal : une seule, un choix dans une liste, avec un défaut qui existe.
  assert.equal(el.options.length, 1);
  const opt = el.options[0];
  assert.equal(opt.type, "choice");
  assert.ok(opt.choices.some((c) => c.value === opt.default));
  for (const c of opt.choices) assert.ok(c.label.fr && c.label.en);
});

test("adresse de l'élément : un chemin du site accepté par le cœur, l'adresse de l'overlay, avec la langue seulement si elle est valable", () => {
  const w = world();
  const a = def.overlayElements.alerts(w.ctx, { element: "alerts", fit: "scale", width: 640, height: 260, style: { text: "light", surface: "soft", corners: "round" }, options: { kinds: "all" }, lang: "fr" });
  assert.deepEqual(a, { url: `/overlays/${w.key}?lang=fr` });
  assert.ok(parseAddress(a));
  for (const lang of ["", "fr/../x", "fr&k=1", undefined]) {
    const b = def.overlayElements.alerts(w.ctx, { lang });
    assert.deepEqual(b, { url: `/overlays/${w.key}` });
    assert.ok(parseAddress(b));
  }
});

// ── La page de l'élément ────────────────────────────────────────────────────────────────────────────────────────────────
test("page de l'élément : jetons --ov-*, attributs data-ov-part, aucune classe en dur, aucun skin de site, rien de tiers", async () => {
  const w = world({ settings: { visual: "neon" } });
  const out = await def.overlay(w.ctx, { query: query() });
  const all = `${out.html}\n${out.css}\n${out.script}`;
  assert.match(out.html, /--ov-fg:#ffffff;--ov-surface:rgba\(0,0,0,0\.55\);--ov-radius:12px;--ov-border:rgba\(255,255,255,0\.25\)/);
  assert.match(out.css, /\[data-ov-part="card"\]\{[^}]*border-radius:var\(--ov-radius,1\.5rem\)[^}]*background:var\(--ov-surface,/);
  assert.match(out.css, /\[data-ov-part="message"\]\{[^}]*color:var\(--ov-fg,var\(--al-fg\)\)/);
  assert.ok(!/\.al-(card|kind|msg|detail)/.test(out.css), "pas de classes en dur dans la feuille de style de l'élément");
  assert.ok(!/className/.test(out.script), "le script marque les morceaux par data-ov-part, pas par des classes");
  assert.match(out.script, /setAttribute\("data-ov-part","card"\)/);
  assert.ok(!/--sk-|data-skin|<link|@import|https?:\/\//.test(all), "ni skin de site ni chargement tiers");
  assert.ok(!/EventSource/.test(out.script), "l'élément lit son flux avec son propre repère, pas par le flux partagé");
  assert.match(out.script, /feedUrl/);
  // Style sombre, coins droits, fond transparent : les jetons suivent.
  const dark = await def.overlay(w.ctx, { query: query({ "ov-text": "dark", "ov-surface": "transparent", "ov-corners": "square" }) });
  assert.match(dark.html, /--ov-fg:#111111;--ov-surface:transparent;--ov-radius:0px;--ov-border:transparent/);
  // Sans style commun reçu : repli sur les couleurs du module.
  const bare = await def.overlay(w.ctx, { query: new URLSearchParams({ "ov-fit": "scale", "ov-w": "640", "ov-h": "260" }) });
  assert.ok(!/--ov-fg:/.test(bare.html));
});

test("page de l'élément : le réglage « Style » du module reste respecté (néon ou sobre), la durée aussi ; les réglages de place n'existent pas ici", async () => {
  const neon = await def.overlay(world({ settings: { visual: "neon", durationSeconds: 9 } }).ctx, { query: query() });
  assert.match(neon.css, /box-shadow:0 0 28px/);
  assert.match(neon.script, /"duration":9/);
  const plain = await def.overlay(world({ settings: { visual: "plain" } }).ctx, { query: query() });
  assert.ok(!/box-shadow/.test(plain.css));
});

test("option « Alertes affichées » : valeur inconnue ignorée, jamais d'erreur", async () => {
  const w = world({ provider: true });
  const cfgOf = async (q) => JSON.parse(/var c=(\{.*?\}),stage/.exec((await def.overlay(w.ctx, { query: q })).script)[1]);
  assert.equal((await cfgOf(query())).only, null);
  assert.equal((await cfgOf(query({ "opt-kinds": "all" }))).only, null);
  assert.deepEqual((await cfgOf(query({ "opt-kinds": "channel" }))).only, ["follow", "sub", "raid", "test", "alert"]);
  assert.deepEqual((await cfgOf(query({ "opt-kinds": "live" }))).only, ["superchat", "supersticker", "member", "gift"]);
  for (const bad of ["<script>", "constructor", "__proto__", "", "toString"]) assert.equal((await cfgOf(query({ "opt-kinds": bad }))).only, null, bad);
});

test("mode test (ov-demo=1) : une alerte d'exemple fixe, échappée ; sans ov-demo, la scène est vide", async () => {
  const w = world();
  const demo = await def.overlay(w.ctx, { query: query({ "ov-demo": "1" }) });
  assert.match(demo.html, /data-ov-part="card" style="animation:none"/);
  assert.match(demo.html, /Ceci est une alerte de test/);
  assert.ok(!/data-ov-part="card"/.test((await def.overlay(w.ctx, { query: query() })).html));
});

// ── Multi-lecteurs : le test du kit, sur le vrai flux ────────────────────────────────────────────────────────────────────
test("MULTI-LECTEURS (kit assertMultiReaders) : alertes poussées, 4 lecteurs, chacun avec son repère", async () => {
  const w = world();
  await assertMultiReaders({
    readers: 4,
    keyOf: (e) => e.message,
    publish: async (text) => { assert.equal((await push(w, text)).status, 200); },
    open: async () => {
      let cursor = (await feed(w, "now")).cursor;           // le repère est pris TOUT DE SUITE, à la fin du flux
      return { read: async () => { const r = await feed(w, cursor); cursor = r.cursor; return r.events; } };
    },
  });
});

test("MULTI-LECTEURS (kit assertMultiReaders) : 10 lecteurs", async () => {
  const w = world();
  await assertMultiReaders({
    readers: 10, keyOf: (e) => e.message,
    publish: async (text) => { await push(w, text); },
    open: async () => { let cursor = (await feed(w, "now")).cursor; return { read: async () => { const r = await feed(w, cursor); cursor = r.cursor; return r.events; } }; },
  });
});

test("MULTI-LECTEURS (kit assertMultiReaders) : alertes du direct YouTube lues par le sujet live.event, lecteurs qui demandent chacun la lecture du sujet", async (t) => {
  let now = Date.parse("2026-10-30T20:00:00Z");
  t.mock.method(Date, "now", () => now);
  const w = world({ provider: true });
  await assertMultiReaders({
    readers: 4,
    keyOf: (e) => e.message.split(" · ")[0],
    publish: async (who) => {
      now += 2100;                                               // l'horloge avance : la limite d'une lecture toutes les 2 secondes laisse passer la suivante
      w.state.items.push({ id: `y-${who}`, platform: "youtube", kind: "superchat", who, amount: 5, currency: "EUR", at: new Date(now).toISOString() });
    },
    open: async () => {
      let cursor = (await feed(w, "now", true)).cursor;
      return { read: async () => { const r = await feed(w, cursor, true); cursor = r.cursor; return r.events; } };
    },
  });
});

test("MULTI-LECTEURS : deux pages d'overlay entières (le vrai script de la page) affichent les mêmes alertes, une page ouverte plus tard ne rejoue rien, une page lente ne vole rien", async () => {
  const w = world();
  const out = await def.overlay(w.ctx, { query: query() });
  const dispatch = (url) => def.routes.feed(new Request(url), w.ctx);
  const a = runOverlayPage(out, { dispatch }), b = runOverlayPage(out, { dispatch });
  await a.advance(10); await b.advance(10);                      // premier tour : chaque page prend SON repère à la fin du flux
  await push(w, "Alice", "follow"); await push(w, "Bob", "raid");
  await a.advance(1600);                                          // la page A lit la première…
  await push(w, "Chloé", "sub");
  await a.advance(1600); await b.advance(3200);                  // …la page B lit plus tard, tout d'un coup
  const late = runOverlayPage(out, { dispatch });                // une troisième page, ouverte après : elle ne rejoue pas l'ancien
  await late.advance(10);
  await push(w, "Dan", "follow");
  await a.advance(1600); await b.advance(1600); await late.advance(1600);
  const names = (p) => p.shown.map((s) => s.message);
  assert.deepEqual(names(a), ["Alice", "Bob", "Chloé", "Dan"]);
  // B a lu Alice, Bob et Chloé d'un coup : chaque alerte poussée remplace la précédente à l'écran, comme dans l'overlay existant ; B finit sur les mêmes que A.
  assert.deepEqual(names(b), ["Alice", "Bob", "Chloé", "Dan"]);
  assert.deepEqual(names(late), ["Dan"]);
  assert.ok(a.shown.every((s) => s.classes === "" && s.kind), "les morceaux sont marqués par data-ov-part, la carte n'a aucune classe en dur");
});

test("MULTI-LECTEURS : une file de dons du direct s'affiche en entier, dans l'ordre, sur chaque page (la file est celle de la page, pas du serveur)", async (t) => {
  let now = Date.parse("2026-10-30T20:00:00Z");
  t.mock.method(Date, "now", () => now);
  const w = world({ provider: true });
  const out = await def.overlay(w.ctx, { query: query() });
  const dispatch = (url) => def.routes.feed(new Request(url), w.ctx);
  const pages = [runOverlayPage(out, { dispatch }), runOverlayPage(out, { dispatch }), runOverlayPage(out, { dispatch })];
  for (const p of pages) await p.advance(10);
  for (const who of ["Léa", "Max", "Noa"]) w.state.items.push({ id: `y-${who}`, platform: "youtube", kind: "superchat", who, amount: 5, currency: "EUR", at: new Date(now++).toISOString() });
  now += 2100;
  for (const p of pages) await p.advance(1600);                  // chaque page lit les trois dons d'un coup…
  for (const p of pages) assert.deepEqual(p.shown.map((s) => s.message.split(" · ")[0]), ["Léa"], "…en affiche un…");
  for (const p of pages) await p.advance(6000);                  // …puis, après la durée à l'écran, le suivant
  for (const p of pages) await p.advance(6000);
  for (const p of pages) assert.deepEqual(p.shown.map((s) => s.message.split(" · ")[0]), ["Léa", "Max", "Noa"], "…l'un après l'autre, dans l'ordre");
});

test("MULTI-LECTEURS : « Alertes affichées » filtre côté page ; deux éléments (chaîne / direct) lisent le même flux sans se voler les alertes", async (t) => {
  let now = Date.parse("2026-10-30T20:00:00Z");
  t.mock.method(Date, "now", () => now);
  const w = world({ provider: true });
  const dispatch = (url) => def.routes.feed(new Request(url), w.ctx);
  const chan = runOverlayPage(await def.overlay(w.ctx, { query: query({ "opt-kinds": "channel" }) }), { dispatch });
  const live = runOverlayPage(await def.overlay(w.ctx, { query: query({ "opt-kinds": "live" }) }), { dispatch });
  await chan.advance(10); await live.advance(10);
  await push(w, "Alice", "follow");
  w.state.items.push({ id: "y1", platform: "youtube", kind: "superchat", who: "Léa", amount: 5, currency: "EUR", at: new Date(now).toISOString() });
  now += 2100;
  await chan.advance(1600); await live.advance(1600);
  assert.deepEqual(chan.shown.map((s) => s.message), ["Alice"]);
  assert.deepEqual(live.shown.map((s) => s.message.split(" · ")[0]), ["Léa"]);
});

// ── Limites : lectures du sujet, bornes ─────────────────────────────────────────────────────────────────────────────────────
test("LIMITE « une lecture du sujet toutes les 2 s par overlay » : 8 lecteurs qui interrogent toutes les 500 ms pendant 10 s font au plus 6 lectures, pas 8 fois plus", async (t) => {
  let now = Date.parse("2026-10-30T20:00:00Z");
  t.mock.method(Date, "now", () => now);
  const w = world({ provider: true });
  const cursors = Array.from({ length: 8 }, () => "now");
  let polls = 0;
  for (let ms = 0; ms <= 10_000; ms += 500, now += 500) {
    await Promise.all(cursors.map(async (_, i) => { const r = await feed(w, cursors[i], true); cursors[i] = r.cursor; polls++; }));
  }
  assert.equal(polls, 8 * 21);
  assert.ok(w.state.reads >= 5 && w.state.reads <= 6, `lectures du sujet : ${w.state.reads} (attendu : une toutes les 2 s, quel que soit le nombre de lecteurs)`);
  // Une autre overlay a sa propre limite (par overlay, pas pour tout le site).
  const other = world({ provider: true });
  await feed(other, "now", true);
  assert.equal(other.state.reads, 1);
});

test("sans « Actions du live YouTube » (pas de pull) : la route ne lit jamais le sujet ; la page ne demande pas pull=1", async () => {
  const w = world({ provider: false });
  const out = await def.overlay(w.ctx, { query: query() });
  assert.match(out.script, /"feedPull":false/);
  for (let i = 0; i < 5; i++) await feed(w, "now", false);
  assert.equal(w.state.reads, 0);
});

test("flux : lecture bornée (50), journal borné (100), repère d'une autre époque ou invalide = lecteur neuf à la fin, méthode non permise, jamais d'erreur", async () => {
  const w = world();
  const start = (await feed(w, "now")).cursor;
  for (let i = 0; i < 130; i++) mod.emit(w.key, { kind: "alert", message: `m${i}` });
  const first = await feed(w, start);
  assert.equal(first.events.length, 50, "50 au plus par lecture");
  assert.equal(first.events[0].message, "m30", "le journal garde les 100 dernières");
  const second = await feed(w, first.cursor);
  assert.deepEqual(second.events.map((e) => e.message).slice(0, 2), ["m80", "m81"], "la suite se lit au tour suivant, sans trou");
  for (const bad of ["", "abc", "0.0", "zz.5", `${start}x`, "1".repeat(200), undefined, null, "../etc"]) {
    const r = mod.readFeed(w.key, bad);
    assert.deepEqual(r.events, []);
    assert.match(r.cursor, /^[0-9a-z]{1,12}\.\d+$/);
  }
  assert.equal((await def.routes.feed(new Request("https://x.test/m/x/feed", { method: "POST" }), w.ctx)).status, 405);
  assert.equal((await def.routes.feed(new Request("https://x.test/m/x/feed"), w.ctx)).status, 200);
  // Mémoire bornée : les overlays les plus anciennes sortent du journal.
  for (let i = 0; i < 80; i++) mod.emit(`many${i}`, { kind: "alert", message: "x" });
  assert.ok(globalThis.__curiosaAlertsFeed.size <= 50);
});

// ── Non-régression de l'overlay existant ────────────────────────────────────────────────────────────────────────────────
test("NON-RÉGRESSION : l'overlay existant rend les MÊMES octets qu'avant (1.1.1) pour chaque combinaison de réglages, avec ou sans YouTube, en français et en anglais", async () => {
  let checked = 0;
  for (const pull of [false, true]) for (const visual of ["neon", "plain"]) for (const locale of ["fr", "en"]) {
    const w = world({ key: "al", provider: pull, locale, settings: { visual, durationSeconds: 7, accentColor: "#12ab34" } });
    const key = `pull=${pull},visual=${visual},${locale}`;
    const was = golden[key];
    for (const out of [await def.overlay(w.ctx), await def.overlay(w.ctx, { query: new URLSearchParams("lang=fr") })]) {
      assert.equal(hash(out.html), was.html, `${key} : html`);
      assert.equal(hash(out.css), was.css, `${key} : css`);
      assert.equal(hash(out.script), was.script, `${key} : script`);
    }
    checked++;
  }
  assert.equal(checked, 8);
});

test("NON-RÉGRESSION : l'overlay existant n'a ni repère ni lecture de flux ; ses routes (flux SSE, push, pull) répondent comme avant, et une alerte poussée arrive toujours aux deux", async () => {
  const w = world({ provider: true });
  const out = await def.overlay(w.ctx);
  assert.match(out.script, /new EventSource\(c\.eventsUrl\)/);
  assert.ok(!/feedUrl|data-ov-part/.test(`${out.html}${out.css}${out.script}`));
  assert.match(out.css, /\.al-card\{/);
  const got = []; const on = (e) => got.push(e); globalThis.__curiosaAlertsBus.on(w.key, on);
  const before = (await feed(w, "now")).cursor;
  assert.equal((await push(w, "Alice", "follow")).status, 200);
  assert.deepEqual(got, [{ kind: "follow", message: "Alice" }], "le flux SSE reçoit l'alerte comme avant");
  assert.deepEqual((await feed(w, before)).events, [{ kind: "follow", message: "Alice" }], "et le flux des éléments aussi");
  globalThis.__curiosaAlertsBus.off(w.key, on);
  assert.equal((await def.routes.pull(new Request("https://x.test/p"), w.ctx)).status, 200);
});

test("textes : parité fr/en inchangée (aucun nouveau texte), toutes les clés ctx.t existent", () => {
  const en = readJson("locales/en.json"), fr = readJson("locales/fr.json");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const source = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
  for (const m of source.matchAll(/ctx\.t\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in en, m[1]);
});
