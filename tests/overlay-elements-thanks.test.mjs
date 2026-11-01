// Mur des remerciements 1.2.0 : l'élément d'overlay « Remerciements » (cœur 0.5.0). Règle d'or testée ici : RIEN DE PLUS QUE LE MUR PUBLIC.
// Les personnes viennent de la même lecture que la page publique (Contacts, « Ne pas montrer », fiches à relire écartées) ; pas de photo, pas d'identifiant. Horloge simulée.
import test, { after, afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { makeWorld, reset, restore, manifest, fr, en, def, C, D } from "./helpers/thanks-wall-world.mjs";
import { parseManifest } from "@/core/modules/manifest";

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
mock.timers.enable({ apis: ["Date"], now: NOW });
after(() => mock.timers.reset());

const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, "..");
const DIR = path.join(ROOT, "modules/thanks-wall");
const overlay = await import("../modules/thanks-wall/overlay.mjs");
const core = process.env.CURIOSA_DIR ?? process.cwd();
const { assertMultiReaders, checkModule } = await import(path.join(core, "testsupport/index.mjs"));

beforeEach(() => { mock.timers.setTime(NOW); reset(); overlay.resetOverlayCache(); });
afterEach(() => restore());

const query = (w, h, { text = "light", surface = "transparent", corners = "round" } = {}, opts = {}, extra = {}) => new URLSearchParams({ lang: "fr", "ov-w": w, "ov-h": h, "ov-fit": "fluid", "ov-lang": "fr", "ov-text": text, "ov-surface": surface, "ov-corners": corners, ...Object.fromEntries(Object.entries(opts).map(([k, v]) => [`opt-${k}`, v])), ...extra });
const get = (q, ctx) => def.routes["element/:slug"](new Request(`https://site.test/m/merci/element/thanks?${q}`), { ...ctx, params: { slug: "thanks" } });
const page = async (q, ctx) => { const r = await get(q, ctx); assert.equal(r.status, 200); return { html: await r.text(), res: r }; };
const frag = async (q, ctx) => (await (await get(`${q}&frag=1`, ctx)).json()).html;
const unesc = (t) => t.replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const names = (html) => [...html.matchAll(/data-ov-part="name"[^>]*>([^<]*)</g)].map((m) => unesc(m[1]));
const messages = (html) => [...html.matchAll(/data-ov-part="message"[^>]*>([^<]*)</g)].map((m) => unesc(m[1]));
const bodyOf = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<script>[\s\S]*?<\/script>/g, "");

/** Un monde : deux groupes (Modération : Anne, Zoé, Charlie caché ; Soutiens : Dina, Émile, Fanny), une fiche à relire, une fiche rangée dans deux groupes. Les fiches sont créées dans cet ordre (la plus ancienne d'abord). */
function world(extra = {}) {
  const book = fakeContactBook();
  const mods = book.seedCategory("Modérateurs"), sup = book.seedCategory("Soutiens"), hide = book.seedCategory("Ne pas montrer");
  const ids = {};
  const add = (name, cats, more = {}) => { ids[name] = book.seedContact({ name, categoryIds: cats, ...more }).id; };
  add("Anne Lambert", [mods]);
  add("Zoé Dupont", [mods], { accounts: [{ network: "twitch", handle: "zoe_tv", displayName: "Zoé_TV", avatar: "https://static-cdn.jtvnw.net/jtv_user_pictures/zoe-profile_image-300x300.png" }], photo: "https://moi.example.test/zoe.png", email: "zoe@example.test" });
  add("Charlie Caché", [mods, hide]);
  add("Inconnu du formulaire", [mods], { status: "to_review" });
  add("Dina Fox", [sup]);
  add("Émile Noël", [sup, mods]);
  add("Fanny Vo", [sup]);
  const w = makeWorld({ book, settings: { category: mods, groupTitle: "Modération", category2: sup, groupTitle2: "Soutiens", ...extra }, locale: "fr" });
  return { ...w, ids, mods, sup, hide };
}
const addMessage = (ctx, contactId, texts) => ctx.api.store.add("messages", { contactId, texts });

/* ───────────────────────────── Manifeste ───────────────────────────── */

test("manifeste : valide, 1.2.0, minCore 0.5.0, un élément « Remerciements » fluide, style suivi, demo, quatre options minimales, droit « routes » seul ajouté", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.version, "1.2.1"); assert.equal(manifest.minCore, "0.5.0");
  assert.equal(manifest.overlayElements.length, 1);
  const [e] = manifest.overlayElements;
  assert.equal(e.id, "thanks"); assert.equal(e.fit, "fluid"); assert.equal(e.followsStyle, true); assert.equal(e.demo, true);
  assert.ok(e.minSize.width <= 240 && e.minSize.height <= 100); assert.ok(e.ratios.min <= 0.4 && e.ratios.max >= 8, "de la colonne étroite au bandeau");
  assert.deepEqual(e.options.map((o) => o.id), ["group", "count", "scroll", "messages"]);
  const [group, count, scroll, msgs] = e.options;
  assert.deepEqual(group.choices.map((c) => c.value), ["all", "1", "2", "3", "4", "5", "6"]); assert.equal(group.default, "all");
  assert.deepEqual([count.min, count.max, count.default, count.integer], [1, 30, 10, true]);
  assert.deepEqual([scroll.type, scroll.default, msgs.type, msgs.default], ["boolean", true, "boolean", true]);
  assert.equal(e.label.fr, "Remerciements");
  for (const k of ["label", "description"]) assert.ok(e[k].fr && e[k].en);
  for (const o of e.options) { assert.ok(o.label.fr && o.label.en && o.help.fr && o.help.en); for (const c of o.choices ?? []) assert.ok(c.label.fr && c.label.en); }
  assert.match(e.description.fr, /ce que montre déjà votre mur/); assert.match(e.description.fr, /jamais de photo/);
  assert.deepEqual([...manifest.permissions].sort(), ["admin", "mcp", "pages", "routes", "storage"]);
  assert.equal(manifest.page, true); assert.equal(manifest.basePath, "merci");
});

test("kit du cœur : le module est conforme (exigence overlay.elements comprise) ; parité FR/EN", async () => {
  const report = await checkModule(DIR, { siblings: [] });
  assert.equal(report.results.find((x) => x.id === "overlay.elements").status, "pass");
  assert.deepEqual(report.results.filter((x) => x.level === "mandatory" && x.status === "fail").map((x) => `${x.id} : ${x.problems.join(" ; ")}`), []);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of ["ovTitle", "ovHeading", "ovDemoName", "ovDemoMessage"]) assert.ok(fr[k] && en[k], k);
});

test("adresse : un chemin du site sans secret, langue valide seulement ; une autre route d'élément est introuvable", () => {
  const { ctx } = world();
  assert.deepEqual(def.overlayElements.thanks(ctx, { element: "thanks", lang: "en" }), { url: `/m/${ctx.instance.key}/element/thanks?lang=en` });
  assert.deepEqual(def.overlayElements.thanks(ctx, { lang: "x y" }), { url: `/m/${ctx.instance.key}/element/thanks` });
  assert.deepEqual(Object.keys(def.overlayElements), ["thanks"]);
  assert.equal(overlay.elementAddress(ctx, "autre", {}), null);
});

/* ───────────────────────────── Rien de plus que le mur public ───────────────────────────── */

test("RIEN DE PLUS QUE LE MUR : les dernières personnes d'abord, jamais une personne cachée ni une fiche à relire, jamais de photo, d'e-mail, de compte ni d'identifiant", async () => {
  const { ctx, ids } = world();
  const wall = await C.getWall(ctx);
  const publicNames = new Set(wall.groups.flatMap((g) => g.people.map((p) => p.name)));
  assert.ok(!publicNames.has("Charlie Caché") && !publicNames.has("Inconnu du formulaire"), "le mur public ne les montre pas");
  for (const extra of [{}, { "ov-demo": "1" }]) {
    for (const opts of [{}, { group: "1" }, { group: "2" }, { count: 30 }, { messages: "0" }]) {
      const q = query(600, 700, {}, opts, extra);
      const { html } = await page(q, ctx);
      const text = bodyOf(html);
      for (const secret of ["Charlie", "formulaire", "zoe@example", "zoe_tv", "<img", "<a ", "href=", "moi.example.test", "jtvnw", ...Object.values(ids)]) assert.ok(!text.includes(secret), `${JSON.stringify(opts)} ${JSON.stringify(extra)} : « ${secret} » ne doit pas apparaître`);
      assert.ok(!/<img|src=|url\(/i.test(html), "aucune image, aucun chargement chez un tiers");
      for (const nm of [...names(text), ...names(await frag(q, ctx))]) assert.ok(publicNames.has(nm) || /^Personne d'exemple \d+$/.test(nm), `« ${nm} » n'est pas sur le mur public`);
    }
  }
});

test("ordre : du plus récent au plus ancien dans un groupe ; « tous les groupes » tour à tour, une personne rangée dans deux groupes n'apparaît qu'une fois ; nombre borné", async () => {
  const { ctx } = world();
  const ask = async (opts) => names((await page(query(600, 700, {}, opts), ctx)).html);
  assert.deepEqual(await ask({ group: "1" }), ["Émile Noël", "Zoé Dupont", "Anne Lambert"]);
  assert.deepEqual(await ask({ group: "2" }), ["Fanny Vo", "Émile Noël", "Dina Fox"]);
  assert.deepEqual(await ask({}), ["Émile Noël", "Fanny Vo", "Zoé Dupont", "Anne Lambert", "Dina Fox"], "1er du groupe 1, 1er du groupe 2, puis les suivants à tour de rôle (Émile, déjà montré, est passé)");
  assert.deepEqual(await ask({ count: 2 }), ["Émile Noël", "Fanny Vo"]);
  assert.deepEqual(await ask({ group: "3" }), [], "un groupe qui n'existe pas : cadre vide");
  assert.deepEqual(overlay.pick([], { group: "all", count: 5 }), { people: [], title: "" });
});

test("noms comme sur le mur (réglage « nom montré ») et petits mots dans la langue demandée, comme sur le mur ; l'option « petit mot » les retire", async () => {
  const { ctx, ids } = world({ nameStyle: "first" });
  await addMessage(ctx, ids["Zoé Dupont"], { fr: "Toujours là, merci !", en: "Always there, thanks!" });
  await addMessage(ctx, ids["Anne Lambert"], { en: "Only in English" });
  assert.deepEqual(names((await page(query(600, 700, {}, { group: "1" }), ctx)).html), ["Émile", "Zoé", "Anne"], "prénom seulement, comme le réglage du mur");
  assert.deepEqual(messages((await page(query(600, 700, {}, { group: "1" }), ctx)).html), ["Toujours là, merci !", "Only in English"], "la langue du site en repli, puis n'importe quelle langue (comme sur le mur)");
  assert.deepEqual(messages((await page(query(600, 700, {}, { group: "1", messages: "0" }), ctx)).html), []);
  overlay.resetOverlayCache(); C.resetWall();   // un autre site : on repart d'une mémoire vide
  const nick = world({ nameStyle: "nickname" });
  assert.ok(names((await page(query(600, 700, {}, { group: "1" }), nick.ctx)).html).includes("Zoé_TV"));
  D.forgetData(); overlay.resetOverlayCache(); C.resetWall();
  const enCtx = makeWorld({ book: nick.book, settings: { category: nick.mods }, locale: "en", key: "merci" }).ctx;
  await addMessage(enCtx, nick.ids["Zoé Dupont"], { fr: "Merci", en: "Thanks" });
  assert.match(bodyOf((await page(query(600, 700, {}, { group: "1" }), enCtx)).html), /Thanks/);
  assert.match((await page(query(600, 700), enCtx)).html, />Thank you!</);
});

test("un titre de groupe choisi : l'en-tête reprend le titre du groupe ; tous les groupes : « Merci ! » ; cadre trop bas : pas d'en-tête", async () => {
  const { ctx } = world();
  assert.match((await page(query(600, 700, {}, { group: "2" }), ctx)).html, />Soutiens<\/p>/);
  assert.match((await page(query(600, 700), ctx)).html, />Merci !<\/p>/);
  assert.ok(!/data-ov-part="title"/.test((await page(query(600, 120), ctx)).html));
  assert.ok(!/data-ov-part="title"/.test((await page(query(1600, 300), ctx)).html), "bandeau : pas d'en-tête");
});

test("Contacts muet ou absent, mur pas prêt : en direct un cadre vide et silencieux ; le dernier mur connu (24 h) reste montré ; en mode test des personnes d'exemple", async () => {
  const none = makeWorld({ withBook: false, locale: "fr" });
  assert.equal(await frag(query(600, 700), none.ctx), "");
  const demo = await page(query(600, 700, {}, { count: 3 }, { "ov-demo": "1" }), none.ctx);
  assert.deepEqual(names(demo.html), ["Personne d'exemple 1", "Personne d'exemple 2", "Personne d'exemple 3"]);
  assert.deepEqual(messages(demo.html), ["Un grand merci !", "Un grand merci !"]);
  const empty = fakeContactBook(); empty.seedCategory("A"); empty.seedCategory("B");
  assert.equal(await frag(query(600, 700), makeWorld({ book: empty }).ctx), "", "plusieurs catégories et rien de choisi : le mur public n'est pas prêt non plus");
  // Contacts devient muet APRÈS une première lecture : le dernier mur connu est gardé.
  overlay.resetOverlayCache(); C.resetWall();   // un autre site : on repart d'une mémoire vide
  const w = world();
  assert.equal(names(await frag(query(600, 700, {}, { group: "1" }), w.ctx)).length, 3);
  w.book.faults.hang.add("list");
  C.timing.freshMs = 1;
  overlay.resetOverlayCache(); mock.timers.tick(5000);
  assert.equal(names(await frag(query(600, 700, {}, { group: "1" }), w.ctx)).length, 3, "le dernier mur connu, comme la page publique");
});

/* ───────────────────────────── Rendu et options ───────────────────────────── */

test("trois cadres : colonne, carré, bandeau ; fond transparent, jetons --ov-*, jamais le skin du site ; sens du défilement selon le cadre ; options", async () => {
  const { ctx } = world();
  const seen = {};
  for (const [w, h] of [[360, 640], [800, 520], [1600, 200]]) {
    const { html, res } = await page(query(w, h, {}, {}), ctx);
    seen[`${w}x${h}`] = /data-ov-part="track" data-dir="(\w)"/.exec(html)[1];
    assert.equal(names(html).length, 5);
    assert.match(html, /data-ov-region="element"/); assert.match(html, /data-ov-part="panel"/); assert.match(html, /data-ov-part="person"/); assert.match(html, /data-ov-part="avatar"/);
    assert.match(html, /--ov-fg:#ffffff;--ov-surface:transparent;--ov-radius:12px/);
    assert.match(html, /html,body\{margin:0;height:100%;overflow:hidden;background:transparent\}/);
    assert.ok(!/--sk-|data-skin|<link |\/skins\/|@import|<img|<a[ >]|href=/i.test(html));
    assert.match(res.headers.get("content-security-policy"), /default-src 'none'.*img-src 'none'/);
    assert.match(html, /--u:\d+px/);
  }
  assert.deepEqual(seen, { "360x640": "v", "800x520": "v", "1600x200": "h" }, "bandeau : défilement horizontal ; sinon vertical");
  const dark = await page(query(800, 520, { text: "dark", surface: "soft", corners: "square" }), ctx);
  assert.match(dark.html, /--ov-fg:#111111;--ov-surface:rgba\(255,255,255,\.7\);--ov-radius:0px/);
  assert.match((await page(query(800, 520, {}, { scroll: "0" }), ctx)).html, /data-scroll="0"/);
  assert.match((await page(query(800, 520, {}, {}), ctx)).html, /data-scroll="1"/);
  const p = overlay.readParams(new URLSearchParams({ "opt-group": "2", "opt-count": "7", "opt-scroll": "0", "opt-messages": "0" }));
  assert.deepEqual([p.group, p.count, p.scroll, p.messages], ["2", 7, false, false]);
  const d = overlay.readParams(new URLSearchParams({ "opt-group": "zz", "opt-count": "9999", "opt-scroll": "peut-être" }));
  assert.deepEqual([d.group, d.count, d.scroll, d.messages, d.demo, d.style], ["all", 30, true, true, false, null]);
  for (const hostile of [{ group: "../x" }, { count: "-1" }, { count: "<b>" }, { scroll: "2" }, { messages: "" }]) assert.equal((await page(query(800, 520, {}, hostile), ctx)).res.status, 200);
});

test("le défilement : une copie cachée de la liste ajoutée par la page seulement quand elle dépasse, animation CSS, aucune photo ; le serveur ne duplique rien", async () => {
  const { ctx } = world();
  const { html } = await page(query(360, 640), ctx);
  assert.equal((html.match(/data-ov-part="person"/g) ?? []).length, 5, "côté serveur, chaque personne une seule fois");
  assert.match(html, /cloneNode\(true\)/); assert.match(html, /aria-hidden','true'/); assert.match(html, /tw-y|tw-'\+\(h\?'x':'y'\)/);
  assert.match(html, /@keyframes tw-y/); assert.match(html, /@keyframes tw-x/);
  assert.match(html, /len<=room\+1/, "pas d'animation quand tout tient dans le cadre");
});

test("texte venu de Contacts et des petits mots échappé", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Modérateurs");
  const id = book.seedContact({ name: "<img src=x onerror=alert(1)>", categoryIds: [cat] }).id;
  const { ctx } = makeWorld({ book, settings: { category: cat }, locale: "fr" });
  await addMessage(ctx, id, { fr: "\"><script>alert(2)</script>" });
  const out = bodyOf((await page(query(600, 700), ctx)).html);
  assert.ok(!/<img src=x|<script>alert/.test(out));
  assert.match(out, /&lt;img src=x/);
});

/* ───────────────────────────── Mise à jour douce, plusieurs lecteurs, charge ───────────────────────────── */

test("mise à jour douce : fragment et empreinte stables, page qui s'interroge elle-même, en ralentissant, de façon bornée ; aucune tâche de fond", async () => {
  const { ctx } = world();
  const a = await (await get(`${query(600, 700)}&frag=1`, ctx)).json();
  const b = await (await get(`${query(600, 700)}&frag=1`, ctx)).json();
  assert.equal(a.v, b.v);
  const { html } = await page(query(600, 700), ctx);
  assert.match(html, new RegExp(`data-v="${a.v}"`));
  assert.match(html, /wait=120000/); assert.match(html, /Math\.min\(900000,Math\.round\(wait\*1\.5\)\)/); assert.match(html, /n\+\+>=200/);
  assert.ok(!/setInterval/.test(html));
  assert.equal(def.tasks, undefined, "aucune tâche de fond");
});

test("plusieurs lecteurs (assertMultiReaders) : chaque page d'overlay a son propre repère ; une personne en plus arrive chez tous, une seule fois", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Modérateurs");
  const { ctx } = makeWorld({ book, settings: { category: cat }, locale: "fr" });
  const publish = async (label) => { book.seedContact({ name: label, categoryIds: [cat] }); mock.timers.tick(C.timing.freshMs + overlay.CACHE.ttlMs + 1000); };
  await assertMultiReaders({
    publish, readers: 4,
    open: async () => {
      const seen = new Set();
      const look = async () => names(await frag(query(600, 900, {}, { count: 30 }), ctx));
      (await look()).forEach((e) => seen.add(e));
      return { read: async () => { const fresh = (await look()).filter((e) => !seen.has(e)); fresh.forEach((e) => seen.add(e)); return fresh.sort(); } };
    },
  });
});

test("charge bornée : dix lecteurs en même temps = UNE lecture de Contacts et du stockage ; rien n'est écrit ni consommé", async () => {
  const w = world();
  let calls = 0;
  const orig = w.ctx.api.services.call.bind(w.ctx.api.services);
  w.ctx.api.services.call = (...a) => { calls++; return orig(...a); };
  await Promise.all(Array.from({ length: 10 }, () => get(query(600, 700), w.ctx)));
  const first = calls;
  assert.ok(first >= 1, "Contacts a été lu");
  await Promise.all(Array.from({ length: 10 }, () => get(query(300, 900, {}, { group: "2", count: 2 }), w.ctx)));
  assert.equal(calls, first, "tant que la mémoire vit, aucune nouvelle lecture (autre groupe, autre cadre)");
  const writes = w.ctx.calls.writes.length;
  await get(query(600, 700), w.ctx);
  assert.equal(w.ctx.calls.writes.length, writes, "aucune écriture : rien n'est consommé");
  mock.timers.tick(C.timing.freshMs + overlay.CACHE.ttlMs + 1);
  await get(query(600, 700), w.ctx);
  assert.ok(calls > first, "après expiration, une nouvelle lecture");
});

test("le mur public est inchangé : mêmes groupes, mêmes cartes, rien de l'élément", async () => {
  const { ctx } = world();
  const r = await def.page(ctx, { segments: [] });
  const text = JSON.stringify(r);
  assert.ok(!/tw-track|data-ov-|opt-|ov-w/.test(text));
  assert.deepEqual(Object.keys(def.routes), ["element/:slug"], "la seule route publique est la page de l'élément");
});
