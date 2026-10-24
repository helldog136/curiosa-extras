// Galeries photos — module de Curiosa.
//
// Des albums de photos pour un site (rétrospectives, portfolio, coulisses) : HÉBERGEMENT BORNÉ sur le site (photos réduites, nettoyées, comptées)
// et LIEN vers un album d'un autre service pour les gros albums (aucun service tiers imposé). Visionneuse plein écran accessible,
// lien de partage par photo, mention de consentement et demande de retrait en un clic.
//
// Pourquoi du code et pas le type « contenu » (zéro code) du cœur : voir docs/ideas/gallery.md. En bref, le type « contenu » n'a ni grille de
// miniatures ni visionneuse, ne reçoit pas plusieurs photos d'un coup, ne vérifie ni ne nettoie les images (EXIF, GPS) et n'offre pas de service lisible aux autres modules.
//
// Fichiers : text.mjs (outils de texte) · images.mjs (vérifier et nettoyer une image) · data.mjs (données, bornes, limiteurs) · ops.mjs (écritures partagées)
//           view.mjs (pages) · routes.mjs (images, demande de retrait) · admin.mjs (administration et envoi) · mcp.mjs (assistant IA) · service.mjs (gallery.albums)
//           scripts/gallery.js (visionneuse, pages publiques) · scripts/gallery-studio.js (envoi de photos par l'équipe)
// Les fichiers voisins sont importés avec la même « version » que celui-ci (jamais d'ancien fichier resté en mémoire après une mise à jour).
const q = new URL(import.meta.url).search;
const load = (name) => import(new URL(`./${name}${q}`, import.meta.url).href);
const { flag, forget, freshAlbums, getAlbum, loadAlbums, loadPhotos } = await load("data.mjs");
const { adminActions, adminBadge, adminPanel } = await load("admin.mjs");
const { mcp } = await load("mcp.mjs");
const { routes } = await load("routes.mjs");
const { services } = await load("service.mjs");
const { cell, safeSlug, isId } = await load("text.mjs");
const { renderAlbum, renderLatest, renderList, renderPhoto, renderRemoval, renderRemovalDone, renderStudio } = await load("view.mjs");

/** Doit rester égale à `version` de module.json. */
export const VERSION = "1.0.0";

const SCRIPT = ["gallery.js"];
const result = (page, scripts = SCRIPT) => (page ? { title: page.title, description: page.description, blocks: [{ type: "html", html: page.html }], scripts } : { notFound: true, blocks: [] });

/** L'album publié qui porte cette adresse (ou null). */
async function publishedBySlug(ctx, slug) {
  const s = safeSlug(slug);
  if (!s) return null;
  return (await loadAlbums(ctx)).find((a) => a.slug === s && a.status === "published") ?? null;
}

export default {
  // PAGE PUBLIQUE : la liste des albums, un album, une photo, la demande de retrait, l'aperçu d'un brouillon, l'outil d'envoi.
  async page(ctx, { segments }) {
    const seg = segments.slice(0, 5);
    if (seg.length === 0) return result(await renderList(ctx, 1));
    if (seg[0] === "page" && seg.length === 2) return /^[2-9]\d{0,3}$|^1\d{1,3}$/.test(seg[1]) ? result(await renderList(ctx, Number(seg[1]))) : { notFound: true, blocks: [] };

    if (seg[0] === "retrait") {
      if (!flag(ctx, "removal", true)) return { notFound: true, blocks: [] };
      if (seg.length === 1) return result(await renderRemoval(ctx, null));
      if (seg.length === 2 && (seg[1] === "merci" || seg[1] === "erreur")) return result(renderRemovalDone(ctx, seg[1] === "merci"));
      const a = await publishedBySlug(ctx, seg[1]);
      if (!a || seg.length > 3) return { notFound: true, blocks: [] };
      if (seg.length === 2) return result(await renderRemoval(ctx, null));
      const p = (await loadPhotos(ctx, a)).find((x) => x.id === seg[2] && !x.hidden);
      return p ? result(await renderRemoval(ctx, { album: a, photo: p })) : { notFound: true, blocks: [] };
    }

    // L'outil d'envoi de l'équipe : une coquille sans donnée privée (le cœur vérifie la connexion et les droits à chaque appel).
    if (seg[0] === "studio") return seg.length === 2 && isId(seg[1]) ? result(renderStudio(ctx, seg[1]), ["gallery-studio.js"]) : { notFound: true, blocks: [] };

    // Aperçu d'un album pas encore publié : /apercu/<album>/<clé> (la clé est dans l'administration)
    if (seg[0] === "apercu") {
      const a = seg.length >= 3 && isId(seg[1]) ? await getAlbum(ctx, seg[1]) : null;
      if (!a || !a.preview || a.preview !== seg[2]) return { notFound: true, blocks: [] };
      if (seg.length === 3) return result(await renderAlbum(ctx, a, { preview: true }));
      return seg.length === 4 ? result(await renderPhoto(ctx, a, seg[3], { preview: true })) : { notFound: true, blocks: [] };
    }

    const a = await publishedBySlug(ctx, seg[0]);
    if (!a) return { notFound: true, blocks: [] };
    if (seg.length === 1) return result(await renderAlbum(ctx, a));
    if (seg.length === 2) return result(await renderPhoto(ctx, a, seg[1]));
    return { notFound: true, blocks: [] };
  },

  routes,
  services,

  // ACCUEIL : les derniers albums.
  sections: {
    latest: (ctx, options) => renderLatest(ctx, Math.min(6, Math.max(1, Math.trunc(Number(options?.count)) || 3))),
  },

  adminPanel,
  adminActions,
  adminBadge,
  mcp,

  // SAUVEGARDE LISIBLE : la liste des albums et des photos (titres, légendes, textes alternatifs), lisible dans n'importe quel tableur.
  // Les images ne sont pas dans ce fichier (elles sont dans la sauvegarde complète du site). Aucune demande de retrait : elles peuvent contenir des coordonnées.
  backup: {
    async readable(ctx) {
      const albums = await freshAlbums(ctx, "manual");
      const head = ["album", "title", "status", "mode", "date", "photos", "link"].map(cell).join(",");
      const rows = albums.map((a) => [a.id, a.title, a.status, a.mode, a.date, a.total, a.link].map(cell).join(","));
      const photoHead = ["album", "position", "caption", "alt", "hidden", "file_name", "elsewhere_url"].map(cell).join(",");
      const photoRows = [];
      for (const a of albums) (await loadPhotos(ctx, a)).forEach((p, i) => photoRows.push([a.title, i + 1, p.caption, p.alt, p.hidden ? "yes" : "no", p.name, p.full ? "" : p.url].map(cell).join(",")));
      return [
        { path: "albums.csv", content: `﻿${[head, ...rows].join("\r\n")}\r\n` },
        { path: "photos.csv", content: `﻿${[photoHead, ...photoRows].join("\r\n")}\r\n` },
      ];
    },
  },

  hooks: {
    // Quand l'instance disparaît, sa mémoire aussi (une galerie recréée sous la même clé ne doit rien hériter de l'ancienne).
    async onInstanceDelete(ctx) {
      forget(ctx);
    },
  },
};
