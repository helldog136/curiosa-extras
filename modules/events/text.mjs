// Événements : petits outils de texte, sans état (nettoyage, échappement, mise en forme des textes, liens sûrs, cellules de tableur).
// Tout ce qui vient d'un visiteur, d'un assistant, d'un fichier importé ou d'une sauvegarde est traité comme non fiable : on nettoie à l'entrée, on échappe à la sortie.

export const LIMITS = {
  events: 2000,        // événements gardés (brouillons compris)
  perPage: 50,         // le plus grand nombre d'événements montrés d'un coup
  types: 30,           // types définis par la propriétaire
  occurrences: 100,    // une répétition crée 100 rendez-vous au plus
  repeatYears: 3,      // ... et ne va pas plus loin que 3 ans
  program: 40,         // créneaux d'un programme
  speakers: 20,        // intervenants
  title: 120,
  place: 160,
  text: 8000,
  slotTitle: 120,
  slotText: 300,
  speakerName: 80,
  speakerRole: 100,
  url: 500,
  typeName: 40,
  query: 80,
  importRows: 2000,    // lignes d'un fichier importé
  importBytes: 5_000_000,
};

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

/** Texte « plié » pour comparer sans tenir compte des majuscules ni des accents (« Été » = « ete »). */
export function fold(s) {
  return String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .replace(/ß/g, "ss")
    .toLowerCase();
}

/** Identifiant lisible (« Atelier de dessin » → « atelier-de-dessin »). */
export function slugify(text, max = 48, fallback = "item") {
  const s = fold(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
  return s || fallback;
}

/** Un identifiant n'entre dans une adresse ou dans le HTML que sous cette forme (jamais de texte libre). */
export const safeSlug = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 80);

/** Un code de langue n'entre dans une page que sous cette forme (`lang="…"`). */
export const safeLang = (value) => (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(String(value ?? "")) ? String(value) : null);

/** Un lien n'est repris que s'il est http(s), mailto: ou un chemin du site (jamais `javascript:` ni `data:`). */
export function safeHref(value) {
  const v = String(value ?? "").trim();
  if (/^https?:\/\/[^\s<>"'`\\]{1,500}$/i.test(v)) return v;
  if (/^mailto:[^\s<>"'`\\]{3,200}$/i.test(v)) return v;
  if (/^\/(?!\/)[^\s<>"'`\\]{0,300}$/.test(v)) return v;
  return null;
}

/** Une ressource chargée dans la page (image, fichier vidéo) : https ou un fichier du site, rien d'autre. */
export function safeMedia(value) {
  const v = String(value ?? "").trim();
  if (/^https:\/\/[^\s<>"'`\\]{1,500}$/i.test(v)) return v;
  if (/^\/(?!\/)[^\s<>"'`\\]{0,300}$/.test(v)) return v;
  return null;
}

/** Une adresse de vidéo YouTube (watch, youtu.be, embed, live, shorts) → l'identifiant de la vidéo, ou null. */
export function youtubeId(value) {
  const v = String(value ?? "").trim();
  const m = /^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|live\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#/][^\s]*)?$/i.exec(v);
  return m ? m[1] : null;
}

/** Un fichier vidéo du site (envoyé par la propriétaire) ou en https : mp4 / webm. */
export function videoFile(value) {
  const v = safeMedia(value);
  return v && /\.(mp4|webm)(\?[^\s]*)?$/i.test(v) ? v : null;
}

// ── Mise en forme d'un texte : gras, italique, liens, listes. Le HTML produit est volontairement très simple (p, br, ul, ol, li, a, strong, em).
const INLINE = /\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)|(https?:\/\/[^\s<>"')\]]{1,500})|\*\*([^*\n]{1,500})\*\*|(?<![*\w])\*([^*\n]{1,300})\*(?![*\w])/g;
const link = (href, label) => `<a href="${esc(href)}" rel="noopener noreferrer">${esc(label)}</a>`;

function inline(s) {
  let out = "";
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    out += esc(s.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      const href = safeHref(m[2]);
      out += href ? link(href, m[1]) : esc(m[1]);
    } else if (m[3] !== undefined) {
      let url = m[3];
      let tail = "";
      const t = /[.,;:!?]+$/.exec(url);
      if (t) { tail = t[0]; url = url.slice(0, -tail.length); }
      const href = safeHref(url);
      out += (href ? link(href, url) : esc(url)) + esc(tail);
    } else if (m[4] !== undefined) out += `<strong>${esc(m[4])}</strong>`;
    else out += `<em>${esc(m[5])}</em>`;
  }
  return out + esc(s.slice(last));
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBER = /^\s*\d{1,2}[.)]\s+/;

/** Texte brut de l'éditeur → HTML simple et sûr. Vide si le texte est vide. */
export function renderText(raw, max = LIMITS.text) {
  const text = clean(raw, max, true);
  if (!text) return "";
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; };
  for (const line of text.split("\n")) {
    if (!line.trim()) { flushPara(); flushList(); continue; }
    const kind = BULLET.test(line) ? "ul" : NUMBER.test(line) ? "ol" : null;
    if (kind) {
      flushPara();
      if (list && list.tag !== kind) flushList();
      (list ??= { tag: kind, items: [] }).items.push(line.replace(kind === "ul" ? BULLET : NUMBER, ""));
    } else { flushList(); para.push(line.trim()); }
  }
  flushPara();
  flushList();
  return out.join("");
}

/** Le même texte sans aucune mise en forme (extrait, description d'une page). */
export function plainText(raw, max = 160) {
  const s = clean(raw, 20000, true)
    .replace(/\[([^\]\n]{1,200})\]\([^)\s]{1,500}\)/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, "$1")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** JSON sûr dans une balise <script> : `<`, `>`, `&` et les séparateurs de ligne Unicode sont écrits en \uXXXX. */
export const safeJson = (value) => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** Une cellule CSV : toujours entre guillemets ; un « = », « + », « - » ou « @ » initial est neutralisé (injection de formule dans un tableur). */
export function cell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Entier positif lisible dans un champ (« 12 », « 12 places »), ou null quand le champ est vide ; `undefined` si ce n'est pas un nombre. */
export function parseCount(raw, max = 100000) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = /^(\d{1,6})(?:\s*[a-zA-Zéèêàù.]*)?$/.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 0 && n <= max ? n : undefined;
}

/** Une coordonnée : nombre décimal (virgule acceptée) borné ; null si vide ; undefined si illisible. */
export function parseCoord(raw, limit) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return null;
  if (!/^-?\d{1,3}(\.\d{1,8})?$/.test(s)) return undefined;
  const n = Number(s);
  return Math.abs(n) <= limit ? Math.round(n * 1e6) / 1e6 : undefined;
}
