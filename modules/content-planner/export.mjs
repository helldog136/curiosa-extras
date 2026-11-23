// Content notebook: the CSV export (served by the core, as it goes) and the readable backup (a CSV table and a text read without installing anything).
// Nothing is ever built whole for the download: 500 ideas are read at a time (50 documents for the documents file). The notebook cap (1,000 ideas) also bounds the files.
const v = new URL(import.meta.url).search; // the module version travels to the sibling files
const D = await import(`./data.mjs${v}`);
const X = await import(`./documents.mjs${v}`);

const BOM = "\ufeff";
const MAX_TEXT = 4_500_000; // under the 5 MB limit of a backup file
const lang = (ctx) => (String(ctx.locale ?? "").startsWith("fr") ? "fr" : "en");
/** Excel in French expects semicolons; elsewhere, commas. */
export const delimiterFor = (ctx) => (lang(ctx) === "fr" ? ";" : ",");

export const headerCells = (ctx) => ["csvTitle", "csvSummary", "csvPlace", "csvStepsDone", "csvSteps", "csvTarget", "csvPublished", "csvNetworks", "csvNotes", "csvCreated"].map((k) => ctx.t(k));
export function rowCells(ctx, i) {
  return [
    i.title, i.summary, ctx.t(`place_${D.placeOf(i)}`), `${D.stepsDone(i)}/${i.steps.length}`,
    i.steps.map((s) => `${s.done ? "[x]" : "[ ]"} ${s.label}`).join(" | "),
    i.targetDate, i.publishedAt, i.networks.join(" | "), i.notes, i.createdAt.slice(0, 10),
  ];
}

/** The ideas, a page of 500 at a time (newest first). */
async function* pages(ctx) {
  let cursor = null;
  for (let n = 0; n < 6; n++) {
    const p = await ctx.api.store.page("ideas", { limit: 500, cursor });
    const items = (p?.items ?? []).filter((r) => r?.data && typeof r.data.title === "string").map(D.normalize);
    if (items.length) yield items;
    cursor = p?.next ?? null;
    if (!cursor) return;
  }
}

export async function* exportCsv(ctx) {
  const d = delimiterFor(ctx);
  yield BOM + D.csvLine(headerCells(ctx), d);
  for await (const items of pages(ctx)) for (const i of items) yield D.csvLine(rowCells(ctx, i), d);
}

// ── The documents: a file of their own, so that the ideas file keeps exactly its shape for the people who import it ──────────────────────────
// A spreadsheet cell holds 32 767 characters at most and a document up to 60 000: a long text is cut into parts of 30 000 characters at most, one row per part
// (columns "Part": 1/2, 2/2), so no text is ever lost when the file is opened.
export const PART_SIZE = 30_000;
export const docHeaderCells = (ctx) => ["csvDocIdea", "csvDocTitle", "csvDocVersion", "csvDocChars", "csvDocEdited", "csvDocPart", "csvDocText"].map((k) => ctx.t(k));
/** The rows of one document (one per part of at most PART_SIZE characters; a document without text still has one row). */
export function docRows(ctx, doc, ideaTitle) {
  const parts = [];
  for (let at = 0; at < doc.text.length;) {
    let end = Math.min(doc.text.length, at + PART_SIZE);
    if (end < doc.text.length && /[\ud800-\udbff]/.test(doc.text[end - 1])) end--; // never cut an emoji in two
    parts.push(doc.text.slice(at, end));
    at = end;
  }
  if (!parts.length) parts.push("");
  return parts.map((text, i) => [ideaTitle, doc.title, doc.version, String(doc.text.length), doc.updatedAt.slice(0, 10), `${i + 1}/${parts.length}`, text]);
}
const ideaTitles = async (ctx) => new Map((await D.loadAll(ctx)).map((i) => [i.id, i.title || ctx.t("untitled")]));

export async function* exportDocsCsv(ctx) {
  const d = delimiterFor(ctx);
  const titles = await ideaTitles(ctx);
  yield BOM + D.csvLine(docHeaderCells(ctx), d);
  for await (const docs of X.docPages(ctx)) for (const doc of docs) for (const row of docRows(ctx, doc, titles.get(doc.ideaId) ?? ctx.t("untitled"))) yield D.csvLine(row, d);
}

export const downloads = {
  ideas: {
    right: "ideas.export",
    contentType: "text/csv",
    filename: (ctx) => `${ctx.t("csvFile")}-${D.todayOf(ctx)}`,
    generate: (ctx) => exportCsv(ctx),
  },
  documents: {
    right: "ideas.export",
    contentType: "text/csv",
    filename: (ctx) => `${ctx.t("csvDocsFile")}-${D.todayOf(ctx)}`,
    generate: (ctx) => exportDocsCsv(ctx),
  },
};

/** The documents as readable text: one section per idea, one block per document (most recently edited first), the text as it was written. */
export function readableDocs(ctx, docs, titles) {
  const byIdea = new Map();
  for (const doc of docs) byIdea.set(doc.ideaId, [...(byIdea.get(doc.ideaId) ?? []), doc]);
  const out = [`# ${ctx.t("mdDocsTitle")}`, ""];
  let size = 0;
  for (const [ideaId, list] of [...byIdea].sort((a, b) => String(titles.get(a[0])).localeCompare(String(titles.get(b[0]))))) {
    out.push(`## ${titles.get(ideaId) ?? ctx.t("untitled")}`, "");
    for (const doc of [...list].sort(X.compareDocs)) {
      const head = `### ${doc.title || ctx.t("untitled")}${doc.version ? ` (${doc.version})` : ""}`;
      const block = [head, "", `${ctx.t("csvDocEdited")} : ${doc.updatedAt.slice(0, 10)}`, "", doc.text, ""].join("\n");
      size += block.length;
      if (size > MAX_TEXT) { out.push(`*${ctx.t("mdDocsCut")}*`, ""); return out.join("\n"); }
      out.push(block);
    }
  }
  return out.join("\n");
}

/** The notebook as readable text: a heading per place, a section per idea, the steps as check boxes. */
export function readableText(ctx, ideas) {
  const sorted = [...ideas].sort(D.compare);
  const out = [`# ${ctx.t("mdTitle")}`, ""];
  let size = 0;
  for (const place of D.PLACES) {
    const list = sorted.filter((i) => D.placeOf(i) === place);
    out.push(`## ${ctx.t(`place_${place}`)} (${list.length})`, "");
    for (const i of list) {
      const block = [`### ${i.title || ctx.t("untitled")}`];
      if (i.summary) block.push("", i.summary);
      const facts = [];
      if (i.targetDate) facts.push(`- ${ctx.t("csvTarget")} : ${i.targetDate}`);
      if (i.publishedAt) facts.push(`- ${ctx.t("csvPublished")} : ${i.publishedAt}`);
      if (i.networks.length) facts.push(`- ${ctx.t("csvNetworks")} : ${i.networks.join(", ")}`);
      if (facts.length) block.push("", ...facts);
      if (i.steps.length) block.push("", ...i.steps.map((s) => `- [${s.done ? "x" : " "}] ${s.label}`));
      if (i.notes) block.push("", ...i.notes.split("\n").map((l) => `> ${l}`));
      block.push("");
      const text = block.join("\n");
      size += text.length;
      if (size > MAX_TEXT) { out.push(`*${ctx.t("mdCut")}*`, ""); return out.join("\n"); }
      out.push(text);
    }
  }
  return out.join("\n");
}

export const backup = {
  // Files readable without Curiosa: ideas.csv (a spreadsheet) and ideas.md (a text editor), then the two documents files when there is a document.
  async readable(ctx) {
    const ideas = await D.loadAll(ctx);
    const rows = [D.csvLine(headerCells(ctx))];
    let size = rows[0].length;
    for (const i of [...ideas].sort(D.compare)) {
      const row = D.csvLine(rowCells(ctx, i));
      size += row.length;
      if (size > MAX_TEXT) break;
      rows.push(row);
    }
    const files = [{ path: "ideas.csv", content: BOM + rows.join("") }, { path: "ideas.md", content: readableText(ctx, ideas) }];
    // The documents have files of their own, only when there is one (a notebook without documents gives exactly the two files above).
    const docs = [];
    let chars = 0;
    for await (const page of X.docPages(ctx)) {
      for (const doc of page) { docs.push(doc); chars += doc.text.length; }
      if (chars > MAX_TEXT) break;
    }
    if (docs.length) {
      const titles = new Map(ideas.map((i) => [i.id, i.title || ctx.t("untitled")]));
      const docRowsAll = [D.csvLine(docHeaderCells(ctx))];
      let size = docRowsAll[0].length;
      for (const doc of docs) {
        const lines = docRows(ctx, doc, titles.get(doc.ideaId) ?? ctx.t("untitled")).map((r) => D.csvLine(r));
        size += lines.reduce((n, l) => n + l.length, 0);
        if (size > MAX_TEXT) break;
        docRowsAll.push(...lines);
      }
      files.push({ path: "documents.csv", content: BOM + docRowsAll.join("") }, { path: "documents.md", content: readableDocs(ctx, docs, titles) });
    }
    return files;
  },
};
