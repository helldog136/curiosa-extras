// Participation — fonctions pures (aucune lecture ni écriture du stockage : de quoi les tester seules).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Texte d'un visiteur : normalisé, sans caractères de contrôle ni marques de sens de lecture, sur une ligne, borné. */
export const clean = (v, max) =>
  String(v ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export const num = (v, def, min, max) => {
  const n = Number(v);
  return v === undefined || v === null || v === "" || !Number.isFinite(n) ? def : Math.min(max, Math.max(min, Math.trunc(n)));
};

export const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/* ───────────── Plafonds (voir README : « Bornes ») ───────────── */
export const LIMITS = {
  rooms: 200,              // salles gardées
  participants: 5000,      // participants par salle
  claims: 20000,           // « une voix » enregistrées par salle
  channels: 100,           // points de lecture du direct (toutes salles)
  liveBytes: 16384,        // taille d'un état publié
  audit: 500,              // lignes du journal
  panels: 8,               // modules branchés sur la télécommande
  buttons: 8,
  forms: 3,
  fields: 6,
  roomKey: 60,
  claimKey: 80,
  label: 60,
  detail: 160,
  banned: 500,             // mots interdits
  recent: 12,              // pseudos montrés sur la télécommande
};

export const ROOM_RE = /^[a-z0-9][a-z0-9:._-]{0,59}$/;
export const CLAIM_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,79}$/;
export const CHANNEL_RE = /^[a-z0-9][a-z0-9_-]{0,29}$/;
export const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;

export const roomOk = (v) => typeof v === "string" && ROOM_RE.test(v);
export const tokenOk = (v) => typeof v === "string" && TOKEN_RE.test(v);

/* ───────────── Empreintes : jamais l'adresse en clair, jamais le code en clair ───────────── */

/** Identifiant d'un participant DANS une salle : propre à la salle (sel de la salle), donc deux salles ne se recoupent pas. */
export const participantId = (roomSalt, token) => createHash("sha256").update(`aud1|${roomSalt}|${token}`).digest("hex").slice(0, 40);

/** Empreinte d'une connexion : HMAC avec un sel du processus qui change chaque jour. L'adresse reste dans cette fonction. */
export function connHash(salt, conn) {
  const forwarded = String(conn?.forwarded ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const who = forwarded.length ? forwarded[forwarded.length - 1] : String(conn?.real ?? "") || "local";
  return createHmac("sha256", salt).update(String(who).slice(0, 80)).digest("hex").slice(0, 16);
}

export const keyHash = (key) => createHash("sha256").update(`audk|${String(key ?? "")}`).digest("hex").slice(0, 32);

/* ───────────── Pseudos et mots interdits ───────────── */

const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

/** Forme « pliée » : sans accent, en minuscules, chiffres pour lettres rétablis, seulement lettres et chiffres. Sert à comparer, jamais à afficher. */
export function fold(s) {
  const base = String(s ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[013457@$!]/g, (c) => LEET[c] ?? "");
  return base.replace(/[^\p{L}\p{N}]/gu, "");
}

/** Mots d'un pseudo, pliés (le texte est coupé aux espaces, tirets et soulignés). */
const tokensOf = (s) => String(s ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}@$!]+/u).map(fold).filter(Boolean);

/**
 * La liste des mots interdits, une ligne par mot. « mot » bloque ce mot seul ; « mot* » ce qui commence ainsi ; « *mot » ce qui finit ainsi ;
 * « *mot* » tout ce qui le contient. Les lignes qui commencent par # sont des notes. Accents et majuscules ne comptent pas.
 */
export function parseBanned(text) {
  const out = [], seen = new Set();
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const pre = line.startsWith("*"), post = line.endsWith("*") && line.length > 1;
    const v = fold(line.replace(/^\*+|\*+$/g, "")).slice(0, 40);
    if (!v) continue;
    const type = pre && post ? "contains" : pre ? "suffix" : post ? "prefix" : "word";
    const k = `${type}:${v}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ type, v });
    if (out.length >= LIMITS.banned) break;
  }
  return out;
}

export function isBanned(pseudo, entries) {
  const compact = fold(pseudo);
  if (!compact) return false;
  const tokens = tokensOf(pseudo);
  for (const e of entries) {
    if (e.type === "word" && (compact === e.v || tokens.includes(e.v))) return true;
    if (e.type === "prefix" && (compact.startsWith(e.v) || tokens.some((t) => t.startsWith(e.v)))) return true;
    if (e.type === "suffix" && (compact.endsWith(e.v) || tokens.some((t) => t.endsWith(e.v)))) return true;
    if (e.type === "contains" && compact.includes(e.v)) return true;
  }
  return false;
}

const PSEUDO_CHARS = /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u;

/** Valide un pseudo. `value` est le texte à afficher (espaces nettoyés), `key` sa forme pliée (unicité dans une salle). Jamais tronqué : la personne choisit. */
export function validatePseudo(raw, { min = 3, max = 20, banned = [] } = {}) {
  const value = clean(raw, 200);
  const len = [...value].length;
  if (len < min) return { ok: false, code: "pseudo_short" };
  if (len > max) return { ok: false, code: "pseudo_long" };
  if (!PSEUDO_CHARS.test(value)) return { ok: false, code: "pseudo_chars" };
  const key = fold(value);
  if (!key || key.length < Math.min(2, min)) return { ok: false, code: "pseudo_chars" };
  if (isBanned(value, banned)) return { ok: false, code: "pseudo_banned" };
  return { ok: true, value, key };
}

/** Liste de départ (sobre) : modifiable dans l'administration. Un mot entier, ou « mot* » / « *mot* » pour une famille de mots. */
export const STARTER_BANNED = [
  "# Une ligne par mot. « mot » bloque ce mot seul ; « mot* » tout ce qui commence ainsi ; « *mot* » tout ce qui le contient. Accents et majuscules ne comptent pas.",
  "# Se faire passer pour l'équipe",
  "admin", "administrateur", "administrator", "modo", "moderateur", "moderator", "staff", "streamer", "streameuse", "bot", "system", "systeme",
  "# Insultes courantes (français)",
  "*merde*", "*putain*", "*connard*", "*connasse*", "*salope*", "*encul*", "*enfoire*", "batard", "pute", "pd", "ntm", "fdp", "tg",
  "# Insultes courantes (anglais)",
  "*fuck*", "*shit*", "*bitch*", "*asshole*", "cunt*", "dick", "dickhead*", "*whore*", "*slut*", "retard", "idiot",
  "# Haine et sujets graves",
  "nazi", "nazis", "*neonazi*", "*hitler*", "*nigg*", "*fagg*", "pedo*", "*rapist*", "violeur",
  "# Liens et publicités",
  "*http*", "www*", "*discord gg*", "porn", "porno*",
].join("\n");

/* ───────────── Limiteur à fenêtre glissante (en mémoire, borné) ───────────── */

/** Compte un passage dans `bucket`. Renvoie { over, retryAfter } (secondes) ; la table est bornée. */
export function hit(table, bucket, max, windowMs, now = Date.now(), cap = 5000) {
  const recent = (table.get(bucket)?.times ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  table.delete(bucket);
  table.set(bucket, { times: recent, windowMs });
  if (table.size > cap) {
    for (const [k, v] of table) if (!v.times.some((t) => now - t < v.windowMs)) table.delete(k);
    for (const k of table.keys()) { if (table.size <= cap / 2) break; table.delete(k); }
  }
  const over = recent.length > max;
  return { over, remaining: Math.max(0, max - recent.length), retryAfter: over ? Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) : 0 };
}

/* ───────────── Télécommande : ce que les modules branchés décrivent ───────────── */

const TONES = new Set(["primary", "danger", "plain"]);
const FIELD_TYPES = new Set(["text", "number", "select"]);
const ID_RE = /^[a-z][a-z0-9_-]{0,29}$/;

/** Un panneau décrit par un module, ramené à une forme sûre et bornée (le navigateur ne reçoit que cela). Renvoie null s'il est inutilisable. */
export function sanitizePanel(raw) {
  if (!isObj(raw)) return null;
  const title = clean(raw.title, 60);
  if (!title) return null;
  const st = isObj(raw.state) ? raw.state : null;
  const until = st && typeof st.until === "string" && Number.isFinite(Date.parse(st.until)) ? new Date(Date.parse(st.until)).toISOString() : null;
  const state = st ? { text: clean(st.text, 200), tone: ["idle", "live", "done"].includes(st.tone) ? st.tone : "idle", until } : null;
  const buttons = (Array.isArray(raw.buttons) ? raw.buttons : []).filter((b) => isObj(b) && ID_RE.test(String(b.id ?? "")) && clean(b.label, 40)).slice(0, LIMITS.buttons).map((b) => ({
    id: String(b.id), label: clean(b.label, 40), tone: TONES.has(b.tone) ? b.tone : "plain", confirm: b.confirm ? clean(b.confirm, 120) : "", disabled: b.disabled === true,
  }));
  const forms = (Array.isArray(raw.forms) ? raw.forms : []).filter((f) => isObj(f) && ID_RE.test(String(f.id ?? "")) && clean(f.title, 60)).slice(0, LIMITS.forms).map((f) => ({
    id: String(f.id), title: clean(f.title, 60), submit: clean(f.submit, 30) || "OK",
    fields: (Array.isArray(f.fields) ? f.fields : []).filter((x) => isObj(x) && /^[a-z][a-z0-9_]{0,19}$/.test(String(x.name ?? ""))).slice(0, LIMITS.fields).map((x) => ({
      name: String(x.name), label: clean(x.label, 40), type: FIELD_TYPES.has(x.type) ? x.type : "text", required: x.required === true,
      max: num(x.max, 60, 1, 200), placeholder: clean(x.placeholder, 40), value: clean(x.value, 60),
      options: x.type === "select" ? (Array.isArray(x.options) ? x.options : []).slice(0, 12).filter((o) => isObj(o)).map((o) => ({ value: clean(o.value, 30), label: clean(o.label, 40) })) : [],
    })),
  }));
  return { title, state, buttons, forms };
}

/** Les valeurs d'un formulaire de télécommande : texte seulement, bornées (le module qui reçoit valide à son tour). */
export function sanitizeValues(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw).slice(0, LIMITS.fields)) if (/^[a-z][a-z0-9_]{0,19}$/.test(k)) out[k] = clean(typeof v === "number" ? String(v) : v, 200);
  return out;
}

export const sameSecret = (a, b) => {
  const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? ""));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};
