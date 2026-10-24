// Carte : petits outils de texte, sans état (nettoyage, échappement, comparaison sans accents, fichiers CSV).
// Tout ce qui vient d'un visiteur, d'un assistant, d'un fichier ou d'un autre module est traité comme non fiable : on nettoie à l'entrée, on échappe à la sortie.

/** Bornes dures du module (rien n'est lu ni écrit sans limite). */
export const LIMITS = {
  places: 5000,      // lieux saisis par l'équipe (brouillons compris)
  external: 200,     // lieux venant d'autres modules (limite du cœur pour un sujet : 200 éléments)
  types: 30,
  cities: 100,
  hidden: 500,       // lieux d'autres modules masqués un par un
  perPage: 50,       // lieux par page à l'écran
  read: 500,         // lieux par lecture (assistant IA)
  importRows: 500,   // lignes d'un fichier traitées à chaque envoi
  importFile: 2_000_000,
  name: 120,
  address: 200,
  desc: 1500,
  hours: 300,
  url: 300,
  note: 300,
  typeName: 40,
  cityName: 80,
  search: 80,
  markers: 200,      // marqueurs affichés au plus sur la carte avant regroupement forcé (la valeur utilisée est dans le script de la carte)
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

/** Réglage « oui/non » : une case décochée vaut non, un réglage jamais touché vaut sa valeur par défaut. */
export const flag = (ctx, key, fallback) => {
  const v = ctx.setting(key);
  return v === undefined || v === null || v === "" ? fallback : v === true || v === "true" || v === 1 || v === "1" || v === "on";
};

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

/** Identifiant court et lisible (« Bonne adresse » → « bonne-adresse »), en minuscules : il sert dans les adresses de pages. */
export function slugify(text, fallback = "type") {
  const s = fold(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/, "");
  return s || fallback;
}

/** Un identifiant de type n'entre dans une page que sous cette forme. */
export const safeId = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);

/** Un code de lieu (adresse d'une fiche) : minuscules et chiffres, 6 à 16 caractères. */
export const CODE_RE = /^[a-z0-9]{6,16}$/;
export const isCode = (v) => typeof v === "string" && CODE_RE.test(v);

/** Un lien n'est repris que s'il est http(s) ou un chemin du site (jamais `javascript:` ni `data:`). */
export function safeHref(value) {
  const v = String(value ?? "").trim();
  if (/^https?:\/\/[^\s<>"'`\\]{1,500}$/i.test(v)) return v;
  if (/^\/(?!\/)[^\s<>"'`\\]{0,300}$/.test(v)) return v;
  return null;
}

/** Le nom du site d'un lien, pour l'afficher (« https://www.exemple.org/a » → « exemple.org »). */
export function hostOf(href) {
  try { return new URL(href, "https://x.invalid").hostname.replace(/^www\./, "") || ""; } catch { return ""; }
}

/** Un texte brut devient des paragraphes (lignes vides) et des retours à la ligne, échappés. Aucun HTML, aucun lien automatique. */
export function paragraphs(text) {
  return String(text ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** Texte court : coupé proprement avec « … ». */
export function shorten(text, max) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

/** Texte à mettre dans une cellule CSV : entre guillemets, doublés ; une formule de tableur est neutralisée (apostrophe). */
export function cell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Lit un fichier CSV (virgule, point-virgule ou tabulation ; guillemets doublés ; retours à la ligne dans une cellule).
 * Rend { delimiter, rows } où rows est un tableau de tableaux de texte. Borné : `maxRows` lignes, `maxCells` cellules par ligne.
 */
export function parseCsv(input, { maxRows = 100_000, maxCells = 40 } = {}) {
  const text = String(input ?? "").replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch) => (first.match(new RegExp(ch === "\t" ? "\\t" : `\\${ch}`, "g")) ?? []).length;
  const delimiter = [";", "\t", ","].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0];
  const sep = delimiter && delimiter[1] > 0 ? delimiter[0] : ",";
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let started = false;
  const endField = () => { if (row.length < maxCells) row.push(field); field = ""; started = false; };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0].trim() === "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
    } else if (ch === '"' && !started) { quoted = true; started = true; }
    else if (ch === sep) endField();
    else if (ch === "\n") endRow();
    else if (ch === "\r") { if (text[i + 1] === "\n") i++; endRow(); }
    else { field += ch; started = true; }
  }
  if (rows.length < maxRows && (field !== "" || row.length)) endRow();
  return { delimiter: sep, rows };
}

/** Distance entre deux positions, en kilomètres (haversine). Le navigateur a son propre calcul ; celui-ci sert aux tests de cohérence. */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}
