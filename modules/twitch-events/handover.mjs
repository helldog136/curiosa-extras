// (1.13.0) The hand-over to Alerts overlay (OBS) 1.18.0, which now holds what this module did (listening, journal, OBS dock, reactions). Offered once as the service
// `twitch.events.handover`; this module is then "retired": it listens to nothing, its tasks stop, its page says where everything went, its dock address sends to the
// new one. Nothing is deleted here: the owner removes the module afterwards (the core then sets its data aside, as for any removal).
//   - `release({ by })`: stops the listening at Twitch (our subscriptions are deleted, our permission wish is withdrawn) and marks the module retired. Idempotent.
//   - `export({ after, limit })`: the journal, oldest first, page by page (`next` = the cursor of the next page), with the state and the options on every page.
//   - `flag(input)`: the mark of a viewer text, as the service `twitch.journal` did (used by the overlay until it took over).
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const st = await import(`./state.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const { stopListening, callbackOf } = await import(`./listen.mjs${v}`);
const flag = await import(`./flag.mjs${v}`);

export const SERVICE = "twitch.events.handover";
export const ABSORBER = "alerts-overlay";
export const LIMITS = { page: 250, maxPage: 500 };
/** The parts of the state worth taking over (never the secret shared with Twitch: the new address gets its own). */
const STATE_KEYS = ["enabled", "dockSecret", "liveSince", "lastEventAt", "okAt", "subLogins", "catchup", "last"];
const KEY = /^[a-z0-9][a-z0-9-]{0,59}$/;

/** { by, at } when the module was retired, else null. */
export async function retiredOf(ctx) { const r = (await st.readState(ctx)).retired; return r && typeof r === "object" && KEY.test(String(r.by ?? "")) ? r : null; }

export async function release(ctx, input = {}) {
  const by = KEY.test(String(input?.by ?? "")) ? String(input.by) : ABSORBER;
  const was = await retiredOf(ctx);
  const at = was?.at ?? Date.now();
  if (!was) await st.updateState(ctx, (x) => { x.retired = { by, at }; });
  await stopListening(ctx, settingsOf(ctx));   // idempotent: deletes only our own subscriptions (our address), then withdraws our permission wish
  return { ok: true, key: ctx.instance.key, at, callback: callbackOf(ctx) };
}

export async function exportPage(ctx, input = {}) {
  const limit = Math.min(LIMITS.maxPage, Math.max(1, Math.trunc(Number(input?.limit)) || LIMITS.page));
  const cursor = typeof input?.after === "string" && input.after ? input.after.slice(0, 500) : undefined;
  const page = await ctx.api.store.page(st.COL, { limit, ...(cursor ? { cursor } : {}), order: "asc" });
  const s = await st.readState(ctx), state = Object.fromEntries(STATE_KEYS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
  const o = settingsOf(ctx);
  return {
    ok: true, key: ctx.instance.key, version: 1, state, options: { retentionDays: o.retentionDays, healthMail: o.healthMail, silentHours: o.silentHours, channel: o.channel },
    lines: page.items.map((r) => r.data).filter((d) => d && typeof d === "object"), next: page.next ?? null,
  };
}

export const service = {
  release: (ctx, input) => release(ctx, input),
  export: (ctx, input) => exportPage(ctx, input),
  flag: (ctx, input) => flag.mark(ctx, input),
};
