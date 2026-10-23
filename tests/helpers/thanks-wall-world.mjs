// Un « monde » de test pour le Mur des remerciements : un contexte de module branché sur le double de Contacts (tests/helpers/fakeContactBook.mjs, jamais modifié)
// et une imitation du réglage « choix parmi » du cœur (`ctx.resolveChoice`) qui interroge ce même double : chosen / only / ambiguous / none / missing (+ fusion `moved`).
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";
import { fakeContactBook } from "./fakeContactBook.mjs";

export const DIR = new URL("../../modules/thanks-wall", import.meta.url).pathname;
export const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
export const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
export const en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
export const def = (await import("../../modules/thanks-wall/index.mjs")).default;
export const P = await import("../../modules/thanks-wall/pure.mjs");
export const C = await import("../../modules/thanks-wall/contacts.mjs");
export const D = await import("../../modules/thanks-wall/data.mjs");
export const View = await import("../../modules/thanks-wall/view.mjs");
export const Admin = await import("../../modules/thanks-wall/admin.mjs");
export const Mcp = await import("../../modules/thanks-wall/mcp.mjs");
export const Privacy = await import("../../modules/thanks-wall/privacy.mjs");

export const TW_PHOTO = "https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png";
export const YT_PHOTO = "https://yt3.ggpht.com/ytc/AIdro_kAbCdEfGhIjKlMnOpQrStUvWxYz0123456789=s240-c-k-c0x00ffffff-no-rj";
export const EVIL_PHOTO = "https://evil.example/photo.png";

const timing0 = { ...C.timing };
/** À appeler avant chaque test : des délais courts (les pannes se constatent vite) et une mémoire vide. */
export function reset(over = {}) {
  Object.assign(C.timing, timing0, { callMs: 150, providersMs: 150, buildMs: 600, ...over });
  C.resetWall();
  D.forgetData();
}
export const restore = () => { Object.assign(C.timing, timing0); C.resetWall(); D.forgetData(); };

/**
 * Imite le cœur : la valeur brute du réglage, vérifiée auprès de Contacts.
 *  - valeur connue → chosen ; fusionnée → chosen (nouvel id) ; disparue → missing (avec l'unique option restante s'il n'y en a qu'une) ;
 *  - rien de choisi : une seule option → only, aucune → none, plusieurs → ambiguous.
 */
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
 * Un monde : { book, ctx, settings }. `settings` est modifiable après coup (le contexte le relit à chaque appel).
 * `can` : true (tous les droits), false, ou la liste des droits du module. `withBook: false` : pas de Contacts du tout.
 */
export function makeWorld({ book = fakeContactBook(), settings = {}, locale = "fr", locales = ["fr", "en"], can = true, withBook = true, key = "merci", basePath = "merci", extra = {} } = {}) {
  const choices = {};
  for (const k of ["category", "category2", "category3", "category4", "category5", "category6", "hide"]) choices[k] = choiceFor(book, settings, k);
  const ctx = fakeCtx({
    key, moduleId: "thanks-wall", name: "Merci", basePath, locale, defaultLocale: "fr", locales, messages: locale === "en" ? { ...en } : { ...fr },
    permissions: manifest.permissions, settings, choices, ...(withBook ? { services: book.services } : {}), siteUrl: "https://site.example.test", ...extra,
  });
  ctx.can = (right) => (can === true ? true : Array.isArray(can) ? can.includes(right) : false);
  return { book, ctx, settings };
}

/** n fiches rangées dans une catégorie : [{ id, name }]. */
export function people(book, categoryId, n, { prefix = "Personne", photo, extra = {} } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const name = `${prefix} ${String(i + 1).padStart(3, "0")}`;
    const { id } = book.seedContact({ name, categoryIds: [categoryId], ...(photo ? { photo } : {}), ...extra });
    return { id, name };
  });
}

/** Le texte de tout ce que la page publique rend (les blocs `html` et `markdown`), sans la feuille de style. */
export const htmlOf = (page) => (page.blocks ?? []).map((b) => (b.html ?? b.text ?? "").replace(/<style>.*?<\/style>/gs, "")).join("\n");
