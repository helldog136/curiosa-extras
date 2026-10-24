// Annuaire — module de Curiosa : une vitrine PUBLIQUE des membres, des créateurs, des partenaires… et de l'équipe, alimentée par le carnet Contacts.
//
// Ce que fait ce module, et rien d'autre : CHERCHER et FILTRER une grande liste de personnes (recherche sans accents, catégories, tri, pages par curseur, fiche détaillée, version imprimable
// et CSV). Ce qui appartient aux autres reste chez eux :
//   - les personnes, leurs noms, leurs photos, leurs comptes, leurs catégories et la catégorie « ne pas montrer » : Contacts (service `contact.book`, version 2, besoin obligatoire) ; rien n'en est copié (voir contacts.mjs) ;
//   - à lui : les catégories PUBLIQUES et leur libellé, l'équipe (titre et ordre), et par fiche une présentation courte, une ville et « masquer ici » (voir data.mjs).
// Consentement : le même que le mur des remerciements — c'est la propriétaire qui range une fiche dans une catégorie publique ; « Ne pas montrer » l'emporte toujours ; en option, une catégorie
// « a accepté » devient obligatoire. Aucune saisie de visiteur gardée, aucun cookie. Si Contacts se tait, la page garde le dernier annuaire connu (24 h au plus), puis un message aimable.
// Fichiers : pure.mjs (outils) · data.mjs (ce qu'on garde) · contacts.mjs (lire Contacts) · directory.mjs (vue, recherche, tri, curseurs) · view.mjs (pages publiques) · routes.mjs (recherche, CSV)
//           admin.mjs · templates.mjs (gabarits) · geocode.mjs (ville → carte) · privacy.mjs · mcp.mjs
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const View = await import(`./view.mjs${v}`);
const Admin = await import(`./admin.mjs${v}`);
const Privacy = await import(`./privacy.mjs${v}`);
const Mcp = await import(`./mcp.mjs${v}`);
const Routes = await import(`./routes.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const C = await import(`./contacts.mjs${v}`);
const P = await import(`./pure.mjs${v}`);
const Dir = await import(`./directory.mjs${v}`);

const cell = P.cell;

export default {
  page: (ctx, { segments }) => View.render(ctx, segments),

  routes: Routes.routes,

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

  // CARTE : le sujet `map.place`, SEULEMENT pour les personnes qui ont une ville ET qui sont dans la catégorie « accepte d'être sur la carte » (réglage). Par défaut : rien.
  // Les coordonnées sont celles de la VILLE (arrondies), jamais une adresse.
  exports: {
    "map.place": async (ctx, { limit } = {}) => {
      const model = await C.getModel(ctx, { waitMs: 3000 });
      if (model.state !== "ok" || !model.mapId) return [];
      const data = await D.readData(ctx);
      const view = Dir.getView(ctx, model, data);
      const max = P.int(limit, 50, 1, 200);
      return view.mapPlaces.slice(0, max).map((e) => ({
        id: `directory:${ctx.instance.key}:${e.hash}`, title: e.name, lat: e.geo.lat, lng: e.geo.lng, kind: "member",
        ...(ctx.instance.basePath !== null && ctx.instance.basePath !== undefined ? { url: `${P.sitePath(ctx.instance.basePath)}/p/${e.slug}` } : {}), note: e.city,
      }));
    },
  },

  mcp: Mcp.default,

  // SAUVEGARDE LISIBLE : lisible dans n'importe quel tableur même si le site n'existe plus. Les noms ne sont pas copiés ici (ils vivent dans Contacts) : les lignes portent le numéro de fiche.
  backup: {
    async readable(ctx) {
      const data = await D.readData(ctx, { fresh: true });
      const locales = [...new Set([ctx.defaultLocale, ...ctx.locales])].slice(0, 12);
      const cats = [["slug", "contacts_category_id", ...locales.map((l) => `label_${l}`)].map(cell).join(","), ...data.config.cats.map((c) => [c.slug, c.catId ?? "", ...locales.map((l) => c.label[l] ?? "")].map(cell).join(","))];
      const team = [["position", "contact_id", ...locales.map((l) => `role_${l}`)].map(cell).join(","), ...data.config.team.map((m, i) => [i + 1, m.contactId, ...locales.map((l) => m.role[l] ?? "")].map(cell).join(","))];
      const profiles = [["contact_id", "city", "hidden_here", ...locales.map((l) => `presentation_${l}`)].map(cell).join(","), ...[...data.profiles.entries()].map(([id, p]) => [id, p.city, p.hidden ? "yes" : "", ...locales.map((l) => p.bio[l] ?? "")].map(cell).join(","))];
      return [
        { path: "categories.csv", content: `﻿${cats.join("\r\n")}\r\n` },
        { path: "team.csv", content: `﻿${team.join("\r\n")}\r\n` },
        { path: "profiles.csv", content: `﻿${profiles.join("\r\n")}\r\n` },
      ];
    },
  },

  hooks: {
    // Quand l'instance disparaît, sa mémoire aussi (un annuaire recréé sous la même clé ne doit rien hériter de l'ancien).
    async onInstanceDelete(ctx) { D.forgetData(ctx); C.forgetModel(ctx); },
  },
};
