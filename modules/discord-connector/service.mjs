// The service `discord.api` (version 1, not `each`): what other modules ask of Discord, in plain closed calls. Every answer is { ok: true, … } or { ok: false, reason },
// `reason` being one of: not_configured, invalid_input, forbidden, not_found, not_member, rate_limited, unavailable, failed. A method never throws and never returns
// the bot code, a header, or the body of a Discord error: every answer is built here from a short list of fields.
import { createHash } from "node:crypto";

const version = new URL(import.meta.url).search;
const store = await import(new URL(`./store.mjs${version}`, import.meta.url).href);
const dc = await import(new URL(`./discord.mjs${version}`, import.meta.url).href);
const { CODE } = dc;

export const FLAG_SILENT = 4096;   // SUPPRESS_NOTIFICATIONS (1 << 12)
export const LIMITS = { content: 2000, intro: 1500, name: 100, embeds: 10, embedTotal: 6000, list: 500 };
const ZWSP = "​";
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

/** Plain text for Discord: control characters out, every way of pinging defused (@everyone, @here, <@…>, <@&…>). The text can never mention anybody. */
export function plain(value, max) {
  let t = typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(CONTROL, "") : "";
  t = t.replace(/@(everyone|here)/gi, `@${ZWSP}$1`).replace(/<@/g, `<${ZWSP}@`);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
/** A thread name: no control character, one line, 100 characters at most, never empty. */
export function threadName(value) {
  const t = String(typeof value === "string" ? value : "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  const cut = [...t].slice(0, LIMITS.name).join("").trim();
  return cut || "thread";
}

const str = (v, max) => (typeof v === "string" && v.length <= max ? v : undefined);
/** Embeds the module may send: title, description, link, color, fields, footer, timestamp. Texts defused; 10 at most; 6000 characters in all. null = refused. */
export function cleanEmbeds(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > LIMITS.embeds) return null;
  const out = []; let total = 0;
  for (const e of raw) {
    if (!e || typeof e !== "object" || Array.isArray(e)) return null;
    const o = {}; const count = (t) => { total += [...t].length; return t; };
    if (e.title !== undefined) { const t = str(e.title, 256); if (t === undefined) return null; o.title = count(plain(t, 256)); }
    if (e.description !== undefined) { const t = str(e.description, 4096); if (t === undefined) return null; o.description = count(plain(t, 4096)); }
    if (e.url !== undefined) { if (typeof e.url !== "string" || !/^https:\/\/[^\s]{1,500}$/.test(e.url)) return null; o.url = e.url; }
    if (e.color !== undefined) { if (!Number.isInteger(e.color) || e.color < 0 || e.color > 0xffffff) return null; o.color = e.color; }
    if (e.timestamp !== undefined) { if (typeof e.timestamp !== "string" || Number.isNaN(Date.parse(e.timestamp))) return null; o.timestamp = new Date(e.timestamp).toISOString(); }
    if (e.footer !== undefined) { const t = str(e.footer?.text, 2048); if (t === undefined) return null; o.footer = { text: count(plain(t, 2048)) }; }
    if (e.fields !== undefined) {
      if (!Array.isArray(e.fields) || e.fields.length > 25) return null;
      o.fields = [];
      for (const f of e.fields) {
        const n = str(f?.name, 256), v = str(f?.value, 1024);
        if (!n || !v) return null;
        o.fields.push({ name: count(plain(n, 256)), value: count(plain(v, 1024)), inline: f.inline === true });
      }
    }
    if (!Object.keys(o).length) return null;
    out.push(o);
  }
  return total > LIMITS.embedTotal ? null : out;
}

const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
/** What a failed call becomes for the other module: the reason (closed list), the pause end when there is one. */
const failed = (r) => fail(r.reason, r.retryAt ? { retryAt: new Date(r.retryAt).toISOString() } : {});
const snow = store.snowflake;
const hashOf = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);

/** Notes what a call taught about the connection (token refused, bot not on the server, permission missing), and forgets it when the same thing works again. Never throws. */
export async function track(ctx, feature, r, { guild = false } = {}) {
  try {
    const cur = await store.healthOf(ctx);
    if (r.ok) { if (cur && (cur.state === "token" || cur.feature === feature || (guild && cur.state === "guild"))) await store.setHealth(ctx, null); return; }
    let next = null;
    if (r.reason === "forbidden" && r.code === "token") next = { state: "token" };
    else if (r.reason === "not_member" && guild) next = { state: "guild" };
    else if (r.reason === "forbidden" && r.code === CODE.missingPermissions) next = { state: "perms", feature };
    if (!next || (cur && cur.state === next.state && cur.feature === next.feature)) return;
    await store.setHealth(ctx, { ...next, since: new Date().toISOString() });
    await ctx.api.log?.write?.({ action: "connection.problem", level: "warn", data: { state: next.state, ...(next.feature ? { feature: next.feature } : {}) } });
  } catch { /* what the call returns matters more than what we note */ }
}
async function run(ctx, feature, req, opts) {
  const creds = await store.credsOf(ctx);
  const r = await dc.call(ctx, creds, req);
  await track(ctx, feature, r, opts);
  return r;
}
const safe = (fn) => async (ctx, args) => { try { return await fn(ctx, args && typeof args === "object" ? args : {}); } catch { return fail("failed"); } };
const messageIdOf = (r) => (r.ok && r.json && typeof r.json === "object" ? snow(r.json.id) : "");

/* ───────────── Messages ───────────── */
function messagePayload(a, { edit = false } = {}) {
  const content = a.content === undefined ? undefined : typeof a.content === "string" ? plain(a.content, LIMITS.content + 1) : null;
  if (content === null || (content !== undefined && content.length > LIMITS.content)) return null;
  const embeds = cleanEmbeds(a.embeds);
  if (embeds === null) return null;
  if (!edit && !content && !embeds.length) return null;
  if (edit && content === undefined && a.embeds === undefined) return null;
  return { ...(content === undefined ? {} : { content }), ...(a.embeds === undefined ? {} : { embeds }), allowed_mentions: { parse: [] } };
}

async function postMessage(ctx, a) {
  const channelId = snow(a.channelId);
  const body = channelId ? messagePayload(a) : null;
  if (!body) return fail("invalid_input");
  if (a.silent !== false) body.flags = FLAG_SILENT;   // silent unless the module asks otherwise
  const r = await run(ctx, "post", { method: "POST", path: `/channels/${channelId}/messages`, body });
  const messageId = messageIdOf(r);
  return r.ok && messageId ? { ok: true, messageId } : r.ok ? fail("failed") : failed(r);
}
async function editMessage(ctx, a) {
  const channelId = snow(a.channelId), messageId = snow(a.messageId);
  const body = channelId && messageId ? messagePayload(a, { edit: true }) : null;
  if (!body) return fail("invalid_input");
  const r = await run(ctx, "post", { method: "PATCH", path: `/channels/${channelId}/messages/${messageId}`, body });
  return r.ok ? { ok: true, messageId } : failed(r);
}
async function deleteMessage(ctx, a) {
  const channelId = snow(a.channelId), messageId = snow(a.messageId);
  if (!channelId || !messageId) return fail("invalid_input");
  const r = await run(ctx, "post", { method: "DELETE", path: `/channels/${channelId}/messages/${messageId}` });
  if (!r.ok && r.reason !== "not_found") return failed(r);   // already gone: the goal is reached
  await store.serial(ctx, async () => { for (const d of await store.managedList(ctx)) if (d.data.messageId === messageId) await ctx.api.store.remove(d.id); }).catch(() => {});
  return { ok: true };
}

/**
 * ONE message kept up to date for (owner, key): created the first time, edited in place afterwards, created again once if a person deleted it.
 * Nothing is sent when the content did not change. `owner` is the id of the module that asks: it only namespaces the keys (the core does not tell a service who calls).
 */
async function upsertManagedMessage(ctx, a) {
  const owner = typeof a.owner === "string" && /^[a-z0-9][a-z0-9-]{0,40}$/.test(a.owner) ? a.owner : "";
  const key = typeof a.key === "string" && /^[A-Za-z0-9._:-]{1,80}$/.test(a.key) ? a.key : "";
  const channelId = snow(a.channelId);
  const body = owner && key && channelId ? messagePayload({ ...a, content: a.content ?? "", embeds: a.embeds ?? [] }) : null;
  if (!body || (!body.content && !(body.embeds ?? []).length)) return fail("invalid_input");
  const silent = a.silent !== false;
  const id = `${owner}:${key}`;
  const digest = hashOf({ channelId, c: body.content ?? "", e: body.embeds ?? [] });
  return store.serial(ctx, async () => {
    const doc = (await store.managedList(ctx)).find((d) => d.data.id === id) ?? null;
    const label = typeof a.label === "string" ? plain(a.label, 60).trim() : "";
    const save = (messageId) => store.put(ctx, store.COL.managed, doc, { id, owner, key, ...(label ? { label } : {}), channelId, messageId, hash: digest, at: new Date().toISOString() });
    const create = async (action) => {
      const r = await run(ctx, "post", { method: "POST", path: `/channels/${channelId}/messages`, body: { ...body, ...(silent ? { flags: FLAG_SILENT } : {}) } });
      const messageId = messageIdOf(r);
      if (!messageId) return r.ok ? fail("failed") : failed(r);
      if (!doc && (await store.managedList(ctx)).length >= store.LIMITS.managed) return fail("failed", { messageId });
      await save(messageId);
      return { ok: true, messageId, action };
    };
    if (!doc) return create("created");
    const { channelId: was, messageId } = doc.data;
    if (was !== channelId) {   // another channel: the new message first, then the old one goes (best effort)
      const made = await create("created");
      if (made.ok) await dc.call(ctx, await store.credsOf(ctx), { method: "DELETE", path: `/channels/${was}/messages/${messageId}`, priority: "background" });
      return made;
    }
    if (doc.data.hash === digest) return { ok: true, messageId, action: "unchanged" };
    const r = await run(ctx, "post", { method: "PATCH", path: `/channels/${channelId}/messages/${messageId}`, body: { content: body.content ?? "", embeds: body.embeds ?? [], allowed_mentions: body.allowed_mentions } });
    if (r.ok) { await save(messageId); return { ok: true, messageId, action: "edited" }; }
    if (r.reason === "not_found") {   // a person deleted it: once, we write it again
      await ctx.api.log?.write?.({ action: "message.recreated", target: id });
      return create("recreated");
    }
    return failed(r);
  });
}
async function forgetManagedMessage(ctx, a) {
  const owner = typeof a.owner === "string" ? a.owner : "", key = typeof a.key === "string" ? a.key : "";
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(owner) || !/^[A-Za-z0-9._:-]{1,80}$/.test(key)) return fail("invalid_input");
  const id = `${owner}:${key}`;
  const doc = (await store.managedList(ctx)).find((d) => d.data.id === id);
  if (!doc) return { ok: true };
  const r = await run(ctx, "post", { method: "DELETE", path: `/channels/${doc.data.channelId}/messages/${doc.data.messageId}` });
  if (!r.ok && r.reason !== "not_found") return failed(r);
  await ctx.api.store.remove(doc.id);
  return { ok: true };
}

/* ───────────── Threads ───────────── */
const ARCHIVE_MINUTES = 10080;   // seven days of silence
async function createPrivateThread(ctx, a) {
  const channelId = snow(a.channelId), userId = snow(a.userId);
  const staffRoleId = a.staffRoleId === undefined || a.staffRoleId === null || a.staffRoleId === "" ? "" : snow(a.staffRoleId);
  const intro = a.intro === undefined ? "" : typeof a.intro === "string" ? a.intro : null;
  if (!channelId || !userId || (a.staffRoleId && !staffRoleId) || intro === null) return fail("invalid_input");   // every number is checked BEFORE any call
  const made = await run(ctx, "privateThread", { method: "POST", path: `/channels/${channelId}/threads`, body: { name: threadName(a.name), auto_archive_duration: ARCHIVE_MINUTES, type: 12, invitable: false } });
  const threadId = made.ok ? snow(made.json?.id) : "";
  if (!threadId) return made.ok ? fail("failed") : failed(made);
  const add = await run(ctx, "privateThread", { method: "PUT", path: `/channels/${threadId}/thread-members/${userId}`, member: true });
  if (!add.ok) return { ...failed(add), threadId };
  const hello = `<@${userId}>${staffRoleId ? ` <@&${staffRoleId}>` : ""}${intro ? `\n${plain(intro, LIMITS.intro)}` : ""}`;
  const said = await run(ctx, "privateThread", { method: "POST", path: `/channels/${threadId}/messages`, body: { content: hello, allowed_mentions: { parse: [], users: [userId], roles: staffRoleId ? [staffRoleId] : [] } } });
  if (!said.ok) return { ...failed(said), threadId };
  return { ok: true, threadId };
}
async function createThread(ctx, a) {
  const channelId = snow(a.channelId), messageId = a.messageId === undefined ? "" : snow(a.messageId);
  if (!channelId || (a.messageId !== undefined && !messageId) || (messageId && a.privateThread === true)) return fail("invalid_input");
  const name = threadName(a.name);
  const feature = a.privateThread === true ? "privateThread" : "publicThread";
  const req = messageId
    ? { method: "POST", path: `/channels/${channelId}/messages/${messageId}/threads`, body: { name, auto_archive_duration: ARCHIVE_MINUTES } }
    : { method: "POST", path: `/channels/${channelId}/threads`, body: { name, auto_archive_duration: ARCHIVE_MINUTES, type: a.privateThread === true ? 12 : 11, ...(a.privateThread === true ? { invitable: false } : {}) } };
  const r = await run(ctx, feature, req);
  const threadId = r.ok ? snow(r.json?.id) : "";
  return threadId ? { ok: true, threadId } : r.ok ? fail("failed") : failed(r);
}
async function setThreadArchived(ctx, a) {
  const threadId = snow(a.threadId);
  if (!threadId || typeof a.archived !== "boolean") return fail("invalid_input");
  const r = await run(ctx, "archive", { method: "PATCH", path: `/channels/${threadId}`, body: a.archived ? { archived: true, locked: true } : { archived: false, locked: false } });
  if (!r.ok && a.archived && r.code === CODE.archivedThread) return { ok: true };   // already archived
  return r.ok ? { ok: true } : failed(r);
}

/* ───────────── Lists, status ───────────── */
const lists = new Map();   // "<instance>:channels" → { until, value }
export const resetLists = () => { lists.clear(); stats.clear(); };
async function listOf(ctx, kind, build) {
  const creds = await store.credsOf(ctx);
  if (!store.hasBot(creds)) return fail("not_configured");
  const k = `${ctx.instance?.id ?? "x"}:${kind}:${creds.guildId}`;
  const hit = lists.get(k);
  if (hit && hit.until > Date.now()) return { ok: true, [kind]: structuredClone(hit.value) };
  const r = await run(ctx, "list", { method: "GET", path: `/guilds/${creds.guildId}/${kind === "channels" ? "channels" : "roles"}`, guild: true }, { guild: true });
  if (!r.ok) return failed(r);
  const rows = Array.isArray(r.json) ? r.json : [];
  const value = build(rows, creds).slice(0, LIMITS.list);
  lists.set(k, { until: Date.now() + 60_000, value }); if (lists.size > 20) lists.delete(lists.keys().next().value);
  return { ok: true, [kind]: structuredClone(value) };
}
const named = (x) => (typeof x?.name === "string" && x.name && snow(x.id) ? { id: x.id, name: x.name.replace(CONTROL, "").slice(0, 100) } : null);
/** Text and announcement channels, in the order of the server (categories first by position). */
const textChannels = (rows) => {
  const cats = new Map(rows.filter((c) => c?.type === 4).map((c) => [c.id, c.position ?? 0]));
  return rows.filter((c) => c && (c.type === 0 || c.type === 5)).sort((a, b) => (cats.get(a.parent_id) ?? -1) - (cats.get(b.parent_id) ?? -1) || (a.position ?? 0) - (b.position ?? 0)).map(named).filter(Boolean);
};
const roleList = (rows, creds) => rows.filter((r) => r && r.id !== creds.guildId && !r.managed).sort((a, b) => (b.position ?? 0) - (a.position ?? 0)).map(named).filter(Boolean);
const listChannels = (ctx) => listOf(ctx, "channels", textChannels);
const listRoles = (ctx) => listOf(ctx, "roles", roleList);
const fold = (t) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** The channel picker of the core (`choice` setting, source "service"): search by name, a stable number as the value. A Discord failure gives an empty answer, never a guess. */
async function channelChoices(ctx, a = {}) {
  const r = await listChannels(ctx);
  if (!r.ok) return { items: [], next: null };
  const q = fold(typeof a.q === "string" ? a.q.slice(0, 100) : "");
  const limit = Math.min(50, Math.max(1, Number(a.limit) || 20));
  const rows = r.channels.filter((c) => !q || fold(c.name).includes(q));
  return { items: rows.slice(0, limit).map((c) => ({ id: c.id, label: `#${c.name}` })), next: null };
}
async function channelsByIds(ctx, a = {}) {
  const ids = (Array.isArray(a.ids) ? a.ids : []).map(snow).filter(Boolean).slice(0, 50);
  const r = await listChannels(ctx);
  if (!r.ok) return { items: [], missing: [] };   // unknown: neither found nor gone
  const by = new Map(r.channels.map((c) => [c.id, c]));
  return { items: ids.filter((i) => by.has(i)).map((i) => ({ id: i, label: `#${by.get(i).name}` })), missing: ids.filter((i) => !by.has(i)) };
}
/** Approximate member counts of the server (what Discord shows publicly), kept 5 minutes so that a public page may ask as often as it likes. */
const stats = new Map();   // "<instance>:<guild>" → { until, value }
const STATS_MS = 5 * 60_000;
const count = (n) => (Number.isInteger(n) && n >= 0 && n <= 1e9 ? n : undefined);
async function guildStats(ctx) {
  const creds = await store.credsOf(ctx);
  if (!store.hasBot(creds)) return fail("not_configured");
  const k = `${ctx.instance?.id ?? "x"}:${creds.guildId}`;
  const hit = stats.get(k);
  if (hit && hit.until > Date.now()) return { ok: true, ...hit.value };
  const r = await run(ctx, "stats", { method: "GET", path: `/guilds/${creds.guildId}?with_counts=true`, guild: true, priority: "background" }, { guild: true });
  if (!r.ok) return failed(r);
  const memberCount = count(r.json?.approximate_member_count), onlineCount = count(r.json?.approximate_presence_count);
  if (memberCount === undefined) return fail("failed");
  const value = { memberCount, ...(onlineCount === undefined ? {} : { onlineCount }) };
  stats.set(k, { until: Date.now() + STATS_MS, value }); if (stats.size > 20) stats.delete(stats.keys().next().value);
  return { ok: true, ...value };
}
async function status(ctx) {
  const c = await store.credsOf(ctx);
  return { ok: true, bot: store.hasBot(c), oauth: false, ...(c.guildId ? { guildId: c.guildId } : {}) };
}

/** The methods of the service, as the core calls them: (ctx, args). */
export const methods = {
  status: safe(status),
  createPrivateThread: safe(createPrivateThread),
  setThreadArchived: safe(setThreadArchived),
  postMessage: safe(postMessage),
  listChannels: safe(listChannels),
  listRoles: safe(listRoles),
  guildStats: safe(guildStats),
  editMessage: safe(editMessage),
  deleteMessage: safe(deleteMessage),
  upsertManagedMessage: safe(upsertManagedMessage),
  forgetManagedMessage: safe(forgetManagedMessage),
  createThread: safe(createThread),
  channelChoices: safe(channelChoices),
  channelsByIds: safe(channelsByIds),
};
export const READ_ONLY = ["status", "listChannels", "listRoles", "guildStats", "channelChoices", "channelsByIds"];
