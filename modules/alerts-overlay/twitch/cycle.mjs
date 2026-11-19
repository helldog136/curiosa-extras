// One pass of the watch (the scheduled task, the "Check now" button, a revocation): bring the subscriptions in line, find out if there was a gap and, if so, catch up on what
// Twitch lets us read afterwards, then take the health of the listening (and warn the owner when it is time).
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const st = await import(`./state.mjs${v}`);
const L = await import(`./listen.mjs${v}`);
const cu = await import(`./catchup.mjs${v}`);
const health = await import(`./health.mjs${v}`);
const es = await import(`./eventsub.mjs${v}`);
const tw = await import(new URL(`../twitch.mjs${v}`, import.meta.url).href);

/**
 * (1.22) Listening is no longer tied to the alert switch of a type. The ONE alert switch of a type is the "Alert" switch of the overlay (its configuration, `on`); the stored `enabled`
 * of the state is its mirror: it says which permissions to ask for and which lines are recorded as "muted" (kept and counted, never played).
 * First pass after the update: a type that was switched off in the old "Received" list keeps its meaning (no alert) by switching its alert off. Then the mirror is kept in line.
 */
export async function syncAlertFlags(ctx) {
  const state = await st.readState(ctx);
  const cfg = await tw.loadConfig(ctx);
  let changed = false;
  if (!state.alertsMigrated) {
    for (const id of es.TYPE_IDS) {
      const stored = state.enabled?.[id];
      const wasOn = typeof stored === "boolean" ? stored : es.typeOf(id).default;
      if (!wasOn && cfg.types[id]?.on !== false) { cfg.types[id] = { ...cfg.types[id], on: false }; changed = true; }
    }
    if (changed) await tw.saveConfig(ctx, cfg);
  }
  const want = Object.fromEntries(es.TYPE_IDS.filter((id) => cfg.types[id]).map((id) => [id, cfg.types[id].on !== false]));
  const now = st.enabledOf(state);
  if (state.alertsMigrated && es.TYPE_IDS.every((id) => want[id] === undefined || now[id] === want[id])) return;
  await st.updateState(ctx, (x) => { x.enabled = { ...st.enabledOf(x), ...want }; x.alertsMigrated = true; });
}

/** { code, types, caught?: { follows, subs } }. */
export async function check(ctx, s, { now = Date.now(), renew = false, settle = false } = {}) {
  await syncAlertFlags(ctx).catch(() => {});
  const before = await st.readState(ctx);
  const r = await L.ensureListening(ctx, s, { renew, settle, now });
  const ok = r.code === "listening";
  // A gap: the passes did not run for a while (restart, update, outage), or the listening was in trouble. `okAt` = the last time everything was fine.
  let gapSince = before.gapSince ?? null;
  const idle = before.checkedAt && now - before.checkedAt > cu.LIMITS.gapMs;
  const trouble = !ok && r.code !== "pending";
  if (!gapSince && (idle || trouble) && before.okAt) gapSince = idle && !trouble ? before.checkedAt : before.okAt;
  let caught = null;
  if (ok && (gapSince || !before.subLogins)) {   // a quiet minute costs nothing more than the one list call
    const d = await L.diagnose(ctx, s, { declare: false }).catch(() => null);
    if (d?.code === "ready") {
      if (gapSince) { caught = await cu.catchUp(ctx, d, { since: gapSince - 60_000, now }); gapSince = null; }
      else if (!before.subLogins) await cu.learnBaseline(ctx, d, now);
    }
  }
  await st.updateState(ctx, (x) => { x.checkedAt = now; if (ok) x.okAt = now; if (gapSince) x.gapSince = gapSince; else delete x.gapSince; });
  const h = await health.run(ctx, s, now);
  return { ...r, ...(caught ? { caught } : {}), health: h.code };
}
