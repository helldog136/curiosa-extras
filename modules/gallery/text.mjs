// Galeries photos : petits outils de texte, sans état (nettoyage, échappement, adresses, dates, identifiants).
// Tout ce qui vient d'un visiteur, d'un assistant, d'un fichier envoyé ou d'une sauvegarde est traité comme non fiable :
// on nettoie à l'entrée, on échappe à la sortie.

/** Bornes DURES : aucun réglage ne les dépasse (les réglages les abaissent, jamais au-delà). */
export const HARD = {
  albums: 500,        // albums par instance
  photos: 300,        // photos par album
  photoBytes: 1_000_000, // octets d'une photo (après réduction)
  thumbBytes: 120_000,   // octets d'une miniature
  totalMB: 2000,      // espace total des photos envoyées
  side: 4096,         // plus grand côté d'une photo gardée (pixels)
  thumbSide: 640,     // plus grand côté d'une miniature
  pixels: 16_000_000, // pixels d'une photo
  requests: 200,      // demandes de retrait gardées
  title: 100,
  description: 1500,
  caption: 200,
  alt: 300,
  message: 1000,
  contact: 120,
  label: 160,
  name: 60,
};

/** Valeurs par défaut des bornes réglables (sûres pour un petit site ; voir les réglages avancés). */
export const DEFAULTS = { photoKB: 300, side: 1600, photos: 120, albums: 100, totalMB: 150, removalLimit: 3, retentionDays: 90 };

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Échappe un texte avant de le mettre dans du HTML (le bloc `html` du cœur est brut). */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]);

/** Nettoie un texte venu de l'extérieur : retire les caractères de contrôle (et ceux qui inversent le sens de lecture), borne la taille. */
export function clean(value, max, multiline = false) {
  let text = String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "");
  text = multiline ? text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n") : text.replace(/\s+/g, " ");
  return text.trim().slice(0, max);
}

/** Entier borné ; un réglage peut arriver vide ou sous forme de texte. */
export function num(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
}

/** Texte « plié » pour comparer sans tenir compte des majuscules ni des accents. */
export function fold(s) {
  return String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .replace(/ß/g, "ss")
    .toLowerCase();
}

/** Mots réservés : ils servent de chemins à la page (liste, retrait, studio, aperçu). Un album ne peut pas s'appeler ainsi. */
export const RESERVED = new Set(["page", "retrait", "removal", "studio", "apercu", "preview", "merci", "thanks", "erreur", "error"]);

/** Identifiant lisible pour l'adresse d'un album (« Fête d'été 2025 » → « fete-d-ete-2025 »). */
export function slugify(text) {
  const s = fold(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  return s && !RESERVED.has(s) ? s : s ? `${s}-album` : "album";
}

/** Un identifiant d'adresse n'entre dans le HTML que sous cette forme (jamais de texte libre). */
export const safeSlug = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);

/** Identifiant d'une ligne du stockage ou d'une photo. */
export const isId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);

/** JSON sûr dans une balise <script> : `<`, `>`, `&` et les séparateurs de ligne Unicode sont écrits en \uXXXX. */
export const safeJson = (value) => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** Identifiant court au hasard (lettres minuscules et chiffres) : photos, clé d'aperçu. */
export function randomId(length = 10) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** Nom de fichier gardé pour s'y retrouver : sans chemin, sans caractère étrange, 60 caractères au plus. */
export function safeName(value) {
  const base = String(value ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = clean(base, 200).replace(/[^\p{L}\p{N} ._()-]/gu, "_").replace(/^\.+/, "").replace(/_{2,}/g, "_");
  return cleaned.slice(0, HARD.name);
}

// ── Adresses ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Une adresse https:// (jamais http, javascript:, data:, ni identifiants dans l'adresse). Renvoie l'adresse nettoyée ou null. */
export function httpsUrl(value) {
  const v = String(value ?? "").trim();
  if (!/^https:\/\/[^\s<>"'`\\]{3,500}$/i.test(v)) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
    return u.toString().slice(0, 500);
  } catch { return null; }
}

/** Le nom du site d'une adresse (pour dire « vous quittez ce site »). */
export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/** Liste de sites autorisés : un par ligne ou séparés par des virgules, « exemple.org » ou « *.exemple.org ». */
export function parseHosts(text) {
  const out = [];
  for (const raw of String(text ?? "").split(/[\s,;]+/)) {
    const h = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (/^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h) && !out.includes(h)) out.push(h);
    if (out.length >= 20) break;
  }
  return out;
}

/** L'adresse est-elle sur un site autorisé ? « *.exemple.org » accepte les sous-domaines (pas le domaine nu). */
export function hostAllowed(url, hosts) {
  const host = hostOf(url);
  if (!host) return false;
  return hosts.some((h) => (h.startsWith("*.") ? host.endsWith(h.slice(1)) && host.length > h.length - 1 : host === h.replace(/^www\./, "")));
}

// ── Dates ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Une date AAAA-MM-JJ valide, ou "". */
export function isoDay(value) {
  const v = String(value ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 1900 && +m[1] <= 2200 ? v : "";
}

/** « 14 mars 2025 » dans la langue demandée (jamais d'erreur). */
export function dayLabel(iso, locale) {
  const day = isoDay(iso);
  if (!day) return "";
  try { return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`)); } catch { return day; }
}

/** Mégaoctets (décimaux) lisibles : « 12,5 » (le séparateur suit la langue). */
export function megabytes(bytes, locale) {
  const n = Math.round((Number(bytes) || 0) / 100000) / 10;
  try { return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n); } catch { return String(n); }
}

/** Texte brut court, pour une description (sans retours à la ligne). */
export function plainText(value, max) {
  const s = clean(value, 5000).replace(/\s+/g, " ");
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Une cellule de tableur : protégée contre les formules, entre guillemets. */
export function cell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Texte de description : paragraphes séparés par une ligne vide, liens automatiques sur les adresses https. */
export function renderText(value) {
  const paragraphs = String(value ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).slice(0, 12);
  return paragraphs
    .map((p) => {
      const html = esc(p).replace(/https:\/\/[^\s<>&"']{3,200}/g, (m) => `<a href="${m}" rel="noopener noreferrer">${m}</a>`).replace(/\n/g, "<br>");
      return `<p>${html}</p>`;
    })
    .join("");
}
