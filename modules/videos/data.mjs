// Vidéothèque — les données de CETTE instance (rangées dans son stockage) et tout ce qui les écrit.
//
//   vid_items   une ligne par vidéo : { n (numéro stable, sert dans les adresses), provider, ext (identifiant chez la plateforme), title, desc, cat, status, date, dur, free, cover, album, noEmbed, thumb }
//   vid_text    la transcription d'une vidéo (à part : elle peut être longue, la liste n'a pas besoin de la lire)  — clé « x<n> »
//   vid_thumbs  la miniature gardée par le site (octets en base64, 64 Ko au plus)                                    — clé « t<n> »
//   vid_cats    les catégories : { k, slug, names, pos }
//   vid_series  les séries (listes de lecture) : { p, slug, names, descs, status, items: [n…], pos }
//   vid_meta    les compteurs (jamais réutiliser un numéro, même après une suppression)
//   vid_bulk    l'aperçu de l'ajout en lot en cours (une seule ligne, remplacée à chaque fois, périmée au bout d'une heure)
//
// Lecture : tout est lu par pages de 1 000 lignes et gardé en mémoire 20 secondes (au plus 5 000 vidéos) ; chaque écriture de ce module vide la mémoire.
// Écriture : une seule à la fois par instance (verrou en mémoire), bornes vérifiées ICI (pas seulement dans l'écran).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const P = await import(`./pure.mjs${v}`);
const R = await import(`./providers.mjs${v}`);
const { LIMITS, clean, int, fold, slugify, parseDate, today, sitePath, byNewest, afterCursor, cursorOf } = P;

export const C = { items: "vid_items", text: "vid_text", thumbs: "vid_thumbs", cats: "vid_cats", series: "vid_series", meta: "vid_meta", bulk: "vid_bulk" };
export const timing = { ttlMs: 20_000, bulkMs: 60 * 60_000 };

const state = new Map(); // clé d'instance → { snap, at, loading, tail, thumbs }
function st(ctx) {
  let s = state.get(ctx.instance.key);
  if (!s) { s = { snap: null, at: 0, gen: null, loading: null, tail: Promise.resolve(), thumbs: new Map() }; state.set(ctx.instance.key, s); }
  return s;
}
/** Vide la mémoire de cette instance (après chaque écriture). */
export function invalidate(ctx) { const s = st(ctx); s.snap = null; s.at = 0; }
/** Oublie tout de cette instance (instance supprimée, ou test). */
export function forget(ctx) { state.delete(ctx.instance.key); }
export const resetAll = () => state.clear();

/** Une écriture à la fois par instance. */
export function locked(ctx, fn) {
  const s = st(ctx);
  const run = s.tail.then(() => fn());
  s.tail = run.then(() => undefined, () => undefined);
  return run;
}

// ── Lecture ────────────────────────────────────────────────────────────────────────────────────────────────────────

async function readAll(ctx, collection, cap) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 12; i++) {
    const page = await ctx.api.store.page(collection, { limit: 1000, cursor, order: "asc" });
    for (const r of page.items ?? []) out.push(r);
    if (!page.next || out.length >= cap) break;
    cursor = page.next;
  }
  return out.slice(0, cap);
}

const ms = (d) => { const t = d instanceof Date ? d.getTime() : Date.parse(d); return Number.isFinite(t) ? t : 0; };

function normItem(row) {
  const d = row.data ?? {};
  const provider = typeof d.provider === "string" && Object.hasOwn(R.PROVIDERS, d.provider) ? d.provider : null;
  if (!provider || !R.PROVIDERS[provider].validId(d.ext) || !Number.isInteger(d.n) || d.n < 1) return null;
  const createdAt = ms(row.createdAt);
  const title = clean(d.title, LIMITS.title);
  const desc = clean(d.desc, LIMITS.desc, true);
  return {
    rowId: row.id, n: d.n, provider, ext: d.ext, title, desc,
    cat: Number.isInteger(d.cat) && d.cat > 0 ? d.cat : 0,
    status: P.VIDEO_STATUS(d.status),
    date: parseDate(d.date) ?? today(createdAt || Date.now()),
    dur: int(d.dur, 0, 0, 48 * 3600),
    free: d.free === true,
    cover: sitePath(d.cover),
    album: clean(d.album, 80),
    noEmbed: d.noEmbed === true,
    needsTitle: !title,
    thumb: d.thumb === true,
    createdAt,
    hay: fold(`${title} ${desc.slice(0, 400)}`),
  };
}
const normNames = (m, max = LIMITS.name) => {
  const out = {};
  if (m && typeof m === "object") for (const [l, t] of Object.entries(m).slice(0, 20)) if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(l)) { const s = clean(t, max); if (s) out[l] = s; }
  return out;
};
function normCat(row) {
  const d = row.data ?? {};
  if (!Number.isInteger(d.k) || d.k < 1) return null;
  const names = normNames(d.names);
  if (!Object.keys(names).length) return null;
  return { rowId: row.id, k: d.k, slug: clean(d.slug, 40) || `c${d.k}`, names, pos: int(d.pos, d.k, 0, 100000) };
}
function normSeries(row) {
  const d = row.data ?? {};
  if (!Number.isInteger(d.p) || d.p < 1) return null;
  const names = normNames(d.names);
  if (!Object.keys(names).length) return null;
  const items = [...new Set((Array.isArray(d.items) ? d.items : []).filter((n) => Number.isInteger(n) && n > 0))].slice(0, LIMITS.inSeries);
  return { rowId: row.id, p: d.p, slug: clean(d.slug, 40), names, descs: normNames(d.descs, LIMITS.seriesDesc), status: d.status === "published" ? "published" : "draft", items, pos: int(d.pos, d.p, 0, 100000) };
}

/** Tout ce qu'il faut pour afficher : vidéos (la plus récente d'abord), catégories et séries (dans leur ordre). */
export async function snapshot(ctx, { fresh = false } = {}) {
  const s = st(ctx);
  const gen = typeof ctx.api.store.generation === "function" ? await ctx.api.store.generation().catch(() => null) : null;
  if (!fresh && s.snap && Date.now() - s.at < timing.ttlMs && s.gen === gen) return s.snap;
  if (!fresh && s.loading) return s.loading;
  const load = (async () => {
    const [vi, ca, se, me] = await Promise.all([readAll(ctx, C.items, LIMITS.videos), readAll(ctx, C.cats, 200), readAll(ctx, C.series, 500), readAll(ctx, C.meta, 5)]);
    const items = vi.map(normItem).filter(Boolean).sort(byNewest);
    const byN = new Map(items.map((x) => [x.n, x]));
    const cats = ca.map(normCat).filter(Boolean).sort((a, b) => a.pos - b.pos || a.k - b.k);
    const series = se.map(normSeries).filter(Boolean).sort((a, b) => a.pos - b.pos || a.p - b.p);
    const m = me[0];
    const meta = { rowId: m?.id ?? null, nextV: int(m?.data?.nextV, 1, 1, 1e9), nextC: int(m?.data?.nextC, 1, 1, 1e9), nextS: int(m?.data?.nextS, 1, 1, 1e9) };
    meta.nextV = Math.max(meta.nextV, ...items.map((x) => x.n + 1), 1);
    meta.nextC = Math.max(meta.nextC, ...cats.map((x) => x.k + 1), 1);
    meta.nextS = Math.max(meta.nextS, ...series.map((x) => x.p + 1), 1);
    return { items, byN, byExt: new Map(items.map((x) => [`${x.provider}:${x.ext}`, x])), cats, series, meta };
  })();
  if (!fresh) s.loading = load;
  try {
    const snap = await load;
    if (!fresh) { s.snap = snap; s.at = Date.now(); s.gen = gen; }
    return snap;
  } finally { if (!fresh) s.loading = null; }
}

// ── Choisir ce qui se voit ─────────────────────────────────────────────────────────────────────────────────────────

export const isPublic = (x) => x.status === "published" && !!x.title && !!R.providerOf(x);
export const catByRef = (snap, ref) => {
  const r = fold(String(ref ?? "").trim());
  if (!r) return null;
  return snap.cats.find((c) => String(c.k) === r || c.slug === r || Object.values(c.names).some((n) => fold(n) === r)) ?? null;
};
export const catName = (ctx, c) => (c ? P.pickName(c.names, ctx.locale, ctx.defaultLocale) : "");
export const seriesName = (ctx, s) => P.pickName(s.names, ctx.locale, ctx.defaultLocale);
export const seriesVideos = (snap, s) => s.items.map((n) => snap.byN.get(n)).filter((x) => x && isPublic(x));

/** Les vidéos publiées d'une catégorie (0 = toutes) et contenant tous les mots, après le curseur : { items (≤ limit), next (curseur ou ""), total }. */
export function findPublic(snap, { cat = 0, words = [], cursor = null, limit = LIMITS.perPage } = {}) {
  const lim = int(limit, LIMITS.perPage, 1, LIMITS.perPageMax);
  const matches = [];
  let total = 0;
  for (const x of snap.items) {
    if (!isPublic(x)) continue;
    if (cat && x.cat !== cat) continue;
    if (words.length && !words.every((w) => x.hay.includes(w))) continue;
    total++;
    if (cursor && !afterCursor(x, cursor)) continue;
    if (matches.length <= lim) matches.push(x);
  }
  const items = matches.slice(0, lim);
  return { items, next: matches.length > lim ? cursorOf(items[items.length - 1]) : "", total };
}

// ── Miniatures et transcriptions (lignes à clé) ────────────────────────────────────────────────────────────────────

async function rowByKey(ctx, collection, key) {
  const store = ctx.api.store;
  if (typeof store.getByKey === "function") return store.getByKey(collection, key);
  const all = await store.list(collection, { limit: 10000 }); // faux contexte de test seulement : le vrai stockage a un index
  return all.find((r) => r.data?.key === key) ?? null;
}

export async function getText(ctx, n) {
  const row = await rowByKey(ctx, C.text, `x${n}`);
  return clean(row?.data?.text, LIMITS.transcript, true);
}
export async function setText(ctx, n, text) {
  const t = clean(text, LIMITS.transcript, true);
  const row = await rowByKey(ctx, C.text, `x${n}`);
  if (!t) { if (row) await ctx.api.store.remove(row.id); return; }
  if (row) await ctx.api.store.update(row.id, { key: `x${n}`, n, text: t }, { key: `x${n}` });
  else await ctx.api.store.add(C.text, { key: `x${n}`, n, text: t }, { key: `x${n}` });
}

const MEM = { entries: 300, bytes: 12 * 1024 * 1024 };
/** La miniature gardée { bytes, type, etag } ou null. Mémoire courte devant le stockage (une image de liste est demandée souvent). */
export async function getThumb(ctx, n) {
  const mem = st(ctx).thumbs;
  const hit = mem.get(n);
  if (hit && hit.until > Date.now()) return hit.value;
  const row = await rowByKey(ctx, C.thumbs, `t${n}`);
  let value = null;
  if (row && typeof row.data?.b64 === "string" && ["image/jpeg", "image/png", "image/webp"].includes(row.data.type)) {
    const bytes = Buffer.from(row.data.b64, "base64");
    if (bytes.length > 0 && bytes.length <= LIMITS.thumbBytes) value = { bytes, type: row.data.type, etag: `"${bytes.length.toString(36)}-${row.data.at ?? 0}"` };
  }
  mem.set(n, { value, until: Date.now() + (value ? 10 * 60_000 : 30_000) });
  let total = 0;
  for (const [k, e] of [...mem]) { total += e.value?.bytes.length ?? 0; if (mem.size > MEM.entries || total > MEM.bytes) { mem.delete(k); total -= e.value?.bytes.length ?? 0; } }
  return value;
}
export async function putThumb(ctx, n, bytes, type) {
  if (!bytes?.length || bytes.length > LIMITS.thumbBytes) return false;
  const data = { key: `t${n}`, n, type, b64: Buffer.from(bytes).toString("base64"), at: Date.now() };
  const row = await rowByKey(ctx, C.thumbs, `t${n}`);
  if (row) await ctx.api.store.update(row.id, data, { key: `t${n}` });
  else await ctx.api.store.add(C.thumbs, data, { key: `t${n}` });
  st(ctx).thumbs.delete(n);
  return true;
}
async function dropThumb(ctx, n) {
  const row = await rowByKey(ctx, C.thumbs, `t${n}`);
  if (row) await ctx.api.store.remove(row.id);
  st(ctx).thumbs.delete(n);
}

// ── Écrire les vidéos ──────────────────────────────────────────────────────────────────────────────────────────────

const itemDoc = (x) => ({ n: x.n, provider: x.provider, ext: x.ext, title: x.title, desc: x.desc, cat: x.cat, status: x.status, date: x.date, dur: x.dur, free: x.free, cover: x.cover, album: x.album, noEmbed: x.noEmbed, thumb: x.thumb });

async function writeMeta(ctx, snap, patch) {
  const next = { nextV: snap.meta.nextV, nextC: snap.meta.nextC, nextS: snap.meta.nextS, ...patch };
  if (snap.meta.rowId) await ctx.api.store.update(snap.meta.rowId, next);
  else await ctx.api.store.add(C.meta, next);
}

/**
 * Ajoute des vidéos d'un coup. `list` : [{ provider, ext, title?, desc?, cat?, status?, date?, dur?, free?, noEmbed? }].
 * Renvoie { ok, added: [vidéo…], duplicates: [vidéo existante…], full: nombre refusé faute de place }.
 */
export function addVideos(ctx, list) {
  return locked(ctx, async () => {
    const snap = await snapshot(ctx, { fresh: true });
    const added = [], duplicates = [];
    let full = 0, n = snap.meta.nextV;
    const seen = new Set();
    for (const f of list) {
      const key = `${f.provider}:${f.ext}`;
      if (snap.byExt.has(key) || seen.has(key)) { duplicates.push(snap.byExt.get(key) ?? { n: 0, ext: f.ext, provider: f.provider, title: f.title ?? "" }); continue; }
      if (snap.items.length + added.length >= LIMITS.videos) { full++; continue; }
      const item = {
        n: n++, provider: f.provider, ext: f.ext, title: clean(f.title, LIMITS.title), desc: clean(f.desc, LIMITS.desc, true),
        cat: snap.cats.some((c) => c.k === f.cat) ? f.cat : 0, status: P.VIDEO_STATUS(f.status), date: parseDate(f.date) ?? today(),
        dur: int(f.dur, 0, 0, 48 * 3600), free: f.free === true, cover: sitePath(f.cover), album: clean(f.album, 80), noEmbed: f.noEmbed === true, thumb: false,
      };
      if (item.status === "published" && !item.title) item.status = "draft";
      seen.add(key);
      item.rowId = await ctx.api.store.add(C.items, itemDoc(item), { key: `v${item.n}` });
      added.push(item);
    }
    if (added.length) await writeMeta(ctx, snap, { nextV: n });
    invalidate(ctx);
    return { ok: true, added, duplicates, full };
  });
}

/** Modifie une vidéo : `patch` ne contient que des valeurs DÉJÀ validées par l'appelant. Renvoie la vidéo, ou null si elle n'existe plus. */
export function updateVideo(ctx, n, patch, { text } = {}) {
  return locked(ctx, async () => {
    const snap = await snapshot(ctx, { fresh: true });
    const cur = snap.byN.get(n);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    if (next.status === "published" && !next.title) next.status = "draft";
    await ctx.api.store.update(cur.rowId, itemDoc(next), { key: `v${n}` });
    if (text !== undefined) await setText(ctx, n, text);
    invalidate(ctx);
    return next;
  });
}

export function removeVideo(ctx, n) {
  return locked(ctx, async () => {
    const snap = await snapshot(ctx, { fresh: true });
    const cur = snap.byN.get(n);
    if (!cur) return false;
    await ctx.api.store.remove(cur.rowId);
    await setText(ctx, n, "");
    await dropThumb(ctx, n);
    for (const s of snap.series) if (s.items.includes(n)) await ctx.api.store.update(s.rowId, seriesDoc({ ...s, items: s.items.filter((x) => x !== n) }));
    invalidate(ctx);
    return true;
  });
}

// ── Catégories ─────────────────────────────────────────────────────────────────────────────────────────────────────

const uniqueSlug = (taken, base, fallback) => {
  const root = base || fallback;
  let s = root, i = 2;
  while (taken.has(s)) s = `${root}-${i++}`;
  return s;
};

async function addCategoryNow(ctx, names) {
  const snap = await snapshot(ctx, { fresh: true });
  const clean1 = normNames(names);
  if (!Object.keys(clean1).length) return { ok: false, code: "empty" };
  if (snap.cats.length >= LIMITS.categories) return { ok: false, code: "full" };
  const k = snap.meta.nextC;
  const slug = uniqueSlug(new Set(snap.cats.map((c) => c.slug)), slugify(P.pickName(clean1, ctx.defaultLocale, ctx.defaultLocale), 30), `c${k}`);
  const pos = snap.cats.reduce((m, c) => Math.max(m, c.pos), 0) + 1;
  await ctx.api.store.add(C.cats, { k, slug, names: clean1, pos });
  await writeMeta(ctx, snap, { nextC: k + 1 });
  invalidate(ctx);
  return { ok: true, k, slug };
}
export const addCategory = (ctx, names) => locked(ctx, () => addCategoryNow(ctx, names));
export function renameCategory(ctx, k, names) {
  return locked(ctx, async () => {
    const snap = await snapshot(ctx, { fresh: true });
    const cur = snap.cats.find((c) => c.k === k);
    const clean1 = normNames(names);
    if (!cur || !Object.keys(clean1).length) return false;
    await ctx.api.store.update(cur.rowId, { k, slug: cur.slug, names: clean1, pos: cur.pos });
    invalidate(ctx);
    return true;
  });
}
async function renumber(ctx, list, docOf) {
  for (let i = 0; i < list.length; i++) if (list[i].pos !== i + 1) await ctx.api.store.update(list[i].rowId, docOf({ ...list[i], pos: i + 1 }));
}
const catDoc = (c) => ({ k: c.k, slug: c.slug, names: c.names, pos: c.pos });
export function moveCategory(ctx, k, dir) {
  return locked(ctx, async () => {
    const snap = await snapshot(ctx, { fresh: true });
    const i = snap.cats.findIndex((c) => c.k === k), j = i + (dir === "up" ? -1 : 1);
    if (i < 0 || j < 0 || j >= snap.cats.length) return false;
    const list = [...snap.cats];
    [list[i], list[j]] = [list[j], list[i]];
    await renumber(ctx, list, catDoc);
    invalidate(ctx);
    return true;
  });
}
/** Retire une catégorie ; ses vidéos restent, sans catégorie. */
export function removeCategory(ctx, k) {
  return locked(ctx, async () => {
    const snap = await snapshot(ctx, { fresh: true });
    const cur = snap.cats.find((c) => c.k === k);
    if (!cur) return false;
    for (const x of snap.items) if (x.cat === k) await ctx.api.store.update(x.rowId, itemDoc({ ...x, cat: 0 }), { key: `v${x.n}` });
    await ctx.api.store.remove(cur.rowId);
    invalidate(ctx);
    return true;
  });
}

// ── Séries ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const seriesDoc = (s) => ({ p: s.p, slug: s.slug, names: s.names, descs: s.descs, status: s.status, items: s.items, pos: s.pos });

export function addSeries(ctx, names) {
  return locked(ctx, async () => {
    const snap = await snapshot(ctx, { fresh: true });
    const clean1 = normNames(names);
    if (!Object.keys(clean1).length) return { ok: false, code: "empty" };
    if (snap.series.length >= LIMITS.series) return { ok: false, code: "full" };
    const p = snap.meta.nextS;
    const pos = snap.series.reduce((m, s) => Math.max(m, s.pos), 0) + 1;
    await ctx.api.store.add(C.series, seriesDoc({ p, slug: slugify(P.pickName(clean1, ctx.defaultLocale, ctx.defaultLocale), 30), names: clean1, descs: {}, status: "draft", items: [], pos }));
    await writeMeta(ctx, snap, { nextS: p + 1 });
    invalidate(ctx);
    return { ok: true, p };
  });
}
/** `patch` : { names?, descs?, status? } déjà validés. */
export function updateSeries(ctx, p, patch) {
  return locked(ctx, async () => {
    const snap = await snapshot(ctx, { fresh: true });
    const cur = snap.series.find((s) => s.p === p);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    if (patch.names) { next.names = normNames(patch.names); if (!Object.keys(next.names).length) return null; }
    if (patch.descs) next.descs = normNames(patch.descs, LIMITS.seriesDesc);
    await ctx.api.store.update(cur.rowId, seriesDoc(next));
    invalidate(ctx);
    return next;
  });
}
export function moveSeries(ctx, p, dir) {
  return locked(ctx, async () => {
    const snap = await snapshot(ctx, { fresh: true });
    const i = snap.series.findIndex((s) => s.p === p), j = i + (dir === "up" ? -1 : 1);
    if (i < 0 || j < 0 || j >= snap.series.length) return false;
    const list = [...snap.series];
    [list[i], list[j]] = [list[j], list[i]];
    await renumber(ctx, list, seriesDoc);
    invalidate(ctx);
    return true;
  });
}
export function removeSeries(ctx, p) {
  return locked(ctx, async () => {
    const snap = await snapshot(ctx, { fresh: true });
    const cur = snap.series.find((s) => s.p === p);
    if (!cur) return false;
    await ctx.api.store.remove(cur.rowId);
    invalidate(ctx);
    return true;
  });
}
/** Ajoute (add), retire (remove) ou déplace (up / down) une vidéo dans une série. { ok, code? } */
export function editSeriesItems(ctx, p, n, op) {
  return locked(ctx, async () => {
    const snap = await snapshot(ctx, { fresh: true });
    const cur = snap.series.find((s) => s.p === p);
    if (!cur) return { ok: false, code: "gone" };
    const items = [...cur.items];
    const i = items.indexOf(n);
    if (op === "add") {
      if (!snap.byN.has(n)) return { ok: false, code: "gone" };
      if (i >= 0) return { ok: false, code: "duplicate" };
      if (items.length >= LIMITS.inSeries) return { ok: false, code: "full" };
      items.push(n);
    } else if (op === "remove") {
      if (i < 0) return { ok: false, code: "gone" };
      items.splice(i, 1);
    } else {
      const j = i + (op === "up" ? -1 : 1);
      if (i < 0 || j < 0 || j >= items.length) return { ok: false, code: "edge" };
      [items[i], items[j]] = [items[j], items[i]];
    }
    await ctx.api.store.update(cur.rowId, seriesDoc({ ...cur, items }));
    invalidate(ctx);
    return { ok: true };
  });
}

// ── Gabarit de départ ──────────────────────────────────────────────────────────────────────────────────────────────

/** Crée les catégories du gabarit (seulement s'il n'y en a aucune : jamais de doublon, même cliqué deux fois). */
export function applyTemplate(ctx, id) {
  const wanted = Object.hasOwn(P.TEMPLATES, id) ? P.TEMPLATES[id] : null;
  if (!wanted) return Promise.resolve({ ok: false, code: "unknown" });
  return locked(ctx, async () => {
    const snap = await snapshot(ctx, { fresh: true });
    if (snap.cats.length) return { ok: false, code: "already" };
    let made = 0;
    for (const key of wanted) {
      const names = {};
      for (const l of P.localesOf(ctx)) names[l] = P.TEMPLATE_NAMES[key][l] ?? P.TEMPLATE_NAMES[key].en;
      const r = await addCategoryNow(ctx, names);
      if (r.ok) made++;
    }
    return { ok: true, made };
  });
}

// ── L'aperçu de l'ajout en lot (une seule ligne, remplacée à chaque fois) ──────────────────────────────────────────

export async function saveBulk(ctx, rows, meta = {}) {
  const data = { key: "bulk", at: Date.now(), cat: Number.isInteger(meta.cat) ? meta.cat : 0, status: P.VIDEO_STATUS(meta.status), rows: rows.slice(0, LIMITS.bulk) };
  const row = await rowByKey(ctx, C.bulk, "bulk");
  if (row) await ctx.api.store.update(row.id, data, { key: "bulk" });
  else await ctx.api.store.add(C.bulk, data, { key: "bulk" });
}
/** L'aperçu en attente { rows, cat, status } ou null (absent, ou périmé au bout d'une heure). */
export async function readBulk(ctx) {
  const row = await rowByKey(ctx, C.bulk, "bulk");
  if (!row || !Array.isArray(row.data?.rows) || Date.now() - Number(row.data.at) > timing.bulkMs) return null;
  const rows = row.data.rows.slice(0, LIMITS.bulk).map((r) => ({ text: clean(r?.text, 120), ok: r?.ok === true, provider: typeof r?.provider === "string" ? r.provider : "", ext: typeof r?.ext === "string" ? r.ext : "", error: clean(r?.error, 12) }));
  return { rows, cat: Number.isInteger(row.data.cat) ? row.data.cat : 0, status: P.VIDEO_STATUS(row.data.status) };
}
export async function clearBulk(ctx) {
  const row = await rowByKey(ctx, C.bulk, "bulk");
  if (row) await ctx.api.store.remove(row.id);
}

// ── Langue, mots affichés ──────────────────────────────────────────────────────────────────────────────────────────

/** Les mots que voit le public (réglables ; sinon les mots neutres des textes du module). */
export function vocab(ctx) {
  const set = (k) => clean(ctx.setting(k), 40);
  return {
    plural: set("vocabPlural") || ctx.t("vocPlural"),
    one: set("vocabOne") || ctx.t("vocOne"),
    series: set("vocabSeries") || ctx.t("vocSeries"),
    seriesOne: set("vocabSeriesOne") || ctx.t("vocSeriesOne"),
    free: set("vocabFree") || ctx.t("vocFree"),
  };
}

export const settings = (ctx) => {
  const truthy = (k, d) => { const x = ctx.setting(k); return x === undefined || x === null || x === "" ? d : !(x === false || x === "false" || x === 0 || x === "0"); };
  return {
    perPage: int(ctx.setting("perPage"), LIMITS.perPage, 6, LIMITS.perPageMax),
    thumbs: ctx.setting("thumbs") === "plain" ? "plain" : "copy",
    share: truthy("share", true),
    structured: truthy("structured", true),
    intro: clean(ctx.setting("intro"), 2000, true),
  };
};
