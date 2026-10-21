// Simule, dans un test de module, ce que fait le cœur (0.2.4) pour `ctx.api.services.call(service, méthode, args, { asCaller: true })` lancé dans une action
// d'administration : le fournisseur reçoit les droits de la personne qui a cliqué. Indépendant de la version du cœur qui fait tourner les tests (le faux contexte du cœur
// ne connaît pas encore `asCaller`). `carried: false` : un cœur plus ancien, qui ignore l'option (la réponse reste « denied »).
//   const seen = carryRights(ctx, book, { rights: ["categories.create"] });   // seen : [{ service, method, asCaller }]
export function carryRights(ctx, book, { rights = ["categories.create"], carried = true } = {}) {
  const base = ctx.api.services.call;
  const seen = [];
  ctx.api.services.call = async (service, method, args, opts) => {
    seen.push({ service, method, asCaller: opts?.asCaller === true });
    if (carried && opts?.asCaller === true && service === "contact.book" && method === "createCategory") {
      try { return { ok: true, value: await book.asViewer(rights).createCategory(args) }; } catch { return { ok: false, reason: "failed" }; }
    }
    return base(service, method, args, opts);
  };
  return seen;
}
