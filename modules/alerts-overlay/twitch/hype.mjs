// (1.20.0) The live state of a hype train, kept in the listening state (document `twitchListen`, key `hype`), overwritten at each message.
// The journal still gets one line per NEW level only (its size and retention do not change); the progress inside a level, the countdown (`expires_at`) and the
// last contributions live here, so the "Hype train" element can move at every contribution. Pure file: no ctx, no storage.

/** Longest list of recent messages kept (the element turns them into highlights; the engine keeps 40 at most). */
export const HYPE_EVENTS = 20;
/** A train with no message for this long after its countdown is over is treated as ended (a lost "end" message never leaves a train on screen). */
export const STALE_MS = 15_000;
/** Without a countdown from Twitch (an older line), a train is considered over this long after its last message. */
export const NO_TIMER_MS = 5 * 60_000;

const int = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined);

/**
 * The next state after one normalised hype event (`hype_begin`, `hype_progress`, `hype_end`). `id` is the Twitch message id (it becomes the highlight id),
 * `receivedAt` the server time of arrival. A message already seen (same id) changes nothing. Returns a NEW object; `prev` is not changed.
 */
export function noteHype(prev, ev, { id, receivedAt }) {
  if (!ev || !String(ev.kind ?? "").startsWith("hype_")) return prev ?? null;
  const p = prev && typeof prev === "object" ? prev : null;
  const events = Array.isArray(p?.events) ? p.events : [];
  if (id && events.some((e) => e.id === id)) return p;
  const phase = ev.kind.slice(5);
  // a "begin", or any message after an ended train, starts a new train
  const fresh = phase === "begin" || !p || p.ended === true;
  const level = int(ev.level) ?? 1;
  const before = fresh ? null : p;
  const kind = phase === "end" ? "end" : before && level > (before.level ?? 1) ? "level" : phase === "begin" ? "begin" : "step";
  const delta = before && int(ev.total) !== undefined && int(before.total) !== undefined ? Math.max(0, ev.total - before.total) : int(ev.progress) ?? 0;
  const next = {
    level,
    total: int(ev.total) ?? before?.total ?? 0,
    goal: phase === "end" ? before?.goal ?? 0 : int(ev.goal) ?? before?.goal ?? 0,
    progress: phase === "end" ? before?.goal ?? before?.progress ?? 0 : int(ev.progress) ?? 0,
    ...(phase === "end" ? {} : int(ev.expiresAt) ? { expiresAt: ev.expiresAt } : before?.expiresAt ? { expiresAt: before.expiresAt } : {}),
    trainType: typeof ev.trainType === "string" ? ev.trainType : before?.trainType ?? "regular",
    startedAt: fresh ? (int(ev.at) ?? receivedAt) : before.startedAt,
    updatedAt: receivedAt,
    ended: phase === "end",
    ...(phase === "end" ? { endedAt: receivedAt } : {}),
    events: [...(fresh ? [] : events), { id: String(id ?? `h-${receivedAt}`).slice(0, 100), at: receivedAt, kind, level, amount: delta }].slice(-HYPE_EVENTS),
  };
  return next;
}

/** Is this train still on (not ended, its countdown not over for a while)? */
export function isActive(h, now) {
  if (!h || h.ended) return false;
  if (int(h.expiresAt)) return now < h.expiresAt + STALE_MS;
  return now < (h.updatedAt ?? 0) + NO_TIMER_MS;
}

/**
 * A state written by an older version (no `hype` key): rebuilt from the newest journal lines of the train, which only carry the new levels and no countdown.
 * `lines`: journal docs, newest first. Returns null when there is no train in them.
 */
export function fromJournal(lines) {
  const mine = (Array.isArray(lines) ? lines : []).filter((l) => l && String(l.kind ?? "").startsWith("hype_") && (l.source === "twitch" || l.source === "catchup" || l.source === undefined));
  if (!mine.length) return null;
  const start = mine.findIndex((l) => l.kind === "hype_begin");
  const train = (start === -1 ? mine : mine.slice(0, start + 1)).slice().reverse();
  let h = null;
  for (const l of train) h = noteHype(h, l, { id: l.id, receivedAt: l.receivedAt ?? l.at });
  return h;
}
