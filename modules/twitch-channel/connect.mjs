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
const SETTINGS_TAB = "?tab=settings";
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

/* ───────────── Panneau : un bloc « connexion » ───────────── */

const sameDay = (iso, ctx) => { try { return new Date(iso).toLocaleDateString(ctx.locale, { dateStyle: "long" }); } catch { return String(iso).slice(0, 10); } };
const twitchLink = (u) => typeof u === "string" && /^https:\/\/id\.twitch\.tv\/oauth2\/authorize\?/.test(u);

/** Déclare au Connecteur les autorisations voulues par CETTE chaîne (suivi des statistiques) ; idempotent. */
export async function declare(ctx, channel) {
  const scopes = ctx.setting("trackStats") === true ? wantedScopes(ctx) : [];
  return call(ctx, "wantScopes", { channel, consumer: ctx.instance.key, slot: "main", scopes, returnTo: adminPage(ctx) });
}

/**
 * The connection of the channel to Twitch: ONE block of the core (`connection`), in the state that tells what the person can do now. `getStats`: [{ metric, result }] (cache),
 * read only once connected. Returns [] when there is nothing to connect (no statistics followed, no permission asked by another module) and nothing carried over.
 * `carried`: the channel comes from another module (the setting is empty): it is named in the summary and forgotten from the menu. `handover`: the state of the move to the Connector.
 */
export async function panel(ctx, channel, getStats, { carried = false, handover = null } = {}) {
  const tracking = ctx.setting("trackStats") === true;
  await declare(ctx, channel);
  const r = await call(ctx, "account", { channel, slot: "main" });
  const acc = r.ok && r.value?.ok ? r.value : null;
  const extras = (acc?.wanted ?? []).filter((s) => !STATS.has(s));
  const t = ctx.t;
  const forget = carried ? [{ label: t("forget"), action: "forgetAdopted", confirm: t("forget_confirm"), danger: true }] : [];
  // "Modify" leads to the settings tab: the channel and what is followed are settings of the module
  const head = { type: "connection", id: "twitch", title: t("conn_title"), summary: "", edit: { href: SETTINGS_TAB } };
  const bad = handover?.state === "conflict" ? t("handover_conflict") : handover?.state === "pending" && handover.reason === "incomplete" ? t("handover_incomplete") : "";
  if (!acc && bad) return [{ ...head, state: "notConfigured", reason: bad }];
  if (!acc || (!tracking && !extras.length && !bad)) return carried ? [{ ...head, state: "configured", summary: t("channel_summary", { channel }), menu: forget }] : [];
  const st = acc.status;
  const since = acc.health?.since ? { since: new Date(acc.health.since).toISOString() } : {};
  const url = async (force) => { const l = await call(ctx, "connectLink", { channel, slot: "main", ...(force ? { force: true } : {}), returnTo: adminPage(ctx) }); return l.ok ? l.value ?? {} : {}; };
  // not connected yet: the reason (what the last attempt said, the move to the Connector, or why Twitch must ask) and THE button
  if (st === "none") {
    const v = await url(false);
    const why = acc.result ? t(`res_${acc.result.code}`, { login: acc.result.login ?? "" }) : bad || t("conn_none");
    if (twitchLink(v.url)) return [{ ...head, state: "notConfigured", reason: why, primary: { label: t("connect"), href: v.url }, setup: [{ type: "markdown", text: t(tracking ? "conn_why" : "conn_why_chat") }] }];
    if (v.reason === "https") return [{ ...head, state: "notConfigured", reason: t("needHttps") }];
    if (v.reason === "not_ready") return [{ ...head, state: "notConfigured", reason: t("notReadyConnector"), ...(RETURN_TO.test(acc.adminPath ?? "") ? { primary: { label: t("open_connector"), href: acc.adminPath } } : {}) }];
    if (v.reason === "nothing") return [{ ...head, state: "notConfigured", reason: t("chooseOne") }];
    return [{ ...head, state: "notConfigured", reason: why }];
  }
  const stats = st === "ok" ? await getStats() : [];
  const figures = stats.flatMap(({ metric, result: x }) => (x.error ? (x.error === "config" && x.reason === "affiliate" ? [t("err_config_affiliate")] : []) : [t(`stat_line_${metric}`, { n: x.value.toLocaleString(ctx.locale) })]));
  const summary = [carried ? t("channel_summary", { channel }) : "", t("connected", { login: acc.login ?? channel, date: acc.connectedAt ? sameDay(acc.connectedAt, ctx) : "" }), ...figures].filter(Boolean).join(" · ");
  const base = { ...head, summary, menu: [{ label: t("disconnect"), action: "disconnect", confirm: t("disconnect_confirm"), danger: true }, ...forget] };
  const again = async (force) => { const v = await url(force); return twitchLink(v.url) ? { primary: { label: t("authorizeAgain"), href: v.url } } : {}; };
  if (st === "reconnect") return [{ ...base, state: "degraded", reason: acc.result ? t(`res_${acc.result.code}`, { login: acc.result.login ?? "" }) : t("reconnect"), ...since, ...(await again(false)) }];
  if (st === "more") return [{ ...base, state: "degraded", reason: acc.result ? t(`res_${acc.result.code}`, { login: acc.result.login ?? "" }) : t("morePermission"), ...since, ...(await again(false)) }];
  if (bad) return [{ ...base, state: "degraded", reason: bad, ...(handover.state === "conflict" ? await again(true) : RETURN_TO.test(acc.adminPath ?? "") ? { primary: { label: t("open_connector"), href: acc.adminPath } } : {}) }];
  // connected: Twitch may still refuse what the connector believed fine (a permission lost, an authorization withdrawn): the way out is right here
  if (stats.some(({ result: x }) => x.error === "auth")) return [{ ...base, state: "degraded", reason: t("frozen"), ...(await again(true)) }];
  const down = stats.find(({ result: x }) => x.error === "network" || x.error === "rate");
  if (down) return [{ ...base, state: "degraded", reason: t(`err_${down.result.error}`) }];
  return [{ ...base, state: "configured" }];
}

/** Déconnecter la chaîne : le Connecteur révoque et efface. */
export async function disconnect(ctx, channel) {
  const r = await call(ctx, "disconnect", { channel, slot: "main" });
  helix.forgetStats(channel || undefined);
  if (!r.ok) return { error: ctx.t("connectorMissing") };
  return { ok: ctx.t(r.value?.reached === false ? "disconnectedOffline" : "disconnected"), redirect: "?" };
}
