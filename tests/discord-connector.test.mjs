// Discord connector 1.0.0: the service `discord.api` v1 (closed answers, exact calls and bodies), silent messages, messages kept up to date, pauses after "too many requests",
// no secret anywhere, and the card in its three states. No network: the fake Discord (tests/helpers/fakeDiscord.mjs) answers behind the REAL network client of the core.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readFileSync } from "node:fs";
import { fakeDiscord, discordError, discordJson, BOT_CODE, IDS, OTHER_CHANNEL, OTHER_THREAD } from "./helpers/fakeDiscord.mjs";
import { connector, connectorModule, connectorDef } from "./helpers/discordConnector.mjs";
import { assertConnectionStates } from "./helpers/connectionKit.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/discord-connector", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8")), fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
const dc = await import("../modules/discord-connector/discord.mjs");
const svc = await import("../modules/discord-connector/service.mjs");
const realFetch = globalThis.fetch;
const heard = [];
const spies = {};
let d;
beforeEach(() => {
  connectorModule.resetCache();
  d = fakeDiscord();
  globalThis.fetch = (u, i) => d.fetch(u, i);
  heard.length = 0;
  for (const m of ["log", "info", "warn", "error", "debug"]) { spies[m] = console[m]; console[m] = (...a) => heard.push(a.map(String).join(" ")); }
});
afterEach(() => { globalThis.fetch = realFetch; for (const m of Object.keys(spies)) console[m] = spies[m]; });
/** The calls to Discord without the cheap "which channel is this" looks (those are tested on their own). */
const W = () => d.log.filter((c) => !(c.method === "GET" && /^\/channels\/\d+$/.test(c.path)));
const mk = (o = {}) => connector({ messages: en, ...o });
const REASONS = ["not_configured", "invalid_input", "forbidden", "not_found", "not_member", "rate_limited", "unavailable", "failed"];
const closed = (r) => { assert.equal(typeof r.ok, "boolean"); if (!r.ok) assert.ok(REASONS.includes(r.reason), `reason ${r.reason}`); return r; };
const noSecret = (value, what) => assert.ok(!JSON.stringify(value).includes(BOT_CODE) && !JSON.stringify(value).includes("TESTBOTCODE"), `${what}: the bot code leaked`);

// ── Manifest ─────────────────────────────────────────────────────────────────

test("manifest: valid, one instance, discord.api v1 NOT each, no setting, platform discord, MCP tool read-only with a right", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.id, "discord-connector");
  assert.equal(manifest.instances, "single");
  assert.equal(manifest.platform, "discord");
  assert.deepEqual(manifest.offers.map((o) => [o.service, o.version, o.each ?? false]), [["discord.api", 1, false]]);
  assert.deepEqual(manifest.offers[0].readOnly, ["status", "listChannels", "listRoles", "guildStats", "channelChoices", "channelsByIds"]);
  assert.ok(!manifest.requires);
  assert.deepEqual(manifest.settings, []);
  assert.deepEqual(manifest.mcp.map((t) => [t.name, t.readOnly, t.right]), [["connector_discord_status", true, "open"]]);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  assert.deepEqual(Object.keys(connectorDef.services["discord.api"]).sort(), ["channelChoices", "channelsByIds", "createPrivateThread", "createThread", "deleteMessage", "editMessage", "forgetManagedMessage", "guildStats", "listChannels", "listRoles", "postMessage", "setThreadArchived", "status", "upsertManagedMessage"]);
});

test("the module never uses fetch directly and never logs", () => {
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith(".mjs"))) {
    const src = fs.readFileSync(`${DIR}/${f}`, "utf8").replace(/\/\/.*$/gm, "");
    assert.ok(!/\bfetch\s*\(/.test(src), `${f}: fetch(`);
    assert.ok(!/console\.(log|info|warn|error|debug)/.test(src), `${f}: console`);
  }
});

// ── Permissions and invitation ───────────────────────────────────────────────

test("permissions: the number is the union of what the features need, each bit as in Discord's documentation", () => {
  const bit = (n) => 1n << BigInt(n);
  const want = bit(10) | bit(11) | bit(14) | bit(34) | bit(35) | bit(36) | bit(38);   // view, send, embed links, manage threads, public threads, private threads, send in threads
  assert.equal(dc.PERMISSIONS, want);
  assert.equal(dc.permissionsNumber(), "395137010688");
  const owners = 360777255936n;   // view + send + manage threads + private threads + send in threads (the five of the first brief)
  assert.equal(dc.PERMISSIONS & owners, owners);
  assert.equal(dc.PERMISSIONS & (bit(3) | bit(17) | bit(13)), 0n, "never administrator, mention everyone or manage messages");
});

test("invitation link: scope bot, the permission number, the application number; the secret code is nowhere", () => {
  const u = new URL(dc.inviteLink(IDS.app, IDS.guild));
  assert.equal(u.origin + u.pathname, "https://discord.com/oauth2/authorize");
  assert.equal(u.searchParams.get("client_id"), IDS.app);
  assert.equal(u.searchParams.get("scope"), "bot");
  assert.equal(u.searchParams.get("permissions"), dc.permissionsNumber());
  assert.equal(u.searchParams.get("guild_id"), IDS.guild);
  assert.equal(dc.inviteLink("abc", IDS.guild), null);
});

// ── createPrivateThread ──────────────────────────────────────────────────────

test("createPrivateThread: exact sequence (thread, person, opening message), bodies, headers, mentions limited to the person and the role", async () => {
  const C = mk();
  const r = closed(await C.methods.createPrivateThread({ channelId: IDS.general, name: "Ticket 42", userId: IDS.person, staffRoleId: IDS.staff, intro: "Hello, tell us more." }));
  assert.equal(r.ok, true); assert.match(r.threadId, /^\d{15,25}$/);
  assert.deepEqual(W().map((c) => `${c.method} ${c.path}`), [`POST /channels/${IDS.general}/threads`, `PUT /channels/${r.threadId}/thread-members/${IDS.person}`, `POST /channels/${r.threadId}/messages`]);
  assert.deepEqual(W()[0].body, { name: "Ticket 42", auto_archive_duration: 10080, type: 12, invitable: false });
  assert.equal(W()[1].body, undefined);
  assert.deepEqual(W()[2].body, { content: `<@${IDS.person}> <@&${IDS.staff}>\nHello, tell us more.`, allowed_mentions: { parse: [], users: [IDS.person], roles: [IDS.staff] } });
  for (const c of d.log) { assert.equal(c.host, "discord.com"); assert.equal(c.userAgent, "DiscordBot (https://github.com/helldog136/Curiosa, 1)"); assert.ok(c.authOk); }
  noSecret(r, "result");
});

test("createPrivateThread: the intro can never ping anybody else; the name is cleaned; without a role only the person can be mentioned", async () => {
  const C = mk();
  const r = await C.methods.createPrivateThread({ channelId: IDS.general, name: "  \u0007\n  ​ ", userId: IDS.person, intro: `@everyone @here <@${IDS.stranger}> <@&${IDS.staff}> <@!${IDS.stranger}>` });
  assert.equal(r.ok, true);
  assert.equal(W()[0].body.name, "thread", "never empty");
  const msg = W()[2].body;
  assert.deepEqual(msg.allowed_mentions, { parse: [], users: [IDS.person], roles: [] });
  assert.ok(!/@everyone|@here/.test(msg.content) && !msg.content.includes(`<@${IDS.stranger}>`) && !msg.content.includes(`<@&${IDS.staff}>`) && !msg.content.includes("<@!"), msg.content);
  const long = await C.methods.createPrivateThread({ channelId: IDS.general, name: "é".repeat(300), userId: IDS.person, intro: "x".repeat(5000) });
  assert.equal(long.ok, true);
  assert.equal([...W().filter((c) => c.path.endsWith("/threads")).at(-1).body.name].length, 100);
  assert.ok(W().at(-1).body.content.length <= 1600);
});

test("createPrivateThread: every number is checked BEFORE any call", async () => {
  const C = mk();
  for (const bad of [{ channelId: "12" }, { channelId: IDS.general, userId: "abc" }, { channelId: IDS.general, userId: IDS.person, staffRoleId: "x" }, { channelId: IDS.general, userId: IDS.person, intro: 5 }, { channelId: `${IDS.general}9`.repeat(5), userId: IDS.person }, {}]) {
    const r = await C.methods.createPrivateThread({ name: "t", ...bad });
    assert.deepEqual(closed(r), { ok: false, reason: "invalid_input" });
  }
  assert.equal(W().length, 0);
});

test("createPrivateThread: a failed step never looks like success and gives the thread number when the thread exists", async () => {
  const C = mk();
  const notMember = await C.methods.createPrivateThread({ channelId: IDS.general, name: "t", userId: IDS.stranger, intro: "hi" });
  assert.equal(notMember.ok, false); assert.equal(notMember.reason, "not_member"); assert.match(notMember.threadId, /^\d+$/);
  assert.equal(d.calls("POST", /messages$/).length, 0, "no opening message after a failed step");
  d.force("POST", /\/messages$/, discordError(403, 50013, "Missing Permissions"), 1);
  const noSay = await C.methods.createPrivateThread({ channelId: IDS.general, name: "t", userId: IDS.person });
  assert.equal(noSay.ok, false); assert.equal(noSay.reason, "forbidden"); assert.match(noSay.threadId, /^\d+$/);
  const noThread = await C.methods.createPrivateThread({ channelId: "400000000000000777", name: "t", userId: IDS.person });
  assert.deepEqual(noThread, { ok: false, reason: "not_found" });
});

test("setThreadArchived: archive also locks, reopening unlocks, an already archived thread is fine", async () => {
  const C = mk();
  const { threadId } = await C.methods.createPrivateThread({ channelId: IDS.general, name: "t", userId: IDS.person });
  assert.deepEqual(await C.methods.setThreadArchived({ threadId, archived: true }), { ok: true });
  assert.deepEqual(d.calls("PATCH")[0].body, { archived: true, locked: true });
  assert.deepEqual(await C.methods.setThreadArchived({ threadId, archived: true }), { ok: true });
  assert.deepEqual(await C.methods.setThreadArchived({ threadId, archived: false }), { ok: true });
  assert.deepEqual(d.calls("PATCH").at(-1).body, { archived: false, locked: false });
  assert.deepEqual(await C.methods.setThreadArchived({ threadId: "x", archived: true }), { ok: false, reason: "invalid_input" });
  assert.deepEqual(await C.methods.setThreadArchived({ threadId, archived: "yes" }), { ok: false, reason: "invalid_input" });
});

test("createThread: public thread, from a message, or a private one; both at once is refused", async () => {
  const C = mk();
  const a = await C.methods.createThread({ channelId: IDS.general, name: "Talk" });
  assert.equal(a.ok, true); assert.deepEqual(W()[0].body, { name: "Talk", auto_archive_duration: 10080, type: 11 });
  const posted = await C.methods.postMessage({ channelId: IDS.general, content: "start" });
  const b = await C.methods.createThread({ channelId: IDS.general, name: "Reply", messageId: posted.messageId });
  assert.equal(b.ok, true); assert.equal(b.threadId, posted.messageId);
  assert.equal(W().at(-1).path, `/channels/${IDS.general}/messages/${posted.messageId}/threads`);
  const c = await C.methods.createThread({ channelId: IDS.general, name: "Private", privateThread: true });
  assert.equal(c.ok, true); assert.deepEqual(W().at(-1).body, { name: "Private", auto_archive_duration: 10080, type: 12, invitable: false });
  assert.deepEqual(await C.methods.createThread({ channelId: IDS.general, name: "x", messageId: posted.messageId, privateThread: true }), { ok: false, reason: "invalid_input" });
});

// ── Messages ─────────────────────────────────────────────────────────────────

test("postMessage: silent by default (flag 4096), nobody can be mentioned; silent:false removes the flag only", async () => {
  const C = mk();
  const r = closed(await C.methods.postMessage({ channelId: IDS.general, content: "Week @everyone <@123456789012345678>" }));
  assert.equal(r.ok, true); assert.match(r.messageId, /^\d+$/);
  const body = W()[0].body;
  assert.equal(body.flags, 4096); assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.ok(!body.content.includes("@everyone") && !body.content.includes("<@1"), body.content);
  await C.methods.postMessage({ channelId: IDS.general, content: "loud", silent: false });
  assert.equal(W()[1].body.flags, undefined); assert.deepEqual(W()[1].body.allowed_mentions, { parse: [] });
});

test("postMessage: limits (2000 characters, embeds 10 and 6000 in all), nothing sent when refused", async () => {
  const C = mk();
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, content: "x".repeat(2001) })).reason, "invalid_input");
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, content: "" })).reason, "invalid_input");
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, content: "ok", embeds: Array.from({ length: 11 }, () => ({ title: "t" })) })).reason, "invalid_input");
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, embeds: [{ description: "x".repeat(4096) }, { description: "y".repeat(2000) }] })).reason, "invalid_input");
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, embeds: [{ url: "http://insecure.example" }] })).reason, "invalid_input");
  assert.equal(W().length, 0);
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, content: "x".repeat(2000) })).ok, true);
  const e = await C.methods.postMessage({ channelId: IDS.general, embeds: [{ title: "Week", description: "a\n@everyone", color: 0xff0000, fields: [{ name: "Mon", value: "Stream", inline: true }], footer: { text: "f" } }] });
  assert.equal(e.ok, true); assert.ok(!JSON.stringify(W().at(-1).body).includes("@everyone"));
});

test("editMessage and deleteMessage: only messages the bot itself sent (a foreign or unknown message is refused before any call), deleting twice is fine", async () => {
  const C = mk();
  const { messageId } = await C.methods.postMessage({ channelId: IDS.general, content: "v1" });
  assert.deepEqual(await C.methods.editMessage({ channelId: IDS.general, messageId, content: "v2" }), { ok: true, messageId });
  assert.equal(d.postedIn(IDS.general)[0].content, "v2");
  assert.equal((await C.methods.editMessage({ channelId: IDS.general, messageId })).reason, "invalid_input");
  const foreign = d.foreign(IDS.general, "a person wrote this");
  const before = W().length;
  assert.equal((await C.methods.editMessage({ channelId: IDS.general, messageId: foreign, content: "x" })).reason, "forbidden");
  assert.equal((await C.methods.deleteMessage({ channelId: IDS.general, messageId: foreign })).reason, "forbidden");
  assert.equal((await C.methods.editMessage({ channelId: IDS.general, messageId: "400000000000000555", content: "x" })).reason, "forbidden");
  assert.equal(W().length, before, "refused without any write call");
  assert.ok(d.postedIn(IDS.general).some((m) => m.id === foreign && m.content === "a person wrote this"), "the foreign message is untouched");
  d.force("DELETE", /messages/, discordError(403, 50013, "Missing Permissions"), 1);
  assert.equal((await C.methods.deleteMessage({ channelId: IDS.general, messageId })).reason, "forbidden");
  assert.deepEqual(await C.methods.deleteMessage({ channelId: IDS.general, messageId }), { ok: true });
  assert.deepEqual(await C.methods.deleteMessage({ channelId: IDS.general, messageId }), { ok: true });
});

test("upsertManagedMessage: created once, nothing sent when unchanged, edited in place, written again once when a person deleted it", async () => {
  const C = mk();
  const base = { owner: "planning", key: "week", label: "Week", channelId: IDS.general };
  const a = await C.methods.upsertManagedMessage({ ...base, content: "Mon: stream" });
  assert.equal(a.ok, true); assert.equal(a.action, "created");
  assert.equal(W()[0].body.flags, 4096, "silent by default");
  const calls = W().length;
  const same = await C.methods.upsertManagedMessage({ ...base, content: "Mon: stream" });
  assert.deepEqual(same, { ok: true, messageId: a.messageId, action: "unchanged" });
  assert.equal(W().length, calls, "idempotent: no call when the content is the same");
  const b = await C.methods.upsertManagedMessage({ ...base, content: "Mon: stream\nTue: stream" });
  assert.equal(b.action, "edited"); assert.equal(b.messageId, a.messageId);
  const patch = d.calls("PATCH").at(-1);
  assert.equal(patch.path, `/channels/${IDS.general}/messages/${a.messageId}`);
  assert.deepEqual(patch.body, { content: "Mon: stream\nTue: stream", embeds: [], allowed_mentions: { parse: [] } });
  assert.equal(d.postedIn(IDS.general).length, 1);
  // a person deletes it
  d.messages.set(IDS.general, []);
  const c = await C.methods.upsertManagedMessage({ ...base, content: "Wed: stream" });
  assert.equal(c.action, "recreated"); assert.notEqual(c.messageId, a.messageId);
  assert.equal(d.postedIn(IDS.general).length, 1);
  assert.deepEqual(C.ctx.calls.log.map((l) => l.action), ["message.recreated"]);
  const kept = C.ctx.dumpStore().filter((r) => r.collection === "discordManaged");
  assert.equal(kept.length, 1); assert.equal(kept[0].data.messageId, c.messageId);
  assert.equal(JSON.stringify(kept).includes(BOT_CODE), false);
});

test("upsertManagedMessage: one key per module, a refused write keeps the old message, a new channel moves it", async () => {
  const C = mk();
  const a = await C.methods.upsertManagedMessage({ owner: "planning", key: "week", channelId: IDS.general, content: "A" });
  const b = await C.methods.upsertManagedMessage({ owner: "ticketing", key: "week", channelId: IDS.general, content: "B" });
  assert.notEqual(a.messageId, b.messageId, "same key, other module: another message");
  assert.equal(d.postedIn(IDS.general).length, 2);
  assert.equal((await C.methods.upsertManagedMessage({ owner: "Planning!", key: "week", channelId: IDS.general, content: "x" })).reason, "invalid_input");
  assert.equal((await C.methods.upsertManagedMessage({ owner: "planning", key: "week", channelId: IDS.general, content: "x".repeat(2001) })).reason, "invalid_input");
  assert.equal((await C.methods.upsertManagedMessage({ owner: "planning", key: "week", channelId: IDS.general })).reason, "invalid_input");
  const moved = await C.methods.upsertManagedMessage({ owner: "planning", key: "week", channelId: IDS.news, content: "A" });
  assert.equal(moved.action, "created");
  assert.equal(d.postedIn(IDS.news).length, 1);
  assert.deepEqual(d.postedIn(IDS.general).map((m) => m.content), ["B"], "the old message is gone");
  d.force("PATCH", /messages/, discordError(403, 50013, "Missing Permissions"), 1);
  const refused = await C.methods.upsertManagedMessage({ owner: "planning", key: "week", channelId: IDS.news, content: "A2" });
  assert.deepEqual(refused, { ok: false, reason: "forbidden", scope: "channel" });
  assert.equal(d.postedIn(IDS.news).length, 1);
  assert.deepEqual(await C.methods.forgetManagedMessage({ owner: "planning", key: "week" }), { ok: true });
  assert.equal(d.postedIn(IDS.news).length, 0);
});

test("upsertManagedMessage: two simultaneous updates of the same key make one message", async () => {
  const C = mk();
  const args = { owner: "planning", key: "week", channelId: IDS.general, content: "A" };
  const [x, y] = await Promise.all([C.methods.upsertManagedMessage(args), C.methods.upsertManagedMessage({ ...args, content: "B" })]);
  assert.equal(x.ok && y.ok, true);
  assert.equal(d.postedIn(IDS.general).length, 1);
  assert.equal(d.postedIn(IDS.general)[0].content, "B");
});

// ── Lists, status ────────────────────────────────────────────────────────────

test("channel picker of the core: search without case or accents, a stable number as value, gone channels reported, a Discord failure is never a guess", async () => {
  const C = mk();
  assert.deepEqual(await C.methods.channelChoices({ q: "GÉNÉ" }), { items: [{ id: IDS.general, label: "#general" }], next: null });
  assert.equal((await C.methods.channelChoices({ limit: 1 })).items.length, 1);
  assert.deepEqual(await C.methods.channelsByIds({ ids: [IDS.news, "123456789012345678", "nope"] }), { items: [{ id: IDS.news, label: "#news" }], missing: ["123456789012345678"] });
  d.state.down = true; svc.resetLists();
  await assert.rejects(() => C.methods.channelsByIds({ ids: [IDS.news] }), /discord_unavailable/, "a failure THROWS so the core keeps the value as unverified, never as missing");
  await assert.rejects(() => C.methods.channelChoices({ q: "g" }), /discord_unavailable/);
  d.state.down = false;
});

test("guildStats: approximate counts only, one call per 5 minutes, closed reasons, no secret", async () => {
  const C = mk();
  assert.deepEqual(await C.methods.guildStats({}), { ok: true, memberCount: 1234, onlineCount: 56 });
  const hit = W().filter((c) => c.method === "GET" && c.path === `/guilds/${IDS.guild}`);
  assert.equal(hit.length, 1); assert.equal(hit[0].query, "?with_counts=true"); assert.equal(hit[0].authOk, true);
  for (let i = 0; i < 20; i++) await C.methods.guildStats({});
  assert.equal(W().filter((c) => c.path === `/guilds/${IDS.guild}`).length, 1, "cached: a public page may ask freely");
  svc.resetLists();
  d.state.counts = { members: 7, online: undefined };
  assert.deepEqual(await C.methods.guildStats({}), { ok: true, memberCount: 7 }, "an absent online count is left out");
  svc.resetLists(); d.state.counts = { members: "many", online: 1 };
  assert.deepEqual(await C.methods.guildStats({}), { ok: false, reason: "failed" });
  svc.resetLists(); d.state.inGuild = false;
  assert.equal(closed(await C.methods.guildStats({})).ok, false);
  svc.resetLists(); d.state.inGuild = true; d.state.counts = { members: 5, online: 1 }; d.state.down = true;
  assert.deepEqual(await C.methods.guildStats({}), { ok: false, reason: "unavailable" });
  d.state.down = false;
  noSecret([await C.methods.guildStats({})], "stats");
  svc.resetLists(); d.state.rateUntil = Date.now() + 30_000;
  assert.equal((await C.methods.guildStats({})).reason, "rate_limited", "a site-wide pause is respected");
});

test("lists: text channels and roles as { id, name }, no @everyone, no bot role, no secret; one call per minute", async () => {
  const C = mk();
  const ch = await C.methods.listChannels({});
  assert.deepEqual(ch, { ok: true, channels: [{ id: IDS.general, name: "general" }, { id: IDS.news, name: "news" }] });
  const ro = await C.methods.listRoles({});
  assert.deepEqual(ro, { ok: true, roles: [{ id: IDS.staff, name: "Helpers" }] });
  await C.methods.listChannels({});
  assert.equal(d.calls("GET", /channels$/).length, 1);
  assert.deepEqual(await C.methods.status({}), { ok: true, bot: true, oauth: false, guildId: IDS.guild });
  noSecret([ch, ro], "lists");
});

test("not configured: every method answers not_configured without a call; status says so", async () => {
  const C = mk({ app: null });
  assert.deepEqual(await C.methods.status({}), { ok: true, bot: false, oauth: false });
  for (const [m, a] of [["postMessage", { channelId: IDS.general, content: "x" }], ["listChannels", {}], ["listRoles", {}], ["createPrivateThread", { channelId: IDS.general, userId: IDS.person, name: "t" }], ["setThreadArchived", { threadId: IDS.general, archived: true }]]) {
    assert.deepEqual(await C.methods[m](a), { ok: false, reason: "not_configured" }, m);
  }
  assert.equal(W().length, 0);
});

test("methods never throw, whatever they receive", async () => {
  const C = mk();
  for (const m of Object.keys(C.methods).filter((x) => !/^channel(Choices|sByIds)$/.test(x))) for (const a of [undefined, null, 5, "x", [], {}, { channelId: {}, content: [] }]) closed(await C.methods[m](a));
});

// ── Failures ─────────────────────────────────────────────────────────────────

test("failures: 401/403 forbidden, 404 not_found, 5xx and outage unavailable, truncated answer failed; the body of Discord's error never comes back", async () => {
  const C = mk();
  const post = () => C.methods.postMessage({ channelId: IDS.general, content: "x" });
  d.force("POST", /messages$/, discordError(401, 0, "SECRET-LOOKING-DETAIL"), 1);
  assert.deepEqual(await post(), { ok: false, reason: "forbidden" });
  d.force("POST", /messages$/, discordError(403, 50013, "SECRET-LOOKING-DETAIL"), 1);
  assert.deepEqual(await post(), { ok: false, reason: "forbidden", scope: "channel" }, "a refusal about the channel says so (the bot code is fine)");
  d.force("POST", /messages$/, discordError(404, 10003, "SECRET-LOOKING-DETAIL"), 1);
  assert.deepEqual(await post(), { ok: false, reason: "not_found" });
  d.force("POST", /messages$/, discordError(500, 0, "boom"), 1);
  assert.deepEqual(await post(), { ok: false, reason: "unavailable" });
  d.force("POST", /messages$/, { status: 200, headers: { "content-type": "application/json" }, body: '{"id": "7000' }, 1);
  assert.deepEqual(await post(), { ok: false, reason: "failed" });
  d.force("POST", /messages$/, discordError(400, 50035, "Invalid Form Body"), 1);
  assert.deepEqual(await post(), { ok: false, reason: "failed" });
  d.state.down = true;
  assert.deepEqual(await post(), { ok: false, reason: "unavailable" });
  assert.ok(!heard.join("\n").includes("SECRET-LOOKING-DETAIL"));
});

test("too many requests: reason rate_limited with the end of the pause, then NO call until it ends (shared by every method)", async () => {
  const C = mk();
  d.rateLimit(120);
  const first = await C.methods.postMessage({ channelId: IDS.general, content: "x" });
  assert.equal(first.ok, false); assert.equal(first.reason, "rate_limited");
  assert.ok(Date.parse(first.retryAt) > Date.now() + 60_000, "the end of the pause is given");
  const seen = W().length;
  for (const r of [await C.methods.postMessage({ channelId: IDS.general, content: "y" }), await C.methods.listChannels({}), await C.methods.createPrivateThread({ channelId: IDS.general, userId: IDS.person, name: "t" })]) assert.equal(r.reason, "rate_limited");
  assert.equal(W().length, seen, "paused: no network");
  assert.ok(dc.pausedUntil());
});

// ── Health, card, secrets ────────────────────────────────────────────────────

const render = async (C, query) => connectorDef.adminPanel(C.ctx, { query: query ?? {} });
const blocks = (C) => render(C);

test("card: three states (not configured, configured, degraded) obey the core's rules", async () => {
  const none = mk({ app: null });
  const ok = mk();
  const bad = mk({ app: { applicationId: IDS.app, guildId: IDS.guild, botToken: "WRONGCODE.abcdefghij.0123456789_ABC" } });
  const notConfigured = await blocks(none), configured = await blocks(ok), degraded = await blocks(bad);
  assert.equal(notConfigured[0].state, "notConfigured"); assert.equal(configured[0].state, "configured"); assert.equal(degraded[0].state, "degraded");
  assertConnectionStates({ notConfigured, configured, degraded });
  assert.match(degraded[0].reason, /refuses the bot's secret code/);
  assert.equal(degraded[0].primary.href, "?edit=app");
  assert.equal(configured[0].summary, `Application …${IDS.app.slice(-4)}`);
  for (const x of [notConfigured, configured, degraded]) noSecret(x, "card");
});

test("card: not configured shows the guide; bot not on the server offers the invitation; a channel refusal keeps it green, a server permission is named; rate pause says until when", async () => {
  const guide = (await blocks(mk({ app: null })))[0];
  assert.equal(guide.setup[0].type, "markdown"); assert.equal(guide.primary.href, "?edit=app");
  d = fakeDiscord({ inGuild: false }); globalThis.fetch = (u, i) => d.fetch(u, i);
  const out = (await blocks(mk()))[0];
  assert.equal(out.state, "degraded"); assert.match(out.reason, /not on your server/);
  assert.equal(new URL(out.primary.href).searchParams.get("permissions"), dc.permissionsNumber());
  assert.ok(!out.primary.href.includes(BOT_CODE));
  // a refusal on a channel a module chose does NOT turn the card red (it says nothing about the bot on the server)
  d = fakeDiscord(); globalThis.fetch = (u, i) => d.fetch(u, i);
  const C = mk();
  d.force("POST", /messages$/, discordError(403, 50013, "Missing Permissions"), 1);
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, content: "x" })).reason, "forbidden");
  connectorModule.resetCache();
  assert.equal((await blocks(C))[0].state, "configured");
  assert.equal(await connectorDef.adminBadge(C.ctx), 0);
  // a permission the bot lacks on the WHOLE server is named, and goes away when it is given
  d = fakeDiscord({ permissions: String(1n << 11n) }); globalThis.fetch = (u, i) => d.fetch(u, i); connectorModule.resetCache();
  const perms = (await blocks(mk()))[0];
  assert.equal(perms.state, "degraded"); assert.match(perms.reason, /posting messages|private threads|public threads|closing threads/);
  d = fakeDiscord(); globalThis.fetch = (u, i) => d.fetch(u, i); connectorModule.resetCache();
  assert.equal((await blocks(mk()))[0].state, "configured");
  // pause
  d.rateLimit(300); connectorModule.resetCache();
  await C.methods.postMessage({ channelId: IDS.general, content: "x" });
  assert.match((await blocks(C))[0].reason, /pause until/);
});

test("Test the connection: one fresh check in plain words, with the permissions missing on the whole server", async () => {
  const C = mk();
  assert.deepEqual(await connectorDef.adminActions.test.run(C.ctx), { ok: en.test_ok });
  d = fakeDiscord({ permissions: String(1n << 11n) }); globalThis.fetch = (u, i) => d.fetch(u, i); connectorModule.resetCache();
  const r = await connectorDef.adminActions.test.run(C.ctx);
  assert.match(r.error, /lacks on the whole server/);
  assert.match(r.error, /posting messages \(see channels, embed links\)/);
  assert.match(r.error, /private threads \(see channels, create private threads, send messages in threads\)/);
  const admin = mk(); d = fakeDiscord({ permissions: String(1n << 3n) }); globalThis.fetch = (u, i) => d.fetch(u, i); connectorModule.resetCache();
  assert.deepEqual(await connectorDef.adminActions.test.run(admin.ctx), { ok: en.test_ok }, "administrator has everything");
  d.state.code = "OTHER"; connectorModule.resetCache();
  assert.equal((await connectorDef.adminActions.test.run(admin.ctx)).error, en.test_token);
  assert.equal((await connectorDef.adminActions.test.run(mk({ app: null }).ctx)).error, en.test_none);
});

test("saving: errors under the field with an example, a blank field keeps the current value, the secret is never shown again", async () => {
  const C = mk({ app: null });
  const bad = await connectorDef.adminActions.saveApp.run(C.ctx, { applicationId: "12", guildId: "", botToken: "a b" });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["applicationId", "botToken", "guildId"]);
  assert.match(bad.errors.applicationId, /for example 123456789012345678/);
  const ok = await connectorDef.adminActions.saveApp.run(C.ctx, { applicationId: IDS.app, guildId: IDS.guild, botToken: BOT_CODE });
  assert.equal(ok.ok, en.saved);
  const dialog = (await render(C, { edit: "app" })).at(-1);
  assert.equal(dialog.type, "adminForm");
  for (const f of dialog.fields) assert.equal(f.value, "", f.name);
  noSecret(dialog, "dialog");
  const next = await connectorDef.adminActions.saveApp.run(C.ctx, { applicationId: "", guildId: "", botToken: "" });
  assert.equal(next.ok, en.saved);
  assert.equal((await connectorDef.services["discord.api"].listChannels(C.ctx, {})).ok, true, "still works with the kept values");
  await connectorDef.adminActions.removeBot.run(C.ctx);
  assert.equal((await C.methods.status({})).bot, false);
});

test("the bot code goes ONLY in the Authorization header: not in a result, a block, a log line, the MCP answer or the readable backup", async () => {
  const C = mk();
  const results = [];
  results.push(await C.methods.postMessage({ channelId: IDS.general, content: "x" }));
  results.push(await C.methods.createPrivateThread({ channelId: IDS.general, name: "t", userId: IDS.person }));
  results.push(await C.methods.upsertManagedMessage({ owner: "planning", key: "k", channelId: IDS.general, content: "x" }));
  d.force("POST", /messages$/, discordError(401, 0, "bad"), 2);
  results.push(await C.methods.postMessage({ channelId: IDS.general, content: "x" }));
  results.push(await connectorDef.mcp.connector_discord_status(C.ctx));
  results.push(await blocks(C), await render(C, { edit: "app" }));
  results.push(await connectorDef.adminActions.test.run(C.ctx));
  noSecret(results, "results");
  noSecret(C.ctx.calls.netLog, "net log");
  noSecret(C.ctx.calls.log, "central log");
  noSecret(heard, "console");
  assert.equal(connectorDef.backup, undefined, "no readable backup file");
  assert.ok(W().every((c) => c.authOk || c.path === "/guilds"), "calls carry the code");
});

test("MCP status: states in words, permissions missing on the server, nothing secret", async () => {
  const C = mk();
  const ok = await connectorDef.mcp.connector_discord_status(C.ctx);
  assert.equal(ok.state, "configured"); assert.deepEqual(ok.permissionsMissingOnServer.length, 0);
  const none = await connectorDef.mcp.connector_discord_status(mk({ app: null }).ctx);
  assert.equal(none.state, "notConfigured"); assert.ok(none.whatToDo);
  d = fakeDiscord({ permissions: "0" }); globalThis.fetch = (u, i) => d.fetch(u, i); connectorModule.resetCache();
  const lacks = await connectorDef.mcp.connector_discord_status(mk().ctx);
  assert.ok(lacks.permissionsMissingOnServer.length > 0);
  noSecret([ok, none, lacks], "mcp");
});

test("the sanitizers: pings defused, names cleaned", () => {
  assert.equal(svc.plain("@everyone and @HERE <@1>", 100), "@​everyone and @​HERE <​@1>");
  assert.equal(svc.threadName("a\u0000b\tc"), "a b c");
  assert.equal(svc.cleanEmbeds([{ title: "x".repeat(257) }]), null);
  assert.equal(svc.cleanEmbeds("no"), null);
  assert.deepEqual(svc.cleanEmbeds(undefined), []);
});

test("scope: a channel of another server or a voice channel is refused before any write; threads are checked on their parent", async () => {
  const C = mk();
  const before = W().length;
  assert.equal((await C.methods.postMessage({ channelId: OTHER_CHANNEL, content: "x" })).reason, "forbidden");
  assert.equal((await C.methods.upsertManagedMessage({ owner: "planning", key: "k", channelId: OTHER_CHANNEL, content: "x" })).reason, "forbidden");
  assert.equal((await C.methods.postMessage({ channelId: "400000000000000003", content: "x" })).reason, "forbidden");
  assert.equal((await C.methods.createThread({ channelId: OTHER_CHANNEL, name: "t" })).reason, "forbidden");
  assert.equal((await C.methods.createPrivateThread({ channelId: OTHER_CHANNEL, name: "t", userId: IDS.person })).reason, "forbidden");
  assert.equal(W().length, before, "no POST left for another server");
});

test("a lost reply does not make a duplicate: the retry carries the same nonce and Discord returns the first message", async () => {
  const C = mk();
  d.loseReplies(1);
  const first = await C.methods.upsertManagedMessage({ owner: "planning", key: "week", channelId: IDS.general, content: "hello" });
  assert.equal(first.ok, false, "the reply was lost: the connector cannot know");
  assert.equal((await C.methods.upsertManagedMessage({ owner: "planning", key: "week", channelId: IDS.general, content: "hello" })).ok, true, "the next run");
  assert.equal(d.postedIn(IDS.general).length, 1, "one message, not two");
  const posts = d.log.filter((c) => c.method === "POST" && /messages$/.test(c.path));
  assert.equal(posts.length, 2);
  assert.ok(posts[0].body.nonce && posts[0].body.enforce_nonce === true);
  assert.equal(posts[0].body.nonce, posts[1].body.nonce);
  assert.ok(posts[0].body.nonce.length <= 25);
  // every reply lost, then a later run: still one message
  const K = mk();
  d.loseReplies(5);
  const lost = await K.methods.upsertManagedMessage({ owner: "planning", key: "other", channelId: IDS.general, content: "again" });
  assert.equal(lost.ok, false);
  d.loseReplies(0);
  svc.resetLists(); connectorModule.resetCache();
  assert.equal((await K.methods.upsertManagedMessage({ owner: "planning", key: "other", channelId: IDS.general, content: "again" })).ok, true);
  assert.equal(d.postedIn(IDS.general).filter((m) => m.content === "again").length, 1);
});

test("the cap is checked BEFORE the post: nothing is sent past 50 messages per module or 200 in all", async () => {
  const C = mk();
  for (let i = 0; i < 50; i++) assert.equal((await C.methods.upsertManagedMessage({ owner: "planning", key: "k" + i, channelId: IDS.general, content: "x" + i })).ok, true);
  const posted = d.postedIn(IDS.general).length;
  const r = await C.methods.upsertManagedMessage({ owner: "planning", key: "one-too-many", channelId: IDS.general, content: "x" });
  assert.equal(r.ok, false);
  assert.equal(d.postedIn(IDS.general).length, posted, "no message left on Discord");
  assert.equal((await C.methods.upsertManagedMessage({ owner: "planning", key: "k3", channelId: IDS.general, content: "changed" })).ok, true, "existing keys still update");
});

test("a message from another person is never touched, whoever calls and whatever owner is claimed", async () => {
  const C = mk();
  const foreign = d.foreign(IDS.general, "mine");
  for (const owner of ["planning", "someone-else", "discord-connector"]) {
    assert.equal((await C.methods.editMessage({ channelId: IDS.general, messageId: foreign, content: "x", owner })).ok, false);
    assert.equal((await C.methods.deleteMessage({ channelId: IDS.general, messageId: foreign, owner })).ok, false);
  }
  assert.equal(d.postedIn(IDS.general).find((m) => m.id === foreign).content, "mine");
});

test("bot code actions are owner-only: a non-owner is refused in code, the card shows no edit, the right is declared sensitive", async () => {
  const C = mk({ owner: false });
  assert.equal(connectorDef.adminActions.test.right, "bot.manage");
  for (const n of ["test", "saveApp", "removeBot"]) assert.equal(typeof connectorDef.adminActions[n].run, "function", n);
  assert.equal((await connectorDef.adminActions.removeBot.run(C.ctx)).error, en.err_owner_only);
  assert.equal((await connectorDef.adminActions.saveApp.run(C.ctx, { applicationId: IDS.app, guildId: IDS.guild, botToken: BOT_CODE })).error, en.err_owner_only);
  assert.equal((await C.methods.status({})).bot, true, "still configured");
  const card = (await blocks(C))[0];
  assert.equal(card.edit, undefined); assert.equal(card.primary, undefined);
  noSecret(card, "non-owner card");
  const manifest = JSON.parse(readFileSync(new URL("../modules/discord-connector/module.json", import.meta.url), "utf8"));
  const right = manifest.rights.find((x) => x.id === "bot.manage");
  assert.ok(right.sensitive); assert.deepEqual(right.default, { admin: false, editor: false });
});

test("network trouble shows Degraded with the reason, in the card and in the MCP answer; a fixed permission problem is forgotten", async () => {
  const C = mk();
  d.state.down = true; svc.resetLists(); connectorModule.resetCache();
  await C.methods.postMessage({ channelId: IDS.general, content: "x" });
  connectorModule.resetCache();
  const card = (await blocks(C))[0];
  assert.equal(card.state, "degraded"); assert.match(card.reason, new RegExp(en.health_net.slice(0, 12)));
  assert.notEqual((await connectorDef.mcp.connector_discord_status(C.ctx)).state, "configured");
  d.state.down = false;
});

test("the remaining-requests header pauses preventively before Discord says too many", async () => {
  const C = mk();
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, content: "warm" })).ok, true);   // the channel check is cached after this
  d.nextHeaders({ "x-ratelimit-remaining": "0", "x-ratelimit-reset-after": "2" });
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, content: "a" })).ok, true);
  const n = W().length;
  const r = await C.methods.postMessage({ channelId: IDS.general, content: "b" });
  assert.equal(r.reason, "rate_limited");
  assert.equal(W().length, n, "no call during the pause");
});

test("direction-control characters are stripped from thread names and content", async () => {
  const C = mk();
  const r = await C.methods.createThread({ channelId: IDS.general, name: "a\u202Eb\u2066c" });
  assert.equal(r.ok, true);
  assert.ok(!/[\u202A-\u202E\u2066-\u2069]/.test(JSON.stringify(d.log)));
});

test("forgetManagedMessage waits for a running upsert of the same key", async () => {
  const C = mk();
  const up = C.methods.upsertManagedMessage({ owner: "planning", key: "w", channelId: IDS.general, content: "x" });
  const fg = C.methods.forgetManagedMessage({ owner: "planning", key: "w" });
  await Promise.all([up, fg]);
  assert.equal((await C.methods.upsertManagedMessage({ owner: "planning", key: "w", channelId: IDS.general, content: "y" })).ok, true);
  assert.equal(d.postedIn(IDS.general).length, 1 + 0, "the forgotten message is not deleted by forget, a new one is not duplicated into a loop");
});

test("setThreadArchived: only a thread of THIS server; another server's thread, a plain channel and a bad number are refused with no PATCH", async () => {
  const C = mk();
  const t = await C.methods.createThread({ channelId: IDS.general, name: "t" });
  assert.deepEqual(await C.methods.setThreadArchived({ threadId: t.threadId, archived: true }), { ok: true });
  const patches = () => d.calls("PATCH").length;
  const n = patches();
  assert.equal((await C.methods.setThreadArchived({ threadId: OTHER_THREAD, archived: true })).reason, "forbidden");
  assert.equal((await C.methods.setThreadArchived({ threadId: IDS.general, archived: true })).reason, "forbidden", "a text channel is not a thread");
  assert.equal((await C.methods.setThreadArchived({ threadId: OTHER_CHANNEL, archived: true })).reason, "forbidden");
  assert.equal((await C.methods.setThreadArchived({ threadId: 4.6e17, archived: true })).reason, "invalid_input", "a number past 2^53 has lost digits");
  assert.equal(patches(), n, "no PATCH left for them");
});

test("a refusal about a channel says scope channel and never turns the card red; the guarded keys exist in English and French", async () => {
  const C = mk();
  d.force("POST", /messages$/, discordError(403, 50013, "Missing Permissions"), 1);
  const r = await C.methods.postMessage({ channelId: IDS.general, content: "x" });
  assert.deepEqual(r, { ok: false, reason: "forbidden", scope: "channel" });
  connectorModule.resetCache();
  assert.equal((await blocks(C))[0].state, "configured");
  assert.equal((await C.methods.postMessage({ channelId: OTHER_CHANNEL, content: "x" })).scope, "channel");
  const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
  for (const f of ["post", "privateThread", "publicThread", "archive", "channel", "list", "stats", "verify"]) { assert.ok(en[`feature_${f}`], `en ${f}`); assert.ok(fr[`feature_${f}`], `fr ${f}`); }
});

test("a store that cannot be read stops the write (fail closed): nothing is posted, no duplicate, no cap bypass", async () => {
  const C = mk();
  const real = C.ctx.api.store.list;
  C.ctx.api.store.list = async (col, o) => { if (col === "discordManaged" || col === "discordSent") throw new Error("db down"); return real(col, o); };
  const before = W().length;
  const r = await C.methods.upsertManagedMessage({ owner: "planning", key: "w", channelId: IDS.general, content: "x" });
  assert.deepEqual(r, { ok: false, reason: "unavailable" });
  assert.equal(W().length, before, "no POST");
  assert.equal((await C.methods.editMessage({ channelId: IDS.general, messageId: "400000000000000555", content: "x" })).reason, "unavailable");
  C.ctx.api.store.list = real;
  assert.equal((await C.methods.upsertManagedMessage({ owner: "planning", key: "w", channelId: IDS.general, content: "x" })).ok, true);
});

test("a section that ran out of time is told so: a late step must not write over the next one", async () => {
  const store = await import("../modules/discord-connector/store.mjs");
  const C = mk();
  let late;
  const slow = store.serial(C.ctx, async (ctl) => { await new Promise((r) => setTimeout(r, 40)); late = ctl.expired; return "late"; }, 10);
  await assert.rejects(slow, /timeout/);
  const next = await store.serial(C.ctx, async (ctl) => ctl.expired, 1000);
  assert.equal(next, false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(late, true, "the late step saw that its time was up");
  assert.ok(store.SECTION_MS >= 60_000, "the section covers the longest chain of network calls");
});

test("moving a managed message: when the old message cannot be deleted it is remembered and deleted on a later pass", async () => {
  const C = mk();
  const base = { owner: "planning", key: "week", channelId: IDS.general, content: "x" };
  const first = await C.methods.upsertManagedMessage(base);
  d.force("DELETE", /messages/, discordError(500, 0, "boom"), 1);
  const moved = await C.methods.upsertManagedMessage({ ...base, channelId: IDS.news });
  assert.equal(moved.ok, true);
  assert.ok(d.postedIn(IDS.general).some((m) => m.id === first.messageId), "the old message is still there");
  const doc = (await C.ctx.api.store.list("discordManaged"))[0];
  assert.deepEqual(doc.data.old, [{ channelId: IDS.general, messageId: first.messageId }]);
  await C.methods.upsertManagedMessage({ ...base, channelId: IDS.news });
  assert.ok(!d.postedIn(IDS.general).some((m) => m.id === first.messageId), "deleted on the next pass");
  assert.equal((await C.ctx.api.store.list("discordManaged"))[0].data.old, undefined);
});

test("direction marks (LRM, RLM, ALM) and overrides are stripped from content and thread names", async () => {
  const dc2 = await import("../modules/discord-connector/service.mjs");
  assert.equal(dc2.plain("a\u200eb\u200fc\u061cd\u202ee\u2066f", 50), "abcdef");
  assert.equal(dc2.threadName("a\u200eb\u061cc\u202ed"), "a b c d");
});

test("the MCP status does not tell to ask the owner for a rate pause", async () => {
  const C = mk();
  d.rateLimit(300); connectorModule.resetCache();
  await C.methods.postMessage({ channelId: IDS.general, content: "x" });
  const out = await connectorDef.mcp.connector_discord_status(C.ctx);
  assert.equal(out.state, "degraded");
  assert.ok(!/Only the owner/.test(out.whatToDo), out.whatToDo);
});

test("a late step of an upsert whose section timed out does not write its document, and the retry finds the same message (same nonce)", async () => {
  const store = await import("../modules/discord-connector/store.mjs");
  const C = mk();
  const real = globalThis.fetch;
  store.SECTION.ms = 30;
  try {
    globalThis.fetch = async (u, i) => { const r = await real(u, i); if ((i?.method ?? "GET") === "POST" && /messages$/.test(String(u))) await new Promise((x) => setTimeout(x, 90)); return r; };
    const r = await C.methods.upsertManagedMessage({ owner: "planning", key: "w", channelId: IDS.general, content: "x" });
    assert.equal(r.ok, false);
    await new Promise((x) => setTimeout(x, 150));
    assert.equal((await C.ctx.api.store.list("discordManaged")).length, 0, "the late save was refused");
  } finally { store.SECTION.ms = store.SECTION_MS; globalThis.fetch = real; }
  assert.equal(d.postedIn(IDS.general).length, 1);
  assert.equal((await C.methods.upsertManagedMessage({ owner: "planning", key: "w", channelId: IDS.general, content: "x" })).ok, true);
  assert.equal(d.postedIn(IDS.general).length, 1, "the same nonce: Discord returns the first message, no duplicate");
});
