// Connexion du compte Twitch de l'administrateur : bouton, adresse de retour, `state`, rappel, jetons, déconnexion.
// Les jetons (accès + renouvellement) vivent UNIQUEMENT dans le stockage privé de l'instance (ctx.api.store : une instance ne lit jamais celui d'une autre).
// Ils ne sont jamais un réglage, jamais affichés, jamais journalisés, jamais renvoyés par une route, un export, un service ni une action d'assistant.
//
// Pourquoi le `state` ne peut pas être « lié à la session de l'administrateur » : une route de module ne reçoit que la requête et le contexte du module, le cœur ne lui dit pas
// qui est connecté. Il est donc lié à ce que le cœur garantit : il n'est créé que dans le panneau d'administration (réservé aux administrateurs), n'existe que dans le stockage de
// CETTE instance, ne sert qu'une fois, expire en 10 minutes, et la connexion n'aboutit que si le compte Twitch autorisé est celui de la chaîne réglée.
import { randomBytes, timingSafeEqual } from "node:crypto";

const version = new URL(import.meta.url).search;
const helix = await import(new URL(`./helix.mjs${version}`, import.meta.url).href);
const oauth = await import(new URL(`./oauth.mjs${version}`, import.meta.url).href);

const STATE_MS = 10 * 60_000;
// Deux connexions possibles par instance : la chaîne elle-même ("main") et, en option avancée du Bot Twitch, un compte distinct qui répond dans le chat ("bot").
// Les jetons des deux restent ICI (jamais dans le module qui les demande) ; `WANTS` garde les autorisations supplémentaires que d'autres modules ont demandées.
const CONNS = { main: "twitchConnection", bot: "twitchBotConnection" };
const PENDING = "twitchPending", RESULT = "twitchResult", WANTS = "twitchWants";
export const slotOf = (v) => (v === "bot" ? "bot" : "main");
/** Autorisations que d'autres modules peuvent demander en plus (liste fermée : on n'accorde jamais autre chose à leur demande). */
export const EXTRA_SCOPES = ["user:read:chat", "user:write:chat", "user:bot", "channel:bot"];
const RETURN_TO = /^\/admin\/instances\/[A-Za-z0-9_-]{1,64}$/;
const first = async (ctx, col) => { try { return (await ctx.api.store.list(col, { limit: 1 }))[0] ?? null; } catch { return null; } };
const all = async (ctx, col) => { try { return await ctx.api.store.list(col, { limit: 20 }); } catch { return []; } };
const wipe = async (ctx, col) => { for (const d of await all(ctx, col)) await ctx.api.store.remove(d.id); };
const setResult = async (ctx, code, extra = {}) => { await wipe(ctx, RESULT); await ctx.api.store.add(RESULT, { code, at: new Date().toISOString(), ...extra }); };

/** Le document de connexion de l'emplacement demandé ({ access, refresh, scopes, userId, login… }) ou null. */
export const docOf = async (ctx, slot = "main") => (await first(ctx, CONNS[slotOf(slot)]))?.data ?? null;
/** Le dernier résultat d'une tentative de connexion pour cet emplacement ({ code, login? }) ou null. */
export async function resultOf(ctx, slot = "main") {
  const r = (await first(ctx, RESULT))?.data ?? null;
  return r && slotOf(r.slot) === slotOf(slot) ? r : null;
}

/** Autorisations supplémentaires demandées par d'autres modules pour cet emplacement (union, ordre stable). */
export async function extraScopes(ctx, slot = "main") {
  const out = new Set();
  for (const d of await all(ctx, WANTS)) if (slotOf(d.data.slot) === slotOf(slot)) for (const s of d.data.scopes ?? []) if (EXTRA_SCOPES.includes(s)) out.add(s);
  return [...out].sort();
}
/** Un module dit ce dont il a besoin ; on ne garde que des autorisations connues, et on n'écrit que si ça change. */
export async function want(ctx, { consumer, slot, scopes, returnTo }) {
  const who = String(consumer ?? "");
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(who)) return { ok: false, error: "invalid" };
  const list = [...new Set((Array.isArray(scopes) ? scopes : []).filter((s) => EXTRA_SCOPES.includes(s)))].sort();
  const back = typeof returnTo === "string" && RETURN_TO.test(returnTo) ? returnTo : null;
  const mine = (await all(ctx, WANTS)).filter((d) => d.data.consumer === who && slotOf(d.data.slot) === slotOf(slot));
  const next = { consumer: who, slot: slotOf(slot), scopes: list, returnTo: back };
  const [keep, ...extra] = mine;
  for (const d of extra) await ctx.api.store.remove(d.id);
  if (!list.length) { if (keep) await ctx.api.store.remove(keep.id); return { ok: true, scopes: [] }; }
  if (!keep) await ctx.api.store.add(WANTS, next);
  else if (JSON.stringify(keep.data) !== JSON.stringify(next)) await ctx.api.store.update(keep.id, next);
  return { ok: true, scopes: list };
}
/** Où revenir après la connexion d'un compte demandé par un autre module (page d'admin de CE module), sinon null. */
export async function returnPath(ctx, slot) {
  const d = (await all(ctx, WANTS)).find((x) => slotOf(x.data.slot) === slotOf(slot) && x.data.returnTo);
  return d?.data.returnTo ?? null;
}

/** Ce que l'utilisateur veut suivre → portées demandées à Twitch : le MINIMUM nécessaire. */
export const wantedMetrics = (ctx) => [ctx.setting("statsFollowers") !== false && "followers", ctx.setting("statsPaying") === true && "paying"].filter(Boolean);
export const wantedScopes = (ctx) => wantedMetrics(ctx).map((m) => oauth.SCOPES[m]);

/** L'adresse EXACTE à enregistrer dans la console Twitch (une par instance). */
export const redirectOf = (ctx) => `${String(ctx.api.siteUrl ?? "").replace(/\/+$/, "")}/m/${ctx.instance.key}/oauth/callback`;
export const secureSite = (ctx) => /^https:\/\//.test(redirectOf(ctx)) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(redirectOf(ctx));
export const adminPage = (ctx) => `/admin/instances/${ctx.instance.id}`;

/** Le lien vers la connexion de Twitch (état à usage unique, créé ici — jamais par une route publique). Réutilise l'état en cours s'il est encore valable et identique. */
export async function authorizeLink(ctx, creds, scopes, slot = "main", returnTo = null) {
  const redirectUri = redirectOf(ctx), now = Date.now();
  const pending = await all(ctx, PENDING);
  const same = (p) => p.data.expiresAt - now > 60_000 && p.data.clientId === creds.clientId && p.data.redirectUri === redirectUri && slotOf(p.data.slot) === slotOf(slot) && (p.data.returnTo ?? null) === returnTo && [...p.data.scopes].sort().join(" ") === [...scopes].sort().join(" ");
  let state = pending.find(same)?.data.state;
  if (!state) {
    for (const p of pending) await ctx.api.store.remove(p.id);
    state = randomBytes(32).toString("base64url");
    await ctx.api.store.add(PENDING, { state, redirectUri, scopes, slot: slotOf(slot), returnTo, clientId: creds.clientId, createdAt: now, expiresAt: now + STATE_MS });
  }
  return oauth.authorizeUrl({ clientId: creds.clientId, redirectUri, scopes, state });
}

/** La connexion vue par helix.mjs : lecture/écriture du document de l'instance, rien d'autre. */
export function liveConn(ctx, creds, slot = "main") {
  const col = CONNS[slotOf(slot)];
  return {
    key: slotOf(slot) === "main" ? ctx.instance.key : `${ctx.instance.key}#bot`, channel: creds.channel, clientId: creds.clientId, secret: creds.secret,
    load: async () => (await first(ctx, col))?.data ?? null,
    save: async (doc) => { const d = await first(ctx, col); if (d) await ctx.api.store.update(d.id, doc); },
  };
}

/** "none" | "ok" | "reconnect" (Twitch ne reconnaît plus l'autorisation, ou l'application a changé) | "more" (une statistique ajoutée demande une autorisation de plus). */
export function status(doc, creds, scopes) {
  if (!doc?.access) return "none";
  if (doc.status === "reconnect" || doc.clientId !== creds.clientId) return "reconnect";
  return scopes.every((s) => (doc.scopes ?? []).includes(s)) ? "ok" : "more";
}

/* ───────────── Rappel de Twitch : /m/<clé>/oauth/callback ───────────── */

const bad = new Map();   // clé d'instance → { n, until } : au plus 20 appels invalides par tranche de 10 minutes
const tooMany = (key) => { const b = bad.get(key); return !!b && b.until > Date.now() && b.n >= 20; };
const noteBad = (key) => { const b = bad.get(key); if (b && b.until > Date.now()) b.n++; else bad.set(key, { n: 1, until: Date.now() + STATE_MS }); };
export const resetConnect = () => bad.clear();

const SAFE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const page = (status, text) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Twitch</title><body style="font-family:sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><p>${String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])}</p>`, { status, headers: { ...SAFE, "Content-Type": "text/html; charset=utf-8" } });
// Toujours une page d'admin : celle de CETTE instance, ou celle du module qui a demandé la connexion (adresse vérifiée à l'enregistrement ET ici), jamais une adresse fournie par la requête.
const back = (ctx, to) => new Response(null, { status: 303, headers: { ...SAFE, Location: typeof to === "string" && RETURN_TO.test(to) ? to : adminPage(ctx) } });
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export async function callback(request, ctx, credentialsOf) {
  if (request.method !== "GET") return page(405, ctx.t("cb_invalid"));
  const key = ctx.instance.key;
  if (tooMany(key)) return page(429, ctx.t("cb_invalid"));
  const q = new URL(request.url).searchParams;
  const state = q.get("state") ?? "";
  let pending = null;
  if (/^[A-Za-z0-9_-]{20,100}$/.test(state)) pending = (await all(ctx, PENDING)).find((p) => typeof p.data.state === "string" && same(p.data.state, state)) ?? null;
  if (!pending) { noteBad(key); return page(400, ctx.t("cb_invalid")); }   // inconnu, déjà utilisé, forgé ou d'une autre instance : même réponse, rien n'est écrit
  await ctx.api.store.remove(pending.id);   // usage unique : consommé AVANT tout appel à Twitch
  const slot = slotOf(pending.data.slot), to = pending.data.returnTo ?? null;
  if (pending.data.expiresAt < Date.now()) { noteBad(key); await setResult(ctx, "expired", { slot }); return back(ctx, to); }
  await wipe(ctx, RESULT);
  const creds = await credentialsOf(ctx);
  const fail = async (code, extra) => { await setResult(ctx, code, { slot, ...extra }); return back(ctx, to); };
  if (q.get("error")) return fail(q.get("error") === "access_denied" ? "denied" : "refused");
  const code = q.get("code") ?? "";
  if (!/^[A-Za-z0-9]{10,200}$/.test(code)) return fail("refused");
  if (!helix.valid(creds) || creds.clientId !== pending.data.clientId || redirectOf(ctx) !== pending.data.redirectUri) return fail("refused");

  const got = await oauth.exchangeCode({ clientId: creds.clientId, secret: creds.secret, code, redirectUri: pending.data.redirectUri });
  if (got.error) return fail(got.error === "rate" ? "rate" : got.error === "network" ? "network" : "refused");
  const who = await oauth.validate(got.tokens.access);
  const drop = () => Promise.all([oauth.revoke({ clientId: creds.clientId, token: got.tokens.access }), oauth.revoke({ clientId: creds.clientId, token: got.tokens.refresh })]);
  if (who.error || who.clientId !== creds.clientId) { await drop(); return fail(who.error === "network" ? "network" : "refused"); }
  if (slot === "main" && who.login !== creds.channel) { await drop(); return fail("wrongAccount", { login: who.login }); }   // le compte « bot » peut être n'importe quel compte : c'est tout son intérêt
  if (!pending.data.scopes.every((s) => who.scopes.includes(s))) { await drop(); return fail("scope"); }

  const old = await first(ctx, CONNS[slot]);
  const doc = { access: got.tokens.access, refresh: got.tokens.refresh, expiresAt: got.tokens.expiresAt, scopes: who.scopes, userId: who.userId, login: who.login, connectedAt: new Date().toISOString(), clientId: creds.clientId, status: "ok" };
  if (old) await ctx.api.store.update(old.id, doc); else await ctx.api.store.add(CONNS[slot], doc);
  if (old?.data?.refresh && old.data.refresh !== doc.refresh) { await oauth.revoke({ clientId: old.data.clientId, token: old.data.access }); await oauth.revoke({ clientId: old.data.clientId, token: old.data.refresh }); }
  helix.forgetStats(creds.channel);
  return back(ctx, to);
}

/* ───────────── Déconnexion ───────────── */

export async function disconnect(ctx, slot = "main") {
  const doc = await first(ctx, CONNS[slotOf(slot)]);
  let reached = true;
  if (doc) {
    const rs = await Promise.all([oauth.revoke({ clientId: doc.data.clientId, token: doc.data.access }), oauth.revoke({ clientId: doc.data.clientId, token: doc.data.refresh })]);
    reached = rs.every(Boolean);
    await ctx.api.store.remove(doc.id);
    helix.forgetStats();
  }
  await wipe(ctx, PENDING); await wipe(ctx, RESULT);
  if (slotOf(slot) === "bot") return { ok: reached };
  return { ok: ctx.t(reached ? "disconnected" : "disconnectedOffline"), redirect: "?" };
}

/* ───────────── Panneau : guide, bouton, état ───────────── */

const sameDay = (iso, ctx) => { try { return new Date(iso).toLocaleDateString(ctx.locale, { dateStyle: "long" }); } catch { return String(iso).slice(0, 10); } };
const statMessage = (ctx, r) => (r.error === "config" ? ctx.t(r.reason === "affiliate" ? "err_config_affiliate" : "err_config_credentials") : ctx.t(`err_${r.error}`));

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Le bouton « Connecter ma chaîne Twitch » : un lien (adresse construite ici, toujours id.twitch.tv en https) habillé aux couleurs de l'administration. */
const button = (label, href) => ({ type: "html", html: `<p><a data-twitch-connect href="${esc(href)}" style="display:inline-block;padding:.65rem 1.25rem;border-radius:.75rem;background:var(--v-accent);color:var(--v-accent-fg);font-weight:600;text-decoration:none">${esc(label)}</a></p>` });

/** Blocs de connexion ; `getStats` : [{ metric, result }] (cache) pour la liste des chiffres, appelée seulement une fois connecté. */
export async function panel(ctx, creds, getStats) {
  const extras = await extraScopes(ctx, "main");
  const tracking = ctx.setting("trackStats") === true;   // sans le suivi des statistiques, seules les autorisations demandées par d'autres modules comptent
  const scopes = [...new Set([...(tracking ? wantedScopes(ctx) : []), ...extras])];
  const doc = await docOf(ctx, "main");
  const st = status(doc, creds, scopes);
  const result = await resultOf(ctx, "main");
  const out = [{ type: "heading", text: ctx.t("conn_title") }];
  if (result) out.push({ type: "banner", tone: "warning", text: ctx.t(`res_${result.code}`, { login: result.login ?? "" }) });
  const ready = helix.valid(creds), site = secureSite(ctx);

  if (st === "ok") {
    const stats = await getStats();
    out.push({ type: "banner", tone: "success", text: ctx.t("connected", { login: doc.login, date: sameDay(doc.connectedAt, ctx) }) });
    if (extras.length) out.push({ type: "markdown", text: ctx.t("extras_note") });
    if (stats.length) out.push({ type: "table", columns: [ctx.t("col_stat"), ctx.t("col_value")], rows: stats.map(({ metric, result: r }) => [ctx.t(`stat_${metric}`), r.error ? statMessage(ctx, r) : r.value.toLocaleString(ctx.locale)]) });
    out.push({ type: "adminForm", action: "disconnect", submitLabel: ctx.t("disconnect"), fields: [] });
    return out;
  }
  if (st === "reconnect") out.push({ type: "banner", tone: "warning", text: ctx.t("reconnect") });
  else if (st === "more") out.push({ type: "banner", tone: "warning", text: ctx.t("morePermission") });
  else out.push({ type: "markdown", text: ctx.t(tracking ? "conn_why" : "conn_why_chat") });
  if (extras.length && st !== "none") out.push({ type: "markdown", text: ctx.t("extras_note") });

  if (st === "none") {
    out.push({ type: "markdown", text: [ctx.t("conn_step1"), ctx.t("conn_step2")].join("\n\n") });
    out.push({ type: "copy", label: ctx.t("conn_copyLabel"), text: redirectOf(ctx) });
    out.push({ type: "markdown", text: [ctx.t("conn_step3"), ctx.t("conn_step4")].join("\n\n") });
  }
  if (!site) out.push({ type: "banner", tone: "warning", text: ctx.t("needHttps") });
  else if (!ready) out.push({ type: "banner", tone: "warning", text: ctx.t("notReadyCreds") });
  else if (!scopes.length) out.push({ type: "banner", tone: "warning", text: ctx.t("chooseOne") });
  else out.push(button(ctx.t("connect"), await authorizeLink(ctx, creds, scopes, "main", await returnPath(ctx, "main"))));
  if (st !== "none") out.push({ type: "adminForm", action: "disconnect", submitLabel: ctx.t("disconnect"), fields: [] });
  return out;
}
