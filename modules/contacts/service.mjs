// Contacts — les services offerts aux autres modules : « contact.store » (formulaire de contact, inchangé) et « contact.book » version 2
// (sur-ensemble de la v1 : Partenariats garde `min: 1`). Contrat : tests/contract/README.md du dépôt ; suite exécutable : tests/contract/contactBook.contract.mjs.
// AUCUNE méthode de « contact.book » ne lève : { ok: true, … } ou { ok: false, error }. Si l'index du carnet ou le stockage ne répond pas dans le
// temps imparti : { ok: false, error: "busy" } (réessayer plus tard).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const B = await import(`./book.mjs${v}`);

/** Enveloppe : jamais d'exception vers l'appelant. */
const safe = (fn) => async (ctx, args) => {
  try { return await fn(ctx, args); } catch (e) { if (e?.code !== "busy") console.error("[contacts] contact.book:", e?.message ?? e); return { ok: false, error: "busy" }; }
};

export default {
  services: {
    "contact.store": {
      // Un message du formulaire : fiche « à vérifier » (ou note ajoutée à la fiche du même e-mail). Lève si le nom manque ou si le carnet est plein (comportement 1.x).
      async add(ctx, args) { return B.storeAdd(ctx, args, ctx.t("formNote")); },
    },
    "contact.book": {
      get: safe(async (ctx, a) => { const r = await B.get(ctx, a); return r.ok ? { ok: true, contact: r.contact } : r; }),
      resolve: safe(B.resolve),
      find: safe(B.find),
      create: safe((ctx, a) => B.create(ctx, a)),
      update: safe((ctx, a) => B.update(ctx, a)),
      note: safe(B.note),
      accounts: safe(B.accounts),
      search: safe(B.search),
      list: safe(B.list),
      categories: safe(B.categories),
      categoriesResolve: safe(B.categoriesResolve),
      // Exige le droit « categories.create » de la personne connectée : en cœur 0.2.x, vrai seulement dans le « create » d'un réglage `choice`.
      createCategory: safe((ctx, a) => B.createCategory(ctx, a)),
      setAccountProfile: safe(B.setAccountProfile),
      upsertByAccount: safe(B.upsertByAccount),
      merge: safe(async (ctx, a) => { const r = await B.merge(ctx, a); return r.ok ? { ok: true, id: r.id, remapped: r.remapped.map(({ module, ok }) => ({ module, ok })) } : r; }),
      import: safe(B.importRows),
      erase: safe(async (ctx, a) => { const r = await B.erase(ctx, a); return r.ok ? { ok: true, modules: r.modules.map(({ name: _n, ...m }) => m) } : r; }),
    },
    // Extension additive de « contact.book » v2 (README du contrat) : ce que Raid demande en plus. Jamais de nom, d'e-mail ni de téléphone dans les réponses, sauf le nom de fiche de `searchAccounts`.
    "contact.curate": {
      lookupAccounts: safe(B.lookupAccounts),
      searchAccounts: safe(B.searchAccounts),
      addAccount: safe(B.addAccountTo),
      removeCategory: safe(B.removeCategory),
    },
  },
};
