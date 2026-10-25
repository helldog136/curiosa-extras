// Questions fréquentes : les données et leurs garde-fous (stockage de l'instance, ordre, limiteurs en mémoire).
//
// Trois collections, toutes propres à l'instance :
//   faq_themes  { names: { fr, en }, pos }
//   faq_items   { slug, theme, pos, status: "published" | "draft", tr: { fr: { q, a }, en: { q, a } }, y, n, by?, from?, source? }
//   faq_asked   { text, lang, count, last, status: "new" | "drafted", draft? }
// Rien n'est lu sans borne : au plus LIMITS.items questions, LIMITS.themes thèmes, LIMITS.asked questions reçues.

// Chaque fichier voisin est importé AVEC la version du fichier principal : sinon une mise à jour à chaud garderait l'ancien (voir docs/HOT-UPDATE.md).
const v = new URL(import.meta.url).search;
const { LIMITS, clean, num, safeSlug, slugify, fold } = await import(`./text.mjs${v}`);

export const C = { items: "faq_items", themes: "faq_themes", asked: "faq_asked" };
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

const time = (value, fallback) => { const t = Date.parse(value ?? ""); return Number.isFinite(t) ? t : fallback; };

// ── Lecture (chaque ligne est remise en forme : une sauvegarde ancienne ou abîmée ne fait jamais planter une page) ─────

export async function loadThemes(ctx) {
  const rows = await ctx.api.store.list(C.themes, { limit: LIMITS.themes + 20 });
  return rows
    .map((r) => {
      const names = {};
      for (const [l, v] of Object.entries(r.data?.names ?? {}).slice(0, 12)) if (LOCALE.test(l)) { const n = clean(v, LIMITS.themeName); if (n) names[l] = n; }
      return { id: r.id, createdAt: new Date(r.createdAt).getTime() || 0, names, pos: Number(r.data?.pos) || 0 };
    })
    .sort((a, b) => a.pos - b.pos || a.createdAt - b.createdAt);
}

export async function loadItems(ctx) {
  const rows = await ctx.api.store.list(C.items, { limit: LIMITS.items + 50 });
  return rows
    .map((r) => {
      const tr = {};
      for (const [l, v] of Object.entries(r.data?.tr ?? {}).slice(0, 12)) {
        if (!LOCALE.test(l)) continue;
        const q = clean(v?.q, LIMITS.question);
        const a = clean(v?.a, LIMITS.answer, true);
        if (q || a) tr[l] = { q, a };
      }
      return {
        id: r.id,
        createdAt: new Date(r.createdAt).getTime() || 0,
        slug: safeSlug(r.data?.slug) || safeSlug(`q-${r.id}`) || "question",
        theme: typeof r.data?.theme === "string" ? r.data.theme : "",
        pos: Number(r.data?.pos) || 0,
        status: r.data?.status === "published" ? "published" : "draft",
        tr,
        y: Math.max(0, Math.trunc(Number(r.data?.y)) || 0),
        n: Math.max(0, Math.trunc(Number(r.data?.n)) || 0),
        by: r.data?.by === "assistant" ? "assistant" : "admin",
        from: typeof r.data?.from === "string" ? r.data.from : "",
      };
    })
    .sort((a, b) => a.pos - b.pos || a.createdAt - b.createdAt);
}

export async function loadAsked(ctx) {
  const rows = await ctx.api.store.list(C.asked, { limit: LIMITS.asked + 50 });
  return rows
    .map((r) => {
      const at = new Date(r.createdAt).getTime() || 0;
      return {
        id: r.id,
        createdAt: at,
        text: clean(r.data?.text, LIMITS.asking),
        lang: LOCALE.test(String(r.data?.lang ?? "")) ? String(r.data.lang) : "",
        count: Math.min(999, Math.max(1, Math.trunc(Number(r.data?.count)) || 1)),
        last: time(r.data?.last, at),
        status: r.data?.status === "drafted" ? "drafted" : "new",
        draft: typeof r.data?.draft === "string" ? r.data.draft : "",
      };
    })
    .sort((a, b) => b.last - a.last);
}

/** Une ligne du stockage, lue pour une collection précise (un identifiant d'une autre collection de l'instance est refusé). */
export async function getRow(ctx, id, expect) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  const row = await ctx.api.store.get(id);
  if (!row || typeof row.data !== "object" || row.data === null) return null;
  if (expect === "item" && !("tr" in row.data)) return null;
  if (expect === "theme" && !("names" in row.data)) return null;
  if (expect === "asked" && !("text" in row.data)) return null;
  return row;
}

// ── Écriture ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Une seule écriture à la fois par instance (le stockage n'a pas d'incrément atomique : deux avis simultanés se perdraient). */
const chains = new Map();
export function locked(ctx, fn) {
  const key = ctx.instance.key;
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}

/** Identifiant d'ancre libre pour une nouvelle question. */
export function uniqueSlug(items, wanted) {
  const taken = new Set(items.map((i) => i.slug));
  const base = slugify(wanted);
  let slug = base;
  for (let n = 2; taken.has(slug) && n < 1000; n++) slug = `${base.slice(0, 55)}-${n}`;
  return slug;
}

/** Remet les positions d'une liste en 1..n (n'écrit que ce qui change). */
export async function renumber(ctx, rows) {
  let i = 0;
  for (const r of rows) {
    i++;
    if (r.pos !== i) {
      const row = await ctx.api.store.get(r.id);
      if (row) await ctx.api.store.update(r.id, { ...row.data, pos: i });
    }
  }
}

/** Les questions publiées d'un thème, dans l'ordre d'affichage. */
export const siblings = (items, theme) => items.filter((i) => i.status === "published" && i.theme === theme);
export const nextPos = (list) => list.reduce((m, i) => Math.max(m, i.pos), 0) + 1;

// ── Limiteurs en mémoire : un garde-fou, pas un pare-feu (remis à zéro au redémarrage, rien n'est écrit sur le disque) ─────

const salt = (() => {
  try { return Array.from(globalThis.crypto.getRandomValues(new Uint32Array(2))).join("-"); } catch { return String(Math.random()); }
})();

/** Petit hachage (53 bits) : sert à ne pas garder d'adresse en clair, même en mémoire. */
function hash53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Qui est le visiteur, sans garder son adresse : une empreinte propre à l'instance et à ce démarrage du site. L'adresse utile est la dernière de la liste (celle que le relais du site ajoute). */
export function visitorId(request, ctx) {
  const forwarded = String(request.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = (forwarded.at(-1) ?? "local").slice(0, 80);
  return hash53(`${salt}|${ctx.instance.key}|${ip}`);
}

const hits = new Map();
/** Compte un passage et dit si le visiteur dépasse `max` passages dans la fenêtre. */
export function limited(bucket, max, windowMs, now = Date.now()) {
  const recent = (hits.get(bucket) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(bucket, recent);
  if (hits.size > 4000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < DAY)) hits.delete(k);
    for (const k of hits.keys()) { if (hits.size <= 3000) break; hits.delete(k); }
  }
  return recent.length > max;
}

const voted = new Map();
const VOTED_MAX = 20000;
/** Ce visiteur a-t-il déjà noté cette question depuis moins de 24 h ? (la première fois, le dit pour la suite) */
export function alreadyVoted(who, itemId, now = Date.now()) {
  const key = `${who}|${itemId}`;
  const at = voted.get(key);
  if (at !== undefined && now - at < DAY) return true;
  voted.delete(key);
  voted.set(key, now);
  if (voted.size > VOTED_MAX) {
    for (const [k, v] of voted) if (now - v >= DAY) voted.delete(k);
    for (const k of voted.keys()) { if (voted.size <= VOTED_MAX * 0.75) break; voted.delete(k); }
  }
  return false;
}

/** Dernier e-mail envoyé à l'équipe (au plus un toutes les 6 heures par instance). */
const mailed = new Map();
export function mailDue(ctx, now = Date.now()) {
  const last = mailed.get(ctx.instance.key) ?? 0;
  if (now - last < 6 * HOUR) return false;
  mailed.set(ctx.instance.key, now);
  return true;
}

/** Quand l'instance disparaît, sa mémoire aussi (une FAQ recréée sous la même clé ne doit pas hériter des compteurs de l'ancienne). */
export function forget(ctx) {
  const prefix = `${ctx.instance.key}|`;
  for (const k of [...hits.keys()]) if (k.startsWith(prefix)) hits.delete(k);
  mailed.delete(ctx.instance.key);
  chains.delete(ctx.instance.key);
}

// ── Réglages ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const flag = (ctx, key, fallback) => { const v = ctx.setting(key); return v === undefined || v === null || v === "" ? fallback : v === true || v === "true" || v === 1 || v === "1"; };
export const retentionDays = (ctx) => num(ctx.setting("retentionDays"), 90, 1, 90);

/** Supprime les questions reçues trop anciennes (au plus 50 à la fois, au fil de l'eau : aucun minuteur de fond). */
export async function purgeAsked(ctx, now = Date.now()) {
  const cutoff = now - retentionDays(ctx) * DAY;
  let removed = 0;
  for (const a of await loadAsked(ctx)) {
    if (removed >= 50) break;
    if (a.last < cutoff) { await ctx.api.store.remove(a.id); removed++; }
  }
  return removed;
}

/** Texte plié d'une question reçue, pour regrouper « Quand streamez-vous ? » et « quand streamez vous » en une seule ligne. */
export const askedKey = (text) => fold(text).replace(/[^a-z0-9]+/g, " ").trim();
