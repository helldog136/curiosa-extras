// Aides des tests de Contacts (lot K2) : un contexte de module prêt à l'emploi, l'enchaînement des pas d'import, la lecture d'un export.
// Ne touche à rien du contrat de « contact.book » (tests/helpers/fakeContactBook.mjs, tests/contract/*).
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";
import { memStore } from "./contactsStore.mjs";

export const DIR = new URL("../../modules/contacts", import.meta.url).pathname;
export const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
export const def = (await import("../../modules/contacts/index.mjs")).default;
export const B = await import("../../modules/contacts/book.mjs");
export const D = await import("../../modules/contacts/data.mjs");
export const N = await import("../../modules/contacts/networks.mjs");
export const C = await import("../../modules/contacts/csv.mjs");
export const I = await import("../../modules/contacts/import.mjs");
export const DD = await import("../../modules/contacts/dedupe.mjs");
export const PH = await import("../../modules/contacts/photos.mjs");
export const PV = await import("../../modules/contacts/privacy.mjs");
export const svc = def.services["contact.book"];

let n = 0;
/**
 * Un contexte Contacts neuf. `rights` : droits de la personne connectée ; `test` : options de test internes (délais raccourcis) ; `subjects` : les
 * fournisseurs « privacy.subject » ; `services` : autres services (twitch.api…) ; `offset` : décale les identifiants du stockage (deux carnets d'un même test
 * ne partagent alors aucun identifiant, comme deux sites réels).
 */
export function makeCtx({ locale = "en", rights = ["email.view", "categories.create", "export"], store = memStore(), test = {}, subjects = [], services = {}, offset = 0, ...rest } = {}) {
  const c = fakeCtx({ moduleId: "contacts", key: `contacts-k2-${++n}`, locale, messages: readJson(`locales/${locale}.json`), serviceInstances: { "privacy.subject": subjects }, services, ...rest });
  c.api.store = store;
  c.can = (r) => rights.includes(r);
  c.__contactsTest = test;
  return Object.assign(c, { __offset: offset });
}
/** Décale la suite d'identifiants d'un stockage neuf (documents sans importance dans une autre collection). */
export async function shiftIds(ctx, count = 100) { for (let i = 0; i < count; i++) await ctx.api.store.add("padding", { i }); }

/** Enchaîne les pas jusqu'à la fin de la phase. Rend le document final de l'import et le nombre de pas. */
export async function drain(ctx, mode, { budgetMs = 8000, max = 100_000 } = {}) {
  const goal = mode === "run" ? "done" : "previewed";
  let r, steps = 0;
  for (; steps < max; steps++) {
    r = await I.step(ctx, mode, { budgetMs });
    if (!r.ok) throw new Error(`step ${mode}: ${r.error}`);
    if (r.job.data.state === goal) return { job: r.job, steps: steps + 1 };
  }
  throw new Error("import jamais terminé");
}
/** Importe un texte de bout en bout (lecture, aperçu, import). */
export async function importAll(ctx, text, opts) {
  const s = await I.stage(ctx, text, { locale: ctx.locale });
  if (!s.ok) return { stage: s };
  const preview = (await drain(ctx, "preview", opts)).job.data.counts;
  const run = (await drain(ctx, "run", opts)).job;
  return { stage: s, preview: { ...preview }, counts: { ...run.data.counts }, job: run };
}
export async function collect(gen) { const out = []; for await (const c of gen) out.push(c); return out; }
export const exportText = async (ctx) => (await collect(def.adminDownloads.contacts.generate(ctx))).join("");
export const htmlOf = (blocks) => blocks.map((b) => b.html ?? "").join("\n");
export const textOf = (blocks) => JSON.stringify(blocks);
export const allCards = async (ctx) => { const out = []; let cursor; do { const r = await svc.list(ctx, { limit: 500, cursor }); out.push(...r.items); cursor = r.next; } while (cursor); return out; };
/** Le texte d'un panneau, entités HTML décodées (apostrophes, esperluettes) : pour chercher une phrase telle qu'on la lit. */
export const plain = (blocks) => JSON.stringify(blocks).replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
