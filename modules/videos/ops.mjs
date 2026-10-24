// Vidéothèque — les gestes d'ÉCRITURE partagés par l'administration et par l'assistant IA : ajouter une vidéo à partir d'une adresse collée, compléter titres et miniatures.
// Tout ce qui touche la plateforme (titre, miniature) est borné : 5 s par demande de titre (ctx.api.net), 4 s par miniature, 20 vidéos par passage, 15 s au total.
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const R = await import(`./providers.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const { LIMITS, clean } = P;

export const timing = { totalMs: 15_000 };

/** Garde la miniature de la vidéo dans le stockage (si les miniatures gardées sont permises). Renvoie vrai si elle est gardée. */
export async function keepThumb(ctx, x) {
  if (D.settings(ctx).thumbs === "plain") return false;
  const r = await R.downloadThumb(x.provider, x.ext);
  if (!r.ok) return false;
  if (!(await D.putThumb(ctx, x.n, r.bytes, r.type))) return false;
  await D.updateVideo(ctx, x.n, { thumb: true });
  return true;
}

/**
 * Ajoute UNE vidéo à partir d'une adresse collée. `input` : { address, title?, desc?, cat?, status?, date?, dur?, free? } (déjà bornés par l'appelant).
 * → { ok: true, item, lookup } ou { ok: false, field: "url" | "title" | null, code }.
 */
export async function addOne(ctx, input) {
  const parsed = R.parseAddress(input.address);
  if (!parsed.ok) return { ok: false, field: "url", code: parsed.why };
  const snap = await D.snapshot(ctx, { fresh: true });
  const dup = snap.byExt.get(`${parsed.provider}:${parsed.id}`);
  if (dup) return { ok: false, field: "url", code: "duplicate", item: dup };
  if (snap.items.length >= LIMITS.videos) return { ok: false, field: null, code: "full" };
  let title = clean(input.title, LIMITS.title);
  const info = await R.lookup(ctx, parsed.provider, parsed.id);
  if (info.state === "missing" && !title) return { ok: false, field: "url", code: "missing" };
  if (!title && info.state === "ok") title = info.title;
  if (!title) return { ok: false, field: "title", code: info.state === "private" ? "needTitlePrivate" : "needTitle" };
  const r = await D.addVideos(ctx, [{ provider: parsed.provider, ext: parsed.id, title, desc: input.desc, cat: input.cat, status: input.status, date: input.date, dur: input.dur, free: input.free, noEmbed: info.state === "private" }]);
  const item = r.added[0];
  if (!item) return { ok: false, field: r.full ? null : "url", code: r.full ? "full" : "duplicate" };
  const kept = await keepThumb(ctx, item);
  return { ok: true, item: { ...item, thumb: kept }, lookup: info.state, thumbKept: kept };
}

/** Combien de vidéos n'ont pas encore leur titre ou leur miniature gardée (`videos` : combien de vidéos sont concernées, une seule fois chacune). */
export function missing(ctx, snap) {
  const wantThumb = D.settings(ctx).thumbs === "copy";
  const noTitle = snap.items.filter((x) => !x.title).length;
  const noThumb = wantThumb ? snap.items.filter((x) => !x.thumb && !x.cover).length : 0;
  const videos = snap.items.filter((x) => !x.title || (wantThumb && !x.thumb && !x.cover)).length;
  return { noTitle, noThumb, videos, any: videos > 0 };
}

/**
 * Complète les titres et miniatures manquants, `limit` vidéos par passage (les plus récentes d'abord), 3 en même temps, 15 s au plus.
 * → { done, titles, thumbs, left, down } (down : la plateforme n'a pas répondu).
 */
export async function complete(ctx, { limit = LIMITS.fillBatch } = {}) {
  const snap = await D.snapshot(ctx, { fresh: true });
  const wantThumb = D.settings(ctx).thumbs === "copy";
  const todo = snap.items.filter((x) => !x.title || (wantThumb && !x.thumb && !x.cover));
  const batch = todo.slice(0, P.int(limit, LIMITS.fillBatch, 1, LIMITS.fillBatch));
  const deadline = Date.now() + timing.totalMs;
  const out = { done: 0, titles: 0, thumbs: 0, left: 0, down: false };
  for (let i = 0; i < batch.length && Date.now() < deadline; i += 3) {
    await Promise.all(batch.slice(i, i + 3).map(async (x) => {
      if (!x.title) {
        const info = await R.lookup(ctx, x.provider, x.ext);
        if (info.state === "ok") { await D.updateVideo(ctx, x.n, { title: info.title }); out.titles++; }
        else if (info.state === "private") await D.updateVideo(ctx, x.n, { noEmbed: true });
        else if (info.state === "down") out.down = true;
      }
      if (wantThumb && !x.thumb && !x.cover && (await keepThumb(ctx, x))) out.thumbs++;
      out.done++;
    }));
  }
  out.left = missing(ctx, await D.snapshot(ctx, { fresh: true })).videos;
  return out;
}

/** Remplit le titre et l'état du lecteur d'UNE vidéo depuis la plateforme (bouton « Actualiser »). → { state: "ok" | "missing" | "private" | "down", title? } */
export async function refreshOne(ctx, x, { overwriteTitle = false } = {}) {
  const info = await R.lookup(ctx, x.provider, x.ext);
  const patch = {};
  if (info.state === "ok") { if (overwriteTitle || !x.title) patch.title = info.title; patch.noEmbed = false; }
  else if (info.state === "private") patch.noEmbed = true;
  if (Object.keys(patch).length) await D.updateVideo(ctx, x.n, patch);
  if (D.settings(ctx).thumbs === "copy") await keepThumb(ctx, { ...x });
  return info;
}
