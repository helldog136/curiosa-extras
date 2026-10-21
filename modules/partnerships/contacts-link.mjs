// Partenariats — l'UNIQUE point de contact avec le module Contacts : appels au service « contact.book » et liens (`contactIds`) des fiches.
// Aucune coordonnée de personne n'est stockée ici, seulement des identifiants.
// ── Carnet unique : des RÉFÉRENCES vers le module Contacts ────────────────────────────────────────────────────
export const CONTACTS = "contact.book";
export const MAX_LINKS = 50;
export const ID_MAX = 80;
export const esc = (v) => String(v ?? "").replace(/[\\`*_{}[\]()<>#+!|&~]/g, (c) => `\\${c}`).replace(/\s+/g, " ");
export const idOk = (v) => typeof v === "string" && v.length > 0 && v.length <= ID_MAX;
export const linksOf = (p) => (Array.isArray(p.data.contactIds) ? [...new Set(p.data.contactIds.filter(idOk))] : []).slice(0, MAX_LINKS);
export const person = (c) => ({ id: c.id, name: c.name, role: c.role ?? null, email: c.email ?? null });

/** Bornes d'attente (ms) : chaque appel au carnet, et le temps total d'une reprise. Modifiables pour les tests seulement. */
export const timing = { callMs: 5000, budgetMs: 40_000 };
/** Une attente bornée : rend `fallback` si `p` ne répond pas à temps (ou échoue). Le minuteur est toujours libéré. */
export function within(p, ms, fallback = null) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([Promise.resolve(p).catch(() => fallback), late]).finally(() => clearTimeout(timer));
}

/** Appelle le service « contact.book » (attente bornée). Ne lève jamais : { ok: true, … } | { ok: false, unavailable: true } (module absent, désactivé, trop ancien ou muet) | { ok: false, error }. */
export async function book(ctx, method, args) {
  const r = await within(Promise.resolve().then(() => ctx.api.services.call(CONTACTS, method, args)), timing.callMs, null);
  if (!r?.ok) return { ok: false, unavailable: true };
  const v = r.value;
  if (v && typeof v === "object" && v.ok === true) return v;
  return { ok: false, error: typeof v?.error === "string" ? v.error : "invalid", id: v?.id };
}
export async function bookAvailable(ctx) {
  return !!(await within(Promise.resolve().then(() => ctx.api.services.available(CONTACTS)), timing.callMs, false));
}

/**
 * Les fiches Contacts derrière des identifiants : { available, cards (dans l'ordre), missing (supprimées du carnet), moved (fiche fusionnée : { ancien: gardé }) }.
 * Une fiche fusionnée avec une autre est suivie : on rend la fiche gardée (le lien se corrige avec `healLinks`).
 */
export async function resolveLinks(ctx, ids) {
  if (!ids.length) return { available: await bookAvailable(ctx), cards: [], missing: [], moved: {} };
  const r = await book(ctx, "resolve", { ids });
  if (!r.ok) return { available: false, cards: [], missing: [], moved: {} };
  const by = new Map(r.contacts.map((c) => [c.id, c]));
  const moved = {};
  for (const [from, to] of Object.entries(r.moved && typeof r.moved === "object" ? r.moved : {})) if (idOk(from) && idOk(to) && ids.includes(from)) moved[from] = to;
  const lost = Object.values(moved).filter((to) => !by.has(to));
  if (lost.length) {
    const more = await book(ctx, "resolve", { ids: [...new Set(lost)] });
    if (more.ok) for (const c of more.contacts) by.set(c.id, c);
  }
  const target = (id) => (id in moved ? moved[id] : id);
  const shown = [...new Set(ids.map(target))];
  return { available: true, cards: shown.filter((id) => by.has(id)).map((id) => by.get(id)), missing: ids.filter((id) => !by.has(target(id))), moved };
}

/** Corrige les liens d'une fiche dont une personne a été fusionnée dans une autre (au cas où `remap` n'a pas été reçu). Sans doublon, sans dépasser la limite. */
export async function healLinks(ctx, partner, moved) {
  if (!moved || !Object.keys(moved).length) return;
  const ids = linksOf(partner);
  const next = [...new Set(ids.map((id) => moved[id] ?? id))];
  if (next.length !== ids.length || next.some((id, i) => id !== ids[i])) await setLinks(ctx, partner, next, "contacts");
}

export async function setLinks(ctx, partner, ids, by) {
  partner.data = { ...partner.data, contactIds: ids, updatedBy: by };
  await ctx.api.store.update(partner.id, partner.data);
}

