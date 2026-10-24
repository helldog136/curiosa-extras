// Aides communes aux tests du module « Carte » : faux contexte avec les vrais textes et un stockage complet (clé, pages, addMany, génération),
// requêtes vers les routes publiques, lieux d'exemple.
import fs from "node:fs";
import assert from "node:assert/strict";
import { fakeCtx } from "./fakeCtx.mjs";

/** Comme assert.match, sans recopier une page entière dans le message quand ça échoue. */
export const has = (text, re, message) => assert.ok(re.test(String(text)), message ?? `${re} introuvable (${String(text).length} caractères)`);

export const DIR = new URL("../../modules/map", import.meta.url).pathname;
export const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
export const messages = (lang) => JSON.parse(fs.readFileSync(`${DIR}/locales/${lang}.json`, "utf8"));
export const def = (await import("../../modules/map/index.mjs")).default;
export const index = await import("../../modules/map/index.mjs");
export const text = await import("../../modules/map/text.mjs");
export const geo = await import("../../modules/map/geo.mjs");
export const data = await import("../../modules/map/data.mjs");
export const view = await import("../../modules/map/view.mjs");
export const ops = await import("../../modules/map/ops.mjs");
export const csvio = await import("../../modules/map/csvio.mjs");
export const templates = await import("../../modules/map/templates.mjs");
export const { fakeMapPlaces } = await import("./fakeMapPlaces.mjs");

/** Un stockage en mémoire qui se comporte comme celui du cœur (ordre, pages, addMany, génération), pour essayer les volumes. */
export function fullStore() {
  const rows = new Map();
  let seq = 0;
  const gen = 1;
  const clone = (v) => structuredClone(v);
  const make = (collection, d, key) => { const id = `r${++seq}`; rows.set(id, { id, collection, createdAt: new Date(1_700_000_000_000 + seq), data: clone(d), key: key ?? null }); return id; };
  const out = (r) => ({ id: r.id, createdAt: r.createdAt, data: clone(r.data), key: r.key });
  const of = (collection) => [...rows.values()].filter((r) => r.collection === collection);
  return {
    rows,
    async add(collection, d, o) { return make(collection, d, o?.key); },
    async get(id) { const r = rows.get(id); return r ? out(r) : null; },
    async update(id, d) { if (!rows.has(id)) return false; rows.get(id).data = clone(d); return true; },
    async list(collection, o) { return of(collection).sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.min(o?.limit ?? 100, 10_000)).map(out); },
    async page(collection, o) {
      const all = of(collection).sort((a, b) => (o?.order === "asc" ? 1 : -1) * (a.createdAt - b.createdAt));
      const start = Math.max(0, Number(o?.cursor ?? 0) || 0);
      const limit = Math.min(Math.max(1, o?.limit ?? 100), 1000);
      return { items: all.slice(start, start + limit).map(out), next: start + limit < all.length ? String(start + limit) : null };
    },
    async remove(id) { rows.delete(id); },
    async count(collection) { return of(collection).length; },
    async addMany(collection, list) { return list.slice(0, 5000).map((x) => make(collection, x.data, x.key)); },
    async generation() { return gen; },
    async getByKey(collection, key) { return of(collection).filter((r) => r.key === key).map(out)[0] ?? null; },
  };
}

let seq = 0;
/** Contexte factice : chaque appel a sa propre clé d'instance (la mémoire du module est par clé). */
export function ctxFor(settings = {}, opts = {}) {
  const { rights = ["edit", "publish"], locale = "fr", topics = {}, basePath = "map", name = locale === "fr" ? "Carte" : "Map", ...rest } = opts;
  const ctx = fakeCtx({
    key: `map${++seq}`, basePath, moduleId: "map", name, locale, defaultLocale: "fr", locales: ["fr", "en"],
    messages: messages(["fr", "en"].includes(locale) ? locale : "en"), permissions: manifest.permissions, settings: { sort: "order", directions: "osm", ...settings }, topics, ...rest,
  });
  ctx.api.store = fullStore();
  ctx.can = (right) => rights.includes(right);
  return ctx;
}

/** Une requête GET vers une route publique. */
export function get(route, params = {}, { ip = "203.0.113.7", method = "GET" } = {}) {
  const url = new URL(`https://example.org/m/x/${route}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url, { method, headers: { "x-forwarded-for": ip } });
}

/** Ajoute un lieu directement dans le stockage (état, rang…). Rend son code. */
let n = 0;
export async function addPlace(ctx, { name = `Lieu ${++n}`, type = "place", lat = 12.3456 + n / 1000, lng = 34.5678 + n / 1000, address = "", desc = "", hours = "", url = "", status = "published", pos, by = "admin", code } = {}) {
  const c = code ?? `p${String(++n).padStart(7, "0")}x`;
  const list = await ctx.api.store.list("map_places", { limit: 10_000 });
  await ctx.api.store.add("map_places", { code: c, name, type, lat, lng, address, desc, hours, url, status, pos: pos ?? list.length + 1, by });
  data.invalidate(ctx);
  return c;
}
export async function addType(ctx, id, fr, en = fr, sym = "📍", pos) {
  const list = await ctx.api.store.list("map_types", { limit: 100 });
  await ctx.api.store.add("map_types", { id, names: { fr, en }, sym, pos: pos ?? list.length + 1 });
  data.invalidate(ctx);
}
export const rows = (ctx, collection) => [...ctx.api.store.rows.values()].filter((r) => r.collection === collection).map((r) => ({ id: r.id, ...r.data }));
export const page = async (ctx, segments = []) => def.page(ctx, { segments });
export const html = async (ctx, segments = []) => (await page(ctx, segments)).blocks[0].html;
