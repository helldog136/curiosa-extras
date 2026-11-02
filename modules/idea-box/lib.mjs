// Boîte à idées — les petits outils : constantes, nettoyage du texte, lecture des idées, limites de débit, cookie de soutien.
// Rien ici ne fabrique de page (voir view.mjs) ni ne décide d'un droit (voir admin.mjs).
export const COLLECTION = "ideas";
export const MAX_STORED = 1000;          // idées gardées au total (à relire, publiées, masquées, refusées)
export const PUBLIC_MAX = 150;           // idées montrées sur la page publique (les mieux classées d'après le tri choisi)
export const TEXT_MIN = 3;
export const TEXT_DEFAULT_MAX = 500;
export const NICK_MAX = 30;
export const REPLY_MAX = 280;
export const MERGED_MAX = 100;           // anciennes idées retenues sur une idée fusionnée (pour ne pas compter deux fois un soutien)
export const PAGE_SIZE = 50;
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const YEAR = 365 * DAY;
export const PURGE_BATCH = 50;           // idées refusées effacées au plus à chaque passage (pas de minuteur : le ménage se fait quand on écrit)
export const COOKIE = "vh_ib_votes";
export const COOKIE_IDS_MAX = 300;

export const STATUSES = ["proposed", "studied", "planned", "done", "dismissed"];
export const STATES = ["pending", "published", "hidden", "refused"];
/** Statuts sur lesquels on peut encore soutenir une idée (une idée réalisée ou écartée n'a plus besoin de soutien). */
export const VOTABLE = ["proposed", "studied", "planned"];

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Nettoie un texte venu d'un formulaire : sans caractères de contrôle ni de changement de sens de lecture. Ne coupe PAS (la longueur est vérifiée à part). */
export function clean(value, multiline = false) {
  let text = String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "");
  text = multiline ? text.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n") : text.replace(/\s+/g, " ");
  return text.trim();
}

/** Entier borné ; un réglage peut arriver vide ou en texte. */
export function num(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
}

/** Clé de comparaison : sans accents, sans majuscules, sans ponctuation (« Un stream de cuisine ! » = « un stream de cuisine »). */
export const textKey = (s) => {
  const t = String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return t.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
};

/** Nombre d'adresses web dans un texte : une idée honnête en a zéro ou une. */
export const linkCount = (s) => (String(s ?? "").match(/https?:\/\/|www\./gi) ?? []).length;

export const isStatus = (v) => STATUSES.includes(v);
export const isState = (v) => STATES.includes(v);

/** Les réglages, bornés. */
export const settings = (ctx) => ({
  autoPublish: ctx.setting("autoPublish") === true,
  votes: ctx.setting("votes") !== false,
  showDismissed: ctx.setting("showDismissed") === true,
  hourlyLimit: num(ctx.setting("hourlyLimit"), 3, 1, 20),
  maxPending: num(ctx.setting("maxPending"), 200, 10, 500),
  textMax: num(ctx.setting("textMax"), TEXT_DEFAULT_MAX, 50, 1000),
  keepRefusedDays: num(ctx.setting("keepRefusedDays"), 30, 1, 365),
});

/** Une ligne du stockage, ramenée à une forme sûre (additive : un champ absent prend sa valeur par défaut). */
export function norm(r) {
  const d = r?.data ?? {};
  const at = new Date(r?.createdAt).getTime();
  return {
    id: r.id,
    at: Number.isFinite(at) ? at : 0,
    text: String(d.text ?? ""),
    nick: String(d.nick ?? ""),
    state: isState(d.state) ? d.state : "pending",
    status: isStatus(d.status) ? d.status : "proposed",
    votes: Math.max(0, Math.trunc(Number(d.votes)) || 0),
    reply: String(d.reply ?? ""),
    refusedAt: typeof d.refusedAt === "string" ? d.refusedAt : "",
    merged: Array.isArray(d.merged) ? d.merged.filter((x) => typeof x === "string").slice(0, MERGED_MAX) : [],
  };
}

export const loadAll = async (ctx) => (await ctx.api.store.list(COLLECTION, { limit: MAX_STORED })).map(norm);

/** Ce qui est écrit dans le stockage (le document est remplacé en entier à chaque écriture). */
export const toData = (i) => ({
  text: i.text, nick: i.nick || null, state: i.state, status: i.status, votes: i.votes, reply: i.reply || null,
  refusedAt: i.refusedAt || null, merged: i.merged,
});

/** Ce que montre la page publique : publiées seulement ; « écartées » seulement si la personne propriétaire le veut. */
export const isPublic = (i, showDismissed) => i.state === "published" && (showDismissed || i.status !== "dismissed");

export function sortIdeas(list, order) {
  const byNew = (a, b) => b.at - a.at;
  return [...list].sort(order === "recent" ? byNew : (a, b) => b.votes - a.votes || byNew(a, b));
}

/* ───────────── Limites de débit, en mémoire : un garde-fou, pas un pare-feu ───────────── */
const memory = new Map();
export function limited(bucket, max, windowMs, now = Date.now()) {
  const recent = (memory.get(bucket) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  memory.set(bucket, recent);
  if (memory.size > 5000) for (const [k, v] of memory) if (!v.some((t) => now - t < YEAR)) memory.delete(k);
  if (memory.size > 5000) for (const k of [...memory.keys()].slice(0, memory.size - 4000)) memory.delete(k);   // jamais plus de 5 000 compteurs
  return recent.length > max;
}
export function forgetInstance(key) { for (const k of [...memory.keys()]) if (k.split("|")[1] === key) memory.delete(k); }

/** Empreinte salée du cœur : sert à limiter le débit, jamais gardée ni écrite dans les données. */
export const whoOf = (request, ctx, scope) => ctx.api.visitor.fingerprint(request, scope);

/* ───────────── Cookie des soutiens : seulement les numéros des idées déjà soutenues, dans ce navigateur ───────────── */
export function readVotedIds(request) {
  const raw = /(?:^|;\s*)vh_ib_votes=([^;]*)/.exec(request.headers.get("cookie") ?? "")?.[1];
  try {
    const list = JSON.parse(decodeURIComponent(raw ?? "[]"));
    return Array.isArray(list) ? list.filter((x) => typeof x === "string" && x.length <= 80).slice(-COOKIE_IDS_MAX) : [];
  } catch { return []; }
}
export const cookieHeader = (ids) => `${COOKIE}=${encodeURIComponent(JSON.stringify(ids.slice(-COOKIE_IDS_MAX)))}; Path=/; Max-Age=${365 * 86400}; SameSite=Lax; HttpOnly`;

/** Adresse de la page publique (avec le préfixe de langue quand ce n'est pas la langue par défaut), ou null sans page. */
export function pageHref(ctx, localized = true) {
  const base = ctx.instance.basePath;
  if (base === null || base === undefined) return null;
  const prefix = localized && ctx.locale !== ctx.defaultLocale ? `/${ctx.locale}` : "";
  return `${prefix}${base ? `/${base}` : ""}` || "/";
}

export const excerpt = (s, n = 60) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
