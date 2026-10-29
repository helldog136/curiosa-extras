// Module d'exemple. Un module est un simple module ES : pas d'installation de
// dépendances, pas de build. Il exporte par défaut un objet qui déclare ce
// qu'il apporte au site (voir docs/MODULES.md).
//
// Un module tourne UNE FOIS PAR INSTANCE : `ctx.setting(...)` renvoie les
// réglages de l'instance courante, et `ctx.instance.key` l'identifie. Avec deux
// instances, le site affiche deux bannières, chacune avec ses textes.
export default {
  slots: {
    // Bannière tout en haut de chaque page.
    "layout.banner": (ctx) => {
      if (!ctx.setting("enabled")) return null;
      const text = ctx.setting("text"); // déjà résolu pour la langue du visiteur
      if (!text) return null;
      return [{ type: "banner", text, href: /^(https?:\/\/|mailto:|\/(?!\/))/i.test(String(ctx.setting("link") ?? "").trim()) ? String(ctx.setting("link")).trim() : undefined, tone: ctx.setting("tone") }];
    },
  },

  // Morceaux que l'admin peut placer sur la page d'accueil (déclarés dans module.json).
  sections: {
    note: (ctx) => {
      const note = ctx.setting("homeText");
      return note ? [{ type: "markdown", text: note }] : null;
    },
  },

  // Information exposée aux modules consommateurs (ex. un overlay OBS). Le module ne sait pas
  // qui la lit : il publie des éléments au format du sujet « overlay.item » (déclaré dans
  // module.json → provides) ; l'admin décide quelles instances d'overlay s'y abonnent.
  exports: {
    "overlay.item": (ctx) => {
      if (!ctx.setting("enabled") || !ctx.setting("text")) return [];
      return [{ title: ctx.setting("text"), url: ctx.setting("link") || undefined }];
    },
  },
};
