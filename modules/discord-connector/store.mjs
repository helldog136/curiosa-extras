// What the Discord connector keeps in ITS private storage (an instance never reads another one's):
//   discordApp      ONE document: { applicationId, guildId, botToken } — the bot code is a secret: it never leaves this file (no block, no service answer, no log, no error).
//   discordManaged  one document per message kept up to date for a module: { id: "<owner>:<key>", channelId, messageId, hash, at } (bounded).
//   discordHealth   ONE document: { state, since, feature?, permission?, at } — what went wrong last, and since when.
// There is deliberately NO `backup.readable` export: the secret is only in the encrypted backup of the core, never in the human-readable files.
export const COL = { app: "discordApp", managed: "discordManaged", health: "discordHealth" };
export const LIMITS = { managed: 200 };

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
