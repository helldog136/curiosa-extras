// Parler à RAWG : la clé, la recherche (par le client réseau borné du cœur), le cache, le choix du jeu le plus ressemblant, les corrections de la propriétaire.
// Garde-fous, quel que soit l'appelant :
//  - https uniquement (requête et adresse de l'image) ; délai court ; titre nettoyé et borné ; 256 Ko de réponse au plus ;
//  - petit cache en mémoire (trouvé ~24 h, « aucun résultat » ~1 h, 500 recherches au plus) : un appel de plus ne réinterroge pas RAWG ;
//  - PANNES : une jaquette trouvée est aussi gardée dans le stockage du module (`autoCovers`, 1 000 au plus), donc elle survit aux redémarrages ; lecture = mémoire, puis stockage, puis RAWG.
//    Quand RAWG ne répond pas (délai, réseau, erreur 5xx), la jaquette gardée sert même après 24 h, sans être supprimée ; elle est rafraîchie à la première demande qui suit le retour de RAWG.
//    Un échec de réseau n'est JAMAIS gardé comme « aucun résultat ». Un disjoncteur sobre (3 échecs d'affilée, puis pause de 1, 2, 5, 15 min, un seul essai de reprise à la fois) évite d'insister.
//  - le client réseau du cœur borne le reste (4 appels simultanés, pauses après un refus de trop de demandes, disjoncteur) ;
//  - le dernier état de la clé (ok / refusée / injoignable + date + dernière réponse correcte) est gardé dans le stockage du module ; le passage panne → retour est écrit une fois au journal du cœur ;
//  - jamais d'exception, jamais la clé dans une valeur renvoyée, un journal, une erreur ou un bloc.
const q = new URL(import.meta.url).search;
const fx = await import(new URL("./fixes.mjs" + q, import.meta.url).href);
const { COL } = fx;

export const ENDPOINT = "https://api.rawg.io/api/games";
/** Délai d'une recherche à l'écran d'administration, et d'une recherche faite pour une page du site (plus court : la page ne doit jamais attendre longtemps). */
const TIMEOUT_MS = 5_000;
const PAGE_TIMEOUT_MS = 3_000;
const MAX_BYTES = 256 * 1024;
const FOUND_TTL = 24 * 3_600_000;
const NONE_TTL = 3_600_000;
/** Disjoncteur : échecs de réseau d'affilée avant la pause, durées de pause successives (la dernière se répète), délai donné à l'essai de reprise. */
export const FAILS_TO_OPEN = 3;
export const PAUSE_STEPS_MS = [60_000, 120_000, 300_000, 900_000];
const PROBE_MS = TIMEOUT_MS + 2_000;
const MAX_CACHE = 500;
const MAX_TITLE = 100;
/** Résultats demandés à RAWG et lus (borne dure) ; candidats rendus à l'écran de correction. */
const PAGE_SIZE = 8;
export const MAX_CANDIDATES = 6;
const MAX_PLATFORMS = 3;
/** On ne réécrit l'état de la clé que s'il change, ou s'il date de plus de ça. */
const STATE_REFRESH = 10 * 60_000;

export const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
export const isValidKey = (key) => typeof key === "string" && KEY_RE.test(key);

/** La clé : celle du réglage de cette page, sinon celle reprise du site (les réglages saisis ont toujours le dessus). { key, source: "setting" | "adopted" | null, valid }. Aucune valeur n'en sort. */
export async function keyOf(ctx) {
  const own = String(ctx.setting("rawgKey") ?? "").trim();
  if (own) return { key: own, source: "setting", valid: isValidKey(own) };
  const adopted = String((await fx.readOne(ctx, COL.key))?.key ?? "").trim();
  if (adopted) return { key: adopted, source: "adopted", valid: isValidKey(adopted) };
  return { key: "", source: null, valid: false };
}

// ── Cache (en mémoire, borné, avec expiration) ───────────────────────────────────────────────────────────────────────────
const cache = new Map();
export const clearCache = () => cache.clear();
export const cacheSize = () => cache.size;
const peek = (search) => { const hit = cache.get(search.toLowerCase()); return hit && hit.until > Date.now() ? hit.list : null; };

// ── Disjoncteur (en mémoire : il ne sert qu'à ne pas insister, il n'est pas une donnée) ────────────────────────────────────────
const idle = () => ({ fails: 0, trips: 0, openUntil: 0, probeUntil: 0 });
let breaker = idle();
let lastOkMs = 0;
export const resetBreaker = () => { breaker = idle(); lastOkMs = 0; };
/** Pour l'écran et les tests : { open: faux | vrai, until, trips, fails } — jamais une donnée de la personne. */
export const breakerInfo = (now = Date.now()) => ({ open: breaker.openUntil > now, until: breaker.openUntil, trips: breaker.trips, fails: breaker.fails });
/** « go » : on peut interroger RAWG (fermé, ou l'unique essai de reprise) ; « wait » : on répond tout de suite sans réseau. */
function gate(now) {
  if (breaker.openUntil === 0) return "go";
  if (now < breaker.openUntil || now < breaker.probeUntil) return "wait";
  breaker.probeUntil = now + PROBE_MS;   // un seul essai à la fois ; un essai qui ne rend jamais la main libère la place à l'expiration
  return "go";
}
const answered = (now) => { breaker = idle(); lastOkMs = now; };
/** Un échec de réseau de plus. Vrai quand cet échec ouvre (ou rouvre) la pause. */
function failed(now) {
  breaker.fails++;
  if (breaker.openUntil === 0 && breaker.fails < FAILS_TO_OPEN) return false;
  breaker.openUntil = now + PAUSE_STEPS_MS[Math.min(breaker.trips, PAUSE_STEPS_MS.length - 1)];
  breaker.trips = Math.min(breaker.trips + 1, PAUSE_STEPS_MS.length);
  breaker.probeUntil = 0;
  return true;
}

// ── État de la clé ──────────────────────────────────────────────────────────────────────────────────────────────────────
const isIso = (v) => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
/** { state: "ok" | "refused" | "unreachable", at, okAt? } : le dernier état connu et, s'il y en a eu un, la date de la dernière réponse correcte de RAWG. */
export async function readState(ctx) {
  const raw = await fx.readOne(ctx, COL.state);
  if (!raw || (raw.state !== "ok" && raw.state !== "refused" && raw.state !== "unreachable") || !isIso(raw.at)) return null;
  return { state: raw.state, at: raw.at, ...(isIso(raw.okAt) ? { okAt: raw.okAt } : raw.state === "ok" ? { okAt: raw.at } : {}) };
}
async function rememberState(ctx, state, force = false) {
  try {
    const current = await readState(ctx);
    const now = Date.now();
    let okAt = state === "ok" ? new Date(now).toISOString() : current?.okAt;
    if (state !== "ok" && lastOkMs && (!okAt || lastOkMs > Date.parse(okAt))) okAt = new Date(lastOkMs).toISOString();
    const same = current?.state === state;
    if (!force && same && now - Date.parse(current.at) < STATE_REFRESH) return;
    await fx.writeOne(ctx, COL.state, { state, at: new Date(now).toISOString(), ...(okAt ? { okAt } : {}) });
    // Le passage panne → retour (et retour → panne) est écrit UNE fois au journal, jamais à chaque requête.
    if (!same && state === "ok" && current?.state === "unreachable") await fx.journal(ctx, "cover.back", "");
    else if (!same && state === "unreachable") await fx.journal(ctx, "cover.outage", "", undefined, "warn");
  } catch { /* l'état est une information : jamais bloquant */ }
}
export const forgetState = (ctx) => fx.removeOne(ctx, COL.state).catch(() => {});

// ── Lecture des réponses de RAWG, avec méfiance ─────────────────────────────────────────────────────────────────────────
/** Titre nettoyé : sans caractères de contrôle, espaces réduits, longueur bornée. */
export function cleanTitle(title, max = MAX_TITLE) {
  return String(title ?? "").slice(0, max * 4).replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}
function httpsUrl(value) {
  if (typeof value !== "string" || value.length > 2000) return null;
  try { const u = new URL(value); return u.protocol === "https:" ? u.toString() : null; } catch { return null; }
}
const shortText = (v, max) => (typeof v === "string" ? v.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Un résultat de RAWG : types et longueurs vérifiés. Un résultat sans nom ni numéro reste utilisable (id 0 = inconnu). */
export function parseResult(r) {
  if (!r || typeof r !== "object") return null;
  const year = typeof r.released === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.released) ? Number(r.released.slice(0, 4)) : null;
  const platforms = Array.isArray(r.platforms) ? r.platforms.slice(0, 12).map((p) => shortText(p?.platform?.name, 40)).filter(Boolean).slice(0, MAX_PLATFORMS) : [];
  return { id: typeof r.id === "number" && Number.isSafeInteger(r.id) && r.id > 0 ? r.id : 0, name: shortText(r.name, 150), year, platforms, image: httpsUrl(r.background_image) };
}

/**
 * Une requête RAWG (sans cache). Ne lève jamais ; la clé n'apparaît dans aucun résultat ni message.
 * → { kind: "ok", list } | { kind: "refused" } | { kind: "unreachable", down } ; `down` : un vrai échec de réseau (délai, connexion, erreur 5xx), seul à compter pour le disjoncteur
 * (une pause « trop de demandes », un quota ou une réponse bizarre ne sont pas une panne).
 */
async function query(ctx, key, search, timeoutMs = TIMEOUT_MS) {
  const url = `${ENDPOINT}?${new URLSearchParams({ key, search, page_size: String(PAGE_SIZE), search_precise: "true" })}`;
  try {
    const r = await ctx.api.net.request({ url, headers: { accept: "application/json" }, timeoutMs, maxBytes: MAX_BYTES, priority: "interactive" });
    if (!r?.ok) return { kind: "unreachable", down: !r || r.error === "timeout" || r.error === "network" };
    if (r.status === 401 || r.status === 403) return { kind: "refused" };
    if (r.status < 200 || r.status >= 300) return { kind: "unreachable", down: r.status >= 500 || r.status === 408 };
    const results = Array.isArray(r.json?.results) ? r.json.results.slice(0, PAGE_SIZE) : [];
    return { kind: "ok", list: results.map(parseResult).filter(Boolean) };
  } catch (error) {
    // Seulement le type de l'erreur : un message de réseau pourrait contenir l'adresse demandée, donc la clé.
    console.error("[game-covers] request failed:", error?.name);
    return { kind: "unreachable", down: true };
  }
}

/** Ce que le disjoncteur et l'état retiennent d'une réponse de RAWG (hors lecture « silencieuse » : elle n'écrit pas l'état). */
async function noteOutcome(ctx, outcome, quiet, force = false) {
  const now = Date.now();
  if (outcome.kind === "unreachable") {
    const opened = outcome.down ? failed(now) : false;
    if (!quiet && (opened || force)) await rememberState(ctx, "unreachable", force);
    return;
  }
  answered(now);   // RAWG a répondu (même pour refuser la clé) : il n'est pas en panne
  if (!quiet) await rememberState(ctx, outcome.kind, force);
}

/**
 * Les résultats de RAWG pour cette recherche : mémoire, disjoncteur, état. Ne lève jamais.
 * → { kind: "ok", list, fresh } | { kind: "refused" } | { kind: "unreachable", skipped? } ; `skipped` : le disjoncteur a répondu sans réseau.
 */
async function lookup(ctx, key, search, { quiet = false, timeoutMs = TIMEOUT_MS } = {}) {
  const id = search.toLowerCase();
  const hit = peek(search);
  if (hit) return { kind: "ok", list: hit, fresh: false };
  if (gate(Date.now()) === "wait") return { kind: "unreachable", skipped: true };
  const outcome = await query(ctx, key, search, timeoutMs);
  await noteOutcome(ctx, outcome, quiet);
  if (outcome.kind === "ok") {
    // Seulement une réponse correcte entre en mémoire (« aucun résultat » : 1 h) ; un échec de réseau n'y entre JAMAIS.
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(id, { list: outcome.list, until: Date.now() + (outcome.list.some((r) => r.image) ? FOUND_TTL : NONE_TTL) });
    return { kind: "ok", list: outcome.list, fresh: true };
  }
  return outcome.kind === "refused" ? { kind: "refused" } : { kind: "unreachable" };
}

/**
 * La liste brute des jeux que RAWG propose pour ces mots (mémoire, disjoncteur, état de la clé), pour la chaîne de sources (chain.mjs). Ne lève jamais.
 * → { kind: "ok", list, fresh } | { kind: "off" } (pas de clé) | { kind: "refused" } | { kind: "unreachable", skipped? }. `quiet` : n'écrit pas l'état de la clé (outil de lecture de l'assistant).
 */
export async function searchList(ctx, words, { quiet = false, timeoutMs = TIMEOUT_MS } = {}) {
  try {
    const { key, valid } = await keyOf(ctx);
    if (!key) return { kind: "off" };
    if (!valid) return { kind: "refused" };
    return await lookup(ctx, key, cleanTitle(words), { quiet, timeoutMs });
  } catch {
    return { kind: "unreachable" };
  }
}
export { PAGE_TIMEOUT_MS, FOUND_TTL, NONE_TTL };

/**
 * « Tester la clé » : interroge RAWG avec la clé enregistrée (même si le disjoncteur est en pause : c'est une demande de la personne) et mémorise le résultat.
 * → "ok" | "refused" | "unreachable" | "no-key" | "invalid". Ne lève jamais.
 */
export async function checkKey(ctx) {
  try {
    const { key, valid } = await keyOf(ctx);
    if (!key) return "no-key";
    if (!valid) return "invalid";
    const outcome = await query(ctx, key, "portal");
    await noteOutcome(ctx, outcome, false, true);
    return outcome.kind;
  } catch {
    return "unreachable";
  }
}
