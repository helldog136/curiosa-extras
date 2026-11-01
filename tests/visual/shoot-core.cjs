// Captures (1280 et 390 px, clair et sombre) des pages écrites par render-core.mjs :
//   NODE_PATH=<modules node avec playwright> CHROMIUM_PATH=<chrome> node tests/visual/shoot-core.cjs <dossier de pages> <dossier de captures> ['[{"page":"gs-liste","name":"x","steps":[{"fill":["input","carte"]}]}]']
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const PAGES = path.resolve(process.argv[2]), OUT = path.resolve(process.argv[3]);
fs.mkdirSync(OUT, { recursive: true });
const files = fs.readdirSync(PAGES).filter((f) => f.endsWith(".html"));
const server = http.createServer((req, res) => { const f = path.join(PAGES, decodeURIComponent(req.url.slice(1))); if (fs.existsSync(f)) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(fs.readFileSync(f)); } else { res.writeHead(404); res.end(); } });
(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const f of files) {
    const [name, theme] = [f.replace(/-(light|dark)\.html$/, ""), /-dark\.html$/.test(f) ? "dark" : "light"];
    for (const w of [1280, 390]) {
      const page = await (await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: theme })).newPage();
      await page.goto(`${base}/${f}`);
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.screenshot({ path: path.join(OUT, `${name}-${theme}-${w}.png`), fullPage: true });
      console.log(`${name} ${theme} ${w} débordement horizontal : ${overflow}px`);
      await page.close();
    }
  }
  await browser.close(); server.close();
})();
