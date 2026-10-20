// D'où vient l'état « en direct » : du service `twitch.live` de la Chaîne Twitch — jamais de Twitch directement.
// Ce module ne connaît ni jeton, ni cache d'API, ni quota : il demande, il présente.
// Les identifiants Twitch d'un ancien réglage de ce module ne servent plus ici : ils sont repris dans la Chaîne Twitch par la migration (adopt.mjs).
export const SERVICE = "twitch.live";
export const CHANNEL_RE = /^[a-zA-Z0-9_]{3,25}$/;
const text = (v) => String(v ?? "").trim();

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
 * Sans `status`, aucun appel d'état (juste les chaînes connues). Chaîne Twitch absente : aucune chaîne. Ne lève jamais.
 */
export async function liveSources(ctx, { status = true } = {}) {
  const infos = await askAll(ctx, "channel", {});
  let list = [];
  if (infos.length) {
    list = infos.map((i) => ({ instance: i.instance, channel: i.value.channel || "", ready: !!i.value.ready, configured: !!i.value.ready, live: false, known: false, status: null }));
    if (status && list.some((x) => x.ready)) {
      // Au moins une chaîne a ses identifiants : chacune répond pour elle-même.
      const answers = await askAll(ctx, "status", {});
      list.forEach((x) => {
        const s = (infos.length > 1 && answers.find((a) => a.instance === x.instance)?.value) || (infos.length === 1 ? answers[0]?.value : null);
        if (!s) return;
        Object.assign(x, { channel: s.channel || x.channel, live: s.live === true, known: s.known === true, configured: s.configured === true, status: s });
      });
    }
  }
  const only = onlyOf(ctx);
  return list.filter((x) => CHANNEL_RE.test(x.channel ?? "") && (!only.size || only.has(x.channel.toLowerCase())))
    .map((x) => ({ channel: x.channel, name: shortName(x.status?.displayName, x.channel.toLowerCase()), live: x.live, known: x.known, configured: x.configured, status: x.status }));
}

/** Peut-on savoir si une chaîne est en direct ? Oui si une Chaîne Twitch a ses identifiants. null : Chaîne Twitch absente. */
export async function canTellLive(ctx) {
  const infos = await askAll(ctx, "channel", {});
  if (!infos.length) return null;   // Chaîne Twitch absente : un autre message s'en occupe
  return infos.some((i) => i.value.ready);
}
