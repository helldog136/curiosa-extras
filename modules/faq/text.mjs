// Questions fréquentes : petits outils de texte, sans état (nettoyage, échappement, mise en forme des réponses, données pour les moteurs de recherche).
// Tout ce qui vient d'un visiteur, d'un assistant ou d'une sauvegarde est traité comme non fiable : on nettoie à l'entrée, on échappe à la sortie.

export const LIMITS = {
  items: 500,       // questions publiées + brouillons
  themes: 30,
  asked: 200,       // questions reçues en attente
  question: 200,    // longueur d'une question publiée
  answer: 3000,     // longueur d'une réponse (une réponse plus longue mérite un article)
  asking: 300,      // longueur d'une question posée par une personne
  themeName: 60,
  aiDrafts: 50,     // brouillons de l'assistant qui attendent une relecture
  markup: 17000,    // taille maximale des données pour les moteurs de recherche (le cœur coupe à 20 000)
  markupAnswer: 4500, // une réponse plus grosse n'est pas décrite aux moteurs (le cœur coupe les textes à 5 000)
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

/**
 * Texte « plié » pour comparer sans tenir compte des majuscules ni des accents (« Été » = « ete »).
 * Cette fonction est AUSSI envoyée telle quelle au navigateur (voir client.mjs) : elle ne doit rien utiliser d'extérieur.
 */
export function fold(s) {
  return String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019\u2018`\u00b4]/g, "'")
    .replace(/\u0153/gi, "oe")
    .replace(/\u00e6/gi, "ae")
    .replace(/\u00df/g, "ss")
    .toLowerCase();
}

/** Identifiant lisible pour l'ancre d'une question (« Quand streamez-vous ? » → « quand-streamez-vous »). */
export function slugify(text) {
  const s = fold(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  return s || "question";
}

/** Un identifiant d'ancre n'entre dans le HTML que sous cette forme (jamais de texte libre). */
export const safeSlug = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);

/** Un code de langue n'entre dans une page que sous cette forme (`lang="…"`). */
export const safeLang = (value) => (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(String(value ?? "")) ? String(value) : null);

/** Un lien n'est repris que s'il est http(s), mailto: ou un chemin du site (jamais `javascript:` ni `data:`). */
export function safeHref(value) {
  const v = String(value ?? "").trim();
  if (/^https?:\/\/[^\s<>"'`]{1,500}$/i.test(v)) return v;
  if (/^mailto:[^\s<>"'`]{3,200}$/i.test(v)) return v;
  if (/^\/(?!\/)[^\s<>"'`\\]{0,300}$/.test(v)) return v;
  return null;
}

// ── Mise en forme d'une réponse : gras, italique, liens, listes. Le HTML produit est volontairement très simple
//    (p, br, ul, ol, li, a, strong, em) : c'est aussi ce que les moteurs de recherche acceptent dans une réponse de FAQ.
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
export function renderAnswer(raw) {
  const text = clean(raw, LIMITS.answer, true);
  if (!text) return "";
  const out = [];
  let para = [];
  let list = null; // { tag, items }
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

/** Le même texte sans aucune mise en forme (extrait d'un tableau, description d'une page). */
export function plainText(raw, max = 160) {
  const s = clean(raw, 20000, true)
    .replace(/\[([^\]\n]{1,200})\]\([^)\s]{1,500}\)/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, "$1")
    .replace(/^\s*[-*\u2022]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// ── Données pour les moteurs de recherche (FAQPage) ──────────────────────────────────────────────────────────────

/** JSON sûr dans une balise <script> : `<`, `>`, `&` et les séparateurs de ligne Unicode sont écrits en \uXXXX. */
export const safeJson = (value) => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/**
 * Description FAQPage des questions VISIBLES sur la page (même texte que celui affiché). Bornée : au plus 100 questions et LIMITS.markup caractères ;
 * ce qui ne rentre pas est compté dans `omitted` (jamais coupé en deux).
 */
export function faqMarkup(items, locale) {
  const main = [];
  let size = 120;
  let omitted = 0;
  for (const it of items) {
    if (!it.q || !it.html || it.html.length > LIMITS.markupAnswer) { omitted++; continue; }
    const node = { "@type": "Question", name: it.q, acceptedAnswer: { "@type": "Answer", text: it.html } };
    if (it.other && safeLang(it.lang)) node.inLanguage = it.lang;
    const add = safeJson(node).length + 1;
    if (main.length >= 100 || size + add > LIMITS.markup) { omitted++; continue; }
    main.push(node);
    size += add;
  }
  if (!main.length) return { doc: null, count: 0, omitted };
  const doc = { "@type": "FAQPage", mainEntity: main };
  if (safeLang(locale)) doc.inLanguage = locale;
  return { doc, count: main.length, omitted };
}

/** Une cellule CSV : toujours entre guillemets ; un « = », « + », « - » ou « @ » initial est neutralisé (injection de formule dans un tableur). */
export function cell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Date lisible (UTC, pour un rendu identique d'un serveur à l'autre). */
export function day(date, locale) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  try { return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(d); } catch { return d.toISOString().slice(0, 10); }
}

/** Nom d'une langue dans la langue de l'écran (« français », « English »). */
export function languageName(code, inLocale) {
  try { return new Intl.DisplayNames([inLocale], { type: "language" }).of(code) || code; } catch { return code; }
}
