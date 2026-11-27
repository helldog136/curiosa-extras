// The ONLY file that talks to Discord (REST, version 10, no gateway). Everything goes through ctx.api.net: the core's bounded client gives the time limit,
// the pause after "too many requests" (retry-after header, or retry_after in the body) shared by the WHOLE site through one bucket per application,
// and the circuit breaker. The bot code is read from the private storage, put in one header, and goes nowhere else: never in a result, a log line or an error.
import { createHash } from "node:crypto";

const version = new URL(import.meta.url).search;
const store = await import(new URL(`./store.mjs${version}`, import.meta.url).href);

export const HOST = "discord.com";
export const API = "https://discord.com/api/v10";
export const USER_AGENT = "DiscordBot (https://github.com/helldog136/Curiosa, 1)";   // the form Discord asks for: DiscordBot ($url, $versionNumber)
export const timing = { requestMs: 8000 };

/** Reasons of the service: a closed list. */
export const REASONS = ["not_configured", "invalid_input", "forbidden", "not_found", "not_member", "rate_limited", "unavailable", "failed"];

/** Permission bits (Discord documentation, "Permissions": VIEW_CHANNEL 1<<10 … SEND_MESSAGES_IN_THREADS 1<<38). */
export const BITS = {
  view: 1n << 10n, send: 1n << 11n, embed: 1n << 14n,
  manageThreads: 1n << 34n, publicThreads: 1n << 35n, privateThreads: 1n << 36n, sendInThreads: 1n << 38n,
};
const ADMINISTRATOR = 1n << 3n;
/** What each feature needs, in words the person reads (the locale key is `perm_<name>`). */
export const FEATURES = {
  post: ["view", "send", "embed"],
  privateThread: ["view", "send", "privateThreads", "sendInThreads"],
  publicThread: ["view", "send", "publicThreads", "sendInThreads"],
  archive: ["manageThreads"],
};
/** The permission number of the invitation link: the union of every feature. */
export const PERMISSIONS = [...new Set(Object.values(FEATURES).flat())].reduce((n, k) => n | BITS[k], 0n);
export const permissionsNumber = () => PERMISSIONS.toString();

/** The invitation link of the bot (scope "bot"); `guildId` pre-selects the server. Only the public application number goes in it. */
export function inviteLink(applicationId, guildId) {
  if (!store.snowflake(applicationId)) return null;
  const q = new URLSearchParams({ client_id: applicationId, scope: "bot", permissions: permissionsNumber() });
  if (store.snowflake(guildId)) { q.set("guild_id", guildId); q.set("disable_guild_select", "true"); }
  return `https://discord.com/oauth2/authorize?${q}`;
}

const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 24);
/** One bucket for the whole bot: a pause after "too many requests" stops every module that uses it, without network, until the time Discord gave. */
export const bucketOf = (c) => `discord-bot:${hash(c.botToken)}`;

const mem = { good: null, pause: null, netSince: null };
export const resetDiscord = () => { mem.good = null; mem.pause = null; mem.netSince = null; };
/** Since when Discord does not answer (timeouts, 5xx, open circuit), or null while it does. */
export const netSince = () => mem.netSince;
export const lastGood = () => mem.good;
export const pausedUntil = () => (mem.pause && mem.pause > Date.now() ? mem.pause : null);

/** Discord error codes that change the meaning of a status. */
const CODE = { unknownChannel: 10003, unknownGuild: 10004, unknownMember: 10007, unknownUser: 10013, missingAccess: 50001, missingPermissions: 50013, archivedThread: 50083, notAuthor: 50005 };

/**
 * One call. { ok: true, status, json } or { ok: false, reason, status?, code?, retryAt? }; never throws, never carries the body of an error.
 * `member`: a 404 "unknown user/member" means "this person is not on the server" (not_member).
 */
export async function call(ctx, creds, { method, path, body, priority = "interactive", member = false, guild = false }) {
  if (!store.hasBot(creds)) return { ok: false, reason: "not_configured" };
  let r;
  try {
    r = await ctx.api.net.request({
      url: `${API}${path}`, method, priority, bucket: bucketOf(creds), timeoutMs: timing.requestMs,
      headers: { authorization: `Bot ${creds.botToken}`, "user-agent": USER_AGENT, accept: "application/json" },
      ...(body === undefined ? {} : { body }),
    });
  } catch { mem.netSince ??= Date.now(); return { ok: false, reason: "unavailable" }; }
  if (!r.ok) {
    if (r.error === "rate" || r.error === "quota") { if (r.retryAt) mem.pause = Number(r.retryAt) || mem.pause; return { ok: false, reason: "rate_limited", ...(r.retryAt ? { retryAt: Number(r.retryAt) } : {}) }; }
    if (r.error === "busy") return { ok: false, reason: "rate_limited" };
    if (r.error === "invalid" || r.error === "too_large") return { ok: false, reason: "failed" };
    mem.netSince ??= Date.now();
    return { ok: false, reason: "unavailable" };
  }
  const status = r.status;
  const code = r.json && typeof r.json === "object" && Number.isInteger(r.json.code) ? r.json.code : undefined;
  if (status >= 500) { mem.netSince ??= Date.now(); return { ok: false, reason: "unavailable", status }; }
  mem.netSince = null;
  if (status >= 200 && status < 300) { mem.good = Date.now(); mem.pause = null; return { ok: true, status, json: r.json ?? null }; }
  mem.good = Date.now();   // Discord answered: it is reachable
  // (a 429 never gets here: the core's client turns it into error "rate" above, with the pause shared by the whole site)
  if (status === 401) return { ok: false, reason: "forbidden", status, code: "token" };
  if (status === 403) {
    if (code === CODE.missingAccess && guild) return { ok: false, reason: "not_member", status, code };
    return { ok: false, reason: "forbidden", status, ...(code ? { code } : {}) };
  }
  if (status === 404) {
    if (code === CODE.unknownGuild) return { ok: false, reason: "not_member", status, code };
    if (member && (code === CODE.unknownUser || code === CODE.unknownMember)) return { ok: false, reason: "not_member", status, code };
    return { ok: false, reason: "not_found", status, ...(code ? { code } : {}) };
  }
  return { ok: false, reason: "failed", status };
}
export { CODE };

/** From the permissions number of the roles of the bot: which of the wanted bits are missing. Administrator has them all. */
export function missingFrom(permissions, features = Object.keys(FEATURES)) {
  const have = BigInt(permissions);
  const out = [];
  if (have & ADMINISTRATOR) return out;
  for (const f of features) for (const k of FEATURES[f]) if (!(have & BITS[k])) out.push({ feature: f, permission: k });
  return out;
}

/**
 * What the bot lacks IN ONE CHANNEL for posting, after the permission overwrites of that channel (Discord documentation, "Permission overwrites": the server-wide
 * permissions, then the overwrite of @everyone, then those of the roles of the bot (all denials, then all grants), then the one of the bot itself).
 * `base` is the server-wide number (roles added together), `roleIds` the roles of the bot. Only what the overwrites TAKE AWAY is reported: a permission the bot
 * lacks on the whole server is already told by `missingFrom`. Returns the permission names (`view`, `send`, `embed`); [] when all is fine or when the bot is administrator.
 */
export function lostInChannel(base, channel, guildId, botId, roleIds, features = ["post"]) {
  const have = BigInt(base);
  if (have & ADMINISTRATOR) return [];
  const overwrites = Array.isArray(channel?.permission_overwrites) ? channel.permission_overwrites : [];
  const bits = (v) => { try { return BigInt(v ?? "0"); } catch { return 0n; } };
  let perms = have;
  const apply = (allow, deny) => { perms = (perms & ~deny) | allow; };
  const everyone = overwrites.find((o) => o?.id === guildId);
  if (everyone) apply(bits(everyone.allow), bits(everyone.deny));
  let allow = 0n, deny = 0n;
  for (const o of overwrites) if (o && o.id !== guildId && roleIds.has(o.id) && Number(o.type) === 0) { allow |= bits(o.allow); deny |= bits(o.deny); }
  apply(allow, deny);
  const me = overwrites.find((o) => o?.id === botId && Number(o.type) === 1);
  if (me) apply(bits(me.allow), bits(me.deny));
  const wanted = [...new Set(features.flatMap((f) => FEATURES[f]))];
  return wanted.filter((k) => (have & BITS[k]) && !(perms & BITS[k]));
}
