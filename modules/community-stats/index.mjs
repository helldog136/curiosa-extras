// Statistiques de la communauté — module de Curiosa : relève les chiffres que les modules de réseaux publient (abonnés, abonnés payants, publications, vues),
// en garde l'historique, les montre dans l'admin et les met à disposition d'un assistant (MCP). Les chiffres sont PRIVÉS tant que vous ne dites pas « Montrer sur mon site ».
//
// UN PROPRIÉTAIRE PAR DONNÉE : chaque module de réseau possède SES chiffres et les publie sur « social.stat » ; ce module les collecte, c'est tout.
// Il n'invente aucun cumul (pas d'« audience totale ») : les règles d'assemblage viendront, choisies par vous, dans la page qui les affichera.
// Affichage : pas de page publique ; seul l'élément « Compteurs » des pages d'overlay (overlay.mjs) montre des chiffres, et seulement ceux de `readPublic` (publicRead.mjs).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { collectNow } = await import(`./collect.mjs${v}`);
const { default: admin } = await import(`./admin.mjs${v}`);
const { default: tools } = await import(`./tools.mjs${v}`);
const overlay = await import(`./overlay.mjs${v}`); // l'élément « Compteurs » des pages d'overlay (cœur 0.5.0) : seulement les chiffres que vous avez choisi de montrer

export default {
  ...admin, // adminBadge, adminPanel, adminActions
  ...tools, // mcp
  overlayElements: Object.fromEntries(overlay.ELEMENTS.map((id) => [id, (ctx, request) => overlay.elementAddress(ctx, id, request)])),
  routes: { "element/:slug": (request, ctx) => overlay.elementResponse(request, ctx) }, // la page de l'élément (adresse publique, sans secret : elle ne rend que le montrable)
  // La tâche passe souvent, mais ne relève qu'une fois par période choisie (collectNow ne refait rien si la période en cours est déjà traitée).
  tasks: { collect: { everyMinutes: 15, run: async (ctx) => { await collectNow(ctx); } } },
};
