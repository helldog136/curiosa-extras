// Santé du site — visiter UN lien externe, poliment et sans jamais servir à autre chose.
//
// Règles (toutes appliquées ici, avant le moindre appel réseau) :
//  - seules les adresses publiques en https sur le port habituel sont visitées (jamais d'adresse numérique, de nom interne, de port exotique, d'identifiants dans l'adresse) ;
//  - le nom de domaine est résolu AVANT : s'il mène vers une adresse privée ou locale, on ne contacte rien ;
//  - toute visite passe par ctx.api.net (délai dur, pause quand un site dit « trop de demandes », disjoncteur) : jamais de fetch direct ;
//  - une demande « HEAD » d'abord (on ne télécharge rien), puis une demande « GET » limitée à 2 Ko seulement si le site ne sait pas répondre à HEAD ;
//  - les redirections sont suivies à la main, 5 au plus, et chaque étape repasse par les mêmes règles.
// Résultat : { st, code?, why?, to?, insecure?, retryAt? }.
//   st : ok · moved · gone · down · blocked · loop · paused · refused · unverified
import dns from "node:dns/promises";
import { hostProblem, addressIsPrivate } from "./urls.mjs";

export const MAX_REDIRECTS = 5;
export const REQUEST_TIMEOUT_MS = 6000;
export const LINK_BUDGET_MS = 14000;
const GET_BYTES = 2048;
const RETRY_WITH_GET = new Set([400, 403, 404, 405, 406, 501]);

/** Résolution du nom de domaine (3 s au plus). `ok: false` = on ne sait pas : on laisse ctx.api.net décider. */
export async function resolveHost(host, timeoutMs = 3000) {
  let timer;
  try {
    const found = await Promise.race([
      dns.lookup(host, { all: true, verbatim: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); }),
    ]);
    return { ok: true, addresses: found.map((a) => a.address) };
  } catch { return { ok: false, addresses: [] }; } finally { clearTimeout(timer); }
}

/** Pourquoi cette adresse ne doit pas être visitée (null : elle peut l'être). */
export async function refusal(url, deps = {}) {
  const problem = hostProblem(url);
  if (problem) return problem;
  const host = url.hostname.toLowerCase();
  const cache = deps.dnsCache;
  let found = cache?.get(host);
  if (!found) {
    found = await (deps.resolve ?? resolveHost)(host);
    cache?.set(host, found);
  }
  return found.ok && found.addresses.some(addressIsPrivate) ? "private" : null;
}

const canon = (u) => `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`;

async function hit(ctx, url, method, deadline, now) {
  const left = deadline - now();
  if (left < 600) return { fail: "timeout" };
  let r;
  try {
    r = await ctx.api.net.request({
      url: url.href, method,
      headers: { "user-agent": `Mozilla/5.0 (compatible; SiteHealthCheck/1.0; +${ctx.api.siteUrl})`, accept: "*/*" },
      timeoutMs: Math.min(REQUEST_TIMEOUT_MS, left), maxBytes: GET_BYTES, retry: 0, dedupe: false, bucket: `site-check:${url.hostname.toLowerCase()}`,
    });
  } catch { return { fail: "network" }; }
  if (r?.ok) return { status: r.status, location: r.headers?.location };
  if (r?.error === "too_large" && r.status) return { status: r.status };   // la réponse a commencé : c'est tout ce qu'on voulait savoir
  if (r?.error === "rate" || r?.error === "quota" || r?.error === "circuit" || r?.error === "busy") return { paused: true, retryAt: r.retryAt, reason: r.error };
  if (r?.error === "invalid") return { fail: "invalid" };
  return { fail: r?.error === "timeout" ? "timeout" : "network" };
}

export async function probeLink(ctx, rawUrl, deps = {}) {
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.linkBudgetMs ?? LINK_BUDGET_MS);
  let current;
  try { current = new URL(rawUrl); } catch { return { st: "refused", why: "invalid" }; }
  const insecure = current.protocol === "http:";
  if (insecure) { current.protocol = "https:"; current.port = ""; }
  const origin = current;
  const seen = new Set();
  let permanent = false;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const why = await refusal(current, deps);
    if (why) return { st: "refused", why: hop === 0 ? why : `redirect_${why}` };
    if (seen.has(current.href)) return { st: "loop" };
    seen.add(current.href);

    let r = await hit(ctx, current, "HEAD", deadline, now);
    if (!r.paused && !r.fail && RETRY_WITH_GET.has(r.status)) r = await hit(ctx, current, "GET", deadline, now);
    if (r.paused) return { st: "paused", retryAt: r.retryAt, why: r.reason };
    if (r.fail) return insecure ? { st: "unverified", why: "insecure" } : { st: "down", why: r.fail };

    const code = r.status;
    if (code >= 300 && code < 400 && r.location) {
      let next;
      try { next = new URL(r.location, current); } catch { return { st: "down", why: "badredirect", code }; }
      if (next.protocol !== "https:") return { st: "unverified", why: "insecure", code };   // la destination n'est pas sécurisée : on ne la visite pas
      if (code === 301 || code === 308) permanent = true;
      current = next;
      continue;
    }
    if (code === 404 || code === 410) return insecure ? { st: "unverified", why: "insecure", code } : { st: "gone", code };
    if (code >= 500) return insecure ? { st: "unverified", why: "insecure", code } : { st: "down", why: "server", code };
    if (code >= 400) return insecure ? { st: "unverified", why: "insecure", code } : { st: "blocked", code };   // 401, 403, 429, 999… : le site répond mais refuse les visites automatiques
    if (permanent && canon(origin) !== canon(current)) return { st: "moved", to: current.href, insecure };
    return insecure ? { st: "ok", insecure: true } : { st: "ok" };
  }
  return { st: "loop" };
}
