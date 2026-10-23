// VIE PRIVÉE (service `privacy.subject`, appelé par Contacts seulement) : ce que le mur sait d'une fiche, et comment l'oublier.
// Le module garde, par fiche : UN message court (de la propriétaire) et, s'il y en a, les mois où la personne a été mise à l'honneur. Rien d'autre (ni nom, ni photo : ils restent dans Contacts).
// Les trois méthodes ne lèvent jamais, ne font aucun appel à Contacts, sont rejouables, et répondent 0 pour une fiche inconnue ou des arguments absurdes.
const v = new URL(import.meta.url).search;
const D = await import(`./data.mjs${v}`);
const { idOk } = await import(`./pure.mjs${v}`);

export const subject = {
  async export(ctx, args) {
    const label = ctx.t("privacyLabel") || "Thank-you wall";
    try {
      if (!idOk(args?.contactId)) return { label, data: {} };
      const refs = await D.referencesOf(ctx, args.contactId);
      return { label, data: { message: refs.message ? refs.message.texts : null, honoured: refs.honors.map((h) => ({ month: h.month, text: h.why })) } };
    } catch { return { label, data: {} }; }
  },
  async erase(ctx, args) {
    try { return idOk(args?.contactId) ? { removed: await D.eraseReferences(ctx, args.contactId) } : { removed: 0 }; } catch { return { removed: 0 }; }
  },
  async remap(ctx, args) {
    try { return idOk(args?.from) && idOk(args?.to) && args.from !== args.to ? { updated: await D.remapReferences(ctx, args.from, args.to) } : { updated: 0 }; } catch { return { updated: 0 }; }
  },
};
