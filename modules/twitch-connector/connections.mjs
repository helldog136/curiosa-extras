// Connexion des comptes Twitch (la chaîne, et en option un compte « bot » qui répond dans le chat) : lien d'autorisation, `state`, échange du code,
// vérification du compte, rangement des jetons, déconnexion, reprise (adopt).
//
// Le `state` n'est créé que par une demande d'un module ou du panneau d'administration (jamais par une route publique), n'existe que dans le stockage
// de CETTE instance, ne sert qu'une fois, expire en 10 minutes, est lié à l'adresse de retour exacte, et la connexion n'aboutit que si le compte autorisé
// est celui de la chaîne demandée (emplacement « main »).
import { randomBytes, timingSafeEqual } from "node:crypto";

const version = new URL(import.meta.url).search;
const oauth = await import(new URL(`./oauth.mjs${version}`, import.meta.url).href);
const store = await import(new URL(`./store.mjs${version}`, import.meta.url).href);
const { COL, slotOf, loginOf, text, plain } = store;

export const STATE_MS = 10 * 60_000;
export const CALLBACK = "oauth/callback";
const site = (ctx) => String(ctx.api.siteUrl ?? "").replace(/\/+$/, "");
/** L'adresse de retour PROPRE au Connecteur (nouvelles configurations) : à coller dans la console Twitch. */
export const ownRedirect = (ctx) => `${site(ctx)}/m/${ctx.instance.key}/${CALLBACK}`;
export const secure = (uri) => /^https:\/\//.test(uri) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(uri);
/** Une adresse de retour d'un autre module de CE site (installation reprise) : même site, chemin « /m/<clé>/oauth/callback ». */
export const validRedirect = (ctx, uri) => typeof uri === "string" && uri.length <= 300 && uri.startsWith(`${site(ctx)}/m/`) && /\/m\/[a-z][a-z0-9-]{1,30}\/oauth\/callback$/.test(uri) && !!site(ctx);
export const adminPage = (ctx) => `/admin/instances/${ctx.instance.id}`;

/** "none" | "ok" | "reconnect" (Twitch ne reconnaît plus l'autorisation, ou l'application a changé) | "more" (il manque une autorisation demandée). */
export function statusOf(doc, creds, scopes) {
  if (!doc?.access) return "none";
  if (doc.status === "reconnect" || doc.clientId !== creds.clientId) return "reconnect";
  return scopes.every((s) => (doc.scopes ?? []).includes(s)) ? "ok" : "more";
}

/** Le lien vers la page d'autorisation de Twitch. Réutilise l'état en cours s'il est encore valable et identique. */
export async function authorizeLink(ctx, creds, { channel, slot, scopes, returnTo, redirectUri }) {
  const now = Date.now();
  const list = await store.all(ctx, COL.pending, store.LIMITS.pending);
  const same = (p) => p.data.expiresAt - now > 60_000 && p.data.clientId === creds.clientId && p.data.redirectUri === redirectUri && p.data.channel === channel && p.data.slot === slot
    && (p.data.returnTo ?? null) === returnTo && [...p.data.scopes].sort().join(" ") === [...scopes].sort().join(" ");
  let state = list.find(same)?.data.state;
  if (!state) {
    // un seul lien en attente par chaîne et par emplacement ; les liens expirés partent ; jamais plus de 20 en tout
    const stale = list.filter((p) => p.data.expiresAt < now || (p.data.channel === channel && p.data.slot === slot));
    for (const p of stale) await ctx.api.store.remove(p.id);
    const left = list.filter((p) => !stale.includes(p));
    for (const p of left.slice(0, Math.max(0, left.length - (store.LIMITS.pending - 1)))) await ctx.api.store.remove(p.id);
    state = randomBytes(32).toString("base64url");
    await ctx.api.store.add(COL.pending, { state, redirectUri, scopes, channel, slot, returnTo, clientId: creds.clientId, createdAt: now, expiresAt: now + STATE_MS });
  }
  return oauth.authorizeUrl({ clientId: creds.clientId, redirectUri, scopes, state });
}

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const dropTokens = (ctx, clientId, t) => Promise.all([oauth.revoke(ctx.api.net, { clientId, token: t.access }), oauth.revoke(ctx.api.net, { clientId, token: t.refresh })]);

/**
 * Le retour de Twitch (reçu par la route du Connecteur, ou relayé par un autre module pour une installation reprise).
 * Rend { ok: true, login, slot, channel, returnTo } ou { ok: false, error: "state" | "expired" | "denied" | "network", returnTo? }. Le détail est gardé
 * pour l'administration (dernier résultat de la chaîne). Aucune valeur secrète n'est jamais rendue.
 */
export async function exchange(ctx, { code, state, redirectUri, error }) {
  const s = typeof state === "string" ? state : "";
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(s)) return { ok: false, error: "state" };
  const pending = (await store.all(ctx, COL.pending, store.LIMITS.pending)).find((p) => typeof p.data.state === "string" && same(p.data.state, s)) ?? null;
  // inconnu, déjà utilisé, forgé, ou prévu pour une autre adresse de retour : même réponse, rien n'est consommé ni écrit
  if (!pending || pending.data.redirectUri !== redirectUri) return { ok: false, error: "state" };
  await ctx.api.store.remove(pending.id);   // usage unique : consommé AVANT tout appel à Twitch
  const p = pending.data, slot = slotOf(p.slot), returnTo = p.returnTo ?? null, channel = p.channel || "";
  const fail = async (code, err, extra = {}) => { await store.setResult(ctx, channel, slot, code, extra); return { ok: false, error: err, ...(returnTo ? { returnTo } : {}) }; };
  if (p.expiresAt < Date.now()) return fail("expired", "expired");
  if (error) return fail(error === "access_denied" ? "denied" : "refused", "denied");
  const c = typeof code === "string" ? code : "";
  if (!/^[A-Za-z0-9]{10,200}$/.test(c)) return fail("refused", "denied");
  const creds = await store.credsOf(ctx);
  if (!store.hasCreds(creds) || creds.clientId !== p.clientId) return fail("refused", "denied");
  if (slot === "bot" && !channel) return fail("refused", "denied");

  const got = await oauth.exchangeCode(ctx.api.net, { clientId: creds.clientId, secret: creds.secret, code: c, redirectUri: p.redirectUri });
  if (got.error) return fail(got.error === "refused" ? "refused" : got.error, got.error === "refused" ? "denied" : "network");
  const who = await oauth.validate(ctx.api.net, got.tokens.access);
  if (who.error || who.clientId !== creds.clientId) { await dropTokens(ctx, creds.clientId, got.tokens); return fail(who.error === "network" || who.error === "rate" ? "network" : "refused", who.error === "network" || who.error === "rate" ? "network" : "denied"); }
  if (slot === "main" && channel && who.login !== channel) { await dropTokens(ctx, creds.clientId, got.tokens); return fail("wrongAccount", "denied", { login: who.login }); }   // le compte « bot » peut être n'importe quel compte : c'est tout son intérêt
  if (!p.scopes.every((x) => who.scopes.includes(x))) { await dropTokens(ctx, creds.clientId, got.tokens); return fail("scope", "denied"); }

  const owner = slot === "main" ? who.login : channel;
  const doc = { slot, channel: owner, login: who.login, userId: who.userId, access: got.tokens.access, refresh: got.tokens.refresh, expiresAt: got.tokens.expiresAt, scopes: who.scopes, clientId: creds.clientId, status: "ok", connectedAt: new Date().toISOString() };
  const old = await store.connOf(ctx, slot, owner);
  if (!old && (await store.conns(ctx)).length >= store.LIMITS.conns) { await dropTokens(ctx, creds.clientId, got.tokens); return fail("refused", "denied"); }
  if (old) await ctx.api.store.update(old.id, doc); else await ctx.api.store.add(COL.conns, doc);
  if (old?.data?.refresh && old.data.refresh !== doc.refresh) await dropTokens(ctx, old.data.clientId, old.data);   // une connexion par compte : l'ancienne est révoquée
  if (slot === "main") await store.remember(ctx, owner);
  await store.clearResult(ctx, channel, slot);
  if (owner !== channel) await store.clearResult(ctx, owner, slot);
  return { ok: true, login: who.login, slot, channel: owner, ...(returnTo ? { returnTo } : {}) };
}

/** Déconnecte un compte : ses deux jetons sont révoqués chez Twitch (au mieux), puis effacés ici quoi qu'il arrive. { found, reached }. */
export async function disconnect(ctx, docOrNull) {
  if (!docOrNull) return { found: false, reached: true };
  const d = docOrNull.data;
  const reached = (await dropTokens(ctx, d.clientId, d)).every(Boolean);
  await ctx.api.store.remove(docOrNull.id);
  for (const p of await store.all(ctx, COL.pending, store.LIMITS.pending)) if (p.data.channel === d.channel && p.data.slot === d.slot) await ctx.api.store.remove(p.id);
  await store.clearResult(ctx, d.channel, d.slot);
  return { found: true, reached };
}

/* ───────────── Reprise (adopt) ───────────── */

const shortList = (v, max, test) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && test(x)).slice(0, max) : []);
const tokenText = (v) => (typeof v === "string" && /^\S{1,2000}$/.test(v) ? v : "");

/**
 * Reprend l'application et les connexions d'un autre module, SANS ressaisie : les valeurs ne transitent qu'en mémoire et ne sont jamais rendues.
 * Les réglages saisis ici, l'application déjà reprise et les connexions déjà présentes ne sont JAMAIS écrasés (idempotent).
 * Une autre application (autre identifiant) est refusée : { ok: false, error: "conflict", adopted: [], ready: false }.
 * Sinon { ok: true, adopted: ["clientId", "clientSecret", "main", "bot"…], ready } ; `ready` : l'application est complète ET chaque connexion fournie est présente.
 */
export async function adopt(ctx, args) {
  const a = args && typeof args === "object" ? args : {};
  const incoming = { clientId: plain(a.clientId), secret: plain(a.clientSecret) };
  const before = await store.credsOf(ctx);
  if (incoming.clientId && before.clientId && incoming.clientId !== before.clientId) return { ok: false, error: "conflict", adopted: [], ready: false };
  const adopted = [];
  const ownSet = { clientId: text(ctx.setting("appClientId")), secret: text(ctx.setting("appSecret")) };
  const appDoc = await store.first(ctx, COL.app);
  const had = appDoc?.data ?? {};
  const next = { ...had };
  if (incoming.clientId && !ownSet.clientId && !text(had.clientId)) { next.clientId = incoming.clientId; adopted.push("clientId"); }
  // le secret ne va qu'avec SON application : repris seulement si l'identifiant retenu est celui qui arrive
  const clientId = ownSet.clientId || text(next.clientId);
  if (incoming.secret && !ownSet.secret && !text(had.clientSecret) && (!incoming.clientId || incoming.clientId === clientId)) { next.clientSecret = incoming.secret; adopted.push("clientSecret"); }
  if (adopted.length) await store.put(ctx, COL.app, appDoc, next);
  const creds = await store.credsOf(ctx);

  const channel = store.loginOf(a.channel);
  if (channel) await store.remember(ctx, channel, validRedirect(ctx, a.redirectUri) ? a.redirectUri : undefined);
  let complete = true;
  const list = Array.isArray(a.connections) ? a.connections.slice(0, 4) : [];
  for (const raw of list) {
    const c = raw && typeof raw === "object" ? raw : {};
    const slot = c.slot === "bot" ? "bot" : c.slot === "main" ? "main" : null;
    const login = loginOf(c.login);
    const access = tokenText(c.accessToken), refresh = tokenText(c.refreshToken);
    const owner = slot === "main" ? login : channel || loginOf(c.channel);
    if (!slot || !login || !owner || !access || !refresh) { complete = false; continue; }
    if (c.clientId !== undefined && plain(c.clientId) !== creds.clientId) { complete = false; continue; }   // un jeton d'une autre application ne servirait à rien
    const exists = await store.connOf(ctx, slot, owner);
    if (exists) { if (exists.data.login !== login) complete = false; continue; }   // jamais d'écrasement
    if ((await store.conns(ctx)).length >= store.LIMITS.conns) { complete = false; continue; }
    await ctx.api.store.add(COL.conns, {
      slot, channel: owner, login, userId: /^[0-9]{1,20}$/.test(text(c.userId)) ? text(c.userId) : null, access, refresh,
      expiresAt: Number.isFinite(c.expiresAt) ? c.expiresAt : 0, scopes: shortList(c.scopes, 30, (s) => /^[a-z:_]{1,60}$/.test(s)),
      clientId: creds.clientId, status: c.status === "reconnect" ? "reconnect" : "ok", connectedAt: typeof c.connectedAt === "string" ? c.connectedAt.slice(0, 40) : new Date().toISOString(),
    });
    if (slot === "main") await store.remember(ctx, owner);
    adopted.push(slot);
  }
  if (channel) for (const w of Array.isArray(a.wants) ? a.wants.slice(0, 10) : []) if (w && typeof w === "object") await store.want(ctx, { channel, consumer: w.consumer, slot: w.slot, scopes: w.scopes, returnTo: w.returnTo });
  return { ok: true, adopted, ready: store.hasCreds(creds) && complete };
}
