// (1.12.0) A reaction PER channel point reward. This module owns no reward and no reaction: it puts together what three others know.
//   - the rewards of the channel, read at Twitch through the connector (`twitch.api`, `GET channel_points/custom_rewards`, permission "read the redemptions",
//     which the type "Channel points" already asks for); every reward of the channel, made on Twitch or by Curiosa;
//   - the rewards seen in the journal (a redemption carries the id, title and cost of its reward): the list still says something when Twitch cannot be read;
//   - the reactions kept by the alerts overlay (`alerts.reaction` version 3: `rewards`, and `get`/`set`/`test` with `reward`).
// Creating a reward on Twitch is the Twitch bot's (`twitch.rewards`, optional): this module never asks for the permission "manage the rewards".
// Without the bot, without the overlay's version 3, without the permission: the page says in one line what is missing, with a link; nothing breaks.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const es = await import(`./eventsub.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const { diagnose, twitch } = await import(`./listen.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);

export const SERVICE = "alerts.reaction", CREATOR = "twitch.rewards";
export const READ_SCOPE = "channel:read:redemptions";
export const OTHERS = "*";   // the row "all the other rewards" (the type `redeem` of the overlay)
const clean = (x, max) => (typeof x === "string" ? x.normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const cost = (x) => (Number.isInteger(x) && x >= 0 && x <= 1_000_000_000 ? x : 0);
const cache = (globalThis.__curiosaEventsRewards ??= new Map());   // instance key → { at, value }
export const TTL = 30_000;
export const forget = (ctx) => cache.delete(ctx.instance.key);
export const resetRewardsCache = () => cache.clear();

/**
 * The rewards of the channel at Twitch: { ok: true, rewards: [{ id, title, cost, enabled, paused }] } or { ok: false, code }:
 * "scope" (the permission to read them is missing), "na" (not Affiliate nor Partner: no channel points), "no_channel", "twitch". Read at most every 30 s.
 */
export async function atTwitch(ctx, { now = Date.now(), force = false } = {}) {
  const hit = cache.get(ctx.instance.key);
  if (!force && hit && now - hit.at < TTL) return hit.value;
  let value;
  try {
    const d = await diagnose(ctx, settingsOf(ctx), { declare: false });
    const b = d.main?.userId;
    if (!d.channel || !b) value = { ok: false, code: "no_channel" };
    else {
      const r = await twitch(ctx, d.channel, { as: "user", slot: "main", method: "GET", path: "channel_points/custom_rewards", query: { broadcaster_id: String(b) } });
      if (!r.ok) value = { ok: false, code: r.error === "scope" ? "scope" : "twitch" };
      else if (r.status === 403 && /affiliate|partner/i.test(String(r.json?.message ?? ""))) value = { ok: false, code: "na" };
      else if (r.status === 401 || r.status === 403) value = { ok: false, code: "scope" };
      else if (r.status !== 200) value = { ok: false, code: "twitch" };
      else {
        const rewards = (Array.isArray(r.json?.data) ? r.json.data : []).filter((x) => x && es.REWARD_ID.test(String(x.id ?? ""))).slice(0, 100)
          .map((x) => ({ id: String(x.id), title: clean(x.title, 45) || String(x.id), cost: cost(x.cost), enabled: x.is_enabled !== false, paused: x.is_paused === true }));
        value = { ok: true, rewards };
      }
    }
  } catch { value = { ok: false, code: "twitch" }; }
  cache.set(ctx.instance.key, { at: now, value });
  return value;
}

/** The rewards seen in the journal (newest title and cost win): Map id → { id, title, cost }. */
export async function seen(ctx) {
  const out = new Map();
  for (const d of await st.recent(ctx, 1000).catch(() => [])) {
    if (d.kind !== "redeem" || !es.REWARD_ID.test(String(d.rewardId ?? "")) || out.has(d.rewardId)) continue;
    out.set(d.rewardId, { id: d.rewardId, title: clean(d.title, 45) || d.rewardId, cost: cost(d.amount) });
  }
  return out;
}

/** The reactions of the rewards at the overlay: { ok, rewards: Map id → row, others } or { ok: false } (absent, or older than version 3). */
export async function reactions(ctx) {
  try {
    const r = await ctx.api.services.call(SERVICE, "rewards", {});
    if (!r?.ok || !Array.isArray(r.value?.rewards)) return { ok: false };
    return { ok: true, rewards: new Map(r.value.rewards.filter((x) => es.REWARD_ID.test(String(x?.reward ?? ""))).map((x) => [x.reward, x])), others: r.value.others ?? null };
  } catch { return { ok: false }; }
}

/**
 * The list of the page: one line per reward of the channel (Twitch first; else what the journal saw), plus the rewards that have a reaction and are gone from Twitch
 * (`gone`). Sorted by title. { twitch, overlay, items: [{ id, title, cost, enabled, paused, gone, row }], others }.
 */
export async function list(ctx, opts = {}) {
  const [tw, sn, rx] = await Promise.all([atTwitch(ctx, opts), seen(ctx), reactions(ctx)]);
  const items = new Map();
  if (tw.ok) for (const r of tw.rewards) items.set(r.id, { ...r, gone: false });
  else for (const r of sn.values()) items.set(r.id, { ...r, enabled: true, paused: false, gone: false });
  for (const [id, row] of rx.ok ? rx.rewards : []) {
    const known = items.get(id);
    if (known) known.row = row;
    else items.set(id, { id, title: clean(row.title, 45) || sn.get(id)?.title || id, cost: row.cost || sn.get(id)?.cost || 0, enabled: true, paused: false, gone: tw.ok, row });
  }
  const sorted = [...items.values()].sort((a, b) => Number(a.gone) - Number(b.gone) || a.title.localeCompare(b.title, ctx.locale, { sensitivity: "base" }));
  return { twitch: tw, overlay: rx.ok, items: sorted, others: rx.ok ? rx.others : null };
}
/** One reward of the list (for its window and its actions), or null. */
export async function one(ctx, id) {
  if (!es.REWARD_ID.test(String(id ?? ""))) return null;
  return (await list(ctx)).items.find((x) => x.id === id) ?? null;
}

/** Can a reward be created from here? { can: true } or { can: false, code: "absent" | "denied" | "need_scope" | "too_many" | …, path }. Never throws. */
export async function creator(ctx) {
  let providers = [];
  try { providers = await ctx.api.services.providers(CREATOR); } catch { providers = []; }
  if (!providers.length) return { can: false, code: "absent" };
  try {
    const r = await ctx.api.services.call(CREATOR, "status", {});
    if (!r?.ok || !r.value?.ok) return { can: false, code: "twitch" };
    return r.value.canCreate ? { can: true, path: r.value.path } : { can: false, code: String(r.value.code ?? "twitch"), path: r.value.path };
  } catch { return { can: false, code: "twitch" }; }
}
