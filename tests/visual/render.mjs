// Captures de l'administration du Bot Twitch (non lancé par npm test) : la liste, la fenêtre « Nouvelle commande » / « Modifier », la confirmation de suppression et une erreur, aux largeurs
// 1280 et 390 px, en clair et en sombre, en français et en anglais. Les tableaux et les formulaires sont rendus par les VRAIS composants du cœur (AdminTable, AdminBlockForm, DialogLink),
// sans JavaScript (rendu statique) ; ce que le navigateur ajoute seulement quand la page est vivante est rejoué par un petit script copié du cœur : les messages d'erreur sous les champs
// (`useFieldErrorsDom`) et la boîte de confirmation (`askConfirm`, compilée telle quelle). Les messages d'erreur sont ceux que renvoient les VRAIES actions du module. Toutes les données sont inventées.
//   cd $CURIOSA_DIR && PREVIEWS_CSS=<app.css compilé du cœur> CHROMIUM_PATH=<chrome> node --import ./tests/helpers/register.mjs <ce dépôt>/tests/visual/render.mjs <dossier de captures> [scène…]
// Le CSS : postcss + @tailwindcss/postcss sur src/app/globals.css du cœur (voir scripts/shoot-previews.mjs).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { fakeCtx } from "../helpers/fakeCtx.mjs";
import { fakeRewardsApi } from "../helpers/fakeRewards.mjs";
import { fakeHaBridge } from "../helpers/fakeHaBridge.mjs";
import { world, entry, link, C, SRC } from "../helpers/botWorld.mjs";
import { CSS, esc, messages } from "./previews/kit.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../..");
const CORE = process.env.CURIOSA_DIR ?? process.cwd();
const OUT = path.resolve(process.argv[2] ?? "shots");
const ONLY = process.argv.slice(3);
const coreRequire = createRequire(`${CORE}/package.json`);
const React = coreRequire("react");
const { renderToStaticMarkup } = coreRequire("react-dom/server");
const ts = coreRequire("typescript");
const h = React.createElement;
const { adminThemeCss } = await import("@/core/adminTheme");
const { HelpTipProvider } = await import("@/components/admin/HelpTip");
const kit = await import("@/components/site/adminKit");
const { formLabels, tableLabels } = await import("@/components/admin/kitLabels");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const need = (name) => { for (const base of [process.env.PLAYWRIGHT_MODULE, `${CORE}/node_modules`, "/opt/node-tools/node_modules"].filter(Boolean)) { try { return createRequire(path.join(base, "x.js"))(name); } catch { /* suivant */ } } throw new Error(`${name} introuvable`); };
const { chromium } = need("playwright");

const A = await import("../../modules/twitch-bot/admin.mjs");
const WD = await import("../../modules/twitch-bot/words.mjs");
const MDB = await import("../../modules/twitch-bot/media.mjs");
const OV = (await import("../../modules/alerts-overlay/index.mjs")).default;
const OVM = await import("../../modules/alerts-overlay/media.mjs");
const RA = await import("../../modules/twitch-bot/rewardsAdmin.mjs");
const es = await import("../../modules/twitch-bot/eventsub.mjs");
const S = await import("../../modules/twitch-bot/state.mjs");
const R = await import("../../modules/twitch-bot/rewards.mjs");
const J = await import("../../modules/twitch-bot/redeem.mjs");
const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "modules/twitch-bot/module.json"), "utf8"));
const CLIENT = fs.readFileSync(path.join(REPO, "modules/twitch-bot/adminkit.client.js"), "utf8");
fs.mkdirSync(OUT, { recursive: true });

/* ───────────── Le rendu : les composants du cœur, la fenêtre au-dessus de la page ───────────── */

const tone = { info: "border-line", success: "border-success", warning: "border-warning" };
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="underline" href="$2">$1</a>');
function renderBlock(b, locale) {
  const tr = makeTranslator(locale);
  switch (b.type) {
    case "heading": return `<h2 class="text-xl font-semibold">${esc(b.text)}</h2>`;
    case "markdown": return `<p class="text-[15px] leading-relaxed">${md(b.text)}</p>`;
    case "html": return `<div>${b.html}</div>`;
    case "banner": return `<div class="rounded-xl border ${tone[b.tone ?? "info"]} bg-surface px-4 py-3 text-[15px]">${esc(b.text)}</div>`;
    case "links": return `<p class="flex flex-wrap gap-x-3 gap-y-2">${b.items.map((i) => renderToStaticMarkup(h(kit.DialogLink, { href: i.href, className: "inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-medium" }, i.label))).join("")}</p>`;
    case "table": return renderToStaticMarkup(h(kit.AdminTable, { block: b, instanceId: "i1", labels: tableLabels(tr) }));
    case "adminForm": return renderToStaticMarkup(h(HelpTipProvider, { label: "?" }, h(kit.AdminBlockForm, { instanceId: "i1", block: b, labels: formLabels(tr, locale, b) })));
    default: return "";
  }
}
const isDialog = (b) => b.type === "adminForm" && b.presentation === "dialog";

/** Le texte de `confirmDialog.ts` du cœur, compilé tel quel : la boîte est celle de la vraie page. */
const ASK = ts.transpileModule(fs.readFileSync(`${CORE}/src/components/admin/confirmDialog.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^export /m, "");
/** Ce que `useFieldErrorsDom` (src/components/admin/FieldErrors.tsx) fait au DOM, rejoué après le rendu statique. */
const SHOW_ERRORS = `window.showErrors = function (errors) {
  var root = document.querySelector("[data-testid='edit-dialog-form']");
  Object.keys(errors).forEach(function (key) {
    var el = root.elements.namedItem(key); if (!el) return;
    if (el.type === "hidden") el = el.closest("[data-duration-field]") ? el.closest("[data-duration-field]").querySelector("input:not([type=hidden])") : el;
    var id = "err-" + key, p = document.createElement("p"); p.id = id; p.setAttribute("data-field-error", "");
    p.className = "mt-1.5 flex items-start gap-1.5 text-sm font-medium text-red-700";
    var i = document.createElement("span"); i.setAttribute("aria-hidden", "true"); i.textContent = "\\u26A0";
    var t = document.createElement("span"); t.className = "min-w-0 [overflow-wrap:anywhere]"; t.textContent = errors[key];
    p.append(i, t); var holder = el.closest("[data-duration-field]") || el; holder.after(p);
    el.setAttribute("aria-invalid", "true"); el.classList.add("border-red-500");
    var fold = el.closest("details"); if (fold) fold.open = true;
    el.scrollIntoView({ block: "center" }); el.focus({ preventScroll: true });
  });
};`;

function page({ locale, theme, tab, blocks, tabs, title, lead }) {
  const mine = blocks.filter((b) => (b.tab ?? "use") === tab);
  const body = [...mine.filter((b) => !isDialog(b)), ...mine.filter(isDialog)];
  const inPage = body.filter((b) => !isDialog(b)).map((b) => renderBlock(b, locale)).join("\n");
  const dialogs = body.filter(isDialog).map((b) => renderBlock(b, locale)).join("\n");
  const nav = tabs.map(([id, l]) => `<a href="#" class="whitespace-nowrap px-3.5 py-2.5 ${id === tab ? "border-b-2 border-accent font-semibold" : "text-muted"}">${esc(l)}</a>`).join("");
  return `<!doctype html><html lang="${locale}" data-admin-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}\n${adminThemeCss()}\nbody{margin:0;background:var(--v-bg);color:var(--v-fg);font-family:system-ui,sans-serif}</style></head><body><div class="mx-auto max-w-5xl px-4 pb-20 pt-6"><h1 class="mb-1 text-2xl font-semibold">🤖 ${esc(title)}</h1><p class="mb-4 text-sm text-muted">${esc(lead)}</p><nav class="mb-5 flex gap-1 overflow-x-auto border-b border-line">${nav}</nav><div class="space-y-6">${inPage}</div></div>${dialogs}</body></html>`;
}

/* ───────────── Les mondes inventés ───────────── */

async function commandsWorld(locale) {
  const w = world({
    locale, sponsors: [entry("p1", "atelier-aurore", "Atelier Aurore"), entry("p2", "cafe-bellevue", "Café Bellevue"), entry("p3", "papeterie-lune", "Papeterie Lune")],
    links: [link("twitch-channel", "twitch-channel", "Twitch", "https://twitch.example.org/chaine_demo"), link("youtube-channel", "youtube-channel", "YouTube", "https://video.example.org/chaine_demo"), link("instagram", "instagram", "Instagram", "https://insta.example.org/chaine_demo")],
    followers: null, settings: { cooldownGlobal: 0, cooldownUser: 0, maxPer30s: 18 },
  });
  const env = { src: await SRC.gather(w.ctx, "chaine_demo"), t: w.ctx.t, prefix: "!" };
  const fr = locale === "fr";
  const ACTIVE = fr
    ? [["discord", "Rejoignez-nous sur Discord : discord.example.org/chaine_demo"], ["so", "Allez voir {cible} sur sa chaîne.", { role: "mods" }], ["lurk", "{utilisateur} se met en mode lurk, à tout à l'heure."], ["regles", "Soyez bienveillants et respectueux, les règles sont dans le panneau sous le stream."], ["setup", "Mon matériel : liste complète sur la page Matériel du site."], ["boutique", "La boutique est ouverte : boutique.example.org"], ["bonjour", "Bonjour {utilisateur}, bienvenue dans le chat."]]
    : [["discord", "Join us on Discord: discord.example.org/chaine_demo"], ["so", "Go and see {cible} on their channel.", { role: "mods" }], ["lurk", "{utilisateur} is lurking, see you later."], ["rules", "Be kind and respectful, the rules are in the panel under the stream."], ["setup", "My gear: full list on the Gear page of the site."], ["shop", "The shop is open: shop.example.org"], ["hello", "Hello {utilisateur}, welcome to the chat."]];
  const OFF = fr
    ? [["alive", "Toujours en vie, merci de demander.", { aliases: ["a-live"] }], ["noel", "Les décorations sont de sortie ce mois-ci.", { period: { yearly: true, from: { m: 12, d: 1 }, to: { m: 12, d: 31 } } }], ["pc", "Mon PC : processeur et carte graphique à retrouver sur la page Matériel."]]
    : [["alive", "Still alive, thanks for asking.", { aliases: ["a-live"] }], ["xmas", "The decorations are out this month.", { period: { yearly: true, from: { m: 12, d: 1 }, to: { m: 12, d: 31 } } }], ["pc", "My PC: processor and graphics card on the Gear page."]];
  for (const [name, text, extra = {}] of ACTIVE) await C.saveCommand(w.ctx, { kind: "custom" }, { name, text, enabled: true, ...extra }, env);
  for (const [name, text, extra = {}] of OFF) await C.saveCommand(w.ctx, { kind: "custom" }, { name, text, enabled: false, ...extra }, env);
  await C.saveCommand(w.ctx, { kind: "builtin", id: "jeu" }, { name: fr ? "jeu" : "game", aliases: [fr ? "queljeu" : "whatgame"] }, env);
  await C.saveSourced(w.ctx, "partner", "p1", { enabled: true, name: "atelier-aurore" }, env);
  await C.saveSourced(w.ctx, "partner", "p2", { enabled: true, name: "cafe-bellevue" }, env);
  await C.saveSourced(w.ctx, "partner", "p3", { enabled: false, name: "papeterie-lune" }, env);
  // trois timers, dont un réservé au timer
  await C.saveCommand(w.ctx, { kind: "custom" }, { name: fr ? "rappel" : "reminder", text: fr ? "Pensez à boire de l'eau." : "Remember to drink water.", repeat: { minutes: 30, lines: 5, when: "live", enabled: true } }, env);
  await C.saveCommand(w.ctx, { kind: "custom" }, { name: fr ? "pub" : "promo", text: fr ? "Rejoignez le Discord, lien en description." : "Join the Discord, link in the description.", timerOnly: true, repeat: { minutes: 20, lines: 3, when: "always", enabled: true } }, env);
  await C.saveCommand(w.ctx, { kind: "custom" }, { name: fr ? "novembre" : "november", text: fr ? "La boutique de novembre est ouverte." : "The November shop is open.", repeat: { minutes: 45, lines: 5, when: "live", enabled: false } }, env);
  SRC.resetSources();
  await A.panel(w.ctx, { query: {} });
  for (const sub of w.tw.subs) sub.status = "enabled";
  await A.actions.check(w.ctx);
  return w;
}
/** Words and "On stream": the commands world plus a fake alerts overlay with a small library (no word yet: the empty state). */
async function wordsWorld(locale, { examples = true } = {}) {
  const fr = locale === "fr";
  const items = [{ id: "m1", name: fr ? "Applaudissements" : "Applause", kind: "picture" }, { id: "m2", name: fr ? "Danse du chat" : "Cat dance", kind: "picture" }, { id: "video:1", name: fr ? "Vidéo 1" : "Video 1", kind: "video" }, { id: "m3", name: fr ? "Ding" : "Ding", kind: "sound" }, { id: "tone:bell", name: fr ? "Cloche" : "Bell", kind: "sound" }];
  const w = world({ locale, services: { "alerts.show": { list: () => ({ items }), show: () => ({ ok: true, state: "shown" }) } }, followers: null });
  const env = { src: await SRC.gather(w.ctx, "chaine_demo"), t: w.ctx.t, prefix: "!", library: () => MDB.library(w.ctx) };
  for (const [name, text] of fr ? [["discord", "Rejoignez-nous sur Discord."], ["lurk", "{utilisateur} se met en mode lurk."]] : [["discord", "Join us on Discord."], ["lurk", "{utilisateur} is lurking."]]) await C.saveCommand(w.ctx, { kind: "custom" }, { name, text, enabled: true }, env);
  await C.saveCommand(w.ctx, { kind: "custom" }, { name: fr ? "merci" : "thanks", text: fr ? "Merci à tous." : "Thank you all.", enabled: true, media: { visual: "m1", sound: "m3", seconds: 6 } }, env);
  if (examples) {
    await WD.saveWord(w.ctx, {}, { words: "quoi", text: "Feur", enabled: true }, env);
    await WD.saveWord(w.ctx, {}, { words: fr ? "bravo, gg" : "gg, well played", text: "", media: { visual: "m2", sound: "tone:bell", seconds: 5 }, role: "everyone", enabled: true }, env);
    await WD.saveWord(w.ctx, {}, { words: fr ? "bonjour, salut" : "hello, hi", text: fr ? "Bonjour {utilisateur}, bienvenue." : "Hello {utilisateur}, welcome.", chance: 3, mode: "contains", role: "subscribers", enabled: false }, env);
  }
  SRC.resetSources();
  return w;
}
/** The Media tab of the alerts overlay: a few invented files. */
async function mediaWorld(locale) {
  const n = (i, ext) => `/uploads/0000000${i}-0123-4567-89ab-0123456789ab.${ext}`;
  const ctx = fakeCtx({ key: "al", moduleId: "alerts-overlay", locale, defaultLocale: "fr", locales: ["fr", "en"], messages: messages("alerts-overlay", locale), settings: { pushToken: "x", video1: n(5, "mp4") }, uploads: [1, 2, 3].map((i) => ({ url: n(i, i === 3 ? "mp3" : "gif"), by: "u1" })) });
  const fr = locale === "fr";
  for (const [name, kind, i, ext] of [[fr ? "Applaudissements" : "Applause", "picture", 1, "gif"], [fr ? "Danse du chat" : "Cat dance", "picture", 2, "gif"], [fr ? "Ding" : "Ding", "sound", 3, "mp3"]]) await OVM.add(ctx, { name, kind, url: n(i, ext) });
  return ctx;
}
async function rewardsWorld(locale) {
  S.resetMemory(); SRC.resetSources(); R.resetRewards(); J.resetRedeem(); J.resetSims();
  const tw = fakeRewardsApi(), ha = fakeHaBridge();
  const acct = { ok: true, channel: "chaine_demo", ready: true, https: true, status: "ok", login: "chaine_demo", userId: "100", scopes: [...es.SCOPES.own, ...es.REWARD_SCOPES], wanted: [], adminPath: "/admin/instances/tw1" };
  const now = Date.parse("2026-10-14T20:00:00Z");
  const ctx = fakeCtx({
    key: "bot", moduleId: "twitch-bot", locale, defaultLocale: "fr", locales: ["fr", "en"], messages: messages("twitch-bot", locale), siteUrl: "https://site.example.org",
    settings: { onlyWhenLive: true, timezone: "Europe/Paris" }, topics: { "social.stat": [], "planning.slot": [], "social.link": [], ...ha.topics }, services: { "home-assistant.bridge": ha.methods },
    serviceInstances: {
      "twitch.api": [{ instance: "chaine_demo", name: "chaine_demo", methods: { account: (a) => (a?.slot === "bot" ? { ...acct, status: "none", userId: null, scopes: [] } : acct), wantScopes: () => ({ ok: true }), connectLink: () => ({ ok: true, url: "https://id.twitch.example.org/main" }), disconnect: () => ({ ok: true }), request: (a) => tw.request(a) } }],
      "twitch.live": [{ instance: "chaine_demo", name: "chaine_demo", methods: { status: () => ({ channel: "chaine_demo", configured: true, known: true, live: true, title: "T", game: "G", startedAt: new Date(now - 3_600_000).toISOString() }) } }],
    },
  });
  ctx.can = () => true;
  await A.actions.rewardsEnable.run(ctx, {});
  const fr = locale === "fr";
  const mk = async (over) => { const r = await A.actions.rewardCreate.run(ctx, { cost: "500", cooldownMin: "1", prompt: "", ...over }); assert.ok(r.ok, JSON.stringify(r)); };
  await mk({ title: fr ? "Lumières rouges" : "Red lights", action: "lumieres:rouge" });
  await mk({ title: fr ? "Lumières vertes" : "Green lights", action: "lumieres:vert" });
  await mk({ title: fr ? "Parle au salon" : "Talk to the room", action: "tts:lire", cost: "300" });
  await mk({ title: fr ? "Un mot gentil" : "A kind word", action: "chat:repondre", reply: "Merci {utilisateur}.", cost: "100" });
  await mk({ title: fr ? "Lance l'aspirateur" : "Start the vacuum", cost: "1500", what: "custom", actionName: fr ? "Lancer l'aspirateur" : "Start the vacuum", cooldownMin: "10" });
  const rows = await R.list(ctx);
  await A.actions.rewardEnable.run(ctx, { id: rows.find((r) => /vertes|Green/.test(r.title)).id, enabled: "0" });
  return { ctx, rows };
}

/* ───────────── Les scènes ───────────── */

const SCENES = {};
const scene = (name, fn) => { SCENES[name] = fn; };
const run = {
  full: true,
};
scene("cmd-list", async (c) => ({ blocks: await A.panel(c.cmd.ctx, { query: {} }), tab: "use" }));
scene("cmd-new", async (c) => ({ blocks: await A.panel(c.cmd.ctx, { query: { new: "1" } }), tab: "use", dialog: true }));
scene("cmd-edit", async (c) => ({ blocks: await A.panel(c.cmd.ctx, { query: { edit: c.key("discord") } }), tab: "use", dialog: true }));
scene("cmd-edit-open", async (c) => ({ blocks: await A.panel(c.cmd.ctx, { query: { edit: c.key("alive") } }), tab: "use", dialog: true, script: "document.querySelectorAll('[role=dialog] details').forEach(d=>d.open=true)" }));
scene("cmd-confirm", async (c) => ({ blocks: await A.panel(c.cmd.ctx, { query: {} }), tab: "use", script: `${ASK}\naskConfirm(${JSON.stringify(c.cmd.ctx.t("delete_row_confirm"))});` }));
scene("cmd-error", async (c) => {
  const key = c.key("discord");
  const res = await A.actions.save(c.cmd.ctx, { key, name: c.locale === "fr" ? "discord" : "discord", text: "Rejoignez-nous.", role: "everyone", repeatOn: "on", repeatEvery: "90", repeatLines: "", repeatWhen: "", timerOnly: "off" });
  assert.ok(res.errors?.repeatEvery, JSON.stringify(res));
  return { blocks: await A.panel(c.cmd.ctx, { query: { edit: key } }), tab: "use", dialog: true, script: `${SHOW_ERRORS}\nshowErrors(${JSON.stringify(res.errors)});` };
});
scene("cmd-partner", async (c) => ({ blocks: await A.panel(c.cmd.ctx, { query: { edit: c.partnerKey } }), tab: "use", dialog: true }));
scene("timers-list", async (c) => ({ blocks: await A.panel(c.cmd.ctx, { query: { tab: "timers" } }), tab: "timers" }));
scene("timers-new", async (c) => ({ blocks: await A.panel(c.cmd.ctx, { query: { tab: "timers", timerAdd: "1" } }), tab: "timers", dialog: true }));
scene("timers-edit", async (c) => ({ blocks: await A.panel(c.cmd.ctx, { query: { tab: "timers", edit: c.key(c.locale === "fr" ? "rappel" : "reminder"), repeat: "1" } }), tab: "timers", dialog: true }));
scene("timers-confirm", async (c) => ({ blocks: await A.panel(c.cmd.ctx, { query: { tab: "timers" } }), tab: "timers", script: `${ASK}\naskConfirm(${JSON.stringify(c.cmd.ctx.t("tm_delete_confirm"))});` }));
scene("rewards-list", async (c) => ({ blocks: await RA.blocks(c.rw.ctx, await A.context(c.rw.ctx, { declare: false }), {}), tab: "rewards" }));
scene("rewards-new", async (c) => ({ blocks: await RA.blocks(c.rw.ctx, await A.context(c.rw.ctx, { declare: false }), { rewardNew: "1" }), tab: "rewards", dialog: true }));
scene("rewards-edit", async (c) => ({ blocks: await RA.blocks(c.rw.ctx, await A.context(c.rw.ctx, { declare: false }), { rewardEdit: c.rw.rows[0].id }), tab: "rewards", dialog: true }));
scene("rewards-rename", async (c) => ({ blocks: await RA.blocks(c.rw.ctx, await A.context(c.rw.ctx, { declare: false }), { actionEdit: "perso:lancer-l-aspirateur" }), tab: "rewards", dialog: true }));

scene("words-empty", async (c) => ({ blocks: await A.panel(c.wd0.ctx, { query: {} }), tab: "use" }));
scene("words-list", async (c) => ({ blocks: await A.panel(c.wd.ctx, { query: {} }), tab: "use" }));
scene("words-new", async (c) => ({ blocks: await A.panel(c.wd.ctx, { query: { new: "word" } }), tab: "use", dialog: true }));
scene("words-edit-open", async (c) => ({ blocks: await A.panel(c.wd.ctx, { query: { edit: c.wordKey("quoi") } }), tab: "use", dialog: true, script: "document.querySelectorAll('[role=dialog] details').forEach(d=>d.open=true)" }));
scene("words-error", async (c) => {
  const res = await A.actions.createWord(c.wd.ctx, { words: "Quoi", text: "x", role: "everyone" });
  assert.ok(res.errors?.words, JSON.stringify(res));
  return { blocks: await A.panel(c.wd.ctx, { query: { new: "word" } }), tab: "use", dialog: true, script: `${SHOW_ERRORS}\nshowErrors(${JSON.stringify({ ...res.errors, ...(await A.actions.createWord(c.wd.ctx, { words: "zz", text: "x", role: "everyone", chance: "50" })).errors })});` };
});
scene("words-no-overlay", async (c) => ({ blocks: await A.panel(c.wdDown.ctx, { query: { new: "word" } }), tab: "use", dialog: true, script: "document.querySelectorAll('[role=dialog] details').forEach(d=>d.open=true)" }));
scene("media-tab", async (c) => ({ blocks: await OV.adminPanel(c.md, { query: { tab: "media" } }), tab: "media", tabs: [["media", c.locale === "fr" ? "Médias" : "Media"]], title: c.locale === "fr" ? "Overlay alertes (OBS)" : "Alerts overlay (OBS)" }));
scene("media-add", async (c) => ({ blocks: await OV.adminPanel(c.md, { query: { tab: "media", add: "picture" } }), tab: "media", tabs: [["media", c.locale === "fr" ? "Médias" : "Media"]], title: c.locale === "fr" ? "Overlay alertes (OBS)" : "Alerts overlay (OBS)", dialog: true }));

const TABS = (locale) => manifest.tabs.map((t) => [t.id, t.label[locale]]).concat([["settings", locale === "fr" ? "Réglages" : "Settings"]]);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const problems = [];
try {
  for (const locale of ["fr", "en"]) {
    const cmd = await commandsWorld(locale), rw = await rewardsWorld(locale);
    const list = (await C.loadConfig(cmd.ctx)).data.custom;
    const wd = await wordsWorld(locale), wd0 = await wordsWorld(locale, { examples: false }), wdDown = world({ locale, followers: null }), md = await mediaWorld(locale);
    const wlist = (await C.loadConfig(wd.ctx)).data.words;
    const ctx = { locale, cmd, rw, wd, wd0, wdDown, md, wordKey: (word) => `word:${wlist.find((x) => x.words.includes(word)).id}`, key: (name) => `custom:${list.find((x) => x.name === name).id}`, partnerKey: "partner:p1" };
    for (const [name, fn] of Object.entries(SCENES)) {
      if (ONLY.length && !ONLY.includes(name)) continue;
      const s = await fn(ctx);
      for (const theme of ["light", "dark"]) {
        const html = page({ locale, theme, tab: s.tab, blocks: s.blocks, tabs: s.tabs ?? TABS(locale), title: s.title ?? manifest.name[locale], lead: manifest.description[locale] });
        for (const width of [1280, 390]) {
          const context = await browser.newContext({ viewport: { width, height: width === 1280 ? 900 : 844 }, colorScheme: theme, deviceScaleFactor: 1, locale: locale === "fr" ? "fr-FR" : "en-US" });
          const p = await context.newPage();
          const errors = [];
          p.on("pageerror", (e) => errors.push(e.message));
          await p.route("**/*", (route) => (/^(data:|about:)/.test(route.request().url()) ? route.continue() : route.abort()));
          await p.setContent(html, { waitUntil: "load" });
          await p.addScriptTag({ content: CLIENT });
          if (s.script) await p.evaluate(`(() => { ${s.script}\n })()`);
          await p.waitForTimeout(250);
          const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
          if (overflow) problems.push(`${name} ${locale} ${theme} ${width} : défilement horizontal`);
          if (errors.length) problems.push(`${name} ${locale} ${theme} ${width} : ${errors.join(" | ")}`);
          await p.screenshot({ path: path.join(OUT, `${name}-${width}-${theme}-${locale}.png`), fullPage: !s.dialog && !s.script?.includes("askConfirm") });
          await context.close();
        }
      }
      console.log(name, locale);
    }
  }
} finally { await browser.close(); }
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
void run;
