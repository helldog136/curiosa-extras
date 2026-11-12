// Captures of the Mascot administration (Animation and Voice tabs), not run by npm test. The blocks are rendered by the REAL components of the core (Blocks, AdminBlockForm, AdminTable), without JavaScript;
// the preview frame shows the REAL page of the overlay element (served from the pages folder, with its real script). Sample pictures are drawn here; everything is invented data.
//   cd $CURIOSA_DIR && node --import ./tests/helpers/register.mjs <this repository>/tests/visual/render-mascot.mjs <pages folder> <compiled app.css>
// then tests/visual/shoot-mascot.cjs for the captures (1280 and 390 px, light and dark; the frame is clicked where a scene asks for it).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const CORE = process.env.CURIOSA_DIR ?? process.cwd();
const { renderToStaticMarkup } = createRequire(`${CORE}/package.json`)("react-dom/server");
const sharp = createRequire(`${CORE}/package.json`)("sharp");
const OUT = path.resolve(process.argv[2]);
const CSS = fs.readFileSync(process.argv[3], "utf8");
const React = createRequire(`${CORE}/package.json`)("react");
const h = React.createElement;
const { adminThemeCss } = await import("@/core/adminTheme");
const { HelpTipProvider } = await import("@/components/admin/HelpTip");
const kit = await import("@/components/site/adminKit");
const { formLabels, tableLabels } = await import("@/components/admin/kitLabels");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const tone = { info: "border-line", success: "border-success", warning: "border-warning" };
/** The blocks the core draws, with its real components (the same way as the other capture scripts of this repository). */
function renderBlock(b, locale) {
  const tr = makeTranslator(locale);
  switch (b.type) {
    case "heading": return `<h2 class="text-xl font-semibold">${esc(b.text)}</h2>`;
    case "markdown": return `<p class="text-[15px] leading-relaxed">${esc(b.text)}</p>`;
    case "html": return `<div>${b.html}</div>`;
    case "banner": return `<div class="rounded-xl border ${tone[b.tone ?? "info"]} bg-surface px-4 py-3 text-[15px]">${esc(b.text)}</div>`;
    case "table": return renderToStaticMarkup(h(kit.AdminTable, { block: b, instanceId: "i1", labels: tableLabels(tr) }));
    case "adminForm": return renderToStaticMarkup(h(HelpTipProvider, { label: "?" }, h(kit.AdminBlockForm, { instanceId: "i1", block: b, labels: formLabels(tr, locale, b) })));
    default: return "";
  }
}
const here = path.dirname(new URL(import.meta.url).pathname);
const K = await import(path.join(here, "../helpers/mascotKit.mjs"));
fs.mkdirSync(path.join(OUT, "uploads"), { recursive: true });

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PIC = (n) => `/uploads/${UUID(n)}.png`;
// Four little faces (a blink and a wide mouth): invented drawings.
const face = (eyes, mouth, hue) => `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><circle cx="80" cy="84" r="62" fill="${hue}"/><path d="M80 14c-4-14-18-18-30-12 4 14 14 20 30 12z" fill="#41b48a"/>${eyes}${mouth}</svg>`;
const open = '<circle cx="58" cy="76" r="8" fill="#1f2430"/><circle cx="102" cy="76" r="8" fill="#1f2430"/>', shut = '<path d="M48 78q10-10 20 0M92 78q10-10 20 0" stroke="#1f2430" stroke-width="5" fill="none" stroke-linecap="round"/>';
const small = '<path d="M62 106q18 12 36 0" stroke="#1f2430" stroke-width="5" fill="none" stroke-linecap="round"/>', wide = '<ellipse cx="80" cy="110" rx="16" ry="12" fill="#1f2430"/>';
const sheets = [face(open, small, "#7c6bf0"), face(shut, small, "#7c6bf0"), face(open, wide, "#8f7ff5"), face(open, small, "#6f5fe0")];
for (const [i, svg] of sheets.entries()) { await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, "uploads", `${UUID(i + 1)}.png`)); await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, "uploads", `${UUID(i + 11)}.png`)); }

const page = (title, body, theme) => `<!doctype html><html lang="en" data-admin-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${CSS}</style><style>${adminThemeCss()}</style></head>
<body class="min-h-screen bg-bg text-fg antialiased"><main class="mx-auto max-w-5xl space-y-6 p-4 md:p-6"><h1 class="text-2xl font-semibold">${title}</h1>${body}</main></body></html>`;

async function write(name, title, ctx, tab, { errors = {}, voiceFrame = false } = {}) {
  const blocks = (await K.def.adminPanel(ctx, { query: {} })).filter((b) => b.tab === tab);
  let body = blocks.map((b) => renderBlock(b, "en")).join("\n");
  // The page of the element in the frame: the real one, written next to the page (the preview address of the administration points to the site).
  const r = await K.def.routes["element/:slug"](K.get(`/m/${ctx.instance.key}/element/mascot?lang=en&ov-demo=1&ov-test=1&ov-text=light&ov-surface=soft&ov-corners=round&opt-seconds=20`), Object.assign(ctx, { params: { slug: "mascot" } }));
  fs.writeFileSync(path.join(OUT, `overlay-${name}.html`), await r.text());
  body = body.replace(/src="\/m\/[^"]*"/g, `src="overlay-${name}.html"`);
  // Errors the real actions return are shown under their field, as the page does when it is alive.
  for (const [field, message] of Object.entries(errors)) body = body.replace(new RegExp(`(<[^>]*name="${field}"[^>]*>)`), `$1<p data-field-error class="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-red-700"><span aria-hidden="true">\u26A0</span>${esc(message)}</p>`);
  for (const theme of ["light", "dark"]) fs.writeFileSync(path.join(OUT, `${name}-${theme}.html`), page(title, body, theme));
  console.log(name, body.length, voiceFrame ? "(frame clicked)" : "");
}
const mk = async (patch, settings = {}) => {
  const ctx = await K.publishedCtx(settings, { locale: "en", permissions: [...K.manifest.permissions] });
  await K.store.saveConfig(ctx, patch);
  return ctx;
};
const frames = (from, n) => Array.from({ length: n }, (_, i) => ({ src: PIC(from + i), bytes: 18_000 + i * 700 }));
const anim = { idle: { mode: "frames", frames: frames(1, 4), fps: 0 }, talk: { mode: "frames", frames: frames(11, 4), fps: 10 } };

await write("1-anim-start", "Mascot: Animation (first visit)", await mk({}), "animation");
await write("2-anim-frames", "Mascot: Animation (pictures added)", await mk({ anim }), "animation");
{
  const ctx = await mk({ anim });
  const err = await K.def.adminActions.saveAnim.run(ctx, { which: "idle", mode: "frames", fps: "99" });
  await write("3-anim-error", "Mascot: Animation (an error)", ctx, "animation", { errors: err.errors });
}
await write("4-voice-none", "Mascot: Voice (none)", await mk({ anim }), "voice");
await write("5-voice-blips", "Mascot: Voice (blips)", await mk({ anim, voice: { mode: "blips", volume: 40 } }), "voice", { voiceFrame: true });
await write("6-voice-speech", "Mascot: Voice (voice of the computer)", await mk({ anim, voice: { mode: "speech", volume: 40 } }), "voice", { voiceFrame: true });
await write("7-voice-custom", "Mascot: Voice (your own sound)", await mk({ anim, voice: { mode: "custom", volume: 40 } }, { voiceFile: `/uploads/${UUID(900)}.mp4` }), "voice");
{
  const ctx = await mk({ anim, voice: { mode: "blips", volume: 40 } });
  const err = await K.def.adminActions.saveVoice.run(ctx, { volume: "500" });
  await write("8-voice-error", "Mascot: Voice (an error)", ctx, "voice", { errors: err.errors });
}
