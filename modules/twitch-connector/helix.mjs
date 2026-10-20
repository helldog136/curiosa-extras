// Les appels à l'API de Twitch (Helix) au nom des autres modules : liste FERMÉE des appels permis, jeton d'application, jetons des comptes connectés
// (renouvelés avec le secret), petit cache, bornes. Tout passe par ctx.api.net : délai, pause après un 429 (Retry-After, Ratelimit-Reset) partagée par
// toute l'application Twitch (un seul « seau » par identifiant d'application, quel que soit le module qui demande), disjoncteur.
// Un jeton ne sort JAMAIS d'ici : l'appelant décrit l'appel, ce fichier le fait et rend la réponse de Twitch.
import { createHash } from "node:crypto";

const version = new URL(import.meta.url).search;
const oauth = await import(new URL(`./oauth.mjs${version}`, import.meta.url).href);
const store = await import(new URL(`./store.mjs${version}`, import.meta.url).href);
const { timing, within } = oauth;
const { LOGIN } = store;

export const API = "https://api.twitch.tv/helix/";
export const API_HOST = "api.twitch.tv";
export const MAX_BODY = 10_000;
export const MAX_LIST = 100;
const digits = (x) => /^[0-9]{1,20}$/.test(x);
const isoDate = (x) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(x);
const cursor = (x) => /^[A-Za-z0-9_=+/-]{1,300}$/.test(x);
const count = (v) => v.length === 1 && /^[0-9]{1,3}$/.test(v[0]) && Number(v[0]) >= 1 && Number(v[0]) <= 100;

/** Une forme de requête : `one` (exactement une de ces clés, liste de 1 à 100 valeurs qui passent le test), `opt` (clés facultatives, une valeur). */
const shape = ({ one = {}, opt = {} }) => (q) => {
  const keys = Object.keys(q);
  const main = keys.filter((k) => k in one);
  if (Object.keys(one).length && main.length !== 1) return false;
  for (const k of keys) {
    const v = q[k];
    if (k in one) { if (!v.length || v.length > MAX_LIST || !v.every(one[k])) return false; }
    else if (k in opt) { if (!opt[k](v)) return false; }
    else return false;
  }
  return true;
};
const single = (test) => (v) => v.length === 1 && test(v[0]);
const any20 = () => true;   // EventSub : requête libre (20 valeurs au plus par clé, voir plainQuery), réponses sans donnée privée

/**
 * Les seuls appels permis, par type de jeton. Sur-ensemble de la version 2 (« Chaîne Twitch » 1.7) : rien de ce qui passait ne cesse de passer.
 * `user` : [autorisations que le compte connecté doit avoir donné, forme de la requête].
 */
export const ALLOWED = {
  app: new Map([
    ["GET users", shape({ one: { login: (x) => LOGIN.test(x), id: digits } })],
    ["GET streams", shape({ one: { user_login: (x) => LOGIN.test(x), user_id: digits }, opt: { first: count } })],
    ["GET games", shape({ one: { id: digits } })],
    ["GET channels", shape({ one: { broadcaster_id: digits } })],
    ["GET videos", shape({ one: { user_id: digits }, opt: { first: count, after: single(cursor), type: single((x) => ["all", "archive", "highlight", "upload"].includes(x)) } })],
    ["GET clips", shape({ one: { broadcaster_id: digits }, opt: { first: count, after: single(cursor), started_at: single(isoDate), ended_at: single(isoDate) } })],
    ["GET eventsub/subscriptions", any20],
    ["POST eventsub/subscriptions", any20],
    ["DELETE eventsub/subscriptions", any20],
  ]),
  user: new Map([
    ["POST chat/messages", [["user:write:chat"], any20]],
    ["GET channels/followers", [["moderator:read:followers"], shape({ one: { broadcaster_id: digits }, opt: { first: count, after: single(cursor), user_id: single(digits) } })]],
    ["GET subscriptions", [["channel:read:subscriptions"], shape({ one: { broadcaster_id: digits }, opt: { first: count, after: single(cursor) } })]],
  ]),
};
/** Un corps n'est permis que pour ces appels. */
const WITH_BODY = new Set(["POST eventsub/subscriptions", "POST chat/messages"]);
/** Réponses publiques et stables, gardées 10 minutes (identité d'une chaîne, nom d'un jeu). */
const CACHED = new Set(["GET users", "GET games"]);
const CACHE_TTL = 10 * 60_000, CACHE_MAX = 300;

/** Requête : { clé: [valeurs] } (texte ou nombre, 200 caractères au plus) ; 10 clés au plus ; null si illisible. */
export function plainQuery(q, maxList) {
  if (q === undefined || q === null) return {};
  if (typeof q !== "object" || Array.isArray(q)) return null;
  const out = {};
  for (const [k, v] of Object.entries(q)) {
    if (!/^[a-z_]{1,30}$/.test(k)) return null;
    const list = [].concat(v);
    if (!list.length || list.length > maxList || list.some((x) => !["string", "number"].includes(typeof x) || String(x).length > 200)) return null;
    out[k] = list.map(String);
  }
  return Object.keys(out).length <= 10 ? out : null;
}

/** Vérifie une demande : { route, method, path, query, body, scopes, as } ou { error: "forbidden" | "invalid" }. */
export function check(args) {
  const a = args && typeof args === "object" ? args : {};
  const method = store.text(a.method).toUpperCase(), path = store.text(a.path), as = a.as === "user" ? "user" : a.as === "app" ? "app" : null;
  if (!as) return { error: "invalid" };
  const route = `${method} ${path}`;
  const rule = as === "app" ? ALLOWED.app.get(route) : ALLOWED.user.get(route)?.[1];
  if (!rule) return { error: "forbidden" };
  const generic = route.includes("eventsub") || route === "POST chat/messages";
  const query = plainQuery(a.query, generic ? 20 : MAX_LIST);
  if (query === null || !rule(query)) return { error: "invalid" };
  let body;
  if (a.body !== undefined) {
    if (!WITH_BODY.has(route) || !a.body || typeof a.body !== "object" || Array.isArray(a.body)) return { error: "invalid" };
    let size;
    try { size = JSON.stringify(a.body).length; } catch { return { error: "invalid" }; }
    if (size > MAX_BODY) return { error: "invalid" };
    body = a.body;
  }
  return { as, route, method, path, query, ...(body === undefined ? {} : { body }), scopes: as === "user" ? ALLOWED.user.get(route)[0] : [] };
}

/* ───────────── Mémoire du processus (bornée) ───────────── */
const mem = { tokens: new Map(), inflight: new Map(), cache: new Map(), good: new Map() };
export const resetHelix = () => { for (const m of Object.values(mem)) m.clear(); };
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 24);
const appKey = (c) => hash(`${c.clientId}|${c.secret}`);
/** Le seau de limite partagé : un par application Twitch (le cœur le hache encore). */
export const bucketOf = (c) => `twitch-app:${hash(c.clientId)}`;
/** Dernière bonne réponse de chaque hôte (pour le bloc « santé » de l'administration). */
export const lastGood = (host) => mem.good.get(host) ?? null;
const noteGood = (host) => { mem.good.set(host, new Date().toISOString()); };

/**
 * Un travail partagé entre demandes simultanées, JAMAIS éternel : au-delà de `ms`, tout le monde reçoit `fallback()` et l'entrée est retirée.
 */
export function share(k, make, fallback, ms = timing.sharedMs) {
  const pending = mem.inflight.get(k);
  if (pending) return pending;
  const run = within(Promise.resolve().then(make), ms, fallback).finally(() => { if (mem.inflight.get(k) === run) mem.inflight.delete(k); });
  mem.inflight.set(k, run);
  return run;
}
const NETWORK = () => ({ error: "network" });
const cap = (m, max) => { while (m.size > max) m.delete(m.keys().next().value); };

/** Jeton d'application : { token } ou { error: "auth" | "rate" | "network" }. Un seul par application, partagé entre appels simultanés. */
async function appToken(ctx, c) {
  const k = appKey(c);
  const known = mem.tokens.get(k);
  if (known && known.expiresAt > Date.now()) return { token: known.value };
  return share(`app|${k}`, async () => {
    const r = await oauth.appToken(ctx.api.net, c);
    if (r.error) return r;
    noteGood(oauth.ID_HOST);
    mem.tokens.set(k, { value: r.token, expiresAt: Date.now() + Math.max(60, r.expiresIn - 60) * 1000 });
    cap(mem.tokens, 50);
    return { token: r.token };
  }, NETWORK);
}

function target(path, query) {
  const u = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) for (const x of v) u.searchParams.append(k, x);
  return u.href;
}

/** Un appel Helix brut : { status, json } (Twitch a répondu, 4xx compris) ou { error: "rate" | "network" } ou { unauthorized: true } (401). */
async function helix(ctx, c, tokenValue, req, priority) {
  const r = await ctx.api.net.request({
    url: target(req.path, req.query), method: req.method,
    headers: { "client-id": c.clientId, authorization: `Bearer ${tokenValue}` },
    ...(req.body === undefined ? {} : { body: req.body }),
    timeoutMs: timing.requestMs, bucket: bucketOf(c), priority,
  });
  if (!r.ok) return { error: r.error === "rate" || r.error === "quota" ? "rate" : "network" };
  if (r.status === 401) return { unauthorized: true };
  if (r.status >= 500) return { error: "network" };
  noteGood(API_HOST);
  return { status: r.status, json: r.json && typeof r.json === "object" ? r.json : null };
}

/** Appel avec le jeton d'application. Un 401 oublie le jeton et réessaie une fois. */
export async function appCall(ctx, c, req, priority = "interactive") {
  const k = req.method === "GET" && CACHED.has(req.route) ? `${appKey(c)}|${target(req.path, req.query)}` : null;
  const hit = k && mem.cache.get(k);
  if (hit && hit.until > Date.now()) return structuredClone(hit.value);
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await appToken(ctx, c);
    if (t.error) return { error: t.error === "auth" ? "config" : t.error };
    const r = await helix(ctx, c, t.token, req, priority);
    if (r.unauthorized) { mem.tokens.delete(appKey(c)); continue; }
    if (k && !r.error && r.status === 200) { mem.cache.set(k, { value: structuredClone(r), until: Date.now() + CACHE_TTL }); cap(mem.cache, CACHE_MAX); }
    return r;
  }
  return { error: "auth" };
}

/**
 * Jeton du compte connecté `doc` (document de twitchConnections) : celui qu'on a s'il vaut encore 2 minutes, sinon renouvelé AVANT l'appel avec le secret.
 * `usedAccess` : le jeton que Twitch vient de refuser (401) — on renouvelle seulement si personne ne l'a déjà fait. Renouvellement fusionné par compte.
 */
async function userToken(ctx, c, docId, usedAccess) {
  const doc = await ctx.api.store.get(docId);
  const d = doc?.data;
  if (!d?.access || d.status === "reconnect" || d.clientId !== c.clientId) return { error: "auth" };
  if (usedAccess ? d.access !== usedAccess : d.expiresAt - Date.now() > 120_000) return { token: d.access, doc: d };
  return share(`refresh|${docId}`, async () => {
    const cur = (await ctx.api.store.get(docId))?.data;
    if (!cur) return { error: "auth" };
    if (usedAccess && cur.access !== usedAccess) return { token: cur.access, doc: cur };
    const r = await oauth.refreshTokens(ctx.api.net, { clientId: c.clientId, secret: c.secret, refresh: cur.refresh });
    if (r.error === "invalid") { await ctx.api.store.update(docId, { ...cur, status: "reconnect" }); return { error: "auth" }; }
    if (r.error) return { error: r.error };
    noteGood(oauth.ID_HOST);
    const next = { ...cur, access: r.tokens.access, refresh: r.tokens.refresh, expiresAt: r.tokens.expiresAt, status: "ok" };
    await ctx.api.store.update(docId, next);
    return { token: next.access, doc: next };
  }, NETWORK);
}

/** Appel avec le jeton d'un compte connecté. « scope » si l'autorisation donnée ne couvre pas l'appel ; un 401 renouvelle une fois, puis « À reconnecter ». */
export async function userCall(ctx, c, docId, req, priority = "interactive") {
  let t = await userToken(ctx, c, docId);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (t.error) return { error: t.error };
    if (req.scopes.some((s) => !Array.isArray(t.doc.scopes) || !t.doc.scopes.includes(s))) return { error: "scope" };
    const r = await helix(ctx, c, t.token, req, priority);
    if (!r.unauthorized) return r;
    if (attempt === 0) { t = await userToken(ctx, c, docId, t.token); continue; }
    const cur = (await ctx.api.store.get(docId))?.data;
    if (cur) await ctx.api.store.update(docId, { ...cur, status: "reconnect" });
    return { error: "auth" };
  }
  return { error: "auth" };
}

/** Borne dure d'un appel complet du service (jeton et renouvellement compris) : un Twitch muet ne retient jamais l'appelant plus de `timing.sharedMs`. */
export const bounded = (p) => within(p, timing.sharedMs, NETWORK);
