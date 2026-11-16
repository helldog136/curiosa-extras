// (1.22.0) The service `twitch.rewards` (version 1): another module (Twitch activity, for a reaction per reward) creates a channel point reward on Twitch WITHOUT
// owning one. The creation is this module's own path (rewards.mjs: checks, the channel's permission "manage the rewards", the 20-reward limit, the store), with the
// action "show the alert only" (actions.mjs ALERT_ACTION): nothing happens in the chat or at home, the redemptions skip Twitch's request queue. The reward then shows
// in the Rewards tab of this module like any other (pause, edit, delete).
//   status()                        read  { ok, canCreate, code?, count, max, path } — `code` says what is missing (need_scope, need_connect, no_channel, too_many…)
//   create({ title, cost, prompt? }) write callerRights: the person who clicked must hold this module's right "rewards.manage"; audited ("reward.created", the title only)
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const R = await import(`./rewards.mjs${v}`);
const A = await import(`./actions.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);

const path = (ctx) => `/admin/instances/${encodeURIComponent(ctx.instance.id)}?tab=rewards`;

export async function status(ctx) {
  const rows = await R.list(ctx).catch(() => []);
  const acc = await R.access(ctx, settingsOf(ctx)).catch(() => ({ ok: false, code: "twitch_down" }));
  const full = rows.length >= R.MAX_REWARDS;
  return { ok: true, canCreate: acc.ok && !full, ...(acc.ok ? (full ? { code: "too_many" } : {}) : { code: acc.code }), count: rows.length, max: R.MAX_REWARDS, path: path(ctx) };
}

/** Creates the reward. { ok: true, reward: { id (Twitch), title, cost } } or { ok: false, code, errors? } (errors: { title | cost | prompt: code }). Never throws. */
export async function create(ctx, input) {
  if (typeof ctx.can !== "function" || ctx.can("rewards.manage") !== true) return { ok: false, code: "denied" };
  const s = settingsOf(ctx), others = await R.list(ctx);
  const c = R.check({ title: input?.title, cost: input?.cost, cooldown: 0, prompt: input?.prompt ?? "", action: A.ALERT_ACTION, reply: "" }, { s, others, prefix: s.prefix });
  if (!c.ok) {
    const errors = Object.fromEntries(Object.entries(c.errors).filter(([k]) => ["title", "cost", "prompt"].includes(k)));
    return { ok: false, code: "invalid", errors };
  }
  const r = await R.create(ctx, s, c.value).catch(() => ({ ok: false, code: "twitch" }));
  if (!r.ok) return { ok: false, code: r.code ?? "twitch", ...(r.code === "duplicate" ? { errors: { title: "dup" } } : {}) };
  const doc = (await R.list(ctx)).find((x) => x.id === r.id);
  try { await ctx.api.log?.write?.({ action: "reward.created", data: { title: c.value.title } }); } catch { /* the journal is a plus */ }
  return { ok: true, reward: { id: doc?.tid ?? "", title: c.value.title, cost: c.value.cost } };
}
