// Les textes des commandes : liste fermée de variables, vérifiée à l'enregistrement, remplacée au moment de répondre.
// Règles : jamais de texte du chat réinjecté (sauf le pseudo, nettoyé) ; une valeur manquante est remplacée par un texte lisible ; le résultat est nettoyé et tronqué.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { MAX_MESSAGE } = await import(`./eventsub.mjs${v}`);

export const COMMON = ["followers", "jeu", "titre", "uptime", "prochain_stream", "utilisateur"];
/** Variables propres à un type de commande (en plus des communes). */
export const EXTRA = { custom: [], builtin: [], partner: ["partenaire", "adresse"], network: ["reseau", "lien"], group: ["liste"], reward: ["recompense"] };
export const allowedFor = (kind) => [...COMMON, ...(EXTRA[kind] ?? [])];
export const MAX_TEMPLATE = 450;

const TOKEN = /\{([^{}]*)\}/g;
/** Les noms de variables écrits dans un texte (sans doublon). */
export const used = (text) => [...new Set([...String(text ?? "").matchAll(TOKEN)].map((m) => m[1].trim()))];

/**
 * Vérifie un texte de commande. Rend { ok: true, text } ou { ok: false, code, vars?, allowed? } :
 * "empty", "long", "unknown" (variables inconnues ou qui n'ont pas de sens pour ce type de commande), "start" (commence par / . \ ou le préfixe).
 */
export function checkTemplate(raw, kind, prefix = "!") {
  const text = String(raw ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, code: "empty" };
  if (text.length > MAX_TEMPLATE) return { ok: false, code: "long" };
  const allowed = allowedFor(kind);
  const unknown = used(text).filter((v) => !allowed.includes(v));
  if (unknown.length) return { ok: false, code: "unknown", vars: unknown, allowed };
  if (/^[/.\\]/.test(text) || (prefix && text.startsWith(prefix))) return { ok: false, code: "start" };
  return { ok: true, text };
}

/** Un texte venu d'ailleurs (titre du direct, nom d'un jeu…) : sans caractères de contrôle ni de mise en forme invisible, sur une ligne. */
export function clean(v, max = 200) {
  return String(v ?? "").normalize("NFKC").replace(/[\r\n\t\u2028\u2029]+/g, " ").replace(/\p{C}+/gu, "").replace(/\s+/g, " ").trim().slice(0, max);
}
/** Le pseudo de celui qui tape : lettres, chiffres, tiret, tiret bas et espace, 25 caractères ; « ami » si rien ne reste. */
export function pseudo(v) {
  const s = clean(v, 60).replace(/[^\p{L}\p{N}_ -]+/gu, "").trim().slice(0, 25);
  return s || "ami";
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
