// Captures of the Types tab of Twitch activity (missing permission, pending subscription), not run by npm test. The blocks are rendered by the REAL components
// of the core (AdminTable, AdminBlockForm), without JavaScript; the states come from the REAL connector module behind the fake Twitch (revoked token, missing permission). Invented data.
//   cd $CURIOSA_DIR && node --import ./tests/helpers/register.mjs <this repository>/tests/visual/render-twitch-events.mjs <pages folder> <compiled app.css>
// then tests/visual/shoot-core.cjs for the captures (1280 and 390 px, light and dark).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fakeCtx } from "../helpers/fakeCtx.mjs";
import { world as evWorld, NOW, S, C as CY, mod as evMod, en as evEn, fr as evFr } from "../helpers/eventsWorld.mjs";

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


const ALL = ["moderator:read:followers", "channel:read:subscriptions", "bits:read", "channel:read:hype_train", "channel:read:redemptions"];
const BEFORE = process.env.BEFORE === "1";   // the old pages met a connector that said "connected" and gave no link
async function shot(name, title, o, tweak) {
  const w = evWorld({ locale: "en", tw: { autoEnable: true, at: NOW, ...o.tw } });
  await S.ensureSecret(w.ctx);
  if (o.enable) await S.updateState(w.ctx, (d) => { d.enabled = o.enable; });
  await CY.check(w.ctx, { retentionDays: 30 }, { now: Date.now() }); await CY.check(w.ctx, { retentionDays: 30 }, { now: Date.now() });
  if (tweak) await tweak(w);
  if (BEFORE) { const svc = w.ctx.api.services, orig = svc.callAll.bind(svc); svc.callAll = async (n, m, a) => (m === "connectLink" ? [{ ok: true, value: { ok: true, url: null, reason: "connected" } }] : orig(n, m, a)); }
  const blocks = (await evMod.adminPanel(w.ctx, { query: {} })).filter((b) => !b.tab || b.tab === "types");
  write(name, title, blocks);
}
const without = (...x) => ALL.filter((s) => !x.includes(s));
await shot(`${BEFORE ? "before" : "after"}-1-missing`, "Types tab: permission missing", { tw: { scopes: without("bits:read", "channel:read:hype_train") } });
await shot(`${BEFORE ? "before" : "after"}-2-rewards-on`, "Types tab: channel point rewards on, permission missing", { tw: { scopes: without("channel:read:redemptions") }, enable: { redeem: true } });
await shot(`${BEFORE ? "before" : "after"}-3-pending`, "Types tab: a type waits for Twitch", { tw: {} }, async (w) => {
  await S.updateState(w.ctx, (d) => { d.listen = { ...d.listen, code: "pending" }; d.types.raid = { code: "pending", at: Date.now(), since: Date.now() - 5 * 60_000, reason: "unreachable" }; });
});
