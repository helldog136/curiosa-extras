// Les données de l'instance : trois collections de UN document chacune (le stockage n'a pas de « clé unique » : on lit le plus récent et on range le reste).
//   answers   les réponses de la personne (brouillon, jamais public)
//   pages     les trois textes publiés, en français et en anglais (ce que les visiteurs lisent)
//   state     un petit résumé de la publication (date, empreintes, extensions connues à ce moment-là) : lu à chaque page vue, donc volontairement minuscule

import { createHash } from "node:crypto";
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { buildDocs } = await import(`./docs.mjs${v}`);
const { fingerprintSource } = await import(`./answers.mjs${v}`);

export async function readOne(ctx, collection) {
  const rows = await ctx.api.store.list(collection, { limit: 5 });
  return rows[0] ? { id: rows[0].id, data: rows[0].data ?? null } : null;
}

export async function writeOne(ctx, collection, data) {
  const rows = await ctx.api.store.list(collection, { limit: 5 });
  if (rows[0]) {
    await ctx.api.store.update(rows[0].id, data);
    for (const extra of rows.slice(1)) await ctx.api.store.remove(extra.id);
  } else {
    await ctx.api.store.add(collection, data);
  }
}

export async function removeAll(ctx, collection) {
  for (const row of await ctx.api.store.list(collection, { limit: 20 })) await ctx.api.store.remove(row.id);
}

export const readAnswers = async (ctx) => (await readOne(ctx, "answers"))?.data ?? null;
export const readState = async (ctx) => {
  const s = (await readOne(ctx, "state"))?.data;
  return s && typeof s === "object" && s.published === true ? s : { published: false };
};
export const readPages = async (ctx) => (await readOne(ctx, "pages"))?.data ?? null;

const sha = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
/** Empreinte de ce qui décide des textes : les réponses ET le nom du site (un nom de site qui change change les textes). */
export const fingerprint = (answers, facts) => sha(`${fingerprintSource(answers)}|${facts.siteName.fr}|${facts.siteName.en}`);

/**
 * Publie : fabrique les textes définitifs dans les deux langues (un manque lève une erreur : jamais de texte à trous), les range, puis écrit le résumé.
 * Les pages d'abord, le résumé ensuite : tant que le résumé n'est pas écrit, rien n'est annoncé aux visiteurs.
 */
export async function publish(ctx, answers, facts, now = new Date()) {
  const pages = {};
  for (const lang of ["fr", "en"]) {
    const built = buildDocs({ answers, facts, lang, mode: "final" });
    pages[lang] = { notice: built.notice, privacy: built.privacy, cookies: built.cookies };
  }
  await writeOne(ctx, "pages", pages);
  await writeOne(ctx, "state", { published: true, at: now.toISOString(), hash: fingerprint(answers, facts), modules: facts.moduleIds, country: answers.country });
  return pages;
}

export async function unpublish(ctx) {
  await removeAll(ctx, "state");
  await removeAll(ctx, "pages");
}
