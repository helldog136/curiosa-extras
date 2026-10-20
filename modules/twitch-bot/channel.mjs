// Quelle chaîne Twitch du site ce module sert. Le réglage « Chaîne Twitch à utiliser » (`channel`) est un CHOIX parmi les instances de Ma Chaîne Twitch
// (service `twitch.live`) : sa valeur est l'id d'une instance, jamais un pseudo tapé. Avec une seule chaîne, le cœur masque le réglage et la résout lui-même.
// Ce fichier traduit ce choix en pseudo Twitch, que le Connecteur Twitch (service `twitch.api`) utilise ensuite (`account({ channel })`, `request({ channel })`).
//
// Une valeur d'avant (un pseudo tapé à la main) reste valable : la migration (`rememberTypedChannel`) note quel pseudo était tapé et, si une instance de
// Ma Chaîne Twitch a ce pseudo, laquelle. Un module ne peut pas réécrire son propre réglage : l'administration propose de confirmer le choix, et en
// attendant le pseudo tapé continue de servir. Rien n'est jamais perdu.
// Toute attente est bornée : un autre module lent ne retient jamais le dock, la page d'administration ni le chat.
export const LIVE = "twitch.live";
export const API = "twitch.api";
export const TYPED = "typedChannel";   // collection : { from (valeur tapée), login, id (instance de Ma Chaîne Twitch, ou null) }
export const timing = { choiceMs: 3500, callMs: 2500, migrationMs: 6000 };
const LOGIN = /^[a-z0-9_]{3,25}$/;
const MAX_PROVIDERS = 50;

const text = (v) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, "").trim().slice(0, 200) : "");
export const loginOf = (v) => { const s = text(v).toLowerCase().replace(/^@/, ""); return LOGIN.test(s) ? s : ""; };

/** Attend `p` au plus `ms` (le minuteur ne retient pas le processus) ; passé ce délai, ou en cas d'erreur : `fallback`. */
function within(p, ms, fallback) {
  let t;
  return Promise.race([Promise.resolve().then(() => p).catch(() => fallback), new Promise((r) => { t = setTimeout(() => r(fallback), ms); t.unref?.(); })]).finally(() => clearTimeout(t));
}

/** La résolution du réglage par le cœur (`chosen`, `only`, `none`, `ambiguous`, `missing`, `unverified`). */
async function choice(ctx) {
  if (typeof ctx.resolveChoice !== "function") return { status: "unverified" };
  const r = await within(ctx.resolveChoice("channel"), timing.choiceMs, null);
  return r && typeof r === "object" && typeof r.status === "string" ? r : { status: "unverified" };
}

/** Le pseudo de l'instance de Ma Chaîne Twitch `id` ; "" si sa chaîne n'est pas encore réglée ; null si elle ne répond pas. Aucun appel réseau chez elle. */
async function channelOfInstance(ctx, id) {
  if (!id) return null;
  const r = await within(ctx.api.services.call(LIVE, "channel", {}, { provider: id }), timing.callMs, null);
  return r?.ok && r.value && typeof r.value === "object" ? loginOf(r.value.channel) : null;
}

/** Les chaînes de toutes les instances de Ma Chaîne Twitch, dans l'ordre de création : [{ channel, ready }]. */
async function allChannels(ctx) {
  if (typeof ctx.api.services.callAll !== "function") return [];
  const answers = await within(ctx.api.services.callAll(LIVE, "channel", {}), timing.callMs, []);
  return (Array.isArray(answers) ? answers : []).filter((r) => r?.ok && r.value).map((r) => ({ channel: loginOf(r.value.channel), ready: r.value.ready === true })).filter((x) => x.channel);
}

/**
 * La réponse du Connecteur Twitch à `account(args)` (un seul fournisseur : `twitch.api` n'est pas « each »), ou null (absent, muet, en erreur). Bornée à `ms`.
 * `args.channel` : la chaîne voulue. Sans elle, le Connecteur répond pour la PREMIÈRE chaîne qu'il connaît.
 */
export const firstAccount = (ctx, args, ms = timing.callMs) => firstAnswer(ctx, "account", args, ms);

/** La réponse (un objet) du Connecteur Twitch à `method(args)`, ou null. Bornée à `ms`, ne lève jamais. */
async function firstAnswer(ctx, method, args, ms) {
  if (typeof ctx.api.services.callAll !== "function") {
    const r = await within(ctx.api.services.call(API, method, args), ms, null);
    return r?.ok && r.value && typeof r.value === "object" && r.value.ok !== false ? r.value : null;
  }
  const answers = await within(ctx.api.services.callAll(API, method, args), ms, null);
  const r = (Array.isArray(answers) ? answers : []).find((x) => x?.ok && x.value && typeof x.value === "object" && x.value.ok !== false && x.value.error !== "other_channel");
  return r ? r.value : null;
}

/** Les chaînes que connaît le Connecteur Twitch : ses connexions et la première chaîne qu'il connaît. Sans jeton ; borné. */
async function connectorChannels(ctx) {
  const out = new Set();
  const first = await firstAccount(ctx, {}, timing.callMs);
  if (first && loginOf(first.channel)) out.add(loginOf(first.channel));
  if (typeof ctx.api.services.callAll === "function") {
    const answers = await within(ctx.api.services.callAll(API, "connections", {}), timing.callMs, null);
    const list = (Array.isArray(answers) ? answers : []).find((x) => x?.ok && Array.isArray(x.value))?.value ?? [];
    for (const c of list.slice(0, 100)) if (loginOf(c?.channel)) out.add(loginOf(c.channel));
  }
  return out;
}

async function typedDoc(ctx) {
  try { return (await ctx.api.store.list(TYPED, { limit: 1 }))[0] ?? null; } catch { return null; }
}

/**
 * Le pseudo de la chaîne à servir : { channel } ou { problem: "no_channel" | "channel_unknown" | "slow" | "setup" (avec `account` : la réponse du
 * Connecteur, qui n'a ni chaîne ni application) }. Ne lève jamais.
 * `wanted` : la valeur du réglage (par défaut, celle de l'instance).
 *   - un choix (ou l'unique chaîne) → le pseudo de cette instance de Ma Chaîne Twitch ;
 *   - une valeur tapée avant le choix → la chaîne notée par la migration, sinon le pseudo tapé s'il est une chaîne du site (Ma Chaîne Twitch ou Connecteur) ;
 *   - rien de choisi → la première chaîne prête (comme avant), sinon celle que connaît le Connecteur Twitch.
 */
export async function resolveChannel(ctx, wanted = ctx.setting("channel")) {
  const raw = text(wanted);
  const r = await choice(ctx);
  if ((r.status === "chosen" || r.status === "only") && r.id) {
    const c = await channelOfInstance(ctx, r.id);
    return c ? { channel: c } : { problem: c === null ? "slow" : "no_channel" };
  }
  if (raw) {
    const typed = await typedDoc(ctx);
    if (typed && typed.data?.from === raw) {
      const c = await channelOfInstance(ctx, typed.data.id);
      if (c) return { channel: c };
      if (loginOf(typed.data.login)) return { channel: loginOf(typed.data.login) };
    }
    const login = loginOf(raw);
    if (login && ((await allChannels(ctx)).some((x) => x.channel === login) || (await connectorChannels(ctx)).has(login))) return { channel: login };
    if (r.status === "missing" && r.id) {
      const c = await channelOfInstance(ctx, r.id);
      if (c) return { channel: c };
    }
    return { problem: r.status === "unverified" ? "slow" : "channel_unknown" };
  }
  const all = await allChannels(ctx);
  const first = all.find((x) => x.ready) ?? all[0];
  if (first) return { channel: first.channel };
  const acc = await firstAccount(ctx, {}, timing.callMs);
  const known = acc ? loginOf(acc.channel) : "";
  if (known) return { channel: known };
  if (!acc) return { problem: "no_channel" };
  // Le Connecteur répond mais ne connaît aucune chaîne : d'abord son application (s'il n'en a pas), ensuite la chaîne (Ma Chaîne Twitch).
  const st = await firstAnswer(ctx, "status", {}, timing.callMs);
  return st?.ready === true ? { problem: "no_channel" } : { problem: "setup", account: acc };
}

/**
 * Migration : la valeur d'avant du réglage était un pseudo tapé. On note ce pseudo et, si une instance de Ma Chaîne Twitch a cette chaîne, laquelle
 * (au plus 50 instances, le tout borné). Rejouable ; ne lève jamais ; ne touche jamais au réglage lui-même (il reste tel quel en cas d'échec).
 */
export async function rememberTypedChannel(ctx) {
  try {
    const raw = text(ctx.setting("channel"));
    const login = loginOf(raw);
    if (!raw || !login) return;
    const providers = typeof ctx.api.services.providers === "function" ? await within(ctx.api.services.providers(LIVE), timing.callMs, []) : [];
    const list = (Array.isArray(providers) ? providers : []).slice(0, MAX_PROVIDERS);
    if (list.some((p) => p?.id === raw)) return;   // déjà un choix (migration rejouée après coup) : rien à noter
    const deadline = Date.now() + timing.migrationMs;
    let id = null;
    for (const p of list) {
      if (Date.now() >= deadline) break;
      if ((await within(channelOfInstance(ctx, p.id), Math.max(0, deadline - Date.now()), null)) === login) { id = p.id; break; }
    }
    const doc = await typedDoc(ctx);
    const data = { from: raw, login, id };
    if (doc) await ctx.api.store.update(doc.id, data); else await ctx.api.store.add(TYPED, data);
  } catch { /* rien n'est perdu : le pseudo tapé reste dans le réglage */ }
}
