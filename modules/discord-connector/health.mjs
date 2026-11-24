// Does the connection really work NOW? The panel never says "Configured" for a bot nobody asked Discord about: one read call for the bot, one for the server,
// two more to find which permissions the bot lacks on the whole server. The answer is kept 60 seconds; "Test the connection" and the 10-minute task force a fresh one.
import { createHash } from "node:crypto";

const version = new URL(import.meta.url).search;
const store = await import(new URL(`./store.mjs${version}`, import.meta.url).href);
const dc = await import(new URL(`./discord.mjs${version}`, import.meta.url).href);
const service = await import(new URL(`./service.mjs${version}`, import.meta.url).href);

export const TTL_MS = 60_000;
const memo = new Map();
export const resetHealth = () => memo.clear();

/**
 * { state: "none" | "ok" | "token" | "guild" | "rate" | "net", until?, missing?: [{ feature, permission }], blocked?: [{ id, name?, permissions?, gone? }], checkedAt }.
 * `missing` is what the bot lacks on the whole server (absent when Discord would not say); a permission given on one channel only is not seen here.
 * `blocked` (only when the owner chose channels): the chosen channels where the bot cannot post (a channel overwrite takes a permission away) or that no longer exist.
 */
export async function verify(ctx, { force = false } = {}) {
  const creds = await store.credsOf(ctx);
  if (!store.hasBot(creds)) return { state: "none", checkedAt: Date.now() };
  const k = `${ctx.instance?.id ?? "x"}:${createHash("sha256").update(`${creds.guildId}|${creds.botToken}`).digest("hex").slice(0, 16)}`;
  const hit = memo.get(k);
  if (!force && hit && hit.until > Date.now()) return hit.value;
  const value = await check(ctx, creds);
  memo.set(k, { value, until: Date.now() + TTL_MS });
  if (memo.size > 20) memo.delete(memo.keys().next().value);
  return value;
}

async function check(ctx, creds) {
  const at = Date.now();
  const stop = (r) => (r.reason === "rate_limited" ? { state: "rate", until: r.retryAt ?? dc.pausedUntil() ?? undefined, checkedAt: at } : { state: "net", checkedAt: at });
  const me = await dc.call(ctx, creds, { method: "GET", path: "/users/@me", priority: "background" });
  await service.track(ctx, "verify", me);
  if (!me.ok) return me.reason === "forbidden" ? { state: "token", checkedAt: at } : stop(me);
  const botId = store.snowflake(me.json?.id);
  const guild = await dc.call(ctx, creds, { method: "GET", path: `/guilds/${creds.guildId}/channels`, guild: true, priority: "background" });
  await service.track(ctx, "verify", guild, { guild: true });
  if (!guild.ok) return guild.reason === "not_member" || guild.reason === "forbidden" || guild.reason === "not_found" ? { state: "guild", checkedAt: at } : stop(guild);
  const out = { state: "ok", checkedAt: at };
  // The permissions of the bot on the whole server: the roles it has, added to those of everybody.
  if (botId) {
    const [roles, member] = await Promise.all([
      dc.call(ctx, creds, { method: "GET", path: `/guilds/${creds.guildId}/roles`, priority: "background" }),
      dc.call(ctx, creds, { method: "GET", path: `/guilds/${creds.guildId}/members/${botId}`, priority: "background" }),
    ]);
    if (roles.ok && member.ok && Array.isArray(roles.json) && Array.isArray(member.json?.roles)) {
      const mine = new Set([creds.guildId, ...member.json.roles]);
      let bits = 0n;
      for (const r of roles.json) if (r && mine.has(r.id)) { try { bits |= BigInt(r.permissions ?? "0"); } catch { /* unreadable role */ } }
      out.missing = dc.missingFrom(bits);
      // The channels the owner chose: which of them the bot cannot write in (an overwrite of the channel takes a permission away, or the channel is gone).
      const chosen = await store.allowedIds(ctx).catch(() => []);
      if (chosen.length && Array.isArray(guild.json)) {
        const rolesOfBot = new Set([creds.guildId, ...member.json.roles]);
        const by = new Map(guild.json.filter((c) => c && typeof c === "object").map((c) => [store.snowflake(c.id), c]));
        out.blocked = chosen.map((id) => {
          const c = by.get(id);
          return c ? { id, name: typeof c.name === "string" ? c.name.slice(0, 100) : "", permissions: dc.lostInChannel(bits, c, creds.guildId, botId, rolesOfBot) } : { id, gone: true };
        }).filter((b) => b.gone || b.permissions.length);
      }
    }
  }
  return out;
}

/**
 * What the card and the tools show: the current verdict. A permission problem is the one the roles of the bot show on the WHOLE server (read above);
 * a refusal on a channel a module chose says nothing about the bot and never turns the card red.
 */
export async function problem(ctx) {
  const v = await verify(ctx);
  if (v.state === "none") return { state: "none" };
  const kept = await store.healthOf(ctx);
  const since = kept?.since;
  if (v.state === "token" || v.state === "guild") return { state: v.state, since };
  if (v.state === "rate") return { state: "rate", until: v.until };
  // Discord does not answer (timeout, server error, circuit open): never "configured" for a bot nobody can reach.
  if (v.state === "net") return { state: "net", since: dc.netSince() ? new Date(dc.netSince()).toISOString() : undefined };
  if (v.missing?.length) return { state: "perms", feature: v.missing[0].feature, missing: v.missing.filter((m) => m.feature === v.missing[0].feature) };
  return { state: "ok" };
}

/** Every 10 minutes: ask Discord, note what changed (a change of state is one line of the central log). */
export async function sweep(ctx) {
  const before = await store.healthOf(ctx);
  const v = await verify(ctx, { force: true });
  const after = await store.healthOf(ctx);
  if (before && !after && v.state === "ok") await ctx.api.log?.write?.({ action: "connection.back", data: { was: before.state } });
  return v;
}
