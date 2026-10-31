// La mémoire du bot : l'état de l'écoute et l'interrupteur d'urgence (document `state`), le court journal des réponses et des refus (document `log`),
// et, en mémoire seulement, les délais anti-spam, la limite de débit et les messages déjà vus. Rien de tout cela n'est un réglage : ce sont des faits qui changent seuls.
import { randomBytes } from "node:crypto";

export const LOG_MAX = 30;
const chain = new Map();
/** Une écriture après l'autre pour une même instance et un même document (des messages en rafale ne s'écrasent pas). */
export function serial(ctx, name, fn) {
  const k = `${ctx.instance.key}|${name}`;
  const run = (chain.get(k) ?? Promise.resolve()).catch(() => {}).then(fn);
  chain.set(k, run);
  return run;
}
const row = async (ctx, name) => (await ctx.api.store.list(name, { limit: 1 }))[0] ?? null;

const rec = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
export async function readState(ctx) { return rec((await row(ctx, "botState"))?.data); }
/** Modifie l'état : `fn(state)` le modifie en place. */
export function updateState(ctx, fn) {
  return serial(ctx, "state", async () => {
    const r = await row(ctx, "botState");
    const data = rec(r?.data);
    await fn(data);
    if (r) await ctx.api.store.update(r.id, data); else await ctx.api.store.add("botState", data);
    return data;
  });
}
/** Le secret partagé avec Twitch pour signer ses messages : créé une fois, jamais affiché. */
export async function ensureSecret(ctx, { renew = false } = {}) {
  const s = await readState(ctx);
  if (s.secret && !renew) return s.secret;
  const secret = randomBytes(32).toString("hex");
  await updateState(ctx, (d) => { d.secret = secret; });
  return secret;
}

/* ───────────── Arrêt d'urgence ───────────── */

export const isMuted = async (ctx) => (await readState(ctx)).muted === true;
export const setMuted = (ctx, muted) => updateState(ctx, (d) => { d.muted = muted; d.mutedAt = muted ? Date.now() : null; });

/* ───────────── Journal ───────────── */

/** Une ligne du journal : { at, user, command, result: "sent" | "refused" | "error", reason, text? }. Les 30 dernières seulement. */
export function addLog(ctx, entry) {
  return serial(ctx, "log", async () => {
    const r = await row(ctx, "botLog");
    const entries = Array.isArray(r?.data?.entries) ? r.data.entries : [];
    const next = [{ at: Date.now(), ...entry }, ...entries].slice(0, LOG_MAX);
    if (r) await ctx.api.store.update(r.id, { entries: next }); else await ctx.api.store.add("botLog", { entries: next });
  });
}
export async function readLog(ctx) {
  const e = (await row(ctx, "botLog"))?.data?.entries;
  return Array.isArray(e) ? e : [];
}
export const clearLog = (ctx) => serial(ctx, "log", async () => { const r = await row(ctx, "botLog"); if (r) await ctx.api.store.remove(r.id); });

/* ───────────── Compteurs des commandes ({compteur}) ───────────── */

export const COUNTERS_MAX = 300;
const MAX_COUNT = 1_000_000_000;
export async function readCounters(ctx) {
  const c = rec((await row(ctx, "botCounters"))?.data?.counts), out = {};
  for (const [k, n] of Object.entries(c)) if (Number.isInteger(n) && n >= 0 && n <= MAX_COUNT) out[k] = n;
  return out;
}
/** Fixe le compteur d'une commande (0 à un milliard) ; au plus 300 compteurs gardés (les plus anciens partent d'abord). */
export function setCounter(ctx, key, value) {
  return serial(ctx, "counters", async () => {
    const r = await row(ctx, "botCounters");
    const counts = { ...rec(r?.data?.counts) };
    delete counts[key];
    counts[key] = Math.min(MAX_COUNT, Math.max(0, Math.trunc(Number(value) || 0)));
    for (const k of Object.keys(counts).slice(0, Math.max(0, Object.keys(counts).length - COUNTERS_MAX))) delete counts[k];
    if (r) await ctx.api.store.update(r.id, { counts }); else await ctx.api.store.add("botCounters", { counts });
  });
}
export function dropCounter(ctx, key) {
  return serial(ctx, "counters", async () => {
    const r = await row(ctx, "botCounters");
    if (!r || !(key in rec(r.data?.counts))) return;
    const counts = { ...rec(r.data.counts) }; delete counts[key];
    await ctx.api.store.update(r.id, { counts });
  });
}

/* ───────────── En mémoire : délais, débit, messages vus ───────────── */

const mem = new Map();
const of = (ctx) => { const k = ctx.instance.key; if (!mem.has(k)) mem.set(k, { global: new Map(), user: new Map(), sends: [], seen: new Map(), sent: new Set() }); return mem.get(k); };
export const resetMemory = () => mem.clear();

/** Le délai d'une commande est-il écoulé ? Rend 0 si la commande peut répondre, sinon les secondes à attendre ; `reserve` démarre alors les délais. */
export function checkCooldown(ctx, { command, user, globalSec, userSec, now = Date.now(), reserve = true }) {
  const m = of(ctx);
  const g = m.global.get(command) ?? 0, u = m.user.get(`${command}|${user}`) ?? 0;
  const wait = Math.max(g + globalSec * 1000 - now, u + userSec * 1000 - now, 0);
  if (wait > 0) return Math.ceil(wait / 1000);
  if (reserve) {
    m.global.set(command, now); m.user.set(`${command}|${user}`, now);
    if (m.user.size > 2000) for (const [k, t] of m.user) if (now - t > 3_600_000) m.user.delete(k);
  }
  return 0;
}
/** Annule les délais d'une réponse qui n'a finalement pas été envoyée (un refus de Twitch ne doit pas faire attendre les gens pour rien). */
export function releaseCooldown(ctx, { command, user }) { const m = of(ctx); m.global.delete(command); m.user.delete(`${command}|${user}`); }

/** Limite de débit globale : au plus `max` réponses par fenêtre de `windowMs`. Rend true si une réponse de plus passe (et la compte). */
export function takeSendSlot(ctx, { max, windowMs, now = Date.now() }) {
  const m = of(ctx);
  m.sends = m.sends.filter((t) => now - t < windowMs);
  if (m.sends.length >= max) return false;
  m.sends.push(now);
  return true;
}
export function giveBackSendSlot(ctx) { of(ctx).sends.pop(); }

/** Ce message a-t-il déjà été traité ? (Twitch peut renvoyer le même.) Le marque comme vu. Garde 10 minutes, 2000 identifiants au plus. */
export function seenBefore(ctx, id, now = Date.now()) {
  const m = of(ctx);
  if (m.seen.has(id)) return true;
  m.seen.set(id, now);
  if (m.seen.size > 2000) for (const [k, t] of m.seen) { if (now - t > 600_000 || m.seen.size > 2000) m.seen.delete(k); else break; }
  return false;
}
/** Les messages que le bot a envoyés lui-même : jamais traités comme des commandes. */
export function rememberSent(ctx, messageId) { const s = of(ctx).sent; if (messageId) { s.add(messageId); if (s.size > 500) s.delete(s.values().next().value); } }
export const isOwnMessage = (ctx, messageId) => of(ctx).sent.has(messageId);
