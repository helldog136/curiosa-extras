// Commandes — l'UNIQUE point de contact avec le carnet d'adresses (service « contact.book », facultatif).
// Règle : le carnet est propriétaire des personnes. Dès qu'une commande est reliée à une fiche, elle n'en garde que l'identifiant : l'adresse e-mail
// qu'elle avait reçue du formulaire est effacée de la commande, et on la relit dans le carnet quand il faut écrire à la cliente.
// Sans carnet (module absent, désactivé, trop ancien ou muet) tout continue : l'adresse reste dans la commande, rien n'est dupliqué.
const v = new URL(import.meta.url).search;
const D = await import(`./data.mjs${v}`);
const { idOk } = await import(`./lib.mjs${v}`);

export const CONTACTS = "contact.book";
/** Attente maximale (ms) d'un appel au carnet. Modifiable pour les tests seulement. */
export const timing = { callMs: 5000 };

/** Une attente bornée : rend `fallback` si `p` ne répond pas à temps (ou échoue). Le minuteur est toujours libéré. */
export function within(p, ms, fallback = null) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([Promise.resolve(p).catch(() => fallback), late]).finally(() => clearTimeout(timer));
}

/** Appelle le carnet. Ne lève jamais : { ok: true, … } | { ok: false, unavailable: true } | { ok: false, code, id? }. */
export async function call(ctx, method, args) {
  const r = await within(Promise.resolve().then(() => ctx.api.services.call(CONTACTS, method, args)), timing.callMs, null);
  if (!r?.ok) return { ok: false, unavailable: true };
  const value = r.value;
  if (value && typeof value === "object" && value.ok === true) return value;
  return { ok: false, code: typeof value?.error === "string" ? value.error.slice(0, 40) : "invalid", id: idOk(value?.id) ? value.id : undefined };
}
export async function available(ctx) {
  return !!(await within(Promise.resolve().then(() => ctx.api.services.available(CONTACTS)), timing.callMs, false));
}

/**
 * La fiche d'une commande reliée : { state: "none" } (pas reliée) | "unavailable" (carnet muet) | "missing" (fiche effacée) | "found" (+ card).
 * Une fiche fusionnée avec une autre est suivie, et le lien de la commande est corrigé.
 */
export async function cardOf(ctx, order) {
  if (!order.contactId) return { state: "none" };
  const r = await call(ctx, "resolve", { ids: [order.contactId] });
  if (!r.ok) return { state: "unavailable" };
  const moved = r.moved && typeof r.moved === "object" ? r.moved[order.contactId] : null;
  let card = Array.isArray(r.contacts) ? r.contacts.find((c) => c?.id === order.contactId) : null;
  if (!card && idOk(moved)) {
    const more = await call(ctx, "resolve", { ids: [moved] });
    card = more.ok && Array.isArray(more.contacts) ? more.contacts.find((c) => c?.id === moved) ?? null : null;
    if (card) { order.contactId = moved; await D.saveOrder(ctx, order); }
  }
  return card ? { state: "found", card } : { state: "missing" };
}

/** L'adresse e-mail à laquelle écrire : celle de la commande, sinon celle de la fiche du carnet. Jamais d'exception. */
export async function emailOf(ctx, order) {
  if (order.email) return { email: order.email, from: "order" };
  if (!order.contactId) return { email: "", from: null };
  const c = await cardOf(ctx, order);
  const email = c.state === "found" && typeof c.card.email === "string" ? c.card.email.trim().slice(0, 200) : "";
  return { email, from: email ? "contacts" : null };
}

/** Crée (ou retrouve, par e-mail) la fiche du carnet, relie la commande et en efface l'adresse. { ok: true, id, created } | { ok: false, why }. */
export async function linkOrder(ctx, order) {
  if (order.contactId) return { ok: true, id: order.contactId, created: false, already: true };
  const r = await call(ctx, "create", { name: order.nick, ...(order.email ? { email: order.email } : {}), source: "commissions", status: "active" });
  if (!r.ok) return { ok: false, why: r.unavailable ? "unavailable" : r.code === "too_many" ? "too_many" : "failed" };
  const note = ctx.t("bookNote", { formula: order.formulaName || "—" });
  await call(ctx, "note", { id: r.id, text: note, author: "commissions" });          // au mieux : une note manquante ne défait rien
  order.contactId = r.id;
  order.email = "";                                                                  // le carnet est désormais la seule source de l'adresse
  await D.saveOrder(ctx, order);
  return { ok: true, id: r.id, created: r.created === true };
}
