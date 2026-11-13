// Captures of the reaction window and the Types tab of Twitch activity (1.5.0), not run by npm test. The blocks are rendered by the REAL components
// of the core (AdminTable, AdminBlockForm), without JavaScript; the states come from the REAL connector module behind the fake Twitch (revoked token, missing permission). Invented data.
//   cd $CURIOSA_DIR && node --import ./tests/helpers/register.mjs <this repository>/tests/visual/render-reaction.mjs <pages folder> <compiled app.css>
// then tests/visual/shoot-core.cjs for the captures (1280 and 390 px, light and dark).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fakeCtx } from "../helpers/fakeCtx.mjs";
import { world as evWorld, S, C as CY, mod as evMod } from "../helpers/eventsWorld.mjs";
const alMan = JSON.parse(fs.readFileSync(new URL("../../modules/alerts-overlay/module.json", import.meta.url), "utf8")), alEn = JSON.parse(fs.readFileSync(new URL("../../modules/alerts-overlay/locales/en.json", import.meta.url), "utf8"));
const tw = await import("../../modules/alerts-overlay/twitch.mjs"), alDef = (await import("../../modules/alerts-overlay/index.mjs")).default;

const CORE = process.env.CURIOSA_DIR ?? process.cwd();
const req = createRequire(`${CORE}/package.json`);
const { renderToStaticMarkup } = req("react-dom/server");
const React = req("react");
const h = React.createElement;
const OUT = path.resolve(process.argv[2]);
const CSS = fs.readFileSync(process.argv[3], "utf8");
const { adminThemeCss } = await import("@/core/adminTheme");
const { HelpTipProvider } = await import("@/components/admin/HelpTip");
const kit = await import("@/components/site/adminKit");
const { formLabels, tableLabels } = await import("@/components/admin/kitLabels");
const { makeTranslator } = await import("@/core/i18n/dictionary");
fs.mkdirSync(OUT, { recursive: true });
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const tone = { info: "border-line", success: "border-success", warning: "border-warning" };
function renderBlock(b, locale) {
  const tr = makeTranslator(locale);
  switch (b.type) {
    case "heading": return `<h2 class="text-xl font-semibold">${esc(b.text)}</h2>`;
    case "markdown": return `<p class="text-[15px] leading-relaxed">${esc(b.text)}</p>`;
    case "links": return `<p class="text-[15px]">${b.items.map((i) => `<a class="underline" href="${esc(i.href)}">${esc(i.label)}</a>`).join(" · ")}</p>`;
    case "html": return `<div>${b.html}</div>`;
    case "copy": return `<p class="text-sm text-muted">${esc(b.label)}: <code>${esc(b.text)}</code></p>`;
    case "banner": return `<div class="rounded-xl border ${tone[b.tone ?? "info"]} bg-surface px-4 py-3 text-[15px]">${esc(b.text)}</div>`;
    case "netHealth": return `<p class="text-sm text-muted">${b.items.map((i) => esc(i.label)).join(" · ")}</p>`;
    case "table": return renderToStaticMarkup(h(kit.AdminTable, { block: b, instanceId: "i1", labels: tableLabels(tr) }));
    case "adminForm": return renderToStaticMarkup(h(HelpTipProvider, { label: "?" }, h(kit.AdminBlockForm, { instanceId: "i1", block: b, labels: formLabels(tr, locale, b) })));
    default: return "";
  }
}
const page = (title, body, theme) => `<!doctype html><html lang="en" data-admin-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${CSS}</style><style>${adminThemeCss()}</style></head>
<body class="min-h-screen bg-bg text-fg antialiased"><main class="mx-auto max-w-5xl space-y-6 p-4 md:p-6"><h1 class="text-2xl font-semibold">${title}</h1>${body}</main></body></html>`;
function write(name, title, blocks) {
  const body = blocks.map((b) => renderBlock(b, "en")).join("\n");
  for (const theme of ["light", "dark"]) fs.writeFileSync(path.join(OUT, `${name}-${theme}.html`), page(title, body, theme));
  console.log(name, blocks.length, "blocks");
}



const U = (n, ext) => `/uploads/${String(n).padStart(8, "0")}-0123-4567-89ab-0123456789ab.${ext}`;
const svc = alDef.services["alerts.reaction"];
async function scene({ files = 0, videos = 0, overlay = true, open = null, tweak, form } = {}) {
  tw.resetTwitchState();
  const pics = Array.from({ length: files }, (_, i) => U(i + 1, "png")), clips = Array.from({ length: videos }, (_, i) => U(100 + i, "mp4"));
  const al = fakeCtx({ key: "shot", moduleId: "alerts-overlay", locale: "en", messages: alEn, settings: {}, permissions: alMan.permissions, uploads: [...pics, ...clips].map((url) => ({ url, by: "u1" })) });
  const w = evWorld({ locale: "en", tw: { autoEnable: true } });
  await S.ensureSecret(w.ctx);
  await CY.check(w.ctx, { retentionDays: 30 }, { now: Date.now() }); await CY.check(w.ctx, { retentionDays: 30 }, { now: Date.now() });
  const base = w.ctx.api.services;
  if (overlay) {
    w.ctx.api.services = { ...base, providers: async (n) => (n === "alerts.reaction" ? [{ id: "al", key: "al", name: "Alerts", module: "alerts-overlay", version: 1, each: true, master: true }] : base.providers(n)), call: async (n, m, a, o) => (n === "alerts.reaction" ? { ok: true, value: await svc[m](al, a) } : base.call(n, m, a, o)) };
    w.ctx.api.instances = { ...w.ctx.api.instances, list: async () => [{ id: "al", key: "al", adminPath: "/admin/instances/al" }] };
    const set = (type, patch) => svc.set(al, { type, patch });
    await set("follow", { variants: [...pics, ...clips].map((src) => ({ src })), sound: files + videos ? "chime" : "" });
    await set("raid", { variants: [{ src: U(1, "png") }].slice(0, files ? 1 : 0), pick: "random" });
  } else w.ctx.api.instances = { ...w.ctx.api.instances, list: async () => [] };
  if (tweak) await tweak(w, al);
  let blocks = (await evMod.adminPanel(w.ctx, { query: { tab: "types", ...(open ? { reaction: open } : {}) } })).filter((b) => !b.tab || b.tab === "types" || b.tab === "use");
  if (form) blocks = form(blocks);
  return blocks;
}
const dialogOnly = (blocks) => blocks.filter((b) => b.presentation === "dialog");
const typesOnly = (blocks) => blocks.filter((b) => b.tab === "types");
const withError = (blocks) => blocks.map((b) => (b.presentation === "dialog" ? { ...b, errors: { text: "Unknown word between braces. Use only {name} {count}, for example {name}." } } : b));
write("1-types-ready", "Types tab: Reaction column", typesOnly(await scene({ files: 3 })));
write("2-types-no-overlay", "Types tab: Alerts overlay not installed", typesOnly(await scene({ overlay: false })));
write("3-dialog-empty", "Window: no file yet", dialogOnly(await scene({ open: "sub" })));
write("4-dialog-one", "Window: one GIF", dialogOnly(await scene({ files: 1, open: "follow" })));
write("5-dialog-three", "Window: three GIFs", dialogOnly(await scene({ files: 3, open: "follow" })));
write("6-dialog-twelve", "Window: twelve files", dialogOnly(await scene({ files: 10, videos: 2, open: "follow" })));
write("7-dialog-error", "Window: error under a field", withError(dialogOnly(await scene({ files: 2, open: "follow" }))));
write("8-checklist", "First tab: steps", (await scene({ overlay: false, tweak: async (w) => { await S.updateState(w.ctx, (d) => { d.listen = { ...d.listen, code: "need_connect" }; }); } })).filter((b) => b.type === "table" && !b.tab && b.columns.includes("Step")));
