// TV type scale (core 0.11.0, `tvScale`): the "Top suggestions" element keeps every text at 24 px of canvas or more, drops the last games rather than shrinking the text, and still works without `ov-tv`.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { tvQuery, tvSuite } from "./helpers/tvLegibility.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, "..");
const en = JSON.parse(fs.readFileSync(path.join(ROOT, "modules/game-suggestions/locales/en.json"), "utf8"));
const def = (await import("../modules/game-suggestions/index.mjs")).default;

const page = async (q) => {
  const ctx = fakeCtx({ key: "gs", basePath: "suggestions", moduleId: "game-suggestions", params: { slug: "top" }, locale: "en", locales: ["fr", "en"], defaultLocale: "en", messages: en });
  const r = await def.routes["element/:slug"](new Request(`https://x.test/m/k/element/top?${q}`), ctx);
  assert.equal(r.status, 200); return { html: await r.text(), headers: Object.fromEntries(r.headers) };
};

tvSuite({
  test, before, after, label: "game-suggestions", render: (q) => page(q),
  frames: [
    { name: "three games in a column", w: 480, h: 360, extra: { "ov-demo": "1", "opt-count": "3" } },
    { name: "ten games, wide", w: 1000, h: 400, extra: { "ov-demo": "1", "opt-count": "10" } },
    { name: "five games, small frame", w: 360, h: 240, extra: { "ov-demo": "1", "opt-count": "5" } },
  ],
});

test("TV scale game-suggestions: nothing to show is still nothing (no list, no text)", async () => {
  const { html } = await page(tvQuery({ w: 480, h: 360, tv: 1 }));
  assert.ok(!/data-ov-part="game"/.test(html));
});
