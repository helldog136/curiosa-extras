// Pages for the capture of the mascot in the CORNER OF THE SITE with an animation (not run by npm test): a plain page that loads the REAL visitor script and the REAL style sheet of the module,
// the sentences and the pictures served by the capture script. Invented data only.
//   cd $CURIOSA_DIR && node --import ./tests/helpers/register.mjs <this repository>/tests/visual/render-site-mascot.mjs <pages folder>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const CORE = process.env.CURIOSA_DIR ?? process.cwd();
const sharp = createRequire(`${CORE}/package.json`)("sharp");
const OUT = path.resolve(process.argv[2]);
const here = path.dirname(new URL(import.meta.url).pathname);
const K = await import(path.join(here, "../helpers/mascotKit.mjs"));
fs.mkdirSync(path.join(OUT, "uploads"), { recursive: true });
const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PIC = (n) => `/uploads/${UUID(n)}.png`;
const face = (eyes, mouth, hue) => `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><circle cx="80" cy="84" r="62" fill="${hue}"/><path d="M80 14c-4-14-18-18-30-12 4 14 14 20 30 12z" fill="#e08a2e"/>${eyes}${mouth}</svg>`;
const open = '<circle cx="58" cy="76" r="8" fill="#1f2430"/><circle cx="102" cy="76" r="8" fill="#1f2430"/>', shut = '<path d="M48 78q10-10 20 0M92 78q10-10 20 0" stroke="#1f2430" stroke-width="5" fill="none" stroke-linecap="round"/>';
const small = '<path d="M62 106q18 12 36 0" stroke="#1f2430" stroke-width="5" fill="none" stroke-linecap="round"/>', wide = '<ellipse cx="80" cy="110" rx="16" ry="12" fill="#1f2430"/>';
// idle: blinking (warm colour); talking: mouth open and shut (same face, another hue) : easy to tell apart on a capture.
const drawings = { 1: face(open, small, "#e0803a"), 2: face(shut, small, "#e0803a"), 3: face(open, small, "#e0803a"), 11: face(open, wide, "#3aa0e0"), 12: face(open, small, "#3aa0e0") };
for (const [n, svg] of Object.entries(drawings)) await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, "uploads", `${UUID(+n)}.png`));

const ctx = await K.publishedCtx({ delay: 3 }, { locale: "en", permissions: [...K.manifest.permissions] });
await K.store.saveConfig(ctx, { anim: { idle: { mode: "frames", frames: [1, 2, 3].map((n) => ({ src: PIC(n), bytes: 9000 })), fps: 3 }, talk: { mode: "frames", frames: [11, 12].map((n) => ({ src: PIC(n), bytes: 9000 })), fps: 4 } } });
const built = await K.assets.buildClient(ctx);
const css = `${K.assets.CSS}\n${K.assets.ANIM_CSS}`;
fs.writeFileSync(path.join(OUT, "mascot.js"), built.code);
fs.writeFileSync(path.join(OUT, "mascot.css"), css);
fs.writeFileSync(path.join(OUT, "lines.json"), JSON.stringify({ items: [{ id: "a", kind: "hello", text: "Hello, welcome to the site." }, { id: "b", kind: "tip", text: "Tip: the menu has everything you need." }] }));
const cfg = built.cfg;
for (const theme of ["light", "dark"]) {
  const tokens = theme === "dark" ? "--v-bg:#14161d;--v-fg:#eef0f6;--v-surface:#1e212b;--v-muted:#a6adbd;--v-line:#3a3f50;--v-accent:#8a97ff;--v-accent2:#e0803a" : "--v-bg:#faf7f2;--v-fg:#1f2430;--v-surface:#ffffff;--v-muted:#566070;--v-line:#d5d8e0;--v-accent:#3b4cca;--v-accent2:#e0803a";
  fs.writeFileSync(path.join(OUT, `site-${theme}.html`), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo site</title><style>:root{${tokens}}body{margin:0;font:16px/1.5 system-ui,sans-serif;background:var(--v-bg);color:var(--v-fg)}main{max-width:720px;margin:0 auto;padding:32px 16px}h1{margin:0 0 12px}p{margin:0 0 16px;max-width:60ch}</style></head><body><main><h1>Demo site</h1><p>A page of an invented site, to see the mascot in its corner.</p><p>The mascot appears after a short wait, says a sentence, then steps aside.</p></main><script>${built.code.replace(new RegExp(cfg.c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "g"), "/mascot.css").replace(`"b":"${cfg.b}"`, '"b":""')}</script></body></html>`);
}
console.log("site pages written", built.code.length);
