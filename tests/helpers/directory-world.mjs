// Un « monde » de test pour l'Annuaire : un contexte de module branché sur le double de Contacts (tests/helpers/fakeContactBook.mjs, jamais modifié)
// et une imitation du réglage « choix parmi » du cœur (`ctx.resolveChoice`) qui interroge ce même double.
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";
import { fakeContactBook } from "./fakeContactBook.mjs";

export const DIR = new URL("../../modules/directory", import.meta.url).pathname;
export const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
export const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
export const en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
export const def = (await import("../../modules/directory/index.mjs")).default;
export const P = await import("../../modules/directory/pure.mjs");
export const C = await import("../../modules/directory/contacts.mjs");
export const D = await import("../../modules/directory/data.mjs");
export const Dir = await import("../../modules/directory/directory.mjs");
export const View = await import("../../modules/directory/view.mjs");
export const Admin = await import("../../modules/directory/admin.mjs");
export const Mcp = await import("../../modules/directory/mcp.mjs");
export const Privacy = await import("../../modules/directory/privacy.mjs");
export const Routes = await import("../../modules/directory/routes.mjs");
export const Geo = await import("../../modules/directory/geocode.mjs");

export const TW_PHOTO = "https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png";
export const EVIL_PHOTO = "https://evil.example/photo.png";

const timing0 = { ...C.timing };
/** À appeler avant chaque test : des délais courts (les pannes se constatent vite) et une mémoire vide. */
export function reset(over = {}) {
  Object.assign(C.timing, timing0, { callMs: 150, providersMs: 150, buildMs: 800, staleWaitMs: 200, ...over });
  C.resetModel();
  D.forgetData();
  Routes.resetLimits();
}
export const restore = () => { Object.assign(C.timing, timing0); C.resetModel(); D.forgetData(); Routes.resetLimits(); };

/** Imite le cœur : la valeur brute du réglage, vérifiée auprès de Contacts (chosen / only / ambiguous / none / missing, fusion `moved` suivie). */
function choiceFor(book, settings, key) {
  return async () => {
    const all = (await book.methods.categories({ limit: 50 })).items;
    const raw = settings[key];
    if (raw) {
      const r = await book.methods.categoriesResolve({ ids: [raw] });
      if (r.items[0]) return { status: "chosen", id: r.items[0].id, label: r.items[0].label };
      if (r.moved?.[raw]) { const to = all.find((k) => k.id === r.moved[raw]); return { status: "chosen", id: r.moved[raw], label: to?.label ?? "" }; }
      return { status: "missing" };
    }
    return all.length === 1 ? { status: "only", id: all[0].id, label: all[0].label } : all.length ? { status: "ambiguous" } : { status: "none" };
  };
}

/** Un monde : { book, ctx, settings }. `settings` est modifiable après coup. `can` : true (tous les droits), false, ou la liste des droits. `withBook: false` : pas de Contacts du tout. */
let worlds = 0;
export function makeWorld({ book = fakeContactBook(), settings = {}, locale = "fr", locales = ["fr", "en"], can = true, withBook = true, key = `annuaire-${++worlds}`, basePath = "annuaire", extra = {} } = {}) {
  const choices = {};
  for (const k of ["hide", "consent", "mapConsent"]) choices[k] = choiceFor(book, settings, k);
  const ctx = fakeCtx({
    key, moduleId: "directory", name: "Annuaire", basePath, locale, defaultLocale: "fr", locales, messages: locale === "en" ? { ...en } : { ...fr },
    permissions: manifest.permissions, settings, choices, ...(withBook ? { services: book.services } : {}), siteUrl: "https://site.example.test", ...extra,
  });
  ctx.can = (right) => (can === true ? true : Array.isArray(can) ? can.includes(right) : false);
  return { book, ctx, settings };
}

/** Rend publiques ces catégories de Contacts [{ id, label? }] (dans l'ordre). */
export async function publish(ctx, cats) {
  await D.addCategories(ctx, cats.map((c) => ({ catId: typeof c === "string" ? c : c.id, label: typeof c === "string" ? "" : c.label ?? "" })));
}

/** n fiches rangées dans des catégories : [{ id, name }]. */
export function people(book, categoryIds, n, { prefix = "Personne", photo, extra = {} } = {}) {
  const cats = Array.isArray(categoryIds) ? categoryIds : [categoryIds];
  return Array.from({ length: n }, (_, i) => {
    const name = `${prefix} ${String(i + 1).padStart(3, "0")}`;
    const { id } = book.seedContact({ name, categoryIds: cats, ...(photo ? { photo } : {}), ...extra });
    return { id, name };
  });
}

/** Le texte de tout ce que la page publique rend (les blocs `html` et `markdown`), sans la feuille de style. */
export const htmlOf = (page) => (page.blocks ?? []).map((b) => (b.html ?? b.text ?? "").replace(/<style>.*?<\/style>/gs, "")).join("\n");
export const page = (ctx, ...segments) => def.page(ctx, { segments });
export const run = (ctx, name, values) => { const a = def.adminActions[name]; return (typeof a === "function" ? a : a.run)(ctx, values); };
export const panel = (ctx, query = {}) => def.adminPanel(ctx, { query });
