// Shop (EXPERIMENTAL prototype): checkout with the manual payment provider, and the order life cycle.
// Real payment providers are NOT in this prototype: "paid" is set by the seller (bank transfer, cash on pickup).
import { LIMITS, NEXT_STATES, manualHoldMs, currencyOf, includedTax, clean, validEmail, newToken, isToken } from "./lib.mjs";
import * as D from "./data.mjs";
import * as S from "./stock.mjs";
import { cartIsLive } from "./cart.mjs";

const event = (state, now, by = "system") => ({ s: state, at: new Date(now).toISOString(), by });
const newNumber = (now) => `N-${new Date(now).toISOString().slice(2, 10).replace(/-/g, "")}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

/**
 * Turn a live cart into an order that waits for a manual payment. Prices are copied (snapshot) into the order lines.
 * Reservations are extended to the hold (24 h by default) and tied to the order.
 * Returns { ok, token, orderId } | { ok: false, errors } | { ok: false, reason }.
 */
export async function checkout(ctx, cartToken, form, now = Date.now()) {
  const cart = isToken(cartToken) ? await D.findCart(ctx, cartToken) : null;
  if (!cartIsLive(cart, now)) return { ok: false, reason: "expired" };
  if (!cart.lines.length) return { ok: false, reason: "empty" };
  const errors = {};
  const name = clean(form.name, LIMITS.name), email = clean(form.email, LIMITS.email).toLowerCase(), address = clean(form.address, LIMITS.address, true);
  if (!name) errors.name = "name";
  if (!validEmail(email)) errors.email = "email";
  if (address.length < 5) errors.address = "address";
  if (Object.keys(errors).length) return { ok: false, errors };

  const lines = [];
  let total = 0, tax = 0;
  for (const l of cart.lines) {
    const product = await D.getProduct(ctx, l.productId);
    const variant = product?.variants.find((v) => v.id === l.variantId);
    if (!product || !variant) return { ok: false, reason: "changed" };
    const sum = variant.price * l.qty;
    const lineTax = includedTax(sum, product.taxRate ?? 0);
    lines.push({ rid: l.rid, productId: product.id, variantId: variant.id, kind: product.kind, title: product.title, label: variant.label, qty: l.qty, unit: variant.price, sum, taxRate: product.taxRate ?? 0, includedTax: lineTax });
    total += sum; tax += lineTax;
  }
  const holdUntil = now + manualHoldMs(ctx);
  const token = newToken();
  const orderId = await D.addOrder(ctx, {
    number: newNumber(now), state: "awaiting_payment", provider: "manual", currency: currencyOf(ctx), lines, total, includedTax: tax,
    customer: { name, email, address }, holdUntil, paidEventIds: [], tracking: "", privateNote: "", history: [event("awaiting_payment", now, "customer")], lang: ctx.locale,
  }, token);
  for (const l of lines) await S.extend(ctx, l.rid, holdUntil, now, { orderId });
  cart.status = "ordered";
  await D.saveCart(ctx, cart);
  return { ok: true, token, orderId };
}

/**
 * The seller confirms the manual payment (a real provider would call the same function from its verified event).
 * Idempotent per `eventId`. If the hold ended, the pieces are taken again only if they are still free;
 * otherwise the order becomes `paid_to_resolve` and a person decides (never an automatic refund).
 */
export async function markPaid(ctx, orderId, { eventId = "", amount, currency, by = "seller" } = {}, now = Date.now()) {
  const order = await D.getOrder(ctx, orderId);
  if (!order) return { ok: false, reason: "unknown" };
  if (eventId && order.paidEventIds.includes(eventId)) return { ok: true, already: true, state: order.state };
  if (order.state !== "awaiting_payment" && order.state !== "expired") return { ok: true, already: true, state: order.state };
  if ((amount !== undefined && amount !== order.total) || (currency !== undefined && currency !== order.currency)) return { ok: false, reason: "amount_mismatch" };

  const taken = [];
  let complete = true;
  for (const l of order.lines) {
    if (await S.markSold(ctx, l.rid, now)) { taken.push(l.rid); continue; }
    const product = await D.getProduct(ctx, l.productId);
    const variant = product?.variants.find((v) => v.id === l.variantId);
    const r = product && variant ? await S.reserve(ctx, { cartId: null, orderId, product, variant, qty: l.qty, expiresAt: now + 60_000, now }) : { ok: false };
    if (r.ok) { await S.markSold(ctx, r.id, now); l.rid = r.id; taken.push(r.id); } else { complete = false; break; }
  }
  if (!complete) for (const rid of taken) await S.release(ctx, rid);      // all or nothing: nothing stays half-reserved
  order.state = complete ? "paid" : "paid_to_resolve";
  if (!complete) order.lines.forEach((l) => { l.rid = null; });
  if (eventId) order.paidEventIds = [...order.paidEventIds, eventId].slice(-20);
  order.history = [...order.history, event(order.state, now, by)].slice(-30);
  await D.saveOrder(ctx, order);
  return { ok: true, state: order.state };
}

/** Seller moves an order forward (or cancels). Cancelling releases the pieces; money is never touched here. */
export async function setState(ctx, orderId, next, { tracking = "", note = "", by = "seller" } = {}, now = Date.now()) {
  const order = await D.getOrder(ctx, orderId);
  if (!order) return { ok: false, reason: "unknown" };
  if (!(NEXT_STATES[order.state] ?? []).includes(next)) return { ok: false, reason: "transition" };
  if (next === "cancelled") for (const l of order.lines) if (l.rid) await S.release(ctx, l.rid);
  if (next === "shipped") order.tracking = clean(tracking, LIMITS.tracking);
  if (note) order.privateNote = clean(note, LIMITS.note, true);
  order.state = next;
  order.history = [...order.history, event(next, now, by)].slice(-30);
  await D.saveOrder(ctx, order);
  return { ok: true, state: next };
}

/** Orders whose hold ended without payment become `expired`; their pieces are already free (a reservation stops counting by itself). */
export async function expireOrders(ctx, now = Date.now()) {
  let n = 0;
  for (const o of await D.listOrders(ctx)) {
    if (n >= LIMITS.purgeBatch) break;
    if (o.state !== "awaiting_payment" || o.holdUntil > now) continue;
    o.state = "expired";
    o.history = [...o.history, event("expired", now)].slice(-30);
    for (const l of o.lines) if (l.rid) await S.release(ctx, l.rid);
    await D.saveOrder(ctx, o);
    n++;
  }
  return n;
}
