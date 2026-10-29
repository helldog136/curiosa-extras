// Commandes — outils communs : constantes, nettoyage des textes, liens de suivi (longs, non devinables), limites de débit en mémoire.
// Aucune donnée ici : ce fichier ne touche ni au stockage ni au réseau.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const STATUSES = ["new", "accepted", "in_progress", "delivered", "refused", "cancelled"];
/** Les commandes qui occupent une place dans la file. */
export const ACTIVE = ["accepted", "in_progress"];
/** Les commandes terminées (plus rien à faire) : seules celles-ci sont effacées avec le temps. */
export const FINISHED = ["delivered", "refused", "cancelled"];
export const MODES = ["open", "full", "closed"];
/** Étape suivante proposée d'office dans le formulaire de changement d'état. */
export const NEXT = { new: "accepted", accepted: "in_progress", in_progress: "delivered" };

/** Bornes dures (documentées dans docs/ideas/commissions.md). */
export const LIMITS = {
  orders: 1000,          // commandes gardées en tout (les terminées s'effacent avec le temps)
  formulas: 12,
  nick: 40, email: 200, want: 1500, inspiration: 300, note: 2000, clientNote: 400, message: 300,
  formulaName: 60, formulaPrice: 40, formulaDelay: 60, formulaIncludes: 400,
  history: 30, page: 50, slots: 99,
  wantLinks: 2,          // au plus deux adresses dans la description d'une demande (anti-spam)
  mailsPerAddressPerDay: 4, requestsPerAddressPerDay: 3, ownerMailEveryMs: 3_600_000,
  globalPerHour: 60,     // demandes acceptées en une heure, toutes personnes confondues (même si l'adresse de la personne qui visite est falsifiée)
  purgeBatch: 200,
};

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Texte de visiteur : normalisé, sans caractères de contrôle ni de sens de lecture forcé, borné. */
export function clean(v, max, multiline = false) {
  let t = String(v ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "");
  t = multiline ? t.replace(/\n{3,}/g, "\n\n") : t.replace(/\s+/g, " ");
  return t.trim().slice(0, max);
}
export const num = (v, def, min, max) => { const n = Number(v); return v === undefined || v === null || v === "" || !Number.isFinite(n) ? def : Math.min(max, Math.max(min, Math.trunc(n))); };
export const idOk = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(v);
export const validEmail = (v) => typeof v === "string" && v.length <= LIMITS.email && /^[^@\s,;<>"']+@[^@\s,;<>"']+\.[^@\s,;<>"']+$/.test(v);
export const isoOk = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
/** Une date « AAAA-MM-JJ » réelle, sinon vide. */
export const dayOk = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v) ? v : "");

/** Adresse web http(s) d'un visiteur : normalisée, sans identifiant ni mot de passe, bornée ; sinon null. */
export function httpUrl(v, max = LIMITS.inspiration) {
  const s = clean(v, max + 50);
  if (!s || s.length > max || /\s/.test(s)) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password || !u.hostname.includes(".")) return null;
    return u.href.length <= max ? u.href : null;
  } catch { return null; }
}
export const countLinks = (text) => (String(text ?? "").match(/https?:\/\/|www\./gi) ?? []).length;

/** Date lisible dans la langue du visiteur (« 12 mars 2027 »). */
export function fmtDay(locale, iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  try { return new Date(t).toLocaleDateString(locale || "en", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); } catch { return String(iso).slice(0, 10); }
}

// ── Liens de suivi ───────────────────────────────────────────────────────────────────────────────────────────────
// 160 bits au hasard (32 lettres a–z, 2–7 : minuscules, car l'adresse d'une page est lue en minuscules). Le site ne garde que l'EMPREINTE (SHA-256) :
// une copie de la base ou de la sauvegarde ne donne aucun lien de suivi. Le lien lui-même n'est montré qu'à la cliente (et envoyé par e-mail si possible).
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
export function newToken() {
  const bytes = randomBytes(20);
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    value &= (1 << bits) - 1;
  }
  return out;
}
export const isToken = (s) => typeof s === "string" && /^[a-z2-7]{32}$/.test(s);
export const hashToken = (token) => createHash("sha256").update(`commissions:${token}`).digest("hex");
export const isHash = (s) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
/** Comparaison à temps constant de deux empreintes (jamais `===` sur un secret). */
export function sameHash(a, b) {
  if (!isHash(a) || !isHash(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
/** Clé de recherche d'une commande par son lien (index du stockage : pas de parcours). */
export const tokenKey = (hash) => `t:${hash}`;

// ── Visiteurs : jamais d'adresse IP en clair, même en mémoire ───────────────────────────────────────────────────
const SALT = randomBytes(12).toString("hex");
const ipOf = (request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
/** Empreinte courte et salée (le sel change à chaque démarrage) : sert seulement à compter les envois d'un même visiteur. */
export const visitorOf = (request) => createHash("sha256").update(`${SALT}|${ipOf(request)}`).digest("hex").slice(0, 16);
export const addressKey = (email) => createHash("sha256").update(`${SALT}|@${String(email).toLowerCase()}`).digest("hex").slice(0, 16);

const memory = new Map();   // seau → dates des envois récents. Un garde-fou, pas un pare-feu : vidé au redémarrage.
export function limited(bucket, max, windowMs, now = Date.now()) {
  const recent = (memory.get(bucket) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  memory.set(bucket, recent);
  if (memory.size > 5000) for (const [k, v] of memory) if (!v.some((t) => now - t < DAY)) memory.delete(k);
  return recent.length > max;
}
/** Compte sans punir : « puis-je encore ? » (ne note rien). */
export function peek(bucket, max, windowMs, now = Date.now()) {
  return (memory.get(bucket) ?? []).filter((t) => now - t < windowMs).length >= max;
}
export function forgetInstance(key) { for (const k of [...memory.keys()]) if (k.split("|")[1] === key) memory.delete(k); }

/** Chemin public d'une page de l'instance (« /commandes », ou « » à la racine), préfixé par la langue si ce n'est pas celle par défaut. */
export function pathPrefix(ctx, lang) {
  const base = ctx.instance.basePath;
  const root = base ? `/${base}` : "";
  const l = typeof lang === "string" && lang && lang !== ctx.defaultLocale && (ctx.locales ?? []).includes(lang) ? `/${lang}` : "";
  return `${l}${root}`;
}
