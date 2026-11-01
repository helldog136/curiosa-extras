// Captures de l'administration du Bot Twitch (non lancé par npm test) :
//   cd $CURIOSA_DIR && node --import ./tests/helpers/register.mjs <ce dépôt>/tests/visual/render.mjs <dossier de pages>
//   NODE_PATH=<modules node globaux> CHROMIUM_PATH=<chrome> node <ce dépôt>/tests/visual/shoot.cjs '[{"page":"list","w":1280,"theme":"light","name":"liste"}]' <dossier de pages> <dossier de captures>
// Génère les pages HTML de l'administration du Bot Twitch (mêmes blocs que le cœur, rendus par un petit rendu qui reproduit le balisage des formulaires du cœur 0.5.1).
import fs from "node:fs";
import { ownerWorld } from "../helpers/ownerSet.mjs";
import { world, C, SRC, say, NOW } from "../helpers/botWorld.mjs";
const { adminThemeCss } = await import(`${process.env.CURIOSA_DIR}/src/core/adminTheme.ts`);
const A = await import("../../modules/twitch-bot/admin.mjs");
const T = await import("../../modules/twitch-bot/timers.mjs");
const OUT = process.argv[2];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

function field(f) {
  const id = `f_${f.name}`;
  if (f.kind === "hidden") return `<input type="hidden" name="${esc(f.name)}" value="${esc(f.value ?? "")}">`;
  const help = f.help ? `<p class="help">${esc(f.help)}</p>` : "";
  if (f.kind === "checkbox") return `<div class="wrap"><div><div class="cb"><label><input type="checkbox" name="${f.name}" value="on"${f.value === "on" ? " checked" : ""}> ${esc(f.label)}</label></div>${help}</div></div>`;
  const ctl = f.kind === "textarea" ? `<textarea id="${id}" name="${f.name}" rows="4" ${f.required ? "required" : ""}>${esc(f.value ?? "")}</textarea>`
    : f.kind === "select" ? `<select id="${id}" name="${f.name}">${f.options.map((o) => `<option value="${esc(o.value)}"${o.value === f.value ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`
    : `<input id="${id}" name="${f.name}" type="${f.kind ?? "text"}" value="${esc(f.value ?? "")}" ${f.required ? "required" : ""}>`;
  return `<div class="wrap${f.kind === "textarea" ? " full" : ""}"><div><label for="${id}">${esc(f.label)}</label>${ctl}${help}</div></div>`;
}
function block(b) {
  switch (b.type) {
    case "heading": return `<h2 class="h">${esc(b.text)}</h2>`;
    case "markdown": return `<p class="md">${md(b.text)}</p>`;
    case "html": return `<div data-skin-part="module-html">${b.html}</div>`;
    case "banner": return `<div class="banner ${b.tone ?? "info"}">${esc(b.text)}</div>`;
    case "table": return `<div style="overflow-x:auto"><table class="coretable"><thead><tr>${b.columns.map((c) => `<th>${esc(c)}</th>`).join("")}${b.rowActions ? "<th></th>" : ""}</tr></thead><tbody>${b.rows.map((r, i) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}${b.rowActions ? `<td>${b.rowActions.map((a) => `<button class="btn${a.danger ? " danger" : ""}">${esc(a.label)}</button>`).join(" ")}</td>` : ""}</tr>`).join("")}</tbody></table></div>`;
    case "adminForm": return `<form class="card" onsubmit="return false">${b.fields.filter((f) => f.kind === "hidden").map(field).join("")}<div class="grid">${b.fields.filter((f) => f.kind !== "hidden").map(field).join("")}</div><div class="actions"><button class="primary" type="submit">${esc(b.submitLabel)}</button>${b.cancelHref ? '<a class="btn" href="' + b.cancelHref + '">↩</a>' : ""}</div></form>`;
    default: return "";
  }
}
const BASE = `
*{box-sizing:border-box}body{margin:0;background:var(--v-bg);color:var(--v-fg);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px}
.page{max-width:1080px;margin:0 auto;padding:24px 16px 80px}.stack>*+*{margin-top:1.5rem}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--v-line);margin-bottom:20px;overflow-x:auto}.tabs a{padding:10px 14px;text-decoration:none;color:var(--v-muted);white-space:nowrap}.tabs a.on{color:var(--v-fg);border-bottom:2px solid var(--v-accent);font-weight:600}
.h{font-size:20px;font-weight:600;margin:0}.md{margin:0;color:var(--v-fg);line-height:1.5}.md a{color:var(--v-accent)}
.banner{padding:12px 16px;border-radius:12px;border:1px solid var(--v-line);background:var(--v-surface)}.banner.warning{border-color:#e0a030}.banner.success{border-color:#3aa86a}
.card{border:1px solid var(--v-line);border-radius:16px;background:var(--v-surface);padding:20px}.grid{display:grid;gap:16px}@media(min-width:640px){.grid{grid-template-columns:1fr 1fr}.wrap.full{grid-column:1/-1}}
label{display:block;margin-bottom:6px;font-size:15px;font-weight:500}.cb label{display:flex;gap:8px;align-items:center}
input:not([type=checkbox]):not([type=hidden]),select,textarea{width:100%;border:1px solid var(--v-line);border-radius:12px;background:var(--v-bg);color:var(--v-fg);padding:10px 16px;font:inherit}
.help{margin:6px 0 0;font-size:13px;color:var(--v-muted);max-width:70ch}.actions{display:flex;gap:12px;margin-top:16px;align-items:center}
.primary{background:var(--v-accent);color:var(--v-accent-fg);border:0;border-radius:12px;padding:10px 20px;font:inherit;font-weight:600;cursor:pointer}
.btn{display:inline-flex;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface);color:var(--v-fg);padding:8px 16px;font:inherit;text-decoration:none;cursor:pointer}.btn.danger{color:#dc2626}
.coretable{width:100%;border-collapse:collapse}.coretable th,.coretable td{padding:8px 12px;text-align:left;border-top:1px solid var(--v-line)}
`;
function page(blocks, { tab = "use", theme = "light" } = {}) {
  const tabs = [["use", "Commandes"], ["timers", "Timers"], ["rewards", "Récompenses"], ["settings", "Réglages"], ["sources", "Sources"], ["general", "Général"]];
  const mine = blocks.filter((b) => (b.tab ?? "use") === tab);
  return `<!doctype html><html lang="fr" data-admin-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bot Twitch</title><style>${adminThemeCss()}${BASE}</style></head><body><div class="page"><h1 style="margin:0 0 16px">🤖 Bot Twitch</h1><nav class="tabs">${tabs.map(([id, l]) => `<a class="${id === tab ? "on" : ""}" href="?tab=${id}">${l}</a>`).join("")}</nav><div class="stack" id="app">${mine.map(block).join("\n")}</div></div></body></html>`;
}

const { ctx, tw } = await ownerWorld({ settings: { cooldownGlobal: 0, cooldownUser: 0, maxPer30s: 18 } });
for (const [t, o] of [["!discord", { login: "lea_92" }], ["!tip", { login: "marc" }], ["!so Zoe", { login: "curieux" }], ["!tesla", { login: "nina" }], ["!jeu", { login: "paul" }], ["!discord", { login: "lea_92" }]]) await say(ctx, t, o, NOW + Math.random() * 1e6);
// des timers pour la page Timers
const e = { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" };
const sv = (f, p) => T.saveTimer(ctx, {}, f, { prefix: "!" });
await sv({ name: "Rappel du Discord", text: "Rejoignez le Discord : discord.example.org/emma", minutes: 20, lines: 5, when: "live", enabled: true });
await sv({ name: "Hydratation", text: "Pensez à boire de l'eau.", minutes: 30, lines: 3, when: "always", enabled: true });
await sv({ name: "Boutique de novembre", text: "La boutique de novembre est ouverte.", minutes: 45, lines: 5, when: "live", enabled: false, period: { yearly: true, from: { m: 11, d: 1 }, to: { m: 11, d: 30 } } });
await sv({ name: "Offre d'été", text: "L'offre d'été est ouverte jusqu'au 31 août.", minutes: 60, lines: 8, when: "live", enabled: true, period: { yearly: true, from: { m: 6, d: 21 }, to: { m: 9, d: 21 } } });
SRC.resetSources();
const key = (await C.loadConfig(ctx)).data.custom.find((c) => c.name === "movember").id;
const scenes = {
  list: [{ query: {} }, "use"],
  new: [{ query: { new: "1" } }, "use"],
  edit: [{ query: { edit: `custom:${key}` } }, "use"],
  timers: [{ query: { tab: "timers" } }, "timers"],
  timernew: [{ query: { tab: "timers", timerNew: "1" } }, "timers"],
  rewards: [{ query: { tab: "rewards" } }, "rewards"],
};
for (const [name, [q, tab]] of Object.entries(scenes)) {
  for (const theme of ["light", "dark"]) {
    const blocks = await A.panel(ctx, q);
    fs.writeFileSync(`${OUT}/${name}-${theme}.html`, page(blocks, { tab, theme }));
  }
}
console.log("ok");
