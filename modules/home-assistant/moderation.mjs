// Modération du texte lu à voix haute : fonctions pures (aucun stockage, aucun réseau), donc faciles à essayer à fond.
//
// Principe : on NETTOIE d'abord (ce que la voix dirait vraiment), puis on décide. Un texte qui reste lisible après nettoyage passe ; un texte vide, trop long,
// avec un numéro de téléphone ou un mot de la liste est REFUSÉ (le viewer est remboursé, le motif est noté dans le journal). Rien n'est jamais « corrigé » en silence
// au point de changer le sens d'une phrase : on retire les liens, balises et mentions, on réduit les répétitions, c'est tout.
//
// Ordre : coupe à 2 000 caractères → normalisation Unicode (NFKC) → caractères de contrôle et invisibles → balises (SSML, HTML) et Markdown → adresses et liens
// → mentions → emojis (3 au plus) → répétitions → espaces → [vide ? trop long ? numéros ? mot de la liste ?].

import { DEFAULT_WORDS } from "./words.mjs";

export const RAW_MAX = 2000;
export const MAX_CHARS = { min: 20, max: 300, default: 140 };
export const NAME_MAX = 25;
export const EMOJI_MAX = 3;
const ENTRY_MAX = 40, ENTRIES_MAX = 500;

const len = (s) => [...s].length;
const cutChars = (s, n) => [...s].slice(0, n).join("");

/* ───────────── Nettoyage ───────────── */

// Domaines courants : « exemple.com » ou « super.tv/abc » sont retirés même sans « http ».
const TLD = "com|net|org|fr|be|io|tv|gg|co|uk|de|es|it|nl|ch|ca|us|xyz|me|ly|app|dev|info|biz|ru|cn|tk|ml|ga|cf|gq|top|site|online|link|live|shop|club|vip|cc|to|sh|so|gl|gd|li|eu|pro|fun|win|bid|zip|mov|lol|wtf|ws|su|pw|cloud|page|store|tech|click";
const RE_SCHEME = /\b(?:https?|ftp|wss?|file|data|javascript|vbscript|mailto|tel|sms|ssh|irc|magnet|steam|discord):[^\s]+/giu;
const RE_ANY_SCHEME = /[a-z][a-z0-9+.-]*:\/\/[^\s]+/giu;
const RE_WWW = /\bwww\d?\.[^\s]+/giu;
const RE_EMAIL = /[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[^\s@<>()[\]]+/gu;
const RE_DOMAIN = new RegExp(`\\b(?:[a-z0-9-]{1,63}\\.)+(?:${TLD})\\b(?:[/:?#][^\\s]*)?`, "giu");
const RE_IPV4 = /\b\d{1,3}(?:\s?\.\s?\d{1,3}){3}\b(?::\d{1,5})?/gu;
const RE_DOT = /\s*[[(]\s*(?:dot|point|punkt)\s*[\])]\s*/giu;
const RE_MENTION = /(?:^|[\s([{"'«])[@＠][\p{L}\p{N}_][\p{L}\p{N}_.-]*/gu;
const RE_EMOJI = /\p{Regional_Indicator}{2}|[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u20E3](?:\uFE0F|\u200D\p{Extended_Pictographic}\uFE0F?|[\u{1F3FB}-\u{1F3FF}]|\u20E3)*/gu;

/** Les caractères qu'une voix ne dit pas et qui servent à tromper : contrôle, invisibles, marques de sens d'écriture, zone privée. Garde U+200D (liaison d'emojis, retirée plus loin). */
function stripInvisible(s) {
  return s
    .replace(/[\t\n\r\u000b\u000c\u0085\u2028\u2029]+/gu, " ")
    .replace(/[\p{Cc}\p{Co}\p{Cs}\p{Cn}]/gu, "")
    .replace(/(?!\u200D)\p{Cf}/gu, "");
}

/** Retire les balises (SSML, HTML) et le balisage Markdown ; garde le texte lisible (« [texte](lien) » → « texte »). */
function stripMarkup(s) {
  let out = s;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(/<[^<>]*>/gu, " ");
    if (next === out) break;
    out = next;
  }
  return out
    .replace(/[<>]/gu, " ")
    .replace(/&(?:#x?[0-9a-f]+|[a-z][a-z0-9]{1,8});/giu, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/[*_~`|\\#[\]{}^]/gu, " ")
    .replace(/(^|\s)[-+=]{2,}(?=\s|$)/gu, " ");
}

function stripAddresses(s) {
  return s.replace(RE_SCHEME, " ").replace(RE_ANY_SCHEME, " ").replace(RE_EMAIL, " ").replace(RE_WWW, " ").replace(RE_DOMAIN, " ").replace(RE_IPV4, " ");
}

/** Au plus EMOJI_MAX emojis dans tout le texte ; les autres sont retirés. Les emojis liés (famille, drapeau) comptent pour un. */
function limitEmojis(s) {
  let seen = 0;
  return s.replace(RE_EMOJI, (m) => (++seen <= EMOJI_MAX ? m : " "));
}

/** « aaaaaaa » → « aaa » (au-delà de 4 fois le même caractère) ; « spam spam spam spam spam » → « spam spam ». */
function squeeze(s) {
  return s
    .replace(/(\P{M}\p{M}*)\1{4,}/gsu, "$1$1$1")
    .replace(/(?<![\p{L}\p{N}])([\p{L}\p{N}]+)(?:\s+\1(?![\p{L}\p{N}])){3,}/giu, "$1 $1");
}

/**
 * Le texte tel que la voix le dirait. Rend { text, changed } (`changed` : la liste de ce qui a été retiré, pour le journal : "markup", "address", "mention", "emoji", "repeat", "invisible").
 */
export function clean(input, { maxRaw = RAW_MAX } = {}) {
  const changed = new Set();
  const raw = typeof input === "string" ? input : input == null ? "" : String(input);
  let s = cutChars(cutChars(raw, maxRaw).normalize("NFKC"), maxRaw * 2);
  const step = (name, fn) => { const next = fn(s); if (next !== s) changed.add(name); s = next; };
  step("invisible", stripInvisible);
  step("address", (x) => x.replace(RE_DOT, "."));
  step("markup", stripMarkup);
  step("address", stripAddresses);
  step("mention", (x) => x.replace(RE_MENTION, " ").replace(/[@＠]/gu, " "));
  step("emoji", limitEmojis);
  s = s.replace(/(?<!\p{Extended_Pictographic}\uFE0F?)\u200D|\u200D(?!\p{Extended_Pictographic})/gu, "");
  step("repeat", squeeze);
  s = s.replace(/\s+/gu, " ").trim();
  return { text: s, changed: [...changed] };
}

/** Un pseudo présentable : nettoyé comme un texte, sans lien ni mention, 25 caractères au plus. */
export function cleanName(input) {
  const { text } = clean(input, { maxRaw: 200 });
  return cutChars(text.replace(/[^\p{L}\p{N}\p{Extended_Pictographic} _.'’-]/gu, " ").replace(/\s+/gu, " ").trim(), NAME_MAX).trim();
}

/* ───────────── Numéros ───────────── */

const SPOKEN_DIGITS = new Set(["zero", "un", "une", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "one", "two", "three", "four", "five", "seven", "eight", "nine", "ten", "oh", "nul"]);

/** Vrai si le texte contient un numéro (téléphone, carte…) : 6 chiffres de suite (séparateurs permis), 8 chiffres en tout, ou 6 chiffres dits en lettres de suite. */
export function hasNumber(text) {
  const t = String(text ?? "").normalize("NFKC");
  const compact = t.replace(/(?<=\d)[\s.\-_/()+·]{1,2}(?=\d)/gu, "");
  if (/\d{6,}/u.test(compact)) return true;
  if ((compact.match(/\d/gu) ?? []).length >= 8) return true;
  const words = fold(t).split(" ");
  let run = 0;
  for (const w of words) {
    if (SPOKEN_DIGITS.has(w) || /^\d$/u.test(w)) { if (++run >= 6) return true; } else run = 0;
  }
  return false;
}

/* ───────────── Comparaison à la liste ───────────── */

const CONFUSABLES = {
  // lettres d'autres alphabets qui ressemblent à des lettres latines
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "і": "i", "ј": "j", "ѕ": "s", "к": "k", "н": "h", "м": "m", "т": "t", "в": "b", "ԁ": "d", "ԛ": "q", "ԝ": "w",
  "α": "a", "ε": "e", "ο": "o", "ρ": "p", "ι": "i", "κ": "k", "ν": "v", "τ": "t", "υ": "u", "χ": "x", "β": "b", "η": "n", "ω": "w",
  "œ": "oe", "æ": "ae", "ß": "ss", "ø": "o", "đ": "d", "ł": "l", "ı": "i",
};
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "€": "e", "£": "l", "¢": "c" };

/**
 * La forme de comparaison d'un texte : minuscules, sans accents, chiffres et signes glissés dans un mot lus comme des lettres (« m3rd€ » → « merde »),
 * alphabets proches ramenés au latin, tout ce qui n'est pas lettre ou chiffre devient une espace.
 */
export function fold(input) {
  let s = String(input ?? "").normalize("NFKC").toLowerCase();
  s = s.replace(/\p{Cf}/gu, "");
  s = s.normalize("NFD").replace(/\p{M}/gu, "");
  s = s.replace(/[^\u0000-\u007f]/gu, (c) => CONFUSABLES[c] ?? c);
  // un signe ou un chiffre collé à une lettre est une lettre déguisée ; « ! » seulement ENTRE deux lettres (« salut ! » reste une ponctuation)
  s = s.replace(/(?<=[a-z])[013457@$€£¢]|[013457@$€£¢](?=[a-z])/gu, (c) => LEET[c] ?? c);
  s = s.replace(/(?<=[a-z])!(?=[a-z])/gu, "i");
  return s.replace(/[^a-z0-9]+/gu, " ").trim();
}

/** Les écritures possibles d'un même texte pour contourner une liste : tel quel, lettres répétées réduites, lettres espacées recollées. */
function variants(folded) {
  const out = new Set([folded]);
  out.add(folded.replace(/([a-z])\1{2,}/gu, "$1$1"));
  out.add(folded.replace(/([a-z])\1{2,}/gu, "$1"));
  const joined = folded.replace(/(?<![a-z0-9])(?:[a-z0-9] ){2,}[a-z0-9](?![a-z0-9])/gu, (m) => m.replace(/ /gu, ""));
  out.add(joined);
  out.add(joined.replace(/([a-z])\1{2,}/gu, "$1"));
  return [...out].map((v) => ` ${v} `);
}

/** Lit un réglage « un mot par ligne » (virgules et points-virgules acceptés) : au plus 500 entrées de 40 caractères. */
export function parseWordList(input) {
  const seen = new Set(), out = [];
  for (const part of String(input ?? "").split(/[\n\r,;]+/u)) {
    const raw = part.trim().replace(/\s+/gu, " ");
    if (!raw || raw.length > ENTRY_MAX * 2) continue;
    const start = raw.startsWith("*"), end = raw.endsWith("*");
    const core = fold(raw.replace(/\*/gu, ""));
    if (!core || core.length > ENTRY_MAX) continue;
    const key = `${start ? "*" : ""}${core}${end ? "*" : ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ raw: raw.slice(0, ENTRY_MAX), key, core, start, end });
    if (out.length >= ENTRIES_MAX) break;
  }
  return out;
}

/**
 * Le détecteur de la propriétaire : la liste fournie (si elle est activée) + ses mots en plus − ses mots à toujours accepter.
 * `find(texte)` rend l'entrée trouvée (`{ raw }`) ou null.
 */
export function buildMatcher({ useDefaults = true, extra = "", allowed = "" } = {}) {
  const allowedEntries = parseWordList(allowed);
  const ok = new Set(allowedEntries.map((e) => e.key));
  // un mot seul « toujours accepté » est aussi retiré du texte avant la comparaison (« merdique » accepté malgré « merd* »)
  const allowedWords = new Set(allowedEntries.filter((e) => !e.start && !e.end && !e.core.includes(" ")).map((e) => e.core));
  const entries = [...(useDefaults ? parseWordList(DEFAULT_WORDS.join("\n")) : []), ...parseWordList(extra)].filter((e) => !ok.has(e.key) && !ok.has(e.core));
  const unique = [...new Map(entries.map((e) => [e.key, e])).values()];
  return {
    size: unique.length,
    find(text) {
      const f = fold(text).split(" ").filter((w) => !allowedWords.has(w)).join(" ");
      if (!f) return null;
      const vs = variants(f);
      for (const e of unique) {
        const needle = e.start && e.end ? e.core : e.start ? `${e.core} ` : e.end ? ` ${e.core}` : ` ${e.core} `;
        for (const v of vs) if (v.includes(needle)) return { raw: e.raw };
      }
      return null;
    },
  };
}

/* ───────────── Décision ───────────── */

/**
 * Modère un texte à lire. `options` : { maxChars, blockNumbers, matcher, viewer, prefixViewer, prefixOf(nom) → "Nom dit : ", anonymous }.
 * Rend { ok: true, text, viewer, changed } ou { ok: false, code: "empty" | "too_long" | "number" | "word", detail?, changed }.
 * Ne lève jamais.
 */
export function moderate(input, options = {}) {
  try {
    const maxChars = Math.min(MAX_CHARS.max, Math.max(MAX_CHARS.min, Math.trunc(Number(options.maxChars)) || MAX_CHARS.default));
    const matcher = options.matcher ?? buildMatcher();
    const { text, changed } = clean(input);
    const viewer = cleanName(options.viewer);
    if (!/[\p{L}\p{N}]/u.test(text)) return { ok: false, code: "empty", changed };
    if (len(text) > maxChars) return { ok: false, code: "too_long", changed };
    // Les numéros se cherchent AUSSI avant le retrait des adresses : « 06.12.34.56.78 » ressemble à une adresse réseau et ne doit pas s'y cacher.
    if (options.blockNumbers !== false && (hasNumber(text) || hasNumber(stripInvisible(cutChars(String(input ?? ""), RAW_MAX).normalize("NFKC"))))) return { ok: false, code: "number", changed };
    const hit = matcher.find(text);
    if (hit) return { ok: false, code: "word", detail: hit.raw, changed };
    let who = viewer;
    if (who && matcher.find(who)) who = "";
    if (who && options.blockNumbers !== false && hasNumber(who)) who = "";
    const shownName = who || String(options.anonymous ?? "");
    const prefix = options.prefixViewer && shownName && typeof options.prefixOf === "function" ? String(options.prefixOf(shownName) ?? "") : "";
    return { ok: true, text: `${prefix}${text}`, viewer: who, changed };
  } catch {
    return { ok: false, code: "empty", changed: [] };
  }
}
