// Stream goals: the tools of the AI assistant. Reading is on by default; every tool that changes something is OFF until the owner switches it on.
// The target, the metric, the start and the rules are settings: the assistant changes them with the core's maintenance_module_configure, like any setting.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const S = await import(new URL(`./store.mjs${v}`, import.meta.url).href);
const A = await import(new URL(`./admin.mjs${v}`, import.meta.url).href);

class Exposed extends Error { constructor(m) { super(m); this.expose = true; } }
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

async function goalInfo(ctx) {
  const g = await S.goalNow(ctx);
  const [events, figures] = await Promise.all([S.hasSource(ctx, "events"), S.hasSource(ctx, "figures")]);
  return {
    metric: g.metric, value: g.value, target: g.target, start: g.min, reached: g.value >= g.target, targetIsAutomatic: g.settings.target === null,
    reference: g.base ? { value: g.base.value, asOf: iso(g.base.asOf), from: g.base.source } : null,
    countedSinceReference: g.base ? g.ledger.filter((r) => r.at > g.base.asOf).length : g.ledger.length,
    sources: { twitchEvents: events, channelFigures: figures }, summary: A.goalLine(ctx, g),
  };
}
async function subathonInfo(ctx) {
  const x = await S.subathonNow(ctx);
  const f = x.fold;
  return {
    start: iso(x.startAt), started: f.started, ended: f.ended, paused: f.pausedAt !== null, remainingSeconds: f.remainingS, addedSeconds: f.addedS,
    endsAt: f.started && f.pausedAt === null ? iso(f.endsAt) : null, cappedSeconds: f.capped,
    rules: { startLengthSeconds: x.rules.lengthS, capSeconds: x.rules.capS, secondsPerSub: x.rules.perSubS, secondsPerHundredBits: x.rules.perHundredBitsS, secondsPerFollow: x.rules.perFollowS, tierFactors: { 1: 1, 2: 2, 3: 5 } },
    summary: A.subathonLine(ctx, x),
  };
}

export default {
  async goal_get(ctx) { await S.sync(ctx, { force: true }); return goalInfo(ctx); },
  async goal_set(ctx, args) {
    const n = Math.round(Number(args?.value));
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) throw new Exposed("value: a whole number from 0 to 1000000000, for example 120.");
    await S.setValue(ctx, n);
    return goalInfo(ctx);
  },
  async goal_test(ctx, args) {
    const which = args?.gauge === "subathon" ? "subathon" : "goal";
    const r = await S.rehearse(ctx, which);
    return { ok: true, gauge: which, shown: r.amount, note: "A rehearsal on the overlay pages: nothing is counted, the value goes back after 8 seconds." };
  },
  async subathon_get(ctx) { await S.sync(ctx, { force: true }); return subathonInfo(ctx); },
  async subathon_add_time(ctx, args) {
    const m = Math.round(Number(args?.minutes));
    if (!Number.isFinite(m) || m === 0 || Math.abs(m) > 600) throw new Exposed("minutes: a whole number from -600 to 600, not 0, for example 5.");
    const x = await S.subathonNow(ctx);
    if (!Number.isFinite(x.startAt)) throw new Exposed("The subathon has no start yet: set the setting subathonStart first.");
    await S.addTime(ctx, m * 60);
    return subathonInfo(ctx);
  },
  async subathon_pause(ctx, args) {
    if (typeof args?.paused !== "boolean") throw new Exposed("paused: true to pause, false to resume.");
    await S.setPaused(ctx, args.paused);
    return subathonInfo(ctx);
  },
};
