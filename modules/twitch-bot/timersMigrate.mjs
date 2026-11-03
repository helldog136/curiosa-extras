// Migration des anciens timers (un titre, un message, un rythme) vers les commandes qui se répètent (voir timers.mjs). ADDITIVE, SANS PERTE, REJOUABLE, BORNÉE, sans minuteur de fond.
//   - Un ancien timer dont le message est EXACTEMENT la réponse d'une commande à vous (même période, pas déjà répétée, pas désactivée si le timer était actif) est rattaché à cette commande.
//   - Sinon il devient une commande « réservée au timer » (`timerOnly`, aucun mot à taper dans le chat) : son titre est gardé (`title`), son nom est un mot libre dérivé du titre, sa réponse est
//     l'ancien message mot pour mot, et elle porte le rythme, les lignes, « en direct / toujours », l'état et la période de l'ancien timer. Son identifiant est celui de l'ancien timer (l'état d'attente est repris).
//   - L'ancien enregistrement n'est JAMAIS effacé : il reste dans `timers`, inerte, marqué `migrated: { into, mode, at }`. Le moteur ne lit plus que les commandes.
// Rejouée, elle ne refait rien (les timers marqués sont sautés) : une commande supprimée ensuite par la personne n'est donc pas recréée. 20 timers au plus par passage.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const C = await import(`./commands.mjs${v}`);
const { mutate, catalog, takenWords, freeName, slugName, readRepeat, RESERVED, REPEAT_LIMITS } = C;
const { readPeriod } = await import(`./period.mjs${v}`);
const st = await import(`./state.mjs${v}`);

const NO_SOURCES = { partners: { installed: false, items: [] }, networks: { items: [] }, planning: { installed: false }, followers: { available: false } };
const MAX_BATCH = 20;
const clamp = (x, lo, hi, d) => { const n = Math.trunc(Number(x)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const title = (x) => String(x ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);

/** Reste-t-il un ancien timer à reprendre ? (aucune lecture ailleurs que dans la configuration déjà chargée) */
export const needsMigration = (cfg) => (cfg.timers ?? []).some((x) => x && typeof x.id === "string" && !x.migrated);

/** Reprend les anciens timers. Rend { migrated, attached, created } (nombres seulement). */
export async function migrateTimers(ctx, { now = Date.now() } = {}) {
  const moved = [];   // [{ from, to }] : pour reprendre l'état d'attente
  const r = await mutate(ctx, (cfg) => {
    const todo = cfg.timers.filter((x) => x && typeof x.id === "string" && !x.migrated).slice(0, MAX_BATCH);
    if (!todo.length) return { ok: false, none: true };
    const t0 = (k) => k;
    let attached = 0, created = 0;
    const marks = new Map();
    for (const old of todo) {
      const text = String(old.text ?? "");
      const repeat = { minutes: clamp(old.minutes, 1, REPEAT_LIMITS.minutes, 15), lines: clamp(old.lines, 0, REPEAT_LIMITS.lines, 5), when: old.when === "always" ? "always" : "live", enabled: old.enabled !== false };
      const period = readPeriod(old.period);
      const mate = text && cfg.custom.find((c) => c.timerOnly !== true && String(c.text ?? "") === text && !readRepeat(c.repeat) && JSON.stringify(readPeriod(c.period)) === JSON.stringify(period) && (c.enabled !== false || old.enabled === false));
      if (mate) {
        mate.repeat = repeat; attached++;
        marks.set(old.id, { into: `custom:${mate.id}`, mode: "attached", at: now });
        continue;
      }
      const list = catalog(cfg, NO_SOURCES, t0);
      const taken = new Set([...takenWords(list).keys(), ...RESERVED]);
      const id = cfg.custom.some((c) => c.id === old.id) ? `${old.id}m` : old.id;
      const name = freeName(slugName(old.name, "timer"), taken);
      cfg.custom.push({ id, name, aliases: [], text, role: "everyone", enabled: true, cdGlobal: null, cdUser: null, timerOnly: true, title: title(old.name) || name, repeat, ...(period ? { period } : {}) });
      created++;
      marks.set(old.id, { into: `custom:${id}`, mode: "created", at: now });
      moved.push({ from: old.id, to: `custom:${id}` });
    }
    cfg.timers = cfg.timers.map((x) => (marks.has(x?.id) ? { ...x, migrated: marks.get(x.id) } : x));
    return { ok: true, migrated: marks.size, attached, created };
  });
  if (r.ok === false) return { migrated: 0, attached: 0, created: 0 };
  // L'attente en cours (dernier envoi, lignes comptées) suit : le rythme ne repart pas de zéro. Meilleur effort ; l'ancien état reste en place.
  if (moved.length) {
    await st.serial(ctx, "timers", async () => {
      const row = (await ctx.api.store.list("botTimers", { limit: 1 }))[0];
      const items = row?.data?.items && typeof row.data.items === "object" ? { ...row.data.items } : null;
      if (!row || !items) return;
      for (const m of moved) if (items[m.from] && !items[m.to]) items[m.to] = items[m.from];
      await ctx.api.store.update(row.id, { items });
    }).catch(() => {});
  }
  // Journal central : des nombres, jamais un titre ni un message.
  try { await ctx.api.log?.write?.({ action: "timers.migrated", data: { count: r.migrated, attached: r.attached, created: r.created } }); } catch { /* le journal est un plus */ }
  return { migrated: r.migrated, attached: r.attached, created: r.created };
}
