// Connexion de la chaîne à Twitch, vue de « Ma Chaîne Twitch » 2.0. Les autorisations (et leurs jetons) appartiennent au Connecteur Twitch :
// ce fichier ne garde AUCUN jeton. Il demande au Connecteur le bouton « Connecter ma chaîne Twitch », l'état de la connexion, et relaie le retour de Twitch.
//
// Le retour de Twitch : une installation qui existait avant la 2.0 a enregistré chez Twitch l'adresse /m/<clé de cette instance>/oauth/callback.
// Elle reste valable : cette route reçoit `code` et `state` et les passe au Connecteur (méthode `exchangeCode`, avec CETTE adresse, exactement celle
// de l'autorisation). Le Connecteur vérifie l'état (usage unique, 10 minutes, lié à l'adresse) et le compte. Une nouvelle configuration utilise l'adresse
// du Connecteur, sans passer par ici.
const version = new URL(import.meta.url).search;
const helix = await import(new URL(`./helix.mjs${version}`, import.meta.url).href);

export const SERVICE = "twitch.api";
export const CALLBACK = "oauth/callback";
const RETURN_TO = /^\/admin\/instances\/[A-Za-z0-9_-]{1,64}$/;
export const slotOf = (v) => (v === "bot" ? "bot" : "main");

/** Ce que l'utilisateur veut suivre → autorisations demandées à Twitch : le MINIMUM nécessaire. */
export const wantedMetrics = (ctx) => [ctx.setting("statsFollowers") !== false && "followers", ctx.setting("statsPaying") === true && "paying"].filter(Boolean);
export const wantedScopes = (ctx) => wantedMetrics(ctx).map((m) => helix.SCOPES[m]);
const STATS = new Set(Object.values(helix.SCOPES));

/** L'adresse de retour de CETTE instance (celle qu'une installation d'avant la 2.0 a enregistrée chez Twitch). */
export const redirectOf = (ctx) => `${String(ctx.api.siteUrl ?? "").replace(/\/+$/, "")}/m/${ctx.instance.key}/${CALLBACK}`;
export const adminPage = (ctx) => `/admin/instances/${ctx.instance.id}`;

/** Un appel au Connecteur, BORNÉ : { ok: true, value } ou { ok: false, reason: "unavailable" | "undeclared" | "no_method" | "failed" | "timeout" }. Ne lève jamais. */
export async function call(ctx, method, args, ms = helix.timing.sharedMs) {
  const svc = ctx.api?.services;
  if (!svc || typeof svc.call !== "function") return { ok: false, reason: "unavailable" };
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), ms); timer.unref?.(); });
  try {
    const r = await Promise.race([Promise.resolve().then(() => svc.call(SERVICE, method, args)).catch(() => ({ ok: false, reason: "failed" })), late]);
    return r && typeof r === "object" ? r : { ok: false, reason: "failed" };
  } finally { clearTimeout(timer); }
}
export const missingConnector = (r) => !r.ok && ["unavailable", "undeclared", "no_method"].includes(r.reason);

/* ───────────── Retour de Twitch : /m/<clé>/oauth/callback (relais) ───────────── */

const bad = new Map();   // clé d'instance → { n, until } : au plus 20 retours invalides par tranche de 10 minutes
const tooMany = (key) => { const b = bad.get(key); return !!b && b.until > Date.now() && b.n >= 20; };
const noteBad = (key) => { const b = bad.get(key); if (b && b.until > Date.now()) b.n++; else bad.set(key, { n: 1, until: Date.now() + 10 * 60_000 }); if (bad.size > 200) bad.delete(bad.keys().next().value); };
export const resetConnect = () => bad.clear();

const SAFE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const page = (status, text) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Twitch</title><body style="font-family:sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><p>${String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])}</p>`, { status, headers: { ...SAFE, "Content-Type": "text/html; charset=utf-8" } });
// Toujours une page d'administration : celle donnée par le Connecteur (vérifiée ici aussi), sinon celle de CETTE instance ; jamais une adresse fournie par la requête.
const back = (ctx, to) => new Response(null, { status: 303, headers: { ...SAFE, Location: typeof to === "string" && RETURN_TO.test(to) ? to : adminPage(ctx) } });

export async function callback(request, ctx, channelOf) {
  if (request.method !== "GET") return page(405, ctx.t("cb_invalid"));
  const key = ctx.instance.key;
  if (tooMany(key)) return page(429, ctx.t("cb_invalid"));
  const q = new URL(request.url).searchParams;
  const state = q.get("state") ?? "";
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(state)) { noteBad(key); return page(400, ctx.t("cb_invalid")); }
  const r = await call(ctx, "exchangeCode", { code: q.get("code") ?? "", state, redirectUri: redirectOf(ctx), error: q.get("error") ?? "" }, helix.timing.sharedMs * 2);
  if (!r.ok) return page(503, ctx.t(missingConnector(r) ? "cb_noConnector" : "cb_down"));
  const v = r.value && typeof r.value === "object" ? r.value : {};
  if (!v.ok && v.error === "state") { noteBad(key); return page(400, ctx.t("cb_invalid")); }
  if (!v.ok && v.error === "expired") noteBad(key);
  if (v.ok) helix.forgetStats((await channelOf(ctx)) || undefined);
  return back(ctx, v.returnTo);
}

/* ───────────── Panneau : état, bouton ───────────── */

const sameDay = (iso, ctx) => { try { return new Date(iso).toLocaleDateString(ctx.locale, { dateStyle: "long" }); } catch { return String(iso).slice(0, 10); } };
const statMessage = (ctx, r) => (r.error === "config" ? ctx.t(r.reason === "affiliate" ? "err_config_affiliate" : "err_config_credentials") : ctx.t(`err_${r.error}`));
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Le bouton « Connecter ma chaîne Twitch » : un lien (adresse donnée par le Connecteur, vérifiée : toujours id.twitch.tv en https) habillé aux couleurs de l'administration. */
const button = (label, href) => ({ type: "html", html: `<p><a data-twitch-connect href="${esc(href)}" style="display:inline-block;padding:.65rem 1.25rem;border-radius:.75rem;background:var(--v-accent);color:var(--v-accent-fg);font-weight:600;text-decoration:none">${esc(label)}</a></p>` });
const twitchLink = (u) => typeof u === "string" && /^https:\/\/id\.twitch\.tv\/oauth2\/authorize\?/.test(u);

/** Déclare au Connecteur les autorisations voulues par CETTE chaîne (suivi des statistiques) ; idempotent. */
export async function declare(ctx, channel) {
  const scopes = ctx.setting("trackStats") === true ? wantedScopes(ctx) : [];
  return call(ctx, "wantScopes", { channel, consumer: ctx.instance.key, slot: "main", scopes, returnTo: adminPage(ctx) });
}

/**
 * Blocs de connexion ; `getStats` : [{ metric, result }] (cache) pour la liste des chiffres, appelée seulement une fois connecté.
 * Rend [] quand il n'y a rien à connecter (ni statistiques suivies, ni autorisation demandée par un autre module).
 */
export async function panel(ctx, channel, getStats) {
  const tracking = ctx.setting("trackStats") === true;
  await declare(ctx, channel);
  const r = await call(ctx, "account", { channel, slot: "main" });
  if (!r.ok || !r.value?.ok) return [];
  const acc = r.value;
  const extras = (acc.wanted ?? []).filter((s) => !STATS.has(s));
  if (!tracking && !extras.length) return [];
  const out = [{ type: "heading", text: ctx.t("conn_title") }];
  if (acc.result) out.push({ type: "banner", tone: "warning", text: ctx.t(`res_${acc.result.code}`, { login: acc.result.login ?? "" }) });
  const st = acc.status;
  if (st === "ok") {
    const stats = await getStats();
    out.push({ type: "banner", tone: "success", text: ctx.t("connected", { login: acc.login ?? channel, date: sameDay(acc.connectedAt ?? new Date().toISOString(), ctx) }) });
    if (extras.length) out.push({ type: "markdown", text: ctx.t("extras_note") });
    if (stats.length) out.push({ type: "table", columns: [ctx.t("col_stat"), ctx.t("col_value")], rows: stats.map(({ metric, result: x }) => [ctx.t(`stat_${metric}`), x.error ? statMessage(ctx, x) : x.value.toLocaleString(ctx.locale)]) });
    out.push({ type: "adminForm", action: "disconnect", submitLabel: ctx.t("disconnect"), fields: [] });
    return out;
  }
  if (st === "reconnect") out.push({ type: "banner", tone: "warning", text: ctx.t("reconnect") });
  else if (st === "more") out.push({ type: "banner", tone: "warning", text: ctx.t("morePermission") });
  else out.push({ type: "markdown", text: ctx.t(tracking ? "conn_why" : "conn_why_chat") });
  if (extras.length && st !== "none") out.push({ type: "markdown", text: ctx.t("extras_note") });
  const link = await call(ctx, "connectLink", { channel, slot: "main", returnTo: adminPage(ctx) });
  const v = link.ok ? link.value ?? {} : {};
  if (twitchLink(v.url)) out.push(button(ctx.t("connect"), v.url));
  else if (v.reason === "https") out.push({ type: "banner", tone: "warning", text: ctx.t("needHttps") });
  else if (v.reason === "not_ready") out.push({ type: "banner", tone: "warning", text: ctx.t("notReadyConnector"), ...(RETURN_TO.test(acc.adminPath ?? "") ? { href: acc.adminPath } : {}) });
  else if (v.reason === "nothing") out.push({ type: "banner", tone: "warning", text: ctx.t("chooseOne") });
  if (st !== "none") out.push({ type: "adminForm", action: "disconnect", submitLabel: ctx.t("disconnect"), fields: [] });
  return out;
}

/** Déconnecter la chaîne : le Connecteur révoque et efface. */
export async function disconnect(ctx, channel) {
  const r = await call(ctx, "disconnect", { channel, slot: "main" });
  helix.forgetStats(channel || undefined);
  if (!r.ok) return { error: ctx.t("connectorMissing") };
  return { ok: ctx.t(r.value?.reached === false ? "disconnectedOffline" : "disconnected"), redirect: "?" };
}
