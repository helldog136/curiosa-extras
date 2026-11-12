// TV type scale (core 0.11.0, `tvScale`): the "Live poll" element keeps every text at 24 px of canvas or more, leaves out what does not fit (footer, tag, status, last choices) instead of shrinking the text, and still works without `ov-tv`.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { world, pollsMod, pollsDef } from "./helpers/audienceWorld.mjs";
import { tvSuite, wrapOverlay } from "./helpers/tvLegibility.mjs";

const L = await import("../modules/polls/lib.mjs");
const cfgOf = async (c) => {
  let r = (await c.api.store.list("meta")).find((x) => x.data.k === "cfg");
  if (!r) { await pollsDef.hooks.onInstanceCreate(c); r = (await c.api.store.list("meta")).find((x) => x.data.k === "cfg"); }
  return r.data;
};
const render = (choices) => async (query) => {
  const w = world({ audience: false, pollsSettings: {} });
  const v = L.validatePollForm({ question: "Which game should we play after the break?", choices, max: 1 }, { tz: "Europe/Paris" });
  assert.deepEqual(v.errors, {}, JSON.stringify(v.errors));
  const made = await pollsMod.createPoll(w.polls, v.value, "Europe/Paris");
  assert.ok(made.ok);
  const key = (await cfgOf(w.polls)).obsKey;
  const q = new URLSearchParams(query); q.set("k", key); q.set("opt-poll", made.slug);
  const out = await pollsDef.overlay(w.polls, { query: q });
  const handler = async (u) => (new URL(u).pathname.endsWith("/live") ? pollsDef.routes.live(new Request(u, { headers: { "x-forwarded-for": "7.7.7.7" } }), w.polls) : null);
  return { html: wrapOverlay(out), handler };
};

for (const [name, choices] of [["three choices", "Hollow Knight\nCeleste\nHades"], ["six choices", "Hollow Knight\nCeleste\nHades\nStardew Valley\nA Short Hike\nInscryption"]]) {
  tvSuite({
    test, before, after, label: `polls ${name}`, render: render(choices), settle: 700,
    frames: [
      { name: "a card", w: 640, h: 520, extra: { "ov-fit": "fluid" } },
      { name: "a wide banner", w: 1100, h: 330, extra: { "ov-fit": "fluid" } },
      { name: "a small frame", w: 480, h: 300, extra: { "ov-fit": "fluid" } },
    ],
  });
}
tvSuite({ test, before, after, label: "polls demo", render: async (q) => { const w = world({ pollsSettings: {} }); const k = (await cfgOf(w.polls)).obsKey; const o = await pollsDef.overlay(w.polls, { query: new URLSearchParams(`${q}&k=${k}`) }); return { html: wrapOverlay(o) }; }, frames: [{ name: "the editor sample", w: 640, h: 520, extra: { "ov-fit": "fluid", "ov-demo": "1" } }] });
