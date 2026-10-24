// Mascotte — ce qui part vers les pages : emplacement d'en-tête, script, feuille de style, phrases du moment.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ctxFor, publishedCtx, def, store as S, assets as A, get, eventSource, inDays, rows } from "./helpers/mascotKit.mjs";

const head = (ctx) => def.slots["layout.head"](ctx);
const call = (ctx, name, path, init) => def.routes[name](get(path, init), ctx);

test("brouillon, sans phrase publiée, ou « certaines pages » sans page : les pages ne chargent RIEN", async () => {
  const draft = ctxFor();
  await def.hooks.onInstanceCreate(draft);
  assert.equal(await head(draft), null);
  const silent = await publishedCtx();
  for (const p of await S.loadPhrases(silent)) await S.removePhrase(silent, p.id);
  assert.equal(await head(silent), null);
  assert.equal(await head(await publishedCtx({ where: "some", pages: "" })), null);
  assert.equal((await call(silent, "mascot.js", "/m/x/mascot.js")).status, 404);
});

test("publiée : UNE balise de script defer (fichier du site, pas de script en ligne) avec empreinte et langue", async () => {
  const ctx = await publishedCtx();
  const [block] = await head(ctx);
  assert.equal(block.tags.length, 1);
  const tag = block.tags[0];
  assert.deepEqual([tag.tag, tag.defer, tag.inline], ["script", true, undefined]);
  assert.match(tag.src, new RegExp(`^/m/${ctx.instance.key}/mascot\\.js\\?lang=fr&v=[0-9a-f]{8}$`));
});

test("un réglage change l'adresse du script", async () => {
  const ctx = await publishedCtx();
  const a = (await head(ctx))[0].tags[0].src;
  assert.equal((await head(ctx))[0].tags[0].src, a);
  await S.saveConfig(ctx, { names: { fr: "Pixel" } });
  assert.notEqual((await head(ctx))[0].tags[0].src, a);
});

test("route du script : JavaScript, « pour toujours » seulement avec la bonne empreinte ; HEAD sans corps ; écritures refusées", async () => {
  const ctx = await publishedCtx();
  const built = await A.buildClient(ctx);
  const ok = await call(ctx, "mascot.js", `/m/x/mascot.js?lang=fr&v=${built.hash}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("content-type"), /^application\/javascript/);
  assert.match(ok.headers.get("cache-control"), /immutable/);
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await ok.text(), built.code);
  assert.equal((await call(ctx, "mascot.js", "/m/x/mascot.js?v=00000000")).headers.get("cache-control"), "no-cache");
  const h = await call(ctx, "mascot.js", "/m/x/mascot.js", { method: "HEAD" });
  assert.equal(await h.text(), "");
  for (const method of ["POST", "PUT", "DELETE"]) assert.equal((await def.routes["mascot.js"](new Request("https://example.test/m/x/mascot.js", { method, body: method === "DELETE" ? undefined : "x" }), ctx)).status, 405);
  const writes = ctx.calls.writes.length;
  await call(ctx, "mascot.js", "/m/x/mascot.js");
  assert.equal(ctx.calls.writes.length, writes);
});

test("configuration embarquée dans la langue de la page, nom piégé sans casser le fichier", async () => {
  const ctx = await publishedCtx({ corner: "left", where: "some", pages: "/blog/*\n/faq", delay: 12, show: 6, max: 2 }, { locale: "en" });
  await S.saveConfig(ctx, { names: { en: 'Pixel "</script>\\ ' } });
  const built = await A.buildClient(ctx);
  assert.deepEqual([built.cfg.p, built.cfg.w, built.cfg.g, built.cfg.d, built.cfg.s, built.cfg.m, built.cfg.l], ["l", "some", ["/blog/*", "/faq"], 12, 6, 2, "en"]);
  assert.equal(built.cfg.u.x, "Close");
  assert.equal(built.cfg.u.o, `Talk with ${built.cfg.n}`);
  assert.doesNotThrow(() => new vm.Script(built.code));
  assert.doesNotThrow(() => vm.runInNewContext(built.code, { window: {}, document: {}, location: {}, history: {} }));
});

test("réglages bornés : valeurs absurdes ramenées dans la plage", async () => {
  for (const [settings, expected] of [[{ delay: 0, show: 0, max: 0 }, [3, 4, 1]], [{ delay: 9999, show: 9999, max: 9999 }, [60, 20, 10]], [{ delay: "abc", show: null, max: "x" }, [8, 8, 3]]]) {
    const { cfg } = await A.buildClient(await publishedCtx(settings));
    assert.deepEqual([cfg.d, cfg.s, cfg.m], expected, JSON.stringify(settings));
  }
});

test("l'image n'est transmise que si elle est valide ET décrite", async () => {
  const ctx = await publishedCtx();
  await S.saveConfig(ctx, { look: "image", image: "https://example.org/a.png", alts: {}, crop: "square" });
  assert.equal((await A.buildClient(ctx)).cfg.i, null);
  await S.saveConfig(ctx, { alts: { fr: "Un renard" } });
  assert.deepEqual((await A.buildClient(ctx)).cfg.i, { s: "https://example.org/a.png", a: "Un renard", r: false });
  await S.saveConfig(ctx, { image: "javascript:alert(1)" });
  assert.equal((await A.buildClient(ctx)).cfg.i, null);
});

test("feuille de style : couleurs du thème seulement, animations sous « mouvement réduit », cibles de 44 px, marges de sécurité, sous le bandeau des cookies", async () => {
  const ctx = await publishedCtx();
  const r = await call(ctx, "mascot.css", `/m/x/mascot.css?v=${A.cssHash}`);
  assert.match(r.headers.get("content-type"), /^text\/css/);
  assert.match(r.headers.get("cache-control"), /immutable/);
  const css = await r.text();
  assert.ok(!/@import|url\(|expression\(|javascript:/i.test(css));
  assert.equal(css.replace(/var\(--v-[a-z0-9-]+(?:,(?:[^()]|\([^()]*\))*)?\)/gi, "").match(/#[0-9a-f]{3,8}\b/gi), null);
  for (const token of ["--v-accent", "--v-surface", "--v-fg", "--v-line", "--v-muted"]) assert.ok(css.includes(token), token);
  const outside = css.replace(/@media \(prefers-reduced-motion:no-preference\)\{[\s\S]*?\n\}\n/, "").replace(/@keyframes[^{]+\{[\s\S]*?\}\}/g, "");
  assert.ok(!/(^|[;{\s])(animation|transition)\s*:/.test(outside));
  assert.match(css, /height:44px/);
  assert.match(css, /@media print\{\.mc\{display:none\}\}/);
  assert.match(css, /\.mc\{position:fixed;bottom:max\(16px,env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /max-width:min\(330px,calc\(100vw - 32px\)\)/);
  assert.ok(Number(/z-index:(\d+)/.exec(css)[1]) < 50);
  assert.equal((await def.routes["mascot.css"](new Request("https://example.test/x", { method: "POST", body: "x" }), ctx)).status, 405);
});

const linesOf = async (ctx, path = "/") => JSON.parse(await (await call(ctx, "lines", `/m/x/lines?path=${encodeURIComponent(path)}`)).text());

test("phrases du moment : celles de la page, dans la langue du visiteur ; rien en brouillon", async () => {
  const draft = ctxFor();
  await def.hooks.onInstanceCreate(draft);
  assert.deepEqual(await linesOf(draft), { items: [] });
  const ctx = await publishedCtx();
  const r = await call(ctx, "lines", "/m/x/lines?path=%2F");
  assert.match(r.headers.get("cache-control"), /max-age=30/);
  const { items } = JSON.parse(await r.text());
  assert.ok(items.length >= 4 && items.every((i) => ["hello", "tip", "news"].includes(i.kind)));
  assert.ok(!items.some((i) => /\{|\}/.test(i.text.replace(/\{\{[td]:[^}]+\}\}/g, ""))));
  assert.ok(!items.some((i) => /Questions fréquentes/.test(i.text)));
  assert.ok(items.some((i) => /Demo/.test(i.text)));
  assert.ok((await linesOf(await publishedCtx({}, { locale: "en" }))).items.every((i) => !/Bonjour|Bienvenue/.test(i.text)));
});

test("phrases du moment : accueil / certaines pages respectés côté site, adresse piégée ramenée à un chemin", async () => {
  const home = await publishedCtx({ where: "home" });
  assert.ok((await linesOf(home, "/")).items.length > 0);
  assert.deepEqual(await linesOf(home, "/faq"), { items: [] });
  const some = await publishedCtx({ where: "some", pages: "/blog/*" });
  assert.deepEqual(await linesOf(some, "/"), { items: [] });
  assert.ok((await linesOf(some, "/blog/un-article")).items.length > 0);
  for (const evil of ["https://evil.example/blog/x", "//evil.example/blog", "javascript:alert(1)", "../../etc/passwd", "x".repeat(5000)]) assert.deepEqual(await linesOf(some, evil), { items: [] }, evil.slice(0, 30));
});

test("phrases du moment : le prochain événement s'y trouve quand une source existe ; seule la lecture est permise", async () => {
  const withEvents = await publishedCtx({}, { services: eventSource([{ id: "x:1", title: "Grande soirée", start: inDays(4) }]) });
  assert.ok((await linesOf(withEvents)).items.some((i) => /Grande soirée/.test(i.text)));
  assert.ok(!(await linesOf(await publishedCtx())).items.some((i) => i.kind === "news"));
  const ctx = await publishedCtx();
  for (const method of ["POST", "PUT", "DELETE"]) assert.equal((await def.routes.lines(new Request("https://example.test/m/x/lines", { method, body: "x" }), ctx)).status, 405);
  const n = rows(ctx, "phrases").length;
  await linesOf(ctx);
  assert.equal(rows(ctx, "phrases").length, n);
});

test("lien « Réveiller la mascotte » : seulement demandé ET publiée", async () => {
  assert.deepEqual(await def.slots["layout.footer"](await publishedCtx({ footerLink: true })), [{ type: "links", items: [{ label: "Réveiller la mascotte", href: "/?mascot=voir" }] }]);
  assert.equal(await def.slots["layout.footer"](await publishedCtx()), null);
  const draft = ctxFor({ footerLink: true });
  await def.hooks.onInstanceCreate(draft);
  assert.equal(await def.slots["layout.footer"](draft), null);
});

test("aucun fichier du module n'importe un voisin sans la version du fichier principal", async () => {
  const fs = await import("node:fs");
  const dir = new URL("../modules/mascot/", import.meta.url).pathname;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".mjs"))) assert.ok(!/^\s*(import|export)\b[^\n]*\bfrom\s+["']\.\.?\//m.test(fs.readFileSync(`${dir}${f}`, "utf8")), f);
});
