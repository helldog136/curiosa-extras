// Contacts — la couche de données : lecture/écriture du stockage (`ctx.api.store`, cœur 0.2.0 : `page`, `key`, `listByKey`, `addMany`, `generation`)
// et l'INDEX MÉMOIRE borné du carnet. Aucune règle métier ici (voir book.mjs), aucun texte affiché.
//
// Collections (toutes dans l'instance Contacts) :
//   contacts    une fiche PERSONNE par document ; l'id du document EST l'id de la fiche (stable depuis Contacts 1.x).
//               clé (`key`) = « e:<e-mail> » quand la fiche a un e-mail (recherche exacte par e-mail sans parcourir le carnet).
//   orgs        une fiche ORGANISATION par document (même forme, `kind: "org"` ; même clé « e:… »). Les ids sont uniques dans tout le stockage :
//               `get(id)` ne dépend pas de la collection.
//   notes       une note par document, clé = id de la fiche (`listByKey`) : jamais une collection par fiche, aucun plafond global.
//   categories  { name, color, icon } ; une catégorie fusionnée garde un document { movedTo } (les anciens ids sont suivis).
//   moved       clé = id d'une fiche fusionnée, { from, to } : `get` / `resolve` d'un ancien id disent où la fiche est passée.
//   meta        un document, clé « stamp » : tampon qui change à chaque écriture (l'index d'une autre copie du module sait qu'il doit relire).
//
// L'index (≈ 200 à 300 octets par fiche : id, date, nom sans accents, clés de comptes, catégories, organisation, drapeaux) est tenu à jour par
// le module à chacune de SES écritures et jeté quand `store.generation()` change (restauration, annulation de migration), quand une écriture
// échoue à moitié, ou quand le nombre de fiches ne correspond plus. Sa reconstruction lit des pages de 1 000, avec une durée bornée ; une seule
// reconstruction à la fois (promesse partagée), et chaque attente a une EXPIRATION : rien n'attend jamais sans fin.
import { fold, accountKey, NETWORKS } from "./networks.mjs";

export const LIMITS = {
  maxContacts: 100_000,          // plafond technique du carnet (personnes + organisations)
  page: 500, pageDefault: 100, resolve: 100, accountIds: 500, categoriesResolve: 50, search: 30, searchDefault: 10, q: 100, label: 100,
  importRows: 1000, accountsPerContact: 20, categoriesPerContact: 50, categories: 500, notesShown: 50, note: 5000, cursor: 500, id: 80,
  privacyMs: 8000,               // attente maximale par fournisseur « privacy.subject »
  indexWaitMs: 15_000,           // attente maximale d'un appel pendant une reconstruction de l'index
  buildMaxMs: 90_000,            // durée maximale d'une reconstruction (au-delà : abandon, la suivante repart de zéro)
  storeCallMs: 20_000,           // borne d'un appel au stockage pendant la reconstruction
  lockWaitMs: 20_000,            // attente maximale du verrou d'écriture
  lockHoldMs: 60_000,            // durée maximale d'une écriture (au-delà le verrou est rendu et l'index jeté)
  countCheckMs: 30_000,          // vérification « même nombre de fiches » au plus toutes les 30 s
};
export const FIELDS = { name: 120, role: 120, email: 200, phone: 60, others: 1000, relation: 300 };
export const ORG_NAME_MAX = 200;
export const KINDS = ["person", "org"];
/** Collection d'une fiche selon son genre. */
export const collectionOf = (kind) => (kind === "org" ? "orgs" : "contacts");
export const CARD_COLLECTIONS = ["contacts", "orgs"];
export const STATUSES = ["to_review", "active"];
export const PALETTE = ["#e8a23b", "#4f9dde", "#58b368", "#d1556b", "#9b6bd1", "#3bb3a8", "#c9853a", "#7a8794"];

export class Busy extends Error { constructor(m = "contacts index busy") { super(m); this.code = "busy"; } }
export const idOk = (v) => typeof v === "string" && v.length > 0 && v.length <= LIMITS.id;
export const validEmail = (v) => typeof v === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
export const emailKey = (email) => (email ? `e:${email}`.slice(0, 200) : null);
/** Options de TEST internes (jamais un réglage visible) : le test les pose sur son faux contexte. */
const testOpt = (ctx, k) => { const o = ctx?.__contactsTest; return o && typeof o === "object" ? o[k] : undefined; };
export const maxContacts = (ctx) => { const n = testOpt(ctx, "maxContacts"); return Number.isInteger(n) && n > 0 ? n : LIMITS.maxContacts; };
export const privacyMs = (ctx) => { const n = testOpt(ctx, "privacyTimeoutMs"); return Number.isInteger(n) && n > 0 ? n : LIMITS.privacyMs; };
const limit = (ctx, k) => { const n = testOpt(ctx, k); return Number.isInteger(n) && n > 0 ? n : LIMITS[k]; };

/** Une promesse bornée : au-delà de `ms`, rejet (`Busy`). Le minuteur est toujours nettoyé. */
export function within(promise, ms, what = "timeout") {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Busy(what)), ms); });
  return Promise.race([Promise.resolve(promise), late]).finally(() => clearTimeout(timer));
}

// ── Curseurs opaques : [méthode, date de création (ms), id, rang du compte] en base64url ──────────────────────────────────────────────────────
export const encCursor = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
export function decCursor(c, tag) {
  if (c === undefined || c === null || c === "") return { start: true };
  if (typeof c !== "string" || c.length > LIMITS.cursor) return { bad: true };
  try {
    const v = JSON.parse(Buffer.from(c, "base64url").toString("utf8"));
    return Array.isArray(v) && v[0] === tag && Number.isFinite(v[1]) && typeof v[2] === "string" ? { at: v } : { bad: true };
  } catch { return { bad: true }; }
}

// ── État par instance ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const STATES = new Map();
function stateOf(ctx) {
  const id = ctx.instance?.id ?? "?";
  let s = STATES.get(id);
  if (!s) { s = { idx: null, build: null, tail: Promise.resolve(), writing: 0, checkedAt: 0 }; STATES.set(id, s); }
  return s;
}
/** Oublie l'index d'une instance (migration, écriture interrompue, test). */
export function forgetIndex(ctx) { const s = stateOf(ctx); s.idx = null; s.build = null; }

async function generationOf(ctx) {
  const st = ctx.api.store;
  if (typeof st.generation !== "function") return 0;
  try { const g = await within(st.generation(), limit(ctx, "storeCallMs"), "generation"); return Number.isSafeInteger(g) ? g : 0; } catch { return -1; }
}

// ── Entrées de l'index ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// E = { id, t: date (ms), k: drapeaux (1 = organisation, 2 = à vérifier), n: nom sans accents, d: nom affiché (organisations seulement),
//       a: clés des comptes jointes par \u0001 (« twitch:x\u0001youtube:@y ») | null, h: noms affichés des comptes (sans accents, seulement s'ils
//       diffèrent du pseudo) | null, c: ids de catégories | null, o: id d'organisation | null }. Une chaîne plutôt qu'un tableau : moins de mémoire.
export const SEP = "\u0001";
export const keysOf = (e) => (e.a ? e.a.split(SEP) : []);
export const isContactData = (d) => !!d && typeof d === "object" && typeof d.name === "string" && STATUSES.includes(d.status) && (d.kind === undefined || KINDS.includes(d.kind));
export const kindOf = (d) => (d.kind === "org" ? "org" : "person");
export function entryOf(rec) {
  const d = rec.data;
  const org = kindOf(d) === "org";
  const accs = Array.isArray(d.accounts) ? d.accounts.filter((a) => a && NETWORKS.includes(a.network) && typeof a.handle === "string") : [];
  const names = accs.map((a) => (a.displayName ? fold(a.displayName) : "")).filter((x, i) => x && x !== accs[i].handle && x !== accs[i].handle.replace(/^@/, ""));
  const cats = Array.isArray(d.categoryIds) ? d.categoryIds.filter(idOk) : [];
  return {
    id: rec.id, t: new Date(rec.createdAt).getTime(), k: (org ? 1 : 0) | (d.status === "to_review" ? 2 : 0), n: fold(d.name), d: org ? String(d.name) : undefined,
    a: accs.length ? accs.map((a) => accountKey(a.network, a.handle)).join(SEP) : null, h: names.length ? names.join(SEP) : null, c: cats.length ? cats : null,
    o: !org && idOk(d.orgId) ? d.orgId : null,
  };
}
const cmp = (t1, id1, t2, id2) => (t1 < t2 ? -1 : t1 > t2 ? 1 : id1 < id2 ? -1 : id1 > id2 ? 1 : 0);
/** Position de la première entrée strictement après (t, id). */
export function after(list, t, id) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cmp(list[mid].t, list[mid].id, t, id) <= 0) lo = mid + 1; else hi = mid; }
  return lo;
}

function emptyIndex(gen) { return { gen, list: [], byId: new Map(), byAccount: new Map(), orgByName: new Map(), cats: new Map(), builtAt: Date.now() }; }
function addEntry(idx, e) {
  const old = idx.byId.get(e.id);
  if (old) removeEntry(idx, old);
  const at = after(idx.list, e.t, e.id);
  if (at === idx.list.length) idx.list.push(e); else idx.list.splice(at, 0, e);
  idx.byId.set(e.id, e);
  for (const k of keysOf(e)) if (!idx.byAccount.has(k)) idx.byAccount.set(k, e.id);
  if (e.k & 1 && !idx.orgByName.has(e.n)) idx.orgByName.set(e.n, e.id);
}
function removeEntry(idx, e) {
  const at = after(idx.list, e.t, e.id) - 1;
  if (at >= 0 && idx.list[at]?.id === e.id) idx.list.splice(at, 1);
  else { const j = idx.list.findIndex((x) => x.id === e.id); if (j >= 0) idx.list.splice(j, 1); }
  idx.byId.delete(e.id);
  for (const k of keysOf(e)) if (idx.byAccount.get(k) === e.id) idx.byAccount.delete(k);
  if (e.k & 1 && idx.orgByName.get(e.n) === e.id) {
    idx.orgByName.delete(e.n);
    const twin = idx.list.find((x) => x.k & 1 && x.n === e.n);
    if (twin) idx.orgByName.set(twin.n, twin.id);
  }
}
/** Met l'index à jour après une écriture d'une fiche (rec = { id, createdAt, data }) ou sa suppression (rec = null, id). */
export function indexPut(idx, rec) { addEntry(idx, entryOf(rec)); }
export function indexDrop(idx, id) { const e = idx.byId.get(id); if (e) removeEntry(idx, e); }
export function indexPutCategory(idx, rec) { idx.cats.set(rec.id, { id: rec.id, ...rec.data }); }
export function indexDropCategory(idx, id) { idx.cats.delete(id); }

async function build(ctx, gen) {
  const started = Date.now();
  const max = limit(ctx, "buildMaxMs"), call = limit(ctx, "storeCallMs");
  const idx = emptyIndex(gen);
  for (const collection of [...CARD_COLLECTIONS, "categories"]) {
    let cursor = null, pages = 0;
    do {
      if (Date.now() - started > max) throw new Busy("index build too long");
      const page = await within(ctx.api.store.page(collection, { limit: 1000, order: "asc", cursor }), call, "store.page");
      for (const r of page.items ?? []) {
        if (collection === "categories") { if (r.data && typeof r.data === "object") indexPutCategory(idx, r); continue; }
        if (!isContactData(r.data)) continue;
        const e = entryOf(r);
        idx.list.push(e); // pages lues dans l'ordre (date, id) : déjà triées
        idx.byId.set(e.id, e);
        for (const k of keysOf(e)) if (!idx.byAccount.has(k)) idx.byAccount.set(k, e.id);
        if (e.k & 1 && !idx.orgByName.has(e.n)) idx.orgByName.set(e.n, e.id);
      }
      cursor = page.next ?? null;
      if (++pages > 2000) throw new Busy("too many pages");
    } while (cursor);
  }
  idx.list.sort((x, y) => cmp(x.t, x.id, y.t, y.id));
  idx.builtAt = Date.now();
  return idx;
}

/**
 * L'index à jour de cette instance. Reconstruit si besoin (une seule reconstruction à la fois, partagée) ; l'attente est bornée
 * (`Busy` au-delà de `indexWaitMs`, la reconstruction continue jusqu'à `buildMaxMs` et sert l'appel suivant).
 */
export async function getIndex(ctx, { waitMs } = {}) {
  const s = stateOf(ctx);
  const [gen, stamp] = await Promise.all([generationOf(ctx), readStamp(ctx)]);
  if (s.idx && s.idx.gen === gen && gen !== -1 && stamp.ok && s.idx.stamp === stamp.v) {
    if (!s.writing && Date.now() - s.checkedAt > limit(ctx, "countCheckMs")) {
      s.checkedAt = Date.now();
      try {
        const n = (await within(Promise.all(CARD_COLLECTIONS.map((c) => ctx.api.store.count(c))), limit(ctx, "storeCallMs"), "count")).reduce((a, b) => a + b, 0);
        if (s.idx && !s.writing && n !== s.idx.list.length) s.idx = null;
      } catch { /* vérification facultative */ }
    }
    if (s.idx) return s.idx;
  }
  s.idx = null;
  if (!s.build || s.build.gen !== gen || s.build.stamp !== stamp.v) {
    const job = { gen, stamp: stamp.v, promise: null };
    job.promise = build(ctx, gen).then((idx) => { idx.stamp = stamp.v; idx.stampId = stamp.id; if (s.build === job) { s.idx = idx; s.checkedAt = Date.now(); } return idx; }).finally(() => { if (s.build === job) s.build = null; });
    job.promise.catch(() => {});
    s.build = job;
  }
  return within(s.build.promise, waitMs ?? limit(ctx, "indexWaitMs"), "index wait");
}

// ── Tampon d'écriture : un document `meta` (clé « stamp ») qui change à chaque écriture du carnet. L'index note la valeur qu'il connaît ; une
//    autre valeur (écriture par une autre copie du module, stockage remplacé) le fait relire. Une lecture indexée par appel. ─────────────────────
async function readStamp(ctx) {
  try {
    const r = await within(getByKey(ctx, "meta", "stamp"), limit(ctx, "storeCallMs"), "stamp");
    return { ok: true, id: r?.id ?? null, v: typeof r?.data?.v === "string" ? r.data.v : null };
  } catch { return { ok: false, id: null, v: null }; }
}
async function writeStamp(ctx, idx) {
  const v = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const data = { k: "stamp", v };
  let id = idx.stampId ?? (await getByKey(ctx, "meta", "stamp"))?.id ?? null;
  if (!id || (await ctx.api.store.update(id, data, { key: "stamp" })) === false) id = await ctx.api.store.add("meta", data, { key: "stamp" });
  idx.stampId = id;
  idx.stamp = v;
}
/** Change le tampon sans index (fin de migration) : toute copie du module relira le carnet. */
export async function touchStamp(ctx) { await writeStamp(ctx, {}); forgetIndex(ctx); }

/**
 * Verrou d'écriture par instance (les règles « un compte = une fiche », « même e-mail = même fiche » se vérifient puis s'écrivent sans
 * qu'une autre écriture se glisse entre les deux). Attente bornée (`Busy`), durée bornée : une écriture qui ne finit pas rend le verrou et l'index est jeté.
 * Après une écriture réussie (`{ ok: true }` ou pas de champ `ok`), le tampon d'écriture change.
 */
export async function withLock(ctx, fn) {
  const s = stateOf(ctx);
  const prev = s.tail;
  let release;
  const mine = new Promise((r) => { release = r; });
  s.tail = prev.then(() => mine);
  try { await within(prev, limit(ctx, "lockWaitMs"), "lock wait"); } catch (e) { release(); throw e; }
  s.writing++;
  let failed = true;
  try {
    const out = await within(Promise.resolve().then(async () => {
      const r = await fn();
      if (r?.ok !== false && s.idx) await writeStamp(ctx, s.idx);
      return r;
    }), limit(ctx, "lockHoldMs"), "write too long");
    failed = false;
    return out;
  } finally {
    s.writing--;
    if (failed) forgetIndex(ctx); // état incertain : l'index sera relu
    release();
  }
}

// ── Lecture par clé (cœur 0.2.0). Repli pour un stockage sans clés (faux contexte d'un kit de test plus ancien) : la clé se déduit des données,
//    au prix d'un parcours (jamais utilisé avec le vrai cœur 0.2.x). ──────────────────────────────────────────────────────────────────────────
const KEY_OF = { contacts: (d) => (d?.email ? emailKey(d.email) : null), orgs: (d) => (d?.email ? emailKey(d.email) : null), notes: (d) => (idOk(d?.contactId) ? d.contactId : null), moved: (d) => (idOk(d?.from) ? d.from : null), meta: (d) => (typeof d?.k === "string" ? d.k : null) };
const keyed = (ctx) => typeof ctx.api.store.getByKey === "function" && typeof ctx.api.store.listByKey === "function";
export const storeHasKeys = keyed;
export async function getByKey(ctx, collection, key) {
  if (keyed(ctx)) return ctx.api.store.getByKey(collection, key);
  let cursor = null, pages = 0;
  do {
    const p = await ctx.api.store.page(collection, { limit: 1000, order: "asc", cursor });
    const hit = (p.items ?? []).find((r) => KEY_OF[collection]?.(r.data) === key);
    if (hit) return { ...hit, key };
    cursor = p.next ?? null;
  } while (cursor && ++pages < 200);
  return null;
}
export async function listByKey(ctx, collection, key, { limit = 100, cursor = null } = {}) {
  if (keyed(ctx)) return ctx.api.store.listByKey(collection, key, { limit, cursor });
  const all = [];
  let c = null, pages = 0;
  do {
    const p = await ctx.api.store.page(collection, { limit: 1000, order: "desc", cursor: c });
    for (const r of p.items ?? []) if (KEY_OF[collection]?.(r.data) === key) all.push({ ...r, key });
    c = p.next ?? null;
  } while (c && ++pages < 200);
  const from = Math.max(0, Number(cursor) || 0);
  return { items: all.slice(from, from + limit), next: from + limit < all.length ? String(from + limit) : null };
}

// ── Lecture d'une fiche, de ses notes ───────────────────────────────────────────────────────────────────────────────────────────────────────
export async function readContact(ctx, id) {
  if (!idOk(id)) return null;
  const r = await ctx.api.store.get(id);
  return r && isContactData(r.data) ? r : null;
}
/** Plusieurs fiches par id (lectures en parallèle, 25 à la fois). Rend une Map id → document. */
export async function readMany(ctx, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const rows = await Promise.all(chunk.map((id) => ctx.api.store.get(id)));
    rows.forEach((r, j) => { if (r && isContactData(r.data)) out.set(chunk[j], r); });
  }
  return out;
}
/** Les `limit` dernières notes d'une fiche (les plus récentes d'abord). */
export async function latestNotes(ctx, id, limitN = LIMITS.notesShown) {
  const p = await listByKey(ctx, "notes", id, { limit: limitN });
  return p.items ?? [];
}
/** Toutes les notes d'une fiche, page par page (borné à 200 pages de 500). */
export async function* allNotes(ctx, id) {
  let cursor = null, pages = 0;
  do {
    const p = await listByKey(ctx, "notes", id, { limit: 500, cursor });
    for (const n of p.items ?? []) yield n;
    cursor = p.next ?? null;
  } while (cursor && ++pages < 200);
}
/** Où est passée une fiche fusionnée (chaîne repliée) ; null si elle n'a jamais été fusionnée ou si la fiche gardée a disparu. */
export async function movedTarget(ctx, idx, id) {
  if (!idOk(id)) return null;
  let cur = id;
  for (let hops = 0; hops < 20; hops++) {
    const m = await getByKey(ctx, "moved", cur);
    const to = m?.data?.to;
    if (!idOk(to) || to === cur) return null;
    if (idx.byId.has(to)) return to;
    cur = to;
  }
  return null;
}

// ── Catégories (toutes en mémoire : 500 au plus, plus les traces de fusion) ─────────────────────────────────────────────────────────────────
/** L'id actuel d'une catégorie (suit les fusions) ; null si elle n'existe pas ou plus. */
export function liveCategory(idx, id) {
  if (!idOk(id)) return null;
  let cur = id;
  for (let n = 0; n < 50; n++) {
    const k = idx.cats.get(cur);
    if (!k) return null;
    if (!k.movedTo) return cur;
    cur = k.movedTo;
  }
  return null;
}
export const liveCategories = (idx) => [...idx.cats.values()].filter((k) => !k.movedTo && typeof k.name === "string");
export const categoryView = (k) => ({ id: k.id, label: k.name, name: k.name, color: /^#[0-9a-f]{6}$/i.test(k.color ?? "") ? k.color.toLowerCase() : PALETTE[0], icon: typeof k.icon === "string" && k.icon ? k.icon : null });
