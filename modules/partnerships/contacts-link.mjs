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

/** Appelle le service « contact.book ». Ne lève jamais : { ok: true, … } | { ok: false, unavailable: true } (module absent, désactivé ou trop ancien) | { ok: false, error }. */
export async function book(ctx, method, args) {
  let r;
  try { r = await ctx.api.services.call(CONTACTS, method, args); } catch { r = null; }
  if (!r?.ok) return { ok: false, unavailable: true };
  const v = r.value;
  if (v && typeof v === "object" && v.ok === true) return v;
  return { ok: false, error: typeof v?.error === "string" ? v.error : "invalid", id: v?.id };
}
export async function bookAvailable(ctx) {
  try { return !!(await ctx.api.services.available(CONTACTS)); } catch { return false; }
}

/** Les fiches Contacts derrière des identifiants : { available, cards (dans l'ordre), missing (supprimées du carnet) }. */
export async function resolveLinks(ctx, ids) {
  if (!ids.length) return { available: await bookAvailable(ctx), cards: [], missing: [] };
  const r = await book(ctx, "resolve", { ids });
  if (!r.ok) return { available: false, cards: [], missing: [] };
  const by = new Map(r.contacts.map((c) => [c.id, c]));
  return { available: true, cards: ids.filter((id) => by.has(id)).map((id) => by.get(id)), missing: ids.filter((id) => !by.has(id)) };
}

export async function setLinks(ctx, partner, ids, by) {
  partner.data = { ...partner.data, contactIds: ids, updatedBy: by };
  await ctx.api.store.update(partner.id, partner.data);
}

