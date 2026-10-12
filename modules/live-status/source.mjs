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

/** Ce que sait la Chaîne Twitch (sans appel réseau) : { channel, ready, missing… } ou null si le service est absent. */
export async function providerInfo(ctx) {
  const r = await ctx.api.services.call(SERVICE, "channel", {});
  return r.ok && r.value && typeof r.value === "object" ? r.value : null;
}

/**
 * La chaîne à présenter et, si demandé, son état :
 *   { channel, live, known, configured, status }
 *   `channel` : la chaîne (null si on n'en connaît aucune) ; `status` : la réponse du service ou null ;
 *   `configured` : Twitch peut dire si la chaîne est en direct (sinon on ne sait pas : voir le lecteur) ;
 *   `live` : en direct (false si on ne sait pas). Ne lève jamais.
 */
export async function liveSource(ctx, { status = true } = {}) {
  const legacy = legacyOf(ctx);
  const info = await providerInfo(ctx);
  const channel = info?.channel || legacy.channel || null;
  const legacyReady = !!(legacy.channel && legacy.clientId && legacy.clientSecret);
  const none = { channel, live: false, known: false, configured: !!info?.ready || legacyReady, status: null };
  if (!channel || !status) return none;
  let args = null;
  if (info?.ready) args = {};
  else if (legacyReady && info) args = { legacy };   // mode hérité : le service fait l'appel avec nos anciens réglages
  if (!args) return { ...none, configured: false };
  const r = await ctx.api.services.call(SERVICE, "status", args);
  if (!r.ok || !r.value || typeof r.value !== "object") return none;
  const s = r.value;
  return { channel: s.channel || channel, live: s.live === true, known: s.known === true, configured: s.configured === true, status: s };
}

/** Peut-on savoir si la chaîne est en direct ? Oui si la Chaîne Twitch a ses identifiants, ou si les anciens réglages de ce module sont complets (mode hérité). */
export async function canTellLive(ctx) {
  const l = legacyOf(ctx);
  const info = await providerInfo(ctx);
  if (!info) return null;   // Chaîne Twitch absente : un autre message s'en occupe
  return !!(info.ready || (l.channel && l.clientId && l.clientSecret));
}
