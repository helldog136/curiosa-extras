// TV type scale (core 0.11.0, `tvScale`): the "Thanks" element keeps every text at 24 px of canvas or more and fits its frame (list or scroll), and still works without `ov-tv`.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { tvQuery, tvSuite } from "./helpers/tvLegibility.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, "..");
const en = JSON.parse(fs.readFileSync(path.join(ROOT, "modules/thanks-wall/locales/en.json"), "utf8"));
const def = (await import("../modules/thanks-wall/index.mjs")).default;

const page = async (q) => {
  const ctx = fakeCtx({ key: "tw", params: { slug: "thanks" }, locale: "en", locales: ["fr", "en"], defaultLocale: "en", messages: en });
  const r = await def.routes["element/:slug"](new Request(`https://x.test/m/k/element/thanks?${q}`), ctx);
  assert.equal(r.status, 200); return { html: await r.text(), headers: Object.fromEntries(r.headers) };
};

tvSuite({
  test, before, after, label: "thanks-wall", ignoreClip: [".tw-track"], render: (q) => page(q),
  frames: [
    { name: "a column with a heading", w: 480, h: 480, extra: { "ov-demo": "1", "opt-count": "6" } },
    { name: "a wide strip", w: 1200, h: 160, extra: { "ov-demo": "1", "opt-count": "6" } },
    { name: "names only", w: 400, h: 200, extra: { "ov-demo": "1", "opt-count": "4", "opt-messages": "0" } },
  ],
});

test("TV scale thanks-wall: nothing to show is still nothing (hidden panel, no text)", async () => {
  const { html } = await page(tvQuery({ w: 480, h: 480, tv: 1 }));
  assert.match(html, /id="p"[^>]*\bhidden\b/);
});
