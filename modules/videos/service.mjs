// Vidéothèque — le service offert aux autres modules : `videos.library` (version 1, lecture seule).
//   list({ limit, cursor, q, category }) → { ok: true, items: [{ id, title, thumb?, url }], next? }
//   get({ id })                          → { ok: true, item: { id, title, thumb?, url } | null }      (ajout : retrouver une vidéo déjà choisie)
// Seules les vidéos PUBLIÉES sont rendues. `id` est le numéro stable de la vidéo (texte) ; `thumb` et `url` sont des chemins du site (la miniature est la copie gardée ici).
// `limit` : 20 par défaut, 50 au plus. `cursor` : celui du `next` précédent (opaque pour l'appelant). `category` : le nom, le numéro ou le morceau d'adresse de la catégorie.
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const D = await import(`./data.mjs${v}`);

function shape(ctx, x, cfg) {
  const url = P.videoPath(ctx, x);
  if (!url) return null;
  const src = cfg.thumbs === "plain" ? x.cover : x.cover || (x.thumb ? P.thumbPath(ctx, x) : "");
  return { id: String(x.n), title: x.title, ...(src ? { thumb: src } : {}), url };
}

export async function list(ctx, args) {
  try {
    const a = args && typeof args === "object" ? args : {};
    const snap = await D.snapshot(ctx);
    const cfg = D.settings(ctx);
    let cat = 0;
    if (a.category !== undefined && a.category !== null && String(a.category).trim() !== "") {
      const c = D.catByRef(snap, a.category);
      if (!c) return { ok: true, items: [] };
      cat = c.k;
    }
    const cursor = typeof a.cursor === "string" && a.cursor ? P.parseCursor(a.cursor) : null;
    if (typeof a.cursor === "string" && a.cursor && !cursor) return { ok: true, items: [] };
    const found = D.findPublic(snap, { cat, words: P.searchWords(P.clean(a.q, P.LIMITS.searchMax)), cursor, limit: P.int(a.limit, 20, 1, 50) });
    const items = found.items.map((x) => shape(ctx, x, cfg)).filter(Boolean);
    return { ok: true, items, ...(found.next ? { next: found.next } : {}) };
  } catch { return { ok: false, items: [] }; }
}

export async function get(ctx, args) {
  try {
    const n = Number(args?.id);
    if (!Number.isInteger(n) || n < 1) return { ok: true, item: null };
    const snap = await D.snapshot(ctx);
    const x = snap.byN.get(n);
    return { ok: true, item: x && D.isPublic(x) ? shape(ctx, x, D.settings(ctx)) : null };
  } catch { return { ok: false, item: null }; }
}
