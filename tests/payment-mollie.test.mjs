// Online payment: the shop (any module offering "payment.provider"), the Mollie extension, and a FAKE Mollie that follows Mollie's reference (tests/helpers/fakeMollie.mjs).
// Proves OUR side of the contract: amounts, replays, forged calls, late payments, the fallback without notifications. It does NOT prove that Mollie accepts our calls.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { memStore } from "./helpers/contactsStore.mjs";
import { fakeMollie, TEST_KEY } from "./helpers/fakeMollie.mjs";
import { parseManifest } from "@/core/modules/manifest";

const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs")).href);
const { withFakeFetch } = kit;
const SHOP = new URL("../modules/shop", import.meta.url).pathname, MOL = new URL("../modules/payment-mollie", import.meta.url).pathname;
const readJson = (d, p) => JSON.parse(fs.readFileSync(`${d}/${p}`, "utf8"));
const shopDef = (await import("../modules/shop/index.mjs")).default;
const molDef = (await import("../modules/payment-mollie/index.mjs")).default;
const Svc = await import("../modules/payment-mollie/service.mjs");
const D = await import("../modules/shop/data.mjs");
const C = await import("../modules/shop/cart.mjs");
const O = await import("../modules/shop/orders.mjs");
const P = await import("../modules/shop/payments.mjs");
const S = await import("../modules/shop/stock.mjs");
const L = await import("../modules/shop/lib.mjs");
const ML = await import("../modules/payment-mollie/lib.mjs");

let n = 0;
/** A shop and a Mollie extension wired together as the core wires them (service calls in both directions), over one fake Mollie.
 *  fakeCtx reads `serviceInstances` once, so the provider's methods are installed on the same object the shop's context holds. */
function wired(opts) {
  const id = ++n;
  const methods = {};
  const serviceInstances = { "payment.provider": [{ instance: `mollie${id}`, name: "Mollie", methods }] };
  const shopEn = readJson(SHOP, "locales/en.json"), molEn = readJson(MOL, "locales/en.json");
  const { siteUrl = "https://example.test", key = TEST_KEY, shopSettings = {}, noProvider = false } = opts ?? {};
  const shop = fakeCtx({ key: `shop${id}`, basePath: "shop", moduleId: "shop", locale: "en", defaultLocale: "en", locales: ["en", "fr"], messages: shopEn, settings: shopSettings, siteUrl, serviceInstances: noProvider ? {} : serviceInstances });
  const mol = fakeCtx({ key: `mollie${id}`, basePath: null, moduleId: "payment-mollie", locale: "en", defaultLocale: "en", locales: ["en"], messages: molEn, settings: { mollieCode: key }, siteUrl,
    services: { "payment.consumer": { notify: (args) => shopDef.services["payment.consumer"].notify(shop, args) } } });
  for (const c of [shop, mol]) { c.api.store = memStore({ start: Date.now() - 3_600_000 }); c.can = () => true; }
  Object.assign(methods, { describe: () => Svc.describe(mol), createCheckout: (a) => Svc.createCheckout(mol, a), getStatus: (a) => Svc.getStatus(mol, a), refund: (a) => Svc.refund(mol, a) });
  return { shop, mol };
}
const good = { name: "Camille", email: "camille@example.org", address: "1 Example street, 1000 Brussels, Belgium" };
async function product(ctx, over = {}) {
  const r = D.normaliseProduct({ title: "Plush fox", price: "12.50", stockMode: "tracked", onHand: "3", published: "on", ...over });
  return D.getProduct(ctx, await D.saveProduct(ctx, null, r.value));
}
const line = (p) => ({ productId: p.id, variantId: p.variants[0].id, qty: 1 });
const hook = (mol) => (request) => molDef.routes.webhook(request, mol);
/** The customer fills the cart and presses the button: what the checkout route does. */
async function buy(shop, p, form = good) {
  const c = await C.addToCart(shop, null, line(p), Date.now());
  const provider = await P.pickProvider(shop);
  const r = await O.checkout(shop, c.token, form, Date.now(), { holdMs: P.holdFor(shop, provider) });
  assert.equal(r.ok, true, JSON.stringify(r));
  const pay = provider ? await P.startPayment(shop, r.order, r.token, provider) : null;
  return { token: r.token, orderId: r.orderId, pay, cartToken: c.token };
}
const reload = (shop, id) => D.getOrder(shop, id);
const refOf = async (shop, id) => (await reload(shop, id)).payment.providerRef;
/** Make the hold of an order end: its reservations and its time are in the past, then the scheduled pass expires it. */
async function endHold(shop, id) {
  const o = await reload(shop, id);
  for (const l of o.lines) { const row = await shop.api.store.get(l.rid); if (row) await shop.api.store.update(l.rid, { ...row.data, expiresAt: Date.now() - 1000 }); }
  o.holdUntil = Date.now() - 1000;
  await D.saveOrder(shop, o);
  return O.expireOrders(shop, Date.now());
}

// ── Manifests, texts, modularity ────────────────────────────────────────────────────────────────────────────────
test("manifests are valid, FR and EN match, and neither module knows the other by name", () => {
  for (const [dir, id] of [[MOL, "payment-mollie"], [SHOP, "shop"]]) {
    const m = readJson(dir, "module.json");
    assert.equal(m.id, id); assert.ok(parseManifest(m));
    const en = readJson(dir, "locales/en.json"), fr = readJson(dir, "locales/fr.json");
    assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  }
  const mol = readJson(MOL, "module.json"), shop = readJson(SHOP, "module.json");
  assert.deepEqual(mol.offers, [{ service: "payment.provider", version: 1, each: true }]);
  assert.deepEqual(mol.requires, [{ service: "payment.consumer", min: 1, optional: true }], "a provider never forces the shop to be installed");
  assert.deepEqual(shop.requires, [{ service: "payment.provider", min: 1, optional: true }], "the shop works without any provider");
  const code = (d) => fs.readdirSync(d).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${d}/${f}`, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")).join("\n");
  assert.doesNotMatch(code(SHOP), /mollie/i, "the shop knows no provider by name");
  assert.doesNotMatch(code(MOL), /modules\/shop|from "\.\.\/shop|import\(["'`]\.\.\//, "the provider imports nothing from the shop");
});

// ── The provider on its own ─────────────────────────────────────────────────────────────────────────────────────
test("describe: ready only with a key that looks right; real mode also needs a public https address; the key is never in the answer", () => {
  const live = "live_" + "Zy9xW7vU5tS3rQ1pO9nM7lK5jI3h";
  const mk = (settings, siteUrl) => fakeCtx({ key: "m", moduleId: "payment-mollie", settings, siteUrl, locale: "en", messages: readJson(MOL, "locales/en.json") });
  assert.deepEqual(Svc.describe(mk({}, "https://shop.example.org")).problems, ["no_key"]);
  assert.deepEqual(Svc.describe(mk({ mollieCode: "hello" }, "https://shop.example.org")).problems, ["bad_key"]);
  const t = Svc.describe(mk({ mollieCode: TEST_KEY }, "http://localhost:3000"));
  assert.equal(t.ready, true); assert.equal(t.mode, "test"); assert.equal(t.publicSite, false);
  const lp = Svc.describe(mk({ mollieCode: live }, "http://localhost:3000"));
  assert.equal(lp.ready, false); assert.deepEqual(lp.problems, ["site_private"]);
  assert.equal(Svc.describe(mk({ mollieCode: live }, "https://shop.example.org")).ready, true);
  for (const bad of ["http://192.168.1.5", "https://shop.local", "https://localhost", "https://shop.example.org:8443", "https://[::1]"]) assert.equal(ML.isPublicSite(bad), false, bad);
  assert.doesNotMatch(JSON.stringify([t, lp]), /Ab3dE5|Zy9xW7/);
});
test("createCheckout: sends the amount as a string, the webhook address only when public, and the same request twice makes one payment", async () => {
  const fm = fakeMollie();
  await withFakeFetch(fm.routes, async () => {
    const { mol } = wired();
    mol.api.store = memStore();
    const args = { idempotencyKey: "o1:1", amount: 1250, currency: "EUR", description: "N-261116-1234", returnUrl: "https://example.test/shop/track/abc", metadata: { orderId: "o1" }, locale: "fr" };
    const [a, b] = await Promise.all([Svc.createCheckout(mol, args), Svc.createCheckout(mol, args)]);
    assert.equal(a.ok, true); assert.equal(a.providerRef, b.providerRef);
    assert.equal(fm.count("POST", "/payments"), 1, "one payment, not two");
    const sent = fm.calls.find((c) => c.method === "POST").body;
    assert.deepEqual(sent.amount, { currency: "EUR", value: "12.50" });
    assert.equal(sent.webhookUrl, `https://example.test/m/${mol.instance.key}/webhook`);
    assert.equal(sent.locale, "fr_FR"); assert.equal(sent.metadata.orderId, "o1");
    assert.match(a.checkoutUrl, /^https:\/\/www\.mollie\.com\//);
    const priv = wired({ siteUrl: "http://localhost:3000" });
    const c = await Svc.createCheckout(priv.mol, { ...args, idempotencyKey: "o2:1" });
    assert.equal(c.ok, true);
    assert.equal(fm.calls.filter((x) => x.method === "POST").at(-1).body.webhookUrl, undefined, "localhost is refused by Mollie, so none is sent");
  });
});
test("createCheckout refuses nonsense before any call, and answers plainly when Mollie refuses or is down", async () => {
  const fm = fakeMollie();
  await withFakeFetch(fm.routes, async () => {
    const { mol } = wired();
    const ok = { idempotencyKey: "k", amount: 100, currency: "EUR", description: "x", returnUrl: "https://example.test/" };
    for (const [over, reason] of [[{ amount: 0 }, "amount"], [{ amount: 1.5 }, "amount"], [{ amount: 10_000_001 }, "amount"], [{ currency: "euro" }, "currency"], [{ idempotencyKey: "" }, "invalid"], [{ returnUrl: "javascript:alert(1)" }, "invalid"]]) {
      assert.equal((await Svc.createCheckout(mol, { ...ok, ...over })).reason, reason, JSON.stringify(over));
    }
    assert.equal(fm.calls.length, 0, "nothing reached Mollie");
    fm.flags.down = true;
    assert.deepEqual(await Svc.createCheckout(mol, ok), { ok: false, reason: "unavailable" });
    fm.flags.down = false; fm.flags.rateLimited = true;
    assert.equal((await Svc.createCheckout(mol, { ...ok, idempotencyKey: "k2" })).ok, false);
    fm.flags.rateLimited = false;
    const wrong = wired({ key: "test_" + "Qw1eR2tY3uI4oP5aS6dF7gH8jK9l" });
    assert.equal((await Svc.createCheckout(wrong.mol, { ...ok, idempotencyKey: "k3" })).reason, "rejected_key");
    assert.equal((await Svc.createCheckout(mol, { ...ok, idempotencyKey: "k4", amount: 100, currency: "EU1" })).reason, "currency");
  });
});
test("getStatus maps Mollie's statuses, never guesses, and tells unknown from unavailable", async () => {
  const fm = fakeMollie();
  await withFakeFetch(fm.routes, async () => {
    const { mol } = wired();
    const mk = async (i) => (await Svc.createCheckout(mol, { idempotencyKey: `k${i}`, amount: 1250, currency: "EUR", description: "x", returnUrl: "https://example.test/" })).providerRef;
    const expectState = { open: "open", pending: "pending", authorize: "pending", pay: "paid", cancel: "canceled", expire: "expired", fail: "failed" };
    let i = 0;
    for (const [act, state] of Object.entries(expectState)) {
      const ref = await mk(++i);
      if (act !== "open") fm[act](ref);
      const s = await Svc.getStatus(mol, { providerRef: ref });
      assert.equal(s.state, state, act); assert.equal(s.amount, 1250); assert.equal(s.currency, "EUR");
      if (state === "paid") assert.ok(s.paidAt);
    }
    assert.equal((await Svc.getStatus(mol, { providerRef: "tr_doesnotexist" })).reason, "unknown");
    assert.equal((await Svc.getStatus(mol, { providerRef: "../x" })).reason, "invalid");
    fm.flags.down = true;
    assert.equal((await Svc.getStatus(mol, { providerRef: "tr_doesnotexist" })).reason, "unavailable");
    fm.flags.down = false;
    const ref = await mk(++i);
    fm.payments.get(ref).status = "something_new";
    assert.equal((await Svc.getStatus(mol, { providerRef: ref })).ok, false, "a status we do not know is not turned into a guess");
  });
});
test("refund: only on request, once per request, never more than paid, duplicates handled", async () => {
  const fm = fakeMollie();
  await withFakeFetch(fm.routes, async () => {
    const { mol } = wired();
    const ref = (await Svc.createCheckout(mol, { idempotencyKey: "r1", amount: 1250, currency: "EUR", description: "x", returnUrl: "https://example.test/" })).providerRef;
    const args = { providerRef: ref, amount: 500, currency: "EUR", reason: "Customer asked", idempotencyKey: "rf1" };
    assert.equal((await Svc.refund(mol, args)).ok, false, "not paid yet: Mollie refuses");
    fm.pay(ref);
    const a = await Svc.refund(mol, args);
    assert.equal(a.ok, true); assert.match(a.refundRef, /^re_/);
    assert.equal((await Svc.refund(mol, args)).reused, true); assert.equal(fm.count("POST", `/payments/${ref}/refunds`), 2, "the repeat did not call Mollie again");
    assert.equal((await Svc.refund(mol, { ...args, idempotencyKey: "rf2", amount: 800 })).reason, "rejected", "more than what is left");
    assert.equal((await Svc.refund(mol, { ...args, idempotencyKey: "rf3", amount: 500 })).reason, "duplicate", "Mollie's 409 for identical requests in a row");
    assert.equal((await Svc.refund(mol, { ...args, idempotencyKey: "", })).reason, "invalid");
    assert.equal((await Svc.getStatus(mol, { providerRef: ref })).refunded, 500);
  });
});

// ── The notification address ────────────────────────────────────────────────────────────────────────────────────
test("notification address: POST only, answers 200 for unknown ids and when no shop exists, 400 for rubbish, and 503 only when the real state could not be read", async () => {
  const fm = fakeMollie();
  await withFakeFetch(fm.routes, async () => {
    const { shop, mol } = wired();
    const route = hook(mol);
    assert.equal((await route(new Request("https://x.test/m/m/webhook"))).status, 405);
    assert.equal((await route(new Request("https://x.test/m/m/webhook", { method: "POST", body: "id=nope" }))).status, 400);
    assert.equal((await route(new Request("https://x.test/m/m/webhook", { method: "POST", body: "x".repeat(3000) }))).status, 413);
    assert.equal((await fm.deliver("tr_neverheardof", route)).status, 200, "Mollie: answer 200 even when the id is not known");
    const lone = wired({ noProvider: true });
    delete lone.mol.api.services.call;                       // a site where the shop is not installed
    lone.mol.api.services.call = async () => ({ ok: false, reason: "unavailable" });
    assert.equal((await fm.deliver("tr_whatever", hook(lone.mol))).status, 200, "nothing to do, no reason for Mollie to retry");
    const p = await product(shop);
    const b = await buy(shop, p);
    const ref = await refOf(shop, b.orderId);
    fm.pay(ref); fm.flags.down = true;
    assert.equal((await fm.deliver(ref, route, { retries: 1 })).status, 503, "state unreadable: ask Mollie to try again");
    fm.flags.down = false;
    await new Promise((r) => setTimeout(r, L.LIMITS.notifyMinGapMs + 50));
    assert.equal((await fm.deliver(ref, route)).status, 200);
    assert.equal((await reload(shop, b.orderId)).state, "paid");
  });
});

// ── The whole path ──────────────────────────────────────────────────────────────────────────────────────────────
test("online order: the pieces are held 30 minutes, the notification marks it paid once, a replay changes nothing", async () => {
  const fm = fakeMollie();
  await withFakeFetch(fm.routes, async () => {
    const { shop, mol } = wired();
    const p = await product(shop, { onHand: "1" });
    const b = await buy(shop, p);
    assert.equal(b.pay.ok, true); assert.match(b.pay.url, /^https:\/\/www\.mollie\.com\/checkout\//);
    const o = await reload(shop, b.orderId);
    assert.equal(o.state, "awaiting_payment"); assert.equal(o.payment.state, "open"); assert.equal(o.payment.mode, "test");
    assert.ok(Math.abs(o.holdUntil - o.history.length - Date.now() - 30 * 60_000) < 5000, "30 minutes for an online payment");
    assert.equal((await C.addToCart(shop, null, line(p), Date.now())).reason, "sold_out", "held while the customer pays");
    assert.equal((await fm.deliver(o.payment.providerRef, hook(mol))).status, 200);
    assert.equal((await reload(shop, b.orderId)).state, "awaiting_payment", "a notification alone proves nothing: Mollie still says open");
    fm.pay(o.payment.providerRef);
    await new Promise((r) => setTimeout(r, L.LIMITS.notifyMinGapMs + 50));
    await fm.deliver(o.payment.providerRef, hook(mol));
    const paid = await reload(shop, b.orderId);
    assert.equal(paid.state, "paid"); assert.equal(paid.payment.state, "paid");
    await new Promise((r) => setTimeout(r, L.LIMITS.notifyMinGapMs + 50));
    await fm.deliver(o.payment.providerRef, hook(mol));
    assert.equal((await reload(shop, b.orderId)).history.filter((h) => h.s === "paid").length, 1, "replayed notification: still one payment");
    assert.equal((await S.availability(shop, p, p.variants[0], Date.now())).available, 0, "sold, not merely held");
    assert.equal(fm.count("GET", `/payments/${o.payment.providerRef}`) >= 2, true, "the state was asked back each time");
  });
});
test("a forged notification for someone else's payment cannot mark anything paid, and floods cost nothing", async () => {
  const fm = fakeMollie();
  await withFakeFetch(fm.routes, async () => {
    const { shop, mol } = wired();
    const b = await buy(shop, await product(shop));
    const ref = await refOf(shop, b.orderId);
    const before = fm.count("GET", `/payments/${ref}`);
    for (let i = 0; i < 30; i++) await fm.deliver(ref, hook(mol), { retries: 1 });
    assert.equal((await reload(shop, b.orderId)).state, "awaiting_payment");
    assert.ok(fm.count("GET", `/payments/${ref}`) - before <= 2, "thirty calls in a row made at most a couple of reads");
  });
});
test("without public notifications (private site) the scheduled pass finds the payment, and does not ask again too soon", async () => {
  const fm = fakeMollie();
  await withFakeFetch(fm.routes, async () => {
    const { shop } = wired({ siteUrl: "http://localhost:3000" });
    const b = await buy(shop, await product(shop));
    assert.equal(fm.calls.find((c) => c.method === "POST").body.webhookUrl, undefined);
    const ref = await refOf(shop, b.orderId);
    assert.equal(await P.pollOpenPayments(shop, Date.now()), 0, "just checked: no need to ask again");
    fm.pay(ref);
    const later = Date.now() + 3 * 60_000;
    assert.equal(await P.pollOpenPayments(shop, later), 1);
    assert.equal((await reload(shop, b.orderId)).state, "paid");
    assert.equal(await P.pollOpenPayments(shop, later + 3 * 60_000), 0, "a paid order is no longer polled");
  });
});
test("coming back to the tracking page asks the provider, at most every 20 seconds", async () => {
  const fm = fakeMollie();
  await withFakeFetch(fm.routes, async () => {
    const { shop } = wired({ siteUrl: "http://localhost:3000" });
    const b = await buy(shop, await product(shop));
    const ref = await refOf(shop, b.orderId);
    const view = async () => (await shopDef.page(shop, { segments: ["track", b.token] })).blocks[0].html;
    assert.match(await view(), /Pay now/);
    fm.pay(ref);
    const reads = fm.count("GET", `/payments/${ref}`);
    await view();
    assert.equal(fm.count("GET", `/payments/${ref}`), reads, "asked less than 20 seconds ago: the page does not ask again");
    const o = await reload(shop, b.orderId); o.payment.checkedAt = Date.now() - 60_000; await D.saveOrder(shop, o);
    const html = await view();
    assert.match(html, /Paid/); assert.doesNotMatch(html, /Pay now/);
    assert.doesNotMatch(html, /payment_started|state_payment/, "internal events never show");
  });
});
test("a failed payment leaves the order waiting; the customer can try again, up to 5 pages, then it stops", async () => {
  const fm = fakeMollie();
  await withFakeFetch(fm.routes, async () => {
    const { shop, mol } = wired();
    const p = await product(shop, { onHand: "2" });
    const b = await buy(shop, p);
    const first = await refOf(shop, b.orderId);
    fm.fail(first);
    await fm.deliver(first, hook(mol));
    let o = await reload(shop, b.orderId);
    assert.equal(o.state, "awaiting_payment"); assert.equal(o.payment.state, "failed");
    const html = (await shopDef.page(shop, { segments: ["track", b.token] })).blocks[0].html;
    assert.match(html, /try again/i); assert.doesNotMatch(html, /Pay now/);
    const post = (t) => new Request("https://x.test/m/s/pay", { method: "POST", body: new URLSearchParams({ t }), headers: { "x-forwarded-for": "203.0.113.9" } });
    const res = await shopDef.routes.pay(post(b.token), shop);
    assert.equal(res.status, 303); assert.match(res.headers.get("location"), /^\/shop\/track\//, "a redirect to our own page, never to another site");
    o = await reload(shop, b.orderId);
    assert.notEqual(o.payment.providerRef, first); assert.equal(o.payment.state, "open"); assert.equal(o.payment.attempts.length, 2);
    fm.pay(o.payment.providerRef);
    await new Promise((r) => setTimeout(r, L.LIMITS.notifyMinGapMs + 50));
    await fm.deliver(o.payment.providerRef, hook(mol));
    assert.equal((await reload(shop, b.orderId)).state, "paid");
    assert.equal((await shopDef.routes.pay(post("a".repeat(32)), shop)).status, 404);
    // the limit of attempts
    const b2 = await buy(shop, await product(shop, { onHand: "5" }));
    for (let i = 0; i < 8; i++) { const cur = await reload(shop, b2.orderId); if (cur.payment?.state === "open") fm.fail(cur.payment.providerRef); await P.refreshOrder(shop, await reload(shop, b2.orderId)); await shopDef.routes.pay(post(b2.token), shop); }
    assert.ok((await reload(shop, b2.orderId)).payment.attempts.length <= L.LIMITS.paymentAttempts);
  });
});
test("a payment that arrives after the hold ended: accepted if the piece is free, otherwise the order waits for a person and nothing is refunded", async () => {
  const fm = fakeMollie();
  await withFakeFetch(fm.routes, async () => {
    const { shop, mol } = wired();
    const p = await product(shop, { onHand: "1" });
    const b = await buy(shop, p);
    const ref = await refOf(shop, b.orderId);
    assert.equal(await endHold(shop, b.orderId), 1);
    assert.equal((await reload(shop, b.orderId)).state, "expired");
    fm.pay(ref);                                                     // Bancontact pages stay open for an hour: the customer paid after our 30 minutes
    await fm.deliver(ref, hook(mol));
    assert.equal((await reload(shop, b.orderId)).state, "paid", "free again: the late payment is accepted");

    const q = await product(shop, { title: "Plush hare", onHand: "1" });
    const late = await buy(shop, q);
    const lateRef = await refOf(shop, late.orderId);
    await endHold(shop, late.orderId);
    assert.equal((await C.addToCart(shop, null, line(q), Date.now())).ok, true, "someone else took the last one");
    fm.pay(lateRef);
    await fm.deliver(lateRef, hook(mol));
    const o = await reload(shop, late.orderId);
    assert.equal(o.state, "paid_to_resolve");
    assert.equal(fm.refunds.length, 0, "a person decides, nothing is refunded by itself");
    assert.equal(fm.count("POST", `/payments/${lateRef}/refunds`), 0);
  });
});
test("a wrong amount is never accepted, and a payment for a cancelled order is flagged for a person", async () => {
  const fm = fakeMollie();
  await withFakeFetch(fm.routes, async () => {
    const { shop, mol } = wired();
    const b = await buy(shop, await product(shop));
    const ref = await refOf(shop, b.orderId);
    fm.payments.get(ref).amount.value = "1.00";
    fm.pay(ref);
    await fm.deliver(ref, hook(mol));
    let o = await reload(shop, b.orderId);
    assert.equal(o.state, "awaiting_payment"); assert.equal(o.flag, "payment_mismatch");
    assert.match(JSON.stringify(await shopDef.adminPanel(shop, { query: { order: b.orderId } })), /amount paid is not/);

    const c = await buy(shop, await product(shop, { title: "Plush hare" }));
    const cref = await refOf(shop, c.orderId);
    await O.setState(shop, c.orderId, "cancelled");
    fm.pay(cref);
    await new Promise((r) => setTimeout(r, L.LIMITS.notifyMinGapMs + 50));
    await fm.deliver(cref, hook(mol));
    o = await reload(shop, c.orderId);
    assert.equal(o.state, "cancelled"); assert.equal(o.flag, "paid_after_cancel"); assert.equal(fm.refunds.length, 0);
    assert.equal(await shopDef.adminBadge(shop) >= 2, true);
  });
});
test("if the provider cannot start a payment the order is kept and the customer can try again; with no provider the order is manual", async () => {
  const fm = fakeMollie();
  await withFakeFetch(fm.routes, async () => {
    const { shop } = wired();
    fm.flags.down = true;
    const b = await buy(shop, await product(shop));
    assert.equal(b.pay.ok, false);
    const o = await reload(shop, b.orderId);
    assert.equal(o.state, "awaiting_payment"); assert.ok(o.history.some((h) => h.s === "payment_start_failed"));
    const html = (await shopDef.page(shop, { segments: ["track", b.token] })).blocks[0].html;
    assert.match(html, /could not be opened/); assert.match(html, /action="\/m\/shop\d+\/pay"/);
    fm.flags.down = false;
    await shopDef.routes.pay(new Request("https://x.test/m/s/pay", { method: "POST", body: new URLSearchParams({ t: b.token }), headers: { "x-forwarded-for": "203.0.113.20" } }), shop);
    assert.equal((await reload(shop, b.orderId)).payment?.state, "open", "the second try worked");
    const none = wired({ noProvider: true });
    const m = await buy(none.shop, await product(none.shop));
    assert.equal(m.pay, null);
    const mo = await reload(none.shop, m.orderId);
    assert.equal(mo.payment, null); assert.ok(Math.abs(mo.holdUntil - Date.now() - 24 * 3_600_000) < 5000, "manual payment: 24 hours");
    const a = JSON.stringify(await shopDef.adminPanel(none.shop, { query: {} }));
    assert.match(a, /suggestInstall/); assert.match(a, /payment\.provider/);
    const unready = wired({ key: "" });                     // installed, but its access code is still empty
    const u = JSON.stringify(await shopDef.adminPanel(unready.shop, { query: {} }));
    assert.match(u, /installed but not ready/); assert.match(u, /\/admin\/instances\/id-mollie\d+/); assert.doesNotMatch(u, /suggestInstall/);
    assert.match(JSON.stringify(await shopDef.adminPanel(shop, { query: {} })), /Test mode/);
  });
});
test("the access code is never stored by the shop, shown, logged or returned", async () => {
  const fm = fakeMollie();
  await withFakeFetch(fm.routes, async () => {
    const { shop, mol } = wired();
    const b = await buy(shop, await product(shop));
    const ref = await refOf(shop, b.orderId);
    fm.pay(ref); await fm.deliver(ref, hook(mol));
    const dump = async (ctx) => JSON.stringify(await Promise.all(["products", "reservations", "carts", "orders", "payrefs", "checkouts", "refunds", "tests"].map((c) => ctx.api.store.page(c, { limit: 100 }))));
    for (const text of [await dump(shop), await dump(mol), JSON.stringify(await molDef.adminPanel(mol)), JSON.stringify(await shopDef.adminPanel(shop, { query: {} })), (await shopDef.page(shop, { segments: ["track", b.token] })).blocks[0].html, JSON.stringify(mol.calls?.netLog ?? []), JSON.stringify(shop.calls?.netLog ?? [])]) {
      assert.ok(!text.includes(TEST_KEY) && !text.includes("Ab3dE5gH7"), "the access code leaked");
    }
    assert.ok(fm.calls.every((c) => c.auth === `Bearer ${TEST_KEY}`), "it only travels in the Authorization header to Mollie");
  });
});
test("the setup page tells where the owner stands, and the test payment only exists with a test code", async () => {
  const fm = fakeMollie();
  await withFakeFetch(fm.routes, async () => {
    const { mol } = wired();
    const panel = JSON.stringify(await molDef.adminPanel(mol));
    assert.match(panel, /Test mode/); assert.match(panel, /testPayment/);
    const r = await molDef.adminActions.testPayment(mol);
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(JSON.stringify(await molDef.adminPanel(mol)), /Open the test payment page/);
    const none = fakeCtx({ key: "m0", moduleId: "payment-mollie", settings: {}, siteUrl: "https://example.test", locale: "en", messages: readJson(MOL, "locales/en.json") });
    none.api.store = memStore();
    assert.match(JSON.stringify(await molDef.adminPanel(none)), /Add your Mollie access code/);
    assert.ok((await molDef.adminActions.testPayment(none)).error);
    const live = fakeCtx({ key: "m1", moduleId: "payment-mollie", settings: { mollieCode: "live_" + "Zy9xW7vU5tS3rQ1pO9nM7lK5jI3h" }, siteUrl: "https://shop.example.org", locale: "en", messages: readJson(MOL, "locales/en.json") });
    live.api.store = memStore();
    assert.ok((await molDef.adminActions.testPayment(live)).error, "never a test payment with a real code");
    assert.equal(fm.calls.filter((c) => c.auth?.includes("live_")).length, 0);
  });
});
