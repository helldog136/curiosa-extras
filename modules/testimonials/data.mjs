// Témoignages — lire et écrire les avis. Un avis = un document du stockage de l'instance (collection « reviews »).
// Rien n'est copié ailleurs : le module est le seul propriétaire de ces données (nom, texte, note, accord, adresse e-mail facultative).
const v = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${v}`);

/** Les avis, les plus récents d'abord, 500 par lecture et 1 000 au plus au total (un export les lit ainsi, morceau par morceau). */
export async function* eachReview(ctx) {
  let cursor = null, seen = 0;
  for (let i = 0; i < 3; i++) {
    const page = await ctx.api.store.page(L.COLLECTION, { limit: 500, cursor: cursor ?? undefined, order: "desc" });
    for (const row of page?.items ?? []) { if (seen++ >= L.MAX_STORED) return; yield L.normalize(row); }
    if (!page?.next) return;
    cursor = page.next;
  }
}
export async function readAll(ctx) {
  const out = [];
  for await (const r of eachReview(ctx)) out.push(r);
  return out;
}
export const readPublic = async (ctx) => (await readAll(ctx)).filter(L.isPublic);

export async function readOne(ctx, id) {
  const row = typeof id === "string" && id && id.length <= 100 ? await ctx.api.store.get(id) : null;
  return row ? L.normalize(row) : null;
}

/** Retrouve l'avis qui porte ce lien privé (on compare des empreintes : le lien lui-même n'est jamais gardé). */
export async function findByToken(ctx, token) {
  if (!/^[0-9a-f]{32}$/.test(String(token))) return null;
  const hash = L.hashToken(token);
  return (await readAll(ctx)).find((r) => r.tokenHash && L.same(r.tokenHash, hash)) ?? null;
}

export const create = (ctx, review) => ctx.api.store.add(L.COLLECTION, L.toDoc(review));
/** Remplace l'avis (le stockage remplace tout le document : on réécrit tout). */
export const save = (ctx, review) => ctx.api.store.update(review.id, L.toDoc(review));
export const remove = (ctx, id) => ctx.api.store.remove(id);

// ── Brouillons d'un formulaire à corriger ──────────────────────────────────────────────────────────────────────
// Quand un avis est refusé par le formulaire (note manquante, case non cochée…), on garde ce que la personne a écrit 30 minutes pour qu'elle
// ne retape rien. Jamais plus : ils sont effacés dès qu'ils sont périmés, et l'accord (la case à cocher) n'est jamais conservé.
export async function readDrafts(ctx) {
  const page = await ctx.api.store.page(L.DRAFTS, { limit: L.MAX_DRAFTS + 50, order: "desc" });
  return (page?.items ?? []).map((r) => ({ id: r.id, ref: String(r.data?.ref ?? ""), at: Date.parse(String(r.data?.at ?? "")) || 0, values: r.data?.values ?? {}, errors: r.data?.errors ?? {} }));
}
export async function purgeDrafts(ctx, now = Date.now(), keep = L.MAX_DRAFTS) {
  let removed = 0;
  const drafts = await readDrafts(ctx);
  const fresh = drafts.filter((d) => now - d.at < L.DRAFT_TTL);
  for (const d of drafts) if (now - d.at >= L.DRAFT_TTL) { await ctx.api.store.remove(d.id); removed++; }
  for (const d of fresh.slice(keep)) { await ctx.api.store.remove(d.id); removed++; }   // trop de brouillons : les plus anciens partent
  return removed;
}
export async function saveDraft(ctx, values, errors, now = Date.now()) {
  await purgeDrafts(ctx, now, L.MAX_DRAFTS - 1);                 // la place du nouveau brouillon est comptée
  const ref = L.newRef();
  const safe = {
    name: L.clean(values.name, L.FIELD_MAX.name), text: L.clean(values.text, L.FIELD_MAX.text, true),
    email: L.clean(values.email, L.FIELD_MAX.email), rating: L.isRating(values.rating) ? values.rating : null,
  };
  await ctx.api.store.add(L.DRAFTS, { ref, at: new Date(now).toISOString(), values: safe, errors });
  return ref;
}
export async function findDraft(ctx, ref, now = Date.now()) {
  if (!/^[0-9a-f]{24}$/.test(String(ref))) return null;
  const d = (await readDrafts(ctx)).find((x) => x.ref === ref);
  return d && now - d.at < L.DRAFT_TTL ? d : null;
}

// ── Ménage ─────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Ce qui ne doit pas rester : les adresses e-mail au bout de leur durée de conservation (l'avis, lui, reste), les avis refusés depuis plus de
 * 30 jours (effacés), les brouillons périmés. Idempotent : le rejouer ne change plus rien.
 */
export async function tidy(ctx, now = Date.now()) {
  const report = { emails: 0, refused: 0, drafts: 0 };
  for (const r of await readAll(ctx)) {
    if (r.email && r.emailUntil > 0 && r.emailUntil <= now) { await save(ctx, { ...r, email: null, emailUntil: 0 }); report.emails++; }
    else if (r.email && r.emailUntil === 0) { await save(ctx, { ...r, email: null }); report.emails++; }      // adresse sans date de fin : on ne garde pas ce qu'on ne sait pas dater
    if (r.status === "rejected" && r.decidedAt > 0 && now - r.decidedAt > L.REFUSED_KEEP_DAYS * L.DAY) { await remove(ctx, r.id); report.refused++; }
  }
  report.drafts = await purgeDrafts(ctx, now);
  return report;
}
