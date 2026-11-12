// TV type scale (core 0.11.0, `tvScale`): the "Next event" element keeps every text at 24 px of canvas or more, leaves out its least useful lines instead of shrinking the text, and still works without `ov-tv`.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { def, ctxFor, addEvent } from "./helpers/eventsKit.mjs";
import { tvSuite, tvQuery } from "./helpers/tvLegibility.mjs";

const route = (ctx, query) => def.routes.element(new Request(`https://x.test/m/x/element?${query}`, { headers: { "x-forwarded-for": "203.0.113.9" } }), ctx);
const soon = () => new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
const render = (title) => async (query) => {
  const ctx = ctxFor();
  await addEvent(ctx, { title, date: soon(), time: "20:00", place: "Studio Lune Douce, 12 rue des Etoiles" });
  const r = await route(ctx, query);
  assert.equal(r.status, 200);
  return { html: await r.text(), headers: Object.fromEntries(r.headers), handler: async (u) => def.routes["element-data"]?.(new Request(u), ctx) ?? null };
};

for (const [name, title] of [["a short title", "Game night"], ["a long title", "The grand spring tournament of the lantern festival, finals and awards"]]) {
  tvSuite({
    test, before, after, label: `events ${name}`, render: render(title), settle: 500,
    frames: [
      { name: "a card", w: 640, h: 280 },
      { name: "a banner", w: 900, h: 160 },
      { name: "a small frame", w: 360, h: 140 },
    ],
  });
}

test("TV scale events: nothing to show is still nothing (hidden frame)", async () => {
  const r = await route(ctxFor(), tvQuery({ w: 640, h: 280, tv: 1 }));
  assert.match(await r.text(), /id="ev"[^>]*\shidden>/);
});
