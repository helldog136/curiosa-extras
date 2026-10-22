// Aides communes des tests du module Témoignages : un faux contexte avec les vrais textes, des envois de formulaire, des avis rangés d'avance.
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";

export const DIR = new URL("../../modules/testimonials", import.meta.url).pathname;
export const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
export const manifestJson = readJson("module.json");
export const messages = { fr: readJson("locales/fr.json"), en: readJson("locales/en.json") };
export const def = (await import("../../modules/testimonials/index.mjs")).default;
export const L = await import("../../modules/testimonials/lib.mjs");
export const D = await import("../../modules/testimonials/data.mjs");
export const V = await import("../../modules/testimonials/view.mjs");
export const A = await import("../../modules/testimonials/admin.mjs");

let seq = 0;
/** Un contexte par test (chaque clé d'instance a ses propres compteurs de débit). `rights` : ce que `ctx.can` accorde. */
export function ctxFor({ settings = {}, locale = "en", rights = null, ...opts } = {}) {
  const ctx = fakeCtx({ key: `tm${++seq}`, basePath: "avis", moduleId: "testimonials", locale, defaultLocale: "fr", locales: ["fr", "en"], messages: messages[locale], settings, ...opts });
  if (rights) ctx.can = (right) => rights === "all" || rights.includes(right);
  return ctx;
}

export const NOW = Date.now();
export const DAY = 86_400_000;
/** Un avis rangé d'avance (publié et avec accord par défaut). */
export function review(over = {}) {
  const at = over.at ?? NOW - DAY;
  const { at: _at, ...rest } = over;
  return {
    status: "approved", name: "Camille", text: "Un accueil très chaleureux, je recommande !", rating: 5, featured: false, position: null, photo: null,
    email: null, emailUntil: null, consent: { text: "J'accepte", at: new Date(at).toISOString(), locale: "fr", by: "visitor" },
    tokenHash: "", decidedAt: new Date(at).toISOString(), publishedAt: new Date(at).toISOString(), editedAt: null, submittedAt: new Date(at).toISOString(), ...rest,
  };
}
export const seed = (ctx, data) => ctx.api.store.add("reviews", review(data));
export async function seedMany(ctx, n, over = (i) => ({})) { const ids = []; for (let i = 0; i < n; i++) ids.push(await seed(ctx, { name: `Personne ${i}`, text: `Avis numéro ${i}, très sympa.`, at: NOW - (i + 1) * 3_600_000, ...over(i) })); return ids; }

/** Un envoi de formulaire. `ip` : la valeur de l'en-tête (le DERNIER nom compte). */
export function post(fields, ip = "203.0.113.7", path = "send") {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request(`https://example.org/m/x/${path}?lang=en`, { method: "POST", body, headers: { "x-forwarded-for": ip } });
}
export const GOOD = { name: "Camille", text: "Un accueil très chaleureux, je recommande !", rating: "5", consent: "yes" };
export const send = (ctx, fields = {}, ip) => def.routes.send(post({ ...GOOD, ...fields }, ip), ctx);
/** Tous les textes d'une page ou d'une section, mis bout à bout (html, markdown, titres…). */
export const flat = (res) => JSON.stringify(res ?? null);
export const htmlOf = (res) => (Array.isArray(res) ? res : res?.blocks ?? []).map((b) => b.html ?? b.text ?? b.label ?? "").join("\n").replace(/<style>[\s\S]*?<\/style>/g, "");     // sans le style, qui est le même partout
export const page = async (ctx, ...segments) => def.page(ctx, { segments });
export const stored = (ctx) => ctx.dumpStore().filter((r) => r.collection === "reviews");
export const location = (res) => res.headers.get("location");
