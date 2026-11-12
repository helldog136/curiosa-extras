// Entrance / exit transitions of overlay elements (sponsor banner, scrolling banner, alerts): one shared helper
// (scripts/overlay-transition.mjs), validation, defaults unchanged, reduced motion, settings and element options.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { ENTRANCES, EXITS, INHERIT, SECONDS, transitionConfig, ovTransition } from "../scripts/overlay-transition.mjs";
import { LABELS, optionsBlock, settingsBlock } from "../scripts/overlay-transition-labels.mjs";
import { TRANSITION_MODULES } from "../scripts/gen-transition.mjs";

const root = new URL("..", import.meta.url).pathname;
const manifest = (id) => JSON.parse(fs.readFileSync(`${root}modules/${id}/module.json`, "utf8"));
const messages = (id) => JSON.parse(fs.readFileSync(`${root}modules/${id}/locales/fr.json`, "utf8"));
const frame = (extra = "") => new URLSearchParams(`ov-w=720&ov-h=180&ov-fit=scale&ov-lang=fr&ov-text=light&ov-surface=soft&ov-corners=round${extra ? `&${extra}` : ""}`);
const cfgOf = (script) => JSON.parse(script.match(/"tr":(\{[^}]*\})/)[1]);

test("the copies in the modules are the shared file, and the manifests carry the shared texts", () => {
  const r = spawnSync(process.execPath, [`${root}scripts/gen-transition.mjs`, "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(Object.keys(TRANSITION_MODULES).sort(), ["alerts-overlay", "mascot", "sponsor-ticker", "ticker-overlay"]);
});

test("transitionConfig: defaults are 'auto' in and 'same' out, so nothing changes unless chosen", () => {
  assert.deepEqual(transitionConfig({}, 580), { in: "auto", out: "auto", ms: 580 });
  assert.deepEqual(transitionConfig(), { in: "auto", out: "auto", ms: 600 });
  assert.deepEqual(transitionConfig({ inSetting: "slideLeft" }), { in: "slideLeft", out: "slideLeft", ms: 600 }, "'same' plays the entrance backwards");
  assert.deepEqual(transitionConfig({ inSetting: "slideLeft", outSetting: "fade" }), { in: "slideLeft", out: "fade", ms: 600 });
});

test("transitionConfig: the element option wins unless it is 'module'; unknown values fall back; length is clamped", () => {
  assert.equal(transitionConfig({ inOpt: "fade", inSetting: "pop" }).in, "fade");
  assert.equal(transitionConfig({ inOpt: INHERIT, inSetting: "pop" }).in, "pop");
  assert.equal(transitionConfig({ inOpt: "<script>", inSetting: "nope" }).in, "auto");
  assert.equal(transitionConfig({ outOpt: "auto", outSetting: "nope", inSetting: "pop" }).out, "pop", "'auto' is not an exit: falls back to 'same'");
  assert.equal(transitionConfig({ seconds: 0.01 }).ms, SECONDS.min * 1000);
  assert.equal(transitionConfig({ seconds: 99 }).ms, SECONDS.max * 1000);
  assert.equal(transitionConfig({ seconds: "1.2" }).ms, 1200);
  for (const bad of ["", null, undefined, "abc", NaN]) assert.equal(transitionConfig({ seconds: bad }, 500).ms, 500);
});

test("choices: slide from every side, fade, jiggle, pop, none; exit adds 'same'", () => {
  for (const m of ["slide", "slideLeft", "slideRight", "slideTop", "slideBottom", "fade", "jiggle", "pop", "none"]) { assert.ok(ENTRANCES.includes(m)); assert.ok(EXITS.includes(m)); }
  assert.ok(ENTRANCES.includes("auto") && !EXITS.includes("auto"));
  assert.equal(EXITS[0], "same");
});

for (const [id, spec] of Object.entries(TRANSITION_MODULES)) {
  test(`${id}: three folded settings and two element options, from the shared texts, FR and EN`, () => {
    const m = manifest(id);
    assert.ok(m.minCore.split(".").map(Number).reduce((a, n, i) => a || (n - [0, 6, 0][i]), 0) >= 0, "needs at least core 0.6.0");
    const mine = m.settings.filter((s) => s.key.startsWith("transition"));
    assert.deepEqual(mine.map((s) => s.key), ["transitionIn", "transitionOut", "transitionSeconds"]);
    assert.deepEqual(mine, settingsBlock(spec.seconds));
    for (const s of mine) { assert.equal(s.rare, true, `${s.key} is folded under "More options"`); assert.ok(!s.advanced); }
    assert.deepEqual(mine[0].options.map((o) => o.value), ENTRANCES);
    assert.deepEqual(mine[1].options.map((o) => o.value), EXITS);
    assert.equal(mine[0].default, "auto"); assert.equal(mine[1].default, "same");
    assert.deepEqual([mine[2].min, mine[2].max], [0.2, 2]);
    const el = m.overlayElements.find((e) => e.id === spec.element);
    assert.deepEqual(el.options.filter((o) => o.id.startsWith("transition")), optionsBlock());
    for (const o of optionsBlock()) assert.equal(o.default, INHERIT);
    // Ergonomics (R10, R11, R19): short labels without a colon, short help, at most 10 choices in a list, never a typed key.
    const texts = [...Object.values(LABELS), ...mine.flatMap((s) => [s.label, s.help, ...(s.options ?? []).map((o) => o.label)]).filter(Boolean)];
    for (const t of texts) for (const l of ["fr", "en"]) { assert.ok(t[l] && t[l].length <= 60, t[l]); assert.ok(!/:|!/.test(t[l]), t[l]); }
    for (const s of mine.slice(0, 2)) assert.ok(s.options.length <= 10);
    const words = /\b(key|slug|token|webhook|route|payload|JSON|cache)\b/i;
    for (const t of texts) for (const l of ["fr", "en"]) assert.ok(!words.test(t[l]), t[l]);
  });
}

test("the sponsor banner: default config, setting, element option, hostile values", async () => {
  const tk = (await import("../modules/sponsor-ticker/index.mjs")).default;
  const ctx = (settings = {}) => fakeCtx({ key: "ticker", name: "T", locale: "fr", messages: messages("sponsor-ticker"), settings });
  assert.deepEqual(cfgOf(tk.overlay(ctx(), { query: new URLSearchParams() }).script), { in: "auto", out: "auto", ms: 600 });
  assert.deepEqual(cfgOf(tk.overlay(ctx({ transitionIn: "slideLeft", transitionOut: "slideBottom", transitionSeconds: 1 }), { query: frame() }).script), { in: "slideLeft", out: "slideBottom", ms: 1000 });
  assert.equal(cfgOf(tk.overlay(ctx({ transitionIn: "slideLeft" }), { query: frame("opt-transitionIn=fade") }).script).in, "fade", "the element option wins");
  assert.equal(cfgOf(tk.overlay(ctx({ transitionIn: "slideLeft" }), { query: frame("opt-transitionIn=module") }).script).in, "slideLeft");
  const hostile = tk.overlay(ctx(), { query: frame("opt-transitionIn=%22%3E%3C%2Fscript%3E&opt-transitionOut=x") });
  assert.deepEqual(cfgOf(hostile.script), { in: "auto", out: "auto", ms: 600 });
  assert.ok(hostile.css.includes("transform var(--tr-ms,.58s)"), "same timing as before when no length is set");
});

test("the scrolling banner: element and standalone pages read the same choices", async () => {
  const tb = (await import("../modules/ticker-overlay/index.mjs")).default;
  const ctx = (settings = {}) => fakeCtx({ key: "banner", name: "B", locale: "fr", messages: messages("ticker-overlay"), settings });
  const own = (script) => JSON.parse(script.match(/var tr=(\{[^}]*\})/)[1]);
  assert.deepEqual(own(tb.overlay(ctx(), { query: new URLSearchParams() }).script), { in: "auto", out: "auto", ms: 500 });
  assert.deepEqual(own(tb.overlay(ctx({ transitionIn: "jiggle" }), { query: new URLSearchParams() }).script), { in: "jiggle", out: "jiggle", ms: 500 });
  assert.equal(own(tb.overlay(ctx(), { query: frame("opt-transitionOut=pop") }).script).out, "pop");
  assert.ok(tb.overlay(ctx({ position: "top-right" }), { query: new URLSearchParams() }).script.includes('side:"right"'), "slide uses the anchored side");
});

test("alerts: with every choice on default the page keeps the single alPop animation and no helper", async () => {
  const al = (await import("../modules/alerts-overlay/index.mjs")).default;
  const ctx = (settings = {}) => fakeCtx({ key: "al", name: "A", locale: "fr", messages: messages("alerts-overlay"), settings });
  const plain = await al.overlay(ctx(), { query: new URLSearchParams() });
  assert.ok(plain.css.includes("animation:alPop var(--al-dur) ease-in-out forwards"));
  assert.ok(!plain.script.includes("ovTransition") && !plain.script.includes('"tr"'));
  for (const q of [new URLSearchParams(), frame()]) {
    const moved = await al.overlay(ctx({ transitionIn: "slideTop" }), { query: q });
    assert.ok(!moved.css.includes("animation:alPop var(--al-dur)"), "the card no longer has the one-shot animation");
    assert.ok(moved.script.includes("function ovTransition") && /"tr":\{"in":"slideTop"/.test(moved.script));
  }
});

// ── The client function, with a fake node (the real browser frames were looked at in headless Chrome) ──
function fakeNode(rect = { left: 100, right: 400, top: 40, bottom: 140 }) {
  const calls = [];
  const classes = new Set();
  return {
    calls, classes, style: {}, offsetWidth: 1,
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    getBoundingClientRect: () => rect,
    animate(frames, opts) { calls.push({ frames, opts }); return { finished: Promise.resolve(), cancel() {} }; },
  };
}
const withWindow = async (reduced, fn) => {
  const keep = { matchMedia: globalThis.matchMedia, window: globalThis.window };
  globalThis.matchMedia = () => ({ matches: reduced });
  globalThis.window = { innerWidth: 720, innerHeight: 180 };
  try { await fn(); } finally { globalThis.matchMedia = keep.matchMedia; globalThis.window = keep.window; }
};

test("ovTransition: directions, any anchor, exit leaves the node hidden", async () => {
  await withWindow(false, async () => {
    const dx = async (mode, phase = "in") => { const n = fakeNode(); await ovTransition(n, phase, mode, { ms: 600 }); return { n, f: n.calls[0].frames }; };
    const left = await dx("slideLeft");
    assert.match(left.f[0].transform, /translate\(-408px,0px\)/); assert.equal(left.f[1].transform, "none");
    assert.match((await dx("slideRight")).f[0].transform, /translate\(628px,0px\)/);   // 720 - 100 + 8
    assert.match((await dx("slideTop")).f[0].transform, /translate\(0px,-148px\)/);
    assert.match((await dx("slideBottom")).f[0].transform, /translate\(0px,148px\)/);   // 180 - 40 + 8
    const out = await dx("slideLeft", "out");
    assert.match(out.f[1].transform, /translate\(-408px/, "the exit goes back where it came from");
    assert.ok(!out.n.classes.has("on"), "hidden after the exit");
    const inn = await dx("fade"); assert.ok(inn.n.classes.has("on"), "shown after the entrance");
    // 'slide' = nearest edge: this node sits near the left edge.
    const near = fakeNode({ left: 10, right: 200, top: 40, bottom: 140 });
    await ovTransition(near, "in", "slide", { ms: 600, side: "right" });
    assert.match(near.calls[0].frames[0].transform, /translate\(-/);
    // centred in its frame: falls back to the element's own side.
    const centred = fakeNode({ left: 210, right: 510, top: 40, bottom: 140 });
    await ovTransition(centred, "in", "slide", { ms: 600, side: "right" });
    assert.match(centred.calls[0].frames[0].transform, /translate\(5\d\dpx/);
    // the transform kept while shown (a scale) is part of every frame
    const scaled = fakeNode(); await ovTransition(scaled, "in", "pop", { ms: 600, base: "scale(.8)", pop: 0.85 });
    assert.equal(scaled.calls[0].frames[0].transform, "scale(.8) scale(0.85)"); assert.equal(scaled.calls[0].frames[1].transform, "scale(.8)");
    // jiggle: wobbles, ends on the shown state; leaving wobbles then fades
    const j = await dx("jiggle"); assert.ok(j.f.length >= 4 && j.f.at(-1).opacity === 1);
    const jo = await dx("jiggle", "out"); assert.equal(jo.f.at(-1).opacity, 0); assert.ok(jo.f.some((f) => /rotate/.test(f.transform)));
  });
});

test("ovTransition: 'auto' only flips the class, 'none' is instant, no animation API means instant", async () => {
  await withWindow(false, async () => {
    const a = fakeNode(); await ovTransition(a, "in", "auto", {}); assert.equal(a.calls.length, 0); assert.ok(a.classes.has("on"));
    await ovTransition(a, "out", "auto", {}); assert.ok(!a.classes.has("on"));
    const n = fakeNode(); await ovTransition(n, "in", "none", {}); assert.equal(n.calls.length, 0); assert.ok(n.classes.has("on"));
    const old = fakeNode(); old.animate = undefined; await ovTransition(old, "in", "slideLeft", {}); assert.ok(old.classes.has("on"));
  });
});

test("ovTransition: reduced motion turns any movement into a short fade (or stays instant)", async () => {
  await withWindow(true, async () => {
    for (const mode of ["slideLeft", "slide", "jiggle", "pop"]) {
      const n = fakeNode(); await ovTransition(n, "in", mode, { ms: 1500 });
      const { frames, opts } = n.calls[0];
      assert.ok(opts.duration <= 200, mode);
      assert.ok(frames.every((f) => !/translate|rotate|scale\(/.test(f.transform)), `${mode} has no motion`);
      assert.deepEqual(frames.map((f) => f.opacity), [0, 1]);
    }
    const none = fakeNode(); await ovTransition(none, "in", "none", {}); assert.equal(none.calls.length, 0);
  });
});
