// TV type scale (core 0.11.0, `tvScale`): the "Reviews" element keeps every text at 24 px of canvas or more (the quote at 32 px or more, cut with an ellipsis when it cannot fit), and still works without `ov-tv`.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { def, ctxFor, seed } from "./helpers/testimonials.mjs";
import { tvSuite, tvQuery } from "./helpers/tvLegibility.mjs";

const LONG = "We came for the games and stayed for the people: every stream feels like an evening with friends, the community is kind, the jokes are good, and the little rituals make it feel like home. Thank you for all of it.";
const render = (text, count = 1) => async (query) => {
  const ctx = ctxFor({ settings: {} });
  for (let i = 0; i < count; i++) await seed(ctx, { name: "Camille", text, rating: 5, status: "approved", consent: true });
  const r = await def.routes["element/:slug"](new Request(`https://x.test/m/k/element/reviews?${query}`), Object.assign(ctx, { params: { slug: "reviews" } }));
  assert.equal(r.status, 200);
  return { html: await r.text(), headers: Object.fromEntries(r.headers) };
};

for (const [name, text] of [["a short review", "A very warm welcome."], ["a long review", LONG]]) {
  tvSuite({ test, before, after, label: `testimonials ${name}`, render: render(text), settle: 900, frames: [
    { name: "the default frame", w: 480, h: 220, extra: { "ov-demo": "1" } },
    { name: "a tall card", w: 480, h: 420, extra: { "ov-demo": "1" } },
    { name: "a wide strip", w: 1100, h: 180, extra: { "ov-demo": "1" } },
    { name: "a small frame", w: 320, h: 140, extra: { "ov-demo": "1" } },
  ] });
}

test("TV scale testimonials: nothing to show is still nothing (the page has no visible review)", async () => {
  const r = await def.routes["element/:slug"](new Request(`https://x.test/m/k/element/reviews?${tvQuery({ w: 480, h: 220, tv: 1 })}`), Object.assign(ctxFor({ settings: {} }), { params: { slug: "reviews" } }));
  assert.match(await r.text(), /"reviews":\[\]/);
});
