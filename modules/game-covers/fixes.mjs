// Corrections de jaquettes et journal « à vérifier » : tout ce que le module garde, dans le stockage privé de l'instance.
//   fixes        un document par titre corrigé, clé = titre normalisé (`titleKey`) : { title, kind: "game" | "none" | "image", rawgId?, name?, img?, at } ; 1000 au plus ;
//   todo         les titres douteux (le jeu trouvé n'est peut-être pas le bon) : { key, title, name, rawgId?, img, candidates, at } ; 100 au plus, 60 jours au plus ;
//   adoptedKey   UN document : la clé reprise du réglage du site (jamais affichée), les réglages saisis ici ont toujours le dessus ;
//   autoCovers   un document par titre dont le site a trouvé la jaquette tout seul, clé = titre normalisé : { title, name?, rawgId?, img, ambiguous?, candidates?, at, until } ;
//                1 000 au plus, les plus anciens sortent à l'écriture (aucun minuteur) ; sert quand RAWG ne répond pas, même après `until` ;
//   keyState     UN document : le dernier état de la clé (ok / refusée / injoignable), sa date et la date de la dernière réponse correcte ;
//   handover     UN document : la reprise des données du site est faite (date, ce qui a été repris — jamais une valeur).
// Une image n'est JAMAIS une adresse libre : seul l'hôte `media.rawg.io` et un chemin `/media/…` valide sont acceptés, et c'est le CHEMIN qui est gardé
// (l'hôte est écrit par le module, jamais lu). Le module ne télécharge aucune image : il ne fait que garder cette adresse.
const q = new URL(import.meta.url).search;
const { titleKey } = await import(new URL("./match.mjs" + q, import.meta.url).href);

export const COL = { fixes: "fixes", todo: "todo", auto: "autoCovers", key: "adoptedKey", state: "keyState", handover: "handover" };
export const MAX_FIXES = 1000;
/** Jaquettes trouvées toutes seules, gardées pour survivre aux redémarrages et aux pannes. Le tableau de l'administration les montre toutes (il n'a pas de recherche côté serveur) : 1 000 + 1 000 + 100 lignes au plus. */
export const MAX_AUTO = 1000;
/** Quand la collection est pleine, on retire d'un coup les plus anciennes par tranche de ce nombre (écriture rare, pas une écriture par jaquette). */
export const AUTO_EVICT = 50;
export const MAX_FIX_TITLE = 120;
export const MAX_TO_CHECK = 100;
/** Un titre douteux que personne n'a regardé depuis ce temps sort de la liste (purge à la lecture, aucun minuteur). */
export const TO_CHECK_DAYS = 60;

const IMAGE_HOST = "media.rawg.io";
const IMAGE_PATH = /^\/media\/[A-Za-z0-9_.\-/]{1,200}\.(?:png|jpe?g|webp)$/;

/** Le chemin (`/media/…`) d'une adresse d'image RAWG, ou null si elle n'est pas permise (https, hôte `media.rawg.io`, sans port, identifiant, paramètre ni détour). */
export function rawgImagePath(input) {
  if (typeof input !== "string" || input.length > 400 || /[\u0000- \u007f\\]/.test(input)) return null;
  let u;
  try { u = new URL(input); } catch { return null; }
  if (u.href !== input) return null; // forme canonique seulement : aucun %2e%2e, aucun port par défaut, rien que le parseur ait « arrangé »
  if (u.protocol !== "https:" || u.hostname !== IMAGE_HOST || u.port || u.username || u.password || u.search || u.hash) return null;
  if (u.pathname.includes("..") || u.pathname.includes("//") || u.pathname.includes("%") || !IMAGE_PATH.test(u.pathname)) return null;
  return u.pathname;
}
export const rawgImageUrl = (path) => `https://${IMAGE_HOST}${path}`;

export const cleanText = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
const isDate = (v) => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
const posInt = (v) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : undefined);

/** Une correction lue dans le stockage (ou reprise du site) : tout ce qui n'est pas parfaitement valide est écarté (jamais d'exception, jamais d'adresse non permise). */
export function sanitizeFix(v) {
  if (!v || typeof v !== "object") return null;
  const title = cleanText(v.title, MAX_FIX_TITLE);
  if (!title || (v.kind !== "game" && v.kind !== "none" && v.kind !== "image")) return null;
  const at = isDate(v.at) ? v.at : new Date(0).toISOString();
  if (v.kind === "none") return { title, kind: "none", at };
  if (typeof v.img !== "string" || rawgImagePath(rawgImageUrl(v.img)) !== v.img) return null;
  const rawgId = posInt(v.rawgId);
  if (v.kind === "game" && rawgId === undefined) return null;
  const name = cleanText(v.name, 150);
  return { title, kind: v.kind, ...(rawgId !== undefined ? { rawgId } : {}), ...(name ? { name } : {}), img: v.img, at };
}

export function sanitizeDoubtful(v) {
  if (!v || typeof v !== "object") return null;
  const title = cleanText(v.title, MAX_FIX_TITLE);
  const key = titleKey(title);
  const name = cleanText(v.name, 150);
  if (!title || !key || !name || typeof v.img !== "string" || rawgImagePath(rawgImageUrl(v.img)) !== v.img || !isDate(v.at)) return null;
  const rawgId = posInt(v.rawgId);
  const candidates = typeof v.candidates === "number" && Number.isInteger(v.candidates) ? Math.min(Math.max(v.candidates, 0), 10) : 0;
  return { key, title, name, ...(rawgId !== undefined ? { rawgId } : {}), img: v.img, candidates, at: v.at };
}

/** Une jaquette trouvée toute seule, lue dans le stockage : tout ce qui n'est pas parfaitement valide est écarté. `until` : la date après laquelle on la revérifie auprès de RAWG (elle reste utilisable après). */
export function sanitizeAuto(v) {
  if (!v || typeof v !== "object") return null;
  const title = cleanText(v.title, MAX_FIX_TITLE);
  if (!title || !titleKey(title) || typeof v.img !== "string" || rawgImagePath(rawgImageUrl(v.img)) !== v.img || !isDate(v.at)) return null;
  const rawgId = posInt(v.rawgId);
  const name = cleanText(v.name, 150);
  const candidates = typeof v.candidates === "number" && Number.isInteger(v.candidates) ? Math.min(Math.max(v.candidates, 0), 10) : undefined;
  return {
    title, ...(name ? { name } : {}), ...(rawgId !== undefined ? { rawgId } : {}), img: v.img,
    ...(typeof v.ambiguous === "boolean" ? { ambiguous: v.ambiguous } : {}), ...(candidates !== undefined ? { candidates } : {}),
    at: v.at, until: isDate(v.until) ? v.until : v.at,
  };
}

/** Une ligne au journal du cœur (le cœur déduit qui l'a écrite) : le titre ou un mot, jamais une clé ni une adresse. Ne lève jamais. */
export async function journal(ctx, action, target, data, level) {
  try { await ctx.api.log?.write({ action, target: String(target ?? "").slice(0, 120), ...(level ? { level } : {}), ...(data ? { data } : {}) }); } catch { /* le journal est un plus */ }
}

/**
 * Écritures en file, une à la fois dans ce processus (lire-modifier-écrire sans mélange : la clé du stockage n'est pas unique). Chaque étape est bornée :
 * une étape qui ne rend pas la main libère la file à l'expiration, jamais de file bloquée jusqu'au redémarrage.
 */
let chain = Promise.resolve();
export function serial(job, ms = 20_000) {
  const run = chain.then(() => {
    let timer;
    return Promise.race([Promise.resolve().then(job), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); timer.unref?.(); })]).finally(() => clearTimeout(timer));
  });
  chain = run.catch(() => {});
  return run;
}

const one = async (ctx, collection) => (await ctx.api.store.list(collection, { limit: 1 }))[0] ?? null;

// ── Corrections ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const fixDoc = (ctx, key) => ctx.api.store.getByKey(COL.fixes, key);

/** La correction de ce titre, ou null. Ne lève jamais. */
export async function fixFor(ctx, title) {
  try {
    const k = titleKey(title);
    if (!k) return null;
    const doc = await fixDoc(ctx, k);
    const fix = doc ? sanitizeFix(doc.data) : null;
    return fix && titleKey(fix.title) === k ? fix : null;
  } catch { return null; }
}

export const countFixes = (ctx) => ctx.api.store.count(COL.fixes);

/**
 * Enregistre (ou remplace) la correction d'un titre. `choice` : { kind: "none" } | { kind: "game", rawgId, name, img } | { kind: "image", img, name? } ; `img` est un chemin permis.
 * Retire le titre de la liste « à vérifier ». { ok: true, fix } | { ok: false, error: "title" | "full" }.
 */
export function saveFix(ctx, rawTitle, choice) {
  return serial(async () => {
    const title = cleanText(rawTitle, MAX_FIX_TITLE + 1);
    const k = titleKey(title);
    if (!title || title.length > MAX_FIX_TITLE || !k) return { ok: false, error: "title" };
    const existing = await fixDoc(ctx, k);
    if (!existing && (await countFixes(ctx)) >= MAX_FIXES) return { ok: false, error: "full" };
    const at = new Date().toISOString();
    const fix = sanitizeFix(choice.kind === "none" ? { title, kind: "none", at } : { title, kind: choice.kind, rawgId: choice.kind === "game" ? choice.rawgId : undefined, name: choice.name, img: choice.img, at });
    if (!fix) return { ok: false, error: "title" };
    if (existing) await ctx.api.store.update(existing.id, fix, { key: k }); else await ctx.api.store.add(COL.fixes, fix, { key: k });
    await dropTodo(ctx, k);
    await dropAuto(ctx, k);   // la correction a la priorité ; l'ancien choix automatique ne doit pas revenir tel quel si elle est oubliée
    return { ok: true, fix };
  });
}

/** Oublie la correction d'un titre (clé normalisée). Vrai si elle existait. */
export function forgetFix(ctx, key) {
  return serial(async () => {
    const doc = await fixDoc(ctx, key);
    if (!doc) return false;
    await ctx.api.store.remove(doc.id);
    return true;
  });
}

/** Oublie toutes les corrections (par paquets de 200 : jamais tout en mémoire). Renvoie combien il y en avait. */
export function forgetAllFixes(ctx) {
  return serial(async () => {
    let n = 0;
    for (let guard = 0; guard < 8; guard++) {
      const rows = await ctx.api.store.list(COL.fixes, { limit: 200 });
      if (!rows.length) break;
      for (const r of rows) { await ctx.api.store.remove(r.id); n++; }
    }
    return n;
  }, 60_000);
}

/**
 * Tout ce que le module retient, en une liste (2 100 lignes au plus : 1 000 corrections, 100 titres à vérifier et 1 000 jaquettes trouvées toutes seules), le plus récent d'abord. Une seule source pour l'écran
 * « Jaquettes enregistrées » et pour l'outil de l'assistant.
 *   origin  « corrected » (un jeu ou une image choisis par la personne), « none » (elle a choisi « Aucune jaquette ») ou « auto » (trouvée par le site tout seul, douteuse ou non).
 * Une correction qui n'est pas valide est écartée ; une ligne « à vérifier » qui a une correction n'apparaît pas deux fois.
 */
export async function savedEntries(ctx, now = Date.now()) {
  const out = [];
  const seen = new Set();
  const page = await ctx.api.store.page(COL.fixes, { limit: MAX_FIXES });
  for (const r of page.items) {
    const fix = sanitizeFix(r.data);
    const key = fix ? titleKey(fix.title) : "";
    if (!fix || !key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, title: fix.title, origin: fix.kind === "none" ? "none" : "corrected", kind: fix.kind, name: fix.name ?? "", rawgId: fix.rawgId ?? null, img: fix.img ?? null, at: fix.at });
  }
  for (const d of await readToCheck(ctx, now)) {
    if (seen.has(d.key)) continue;
    seen.add(d.key);
    out.push({ key: d.key, title: d.title, origin: "auto", kind: "auto", name: d.name, rawgId: d.rawgId ?? null, img: d.img, at: d.at });
  }
  for (const a of await readAutoAll(ctx)) {
    if (seen.has(a.key)) continue;
    seen.add(a.key);
    out.push({ key: a.key, title: a.title, origin: "auto", kind: "auto", name: a.name ?? "", rawgId: a.rawgId ?? null, img: a.img, at: a.at });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Oublie un choix automatique (clé normalisée) : le titre « à vérifier » ET la jaquette gardée toute seule. Le site cherchera de nouveau. Vrai si l'un des deux existait. */
export function forgetTodo(ctx, key) {
  return serial(async () => {
    const doc = await ctx.api.store.getByKey(COL.todo, key);
    if (doc) await ctx.api.store.remove(doc.id);
    const auto = await dropAuto(ctx, key);
    return !!doc || auto;
  });
}

// ── Jaquettes trouvées toutes seules (survivent aux redémarrages et aux pannes) ──────────────────────────────────────────────
/** La jaquette gardée pour ce titre, ou null. Ne lève jamais. → { id, ...auto } */
export async function autoFor(ctx, title) {
  try {
    const k = titleKey(title);
    if (!k) return null;
    const doc = await ctx.api.store.getByKey(COL.auto, k);
    const a = doc ? sanitizeAuto(doc.data) : null;
    return a && titleKey(a.title) === k ? { id: doc.id, key: k, ...a } : null;
  } catch { return null; }
}

/** Toutes les jaquettes gardées toutes seules (1 000 au plus), les plus récentes d'abord. Les lignes illisibles sont écartées. */
export async function readAutoAll(ctx) {
  const out = [];
  try {
    const page = await ctx.api.store.page(COL.auto, { limit: MAX_AUTO });
    for (const r of page.items) {
      const a = sanitizeAuto(r.data);
      const key = a ? titleKey(a.title) : "";
      if (a && key && (r.key === undefined || r.key === key)) out.push({ id: r.id, key, ...a });
    }
  } catch { /* la liste est un plus */ }
  return out;
}

/** Retire la jaquette gardée toute seule pour cette clé (à appeler DANS une écriture en file). Vrai si elle existait. */
async function dropAuto(ctx, key) {
  const doc = await ctx.api.store.getByKey(COL.auto, key);
  if (doc) await ctx.api.store.remove(doc.id);
  return !!doc;
}

/**
 * Garde (ou remplace) la jaquette trouvée pour un titre. Une jaquette rafraîchie est réécrite à neuf (le nouveau document est le plus récent) : les plus anciens sont ceux qu'on n'a pas
 * revus depuis le plus longtemps. Au-delà de 1 000, les plus anciens sortent par tranche de 50, à l'écriture. Ne lève jamais. `entry` : { title, name?, rawgId?, url, ambiguous?, candidates?, ttlMs }.
 */
export function saveAuto(ctx, entry, now = Date.now()) {
  return serial(async () => {
    try {
      const img = rawgImagePath(entry.url);
      const a = img ? sanitizeAuto({ ...entry, img, at: new Date(now).toISOString(), until: new Date(now + entry.ttlMs).toISOString() }) : null;
      if (!a) return false;
      const k = titleKey(a.title);
      if (await ctx.api.store.getByKey(COL.fixes, k)) return false;   // corrigé entre-temps : la correction règne
      const old = await ctx.api.store.getByKey(COL.auto, k);
      await ctx.api.store.add(COL.auto, a, { key: k });
      if (old) await ctx.api.store.remove(old.id);
      const n = await ctx.api.store.count(COL.auto);
      if (n > MAX_AUTO) {
        const rows = await ctx.api.store.page(COL.auto, { limit: Math.min(n - MAX_AUTO + AUTO_EVICT - 1, 1000), order: "asc" });
        for (const r of rows.items) await ctx.api.store.remove(r.id);
      }
      return true;
    } catch (error) { console.error("[game-covers] auto:", error?.name); return false; }
  });
}

/** Repousse la date de revérification d'une jaquette gardée (RAWG n'a rien trouvé cette fois : on garde l'ancienne, on réessaie plus tard). Ne lève jamais. */
export function deferAuto(ctx, stored, ttlMs, now = Date.now()) {
  return serial(async () => {
    try {
      const doc = await ctx.api.store.get(stored.id);
      const a = doc ? sanitizeAuto(doc.data) : null;
      if (a) await ctx.api.store.update(doc.id, { ...a, until: new Date(now + ttlMs).toISOString() }, { key: titleKey(a.title) });
    } catch { /* un plus */ }
  });
}

/** Ce que le module retient pour UN titre (une correction, un titre à vérifier ou une jaquette automatique), sans lire toute la liste. Même forme que `savedEntries`. */
export async function entryFor(ctx, title, now = Date.now()) {
  const key = titleKey(title);
  if (!key) return null;
  const fix = await fixFor(ctx, title);
  if (fix) return { key, title: fix.title, origin: fix.kind === "none" ? "none" : "corrected", kind: fix.kind, name: fix.name ?? "", rawgId: fix.rawgId ?? null, img: fix.img ?? null, at: fix.at };
  const d = (await readToCheck(ctx, now)).find((x) => x.key === key);
  if (d) return { key, title: d.title, origin: "auto", kind: "auto", name: d.name, rawgId: d.rawgId ?? null, img: d.img, at: d.at };
  const a = await autoFor(ctx, title);
  return a ? { key, title: a.title, origin: "auto", kind: "auto", name: a.name ?? "", rawgId: a.rawgId ?? null, img: a.img, at: a.at } : null;
}

/** Une page de corrections (les plus récentes d'abord) : { items: [{ key, …fix }], next }. `cursor` vient d'une page précédente (opaque). */
export async function listFixes(ctx, { cursor, size = 25 } = {}) {
  const page = await ctx.api.store.page(COL.fixes, { limit: Math.min(Math.max(1, size), 100), ...(cursor ? { cursor } : {}) });
  const items = [];
  for (const r of page.items) {
    const fix = sanitizeFix(r.data);
    if (fix) items.push({ key: titleKey(fix.title), ...fix });
  }
  return { items, next: page.next ?? null };
}

// ── Journal « à vérifier » ───────────────────────────────────────────────────────────────────────────────────────────────
async function readTodoRaw(ctx) {
  const rows = await ctx.api.store.list(COL.todo, { limit: MAX_TO_CHECK * 2 });
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const d = sanitizeDoubtful(r.data);
    if (!d || seen.has(d.key)) { await ctx.api.store.remove(r.id).catch(() => {}); continue; }   // invalide ou doublon : écarté
    seen.add(d.key);
    out.push({ id: r.id, ...d });
  }
  return out;
}

async function dropTodo(ctx, key) {
  const doc = await ctx.api.store.getByKey(COL.todo, key);
  if (doc) await ctx.api.store.remove(doc.id);
}

/** Note un titre douteux (le plus récent d'abord ; un titre déjà noté est mis à jour, jamais doublé ; 100 au plus). Ne lève jamais. */
export function noteDoubtful(ctx, entry) {
  return serial(async () => {
    try {
      const img = rawgImagePath(entry.url);
      const d = img ? sanitizeDoubtful({ ...entry, img, at: new Date().toISOString() }) : null;
      if (!d) return;
      if (await fixDoc(ctx, d.key)) return;   // déjà corrigé entre-temps
      const doc = await ctx.api.store.getByKey(COL.todo, d.key);
      if (doc) await ctx.api.store.remove(doc.id);
      await ctx.api.store.add(COL.todo, d, { key: d.key });
      // Au-delà de 100, les plus anciens sortent.
      const rows = await ctx.api.store.list(COL.todo, { limit: MAX_TO_CHECK + 20 });
      for (const r of rows.slice(MAX_TO_CHECK)) await ctx.api.store.remove(r.id);
    } catch (error) { console.error("[game-covers] journal:", error?.name); }
  });
}

/** La liste « à vérifier », la plus récente d'abord. PURGE À LA LECTURE : vieux titres, titres déjà corrigés, excédent au-delà de 100 (sans minuteur de fond). */
export async function readToCheck(ctx, now = Date.now()) {
  const raw = await readTodoRaw(ctx);
  const limit = now - TO_CHECK_DAYS * 86_400_000;
  const kept = [];
  for (const d of raw) {
    const stale = Date.parse(d.at) < limit || !!(await fixDoc(ctx, d.key));
    if (stale || kept.length >= MAX_TO_CHECK) await ctx.api.store.remove(d.id).catch(() => {});
    else kept.push(d);
  }
  return kept;
}

// ── Petits documents uniques ─────────────────────────────────────────────────────────────────────────────────────────────
export async function readOne(ctx, collection) {
  try { return (await one(ctx, collection))?.data ?? null; } catch { return null; }
}
/** Remplace (ou crée) le document unique d'une collection ; n'écrit rien si la valeur est identique. */
export function writeOne(ctx, collection, data) {
  return serial(async () => {
    const doc = await one(ctx, collection);
    if (doc) { if (JSON.stringify(doc.data) !== JSON.stringify(data)) await ctx.api.store.update(doc.id, data); return doc.id; }
    return ctx.api.store.add(collection, data);
  });
}
export function removeOne(ctx, collection) {
  return serial(async () => { for (const r of await ctx.api.store.list(collection, { limit: 5 })) await ctx.api.store.remove(r.id); });
}
