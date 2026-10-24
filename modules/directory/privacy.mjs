// VIE PRIVÉE (service `privacy.subject`, appelé par Contacts seulement) : ce que l'annuaire sait d'une fiche, et comment l'oublier.
// Le module garde, par fiche : une présentation courte, une ville (et ses coordonnées arrondies à la ville), « masquée dans cet annuaire », et le titre dans l'équipe. Rien d'autre
// (ni nom, ni photo, ni compte : ils restent dans Contacts).
// Les trois méthodes ne lèvent jamais, ne font aucun appel à Contacts, sont rejouables, et répondent 0 pour une fiche inconnue ou des arguments absurdes.
const v = new URL(import.meta.url).search;
const D = await import(`./data.mjs${v}`);
const { idOk } = await import(`./pure.mjs${v}`);

export const subject = {
  async export(ctx, args) {
    const label = ctx.t("privacyLabel") || "Directory";
    try {
      if (!idOk(args?.contactId)) return { label, data: {} };
      const refs = await D.referencesOf(ctx, args.contactId);
      return {
        label,
        data: {
          presentation: refs.profile ? { bio: refs.profile.bio, city: refs.profile.city || null, mapPosition: refs.profile.geo, hiddenHere: refs.profile.hidden } : null,
          team: refs.team ? { role: refs.team.role } : null,
        },
      };
    } catch { return { label, data: {} }; }
  },
  async erase(ctx, args) {
    try { return idOk(args?.contactId) ? { removed: await D.eraseReferences(ctx, args.contactId) } : { removed: 0 }; } catch { return { removed: 0 }; }
  },
  async remap(ctx, args) {
    try { return idOk(args?.from) && idOk(args?.to) && args.from !== args.to ? { updated: await D.remapReferences(ctx, args.from, args.to) } : { updated: 0 }; } catch { return { updated: 0 }; }
  },
};
