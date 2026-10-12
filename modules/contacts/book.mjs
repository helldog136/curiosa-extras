// Contacts — le carnet : champs, nettoyage, règle de dédoublonnage, lecture des fiches. Aucune autre responsabilité (ni service, ni admin, ni MCP).

// passent par le service « contact.book » pour lire, chercher, créer, corriger ou annoter une fiche.
export const STATUSES = ["to_review", "active"];
export const SOURCES = ["manual", "contact-form", "agent", "partnerships"];
export const FIELDS = { name: 120, role: 120, organisation: 200, email: 200, phone: 60, others: 1000, relation: 300 };
export const fail = (m) => Object.assign(new Error(m), { expose: true });
export const clean = (v, max, multiline = false) => {
  let t = String(v ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "");
  t = multiline ? t.replace(/\n{3,}/g, "\n\n") : t.replace(/\s+/g, " ");
  return t.trim().slice(0, max);
};
export const validEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
export const MAX_CONTACTS = 5000;

export const contacts = async (ctx) => ctx.api.store.list("contacts", { limit: MAX_CONTACTS });
export const notesOf = async (ctx, id) => (await ctx.api.store.list("notes", { limit: 1000 })).filter((n) => n.data.contactId === id);

export function cleanContact(input, previous = {}) {
  const out = { ...previous };
  for (const [key, max] of Object.entries(FIELDS)) {
    if (input[key] === undefined) continue;
    const value = clean(input[key], max, key === "others");
    out[key] = key === "email" ? (validEmail(value) ? value.toLowerCase() : "") : value;
  }
  if (input.status !== undefined && STATUSES.includes(input.status)) out.status = input.status;
  return out;
}

export async function addNote(ctx, contactId, text, author) {
  const t = clean(text, 5000, true);
  if (t) await ctx.api.store.add("notes", { contactId, date: new Date().toISOString().slice(0, 10), author, text: t });
}

// ── Dédoublonnage de « contact.book » ─────────────────────────────────────────────────────────────────────────
// 1. avec une adresse e-mail valide : même adresse, sans tenir compte des majuscules ;
// 2. sans e-mail : même nom ET même organisation (organisations toutes deux vides = identiques), sans tenir compte des majuscules, accents et espaces multiples.
// (« contact.store », lui, ne regroupe que par e-mail : un message de formulaire sans adresse valide reste une fiche à part.)
export const key = (v) => clean(v, 400).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export const sameEmail = (list, email) => list.filter((c) => c.data.email === email);
export const sameNameOrg = (list, name, org) => list.filter((c) => key(c.data.name) === key(name) && key(c.data.organisation) === key(org));
export const isCard = (r) => !!r && typeof r.data?.name === "string" && STATUSES.includes(r.data.status);
export const ID_MAX = 80;
export const idOf = (v) => (typeof v === "string" && v.length > 0 && v.length <= ID_MAX ? v : "");
export const card = (ctx, r) => ({ ...summary(r), adminPath: `/admin/instances/${ctx.instance.id}?contact=${r.id}` });

export const summary = (r) => ({ id: r.id, name: r.data.name, role: r.data.role || null, organisation: r.data.organisation || null, email: r.data.email || null, phone: r.data.phone || null, status: r.data.status, source: r.data.source, createdAt: r.createdAt.toISOString() });
