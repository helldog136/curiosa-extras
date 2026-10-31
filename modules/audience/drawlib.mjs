// Participation — le tirage au sort : fonctions pures (aucune lecture ni écriture du stockage : de quoi les tester seules).
import { createHash, randomInt } from "node:crypto";

const V = new URL(import.meta.url).search;   // le cœur recharge ce fichier avec ?v=… : les fichiers voisins suivent
const L = await import(`./lib.mjs${V}`);

/* ───────────── Bornes (voir README : « Tirage au sort ») ───────────── */
export const DRAW = {
  room: "draw",                 // la salle de Participation où vivent les personnes du tirage (identité, pseudo, sourdine)
  channel: "screen",            // le point de direct lu par l'écran du stream
  maxEntries: 5000,             // inscriptions par tirage
  maxPseudo: 25,                // longueur d'un pseudo venu du chat
  title: 60,
  keyword: 30,
  history: 20,                  // tirages gardés dans l'historique
  pageSize: 50,                 // personnes par page dans l'administration
  winnersMax: 10,
  minutesMax: 120,
  openMaxMs: 48 * 3_600_000,    // un tirage « jusqu'à ce que je ferme » se ferme tout seul au bout de 48 h (constaté à la lecture)
  purgeMs: 24 * 3_600_000,      // les inscriptions sont effacées 24 h après la fermeture
  showMs: 20_000,               // le temps où les personnes gagnantes restent à l'écran
  queue: 10,                    // listes d'inscriptions en attente d'effacement
};

export const LEVELS = ["all", "sub", "mod"];
export const SOURCES = { site: "site" };

const PLATFORM_RE = /^[a-z][a-z0-9_-]{0,19}$/;
export const platformOk = (v) => typeof v === "string" && PLATFORM_RE.test(v);

/** Le mot-clé du chat, ramené à une seule forme : en minuscules, sans espaces, avec UN point d'exclamation devant. « Cadeau », « !cadeau » et « ! Cadeau » donnent « !cadeau ». Vide : pas de mot-clé. */
export function normKeyword(raw) {
  const s = String(raw ?? "").normalize("NFKC").trim().replace(/^!+\s*/, "").toLowerCase();
  if (!s) return { ok: true, value: "" };
  if (!/^[\p{L}\p{N}_-]+$/u.test(s) || [...s].length > DRAW.keyword) return { ok: false, code: "kw_invalid" };
  return { ok: true, value: `!${s}` };
}

/** Le formulaire « Nouveau tirage » (administration, télécommande, assistant) → { errors: { champ: code }, value }. */
export function validateForm(raw) {
  const v = L.isObj(raw) ? raw : {};
  const errors = {}, value = {};
  value.title = L.clean(v.title, DRAW.title + 40);
  if (!value.title) errors.title = "title_empty";
  else if ([...value.title].length > DRAW.title) errors.title = "title_long";
  const kw = normKeyword(v.keyword);
  if (!kw.ok) errors.keyword = kw.code; else value.keyword = kw.value;
  value.level = LEVELS.includes(v.level) ? v.level : (v.level === undefined || v.level === "" ? "all" : null);
  if (value.level === null) { errors.level = "level_invalid"; value.level = "all"; }
  const site = v.site;
  value.site = site === undefined || site === "" ? true : site === true || site === "1" || site === "yes" || site === "on" ? true : site === false || site === "0" || site === "no" ? false : null;
  if (value.site === null) { errors.site = "site_invalid"; value.site = true; }
  const mins = v.minutes === undefined || v.minutes === null ? "" : String(v.minutes).trim();
  if (mins === "") value.minutes = null;
  else if (!/^\d{1,3}$/.test(mins) || Number(mins) < 1 || Number(mins) > DRAW.minutesMax) errors.minutes = "minutes_invalid";
  else value.minutes = Number(mins);
  const w = v.winners === undefined || v.winners === null || String(v.winners).trim() === "" ? "1" : String(v.winners).trim();
  if (!/^\d{1,2}$/.test(w) || Number(w) < 1 || Number(w) > DRAW.winnersMax) { errors.winners = "winners_invalid"; value.winners = 1; } else value.winners = Number(w);
  if (!errors.keyword && !errors.site && !value.keyword && !value.site) errors.site = "no_way";
  return { errors, value };
}

/** Le nombre de personnes à tirer d'un coup : 1 à 10, 1 par défaut. */
export const winnersCount = (v, def = 1) => L.num(v, def, 1, DRAW.winnersMax);

/** Le jeton privé d'une personne du chat : une empreinte de « plateforme + identifiant » (jamais l'identifiant lui-même). Même forme qu'un code de navigateur, donc même chemin dans la salle. */
export const chatToken = (platform, ident) => createHash("sha256").update(`draw1|${platform}|${String(ident).toLowerCase()}`).digest("base64url");

/** Pseudo d'une personne du chat : nettoyé, sur une ligne, 25 caractères au plus (coupé proprement, jamais au milieu d'un caractère). */
export const chatPseudo = (v) => [...L.clean(v, 200)].slice(0, DRAW.maxPseudo).join("").trim();

/** Identifiant d'une personne du chat : le login s'il est donné, sinon le pseudo ; nettoyé et en minuscules. */
export const chatIdent = (login, pseudo) => L.clean(login !== undefined && login !== null && String(login).trim() ? login : pseudo, 60).toLowerCase();

/** Le niveau demandé est-il atteint ? `role` : « all » (tout le monde), « sub » (abonnement payant), « mod » (modération ou chaîne). Sans rôle donné, le service fait confiance à l'appelant, qui lit `status().level`. */
export function levelOk(level, role) {
  if (level === "all" || role === undefined || role === null || role === "") return true;
  const rank = { all: 0, sub: 1, mod: 2 };
  return (rank[String(role)] ?? 0) >= (rank[level] ?? 0);
}

/* ───────────── États ───────────── */

/** La date où un tirage ouvert se ferme tout seul : sa durée, ou au plus 48 h après l'ouverture. */
export const deadlineOf = (d) => {
  const cap = Date.parse(d.openedAt) + DRAW.openMaxMs;
  const own = d.expiresAt ? Date.parse(d.expiresAt) : Infinity;
  return Math.min(Number.isFinite(own) ? own : Infinity, cap);
};

/** L'état « constaté à la lecture » : un tirage ouvert dont l'heure est passée est fermé, sans qu'aucun minuteur ne l'ait fait. */
export function stateOf(d, now = Date.now()) {
  if (!d) return "none";
  if (d.status === "open") return now >= deadlineOf(d) ? "closed" : "open";
  return d.status === "drawn" ? "drawn" : "closed";
}

/** Les inscriptions d'un tirage fermé depuis plus de 24 h ne sont plus lisibles. */
export const purgeDue = (d, now = Date.now()) => !!d && !d.purged && stateOf(d, now) !== "open" && !!d.closedAt && now >= Date.parse(d.closedAt) + DRAW.purgeMs;

/* ───────────── Le tirage lui-même ───────────── */

/**
 * Tire `k` éléments de `pool`, chacun avec la même chance, sans remise : à chaque tour on prend un rang au hasard parmi ceux qui restent.
 * `rnd(m)` rend un entier de 0 à m-1 (par défaut `crypto.randomInt`, le seul hasard utilisé pour un vrai tirage).
 * `accept(item)` (facultatif, peut être asynchrone) écarte un élément devenu inéligible entre-temps ; il est alors retiré SANS compter parmi les `k`.
 * Renvoie { picked, rejected }.
 */
export async function drawFrom(pool, k, rnd = (m) => randomInt(m), accept = null) {
  const rest = pool.slice(), picked = [], rejected = [];
  while (picked.length < k && rest.length) {
    const i = rnd(rest.length);
    const [item] = rest.splice(i, 1);
    if (accept && !(await accept(item))) { rejected.push(item); continue; }
    picked.push(item);
  }
  return { picked, rejected };
}

/** Un petit générateur reproductible (mulberry32), pour les tests : même graine, même suite. */
export function seeded(seed) {
  let a = seed >>> 0;
  return (m) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * m);
  };
}
