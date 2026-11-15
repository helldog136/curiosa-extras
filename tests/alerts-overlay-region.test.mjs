// Alerts overlay 1.10.1: the element's stage carries data-ov-region="element", so an overlay skin and the "Opaque" background of the page (both set their
// tokens on the region node with !important) reach the card, which used to inherit the tokens written inline on the stage (transparent / semi-transparent).
// Proven in a REAL Chromium when one is available (skipped with a reason otherwise); the module's own overlay keeps its bytes (golden test elsewhere).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { ownerSurfaceCss } from "@/core/overlays/tokens";
import { compileSkin } from "@/core/overlays/skinSheet";

const DIR = new URL("../modules/alerts-overlay", import.meta.url).pathname;
const def = (await import("../modules/alerts-overlay/index.mjs")).default;
const messages = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const query = (surface) => new URLSearchParams({ "ov-w": "640", "ov-h": "260", "ov-fit": "scale", "ov-lang": "en", "ov-text": "light", "ov-surface": surface, "ov-corners": "round", "ov-demo": "1" });
const element = async (surface) => def.overlay(fakeCtx({ key: "al", locale: "en", messages, settings: { pushToken: "x" } }), { query: query(surface) });

test("the element stage is the element region; the module's own overlay has no region (unchanged)", async () => {
  const el = await element("transparent");
  assert.match(el.html, /^<div id="al-stage" data-ov-region="element" style="--ov-fg:#ffffff;--ov-surface:transparent;/);
  const own = await def.overlay(fakeCtx({ key: "al", locale: "en", messages, settings: { pushToken: "x" } }));
  assert.doesNotMatch(own.html, /data-ov-region/);
});

let pw = null;
try {
  const core = path.resolve(process.env.CURIOSA_DIR ?? process.cwd());
  const lib = await import(pathToFileURL(path.join(core, "scripts/visual/lib/playwright.mjs")).href);
  pw = { chromium: lib.loadPlaywright().chromium, path: lib.chromiumPath(), args: lib.CHROMIUM_ARGS };
} catch { pw = null; }

test("real browser: the Opaque background and an overlay skin give their background to the alert card", { skip: pw ? false : "Chromium or playwright not found", timeout: 60000 }, async () => {
  const pages = {};
  for (const surface of ["soft", "transparent"]) { const o = await element(surface); pages[surface] = `<!doctype html><meta charset="utf-8"><style>${o.css}</style>${o.html}`; }
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(pages[req.url.slice(1)] ?? ""); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await pw.chromium.launch({ executablePath: pw.path, args: pw.args });
  try {
    const p = await browser.newPage();
    const card = async (surface, css, attr) => {
      await p.goto(`http://127.0.0.1:${server.address().port}/${surface}`);
      return p.evaluate(({ css, attr }) => { const s = new CSSStyleSheet(); s.replaceSync(css); document.adoptedStyleSheets = [...document.adoptedStyleSheets, s]; document.documentElement.setAttribute(attr[0], attr[1]); return getComputedStyle(document.querySelector('[data-ov-part="card"]')).backgroundColor; }, { css, attr });
    };
    // "Opaque" page: the element receives ov-surface=soft and the core adopts the solid colour.
    assert.equal(await card("soft", ownerSurfaceCss({ text: "light", background: "opaque", corners: "round" }), ["data-ov-owner", "1"]), "rgb(20, 23, 28)");
    const skin = compileSkin({ id: "plain-test", version: "1.0.0", tokens: { "--ov-fg": "#ffffff", "--ov-surface": "rgba(24,20,48,0.92)" }, css: "" });
    assert.equal(await card("transparent", skin.css, ["data-ov-skin", "plain-test"]), "rgba(24, 20, 48, 0.92)");
  } finally { await browser.close(); server.close(); }
});
