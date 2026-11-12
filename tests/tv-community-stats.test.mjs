// TV type scale (core 0.11.0, `tvScale`): the "Counters" element keeps every text at 24 px of canvas or more, fits its frame, and still works without `ov-tv`.
import test, { after, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { NOW } from "./helpers/overlayNonReg.mjs";
import { browser, closeBrowser, tvQuery, renderAndMeasure, assertTv, TV_CASES } from "./helpers/tvLegibility.mjs";

mock.timers.enable({ apis: ["Date"], now: NOW, });
const def = (await import("../modules/community-stats/index.mjs")).default;
const overlay = await import("../modules/community-stats/overlay.mjs");
const { collectNow } = await import("../modules/community-stats/collect.mjs");
const { loadStats } = await import("../modules/community-stats/stats.mjs");
const { setManual } = await import("../modules/community-stats/manual.mjs");
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, "..");
const fr = JSON.parse(fs.readFileSync(path.join(ROOT, "modules/community-stats/locales/en.json"), "utf8"));

const mk = (id, platform, account, key, metric, value) => ({ id, platform, account, accountKey: key, metric, label: `${platform} ${metric}`, value, asOf: new Date(NOW).toISOString() });
const items = () => [
  mk("twitch-channel:etoile:followers", "twitch", "etoile_nord", "etoile", "followers", 12_345),
  mk("twitch-channel:etoile:paying", "twitch", "etoile_nord", "etoile", "paying", 128),
  mk("youtube-channel:c:content", "youtube", "lune_douce", "c", "content", 80),
  mk("youtube-channel:c:views", "youtube", "lune_douce", "c", "views", 1_250_000),
];
const DAY = 86_400_000;
let b = null;
before(async () => { b = await browser(); if (!b) console.warn("tv-community-stats: no Playwright/Chromium here, the browser checks are skipped"); });
after(async () => { mock.timers.reset(); await closeBrowser(); });
beforeEach(() => { mock.timers.setTime(NOW); overlay.resetOverlayCache(); });

async function build(shown) {
  overlay.resetOverlayCache();
  const ctx = fakeCtx({ key: "community-stats", params: { slug: "counters" }, locale: "en", locales: ["fr", "en"], messages: fr, topics: { "social.stat": () => items() } });
  for (let d = -10; d <= 0; d++) await collectNow(ctx, { now: NOW + d * DAY });
  const all = await loadStats(ctx);
  await def.adminActions.saveVisibility(ctx, Object.fromEntries(all.map((s) => [`show_${s.docId}`, shown.includes(s.id) ? "yes" : "no"])));
  return ctx;
}
const page = async (ctx, q) => { const r = await def.routes["element/:slug"](new Request(`https://x.test/m/k/element/counters?${q}`), ctx); assert.equal(r.status, 200); return { html: await r.text(), headers: Object.fromEntries(r.headers) }; };

for (const [name, shown, frame] of [
  ["two counters", ["twitch-channel:etoile:followers", "youtube-channel:c:views"], { w: 640, h: 240 }],
  ["four counters", items().map((i) => i.id), { w: 960, h: 360 }],
]) {
  for (const c of TV_CASES(frame)) {
    test(`TV scale: ${name}, ${c.name} (ov-tv ${c.tv}, ${c.w}x${c.h}): text 24 px or more, no overflow, nothing clipped`, async (t) => {
      if (!b) return t.skip("no browser");
      const ctx = await build(shown);
      const q = tvQuery({ w: c.w, h: c.h, tv: c.tv });
      const { html, headers } = await page(ctx, q);
      assertTv(await renderAndMeasure(b, { html, headers, width: c.w, height: c.h, shot: `community-stats-${name.replace(/ /g, "-")}-${c.name}`, url: `https://x.test/m/k/element/counters?${q}` }), `${name} ${c.name}`);
    });
  }
}

test("TV scale: without ov-tv the tokens fall back to 1 (24 px smallest), and an absurd value is ignored", async () => {
  const ctx = await build(["twitch-channel:etoile:followers"]);
  const none = (await page(ctx, tvQuery({ w: 640, h: 240, tv: 1 }).toString().replace(/&?ov-tv=1/, ""))).html;
  assert.match(none, /--ov-tv:1;--ov-text-xs:calc\(24px\*var\(--ov-tv\)\)/);
  for (const bad of ["0", "-3", "20", "abc"]) assert.match((await page(ctx, tvQuery({ w: 640, h: 240, tv: bad }))).html, /--ov-tv:1;/, `ov-tv=${bad}`);
  assert.match((await page(ctx, tvQuery({ w: 640, h: 240, tv: 1.5 }))).html, /--ov-tv:1\.5;/);
});

test("TV scale: nothing to show is still nothing (hidden panel, no text)", async () => {
  const ctx = await build([]);
  const { html } = await page(ctx, tvQuery({ w: 640, h: 240, tv: 1 }));
  assert.match(html, /id="p"[^>]*\bhidden\b/);
  assert.equal(assert.ok(!/data-ov-part="counter"/.test(html)), undefined);
});
