// What the Discord connector keeps in ITS private storage (an instance never reads another one's):
//   discordApp      ONE document: { applicationId, guildId, botToken } — the bot code is a secret: it never leaves this file (no block, no service answer, no log, no error).
//   discordManaged  one document per message kept up to date for a module: { id: "<owner>:<key>", channelId, messageId, hash, at } (bounded).
//   discordSent     one document per message the bot itself wrote (channelId, messageId, at), the last 500: the only messages editMessage / deleteMessage accept.
//   discordHealth   ONE document: { state, since, feature?, permission?, at } — what went wrong last, and since when.
// There is deliberately NO `backup.readable` export: the secret never goes into the human-readable files of a backup.
// HONESTLY: the core has no way for a module to seal a secret (its `seal` is internal). The bot code is kept as text in this module's storage, hence in the
// database as the other module data are, and in the backup file, which the core encrypts with the password chosen when the backup is made.
export const COL = { app: "discordApp", managed: "discordManaged", sent: "discordSent", health: "discordHealth" };
export const LIMITS = { managed: 200, perOwner: 50, sent: 500 };

export const text = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
/** A Discord number (snowflake): digits only, 15 to 25 of them. */
export const SNOWFLAKE = /^[0-9]{15,25}$/;
export const snowflake = (v) => { const s = text(v); return SNOWFLAKE.test(s) ? s : ""; };
/** The bot code as Discord shows it: letters, digits, dot, dash, underscore, no space. */
export const BOT_CODE = /^[A-Za-z0-9._-]{20,200}$/;
export const botCode = (v) => { const s = text(v); return BOT_CODE.test(s) ? s : ""; };

export async function all(ctx, col, limit = 50) {
  try { return (await ctx.api.store.list(col, { limit })).slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); } catch { return []; }
}
export const first = async (ctx, col) => (await all(ctx, col, 5))[0] ?? null;
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
export function serial(ctx, fn, ms = 25_000) {
  const key = ctx.instance?.id ?? "x";
  const prev = queues.get(key) ?? Promise.resolve();
  let timer;
  const run = prev.then(() => Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); timer.unref?.(); })]).finally(() => clearTimeout(timer)));
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}
export const resetQueues = () => queues.clear();
