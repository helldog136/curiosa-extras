// Chaîne YouTube — module communautaire de Curiosa. Porté de l'ancien site.
//
// Deux modes : l'identifiant de chaîne seul (flux RSS public, ~15 dernières vidéos avec leurs vues, pas de durée) ou, quand le site a une clé
// YouTube, l'interface officielle (durées exactes, Shorts distingués, chiffres de la chaîne). La clé n'est PAS gardée ici : elle appartient au
// fournisseur du service `youtube.api` (besoin facultatif) ; ce module ne la voit jamais. Une clé saisie dans une version précédente est remise
// à ce fournisseur (`adopt`) puis effacée d'ici, seulement après sa confirmation (migration 2, puis à chaque ouverture du panneau tant qu'elle reste).
// Tout appel réseau passe par ctx.api.net (délai dur, pauses, disjoncteur) : flux RSS et contrôle « Short ou non ».
// Mise en cache 10 minutes : on ne sollicite pas YouTube à chaque visite.
// La vidéo mise en avant n'est PAS intégrée dans la page : un lecteur affiché compte comme une vue pour YouTube. On affiche la vignette,
// qui renvoie vers YouTube.
const v = new URL(import.meta.url).search;   // la version du module se propage au fichier voisin (sinon l'ancien code resterait en mémoire après une mise à jour)
const events = await import(new URL(`./events.mjs${v}`, import.meta.url).href);
const live = await import(new URL(`./live.mjs${v}`, import.meta.url).href);
const CHANNEL_RE = /^UC[\w-]{22}$/;
const SHORT_MAX_SECONDS = 60;
const TTL = 10 * 60_000;
const API = "youtube.api";
const cache = new Map();         // identifiant de chaîne → { items, at }
const shortCache = new Map();    // identifiant de vidéo → { value, until } : « est-ce un Short ? » (sans clé il faut interroger YouTube, un appel par vidéo)
const shortPending = new Map();
const SHORT_UNKNOWN_TTL = 60_000;   // YouTube n'a pas répondu : on compte la vidéo comme classique, mais on ne réessaie pas à chaque visite
const CACHE_MAX = 200;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const unxml = (t) => t.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10))).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const seconds = (iso) => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
/**
 * Les délais (en millisecondes), dans un objet pour que les tests puissent les raccourcir.
 *   requestMs : un appel réseau (ctx.api.net) ; serviceMs : un appel au service `youtube.api` (borne dure, même si le fournisseur ne répond pas) ;
 *   shortsMs  : tout le contrôle « Short ou non » d'une liste de vidéos, d'un bout à l'autre ; concurrency : combien de contrôles en même temps.
 * Dans une page publique, aucun délai ne dépasse le temps restant de la page (ctx.api.net.budgetMs).
 */
export const timing = { requestMs: 5000, serviceMs: 9000, shortsMs: 5000, concurrency: 4 };
/** Attend `p` au plus `ms`, sinon `fallback()`. Le minuteur est libéré dans tous les cas et ne retient pas le processus. */
function within(p, ms, fallback) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback()), ms); timer.unref?.(); });
  return Promise.race([Promise.resolve(p).catch(() => fallback()), late]).finally(() => clearTimeout(timer));
}
/** Délai d'une étape : `ms`, ou moins si la page publique n'a plus que ce temps-là (on garde 300 ms pour afficher le repli). */
function limit(ctx, ms) {
  const b = typeof ctx.api?.net?.budgetMs === "function" ? ctx.api.net.budgetMs() : null;
  return typeof b === "number" && b > 0 ? Math.max(100, Math.min(ms, b - 300)) : ms;
}
function remember(map, k, v) { map.delete(k); map.set(k, v); while (map.size > CACHE_MAX) map.delete(map.keys().next().value); }

/** Appel au service `youtube.api` : la réponse du fournisseur, ou { ok: false, error: "unavailable" } sans fournisseur ; jamais d'exception, jamais d'attente sans fin. */
async function youtube(ctx, method, args) {
  const ms = limit(ctx, timing.serviceMs);
  const r = await within(ctx.api.services.call(API, method, { ...args, timeoutMs: Math.min(8000, ms) }), ms, () => ({ ok: false, late: true }));
  if (!r?.ok) return { ok: false, error: r?.late ? "timeout" : r?.reason === "unavailable" || r?.reason === "undeclared" ? "unavailable" : "network" };
  return r.value && typeof r.value === "object" ? r.value : { ok: false, error: "network" };
}
async function hasProvider(ctx) {
  try {
    if (typeof ctx.api.services.providers === "function") return (await ctx.api.services.providers(API)).length > 0;
    return await ctx.api.services.available(API);
  } catch { return false; }
}

export async function viaFeed(ctx, channelId) {
  const r = await ctx.api.net.request({ url: `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, timeoutMs: limit(ctx, timing.requestMs), maxBytes: 2_000_000 });
  if (!r.ok || r.status !== 200 || typeof r.text !== "string") return [];
  const out = [];
  for (const block of r.text.split("<entry>").slice(1)) {
    const id = /<yt:videoId>([\w-]{6,20})<\/yt:videoId>/.exec(block)?.[1];
    const title = /<title>([^<]*)<\/title>/.exec(block)?.[1];
    const publishedAt = /<published>([^<]+)<\/published>/.exec(block)?.[1];
    const views = /<media:statistics views="(\d+)"/.exec(block)?.[1];
    if (id && title && publishedAt) out.push({ id, title: unxml(title), publishedAt, views: views ? Number(views) : null, durationSeconds: null });
  }
  return out;
}

/** Les vidéos par l'interface officielle (3 unités de quota, gardées 10 minutes) ; null quand elle n'est pas utilisable (pas de clé, pas de fournisseur, panne) : on passe au flux public. */
export async function viaApi(ctx, channelId) {
  const ch = await youtube(ctx, "request", { endpoint: "channels.list", params: { part: "contentDetails", id: channelId } });
  if (!ch.ok || ch.status !== 200) return null;
  const playlist = ch.json?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (typeof playlist !== "string") return null;
  const list = await youtube(ctx, "request", { endpoint: "playlistItems.list", params: { part: "snippet", playlistId: playlist, maxResults: 50 } });
  if (!list.ok || list.status !== 200) return null;
  const entries = (Array.isArray(list.json?.items) ? list.json.items : []).map((i) => ({ id: i?.snippet?.resourceId?.videoId, title: i?.snippet?.title, publishedAt: i?.snippet?.publishedAt })).filter((e) => typeof e.id === "string" && /^[\w-]{11}$/.test(e.id) && e.title && e.publishedAt);
  if (!entries.length) return null;
  const durations = new Map(), views = new Map();
  const stats = await youtube(ctx, "request", { endpoint: "videos.list", params: { part: "contentDetails,statistics", id: entries.map((e) => e.id) } });
  if (stats.ok && stats.status === 200) for (const v of Array.isArray(stats.json?.items) ? stats.json.items : []) { durations.set(v.id, seconds(v.contentDetails?.duration ?? "")); if (v.statistics?.viewCount) views.set(v.id, Number(v.statistics.viewCount)); }
  return entries.map((e) => ({ ...e, views: views.get(e.id) ?? null, durationSeconds: durations.get(e.id) ?? null }));
}

/**
 * Chiffres de la chaîne : { stats: { followers?, hidden?, content?, views? }, at } ou { error: "auth" | "rate" | "network" | "config", reason?, at } ; ne lève jamais.
 * Une demande au service `youtube.api` (`channels`, 1 unité de quota, gardée 10 minutes par le fournisseur). Sans fournisseur : { error: "config", reason: "connector" } ;
 * fournisseur sans clé : { error: "config", reason: "key" }. JAMAIS de chiffre périmé : un résultat de repli (`stale`) devient une erreur.
 * L'abonnement n'est PAS exact : YouTube l'arrondit à 3 chiffres significatifs (1 234 567 devient 1 230 000) et ne le donne pas si la chaîne le cache (`hidden`).
 */
export async function channelStats(ctx, channelId, { priority } = {}) {
  const at = Date.now();
  if (!CHANNEL_RE.test(channelId ?? "")) return { error: "config", reason: "channel", at };
  const r = await youtube(ctx, "channels", { ids: [channelId], ...(priority ? { priority } : {}) });
  if (!r.ok || r.stale || (r.error && !r.items?.length)) {
    const e = r.error;
    if (e === "unavailable") return { error: "config", reason: "connector", at };
    if (e === "config") return { error: "config", reason: "key", at };
    if (e === "auth") return { error: "auth", at };
    if (e === "quota" || e === "rate") return { error: "rate", at };
    if (e === "invalid") return { error: "config", reason: "channel", at };
    return { error: "network", at };
  }
  const item = (r.items ?? []).find((i) => i.id === channelId);
  if (!item) return (r.failed ?? []).includes(channelId) ? { error: "network", at } : { error: "config", reason: "channel", at };   // YouTube ne connaît pas cet identifiant
  const n = (v) => (Number.isInteger(v) && v >= 0 ? v : undefined);
  const when = Date.parse(item.at);
  return { stats: { ...(item.hidden || n(item.subscribers) === undefined ? { hidden: true } : { followers: item.subscribers }), content: n(item.videos), views: n(item.views) }, at: Number.isFinite(when) ? when : at };
}

/** Vidéos récentes de la chaîne (10 min de cache ; une liste vide n'est jamais figée dans le cache ; en panne, la dernière liste connue). */
export async function listVideos(ctx, channelId) {
  if (!CHANNEL_RE.test(channelId ?? "")) return [];
  const hit = cache.get(channelId);
  if (hit && Date.now() - hit.at < TTL) return hit.items;
  const items = (await viaApi(ctx, channelId)) ?? (await viaFeed(ctx, channelId));
  if (items.length) { remember(cache, channelId, { items, at: Date.now() }); return items; }
  return hit?.items ?? [];
}
export const resetCache = () => { cache.clear(); shortCache.clear(); shortPending.clear(); events.resetEvents(); live.resetLive(); };

/**
 * Sans durée connue : /shorts/<id> répond 200 pour un vrai Short, redirige pour une vidéo classique (ctx.api.net ne suit pas les redirections).
 * La réponse est gardée 10 minutes par vidéo ; si YouTube ne répond pas, la vidéo compte comme classique et on ne réessaie qu'au bout d'une minute.
 * Deux demandes simultanées pour la même vidéo partagent le même contrôle.
 */
export async function isShort(ctx, video) {
  if (video.durationSeconds !== null && video.durationSeconds !== undefined) return video.durationSeconds <= SHORT_MAX_SECONDS;
  const hit = shortCache.get(video.id);
  if (hit && hit.until > Date.now()) return hit.value;
  let run = shortPending.get(video.id);
  if (!run) {
    run = ctx.api.net.request({ url: `https://www.youtube.com/shorts/${encodeURIComponent(video.id)}`, method: "HEAD", headers: { Cookie: "SOCS=CAI" }, timeoutMs: limit(ctx, timing.requestMs) })
      .then((r) => (!r.ok || r.status === 429 || r.status >= 500 ? { value: false, unknown: true } : { value: r.status === 200 }), () => ({ value: false, unknown: true }))
      .then((found) => { remember(shortCache, video.id, { value: found.value, until: Date.now() + (found.unknown ? SHORT_UNKNOWN_TTL : TTL) }); return found; })
      .finally(() => shortPending.delete(video.id));
    shortPending.set(video.id, run);
  }
  return (await run).value;
}

/**
 * « Short ou non » pour une liste de vidéos : { identifiant → booléen }. Les contrôles se font en parallèle (`timing.concurrency` à la fois) et l'ensemble a une borne globale
 * (`timing.shortsMs`, ou moins dans une page publique) : passé ce délai, les vidéos non contrôlées comptent comme classiques (et ne sont pas redemandées avant une minute). Ne lève jamais.
 */
export async function shortFlags(ctx, videos) {
  const flags = new Map(), queue = [...videos];
  let stopped = false, timer;
  const worker = async () => { while (!stopped && queue.length) { const v = queue.shift(); const short = await isShort(ctx, v).catch(() => false); if (!stopped) flags.set(v.id, short); } };
  const pool = Promise.all(Array.from({ length: Math.min(Math.max(1, timing.concurrency), queue.length) }, worker));
  const deadline = new Promise((resolve) => { timer = setTimeout(resolve, limit(ctx, timing.shortsMs)); timer.unref?.(); });
  await Promise.race([pool, deadline]);
  clearTimeout(timer);
  stopped = true;
  for (const v of videos) {
    if (flags.has(v.id)) continue;
    flags.set(v.id, false);
    const hit = shortCache.get(v.id);
    if (!hit || hit.until <= Date.now()) remember(shortCache, v.id, { value: false, until: Date.now() + SHORT_UNKNOWN_TTL });
  }
  return flags;
}

/** Les plus vues d'abord (à égalité la plus récente), parmi celles de moins de `maxAgeDays` jours. */
export function rank(videos, maxAgeDays, now = Date.now()) {
  const cutoff = now - maxAgeDays * 86_400_000;
  return videos.filter((v) => Date.parse(v.publishedAt) >= cutoff).sort((a, b) => (b.views ?? 0) - (a.views ?? 0) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
const channelOf = (ctx) => String(ctx.setting("channelId") ?? "").trim();

async function longVideos(ctx, limitCount) {
  const videos = await listVideos(ctx, channelOf(ctx));
  const flags = await shortFlags(ctx, videos);
  return videos.filter((v) => !flags.get(v.id)).slice(0, limitCount);
}

/**
 * La clé YouTube saisie ici par une version précédente (réglage hérité, jamais affiché) est remise au fournisseur de `youtube.api`, puis effacée d'ici
 * SEULEMENT quand il confirme être prêt (`ready`). Sans fournisseur, ou s'il n'est pas prêt : rien n'est effacé, on réessaiera. Ne lève jamais ;
 * la valeur ne quitte jamais la mémoire (ni journal, ni bloc, ni erreur). Renvoie { pending: true } tant qu'une clé attend.
 */
export async function handOverKey(ctx) {
  if (!ctx.legacy) return { pending: false };
  let key = null;
  try { key = await ctx.legacy.get("apiKey"); } catch { return { pending: false }; }
  if (typeof key !== "string" || !key.trim()) return { pending: false };
  const r = await within(ctx.api.services.call(API, "adopt", { apiKey: key.trim() }), timing.serviceMs, () => ({ ok: false }));
  if (!(r?.ok && r.value?.ready === true)) return { pending: true };
  try { await ctx.legacy.clear("apiKey"); } catch { return { pending: true }; }
  return { pending: false, handedOver: true };
}

const METRICS = ["followers", "content", "views"];
function statItems(ctx, r) {
  const channelId = channelOf(ctx);
  return METRICS.map((metric) => {
    const error = r.error ?? (r.stats.hidden && metric === "followers" ? "hidden" : null);
    if (!error && r.stats[metric] === undefined) return null;   // YouTube n'a pas donné ce chiffre : on ne le publie pas
    return {
      id: `youtube-channel:${ctx.instance.key}:${metric}`, platform: "youtube", account: ctx.instance.name || "YouTube", accountKey: ctx.instance.key, metric, label: ctx.t(`stat_${metric}`),
      ...(error ? {} : { value: r.stats[metric] }), asOf: new Date(r.at).toISOString(), url: `https://www.youtube.com/channel/${channelId}`, ...(error ? { error } : {}),
    };
  }).filter(Boolean);
}
const CONFIG_REASONS = { key: "err_config_key", connector: "err_config_connector", channel: "err_config_channel" };
/** Le message de l'état d'un chiffre, pour la personne qui gère le site : ce qui se passe et quoi faire. */
const whyNot = (ctx, item, r) => ctx.t(item.error === "config" ? CONFIG_REASONS[r.reason] ?? CONFIG_REASONS.channel : `err_${item.error}`);

export default {
  async adminPanel(ctx) {
    const blocks = [];
    const provider = await hasProvider(ctx);
    const { pending } = provider ? await handOverKey(ctx) : { pending: !!(await Promise.resolve(ctx.legacy?.get("apiKey")).catch(() => null)) };
    if (!provider) {
      // Proposer d'installer un fournisseur du SERVICE (jamais un module nommé) : le cœur cherche lui-même dans le catalogue.
      blocks.push({ type: "suggestInstall", service: API, min: 1, reason: ctx.t("suggest_reason") });
      if (pending) blocks.push({ type: "banner", tone: "info", text: ctx.t("key_waiting") });
    }
    if (ctx.setting("trackStats") !== true) return blocks;
    const channelId = channelOf(ctx);
    if (!CHANNEL_RE.test(channelId)) return [...blocks, { type: "banner", tone: "warning", text: ctx.t("err_config_channel") }];
    const r = await channelStats(ctx, channelId, { priority: "interactive" });
    const rows = statItems(ctx, r).map((i) => [i.label, i.error ? whyNot(ctx, i, r) : i.value.toLocaleString(ctx.locale)]);
    return [...blocks, { type: "heading", text: ctx.t("stats_title") }, { type: "table", columns: [ctx.t("col_stat"), ctx.t("col_value")], rows }, { type: "markdown", text: ctx.t("stats_note") }];
  },
  migrations: {
    // 2 : la clé YouTube quitte ce module (réglage hérité `apiKey`) pour le fournisseur de `youtube.api`. Rejouable : sans clé, ou déjà remise, rien à faire ;
    // pas de fournisseur ou pas prêt : la clé reste (masquée) et la reprise est retentée à l'ouverture du panneau. Ne fait jamais échouer la mise à jour.
    2: async (ctx) => { await handOverKey(ctx); },
  },
  sections: {
    async featured(ctx) {
      const maxAge = Math.min(3650, Math.max(1, Number(ctx.setting("maxAgeDays")) || 30));
      const includeShorts = ctx.setting("includeShorts") === true;
      const candidates = rank(await listVideos(ctx, channelOf(ctx)), maxAge).slice(0, 5);
      const flags = includeShorts ? new Map() : await shortFlags(ctx, candidates);
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

  services: {
    /**
     * Le direct EN COURS de la chaîne (service `youtube.live`, méthode `current`, depuis la 1.4.0) : { ok: true, live: false, channelId, at }
     * ou { ok: true, live: true, videoId, title, chatId (ou null : direct sans chat), startedAt, channelId, at, cost } ou { ok: false, error }.
     * Deux unités de limite YouTube par vérification, gardée 45 s ; `args.fresh` la refait. Rien ne tourne en arrière-plan : seul l'appelant décide quand demander.
     */
    "youtube.live": {
      async current(ctx, args) {
        return live.readLive((method, a) => youtube(ctx, method, a), channelOf(ctx), { fresh: args?.fresh === true });
      },
    },
    /**
     * Les vidéos et directs PROGRAMMÉS de la chaîne, pour les modules qui annoncent des événements (contrat commun `event.source`, méthode `upcoming`) :
     * { ok: true, source: { kind: "youtube", label }, state: "ok" | "setup" | "down", message?, note?, events: [{ id, title, start (UTC), type, url, image }] }.
     * Public seulement : une vidéo privée programmée n'est pas visible avec la clé du site (le texte `note` le dit). Sans clé ni connecteur, `state: "setup"` et une phrase qui dit quoi faire.
     */
    "event.source": {
      async upcoming(ctx, args) {
        return events.upcomingAnswer({ call: (method, a) => youtube(ctx, method, a), channelId: channelOf(ctx), t: (k) => ctx.t(k), limit: args?.limit });
      },
    },
  },

  exports: {
    /** Le bouton de la chaîne pour le cœur (en-tête) : rien tant que l'identifiant de chaîne n'est pas réglé. */
    "social.link"(ctx) {
      const id = String(ctx.setting("channelId") ?? "").trim();
      return CHANNEL_RE.test(id) ? [{ label: "YouTube", url: `https://www.youtube.com/channel/${id}`, icon: "youtube" }] : [];
    },
    // Les Shorts ne s'annoncent pas comme des vidéos : ils ne sont pas proposés.
    async "feed.item"(ctx, { limit: n }) {
      return (await longVideos(ctx, n ?? 20)).map((v) => ({ id: `yt:${v.id}`, title: v.title, url: watchUrl(v.id), publishedAt: v.publishedAt, topics: ["video"] }));
    },
    /** Abonnés, vidéos et vues pour « social.stat ». Jamais de valeur inventée ni périmée : `error` et pas de `value`. Désactivé (rien) tant que « Suivre mes statistiques » n'est pas coché. */
    async "social.stat"(ctx, args) {
      if (ctx.setting("trackStats") !== true) return [];
      const channelId = channelOf(ctx);
      if (!CHANNEL_RE.test(channelId)) return [];
      const items = statItems(ctx, await channelStats(ctx, channelId));
      return Number.isInteger(args?.limit) && args.limit > 0 ? items.slice(0, args.limit) : items;
    },
    async "maze.poster"(ctx, { limit: n }) {
      return (await longVideos(ctx, n ?? 10)).map((v) => ({ title: v.title, url: watchUrl(v.id), image: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, kind: "video" }));
    },
  },
};
