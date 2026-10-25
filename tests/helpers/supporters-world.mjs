// Un « monde » de test pour Soutiens : un contexte de module branché (si on veut) sur le double de Contacts (tests/helpers/fakeContactBook.mjs, jamais modifié) et son extension
// « contact.curate » (fakeContactCurate.mjs), une imitation du réglage « choix parmi » du cœur (`ctx.resolveChoice`), et un faux fournisseur de plateforme (fakePatreon.mjs).
// Aucun réseau : les appels partent dans le client réseau du cœur, branché sur un faux `fetch`.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./fakeCtx.mjs";
import { fakeContactBook } from "./fakeContactBook.mjs";
import { fakeContactCurate } from "./fakeContactCurate.mjs";

export const DIR = new URL("../../modules/supporters", import.meta.url).pathname;
export const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
export const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
export const en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
export const def = (await import("../../modules/supporters/index.mjs")).default;
export const P = await import("../../modules/supporters/pure.mjs");
export const R = await import("../../modules/supporters/providers.mjs");
export const D = await import("../../modules/supporters/data.mjs");
export const S = await import("../../modules/supporters/sync.mjs");
export const C = await import("../../modules/supporters/contacts.mjs");
export const O = await import("../../modules/supporters/ops.mjs");
export const V = await import("../../modules/supporters/view.mjs");
export const Routes = await import("../../modules/supporters/routes.mjs");
export const Admin = await import("../../modules/supporters/admin.mjs");
export const Mcp = await import("../../modules/supporters/mcp.mjs");
export const Privacy = await import("../../modules/supporters/privacy.mjs");
export const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs")).href);

/** À appeler avant chaque test : mémoires vides. */
export function reset() { D.forget(); Routes.resetLimits(); }

/** Imite le cœur pour un réglage `choice` de catégorie : valeur brute vérifiée auprès de Contacts (chosen / only / ambiguous / none / missing). */
function choiceFor(book, settings, key) {
  return async () => {
    const all = (await book.methods.categories({ limit: 50 })).items;
    const raw = settings[key];
    if (raw) {
      const r = await book.methods.categoriesResolve({ ids: [raw] });
      if (r.items[0]) return { status: "chosen", id: r.items[0].id, label: r.items[0].label };
      if (r.moved?.[raw]) { const to = all.find((k) => k.id === r.moved[raw]); return { status: "chosen", id: r.moved[raw], label: to?.label ?? "" }; }
      return all.length === 1 ? { status: "missing", id: all[0].id, label: all[0].label } : { status: "missing" };
    }
    if (all.length === 1) return { status: "only", id: all[0].id, label: all[0].label };
    return all.length ? { status: "ambiguous" } : { status: "none" };
  };
}

/**
 * Un monde : { book, curate, ctx, settings }. `settings` est modifiable après coup (le contexte le relit à chaque appel).
 * `can` : true (tous les droits), false, ou la liste des droits du module. `withBook: false` : pas de Contacts du tout.
 */
export function makeWorld({ book = fakeContactBook(), settings = {}, locale = "fr", locales = ["fr", "en"], can = true, withBook = true, withCurate = true, key = "soutiens", basePath = "soutiens", extra = {} } = {}) {
  const curate = fakeContactCurate(book);
  const all = { provider: "patreon", accessToken: "tok-creator", publicPage: true, ...settings };
  const choices = {};
  for (const k of ["category", "wallCategory"]) choices[k] = choiceFor(book, all, k);
  const ctx = fakeCtx({
    key, moduleId: "supporters", name: "Soutiens", basePath, locale, defaultLocale: "fr", locales, messages: locale === "en" ? { ...en } : { ...fr },
    permissions: manifest.permissions, settings: all, choices, siteUrl: "https://site.example.test",
    ...(withBook ? { services: { ...book.services, ...(withCurate ? { "contact.curate": curate.methods } : {}) } } : {}), ...extra,
  });
  ctx.can = (right) => (can === true ? true : Array.isArray(can) ? can.includes(right) : false);
  return { book, curate, ctx, settings: all };
}

/** Une requête de formulaire (l'accord). */
export const formRequest = (url, fields, headers = {}) => new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "198.51.100.9", ...headers }, body: new URLSearchParams(fields).toString() });

/** Le texte de tout ce que la page publique rend (les blocs `html` et `markdown`), sans la feuille de style. */
export const htmlOf = (page) => (page.blocks ?? []).map((b) => (b.html ?? b.text ?? "").replace(/<style>.*?<\/style>/gs, "")).join("\n");

/** Un petit parcours : ajoute N soutiens par fichier importé (rapide, sans réseau). */
export async function seedByFile(ctx, lines) {
  return O.importText(ctx, ["nom;palier;depuis", ...lines].join("\n"));
}
