// Statistiques de la communauté — le passage qui relève les chiffres publiés par les modules de réseaux.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins
const { TOPIC, MAX_ITEMS, MAX_STATS, periodMs, retentionMs, validateItem } = await import(`./model.mjs${v}`);
const { loadStats, saveStat, newStat, addPoint, purge, readRun, writeRun } = await import(`./stats.mjs${v}`);

export const MIN_GAP_MS = 120_000; // « Mettre à jour maintenant » : au plus une fois toutes les 2 minutes
let running = false; // jamais deux passages en même temps dans ce processus
/** Millisecondes, dans un objet pour que les tests puissent les raccourcir. collectMs : le temps laissé aux modules de réseaux pour répondre ; au-delà le passage échoue proprement (et libère le verrou ci-dessus). */
export const limits = { collectMs: 60_000 };
function bounded(p, ms) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); timer.unref?.(); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/**
 * Un passage : demande leurs chiffres aux modules de réseaux, les contrôle un par un et écrit UN point par statistique et par période.
 *  - sans `force`, un passage déjà fait pour la période en cours ne refait rien (la tâche tourne plus souvent que la période) ;
 *  - un chiffre en erreur ne produit JAMAIS de point : on garde la raison et le dernier chiffre connu ;
 *  - une statistique qui n'est plus transmise passe à « manquante » (historique et réglage conservés) ;
 *  - la rétention s'applique à la fin, sans jamais retirer le dernier chiffre connu.
 */
export async function collectNow(ctx, { now = Date.now(), force = false } = {}) {
  if (running) return { status: "busy" };
  running = true;
  try {
    const period = periodMs(ctx), bucket = Math.floor(now / period);
    const run = await readRun(ctx);
    if (!force && run.data.lastBucket === bucket) return { status: "skipped" };
    if (force && run.data.lastForcedAt && now - run.data.lastForcedAt < MIN_GAP_MS) return { status: "tooSoon" };
    let items;
    try { items = await bounded(Promise.resolve().then(() => ctx.api.topics.collect(TOPIC, { limit: MAX_ITEMS })), limits.collectMs); }
    catch { await writeRun(ctx, run, { ...run.data, lastTryAt: now, lastError: "collect", ...(force ? { lastForcedAt: now } : {}) }); return { status: "failed" }; }
    if (!Array.isArray(items)) items = [];

    const stats = await loadStats(ctx);
    const byId = new Map(stats.map((s) => [s.id, s]));
    const seen = new Set();
    let stored = 0, errors = 0, rejected = 0, overflow = 0;
    for (const raw of items) {
      const checked = validateItem(raw);
      if (!checked.ok || seen.has(checked.stat.id)) { rejected++; continue; }
      const item = checked.stat;
      seen.add(item.id);
      let stat = byId.get(item.id);
      if (!stat) {
        if (byId.size >= MAX_STATS) { overflow++; continue; }
        stat = newStat({ id: item.id, metric: item.metric }, now);
        byId.set(item.id, stat);
      }
      Object.assign(stat, { source: "auto", platform: item.platform, account: item.account, accountKey: item.accountKey, label: item.label, url: item.url ?? null });
      if (item.error) {
        if (stat.state !== "error" || stat.error !== item.error) stat.since = now;
        Object.assign(stat, { state: "error", error: item.error });
        errors++;
      } else {
        await addPoint(ctx, stat, now, item.value, period);
        Object.assign(stat, { state: "ok", asOf: item.asOfMs });
        delete stat.error; delete stat.since;
        stored++;
      }
      await saveStat(ctx, stat);
    }
    for (const stat of byId.values()) {
      if (stat.source === "auto" && !seen.has(stat.id) && stat.state !== "missing") { Object.assign(stat, { state: "missing", since: now }); delete stat.error; await saveStat(ctx, stat); }
    }
    const cutoff = now - retentionMs(ctx);
    for (const stat of byId.values()) if (await purge(ctx, stat, cutoff)) await saveStat(ctx, stat);

    await writeRun(ctx, run, { ...run.data, lastBucket: bucket, lastRunAt: now, lastError: null, counts: { stored, errors, rejected, overflow }, truncated: items.length >= MAX_ITEMS, ...(force ? { lastForcedAt: now } : {}) });
    return { status: "done", stored, errors, rejected, overflow };
  } finally { running = false; }
}
