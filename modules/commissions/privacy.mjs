// Commandes — le service « privacy.subject » (contrat 11.4) : ce que le module garde sur UNE fiche du carnet, c'est-à-dire les commandes qui y sont reliées.
// Contacts l'appelle pour exporter, effacer ou rediriger (fusion de deux fiches). Jamais d'exception, 0 pour une fiche inconnue ou un argument absurde,
// et chaque méthode est idempotente. L'effacement supprime les commandes reliées à la personne (son pseudo, sa demande, son lien de suivi).
const v = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const { idOk } = L;

const EXPORT_MAX = 200;   // commandes détaillées dans un export (la réponse reste très en dessous de 1 Mo)
const holders = async (ctx, contactId) => (await D.listOrders(ctx)).filter((o) => o.contactId === contactId);
const label = (ctx) => { const s = typeof ctx.t === "function" ? ctx.t("privacyLabel") : ""; return s && s !== "privacyLabel" ? s : "Commissions"; };

export default {
  async export(ctx, args) {
    const contactId = args && idOk(args.contactId) ? args.contactId : null;
    if (!contactId) return { label: label(ctx), data: { count: 0, orders: [] } };
    const found = await holders(ctx, contactId);
    return {
      label: label(ctx),
      data: { count: found.length, orders: found.slice(0, EXPORT_MAX).map((o) => ({ id: o.id, status: o.status, formula: o.formulaName || null, request: o.want.slice(0, 300), message: o.clientNote || null, note: o.privateNote.slice(0, 300) || null, receivedAt: o.at.toISOString() })) },
    };
  },
  async erase(ctx, args) {
    const contactId = args && idOk(args.contactId) ? args.contactId : null;
    if (!contactId) return { removed: 0 };
    let removed = 0;
    for (const o of await holders(ctx, contactId)) { await D.removeOrder(ctx, o.id); removed++; }
    return { removed };
  },
  async remap(ctx, args) {
    const from = args && idOk(args.from) ? args.from : null, to = args && idOk(args.to) ? args.to : null;
    if (!from || !to || from === to) return { updated: 0 };
    let updated = 0;
    for (const o of await holders(ctx, from)) { o.contactId = to; await D.saveOrder(ctx, o); updated++; }
    return { updated };
  },
};
