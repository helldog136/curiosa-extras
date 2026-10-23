// « Suis-je en direct ? » — la réponse vient de Ma Chaîne Twitch (service facultatif `twitch.live`), jamais d'un réglage tapé à la main.
//
// Décision : sans cette détection (module absent, Twitch muet), le module reste FERMÉ (raison `not_live`) et la page le dit en clair. Un interrupteur manuel
// « Je suis en direct » serait un oubli en puissance (on le laisse allumé, la maison obéit au chat un mardi matin) ; le but est justement que rien ne se joue hors direct.
// La seule porte ouverte hors direct est le bouton « Tester » de l'administration, réservé aux personnes qui gèrent le module.
//
// Marge : Twitch dit « en direct » → ouvert ; après la fin du direct, la porte reste ouverte GRACE_MS (le temps de finir ce qui était en cours).
// La marge se calcule à partir du dernier moment où le direct a été VU (`lastLiveAt`), sans minuteur : chaque interrogation de Home Assistant le revérifie.

export const GRACE_MS = 5 * 60_000;
export const SERVICE = "twitch.live";
/** Millisecondes, dans un objet pour que les tests puissent les raccourcir. */
export const timing = { callMs: 2500, ttlMs: 10_000, unknownTtlMs: 3_000 };

const cache = new Map();   // clé d'instance → { until, value }
export const resetLive = () => cache.clear();

function within(p, ms, fallback) {
  let t;
  return Promise.race([Promise.resolve(p).catch(() => fallback), new Promise((r) => { t = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(t));
}

/**
 * Ce que dit Twitch : { source: "twitch" | "none" | "unknown", live, known }.
 *   twitch   : au moins une chaîne a répondu ; `live` = l'une est en direct ; `known` = Twitch a bien répondu (sinon « inconnu »)
 *   none     : aucun module n'offre `twitch.live`
 *   unknown  : le service n'a pas répondu à temps ou a échoué
 * Gardé 10 s (3 s si la réponse est « inconnu »). Ne lève jamais ; borné à timing.callMs.
 */
export async function liveNow(ctx, now = Date.now()) {
  const k = ctx.instance.key;
  const hit = cache.get(k);
  if (hit && hit.until > now) return hit.value;
  let value = { source: "unknown", live: false, known: false };
  try {
    if (typeof ctx.api.services?.callAll === "function") {
      const answers = await within(ctx.api.services.callAll(SERVICE, "status", {}), timing.callMs, null);
      if (Array.isArray(answers)) {
        if (answers.length === 0) value = { source: "none", live: false, known: false };
        else {
          const ok = answers.filter((r) => r?.ok && r.value && typeof r.value === "object");
          const known = ok.some((r) => r.value.known === true);
          value = known ? { source: "twitch", live: ok.some((r) => r.value.known === true && r.value.live === true), known: true } : { source: "unknown", live: false, known: false };
        }
      }
    } else {
      value = { source: "none", live: false, known: false };
    }
  } catch { /* inconnu : on reste fermé */ }
  cache.set(k, { until: now + (value.source === "unknown" ? timing.unknownTtlMs : timing.ttlMs), value });
  if (cache.size > 200) for (const [key, c] of cache) if (c.until < now) cache.delete(key);
  return value;
}

/** Vrai si la porte est ouverte : en direct, ou dans la marge après le dernier direct vu. */
export const isOpen = (live, lastLiveAt, now) => live.live === true || (lastLiveAt > 0 && now - lastLiveAt >= 0 && now - lastLiveAt < GRACE_MS);

/** À noter dans `lastLiveAt` : pas plus d'une écriture par minute pendant un direct. */
export const shouldNoteLive = (live, lastLiveAt, now) => live.live === true && now - lastLiveAt >= 60_000;
