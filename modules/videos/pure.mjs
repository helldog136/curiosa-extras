// Vidéothèque — les petites fonctions pures (aucune lecture, aucun réseau) : bornes, texte, adresses du site, durées, dates, curseurs, balisage sûr.
// Tout ce qui s'affiche passe par `esc` ; tout ce qui sert de lien est construit ICI à partir de valeurs validées, jamais recopié d'une saisie.

/** Les bornes dures du module (documentées dans le README et docs/ideas/videos.md). */
export const LIMITS = {
  videos: 5000, // vidéos par vidéothèque
  perPage: 12, perPageMax: 50, // à l'écran
  inSeries: 100, // vidéos dans une série
  categories: 40, series: 200,
  title: 150, desc: 3000, transcript: 20000, name: 80, seriesDesc: 600,
  bulk: 100, // adresses collées d'un coup
  bulkText: 12000, // taille du texte collé
  adminPage: 25, searchMax: 100,
  thumbBytes: 64 * 1024, // une miniature gardée
  fillBatch: 20, // titres complétés par clic
  cover: 200,
};

export const STATUSES = ["published", "draft", "hidden"];
export const VIDEO_STATUS = (x) => (STATUSES.includes(x) ? x : "draft");

/** Échappe un texte pour le mettre dans une page (corps ET attribut). */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const CTRL_LINE = new RegExp("[\\u0000-\\u001f\\u007f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]", "g");
const CTRL_MULTI = new RegExp("[\\u0000-\\u0009\\u000b-\\u001f\\u007f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]", "g");

/** Texte d'une ligne ou de plusieurs, sans caractère de contrôle, borné en CARACTÈRES (pas en octets). */
export function clean(value, max, multiline = false) {
  let s = typeof value === "string" ? value : Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
  s = s.normalize("NFC").replace(/\r\n?/g, "\n").replace(multiline ? CTRL_MULTI : CTRL_LINE, multiline ? "" : " ");
  s = multiline ? s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() : s.replace(/\s+/g, " ").trim();
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max).join("").trim() : s;
}

export const int = (x, d, min, max) => { const n = Math.trunc(Number(x)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };

/** Minuscules sans accent : pour chercher et pour comparer. */
export const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Un morceau d'adresse lisible (lettres, chiffres, tirets), 40 caractères au plus. */
export const slugify = (s, max = 40) => fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");

/** Le mot de recherche tel qu'il passe dans une adresse : lettres et chiffres séparés par des tirets (minuscules, sans accent). */
export const searchSlug = (s) => fold(clean(s, LIMITS.searchMax)).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");

/** Les mots d'une recherche (un tiret de l'adresse vaut une espace). */
export const searchWords = (s) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 8);

// ── Les adresses du site ────────────────────────────────────────────────────────────────────────────────────────────

/** Le chemin public de l'instance : « /videos » ou « » (racine). Null : pas de page publique. */
export function base(ctx) {
  const b = ctx.instance?.basePath;
  if (b === null || b === undefined) return null;
  const s = String(b).replace(/^\/+|\/+$/g, "");
  return s ? `/${s}` : "";
}
export const homeHref = (ctx) => base(ctx) || "/";

export const videoPath = (ctx, v, opts = {}) => {
  const b = base(ctx);
  if (b === null) return null;
  const slug = slugify(v.title, 40);
  return `${b}/v/${v.n}${slug ? `-${slug}` : ""}${opts.series ? `/in/${opts.series.p}` : ""}${opts.play ? "/play" : ""}`;
};
export const seriesPath = (ctx, s) => {
  const b = base(ctx);
  if (b === null) return null;
  const slug = slugify(pickName(s.names, "", ""), 40);
  return `${b}/p/${s.p}${slug ? `-${slug}` : ""}`;
};
/** Chemin de la miniature gardée par le site (la route de l'instance). */
export const thumbPath = (ctx, v) => `/m/${encodeURIComponent(ctx.instance.key)}/thumb?v=${v.n}`;

/** Adresse du catalogue filtré : categorie (morceau d'adresse), mot cherché, curseur. */
export function listPath(ctx, { cat = "", q = "", after = "" } = {}) {
  const b = base(ctx);
  if (b === null) return null;
  const parts = [];
  if (cat) parts.push("c", cat);
  if (q) parts.push("s", q);
  if (after) parts.push("after", after);
  return parts.length ? `${b}/${parts.join("/")}` : b || "/";
}

// ── Textes par langue ───────────────────────────────────────────────────────────────────────────────────────────────

/** Le texte dans la langue de l'écran, sinon celle du site, sinon n'importe laquelle. */
export function pickName(map, locale, defaultLocale) {
  if (!map || typeof map !== "object") return "";
  for (const l of [locale, defaultLocale]) if (l && typeof map[l] === "string" && map[l]) return map[l];
  for (const v of Object.values(map)) if (typeof v === "string" && v) return v;
  return "";
}

// ── Durées et dates ────────────────────────────────────────────────────────────────────────────────────────────────

/** « 12:34 », « 1:02:03 » ou « 90 » (secondes) → secondes (0 = inconnue). Refuse le reste en renvoyant null. */
export function parseDuration(text) {
  const s = clean(text, 20);
  if (!s) return 0;
  const m = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})$/.exec(s) ?? /^(?:(\d{1,3})\s*h\s*)?(\d{1,3})\s*(?:m|min)\s*(?:(\d{1,2})\s*s?)?$/i.exec(s);
  if (m) {
    const h = m[1] ? Number(m[1]) : 0, mi = Number(m[2]), se = m[3] ? Number(m[3]) : 0;
    if (se > 59 || (m[1] !== undefined && mi > 59)) return null;
    const total = h * 3600 + mi * 60 + se;
    return total > 0 && total <= 48 * 3600 ? total : null;
  }
  if (/^\d{1,6}$/.test(s)) { const n = Number(s); return n > 0 && n <= 48 * 3600 ? n : null; }
  return null;
}
export function formatDuration(sec) {
  const n = Math.trunc(Number(sec));
  if (!Number.isFinite(n) || n <= 0) return "";
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
/** Durée ISO 8601 pour les données structurées : PT1H2M3S. */
export function isoDuration(sec) {
  const n = Math.trunc(Number(sec));
  if (!Number.isFinite(n) || n <= 0) return "";
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s || (!h && !m) ? `${s}S` : ""}`;
}

/** « 2026-10-24 » valide (le 30 février est refusé), sinon null. */
export function parseDate(text) {
  const s = clean(text, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1990 || y > 2100 || t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return s;
}
export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export function formatDate(iso, locale) {
  const d = parseDate(iso) ? new Date(`${iso}T12:00:00Z`) : null;
  if (!d) return "";
  try { return new Intl.DateTimeFormat(locale || "en", { dateStyle: "long", timeZone: "UTC" }).format(d); } catch { return iso; }
}

// ── Curseurs : « 20261024-153 » = (date de la vidéo, numéro). Tri : date décroissante, puis numéro décroissant. ─────────

export const cursorOf = (v) => `${String(v.date).replace(/-/g, "")}-${v.n}`;
export function parseCursor(text) {
  const m = /^(\d{8})-(\d{1,7})$/.exec(String(text ?? ""));
  return m ? { date: m[1], n: Number(m[2]) } : null;
}
/** Vrai si la vidéo vient APRÈS le curseur dans l'ordre de la liste. */
export const afterCursor = (v, cur) => {
  const d = String(v.date).replace(/-/g, "");
  return d < cur.date || (d === cur.date && v.n < cur.n);
};
export const byNewest = (a, b) => (a.date === b.date ? b.n - a.n : a.date < b.date ? 1 : -1);

// ── Texte → page ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Texte brut → paragraphes ; les adresses https:// deviennent des liens (rien d'autre n'est interprété, aucun balisage venu du texte n'est conservé). */
export function paragraphs(text, cls = "") {
  const out = [];
  for (const block of String(text ?? "").split(/\n{2,}/)) {
    const t = block.trim();
    if (!t) continue;
    const html = esc(t).replace(/https?:\/\/[^\s<>"']{3,200}/g, (url) => {
      const trail = /(?:[.,;:!?)\]]|&quot;|&#39;|&gt;|&lt;)+$/.exec(url)?.[0] ?? "";
      const href = trail ? url.slice(0, -trail.length) : url;
      let ok = false;
      try { const u = new URL(href.replace(/&amp;/g, "&")); ok = (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password; } catch { /* pas une adresse */ }
      return ok ? `<a href="${href}" rel="nofollow noopener noreferrer" target="_blank">${href}</a>${trail}` : url;
    }).replace(/\n/g, "<br>");
    out.push(`<p${cls ? ` class="${cls}"` : ""}>${html}</p>`);
  }
  return out.join("");
}

/** JSON sûr dans une balise <script> : ni « < », ni « > », ni « & ». */
export const safeJson = (value) => JSON.stringify(value).replace(new RegExp("[<>&\\u2028\\u2029]", "g"), (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** Un chemin d'image du site (envoi de fichier) : /uploads/… seulement, jamais une adresse extérieure. */
export function sitePath(text) {
  const s = clean(text, LIMITS.cover);
  return /^\/uploads\/[A-Za-z0-9][A-Za-z0-9._\-/]{0,180}$/.test(s) && !s.includes("..") && !s.includes("//") ? s : "";
}

/** Les langues du site, la langue par défaut d'abord. */
export const localesOf = (ctx) => [ctx.defaultLocale, ...(ctx.locales ?? []).filter((l) => l !== ctx.defaultLocale)].filter((l, i, a) => l && a.indexOf(l) === i);

/** Gabarits de départ (un choix en un clic) : des mots courants, jamais un nom propre. « Vide » ne crée rien. Toujours modifiables ensuite. */
export const TEMPLATES = {
  talks: ["masterclass", "retrospectives", "tutorials"],
  empty: [],
};
export const TEMPLATE_NAMES = {
  masterclass: { fr: "Masterclass", en: "Masterclass" },
  retrospectives: { fr: "Rétrospectives", en: "Retrospectives" },
  tutorials: { fr: "Tutoriels", en: "Tutorials" },
};

/** Une cellule de tableur : entre guillemets, et jamais lue comme une formule. */
export const cell = (x) => {
  let s = String(x ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
