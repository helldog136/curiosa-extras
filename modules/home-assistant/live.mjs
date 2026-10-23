// « Suis-je en direct ? » — la réponse vient des modules de chaîne (services facultatifs `twitch.live` ET `youtube.live`), jamais d'un réglage tapé à la main.
//
// Règle : le direct est VRAI si UNE source fournisseur dit « en direct » (Twitch OU YouTube : une personne qui ne diffuse que sur YouTube doit pouvoir l'utiliser).
// Home Assistant ne copie aucun état : il LIT la réponse du propriétaire de la donnée (Chaîne Twitch, Chaîne YouTube), la garde quelques secondes, et c'est tout.
//
// Décision : sans aucune source (aucun des deux modules, ou aucune réponse), le module reste FERMÉ (raison `not_live`) et la page le dit en clair. Un interrupteur manuel
// « Je suis en direct » serait un oubli en puissance (on le laisse allumé, la maison obéit au chat un mardi matin) ; le but est justement que rien ne se joue hors direct.
// La seule porte ouverte hors direct est le bouton « Tester » de l'administration (et un essai `test: true` du service), réservés aux personnes qui gèrent le module.
//
// Marge : une source dit « en direct » → ouvert ; après la fin du direct, la porte reste ouverte GRACE_MS (le temps de finir ce qui était en cours).
// La marge se calcule à partir du dernier moment où le direct a été VU (`lastLiveAt`), sans minuteur : chaque interrogation de Home Assistant le revérifie.
//
// Économie : YouTube n'est interrogé que si Twitch ne dit pas « en direct » (chaque vérification YouTube coûte 2 unités de limite), sa réponse « pas en direct » est gardée 60 s,
// et l'interrogation de Home Assistant (toutes les 3 s) ne l'appelle jamais quand rien n'attend dans la file : une mise en file, la page d'administration ou `status` le font, au plus une fois par minute.

export const GRACE_MS = 5 * 60_000;
export const SERVICE = "twitch.live";
export const YOUTUBE_SERVICE = "youtube.live";
/** Millisecondes, dans un objet pour que les tests puissent les raccourcir. */
export const timing = { callMs: 2500, ttlMs: 10_000, unknownTtlMs: 3_000, youtubeOffTtlMs: 60_000, youtubeLiveTtlMs: 20_000, youtubeStaleMs: 10 * 60_000 };

const cache = new Map();   // « instance|source » → { until, value }
export const resetLive = () => cache.clear();

function within(p, ms, fallback) {
  let t;
  return Promise.race([Promise.resolve(p).catch(() => fallback), new Promise((r) => { t = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(t));
}

/** Une source : { state: "none" | "unknown" | "live" | "off" }. `none` : aucun module n'offre le service ; `unknown` : pas de réponse, erreur ou « je ne sais pas ». */
async function ask(ctx, service, method, args, read) {
  try {
    if (typeof ctx.api.services?.callAll !== "function") return { state: "none" };
    const answers = await within(ctx.api.services.callAll(service, method, args), timing.callMs, null);
    if (!Array.isArray(answers)) return { state: "unknown" };
    if (answers.length === 0) return { state: "none" };
    const seen = answers.map((r) => (r?.ok && r.value && typeof r.value === "object" ? read(r.value) : "unknown"));
    if (seen.includes("live")) return { state: "live" };
    return { state: seen.includes("off") ? "off" : "unknown" };
  } catch { return { state: "unknown" }; }
}
const readTwitch = (v) => (v.known === true ? (v.live === true ? "live" : "off") : "unknown");
const readYoutube = (v) => (v.ok === true && typeof v.live === "boolean" ? (v.live ? "live" : "off") : "unknown");

async function cached(ctx, source, now, fetch, ttlOf, { passive = false } = {}) {
  const key = `${ctx.instance.key}|${source}`;
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.value;
  // Passif : aucun nouvel appel réseau, on reprend la dernière réponse (jusqu'à 10 minutes) si on en a une, sinon on ne sait pas (« skipped »).
  if (passive) return hit && now - hit.at >= 0 && now - hit.at < timing.youtubeStaleMs ? hit.value : { state: "skipped" };
  const value = await fetch();
  cache.set(key, { until: now + ttlOf(value), at: now, value });
  if (cache.size > 400) for (const [k, c] of cache) if (c.until < now) cache.delete(k);
  return value;
}

/**
 * Ce que disent les chaînes : { source, live, known, twitch, youtube }.
 *   twitch / youtube : "none" (module absent) | "unknown" (muet, en panne) | "live" | "off" | "skipped" (youtube seulement : Twitch disait déjà « en direct »)
 *   known  : au moins une source a répondu clairement ; live : au moins une source dit « en direct »
 *   source : "twitch" | "youtube" | "both" (ceux qui disent direct, sinon ceux qui ont répondu) | "none" (aucun des deux modules) | "unknown" (modules présents mais muets)
 * Ne lève jamais ; chaque appel est borné à timing.callMs. Twitch d'abord ; YouTube seulement si Twitch ne dit pas « en direct ».
 * `passive` (l'interrogation de Home Assistant quand rien n'attend dans la file) : YouTube n'est PAS appelé, on reprend sa dernière réponse (10 minutes au plus) : sinon Home Assistant,
 * qui vient toutes les 3 secondes, ferait consommer la limite YouTube du jour pour rien.
 */
export async function liveNow(ctx, now = Date.now(), { passive = false } = {}) {
  const tw = await cached(ctx, "twitch", now, () => ask(ctx, SERVICE, "status", {}, readTwitch), (r) => (r.state === "unknown" ? timing.unknownTtlMs : timing.ttlMs));
  const yt = tw.state === "live"
    ? { state: "skipped" }
    : await cached(ctx, "youtube", now, () => ask(ctx, YOUTUBE_SERVICE, "current", {}, readYoutube), (r) => (r.state === "unknown" ? timing.unknownTtlMs : r.state === "live" ? timing.youtubeLiveTtlMs : timing.youtubeOffTtlMs), { passive });
  const states = [tw.state, yt.state];
  const live = states.includes("live");
  const known = live || states.includes("off");
  const installed = states.some((x) => x !== "none" && x !== "skipped") || tw.state === "live";
  let source;
  if (!installed) source = "none";
  else if (!known) source = "unknown";
  else {
    const who = (live ? [tw.state === "live" && "twitch", yt.state === "live" && "youtube"] : [tw.state === "off" && "twitch", yt.state === "off" && "youtube"]).filter(Boolean);
    source = who.length > 1 ? "both" : who[0];
  }
  return { source, live, known, twitch: tw.state, youtube: yt.state };
}

/** Vrai si la porte est ouverte : en direct, ou dans la marge après le dernier direct vu. */
export const isOpen = (live, lastLiveAt, now) => live.live === true || (lastLiveAt > 0 && now - lastLiveAt >= 0 && now - lastLiveAt < GRACE_MS);

/** À noter dans `lastLiveAt` : pas plus d'une écriture par minute pendant un direct. */
export const shouldNoteLive = (live, lastLiveAt, now) => live.live === true && now - lastLiveAt >= 60_000;
