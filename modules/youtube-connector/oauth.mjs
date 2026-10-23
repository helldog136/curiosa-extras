// Connexion au compte YouTube du site : le flux « appareil » de Google (device code). Le Connecteur YouTube est le SEUL module qui porte l'identifiant, le code secret et les jetons.
//
// Le principe, en deux mots : l'administration affiche un court code et une adresse (google.com/device) ; la propriétaire les ouvre sur son téléphone et approuve ; le connecteur,
// qui interroge Google quand elle clique « C'est fait », reçoit alors un jeton d'accès (une heure) et un jeton de rafraîchissement (longue durée).
//   - Aucune adresse de retour à régler : le flux n'a ni redirection, ni état à vérifier dans une adresse, ni code d'autorisation qui voyage dans un navigateur. Le code de l'appareil ne sort jamais du serveur.
//   - Portées MINIMALES : `youtube.readonly` pour lire le chat ; `youtube` seulement si la propriétaire active « répondre dans le chat » (le flux appareil de Google n'accepte pas `youtube.force-ssl`).
//   - Jetons : gardés dans le stockage privé du connecteur (le cœur n'offre pas d'écriture dans un réglage secret), jamais renvoyés, jamais écrits dans un journal, jamais dans un message d'erreur.
//   - Rafraîchissement À LA DEMANDE (une seule demande à la fois, pause d'une minute après une panne) : aucun minuteur. Révocation en un clic : les jetons sont effacés ICI d'abord, puis Google est prévenu.
//   - Hôtes : liste fermée de TROIS adresses exactes (HTTPS), toutes à Google. Tout passe par ctx.api.net (délai dur, taille bornée, aucune redirection suivie).
import { createHash } from "node:crypto";

export const URLS = Object.freeze({ device: "https://oauth2.googleapis.com/device/code", token: "https://oauth2.googleapis.com/token", revoke: "https://oauth2.googleapis.com/revoke" });
const ALLOWED = new Set(Object.values(URLS));
export const SCOPE_READ = "https://www.googleapis.com/auth/youtube.readonly";
/** Écrire dans un chat demande `youtube` ou `youtube.force-ssl` ; le flux appareil de Google n'accepte que `youtube` (liste des portées permises aux appareils). */
export const SCOPE_WRITE = "https://www.googleapis.com/auth/youtube";
const SCOPE_FORCE_SSL = "https://www.googleapis.com/auth/youtube.force-ssl";
const READ_SCOPES = new Set([SCOPE_READ, SCOPE_WRITE, SCOPE_FORCE_SSL]);   // toutes permettent de lire un chat (liveChatMessages.list)
const WRITE_SCOPES = new Set([SCOPE_WRITE, SCOPE_FORCE_SSL]);              // toutes permettent d'écrire dans un chat (liveChatMessages.insert)
export const canRead = (scopes) => scopes.some((s) => READ_SCOPES.has(s));
export const canWrite = (scopes) => scopes.some((s) => WRITE_SCOPES.has(s));

/** Bornes (dans un objet pour que les tests puissent les raccourcir). */
export const LIMITS = {
  timeoutMs: 8000,            // un appel à Google, file d'attente et lecture comprises
  maxBytes: 20_000,           // corps de réponse
  accessSkewMs: 60_000,       // un jeton d'accès qui expire dans moins d'une minute est renouvelé
  refreshFailMs: 60_000,      // après une panne du rafraîchissement, plus d'essai pendant une minute
  startGapMs: 10_000,         // deux « Connecter » : au moins 10 s entre les deux
  startPerHour: 10,           // et 10 par heure
  pendingMaxMs: 30 * 60_000,  // un code n'est jamais gardé plus de 30 minutes (Google l'annonce déjà : 1 800 s)
  intervalMinMs: 3000, intervalMaxMs: 30_000, slowDownMs: 5000,
};

export const ID_RE = /^[0-9]{5,20}-[a-z0-9]{8,64}\.apps\.googleusercontent\.com$/i;
export const SECRET_RE = /^[\x21-\x7e]{8,200}$/;
const CODE_RE = /^[\x21-\x7e]{8,400}$/;      // device_code : du texte imprimable, sans espace
const USER_CODE_RE = /^[\x21-\x7e]{4,40}$/;  // user_code : idem (Google annonce des caractères ASCII imprimables)
const TOKEN_RE = /^[\x21-\x7e]{10,4096}$/;
const COLLECTIONS = { tokens: "oauth-tokens", pending: "oauth-pending", last: "oauth-last" };

/** Empreinte courte de l'identifiant client : sépare les jetons et les pauses quand il change. Jamais réversible, jamais affichée. */
const fp16 = (id) => createHash("sha256").update(`youtube-connector:oauth:${id}`).digest("hex").slice(0, 16);
export function clientOf(ctx) {
  const id = String(ctx.setting("oauthClientId") ?? "").trim();
  const secret = String(ctx.setting("oauthClientSecret") ?? "").trim();
  const idOk = ID_RE.test(id), secretOk = SECRET_RE.test(secret);
  return { id, secret, idSet: id !== "", secretSet: secret !== "", idOk, secretOk, valid: idOk && secretOk, fp: idOk ? fp16(id) : "" };
}
/** L'écriture dans le chat est-elle voulue ? Réglage avancé, désactivé par défaut. */
export const writeWanted = (ctx) => ctx.setting("chatReply") === true;

// ── État d'une instance (mémoire, borné) ─────────────────────────────────────────────────────────────────────────────
const states = new Map();
function ost(ctx) {
  const id = String(ctx.instance?.id ?? ctx.instance?.key ?? "default");
  let st = states.get(id);
  if (!st) {
    st = { docs: {}, gen: undefined, chain: Promise.resolve(), refreshing: null, refreshFailUntil: 0, starts: [] };
    states.delete(id);
    states.set(id, st);
    while (states.size > 20) states.delete(states.keys().next().value);
  }
  return st;
}
/** Pour les tests : oublie tout (copies en mémoire, pauses, essais). */
export function resetOauth() { states.clear(); }
/** Une seule opération de connexion à la fois par instance (connecter, vérifier, déconnecter ne se chevauchent jamais). */
function serial(ctx, fn) {
  const st = ost(ctx);
  const run = st.chain.then(fn, fn);
  st.chain = run.catch(() => {});
  return run;
}

// ── Stockage : un document par collection (jetons, code en attente, dernière issue) ──────────────────────────────────
async function sync(ctx, st) {
  let gen;
  try { gen = typeof ctx.api.store.generation === "function" ? await ctx.api.store.generation() : 0; } catch { gen = 0; }
  if (st.gen !== gen) { st.docs = {}; st.gen = gen; }   // les données ont été remplacées de l'extérieur (restauration…)
}
async function load(ctx, name) {
  const st = ost(ctx);
  await sync(ctx, st);
  if (st.docs[name] === undefined) {
    const rows = await ctx.api.store.list(COLLECTIONS[name], { limit: 5 });
    for (const extra of rows.slice(1)) await ctx.api.store.remove(extra.id);   // jamais deux exemplaires
    st.docs[name] = rows[0] ? { id: rows[0].id, data: rows[0].data ?? {} } : null;
  }
  return st.docs[name];
}
async function save(ctx, name, data) {
  const st = ost(ctx);
  const cur = await load(ctx, name);
  if (cur && (await ctx.api.store.update(cur.id, data))) st.docs[name] = { id: cur.id, data };
  else st.docs[name] = { id: await ctx.api.store.add(COLLECTIONS[name], data), data };
}
async function drop(ctx, name) {
  const st = ost(ctx);
  const cur = await load(ctx, name);
  if (cur) await ctx.api.store.remove(cur.id);
  st.docs[name] = null;
}
const note = (ctx, code, now = Date.now()) => save(ctx, "last", { code, at: now });

// ── Un appel à Google ────────────────────────────────────────────────────────────────────────────────────────────────
/** POST d'un formulaire vers l'une des trois adresses permises. { ok: true, status, json } ou { ok: false, error } (rate · quota · timeout · network · circuit · busy · invalid · too_large). Ne lève jamais. */
async function post(ctx, url, form, { priority = "interactive", fp = "" } = {}) {
  if (!ALLOWED.has(url)) return { ok: false, error: "invalid" };   // liste fermée : aucune autre adresse ne part
  const r = await ctx.api.net.request({
    url, method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString(),
    timeoutMs: LIMITS.timeoutMs, maxBytes: LIMITS.maxBytes, priority, bucket: `youtube-oauth:${fp}`,
  });
  if (!r.ok) return { ok: false, error: r.error, ...(r.retryAt ? { retryAt: r.retryAt } : {}) };
  return { ok: true, status: r.status, json: r.json && typeof r.json === "object" && !Array.isArray(r.json) ? r.json : null };
}
const errorOf = (r) => (typeof r?.json?.error === "string" ? r.json.error : "");
/** Les portées connues parmi celles que Google annonce (le reste est ignoré : jamais de texte libre dans nos données). */
function knownScopes(value) {
  const list = typeof value === "string" ? value.split(/\s+/) : [];
  return [...new Set(list.filter((s) => READ_SCOPES.has(s)))];
}
const clampInt = (v, min, max, def) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

/** L'adresse que la propriétaire ouvre sur son téléphone : celle de Google (https, hôte Google, sans mot de passe ni détour). Toute autre valeur est remplacée par l'adresse officielle. */
export const VERIFICATION_URL = "https://www.google.com/device";
export function safeVerificationUrl(value) {
  try {
    const u = new URL(String(value));
    if (u.protocol === "https:" && !u.username && !u.password && !u.port && !u.search && !u.hash && ["www.google.com", "google.com"].includes(u.hostname) && u.pathname.length <= 40 && /^\/[\w/-]*$/.test(u.pathname)) return `https://${u.hostname}${u.pathname}`;
  } catch { /* adresse illisible */ }
  return VERIFICATION_URL;
}

// ── Ce qu'on sait de la connexion (sans réseau) ──────────────────────────────────────────────────────────────────────
const LABEL = { [SCOPE_READ]: "read", [SCOPE_WRITE]: "manage", [SCOPE_FORCE_SSL]: "manage" };
/**
 * { configured, idSet, secretSet, state: "none" | "pending" | "connected" | "stale", read, write, scopes: ["read" | "manage"], since, pending: { userCode, url, expiresAt, wantWrite } | null, last: { code, at } | null }
 * Jamais un jeton, un code d'appareil ni un secret.
 */
export async function connection(ctx, now = Date.now()) {
  const c = clientOf(ctx);
  const [tok, pend, last] = [await load(ctx, "tokens"), await load(ctx, "pending"), await load(ctx, "last")];
  const t = tok?.data ?? null;
  const usable = !!t && typeof t.refresh === "string" && c.valid && t.fp === c.fp;
  const scopes = usable && Array.isArray(t.scopes) ? t.scopes.filter((s) => READ_SCOPES.has(s)) : [];
  const p = pend?.data;
  const live = !!p && Number(p.expiresAt) > now && p.fp === c.fp && c.valid;
  const state = usable ? "connected" : live ? "pending" : t ? "stale" : "none";
  return {
    configured: c.valid, idSet: c.idSet, secretSet: c.secretSet, state, read: canRead(scopes), write: canWrite(scopes),
    scopes: [...new Set(scopes.map((s) => LABEL[s]))], since: usable && Number(t.at) ? new Date(t.at).toISOString() : null,
    pending: live ? { userCode: String(p.userCode), url: safeVerificationUrl(p.url), expiresAt: Number(p.expiresAt), wantWrite: p.wantWrite === true } : null,
    last: last?.data && typeof last.data.code === "string" ? { code: last.data.code, at: Number(last.data.at) || 0 } : null,
  };
}

// ── Connecter : demander un code ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Demande à Google un code court à approuver sur un téléphone. { ok: true } ou { ok: false, error } avec error ∈
 * client_id · client_secret (à corriger dans les champs) · too_fast · too_many · client (Google refuse l'identifiant : mauvais type) · scope · rate · timeout · network · google.
 */
export function startConnect(ctx, { write = false, now = Date.now() } = {}) {
  return serial(ctx, async () => {
    const c = clientOf(ctx);
    if (!c.idOk) return { ok: false, error: "client_id" };
    if (!c.secretOk) return { ok: false, error: "client_secret" };
    const st = ost(ctx);
    st.starts = st.starts.filter((t) => now - t < 3_600_000);
    if (st.starts.length && now - st.starts[st.starts.length - 1] < LIMITS.startGapMs) return { ok: false, error: "too_fast" };
    if (st.starts.length >= LIMITS.startPerHour) return { ok: false, error: "too_many" };
    st.starts.push(now);
    const wantWrite = write === true;
    const r = await post(ctx, URLS.device, { client_id: c.id, scope: wantWrite ? SCOPE_WRITE : SCOPE_READ }, { fp: c.fp });
    if (!r.ok) return { ok: false, error: ["rate", "timeout", "network"].includes(r.error) ? r.error : "network" };
    const j = r.json ?? {};
    if (r.status !== 200) {
      const e = errorOf(r);
      if (j.error_code === "rate_limit_exceeded") return { ok: false, error: "rate" };
      if (e === "org_internal" || e === "admin_policy_enforced") return { ok: false, error: "policy" };
      if (r.status === 401 || e === "invalid_client" || e === "unauthorized_client") return { ok: false, error: "client" };
      if (e === "invalid_scope") return { ok: false, error: "scope" };
      return { ok: false, error: r.status >= 500 ? "network" : "google" };
    }
    if (typeof j.device_code !== "string" || !CODE_RE.test(j.device_code) || typeof j.user_code !== "string" || !USER_CODE_RE.test(j.user_code)) return { ok: false, error: "google" };
    const expiresMs = Math.min(LIMITS.pendingMaxMs, clampInt(j.expires_in, 60, 1800, 1800) * 1000);
    const intervalMs = clampInt(Number(j.interval) * 1000, LIMITS.intervalMinMs, LIMITS.intervalMaxMs, 5000);
    await save(ctx, "pending", { deviceCode: j.device_code, userCode: j.user_code, url: safeVerificationUrl(j.verification_url), expiresAt: now + expiresMs, intervalMs, nextPollAt: now + Math.min(intervalMs, 3000), wantWrite, fp: c.fp });
    await drop(ctx, "last");
    return { ok: true };
  });
}

/** Annule un code en attente (rien n'a été accordé). */
export const cancelConnect = (ctx) => serial(ctx, async () => { await drop(ctx, "pending"); await drop(ctx, "last"); return { ok: true }; });

/**
 * « C'est fait » : demande UNE fois à Google si la personne a approuvé (jamais plus souvent que l'intervalle annoncé). Résultat :
 * { ok: true, connected: true, write } · { ok: true, pending: true, waitSec } · { ok: false, error } avec error ∈ no_pending · expired · denied · policy · client · scope · rate · timeout · network · google.
 */
export function checkConnect(ctx, { now = Date.now() } = {}) {
  return serial(ctx, async () => {
    const c = clientOf(ctx);
    const row = await load(ctx, "pending");
    const p = row?.data;
    if (!p || p.fp !== c.fp || !c.valid) { if (p) await drop(ctx, "pending"); return { ok: false, error: "no_pending" }; }
    if (Number(p.expiresAt) <= now) { await drop(ctx, "pending"); await note(ctx, "code_expired", now); return { ok: false, error: "expired" }; }
    if (Number(p.nextPollAt) > now) return { ok: true, pending: true, waitSec: Math.max(1, Math.ceil((Number(p.nextPollAt) - now) / 1000)) };
    const r = await post(ctx, URLS.token, { client_id: c.id, client_secret: c.secret, device_code: p.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }, { fp: c.fp });
    if (!r.ok) return { ok: false, error: ["rate", "timeout", "network"].includes(r.error) ? r.error : "network" };
    const j = r.json ?? {};
    const e = errorOf(r);
    if (r.status === 428 || e === "authorization_pending") {
      await save(ctx, "pending", { ...p, nextPollAt: now + Number(p.intervalMs || 5000) });
      return { ok: true, pending: true, waitSec: Math.ceil(Number(p.intervalMs || 5000) / 1000) };
    }
    if (e === "slow_down") {
      const intervalMs = Math.min(LIMITS.intervalMaxMs, Number(p.intervalMs || 5000) + LIMITS.slowDownMs);
      await save(ctx, "pending", { ...p, intervalMs, nextPollAt: now + intervalMs });
      return { ok: true, pending: true, waitSec: Math.ceil(intervalMs / 1000) };
    }
    if (e === "access_denied") { await drop(ctx, "pending"); await note(ctx, "denied", now); return { ok: false, error: "denied" }; }
    if (e === "expired_token" || e === "invalid_grant") { await drop(ctx, "pending"); await note(ctx, "code_expired", now); return { ok: false, error: "expired" }; }
    if (e === "admin_policy_enforced" || e === "org_internal") { await drop(ctx, "pending"); await note(ctx, "policy", now); return { ok: false, error: "policy" }; }
    if (r.status === 401 || e === "invalid_client" || e === "unauthorized_client") { await drop(ctx, "pending"); await note(ctx, "client", now); return { ok: false, error: "client" }; }
    if (r.status >= 500) return { ok: false, error: "network" };
    if (r.status !== 200) { await drop(ctx, "pending"); await note(ctx, "google", now); return { ok: false, error: "google" }; }
    // Accordé.
    const refresh = typeof j.refresh_token === "string" && TOKEN_RE.test(j.refresh_token) ? j.refresh_token : null;
    const access = typeof j.access_token === "string" && TOKEN_RE.test(j.access_token) ? j.access_token : null;
    const scopes = knownScopes(j.scope);
    if (!refresh || !access) { await drop(ctx, "pending"); await note(ctx, "google", now); return { ok: false, error: "google" }; }
    if (!canRead(scopes)) {   // la case a été décochée sur l'écran de Google : rien d'utile n'est accordé, on le rend aussitôt
      await drop(ctx, "pending");
      await post(ctx, URLS.revoke, { token: refresh }, { fp: c.fp });
      await note(ctx, "scope_missing", now);
      return { ok: false, error: "scope" };
    }
    await save(ctx, "tokens", { refresh, access, accessUntil: now + clampInt(j.expires_in, 60, 86_400, 3600) * 1000, scopes, at: now, fp: c.fp });
    await drop(ctx, "pending");
    const write = canWrite(scopes);
    if (p.wantWrite === true && !write) await note(ctx, "write_missing", now); else await drop(ctx, "last");
    ost(ctx).refreshFailUntil = 0;
    return { ok: true, connected: true, write };
  });
}

// ── Déconnecter ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Efface les jetons ICI d'abord (toujours), puis prévient Google (au mieux). { ok: true, revoked: true | false | null } : null = rien à révoquer. */
export function disconnect(ctx) {
  return serial(ctx, async () => {
    const c = clientOf(ctx);
    const tok = (await load(ctx, "tokens"))?.data;
    await drop(ctx, "tokens"); await drop(ctx, "pending"); await drop(ctx, "last");
    const st = ost(ctx);
    st.refreshing = null; st.refreshFailUntil = 0;
    const token = typeof tok?.refresh === "string" ? tok.refresh : null;
    if (!token) return { ok: true, revoked: null };
    const r = await post(ctx, URLS.revoke, { token }, { fp: c.fp || String(tok.fp ?? "") });
    return { ok: true, revoked: r.ok && r.status === 200 };
  });
}

// ── Un jeton d'accès, à la demande ───────────────────────────────────────────────────────────────────────────────────
/**
 * Le jeton d'accès à envoyer à YouTube : { ok: true, token, scopes } ou { ok: false, error } avec error ∈
 * not_connected · scope (la portée voulue n'est pas accordée) · expired (Google a retiré l'accès : jetons effacés) · client (Google refuse l'identifiant ou le code secret) · network (panne : on réessaiera).
 * `need` : "read" ou "write". Rafraîchit seulement si le jeton expire dans moins d'une minute, une demande à la fois.
 */
export async function bearer(ctx, need = "read", { priority = "background", now = Date.now() } = {}) {
  const c = clientOf(ctx);
  const row = await load(ctx, "tokens");
  const t = row?.data;
  if (!t || !c.valid || t.fp !== c.fp || typeof t.refresh !== "string") return { ok: false, error: "not_connected" };
  const scopes = Array.isArray(t.scopes) ? t.scopes : [];
  if (need === "write" ? !canWrite(scopes) : !canRead(scopes)) return { ok: false, error: "scope" };
  if (typeof t.access === "string" && Number(t.accessUntil) - now > LIMITS.accessSkewMs) return { ok: true, token: t.access, scopes };
  const st = ost(ctx);
  if (st.refreshFailUntil > now) return { ok: false, error: "network" };
  st.refreshing ??= refresh(ctx, c, t, priority, now).finally(() => { st.refreshing = null; });
  const r = await st.refreshing;
  return r.ok ? { ok: true, token: r.token, scopes: r.scopes } : r;
}
async function refresh(ctx, c, t, priority, now) {
  const st = ost(ctx);
  const r = await post(ctx, URLS.token, { client_id: c.id, client_secret: c.secret, refresh_token: t.refresh, grant_type: "refresh_token" }, { priority, fp: c.fp });
  const transient = () => { st.refreshFailUntil = Date.now() + LIMITS.refreshFailMs; return { ok: false, error: "network" }; };
  if (!r.ok) return transient();
  const e = errorOf(r);
  if (r.status === 400 && e === "invalid_grant") {   // Google a retiré l'accès (retiré par la propriétaire sur son compte, ou expiré) : les jetons ne servent plus à rien
    await serial(ctx, async () => { await drop(ctx, "tokens"); await note(ctx, "expired"); });
    return { ok: false, error: "expired" };
  }
  if (r.status === 401 || e === "invalid_client" || e === "unauthorized_client") { st.refreshFailUntil = Date.now() + LIMITS.refreshFailMs; await note(ctx, "client"); return { ok: false, error: "client" }; }
  const access = typeof r.json?.access_token === "string" && TOKEN_RE.test(r.json.access_token) ? r.json.access_token : null;
  if (r.status !== 200 || !access) return transient();
  const newRefresh = typeof r.json.refresh_token === "string" && TOKEN_RE.test(r.json.refresh_token) ? r.json.refresh_token : t.refresh;
  const granted = knownScopes(r.json.scope);
  const scopes = granted.length ? granted : t.scopes;
  const doc = { ...t, refresh: newRefresh, access, accessUntil: Date.now() + clampInt(r.json.expires_in, 60, 86_400, 3600) * 1000, scopes };
  await save(ctx, "tokens", doc);
  return { ok: true, token: access, scopes };
}
/** YouTube a refusé le jeton d'accès (401) : il sera renouvelé à la prochaine demande. */
export async function invalidateAccess(ctx) {
  const row = await load(ctx, "tokens");
  if (row?.data) await save(ctx, "tokens", { ...row.data, access: null, accessUntil: 0 });
}
