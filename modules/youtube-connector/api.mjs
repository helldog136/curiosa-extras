// Connecteur YouTube : le SEUL module qui parle à l'interface de données de YouTube (www.googleapis.com/youtube/v3) et qui porte la clé.
//
// Les autres modules l'appellent par le service `youtube.api` (liste FERMÉE d'appels, voir ENDPOINTS) ; ils ne voient jamais la clé.
//   - Tout passe par ctx.api.net (délai dur, pauses 429, quota 403 jusqu'à minuit heure du Pacifique, disjoncteur par hôte, déduplication).
//   - La clé voyage dans l'en-tête `x-goog-api-key`, jamais dans l'adresse : ni journal, ni proxy, ni message d'erreur ne peut la montrer.
//   - Quota : YouTube donne 10 000 unités par jour (remise à zéro à minuit, heure du Pacifique). Chaque appel annonce son coût (COSTS) ; le compteur
//     du jour est gardé dans le stockage ; un appel qui dépasserait le budget est refusé AVANT de partir (`quota`, sans réseau).
//   - Cache de 10 minutes par demande ; en panne, le dernier résultat connu est rendu avec sa date (`stale: true`, `at`).
//   - Aucune tâche en arrière-plan : rien ne part sans une demande d'un module (page, panneau, chiffre demandé).
import { createHash } from "node:crypto";

export const HOST = "www.googleapis.com";
const BASE = `https://${HOST}/youtube/v3/`;
/** Quota journalier accordé par YouTube à une clé gratuite. */
export const DAILY_QUOTA = 10_000;
/** Coût de chaque appel permis, en unités de quota (barème publié par YouTube). `search.list` (100 unités) est volontairement exclu. */
export const COSTS = Object.freeze({ "channels.list": 1, "playlistItems.list": 1, "videos.list": 1 });
/** Lecture du chat d'un direct (1.2.0) : 5 unités l'appel, jamais gardée en cache (un chat périmé n'a aucun sens), aucune réponse de repli. */
export const LIVE_CHAT = "liveChatMessages.list";
export const LIVE_CHAT_COST = 5;
/** Bornes (dans un objet pour que les tests puissent les raccourcir). */
export const LIMITS = {
  timeoutMs: 8000,        // un appel réseau (ctx.api.net), file d'attente et lecture comprises
  callMs: 15_000,         // borne dure d'un appel de service, d'un bout à l'autre
  maxBytes: 1_000_000,    // corps de réponse
  cacheMs: 10 * 60_000,   // une réponse est gardée 10 minutes
  failMs: 60_000,         // après une panne, cette demande n'est pas refaite avant une minute
  authPauseMs: 10 * 60_000, // clé refusée : plus rien pendant 10 minutes (ou jusqu'au changement de clé)
  rateMs: 60_000,         // 403 « rateLimitExceeded » : petite pause
  cacheMax: 300,          // entrées gardées en mémoire (les plus anciennes partent)
  handleConcurrency: 3,   // recherches par pseudo (@nom) en même temps
  maxItems: 50,           // identifiants ou pseudos par appel
};
export const DEFAULT_BUDGET = 9000;
const NO_NETWORK = new Set(["rate", "quota", "circuit", "busy", "invalid"]);   // erreurs de ctx.api.net qui garantissent qu'aucun appel n'est parti
const AUTH_REASONS = new Set(["keyInvalid", "keyExpired", "API_KEY_INVALID", "API_KEY_EXPIRED", "accessNotConfigured", "SERVICE_DISABLED", "API_KEY_SERVICE_BLOCKED", "forbidden", "ipRefererBlocked", "API_KEY_IP_ADDRESS_BLOCKED", "API_KEY_HTTP_REFERRER_BLOCKED"]);
const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);

const CHANNEL_RE = /^UC[\w-]{22}$/;
const HANDLE_RE = /^@[\p{L}\p{N}._·-]{3,30}$/u;
const PLAYLIST_RE = /^[\w-]{10,64}$/;
const VIDEO_RE = /^[\w-]{11}$/;
const PAGE_TOKEN_RE = /^[\w-]{1,100}$/;
const CHAT_ID_RE = /^[\w.=-]{6,200}$/;
const CHAT_TOKEN_RE = /^[\w.=-]{1,400}$/;
/** Raisons de YouTube qui disent « ce chat-là n'est (plus) pas lisible », sans rien dire de la clé. */
const CHAT_ENDED = new Set(["liveChatEnded", "liveChatNotFound"]);
const CHAT_OFF = new Set(["liveChatDisabled"]);
const CHAT_DENIED = new Set(["forbidden", "insufficientPermissions", "liveChatForbidden", "authError", "required"]);

// ── Outils ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Attend `p` au plus `ms` ; au-delà, `fallback()`. Le minuteur est toujours libéré et ne retient pas le processus. */
export function within(p, ms, fallback) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback()), ms); timer.unref?.(); });
  return Promise.race([Promise.resolve(p).catch(() => fallback()), late]).finally(() => clearTimeout(timer));
}
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const iso = (t) => new Date(t).toISOString();
/** Empreinte courte d'une clé : sert à séparer les caches et les pauses quand la clé change. Jamais réversible, jamais affichée. */
const fingerprint = (key) => createHash("sha256").update(`youtube-connector:${key}`).digest("hex").slice(0, 16);
function remember(map, k, v, max = LIMITS.cacheMax) {
  map.delete(k);
  map.set(k, v);
  while (map.size > max) map.delete(map.keys().next().value);
}

/** Date du jour à Los Angeles (« 2026-10-20 ») : le jour du quota YouTube. */
export function pacificDay(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}
/** Prochain minuit à Los Angeles (remise à zéro du quota YouTube). Même calcul que le client réseau du cœur. */
export function nextPacificMidnight(now = Date.now()) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts = (t) => Object.fromEntries(fmt.formatToParts(new Date(t)).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  const p = parts(now);
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(now / 1000) * 1000;
  let at = Date.UTC(p.year, p.month - 1, p.day + 1, 0, 0, 0) - offset;
  const q = parts(at);
  if (q.hour !== 0) at -= (q.hour > 12 ? q.hour - 24 : q.hour) * 3_600_000;
  return at;
}

// ── Liste fermée des appels ──────────────────────────────────────────────────────────────────────────────────────────
const asList = (v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((x) => String(x).trim()).filter(Boolean);
function parts(value, allowed) {
  const list = [...new Set(asList(value))];
  return list.length && list.every((p) => allowed.includes(p)) ? list.sort().join(",") : null;
}
/**
 * Valide et normalise une demande : { endpoint, query } ou null (refusée sans réseau).
 *   channels.list      part ⊂ snippet,statistics,contentDetails ; `id` (1 à 50 identifiants UC…) OU `forHandle` (un pseudo @nom)
 *   playlistItems.list part ⊂ snippet,contentDetails ; `playlistId` ; `maxResults` 1 à 50 (50 par défaut) ; `pageToken` facultatif
 *   videos.list        part ⊂ snippet,contentDetails,statistics,liveStreamingDetails ; `id` (1 à 50 identifiants de vidéo) — liveStreamingDetails : début programmé d'une première ou d'un direct
 *   liveChatMessages.list (1.2.0) part ⊂ snippet,authorDetails ; `liveChatId` ; `maxResults` 200 à 500 (500 par défaut) ; `pageToken` facultatif — 5 unités, jamais en cache
 */
export function normalize(endpoint, params = {}) {
  if (endpoint === LIVE_CHAT) return normalizeChat(params);
  if (!Object.hasOwn(COSTS, endpoint) || !params || typeof params !== "object") return null;
  const q = {};
  if (endpoint === "channels.list") {
    q.part = parts(params.part ?? "snippet,statistics", ["snippet", "statistics", "contentDetails"]);
    const ids = [...new Set(asList(params.id))];
    const handle = typeof params.forHandle === "string" ? params.forHandle.trim() : "";
    if (ids.length && handle) return null;
    if (ids.length) {
      if (ids.length > LIMITS.maxItems || !ids.every((x) => CHANNEL_RE.test(x))) return null;
      q.id = ids.sort().join(",");
    } else {
      const h = handle.startsWith("@") ? handle : `@${handle}`;
      if (!HANDLE_RE.test(h)) return null;
      q.forHandle = h.toLowerCase();
    }
  } else if (endpoint === "playlistItems.list") {
    q.part = parts(params.part ?? "snippet", ["snippet", "contentDetails"]);
    if (typeof params.playlistId !== "string" || !PLAYLIST_RE.test(params.playlistId)) return null;
    q.playlistId = params.playlistId;
    const max = params.maxResults === undefined ? 50 : Number(params.maxResults);
    if (!Number.isInteger(max) || max < 1 || max > 50) return null;
    q.maxResults = String(max);
    if (params.pageToken !== undefined) { if (typeof params.pageToken !== "string" || !PAGE_TOKEN_RE.test(params.pageToken)) return null; q.pageToken = params.pageToken; }
  } else {
    q.part = parts(params.part ?? "contentDetails,statistics", ["snippet", "contentDetails", "statistics", "liveStreamingDetails"]);
    const ids = [...new Set(asList(params.id))];
    if (!ids.length || ids.length > LIMITS.maxItems || !ids.every((x) => VIDEO_RE.test(x))) return null;
    q.id = ids.sort().join(",");
  }
  if (!q.part) return null;
  const query = new URLSearchParams(Object.entries(q).sort(([a], [b]) => a.localeCompare(b)));
  return { endpoint, url: `${BASE}${endpoint.split(".")[0]}?${query}`, key: `${endpoint}?${query}`, cost: COSTS[endpoint] };
}
function normalizeChat(params) {
  if (!params || typeof params !== "object" || typeof params.liveChatId !== "string" || !CHAT_ID_RE.test(params.liveChatId)) return null;
  const part = parts(params.part ?? "snippet,authorDetails", ["snippet", "authorDetails"]);
  if (!part) return null;
  const q = { liveChatId: params.liveChatId, part };
  if (params.maxResults !== undefined) {
    const max = Number(params.maxResults);
    if (!Number.isInteger(max) || max < 200 || max > 500) return null;
    q.maxResults = String(max);
  }
  if (params.pageToken !== undefined) { if (typeof params.pageToken !== "string" || !CHAT_TOKEN_RE.test(params.pageToken)) return null; q.pageToken = params.pageToken; }
  const query = new URLSearchParams(Object.entries(q).sort(([a], [b]) => a.localeCompare(b)));
  return { endpoint: LIVE_CHAT, url: `${BASE}liveChat/messages?${query}`, key: `${LIVE_CHAT}?${query}`, cost: LIVE_CHAT_COST, chat: true };
}

// ── État d'une instance (mémoire, borné) ─────────────────────────────────────────────────────────────────────────────
const states = new Map();
function stateOf(ctx) {
  const id = String(ctx.instance?.id ?? ctx.instance?.key ?? "default");
  let st = states.get(id);
  if (!st) {
    st = { cache: new Map(), lastGood: new Map(), failUntil: new Map(), quota: null, quotaUntil: 0, rateUntil: 0, auth: null, chatDeniedUntil: 0, lastGoodAt: null };
    remember(states, id, st, 20);
  }
  return st;
}
/** Pour les tests : oublie tout (caches, compteur en mémoire, pauses). */
export function resetState() { states.clear(); }

// ── La clé ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Deux sources : le réglage « Clé YouTube » (saisi par la personne) l'emporte ; sinon la clé reprise d'un autre module par `adopt`, gardée dans le stockage.
const CREDENTIAL = "credential";
async function adoptedDoc(ctx) {
  const rows = await ctx.api.store.list(CREDENTIAL, { limit: 5 });
  return rows.find((r) => typeof r.data?.apiKey === "string" && r.data.apiKey) ?? null;
}
const settingKey = (ctx) => String(ctx.setting("apiKey") ?? "").trim();
export async function currentKey(ctx) {
  const own = settingKey(ctx);
  if (own) return own;
  return (await adoptedDoc(ctx))?.data.apiKey ?? null;
}
const refused = (st, fp, now = Date.now()) => !!st.auth && st.auth.fp === fp && st.auth.until > now;

// ── Compteur d'unités du jour (stockage + miroir en mémoire) ─────────────────────────────────────────────────────────
const QUOTA = "quota";
async function quotaOf(ctx, st, now = Date.now()) {
  if (!st.quota) {
    // Une seule lecture du stockage, même pour des demandes simultanées (sinon chacune aurait son compteur).
    st.quotaLoading ??= ctx.api.store.list(QUOTA, { limit: 5 }).then((rows) => {
      const row = rows[0];
      st.quota ??= { id: row?.id ?? null, day: typeof row?.data?.day === "string" ? row.data.day : pacificDay(now), used: Math.max(0, Math.floor(Number(row?.data?.used) || 0)) };
    }).finally(() => { st.quotaLoading = null; });
    await st.quotaLoading;
  }
  const day = pacificDay(now);
  if (st.quota.day !== day) { st.quota.day = day; st.quota.used = 0; }
  return st.quota;
}
async function saveQuota(ctx, st) {
  const q = st.quota;
  const data = { day: q.day, used: q.used };
  try {
    if (q.id && (await ctx.api.store.update(q.id, data))) return;
    q.id = await ctx.api.store.add(QUOTA, data);
  } catch { /* le compteur en mémoire reste juste ; il sera réécrit au prochain appel */ }
}
export function budgetOf(ctx) {
  const n = Number(ctx.setting("dailyBudget"));
  return Math.min(DAILY_QUOTA, Math.max(100, Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_BUDGET));
}
/** Part du budget réservée aux demandes faites par une personne (panneau d'administration…) : 1 000 sur 9 000. */
export const reserveOf = (budget) => Math.min(1000, Math.floor(budget / 9));

// ── Un appel ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function errorReasons(json) {
  const e = json && typeof json === "object" ? json.error : null;
  const out = new Set();
  for (const x of Array.isArray(e?.errors) ? e.errors : []) if (x && typeof x.reason === "string") out.add(x.reason);
  for (const x of Array.isArray(e?.details) ? e.details : []) if (x && typeof x.reason === "string") out.add(x.reason);
  return { reasons: out, message: typeof e?.message === "string" ? e.message : "" };
}

/**
 * `youtube.api` → request({ endpoint, params, priority?, timeoutMs? }).
 * Réponse : { ok: true, status, json, cost, at, cached?, stale?, error? } (stale = dernier résultat connu, daté par `at`, rendu à la place d'une erreur)
 *        ou { ok: false, error, retryAt?, status? } avec error ∈ config (aucune clé) · auth (clé refusée) · quota · rate · timeout · network · circuit · busy · invalid · too_large.
 * Ne lève jamais ; ne renvoie jamais la clé.
 */
export async function request(ctx, args = {}) {
  const spec = normalize(args?.endpoint, args?.params);
  if (!spec) return { ok: false, error: "invalid" };
  const key = await currentKey(ctx);
  if (!key) return { ok: false, error: "config" };
  const st = stateOf(ctx);
  const fp = fingerprint(key);
  const ck = `${fp}|${spec.key}`;
  const now = Date.now();
  const cost = spec.cost;
  const noCache = spec.chat === true || args.fresh === true;   // le chat, et toute demande « à jour » (par exemple : un direct a-t-il commencé ?) : ni lue ni gardée en cache, aucune réponse de repli
  const hit = noCache ? null : st.cache.get(ck);
  if (hit && hit.until > now) return { ok: true, status: 200, json: clone(hit.json), cost: 0, cached: true, at: iso(hit.at) };
  const fallback = (error, extra = {}) => {
    const last = noCache ? null : st.lastGood.get(ck);
    return last ? { ok: true, status: 200, json: clone(last.json), cost: 0, stale: true, error, at: iso(last.at), ...extra } : { ok: false, error, ...extra };
  };
  if (refused(st, fp, now)) return fallback("auth");
  if (spec.chat && st.chatDeniedUntil > now) return fallback("chat_denied", { retryAt: st.chatDeniedUntil });
  if (st.quotaUntil > now) return fallback("quota", { retryAt: st.quotaUntil });
  if (st.rateUntil > now) return fallback("rate", { retryAt: st.rateUntil });
  if ((st.failUntil.get(ck) ?? 0) > now) return fallback("network");
  // Budget : la demande est réservée AVANT l'appel (deux demandes simultanées ne peuvent pas dépasser ensemble), et rendue si rien n'est parti.
  const q = await quotaOf(ctx, st, now);
  const interactive = args.priority === "interactive";
  const budget = budgetOf(ctx);
  const limit = interactive ? budget : budget - reserveOf(budget);
  if (q.used + cost > limit) return fallback("quota", { retryAt: nextPacificMidnight(now), budget: true });
  q.used += cost;
  const timeoutMs = Math.min(LIMITS.timeoutMs, Math.max(500, Number(args.timeoutMs) || LIMITS.timeoutMs));
  const r = await ctx.api.net.request({
    url: spec.url, method: "GET", headers: { accept: "application/json", "x-goog-api-key": key },
    timeoutMs, maxBytes: LIMITS.maxBytes, priority: interactive ? "interactive" : "background", bucket: `youtube-data:${fp}`,
  });
  const charged = r.ok ? !r.shared : !NO_NETWORK.has(r.error);
  if (charged) await saveQuota(ctx, st); else q.used = Math.max(0, q.used - cost);
  const done = Date.now();
  if (!r.ok) {
    if (r.error === "quota") { st.quotaUntil = r.retryAt ?? nextPacificMidnight(done); return fallback("quota", { retryAt: st.quotaUntil }); }
    if (r.error === "rate") return fallback("rate", r.retryAt ? { retryAt: r.retryAt } : {});
    if ((r.error === "timeout" || r.error === "network") && !spec.chat) remember(st.failUntil, ck, done + LIMITS.failMs);
    return fallback(r.error, r.retryAt ? { retryAt: r.retryAt } : {});
  }
  const status = r.status;
  if (status === 200) {
    if (!r.json || typeof r.json !== "object" || Array.isArray(r.json)) { if (!spec.chat) remember(st.failUntil, ck, done + LIMITS.failMs); return fallback("network", { status }); }   // JSON tronqué ou illisible
    if (!noCache) {
      remember(st.cache, ck, { json: r.json, at: done, until: done + LIMITS.cacheMs });
      remember(st.lastGood, ck, { json: r.json, at: done });
    }
    st.lastGoodAt = done;
    st.failUntil.delete(ck);
    return { ok: true, status, json: clone(r.json), cost: charged ? cost : 0, at: iso(done) };
  }
  const { reasons, message } = errorReasons(r.json);
  if ([...reasons].some((x) => RATE_REASONS.has(x))) { st.rateUntil = done + LIMITS.rateMs; return fallback("rate", { retryAt: st.rateUntil }); }
  if (spec.chat) {
    // Le chat a ses propres réponses : un direct fini ou sans chat n'est PAS une clé refusée (sinon toute lecture de YouTube s'arrêterait 10 minutes).
    const list = [...reasons];
    if (status === 404 || list.some((x) => CHAT_ENDED.has(x))) return { ok: false, error: "chat_ended", status };
    if (list.some((x) => CHAT_OFF.has(x))) return { ok: false, error: "chat_disabled", status };
    const keyProblem = list.some((x) => AUTH_REASONS.has(x) && !CHAT_DENIED.has(x)) || /api key/i.test(message);
    if (!keyProblem && (status === 401 || status === 403)) { st.chatDeniedUntil = done + LIMITS.authPauseMs; return { ok: false, error: "chat_denied", status, retryAt: st.chatDeniedUntil }; }
  }
  if (status === 401 || status === 403 || (status === 400 && ([...reasons].some((x) => AUTH_REASONS.has(x)) || /api key/i.test(message)))) {
    st.auth = { fp, until: done + LIMITS.authPauseMs };
    return fallback("auth", { status });
  }
  if (status === 400) return { ok: false, error: "invalid", status };
  if (status >= 500) { if (!spec.chat) remember(st.failUntil, ck, done + LIMITS.failMs); return fallback("network", { status }); }
  return { ok: true, status, json: r.json && typeof r.json === "object" ? clone(r.json) : null, cost: charged ? cost : 0, at: iso(done) };   // 404… : l'appelant juge
}

// ── Infos de chaînes (nom, photo, abonnés) ───────────────────────────────────────────────────────────────────────────
const num = (v) => (/^\d{1,15}$/.test(String(v ?? "")) ? Number(v) : null);
const httpsUrl = (u) => (typeof u === "string" && /^https:\/\/[^\s"'<>]{1,500}$/.test(u) ? u : null);
function channelItem(it, at) {
  const sn = it?.snippet ?? {};
  const s = it?.statistics ?? {};
  const hidden = s.hiddenSubscriberCount === true || num(s.subscriberCount) === null;
  return {
    id: String(it?.id ?? ""), handle: typeof sn.customUrl === "string" ? sn.customUrl.slice(0, 40) : null, title: String(sn.title ?? "").slice(0, 200),
    avatar: httpsUrl(sn.thumbnails?.medium?.url) ?? httpsUrl(sn.thumbnails?.default?.url), subscribers: hidden ? null : num(s.subscriberCount), hidden,
    videos: num(s.videoCount), views: num(s.viewCount), at,
  };
}
/**
 * `youtube.api` → channels({ ids?, handles?, priority?, timeoutMs? }) : 1 à 50 chaînes par appel (identifiants UC… et/ou pseudos @nom).
 * Coût : 1 unité pour tous les identifiants (un seul appel), 1 unité par pseudo (YouTube n'en accepte qu'un par appel).
 * Réponse : { ok: true, items: [{ id, handle, title, avatar, subscribers|null, hidden, videos, views, at }], missing: [demandés introuvables ou invalides],
 *            failed: [non vérifiés], cost, stale?, error? } ou { ok: false, error, retryAt? } quand rien n'a pu être lu.
 * Les abonnés sont ceux que donne YouTube : arrondis à 3 chiffres, `null` + `hidden` si la chaîne les cache.
 */
export async function channels(ctx, args = {}) {
  const raw = [...asList(args?.ids), ...asList(args?.handles).map((h) => (h.startsWith("@") ? h : `@${h}`))];
  const wanted = [...new Set(raw)];
  if (!wanted.length) return { ok: true, items: [], missing: [], failed: [], cost: 0 };
  if (wanted.length > LIMITS.maxItems) return { ok: false, error: "invalid" };
  const ids = wanted.filter((x) => CHANNEL_RE.test(x));
  const handles = wanted.filter((x) => !CHANNEL_RE.test(x) && HANDLE_RE.test(x));
  const missing = wanted.filter((x) => !ids.includes(x) && !handles.includes(x));
  const opts = { priority: args.priority, timeoutMs: args.timeoutMs };
  const items = new Map(), failed = [], errors = [];
  let cost = 0, stale = false;
  const take = (r, asked) => {
    if (!r.ok) { failed.push(...asked); errors.push(r); return; }
    cost += r.cost ?? 0;
    if (r.stale) { stale = true; errors.push(r); }
    if (r.status !== 200) { missing.push(...asked); return; }
    const found = (Array.isArray(r.json?.items) ? r.json.items : []).map((it) => channelItem(it, r.at)).filter((x) => CHANNEL_RE.test(x.id));
    for (const it of found) items.set(it.id, it);
    if (asked.length === 1 && asked[0].startsWith("@")) { if (!found.length) missing.push(asked[0]); }
    else for (const id of asked) if (!found.some((f) => f.id === id)) missing.push(id);
  };
  if (ids.length) take(await request(ctx, { endpoint: "channels.list", params: { part: "snippet,statistics", id: ids }, ...opts }), ids);
  // Les pseudos, 3 à la fois ; rien de nouveau ne part après le délai global (le reste est rapporté dans `failed`).
  const queue = [...handles];
  const deadline = Date.now() + LIMITS.callMs - 1000;
  const worker = async () => {
    while (queue.length) {
      const h = queue.shift();
      if (Date.now() > deadline) { failed.push(h); continue; }
      take(await request(ctx, { endpoint: "channels.list", params: { part: "snippet,statistics", forHandle: h }, ...opts }), [h]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LIMITS.handleConcurrency, queue.length) }, worker));
  const list = [...items.values()];
  if (!list.length && errors.length && !missing.length) { const e = errors.find((x) => !x.ok) ?? errors[0]; return { ok: false, error: e.error, ...(e.retryAt ? { retryAt: e.retryAt } : {}) }; }
  const firstError = errors.find((x) => x.error);
  return { ok: true, items: list, missing: [...new Set(missing)], failed: [...new Set(failed)], cost, ...(stale ? { stale: true } : {}), ...(firstError ? { error: firstError.error } : {}) };
}

// ── Reprise d'une clé et état ────────────────────────────────────────────────────────────────────────────────────────
/**
 * `youtube.api` → adopt({ apiKey }) : reprend la clé d'un module qui la gardait lui-même, sans que personne la retape.
 * Réponse : { adopted: ["apiKey"] | [], ready, conflict? } — JAMAIS la valeur. Idempotent (la même clé deux fois : rien de plus).
 *   - une clé est déjà réglée ici (réglage ou reprise) : on la garde (`conflict` si l'autre est différente), `ready` dit si le Connecteur est utilisable ;
 *     exception : une clé reprise que YouTube refuse est remplacée par la nouvelle ;
 *   - `ready: true` = l'appelant peut effacer sa copie.
 */
export async function adopt(ctx, args = {}) {
  const value = typeof args?.apiKey === "string" ? args.apiKey.trim() : "";
  if (!/^[\x21-\x7e]{10,200}$/.test(value)) return { adopted: [], ready: await isReady(ctx), error: "invalid" };
  const st = stateOf(ctx);
  const own = settingKey(ctx);
  if (own) return { adopted: [], ready: !refused(st, fingerprint(own)), ...(own !== value ? { conflict: true } : {}) };
  const doc = await adoptedDoc(ctx);
  if (doc && doc.data.apiKey === value) return { adopted: [], ready: !refused(st, fingerprint(value)) };
  if (doc && !refused(st, fingerprint(doc.data.apiKey))) return { adopted: [], ready: true, conflict: true };
  const data = { apiKey: value, at: new Date().toISOString() };
  if (doc) await ctx.api.store.update(doc.id, data); else await ctx.api.store.add(CREDENTIAL, data);
  const check = await adoptedDoc(ctx);
  const ok = check?.data.apiKey === value;
  return { adopted: ok ? ["apiKey"] : [], ready: ok };
}
export async function isReady(ctx) {
  const key = await currentKey(ctx);
  return !!key && !refused(stateOf(ctx), fingerprint(key));
}
/** `youtube.api` → status() : { ready, key: "set"|"missing"|"refused", quota: { used, budget, reserve, day, resetAt, exhausted }, costs, lastGoodAt }. Aucun appel réseau. */
export async function status(ctx) {
  const now = Date.now();
  const key = await currentKey(ctx);
  const st = stateOf(ctx);
  const q = await quotaOf(ctx, st, now);
  const budget = budgetOf(ctx);
  const resetAt = nextPacificMidnight(now);
  const keyState = !key ? "missing" : refused(st, fingerprint(key), now) ? "refused" : "set";
  return {
    ready: keyState === "set", key: keyState,
    quota: { used: q.used, budget, reserve: reserveOf(budget), day: q.day, resetAt: iso(resetAt), exhausted: st.quotaUntil > now || q.used >= budget - reserveOf(budget), until: iso(st.quotaUntil > now ? st.quotaUntil : resetAt) },
    costs: { ...COSTS, [LIVE_CHAT]: LIVE_CHAT_COST }, chat: { read: keyState === "set" && st.chatDeniedUntil <= now, write: false }, lastGoodAt: st.lastGoodAt ? iso(st.lastGoodAt) : null,
  };
}
