// MIGRATION 1.x → 2.0 (données 3) : l'ancienne liste propre au module (document « partners » : pseudo, nom, note) part dans Contacts. À RETIRER EN PHASE 3.
//
// Ce qui se passe, dans l'ordre :
//   1. chaque pseudo devient (ou retrouve) une fiche de Contacts : `upsertByAccount({ network: "twitch", handle, name, source: "twitch-raid", note })`.
//      C'est idempotent (même compte = même fiche, nom existant jamais écrasé, même note jamais doublée) : la migration peut être rejouée sans rien doubler ;
//   2. si la catégorie « Cible de raid » existe déjà dans Contacts, chaque fiche y est rangée au passage (`categoryId`) ;
//      sinon, Raid NE LA CRÉE PAS lui-même (le contrat de Contacts réserve la création à la personne connectée : `createCategory` exige son droit) :
//      les ids des fiches recopiées sont notés (`pending`, des identifiants de fiche seulement) et le dock les lit en attendant ;
//      l'administration demande ensuite à la personne de créer la catégorie (création à la volée du réglage « Catégorie ») puis de cliquer
//      « Ranger mes chaînes dans cette catégorie » (finishCategory, par lots, reprenable) ;
//   3. l'ancien document « partners » n'est JAMAIS modifié ni supprimé par la migration (copie inerte, jamais relue pour le travail du dock).
// Par lots de 100, avec un point de reprise écrit après chaque lot ; temps borné (la suite reprend au clic « Continuer la copie »).
// Contacts absent, trop ancien ou muet : la migration NE LÈVE PAS (le cœur 0.2.0+ installe les `requires` avant les migrations ; un Contacts absent
// à ce moment est une panne passagère ou une restauration) : elle s'arrête proprement, note pourquoi, et l'administration propose de reprendre.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const data = await import(`./data.mjs${v}`);
const source = await import(`./source.mjs${v}`);

export const MIG = "contactsMigration";
export const LOT = 100;
const SOURCE = "twitch-raid";
const SKIPPED_KEPT = 50;
/** Les délais (en millisecondes). Un objet pour que les tests puissent les raccourcir. */
export const timing = { callMs: 5000, migrationMs: 60_000, actionMs: 8000 };

const isId = (x) => typeof x === "string" && x.length > 0 && x.length <= 80;
const blank = () => ({ total: 0, done: 0, pending: [], categoryId: null, copiedAt: null, migratedAt: null, skipped: [], skippedCount: 0, full: false, stopped: null });

/** L'état de la migration : { id, total, done, pending, categoryId, copiedAt, migratedAt, skipped, skippedCount, full, stopped }. */
export async function readState(ctx) {
  const doc = (await ctx.api.store.list(MIG, { limit: 1 }))[0];
  const d = doc?.data && typeof doc.data === "object" ? doc.data : {};
  return {
    ...blank(), ...d, id: doc?.id ?? null,
    pending: Array.isArray(d.pending) ? d.pending.filter(isId) : [], skipped: Array.isArray(d.skipped) ? d.skipped.slice(0, SKIPPED_KEPT) : [],
    total: Number.isInteger(d.total) ? d.total : 0, done: Number.isInteger(d.done) ? d.done : 0, skippedCount: Number.isInteger(d.skippedCount) ? d.skippedCount : 0,
  };
}
export async function writeState(ctx, st) {
  const { id, ...rest } = st;
  if (id) await ctx.api.store.update(id, rest); else st.id = await ctx.api.store.add(MIG, rest);
}
const ms = (deadline) => Math.max(0, Math.min(timing.callMs, deadline - Date.now()));

/**
 * Recopie l'ancienne liste dans Contacts, à partir du dernier point de reprise. Ne lève jamais pour une panne de Contacts.
 * `categoryId` : la catégorie à utiliser si la migration n'en a pas encore (celle que la personne vient de choisir).
 * Rend { status: "done" | "copied" | "partial" | "stopped", state } — "copied" : tout est dans Contacts, il reste à ranger dans la catégorie.
 */
export async function copyToContacts(ctx, { budgetMs = timing.migrationMs, categoryId = null } = {}) {
  const st = await readState(ctx);
  if (st.migratedAt) return { status: "done", state: st };
  const deadline = Date.now() + budgetMs;
  const legacy = await data.readLegacy(ctx);
  st.total = legacy.length;
  if (!legacy.length) { st.copiedAt ??= new Date().toISOString(); st.migratedAt = new Date().toISOString(); st.pending = []; st.stopped = null; await writeState(ctx, st); return { status: "done", state: st }; }
  if (!st.categoryId) {
    if (isId(categoryId)) st.categoryId = categoryId;
    else {
      const found = await source.findDefaultCategory(ctx, deadline);
      if (found?.problem) { st.stopped = found.problem; await writeState(ctx, st); return { status: "stopped", state: st }; }
      if (found) st.categoryId = found.id;
    }
  }
  st.stopped = null; st.full = false;
  let i = Math.min(st.done, legacy.length), stop = null, retried = false;
  while (i < legacy.length && !stop) {
    const end = Math.min(legacy.length, i + LOT);
    for (; i < end; i++) {
      if (Date.now() >= deadline) { stop = "budget"; break; }
      const p = legacy[i];
      const r = await source.ask(ctx, "upsertByAccount", { network: "twitch", handle: p.login, ...(p.name ? { name: p.name } : {}), source: SOURCE, ...(p.note ? { note: p.note } : {}), ...(st.categoryId ? { categoryId: st.categoryId } : {}) }, ms(deadline));
      if (r.ok) {
        retried = false;
        if (!st.categoryId && isId(r.value.id) && !st.pending.includes(r.value.id)) st.pending.push(r.value.id);
        continue;
      }
      if (r.why === "error" && r.error === "not_found" && st.categoryId && !retried) { st.categoryId = null; retried = true; i--; continue; }   // la catégorie a disparu entre-temps : on continue sans elle
      if (r.why === "error" && (r.error === "invalid_handle" || r.error === "invalid" || r.error === "invalid_network")) {
        st.skippedCount++; if (st.skipped.length < SKIPPED_KEPT) st.skipped.push({ login: p.login, error: r.error }); continue;
      }
      if (r.why === "error" && r.error === "too_many") { st.full = true; stop = "full"; break; }
      stop = r.why === "error" ? "contacts_down" : source.problemOf(r.why); break;
    }
    st.done = i;
    await writeState(ctx, st);   // point de reprise : un lot de 100 au plus est refait après une coupure (sans doublon : upsert)
  }
  if (st.done >= legacy.length) {
    st.copiedAt ??= new Date().toISOString();
    if (st.categoryId) st.pending = [];
    if (!st.pending.length) st.migratedAt = new Date().toISOString();
    st.stopped = null;
    await writeState(ctx, st);
    return { status: st.migratedAt ? "done" : "copied", state: st };
  }
  st.stopped = stop === "budget" ? null : stop;
  await writeState(ctx, st);
  return { status: stop === "budget" ? "partial" : "stopped", state: st };
}

/**
 * « Ranger mes chaînes dans cette catégorie » : les fiches recopiées sans catégorie (pending) y sont ajoutées, par lots de 100 ids (leurs comptes Twitch
 * sont relus dans Contacts, puis `upsertByAccount({ categoryId })`, idempotent). Reprenable ; temps borné. Rend { status: "done" | "partial" | "stopped", state }.
 */
export async function finishCategory(ctx, categoryId, { budgetMs = timing.actionMs } = {}) {
  const st = await readState(ctx);
  if (!isId(categoryId)) return { status: "stopped", state: st };
  const deadline = Date.now() + budgetMs;
  let stop = null;
  while (st.pending.length && !stop) {
    if (Date.now() >= deadline) { stop = "budget"; break; }
    const ids = st.pending.slice(0, LOT), handles = [];
    let cursor = null;
    do {
      const r = await source.ask(ctx, "accounts", { network: "twitch", ids, ...(cursor ? { cursor } : {}), limit: source.PAGE }, ms(deadline));
      if (!r.ok) { stop = r.why === "error" ? (r.error === "not_found" ? "category_gone" : "contacts_down") : source.problemOf(r.why); break; }
      for (const it of Array.isArray(r.value.items) ? r.value.items : []) if (typeof it?.handle === "string") handles.push(it.handle);
      cursor = typeof r.value.next === "string" && r.value.next ? r.value.next : null;
    } while (cursor && Date.now() < deadline);
    if (stop) break;
    for (const handle of handles) {
      if (Date.now() >= deadline) { stop = "budget"; break; }
      const r = await source.ask(ctx, "upsertByAccount", { network: "twitch", handle, source: SOURCE, categoryId }, ms(deadline));
      if (r.ok || (r.why === "error" && r.error === "invalid_handle")) continue;
      stop = r.why === "error" ? (r.error === "not_found" ? "category_gone" : "contacts_down") : source.problemOf(r.why); break;
    }
    if (stop) break;
    st.pending = st.pending.slice(ids.length);   // lot rangé (une fiche sans compte Twitch, effacée entre-temps, est simplement oubliée)
    await writeState(ctx, st);
  }
  if (!st.pending.length) { st.categoryId = categoryId; if (st.copiedAt) st.migratedAt ??= new Date().toISOString(); }
  st.stopped = stop === "budget" ? null : stop;
  await writeState(ctx, st);
  source.resetSource();
  return { status: !st.pending.length ? "done" : stop === "budget" ? "partial" : "stopped", state: st };
}

/** La migration de données 3 elle-même : la copie, bornée à `timing.migrationMs`. Ne lève que pour une erreur de stockage (le cœur remet alors tout comme avant). */
export async function migrate3(ctx) {
  await copyToContacts(ctx, { budgetMs: timing.migrationMs });
}
