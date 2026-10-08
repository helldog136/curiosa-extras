// Chaîne YouTube — module communautaire de Curiosa. Porté de l'ancien site.
//
// Deux modes (comme l'original) : l'identifiant de chaîne seul (flux RSS public, ~15 dernières vidéos avec leurs vues, pas de durée) ou, avec une
// clé d'API, l'API officielle (durées exactes, Shorts distingués). Mise en cache 10 minutes : on ne sollicite pas YouTube à chaque visite.
// La vidéo mise en avant n'est PAS intégrée dans la page : un lecteur affiché compte comme une vue pour YouTube. On affiche la vignette,
// qui renvoie vers YouTube.
const CHANNEL_RE = /^UC[\w-]{22}$/;
const SHORT_MAX_SECONDS = 60;
const TTL = 10 * 60_000;
const cache = new Map();

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const unxml = (t) => t.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10))).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const seconds = (iso) => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
const get = (url, init = {}) => fetch(url, { signal: AbortSignal.timeout(5000), ...init });

export async function viaFeed(channelId) {
  try {
    const res = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);
    if (!res.ok) return [];
    const out = [];
    for (const block of (await res.text()).split("<entry>").slice(1)) {
      const id = /<yt:videoId>([\w-]{6,20})<\/yt:videoId>/.exec(block)?.[1];
      const title = /<title>([^<]*)<\/title>/.exec(block)?.[1];
      const publishedAt = /<published>([^<]+)<\/published>/.exec(block)?.[1];
      const views = /<media:statistics views="(\d+)"/.exec(block)?.[1];
      if (id && title && publishedAt) out.push({ id, title: unxml(title), publishedAt, views: views ? Number(views) : null, durationSeconds: null });
    }
    return out;
  } catch { return []; }
}

export async function viaApi(channelId, apiKey) {
  try {
    const ch = await get(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(apiKey)}`);
    if (!ch.ok) return [];
    const playlist = (await ch.json()).items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!playlist) return [];
    const list = await get(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${encodeURIComponent(playlist)}&maxResults=50&key=${encodeURIComponent(apiKey)}`);
    if (!list.ok) return [];
    const entries = ((await list.json()).items ?? []).map((i) => ({ id: i.snippet?.resourceId?.videoId, title: i.snippet?.title, publishedAt: i.snippet?.publishedAt })).filter((e) => e.id && e.title && e.publishedAt);
    if (!entries.length) return [];
    const durations = new Map(), views = new Map();
    const stats = await get(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${entries.map((e) => e.id).join(",")}&key=${encodeURIComponent(apiKey)}`);
    if (stats.ok) for (const v of (await stats.json()).items ?? []) { durations.set(v.id, seconds(v.contentDetails?.duration ?? "")); if (v.statistics?.viewCount) views.set(v.id, Number(v.statistics.viewCount)); }
    return entries.map((e) => ({ ...e, views: views.get(e.id) ?? null, durationSeconds: durations.get(e.id) ?? null }));
  } catch { return []; }
}

/** Vidéos récentes de la chaîne (10 min de cache ; une liste vide n'est jamais figée dans le cache). */
export async function listVideos(channelId, apiKey) {
  if (!CHANNEL_RE.test(channelId ?? "")) return [];
  const key = `${channelId}|${apiKey ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.items;
  const items = apiKey ? await viaApi(channelId, apiKey) : await viaFeed(channelId);
  if (items.length) { cache.set(key, { items, at: Date.now() }); return items; }
  return hit?.items ?? [];
}
export const resetCache = () => cache.clear();

/** Sans clé d'API on ignore la durée : /shorts/<id> répond 200 pour un vrai Short, redirige pour une vidéo classique. */
export async function isShort(video) {
  if (video.durationSeconds !== null && video.durationSeconds !== undefined) return video.durationSeconds <= SHORT_MAX_SECONDS;
  try {
    const res = await get(`https://www.youtube.com/shorts/${encodeURIComponent(video.id)}`, { method: "HEAD", redirect: "manual", headers: { Cookie: "SOCS=CAI" } });
    return res.status === 200;
  } catch { return false; }
}

/** Les plus vues d'abord (à égalité la plus récente), parmi celles de moins de `maxAgeDays` jours. */
export function rank(videos, maxAgeDays, now = Date.now()) {
  const cutoff = now - maxAgeDays * 86_400_000;
  return videos.filter((v) => Date.parse(v.publishedAt) >= cutoff).sort((a, b) => (b.views ?? 0) - (a.views ?? 0) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
const cfg = (ctx) => ({ channelId: String(ctx.setting("channelId") ?? "").trim(), apiKey: String(ctx.setting("apiKey") ?? "").trim() || null });

async function longVideos(ctx, limit) {
  const { channelId, apiKey } = cfg(ctx);
  const out = [];
  for (const v of await listVideos(channelId, apiKey)) {
    if (out.length >= limit) break;
    if (!(await isShort(v))) out.push(v);
  }
  return out;
}

export default {
  sections: {
    async featured(ctx) {
      const { channelId, apiKey } = cfg(ctx);
      const maxAge = Math.min(3650, Math.max(1, Number(ctx.setting("maxAgeDays")) || 30));
      const includeShorts = ctx.setting("includeShorts") === true;
      let video = null;
      for (const c of rank(await listVideos(channelId, apiKey), maxAge).slice(0, 5)) {
        if (!includeShorts && (await isShort(c))) continue;
        video = c; break;
      }
      if (!video) return null;
      const title = esc(video.title);
      return [{
        type: "html",
        html: `<a href="${watchUrl(video.id)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(ctx.t("watch", { title: video.title }))}" style="display:block;position:relative;aspect-ratio:16/9;overflow:hidden;border-radius:1rem;border:1px solid var(--v-line);background:#000">` +
          `<img src="https://i.ytimg.com/vi/${esc(video.id)}/hqdefault.jpg" alt="" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` +
          `<span aria-hidden="true" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:4rem;height:4rem;border-radius:9999px;background:rgba(0,0,0,.7);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.8rem;box-shadow:0 0 0 2px rgba(255,255,255,.7)">▶</span></a>` +
          `<p style="margin:.5rem 0 0;color:var(--v-fg)"><strong>${title}</strong>${video.views != null ? ` <span style="color:var(--v-muted)">· ${esc(ctx.t("views", { n: video.views.toLocaleString(ctx.locale) }))}</span>` : ""}</p>`,
      }];
    },
  },

  exports: {
    // Les Shorts ne s'annoncent pas comme des vidéos : ils ne sont pas proposés.
    async "feed.item"(ctx, { limit }) {
      return (await longVideos(ctx, limit ?? 20)).map((v) => ({ id: `yt:${v.id}`, title: v.title, url: watchUrl(v.id), publishedAt: v.publishedAt, topics: ["video"] }));
    },
    async "maze.poster"(ctx, { limit }) {
      return (await longVideos(ctx, limit ?? 10)).map((v) => ({ title: v.title, url: watchUrl(v.id), image: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, kind: "video" }));
    },
  },
};
