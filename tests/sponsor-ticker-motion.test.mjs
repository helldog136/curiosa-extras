// Sponsor banner motion (docs/SPONSOR-MOTION-AUDIT.md): dedicated entrance / exit curves, idle loops that wait for the landing and stop when hidden,
// follow-through of the content, a reduced-motion path that keeps timing and opacity, and no paint work that never shows.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const DIR = new URL("../modules/sponsor-ticker", import.meta.url).pathname;
const mod = await import("../modules/sponsor-ticker/index.mjs");
const { ENTER_CURVE, EXIT_CURVE, FLOAT, SHINE, STAGGER } = mod;
const messages = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const page = (settings = {}, query = "") => mod.default.overlay(fakeCtx({ key: "ticker", name: "T", locale: "en", messages, settings }), { query: new URLSearchParams(query) });
const ELEMENT = "ov-w=720&ov-h=180&ov-fit=scale&ov-surface=soft&ov-text=light&ov-corners=round";
const rule = (css, selector) => css.match(new RegExp(`(?:^|[}\\n])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^}]*)\\}`))?.[1] ?? "";
const bezier = (s) => s.match(/cubic-bezier\(([^)]+)\)/)[1].split(",").map(Number);

/** Value of a CSS cubic-bezier at x (Newton, enough for a test). */
function curve([x1, y1, x2, y2]) {
  const f = (a, b) => (t) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  const X = f(x1, x2), Y = f(y1, y2);
  return (x) => { let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (X(m) < x) lo = m; else hi = m; } return Y((lo + hi) / 2); };
}

test("entrance curve: fast start, at most 5 % overshoot (as before), velocity 0 on the last frame", () => {
  const [x1, y1, x2, y2] = bezier(ENTER_CURVE), y = curve([x1, y1, x2, y2]);
  assert.equal(y2, 1, "the last handle is horizontal: the card stops, it does not snap");
  assert.ok(y1 / x1 >= 3, "starts fast");
  const peak = Math.max(...Array.from({ length: 200 }, (_, i) => y((i + 1) / 200)));
  assert.ok(peak > 1.01 && peak <= 1.05, `overshoot ${((peak - 1) * 100).toFixed(1)} %`);
  assert.ok(Math.abs(y(1) - y(0.995)) * 200 < 0.02, "velocity at the end is ~0");
  assert.ok(y(0.5) >= 0.9, "most of the travel is done by half time");
});

test("exit curve: soft start, crisp end, never past the target", () => {
  const [x1, y1, x2, y2] = bezier(EXIT_CURVE), y = curve([x1, y1, x2, y2]);
  assert.equal(y1, 0, "soft start");
  assert.ok((1 - y2) / (1 - x2) > 1.5, "ends faster than the average speed");
  for (let i = 0; i <= 100; i++) assert.ok(y(i / 100) <= 1.0001);
  assert.ok(y(0.2) < 0.1, "barely moved after a fifth of the time");
  assert.notEqual(ENTER_CURVE, EXIT_CURVE, "the exit no longer replays the entrance curve");
});

for (const [label, query] of [["standalone", ""], ["page element", ELEMENT]]) {
  test(`${label}: entrance and exit use their own curves, the exit fades out in step with the slide`, () => {
    const css = page({}, query).css;
    const base = rule(css, ".ticker-slider"), on = rule(css, ".ticker-slider.on");
    assert.ok(base.includes(`transform var(--tr-ms,.58s) ${EXIT_CURVE}`), "leaving state carries the exit curve");
    assert.ok(on.includes(`transform var(--tr-ms,.58s) ${ENTER_CURVE}`), "shown state carries the entrance curve");
    assert.match(base, /opacity calc\(var\(--tr-ms,\.58s\)\*\.7\).*calc\(var\(--tr-ms,\.58s\)\*\.3\)/, "fade ends with the slide");
    assert.match(base, /transform:translateX\(135%\) scale\(var\(--tk-s,1\)\)/);
    assert.ok(on.includes("opacity var(--tr-fade,.45s) ease"), "entrance fade unchanged");
  });
}

test("paint work: no shadow clipped away by the card's clip-path, blur only where the surface can be see-through", () => {
  const std = page().css, el = page({}, ELEMENT).css;
  assert.ok(/clip-path:polygon/.test(rule(std, ".ticker-card")));
  assert.ok(!/box-shadow/.test(rule(std, ".ticker-card")) && !/box-shadow/.test(rule(std, ".ticker-card--neon")), "a box-shadow under a clip-path is never visible");
  assert.ok(!/backdrop-filter/.test(std), "the standalone surface is an opaque theme colour: the blur never shows");
  assert.ok(/\.ticker-card--cine,\.ticker-card--neon\{backdrop-filter:blur\(10px\)\}/.test(el), "the page element keeps its frosted look");
  assert.ok(/box-shadow:0 0 16px/.test(rule(std, ".ticker-bar")), "the visible accent glow of the bar stays");
});

test("idle loops: two at most, decoupled, they wait for the landing and keep the first key during the wait", () => {
  const css = page().css;
  const periods = [FLOAT, SHINE].map((a) => Number(a.match(/ ([\d.]+)s /)[1]));
  assert.deepEqual(periods, [4.6, 11]);
  assert.ok(Math.abs(periods[1] / periods[0] - Math.round(periods[1] / periods[0])) > 0.2, "periods are not multiples of each other");
  for (const a of [FLOAT, SHINE]) { assert.match(a, /var\(--tr-ms,\.58s\)/, "delayed by the length of the entrance"); assert.match(a, /infinite backwards$/); }
  assert.ok(rule(css, ".ticker-shine").includes(SHINE));
  assert.deepEqual([...new Set([...css.matchAll(/animation:(\w+) [^;}]*infinite/g)].map((m) => m[1]))].sort(), ["tickerFloat", "tickerShine"], "float and shine only");
  assert.match(css, /\.ticker-slider\.tk-idle \.ticker-card,\.ticker-slider\.tk-idle \.ticker-shine\{animation-play-state:paused\}/);
  assert.match(css, /27\.3%,100%\{transform:translateX\(430%\)\}/, "one 3 s sweep per 11 s");
  const qr = page({ showQr: true }).css;
  assert.match(qr, /\.ticker-card--qr\{animation:none\}/, "the banner stays still while a QR code is shown");
});

test("content follow-through: about 2 frames per step, few pieces, short total, QR by opacity only", () => {
  assert.ok(STAGGER.length <= 6);
  const delays = STAGGER.map((s) => s[1]);
  for (let i = 1; i < delays.length; i++) assert.ok(delays[i] - delays[i - 1] <= 60 && delays[i] > delays[i - 1]);
  assert.ok(delays.at(-1) + 260 <= 600, "the whole cascade stays under 600 ms");
  assert.equal(STAGGER.find((s) => s[0].includes("ticker-qr"))[2], 0, "no travel for the QR plate: it must stay pixel-aligned");
  const { script } = page();
  assert.ok(script.includes("function follow(card)") && script.includes("function tune(phase,mode)"));
  assert.ok(script.includes(JSON.stringify(STAGGER)));
  new vm.Script(script);
  new vm.Script(page({ showQr: false, transitionIn: "jiggle" }, ELEMENT).script);
});

test("idle state: the page stops the loops after the exit and restarts them on the next entrance", () => {
  const { script } = page();
  assert.match(script, /classList\.add\("tk-idle"\)/);
  assert.match(script, /classList\.remove\("tk-idle"\);follow\(cur\)/);
  assert.match(script, /c\.tr\.ms\*1\.3\+80/, "waits for the longest exit (jiggle is 1.3 x)");
});

test("reduced motion: no travel and no loops, but the same timing and an opacity fade in and out", () => {
  const css = page().css, media = css.match(/@media \(prefers-reduced-motion:reduce\)\{(.*?\})\}/s)?.[1] ?? "";
  assert.ok(media.includes(".ticker-card,.ticker-shine{animation:none}"));
  assert.match(media, /\.ticker-slider,\.ticker-slider\.on\{transform:scale\(var\(--tk-s,1\)\)\}/, "no translateX offset");
  assert.match(media, /\.ticker-slider\{transition:opacity calc\(var\(--tr-ms,\.58s\)\*\.7\)/, "leaves with a fade of the configured length");
  assert.match(media, /\.ticker-slider\.on\{transition:opacity var\(--tr-fade,\.45s\) ease\}/, "enters with a fade of the configured length");
  assert.ok(!/transition:none/.test(media), "never switched off: the streaming PC is not the audience");
  assert.match(page().script, /var calm=typeof matchMedia==="function"&&matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
});

test("options and defaults keep working: same settings, same transition config, same default length", () => {
  const cfg = (s, q = "") => JSON.parse(page(s, q).script.match(/^\(function\(\)\{var c=(\{.*?\}),slider=/s)[1]).tr;
  assert.deepEqual(cfg({}), { in: "auto", out: "auto", ms: 600 });
  assert.deepEqual(cfg({ transitionIn: "slideLeft", transitionOut: "fade", transitionSeconds: 1.2 }), { in: "slideLeft", out: "fade", ms: 1200 });
  assert.ok(page({ transitionSeconds: 1.2 }).script.includes('setProperty("--tr-ms"'));
});
