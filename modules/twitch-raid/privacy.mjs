// VIE PRIVÉE (service `privacy.subject`, appelé par Contacts seulement) : ce que Raid sait d'une fiche de Contacts, et comment l'oublier.
// Raid ne garde aucune donnée sur les personnes, sauf deux restes de la migration 1.x → 2.0 (à retirer en phase 3) :
//   - `pending` : les ids des fiches recopiées pas encore rangées dans la catégorie (voir migrate.mjs) ;
//   - l'ancienne liste (copie inerte : pseudo, nom, note) : une personne effacée dans Contacts en est retirée aussi (ses pseudos Twitch sont lus
//     dans Contacts, qui appelle `erase` AVANT de supprimer la fiche).
// Chaque méthode répond (jamais d'exception) ; une fiche inconnue ou des arguments absurdes donnent 0. Tout appel à Contacts est borné.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const data = await import(`./data.mjs${v}`);
const source = await import(`./source.mjs${v}`);
const migrate = await import(`./migrate.mjs${v}`);
const { normalizeLogin } = await import(`./pure.mjs${v}`);

export const timing = { callMs: 3000 };
const isId = (x) => typeof x === "string" && x.length > 0 && x.length <= 80;

/** Les pseudos Twitch de cette fiche, lus dans Contacts (borné) ; [] si Contacts ne répond pas. */
async function loginsOf(ctx, contactId) {
  const r = await source.ask(ctx, "accounts", { network: "twitch", ids: [contactId], limit: source.PAGE }, timing.callMs);
  if (!r.ok || !Array.isArray(r.value.items)) return [];
  return r.value.items.filter((x) => x?.id === contactId).map((x) => normalizeLogin(x.handle).login).filter(Boolean);
}

export const subject = {
  async export(ctx, args) {
    const label = ctx.t("privacy_label") || "Twitch raid";
    try {
      const id = isId(args?.contactId) ? args.contactId : null;
      if (!id) return { label, data: {} };
      const st = await migrate.readState(ctx);
      const logins = new Set(await loginsOf(ctx, id));
      const previous = logins.size ? (await data.readLegacy(ctx)).filter((p) => logins.has(p.login)).map((p) => ({ channel: p.login, name: p.name, note: p.note })) : [];
      return { label, data: { waitingForCategory: st.pending.includes(id), previousList: previous } };
    } catch { return { label, data: {} }; }
  },
  async erase(ctx, args) {
    try {
      const id = isId(args?.contactId) ? args.contactId : null;
      if (!id) return { removed: 0 };
      let removed = 0;
      const st = await migrate.readState(ctx);
      if (st.pending.includes(id)) { st.pending = st.pending.filter((x) => x !== id); await migrate.writeState(ctx, st); removed++; }
      removed += await data.forgetLegacy(ctx, await loginsOf(ctx, id));
      if (removed) source.resetSource();
      return { removed };
    } catch { return { removed: 0 }; }
  },
  async remap(ctx, args) {
    try {
      const from = isId(args?.from) ? args.from : null, to = isId(args?.to) ? args.to : null;
      if (!from || !to || from === to) return { updated: 0 };
      const st = await migrate.readState(ctx);
      if (!st.pending.includes(from)) return { updated: 0 };
      st.pending = [...new Set(st.pending.map((x) => (x === from ? to : x)))];
      await migrate.writeState(ctx, st);
      source.resetSource();
      return { updated: 1 };
    } catch { return { updated: 0 }; }
  },
};
