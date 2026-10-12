// Planning : noms de jeux d'un événement. Fonctions PURES.

export const MAX_GAMES_PER_STREAM = 3;

const decodeEntities = (s) => s.replace(/&lt;br\s*\/?&gt;/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/**
 * Convention à écrire dans la description d'un événement : une ligne « Jeu : <nom> » (ou « Game : »), ou plusieurs
 * jeux séparés par une virgule ou « + ». Rien n'est deviné depuis le titre : mieux vaut ne rien afficher qu'un mauvais jeu.
 */
export function extractGameNames(description) {
  if (!description) return [];
  const matches = [...decodeEntities(description).matchAll(/^[ \t]*(?:Jeux?|Games?)\s*:\s*(.+)$/gim)];
  return matches
    .flatMap((m) => (m[1] ?? "").split(/,|\s+\+\s+/))
    .map((n) => n.trim())
    .filter((n) => n.length >= 2)
    .slice(0, MAX_GAMES_PER_STREAM);
}
