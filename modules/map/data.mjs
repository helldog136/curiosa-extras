// Carte : les données et leurs garde-fous (stockage de l'instance, mémoire à durée limitée, limiteur de débit, lieux venant d'autres modules).
//
// Collections, toutes propres à l'instance :
//   map_places  { code, name, type, lat, lng, address, desc, hours, url, status: "published" | "draft", pos, by? }
//   map_types   { id, names: { fr, en }, sym, pos, seed? }
//   map_cities  { name, lat, lng, pos }              (villes proposées au visiteur qui refuse la géolocalisation)
//   map_hidden  { h, title, from }                   (lieux venant d'autres modules que l'équipe a masqués ; la donnée d'origine n'est jamais touchée)
//   map_meta    { kind: "report" | "seeded", ... }   (compte rendu du dernier import ; marque du jeu de départ)
// Rien n'est lu sans borne : au plus LIMITS.places lieux, LIMITS.types types, LIMITS.cities villes, LIMITS.hidden masqués.
// Les fichiers voisins sont importés avec la même « version » que celui-ci (jamais d'ancien fichier resté en mémoire après une mise à jour).

import { createHash } from "node:crypto";

const q = new URL(import.meta.url).search;
const { LIMITS, clean, num, flag, fold, slugify, safeHref, CODE_RE } = await import(new URL(`./text.mjs${q}`, import.meta.url).href);
const { validPosition } = await import(new URL(`./geo.mjs${q}`, import.meta.url).href);
const { TEMPLATES, DEFAULT_TEMPLATE } = await import(new URL(`./templates.mjs${q}`, import.meta.url).href);

export const C = { places: "map_places", types: "map_types", cities: "map_cities", hidden: "map_hidden", meta: "map_meta" };
export const SECOND = 1000;
export const MINUTE = 60_000;
export const DAY = 24 * 3_600_000;
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;
const KINDS = new Set(["event", "studio", "address", "member", "place"]);

// ── Lecture ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Lit toute une collection par pages (1 000 au plus par appel du cœur), jusqu'à `cap` lignes. */
async function readAll(ctx, collection, cap) {
  const out = [];
  let cursor = null;
  do {
    const page = await ctx.api.store.page(collection, { limit: Math.min(1000, cap - out.length), cursor, order: "asc" });
    out.push(...page.items);
    cursor = page.next;
  } while (cursor && out.length < cap);
  return out.slice(0, cap);
}

const names = (raw) => {
  const out = {};
  for (const [l, v] of Object.entries(raw ?? {}).slice(0, 12)) if (LOCALE.test(l)) { const n = clean(v, LIMITS.typeName); if (n) out[l] = n; }
  return out;
};

export function normalizeType(r) {
  const id = String(r.data?.id ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  return {
    rowId: r.id, id, names: names(r.data?.names), sym: clean(r.data?.sym, 8), pos: Number(r.data?.pos) || 0,
    seed: r.data?.seed === true, createdAt: new Date(r.createdAt).getTime() || 0,
  };
}

export function normalizePlace(r) {
  const d = r.data ?? {};
  const lat = Number(d.lat), lng = Number(d.lng);
  const code = typeof d.code === "string" && CODE_RE.test(d.code) ? d.code : "";
  if (!code || !validPosition(lat, lng)) return null; // une ligne abîmée (sauvegarde restaurée à la main…) n'est jamais affichée
  const p = {
    rowId: r.id, code, name: clean(d.name, LIMITS.name), type: String(d.type ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40),
    lat, lng, address: clean(d.address, LIMITS.address), desc: clean(d.desc, LIMITS.desc, true), hours: clean(d.hours, LIMITS.hours, true),
    url: safeHref(clean(d.url, LIMITS.url)) ?? "", status: d.status === "published" ? "published" : "draft",
    pos: Number(d.pos) || 0, by: ["assistant", "import"].includes(d.by) ? d.by : "admin", createdAt: new Date(r.createdAt).getTime() || 0, ext: false,
  };
  if (!p.name) return null;
  p.hay = fold(`${p.name} ${p.address} ${p.desc}`);
  return p;
}

// ── Mémoire à durée limitée ──────────────────────────────────────────────────────────────────────────────────────────
// Les lieux sont lus une fois puis gardés 20 secondes (ou jusqu'à la prochaine écriture de l'équipe) : 5 000 lieux ne se relisent pas à chaque visite.

const TTL = 20 * SECOND;
const cache = new Map();    // clé d'instance → { at, gen, data }
const extCache = new Map(); // clé d'instance + langue → { at, data }
const MAX_CACHES = 200;

async function generation(ctx) {
  try { return typeof ctx.api.store.generation === "function" ? await ctx.api.store.generation() : 0; } catch { return 0; }
}

/** Efface la mémoire de l'instance : à appeler après toute écriture. */
export function invalidate(ctx) {
  cache.delete(ctx.instance.key);
  for (const k of [...extCache.keys()]) if (k.startsWith(`${ctx.instance.key}|`)) extCache.delete(k);
}

/** Tout ce que l'instance possède : lieux (tous états), types, villes, masqués. */
export async function world(ctx) {
  const key = ctx.instance.key;
  const gen = await generation(ctx);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL && hit.gen === gen) return hit.data;
  const [placeRows, typeRows, cityRows, hiddenRows] = await Promise.all([
    readAll(ctx, C.places, LIMITS.places), readAll(ctx, C.types, LIMITS.types + 10), readAll(ctx, C.cities, LIMITS.cities + 10), readAll(ctx, C.hidden, LIMITS.hidden),
  ]);
  const places = placeRows.map(normalizePlace).filter(Boolean);
  const seen = new Set(); // deux lieux avec le même code (restauration à la main) : le premier gagne
  const unique = places.filter((p) => (seen.has(p.code) ? false : (seen.add(p.code), true)));
  unique.sort((a, b) => a.pos - b.pos || a.createdAt - b.createdAt);
  const types = typeRows.map(normalizeType).filter((t) => t.id).sort((a, b) => a.pos - b.pos || a.createdAt - b.createdAt);
  const cities = cityRows
    .map((r) => ({ rowId: r.id, name: clean(r.data?.name, LIMITS.cityName), lat: Number(r.data?.lat), lng: Number(r.data?.lng), pos: Number(r.data?.pos) || 0, createdAt: new Date(r.createdAt).getTime() || 0 }))
    .filter((c) => c.name && validPosition(c.lat, c.lng))
    .sort((a, b) => (fold(a.name) < fold(b.name) ? -1 : fold(a.name) > fold(b.name) ? 1 : a.createdAt - b.createdAt));
  const hidden = new Map(hiddenRows.filter((r) => typeof r.data?.h === "string").map((r) => [r.data.h, { rowId: r.id, title: clean(r.data.title, LIMITS.name), from: clean(r.data.from, LIMITS.name) }]));
  const data = { places: unique, types, cities, hidden, byCode: new Map(unique.map((p) => [p.code, p])) };
  if (cache.size >= MAX_CACHES) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), gen, data });
  return data;
}

// ── Lieux venant d'autres modules (sujet `map.place`, lecture seule) ─────────────────────────────────────────────────

const hex = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12);
const kindSlug = (kind) => slugify(String(kind ?? ""), "place");
export const isKnownKind = (slug) => KINDS.has(slug);

const extPending = new Map();
/** Délai au plus accordé aux autres modules pour répondre : la page ne reste jamais suspendue à une source lente. */
export const TIMING = { externalMs: 2500 };

async function readExternal(ctx) {
  let items = [];
  let ok = true;
  let timer;
  try {
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), TIMING.externalMs); });
    items = await Promise.race([ctx.api.topics.collect("map.place", { limit: LIMITS.external }), limit]);
    if (!Array.isArray(items)) { items = []; ok = false; }
  } catch {
    items = [];
    ok = false;
  } finally {
    clearTimeout(timer);
  }
  const out = [];
  const seen = new Set();
  for (const it of items.slice(0, LIMITS.external)) {
    if (!it || typeof it !== "object") continue;
    const lat = Number(it.lat), lng = Number(it.lng);
    const title = clean(it.title, LIMITS.name);
    const id = clean(it.id, 200);
    if (!title || !id || !validPosition(lat, lng)) continue;
    const from = clean(it.source?.name, LIMITS.name);
    const code = `x${hex(`${it.source?.instance ?? ""}|${id}`)}`;
    if (seen.has(code)) continue;
    seen.add(code);
    const at = typeof it.at === "string" && Number.isFinite(Date.parse(it.at)) ? it.at : "";
    out.push({
      rowId: null, code, name: title, type: kindSlug(it.kind), kind: clean(it.kind, 30), lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5,
      address: "", desc: clean(it.note, LIMITS.note, true), hours: "", url: safeHref(clean(it.url, LIMITS.url)) ?? "", status: "published", pos: 0, ext: true,
      at, from, hay: fold(`${title} ${clean(it.note, LIMITS.note)}`),
    });
  }
  return { ok, places: out };
}

/**
 * Les lieux que les autres modules publient. Rien n'est jamais montré mieux que reçu : titre, position, genre, lien, date et note sont repris tels quels (nettoyés),
 * sans aucune coordonnée ni adresse ajoutée. `ok: false` quand la lecture a échoué (le site continue avec ses propres lieux et les dernières données connues).
 */
export async function external(ctx) {
  const key = `${ctx.instance.key}|${ctx.locale}`;
  const hit = extCache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const waiting = extPending.get(key); // une seule lecture à la fois par instance et par langue
  if (waiting) return waiting;
  const run = readExternal(ctx).then((fresh) => {
    const data = !fresh.ok && hit ? { ok: false, places: hit.data.places } : fresh;
    if (extCache.size >= MAX_CACHES) extCache.delete(extCache.keys().next().value);
    extCache.set(key, { at: Date.now(), data });
    return data;
  }).finally(() => extPending.delete(key));
  extPending.set(key, run);
  return run;
}

/** Une date d'événement est-elle déjà passée (plus de 36 heures) ? Une date illisible ne cache rien. */
export function isPast(at, now = Date.now()) {
  const t = Date.parse(at ?? "");
  return Number.isFinite(t) && t < now - 36 * 3_600_000;
}

/**
 * Ce que voit le visiteur : les lieux publiés de l'équipe, puis ceux des autres modules (sauf masqués ou dépassés, ou si le réglage les coupe).
 * Rend aussi les genres disponibles (types de l'équipe qui ont au moins un lieu, puis genres venus d'ailleurs).
 */
export async function visible(ctx, { now = Date.now() } = {}) {
  const w = await world(ctx);
  const own = w.places.filter((p) => p.status === "published");
  let ext = [];
  let extOk = true;
  if (flag(ctx, "showExternal", true)) {
    const e = await external(ctx);
    extOk = e.ok;
    const hidePast = flag(ctx, "hidePast", true);
    ext = e.places.filter((p) => !w.hidden.has(p.code) && !(hidePast && isPast(p.at, now)));
  }
  const all = [...own, ...ext];
  if (String(ctx.setting("sort") ?? "order") === "name") all.sort((a, b) => (fold(a.name) < fold(b.name) ? -1 : fold(a.name) > fold(b.name) ? 1 : a.code < b.code ? -1 : 1));
  const used = new Set(all.map((p) => p.type));
  const ownTypes = w.types.filter((t) => used.has(t.id));
  const known = new Set(w.types.map((t) => t.id));
  const virtual = [...used].filter((id) => id && !known.has(id));
  return { all, types: ownTypes, virtual, extOk, world: w, byCode: new Map(all.map((p) => [p.code, p])) };
}

/** Le nom d'un type dans la langue du visiteur, sinon celle du site, sinon la première qui existe. */
export function typeName(ctx, t) {
  const n = t?.names ?? {};
  return n[ctx.locale] || n[ctx.defaultLocale] || Object.values(n)[0] || "";
}

/** Nom et symbole d'un type pour un lieu : type de l'équipe, sinon genre venu d'un autre module, sinon « lieu ». */
export function typeInfo(ctx, w, id) {
  const t = w.types.find((x) => x.id === id);
  if (t) return { id, name: typeName(ctx, t) || ctx.t("kind_place"), sym: t.sym || "📍" };
  if (isKnownKind(id)) return { id, name: ctx.t(`kind_${id}`), sym: { event: "📅", studio: "🎙️", address: "⭐", member: "👤", place: "📍" }[id] };
  if (id) return { id, name: id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()), sym: "📍" };
  return { id: "", name: ctx.t("kind_place"), sym: "📍" };
}

// ── Écriture ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Une seule écriture à la fois par instance (le stockage n'a pas de transaction sur plusieurs lignes). */
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

/** Code d'une nouvelle fiche : lettres minuscules et chiffres, jamais déjà pris dans l'instance. */
export function newCode(taken) {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  for (let n = 0; n < 50; n++) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
    const code = "p" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
    if (!taken.has(code)) return code;
  }
  throw new Error("no free code");
}

/** Prochaine position (rang) à la fin de la liste. */
export const nextPos = (list) => list.reduce((m, i) => Math.max(m, i.pos), 0) + 1;

/** Remet les rangs en 1..n quand deux lignes en partagent un (n'écrit que ce qui change). */
export async function renumber(ctx, list) {
  let i = 0;
  for (const r of list) {
    i++;
    if (r.pos !== i) {
      const row = await ctx.api.store.get(r.rowId);
      if (row) await ctx.api.store.update(r.rowId, { ...row.data, pos: i });
    }
  }
}

/** Une ligne du stockage, relue pour une collection précise (un identifiant d'une autre collection de l'instance est refusé). */
export async function getRow(ctx, id, expect) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  const row = await ctx.api.store.get(id);
  if (!row || typeof row.data !== "object" || row.data === null) return null;
  if (expect === "place" && !("code" in row.data)) return null;
  if (expect === "type" && !("names" in row.data)) return null;
  if (expect === "city" && !("name" in row.data && "lat" in row.data && !("code" in row.data))) return null;
  if (expect === "hidden" && !("h" in row.data)) return null;
  return row;
}

/** Ajoute les types d'un gabarit (ceux qui n'existent pas encore) et retire les types « de départ » inutilisés d'un gabarit précédent. Idempotent. */
export async function applyTemplate(ctx, templateId, { replace = true } = {}) {
  const tpl = TEMPLATES[templateId] ?? TEMPLATES[DEFAULT_TEMPLATE];
  const w = await world(ctx);
  const inUse = new Set(w.places.map((p) => p.type));
  const wanted = new Set(tpl.types.map((t) => t.id));
  let removed = 0;
  let added = 0;
  if (replace) {
    for (const t of w.types) {
      if (t.seed && !wanted.has(t.id) && !inUse.has(t.id)) { await ctx.api.store.remove(t.rowId); removed++; }
    }
  }
  const have = new Set(w.types.map((t) => t.id));
  let pos = nextPos(w.types);
  for (const t of tpl.types) {
    if (have.has(t.id) || w.types.length + added >= LIMITS.types) continue;
    await ctx.api.store.add(C.types, { id: t.id, names: { fr: t.fr, en: t.en }, sym: t.sym, pos: pos++, seed: true });
    added++;
  }
  invalidate(ctx);
  return { added, removed };
}

/** Pose le jeu de départ neutre une seule fois (au premier usage si le crochet de création n'a pas tourné : l'instance peut aussi naître d'une restauration). */
export async function ensureSeed(ctx) {
  const w = await world(ctx);
  if (w.types.length || w.places.length) return;
  const meta = await ctx.api.store.list(C.meta, { limit: 20 });
  if (meta.some((r) => r.data?.kind === "seeded")) return;
  await ctx.api.store.add(C.meta, { kind: "seeded" });
  await applyTemplate(ctx, DEFAULT_TEMPLATE, { replace: false });
}

// ── Limiteur de débit en mémoire : un garde-fou, pas un pare-feu (remis à zéro au redémarrage, rien n'est écrit sur le disque) ──

const hits = new Map();
/** Compte un passage et dit si le visiteur dépasse `max` passages dans la fenêtre. */
export function limited(bucket, max, windowMs, now = Date.now()) {
  const recent = (hits.get(bucket) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(bucket, recent);
  if (hits.size > 4000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    for (const k of hits.keys()) { if (hits.size <= 3000) break; hits.delete(k); }
  }
  return recent.length > max;
}

/** Quand l'instance disparaît, sa mémoire aussi. */
export function forget(ctx) {
  invalidate(ctx);
  const prefix = `${ctx.instance.key}|`;
  for (const k of [...hits.keys()]) if (k.startsWith(prefix)) hits.delete(k);
  chains.delete(ctx.instance.key);
}

/** Qui est le visiteur, sans garder son adresse : l'empreinte du cœur (propre à ce module, changée chaque jour). */
export function visitorId(request, ctx, scope) {
  try { return ctx.api.visitor.fingerprint(request, scope); } catch { return "local"; }
}

export const sizeLimit = (ctx) => num(ctx.setting("perPage"), 20, 5, LIMITS.perPage);
