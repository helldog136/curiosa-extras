// Captures (1280 and 390 px, light and dark) of the pages written by render-mascot.mjs. In the scenes "5-voice-blips" and "6-voice-speech" the buttons of the preview frame are used
// (Play talking animation, Test the voice), so that the captures show the line that says what happens.
//   NODE_PATH=<node modules with playwright> CHROMIUM_PATH=<chrome> node tests/visual/shoot-mascot.cjs <pages folder> <captures folder>
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const PAGES = path.resolve(process.argv[2]), OUT = path.resolve(process.argv[3]);
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png" };
const server = http.createServer((req, res) => { const f = path.join(PAGES, decodeURIComponent(req.url.split("?")[0].slice(1))); if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream" }); res.end(fs.readFileSync(f)); } else { res.writeHead(404); res.end(); } });
(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--autoplay-policy=no-user-gesture-required"] });
  for (const f of fs.readdirSync(PAGES).filter((x) => /-(light|dark)\.html$/.test(x))) {
    const [name, theme] = [f.replace(/-(light|dark)\.html$/, ""), /-dark\.html$/.test(f) ? "dark" : "light"];
    for (const w of [1280, 390]) {
      const page = await (await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: theme })).newPage();
      await page.goto(`${base}/${f}`);
      await page.waitForTimeout(500);
      if (/^[56]-voice/.test(name)) {
        const frame = page.frameLocator("iframe").first();
        await frame.locator("#tv").click().catch(() => {});
        await frame.locator("#tp").click().catch(() => {});
        await page.waitForTimeout(300);
        console.log(name, theme, w, "state line:", await frame.locator("#tn").textContent().catch(() => "?"));
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.screenshot({ path: path.join(OUT, `${name}-${w}-${theme}-en.png`), fullPage: true });
      console.log(name, theme, w, "horizontal overflow:", overflow, "px");
      await page.close();
    }
  }
  await browser.close(); server.close();
})();
