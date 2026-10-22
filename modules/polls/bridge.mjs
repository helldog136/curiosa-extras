// Sondages — le pont vers « Participation » (service « audience.session », facultatif).
// Toutes les fonctions rendent `null` quand la base n'est pas là (ou ne répond pas à temps) : l'appelant retombe alors sur son mode autonome.
// Une réponse de la base qui dit « non » ({ ok: false, error }) est, elle, une vraie réponse : on la respecte.
export const SERVICE = "audience.session";
export const REMOTE = "audience.remote";

/** Attente bornée d'une promesse : `fallback` si elle ne répond pas à temps (le délai est toujours libéré). */
export const within = (promise, ms, fallback = null) => new Promise((resolve) => {
  const t = setTimeout(() => resolve(fallback), ms);
  Promise.resolve(promise).then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
});

/** La base est-elle installée ? (réponse rapide ; `false` au moindre doute) */
export async function present(ctx) {
  try { return !!(await within(ctx.api.services.available(SERVICE), 2000, false)); } catch { return false; }
}

/** Appelle une méthode de la base. Rend sa réponse (objet { ok, … }) ou `null` si elle est absente, en panne ou trop lente. */
export async function audience(ctx, method, args) {
  try {
    const r = await within(ctx.api.services.call(SERVICE, method, args), 3000, null);
    return r && r.ok && r.value && typeof r.value === "object" ? r.value : null;
  } catch { return null; }
}

/** La salle de cette instance : un espace par module, jamais partagé avec un autre. */
export const roomOf = (ctx) => `polls:${ctx.instance.key}`.slice(0, 60);

/** Ce qu'il faut savoir de la connexion pour la freiner : la base la brouille tout de suite (rien n'est gardé ici). */
export const connOf = (request) => ({ forwarded: request.headers.get("x-forwarded-for") ?? "", real: request.headers.get("x-real-ip") ?? "" });

/** Le code d'erreur de la base → la raison montrée par la page de vote. */
export const reasonOf = (error) => ({ limit: "limit", muted: "muted", room_full: "full", too_many_rooms: "busy", busy: "busy", already: "already", invalid: "invalid", unknown_participant: "invalid", unknown_room: "invalid" })[error] ?? "busy";

/** Publie l'état « en direct » (écran OBS et page publique). Silencieux : le direct est un plus. */
export async function publish(ctx, channel, data, opts = {}) {
  return audience(ctx, "livePublish", { room: roomOf(ctx), channel, data, ...opts });
}
