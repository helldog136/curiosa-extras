// Statistiques de la communauté 1.2.0 : l'élément d'overlay « Compteurs » (cœur 0.5.0). Règle d'or testée ici : RIEN N'EST MONTRÉ SANS ACCORD.
// L'élément ne montre que les chiffres pour lesquels la personne a choisi « Montrer sur mon site » ; son option ne fait que choisir PARMI eux. Horloge simulée.
import test, { after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { statsSnapshot, NOW } from "./helpers/overlayNonReg.mjs";
import { parseManifest } from "@/core/modules/manifest";

mock.timers.enable({ apis: ["Date"], now: NOW });
after(() => mock.timers.reset());

const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, "..");
const DIR = path.join(ROOT, "modules/community-stats");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(DIR, p), "utf8"));
const manifest = readJson("module.json");
const fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
const def = (await import("../modules/community-stats/index.mjs")).default;
const overlay = await import("../modules/community-stats/overlay.mjs");
const { collectNow } = await import("../modules/community-stats/collect.mjs");
const { loadStats } = await import("../modules/community-stats/stats.mjs");
const { setManual } = await import("../modules/community-stats/manual.mjs");
const { readPublic } = await import("../modules/community-stats/publicRead.mjs");
const core = process.env.CURIOSA_DIR ?? process.cwd();
const { assertMultiReaders, checkModule } = await import(path.join(core, "testsupport/index.mjs"));

const DAY = 86_400_000;
const mk = (id, platform, account, key, metric, value) => ({ id, platform, account, accountKey: key, metric, label: `${platform} ${metric}`, value, asOf: new Date(NOW).toISOString() });
const step = { d: 0 };
let items = () => [];
const standard = () => [
  mk("twitch-channel:emma:followers", "twitch", "emma_live", "emma", "followers", 1000 + step.d * 3),
  mk("twitch-channel:emma:paying", "twitch", "emma_live", "emma", "paying", 12 + step.d),
  mk("youtube-channel:c:content", "youtube", "Emma TV", "c", "content", 80),
  mk("youtube-channel:c:views", "youtube", "Emma TV", "c", "views", 50_000 + step.d * 100),
  mk("twitch-channel:emma:avg_viewers", "twitch", "emma_live", "emma", "avg_viewers", 42),
];
const build = async ({ shown = ["twitch-channel:emma:followers", "youtube-channel:c:views"], days = 40 } = {}) => {
  overlay.resetOverlayCache(); items = standard;
  const ctx = fakeCtx({ key: "community-stats", params: { slug: "counters" }, locale: "fr", locales: ["fr", "en"], messages: fr, topics: { "social.stat": () => items() } });
  for (let d = -days; d <= 0; d++) { step.d = d + days; await collectNow(ctx, { now: NOW + d * DAY }); }
  await setManual(ctx, { platform: "Instagram", account: "@emma", metric: "followers", value: 7 }, { now: NOW });
  const all = await loadStats(ctx);
  await def.adminActions.saveVisibility(ctx, Object.fromEntries(all.map((s) => [`show_${s.docId}`, shown.includes(s.id) ? "yes" : "no"])));
  return ctx;
};
const query = (w, h, { text = "light", surface = "transparent", corners = "round" } = {}, opts = {}, extra = {}) => new URLSearchParams({ lang: "fr", "ov-w": w, "ov-h": h, "ov-fit": "fluid", "ov-lang": "fr", "ov-text": text, "ov-surface": surface, "ov-corners": corners, ...Object.fromEntries(Object.entries(opts).map(([k, v]) => [`opt-${k}`, v])), ...extra });
const get = (q, ctx) => def.routes["element/:slug"](new Request(`https://site.test/m/community-stats/element/counters?${q}`), ctx);
const page = async (q, ctx) => { const r = await get(q, ctx); assert.equal(r.status, 200); return { html: await r.text(), res: r }; };
const values = (html) => [...html.matchAll(/data-ov-part="value"[^>]*>([^<]*)</g)].map((m) => m[1].replace(/[  \s]/g, ""));
const tiles = (html) => (html.match(/data-ov-part="counter"/g) ?? []).length;
beforeEach(() => { mock.timers.setTime(NOW); overlay.resetOverlayCache(); });

/* ───────────────────────────── Manifeste ───────────────────────────── */

test("manifeste : valide, 1.2.0, minCore 0.5.0, un élément « Compteurs » fluide, taille minimale, style suivi, deux options minimales, droit « routes » seul ajouté", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.version, "1.2.0"); assert.equal(manifest.minCore, "0.5.0");
  const [e] = manifest.overlayElements;
  assert.equal(manifest.overlayElements.length, 1);
  assert.equal(e.id, "counters"); assert.equal(e.fit, "fluid"); assert.equal(e.followsStyle, true); assert.equal(e.demo, true);
  assert.ok(e.minSize.width >= 160 && e.minSize.height >= 80); assert.ok(e.ratios.min <= 0.67 && e.ratios.max >= 5.4, "du portrait 600×900 au bandeau 1600×300");
  assert.deepEqual(e.options.map((o) => o.id), ["show", "change"]);
  assert.deepEqual(e.options[0].choices.map((c) => c.value), ["all", "followers", "paying", "content", "views"]);
  assert.deepEqual(e.options[1].choices.map((c) => c.value), ["week", "month", "none"]);
  assert.equal(e.label.fr, "Compteurs");
  for (const k of ["label", "description"]) assert.ok(e[k].fr && e[k].en);
  for (const o of e.options) { assert.ok(o.label.fr && o.label.en && o.help.fr && o.help.en); for (const c of o.choices) assert.ok(c.label.fr && c.label.en); }
  assert.match(e.description.fr, /choisi de montrer/, "le texte dit que rien n'apparaît sans accord");
  assert.deepEqual([...manifest.permissions].sort(), ["admin", "mcp", "routes", "storage", "topics"]);
  assert.ok(!("page" in manifest && manifest.page === true), "toujours aucune page publique");
});

test("kit du cœur : le module est conforme (exigence overlay.elements comprise) ; parité FR/EN", async () => {
  const report = await checkModule(DIR, { siblings: [] });
  assert.equal(report.results.find((x) => x.id === "overlay.elements").status, "pass");
  assert.deepEqual(report.results.filter((x) => x.level === "mandatory" && x.status === "fail").map((x) => `${x.id} : ${x.problems.join(" ; ")}`), []);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of ["ovTitle", "ovEmptyHint", "ovUp7", "ovDown7", "ovFlat7", "ovUp30", "ovDown30", "ovFlat30"]) assert.ok(fr[k] && en[k], k);
});

test("adresse : un chemin du site sans secret (les chiffres montrables sont publics), langue valide seulement", async () => {
  const ctx = await build();
  assert.deepEqual(def.overlayElements.counters(ctx, { element: "counters", lang: "fr" }), { url: "/m/community-stats/element/counters?lang=fr" });
  assert.deepEqual(def.overlayElements.counters(ctx, { lang: "x y" }), { url: "/m/community-stats/element/counters" });
  assert.deepEqual(Object.keys(def.overlayElements), ["counters"]);
});

/* ───────────────────────────── Rien sans accord ───────────────────────────── */

test("RIEN SANS ACCORD : un chiffre privé n'apparaît nulle part (page, fragment, aucun filtre, tous les filtres, mode test), ni son nom, ni son compte", async () => {
  const ctx = await build({ shown: ["twitch-channel:emma:followers"] });
  for (const show of [undefined, "all", "followers", "paying", "content", "views"]) {
    for (const extra of [{}, { "ov-demo": "1" }]) {
      const q = query(1000, 600, {}, show ? { show } : {}, extra);
      const { html } = await page(q, ctx);
      const frag = await (await get(q.toString() + "&frag=1", ctx)).json();
      for (const text of [html, frag.html]) {
        assert.ok(!/Abonnements payants|Publications|Vues|Instagram|YouTube/.test(text), `show=${show} ${JSON.stringify(extra)} : un chiffre privé est apparu`);
      }
    }
  }
  const only = await page(query(1000, 600), ctx);
  assert.equal(tiles(only.html), 1); assert.deepEqual(values(only.html), ["1120"]);
  assert.ok(!/emma_live|50000|\b12\b/.test(only.html.replace(/--[a-z-]+:[^;]+;/g, "")), "pas de compte ni de valeur privée dans la page");
  // Ce que montre l'élément est EXACTEMENT ce que `readPublic` autorise, et jamais plus.
  assert.deepEqual((await readPublic(ctx)).map((p) => p.id), ["twitch-channel:emma:followers"]);
});

test("RIEN SANS ACCORD : par défaut rien n'est montré ; l'accord se retire d'un geste ; un chiffre en erreur n'est jamais montré périmé", async () => {
  const ctx = await build({ shown: [] });
  assert.equal(tiles((await page(query(1000, 600), ctx)).html), 0);
  assert.equal((await (await get(query(1000, 600).toString() + "&frag=1", ctx)).json()).html, "", "en direct : un cadre vide et silencieux, aucun message pour le public");
  const all = await loadStats(ctx);
  const form = (yes) => Object.fromEntries(all.map((s) => [`show_${s.docId}`, yes.includes(s.id) ? "yes" : "no"]));
  await def.adminActions.saveVisibility(ctx, form(["twitch-channel:emma:followers", "twitch-channel:emma:paying"]));
  overlay.resetOverlayCache();
  assert.equal(tiles((await page(query(1000, 600), ctx)).html), 2);
  await def.adminActions.saveVisibility(ctx, form(["twitch-channel:emma:followers"]));
  overlay.resetOverlayCache();
  assert.equal(tiles((await page(query(1000, 600), ctx)).html), 1, "l'accord retiré : le chiffre disparaît (après expiration du cache de lecture)");
  items = () => [{ ...mk("twitch-channel:emma:followers", "twitch", "emma_live", "emma", "followers", 0), value: undefined, error: "hidden" }];
  await collectNow(ctx, { now: NOW + DAY });
  overlay.resetOverlayCache();
  assert.equal(tiles((await page(query(1000, 600), ctx)).html), 0, "le réseau cache son chiffre : jamais une valeur périmée");
});

test("mode test (ov-demo=1) sans aucun chiffre autorisé : une phrase qui explique quoi faire, jamais de chiffres inventés ; en direct, rien", async () => {
  const ctx = await build({ shown: [] });
  const { html } = await page(query(1000, 600, {}, {}, { "ov-demo": "1" }), ctx);
  assert.match(html, /Montrer sur mon site/);
  assert.equal(tiles(html), 0); assert.deepEqual(values(html), []);
  assert.ok(!/data-ov-part="empty"/.test((await page(query(1000, 600), ctx)).html));
});

/* ───────────────────────────── Rendu et options ───────────────────────────── */

test("trois cadres : les compteurs remplissent le cadre (colonnes et rangées d'après la taille réelle), fond transparent, jetons --ov-*, jamais le skin du site", async () => {
  const ctx = await build({ shown: ["twitch-channel:emma:followers", "youtube-channel:c:views", "youtube-channel:c:content", "manual:instagram:emma:followers"] });
  const grids = {};
  for (const [w, h] of [[1000, 600], [600, 900], [1600, 300]]) {
    const { html, res } = await page(query(w, h), ctx);
    grids[`${w}x${h}`] = /--cols:(\d+);--rows:(\d+)/.exec(html).slice(1).map(Number);
    assert.equal(tiles(html), 4);
    assert.match(html, /data-ov-region="element"/); assert.match(html, /data-ov-part="panel"/); assert.match(html, /data-ov-part="value"/);
    assert.match(html, /--ov-fg:#ffffff;--ov-surface:transparent;--ov-radius:12px/);
    assert.match(html, /html,body\{margin:0;height:100%;overflow:hidden;background:transparent\}/);
    assert.ok(!/--sk-|data-skin|<link |\/skins\/|@import|<img|<a[ >]|href=/i.test(html));
    assert.match(res.headers.get("content-security-policy"), /default-src 'none'.*img-src 'none'/);
  }
  assert.deepEqual(grids["1600x300"], [4, 1], "bandeau : une rangée");
  assert.deepEqual(grids["600x900"].map((n) => n >= 1), [true, true]);
  assert.ok(grids["600x900"][1] >= grids["1000x600"][1], "cadre haut : plus de rangées que le cadre large");
  assert.ok(grids["600x900"][0] <= 2, "cadre étroit : deux colonnes au plus");
  const dark = await page(query(1000, 600, { text: "dark", surface: "soft", corners: "square" }), ctx);
  assert.match(dark.html, /--ov-fg:#111111;--ov-surface:rgba\(255,255,255,\.7\);--ov-radius:0px/);
});

test("options : choix des compteurs PARMI ceux autorisés ; évolution semaine, mois ou aucune ; valeurs absurdes ignorées", async () => {
  const ctx = await build({ shown: ["twitch-channel:emma:followers", "youtube-channel:c:views", "youtube-channel:c:content", "twitch-channel:emma:paying"] });
  const ask = async (opts) => (await page(query(1000, 600, {}, opts), ctx)).html;
  assert.equal(tiles(await ask({})), 4);
  assert.deepEqual(values(await ask({ show: "followers" })), ["1120"]);
  assert.deepEqual(values(await ask({ show: "views" })), ["54000"]);
  assert.deepEqual(values(await ask({ show: "paying" })), ["52"], "autorisé : montré quand on le choisit");
  assert.match(await ask({ show: "followers" }), /▲ \+(?:\d+\s?)+ cette semaine/);
  assert.match(await ask({ show: "followers", change: "month" }), /ce mois-ci/);
  assert.ok(!/cette semaine|ce mois-ci/.test(await ask({ change: "none" })));
  for (const hostile of [{ show: "avg_viewers", change: "<x>" }, { show: "../../x", change: "" }, { show: "manual:instagram", change: "year" }]) {
    const html = await ask(hostile);
    assert.equal(tiles(html), 4, "valeur inconnue : ignorée, comme « tous »");
    assert.ok(!/Audience moyenne/.test(html), "un chiffre de période n'est jamais proposé ici");
  }
  assert.equal(overlay.readParams(new URLSearchParams({ "opt-show": "paying" })).show, "paying");
  assert.equal(overlay.readParams(new URLSearchParams({ "opt-show": "nope" })).show, "all");
});

test("évolution : valeur, signe et phrase exacts ; pas assez d'historique = rien d'écrit (jamais un chiffre inventé) ; ≤ 12 compteurs", async () => {
  const young = await build({ shown: ["twitch-channel:emma:followers"], days: 2 });
  const { html } = await page(query(1000, 600), young);
  assert.deepEqual(values(html), ["1006"]);
  assert.ok(!/cette semaine/.test(html), "2 jours d'historique : pas d'évolution sur la semaine");
  const old = await build({ shown: ["twitch-channel:emma:followers"] });
  const oldHtml = (await page(query(1000, 600), old)).html;
  assert.match(oldHtml.replace(/<style>[\s\S]*?<\/style>/g, ""), /▲ \+21 cette semaine/);
  items = () => Array.from({ length: 30 }, (_, i) => mk(`twitch-channel:c${i}:followers`, "twitch", `chaine${i}`, `c${i}`, "followers", 10 + i));
  const many = fakeCtx({ key: "community-stats", params: { slug: "counters" }, locale: "fr", messages: fr, topics: { "social.stat": () => items() } });
  await collectNow(many, { now: NOW });
  await def.adminActions.saveVisibility(many, Object.fromEntries((await loadStats(many)).map((s) => [`show_${s.docId}`, "yes"])));
  overlay.resetOverlayCache();
  assert.equal(tiles((await page(query(1000, 600), many)).html), overlay.MAX_TILES);
  assert.deepEqual(overlay.gridFor(1, 1000, 600), { cols: 1, rows: 1 });
});

test("page anglaise : textes de la langue demandée ; texte venu d'ailleurs échappé", async () => {
  const ctx = await build({ shown: ["twitch-channel:emma:followers"] });
  const enCtx = fakeCtx({ key: "community-stats", params: { slug: "counters" }, locale: "en", locales: ["fr", "en"], messages: en, topics: { "social.stat": () => items() } });
  enCtx.api = ctx.api;   // mêmes données, autre langue
  const { html } = await page(query(1000, 600), enCtx);
  assert.match(html, /Followers/); assert.match(html, /this week/);
  const evil = await build({ shown: ["manual:x:y:followers"] });
  await setManual(evil, { platform: "X", account: "<img src=x onerror=1>", metric: "followers", value: 3 }, { now: NOW });
  await def.adminActions.saveVisibility(evil, Object.fromEntries((await loadStats(evil)).map((s) => [`show_${s.docId}`, "yes"])));
  overlay.resetOverlayCache();
  const out = (await page(query(1000, 600), evil)).html;
  assert.ok(!/<img src=x/.test(out));
});

/* ───────────────────────────── Mise à jour douce, plusieurs lecteurs, charge ───────────────────────────── */

test("mise à jour douce : fragment et empreinte stables, page qui s'interroge elle-même, en ralentissant, de façon bornée ; aucun minuteur de fond", async () => {
  const ctx = await build();
  const a = await (await get(query(1000, 600).toString() + "&frag=1", ctx)).json();
  const b = await (await get(query(1000, 600).toString() + "&frag=1", ctx)).json();
  assert.equal(a.v, b.v);
  const { html } = await page(query(1000, 600), ctx);
  assert.match(html, new RegExp(`data-v="${a.v}"`));
  assert.match(html, /wait=120000/); assert.match(html, /Math\.min\(900000,Math\.round\(wait\*1\.5\)\)/); assert.match(html, /n\+\+>=200/);
  assert.ok(!/setInterval/.test(html));
  assert.equal(def.tasks.collect.everyMinutes, 15, "la tâche existante est inchangée ; l'élément n'en ajoute aucune");
  assert.deepEqual(Object.keys(def.tasks), ["collect"]);
});

test("plusieurs lecteurs (assertMultiReaders) : chaque page d'overlay a son propre repère ; un chiffre autorisé en plus arrive chez tous, une seule fois", async () => {
  const ctx = await build({ shown: [] });
  let n = 0;
  const publish = async (label) => {   // la personne ajoute un compte saisi à la main et l'autorise (le chiffre porte le nom donné)
    const m = await setManual(ctx, { platform: label, account: `@compte${++n}`, metric: "followers", value: 100 + n }, { now: NOW });   // le nom du réseau porte l'événement
    await def.adminActions.saveVisibility(ctx, Object.fromEntries((await loadStats(ctx)).map((s) => [`show_${s.docId}`, s.docId === m.docId || s.visible ? "yes" : "no"])));
    mock.timers.tick(overlay.CACHE.ttlMs + 1000);
  };
  const names = (html) => [...new Set([...html.matchAll(/evt-\d+/g)].map((x) => x[0]))];
  await assertMultiReaders({
    publish, readers: 4,
    open: async () => {
      const seen = new Set();
      const look = async () => names((await (await get(query(1000, 600, {}, { show: "all" }).toString() + "&frag=1", ctx)).json()).html);
      (await look()).forEach((e) => seen.add(e));
      return { read: async () => { const fresh = (await look()).filter((e) => !seen.has(e)); fresh.forEach((e) => seen.add(e)); return fresh.sort(); } };
    },
  });
});

test("charge bornée : dix lecteurs en même temps = UNE lecture du stockage ; une nouvelle lecture seulement après expiration", async () => {
  const ctx = await build();
  const reads = () => ctx.calls.writes.length;   // les lectures du stockage ne sont pas comptées par fakeCtx : on compte via un espion
  void reads;
  let lists = 0;
  const orig = ctx.api.store.list;
  ctx.api.store.list = async (...a) => { lists++; return orig(...a); };
  await Promise.all(Array.from({ length: 10 }, () => get(query(1000, 600), ctx)));
  const first = lists;
  assert.ok(first >= 1 && first <= 3, `une lecture partagée (obtenu ${first})`);
  await Promise.all(Array.from({ length: 10 }, () => get(query(600, 900), ctx)));
  assert.equal(lists, first, "tant que le cache vit, aucune nouvelle lecture");
  mock.timers.tick(overlay.CACHE.ttlMs + 1);
  await get(query(600, 900), ctx);
  assert.ok(lists > first, "après expiration, une nouvelle lecture");
});

/* ───────────────────────────── Non-régression ───────────────────────────── */

test("rien ne change pour l'existant : administration, lecture publique, MCP, réglages et tâche identiques à ceux de la 1.1.3 (octet pour octet)", async () => {
  const golden = JSON.parse(fs.readFileSync(path.join(here, "golden/community-stats-1.25.0.json"), "utf8"));
  const now = await statsSnapshot(ROOT);
  assert.deepEqual(now.manifest, golden.manifest, "le manifeste n'a changé que par version, minCore, overlayElements et le droit « routes »");
  assert.deepEqual(now.keys, golden.keys);
  assert.deepEqual(now.routes, golden.routes, "aucune page publique ajoutée : seule la route de l'élément est nouvelle");
  assert.deepEqual(now.publicBefore, golden.publicBefore); assert.deepEqual(now.publicAfter, golden.publicAfter);
  assert.deepEqual(now.saveMessage, golden.saveMessage);
  assert.deepEqual(now.admin, golden.admin);
  assert.deepEqual(now.mcpList, golden.mcpList);
  assert.deepEqual(golden.publicBefore, [], "rien n'est montrable tant qu'on n'a rien choisi");
  assert.equal(golden.publicAfter.length, 3);
});
