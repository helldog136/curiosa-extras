// Partenariats — le service « privacy.subject » (contrat 11.4) : ce que le module garde sur UNE fiche Contacts, c'est-à-dire seulement des liens (`contactIds`)
// de ses fiches partenaires. Contacts l'appelle pour exporter, effacer ou rediriger (fusion de doublons) ; jamais d'exception, 0 pour une fiche inconnue ou un argument absurde,
// et chaque méthode est idempotente. Le journal et les fiches elles-mêmes ne contiennent aucune référence à une personne : seul le lien disparaît ou change.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { readAll } = await import(`./data.mjs${v}`);
const { MAX_LINKS, idOk, linksOf } = await import(`./contacts-link.mjs${v}`);

const EXPORT_MAX = 500; // fiches nommées dans un export (la réponse reste très en dessous de 1 Mo)

/** Les fiches partenaires qui renvoient à cette personne (tous les liens sont lus tels que stockés : un lien vers une fiche supprimée reste un lien). */
async function holders(ctx, contactId) {
  const rows = await readAll(ctx, "partners");
  return rows.filter((p) => p.data && p.data.brand !== undefined && linksOf(p).includes(contactId));
}
const text = (ctx, k, fallback) => { const s = typeof ctx.t === "function" ? ctx.t(k) : k; return s && s !== k ? s : fallback; };

export default {
  /** Ce que le module sait de cette personne : les fiches partenaires auxquelles elle est liée. */
  async export(ctx, args) {
    const label = text(ctx, "privacyLabel", "Partnerships");
    const contactId = args && idOk(args.contactId) ? args.contactId : null;
    if (!contactId) return { label, data: { partnerships: [], count: 0 } };
    const found = await holders(ctx, contactId);
    return { label, data: { count: found.length, partnerships: found.slice(0, EXPORT_MAX).map((p) => ({ id: p.id, brand: String(p.data.brand).slice(0, 120), status: p.data.status ?? null })) } };
  },

  /** Retire le lien de toutes les fiches partenaires (les fiches restent). `removed` = nombre de fiches modifiées. */
  async erase(ctx, args) {
    const contactId = args && idOk(args.contactId) ? args.contactId : null;
    if (!contactId) return { removed: 0 };
    let removed = 0;
    for (const p of await holders(ctx, contactId)) {
      await ctx.api.store.update(p.id, { ...p.data, contactIds: linksOf(p).filter((id) => id !== contactId), updatedBy: "privacy" });
      removed++;
    }
    return { removed };
  },

  /** Fusion de deux fiches Contacts : les liens vers `from` pointent désormais vers `to`, sans doublon. `updated` = nombre de fiches partenaires modifiées. */
  async remap(ctx, args) {
    const from = args && idOk(args.from) ? args.from : null, to = args && idOk(args.to) ? args.to : null;
    if (!from || !to || from === to) return { updated: 0 };
    let updated = 0;
    for (const p of await holders(ctx, from)) {
      const next = [...new Set(linksOf(p).map((id) => (id === from ? to : id)))].slice(0, MAX_LINKS);
      await ctx.api.store.update(p.id, { ...p.data, contactIds: next, updatedBy: "privacy" });
      updated++;
    }
    return { updated };
  },
};
