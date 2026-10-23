// Commandes — la couche de données : lecture et écriture du stockage de l'instance, avec des valeurs toujours sûres (un document abîmé ou
// restauré d'une autre version ne fait jamais planter une page). Aucun texte affiché ici.
//
// Collections :
//   orders    une commande par document. Clé du stockage = « t: » + empreinte du lien de suivi (retrouver une commande par son lien sans parcourir).
//   formulas  une formule par document (nom, prix indicatif, délai, contenu, visible ou non, rang).
//   queue     un seul document : ouvert / complet / fermé, nombre de places, date de réouverture, message, date du dernier e-mail envoyé à l'équipe.
const v = new URL(import.meta.url).search;   // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const L = await import(`./lib.mjs${v}`);
const { STATUSES, ACTIVE, MODES, LIMITS, clean, num, idOk, isoOk, dayOk, httpUrl, isHash, hashToken, isToken, sameHash, tokenKey } = L;

export const ORDERS = "orders", FORMULAS = "formulas", QUEUE = "queue";

// ── La file : ouvert, complet, fermé ──────────────────────────────────────────────────────────────────────────────
export const QUEUE_DEFAULT = { mode: "closed", slots: 3, reopenOn: "", message: "", lastOwnerMailAt: 0 };
export function normQueue(d) {
  const o = d && typeof d === "object" ? d : {};
  return {
    mode: MODES.includes(o.mode) ? o.mode : QUEUE_DEFAULT.mode,
    slots: num(o.slots, QUEUE_DEFAULT.slots, 0, LIMITS.slots),
    reopenOn: dayOk(o.reopenOn),
    message: clean(o.message, LIMITS.message),
    lastOwnerMailAt: Number.isFinite(Number(o.lastOwnerMailAt)) ? Number(o.lastOwnerMailAt) : 0,
  };
}
export async function readQueue(ctx) {
  const [row] = await ctx.api.store.list(QUEUE, { limit: 1 });
  return { id: row?.id ?? null, ...normQueue(row?.data) };
}
export async function writeQueue(ctx, patch) {
  const cur = await readQueue(ctx);
  const { id, ...rest } = cur;
  const next = normQueue({ ...rest, ...patch });
  if (id) await ctx.api.store.update(id, next); else await ctx.api.store.add(QUEUE, next);
  return next;
}

// ── Les commandes ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Une ligne du stockage devient une commande aux valeurs sûres (texte borné, état connu, dates valides). */
export function normOrder(row) {
  const d = row?.data && typeof row.data === "object" ? row.data : {};
  const at = new Date(row?.createdAt ?? 0);
  const history = (Array.isArray(d.history) ? d.history : []).slice(-LIMITS.history)
    .map((h) => ({ s: STATUSES.includes(h?.s) ? h.s : "new", at: isoOk(h?.at) ?? "" })).filter((h) => h.at);
  return {
    id: row?.id,
    at: Number.isNaN(at.getTime()) ? new Date(0) : at,
    nick: clean(d.nick, LIMITS.nick),
    email: clean(d.email, LIMITS.email),
    mailOptIn: d.mailOptIn === true,
    contactId: idOk(d.contactId) ? d.contactId : null,
    formulaId: idOk(d.formulaId) ? d.formulaId : "",
    formulaName: clean(d.formulaName, LIMITS.formulaName),
    want: clean(d.want, LIMITS.want, true),
    inspiration: d.inspiration ? httpUrl(d.inspiration) ?? "" : "",
    status: STATUSES.includes(d.status) ? d.status : "new",
    history,
    privateNote: clean(d.privateNote, LIMITS.note, true),
    clientNote: clean(d.clientNote, LIMITS.clientNote, true),
    tokenHash: isHash(d.tokenHash) ? d.tokenHash : "",
    lang: clean(d.lang, 8),
    queuedAt: isoOk(d.queuedAt) ?? "",
  };
}
/** Ce qu'on range dans le stockage pour une commande. */
export const orderData = (o) => ({
  nick: o.nick, email: o.email, mailOptIn: o.mailOptIn, contactId: o.contactId, formulaId: o.formulaId, formulaName: o.formulaName, want: o.want,
  inspiration: o.inspiration, status: o.status, history: o.history.slice(-LIMITS.history), privateNote: o.privateNote, clientNote: o.clientNote,
  tokenHash: o.tokenHash, lang: o.lang, queuedAt: o.queuedAt || null,
});
/** Date du dernier changement d'état (sinon de la réception). */
export const lastChange = (o) => Date.parse(o.history[o.history.length - 1]?.at ?? "") || o.at.getTime();

export async function listOrders(ctx) {
  return (await ctx.api.store.list(ORDERS, { limit: LIMITS.orders })).map(normOrder);
}
export async function getOrder(ctx, id) {
  if (!idOk(id)) return null;
  const row = await ctx.api.store.get(id);
  return row && row.data && typeof row.data === "object" && "status" in row.data && "nick" in row.data ? normOrder(row) : null;
}
export async function saveOrder(ctx, order, opts) {
  const ok = await ctx.api.store.update(order.id, orderData(order), opts);
  bust(ctx);
  return ok;
}
export async function addOrder(ctx, order) {
  const id = await ctx.api.store.add(ORDERS, orderData(order), { key: tokenKey(order.tokenHash) });
  bust(ctx);
  return id;
}
export async function removeOrder(ctx, id) { await ctx.api.store.remove(id); bust(ctx); }

/** Retrouve une commande par son lien de suivi. Le lien est contrôlé AVANT toute lecture ; l'empreinte est comparée à temps constant. Jamais d'exception. */
export async function findByToken(ctx, token) {
  if (!isToken(token)) return null;
  try {
    const hash = hashToken(token);
    let row = null;
    if (typeof ctx.api.store.getByKey === "function") row = await ctx.api.store.getByKey(ORDERS, tokenKey(hash));
    else row = (await ctx.api.store.list(ORDERS, { limit: LIMITS.orders })).find((r) => sameHash(r?.data?.tokenHash, hash)) ?? null;
    if (!row) return null;
    const order = normOrder(row);
    return sameHash(order.tokenHash, hash) ? order : null;
  } catch { return null; }
}

// ── Chiffres : places, files d'attente (calculés d'après les commandes, gardés 10 secondes) ─────────────────────────
const cache = new Map();
const TTL = 10_000;
export function bust(ctx) { cache.delete(ctx.instance.key); }
export async function stats(ctx, { now = Date.now() } = {}) {
  const hit = cache.get(ctx.instance.key);
  let generation = 0;
  try { generation = typeof ctx.api.store.generation === "function" ? Number(await ctx.api.store.generation()) || 0 : 0; } catch { generation = 0; }   // une restauration de sauvegarde change ce nombre : on relit
  if (hit && hit.generation === generation && now - hit.at < TTL) return hit.value;
  const orders = await listOrders(ctx);
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const o of orders) byStatus[o.status]++;
  const waiting = orders.filter((o) => ACTIVE.includes(o.status)).map((o) => ({ id: o.id, t: Date.parse(o.queuedAt) || o.at.getTime() })).sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  const value = { total: orders.length, byStatus, active: waiting.length, waiting, orders };
  cache.set(ctx.instance.key, { at: now, generation, value });
  if (cache.size > 200) for (const k of cache.keys()) { cache.delete(k); if (cache.size <= 100) break; }
  return value;
}
/** Combien de commandes acceptées ou en cours passent avant celle-ci (null si elle n'est pas dans la file). */
export const aheadOf = (st, id) => { const i = st.waiting.findIndex((w) => w.id === id); return i < 0 ? null : i; };

/** L'état que voient les visiteurs : fermé, complet ou ouvert (avec les places libres, ou null s'il n'y a pas de limite). */
export function publicState(queue, st) {
  if (queue.mode === "closed") return { state: "closed", free: null };
  const free = queue.slots > 0 ? Math.max(0, queue.slots - st.active) : null;
  if (queue.mode === "full" || free === 0) return { state: "full", free: 0 };
  return { state: "open", free };
}

// ── Les formules ──────────────────────────────────────────────────────────────────────────────────────────────────
export function normFormula(row) {
  const d = row?.data && typeof row.data === "object" ? row.data : {};
  return {
    id: row?.id,
    at: new Date(row?.createdAt ?? 0).getTime() || 0,
    name: clean(d.name, LIMITS.formulaName),
    price: clean(d.price, LIMITS.formulaPrice),
    delay: clean(d.delay, LIMITS.formulaDelay),
    includes: clean(d.includes, LIMITS.formulaIncludes, true),
    visible: d.visible !== false,
    pos: Number.isFinite(Number(d.pos)) ? Number(d.pos) : 0,
  };
}
export const formulaData = (f) => ({ name: f.name, price: f.price, delay: f.delay, includes: f.includes, visible: f.visible, pos: f.pos });
export async function listFormulas(ctx) {
  const rows = (await ctx.api.store.list(FORMULAS, { limit: 100 })).map(normFormula).filter((f) => f.name);
  return rows.sort((a, b) => a.pos - b.pos || a.at - b.at || (a.id < b.id ? -1 : 1)).slice(0, 100);
}
