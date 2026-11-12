// TV type scale (core 0.11.0, `tvScale`): the "Next stream" and "Week schedule" elements keep every text at 24 px of canvas or more, never shrink their text to fit, and still work without `ov-tv`.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { tvSuite } from "./helpers/tvLegibility.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, "..");
const en = JSON.parse(fs.readFileSync(path.join(ROOT, "modules/planning/locales/en.json"), "utf8"));
const def = (await import("../modules/planning/index.mjs")).default;

const render = (slug) => async (query) => {
  const ctx = fakeCtx({ key: "planning", params: { slug }, settings: { days: 7, timezone: "UTC" }, messages: en, locale: "en", rawgConfigured: false });
  const r = await def.routes["element/:slug"](new Request(`https://site.test/m/planning/element/${slug}?${query}`), ctx);
  assert.equal(r.status, 200);
  return { html: await r.text(), headers: Object.fromEntries(r.headers) };
};
const demo = { "ov-demo": "1" };
tvSuite({ test, before, after, label: "planning next", render: render("next"), settle: 500, frames: [
  { name: "the default frame", w: 640, h: 320, extra: demo }, { name: "with a list", w: 800, h: 560, extra: { ...demo, "opt-more": "3" } }, { name: "a narrow card", w: 360, h: 420, extra: demo }, { name: "a small frame", w: 320, h: 160, extra: demo },
] });
tvSuite({ test, before, after, label: "planning week", render: render("week"), settle: 500, ignoreClip: ["#r.cut"] /* the week keeps its designed fade at the bottom: a frame too small for the week shows its first rows */, frames: [
  { name: "a list in a card", w: 768, h: 540, extra: demo }, { name: "a wide grid", w: 1900, h: 700, extra: demo }, { name: "a small frame", w: 480, h: 280, extra: demo }, { name: "posters", w: 1200, h: 520, extra: { ...demo, "opt-look": "posters" } },
  { name: "timeline", w: 900, h: 520, extra: { ...demo, "opt-look": "timeline" } }, { name: "alternating", w: 900, h: 520, extra: { ...demo, "opt-look": "alternating" } },
] });
