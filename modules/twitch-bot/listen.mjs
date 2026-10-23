// L'écoute du chat : quel compte lit et répond, ce qu'il manque pour que ça marche, et l'abonnement chez Twitch (créé, surveillé, recréé).
// Les jetons ne sont jamais ici : tout passe par le service `twitch.api` du Connecteur Twitch. Ce fichier ne contient aucun détail de Twitch (voir eventsub.mjs).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const es = await import(`./eventsub.mjs${v}`);
const { ensureSecret, readState, updateState } = await import(`./state.mjs${v}`);
const { resolveChannel, firstAccount } = await import(`./channel.mjs${v}`);

const SERVICE = "twitch.api";
const ok = (r) => r.ok && r.value && r.value.ok !== false && r.value.error !== "other_channel";

/** Une adresse que Twitch peut joindre : https, un vrai nom de domaine (ni « localhost », ni une adresse IP, ni un nom interne). */
export function isPublicSite(url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  if (!h.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":") || h.startsWith("[")) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(h);
}
export const callbackOf = (ctx) => `${String(ctx.api.siteUrl ?? "").replace(/\/+$/, "")}${es.webhookPath(ctx.instance.key)}`;

/**
 * La chaîne que ce bot sert et ses comptes. { problem } ou { main, bot }. `bot` : le compte qui répond, en mode « compte bot séparé ».
 * La chaîne vient du réglage « Chaîne Twitch » (un choix parmi vos instances de Ma Chaîne Twitch, voir channel.mjs), sinon la première prête ; le Connecteur
 * répond ensuite pour CETTE chaîne (`account({ channel })` : sans `channel`, il répondrait pour la première qu'il connaît).
 */
export async function accounts(ctx, s) {
  const picked = await resolveChannel(ctx, s.channel);
  if (picked.problem === "setup") return { main: picked.account, bot: null };   // ni chaîne ni application : diagnose dit « creds_missing », avec le lien du Connecteur
  if (picked.problem) return { problem: picked.problem === "slow" ? "twitch_down" : picked.problem };
  const main = await firstAccount(ctx, { channel: picked.channel });
  if (!main) return { problem: "no_channel" };
  let bot = null;
  if (s.replyAs === "bot" && main.channel) {
    const r = (await ctx.api.services.callAll(SERVICE, "account", { slot: "bot", channel: main.channel })).find(ok);
    bot = r?.value ?? null;
  }
  return { main, bot };
}

/** Une demande à Twitch, par le Connecteur Twitch, pour `channel` : { ok: true, status, json } ou { ok: false, error }. */
export async function twitch(ctx, channel, req) {
  const all = await ctx.api.services.callAll(SERVICE, "request", { ...req, channel });
  const mine = all.find((r) => r.ok && r.value?.error !== "other_channel");
  if (!mine) return { ok: false, error: "network" };
  return mine.value;
}

const need = (s) => (s.replyAs === "bot" ? { main: es.SCOPES.ownerForBot, bot: es.SCOPES.bot } : { main: es.SCOPES.own, bot: [] });
const lacks = (acc, scopes) => scopes.filter((x) => !(acc?.scopes ?? []).includes(x));

/** Dit au Connecteur Twitch ce dont le bot a besoin pour cette chaîne (il l'ajoute à ses autorisations) — idempotent. */
export async function declareScopes(ctx, s, channel) {
  const n = need(s), returnTo = `/admin/instances/${ctx.instance.id}`;
  // Les autorisations des récompenses ne sont demandées qu'une fois la propriétaire entrée dans l'onglet Récompenses et ayant dit oui : le chat ne s'arrête jamais pour ça.
  const main = (await readState(ctx)).rewardsOn === true ? [...new Set([...n.main, ...es.REWARD_SCOPES])] : n.main;
  await ctx.api.services.callAll(SERVICE, "wantScopes", { channel, consumer: ctx.instance.key, slot: "main", scopes: main, returnTo });
  await ctx.api.services.callAll(SERVICE, "wantScopes", { channel, consumer: ctx.instance.key, slot: "bot", scopes: n.bot, returnTo });
}

/**
 * Où en est-on ? Rend toujours { code, … } ; `code` vaut "ready" quand tout est en place, sinon la PREMIÈRE chose à faire :
 * no_channel · channel_unknown · twitch_down (Ma Chaîne Twitch muette) · creds_missing · need_connect · need_reconnect · need_more · bot_need_connect · bot_reconnect · bot_more · site_private.
 * Quand tout est prêt : { code: "ready", channel, broadcasterId, senderId, slot, main, bot }.
 */
export async function diagnose(ctx, s, { declare = true } = {}) {
  let acc = await accounts(ctx, s);
  if (acc.problem) return { code: acc.problem };
  if (declare && acc.main.channel) { await declareScopes(ctx, s, acc.main.channel); acc = await accounts(ctx, s); if (acc.problem) return { code: acc.problem }; }
  const { main, bot } = acc, n = need(s);
  const base = { channel: main.channel, main, bot };
  if (!main.channel || !main.ready) return { code: "creds_missing", ...base };
  if (main.status === "none" || !main.userId) return { code: "need_connect", ...base };
  if (main.status === "reconnect") return { code: "need_reconnect", ...base };
  if (lacks(main, n.main).length) return { code: "need_more", ...base };
  if (s.replyAs === "bot") {
    if (!bot || bot.status === "none" || !bot.userId) return { code: "bot_need_connect", ...base };
    if (bot.status === "reconnect") return { code: "bot_reconnect", ...base };
    if (lacks(bot, n.bot).length) return { code: "bot_more", ...base };
  }
  if (!isPublicSite(ctx.api.siteUrl)) return { code: "site_private", ...base };
  return { code: "ready", ...base, broadcasterId: main.userId, senderId: s.replyAs === "bot" ? bot.userId : main.userId, slot: s.replyAs === "bot" ? "bot" : "main" };
}

const FAIL = { auth: "need_reconnect", scope: "need_more", config: "creds_missing", rate: "twitch_busy", network: "twitch_down" };
const record = (ctx, sub) => updateState(ctx, (d) => { d.sub = { ...sub, at: Date.now() }; });

/**
 * Vérifie que l'abonnement existe et fonctionne ; le crée ou le recrée au besoin. Rend l'état noté : { code, … }.
 * Codes de l'écoute : listening · pending · revoked_fixed… voir les textes `listen_*`. Sûr à rappeler souvent (la tâche planifiée, le bouton « Vérifier »).
 * `renew` : repart de zéro (supprime nos abonnements et change le secret).
 */
export async function ensureListening(ctx, s, { renew = false, settle = false } = {}) {
  const d = await diagnose(ctx, s);
  if (d.code !== "ready") { await record(ctx, { code: d.code }); return { code: d.code }; }
  const callback = callbackOf(ctx), ids = { broadcasterId: d.broadcasterId, userId: d.senderId };
  const mark = (o) => record(ctx, { ...o, who: ids.userId });   // pour quel compte l'écoute a été vérifiée : si le réglage change, la page le revoit
  const secret = await ensureSecret(ctx, { renew });
  const list = await twitch(ctx, d.channel, es.listRequest());
  if (!list.ok) { const code = FAIL[list.error] ?? "twitch_down"; await mark({ code }); return { code }; }
  if (list.status === 401 || list.status === 403) { await mark({ code: "need_reconnect" }); return { code: "need_reconnect" }; }
  const cls = es.classify(list.json, { callback, ...ids });
  const drop = renew ? [cls.id, ...cls.stale].filter(Boolean) : cls.stale;
  for (const id of drop) await twitch(ctx, d.channel, es.deleteRequest(id));
  const before = (await readState(ctx)).sub;
  if (!renew && cls.state === "enabled") { await mark({ code: "listening", since: before?.code === "listening" ? before.since : Date.now() }); return { code: "listening" }; }
  if (!renew && cls.state === "pending") {
    const age = before?.code === "pending" && before.pendingSince ? Date.now() - before.pendingSince : 0;
    if (age < 10 * 60_000) { await mark({ code: "pending", pendingSince: before?.pendingSince ?? Date.now() }); return { code: "pending" }; }
    await twitch(ctx, d.channel, es.deleteRequest(cls.id));
  }
  const failure = cls.state === "failed" ? es.failureCode(cls.status) : null;
  const made = await twitch(ctx, d.channel, es.createRequest({ ...ids, callback, secret }));
  if (!made.ok) { const code = FAIL[made.error] ?? "twitch_down"; await mark({ code }); return { code }; }
  const r = es.readCreate(made);
  if (r.ok || r.code === "exists") {
    // Twitch vérifie l'adresse du site juste après avoir accepté la demande : quand quelqu'un attend devant l'écran, on lui laisse quelques secondes pour que la réponse soit « oui » tout de suite.
    if (settle) for (let i = 0; i < 4; i++) {
      await new Promise((ok) => setTimeout(ok, 600));
      const again = await twitch(ctx, d.channel, es.listRequest());
      if (again.ok && es.classify(again.json, { callback, ...ids }).state === "enabled") { await mark({ code: "listening", since: Date.now(), ...(failure ? { failure } : {}) }); return { code: "listening" }; }
    }
    await mark({ code: "pending", pendingSince: Date.now(), ...(failure ? { failure } : {}) });
    return { code: "pending" };
  }
  const code = r.code === "denied" ? "need_reconnect" : r.code === "refused" ? "refused" : "twitch_down";
  await mark({ code, ...(r.detail ? { detail: r.detail } : {}), ...(failure ? { failure } : {}) });
  return { code };
}

/** Envoie un message dans le chat avec le compte qui répond. { sent: true, messageId } ou { sent: false, code, detail? } ; ne lève jamais. */
export async function sendChat(ctx, d, text) {
  const res = await twitch(ctx, d.channel, es.sendRequest({ broadcasterId: d.broadcasterId, senderId: d.senderId, text, slot: d.slot }));
  if (!res.ok) return { sent: false, code: res.error === "auth" || res.error === "scope" ? "denied" : res.error === "rate" ? "rate" : "twitch" };
  return es.readSend(res);
}

/**
 * L'abonnement aux échanges de points (même adresse, même secret, même signature que le chat : une seule route). Rend { code } : off (récompenses pas activées) · need_scope · site_private ·
 * listening · pending · refused · twitch_down · twitch_busy. Noté dans `redeemSub`. Sûr à rappeler souvent.
 */
export async function ensureRedeemListening(ctx, s, { settle = false } = {}) {
  if ((await readState(ctx)).rewardsOn !== true) return { code: "off" };
  const mark = async (code, extra = {}) => { await updateState(ctx, (d) => { d.redeemSub = { code, at: Date.now(), ...extra }; }); return { code }; };
  const acc = await accounts(ctx, s);
  const m = acc.main;
  if (acc.problem || !m?.channel || !m.userId || m.status === "none" || m.status === "reconnect" || !es.REWARD_SCOPES.every((x) => (m.scopes ?? []).includes(x))) return mark("need_scope");
  if (!isPublicSite(ctx.api.siteUrl)) return mark("site_private");
  const callback = callbackOf(ctx), ids = { broadcasterId: m.userId, callback };
  const secret = await ensureSecret(ctx);
  const list = await twitch(ctx, m.channel, es.redeemListRequest());
  if (!list.ok) return mark(list.error === "rate" ? "twitch_busy" : "twitch_down");
  if (list.status === 401 || list.status === 403) return mark("need_scope");
  const cls = es.classifyRedeem(list.json, ids);
  for (const id of cls.stale) await twitch(ctx, m.channel, es.deleteRequest(id));
  if (cls.state === "enabled") return mark("listening");
  if (cls.state === "pending") {
    const before = (await readState(ctx)).redeemSub;
    const since = before?.code === "pending" && before.since ? before.since : Date.now();
    if (Date.now() - since < 10 * 60_000) return mark("pending", { since });
    await twitch(ctx, m.channel, es.deleteRequest(cls.id));
  }
  const made = await twitch(ctx, m.channel, es.redeemCreateRequest({ ...ids, secret }));
  if (!made.ok) return mark(made.error === "rate" ? "twitch_busy" : "twitch_down");
  const r = es.readCreate(made);
  if (!(r.ok || r.code === "exists")) return mark(r.code === "denied" ? "need_scope" : r.code === "refused" ? "refused" : "twitch_down", r.detail ? { detail: r.detail } : {});
  if (settle) for (let i = 0; i < 4; i++) {
    await new Promise((ok) => setTimeout(ok, 600));
    const again = await twitch(ctx, m.channel, es.redeemListRequest());
    if (again.ok && es.classifyRedeem(again.json, ids).state === "enabled") return mark("listening");
  }
  return mark("pending", { since: Date.now() });
}
