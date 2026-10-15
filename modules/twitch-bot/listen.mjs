// L'écoute du chat : quel compte lit et répond, ce qu'il manque pour que ça marche, et l'abonnement chez Twitch (créé, surveillé, recréé).
// Les jetons ne sont jamais ici : tout passe par le service `twitch.api` de Chaîne Twitch. Ce fichier ne contient aucun détail de Twitch (voir eventsub.mjs).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const es = await import(`./eventsub.mjs${v}`);
const { ensureSecret, readState, updateState } = await import(`./state.mjs${v}`);

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

/** Les chaînes Twitch connues du site et celle que ce bot sert. { problem } ou { main, bot }. `bot` : le compte qui répond, en mode « compte bot séparé ». */
export async function accounts(ctx, s) {
  const all = (await ctx.api.services.callAll(SERVICE, "account", {})).filter(ok).map((r) => r.value);
  if (!all.length) return { problem: "no_channel" };
  const main = s.channel ? all.find((a) => a.channel === s.channel) : all.find((a) => a.channel) ?? all[0];
  if (!main) return { problem: "channel_unknown" };
  let bot = null;
  if (s.replyAs === "bot" && main.channel) {
    const r = (await ctx.api.services.callAll(SERVICE, "account", { slot: "bot", channel: main.channel })).find(ok);
    bot = r?.value ?? null;
  }
  return { main, bot };
}

/** Une demande à Twitch, via la Chaîne Twitch de `channel` : { ok: true, status, json } ou { ok: false, error }. */
export async function twitch(ctx, channel, req) {
  const all = await ctx.api.services.callAll(SERVICE, "request", { ...req, channel });
  const mine = all.find((r) => r.ok && r.value?.error !== "other_channel");
  if (!mine) return { ok: false, error: "network" };
  return mine.value;
}

const need = (s) => (s.replyAs === "bot" ? { main: es.SCOPES.ownerForBot, bot: es.SCOPES.bot } : { main: es.SCOPES.own, bot: [] });
const lacks = (acc, scopes) => scopes.filter((x) => !(acc?.scopes ?? []).includes(x));

/** Dit à Chaîne Twitch ce dont le bot a besoin (elle l'ajoute à ses autorisations) — idempotent. */
export async function declareScopes(ctx, s, channel) {
  const n = need(s), returnTo = `/admin/instances/${ctx.instance.id}`;
  await ctx.api.services.callAll(SERVICE, "wantScopes", { channel, consumer: ctx.instance.key, slot: "main", scopes: n.main, returnTo });
  await ctx.api.services.callAll(SERVICE, "wantScopes", { channel, consumer: ctx.instance.key, slot: "bot", scopes: n.bot, returnTo });
}

/**
 * Où en est-on ? Rend toujours { code, … } ; `code` vaut "ready" quand tout est en place, sinon la PREMIÈRE chose à faire :
 * no_channel · channel_unknown · creds_missing · need_connect · need_reconnect · need_more · bot_need_connect · bot_reconnect · bot_more · site_private.
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
export async function ensureListening(ctx, s, { renew = false } = {}) {
  const d = await diagnose(ctx, s);
  if (d.code !== "ready") { await record(ctx, { code: d.code }); return { code: d.code }; }
  const callback = callbackOf(ctx), ids = { broadcasterId: d.broadcasterId, userId: d.senderId };
  const secret = await ensureSecret(ctx, { renew });
  const list = await twitch(ctx, d.channel, es.listRequest());
  if (!list.ok) { const code = FAIL[list.error] ?? "twitch_down"; await record(ctx, { code }); return { code }; }
  if (list.status === 401 || list.status === 403) { await record(ctx, { code: "need_reconnect" }); return { code: "need_reconnect" }; }
  const cls = es.classify(list.json, { callback, ...ids });
  const drop = renew ? [cls.id, ...cls.stale].filter(Boolean) : cls.stale;
  for (const id of drop) await twitch(ctx, d.channel, es.deleteRequest(id));
  const before = (await readState(ctx)).sub;
  if (!renew && cls.state === "enabled") { await record(ctx, { code: "listening", since: before?.code === "listening" ? before.since : Date.now() }); return { code: "listening" }; }
  if (!renew && cls.state === "pending") {
    const age = before?.code === "pending" && before.pendingSince ? Date.now() - before.pendingSince : 0;
    if (age < 10 * 60_000) { await record(ctx, { code: "pending", pendingSince: before?.pendingSince ?? Date.now() }); return { code: "pending" }; }
    await twitch(ctx, d.channel, es.deleteRequest(cls.id));
  }
  const failure = cls.state === "failed" ? es.failureCode(cls.status) : null;
  const made = await twitch(ctx, d.channel, es.createRequest({ ...ids, callback, secret }));
  if (!made.ok) { const code = FAIL[made.error] ?? "twitch_down"; await record(ctx, { code }); return { code }; }
  const r = es.readCreate(made);
  if (r.ok || r.code === "exists") { await record(ctx, { code: "pending", pendingSince: Date.now(), ...(failure ? { failure } : {}) }); return { code: "pending" }; }
  const code = r.code === "denied" ? "need_reconnect" : r.code === "refused" ? "refused" : "twitch_down";
  await record(ctx, { code, ...(r.detail ? { detail: r.detail } : {}), ...(failure ? { failure } : {}) });
  return { code };
}

/** Envoie un message dans le chat avec le compte qui répond. { sent: true, messageId } ou { sent: false, code, detail? } ; ne lève jamais. */
export async function sendChat(ctx, d, text) {
  const res = await twitch(ctx, d.channel, es.sendRequest({ broadcasterId: d.broadcasterId, senderId: d.senderId, text, slot: d.slot }));
  if (!res.ok) return { sent: false, code: res.error === "auth" || res.error === "scope" ? "denied" : res.error === "rate" ? "rate" : "twitch" };
  return es.readSend(res);
}
