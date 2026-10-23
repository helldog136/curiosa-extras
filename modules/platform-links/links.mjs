// Autres plateformes — la logique « pure » du module (sans contexte, sans stockage) : liste des plateformes, validation tolérante d'une adresse,
// ajout de l'origine des visites, règle de l'avertissement. Tout ce qui décide d'une adresse de destination passe ICI, pour que l'icône du site
// et le bouton « continuer » de la page d'avertissement ouvrent exactement la même adresse.

export const MAX_LINKS = 20;
export const MAX_LABEL = 40;
export const MAX_URL = 300;

/**
 * Les plateformes proposées. `adult` : « souvent pour adultes » (l'avertissement est alors prévu par défaut, mais il se coupe).
 * `icon` : identifiant d'icône du cœur (même mécanisme que les autres réseaux) ; sans logo connu du cœur, une pastille de lettre ou un signe générique.
 * `hosts` : sites acceptés pour cette plateforme (`null` : n'importe quel site https). `base` : de quoi compléter un simple nom (« monnom »).
 */
export const PLATFORMS = [
  { id: "onlyfans", name: "OnlyFans", icon: "onlyfans", adult: true, hosts: ["onlyfans.com"], base: "https://onlyfans.com/", example: "onlyfans.com/monnom" },
  { id: "mym", name: "Mym", icon: "Ⓜ︎", adult: true, hosts: ["mym.fans"], base: "https://mym.fans/", example: "mym.fans/monnom" },
  { id: "fansly", name: "Fansly", icon: "Ⓕ︎", adult: true, hosts: ["fansly.com"], base: "https://fansly.com/", example: "fansly.com/monnom" },
  { id: "patreon", name: "Patreon", icon: "patreon", adult: false, hosts: ["patreon.com"], base: "https://www.patreon.com/", example: "patreon.com/monnom" },
  { id: "kofi", name: "Ko-fi", icon: "kofi", adult: false, hosts: ["ko-fi.com"], base: "https://ko-fi.com/", example: "ko-fi.com/monnom" },
  { id: "tipeee", name: "Tipeee", icon: "Ⓣ︎", adult: false, hosts: ["tipeee.com"], base: "https://fr.tipeee.com/", example: "fr.tipeee.com/monnom" },
  { id: "liberapay", name: "Liberapay", icon: "liberapay", adult: false, hosts: ["liberapay.com"], base: "https://liberapay.com/", example: "liberapay.com/monnom" },
  { id: "buymeacoffee", name: "Buy Me a Coffee", icon: "buymeacoffee", adult: false, hosts: ["buymeacoffee.com", "bmc.link"], base: "https://buymeacoffee.com/", example: "buymeacoffee.com/monnom" },
  { id: "linktree", name: "Linktree", icon: "linktree", adult: false, hosts: ["linktr.ee"], base: "https://linktr.ee/", example: "linktr.ee/monnom" },
  { id: "other", name: "", icon: "◎︎", adult: false, hosts: null, base: null, example: "example.org/ma-page" },
];
export const platformById = (id) => PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[PLATFORMS.length - 1];
export const isPlatform = (id) => PLATFORMS.some((p) => p.id === id);

const INTERNAL_SUFFIX = /\.(localhost|local|localdomain|internal|intranet|private|lan|home|corp|home\.arpa)$/i;
const HANDLE = /^@?[A-Za-z0-9._-]{1,60}$/;
const fail = (reason) => ({ ok: false, reason });

/**
 * Comprend ce que la personne a collé et le complète : « onlyfans.com/monnom » devient « https://onlyfans.com/monnom », et pour une plateforme connue
 * un simple « monnom » suffit. Renvoie `{ ok: true, url, host }` ou `{ ok: false, reason }` avec `reason` parmi :
 * empty · long · invalid · http · scheme · credentials · internal · platform.
 * Refuse : http, tout autre schéma (javascript:, data:…), identifiants dans l'adresse, adresses internes ou numériques, port inhabituel,
 * et — pour une plateforme connue — un autre site que le sien (« Autre » accepte n'importe quel site https).
 */
export function normalizeUrl(input, platformId = "other") {
  const p = platformById(platformId);
  const v = String(input ?? "").normalize("NFC").replace(/[\u200b-\u200f\u2060\ufeff]/g, "").trim();
  if (!v) return fail("empty");
  if (v.length > MAX_URL) return fail("long");
  if (/^http:/i.test(v)) return fail("http");
  if (/^[a-z][a-z0-9+.-]*:(?!\d+(?:[/?#]|$))/i.test(v) && !/^https:/i.test(v)) return fail("scheme");   // javascript:, data:, mailto:, ftp:… (« hôte:8080 » n'est pas un schéma)
  if (/[\u0000-\u0020\u007f<>"`\\]/.test(v)) return fail("invalid");
  let candidate;
  if (/^https:\/\//i.test(v)) candidate = v;
  else if (/^https:/i.test(v)) return fail("invalid");
  else if (v.startsWith("//")) candidate = `https:${v}`;
  else if (p.base && !v.includes(".") && !v.includes("/") && HANDLE.test(v)) candidate = `${p.base}${v.replace(/^@/, "")}`;
  else candidate = `https://${v}`;
  let u;
  try { u = new URL(candidate); } catch { return fail("invalid"); }
  if (u.protocol !== "https:") return fail("scheme");
  if (u.username || u.password) return fail("credentials");
  if (u.port) return fail("internal");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const labels = host.split(".");
  if (host.startsWith("[") || labels.length < 2 || INTERNAL_SUFFIX.test(host)) return fail("internal");
  if (/^\d+$/.test(labels[labels.length - 1])) return fail("internal");                       // adresse numérique (127.0.0.1, 2130706433…)
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(labels[labels.length - 1])) return fail("invalid");
  if (!labels.every((l) => /^[a-z0-9-]{1,63}$/.test(l) && !l.startsWith("-") && !l.endsWith("-"))) return fail("invalid");
  if (p.hosts && !p.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return fail("platform");
  if (u.href.length > MAX_URL + 200) return fail("long");
  return { ok: true, url: u.href, host };
}

/** Un libellé court, sur une ligne, sans caractères de contrôle. */
export function cleanLabel(value, max = MAX_LABEL) {
  return String(value ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Un texte de plusieurs lignes (message de la page d'avertissement), sans caractères de contrôle. */
export function cleanText(value, max = 600) {
  return String(value ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

const ORIGIN_KEYS = ["utm_source", "utm_medium", "utm_campaign"];

/**
 * Ajoute à l'adresse l'origine de la visite (utm_source = nom du site, utm_medium = link, utm_campaign si renseignée).
 * - ne remplace JAMAIS un paramètre déjà présent dans l'adresse de la personne et n'en double aucun ;
 * - le reste de l'adresse (autres paramètres, leur écriture, l'ancre #…) est gardé tel quel ;
 * - les valeurs sont encodées (espaces, accents, & = # …) : elles ne peuvent pas ajouter ni couper un paramètre.
 * Les valeurs viennent de la configuration du site, jamais de la requête du visiteur.
 */
export function withOrigin(url, { source, medium = "link", campaign = "" } = {}) {
  let u;
  try { u = new URL(url); } catch { return url; }
  if (u.protocol !== "https:") return url;
  const present = new Set([...u.searchParams.keys()].map((k) => k.toLowerCase()));
  const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const wanted = [["utm_source", cleanLabel(source, 100).toLowerCase()], ["utm_medium", cleanLabel(medium, 30)], ["utm_campaign", cleanLabel(campaign, 60)]];
  const added = wanted.filter(([k, v]) => v && !present.has(k)).map(([k, v]) => `${k}=${enc(v)}`);
  if (!added.length) return u.href;
  const hash = u.hash;
  u.hash = "";
  const base = u.href;
  const glue = base.endsWith("?") || base.endsWith("&") ? "" : base.includes("?") ? "&" : "?";
  return `${base}${glue}${added.join("&")}${hash}`;
}
export { ORIGIN_KEYS };

const WARN = ["auto", "on", "off"];
export const warnChoice = (v) => (WARN.includes(v) ? v : "auto");
export const originChoice = (v) => (WARN.includes(v) ? v : "auto");

/** Faut-il prévenir avant d'ouvrir ce lien ? Le choix fait pour le lien l'emporte ; sinon, le réglage général pour les plateformes « souvent pour adultes ». */
export function shouldWarn(link, { warnAdult }) {
  if (link.warn === "on") return true;
  if (link.warn === "off") return false;
  return !!warnAdult && platformById(link.platform).adult;
}

/** L'origine des visites est-elle ajoutée à ce lien ? Le choix fait pour le lien l'emporte ; sinon le réglage général (oui par défaut). */
export function shouldAddOrigin(link, { originEnabled }) {
  if (link.origin === "on") return true;
  if (link.origin === "off") return false;
  return !!originEnabled;
}

/** L'adresse EXACTE vers laquelle le lien mène (icône directe comme bouton « continuer »). `null` : adresse inutilisable, le lien n'est pas montré. */
export function destinationOf(link, cfg) {
  const checked = normalizeUrl(link.url, "other");
  if (!checked.ok) return null;
  if (!shouldAddOrigin(link, cfg) || !cfg.siteHost) return checked.url;
  return withOrigin(checked.url, { source: cfg.siteHost, medium: "link", campaign: cfg.campaign });
}

/** Réglage booléen lu avec tolérance (un réglage peut arriver en texte). */
export function flag(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return !["false", "0", "off", "no", "non"].includes(value.trim().toLowerCase());
  return !!value;
}

/** Les liens dans l'ordre choisi (ordre, puis ancienneté). */
export const inOrder = (links) => [...links].sort((a, b) => a.order - b.order || a.at - b.at);

/** Échange la place d'un lien avec son voisin (-1 : monter, +1 : descendre). Renvoie `changes` : les liens dont le rang (0..n-1) doit être réécrit. */
export function move(links, id, delta) {
  const list = inOrder(links);
  const i = list.findIndex((l) => l.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return { moved: false, changes: [] };
  [list[i], list[j]] = [list[j], list[i]];
  return { moved: true, changes: list.map((l, n) => ({ id: l.id, order: n })).filter((c) => links.find((l) => l.id === c.id).order !== c.order) };
}

/** Une clé de lien : minuscules et chiffres, qui sert d'identifiant public (jamais une destination). */
export function newKey(taken = new Set()) {
  for (;;) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(7));
    const key = `l${[...bytes].map((b) => (b % 36).toString(36)).join("")}`;
    if (!taken.has(key)) return key;
  }
}
export const isKey = (v) => typeof v === "string" && /^[a-z0-9]{4,16}$/.test(v);
