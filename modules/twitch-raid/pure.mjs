// Les petites règles du Raid Twitch, sans aucune connaissance de Curiosa ni de Twitch (pas de ctx, pas de réseau, pas d'horloge cachée).
// Les fonctions marquées « DOCK » sont aussi recopiées telles quelles dans la page du dock (`.toString()`) : elles doivent rester autonomes
// (aucune variable extérieure) pour que le navigateur et les tests exécutent EXACTEMENT le même code.

/** Un pseudo Twitch : 4 à 25 caractères, lettres, chiffres et _ (en minuscules). */
export const LOGIN = /^[a-z0-9_]{4,25}$/;
/** Les adresses twitch.tv/… qui ne sont pas une chaîne. */
const NOT_CHANNELS = new Set(["videos", "directory", "downloads", "settings", "subscriptions", "friends", "wallet", "inventory", "drops", "prime", "turbo", "jobs", "store", "team", "popout", "embed", "moderator", "dashboard", "broadcast", "login", "signup", "search"]);
/** Combien de chaînes la liste peut contenir au plus. */
export const MAX_PARTNERS = 2000;
/** Jusqu'à ce nombre de chaînes, le dock montre tous les membres en direct ; au-delà, il propose un bouton « au hasard ». UNE seule valeur pour tout le module. */
export const FULL_VIEW_MAX = 500;
/** Twitch vérifie au plus 100 pseudos par demande (connu de mémoire) ; si Twitch en refuse autant, on essaie des paquets plus petits (voir `nextPacketSize`). */
export const PACKET_SIZES = [100, 50, 20];
/** Au hasard : combien de fois au plus on tire 100 autres noms avant de dire que personne n'est en ligne. */
export const SEARCH_TRIES = 6;
/** Le cœur coupe à 20 000 caractères ce qu'on colle dans un formulaire : plus long, la fin serait perdue sans prévenir. */
export const PASTE_MAX = 20000;
/** Chaînes montrées par page dans l'administration. */
export const PAGE_SIZE = 50;
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
 * Découpe un texte collé en « lignes » : une par ligne, ou séparées par des virgules ou points-virgules (5 000 au plus : bien plus que la liste ne peut en contenir ; le surplus est compté et dit, pas perdu en silence).
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
    if (out.length >= 5000) break;
  }
  return out.slice(0, 5000);
}

/** Nom affiché ou note : une ligne de texte, sans caractère de contrôle, coupée à `max`. */
export const oneLine = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Le mode du dock selon le nombre de chaînes : "full" (tous les membres en direct) jusqu'à `FULL_VIEW_MAX`, "random" (un bouton « au hasard ») au-delà. */
export const modeFor = (n) => (Number(n) > FULL_VIEW_MAX ? "random" : "full");

/** Découpe une liste en paquets d'au plus `size` éléments (l'ordre est gardé). */
export function chunk(list, size) {
  const n = Math.max(1, Math.floor(Number(size)) || 1), out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** La taille de paquet à essayer quand Twitch a refusé `n` pseudos d'un coup : la plus grande de 100, 50, 20 qui soit plus petite que `n`, ou null s'il n'y a plus plus petit. */
export const nextPacketSize = (n) => PACKET_SIZES.find((s) => s < n) ?? null;

/** Retire les chaînes en double (le premier exemplaire reste). */
export function dedupe(partners) {
  const seen = new Set(), out = [];
  for (const p of partners) if (!seen.has(p.login)) { seen.add(p.login); out.push(p); }
  return out;
}

/** Retire de la liste la chaîne de la personne (on ne se raide pas soi-même). `own` vide ou inconnue : rien n'est retiré. */
export function withoutChannel(partners, own) {
  const l = String(own ?? "").trim().toLowerCase();
  return l ? partners.filter((p) => p.login !== l) : partners;
}

/**
 * Tirage SANS remise : `take(k)` rend jusqu'à k éléments jamais rendus avant (moins s'il n'en reste pas assez), choisis au hasard avec `rng` (comme Math.random).
 * Les éléments déjà tirés ne reviennent jamais, d'un appel à l'autre. La liste donnée n'est pas modifiée.
 */
export function drawer(items, rng) {
  const pool = items.slice();
  let left = pool.length;
  const idx = () => { const i = Math.floor(Number(rng()) * left); return i >= 0 && i < left ? i : left - 1; };
  return {
    take(k) {
      const out = [];
      for (let n = Math.max(0, Math.floor(Number(k)) || 0); n > 0 && left > 0; n--) {
        const i = idx();
        out.push(pool[i]);
        pool[i] = pool[--left];   // l'élément tiré est remplacé par le dernier non tiré
      }
      return out;
    },
    left: () => left,
  };
}

/** Cherche dans la liste (administration) : pseudo, nom affiché ou note contiennent le texte, sans tenir compte des majuscules ni des accents. Texte vide : tout. */
export function filterPartners(partners, q) {
  const fold = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const needle = fold(oneLine(q, 40));
  if (!needle) return partners;
  return partners.filter((p) => fold(p.login).includes(needle) || fold(p.name).includes(needle) || fold(p.note).includes(needle));
}

/** Une page de la liste : { items, page, pages, total } ; une page hors limites est ramenée à la plus proche. */
export function pageOf(list, page, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(pages, Math.max(1, Math.floor(Number(page)) || 1));
  return { items: list.slice((p - 1) * size, p * size), page: p, pages, total: list.length };
}

/**
 * Identifiant d'une ligne du tableau d'administration : le pseudo, plus (hors première page sans recherche) la page et la recherche,
 * pour revenir à la même page après « Retirer » ou « Enregistrer ». Format : `pseudo.page.recherche` (recherche en base64 sûre pour une adresse).
 */
export function rowId(login, page = 1, q = "") {
  const query = oneLine(q, 40);
  return page <= 1 && !query ? login : `${login}.${Math.max(1, Math.floor(page) || 1)}.${Buffer.from(query, "utf8").toString("base64url")}`;
}
/** L'inverse de `rowId` : { login, page, q }. Un identifiant simple (le pseudo seul) est valable. */
export function parseRowId(id) {
  const [login, page, q] = String(id ?? "").slice(0, 200).split(".");
  let query = "";
  try { query = oneLine(Buffer.from(q ?? "", "base64url").toString("utf8"), 40); } catch { /* recherche illisible : ignorée */ }
  return { login: oneLine(login, 40), page: Math.max(1, Math.floor(Number(page)) || 1), q: query };
}

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

/** DOCK. Peut-on lancer une recherche « au hasard » maintenant ? Non si une recherche est déjà en cours, ou si la dernière date de moins de `minMs` (2 s : un doigt nerveux ne multiplie pas les demandes). */
export function canSearch(now, lastAt, busy, minMs) {
  return !busy && !(Number(lastAt) > 0 && Number(now) - Number(lastAt) < Number(minMs));
}

/** DOCK. Depuis combien de temps (« 42 min », « 1 h 05 »), à partir d'un nombre de millisecondes. */
export function durationText(ms) {
  const m = Math.floor(Math.max(0, Number(ms) || 0) / 60000);
  if (m < 1) return "< 1 min";
  if (m < 60) return m + " min";
  const mm = m % 60;
  return Math.floor(m / 60) + " h " + (mm < 10 ? "0" : "") + mm;
}
