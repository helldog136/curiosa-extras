// « Mes directs » : le panneau d'administration et les outils des assistants (MCP, lecture seule) qui lisent ce que l'enregistreur (live.mjs) et les listes de vidéos (helix.mjs, via l'enregistreur) ont gardé.
// Aucun secret n'en sort : ni jeton, ni identifiant d'application, ni adresse privée.
const version = new URL(import.meta.url).search;
const live = await import(new URL(`./live.mjs${version}`, import.meta.url).href);

const DAY = 86_400_000;
const int = (x, min, max, dflt) => { const n = Math.trunc(Number(x)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt; };
const iso = (ms) => new Date(ms).toISOString();
const round1 = (n) => Math.round(n * 10) / 10;
const minutes = (sec) => Math.round(sec / 60);

/* ───────────── Outils MCP ───────────── */

const trackingNote = async (ctx) => {
  if (ctx.setting("trackStats") !== true) return "Stream tracking is switched off: the owner must tick 'Suivre mes statistiques' (Follow my statistics) in this Twitch channel module. Nothing is measured until then.";
  const since = await live.trackingSince(ctx);
  return since ? `Tracking active since ${iso(since)}. The site measures by itself while the channel is live; Twitch gives no history, so nothing exists before that date.` : "Tracking has just been switched on and has not taken its first reading yet; try again in a few minutes.";
};
const emptyNote = async (ctx, what, from) => {
  const since = await live.trackingSince(ctx);
  if (ctx.setting("trackStats") !== true || !since) return `${what}: none. ${await trackingNote(ctx)}`;
  return `${what}: none measured since ${iso(Math.max(from, since))}. The tracking measures from its activation (${iso(since)}) and only while the channel is live.`;
};
const periodFrom = (args, dflt) => {
  const t = typeof args?.since === "string" ? Date.parse(args.since) : NaN;
  const days = int(args?.days, 1, 3650, dflt);
  return Number.isFinite(t) ? { from: t, days: Math.max(1, Math.round((Date.now() - t) / DAY)) } : { from: Date.now() - days * DAY, days };
};

const streamOut = (s) => ({
  startedAt: s.startedAt, endedAt: s.endedAt, ongoing: s.open, durationMinutes: minutes(s.durationSec), peakViewers: s.peakViewers, averageViewers: s.avgViewers, viewerHours: s.hoursWatched,
  followersGained: s.followersGained, approximate: s.approximate, ...(s.approximate ? { approximateBecause: s.approxReasons } : {}), title: s.title, language: s.language,
  games: s.segments.map((g) => ({ game: g.game, startedAt: g.startedAt, endedAt: g.endedAt, durationMinutes: minutes(g.durationSec), averageViewers: g.avgViewers, peakViewers: g.peakViewers, viewerHours: g.hoursWatched, followersGained: g.followersGained, followersPerHour: g.followersPerHour })),
});
const gameOut = (g) => ({ game: g.game, streams: g.streams, hoursLive: g.hoursLive, averageViewers: g.avgViewers, peakViewers: g.peakViewers, viewerHours: g.hoursWatched, followersGained: g.followersGained, followersPerHour: g.followersPerHour });
const SORTS = { followers_per_hour: (g) => g.followersPerHour, hours_live: (g) => g.hoursLive, viewer_hours: (g) => g.hoursWatched, peak_viewers: (g) => g.peakViewers, average_viewers: (g) => g.avgViewers, streams: (g) => g.streams };

export const tools = (credentialsOf) => ({
  async twitch_streams(ctx, args) {
    const { from, days } = periodFrom(args, 30), limit = int(args?.limit, 1, 100, 20);
    const { sessions, truncated } = await live.listSessions(ctx, { since: from, limit });
    return { channel: (await credentialsOf(ctx)).channel || null, period: { from: iso(from), days }, count: sessions.length, truncated, ...(sessions.length ? {} : { note: await emptyNote(ctx, "Streams", from) }),
      units: "durations in minutes, viewerHours = sum of viewers x hours (hours watched by the audience), followers = net change during the stream (null when the channel is not connected)", streams: sessions.map(streamOut) };
  },

  async twitch_games(ctx, args) {
    const { from, days } = periodFrom(args, 90), limit = int(args?.limit, 1, 100, 20);
    const sort = Object.hasOwn(SORTS, args?.sort) ? args.sort : "followers_per_hour";
    const { sessions, truncated } = await live.listSessions(ctx, { since: from, limit: 600 });
    const key = SORTS[sort];
    const games = live.gamesOf(sessions).sort((a, b) => (key(b) ?? -1) - (key(a) ?? -1) || b.hoursLive - a.hoursLive).slice(0, limit);
    return { channel: (await credentialsOf(ctx)).channel || null, period: { from: iso(from), days }, sort, count: games.length, truncated, ...(games.length ? {} : { note: await emptyNote(ctx, "Games", from) }),
      note2: "followersPerHour is null for a game with less than 1 hour of live time with known followers (not enough to compare) or when the channel is not connected. Followers are the net change (unfollows count).", games: games.map(gameOut) };
  },

  async twitch_videos(ctx, args) {
    const creds = await credentialsOf(ctx);
    const type = ["all", "archive", "highlight", "upload", "clip"].includes(args?.type) ? args.type : "all";
    const sort = ["views", "date", "duration"].includes(args?.sort) ? args.sort : "views";
    const { from, days } = periodFrom(args, 3650), limit = int(args?.limit, 1, 100, 20);
    const lists = await live.readLists(ctx);
    const r = (type === "clip" ? lists?.clips : lists?.videos) ?? { items: [], at: null, error: lists ? null : "pending" };
    const items = r.items.filter((x) => (type === "all" || type === "clip" || x.type === type) && Date.parse(x.publishedAt) >= from);
    const by = { views: (a, b) => b.views - a.views, date: (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt), duration: (a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0) };
    const kept = items.sort(by[sort]).slice(0, limit);
    return { channel: creds.channel || null, type, sort, period: { from: iso(from), days }, count: kept.length, viewsAsOf: r.at ? iso(r.at) : null, ...(r.error === "pending" ? { note: await trackingNote(ctx) + " The video list is read a few minutes after tracking starts." } : r.error ? { problem: r.error, note: r.at ? "Twitch did not answer just now: these are the last known figures, dated by viewsAsOf." : "Twitch did not answer and no figure is known yet; try again later." } : {}),
      ...(!kept.length && !r.error ? { note: type === "clip" ? "No clip found for this channel in this period." : "No video found for this channel in this period (Twitch only keeps replays for a limited time unless they are highlights or uploads)." } : {}),
      videos: kept.map((x) => ({ title: x.title, publishedAt: x.publishedAt, ...(type === "clip" ? { game: x.game } : { type: x.type }), durationMinutes: x.durationSec == null ? null : round1(x.durationSec / 60), views: x.views, url: x.url })) };
  },
});

/* ───────────── Panneau « Mes directs » ───────────── */

const num = (ctx, n) => new Intl.NumberFormat(ctx.locale || "en", { maximumFractionDigits: 1 }).format(n);
const when = (ctx, ms) => new Intl.DateTimeFormat(ctx.locale || "en", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
const day = (ctx, ms) => new Intl.DateTimeFormat(ctx.locale || "en", { day: "numeric", month: "long", year: "numeric" }).format(new Date(ms));
const shortDay = (ctx, ms) => new Intl.DateTimeFormat(ctx.locale || "en", { day: "numeric", month: "short", year: "numeric" }).format(new Date(ms));
const duration = (ctx, sec) => { const m = Math.round(sec / 60), h = Math.floor(m / 60); return h ? ctx.t("dur_hm", { h, m: String(m % 60).padStart(2, "0") }) : ctx.t("dur_m", { m }); };
const gameName = (ctx, g) => g ?? ctx.t("live_noGame");
const signed = (ctx, n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${num(ctx, Math.abs(n))}`;

function sessionRow(ctx, s) {
  const games = [...new Set(s.segments.map((g) => gameName(ctx, g.game)))].join(", ");
  const head = `${when(ctx, Date.parse(s.startedAt))} · ${duration(ctx, s.durationSec)}${s.open ? ` · ${ctx.t("live_ongoing")}` : ""}`;
  const lines = [ctx.t("live_resAvg", { avg: num(ctx, Math.round(s.avgViewers)), peak: num(ctx, s.peakViewers) }), ctx.t("live_resWatched", { hours: num(ctx, s.hoursWatched) })];
  if (s.followersGained != null) lines.push(ctx.t("live_resFollowers", { n: signed(ctx, s.followersGained) }));
  if (s.approximate) lines.push(ctx.t("live_resApprox"));
  return [`${head}\n${games}`, lines.join("\n")];
}

export async function panel(ctx, creds, connected) {
  const t = ctx.t;
  const out = [{ type: "heading", text: t("live_title") }];
  const st = await live.trackingState(ctx);
  const every = live.intervalOf(ctx);
  out.push({ type: "markdown", text: t("live_honest", { minutes: every }) });
  if (st.since) out.push({ type: "banner", tone: "info", text: t("live_since", { date: day(ctx, st.since) }) });
  else out.push({ type: "banner", tone: "info", text: t("live_starting") });
  if (st.lastError && st.lastError.at > (st.lastOkAt ?? 0)) out.push({ type: "banner", tone: "warning", text: t("live_trouble") });

  const { sessions } = await live.listSessions(ctx, { limit: 8 });
  const now = sessions.find((s) => s.open);
  if (now) out.push({ type: "banner", tone: "success", text: t("live_now", { viewers: num(ctx, now.currentViewers), duration: duration(ctx, now.durationSec) }) });
  if (!sessions.length) out.push({ type: "markdown", text: t("live_none") });
  else out.push({ type: "table", columns: [t("col_live"), t("col_result")], rows: sessions.map((s) => sessionRow(ctx, s)) });

  out.push({ type: "heading", text: t("live_bestTitle") });
  const recent = (await live.listSessions(ctx, { since: Date.now() - 90 * DAY, limit: 600 })).sessions;
  const games = live.gamesOf(recent).filter((g) => g.followersPerHour != null).sort((a, b) => b.followersPerHour - a.followersPerHour).slice(0, 4);
  if (games.length) out.push({ type: "table", columns: [t("col_game"), t("col_result")], rows: games.map((g) => [gameName(ctx, g.game), `${t("live_bestRate", { rate: signed(ctx, g.followersPerHour) })}\n${t("live_bestHours", { hours: num(ctx, g.hoursLive) })}`]) });
  else out.push({ type: "markdown", text: t(connected ? "live_bestNone" : "live_needConnect") });

  out.push({ type: "heading", text: t("live_videosTitle") });
  const lists = await live.readLists(ctx);
  const vids = lists?.videos ?? { items: [], error: null };
  const top = [...vids.items].sort((a, b) => b.views - a.views).slice(0, 8);
  if (top.length) out.push({ type: "table", columns: [t("col_video"), t("col_views")], rows: top.map((v) => [`${v.title || "—"}\n${t(`type_${v.type}`)} · ${shortDay(ctx, Date.parse(v.publishedAt))}`, t("live_views", { n: num(ctx, v.views) })]) });
  else out.push({ type: "markdown", text: t(!lists ? "live_videosPending" : vids.error ? "live_videosError" : "live_videosNone") });
  if (top.length && vids.error) out.push({ type: "markdown", text: t("live_videosStale") });
  const clips = (lists?.clips?.items ?? []).slice(0, 5);
  if (clips.length) out.push({ type: "table", columns: [t("col_clip"), t("col_views")], rows: clips.map((c) => [`${c.title || "—"}\n${[c.game, shortDay(ctx, Date.parse(c.publishedAt))].filter(Boolean).join(" · ")}`, t("live_views", { n: num(ctx, c.views) })]) });

  const kept = await ctx.api.store.count(live.COLLECTIONS.sessions);
  out.push({ type: "heading", text: t("live_eraseTitle") });
  out.push({ type: "markdown", text: t("live_eraseInfo", { n: kept, days: live.rawDaysOf(ctx), years: live.keepYearsOf(ctx) }) });
  out.push({ type: "table", columns: [t("live_eraseCol")], rows: [[t("live_eraseRow", { n: kept })]], rowIds: ["live"], rowActions: [{ label: t("live_erase"), action: "eraseLive", confirm: t("live_eraseConfirm"), danger: true }] });
  return out;
}
