// Captures of the command window of the Twitch bot with several pictures or videos (1.19.0), not run by npm test. The blocks are rendered by the REAL components
// of the core (AdminTable, AdminBlockForm), without JavaScript; the states come from the REAL connector module behind the fake Twitch (revoked token, missing permission). Invented data.
//   cd $CURIOSA_DIR && node --import ./tests/helpers/register.mjs <this repository>/tests/visual/render-bot-media.mjs <pages folder> <compiled app.css>
// then tests/visual/shoot-core.cjs for the captures (1280 and 390 px, light and dark).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fakeCtx } from "../helpers/fakeCtx.mjs";
import { world as botWorld } from "../helpers/botWorld.mjs";
const alMan = JSON.parse(fs.readFileSync(new URL("../../modules/alerts-overlay/module.json", import.meta.url), "utf8")), alEn = JSON.parse(fs.readFileSync(new URL("../../modules/alerts-overlay/locales/en.json", import.meta.url), "utf8"));
const tw = await import("../../modules/alerts-overlay/twitch.mjs"), alDef = (await import("../../modules/alerts-overlay/index.mjs")).default, md = await import("../../modules/alerts-overlay/media.mjs");
const botAdmin = await import("../../modules/twitch-bot/admin.mjs");

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
const svc = alDef.services["alerts.show"];
async function scene(count, { word = false } = {}) {
  tw.resetTwitchState(); md.resetValve();
  const files = Array.from({ length: count }, (_, i) => (i >= 10 ? U(100 + i, "mp4") : U(i + 1, "png")));
  const al = fakeCtx({ key: "shot", moduleId: "alerts-overlay", locale: "en", messages: alEn, settings: {}, permissions: alMan.permissions, uploads: files.map((url) => ({ url, by: "u1" })) });
  const w = botWorld({ locale: "en" });
  const base = w.ctx.api.services;
  w.ctx.api.services = { ...base, providers: async (n) => (n === "alerts.show" ? [{ id: "al", key: "al", name: "Alerts", module: "alerts-overlay", version: 2, each: true, master: true }] : base.providers(n)), call: async (n, m, a, o) => (n === "alerts.show" ? { ok: true, value: await svc[m](al, a) } : base.call(n, m, a, o)) };
  if (count) {
    const r = await svc.add(al, { items: files.map((src) => ({ src })) });
    const ids = files.map((f) => r.ids[f]);
    const made = await botAdmin.actions.create(w.ctx, { name: "merci", text: "Thank you everyone", mediaFiles: JSON.stringify(files.map((src) => ({ src }))), mediaPick: "random", mediaSeconds: "6" });
    if (!made.ok) throw new Error(JSON.stringify(made));
    const list = await botAdmin.panel(w.ctx, { query: { tab: "use" } });
    const t = list.find((b) => b.type === "table" && (b.rowIds ?? []).some((id) => /^custom:/.test(id))) ?? (console.error(JSON.stringify(list.filter((b) => b.type === "table").map((b) => b.rowIds)).slice(0, 400)), null);
    return await botAdmin.panel(w.ctx, { query: { tab: "use", edit: t.rowIds.find((id) => /^custom:/.test(id)) } });
  }
  return await botAdmin.panel(w.ctx, { query: { tab: "use", new: "1" } });
}
const dlg = (blocks) => blocks.filter((b) => b.presentation === "dialog");
write("1-bot-empty", "Command window: no file yet", dlg(await scene(0)));
write("2-bot-three", "Command window: three GIFs", dlg(await scene(3)));
write("3-bot-twelve", "Command window: twelve files", dlg(await scene(12)));
