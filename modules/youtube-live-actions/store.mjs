// La mémoire du module : trois sortes de documents, bornés, lus et écrits une opération après l'autre (jamais deux écritures en même temps pour une instance).
//
//   state     l'état de la lecture : direct trouvé, curseur du chat, prochains rendez-vous, erreurs, compteur de limite du jour, messages déjà vus (empreintes)
//   rules     une règle par document (20 au plus)
//   journal   un seul document : les 50 derniers évènements (rien du message n'est gardé)
//
// Rien ne tourne en arrière-plan : l'état avance quand une page du module est ouverte (voir engine.mjs).
import { createHash, randomBytes } from "node:crypto";

export const LIMITS = { rules: 20, journal: 50, seen: 600, nameChars: 64, whoChars: 40 };
const COLLECTION = { state: "ytState", rules: "ytRules", journal: "ytJournal" };

const rec = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const chains = new Map();
/** Exécute `fn` quand les opérations précédentes de la même instance sont finies. Une erreur d'une opération ne bloque pas la suivante. */
export function serial(ctx, name, fn) {
  const k = `${ctx.instance.key}|${name}`;
  const run = (chains.get(k) ?? Promise.resolve()).catch(() => {}).then(fn);
  chains.set(k, run);
  if (chains.size > 50) for (const key of chains.keys()) { if (key !== k) { chains.delete(key); break; } }
  return run;
}
export const resetStore = () => chains.clear();

const first = async (ctx, collection) => (await ctx.api.store.list(collection, { limit: 1 }))[0] ?? null;
const stateDefaults = () => ({
  chatId: null, videoId: null, title: "", startedAt: null, cursor: null, seen: [], nextPollAt: 0, nextDetectAt: 0, backoffUntil: 0, errors: 0, error: null,
  status: "idle", lastBeatAt: 0, lastPollAt: 0, pollingMs: 0, usage: { day: "", units: 0 }, polls: 0, noChat: false,
});

export async function readState(ctx) {
  const r = await first(ctx, COLLECTION.state);
  const d = { ...stateDefaults(), ...rec(r?.data) };
  if (!Array.isArray(d.seen)) d.seen = [];
  d.usage = { day: String(rec(d.usage).day ?? ""), units: Math.max(0, Math.floor(Number(rec(d.usage).units) || 0)) };
  return d;
}
/** Modifie l'état : `fn(state)` le modifie en place (et peut rendre une valeur). L'état est écrit si quelque chose a changé. */
export function updateState(ctx, fn) {
  return serial(ctx, "state", async () => {
    const r = await first(ctx, COLLECTION.state);
    const data = { ...stateDefaults(), ...rec(r?.data) };
    if (!Array.isArray(data.seen)) data.seen = [];
    data.usage = { day: String(rec(data.usage).day ?? ""), units: Math.max(0, Math.floor(Number(rec(data.usage).units) || 0)) };
    const before = JSON.stringify(data);
    const out = await fn(data);
    if (data.seen.length > LIMITS.seen) data.seen = data.seen.slice(-LIMITS.seen);
    if (JSON.stringify(data) !== before) { if (r) await ctx.api.store.update(r.id, data); else await ctx.api.store.add(COLLECTION.state, data); }
    return out === undefined ? data : out;
  });
}

/** Empreinte courte d'un identifiant de message : suffit pour reconnaître un message déjà vu, sans garder l'identifiant. */
export const fingerprint = (id) => createHash("sha1").update(String(id)).digest("hex").slice(0, 12);
/** Référence envoyée à Home Assistant pour un message (idempotence : le même message donne toujours la même). */
export const refOf = (id) => `yt-${createHash("sha256").update(String(id)).digest("hex").slice(0, 32)}`;

/* ───────────── Les règles ───────────── */

export async function listRules(ctx) {
  const rows = await ctx.api.store.list(COLLECTION.rules, { limit: LIMITS.rules + 5 });
  return rows.map((r) => ({ id: r.id, ...rec(r.data) })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (String(a.id) < String(b.id) ? -1 : 1)).slice(0, LIMITS.rules);
}
export const countRules = (ctx) => ctx.api.store.count(COLLECTION.rules);
export function saveRule(ctx, id, data) {
  return serial(ctx, "rules", async () => {
    if (id) { const ok = await ctx.api.store.update(id, data); if (ok) return id; }
    if ((await ctx.api.store.count(COLLECTION.rules)) >= LIMITS.rules) return null;
    return ctx.api.store.add(COLLECTION.rules, { ...data, order: Date.now() });
  });
}
export const removeRule = (ctx, id) => serial(ctx, "rules", async () => { await ctx.api.store.remove(id); });
/** Note le dernier déclenchement d'une règle (délai de recharge). */
export function touchRule(ctx, id, at) {
  return serial(ctx, "rules", async () => {
    const r = await ctx.api.store.get(id);
    if (r) await ctx.api.store.update(id, { ...rec(r.data), lastAt: at });
  });
}

/* ───────────── Le journal ───────────── */

export async function readJournal(ctx) {
  const r = await first(ctx, COLLECTION.journal);
  const entries = Array.isArray(r?.data?.entries) ? r.data.entries.filter((e) => e && typeof e === "object") : [];
  return entries.slice(0, LIMITS.journal);
}
/** Modifie le journal : `fn(entries)` rend la nouvelle liste (la plus récente d'abord). Bornée à 50 : ce qui dépasse est oublié ici. */
export function updateJournal(ctx, fn) {
  return serial(ctx, "journal", async () => {
    const r = await first(ctx, COLLECTION.journal);
    const cur = Array.isArray(r?.data?.entries) ? r.data.entries.filter((e) => e && typeof e === "object") : [];
    const next = (await fn(cur.slice())).slice(0, LIMITS.journal);
    if (JSON.stringify(next) !== JSON.stringify(cur)) { if (r) await ctx.api.store.update(r.id, { entries: next }); else await ctx.api.store.add(COLLECTION.journal, { entries: next }); }
    return next;
  });
}
const newId = () => randomBytes(5).toString("hex");
/** Ajoute des lignes au journal (les plus récentes d'abord). Rend les lignes ajoutées avec leur identifiant. */
export async function addJournal(ctx, lines) {
  const list = (Array.isArray(lines) ? lines : [lines]).map((l) => ({ id: newId(), at: Date.now(), ...l }));
  if (!list.length) return [];
  await updateJournal(ctx, (cur) => [...list.slice().reverse(), ...cur]);
  return list;
}
export const clearJournal = (ctx) => updateJournal(ctx, () => []);
