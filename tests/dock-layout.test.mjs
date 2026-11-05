// The control dock in a REAL browser: every tab in every live situation, at every size from a narrow OBS dock to a wide screen and a phone,
// light and dark, English and French. It asserts what the owner asked for: NO scrolling (page and inside), nothing clipped, every target big enough, readable contrast.
// Needs Chromium + Playwright (skipped, loudly, where they are missing). DOCK_SHOTS=/dir saves a screenshot per case; DOCK_SCENES=a,b and DOCK_FULL=1 narrow or widen the run.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { browser, closeBrowser, serve } from "./helpers/dockBrowser.mjs";
import { scene, SCENES } from "./helpers/dockScenes.mjs";
import { def as audDef, K as AK } from "./helpers/audienceHarness.mjs";

const b = await browser();
after(() => closeBrowser());
const skip = b ? false : "Chromium or Playwright not available here: the dock layout test did not run";
if (skip) console.error(`⚠ ${skip}`);

const VIEWPORTS = [[300, 420], [360, 640], [390, 844], [480, 900], [844, 390], [1280, 720]];
const SHOTS = process.env.DOCK_SHOTS || "";
const only = (process.env.DOCK_SCENES || "").split(",").filter(Boolean);
const scenes = SCENES.filter((s) => !only.length || only.includes(s));
const tabOf = (s) => (s.startsWith("poll") ? "poll" : s.startsWith("draw") ? "draw" : "chat");

/** What the page shows is measured in the page itself. */
const MEASURE = () => {
  const out = { page: [], inner: [], small: [], clipped: [], contrast: [], trunc: [] };
  const de = document.scrollingElement;
  const app = document.getElementById("app");
  out.page = [de.scrollHeight - innerHeight, de.scrollWidth - innerWidth, document.body.scrollHeight - innerHeight, document.body.scrollWidth - innerWidth, app.scrollWidth - app.clientWidth, app.scrollHeight - app.clientHeight, de.scrollLeft, de.scrollTop];
  for (const sel of [".view", ".chat", ".bd", ".acts", ".top", ".sheet", ".sheet .rows", ".people"]) for (const n of document.querySelectorAll(sel)) if (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1) out.inner.push(`${sel}:${n.scrollHeight}>${n.clientHeight}|${n.scrollWidth}>${n.clientWidth}`);
  const stage = document.getElementById("stage").getBoundingClientRect();
  const sh = document.querySelector(".sheet"); if (sh) { const done = sh.querySelector(".btn.primary").getBoundingClientRect(); for (const n of sh.querySelectorAll(".rows .fld")) if (n.getBoundingClientRect().bottom > done.top + 0.5) out.clipped.push("sheet field under Done: " + (n.querySelector("label,.seglab")?.textContent ?? "")); }
  for (const n of document.querySelectorAll("button, input:not([type=radio]), select, label[for]")) {
    const r = n.getBoundingClientRect();
    if (!r.width || n.closest("[hidden]") || getComputedStyle(n).display === "none") continue;
    const isLabel = n.tagName === "LABEL"; if (isLabel && !n.closest(".seg")) continue;
    const need = n.classList.contains("primary") ? 48 : 44;
    if (r.width < 44 - 0.5 || r.height < need - 0.5) out.small.push(`${n.className || n.tagName}:${Math.round(r.width)}x${Math.round(r.height)}`);
    if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5) out.clipped.push(`${n.className || n.tagName}@${Math.round(r.left)},${Math.round(r.top)}`);
    else if (n.closest(".stage") && (r.bottom > stage.bottom + 0.5 || r.right > stage.right + 0.5)) out.clipped.push(`${n.className}~stage`);
  }
  // a label of a button or a tab is never cut (R19): what is shown fits in its box
  for (const n of document.querySelectorAll(".btn .lb, .tab .tl, .panic span:not(.gl), .seg label, .win .nh, .btn.arm .col span, .sheet label")) {
    if (n.closest("[hidden]") || getComputedStyle(n).display === "none") continue;
    if (n.classList.contains("wn")) continue;   // a person's name may be long: it is cut with an ellipsis and complete in its tooltip
    if (n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1) out.trunc.push(`${n.textContent.slice(0, 24)}:${n.scrollWidth}>${n.clientWidth}`);
  }
  const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const ratio = (a, b2) => { const x = lum(a), y = lum(b2); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const sel of [".btn.primary", ".tab[aria-selected=true]", ".strip", ".ttl"]) {
    const n = document.querySelector(sel); if (!n) continue;
    const cs = getComputedStyle(n); let bg = cs.backgroundColor, el = n; while ((bg === "rgba(0, 0, 0, 0)" || bg === "transparent") && el.parentElement) { el = el.parentElement; bg = getComputedStyle(el).backgroundColor; }
    if (/^rgb/.test(bg) && /^rgb/.test(cs.color)) out.contrast.push([sel, Math.round(ratio(cs.color, bg) * 10) / 10]);
  }
  return out;
};

async function open(w, { dock = false, viewport, locale }) {
  await AK.ensureMeta(w.aud);
  const key = (await w.aud.api.store.list("meta")).find((r) => r.data.k === "cfg").data.remoteKey;
  const srv = await serve(audDef, w.aud);
  const ctx = await b.newContext({ viewport: { width: viewport[0], height: viewport[1] }, colorScheme: "dark", locale: locale === "fr" ? "fr-FR" : "en-US", hasTouch: !dock, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${srv.base}/m/audience/remote?k=${key}${dock ? "&dock=1" : ""}`);
  await page.waitForSelector(".tab", { timeout: 5000 });
  return { page, srv, ctx, errors, key, close: async () => { await ctx.close(); await srv.close(); } };
}

for (const locale of ["en", "fr"]) {
  test(`dock layout (${locale}): every scene fits every viewport without scrolling, nothing clipped, targets 44/48 px, readable`, { skip, timeout: 600_000 }, async () => {
    const report = [];
    for (const name of scenes) {
      const w = await scene(name, { locale });
      const tab = tabOf(name);
      const h = await open(w, { viewport: VIEWPORTS[0], locale });
      try {
        await h.page.click(`[data-tab="${tab}"]`);
        await h.page.waitForTimeout(150);
        for (const vp of VIEWPORTS) {
          for (const scheme of ["light", "dark"]) {
            await h.page.setViewportSize({ width: vp[0], height: vp[1] });
            await h.page.emulateMedia({ colorScheme: scheme });
            await h.page.waitForTimeout(60);
            const m = await h.page.evaluate(MEASURE);
            const id = `${locale}/${name}/${vp.join("x")}/${scheme}`;
            if (m.page.some((x) => x > 0)) report.push(`${id} page scrolls ${m.page}`);
            if (m.inner.length) report.push(`${id} content overflows ${m.inner.join(" ")}`);
            if (m.small.length) report.push(`${id} small targets ${m.small.join(" ")}`);
            if (m.clipped.length) report.push(`${id} clipped ${m.clipped.join(" ")}`);
            if (m.trunc.length) report.push(`${id} cut labels ${m.trunc.join(" | ")}`);
            for (const [sel, r] of m.contrast) if (r < (sel === ".ttl" ? 4.5 : 3)) report.push(`${id} contrast ${sel} ${r}`);
            if (SHOTS && (scheme === "dark" || vp[0] === 390)) { fs.mkdirSync(SHOTS, { recursive: true }); await h.page.screenshot({ path: path.join(SHOTS, `${locale}-${name}-${vp.join("x")}-${scheme}.png`) }); }
          }
        }
        assert.deepEqual(h.errors, [], `${name}: no script error`);
      } finally { await h.close(); }
    }
    assert.deepEqual(report, [], report.slice(0, 40).join("\n"));
  });
}

/* Interaction states must fit too: the "more options" sheet, a Confirm / Undo row, a field error, the offline line. */
test("dock layout: the more-options sheet, the confirm / undo row, a field error and the offline line fit without scrolling at the narrowest sizes", { skip, timeout: 120_000 }, async () => {
  const report = [];
  for (const locale of ["en", "fr"]) for (const vp of [[300, 420], [390, 844], [844, 390]]) {
    const check = async (h, label) => {
      const m = await h.page.evaluate(MEASURE), id = `${locale}/${label}/${vp.join("x")}`;
      if (m.page.some((x) => x > 0)) report.push(`${id} page scrolls ${m.page}`);
      if (m.inner.length) report.push(`${id} overflows ${m.inner.join(" ")}`);
      if (m.small.length) report.push(`${id} small ${m.small.join(" ")}`);
      if (m.clipped.length) report.push(`${id} clipped ${m.clipped.join(" ")}`);
      if (m.trunc.length) report.push(`${id} cut labels ${m.trunc.join(" | ")}`);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await h.page.screenshot({ path: path.join(SHOTS, `${locale}-state-${label}-${vp.join("x")}.png`) }); }
    };
    let h = await open(await scene("poll-idle", { locale }), { viewport: vp, locale });
    try {
      await h.page.click(".btn.primary"); await h.page.waitForTimeout(400); await check(h, "field-error");
      await h.page.click(".btn.more"); await h.page.waitForTimeout(150); await check(h, "sheet-poll");
      await h.page.click(".sheet .btn.primary"); await h.page.click('[data-tab="draw"]'); await h.page.waitForTimeout(150);
      await h.page.click(".btn.more"); await h.page.waitForTimeout(150); await check(h, "sheet-draw");
      await h.page.click(".sheet .btn.primary");
      await h.page.click("#panic"); await h.page.waitForTimeout(150); await check(h, "armed-panic");
      await h.page.click("button.undo");
      h.srv.down(true); await h.page.waitForSelector("#strip.bad", { timeout: 12_000 }); await check(h, "offline");
    } finally { await h.close(); }
    h = await open(await scene("poll-idle-last", { locale }), { viewport: vp, locale });
    try {   // the custom length: closed (with the 'Last' chip and a long last question), open, in error, and the question in the options sheet
      await check(h, "last-chips");
      await h.page.fill("input[name=a]", "Pizza"); await h.page.fill("input[name=b]", "Pasta"); await h.page.locator(".seg label", { hasText: /^(Other|Autre)$/ }).click(); await h.page.waitForTimeout(150); await check(h, "custom-open");
      await h.page.locator(".seg .cust").fill("2m 30 x"); await h.page.locator(".seg .cust").press("Enter"); await h.page.waitForTimeout(400); await check(h, "custom-error");
      await h.page.click(".btn.more"); await h.page.waitForTimeout(150); await check(h, "sheet-last");
    } finally { await h.close(); }
    for (const [name, tabId] of [["poll-run8", "poll"], ["poll-done8", "poll"], ["draw-drawn5", "draw"], ["chat", "chat"]]) {
      h = await open(await scene(name, { locale }), { viewport: vp, locale });
      try {
        await h.page.click(`[data-tab="${tabId}"]`); await h.page.waitForTimeout(150);
        const arm = await h.page.locator(tabId === "chat" ? ".btn.danger" : tabId === "draw" ? ".win" : ".row .btn.danger").first();
        await arm.click(); await h.page.waitForTimeout(150); await check(h, `armed-${name}`);
      } finally { await h.close(); }
    }
  }
  assert.deepEqual(report, [], report.slice(0, 30).join("\n"));
});
