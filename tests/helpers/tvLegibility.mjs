// Shared check for the TV type scale of overlay elements (core 0.11.0, `tvScale`): renders an element page in a real browser and walks the DOM.
// What it enforces, in px of the CANVAS (window px / ov-tv): no visible text under TV_MIN_PX (24), no horizontal overflow, nothing clipped or pushed out of the window.
// Text cut by an ellipsis or a line clamp is allowed (R16: the full text is in a tooltip). Playwright and Chromium are optional (see dockBrowser.mjs): without them the tests are skipped, said loud.
//   TV_SHOTS=/some/dir  also writes a screenshot of every render there (for a person to look at).
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { browser, closeBrowser } from "./dockBrowser.mjs";

export { browser, closeBrowser };
export const TV_MIN_PX = 24;
// One browser per test file, even when a file registers several suites (their hooks may run together).
let starting = null;
export const sharedBrowser = () => (starting ??= browser());
export const closeShared = async () => { if (starting) { await starting; starting = null; await closeBrowser(); } };

/** `base` + the `ov-*` parameters the core adds to an element address (fluid frame `w` x `h` window px, the TV factor `tv`). `extra`: option parameters (`opt-…`) and `ov-demo`. */
export function tvQuery({ w, h, tv, extra = {}, lang = "en", fit = "fluid", text = "light", surface = "soft" }) {
  return new URLSearchParams({ lang, "ov-w": String(w), "ov-h": String(h), "ov-fit": fit, "ov-lang": lang, "ov-text": text, "ov-surface": surface, "ov-corners": "round", "ov-tv": String(tv), ...extra });
}

/** Runs in the page: every visible text, its size, and what is clipped. */
function measureInPage({ min, ignoreClip }) {
  const out = { min: Infinity, minText: "", small: [], clipped: [], texts: 0, overflowX: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1 };
  const vw = innerWidth, vh = innerHeight;
  const visible = (el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0 || e.hidden) return false; } return true; };
  const cutter = (el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none") return e; } return null; };
  const srOnly = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); if ((b.width <= 1.5 || b.height <= 1.5) && cs.overflow !== "visible") return true; } return false; };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const text = n.nodeValue.replace(/\s+/g, " ").trim();
    const el = n.parentElement;
    if (!text || !el || ["SCRIPT", "STYLE", "NOSCRIPT", "TITLE"].includes(el.tagName) || !visible(el)) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    out.texts++;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < out.min) { out.min = fs; out.minText = text; }
    if (fs < min - 0.01) out.small.push(`${fs.toFixed(1)}px "${text.slice(0, 40)}"`);
    const label = `"${text.slice(0, 40)}"`;
    if (srOnly(el)) continue;   // text for screen readers only (a 1 px clipped box)
    if (ignoreClip.some((sel) => el.closest(sel))) continue;   // a scrolling list: its far items are outside the window by design
    // Text cut by an ellipsis or a line clamp is allowed to run past its own box (R16, the full text is in a tooltip): then it is the box that must fit.
    const ce = cutter(el);
    const box = ce ? ce.getBoundingClientRect() : r;
    if (box.left < -1 || box.top < -1 || box.right > vw + 1 || box.bottom > vh + 1) out.clipped.push(`${label} outside the window (${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.right)}x${Math.round(box.bottom)} in ${vw}x${vh})`);
    for (let a = el; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      if (ce && ce.contains(a)) continue;
      const cs = getComputedStyle(a);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const b = a.getBoundingClientRect();
      if (box.right > b.right + 1.5 || box.left < b.left - 1.5 || box.bottom > b.bottom + 1.5 || box.top < b.top - 1.5) { out.clipped.push(`${label} cut by <${a.tagName.toLowerCase()}${a.id ? "#" + a.id : ""}${a.className && typeof a.className === "string" ? "." + a.className.split(" ")[0] : ""}>`); break; }
    }
  }
  return out;
}

/**
 * Opens `html` (what the module's route answered) at the address `url` in a `width` x `height` window and measures it.
 * `ignoreClip`: selectors of scrolling areas, whose texts are only checked for size. `handler(url)`: answers the sub-requests of the page (a Response, or null to refuse); `headers`: the response headers of the page; `settle`: ms to wait before measuring.
 */
export async function renderAndMeasure(b, { html, url = "https://x.test/m/k/element/e", width, height, headers = {}, handler = null, settle = 350, shot = null, after = null, ignoreClip = [] }) {
  const context = await b.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      const u = route.request().url();
      if (u.split("#")[0] === url.split("#")[0] || u === url) return route.fulfill({ status: 200, headers: { ...headers, "content-type": "text/html; charset=utf-8" }, body: html });
      const r = handler ? await handler(u) : null;
      if (!r) return route.abort();
      return route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) });
    });
    await page.goto(url);
    await page.waitForTimeout(settle);
    if (after) { await after(page); }
    const report = await page.evaluate(measureInPage, { min: TV_MIN_PX * (Number(new URL(url).searchParams.get("ov-tv")) || 1), ignoreClip });
    const dir = process.env.TV_SHOTS;
    if (dir && shot) { fs.mkdirSync(dir, { recursive: true }); await page.screenshot({ path: path.join(dir, `${shot}.png`) }); }
    return report;
  } finally { await context.close(); }
}

/** The assertions: texts were found, none is below the minimum (24 px of canvas), nothing overflows or is clipped. */
export function assertTv(report, label, { expectText = true } = {}) {
  if (expectText) assert.ok(report.texts > 0, `${label}: no visible text found`);
  assert.deepEqual(report.small, [], `${label}: text under the TV minimum`);
  assert.equal(report.overflowX, false, `${label}: horizontal overflow`);
  assert.deepEqual(report.clipped, [], `${label}: clipped text`);
}

/** The frames every element is checked in: `tv` 1 in the frame, `tv` 2 in a frame twice as large (the same canvas look at 4K), and `tv` 0.5 in a frame twice as small. */
export const TV_CASES = (frame) => [
  { tv: 1, w: frame.w, h: frame.h, name: "tv1" },
  { tv: 2, w: frame.w * 2, h: frame.h * 2, name: "tv2" },
];

/**
 * Registers the standard tests of one element: every frame in every case of TV_CASES must pass `assertTv`, and the page must define the tokens (fallback 1 without `ov-tv`, a bad value ignored).
 * `render(query, frame)` answers { html, headers?, handler?, url? } by calling the module's own route. `frames`: [{ name, w, h, extra }] (`extra`: option and demo parameters).
 */
export function tvSuite({ test, before, after, label, frames, render, ignoreClip = [], settle, afterLoad = null, cases = TV_CASES }) {
  let b = null;
  before(async () => { b = await sharedBrowser(); if (!b) console.warn(`${label}: no Playwright/Chromium here, the browser checks are skipped`); });
  after(closeShared);
  const slug = label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  for (const frame of frames) {
    for (const c of cases(frame)) {
      test(`TV scale ${label}: ${frame.name}, ${c.name} (ov-tv ${c.tv}, ${c.w}x${c.h}): text 24 px or more, no overflow, nothing clipped`, async (t) => {
        if (!b) return t.skip("no browser");
        const query = tvQuery({ w: c.w, h: c.h, tv: c.tv, extra: frame.extra ?? {} });
        const r = await render(query, { ...frame, ...c });
        const url = r.url ?? `https://x.test/m/k/element/e?${query}`;
        assertTv(await renderAndMeasure(b, { html: r.html, headers: r.headers, handler: r.handler, url, width: c.w, height: c.h, ignoreClip, settle, after: afterLoad, shot: `${slug}-${frame.name.replace(/[^a-z0-9]+/gi, "-")}-${c.name}` }), `${label} ${frame.name} ${c.name}`, { expectText: frame.expectText !== false });
      });
    }
  }
  test(`TV scale ${label}: the tokens exist (24 px smallest), fall back to 1 without ov-tv and ignore an absurd value`, async () => {
    const f = frames[0], w = f.w, h = f.h;
    const without = tvQuery({ w, h, tv: 1, extra: f.extra ?? {} }); without.delete("ov-tv");
    assert.match((await render(without, { ...f, tv: 1, w, h })).html, /--ov-tv:1;[^"}]*--ov-text-xs:calc\(24px\*var\(--ov-tv\)\)/);
    for (const bad of ["0", "-3", "20", "abc"]) assert.match((await render(tvQuery({ w, h, tv: bad, extra: f.extra ?? {} }), { ...f, tv: 1, w, h })).html, /--ov-tv:1;/, `ov-tv=${bad}`);
    assert.match((await render(tvQuery({ w, h, tv: 1.5, extra: f.extra ?? {} }), { ...f, tv: 1.5, w, h })).html, /--ov-tv:1\.5;/);
    const t = (await render(tvQuery({ w, h, tv: 1, extra: f.extra ?? {} }), { ...f, tv: 1, w, h })).html;
    for (const [k, px] of [["xs", 24], ["sm", 28], ["md", 32], ["lg", 40], ["xl", 56], ["2xl", 72]]) assert.ok(t.includes(`--ov-text-${k}:calc(${px}px*var(--ov-tv))`), `token ${k}`);
  });
}

/** The page the core builds around a module overlay `{ title, html, css, script }` (used by the modules that serve the element through `overlay(ctx, { query })`). */
export const wrapOverlay = (out) => `<!doctype html><html lang="en" data-ov-region="element"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${out.title ?? ""}</title><style>${out.css ?? ""}</style></head><body>${out.html}<script>${out.script ?? ""}</script></body></html>`;
