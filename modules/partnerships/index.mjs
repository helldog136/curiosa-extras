// Partenariats — module communautaire de Curiosa (suivi interne, aucune page publique).
//
// Les fiches vivent dans le stockage privé de l'instance (ctx.api.store) : collections « partners » (avec `contactIds`, des RÉFÉRENCES vers
// le module Contacts) et « journal ». Les PERSONNES n'existent que dans le module Contacts (service « contact.book », déclaré dans `requires`) :
// ce module n'a plus de carnet à lui. Trois collections de transition : « contacts » (l'ancien carnet, lu tant que la fusion n'est pas faite),
// « legacyContacts » (sa copie conservée après la fusion, jamais supprimée) et « meta » (l'état de la fusion, pour pouvoir l'annuler).
// Le module ne montre RIEN sur le site : il expose
//   • un panneau d'admin complet (adminPanel + adminActions),
//   • le sujet « partnership.partner » pour que d'autres modules (sponsors…) s'y réfèrent,
//   • des actions MCP pour les assistants (suppression d'une fiche désactivée d'office).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const data = await import(`./data.mjs${v}`);
const { all, safeUrl } = data;
const merge = await import(`./merge.mjs${v}`);
const { default: admin } = await import(`./admin.mjs${v}`);
const { default: tools } = await import(`./tools.mjs${v}`);

// Pour les tests et les outils : l'import CSV reste accessible depuis le point d'entrée.
export const { parseCsv, importPartners } = data;
export const { planMerge, countPlan } = merge;

export default {
  exports: {
    "partnership.partner": async (ctx) =>
      (await all(ctx, "partners")).map((p) => ({ id: p.id, title: p.data.brand, status: p.data.status, url: safeUrl(p.data.url) || undefined, logo: p.data.logo || undefined })),
  },

  ...admin, // adminPanel, adminActions
  ...tools, // mcp

  backup: { readable: merge.legacyBackup },
};
