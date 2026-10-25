// Soutiens — les petites fonctions sans effet de bord : nettoyage de texte, bornes, pseudo accepté, jetons d'accord, états d'un soutien.
// Rien ici ne parle au réseau, à Contacts ni au stockage : tout est testable seul.
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/** Bornes du module (documentées dans le README et dans docs/ideas/supporters.md). */
export const LIMITS = {
  people: 5000,         // soutiens gardés au total
  tiers: 60,            // paliers gardés
  name: 120,            // nom donné par la plateforme (gardé seulement avant le rangement dans Contacts)
  pseudo: 40,           // longueur d'un pseudo montré
  pseudoMin: 2,
  label: 40,            // libellé public d'un palier
  tierName: 80,         // nom d'un palier chez la plateforme
  tiersPerPerson: 6,
  adminPage: 25,        // lignes par page dans l'administration
  publicPage: 50,       // pseudos par page publique (au plus)
  publicPageDefault: 48,
  csvRows: 1000,        // lignes d'un fichier importé
  csvBytes: 300_000,    // taille d'un fichier importé
  kofiBytes: 20_000,    // corps d'une notification entrante
  seen: 300,            // identifiants de notification retenus (anti-doublon)
  pullPages: 10,        // pages demandées à la plateforme par actualisation
  pullPerPage: 200,
  pullMembers: 2000,    // membres lus par actualisation (au-delà : on le dit, et personne n'est déclaré « arrêté » à tort)
  pullMs: 25_000,       // temps total d'une actualisation
  fileBatch: 100,       // fiches rangées dans Contacts par clic
  id: 80,
};

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Texte venu d'ailleurs → une ligne propre (sans caractères de contrôle ni de direction), coupée. */
export function clean(v, max, multiline = false) {
  let t = String(v ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200b-\u200f\ufeff]/g, "");
  t = multiline ? t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n") : t.replace(/\s+/g, " ");
  return [...t.trim()].slice(0, max).join("");
}

/** Clé de comparaison : sans casse, sans accents, espaces réduits. */
export const fold = (v) => String(v ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

export const idOk = (v) => typeof v === "string" && v.length > 0 && v.length <= LIMITS.id;
export const pidOk = (v) => typeof v === "string" && /^[a-f0-9]{12}$/.test(v);
export const int = (v, def, min, max) => { const n = Number(v); return v === undefined || v === null || v === "" || !Number.isFinite(n) ? def : Math.min(max, Math.max(min, Math.trunc(n))); };
export const flag = (v, def) => (v === undefined || v === null || v === "" ? def : !(v === false || v === "false" || v === 0 || v === "0" || v === "off"));

/* ───────────── Les dates (jour seulement : on ne garde jamais l'heure d'un don) ───────────── */

export const DAY_MS = 86_400_000;
/** Une date quelconque → « 2026-03-01 » (UTC), ou null. */
export function dayOf(v) {
  if (v === undefined || v === null || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(String(v));
  if (!Number.isFinite(t) || t < Date.UTC(2000, 0, 1) || t > Date.UTC(2100, 0, 1)) return null;
  return new Date(t).toISOString().slice(0, 10);
}
export const daysSince = (day, now = Date.now()) => (day ? Math.floor((now - Date.parse(`${day}T00:00:00Z`)) / DAY_MS) : Infinity);

/* ───────────── Le pseudo que la personne accepte de montrer ───────────── */

/**
 * Un pseudo proposé par une personne. Rend { ok: true, value } ou { ok: false, error } avec error ∈ "short" · "long" · "link" · "email" · "chars".
 * Pas d'adresse ni de lien (ce serait de la publicité ou une fuite), pas de signes de balisage.
 */
export function checkPseudo(raw) {
  const value = clean(raw, LIMITS.pseudo + 1);
  const len = [...value].length;
  if (len < LIMITS.pseudoMin) return { ok: false, error: "short" };
  if (len > LIMITS.pseudo) return { ok: false, error: "long" };
  if (/@[^\s@]+\.[^\s@]+/.test(value)) return { ok: false, error: "email" };
  if (/(https?:|www\.|\w\.(com|net|org|be|fr|io|tv|gg|me)\b)/i.test(value)) return { ok: false, error: "link" };
  if (/[<>{}\[\]\\|`]/.test(value) || !/[\p{L}\p{N}]/u.test(value)) return { ok: false, error: "chars" };
  return { ok: true, value };
}

/* ───────────── Les jetons : jamais stockés, recalculés ───────────── */

/** HMAC d'un texte avec le secret de l'instance, en hexadécimal. */
export const hmacHex = (secret, data) => createHmac("sha256", String(secret)).update(String(data)).digest("hex");
/** Le jeton du lien personnel d'une personne : change quand `gen` change (l'ancien lien cesse de marcher). 32 caractères hexadécimaux, donc sans majuscule (les chemins sont en minuscules). */
export const consentToken = (secret, pid, gen) => hmacHex(secret, `consent|${pid}|${Number(gen) || 0}`).slice(0, 32);
/** Comparaison en temps constant de deux textes. */
export function sameSecret(a, b) {
  const x = createHash("sha256").update(String(a ?? "")).digest();
  const y = createHash("sha256").update(String(b ?? "")).digest();
  return timingSafeEqual(x, y);
}

/* ───────────── Un soutien : actif ? montré ? ───────────── */

/** Faut-il que le dernier signe de vie soit récent ? (une plateforme qui prévient à chaque don : oui ; une liste complète demandée à la plateforme ou un fichier : non) */
export function isActive(person, provider, activeDays, now = Date.now()) {
  if (!person || person.status !== "active") return false;
  if (!provider?.expires) return true;
  return daysSince(person.last, now) <= activeDays;
}

/** L'état de l'accord : "none" (rien demandé ou refus), "pending" (un pseudo attend la relecture), "approved". */
export function consentState(person) {
  if (!person?.consent?.pseudo) return "none";
  return person.approved === true ? "approved" : "pending";
}

/** Une personne est-elle montrable au public ? Il faut : un accord, un pseudo approuvé, pas caché, actif. */
export const isShown = (person, provider, activeDays, now = Date.now()) => consentState(person) === "approved" && person.hidden !== true && isActive(person, provider, activeDays, now);

/* ───────────── Les libellés de paliers ───────────── */

/** Le texte d'une langue, sinon de la langue par défaut, sinon n'importe lequel. */
export function pickText(texts, locale, defaultLocale) {
  if (!texts || typeof texts !== "object") return "";
  return clean(texts[locale] || texts[defaultLocale] || Object.values(texts).find((x) => typeof x === "string" && x) || "", 200);
}

/** Les textes par langue d'un objet : seulement des chaînes, 12 langues au plus, nettoyées et coupées. */
export function cleanTexts(raw, max) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [l, v] of Object.entries(raw).slice(0, 12)) if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(l) && typeof v === "string") { const t = clean(v, max); if (t) out[l] = t; }
  return out;
}

/** Un libellé a-t-il l'air d'un montant ? (jamais de chiffres suivis d'une monnaie, ni de symbole monétaire) */
export const looksLikeAmount = (s) => /[€$£¥]|\b\d+([.,]\d+)?\s?(eur|euros?|usd|dollars?|gbp|cad|chf)\b|\b(eur|usd|gbp)\s?\d/i.test(String(s ?? ""));

export function sortText(a, b, locale) {
  return String(a).localeCompare(String(b), locale || "en", { sensitivity: "base", numeric: true });
}
