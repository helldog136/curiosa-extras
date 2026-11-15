// A fake Mollie, built from what Mollie's reference states (read on 2026-11-15, docs.mollie.com: create payment, get payment, create refund, webhooks, handling payment status):
//   base https://api.mollie.com/v2 · Bearer test_… / live_… keys · amount is { currency, value: "12.50" } (a string) · create answers 201 with id tr_…, status "open" and
//   _links.checkout.href · statuses open, pending, authorized, paid, canceled, expired, failed · webhookUrl may not be localhost (422) · the webhook is a POST with one form field `id`,
//   no status in the body, only "200 OK" is expected, 10 calls then it gives up · a refund cannot exceed amountRemaining, two identical refunds in short succession give 409.
// ASSUMED, not stated in what was read: the exact text of the 401 answer, and that a refund on an unpaid payment is a 422. Invented data only.
import crypto from "node:crypto";

export const TEST_KEY = "test_" + "Ab3dE5gH7jK9mN1pQ3sT5vX7zB9dF";
export function fakeMollie({ keys = [TEST_KEY] } = {}) {
  const payments = new Map(), refunds = [], calls = [];
  const lastRefund = new Map();
  const flags = { down: false, rateLimited: false, slow: 0 };
  const err = (status, title, detail, field) => ({ status, json: { status, title, detail, ...(field ? { field } : {}), _links: { documentation: { href: "https://docs.mollie.com/errors", type: "text/html" } } }, headers: { "content-type": "application/hal+json" } });
  const ok = (status, json) => ({ status, json, headers: { "content-type": "application/hal+json" } });
  const view = (p) => ({ resource: "payment", id: p.id, mode: p.mode, createdAt: p.createdAt, amount: p.amount, description: p.description, status: p.status, metadata: p.metadata, redirectUrl: p.redirectUrl,
    ...(p.webhookUrl ? { webhookUrl: p.webhookUrl } : {}), ...(p.status === "open" ? { expiresAt: p.expiresAt } : {}), ...(p.paidAt ? { paidAt: p.paidAt } : {}),
    ...(p.refunded > 0 || p.status === "paid" ? { amountRefunded: { currency: p.amount.currency, value: money(p.refunded) }, amountRemaining: { currency: p.amount.currency, value: money(cents(p.amount.value) - p.refunded) } } : {}),
    _links: { self: { href: `https://api.mollie.com/v2/payments/${p.id}` }, ...(p.status === "open" ? { checkout: { href: `https://www.mollie.com/checkout/select-method/${p.token}`, type: "text/html" } } : {}) } });
  const cents = (v) => Math.round(Number(v) * 100);
  const money = (c) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
  const body = (init) => { try { return JSON.parse(init?.body ?? "{}"); } catch { return {}; } };
  const header = (init, name) => { const h = init?.headers; return h instanceof Headers ? h.get(name) : h?.[name] ?? h?.[name.toLowerCase()] ?? null; };

  async function handle(url, init) {
    const method = (init?.method ?? "GET").toUpperCase(), path = new URL(url).pathname.replace(/^\/v2/, "");
    calls.push({ method, path, body: init?.body ? body(init) : null, auth: header(init, "authorization") });
    if (flags.down) throw new TypeError("fetch failed");
    if (flags.slow) await new Promise((r) => setTimeout(r, flags.slow));
    if (flags.rateLimited) return { status: 429, text: "", headers: { "retry-after": "60" } };
    const key = /^Bearer (.+)$/.exec(header(init, "authorization") ?? "")?.[1];
    if (!key || !keys.includes(key)) return err(401, "Unauthorized Request", "Missing authentication, or failed to authenticate");
    const mode = key.startsWith("test_") ? "test" : "live";
    if (method === "POST" && path === "/payments") {
      const b = body(init);
      if (!b.amount || typeof b.amount.value !== "string" || !/^\d+\.\d{2}$/.test(b.amount.value) || !/^[A-Z]{3}$/.test(b.amount.currency ?? "")) return err(422, "Unprocessable Entity", "The 'amount' field is invalid", "amount");
      if (!b.description) return err(422, "Unprocessable Entity", "The 'description' field is missing", "description");
      if (!b.redirectUrl) return err(422, "Unprocessable Entity", "The 'redirectUrl' field is missing", "redirectUrl");
      if (b.webhookUrl && /^https?:\/\/(localhost|127\.|\[)/i.test(b.webhookUrl)) return err(422, "Unprocessable Entity", "The webhook URL is invalid because it is unreachable from Mollie's point of view.", "webhookUrl");
      const id = "tr_" + crypto.randomBytes(6).toString("hex");
      const p = { id, token: crypto.randomBytes(8).toString("hex"), mode, createdAt: new Date().toISOString(), amount: b.amount, description: String(b.description).slice(0, 255), status: "open", metadata: b.metadata ?? null, redirectUrl: b.redirectUrl, webhookUrl: b.webhookUrl ?? null, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), refunded: 0 };
      payments.set(id, p);
      return ok(201, view(p));
    }
    let m = /^\/payments\/(tr_[A-Za-z0-9]+)$/.exec(path);
    if (method === "GET" && m) { const p = payments.get(m[1]); return p ? ok(200, view(p)) : err(404, "Not Found", "No payment exists with token " + m[1]); }
    m = /^\/payments\/(tr_[A-Za-z0-9]+)\/refunds$/.exec(path);
    if (method === "POST" && m) {
      const p = payments.get(m[1]);
      if (!p) return err(404, "Not Found", "No payment exists with token " + m[1]);
      const b = body(init);
      if (!b.amount?.value) return err(422, "Unprocessable Entity", "The 'amount' field is missing", "amount");
      const c = cents(b.amount.value);
      if (p.status !== "paid") return err(422, "Unprocessable Entity", "The payment is not paid");
      if (c > cents(p.amount.value) - p.refunded) return err(422, "Unprocessable Entity", "The amount is higher than the maximum refundable amount", "amount");
      const sig = `${p.id}|${c}`;
      if (Date.now() - (lastRefund.get(sig) ?? 0) < 5000) return err(409, "Conflict", "Two identical refund requests were submitted on the same payment in short succession");
      lastRefund.set(sig, Date.now());
      p.refunded += c;
      const r = { resource: "refund", id: "re_" + crypto.randomBytes(5).toString("hex"), mode, createdAt: new Date().toISOString(), amount: b.amount, description: b.description ?? "", status: "queued", paymentId: p.id, metadata: null };
      refunds.push(r);
      return ok(201, r);
    }
    return err(404, "Not Found", "No route");
  }
  const set = (id, status, extra = {}) => { const p = payments.get(id); if (!p) throw new Error("unknown payment"); Object.assign(p, { status }, extra); return p; };
  return {
    routes: { "https://api.mollie.com/v2/": handle }, payments, refunds, calls, flags, TEST_KEY,
    pay: (id) => set(id, "paid", { paidAt: new Date().toISOString() }),
    fail: (id) => set(id, "failed"), cancel: (id) => set(id, "canceled"), expire: (id) => set(id, "expired"), pending: (id) => set(id, "pending"), authorize: (id) => set(id, "authorized"),
    /** What Mollie sends: POST, application/x-www-form-urlencoded, one field `id`. Up to 10 calls while the answer is not 200 (the real intervals are not simulated). */
    async deliver(id, route, { retries = 10 } = {}) {
      let res;
      for (let i = 0; i < retries; i++) {
        res = await route(new Request("https://example.test/m/mollie1/webhook", { method: "POST", body: `id=${id}`, headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mollie HTTP client/1.0" } }));
        if (res.status === 200) break;
      }
      return res;
    },
    count: (method, path) => calls.filter((c) => c.method === method && (path instanceof RegExp ? path.test(c.path) : c.path === path)).length,
  };
}
