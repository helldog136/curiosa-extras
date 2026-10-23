// La mémoire du module : quatre documents bornés, lus et écrits une opération après l'autre (jamais deux écritures en même temps pour une instance).
//
//   haCore     l'état : coupe-circuit, appareil associé (EMPREINTE du jeton seulement), code d'association en attente, curseur, dernier signe de vie, dernier direct, clés vues
//   haQueue    les actions en attente de Home Assistant (50 au plus)
//   haResults  ce qui est arrivé aux actions (fait, refusé, expiré…) pour les modules qui les ont demandées (50 au plus, 24 h)
//   haLog      le journal pour la propriétaire (100 lignes au plus, 7 jours)
//
// Rien ne tourne en arrière-plan : l'expiration, le tri et la purge se font À LA LECTURE (`transact` les fait avant chaque opération).
import { randomBytes } from "node:crypto";

export const LIMITS = { queue: 50, log: 100, logMs: 7 * 24 * 3600_000, results: 50, resultsMs: 24 * 3600_000, keys: 50, deliveries: 3 };
export const COLLECTIONS = { core: "haCore", queue: "haQueue", results: "haResults", log: "haLog" };

const DEFAULTS = {
  core: () => ({ enabled: true, stoppedAt: null, stoppedBy: null, seq: 0, paired: null, pending: null, lastSeenAt: 0, lastLiveAt: 0, keys: [] }),
  queue: () => ({ items: [] }),
  results: () => ({ items: [] }),
  log: () => ({ lines: [] }),
};
const rec = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const normalize = (name, data) => {
  const d = { ...DEFAULTS[name](), ...rec(data) };
  for (const k of ["items", "lines", "keys"]) if (k in DEFAULTS[name]() && !Array.isArray(d[k])) d[k] = [];
  return d;
};

/* ───────────── Une opération après l'autre ───────────── */

const chains = new Map();
/** Exécute `fn` quand les opérations précédentes de la même instance sont finies. Une erreur d'une opération ne bloque pas la suivante. */
export function serial(ctx, fn) {
  const k = ctx.instance.key;
  const run = (chains.get(k) ?? Promise.resolve()).catch(() => {}).then(fn);
  chains.set(k, run);
  return run;
}

const first = async (ctx, name) => (await ctx.api.store.list(COLLECTIONS[name], { limit: 1 }))[0] ?? null;

/** Lecture seule d'un document (sans purge) : pour vérifier un appareil à chaque interrogation sans attendre les écritures en cours. */
export async function peek(ctx, name) {
  const r = await first(ctx, name);
  return normalize(name, r?.data);
}

/**
 * Une transaction : `fn(db)` lit les documents à la demande (`await db.core()`, `db.queue()`, `db.results()`, `db.log()`) et les modifie en place ; ceux qui ont changé
 * sont écrits à la fin. Avant `fn`, les actions expirées sont closes et les vieilles lignes purgées (« à la lecture »). Si `fn` lève une erreur, rien n'est écrit.
 */
export function transact(ctx, fn, { now = Date.now(), sweep = true } = {}) {
  return serial(ctx, async () => {
    const docs = new Map();
    const load = async (name) => {
      if (!docs.has(name)) {
        const r = await first(ctx, name);
        const data = normalize(name, r?.data);
        docs.set(name, { id: r?.id ?? null, data, before: JSON.stringify(data) });
      }
      return docs.get(name).data;
    };
    const db = { now, core: () => load("core"), queue: () => load("queue"), results: () => load("results"), log: () => load("log") };
    if (sweep) await closeExpired(db);
    const out = await fn(db);
    for (const [name, d] of docs) {
      if (JSON.stringify(d.data) === d.before) continue;
      if (d.id) await ctx.api.store.update(d.id, d.data); else await ctx.api.store.add(COLLECTIONS[name], d.data);
    }
    return out;
  });
}

/* ───────────── Journal ───────────── */

/** Ajoute une ligne en tête du journal ; garde 100 lignes de moins de 7 jours. Rend la ligne. */
export async function addLog(db, line) {
  const log = await db.log();
  const entry = { at: db.now, ...line };
  log.lines.unshift(entry);
  pruneLog(log, db.now);
  return entry;
}
function pruneLog(log, now) {
  log.lines = log.lines.filter((l) => l && now - (l.at ?? 0) < LIMITS.logMs).slice(0, LIMITS.log);
}
/** Met à jour la ligne du journal d'une action (par son identifiant). */
export async function updateLog(db, id, patch) {
  const log = await db.log();
  const line = log.lines.find((l) => l.id === id);
  if (line) Object.assign(line, patch);
  return line ?? null;
}

/* ───────────── Résultats ───────────── */

export async function addResult(db, item) {
  const results = await db.results();
  results.items.unshift({ at: db.now, ...item });
  results.items = results.items.filter((r) => db.now - (r.at ?? 0) < LIMITS.resultsMs).slice(0, LIMITS.results);
}

/* ───────────── Expiration à la lecture ───────────── */

/** Ferme les actions dont le délai est passé : elles sortent de la file, le module qui les a demandées l'apprend (`expired`) et le journal le dit. */
export async function closeExpired(db) {
  const log = await db.log();
  pruneLog(log, db.now);
  const queue = await db.queue();
  if (!queue.items.some((a) => a.expiresAt <= db.now)) return 0;
  const keep = [], gone = [];
  for (const a of queue.items) (a.expiresAt <= db.now ? gone : keep).push(a);
  queue.items = keep;
  for (const a of gone) {
    await addResult(db, { id: a.id, ref: a.ref ?? null, status: "expired", code: "expired" });
    await updateLog(db, a.id, { status: "expired", code: "expired", doneAt: a.expiresAt });
  }
  return gone.length;
}

/* ───────────── Identifiants ───────────── */

export const newId = () => randomBytes(8).toString("hex");

/** Retient une clé d'action vue (50 au plus, la plus récente en tête). */
export function rememberKey(core, key) {
  core.keys = [key, ...core.keys.filter((k) => k !== key)].slice(0, LIMITS.keys);
}
