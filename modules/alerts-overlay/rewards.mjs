// (1.17.0) A reaction PER channel point reward ("Hydrate" shows its GIF, "Confetti" its video), read and changed by Twitch activity through `alerts.reaction`
// (version 3). ONE owner: this overlay. The rows live in their own collection (twitch.mjs REWARD_COL): the configuration of the types is never touched, so an
// older version of this module simply ignores them and every redemption shows the reaction of the type `redeem`, as before.
// Row: { rid, title, cost, on, cfg, updatedAt }. `cfg` is the settings of a type (the same normalisation as the configuration) or null: the reward then shows
// the reaction of all the other rewards, and only its switch (`on`) is its own. The placed texts of a reward live at the place `event:redeem:<rid>`.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const tw = await import(new URL(`./twitch.mjs${v}`, import.meta.url).href);

export const COL = tw.REWARD_COL;
export const MAX = 100;
const cache = (globalThis.__curiosaAlertsRewards ??= new Map());   // overlay key → { at, rows: Map<rid, row> }
const TTL = 10_000;
export const resetRewardCache = () => cache.clear();
const clean = (x, max) => String(x ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const int = (x) => { const n = Math.trunc(Number(x)); return Number.isFinite(n) && n >= 0 && n <= 1_000_000_000 ? n : 0; };
export const validId = (rid) => typeof rid === "string" && tw.REWARD_ID.test(rid);
/** The settings of a reward's reaction, made safe exactly as those of a type (the type `redeem`: its minimum, its viewer text). */
export const normalCfg = (raw) => (raw && typeof raw === "object" ? tw.normaliseConfig({ types: { redeem: raw } }).types.redeem : null);

/** Every row, by reward id (read at most every 10 s). Never throws. */
export async function byId(ctx, now = Date.now()) {
  const k = ctx.instance.key, c = cache.get(k);
  if (c && now - c.at < TTL) return c.rows;
  const rows = new Map();
  try {
    for (const r of await ctx.api.store.list(COL, { limit: MAX + 20 })) {
      const d = r?.data;
      if (!d || !validId(d.rid) || rows.has(d.rid)) continue;
      rows.set(d.rid, { id: r.id, rid: d.rid, title: clean(d.title, 80), cost: int(d.cost), on: d.on !== false, cfg: normalCfg(d.cfg), updatedAt: d.updatedAt ?? null });
    }
  } catch { /* none yet */ }
  cache.set(k, { at: now, rows });
  return rows;
}
export async function one(ctx, rid) { return validId(rid) ? (await byId(ctx)).get(rid) ?? null : null; }

/** Writes a row (creates it when new). `change`: { title?, cost?, on?, cfg? (null = the reaction of all the other rewards) }. Returns the row, or null when full. */
export async function put(ctx, rid, change, now = Date.now()) {
  if (!validId(rid)) return null;
  const rows = await byId(ctx, now), cur = rows.get(rid);
  if (!cur && rows.size >= MAX) return null;
  const next = {
    rid, title: change.title !== undefined ? clean(change.title, 80) : cur?.title ?? "", cost: change.cost !== undefined ? int(change.cost) : cur?.cost ?? 0,
    on: change.on !== undefined ? change.on !== false : cur?.on ?? true, cfg: change.cfg !== undefined ? normalCfg(change.cfg) : cur?.cfg ?? null, updatedAt: new Date(now).toISOString(),
  };
  if (cur) await ctx.api.store.update(cur.id, next); else { const id = await ctx.api.store.add(COL, next); rows.set(rid, { id: typeof id === "string" ? id : id?.id, ...next }); }
  cache.delete(ctx.instance.key);
  return next;
}
/** Removes a row. Returns the settings it had (so its files can be let go), or null. */
export async function drop(ctx, rid) {
  const cur = await one(ctx, rid);
  if (!cur) return null;
  try { await ctx.api.store.remove(cur.id); } catch { /* already gone */ }
  cache.delete(ctx.instance.key);
  return cur;
}
