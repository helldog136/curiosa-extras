// Captures NATIVES de l'onglet « Récompenses » et du haut de la page « Commandes » (non lancé par npm test) : les tableaux et les formulaires sont rendus par les VRAIS composants
// du cœur 0.6.0 (AdminTable, AdminBlockForm, rendu statique) et habillés par le CSS Tailwind compilé du cœur ; titres, textes, bandeaux et liens sont reconstitués avec les mêmes classes.
//   cd $CURIOSA_DIR && node --import ./tests/helpers/register.mjs <ce dépôt>/tests/visual/native.mjs <css du cœur> <dossier de pages>
import fs from "node:fs";
import assert from "node:assert/strict";
import { fakeCtx } from "../helpers/fakeCtx.mjs";
import { fakeRewardsApi } from "../helpers/fakeRewards.mjs";
import { fakeHaBridge } from "../helpers/fakeHaBridge.mjs";
import { ownerWorld } from "../helpers/ownerSet.mjs";
const DIR = new URL("../../modules/twitch-bot", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
const es = await import("../../modules/twitch-bot/eventsub.mjs");
const S = await import("../../modules/twitch-bot/state.mjs");
const SRC = await import("../../modules/twitch-bot/sources.mjs");
const R = await import("../../modules/twitch-bot/rewards.mjs");
const J = await import("../../modules/twitch-bot/redeem.mjs");
const A = await import("../../modules/twitch-bot/admin.mjs");
const CSS = fs.readFileSync(process.argv[2], "utf8"), OUT = process.argv[3];
const React = (await import("react")).default, { renderToStaticMarkup } = await import("react-dom/server"), h = React.createElement;
const { HelpTipProvider } = await import("@/components/admin/HelpTip");
const { AdminTable } = await import("@/components/admin/AdminTable");
const { AdminBlockForm } = await import("@/components/admin/AdminBlocks");
const { formLabels, tableLabels } = await import("@/components/admin/kitLabels");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { adminThemeCss } = await import("@/core/adminTheme");
const tr = makeTranslator("fr");

const NOW = Date.parse("2026-10-14T20:00:00Z");
let clock = NOW;
const tick = (s = 120) => (clock += s * 1000);
const iso = (ms) => new Date(ms).toISOString();

/* ───────────── Le faux monde ───────────── */

function world(o = {}) {
  S.resetMemory(); SRC.resetSources(); R.resetRewards(); J.resetRedeem(); J.resetSims();
  clock = NOW;
  const tw = fakeRewardsApi(o.tw);
  const ha = o.noHa ? null : fakeHaBridge(o.ha);
  const acct = { ok: true, channel: "emma", ready: true, https: true, status: "ok", login: "emma", userId: "100", scopes: [...es.SCOPES.own, ...(o.noRewardScope ? [] : es.REWARD_SCOPES)], wanted: [], adminPath: "/admin/instances/tw1", ...o.account };
  const wants = [];
  const ctx = fakeCtx({
    key: "bot", moduleId: "twitch-bot", locale: o.locale ?? "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: o.locale === "en" ? en : fr, siteUrl: "https://site.example.org",
    settings: { onlyWhenLive: true, timezone: "Europe/Paris", ...o.settings },
    topics: { "social.stat": [], "planning.slot": [], "social.link": [], ...(ha ? ha.topics : { "ha.result": [], "ha.state": [] }) },
    services: ha ? { "home-assistant.bridge": ha.methods } : {},
    serviceInstances: {
      "twitch.api": [{ instance: "emma", name: "emma", methods: {
        account: (a) => (a?.channel && a.channel !== "emma" ? { ok: false, error: "other_channel" } : a?.slot === "bot" ? { ...acct, status: "none", userId: null, scopes: [] } : acct),
        wantScopes: (a) => { wants.push(a); return { ok: true }; },
        connectLink: () => ({ ok: true, url: "https://id.twitch.tv/oauth2/authorize?main=1" }),
        disconnect: () => ({ ok: true }),
        request: (a) => tw.request(a),
      } }],
      "twitch.live": [{ instance: "emma", name: "emma", methods: { status: () => ({ channel: "emma", configured: true, known: true, live: o.offline ? false : true, title: "T", game: "G", startedAt: iso(NOW - 3_600_000) }) } }],
    },
  });
  ctx.can = () => o.can !== false;
  return { ctx, tw, ha, wants, acct };
}
const enable = (ctx) => A.actions.rewardsEnable.run(ctx, {});
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="underline" href="$2">$1</a>');
const tone = { info: "border-line", success: "border-success", warning: "border-warning" };
function block(b) {
  switch (b.type) {
    case "heading": return `<h2 class="text-xl font-semibold">${esc(b.text)}</h2>`;
    case "markdown": return `<p class="text-[15px] leading-relaxed">${md(b.text)}</p>`;
    case "html": return `<div>${b.html}</div>`;
    case "banner": return `<div class="rounded-xl border ${tone[b.tone ?? "info"]} bg-surface px-4 py-3 text-[15px]">${esc(b.text)}</div>`;
    case "links": return `<p class="flex flex-wrap gap-x-5 gap-y-2">${b.items.map((i) => `<a class="inline-flex min-h-11 items-center text-accent underline" href="${esc(i.href)}">${esc(i.label)}</a>`).join("")}</p>`;
    case "suggestInstall": return `<div class="rounded-xl border border-line bg-surface px-4 py-3 text-[15px]">${esc(b.reason)}</div>`;
    case "table": return renderToStaticMarkup(h(AdminTable, { block: b, instanceId: "i1", labels: tableLabels(tr) }));
    case "adminForm": return `<div class="rounded-2xl border border-line bg-surface p-5">${renderToStaticMarkup(h(HelpTipProvider, { label: "Aide : {name}" }, h(AdminBlockForm, { instanceId: "i1", block: b, labels: formLabels(tr, "fr", b) })))}</div>`;
    default: return "";
  }
}
const TABS = [["use", "Commandes"], ["timers", "Timers"], ["rewards", "Récompenses"], ["settings", "Réglages"], ["sources", "Informations utilisées"], ["general", "Général"]];
function page(blocks, { tab, theme }) {
  const mine = blocks.filter((b) => (b.tab ?? "use") === tab);
  return `<!doctype html><html lang="fr" data-admin-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bot Twitch</title><style>${CSS}\n${adminThemeCss()}\nbody{margin:0;background:var(--v-bg);color:var(--v-fg);font-family:system-ui,sans-serif}</style></head><body><div class="mx-auto max-w-5xl px-4 pb-20 pt-6"><h1 class="mb-1 text-2xl font-semibold">🤖 Bot Twitch</h1><p class="mb-4 text-sm text-muted">Votre site répond aux commandes de votre chat Twitch, et gère timers, récompenses en points de chaîne et arrêt d'urgence.</p><nav class="mb-5 flex gap-1 overflow-x-auto border-b border-line">${TABS.map(([id, l]) => `<a href="?tab=${id}" class="whitespace-nowrap px-3.5 py-2.5 ${id === tab ? "border-b-2 border-accent font-semibold" : "text-muted"}">${l}</a>`).join("")}</nav><div class="space-y-6">${mine.map(block).join("\n")}</div></div></body></html>`;
}
const write = (name, blocks, tab) => { for (const theme of ["light", "dark"]) fs.writeFileSync(`${OUT}/${name}-${theme}.html`, page(blocks, { tab, theme })); };

const mk = async (w, over = {}) => {
  const r = await A.actions.rewardCreate.run(w.ctx, { title: "Rouge", cost: "500", cooldownMin: "1", prompt: "", action: "lumieres:rouge", ...over });
  assert.ok(r.ok, JSON.stringify(r));
};
// Onglet « Récompenses »
const info = (w) => A.context(w.ctx, { declare: false });
const RA = await import("../../modules/twitch-bot/rewardsAdmin.mjs");
{
  const w0 = world(); // avant l'activation : trois étapes et un bouton
  write("rw-steps", await RA.blocks(w0.ctx, await info(w0)), "rewards");
  const w = world(); await enable(w.ctx);
  await mk(w, { title: "Lumières rouges", action: "lumieres:rouge", cost: "500" });
  await mk(w, { title: "Lumières vertes", action: "lumieres:vert", cost: "500" });
  await mk(w, { title: "Parle au salon", action: "tts:lire", cost: "300" });
  await mk(w, { title: "Merci à toi", action: "chat:repondre", reply: "Merci {utilisateur}.", cost: "100" });
  const aspi = await A.actions.rewardCreate.run(w.ctx, { title: "Lance l'aspirateur", cost: "1500", what: "custom", actionName: "Lancer l'aspirateur", cooldownMin: "10" });
  assert.ok(aspi.ok, JSON.stringify(aspi));
  const rows = await R.list(w.ctx);
  await A.actions.rewardEnable.run(w.ctx, { id: rows.find((r) => r.title === "Lumières vertes").id, enabled: "0" });
  const now = Date.now();
  for (const [i, [title, action, status, reason, user]] of [["Lumières rouges", "lumieres:rouge", "done", "ok", "lea_92"], ["Parle au salon", "tts:lire", "refunded", "offline", "marc"], ["Merci à toi", "chat:repondre", "done", "ok", "nina"], ["Lance l'aspirateur", "perso:lancer-l-aspirateur", "failed", "unmapped", "paul"]].entries())
    await w.ctx.api.store.add("redeem", { rid: `r${i}`, rewardTid: "x", title, action, user, name: user, at: now - i * 60_000, status, todo: null, reason, attempts: 1 }, { key: `r${i}` });
  write("rw-list", await RA.blocks(w.ctx, await info(w)), "rewards");
  write("rw-edit", await RA.blocks(w.ctx, await info(w), { rewardEdit: rows.find((r) => r.title === "Lumières rouges").id }), "rewards");
  const wn = world({ noHa: true }); await enable(wn.ctx);
  write("rw-nohome", await RA.blocks(wn.ctx, await info(wn)), "rewards");
}
// Haut de la page « Commandes »
{
  const { ctx } = await ownerWorld({ settings: { cooldownGlobal: 0, cooldownUser: 0, maxPer30s: 18 } });
  write("top", await A.panel(ctx, { query: {} }), "use");
  await A.actions.mute(ctx);
  write("top-muted", await A.panel(ctx, { query: {} }), "use");
}
console.log("ok");
