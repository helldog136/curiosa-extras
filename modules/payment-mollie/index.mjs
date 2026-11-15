// Mollie payments (EXPERIMENTAL prototype, not for release): offers the service "payment.provider". Knows no shop by name: when Mollie calls the notification address,
// the module only passes Mollie's own payment reference to whoever offers "payment.consumer" (optional), which then asks back for the real state.
const v = new URL(import.meta.url).search;
const S = await import(`./service.mjs${v}`);
const L = await import(`./lib.mjs${v}`);
const A = await import(`./admin.mjs${v}`);

const text = (body, status) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export default {
  routes: {
    /**
     * The address Mollie calls (POST, one form field `id`). Mollie documents: only "200 OK" is expected, a wrong status is retried (10 calls over about 26 hours),
     * an unknown id should still be answered 200, and the body carries no state (so a forged call can never mark anything paid). No signature exists.
     * We answer 503 only when the real state could not be read, so that Mollie tries again later.
     */
    async webhook(request, ctx) {
      if (request.method !== "POST") return text("Method not allowed", 405);
      const raw = await request.text();
      if (raw.length > 2000) return text("Too large", 413);
      const id = L.paymentId(new URLSearchParams(raw).get("id") ?? "");
      if (!id) return text("Bad request", 400);
      const r = await ctx.api.services.call("payment.consumer", "notify", { providerRef: id });
      if (r.ok) return text("ok", 200);
      if (r.reason === "unavailable" || r.reason === "no_method") return text("ok", 200);   // no shop installed: nothing to do, and no reason for Mollie to retry
      return text("Try again later", 503);
    },
  },
  services: {
    "payment.provider": {
      describe: (ctx) => S.describe(ctx),
      createCheckout: (ctx, args) => S.createCheckout(ctx, args),
      getStatus: (ctx, args) => S.getStatus(ctx, args),
      refund: (ctx, args) => S.refund(ctx, args),
    },
  },
  adminPanel: A.adminPanel,
  adminActions: A.adminActions,
};
