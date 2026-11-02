// Captures des pages produites par native.mjs.  NODE_PATH=<modules node globaux> CHROMIUM_PATH=<chrome> node shoot-native.cjs '[{"page":"rw-list","w":1280,"theme":"light","name":"x"}]' <pages> <captures>
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const PAGES = path.resolve(process.argv[3]), ROOT = path.resolve(process.argv[4]), CLIENT = path.join(__dirname, "../../modules/twitch-bot/adminkit.client.js");
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.endsWith("/kit")) { res.writeHead(200, { "content-type": "application/javascript" }); return res.end(fs.readFileSync(CLIENT)); }
  const f = path.join(PAGES, u.pathname.replace(/^\//, ""));
  if (fs.existsSync(f)) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(fs.readFileSync(f)); }
  res.writeHead(404); res.end();
});
(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const j of JSON.parse(process.argv[2])) {
    const ctx = await browser.newContext({ viewport: { width: j.w, height: j.h || 900 }, colorScheme: j.theme });
    const page = await ctx.newPage();
    await page.goto(`${base}/${j.page}-${j.theme}.html`); await page.waitForTimeout(500);
    for (const s of j.steps || []) { if (s.fill) await page.fill(s.fill[0], s.fill[1]); if (s.click) await page.click(s.click); if (s.wait) await page.waitForTimeout(s.wait); }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    await page.screenshot({ path: path.join(ROOT, `${j.name}.png`), fullPage: j.full !== false, ...(j.clip ? { clip: j.clip } : {}) });
    const top = await page.evaluate(() => { const t = document.querySelector("table,[data-admin-table]"); return t ? Math.round(t.getBoundingClientRect().top) : null; });
    console.log(j.name, "débordement horizontal:", overflow, "tableau à", top, "px");
    await ctx.close();
  }
  await browser.close(); server.close();
})();
