// Soutiens — module de Curiosa : remercier les personnes qui vous soutiennent sur une plateforme de mécénat, SANS jamais rendre quelqu'un public sans son accord.
//
// Ce que fait ce module, et rien d'autre :
//   - faire entrer les soutiens depuis une plateforme (table de fournisseurs : providers.mjs ; Patreon par interrogation, Ko-fi par notification, ou un fichier importé) ;
//   - montrer sur une page publique SEULEMENT le pseudo que chaque personne a choisi et accepté de montrer sur son lien personnel, sous un libellé de palier choisi par la propriétaire (jamais un montant) ;
//   - (facultatif) ranger les soutiens dans Contacts, qui possède les personnes, et seulement avec le droit « ranger les soutiens dans Contacts ».
// Aucun cookie, aucun minuteur de fond, aucun tiers chargé chez le visiteur, aucune adresse e-mail gardée.
//
// Fichiers (tous importés AVEC la version du fichier principal, pour qu'une mise à jour à chaud recharge tout) :
//   pure.mjs (outils purs, bornes) · providers.mjs (la table des plateformes) · data.mjs (stockage, verrou, oubli) · sync.mjs (actualisation, notification, fichier)
//   contacts.mjs (pont facultatif vers Contacts) · ops.mjs (les gestes, communs à l'admin et à l'assistant) · view.mjs (page publique, accord personnel)
//   routes.mjs (notification entrante, accord) · admin.mjs (administration) · mcp.mjs (assistant IA) · privacy.mjs (export, effacement, fusion)
const v = new URL(import.meta.url).search;
const View = await import(`./view.mjs${v}`);
const Admin = await import(`./admin.mjs${v}`);
const Privacy = await import(`./privacy.mjs${v}`);
const Mcp = await import(`./mcp.mjs${v}`);
const { routes } = await import(`./routes.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const P = await import(`./pure.mjs${v}`);

export default {
  page: (ctx, { segments }) => View.render(ctx, segments),

  routes,

  adminPanel: Admin.panel,
  adminActions: Admin.actions,
  adminBadge: Admin.badge,
  mcp: Mcp.default,

  services: {
    // Vie privée : Contacts demande ce que ce module sait d'une fiche (export), de l'oublier (effacement) ou de suivre une fusion. Voir privacy.mjs.
    "privacy.subject": {
      export: (ctx, args) => Privacy.subject.export(ctx, args),
      erase: (ctx, args) => Privacy.subject.erase(ctx, args),
      remap: (ctx, args) => Privacy.subject.remap(ctx, args),
    },
    // Les pseudos que les personnes ont accepté de montrer (accord + relecture + non cachés + actifs), avec le libellé de palier choisi. Lecture seule, 50 par page.
    "supporters.public": {
      async list(ctx, args) {
        try {
          const groups = await View.publicGroups(ctx);
          const flat = groups.flatMap((g) => g.people.map((p) => ({ id: p.pid, pseudo: p.pseudo, tier: g.title ?? null })));
          const limit = P.int(args?.limit, 50, 1, 50);
          const from = P.int(typeof args?.cursor === "string" && /^\d{1,6}$/.test(args.cursor) ? args.cursor : 0, 0, 0, 1_000_000);
          const items = flat.slice(from, from + limit);
          return { ok: true, items, next: from + limit < flat.length ? String(from + limit) : null };
        } catch { return { ok: false, error: "failed" }; }
      },
    },
  },

  hooks: {
    // Quand l'instance disparaît, sa mémoire aussi (une instance recréée sous la même clé ne doit rien hériter de l'ancienne).
    async onInstanceDelete(ctx) { D.forget(ctx); },
  },
};
