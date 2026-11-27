// Partnerships: partner files and their journal: fields, cleaning, CSV import, storage reads. No notion of a person here.
export const STATUSES = ["a_contacter", "envoye", "discussion", "accepte", "publie", "refuse_marque", "decline", "sans_reponse", "termine"];
export const CLOSED = new Set(["refuse_marque", "decline", "sans_reponse", "termine"]);
export const DAY = 86_400_000;

// Error readable by the MCP agent (other errors are masked: never an internal detail).
export const fail = (message) => Object.assign(new Error(message), { expose: true });
export const clip = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const today = () => new Date().toISOString().slice(0, 10);
export const validDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? v : today());
export const safeUrl = (v) => (/^https?:\/\//i.test(String(v ?? "").trim()) ? String(v).trim().slice(0, 500) : "");

export const PARTNER_FIELDS = { brand: 120, status: 30, url: 500, sector: 120, country: 80, contact: 500, brief: 10000, mail: 10000, source: 500, products: 3000, benefits: 3000, logo: 500, articleId: 80 };

/** Keeps only the known fields, cleaned (never HTML or an unexpected field in the file). */
export function cleanPartner(input, previous = {}) {
  const out = { ...previous };
  for (const [key, max] of Object.entries(PARTNER_FIELDS)) {
    if (input[key] === undefined) continue;
    out[key] = key === "url" || key === "logo" ? safeUrlOrUpload(input[key]) : clip(String(input[key]), max);
  }
  if (input.status !== undefined && !STATUSES.includes(out.status)) out.status = previous.status ?? "a_contacter";
  if (input.chances !== undefined) {
    const n = Number(input.chances);
    out.chances = input.chances === "" || !Number.isFinite(n) ? null : Math.min(100, Math.max(0, Math.round(n)));
  }
  return out;
}
export const safeUrlOrUpload = (v) => (String(v ?? "").startsWith("/uploads/") ? String(v).slice(0, 200) : safeUrl(v));

/** Minimal CSV (RFC 4180): "," or ";" separator detected on the header, doubled quotes, line breaks inside quotes. */
export function parseCsv(text) {
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (first.match(/;/g) ?? []).length > (first.match(/,/g) ?? []).length ? ";" : ",";
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
    else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export const IMPORT_MAX_ROWS = 500;
/** Bulk import: one partner per line (`brand` column required). Re-runnable: a brand already known is only COMPLETED (empty fields), never overwritten. */
export async function importPartners(ctx, text) {
  const table = parseCsv(String(text ?? "").slice(0, 1_000_000));
  if (table.length < 2) return { created: 0, completed: 0, skipped: 0, error: "empty" };
  const header = table[0].map((h) => h.trim().toLowerCase());
  if (!header.includes("brand")) return { created: 0, completed: 0, skipped: 0, error: "noBrand" };
  const known = new Map((await ctx.api.store.list("partners", { limit: 1000 })).map((r) => [String(r.data.brand).trim().toLowerCase(), r]));
  let created = 0, completed = 0, skipped = 0;
  for (const cells of table.slice(1, IMPORT_MAX_ROWS + 1)) {
    const input = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]).filter(([h]) => h === "brand" || h in PARTNER_FIELDS || h === "chances"));
    const brand = clip(input.brand ?? "", 120);
    if (!brand) { skipped++; continue; }
    const existing = known.get(brand.toLowerCase());
    if (!existing) {
      const data = cleanPartner({ ...input, brand, status: input.status || "a_contacter" });
      const id = await ctx.api.store.add("partners", { ...data, updatedBy: "import" });
      known.set(brand.toLowerCase(), { id, data });
      created++;
    } else {
      const fill = Object.fromEntries(Object.entries(input).filter(([k, v]) => k !== "brand" && String(v).trim() !== "" && (existing.data[k] === undefined || existing.data[k] === "" || existing.data[k] === null)));
      const next = cleanPartner(fill, existing.data);
      if (JSON.stringify(next) !== JSON.stringify(existing.data)) { await ctx.api.store.update(existing.id, { ...next, updatedBy: "import" }); completed++; } else skipped++;
    }
  }
  return { created, completed, skipped: skipped + Math.max(0, table.length - 1 - IMPORT_MAX_ROWS) };
}

export async function all(ctx, collection) {
  return ctx.api.store.list(collection, { limit: 1000 });
}

/** A whole collection, read by pages (never in one block): oldest first, 20,000 rows at most. */
export async function readAll(ctx, collection, cap = 20_000) {
  const out = [];
  if (typeof ctx.api.store.page !== "function") return (await ctx.api.store.list(collection, { limit: 1000 })).slice().reverse();
  let cursor;
  do {
    const r = await ctx.api.store.page(collection, { limit: 1000, order: "asc", cursor });
    out.push(...r.items);
    cursor = r.next;
  } while (cursor && out.length < cap);
  return out;
}

export function lastActivity(partner, journal) {
  const dates = journal.filter((j) => j.data.partnerId === partner.id).map((j) => Date.parse(j.data.date)).filter(Number.isFinite);
  return dates.length ? Math.max(...dates) : partner.createdAt.getTime();
}
export function followUpDue(ctx, partner, journal) {
  const days = Number(ctx.setting("followUpDays")) || 14;
  return partner.data.status === "envoye" && Date.now() - lastActivity(partner, journal) > days * DAY;
}
export const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);


/**
 * Deletes a partner file and its journal entries. The people linked to the file live in the Contacts module and are NEVER touched: only the reference (`contactIds`)
 * goes away with the file. Returns what was removed, or `null` when `id` is not a partner file (another collection's row, unknown id): nothing is deleted then.
 */
export async function deletePartnerRecord(ctx, id) {
  const row = typeof id === "string" && id.length > 0 && id.length <= 80 ? await ctx.api.store.get(id) : null;
  if (!row || row.data?.brand === undefined) return null;
  const entries = (await readAll(ctx, "journal")).filter((j) => j.data.partnerId === id);
  const contacts = Array.isArray(row.data.contactIds) ? new Set(row.data.contactIds).size : 0;
  for (const j of entries) await ctx.api.store.remove(j.id);
  await ctx.api.store.remove(id);
  // One line in the core log, counts only (never the brand, a note or a person).
  try { await ctx.api.log?.write?.({ action: "partner.deleted", data: { journal: entries.length, contacts } }); } catch { /* the log is a bonus */ }
  return { brand: row.data.brand, journal: entries.length, contacts };
}

/** What a deletion would remove, for the confirmation window (counts only, no write). */
export async function deletionPreview(ctx, row) {
  const journal = (await readAll(ctx, "journal")).filter((j) => j.data.partnerId === row.id).length;
  const contacts = Array.isArray(row.data.contactIds) ? new Set(row.data.contactIds).size : 0;
  return { journal, contacts };
}


// ── Public articles ────────────────────────────────────────────────────────────────────────────
// The public articles of the owner live in a content module of the site (by default the instance "sponsoring"), not here. This module only READS the published
// ones (`ctx.api.entries.list`, 200 at most; drafts are never visible to a module) and keeps, on a file, the id of its article (`articleId`). Nothing is written
// to the article, and a file is never created behind the owner's back: an article without a file is a row of the overview with "Add the file".
export const ARTICLES_KEY = "sponsoring";
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** `{ key, items }` (published articles, newest first) when the articles module exists on this site, else `null` (no article column then). Never throws. */
export async function loadArticles(ctx) {
  const key = clip(ctx.setting?.("articlesKey"), 60) || ARTICLES_KEY;
  try {
    if (typeof ctx.api.entries?.list !== "function") return null;
    const known = typeof ctx.api.instances?.list === "function" ? (await ctx.api.instances.list()).some((i) => i.key === key) : undefined;
    if (known === false) return null;
    const items = (await ctx.api.entries.list({ instance: key, limit: 200 })).filter((e) => e && typeof e.id === "string" && e.title);
    if (known === undefined && !items.length) return null;
    return { key, items };
  } catch { return null; }
}

/**
 * Pairs the files with the published articles. A file keeps its own article (`articleId`); a file without one is paired with the article that carries its brand as the whole
 * title or as a whole word of the title (3 letters at least), each article once. `orphans` are the published articles no file stands for.
 */
export function pairArticles(partners, articles) {
  const byFile = new Map();
  if (!articles) return { byFile, orphans: [] };
  const free = new Map(articles.items.map((a) => [a.id, a]));
  for (const p of partners) { const a = free.get(p.data.articleId); if (a) { byFile.set(p.id, a); free.delete(a.id); } }
  for (const p of partners) {
    if (byFile.has(p.id) || p.data.articleId) continue;
    const brand = fold(p.data.brand);
    if (brand.length < 3) continue;
    const hit = [...free.values()].find((a) => { const t = fold(a.title); return t === brand || ` ${t} `.includes(` ${brand} `); });
    if (hit) { byFile.set(p.id, hit); free.delete(hit.id); }
  }
  return { byFile, orphans: [...free.values()] };
}
