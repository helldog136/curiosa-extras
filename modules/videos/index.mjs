// Vidéothèque — module de Curiosa : une page de vidéos (masterclass, rétrospectives, tutoriels, présentations…) qui viennent de YouTube. Aucune vidéo n'est hébergée ici.
//
// Ce que fait ce module, et rien d'autre : ranger et présenter des vidéos déjà publiées chez la plateforme.
//   - Le visiteur voit une grille (miniature gardée par le site, titre, durée, catégorie), filtre par catégorie, cherche, ouvre une vidéo. Le lecteur n'est chargé QU'APRÈS UN CLIC : avant, le navigateur ne contacte jamais la plateforme.
//   - L'équipe colle une adresse (ou cent) : le titre et la miniature se remplissent via le service public de la plateforme (borné, sans clé) ; sinon elle écrit le titre.
//   - Autres modules : offre `videos.library` (lecture seule) ; consomme, facultativement, `gallery.albums` (relier un album de photos à une vidéo).
//   - Une table de fournisseurs (providers.mjs) permet d'ajouter une autre plateforme plus tard ; la version 1 ne connaît que YouTube.
//
// Fichiers : pure.mjs (outils) · providers.mjs (YouTube) · data.mjs (données) · ops.mjs (ajouter, compléter) · view.mjs (pages) · routes.mjs (miniature, recherche) · admin.mjs · mcp.mjs · service.mjs · albums.mjs · scripts/videos.js (le clic)
// Les fichiers voisins sont importés AVEC la version du fichier principal (sinon, après une mise à jour dans un site qui tourne, l'ancien code resterait en mémoire).
const v = new URL(import.meta.url).search;
const View = await import(`./view.mjs${v}`);
const Admin = await import(`./admin.mjs${v}`);
const Routes = await import(`./routes.mjs${v}`);
const Mcp = await import(`./mcp.mjs${v}`);
const Service = await import(`./service.mjs${v}`);
const Data = await import(`./data.mjs${v}`);
const Pure = await import(`./pure.mjs${v}`);
const Providers = await import(`./providers.mjs${v}`);

export default {
  // PAGE PUBLIQUE : le catalogue, une catégorie, une recherche, une vidéo, une série (voir view.mjs pour les chemins).
  page: (ctx, { segments }) => View.render(ctx, segments),

  routes: Routes.routes,

  // ACCUEIL : les dernières vidéos.
  sections: {
    latest: (ctx, options) => View.latest(ctx, options),
  },

  adminPanel: Admin.panel,
  adminActions: Admin.actions,

  mcp: Mcp.mcp,

  // Le service que les autres modules peuvent appeler (lecture seule).
  services: {
    "videos.library": {
      list: (ctx, args) => Service.list(ctx, args),
      get: (ctx, args) => Service.get(ctx, args),
    },
  },

  // SAUVEGARDE LISIBLE : la liste des vidéos, lisible dans n'importe quel tableur même si le site n'existe plus.
  backup: {
    async readable(ctx) {
      const snap = await Data.snapshot(ctx, { fresh: true });
      const head = ["id", "state", "title", "category", "platform", "address", "date", "duration", "free"].map(Pure.cell).join(",");
      const rows = snap.items.map((x) => {
        const p = Providers.providerOf(x);
        const cat = snap.cats.find((c) => c.k === x.cat);
        return [x.n, x.status, x.title, cat ? Data.catName(ctx, cat) : "", p?.label ?? x.provider, p?.watchUrl(x.ext) ?? "", x.date, Pure.formatDuration(x.dur), x.free ? "yes" : ""].map(Pure.cell).join(",");
      });
      return [{ path: "videos.csv", content: `﻿${[head, ...rows].join("\r\n")}\r\n` }];
    },
  },

  hooks: {
    // Quand l'instance disparaît, sa mémoire aussi (une vidéothèque recréée sous la même clé ne doit rien hériter de l'ancienne).
    async onInstanceDelete(ctx) { Data.forget(ctx); },
  },
};
