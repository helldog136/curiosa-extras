// Mascotte — les règles pures : bornes, phrases, variables, pages. Aucun accès au stockage ni au réseau (testable seul).

/** Les bornes dures du module (tout ce qui arrive de plus est refusé ou ignoré). */
export const LIMITS = { phrases: 100, text: 140, name: 40, alt: 125, pages: 20, path: 100, link: 300, line: 260, hints: 10, items: 30 };
/** Réglages à valeur bornée : [minimum, maximum, défaut]. */
export const RANGES = { delay: [3, 60, 8], show: [4, 20, 8], max: [1, 10, 3] };
export const KINDS = ["hello", "tip", "news"];
export const STATES = ["published", "draft"];

/**
 * Les variables d'une phrase. Chaque variable a un nom français ET un nom anglais (les deux marchent dans toutes les langues) ; elle n'existe
 * que si sa source répond : une phrase qui en emploie une qui manque n'est simplement pas dite (jamais d'erreur, jamais de trou dans la phrase).
 *   site = nom du site · name = nom de la mascotte · event / date = prochain événement et sa date · live / liveTitle = direct en cours
 *   news = la dernière nouveauté publiée (article, vidéo… proposés au flux du site, moins de 3 semaines)
 */
export const VARIABLES = [
  { key: "site", names: ["nom_du_site", "site_name"] },
  { key: "name", names: ["nom", "name"] },
  { key: "event", names: ["prochain_evenement", "next_event"] },
  { key: "date", names: ["date_evenement", "event_date"] },
  { key: "live", names: ["en_direct", "live_now"] },
  { key: "liveTitle", names: ["titre_direct", "live_title"] },
  { key: "news", names: ["derniere_nouveaute", "latest_news"] },
];
/** Le nom d'une variable dans la langue de la personne (français pour « fr », anglais sinon), entre accolades : pour les exemples des textes d'aide. */
export const example = (locale, key) => `{${VARIABLES.find((x) => x.key === key).names[locale === "fr" ? 0 : 1]}}`;
const BY_NAME = new Map(VARIABLES.flatMap((v) => v.names.map((n) => [n, v.key])));
/** Quelle source il faut interroger pour répondre à chaque variable (les autres sont toujours connues). */
export const SOURCE_OF = { event: "event", date: "event", live: "live", liveTitle: "live", news: "latest" };

const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]", "g");
/** Une ligne de texte sans caractère de contrôle, espaces réduits, longueur bornée. */
export function oneLine(value, max) {
  return String(value ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
/** Un texte venu d'ailleurs (titre d'un événement…) : une ligne, sans accolades (elles sont réservées aux variables). */
export const outside = (value, max) => oneLine(String(value ?? "").replace(/[{}]/g, ""), max);

/** Variables employées par un texte : { keys: [clés connues], unknown: [noms inconnus], stray: accolade isolée ? }. */
export function variablesIn(text) {
  const keys = [], unknown = [];
  const rest = String(text ?? "").replace(/\{([^{}]{0,40})\}/g, (all, name) => {
    const key = BY_NAME.get(name);
    if (key) { if (!keys.includes(key)) keys.push(key); } else if (!unknown.includes(name)) unknown.push(name);
    return "";
  });
  return { keys, unknown, stray: /[{}]/.test(rest) };
}

/** Remplit les variables d'une phrase avec `facts` ({ site, name, event, date, live, liveTitle, news }). Renvoie null si une variable employée n'a pas de valeur. */
export function fillText(text, facts) {
  let missing = false;
  const out = String(text ?? "").replace(/\{([^{}]{0,40})\}/g, (all, name) => {
    const key = BY_NAME.get(name);
    const value = key ? facts?.[key] : undefined;
    if (value === undefined || value === null || value === "") { missing = true; return ""; }
    return String(value);
  });
  return missing ? null : oneLine(out, LIMITS.line + 40);
}

/** Pages : « /faq » (cette page), « /blog/* » (le blog et tout ce qu'il contient), « /jeu* » (tout ce qui commence par /jeu). Minuscules. */
const PAGE_RE = /^\/[a-z0-9_\-.~%/]{0,96}\*?$/;
export function parsePages(raw) {
  const parts = String(raw ?? "").split(/[\n,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const list = [], bad = [];
  for (const part of parts) {
    let p = part.replace(/^https?:\/\/[^/]+/, "");
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    if (!PAGE_RE.test(p) || p.length > LIMITS.path || p.includes("//") || p.includes("..") || /\*./.test(p)) { bad.push(part.slice(0, 40)); continue; }
    if (!list.includes(p)) list.push(p);
  }
  return { list: list.slice(0, LIMITS.pages), bad, tooMany: list.length > LIMITS.pages };
}

/**
 * Cette adresse (sans la langue, sans « ? » ni « # ») est-elle dans la liste ?
 * AUTONOME : sa source est aussi envoyée au navigateur, qui s'en sert pour décider sans rien demander au serveur.
 */
export function pathMatches(list, path) {
  var p = String(path || "/").toLowerCase();
  for (var i = 0; i < list.length; i++) {
    var x = list[i];
    if (x.slice(-2) === "/*") { var b = x.slice(0, -2); if (p === b || p.indexOf(b + "/") === 0) return true; }
    else if (x.slice(-1) === "*") { if (p.indexOf(x.slice(0, -1)) === 0) return true; }
    else if (p === x) return true;
  }
  return false;
}

/** L'adresse reçue du navigateur → un chemin propre (« /blog/article »), ou « / ». Jamais d'adresse complète, jamais plus de 200 caractères. */
export function cleanPath(raw) {
  let p = String(raw ?? "").slice(0, 200).split(/[?#]/)[0];
  if (!p.startsWith("/") || p.startsWith("//")) return "/";
  p = p.toLowerCase().replace(/[^a-z0-9_\-.~%/]/g, "");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

/** La mascotte doit-elle se montrer sur cette page ? where = all | home | some. */
export function placeAllows(where, pages, path) {
  if (where === "home") return path === "/";
  if (where === "some") return pathMatches(pages, path);
  return true;
}

export const num = (value, [min, max, fallback]) => {
  const n = value === null || value === undefined || value === "" || typeof value === "boolean" ? NaN : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

const BAD_LINK = new RegExp("[\\u0000-\\u0020\"'<>\\\\`]");
/** Une adresse de lien pour une phrase : https, ou une page du site (« /agenda »). Vide si elle ne convient pas. */
export function safeLink(value) {
  const s = String(value ?? "").trim();
  if (!s || s.length > LIMITS.link || BAD_LINK.test(s)) return "";
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  try { const u = new URL(s); return u.protocol === "https:" && !u.username && !u.password ? u.href : ""; } catch { return ""; }
}
/** Une image de mascotte : un fichier envoyé sur le site (avec son éventuel cadrage) ou une adresse https. */
export function safeImage(value) {
  const s = String(value ?? "").trim();
  if (/^\/uploads\/[0-9a-f-]{36}\.(?:png|jpe?g|webp|gif)(?:\?c=[0-9a-z._-]{1,60}(?:&s=1)?)?$/.test(s)) return s;
  return s.startsWith("https://") ? safeLink(s) : "";
}

/**
 * Vérifie une phrase écrite par la personne. → { value } ou { errors: { champ: [clé de message, variables] } }.
 * `locales` : les langues du site. Rien n'est jamais « corrigé en silence » : on dit quoi changer.
 */
export function checkPhrase(raw, { locales = [], locale = "en" } = {}) {
  const errors = {};
  const text = oneLine(raw?.text, 2000);
  if (!text) errors.text = ["errTextEmpty"];
  else if ([...text].length > LIMITS.text) errors.text = ["errTextLong", { max: LIMITS.text, n: [...text].length }];
  else {
    const v = variablesIn(text);
    if (v.unknown.length) errors.text = ["errVariable", { name: `{${v.unknown[0]}}`, list: VARIABLES.map((x) => `{${x.names[locale === "fr" ? 0 : 1]}}`).join(" ") }];
    else if (v.stray) errors.text = ["errBraces", { ex1: example(locale, "site") }];
  }
  const kind = KINDS.includes(raw?.kind) ? raw.kind : "hello";
  const lang = String(raw?.lang ?? "");
  if (lang !== "" && !locales.includes(lang)) errors.lang = ["errLang"];
  const pages = parsePages(raw?.pages);
  if (pages.bad.length) errors.pages = ["errPages", { bad: pages.bad[0] }];
  else if (pages.tooMany) errors.pages = ["errPagesMany", { max: LIMITS.pages }];
  const linkRaw = String(raw?.link ?? "").trim();
  const link = safeLink(linkRaw);
  if (linkRaw && !link) errors.link = ["errLink"];
  if (Object.keys(errors).length) return { errors };
  return { value: { kind, lang, text, pages: pages.list, link, state: raw?.state === "draft" ? "draft" : "published" } };
}

/** Une petite empreinte de texte (FNV-1a, 8 caractères) : change quand le texte change ; ne protège rien. */
export function hash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/** Cellule de tableur sûre (guillemets doublés, formules neutralisées). */
export const cell = (value) => {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
