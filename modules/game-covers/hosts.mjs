// Les sources de jaquettes et leurs images : la liste FERMÉE des hôtes et des chemins que le module accepte, source par source. Fonctions pures (aucun réseau, aucun stockage).
//   rawg    media.rawg.io               /media/…                                        (image donnée par la réponse de RAWG)
//   twitch  static-cdn.jtvnw.net        /ttv-boxart/<numéro>[_IGDB]-<l>x<h>.jpg          (jaquette de boîte de la catégorie Twitch)
//   steam   shared.akamai.steamstatic.com  /store_item_assets/steam/apps/<numéro>/<image>.jpg  (image du magasin ; le chemin est écrit par le module à partir d'un numéro, jamais lu)
// Une image n'est JAMAIS une adresse libre : on garde le CHEMIN, l'hôte est écrit ici. Même règle pour le téléchargement (copies.mjs) et pour l'affichage.

/** Les sources dans l'ordre de priorité. */
export const SOURCES = ["rawg", "twitch", "steam"];
export const isSource = (s) => SOURCES.includes(s);

const RULES = {
  rawg: { host: "media.rawg.io", path: /^\/media\/[A-Za-z0-9_.\-/]{1,200}\.(?:png|jpe?g|webp)$/ },
  twitch: { host: "static-cdn.jtvnw.net", path: /^\/ttv-boxart\/[0-9]{1,12}(?:_IGDB)?-[0-9]{2,4}x[0-9]{2,4}\.jpg$/ },
  steam: { host: "shared.akamai.steamstatic.com", path: /^\/store_item_assets\/steam\/apps\/[0-9]{1,10}\/(?:library_600x900|header)\.jpg$/ },
};

/** Le chemin d'une adresse d'image permise pour cette source, ou null (https, bon hôte, sans port, identifiant, paramètre ni détour, forme canonique). */
export function imagePath(source, input) {
  const rule = RULES[source];
  if (!rule || typeof input !== "string" || input.length > 400 || /[\u0000- \u007f\\]/.test(input)) return null;
  let u;
  try { u = new URL(input); } catch { return null; }
  if (u.href !== input) return null;
  if (u.protocol !== "https:" || u.hostname !== rule.host || u.port || u.username || u.password || u.search || u.hash) return null;
  if (u.pathname.includes("..") || u.pathname.includes("//") || u.pathname.includes("%") || !rule.path.test(u.pathname)) return null;
  return u.pathname;
}
export const imageUrl = (source, path) => `https://${RULES[source].host}${path}`;
/** Un chemin gardé est-il valide pour cette source ? */
export const validPath = (source, path) => typeof path === "string" && !!RULES[source] && imagePath(source, imageUrl(source, path)) === path;

/** Adresse de la jaquette de boîte de Twitch : l'API donne une taille fixe (`…-52x72.jpg`) ou un modèle (`…-{width}x{height}.jpg`) ; dans les deux cas on demande la taille 285 × 380. */
export function twitchBoxArt(value) {
  if (typeof value !== "string" || value.length > 400) return null;
  const path = imagePath("twitch", value.replace(/-(?:\{width\}|\d{2,4})x(?:\{height\}|\d{2,4})\.jpg$/, "-285x380.jpg"));
  return path ? imageUrl("twitch", path) : null;
}

/** Les adresses à essayer pour COPIER une image (la première qui répond sert). RAWG : la version recadrée 600 × 400 (60 Ko) avant l'originale (350 Ko) ; Steam : la jaquette verticale, puis l'image d'en-tête. */
export function copyCandidates(source, path) {
  if (!validPath(source, path)) return [];
  if (source === "rawg") {
    const crop = path.startsWith("/media/games/") ? [`/media/crop/600/400/${path.slice("/media/".length)}`] : [];
    return [...crop, path].filter((p) => validPath("rawg", p)).map((p) => imageUrl("rawg", p));
  }
  if (source === "steam" && path.endsWith("/library_600x900.jpg")) return [imageUrl("steam", path), imageUrl("steam", path.replace("library_600x900", "header"))];
  return [imageUrl(source, path)];
}
