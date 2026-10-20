// Agenda en ligne — téléchargement du flux. SEUL endroit qui parle réseau dans ce module. Garde-fous :
//   • https public uniquement (le serveur télécharge l'adresse : jamais le réseau interne), redirections suivies à la main, chaque étape revérifiée ;
//   • UNE borne de temps pour tout le téléchargement (redirections et lecture du corps comprises), appliquée par un signal d'abandon ET par une borne dure
//     un peu plus longue : un serveur muet ou qui goutte à goutte ne retient personne au-delà (`timing.totalMs`) ;
//   • taille (5 Mo) et nombre de redirections bornés ;
//   • cache en mémoire avec ETag / If-Modified-Since quand le serveur les donne ; une seule demande à la fois par adresse, et ce partage est BORNÉ :
//     passé le délai, la demande en cours est retirée (sinon chaque visite suivante attendrait la même promesse) et son résultat tardif n'est jamais rangé ;
//   • après une erreur, on ne harcèle pas le serveur (30 s) et, si une copie existe (moins de 24 h), on la sert plutôt que rien.
// Jamais d'exception, et JAMAIS l'adresse dans un message ou un journal (une adresse Google Agenda privée est un secret).
export const MAX_BYTES = 5_000_000;
/** Millisecondes, dans un objet pour que les tests puissent les raccourcir. totalMs : tout le téléchargement (la borne dure est 20 % plus longue). */
export const timing = { totalMs: 5000 };
const MAX_HOPS = 3;
const FAIL_TTL = 30_000;
const STALE_MAX = 24 * 3_600_000;
const MAX_ENTRIES = 50;

/**
 * Adresse acceptable : https uniquement, sans identifiants, et jamais une machine locale ou privée.
 */
export function isPublicHttpsUrl(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host.includes(":")) return !/^(::1?$|f[cd]|fe80)/.test(host);   // IPv6 : pas de boucle locale / privée / lien local
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return false;
  }
  return host.includes(".");
}

const cache = new Map();      // adresse -> { at, text, etag, lastModified, model? }
const failures = new Map();   // adresse -> { at, error, status? }
const inflight = new Map();   // adresse -> Promise (retirée à la fin OU à l'expiration de la borne dure)
export const clearCache = () => { cache.clear(); failures.clear(); inflight.clear(); };
/** Oublie tout ce qui concerne cette adresse (instance retirée ou adresse changée) : aucune copie d'un agenda privé ne reste en mémoire. */
export const forget = (url) => { const a = String(url ?? "").trim(); cache.delete(a); failures.delete(a); inflight.delete(a); };

/** Attend `p` au plus `ms`, sinon rend `fallback()`. Le minuteur est libéré dans tous les cas et ne retient pas le processus. */
function within(p, ms, fallback) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback()), ms); timer.unref?.(); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** Lit au plus MAX_BYTES octets, et s'arrête dès que `signal` est levé ; au-delà de la taille : null. */
async function readBody(res, signal) {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) return null;
  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    return text.length > MAX_BYTES ? null : text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let total = 0, text = "";
  for (;;) {
    if (signal.aborted) { try { await reader.cancel(); } catch { /* déjà fermé */ } throw new Error("timeout"); }
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) { try { await reader.cancel(); } catch { /* déjà fermé */ } return null; }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function download(url, known, fetchImpl, signal) {
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      if (!isPublicHttpsUrl(current)) return { error: "url" };
      const headers = { Accept: "text/calendar, text/plain;q=0.8, */*;q=0.5" };
      if (known?.etag) headers["If-None-Match"] = known.etag;
      if (known?.lastModified) headers["If-Modified-Since"] = known.lastModified;
      const res = await fetchImpl(current, { signal, redirect: "manual", headers });
      const location = res.status >= 300 && res.status < 400 && res.status !== 304 ? res.headers.get("location") : null;
      if (location) { current = new URL(location, current).toString(); continue; }
      if (res.status === 304 && known) return { notModified: true };
      if (!res.ok) return { error: "http", status: res.status };
      const text = await readBody(res, signal);
      if (text === null) return { error: "size" };
      if (!text.includes("BEGIN:VCALENDAR")) return { error: "format" };
      return { text, etag: res.headers.get("etag") ?? undefined, lastModified: res.headers.get("last-modified") ?? undefined };
    }
    return { error: "http", status: 310 };   // trop de redirections
  } catch {
    return { error: "network" };
  }
}

/**
 * Le flux de cette adresse. Renvoie { ok: true, text, entry, cached, stale?, error? } ou { ok: false, error } ;
 * error : "config" (adresse vide) · "url" (refusée) · "network" (injoignable ou trop lent) · "http" (+ status) · "format" (pas un calendrier) · "size" (trop gros).
 * `entry` est l'objet du cache : l'appelant peut y ranger son analyse (`entry.model`) tant que `entry.text` est le même texte.
 * @param opts.ttlMs  durée de validité du cache ; opts.force : ignorer le cache (bouton « Tester l'adresse ») ; opts.now : horloge (tests).
 */
export async function readIcs(url, { fetchImpl = fetch, ttlMs = 300_000, force = false, now = Date.now } = {}) {
  const address = String(url ?? "").trim();
  if (!address) return { ok: false, error: "config" };
  if (!isPublicHttpsUrl(address)) return { ok: false, error: "url" };
  const t = now();
  const hit = cache.get(address);
  if (!force && hit && t - hit.at < ttlMs) return { ok: true, text: hit.text, entry: hit, cached: true };
  const failed = failures.get(address);
  if (!force && failed && t - failed.at < FAIL_TTL) {
    return hit && t - hit.at < STALE_MAX ? { ok: true, text: hit.text, entry: hit, cached: true, stale: true, error: failed.error, status: failed.status } : { ok: false, error: failed.error, status: failed.status };
  }
  if (inflight.has(address) && !force) return inflight.get(address);

  const ms = timing.totalMs;
  let expired = false;   // la borne dure a parlé : ce que le téléchargement trouverait plus tard n'est plus rangé
  const settle = (r) => {
    if (expired) return;
    if (r.notModified && hit) { hit.at = now(); failures.delete(address); return; }
    if (r.error) { failures.set(address, { at: now(), error: r.error, status: r.status }); return; }
    failures.delete(address);
    const entry = { at: now(), text: r.text, etag: r.etag, lastModified: r.lastModified };
    if (cache.size >= MAX_ENTRIES && !cache.has(address)) cache.delete(cache.keys().next().value);
    cache.set(address, entry);
  };
  const fallbackAfterError = (error, status) => {
    const copy = cache.get(address);
    return copy && now() - copy.at < STALE_MAX ? { ok: true, text: copy.text, entry: copy, cached: true, stale: true, error, status } : { ok: false, error, status };
  };
  const answer = (r) => {
    if (r.error) return fallbackAfterError(r.error, r.status);
    const entry = cache.get(address) ?? hit;
    return { ok: true, text: entry.text, entry, cached: !!r.notModified };
  };
  const work = download(address, force ? null : hit, fetchImpl, AbortSignal.timeout(ms)).then((r) => { settle(r); return r; });
  const hard = within(work, Math.round(ms * 1.2), () => { expired = true; failures.set(address, { at: now(), error: "network" }); return { error: "network" }; });
  const run = hard.then(answer).finally(() => { if (inflight.get(address) === run) inflight.delete(address); });
  inflight.set(address, run);
  return run;
}
