// Suggestions de jeux 1.6.0 : l'élément d'overlay « Top des jeux proposés » (cœur 0.5.0). Règle d'or testée ici : RIEN DE PLUS QUE LA PAGE PUBLIQUE.
// Pas de pseudo, pas de note, pas de jaquette, jamais un jeu « rejeté » ; une seule lecture partagée par tous les lecteurs. Horloge simulée.
import test, { after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
mock.timers.enable({ apis: ["Date"], now: NOW });
after(() => mock.timers.reset());

const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, "..");
const DIR = path.join(ROOT, "modules/game-suggestions");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(DIR, p), "utf8"));
const manifest = readJson("module.json");
const fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
const def = (await import("../modules/game-suggestions/index.mjs")).default;
const overlay = await import("../modules/game-suggestions/overlay.mjs");
const core = process.env.CURIOSA_DIR ?? process.cwd();
const { assertMultiReaders, checkModule } = await import(path.join(core, "testsupport/index.mjs"));

const DATA = [
  { title: "Hollow Knight", status: "proposed", submitterName: "Alice", note: "Un classique à lire", replayVotes: 0, coverUrl: "https://media.rawg.io/hk.jpg" },
  { title: "hollow  knight", status: "proposed", submitterName: "Bob", replayVotes: 0 },
  { title: "Hollow Knight", status: "proposed", submitterName: "Chloé", replayVotes: 0 },
  { title: "Celeste", status: "proposed", submitterName: "Dana", replayVotes: 0 },
  { title: "Tunic", status: "proposed", origin: "admin", replayVotes: 0 },
  { title: "Stardew Valley", status: "planned", origin: "admin", replayVotes: 0 },
  { title: "Outer Wilds", status: "accepted", replayVotes: 0 },
  { title: "Hades", status: "already_played", origin: "admin", replayVotes: 7, coverUrl: "https://media.rawg.io/hades.jpg" },
  { title: "Dave the Diver", status: "already_played", replayVotes: 3 },
  { title: "Inscryption", status: "already_played", replayVotes: 0 },
  { title: "Disco Elysium", status: "finished", replayVotes: 0 },
  { title: "Jeu secret <b>", status: "rejected", submitterName: "Troll", note: "Ne jamais montrer", replayVotes: 99 },
];
let n = 0;
const build = async (data = DATA, locale = "fr") => {
  overlay.resetOverlayCache();
  const ctx = fakeCtx({ key: `gs${++n}`, basePath: "suggestions", moduleId: "game-suggestions", params: { slug: "top" }, locale, defaultLocale: "fr", locales: ["fr", "en"], messages: locale === "en" ? en : fr });
  for (const d of data) await ctx.api.store.add("games", d);
  return ctx;
};
const query = (w, h, { text = "light", surface = "transparent", corners = "round" } = {}, opts = {}, extra = {}) => new URLSearchParams({ lang: "fr", "ov-w": w, "ov-h": h, "ov-fit": "fluid", "ov-lang": "fr", "ov-text": text, "ov-surface": surface, "ov-corners": corners, ...Object.fromEntries(Object.entries(opts).map(([k, v]) => [`opt-${k}`, v])), ...extra });
const get = (q, ctx) => def.routes["element/:slug"](new Request(`https://site.test/m/gs/element/top?${q}`), ctx);
const page = async (q, ctx) => { const r = await get(q, ctx); assert.equal(r.status, 200); return { html: await r.text(), res: r }; };
const frag = async (q, ctx) => (await (await get(`${q}&frag=1`, ctx)).json()).html;
const unesc = (t) => t.replace(/&#39;/g, "'");
const names = (html) => [...html.matchAll(/data-ov-part="name"[^>]*>([^<]*)</g)].map((m) => unesc(m[1]));
const scores = (html) => [...html.matchAll(/data-ov-part="score"[^>]*>([^<]*)</g)].map((m) => m[1]);
beforeEach(() => { mock.timers.setTime(NOW); overlay.resetOverlayCache(); });

/* ───────────────────────────── Manifeste ───────────────────────────── */

test("manifeste : valide, 1.6.0, minCore 0.5.0, un élément « Top des jeux proposés » fluide, style suivi, demo, deux options minimales ; rien d'autre ne change", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.version, "1.6.0"); assert.equal(manifest.minCore, "0.5.0");
  assert.equal(manifest.overlayElements.length, 1);
  const [e] = manifest.overlayElements;
  assert.equal(e.id, "top"); assert.equal(e.fit, "fluid"); assert.equal(e.followsStyle, true); assert.equal(e.demo, true);
  assert.ok(e.minSize.width <= 260 && e.minSize.height <= 120); assert.ok(e.ratios.min <= 0.5 && e.ratios.max >= 6, "du portrait au bandeau");
  assert.deepEqual(e.options.map((o) => o.id), ["count", "status"]);
  const [count, status] = e.options;
  assert.deepEqual([count.type, count.min, count.max, count.default, count.integer], ["number", 1, 10, 3, true]);
  assert.deepEqual(status.choices.map((c) => c.value), ["proposed", "planned", "accepted", "already_played", "finished"], "les statuts publics, pas « rejeté »");
  assert.equal(status.default, "proposed");
  assert.equal(e.label.fr, "Top des jeux proposés");
  for (const k of ["label", "description"]) assert.ok(e[k].fr && e[k].en);
  for (const o of e.options) { assert.ok(o.label.fr && o.label.en && o.help.fr && o.help.en); for (const c of o.choices ?? []) assert.ok(c.label.fr && c.label.en); }
  assert.match(e.description.fr, /page des suggestions/); assert.match(e.description.fr, /ni pseudo ni note|pseudo/);
  assert.deepEqual([...manifest.permissions].sort(), ["admin", "mcp", "pages", "rawg", "routes", "storage"], "aucune permission de plus");
});

test("kit du cœur : le module est conforme (exigence overlay.elements comprise) ; parité FR/EN des textes de l'élément, variantes _one comprises", async () => {
  const report = await checkModule(DIR, { siblings: [] });
  assert.equal(report.results.find((x) => x.id === "overlay.elements").status, "pass");
  assert.deepEqual(report.results.filter((x) => x.level === "mandatory" && x.status === "fail").map((x) => `${x.id} : ${x.problems.join(" ; ")}`), []);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of ["ovTitle", "ovHeading_proposed", "ovHeading_planned", "ovHeading_accepted", "ovHeading_already_played", "ovHeading_finished", "ovVotes", "ovVotes_one", "ovTimes", "ovDemoGame"]) assert.ok(fr[k] && en[k], k);
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of Object.keys(fr).filter((k) => k.startsWith("ov"))) assert.equal(vars(fr[k]), vars(en[k]), k);
});

test("adresse : un chemin du site sans secret (la page ne rend que le public), langue valide seulement", async () => {
  const ctx = await build();
  assert.deepEqual(def.overlayElements.top(ctx, { element: "top", lang: "fr" }), { url: `/m/${ctx.instance.key}/element/top?lang=fr` });
  assert.deepEqual(def.overlayElements.top(ctx, { lang: "x y" }), { url: `/m/${ctx.instance.key}/element/top` });
  assert.deepEqual(Object.keys(def.overlayElements), ["top"]);
  assert.equal(overlay.elementAddress(ctx, "autre", {}), null);
  const r = await def.routes["element/:slug"](new Request("https://site.test/x"), { ...ctx, params: { slug: "autre" } });
  assert.equal(r.status, 404);
});

/* ───────────────────────────── Classement ───────────────────────────── */

test("classement : les jeux de même nom sont regroupés (casse, accents et espaces ignorés), le plus proposé d'abord ; « déjà joué » par votes ; jamais d'égalité instable", async () => {
  const ctx = await build();
  const ask = async (opts) => page(query(1000, 600, {}, { count: 10, ...opts }), ctx).then((x) => ({ names: names(x.html), scores: scores(x.html) }));
  const proposed = await ask({});
  assert.deepEqual(proposed.names, ["Hollow Knight", "Tunic", "Celeste"], "trois propositions regroupées en tête ; à égalité, la plus récente d'abord");
  assert.deepEqual(proposed.scores, ["proposé 3 fois"], "un jeu proposé une seule fois n'a pas de mention");
  const replay = await ask({ status: "already_played" });
  assert.deepEqual(replay.names, ["Hades", "Dave the Diver", "Inscryption"]);
  assert.deepEqual(replay.scores, ["7 votes", "3 votes"], "zéro vote : rien d'écrit");
  assert.deepEqual((await ask({ status: "planned" })).names, ["Stardew Valley"]);
  assert.deepEqual((await ask({ status: "accepted" })).names, ["Outer Wilds"]);
  assert.deepEqual((await ask({ status: "finished" })).names, ["Disco Elysium"]);
  const one = overlay.rank([{ title: "A", status: "already_played", at: new Date(NOW), votes: 1 }]);
  assert.deepEqual(one.already_played, [{ title: "A", times: 1, votes: 1 }]);
  const en_ = await build(DATA, "en");
  assert.deepEqual(scores((await page(query(1000, 600, {}, { status: "already_played", count: 10 }), en_)).html), ["7 votes", "3 votes"]);
  const solo = await build([{ title: "Seul", status: "already_played", replayVotes: 1 }]);
  assert.deepEqual(scores((await page(query(1000, 600, {}, { status: "already_played" }), solo)).html), ["1 vote"], "singulier");
  assert.ok(overlay.rank([]).proposed.length === 0);
});

test("charge : au plus 10 jeux par statut gardés, quel que soit le nombre de lignes", async () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ title: `Jeu ${i}`, status: "proposed", replayVotes: 0 }));
  const ranking = overlay.rank(many.map((d) => ({ ...d, at: new Date(NOW + 1) })));
  assert.equal(ranking.proposed.length, overlay.MAX_ENTRIES);
  const ctx = await build(many);
  assert.equal(names((await page(query(1000, 600, {}, { count: 10 }), ctx)).html).length, 10);
});

/* ───────────────────────────── Rien de plus que la page publique ───────────────────────────── */

test("RIEN DE PLUS QUE LA PAGE : jamais un jeu rejeté, un pseudo, une note ni une jaquette — ni dans la page, ni dans le fragment, ni en mode test", async () => {
  const ctx = await build();
  const publicTitles = new Set(JSON.stringify(await def.page(ctx, { segments: [] })).match(/<h3[^>]*>([^<]*)<\/h3>/g)?.map((h) => h.replace(/<[^>]*>/g, "")));
  assert.ok(publicTitles.has("Celeste") && !publicTitles.has("Jeu secret &lt;b&gt;"), "la page publique ne montre pas le rejeté");
  for (const status of [undefined, "proposed", "planned", "accepted", "already_played", "finished", "rejected"]) {
    for (const extra of [{}, { "ov-demo": "1" }]) {
      const q = query(1000, 600, {}, { count: 10, ...(status ? { status } : {}) }, extra);
      const { html } = await page(q, ctx);
      const body = html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<script>[\s\S]*?<\/script>/g, "");
      for (const secret of ["Troll", "secret", "Ne jamais montrer", "Alice", "Bob", "Chloé", "Dana", "Un classique", "rawg.io", "<img", "<a ", "href=", "99 votes"]) assert.ok(!body.includes(secret), `${status} ${JSON.stringify(extra)} : « ${secret} » ne doit pas apparaître`);
      for (const text of [body, await frag(q, ctx)]) for (const nm of names(text)) assert.ok(publicTitles.has(nm) || /^Jeu d'exemple \d+$/.test(nm), `« ${nm} » n'est pas sur la page publique`);
    }
  }
  const rejected = await page(query(1000, 600, {}, { status: "rejected" }), ctx);
  assert.deepEqual(names(rejected.html), ["Hollow Knight", "Tunic", "Celeste"], "un statut inconnu (rejeté compris) retombe sur « proposés »");
  assert.equal((await def.page(ctx, { segments: ["rejected"] })).notFound, true);
});

test("rien à montrer : en direct un cadre vide et silencieux ; en mode test des jeux d'exemple, jamais de vrais chiffres inventés", async () => {
  const empty = await build([]);
  assert.equal(await frag(query(1000, 600), empty), "");
  const live = await page(query(1000, 600), empty);
  assert.ok(!/data-ov-part="game"/.test(live.html));
  const demo = await page(query(1000, 600, {}, { count: 4 }, { "ov-demo": "1" }), empty);
  assert.deepEqual(names(demo.html), ["Jeu d'exemple 1", "Jeu d'exemple 2", "Jeu d'exemple 3", "Jeu d'exemple 4"]);
  const onlyRejected = await build([{ title: "Caché", status: "rejected", replayVotes: 4 }]);
  assert.equal(await frag(query(1000, 600), onlyRejected), "");
  assert.ok(!(await page(query(1000, 600, {}, {}, { "ov-demo": "1" }), onlyRejected)).html.includes("Caché"));
  const real = await build();
  assert.ok(!(await page(query(1000, 600, {}, {}, { "ov-demo": "1" }), real)).html.includes("Jeu d'exemple"), "des vrais jeux : le mode test montre les vrais jeux");
});

test("une panne de lecture donne un cadre vide (jamais d'erreur visible), et la lecture ratée est retentée vite", async () => {
  const ctx = await build();
  const orig = ctx.api.store.list;
  ctx.api.store.list = async () => { throw new Error("boom secret-token"); };
  const r = await get(query(1000, 600), ctx);
  assert.equal(r.status, 200);
  assert.ok(!(await r.text()).includes("secret-token"));
  ctx.api.store.list = orig;
  mock.timers.tick(overlay.CACHE.failedTtlMs + 1);
  assert.equal(names((await page(query(1000, 600), ctx)).html).length, 3, "rétabli après le court délai");
});

/* ───────────────────────────── Rendu et options ───────────────────────────── */

test("trois cadres : les lignes remplissent le cadre (colonnes et rangées d'après la taille réelle), fond transparent, jetons --ov-*, jamais le skin du site, aucune image", async () => {
  const ctx = await build();
  const grids = {};
  for (const [w, h] of [[900, 500], [420, 800], [1600, 220]]) {
    const { html, res } = await page(query(w, h, {}, { count: 6, status: "proposed" }), ctx);
    grids[`${w}x${h}`] = /--cols:(\d+);--rows:(\d+)/.exec(html).slice(1).map(Number);
    assert.equal((html.match(/data-ov-part="game"/g) ?? []).length, 3, "3 jeux proposés dans les données");
    assert.match(html, /data-ov-region="element"/); assert.match(html, /data-ov-part="panel"/); assert.match(html, /data-ov-part="list"/); assert.match(html, /data-ov-part="rank"/);
    assert.match(html, /--ov-fg:#ffffff;--ov-surface:transparent;--ov-radius:12px/);
    assert.match(html, /html,body\{margin:0;height:100%;overflow:hidden;background:transparent\}/);
    assert.ok(!/--sk-|data-skin|<link |\/skins\/|@import|<img|<a[ >]|href=/i.test(html));
    assert.match(res.headers.get("content-security-policy"), /default-src 'none'.*img-src 'none'/);
  }
  assert.deepEqual(grids["900x500"], [1, 3]); assert.deepEqual(grids["420x800"], [1, 3]);
  assert.ok(grids["1600x220"][0] > 1, "bandeau large et bas : les lignes se mettent côte à côte");
  const dark = await page(query(900, 500, { text: "dark", surface: "soft", corners: "square" }), ctx);
  assert.match(dark.html, /--ov-fg:#111111;--ov-surface:rgba\(255,255,255,\.7\);--ov-radius:0px/);
  assert.ok(/data-ov-part="title"/.test((await page(query(900, 500), ctx)).html) && !/data-ov-part="title"/.test((await page(query(900, 120), ctx)).html), "le titre disparaît d'un cadre trop bas");
  assert.match((await page(query(900, 500), ctx)).html, />Jeux proposés</);
  assert.deepEqual(overlay.layoutFor(1, 1000, 600), { cols: 1, rows: 1 });
});

test("options : nombre de jeux (1 à 10, 3 par défaut), statut ; valeurs absurdes ignorées", async () => {
  const ctx = await build();
  const ask = async (opts) => names((await page(query(1000, 600, {}, opts), ctx)).html);
  assert.equal((await ask({})).length, 3);
  assert.deepEqual(await ask({ count: 1 }), ["Hollow Knight"]);
  assert.equal((await ask({ count: 10 })).length, 3, "il n'y a que trois jeux proposés");
  assert.equal((await ask({ count: 2, status: "already_played" })).length, 2);
  for (const hostile of [{ count: "0" }, { count: "-4" }, { count: "999" }, { count: "<x>" }, { count: "" }, { status: "../../x" }, { status: "rejected" }, { status: "" }]) {
    const got = await ask(hostile);
    assert.ok(got.length >= 1 && got.length <= 10, JSON.stringify(hostile));
    assert.ok(!got.includes("Jeu secret &lt;b&gt;"), JSON.stringify(hostile));
  }
  const p = overlay.readParams(new URLSearchParams({ "opt-count": "7", "opt-status": "planned" }));
  assert.deepEqual([p.count, p.status], [7, "planned"]);
  const d = overlay.readParams(new URLSearchParams({ "opt-count": "x", "opt-status": "zzz" }));
  assert.deepEqual([d.count, d.status, d.demo, d.style], [3, "proposed", false, null]);
});

test("texte venu des visiteurs échappé ; page anglaise : textes de la langue demandée", async () => {
  const evil = await build([{ title: "<img src=x onerror=alert(1)>", status: "proposed", replayVotes: 0 }, { title: "\"><script>alert(2)</script>", status: "proposed", replayVotes: 0 }]);
  const out = (await page(query(1000, 600), evil)).html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<script>[\s\S]*?<\/script>/g, "");
  assert.ok(!/<img src=x|<script>alert/.test(out));
  assert.match(out, /&lt;img src=x/);
  const eng = await build(DATA, "en");
  const html = (await page(query(1000, 600), eng)).html;
  assert.match(html, /Suggested games/); assert.match(html, /suggested 3 times/);
});

/* ───────────────────────────── Mise à jour douce, plusieurs lecteurs, charge ───────────────────────────── */

test("mise à jour douce : fragment et empreinte stables, page qui s'interroge elle-même, en ralentissant, de façon bornée ; aucune tâche de fond ajoutée", async () => {
  const ctx = await build();
  const a = await (await get(`${query(1000, 600)}&frag=1`, ctx)).json();
  const b = await (await get(`${query(1000, 600)}&frag=1`, ctx)).json();
  assert.equal(a.v, b.v);
  const { html } = await page(query(1000, 600), ctx);
  assert.match(html, new RegExp(`data-v="${a.v}"`));
  assert.match(html, /wait=120000/); assert.match(html, /Math\.min\(900000,Math\.round\(wait\*1\.5\)\)/); assert.match(html, /n\+\+>=200/);
  assert.ok(!/setInterval/.test(html));
  assert.deepEqual(Object.keys(def.tasks), ["covers"], "la tâche existante est inchangée ; l'élément n'en ajoute aucune");
});

test("plusieurs lecteurs (assertMultiReaders) : chaque page d'overlay a son propre repère ; une proposition en plus arrive chez tous, une seule fois", async () => {
  const ctx = await build([]);
  const publish = async (title) => { await ctx.api.store.add("games", { title, status: "proposed", submitterName: "Anon", replayVotes: 0 }); mock.timers.tick(overlay.CACHE.ttlMs + 1000); };
  await assertMultiReaders({
    publish, readers: 4,
    open: async () => {
      const seen = new Set();
      const look = async () => names(await frag(query(1000, 600, {}, { count: 10 }), ctx));
      (await look()).forEach((e) => seen.add(e));   // le repère est pris tout de suite : ce qu'on voit déjà
      return { read: async () => { const fresh = (await look()).filter((e) => !seen.has(e)); fresh.forEach((e) => seen.add(e)); return fresh.sort(); } };
    },
  });
});

test("charge bornée : dix lecteurs en même temps = UNE lecture du stockage ; une nouvelle lecture seulement après expiration ; rien n'est écrit ni consommé", async () => {
  const ctx = await build();
  let lists = 0;
  const orig = ctx.api.store.list;
  ctx.api.store.list = async (...a) => { lists++; return orig(...a); };
  const before = ctx.calls.writes.length;
  await Promise.all(Array.from({ length: 10 }, () => get(query(1000, 600), ctx)));
  assert.equal(lists, 1, "une lecture partagée");
  await Promise.all(Array.from({ length: 10 }, () => get(query(600, 900, {}, { status: "planned", count: 2 }), ctx)));
  assert.equal(lists, 1, "tant que la mémoire vit, aucune nouvelle lecture (même pour un autre statut ou un autre cadre)");
  mock.timers.tick(overlay.CACHE.ttlMs + 1);
  await get(query(600, 900), ctx);
  assert.equal(lists, 2, "après expiration, une nouvelle lecture");
  assert.equal(ctx.calls.writes.length, before, "aucune écriture : rien n'est consommé");
});

/* ───────────────────────────── L'existant ne bouge pas ───────────────────────────── */

test("la page publique et le vote sont inchangés : même liste, même ordre, rien du classement", async () => {
  const ctx = await build();
  const all = JSON.stringify(await def.page(ctx, { segments: [] }));
  assert.ok(!/gs-|data-ov-|opt-|ov-w/.test(all));
  assert.equal((await def.page(ctx, { segments: ["rejected"] })).notFound, true);
  assert.deepEqual(Object.keys(def.routes).sort(), ["element/:slug", "suggest", "vote"]);
});
