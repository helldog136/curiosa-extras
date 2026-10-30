// Statistiques de la communauté — lecture « montrables seulement », pour l'affichage futur sur le site (page ou compteur dans un texte).
// Seul l'élément d'overlay (overlay.mjs) l'utilise aujourd'hui : aucune page, aucune section. La règle « montrable » est UNE seule définition (isShowable).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins
const { loadStats } = await import(`./stats.mjs${v}`);

/** LA règle de ce qui est montrable : choisi par la personne (« Montrer sur mon site »), avec un chiffre actuel. Une seule définition, pour toute lecture publique (voir `readPublic`, l'élément d'overlay). */
export const isShowable = (s) => s.visible === true && s.lastValue != null && (s.source === "manual" || s.state === "ok");

/** Les statistiques montrables, complètes (pour l'élément d'overlay, qui en tire aussi l'évolution) : jamais un chiffre non autorisé, jamais de valeur périmée. */
export async function publicStats(ctx) {
  return (await loadStats(ctx)).filter(isShowable).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Les chiffres que la personne a choisi de montrer (réglage « Montrer sur mon site »), et eux seuls.
 * Un chiffre automatique en erreur ou qui n'est plus transmis n'est PAS montrable (jamais de valeur périmée) ; un chiffre saisi à la main l'est tant qu'il existe.
 * Aucun historique, aucun réglage interne : juste de quoi afficher.
 */
export async function readPublic(ctx) {
  return (await publicStats(ctx))
    .map((s) => ({ id: s.id, platform: s.platform, account: s.account, metric: s.metric, value: s.lastValue, asOf: new Date(s.lastAt).toISOString(), manual: s.source === "manual", ...(s.url ? { url: s.url } : {}) }));
}
