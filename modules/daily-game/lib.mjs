// Jeu du jour — petits outils sans dépendance : texte, dates dans le fuseau du site, hasard déterministe, fichiers CSV.
// Rien ici ne touche au stockage ni au réseau (fonctions pures, testées une à une).
import { createHash } from "node:crypto";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Texte de visiteur ou de formulaire : sans caractères de contrôle, espaces réduits (retours à la ligne gardés si `multiline`), coupé à `max`. */
export function clean(value, max, multiline = false) {
  let s = String(value ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, " ");
  s = multiline ? s.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  return s.trim().slice(0, max);
}

export function num(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
}

/** Bornes dures du module (voir README : « Bornes »). */
export const LIMITS = {
  questions: 2000,   // questions dans la banque (brouillons compris)
  planned: 365,      // questions rattachées à une date précise, aujourd'hui ou plus tard
  text: 300,         // énoncé, explication
  choice: 120,       // une réponse
  alt: 150,          // description d'une image
  cat: 40,           // catégorie
  choices: 4,        // réponses au plus
  history: 400,      // jours de passage gardés
  board: 100,        // lignes du classement d'une semaine
  weeks: 4,          // semaines de classement gardées
  page: 50,          // lignes à l'écran dans l'administration
  aiDrafts: 50,      // brouillons de l'assistant en attente
  csvBytes: 1_000_000,
};

export const LEVELS = ["easy", "medium", "hard"];

// ── Dates : le « jour » est celui du fuseau du site, calculé ici (jamais l'horloge du visiteur) ───────────────────────

export function isValidTimeZone(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: String(tz) }); return typeof tz === "string" && tz.length > 0; } catch { return false; }
}

export const DEFAULT_TZ = "Europe/Paris";

/** « 2026-10-24 » : le jour civil de l'instant `ms` dans le fuseau `tz`. */
export function dayKey(ms, tz = DEFAULT_TZ) {
  const zone = isValidTimeZone(tz) ? tz : DEFAULT_TZ;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
}

/** Une vraie date « AAAA-MM-JJ » (le 30 février n'existe pas). */
export function isDay(key) {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const d = new Date(`${key}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === key;
}

export function addDays(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Semaine ISO (lundi au dimanche) : « 2026-W43 ». */
export function weekKey(key) {
  const d = new Date(`${key}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Début (lundi) de la semaine qui contient ce jour. */
export const weekStart = (key) => addDays(key, 1 - (new Date(`${key}T00:00:00Z`).getUTCDay() || 7));

/** Date lisible, dans la langue donnée. */
export function longDay(key, locale) {
  try { return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${key}T00:00:00Z`)); } catch { return key; }
}

export function shortDay(key, locale) {
  try { return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${key}T00:00:00Z`)); } catch { return key; }
}

// ── Hasard déterministe : la même graine et le même jour donnent toujours le même tirage ─────────────────────────────

export function hash32(text) {
  return createHash("sha256").update(String(text)).digest().readUInt32BE(0);
}

/** Un indice entre 0 et n-1, qui ne dépend que de la graine et du jour. */
export const seededIndex = (seed, day, n) => (n <= 1 ? 0 : hash32(`${seed}|${day}`) % n);

// ── Fichiers CSV ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Lit un CSV (virgule, point-virgule ou tabulation ; guillemets ; BOM). Rend { rows, delimiter, unclosed } ; les lignes vides sont écartées. */
export function parseCsv(input) {
  const text = String(input ?? "").replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch) => { let n = 0, q = false; for (const c of first) { if (c === '"') q = !q; else if (!q && c === ch) n++; } return n; };
  const delimiter = [",", ";", "\t"].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0];
  const sep = delimiter[1] > 0 ? delimiter[0] : ",";
  const rows = [];
  let row = [], cell = "", quoted = false, any = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"' && cell === "") { quoted = true; any = true; }
    else if (c === sep) { row.push(cell); cell = ""; any = true; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (any || row.some((x) => x !== "")) rows.push(row);
      row = []; any = false;
    } else { cell += c; any = true; }
  }
  row.push(cell);
  if (any || row.some((x) => x !== "")) rows.push(row);
  return { rows: rows.filter((r) => r.some((x) => String(x).trim() !== "")), delimiter: sep, unclosed: quoted };
}

/** Une cellule de CSV : entre guillemets, et jamais lue comme une formule par un tableur (« = + - @ » en tête). */
export function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** L'inverse de la protection ci-dessus, pour qu'un fichier exporté puis réimporté revienne identique. */
export const csvUnprotect = (s) => String(s ?? "").replace(/^'(?=[=+\-@\t\r])/, "");

/** Nom de colonne comparable : minuscules, sans accents ni ponctuation (« Bonne réponse » = « bonne_reponse »). */
export const columnKey = (name) => String(name ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Texte plié pour chercher (sans accents ni majuscules). */
export const fold = (s) => String(s ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Image du site seulement : un fichier envoyé (« /uploads/… »), jamais une adresse extérieure. */
export function safeImage(value) {
  const v = String(value ?? "").trim();
  return /^\/uploads\/[A-Za-z0-9._\-/]{1,150}$/.test(v) && !v.includes("..") ? v : "";
}

export const isId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(v);

/** Code de langue plausible (fr, en, pt-BR…). */
export const isLocale = (v) => typeof v === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(v);

export function languageName(code, inLocale) {
  try { return new Intl.DisplayNames([inLocale], { type: "language" }).of(code) || code; } catch { return code; }
}

export const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
