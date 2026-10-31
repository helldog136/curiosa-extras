// Les textes des commandes : liste fermée de variables, vérifiée à l'enregistrement, remplacée au moment de répondre.
// Règles : jamais de texte du chat réinjecté (sauf le pseudo, nettoyé) ; une valeur manquante est remplacée par un texte lisible ; le résultat est nettoyé et tronqué.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { MAX_MESSAGE } = await import(`./eventsub.mjs${v}`);
const { evaluate } = await import(`./calc.mjs${v}`);
const { isPublicHostName } = await import(`./urlfetch.mjs${v}`);

export const COMMON = ["followers", "jeu", "titre", "uptime", "prochain_stream", "utilisateur"];
/** Morceaux qui prennent un texte après leur nom : {heure Europe/Paris}, {aleatoire a | b}, {calcul 2+3}, {urlfetch https://…}. */
export const WITH_ARG = ["heure", "date", "aleatoire", "calcul", "urlfetch"];
/** Nouveaux morceaux (Nightbot) disponibles dans les commandes écrites à la main et dans les timers. */
export const RICH = ["chaine", "viewers", ...WITH_ARG];
/** Morceaux qui dépendent de la personne qui tape la commande : réservés aux commandes (pas aux timers). */
export const ARGS = Array.from({ length: 9 }, (_, i) => String(i + 1)).flatMap((n) => [n, `${n}:`]);
export const PERSON = ["cible", "requete", "query", "compteur", ...ARGS];
/** Variables propres à un type de commande (en plus des communes). */
export const EXTRA = { custom: [...RICH, ...PERSON], builtin: [], partner: ["partenaire", "adresse"], network: ["reseau", "lien"], group: ["liste"], reward: ["recompense"], timer: RICH };
export const allowedFor = (kind) => [...(kind === "timer" ? COMMON.filter((x) => x !== "utilisateur") : COMMON), ...(EXTRA[kind] ?? [])];
/** Ce que l'on montre à la personne (la liste complète est trop longue à lire). */
export const shownFor = (kind) => (kind === "custom" ? ["utilisateur", "cible", "requete", "1", "2", "1:", "compteur", "jeu", "titre", "uptime", "followers", "viewers", "prochain_stream", "chaine", "heure", "date", "aleatoire", "calcul", "urlfetch"]
  : allowedFor(kind));
export const MAX_TEMPLATE = 450;
export const MAX_NEST = 3;

const TOKEN = /\{([^{}]*)\}/g;
/** « requête  Europe/Paris » → { name: "requete", arg: "Europe/Paris" } : le nom est sans accent ni majuscule, le reste est le texte donné au morceau. */
export function splitToken(inner) {
  const t = String(inner ?? "").trim();
  const i = t.search(/\s/);
  const head = i < 0 ? t : t.slice(0, i);
  return { name: head.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase(), arg: i < 0 ? "" : t.slice(i + 1).trim() };
}
/** Tous les morceaux écrits dans un texte, à tous les niveaux (« {calcul {1}*2} » donne calcul et 1), sans doublon. */
export function used(text) {
  const names = new Set();
  let s = String(text ?? "");
  for (let round = 0; round <= MAX_NEST && /\{[^{}]*\}/.test(s); round++) s = s.replace(TOKEN, (_all, inner) => { names.add(splitToken(inner).name); return "1"; });
  return [...names];
}

export const TZ_OK = (tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };
/** Lit l'argument de {aleatoire …} : une plage « 1-100 » ou une liste « a | b | c ». Rend { range: [min, max] } | { list: [...] } | null. */
export function parseRandom(arg) {
  const a = String(arg ?? "").trim();
  const r = /^(-?\d{1,9})\s*(?:-|\.\.)\s*(-?\d{1,9})$/.exec(a);
  if (r) { const min = Number(r[1]), max = Number(r[2]); return min <= max ? { range: [min, max] } : null; }
  const list = a.split("|").map((x) => x.trim()).filter(Boolean);
  return list.length >= 2 && list.length <= 20 && list.every((x) => x.length <= 100) ? { list } : null;
}
/** Vérifie l'argument d'un morceau. Rend un code d'erreur (« heure », « aleatoire », « calcul », « urlfetch ») ou null. */
function badArg(name, arg) {
  if (name === "heure" || name === "date") return arg && !TZ_OK(arg) ? name : null;
  if (name === "aleatoire") return parseRandom(arg) ? null : name;
  if (name === "calcul") { try { evaluate(arg); return null; } catch { return name; } }
  if (name === "urlfetch") { try { const u = new URL(arg); return u.protocol === "https:" && !u.username && !u.password && isPublicHostName(u.hostname) ? null : name; } catch { return name; } }
  return null;
}

/**
 * Vérifie un texte de commande. Rend { ok: true, text } ou { ok: false, code, vars?, allowed?, name? } :
 * "empty", "long", "unknown" (variables inconnues ou qui n'ont pas de sens pour ce type de commande), "arg" (le texte donné à un morceau est faux : `name` dit lequel),
 * "deep" (morceaux imbriqués sur plus de 3 niveaux), "start" (commence par / . \ ou le préfixe).
 */
export function checkTemplate(raw, kind, prefix = "!") {
  const text = String(raw ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, code: "empty" };
  if (text.length > MAX_TEMPLATE) return { ok: false, code: "long" };
  const allowed = allowedFor(kind);
  const unknown = [];
  let bad = null, s = text, round = 0;
  while (/\{[^{}]*\}/.test(s)) {
    if (++round > MAX_NEST) return { ok: false, code: "deep" };
    s = s.replace(TOKEN, (_all, inner) => {
      const { name, arg } = splitToken(inner);
      const hasArg = arg !== "";
      if (!allowed.includes(name) || (hasArg && !WITH_ARG.includes(name))) { const shown = String(inner).trim().slice(0, 40); if (!unknown.includes(shown)) unknown.push(shown); }
      else if (!bad) { const code = badArg(name, arg); if (code) bad = code; }
      return "1";
    });
  }
  if (unknown.length) return { ok: false, code: "unknown", vars: unknown, allowed: shownFor(kind) };
  if (bad) return { ok: false, code: "arg", name: bad };
  if (/^[/.\\]/.test(text) || (prefix && text.startsWith(prefix))) return { ok: false, code: "start" };
  return { ok: true, text };
}

/** Un texte venu d'ailleurs (titre du direct, nom d'un jeu…) : sans caractères de contrôle ni de mise en forme invisible, sur une ligne. */
export function clean(v, max = 200) {
  return String(v ?? "").normalize("NFKC").replace(/[\r\n\t\u2028\u2029]+/g, " ").replace(/\p{C}+/gu, "").replace(/\s+/g, " ").trim().slice(0, max);
}
/** Le pseudo de la personne qui tape : lettres, chiffres, tiret, tiret bas et espace, 25 caractères ; « chat » si rien ne reste. */
export function pseudo(v) {
  const s = clean(v, 60).replace(/[^\p{L}\p{N}_ -]+/gu, "").trim().slice(0, 25);
  return s || "chat";
}

/** Début d'un message qu'on ne doit jamais envoyer tel quel : une commande de Twitch (/…), un point (.…), ou le préfixe des commandes (boucle entre bots). */
const MARK = "• ";
export function safeStart(text, prefix = "!") {
  const t = String(text ?? "").trimStart();
  return /^[/.\\]/.test(t) || (prefix && t.startsWith(prefix)) ? `${MARK}${t}` : t;
}

/** Coupe à `max` caractères (points de code), avec « … » si on coupe. */
export function truncate(text, max = MAX_MESSAGE) {
  const chars = [...String(text)];
  return chars.length <= max ? String(text) : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/** Remplace les variables en UNE passe (une valeur contenant « {titre} » n'est jamais remplacée à son tour). `values` : nom → texte (l'appelant fournit les replis lisibles). */
export function render(template, values, prefix = "!") {
  const body = String(template).replace(TOKEN, (_all, name) => (Object.hasOwn(values, name.trim()) ? clean(values[name.trim()], 300) : ""));
  return truncate(safeStart(body.replace(/[\r\n\t\u2028\u2029]+/g, " ").replace(/\p{C}+/gu, "").replace(/\s+/g, " ").trim(), prefix));
}

/** Un morceau d'un texte tapé dans le chat : sans accolades, sur une ligne, sans les marques du début d'un mot qui feraient lire « !commande » ou « /ban » comme une commande. */
export function plain(value, max = 300, prefix = "!") {
  const marks = new Set(["/", ".", "\\", ...(prefix ? [...prefix] : [])]);
  const words = String(value ?? "").split(/\s+/).map((w) => { let i = 0; while (i < w.length && marks.has(w[i])) i++; return w.slice(i); }).join(" ");
  return clean(words, max).replace(/[{}]/g, "");
}

/**
 * Remplace les morceaux d'un texte, du plus profond vers la surface (3 niveaux au plus, 30 morceaux au plus). `resolve(name, arg)` rend le texte du morceau (ou rien).
 * Les valeurs n'ont jamais d'accolades : une valeur ne devient donc jamais à son tour un morceau.
 */
export async function renderRich(template, resolve, prefix = "!") {
  let s = String(template), budget = 30;
  for (let round = 0; round <= MAX_NEST && /\{[^{}]*\}/.test(s); round++) {
    const found = [...s.matchAll(TOKEN)];
    const vals = await Promise.all(found.map(async (m) => {
      if (budget-- <= 0) return "";
      const { name, arg } = splitToken(m[1]);
      try { const r = await resolve(name, arg); return r === undefined || r === null ? "" : clean(r, 400).replace(/[{}]/g, ""); } catch { return ""; }
    }));
    let i = 0;
    s = s.replace(TOKEN, () => vals[i++]);
  }
  const body = s.replace(/[{}]/g, "").replace(/[\r\n\t\u2028\u2029]+/g, " ").replace(/\p{C}+/gu, "").replace(/\s+/g, " ").trim();
  return truncate(safeStart(body, prefix));
}
