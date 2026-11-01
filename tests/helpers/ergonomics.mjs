// ERGONOMIE DES PAGES D'ADMINISTRATION : les contrôles AUTOMATIQUES des règles « [auto] » de docs/ERGONOMIE-ADMIN.md.
// Fichier AUTONOME (aucun import hors node:assert) : le dépôt des modules en garde une COPIE (tests/helpers/ergonomics.mjs) pour ne dépendre d'aucune version du cœur.
// Une seule source : toute modification se fait ici, puis se recopie à l'identique (un test du dépôt des modules compare les deux quand le cœur a le fichier).
//
// Deux familles de contrôles :
//   1. STATIQUES — `analyzeModule({ id, manifest, locales })` lit le MANIFESTE (module.json) et les LOCALES (locales/*.json), jamais le code.
//      Règles : R5 (réglages par onglet), R9 (mots interdits), R10 (libellés), R11 (aides et exemples), R13 (ton), R17 (« Activer / désactiver »), R19 (bon contrôle), R29 (parité FR/EN).
//   2. PAGES produites par du code — `assertAdminPageErgonomics(blocks, { errors })` lit les blocs d'un panneau d'administration (faux contexte du kit).
//      Règles : R3 (verbe du bouton), R4 (champs visibles), R9/R10 (textes des champs), R14 (étiquette répétée), R15 (recherche), R17, R22 (erreurs avec exemple).
//
// Le CLIQUET (ratchet) : `compareToBaseline(gaps, known)` sépare les écarts TOLÉRÉS (listés dans la base), les NOUVEAUX (échec) et les DISPARUS (la base doit rétrécir).
import { AssertionError } from "node:assert";

/* ═══════════════════════════ Listes modifiables ═══════════════════════════ */

/** R9 — mots que la personne ne doit pas lire (hors réglages `advanced`). Un mot par entrée ; casse et accents ignorés ; mot entier. À modifier ICI. */
export const FORBIDDEN_WORDS = [
  // français
  "clé", "clés", "clef", "clefs", "slug", "slugs", "instance", "instances", "topic", "topics", "sujet", "sujets", "token", "tokens", "jeton", "jetons",
  "webhook", "webhooks", "eventsub", "route", "routes", "service", "services", "identifiant", "identifiants", "payload", "api", "json", "cache", "hash", "sse", "oauth",
  // anglais (les mots communs aux deux langues sont déjà ci-dessus)
  "key", "keys", "identifier", "identifiers",
];

/**
 * R9 — LISTE BLANCHE JUSTIFIÉE. Une entrée = un cas où le mot est le bon mot (un tiers l'impose, ou ce n'est pas le sens technique). Chaque entrée DIT POURQUOI.
 *   term    le mot autorisé (en minuscules) ; `text` (facultatif) : une expression régulière que le texte entier doit vérifier ; `module` (facultatif) : l'id du module.
 * Une entrée n'est pas une dette : elle ne figure pas dans la base du cliquet. Pour une dette, utilisez la base (`tests/ergonomics-baseline.json`).
 */
export const JARGON_WHITELIST = [
  { term: "sujet", text: /\bsujet (?:du|de votre|de l['’]|d['’])\s*(?:message|e-?mail|courriel|mail)|\bemail subject\b/i, why: "« sujet » d'un e-mail est le mot courant (pas le « sujet » technique du cœur)" },
  { term: "service", text: /\bservice (?:client|public|de messagerie|de streaming|de vidéo)\b|\bcustomer service\b/i, why: "« service client » est une expression ordinaire, pas le « service » technique d'un module" },
];

/** R13 — sigles en capitales autorisés (au-delà de 3 lettres, un mot en capitales est un cri). */
export const ALLOWED_CAPS = ["HTML", "JSON", "HTTP", "HTTPS", "OAUTH", "EVENTSUB", "YAML", "ICAL", "IMAP", "SMTP", "JPEG", "WEBP", "HEIC", "NSFW", "CORS", "RGBA", "HSLA", "OBS", "UTF"];

/** R11 — taille maximale d'une aide visible sous le champ (la même que `HELP_INLINE_MAX` du cœur, src/components/admin/helpRule.ts). Au-delà : bulle « ? » du cœur. */
export const HELP_INLINE_MAX = 60;
/** R10 — taille maximale d'un libellé. */
export const LABEL_MAX = 60;
/** R5 — réglages simples au plus par onglet. */
export const SETTINGS_PER_TAB_MAX = 7;
/** R13 — mots au plus par phrase. */
export const SENTENCE_MAX_WORDS = 20;
/** R4 / R15 — budgets des pages. */
export const FORM_FIELDS_MAX = 5;
export const SECTION_FIELDS_MAX = 7;
export const SEARCH_FROM_ROWS = 10;
export const UNIFORM_COLUMN_FROM_ROWS = 5;

export const RULES = {
  R3: "Un verbe précis sur le bouton principal",
  R4: "Au plus 5 champs visibles par formulaire (7 par section)",
  R5: "Au plus 7 réglages simples par onglet",
  R9: "Les mots de la personne, pas ceux du code",
  R10: "Libellés courts, sans deux-points",
  R11: "Aides courtes, avec un exemple",
  R13: "Ton neutre, vouvoiement, sans cri",
  R14: "Pas d'étiquette identique sur toutes les lignes",
  R15: "Une recherche pour toute liste qui peut grandir",
  R17: "Un interrupteur montre l'état (pas « Activer / désactiver »)",
  R19: "Le bon contrôle",
  R22: "Erreur avec ce qu'il faut faire et un exemple",
  R29: "FR et EN à parité",
};

/* ═══════════════════════════ Outils de texte ═══════════════════════════ */

const LETTER = "\\p{L}\\p{N}_";
const word = (s) => new RegExp(`(?<![${LETTER}])(?:${s})(?![${LETTER}])`, "iu");
const len = (s) => Array.from(String(s)).length;
const plain = (s) => String(s).replace(/\{[^{}]*\}/g, " ").replace(/<[^>]*>/g, " ");
const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Condensé court et stable d'un texte (FNV-1a 32 bits, 6 caractères hexadécimaux) : identité d'un écart « texte ». */
export function shortHash(text) {
  let h = 0x811c9dc5;
  for (const c of String(text)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0").slice(0, 6);
}
const excerpt = (s, n = 70) => { const t = String(s).replace(/\s+/g, " ").trim(); return len(t) > n ? `${Array.from(t).slice(0, n - 1).join("")}…` : t; };
/** Les {variables} d'un texte : seulement les noms simples (« {date} »), pas les exemples de saisie (« {aleatoire oui | non} »). */
const variables = (s) => [...new Set([...String(s).matchAll(/\{([\p{L}\p{N}_.:-]+)\}/gu)].map((m) => m[1]))].sort();

const FORBIDDEN_RE = new RegExp(`(?<![${LETTER}])(${FORBIDDEN_WORDS.map((w) => w.normalize("NFC").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![${LETTER}])`, "giu");
const NEUTRAL_OK = /\b(?:for instance|par instance)\b/gi;

/** Mots interdits (R9) d'un texte, hors liste blanche. */
export function forbiddenWords(text, moduleId) {
  const body = plain(text).replace(NEUTRAL_OK, " ");
  const found = new Set();
  for (const m of body.matchAll(FORBIDDEN_RE)) {
    const term = m[1].toLowerCase();
    const allowed = JARGON_WHITELIST.some((w) => w.term === term && (!w.module || w.module === moduleId) && (!w.text || w.text.test(String(text))));
    if (!allowed) found.add(term);
  }
  return [...found];
}

const EXAMPLE_WORD = /(?:par exemple|exemple|\bex\.|\bex\s?:|\be\.g\.|for example|for instance|example)/i;
const EXAMPLE_VALUE = /«[^»]+»|“[^”]+”|"[^"]+"|`[^`]+`|https?:\/\/|\bwww\.|(?<![\p{L}\p{N}])[@#][\p{L}\p{N}_]+/u;
/** L'aide donne-t-elle un exemple concret ? (mot d'exemple, valeur entre guillemets ou en code, adresse, pseudo ; un nombre suffit pour un champ numérique) */
export function hasExample(text, type) {
  const t = String(text ?? "");
  return EXAMPLE_WORD.test(t) || EXAMPLE_VALUE.test(t) || (type === "number" && /\d/.test(t));
}

const BAD_TRAILING_COLON = /[:：]\s*$/;
/** Problèmes d'un libellé (R10). */
export function labelProblems(label) {
  const t = String(label).trim();
  const out = [];
  if (len(t) > LABEL_MAX) out.push(`${len(t)} caractères (${LABEL_MAX} au plus)`);
  if (BAD_TRAILING_COLON.test(t)) out.push("se termine par « : »");
  for (const m of t.matchAll(/\(([^()]{21,})\)/g)) out.push(`parenthèse de précision à rallonge « (${excerpt(m[1], 30)} »`);
  return out;
}

/** Phrases d'un texte (R13), sans accolades ni balises. */
function sentences(text) {
  return plain(text).split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}
const wordCount = (s) => (String(s).match(/[\p{L}\p{N}][\p{L}\p{N}'’\-/]*/gu) ?? []).length;

/** Problèmes de ton (R13) d'un texte visible. */
export function toneProblems(text, lang = "*") {
  const t = String(text);
  const body = plain(t).replace(/\b[\p{Lu}]{3,}\.(?:md|json|txt|csv|html|ics|pdf)\b/gu, " "); // « SKILL.md », « README.md » : des noms de fichiers
  const out = [];
  if (/!(?![\p{L}\p{N}_])/u.test(body.replace(/<!--[\s\S]*?-->/g, ""))) out.push("contient un point d'exclamation");
  if (/\bveuillez\b/i.test(body)) out.push("contient « Veuillez »");
  const caps = [...body.matchAll(/(?<![\p{L}\p{N}_])([A-ZÀ-ÖØ-Þ]{4,})(?![\p{L}\p{N}_])/gu)].map((m) => m[1]).filter((w) => !ALLOWED_CAPS.includes(w));
  if (caps.length) out.push(`MAJUSCULES « ${[...new Set(caps)].join(" ")} »`);
  if (lang !== "en" && (/(?<![\p{L}\p{N}_])(?:tu|toi|ton|ta|tes|te)(?![\p{L}\p{N}_])/iu.test(body.replace(/[A-Za-z]+-(?:tu|te)\b/g, " ")) || /(?<![\p{L}\p{N}_])t['’]\p{L}/iu.test(body))) out.push("tutoiement (le vouvoiement est la règle)");
  const long = sentences(t).find((s) => wordCount(s) > SENTENCE_MAX_WORDS);
  if (long) out.push(`phrase de ${wordCount(long)} mots (${SENTENCE_MAX_WORDS} au plus) : « ${excerpt(long, 40)} »`);
  if (lang !== "en" && (/[\p{L}]·[\p{L}]/u.test(body) || /[éèiuntlrsfcdv]\((?:e|es|ne|le|ve|trice|rice|euse|ère|se)\)/iu.test(body))) out.push("écriture qui suppose un genre (point médian ou « (e) »)");
  return out;
}

const TOGGLE_RE = /activer\s*(?:[/\\|–—-]|ou)\s*d[ée]sactiver|d[ée]sactiver\s*(?:[/\\|–—-]|ou)\s*activer|enable\s*(?:[/\\|–—-]|or)\s*disable|disable\s*(?:[/\\|–—-]|or)\s*enable|\btoggle\b/i;
const NEGATIVE_LABEL = /^\s*(?:ne\s+(?:pas|plus|jamais)\b|do\s+not\b|don['’]t\b|never\b)/i;
const YES_NO = new Set(["true", "false", "yes", "no", "oui", "non", "on", "off", "0", "1", "enabled", "disabled", "activé", "désactivé", "active", "inactive"].map(fold));
const MESSAGE_ERROR_CODES = /\b(?:erreur|error)\s*(?:code\s*)?[45]\d\d\b|\b(?:http|status)\s*[45]\d\d\b|\bECONN\w+|\bENOTFOUND\b|\bundefined\b|\[object Object\]|\bat \S+:\d+:\d+|\bstack\b|\btraceback\b/i;
const ERROR_CLASS = /\b[A-Z][A-Za-z]*Error\b/;

/* ═══════════════════════════ Collecte des textes d'un module ═══════════════════════════ */

const LANGS = ["fr", "en"];
/** Textes d'un champ localisé : « texte » (valable pour toutes les langues) ou { fr, en }. */
function localized(value) {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return [{ lang: "*", text: value }];
  if (typeof value === "object") return Object.entries(value).filter(([, v]) => typeof v === "string").map(([lang, text]) => ({ lang, text }));
  return [];
}

/**
 * Tous les textes que lit une personne, d'après le manifeste.
 * kind : « label » (libellé court), « help » (aide sous un champ), « text » (phrase libre : description…), « option » (choix d'une liste).
 */
function manifestTexts(man) {
  const out = [];
  const add = (where, kind, value, extra = {}) => { for (const t of localized(value)) out.push({ where, kind, ...t, ...extra }); };
  add("name", "label", man.name);
  add("description", "text", man.description);
  for (const t of man.tabs ?? []) add(`tab:${t.id}.label`, "label", t.label);
  for (const s of man.sections ?? []) {
    add(`section:${s.id}.label`, "label", s.label);
    for (const f of s.options ?? []) settingTexts(`section:${s.id}.${f.key}`, f, add);
  }
  for (const f of man.settings ?? []) settingTexts(`setting:${f.key}`, f, add);
  for (const g of man.optionalGroups ?? []) { add(`group:${g.id}.label`, "label", g.label); add(`group:${g.id}.addLabel`, "label", g.addLabel); add(`group:${g.id}.removeLabel`, "label", g.removeLabel); }
  for (const r of man.rights ?? []) { add(`right:${r.id}.label`, "label", r.label); add(`right:${r.id}.help`, "text", r.help); }
  for (const p of man.entryPanels ?? []) { add(`entryPanel:${p.id}.title`, "label", p.title); add(`entryPanel:${p.id}.help`, "text", p.help); }
  for (const e of man.overlayElements ?? []) { add(`overlayElement:${e.id}.label`, "label", e.label); add(`overlayElement:${e.id}.description`, "text", e.description); }
  return out;
}
function settingTexts(where, f, add) {
  const advanced = f.advanced === true;
  add(`${where}.label`, "label", f.label, { advanced, setting: f });
  add(`${where}.help`, "help", f.help, { advanced, setting: f });
  for (const o of f.options ?? []) add(`${where}.option:${o.value}`, "option", o.label, { advanced });
}

/** Messages des fichiers de langue : { "chemin.de.la.clé": "texte" } (les valeurs qui ne sont pas du texte sont ignorées). */
function flattenLocale(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[p] = v;
    else if (v && typeof v === "object" && !Array.isArray(v)) flattenLocale(v, p, out);
    else if (Array.isArray(v)) v.forEach((x, i) => { if (typeof x === "string") out[`${p}[${i}]`] = x; });
  }
  return out;
}

/* ═══════════════════════════ Analyse statique ═══════════════════════════ */

const FREE_TYPES = new Set(["text", "textarea", "url", "number"]);
const hasVisibleDefault = (f) => f.default !== undefined && f.default !== "" && !/^(?:site|theme):/.test(String(f.default));

/**
 * Les écarts d'un module d'après son manifeste et ses locales.
 * @param {{ id?: string, manifest: object, locales?: Record<string, object> }} m
 * @returns {{ rule: string, key: string, where: string, text: string, message: string }[]} `key` : identité STABLE de l'écart (règle, endroit, condensé du texte)
 */
export function analyzeModule(m) {
  const man = m.manifest ?? {};
  const id = m.id ?? man.id;
  const gaps = [];
  const seen = new Set();
  const push = (rule, where, text, message, { identity = "hash", key: forced } = {}) => {
    const key = forced ?? (identity === "hash" ? `${rule} ${where} #${shortHash(text)}` : `${rule} ${where}`);
    if (seen.has(key)) return;
    seen.add(key);
    gaps.push({ rule, key, where, text: excerpt(text, 90), message });
  };

  /* R5 — réglages simples par onglet (les champs d'un groupe facultatif, repliés, et les réglages avancés ne comptent pas). */
  const folded = new Set((man.optionalGroups ?? []).flatMap((g) => g.fields ?? []));
  const perTab = new Map();
  for (const f of man.settings ?? []) {
    if (f.advanced === true || folded.has(f.key)) continue;
    const tab = `${f.tab ?? "settings"}${f.group === "appearance" ? "/apparence" : ""}`;
    perTab.set(tab, [...(perTab.get(tab) ?? []), f.key]);
  }
  for (const [tab, keys] of perTab) if (keys.length > SETTINGS_PER_TAB_MAX) push("R5", `tab:${tab}`, `${keys.length}`, `l'onglet « ${tab} » montre ${keys.length} réglages simples (${SETTINGS_PER_TAB_MAX} au plus) : choisir des valeurs par défaut, regrouper ou passer en avancé`, { key: `R5 tab:${tab} (${keys.length})` });

  /* Textes du manifeste : R9, R10, R11, R13, R17, R19, R29. */
  const texts = manifestTexts(man);
  const byWhere = new Map();
  for (const t of texts) byWhere.set(t.where, [...(byWhere.get(t.where) ?? []), t]);
  for (const t of texts) {
    const lang = t.lang === "*" ? "fr" : t.lang;
    if (!t.advanced) {
      const bad = forbiddenWords(t.text, id);
      if (bad.length) push("R9", `${t.where}[${t.lang}]`, t.text, `mot${bad.length > 1 ? "s" : ""} interdit${bad.length > 1 ? "s" : ""} « ${bad.join("», « ")} » (${lang.toUpperCase()}) : « ${excerpt(t.text, 60)} »`);
      if (t.kind !== "text" && /\{[^{}]+\}/.test(t.text)) push("R9", `${t.where}[${t.lang}]`, t.text, `{accolades} visibles hors mode avancé (à expliquer ou à retirer) : « ${excerpt(t.text, 60)} »`);
    }
    if (t.kind === "label" || t.kind === "option") for (const p of labelProblems(t.text)) push("R10", `${t.where}[${t.lang}]`, t.text, `libellé : ${p} : « ${excerpt(t.text, 60)} »`);
    for (const p of toneProblems(t.text, t.lang)) push("R13", `${t.where}[${t.lang}]`, t.text, `${p} (${lang.toUpperCase()}) : « ${excerpt(t.text, 60)} »`);
    if (TOGGLE_RE.test(t.text)) push("R17", `${t.where}[${t.lang}]`, t.text, `« Activer / désactiver » : un interrupteur montre l'état : « ${excerpt(t.text, 60)} »`);
    if (t.kind === "label" && t.setting?.type === "boolean" && NEGATIVE_LABEL.test(t.text)) push("R19", `${t.where}[${t.lang}]`, t.text, `case négative (« Ne pas… ») : écrire ce qu'on veut qui se passe : « ${excerpt(t.text, 60)} »`);
    if (t.kind === "help") {
      const f = t.setting;
      const label = (byWhere.get(t.where.replace(/\.help$/, ".label")) ?? []).find((l) => l.lang === t.lang)?.text;
      if (label && len(fold(label)) >= 8 && fold(t.text).replace(/[^a-z0-9]+/g, " ").trim().startsWith(fold(label).replace(/[^a-z0-9]+/g, " ").trim()) && len(t.text) <= len(label) + 12) push("R11", `${t.where}[${t.lang}]`, t.text, `l'aide répète le libellé : « ${excerpt(t.text, 60)} »`);
      if (f && !f.advanced && FREE_TYPES.has(f.type) && !hasVisibleDefault(f) && !hasExample(t.text, f.type)) push("R11", `${t.where}[${t.lang}]`, t.text, `champ libre sans exemple (« Par exemple : … ») (${lang.toUpperCase()}) : « ${excerpt(t.text, 60)} »`);
    }
  }
  /* R11 — champ libre sans aucune aide : aucun exemple (sauf valeur par défaut visible). */
  for (const [scope, fields] of [["setting", man.settings ?? []], ...(man.sections ?? []).map((s) => [`section:${s.id}`, s.options ?? []])]) {
    for (const f of fields) {
      if (f.advanced === true || !FREE_TYPES.has(f.type) || hasVisibleDefault(f)) continue;
      const where = scope === "setting" ? `setting:${f.key}` : `${scope}.${f.key}`;
      const helps = LANGS.filter((l) => localized(f.help).some((x) => (x.lang === l || x.lang === "*") && x.text.trim()));
      if (!helps.length) push("R11", `${where}.help`, f.key, `champ libre « ${f.key} » sans aide ni exemple (ni valeur par défaut visible)`, { identity: "count" });
    }
  }
  /* R11 info : combien d'aides passeront en bulle (pas un écart). Voir `bubbleCount`. */

  /* R19 — liste oui/non pour un booléen. */
  for (const f of [...(man.settings ?? []), ...(man.sections ?? []).flatMap((s) => s.options ?? [])]) {
    if (f.type !== "select" || !Array.isArray(f.options) || f.options.length !== 2) continue;
    const forms = f.options.map((o) => [fold(String(o.value)), ...localized(o.label).map((l) => fold(l.text))]);
    if (forms.every((fs) => fs.some((x) => YES_NO.has(x)))) push("R19", `setting:${f.key}`, f.key, `la liste « ${f.key} » n'a que deux choix oui/non : une case ou un interrupteur (type « boolean »)`, { identity: "count" });
  }

  /* R29 — parité FR/EN du manifeste (texte localisé auquel il manque une langue, ou {variables} différentes). */
  for (const [where, list] of byWhere) {
    const obj = list.filter((x) => x.lang !== "*");
    if (!obj.length) continue;
    const have = new Set(obj.map((x) => x.lang));
    for (const l of LANGS) if (!have.has(l) || !obj.find((x) => x.lang === l).text.trim()) push("R29", `${where}[${l}]`, "", `texte ${l === "fr" ? "français" : "anglais"} manquant`, { identity: "count" });
    const fr = obj.find((x) => x.lang === "fr"), en = obj.find((x) => x.lang === "en");
    if (fr && en && variables(fr.text).join() !== variables(en.text).join()) push("R29", `${where}[vars]`, `${fr.text}|${en.text}`, `{variables} différentes : FR {${variables(fr.text).join("} {")}} / EN {${variables(en.text).join("} {")}}`);
  }

  /* Locales : R9 (hors réglages avancés, inconnus ici : la liste blanche et la base s'en chargent), R13, R17, R10 (deux-points final), R29. */
  const flat = Object.fromEntries(Object.entries(m.locales ?? {}).map(([lang, obj]) => [lang, flattenLocale(obj)]));
  for (const [lang, msgs] of Object.entries(flat)) {
    for (const [k, text] of Object.entries(msgs)) {
      const where = `locale:${lang}:${k}`;
      const bad = forbiddenWords(text, id);
      if (bad.length) push("R9", where, text, `mot${bad.length > 1 ? "s" : ""} interdit${bad.length > 1 ? "s" : ""} « ${bad.join("», « ")} » : « ${excerpt(text, 60)} »`);
      for (const p of toneProblems(text, lang)) push("R13", where, text, `${p} : « ${excerpt(text, 60)} »`);
      if (TOGGLE_RE.test(text)) push("R17", where, text, `« Activer / désactiver » : un interrupteur montre l'état : « ${excerpt(text, 60)} »`);
      if (len(text.trim()) <= LABEL_MAX && BAD_TRAILING_COLON.test(text.trim())) push("R10", where, text, `libellé qui se termine par « : » : « ${excerpt(text, 60)} »`);
    }
  }
  if (flat.fr || flat.en) {
    const fr = flat.fr ?? {}, en = flat.en ?? {};
    for (const k of Object.keys(fr)) if (!(k in en)) push("R29", `locale:en:${k}`, "", `clé « ${k} » présente en FR, absente en EN`, { identity: "count" });
    for (const k of Object.keys(en)) if (!(k in fr)) push("R29", `locale:fr:${k}`, "", `clé « ${k} » présente en EN, absente en FR`, { identity: "count" });
    for (const k of Object.keys(fr)) if (k in en && variables(fr[k]).join() !== variables(en[k]).join()) push("R29", `locale:vars:${k}`, `${fr[k]}|${en[k]}`, `clé « ${k} » : {variables} FR {${variables(fr[k]).join("} {")}} / EN {${variables(en[k]).join("} {")}}`);
  }
  return gaps.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Nombre d'aides plus longues que HELP_INLINE_MAX (elles passent dans la bulle « ? » du cœur ≥ 0.5.0 : information, pas un écart). */
export function bubbleCount(m) {
  return manifestTexts(m.manifest ?? {}).filter((t) => t.kind === "help" && (len(t.text.trim()) > HELP_INLINE_MAX || /[\r\n]/.test(t.text))).length;
}

/* ═══════════════════════════ Le cliquet (ratchet) ═══════════════════════════ */

/**
 * Compare les écarts constatés à la base.
 * @param {{ key: string }[]} gaps écarts constatés
 * @param {string[]} known clés listées dans la base pour ce module
 * @returns {{ tolerated: object[], fresh: object[], stale: string[] }} tolérés (avertissement) · nouveaux (échec) · disparus (la base doit rétrécir : échec)
 */
export function compareToBaseline(gaps, known) {
  const knownSet = new Set(known ?? []);
  const now = new Set(gaps.map((g) => g.key));
  return {
    tolerated: gaps.filter((g) => knownSet.has(g.key)),
    fresh: gaps.filter((g) => !knownSet.has(g.key)),
    stale: [...knownSet].filter((k) => !now.has(k)).sort(),
  };
}

/** Lit la base (objet déjà lu) : { version, modules: { id: [clés] } }. Renvoie null si elle est absente ou illisible. */
export function parseBaseline(value) {
  if (!value || typeof value !== "object" || typeof value.modules !== "object" || value.modules === null) return null;
  return value;
}

/**
 * La base ne peut que RÉTRÉCIR : les clés de `next` qui n'étaient pas dans `previous` (par module). Un module absent de `previous` n'avait aucun écart toléré :
 * toutes ses clés sont une croissance. Renvoie [] quand la base n'a fait que rétrécir.
 */
export function baselineGrowth(previous, next) {
  const before = previous?.modules ?? {};
  const out = [];
  for (const [id, keys] of Object.entries(next?.modules ?? {})) {
    const old = new Set(before[id] ?? []);
    for (const k of keys) if (!old.has(k)) out.push(`${id} : ${k}`);
  }
  return out;
}

/** Nombre d'écarts par règle : { R9: 3, R10: 1 }. */
export function countByRule(gaps) {
  const out = {};
  for (const g of gaps) out[g.rule] = (out[g.rule] ?? 0) + 1;
  return out;
}

/** Texte des messages d'échec / d'avertissement (partagé par l'exigence du kit et les tests des modules). */
export function ratchetMessages({ fresh, stale }) {
  return [
    ...fresh.map((g) => `NOUVEL écart ${g.rule} (${g.where}) : ${g.message} — à corriger (la base ne s'allonge pas)`),
    ...stale.map((k) => `l'écart « ${k} » a disparu : retirez cette ligne de la base (node scripts/ergonomics-baseline.mjs --write)`),
  ];
}

/* ═══════════════════════════ Pages produites par du code ═══════════════════════════ */

const stripTags = (s) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const SEARCH_FIELD_NAME = /^(?:q|s|search|recherche|rechercher|filter|filtre|query|find)$/i;
const SEARCH_LABEL = /\b(?:rechercher?|search|filtrer|filter)\b/i;
const SEARCH_HTML = /type\s*=\s*["']?search|role\s*=\s*["']?search|data-(?:search|filter|live-search)|\bsearchable\b/i;
const WEAK_BUTTONS = /^\s*(?:ok|valider|validate|soumettre|submit|envoyer|send|enregistrer|save|appliquer|apply)\s*$/i;
const hiddenKind = (f) => f?.kind === "hidden";
const folded_ = (f) => f?.advanced === true || f?.folded === true || f?.collapsed === true;

function hasSearch(blocks) {
  return blocks.some((b) => b && ((b.type === "html" && SEARCH_HTML.test(b.html ?? "")) || (b.type === "table" && (b.searchable === true || b.search === true)) || (b.type === "adminForm" && (b.fields ?? []).some((f) => !hiddenKind(f) && (SEARCH_FIELD_NAME.test(f.name ?? "") || SEARCH_LABEL.test(f.label ?? ""))))));
}

/** Problèmes d'un message d'erreur (R22) : un exemple, pas de code ni de trace. */
export function errorMessageProblems(message) {
  const t = String(message ?? "").trim();
  const out = [];
  if (!t) return ["message vide"];
  if (MESSAGE_ERROR_CODES.test(t) || ERROR_CLASS.test(t) || /\bNaN\b/.test(t)) out.push("contient un code, une trace ou « erreur 500 »");
  if (!hasExample(t, "number") && !EXAMPLE_VALUE.test(t)) out.push("sans exemple (« … par exemple 500 »)");
  return out;
}

/**
 * Problèmes d'ergonomie mesurables sur les blocs d'un panneau d'administration. Ne lève jamais.
 * @param {object[]} blocks blocs produits par `adminPanel` (ou par un formulaire) avec le faux contexte du kit
 * @param {{ errors?: string[], skip?: string[] }} [opts] `errors` : messages d'erreur que la page peut afficher (R22) ; `skip` : règles à ne pas contrôler (par exemple ["R15"], avec la raison dans votre test)
 * @returns {{ rule: string, message: string }[]}
 */
export function adminPageErgonomicsProblems(blocks, opts = {}) {
  const list = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
  const out = [];
  const add = (rule, message) => { if (!opts.skip?.includes(rule)) out.push({ rule, message }); };
  let sectionFields = 0, sectionTitle = "(début de page)";
  const closeSection = () => { if (sectionFields > SECTION_FIELDS_MAX) add("R4", `la section « ${sectionTitle} » montre ${sectionFields} champs (${SECTION_FIELDS_MAX} au plus) : replier ou découper en onglets`); sectionFields = 0; };
  for (const b of list) {
    if (b.type === "heading") { closeSection(); sectionTitle = stripTags(b.text); continue; }
    if (b.type === "adminForm") {
      const shown = (b.fields ?? []).filter((f) => !hiddenKind(f) && !folded_(f));
      sectionFields += shown.length;
      const name = b.title ? `« ${b.title} »` : `(action « ${b.action} »)`;
      if (shown.length > FORM_FIELDS_MAX) add("R4", `le formulaire ${name} montre ${shown.length} champs (${FORM_FIELDS_MAX} au plus) : replier ou découper`);
      if (WEAK_BUTTONS.test(b.submitLabel ?? "")) add("R3", `le formulaire ${name} a un bouton « ${b.submitLabel} » : écrire un verbe précis (« Ajouter la personne »)`);
      if (TOGGLE_RE.test(b.submitLabel ?? "")) add("R17", `le bouton « ${b.submitLabel} » : un interrupteur montre l'état`);
      for (const f of shown) {
        for (const p of labelProblems(f.label ?? "")) add("R10", `champ « ${f.name} » : ${p}`);
        const bad = forbiddenWords(`${f.label ?? ""} ${f.help ?? ""}`);
        if (bad.length) add("R9", `champ « ${f.name} » : mot interdit « ${bad.join("», « ")} »`);
        if (FREE_TYPES.has(f.kind ?? "text") && f.help !== undefined && !hasExample(f.help, f.kind)) add("R11", `champ « ${f.name} » : aide sans exemple`);
      }
    } else if (b.type === "table") {
      const rows = b.rows ?? [], cols = b.columns ?? [];
      if (rows.length > SEARCH_FROM_ROWS && !hasSearch(list)) add("R15", `la liste « ${cols.join(" · ") || "tableau"} » a ${rows.length} lignes (plus de ${SEARCH_FROM_ROWS}) et aucun champ « Rechercher » au-dessus`);
      if (rows.length > UNIFORM_COLUMN_FROM_ROWS) {
        for (let c = 0; c < Math.max(cols.length, ...rows.map((r) => r.length)); c++) {
          const cells = rows.map((r) => stripTags(r[c]));
          if (cells[0] && !/^[-–—·]+$/.test(cells[0]) && cells.every((x) => x === cells[0])) add("R14", `la colonne « ${cols[c] ?? c + 1} » affiche « ${excerpt(cells[0], 30)} » sur toutes les ${rows.length} lignes : c'est un titre, pas une étiquette`);
        }
      }
      for (const a of b.rowActions ?? []) if (TOGGLE_RE.test(a.label ?? "")) add("R17", `le bouton de ligne « ${a.label} » : un interrupteur montre l'état courant`);
    } else if (b.type === "links") {
      for (const l of b.items ?? []) if (TOGGLE_RE.test(l.label ?? "")) add("R17", `le lien « ${l.label} » : un interrupteur montre l'état`);
    }
  }
  closeSection();
  for (const e of opts.errors ?? []) for (const p of errorMessageProblems(e)) add("R22", `erreur « ${excerpt(e, 50)} » : ${p}`);
  return out;
}

/**
 * Vérifie ce qui se mesure sur les blocs d'une page d'administration (R3, R4, R9, R10, R11, R14, R15, R17, R22) et lève une AssertionError claire sinon.
 * À appeler dans les tests d'un module, avec le faux contexte du kit :
 *
 *   const blocks = await def.adminPanel(fakeCtx({ ... }), { query: {} });
 *   assertAdminPageErgonomics(blocks, { errors: ["Écrivez un nombre entier, par exemple 500"] });
 */
export function assertAdminPageErgonomics(blocks, opts = {}) {
  const problems = adminPageErgonomicsProblems(blocks, opts);
  if (problems.length) throw new AssertionError({ message: `Ergonomie de la page d'administration (docs/ERGONOMIE-ADMIN.md) :\n${problems.map((p) => `• ${p.rule} — ${p.message}`).join("\n")}`, actual: problems.map((p) => `${p.rule} ${p.message}`), expected: [] });
}
