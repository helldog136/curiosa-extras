// TV type scale (core 0.11.0, `tvScale`): the two Twitch channel elements keep every text at 24 px of canvas or more, leave out what does not fit instead of shrinking the text, and still work without `ov-tv`.
import test, { afterEach, beforeEach, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeTwitch } from "./helpers/fakeTwitch.mjs";
import { connector, connectorModule, connectorCallback } from "./helpers/twitchConnector.mjs";
import { tvSuite } from "./helpers/tvLegibility.mjs";

const DIR = new URL("../modules/twitch-channel", import.meta.url).pathname;
const en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const mod = await import("../modules/twitch-channel/index.mjs");
const def = mod.default;
const OLD = "https://example.test/m/tw/oauth/callback";
const realFetch = globalThis.fetch;
let tw, C;
beforeEach(() => {
  mod.resetCache(); connectorModule.resetCache();
  tw = fakeTwitch({ redirects: new Set([OLD, connectorCallback()]), streams: [{ login: "etoile_nord", title: "Evening", game: "Zelda", viewers: 12, startedAt: "2030-01-01T10:00:00Z", name: "etoile_nord" }] });
  globalThis.fetch = (u, i) => tw.fetch(u, i);
  C = connector();
});
afterEach(() => { globalThis.fetch = realFetch; });

const STYLE = { text: "light", background: "transparent", corners: "round" };
const render = (slug) => async (query) => {
  const ctx = fakeCtx({ key: "tw", locale: "en", messages: en, settings: { channel: "etoile_nord", trackStats: true, statsFollowers: true, statsPaying: true }, services: { "twitch.api": C.methods } });
  const addr = await def.overlayElements[slug](ctx, { element: slug, fit: "fluid", width: 900, height: 300, style: STYLE, options: {}, lang: "en" });
  const q = new URLSearchParams(query); q.set("k", new URL(`https://x.test${addr.url}`).searchParams.get("k"));
  ctx.params = { slug };
  const r = await def.routes["element/:slug"](new Request(`https://example.test/m/tw/element/${slug}?${q}`), ctx);
  assert.equal(r.status, 200);
  return { html: await r.text(), headers: Object.fromEntries(r.headers) };
};

tvSuite({ test, before, after, label: "twitch-channel stats", render: render("stats"), settle: 400, frames: [
  { name: "followers and paying, square", w: 480, h: 280, extra: { "ov-demo": "1", "opt-followers": "1", "opt-paying": "1" } },
  { name: "a wide strip", w: 900, h: 140, extra: { "ov-demo": "1", "opt-followers": "1", "opt-paying": "1" } },
  { name: "a small frame", w: 300, h: 140, extra: { "ov-demo": "1", "opt-followers": "1", "opt-paying": "1" } },
] });
tvSuite({ test, before, after, label: "twitch-channel live", render: render("live"), settle: 400, frames: [
  { name: "the badge and the game", w: 420, h: 160, extra: { "ov-demo": "1", "opt-game": "1" } },
  { name: "the smallest frame", w: 200, h: 80, extra: { "ov-demo": "1" } },
] });
