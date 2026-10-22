// Aides des tests de « Santé du site » : un faux site (rubriques + entrées par langue), une horloge qu'on avance à la main, un faux réseau.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./fakeCtx.mjs";

export const DIR = new URL("../../modules/site-check", import.meta.url).pathname;
export const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
export const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
export const en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs")).href);
export const { withFakeFetch, fakeFetch, netReplies } = kit;
export const def = (await import("../../modules/site-check/index.mjs")).default;
export const U = await import("../../modules/site-check/urls.mjs");
export const P = await import("../../modules/site-check/probe.mjs");
export const S = await import("../../modules/site-check/scan.mjs");
export const R = await import("../../modules/site-check/run.mjs");
export const V = await import("../../modules/site-check/view.mjs");

/** Une entrée publiée (comme ctx.api.entries.list la rend). */
let seq = 0;
export const entry = (over = {}) => {
  const n = ++seq;
  return { id: `e${n}`, title: `Page ${n}`, summary: "Un résumé.", body: "Du texte.", slug: `page-${n}`, path: `/pages/page-${n}`, cover: null, icon: null, tags: [], fields: {}, url: null, code: null, publishedAt: new Date(), ...over };
};

/**
 * Un faux site. `entries` : { clé de rubrique: { langue: [entrées] } } (une liste simple vaut pour toutes les langues).
 * `instances` : [{ key, name, basePath }]. `social` : éléments du sujet « social.link ».
 */
export function makeSite({ instances = [{ key: "pages", name: "Pages", basePath: "pages" }], entries = {}, locales = ["fr", "en"], tagline = "Une accroche", contactEmail = "contact@example.org", social = [], settings = {}, locale = "fr", siteUrl = "https://mon-site.example.org", net } = {}) {
  const ctx = fakeCtx({
    moduleId: "site-check", key: "site-check", name: "Santé du site", basePath: null, locale, defaultLocale: "fr", locales, messages: locale === "fr" ? fr : en, settings,
    permissions: manifest.permissions, siteUrl, site: { name: "Mon site", tagline, logo: null }, topics: { "social.link": social },
    brand: { name: "Mon site", tagline, about: "", logo: null, contactEmail, colors: [], font: { key: "sans", name: "Sans", stack: "sans-serif" }, defaultLocale: "fr", locales },
    ...(net ? { net } : {}),
  });
  ctx.api.instances = { list: async () => instances.map((i) => ({ id: `id-${i.key}`, module: "blog", adminPath: `/admin/instances/id-${i.key}`, ...i })) };
  const perLocale = (key, loc) => { const e = entries[key]; return Array.isArray(e) ? e : e?.[loc] ?? []; };
  ctx.api.entries = { list: async ({ instance, locale: loc, limit }) => perLocale(instance, loc).slice(0, limit ?? 200) };
  return ctx;
}

/** Une horloge à la main : `sleep` l'avance, `now` la lit. */
export function clock(start = Date.parse("2026-10-22T10:00:00Z")) {
  let t = start;
  return { now: () => t, sleep: async (ms) => { t += ms; }, advance: (ms) => { t += ms; }, at: () => t };
}

export const publicDns = async () => ({ ok: true, addresses: ["93.184.216.34"] });
/** Réglages d'un passage sans attente réelle ni vraie résolution de noms. */
export const quick = (c = clock(), extra = {}) => ({ now: c.now, sleep: c.sleep, probeDeps: { resolve: publicDns }, ...extra });
export const links = (n, host = "example.org") => Array.from({ length: n }, (_, i) => `[Lien ${i}](https://${host}/p${i})`).join("\n");
/** Des liens vers beaucoup de sites différents (comme sur un vrai site) : `sites` sites, répartis. */
export const spread = (n, sites = 60) => Array.from({ length: n }, (_, i) => `[Lien ${i}](https://site${i % sites}.example.org/p${i})`).join("\n");
