// Content notebook 1.2.0: the documents kept inside an idea (a script in versions v1, v2, final): limits, versions, the admin screens, the assistant tools,
// the files (CSV and readable backup), and the privacy of it all. Names in this file are invented.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { validateArgs } from "@/core/services/mcp/validate";
import { parseManifest } from "@/core/modules/manifest";
import { adminPageErgonomicsProblems } from "./helpers/ergonomics.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = path.join(ROOT, "modules/content-planner");
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json");
const def = (await import("../modules/content-planner/index.mjs")).default;
const D = await import("../modules/content-planner/data.mjs");
const X = await import("../modules/content-planner/documents.mjs");
const E = await import("../modules/content-planner/export.mjs");

const NOW = "2026-10-22T10:00:00Z";
let seq = 0;
const ctxFor = (opts = {}) => {
  const ctx = fakeCtx({ key: `cpd${++seq}`, moduleId: "content-planner", basePath: null, locale: opts.locale ?? "en", messages: readJson(`locales/${opts.locale ?? "en"}.json`), settings: {}, permissions: manifest.permissions, ...opts });
  ctx.__plannerNow = NOW;
  return ctx;
};
const rows = (ctx, collection) => ctx.dumpStore().filter((r) => r.collection === collection);
// def.adminPanel gives every link of an html block the namespace of the instance (shared place pages, see placeLinks.mjs): strip it to read the plain address.
const html = (blocks) => blocks.filter((b) => b.type === "html").map((b) => b.html).join("\n").replace(/([?]|&amp;)cpd\d+\./g, "$1");
const form = (blocks, action) => blocks.find((b) => b.type === "adminForm" && b.action === action);
const table = (blocks) => blocks.find((b) => b.type === "table" && b.rowActions?.some((a) => a.action === "deleteDoc"));
const panel = (ctx, query) => def.adminPanel(ctx, { query });
const newIdea = async (ctx, title = "Camille's first video") => { const r = await def.adminActions.quickAdd(ctx, { quickTitle: title }); assert.ok(r.ok, JSON.stringify(r)); return rows(ctx, "ideas").at(-1).id; };
const saveDoc = (ctx, idea, v0 = {}) => def.adminActions.saveDoc(ctx, { idea, id: "", title: "Video script", version: "v1", text: "Hello everyone.", ...v0 });
const docsOf = (ctx, idea) => X.docsOf(ctx, idea);
const call = (ctx, name, args = {}) => {
  const decl = manifest.mcp.find((a) => a.name === name);
  const checked = validateArgs(decl.input, args); // the core refuses (by throwing) any argument outside the schema
  return def.mcp[name](ctx, checked ?? args, { name: "test" });
};
const exposed = async (promise) => { try { await promise; } catch (e) { assert.equal(e.expose, true, "the error must be readable by the assistant"); return e.message; } assert.fail("an error was expected"); };
const script = (n) => `${"Line of the script.\n".repeat(Math.ceil(n / 20)).slice(0, n - 1)}.`; // exactly n characters, no trailing space

// ── Manifest ─────────────────────────────────────────────────────────────────────────────────────────────────

test("manifest: 1.2.0, valid, minCore 0.6.0 (the enriched table and the folded field), no new permission", () => {
  const r = parseManifest(manifest);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.version, "1.2.0");
  assert.equal(manifest.minCore, "0.6.0", "the kit asks for 0.6.0 as soon as a table is searchable or a field is folded");
  assert.equal(manifest.dataVersion, 1, "no migration: the documents live in a collection of their own");
  assert.deepEqual([...manifest.permissions].sort(), ["admin", "mcp", "storage"]);
});

test("manifest: the four document tools are declared and implemented; reads are read-only, writes are never granted by default", () => {
  assert.deepEqual(manifest.mcp.map((a) => a.name).sort(), Object.keys(def.mcp).sort());
  const byName = Object.fromEntries(manifest.mcp.map((a) => [a.name, a]));
  for (const name of ["idea_doc_list", "idea_doc_get"]) assert.equal(byName[name].readOnly, true, name);
  for (const name of ["idea_doc_add", "idea_doc_update"]) { assert.ok(!byName[name].readOnly, name); assert.ok(byName[name].default !== true, `${name}: a write is never granted by default`); }
  for (const a of manifest.mcp) assert.ok(a.name.length <= 31 && !a.destructive, a.name);
});

test("no tool to delete anything exists, in the manifest or in the code", () => {
  assert.ok(!manifest.mcp.some((a) => /delete|remove|erase|purge|clear|destroy/i.test(a.name)), "no delete tool in module.json");
  assert.ok(!Object.keys(def.mcp).some((n) => /delete|remove|erase|purge|clear|destroy/i.test(n)), "no delete tool in the code");
  for (const f of ["tools.mjs", "export.mjs", "documents.mjs"]) {
    const src = fs.readFileSync(`${DIR}/${f}`, "utf8");
    const removers = f === "documents.mjs" ? 2 : 0; // removeDoc and removeDocsOf: called by the admin only
    assert.equal((src.match(/store\.remove\(/g) ?? []).length, removers, `${f}: store.remove`);
  }
  assert.ok(!/removeDoc|removeDocsOf|store\.remove/.test(fs.readFileSync(`${DIR}/tools.mjs`, "utf8")), "the assistant tools never reach a removal");
});

test("texts: every new key exists in English and French with the same {variables}", () => {
  const fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of Object.keys(en)) assert.equal(vars(fr[k]), vars(en[k]), k);
  for (const k of Object.keys(en).filter((x) => /^(doc|errDoc|csvDoc|mdDocs|deleteConfirmDocs)/.test(x))) assert.ok(en[k].trim() && fr[k].trim(), k);
});

// ── Limits and cleaning ──────────────────────────────────────────────────────────────────────────────────────

test("limits: a document holds 60 000 characters, an idea 20 documents and 240 000 characters, the notebook 2 000 documents", () => {
  assert.deepEqual([X.DOC_LIMITS.text, X.DOC_LIMITS.title, X.DOC_LIMITS.version, X.MAX_DOCS_PER_IDEA, X.MAX_CHARS_PER_IDEA, X.MAX_DOCS_TOTAL], [60000, 120, 20, 20, 240000, 2000]);
  assert.ok(X.DOC_LIMITS.text > D.LIMITS.notes * 10, "far above the 4 000 characters of the notes");
});

test("check: title is required, nothing is cut silently, control characters are cleaned, line breaks are kept", () => {
  assert.deepEqual(X.check({ title: "  ", version: "v1", text: "" }).problems.map((p) => p.code), ["titleEmpty"]);
  assert.deepEqual(X.check({ title: "x".repeat(121) }).problems.map((p) => p.code), ["titleLong"]);
  assert.deepEqual(X.check({ title: "ok", version: "v".repeat(21) }).problems.map((p) => p.code), ["versionLong"]);
  assert.deepEqual(X.check({ title: "ok", text: "t".repeat(60001) }).problems.map((p) => p.code), ["textLong"]);
  assert.equal(X.check({ title: "ok", text: "t".repeat(60000) }).problems.length, 0);
  const { values } = X.check({ title: "  Video \n script ", version: " v 2 ", text: "a\r\nb\u0000c​\n\n" });
  assert.deepEqual(values, { title: "Video script", version: "v 2", text: "a\nbc" });
  assert.deepEqual(X.check({ version: "v3" }, { requireTitle: false }).values, { version: "v3" }, "an update may leave the title out");
});

test("nextVersion: v1 gives v2, draft 3 gives draft 4, final gives final 2, always short enough", () => {
  assert.equal(X.nextVersion("v1"), "v2");
  assert.equal(X.nextVersion("v9"), "v10");
  assert.equal(X.nextVersion("draft 3"), "draft 4");
  assert.equal(X.nextVersion("final"), "final 2");
  assert.equal(X.nextVersion(""), "v2");
  assert.ok(X.nextVersion("a".repeat(20)).length <= 20);
  assert.ok(X.nextVersion("x".repeat(15) + "99999").length <= 20);
});

// ── Backward compatibility: an idea written by 1.1.3 ─────────────────────────────────────────────────────────

const legacyIdea = { title: "Old idea", summary: "Written by 1.1.3", column: "doing", archived: false, steps: [{ label: "Script", done: true }, { label: "Thumbnail", done: false }], targetDate: "2026-11-14", publishedAt: "", networks: ["YouTube"], notes: "Some notes", by: "owner", createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-02T08:00:00.000Z" };

test("an idea stored by 1.1.3 (no document anywhere) still loads, shows an empty Documents area and accepts a first document", async () => {
  const ctx = ctxFor({ rows: { ideas: [legacyIdea] } });
  const id = rows(ctx, "ideas")[0].id;
  const idea = await D.getIdea(ctx, id);
  assert.equal(idea.title, "Old idea");
  assert.deepEqual(idea.steps.map((s) => s.label), ["Script", "Thumbnail"]);
  assert.deepEqual(await docsOf(ctx, id), []);
  const blocks = await panel(ctx, { idea: id });
  assert.match(html(blocks), /No document here/);
  assert.equal(table(blocks), undefined, "no table while there is no document");
  const tool = await call(ctx, "idea_get", { id });
  assert.equal(tool.documentCount, 0);
  assert.equal(tool.title, "Old idea");
  const r = await saveDoc(ctx, id);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(rows(ctx, "ideas")[0].data, legacyIdea, "adding a document never rewrites the idea row");
  assert.deepEqual((await D.loadAll(ctx)).map((i) => i.id), [id]);
});

test("the files of a notebook without documents are exactly what 1.1.3 produced: two files, no download button for documents", async () => {
  const ctx = ctxFor({ rows: { ideas: [legacyIdea] } });
  const files = await def.backup.readable(ctx);
  assert.deepEqual(files.map((f) => f.path), ["ideas.csv", "ideas.md"]);
  const blocks = await panel(ctx, {});
  assert.ok(blocks.some((b) => b.type === "download" && b.name === "ideas"));
  assert.ok(!blocks.some((b) => b.type === "download" && b.name === "documents"));
  assert.deepEqual(E.headerCells(ctx).length, 10, "the ideas file keeps its ten columns");
});

// ── Admin: the Documents area ────────────────────────────────────────────────────────────────────────────────

test("empty state: one sentence and one button that adds the first document (a link, never a drag and drop)", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  const blocks = await panel(ctx, { idea: id, col: "idea" });
  const at = blocks.findIndex((b) => b.type === "heading" && b.text === "Documents");
  assert.ok(at > 0, "a Documents heading");
  assert.match(html(blocks), /class="cp-empty">No document here\./);
  assert.match(html(blocks), new RegExp(`class="cp-btn" href="\\?idea=${id}&amp;col=idea&amp;newDoc=1">Add the first document</a>`));
  assert.ok(!/drag|drop/i.test(JSON.stringify(blocks)));
});

test("adding: the window has a title and the text (the version is folded and empty, v1 shown as the default), a precise button, a way back, an example", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  const blocks = await panel(ctx, { idea: id, newDoc: "1" });
  const f = form(blocks, "saveDoc");
  assert.equal(f.presentation, "dialog");
  assert.equal(f.submitLabel, "Add the document");
  assert.equal(f.cancelHref, `?idea=${id}`);
  const visible = f.fields.filter((x) => x.kind !== "hidden" && !x.folded);
  assert.deepEqual(visible.map((x) => x.name), ["title", "text"], "two visible fields: the short path (R2)");
  const version = f.fields.find((x) => x.name === "version");
  assert.equal(version.folded, true);
  assert.equal(version.value, "", "an empty folded field: a value would open the fold by itself");
  assert.equal(version.placeholder, "v1");
  assert.ok(f.fields.find((x) => x.name === "title").example);
  assert.equal(f.secondaryAction, undefined, "nothing to delete in a new document");
});

test("a document added without a version label is version v1", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  assert.ok((await def.adminActions.saveDoc(ctx, { idea: id, id: "", title: "Outline", version: "", text: "" })).ok);
  assert.deepEqual((await docsOf(ctx, id)).map((d) => [d.title, d.version, d.text]), [["Outline", "v1", ""]]);
});

test("saving a first document: a clear confirmation, a row with title, version, date and length, newest edit first", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  const r = await saveDoc(ctx, id, { text: script(7000) });
  assert.match(r.ok, /Document added: “Video script”, 7,000 characters\./);
  ctx.__plannerNow = "2026-10-23T10:00:00Z";
  await saveDoc(ctx, id, { title: "Shorts", version: "v1", text: "Short one." });
  const t = table(await panel(ctx, { idea: id }));
  assert.deepEqual(t.columns, ["Document", "Version", "Edited", "Length"]);
  assert.deepEqual(t.rows.map((r) => r[0].text), ["Shorts", "Video script"], "most recently edited first");
  assert.deepEqual(t.rows[1][1], { text: "v1", badge: "neutral" });
  assert.equal(t.rows[1][3], "7,000 characters");
  assert.equal(t.searchable, true, "live search from the start (R15)");
  assert.deepEqual(t.truncate, [0]);
});

test("rows: Read and Edit are visible, the new version is in the menu, deleting is red, confirmed and says what is lost", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  await saveDoc(ctx, id);
  const t = table(await panel(ctx, { idea: id, col: "doing", page: "2" }));
  const [read, edit, version, del] = t.rowActions;
  assert.deepEqual([read.label, edit.label, version.label, del.label], ["Read", "Edit", "New version", "Delete"]);
  assert.equal(read.href, `?idea=${id}&col=doing&page=2&doc={id}`);
  assert.equal(edit.presentation, "dialog");
  assert.equal(version.inMenu, true);
  assert.equal(del.danger, true);
  assert.match(del.confirm, /for good.*cannot be brought back.*other documents stay/s);
  assert.equal(t.rowActions.filter((a) => !a.inMenu && !a.danger).length, 2, "at most two visible actions (R16)");
});

test("editing: the window offers title, version and text, a delete button apart that says what is lost; the change is kept and confirmed", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  await saveDoc(ctx, id, { text: "x".repeat(1234) });
  const [doc] = await docsOf(ctx, id);
  const f = form(await panel(ctx, { idea: id, editDoc: doc.id }), "saveDoc");
  assert.deepEqual(f.fields.filter((x) => x.kind !== "hidden").map((x) => x.name), ["title", "version", "text"]);
  assert.equal(f.fields.find((x) => x.name === "text").kind, "textarea");
  assert.equal(f.submitLabel, "Save the document");
  assert.equal(f.secondaryAction.action, "deleteDoc");
  assert.match(f.secondaryAction.confirm, /“Video script”.*1,234 characters.*cannot be brought back/s);
  ctx.__plannerNow = "2026-10-25T10:00:00Z";
  const r = await def.adminActions.saveDoc(ctx, { idea: id, id: doc.id, title: "Video script, final cut", version: "final", text: "New text." });
  assert.match(r.ok, /Saved: “Video script, final cut”, 9 characters\./);
  const [after] = await docsOf(ctx, id);
  assert.deepEqual([after.title, after.version, after.text, after.createdAt, after.updatedAt], ["Video script, final cut", "final", "New text.", doc.createdAt, "2026-10-25T10:00:00.000Z"]);
  assert.equal((await docsOf(ctx, id)).length, 1, "an edit never creates a second document");
});

test("errors sit under the right field, with what to do and an example; what was typed is not lost", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  const r = await saveDoc(ctx, id, { title: " ", version: "v".repeat(25), text: "t".repeat(60001) });
  assert.match(r.errors.title, /Give the document a title, for example “Video script”/);
  assert.match(r.errors.version, /20 characters at most.*“v2”/);
  assert.match(r.errors.text, /60,000 characters at most.*Split it into two documents/);
  assert.equal((await docsOf(ctx, id)).length, 0, "nothing is stored on error");
  assert.ok((await def.adminActions.saveDoc(ctx, { idea: "nope", id: "", title: "x" })).error, "unknown idea");
  assert.ok((await def.adminActions.saveDoc(ctx, { idea: id, id: "ghost", title: "x" })).error, "unknown document");
});

test("caps: 20 documents per idea, 240 000 characters per idea, 2 000 documents in the notebook, each with a clear message", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  for (let i = 0; i < 4; i++) assert.ok((await saveDoc(ctx, id, { title: `Big ${i}`, text: script(60000) })).ok);
  const big = await saveDoc(ctx, id, { title: "One more", text: "a" });
  assert.match(big.errors.text, /240,000 characters in all/);
  const [first] = (await docsOf(ctx, id)).slice(-1);
  assert.match((await def.adminActions.saveDoc(ctx, { idea: id, id: first.id, title: "Edit", version: "v1", text: script(60000) })).ok, /Saved/, "editing in place stays within the total");
  const ctx2 = ctxFor();
  const id2 = await newIdea(ctx2);
  for (let i = 0; i < 20; i++) assert.ok((await saveDoc(ctx2, id2, { title: `Doc ${i}`, text: "x" })).ok);
  assert.match((await saveDoc(ctx2, id2, { title: "21st" })).errors.title, /20 documents at most/);
  assert.match(html(await panel(ctx2, { idea: id2 })), /20 documents at most/, "the page says it instead of offering a button that fails");
  assert.ok(!/newDoc=1/.test(html(await panel(ctx2, { idea: id2 }))));
  const ctx3 = ctxFor({ rows: { ideaDocs: Array.from({ length: 2000 }, (_, i) => ({ ideaId: `other${i}`, title: "x", version: "", text: "", by: "owner", updatedBy: "owner", createdAt: NOW, updatedAt: NOW })) } });
  const id3 = await newIdea(ctx3);
  assert.match((await saveDoc(ctx3, id3)).errors.title, /2,000 documents at most/);
});

test("new version: a copy under a new label, the old one stays, the copy comes first; labels are checked", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  await saveDoc(ctx, id, { title: "Video script", version: "v1", text: "First draft." });
  const [v1] = await docsOf(ctx, id);
  const f = form(await panel(ctx, { idea: id, versionDoc: v1.id }), "newVersion");
  assert.equal(f.presentation, "dialog");
  assert.equal(f.submitLabel, "Create the new version");
  assert.deepEqual(f.fields.filter((x) => x.kind !== "hidden").map((x) => [x.name, x.value]), [["version", "v2"]], "one visible field, prefilled with the next label");
  ctx.__plannerNow = "2026-10-24T10:00:00Z";
  const r = await def.adminActions.newVersion(ctx, { idea: id, id: v1.id, version: "v2" });
  assert.match(r.ok, /Version v2 created from v1/);
  const docs = await docsOf(ctx, id);
  assert.deepEqual(docs.map((d) => [d.title, d.version, d.text]), [["Video script", "v2", "First draft."], ["Video script", "v1", "First draft."]]);
  assert.notEqual(docs[0].id, docs[1].id);
  assert.match((await def.adminActions.newVersion(ctx, { idea: id, id: v1.id, version: "  " })).errors.version, /Write a name for the new version/);
  assert.match((await def.adminActions.newVersion(ctx, { idea: id, id: v1.id, version: "v".repeat(30) })).errors.version, /20 characters at most/);
  assert.ok((await def.adminActions.newVersion(ctx, { idea: id, id: "ghost", version: "v3" })).error);
  // editing the copy leaves the original untouched
  await def.adminActions.saveDoc(ctx, { idea: id, id: docs[0].id, title: "Video script", version: "v2", text: "Second draft." });
  assert.equal((await docsOf(ctx, id)).find((d) => d.version === "v1").text, "First draft.");
});

test("reading screen: the full text as written (escaped), the chips, the way back, edit and new-version buttons that open their windows", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx, "Camille <b>live</b>");
  await saveDoc(ctx, id, { title: "Script <img src=x onerror=alert(1)>", text: "Line 1\n<script>alert(1)</script>\n& more" });
  const [doc] = await docsOf(ctx, id);
  const blocks = await panel(ctx, { idea: id, col: "doing", doc: doc.id });
  const h = html(blocks);
  assert.match(h, /<pre class="cp-notes cp-doc"[^>]*>Line 1\n&lt;script&gt;alert\(1\)&lt;\/script&gt;\n&amp; more<\/pre>/);
  assert.ok(!/<script>alert|<img src=x|<b>live/.test(h), "nothing the person wrote is ever HTML");
  assert.match(h, /Back to “Camille &lt;b&gt;live&lt;\/b&gt;”/);
  assert.match(h, /<a class="cp-chip"|class="cp-chip">v1</);
  assert.equal(blocks.find((b) => b.type === "heading" && b.text.startsWith("Script")).text, "Script <img src=x onerror=alert(1)>", "headings are text for the core, which escapes them");
  assert.match(h, new RegExp(`href="\\?idea=${id}&amp;col=doing&amp;doc=${doc.id}&amp;editDoc=${doc.id}">Edit the document`));
  assert.match(h, /Start a new version/);
  const edit = form(await panel(ctx, { idea: id, doc: doc.id, editDoc: doc.id }), "saveDoc");
  assert.equal(edit.cancelHref, `?idea=${id}&doc=${doc.id}`, "closing the window returns to the reading screen");
  assert.ok(form(await panel(ctx, { idea: id, doc: doc.id, versionDoc: doc.id }), "newVersion"));
  assert.match(html(await panel(ctx, { idea: id, doc: "ghost" })), /Add a document/, "an unknown document falls back to the idea page");
});

test("deleting one document keeps the idea and the other documents; deleting an idea for good takes its documents with it and its confirmation says so", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx, "To remove");
  const other = await newIdea(ctx, "To keep");
  await saveDoc(ctx, id, { title: "A" });
  await saveDoc(ctx, id, { title: "B" });
  await saveDoc(ctx, other, { title: "Elsewhere" });
  const [b] = await docsOf(ctx, id);
  assert.match((await def.adminActions.deleteDoc(ctx, { id: b.id })).ok, /is deleted for good/, "a row button sends only the id of its row");
  assert.equal((await docsOf(ctx, id)).length, 1);
  assert.equal((await D.getIdea(ctx, id)).title, "To remove");
  assert.ok((await def.adminActions.deleteDoc(ctx, { id: b.id })).error, "already gone");
  assert.ok((await def.adminActions.deleteDoc(ctx, { id: id })).error, "an idea id is never taken for a document id");
  assert.ok((await def.adminActions.deleteDoc(ctx, { id: other, idea: id })).error);
  await def.adminActions.moveIdea(ctx, { id: `${id}~archived` });
  const del = (await panel(ctx, { idea: id })).find((x) => x.type === "table" && x.rowActions?.some((a) => a.action === "deleteIdea"));
  assert.match(del.rowActions[0].confirm, /its 1 documents will be erased/);
  assert.ok((await def.adminActions.deleteIdea(ctx, { id })).ok);
  assert.equal(rows(ctx, "ideaDocs").length, 1, "only the documents of the other idea remain");
  assert.equal((await docsOf(ctx, other)).length, 1);
});

test("the Documents area follows the ergonomics rules of the page kit (R3, R4, R14, R15, R17, R22, R24, R33)", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  await saveDoc(ctx, id);
  await saveDoc(ctx, id, { title: "Shorts", version: "v2", text: "x" });
  const [doc] = await docsOf(ctx, id);
  const isDocsForm = (b) => b.type === "adminForm" && ["saveDoc", "newVersion"].includes(b.action);
  for (const query of [{ newDoc: "1" }, { editDoc: doc.id }, { versionDoc: doc.id }]) {
    const forms = (await panel(ctx, { idea: id, ...query })).filter(isDocsForm);
    assert.equal(forms.length, 1, JSON.stringify(query));
    assert.deepEqual(adminPageErgonomicsProblems(forms, {}), [], JSON.stringify(query));
  }
  const list = (await panel(ctx, { idea: id })).filter((b) => b.type === "table" && b.rowActions?.some((a) => a.action === "deleteDoc"));
  assert.equal(list.length, 1);
  assert.deepEqual(adminPageErgonomicsProblems(list, {}), []);
});

test("French: the whole flow works in French (parity), with a French confirmation and example", async () => {
  const ctx = ctxFor({ locale: "fr" });
  const id = await newIdea(ctx, "La vidéo de Camille");
  const r = await saveDoc(ctx, id, { text: "x".repeat(12345) });
  assert.match(r.ok, /Document ajouté : « Video script », 12\s?345 caractères\./);
  assert.match((await saveDoc(ctx, id, { title: "" })).errors.title, /Donnez un titre au document, par exemple « Script de la vidéo »/);
  const [doc] = await docsOf(ctx, id);
  assert.match(form(await panel(ctx, { idea: id, editDoc: doc.id }), "saveDoc").secondaryAction.confirm, /pour toujours/);
  assert.match((await def.adminActions.newVersion(ctx, { idea: id, id: doc.id, version: "v2" })).ok, /Version v2 créée à partir de v1/);
});

// ── The assistant tools ──────────────────────────────────────────────────────────────────────────────────────

test("idea_get says how many documents an idea holds, without their text", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  assert.equal((await call(ctx, "idea_get", { id })).documentCount, 0);
  await saveDoc(ctx, id, { text: "SECRET-TEXT-OF-THE-SCRIPT" });
  await saveDoc(ctx, id, { title: "Second", version: "v2" });
  const got = await call(ctx, "idea_get", { id });
  assert.equal(got.documentCount, 2);
  assert.ok(!JSON.stringify(got).includes("SECRET-TEXT"), "idea_get never carries a document text");
  assert.ok(!JSON.stringify(await call(ctx, "ideas_list")).includes("SECRET-TEXT"));
  assert.equal((await call(ctx, "idea_update", { id, summary: "ok" })).documentCount, 2);
  assert.equal((await call(ctx, "idea_add", { title: "Fresh" })).documentCount, 0);
  assert.equal(Object.hasOwn(await call(ctx, "idea_move", { id, to: "doing" }), "documentCount"), false, "other tools keep their shape");
  assert.match(manifest.mcp.find((a) => a.name === "idea_get").description, /documentCount.*idea_doc_list/);
});

test("idea_doc_list and idea_doc_get: metadata without text, then the full text; wrong ids give readable errors", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  const other = await newIdea(ctx, "Other idea");
  await saveDoc(ctx, id, { text: script(7000) });
  const [doc] = await docsOf(ctx, id);
  await saveDoc(ctx, other, { title: "Not yours" });
  const [foreign] = await docsOf(ctx, other);
  const list = await call(ctx, "idea_doc_list", { id });
  assert.equal(list.documents.length, 1);
  assert.deepEqual(Object.keys(list.documents[0]).sort(), ["addedBy", "characters", "createdAt", "id", "title", "updatedAt", "version"]);
  assert.equal(list.documents[0].characters, 7000);
  const got = await call(ctx, "idea_doc_get", { id, doc: doc.id });
  assert.equal(got.text, script(7000).trim());
  assert.equal(got.title, "Video script");
  assert.match(await exposed(call(ctx, "idea_doc_list", { id: "ghost" })), /No idea with this id/);
  assert.match(await exposed(call(ctx, "idea_doc_get", { id, doc: "ghost" })), /No document with this id in this idea/);
  assert.match(await exposed(call(ctx, "idea_doc_get", { id, doc: foreign.id })), /No document with this id in this idea/, "a document of another idea is not reachable through this idea");
  assert.match(await exposed(call(ctx, "idea_doc_get", { id, doc: id })), /No document with this id/, "an idea id is not a document id");
  assert.match(await exposed(call(ctx, "idea_doc_get", { id: doc.id, doc: doc.id })), /No idea with this id/, "a document id is not an idea id");
});

test("idea_doc_add: title required, version v1 by default, written by the assistant, caps and validation with readable errors", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  const made = await call(ctx, "idea_doc_add", { id, title: "  Script of the long video  ", text: script(7000) });
  assert.equal(made.version, "v1");
  assert.equal(made.title, "Script of the long video");
  assert.equal(made.addedBy, "assistant");
  assert.equal(made.characters, 7000);
  assert.equal((await docsOf(ctx, id))[0].by, "assistant");
  assert.equal((await call(ctx, "idea_doc_add", { id, title: "Shorts", version: "v2", text: "x" })).version, "v2");
  assert.match(await exposed(call(ctx, "idea_doc_add", { id, title: "   " })), /title is required/);
  assert.match(await exposed(call(ctx, "idea_doc_add", { id, title: "ok", text: "t".repeat(60001) })), /60000 characters at most.*Split it/);
  await assert.rejects(async () => call(ctx, "idea_doc_add", { id, title: "ok", version: "v".repeat(21) }), /at most 20 characters/, "the schema stops it first");
  await assert.rejects(async () => call(ctx, "idea_doc_add", { id }), /title/, "the schema requires a title");
  await assert.rejects(async () => call(ctx, "idea_doc_add", { id, title: "x", extra: 1 }), "an argument outside the schema is refused");
  assert.match(await exposed(call(ctx, "idea_doc_add", { id: "ghost", title: "x" })), /No idea with this id/);
  for (let i = 0; i < 4; i++) await call(ctx, "idea_doc_add", { id: await newIdea(ctx, `Spare ${i}`), title: "x" }); // other ideas are not counted in this idea's cap
  const full = await newIdea(ctx, "Full idea");
  for (let i = 0; i < 20; i++) await call(ctx, "idea_doc_add", { id: full, title: `D${i}`, text: "x" });
  assert.match(await exposed(call(ctx, "idea_doc_add", { id: full, title: "21st" })), /20 documents at most.*delete one/);
  const heavy = await newIdea(ctx, "Heavy idea");
  for (let i = 0; i < 4; i++) await call(ctx, "idea_doc_add", { id: heavy, title: `H${i}`, text: script(60000) });
  assert.match(await exposed(call(ctx, "idea_doc_add", { id: heavy, title: "More", text: "x" })), /240000 characters in all/);
});

test("idea_doc_update: changes only what is sent, replaces it, checks the same limits, says so when nothing is sent", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  await saveDoc(ctx, id, { text: "Original text." });
  const [doc] = await docsOf(ctx, id);
  ctx.__plannerNow = "2026-10-26T09:00:00Z";
  const up = await call(ctx, "idea_doc_update", { id, doc: doc.id, version: "final" });
  assert.deepEqual([up.title, up.version, up.text, up.updatedAt], ["Video script", "final", "Original text.", "2026-10-26T09:00:00.000Z"]);
  const up2 = await call(ctx, "idea_doc_update", { id, doc: doc.id, text: "Rewritten.", title: "Script, final" });
  assert.deepEqual([up2.title, up2.version, up2.text], ["Script, final", "final", "Rewritten."]);
  const stored = (await docsOf(ctx, id))[0];
  assert.equal(stored.createdAt, doc.createdAt);
  assert.equal(stored.by, "owner", "the creator stays the creator");
  assert.equal(stored.updatedBy, "assistant");
  assert.match(html(await panel(ctx, { idea: id, doc: doc.id })), /Last changed by the AI assistant/);
  assert.match(await exposed(call(ctx, "idea_doc_update", { id, doc: doc.id })), /Nothing to change/);
  assert.match(await exposed(call(ctx, "idea_doc_update", { id, doc: doc.id, title: " " })), /title is required/);
  assert.match(await exposed(call(ctx, "idea_doc_update", { id, doc: doc.id, text: "t".repeat(60001) })), /too long/);
  assert.match(await exposed(call(ctx, "idea_doc_update", { id, doc: "ghost", text: "x" })), /No document with this id/);
  assert.equal((await docsOf(ctx, id))[0].text, "Rewritten.", "a refused update changes nothing");
  assert.equal((await docsOf(ctx, id)).length, 1, "an update never creates a document");
});

test("idea_doc_update respects the total size of the idea; a shorter text always fits", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  for (let i = 0; i < 4; i++) await call(ctx, "idea_doc_add", { id, title: `H${i}`, text: script(60000) });
  const [d] = await docsOf(ctx, id);
  assert.equal((await call(ctx, "idea_doc_update", { id, doc: d.id, text: script(59000) })).characters, 59000);
  await call(ctx, "idea_doc_update", { id, doc: d.id, text: "short" });
  await call(ctx, "idea_doc_add", { id, title: "Fits now", text: script(59000) });
  assert.match(await exposed(call(ctx, "idea_doc_update", { id, doc: d.id, text: script(60000) })), /in all, at most/);
});

test("the tools write only in the documents collection and the ideas collection, and read nothing else", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  await call(ctx, "idea_doc_add", { id, title: "x" });
  await call(ctx, "idea_doc_list", { id });
  assert.deepEqual([ctx.calls.net, ctx.calls.services, ctx.calls.topics, ctx.calls.mail, ctx.calls.entries, ctx.calls.denied], [[], [], [], [], [], []]);
  assert.ok(ctx.calls.writes.every((w) => ["ideas", "ideaDocs"].includes(w.collection)));
});

// ── The files ────────────────────────────────────────────────────────────────────────────────────────────────

test("the documents file: the ideas file keeps its shape; the documents have a file of their own, one row per part of 30 000 characters at most", async () => {
  const ctx = ctxFor({ locale: "en" });
  const id = await newIdea(ctx, "Camille's long video");
  await saveDoc(ctx, id, { title: "Script", version: "v2", text: script(60000) });
  await saveDoc(ctx, id, { title: "Shorts", version: "v1", text: "- starts with a dash\n=SUM(A1)" });
  const out = [];
  for await (const chunk of E.exportDocsCsv(ctx)) out.push(chunk);
  const csv = out.join("");
  assert.ok(csv.startsWith("﻿\"Idea\",\"Document\",\"Version\",\"Characters\",\"Edited on\",\"Part\",\"Text\"\r\n"));
  const lines = csv.split("\r\n").filter((l) => l.startsWith("\"Camille"));
  assert.equal(lines.length, 3, "two parts for the long script, one row for the shorts");
  assert.ok(lines.some((l) => l.includes("\"1/2\"")) && lines.some((l) => l.includes("\"2/2\"")) && lines.some((l) => l.includes("\"1/1\"")));
  for (const row of E.docRows(ctx, { title: "T", version: "v", text: script(60000), updatedAt: NOW }, "I")) assert.ok(row[6].length <= 30000 && row[6].length <= 32767, "under the 32 767 characters of a spreadsheet cell");
  assert.equal(E.docRows(ctx, { title: "T", version: "v", text: script(60000), updatedAt: NOW }, "I").map((r) => r[6]).join(""), script(60000), "no character is lost in the parts");
  assert.ok(csv.includes("'=SUM(A1)") || csv.includes("'- starts"), "a cell is never read as a formula");
  assert.equal(E.headerCells(ctx).length, 10, "the ideas file is unchanged");
  const fr = ctxFor({ locale: "fr" });
  assert.equal(E.delimiterFor(fr), ";");
  const outFr = []; for await (const chunk of E.exportDocsCsv(fr)) outFr.push(chunk);
  assert.ok(outFr[0].includes("\"Idée\";\"Document\";\"Version\""));
  assert.equal(E.docRows(ctx, { title: "T", version: "", text: "", updatedAt: NOW }, "I").length, 1, "a document without text still has its row");
  assert.equal(E.docRows(ctx, { title: "T", version: "", text: "😀".repeat(20000), updatedAt: NOW }, "I").every((r) => !/[\ud800-\udbff]$/.test(r[6])), true, "never an emoji cut in two");
});

test("the download is declared with the same right as the ideas file and is offered once there is a document", async () => {
  assert.equal(def.adminDownloads.documents.right, "ideas.export");
  assert.equal(def.adminDownloads.documents.contentType, "text/csv");
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  assert.ok(!(await panel(ctx, {})).some((b) => b.type === "download" && b.name === "documents"));
  await saveDoc(ctx, id);
  const dl = (await panel(ctx, {})).find((b) => b.type === "download" && b.name === "documents");
  assert.equal(dl.label, "Download my documents (CSV)");
  assert.match(def.adminDownloads.documents.filename(ctx), /^content-notebook-documents-2026-10-22$/);
  assert.ok(manifest.rights.find((r) => r.id === "ideas.export").help.en.includes("document"));
});

test("the readable backup adds documents.csv and documents.md, readable without Curiosa, with every document in full", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx, "Etoile_nord video");
  await saveDoc(ctx, id, { title: "Script", version: "v1", text: "Welcome to the channel.\nSecond line." });
  ctx.__plannerNow = "2026-10-23T10:00:00Z";
  await saveDoc(ctx, id, { title: "Script", version: "v2", text: "Welcome back to the channel." });
  const files = await def.backup.readable(ctx);
  assert.deepEqual(files.map((f) => f.path), ["ideas.csv", "ideas.md", "documents.csv", "documents.md"]);
  const md = files.find((f) => f.path === "documents.md").content;
  assert.match(md, /^# Documents of the content notebook/);
  assert.match(md, /## Etoile_nord video/);
  assert.ok(md.indexOf("### Script (v2)") < md.indexOf("### Script (v1)"), "most recently edited first");
  assert.ok(md.includes("Welcome to the channel.\nSecond line."), "the text as written, line breaks kept");
  const csv = files.find((f) => f.path === "documents.csv").content;
  assert.ok(csv.includes("\"Etoile_nord video\"") && csv.includes("Welcome back to the channel."));
  assert.equal(files.find((f) => f.path === "ideas.csv").content.includes("Welcome"), false, "ideas.csv does not carry the documents");
  for (const f of files) assert.ok(f.content.length < 5 * 1024 * 1024, `${f.path} stays under the 5 MB limit of a backup file`);
});

test("the readable backup stays under 5 MB whatever the notebook holds, and says when the text was cut", async () => {
  const docs = Array.from({ length: 120 }, (_, i) => ({ ideaId: `i${i}`, title: `Doc ${i}`, version: "v1", text: script(60000), by: "owner", updatedBy: "owner", createdAt: NOW, updatedAt: NOW }));
  const ctx = ctxFor({ rows: { ideaDocs: docs, ideas: docs.map((_, i) => ({ ...legacyIdea, title: `Idea ${i}` })) } });
  const files = await def.backup.readable(ctx);
  for (const f of files) assert.ok(f.content.length <= 5 * 1024 * 1024, `${f.path}: ${f.content.length}`);
  assert.match(files.find((f) => f.path === "documents.md").content, /The rest was cut.*documents CSV download/);
  let total = 0;
  for await (const chunk of E.exportDocsCsv(ctx)) total += chunk.length;
  assert.ok(total > 7_000_000, "the download, which is streamed, holds every document");
});

// ── Privacy ──────────────────────────────────────────────────────────────────────────────────────────────────

test("PRIVATE: nothing of the documents is public: no page, route, section, topic, service, overlay, task or network call", async () => {
  for (const k of ["page", "routes", "sections", "slots", "exports", "overlay", "services", "filters", "tasks", "news"]) assert.equal(def[k], undefined, `the code must not define “${k}”`);
  for (const k of ["sections", "provides", "consumes", "offers", "requires", "basePath", "content", "routes", "overlayElements"]) assert.ok(manifest[k] === undefined || (Array.isArray(manifest[k]) && manifest[k].length === 0), `module.json must not declare “${k}”`);
  assert.equal(manifest.page, false);
  assert.ok(!manifest.permissions.some((p) => ["routes", "pages", "sections", "slots", "overlay", "topics", "mail", "filters", "net"].includes(p)));
  const sources = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => [f, fs.readFileSync(`${DIR}/${f}`, "utf8")]);
  for (const [f, src] of sources) assert.ok(!/\bfetch\s*\(|ctx\.api\.net|ctx\.api\.services|ctx\.api\.topics|ctx\.api\.entries|ctx\.api\.mail|setInterval|setTimeout|ctx\.api\.seo|ctx\.api\.overlay|ctx\.overlay/.test(src), `${f}: nothing leaves the notebook`);
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  await saveDoc(ctx, id, { text: "PRIVATE-SCRIPT-TEXT" });
  const [doc] = await docsOf(ctx, id);
  await panel(ctx, { idea: id });
  await panel(ctx, { idea: id, doc: doc.id });
  await call(ctx, "idea_doc_get", { id, doc: doc.id });
  await def.backup.readable(ctx);
  assert.deepEqual([ctx.calls.net, ctx.calls.services, ctx.calls.topics, ctx.calls.mail, ctx.calls.entries, ctx.calls.denied], [[], [], [], [], [], []]);
  assert.ok(ctx.calls.writes.every((w) => ["ideas", "ideaDocs"].includes(w.collection)));
});

test("PRIVATE: no other module of the repository reads or names the documents collection", () => {
  for (const d of fs.readdirSync(path.join(ROOT, "modules"))) {
    if (d === "content-planner") continue;
    const dir = path.join(ROOT, "modules", d);
    for (const f of fs.readdirSync(dir, { recursive: true }).map(String).filter((x) => /\.(mjs|json)$/.test(x))) assert.ok(!fs.readFileSync(path.join(dir, f), "utf8").includes("ideaDocs"), `${d}/${f}`);
  }
  const rights = manifest.rights.map((r) => r.id);
  assert.deepEqual(rights, ["ideas.export"], "no new right: the files follow the right of the ideas file");
});

test("a row of another shape in the documents collection is never taken for a document, and a document row never for an idea", async () => {
  const ctx = ctxFor();
  const id = await newIdea(ctx);
  const junk = await ctx.api.store.add("ideaDocs", { hello: "world" }, { key: id });
  const wrong = await ctx.api.store.add("ideaDocs", { ideaId: "someone-else", title: "x", text: "y" }, { key: id });
  await saveDoc(ctx, id);
  assert.deepEqual((await docsOf(ctx, id)).map((d) => d.title), ["Video script"]);
  assert.equal(await X.getDoc(ctx, id, junk), null);
  assert.equal(await X.getDoc(ctx, id, wrong), null);
  const [doc] = await docsOf(ctx, id);
  assert.equal(await D.getIdea(ctx, doc.id), null, "a document row is not an idea");
  assert.deepEqual((await D.loadAll(ctx)).map((i) => i.id), [id]);
  const damaged = await ctx.api.store.add("ideaDocs", { ideaId: id, title: 42, text: "kept", version: { a: 1 }, createdAt: "nope" }, { key: id });
  assert.ok(!(await docsOf(ctx, id)).some((d) => d.id === damaged), "a row with a damaged title is ignored, never an error");
});
