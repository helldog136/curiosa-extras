// Parler à RAWG : la clé, la recherche (par le client réseau borné du cœur), le cache, le choix du jeu le plus ressemblant, les corrections de la propriétaire.
// Garde-fous, quel que soit l'appelant :
//  - https uniquement (requête et adresse de l'image) ; délai court ; titre nettoyé et borné ; 256 Ko de réponse au plus ;
//  - petit cache en mémoire (trouvé ~24 h, « aucun résultat » ~1 h, 500 recherches au plus) : un appel de plus ne réinterroge pas RAWG ;
//  - le client réseau du cœur borne le reste (4 appels simultanés, pauses après un refus de trop de demandes, disjoncteur) ;
//  - le dernier état de la clé (ok / refusée / injoignable + date) est gardé dans le stockage du module ;
//  - jamais d'exception, jamais la clé dans une valeur renvoyée, un journal, une erreur ou un bloc.
const q = new URL(import.meta.url).search;
const match = await import(new URL("./match.mjs" + q, import.meta.url).href);
const fx = await import(new URL("./fixes.mjs" + q, import.meta.url).href);
const { rank, isAmbiguous } = match;
const { COL } = fx;

export const ENDPOINT = "https://api.rawg.io/api/games";
const TIMEOUT_MS = 5_000;
const MAX_BYTES = 256 * 1024;
const FOUND_TTL = 24 * 3_600_000;
const NONE_TTL = 3_600_000;
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
  const own = String(ctx.setting("apiKey") ?? "").trim();
  if (own) return { key: own, source: "setting", valid: isValidKey(own) };
  const adopted = String((await fx.readOne(ctx, COL.key))?.key ?? "").trim();
  if (adopted) return { key: adopted, source: "adopted", valid: isValidKey(adopted) };
  return { key: "", source: null, valid: false };
}

// ── Cache (en mémoire, borné, avec expiration) ───────────────────────────────────────────────────────────────────────────
const cache = new Map();
export const clearCache = () => cache.clear();
export const cacheSize = () => cache.size;

// ── État de la clé ──────────────────────────────────────────────────────────────────────────────────────────────────────
export async function readState(ctx) {
  const raw = await fx.readOne(ctx, COL.state);
  if (!raw || (raw.state !== "ok" && raw.state !== "refused" && raw.state !== "unreachable") || typeof raw.at !== "string") return null;
  return { state: raw.state, at: raw.at };
}
async function rememberState(ctx, state, force = false) {
  try {
    const current = await readState(ctx);
    if (!force && current?.state === state && Date.now() - Date.parse(current.at) < STATE_REFRESH) return;
    await fx.writeOne(ctx, COL.state, { state, at: new Date().toISOString() });
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

/** Une requête RAWG (sans cache). Ne lève jamais ; la clé n'apparaît dans aucun résultat ni message. → { kind: "ok", list } | { kind: "refused" } | { kind: "unreachable" } */
async function query(ctx, key, search) {
  const url = `${ENDPOINT}?${new URLSearchParams({ key, search, page_size: String(PAGE_SIZE), search_precise: "true" })}`;
  try {
    const r = await ctx.api.net.request({ url, headers: { accept: "application/json" }, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES, priority: "interactive" });
    if (!r?.ok) return { kind: "unreachable" };
    if (r.status === 401 || r.status === 403) return { kind: "refused" };
    if (r.status < 200 || r.status >= 300) return { kind: "unreachable" };
    const results = Array.isArray(r.json?.results) ? r.json.results.slice(0, PAGE_SIZE) : [];
    return { kind: "ok", list: results.map(parseResult).filter(Boolean) };
  } catch (error) {
    // Seulement le type de l'erreur : un message de réseau pourrait contenir l'adresse demandée, donc la clé.
    console.error("[game-covers] request failed:", error?.name);
    return { kind: "unreachable" };
  }
}

/** Les résultats de RAWG pour cette recherche : cache, état de la clé mémorisé. Ne lève jamais. → { kind: "ok", list, fresh } | { kind: "refused" } | { kind: "unreachable" } */
async function lookup(ctx, key, search) {
  const id = search.toLowerCase();
  const hit = cache.get(id);
  if (hit && hit.until > Date.now()) return { kind: "ok", list: hit.list, fresh: false };
  const outcome = await query(ctx, key, search);
  if (outcome.kind === "ok") {
    await rememberState(ctx, "ok");
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(id, { list: outcome.list, until: Date.now() + (outcome.list.some((r) => r.image) ? FOUND_TTL : NONE_TTL) });
    return { kind: "ok", list: outcome.list, fresh: true };
  }
  await rememberState(ctx, outcome.kind);
  return outcome;
}

/** La réponse « jaquette » qui correspond à une correction mémorisée. */
function coverOfFix(fix) {
  if (fix.kind === "none" || !fix.img) return { status: "none", url: null };
  return { status: "found", url: fx.rawgImageUrl(fix.img), ...(fix.name ? { name: fix.name } : {}), ...(fix.rawgId ? { id: fix.rawgId } : {}), ambiguous: false };
}

/**
 * Jaquette d'un jeu → { status: "found" | "none" | "no-key" | "refused" | "unreachable", url, name?, id?, ambiguous? }. Ne lève jamais.
 * La correction de la propriétaire (s'il y en a une) passe AVANT le cache et avant RAWG. Un titre douteux entre dans « Jaquettes à vérifier ».
 */
export async function cover(ctx, title) {
  try {
    // Le titre complet (120 caractères au plus) sert à retrouver une correction ; RAWG n'en reçoit que les 100 premiers.
    const asked = cleanTitle(title, 120);
    const search = asked.slice(0, MAX_TITLE).trim();
    const { key, valid } = await keyOf(ctx);
    if (!key) return { status: "no-key", url: null };
    if (!valid) return { status: "refused", url: null };
    if (!search) return { status: "none", url: null };

    const fix = await fx.fixFor(ctx, asked);
    if (fix) return coverOfFix(fix);

    const looked = await lookup(ctx, key, search);
    if (looked.kind !== "ok") return { status: looked.kind, url: null };
    const ranked = rank(search, looked.list);
    const best = ranked[0];
    if (!best || !best.image) return { status: "none", url: null };
    // Sans nom, rien à comparer : `ambiguous` est alors absent (inconnu), et le titre n'entre pas dans la liste.
    const ambiguous = best.name ? isAmbiguous(ranked) : undefined;
    // Seulement quand RAWG vient d'être interrogé (jamais à chaque lecture du cache) ; une même entrée est mise à jour, pas doublée.
    if (ambiguous && looked.fresh) void fx.noteDoubtful(ctx, { title: asked, name: best.name, rawgId: best.id || undefined, url: best.image, candidates: ranked.length });
    return { status: "found", url: best.image, ...(best.name ? { name: best.name } : {}), ...(best.id ? { id: best.id } : {}), ...(ambiguous !== undefined ? { ambiguous } : {}) };
  } catch {
    return { status: "unreachable", url: null };
  }
}

/**
 * Les jeux que RAWG propose pour ce titre (6 au plus, jaquette obligatoire, du plus ressemblant au moins ressemblant). `search` : une autre recherche
 * (l'écran de correction laisse taper le vrai nom) ; ce texte n'est qu'un mot de recherche envoyé à RAWG, jamais une adresse. Ne lève jamais.
 */
export async function candidates(ctx, title, search) {
  try {
    const asked = cleanTitle(title);
    const words = cleanTitle(search) || asked;
    const { key, valid } = await keyOf(ctx);
    if (!key) return { status: "no-key", candidates: [] };
    if (!valid) return { status: "refused", candidates: [] };
    if (!words) return { status: "none", candidates: [] };
    const looked = await lookup(ctx, key, words);
    if (looked.kind !== "ok") return { status: looked.kind, candidates: [] };
    const out = [];
    for (const c of rank(words, looked.list)) {
      // Seules les images de RAWG (media.rawg.io) sont proposées : rien d'autre n'est montré ni gardé.
      if (!c.image || !fx.rawgImagePath(c.image) || !c.id || !c.name || out.some((o) => o.id === c.id)) continue;
      out.push({ id: c.id, name: c.name, year: c.year, platforms: c.platforms, url: c.image });
      if (out.length >= MAX_CANDIDATES) break;
    }
    return { status: out.length ? "found" : "none", candidates: out };
  } catch {
    return { status: "unreachable", candidates: [] };
  }
}

/** « Tester la clé » : interroge RAWG avec la clé enregistrée et mémorise le résultat. → "ok" | "refused" | "unreachable" | "no-key" | "invalid". Ne lève jamais. */
export async function checkKey(ctx) {
  try {
    const { key, valid } = await keyOf(ctx);
    if (!key) return "no-key";
    if (!valid) return "invalid";
    const outcome = await query(ctx, key, "portal");
    await rememberState(ctx, outcome.kind === "ok" ? "ok" : outcome.kind, true);
    return outcome.kind === "ok" ? "ok" : outcome.kind;
  } catch {
    return "unreachable";
  }
}
