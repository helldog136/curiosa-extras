// Content notebook: the documents kept inside an idea (the script of a video, an outline, a checklist), each with a version label ("v1", "v2", "final").
//
// Storage: one row per document in the collection "ideaDocs" of the instance, with the idea id as the row key (so the documents of an idea are read with
// `store.listByKey`, never by walking the whole collection). The idea rows are never touched: an idea written by 1.1.3 has no document and loads exactly as before.
// Limits ("permanent zoom-out"): a document holds 60 000 characters at most (about 10 000 words, a spoken hour: a long video script plus its shorts fit many times
// over), an idea holds 20 documents and 240 000 characters in all (four documents of the maximum size, or about thirty scripts of 7 000 characters), and the whole
// notebook holds 2 000 documents. Everything is computed when read: no background task, no timer.
const v = new URL(import.meta.url).search; // the module version travels to the sibling files
const D = await import(`./data.mjs${v}`);

export const COLLECTION = "ideaDocs";
export const DOC_LIMITS = { title: 120, version: 20, text: 60_000 };
export const MAX_DOCS_PER_IDEA = 20;
export const MAX_CHARS_PER_IDEA = 240_000;
export const MAX_DOCS_TOTAL = 2000;
export const DEFAULT_VERSION = "v1";

// ── Cleaning ──────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Checks the three fields typed by a person or sent by the assistant. Nothing is cut silently: a field that is too long is a problem to report.
 * Returns `{ values: { title, version, text }, problems: [{ field, code, max? }] }`; `fields` may hold only some of the three (an update).
 */
export function check(fields, { requireTitle = true } = {}) {
  const problems = [];
  const values = {};
  if (fields.title !== undefined || requireTitle) {
    const raw = String(fields.title ?? "").replace(/\s+/g, " ").trim();
    if (!raw) problems.push({ field: "title", code: "titleEmpty" });
    else if (raw.length > DOC_LIMITS.title) problems.push({ field: "title", code: "titleLong", max: DOC_LIMITS.title });
    else values.title = D.line(raw, DOC_LIMITS.title);
  }
  if (fields.version !== undefined) {
    const raw = String(fields.version ?? "").replace(/\s+/g, " ").trim();
    if (raw.length > DOC_LIMITS.version) problems.push({ field: "version", code: "versionLong", max: DOC_LIMITS.version });
    else values.version = D.line(raw, DOC_LIMITS.version);
  }
  if (fields.text !== undefined) {
    const raw = String(fields.text ?? "");
    if (raw.trim().length > DOC_LIMITS.text) problems.push({ field: "text", code: "textLong", max: DOC_LIMITS.text });
    else values.text = D.para(raw, DOC_LIMITS.text);
  }
  return { values, problems };
}

/** The label of the next version: "v1" gives "v2", "draft 3" gives "draft 4", "final" gives "final 2". Always short enough to be a valid version. */
export function nextVersion(label) {
  const s = D.line(label, DOC_LIMITS.version);
  if (!s) return "v2";
  const m = /^(.*?)(\d{1,6})$/.exec(s);
  const next = m ? `${m[1]}${Number(m[2]) + 1}` : `${s} 2`;
  return next.length <= DOC_LIMITS.version ? next : D.line(next.slice(-DOC_LIMITS.version), DOC_LIMITS.version);
}

// ── A document as the rest of the module reads it ────────────────────────────────────────────────────────────
const isDocRow = (row) => !!row?.data && typeof row.data === "object" && typeof row.data.ideaId === "string" && typeof row.data.title === "string" && "text" in row.data && !("column" in row.data);

/** Reads a stored row without ever throwing: every damaged field becomes a safe value. */
export function normalizeDoc(row) {
  const d = row?.data && typeof row.data === "object" ? row.data : {};
  const created = D.isoOrEmpty(d.createdAt) || D.isoOrEmpty(row?.createdAt instanceof Date ? row.createdAt.toISOString() : row?.createdAt);
  return {
    id: String(row?.id ?? ""),
    ideaId: String(d.ideaId ?? ""),
    title: D.line(d.title, DOC_LIMITS.title),
    version: D.line(d.version, DOC_LIMITS.version),
    text: D.para(d.text, DOC_LIMITS.text),
    by: d.by === "assistant" ? "assistant" : "owner",
    updatedBy: d.updatedBy === "assistant" ? "assistant" : "owner",
    createdAt: created,
    updatedAt: D.isoOrEmpty(d.updatedAt) || created,
  };
}
/** What is stored (without the id). */
export const toRow = (d) => ({ ideaId: d.ideaId, title: d.title, version: d.version, text: d.text, by: d.by, updatedBy: d.updatedBy, createdAt: d.createdAt, updatedAt: d.updatedAt });
/** Most recently edited first. */
export const compareDocs = (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
export const totalChars = (docs) => docs.reduce((n, d) => n + d.text.length, 0);

// ── Reading and writing ──────────────────────────────────────────────────────────────────────────────────────
/** The documents of one idea, most recently edited first (20 at most; a row beyond the cap, which only an outside change could create, is ignored). */
export async function docsOf(ctx, ideaId) {
  if (!D.idOk(ideaId)) return [];
  const page = await ctx.api.store.listByKey(COLLECTION, ideaId, { limit: MAX_DOCS_PER_IDEA * 2 });
  return (page?.items ?? []).filter((r) => isDocRow(r) && r.data.ideaId === ideaId).map(normalizeDoc).sort(compareDocs).slice(0, MAX_DOCS_PER_IDEA);
}
/** One document; `ideaId` null looks it up by its own id alone (a row button only sends the id of its row). */
export async function getDoc(ctx, ideaId, docId) {
  if (!D.idOk(docId) || (ideaId !== null && !D.idOk(ideaId))) return null;
  const row = await ctx.api.store.get(docId);
  return isDocRow(row) && (ideaId === null || row.data.ideaId === ideaId) ? normalizeDoc(row) : null;
}
/** Why one more document (or a longer text) is refused, or null: "full" (the notebook), "tooMany" (the idea), "tooBig" (the idea, in characters). */
export async function capProblem(ctx, docs, { adding, replacing = null, textLength }) {
  if (adding && docs.length >= MAX_DOCS_PER_IDEA) return "tooMany";
  if (adding && (await ctx.api.store.count(COLLECTION)) >= MAX_DOCS_TOTAL) return "full";
  const others = totalChars(docs.filter((d) => d.id !== replacing));
  return others + textLength > MAX_CHARS_PER_IDEA ? "tooBig" : null;
}
/** Adds a document (`fields` already checked). */
export async function addDoc(ctx, ideaId, { title, version, text }, { by = "owner" } = {}) {
  const now = D.nowOf(ctx).toISOString();
  const doc = { id: "", ideaId, title, version, text, by, updatedBy: by, createdAt: now, updatedAt: now };
  doc.id = await ctx.api.store.add(COLLECTION, toRow(doc), { key: ideaId });
  return doc;
}
/** Saves a changed document; null when it disappeared meanwhile. */
export async function saveDoc(ctx, doc, { by = "owner" } = {}) {
  const next = { ...doc, updatedBy: by, updatedAt: D.nowOf(ctx).toISOString() };
  return (await ctx.api.store.update(doc.id, toRow(next))) ? next : null;
}
export async function removeDoc(ctx, doc) { await ctx.api.store.remove(doc.id); }
/** Removes every document of an idea (used when the idea itself is deleted for good). */
export async function removeDocsOf(ctx, ideaId) {
  for (let n = 0; n < 5; n++) {
    const page = await ctx.api.store.listByKey(COLLECTION, ideaId, { limit: 100 });
    const rows = (page?.items ?? []).filter(isDocRow);
    if (!rows.length) return;
    for (const r of rows) await ctx.api.store.remove(r.id);
  }
}

/** Every document of the notebook, one page at a time (for the files): `{ docs }` pages of 50, in storage order (newest first). */
export async function* docPages(ctx) {
  let cursor = null;
  for (let n = 0; n < 60; n++) {
    const p = await ctx.api.store.page(COLLECTION, { limit: 50, cursor });
    const docs = (p?.items ?? []).filter(isDocRow).map(normalizeDoc);
    if (docs.length) yield docs;
    cursor = p?.next ?? null;
    if (!cursor) return;
  }
}
