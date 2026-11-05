// Twitch raid 2.3: both docks in a REAL browser (Chromium through Playwright), at every size from a narrow OBS dock to a wide screen and a phone, light and dark, English and French.
// It asserts what the owner asked of a dock: the PAGE never scrolls, the main action is visible, a few partners fit without any scrolling inside, nothing clipped, targets at least 44 px
// (48 for the main action), same-height rows, readable contrast, a clear offline state, a 3-second Confirm / Undo, and no request while the page is hidden. Invented names only.
// Skipped, loudly, where Chromium or Playwright are missing. DOCK_SHOTS=/dir saves a screenshot per case.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { browser, closeBrowser, serve } from "./helpers/dockBrowser.mjs";
import { world, logins, en, fr } from "./helpers/twitch-raid-world.mjs";
import { moduleAdminTheme } from "@/core/adminTheme";

const def = (await import("../modules/twitch-raid/index.mjs")).default;
const data = await import("../modules/twitch-raid/data.mjs");
const live = await import("../modules/twitch-raid/live.mjs");
const moment = await import("../modules/twitch-raid/moment.mjs");
const search = await import("../modules/twitch-raid/search.mjs");
const source = await import("../modules/twitch-raid/source.mjs");

const b = await browser();
after(() => closeBrowser());
const skip = b ? false : "Chromium or Playwright not available here: the raid dock layout test did not run";
if (skip) console.error(`⚠ ${skip}`);

const VIEWPORTS = [[300, 420], [360, 640], [390, 844], [480, 900], [844, 390], [1280, 720]];
const SHOTS = process.env.DOCK_SHOTS || "";
const NAMES = ["etoile_nord", "lune_douce", "Camille", "brume_claire", "sapin_bleu", "Noisette", "vent_leger", "Alix", "mousse_verte", "Louise_b", "pluie_fine", "cerise_rouge"];
const GAMES = ["Moss", "Celeste", "Hades", "Hollow Knight", "Tunic", "Inscryption", "A Short Hike", "Dave the Diver"];
const LONG_NAME = "etoile_nord_de_la_grande_ourse_bleue";
const LONG_TITLE = "A very long stream title that goes on and on about nothing in particular, to check that it is cut with an ellipsis and never breaks the row";

/** A site with `n` partners live (invented names, mixed viewers, one long name and one long title). */
function site({ locale, n = 5, listed = n, hidden = [] }) {
  live.resetLive(); search.resetSearch(); source.resetSource(); moment.resetMoment();
  const partners = Array.from({ length: listed }, (_, i) => ({ login: (NAMES[i] ?? `ami_${i}`).toLowerCase(), name: i === 1 ? LONG_NAME : NAMES[i] ?? `ami_${i}` }));
  const liveMap = {};
  for (let i = 0; i < n; i++) liveMap[partners[i].login] = { name: partners[i].name, viewers: [12, 3, 40, 1, 150, 8, 22, 5, 9, 2, 61, 17][i % 12], minutes: 5 + i * 17, game: GAMES[i % GAMES.length], title: i === 2 ? LONG_TITLE : `Playing ${GAMES[i % GAMES.length]} tonight` };
  const w = world({ partners, live: liveMap, settings: { count: 5, duration: 10 }, ...(locale === "en" ? { locale: "en", messages: { ...en } } : {}) });
  w.ctx.api.adminTheme = (o) => moduleAdminTheme(o);
  return w;
}

const MEASURE = () => {
  const out = { page: [], small: [], clipped: [], trunc: [], contrast: [], rows: [], stage: 0 };
  const de = document.scrollingElement, app = document.getElementById("app");
  out.page = [de.scrollHeight - innerHeight, de.scrollWidth - innerWidth, document.body.scrollHeight - innerHeight, app.scrollWidth - app.clientWidth, app.scrollHeight - app.clientHeight, de.scrollLeft, de.scrollTop];
  const st = document.getElementById("stage"); out.stage = st.scrollHeight - st.clientHeight;
  for (const n of document.querySelectorAll("button, select, input")) {
    const r = n.getBoundingClientRect();
    if (!r.width || n.closest("[hidden]") || getComputedStyle(n).display === "none") continue;
    const need = n.classList.contains("primary") || n.classList.contains("undo") ? 48 : 44;
    if (r.width < 44 - 0.5 || r.height < need - 0.5) out.small.push(`${n.id || n.className}:${Math.round(r.width)}x${Math.round(r.height)}`);
    if (!n.closest("#list") && (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5)) out.clipped.push(`${n.id || n.className}@${Math.round(r.left)},${Math.round(r.top)}`);
  }
  // what is a label or a sentence is never cut; names, games and titles of channels are data: cut with an ellipsis (and complete in the tooltip)
  for (const n of document.querySelectorAll(".primary .label, .primary .loss, .undo, .msg-main, .msg-hint, .banner, #updated, h1 span:first-child, .manual label, .toast")) {
    if (n.closest("[hidden]") || getComputedStyle(n).display === "none") continue;
    if (n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1) out.trunc.push(`${n.textContent.slice(0, 24)}:${n.scrollWidth}>${n.clientWidth}`);
  }
  const rows = [...document.querySelectorAll("#list .row")].map((n) => n.getBoundingClientRect());
  out.rows = [...new Set(rows.map((r) => Math.round(r.height)))];
  for (const r of document.querySelectorAll("#list .row")) { const q = r.getBoundingClientRect(); if (q.bottom > document.getElementById("stage").getBoundingClientRect().bottom + 0.5 && out.stage <= 0) out.clipped.push("row below the stage"); }
  const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const ratio = (a, c) => { const x = lum(a), y = lum(c); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => { let bg = getComputedStyle(el).backgroundColor, e = el; while ((bg === "rgba(0, 0, 0, 0)" || bg === "transparent") && e.parentElement) { e = e.parentElement; bg = getComputedStyle(e).backgroundColor; } return bg; };
  for (const sel of [".primary", "#list .m", "#list .n", "#list .v", ".strip", ".msg-hint", "h1"]) {
    const n = document.querySelector(sel); if (!n || n.closest("[hidden]")) continue;
    const cs = getComputedStyle(n), bg = bgOf(n);
    if (/^rgb/.test(bg) && /^rgb/.test(cs.color)) out.contrast.push([sel, Math.round(ratio(cs.color, bg) * 10) / 10]);
  }
  return out;
};

async function open(w, route, { viewport, locale, scheme = "dark", param = scheme, extra = "", onRequest } = {}) {
  const k = await data.dockSecret(w.ctx);
  const srv = await serve(def, w.ctx, { onRequest });
  const ctx = await b.newContext({ viewport: { width: viewport[0], height: viewport[1] }, colorScheme: scheme, locale: locale === "fr" ? "fr-FR" : "en-US", hasTouch: false, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !/503|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${srv.base}/m/${w.ctx.instance.key}/${route}?k=${k}${param ? `&scheme=${param}` : ""}${extra}`);
  return { page, srv, ctx, errors, close: async () => { await ctx.close(); await srv.close(); } };
}

const SCENES = [
  { name: "live3", route: "dock", n: 3, fits: true },
  { name: "live5", route: "dock", n: 5, fits: true },
  { name: "live12", route: "dock", n: 12, fits: false },
  { name: "empty", route: "dock", n: 0, fits: true },
  { name: "random", route: "dock", n: 0, listed: 520, fits: true },
  { name: "picks5", route: "featured", n: 8, fits: true },
  { name: "picks-empty", route: "featured", n: 0, fits: true },
];

for (const locale of ["en", "fr"]) {
  test(`raid dock layout (${locale}): every scene fits every size without scrolling the page, nothing clipped, targets 44/48 px, same-height rows, readable`, { skip, timeout: 600_000 }, async () => {
    const report = [];
    for (const sc of SCENES) {
      const w = site({ locale, n: sc.n, listed: sc.listed ?? Math.max(sc.n, 3) });
      for (const scheme of ["light", "dark"]) {
        const h = await open(w, sc.route, { viewport: VIEWPORTS[0], locale, scheme });
        try {
          await h.page.waitForSelector(sc.n || sc.listed ? "#list:not([hidden]), #msg:not([hidden])" : "#msg:not([hidden])", { timeout: 8000 });
          await h.page.waitForTimeout(250);
          for (const vp of VIEWPORTS) {
            await h.page.setViewportSize({ width: vp[0], height: vp[1] });
            await h.page.waitForTimeout(60);
            const m = await h.page.evaluate(MEASURE), id = `${locale}/${sc.name}/${vp.join("x")}/${scheme}`;
            if (m.page.some((x) => x > 0)) report.push(`${id} page scrolls ${m.page}`);
            if (sc.fits && m.stage > 0) report.push(`${id} the list scrolls inside by ${m.stage}px`);
            if (m.small.length) report.push(`${id} small targets ${m.small.join(" ")}`);
            if (m.clipped.length) report.push(`${id} clipped ${m.clipped.join(" ")}`);
            if (m.trunc.length) report.push(`${id} cut labels ${m.trunc.join(" | ")}`);
            if (m.rows.length > 1) report.push(`${id} uneven rows ${m.rows}`);
            for (const [sel, r] of m.contrast) if (r < (sel === ".primary" ? 3 : 4.5)) report.push(`${id} contrast ${sel} ${r}`);
            if (SHOTS && (scheme === "dark" || vp[0] === 390)) { fs.mkdirSync(SHOTS, { recursive: true }); await h.page.screenshot({ path: path.join(SHOTS, `${locale}-${sc.name}-${vp.join("x")}-${scheme}.png`) }); }
          }
          assert.deepEqual(h.errors, [], `${sc.name}: no script error`);
        } finally { await h.close(); }
      }
    }
    assert.deepEqual(report, [], report.slice(0, 40).join("\n"));
  });
}

test("raid dock: the look follows the administration (dark by default whatever the device says, ?scheme=light forces light), the tokens give the accent, the font and the radius", { skip, timeout: 60_000 }, async () => {
  const w = site({ locale: "en", n: 3 });
  const read = async (device, param) => {
    const h = await open(w, "dock", { viewport: [390, 600], locale: "en", scheme: device, param });
    try {
      await h.page.waitForSelector("#list:not([hidden])");
      return await h.page.evaluate(() => { const cs = getComputedStyle(document.body), root = getComputedStyle(document.documentElement), p = getComputedStyle(document.getElementById("rand")); return { bg: cs.backgroundColor, font: cs.fontFamily, accent: p.backgroundColor, radius: p.borderRadius, focus: root.getPropertyValue("--cur-focus").trim() }; });
    } finally { await h.close(); }
  };
  const bareOnLightDevice = await read("light", null), bareOnDarkDevice = await read("dark", null), forcedLight = await read("dark", "light"), forcedDark = await read("light", "dark");
  assert.equal(bareOnLightDevice.bg, "rgb(21, 20, 26)", "no ?scheme=: dark, even on a light device (OBS is dark)");
  assert.equal(bareOnDarkDevice.bg, "rgb(21, 20, 26)"); assert.equal(forcedDark.bg, "rgb(21, 20, 26)");
  assert.equal(forcedLight.bg, "rgb(250, 247, 242)", "?scheme=light forces light");
  assert.equal(bareOnLightDevice.accent, "rgb(155, 140, 255)"); assert.equal(forcedLight.accent, "rgb(108, 92, 231)");
  assert.match(bareOnLightDevice.font, /ui-sans-serif|system-ui/); assert.equal(bareOnLightDevice.radius, "8px");
  assert.equal(bareOnLightDevice.focus, "#9b8cff");
});

test("raid dock: nothing is asked while the page is hidden, and it picks up again as soon as it is shown", { skip, timeout: 60_000 }, async () => {
  const w = site({ locale: "en", n: 3 });
  let lives = 0;
  const h = await open(w, "dock", { viewport: [390, 600], locale: "en", onRequest: (name) => { if (name === "live") lives++; } });
  try {
    // the real timers are 45 s: the page's waits are shortened 100 times here so that the test sees several turns in a few seconds
    await h.page.close();
    h.page = await h.ctx.newPage();
    await h.page.addInitScript(() => { const st = window.setTimeout; window.setTimeout = (fn, ms, ...a) => st(fn, ms >= 20000 && ms <= 47000 ? ms / 100 : ms, ...a); });
    const k = await data.dockSecret(w.ctx);
    await h.page.goto(`${h.srv.base}/m/${w.ctx.instance.key}/dock?k=${k}&scheme=dark`);
    await h.page.waitForSelector("#list:not([hidden])");
    await h.page.waitForTimeout(1800);
    const running = lives; assert.ok(running >= 3, `it keeps asking while shown (${running})`);
    await h.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
    await h.page.waitForTimeout(300); const atHide = lives;
    await h.page.waitForTimeout(1800);
    assert.equal(lives, atHide, "no request at all while hidden");
    await h.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
    await h.page.waitForTimeout(1500);
    assert.ok(lives > atHide, "asks again once shown");
  } finally { await h.close(); }
});

test("raid dock: a lost connection is said in words (Offline) with the last list kept, and it comes back by itself", { skip, timeout: 60_000 }, async () => {
  for (const locale of ["en", "fr"]) {
    const w = site({ locale, n: 3 }); const T = locale === "en" ? en : fr;
    const h = await open(w, "dock", { viewport: [300, 420], locale });
    try {
      await h.page.waitForSelector("#list:not([hidden])");
      assert.equal(await h.page.locator("#strip.off").count(), 0);
      h.srv.down(true); await h.page.click("#refresh");
      await h.page.waitForSelector("#strip.off", { timeout: 20_000 });
      assert.equal((await h.page.textContent("#updated")).trim(), T.dock_offline);
      assert.equal(await h.page.locator("#list .row").count(), 3, "the last known list stays");
      assert.ok(await h.page.locator("#banner").isVisible(), "and the sentence says what to expect");
      const m = await h.page.evaluate(MEASURE);
      assert.deepEqual([m.page.some((x) => x > 0), m.small, m.clipped, m.trunc], [false, [], [], []]);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await h.page.screenshot({ path: path.join(SHOTS, `${locale}-offline-300x420.png`) }); }
      h.srv.down(false); await h.page.click("#refresh");
      await h.page.waitForSelector("#strip:not(.off)", { timeout: 20_000 });
      assert.ok(!(await h.page.locator("#banner").isVisible()));
    } finally { await h.close(); }
  }
});

test("raid dock: a click on a partner copies its command on a row that keeps its height (the confirmation takes the place of the second line)", { skip, timeout: 60_000 }, async () => {
  const w = site({ locale: "en", n: 4 });
  const h = await open(w, "dock", { viewport: [300, 420], locale: "en" });
  try {
    await h.ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await h.page.waitForSelector("#list .row");
    const before = await h.page.evaluate(() => [...document.querySelectorAll("#list li")].map((l) => Math.round(l.getBoundingClientRect().height)));
    await h.page.locator("#list .row").first().click();
    await h.page.waitForSelector("#list li.copied, #manual:not([hidden])", { timeout: 5000 });
    const after = await h.page.evaluate(() => [...document.querySelectorAll("#list li")].map((l) => Math.round(l.getBoundingClientRect().height)));
    assert.deepEqual(after, before, "no row grows or shrinks");
    const shown = await h.page.evaluate(() => (document.querySelector("#list li.copied .c") || document.getElementById("manual-input"))?.textContent || document.getElementById("manual-input").value);
    assert.match(shown, /\/raid /);
    // nothing is ever launched from here: the only requests are reads
    assert.ok(h.errors.length === 0);
  } finally { await h.close(); }
});

test("raid dock: 'Draw again' replaces the picks for everyone, so it takes one tap and a 3-second Confirm / Undo on the SAME button; nothing is sent before the confirmation", { skip, timeout: 120_000 }, async () => {
  for (const locale of ["en", "fr"]) {
    const T = locale === "en" ? en : fr;
    const w = site({ locale, n: 8 });
    const posts = [];
    const h = await open(w, "featured", { viewport: [300, 420], locale, onRequest: (name, req) => { if (name === "featured-again") posts.push(req.method); } });
    try {
      await h.page.waitForSelector("#list .row");
      const state = async () => ({ label: (await h.page.textContent("#again .label")).trim(), arm: await h.page.locator("#again.arm").count(), undo: await h.page.locator("#undo").isVisible(), refresh: await h.page.locator("#refresh").isVisible() });
      assert.deepEqual(await state(), { label: T.fd_again, arm: 0, undo: false, refresh: true });
      // 1. tap, then Undo: nothing was sent
      await h.page.click("#again");
      assert.deepEqual(await state(), { label: T.dock_confirm, arm: 1, undo: true, refresh: false });
      assert.equal((await h.page.textContent("#again .loss")).trim(), T.fd_again_loss);
      const armed = await h.page.evaluate(MEASURE);
      assert.deepEqual([armed.page.some((x) => x > 0), armed.small, armed.clipped, armed.trunc], [false, [], [], []], `armed ${locale}: fits, big targets, nothing cut`);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await h.page.screenshot({ path: path.join(SHOTS, `${locale}-armed-300x420.png`) }); }
      await h.page.click("#undo");
      assert.equal((await state()).arm, 0); assert.equal(posts.length, 0);
      // 2. tap and wait: after 3 seconds the button gives itself back, nothing was sent
      await h.page.click("#again"); assert.equal((await state()).arm, 1);
      await h.page.waitForFunction(() => !document.getElementById("again").classList.contains("arm"), null, { timeout: 5000 });
      assert.equal(posts.length, 0, "no confirmation, no draw");
      // 3. Esc undoes
      await h.page.click("#again"); await h.page.keyboard.press("Escape"); assert.equal((await state()).arm, 0);
      // 4. tap then confirm on the same button: one draw
      await h.page.click("#again"); await h.page.click("#again");
      await h.page.waitForFunction(() => document.getElementById("toast").classList.contains("show"), null, { timeout: 8000 });
      assert.deepEqual(posts, ["POST"]);
      assert.equal((await state()).arm, 0);
    } finally { await h.close(); }
  }
});
