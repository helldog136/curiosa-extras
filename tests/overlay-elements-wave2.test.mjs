// Éléments de page d'overlay (cœur 0.5.0, docs/OVERLAY-ELEMENTS.md) de l'Overlay défilant (« ticker-overlay » : Bandeau défilant), des Témoignages (« testimonials » : Avis de la communauté)
// et de la Mascotte (« mascot » : Mascotte, version réduite) : déclaration, adresse, page de l'élément, options, mode test, visibilité, plusieurs lecteurs, parité FR/EN.
// La non-régression de l'existant est dans overlay-elements-wave2-ticker-regression.test.mjs ; la conformité du kit (« overlay.elements ») dans conformance.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { runElementPage, splitDocument } from "./helpers/elementPageDom.mjs";
import * as T from "./helpers/testimonials.mjs";
import * as K from "./helpers/mascotKit.mjs";
import { parseManifest } from "@/core/modules/manifest";
import { parseAddress } from "@/core/overlays/address";

const core = path.resolve(process.env.CURIOSA_DIR ?? process.cwd());
const { assertMultiReaders } = await import(pathToFileURL(path.join(core, "testsupport/index.mjs")).href);
const read = (m, p) => JSON.parse(fs.readFileSync(new URL(`../modules/${m}/${p}`, import.meta.url), "utf8"));
const tkMod = await import("../modules/ticker-overlay/index.mjs");
const tk = tkMod.default;
const tmOverlay = await import("../modules/testimonials/overlay.mjs");
const mcOverlay = await import("../modules/mascot/overlay.mjs");
const get = (url) => new Request(`https://example.test${url}`);

const MODULES = [
  { name: "Overlay défilant", dir: "ticker-overlay", def: tk, id: "banner", fit: "scale", version: "1.1.0" },
  { name: "Témoignages", dir: "testimonials", def: T.def, id: "reviews", fit: "fluid", version: "1.1.0" },
  { name: "Mascotte", dir: "mascot", def: K.def, id: "mascot", fit: "scale", version: "1.1.0" },
];
/** Ce que le cœur ajoute à l'adresse de l'élément : taille du cadre, style commun, options. */
const frame = (extra = "", w = 640, h = 140, fit = "scale") => new URLSearchParams(`ov-w=${w}&ov-h=${h}&ov-fit=${fit}&ov-lang=fr&ov-text=light&ov-surface=transparent&ov-corners=round${extra ? `&${extra}` : ""}`);
const ASK = { fit: "scale", width: 640, height: 140, style: null, options: {}, lang: "en" };

// ── Déclaration ─────────────────────────────────────────────────────────────────────────────────────────────────────
for (const { name, dir, def, id, fit, version } of MODULES) {
  const manifest = read(dir, "module.json");

  test(`${name} : manifeste valide, minCore 0.5.0, version ${version}, un élément « ${id} » (${fit})`, () => {
    const r = parseManifest(manifest);
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.equal(r.manifest.minCore, "0.5.0");
    assert.equal(r.manifest.version, version);
    assert.deepEqual(r.manifest.overlayElements.map((e) => e.id), [id]);
    const e = r.manifest.overlayElements[0];
    assert.equal(e.fit, fit);
    assert.equal(e.followsStyle, true);
    assert.equal(e.demo, true);
    if (fit === "scale") assert.ok(e.size.width > 0 && e.size.height > 0);
    else assert.ok(e.ratios.min < e.ratios.max && e.minSize.width > 0 && e.minSize.height > 0);
    assert.deepEqual(Object.keys(def.overlayElements), [id], "une fonction par élément déclaré, et inversement");
  });

  test(`${name} : libellés, descriptions et options en français ET en anglais, vouvoiement, jeu d'options minimal`, () => {
    const e = manifest.overlayElements[0];
    const both = (v, where) => { assert.ok(v && typeof v === "object", where); for (const l of ["fr", "en"]) assert.ok(typeof v[l] === "string" && v[l].trim(), `${where} (${l})`); assert.notEqual(v.fr, v.en, `${where} : traduction identique`); };
    both(e.label, "label"); both(e.description, "description");
    for (const o of e.options) { both(o.label, `option ${o.id}`); if (o.help) both(o.help, `aide ${o.id}`); if (o.type === "text" || o.type === "number") assert.ok(o.example, `exemple ${o.id}`); for (const c of o.choices ?? []) both(c.label, `choix ${o.id}/${c.value}`); }
    assert.ok(e.options.length >= 1 && e.options.length <= 5, "jeu d'options minimal");
    const ids = e.options.map((o) => o.id);
    assert.equal(new Set(ids).size, ids.length);
    const fr = JSON.stringify([e.label.fr, e.description.fr, e.options.map((o) => [o.label.fr, o.help?.fr])]);
    assert.ok(!/\btu\b|\bton\b|\bta\b|\btes\b/i.test(fr), "vouvoiement");
  });

  test(`${name} : l'adresse de l'élément est un chemin du site accepté par le cœur, sans secret ni adresse externe`, () => {
    const ctx = dir === "ticker-overlay" ? tkCtx() : dir === "testimonials" ? T.ctxFor({ locale: "en" }) : K.ctxFor({}, { locale: "en" });
    const answer = def.overlayElements[id](ctx, { element: id, ...ASK });
    assert.ok(parseAddress(answer), JSON.stringify(answer));
    assert.match(answer.url, dir === "ticker-overlay" ? /^\/overlays\/[\w-]+\?lang=en$/ : /^\/m\/[\w-]+\/element\/[a-z]+\?lang=en$/);
    assert.ok(!/[?&]k=|secret|token/i.test(answer.url));
    assert.ok(parseAddress(def.overlayElements[id](ctx, { element: id, ...ASK, lang: "<script>" })), "langue invalide ignorée sans casser");
    assert.ok(parseAddress(def.overlayElements[id](ctx, undefined)), "sans demande : une adresse valable");
  });
}

// ═════════════════════════════════════════════════ Overlay défilant : Bandeau défilant ═════════════════════════════════════════════════
let seq = 0;
const CARDS = {
  "core.entry": [
    { title: "Code partenaire", code: "HELLDOG", summary: "ignoré", cover: "https://cdn.test/a.png" },
    { title: "Nouvel article", summary: "Le résumé de l'article", cover: "/uploads/p.png" },
  ],
  "overlay.item": [{ title: "Annonce", text: "Ce soir à 21 h", image: "https://cdn.test/i.png" }],
};
const tkCtx = (o = {}) => fakeCtx({ key: `tk${++seq}`, name: "Mon bandeau", locale: "fr", messages: read("ticker-overlay", "locales/fr.json"), settings: { interval: 8 }, topics: CARDS, ...o });
const tkInit = (out) => JSON.parse(out.script.match(/^\(function\(\)\{var c=(\{.*?\}),card=/s)[1]);
const tkItems = async (ctx, q = "") => (await (await tk.routes.items(get(`/m/${ctx.instance.key}/items?lang=fr&el=1${q}`), ctx)).json()).items;

test("Bandeau défilant : l'élément remplit son cadre, suit le style commun (--ov-*), marque ses morceaux (data-ov-part), ignore la place et les couleurs de l'overlay, ne touche pas au site", () => {
  const ctx = tkCtx({ settings: { interval: 8, position: "top-right", textColor: "#ff0000", cardColor: "#00ff00" } });
  const out = tk.overlay(ctx, { query: frame() });
  assert.match(out.html, /id="vt-stage" data-ov-region="element"/);
  for (const p of ["panel", "image", "title", "subtitle"]) assert.match(out.html, new RegExp(`data-ov-part="${p}"`), p);
  assert.match(out.css, /:root\{--ov-fg:#ffffff;--ov-surface:transparent;--ov-radius:12px;--ov-border:transparent\}/);
  assert.match(out.css, /var\(--ov-fg,#fff\)/);
  assert.match(out.css, /position:absolute;inset:0/, "remplit le cadre");
  assert.ok(!/bottom-left|right:32px|#ff0000|#00ff00|top:32px/.test(out.css + out.html), "place et couleurs de l'overlay ignorées");
  assert.ok(!/--sk-|data-skin|var\(--v-|<link|@import|https?:\/\//.test(out.css + out.html + out.script), "aucun skin ni thème du site, aucun chargement tiers");
  assert.ok(!/innerHTML|outerHTML|document\.write|eval\(/.test(out.script));
  const dark = tk.overlay(ctx, { query: new URLSearchParams("ov-w=640&ov-h=140&ov-text=dark&ov-surface=soft&ov-corners=square") });
  assert.match(dark.css, /--ov-fg:#111111;--ov-surface:rgba\(255,255,255,\.7\);--ov-radius:0px;--ov-border:rgba\(0,0,0,\.18\)/);
});

test("Bandeau défilant : la durée par carte reste celle du module ; options « Quoi montrer » et « Images » dans l'adresse de la liste", () => {
  const cfg = (settings, extra = "") => tkInit(tk.overlay(tkCtx({ settings }), { query: frame(extra) }));
  assert.equal(cfg({ interval: 20 }).ms, 20000);
  assert.equal(cfg({ interval: 1 }).ms, 2000, "borne du module");
  assert.match(cfg({}).url, /^\/m\/tk\d+\/items\?lang=fr&el=1&show=all$/);
  assert.match(cfg({}, "opt-show=codes&opt-image=0").url, /&el=1&show=codes&image=0$/);
  assert.match(cfg({}, "opt-show=news").url, /&show=news$/);
  assert.match(cfg({}, "ov-demo=1").url, /&show=all&demo=1$/);
  for (const bad of ["<script>", "../../x", "CODES", "", "%00", "x".repeat(300)]) assert.match(cfg({}, `opt-show=${encodeURIComponent(bad)}&opt-image=${encodeURIComponent(bad)}`).url, /&show=all$/, `option hostile ignorée : ${bad}`);
});

test("Bandeau défilant : la liste de l'élément range les cartes en codes promo et annonces ; l'overlay habituel ne change pas de forme", async () => {
  tkMod.resetElementCache();
  const ctx = tkCtx();
  const all = await tkItems(ctx);
  assert.deepEqual(all.map((i) => [i.title, i.kind]), [["Code partenaire", "code"], ["Nouvel article", "news"], ["Annonce", "news"]]);
  assert.equal(all[0].subtitle, "Code HELLDOG");
  assert.deepEqual((await tkItems(ctx, "&show=codes")).map((i) => i.title), ["Code partenaire"]);
  assert.deepEqual((await tkItems(ctx, "&show=news")).map((i) => i.title), ["Nouvel article", "Annonce"]);
  assert.ok((await tkItems(ctx, "&image=0")).every((i) => !("image" in i)));
  assert.ok((await tkItems(ctx)).some((i) => i.image), "images par défaut");
  const legacy = (await (await tk.routes.items(get(`/m/${ctx.instance.key}/items?lang=fr`), ctx)).json()).items;
  assert.ok(legacy.every((i) => !("kind" in i)), "route habituelle : mêmes champs qu'avant");
});

test("Bandeau défilant : mode test — une carte d'exemple SEULEMENT quand il n'y a rien, jamais mélangée aux vraies cartes", async () => {
  tkMod.resetElementCache();
  const empty = tkCtx({ topics: { "core.entry": [], "overlay.item": [] } });
  assert.deepEqual(await tkItems(empty), [], "sans demo : aucune carte inventée");
  const demo = await tkItems(empty, "&demo=1");
  assert.deepEqual(demo.map((i) => [i.title, i.subtitle]), [["Exemple de bandeau", "Code EXEMPLE10"]]);
  assert.equal((await tkItems(empty, "&demo=1&show=news"))[0].subtitle, "Un texte d'exemple pour voir le bandeau.");
  tkMod.resetElementCache();
  assert.equal((await tkItems(tkCtx(), "&demo=1")).length, 3, "de vraies cartes : ce sont elles qui sont montrées");
});

test("Bandeau défilant : cartes non sûres écartées (images javascript:, texte HTML laissé en donnée)", async () => {
  tkMod.resetElementCache();
  const evil = `</script><img src=x onerror=alert(1)>`;
  const ctx = tkCtx({ topics: { "core.entry": [{ title: evil, summary: evil, cover: "javascript:alert(1)" }], "overlay.item": [{ title: 12, image: "//evil.test/x.png" }] } });
  const items = await tkItems(ctx);
  assert.equal(items[0].title, evil);
  assert.ok(!("image" in items[0]) && !("image" in items[1]));
  assert.equal(items[1].title, "12");
});

test("Bandeau défilant : une seule lecture des sujets sert tous les lecteurs (cache de quelques dizaines de secondes, lectures simultanées regroupées)", async () => {
  tkMod.resetElementCache();
  const ctx = tkCtx();
  await Promise.all(Array.from({ length: 10 }, () => tkItems(ctx)));
  assert.deepEqual(ctx.calls.topics.map((c) => c[0]).sort(), ["core.entry", "overlay.item"], "10 lecteurs en même temps : une lecture");
  await tkItems(ctx); await tkItems(ctx, "&show=codes");
  assert.equal(ctx.calls.topics.length, 2, "la lecture suivante, dans le délai : aucune nouvelle lecture");
  assert.ok(tkMod.ELEMENT_CACHE.ttlMs >= 10_000 && tkMod.ELEMENT_CACHE.ttlMs <= 120_000, "quelques dizaines de secondes");
  const real = tkMod.ELEMENT_CACHE.ttlMs; tkMod.ELEMENT_CACHE.ttlMs = 0; tkMod.resetElementCache();
  try { await tkItems(ctx); assert.equal(ctx.calls.topics.length, 4, "délai écoulé : une nouvelle lecture"); } finally { tkMod.ELEMENT_CACHE.ttlMs = real; tkMod.resetElementCache(); }
  // Une panne de lecture ne casse rien : liste vide, nouvel essai bientôt.
  tkMod.resetElementCache();
  const broken = tkCtx({ topics: { "core.entry": () => { throw new Error("secret interne"); }, "overlay.item": [] } });
  assert.deepEqual(await tkItems(broken), []);
});

test("Bandeau défilant : deux pages d'overlay montrent la MÊME carte au même instant, qui change avec l'heure (rien n'est consommé)", async () => {
  tkMod.resetElementCache();
  const ctx = tkCtx({ settings: { interval: 8 } });
  const out = tk.overlay(ctx, { query: frame() });
  const dispatch = async (url) => tk.routes.items(new Request(url), ctx);
  const page = { html: out.html, script: out.script };
  const [a, b] = [runElementPage(page, { dispatch }), runElementPage(page, { dispatch })];
  await Promise.all([a.advance(100), b.advance(100)]);
  assert.ok(a.els["vt-card"].on && b.els["vt-card"].on);
  assert.equal(a.els["vt-title"].textContent, b.els["vt-title"].textContent);
  assert.equal(a.els["vt-sub"].attrs["data-kind"], b.els["vt-sub"].attrs["data-kind"]);
  const seen = [];
  for (let i = 0; i < 6; i++) {
    await Promise.all([a.advance(8000), b.advance(8000)]);
    assert.equal(a.els["vt-title"].textContent, b.els["vt-title"].textContent, "même carte au même instant");
    seen.push(a.els["vt-title"].textContent);
  }
  assert.deepEqual([...new Set(seen)].sort(), ["Annonce", "Code partenaire", "Nouvel article"], "toutes les cartes passent");
  assert.equal(a.els["vt-sub"].textContent, seen.at(-1) === "Code partenaire" ? "Code HELLDOG" : a.els["vt-sub"].textContent);
});

test("Bandeau défilant : sans aucune carte, le cadre reste vide et silencieux", async () => {
  tkMod.resetElementCache();
  const ctx = tkCtx({ topics: { "core.entry": [], "overlay.item": [] } });
  const out = tk.overlay(ctx, { query: frame() });
  const page = runElementPage({ html: out.html, script: out.script }, { dispatch: async (url) => tk.routes.items(new Request(url), ctx) });
  await page.advance(20_000);
  assert.equal(page.els["vt-card"].on, false);
  assert.equal(page.els["vt-title"].textContent, "");
});

test("Bandeau défilant : plusieurs pages d'overlay peuvent lire le même bandeau (assertMultiReaders)", async () => {
  tkMod.resetElementCache();
  const cards = [];
  const ctx = tkCtx({ topics: { "core.entry": () => cards.slice(), "overlay.item": [] } });
  const real = tkMod.ELEMENT_CACHE.ttlMs; tkMod.ELEMENT_CACHE.ttlMs = 0;
  try {
    await assertMultiReaders({
      readers: 4,
      publish: async (title) => { cards.push({ title, summary: "x" }); },
      open: async () => {
        const seen = new Set((await tkItems(ctx)).map((i) => i.title)); // le repère est pris TOUT DE SUITE, à la fin du flux
        return { read: async () => { const fresh = (await tkItems(ctx)).filter((i) => !seen.has(i.title)); fresh.forEach((i) => seen.add(i.title)); return fresh.map((i) => i.title); } };
      },
    });
  } finally { tkMod.ELEMENT_CACHE.ttlMs = real; }
});

// ═════════════════════════════════════════════════ Témoignages : Avis de la communauté ═════════════════════════════════════════════════
const SECRET_MAIL = "prive.secret@example.org";
const elementOf = async (ctx, q = "", extra = "") => T.def.routes["element/:slug"](get(`/m/${ctx.instance.key}/element/reviews?lang=fr${q ? `&${q}` : ""}`), Object.assign(ctx, { params: { slug: "reviews", ...extra } }));
const tmData = async (ctx, q = "") => (await (await elementOf(ctx, `data=1${q ? `&${q}` : ""}`)).json()).reviews;

async function tmWorld(opts = {}) {
  tmOverlay.resetOverlayCache();
  const ctx = T.ctxFor({ settings: { order: "favorites", ...opts.settings }, locale: "fr" });
  await T.seed(ctx, { name: "Camille", text: "Un accueil très chaleureux, je recommande !", rating: 5, featured: true, email: SECRET_MAIL, tokenHash: "f".repeat(64) });
  await T.seed(ctx, { name: "Alex", text: "Super ambiance.", rating: 4, at: T.NOW - 2 * T.DAY });
  await T.seed(ctx, { name: "Sam", text: "Sans étoiles mais sincère.", rating: null, at: T.NOW - 3 * T.DAY });
  await T.seed(ctx, { name: "EnAttente", status: "pending", text: "PAS ENCORE VALIDÉ", at: T.NOW - 4 * T.DAY });
  await T.seed(ctx, { name: "Refusé", status: "rejected", text: "AVIS REFUSÉ", at: T.NOW - 5 * T.DAY });
  await T.seed(ctx, { name: "SansAccord", text: "SANS ACCORD DE L'AUTEUR", consent: { text: "", at: "", locale: "", by: "" }, at: T.NOW - 6 * T.DAY });
  return ctx;
}

test("Avis de la communauté : seulement les avis publics (validés ET avec accord) ; jamais e-mail, lien privé, avis en attente, refusé ou sans accord", async () => {
  const ctx = await tmWorld();
  const res = await elementOf(ctx);
  assert.equal(res.status, 200);
  const doc = await res.text();
  const data = JSON.parse(/<script type="application\/json" id="d">([\s\S]*?)<\/script>/.exec(doc)[1]);
  assert.deepEqual(data.reviews.map((r) => r.name), ["Camille", "Alex", "Sam"], "favoris d'abord, comme sur la page publique");
  assert.deepEqual(Object.keys(data.reviews[0]).sort(), ["favorite", "name", "rating", "text"], "champ par champ : rien d'autre ne sort");
  const everything = doc + JSON.stringify(await tmData(ctx));
  for (const secret of [SECRET_MAIL, "f".repeat(64), "PAS ENCORE VALIDÉ", "AVIS REFUSÉ", "SANS ACCORD", "EnAttente", "Refusé", "SansAccord", ctx.instance.key + "/withdraw"]) assert.ok(!everything.includes(secret), `ne doit jamais sortir : ${secret}`);
});

test("Avis de la communauté : un avis retiré, refusé ou sans accord disparaît de l'élément (après le délai de la lecture partagée)", async () => {
  const ctx = await tmWorld();
  assert.equal((await tmData(ctx)).length, 3);
  const rows = T.stored(ctx);
  const camille = rows.find((r) => r.data.name === "Camille");
  await ctx.api.store.update(camille.id, { ...camille.data, status: "rejected" });
  assert.equal((await tmData(ctx)).length, 3, "dans le délai : la lecture partagée est gardée");
  tmOverlay.resetOverlayCache();
  assert.deepEqual((await tmData(ctx)).map((r) => r.name), ["Alex", "Sam"]);
  await ctx.api.store.update(camille.id, { ...camille.data, status: "approved", consent: { text: "", at: "", locale: "", by: "" } });
  tmOverlay.resetOverlayCache();
  assert.ok(!(await tmData(ctx)).some((r) => r.name === "Camille"), "sans accord enregistré : jamais montré");
});

test("Avis de la communauté : options « Nombre d'avis » et « Secondes par avis » validées ; l'ordre du module est respecté", async () => {
  const ctx = await tmWorld();
  const cfg = async (q) => JSON.parse(/<script type="application\/json" id="d">([\s\S]*?)<\/script>/.exec(await (await elementOf(ctx, q)).text())[1]);
  assert.equal((await cfg("")).seconds, 12);
  assert.equal((await cfg("opt-seconds=30")).seconds, 30);
  assert.equal((await cfg("opt-seconds=1")).seconds, 4);
  assert.equal((await cfg("opt-seconds=9999")).seconds, 120);
  assert.equal((await cfg("")).reviews.length, 3);
  assert.equal((await cfg("opt-count=2")).reviews.length, 2);
  assert.equal((await cfg("opt-count=0")).reviews.length, 1);
  assert.equal((await tmData(ctx, "opt-count=2")).length, 2);
  for (const bad of ["<script>", "abc", "", "%00", "-5", "1e9", "x".repeat(300)]) {
    const c = await cfg(`opt-seconds=${encodeURIComponent(bad)}&opt-count=${encodeURIComponent(bad)}`);
    assert.ok(c.seconds >= 4 && c.seconds <= 120 && c.reviews.length >= 1 && c.reviews.length <= 3, `option hostile : ${bad}`);
  }
  const newest = await tmWorld({ settings: { order: "newest" } });
  assert.deepEqual((await tmData(newest)).map((r) => r.name), ["Camille", "Alex", "Sam"]);
  await T.seed(newest, { name: "Récent", text: "Tout dernier avis.", at: T.NOW - 1000, featured: false });
  tmOverlay.resetOverlayCache();
  assert.equal((await tmData(newest))[0].name, "Récent", "ordre « récents d'abord » du module");
});

test("Avis de la communauté : un avis long est coupé à un mot entier ; un texte HTML reste une donnée", async () => {
  assert.equal(tmOverlay.shorten("court"), "court");
  const long = "mot ".repeat(200);
  const cut = tmOverlay.shorten(long);
  assert.ok(cut.length <= 261 && cut.endsWith("mot…"), cut.slice(-10));
  assert.equal(tmOverlay.shorten("x".repeat(500)).length, 260, "sans espace : coupé au caractère");
  tmOverlay.resetOverlayCache();
  const evil = `</script><img src=x onerror=alert(1)>`;
  const ctx = T.ctxFor({ locale: "fr" });
  await T.seed(ctx, { name: evil, text: evil, rating: 3 });
  const doc = await (await elementOf(ctx)).text();
  assert.ok(!doc.includes(evil) && !/<img src=x/.test(doc), "rien d'interprété");
  assert.equal((await tmData(ctx))[0].text, evil, "la donnée reste telle quelle (JSON)");
  assert.ok(!/innerHTML|outerHTML|document\.write|eval\(/.test(doc.slice(doc.indexOf("<script>"))), "le script remplit avec textContent");
});

test("Avis de la communauté : la page remplit le cadre, suit le style commun (--ov-*), ne charge jamais le skin du site, ne se laisse pas encadrer ailleurs", async () => {
  const ctx = await tmWorld();
  const res = await elementOf(ctx, "ov-w=480&ov-h=200&ov-text=dark&ov-surface=soft&ov-corners=square");
  const doc = await res.text();
  assert.match(doc, /<html lang="fr" data-ov-region="element">/);
  for (const p of ["panel", "quote", "footer", "avatar", "author", "stars"]) assert.match(doc, new RegExp(`data-ov-part="${p}"`), p);
  assert.match(doc, /:root\{--ov-fg:#111111;--ov-surface:rgba\(255,255,255,\.7\);--ov-radius:0px;--ov-border:rgba\(0,0,0,\.18\);\}/);
  assert.match(doc, /position:absolute;inset:0/);
  assert.match(doc, /var\(--ov-fg,#fff\)/);
  assert.ok(!/--sk-|data-skin|var\(--v-|<link|@import|https?:\/\/|localStorage|document\.cookie/.test(doc), "aucun skin ni thème du site, aucun chargement tiers, aucun stockage du navigateur");
  assert.match(res.headers.get("content-security-policy"), /default-src 'none'.*connect-src 'self'.*frame-ancestors 'self'/);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal((await elementOf(ctx, "", { slug: "autre" })).status, 404);
  const post = await T.def.routes["element/:slug"](new Request("https://example.test/m/x/element/reviews", { method: "POST", body: "x" }), Object.assign(ctx, { params: { slug: "reviews" } }));
  assert.equal(post.status, 405);
  assert.equal(T.stored(ctx).length, 6, "lire ne change rien dans le stockage");
});

test("Avis de la communauté : mode test — un avis d'exemple SEULEMENT quand aucun avis n'est public ; sans mode test, un cadre vide", async () => {
  tmOverlay.resetOverlayCache();
  const empty = T.ctxFor({ locale: "fr" });
  await T.seed(empty, { name: "EnAttente", status: "pending", text: "PAS ENCORE VALIDÉ" });
  assert.deepEqual(await tmData(empty), [], "rien de public : cadre vide, silencieux");
  const demo = await tmData(empty, "ov-demo=1");
  assert.deepEqual(demo.map((r) => r.name), ["Camille"]);
  assert.match(demo[0].text, /Exemple d'avis/);
  assert.ok(!JSON.stringify(demo).includes("PAS ENCORE"));
  const real = await tmWorld();
  assert.ok(!(await tmData(real, "ov-demo=1")).some((r) => /Exemple/.test(r.text)), "de vrais avis publics : ce sont eux qui sont montrés");
});

test("Avis de la communauté : une seule lecture du stockage sert tous les lecteurs", async () => {
  const ctx = await tmWorld();
  let reads = 0;
  const page = ctx.api.store.page.bind(ctx.api.store);
  ctx.api.store.page = (...a) => { reads++; return page(...a); };
  await Promise.all(Array.from({ length: 10 }, () => tmData(ctx)));
  await tmData(ctx); await tmData(ctx, "opt-count=1");
  assert.equal(reads, 1, "12 lectures de l'élément : une lecture du stockage");
  assert.ok(tmOverlay.CACHE.ttlMs >= 10_000 && tmOverlay.CACHE.ttlMs <= 120_000, "quelques dizaines de secondes");
  tmOverlay.resetOverlayCache();
  await tmData(ctx);
  assert.equal(reads, 2);
});

test("Avis de la communauté : deux pages d'overlay montrent le MÊME avis au même instant ; ils défilent avec l'heure", async () => {
  const ctx = await tmWorld();
  const doc = splitDocument(await (await elementOf(ctx, "opt-seconds=10")).text());
  const dispatch = async (url) => T.def.routes["element/:slug"](new Request(url), Object.assign(ctx, { params: { slug: "reviews" } }));
  const [a, b] = [runElementPage(doc, { dispatch }), runElementPage(doc, { dispatch })];
  await Promise.all([a.advance(100), b.advance(100)]);
  const seen = [];
  for (let i = 0; i < 6; i++) {
    assert.equal(a.els.a.textContent, b.els.a.textContent, "même avis au même instant");
    assert.equal(a.els.q.textContent, b.els.q.textContent);
    seen.push(a.els.a.textContent);
    assert.equal(a.els.s.hidden, a.els.a.textContent === "Sam", "un avis sans étoiles n'affiche pas d'étoiles");
    if (a.els.a.textContent === "Camille") assert.equal(a.els.s.textContent, "★★★★★");
    await Promise.all([a.advance(10_000), b.advance(10_000)]);
  }
  assert.deepEqual([...new Set(seen)].sort(), ["Alex", "Camille", "Sam"], "tous les avis passent");
  await a.advance(1000);
  assert.ok(a.els.p.on);
});

test("Avis de la communauté : la page se met à jour doucement (avis ajouté ou retiré), de plus en plus lentement quand rien ne change, et se borne", async () => {
  const ctx = await tmWorld();
  const doc = splitDocument(await (await elementOf(ctx, "opt-seconds=5")).text());
  const page = runElementPage(doc, { url: "https://x.test/m/k/element/reviews?lang=fr&opt-seconds=5", dispatch: async (url) => T.def.routes["element/:slug"](new Request(url), Object.assign(ctx, { params: { slug: "reviews" } })) });
  await page.advance(30_000);
  assert.equal(page.requests, 0, "30 s : aucune demande, le contenu est déjà dans la page");
  await page.advance(40_000);
  assert.equal(page.requests, 1, "au bout d'une minute environ : une seule demande");
  await page.advance(10 * 60_000);
  assert.ok(page.requests <= 8, `de plus en plus lent : ${page.requests} demandes en 11 minutes`);
  // Les avis changent : la page les reprend à sa prochaine demande.
  await T.seed(ctx, { name: "Nouveau", text: "Tout dernier avis publié.", rating: 5, featured: true, at: T.NOW });
  tmOverlay.resetOverlayCache();
  await page.advance(12 * 60_000);
  const names = new Set();
  for (let i = 0; i < 6; i++) { names.add(page.els.a.textContent); await page.advance(5000); }
  assert.ok(names.has("Nouveau"), [...names].join());
});

test("Avis de la communauté : plusieurs pages d'overlay peuvent lire les mêmes avis (assertMultiReaders)", async () => {
  tmOverlay.resetOverlayCache();
  const ctx = T.ctxFor({ settings: { order: "newest" }, locale: "fr" });
  const real = tmOverlay.CACHE.ttlMs; tmOverlay.CACHE.ttlMs = 0;
  let n = 0;
  try {
    await assertMultiReaders({
      readers: 4,
      publish: async (text) => { await T.seed(ctx, { name: `Personne ${++n}`, text, at: T.NOW + n * 1000 }); },
      open: async () => {
        const seen = new Set((await tmData(ctx, "opt-count=20")).map((r) => r.text)); // le repère est pris TOUT DE SUITE, à la fin du flux
        return { read: async () => { const fresh = (await tmData(ctx, "opt-count=20")).filter((r) => !seen.has(r.text)); fresh.forEach((r) => seen.add(r.text)); return fresh.reverse(); } };
      },
    });
  } finally { tmOverlay.CACHE.ttlMs = real; }
});

// ═════════════════════════════════════════════════ Mascotte : élément réduit ═════════════════════════════════════════════════
const mcElement = (ctx, q = "") => K.def.routes["element/:slug"](get(`/m/${ctx.instance.key}/element/mascot?lang=${ctx.locale}${q ? `&${q}` : ""}`), Object.assign(ctx, { params: { slug: "mascot" } }));
const mcData = async (ctx, q = "") => (await (await mcElement(ctx, `data=1${q ? `&${q}` : ""}`)).json());
const mcPageData = async (ctx, q = "") => JSON.parse(/<script type="application\/json" id="d">([\s\S]*?)<\/script>/.exec(await (await mcElement(ctx, q)).text())[1]);
const SECRETS = ["SECRET-EVENT", "SECRET-LIVE", "SECRET-NEWS", "SECRET-HINT"];
async function mcWorld({ published = true, phrases, settings = {}, services = {}, topics = {}, locale = "fr", site } = {}) {
  mcOverlay.resetOverlayCache(); K.store.resetStore();
  const ctx = K.ctxFor(settings, { locale, services, topics, ...(site ? { site } : {}) });
  await K.store.saveConfig(ctx, { published });
  for (const p of phrases ?? [
    { kind: "hello", text: "Bonjour, ici {nom} sur {nom_du_site} !" },
    { kind: "tip", text: "Astuce : tapez !planning dans le chat." },
    { kind: "news", text: "Nouveau : la boutique est ouverte." },
  ]) await ctx.api.store.add("phrases", { kind: "hello", lang: "", pages: [], link: "", state: "published", at: 1000, ...p });
  K.store.resetStore();
  return ctx;
}

test("Mascotte (privé) : à l'écran de stream, les phrases ne viennent QUE de ce que la personne a écrit — jamais événements, directs, nouveautés ni suggestions d'autres modules", async () => {
  const eventCalls = [];
  const ctx = await mcWorld({
    phrases: [
      { kind: "hello", text: "Bonjour, ici {nom} sur {nom_du_site} !" },
      { kind: "news", text: "Prochain : {prochain_evenement}, {date_evenement}." },
      { kind: "news", text: "En direct : {titre_direct}." },
      { kind: "news", text: "Nouveau : {derniere_nouveaute}." },
      { kind: "tip", text: "Une astuce écrite à la main." },
    ],
    services: {
      ...K.eventSource([{ id: "e1", title: "SECRET-EVENT", start: K.inDays(2), url: "https://example.org/e" }]),
      "twitch.live": { status: async () => { eventCalls.push("twitch"); return { live: true, channel: "chaine", displayName: "SECRET-LIVE", title: "SECRET-LIVE" }; } },
    },
    topics: { "feed.item": [{ title: "SECRET-NEWS", url: "https://example.org/n", publishedAt: new Date().toISOString() }], "mascot.hint": [{ id: "h1", text: "SECRET-HINT", url: "https://example.org/h" }] },
    site: { name: "Mon site", tagline: "", logo: null },
  });
  await K.store.saveConfig(ctx, { names: { fr: "Pixel" } });
  mcOverlay.resetOverlayCache();
  const doc = await (await mcElement(ctx)).text();
  const data = await mcData(ctx);
  assert.deepEqual(data.lines.map((l) => l.text), ["Bonjour, ici Pixel sur Mon site !", "Une astuce écrite à la main."], "seulement les phrases écrites, avec le nom du site et de la mascotte");
  for (const text of [doc, JSON.stringify(data)]) {
    for (const s of SECRETS) assert.ok(!text.includes(s), `ne doit jamais sortir : ${s}`);
    assert.ok(!/Prochain :|En direct :|Nouveau :/.test(text), "une phrase qui dépend d'un autre module n'est pas dite");
  }
  assert.deepEqual(ctx.calls.services, [], "aucun service d'un autre module n'est interrogé");
  assert.deepEqual(ctx.calls.topics, [], "aucun sujet d'un autre module n'est lu");
  assert.deepEqual(eventCalls, []);
});

test("Mascotte (visibilité) : brouillon → cadre vide ; brouillons de phrases et phrases réservées à des pages du site → jamais dits ; langue demandée respectée", async () => {
  const draft = await mcWorld({ published: false });
  assert.deepEqual(await mcData(draft), { name: "Mascotte", lines: [] });
  const html = await (await mcElement(draft)).text();
  assert.match(html, /id="a"[^>]* hidden/, "pas de personnage dans un cadre vide");
  const mixed = await mcWorld({ phrases: [{ text: "Visible." }, { text: "Brouillon.", state: "draft" }, { text: "Seulement sur la FAQ.", pages: ["/faq"] }, { text: "Hello in English.", lang: "en" }, { text: "Bonjour en français.", lang: "fr" }] });
  assert.deepEqual((await mcData(mixed)).lines.map((l) => l.text), ["Visible.", "Bonjour en français."]);
  const english = await mcWorld({ locale: "en", phrases: [{ text: "Visible." }, { text: "Hello in English.", lang: "en" }, { text: "Bonjour en français.", lang: "fr" }] });
  assert.deepEqual((await mcData(english)).lines.map((l) => l.text), ["Visible.", "Hello in English."]);
  const none = await mcWorld({ phrases: [{ text: "Brouillon.", state: "draft" }] });
  assert.deepEqual((await mcData(none)).lines, [], "aucune phrase publiée : elle ne dit rien");
});

test("Mascotte (mode test) : une phrase d'exemple avec le dessin inclus SEULEMENT quand elle n'a rien à dire (jamais d'image ni de nom d'une mascotte non publiée) ; sans mode test, vide", async () => {
  const draft = await mcWorld({ published: false });
  await K.store.saveConfig(draft, { look: "image", image: "/uploads/123e4567-e89b-12d3-a456-426614174000.png", names: { fr: "Pixel Secret" }, alts: { fr: "Une image" } });
  mcOverlay.resetOverlayCache();
  const demoDoc = await (await mcElement(draft, "ov-demo=1")).text();
  const demo = await mcData(draft, "ov-demo=1");
  assert.deepEqual(demo, { name: "Mascotte", lines: [{ kind: "hello", text: "Bonjour ! Voici un exemple de phrase de la mascotte." }] });
  assert.ok(!demoDoc.includes("Pixel Secret") && !demoDoc.includes("/uploads/"), "rien de la mascotte non publiée");
  assert.match(demoDoc, /class="mc-svg"/, "le dessin inclus");
  assert.deepEqual((await mcData(draft)).lines, []);
  const real = await mcWorld();
  assert.ok(!(await mcData(real, "ov-demo=1")).lines.some((l) => /exemple/i.test(l.text)), "de vraies phrases : ce sont elles qui sont dites");
});

test("Mascotte (apparence) : le dessin inclus ou l'image choisie (avec sa description) ; image sans description → dessin inclus", async () => {
  const ctx = await mcWorld();
  const draw = await (await mcElement(ctx)).text();
  assert.equal((draw.match(/class="mc-svg"/g) ?? []).length, 2, "deux humeurs : contente (bonjour) et curieuse (astuce, nouveauté)");
  await K.store.saveConfig(ctx, { look: "image", image: "/uploads/123e4567-e89b-12d3-a456-426614174000.png?c=1.0_1_0.5_0.5_ffffff", alts: { fr: "Un petit renard <b>roux</b>" }, crop: "square" });
  mcOverlay.resetOverlayCache();
  const img = await (await mcElement(ctx)).text();
  assert.match(img, /<img class="sq" src="\/uploads\/123e4567-e89b-12d3-a456-426614174000\.png\?c=1\.0_1_0\.5_0\.5_ffffff" alt="Un petit renard &lt;b&gt;roux&lt;\/b&gt;">/);
  assert.ok(!img.includes("mc-svg"));
  await K.store.saveConfig(ctx, { alts: {} });
  mcOverlay.resetOverlayCache();
  assert.match(await (await mcElement(ctx)).text(), /class="mc-svg"/, "sans description de l'image : comme sur le site, le dessin inclus");
});

test("Mascotte (cadre d'overlay) : suit le style commun, ne reprend ni le script ni la feuille de style du site, aucun coin de page, aucun stockage du navigateur ni cookie", async () => {
  const ctx = await mcWorld({ settings: { corner: "left", where: "some", pages: "/faq", delay: 30, show: 20, max: 1, footerLink: true } });
  const res = await mcElement(ctx, "ov-w=440&ov-h=320&ov-text=dark&ov-surface=soft&ov-corners=square");
  const doc = await res.text();
  assert.match(doc, /<html lang="fr" class="soft" data-ov-region="element">/);
  assert.match(doc, /:root\{--ov-fg:#111111;--ov-surface:rgba\(255,255,255,\.7\);--ov-radius:0px;--ov-border:rgba\(0,0,0,\.18\);\}/);
  for (const p of ["bubble", "bubble-tail", "name", "text", "avatar"]) assert.match(doc, new RegExp(`data-ov-part="${p}"`), p);
  assert.ok(!/localStorage|sessionStorage|document\.cookie|mascot\.js|mascot\.css|mc-r\b|mc-w\b|position:fixed;bottom|--sk-|data-skin|var\(--v-|<link|@import|https?:\/\//.test(doc), "aucun reste de la mascotte du site");
  assert.match(res.headers.get("content-security-policy"), /default-src 'none'.*frame-ancestors 'self'/);
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal((await mcData(ctx)).lines.length, 3, "« où », pages, coin, délai, messages par jour : réglages du site, ignorés ici");
  assert.equal(K.def.overlayElements.mascot(ctx, undefined).url.includes("mascot.js"), false);
  const post = await K.def.routes["element/:slug"](new Request("https://example.test/m/x/element/mascot", { method: "POST", body: "x" }), Object.assign(ctx, { params: { slug: "mascot" } }));
  assert.equal(post.status, 405);
  assert.equal((await K.def.routes["element/:slug"](get("/m/x/element/zzz"), Object.assign(ctx, { params: { slug: "zzz" } }))).status, 404);
});

test("Mascotte (options) : « Secondes par phrase » validée, valeurs hostiles ignorées", async () => {
  const ctx = await mcWorld();
  assert.equal((await mcPageData(ctx)).seconds, 10);
  assert.equal((await mcPageData(ctx, "opt-seconds=20")).seconds, 20);
  assert.equal((await mcPageData(ctx, "opt-seconds=1")).seconds, 4);
  assert.equal((await mcPageData(ctx, "opt-seconds=9999")).seconds, 60);
  for (const bad of ["<script>", "abc", "", "%00", "-5", "x".repeat(300)]) { const s = (await mcPageData(ctx, `opt-seconds=${encodeURIComponent(bad)}`)).seconds; assert.ok(s >= 4 && s <= 60, bad); }
});

test("Mascotte : une seule lecture du site sert tous les lecteurs ; le texte HTML reste une donnée", async () => {
  const ctx = await mcWorld({ phrases: [{ text: "<img src=x onerror=alert(1)> {nom_du_site}" }], site: { name: "Mon <b>site</b>", tagline: "", logo: null } });
  let siteReads = 0;
  const site = ctx.api.site;
  ctx.api.site = (...a) => { siteReads++; return site(...a); };
  const pages = await Promise.all(Array.from({ length: 8 }, () => mcElement(ctx).then((r) => r.text())));
  await mcData(ctx); await mcData(ctx);
  assert.equal(siteReads, 1, "10 lectures de l'élément : une seule lecture");
  assert.ok(pages.every((p) => !p.includes("<img src=x")), "rien d'interprété");
  assert.equal((await mcData(ctx)).lines[0].text, "<img src=x onerror=alert(1)> Mon <b>site</b>", "texte écrit ou venu d'ailleurs : une donnée, jamais du code");
  assert.ok(mcOverlay.CACHE.ttlMs >= 10_000 && mcOverlay.CACHE.ttlMs <= 120_000, "quelques dizaines de secondes");
});

test("Mascotte : deux pages d'overlay disent la MÊME phrase au même instant ; elle change avec l'heure ; le personnage change d'humeur", async () => {
  const ctx = await mcWorld();
  const doc = splitDocument(await (await mcElement(ctx, "opt-seconds=6")).text());
  const dispatch = async (url) => K.def.routes["element/:slug"](new Request(url), Object.assign(ctx, { params: { slug: "mascot" } }));
  const [a, b] = [runElementPage(doc, { dispatch }), runElementPage(doc, { dispatch })];
  await Promise.all([a.advance(100), b.advance(100)]);
  const said = [];
  for (let i = 0; i < 6; i++) {
    assert.equal(a.els.t.textContent, b.els.t.textContent, "même phrase au même instant");
    assert.equal(a.els.a.attrs["data-mood"], b.els.a.attrs["data-mood"]);
    said.push([a.els.t.textContent, a.els.a.attrs["data-mood"]]);
    await Promise.all([a.advance(6000), b.advance(6000)]);
  }
  assert.equal(new Set(said.map((s) => s[0])).size, 3, "toutes les phrases passent");
  assert.ok(said.every(([text, mood]) => mood === (text.startsWith("Bonjour") ? "happy" : "curious")));
  await a.advance(1000);
  assert.ok(a.els.b.on && a.els.y.on && !a.els.a.hidden);
});

test("Mascotte : sans phrase à dire, le cadre reste vide ; une phrase publiée plus tard apparaît à la mise à jour douce", async () => {
  const ctx = await mcWorld({ phrases: [{ text: "Brouillon.", state: "draft" }] });
  const doc = splitDocument(await (await mcElement(ctx, "opt-seconds=5")).text());
  const page = runElementPage(doc, { url: "https://x.test/m/k/element/mascot?lang=fr&opt-seconds=5", dispatch: async (url) => K.def.routes["element/:slug"](new Request(url), Object.assign(ctx, { params: { slug: "mascot" } })) });
  await page.advance(10_000);
  assert.equal(page.els.b.on, false);
  assert.equal(page.els.a.hidden, true);
  await ctx.api.store.add("phrases", { kind: "tip", lang: "", pages: [], link: "", state: "published", at: 2000, text: "Enfin une phrase." });
  K.store.resetStore(); mcOverlay.resetOverlayCache();
  await page.advance(70_000);
  await page.advance(5_000);
  assert.equal(page.els.t.textContent, "Enfin une phrase.");
  assert.equal(page.els.a.hidden, false);
});

test("Mascotte : plusieurs pages d'overlay peuvent lire les mêmes phrases (assertMultiReaders)", async () => {
  mcOverlay.resetOverlayCache(); K.store.resetStore();
  const ctx = K.ctxFor();
  await K.store.saveConfig(ctx, { published: true });
  const real = mcOverlay.CACHE.ttlMs; mcOverlay.CACHE.ttlMs = 0;
  const realKeep = K.store.timing.keepMs; K.store.timing.keepMs = 0;
  let n = 0;
  try {
    await assertMultiReaders({
      readers: 4,
      publish: async (text) => { await ctx.api.store.add("phrases", { kind: "tip", lang: "", pages: [], link: "", state: "published", at: 1000 + ++n, text }); },
      open: async () => {
        const seen = new Set((await mcData(ctx)).lines.map((l) => l.text)); // le repère est pris TOUT DE SUITE, à la fin du flux
        return { read: async () => { const fresh = (await mcData(ctx)).lines.filter((l) => !seen.has(l.text)); fresh.forEach((l) => seen.add(l.text)); return fresh; } };
      },
    });
  } finally { mcOverlay.CACHE.ttlMs = real; K.store.timing.keepMs = realKeep; }
});

// ── Parité FR/EN des textes ajoutés ─────────────────────────────────────────────────────────────────────────────────
test("parité FR/EN : les textes ajoutés par les trois éléments existent dans les deux langues, sans doublon, et sont tous utilisés", () => {
  for (const [dir, keys] of [["ticker-overlay", ["demoTitle", "demoText", "demoCode"]], ["testimonials", ["elementTitle", "demoName", "demoReview"]], ["mascot", ["elementTitle", "elementDemo"]]]) {
    const fr = read(dir, "locales/fr.json"), en = read(dir, "locales/en.json");
    assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort(), `${dir} : mêmes clés`);
    const source = fs.readdirSync(new URL(`../modules/${dir}/`, import.meta.url)).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(new URL(`../modules/${dir}/${f}`, import.meta.url), "utf8")).join("\n");
    for (const k of keys) { assert.ok(fr[k] && en[k], `${dir}/${k}`); assert.ok(source.includes(`"${k}"`), `${dir}/${k} jamais lu`); if (k !== "demoName") assert.notEqual(fr[k], en[k], `${dir}/${k} identique`); }
  }
});
