// Mur des remerciements — module de Curiosa : une page « Merci ! » qui montre, en grille de cartes avec photos, les personnes d'une ou plusieurs catégories de Contacts
// (modération, mécènes, bêta-testeurs…), une personne mise à l'honneur chaque mois et un mot court par personne.
//
// Ce que fait ce module, et rien d'autre : afficher. Ce qui appartient aux autres reste chez eux :
//   - les personnes, leurs noms, leurs photos et la catégorie « ne pas montrer » : Contacts (service `contact.book`, version 2, besoin obligatoire) ; ce module n'en copie rien (voir contacts.mjs) ;
//   - à lui : le message court de chaque personne (par numéro de fiche) et les mises à l'honneur (mois → numéro de fiche) (voir data.mjs).
// Aucune saisie de visiteur, aucune route publique, aucun cookie : la page se lit, c'est tout. Si Contacts se tait, la page garde le dernier mur connu (24 h au plus), puis un message aimable.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const View = await import(`./view.mjs${v}`);
const Admin = await import(`./admin.mjs${v}`);
const Privacy = await import(`./privacy.mjs${v}`);
const Mcp = await import(`./mcp.mjs${v}`);

export default {
  page: (ctx, { segments }) => View.render(ctx, segments),

  adminPanel: Admin.panel,
  adminActions: Admin.actions,

  // Vie privée : Contacts demande ce que ce module sait d'une fiche (export), de l'oublier (effacement) ou de suivre une fusion. Voir privacy.mjs.
  services: {
    "privacy.subject": {
      export: (ctx, args) => Privacy.subject.export(ctx, args),
      erase: (ctx, args) => Privacy.subject.erase(ctx, args),
      remap: (ctx, args) => Privacy.subject.remap(ctx, args),
    },
  },

  mcp: Mcp.default,
};
