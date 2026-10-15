// Statistiques de la communauté — lecture « montrables seulement », pour l'affichage futur sur le site (page ou compteur dans un texte).
// Ce module ne l'expose pas encore : aucune page, aucune section. La fonction est prête et testée ; le jour venu, l'affichage l'appellera.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins
const { loadStats } = await import(`./stats.mjs${v}`);

/**
 * Les chiffres que la personne a choisi de montrer (réglage « Montrer sur mon site »), et eux seuls.
 * Un chiffre automatique en erreur ou qui n'est plus transmis n'est PAS montrable (jamais de valeur périmée) ; un chiffre saisi à la main l'est tant qu'il existe.
 * Aucun historique, aucun réglage interne : juste de quoi afficher.
 */
export async function readPublic(ctx) {
  return (await loadStats(ctx))
    .filter((s) => s.visible === true && s.lastValue != null && (s.source === "manual" || s.state === "ok"))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => ({ id: s.id, platform: s.platform, account: s.account, metric: s.metric, value: s.lastValue, asOf: new Date(s.lastAt).toISOString(), manual: s.source === "manual", ...(s.url ? { url: s.url } : {}) }));
}
