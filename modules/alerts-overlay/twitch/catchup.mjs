// Catch-up after a gap (the site was down, an update took long, Twitch cut a subscription, the connection had expired): ask Twitch what we may have missed and add it to the
// journal, flagged "possibly missed" (`missed`), never twice. Only what Twitch lets us read afterwards:
//   - followers: `GET channels/followers` lists the newest followers with their date (scope moderator:read:followers): exact;
//   - subscribers: `GET subscriptions` lists who subscribes NOW, without a date (scope channel:read:subscriptions): we compare with the names we already know (the baseline kept in
//     the state, fed by every sub we received), so a new name is a sub we did not see; its date is the moment we noticed. Bounded: 1000 subscribers at most, else skipped.
// Gifts, bits, raids, hype trains and stream start/end cannot be read afterwards: they are lost for good if missed (said in the README). NOT VERIFIED against a live Twitch:
// the exact fields of these two answers (read in the Twitch reference: user_id, user_login, user_name, followed_at; user_login, tier, is_gift).
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const es = await import(`./eventsub.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const { twitch } = await import(`./listen.mjs${v}`);

export const LIMITS = { gapMs: 7 * 60_000, lines: 50, followPages: 3, subPages: 10, subsMax: 1000, baselineMax: 3000 };
const clean = es.clean;
const near = (lines, kind, login, at, ms) => lines.some((l) => l.kind === kind && String(l.login ?? "").toLowerCase() === login && Math.abs((l.at ?? 0) - at) <= ms);

/** Followers newer than `since` that the journal does not have (same login within 10 s). Returns the number added. */
async function followers(ctx, d, since, now) {
  if (!d.enabled.follow || (d.missing ?? []).includes("moderator:read:followers") || !d.main?.scopes?.includes("moderator:read:followers")) return { added: 0, skipped: "scope" };
  const lines = await st.recent(ctx, 300);
  let after, added = 0;
  for (let page = 0; page < LIMITS.followPages; page++) {
    const r = await twitch(ctx, d.channel, { as: "user", slot: "main", method: "GET", path: "channels/followers", query: { broadcaster_id: d.broadcasterId, first: 100, ...(after ? { after } : {}) } });
    if (!r.ok || r.status !== 200) return { added, skipped: "twitch" };
    const rows = Array.isArray(r.json?.data) ? r.json.data : [];
    let older = false;
    for (const row of rows) {
      const at = Date.parse(row?.followed_at ?? "");
      if (!Number.isFinite(at)) continue;
      if (at < since) { older = true; continue; }
      const ev = es.normalise("channel.follow", { user_name: row.user_name, user_login: row.user_login, followed_at: row.followed_at }, new Date(now).toISOString());
      if (!ev || near(lines, "follow", ev.login, at, 10_000)) continue;
      if (added >= LIMITS.lines) break;
      const res = await st.record(ctx, `catchup-follow-${String(row.user_id ?? ev.login).slice(0, 30)}-${at}`, ev, { source: "catchup", missed: true, now });
      if (res.stored) added++;
    }
    after = r.json?.pagination?.cursor;
    if (older || !after || added >= LIMITS.lines) break;
  }
  return { added };
}

/** Subscribers we did not know: names now minus the baseline. The first run only learns the baseline (nothing is invented). */
async function subscribers(ctx, d, now) {
  if (!d.enabled.sub || !d.main?.scopes?.includes("channel:read:subscriptions")) return { added: 0, skipped: "scope" };
  const names = [], rows = [];
  let after;
  for (let page = 0; page < LIMITS.subPages; page++) {
    const r = await twitch(ctx, d.channel, { as: "user", slot: "main", method: "GET", path: "subscriptions", query: { broadcaster_id: d.broadcasterId, first: 100, ...(after ? { after } : {}) } });
    if (!r.ok || r.status !== 200) return { added: 0, skipped: "twitch" };
    for (const row of Array.isArray(r.json?.data) ? r.json.data : []) { const login = clean(row?.user_login, 40).toLowerCase(); if (login) { names.push(login); rows.push({ login, name: clean(row.user_name, 60) || login, tier: es.normalise("channel.subscribe", { user_name: "x", tier: row.tier }, "")?.tier ?? null, gifted: row.is_gift === true }); } }
    after = r.json?.pagination?.cursor;
    if (!after) break;
    if (names.length > LIMITS.subsMax) return { added: 0, skipped: "big" };
  }
  const state = await st.readState(ctx);
  const known = new Set(Array.isArray(state.subLogins) ? state.subLogins : []);
  const baseline = known.size > 0;
  const lines = await st.recent(ctx, 300);
  let added = 0;
  if (baseline) {
    for (const row of rows) {
      if (known.has(row.login) || near(lines, "sub", row.login, now, 3 * 86_400_000) || near(lines, "resub", row.login, now, 3 * 86_400_000) || added >= LIMITS.lines) continue;
      const ev = { kind: "sub", name: row.name, login: row.login, tier: row.tier, ...(row.gifted ? { gifted: true } : {}), at: now };
      const res = await st.record(ctx, `catchup-sub-${row.login}-${Math.floor(now / 3_600_000)}`, ev, { source: "catchup", missed: true, now });
      if (res.stored) added++;
    }
  }
  await st.updateState(ctx, (x) => { x.subLogins = [...new Set(names)].slice(-LIMITS.baselineMax); x.subLoginsAt = now; });
  return { added, learned: !baseline };
}

/**
 * Looks for what was missed since `since` and notes the outcome in the state (`catchup`). Never throws. `d`: a "ready" diagnosis (see listen.mjs).
 */
export async function catchUp(ctx, d, { since, now = Date.now() }) {
  const out = { at: now, since, follows: 0, subs: 0, skipped: [] };
  try {
    const f = await followers(ctx, d, since, now); out.follows = f.added; if (f.skipped) out.skipped.push(`follow:${f.skipped}`);
    const s = await subscribers(ctx, d, now); out.subs = s.added; if (s.skipped) out.skipped.push(`sub:${s.skipped}`);
  } catch (e) { out.skipped.push("error"); }
  await st.updateState(ctx, (x) => { x.catchup = out; }).catch(() => {});
  return out;
}

/** A sub that arrived by the webhook joins the baseline (so a later catch-up does not announce it as missed). */
export function learnSub(ctx, login) {
  const l = clean(login, 40).toLowerCase();
  if (!l) return Promise.resolve();
  return st.updateState(ctx, (x) => { const a = Array.isArray(x.subLogins) ? x.subLogins : []; if (!a.includes(l)) x.subLogins = [...a, l].slice(-LIMITS.baselineMax); });
}

/** Learns who subscribes now, once (the baseline a later catch-up compares with). Invents nothing. */
export async function learnBaseline(ctx, d, now = Date.now()) {
  try { return await subscribers(ctx, d, now); } catch { return { added: 0 }; }
}
