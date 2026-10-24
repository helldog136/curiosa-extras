// Aides communes aux tests du module « Événements » : faux contexte avec les vrais textes, et des événements prêts à l'emploi.
// Les dates des tests sont fixes et lointaines (futur : 2031, passé : 2020) pour que rien ne dépende du jour où ils tournent.
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";

export const DIR = new URL("../../modules/events", import.meta.url).pathname;
export const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
export const messages = (lang) => JSON.parse(fs.readFileSync(`${DIR}/locales/${lang}.json`, "utf8"));
export const def = (await import("../../modules/events/index.mjs")).default;
export const index = await import("../../modules/events/index.mjs");
export const T = await import("../../modules/events/time.mjs");
export const X = await import("../../modules/events/text.mjs");
export const M = await import("../../modules/events/model.mjs");
export const D = await import("../../modules/events/data.mjs");
export const O = await import("../../modules/events/ops.mjs");
export const Q = await import("../../modules/events/query.mjs");
export const V = await import("../../modules/events/view.mjs");
export const U = await import("../../modules/events/urls.mjs");
export const L = await import("../../modules/events/links.mjs");
export const S = await import("../../modules/events/source.mjs");
export const CSV = await import("../../modules/events/csv.mjs");
export const ICS = await import("../../modules/events/ics.mjs");
export const A = await import("../../modules/events/admin.mjs");
export const TPL = await import("../../modules/events/templates.mjs");

let seq = 0;
/** Contexte factice : chaque appel a sa propre clé d'instance. `rights` : droits de la personne qui regarde l'administration. */
export function ctxFor(settings = {}, opts = {}) {
  const { rights = ["events.edit"], locale = "fr", ...rest } = opts;
  const ctx = fakeCtx({
    key: `agenda${++seq}`, basePath: "agenda", moduleId: "events", name: "Agenda", locale, defaultLocale: "fr", locales: ["fr", "en"],
    messages: messages(["fr", "en"].includes(locale) ? locale : "en"), permissions: manifest.permissions, settings: { timezone: "Europe/Paris", ...settings }, ...rest,
  });
  ctx.can = (right) => rights.includes(right);
  return ctx;
}

/** Ajoute un événement directement dans le stockage (sans passer par les vérifications). Renvoie son identifiant. */
export async function addEvent(ctx, fields = {}) {
  const doc = M.blank({ title: "Atelier de dessin", date: "2031-03-15", time: "14:00", status: "published", ...fields });
  doc.updatedAt ||= new Date().toISOString();
  if (fields.slug === undefined) doc.slug = `${X.slugify(doc.title, 30)}-${doc.date}-${++seq}`;
  const id = await ctx.api.store.add("ev_events", M.toDoc(doc));
  D.drop(ctx);
  return id;
}
export async function addType(ctx, { key = "atelier", names = { fr: "Atelier", en: "Workshop" }, color = "teal", icon = "", pos = 1 } = {}) {
  const id = await ctx.api.store.add("ev_types", { key, names, color, icon, pos });
  D.drop(ctx);
  return id;
}
export const rows = (ctx, collection) => ctx.dumpStore().filter((r) => r.collection === collection).map((r) => ({ id: r.id, ...r.data }));

/** La page publique (résultat complet) et le HTML de son premier bloc. */
export const page = (ctx, segments = []) => def.page(ctx, { segments });
export const html = async (ctx, segments = []) => (await page(ctx, segments)).blocks?.[0]?.html ?? "";

/** Une requête GET vers une route publique. */
export const get = (route, query = "", { ip = "203.0.113.7", method = "GET" } = {}) => new Request(`https://example.org/m/x/${route}${query ? `?${query}` : ""}`, { method, headers: { "x-forwarded-for": ip } });
