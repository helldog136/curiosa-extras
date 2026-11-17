// The public door: Twitch calls this address for each event. We first check that it really is Twitch (signature, age), store the event in the journal (durably, before answering),
// and answer fast: Twitch cuts a subscription whose site answers too slowly or with errors.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const es = await import(`./eventsub.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const cycle = await import(`./cycle.mjs${v}`);
const { learnSub } = await import(`./catchup.mjs${v}`);

export const LIMITS = { perMinute: 600, badPerMinute: 30 };
const reply = (status, body = null) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const noted = new Map();   // instance → last refusal written (at most one a minute: an attacker cannot make us write)
async function noteRejected(ctx, reason, now) {
  const k = ctx.instance.key;
  if ((noted.get(k) ?? 0) > now - 60_000) return;
  noted.set(k, now);
  await st.updateState(ctx, (d) => { d.rejected = { reason, at: now }; });
}

/**
 * Handles a request from Twitch. Returns { response, done }: `response` goes out at once, `done` is the promise of the follow-up work (tests wait for it; the server does not). Never throws.
 * Rate limits: 600 requests a minute in all, and 30 refused requests a minute (beyond that the signature is not even computed).
 */
export async function handle(request, ctx, { now = Date.now() } = {}) {
  const none = Promise.resolve();
  let marked = null;
  try {
    if (request.method !== "POST") return { response: reply(405, "Method not allowed"), done: none };
    if (!st.allow(ctx, "hits", { max: LIMITS.perMinute, windowMs: 60_000, now })) return { response: reply(429, "Too many requests"), done: none };
    const m = st.memoryOf(ctx);
    m.bad = (m.bad ?? []).filter((t) => now - t < 60_000);
    if (m.bad.length >= LIMITS.badPerMinute) return { response: reply(429, "Too many requests"), done: none };
    const raw = await request.text();
    if (raw.length > es.MAX_BODY) return { response: reply(413, "Too large"), done: none };
    const state = await st.readState(ctx);
    const v1 = es.verify({ secret: state.secret, headers: request.headers, rawBody: raw, now });
    if (!v1.ok) {
      m.bad.push(now);
      return { response: reply(v1.reason === "secret" ? 404 : 403, "Forbidden"), done: noteRejected(ctx, v1.reason, now).catch(() => {}) };
    }
    const body = es.parseBody(v1.type, raw);
    if (body.kind === "challenge") return { response: reply(200, body.challenge), done: st.updateState(ctx, (d) => { d.verifiedAt = now; }).catch(() => {}) };
    if (body.kind === "invalid") return { response: reply(400), done: none };
    if (body.kind === "ignored") return { response: reply(204), done: none };
    if (st.seenBefore(ctx, v1.id, now)) return { response: reply(204), done: none };   // Twitch delivers "at least once": the same message is handled once
    marked = v1.id;
    if (body.kind === "revocation") {
      const done = (async () => {
        await st.updateState(ctx, (d) => { d.revoked = { status: body.status, type: body.type, at: now }; });
        await cycle.check(ctx, settingsOf(ctx), { now }).catch(() => {});   // the authorisation may have come back meanwhile
      })().catch(() => {});
      return { response: reply(204), done };
    }
    // An event. It is stored BEFORE the answer (a local write): if the site stops right after, the event is in the journal, and if it stops before, Twitch has not been told "ok".
    const ev = es.normalise(body.subType, body.event, v1.timestamp);
    if (!ev) return { response: reply(204), done: none };
    const enabled = st.enabledOf(state);
    const group = es.groupOf(ev.kind);
    if (!group || enabled[group] !== true) return { response: reply(204), done: none };
    if (ev.kind === "hype_progress") {
      // A train sends many "progress" messages; only a new level is worth a line.
      const last = m.hype;
      if (last && last.level >= ev.level) return { response: reply(204), done: none };
      m.hype = { level: ev.level };
    } else if (ev.kind === "hype_begin") m.hype = { level: ev.level };
    else if (ev.kind === "hype_end") m.hype = null;
    const r = await st.record(ctx, v1.id, ev, { now });
    if (r.stored && ev.kind === "sub" && ev.login) learnSub(ctx, ev.login).catch(() => {});   // a sub we saw is not "new" for a later catch-up
    const done = r.stored ? st.updateState(ctx, (d) => { d.last = { ...(d.last ?? {}), [ev.kind]: ev.at }; d.lastEventAt = now; if (ev.kind === "online") d.liveSince = ev.at; if (ev.kind === "offline") d.liveSince = null; }).catch(() => {}) : none;
    return { response: reply(204), done };
  } catch (e) {
    if (marked) st.memoryOf(ctx).seen.delete(marked);   // not stored: Twitch will deliver it again, and it must not be taken for a duplicate
    console.error(`[twitch-events] ${ctx.instance.key}: webhook failed (${e?.message ?? e})`);
    // 503 + Retry-After rather than 500: a site that is restarting or being updated asks Twitch to try again soon (the message is stored once, whenever it comes)
    return { response: new Response("Unavailable", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "30" } }), done: none };
  }
}
