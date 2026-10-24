// Événements : les données et leurs garde-fous. Trois collections propres à l'instance :
//   ev_events  un événement (voir model.mjs) · ev_types  un type défini par la propriétaire · ev_meta  un seul document : le gabarit choisi et le dernier rapport d'import.
// Rien n'est lu sans borne : au plus LIMITS.events événements, LIMITS.types types. La liste lue est gardée en mémoire 20 secondes
// (et remise à zéro à chaque écriture) : une page publique ne relit pas la base à chaque visite, et rien ne tourne en arrière-plan.
const q = new URL(import.meta.url).search;
const X = await import(`./text.mjs${q}`);
const T = await import(`./time.mjs${q}`);
const M = await import(`./model.mjs${q}`);

export const C = { events: "ev_events", types: "ev_types", meta: "ev_meta" };
export const SECOND = 1000, HOUR = 3_600_000, DAY = 24 * HOUR;
const CACHE_MS = 20_000;

/** Le fuseau du site (réglage), ou l'heure universelle si le réglage est abîmé. */
export function siteZone(ctx) {
  const z = String(ctx.setting("timezone") ?? "").trim();
  return T.isValidZone(z) ? z : "UTC";
}

const cache = new Map();

/** Oublie la liste gardée de cette instance (à chaque écriture, et à la suppression de l'instance). */
export function drop(ctx) {
  cache.delete(ctx.instance.key);
}

async function generation(ctx) {
  try { return typeof ctx.api.store.generation === "function" ? await ctx.api.store.generation() : 0; } catch { return 0; }
}

async function readAll(ctx, collection, max) {
  const rows = [];
  let cursor = null;
  do {
    const page = await ctx.api.store.page(collection, { limit: 1000, cursor, order: "asc" });
    for (const r of page.items) if (rows.length < max) rows.push(r);
    cursor = page.next && rows.length < max ? page.next : null;
  } while (cursor);
  return rows;
}

/**
 * Tout ce qui est utile pour afficher : les événements (triés par début), les types (dans l'ordre choisi), le fuseau du site.
 * `fresh` : ignore la liste gardée (une écriture vient d'avoir lieu).
 */
export async function load(ctx, { fresh = false } = {}) {
  const key = ctx.instance.key;
  const zone = siteZone(ctx);
  const gen = await generation(ctx);
  const hit = cache.get(key);
  const now = Date.now();
  if (!fresh && hit && hit.gen === gen && hit.zone === zone && now - hit.at < CACHE_MS) return hit.data;
  const [eventRows, typeRows] = await Promise.all([readAll(ctx, C.events, X.LIMITS.events + 50), readAll(ctx, C.types, X.LIMITS.types + 10)]);
  const events = eventRows.map((r) => M.read(r, zone)).sort((a, b) => (Number.isFinite(a.startMs) ? a.startMs : Infinity) - (Number.isFinite(b.startMs) ? b.startMs : Infinity) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const types = typeRows.map(M.readType).sort((a, b) => a.pos - b.pos || a.createdAt - b.createdAt);
  const data = { events, types, zone, byId: new Map(events.map((e) => [e.id, e])), bySlug: new Map(events.map((e) => [e.slug, e])), typeByKey: new Map(types.map((t) => [t.key, t])) };
  if (cache.size > 200) cache.clear();
  cache.set(key, { gen, zone, at: now, data });
  return data;
}

/** Les événements que les visiteurs peuvent voir : publiés et avec un jour lisible. */
export const visible = (data) => data.events.filter((e) => e.status === "published" && !e.broken);

/** Cet événement est-il terminé ? */
export const isPast = (e, now) => e.endMs <= now;

// ── Écriture : une seule à la fois par instance (le stockage n'a pas d'incrément atomique) ──────────────────────────────

const chains = new Map();
export function locked(ctx, fn) {
  const key = ctx.instance.key;
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn).finally(() => drop(ctx));
  const tail = run.catch(() => {});
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}

/** Ajoute plusieurs documents d'un coup (une seule opération) quand le stockage le sait, un par un sinon. Renvoie les identifiants. */
export async function addMany(ctx, collection, docs) {
  if (typeof ctx.api.store.addMany === "function") return ctx.api.store.addMany(collection, docs.map((data) => ({ data })));
  const ids = [];
  for (const data of docs) ids.push(await ctx.api.store.add(collection, data));
  return ids;
}

/** Une ligne du stockage, lue pour une collection précise (un identifiant d'une autre collection de l'instance est refusé). */
export async function getRow(ctx, id, expect) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  const row = await ctx.api.store.get(id);
  if (!row || typeof row.data !== "object" || row.data === null) return null;
  if (expect === "event" && !("slug" in row.data && "date" in row.data)) return null;
  if (expect === "type" && !("names" in row.data)) return null;
  return row;
}

// ── Gabarit choisi et dernier rapport d'import ───────────────────────────────────────────────────────────────────────

export async function readMeta(ctx) {
  const rows = await ctx.api.store.page(C.meta, { limit: 1 });
  const d = rows.items[0]?.data;
  const r = d?.report && typeof d.report === "object" ? d.report : null;
  return { id: rows.items[0]?.id ?? "", starter: typeof d?.starter === "string" ? X.safeSlug(d.starter) : "", report: r && Number.isFinite(Date.parse(r.at)) && Array.isArray(r.errors) ? r : null };
}
async function patchMeta(ctx, change) {
  const rows = await ctx.api.store.page(C.meta, { limit: 1 });
  const row = rows.items[0];
  const data = { ...(row?.data ?? {}), ...change };
  if (row) await ctx.api.store.update(row.id, data); else await ctx.api.store.add(C.meta, data);
}
/** Retient le modèle de départ choisi. */
export const writeMeta = (ctx, starter) => patchMeta(ctx, { starter, at: new Date().toISOString() });
/** Retient le dernier rapport d'import (court : 20 lignes d'erreur au plus), pour l'afficher après le rechargement de la page. */
export const saveReport = (ctx, report) => patchMeta(ctx, { report });

// ── Limiteurs en mémoire : un garde-fou, pas un pare-feu (remis à zéro au redémarrage, rien n'est écrit sur le disque) ─────

const hits = new Map();
/** Qui est le visiteur, sans garder son adresse : l'empreinte salée du cœur (changée chaque jour), propre à ce module. */
export function visitor(request, ctx, scope) {
  try { if (typeof ctx.api.visitor?.fingerprint === "function") return String(ctx.api.visitor.fingerprint(request, scope)); } catch { /* repli ci-dessous */ }
  return "shared";
}
/** Compte un passage et dit si le visiteur dépasse `max` passages dans la fenêtre. */
export function limited(bucket, max, windowMs, now = Date.now()) {
  const recent = (hits.get(bucket) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(bucket, recent);
  if (hits.size > 4000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < DAY)) hits.delete(k);
    for (const k of hits.keys()) { if (hits.size <= 3000) break; hits.delete(k); }
  }
  return recent.length > max;
}

/** Quand l'instance disparaît, sa mémoire aussi. */
export function forget(ctx) {
  const prefix = `${ctx.instance.key}|`;
  for (const k of [...hits.keys()]) if (k.startsWith(prefix)) hits.delete(k);
  chains.delete(ctx.instance.key);
  cache.delete(ctx.instance.key);
}

// ── Réglages ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const flag = (ctx, key, fallback) => { const v = ctx.setting(key); return v === undefined || v === null || v === "" ? fallback : v === true || v === "true" || v === 1 || v === "1"; };
export const perPage = (ctx) => X.num(ctx.setting("perPage"), 12, 1, X.LIMITS.perPage);
export const weekStart = (ctx) => X.num(ctx.setting("weekStart"), 1, 0, 6);
