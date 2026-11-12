// TV type scale (core 0.11.0, `tvScale`): the "Mascot" element keeps every text at 24 px of canvas or more (the sentence at 32 px or more, cut by an ellipsis when it cannot fit), and still works without `ov-tv`.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { ctxFor, publishedCtx, def, get } from "./helpers/mascotKit.mjs";
import { tvSuite } from "./helpers/tvLegibility.mjs";

const page = (ctx) => async (query) => {
  const r = await def.routes["element/:slug"](get(`/m/${ctx.instance.key}/element/mascot?${query}`), Object.assign(ctx, { params: { slug: "mascot" } }));
  assert.equal(r.status, 200);
  return { html: await r.text(), headers: Object.fromEntries(r.headers) };
};
const demo = { "ov-fit": "scale", "ov-demo": "1", "opt-seconds": "60" };
tvSuite({ test, before, after, label: "mascot demo sentence", render: async (q) => page(ctxFor())(q), settle: 900, frames: [
  { name: "the default frame", w: 440, h: 320, extra: demo }, { name: "visible only while it speaks", w: 440, h: 320, extra: { ...demo, "opt-visibility": "speaking" }, expectText: false },
] });
tvSuite({ test, before, after, label: "mascot published sentences", render: async (q) => page(await publishedCtx())(q), settle: 900, frames: [
  { name: "the default frame", w: 440, h: 320, extra: { "ov-fit": "scale", "opt-seconds": "60" } },
] });
