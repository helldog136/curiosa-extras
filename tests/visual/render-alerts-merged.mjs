// Captures for "Twitch activity is part of Alerts overlay" (Alerts overlay 1.18.0, Twitch activity 1.13.0 bridge). Not run by npm test.
// The blocks are rendered by the REAL components of the core (AdminTable, AdminBlockForm...), without JavaScript. Invented data. In the core folder (CURIOSA_DIR):
//   node --import ./tests/helpers/register.mjs <this repository>/tests/visual/render-alerts-merged.mjs <pages folder> <compiled app.css>
// then tests/visual/shoot-core.cjs for the captures (1280 and 390 px, light and dark).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fakeCtx } from "../helpers/fakeCtx.mjs";
import { world, S, C as CY, deliver, EV, TYPES, NOW } from "../helpers/eventsWorld.mjs";

const CORE = process.env.CURIOSA_DIR ?? process.cwd();
const req = createRequire(`${CORE}/package.json`);
const { renderToStaticMarkup } = req("react-dom/server");
const React = req("react");
const OUT = path.resolve(process.argv[2]);
const CSS = fs.readFileSync(process.argv[3], "utf8");
const h = React.createElement;
const { adminThemeCss } = await import("@/core/adminTheme");
const { HelpTipProvider } = await import("@/components/admin/HelpTip");
const kit = await import("@/components/site/adminKit");
const { formLabels, tableLabels } = await import("@/components/admin/kitLabels");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const root = new URL("../../", import.meta.url).pathname;
const json = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const alMan = json("modules/alerts-overlay/module.json"), alFr = json("modules/alerts-overlay/locales/fr.json");
const evFr = json("modules/twitch-events/locales/fr.json");
const index = await import("../../modules/alerts-overlay/index.mjs"), def = index.default;
const bridge = (await import("../../modules/twitch-events/index.mjs")).default;
const evS = await import("../../modules/twitch-events/state.mjs");
fs.mkdirSync(path.join(OUT, "uploads"), { recursive: true });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKElEQVR42mNkYPhfz0ABYBw1gGE0DBhGw4BhNAwYRsOAYTQMGEbDAAAqXwgRzVvU0wAAAABJRU5ErkJggg==", "base64");
const U = (n) => `/uploads/${String(n).padStart(8, "0")}-0123-4567-89ab-0123456789ab.png`;
for (let i = 1; i <= 4; i++) fs.writeFileSync(path.join(OUT, U(i).slice(1)), PNG);

const page = (title, body, theme, open) => `<!doctype html><html lang="fr" data-admin-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${CSS}</style><style>${adminThemeCss()}</style></head>
<body class="min-h-screen bg-bg text-fg antialiased"><main class="mx-auto max-w-5xl space-y-6 p-4 md:p-6"><h1 class="text-2xl font-semibold">${title}</h1>${open ? body.replace(/<details/g, "<details open") : body}</main></body></html>`;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const tone = { info: "border-line", success: "border-success", warning: "border-warning" };
function renderBlock(b) {
  const tr = makeTranslator("fr");
  switch (b.type) {
    case "heading": return `<h2 class="text-xl font-semibold">${esc(b.text)}</h2>`;
    case "markdown": return `<p class="text-[15px] leading-relaxed">${esc(b.text)}</p>`;
    case "links": return `<p class="text-[15px]">${b.items.map((i) => `<a class="underline" href="${esc(i.href)}">${esc(i.label)}</a>`).join(" · ")}</p>`;
    case "html": return `<div>${b.html}</div>`;
    case "copy": return `<div class="rounded-xl border border-line bg-surface p-3 text-sm"><div class="font-medium">${esc(b.label)}</div><code class="break-all font-mono">${esc(b.text)}</code></div>`;
    case "banner": return `<div class="rounded-xl border ${tone[b.tone ?? "info"]} bg-surface px-4 py-3 text-[15px]">${esc(b.text)}</div>`;
    case "table": return renderToStaticMarkup(h(kit.AdminTable, { block: b, instanceId: "i1", labels: tableLabels(tr) }));
    case "adminForm": return renderToStaticMarkup(h(HelpTipProvider, { label: "?" }, h(kit.AdminBlockForm, { instanceId: "i1", block: b, labels: formLabels(tr, "fr", b) })));
    default: return "";
  }
}
async function write(name, title, blocks, { open = false } = {}) {
  const body = blocks.map(renderBlock).join("\n");
  for (const theme of ["light", "dark"]) fs.writeFileSync(path.join(OUT, `${name}-${theme}.html`), page(title, body, theme, open));
  console.log(name, blocks.length, "blocks");
}
const tab = (blocks, id) => blocks.filter((b) => (id === "use" ? !b.tab : b.tab === id) && b.presentation !== "dialog");

// The copy that listens, on a Twitch site: events in the journal, reactions set
const w = world({ locale: "fr", key: "alerts-overlay", tw: { autoEnable: true }, uploads: [1, 2, 3, 4].map((i) => ({ url: U(i), by: "u1" })) });
const ctx = w.ctx;
await S.ensureSecret(ctx);
await CY.check(ctx, { retentionDays: 30 }, { now: Date.now() }); await CY.check(ctx, { retentionDays: 30 }, { now: Date.now() });
const R = index.reactionService;
await R.set(ctx, { type: "follow", patch: { variants: [U(1), U(2), U(3)].map((src) => ({ src })), pick: "rotate", sound: "chime" } });
await R.set(ctx, { type: "raid", patch: { variants: [{ src: U(4) }], text: "{name} arrive avec {viewers} personnes" } });
await R.set(ctx, { type: "cheer", patch: { min: "100", tts: "both" } });
for (const [i, [t, e]] of [[TYPES.follow, EV.follow], [TYPES.sub, EV.sub], [TYPES.cheer, EV.cheer], [TYPES.raid, EV.raid], [TYPES.resub, EV.resub]].entries()) await deliver(ctx, t, e, { id: `shot-${i}`, at: Date.now() - (5 - i) * 60_000, now: Date.now() });
const full = await def.adminPanel(ctx, { query: {} });
await write("1-use", "Overlay alertes · Utiliser (copie qui écoute Twitch)", tab(full, "use"));
await write("2-twitch", "Overlay alertes · Événements Twitch", tab(full, "twitch"));
await write("3-rewards", "Overlay alertes · Récompenses", tab(full, "rewards"));
await write("4-use-open", "Overlay alertes · Utiliser (tout ouvert)", tab(full, "use"), { open: true });
const dlg = (blocks) => blocks.filter((x) => x.presentation === "dialog");
await write("5-reaction-cheer-open", "Overlay alertes · Réaction à « Bits » (tout ouvert)", dlg(await def.adminPanel(ctx, { query: { tab: "twitch", reaction: "cheer" } })), { open: true });
const bad = await def.adminActions.saveJournal(ctx, { retentionDays: "400", silentHours: "1" });
await write("6-journal-error", "Overlay alertes · erreur sous le champ", tab(full, "use").filter((b) => b.action === "saveJournal").map((x) => ({ ...x, errors: bad.errors, values: { retentionDays: "400" } })), { open: true });
// A site without Twitch: nothing Twitch
const solo = fakeCtx({ key: "solo", moduleId: "alerts-overlay", locale: "fr", messages: alFr, settings: { pushToken: "x" }, permissions: alMan.permissions, requires: alMan.requires });
const soloPage = await def.adminPanel(solo, { query: {} });
await write("7-no-twitch", "Overlay alertes · site sans Twitch (onglets affichés : " + [...new Set(soloPage.map((b) => b.tab ?? "use"))].join(", ") + ")", soloPage);
// Before the hand-over (Twitch activity 1.12.0 still there) and the bridge once retired
const wait = world({ locale: "fr", key: "alerts-overlay", keepMemory: true, instances: [{ id: "id-al", key: "alerts-overlay", module: "alerts-overlay" }, { id: "id-ev", key: "twitch-events", module: "twitch-events", adminPath: "/admin/instances/id-ev" }] });
await write("8-waiting", "Overlay alertes · Activité Twitch pas encore à jour", tab(await def.adminPanel(wait.ctx, { query: {} }), "use").slice(0, 4));
const old = fakeCtx({ key: "twitch-events", moduleId: "twitch-events", locale: "fr", messages: evFr, instances: [{ id: "id-al", key: "alerts-overlay", module: "alerts-overlay", adminPath: "/admin/instances/id-al" }] });
await evS.updateState(old, (x) => { x.retired = { by: "alerts-overlay", at: NOW }; });
await write("9-bridge-retired", "Activité Twitch 1.13.0 · reprise faite", await bridge.adminPanel(old, { query: {} }));
