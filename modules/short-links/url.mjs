// Adresses et noms courts : tout ce qui décide ce qu'on accepte.
//
// Deux familles de règles, appliquées à la création, à la modification ET une dernière fois au moment de rediriger :
//  - la destination : seulement http ou https, jamais d'adresse interne (ordinateur local, réseau privé, nom de machine interne),
//    jamais d'identifiant dans l'adresse (« https://banque.fr@autre.site »), jamais un autre lien court de ce site (boucle) ;
//  - le nom court : minuscules, chiffres et tirets, ni réservé par le site ni déjà pris.
// Aucune résolution de nom (DNS) n'est faite : le site ne contacte jamais la destination, il envoie seulement le navigateur du visiteur.

/** Adresses saisies : au plus ce nombre de caractères. */
export const MAX_URL = 2000;
export const SLUG_MIN = 2;
export const SLUG_MAX = 32;

// ── Noms courts ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Premiers morceaux d'adresse que le site se garde (liste du cœur) + mots qui prêtent à confusion. */
const RESERVED = new Set([
  "admin", "api", "m", "go", "uploads", "overlays", "feed", "feed.xml", "_next", "sitemap", "sitemap.xml", "robots", "robots.txt", "llms", "llms.txt",
  "icon", "favicon", "favicon.ico", "privacy",
  "login", "logout", "signin", "signup", "register", "account", "static", "assets", "public", "app", "www", "mail", "ftp", "new", "edit", "delete", "null", "undefined", "qr",
  "fr", "en", "nl", "de", "es", "it", "pt", "ca",
]);

/** Met un texte au propre pour en faire un nom court : sans accents, minuscules, mots reliés par des tirets. */
export function normalizeSlug(raw) {
  let s = String(raw ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length > SLUG_MAX) s = s.slice(0, SLUG_MAX).replace(/-+$/, "");
  return s;
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Le nom est-il utilisable ? Rend null, ou un code d'erreur : `short`, `long`, `chars`, `reserved`.
 * `extraReserved` : chemins déjà pris par les pages du site (les autres modules), langues du site.
 */
export function slugProblem(slug, extraReserved = []) {
  if (typeof slug !== "string" || slug.length < SLUG_MIN) return "short";
  if (slug.length > SLUG_MAX) return "long";
  if (!SLUG_RE.test(slug)) return "chars";
  if (RESERVED.has(slug) || extraReserved.some((r) => String(r).toLowerCase() === slug)) return "reserved";
  return null;
}

const STOP = new Set(["www", "http", "https", "html", "htm", "php", "aspx", "index", "home", "page", "pages", "watch", "view", "item", "product", "products", "the", "and", "des", "les", "une", "pour", "avec", "dans", "sur", "com", "org", "net", "www2"]);

/** Un morceau d'adresse qui ressemble à un code (suite de chiffres, empreinte) ne fait pas un nom lisible. */
const looksLikeCode = (word) => (/^\d+$/.test(word) && !/^20\d\d$/.test(word)) || (word.length >= 8 && /\d/.test(word) && /[a-z]/.test(word)) || /^[0-9a-f]{8,}$/.test(word);

function words(text) {
  return normalizeSlug(text).split("-").filter((w) => w.length > 2 || /^\d+$/.test(w)).filter((w) => !STOP.has(w) && !looksLikeCode(w));
}

/**
 * Propose un nom court lisible. Dans l'ordre : le titre que la personne a écrit, sinon le dernier morceau parlant du chemin de l'adresse
 * (« …/boutique/mug-chat » donne « mug-chat »), sinon le nom du site (« twitch.tv » donne « twitch »), sinon « lien ».
 */
export function suggestSlug({ title, url } = {}) {
  const fromWords = (list, max = 3) => list.slice(0, max).join("-").slice(0, 24).replace(/-+$/, "");
  const candidates = [];
  if (title) candidates.push(fromWords(words(title)));
  let u = null;
  try {
    u = new URL(String(url ?? ""), "https://placeholder.invalid");
  } catch {
    u = null;
  }
  if (u && url && !String(url).startsWith("/")) {
    const segments = u.pathname.split("/").filter(Boolean).reverse();
    for (const seg of segments) {
      const w = words(decodeURIComponentSafe(seg.replace(/\.[a-z0-9]{2,4}$/i, "")));
      if (w.length) {
        candidates.push(fromWords(w));
        break;
      }
    }
    const labels = u.hostname.replace(/^www\./, "").split(".");
    const site = labels.length > 1 ? labels.slice(0, -1).filter((l) => !STOP.has(l)).pop() : labels[0];
    if (site) candidates.push(fromWords(words(site), 1));
  } else if (u && String(url ?? "").startsWith("/")) {
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last) candidates.push(fromWords(words(decodeURIComponentSafe(last))));
  }
  for (const c of candidates) if (c && c.length >= SLUG_MIN && !slugProblem(c)) return c;
  return "lien";
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Rend `base`, ou `base-2`, `base-3`… le premier que `taken(name)` ne refuse pas. */
export function freeSlug(base, taken) {
  let root = base.slice(0, SLUG_MAX - 3).replace(/-+$/, "") || "lien";
  if (root.length < SLUG_MIN) root = "lien";
  if (!taken(base) && base.length >= SLUG_MIN) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${root}-${i}`;
    if (!taken(candidate)) return candidate;
  }
  return `${root}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── Destinations ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Suffixes de noms qui ne désignent que des machines internes ou qui n'existent pas sur Internet. */
const INTERNAL_SUFFIXES = [".localhost", ".local", ".localdomain", ".internal", ".intranet", ".lan", ".home", ".corp", ".private", ".home.arpa", ".arpa", ".test", ".example", ".invalid", ".onion"];
/** Services qui font pointer n'importe quel nom vers une adresse choisie (souvent 127.0.0.1) : on ne peut pas les distinguer d'une adresse interne. */
const WILDCARD_DNS = ["nip.io", "sslip.io", "xip.io", "traefik.me", "localtest.me", "lvh.me", "vcap.me", "localhost.run"];

function ipv4Parts(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

/** Adresse IPv4 privée, locale, réservée ou de diffusion ? */
export function isPrivateIpv4([a, b, c]) {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // partage d'adresses des opérateurs
  if (a === 169 && b === 254) return true; // adresses locales (dont les services de métadonnées des hébergeurs)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return a >= 224; // multidiffusion, réservé, diffusion générale
}

/** IPv6 : seules les adresses publiques « 2000::/3 » passent, sauf documentation, 6to4 et Teredo (qui cachent une adresse IPv4). */
function ipv6Allowed(host) {
  const inner = host.replace(/^\[|\]$/g, "");
  if (!/^[0-9a-f:]+$/i.test(inner) || !inner.includes(":")) return false;
  const first = inner.split(":")[0] || "0";
  const top = parseInt(first.padStart(4, "0").slice(0, 1), 16);
  if (!(top === 2 || top === 3)) return false; // 2000::/3
  const lower = inner.toLowerCase();
  if (lower.startsWith("2001:db8") || lower.startsWith("2001:0db8") || lower.startsWith("2002:") || lower.startsWith("2001:0:") || lower.startsWith("2001::")) return false;
  return true;
}

/** Rend null si le nom d'hôte (déjà normalisé par `new URL`) peut être atteint par n'importe quel visiteur, sinon un code : `private`. */
export function hostProblem(hostname) {
  let host = String(hostname ?? "").toLowerCase();
  if (host.endsWith(".") && host.length > 1) host = host.slice(0, -1);
  if (!host) return "private";
  if (host.startsWith("[")) return ipv6Allowed(host) ? null : "private";
  const v4 = ipv4Parts(host);
  if (v4) return isPrivateIpv4(v4) ? "private" : null;
  if (host === "localhost" || !host.includes(".")) return "private"; // « intranet », « nas », « routeur » : des noms qui n'existent que chez soi
  if (INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) return "private";
  if (WILDCARD_DNS.some((s) => host === s || host.endsWith(`.${s}`))) return "private";
  const labels = host.split(".");
  const tld = labels[labels.length - 1];
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) return "invalid"; // « .123 » : ce n'est pas un nom de site
  if (!labels.every((l) => /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/.test(l))) return "invalid";
  return null;
}

/** Caractères invisibles ou de contrôle (collés par erreur depuis un message) : codes à retirer, en plages. */
const UNSAFE_RANGES = [[0, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff]];
const stripUnsafe = (s) => Array.from(s).filter((ch) => !UNSAFE_RANGES.some(([a, b]) => ch.codePointAt(0) >= a && ch.codePointAt(0) <= b)).join("");

/**
 * Comprend ce que la personne a collé : espaces et guillemets autour, « <…> » d'un message, ponctuation à la fin d'une phrase,
 * adresse sans « https:// » (« monsite.be/boutique »), adresse commençant par « // ». Ce qui reste incompréhensible est rendu tel quel.
 */
export function tidyUrlInput(raw) {
  let v = stripUnsafe(String(raw ?? "").normalize("NFKC")).trim();
  v = v.replace(/^[<"'“«‹(]+/, "").replace(/[>"'”»›]+$/, "").trim();
  v = v.replace(/[.,;:!?]+$/, "");
  if (v.startsWith("//") && !v.startsWith("///")) v = `https:${v}`;
  return v;
}

/** Y a-t-il un schéma (« mailto: », « javascript: », « ftp: »…) devant l'adresse ? « monsite.be:8080/x » n'en est pas un. */
function schemeOf(v) {
  const m = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(v);
  if (!m) return null;
  const after = m[2];
  if (/^\d{1,5}(?:[/?#]|$)/.test(after) && !after.startsWith("//")) return null; // hôte:port
  return m[1].toLowerCase();
}

/**
 * Valide la destination d'un lien court.
 * @param {string} raw
 * @param {{ siteUrl?: string, selfPaths?: string[] }} [options]  `siteUrl` : adresse de ce site (une destination « /page » en dépend, un lien vers
 *   un lien court de ce site est refusé) ; `selfPaths` : débuts de chemin qui sont des liens courts de ce site (« /m/<clé>/ »)
 * @returns {{ ok: true, url: string, kind: "web" | "site" } | { ok: false, code: string }}
 *   codes : empty, long, space, scheme, invalid, credentials, private, loop
 */
export function parseDestination(raw, options = {}) {
  const input = tidyUrlInput(raw);
  if (!input) return { ok: false, code: "empty" };
  if (input.length > MAX_URL) return { ok: false, code: "long" };
  if (/\s/.test(input)) return { ok: false, code: "space" };

  // Une page de ce site : « /boutique ». Jamais « // » ni « \ » (qui rendraient l'adresse externe), jamais les chemins techniques.
  if (input.startsWith("/")) {
    if (input.startsWith("//") || input.includes("\\")) return { ok: false, code: "invalid" };
    let u;
    try {
      u = new URL(input, "https://site.invalid");
    } catch {
      return { ok: false, code: "invalid" };
    }
    if (u.origin !== "https://site.invalid") return { ok: false, code: "invalid" };
    const path = `${u.pathname}${u.search}${u.hash}`;
    if (/^\/(?:m|api|admin|_next|overlays)(?:\/|$)/i.test(u.pathname)) return { ok: false, code: "loop" };
    return { ok: true, url: path, kind: "site" };
  }

  const scheme = schemeOf(input);
  if (scheme && scheme !== "http" && scheme !== "https") return { ok: false, code: "scheme" };
  const candidate = scheme ? input : `https://${input}`;
  let u;
  try {
    u = new URL(candidate);
  } catch {
    return { ok: false, code: "invalid" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, code: "scheme" };
  if (u.username || u.password) return { ok: false, code: "credentials" };
  const problem = hostProblem(u.hostname);
  if (problem) return { ok: false, code: problem };
  if (options.siteUrl) {
    try {
      const own = new URL(options.siteUrl);
      if (own.host.toLowerCase() === u.host.toLowerCase() && /^\/(?:m|api|admin|_next|overlays)(?:\/|$)/i.test(u.pathname)) return { ok: false, code: "loop" };
    } catch {
      /* adresse du site illisible : rien à comparer */
    }
  }
  const href = u.href;
  if (href.length > MAX_URL) return { ok: false, code: "long" };
  return { ok: true, url: href, kind: "web" };
}

/** Le nom de site, sans « www. », pour l'afficher à côté d'un lien (« boutique.example.org »). */
export function hostLabel(url) {
  try {
    if (String(url).startsWith("/")) return String(url);
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Date « AAAA-MM-JJ » qui existe vraiment ? */
export function validDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Fin du jour indiqué (UTC), en millisecondes : le lien reste valable toute cette journée. */
export const endOfDay = (day) => Date.parse(`${day}T23:59:59.999Z`);

/** Jour courant (UTC) au format « AAAA-MM-JJ ». */
export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
