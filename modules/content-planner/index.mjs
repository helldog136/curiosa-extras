// Cahier de contenu — module communautaire de Curiosa : votre cahier PRIVÉ d'idées de vidéos, d'articles et de posts.
//
// Aucune page publique, aucune route publique, aucune section d'accueil : rien de ce module n'est jamais montré aux visiteurs.
// Les idées vivent dans le stockage privé de l'instance (collection « ideas », un document par idée). Le module ne lit les données d'aucun autre module
// et ne dépend d'aucun autre : les réseaux sont de simples mots que la personne choisit, pas des liens vers les modules de réseaux.
//
// Fichiers : data.mjs (données et règles, rythme compris), view.mjs (morceaux d'écran), admin.mjs (liste, page d'une idée, actions),
// tools.mjs (outils pour l'assistant IA), export.mjs (fichier CSV et sauvegarde lisible).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { default: admin } = await import(`./admin.mjs${v}`);
const { default: tools } = await import(`./tools.mjs${v}`);
const { downloads, backup } = await import(`./export.mjs${v}`);

export default {
  ...admin, // adminPanel, adminActions
  ...tools, // mcp
  adminDownloads: downloads,
  backup,
  // Pas de `tasks`, pas de `routes`, pas de `page` : tout est calculé quand on ouvre le cahier.
};
