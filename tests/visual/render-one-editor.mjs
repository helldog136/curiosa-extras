// Captures for "one editor per Twitch event type" (Alerts overlay 1.13.0, Twitch activity 1.10.0) and the menu place of Live status. Not run by npm test.
// The blocks are rendered by the REAL components of the core (Blocks: AdminTable, AdminBlockForm...), without JavaScript; the menu by the core's MenuTreeNav and buildMenuTree.
// Invented data. In the core folder (CURIOSA_DIR, with node_modules):
//   node --import ./tests/helpers/register.mjs <this repository>/tests/visual/render-one-editor.mjs <pages folder> <compiled app.css>
// then tests/visual/shoot-core.cjs for the captures (1280 and 390 px, light and dark).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fakeCtx } from "../helpers/fakeCtx.mjs";
import { world as evWorld, S, C as CY, mod as evMod } from "../helpers/eventsWorld.mjs";

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
const tw = await import("../../modules/alerts-overlay/twitch.mjs"), md = await import("../../modules/alerts-overlay/media.mjs");
const alDef = (await import("../../modules/alerts-overlay/index.mjs")).default;
fs.mkdirSync(path.join(OUT, "uploads"), { recursive: true });

// A small picture per file name, served next to the pages (the table shows a thumbnail of the first picture).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKElEQVR42mNkYPhfz0ABYBw1gGE0DBhGw4BhNAwYRsOAYTQMGEbDAAAqXwgRzVvU0wAAAABJRU5ErkJggg==", "base64");
const U = (n) => `/uploads/${String(n).padStart(8, "0")}-0123-4567-89ab-0123456789ab.png`;
for (let i = 1; i <= 4; i++) fs.writeFileSync(path.join(OUT, U(i).slice(1)), PNG);

const page = (title, body, theme, open) => `<!doctype html><html lang="fr" data-admin-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${CSS}</style><style>${adminThemeCss()}</style></head>
<body class="min-h-screen bg-bg text-fg antialiased"><main class="mx-auto max-w-5xl space-y-6 p-4 md:p-6"><h1 class="text-2xl font-semibold">${title}</h1>${open ? body.replace(/<details/g, "<details open") : body}</main></body></html>`;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const tone = { info: "border-line", success: "border-success", warning: "border-warning" };
/** The same small renderer as render-reaction.mjs: the core's own table and form components, the simple blocks as the core draws them. */
function renderBlock(b) {
  const tr = makeTranslator("fr");
  switch (b.type) {
    case "heading": return `<h2 class="text-xl font-semibold">${esc(b.text)}</h2>`;
    case "markdown": return `<p class="text-[15px] leading-relaxed">${esc(b.text)}</p>`;
    case "links": return `<p class="text-[15px]">${b.items.map((i) => `<a class="underline" href="${esc(i.href)}">${esc(i.label)}</a>`).join(" · ")}</p>`;
    case "html": return `<div>${b.html}</div>`;
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

/** The overlay (and Twitch activity when `activity`), talking through the real service code of both modules. */
async function site({ activity = true } = {}) {
  tw.resetTwitchState(); md.resetValve();
  const al = fakeCtx({ key: "al", moduleId: "alerts-overlay", locale: "fr", messages: alFr, settings: { pushToken: "x" }, permissions: alMan.permissions, uploads: [1, 2, 3, 4].map((i) => ({ url: U(i), by: "u1" })) });
  const w = evWorld({ locale: "fr", tw: { autoEnable: true } }), ev = w.ctx;
  await S.ensureSecret(ev);
  await CY.check(ev, { retentionDays: 30 }, { now: Date.now() }); await CY.check(ev, { retentionDays: 30 }, { now: Date.now() });
  const svc = alDef.services["alerts.reaction"], ed = evMod.services["alerts.reaction.editor"];
  const base = ev.api.services;
  ev.api.services = { ...base, providers: async (n) => (n === "alerts.reaction" ? [{ id: "id-al", key: "al", name: "Alertes", module: "alerts-overlay", version: 2, each: true, master: false }] : base.providers(n)), call: async (n, m, a, o) => (n === "alerts.reaction" ? { ok: true, value: await svc[m](al, a) } : base.call(n, m, a, o)) };
  ev.api.instances = { ...ev.api.instances, list: async () => [{ id: "al", key: "al", adminPath: "/admin/instances/al" }] };
  al.api.services = { ...al.api.services, providers: async (n) => (n === "alerts.reaction.editor" && activity ? [{ id: "id-ev", key: "ev", name: "Activité Twitch", module: "twitch-events", version: 1, each: false, master: true }] : []), call: async (n, m, a) => (n === "alerts.reaction.editor" && activity ? { ok: true, value: await ed[m](ev, a) } : { ok: false, reason: "unavailable" }) };
  al.api.instances = { ...al.api.instances, list: async ({ module } = {}) => (module === "twitch-events" ? [{ id: "id-ev", key: "ev", module: "twitch-events", basePath: null, name: "Activité Twitch", adminPath: "/admin/instances/id-ev" }] : []) };
  const set = (type, patch) => svc.set(al, { type, patch });
  await set("follow", { variants: [U(1), U(2), U(3)].map((src) => ({ src })), pick: "rotate", sound: "chime" });
  await set("raid", { variants: [{ src: U(4) }], text: "{name} arrive avec {viewers} personnes" });
  await set("cheer", { min: "100", tts: "both" });
  await tw.saveConfig(al, { ...(await tw.loadConfig(al)), types: { ...(await tw.loadConfig(al)).types, offline: { ...(await tw.loadConfig(al)).types.offline, on: false } } });
  return { al, ev };
}
const twitchTab = (blocks) => blocks.filter((b) => b.tab === "twitch");

const a = await site();
await write("1-overlay-summary", "Overlay alertes · Événements Twitch (avec Activité Twitch)", twitchTab(await alDef.adminPanel(a.al, { query: {} })));
const b = await site({ activity: false });
await write("2-overlay-full", "Overlay alertes · Événements Twitch (sans Activité Twitch)", twitchTab(await alDef.adminPanel(b.al, { query: {} })));
const dlg = (blocks) => blocks.filter((x) => x.presentation === "dialog");
await write("3-activity-cheer-open", "Activité Twitch · Réaction à « Bits » (tout ouvert)", dlg(await evMod.adminPanel(a.ev, { query: { tab: "types", reaction: "cheer" } })), { open: true });
await write("4-activity-cheer", "Activité Twitch · Réaction à « Bits »", dlg(await evMod.adminPanel(a.ev, { query: { tab: "types", reaction: "cheer" } })));
const bad = await evMod.adminActions.saveReaction(a.ev, { id: "cheer", variants: "[]", pick: "random", more: "2", min: "-3", anim: "", tts: "", viewerMax: "" });
await write("5-activity-cheer-error", "Activité Twitch · erreur sous le champ", dlg(await evMod.adminPanel(a.ev, { query: { tab: "types", reaction: "cheer" } })).map((x) => ({ ...x, errors: bad.errors, values: { min: "-3" } })), { open: true });

// The admin menu: the network modules as declared by their manifests, through the core's tree builder and MenuTreeNav.
try {
  const { buildMenuTree, parseMenuPath } = await import("@/core/modules/menuPath");
  const { MenuTreeNav } = await import("@/components/admin/MenuTreeNav");
  const ids = fs.readdirSync(path.join(root, "modules")).filter((id) => fs.existsSync(path.join(root, "modules", id, "module.json")));
  const items = ids.map((id) => [id, json(`modules/${id}/module.json`)]).filter(([, m]) => m.adminMenu).map(([id, m]) => ({ id, moduleId: id, name: m.name.fr, icon: m.icon, badge: 0, error: false, placement: "menu", menuPath: parseMenuPath(m.adminMenu), menuOrder: m.adminMenuOrder ?? 100, connector: m.type === "integration", groupLabels: {} }));
  const tree = buildMenuTree(items, "fr");
  const state = Object.fromEntries(["g-networks", "g-networks-twitch", "g-networks-youtube", "g-networks-discord"].map((k) => [k, true]));
  const entry = (m) => React.createElement("a", { key: m.id, href: `#${m.id}`, className: "flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-[15px] hover:bg-accent/10" }, `${m.icon} ${m.name}`);
  const html = renderToStaticMarkup(React.createElement("nav", { "aria-label": "Menu", className: "w-72 rounded-2xl border border-line bg-surface p-2" }, tree.groups.map((n) => React.createElement(MenuTreeNav, { key: n.id, node: n, state, targets: () => [], renderEntry: entry, badgeLabel: "à faire" }))));
  for (const theme of ["light", "dark"]) fs.writeFileSync(path.join(OUT, `6-menu-${theme}.html`), page("Menu d'administration · Réseaux", html, theme, false));
  console.log("6-menu", tree.groups.length, "groups");
} catch (e) { console.error("menu not rendered:", e.message); }
