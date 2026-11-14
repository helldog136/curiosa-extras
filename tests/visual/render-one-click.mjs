// Captures of the one-click set-up of the alerts overlay (Twitch activity 1.6.0, Twitch bot 1.20.0), not run by npm test. The blocks are rendered by the REAL components
// of the core (AdminTable, AdminBlockForm), without JavaScript; the states come from the REAL connector module behind the fake Twitch (revoked token, missing permission). Invented data.
//   cd $CURIOSA_DIR && node --import ./tests/helpers/register.mjs <this repository>/tests/visual/render-one-click.mjs <pages folder> <compiled app.css>
// then tests/visual/shoot-core.cjs for the captures (1280 and 390 px, light and dark).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { world as evWorld, mod as evMod } from "../helpers/eventsWorld.mjs";
import { world as botWorld } from "../helpers/botWorld.mjs";

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
    case "banner": return `<div class="rounded-xl border ${tone[b.tone ?? "info"]} bg-surface px-4 py-3 text-[15px]">${esc(b.text)}${b.href ? ` <a class="underline" href="${esc(b.href)}">→</a>` : ""}</div>`;
    case "suggestInstall": return `<section class="rounded-2xl border border-line bg-surface p-4"><h2 class="font-semibold">[core block] Missing: a module that ${esc(b.reason)}</h2></section>`;
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

const overlay = (instances) => ({ "alerts-overlay": { name: "Alerts overlay", offers: ["alerts.queue", "alerts.reaction", "alerts.show"].map((service) => ({ service, version: 2 })), instances } });
function events(installed) {
  const w = evWorld({ locale: "en", installedModules: installed });
  const base = w.ctx.api.services;
  w.ctx.api.services = { ...base, providers: async (n) => (n === "alerts.reaction" ? (installed["alerts-overlay"]?.instances ? [{ id: "al", key: "al", name: "Alerts", module: "alerts-overlay", version: 2, each: true, master: true }] : []) : base.providers(n)),
    call: async (n, ...r) => (n === "alerts.reaction" ? { ok: true, value: { ok: true, types: [] } } : base.call(n, ...r)) };
  w.ctx.api.instances = { ...w.ctx.api.instances, list: async () => (installed["alerts-overlay"]?.instances ? [{ id: "al", key: "al", module: "alerts-overlay", adminPath: "/admin/instances/al" }] : []) };
  return w.ctx;
}
const main = (blocks) => blocks.filter((b) => !b.tab && (b.type !== "table" || b.columns[0] === "Step") && b.type !== "adminForm" || (b.type === "adminForm" && !b.tab && b.action === "setUpAlerts"));
const c1 = events(overlay(0));
write("1-setup-main", "Twitch activity: overlay installed, no copy", main(await evMod.adminPanel(c1, { query: {} })));
write("2-setup-types", "Twitch activity: Types tab", (await evMod.adminPanel(c1, { query: { tab: "types" } })).filter((b) => b.tab === "types" && b.type !== "refreshWhile" && b.type !== "table"));
await evMod.adminActions.setUpAlerts(c1, {});
write("3-done-main", "Twitch activity: after the click", main(await evMod.adminPanel(c1, { query: { setup: "done" } })));
write("4-absent-main", "Twitch activity: overlay not installed", main(await evMod.adminPanel(events({}), { query: {} })));
const b = botWorld({ locale: "en", installedModules: overlay(0), permissions: ["routes", "storage", "admin", "topics", "mcp", "instances.setup"] });
const botAdmin = await import("../../modules/twitch-bot/admin.mjs");
const win = (await botAdmin.panel(b.ctx, { query: { new: "1" } })).filter((x) => x.type === "adminForm" && x.presentation === "dialog");
write("5-bot-window", "Twitch bot: new command window", win.map((f) => ({ ...f, presentation: undefined })));
