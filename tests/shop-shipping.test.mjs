// Shipping: three modes chosen by the seller (one price, three fixed zones, pickup only), the price copied into each order, country choice in the cart,
// what the customer, the payment and the e-mails see. Invented data only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { memStore } from "./helpers/contactsStore.mjs";

const DIR = new URL("../modules/shop", import.meta.url).pathname;
const en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8")), fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
const def = (await import("../modules/shop/index.mjs")).default;
const D = await import("../modules/shop/data.mjs");
const C = await import("../modules/shop/cart.mjs");
const O = await import("../modules/shop/orders.mjs");
const P = await import("../modules/shop/payments.mjs");
const M = await import("../modules/shop/mail.mjs");
const Ship = await import("../modules/shop/shipping.mjs");

let n = 0;
function mk({ locale = "en", rights, serviceInstances } = {}) {
  const ctx = fakeCtx({ key: `sp${++n}`, basePath: "shop", moduleId: "shop", locale, defaultLocale: "en", locales: ["en", "fr"], messages: locale === "fr" ? fr : en, settings: {}, site: { name: "Atelier", tagline: "", logo: null }, serviceInstances });
  ctx.api.store = memStore({ start: Date.now() - 3_600_000 });
  ctx.instance.id = `inst${n}`;
  const allowed = rights ? new Set(rights) : null;
  ctx.can = (r) => (allowed ? allowed.has(r) : true);
  return ctx;
}
const setup = (ctx, mode, values) => { const r = Ship.normaliseConfig(mode, values); assert.ok(r.value, JSON.stringify(r.errors)); return Ship.saveConfig(ctx, r.value); };
const ZONES = { homeCountry: "BE", price_home: "5.00", price_europe: "9.00", price_world: "15.00" };
async function product(ctx, over = {}) {
  const r = D.normaliseProduct({ title: "Plush fox", price: "12.50", stockMode: "tracked", onHand: "50", published: "on", ...over });
  return D.getProduct(ctx, await D.saveProduct(ctx, null, r.value));
}
const form = (over = {}) => ({ name: "Camille", email: `camille${++n}@example.org`, address: "1 Example street, 1000 Brussels, Belgium", ...over });
async function buy(ctx, p, f = form()) {
  const c = await C.addToCart(ctx, null, { productId: p.id, variantId: "v1", qty: 1 }, Date.now());
  return { c, r: await O.checkout(ctx, c.token, f, Date.now()) , f };
}
const post = (route, fields, cookie) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.set(k, v); return new Request(`https://example.test/m/x/${route}`, { method: "POST", body: fd, headers: { "x-forwarded-for": `203.0.113.${(n % 200) + 1}`, accept: "application/json", ...(cookie ? { cookie } : {}) } }); };

test("what the seller types is checked: one price (free allowed), zones with a country and at least one price, pickup with its note", () => {
  assert.equal(Ship.normaliseConfig("flat", { flat: "0" }).value.flat, 0, "free shipping is a price of zero, said on purpose");
  assert.equal(Ship.normaliseConfig("flat", { flat: "4,5" }).value.flat, 450);
  assert.ok(Ship.normaliseConfig("flat", { flat: "" }).errors.flat); assert.ok(Ship.normaliseConfig("flat", { flat: "abc" }).errors.flat);
  const z = Ship.normaliseConfig("zones", { ...ZONES, price_world: "" });
  assert.deepEqual(z.value.prices, { home: 500, europe: 900, world: null }, "empty means not delivered there");
  assert.ok(Ship.normaliseConfig("zones", { ...ZONES, homeCountry: "" }).errors.homeCountry);
  assert.ok(Ship.normaliseConfig("zones", { ...ZONES, homeCountry: "ZZ" }).errors.homeCountry);
  assert.ok(Ship.normaliseConfig("zones", { ...ZONES, price_europe: "x" }).errors.price_europe);
  assert.ok(Ship.normaliseConfig("zones", { homeCountry: "BE", price_home: "", price_europe: "", price_world: "" }).errors.price_home, "a shop that delivers nowhere is not a zones setup");
  assert.ok(Ship.normaliseConfig("flat", { flat: "1", taxRate: "150" }).errors.taxRate);
  assert.equal(Ship.normaliseConfig("none", { pickupInfo: "Saturdays 10 to 12" }).value.pickupInfo, "Saturdays 10 to 12");
  assert.ok(Ship.normaliseConfig("teleport", {}).errors.mode);
});
test("the price of a delivery by mode, by zone, and for countries nobody delivers to", () => {
  const flat = Ship.normaliseConfig("flat", { flat: "4.50", taxRate: "21" }).value;
  assert.deepEqual([Ship.quote(flat, "").price, Ship.quote(flat, "US").price, Ship.quote(flat, "").tax], [450, 450, 78], "one price, no country asked; tax shown for information");
  const none = Ship.normaliseConfig("none", { pickupInfo: "x" }).value;
  assert.deepEqual([Ship.quote(none, "").pickup, Ship.quote(none, "").price, Ship.quote(none, "").info], [true, 0, "x"]);
  const zones = Ship.normaliseConfig("zones", { ...ZONES, price_world: "" }).value;
  assert.deepEqual([Ship.quote(zones, "BE").zone, Ship.quote(zones, "BE").price], ["home", 500]);
  assert.deepEqual([Ship.quote(zones, "FR").zone, Ship.quote(zones, "FR").price], ["europe", 900]);
  assert.deepEqual(Ship.quote(zones, "US"), { ok: false, reason: "undelivered", zone: "world" });
  assert.deepEqual(Ship.quote(zones, ""), { ok: false, reason: "country" });
  assert.deepEqual(Ship.quote(zones, "ZZ"), { ok: false, reason: "country" });
  const fr2 = Ship.normaliseConfig("zones", { ...ZONES, homeCountry: "FR" }).value;
  assert.deepEqual([Ship.quote(fr2, "FR").zone, Ship.quote(fr2, "BE").zone, Ship.quote(fr2, "JP").zone], ["home", "europe", "world"], "the home zone follows the seller's own country");
  assert.equal(Ship.quote(Ship.normaliseConfig("zones", { ...ZONES, homeCountry: "US" }).value, "US").zone, "home", "even a country outside Europe");
});
test("the country lists are consistent and named in the language of the person", () => {
  assert.equal(new Set(Ship.COUNTRIES).size, Ship.COUNTRIES.length, "no duplicates");
  assert.ok([...Ship.EUROPE].every((c) => Ship.COUNTRIES.includes(c)), "every European code is a country of the list");
  for (const c of ["BE", "FR", "DE", "NL", "GB", "CH", "NO", "IT"]) assert.ok(Ship.EUROPE.has(c), c);
  for (const c of ["US", "JP", "CA", "AU", "BR"]) assert.ok(!Ship.EUROPE.has(c), c);
  assert.equal(Ship.countryOptions("en").find(([c]) => c === "BE")[1], "Belgium");
  assert.equal(Ship.countryOptions("fr").find(([c]) => c === "BE")[1], "Belgique");
  const names = Ship.countryOptions("fr").map(([, name]) => name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "fr")), "sorted in the language shown");
});
test("an order copies the shipping price: total, tax, the setup changing later changes nothing", async () => {
  const ctx = mk();
  await setup(ctx, "flat", { flat: "4.50", taxRate: "21" });
  const p = await product(ctx, { taxRate: "21" });
  const { r } = await buy(ctx, p);
  assert.equal(r.ok, true);
  const o = await D.getOrder(ctx, r.orderId);
  assert.equal(o.total, 1250 + 450); assert.deepEqual(o.shipping, { mode: "flat", zone: null, country: "", pickup: false, price: 450, includedTax: 78 });
  assert.equal(o.includedTax, 217 + 78, "the tax of the items and of the shipping");
  await setup(ctx, "flat", { flat: "99" });
  assert.equal((await D.getOrder(ctx, r.orderId)).total, 1700, "a new setup never touches an order already placed");
});
test("by zone: the country is asked, a country nobody delivers to is refused with a clear error, and the price follows the zone", async () => {
  const ctx = mk();
  await setup(ctx, "zones", { ...ZONES, price_world: "" });
  const p = await product(ctx);
  const noCountry = await buy(ctx, p, form({ country: "" }));
  assert.equal(noCountry.r.errors.country, "country");
  const us = await buy(ctx, p, form({ country: "US" }));
  assert.equal(us.r.errors.country, "undelivered");
  const be = await buy(ctx, p, form({ country: "BE" })); assert.equal((await D.getOrder(ctx, be.r.orderId)).total, 1250 + 500);
  const de = await buy(ctx, p, form({ country: "DE" })); const od = await D.getOrder(ctx, de.r.orderId);
  assert.equal(od.total, 1250 + 900); assert.equal(od.shipping.zone, "europe"); assert.equal(od.shipping.country, "DE");
  assert.equal((await buy(ctx, p, form({ country: "DE", address: "" }))).r.errors.address, "address", "delivery needs an address");
});
test("pickup only (the default) charges nothing and asks for no address; the address typed anyway is kept", async () => {
  const ctx = mk();
  const p = await product(ctx);
  const a = await buy(ctx, p, form({ address: "" }));
  assert.equal(a.r.ok, true, "no setup yet: pickup, no address needed");
  const o = await D.getOrder(ctx, a.r.orderId);
  assert.equal(o.total, 1250); assert.equal(o.shipping.pickup, true); assert.equal(o.customer.address, "");
  const b = await buy(ctx, p);
  assert.match((await D.getOrder(ctx, b.r.orderId)).customer.address, /Example street/);
});
test("the cart answer carries the shipping line and the total to pay, by country", async () => {
  const ctx = mk();
  await setup(ctx, "zones", { ...ZONES, price_world: "" });
  const p = await product(ctx);
  const add = await def.routes.add(post("add", { productId: p.id, variantId: "v1", qty: "1" }), ctx);
  const cookie = `shop_cart=${/shop_cart=([a-z2-7]{32})/.exec(add.headers.get("set-cookie"))[1]}`;
  const view = async (country) => (await def.routes.cart(new Request(`https://example.test/m/x/cart?country=${country}`, { headers: { cookie } }), ctx)).json();
  assert.deepEqual([(await view("BE")).shipping.price, (await view("BE")).grand], [500, 1750]);
  assert.equal((await view("FR")).grand, 2150);
  const us = await view("US"); assert.equal(us.shipping.ok, false); assert.equal(us.shipping.reason, "undelivered"); assert.equal(us.grand, null, "no total to pay for a country nobody delivers to");
  assert.equal((await view("")).shipping.reason, "country");
  const res = await def.routes.checkout(post("checkout", { name: "Camille", email: "etoile_nord@example.org", address: "1 Example street, 1000 Brussels", country: "US" }, cookie), ctx);
  assert.equal(res.status, 400); assert.equal((await res.json()).errors.country, "undelivered");
  assert.equal((await D.listOrders(ctx)).length, 0, "no order was made");
  const ok = await def.routes.checkout(post("checkout", { name: "Camille", email: "etoile_nord@example.org", address: "1 Example street, 1000 Brussels", country: "BE" }, cookie), ctx);
  assert.equal(ok.status, 200);
});
test("the shop page offers only the countries that are delivered, named in the page's language; the other modes ask for no country", async () => {
  const ctx = mk({ locale: "fr" });
  await product(ctx);
  const data = async (c) => JSON.parse(/data-ship="([^"]*)"/.exec((await def.page(c, { segments: [] })).blocks[0].html)[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'"));
  assert.equal((await data(ctx)).mode, "none");
  await setup(ctx, "zones", { ...ZONES, price_world: "" });
  const z = await data(ctx);
  assert.equal(z.mode, "zones"); assert.ok(z.countries.some(([c, name]) => c === "BE" && name === "Belgique"));
  assert.ok(!z.countries.some(([c]) => c === "US"), "a country nobody delivers to is not offered");
  await setup(ctx, "flat", { flat: "4.50" });
  assert.deepEqual((await data(ctx)).countries, []);
  await setup(ctx, "none", { pickupInfo: "Samedi au marché" });
  assert.equal((await data(ctx)).info, "Samedi au marché");
});
test("the tracking page, the owner's order sheet and the confirmation e-mail all show the shipping", async () => {
  const ctx = mk();
  await setup(ctx, "zones", ZONES);
  const p = await product(ctx);
  const { r, f } = await buy(ctx, p, form({ country: "FR" }));
  await O.afterPlaced(ctx, r.orderId, r.token); await M.settle();
  const page = (await def.page(ctx, { segments: ["track", r.token] })).blocks[0].html;
  assert.match(page, /Shipping \(FR\)/); assert.match(page, /€9\.00/); assert.match(page, /Total €21\.50/);
  const sheet = JSON.stringify(await def.adminPanel(ctx, { query: { order: r.orderId } }));
  assert.match(sheet, /Shipping\*\* €9\.00 \(FR\)/);
  const mail = ctx.calls.mail.find((m) => m.to === f.email);
  assert.match(mail.text, /Total: €21\.50/, "the total in the e-mail includes the shipping");
  const pick = mk(); const q = await product(pick);
  const b = await buy(pick, q, form({ address: "" }));
  assert.match(JSON.stringify(await def.adminPanel(pick, { query: { order: b.r.orderId } })), /Delivery address\*\* Pickup/);
  assert.match((await def.page(pick, { segments: ["track", b.r.token] })).blocks[0].html, /Pickup/);
});
test("the payment asks for the whole amount, shipping included", async () => {
  let asked;
  const methods = { describe: () => ({ ready: true, name: "Fake", mode: "test" }), createCheckout: (a) => { asked = a; return { ok: true, providerRef: "tr_fake1", checkoutUrl: "https://pay.example.org/x" }; } };
  const ctx = mk({ serviceInstances: { "payment.provider": [{ instance: "p1", name: "Fake", methods }] } });
  await setup(ctx, "flat", { flat: "4.50" });
  const { r, c } = await buy(ctx, await product(ctx));
  const provider = await P.pickProvider(ctx);
  const pay = await P.startPayment(ctx, r.order, r.token, provider);
  assert.equal(pay.ok, true); assert.equal(asked.amount, 1700); assert.ok(c.ok);
});
test("the administration: the setup in one line, a warning until it is chosen, one window per mode showing only what the mode needs", async () => {
  const ctx = mk();
  const text = async () => JSON.stringify(await def.adminPanel(ctx, { query: {} }));
  assert.match(await text(), /Shipping is not set up/); assert.match(await text(), /No shipping: pickup only/);
  const links = (await def.adminPanel(ctx, { query: {} })).filter((b) => b.type === "links").flatMap((b) => b.items).filter((i) => /shipping=/.test(i.href));
  assert.deepEqual(links.map((i) => [i.label, i.presentation]), [["One price", "dialog"], ["By zone", "dialog"], ["No shipping", "dialog"]]);
  const fields = async (mode) => (await def.adminPanel(ctx, { query: { shipping: mode } })).find((b) => b.type === "adminForm");
  const visible = (f) => f.fields.filter((x) => x.kind !== "hidden" && !x.folded).map((x) => x.name);
  const flat = await fields("flat"), zones = await fields("zones"), none = await fields("none");
  assert.deepEqual(visible(flat), ["flat"]); assert.deepEqual(visible(zones), ["homeCountry", "price_home", "price_europe", "price_world"]); assert.deepEqual(visible(none), ["pickupInfo"]);
  for (const f of [flat, zones, none]) { assert.equal(f.presentation, "dialog"); assert.equal(f.cancelHref, "?"); assert.equal(f.submitLabel, "Save the shipping"); assert.ok(visible(f).length <= 5); }
  const r = await def.adminActions.saveShipping(ctx, { mode: "flat", flat: "" });
  assert.match(r.errors.flat, /for example 5\.00/);
  assert.ok((await def.adminActions.saveShipping(ctx, { mode: "flat", flat: "4.50" })).ok);
  assert.match(await text(), /One price for everyone: €4\.50/); assert.doesNotMatch(await text(), /Shipping is not set up/);
  assert.ok((await def.adminActions.saveShipping(ctx, { mode: "zones", ...ZONES, price_world: "" })).ok);
  assert.match(await text(), /By zone: Inside BE €5\.00 · Europe €9\.00 · Rest of the world not delivered/);
  assert.match((await def.adminActions.saveShipping(ctx, { mode: "zones", ...ZONES, homeCountry: "" })).errors.homeCountry, /Choose your country/);
  const viewer = mk({ rights: [] }); viewer.api.store = ctx.api.store;
  assert.ok((await def.adminActions.saveShipping(viewer, { mode: "flat", flat: "1" })).error);
  assert.deepEqual((await def.adminPanel(viewer, { query: { shipping: "flat" } })).filter((b) => b.type === "adminForm"), [], "no window for someone who cannot change it");
});
