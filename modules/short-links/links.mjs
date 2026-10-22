// Créer, modifier et supprimer un lien court : les mêmes règles pour l'administration et pour l'assistant IA.
import { MAX_LINKS, addLink, allLinks, linkById, linkCount, removeStats, updateLink } from "./data.mjs";
import { dropPending, forgetLink } from "./clicks.mjs";
import { encodeQr } from "./qr.mjs";
import { endOfDay, freeSlug, normalizeSlug, parseDestination, slugProblem, suggestSlug, today, validDay } from "./url.mjs";

/** Texte d'une ligne : sans retours à la ligne, sans caractères de contrôle, borné. */
export function cleanText(value, max) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Début de l'adresse courte choisie dans les réglages avancés (« https://monsite.be/go/ »), ou null. */
export function publicBase(ctx) {
  const raw = String(ctx.setting("publicBase") ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || u.hash) return null;
    const href = u.href;
    return href.endsWith("/") || href.endsWith("=") ? href : `${href}/`;
  } catch {
    return null;
  }
}

/** L'adresse courte d'un lien : celle qu'on imprime, celle que le QR code contient. */
export function shortUrl(ctx, slug) {
  const base = publicBase(ctx);
  return base ? `${base}${slug}` : `${ctx.api.siteUrl}/m/${ctx.instance.key}/go?c=${slug}`;
}

/** Le site connaît-il sa vraie adresse ? Sans elle, les QR codes pointeraient vers un ordinateur local. */
export function siteUrlLooksLocal(ctx) {
  try {
    const u = new URL(publicBase(ctx) ?? ctx.api.siteUrl);
    return u.hostname === "localhost" || u.hostname.endsWith(".localhost") || /^(?:127\.|10\.|192\.168\.|0\.0\.0\.0)/.test(u.hostname) || u.hostname === "[::1]";
  } catch {
    return true;
  }
}

/** Le QR code d'un lien, au niveau choisi (ou au plus solide que l'adresse permet). Rend null si l'adresse est trop longue pour tout niveau. */
export function qrFor(ctx, slug) {
  const wanted = ["L", "M", "Q"].includes(ctx.setting("qrLevel")) ? ctx.setting("qrLevel") : "M";
  const order = wanted === "Q" ? ["Q", "M", "L"] : wanted === "M" ? ["M", "L"] : ["L"];
  const text = shortUrl(ctx, slug);
  for (const level of order) {
    try {
      return { qr: encodeQr(text, { level }), level, text };
    } catch {
      /* trop long pour ce niveau : on essaie un niveau plus léger */
    }
  }
  return null;
}

/** Un lien est-il terminé ? (Valable toute la journée indiquée, heure du serveur en temps universel.) */
export const isEnded = (link, now = Date.now()) => Boolean(link.expires) && now > endOfDay(link.expires);

/** Chemins déjà pris par le site : pages des autres modules, langues, page de ce module. */
async function takenPaths(ctx) {
  const out = [...(ctx.locales ?? [])];
  if (ctx.instance.basePath) out.push(ctx.instance.basePath);
  try {
    for (const i of await ctx.api.instances.list()) if (i.basePath) out.push(String(i.basePath).split("/")[0]);
  } catch {
    /* la liste des pages n'est pas lue : les mots réservés du site suffisent */
  }
  return out;
}

function checkDate(raw, { previous = "" } = {}) {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: true, value: "" };
  if (!validDay(value)) return { ok: false, code: "date" };
  if (value === previous) return { ok: true, value };
  if (value < today()) return { ok: false, code: "past" };
  if (value > "2100-12-31") return { ok: false, code: "date" };
  return { ok: true, value };
}

/**
 * Crée un lien.
 * @param {object} ctx
 * @param {{ url?: string, slug?: string, title?: string, expires?: string }} input
 * @returns {Promise<{ ok: true, link: object, slug: string, suggested: boolean } | { ok: false, codes: Record<string, string>, suggestion?: string }>}
 *   `codes` : champ → code d'erreur (`url`, `slug`, `title`, `expires`, ou `form` pour ce qui ne concerne aucun champ)
 */
export async function createLink(ctx, input) {
  const codes = {};
  if ((await linkCount(ctx)) >= MAX_LINKS) return { ok: false, codes: { form: "full" } };

  const dest = parseDestination(input.url, { siteUrl: ctx.api.siteUrl });
  if (!dest.ok) codes.url = dest.code;
  const title = cleanText(input.title, 80);
  const date = checkDate(input.expires);
  if (!date.ok) codes.expires = date.code;

  const existing = new Set((await allLinks(ctx)).map((l) => l.slug));
  const reserved = await takenPaths(ctx);
  let slug = "";
  let suggested = false;
  let suggestion;
  const typed = String(input.slug ?? "").trim();
  if (typed) {
    slug = normalizeSlug(typed);
    const problem = slug ? slugProblem(slug, reserved) : "chars"; // rien d'utilisable après nettoyage (« ??? »)
    if (problem) {
      codes.slug = problem;
      suggestion = dest.ok ? freeSlug(suggestSlug({ title, url: dest.url }), (n) => existing.has(n) || Boolean(slugProblem(n, reserved))) : undefined;
    } else if (existing.has(slug)) {
      codes.slug = "taken";
      suggestion = freeSlug(slug, (n) => existing.has(n) || Boolean(slugProblem(n, reserved)));
    }
  } else if (dest.ok) {
    slug = freeSlug(suggestSlug({ title, url: dest.url }), (n) => existing.has(n) || Boolean(slugProblem(n, reserved)));
    suggested = true;
  }
  if (Object.keys(codes).length) return { ok: false, codes, suggestion };

  const added = await addLink(ctx, { slug, url: dest.url, title, expires: date.value });
  if (!added.ok) return { ok: false, codes: { slug: "taken" }, suggestion: freeSlug(slug, (n) => existing.has(n) || n === slug) };
  forgetLink(ctx, slug);
  return { ok: true, link: await linkById(ctx, added.id), slug, suggested };
}

/** Change la destination, la note ou la date de fin d'un lien. Le nom court ne change jamais. */
export async function editLink(ctx, id, input) {
  const link = await linkById(ctx, id);
  if (!link) return { ok: false, codes: { form: "gone" } };
  const codes = {};
  const dest = parseDestination(input.url, { siteUrl: ctx.api.siteUrl });
  if (!dest.ok) codes.url = dest.code;
  const date = checkDate(input.expires, { previous: link.expires });
  if (!date.ok) codes.expires = date.code;
  if (Object.keys(codes).length) return { ok: false, codes };
  const updated = await updateLink(ctx, id, { url: dest.url, title: cleanText(input.title, 80), expires: date.value });
  forgetLink(ctx, link.slug);
  return updated ? { ok: true, link: updated } : { ok: false, codes: { form: "gone" } };
}

/** Supprime un lien et ses chiffres. Les QR codes déjà imprimés mèneront à la page « lien introuvable ». */
export async function deleteLink(ctx, id) {
  const link = await linkById(ctx, id);
  if (!link) return { ok: false };
  forgetLink(ctx, link.slug);
  await ctx.api.store.remove(link.id);
  await dropPending(ctx, link.id);
  await removeStats(ctx, link.id);
  return { ok: true, link };
}

