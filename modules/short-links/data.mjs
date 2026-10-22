// Les données du module et ce qui les protège.
//
//   links   un document par lien court : { slug, url, title, expires } (la clé du document est le nom court : une recherche directe, sans parcourir)
//   stats   un document par lien : { link, total, days: { "AAAA-MM-JJ": clics }, last } (la clé est l'identifiant du lien)
//
// Tout est borné : 300 liens au plus, 120 jours d'historique par lien (les plus anciens sont repliés dans le total), un seul document de
// statistiques par lien (une centaine de nombres), jamais une ligne par clic.
import { today } from "./url.mjs";

export const LINKS = "links";
export const STATS = "stats";
export const MAX_LINKS = 300;
export const KEEP_DAYS = 120;

const keyed = (store) => typeof store.getByKey === "function";

/** Un document du stockage vu comme un lien. Tout est relu avec prudence : le stockage est du JSON libre. */
export function toLink(row) {
  const d = row?.data ?? {};
  return {
    id: row.id,
    slug: String(d.slug ?? ""),
    url: String(d.url ?? ""),
    title: String(d.title ?? ""),
    expires: /^\d{4}-\d{2}-\d{2}$/.test(String(d.expires ?? "")) ? String(d.expires) : "",
    createdAt: row.createdAt ? new Date(row.createdAt).getTime() : 0,
  };
}

export async function linkById(ctx, id) {
  if (typeof id !== "string" || !id || id.length > 80) return null;
  const row = await ctx.api.store.get(id);
  return row && typeof row.data?.slug === "string" ? toLink(row) : null;
}

export async function linkBySlug(ctx, slug) {
  const store = ctx.api.store;
  if (keyed(store)) {
    const row = await store.getByKey(LINKS, slug);
    return row && row.data?.slug === slug ? toLink(row) : null;
  }
  const rows = await store.list(LINKS, { limit: MAX_LINKS + 50 });
  const row = rows.filter((r) => r.data?.slug === slug).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
  return row ? toLink(row) : null;
}

/** Les liens, du plus récent au plus ancien, `limit` à la fois (50 à l'écran). `next` : à repasser pour la suite. */
export async function linkPage(ctx, { limit = 50, cursor = null } = {}) {
  const page = await ctx.api.store.page(LINKS, { limit, cursor: cursor || undefined, order: "desc" });
  return { items: page.items.map(toLink).filter((l) => l.slug), next: page.next ?? null };
}

/** Tous les liens (300 au plus) : pour chercher, exporter, sauvegarder. */
export async function allLinks(ctx) {
  const rows = await ctx.api.store.list(LINKS, { limit: MAX_LINKS + 50 });
  return rows.map(toLink).filter((l) => l.slug);
}

export const linkCount = (ctx) => ctx.api.store.count(LINKS);

/**
 * Enregistre un lien. Le nom court est unique : la clé du document le garantit en pratique, et on revérifie après l'écriture
 * (deux créations simultanées du même nom : la plus ancienne reste, l'autre est retirée).
 * @returns {Promise<{ ok: true, id: string } | { ok: false, taken: true }>}
 */
export async function addLink(ctx, { slug, url, title, expires }) {
  const store = ctx.api.store;
  const data = { slug, url, title: title || "", expires: expires || "" };
  const id = await store.add(LINKS, data, { key: slug });
  const first = await linkBySlug(ctx, slug);
  if (first && first.id !== id) {
    await store.remove(id);
    return { ok: false, taken: true };
  }
  return { ok: true, id };
}

/** Modifie la destination, le titre ou la date de fin. Le nom court, lui, ne change jamais (les QR codes déjà imprimés en dépendent). */
export async function updateLink(ctx, id, { url, title, expires }) {
  const row = await ctx.api.store.get(id);
  if (!row || typeof row.data?.slug !== "string") return null;
  const data = { ...row.data, url, title: title || "", expires: expires || "" };
  await ctx.api.store.update(id, data);
  return toLink({ ...row, data });
}

// ── Statistiques ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function cleanStats(data) {
  const days = {};
  if (data?.days && typeof data.days === "object") {
    for (const [day, n] of Object.entries(data.days)) {
      const count = Number(n);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(count) && count > 0) days[day] = Math.floor(count);
    }
  }
  const total = Number(data?.total);
  return { total: Number.isFinite(total) && total >= 0 ? Math.floor(total) : Object.values(days).reduce((a, b) => a + b, 0), days };
}

export async function statsRow(ctx, linkId) {
  const store = ctx.api.store;
  if (keyed(store)) return store.getByKey(STATS, linkId);
  const rows = await store.list(STATS, { limit: MAX_LINKS + 50 });
  return rows.find((r) => r.data?.link === linkId) ?? null;
}

export async function readStats(ctx, linkId) {
  const row = await statsRow(ctx, linkId);
  return { id: row?.id ?? null, ...cleanStats(row?.data) };
}

/** Ajoute des clics (jour → nombre) au document de statistiques du lien, et replie les jours trop anciens dans le total. */
export async function addClicks(ctx, linkId, batch) {
  const store = ctx.api.store;
  const row = await statsRow(ctx, linkId);
  const cur = cleanStats(row?.data);
  let added = 0;
  for (const [day, n] of batch) {
    cur.days[day] = (cur.days[day] ?? 0) + n;
    added += n;
  }
  const keep = Object.keys(cur.days).sort().slice(-KEEP_DAYS);
  const days = Object.fromEntries(keep.map((d) => [d, cur.days[d]]));
  const data = { link: linkId, total: cur.total + added, days, last: keep[keep.length - 1] ?? "" };
  if (row) await store.update(row.id, data);
  else await store.add(STATS, data, { key: linkId });
}

export async function removeStats(ctx, linkId) {
  const store = ctx.api.store;
  const row = await statsRow(ctx, linkId);
  if (row) await store.remove(row.id);
}

/** Les chiffres d'un lien : aujourd'hui, 7 jours, 30 jours, total, et la série des `n` derniers jours (du plus ancien au plus récent). */
export function summarize(stats, now = Date.now(), n = 30) {
  const series = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = today(now - i * 86_400_000);
    series.push({ day, n: stats.days[day] ?? 0 });
  }
  const sum = (k) => series.slice(-k).reduce((a, b) => a + b.n, 0);
  return { today: series[series.length - 1]?.n ?? 0, week: sum(7), month: sum(n), total: stats.total, series };
}
