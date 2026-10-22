// Santé du site — lire des liens et des images dans un texte, et décider si une adresse peut être visitée.
// Rien ici ne touche au réseau : ce sont des fonctions pures (testées seules). La visite elle-même est dans probe.mjs.

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Texte court et sans retour à la ligne (pour les listes). */
export const clip = (v, max = 100) => {
  const t = String(v ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const MD_IMAGE = /!\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const MD_LINK = /(?<!!)\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const HTML_IMG = /<img\b[^>]*>/gi;
const HTML_A = /<a\b[^>]*>/gi;
const AUTOLINK = /<((?:https?:)?\/\/[^\s<>]+)>/gi;
const BARE_URL = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
};
const unwrap = (s) => String(s ?? "").trim().replace(/^<|>$/g, "");
const blank = (text, re) => text.replace(re, (m) => " ".repeat(m.length));

/**
 * Les images et les liens d'un texte Markdown.
 *   images : [{ src, alt }]   (alt : "" = pas de description ; pour du HTML, `alt=""` écrit exprès compte comme voulu → alt: null)
 *   links  : [{ href, text }]
 * Les blocs de code ne contiennent pas de vrais liens : ils sont ignorés.
 */
export function extractRefs(markdown) {
  let text = String(markdown ?? "");
  if (!text) return { images: [], links: [] };
  text = blank(text, /```[\s\S]*?```|~~~[\s\S]*?~~~/g);
  text = blank(text, /`[^`\n]*`/g);
  const images = [];
  const links = [];
  for (const m of text.matchAll(MD_IMAGE)) images.push({ src: unwrap(m[2]), alt: m[1].trim() });
  text = blank(text, MD_IMAGE);
  for (const m of text.matchAll(HTML_IMG)) {
    const alt = attr(m[0], "alt");
    images.push({ src: attr(m[0], "src") ?? "", alt: alt === null ? "" : alt === "" ? null : alt.trim() });   // alt="" écrit exprès : image décorative, rien à dire
  }
  text = blank(text, HTML_IMG);
  for (const m of text.matchAll(HTML_A)) { const href = attr(m[0], "href"); if (href) links.push({ href: href.trim(), text: "" }); }
  text = blank(text, HTML_A);
  for (const m of text.matchAll(MD_LINK)) links.push({ href: unwrap(m[2]), text: m[1].trim() });
  text = blank(text, MD_LINK);
  for (const m of text.matchAll(AUTOLINK)) links.push({ href: m[1], text: "" });
  text = blank(text, AUTOLINK);
  for (const m of text.matchAll(BARE_URL)) links.push({ href: m[0].replace(/[.,;:!?]+$/, ""), text: "" });
  return { images, links };
}

/**
 * Où mène une adresse trouvée dans un texte ?
 *   { kind: "external", url }   une autre adresse du web (http ou https ; le fragment #… est retiré)
 *   { kind: "internal", path }  une page de CE site (chemin sans paramètres, sans « / » final, en minuscules)
 *   null                        rien à vérifier (mailto:, tel:, ancre #, javascript:, chemin relatif sans « / »…)
 * `ownHost` : l'adresse du site (les liens vers soi-même sont des liens internes).
 */
export function classifyHref(href, ownHost = "") {
  const raw = String(href ?? "").trim();
  if (!raw || raw.length > 2000 || /[\u0000-\u001f\u007f\s]/.test(raw)) return null;
  if (raw.startsWith("#")) return null;
  if (raw.startsWith("/") && !raw.startsWith("//")) return { kind: "internal", path: normalizePath(raw) };
  let u;
  try { u = new URL(raw.startsWith("//") ? `https:${raw}` : raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (ownHost && u.host.toLowerCase() === ownHost.toLowerCase()) return { kind: "internal", path: normalizePath(u.pathname) };
  u.hash = "";
  return { kind: "external", url: u.href };
}

export function normalizePath(p) {
  let path = String(p ?? "").split(/[?#]/)[0];
  try { path = decodeURIComponent(path); } catch { /* chemin mal codé : tel quel */ }
  path = path.toLowerCase().replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path || "/";
}

/** Le chemin sans l'éventuel préfixe de langue (« /en/blog/x » → « /blog/x »). */
export function stripLocale(path, locales = []) {
  const m = /^\/([a-z]{2,3}(?:-[a-z0-9]+)?)(\/.*)?$/.exec(path);
  return m && locales.some((l) => l.toLowerCase() === m[1]) ? (m[2] || "/") : path;
}

/* ───────────── Adresses qu'on refuse de visiter ───────────── */

const INTERNAL_SUFFIX = /\.(localhost|local|localdomain|internal|intranet|private|lan|home|corp|home\.arpa)$/i;

/**
 * Le module ne doit jamais servir à sonder le réseau interne ni à attaquer un site : seules les adresses publiques, en https, sur le port habituel.
 * Renvoie null si l'adresse peut être visitée, sinon la raison : "scheme" · "credentials" · "port" · "address" (adresse numérique) · "internal" (nom interne) · "invalid".
 */
export function hostProblem(url) {
  if (!(url instanceof URL)) { try { url = new URL(String(url)); } catch { return "invalid"; } }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "scheme";
  if (url.username || url.password) return "credentials";
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) return "port";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253) return "invalid";
  if (host.startsWith("[") || host.includes(":")) return "address";
  if (/^[0-9.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return "address";   // 127.0.0.1, 2130706433, 0x7f000001… (l'analyseur d'adresses les normalise déjà)
  if (!host.includes(".") || host === "localhost" || INTERNAL_SUFFIX.test(host)) return "internal";
  if (!/^[a-z0-9._-]+$/.test(host)) return "invalid";   // adresses internationales : déjà converties en « xn-- » par l'analyseur
  return null;
}

const v4 = (s) => { const p = s.split("."); if (p.length !== 4) return null; const n = p.map(Number); return n.every((x, i) => /^\d{1,3}$/.test(p[i]) && x >= 0 && x <= 255) ? n : null; };

/** Une adresse numérique (celle que renvoie la résolution du nom) est-elle privée, locale ou réservée ? Dans le doute : oui. */
export function addressIsPrivate(ip) {
  const s = String(ip ?? "").toLowerCase().trim();
  const four = v4(s);
  if (four) {
    const [a, b, c] = four;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  }
  if (!s.includes(":")) return true;   // ni v4 ni v6 : on ne sait pas, on refuse
  const mapped = /^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return addressIsPrivate(mapped[1]);
  const hexMapped = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
  if (hexMapped) { const hi = parseInt(hexMapped[1], 16), lo = parseInt(hexMapped[2], 16); return addressIsPrivate(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`); }
  if (s === "::" || s === "::1") return true;
  const first = parseInt(s.split(":")[0] || "0", 16);
  if (!Number.isFinite(first)) return true;
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00 || first === 0x2001 && /^2001:(0?db8|0{1,4}:)/.test(s) || first === 0x2002 || first === 0x64;
}

/** Une adresse de l'utilisatrice à ne jamais visiter (réglage « sites à laisser tranquilles »). */
export function parseIgnoredHosts(text) {
  return new Set(String(text ?? "").split(/[\s,;]+/).map((h) => { try { return new URL(/^[a-z]+:\/\//i.test(h) ? h : `https://${h}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } }).filter(Boolean).slice(0, 200));
}
export const hostKey = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
