// Partenariats — module communautaire de Curiosa (suivi interne, aucune page publique).
//
// Les fiches vivent dans le stockage privé de l'instance (ctx.api.store) : collections « partners » (avec `contactIds`, des RÉFÉRENCES vers
// le module Contacts) et « journal ». Les PERSONNES n'existent que dans le module Contacts (service « contact.book », déclaré dans `requires`) :
// ce module n'a plus de carnet à lui. Trois collections ne servent qu'à la reprise unique des contacts d'avant la 2.0 (voir migrate.mjs, à retirer en phase 3) :
// « contacts » (l'ancien carnet, vidée après la reprise), « legacyContacts » (sa copie, inerte) et « meta » (l'état de la reprise).
// Le module ne montre RIEN sur le site : il expose
//   • un panneau d'admin complet (adminPanel + adminActions),
//   • le sujet « partnership.partner » pour que d'autres modules (sponsors…) s'y réfèrent,
//   • le service « privacy.subject » (export / effacement / redirection de ses liens vers une fiche Contacts),
//   • des actions MCP pour les assistants (suppression d'une fiche désactivée d'office).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const data = await import(`./data.mjs${v}`);
const { all, safeUrl } = data;
// MIGRATION À RETIRER EN PHASE 3
const migrate = await import(`./migrate.mjs${v}`);
const { default: privacy } = await import(`./privacy.mjs${v}`);
const { default: admin } = await import(`./admin.mjs${v}`);
const { default: tools } = await import(`./tools.mjs${v}`);
const { timing } = await import(`./contacts-link.mjs${v}`);

// Pour les tests et les outils : l'import CSV, la reprise et les bornes d'attente restent accessibles depuis le point d'entrée.
export const { parseCsv, importPartners } = data;
export const { planItem, runMigration } = migrate;
export { timing };

export default {
  exports: {
    "partnership.partner": async (ctx) =>
      (await all(ctx, "partners")).map((p) => ({ id: p.id, title: p.data.brand, status: p.data.status, url: safeUrl(p.data.url) || undefined, logo: p.data.logo || undefined })),
  },

  services: { "privacy.subject": privacy },

  // MIGRATION À RETIRER EN PHASE 3 : reprise des contacts d'avant la 2.0 vers Contacts. Ne lève jamais : sans Contacts 2 elle attend et reprend à l'ouverture de l'admin.
  migrations: { 2: async (ctx) => { await migrate.runMigration(ctx); } },

  ...admin, // adminPanel, adminActions
  ...tools, // mcp
};
