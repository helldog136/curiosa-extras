// Galeries photos : les données et leurs garde-fous (stockage de l'instance, réglages bornés, limiteurs en mémoire).
//
// Cinq collections, toutes propres à l'instance :
//   gallery_albums   { title, slug, desc, date, status: "published" | "draft", mode: "hosted" | "external", link, cover, pos, pid, bytes, total, shown, coverThumb, preview }
//                    (une ligne légère par album : la liste des albums ne lit jamais les photos)
//   gallery_photos   { album, items: [ { id, caption, alt, hidden, full, thumb, url, turl, w, h, bytes, tbytes, name, at } ] }   (une ligne par album : l'ordre des photos = l'ordre du tableau)
//   gallery_blobs    { album, photo, kind: "f" | "t", mime, b64, live }   (les images envoyées, une ligne par image ; jamais lues en même temps que les albums)
//   gallery_requests { album, photo, label, message, contact?, at, status: "new" | "done" | "dismissed", handledAt? }
//   gallery_meta     { template }   (le gabarit choisi)

const { DEFAULTS, HARD, clean, isId, isoDay, num, parseHosts, safeName, httpsUrl, safeSlug } = await import(new URL(`./text.mjs${new URL(import.meta.url).search}`, import.meta.url).href);

export const C = { albums: "gallery_albums", photos: "gallery_photos", blobs: "gallery_blobs", requests: "gallery_requests", meta: "gallery_meta" };
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

const time = (value, fallback) => { const t = Date.parse(value ?? ""); return Number.isFinite(t) ? t : fallback; };

// ── Réglages ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const flag = (ctx, key, fallback) => { const v = ctx.setting(key); return v === undefined || v === null || v === "" ? fallback : v === true || v === "true" || v === 1 || v === "1"; };

/** Les bornes en vigueur : le réglage, rangé entre un plancher et le plafond DUR du module (un réglage fou ne les dépasse jamais). */
export function limitsOf(ctx) {
  return {
    photoBytes: num(ctx.setting("maxPhotoKB"), DEFAULTS.photoKB, 50, HARD.photoBytes / 1000) * 1000,
    side: num(ctx.setting("maxSide"), DEFAULTS.side, 600, HARD.side),
    photos: num(ctx.setting("maxPhotos"), DEFAULTS.photos, 1, HARD.photos),
    albums: num(ctx.setting("maxAlbums"), DEFAULTS.albums, 1, HARD.albums),
    totalBytes: num(ctx.setting("maxTotalMB"), DEFAULTS.totalMB, 10, HARD.totalMB) * 1_000_000,
    thumbBytes: HARD.thumbBytes,
    thumbSide: 480,
  };
}

export const hostsOf = (ctx) => parseHosts(ctx.setting("allowedHosts"));
export const retentionDays = (ctx) => num(ctx.setting("retentionDays"), DEFAULTS.retentionDays, 7, 90);

// ── Gabarits (points de départ) ──────────────────────────────────────────────────────────────────────────────────────

/** Ce que chaque gabarit change : seulement des valeurs PAR DÉFAUT (un réglage rempli par la personne l'emporte toujours). */
export const TEMPLATES = {
  retro: { sort: "date", dates: true },
  portfolio: { sort: "manual", dates: false },
  empty: { sort: "date", dates: true },
};

export async function loadMeta(ctx) {
  const rows = await ctx.api.store.list(C.meta, { limit: 5 });
  const data = rows[0]?.data ?? {};
  return { id: rows[0]?.id ?? "", template: typeof data.template === "string" && TEMPLATES[data.template] ? data.template : "" };
}

export async function saveMeta(ctx, template) {
  const meta = await loadMeta(ctx);
  if (meta.id) await ctx.api.store.update(meta.id, { template });
  else await ctx.api.store.add(C.meta, { template });
  invalidate(ctx);
}

/** Ordre des albums : le réglage s'il est rempli, sinon celui du gabarit choisi, sinon « du plus récent au plus ancien ». */
export function sortMode(ctx, meta) {
  const v = ctx.setting("sort");
  if (v === "date" || v === "manual") return v;
  return TEMPLATES[meta?.template]?.sort ?? "date";
}

/** Montrer la date des albums : le réglage s'il est rempli, sinon le gabarit, sinon oui. */
export function showDates(ctx, meta) {
  const v = ctx.setting("dates");
  if (v === "yes") return true;
  if (v === "no") return false;
  return TEMPLATES[meta?.template]?.dates ?? true;
}

// ── Lecture (chaque ligne est remise en forme : une sauvegarde ancienne ou abîmée ne fait jamais planter une page) ─────

function album(r) {
  const d = r.data ?? {};
  const at = new Date(r.createdAt).getTime() || 0;
  const thumb = d.coverThumb && typeof d.coverThumb === "object" ? d.coverThumb : {};
  return {
    id: r.id,
    createdAt: at,
    title: clean(d.title, HARD.title),
    slug: safeSlug(d.slug) || safeSlug(`album-${r.id}`),
    desc: clean(d.desc, HARD.description, true),
    date: isoDay(d.date),
    status: d.status === "published" ? "published" : "draft",
    mode: d.mode === "external" ? "external" : "hosted",
    link: httpsUrl(d.link) ?? "",
    cover: isId(d.cover) ? d.cover : "",
    pos: Number(d.pos) || 0,
    pid: isId(d.pid) ? d.pid : "",
    bytes: Math.max(0, Math.trunc(Number(d.bytes)) || 0),
    total: Math.max(0, Math.trunc(Number(d.total)) || 0),
    shown: Math.max(0, Math.trunc(Number(d.shown)) || 0),
    coverThumb: { blob: isId(thumb.blob) ? thumb.blob : "", url: httpsUrl(thumb.url) ?? "", alt: clean(thumb.alt, HARD.alt) },
    preview: /^[a-z0-9]{8,32}$/.test(String(d.preview ?? "")) ? d.preview : "",
  };
}

function photo(p) {
  if (!p || typeof p !== "object") return null;
  const id = String(p.id ?? "");
  if (!/^[a-z0-9]{4,24}$/.test(id)) return null;
  return {
    id,
    caption: clean(p.caption, HARD.caption),
    alt: clean(p.alt, HARD.alt),
    hidden: p.hidden === true,
    full: isId(p.full) ? p.full : "",
    thumb: isId(p.thumb) ? p.thumb : "",
    url: httpsUrl(p.url) ?? "",
    turl: httpsUrl(p.turl) ?? "",
    w: num(p.w, 0, 0, HARD.side),
    h: num(p.h, 0, 0, HARD.side),
    bytes: num(p.bytes, 0, 0, HARD.photoBytes),
    tbytes: num(p.tbytes, 0, 0, HARD.thumbBytes),
    name: safeName(p.name),
    at: time(p.at, 0),
  };
}

/** Une photo est-elle montrable ? (elle a une image, chez nous ou à une adresse autorisée) */
export const hasImage = (p) => !!(p.full || p.url);

const albumCache = new Map();
export function invalidate(ctx) { albumCache.delete(ctx.instance.id); }

/** Tous les albums de l'instance (500 au plus), dans l'ordre choisi. Gardés 20 s en mémoire ; toute écriture du module vide la mémoire. */
export async function loadAlbums(ctx, sort = "date") {
  const store = ctx.api.store;
  const count = await store.count(C.albums);
  const hit = albumCache.get(ctx.instance.id);
  let list;
  if (hit && hit.count === count && Date.now() - hit.at < 20_000) list = hit.list;
  else {
    const rows = await store.list(C.albums, { limit: HARD.albums + 50 });
    list = rows.map(album);
    albumCache.set(ctx.instance.id, { at: Date.now(), count, list });
    if (albumCache.size > 200) albumCache.delete(albumCache.keys().next().value);
  }
  return sortAlbums(list, sort);
}

/** Comme `loadAlbums`, mais relu dans le stockage (pour les écritures, qui ne se fient jamais à la mémoire). */
export async function freshAlbums(ctx, sort = "date") {
  invalidate(ctx);
  return loadAlbums(ctx, sort);
}

export function sortAlbums(list, sort) {
  const copy = [...list];
  if (sort === "manual") return copy.sort((a, b) => a.pos - b.pos || b.createdAt - a.createdAt);
  return copy.sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.createdAt - a.createdAt);
}

/** Une ligne du stockage, lue pour une collection précise (un identifiant d'une autre collection de l'instance est refusé). */
export async function getRow(ctx, id, expect) {
  if (!isId(id)) return null;
  const row = await ctx.api.store.get(id);
  if (!row || typeof row.data !== "object" || row.data === null) return null;
  const d = row.data;
  if (expect === "album" && !("slug" in d && "pid" in d)) return null;
  if (expect === "photos" && !("items" in d && "album" in d)) return null;
  if (expect === "blob" && !("b64" in d)) return null;
  if (expect === "request" && !("message" in d && "status" in d)) return null;
  return row;
}

export async function getAlbum(ctx, id) {
  const row = await getRow(ctx, id, "album");
  return row ? album(row) : null;
}

/** Les photos d'un album, dans l'ordre. */
export async function loadPhotos(ctx, a) {
  if (!a?.pid) return [];
  const row = await getRow(ctx, a.pid, "photos");
  if (!row) return [];
  return (Array.isArray(row.data.items) ? row.data.items : []).slice(0, HARD.photos + 10).map(photo).filter(Boolean);
}

export async function loadRequests(ctx) {
  const rows = await ctx.api.store.list(C.requests, { limit: HARD.requests + 50 });
  return rows
    .map((r) => {
      const d = r.data ?? {};
      const at = time(d.at, new Date(r.createdAt).getTime() || 0);
      return {
        id: r.id,
        at,
        album: isId(d.album) ? d.album : "",
        photo: /^[a-z0-9]{4,24}$/.test(String(d.photo ?? "")) ? d.photo : "",
        label: clean(d.label, HARD.label),
        message: clean(d.message, HARD.message, true),
        contact: clean(d.contact, HARD.contact),
        status: d.status === "done" ? "done" : d.status === "dismissed" ? "dismissed" : "new",
        handledAt: time(d.handledAt, 0),
      };
    })
    .sort((a, b) => b.at - a.at);
}

/** La photo désignée par un formulaire public : un album PUBLIÉ et une photo VISIBLE, sinon null (jamais de confiance dans les identifiants reçus). */
export async function photoRefs(ctx, albumId, photoId) {
  if (!isId(String(albumId ?? "")) || !/^[a-z0-9]{4,24}$/.test(String(photoId ?? ""))) return null;
  const a = await getAlbum(ctx, String(albumId));
  if (!a || a.status !== "published" || a.mode !== "hosted") return null;
  const items = (await loadPhotos(ctx, a)).filter((p) => !p.hidden && hasImage(p));
  const at = items.findIndex((p) => p.id === photoId);
  if (at < 0) return null;
  return { album: a.id, photo: items[at].id, label: `${a.title} #${at + 1}`.slice(0, HARD.label) };
}

/** Espace utilisé par toutes les photos envoyées (octets) et nombre d'albums. */
export function usage(albums) {
  return { bytes: albums.reduce((t, a) => t + a.bytes, 0), albums: albums.length, photos: albums.reduce((t, a) => t + a.total, 0) };
}

// ── Écriture ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Une seule écriture à la fois par instance (le stockage n'a pas d'incrément atomique). */
const chains = new Map();
export function locked(ctx, fn) {
  const key = ctx.instance.key;
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn).finally(() => invalidate(ctx));
  const tail = run.catch(() => {});
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}

/** Remet à jour la ligne légère d'un album d'après ses photos (compteurs, octets, vignette de couverture). */
export async function refreshAlbum(ctx, a, items) {
  const visible = items.filter((p) => !p.hidden && hasImage(p));
  const chosen = items.find((p) => p.id === a.cover && !p.hidden && hasImage(p)) ?? visible[0] ?? null;
  const coverThumb = chosen ? { blob: chosen.thumb || chosen.full || "", url: chosen.thumb || chosen.full ? "" : chosen.turl || chosen.url, alt: chosen.alt || chosen.caption } : { blob: "", url: "", alt: "" };
  const bytes = items.reduce((t, p) => t + p.bytes + p.tbytes, 0);
  invalidate(ctx);
  const row = await getRow(ctx, a.id, "album");
  if (!row) return null;
  const next = { ...row.data, cover: chosen ? chosen.id : "", bytes, total: items.length, shown: visible.length, coverThumb };
  await ctx.api.store.update(a.id, next);
  return { ...a, cover: next.cover, bytes, total: items.length, shown: visible.length, coverThumb };
}

/** Écrit la liste des photos d'un album (la ligne existe toujours : elle est créée avec l'album). */
export async function writePhotos(ctx, a, items) {
  const row = await getRow(ctx, a.pid, "photos");
  const data = { album: a.id, items: items.map(({ id, caption, alt, hidden, full, thumb, url, turl, w, h, bytes, tbytes, name, at }) => ({ id, caption, alt, hidden, full, thumb, url, turl, w, h, bytes, tbytes, name, at: at ? new Date(at).toISOString() : "" })) };
  if (row) await ctx.api.store.update(a.pid, data);
  else throw new Error("photos row missing");
}

/** Un identifiant de photo libre dans l'album. */
export function newPhotoId(items, make) {
  const taken = new Set(items.map((p) => p.id));
  for (let i = 0; i < 20; i++) { const id = make(); if (!taken.has(id)) return id; }
  return make() + make();
}

/** Identifiant d'adresse libre pour un nouvel album. */
export function uniqueSlug(albums, base, ownId = "") {
  const taken = new Set(albums.filter((a) => a.id !== ownId).map((a) => a.slug));
  let slug = base;
  for (let n = 2; taken.has(slug) && n < 1000; n++) slug = `${base.slice(0, 55)}-${n}`;
  return slug;
}

/** Remet les positions d'une liste en 1..n (n'écrit que ce qui change). */
export async function renumber(ctx, rows) {
  invalidate(ctx);
  let i = 0;
  for (const r of rows) {
    i++;
    if (r.pos !== i) {
      const row = await getRow(ctx, r.id, "album");
      if (row) await ctx.api.store.update(r.id, { ...row.data, pos: i });
    }
  }
}

// ── Limiteurs en mémoire : un garde-fou, pas un pare-feu (remis à zéro au redémarrage, rien n'est écrit sur le disque) ─────

/** Qui est le visiteur, sans garder son adresse : l'empreinte salée que le cœur calcule sur l'adresse de confiance. */
export function visitorId(request, ctx, scope) {
  try { return String(ctx.api?.visitor?.fingerprint?.(request, scope) ?? "local"); } catch { return "local"; }
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

/** Dernier e-mail envoyé à l'équipe (au plus un toutes les 6 heures par instance). */
const mailed = new Map();
export function mailDue(ctx, now = Date.now()) {
  const last = mailed.get(ctx.instance.key) ?? 0;
  if (now - last < 6 * HOUR) return false;
  mailed.set(ctx.instance.key, now);
  return true;
}

/** Quand l'instance disparaît, sa mémoire aussi. */
export function forget(ctx) {
  const prefix = `${ctx.instance.key}|`;
  for (const k of [...hits.keys()]) if (k.startsWith(prefix)) hits.delete(k);
  mailed.delete(ctx.instance.key);
  chains.delete(ctx.instance.key);
  albumCache.delete(ctx.instance.id);
}

/** Supprime les demandes trop anciennes (au plus 50 à la fois, au fil de l'eau : aucun minuteur de fond). Les demandes traitées partent après 30 jours, les autres après la durée réglée. */
export async function purgeRequests(ctx, now = Date.now()) {
  const keep = retentionDays(ctx) * DAY;
  let removed = 0;
  for (const r of await loadRequests(ctx)) {
    if (removed >= 50) break;
    const old = r.status === "new" ? now - r.at > keep : now - (r.handledAt || r.at) > 30 * DAY;
    if (old) { await ctx.api.store.remove(r.id); removed++; }
  }
  return removed;
}
