// Product photos: the gallery field, keeping and releasing the files, the description of each photo, what the shop page and the list show. Invented data only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { memStore } from "./helpers/contactsStore.mjs";

const DIR = new URL("../modules/shop", import.meta.url).pathname;
const en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const def = (await import("../modules/shop/index.mjs")).default;
const D = await import("../modules/shop/data.mjs");
const C = await import("../modules/shop/cart.mjs");
const O = await import("../modules/shop/orders.mjs");

let n = 0;
const photo = (ext = "jpg") => `/uploads/${crypto.randomUUID()}.${ext}`;
function mk({ uploads = [], rights } = {}) {
  const ctx = fakeCtx({ key: `ph${++n}`, basePath: "shop", moduleId: "shop", locale: "en", defaultLocale: "en", locales: ["en", "fr"], messages: en, settings: {}, site: { name: "Atelier", tagline: "", logo: null }, uploads });
  ctx.api.store = memStore({ start: Date.now() - 3_600_000 });
  ctx.instance.id = `inst${n}`;
  const allowed = rights ? new Set(rights) : null;
  ctx.can = (r) => (allowed ? allowed.has(r) : true);
  return ctx;
}
const gallery = (...items) => JSON.stringify(items.map((i) => (typeof i === "string" ? { src: i } : i)));
const save = (ctx, over = {}) => def.adminActions.saveProduct(ctx, { id: "", title: "Plush fox", price: "12.50", stockMode: "tracked", onHand: "5", ...over });
const only = async (ctx) => (await D.listProducts(ctx))[0];
const files = (ctx) => ctx.dumpFiles().filter((f) => f.owner === "me").map((f) => f.url);

test("the photo field is one gallery field of images, 8 at most, with a description under each; the window keeps its 5 visible fields", async () => {
  const ctx = mk();
  const form = (await def.adminPanel(ctx, { query: { edit: "new" } })).find((b) => b.type === "adminForm");
  const f = form.fields.find((x) => x.name === "photos");
  assert.deepEqual([f.kind, f.accept, f.max, f.itemLabel], ["gallery", ["image"], 8, true]);
  assert.ok(form.fields.filter((x) => x.kind !== "hidden" && !x.folded).length <= 5);
});
test("only the site's own uploaded images are accepted: no other folder, crop, address, video or vector drawing; 8 at most; duplicates removed", () => {
  const ok = photo();
  assert.deepEqual(D.parsePhotos(gallery({ src: ok, label: "  Front   view " })).list, [{ src: ok, alt: "Front view" }]);
  assert.deepEqual(D.parsePhotos(JSON.stringify([ok, ok])).list.length, 1);
  for (const bad of ["/uploads/x.jpg", `${photo()}?c=1_1_0.5_0.5_ffffff`, "https://example.org/a.jpg", "/other/" + crypto.randomUUID() + ".jpg", photo("mp4"), photo("svg"), "javascript:alert(1)", `/uploads/../${crypto.randomUUID()}.jpg`]) assert.equal(D.parsePhotos(gallery(bad)).ok, false, bad);
  assert.equal(D.parsePhotos("not json").ok, false); assert.equal(D.parsePhotos('{"a":1}').ok, false);
  assert.equal(D.parsePhotos(JSON.stringify(Array.from({ length: 9 }, photo))).ok, false);
  assert.equal(D.parsePhotos(JSON.stringify(Array.from({ length: 8 }, photo))).ok, true);
  assert.equal(D.parsePhotos(gallery({ src: ok, label: "x".repeat(500) })).list[0].alt.length, 120);
  assert.deepEqual(D.parsePhotos("[]").list, []);
});
test("saving keeps the new files (claims them), stores their description, and says so under the field when a file cannot be kept", async () => {
  const a = photo(), b = photo(), stranger = photo(), old = photo();
  const ctx = mk({ uploads: [a, b, { url: stranger, by: "u2" }, { url: old, ageMs: 40 * 60_000 }] });
  const r = await save(ctx, { photos: gallery({ src: a, label: "Front" }, b) });
  assert.ok(r.ok, JSON.stringify(r));
  const p = await only(ctx);
  assert.deepEqual(p.photos, [{ src: a, alt: "Front" }, { src: b, alt: "" }]);
  assert.deepEqual(ctx.calls.files.filter((c) => c.op === "claim" && c.result.ok).map((c) => c.url), [a, b]);
  const otherUp = await save(ctx, { title: "Plush hare", photos: gallery(stranger) });
  assert.match(otherUp.errors.photos, /could not be kept/); assert.equal((await D.listProducts(ctx)).length, 1, "nothing saved when a photo is refused");
  assert.match((await save(ctx, { title: "Plush owl", photos: gallery(old) })).errors.photos, /could not be kept/, "an upload older than 30 minutes");
  assert.match((await save(ctx, { title: "Plush owl", photos: gallery(photo()) })).errors.photos, /could not be kept/, "a file the core never received");
  assert.match((await save(ctx, { title: "Plush owl", photos: JSON.stringify(Array.from({ length: 9 }, photo)) })).errors.photos, /8 images at most/);
});
test("taking a photo out releases its file, the others stay, putting one back asks for nothing more, and a window without the field keeps the photos", async () => {
  const a = photo(), b = photo(), c = photo();
  const ctx = mk({ uploads: [a, b, c] });
  await save(ctx, { photos: gallery(a, b) });
  const id = (await only(ctx)).id;
  assert.deepEqual(files(ctx).sort(), [a, b].sort());
  await def.adminActions.saveProduct(ctx, { id, title: "Plush fox", price: "12.50", stockMode: "tracked", onHand: "5", photos: gallery(b, c) });
  assert.deepEqual(files(ctx).sort(), [b, c].sort(), "a is gone from the disk, b stays, c is kept");
  assert.deepEqual((await only(ctx)).photos.map((x) => x.src), [b, c]);
  const claimsBefore = ctx.calls.files.filter((x) => x.op === "claim").length;
  await def.adminActions.saveProduct(ctx, { id, title: "Plush fox", price: "12.50", stockMode: "tracked", onHand: "5", photos: gallery(c, b) });
  assert.equal(ctx.calls.files.filter((x) => x.op === "claim").length, claimsBefore, "reordering claims nothing");
  assert.deepEqual((await only(ctx)).photos.map((x) => x.src), [c, b]);
  await def.adminActions.saveProduct(ctx, { id, title: "Plush fox", price: "13", stockMode: "tracked", onHand: "5" });
  assert.deepEqual((await only(ctx)).photos.map((x) => x.src), [c, b], "a save without the field leaves the photos alone");
});
test("deleting a product deletes its photos; a refused deletion keeps them", async () => {
  const a = photo(), b = photo();
  const ctx = mk({ uploads: [a, b] });
  await save(ctx, { photos: gallery(a, b) });
  const p = await only(ctx);
  const c = await C.addToCart(ctx, null, { productId: p.id, variantId: "v1", qty: 1 }, Date.now());
  assert.equal(c.ok, true);
  assert.match((await def.adminActions.deleteProduct(ctx, { id: p.id })).error, /cart or an order/);
  assert.equal(files(ctx).length, 2, "refused: the files stay");
  await C.discardCart(ctx, await D.findCart(ctx, c.token));
  for (const l of (await D.findCart(ctx, c.token)).lines) await ctx.api.store.remove(l.rid);
  assert.ok((await def.adminActions.deleteProduct(ctx, { id: p.id })).ok);
  assert.equal(files(ctx).length, 0, "the photos left with the product");
});
test("the shop page shows the first photo with its description (the title when none), small links for the next ones, and escapes everything", async () => {
  const a = photo(), b = photo(), c = photo(), d = photo(), e = photo(), f = photo();
  const ctx = mk({ uploads: [a, b, c, d, e, f] });
  await save(ctx, { photos: gallery({ src: a, label: 'Front "view" <b>' }, b, c, d, e, f) });
  await save(ctx, { title: "Plain sticker", photos: gallery() });
  const html = (await def.page(ctx, { segments: [] })).blocks[0].html;
  assert.ok(html.includes(`src="${a}?c=1.3333_1_0.5_0.5_ffffff"`), "the first photo, cropped to 4:3 by the core and cached");
  assert.ok(html.includes('alt="Front &quot;view&quot; &lt;b&gt;"') && !html.includes("<b>"), "the description is escaped");
  assert.ok(html.includes(`<a href="${b}">`) && html.includes(`alt="Plush fox 2"`), "the next photos are small links to the full image, with a fallback description");
  assert.equal((html.match(/class="sh-th"/g) ?? []).length, 1);
  assert.equal((html.match(/<a href="\/uploads\//g) ?? []).length, 4, "four small ones at most");
  assert.match(html, /loading="lazy"/); assert.match(html, /width="640" height="480"/);
  const sticker = html.split("</article>").find((x) => x.includes("Plain sticker"));
  assert.ok(!sticker.includes("<img"), "no photo, no empty picture box");
});
test("the administration list shows a small picture before the name, described", async () => {
  const a = photo();
  const ctx = mk({ uploads: [a] });
  await save(ctx, { photos: gallery({ src: a, label: "Front" }) });
  await save(ctx, { title: "Plain sticker" });
  const table = (await def.adminPanel(ctx, { query: {} })).filter((b) => b.type === "table").find((b) => b.columns[0] === "Product");
  const cells = Object.fromEntries(table.rows.map((r) => [typeof r[0] === "string" ? r[0] : r[0].text, r[0]]));
  assert.deepEqual(cells["Plush fox"], { text: "Plush fox", image: { src: `${a}?c=1_1_0.5_0.5_ffffff`, alt: "Front" } });
  assert.equal(cells["Plain sticker"], "Plain sticker");
});
test("the photos of a product are not part of an order (the order keeps title, option and price only), so a deleted photo never breaks an old order", async () => {
  const a = photo();
  const ctx = mk({ uploads: [a] });
  await save(ctx, { photos: gallery(a) });
  const p = await only(ctx);
  const c = await C.addToCart(ctx, null, { productId: p.id, variantId: "v1", qty: 1 }, Date.now());
  const r = await O.checkout(ctx, c.token, { name: "Camille", email: "camille@example.org", address: "1 Example street, 1000 Brussels" }, Date.now());
  assert.doesNotMatch(JSON.stringify(await D.getOrder(ctx, r.orderId)), /\/uploads\//);
});
