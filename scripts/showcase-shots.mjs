#!/usr/bin/env node
// Showcase screenshots: boots a THROWAWAY Curiosa (the published, compiled core + a fresh SQLite database), installs every module of this checkout,
// seeds INVENTED demo data, signs in as a demo admin and photographs each module's admin page and public face with Chromium.
// Output: showcase/modules/<id>/shots/<file>.webp (<= 80 KB, 1280 px wide; 390 px for a mobile shot) and showcase/shared/*.webp.
//   node scripts/showcase-shots.mjs [module…]   photograph all modules, or these
//   --setup-only   download and prepare the core, then stop        --keep   keep the working folder
//   --work <dir>   working folder (default: <system temp>/showcase-work; about 1 GB)        --core <x.y.z>   core version (default CORE_VERSION)
//   --png <dir>    also keep the PNG of every shot there (to LOOK at them before committing)
// Needs: Node 22, git, curl, tar, npm, a Chromium (CHROMIUM_PATH, or one under /opt/pw-browsers or ~/.cache/ms-playwright) and the `playwright` package
// (PLAYWRIGHT_MODULE=<folder holding node_modules/playwright>, or /opt/node-tools). Nothing is installed into this repository.
// How: the core's own visual harness (scripts/visual: fixed clock, no network, demo content for ~25 modules) builds the site; scripts/showcase/seed.mjs adds the
// demo streamer and the demo data (scripts/showcase/demo/<module>.mjs). What is photographed: scripts/showcase/plan.mjs.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { PLAN, SHARED, defaultShots, VIEWS } from "./showcase/plan.mjs";

export const CORE_VERSION = "0.6.15";
export const MAX_BYTES = 80 * 1024;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const skipValues = new Set(["--work", "--core", "--png"].flatMap((f) => (argv.includes(f) ? [argv[argv.indexOf(f) + 1]] : [])));
const only = argv.filter((a) => !a.startsWith("--") && !skipValues.has(a));
const version = opt("core", CORE_VERSION);
const work = path.resolve(opt("work", path.join(os.tmpdir(), "showcase-work")));
const pngDir = opt("png", "");
const run = (cmd, args, o = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 1 << 28, ...o });
const t0 = Date.now();

/* 1. the core: compiled release + the source of the same tag (for the harness and the seed) */
const app = path.join(work, "core"), src = path.join(work, "coresrc"), vis = path.join(work, "vis");
fs.mkdirSync(work, { recursive: true });
process.env.TMPDIR = path.join(work, "tmp"); fs.mkdirSync(process.env.TMPDIR, { recursive: true });
if (!fs.existsSync(path.join(app, ".next"))) {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const tgz = path.join(work, "core.tgz");
  console.log(`downloading the compiled core v${version}…`);
  run("curl", ["-fsSL", "-o", tgz, `https://github.com/helldog136/Curiosa/releases/download/v${version}/curiosa-v${version}-linux-${arch}.tar.gz`]);
  fs.mkdirSync(app, { recursive: true }); run("tar", ["-xzf", tgz, "-C", app]); fs.rmSync(tgz);
  const ts = path.join(work, "ts"); fs.mkdirSync(ts, { recursive: true }); fs.writeFileSync(path.join(ts, "package.json"), "{}");
  run("npm", ["install", "--no-audit", "--no-fund", "--prefix", ts, "typescript@5.9.3"]); // the release has no TypeScript; the core's test loader needs it
  fs.cpSync(path.join(ts, "node_modules/typescript"), path.join(app, "node_modules/typescript"), { recursive: true }); fs.rmSync(ts, { recursive: true });
}
if (!fs.existsSync(path.join(src, "scripts/visual"))) {
  console.log(`cloning the core source v${version} (for its test harness)…`);
  run("git", ["clone", "-q", "--depth", "1", "--branch", `v${version}`, "https://github.com/helldog136/Curiosa.git", src]);
  for (const n of ["node_modules", ".next", ".env.example"]) if (!fs.existsSync(path.join(src, n))) fs.symlinkSync(path.join(app, n), path.join(src, n));
}
if (flag("setup-only")) { console.log("core ready:", work); process.exit(0); }

/* 2. the demo site: harness seed + showcase seed */
const env = { ...process.env, VISUAL_ROOT: vis, VISUAL_EXTRAS: root, VISUAL_PORT_BASE: process.env.VISUAL_PORT_BASE ?? "3480", HOME: path.join(work, "home") };
fs.mkdirSync(env.HOME, { recursive: true });
if (!fs.existsSync(path.join(vis, "snapshot/data/curiosa.db"))) {
  console.log("building the demo site (harness)…");
  run(process.execPath, ["scripts/visual/site.mjs", "prepare"], { cwd: src, env, stdio: ["ignore", "inherit", "inherit"] });
  console.log("adding the demo data…");
  const data = path.join(vis, "snapshot/data");
  const seedEnv = { ...env, DATA_DIR: data, DATABASE_URL: `file:${data}/curiosa.db`, SITE_URL: "http://127.0.0.1:3481", AUTH_SECRET: "showcase-demo-secret", CURIOSA_ALLOW_LOCAL_MODULES: "1", CURIOSA_CATALOGUE_RUNTIME: "0", CURIOSA_CATALOGUE_REPO: "file:///nonexistent/curiosa-extras", VISUAL_NOW: "2026-06-15T10:00:00.000Z", VISUAL_SEED: "curiosa-visual-1", VISUAL_NET_LOG: path.join(vis, "snapshot/seed-net.log"), NODE_OPTIONS: `--require ${src}/scripts/visual/preload.cjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --disable-warning=ExperimentalWarning` };
  run(process.execPath, ["--import", "./tests/helpers/register.mjs", path.join(root, "scripts/showcase/seed.mjs")], { cwd: src, env: seedEnv, stdio: ["ignore", "inherit", "inherit"] });
}
const PORT = Number(env.VISUAL_PORT_BASE) + 1; // the harness' "daylight" profile (light theme)
try { run(process.execPath, ["scripts/visual/site.mjs", "up", "daylight"], { cwd: src, env }); } catch (e) { console.error("the demo site did not start:", e.message); process.exit(1); }
const base = `http://127.0.0.1:${PORT}`;
const stop = () => { try { run(process.execPath, ["scripts/visual/site.mjs", "down", "daylight"], { cwd: src, env }); } catch { /* already stopped */ } };
process.on("exit", stop);

/* 3. Chromium */
const need = (name) => { for (const b of [process.env.PLAYWRIGHT_MODULE, "/opt/node-tools/node_modules", `${src}/node_modules`].filter(Boolean)) { try { return createRequire(path.join(b, "x.js"))(name); } catch { /* next */ } } throw new Error(`${name} not found: set PLAYWRIGHT_MODULE`); };
const { chromium } = need("playwright");
const sharp = createRequire(path.join(app, "package.json"))("sharp");
function chromiumPath() {
  const c = [process.env.CHROMIUM_PATH, ...["/opt/pw-browsers", path.join(os.homedir(), ".cache/ms-playwright")].flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse().map((x) => path.join(d, x, "chrome-linux/chrome")) : []))].filter(Boolean);
  const p = c.find((x) => fs.existsSync(x)); if (!p) throw new Error("no Chromium found: set CHROMIUM_PATH"); return p;
}
const SHIM = fs.readFileSync(path.join(src, "scripts/visual/lib/page-shim.js"), "utf8").replace("__NOW__", "2026-06-15T10:00:00.000Z");
const svgFor = (u) => { let h = 0; for (const ch of u) h = (h * 31 + ch.charCodeAt(0)) >>> 0; const a = h % 360, b = (a + 50) % 360; return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${a} 55% 62%)"/><stop offset="1" stop-color="hsl(${b} 60% 38%)"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="200" cy="170" r="70" fill="#fff" opacity=".22"/><rect x="90" y="270" width="220" height="70" rx="35" fill="#fff" opacity=".22"/></svg>`; };

/* 4. what to photograph */
const db = new DatabaseSync(path.join(vis, "run-daylight/data/curiosa.db"), { readOnly: true });
const instances = db.prepare("select moduleId, id, key, basePath from ModuleInstance order by createdAt").all();
const firstOf = (m) => instances.find((i) => i.moduleId === m);
const sitemap = (await (await fetch(`${base}/sitemap.xml`)).text()).match(/<loc>[^<]+/g)?.map((l) => l.slice(5).replace(base, "")) ?? [];
const ids = fs.readdirSync(path.join(root, "modules")).filter((d) => fs.existsSync(path.join(root, "modules", d, "module.json"))).sort().filter((d) => !only.length || only.includes(d));

const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb", "--font-render-hinting=none", "--hide-scrollbars", "--force-device-scale-factor=1"] });
const login = async (ctx) => {
  const p = await ctx.newPage(); let token = null;
  p.on("response", async (r) => { const h = await r.allHeaders().catch(() => ({})); const m = /authjs\.session-token=([^;]+)/.exec(h["set-cookie"] ?? ""); if (m) token = m[1]; });
  await p.goto(`${base}/admin/login`);
  await p.fill("#login-email", "owner@example.org"); await p.fill("#login-password", "visual-harness-only"); await p.click("button[type=submit]");
  for (let i = 0; i < 80 && !token; i++) await p.waitForTimeout(250);
  await p.close(); if (!token) throw new Error("demo sign-in failed");
  // the server's clock is frozen in the past: its own cookie expiry would already be over for the browser, so the cookie gets a real one
  await ctx.addCookies([{ name: "authjs.session-token", value: token, url: base, httpOnly: true, expires: Math.floor(Date.now() / 1000) + 86400 }]);
  await ctx.addCookies([{ name: "curiosa_cookies", value: "no", url: base, expires: Math.floor(Date.now() / 1000) + 86400 * 20 }]); // the cookie banner is answered
};
async function newContext(view, shim) {
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: 1, locale: "en-GB", timezoneId: "Europe/Paris", colorScheme: "light", reducedMotion: "reduce" });
  if (shim) await ctx.addInitScript(SHIM);
  await ctx.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(base) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
    return route.request().resourceType() === "image" ? route.fulfill({ status: 200, contentType: "image/svg+xml", body: svgFor(u) }) : route.abort("blockedbyclient");
  });
  await login(ctx);
  return ctx;
}
const ctxs = {};
const ctxFor = async (v, shim = true) => (ctxs[`${v}${shim}`] ??= await newContext(VIEWS[v], shim));
/** Masks anything that looks like a secret (the demo ones are throw-away, but a picture must never show an address with a code in it). */
const MASK = () => {
  const re = /([?&](?:k|key|token|code)=)[A-Za-z0-9_\-.]{6,}/g, re2 = /(Bearer\s+)[A-Za-z0-9_\-.]{6,}/g;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  for (const n of nodes) { const t = n.nodeValue.replace(re, "$1••••••••").replace(re2, "$1••••••••"); if (t !== n.nodeValue) n.nodeValue = t; }
  for (const el of document.querySelectorAll("input,textarea")) if (/[?&](?:k|key|token|code)=/.test(el.value)) el.value = el.value.replace(re, "$1••••••••");
  for (const a of document.querySelectorAll("a[href*='k=']")) a.removeAttribute("href");
  document.querySelectorAll("svg[aria-label*='QR' i], canvas, img[alt*='QR' i]").forEach((e) => { if (!e.closest("[data-keep-qr]")) e.style.filter = "blur(6px)"; });
};
const STYLE = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`;
const problems = [], made = [];
function urlFor(id, shot) {
  const i = firstOf(id);
  if (shot.path) return shot.path.replace("{id}", i?.id ?? "").replace("{key}", i?.key ?? id);
  if (shot.kind === "admin") return `/admin/instances/${i.id}${shot.tab ? `?tab=${shot.tab}` : ""}`;
  if (shot.kind === "overlay") return `/overlays/${i.key}?lang=en`;
  const seg = i.basePath ?? i.key;
  return sitemap.find((u) => u === `/en/${seg}`) ?? sitemap.find((u) => u.startsWith(`/en/${seg}`)) ?? `/en/${seg}`;
}
async function capture(label, outFile, shot, id) {
  const ctx = await ctxFor(shot.view ?? (shot.kind === "mobile" ? "mobile" : "desktop"), !shot.noShim);
  const page = await ctx.newPage();
  try {
    const url = id ? urlFor(id, shot) : shot.path;
    await page.goto(base + url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => page.waitForTimeout(500));
    await page.addStyleTag({ content: STYLE + (shot.kind === "overlay" ? "html,body{background:#1b1d2a!important}" : "") });
    if (shot.prep) await shot.prep(page, { base, id, instances });
    await page.waitForTimeout(shot.wait ?? 600);
    await page.evaluate(MASK);
    const text = (await page.innerText("body").catch(() => "")).slice(0, 4000);
    const png = await page.screenshot({ clip: shot.clip, fullPage: false });
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    let webp;
    for (let q = 82; q >= 40; q -= 8) { webp = await sharp(png).webp({ quality: q, effort: 6 }).toBuffer(); if (webp.length <= MAX_BYTES) break; }
    if (webp.length > MAX_BYTES) problems.push(`${label}: ${webp.length} bytes after compression`);
    fs.writeFileSync(outFile, webp);
    if (pngDir) { fs.mkdirSync(pngDir, { recursive: true }); fs.writeFileSync(path.join(pngDir, `${label.replace("/", "--").replace(/\.webp$/, "")}.png`), png); }
    const stats = await sharp(png).stats(); const spread = stats.channels.slice(0, 3).reduce((s, c) => s + c.stdev, 0) / 3;
    if (/Connexion|Sign in|Application error|Internal Server Error|This page could not be found/.test(text.slice(0, 600))) problems.push(`${label}: looks like a login/error page (${url})`);
    if ((text.match(/\b(le|la|les|des|une|du|avec|pour|dans|sur|est|vous|votre|nous)\b/gi) ?? []).length >= 4) problems.push(`${label}: French text in an English shot (${url})`);
    if (spread < 12) problems.push(`${label}: mostly empty (stdev ${spread.toFixed(1)}, ${url})`);
    made.push({ label, bytes: webp.length, url });
  } catch (e) { problems.push(`${label}: ${String(e.message).split("\n")[0]}`); } finally { await page.close(); }
}
for (const id of ids) {
  const mf = JSON.parse(fs.readFileSync(path.join(root, "modules", id, "module.json"), "utf8"));
  if (!firstOf(id)) { problems.push(`${id}: not installed in the demo site`); continue; }
  for (const s of PLAN[id] ?? defaultShots(mf)) await capture(`${id}/${s.file}`, path.join(root, "showcase/modules", id, "shots", s.file), s, id);
}
if (!only.length) for (const [file, s] of Object.entries(SHARED)) await capture(`shared/${file}`, path.join(root, "showcase/shared", file), { kind: "public", ...s });
await browser.close(); stop();
if (!flag("keep")) fs.rmSync(work, { recursive: true, force: true });
console.log(`${made.length} shots, ${(made.reduce((s, m) => s + m.bytes, 0) / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
fs.writeFileSync(path.join(os.tmpdir(), "showcase-shots-report.json"), JSON.stringify({ made, problems }, null, 1));
if (problems.length) { console.log(`\n${problems.length} thing(s) to look at:`); for (const p of problems) console.log(" -", p); }
