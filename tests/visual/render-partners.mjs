// Captures of the Partnerships administration (not run by npm test): the list, the new / edit windows (closed and with "More options" open), the delete window and its error, the partner page and the journal window, at 1280 and 390 px, light and dark, in English and French.
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

const def = (await import("../../modules/partnerships/index.mjs")).default;
const book = (await import("../../modules/contacts/index.mjs")).default.services["contact.book"];
const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "modules/partnerships/module.json"), "utf8"));
const CLIENT = "";
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
  return `<!doctype html><html lang="${locale}" data-admin-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}\n${adminThemeCss()}\nbody{margin:0;background:var(--v-bg);color:var(--v-fg);font-family:system-ui,sans-serif}</style></head><body><div class="mx-auto max-w-5xl px-4 pb-20 pt-6"><h1 class="mb-1 text-2xl font-semibold">${esc(title)}</h1><p class="mb-4 text-sm text-muted">${esc(lead)}</p><nav class="mb-5 flex gap-1 overflow-x-auto border-b border-line">${nav}</nav><div class="space-y-6">${inPage}</div></div>${dialogs}</body></html>`;
}

/* ───────────── The invented world ───────────── */

async function world(locale) {
  const contactsMessages = JSON.parse(fs.readFileSync(path.join(REPO, "modules/contacts/locales/en.json"), "utf8"));
  const bookCtx = fakeCtx({ key: "contacts", messages: contactsMessages });
  const services = { "contact.book": Object.fromEntries(Object.keys(book).map((m) => [m, (args) => book[m](bookCtx, args)])) };
  const ctx = fakeCtx({ key: "partnerships", moduleId: "partnerships", locale, messages: messages("partnerships", locale), services, settings: { followUpDays: 14 } });
  const fr = locale === "fr";
  const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const c1 = (await book.create(bookCtx, { name: "Camille", role: fr ? "Responsable partenariats" : "Partnerships lead", email: "camille@example.org" })).id;
  const c2 = (await book.create(bookCtx, { name: "etoile_nord", email: "etoile@example.org" })).id;
  const mk = (brand, status, extra = {}) => ctx.api.store.add("partners", { brand, status, ...extra });
  const moon = await mk(fr ? "Jeux Clair de Lune" : "Moonlight Games", "discussion", { chances: 60, url: "https://www.moonlight-games.example", sector: fr ? "Jeux de société" : "Board games", country: "France", contactIds: [c1, c2], products: fr ? "Jeux de plateau, jeux de cartes" : "Board games, card games" });
  await mk(fr ? "Atelier Aurore" : "Aurora Workshop", "accepte", { chances: 90 });
  const sent = await mk(fr ? "Café Bellevue" : "Bellevue Café", "envoye", { chances: 30 });
  await mk(fr ? "Papeterie Lune" : "Moon Stationery", "a_contacter");
  await mk(fr ? "Boutique des Étoiles" : "Star Shop", "a_contacter", { chances: 10 });
  await mk(fr ? "Studio Brume" : "Mist Studio", "publie", { chances: 100 });
  await mk(fr ? "Éditions du Phare" : "Lighthouse Press", "sans_reponse");
  await mk(fr ? "Casques Nimbus" : "Nimbus Headsets", "refuse_marque");
  await ctx.api.store.add("journal", { partnerId: sent, date: day(30), author: "admin", text: fr ? "Mail envoyé avec la proposition." : "Mail sent with the offer." });
  const notes = fr ? ["Premier appel, ils sont intéressés.", "Échantillons reçus.", "Contrat à relire.", "Date de publication choisie."] : ["First call, they are interested.", "Samples received.", "Contract to review.", "Publication date chosen."];
  for (let i = 0; i < 12; i++) await ctx.api.store.add("journal", { partnerId: moon, date: day(40 - i * 3), author: i % 4 === 3 ? "agent:claude" : "admin", text: notes[i % 4] });
  return { ctx, moon };
}

const SCENES = {};
const scene = (name, fn) => { SCENES[name] = fn; };
const panel = (c, query) => def.adminPanel(c.ctx, { query });
scene("1-list", async (c) => ({ blocks: await panel(c, {}) }));
scene("2-edit", async (c) => ({ blocks: await panel(c, { edit: c.moon }), dialog: true }));
scene("3-edit-more", async (c) => ({ blocks: await panel(c, { edit: c.moon }), dialog: true, script: "document.querySelectorAll('[role=dialog] details').forEach(function(d){d.open=true})" }));
scene("4-new", async (c) => ({ blocks: await panel(c, { new: "1" }), dialog: true }));
scene("5-delete", async (c) => ({ blocks: await panel(c, { delete: c.moon }), dialog: true }));
scene("6-delete-error", async (c) => {
  const res = await def.adminActions.deletePartner(c.ctx, { id: c.moon, confirm: "" });
  assert.ok(res.error, JSON.stringify(res));
  return { blocks: await panel(c, { delete: c.moon }), dialog: true, script: `var f=document.querySelector("[data-testid='edit-dialog-submit']"); var box=f.closest("div").parentElement; var p=document.createElement("p"); p.setAttribute("role","alert"); p.className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700"; p.textContent=${JSON.stringify(res.error)}; box.prepend(p);` };
});
scene("7-partner", async (c) => ({ blocks: await panel(c, { partner: c.moon }), full: true }));
scene("8-journal", async (c) => ({ blocks: await panel(c, { partner: c.moon, log: "1" }), dialog: true }));

const TABS = (locale) => [[ "use", locale === "fr" ? "Partenaires" : "Partners"], ["settings", locale === "fr" ? "Réglages" : "Settings"], ["general", locale === "fr" ? "Général" : "General"], ["history", locale === "fr" ? "Historique" : "History"]];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const problems = [];
try {
  for (const locale of ["en", "fr"]) {
    const w = await world(locale);
    const ctx = { locale, ...w };
    for (const [name, fn] of Object.entries(SCENES)) {
      if (ONLY.length && !ONLY.includes(name)) continue;
      const s = await fn(ctx);
      for (const theme of ["light", "dark"]) {
        const html = page({ locale, theme, tab: "use", blocks: s.blocks, tabs: TABS(locale), title: manifest.name[locale], lead: manifest.description[locale] });
        for (const width of [1280, 390]) {
          const context = await browser.newContext({ viewport: { width, height: width === 1280 ? 900 : 844 }, colorScheme: theme, deviceScaleFactor: 1, locale: locale === "fr" ? "fr-FR" : "en-US" });
          const p = await context.newPage();
          const errors = [];
          p.on("pageerror", (e) => errors.push(e.message));
          await p.route("**/*", (route) => (/^(data:|about:)/.test(route.request().url()) ? route.continue() : route.abort()));
          await p.setContent(html, { waitUntil: "load" });
          if (s.script) await p.evaluate(`(() => { ${s.script}\n })()`);
          await p.waitForTimeout(250);
          const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
          if (overflow) problems.push(`${name} ${locale} ${theme} ${width}: horizontal scroll`);
          if (errors.length) problems.push(`${name} ${locale} ${theme} ${width}: ${errors.join(" | ")}`);
          await p.screenshot({ path: path.join(OUT, `${name}-${width}-${theme}-${locale}.png`), fullPage: !s.dialog });
          await context.close();
        }
      }
      console.log(name, locale);
    }
  }
} finally { await browser.close(); }
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
