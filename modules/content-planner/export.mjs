// Cahier de contenu — l'export CSV (servi par le cœur, au fil de l'eau) et la sauvegarde lisible (un tableau CSV et un texte qu'on lit sans rien d'installé).
// Rien n'est jamais construit en entier pour le téléchargement : on lit 500 idées à la fois. Le plafond du cahier (1 000 idées) borne aussi les fichiers.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins
const D = await import(`./data.mjs${v}`);

const BOM = "\ufeff";
const MAX_TEXT = 4_500_000; // sous la limite de 5 Mo par fichier de la sauvegarde
const lang = (ctx) => (String(ctx.locale ?? "").startsWith("fr") ? "fr" : "en");
/** Excel en français attend des points-virgules ; ailleurs, des virgules. */
export const delimiterFor = (ctx) => (lang(ctx) === "fr" ? ";" : ",");

export const headerCells = (ctx) => ["csvTitle", "csvSummary", "csvPlace", "csvStepsDone", "csvSteps", "csvTarget", "csvPublished", "csvNetworks", "csvNotes", "csvCreated"].map((k) => ctx.t(k));
export function rowCells(ctx, i) {
  return [
    i.title, i.summary, ctx.t(`place_${D.placeOf(i)}`), `${D.stepsDone(i)}/${i.steps.length}`,
    i.steps.map((s) => `${s.done ? "[x]" : "[ ]"} ${s.label}`).join(" | "),
    i.targetDate, i.publishedAt, i.networks.join(" | "), i.notes, i.createdAt.slice(0, 10),
  ];
}

/** Les idées, une page de 500 à la fois (du plus récent au plus ancien). */
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

export const downloads = {
  ideas: {
    right: "ideas.export",
    contentType: "text/csv",
    filename: (ctx) => `${ctx.t("csvFile")}-${D.todayOf(ctx)}`,
    generate: (ctx) => exportCsv(ctx),
  },
};

/** Le cahier en texte lisible : un titre par endroit, une rubrique par idée, les étapes en cases à cocher. */
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
  // Deux fichiers lisibles sans Curiosa : ideas.csv (un tableur) et ideas.md (un éditeur de texte).
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
    return [{ path: "ideas.csv", content: BOM + rows.join("") }, { path: "ideas.md", content: readableText(ctx, ideas) }];
  },
};
