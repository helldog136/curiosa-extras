// Shop (experimental prototype): money, stock by reservations (simultaneous buyers), cart timer, checkout, manual payment, late payment,
// public routes, pages, administration. All data is invented (example.org); the in-memory store is the faithful one used by other modules' tests.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { memStore } from "./helpers/contactsStore.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/shop", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const en = readJson("locales/en.json"), fr = readJson("locales/fr.json");
const def = (await import("../modules/shop/index.mjs")).default;
const { cleanup } = await import("../modules/shop/index.mjs");
const L = await import("../modules/shop/lib.mjs");
const Ship = await import("../modules/shop/shipping.mjs");
const D = await import("../modules/shop/data.mjs");
const S = await import("../modules/shop/stock.mjs");
const C = await import("../modules/shop/cart.mjs");
const O = await import("../modules/shop/orders.mjs");
const P = await import("../modules/shop/public.mjs");

let n = 0;
function mk({ rights = ["manage", "email.view"], settings = {}, locale = "en", mailConfigured = true } = {}) {
  const ctx = fakeCtx({ mailConfigured, key: `sh${++n}`, basePath: "shop", moduleId: "shop", locale, defaultLocale: "en", locales: ["en", "fr"], messages: locale === "en" ? en : fr, settings, site: { name: "Atelier", tagline: "", logo: null } });
  ctx.api.store = memStore();
  ctx.instance.id = `id${n}`;
  const set = new Set(rights);
  ctx.can = (r) => set.has(r);
  return ctx;
}
const MIN = 60_000, T0 = Date.now();   // "now": the shop compares holds with the real clock, so a fixed date would turn these tests into a calendar bomb
async function product(ctx, over = {}) {
  const r = D.normaliseProduct({ title: "Plush fox", price: "12.50", stockMode: "tracked", onHand: "3", published: "on", ...over });
  assert.ok(r.value, JSON.stringify(r.errors));
  const id = await D.saveProduct(ctx, null, r.value);
  return D.getProduct(ctx, id);
}
const lineOf = (p, i = 0) => ({ productId: p.id, variantId: p.variants[i].id, qty: 1 });
const good = { name: "Camille", email: "camille@example.org", address: "1 Example street, 1000 Brussels, Belgium" };

// ── Manifest and texts ──────────────────────────────────────────────────────────────────────────────────────────
test("manifest is valid, texts exist in English and French with the same keys", () => {
  const m = readJson("module.json");
  assert.equal(m.id, "shop");
  assert.ok(parseManifest(m));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  const vars = (s) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join();
  for (const k of Object.keys(en)) assert.equal(vars(en[k]), vars(fr[k]), k);
  assert.match(m.description.en, /xperimental/);
});
test("the page script waits until the page is awake before touching it (the framework would otherwise see a different page than the one it expects)", () => {
  const src = fs.readFileSync(`${DIR}/scripts/shop.js`, "utf8");
  assert.match(src, /readyState === "complete"/); assert.match(src, /addEventListener\("load"/); assert.match(src, /whenAwake\(start\)/);
  assert.ok(src.indexOf("whenAwake(start)") < src.indexOf("function start()"), "nothing runs before the page is complete");
  assert.doesNotMatch(src.slice(0, src.indexOf("function start()")), /getElementById|document\.body|appendChild/, "no DOM access outside start()");
});
test("the page script never writes user data as HTML", () => {
  const src = fs.readFileSync(`${DIR}/scripts/shop.js`, "utf8");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(src));
});

// ── Money ───────────────────────────────────────────────────────────────────────────────────────────────────────
test("money is parsed to integer cents and bad input is refused", () => {
  assert.equal(L.parseMoney("12.50"), 1250);
  assert.equal(L.parseMoney("12,5"), 1250);
  assert.equal(L.parseMoney("0.07"), 7);
  assert.equal(L.parseMoney("19.99"), 1999);
  for (const bad of ["", "abc", "-1", "1.234", "1e3", "99999999", null]) assert.equal(L.parseMoney(bad), null, String(bad));
});
test("included tax is an integer, half up, and zero without a rate", () => {
  assert.equal(L.includedTax(1210, 2100), 210);   // 21 %
  assert.equal(L.includedTax(1000, 0), 0);
  assert.equal(L.includedTax(999, 600), 57);      // 6 %: 999*600/10600 = 56.54
  assert.ok(Number.isInteger(L.includedTax(12345, 2100)));
});

// ── Products ────────────────────────────────────────────────────────────────────────────────────────────────────
test("a product is validated and extra options are parsed", () => {
  assert.deepEqual(Object.keys(D.normaliseProduct({ title: "", price: "x", onHand: "z" }).errors).sort(), ["onHand", "price", "title"]);
  const r = D.normaliseProduct({ title: "Plush", price: "10", stockMode: "tracked", onHand: "2", variants: "Large | 24.00 | 3\nSmall", firstLabel: "Mini" });
  assert.equal(r.value.variants.length, 3);
  assert.deepEqual(r.value.variants.map((v) => [v.label, v.price, v.onHand]), [["Mini", 1000, 2], ["Large", 2400, 3], ["Small", 1000, 2]]);
  assert.ok(D.normaliseProduct({ title: "Plush", price: "10", onHand: "2", variants: "Large | nope | 3" }).errors.variants);
  assert.equal(D.normaliseProduct({ title: "One", price: "10", stockMode: "single" }).value.variants[0].onHand, 1);
  assert.ok(D.normaliseProduct({ title: "T", price: "10", onHand: "1", taxRate: "150" }).errors.taxRate);
});

// ── Stock: simultaneous buyers ─────────────────────────────────────────────────────────────────────────────────
test("twenty simultaneous buyers of the last piece: exactly one wins", async () => {
  const ctx = mk();
  const p = await product(ctx, { stockMode: "single" });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => C.addToCart(ctx, null, lineOf(p), T0)));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.filter((r) => r.reason === "sold_out").length, 19);
  const a = await S.availability(ctx, p, p.variants[0], T0);
  assert.equal(a.available, 0);
  assert.equal((await ctx.api.store.count("reservations")), 1, "the losers left nothing behind");
});
test("simultaneous buyers never take more than the stock, whatever the quantities", async () => {
  for (let round = 0; round < 25; round++) {
    const ctx = mk();
    const p = await product(ctx, { onHand: "5" });
    const wants = Array.from({ length: 12 }, (_, i) => 1 + ((i * 7 + round) % 3));
    const rs = await Promise.all(wants.map((qty) => C.addToCart(ctx, null, { ...lineOf(p), qty }, T0)));
    const held = (await S.readAll(ctx, p.id, p.variants[0].id)).reduce((s, r) => s + r.data.qty, 0);
    const won = rs.reduce((s, r, i) => s + (r.ok ? wants[i] : 0), 0);
    assert.ok(held <= 5 && won === held, `round ${round}: held ${held}, won ${won}`);
  }
});
test("a refused big reservation does not block a smaller one behind it", async () => {
  const ctx = mk();
  const p = await product(ctx, { onHand: "1" });
  const [a, b] = await Promise.all([C.addToCart(ctx, null, { ...lineOf(p), qty: 2 }, T0), C.addToCart(ctx, null, { ...lineOf(p), qty: 1 }, T0)]);
  assert.equal(a.ok, false);      // 2 pieces do not fit in 1, whatever the order
  assert.equal(b.ok, true);
});
test("unlimited stock never sells out, a seller restock frees pieces", async () => {
  const ctx = mk();
  const u = await product(ctx, { stockMode: "unlimited" });
  const rs = await Promise.all(Array.from({ length: 10 }, () => C.addToCart(ctx, null, lineOf(u), T0)));
  assert.ok(rs.every((r) => r.ok));
  const p = await product(ctx, { onHand: "1" });
  assert.equal((await C.addToCart(ctx, null, lineOf(p), T0)).ok, true);
  assert.equal((await C.addToCart(ctx, null, lineOf(p), T0)).reason, "sold_out");
  assert.equal(await D.setOnHand(ctx, p.id, p.variants[0].id, 2), true);
  assert.equal((await C.addToCart(ctx, null, lineOf(p), T0)).ok, true);
  assert.equal(await D.setOnHand(ctx, p.id, p.variants[0].id, -1), false);
});

test("the per-variant lock runs steps one after the other, survives errors, and is shared across module reloads", async () => {
  const order = [];
  const step = (name, ms, fail = false) => L.withLock("k", async () => { order.push(`${name}:start`); await new Promise((r) => setTimeout(r, ms)); order.push(`${name}:end`); if (fail) throw new Error("boom"); });
  const results = await Promise.allSettled([step("a", 20), step("b", 5, true), step("c", 1)]);
  assert.deepEqual(order, ["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"]);
  const other = await import("../modules/shop/lib.mjs?v=2");                // a module update loads the file again under a new version
  const seen = [];
  await Promise.all([L.withLock("z", async () => { seen.push("old:start"); await new Promise((r) => setTimeout(r, 15)); seen.push("old:end"); }), other.withLock("z", async () => { seen.push("new"); })]);
  assert.deepEqual(seen, ["old:start", "old:end", "new"]);
  await Promise.all([L.withLock("x", async () => {}), L.withLock("y", async () => {})]);
});

// ── Cart timer ──────────────────────────────────────────────────────────────────────────────────────────────────
test("a cart releases its pieces after 5 minutes, and every change restarts the 5 minutes", async () => {
  const ctx = mk();
  const p = await product(ctx, { onHand: "1" });
  const first = await C.addToCart(ctx, null, lineOf(p), T0);
  assert.equal(first.ok, true);
  assert.equal((await C.viewCart(ctx, first.token, T0 + 4 * MIN)).secondsLeft, 60);
  assert.equal((await C.addToCart(ctx, null, lineOf(p), T0 + 4 * MIN)).reason, "sold_out", "still held at 4 minutes");
  const other = await product(ctx, { title: "Plush hare", onHand: "5" });
  assert.equal((await C.addToCart(ctx, first.token, lineOf(other), T0 + 4 * MIN)).ok, true, "a change at 4 minutes restarts the timer");
  assert.equal((await C.viewCart(ctx, first.token, T0 + 8 * MIN)).lines.length, 2, "alive at 8 minutes");
  assert.equal((await C.viewCart(ctx, first.token, T0 + 9 * MIN + 1)).expired, true, "dead after 5 minutes without a change");
  assert.equal((await C.addToCart(ctx, null, lineOf(p), T0 + 9 * MIN + 1)).ok, true, "the piece is for sale again");
});
test("an expired cart cannot take back a piece someone else has now", async () => {
  const ctx = mk();
  const p = await product(ctx, { onHand: "1" });
  const a = await C.addToCart(ctx, null, lineOf(p), T0);
  const b = await C.addToCart(ctx, null, lineOf(p), T0 + 6 * MIN);
  assert.equal(b.ok, true);
  const again = await C.addToCart(ctx, a.token, lineOf(p), T0 + 6 * MIN + 1);
  assert.equal(again.reason, "sold_out");
  assert.equal((await C.viewCart(ctx, a.token, T0 + 6 * MIN + 1)).lines.length, 0);
});
test("limits: one of a kind is 1, at most 5 of a counted item, unknown or draft products refused", async () => {
  const ctx = mk();
  const one = await product(ctx, { stockMode: "single" });
  assert.equal((await C.addToCart(ctx, null, { ...lineOf(one), qty: 2 }, T0)).reason, "quantity");
  const many = await product(ctx, { onHand: "50" });
  const r = await C.addToCart(ctx, null, { ...lineOf(many), qty: 5 }, T0);
  assert.equal(r.ok, true);
  assert.equal((await C.addToCart(ctx, r.token, lineOf(many), T0)).reason, "quantity");
  const draft = await product(ctx, { published: "" });
  assert.equal((await C.addToCart(ctx, null, lineOf(draft), T0)).reason, "unknown");
  assert.equal((await C.addToCart(ctx, null, { productId: "nope", variantId: "v1", qty: 1 }, T0)).reason, "unknown");
  assert.equal((await C.addToCart(ctx, null, { ...lineOf(many), qty: 1.5 }, T0)).reason, "quantity");
});
test("removing a line frees the piece at once; the global cap of held pieces is enforced", async () => {
  const ctx = mk();
  const p = await product(ctx, { onHand: "1" });
  const a = await C.addToCart(ctx, null, lineOf(p), T0);
  const rid = (await C.viewCart(ctx, a.token, T0)).lines[0].rid;
  assert.equal((await C.removeLine(ctx, a.token, rid, T0 + 1000)).ok, true);
  assert.equal((await C.addToCart(ctx, null, lineOf(p), T0 + 1001)).ok, true);
  const u = await product(ctx, { stockMode: "unlimited" });
  for (let i = 0; i < L.LIMITS.heldGlobal; i++) await ctx.api.store.add("reservations", { cartId: "x", productId: "z", variantId: "v1", qty: 1, state: "held", expiresAt: T0 + 99 * MIN }, { key: "z:v1" });
  assert.equal((await C.addToCart(ctx, null, lineOf(u), T0)).reason, "busy");
});

// ── Checkout and manual payment ────────────────────────────────────────────────────────────────────────────────
async function ordered(ctx, p, now = T0, form = good) {
  const c = await C.addToCart(ctx, null, lineOf(p), now);
  return { c, r: await O.checkout(ctx, c.token, form, now + 1000) };
}
test("checkout validates the form, snapshots prices and tax, holds the pieces 24 h and keeps only token hashes", async () => {
  const ctx = mk({ settings: { currency: "EUR" } });
  await Ship.saveConfig(ctx, Ship.normaliseConfig("flat", { flat: "0" }).value);      // delivery asks for an address (the default, pickup, does not)
  const p = await product(ctx, { taxRate: "21", price: "12.10" });
  const c = await C.addToCart(ctx, null, lineOf(p), T0);
  const bad = await O.checkout(ctx, c.token, { name: "", email: "x", address: "a" }, T0 + 1000);
  assert.deepEqual(Object.keys(bad.errors).sort(), ["address", "email", "name"]);
  assert.equal((await C.viewCart(ctx, c.token, T0 + 2000)).lines.length, 1, "the cart is kept after a refused form");
  const r = await O.checkout(ctx, c.token, good, T0 + 1000);
  assert.equal(r.ok, true);
  const o = await D.getOrder(ctx, r.orderId);
  assert.equal(o.total, 1210); assert.equal(o.includedTax, 210); assert.equal(o.state, "awaiting_payment");
  assert.equal(o.holdUntil, T0 + 1000 + 24 * 3_600_000);
  await ctx.api.store.update(p.id, { ...(await ctx.api.store.get(p.id)).data, variants: [{ ...p.variants[0], price: 9999 }] });
  assert.equal((await D.getOrder(ctx, r.orderId)).lines[0].unit, 1210, "later price changes do not touch the order");
  for (const col of ["orders", "carts"]) for (const row of (await ctx.api.store.page(col, { limit: 100 })).items) assert.ok(!JSON.stringify(row).includes(r.token) && !JSON.stringify(row).includes(c.token), "no raw token stored");
  assert.equal((await C.addToCart(ctx, null, lineOf(p), T0 + 2 * MIN)).ok, true, "2 pieces left of 3, one is held by the order");
  assert.equal((await O.checkout(ctx, c.token, good, T0 + 3000)).reason, "expired", "an ordered cart cannot order twice");
});
test("the pieces of an order stay held for 24 h, then the order expires and they are free", async () => {
  const ctx = mk();
  const p = await product(ctx, { onHand: "1" });
  const { r } = await ordered(ctx, p);
  assert.equal((await C.addToCart(ctx, null, lineOf(p), T0 + 23 * 3_600_000)).reason, "sold_out");
  assert.equal(await O.expireOrders(ctx, T0 + 25 * 3_600_000), 1);
  assert.equal((await D.getOrder(ctx, r.orderId)).state, "expired");
  assert.equal(await O.expireOrders(ctx, T0 + 26 * 3_600_000), 0, "replaying does nothing more");
  assert.equal((await C.addToCart(ctx, null, lineOf(p), T0 + 26 * 3_600_000)).ok, true);
});
test("marking paid is idempotent, checks the amount, and turns the reservation into a sale", async () => {
  const ctx = mk();
  const p = await product(ctx, { onHand: "1" });
  const { r } = await ordered(ctx, p);
  assert.equal((await O.markPaid(ctx, r.orderId, { amount: 1, currency: "EUR" }, T0 + 5000)).reason, "amount_mismatch");
  assert.equal((await O.markPaid(ctx, r.orderId, { eventId: "evt1", amount: 1250, currency: "EUR" }, T0 + 5000)).state, "paid");
  assert.equal((await O.markPaid(ctx, r.orderId, { eventId: "evt1" }, T0 + 6000)).already, true);
  assert.equal((await D.getOrder(ctx, r.orderId)).history.filter((h) => h.s === "paid").length, 1);
  assert.equal((await C.addToCart(ctx, null, lineOf(p), T0 + 400 * 3_600_000)).reason, "sold_out", "a sold piece never comes back by itself");
});
test("late payment: the piece is taken again if free, otherwise the order waits for a person and nothing stays half reserved", async () => {
  const ctx = mk();
  const p = await product(ctx, { onHand: "1" });
  const { r } = await ordered(ctx, p);
  await O.expireOrders(ctx, T0 + 25 * 3_600_000);
  assert.equal((await O.markPaid(ctx, r.orderId, {}, T0 + 26 * 3_600_000)).state, "paid", "free again, so the late payment is accepted");

  const two = await product(ctx, { title: "Plush hare", onHand: "1" }), one = await product(ctx, { title: "Plush owl", onHand: "1" });
  const c = await C.addToCart(ctx, null, lineOf(two), T0);
  await C.addToCart(ctx, c.token, lineOf(one), T0);
  const ord = await O.checkout(ctx, c.token, good, T0 + 1000);
  await O.expireOrders(ctx, T0 + 25 * 3_600_000);
  assert.equal((await C.addToCart(ctx, null, lineOf(one), T0 + 25 * 3_600_000 + 1)).ok, true, "someone else took the owl");
  const lateAt = T0 + 25 * 3_600_000 + 2 * MIN;   // the other buyer's cart is still alive (5 minutes)
  const late = await O.markPaid(ctx, ord.orderId, {}, lateAt);
  assert.equal(late.state, "paid_to_resolve");
  assert.equal((await S.availability(ctx, two, two.variants[0], lateAt)).available, 1, "the hare was not kept by a failed attempt");
  assert.equal((await O.setState(ctx, ord.orderId, "cancelled", {}, T0 + 27 * 3_600_000)).ok, true, "a person resolves it");
});
test("the seller moves a paid order forward; moves that make no sense are refused", async () => {
  const ctx = mk();
  const p = await product(ctx, { onHand: "2" });
  const { r } = await ordered(ctx, p);
  assert.equal((await O.setState(ctx, r.orderId, "shipped", {}, T0 + 5000)).reason, "transition", "not before payment");
  await O.markPaid(ctx, r.orderId, {}, T0 + 5000);
  assert.equal((await O.setState(ctx, r.orderId, "shipped", { tracking: "TRK-1" }, T0 + 6000)).ok, true);
  assert.equal((await D.getOrder(ctx, r.orderId)).tracking, "TRK-1");
  assert.equal((await O.setState(ctx, r.orderId, "delivered", {}, T0 + 7000)).ok, true);
  assert.equal((await O.setState(ctx, r.orderId, "cancelled", {}, T0 + 8000)).reason, "transition");
  assert.equal((await O.setState(ctx, "nope", "cancelled")).reason, "unknown");
});

// ── Public routes ───────────────────────────────────────────────────────────────────────────────────────────────
const post = (route, fields, { cookie, ip = "203.0.113.5" } = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return new Request(`https://example.test/m/x/${route}`, { method: "POST", body: f, headers: { "x-forwarded-for": ip, accept: "application/json", ...(cookie ? { cookie } : {}) } });
};
const cookieFrom = (res) => /shop_cart=([a-z2-7]{32})/.exec(res.headers.get("set-cookie") ?? "")?.[1];
test("routes: add sets a safe cookie, cart reads it, checkout returns the private tracking page", async () => {
  const ctx = mk();
  const p = await product(ctx);
  const res = await def.routes.add(post("add", { productId: p.id, variantId: "v1", qty: "1" }), ctx);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("set-cookie"), /HttpOnly/); assert.match(res.headers.get("set-cookie"), /SameSite=Lax/);
  const token = cookieFrom(res);
  assert.ok(token);
  const view = await (await def.routes.cart(new Request("https://example.test/m/x/cart", { headers: { cookie: `shop_cart=${token}` } }), ctx)).json();
  assert.equal(view.lines.length, 1); assert.equal(view.total, 1250); assert.equal(view.currency, "EUR");
  const co = await def.routes.checkout(post("checkout", good, { cookie: `shop_cart=${token}` }), ctx);
  const body = await co.json();
  assert.equal(body.ok, true); assert.match(body.url, /^\/shop\/track\/[a-z2-7]{32}$/);
  assert.equal((await def.routes.checkout(post("checkout", good), ctx)).status, 409, "no cookie, no order");
  const err = await def.routes.checkout(post("checkout", { name: "", email: "", address: "" }, { cookie: `shop_cart=${token}` }), ctx);
  assert.ok([400, 409].includes(err.status));
});
test("routes: methods, honeypot, bad ids, rate limits, same answer for strangers", async () => {
  const ctx = mk();
  const p = await product(ctx, { onHand: "50" });
  assert.equal((await def.routes.add(new Request("https://example.test/m/x/add"), ctx)).status, 405);
  assert.equal((await def.routes.cart(post("cart", {}), ctx)).status, 405);
  const trap = await def.routes.add(post("add", { productId: p.id, variantId: "v1", website: "http://spam.example" }), ctx);
  assert.equal((await trap.json()).ok, true); assert.equal(await ctx.api.store.count("reservations"), 0, "a robot reserves nothing");
  assert.equal((await def.routes.add(post("add", { productId: "../x", variantId: "v1" }), ctx)).status, 400);
  assert.equal((await def.routes.remove(post("remove", { rid: "r1" }), ctx)).status, 400, "no cart, nothing removed");
  let last;
  for (let i = 0; i < L.LIMITS.cartsPerVisitorPerHour + 2; i++) last = await def.routes.add(post("add", { productId: p.id, variantId: "v1", qty: "1" }, { ip: "198.51.100.9" }), ctx);
  assert.equal(last.status, 429, "too many new carts from one visitor");
});

// ── Pages ───────────────────────────────────────────────────────────────────────────────────────────────────────
test("shop page: escapes everything, shows stock notes, loads its script; unknown paths are 404", async () => {
  const ctx = mk({ settings: { announcement: "Open <b>Saturday</b>", lowStock: 2 } });
  await product(ctx, { title: "<img src=x onerror=alert(1)>", onHand: "1", variants: "Big | 20 | 0" });
  const page = await def.page(ctx, { segments: [] });
  const html = page.blocks[0].html;
  assert.ok(!html.includes("<img src=x") && !html.includes("<b>Saturday"));
  assert.match(html, /Only 1 left/); assert.match(html, /Sold out/); assert.match(html, /disabled/);
  assert.deepEqual(page.scripts, ["shop.js"]);
  assert.equal((await def.page(ctx, { segments: ["nope"] })).notFound, true);
  const empty = mk();
  assert.match((await def.page(empty, { segments: [] })).blocks[0].html, /Nothing is for sale yet/);
});
test("tracking page: private, not indexed, strangers get the same 404", async () => {
  const ctx = mk();
  const p = await product(ctx, { taxRate: "21" });
  const { r } = await ordered(ctx, p);
  const page = await def.page(ctx, { segments: ["track", r.token] });
  assert.equal(page.robots, "noindex"); assert.match(page.blocks[0].html, /Waiting for payment/); assert.match(page.blocks[0].html, /including/);
  assert.doesNotMatch(page.blocks[0].html, /camille@example\.org/, "the page never shows the e-mail address");
  assert.equal((await def.page(ctx, { segments: ["track", "a".repeat(32)] })).notFound, true);
  assert.equal((await def.page(ctx, { segments: ["track", "short"] })).notFound, true);
});
test("French texts are used on a French page", async () => {
  const ctx = mk({ locale: "fr" });
  assert.match((await def.page(ctx, { segments: [] })).blocks[0].html, /Rien n(&#39;|')est en vente/);
});

// ── Administration ──────────────────────────────────────────────────────────────────────────────────────────────
test("admin: empty states say what to do, lists are searchable, stock and paid-to-resolve alerts show", async () => {
  const ctx = mk();
  const empty = await def.adminPanel(ctx, { query: {} });
  const tables = empty.filter((b) => b.type === "table");
  assert.equal(tables.length, 2); assert.ok(tables.every((t) => t.searchable === true && t.empty));
  const p = await product(ctx, { onHand: "1" });
  await product(ctx, { title: "Hand-made owl", stockMode: "single" });
  const { r } = await ordered(ctx, p);
  const blocks = await def.adminPanel(ctx, { query: {} });
  const low = blocks.find((b) => b.type === "banner" && /Low stock/.test(b.text));
  assert.ok(low); assert.doesNotMatch(low.text, /owl/, "a one-of-a-kind piece is always \"1 left\": no alert for it");
  assert.equal(await def.adminBadge(ctx), 0);
  await O.markPaid(ctx, r.orderId, {}, T0 + 5000);
  assert.equal(await def.adminBadge(ctx), 1);
});
test("admin: product and order sheets, the right to see contact details, refusal without the right to manage", async () => {
  const ctx = mk();
  const p = await product(ctx);
  const { r } = await ordered(ctx, p);
  const sheet = await def.adminPanel(ctx, { query: { edit: p.id } });
  const form = sheet.find((b) => b.type === "adminForm");
  const visible = form.fields.filter((f) => f.kind !== "hidden" && !f.folded);
  assert.ok(visible.length <= 5, `visible fields: ${visible.length}`);
  const order = JSON.stringify(await def.adminPanel(ctx, { query: { order: r.orderId } }));
  assert.match(order, /camille@example\.org/);
  const noEmail = mk({ rights: ["manage"] });
  const p2 = await product(noEmail); const o2 = await ordered(noEmail, p2);
  assert.doesNotMatch(JSON.stringify(await def.adminPanel(noEmail, { query: { order: o2.r.orderId } })), /camille@example\.org/);
  const viewer = mk({ rights: [] });
  assert.ok((await def.adminActions.saveProduct(viewer, { title: "X", price: "1", onHand: "1" })).error);
  assert.ok((await def.adminActions.markPaid(viewer, { id: r.orderId })).error);
  assert.ok(!(await def.adminPanel(viewer, { query: { edit: "new" } })).some((b) => b.type === "adminForm"));
});
test("admin actions: errors are shown under the field with an example; a saved product is listed", async () => {
  const ctx = mk();
  const bad = await def.adminActions.saveProduct(ctx, { title: "", price: "zero", stockMode: "tracked", onHand: "x" });
  assert.match(bad.errors.title, /for example/); assert.match(bad.errors.price, /12\.50/); assert.match(bad.errors.onHand, /for example/);
  const ok = await def.adminActions.saveProduct(ctx, { title: "Plush fox", price: "12.50", stockMode: "tracked", onHand: "3", published: "on" });
  assert.ok(ok.ok); assert.equal(ok.redirect, undefined, "no redirect: the core closes the window and marks the saved row");
  assert.equal((await D.listProducts(ctx, { published: true })).length, 1);
  const id = (await D.listProducts(ctx))[0].id;
  assert.ok((await def.adminActions.saveProduct(ctx, { id, title: "Plush fox", price: "13", stockMode: "tracked", onHand: "9", published: "on" })).ok);
  assert.equal((await D.getProduct(ctx, id)).variants[0].price, 1300);
  const o = await ordered(ctx, await D.getProduct(ctx, id));
  assert.ok((await def.adminActions.markPaid(ctx, { id: o.r.orderId })).ok);
  assert.ok((await def.adminActions.setState(ctx, { id: o.r.orderId, state: "shipped", tracking: "TRK-2" })).ok);
  assert.ok((await def.adminActions.setState(ctx, { id: o.r.orderId, state: "paid" })).errors.state);
});

// ── Administration: windows, stock in one field, on-sale switch, deletion ───────────────────────────────────────────
const tableOf = (blocks, title) => blocks.filter((b) => b.type === "table").find((b) => b.columns[0] === title);
test("the window has no on-sale field (the list has the switch): a new product is on sale, an existing one keeps its state", async () => {
  const ctx = mk();
  const form = (await def.adminPanel(ctx, { query: { edit: "new" } })).find((b) => b.type === "adminForm");
  assert.ok(!form.fields.some((f) => f.name === "published"));
  assert.equal(D.normaliseProduct({ title: "T", price: "1", onHand: "1" }).value.status, "published", "new: on sale");
  const draft = await product(ctx, { published: "" });
  const r = await def.adminActions.saveProduct(ctx, { id: draft.id, title: "Plush fox", price: "13", stockMode: "tracked", onHand: "3" });
  assert.ok(r.ok);
  assert.equal((await D.getProduct(ctx, draft.id)).status, "draft", "saving the window does not put a draft on sale");
  const live = await product(ctx);
  await def.adminActions.saveProduct(ctx, { id: live.id, title: "Plush fox", price: "14", stockMode: "tracked", onHand: "3" });
  assert.equal((await D.getProduct(ctx, live.id)).status, "published");
});
test("a product opens in a window above the list: precise button, one separate destructive action that says what is lost, the list stays", async () => {
  const ctx = mk();
  const p = await product(ctx);
  const sheet = await def.adminPanel(ctx, { query: { edit: p.id } });
  const form = sheet.find((b) => b.type === "adminForm");
  assert.equal(form.presentation, "dialog"); assert.equal(form.cancelHref, "?"); assert.equal(form.submitLabel, "Save the product");
  assert.equal(form.secondaryAction.label, "Delete the product"); assert.equal(form.secondaryAction.action, "deleteProduct");
  assert.match(form.secondaryAction.confirm, /Orders already placed keep their lines/);
  assert.ok(form.fields.filter((f) => f.kind !== "hidden" && !f.folded).length <= 5);
  assert.ok(tableOf(sheet, "Product") && tableOf(sheet, "Order"), "the lists are still there beneath the window");
  const fresh = (await def.adminPanel(ctx, { query: { edit: "new" } })).find((b) => b.type === "adminForm");
  assert.equal(fresh.secondaryAction, undefined, "nothing to delete in a new product");
  assert.equal(fresh.title, "New product");
  const list = tableOf(await def.adminPanel(ctx, { query: {} }), "Product");
  assert.deepEqual(list.rowActions.map((a) => [a.label, a.presentation]), [["Edit", "dialog"], ["Change stock", "dialog"]]);
  const add = (await def.adminPanel(ctx, { query: {} })).filter((b) => b.type === "links").flatMap((b) => b.items).find((i) => i.label === "Add a product");
  assert.equal(add.presentation, "dialog");
});
test("'pieces in stock' only appears where it means something, and saving without it keeps the number in hand", async () => {
  const ctx = mk();
  const one = await product(ctx, { title: "Hand-made owl", stockMode: "single" });
  const unl = await product(ctx, { title: "Sticker", stockMode: "unlimited" });
  const counted = await product(ctx, { onHand: "7" });
  const has = async (p) => (await def.adminPanel(ctx, { query: { edit: p.id } })).find((b) => b.type === "adminForm").fields.some((f) => f.name === "onHand");
  assert.deepEqual([await has(one), await has(unl), await has(counted)], [false, false, true]);
  const r = await def.adminActions.saveProduct(ctx, { id: one.id, title: "Hand-made owl", price: "40", stockMode: "tracked", published: "on" });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal((await D.getProduct(ctx, one.id)).variants[0].onHand, 1, "no number typed: the one that was there is kept, no hidden error");
});
test("stock in one field: a window with one number, the right option, checked bounds, only for people who manage", async () => {
  const ctx = mk();
  const p = await product(ctx, { onHand: "3", variants: "Large | 24.00 | 2" });
  const form = (await def.adminPanel(ctx, { query: { stock: p.id } })).find((b) => b.type === "adminForm");
  assert.equal(form.presentation, "dialog"); assert.equal(form.submitLabel, "Save the stock"); assert.match(form.title, /Stock of Plush fox/);
  assert.equal(form.fields.filter((f) => f.kind !== "hidden").length, 2, "an option to pick and a number");
  const single = await product(ctx, { title: "Mug", onHand: "4" });
  assert.equal((await def.adminPanel(ctx, { query: { stock: single.id } })).find((b) => b.type === "adminForm").fields.filter((f) => f.kind !== "hidden").length, 1, "one field, one click");
  assert.ok((await def.adminActions.saveStock(ctx, { id: p.id, variant: p.variants[1].id, onHand: "9" })).ok);
  assert.deepEqual((await D.getProduct(ctx, p.id)).variants.map((v) => v.onHand), [3, 9], "only the chosen option changed");
  for (const bad of ["-1", "2.5", "abc", "", "100001"]) assert.match((await def.adminActions.saveStock(ctx, { id: p.id, variant: "v1", onHand: bad })).errors.onHand, /whole number/, bad);
  const viewer = mk({ rights: [] }); viewer.api.store = ctx.api.store;
  assert.ok((await def.adminActions.saveStock(viewer, { id: p.id, variant: "v1", onHand: "50" })).error);
  assert.equal((await D.getProduct(ctx, p.id)).variants[0].onHand, 3);
  const unl = await product(ctx, { title: "Sticker", stockMode: "unlimited" });
  assert.match(JSON.stringify(await def.adminPanel(ctx, { query: { stock: unl.id } })), /no stock limit/);
  const held = await C.addToCart(ctx, null, { productId: single.id, variantId: "v1", qty: 3 }, Date.now());
  assert.equal(held.ok, true);
  assert.ok((await def.adminActions.saveStock(ctx, { id: single.id, variant: "v1", onHand: "10" })).ok);
  assert.equal((await S.availability(ctx, await D.getProduct(ctx, single.id), { id: "v1", stockMode: "tracked", onHand: 10 }, Date.now())).available, 7, "what a visitor holds is still held");
});
test("on sale or not, from the list: the switch says the state wanted, never flips, and the shop follows at once", async () => {
  const ctx = mk();
  const p = await product(ctx);
  const cell = () => tableOf(ctx._last, "Product").rows[0][3];
  ctx._last = await def.adminPanel(ctx, { query: {} });
  assert.equal(cell().switch.action, "setPublished"); assert.equal(cell().switch.on, true); assert.match(cell().switch.label, /Plush fox on sale/);
  assert.ok((await def.adminActions.setPublished(ctx, { id: p.id, enabled: "0" })).ok);
  assert.ok((await def.adminActions.setPublished(ctx, { id: p.id, enabled: "0" })).ok, "a double click does not undo itself");
  assert.equal((await D.getProduct(ctx, p.id)).status, "draft");
  assert.doesNotMatch((await def.page(ctx, { segments: [] })).blocks[0].html, /Plush fox/);
  assert.equal((await C.addToCart(ctx, null, { productId: p.id, variantId: "v1", qty: 1 }, Date.now())).reason, "unknown");
  assert.ok((await def.adminActions.setPublished(ctx, { id: p.id, enabled: "1" })).ok);
  assert.match((await def.page(ctx, { segments: [] })).blocks[0].html, /Plush fox/);
  const viewer = mk({ rights: [] }); viewer.api.store = ctx.api.store;
  assert.equal(tableOf(await def.adminPanel(viewer, { query: {} }), "Product").rows[0][3].switch, undefined, "no switch for someone who cannot change it");
  assert.ok((await def.adminActions.setPublished(viewer, { id: p.id, enabled: "0" })).error);
});
test("deleting a product: refused while it is in a cart or an order waiting, otherwise gone, and placed orders keep their lines", async () => {
  const ctx = mk();
  const p = await product(ctx), q = await product(ctx, { title: "Plush hare" });
  const o = await ordered(ctx, p);
  const busy = await def.adminActions.deleteProduct(ctx, { id: p.id });
  assert.match(busy.error, /waiting for payment/); assert.ok(await D.getProduct(ctx, p.id), "still there");
  await O.markPaid(ctx, o.r.orderId, {}, Date.now());
  assert.ok((await def.adminActions.deleteProduct(ctx, { id: p.id })).ok, "paid: nothing is held any more, it can go");
  assert.equal(await D.getProduct(ctx, p.id), null);
  assert.match((await def.page(ctx, { segments: ["track", o.r.token] })).blocks[0].html, /Plush fox/, "the placed order still shows its lines");
  const inCart = await C.addToCart(ctx, null, { productId: q.id, variantId: "v1", qty: 1 }, Date.now());
  assert.equal(inCart.ok, true);
  assert.match((await def.adminActions.deleteProduct(ctx, { id: q.id })).error, /cart or an order/);
  assert.ok((await def.adminActions.deleteProduct(ctx, { id: "nope" })).ok, "already gone is not an error");
  const viewer = mk({ rights: [] }); viewer.api.store = ctx.api.store;
  assert.ok((await def.adminActions.deleteProduct(viewer, { id: q.id })).error);
});

// ── No e-mail, no shop ──────────────────────────────────────────────────────────────────────────────────────────
test("without a way to send e-mail the shop is closed: no page to buy from, no cart, no order; existing orders can still be followed", async () => {
  const on = mk();
  const p = await product(on, { onHand: "3" });
  const { r } = await ordered(on, p);
  const off = mk({ mailConfigured: false });
  off.api.store = on.api.store;                                   // the same shop, the site's e-mail having stopped working
  const page = await def.page(off, { segments: [] });
  assert.match(page.blocks[0].html, /closed for now/); assert.doesNotMatch(page.blocks[0].html, /sh-add|Add to cart|Plush fox/); assert.equal(page.scripts, undefined);
  const addReq = () => post("add", { productId: p.id, variantId: "v1", qty: "1" });
  const res = await def.routes.add(addReq(), off);
  assert.equal(res.status, 503); assert.equal((await res.json()).reason, "closed");
  assert.equal((await def.routes.checkout(post("checkout", good, { cookie: "shop_cart=" + "a".repeat(32) }), off)).status, 503);
  assert.equal((await S.availability(off, p, p.variants[0], Date.now())).available, 2, "nothing was reserved by the refused request");
  assert.match(JSON.stringify(await def.adminPanel(off, { query: {} })), /the shop is closed/i);
  assert.match((await def.page(off, { segments: ["track", r.token] })).blocks[0].html, /Waiting for payment/, "a customer who already ordered can still follow the order");
  assert.equal((await def.routes.add(addReq(), on)).status, 200, "it opens again by itself once e-mail works");
  assert.doesNotMatch(JSON.stringify(await def.adminPanel(on, { query: {} })), /the shop is closed/i);
  assert.ok(readJson("module.json").permissions.includes("mail"));
});

// ── Housekeeping ────────────────────────────────────────────────────────────────────────────────────────────────
test("cleanup removes dead carts and old reservations, and can be replayed", async () => {
  const ctx = mk();
  const p = await product(ctx, { onHand: "3" });
  await C.addToCart(ctx, null, lineOf(p), T0);
  const later = T0 + 3 * 3_600_000;
  const first = await cleanup(ctx, later);
  assert.equal(first.carts, 1); assert.equal(first.reservations, 0, "already removed with the cart");
  assert.deepEqual(await cleanup(ctx, later), { carts: 0, reservations: 0, expiredOrders: 0, mailLog: 0 });
  assert.equal(await ctx.api.store.count("reservations"), 0);
});
