// Tools for assistants (MCP): read the journal, read the health of the listening, replay a line or send a test. Replaying is the only write, bounded and never switched on by default.
// Never a deletion, never a secret, never a token. Everything returned is public data (display names, amounts).
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const es = await import(`./eventsub.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const pub = await import(`./publish.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const { diagnose } = await import(`./listen.mjs${v}`);

const expose = (message) => Object.assign(new Error(message), { expose: true });
export default {
  async twitch_events_list(ctx, a = {}) {
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(a.limit)) || 20));
    const since = Number.isFinite(Number(a.sinceMinutes)) && Number(a.sinceMinutes) > 0 ? Date.now() - Number(a.sinceMinutes) * 60_000 : 0;
    const all = (await st.recent(ctx, 1000)).filter((d) => (!a.type || d.kind === a.type) && d.at >= since && !(a.includeTests !== true && d.source === "test"));
    return all.slice(0, limit).map(pub.toItem);
  },
  async twitch_events_status(ctx) {
    const state = await st.readState(ctx), s = settingsOf(ctx), enabled = st.enabledOf(state);
    const d = await diagnose(ctx, s, { declare: false });
    let alerts = [];
    try { alerts = await ctx.api.instances.list({ module: "alerts-overlay" }); } catch { alerts = []; }
    return {
      listening: d.code === "ready" ? state.listen?.code ?? "unknown" : d.code,
      listeningSince: state.listen?.since ? new Date(state.listen.since).toISOString() : null,
      missingTwitchPermissions: d.missing ?? [],
      lastEventAt: state.lastEventAt ? new Date(state.lastEventAt).toISOString() : null,
      types: es.TYPES.map((t) => ({ type: t.id, enabled: enabled[t.id] === true, state: enabled[t.id] ? state.types?.[t.id]?.code ?? "unknown" : "off", lastEventAt: Math.max(0, ...t.kinds.map((k) => state.last?.[k] ?? 0)) || null })).map((x) => ({ ...x, lastEventAt: x.lastEventAt ? new Date(x.lastEventAt).toISOString() : null })),
      journalLines: await st.count(ctx), retentionDays: s.retentionDays, alertsOverlayInstalled: alerts.length > 0,
    };
  },
  async twitch_event_replay(ctx, a = {}) {
    if (a.id) {
      const r = await pub.replay(ctx, String(a.id));
      if (!r.ok) throw expose(r.code === "rate" ? "Too many replays in a minute (10 at most). Wait a little." : "No such line in the journal. List the lines with twitch_events_list.");
      return { ok: true, replayId: r.id, ...(r.again ? { note: "Replayed a moment ago already: nothing sent twice." } : {}) };
    }
    if (a.testType) {
      const r = await pub.sendTest(ctx, String(a.testType));
      if (!r.ok) throw expose(r.code === "rate" ? "Too many tests in a minute." : "Unknown type.");
      return { ok: true, testIds: r.ids };
    }
    throw expose("Give either id (a line to replay) or testType (a sample to send).");
  },
};
