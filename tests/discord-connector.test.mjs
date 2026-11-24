// Discord connector 1.0.0: the service `discord.api` v1 (closed answers, exact calls and bodies), silent messages, messages kept up to date, pauses after "too many requests",
// no secret anywhere, and the card in its three states. No network: the fake Discord (tests/helpers/fakeDiscord.mjs) answers behind the REAL network client of the core.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeDiscord, discordError, discordJson, BOT_CODE, IDS } from "./helpers/fakeDiscord.mjs";
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
  assert.deepEqual(manifest.offers[0].readOnly, ["status", "listChannels", "listRoles", "channelChoices", "channelsByIds"]);
  assert.ok(!manifest.requires);
  assert.deepEqual(manifest.settings, []);
  assert.deepEqual(manifest.mcp.map((t) => [t.name, t.readOnly, t.right]), [["connector_discord_status", true, "open"]]);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  assert.deepEqual(Object.keys(connectorDef.services["discord.api"]).sort(), ["channelChoices", "channelsByIds", "createPrivateThread", "createThread", "deleteMessage", "editMessage", "forgetManagedMessage", "listChannels", "listRoles", "postMessage", "setThreadArchived", "status", "upsertManagedMessage"]);
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
  assert.deepEqual(d.log.map((c) => `${c.method} ${c.path}`), [`POST /channels/${IDS.general}/threads`, `PUT /channels/${r.threadId}/thread-members/${IDS.person}`, `POST /channels/${r.threadId}/messages`]);
  assert.deepEqual(d.log[0].body, { name: "Ticket 42", auto_archive_duration: 10080, type: 12, invitable: false });
  assert.equal(d.log[1].body, undefined);
  assert.deepEqual(d.log[2].body, { content: `<@${IDS.person}> <@&${IDS.staff}>\nHello, tell us more.`, allowed_mentions: { parse: [], users: [IDS.person], roles: [IDS.staff] } });
  for (const c of d.log) { assert.equal(c.host, "discord.com"); assert.equal(c.userAgent, "DiscordBot (https://example.org, 1)"); assert.ok(c.authOk); }
  noSecret(r, "result");
});

test("createPrivateThread: the intro can never ping anybody else; the name is cleaned; without a role only the person can be mentioned", async () => {
  const C = mk();
  const r = await C.methods.createPrivateThread({ channelId: IDS.general, name: "  \u0007\n  ​ ", userId: IDS.person, intro: `@everyone @here <@${IDS.stranger}> <@&${IDS.staff}> <@!${IDS.stranger}>` });
  assert.equal(r.ok, true);
  assert.equal(d.log[0].body.name, "thread", "never empty");
  const msg = d.log[2].body;
  assert.deepEqual(msg.allowed_mentions, { parse: [], users: [IDS.person], roles: [] });
  assert.ok(!/@everyone|@here/.test(msg.content) && !msg.content.includes(`<@${IDS.stranger}>`) && !msg.content.includes(`<@&${IDS.staff}>`) && !msg.content.includes("<@!"), msg.content);
  const long = await C.methods.createPrivateThread({ channelId: IDS.general, name: "é".repeat(300), userId: IDS.person, intro: "x".repeat(5000) });
  assert.equal(long.ok, true);
  assert.equal([...d.log.filter((c) => c.path.endsWith("/threads")).at(-1).body.name].length, 100);
  assert.ok(d.log.at(-1).body.content.length <= 1600);
});

test("createPrivateThread: every number is checked BEFORE any call", async () => {
  const C = mk();
  for (const bad of [{ channelId: "12" }, { channelId: IDS.general, userId: "abc" }, { channelId: IDS.general, userId: IDS.person, staffRoleId: "x" }, { channelId: IDS.general, userId: IDS.person, intro: 5 }, { channelId: `${IDS.general}9`.repeat(5), userId: IDS.person }, {}]) {
    const r = await C.methods.createPrivateThread({ name: "t", ...bad });
    assert.deepEqual(closed(r), { ok: false, reason: "invalid_input" });
  }
  assert.equal(d.log.length, 0);
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
  assert.equal(a.ok, true); assert.deepEqual(d.log[0].body, { name: "Talk", auto_archive_duration: 10080, type: 11 });
  const posted = await C.methods.postMessage({ channelId: IDS.general, content: "start" });
  const b = await C.methods.createThread({ channelId: IDS.general, name: "Reply", messageId: posted.messageId });
  assert.equal(b.ok, true); assert.equal(b.threadId, posted.messageId);
  assert.equal(d.log.at(-1).path, `/channels/${IDS.general}/messages/${posted.messageId}/threads`);
  const c = await C.methods.createThread({ channelId: IDS.general, name: "Private", privateThread: true });
  assert.equal(c.ok, true); assert.deepEqual(d.log.at(-1).body, { name: "Private", auto_archive_duration: 10080, type: 12, invitable: false });
  assert.deepEqual(await C.methods.createThread({ channelId: IDS.general, name: "x", messageId: posted.messageId, privateThread: true }), { ok: false, reason: "invalid_input" });
});

// ── Messages ─────────────────────────────────────────────────────────────────

test("postMessage: silent by default (flag 4096), nobody can be mentioned; silent:false removes the flag only", async () => {
  const C = mk();
  const r = closed(await C.methods.postMessage({ channelId: IDS.general, content: "Week @everyone <@123456789012345678>" }));
  assert.equal(r.ok, true); assert.match(r.messageId, /^\d+$/);
  const body = d.log[0].body;
  assert.equal(body.flags, 4096); assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.ok(!body.content.includes("@everyone") && !body.content.includes("<@1"), body.content);
  await C.methods.postMessage({ channelId: IDS.general, content: "loud", silent: false });
  assert.equal(d.log[1].body.flags, undefined); assert.deepEqual(d.log[1].body.allowed_mentions, { parse: [] });
});

test("postMessage: limits (2000 characters, embeds 10 and 6000 in all), nothing sent when refused", async () => {
  const C = mk();
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, content: "x".repeat(2001) })).reason, "invalid_input");
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, content: "" })).reason, "invalid_input");
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, content: "ok", embeds: Array.from({ length: 11 }, () => ({ title: "t" })) })).reason, "invalid_input");
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, embeds: [{ description: "x".repeat(4096) }, { description: "y".repeat(2000) }] })).reason, "invalid_input");
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, embeds: [{ url: "http://insecure.example" }] })).reason, "invalid_input");
  assert.equal(d.log.length, 0);
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, content: "x".repeat(2000) })).ok, true);
  const e = await C.methods.postMessage({ channelId: IDS.general, embeds: [{ title: "Week", description: "a\n@everyone", color: 0xff0000, fields: [{ name: "Mon", value: "Stream", inline: true }], footer: { text: "f" } }] });
  assert.equal(e.ok, true); assert.ok(!JSON.stringify(d.log.at(-1).body).includes("@everyone"));
});

test("editMessage and deleteMessage: only the bot's own messages (Discord refuses the others), deleting twice is fine", async () => {
  const C = mk();
  const { messageId } = await C.methods.postMessage({ channelId: IDS.general, content: "v1" });
  assert.deepEqual(await C.methods.editMessage({ channelId: IDS.general, messageId, content: "v2" }), { ok: true, messageId });
  assert.equal(d.postedIn(IDS.general)[0].content, "v2");
  assert.equal((await C.methods.editMessage({ channelId: IDS.general, messageId })).reason, "invalid_input");
  assert.equal((await C.methods.editMessage({ channelId: IDS.general, messageId: "400000000000000555", content: "x" })).reason, "not_found");
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
  assert.equal(d.log[0].body.flags, 4096, "silent by default");
  const calls = d.log.length;
  const same = await C.methods.upsertManagedMessage({ ...base, content: "Mon: stream" });
  assert.deepEqual(same, { ok: true, messageId: a.messageId, action: "unchanged" });
  assert.equal(d.log.length, calls, "idempotent: no call when the content is the same");
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
  assert.deepEqual(refused, { ok: false, reason: "forbidden" });
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
  const down = await C.methods.channelsByIds({ ids: [IDS.news] });
  assert.deepEqual(down.missing, [], "unknown is not gone");
  d.state.down = false;
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
  assert.equal(d.log.length, 0);
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
  assert.deepEqual(await post(), { ok: false, reason: "forbidden" });
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
  const seen = d.log.length;
  for (const r of [await C.methods.postMessage({ channelId: IDS.general, content: "y" }), await C.methods.listChannels({}), await C.methods.createPrivateThread({ channelId: IDS.general, userId: IDS.person, name: "t" })]) assert.equal(r.reason, "rate_limited");
  assert.equal(d.log.length, seen, "paused: no network");
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

test("card: not configured shows the guide; bot not on the server offers the invitation; a permission refused earlier is named; rate pause says until when", async () => {
  const guide = (await blocks(mk({ app: null })))[0];
  assert.equal(guide.setup[0].type, "markdown"); assert.equal(guide.primary.href, "?edit=app");
  d = fakeDiscord({ inGuild: false }); globalThis.fetch = (u, i) => d.fetch(u, i);
  const out = (await blocks(mk()))[0];
  assert.equal(out.state, "degraded"); assert.match(out.reason, /not on your server/);
  assert.equal(new URL(out.primary.href).searchParams.get("permissions"), dc.permissionsNumber());
  assert.ok(!out.primary.href.includes(BOT_CODE));
  // a refused permission is remembered (and named) until the same thing works again
  d = fakeDiscord(); globalThis.fetch = (u, i) => d.fetch(u, i);
  const C = mk();
  d.force("POST", /\/threads$/, discordError(403, 50013, "Missing Permissions"), 1);
  await C.methods.createPrivateThread({ channelId: IDS.general, name: "t", userId: IDS.person });
  connectorModule.resetCache();
  const perms = (await blocks(C))[0];
  assert.equal(perms.state, "degraded"); assert.match(perms.reason, /private threads/); assert.ok(perms.since);
  assert.equal(await connectorDef.adminBadge(C.ctx), 1);
  await C.methods.createPrivateThread({ channelId: IDS.general, name: "t", userId: IDS.person });
  connectorModule.resetCache();
  assert.equal((await blocks(C))[0].state, "configured");
  assert.equal(await connectorDef.adminBadge(C.ctx), 0);
  // pause
  d.rateLimit(300); connectorModule.resetCache();
  await C.methods.postMessage({ channelId: IDS.general, content: "x" });
  assert.match((await blocks(C))[0].reason, /pause until/);
});

test("Test the connection: one fresh check in plain words, with the permissions missing on the whole server", async () => {
  const C = mk();
  assert.deepEqual(await connectorDef.adminActions.test(C.ctx), { ok: en.test_ok });
  d = fakeDiscord({ permissions: String(1n << 11n) }); globalThis.fetch = (u, i) => d.fetch(u, i); connectorModule.resetCache();
  const r = await connectorDef.adminActions.test(C.ctx);
  assert.match(r.error, /lacks on the whole server/);
  assert.match(r.error, /posting messages \(see channels, embed links\)/);
  assert.match(r.error, /private threads \(see channels, create private threads, send messages in threads\)/);
  const admin = mk(); d = fakeDiscord({ permissions: String(1n << 3n) }); globalThis.fetch = (u, i) => d.fetch(u, i); connectorModule.resetCache();
  assert.deepEqual(await connectorDef.adminActions.test(admin.ctx), { ok: en.test_ok }, "administrator has everything");
  d.state.code = "OTHER"; connectorModule.resetCache();
  assert.equal((await connectorDef.adminActions.test(admin.ctx)).error, en.test_token);
  assert.equal((await connectorDef.adminActions.test(mk({ app: null }).ctx)).error, en.test_none);
});

test("saving: errors under the field with an example, a blank field keeps the current value, the secret is never shown again", async () => {
  const C = mk({ app: null });
  const bad = await connectorDef.adminActions.saveApp(C.ctx, { applicationId: "12", guildId: "", botToken: "a b" });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["applicationId", "botToken", "guildId"]);
  assert.match(bad.errors.applicationId, /for example 123456789012345678/);
  const ok = await connectorDef.adminActions.saveApp(C.ctx, { applicationId: IDS.app, guildId: IDS.guild, botToken: BOT_CODE });
  assert.equal(ok.ok, en.saved);
  const dialog = (await render(C, { edit: "app" })).at(-1);
  assert.equal(dialog.type, "adminForm");
  for (const f of dialog.fields) assert.equal(f.value, "", f.name);
  noSecret(dialog, "dialog");
  const next = await connectorDef.adminActions.saveApp(C.ctx, { applicationId: "", guildId: "", botToken: "" });
  assert.equal(next.ok, en.saved);
  assert.equal((await connectorDef.services["discord.api"].listChannels(C.ctx, {})).ok, true, "still works with the kept values");
  await connectorDef.adminActions.removeBot(C.ctx);
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
  results.push(await connectorDef.adminActions.test(C.ctx));
  noSecret(results, "results");
  noSecret(C.ctx.calls.netLog, "net log");
  noSecret(C.ctx.calls.log, "central log");
  noSecret(heard, "console");
  assert.equal(connectorDef.backup, undefined, "no readable backup file");
  assert.ok(d.log.every((c) => c.authOk || c.path === "/guilds"), "calls carry the code");
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
