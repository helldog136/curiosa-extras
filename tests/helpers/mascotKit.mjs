// Aides communes aux tests du module « Mascotte » : faux contexte avec les vrais textes, faux fournisseurs (événements), requêtes.
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";

export const DIR = new URL("../../modules/mascot", import.meta.url).pathname;
export const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
export const messages = (lang) => JSON.parse(fs.readFileSync(`${DIR}/locales/${lang}.json`, "utf8"));
export const def = (await import("../../modules/mascot/index.mjs")).default;
export const model = await import("../../modules/mascot/model.mjs");
export const store = await import("../../modules/mascot/store.mjs");
export const lines = await import("../../modules/mascot/lines.mjs");
export const assets = await import("../../modules/mascot/assets.mjs");
export const admin = await import("../../modules/mascot/admin.mjs");
export const face = await import("../../modules/mascot/face.mjs");
export const client = await import("../../modules/mascot/client.mjs");
export const starters = await import("../../modules/mascot/starters.mjs");

/** Les réglages du cœur tels que le module les lit quand rien n'a été changé (les valeurs par défaut du manifeste). */
export const defaults = Object.fromEntries(manifest.settings.filter((s) => "default" in s).map((s) => [s.key, s.default]));

let seq = 0;
/** Contexte factice : chaque appel a sa propre clé d'instance. `rights` : droits de la personne qui regarde l'administration. */
export function ctxFor(settings = {}, opts = {}) {
  const { rights = ["edit", "publish"], locale = "fr", locales = ["fr", "en"], ...rest } = opts;
  const ctx = fakeCtx({
    key: `mascot${++seq}`, basePath: null, moduleId: "mascot", name: "Mascotte", locale, defaultLocale: "fr", locales,
    messages: messages(["fr", "en"].includes(locale) ? locale : "en"), permissions: manifest.permissions, settings: { ...defaults, ...settings }, site: { name: "Demo", tagline: "", logo: null }, ...rest,
  });
  ctx.can = (right) => rights.includes(right);
  return ctx;
}

/** Une mascotte publiée avec ses phrases de départ. */
export async function publishedCtx(settings = {}, opts = {}) {
  const ctx = ctxFor(settings, opts);
  await def.hooks.onInstanceCreate(ctx);
  await store.saveConfig(ctx, { published: true });
  return ctx;
}

export const rows = (ctx, collection) => ctx.dumpStore().filter((r) => r.collection === collection).map((r) => ({ id: r.id, ...r.data }));
export const get = (path, { headers = {}, method = "GET" } = {}) => new Request(`https://example.test${path}`, { method, headers });

/** Un faux fournisseur de `event.source` (une instance) : `events` ou une fonction. */
export function eventSource(events, { label = "Demo" } = {}) {
  return { "event.source": { upcoming: async (args) => (typeof events === "function" ? events(args) : { ok: true, source: { kind: "other", label }, state: "ok", events }) } };
}
export const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
