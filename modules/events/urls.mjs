// Événements : les adresses de la page publique. Tout est construit ici, jamais lu dans une requête (aucune redirection vers l'extérieur).
const q = new URL(import.meta.url).search;
const Q = await import(`./query.mjs${q}`);

/** Adresse de la page de l'instance (null si elle n'est pas montée sur un chemin). Préfixe la langue si ce n'est pas la langue par défaut. */
export function pageHref(ctx, localized = true) {
  const base = ctx.instance.basePath;
  if (base === null || base === undefined) return null;
  const prefix = localized && ctx.locale !== ctx.defaultLocale ? `/${ctx.locale}` : "";
  return `${prefix}${base ? `/${base}` : ""}` || "/";
}

/** Une adresse de la page publique pour une demande (voir query.mjs), ou null si l'instance n'a pas de page. */
export function hrefFor(ctx, request, localized = true) {
  const root = pageHref(ctx, localized);
  if (root === null) return null;
  const path = Q.buildPath(request);
  return `${root === "/" ? "" : root}${path}` || "/";
}

/** La fiche d'un événement. */
export const eventHref = (ctx, ev, localized = true) => hrefFor(ctx, { mode: "event", slug: ev.slug }, localized);

/** L'adresse complète (avec le site) de la fiche d'un événement, dans la langue du site : sert aux agendas, aux moteurs de recherche et aux cartes. */
export function eventUrl(ctx, ev) {
  const path = eventHref(ctx, ev, false);
  return path === null ? "" : `${ctx.api.siteUrl}${path}`;
}

/** Un fichier du site (« /uploads/… ») devient une adresse complète ; une adresse https reste telle quelle. */
export const absolute = (ctx, value) => (!value ? "" : value.startsWith("/") ? `${ctx.api.siteUrl}${value}` : value);

/** La route publique du module (fichier d'agenda, recherche) : « /m/<clé>/<nom> ». */
export const routeHref = (ctx, name, query = "") => `/m/${ctx.instance.key}/${name}${query ? `?${query}` : ""}`;
