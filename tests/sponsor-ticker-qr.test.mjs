// Sponsor banner (sponsor-ticker): the QR code fills the FULL HEIGHT of the card, stays a crisp square, and the QR-off page is untouched.
// Browser checks need Playwright + Chromium (skipped, said loud, without them); the decode check also needs jsQR and pngjs (QR_DECODER_DIR=/dir holding node_modules/jsqr and pngjs), else it is skipped.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { tvSuite, wrapOverlay, tvQuery, sharedBrowser, closeShared } from "./helpers/tvLegibility.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, "..");
const CORE = process.env.CURIOSA_DIR ?? process.cwd();
const en = JSON.parse(fs.readFileSync(path.join(ROOT, "modules/sponsor-ticker/locales/en.json"), "utf8"));
const tk = (await import("../modules/sponsor-ticker/index.mjs")).default;
const { qrPayload, qrTarget } = await import("../modules/sponsor-ticker/index.mjs");

// The core's own QR service (the module cannot change it): lowest error correction, smallest version, no margin.
let realQr = null, QRCode = null;
try { QRCode = createRequire(path.join(CORE, "package.json"))("qrcode"); realQr = (await import(path.join(CORE, "src/core/services/qr.ts"))).qrSvg; } catch { /* core without it */ }
let decoder = null;
for (const dir of [process.env.QR_DECODER_DIR, "/tmp/claude-0/dec"].filter(Boolean)) {
  try { const r = createRequire(path.join(dir, "package.json")); decoder = { jsQR: r("jsqr"), PNG: r("pngjs").PNG }; break; } catch { /* next */ }
}

const CARD = { id: "a", name: "Lune Douce Outdoor", text: "A short sentence about the sponsor.", url: "https://lune-douce.example/promo?ref=etoile_nord", page: "https://example.test/sponsors/lune-douce", code: "ETOILE10", publishedAt: "2020-01-01T00:00:00.000Z" };
const LONG = { id: "b", name: "Etoile Nord Outdoor and Camping Supplies for Every Season", text: "A long sentence about what the sponsor does and why their discount is worth a look, written to need two lines at least.", url: "https://etoile-nord.example/shop/winter-collection?ref=lune_douce", page: "https://example.test/sponsors/etoile-nord-outdoor", code: "LUNEDOUCE", logo: "https://x.test/logo.png" };
const makeCtx = (cards, settings = {}) => { const c = fakeCtx({ key: "ticker", name: "Sponsors", locale: "en", messages: en, settings, topics: { "sponsor.card": cards, "core.entry": [] } }); if (realQr) c.api.qr = realQr; return c; };
const render = (cards, settings) => (q) => {
  const c = makeCtx(cards, settings);
  return { html: wrapOverlay(tk.overlay(c, { query: new URLSearchParams(q) })), handler: async (u) => (new URL(u).pathname.endsWith("/items") ? tk.routes.items(new Request(u), c) : u.endsWith("logo.png") ? new Response(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"), { headers: { "content-type": "image/png" } }) : null) };
};

test("qrPayload: only redundant parts of the link are dropped", () => {
  assert.equal(qrPayload("https://lune-douce.example/"), "https://lune-douce.example");
  assert.equal(qrPayload("HTTPS://Lune-Douce.Example/promo"), "https://lune-douce.example/promo");
  assert.equal(qrPayload("https://lune-douce.example:443/promo"), "https://lune-douce.example/promo");
  assert.equal(qrPayload("https://lune-douce.example/promo/"), "https://lune-douce.example/promo/", "a path slash can matter: kept");
  assert.equal(qrPayload("https://www.lune-douce.example/a?utm_source=x&b=2#top"), "https://www.lune-douce.example/a?utm_source=x&b=2#top", "www, query string and fragment are kept");
  assert.equal(qrPayload("https://lune-douce.example/café"), "https://lune-douce.example/café", "never longer than what was typed");
  assert.equal(qrPayload("/relative/path"), "/relative/path");
  assert.equal(qrPayload("not a url"), "not a url");
});

test("qrTarget: the page of THIS site that presents the sponsor, short, never the referral link, nothing without a known site address", () => {
  const site = "https://my-site.example";
  assert.equal(qrTarget("https://my-site.example/sponsors/lune-douce", site), "https://my-site.example/sponsors/lune-douce");
  assert.equal(qrTarget("HTTPS://My-Site.Example/sponsors/lune-douce?utm_source=x&ref=y#top", site), "https://my-site.example/sponsors/lune-douce", "lower case, no query string, no fragment");
  assert.equal(qrTarget("/sponsors/lune-douce", site), "https://my-site.example/sponsors/lune-douce", "a site path is completed with the site address");
  assert.equal(qrTarget("https://my-site.example/", site), "https://my-site.example");
  assert.equal(qrTarget("https://shop.example/?ref=etoile_nord", site), null, "another site (a referral link) is never a target");
  assert.equal(qrTarget("//shop.example/x", site), null);
  assert.equal(qrTarget("javascript:alert(1)", site), null);
  assert.equal(qrTarget("", site), null);
  assert.equal(qrTarget(null, site), null);
  for (const unknown of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000", "https://box.local", "", undefined, "not a url", "ftp://my-site.example"]) assert.equal(qrTarget("/sponsors/lune-douce", unknown), null, `site ${unknown}`);
});

test("items: the QR encodes the sponsor page of the site (no referral link inside), and no QR when the site address is unknown", async () => {
  const run = async (siteUrl, cards) => { const c = makeCtx(cards); c.api.siteUrl = siteUrl; c.api.qr = async (t) => `<svg data-qr="${t}"></svg>`; const r = await (await tk.routes.items(new Request("https://x.test/m/ticker/items"), c)).json(); return { items: r.items, calls: c }; };
  const { items } = await run("https://my-site.example", [{ id: "a", name: "Lune Douce", url: "https://lune-douce.example/?ref=etoile_nord", page: "https://my-site.example/sponsors/lune-douce" }]);
  assert.equal(items[0].url, "https://lune-douce.example/?ref=etoile_nord", "the referral link is unchanged");
  assert.equal(items[0].qrUrl, "https://my-site.example/sponsors/lune-douce");
  assert.equal(items[0].qrSvg, '<svg data-qr="https://my-site.example/sponsors/lune-douce"></svg>');
  assert.ok(!items[0].qrSvg.includes("ref="), "no referral link inside the QR");
  const none = await run("http://localhost:3000", [{ id: "a", name: "Lune Douce", url: "https://lune-douce.example/", page: "http://localhost:3000/sponsors/lune-douce" }]);
  assert.deepEqual([none.items[0].qrUrl, none.items[0].qrSvg], [null, null], "site address unknown: no QR rather than a wrong one");
  const noPage = await run("https://my-site.example", [{ id: "a", name: "Lune Douce", url: "https://lune-douce.example/" }]);
  assert.equal(noPage.items[0].qrSvg, null, "a card without a page of the site never falls back to its referral link");
});

test("the core QR service: lowest correction level (L), smallest version, a short link fits version 3 or less", async (t) => {
  if (!realQr) return t.skip("no core QR service here");
  for (const u of ["https://my-site.example", "https://my-site.example/sponsors/lune-douce", "https://my-site.example/sponsors/etoile-nord-outdoor"]) {
    const svg = await realQr(qrPayload(u));
    const n = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)[1]);
    const version = (n - 17) / 4;
    assert.ok(version <= 3, `${u}: version ${version}`);
    const model = QRCode.create(qrPayload(u), { errorCorrectionLevel: "L" });
    assert.equal(model.version, version, "smallest version for level L");
    assert.equal(model.errorCorrectionLevel.bit, 1, "level L");
    assert.equal(svg, await QRCode.toString(qrPayload(u), { type: "svg", margin: 0, errorCorrectionLevel: "L", color: { dark: "#000000", light: "#0000" } }));
  }
});

test("QR code off: the page is exactly what it was before the full-height QR (hash of title, html, css and script)", () => {
  const h = (settings, q) => crypto.createHash("sha256").update(JSON.stringify(tk.overlay(makeCtx([], settings), { query: new URLSearchParams(q) }))).digest("hex").slice(0, 16);
  assert.equal(h({ showQr: false }, ""), "d46a81081ee13d42");
  assert.equal(h({}, "ov-w=720&ov-h=180&ov-tv=1&opt-qr=0&ov-text=light"), "e2801954d85d86a5");
  assert.equal(h({ showQr: false }, "ov-w=720&ov-h=180&ov-tv=2&ov-text=dark&ov-surface=soft"), "ab76b0461ef9e0d6");
  assert.equal(h({ showQr: false, visual: "broadcast", accentColor: "#336699" }, ""), "92c47330b5bbb9eb");
});

// ── In a real browser ───────────────────────────────────────────────────────────────────────────
let b = null;
before(async () => { b = await sharedBrowser(); if (!b) console.warn("sponsor-ticker QR: no Playwright/Chromium here, the browser checks are skipped"); });
after(closeShared);

async function open(cards, { w, h, tv, extra = {}, settings, logo = false }) {
  const q = tvQuery({ w, h, tv, extra: { "ov-fit": "scale", "ov-demo": "1", ...extra } });
  const r = render(cards, settings)(q);
  const url = `https://x.test/m/k/element/e?${q}`;
  const context = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const u = route.request().url();
    if (u.split("#")[0] === url) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: r.html });
    const a = await r.handler(u);
    if (!a) return route.abort();
    return route.fulfill({ status: a.status, headers: Object.fromEntries(a.headers), body: Buffer.from(await a.arrayBuffer()) });
  });
  await page.goto(url);
  await page.waitForSelector(".ticker-slider.on", { timeout: 8000 });
  await page.waitForTimeout(900);
  return { page, close: () => context.close() };
}
const geometry = (page) => page.evaluate(() => {
  const rect = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const card = document.querySelector(".ticker-card"), q = document.querySelector(".ticker-qr"), sv = q && q.querySelector("svg");
  return { card: rect(card), inner: { h: card.clientHeight, top: card.getBoundingClientRect().top + card.clientTop }, qr: q && rect(q), svg: sv && rect(sv), n: q && Number(q.getAttribute("data-n")), svgStyle: sv && sv.getAttribute("style"), caption: !!document.querySelector(".ticker-domain"), scrollW: document.documentElement.scrollWidth, innerW: innerWidth };
});

const FRAMES = [
  { name: "default frame", w: 720, h: 180, tv: 1 },
  { name: "default frame at 4K scale", w: 1440, h: 360, tv: 2 },
  { name: "1920 wide", w: 1920, h: 400, tv: 1.5 },
  { name: "3440 wide", w: 3440, h: 500, tv: 2 },
  { name: "tall and narrow", w: 360, h: 300, tv: 1 },
  { name: "wide and short", w: 1000, h: 110, tv: 1 },
];
for (const cardSet of [["short card", [CARD]], ["long card with logo", [LONG]]]) {
  for (const f of FRAMES) {
    test(`QR full height: ${cardSet[0]}, ${f.name} (${f.w}x${f.h}, ov-tv ${f.tv})`, async (t) => {
      if (!b) return t.skip("no browser");
      const o = await open(cardSet[1], f);
      try {
        const g = await geometry(o.page);
        assert.ok(g.qr, "the QR is shown");
        assert.ok(Math.abs(g.qr.h - g.inner.h) <= 1, `QR height ${g.qr.h} = card inner height ${g.inner.h}`);
        assert.ok(Math.abs(g.qr.w - g.qr.h) <= 1, `square: ${g.qr.w}x${g.qr.h}`);
        assert.ok(g.qr.t >= g.inner.top - 1 && g.qr.b <= g.inner.top + g.inner.h + 1, "flush with the card, not above or under it");
        assert.ok(g.qr.l >= g.card.l && g.qr.r <= g.card.r + 0.5, "inside the card");
        assert.ok(g.svg.l >= g.qr.l && g.svg.r <= g.qr.r + 0.01 && g.svg.t >= g.qr.t && g.svg.b <= g.qr.b + 0.01, "the code and its quiet zone stay inside the white square");
        assert.ok(Math.abs(g.svg.w - g.svg.h) < 0.01, "never distorted");
        assert.ok(Math.abs(g.svg.w - Math.round(g.svg.w)) < 0.01 && Math.round(g.svg.w) % g.n === 0, `whole pixels per module (${g.svg.w}px for ${g.n} modules)`);
        const quiet = (g.qr.w - g.svg.w) / 2 / (g.svg.w / g.n);
        assert.ok(quiet >= 1.9, `quiet zone of ${quiet.toFixed(2)} modules`);
        assert.equal(g.caption, false, "no domain caption next to the QR");
        assert.ok(g.scrollW <= g.innerW + 1, "no horizontal overflow");
        const text = await o.page.evaluate((min) => { const bad = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const e = n.parentElement; if (!n.nodeValue.trim() || ["SCRIPT", "STYLE", "TITLE"].includes(e.tagName)) continue; const cs = getComputedStyle(e); if (cs.display === "none") continue; if (parseFloat(cs.fontSize) < min - 0.01) bad.push(n.nodeValue.trim()); } return bad; }, 24 * f.tv);
        assert.deepEqual(text, [], "text at 24 px of canvas or more");
        if (process.env.TV_SHOTS) { fs.mkdirSync(process.env.TV_SHOTS, { recursive: true }); await o.page.screenshot({ path: path.join(process.env.TV_SHOTS, `qr-${cardSet[0].replace(/\W+/g, "-")}-${f.w}x${f.h}.png`) }); }
      } finally { await o.close(); }
    });
  }
}

test("QR off: no QR, no caption, the card keeps its own look", async (t) => {
  if (!b) return t.skip("no browser");
  const o = await open([CARD], { w: 720, h: 180, tv: 1, extra: { "opt-qr": "0" } });
  try { const g = await geometry(o.page); assert.equal(g.qr, null); assert.equal(g.caption, false); } finally { await o.close(); }
});

test("QR scannable: decoded from the rendered pixels at every frame, to the exact link", async (t) => {
  if (!b) return t.skip("no browser");
  if (!decoder) return t.skip("no QR decoder (jsqr + pngjs) here");
  for (const card of [CARD, LONG]) for (const f of FRAMES) {
    const o = await open([card], f);
    try {
      const png = decoder.PNG.sync.read(await o.page.screenshot());
      const r = decoder.jsQR(new Uint8ClampedArray(png.data), png.width, png.height, { inversionAttempts: "dontInvert" });
      assert.ok(r, `${card.id} ${f.name}: not decoded`);
      assert.equal(r.data, qrTarget(card.page, "https://example.test"), `${card.id} ${f.name}`);
    } finally { await o.close(); }
  }
});

// The generic TV checks (text 24 px, no overflow, nothing clipped) on awkward frames, QR shown.
tvSuite({
  test, before, after, label: "sponsor-ticker QR frames", settle: 500,
  render: render([LONG]),
  afterLoad: (page) => page.waitForSelector(".ticker-slider.on", { timeout: 6000 }).then(() => page.waitForTimeout(900)),
  frames: [{ name: "tall and narrow", w: 360, h: 300 }, { name: "wide and short", w: 1000, h: 110 }].map((f) => ({ ...f, extra: { "ov-fit": "scale", "ov-demo": "1" } })),
});
