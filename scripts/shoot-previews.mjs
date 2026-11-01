#!/usr/bin/env node
// Régénère les visuels des fiches d'extensions (modules/<id>/previews/*.webp) à partir de DONNÉES INVENTÉES. Rien de ce qui est montré n'est réel.
//   CURIOSA_DIR=../Curiosa node scripts/shoot-previews.mjs                 toutes les captures
//   CURIOSA_DIR=../Curiosa node scripts/shoot-previews.mjs faq planning    seulement ces modules
//   node scripts/shoot-previews.mjs --check                                 vérifie les visuels déclarés (fichier présent, poids, dimensions, type) sans rien générer
// Principe : une « scène » par module (tests/visual/previews/<id>.mjs) fabrique la page avec le VRAI code du module (son rendu public, ses blocs d'administration
// rendus par les vrais composants du cœur) ; Chromium la photographie à 1280 px ; sharp l'enregistre en WebP de 150 Ko au plus. Les légendes et textes alternatifs
// (fr + en) restent dans le module.json du module (clé `previews`) : le script vérifie que chaque scène a sa déclaration et inversement.
// Prérequis : le dossier de Curiosa (CURIOSA_DIR, avec node_modules), Playwright et Chromium (PLAYWRIGHT_MODULE / CHROMIUM_PATH si besoin).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { previewProblems, PREVIEW_LIMITS } from "./rules.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith("--"));
const manifest = (id) => JSON.parse(fs.readFileSync(path.join(root, "modules", id, "module.json"), "utf8"));

if (args.includes("--check")) {
  let bad = 0;
  for (const id of fs.readdirSync(path.join(root, "modules")).sort()) {
    const m = manifest(id);
    if (!m.previews) continue;
    for (const p of previewProblems(m.previews, path.join(root, "modules", id))) { console.error(`${id} : ${p}`); bad++; }
  }
  if (bad) process.exit(1);
  console.log("Visuels déclarés : tous valides.");
  process.exit(0);
}

const core = path.resolve(process.env.CURIOSA_DIR ?? path.join(root, "..", "Curiosa"));
if (!process.env.PREVIEWS_INNER) {
  if (!fs.existsSync(path.join(core, "tests/helpers/register.mjs"))) { console.error(`Curiosa introuvable dans « ${core} » : indiquez CURIOSA_DIR=/chemin/vers/Curiosa.`); process.exit(2); }
  fs.copyFileSync(path.join(core, "tests/helpers/fakeCtx.mjs"), path.join(root, "tests/helpers/fakeCtx.mjs"));
  // Feuille de style du cœur (Tailwind compilé depuis son globals.css) : la même que celle de l'administration et du site.
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), "previews-"));
  const css = path.join(tmp, "core.css");
  const build = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import postcss from "postcss"; import tw from "@tailwindcss/postcss"; import fs from "node:fs";
    const src = fs.readFileSync("src/app/globals.css", "utf8");
    const r = await postcss([tw({ base: process.cwd() })]).process(src, { from: process.cwd() + "/src/app/globals.css" });
    fs.writeFileSync(${JSON.stringify(css)}, r.css);`], { cwd: core, stdio: "inherit" });
  if (build.status !== 0) { console.error("La feuille de style du cœur n'a pas pu être compilée."); process.exit(1); }
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", path.join(core, "tests/helpers/register.mjs"), path.join(root, "scripts/shoot-previews.mjs"), ...args], {
    cwd: core, stdio: "inherit", env: { ...process.env, PREVIEWS_INNER: "1", PREVIEWS_CSS: css, CURIOSA_DIR: core, TMPDIR: tmp, TMP: tmp, TEMP: tmp },
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(r.status ?? 1);
}

// ───────── Dans le dossier de Curiosa, avec son chargeur ─────────
const need = (name, hints) => {
  for (const base of hints.filter(Boolean)) { try { return createRequire(path.join(base, "x.js"))(name); } catch { /* suivant */ } }
  throw new Error(`Module « ${name} » introuvable (cherché dans ${hints.filter(Boolean).join(", ")}).`);
};
const globalRoot = spawnSync("npm", ["root", "-g"], { encoding: "utf8" }).stdout.trim();
const { chromium } = need("playwright", [process.env.PLAYWRIGHT_MODULE, path.join(core, "node_modules"), ...(process.env.NODE_PATH ?? "").split(":"), globalRoot, "/opt/node-tools/node_modules"]);
const sharp = need("sharp", [path.join(core, "node_modules")]);
const kit = await import(path.join(root, "tests/visual/previews/kit.mjs"));

const sceneDir = path.join(root, "tests/visual/previews");
const ids = fs.readdirSync(sceneDir).filter((f) => f.endsWith(".mjs") && f !== "kit.mjs").map((f) => f.slice(0, -4)).sort().filter((id) => !only.length || only.includes(id));
const sizeOf = (s) => ({ width: s.w ?? 1280, height: s.h ?? 800 });

const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });   // chaque page est chargée telle quelle (setContent) : aucun accès réseau
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let failed = 0, made = 0;
try {
  for (const id of ids) {
    const declared = manifest(id).previews ?? [];
    const scene = (await import(path.join(sceneDir, `${id}.mjs`))).default;
    // Horloge figée (lundi 12 octobre 2026, 10 h à Paris) pendant que la scène fabrique ses pages : « Aujourd'hui », « Dans 2 jours », les sondages ouverts… ne dépendent pas du jour du tournage.
    const RealDate = Date, fixed = kit.NOW.getTime();
    globalThis.Date = class extends RealDate { constructor(...a) { if (a.length === 0) super(fixed); else super(...a); } static now() { return fixed; } };
    let shots;
    try { shots = await scene(kit); } finally { globalThis.Date = RealDate; }
    const have = new Set(declared.map((p) => p.file.replace(/^previews\//, "")));
    for (const f of Object.keys(shots)) if (!have.has(f)) { console.error(`${id} : la scène produit « ${f} » mais module.json ne le déclare pas dans previews.`); failed++; }
    for (const f of have) if (!shots[f]) { console.error(`${id} : module.json déclare « ${f} » mais aucune scène ne le produit.`); failed++; }
    fs.mkdirSync(path.join(root, "modules", id, "previews"), { recursive: true });
    for (const [file, s] of Object.entries(shots)) {
      if (!have.has(file)) continue;
      try {
        kit.assertInvented(`${id}/${file}`, s.html, s.allow, s.forbid);
        const ctx = await browser.newContext({ viewport: sizeOf(s), colorScheme: s.scheme ?? "light", deviceScaleFactor: 1, locale: s.lang ?? "fr-FR", timezoneId: "Europe/Paris" });
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route("**/*", (route) => (route.request().url().startsWith("data:") || route.request().url().startsWith("about:") ? route.continue() : route.abort()));   // aucune requête réseau
        await page.setContent(s.html, { waitUntil: "load" });
        // Scripts que la vraie page charge elle-même (le petit script de confort d'un module : recherche en direct, pastilles) : exécutés tels quels avant la capture.
        for (const code of s.scripts ?? []) await page.addScriptTag({ content: code });
        for (const st of s.steps ?? []) { if (st.click) await page.click(st.click); if (st.fill) await page.fill(st.fill[0], st.fill[1]); if (st.eval) await page.evaluate(st.eval); if (st.wait) await page.waitForTimeout(st.wait); }
        await page.waitForTimeout(150);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
        if (overflow) throw new Error("défilement horizontal");
        if (errors.length) throw new Error(`erreur de page : ${errors.join(" | ")}`);
        const png = await page.screenshot({ type: "png" });
        await ctx.close();
        let out = null;
        for (const q of [86, 80, 74, 68, 62, 56, 50, 44, 38]) {
          out = await sharp(png).webp({ quality: q, effort: 6, smartSubsample: true }).toBuffer();
          if (out.length <= PREVIEW_LIMITS.bytes - 4096) break;
        }
        if (out.length > PREVIEW_LIMITS.bytes) throw new Error(`${out.length} octets : trop lourd même à faible qualité`);
        fs.writeFileSync(path.join(root, "modules", id, "previews", file), out);
        console.log(`${id}/${file}  ${sizeOf(s).width}x${sizeOf(s).height}  ${(out.length / 1024).toFixed(0)} Ko`);
        made++;
      } catch (e) { console.error(`${id}/${file} : ${e.message}`); failed++; }
    }
  }
} finally { await browser.close(); server.close(); }
console.log(`${made} capture(s) écrite(s)${failed ? `, ${failed} problème(s)` : ""}.`);
process.exit(failed ? 1 : 0);
