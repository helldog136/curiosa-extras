// Statistiques de la communauté — stockage. Trois collections, toutes à ce module :
//   communityStats   un document par statistique (compte × type de chiffre) : réglage « montrer sur mon site », dernier chiffre connu, état, liste de ses mois d'historique ;
//   communitySamples un document par statistique et par mois : { statId, month, points: [[secondes, valeur], …] } (+ ["m", "jeton"] pour un chiffre saisi à la main) ;
//   communityRun     un seul document : dernier passage (période traitée, cadence du bouton « mettre à jour »).
// Volume : un point pèse environ 20 octets. Par défaut (un relevé par jour, 2 ans) : 730 points ≈ 15 Ko par statistique ; 20 statistiques ≈ 300 Ko.
// Pire cas réglable (une fois par heure, 5 ans) : 43 800 points ≈ 900 Ko par statistique. Au plus 300 statistiques.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins
const { MAX_STATS } = await import(`./model.mjs${v}`);

const withoutDocId = ({ docId, ...rest }) => rest;

export async function loadStats(ctx) {
  return (await ctx.api.store.list("communityStats", { limit: MAX_STATS + 50 })).map((r) => ({ ...r.data, docId: r.id }));
}
export async function getStat(ctx, docId) {
  const r = typeof docId === "string" && docId ? await ctx.api.store.get(docId) : null;
  return r && r.data?.id && r.data?.metric ? { ...r.data, docId: r.id } : null;
}
export async function saveStat(ctx, stat) {
  if (stat.docId) { await ctx.api.store.update(stat.docId, withoutDocId(stat)); return stat; }
  stat.docId = await ctx.api.store.add("communityStats", withoutDocId(stat));
  return stat;
}
export const newStat = (fields, now) => ({ source: "auto", visible: false, firstAt: now, state: "ok", chunks: {}, ...fields }); // privée par défaut

export const monthKey = (sec) => new Date(sec * 1000).toISOString().slice(0, 7);
const monthStartMs = (key) => Date.parse(`${key}-01T00:00:00Z`);

async function readChunk(ctx, stat, key) {
  const docId = stat.chunks?.[key];
  const row = docId ? await ctx.api.store.get(docId) : null;
  return { docId: row ? row.id : null, points: Array.isArray(row?.data?.points) ? row.data.points : [] };
}
async function writeChunk(ctx, stat, key, chunk) {
  const data = { statId: stat.id, month: key, points: chunk.points };
  if (chunk.docId && (await ctx.api.store.update(chunk.docId, data))) return;
  stat.chunks[key] = await ctx.api.store.add("communitySamples", data);
}

/**
 * Ajoute un chiffre à l'historique : UN SEUL point par statistique et par période (le dernier écrit remplace le précédent de la même période).
 * `meta` = { by } pour un chiffre saisi à la main. Met à jour `lastValue` / `lastAt` de `stat` (à enregistrer ensuite par l'appelant).
 */
export async function addPoint(ctx, stat, atMs, value, periodMs, meta) {
  const sec = Math.floor(atMs / 1000);
  const bucket = (s) => Math.floor((s * 1000) / periodMs);
  const lastSec = stat.lastAt != null ? Math.floor(stat.lastAt / 1000) : null;
  const key = lastSec != null && sec >= lastSec && bucket(lastSec) === bucket(sec) ? monthKey(lastSec) : monthKey(sec); // même période que le dernier point, même s'il est dans le mois d'avant
  const chunk = await readChunk(ctx, stat, key);
  const point = meta ? [sec, value, "m", String(meta.by ?? "").slice(0, 60)] : [sec, value];
  const same = chunk.points.findIndex((p) => bucket(p[0]) === bucket(sec));
  if (same >= 0) chunk.points[same] = point;
  else { const at = chunk.points.findIndex((p) => p[0] > sec); if (at < 0) chunk.points.push(point); else chunk.points.splice(at, 0, point); }
  await writeChunk(ctx, stat, key, chunk);
  if (lastSec == null || sec >= lastSec) { stat.lastValue = value; stat.lastAt = sec * 1000; }
}

/** Les points de la statistique, du plus ancien au plus récent, en remontant jusqu'à en trouver un à `sinceSec` ou avant (ou jusqu'au début). */
export async function readPoints(ctx, stat, sinceSec) {
  const out = [];
  for (const key of Object.keys(stat.chunks ?? {}).sort().reverse()) {
    const { points } = await readChunk(ctx, stat, key);
    out.unshift(...points);
    if (points.length && points[0][0] <= sinceSec) break;
  }
  return out;
}

/**
 * Rétention : retire les points plus anciens que `cutoffMs`, sans jamais retirer le dernier chiffre connu de la statistique.
 * Renvoie true si `stat.chunks` a changé (à enregistrer).
 */
export async function purge(ctx, stat, cutoffMs) {
  if (!Number.isFinite(cutoffMs)) return false;
  let changed = false;
  const lastSec = stat.lastAt != null ? Math.floor(stat.lastAt / 1000) : null;
  for (const key of Object.keys(stat.chunks ?? {}).sort()) {
    if (monthStartMs(key) >= cutoffMs) break;
    const chunk = await readChunk(ctx, stat, key);
    const kept = chunk.points.filter((p) => p[0] * 1000 >= cutoffMs || p[0] === lastSec);
    if (kept.length === chunk.points.length) continue;
    if (kept.length === 0) { if (chunk.docId) await ctx.api.store.remove(chunk.docId); delete stat.chunks[key]; changed = true; continue; }
    await writeChunk(ctx, stat, key, { docId: chunk.docId, points: kept });
    changed = true;
  }
  return changed;
}

/** Supprime la statistique et tout son historique. */
export async function removeStat(ctx, stat) {
  for (const docId of Object.values(stat.chunks ?? {})) await ctx.api.store.remove(docId);
  if (stat.docId) await ctx.api.store.remove(stat.docId);
}

export async function readRun(ctx) {
  const [row] = await ctx.api.store.list("communityRun", { limit: 1 });
  return { docId: row?.id ?? null, data: row?.data ?? {} };
}
export async function writeRun(ctx, run, data) {
  if (run.docId && (await ctx.api.store.update(run.docId, data))) { run.data = data; return; }
  run.docId = await ctx.api.store.add("communityRun", data);
  run.data = data;
}
