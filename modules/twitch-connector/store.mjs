// Ce que le Connecteur garde dans SON stockage privé (une instance ne lit jamais celui d'une autre) :
//   twitchApp          l'application reprise (identifiant et secret) : UN document, jamais affiché ; les réglages saisis ont toujours le dessus ;
//   twitchConnections  un document par compte connecté : { slot: "main" | "bot", channel, login, userId, access, refresh, expiresAt, scopes, clientId, status, connectedAt } ;
//   twitchChannels     les chaînes connues (déclarées par « Ma Chaîne Twitch » ou connectées ici) et, pour une installation reprise, SON adresse de retour ;
//   twitchPending      les liens d'autorisation en cours (usage unique, 10 minutes) ; twitchResults : le dernier échec par chaîne et par emplacement ;
//   twitchWants        les autorisations demandées par d'autres modules, par chaîne et par emplacement.
// Toutes les listes sont bornées. Les jetons ne sortent jamais de ce fichier vers un bloc, une réponse de service, un journal ou une erreur.
export const COL = { app: "twitchApp", conns: "twitchConnections", channels: "twitchChannels", pending: "twitchPending", results: "twitchResults", wants: "twitchWants" };
export const LIMITS = { conns: 50, channels: 50, pending: 20, wants: 50 };
export const LOGIN = /^[a-zA-Z0-9_]{3,25}$/;
export const slotOf = (v) => (v === "bot" ? "bot" : "main");
export const text = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
/** Un identifiant reçu d'un autre module : texte court sans espace, sinon rien. */
export const plain = (v) => (typeof v === "string" && /^\S{1,200}$/.test(v.trim()) ? v.trim() : "");
export const loginOf = (v) => { const s = text(v).toLowerCase(); return LOGIN.test(s) ? s : ""; };

export async function all(ctx, col, limit = 50) {
  try { return (await ctx.api.store.list(col, { limit })).slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); } catch { return []; }
}
export const first = async (ctx, col) => (await all(ctx, col, 5))[0] ?? null;
export async function put(ctx, col, doc, data) {
  if (doc) { if (JSON.stringify(doc.data) !== JSON.stringify(data)) await ctx.api.store.update(doc.id, data); return doc.id; }
  return ctx.api.store.add(col, data);
}

/** Identifiants de l'application, champ par champ : le réglage saisi ici, sinon la valeur reprise. { clientId, secret, adopted: bool }. */
export async function credsOf(ctx) {
  const own = { clientId: text(ctx.setting("appClientId")), secret: text(ctx.setting("appSecret")) };
  if (own.clientId && own.secret) return { ...own, adopted: false };
  const a = (await first(ctx, COL.app))?.data ?? {};
  return { clientId: own.clientId || text(a.clientId), secret: own.secret || text(a.clientSecret), adopted: !!(a.clientId || a.clientSecret) };
}
export const hasCreds = (c) => !!(c.clientId && c.secret);

/* ───────────── Connexions ───────────── */
export const conns = (ctx) => all(ctx, COL.conns, LIMITS.conns);
export async function connOf(ctx, slot, channel) {
  const s = slotOf(slot);
  return (await conns(ctx)).find((d) => d.data.slot === s && d.data.channel === channel) ?? null;
}

/* ───────────── Chaînes connues ───────────── */
export const channels = (ctx) => all(ctx, COL.channels, LIMITS.channels);
/** La chaîne visée : celle demandée (pseudo valable), sinon la première connue (ordre d'arrivée), sinon la première chaîne connectée ; "" si aucune. */
export async function channelFor(ctx, wanted) {
  const w = loginOf(wanted);
  if (w) return w;
  const known = (await channels(ctx))[0]?.data.channel;
  if (known) return known;
  return (await conns(ctx)).find((d) => d.data.slot === "main")?.data.channel ?? "";
}
/** Ajoute (ou met à jour) une chaîne connue. `redirectUri` : undefined = ne pas y toucher ; null = l'adresse du Connecteur. */
export async function remember(ctx, channel, redirectUri) {
  const list = await channels(ctx);
  const doc = list.find((d) => d.data.channel === channel);
  const next = { channel, redirectUri: redirectUri === undefined ? doc?.data.redirectUri ?? null : redirectUri };
  if (!doc && list.length >= LIMITS.channels) return false;
  await put(ctx, COL.channels, doc, next);
  return true;
}
export async function redirectFor(ctx, channel, own) {
  if (!channel) return own;
  return (await channels(ctx)).find((d) => d.data.channel === channel)?.data.redirectUri || own;
}

/* ───────────── Autorisations demandées par d'autres modules ───────────── */
/** Autorisations que d'autres modules peuvent demander (liste fermée : on n'accorde jamais autre chose à leur demande). */
export const EXTRA_SCOPES = ["user:read:chat", "user:write:chat", "user:bot", "channel:bot", "moderator:read:followers", "channel:read:subscriptions", "channel:manage:redemptions"];
export const RETURN_TO = /^\/admin\/instances\/[A-Za-z0-9_-]{1,64}$/;
export const wantsOf = async (ctx, channel, slot) => (await all(ctx, COL.wants, LIMITS.wants)).filter((d) => d.data.channel === channel && slotOf(d.data.slot) === slotOf(slot));
export async function wantedScopes(ctx, channel, slot) {
  const out = new Set();
  for (const d of await wantsOf(ctx, channel, slot)) for (const s of d.data.scopes ?? []) if (EXTRA_SCOPES.includes(s)) out.add(s);
  return [...out].sort();
}
export async function want(ctx, { channel, consumer, slot, scopes, returnTo }) {
  const who = String(consumer ?? "");
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(who)) return { ok: false, error: "invalid" };
  const list = [...new Set((Array.isArray(scopes) ? scopes : []).filter((s) => EXTRA_SCOPES.includes(s)))].sort();
  const back = typeof returnTo === "string" && RETURN_TO.test(returnTo) ? returnTo : null;
  const mine = (await wantsOf(ctx, channel, slot)).filter((d) => d.data.consumer === who);
  const next = { channel, consumer: who, slot: slotOf(slot), scopes: list, returnTo: back };
  const [keep, ...extra] = mine;
  for (const d of extra) await ctx.api.store.remove(d.id);
  if (!list.length) { if (keep) await ctx.api.store.remove(keep.id); return { ok: true, scopes: [] }; }
  if (!keep && (await all(ctx, COL.wants, LIMITS.wants)).length >= LIMITS.wants) return { ok: false, error: "full" };
  await put(ctx, COL.wants, keep, next);
  return { ok: true, scopes: list };
}
export async function returnPathOf(ctx, channel, slot) {
  return (await wantsOf(ctx, channel, slot)).find((d) => d.data.returnTo)?.data.returnTo ?? null;
}

/* ───────────── Derniers résultats ───────────── */
export async function resultOf(ctx, channel, slot) {
  return (await all(ctx, COL.results, 50)).find((d) => d.data.channel === channel && slotOf(d.data.slot) === slotOf(slot))?.data ?? null;
}
export async function clearResult(ctx, channel, slot) {
  for (const d of await all(ctx, COL.results, 50)) if (d.data.channel === channel && slotOf(d.data.slot) === slotOf(slot)) await ctx.api.store.remove(d.id);
}
export async function setResult(ctx, channel, slot, code, extra = {}) {
  await clearResult(ctx, channel, slot);
  const list = await all(ctx, COL.results, 50);
  for (const d of list.slice(0, Math.max(0, list.length - 40))) await ctx.api.store.remove(d.id);   // borne
  await ctx.api.store.add(COL.results, { channel, slot: slotOf(slot), code, at: new Date().toISOString(), ...extra });
}

/**
 * Écritures en file, par instance : deux reprises (ou deux rappels) simultanées ne créent jamais deux documents. Chaque étape est bornée : une étape
 * qui ne rend pas la main libère la file à l'expiration (jamais de file bloquée jusqu'au redémarrage).
 */
const queues = new Map();
export function serial(ctx, fn, ms = 20_000) {
  const key = ctx.instance?.id ?? "x";
  const prev = queues.get(key) ?? Promise.resolve();
  let timer;
  const run = prev.then(() => Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); timer.unref?.(); })]).finally(() => clearTimeout(timer)));
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}
export const resetQueues = () => queues.clear();
