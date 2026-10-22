// Mur des remerciements — ce que le module GARDE, et rien d'autre : deux petites collections, toujours rattachées à une fiche par son identifiant.
//   messages : { contactId, texts: { fr: "…", en: "…" } }   un mot court par personne (160 caractères au plus)
//   honors   : { month: "2026-10", contactId, why: { fr: "…" } }   la personne mise à l'honneur un mois donné (une par mois)
// Ni nom, ni photo, ni pseudo : tout cela reste dans Contacts et se relit à chaque affichage (voir contacts.mjs). Les lectures passent par une petite mémoire de 30 secondes
// (vidée à chaque écriture) pour qu'une page publique très visitée ne relise pas le stockage à chaque fois.
import { LIMITS, clean, idOk, monthOk } from "./pure.mjs";

export const MESSAGES = "messages";
export const HONORS = "honors";
export const READ_TTL_MS = 30_000;

const memo = new Map(); // « instance » → { at, messages: Map(contactId → { id, texts }), honors: [{ id, month, contactId, why }] }
export const forgetData = (ctx) => { if (ctx) memo.delete(ctx.instance.id); else memo.clear(); };

async function readAll(ctx, collection, max) {
  const out = [];
  let cursor = null;
  do {
    const page = typeof ctx.api.store.page === "function"
      ? await ctx.api.store.page(collection, { limit: Math.min(1000, max - out.length || 1), cursor, order: "asc" })
      : { items: await ctx.api.store.list(collection, { limit: max }), next: null };
    out.push(...page.items);
    cursor = page.next;
  } while (cursor && out.length < max);
  return out.slice(0, max);
}

/** { messages: Map(contactId → { id, texts }), honors: [{ id, month, contactId, why }] } ; ne lève pas pour des documents abîmés (ils sont ignorés). */
export async function readData(ctx, { fresh = false } = {}) {
  const hit = memo.get(ctx.instance.id);
  if (!fresh && hit && Date.now() - hit.at < READ_TTL_MS) return hit;
  const messages = new Map();
  for (const r of await readAll(ctx, MESSAGES, LIMITS.messages + 50)) {
    const d = r.data;
    if (!idOk(d?.contactId) || !d.texts || typeof d.texts !== "object") continue;
    if (!messages.has(d.contactId)) messages.set(d.contactId, { id: r.id, texts: textsOf(d.texts, LIMITS.message) });
  }
  const honors = [];
  const seenMonth = new Set();
  for (const r of await readAll(ctx, HONORS, LIMITS.honors + 10)) {
    const d = r.data;
    if (!monthOk(d?.month) || !idOk(d?.contactId) || seenMonth.has(d.month)) continue;
    seenMonth.add(d.month);
    honors.push({ id: r.id, month: d.month, contactId: d.contactId, why: textsOf(d.why, LIMITS.why) });
  }
  honors.sort((a, b) => (a.month < b.month ? 1 : -1));
  const value = { at: Date.now(), messages, honors };
  memo.set(ctx.instance.id, value);
  return value;
}

/** Les textes par langue d'un document : seulement des chaînes, 12 langues au plus, nettoyées et coupées. */
function textsOf(raw, max) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [l, v] of Object.entries(raw).slice(0, 12)) if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(l) && typeof v === "string") { const t = clean(v, max, max > LIMITS.message); if (t) out[l] = t; }
  return out;
}
export const cleanTexts = textsOf;

/* ───────────── Messages ───────────── */

/** Pose (ou remplace) le message d'une fiche. `texts` vide : le message est retiré. Rend { ok: true, removed? } ou { ok: false, error: "too_many" | "invalid" }. */
export async function setMessage(ctx, contactId, texts) {
  if (!idOk(contactId)) return { ok: false, error: "invalid" };
  const clean_ = textsOf(texts, LIMITS.message);
  const data = await readData(ctx, { fresh: true });
  const old = data.messages.get(contactId);
  if (!Object.keys(clean_).length) {
    if (old) await ctx.api.store.remove(old.id);
    forgetData(ctx);
    return { ok: true, removed: !!old };
  }
  if (old) await ctx.api.store.update(old.id, { contactId, texts: clean_ });
  else {
    if (data.messages.size >= LIMITS.messages) return { ok: false, error: "too_many" };
    await ctx.api.store.add(MESSAGES, { contactId, texts: clean_ });
  }
  forgetData(ctx);
  return { ok: true };
}

/* ───────────── Mises à l'honneur ───────────── */

/** Pose (ou remplace) la mise à l'honneur d'un mois. */
export async function setHonor(ctx, { month, contactId, why }) {
  if (!monthOk(month) || !idOk(contactId)) return { ok: false, error: "invalid" };
  const data = await readData(ctx, { fresh: true });
  const doc = { month, contactId, why: textsOf(why, LIMITS.why) };
  const old = data.honors.find((h) => h.month === month);
  if (old) await ctx.api.store.update(old.id, doc);
  else {
    // Borné : au-delà de 24 mises à l'honneur, les plus anciennes (mois passés) sont retirées pour faire de la place.
    const keep = LIMITS.honors - 1;
    const extra = [...data.honors].sort((a, b) => (a.month < b.month ? -1 : 1)).slice(0, Math.max(0, data.honors.length - keep));
    for (const h of extra) await ctx.api.store.remove(h.id);
    await ctx.api.store.add(HONORS, doc);
  }
  forgetData(ctx);
  return { ok: true };
}

export async function clearHonor(ctx, month) {
  if (!monthOk(month)) return { ok: false, error: "invalid" };
  const data = await readData(ctx, { fresh: true });
  const old = data.honors.find((h) => h.month === month);
  if (old) await ctx.api.store.remove(old.id);
  forgetData(ctx);
  return { ok: true, removed: !!old };
}

/* ───────────── Vie privée : tout ce que le module sait d'une fiche ───────────── */

/** Les documents (messages et mises à l'honneur) qui visent cette fiche. */
export async function referencesOf(ctx, contactId) {
  const data = await readData(ctx, { fresh: true });
  const msg = data.messages.get(contactId);
  return { message: msg ?? null, honors: data.honors.filter((h) => h.contactId === contactId) };
}

/** Efface tout ce qui vise cette fiche ; rend le nombre de documents retirés. */
export async function eraseReferences(ctx, contactId) {
  let removed = 0;
  // Toutes les lignes visant la fiche, même des doublons que `readData` aurait écartés.
  for (const r of await readAll(ctx, MESSAGES, LIMITS.messages + 50)) if (r.data?.contactId === contactId) { await ctx.api.store.remove(r.id); removed++; }
  for (const r of await readAll(ctx, HONORS, LIMITS.honors + 10)) if (r.data?.contactId === contactId) { await ctx.api.store.remove(r.id); removed++; }
  forgetData(ctx);
  return removed;
}

/** Une fiche en a absorbé une autre : les documents de `from` passent sur `to`. Le message déjà écrit pour `to` est gardé (jamais écrasé). Rend le nombre de documents changés. */
export async function remapReferences(ctx, from, to) {
  let updated = 0;
  const target = (await readData(ctx, { fresh: true })).messages.get(to);
  let targetHas = !!target;
  for (const r of await readAll(ctx, MESSAGES, LIMITS.messages + 50)) {
    if (r.data?.contactId !== from) continue;
    if (targetHas) await ctx.api.store.remove(r.id); else { await ctx.api.store.update(r.id, { ...r.data, contactId: to }); targetHas = true; }
    updated++;
  }
  for (const r of await readAll(ctx, HONORS, LIMITS.honors + 10)) if (r.data?.contactId === from) { await ctx.api.store.update(r.id, { ...r.data, contactId: to }); updated++; }
  forgetData(ctx);
  return updated;
}

/** Les identifiants de fiche gardés (messages et mises à l'honneur), sans doublon : de quoi vérifier qu'ils existent encore chez Contacts. */
export async function keptIds(ctx) {
  const data = await readData(ctx, { fresh: true });
  return [...new Set([...data.messages.keys(), ...data.honors.map((h) => h.contactId)])];
}
