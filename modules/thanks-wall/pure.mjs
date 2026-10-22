// Mur des remerciements — les petites fonctions sans effet de bord : nettoyage de texte, noms montrés, photos permises, mois.
// Rien ici ne parle à Contacts ni au stockage : tout est testable seul.

/** Bornes du module (documentées dans le README et dans docs/ideas/thanks-wall.md). */
export const LIMITS = {
  groups: 6,            // groupes de personnes sur le mur
  perGroup: 1000,       // fiches lues par groupe (2 pages de 500 chez Contacts) ; au-delà : « truncated »
  perPage: 50,          // cartes par page à l'écran (page d'un groupe)
  previewDefault: 12,   // cartes par groupe sur la page principale
  previewMax: 48,
  message: 160,         // longueur d'un message court
  why: 300,             // longueur du mot de la mise à l'honneur
  messages: 1000,       // messages gardés au total
  honors: 24,           // mises à l'honneur gardées (passées et prévues)
  adminPage: 25,        // lignes par page dans l'administration
  search: 10,           // résultats de la recherche d'une personne
  id: 80,               // longueur d'un identifiant de fiche
};

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Texte d'une personne ou de Contacts → une ligne propre (sans caractères de contrôle ni de direction), coupée. */
export function clean(v, max, multiline = false) {
  let t = String(v ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f  ‪-‮⁦-⁩]/g, "");
  t = multiline ? t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n") : t.replace(/\s+/g, " ");
  return [...t.trim()].slice(0, max).join("");
}

/** Clé de comparaison : sans casse, sans accents. */
export const fold = (v) => String(v ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

export const idOk = (v) => typeof v === "string" && v.length > 0 && v.length <= LIMITS.id;
export const int = (v, def, min, max) => { const n = Number(v); return v === undefined || v === null || v === "" || !Number.isFinite(n) ? def : Math.min(max, Math.max(min, Math.trunc(n))); };

/* ───────────── Les noms montrés ───────────── */

export const NAME_STYLES = ["card", "first", "nickname"];
export const ORDERS = ["alpha", "oldest", "newest"];

/** Le prénom : le premier mot du nom de la fiche (une organisation garde son nom entier). */
export const firstWord = (name) => clean(name, 120).split(" ")[0] ?? "";

/** Les initiales du nom montré (jusqu'à deux lettres), pour le rond sans photo. */
export function initials(name) {
  const words = clean(name, 120).replace(/^[@#]+/, "").split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0] ?? ""];
  return letters.map((w) => [...w][0] ?? "").join("").toLocaleUpperCase() || "♥";
}

/**
 * Le nom à montrer pour une fiche déjà réduite à { name, first, nick }. Style « card » : le nom de la fiche ; « first » : son premier mot ;
 * « nickname » : le nom affiché de son compte (sinon le nom de la fiche).
 */
export function shownName(p, style) {
  const pick = style === "first" ? p.first : style === "nickname" ? p.nick : p.name;
  return clean(pick || p.name, 120) || "—";
}

/** Une fiche de Contacts → ce que le module en retient POUR L'AFFICHAGE (jamais d'e-mail, de téléphone, de rôle ni de compte). */
export function reduceCard(c) {
  const name = clean(c?.name, 120);
  const accounts = Array.isArray(c?.accounts) ? c.accounts : [];
  const photoAccount = c?.photo?.accountId ? accounts.find((a) => a?.id === c.photo.accountId) : null;
  const acc = photoAccount ?? accounts.find((a) => a?.network === "twitch") ?? accounts[0] ?? null;
  const nick = acc ? clean(acc.displayName || String(acc.handle ?? "").replace(/^@/, ""), 60) : "";
  const photo = photoSrc(c?.photo);
  return { id: String(c.id), name, first: firstWord(name), nick, photo: photo ?? "" };
}

/* ───────────── Les photos permises ───────────── */

// Une photo de Contacts est chargée DIRECTEMENT par le navigateur du visiteur (le cœur ne laisse pas un module relayer des images : voir le README). Pour ne pas
// envoyer vos visiteurs vers n'importe quel serveur : une photo choisie à la main (par vous, dans Contacts) est permise en https ou sur le site même ;
// une photo venue d'un réseau n'est permise que depuis la liste des serveurs d'images connus de Twitch, YouTube et Bluesky. Sinon : les initiales.
const GOOGLE_PHOTO = /^\/(?:(?:ytc|a)\/)?[A-Za-z0-9_-]{20,200}(?:=[A-Za-z0-9_-]{1,60})?$/;
export const PHOTO_HOSTS = {
  "static-cdn.jtvnw.net": /^\/(?:jtv_user_pictures|user-default-pictures-uv)\/[A-Za-z0-9_.\-/]{1,160}\.(?:png|jpe?g|webp)$/,
  "yt3.ggpht.com": GOOGLE_PHOTO,
  "yt3.googleusercontent.com": GOOGLE_PHOTO,
  "cdn.bsky.app": /^\/img\/avatar(?:_thumbnail)?\/plain\/did:plc:[a-z2-7]{24}\/[A-Za-z0-9]{8,120}@(?:jpeg|png|webp)$/,
};

/** L'adresse de la photo à montrer, ou null. `photo` = `contact.photo` de Contacts ({ url, source }). */
export function photoSrc(photo) {
  const url = photo?.url;
  if (typeof url !== "string" || url.length > 500 || /[\u0000- \u007f\\"'<>`]/.test(url)) return null;
  if (photo.source === "manual") {
    if (/^\/(?!\/)[^?#]*$/.test(url) && !url.includes("..")) return url;           // une image envoyée sur le site
    try { const u = new URL(url); return u.protocol === "https:" && !u.username && !u.password ? u.href : null; } catch { return null; }
  }
  let u;
  try { u = new URL(url); } catch { return null; }
  const rule = PHOTO_HOSTS[u.hostname];
  if (!rule || u.protocol !== "https:" || u.port || u.username || u.password || u.search || u.hash || u.pathname.includes("..") || u.pathname.includes("%") || !rule.test(u.pathname)) return null;
  return u.href;
}

/* ───────────── Les mois ───────────── */

export const monthKey = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
export const monthOk = (m) => typeof m === "string" && /^20\d\d-(0[1-9]|1[0-2])$/.test(m);
/** Le mois, plus ou moins `n` mois. */
export function addMonths(key, n) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return monthKey(d);
}
/** « octobre 2026 » dans la langue donnée. */
export function monthLabel(key, locale) {
  if (!monthOk(key)) return key;
  const [y, m] = key.split("-").map(Number);
  try { return new Intl.DateTimeFormat(locale || "en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1))); } catch { return key; }
}
/** Seulement le nom du mois (« octobre »). */
export function monthName(key, locale) {
  if (!monthOk(key)) return key;
  const [y, m] = key.split("-").map(Number);
  try { return new Intl.DateTimeFormat(locale || "en", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1))); } catch { return key; }
}

/** Les textes par langue ({ fr: "…", en: "…" }) → le texte pour une langue : la sienne, sinon celle du site, sinon la première non vide. */
export function pickText(texts, locale, defaultLocale) {
  if (!texts || typeof texts !== "object") return "";
  for (const l of [locale, defaultLocale]) if (typeof texts[l] === "string" && texts[l].trim()) return texts[l];
  for (const v of Object.values(texts)) if (typeof v === "string" && v.trim()) return v;
  return "";
}

/** Le tri des cartes d'un groupe. `people` : [{ id, shown }] dans l'ordre de Contacts (le plus ancien d'abord). */
export function sortPeople(people, order, locale) {
  const list = [...people];
  if (order === "newest") return list.reverse();
  if (order === "oldest") return list;
  let collator;
  try { collator = new Intl.Collator(locale || "en", { sensitivity: "base", numeric: true }); } catch { collator = new Intl.Collator("en", { sensitivity: "base" }); }
  return list.sort((a, b) => collator.compare(a.shown, b.shown) || (a.id < b.id ? -1 : 1));
}
