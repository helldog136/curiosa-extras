// Partenariats — module communautaire de Curiosa (suivi interne, aucune page publique).
//
// Les fiches vivent dans le stockage privé de l'instance (ctx.api.store) : collections « partners » (avec `contactIds`, des RÉFÉRENCES vers
// le module Contacts) et « journal ». Les PERSONNES n'existent que dans le module Contacts (service « contact.book », déclaré dans `requires`) :
// ce module n'a plus de carnet à lui. Trois collections ne sont que des restes de la reprise des contacts d'avant la 2.0, retirée en 2.2.0 (plancher de données 2,
// passerelle : l'étiquette v1.50.0, voir docs/MIGRATIONS.md) : « contacts » (l'ancien carnet), « legacyContacts » (sa copie, inerte) et « meta » (l'état de la reprise).
// Le module ne les lit plus, ne les écrit plus ; elles sont déclarées dans `legacyCollections` pour que la page Entretien du cœur les montre.
// Le module ne montre RIEN sur le site : il expose
//   • un panneau d'admin complet (adminPanel + adminActions),
//   • le sujet « partnership.partner » pour que d'autres modules (sponsors…) s'y réfèrent,
//   • le service « privacy.subject » (export / effacement / redirection de ses liens vers une fiche Contacts),
//   • des actions MCP pour les assistants (suppression d'une fiche désactivée d'office).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const data = await import(`./data.mjs${v}`);
const { all, safeUrl } = data;
const { default: privacy } = await import(`./privacy.mjs${v}`);
const { default: admin } = await import(`./admin.mjs${v}`);
const { default: tools } = await import(`./tools.mjs${v}`);
const { timing } = await import(`./contacts-link.mjs${v}`);

// Pour les tests et les outils : l'import CSV et les bornes d'attente restent accessibles depuis le point d'entrée.
export const { parseCsv, importPartners } = data;
export { timing };

export default {
  exports: {
    "partnership.partner": async (ctx) =>
      (await all(ctx, "partners")).map((p) => ({ id: p.id, title: p.data.brand, status: p.data.status, url: safeUrl(p.data.url) || undefined, logo: p.data.logo || undefined })),
  },

  services: { "privacy.subject": privacy },

  // Empty marker: the reprise of the pre-2.0 contacts was removed in 2.2.0. `dataFloor` is 2, so data still in version 1 is set aside instead of being marked up to date;
  // the bridge is the tag v1.50.0 (Partnerships 2.1.0). The kit rule `data.version` wants one entry per `dataVersion` above 1; it never runs on data already in version 2.
  migrations: { 2: async () => {} },

  ...admin, // adminPanel, adminActions
  ...tools, // mcp
};
