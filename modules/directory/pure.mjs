// Annuaire — les petites fonctions sans effet de bord : nettoyage de texte, recherche sans accents, adresses stables, photos permises, curseurs, tri, CSV.
// Rien ici ne parle à Contacts ni au stockage : tout est testable seul.
import { createHash } from "node:crypto";

/** Bornes du module (documentées dans le README et dans docs/ideas/directory.md). */
export const LIMITS = {
  cats: 40,            // catégories publiques par annuaire
  team: 60,            // personnes dans l'équipe
  profiles: 5000,      // fiches publiques (présentation, ville, « masquer ici ») gardées par annuaire
  indexMax: 10000,     // personnes gardées en mémoire par annuaire (au-delà : « truncated »)
  perCategory: 5000,   // fiches lues par catégorie (10 lectures de 500 chez Contacts)
  readPage: 500,       // fiches par lecture de Contacts
  perPageDefault: 24,  // cartes par page à l'écran
  perPageMax: 50,
  csvMax: 5000,        // lignes du fichier CSV
  printMax: 500,       // lignes de la version imprimable
  bio: 280,            // présentation courte, par langue
  role: 80,            // titre dans l'équipe, par langue
  city: 80,
  label: 60,           // libellé public d'une catégorie, par langue
  q: 80,               // texte cherché
  same: 6,             // « autres personnes de la même catégorie »
  adminPage: 25,       // lignes par page dans l'administration
  search: 10,          // résultats de la recherche d'une personne (administration)
  links: 8,            // liens vers des comptes par personne
  id: 80,              // longueur d'un identifiant de fiche
  models: 6,           // annuaires gardés en mémoire en même temps
};

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Texte d'une personne ou de Contacts → une ligne propre (sans caractères de contrôle ni de direction), coupée. */
export function clean(v, max, multiline = false) {
  let t = String(v ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "");
  t = multiline ? t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n") : t.replace(/\s+/g, " ");
  return [...t.trim()].slice(0, max).join("");
}

/** Clé de recherche : sans casse, sans accents, espaces réduits (« Hélène  MARTIN » = « helene martin »). */
export const fold = (v) => String(v ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

export const idOk = (v) => typeof v === "string" && v.length > 0 && v.length <= LIMITS.id;
export const int = (v, def, min, max) => { const n = Number(v); return v === undefined || v === null || v === "" || !Number.isFinite(n) ? def : Math.min(max, Math.max(min, Math.trunc(n))); };
export const bool = (v, def) => (v === undefined || v === null || v === "" ? def : !(v === false || v === "false" || v === 0 || v === "0" || v === "off"));

/** Les textes par langue ({ fr: "…", en: "…" }) : seulement des chaînes, 12 langues au plus, nettoyées et coupées. */
export function textsOf(raw, max, multiline = false) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [l, v] of Object.entries(raw).slice(0, 12)) if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(l) && typeof v === "string") { const t = clean(v, max, multiline); if (t) out[l] = t; }
  return out;
}

/** Le texte pour une langue : la sienne, sinon celle du site, sinon la première non vide. */
export function pickText(texts, locale, defaultLocale) {
  if (!texts || typeof texts !== "object") return "";
  for (const l of [locale, defaultLocale]) if (typeof texts[l] === "string" && texts[l].trim()) return texts[l];
  for (const v of Object.values(texts)) if (typeof v === "string" && v.trim()) return v;
  return "";
}

/* ───────────── Noms, initiales ───────────── */

export const NAME_STYLES = ["card", "first", "nickname"];
export const SORTS = ["az", "new", "mix"];

export const firstWord = (name) => clean(name, 120).split(" ")[0] ?? "";

/** Les initiales du nom montré (jusqu'à deux lettres), pour le rond sans photo. */
export function initials(name) {
  const words = clean(name, 120).replace(/^[@#]+/, "").split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0] ?? ""];
  return letters.map((w) => [...w][0] ?? "").join("").toLocaleUpperCase() || "♥";
}

/** Le nom à montrer pour une fiche réduite { name, first, nick, kind } : « card » = le nom de la fiche ; « first » = son premier mot (une organisation garde son nom) ; « nickname » = le nom affiché de son compte. */
export function shownName(p, style) {
  const pick = style === "first" && p.kind !== "org" ? p.first : style === "nickname" ? p.nick : p.name;
  return clean(pick || p.name, 120) || "—";
}

/* ───────────── Adresses stables ───────────── */

/** Un identifiant public court et stable pour une fiche (jamais l'identifiant de Contacts) : 10 caractères hexadécimaux. */
export const personHash = (id) => createHash("sha256").update(`directory|${id}`).digest("hex").slice(0, 10);

/** Un mot pour une adresse : minuscules, chiffres et tirets, sans accents. */
export function slugify(v, max = 40) {
  return fold(v).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
}
/** L'adresse d'une personne : son nom (pour lire le lien) puis son identifiant public (seul celui-ci compte). */
export const personSlug = (name, hash) => { const s = slugify(name, 36); return s ? `${s}-${hash}` : hash; };
/** Retrouve l'identifiant public dans une adresse de personne, ou null. */
export function hashOfSlug(slug) {
  const m = /(?:^|-)([0-9a-f]{10})$/.exec(String(slug ?? ""));
  return m ? m[1] : null;
}
export const slugOk = (s) => typeof s === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length <= 40;

/* ───────────── Les photos permises ───────────── */

// Une photo de Contacts est chargée DIRECTEMENT par le navigateur du visiteur (le cœur ne laisse pas un module relayer des images). Pour ne pas envoyer vos
// visiteurs vers n'importe quel serveur : une photo choisie à la main (par vous, dans Contacts) est permise en https ou sur le site même ; une photo venue d'un
// réseau n'est permise que depuis la liste des serveurs d'images connus de Twitch, YouTube et Bluesky. Sinon : les initiales.
const GOOGLE_PHOTO = /^\/(?:(?:ytc|a)\/)?[A-Za-z0-9_-]{20,200}(?:=[A-Za-z0-9_-]{1,60})?$/;
export const PHOTO_HOSTS = {
  "static-cdn.jtvnw.net": /^\/(?:jtv_user_pictures|user-default-pictures-uv)\/[A-Za-z0-9_.\-/]{1,160}\.(?:png|jpe?g|webp)$/,
  "yt3.ggpht.com": GOOGLE_PHOTO,
  "yt3.googleusercontent.com": GOOGLE_PHOTO,
  "cdn.bsky.app": /^\/img\/avatar(?:_thumbnail)?\/plain\/did:plc:[a-z2-7]{24}\/[A-Za-z0-9]{8,120}@(?:jpeg|png|webp)$/,
};

/** { src, own } : l'adresse de la photo à montrer et si elle vit sur le site même (alors elle ne prévient aucun tiers) ; ou null. `photo` = `contact.photo` de Contacts. */
export function photoOf(photo) {
  const url = photo?.url;
  if (typeof url !== "string" || url.length > 500 || /[\u0000- \u007f\\"'<>`]/.test(url)) return null;
  if (photo.source === "manual") {
    if (/^\/(?!\/)[^?#]*$/.test(url) && !url.includes("..")) return { src: url, own: true };
    try { const u = new URL(url); return u.protocol === "https:" && !u.username && !u.password ? { src: u.href, own: false } : null; } catch { return null; }
  }
  let u;
  try { u = new URL(url); } catch { return null; }
  const rule = PHOTO_HOSTS[u.hostname];
  if (!rule || u.protocol !== "https:" || u.port || u.username || u.password || u.search || u.hash || u.pathname.includes("..") || u.pathname.includes("%") || !rule.test(u.pathname)) return null;
  return { src: u.href, own: false };
}

/* ───────────── Les comptes ───────────── */

export const NETWORKS = ["twitch", "youtube", "tiktok", "instagram", "discord", "x", "bluesky", "mastodon", "web", "other"];
export const NETWORK_NAMES = { twitch: "Twitch", youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", discord: "Discord", x: "X", bluesky: "Bluesky", mastodon: "Mastodon", web: "Web", other: "" };

/** Une adresse de compte permise : https, sans identifiant ni caractère étrange, 300 caractères au plus. */
export function linkUrl(v) {
  if (typeof v !== "string" || v.length > 300 || /[\u0000- \u007f\\"'<>`]/.test(v)) return null;
  try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".") ? u.href : null; } catch { return null; }
}

/** Les comptes d'une fiche de Contacts → [{ n: réseau, h: pseudo à lire, u: adresse }], 8 au plus. Jamais d'e-mail ni de téléphone. */
export function reduceLinks(accounts) {
  const out = [];
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (out.length >= LIMITS.links) break;
    if (!a || !NETWORKS.includes(a.network)) continue;
    const u = linkUrl(a.url);
    if (!u) continue;
    out.push({ n: a.network, h: clean(a.displayName || String(a.handle ?? "").replace(/^@/, ""), 60), u });
  }
  return out;
}

/* ───────────── Le tri, la recherche, les curseurs ───────────── */

/** Mélange stable : le même jour, le même ordre (utile pour parcourir plusieurs pages) ; un autre jour, un autre ordre. */
export const mixKey = (hash, day) => createHash("sha256").update(`${day}|${hash}`).digest("hex").slice(0, 8);
export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

/** Le texte cherché → des mots sans accents (6 au plus, 40 caractères chacun). */
export const tokens = (q) => fold(clean(q, LIMITS.q)).split(" ").filter(Boolean).slice(0, 6).map((t) => t.slice(0, 40));

/** Importance d'un résultat : 0 le nom commence par le premier mot, 1 un mot du nom commence par lui, 2 il est quelque part ; null = ne correspond pas. */
export function score(entry, toks) {
  if (!toks.length) return 0;
  for (const t of toks) if (!entry.key.includes(t)) return null;
  const name = entry.fname;
  if (name.startsWith(toks[0])) return 0;
  if (name.includes(` ${toks[0]}`)) return 1;
  return 2;
}

/** Un curseur est « rang.identifiant public » : le rang est un indice (rapide), l'identifiant le vérifie (sûr si la liste a changé). */
export const cursorOf = (pos, hash) => `${pos}.${hash}`;
export function readCursor(raw) {
  const m = /^(\d{1,6})\.([0-9a-f]{10})$/.exec(String(raw ?? ""));
  return m ? { pos: Number(m[1]), hash: m[2] } : null;
}

/** Le CSV d'une cellule : guillemets doublés, et une cellule qui commencerait par = + - @ ne devient jamais une formule de tableur. */
export function cell(v) {
  let t = String(v ?? "").replace(/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, " ");
  if (/^[=+\-@\t]/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
}

/** Un chemin du site (« /annuaire » ou « / »), sans double barre. */
export const sitePath = (basePath) => { const b = String(basePath ?? "").replace(/^\/+|\/+$/g, ""); return b ? `/${b}` : ""; };

/** Latitude et longitude arrondies à la ville (2 décimales), ou null si absurdes. */
export function roundGeo(lat, lng) {
  const num = (x) => (typeof x === "number" || (typeof x === "string" && x.trim() !== "") ? Number(x) : NaN);
  const a = num(lat), b = num(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: Math.round(a * 100) / 100, lng: Math.round(b * 100) / 100 };
}
