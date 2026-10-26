// Port de src/core/services/rawgMatch.ts du cœur (cale RAWG) : mêmes règles, même barème, en JavaScript.
/**
 * RESSEMBLANCE DE TITRES (jaquettes RAWG) — fonctions pures : aucune base, aucun réseau, aucune dépendance.
 *
 * RAWG classe ses résultats par pertinence, pas par ressemblance exacte : pour un titre ambigu, le premier résultat est parfois un autre jeu.
 * Ici on compare le titre demandé à chaque candidat et on dit si le meilleur est « quasi identique », ou si un autre candidat est presque aussi bon
 * (dans les deux cas : `ambiguous`, c'est-à-dire « à vérifier par une personne »).
 *
 * Normalisation (pour comparer, jamais pour afficher) : accents et casse retirés, `&` lu « and », ponctuation et apostrophes retirées, articles
 * (the, a, an, le, la, les, l', un, une, des) retirés, chiffres romains lus comme des chiffres (VII = 7), mention finale entre parenthèses
 * (« (2018) ») retirée. Le sous-titre (après « : » ou « - ») compte, mais un titre sans sous-titre ressemble beaucoup à celui qui en a un.
 */

/** À partir de ce score, le meilleur candidat est un titre « quasi identique ». */
export const NEAR_SCORE = 0.92;
/** Un deuxième candidat à moins de cet écart du premier rend la réponse ambiguë. */
export const TIE_GAP = 0.04;
/** Longueur maximale d'un titre comparé (bornes dures : la comparaison de textes coûte longueur × longueur). */
const MAX_COMPARED = 120;

const ARTICLES = new Set(["the", "a", "an", "le", "la", "les", "l", "un", "une", "des"]);
const ROMAN = {
  ii: "2", iii: "3", iv: "4", vi: "6", vii: "7", viii: "8", ix: "9", xi: "11", xii: "12", xiii: "13", xiv: "14", xv: "15", xvi: "16", xvii: "17", xviii: "18", xix: "19", xx: "20",
};
/** « v » et « x » seuls sont aussi des chiffres romains (Grand Theft Auto V, Final Fantasy X), mais jamais en premier mot. */
const ROMAN_LATE = { v: "5", x: "10" };

/** Un mot sans accent ni majuscule, lettres et chiffres seulement. */
function fold(text) {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/ß/g, "ss").replace(/ø/g, "o")
    .replace(/&/g, " and ").replace(/(^|[^a-z0-9])l['’`´](?=[a-z0-9])/g, "$1").replace(/['’`´]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function words(text) {
  const out = [];
  for (const [i, w] of fold(text).split(" ").filter(Boolean).entries()) {
    if (ARTICLES.has(w)) continue;
    out.push(ROMAN[w] ?? (i > 0 ? ROMAN_LATE[w] : undefined) ?? w);
  }
  return out;
}


                                                               





                                           



export function parseTitle(input) {
  const raw = String(input ?? "").slice(0, MAX_COMPARED * 2).replace(/\s*[(\[][^()\[\]]{0,40}[)\]]\s*$/u, "").trim();
  const cut = raw.search(/\s*(?::|\s[-–—]\s)\s*/u);
  const main = words(cut >= 0 ? raw.slice(0, cut) : raw);
  const sub = cut >= 0 ? words(raw.slice(cut).replace(/^\s*(?::|[-–—])\s*/u, "")) : [];
  const all = words(raw);
  return { all, main, sub, numbers: all.filter((w) => /^\d+$/.test(w)) };
}

/** Clé de comparaison d'un titre : les mêmes titres « à la ponctuation, aux accents et à la casse près » ont la même clé. Vide si le titre n'a ni lettre ni chiffre. */
export function titleKey(title) {
  return parseTitle(title).all.join(" ").slice(0, MAX_COMPARED);
}

const same = (a, b) => a.length === b.length && a.every((w, i) => w === b[i]);

/** Distance de Levenshtein entre deux textes courts (≤ 240 caractères : bornée par l'appelant). */
function distance(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

function dice(a, b) {
  if (!a.length || !b.length) return 0;
  const pool = [...b];
  let hit = 0;
  for (const w of a) { const at = pool.indexOf(w); if (at >= 0) { hit++; pool.splice(at, 1); } }
  return (2 * hit) / (a.length + b.length);
}

/**
 * Score de ressemblance de 0 à 1 entre le titre demandé et le nom d'un jeu.
 *   1      mêmes mots (accents, casse, ponctuation, articles, chiffres romains mis à part)
 *   0.9    même titre, mais un seul des deux a un sous-titre (« Hades » / « Hades: Battle out of Hell »)
 *   ≤ 0.6  même début mais numéros différents (« Portal » / « Portal 2 »), ou sous-titres différents
 *   autre  mélange de ressemblance des mots et des lettres, plafonné à 0.88 : une simple faute ou un pluriel ne fait jamais « quasi identique »
 */
export function titleScore(asked, found) {
  const a = parseTitle(asked), b = parseTitle(found);
  if (!a.all.length || !b.all.length) return 0;
  if (same(a.all, b.all)) return 1;
  const sameNumbers = same(a.numbers, b.numbers);
  if (same(a.main, b.main)) {
    if (!a.sub.length || !b.sub.length) return sameNumbers ? 0.9 : 0.6;
    return 0.6; // deux sous-titres différents : deux jeux différents
  }
  // L'un des deux titres entier est le début principal de l'autre, avec un sous-titre (« Hades » ↔ « Hades - Battle »).
  if ((same(a.all, b.main) && b.sub.length) || (same(b.all, a.main) && a.sub.length)) return sameNumbers ? 0.9 : 0.6;
  const text = (p) => p.all.join(" ").slice(0, MAX_COMPARED);
  const x = text(a), y = text(b);
  const letters = 1 - distance(x, y) / Math.max(x.length, y.length, 1);
  const mixed = Math.min(0.88, 0.5 * letters + 0.5 * dice(a.all, b.all));
  return Math.round((sameNumbers ? mixed : Math.min(mixed, 0.6)) * 1000) / 1000;
}



/** Candidats avec leur score, du meilleur au moins bon ; à score égal, l'ordre de RAWG est gardé. */
export function rank(asked, candidates) {
  return candidates
    .map((c, i) => ({ c: { ...c, score: titleScore(asked, c.name) }, i }))
    .sort((p, q) => q.c.score - p.c.score || p.i - q.i)
    .map((x) => x.c);
}

/**
 * Le meilleur candidat est-il sûr ? Non quand (a) il n'est pas un titre quasi identique, ou (b) un autre candidat (avec une autre image, donc un autre choix possible) a un score
 * presque égal au sien.
 */
export function isAmbiguous(ranked) {
  const best = ranked[0];
  if (!best) return false;
  if (best.score < NEAR_SCORE) return true;
  return ranked.slice(1).some((c) => best.score - c.score <= TIE_GAP && !!c.image && c.image !== best.image);
}
