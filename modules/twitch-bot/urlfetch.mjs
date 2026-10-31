// `{urlfetch https://…}` en version SÛRE. Éteint tant que la liste des sites autorisés (mode avancé) est vide.
// Règles : https seulement, port habituel, sans identifiant dans l'adresse ; le site doit être EXACTEMENT dans la liste ; jamais d'adresse numérique, de nom interne
// ni de site qui se résout vers une adresse privée ou locale ; AUCUNE redirection suivie (une réponse 3xx est refusée, donc jamais de saut vers un autre site) ;
// 3 secondes ; 400 caractères ; texte seulement (une page HTML est refusée) ; réponse gardée 30 secondes ; au plus 10 demandes par minute et par instance.
// Limite connue : entre notre vérification du nom et la demande du cœur, un site que la personne a elle-même autorisé et qui change d'adresse très vite pourrait
// pointer vers une adresse privée ; d'où la liste blanche (la personne ne doit autoriser que des sites qu'elle maîtrise ou en qui elle a confiance).
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export const FETCH_LIMITS = { timeoutMs: 3000, maxChars: 400, maxBytes: 20_000, cacheMs: 30_000, perMinute: 10, maxUrl: 300, maxHosts: 10, cacheEntries: 50 };
const BAD_SUFFIX = /(^|\.)(localhost|local|internal|lan|home|corp|intranet|private|test|invalid|example|onion)$/;

/** Les sites autorisés, lus dans le réglage (un par ligne ou séparés par des virgules). Rend { hosts, bad } : `bad` = ce qui a été écarté. */
export function parseHosts(raw) {
  const hosts = [], bad = [];
  for (const piece of String(raw ?? "").toLowerCase().split(/[\s,;]+/)) {
    const h = piece.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    if (!h) continue;
    if (!isPublicHostName(h)) { bad.push(piece.slice(0, 60)); continue; }
    if (!hosts.includes(h)) hosts.push(h);
  }
  return { hosts: hosts.slice(0, FETCH_LIMITS.maxHosts), bad: [...bad, ...hosts.slice(FETCH_LIMITS.maxHosts)] };
}
/** Un vrai nom de site public : au moins un point, lettres/chiffres/tirets, ni adresse numérique ni nom interne. */
export function isPublicHostName(h) {
  const s = String(h ?? "").toLowerCase();
  return s.length <= 120 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(s) && !isIP(s) && !BAD_SUFFIX.test(s);
}
/** Une adresse numérique privée, locale, partagée, réservée, multicast ou « mappée » : à refuser. */
export function isPrivateAddress(ip) {
  const a = String(ip ?? "").toLowerCase();
  const v = isIP(a);
  if (v === 4) {
    const [p, q] = a.split(".").map(Number);
    return p === 0 || p === 10 || p === 127 || (p === 100 && q >= 64 && q <= 127) || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 192 && q === 0) || (p === 198 && (q === 18 || q === 19)) || p >= 224;
  }
  if (v === 6) {
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (m) return isPrivateAddress(m[1]);
    if (/^::ffff:/.test(a)) return true;
    return a === "::" || a === "::1" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a) || /^64:ff9b:/.test(a) || /^2001:db8/.test(a) || /^2001:0?:/.test(a) || /^2002:/.test(a);
  }
  return true;   // pas une adresse lisible : par prudence, refusée
}

/** Vérifie une adresse AVANT toute demande. Rend { ok: true, url } ou { ok: false, code } (« off », « url », « scheme », « host », « notlisted »). */
export function checkUrl(raw, hosts) {
  if (!hosts?.length) return { ok: false, code: "off" };
  const text = String(raw ?? "").trim();
  if (!text || text.length > FETCH_LIMITS.maxUrl || /[\u0000-\u0020\u007f]/.test(text.replace(/%20/g, ""))) return { ok: false, code: "url" };
  let u;
  try { u = new URL(text); } catch { return { ok: false, code: "url" }; }
  if (u.protocol !== "https:") return { ok: false, code: "scheme" };
  if (u.username || u.password || (u.port && u.port !== "443")) return { ok: false, code: "url" };
  const h = u.hostname.toLowerCase();
  if (!isPublicHostName(h)) return { ok: false, code: "host" };
  if (!hosts.includes(h)) return { ok: false, code: "notlisted" };
  u.hash = "";
  return { ok: true, url: u.href, host: h };
}

const mem = new Map();
const of = (ctx) => { const k = ctx.instance.key; if (!mem.has(k)) mem.set(k, { cache: new Map(), calls: [] }); return mem.get(k); };
export const resetFetchMemory = () => mem.clear();
/** Pour les tests : remplace la résolution des noms de sites (jamais de vrai réseau). */
export const hooks = { resolve: null };

/** Le texte d'une réponse, rendu inoffensif : une ligne, sans accolades (jamais relu comme un morceau), sans caractères invisibles, 400 caractères. */
export function safeText(body) {
  return String(body ?? "").normalize("NFKC").replace(/[{}]/g, "").replace(/[\r\n\t\u2028\u2029]+/g, " ").replace(/\p{C}+/gu, "").replace(/\s+/g, " ").trim().slice(0, FETCH_LIMITS.maxChars);
}

const within = (p, ms) => { let timer; const late = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, code: "timeout" }), ms); }); return Promise.race([p, late]).finally(() => clearTimeout(timer)); };

/**
 * Va chercher un texte. `hosts` : la liste blanche. `resolve` (tests) : remplace la résolution du nom. Rend { ok: true, text } ou { ok: false, code } ; ne lève jamais.
 * Codes : off · url · scheme · host · notlisted · private · rate · timeout · status · redirect · type · empty · net.
 */
export async function fetchText(ctx, rawUrl, hosts, { now = Date.now(), resolve = (h) => (hooks.resolve ?? ((x) => dnsLookup(x, { all: true })))(h) } = {}) {
  const c = checkUrl(rawUrl, hosts);
  if (!c.ok) return c;
  const m = of(ctx);
  const hit = m.cache.get(c.url);
  if (hit && hit.until > now) return hit.value;
  m.calls = m.calls.filter((t) => now - t < 60_000);
  if (m.calls.length >= FETCH_LIMITS.perMinute) return { ok: false, code: "rate" };
  m.calls.push(now);
  const result = await within((async () => {
    try {
      const addrs = await resolve(c.host);
      const list = (Array.isArray(addrs) ? addrs : [addrs]).map((x) => (typeof x === "string" ? x : x?.address));
      if (!list.length || list.some(isPrivateAddress)) return { ok: false, code: "private" };
      const r = await ctx.api.net.request({ url: c.url, method: "GET", timeoutMs: FETCH_LIMITS.timeoutMs, maxBytes: FETCH_LIMITS.maxBytes, headers: { accept: "text/plain, application/json;q=0.9, */*;q=0.1" }, dedupe: true, priority: "interactive" });
      if (!r?.ok) return { ok: false, code: r?.error === "timeout" ? "timeout" : "net" };
      if (r.status >= 300 && r.status < 400) return { ok: false, code: "redirect" };
      if (r.status !== 200) return { ok: false, code: "status" };
      const body = typeof r.text === "string" ? r.text : r.json !== undefined ? JSON.stringify(r.json) : "";
      if (/^\s*<(?:!doctype|html|\?xml|svg|script|body|head)/i.test(body)) return { ok: false, code: "type" };
      const text = safeText(body);
      return text ? { ok: true, text } : { ok: false, code: "empty" };
    } catch { return { ok: false, code: "net" }; }
  })(), FETCH_LIMITS.timeoutMs);
  m.cache.set(c.url, { value: result, until: now + FETCH_LIMITS.cacheMs });
  if (m.cache.size > FETCH_LIMITS.cacheEntries) for (const [k, e] of m.cache) { if (e.until <= now || m.cache.size > FETCH_LIMITS.cacheEntries) m.cache.delete(k); else break; }
  return result;
}
