// Mascot — the administration: state and preview, look (errors under the fields), sentences (140 characters, 100 at most), templates, rights, tools for the AI assistant.
// The test site speaks French, so the texts asserted below are the French texts of the module.
import test from "node:test";
import assert from "node:assert/strict";
import { ctxFor, publishedCtx, def, model as M, store as S, manifest, rows, assets } from "./helpers/mascotKit.mjs";

const run = (ctx, name, values = {}) => def.adminActions[name].run(ctx, values);
const panel = (ctx, query = {}) => def.adminPanel(ctx, { query });
const byTab = (blocks, tab) => blocks.filter((b) => (b.tab ?? "use") === tab);
const phraseValues = (over = {}) => ({ text: "Bonjour !", kind: "hello", lang: "fr", pages: "", link: "", state: "published", ...over });

test("on installation: starter sentences are put, the mascot is a DRAFT, nothing in the pages", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  const phrases = await S.loadPhrases(ctx);
  assert.ok(phrases.length >= 10);
  assert.equal((await S.loadConfig(ctx)).published, false);
  assert.equal(await def.slots["layout.head"](ctx), null);
  await def.hooks.onInstanceCreate(ctx);
  assert.equal((await S.loadPhrases(ctx)).length, phrases.length, "idempotent");
});

test("the starter sentences do not come back after everything was deleted (Empty template)", async () => {
  const ctx = ctxFor();
  await panel(ctx);
  await run(ctx, "applyTemplate", { id: "empty" });
  await panel(ctx); await def.hooks.onInstanceCreate(ctx);
  assert.equal((await S.loadPhrases(ctx)).length, 0);
});

test("the panel: draft, published, no sentence, no page; a warning says what is wrong, a healthy mascot shows no banner", async () => {
  const ctx = ctxFor();
  let blocks = await panel(ctx);
  assert.equal(blocks[0].tone, "warning");
  assert.match(blocks[0].text, /Brouillon/);
  assert.equal(blocks[1].action, "publish");
  await run(ctx, "publish");
  blocks = await panel(ctx);
  assert.equal(blocks[0].action, "unpublish", "a healthy mascot shows no banner, only its button");
  assert.ok(!blocks.some((b) => b.type === "banner"));
  assert.ok(blocks.some((b) => b.type === "links" && b.items[0].href === "/?mascot=voir"));
  await run(ctx, "applyTemplate", { id: "empty" });
  assert.match((await panel(ctx))[0].text, /Aucune phrase n'est publiée/);
  assert.equal((await panel(ctx))[0].href, "?tab=phrases");
  const some = ctxFor({ where: "some", pages: "" });
  await panel(some); await run(some, "publish");
  assert.match((await panel(some))[0].text, /Aucune page/);
});

test("tabs: preview and look, sentences and templates, address to see it again", async () => {
  const blocks = await panel(ctxFor());
  assert.ok(byTab(blocks, "use").some((b) => b.type === "adminForm" && b.action === "saveLook"));
  assert.ok(byTab(blocks, "phrases").some((b) => b.type === "adminForm" && b.action === "savePhrase"));
  assert.ok(byTab(blocks, "phrases").some((b) => b.type === "table" && b.rowActions?.some((a) => a.action === "applyTemplate" && a.confirm)));
  assert.ok(byTab(blocks, "settings").some((b) => b.type === "copy" && b.text.endsWith("/?mascot=voir")));
  for (const tab of new Set(blocks.map((b) => b.tab).filter(Boolean))) assert.ok(manifest.tabs.some((t) => t.id === tab), tab);
  for (const b of blocks.filter((b) => b.type === "table")) assert.equal(b.rows.length, b.rowIds.length);
});

test("without the right to edit: no form and no button; without the right to publish: no Publish button", async () => {
  const blocks = await panel(ctxFor({}, { rights: [] }));
  assert.ok(!blocks.some((b) => b.type === "adminForm") && blocks.every((b) => !b.rowActions));
  const editor = ctxFor({}, { rights: ["edit"] });
  assert.ok(!(await panel(editor)).some((b) => b.action === "publish"));
  assert.ok((await panel(editor)).some((b) => b.action === "saveLook"));
  for (const [name, a] of Object.entries(def.adminActions)) assert.ok(manifest.rights.some((r) => r.id === a.right), name);
});

test("preview: theme colours, three moods; what comes from the person is escaped; an invalid colour is ignored", async () => {
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

test("look: my own picture needs the picture and its description, errors UNDER a field with an example", async () => {
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

test("look: the included drawing needs nothing; an uploaded file with a crop is accepted", async () => {
  const ctx = ctxFor();
  assert.ok((await run(ctx, "saveLook", { look: "builtin", image: "", crop: "round" })).ok);
  const up = "/uploads/123e4567-e89b-12d3-a456-426614174000.png?c=1_1_0.5_0.5_ffffff";
  assert.ok((await run(ctx, "saveLook", { look: "image", image: up, alt_fr: "Un renard" })).ok);
  assert.equal((await S.loadConfig(ctx)).image, up);
});

test("publishing a picture without a description is refused; draft is always possible", async () => {
  const ctx = ctxFor();
  await S.saveConfig(ctx, { look: "image", image: "https://example.org/a.png", alts: {} });
  assert.match((await run(ctx, "publish")).error, /décrivez/);
  await S.saveConfig(ctx, { alts: { fr: "Un renard" } });
  assert.ok((await run(ctx, "publish")).ok);
  assert.ok((await run(ctx, "unpublish")).ok);
  assert.equal((await S.loadConfig(ctx)).published, false);
});

test("sentences: add, edit, switch to draft and back, delete", async () => {
  const ctx = ctxFor();
  await run(ctx, "applyTemplate", { id: "empty" });
  assert.ok((await run(ctx, "savePhrase", phraseValues({ text: "Première phrase." }))).ok);
  const [p] = await S.loadPhrases(ctx);
  assert.ok((await run(ctx, "savePhrase", phraseValues({ id: p.id, text: "Changée.", kind: "tip", pages: "/agenda\n/blog/*", link: "/agenda" }))).ok);
  const q = (await S.loadPhrases(ctx))[0];
  assert.deepEqual([q.id, q.text, q.kind, q.pages, q.link], [p.id, "Changée.", "tip", ["/agenda", "/blog/*"], "/agenda"]);
  assert.equal(q.at, p.at);
  await run(ctx, "setPhraseState", { id: p.id, enabled: "0" });
  assert.equal((await S.loadPhrases(ctx))[0].state, "draft");
  await run(ctx, "setPhraseState", { id: p.id, enabled: "0" });
  assert.equal((await S.loadPhrases(ctx))[0].state, "draft", "the switch says the wanted state: a second click never undoes the first");
  await run(ctx, "setPhraseState", { id: p.id, enabled: "1" });
  assert.equal((await S.loadPhrases(ctx))[0].state, "published");
  assert.ok((await run(ctx, "removePhrase", { id: p.id })).ok);
  assert.equal((await S.loadPhrases(ctx)).length, 0);
});

test("sentences: each error is UNDER its field, says what to do and gives an example", async () => {
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

test("a hundred sentences at most; the list of the administration is cut by 50", async () => {
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

test("a forged id never targets anything but a sentence", async () => {
  const ctx = ctxFor();
  await panel(ctx);
  await S.saveConfig(ctx, { published: true, names: { fr: "Pixel" } });
  const configId = ctx.dumpStore().find((r) => r.collection === "config").id;
  for (const name of ["removePhrase", "setPhraseState"]) assert.ok((await run(ctx, name, { id: configId })).error, name);
  assert.ok((await run(ctx, "savePhrase", phraseValues({ id: configId }))).error);
  assert.ok((await run(ctx, "removePhrase", { id: "n-importe-quoi" })).error);
  assert.equal((await S.loadConfig(ctx)).names.fr, "Pixel");
  assert.equal(rows(ctx, "config").length, 1);
});

test("templates: Discreet welcome replaces everything, Empty clears, an unknown template is refused", async () => {
  const ctx = ctxFor();
  await run(ctx, "applyTemplate", { id: "empty" });
  await run(ctx, "savePhrase", phraseValues({ text: "La mienne." }));
  assert.ok((await run(ctx, "applyTemplate", { id: "welcome" })).ok);
  const phrases = await S.loadPhrases(ctx);
  assert.ok(phrases.length >= 10 && !phrases.some((p) => p.text === "La mienne."));
  assert.ok((await run(ctx, "applyTemplate", { id: "nimporte" })).error);
  assert.equal((await S.loadPhrases(ctx)).length, phrases.length);
});

test("a one-language site: one name field and one description field, no English series", async () => {
  const ctx = ctxFor({}, { locales: ["fr"] });
  const form = (await panel(ctx)).find((b) => b.action === "saveLook");
  assert.deepEqual(form.fields.filter((f) => /^(name|alt)_/.test(f.name)).map((f) => f.name), ["name_fr"], "the description only shows with my own picture");
  await S.saveConfig(ctx, { look: "image" });
  const own = (await panel(ctx)).find((b) => b.action === "saveLook");
  assert.deepEqual(own.fields.filter((f) => /^(name|alt)_/.test(f.name)).map((f) => f.name), ["alt_fr", "name_fr"]);
  assert.ok(!(await S.loadPhrases(ctx)).some((p) => p.lang === "en"));
  assert.doesNotMatch(form.fields.find((x) => x.name === "name_fr").label, /\(/);
});

test("tools for the assistant: read; proposing a sentence is ALWAYS a draft, not granted by default, ceiling of 100", async () => {
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

test("readable backup: a table of the sentences, cells neutralised against formulas", async () => {
  const ctx = ctxFor();
  await run(ctx, "applyTemplate", { id: "empty" });
  await run(ctx, "savePhrase", phraseValues({ text: "=HYPERLINK(\"x\")" }));
  const [file] = await def.backup.readable(ctx);
  assert.equal(file.path, "phrases.csv");
  assert.match(file.content, /"'=HYPERLINK/);
});

test("the script contains no hard-coded colour", async () => {
  const built = await assets.buildClient(await publishedCtx());
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(built.code));
});

test("look: the picture, its description and its shape only show with my own picture; the name is a folded option", async () => {
  const ctx = ctxFor();
  const names = async () => (await panel(ctx)).find((b) => b.action === "saveLook").fields;
  let fields = await names();
  assert.deepEqual(fields.filter((f) => !f.folded).map((f) => f.name), ["look"]);
  assert.ok(fields.filter((f) => /^name_/.test(f.name)).every((f) => f.folded));
  // Choosing "My own picture" only switches the look: the fields that were not on the form keep what is stored, and nothing is refused yet.
  await S.saveConfig(ctx, { names: { fr: "Pixel" }, alts: { fr: "Un renard" }, crop: "square" });
  const r = await run(ctx, "saveLook", { look: "image" });
  assert.ok(r.ok && !r.errors);
  let c = await S.loadConfig(ctx);
  assert.deepEqual([c.look, c.crop, c.names, c.alts], ["image", "square", { fr: "Pixel" }, { fr: "Un renard" }]);
  fields = await names();
  assert.deepEqual(fields.filter((f) => !f.folded).map((f) => f.name), ["look", "image", "alt_fr", "alt_en"]);
  assert.ok(fields.find((f) => f.name === "crop").folded);
  assert.ok((await run(ctx, "publish")).error, "a picture look without a picture is not published");
});

test("sentences: one searchable list, the state is a switch, only what differs is written, a sentence opens in a window", async () => {
  const ctx = ctxFor();
  await run(ctx, "applyTemplate", { id: "empty" });
  await run(ctx, "savePhrase", phraseValues({ text: "Everywhere.", lang: "" }));
  await run(ctx, "savePhrase", phraseValues({ text: "Only here.", lang: "en", pages: "/events", state: "draft" }));
  const blocks = await panel(ctx, {});
  const table = blocks.find((x) => x.type === "table" && x.rowActions?.some((a) => a.action === "removePhrase"));
  assert.equal(table.searchable, true);
  assert.deepEqual(table.rows.map((r) => r[1]), ["Salutation", "Salutation · anglais · /events"], "no \"All languages\" label on the default");
  assert.deepEqual(table.rows.map((r) => r[2].switch.on), [true, false]);
  assert.ok(table.rows.every((r) => r[2].switch.action === "setPhraseState" && r[2].switch.label));
  assert.ok(table.rowActions.every((a) => a.action !== "togglePhrase"));
  assert.equal(table.rowActions.find((a) => a.label === "Modifier").presentation, "dialog");
  const [first] = await S.loadPhrases(ctx);
  const edit = (await panel(ctx, { edit: first.id })).filter((b) => b.action === "savePhrase");
  assert.equal(edit.length, 1);
  assert.equal(edit[0].presentation, "dialog");
  assert.equal(edit[0].cancelHref, "?tab=phrases");
  const add = blocks.find((b) => b.action === "savePhrase");
  assert.equal(add.presentation, undefined, "adding stays in the page: two fields and a click");
  assert.deepEqual(add.fields.filter((f) => !f.folded).map((f) => f.name), ["text", "kind", "lang"]);
});
