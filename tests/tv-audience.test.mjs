// TV type scale (core 0.11.0, `tvScale`): the "Draw" element keeps every text at 24 px of canvas or more, leaves out what does not fit (footer, status, last winners) instead of shrinking the text, and still works without `ov-tv`.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { audienceCtx, def, req } from "./helpers/audienceHarness.mjs";
import { tvSuite, wrapOverlay } from "./helpers/tvLegibility.mjs";

const D = await import("../modules/audience/draw.mjs");
const chat = (c, name) => def.services["audience.draw"].enter(c, { pseudo: name, platform: "twitch", login: name.toLowerCase() });
let ipn = 0;
const direct = (c) => async (u) => def.routes.direct(req(new URL(u, "https://x.test").href, undefined, { ip: `9.6.${Math.floor(ipn / 200)}.${(ipn++ % 200) + 1}` }), c);
const render = (winners) => async (query) => {
  const c = audienceCtx();
  const opened = await D.openNew(c, { title: "Prize of the evening", keyword: "!gift", level: "all", site: true, minutes: null, winners }, { now: Date.now() });
  assert.ok(opened.ok);
  for (const n of ["etoile_nord", "lune_douce", "Camille", "nuage_clair"]) await chat(c, n);
  const q = new URLSearchParams(query); q.set("k", await D.screenKey(c));
  if (winners) { await D.close(c, { now: Date.now() }); await D.pick(c, { now: Date.now() }); q.set("opt-keep", "1"); }
  const out = await def.overlay(c, { query: q });
  return { html: wrapOverlay(out), handler: direct(c) };
};
const frames = (extra) => [
  { name: "a card", w: 640, h: 360, extra }, { name: "a wide strip", w: 1100, h: 200, extra }, { name: "a small frame", w: 420, h: 220, extra },
];
tvSuite({ test, before, after, label: "audience open draw", render: render(0), settle: 600, frames: frames({ "ov-fit": "fluid" }) });
tvSuite({ test, before, after, label: "audience winners", render: render(3), settle: 600, frames: frames({ "ov-fit": "fluid" }) });
tvSuite({ test, before, after, label: "audience demo", render: render(0), settle: 600, frames: [{ name: "the editor sample", w: 640, h: 360, extra: { "ov-fit": "fluid", "ov-demo": "1" } }] });
