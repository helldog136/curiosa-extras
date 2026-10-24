// Mascotte — l'administration : état et aperçu, apparence (erreurs sous les champs), phrases (140 caractères, 100 au plus), gabarits, droits, outils pour l'assistant IA.
import test from "node:test";
import assert from "node:assert/strict";
import { ctxFor, publishedCtx, def, model as M, store as S, manifest, rows, assets } from "./helpers/mascotKit.mjs";

const run = (ctx, name, values = {}) => def.adminActions[name].run(ctx, values);
const panel = (ctx, query = {}) => def.adminPanel(ctx, { query });
const byTab = (blocks, tab) => blocks.filter((b) => (b.tab ?? "use") === tab);
const phraseValues = (over = {}) => ({ text: "Bonjour !", kind: "hello", lang: "fr", pages: "", link: "", state: "published", ...over });

test("à l'installation : phrases de départ posées, mascotte en BROUILLON, rien dans les pages", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  const phrases = await S.loadPhrases(ctx);
  assert.ok(phrases.length >= 10);
  assert.equal((await S.loadConfig(ctx)).published, false);
  assert.equal(await def.slots["layout.head"](ctx), null);
  await def.hooks.onInstanceCreate(ctx);
  assert.equal((await S.loadPhrases(ctx)).length, phrases.length, "idempotent");
});

test("les phrases de départ ne reviennent pas quand on a tout supprimé (gabarit « Vide »)", async () => {
  const ctx = ctxFor();
  await panel(ctx);
  await run(ctx, "applyTemplate", { id: "empty" });
  await panel(ctx); await def.hooks.onInstanceCreate(ctx);
  assert.equal((await S.loadPhrases(ctx)).length, 0);
});

test("le panneau : brouillon, publiée, sans phrase, sans page — chaque état dit ce qu'il faut faire", async () => {
  const ctx = ctxFor();
  let blocks = await panel(ctx);
  assert.equal(blocks[0].tone, "warning");
  assert.match(blocks[0].text, /brouillon/);
  assert.equal(blocks[1].action, "publish");
  await run(ctx, "publish");
  blocks = await panel(ctx);
  assert.equal(blocks[0].tone, "success");
  assert.equal(blocks[1].action, "unpublish");
  assert.ok(blocks.some((b) => b.type === "links" && b.items[0].href === "/?mascot=voir"));
  await run(ctx, "applyTemplate", { id: "empty" });
  assert.match((await panel(ctx))[0].text, /aucune phrase publiée/);
  const some = ctxFor({ where: "some", pages: "" });
  await panel(some); await run(some, "publish");
  assert.match((await panel(some))[0].text, /aucune page/);
});

test("onglets : aperçu et apparence, phrases et gabarits, adresse de rappel", async () => {
  const blocks = await panel(ctxFor());
  assert.ok(byTab(blocks, "use").some((b) => b.type === "adminForm" && b.action === "saveLook"));
  assert.ok(byTab(blocks, "phrases").some((b) => b.type === "adminForm" && b.action === "savePhrase"));
  assert.ok(byTab(blocks, "phrases").some((b) => b.type === "table" && b.rowActions?.some((a) => a.action === "applyTemplate" && a.confirm)));
  assert.ok(byTab(blocks, "settings").some((b) => b.type === "copy" && b.text.endsWith("/?mascot=voir")));
  for (const tab of new Set(blocks.map((b) => b.tab).filter(Boolean))) assert.ok(manifest.tabs.some((t) => t.id === tab), tab);
  for (const b of blocks.filter((b) => b.type === "table")) assert.equal(b.rows.length, b.rowIds.length);
});

test("sans droit d'écrire : ni formulaire ni bouton ; sans droit de publier : pas de bouton Publier", async () => {
  const blocks = await panel(ctxFor({}, { rights: [] }));
  assert.ok(!blocks.some((b) => b.type === "adminForm") && blocks.every((b) => !b.rowActions));
  const editor = ctxFor({}, { rights: ["edit"] });
  assert.ok(!(await panel(editor)).some((b) => b.action === "publish"));
  assert.ok((await panel(editor)).some((b) => b.action === "saveLook"));
  for (const [name, a] of Object.entries(def.adminActions)) assert.ok(manifest.rights.some((r) => r.id === a.right), name);
});

test("aperçu : couleurs du thème, trois humeurs ; ce qui vient de la personne est échappé ; couleur invalide ignorée", async () => {
  const ctx = ctxFor({}, { theme: { accent: "#e8a23b", accent2: "#22aa88", accentFg: "#111111", bg: "#121214", surface: "#1b1b1d", fg: "#f4f4f5", muted: "#a1a1a3", line: "#2e2e30" } });
  await S.saveConfig(ctx, { names: { fr: "<img src=x onerror=alert(1)>" } });
  const html = (await panel(ctx)).find((b) => b.type === "html").html;
  assert.match(html, /--v-accent:#e8a23b/);
  assert.match(html, /--v-accent2:#22aa88/);
  assert.equal((html.match(/<svg class="mc-svg"/g) || []).length, 4);
  assert.ok(!html.includes("<img src=x"));
  const bad = ctxFor({}, { theme: { accent: "red;background:url(//evil)", surface: "#fff" } });
  assert.ok(!(await panel(bad)).find((b) => b.type === "html").html.includes("evil"));
});

test("apparence : ma propre image — image et description obligatoires, erreurs SOUS un champ avec un exemple", async () => {
  const ctx = ctxFor();
  let r = await run(ctx, "saveLook", { look: "image", image: "", alt_fr: "" });
  assert.match(r.errors.look, /Choisissez une image/);
  assert.match(r.errors.alt_fr, /Exemple/);
  assert.equal(r.error, undefined);
  r = await run(ctx, "saveLook", { look: "image", image: "http://example.org/a.png", alt_fr: "Un renard" });
  assert.match(r.errors.look, /https:\/\/www\.example\.org/);
  r = await run(ctx, "saveLook", { look: "image", image: "javascript:alert(1)", alt_fr: "x" });
  assert.ok(r.errors.look);
  r = await run(ctx, "saveLook", { look: "image", image: "https://example.org/a.png", alt_fr: "a".repeat(M.LIMITS.alt + 1), name_fr: "n".repeat(M.LIMITS.name + 1) });
  assert.ok(r.errors.alt_fr && r.errors.name_fr);
  assert.equal((await S.loadConfig(ctx)).look, "builtin");
  r = await run(ctx, "saveLook", { look: "image", image: "https://example.org/a.png", alt_fr: "Un renard orange qui salue", crop: "square", name_fr: "Pixel", name_en: "Pixie" });
  assert.ok(r.ok && !r.errors);
  const c = await S.loadConfig(ctx);
  assert.deepEqual([c.look, c.image, c.crop, c.names, c.alts], ["image", "https://example.org/a.png", "square", { fr: "Pixel", en: "Pixie" }, { fr: "Un renard orange qui salue" }]);
  assert.equal(S.nameFor({ ...ctx, locale: "en" }, c), "Pixie");
  assert.equal(S.altFor({ ...ctx, locale: "en" }, c), "Un renard orange qui salue");
});

test("apparence : le dessin inclus n'a besoin de rien ; un fichier envoyé avec cadrage est accepté", async () => {
  const ctx = ctxFor();
  assert.ok((await run(ctx, "saveLook", { look: "builtin", image: "", crop: "round" })).ok);
  const up = "/uploads/123e4567-e89b-12d3-a456-426614174000.png?c=1_1_0.5_0.5_ffffff";
  assert.ok((await run(ctx, "saveLook", { look: "image", image: up, alt_fr: "Un renard" })).ok);
  assert.equal((await S.loadConfig(ctx)).image, up);
});

test("publier avec une image sans description est refusé ; le brouillon est toujours possible", async () => {
  const ctx = ctxFor();
  await S.saveConfig(ctx, { look: "image", image: "https://example.org/a.png", alts: {} });
  assert.match((await run(ctx, "publish")).error, /décrivez/);
  await S.saveConfig(ctx, { alts: { fr: "Un renard" } });
  assert.ok((await run(ctx, "publish")).ok);
  assert.ok((await run(ctx, "unpublish")).ok);
  assert.equal((await S.loadConfig(ctx)).published, false);
});

test("phrases : ajouter, modifier, basculer en brouillon, supprimer", async () => {
  const ctx = ctxFor();
  await run(ctx, "applyTemplate", { id: "empty" });
  assert.ok((await run(ctx, "savePhrase", phraseValues({ text: "Première phrase." }))).ok);
  const [p] = await S.loadPhrases(ctx);
  assert.ok((await run(ctx, "savePhrase", phraseValues({ id: p.id, text: "Changée.", kind: "tip", pages: "/agenda\n/blog/*", link: "/agenda" }))).ok);
  const q = (await S.loadPhrases(ctx))[0];
  assert.deepEqual([q.id, q.text, q.kind, q.pages, q.link], [p.id, "Changée.", "tip", ["/agenda", "/blog/*"], "/agenda"]);
  assert.equal(q.at, p.at);
  await run(ctx, "togglePhrase", { id: p.id });
  assert.equal((await S.loadPhrases(ctx))[0].state, "draft");
  await run(ctx, "togglePhrase", { id: p.id });
  assert.equal((await S.loadPhrases(ctx))[0].state, "published");
  assert.ok((await run(ctx, "removePhrase", { id: p.id })).ok);
  assert.equal((await S.loadPhrases(ctx)).length, 0);
});

test("phrases : chaque erreur est SOUS son champ, dit quoi faire et donne un exemple", async () => {
  const ctx = ctxFor();
  const cases = [
    [{ text: "" }, "text", /Exemple/], [{ text: "x".repeat(141) }, "text", /141 caractères.*140/],
    [{ text: "Salut {prenom}" }, "text", /\{prenom\} n'existe pas.*\{nom_du_site\}/], [{ text: "Salut {" }, "text", /accolades/],
    [{ lang: "xx" }, "lang", /langue/], [{ pages: "agenda" }, "pages", /\/agenda/], [{ link: "javascript:alert(1)" }, "link", /https:\/\//],
  ];
  for (const [over, field, re] of cases) {
    const r = await run(ctx, "savePhrase", phraseValues(over));
    assert.match(r.errors?.[field] ?? "", re, JSON.stringify(over));
    assert.equal(r.error, undefined);
  }
  const en = ctxFor({}, { locale: "en" });
  assert.match((await run(en, "savePhrase", phraseValues({ text: "Hi {prenom}" }))).errors.text, /\{prenom\} does not exist.*\{site_name\}/);
});

test("cent phrases au plus ; la liste de l'administration se découpe par 50", async () => {
  const ctx = ctxFor();
  await run(ctx, "applyTemplate", { id: "empty" });
  for (let i = 0; i < 100; i++) assert.ok((await run(ctx, "savePhrase", phraseValues({ text: `Phrase ${i}` }))).ok);
  assert.match((await run(ctx, "savePhrase", phraseValues({ text: "De trop" }))).errors.text, /100/);
  assert.equal(rows(ctx, "phrases").length, 100);
  const list = (b) => b.find((x) => x.type === "table" && x.rowActions?.some((a) => a.action === "removePhrase"));
  assert.equal(list(await panel(ctx)).rows.length, 50);
  assert.equal(list(await panel(ctx, { page: "2" })).rows.length, 50);
  assert.ok((await panel(ctx, { page: "99999" })).length > 0);
});

test("un identifiant forgé ne vise jamais autre chose qu'une phrase", async () => {
  const ctx = ctxFor();
  await panel(ctx);
  await S.saveConfig(ctx, { published: true, names: { fr: "Pixel" } });
  const configId = ctx.dumpStore().find((r) => r.collection === "config").id;
  for (const name of ["removePhrase", "togglePhrase"]) assert.ok((await run(ctx, name, { id: configId })).error, name);
  assert.ok((await run(ctx, "savePhrase", phraseValues({ id: configId }))).error);
  assert.ok((await run(ctx, "removePhrase", { id: "n-importe-quoi" })).error);
  assert.equal((await S.loadConfig(ctx)).names.fr, "Pixel");
  assert.equal(rows(ctx, "config").length, 1);
});

test("gabarits : « Bienvenue discrète » remplace tout, « Vide » efface, un gabarit inconnu est refusé", async () => {
  const ctx = ctxFor();
  await run(ctx, "applyTemplate", { id: "empty" });
  await run(ctx, "savePhrase", phraseValues({ text: "La mienne." }));
  assert.ok((await run(ctx, "applyTemplate", { id: "welcome" })).ok);
  const phrases = await S.loadPhrases(ctx);
  assert.ok(phrases.length >= 10 && !phrases.some((p) => p.text === "La mienne."));
  assert.ok((await run(ctx, "applyTemplate", { id: "nimporte" })).error);
  assert.equal((await S.loadPhrases(ctx)).length, phrases.length);
});

test("site à une seule langue : un seul champ de nom et de description, pas de série anglaise", async () => {
  const ctx = ctxFor({}, { locales: ["fr"] });
  const form = (await panel(ctx)).find((b) => b.action === "saveLook");
  assert.deepEqual(form.fields.filter((f) => /^(name|alt)_/.test(f.name)).map((f) => f.name), ["name_fr", "alt_fr"]);
  assert.ok(!(await S.loadPhrases(ctx)).some((p) => p.lang === "en"));
  assert.doesNotMatch(form.fields.find((x) => x.name === "name_fr").label, /\(/);
});

test("outils pour l'assistant : lire ; proposer une phrase est TOUJOURS un brouillon, non accordé d'office, plafond de 100", async () => {
  const names = manifest.mcp.map((m) => m.name);
  assert.deepEqual(Object.keys(def.mcp).sort(), [...names].sort());
  assert.ok(names.every((n) => `mascot__${n}`.length <= 64));
  const list = manifest.mcp.find((m) => m.name === "mascot_phrases_list"), add = manifest.mcp.find((m) => m.name === "mascot_phrase_add");
  assert.equal(list.readOnly, true);
  assert.ok(add.readOnly !== true && add.default !== true && add.destructive !== true);
  const ctx = ctxFor();
  await panel(ctx);
  const before = await def.mcp.mascot_phrases_list(ctx, {});
  assert.equal(before.mascotPublished, false);
  assert.ok(before.variables.includes("{nom_du_site}"));
  const writes = ctx.calls.writes.length;
  await def.mcp.mascot_phrases_list(ctx, { status: "draft", limit: 3 });
  assert.equal(ctx.calls.writes.length, writes);
  const r = await def.mcp.mascot_phrase_add(ctx, { text: "Une idée de l'assistant.", kind: "tip", language: "fr", pages: ["/agenda"] });
  const mine = (await S.loadPhrases(ctx)).find((p) => p.id === r.id);
  assert.deepEqual([mine.state, mine.kind, mine.lang, mine.pages], ["draft", "tip", "fr", ["/agenda"]]);
  await assert.rejects(def.mcp.mascot_phrase_add(ctx, { text: "x".repeat(141) }), (e) => e.expose === true && /140/.test(e.message));
  await assert.rejects(def.mcp.mascot_phrase_add(ctx, { text: "Salut {zzz}" }), (e) => e.expose === true);
  await assert.rejects(def.mcp.mascot_phrase_add(ctx, { text: "Ok", language: "zz" }), (e) => e.expose === true);
  await run(ctx, "applyTemplate", { id: "empty" });
  for (let i = 0; i < 100; i++) await def.mcp.mascot_phrase_add(ctx, { text: `P${i}` });
  await assert.rejects(def.mcp.mascot_phrase_add(ctx, { text: "De trop" }), (e) => e.expose === true && /100/.test(e.message));
  assert.equal((await S.loadPhrases(ctx)).filter((p) => p.state === "published").length, 0);
});

test("sauvegarde lisible : un tableau des phrases, cellules neutralisées contre les formules", async () => {
  const ctx = ctxFor();
  await run(ctx, "applyTemplate", { id: "empty" });
  await run(ctx, "savePhrase", phraseValues({ text: "=HYPERLINK(\"x\")" }));
  const [file] = await def.backup.readable(ctx);
  assert.equal(file.path, "phrases.csv");
  assert.match(file.content, /"'=HYPERLINK/);
});

test("le script ne contient aucune couleur écrite en dur", async () => {
  const built = await assets.buildClient(await publishedCtx());
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(built.code));
});
