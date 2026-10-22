// Santé du site — ce que le module voit du site (par l'API des modules seulement), la façon dont il le dit, et l'honnêteté sur ce qu'il ne voit pas.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseManifest } from "@/core/modules/manifest";
import { makeSite, entry, manifest, fr, en, def, U, S, R, V, DIR, quick, clock, links, withFakeFetch, DIR as D2 } from "./helpers/site-check-kit.mjs";

const source = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
const find = (groups, id, loc = null) => groups.find((g) => g.id === id && g.loc === loc);
const html = (blocks) => blocks.filter((b) => b.type === "html").map((b) => b.html).join("\n");

test("manifeste valide ; fr et en alignés (clés et variables) ; toutes les clés utilisées existent ; toutes les actions déclarées existent", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of Object.keys(fr)) { assert.equal(vars(fr[k]), vars(en[k]), k); assert.ok(fr[k].trim() && en[k].trim(), k); }
  for (const m of source.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in fr, `clé manquante : ${m[1]}`);
  for (const a of manifest.mcp) assert.equal(typeof def.mcp[a.name], "function", a.name);
  assert.equal(manifest.minCore, "0.2.5");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.instances, "single");
  assert.ok(!manifest.tasks && !def.tasks, "jamais de tâche de fond");
  for (const a of ["check", "more", "ignore", "unignore", "fix"]) assert.equal(typeof def.adminActions[a], "function", a);
});

test("extractRefs : images sans description (Markdown vide ou en espaces, HTML sans alt), alt=\"\" écrit exprès = voulu, code ignoré, liens de toute forme", () => {
  const text = [
    "![](/a.png) ![  ](/b.png) ![Un chat](/c.png) <img src=\"/d.png\"> <img src='/e.png' alt=''> <img src=\"/f.png\" alt=\"Joli\">",
    "```\n![](/code.png) [x](https://dans-un-bloc.example.org)\n```",
    "et `![](/inline.png)` puis [Boutique](https://shop.example.org/a#top) et <a href=\"https://html.example.org/\">lien</a> et <https://auto.example.org/x> et https://nu.example.org/y.",
  ].join("\n");
  const r = U.extractRefs(text);
  assert.deepEqual(r.images.map((i) => [i.src, i.alt]), [["/a.png", ""], ["/b.png", ""], ["/c.png", "Un chat"], ["/d.png", ""], ["/e.png", null], ["/f.png", "Joli"]]);
  assert.deepEqual(r.links.map((l) => l.href).sort(), ["https://auto.example.org/x", "https://html.example.org/", "https://nu.example.org/y", "https://shop.example.org/a#top"]);
  assert.deepEqual(U.extractRefs("").images, []);
  assert.deepEqual(U.extractRefs(undefined).links, []);
});

test("classifyHref : externe (sans #fragment), interne (y compris vers soi-même), rien à vérifier pour mailto/ancre/javascript", () => {
  const own = "mon-site.example.org";
  assert.deepEqual(U.classifyHref("https://shop.example.org/a?b=1#x", own), { kind: "external", url: "https://shop.example.org/a?b=1" });
  assert.deepEqual(U.classifyHref("//cdn.example.org/x", own), { kind: "external", url: "https://cdn.example.org/x" });
  assert.deepEqual(U.classifyHref("/Blog/Mon-Article/?x=1#y", own), { kind: "internal", path: "/blog/mon-article" });
  assert.deepEqual(U.classifyHref("https://mon-site.example.org/blog/a/", own), { kind: "internal", path: "/blog/a" });
  for (const x of ["mailto:a@example.org", "tel:+3212345", "#haut", "javascript:alert(1)", "data:text/html,x", "relatif/sans/slash", "", "   ", "ftp://x.example.org", "http://exa mple.org", "https://" + "a".repeat(2100)]) assert.equal(U.classifyHref(x, own), null, x);
  assert.equal(U.stripLocale("/en/blog/a", ["fr", "en"]), "/blog/a");
  assert.equal(U.stripLocale("/blog/a", ["fr", "en"]), "/blog/a");
  assert.equal(U.stripLocale("/de/blog/a", ["fr", "en"]), "/de/blog/a");
});

const demo = () => {
  const A = entry({ id: "A", title: "À propos", summary: "", body: "Notre histoire en images. ![](/uploads/a.png) ![photo](/uploads/b.png) ![ ](https://img.example.org/c.png)", slug: "a-propos", path: "/pages/a-propos" });
  const B = entry({ id: "B", title: "Contact", body: "Écrivez-nous. Voir [ici](/blog/article-inexistant) ou [là](/blog/vrai-article).", slug: "contact", path: "/pages/contact" });
  const C = entry({ id: "C", title: "Doublon", slug: "doublon", path: "/pages/doublon" });
  const D = entry({ id: "D", title: "  doublon  ", slug: "doublon-2", path: "/pages/doublon-2" });
  const E = entry({ id: "E", title: "", slug: "sans-titre", path: "/pages/sans-titre" });
  const F = entry({ id: "F", title: "Ma boutique", summary: "", body: "", url: "https://shop.example.org/", slug: "boutique", path: "/pages/boutique" });
  const V1 = entry({ id: "V", title: "Un vrai article", body: "Contenu de l'article, assez long pour compter.", slug: "vrai-article", path: "/blog/vrai-article" });
  const V1en = { ...V1, title: "A real article", body: "Article content, long enough to count.", slug: "true-article", path: "/en/blog/true-article" };
  const enPages = [{ ...A, path: "/en/pages/a-propos" }, { ...C, title: "Duplicate", path: "/en/pages/doublon" }];   // A identique au français ; B absente ; C traduite
  return makeSite({
    instances: [{ key: "pages", name: "Pages", basePath: "pages" }, { key: "blog", name: "Blog", basePath: "blog" }],
    entries: { pages: { fr: [A, B, C, D, E, F], en: enPages }, blog: { fr: [V1], en: [V1en] } },
  });
};

test("ce que l'API montre : images sans description, titres vides ou doublons, pages sans description, traductions, liens vers une page disparue — chacun avec son importance et son bouton", async () => {
  const s = await S.scanSite(demo());
  const alt = find(s.groups, "alt", "fr");
  assert.deepEqual([alt.sev, alt.count, alt.items.length, alt.items[0].t], ["important", 2, 1, "À propos"], "2 images (la 3e a une description) sur 1 page");
  assert.deepEqual(alt.items[0].d, ["imgs", 2]);
  assert.deepEqual(find(s.groups, "title_empty", "fr").items.map((i) => i.t), ["Sans titre"]);
  assert.equal(find(s.groups, "title_empty", "fr").sev, "important");
  const dup = find(s.groups, "title_dup", "fr");
  assert.deepEqual([dup.sev, dup.count, dup.items.map((i) => i.t.trim()).sort()], ["advised", 2, ["Doublon", "doublon"]]);
  const sum = find(s.groups, "summary", "fr");
  assert.deepEqual(sum.items.map((i) => i.t), ["À propos"], "la boutique (lien sortant) et la page titrée sans résumé de l'éditeur : seule « À propos » est signalée");
  const tr = find(s.groups, "translation", "en");
  assert.deepEqual(tr.items.map((i) => [i.t, i.d[0]]).sort(), [["Contact", "absent"], ["À propos", "same"]]);
  assert.equal(tr.sev, "advised");
  const inn = find(s.groups, "internal", "fr");
  assert.deepEqual([inn.sev, inn.count, inn.items[0].d], ["important", 1, ["path", "/blog/article-inexistant"]], "/blog/vrai-article existe : seul l'autre est signalé");
  assert.equal(find(s.groups, "home"), undefined, "l'accroche existe");
  assert.equal(find(s.groups, "contact"), undefined);
  // chaque remarque a un bouton qui mène à un écran d'administration réel
  for (const g of s.groups) for (const i of g.items) assert.match(S.fixHref(i.f, "fr") ?? "", /^\/admin\//, `${g.id}`);
  assert.equal(S.fixHref(find(s.groups, "translation", "en").items.find((i) => i.d[0] === "same").f, "fr"), "/admin/entries/A?locale=en");
  assert.equal(S.fixHref(alt.items[0].f, "fr"), "/admin/entries/A", "langue d'origine : pas de paramètre de langue");
  // liens à visiter : l'image distante et la boutique
  assert.deepEqual(s.links.map((l) => [l.u, l.k]).sort(), [["https://img.example.org/c.png", "image"], ["https://shop.example.org/", "link"]]);
  assert.deepEqual([s.stats.pages, s.stats.images, s.stats.instances], [6 + 1, 3, 2]);
});

test("le site lui-même : accroche vide → page d'accueil sans description ; pas d'adresse de contact → pour info ; site vide → pour info", async () => {
  const s = await S.scanSite(makeSite({ tagline: "  ", contactEmail: "", instances: [], entries: {} }));
  assert.deepEqual([find(s.groups, "home").sev, find(s.groups, "contact").sev, find(s.groups, "empty").sev], ["advised", "info", "info"]);
  assert.equal(S.fixHref(find(s.groups, "home").items[0].f, "fr"), "/admin/settings#site");
});

test("jamais de faux positif sur un site en ordre : aucune remarque, et le résumé dit « Tout va bien »", async () => {
  const ctx = makeSite({ entries: { pages: [entry({ title: "Accueil", body: "Bonjour ![Un chat](/c.png) [x](/pages/accueil)", slug: "accueil", path: "/pages/accueil" })] }, locales: ["fr"] });
  const s = await S.scanSite(ctx);
  assert.deepEqual(s.groups, []);
  const r = await R.startCheck(ctx, quick());
  assert.equal(r.finished, true);
  const text = html(V.panelBlocks(ctx, await R.readState(ctx)));
  assert.match(text, /Tout va bien/);
  assert.match(text, /Rien d&#39;important à corriger/);
  assert.doesNotMatch(text, /Quelques petites choses/);
});

test("une seule langue : pas de comparaison de traductions, et le panneau le dit", async () => {
  const ctx = makeSite({ locales: ["fr"], entries: { pages: [entry({ title: "Accueil" })] } });
  await R.startCheck(ctx, quick());
  const st = await R.readState(ctx);
  assert.equal(st.report.notes.multi, false);
  assert.ok(V.notChecked(ctx, st.report).some((i) => /une seule langue/.test(i.text)));
});

test("limites honnêtes : 200 entrées lues par rubrique et par langue — au-delà, c'est dit ; une rubrique illisible aussi ; 40 rubriques au plus", async () => {
  const many = Array.from({ length: 200 }, (_, i) => entry({ title: `T${i}`, slug: `t${i}`, path: `/pages/t${i}` }));
  const ctx = makeSite({ entries: { pages: many }, locales: ["fr"] });
  const s = await S.scanSite(ctx);
  assert.deepEqual(s.notes.capped, ["Pages"]);
  ctx.api.entries.list = async () => { throw new Error("boom"); };
  const s2 = await S.scanSite(ctx);
  assert.deepEqual(s2.notes.unreadable, ["Pages"]);
  const lots = makeSite({ instances: Array.from({ length: 45 }, (_, i) => ({ key: `r${i}`, name: `R${i}`, basePath: `r${i}` })), entries: {}, locales: ["fr"] });
  assert.equal((await S.scanSite(lots)).notes.cutInstances, 5);
  await R.startCheck(ctx, quick());
  const text = V.notChecked(ctx, (await R.readState(ctx)).report).map((i) => i.text).join("\n");
  assert.match(text, /« Pages » n'a pas pu être lu/);
  assert.match(text, /menu/, "le menu n'est pas lisible : dit en toutes lettres");
});

test("le panneau : blocs valides, aucun texte du site n'entre brut dans le HTML, aucune adresse dangereuse reprise comme lien", async () => {
  const evil = '<script>alert(1)</script>"\'&';
  const ctx = makeSite({ entries: { pages: [entry({ id: "X", title: evil, summary: "", body: `![](javascript:alert(1)) [${evil}](https://x.example.org/${encodeURIComponent(evil)}) [j](javascript:alert(2))`, url: "javascript:alert(3)" })] }, instances: [{ key: "pages", name: evil, basePath: "pages" }], locales: ["fr"] });
  await R.startCheck(ctx, quick({ ...clock() }, { probeDeps: { resolve: async () => ({ ok: true, addresses: ["93.184.216.34"] }) } }));
  const blocks = await def.adminPanel(ctx, { query: { all: evil } });
  const allowed = new Set(["html", "heading", "markdown", "table", "adminForm"]);
  for (const b of blocks) assert.ok(allowed.has(b.type), b.type);
  const h = html(blocks);
  assert.ok(!h.includes("<script"), "pas de balise script");
  assert.ok(!/href="javascript:/i.test(h));
  for (const b of blocks.filter((x) => x.type === "table")) { assert.ok(b.rows.every((r) => r.length === b.columns.length)); if (b.rowActions) assert.equal(b.rowIds.length, b.rows.length); }
  for (const b of blocks.filter((x) => x.type === "adminForm")) assert.ok(typeof def.adminActions[b.action] === "function");
  for (const b of blocks.filter((x) => x.type === "table" && x.rowActions)) for (const a of b.rowActions) assert.ok(a.action && typeof def.adminActions[a.action] === "function");
});

test("un panneau sans aucune vérification : accueillant, un seul geste proposé, et la liste de ce qui n'est pas regardé est déjà là", async () => {
  const ctx = makeSite();
  const blocks = await def.adminPanel(ctx, {});
  const h = html(blocks);
  assert.match(h, /n&#39;a pas encore été vérifié/);
  const forms = blocks.filter((b) => b.type === "adminForm");
  assert.deepEqual(forms.map((f) => [f.action, f.submitLabel]), [["check", "Vérifier maintenant"]]);
  assert.match(h, /Ce que je n&#39;ai pas pu regarder/);
  assert.equal(blocks.some((b) => b.type === "table"), false, "pas d'historique vide");
  const english = makeSite({ locale: "en" });
  assert.match(html(await def.adminPanel(english, {})), /has not been checked yet/);
});

test("les liens « Corriger » du cœur existent vraiment (écrans d'administration présents dans le cœur de test)", () => {
  const core = process.env.CURIOSA_DIR;
  if (!core || !fs.existsSync(path.join(core, "src/app/admin"))) return;   // pas de cœur sous la main : vérifié ailleurs
  const route = (p) => fs.existsSync(path.join(core, "src/app/admin/(panel)", p, "page.tsx"));
  assert.ok(route("entries/[id]"), "éditeur d'une page : /admin/entries/<id>");
  assert.ok(route("entries"), "liste : /admin/entries");
  assert.ok(route("settings"), "réglages du site : /admin/settings");
  assert.ok(route("navigation"), "menu : /admin/navigation");
  assert.ok(route("instances/[id]"), "page d'une instance : /admin/instances/<id>");
  const src = fs.readFileSync(path.join(core, "src/app/admin/(panel)/entries/[id]/page.tsx"), "utf8");
  assert.match(src, /locale\?: string/, "?locale=… est lu par l'éditeur");
  const settings = fs.readFileSync(path.join(core, "src/app/admin/(panel)/settings/page.tsx"), "utf8");
  assert.match(settings, /id: "site"/, "#site existe dans les réglages");
  for (const href of ["/admin/settings#site", "/admin/navigation", "/admin/entries"]) assert.ok(S.fixHref(["p", href], "fr"), href);
  assert.equal(S.fixHref(["p", "/admin/users"], "fr"), null, "pas d'autre destination");
  assert.equal(S.fixHref(["e", "../../etc", "fr"], "fr"), null);
  assert.equal(S.fixHref(["i", "https://evil.example.org"], "fr"), null);
});
