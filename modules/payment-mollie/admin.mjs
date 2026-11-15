// Mollie payments (EXPERIMENTAL prototype): the setup page. Three steps with their state, no key ever shown.
const v = new URL(import.meta.url).search;   // the module's version travels to the neighbour files, so an update never keeps old code in memory
const S = await import(`./service.mjs${v}`);

export async function adminPanel(ctx) {
  const d = S.describe(ctx);
  const tick = (ok) => (ok ? "✓" : "○");
  const blocks = [
    { type: "heading", text: ctx.t("title") },
    { type: "banner", tone: d.ready ? "success" : "warning", text: ctx.t(d.ready ? (d.mode === "live" ? "readyLive" : "readyTest") : `problem_${d.problems[0]}`) },
    { type: "markdown", text: [
      `${tick(Boolean(ctx.setting("mollieCode")))} ${ctx.t("step1")}`,
      `${tick(d.problems.every((p) => p !== "no_key" && p !== "bad_key"))} ${ctx.t("step2")}`,
      `${tick(d.publicSite)} ${ctx.t(d.publicSite ? "siteOk" : "sitePrivate")}`,
    ].join("  \n") },
    { type: "links", items: [{ label: ctx.t("openMollie"), href: "https://www.mollie.com" }] },
  ];
  const last = (await ctx.api.store.page("tests", { limit: 1 })).items[0];
  if (d.ready && d.mode === "test") {
    blocks.push({ type: "adminForm", action: "testPayment", submitLabel: ctx.t("testPayment"), fields: [{ name: "go", kind: "hidden", value: "1" }] });
    if (last?.data.checkoutUrl) blocks.push({ type: "links", items: [{ label: ctx.t("openTest"), href: last.data.checkoutUrl }] });
  }
  return blocks;
}

export const adminActions = {
  /** One test payment of 1.00, only with a test key (never real money). The result is a page to open. */
  async testPayment(ctx) {
    const d = S.describe(ctx);
    if (!d.ready || d.mode !== "test") return { error: ctx.t("testOnlyTestKey") };
    const base = String(ctx.api.siteUrl ?? "").replace(/\/+$/, "") || "https://example.org";
    const r = await S.createCheckout(ctx, { idempotencyKey: `test:${Date.now()}`, amount: 100, currency: "EUR", description: "Test payment", returnUrl: `${base}/` });
    if (!r.ok) return { error: ctx.t("testFailed") };
    await ctx.api.store.add("tests", { checkoutUrl: r.checkoutUrl, at: Date.now() });
    return { ok: ctx.t("testCreated"), redirect: "?" };
  },
};
