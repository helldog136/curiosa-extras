// Aides communes aux tests du module « Questions fréquentes » (faux contexte avec les vrais textes, requêtes de formulaire).
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";

export const DIR = new URL("../../modules/faq", import.meta.url).pathname;
export const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
export const messages = (lang) => JSON.parse(fs.readFileSync(`${DIR}/locales/${lang}.json`, "utf8"));
export const def = (await import("../../modules/faq/index.mjs")).default;
export const data = await import("../../modules/faq/data.mjs");
export const text = await import("../../modules/faq/text.mjs");
export const view = await import("../../modules/faq/view.mjs");
export const client = await import("../../modules/faq/client.mjs");
export const index = await import("../../modules/faq/index.mjs");

let seq = 0;
/** Contexte factice : chaque appel a sa propre clé d'instance (les limiteurs en mémoire sont par clé). `rights` : droits de la personne qui regarde l'administration. */
export function ctxFor(settings = {}, opts = {}) {
  const { rights = ["edit", "publish"], locale = "fr", ...rest } = opts;
  const ctx = fakeCtx({
    key: `faq${++seq}`, basePath: "faq", moduleId: "faq", name: locale === "fr" ? "Questions fréquentes" : "FAQ",
    locale, defaultLocale: "fr", locales: ["fr", "en"], messages: messages(["fr", "en"].includes(locale) ? locale : "en"), permissions: manifest.permissions, settings, ...rest,
  });
  ctx.can = (right) => rights.includes(right);
  return ctx;
}

/** Une requête POST de formulaire. */
export function post(route, fields, { ip = "203.0.113.7", headers = {} } = {}) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request(`https://example.org/m/x/${route}`, { method: "POST", body, headers: { "x-forwarded-for": ip, origin: "https://example.org", ...headers } });
}
export const json = { accept: "application/json" };

/** Ajoute une question publiée (ou brouillon) directement dans le stockage. */
export async function addItem(ctx, { q = "Quand streamez-vous ?", a = "Le soir.", en, theme = "", pos = 1, status = "published", slug, y = 0, n = 0, by = "admin" } = {}) {
  const tr = {};
  if (q) tr.fr = { q, a };
  if (en) tr.en = en;
  return ctx.api.store.add("faq_items", { slug: slug ?? text.slugify(q || en?.q || "x"), theme, pos, status, tr, y, n, by });
}
export const addTheme = (ctx, names, pos = 1) => ctx.api.store.add("faq_themes", { names, pos });
export const rows = (ctx, collection) => ctx.dumpStore().filter((r) => r.collection === collection).map((r) => ({ id: r.id, ...r.data }));
export const pageHtml = async (ctx) => (await def.page(ctx, { segments: [] })).blocks[0].html;
