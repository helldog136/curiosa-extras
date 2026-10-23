// Fait tourner le VRAI module Participation dans un faux contexte (stockage avec clés, comme le cœur) : de quoi le tester sans serveur.
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";
import { pollsStore } from "./pollsStore.mjs";

const DIR = new URL("../../modules/audience", import.meta.url).pathname;
export const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
export const manifest = readJson("module.json");
export const fr = readJson("locales/fr.json");
export const en = readJson("locales/en.json");
export const mod = await import("../../modules/audience/index.mjs");
export const L = await import("../../modules/audience/lib.mjs");
export const K = await import("../../modules/audience/core.mjs");
export const C = await import("../../modules/audience/client.mjs");
export const R = await import("../../modules/audience/remote.mjs");
export const def = mod.default;

let n = 0;
/** Un contexte du module : { rights: false } pour une personne sans droit, `can` pour choisir lesquels. */
export function audienceCtx({ settings = {}, locale = "fr", messages = fr, can = true, services, serviceInstances, ...over } = {}) {
  const c = fakeCtx({ moduleId: "audience", key: `audience${++n}`, basePath: "participation", locale, messages, settings, services, serviceInstances, ...over });
  c.api.store = pollsStore();
  c.can = typeof can === "function" ? can : () => can;
  return c;
}

/** Les méthodes du service, liées à un contexte. */
export function bind(ctx, { rights = null } = {}) {
  const out = {};
  const svc = def.services["audience.session"];
  const run = rights === null ? ctx : Object.assign(Object.create(ctx), { can: (r) => (typeof rights === "function" ? rights(r) : rights) });
  for (const [name, fn] of Object.entries(svc)) out[name] = (args) => fn(run, args);
  return out;
}

/** Une requête de route (POST JSON par défaut). */
export const req = (url, body, { method, ip = "9.9.9.9", headers = {} } = {}) => new Request(url, { method: method ?? (body === undefined ? "GET" : "POST"), body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body), headers: { "x-forwarded-for": ip, "content-type": "application/json", ...headers } });
export const tok = (i = 0) => `tk${String(i).padStart(5, "0")}${"x".repeat(18)}`;
export const call = async (route, ctx, request) => { const r = await def.routes[route](request, ctx); return r; };
export const jsonOf = async (response) => response.json();
