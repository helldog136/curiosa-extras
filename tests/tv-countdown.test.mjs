// TV type scale (core 0.11.0, `tvScale`): the "Countdown" element keeps every text at 24 px of canvas or more and fits its frame, and still works without `ov-tv`.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { tvSuite, wrapOverlay } from "./helpers/tvLegibility.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, "..");
const en = JSON.parse(fs.readFileSync(path.join(ROOT, "modules/countdown/locales/en.json"), "utf8"));
const cd = (await import("../modules/countdown/index.mjs")).default;

const ctx = () => fakeCtx({ key: "cd", basePath: "countdown", moduleId: "countdown", name: "Countdown", locale: "en", defaultLocale: "en", locales: ["fr", "en"], messages: en, siteUrl: "https://site.test" });
const render = async (q) => {
  const c = ctx();
  const out = await cd.overlay(c, { query: new URLSearchParams(q) });
  const handler = async (u) => { const url = new URL(u); return url.pathname.endsWith("/state") ? cd.routes.state(new Request(u), c) : null; };
  return { html: wrapOverlay(out), handler };
};

tvSuite({
  test, before, after, label: "countdown", render, settle: 900,
  frames: [
    { name: "the default frame, days to go", w: 600, h: 200, extra: { "ov-demo": "1", "ov-fit": "scale" } },
    { name: "without seconds", w: 600, h: 200, extra: { "ov-demo": "1", "ov-fit": "scale", "opt-seconds": "0" } },
  ],
});

test("TV scale countdown: nothing planned is still nothing (hidden)", async () => {
  const { html } = await render("ov-w=600&ov-h=200&ov-fit=scale&ov-text=light&ov-tv=1");
  assert.match(html, /id="vco"[^>]*\bhidden\b/);
});
