// The QR of the sponsor banner, checked by DECODING it: the real core generator (`@/core/services/qr`, lowest error correction), the plate geometry the overlay page uses (`qrPlan`),
// drawn pixel by pixel on a dark card and read back with a QR decoder (jsQR, vendored in tests/helpers). Invented names only.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { qrSvg } from "@/core/services/qr";

const require = createRequire(import.meta.url);
const jsQR = require("./helpers/jsqr.cjs");
const { qrPlan, qrTarget, QR_QUIET } = await import("../modules/sponsor-ticker/index.mjs");

const SITE = "https://etoile-nord.example";
const PAGES = ["/sponsoring/poppy", "/sponsoring/etoile-nord-partners", "/sponsoring/etoile-nord-partners-code-partenaire"];

/** Dark modules of the core's SVG as a boolean matrix (the svg is one path of `M x y` / `h len` / `m dx dy`). */
function matrixOf(svg) {
  const n = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)[1]);
  const d = /<path[^>]* d="([^"]+)"/.exec(svg)[1];
  const rows = Array.from({ length: n }, () => new Array(n).fill(false));
  let x = 0, y = 0;
  for (const [, cmd, args] of d.matchAll(/([Mmh])([^Mmh]*)/g)) {
    const v = args.trim().split(/[\s,]+/).map(Number);
    if (cmd === "M") { x = v[0]; y = Math.floor(v[1]); } else if (cmd === "m") { x += v[0]; y += Math.round(v[1]); } else { for (let i = 0; i < v[0]; i++) rows[y][x + i] = true; x += v[0]; }
  }
  return { n, rows };
}

/** The plate on a dark card, `ppm` px per module and `quiet` modules of white around the code, the plate flush right with 30 px of dark card around the rest. */
function drawPlate({ n, rows }, ppm, quiet, side = ppm * (n + 2 * quiet)) {
  const pad = 30, W = side + 2 * pad, H = side + 2 * pad, px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) px.set([24, 24, 28, 255], i * 4);
  const set = (x, y, v) => px.set([v, v, v, 255], (y * W + x) * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) set(pad + x, pad + y, 255);
  const off = Math.floor((side - ppm * n) / 2);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (rows[r][c]) for (let dy = 0; dy < ppm; dy++) for (let dx = 0; dx < ppm; dx++) set(pad + off + c * ppm + dx, pad + off + r * ppm + dy, 0);
  return { px, W, H };
}
const decode = ({ px, W, H }) => jsQR(px, W, H, { inversionAttempts: "dontInvert" })?.data ?? null;

test("qrTarget: the QR leads to the sponsor's own page on the site (absolute address), never a local or foreign one", () => {
  assert.equal(qrTarget(`${SITE}/sponsoring/poppy`, SITE), `${SITE}/sponsoring/poppy`);
  assert.equal(qrTarget("/sponsoring/poppy?utm=x#a", SITE), `${SITE}/sponsoring/poppy`);
  assert.equal(qrTarget("/sponsoring/poppy", "http://localhost:3000"), null);
  assert.equal(qrTarget("https://ref.example/x", SITE), null);
});

for (const path of PAGES) {
  test(`decode ${path}: the generated QR decodes to the sponsor page, with the smallest quiet zone and whole-pixel modules`, async () => {
    const url = qrTarget(path, SITE);
    const svg = await qrSvg(url);
    const m = matrixOf(svg);
    const N = m.n + 2 * QR_QUIET;
    assert.ok(m.n <= 33, `version too big: ${m.n} modules for ${url.length} characters`);
    // The natural height of a card at 1080p (about 105 px) up to a tall TV card.
    for (const h of [96, 105, 120, 170, 260]) {
      const p = qrPlan(h, N, 1e9);
      assert.ok(p.whole && Number.isInteger(p.ppm), `h=${h}: whole pixels`);
      assert.ok(p.side >= h && p.side < h + N, `h=${h}: the plate fills the card height (side ${p.side}) and grows it by less than one module row`);
      assert.equal(decode(drawPlate(m, p.ppm, QR_QUIET, p.side)), url, `h=${h}: decodes`);
    }
    // Biggest modules the frame allows: at the natural 1080p card height a short sponsor page gets 4 px modules, a longer one at least 3.
    const p105 = qrPlan(105, N, 1e9);
    assert.ok(p105.ppm >= (m.n <= 29 ? 4 : 3), `${p105.ppm}px modules at 1080p for ${m.n} modules`);
  });
}

test("decode: a quiet zone of 2 modules is enough on a white plate against a dark card (the margin the overlay uses)", async () => {
  const svg = await qrSvg(qrTarget(PAGES[0], SITE));
  const m = matrixOf(svg);
  assert.equal(decode(drawPlate(m, 4, 2)), qrTarget(PAGES[0], SITE));
  assert.equal(QR_QUIET, 2);
});

test("qrPlan: a frame that is too low keeps the card height and says so (fractional modules, same quiet zone)", () => {
  const p = qrPlan(100, 37, 100);
  assert.equal(p.side, 100);
  assert.equal(p.whole, false);
  assert.ok(p.side / 37 > 2.5);
});

test("qrPlan: never grows past the limit when a smaller whole size fits", () => {
  const p = qrPlan(105, 33, 120);
  assert.equal(p.ppm, 3);
  assert.equal(p.side, 105);
});
