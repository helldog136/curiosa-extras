const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const PAGES = path.resolve(process.argv[3]), ROOT = path.resolve(process.argv[4] ?? process.argv[3]), CLIENT = path.join(__dirname, "../../modules/twitch-bot/adminkit.client.js");
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/m/bot/kit") { res.writeHead(200, { "content-type": "application/javascript" }); return res.end(fs.readFileSync(CLIENT)); }
  if (u.pathname.startsWith("/api/admin/modules/")) { const err = req.headers["x-fail"]; let body = ""; req.on("data", (d) => body += d); req.on("end", () => { globalThis.__calls = (globalThis.__calls || []); globalThis.__calls.push(u.pathname); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: "La commande est désactivée." })); }); return; }
  const f = path.join(PAGES, u.pathname.replace(/^\//, ""));
  if (fs.existsSync(f)) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(fs.readFileSync(f)); }
  res.writeHead(404); res.end();
});
(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const job = JSON.parse(process.argv[2]);   // [{ page, w, theme, name, steps }]
  for (const j of job) {
    const ctx = await browser.newContext({ viewport: { width: j.w, height: j.h || 900 }, colorScheme: j.theme, deviceScaleFactor: 1, javaScriptEnabled: !j.nojs });
    const page = await ctx.newPage();
    const logs = [];
    page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
    page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));
    await page.goto(`${base}/${j.page}-${j.theme}.html`);
    await page.waitForTimeout(400);
    for (const s of j.steps || []) {
      if (s.fill) await page.fill(s.fill[0], s.fill[1]);
      if (s.click) await page.click(s.click);
      if (s.eval) await page.evaluate(s.eval);
      if (s.select) await page.selectOption(s.select[0], s.select[1]);
      if (s.wait) await page.waitForTimeout(s.wait);
    }
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(ROOT, `${j.name}.png`), fullPage: j.full !== false, ...(j.clip ? { clip: j.clip } : {}) });
    console.log(j.name, logs.length ? logs.join(" | ") : "");
    await ctx.close();
  }
  await browser.close(); server.close();
})();
