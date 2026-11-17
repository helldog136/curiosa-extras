// Twitch activity 1.8.0: the OBS dock in a REAL browser (Chromium through Playwright) at the sizes of an OBS dock (220 to 360 px wide, short or tall) and wider, light and dark, English and French,
// with 0, 3 and 40 events, with the "not listening" notice, with the controls folded and open. What it asserts: nothing scrolls sideways (page, top, list, every control), the main targets are at
// least 44 px, the type pills are never cut, every control has a name, the rows have one height and at least one row is visible, the notice is short and is a link, the controls are folded by default
// and remembered. Invented names only. Skipped, loudly, where Chromium or Playwright is missing. DOCK_SHOTS=/dir saves a screenshot per case.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { browser, closeBrowser, serve } from "./helpers/dockBrowser.mjs";
import { world, deliver, EV, TYPES, S, D, mod, seedQueue, TWO } from "./helpers/eventsWorld.mjs";
import { moduleAdminTheme } from "@/core/adminTheme";

const b = await browser();
after(() => closeBrowser());
const skip = b ? false : "Chromium or Playwright not available here: the events dock layout test did not run";
if (skip) console.error(`⚠ ${skip}`);

const WIDTHS = [220, 250, 320, 480, 900], HEIGHTS = [300, 600, 900];
const SHOTS = process.env.DOCK_SHOTS || "";
const NAMES = ["etoile_nord", "lune_douce", "Camille", "brume_claire", "sapin_bleu", "Noisette", "vent_leger", "Alix", "mousse_verte", "Louise_b", "pluie_fine", "cerise_rouge"];
const LONG = "etoile_nord_de_la_grande_ourse_bleue";
const KINDS = [["follow", "follow"], ["sub", "sub"], ["resub", "resub"], ["gift", "gift"], ["cheer", "cheer"], ["raid", "raid"], ["online", "online"], ["offline", "offline"]];

async function site({ locale, n, problem = false, paused = false }) {
  const w = world({ alerts: true, voice: true, locale });
  w.ctx.api.adminTheme = (o) => moduleAdminTheme(o);
  // (1.18.0) the queue is the overlay's own: paused with 3 alerts held
  if (paused) { await seedQueue(w.ctx, { held: 3 }); await TWO.pause(w.ctx); }
  await S.ensureSecret(w.ctx);
  for (let i = n - 1; i >= 0; i--) {   // oldest first, as they arrive
    const [key, ev] = KINDS[i % KINDS.length], name = i === 1 ? LONG : NAMES[i % NAMES.length] + (i >= NAMES.length ? i : "");
    const at = Date.now() - i * 90_000;
    const e = { ...EV[ev], user_name: name, user_login: name.toLowerCase(), from_broadcaster_user_name: name, from_broadcaster_user_login: name.toLowerCase(), followed_at: new Date(at).toISOString(), started_at: new Date(at).toISOString() };
    await deliver(w.ctx, TYPES[key], e, { id: `e${i}`, at, now: at });
  }
  if (problem) await S.updateState(w.ctx, (d) => { d.listen = { code: "need_reconnect", at: Date.now() }; });
  return w;
}

const MEASURE = () => {
  const out = { page: 0, sideways: [], small: [], pills: [], unnamed: [], rows: [], visibleRows: 0, stageH: 0, topH: 0, banner: null, tips: [] };
  const de = document.scrollingElement;
  out.page = Math.max(de.scrollHeight - innerHeight, de.scrollWidth - innerWidth, document.body.scrollWidth - innerWidth);
  if (out.page > 0) out.dbg = [de.scrollHeight, innerHeight, document.body.scrollHeight, document.querySelector('.app').getBoundingClientRect().height, document.querySelector('.top').getBoundingClientRect().height, document.getElementById('stage').getBoundingClientRect().height, document.getElementById('strip').getBoundingClientRect().height].join(',');
  for (const sel of [".top", "#stage", ".app"]) { const n = document.querySelector(sel); if (n.scrollWidth > n.clientWidth + 0.5) out.sideways.push(`${sel}:${n.scrollWidth}>${n.clientWidth}`); }
  const shown = (n) => !n.closest("[hidden]") && getComputedStyle(n).display !== "none" && n.getBoundingClientRect().width > 0;
  for (const n of document.querySelectorAll("button, select, input, a")) {
    if (!shown(n)) continue;
    const r = n.getBoundingClientRect();
    if (r.right > innerWidth + 0.5 || r.left < -0.5) out.sideways.push(`${n.id || n.className}@${Math.round(r.left)}-${Math.round(r.right)}`);
    if (r.width < 43.5 || r.height < 43.5) out.small.push(`${n.id || n.className}:${Math.round(r.width)}x${Math.round(r.height)}`);
    const name = n.getAttribute("aria-label") || (n.labels && n.labels.length && n.labels[0].textContent.trim()) || n.textContent.trim();
    if (!name) out.unnamed.push(n.id || n.className);
  }
  for (const n of document.querySelectorAll(".badge, .pill, .time, .sws, .ctl .t, .head .t")) if (shown(n) && n.scrollWidth > n.clientWidth + 0.5) out.pills.push(`${n.textContent}:${n.scrollWidth}>${n.clientWidth}`);
  out.rows = [...new Set([...document.querySelectorAll("#list .row")].map((n) => Math.round(n.getBoundingClientRect().height)))];
  const st = document.getElementById("stage"), sr = st.getBoundingClientRect();
  out.stageH = Math.round(sr.height); out.topH = Math.round(document.querySelector(".top").getBoundingClientRect().height);
  const lo = Math.max(sr.top, 0), hi = Math.min(sr.bottom, innerHeight - document.getElementById("strip").getBoundingClientRect().height);
  for (const r of document.querySelectorAll("#list .row")) { const q = r.getBoundingClientRect(); if (q.top >= lo - 0.5 && q.bottom <= hi + 0.5) out.visibleRows++; }
  for (const n of document.querySelectorAll("#list .who")) if (!n.title) out.tips.push("who without tooltip");
  const bn = document.getElementById("banner"); if (!bn.hidden) { const a = bn.querySelector("a"); out.banner = { text: bn.textContent, link: a ? a.getAttribute("href") : null, h: Math.round(bn.getBoundingClientRect().height) }; }
  return out;
};

async function open(w, { viewport, locale, scheme }) {
  const k = await D.dockSecret(w.ctx);
  const srv = await serve(mod, w.ctx);
  const bc = await b.newContext({ viewport: { width: viewport[0], height: viewport[1] }, colorScheme: scheme, locale: locale === "fr" ? "fr-FR" : "en-US", deviceScaleFactor: 1 });
  const page = await bc.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const posts = []; page.on("request", (r) => { if (r.method() === "POST") posts.push(r.postData()); });
  await page.goto(`${srv.base}/m/${w.ctx.instance.key}/dock?k=${k}&scheme=${scheme}`);
  return { page, posts, errors, close: async () => { await bc.close(); await srv.close(); } };
}

const SCENES = [
  { name: "empty", n: 0 }, { name: "three", n: 3 }, { name: "forty", n: 40 },
  { name: "notice", n: 3, problem: true }, { name: "paused", n: 3, paused: true },
  { name: "controls", n: 40, controls: true }, { name: "controls-notice", n: 3, problem: true, controls: true },
];

for (const locale of ["en", "fr"]) {
  test(`events dock layout (${locale}): 220 to 900 px wide, 300 to 900 px high, light and dark: no sideways scroll, 44 px targets, whole pills, named controls, a visible list`, { skip, timeout: 900_000 }, async () => {
    const report = [];
    for (const sc of SCENES) {
      const w = await site({ locale, ...sc });
      for (const scheme of ["dark", "light"]) {
        const h = await open(w, { viewport: [320, 600], locale, scheme });
        try {
          await h.page.waitForSelector(sc.n ? "#list .row" : "#msg:not([hidden])", { timeout: 8000 });
          await h.page.waitForTimeout(200);
          if (sc.controls) await h.page.click("#ctltoggle");
          for (const wd of WIDTHS) for (const ht of HEIGHTS) {
            await h.page.setViewportSize({ width: wd, height: ht });
            await h.page.waitForTimeout(40);
            const m = await h.page.evaluate(MEASURE), id = `${locale}/${sc.name}/${wd}x${ht}/${scheme}`;
            if (m.page > 0) report.push(`${id} page scrolls by ${m.page} ${m.dbg}`);
            if (m.sideways.length) report.push(`${id} sideways ${m.sideways.join(" ")}`);
            if (m.small.length) report.push(`${id} small targets ${m.small.join(" ")}`);
            if (m.pills.length) report.push(`${id} cut pills ${m.pills.join(" | ")}`);
            if (m.unnamed.length) report.push(`${id} unnamed ${m.unnamed.join(" ")}`);
            if (m.rows.length > 1) report.push(`${id} uneven rows ${m.rows}`);
            if (m.tips.length) report.push(`${id} ${m.tips[0]}`);
            if (sc.n && !m.visibleRows && !(ht <= 420 && (sc.controls || sc.problem || sc.paused))) report.push(`${id} no row visible (stage ${m.stageH}px, top ${m.topH}px)`);
            if (sc.n && !sc.controls && ht >= 600 && m.visibleRows < Math.min(sc.n, 4)) report.push(`${id} the list is not the main thing: ${m.visibleRows} rows`);
            if (sc.problem && !(m.banner && m.banner.link && /\/admin\/instances\//.test(m.banner.link))) report.push(`${id} the notice is not a link ${JSON.stringify(m.banner)}`);
            if (!sc.problem && !sc.paused && m.banner) report.push(`${id} a notice shows while all is fine`);
            if (m.banner && m.banner.h > 64 && wd >= 250) report.push(`${id} the notice is tall: ${m.banner.h}px`);
            if (SHOTS && (scheme === "dark" || wd === 320) && !(wd === 900 && ht !== 600)) { fs.mkdirSync(SHOTS, { recursive: true }); await h.page.screenshot({ path: path.join(SHOTS, `${locale}-${sc.name}-${wd}x${ht}-${scheme}.png`) }); }
          }
          assert.deepEqual(h.errors, [], `${sc.name}: no script error`);
        } finally { await h.close(); }
      }
    }
    assert.deepEqual(report, [], report.slice(0, 40).join("\n"));
  });
}

test("events dock: the controls are folded by default and remembered, icon buttons have names and tooltips, one replay button per row sends one replay, the filters are selects", { skip, timeout: 120_000 }, async () => {
  const w = await site({ locale: "en", n: 3 });
  const h = await open(w, { viewport: [250, 600], locale: "en", scheme: "dark" });
  try {
    await h.page.waitForSelector("#list .row");
    assert.equal(await h.page.isVisible("#controls"), false, "folded by default");
    assert.equal(await h.page.getAttribute("#ctltoggle", "aria-expanded"), "false");
    await h.page.click("#ctltoggle");
    assert.equal(await h.page.isVisible("#controls"), true);
    for (const [id, name] of [["pause", "Alerts"], ["voice", "Voice"], ["mute", "Mute voice"], ["stopspeech", "Stop speech"], ["skip", "Skip alert"], ["clear", "Empty the queue"], ["test", "Test"]]) {
      assert.equal(await h.page.getAttribute(`#${id}`, "aria-label"), id === "pause" || id === "voice" || id === "mute" ? name : name, id);
      assert.ok((await h.page.getAttribute(`#${id}`, "title")).includes(name), `${id} has a tooltip`);
    }
    assert.equal(await h.page.evaluate(() => document.querySelector("#pause").getAttribute("role")), "switch");
    await h.page.reload(); await h.page.waitForSelector("#list .row");
    assert.equal(await h.page.isVisible("#controls"), true, "remembered after a reload");
    await h.page.click("#ctltoggle");
    assert.equal(await h.page.isVisible("#controls"), false);
    assert.equal(await h.page.evaluate(() => document.querySelectorAll("#list .replay").length), 3, "one replay button per row");
    assert.match(await h.page.getAttribute("#list .row:first-child .replay", "aria-label"), /^Replay the alert: /);
    await h.page.click("#list .row:first-child .replay"); await h.page.click("#list .row:first-child .replay", { force: true, timeout: 500 }).catch(() => {});
    await h.page.waitForTimeout(300);
    assert.equal(h.posts.filter((p) => /"replay"/.test(p)).length, 1, "one replay sent");
    assert.equal(await h.page.evaluate(() => document.querySelector("#scope").tagName + document.querySelector("#typesel").tagName), "SELECTSELECT");
    const all = await h.page.evaluate(() => document.querySelectorAll("#list .row").length);
    await h.page.selectOption("#typesel", "follow");
    assert.deepEqual(await h.page.evaluate(() => [...document.querySelectorAll("#list .badge")].map((n) => n.textContent).filter((t, i, a) => a.indexOf(t) === i)), ["Follow"], "only follows are left (the replay of a follow is one too)");
    assert.ok(await h.page.evaluate(() => document.querySelectorAll("#list .row").length) < all, "the type filter narrows the list");
    await h.page.fill("#q", "zzz");
    assert.equal(await h.page.isVisible("#msg"), true);
  } finally { await h.close(); }
});

test("events dock: a SHORT dock (under 420 px high) loads with the list (and the notice) in view, and opening the controls brings them into view", { skip, timeout: 120_000 }, async () => {
  for (const [wd, ht, extra] of [[220, 300, { problem: true }], [250, 300, { paused: true }], [320, 300, {}], [300, 200, {}]]) {
    const w = await site({ locale: "en", n: 12, ...extra });
    const h = await open(w, { viewport: [wd, ht], locale: "en", scheme: "dark" });
    try {
      await h.page.waitForSelector("#list .row"); await h.page.waitForTimeout(300);
      const m = await h.page.evaluate(MEASURE), id = `${wd}x${ht} ${JSON.stringify(extra)}`;
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await h.page.screenshot({ path: path.join(SHOTS, `short-${wd}x${ht}-${Object.keys(extra)[0] ?? "plain"}.png`) }); }
      assert.ok(m.visibleRows >= 1, `${id}: a row is in view after loading (${m.visibleRows})`);
      assert.equal(m.page, 0, `${id}: the page itself does not scroll`);
      if (extra.problem || extra.paused) assert.ok(m.banner, `${id}: the notice is in view with the list`);
      assert.equal(await h.page.evaluate(() => { const r = document.getElementById("banner").hidden ? null : document.getElementById("banner").getBoundingClientRect(); return r ? r.top >= -0.5 && r.bottom <= innerHeight : true; }), true, `${id}: the notice is fully in view`);
      await h.page.click("#ctltoggle");
      await h.page.waitForTimeout(200);
      assert.equal(await h.page.evaluate(() => { const r = document.getElementById("controls").getBoundingClientRect(); return r.top >= -0.5 && r.top < innerHeight; }), true, `${id}: the controls come into view`);
    } finally { await h.close(); }
  }
});

test("events dock: the whole name of a person is in the tooltip when the row cuts it", { skip, timeout: 60_000 }, async () => {
  const w = await site({ locale: "en", n: 3 });
  const h = await open(w, { viewport: [220, 600], locale: "en", scheme: "dark" });
  try {
    await h.page.waitForSelector("#list .row");
    const who = await h.page.evaluate(() => [...document.querySelectorAll("#list .who")].map((n) => [n.textContent, n.title, n.scrollWidth > n.clientWidth]));
    assert.ok(who.every(([t, tip]) => t === tip), "the tooltip carries the full name");
    assert.ok(who.some(([t]) => t.length > 0));
  } finally { await h.close(); }
});
