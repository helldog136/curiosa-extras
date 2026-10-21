// Contacts — l'export CSV complet du carnet, servi par le cœur (`adminDownloads`, droit « exporter le carnet »). Au fil de l'eau : le générateur lit le carnet
// par pages de 500 fiches (curseur = date de création + identifiant, donc sans doublon ni trou même si le carnet bouge pendant le téléchargement) et rend le
// texte morceau par morceau ; rien n'est jamais construit en entier. Plafond : 100 000 fiches (celui du carnet).
// Mêmes colonnes que l'import (csv.mjs) : exporter puis réimporter redonne les mêmes fiches. Jamais de secret : une fiche n'en contient pas ; l'e-mail et le
// téléphone ne sortent que pour une personne qui a le droit « voir les e-mails et téléphones ».
const v = new URL(import.meta.url).search;
const B = await import(`./book.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const C = await import(`./csv.mjs${v}`);

export const PAGE = 500;
const pageMs = (ctx) => { const n = ctx?.__contactsTest?.exportPageMs; return Number.isInteger(n) && n > 0 ? n : 50_000; };
const BOM = "﻿";
const lang = (ctx) => (String(ctx.locale ?? "").startsWith("fr") ? "fr" : "en");
export const exportLabels = (ctx) => ({ kind: { person: ctx.t("exportKindPerson"), org: ctx.t("exportKindOrg") }, status: { active: ctx.t("exportStatusActive"), to_review: ctx.t("exportStatusReview") } });
export const today = () => new Date().toISOString().slice(0, 10);

/** Les notes d'une page de fiches : les 50 dernières de chacune (la sauvegarde `notes.csv` les garde toutes), de la plus ancienne à la plus récente. */
async function notesOf(ctx, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const rows = await Promise.all(chunk.map((id) => D.latestNotes(ctx, id, C.MAX_NOTES)));
    rows.forEach((list, j) => out.set(chunk[j], list.slice().reverse().map((n) => ({ date: n.data.date, author: n.data.author, text: n.data.text }))));
  }
  return out;
}

/** Le CSV du carnet, texte par morceaux : les titres, puis une page de 500 fiches à la fois. */
export async function* exportCsv(ctx) {
  const locale = lang(ctx), delimiter = C.exportDelimiter(locale), labels = exportLabels(ctx);
  const withContact = B.can(ctx, B.RIGHT_EMAIL_VIEW);
  yield BOM + C.line(C.headerLabels(locale), delimiter);
  let t = -Infinity, lastId = "", rows = 0;
  for (let pages = 0; pages < 400; pages++) {
    const idx = await D.getIndex(ctx, { waitMs: 60_000 });
    const from = D.after(idx.list, t, lastId);
    const slice = idx.list.slice(from, from + PAGE);
    if (!slice.length) return;
    const ids = slice.map((e) => e.id);
    const [recs, notes] = await D.within(Promise.all([D.readMany(ctx, ids), notesOf(ctx, ids)]), pageMs(ctx), "export page"); // un stockage muet coupe le fichier (le cœur l'affiche en échec), jamais un fichier tronqué qui aurait l'air complet
    let text = "";
    for (const e of slice) {
      const rec = recs.get(e.id);
      if (!rec) continue;
      const d = rec.data;
      const orgName = d.kind === "org" ? "" : e.o ? idx.byId.get(e.o)?.d ?? "" : "";
      const categoryNames = B.liveCategoryIds(idx, d.categoryIds).map((id) => idx.cats.get(id)?.name).filter(Boolean);
      text += C.line(C.cardCells({ data: { ...d, orgName }, id: rec.id, categoryNames, notes: notes.get(rec.id) ?? [], withContact, labels }), delimiter);
      if (++rows >= D.LIMITS.maxContacts) break;
    }
    yield text;
    if (rows >= D.LIMITS.maxContacts) return;
    const last = slice[slice.length - 1];
    t = last.t; lastId = last.id;
  }
}

/** Un modèle à remplir : les titres et trois lignes d'exemple (inventées). */
export async function* templateCsv(ctx) {
  const locale = lang(ctx), delimiter = C.exportDelimiter(locale);
  yield BOM + C.line(C.headerLabels(locale), delimiter);
  const rows = ctx.t("templateRows").split("¤").map((r) => r.split("§"));
  for (const r of rows) {
    yield C.line(C.COLUMNS.map((_, i) => r[i] ?? ""), delimiter); // le texte « templateRows » suit l'ordre des colonnes
  }
}
