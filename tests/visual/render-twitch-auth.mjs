// Captures of the Twitch connector page and of "My Twitch channel" when the Twitch authorization stops working, not run by npm test. The blocks are rendered by the REAL components
// of the core (AdminTable, AdminBlockForm), without JavaScript; the states come from the REAL connector module behind the fake Twitch (revoked token, missing permission). Invented data.
//   cd $CURIOSA_DIR && node --import ./tests/helpers/register.mjs <this repository>/tests/visual/render-twitch-auth.mjs <pages folder> <compiled app.css>
// then tests/visual/shoot-core.cjs for the captures (1280 and 390 px, light and dark).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fakeCtx } from "../helpers/fakeCtx.mjs";
import { fakeTwitch } from "../helpers/fakeTwitch.mjs";
import { connector, connectorCallback, connectorDef } from "../helpers/twitchConnector.mjs";

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
const channel = await import("../../modules/twitch-channel/index.mjs");
const hl = await import("../../modules/twitch-connector/health.mjs");
const en = JSON.parse(fs.readFileSync(new URL("../../modules/twitch-channel/locales/en.json", import.meta.url), "utf8"));
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

hl.timing.cacheMs = 0;
const realFetch = globalThis.fetch;
const world = async (scopes) => {
  const tw = fakeTwitch({ redirects: new Set([connectorCallback()]), login: "etoile_nord" });
  globalThis.fetch = (u, i) => tw.fetch(u, i);
  const C = connector({ messages: JSON.parse(fs.readFileSync(new URL("../../modules/twitch-connector/locales/en.json", import.meta.url), "utf8")), locale: "en" });
  await C.methods.register({ channel: "etoile_nord" });
  await C.methods.wantScopes({ channel: "etoile_nord", consumer: "tw", slot: "main", scopes });
  const link = await C.methods.connectLink({ channel: "etoile_nord", slot: "main" });
  await C.callback(new Request(tw.approve(link.url)));
  return { tw, C };
};
const revoke = async ({ tw, C }) => { const [e] = await C.ctx.api.store.list("twitchConnections"); for (const t of [e.data.access, e.data.refresh]) for (const m of [tw.access, tw.refresh]) if (m.has(t)) m.get(t).valid = false; };
const SUB = "channel:read:subscriptions", FOL = "moderator:read:followers";

{ const w = await world([FOL, SUB]); write("1-connector-ok", "Twitch connector (all works)", await connectorDef.adminPanel(w.C.ctx)); }
{ const w = await world([FOL, SUB]); await revoke(w); write("2-connector-renew", "Twitch connector (authorization to renew)", await connectorDef.adminPanel(w.C.ctx)); }
{ const w = await world([SUB]); await w.C.methods.request({ as: "user", slot: "main", method: "GET", path: "channels/followers", query: { broadcaster_id: ["777"] }, channel: "etoile_nord" }); write("3-connector-scopes", "Twitch connector (missing permission)", await connectorDef.adminPanel(w.C.ctx)); }
{
  const w = await world([FOL, SUB]); await revoke(w); await w.C.methods.health({ channel: "etoile_nord", check: true });
  const ctx = fakeCtx({ key: "tw", locale: "en", messages: en, settings: { channel: "etoile_nord", trackStats: true, statsFollowers: true, statsPaying: true }, services: { "twitch.api": w.C.methods } });
  write("4-channel-renew", "My Twitch channel (authorization to renew)", await channel.default.adminPanel(ctx));
}
globalThis.fetch = realFetch;
