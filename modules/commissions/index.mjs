// Commandes — file de commandes (« commissions ») pour une créatrice : un état clair (ouvert / complet / fermé, avec les places libres), des formules,
// un formulaire court, un lien de suivi privé pour chaque cliente, et une liste de demandes simple pour l'équipe. Aucun paiement, jamais d'argent.
//
// Pour comprendre le module, lire dans cet ordre : lib.mjs (outils et bornes) → data.mjs (les données) → routes.mjs (les envois de la visiteuse, protégés) →
// public.mjs (les pages) → admin.mjs (l'équipe) → book.mjs (Contacts, facultatif) → mailer.mjs (e-mails, facultatifs) → privacy.mjs, export.mjs, mcp.mjs.
// Les fichiers voisins sont chargés avec la version du module (`?v=`) : sans cela, une mise à jour garderait l'ancien code en mémoire.
const v = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const P = await import(`./public.mjs${v}`);
const R = (await import(`./routes.mjs${v}`)).default;
const A = await import(`./admin.mjs${v}`);
const X = await import(`./export.mjs${v}`);
const privacy = (await import(`./privacy.mjs${v}`)).default;
const mcp = (await import(`./mcp.mjs${v}`)).default;

/**
 * Efface les commandes terminées depuis plus de `keepMonths` mois (par défaut 12 ; 0 = jamais). Les commandes en cours ne sont jamais touchées.
 * Au plus 200 par passage ; rejouée, elle ne fait rien de plus. C'est le planificateur du cœur qui l'appelle (une fois par jour), pas un minuteur du module.
 */
export async function purgeFinished(ctx, now = Date.now()) {
  const months = L.num(ctx.setting("keepMonths"), 12, 0, 120);
  if (months === 0) return { removed: 0 };
  const cutoff = now - months * 30.44 * L.DAY;
  let removed = 0;
  for (const o of await D.listOrders(ctx)) {
    if (removed >= L.LIMITS.purgeBatch) break;
    if (L.FINISHED.includes(o.status) && D.lastChange(o) < cutoff) { await D.removeOrder(ctx, o.id); removed++; }
  }
  return { removed };
}

export default {
  page: P.page,
  sections: { status: P.statusSection },
  routes: R,
  adminPanel: A.adminPanel,
  adminActions: A.adminActions,
  adminDownloads: X.downloads,
  adminBadge: A.adminBadge,
  mcp,
  services: { "privacy.subject": privacy },
  tasks: { cleanup: { everyMinutes: 1440, run: (ctx) => purgeFinished(ctx) } },
  backup: { readable: X.readable },
  hooks: { async onInstanceDelete(ctx) { L.forgetInstance(ctx.instance.key); } },
};
