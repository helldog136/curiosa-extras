// Shop (EXPERIMENTAL prototype): stock by reservations.
//
// The store has no atomic increment and no compare-and-set. So buyers never write a counter:
//   available = onHand (written by the seller only) - quantity of the ACCEPTED reservation documents.
// A reservation is one document (collection "reservations", key "<productId>:<variantId>").
// Reserve = add the document, read every reservation of that variant in creation order, accept them greedily
// in that order (a document is accepted when the running total plus its quantity fits), keep mine only if accepted.
// Every reader that sees the same prefix computes the same accepted set, so two buyers of the last piece cannot both win.
// Assumption NOT verified against the real core store: ids / creation times are totally ordered and a document
// is visible to every reader as soon as `add` returns (see docs/ideas/BOUTIQUE.md, section 7b).
import { LIMITS } from "./lib.mjs";

export const keyOf = (productId, variantId) => `${productId}:${variantId}`;
/** Seats for a variant: unlimited, one-of-a-kind, or counted. */
export function capacityOf(variant) {
  if (!variant) return 0;
  if (variant.stockMode === "unlimited") return Infinity;
  if (variant.stockMode === "single") return Math.min(1, Math.max(0, variant.onHand ?? 1));
  return Math.max(0, Math.trunc(variant.onHand ?? 0));
}
/** A reservation counts while it is sold, or held and not expired. */
export const live = (d, now) => d.state === "sold" || (d.state === "held" && d.expiresAt > now);

export async function readAll(ctx, productId, variantId) {
  const key = keyOf(productId, variantId);
  const rows = [];
  let cursor;
  for (let guard = 0; guard < 50; guard++) {
    const p = await ctx.api.store.page("reservations", { key, order: "asc", limit: 1000, cursor });
    rows.push(...p.items);
    if (!p.next) break;
    cursor = p.next;
  }
  return rows;
}
/** Greedy acceptance in creation order. Pure: used by the shop page, the admin and the reserve step alike. */
export function accepted(rows, capacity, now) {
  const ok = new Set();
  let used = 0;
  for (const r of rows) {
    if (!live(r.data, now)) continue;
    if (used + r.data.qty <= capacity) { used += r.data.qty; ok.add(r.id); }
  }
  return { ok, used };
}
export async function availability(ctx, product, variant, now = Date.now()) {
  const cap = capacityOf(variant);
  if (cap === Infinity) return { capacity: cap, used: 0, available: Infinity };
  const { used } = accepted(await readAll(ctx, product.id, variant.id), cap, now);
  return { capacity: cap, used, available: Math.max(0, cap - used) };
}

/**
 * Try to hold `qty` pieces. Returns { ok: true, id } or { ok: false, reason: "sold_out" | "busy", available }.
 * `state`/`expiresAt` let the order flow re-reserve a piece that has been released.
 */
export async function reserve(ctx, { cartId, product, variant, qty, expiresAt, now = Date.now(), orderId = null }) {
  const cap = capacityOf(variant);
  if (cap !== Infinity && cap < 1) return { ok: false, reason: "sold_out", available: 0 };
  const id = await ctx.api.store.add("reservations", { cartId, orderId, productId: product.id, variantId: variant.id, qty, state: "held", expiresAt, at: now }, { key: keyOf(product.id, variant.id) });
  if (cap === Infinity) return { ok: true, id };
  const { ok, used } = accepted(await readAll(ctx, product.id, variant.id), cap, now);
  if (ok.has(id)) return { ok: true, id };
  await ctx.api.store.remove(id);
  return { ok: false, reason: "sold_out", available: Math.max(0, cap - used) };
}
export async function release(ctx, id) { await ctx.api.store.remove(id); }
/** Extend a reservation that is still live. Never revives an expired one (someone else may have taken the piece). */
export async function extend(ctx, id, expiresAt, now = Date.now(), patch = {}) {
  const row = await ctx.api.store.get(id);
  if (!row || !live(row.data, now)) return false;
  await ctx.api.store.update(id, { ...row.data, ...patch, expiresAt });
  return true;
}
export async function markSold(ctx, id, now = Date.now()) {
  const row = await ctx.api.store.get(id);
  if (!row || !live(row.data, now)) return false;
  await ctx.api.store.update(id, { ...row.data, state: "sold", expiresAt: null });
  return true;
}
/** Count of live reservations on the whole shop (the global anti-hoarding cap). Bounded read. */
export async function heldCount(ctx, now = Date.now()) {
  const p = await ctx.api.store.page("reservations", { limit: LIMITS.heldGlobal + 1 });
  return p.items.filter((r) => r.data.state === "held" && r.data.expiresAt > now).length;
}
/** Old held documents are dead weight: remove them (idempotent, bounded). */
export async function purgeDead(ctx, now = Date.now(), graceMs = 3_600_000) {
  const p = await ctx.api.store.page("reservations", { order: "asc", limit: LIMITS.purgeBatch });
  let removed = 0;
  for (const r of p.items) if (r.data.state === "held" && r.data.expiresAt < now - graceMs) { await ctx.api.store.remove(r.id); removed++; }
  return removed;
}
