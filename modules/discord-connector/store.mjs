// What the Discord connector keeps in ITS private storage (an instance never reads another one's):
//   discordApp      ONE document: { applicationId, guildId, botToken } — the bot code is a secret: it never leaves this file (no block, no service answer, no log, no error).
//   discordManaged  one document per message kept up to date for a module: { id: "<owner>:<key>", channelId, messageId, hash, at } (bounded).
//   discordSent     one document per message the bot itself wrote (channelId, messageId, at), the last 500: the only messages editMessage / deleteMessage accept.
//   discordHealth   ONE document: { state, since, feature?, permission?, at } — what went wrong last, and since when.
//   discordAllow    ONE document: { channelIds: [...], at } — the channels the owner chose for the bot to write in (no document or an empty list = no limit).
// There is deliberately NO `backup.readable` export: the secret never goes into the human-readable files of a backup.
// HONESTLY: the core has no way for a module to seal a secret (its `seal` is internal). The bot code is kept as text in this module's storage, hence in the
// database as the other module data are, and in the backup file, which the core encrypts with the password chosen when the backup is made.
export const COL = { app: "discordApp", managed: "discordManaged", sent: "discordSent", health: "discordHealth", allow: "discordAllow" };
export const LIMITS = { managed: 200, perOwner: 50, sent: 500, allow: 100 };

export const text = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
/** A Discord number (snowflake): digits only, 15 to 25 of them. */
export const SNOWFLAKE = /^[0-9]{15,25}$/;
export const snowflake = (v) => { if (typeof v === "number" && !Number.isSafeInteger(v)) return ""; const s = text(v); return SNOWFLAKE.test(s) ? s : ""; };   // a number past 2^53 has already lost digits: refused
/** The bot code as Discord shows it: letters, digits, dot, dash, underscore, no space. */
export const BOT_CODE = /^[A-Za-z0-9._-]{20,200}$/;
export const botCode = (v) => { const s = text(v); return BOT_CODE.test(s) ? s : ""; };

/** The documents of a collection, oldest first. A store that cannot be read THROWS `store_unavailable`: caps and the sent log cannot be checked on an empty guess (fail closed). */
export async function all(ctx, col, limit = 50) {
  try { return (await ctx.api.store.list(col, { limit })).slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); } catch { throw new Error("store_unavailable"); }
}
/** The first document, or null (also null when the store cannot be read: used for the bot's own settings and the card, which must still render). */
export const first = async (ctx, col) => { try { return (await all(ctx, col, 5))[0] ?? null; } catch { return null; } };
export async function put(ctx, col, doc, data) {
  if (doc) { if (JSON.stringify(doc.data) !== JSON.stringify(data)) await ctx.api.store.update(doc.id, data); return doc.id; }
  return ctx.api.store.add(col, data);
}

/** { applicationId, guildId, botToken } — all three as saved ("" when missing). */
export async function credsOf(ctx) {
  const a = (await first(ctx, COL.app))?.data ?? {};
  return { applicationId: text(a.applicationId), guildId: text(a.guildId), botToken: text(a.botToken) };
}
export const hasBot = (c) => !!(c.botToken && c.guildId);
export const complete = (c) => !!(c.applicationId && c.guildId && c.botToken);

/** The last problem (or none). */
export async function healthOf(ctx) {
  return (await first(ctx, COL.health))?.data ?? null;
}
export async function setHealth(ctx, next) {
  const doc = await first(ctx, COL.health);
  if (!next) { if (doc) await ctx.api.store.remove(doc.id); return; }
  await put(ctx, COL.health, doc, next);
}

/**
 * The channels the owner chose (numbers, in the order chosen). Empty = no limit. A store that cannot be read THROWS `store_unavailable`: a write is never allowed on a guess (fail closed).
 * Anything that is not a Discord number is ignored, so a damaged document can only shrink the list, never widen what the bot may do.
 */
export async function allowedIds(ctx) {
  const doc = (await all(ctx, COL.allow, 5))[0];
  const ids = Array.isArray(doc?.data?.channelIds) ? doc.data.channelIds.map(snowflake).filter(Boolean) : [];
  return [...new Set(ids)].slice(0, LIMITS.allow);
}
/** Saves the list ([] removes the document: no limit). Always inside `serialAllow`. */
export async function setAllowed(ctx, ids) {
  const doc = (await all(ctx, COL.allow, 5))[0] ?? null;
  const channelIds = [...new Set(ids.map(snowflake).filter(Boolean))].slice(0, LIMITS.allow);
  if (!channelIds.length) { if (doc) await ctx.api.store.remove(doc.id); return; }
  await put(ctx, COL.allow, doc, { channelIds, at: new Date().toISOString() });
}
/** Changes of the list go one after the other (two quick clicks on two switches never lose one); it has its own queue so that it never waits behind a message being written. */
const allowQueues = new Map();
export function serialAllow(ctx, fn) {
  const key = ctx.instance?.id ?? "x";
  const run = (allowQueues.get(key) ?? Promise.resolve()).then(fn);
  const tail = run.catch(() => {});
  allowQueues.set(key, tail);
  tail.then(() => { if (allowQueues.get(key) === tail) allowQueues.delete(key); });
  return run;
}

export const managedList = (ctx) => all(ctx, COL.managed, LIMITS.managed);
export const sentList = (ctx) => all(ctx, COL.sent, LIMITS.sent + 50);
/** Notes a message the bot wrote (the last 500 are kept). Never throws. */
export async function rememberSent(ctx, channelId, messageId) {
  try {
    const list = await sentList(ctx);
    if (list.some((d) => d.data.messageId === messageId && d.data.channelId === channelId)) return;
    await ctx.api.store.add(COL.sent, { channelId, messageId, at: new Date().toISOString() });
    for (const d of list.slice(0, Math.max(0, list.length + 1 - LIMITS.sent))) await ctx.api.store.remove(d.id);
  } catch { /* the message is on Discord anyway; only a later edit of it would be refused */ }
}
export async function forgetSent(ctx, messageId) {
  try { for (const d of await sentList(ctx)) if (d.data.messageId === messageId) await ctx.api.store.remove(d.id); } catch { /* nothing */ }
}
/** Did this bot write that message (sent log) or keep it up to date for a module (managed list)? */
export async function isOurs(ctx, channelId, messageId) {
  return (await sentList(ctx)).some((d) => d.data.channelId === channelId && d.data.messageId === messageId)
    || (await managedList(ctx)).some((d) => d.data.channelId === channelId && d.data.messageId === messageId);
}

/**
 * Writes in a queue, per instance: two simultaneous updates of the same message never create two documents or two messages.
 * Each step is bounded: a step that never returns frees the queue when it expires.
 */
const queues = new Map();
/** The section timeout (90 s) covers the longest chain of network calls of one section (a channel check, a write, a delete: 8 s each, plus the core's own waits). */
export const SECTION_MS = 90_000;
export const SECTION = { ms: SECTION_MS };   // (the tests shorten it)
export function serial(ctx, fn, ms = SECTION.ms) {
  const key = ctx.instance?.id ?? "x";
  const prev = queues.get(key) ?? Promise.resolve();
  let timer;
  const ctl = { expired: false };   // set when the time is up: a step that wakes up late must not write (it would overwrite what the next section did)
  const run = prev.then(() => Promise.race([Promise.resolve().then(() => fn(ctl)), new Promise((_, reject) => { timer = setTimeout(() => { ctl.expired = true; reject(new Error("timeout")); }, ms); timer.unref?.(); })]).finally(() => clearTimeout(timer)));
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}
export const resetQueues = () => { queues.clear(); allowQueues.clear(); };
