// The mark that the alerts overlay leaves on a journal line when the moderation hid or held the viewer's text, and when the owner decided: `flag: { reason, state, at }`.
// Offered as the service `twitch.journal` (method `flag`). Only a reason and a state of closed lists are stored, never the text itself: the journal keeps what it kept before.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const st = await import(`./state.mjs${v}`);

export const REASONS = ["word", "link", "caps", "repeat"];
export const STATES = ["hidden", "held", "accepted", "dismissed"];

/** { ok: true } or { ok: false, code: "bad" | "unknown" }. */
export async function mark(ctx, input, { now = Date.now() } = {}) {
  const id = String(input?.id ?? "").slice(0, 100), reason = String(input?.reason ?? ""), state = String(input?.state ?? "");
  if (!id || !REASONS.includes(reason) || !STATES.includes(state)) return { ok: false, code: "bad" };
  return st.serial(ctx, "journal", async () => {
    const line = await ctx.api.store.getByKey(st.COL, id);
    if (!line) return { ok: false, code: "unknown" };
    await ctx.api.store.update(line.id, { ...line.data, flag: { reason, state, at: now } });
    const m = st.memoryOf(ctx); m.rev = (m.rev ?? 0) + 1;
    return { ok: true };
  });
}
