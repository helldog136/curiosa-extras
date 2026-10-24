// Aides communes aux tests du module « Jeu du jour » : faux contexte avec les vrais textes, requêtes JSON, banque de questions, horloge.
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";

export const DIR = new URL("../../modules/daily-game", import.meta.url).pathname;
export const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
export const messages = (lang) => JSON.parse(fs.readFileSync(`${DIR}/locales/${lang}.json`, "utf8"));
export const index = await import("../../modules/daily-game/index.mjs");
export const def = index.default;
export const L = await import("../../modules/daily-game/lib.mjs");
export const G = await import("../../modules/daily-game/games.mjs");
export const P = await import("../../modules/daily-game/plan.mjs");
export const D = await import("../../modules/daily-game/data.mjs");
export const PK = await import("../../modules/daily-game/packs.mjs");
export const K = await import("../../modules/daily-game/csv.mjs");
export const V = await import("../../modules/daily-game/view.mjs");
export const C = await import("../../modules/daily-game/client.mjs");
export const B = await import("../../modules/daily-game/bridge.mjs");

let seq = 0;
/** Contexte factice : chaque appel a sa propre clé d'instance (les limiteurs en mémoire sont par clé). `rights` : droits de la personne qui regarde l'administration. */
export function ctxFor(settings = {}, opts = {}) {
  const { rights = ["edit", "publish", "moderate"], locale = "fr", ...rest } = opts;
  const ctx = fakeCtx({
    key: `dg${++seq}`, basePath: "jeu-du-jour", moduleId: "daily-game", name: locale === "fr" ? "Jeu du jour" : "Daily game",
    locale, defaultLocale: "fr", locales: ["fr", "en"], messages: messages(["fr", "en"].includes(locale) ? locale : "en"), permissions: manifest.permissions, settings: { timezone: "UTC", ...settings }, ...rest,
  });
  ctx.can = (right) => rights.includes(right);
  return ctx;
}

/** Une requête en JSON. `ip` : la dernière adresse de X-Forwarded-For (celle du relais du site). */
export function post(route, body, { ip = "203.0.113.7", method = "POST", headers = {} } = {}) {
  return new Request(`https://example.org/m/x/${route}`, { method, body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": ip, origin: "https://example.org", ...headers } });
}

export const NOON = Date.UTC(2026, 9, 24, 12, 0, 0);   // samedi 24 octobre 2026, midi (UTC)
export const at = (day, hour = 12) => Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);

/** Contenu d'un quiz : fr (et en) ; `correct` : numéro 1 à 4. */
export const quizData = ({ q = "Quelle couleur donne le bleu et le jaune ?", a = ["Le vert", "Le violet", "L'orange"], correct = 1, e = "Le bleu et le jaune donnent du vert.", en, img = "", alt = "" } = {}) => ({
  tr: { ...(q ? { fr: { q, a, e, alt } } : {}), ...(en ? { en } : {}) }, correct: correct - 1, img,
});

/** Ajoute une question directement dans le stockage. */
export async function addQuestion(ctx, { status = "published", cat = "", lvl = "", date, pos, by = "admin", pack, type = "quiz", ...data } = {}) {
  const n = ctx.dumpStore().filter((r) => r.collection === "dg_questions").length;
  const doc = { type, status, cat, lvl, pos: pos ?? n + 1, by, d: quizData(data) };
  if (date) doc.date = date;
  if (pack) doc.pack = pack;
  D.invalidate(ctx);
  return ctx.api.store.add("dg_questions", doc);
}
/** Ajoute `n` questions numérotées « Q1 », « Q2 »… dans l'ordre. */
export async function addMany(ctx, n, extra = {}) {
  const ids = [];
  for (let i = 1; i <= n; i++) ids.push(await addQuestion(ctx, { q: `Q${i} ?`, a: [`A${i}`, `B${i}`], correct: 1, pos: i, ...extra }));
  return ids;
}
export const rows = (ctx, collection) => ctx.dumpStore().filter((r) => r.collection === collection).map((r) => ({ id: r.id, ...r.data }));
export const pageHtml = async (ctx, now = NOON) => (await V.renderPage(ctx, now)).html;
export const textOf = (blocks) => JSON.stringify(blocks);
