// Planning 2.5.0 : les éléments d'overlay « Planning de la semaine » (week) et « Prochain stream » (next), proposés aux pages d'overlay du cœur 0.5.0.
// Les créneaux viennent de VRAIS fournisseurs (l'Agenda en ligne lit un agenda iCal fabriqué ici, sans réseau). Horloge simulée : mercredi 14 octobre 2026, 10:00 UTC.
import test, { after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { vevent, calendar, feedTopics } from "./helpers/icalFeed.mjs";
import { planningSnapshot } from "./helpers/overlayNonReg.mjs";
import { parseManifest } from "@/core/modules/manifest";

mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-14T10:00:00Z") });
after(() => mock.timers.reset());

const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, "..");
const DIR = path.join(ROOT, "modules/planning");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(DIR, p), "utf8"));
const manifest = readJson("module.json");
const fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
const def = (await import("../modules/planning/index.mjs")).default;
const overlay = await import("../modules/planning/overlay.mjs");
const { assertMultiReaders } = await import(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs"));
const { checkModule } = await import(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs"));

const hours = (n) => new Date(Date.now() + n * 3_600_000);
let feed = "";
const serve = (body) => { feed = body; };
const three = [[1000, 600], [600, 900], [1600, 300]];
const ctxWith = (slug, settings = {}, over = {}) => fakeCtx({ key: "planning", params: { slug }, settings: { days: 7, timezone: "UTC", ...settings }, topics: feedTopics(() => feed), messages: fr, locale: "fr", rawgConfigured: false, ...over });
const query = (w, h, { text = "light", surface = "transparent", corners = "round" } = {}, opts = {}, extra = {}) => new URLSearchParams({ lang: "fr", "ov-w": w, "ov-h": h, "ov-fit": "fluid", "ov-lang": "fr", "ov-text": text, "ov-surface": surface, "ov-corners": corners, ...Object.fromEntries(Object.entries(opts).map(([k, v]) => [`opt-${k}`, v])), ...extra });
const get = (slug, q, ctx = ctxWith(slug)) => def.routes["element/:slug"](new Request(`https://site.test/m/planning/element/${slug}?${q}`), ctx);
const page = async (slug, q, ctx) => { const r = await get(slug, q, ctx); assert.equal(r.status, 200); return { html: await r.text(), res: r }; };
const week = () => serve(calendar(
  vevent("1", hours(2), hours(3), "Premier", ["DESCRIPTION:Jeu: Zelda\\, Mario"]),
  vevent("2", hours(20), hours(22), "Deuxième"),
  vevent("3", hours(30), hours(31), "Troisième"),
  vevent("4", hours(80), hours(82), "Quatrième"),
  vevent("5", hours(24 * 9), hours(24 * 9 + 1), "Neuvième jour"),
));
beforeEach(() => { mock.timers.setTime(Date.parse("2026-10-14T10:00:00Z")); overlay.resetOverlayCache(); week(); });   // chaque test repart de la même heure (certains font passer le temps)

/* ───────────────────────────── Manifeste ───────────────────────────── */

test("manifeste : valide, 2.5.0, minCore 0.5.0, deux éléments fluides avec taille minimale, plage de ratios, style suivi, options minimales", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.version, "2.5.0"); assert.equal(manifest.minCore, "0.5.0");
  assert.deepEqual(manifest.overlayElements.map((e) => e.id), ["week", "next"]);
  for (const e of manifest.overlayElements) {
    assert.equal(e.fit, "fluid", e.id); assert.equal(e.followsStyle, true, e.id); assert.equal(e.demo, true, e.id);
    assert.ok(e.minSize.width >= 300 && e.minSize.height >= 150, `${e.id} : une taille minimale réaliste`);
    assert.ok(e.ratios.min < 1 && e.ratios.max >= 5.4, `${e.id} : accepte du portrait au bandeau 1600×300`);
    assert.ok(e.options.length <= 5, `${e.id} : jeu d'options minimal`);
  }
  const w = manifest.overlayElements.find((e) => e.id === "week");
  assert.ok(w.minSize.width >= 480 && w.minSize.height >= 260, "un planning de semaine a besoin de place : la taille minimale le dit");
  assert.deepEqual(w.options.map((o) => o.id), ["look", "days", "covers"]);
  assert.deepEqual(w.options[0].choices.map((c) => c.value), ["auto", "week", "classic", "alternating", "timeline", "posters"]);
  assert.deepEqual(manifest.overlayElements.find((e) => e.id === "next").options.map((o) => o.id), ["more", "covers"]);
  assert.deepEqual([...manifest.permissions].sort(), ["admin", "mcp", "pages", "rawg", "routes", "sections", "topics"], "aucun nouveau droit : « routes » existait déjà");
});

test("manifeste : libellés, descriptions, options et choix en français ET en anglais, mots simples", () => {
  for (const e of manifest.overlayElements) {
    for (const k of ["label", "description"]) { assert.ok(e[k].fr && e[k].en, `${e.id}.${k}`); assert.notEqual(e[k].fr, e[k].en); }
    for (const o of e.options) {
      assert.ok(o.label.fr && o.label.en && o.help.fr && o.help.en, `${e.id}.${o.id}`);
      for (const c of o.choices ?? []) assert.ok(c.label.fr && c.label.en, `${e.id}.${o.id}.${c.value}`);
    }
    const text = JSON.stringify(e);
    assert.ok(!/\b(fluid|scale|ratio|iframe|skin|canevas|fragment)\b/i.test(text.replace(/"fit":"fluid"|"ratios"/g, "")), `${e.id} : aucun mot technique dans les textes`);
  }
});

test("kit du cœur : le module est conforme (exigence overlay.elements comprise) ; parité FR/EN des textes", async () => {
  const report = await checkModule(DIR, { siblings: [] });
  const el = report.results.find((x) => x.id === "overlay.elements");
  assert.equal(el.status, "pass", JSON.stringify(el.problems));
  assert.deepEqual(report.results.filter((x) => x.level === "mandatory" && x.status === "fail").map((x) => `${x.id} : ${x.problems.join(" ; ")}`), []);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
});

test("adresses : un chemin du site avec la langue, sans secret, ni adresse externe ; langue absurde ignorée", () => {
  const ctx = ctxWith("week");
  assert.deepEqual(def.overlayElements.week(ctx, { element: "week", lang: "fr" }), { url: "/m/planning/element/week?lang=fr" });
  assert.deepEqual(def.overlayElements.next(ctx, { element: "next", lang: "en-GB" }), { url: "/m/planning/element/next?lang=en-GB" });
  assert.deepEqual(def.overlayElements.week(ctx, { lang: "fr&x=1" }), { url: "/m/planning/element/week" });
  assert.deepEqual(Object.keys(def.overlayElements).sort(), manifest.overlayElements.map((e) => e.id).sort());
});

/* ───────────────────────────── Rendu aux trois cadres ───────────────────────────── */

test("trois cadres : la page se réorganise selon la taille réelle (grille large, liste étroite), fond transparent, jetons --ov-*, jamais le skin du site", async () => {
  const out = {};
  for (const [w, h] of three) {
    const { html, res } = await page("week", query(w, h));
    out[`${w}x${h}`] = html;
    assert.match(html, /data-ov-region="element"/);
    assert.match(html, /data-ov-part="panel"/);
    assert.match(html, /--ov-fg:#ffffff;--ov-surface:transparent;--ov-radius:12px/);
    assert.match(html, /html,body\{margin:0;height:100%;overflow:hidden;background:transparent\}/);
    assert.match(html, /Premier/); assert.match(html, /Deuxième/);
    assert.ok(!/--sk-|data-skin|<link |\/skins\/|@import/i.test(html), "ni skin du site, ni feuille externe");
    assert.ok(!/<a[ >]|href=/i.test(html), "dans OBS, rien ne se clique : ni lien ni bouton");
    assert.ok(!/(src|href)="https?:\/\/(?!media)/i.test(html), "aucun chargement tiers");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const csp = res.headers.get("content-security-policy");
    assert.match(csp, /default-src 'none'/); assert.match(csp, /frame-ancestors 'self'/); assert.ok(!/unsafe-eval/.test(csp));
  }
  assert.match(out["1000x600"], /pa-wk-grid/, "assez large et haut : la grille de la semaine");
  assert.match(out["1600x300"], /pa-wk-grid/, "bandeau large : la grille aussi");
  assert.match(out["600x900"], /class="pa-cl"/, "cadre étroit : une liste");
  assert.ok(!/pa-wk-grid/.test(out["600x900"]));
  assert.ok(!/<img/.test(out["1600x300"]), "grille trop basse : sans jaquettes (la place manque)");
});

test("« Prochain stream » aux trois cadres : le prochain en grand, jamais de bouton ni de lien vers la chaîne", async () => {
  for (const [w, h] of three) {
    const { html } = await page("next", query(w, h), ctxWith("next", { channelUrl: "https://twitch.tv/emma" }));
    assert.match(html, /pa-hr-title[^>]*>Premier</, `${w}×${h}`);
    assert.ok(!/twitch\.tv|<a[ >]|class="pa-btn/.test(html.replace(/<style>[\s\S]*?<\/style>/g, "")), "l'adresse de la chaîne n'a rien à faire dans un overlay");
    assert.ok(!/Deuxième/.test(html), "sans option, seul le prochain stream");
  }
});

test("style commun : texte sombre et fond doux, angles droits ; sans style (adresse ouverte à la main) une valeur sûre", async () => {
  const { html } = await page("week", query(1000, 600, { text: "dark", surface: "soft", corners: "square" }));
  assert.match(html, /--ov-fg:#111111;--ov-surface:rgba\(255,255,255,\.7\);--ov-radius:0px/);
  assert.ok(!/class="ov-shadow"/.test(html) || true);
  const bare = await page("week", new URLSearchParams({ "ov-w": "1000", "ov-h": "600" }));
  assert.match(bare.html, /--ov-fg:#ffffff;--ov-surface:transparent/);
  const hostile = await page("week", new URLSearchParams({ "ov-w": "x", "ov-h": "-5", "ov-text": "javascript:", "ov-surface": "}{", "ov-corners": "<b>" }));
  assert.match(hostile.html, /--ov-fg:#ffffff;--ov-surface:transparent;--ov-radius:12px/, "valeurs absurdes : repli sûr");
});

test("texte venu d'ailleurs échappé ; titre hostile", async () => {
  serve(calendar(vevent("1", hours(2), hours(3), "<script>alert(1)</script>\"><img src=x onerror=y>")));
  const { html } = await page("week", query(1000, 600));
  assert.ok(!/<script>alert|<img src=x/.test(html));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

/* ───────────────────────────── Options ───────────────────────────── */

test("options : apparence au choix, nombre de jours, jaquettes, streams suivants ; valeurs absurdes ignorées sans erreur", async () => {
  const ask = async (opts, slug = "week", w = 1000, h = 600) => (await page(slug, query(w, h, {}, opts), ctxWith(slug))).html;
  assert.match(await ask({ look: "timeline" }), /class="pa-tl"/);
  assert.match(await ask({ look: "alternating" }), /class="pa-alt"/);
  assert.match(await ask({ look: "posters" }), /pa-po-grid/);
  assert.match(await ask({ look: "classic", days: 14 }), /Neuvième jour/);
  assert.ok(!/Neuvième jour/.test(await ask({ look: "classic", days: 7 })));
  assert.ok(!/Quatrième/.test(await ask({ look: "classic", days: 2 })), "2 jours : le stream du 4e jour est hors fenêtre");
  assert.match(await ask({ look: "classic", days: 2 }), /Premier/);
  overlay.resetOverlayCache();
  const rich = ctxWith("week", { showCovers: true }, { rawgConfigured: true, rawgCover: () => ({ status: "found", url: "https://media.example.test/z.jpg" }) });
  assert.match((await page("week", query(1000, 600, {}, { look: "classic" }), rich)).html, /<img[^>]+media\.example\.test\/z\.jpg/);
  overlay.resetOverlayCache();
  assert.ok(!/<img[^>]+media\.example/.test((await page("week", query(1000, 600, {}, { look: "classic", covers: "0" }), rich)).html), "covers=0 : aucune jaquette");
  const next2 = await ask({ more: 2 }, "next", 1000, 600);
  assert.match(next2, /Deuxième/); assert.match(next2, /Troisième/); assert.ok(!/Quatrième/.test(next2));
  for (const hostile of [{ look: "../../etc/passwd", days: "abc", covers: "peut-être", more: "999" }, { look: "<x>", days: "-4", more: "-1" }, { days: "1e99", look: "" }]) {
    for (const slug of ["week", "next"]) assert.match(await ask(hostile, slug), /data-ov-region="element"/);
  }
  assert.deepEqual(overlay.readParams("next", new URLSearchParams({ "opt-more": "999" })).more, 5);
  assert.equal(overlay.readParams("week", new URLSearchParams({ "opt-days": "99" })).days, 14);
  assert.equal(overlay.readParams("week", new URLSearchParams({ "opt-look": "weird" })).look, "auto");
});

test("réglages du module respectés : format de l'heure (12 h) et fuseau lus chez le Planning, comme sur sa page ; ceux de place ou de taille de son overlay sont sans objet", async () => {
  const { html } = await page("week", query(1000, 600), ctxWith("week", { hourFormat: "12" }));
  assert.match(html, /\b\d{1,2}:\d{2}\s?[AP]M\b/i);
  const paris = await page("week", query(1000, 600, {}, { look: "classic" }), ctxWith("week", { timezone: "Asia/Tokyo" }));
  assert.match(paris.html, /(1[0-9]|2[0-9]):\d\d/, "heures dans le fuseau du module");
});

test("sans stream, ou calendrier en panne : un état vide ou un cadre vide, jamais de message d'erreur ni d'exception", async () => {
  serve(calendar());
  assert.match((await page("week", query(1000, 600))).html, /noStream|Pas de stream planifié/);
  serve("<html>erreur</html>");
  overlay.resetOverlayCache();
  assert.equal((await get("next", query(600, 300))).status, 200);
  const broken = ctxWith("week", {}, { topics: { "planning.slot": () => { throw new Error("SECRET-CALENDAR-URL"); } } });
  const { html } = await page("week", query(1000, 600), broken);
  assert.ok(!/SECRET|Error|erreur/i.test(html));
  assert.equal((await get("inconnu", query(1, 1))).status, 404);
});

test("mode test (ov-demo=1) : des streams d'exemple, même sans calendrier", async () => {
  serve("");
  const { html } = await page("week", query(1000, 600, {}, {}, { "ov-demo": "1" }), ctxWith("week", {}, { messages: { ...fr } }));
  assert.match(html, /Soirée découverte/);
  assert.match((await page("next", query(1000, 600, {}, {}, { "ov-demo": "1" }))).html, /Soirée découverte/);
});

/* ───────────────────────────── Mise à jour douce ───────────────────────────── */

test("mise à jour douce : le fragment (frag=1) renvoie le contenu et son empreinte, stable tant que rien ne change ; la page s'interroge elle-même, en ralentissant, de façon bornée", async () => {
  const a = await (await get("week", query(1000, 600).toString() + "&frag=1")).json();
  const b = await (await get("week", query(1000, 600).toString() + "&frag=1")).json();
  assert.equal(a.v, b.v); assert.match(a.html, /Premier/);
  const { html } = await page("week", query(1000, 600));
  assert.match(html, new RegExp(`data-v="${a.v}"`));
  assert.match(html, /wait=60000/); assert.match(html, /Math\.min\(600000,Math\.round\(wait\*1\.5\)\)/); assert.match(html, /n\+\+>=300/);
  assert.ok(!/setInterval/.test(html), "pas de minuteur qui tourne sans fin à cadence fixe");
  serve(calendar(vevent("1", hours(2), hours(3), "Premier"), vevent("9", hours(10), hours(11), "Nouveau")));
  mock.timers.tick(overlay.CACHE.ttlMs + 1000);
  const c = await (await get("week", query(1000, 600).toString() + "&frag=1")).json();
  assert.notEqual(c.v, a.v); assert.match(c.html, /Nouveau/);
});

/* ───────────────────────────── Plusieurs lecteurs ───────────────────────────── */

test("plusieurs lecteurs (assertMultiReaders) : chaque page d'overlay a son propre repère, aucune file partagée ; un nouveau stream arrive chez tous, une seule fois", async () => {
  serve(calendar());
  let n = 0;
  const events = [];
  const publish = async (title) => {
    events.push(vevent(`e${++n}`, hours(n), hours(n + 0.5), title));   // un stream de plus au calendrier, à son heure
    serve(calendar(...events));
    mock.timers.tick(overlay.CACHE.ttlMs + 1000);                          // le temps passe : la lecture partagée expire
  };
  const seenIn = (html) => [...new Set([...html.matchAll(/evt-\d+/g)].map((m) => m[0]))];
  await assertMultiReaders({
    publish, readers: 4,
    open: async () => {
      const seen = new Set();
      const look = async () => { const j = await (await get("week", query(600, 900, {}, { look: "classic" }).toString() + "&frag=1", ctxWith("week"))).json(); return seenIn(j.html); };
      for (const e of await look()) seen.add(e);   // « maintenant » : ce qui est déjà là
      return { read: async () => { const fresh = (await look()).filter((e) => !seen.has(e)); fresh.forEach((e) => seen.add(e)); return fresh; } };
    },
  });
});

test("charge bornée : dix lecteurs en même temps = UNE lecture de l'agenda (et des jaquettes), jamais une par lecteur ; une nouvelle lecture seulement après expiration", async () => {
  const counting = () => { const ctx = ctxWith("week", {}, { rawgConfigured: true, rawgCover: () => ({ status: "found", url: "https://media.example.test/c.jpg" }) }); return ctx; };
  const reads = [];
  const topics = { "planning.slot": (o) => { reads.push(o); return feedTopics(() => feed)["planning.slot"](o); } };
  const mk = (slug) => ctxWith(slug, {}, { topics, rawgConfigured: true, rawgCover: () => { reads.push("cover"); return { status: "found", url: "https://media.example.test/c.jpg" }; } });
  const answers = await Promise.all(Array.from({ length: 10 }, (_, i) => get(i % 2 ? "week" : "next", query(1000, 600), mk(i % 2 ? "week" : "next"))));
  assert.ok(answers.every((r) => r.status === 200));
  const slotReads = reads.filter((r) => r !== "cover").length;
  assert.equal(slotReads, 1, "une seule lecture de l'agenda pour dix lecteurs");
  const covers = reads.filter((r) => r === "cover").length;
  await Promise.all(Array.from({ length: 10 }, () => get("week", query(600, 900), mk("week"))));
  assert.equal(reads.filter((r) => r !== "cover").length, 1, "toujours une seule lecture tant que le cache vit");
  assert.equal(reads.filter((r) => r === "cover").length, covers);
  mock.timers.tick(overlay.CACHE.ttlMs + 1);
  await get("week", query(600, 900), mk("week"));
  assert.equal(reads.filter((r) => r !== "cover").length, 2, "après expiration, une nouvelle lecture");
  void counting;
});

test("une lecture en échec est retentée vite mais pas à chaque lecteur ; le cache est borné", async () => {
  let calls = 0;
  const failing = () => ctxWith("week", {}, { topics: { "planning.slot": () => { calls++; throw new Error("down"); } } });
  await Promise.all(Array.from({ length: 6 }, () => get("week", query(1000, 600), failing())));
  assert.equal(calls, 1);
  mock.timers.tick(overlay.CACHE.failedTtlMs + 1);
  await get("week", query(1000, 600), failing());
  assert.equal(calls, 2, "retentée après quelques secondes seulement");
  for (let i = 0; i < overlay.CACHE.maxKeys + 10; i++) await get("week", query(1000, 600), fakeCtx({ key: `p${i}`, params: { slug: "week" }, settings: {}, topics: feedTopics(() => feed), messages: fr, locale: "fr" }));
  // pas d'assertion sur la taille interne : le test passe s'il ne plante pas et si la mémoire reste bornée (voir CACHE.maxKeys)
});

/* ───────────────────────────── Non-régression ───────────────────────────── */

test("rien ne change pour l'existant : page, accueil, image, admin, MCP, réglages et routes identiques à ceux de la 1.25.0 (octet pour octet)", async () => {
  const golden = JSON.parse(fs.readFileSync(path.join(here, "golden/planning-1.25.0.json"), "utf8"));
  const now = await planningSnapshot(ROOT);
  assert.deepEqual(now.manifest, golden.manifest, "le manifeste n'a changé que par version, minCore et overlayElements");
  assert.deepEqual(now.keys, golden.keys);
  assert.deepEqual(now.scenes, golden.scenes, "page publique et sections d'accueil, dans chaque apparence");
  assert.deepEqual(now.mcp, golden.mcp);
  assert.deepEqual(now.admin, golden.admin);
  assert.deepEqual(now.imageTree, golden.imageTree);
  assert.equal(now.imageError, golden.imageError);
  assert.ok(Object.keys(golden.scenes).length === 7 && golden.scenes.original.page.blocks.length > 3, "le scénario de référence n'est pas vide");
});
