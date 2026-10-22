// Témoignages — les petits outils sans effet de bord : nettoyage du texte, validation d'un avis, étoiles, tri, moyenne, CSV, limites de débit.
// Rien ici ne lit ni n'écrit le stockage (voir data.mjs) et rien ne fabrique de page (voir view.mjs).
import { createHash, randomBytes } from "node:crypto";

export const COLLECTION = "reviews";
export const DRAFTS = "drafts";                  // brouillons d'un formulaire à corriger : gardés 30 minutes, jamais plus
export const MAX_STORED = 1000;                  // avis gardés au total (en attente, publiés, refusés)
export const MAX_PENDING = 200;                  // avis en attente au plus : au-delà, on dit gentiment de revenir plus tard
export const MAX_PUBLISHED = 500;                // avis publiés au plus
export const MAX_DRAFTS = 100;
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const DRAFT_TTL = 30 * 60_000;
export const REFUSED_KEEP_DAYS = 30;             // un avis refusé est effacé tout seul au bout de 30 jours
export const MIN_AVERAGE = 3;                    // moyenne affichée à partir de 3 notes (une seule note ne dit rien)
export const MIN_MARKUP = 5;                     // données pour les moteurs de recherche : au moins 5 notes réelles
export const MIN_SCROLL = 4;                     // défilement lent : au moins 4 avis, sinon une grille
export const MIN_FILTER = 6;                     // filtre par étoiles : à partir de 6 notes
export const ADMIN_PER_PAGE = 50;
export const FIELD_MAX = { name: 40, text: 2000, email: 120, photo: 300 };
export const STATUSES = ["pending", "approved", "rejected"];

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Nettoie un texte venu d'un formulaire : sans caractères de contrôle ni de changement de sens de lecture, borné. */
export function clean(value, max, multiline = false) {
  let text = String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "");
  text = multiline ? text.replace(/\n{3,}/g, "\n\n") : text.replace(/\s+/g, " ");
  return text.trim().slice(0, max);
}

/** Entier borné ; un réglage peut arriver vide ou en texte. */
export function num(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
}

/** Une image n'est reprise que si c'est un fichier du site ou une adresse https (jamais javascript: ni data:). */
export function safeSrc(value) {
  const v = String(value ?? "").trim();
  if (!v || /[\s"'<>\\]/.test(v)) return null;
  return (v.startsWith("/") && !v.startsWith("//")) || /^https:\/\/[^/]/.test(v) ? v.slice(0, FIELD_MAX.photo) : null;
}

export const isRating = (n) => Number.isInteger(n) && n >= 1 && n <= 5;
export const isEmail = (s) => s.length <= FIELD_MAX.email && /^[^@\s<>"',;:]+@[^@\s<>"',;:]+\.[^@\s<>"',;:]{2,}$/.test(s);
export const countLinks = (s) => (String(s).match(/https?:\/\/|www\./gi) ?? []).length;

/** Date lisible, en UTC pour un rendu identique d'un serveur à l'autre. */
export function day(date, locale) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  try { return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(d); } catch { return d.toISOString().slice(0, 10); }
}
export const isoDay = (date) => { const d = new Date(date); return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10); };
const ms = (v) => { const t = Date.parse(String(v ?? "")); return Number.isFinite(t) ? t : 0; };

/** Les réglages, relus en types sûrs (un réglage arrive vide, en texte ou hors limites). */
export function config(ctx) {
  const pick = (key, allowed, fallback) => (allowed.includes(ctx.setting(key)) ? ctx.setting(key) : fallback);
  return {
    askEmail: ctx.setting("askEmail") === true,
    ratingMode: pick("ratingMode", ["optional", "required", "none"], "optional"),
    order: pick("order", ["favorites", "newest", "best", "manual"], "favorites"),
    display: pick("display", ["grid", "slow"], "grid"),
    showAverage: ctx.setting("showAverage") !== false,
    notify: ctx.setting("notify") !== false,
    maxLength: num(ctx.setting("maxLength"), 600, 100, FIELD_MAX.text),
    perPage: num(ctx.setting("perPage"), 12, 3, 48),
    emailDays: num(ctx.setting("emailDays"), 90, 7, 730),
    rateLimit: num(ctx.setting("rateLimit"), 3, 1, 50),
  };
}

// ── Un avis tel que le module le garde ──────────────────────────────────────────────────────────────────────────
/**
 * Relit un document du stockage en types sûrs (un document ancien, restauré ou abîmé ne fait jamais planter une page).
 * `status` : tout ce qui n'est pas explicitement « approved » ou « rejected » reste en attente.
 */
export function normalize(row) {
  const d = row?.data ?? {};
  const consent = d.consent && typeof d.consent === "object" ? d.consent : null;
  const email = typeof d.email === "string" && d.email ? d.email.slice(0, FIELD_MAX.email) : null;
  return {
    id: String(row?.id ?? ""),
    at: row?.createdAt instanceof Date ? row.createdAt.getTime() : ms(d.submittedAt) || ms(row?.createdAt),
    status: d.status === "approved" ? "approved" : d.status === "rejected" ? "rejected" : "pending",
    name: clean(d.name, FIELD_MAX.name),
    text: clean(d.text, FIELD_MAX.text, true),
    rating: isRating(d.rating) ? d.rating : null,
    featured: d.featured === true,
    position: Number.isInteger(d.position) && d.position >= 1 && d.position <= 9999 ? d.position : null,
    photo: safeSrc(d.photo),
    email,
    emailUntil: ms(d.emailUntil),
    consentAt: consent ? ms(consent.at) : 0,
    consentText: consent ? clean(consent.text, 400) : "",
    consentBy: consent?.by === "owner" ? "owner" : "visitor",
    consentLocale: consent ? clean(consent.locale, 12) : "",
    tokenHash: typeof d.tokenHash === "string" && /^[0-9a-f]{64}$/.test(d.tokenHash) ? d.tokenHash : "",
    decidedAt: ms(d.decidedAt),
    publishedAt: ms(d.publishedAt),
    editedAt: ms(d.editedAt),
  };
}

/** Ce que voit le public : validé ET accord de l'auteur enregistré. Sans accord, rien n'est jamais montré. */
export const isPublic = (r) => r.status === "approved" && r.consentAt > 0 && r.name !== "" && r.text !== "";

/** Le document à ranger (l'inverse de normalize, sans rien inventer). */
export function toDoc(r, extra = {}) {
  const iso = (t) => (t > 0 ? new Date(t).toISOString() : null);
  return {
    status: r.status, name: r.name, text: r.text, rating: r.rating, featured: r.featured, position: r.position, photo: r.photo,
    email: r.email, emailUntil: iso(r.emailUntil),
    consent: r.consentAt > 0 ? { text: r.consentText, at: iso(r.consentAt), locale: r.consentLocale, by: r.consentBy } : null,
    tokenHash: r.tokenHash, decidedAt: iso(r.decidedAt), publishedAt: iso(r.publishedAt), editedAt: iso(r.editedAt),
    submittedAt: iso(r.at),
    ...extra,
  };
}

// ── Validation d'un avis envoyé par un visiteur ─────────────────────────────────────────────────────────────────
/**
 * `get(nom)` lit un champ du formulaire. Renvoie `values` (nettoyées et bornées) et `errors` : { champ: code } ; le code devient une phrase
 * (avec un exemple) dans les textes du module. Les valeurs servent aussi à remplir de nouveau le formulaire quand il y a une erreur.
 */
export function validateReview(get, cfg) {
  const values = {
    name: clean(get("name"), FIELD_MAX.name),
    text: clean(get("text"), FIELD_MAX.text, true),
    rating: null,
    email: cfg.askEmail ? clean(get("email"), FIELD_MAX.email) : "",
    consent: String(get("consent") ?? "") === "yes",
  };
  const errors = {};
  if (!values.name) errors.name = "name";
  if (values.text.length < 10) errors.text = "textShort";
  else if (values.text.length > cfg.maxLength) errors.text = "textLong";
  else if (countLinks(values.text) > 1) errors.text = "links";
  if (cfg.ratingMode !== "none") {
    const raw = String(get("rating") ?? "").trim();
    if (raw === "") { if (cfg.ratingMode === "required") errors.rating = "rating"; }
    else if (/^[1-5]$/.test(raw)) values.rating = Number(raw);
    else errors.rating = "rating";
  }
  if (values.email && !isEmail(values.email)) errors.email = "email";
  if (!values.consent) errors.consent = "consent";
  return { values, errors };
}

// ── Jeton de retrait : le lien privé que garde l'auteur ──────────────────────────────────────────────────────────
export const newToken = () => randomBytes(16).toString("hex");
export const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");
export const newRef = () => randomBytes(12).toString("hex");

/** Comparaison sans court-circuit. */
export function same(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// ── Tri, moyenne, répartition ───────────────────────────────────────────────────────────────────────────────────
const byNewest = (a, b) => (b.publishedAt || b.at) - (a.publishedAt || a.at) || b.id.localeCompare(a.id);
/** `order` : « favorites » (coups de cœur d'abord, puis les plus récents) · « newest » · « best » (mieux notés d'abord) · « manual » (le numéro choisi par vous). */
export function orderReviews(list, order) {
  const sorters = {
    newest: byNewest,
    favorites: (a, b) => Number(b.featured) - Number(a.featured) || byNewest(a, b),
    best: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || Number(b.featured) - Number(a.featured) || byNewest(a, b),
    manual: (a, b) => (a.position ?? 10_000) - (b.position ?? 10_000) || byNewest(a, b),
  };
  return [...list].sort(sorters[order] ?? sorters.favorites);
}

/** Moyenne et répartition des SEULES notes données (un avis sans étoiles ne compte pas dans la moyenne). */
export function summarize(list) {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0, rated = 0;
  for (const r of list) if (r.rating) { distribution[r.rating]++; sum += r.rating; rated++; }
  return { total: list.length, rated, average: rated ? sum / rated : null, distribution };
}
export function formatAverage(value, locale) {
  try { return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value); } catch { return value.toFixed(1); }
}

// ── CSV ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Une cellule : toujours entre guillemets ; un « = », « + », « - », « @ » initial est neutralisé (un tableur le lirait comme une formule). */
export function cell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export const csvLine = (cells, sep) => `${cells.map(cell).join(sep)}\r\n`;
/** Un tableur français attend le point-virgule, un tableur anglais la virgule. */
export const csvSeparator = (locale) => (String(locale ?? "").toLowerCase().startsWith("fr") ? ";" : ",");

// ── Limites de débit, en mémoire ────────────────────────────────────────────────────────────────────────────────
// Un garde-fou, pas un pare-feu : remis à zéro au redémarrage. Le visiteur n'est jamais gardé en clair : une empreinte mélangée à un sel tiré au hasard.
const SALT = randomBytes(16).toString("hex");
const memory = new Map();

/** Qui est le visiteur ? Le DERNIER nom de l'en-tête (celui qu'ajoute le serveur devant le site) ; le début peut être inventé. */
export function visitorKey(request) {
  const last = String(request.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean).pop() ?? "local";
  return createHash("sha256").update(`${SALT}|${last.slice(0, 64)}`).digest("hex").slice(0, 20);
}
const recent = (bucket, windowMs, now) => (memory.get(bucket) ?? []).filter((t) => now - t < windowMs);
/** Compte une tentative et dit si la limite est dépassée. */
export function hit(bucket, max, windowMs, now = Date.now()) {
  const list = recent(bucket, windowMs, now);
  list.push(now);
  memory.set(bucket, list);
  if (memory.size > 5000) for (const [k, v] of memory) if (!v.some((t) => now - t < DAY)) memory.delete(k);
  return list.length > max;
}
/** Le seuil est-il déjà atteint ? (sans compter) */
export const full = (bucket, max, windowMs, now = Date.now()) => recent(bucket, windowMs, now).length >= max;
export function note(bucket, now = Date.now()) { const list = memory.get(bucket) ?? []; list.push(now); memory.set(bucket, list); }
export function forgetInstance(key) { for (const k of [...memory.keys()]) if (k.split("|")[0] === key) memory.delete(k); }

// ── Données pour les moteurs de recherche ───────────────────────────────────────────────────────────────────────
/** Du JSON sûr à poser dans une balise <script type="application/ld+json"> : rien ne peut en fermer la balise. */
export const ldJson = (data) => JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
