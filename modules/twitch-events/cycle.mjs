// One pass of the watch (the scheduled task, the "Check now" button, a revocation): bring the subscriptions in line, find out if there was a gap and, if so, catch up on what
// Twitch lets us read afterwards, then take the health of the listening (and warn the owner when it is time).
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const st = await import(`./state.mjs${v}`);
const L = await import(`./listen.mjs${v}`);
const cu = await import(`./catchup.mjs${v}`);
const health = await import(`./health.mjs${v}`);

/** { code, types, caught?: { follows, subs } }. */
export async function check(ctx, s, { now = Date.now(), renew = false, settle = false } = {}) {
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
