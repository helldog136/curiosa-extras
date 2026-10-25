// VIE PRIVÉE (service `privacy.subject`, appelé par Contacts seulement) : ce que le module sait d'une fiche, et comment l'oublier.
// Le module garde, par soutien rangé dans cette fiche : la plateforme, le numéro de membre (ou une empreinte), les paliers (noms), la date de début, le dernier signe, l'état, l'accord (pseudo choisi et date).
// Rien d'autre : ni montant, ni e-mail, ni nom (le nom vit dans Contacts). Les trois méthodes ne lèvent jamais, ne font aucun appel à Contacts, sont rejouables, et répondent 0 pour une fiche inconnue.
const v = new URL(import.meta.url).search;
const D = await import(`./data.mjs${v}`);
const { idOk } = await import(`./pure.mjs${v}`);

export const subject = {
  async export(ctx, args) {
    const label = ctx.t("privacyLabel") || "Supporters";
    try {
      if (!idOk(args?.contactId)) return { label, data: {} };
      const snap = await D.snapshot(ctx, { fresh: true });
      const rows = await D.referencesOf(ctx, args.contactId);
      return {
        label,
        data: {
          supporters: rows.map(({ data: p }) => ({
            platform: p.provider, memberKey: p.k, since: p.since, lastSeen: p.last, status: p.status, hiddenByOwner: p.hidden === true,
            tiers: (p.tiers ?? []).map((k) => snap.tiers.get(k)?.data.name ?? k),
            agreement: p.consent ? { nickname: p.consent.pseudo, on: p.consent.at, approved: p.approved === true } : null,
          })),
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
