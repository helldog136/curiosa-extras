// Galeries photos : les écritures partagées par l'administration, l'envoi de photos et l'assistant IA.
// Toutes supposent d'être appelées DANS `locked(ctx, …)` (une écriture à la fois par instance).
// Elles ne lèvent pas pour un refus normal : { ok: false, error: "code" } (le code devient une phrase dans l'administration).
// Règle de fond : l'assistant IA n'a accès qu'à `createAlbum` (toujours en brouillon) et `addExternalPhoto` (toujours masquée) ;
// seul un humain rend un album ou une photo visible.

const { C, getRow, getAlbum, freshAlbums, invalidate, loadPhotos, writePhotos, refreshAlbum, newPhotoId, uniqueSlug, renumber, limitsOf, hostsOf, usage, hasImage } = await import(new URL(`./data.mjs${new URL(import.meta.url).search}`, import.meta.url).href);
const { HARD, clean, hostAllowed, httpsUrl, isoDay, num, randomId, safeName, slugify, uploadPath } = await import(new URL(`./text.mjs${new URL(import.meta.url).search}`, import.meta.url).href);

const ok = (extra = {}) => ({ ok: true, ...extra });
const no = (error, extra = {}) => ({ ok: false, error, ...extra });

// ── Fichiers envoyés (ctx.api.files, cœur 0.2.13) : garder à l'envoi, supprimer avec la photo ─────────────────────────

const CLAIM_REASONS = new Set(["expired", "taken", "not-uploader", "quota", "unknown", "invalid", "missing", "no-person", "no-permission"]);
const FILES_BATCH = 8; // suppressions simultanées au plus : un album a au plus quelques centaines de fichiers, jamais de minuteur de fond

/** `ctx.api.files` ou null (cœur plus ancien, permission refusée) : l'accès lui-même peut lever. */
function filesApi(ctx) {
  try { return ctx.api.files && typeof ctx.api.files.claim === "function" ? ctx.api.files : null; } catch { return null; }
}

/** Revendique un fichier ; ne lève jamais : { ok: true, already } ou { ok: false, reason }. */
async function claimFile(ctx, url) {
  const files = filesApi(ctx);
  if (!files) return { ok: false, reason: "no-permission" };
  try {
    const r = await files.claim(url);
    if (r?.ok) return { ok: true, already: r.already === true };
    return { ok: false, reason: CLAIM_REASONS.has(r?.reason) ? r.reason : "unknown" };
  } catch {
    return { ok: false, reason: "unknown" };
  }
}

/**
 * Supprime les fichiers `/uploads/…` donnés, par lots bornés. Un fichier que ce module n'a pas revendiqué (photo envoyée avant la 0.2.13) ne peut pas être supprimé :
 * il est compté à part (`legacy`), ce n'est pas une erreur. Ne lève jamais : { removed, legacy, failed }.
 */
export async function dropFiles(ctx, urls) {
  const list = [...new Set(urls.map((u) => uploadPath(u)).filter(Boolean))];
  const out = { removed: 0, legacy: 0, failed: 0 };
  const files = filesApi(ctx);
  if (!files) { out.legacy = list.length; return out; }
  for (let i = 0; i < list.length; i += FILES_BATCH) {
    await Promise.all(list.slice(i, i + FILES_BATCH).map(async (url) => {
      try {
        if (!(await files.owns(url))) { out.legacy += 1; return; }
        const r = await files.remove(url);
        if (r?.ok) out.removed += 1;
        else out.failed += 1;
      } catch {
        out.failed += 1;
      }
    }));
  }
  return out;
}

// ── Albums ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Les champs d'un album, nettoyés. */
export function albumFields(input) {
  const mode = input?.mode === "external" ? "external" : "hosted";
  return {
    title: clean(input?.title, HARD.title),
    desc: clean(input?.desc, HARD.description, true),
    date: isoDay(input?.date),
    mode,
    link: httpsUrl(input?.link) ?? "",
    status: input?.status === "published" ? "published" : "draft",
  };
}

export async function createAlbum(ctx, input, { by = "admin" } = {}) {
  const f = albumFields(input);
  if (!f.title) return no("title");
  if (f.mode === "external" && !f.link) return no("link_needed");
  const albums = await freshAlbums(ctx);
  if (albums.length >= limitsOf(ctx).albums) return no("full_albums", { max: limitsOf(ctx).albums });
  const pid = await ctx.api.store.add(C.photos, { album: "", items: [] });
  const id = await ctx.api.store.add(C.albums, {
    ...f,
    status: by === "assistant" ? "draft" : f.status,
    slug: uniqueSlug(albums, slugify(f.title)),
    cover: "",
    pos: albums.reduce((m, a) => Math.max(m, a.pos), 0) + 1,
    pid,
    bytes: 0,
    total: 0,
    shown: 0,
    coverThumb: { src: "", url: "", alt: "" },
    preview: randomId(16),
    by,
  });
  await ctx.api.store.update(pid, { album: id, items: [] });
  invalidate(ctx);
  return ok({ id });
}

export async function updateAlbum(ctx, id, input) {
  const row = await getRow(ctx, id, "album");
  if (!row) return no("not_found");
  const f = albumFields(input);
  if (!f.title) return no("title");
  if (f.mode === "external" && !f.link) return no("link_needed");
  await ctx.api.store.update(id, { ...row.data, title: f.title, desc: f.desc, date: f.date, mode: f.mode, link: f.link });
  invalidate(ctx);
  return ok();
}

export async function setStatus(ctx, id, status) {
  const row = await getRow(ctx, id, "album");
  if (!row) return no("not_found");
  await ctx.api.store.update(id, { ...row.data, status: status === "published" ? "published" : "draft" });
  invalidate(ctx);
  return ok();
}

/**
 * Supprime un album, la liste de ses photos, PUIS les fichiers de toutes ses photos (originaux, miniatures) et de sa couverture, par lots bornés.
 * Les fichiers d'anciennes photos (avant la 0.2.13) ne peuvent pas être supprimés : `files.legacy` les compte. Les demandes de retrait gardent leur libellé.
 */
export async function deleteAlbum(ctx, id) {
  const a = await getAlbum(ctx, id);
  if (!a) return no("not_found");
  const items = a.pid ? await loadPhotos(ctx, a) : [];
  const urls = [a.coverThumb?.src, ...items.flatMap((p) => [p.full, p.thumb])].filter(Boolean);
  if (a.pid) await ctx.api.store.remove(a.pid);
  await ctx.api.store.remove(id);
  await renumber(ctx, (await freshAlbums(ctx, "manual")).filter((x) => x.id !== id));
  return ok({ files: await dropFiles(ctx, urls) });
}

export async function moveAlbum(ctx, id, step) {
  const albums = await freshAlbums(ctx, "manual");
  const at = albums.findIndex((a) => a.id === id);
  if (at < 0) return no("not_found");
  const to = at + step;
  if (to < 0 || to >= albums.length) return ok({ edge: true });
  [albums[at], albums[to]] = [albums[to], albums[at]];
  await renumber(ctx, albums); // l'ordre du tableau devient les positions 1..n
  return ok();
}

// ── Photos ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const textOf = (input) => ({ caption: clean(input?.caption, HARD.caption), alt: clean(input?.alt, HARD.alt) });

/** Ajoute une photo déjà envoyée par le mécanisme d'envoi du cœur : le module ne garde que les adresses `/uploads/…` (la grande et sa miniature) et revendique les deux fichiers (`files.claim`). */
export async function addUploadedPhoto(ctx, albumId, { full, thumb, w = 0, h = 0, bytes = 0, tbytes = 0, name = "", caption = "", alt = "", hidden = false }) {
  const a = await getAlbum(ctx, albumId);
  if (!a) return no("not_found");
  const big = uploadPath(full);
  const small = uploadPath(thumb);
  if (!big || !small) return no("bad_upload");
  const limits = limitsOf(ctx);
  const items = await loadPhotos(ctx, a);
  if (items.length >= limits.photos) return no("full_photos", { max: limits.photos });
  if (usage(await freshAlbums(ctx)).photos >= limits.totalPhotos) return no("full_total", { max: limits.totalPhotos });
  if (items.some((p) => p.full === big)) return no("duplicate");
  // Garder les deux fichiers tout de suite (le cœur n'attend que 30 minutes après l'envoi). Rien n'est enregistré si l'un des deux est refusé.
  const keepBig = await claimFile(ctx, big);
  if (!keepBig.ok) return no("file", { reason: keepBig.reason });
  const keepSmall = await claimFile(ctx, small);
  if (!keepSmall.ok || keepBig.already || keepSmall.already) {
    // Un fichier déjà gardé par une autre photo de ce module ne doit jamais être supprimé avec celle-ci : doublon, on ne touche à rien d'existant.
    if (!keepBig.already) await dropFiles(ctx, [big]);
    if (!keepSmall.ok) return no("file", { reason: keepSmall.reason });
    if (!keepSmall.already) await dropFiles(ctx, [small]);
    return no("duplicate");
  }
  try {
    const id = newPhotoId(items, () => randomId(10));
    items.push({ id, ...textOf({ caption, alt }), hidden: !!hidden, full: big, thumb: small, url: "", turl: "", w: num(w, 0, 0, HARD.side), h: num(h, 0, 0, HARD.side), bytes: num(bytes, 0, 0, HARD.photoBytes), tbytes: num(tbytes, 0, 0, HARD.thumbBytes), name: safeName(name), at: Date.now() });
    await writePhotos(ctx, a, items);
    await refreshAlbum(ctx, a, items);
    return ok({ id });
  } catch (e) {
    await dropFiles(ctx, [big, small]); // l'enregistrement a échoué : pas de photo à moitié enregistrée, pas de fichier orphelin
    throw e;
  }
}

/** Ajoute une photo qui reste chez un autre site (adresse https d'un site autorisé). Rien n'est copié. */
export async function addExternalPhoto(ctx, albumId, { url, thumbUrl = "", caption = "", alt = "", hidden = false }) {
  const a = await getAlbum(ctx, albumId);
  if (!a) return no("not_found");
  const hosts = hostsOf(ctx);
  const full = httpsUrl(url);
  if (!full) return no("bad_url");
  if (!hosts.length) return no("no_hosts");
  if (!hostAllowed(full, hosts)) return no("host_not_allowed");
  let small = "";
  if (thumbUrl) {
    small = httpsUrl(thumbUrl) ?? "";
    if (!small) return no("bad_url");
    if (!hostAllowed(small, hosts)) return no("host_not_allowed");
  }
  const items = await loadPhotos(ctx, a);
  if (items.length >= limitsOf(ctx).photos) return no("full_photos", { max: limitsOf(ctx).photos });
  if (usage(await freshAlbums(ctx)).photos >= limitsOf(ctx).totalPhotos) return no("full_total", { max: limitsOf(ctx).totalPhotos });
  const id = newPhotoId(items, () => randomId(10));
  items.push({ id, ...textOf({ caption, alt }), hidden: !!hidden, full: "", thumb: "", url: full, turl: small, w: 0, h: 0, bytes: 0, tbytes: 0, name: "", at: Date.now() });
  await writePhotos(ctx, a, items);
  await refreshAlbum(ctx, a, items);
  return ok({ id });
}

export async function updatePhoto(ctx, albumId, photoId, input) {
  const a = await getAlbum(ctx, albumId);
  if (!a) return no("not_found");
  const items = await loadPhotos(ctx, a);
  const p = items.find((x) => x.id === photoId);
  if (!p) return no("not_found");
  const text = textOf(input);
  const hidden = input?.hidden === true || input?.hidden === "on";
  Object.assign(p, text, { hidden });
  await writePhotos(ctx, a, items);
  await refreshAlbum(ctx, a, items);
  return ok();
}

/** Masque (ou remontre) une photo en un clic : elle n'est plus servie à personne, ses fichiers restent pour pouvoir la remontrer (rien n'est supprimé). */
export async function hidePhoto(ctx, albumId, photoId, hide = true) {
  const a = await getAlbum(ctx, albumId);
  if (!a) return no("not_found");
  const items = await loadPhotos(ctx, a);
  const p = items.find((x) => x.id === photoId);
  if (!p) return no("not_found");
  if (p.hidden !== hide) {
    p.hidden = hide;
    await writePhotos(ctx, a, items);
    await refreshAlbum(ctx, a, items);
  }
  return ok({ album: a, photo: p });
}

export async function deletePhoto(ctx, albumId, photoId) {
  const a = await getAlbum(ctx, albumId);
  if (!a) return no("not_found");
  const items = await loadPhotos(ctx, a);
  const at = items.findIndex((x) => x.id === photoId);
  if (at < 0) return no("not_found");
  const [gone] = items.splice(at, 1);
  await writePhotos(ctx, a, items); // d'abord la photo disparaît des données (plus servie à personne), ensuite seulement ses fichiers
  await refreshAlbum(ctx, a, items);
  return ok({ files: await dropFiles(ctx, [gone.full, gone.thumb]) });
}

/** Déplace une photo : -1 monte d'un cran, 1 descend d'un cran, "first" la met en tête, "last" à la fin. */
export async function movePhoto(ctx, albumId, photoId, how) {
  const a = await getAlbum(ctx, albumId);
  if (!a) return no("not_found");
  const items = await loadPhotos(ctx, a);
  const at = items.findIndex((x) => x.id === photoId);
  if (at < 0) return no("not_found");
  const to = how === "first" ? 0 : how === "last" ? items.length - 1 : at + (how < 0 ? -1 : 1);
  if (to < 0 || to >= items.length || to === at) return ok({ edge: true });
  const [p] = items.splice(at, 1);
  items.splice(to, 0, p);
  await writePhotos(ctx, a, items);
  await refreshAlbum(ctx, a, items);
  return ok();
}

export async function setCover(ctx, albumId, photoId) {
  const a = await getAlbum(ctx, albumId);
  if (!a) return no("not_found");
  const items = await loadPhotos(ctx, a);
  const p = items.find((x) => x.id === photoId);
  if (!p) return no("not_found");
  if (p.hidden || !hasImage(p)) return no("cover_hidden");
  const row = await getRow(ctx, albumId, "album");
  await ctx.api.store.update(albumId, { ...row.data, cover: photoId });
  invalidate(ctx);
  await refreshAlbum(ctx, { ...a, cover: photoId }, items);
  return ok();
}

// ── Demandes de retrait ──────────────────────────────────────────────────────────────────────────────────────────────

export async function closeRequest(ctx, id, status) {
  const row = await getRow(ctx, id, "request");
  if (!row) return no("not_found");
  // Une demande traitée ne garde plus la façon de joindre la personne.
  const { contact: _gone, ...rest } = row.data;
  await ctx.api.store.update(id, { ...rest, status, handledAt: new Date().toISOString() });
  return ok();
}
