// D'où vient l'état « en direct » : du service `twitch.live` de la Chaîne Twitch — jamais de Twitch directement.
// Ce module ne connaît ni jeton, ni cache d'API, ni quota : il demande, il présente.
// Transition : tant que la Chaîne Twitch n'a pas ses propres identifiants, les anciens réglages de ce module (channel / clientId /
// clientSecret) sont transmis AU SERVICE, qui fait l'appel (mode hérité). Dès que la Chaîne Twitch est prête, elle a le dessus.
export const SERVICE = "twitch.live";
export const CHANNEL_RE = /^[a-zA-Z0-9_]{3,25}$/;
const text = (v) => String(v ?? "").trim();

/** Les anciens réglages de ce module (vides une fois la migration terminée). */
export function legacyOf(ctx) {
  const channel = text(ctx.setting("channel"));
  return { channel: CHANNEL_RE.test(channel) ? channel : "", clientId: text(ctx.setting("clientId")), clientSecret: text(ctx.setting("clientSecret")) };
}
export const hasLegacy = (l) => !!(l.channel || l.clientId || l.clientSecret);

/** Ce que sait la première Chaîne Twitch (celle où va la reprise des identifiants) : { channel, ready, missing… } ou null si le service est absent. */
export async function providerInfo(ctx) {
  const r = await ctx.api.services.call(SERVICE, "channel", {});
  return r.ok && r.value && typeof r.value === "object" ? r.value : null;
}

/** Interroge TOUTES les instances du service (cœur 0.1.14+), sinon (vieux cœur : pas de `callAll`) l'unique réponse de `call`. → [{ instance, name, value }] des réponses valides. */
async function askAll(ctx, method, args) {
  const svc = ctx.api.services;
  if (typeof svc.callAll === "function") {
    try {
      return (await svc.callAll(SERVICE, method, args)).filter((r) => r.ok && r.value && typeof r.value === "object").map((r) => ({ instance: r.instance, name: r.name, value: r.value }));
    } catch { return []; }
  }
  const r = await svc.call(SERVICE, method, args);
  return r.ok && r.value && typeof r.value === "object" ? [{ instance: "", name: undefined, value: r.value }] : [];
}

/** Réglage facultatif « Chaînes à annoncer » : liste de chaînes séparées par des virgules ou espaces ; vide = toutes. */
const onlyOf = (ctx) => new Set(text(ctx.setting("channels")).toLowerCase().split(/[\s,;]+/).filter((c) => CHANNEL_RE.test(c)));
const shortName = (v, channel) => (typeof v === "string" && v.trim().toLowerCase() === channel ? v.trim() : channel);

/**
 * LES chaînes à présenter, dans l'ordre de création des instances de la Chaîne Twitch :
 *   [{ channel, name, live, known, configured, status }]   (`name` : nom d'affichage sûr ; `status` : la réponse du service ou null)
 * Sans `status`, aucun appel d'état (juste les chaînes connues). Chaîne Twitch absente : la chaîne de l'ancien réglage, s'il y en a une. Ne lève jamais.
 */
export async function liveSources(ctx, { status = true } = {}) {
  const legacy = legacyOf(ctx);
  const legacyReady = !!(legacy.channel && legacy.clientId && legacy.clientSecret);
  const infos = await askAll(ctx, "channel", {});
  let list;
  if (!infos.length) {
    list = legacy.channel ? [{ channel: legacy.channel, configured: legacyReady, live: false, known: false, status: null }] : [];
  } else {
    list = infos.map((i) => ({ instance: i.instance, channel: i.value.channel || (infos.length === 1 ? legacy.channel : "") || "", ready: !!i.value.ready, configured: !!i.value.ready || (infos.length === 1 && legacyReady), live: false, known: false, status: null }));
    const anyReady = list.some((x) => x.ready);
    if (status && (anyReady || legacyReady)) {
      // Au moins une chaîne a ses identifiants : chacune répond pour elle-même. Sinon (mode hérité) un seul appel, avec les anciens réglages.
      let answers;
      if (anyReady) answers = await askAll(ctx, "status", {});
      else { const r = await ctx.api.services.call(SERVICE, "status", { legacy }); answers = r.ok && r.value && typeof r.value === "object" ? [{ instance: infos[0].instance, value: r.value }] : []; }
      list.forEach((x, n) => {
        const s = (anyReady && infos.length > 1 && answers.find((a) => a.instance === x.instance)?.value) || (anyReady && infos.length === 1 ? answers[0]?.value : null) || (!anyReady && n === 0 ? answers[0]?.value : null);
        if (!s) return;
        Object.assign(x, { channel: s.channel || x.channel, live: s.live === true, known: s.known === true, configured: s.configured === true, status: s });
      });
    }
  }
  const only = onlyOf(ctx);
  return list.filter((x) => CHANNEL_RE.test(x.channel ?? "") && (!only.size || only.has(x.channel.toLowerCase())))
    .map((x) => ({ channel: x.channel, name: shortName(x.status?.displayName, x.channel.toLowerCase()), live: x.live, known: x.known, configured: x.configured, status: x.status }));
}

/** Peut-on savoir si une chaîne est en direct ? Oui si une Chaîne Twitch a ses identifiants, ou si les anciens réglages de ce module sont complets (mode hérité). null : Chaîne Twitch absente. */
export async function canTellLive(ctx) {
  const l = legacyOf(ctx);
  const infos = await askAll(ctx, "channel", {});
  if (!infos.length) return null;   // Chaîne Twitch absente : un autre message s'en occupe
  return !!(infos.some((i) => i.value.ready) || (l.channel && l.clientId && l.clientSecret));
}
