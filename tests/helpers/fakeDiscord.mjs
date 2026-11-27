// A fake Discord (REST v10) for the tests: it answers the few routes the connector uses, keeps what was posted, and records every call (method, path, body,
// whether the Authorization header carried the right bot code). Behind the REAL network client of the core (ctx.api.net), through globalThis.fetch. No network.
export const OTHER_GUILD = "299999999999999999", OTHER_CHANNEL = "460000000000000009", OTHER_THREAD = "460000000000000010";   // a channel of ANOTHER server the bot is also on
export const BOT_CODE = "TESTBOTCODE.abcdefghij.0123456789_ABCDEFGH";
export const IDS = { app: "100000000000000001", guild: "200000000000000001", bot: "300000000000000001", general: "400000000000000001", news: "400000000000000002", staff: "500000000000000001", person: "600000000000000001", stranger: "600000000000000999" };
let seq = 700000000000000000n;
const nextId = () => String(++seq);

const json = (status, body, headers = {}) => ({ status, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const empty = (status = 204) => ({ status, headers: {}, body: "" });
const err = (status, code, message = "error") => json(status, { code, message });

export function fakeDiscord({ code = BOT_CODE, inGuild = true, roles, members, permissions = "395137010688", overwrites = {}, moreChannels = [] } = {}) {
  const log = [];
  const messages = new Map();   // channel/thread id → [{ id, content, embeds, flags, allowed_mentions }]
  const threads = new Map();    // id → { parent, name, type, archived, locked, members:Set }
  const state = { code, inGuild, rateUntil: 0, down: false, loseReplies: 0, extraHeaders: null, nonces: new Map(), counts: { members: 1234, online: 56 }, forced: [], deleted: new Set() };
  const guildRoles = roles ?? [
    { id: IDS.guild, name: "@everyone", permissions, position: 0, managed: false },
    { id: IDS.staff, name: "Helpers", permissions: "0", position: 3, managed: false },
    { id: "500000000000000002", name: "Bot role", permissions: "0", position: 2, managed: true },
  ];
  const guildMembers = members ?? { [IDS.bot]: { roles: [] } };
  const channels = [
    { id: "450000000000000001", type: 4, name: "Info", position: 0 },
    { id: IDS.news, type: 5, name: "news", position: 1, parent_id: "450000000000000001" },
    { id: IDS.general, type: 0, name: "general", position: 0, parent_id: "450000000000000001" },
    { id: "400000000000000003", type: 2, name: "voice", position: 2 },
    ...moreChannels,
  ].map((c) => (overwrites[c.id] ? { ...c, permission_overwrites: overwrites[c.id] } : c));   // `overwrites`: channel number → permission overwrites ({ id, type: 0 role | 1 member, allow, deny })
  const known = new Set([...channels.map((c) => c.id), OTHER_CHANNEL]);
  const route = (method, path, body, auth, search = "") => {
    if (state.down) throw new TypeError("fetch failed");
    if (state.rateUntil > Date.now()) return json(429, { message: "You are being rate limited.", retry_after: Math.ceil((state.rateUntil - Date.now()) / 1000), global: false, code: 0 }, { "retry-after": String(Math.ceil((state.rateUntil - Date.now()) / 1000)) });
    for (const f of state.forced) if (f.method === method && f.re.test(path) && f.times !== 0) { if (f.times > 0) f.times--; return typeof f.reply === "function" ? f.reply(body) : f.reply; }
    if (auth !== `Bot ${state.code}`) return err(401, 0, "401: Unauthorized");
    let m;
    if (method === "GET" && path === "/users/@me") return json(200, { id: IDS.bot, username: "Test bot", bot: true });
    if ((m = /^\/guilds\/(\d+)(\/.*)?$/.exec(path))) {
      if (!state.inGuild || m[1] !== IDS.guild) return err(m[1] === IDS.guild ? 403 : 404, m[1] === IDS.guild ? 50001 : 10004, "Missing Access");
      if (method === "GET" && m[2] === undefined) return json(200, { id: IDS.guild, name: "Demo server", ...(search.includes("with_counts=true") ? { approximate_member_count: state.counts.members, approximate_presence_count: state.counts.online } : {}) });
      if (method === "GET" && m[2] === "/channels") return json(200, channels);
      if (method === "GET" && m[2] === "/roles") return json(200, guildRoles);
      if ((m = /^\/members\/(\d+)$/.exec(m[2] ?? "")) && method === "GET") return guildMembers[m[1]] ? json(200, { user: { id: m[1] }, ...guildMembers[m[1]] }) : err(404, 10007, "Unknown Member");
    }
    if (method === "GET" && (m = /^\/channels\/(\d+)$/.exec(path))) {
      const c = channels.find((x) => x.id === m[1]);
      if (c) return json(200, { id: c.id, type: c.type, name: c.name, guild_id: IDS.guild, ...(c.parent_id ? { parent_id: c.parent_id } : {}) });
      if (m[1] === OTHER_CHANNEL) return json(200, { id: OTHER_CHANNEL, type: 0, name: "elsewhere", guild_id: OTHER_GUILD });
      if (m[1] === OTHER_THREAD) return json(200, { id: OTHER_THREAD, type: 11, name: "elsewhere thread", guild_id: OTHER_GUILD });
      const t = threads.get(m[1]); if (t) return json(200, { id: m[1], type: t.type ?? 11, name: t.name, guild_id: IDS.guild, parent_id: t.parent });
      return err(404, 10003, "Unknown Channel");
    }
    if (method === "POST" && (m = /^\/channels\/(\d+)\/threads$/.exec(path))) {
      if (!known.has(m[1])) return err(404, 10003, "Unknown Channel");
      const id = nextId(); threads.set(id, { parent: m[1], name: body.name, type: body.type, body, archived: false, locked: false, members: new Set([IDS.bot]) }); return json(201, { id, type: body.type ?? 11, name: body.name });
    }
    if (method === "POST" && (m = /^\/channels\/(\d+)\/messages\/(\d+)\/threads$/.exec(path))) {
      const id = m[2]; threads.set(id, { parent: m[1], name: body.name, type: 11, body, archived: false, locked: false, members: new Set([IDS.bot]) }); return json(201, { id, type: 11, name: body.name });
    }
    if (method === "PUT" && (m = /^\/channels\/(\d+)\/thread-members\/(\d+)$/.exec(path))) {
      const t = threads.get(m[1]); if (!t) return err(404, 10003, "Unknown Channel");
      if (m[2] === IDS.stranger) return err(404, 10013, "Unknown User");
      t.members.add(m[2]); return empty();
    }
    if (method === "PATCH" && (m = /^\/channels\/(\d+)$/.exec(path)) && threads.has(m[1])) {
      const t = threads.get(m[1]);
      if (t.archived && body.archived !== false) return err(403, 50083, "Thread is archived");
      Object.assign(t, { archived: body.archived ?? t.archived, locked: body.locked ?? t.locked }); return json(200, { id: m[1] });
    }
    if (method === "POST" && (m = /^\/channels\/(\d+)\/messages$/.exec(path))) {
      if (!known.has(m[1]) && !threads.has(m[1])) return err(404, 10003, "Unknown Channel");
      if (body.enforce_nonce && body.nonce && state.nonces.has(`${m[1]}:${body.nonce}`)) return json(200, { id: state.nonces.get(`${m[1]}:${body.nonce}`), channel_id: m[1] });   // the same request again: the message that exists
      const id = nextId(); const msg = { id, author: IDS.bot, ...body }; messages.set(m[1], [...(messages.get(m[1]) ?? []), msg]);
      if (body.enforce_nonce && body.nonce) state.nonces.set(`${m[1]}:${body.nonce}`, id);
      return json(200, { id, channel_id: m[1] });
    }
    if ((method === "PATCH" || method === "DELETE") && (m = /^\/channels\/(\d+)\/messages\/(\d+)$/.exec(path))) {
      const list = messages.get(m[1]) ?? []; const i = list.findIndex((x) => x.id === m[2]);
      if (i < 0) return err(404, 10008, "Unknown Message");
      if (list[i].author !== IDS.bot) return err(403, method === "PATCH" ? 50005 : 50013, "Cannot edit a message authored by another user");   // the bot has no "Manage Messages"
      if (method === "DELETE") { list.splice(i, 1); state.deleted.add(m[2]); return empty(); }
      list[i] = { ...list[i], ...body }; return json(200, { id: m[2] });
    }
    return err(404, 0, "404: Not Found");
  };
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const path = u.pathname.replace(/^\/api\/v10/, "");
    const body = init.body ? JSON.parse(init.body) : undefined;
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const entry = { method: init.method ?? "GET", host: u.host, path, query: u.search, body, userAgent: headers["user-agent"], authOk: headers.authorization === `Bot ${state.code}` };
    log.push(entry);
    const r = route(entry.method, path, body, headers.authorization, u.search);
    if (state.loseReplies > 0 && entry.method === "POST" && /\/messages$/.test(path)) { state.loseReplies--; throw new TypeError("fetch failed");   /* the request was done, the answer never came back */ }
    const extra = state.extraHeaders; state.extraHeaders = null;
    return new Response(r.body || null, { status: r.status, headers: { ...r.headers, ...(extra ?? {}) } });
  };
  return {
    fetch, log, messages, threads, state,
    calls: (method, re) => log.filter((c) => (!method || c.method === method) && (!re || re.test(c.path))),
    /** Force an answer for the next `times` calls to a route (default: forever). */
    force: (method, re, reply, times = -1) => { state.forced.push({ method, re, reply, times }); },
    unforce: () => { state.forced.length = 0; },
    rateLimit: (seconds) => { state.rateUntil = Date.now() + seconds * 1000; },
    postedIn: (id) => messages.get(id) ?? [],
    /** A message somebody else wrote (a person): the bot may neither edit nor delete it. */
    foreign: (channelId, content = "hello") => { const id = nextId(); messages.set(channelId, [...(messages.get(channelId) ?? []), { id, author: IDS.person, content }]); return id; },
    /** The next `n` answers are lost on the way back (timeout): what was asked IS done on Discord. */
    loseReplies: (n = 1) => { state.loseReplies = n; },
    /** Headers added to the next answer (x-ratelimit-remaining…). */
    nextHeaders: (h) => { state.extraHeaders = h; },
  };
}
export { err as discordError, json as discordJson };
