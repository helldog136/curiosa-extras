// Shop (EXPERIMENTAL prototype): checkout with the manual payment provider, and the order life cycle.
// Real payment providers are NOT in this prototype: "paid" is set by the seller (bank transfer, cash on pickup).
const v = new URL(import.meta.url).search;   // the module's version travels to the neighbour files, so an update never keeps old code in memory
const { LIMITS, NEXT_STATES, manualHoldMs, currencyOf, includedTax, clean, validEmail, newToken, isToken } = await import(`./lib.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const S = await import(`./stock.mjs${v}`);
const M = await import(`./mail.mjs${v}`);
const Ship = await import(`./shipping.mjs${v}`);
const { cartIsLive } = await import(`./cart.mjs${v}`);

const event = (state, now, by = "system") => ({ s: state, at: new Date(now).toISOString(), by });
const newNumber = (now) => `N-${new Date(now).toISOString().slice(2, 10).replace(/-/g, "")}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

/**
 * Turn a live cart into an order that waits for a manual payment. Prices are copied (snapshot) into the order lines.
 * Reservations are extended to the hold (24 h by default) and tied to the order.
 * Returns { ok, token, orderId } | { ok: false, errors } | { ok: false, reason }.
 */
export async function checkout(ctx, cartToken, form, now = Date.now(), { holdMs } = {}) {
  const cart = isToken(cartToken) ? await D.findCart(ctx, cartToken) : null;
  if (!cartIsLive(cart, now)) return { ok: false, reason: "expired" };
  if (!cart.lines.length) return { ok: false, reason: "empty" };
  const errors = {};
  const name = clean(form.name, LIMITS.name), email = clean(form.email, LIMITS.email).toLowerCase(), address = clean(form.address, LIMITS.address, true);
  if (!name) errors.name = "name";
  if (!validEmail(email)) errors.email = "email";
  const cfg = await Ship.readConfig(ctx);
  const ship = Ship.quote(cfg, String(form.country ?? ""));
  if (!ship.ok) errors.country = ship.reason === "undelivered" ? "undelivered" : "country";
  if (!ship.pickup && address.length < 5) errors.address = "address";   // a pickup order needs no address
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
  const shipping = { mode: ship.mode, zone: ship.zone ?? null, country: ship.country ?? "", pickup: ship.pickup, price: ship.price, includedTax: ship.tax };
  total += ship.price; tax += ship.tax;                      // the price is copied: a later change of the shipping setup never touches this order
  const holdUntil = now + (holdMs ?? manualHoldMs(ctx));
  const token = newToken();
  const orderId = await D.addOrder(ctx, {
    number: newNumber(now), state: "awaiting_payment", provider: "manual", currency: currencyOf(ctx), lines, shipping, total, includedTax: tax,
    customer: { name, email, address }, holdUntil, payment: null, flag: "", paidEventIds: [], tracking: "", privateNote: "", history: [event("awaiting_payment", now, "customer")], lang: ctx.locale,
  }, token);
  for (const l of lines) await S.extend(ctx, l.rid, holdUntil, now, { orderId });
  cart.status = "ordered";
  await D.saveCart(ctx, cart);
  return { ok: true, token, orderId, order: await D.getOrder(ctx, orderId) };
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
  if (order.state === "paid") { await M.customerMail(ctx, order, "paid", {}, now); await M.noteOwner(ctx, order, "paid", now); }
  else await M.noteOwner(ctx, order, "to_resolve", now);
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
  if (next === "shipped" || next === "cancelled") await M.customerMail(ctx, order, next, {}, now);
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

/** After an order is placed (and its payment page asked for, if any): the customer's confirmation with the tracking link, a line for the owner's digest, a first try at sending. */
export async function afterPlaced(ctx, orderId, token, now = Date.now()) {
  const order = await D.getOrder(ctx, orderId);
  if (!order) return;
  await M.onPlaced(ctx, order, token, now);
  await M.noteOwner(ctx, order, "placed", now);
  M.flushSoon(ctx);
}

/**
 * The team sends the customer a NEW tracking link (the first message was lost): the old link dies, the new one goes out through the same outbox.
 * If the message cannot be written, the old link is given back, so the customer is never left with neither. At most 5 a day for one order.
 */
export async function resendLink(ctx, orderId, now = Date.now()) {
  const order = await D.getOrder(ctx, orderId);
  if (!order) return { ok: false, reason: "unknown" };
  const recent = (order.linkResends ?? []).filter((t) => now - t < 24 * 3_600_000);
  if (recent.length >= LIMITS.linkResendsPerDay) return { ok: false, reason: "limit" };
  const token = newToken();
  const rotated = await D.rotateOrderToken(ctx, { ...order, linkResends: [...recent, now] }, token);
  if (!rotated) return { ok: false, reason: "unknown" };
  const queued = await M.customerMail(ctx, order, "link", { token, key: `link:${order.id}:${now}` }, now);
  if (!queued.ok) { await D.saveOrder(ctx, order); await D.restoreOrderKey(ctx, order.id, rotated.oldKey); return { ok: false, reason: "mail" }; }   // the old link and the old count come back
  M.flushSoon(ctx);
  return { ok: true };
}
