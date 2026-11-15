// Shop (EXPERIMENTAL prototype): the cart. A piece is reserved as soon as it enters the cart; the cart expires after
// `cartMinutes` (5) without payment started, and the timer restarts on every change. All functions take `now` for tests.
import { LIMITS, cartMs, hashToken, newToken, isToken } from "./lib.mjs";
import * as D from "./data.mjs";
import * as S from "./stock.mjs";

const isLive = (cart, now) => cart && cart.status === "open" && cart.expiresAt > now;

/** Drop every reservation of a dead cart (idempotent). */
async function discard(ctx, cart) {
  for (const l of cart.lines ?? []) await S.release(ctx, l.rid);
}

/**
 * Add `qty` of a variant. `token` is the visitor's cart token (cookie) or null.
 * Returns { ok, token, reason?, available? }; `token` is always the token to put (back) in the cookie.
 */
export async function addToCart(ctx, token, { productId, variantId, qty }, now = Date.now()) {
  const product = await D.getProduct(ctx, productId);
  const variant = product?.variants.find((v) => v.id === variantId);
  if (!product || product.status !== "published" || !variant) return { ok: false, reason: "unknown", token };
  qty = Number.isInteger(qty) ? qty : 0;
  const perLine = variant.stockMode === "single" ? 1 : LIMITS.maxPerLine;
  if (qty < 1 || qty > perLine) return { ok: false, reason: "quantity", token };

  let cart = isToken(token) ? await D.findCart(ctx, token) : null;
  if (cart && !isLive(cart, now)) { if (cart.status === "open") await discard(ctx, cart); await ctx.api.store.remove(cart.id); cart = null; }
  if (!cart) { token = newToken(); cart = await D.createCart(ctx, token, now + cartMs(ctx), now); }

  const same = cart.lines.filter((l) => l.productId === productId && l.variantId === variantId).reduce((n, l) => n + l.qty, 0);
  if (same + qty > perLine) return { ok: false, reason: "quantity", token };
  if (cart.lines.length >= LIMITS.linesPerCart) return { ok: false, reason: "cart_full", token };
  if ((await S.heldCount(ctx, now)) >= LIMITS.heldGlobal) return { ok: false, reason: "busy", token };

  const expiresAt = now + cartMs(ctx);
  const r = await S.reserve(ctx, { cartId: cart.id, product, variant, qty, expiresAt, now });
  if (!r.ok) return { ok: false, reason: r.reason, available: r.available, token };
  cart.lines.push({ rid: r.id, productId, variantId, qty });
  await restartTimer(ctx, cart, expiresAt, now);
  return { ok: true, token };
}

export async function removeLine(ctx, token, rid, now = Date.now()) {
  const cart = isToken(token) ? await D.findCart(ctx, token) : null;
  if (!isLive(cart, now)) return { ok: false, reason: "expired" };
  const i = cart.lines.findIndex((l) => l.rid === rid);
  if (i < 0) return { ok: false, reason: "unknown" };
  await S.release(ctx, rid);
  cart.lines.splice(i, 1);
  await restartTimer(ctx, cart, now + cartMs(ctx), now);
  return { ok: true };
}

/** Every change restarts the 5-minute timer, on the cart and on each of its reservations (never reviving a dead one). */
async function restartTimer(ctx, cart, expiresAt, now) {
  const kept = [];
  for (const l of cart.lines) if (await S.extend(ctx, l.rid, expiresAt, now)) kept.push(l);
  cart.lines = kept;
  cart.expiresAt = expiresAt;
  await D.saveCart(ctx, cart);
}

/** What the visitor sees: live lines with snapshot-free current prices, total and seconds left. */
export async function viewCart(ctx, token, now = Date.now()) {
  const cart = isToken(token) ? await D.findCart(ctx, token) : null;
  if (!isLive(cart, now)) return { lines: [], total: 0, secondsLeft: 0, expired: Boolean(cart) };
  const lines = [];
  let total = 0;
  for (const l of cart.lines) {
    const product = await D.getProduct(ctx, l.productId);
    const variant = product?.variants.find((v) => v.id === l.variantId);
    if (!product || !variant) continue;
    const sum = variant.price * l.qty;
    total += sum;
    lines.push({ rid: l.rid, productId: l.productId, variantId: l.variantId, title: product.title, label: variant.label, qty: l.qty, unit: variant.price, sum });
  }
  return { lines, total, secondsLeft: Math.max(0, Math.round((cart.expiresAt - now) / 1000)), expired: false };
}
/** Opening the payment page also restarts the timer (decision D10). */
export async function touch(ctx, token, now = Date.now()) {
  const cart = isToken(token) ? await D.findCart(ctx, token) : null;
  if (!isLive(cart, now)) return false;
  await restartTimer(ctx, cart, now + cartMs(ctx), now);
  return true;
}
export { isLive as cartIsLive, discard as discardCart };
export const cartKeyOf = (token) => hashToken("cart", token);

/** Housekeeping: dead carts and their old reservation documents. Idempotent, bounded. */
export async function sweepCarts(ctx, now = Date.now()) {
  const page = await ctx.api.store.page("carts", { order: "asc", limit: LIMITS.purgeBatch });
  let removed = 0;
  for (const r of page.items) {
    const c = r.data;
    if (c.status === "open" && c.expiresAt < now - 3_600_000) { await discard(ctx, { lines: c.lines }); await ctx.api.store.remove(r.id); removed++; }
    else if (c.status === "ordered" && c.at < now - 24 * 3_600_000) { await ctx.api.store.remove(r.id); removed++; }
  }
  return removed;
}
