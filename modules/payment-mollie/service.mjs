// Mollie payments (EXPERIMENTAL prototype): the service "payment.provider" (version 1). Contract: docs/ideas/BOUTIQUE.md, section 14.
import { isPublicSite, toValue, fromValue, MAX_AMOUNT, keyMode, clean, paymentId, withLock } from "./lib.mjs";
import * as M from "./mollie.mjs";

const LOCALES = { en: "en_GB", fr: "fr_FR", nl: "nl_NL", de: "de_DE" };

/** { id, name, mode, ready, problems } : what the shop needs to know, never the key. */
export function describe(ctx) {
  const mode = keyMode(M.keyOf(ctx));
  const problems = [];
  if (!M.keyOf(ctx)) problems.push("no_key"); else if (!mode) problems.push("bad_key");
  if (mode === "live" && !isPublicSite(ctx.api.siteUrl)) problems.push("site_private");   // test mode works anywhere: the shop asks for the state itself
  return { id: ctx.instance.key, name: "Mollie", mode: mode ?? "test", ready: problems.length === 0, problems, publicSite: isPublicSite(ctx.api.siteUrl), webhook: isPublicSite(ctx.api.siteUrl) };
}

/** { idempotencyKey, amount (cents), currency, description, returnUrl, metadata?, locale? } → { ok, providerRef, checkoutUrl, expiresAt } | { ok: false, reason } */
export async function createCheckout(ctx, args) {
  if (!describe(ctx).ready) return { ok: false, reason: "not_ready" };
  const a = args && typeof args === "object" ? args : {};
  const key = clean(a.idempotencyKey, 120);
  if (!key) return { ok: false, reason: "invalid" };
  if (!Number.isInteger(a.amount) || a.amount < 1 || a.amount > MAX_AMOUNT) return { ok: false, reason: "amount" };
  if (!/^[A-Z]{3}$/.test(String(a.currency))) return { ok: false, reason: "currency" };
  let redirectUrl;
  try { const u = new URL(String(a.returnUrl)); if (!/^https?:$/.test(u.protocol)) throw 0; redirectUrl = u.toString(); } catch { return { ok: false, reason: "invalid" }; }
  return withLock(`${ctx.instance.key}|ik|${key}`, async () => {
    const known = await ctx.api.store.getByKey("checkouts", key);       // the same request twice gives the same payment page, never two payments
    if (known) return { ok: true, providerRef: known.data.providerRef, checkoutUrl: known.data.checkoutUrl, expiresAt: known.data.expiresAt ?? null, reused: true };
    const body = { amount: { currency: a.currency, value: toValue(a.amount) }, description: clean(a.description, 255) || "Order", redirectUrl, metadata: { orderId: clean(a.metadata?.orderId, 80) } };
    if (isPublicSite(ctx.api.siteUrl)) body.webhookUrl = `${String(ctx.api.siteUrl).replace(/\/+$/, "")}/m/${ctx.instance.key}/webhook`;   // "cannot use localhost": omitted, the shop polls instead
    if (LOCALES[a.locale]) body.locale = LOCALES[a.locale];
    const r = await M.createPayment(ctx, body);
    if (!r.ok) return { ok: false, reason: r.reason === "busy" ? "unavailable" : r.reason };
    const id = paymentId(r.json.id), href = r.json._links?.checkout?.href;
    let url = "";
    try { const u = new URL(String(href)); if (u.protocol === "https:") url = u.toString(); } catch { /* no usable page */ }
    if (!id || !url) return { ok: false, reason: "unavailable" };
    const expiresAt = typeof r.json.expiresAt === "string" ? r.json.expiresAt : null;
    await ctx.api.store.add("checkouts", { providerRef: id, checkoutUrl: url, expiresAt, at: Date.now(), mode: describe(ctx).mode }, { key: key });
    return { ok: true, providerRef: id, checkoutUrl: url, expiresAt };
  });
}

/** { providerRef } → { ok, state, amount (cents), currency, paidAt, refunded } | { ok: false, reason: "unknown" | "unavailable" | "invalid" } */
export async function getStatus(ctx, args) {
  const id = paymentId(args?.providerRef);
  if (!id) return { ok: false, reason: "invalid" };
  const r = await M.getPayment(ctx, id);
  if (!r.ok) return { ok: false, reason: r.reason === "not_found" ? "unknown" : "unavailable" };
  const p = r.json, state = M.STATE[p.status], amount = fromValue(p.amount?.value);
  if (!state || amount === null || !/^[A-Z]{3}$/.test(String(p.amount?.currency))) return { ok: false, reason: "unavailable" };   // never guess a state or an amount
  return { ok: true, state, amount, currency: p.amount.currency, paidAt: typeof p.paidAt === "string" ? p.paidAt : null, refunded: fromValue(p.amountRefunded?.value) ?? 0 };
}

/** { providerRef, amount, currency, reason?, idempotencyKey } → { ok, refundRef, state } | { ok: false, reason }. Only a person asks for it: the shop never refunds by itself. */
export async function refund(ctx, args) {
  const id = paymentId(args?.providerRef), key = clean(args?.idempotencyKey, 120);
  if (!id || !key) return { ok: false, reason: "invalid" };
  if (!Number.isInteger(args.amount) || args.amount < 1 || args.amount > MAX_AMOUNT || !/^[A-Z]{3}$/.test(String(args.currency))) return { ok: false, reason: "amount" };
  return withLock(`${ctx.instance.key}|rf|${key}`, async () => {
    const known = await ctx.api.store.getByKey("refunds", key);
    if (known) return { ok: true, refundRef: known.data.refundRef, state: known.data.state, reused: true };
    const body = { amount: { currency: args.currency, value: toValue(args.amount) } };
    const reason = clean(args.reason, 255);
    if (reason) body.description = reason;
    const r = await M.createRefund(ctx, id, body);
    if (!r.ok) return { ok: false, reason: r.reason === "busy" ? "unavailable" : r.reason };
    const refundRef = String(r.json.id ?? "").slice(0, 80), state = String(r.json.status ?? "pending").slice(0, 20);
    await ctx.api.store.add("refunds", { providerRef: id, refundRef, state, amount: args.amount, at: Date.now() }, { key });
    return { ok: true, refundRef, state };
  });
}
