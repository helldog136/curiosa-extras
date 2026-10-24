// Jeu du jour — module de Curiosa.
//
// Un petit jeu, une fois par jour, pour donner envie de revenir : une question, quelques réponses, une explication, puis « revenez demain ».
// La question du jour est la MÊME pour tout le monde (elle ne dépend que de la date dans le fuseau du site, calculée côté serveur).
// La série de jours et le meilleur score restent dans le NAVIGATEUR du visiteur (stockage local : ni compte, ni cookie, effaçables en un clic).
// Le classement de la semaine est une option : il demande le service « audience.session » (Participation) ; sans lui, rien n'est affiché.
//
// Pourquoi du code et pas le type « contenu » (zéro code) : voir docs/ideas/daily-game.md (choix de la question selon la date, réponse jugée côté serveur
// sans jamais envoyer la bonne réponse avant la réponse, planning, import/export, classement, séries côté navigateur).
//
// Fichiers (tous importés AVEC la version du fichier principal, pour qu'une mise à jour à chaud recharge tout) :
//   lib.mjs (outils purs) · games.mjs (la table des types de jeu : le quiz maintenant) · plan.mjs (quelle question aujourd'hui) · data.mjs (données, verrou, limites, classement)
//   packs.mjs (packs de départ, gabarits) · csv.mjs (import, export) · bridge.mjs (Participation, facultatif) · view.mjs (page, bloc d'accueil) · client.mjs (scripts du navigateur)
//   routes.mjs (réponse, classement, script du bloc d'accueil) · admin.mjs (administration) · mcp.mjs (assistant IA)
const q = new URL(import.meta.url).search;
const D = await import(`./data.mjs${q}`);
const V = await import(`./view.mjs${q}`);
const K = await import(`./csv.mjs${q}`);
const C = await import(`./client.mjs${q}`);
const { routes } = await import(`./routes.mjs${q}`);
const { adminActions, adminBadge, adminDownloads, adminPanel } = await import(`./admin.mjs${q}`);
const { mcp } = await import(`./mcp.mjs${q}`);

export default {
  // PAGE PUBLIQUE : /jeu-du-jour (un seul chemin ; tout autre chemin est une 404).
  async page(ctx, { segments }) {
    if (segments.length > 0) return { notFound: true, blocks: [] };
    const { html } = await V.renderPage(ctx);
    // Le petit script du jeu n'est chargé que sur CETTE page (cœur 0.2.6) : fichier scripts/daily-game.js, copie exacte de CLIENT_JS.
    return { title: V.vocab(ctx).title, description: ctx.t("pageDescription"), blocks: [{ type: "html", html }], scripts: ["daily-game.js"] };
  },

  routes,

  // SUJET « mascot.hint » (facultatif : sans le module mascotte, rien ne l'appelle). Pas de minuteur : la mascotte lit, et le jour change tout seul
  // (l'identifiant contient la date du site, donc un nouveau message chaque jour, jamais deux le même jour). Une seule invitation par instance.
  exports: {
    async "mascot.hint"(ctx, { limit } = {}) {
      if (!D.flag(ctx, "mascotHint", true) || limit === 0) return [];
      const { day, item } = await D.getToday(ctx);
      return item ? [V.hintOf(ctx, day)] : [];
    },
  },

  // ACCUEIL : « Le jeu du jour » (invitation ; son état — à jouer, déjà joué, série — vient du navigateur).
  sections: {
    today: (ctx) => V.renderCard(ctx),
  },

  slots: {
    // Le petit script du bloc d'accueil (≈ 1 Ko, en cache). Il ne fait rien s'il n'y a pas de bloc sur la page ; décochable dans les réglages.
    "layout.head"(ctx) {
      if (!D.flag(ctx, "homeState", true) || ctx.instance.basePath === null || ctx.instance.basePath === undefined) return null;
      return [{ type: "head", tags: [{ tag: "script", src: `/m/${ctx.instance.key}/card.js?v=${C.CARD_REV}`, defer: true }] }];
    },
  },

  adminPanel,
  adminActions,
  adminBadge,
  adminDownloads,
  mcp,

  // SAUVEGARDE LISIBLE : la banque de questions dans un tableur, même si le site n'existe plus.
  backup: {
    async readable(ctx) {
      const snap = await D.snapshot(ctx, { fresh: true });
      const rows = [...snap.items].sort((a, b) => a.createdAt - b.createdAt || a.pos - b.pos);
      return [{ path: "questions.csv", content: [...K.exportLines(D.typeOf(ctx), D.localesOf(ctx), rows)].join("") }];
    },
  },

  hooks: {
    // Quand l'instance disparaît, sa mémoire aussi (un jeu recréé sous la même clé ne doit rien hériter de l'ancien).
    async onInstanceDelete(ctx) { D.forget(ctx); },
  },
};
