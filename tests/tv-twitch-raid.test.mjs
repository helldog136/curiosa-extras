// TV type scale (core 0.11.0, `tvScale`): the two Raid elements keep every text at 24 px of canvas or more, leave out the rows that do not fit instead of shrinking the text, and still work without `ov-tv`.
import test, { afterEach, beforeEach, before, after } from "node:test";
import assert from "node:assert/strict";
import { world, logins, T0 } from "./helpers/twitch-raid-world.mjs";
import { tvSuite, tvQuery } from "./helpers/tvLegibility.mjs";

const def = (await import("../modules/twitch-raid/index.mjs")).default;
const live = await import("../modules/twitch-raid/live.mjs");
const search = await import("../modules/twitch-raid/search.mjs");
const source = await import("../modules/twitch-raid/source.mjs");
const M = await import("../modules/twitch-raid/moment.mjs");
beforeEach(() => { live.resetLive(); search.resetSearch(); source.resetSource(); M.resetMoment(); M.hooks.now = () => T0; M.hooks.rng = null; });
afterEach(() => { M.hooks.now = () => Date.now(); });

const lives = (n) => Object.fromEntries(logins(n, 0).map((l, i) => [l, { viewers: 5 + i * 37, minutes: 20 + i, game: `A game with a rather long name ${i}`, title: `Title ${i}` }]));
const keyOf = async (w, id) => new URL(`https://x.test${(await def.overlayElements[id](w.ctx, { lang: "en" })).url}`).searchParams.get("k");
const render = (slug) => async (query) => {
  const w = world({ partners: logins(12), live: lives(12), settings: {} });
  const k = await keyOf(w, slug);
  const q = new URLSearchParams(query); q.set("k", k);
  w.ctx.params = { slug };
  const r = await def.routes["element/:slug"](new Request(`https://x.test/m/x/element/${slug}?${q}`), w.ctx);
  assert.equal(r.status, 200);
  const handler = async (u) => { w.ctx.params = { slug }; return def.routes["element-data/:slug"](new Request(u), w.ctx); };
  return { html: await r.text(), headers: Object.fromEntries(r.headers), handler, url: `https://x.test/m/x/element/${slug}?${q}` };
};

for (const [slug, frames] of [
  ["featured", [{ name: "the selection, three rows", w: 700, h: 320, extra: { "ov-demo": "1" } }, { name: "a small frame", w: 360, h: 180, extra: { "ov-demo": "1" } }]],
  ["live", [{ name: "five rows", w: 700, h: 420, extra: { "ov-demo": "1", "opt-max": "5" } }, { name: "without a title or game", w: 600, h: 200, extra: { "ov-demo": "1", "opt-max": "3", "opt-title": "0", "opt-game": "0" } }]],
]) tvSuite({ test, before, after, label: `twitch-raid ${slug}`, frames, render: render(slug), settle: 500 });

test("TV scale twitch-raid: nothing to show is still nothing (hidden frame, no text)", async () => {
  const w = world({ partners: logins(12), live: {}, settings: {} });
  const k = await keyOf(w, "live"); w.ctx.params = { slug: "live" };
  const html = await (await def.routes["element/:slug"](new Request(`https://x.test/m/x/element/live?${tvQuery({ w: 600, h: 300, tv: 1, extra: { k } })}`), w.ctx)).text();
  assert.match(html, /id="rd"[^>]*\bhidden\b/);
});
