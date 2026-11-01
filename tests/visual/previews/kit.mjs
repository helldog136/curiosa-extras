// Outils communs des scènes de captures (scripts/shoot-previews.mjs) : cadre de site public, cadre d'administration (vrais composants du cœur),
// images dessinées (aucune photo, aucun logo réel) et garde-fou de confidentialité. Tout ce qui est montré est INVENTÉ.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const read = (id, p) => fs.readFileSync(path.join(REPO, "modules", id, p), "utf8");
export const messages = (id, lang) => JSON.parse(read(id, `locales/${lang}.json`));
export const CSS = fs.readFileSync(process.env.PREVIEWS_CSS, "utf8");

// React vient du dossier de Curiosa (ce dépôt n'a pas de node_modules) : la même copie que celle des composants du cœur.
import { createRequire } from "node:module";
const need = createRequire(path.join(process.env.CURIOSA_DIR, "package.json"));
const React = need("react");
const { renderToStaticMarkup } = need("react-dom/server");
const h = React.createElement;
const { buildTheme, themeCss } = await import("@/core/color");
const { adminThemeCss } = await import("@/core/adminTheme");
const { HelpTipProvider } = await import("@/components/admin/HelpTip");
const { AdminTable } = await import("@/components/admin/AdminTable");
const { AdminBlockForm } = await import("@/components/admin/AdminBlocks");
const { formLabels, tableLabels } = await import("@/components/admin/kitLabels");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { EntryIcon } = await import("@/components/site/EntryIcon");
const { EntryList } = await import("@/components/site/EntryList");

export const NOW = new Date("2026-10-12T08:00:00Z");   // un lundi, 10 h à Paris : l'horloge est figée pendant la fabrication des pages, les captures sont reproductibles
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="underline" href="$2">$1</a>');

/** Image dessinée (dégradé + formes) en adresse « data: » : jamais de photo ni de logo réel. */
export function art(a = 260, b = 320, { w = 800, hgt = 600, shape = "circles", label = "" } = {}) {
  const c1 = `hsl(${a} 70% 62%)`, c2 = `hsl(${b} 75% 38%)`;
  const shapes = shape === "waves"
    ? `<path d="M0 ${hgt * 0.62} Q ${w * 0.25} ${hgt * 0.45} ${w * 0.5} ${hgt * 0.62} T ${w} ${hgt * 0.6} V ${hgt} H0Z" fill="hsl(${a} 60% 85% / .35)"/><path d="M0 ${hgt * 0.78} Q ${w * 0.3} ${hgt * 0.62} ${w * 0.6} ${hgt * 0.8} T ${w} ${hgt * 0.74} V ${hgt} H0Z" fill="hsl(${b} 60% 20% / .35)"/>`
    : shape === "blocks"
      ? `<rect x="${w * 0.12}" y="${hgt * 0.2}" width="${w * 0.3}" height="${hgt * 0.6}" fill="hsl(${a} 60% 90% / .3)"/><rect x="${w * 0.5}" y="${hgt * 0.35}" width="${w * 0.36}" height="${hgt * 0.45}" fill="hsl(${b} 60% 15% / .3)"/>`
      : `<circle cx="${w * 0.3}" cy="${hgt * 0.38}" r="${hgt * 0.26}" fill="hsl(${a} 80% 92% / .35)"/><circle cx="${w * 0.68}" cy="${hgt * 0.62}" r="${hgt * 0.34}" fill="hsl(${b} 70% 18% / .35)"/>`;
  const text = label ? `<text x="50%" y="52%" text-anchor="middle" font-family="sans-serif" font-size="${hgt / 9}" font-weight="700" fill="#fff" opacity=".9">${esc(label)}</text>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${hgt}" width="${w}" height="${hgt}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="${w}" height="${hgt}" fill="url(#g)"/>${shapes}${text}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const SITE = { name: "Atelier Démo", accent: "#6c5ce7", bg: "#fbfaf7" };
const siteTheme = (o = {}) => themeCss(buildTheme(o.bg ?? SITE.bg, o.accent ?? SITE.accent, "sans"));

/** Une page publique dans un cadre de site (en-tête, menu, pied) au skin de base ; `body` est le HTML produit par le module. */
export function siteFrame({ body, title, lead = "", nav = [], current = "", lang = "fr", theme = {}, button = null, socials = "" } = {}) {
  const items = nav.map((n) => `<li><a href="#" data-skin-part="nav-link" class="flex min-h-target items-center rounded-lg px-2 py-2 hover:bg-accent/10${n === current ? " font-semibold text-accent" : ""}">${esc(n)}</a></li>`).join("");
  const btn = button ? `<a href="#" data-skin-part="button" data-btn="primary" class="rounded-button border-token-strong border-accent px-4 py-1.5 text-sm font-semibold text-accent">${esc(button)}</a>` : "";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title ?? SITE.name)}</title><style>${CSS}\n${siteTheme(theme)}</style></head>
<body class="min-h-screen bg-bg text-fg antialiased" data-skin-root="" style="font-family:var(--v-font)"><div data-skin-region="shell">
<header data-skin-region="header" class="relative flex flex-wrap items-center justify-between gap-4 border-b-token border-line py-4"><a href="#" data-skin-part="brand" class="flex items-center gap-3 text-lg font-semibold"><span aria-hidden="true" class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm text-accent-fg">AD</span><span>${esc(SITE.name)}</span></a>
<div class="flex flex-wrap items-center gap-x-6 gap-y-2"><nav data-site-nav=""><ul data-skin-part="nav-list" data-open="true" class="flex gap-1 text-sm">${items}</ul></nav>${socials}${btn}</div></header>
<main id="content" data-skin-region="main"><div data-skin-region="content"><div class="space-y-8">${title ? `<header class="space-y-2"><h1 data-skin-part="heading" data-level="1" class="text-3xl font-bold">${esc(title)}</h1>${lead ? `<p data-skin-part="lead" class="text-muted">${esc(lead)}</p>` : ""}</header>` : ""}${body}</div></div></main>
<footer data-skin-region="footer" class="border-t-token border-line py-6 text-sm text-muted">© ${NOW.getUTCFullYear()} ${esc(SITE.name)}</footer></div></body></html>`;
}

/** Les blocs d'un module rendus comme le site le fait pour les plus courants (html, titre, texte). */
export function blocksHtml(blocks) {
  return blocks.map((b) => b.type === "html" ? `<div>${b.html}</div>` : b.type === "heading" ? `<h2 class="text-xl font-semibold">${esc(b.text)}</h2>` : b.type === "markdown" ? `<p class="leading-relaxed">${md(b.text)}</p>` : b.type === "links" ? `<p>${b.items.map((i) => `<a class="text-accent underline" href="#">${esc(i.label)}</a>`).join(" · ")}</p>` : "").join("\n");
}

const tone = { info: "border-line", success: "border-success", warning: "border-warning" };
/** Un bloc d'administration : les tableaux et les formulaires sont rendus par les VRAIS composants du cœur ; le reste reprend leurs classes. */
export function adminBlock(b, { locale = "fr" } = {}) {
  const tr = makeTranslator(locale);
  switch (b.type) {
    case "heading": return `<h2 class="text-xl font-semibold">${esc(b.text)}</h2>`;
    case "markdown": return `<p class="text-[15px] leading-relaxed">${md(b.text)}</p>`;
    case "html": return `<div>${b.html}</div>`;
    case "banner": return `<div class="rounded-xl border ${tone[b.tone ?? "info"]} bg-surface px-4 py-3 text-[15px]">${esc(b.text)}</div>`;
    case "links": return `<p class="flex flex-wrap gap-x-5 gap-y-2">${b.items.map((i) => `<a class="inline-flex min-h-11 items-center text-accent underline" href="${esc(i.href)}">${esc(i.label)}</a>`).join("")}</p>`;
    case "table": return renderToStaticMarkup(h(AdminTable, { block: b, instanceId: "i1", labels: tableLabels(tr) }));
    case "adminForm": return `<div class="rounded-2xl border border-line bg-surface p-5">${renderToStaticMarkup(h(HelpTipProvider, { label: "Aide : {name}" }, h(AdminBlockForm, { instanceId: "i1", block: b, labels: formLabels(tr, locale, b) })))}</div>`;
    default: return "";
  }
}

/** Une page d'administration : titre, phrase d'accroche, onglets, puis les blocs de l'onglet. */
export function adminFrame({ title, icon = "", lead = "", tabs = [], tab = "", blocks = [], theme = "light", lang = "fr" }) {
  const mine = tab ? blocks.filter((b) => (b.tab ?? tabs[0]?.[0]) === tab) : blocks;
  return `<!doctype html><html lang="${lang}" data-admin-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}\n${adminThemeCss()}\nbody{margin:0;background:var(--v-bg);color:var(--v-fg);font-family:system-ui,sans-serif}</style></head><body><div class="mx-auto max-w-5xl px-4 pb-20 pt-6"><h1 class="mb-1 text-2xl font-semibold">${icon ? icon + " " : ""}${esc(title)}</h1>${lead ? `<p class="mb-4 text-sm text-muted">${esc(lead)}</p>` : ""}${tabs.length ? `<nav class="mb-5 flex gap-1 overflow-x-auto border-b border-line">${tabs.map(([id, l]) => `<a href="#" class="whitespace-nowrap px-3.5 py-2.5 ${id === tab ? "border-b-2 border-accent font-semibold" : "text-muted"}">${esc(l)}</a>`).join("")}</nav>` : ""}<div class="space-y-6">${mine.map((b) => adminBlock(b, { locale: lang })).join("\n")}</div></div></body></html>`;
}

/** Garde-fou de confidentialité : une capture ne montre que des données inventées (adresses en .example/.test, aucun nom de la propriétaire ni de sa communauté). */
const FORBIDDEN = [/helldog/i, /rosalia/i, /curiosa-?extras/i, /\bnid[- ]d['’]amour\b/i];
export function assertInvented(file, html, allow = []) {
  const text = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "");
  for (const re of FORBIDDEN) if (re.test(text)) throw new Error(`un nom réel apparaît (${re}). Les captures ne montrent que des données inventées.`);
  for (const m of text.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)) if (!/(^|\.)(example|test|invalid)(\.\w+)?$|example\.(org|com|net)$/i.test(m[1])) throw new Error(`adresse électronique « ${m[0]} » hors .example/.test.`);
  for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) if (!/(^|\.)(example\.(org|com|net)|[a-z0-9-]+\.example|[a-z0-9-]+\.test|localhost)$/i.test(m[1]) && !allow.some((d) => m[1] === d || m[1].endsWith(`.${d}`))) throw new Error(`adresse « ${m[0]} » hors example.org/.test.`);
}

/** Les icônes de réseaux de l'en-tête (rendues par le vrai composant d'icône du cœur) : `items` = [{ label, icon }]. */
export const socialsHtml = (items) => `<ul aria-label="Réseaux" data-skin-part="socials" class="flex items-center gap-3">${items.map((i) => `<li><a href="#" data-skin-part="link" aria-label="${esc(i.label)}" title="${esc(i.label)}" class="inline-flex text-muted hover:text-fg">${renderToStaticMarkup(h(EntryIcon, { icon: i.icon, className: "h-5 w-5" }))}</a></li>`).join("")}</ul>`;

/** Une liste d'entrées telle que le site la rend (vrai composant `EntryList` du cœur) : `entries` = [{ title, icon, url }]. */
export const entryListHtml = (entries, display = "links", { locale = "fr" } = {}) => renderToStaticMarkup(h(EntryList, {
  entries: entries.map((e, i) => ({ id: `e${i}`, locale, slug: `e${i}`, summary: null, body: "", cover: null, publishedAt: new Date("2026-10-01"), fields: [], code: null, ...e })),
  collection: { display, clickAction: "external" }, locale, defaultLocale: locale,
}));
