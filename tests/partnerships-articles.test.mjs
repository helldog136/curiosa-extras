// Partnerships: the published articles of the site and the partner files tell the same story. Invented data only.
// A file shows the state of its article, a published article with no file is a row of its own ("Add the file"), and the two numbers of the overview agree.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const PDIR = new URL("../modules/partnerships", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const messages = { en: readJson(`${PDIR}/locales/en.json`), fr: readJson(`${PDIR}/locales/fr.json`) };
const manifest = readJson(`${PDIR}/module.json`);
const def = (await import("../modules/partnerships/index.mjs")).default;

const article = (id, title, extra = {}) => ({ id, title, path: `/sponsoring/${id}`, publishedAt: "2026-11-01T10:00:00Z", tags: [], ...extra });
const withArticles = (items, { locale = "en", settings = {} } = {}) =>
  fakeCtx({ key: "partnerships", locale, messages: messages[locale], settings, entries: items, instances: [{ key: "sponsoring", module: "collection" }] });
const file = (ctx, brand, status = "publie", extra = {}) => ctx.api.store.add("partners", { brand, status, ...extra });
const table = async (ctx, query = {}) => (await def.adminPanel(ctx, { query })).find((b) => b.type === "table");
const heading = async (ctx) => (await def.adminPanel(ctx, { query: {} })).find((b) => b.type === "heading").text;
const rowOf = (t, id) => t.rows[t.rowIds.indexOf(id)];

test("the manifest: version bumped, the module of the articles is an advanced text setting that works with no setup", () => {
  assert.equal(manifest.version, "2.6.0");
  const s = manifest.settings.find((x) => x.key === "articlesKey");
  assert.deepEqual([s.type, s.default, s.advanced], ["text", "sponsoring", true]);
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.fr).sort(), "FR and EN keys match");
});

test("a published article with no file is a row of the table, counted in Published, with its own origin badge and an 'Add the file' window", async () => {
  const ctx = withArticles([article("a1", "Nova Games review")]);
  await file(ctx, "Lune Douce Studio", "discussion");
  const t = await table(ctx);
  assert.deepEqual(t.columns, ["Brand", "Status", "Article", "Chance of success", "Last activity", "Follow-up"]);
  assert.equal(t.rows.length, 2);
  const row = rowOf(t, "article:a1");
  assert.deepEqual([row[0], row[1]], ["Nova Games review", "Published"]);
  assert.deepEqual([row[2].text, row[2].badge, row[2].href], ["Article without file", "info", "/sponsoring/a1"]);
  const blocks = await def.adminPanel(ctx, { query: { edit: "article:a1" } });
  const dialog = blocks.find((b) => b.type === "adminForm" && b.presentation === "dialog");
  assert.equal(dialog.submitLabel, "Add the file");
  assert.equal(dialog.secondaryAction, undefined, "nothing to delete: the file does not exist yet");
  assert.deepEqual(dialog.fields.filter((f) => f.kind === "hidden").map((f) => [f.name, f.value]), [["id", ""], ["articleId", "a1"]]);
  assert.equal(dialog.fields.find((f) => f.name === "brand").value, "Nova Games review");
  assert.equal(dialog.fields.find((f) => f.name === "status").value, "publie");
});

test("'Add the file' creates one file from the article, flagged, and replaying it creates nothing more", async () => {
  const ctx = withArticles([article("a1", "Nova Games review")]);
  const v = { id: "", articleId: "a1", brand: "Nova Games review", status: "publie" };
  await def.adminActions.savePartner(ctx, v);
  await def.adminActions.savePartner(ctx, v);
  const rows = await ctx.api.store.list("partners", { limit: 10 });
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].data.articleId, rows[0].data.fromArticle, rows[0].data.status], ["a1", true, "publie"]);
  const t = await table(ctx);
  assert.deepEqual(t.rowIds, [rows[0].id], "the article is not shown a second time");
  assert.deepEqual([rowOf(t, rows[0].id)[2].text, rowOf(t, rows[0].id)[2].badge], ["Published", "ok"]);
});

test("a file is paired with its article by its own choice, else by its name, each article once; an unrelated article stays a separate row", async () => {
  const ctx = withArticles([article("a1", "Nova Games"), article("a2", "Review of Etoile Nord"), article("a3", "Camille tests the keyboard"), article("a4", "Something else")]);
  const nova = await file(ctx, "Nova Games");
  const etoile = await file(ctx, "etoile_nord");
  const chosen = await file(ctx, "Camille", "publie", { articleId: "a4" });
  const t = await table(ctx);
  assert.equal(rowOf(t, nova)[2].href, "/sponsoring/a1", "same name");
  assert.equal(rowOf(t, etoile)[2].href, "/sponsoring/a2", "the brand is a whole word of the title (case, accents and punctuation ignored)");
  assert.equal(rowOf(t, chosen)[2].href, "/sponsoring/a4", "the explicit choice wins over the name");
  assert.deepEqual(t.rowIds.filter((id) => id.startsWith("article:")), ["article:a3"], "the name 'Camille' alone does not steal an article another file chose");
});

test("a file 'Published' without a published article says so, and a draft never counts: only published articles are ever read", async () => {
  const ctx = withArticles([article("a1", "Nova Games")]);
  const ghost = await file(ctx, "Lune Douce Studio", "publie");
  const sent = await file(ctx, "Camille Atelier", "envoye");
  const t = await table(ctx);
  assert.deepEqual([rowOf(t, ghost)[2].text, rowOf(t, ghost)[2].badge], ["No published article", "warn"]);
  assert.equal(rowOf(t, sent)[2], "", "a file that is not Published and has no article shows nothing: no filler");
  const page = await def.adminPanel(ctx, { query: { partner: ghost } });
  assert.match(JSON.stringify(page), /No published article/);
  assert.ok(ctx.calls.entries.every((o) => o.instance === "sponsoring" && o.limit === 200), "published entries of the articles module, bounded");
});

test("linking in the edit window: only a published article is taken; a removed one is refused with a way out; empty goes back to 'found by name'", async () => {
  const ctx = withArticles([article("a1", "Nova Games")]);
  const id = await file(ctx, "Lune Douce Studio", "publie");
  const form = (await def.adminPanel(ctx, { query: { edit: id } })).find((b) => b.presentation === "dialog");
  const pick = form.fields.find((f) => f.name === "articleId");
  assert.deepEqual([pick.kind, pick.folded, pick.value], ["select", true, ""]);
  assert.deepEqual(pick.options.map((o) => o.label), ["Found by name", "Nova Games"]);
  assert.equal(form.fields.filter((f) => f.kind !== "hidden" && !f.folded).length, 4, "four fields in sight, as before");
  assert.deepEqual(await def.adminActions.savePartner(ctx, { id, brand: "Lune Douce Studio", articleId: "gone" }), { error: messages.en.articleGone });
  await def.adminActions.savePartner(ctx, { id, brand: "Lune Douce Studio", articleId: "a1" });
  assert.equal((await ctx.api.store.get(id)).data.articleId, "a1");
  await def.adminActions.savePartner(ctx, { id, brand: "Lune Douce Studio", articleId: "" });
  assert.equal((await ctx.api.store.get(id)).data.articleId, "");
  await def.adminActions.savePartner(ctx, { id, brand: "Lune Douce Studio" });
  assert.equal((await ctx.api.store.get(id)).data.brand, "Lune Douce Studio", "a save from a site without articles leaves the file as it is");
});

test("the number in the title is the number of rows of the table, closed files and articles included, in every case", async () => {
  for (const withArt of [false, true]) {
    const ctx = withArt ? withArticles([article("a1", "Nova Games"), article("a2", "Another story")]) : fakeCtx({ key: "partnerships", messages: messages.en });
    await file(ctx, "Nova Games", "publie");
    await file(ctx, "Lune Douce Studio", "decline");
    await file(ctx, "Camille Atelier", "termine");
    await file(ctx, "etoile_nord", "discussion");
    const t = await table(ctx);
    assert.equal(await heading(ctx), `Overview (${t.rows.length})`, withArt ? "with articles" : "without articles");
    assert.equal(t.rows.length, withArt ? 5 : 4);
  }
});

test("without the articles module nothing changes: no article column, no extra field, no read of entries", async () => {
  const ctx = fakeCtx({ key: "partnerships", messages: messages.en, instances: [] });
  const id = await file(ctx, "Nova Games", "publie");
  const t = await table(ctx);
  assert.deepEqual(t.columns, ["Brand", "Status", "Chance of success", "Last activity", "Follow-up"]);
  const form = (await def.adminPanel(ctx, { query: { edit: id } })).find((b) => b.presentation === "dialog");
  assert.equal(form.fields.find((f) => f.name === "articleId"), undefined);
  assert.deepEqual(ctx.calls.entries, []);
});

test("another module key can be set; the French texts exist", async () => {
  const ctx = withArticles([article("a1", "Nova Games")], { locale: "fr", settings: { articlesKey: "sponsoring" } });
  const t = await table(ctx);
  assert.deepEqual(t.columns.slice(0, 3), ["Marque", "Statut", "Article"]);
  assert.equal(rowOf(t, "article:a1")[2].text, "Article sans fiche");
});
