// Jeu du jour — le pont vers « Participation » (service « audience.session », FACULTATIF) pour le classement de la semaine.
// Toutes les fonctions rendent `null` quand la base n'est pas là (ou ne répond pas à temps) : le jeu continue alors sans classement.
// Une réponse de la base qui dit « non » ({ ok: false, error }) est, elle, une vraie réponse : on la respecte.
export const SERVICE = "audience.session";

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

/** La salle de cette instance : un espace par jeu, jamais partagé avec un autre. */
export const roomOf = (ctx) => `dg:${ctx.instance.key}`.slice(0, 60);

/** Ce qu'il faut savoir de la connexion pour la freiner : l'empreinte salée du cœur (jamais l'adresse) ; la base la brouille encore une fois. */
export const connOf = (fingerprint) => ({ forwarded: String(fingerprint ?? "") });

/** Le code d'erreur de la base → la raison montrée au visiteur. */
export const reasonOf = (error) => ({
  limit: "limit", muted: "muted", room_full: "busy", too_many_rooms: "busy", busy: "busy", already: "already", invalid: "invalid",
  pseudo_short: "pseudo_short", pseudo_long: "pseudo_long", pseudo_chars: "pseudo_chars", pseudo_banned: "pseudo_banned", pseudo_taken: "pseudo_taken",
  unknown_participant: "invalid", unknown_room: "invalid",
})[error] ?? "busy";
