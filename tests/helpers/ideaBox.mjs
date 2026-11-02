// Boîte à idées : le monde des tests (un faux contexte, des idées inventées, des requêtes de formulaire).
import fs from "node:fs";
import { strict as assert } from "node:assert";
import { fakeCtx } from "./fakeCtx.mjs";

export const DIR = new URL("../../modules/idea-box", import.meta.url).pathname;
export const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
export const manifestJson = readJson("module.json");
export const fr = readJson("locales/fr.json");
export const en = readJson("locales/en.json");
export const def = (await import("../../modules/idea-box/index.mjs")).default;
export const lib = await import("../../modules/idea-box/lib.mjs");
export const ops = await import("../../modules/idea-box/ops.mjs");

let n = 0;
/** Un contexte comme celui du cœur : les droits et les événements du journal viennent du manifeste. */
export const ctxFor = (settings = {}, over = {}) => fakeCtx({
  key: `ib${++n}`, basePath: "idees", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: fr, settings,
  logEvents: manifestJson.logEvents, permissions: manifestJson.permissions, ...over,
});

export const form = (url, fields, headers = {}) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.set(k, v); return new Request(url, { method: "POST", body: fd, headers }); };
export const propose = (ctx, fields, ip = "1.1.1.1", headers = {}) => def.routes.propose(form("https://x.test/m/k/propose", fields, { "x-forwarded-for": ip, ...headers }), ctx);
export const support = (ctx, fields, ip = "1.1.1.1", headers = {}) => def.routes.support(form("https://x.test/m/k/support", fields, { "x-forwarded-for": ip, ...headers }), ctx);
/** La note affichée au retour (#ib-…). */
export const note = (res) => { assert(res.status === 303, `303 attendu, reçu ${res.status}`); return /#ib-([a-z]+)$/.exec(res.headers.get("location"))?.[1]; };

/** Une idée directement dans le stockage (état, statut, soutiens au choix). */
export const seed = (ctx, over = {}) => ctx.api.store.add("ideas", { text: "Un stream de cuisine le dimanche", nick: null, state: "published", status: "proposed", votes: 0, reply: null, refusedAt: null, merged: [], ...over });
export const all = async (ctx) => (await ctx.api.store.list("ideas", { limit: 1000 })).map((r) => ({ id: r.id, ...r.data }));
export const run = (name, ctx, values) => { const a = def.adminActions[name]; return (typeof a === "function" ? a : a.run)(ctx, values); };
export const tableOf = (blocks) => blocks.find((b) => b.type === "table");
export const htmlOf = (blocks) => blocks.filter((b) => b.type === "html").map((b) => b.html).join("\n");
