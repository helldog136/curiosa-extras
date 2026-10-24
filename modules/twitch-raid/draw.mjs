// LE TIRAGE de la « Sélection du moment » (2.2) : des règles PURES, sans Curiosa, sans Twitch, sans horloge cachée ni hasard caché
// (le générateur aléatoire est toujours donné : testable à l'identique, et stable d'un visiteur à l'autre quand il vient d'une graine).
//   - `drawMoment` : choisit `n` membres parmi ceux qui sont en direct, en faisant tourner les personnes (voir « rotation » ci-dessous) ;
//   - `weightedTake` : tirage sans remise où les petites chaînes ont plus de chances (poids inverse du nombre de spectateurs) ;
//   - `parseExclusions` : la liste de pseudos à ne jamais tirer ;
//   - `hashSeed` / `mulberry32` : une graine (texte) devient un générateur : même graine, même tirage.
// Rotation (équité) : `recent` est la mémoire des pseudos déjà montrés, du plus ancien au plus récent, bornée à `RECENT_MAX`. Un nouveau tirage prend
// d'abord parmi ceux qui n'y sont PAS ; s'il n'y en a pas assez, il complète avec ceux montrés il y a le plus longtemps. Personne ne revient donc tant
// que d'autres sont en direct, et quand tout le monde est passé, la rotation recommence par les plus anciens.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { normalizeLogin, drawer } = await import(`./pure.mjs${v}`);

export const COUNT_MIN = 1, COUNT_MAX = 10, COUNT_DEFAULT = 5;
export const MINUTES_MIN = 1, MINUTES_MAX = 240, MINUTES_DEFAULT = 10;
/** Combien de pseudos la mémoire de rotation retient au plus (les plus anciens sont oubliés d'abord). */
export const RECENT_MAX = 200;
/** Combien de pseudos la liste d'exclusions lit au plus. */
export const EXCLUDE_MAX = 200;

const whole = (x) => {
  if (x === null || x === undefined || x === true || x === false || (typeof x === "string" && !x.trim())) return null;   // absent, vide ou pas un nombre : la valeur par défaut
  const n = Math.floor(Number(x));
  return Number.isFinite(n) ? n : null;
};
/** Le nombre de membres à montrer : un entier de 1 à 10 ; ce qui n'est pas un nombre (ou absent) donne 5 ; trop petit ou trop grand est ramené dans l'intervalle. */
export function clampCount(x) {
  const n = whole(x);
  return n === null ? COUNT_DEFAULT : Math.min(COUNT_MAX, Math.max(COUNT_MIN, n));
}
/** La durée de la sélection, en minutes : de 1 à 240 ; absente ou illisible : 10. */
export function clampMinutes(x) {
  const n = whole(x);
  return n === null ? MINUTES_DEFAULT : Math.min(MINUTES_MAX, Math.max(MINUTES_MIN, n));
}
/** Une valeur de réglage est-elle « oui » ? (case cochée : `true`) */
export const flag = (x) => x === true || x === "true" || x === "on" || x === 1 || x === "1";

/** Une graine (texte) → un nombre de 32 bits (FNV-1a puis mélange) ; la même suite de morceaux donne toujours le même nombre. */
export function hashSeed(...parts) {
  let h = 2166136261 >>> 0;
  for (const c of parts.map((p) => String(p ?? "")).join("␟")) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0; h ^= h >>> 16;
  return h >>> 0;
}
/** Un générateur à graine (comme Math.random : un nombre de 0 inclus à 1 exclu). La même graine redonne la même suite. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * La liste de pseudos à ne jamais tirer, telle que la propriétaire l'a tapée : un pseudo, @pseudo ou lien twitch.tv/… par ligne, ou séparés par des virgules ou des points-virgules.
 * Plusieurs pseudos séparés par des espaces sont permis, mais seulement si TOUS sont des pseudos (« n'importe quoi » n'est pas lu comme deux pseudos : la partie entière est signalée).
 * Rend { logins: Set, ignored: [texte lu mais pas un pseudo], over: vrai s'il y en avait plus que EXCLUDE_MAX }.
 */
export function parseExclusions(text) {
  const clean = (t) => t.replace(/^["'“”‘’«»(<\[]+|["'“”‘’«»)>\],.]+$/g, "").trim();
  const parts = String(text ?? "").slice(0, 20_000).split(/[\r\n,;]+/).map(clean).filter(Boolean);
  const logins = new Set(), ignored = [];
  let over = false;
  for (const part of parts) {
    const words = part.split(/\s+/).map(clean).filter(Boolean), reads = words.map((w) => normalizeLogin(w));
    if (!reads.length || reads.some((r) => !r.login)) { if (ignored.length < 20) ignored.push(part.slice(0, 40)); continue; }
    for (const r of reads) { if (logins.size >= EXCLUDE_MAX) over = true; else logins.add(r.login); }
  }
  return { logins, ignored, over };
}

/** Le poids d'un membre « petite chaîne d'abord » : l'inverse du nombre de spectateurs (+1, pour que 0 spectateur ne divise pas par zéro). */
export const weightOf = (viewers) => 1 / (Math.max(0, Number(viewers) || 0) + 1);

/** Tirage sans remise de `k` éléments, la chance d'un élément étant proportionnelle à `weight(item)`. La liste donnée n'est pas modifiée. */
export function weightedTake(items, k, rng, weight = (x) => weightOf(x.viewers)) {
  const pool = items.slice(), out = [];
  for (let n = Math.max(0, Math.floor(Number(k)) || 0); n > 0 && pool.length; n--) {
    const ws = pool.map((x) => { const w = Number(weight(x)); return Number.isFinite(w) && w > 0 ? w : 0; });
    const total = ws.reduce((a, b) => a + b, 0);
    let i = 0;
    if (total > 0) {
      let r = Number(rng()) * total;
      for (; i < pool.length - 1; i++) { r -= ws[i]; if (r < 0) break; }
    } else i = Math.min(pool.length - 1, Math.max(0, Math.floor(Number(rng()) * pool.length)));
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

/** Tire `k` éléments au hasard (uniforme, ou `weighted` : les petites chaînes d'abord) avec `rng`. */
const take = (items, k, rng, weighted) => (weighted ? weightedTake(items, k, rng) : drawer(items, rng).take(k));

/** Ajoute `picked` à la fin de la mémoire de rotation (sans doublon), bornée à `RECENT_MAX`. */
export function remember(recent, picked) {
  const set = new Set(picked);
  return [...recent.filter((l) => !set.has(l)), ...picked].slice(-RECENT_MAX);
}

/**
 * Choisit jusqu'à `n` membres parmi `eligible` ([{ login, viewers, … }], déjà débarrassé des exclus et des personnes qui ne veulent pas apparaître).
 *   - `recent` : la mémoire de rotation (pseudos, du plus ancien au plus récent) ;
 *   - `weighted` : les petites chaînes ont plus de chances ; sinon tirage uniforme ;
 *   - `rng` : comme Math.random.
 * La liste est triée par pseudo avant le tirage : le même `rng` donne le même résultat quel que soit l'ordre dans lequel Twitch a répondu.
 * Rend { picks, recent } (`recent` : la mémoire mise à jour). Moins de `n` en direct : tous ceux qui le sont.
 */
export function drawMoment({ eligible, n, recent = [], weighted = false, rng }) {
  const want = clampCount(n);
  const pool = [...new Map(eligible.map((x) => [x.login, x])).values()].sort((a, b) => (a.login < b.login ? -1 : a.login > b.login ? 1 : 0));
  const seen = new Set(recent), age = new Map(recent.map((l, i) => [l, i]));
  const fresh = pool.filter((x) => !seen.has(x.login));
  let picks;
  if (fresh.length >= want) picks = take(fresh, want, rng, weighted);
  else {
    const oldest = pool.filter((x) => seen.has(x.login)).sort((a, b) => age.get(a.login) - age.get(b.login));
    picks = [...fresh, ...oldest.slice(0, want - fresh.length)];
    picks = take(picks, picks.length, rng, false);   // l'ordre d'affichage ne dit rien de la rotation
  }
  return { picks, recent: remember(recent, picks.map((x) => x.login)) };
}
