// Soutiens — ce que le module GARDE, et rien d'autre. Trois petites collections, par instance :
//   people : un soutien = { pid, k, provider, name?, contactId?, tiers[], since, last, status, hidden, consent?, approved, gen, wall }
//            `k` = « plateforme:numéro » (numéro de membre, ou empreinte irréversible pour une plateforme sans numéro). `name` (nom donné par la plateforme) n'existe QUE tant que la
//            personne n'est pas rangée dans Contacts : après, le nom vit à un seul endroit (Contacts). Jamais d'e-mail, jamais de montant.
//   tiers  : { k, name, rank, label{langue:texte}, } — le nom du palier chez la plateforme (privé) et le libellé PUBLIC choisi par la propriétaire. Jamais de montant : seulement un rang.
//   state  : un seul document { secret, syncedAt, syncCode, syncCount, seen[], eventAt } — le secret sert à fabriquer les liens d'accord et les empreintes ; il ne sort jamais.
// Les lectures passent par une petite mémoire de 30 secondes (vidée à chaque écriture). Les écritures d'une instance sont mises à la queue (une à la fois).
import { randomBytes } from "node:crypto";
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const P = await import(`./pure.mjs${v}`);
const { LIMITS, idOk, pidOk } = P;

export const PEOPLE = "people", TIERS = "tiers", STATE = "state";
export const READ_TTL_MS = 30_000;

const memo = new Map();   // instance → { at, snap }
const locks = new Map();  // instance → promesse de la dernière écriture
export const forget = (ctx) => { if (ctx) memo.delete(ctx.instance.id); else { memo.clear(); locks.clear(); } };

async function readAll(ctx, collection, max) {
  const out = [];
  let cursor = null;
  do {
    const page = typeof ctx.api.store.page === "function"
      ? await ctx.api.store.page(collection, { limit: Math.min(1000, Math.max(1, max - out.length)), cursor, order: "asc" })
      : { items: await ctx.api.store.list(collection, { limit: max }), next: null };
    out.push(...page.items);
    cursor = page.next;
  } while (cursor && out.length < max);
  return out.slice(0, max);
}

/** Les données en mémoire : { at, people: Map(k → { id, data }), byPid: Map(pid → { id, data }), tiers: Map(k → { id, data }), state: { id, data } | null }. Ne lève pas pour des documents abîmés (ils sont ignorés). */
export async function snapshot(ctx, { fresh = false } = {}) {
  const hit = memo.get(ctx.instance.id);
  if (!fresh && hit && Date.now() - hit.at < READ_TTL_MS) return hit.snap;
  const people = new Map(), byPid = new Map(), tiers = new Map();
  for (const r of await readAll(ctx, PEOPLE, LIMITS.people + 50)) {
    const d = r.data;
    if (!d || typeof d.k !== "string" || !pidOk(d.pid) || people.has(d.k)) continue;
    people.set(d.k, { id: r.id, data: d }); byPid.set(d.pid, { id: r.id, data: d });
  }
  for (const r of await readAll(ctx, TIERS, LIMITS.tiers + 20)) if (r.data && typeof r.data.k === "string" && !tiers.has(r.data.k)) tiers.set(r.data.k, { id: r.id, data: r.data });
  const st = (await readAll(ctx, STATE, 5))[0] ?? null;
  const snap = { at: Date.now(), people, byPid, tiers, state: st && st.data && typeof st.data === "object" ? { id: st.id, data: st.data } : null };
  memo.set(ctx.instance.id, { at: snap.at, snap });
  return snap;
}

/** Une seule écriture à la fois par instance (deux notifications qui arrivent ensemble ne se marchent pas dessus). */
export function withLock(ctx, fn) {
  const id = ctx.instance.id;
  const prev = locks.get(id) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(async () => { try { return await fn(); } finally { forget(ctx); } });
  locks.set(id, run);
  run.finally(() => { if (locks.get(id) === run) locks.delete(id); }).catch(() => {});
  return run;
}

/* ───────────── L'état et le secret ───────────── */

/** Le secret de l'instance (créé au premier besoin). À appeler DANS withLock. */
export async function secretOf(ctx) {
  const snap = await snapshot(ctx, { fresh: true });
  if (snap.state?.data.secret && typeof snap.state.data.secret === "string") return snap.state.data.secret;
  const secret = randomBytes(32).toString("hex");
  if (snap.state) await ctx.api.store.update(snap.state.id, { ...snap.state.data, secret });
  else await ctx.api.store.add(STATE, { secret });
  forget(ctx);
  return secret;
}

/** Fusionne des champs dans le document d'état. À appeler DANS withLock. */
export async function patchState(ctx, patch) {
  await secretOf(ctx);
  const snap = await snapshot(ctx, { fresh: true });
  await ctx.api.store.update(snap.state.id, { ...snap.state.data, ...patch });
  forget(ctx);
}

export const stateOf = (snap) => snap.state?.data ?? {};

/* ───────────── Les soutiens ───────────── */

export const newPid = () => randomBytes(6).toString("hex");

/** Un soutien neuf, avec les valeurs de départ sûres : caché, sans accord. */
export const blankPerson = (k, provider, over = {}) => ({ pid: newPid(), k, provider, name: "", contactId: null, tiers: [], since: null, last: null, status: "active", hidden: false, consent: null, approved: false, gen: 0, wall: false, ...over });

export async function savePerson(ctx, snap, rec) {
  if (rec.id) await ctx.api.store.update(rec.id, rec.data);
  else {
    if (snap.people.size >= LIMITS.people) return { ok: false, code: "full" };
    rec.id = await ctx.api.store.add(PEOPLE, rec.data);
    snap.people.set(rec.data.k, rec); snap.byPid.set(rec.data.pid, rec);
  }
  return { ok: true };
}

export async function removePerson(ctx, rec) {
  await ctx.api.store.remove(rec.id);
}

/** Le palier de cette clé, créé s'il est inconnu (borné). À appeler DANS withLock. */
export async function upsertTier(ctx, snap, { k, name, rank }) {
  const old = snap.tiers.get(k);
  const clean = P.clean(name, LIMITS.tierName) || k;
  if (old) {
    const next = { ...old.data, name: clean, ...(Number.isFinite(rank) ? { rank } : {}) };
    if (next.name !== old.data.name || next.rank !== old.data.rank) { await ctx.api.store.update(old.id, next); old.data = next; }
    return old;
  }
  if (snap.tiers.size >= LIMITS.tiers) return null;
  const data = { k, name: clean, rank: Number.isFinite(rank) ? rank : snap.tiers.size + 1, label: {} };
  const id = await ctx.api.store.add(TIERS, data);
  const rec = { id, data };
  snap.tiers.set(k, rec);
  return rec;
}

export async function setTierLabel(ctx, k, label) {
  return withLock(ctx, async () => {
    const snap = await snapshot(ctx, { fresh: true });
    const t = snap.tiers.get(k);
    if (!t) return { ok: false, code: "unknown" };
    await ctx.api.store.update(t.id, { ...t.data, label: P.cleanTexts(label, LIMITS.label) });
    return { ok: true };
  });
}

/* ───────────── Oublier ───────────── */

/** Les soutiens arrêtés depuis plus de `keepDays` jours sont oubliés (borné). À appeler DANS withLock. Rend le nombre retiré. */
export async function purge(ctx, snap, { keepDays, expiresOf, activeDays, now = Date.now() }) {
  let removed = 0;
  for (const rec of [...snap.people.values()]) {
    if (removed >= 200) break;
    const d = rec.data;
    const stale = P.daysSince(d.last ?? d.since, now) > keepDays;
    const gone = d.status !== "active" || (!!expiresOf?.(d) && P.daysSince(d.last, now) > activeDays);
    if (stale && gone) { await removePerson(ctx, rec); snap.people.delete(d.k); snap.byPid.delete(d.pid); removed++; }
  }
  return removed;
}

/* ───────────── Vie privée : tout ce que le module sait d'une fiche ───────────── */

/** Les soutiens rangés dans cette fiche de Contacts. */
export async function referencesOf(ctx, contactId) {
  const snap = await snapshot(ctx, { fresh: true });
  return [...snap.people.values()].filter((r) => r.data.contactId === contactId);
}

/** Efface tout ce qui vise cette fiche ; rend le nombre de documents retirés. */
export async function eraseReferences(ctx, contactId) {
  return withLock(ctx, async () => {
    let removed = 0;
    for (const r of await readAll(ctx, PEOPLE, LIMITS.people + 50)) if (r.data?.contactId === contactId) { await ctx.api.store.remove(r.id); removed++; }
    return removed;
  });
}

/** Une fiche en a absorbé une autre : les soutiens de `from` passent sur `to`. Rend le nombre de documents changés. */
export async function remapReferences(ctx, from, to) {
  return withLock(ctx, async () => {
    let updated = 0;
    for (const r of await readAll(ctx, PEOPLE, LIMITS.people + 50)) if (r.data?.contactId === from) { await ctx.api.store.update(r.id, { ...r.data, contactId: to }); updated++; }
    return updated;
  });
}

export { idOk };
