// Mentions légales — module de Curiosa.
//
// Un assistant en quelques questions simples prépare trois pages (Mentions légales, Confidentialité, Cookies) en français et en anglais.
// Ce sont des MODÈLES D'AIDE écrits d'après les réponses, jamais un conseil juridique ; ils ne sont publiés que quand la personne le décide,
// et jamais avec un trou (une réponse qui manque bloque la publication au lieu de laisser un texte incomplet).
//
//   known.mjs    ce que le site sait des extensions installées (préremplissage seulement)
//   facts.mjs    ce que le site sait déjà : nom, adresse de contact, extensions actives (par l'interface publique des extensions)
//   answers.mjs  les questions, ce qui est nécessaire, ce qui est valable
//   docs.mjs     la fabrication des textes (FR + EN)
//   data.mjs     ce qui est rangé : réponses, pages publiées, petit résumé de publication
//   public.mjs   ce que voient les visiteurs (pages + lien du pied de page)
//   admin.mjs    l'assistant, l'aperçu, la publication
//   tools.mjs    les outils pour les assistants IA

const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { page, footer } = await import(`./public.mjs${v}`);
const { adminPanel, adminActions, attention, load } = await import(`./admin.mjs${v}`);
const { readAnswers, readPages, readState } = await import(`./data.mjs${v}`);
const tools = (await import(`./tools.mjs${v}`)).default;

const KEYS_OF_NO_INTEREST = new Set(["touched", "unknownAck", "savedAt"]);

/** Une réponse lisible sans le framework : « clé : valeur », une par ligne. */
function readableAnswers(answers) {
  const lines = ["# Answers / Réponses", ""];
  for (const [key, value] of Object.entries(answers ?? {})) {
    if (KEYS_OF_NO_INTEREST.has(key)) continue;
    if (value && typeof value === "object") for (const [k, x] of Object.entries(value)) lines.push(`- ${key}.${k}: ${JSON.stringify(x)}`);
    else lines.push(`- ${key}: ${JSON.stringify(value)}`);
  }
  return lines.join("\n") + "\n";
}

export default {
  slots: { "layout.footer": footer },
  page,
  adminPanel,
  adminActions,

  /** La pastille du menu : ce qui attend la personne (commencer, finir, publier, relire). 0 = rien. */
  async adminBadge(ctx) {
    try { return attention(ctx, await load(ctx)).length; } catch { return 0; }
  },

  mcp: tools.mcp,

  backup: {
    async readable(ctx) {
      const files = [];
      const answers = await readAnswers(ctx);
      if (answers) files.push({ path: "answers.md", content: readableAnswers(answers) });
      const state = await readState(ctx);
      const pages = state.published ? await readPages(ctx) : null;
      for (const [lang, docs] of Object.entries(pages ?? {})) {
        const text = ["notice", "privacy", "cookies"].filter((p) => docs?.[p]).map((p) => `# ${docs[p].title}\n\n${docs[p].md}`).join("\n\n---\n\n");
        if (text) files.push({ path: `published-${lang}.md`, content: `${text}\n` });
      }
      return files;
    },
  },
};
