// Statistiques de la communauté — les outils pour les assistants (MCP). Aucun secret, aucune adresse privée n'en sort.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins
const { METRICS, fail, clean, platformSlug } = await import(`./model.mjs${v}`);
const { loadStats, readPoints, readRun } = await import(`./stats.mjs${v}`);
const { changesOf } = await import(`./evolution.mjs${v}`);
const { setManual } = await import(`./manual.mjs${v}`);

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const change = (c) => (c ? { from: c.from, to: c.to, delta: c.delta, percent: c.percent } : null);
const int = (x, min, max, dflt) => { const n = Math.trunc(Number(x)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt; };

/** Statut lisible par une IA : ok (chiffre à jour), no_data (le réseau ne donne pas le chiffre en ce moment : voir `problem`), not_shared_anymore (le module ne le transmet plus). */
function statusOf(stat) {
  if (stat.source === "manual") return "manual";
  return stat.state === "error" ? "no_data" : stat.state === "missing" ? "not_shared_anymore" : "ok";
}

async function describe(ctx, stat, now) {
  const { week, month } = await changesOf(ctx, stat);
  return {
    id: stat.id, platform: stat.platform, account: stat.account, metric: stat.metric, label: stat.label,
    value: stat.lastValue ?? null, unit: UNITS[stat.metric] ?? null,
    origin: stat.source === "manual" ? "manual" : "automatic",
    status: statusOf(stat),
    ...(stat.state === "error" ? { problem: stat.error } : {}),
    lastValueAt: iso(stat.lastAt),
    ageHours: stat.lastAt == null ? null : Math.max(0, Math.round((now - stat.lastAt) / 360_000) / 10),
    change7d: change(week), change30d: change(month),
    shownOnSite: stat.visible === true,
  };
}

const UNITS = { followers: "people", paying: "people", content: "posts", views: "views" };

/** Pourquoi la liste est vide, et quoi faire : jamais une liste vide muette. `all` = toutes les statistiques connues (avant filtre). */
async function emptyNote(ctx, args, platform) {
  const all = await loadStats(ctx);
  if (all.length) {
    const platforms = [...new Set(all.map((s) => s.platform))].sort();
    const metrics = METRICS.filter((m) => all.some((s) => s.metric === m));
    return `No statistic matches this filter${platform ? ` (platform "${platform}")` : ""}${args?.metric ? ` (metric "${args.metric}")` : ""}. Statistics exist for platforms: ${platforms.join(", ")}; kinds of figure: ${metrics.join(", ")}. Call again without a filter or with one of these values.`;
  }
  const run = (await readRun(ctx)).data;
  if (!run.lastRunAt) return "No reading yet: the site has not taken any reading since the module was installed (it is taken automatically within about 15 minutes, then once per chosen period). Ask the owner to open 'Statistiques de la communauté' in the admin and click 'Mettre à jour maintenant' (Update now), then ask again. Figures typed by hand can also be recorded with stats_set_manual.";
  return `A reading was taken ${new Date(run.lastRunAt).toISOString()} but no network shares figures: the owner must open the module of each network (Twitch, YouTube, Bluesky, Mastodon, GitHub, Discord, Reddit…) and tick 'Suivre mes statistiques' (Follow my statistics), then click 'Mettre à jour maintenant' (Update now) in 'Statistiques de la communauté'. For Instagram, TikTok, X or Facebook, record the figure by hand with stats_set_manual (ask the owner for it).`;
}

export default {
  mcp: {
    async community_stats_list(ctx, args) {
      const now = Date.now();
      const platform = args?.platform ? platformSlug(clean(args.platform, 31) ?? "") : null;
      const stats = (await loadStats(ctx))
        .filter((s) => (!platform || s.platform === platform) && (!args?.metric || s.metric === args.metric))
        .sort((a, b) => a.platform.localeCompare(b.platform) || a.account.localeCompare(b.account) || METRICS.indexOf(a.metric) - METRICS.indexOf(b.metric));
      const out = [];
      for (const s of stats) out.push(await describe(ctx, s, now));
      const note = out.length ? undefined : await emptyNote(ctx, args, platform);
      return { count: out.length, ...(note ? { note } : {}), metrics: { followers: "free audience", paying: "paying audience (paid subscribers, members, patrons)", content: "number of posts/videos", views: "cumulative views" }, stats: out };
    },

    async community_stats_history(ctx, args) {
      const now = Date.now();
      const stat = typeof args?.id === "string" ? (await loadStats(ctx)).find((s) => s.id === args.id) : null;
      if (!stat) throw fail("unknown statistic id: take it from community_stats_list");
      const days = int(args?.days, 1, 1830, 90), limit = int(args?.limit, 2, 500, 200);
      const since = Math.floor(now / 1000) - days * 86400;
      const points = (await readPoints(ctx, stat, since)).filter((p) => p[0] >= since);
      let kept = points, thinned = false;
      if (points.length > limit) { thinned = true; kept = Array.from({ length: limit }, (_, i) => points[Math.round((i * (points.length - 1)) / (limit - 1))]); } // régulièrement espacés, premier et dernier gardés
      return {
        id: stat.id, platform: stat.platform, account: stat.account, metric: stat.metric, days, totalPoints: points.length, thinned,
        points: kept.map((p) => ({ at: new Date(p[0] * 1000).toISOString(), value: p[1], origin: p[2] === "m" ? "manual" : "automatic", ...(p[2] === "m" && p[3] ? { by: p[3] } : {}) })),
      };
    },

    async stats_set_manual(ctx, args, actor) {
      const stat = await setManual(ctx, args, { now: Date.now(), by: clean(actor?.name, 60) ?? "assistant" });
      return { id: stat.id, platform: stat.platform, account: stat.account, metric: stat.metric, value: stat.lastValue, recordedAt: iso(stat.lastAt), origin: "manual", shownOnSite: stat.visible === true };
    },
  },
};
