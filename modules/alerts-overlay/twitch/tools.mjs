// (1.18.0: tools of the alerts overlay, formerly of Twitch activity; same names, inputs and answers.) Tools for assistants (MCP): read the journal, read the health of the listening, replay a line or send a test. Replaying is the only write, bounded and never switched on by default.
// Never a deletion, never a secret, never a token. Everything returned is public data (display names, amounts).
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const es = await import(`./eventsub.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const pub = await import(`./publish.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const { diagnose } = await import(`./listen.mjs${v}`);
const rw = await import(`./rewards.mjs${v}`);

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
    return {
      listening: d.code === "ready" ? state.listen?.code ?? "unknown" : d.code,
      listeningSince: state.listen?.since ? new Date(state.listen.since).toISOString() : null,
      missingTwitchPermissions: d.missing ?? [],
      lastEventAt: state.lastEventAt ? new Date(state.lastEventAt).toISOString() : null,
      types: es.TYPES.map((t) => ({ type: t.id, enabled: enabled[t.id] === true, alert: enabled[t.id] === true, state: state.types?.[t.id]?.code ?? "unknown", lastEventAt: Math.max(0, ...t.kinds.map((k) => state.last?.[k] ?? 0)) || null })).map((x) => ({ ...x, lastEventAt: x.lastEventAt ? new Date(x.lastEventAt).toISOString() : null })),
      health: { state: state.health?.code ?? "ok", since: state.health?.since ? new Date(state.health.since).toISOString() : null, warnedByMail: !!state.health?.notified, mailServer: state.health?.mail === "off" ? "not set up" : "ok or not needed" },
      lastCatchUp: state.catchup ? { at: new Date(state.catchup.at).toISOString(), addedFollows: state.catchup.follows, addedSubs: state.catchup.subs, skipped: state.catchup.skipped } : null,
      journalLines: await st.count(ctx), retentionDays: s.retentionDays, alertsOverlayInstalled: true,   // (1.18.0) the listening lives in the alerts overlay itself
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
  /** (1.12.0) The rewards of the channel and their reaction (read only; the reactions are set with the alerts overlay's reaction_set, type redeem + reward). */
  async twitch_events_rewards(ctx) {
    const list = await rw.list(ctx), c = await rw.creator(ctx);
    const reaction = (row) => ({ images: row.images ?? 0, videos: row.videos ?? 0, sound: row.sound === true, order: row.pick === "rotate" ? "round_robin" : row.pick ? "random" : null, ...(row.placed ? { filesWithPlacedText: row.placed } : {}) });
    return {
      readFromTwitch: list.twitch.ok, ...(list.twitch.ok ? {} : { whyNotFromTwitch: { scope: "the permission to read the rewards is missing (switch on Channel points in the Twitch events tab, then authorize)", na: "the channel has no channel points (not Affiliate nor Partner)", no_channel: "no Twitch channel is set up", twitch: "Twitch did not answer" }[list.twitch.code] ?? "unknown", note: "Only the rewards seen in the journal and those with a reaction are listed." }),
      alertsOverlay: list.overlay ? "ready" : "absent or too old (version 3 of its reactions needed)",
      rewards: list.items.map((it) => ({ id: it.id, title: it.title, cost: it.cost, ...(it.gone ? { deletedOnTwitch: true } : { enabledOnTwitch: it.enabled !== false, pausedOnTwitch: it.paused === true }), alert: it.row?.on ?? true, ownReaction: !!it.row?.own, ...(it.row?.own ? { reaction: reaction(it.row) } : {}) })),
      allOtherRewards: list.others ? { alert: list.others.on !== false, reaction: reaction(list.others) } : null,
      canCreateFromAdmin: c.can, ...(c.can ? {} : { whyNotCreate: c.code }),
    };
  },
};
