// Mollie payments (EXPERIMENTAL prototype): the calls to Mollie, through the core's network client (timeouts, pauses on "too many requests", no retry of a POST).
// Shapes follow Mollie's own reference, read on 2026-11-15 (docs.mollie.com: create payment, get payment, create refund, webhooks, handling payment status).
// The key never appears in a log, an error or an answer: it is only put in the Authorization header.
import { keyMode } from "./lib.mjs";

const BASE = "https://api.mollie.com/v2";
export const keyOf = (ctx) => String(ctx.setting("mollieCode") ?? "").trim();

/** → { ok: true, status, json } | { ok: false, reason: "unavailable" | "rejected_key" | "not_found" | "rejected" | "duplicate" | "busy", status?, field? } */
async function call(ctx, method, path, body) {
  const key = keyOf(ctx);
  if (!keyMode(key)) return { ok: false, reason: "rejected_key" };
  const r = await ctx.api.net.request({ url: `${BASE}${path}`, method, headers: { authorization: `Bearer ${key}`, accept: "application/json" }, body, timeoutMs: 15_000, priority: "interactive" });
  if (!r.ok) return { ok: false, reason: r.error === "rate" || r.error === "busy" ? "busy" : "unavailable" };
  if (r.status >= 200 && r.status < 300 && r.json && typeof r.json === "object") return { ok: true, status: r.status, json: r.json };
  if (r.status === 401 || r.status === 403) return { ok: false, reason: "rejected_key", status: r.status };
  if (r.status === 404) return { ok: false, reason: "not_found", status: 404 };
  if (r.status === 409) return { ok: false, reason: "duplicate", status: 409 };       // "Two identical refund requests were submitted ... in short succession" (refund page)
  if (r.status === 429) return { ok: false, reason: "busy", status: 429 };
  if (r.status === 422 || r.status === 400) return { ok: false, reason: "rejected", status: r.status, field: typeof r.json?.field === "string" ? r.json.field.slice(0, 40) : undefined };
  return { ok: false, reason: "unavailable", status: r.status };
}
export const createPayment = (ctx, body) => call(ctx, "POST", "/payments", body);
export const getPayment = (ctx, id) => call(ctx, "GET", `/payments/${encodeURIComponent(id)}`);
export const createRefund = (ctx, id, body) => call(ctx, "POST", `/payments/${encodeURIComponent(id)}/refunds`, body);

/** Mollie's seven statuses → the six the shop knows (authorized is "being confirmed"). Unknown → null, never guessed. */
export const STATE = { open: "open", pending: "pending", authorized: "pending", paid: "paid", canceled: "canceled", expired: "expired", failed: "failed" };
