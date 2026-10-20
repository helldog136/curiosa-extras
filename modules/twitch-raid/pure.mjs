// Les petites règles du Raid Twitch, sans aucune connaissance de Curiosa ni de Twitch (pas de ctx, pas de réseau, pas d'horloge cachée).
// Les fonctions marquées « DOCK » sont aussi recopiées telles quelles dans la page du dock (`.toString()`) : elles doivent rester autonomes
// (aucune variable extérieure) pour que le navigateur et les tests exécutent EXACTEMENT le même code.

/** Un pseudo Twitch : 4 à 25 caractères, lettres, chiffres et _ (en minuscules). */
export const LOGIN = /^[a-z0-9_]{4,25}$/;
/** Les adresses twitch.tv/… qui ne sont pas une chaîne. */
const NOT_CHANNELS = new Set(["videos", "directory", "downloads", "settings", "subscriptions", "friends", "wallet", "inventory", "drops", "prime", "turbo", "jobs", "store", "team", "popout", "embed", "moderator", "dashboard", "broadcast", "login", "signup", "search"]);
export const MAX_PARTNERS = 100;
export const SORTS = ["viewers_asc", "viewers_desc", "newest", "oldest", "mine"];

/**
 * Lit ce que la personne a tapé : `pseudo`, `@pseudo`, `https://twitch.tv/pseudo` (avec ou sans www, avec ou sans / à la fin).
 * Rend { login } ou { error: "empty" | "invalid" | "not_channel" }.
 */
export function normalizeLogin(input) {
  let s = String(input ?? "").trim();
  if (!s) return { error: "empty" };
  const url = /^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([^/?#\s]*)/i.exec(s);
  if (url) {
    s = decodeURIComponent_(url[1]);
    if (!s) return { error: "invalid" };
  } else s = s.replace(/^@/, "");
  s = s.toLowerCase();
  if (NOT_CHANNELS.has(s)) return { error: "not_channel" };
  return LOGIN.test(s) ? { login: s } : { error: "invalid" };
}
function decodeURIComponent_(v) { try { return decodeURIComponent(v); } catch { return v; } }

/**
 * Découpe un texte collé en « lignes » : une par ligne, ou séparées par des virgules ou points-virgules (300 au plus).
 * Une ligne qui contient plusieurs pseudos séparés par des espaces (« alice bob carl ») est acceptée si CHACUN est valable ;
 * sinon elle reste en un seul morceau et sera refusée en entier (« Ma super chaîne » ne doit pas devenir trois chaînes inventées).
 */
export function splitList(text) {
  const out = [];
  for (const line of String(text ?? "").split(/[\r\n,;]+/)) {
    const t = line.trim();
    if (!t) continue;
    const words = t.split(/\s+/);
    if (words.length > 1 && words.every((w) => normalizeLogin(w).login)) out.push(...words); else out.push(t);
    if (out.length >= 300) break;
  }
  return out.slice(0, 300);
}

/** Nom affiché ou note : une ligne de texte, sans caractère de contrôle, coupée à `max`. */
export const oneLine = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/* ───────────── DOCK : exécuté dans la page ───────────── */

/** DOCK. La commande de chat à coller pour lancer le raid ; texte vide si le pseudo n'est pas valable. */
export function raidCommand(login) {
  const l = String(login || "");
  return /^[a-z0-9_]{3,25}$/.test(l) ? "/raid " + l : "";
}

/** DOCK. Trie sans modifier la liste : "viewers_asc" (le moins de spectateurs d'abord), "viewers_desc", "newest" (live le plus récent), "oldest", "mine" (l'ordre de la liste de la personne). Égalité : l'ordre de la liste. */
export function sortPartners(items, mode) {
  const out = items.slice();
  const by = { viewers_asc: (a, b) => a.viewers - b.viewers, viewers_desc: (a, b) => b.viewers - a.viewers, newest: (a, b) => b.startedAt - a.startedAt, oldest: (a, b) => a.startedAt - b.startedAt, mine: () => 0 };
  const cmp = by[mode] || by.viewers_asc;
  return out.sort((a, b) => cmp(a, b) || a.pos - b.pos);
}

/** DOCK. Un partenaire au hasard, avec le générateur `rng` (comme Math.random : un nombre de 0 inclus à 1 exclu). `avoid` : le pseudo tiré juste avant, écarté s'il y a un autre choix. Rend null s'il n'y a personne. */
export function pickRandom(items, rng, avoid) {
  const others = avoid && items.length > 1 ? items.filter((x) => x.login !== avoid) : items;
  if (!others.length) return null;
  const i = Math.floor(Number(rng()) * others.length);
  return others[i >= 0 && i < others.length ? i : others.length - 1];
}

/** DOCK. Depuis combien de temps (« 42 min », « 1 h 05 »), à partir d'un nombre de millisecondes. */
export function durationText(ms) {
  const m = Math.floor(Math.max(0, Number(ms) || 0) / 60000);
  if (m < 1) return "< 1 min";
  if (m < 60) return m + " min";
  const mm = m % 60;
  return Math.floor(m / 60) + " h " + (mm < 10 ? "0" : "") + mm;
}
