// Carte — module de Curiosa.
//
// Une LISTE de lieux utiles (studios, bonnes adresses, événements…) toujours disponible, avec des filtres par type et une recherche ; et, si le visiteur le
// demande, une CARTE. Aucune requête vers un serveur de fonds de carte n'est faite avant le clic « Afficher la carte » (vie privée) ; « Près de moi » demande la
// position au navigateur seulement après un clic, la garde dans la page et ne l'envoie jamais au site. Les fonds de carte sont ceux d'OpenStreetMap (sans clé).
//
// Pourquoi du code et pas le type « contenu » (zéro code) du cœur : voir docs/ideas/map.md. En bref, il faut des coordonnées, une carte, un calcul de distance,
// des lieux lus chez d'autres modules (sujet `map.place`) et un import de fichier ; et la carte maison tient dans 2 petits scripts (la page n'en accepte que 3 de 32 Ko).
//
// Fichiers : text.mjs (outils de texte, CSV) · geo.mjs (lire un lien de carte ou des coordonnées) · templates.mjs (jeux de départ) · data.mjs (données, mémoire à durée
//           limitée, lieux d'autres modules) · ops.mjs (écritures) · csvio.mjs (import / export) · view.mjs (pages) · routes.mjs (lectures publiques) ·
//           admin.mjs (administration) · mcp.mjs (assistant IA) · scripts/map-engine.js (calculs et carte) · scripts/map-page.js (comportement de la page).
// Les fichiers voisins sont importés avec la même « version » que celui-ci : jamais d'ancien fichier resté en mémoire après une mise à jour.

const q = new URL(import.meta.url).search;
const { flag, shorten, clean, cell } = await import(new URL(`./text.mjs${q}`, import.meta.url).href);
const { world, forget, ensureSeed } = await import(new URL(`./data.mjs${q}`, import.meta.url).href);
const { adminActions, adminBadge, adminDownloads, adminPanel } = await import(new URL(`./admin.mjs${q}`, import.meta.url).href);
const { mcp } = await import(new URL(`./mcp.mjs${q}`, import.meta.url).href);
const { routes } = await import(new URL(`./routes.mjs${q}`, import.meta.url).href);
const { exportText } = await import(new URL(`./csvio.mjs${q}`, import.meta.url).href);
const { pageHref, parseSegments, renderPage, renderPlace, metaDescription } = await import(new URL(`./view.mjs${q}`, import.meta.url).href);

/** Doit rester égale à `version` de module.json. */
export const VERSION = "1.0.2";
const SCRIPTS = ["map-engine.js", "map-page.js"];

export default {
  // PAGE PUBLIQUE : la liste (/map), une liste filtrée (/map/t/<type>, /map/q/<mot>, /map/page/<n>) et la fiche d'un lieu (/map/p/<code>).
  async page(ctx, { segments }) {
    const route = parseSegments(segments);
    if (!route) return { notFound: true, blocks: [] };
    if (route.kind === "place") {
      const r = await renderPlace(ctx, route.code);
      if (!r) return { notFound: true, blocks: [] };
      const description = shorten(clean(r.place.desc || r.place.address, 400), 160) || metaDescription(ctx);
      return { title: r.place.name, description, blocks: [{ type: "html", html: r.html }], scripts: flag(ctx, "showMap", true) ? SCRIPTS : [] };
    }
    const r = await renderPage(ctx, route);
    if (route.page > 1 && r.page !== route.page) return { notFound: true, blocks: [] };
    const interactive = r.vis.all.length > 0 && (flag(ctx, "showMap", true) || flag(ctx, "showNear", true));
    return { title: ctx.instance.name || ctx.t("pageTitle"), description: metaDescription(ctx), blocks: [{ type: "html", html: r.html }], scripts: interactive ? SCRIPTS : [] };
  },

  routes,

  slots: {
    "layout.footer"(ctx) {
      const href = pageHref(ctx);
      if (!flag(ctx, "footerLink", false) || !href) return null;
      return [{ type: "links", items: [{ label: ctx.instance.name || ctx.t("pageTitle"), href }] }];
    },
  },

  adminPanel,
  adminActions,
  adminBadge,
  adminDownloads,
  mcp,

  // SAUVEGARDE LISIBLE : les lieux de l'équipe dans le même format que l'import (relisible dans un tableur même si le site n'existe plus).
  backup: {
    async readable(ctx) {
      const w = await world(ctx);
      const types = ["id,fr,en,symbol,rank", ...w.types.map((t) => [cell(t.id), cell(t.names.fr ?? ""), cell(t.names.en ?? ""), cell(t.sym), t.pos].join(","))];
      const cities = ["name,lat,lng", ...w.cities.map((c) => [cell(c.name), c.lat, c.lng].join(","))];
      return [
        { path: "places.csv", content: await exportText(ctx) },
        { path: "types.csv", content: `﻿${types.join("\r\n")}\r\n` },
        { path: "cities.csv", content: `﻿${cities.join("\r\n")}\r\n` },
      ];
    },
  },

  hooks: {
    // Créé avec l'instance (pas lors d'une restauration) : le jeu de départ neutre, supprimable. Idempotent.
    async onInstanceCreate(ctx) {
      await ensureSeed(ctx);
    },
    // Quand l'instance disparaît, sa mémoire aussi.
    async onInstanceDelete(ctx) {
      forget(ctx);
    },
  },
};
