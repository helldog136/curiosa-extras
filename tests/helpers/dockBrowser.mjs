// A real browser for the control dock: a tiny HTTP server in front of the module's own routes, and Chromium driven by Playwright.
// Playwright and Chromium are optional: where they are missing (CI, a bare machine), `browser()` returns null and the tests that need it are skipped, said loud.
//   CURIOSA_CHROMIUM=/path/to/chrome   force the browser binary (default: the newest one under PLAYWRIGHT_BROWSERS_PATH or /opt/pw-browsers)
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

function chromiumPath() {
  if (process.env.CURIOSA_CHROMIUM && fs.existsSync(process.env.CURIOSA_CHROMIUM)) return process.env.CURIOSA_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!fs.existsSync(root)) return null;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) { const f = path.join(root, d, sub); if (fs.existsSync(f)) return f; }
  return null;
}

async function loadPlaywright() {
  for (const from of [import.meta.url, "file:///opt/node22/lib/node_modules/", "file:///usr/lib/node_modules/", "file:///usr/local/lib/node_modules/"]) {
    try { return createRequire(from)("playwright"); } catch { /* try the next place */ }
  }
  return null;
}

let shared = null;
/** { chromium, executablePath } or null. One browser for the whole test file. */
export async function browser() {
  if (shared !== null) return shared || null;
  const pw = await loadPlaywright(), exe = chromiumPath();
  if (!pw || !exe) { shared = false; return null; }
  shared = await pw.chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  return shared;
}
export async function closeBrowser() { if (shared) await shared.close(); shared = null; }

/** Serves `routes` (the module's routes) for the context `ctx` on a free local port. `down()` makes every request fail with 503 (a lost connection). */
export async function serve(def, ctx, { onRequest } = {}) {
  const state = { down: false };
  const server = http.createServer(async (req, res) => {
    try {
      if (state.down) { res.writeHead(503); res.end("down"); return; }
      const url = new URL(req.url, "http://127.0.0.1");
      const name = url.pathname.split("/").pop();
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const request = new Request(`https://x.test${url.pathname}${url.search}`, { method: req.method, headers: { "x-forwarded-for": "9.9.9.9", "content-type": req.headers["content-type"] || "application/json" }, body: req.method === "GET" || req.method === "HEAD" ? undefined : body });
      onRequest?.(name, request);
      const handler = def.routes[name];
      if (!handler) { res.writeHead(404); res.end("nope"); return; }
      const r = await handler(request, ctx);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.writeHead(500); res.end(String(e?.message ?? e)); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return { port, base: `http://127.0.0.1:${port}`, state, close: () => new Promise((r) => server.close(r)), down: (v = true) => { state.down = v; } };
}
