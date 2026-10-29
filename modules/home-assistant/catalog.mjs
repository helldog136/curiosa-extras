// Le catalogue des actions : les NOMS que le Bot Twitch publie (sujet `home.actions`, facultatif) pour que Home Assistant propose « Lancer l'aspirateur → [choisir un script] ».
// Ajouté à la réponse de `pull` (champ `catalog`) et montré sur la page du connecteur. Le Bot Twitch reste propriétaire des récompenses et des actions : ici on ne fait que LIRE leurs noms,
// au plus toutes les 30 s (15 s après un échec), en 1,5 s au plus ; 50 éléments, libellé de 60 caractères au plus, nettoyé ICI aussi (jamais de confiance au texte d'un autre module).
// Rien ne vient de la maison : aucune entité n'est jamais demandée ni envoyée à Curiosa.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { clean } = await import(`./moderation.mjs${v}`);

export const CATALOG = { max: 50, label: 60, ttlMs: 30_000, retryMs: 15_000, waitMs: 1500 };
const KEY_RE = /^[a-z0-9][a-z0-9:_-]{0,39}$/;
const topic = "home.actions";

const state = new Map();   // instance → { at, failAt, items } (en mémoire seulement)
export const resetCatalog = () => state.clear();
const of = (ctx) => { const k = ctx.instance.key; if (!state.has(k)) state.set(k, { at: 0, failAt: 0, items: [] }); return state.get(k); };

const cutCodePoints = (text, n) => [...text].slice(0, n).join("").trim();
/** Les éléments reçus, nettoyés : { key, label } valides, sans doublon, 50 au plus ; le libellé est le texte nettoyé (60 caractères), à défaut la clé. */
export function cleanCatalog(raw) {
  const out = [], seen = new Set();
  for (const x of Array.isArray(raw) ? raw : []) {
    if (out.length >= CATALOG.max) break;
    const key = x && typeof x === "object" && typeof x.key === "string" ? x.key : "";
    if (!KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: cutCodePoints(clean(x.label, { maxRaw: 200 }).text, CATALOG.label) || key });
  }
  return out;
}

/** Attend `p` au plus `ms` (le minuteur est toujours arrêté et ne retient pas le processus) ; passé ce délai, ou en cas d'erreur : `fallback`. */
function within(p, ms, fallback) {
  let t;
  return Promise.race([Promise.resolve().then(() => p).catch(() => fallback), new Promise((r) => { t = setTimeout(() => r(fallback), ms); t.unref?.(); })]).finally(() => clearTimeout(t));
}

/**
 * Le catalogue connu : celui gardé en mémoire s'il a moins de 30 s, sinon relu. Un échec ou l'absence du Bot Twitch garde la dernière liste connue (vide au départ) et ne réessaie
 * pas avant 15 s : une interrogation de Home Assistant n'attend jamais plus de 1,5 s pour ça. `fetch: false` : seulement ce qui est en mémoire.
 */
export async function catalogNow(ctx, now = Date.now(), { fetch = true } = {}) {
  const c = of(ctx);
  if (!fetch || (now >= c.at && now - c.at < CATALOG.ttlMs) || (now >= c.failAt && now - c.failAt < CATALOG.retryMs)) return c.items;
  let raw = null;
  try { raw = typeof ctx.api?.topics?.collect === "function" ? await within(ctx.api.topics.collect(topic, { limit: CATALOG.max }), CATALOG.waitMs, null) : null; } catch { raw = null; }
  if (Array.isArray(raw)) { c.items = cleanCatalog(raw); c.at = now; c.failAt = 0; }
  else c.failAt = now;
  return c.items;
}
/** Le nom d'une action si le Bot Twitch l'a donné, sinon `null`. */
export const catalogLabel = (items, key) => (Array.isArray(items) ? items.find((i) => i.key === key)?.label : null) ?? null;
