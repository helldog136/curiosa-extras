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
const statsCache = new Map();    // identifiant|clé → { value, until } : la dernière réponse, valable jusqu'à `until` (jamais servie après)
const statsPending = new Map();  // appels en cours (deux demandes simultanées partagent le même)
const shortCache = new Map();    // identifiant de vidéo → { value, until } : « est-ce un Short ? » (sans clé d'API il faut interroger YouTube, un appel par vidéo)
const shortPending = new Map();
const SHORT_UNKNOWN_TTL = 60_000;   // YouTube n'a pas répondu : on compte la vidéo comme classique, mais on ne réessaie pas à chaque visite
const STATS_TTL = 10 * 60_000, STATS_FAIL_TTL = 60_000, STATS_RATE_TTL = 10 * 60_000;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const unxml = (t) => t.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10))).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const seconds = (iso) => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
/**
 * Les délais (en millisecondes), dans un objet pour que les tests puissent les raccourcir.
 *   requestMs : un appel réseau (signal d'abandon) ; la borne dure est 20 % plus longue, lecture du corps comprise (une réponse qui ignorerait le signal ne bloque pas pour autant) ;
 *   sharedMs  : un travail partagé par plusieurs demandes ; passé ce délai tout le monde reçoit une erreur « network » et l'entrée partagée est retirée ;
 *   shortsMs  : tout le contrôle « Short ou non » d'une liste de vidéos, d'un bout à l'autre ; concurrency : combien de contrôles en même temps.
 */
export const timing = { requestMs: 5000, sharedMs: 15000, shortsMs: 5000, concurrency: 4 };
/** Attend `p` au plus `ms`, sinon refuse. Le minuteur est libéré dans tous les cas et ne retient pas le processus. */
function within(p, ms) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); timer.unref?.(); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}
/** fetch avec signal d'abandon ET borne dure. Ne rend que { ok, status, json(), text() }, lecture du corps bornée elle aussi. */
async function get(url, init = {}) {
  const hard = Math.round(timing.requestMs * 1.2);
  const res = await within(fetch(url, { signal: AbortSignal.timeout(timing.requestMs), ...init }), hard);
  return { ok: res.ok, status: res.status, json: () => within(res.json(), hard), text: () => within(res.text(), hard) };
}
/**
 * Un travail partagé entre demandes simultanées, JAMAIS éternel : si `make` ne se termine pas dans `ms`, tout le monde reçoit `fallback()` et l'entrée est retirée
 * (sinon chaque demande suivante attendrait la même promesse jusqu'au redémarrage). `record` range le résultat ; un travail resté en arrière-plan n'écrit rien.
 */
function share(map, k, make, fallback, record = (v) => v, ms = timing.sharedMs) {
  const pending = map.get(k);
  if (pending) return pending;
  let timer;
  const expiry = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback()), ms); timer.unref?.(); });
  const work = Promise.resolve().then(make).catch(() => fallback());
  const run = Promise.race([work, expiry]).then(record).finally(() => { clearTimeout(timer); if (map.get(k) === run) map.delete(k); });
  map.set(k, run);
  return run;
}

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

/**
 * Chiffres de la chaîne : { stats: { followers?, hidden?, content?, views? }, at } ou { error: "auth" | "rate" | "network" | "config", reason?, at } ; ne lève jamais.
 * `channels.list?part=statistics` avec la clé d'API du module (1 unité de quota). Sans clé : { error: "config", reason: "key" } sans aucune requête.
 * L'abonnement n'est PAS exact : YouTube l'arrondit à 3 chiffres significatifs (1 234 567 devient 1 230 000) et ne le donne pas si la chaîne le cache (`hidden`).
 */
function statsError(status, body) {
  const reason = String(body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "");
  if (status === 429 || /quota|rateLimit|dailyLimit|RESOURCE_EXHAUSTED/i.test(reason)) return { error: "rate" };
  if (status === 400 || status === 401 || status === 403) return { error: "auth" };   // clé inconnue, refusée, service non activé, restrictions de la clé
  if (status === 404) return { error: "config", reason: "channel" };
  return { error: "network" };
}
async function fetchStats(channelId, apiKey) {
  try {
    const res = await get(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(apiKey)}`);
    if (!res.ok) return statsError(res.status, await res.json().catch(() => ({})));
    const item = ((await res.json()).items ?? [])[0];
    if (!item) return { error: "config", reason: "channel" };   // YouTube ne connaît pas cet identifiant
    const n = (v) => (/^\d{1,15}$/.test(String(v ?? "")) ? Number(v) : undefined);
    const st = item.statistics ?? {};
    const hidden = st.hiddenSubscriberCount === true || n(st.subscriberCount) === undefined;
    return { stats: { ...(hidden ? { hidden: true } : { followers: n(st.subscriberCount) }), content: n(st.videoCount), views: n(st.viewCount) } };
  } catch { return { error: "network" }; }
}
export async function channelStats(channelId, apiKey) {
  if (!CHANNEL_RE.test(channelId ?? "")) return { error: "config", reason: "channel", at: Date.now() };
  if (!apiKey) return { error: "config", reason: "key", at: Date.now() };
  const k = `${channelId}|${apiKey}`;
  const hit = statsCache.get(k);
  if (hit && hit.until > Date.now()) return hit.value;
  return share(statsPending, k, () => fetchStats(channelId, apiKey), () => ({ error: "network" }), (found) => {
    const value = { ...found, at: Date.now() };
    statsCache.set(k, { value, until: Date.now() + (value.error === "rate" ? STATS_RATE_TTL : value.error ? STATS_FAIL_TTL : STATS_TTL) });
    return value;
  });
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
export const resetCache = () => { cache.clear(); statsCache.clear(); statsPending.clear(); shortCache.clear(); shortPending.clear(); };

/**
 * Sans clé d'API on ignore la durée : /shorts/<id> répond 200 pour un vrai Short, redirige pour une vidéo classique.
 * La réponse est gardée 10 minutes par vidéo ; si YouTube ne répond pas, la vidéo compte comme classique et on ne réessaie qu'au bout d'une minute.
 */
export async function isShort(video) {
  if (video.durationSeconds !== null && video.durationSeconds !== undefined) return video.durationSeconds <= SHORT_MAX_SECONDS;
  const hit = shortCache.get(video.id);
  if (hit && hit.until > Date.now()) return hit.value;
  const unknown = () => ({ value: false, unknown: true });
  const r = await share(shortPending, video.id, async () => {
    try {
      const res = await get(`https://www.youtube.com/shorts/${encodeURIComponent(video.id)}`, { method: "HEAD", redirect: "manual", headers: { Cookie: "SOCS=CAI" } });
      return res.status === 429 || res.status >= 500 ? unknown() : { value: res.status === 200 };
    } catch { return unknown(); }
  }, unknown, (found) => {
    shortCache.set(video.id, { value: found.value, until: Date.now() + (found.unknown ? SHORT_UNKNOWN_TTL : TTL) });
    return found;
  });
  return r.value;
}

/**
 * « Short ou non » pour une liste de vidéos : { identifiant → booléen }. Les contrôles se font en parallèle (`timing.concurrency` à la fois) et l'ensemble a une borne globale
 * (`timing.shortsMs`) : passé ce délai, les vidéos non contrôlées comptent comme classiques (et ne sont pas redemandées avant une minute). Ne lève jamais.
 */
export async function shortFlags(videos) {
  const flags = new Map(), queue = [...videos];
  let stopped = false, timer;
  const worker = async () => { while (!stopped && queue.length) { const v = queue.shift(); const short = await isShort(v); if (!stopped) flags.set(v.id, short); } };
  const pool = Promise.all(Array.from({ length: Math.min(Math.max(1, timing.concurrency), queue.length) }, worker));
  const deadline = new Promise((resolve) => { timer = setTimeout(resolve, timing.shortsMs); timer.unref?.(); });
  await Promise.race([pool, deadline]);
  clearTimeout(timer);
  stopped = true;
  for (const v of videos) {
    if (flags.has(v.id)) continue;
    flags.set(v.id, false);
    const hit = shortCache.get(v.id);
    if (!hit || hit.until <= Date.now()) shortCache.set(v.id, { value: false, until: Date.now() + SHORT_UNKNOWN_TTL });
  }
  return flags;
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
  const videos = await listVideos(channelId, apiKey);
  const flags = await shortFlags(videos);
  return videos.filter((v) => !flags.get(v.id)).slice(0, limit);
}

const METRICS = ["followers", "content", "views"];
function statItems(ctx, r) {
  const { channelId } = cfg(ctx);
  return METRICS.map((metric) => {
    const error = r.error ?? (r.stats.hidden && metric === "followers" ? "hidden" : null);
    if (!error && r.stats[metric] === undefined) return null;   // YouTube n'a pas donné ce chiffre : on ne le publie pas
    return {
      id: `youtube-channel:${ctx.instance.key}:${metric}`, platform: "youtube", account: ctx.instance.name || "YouTube", accountKey: ctx.instance.key, metric, label: ctx.t(`stat_${metric}`),
      ...(error ? {} : { value: r.stats[metric] }), asOf: new Date(r.at).toISOString(), url: `https://www.youtube.com/channel/${channelId}`, ...(error ? { error } : {}),
    };
  }).filter(Boolean);
}
/** Le message de l'état d'un chiffre, pour la personne qui gère le site : ce qui se passe et quoi faire. */
const whyNot = (ctx, item, r) => ctx.t(item.error === "config" ? (r.reason === "key" ? "err_config_key" : "err_config_channel") : `err_${item.error}`);

/** Le guide « Comment créer ma clé YouTube ? » (repliable) : les étapes dans la console Google, en mots simples. Aucun secret ; le lien ouvre la console dans un nouvel onglet. */
export function keyGuideHtml(ctx) {
  const t = (k) => esc(ctx.t(k));
  const li = (prefix, n) => Array.from({ length: n }, (_, i) => `<li style="margin:.35rem 0">${t(`${prefix}${i + 1}`)}</li>`).join("");
  return `<details style="margin:1rem 0;border:1px solid var(--v-border,#8884);border-radius:.75rem;padding:.25rem 1rem">` +
    `<summary style="cursor:pointer;min-height:2.75rem;display:flex;align-items:center;font-weight:600">${t("guide_title")}</summary>` +
    `<div style="padding-bottom:.75rem"><p>${t("guide_intro")}</p><ol style="padding-left:1.25rem">${li("guide_step", 6)}</ol>` +
    `<p><a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" style="font-weight:600">${t("guide_open")}</a></p>` +
    `<h4 style="margin:1rem 0 .25rem;font-weight:600">${t("guide_err_title")}</h4><ul style="padding-left:1.25rem">${li("guide_err", 3)}</ul>` +
    `<p style="color:var(--v-muted,#888)">${t("guide_note")}</p></div></details>`;
}

export default {
  async adminPanel(ctx) {
    const guideBlock = { type: "html", html: keyGuideHtml(ctx) };
    if (ctx.setting("trackStats") !== true) return [guideBlock];
    const { channelId, apiKey } = cfg(ctx);
    if (!CHANNEL_RE.test(channelId)) return [guideBlock, { type: "banner", tone: "warning", text: ctx.t("err_config_channel") }];
    const r = await channelStats(channelId, apiKey);
    const rows = statItems(ctx, r).map((i) => [i.label, i.error ? whyNot(ctx, i, r) : i.value.toLocaleString(ctx.locale)]);
    return [guideBlock, { type: "heading", text: ctx.t("stats_title") }, { type: "table", columns: [ctx.t("col_stat"), ctx.t("col_value")], rows }, { type: "markdown", text: ctx.t("stats_note") }];
  },
  sections: {
    async featured(ctx) {
      const { channelId, apiKey } = cfg(ctx);
      const maxAge = Math.min(3650, Math.max(1, Number(ctx.setting("maxAgeDays")) || 30));
      const includeShorts = ctx.setting("includeShorts") === true;
      const candidates = rank(await listVideos(channelId, apiKey), maxAge).slice(0, 5);
      const flags = includeShorts ? new Map() : await shortFlags(candidates);
      const video = candidates.find((c) => !flags.get(c.id)) ?? null;
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
    /** Le bouton de la chaîne pour le cœur (en-tête) : rien tant que l'identifiant de chaîne n'est pas réglé. */
    "social.link"(ctx) {
      const id = String(ctx.setting("channelId") ?? "").trim();
      return CHANNEL_RE.test(id) ? [{ label: "YouTube", url: `https://www.youtube.com/channel/${id}`, icon: "youtube" }] : [];
    },
    // Les Shorts ne s'annoncent pas comme des vidéos : ils ne sont pas proposés.
    async "feed.item"(ctx, { limit }) {
      return (await longVideos(ctx, limit ?? 20)).map((v) => ({ id: `yt:${v.id}`, title: v.title, url: watchUrl(v.id), publishedAt: v.publishedAt, topics: ["video"] }));
    },
    /** Abonnés, vidéos et vues pour « social.stat ». Jamais de valeur inventée ni périmée : `error` et pas de `value`. Désactivé (rien) tant que « Suivre mes statistiques » n'est pas coché. */
    async "social.stat"(ctx, args) {
      if (ctx.setting("trackStats") !== true) return [];
      const { channelId } = cfg(ctx);
      if (!CHANNEL_RE.test(channelId)) return [];
      const items = statItems(ctx, await channelStats(channelId, cfg(ctx).apiKey));
      return Number.isInteger(args?.limit) && args.limit > 0 ? items.slice(0, args.limit) : items;
    },
    async "maze.poster"(ctx, { limit }) {
      return (await longVideos(ctx, limit ?? 10)).map((v) => ({ title: v.title, url: watchUrl(v.id), image: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, kind: "video" }));
    },
  },
};
