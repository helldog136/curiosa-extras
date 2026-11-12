// Captures of the mascot in the corner of a site (1280 and 390 px, light and dark) and checks made in a real browser: the box of the mascot does not change when the picture arrives (no layout shift),
// the idle then talking then idle pictures, the CSS that hides the drawing under the picture, nothing fetched before it shows.
//   NODE_PATH=<node modules with playwright> CHROMIUM_PATH=<chrome> node tests/visual/shoot-site-mascot.cjs <pages folder> <captures folder>
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const PAGES = path.resolve(process.argv[2]), OUT = path.resolve(process.argv[3]);
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
let requests = [];
const server = http.createServer((req, res) => { requests.push(req.url); const f = path.join(PAGES, req.url.startsWith("/lines") ? "lines.json" : decodeURIComponent(req.url.split("?")[0].slice(1))); if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream" }); res.end(fs.readFileSync(f)); } else { res.writeHead(404); res.end(); } });
(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const theme of ["light", "dark"]) for (const w of [1280, 390]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: 700 }, colorScheme: theme })).newPage();
    requests = [];
    await page.goto(`${base}/site-${theme}.html`);
    await page.waitForTimeout(1200);
    console.log(theme, w, "before it shows: picture requests =", requests.filter((u) => u.includes("/uploads/")).length, "(expected 0)");
    await page.waitForSelector(".mc", { timeout: 12000 });
    await page.waitForSelector(".mc-an", { timeout: 3000 });
    const box = () => page.evaluate(() => { const r = document.querySelector(".mc").getBoundingClientRect(); const a = document.querySelector(".mc-av").getBoundingClientRect(); return { root: [r.x, r.y, r.width, r.height].map(Math.round), av: [a.x, a.y, a.width, a.height].map(Math.round) }; });
    const srcs = new Set(); const b1 = await box();
    for (let i = 0; i < 14; i++) { srcs.add(await page.evaluate(() => (document.querySelector(".mc-an")?.getAttribute("src") ?? "").slice(-8))); await page.waitForTimeout(110); }
    const info = await page.evaluate(() => ({ anim: document.querySelector(".mc").classList.contains("mc-anim"), svgHidden: getComputedStyle(document.querySelector(".mc-av > .mc-svg")).visibility, hasBubble: !!document.querySelector(".mc-bub") }));
    await page.screenshot({ path: path.join(OUT, `site-talking-${w}-${theme}-en.png`) });
    await page.waitForFunction(() => !document.querySelector(".mc-bub"), null, { timeout: 40000 }).catch(() => {});
    await page.waitForTimeout(800);
    const alive = await page.evaluate(() => !!document.querySelector(".mc-an"));
    console.log(theme, w, "pictures seen:", [...srcs].join(","), "| class mc-anim:", info.anim, "| drawing under the picture hidden:", info.svgHidden, "| bubble:", info.hasBubble, "| box while talking:", JSON.stringify(b1), "| picture still there after the bubble:", alive);
    await page.screenshot({ path: path.join(OUT, `site-idle-${w}-${theme}-en.png`) });
    await page.close();
  }
  await browser.close(); server.close();
})();
