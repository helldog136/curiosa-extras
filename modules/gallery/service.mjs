// Galeries photos : le service « gallery.albums » (version 1, lecture seule), offert aux autres modules.
//   list({ limit?, cursor?, q? }) → { ok: true, albums: [{ id, title, cover?, count, url }], next? }
//   get(id)                       → { ok: true, album: { id, title, count, url, cover? } | null }
// Seuls les albums PUBLIÉS sont rendus. `count` : photos visibles (0 pour un album qui mène vers un autre service). `url` et `cover` : adresses complètes.
// Aucune méthode ne lève : { ok: false, error } si le stockage ne répond pas.

const { getAlbum, loadAlbums, loadMeta, sortMode } = await import(new URL(`./data.mjs${new URL(import.meta.url).search}`, import.meta.url).href);
const { clean, cleanUpload, fold, isId, num } = await import(new URL(`./text.mjs${new URL(import.meta.url).search}`, import.meta.url).href);
const { albumHref } = await import(new URL(`./view.mjs${new URL(import.meta.url).search}`, import.meta.url).href);

function describe(ctx, a) {
  const site = ctx.api.siteUrl;
  const path = albumHref(ctx, a, false);
  const out = { id: a.id, title: a.title, count: a.mode === "external" ? 0 : a.shown, url: path === null ? (a.link || site) : `${site}${path === "/" ? "" : path}` };
  const c = a.coverThumb;
  if (c.src) out.cover = `${site}${cleanUpload(c.src)}`;
  else if (c.url) out.cover = c.url;
  return out;
}

const busy = () => ({ ok: false, error: "busy" });
const live = (a) => a.status === "published" && (a.mode === "hosted" || !!a.link);

export const services = {
  "gallery.albums": {
    async list(ctx, args) {
      try {
        const limit = num(args?.limit, 20, 1, 50);
        const from = /^\d{1,5}$/.test(String(args?.cursor ?? "")) ? Number(args.cursor) : 0;
        const q = fold(clean(args?.q, 100));
        const meta = await loadMeta(ctx);
        const all = (await loadAlbums(ctx, sortMode(ctx, meta))).filter((a) => live(a) && (!q || fold(a.title).includes(q)));
        const page = all.slice(from, from + limit);
        const out = { ok: true, albums: page.map((a) => describe(ctx, a)) };
        if (from + limit < all.length) out.next = String(from + limit);
        return out;
      } catch {
        return busy();
      }
    },
    async get(ctx, args) {
      try {
        const id = typeof args === "string" ? args : args?.id;
        if (!isId(id)) return { ok: true, album: null };
        const a = await getAlbum(ctx, id);
        return { ok: true, album: a && live(a) ? describe(ctx, a) : null };
      } catch {
        return busy();
      }
    },
  },
};
