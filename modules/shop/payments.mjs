// Shop (EXPERIMENTAL prototype): online payment through ANY module that offers the service "payment.provider" (contract: docs/ideas/BOUTIQUE.md, section 14).
// The shop knows no provider by name. It never receives card data (the customer pays on the provider's own page) and never trusts a notification:
// a notification only carries the provider's own reference; the real state is always asked back from the provider.
const v = new URL(import.meta.url).search;   // the module's version travels to the neighbour files, so an update never keeps old code in memory
const { LIMITS, onlineHoldMs, isToken } = await import(`./lib.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const O = await import(`./orders.mjs${v}`);

export const PROVIDER = "payment.provider";
const FINAL_BAD = ["failed", "canceled", "expired"];
const STATES = ["open", "pending", "paid", ...FINAL_BAD];
const event = (s, now, by = "provider") => ({ s, at: new Date(now).toISOString(), by });

/** Providers that can take a payment right now: [{ id, name, mode }]. Never throws; a provider that fails to answer is left out. */
export async function readyProviders(ctx) {
  let list = [];
  try { list = await ctx.api.services.providers(PROVIDER); } catch { return []; }
  const out = [];
  for (const p of list.slice(0, 10)) {
    const r = await ctx.api.services.call(PROVIDER, "describe", {}, { provider: p.id });
    if (r.ok && r.value && r.value.ready === true) out.push({ id: p.id, name: String(r.value.name ?? p.name ?? "").slice(0, 60), mode: r.value.mode === "live" ? "live" : "test" });
  }
  return out;
}
export async function pickProvider(ctx, wantedId) {
  const ready = await readyProviders(ctx);
  return ready.find((p) => p.id === wantedId) ?? ready[0] ?? null;
}
export const holdFor = (ctx, provider) => (provider ? onlineHoldMs(ctx) : undefined);

const trackUrl = (ctx, token) => `${String(ctx.api.siteUrl ?? "").replace(/\/+$/, "")}${ctx.instance.basePath ? `/${ctx.instance.basePath}` : ""}/track/${token}`;
const httpsUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === "https:" && !x.username && !x.password ? x.toString() : ""; } catch { return ""; } };

/** Ask the provider for a hosted payment page for this order. Records the attempt. Returns { ok, url } | { ok: false, reason }. */
export async function startPayment(ctx, order, token, provider, now = Date.now()) {
  if (!provider) return { ok: false, reason: "no_provider" };
  const attempt = (order.payment?.attempts?.length ?? 0) + 1;
  if (attempt > LIMITS.paymentAttempts) return { ok: false, reason: "too_many_attempts" };
  const r = await ctx.api.services.call(PROVIDER, "createCheckout", {
    idempotencyKey: `${order.id}:${attempt}`, amount: order.total, currency: order.currency, description: `${order.number}`.slice(0, 120),
    returnUrl: trackUrl(ctx, token), metadata: { orderId: order.id }, locale: ctx.locale,
  }, { provider: provider.id });
  const v = r.ok ? r.value : null;
  const url = v?.ok ? httpsUrl(v.checkoutUrl) : "";
  if (!v?.ok || !url || typeof v.providerRef !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(v.providerRef)) {
    order.history = [...order.history, event("payment_start_failed", now, "system")].slice(-30);
    await D.saveOrder(ctx, order);
    return { ok: false, reason: v?.reason === "not_ready" ? "no_provider" : "start_failed" };
  }
  order.payment = { providerId: provider.id, providerName: provider.name, mode: provider.mode, providerRef: v.providerRef, state: "open", checkoutUrl: url, checkedAt: now, attempts: [...(order.payment?.attempts ?? []), { ref: v.providerRef, at: now }].slice(-LIMITS.paymentAttempts) };
  order.history = [...order.history, event("payment_started", now, "system")].slice(-30);
  await D.saveOrder(ctx, order);
  await ctx.api.store.add("payrefs", { orderId: order.id }, { key: v.providerRef });
  return { ok: true, url };
}

/** Apply a state read from the provider. Idempotent: replaying it changes nothing more. */
export async function applyStatus(ctx, order, status, now = Date.now()) {
  if (!order.payment || !status || !STATES.includes(status.state)) return { ok: false, reason: "unknown_state" };
  const ref = order.payment.providerRef;
  order.payment.checkedAt = now;
  if (status.state === "paid") {
    if (order.state === "cancelled") {          // money arrived for an order the seller cancelled: nothing automatic, a person decides
      if (order.flag !== "paid_after_cancel") { order.flag = "paid_after_cancel"; order.history = [...order.history, event("paid_after_cancel", now)].slice(-30); }
      order.payment.state = "paid";
      await D.saveOrder(ctx, order);
      return { ok: true, state: order.state, flagged: true };
    }
    await D.saveOrder(ctx, order);              // keeps checkedAt before markPaid reloads the order
    const r = await O.markPaid(ctx, order.id, { eventId: `${ref}:paid`, amount: status.amount, currency: status.currency, by: "provider" }, now);
    const fresh = await D.getOrder(ctx, order.id);
    if (!r.ok && r.reason === "amount_mismatch") {
      fresh.flag = "payment_mismatch";
      fresh.history = [...fresh.history, event("payment_mismatch", now)].slice(-30);
      await D.saveOrder(ctx, fresh);
      return { ok: false, reason: "amount_mismatch" };
    }
    if (fresh.payment.state !== "paid") { fresh.payment.state = "paid"; await D.saveOrder(ctx, fresh); }
    return { ok: r.ok, state: fresh.state };
  }
  if (order.payment.state !== status.state) {
    order.payment.state = status.state;
    if (FINAL_BAD.includes(status.state)) order.history = [...order.history, event(`payment_${status.state}`, now)].slice(-30);
  }
  await D.saveOrder(ctx, order);
  return { ok: true, state: order.state };
}

/** Ask the provider for the real state of the order's current payment, then apply it. { ok: false } when the provider cannot answer. */
export async function refreshOrder(ctx, order, now = Date.now()) {
  if (!order?.payment?.providerRef) return { ok: false, reason: "no_payment" };
  const r = await ctx.api.services.call(PROVIDER, "getStatus", { providerRef: order.payment.providerRef }, { provider: order.payment.providerId });
  if (!r.ok || !r.value?.ok) return { ok: false, reason: "provider_unavailable" };
  return applyStatus(ctx, order, r.value, now);
}

// Service "payment.consumer" (offered by the shop; providers call it from their notification route, `requires` it as optional).
const seen = (globalThis[Symbol.for("curiosa.shop.notified")] ??= new Map());
export const consumer = {
  /** { providerRef } → { ok: true, known } | throws when the provider could not be asked (the caller then answers "try again later"). */
  async notify(ctx, args) {
    const ref = typeof args?.providerRef === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(args.providerRef) ? args.providerRef : null;
    if (!ref) return { ok: false, reason: "invalid" };
    const row = await ctx.api.store.getByKey("payrefs", ref);
    const order = row ? await D.getOrder(ctx, row.data.orderId) : null;
    if (!order || order.payment?.providerRef !== ref && !order.payment?.attempts?.some((a) => a.ref === ref)) return { ok: true, known: false };
    const mark = `${ctx.instance.key}|${ref}`, now = Date.now();
    if (now - (seen.get(mark) ?? 0) < LIMITS.notifyMinGapMs) return { ok: true, known: true, skipped: true };   // forged or repeated nudges cost nothing
    seen.set(mark, now);
    if (seen.size > 2000) for (const [k, t] of seen) if (now - t > 60_000) seen.delete(k);
    const r = await refreshOrderByRef(ctx, order, ref, now);
    if (!r.ok && r.reason === "provider_unavailable") throw new Error("provider_unavailable");
    return { ok: true, known: true, state: r.state };
  },
};
async function refreshOrderByRef(ctx, order, ref, now) {
  const attempt = order.payment.attempts?.find((a) => a.ref === ref);
  if (order.payment.providerRef !== ref && attempt) order = { ...order, payment: { ...order.payment, providerRef: ref } };   // an older attempt may be the one that got paid
  return refreshOrder(ctx, order, now);
}

/** Scheduled pass (every few minutes): the fallback that needs no incoming connection. Bounded, replayable. */
export async function pollOpenPayments(ctx, now = Date.now()) {
  let checked = 0;
  for (const o of await D.listOrders(ctx)) {
    if (checked >= LIMITS.pollBatch) break;
    const p = o.payment;
    if (!p?.providerRef || !["open", "pending"].includes(p.state) || !["awaiting_payment", "expired"].includes(o.state)) continue;
    if (now - o.at.getTime() > LIMITS.pollWindowMs || now - (p.checkedAt ?? 0) < LIMITS.pollMinGapMs) continue;
    checked++;
    await refreshOrder(ctx, o, now);
  }
  return checked;
}
export const looksLikeToken = isToken;
