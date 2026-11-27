// Discord connector 1.1.0: the channels the owner chose for the bot to write in. Checked against the fake Discord (tests/helpers/fakeDiscord.mjs) behind the real network client:
//  - nothing chosen = nothing changes (every channel of the server, as in 1.0.0);
//  - something chosen = EVERY write is refused (`forbidden`, `scope: "channel"`) with no write call unless the channel, or the parent of a thread, is in the list;
//  - reads are not limited, the picker of other modules only offers the chosen channels;
//  - only the holder of `bot.manage` changes the list, a list that cannot be read stops the writes (fail closed);
//  - the card line, the list on the page, the test of the connection, FR/EN parity.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeDiscord, BOT_CODE, IDS, OTHER_CHANNEL } from "./helpers/fakeDiscord.mjs";
import { connector, connectorModule, connectorDef } from "./helpers/discordConnector.mjs";
import { assertConnectionStates } from "./helpers/connectionKit.mjs";

const DIR = new URL("../modules/discord-connector", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8")), fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
const store = await import("../modules/discord-connector/store.mjs");
const dc = await import("../modules/discord-connector/discord.mjs");
const panel = await import("../modules/discord-connector/panel.mjs");
const realFetch = globalThis.fetch;
let d;
const FORBIDDEN = { ok: false, reason: "forbidden", scope: "channel" };
beforeEach(() => { connectorModule.resetCache(); d = fakeDiscord(); globalThis.fetch = (u, i) => d.fetch(u, i); });
afterEach(() => { globalThis.fetch = realFetch; });
/** Every call that changes something on Discord (a read of a channel is a GET and is allowed). */
const writes = () => d.log.filter((c) => c.method !== "GET");
const mk = (o = {}) => connector({ messages: en, ...o });
/** A connector whose owner chose these channels. */
const choose = async (C, ids) => { await store.setAllowed(C.ctx, ids); return C; };
const render = (C, query) => connectorDef.adminPanel(C.ctx, { query: query ?? {} });
const act = (C, name, values) => connectorDef.adminActions[name].run(C.ctx, values);
const chosenOf = (C) => store.allowedIds(C.ctx);

// ── Nothing chosen: nothing changes ──────────────────────────────────────────

test("nothing chosen: every text channel of the server works as before, the picker lists them all, status says no limit", async () => {
  const C = mk();
  assert.deepEqual(await chosenOf(C), []);
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, content: "a" })).ok, true);
  assert.equal((await C.methods.postMessage({ channelId: IDS.news, content: "b" })).ok, true);
  assert.equal((await C.methods.createThread({ channelId: IDS.news, name: "t" })).ok, true);
  assert.deepEqual((await C.methods.channelChoices({})).items.map((i) => i.label), ["#general", "#news"]);
  assert.deepEqual(await C.methods.status({}), { ok: true, bot: true, oauth: false, guildId: IDS.guild });
  assert.equal(JSON.stringify((await render(C))[0]).includes("limited"), false, "no line about a limit when there is none");
  assert.match((await render(C))[0].summary, /^Application …\d{4}$/);
});

// ── Something chosen: every write is refused without a write call ────────────

test("chosen channels: a channel outside the list is refused by every write method, with NO write call", async () => {
  const C = await choose(mk(), [IDS.general]);
  const base = { channelId: IDS.news };
  // a message of the bot in the allowed channel, kept before the list is narrowed to ANOTHER channel
  const mine = await C.methods.postMessage({ channelId: IDS.general, content: "mine" });
  const kept = await C.methods.upsertManagedMessage({ owner: "planning", key: "week", channelId: IDS.general, content: "week" });
  assert.equal(mine.ok && kept.ok, true);
  const thread = await C.methods.createThread({ channelId: IDS.general, name: "t" });
  await choose(C, [IDS.news]);
  const before = writes().length;
  const answers = {
    postMessage: await C.methods.postMessage({ ...base, channelId: IDS.general, content: "x" }),
    upsert: await C.methods.upsertManagedMessage({ owner: "planning", key: "other", channelId: IDS.general, content: "x" }),
    upsertVerify: await C.methods.upsertManagedMessage({ owner: "planning", key: "week", channelId: IDS.general, content: "week", verify: true }),
    upsertMove: await C.methods.upsertManagedMessage({ owner: "planning", key: "week", channelId: IDS.general, content: "week2" }),
    privateThread: await C.methods.createPrivateThread({ channelId: IDS.general, name: "t", userId: IDS.person }),
    thread: await C.methods.createThread({ channelId: IDS.general, name: "t" }),
    threadFromMessage: await C.methods.createThread({ channelId: IDS.general, name: "t", messageId: mine.messageId }),
    privateOnly: await C.methods.createThread({ channelId: IDS.general, name: "t", privateThread: true }),
    archive: await C.methods.setThreadArchived({ threadId: thread.threadId, archived: true }),
    edit: await C.methods.editMessage({ channelId: IDS.general, messageId: mine.messageId, content: "y" }),
    delete: await C.methods.deleteMessage({ channelId: IDS.general, messageId: mine.messageId }),
  };
  for (const [name, a] of Object.entries(answers)) assert.deepEqual(a, FORBIDDEN, name);
  assert.equal(writes().length, before, "no write call left for any of them");
  assert.equal(d.postedIn(IDS.general).find((m) => m.id === mine.messageId).content, "mine", "the message of the bot is untouched");
});

test("chosen channels: the same calls work in a chosen channel, and nothing else changes in what they send", async () => {
  const C = await choose(mk(), [IDS.news]);
  const posted = await C.methods.postMessage({ channelId: IDS.news, content: "hello" });
  assert.equal(posted.ok, true);
  assert.equal(d.postedIn(IDS.news)[0].flags, 4096, "still silent by default");
  assert.equal((await C.methods.upsertManagedMessage({ owner: "planning", key: "w", channelId: IDS.news, content: "a" })).action, "created");
  assert.equal((await C.methods.upsertManagedMessage({ owner: "planning", key: "w", channelId: IDS.news, content: "b" })).action, "edited");
  assert.equal((await C.methods.upsertManagedMessage({ owner: "planning", key: "w", channelId: IDS.news, content: "b", verify: true })).ok, true);
  assert.deepEqual(await C.methods.editMessage({ channelId: IDS.news, messageId: posted.messageId, content: "hello 2" }), { ok: true, messageId: posted.messageId });
  const t = await C.methods.createPrivateThread({ channelId: IDS.news, name: "ticket", userId: IDS.person });
  assert.equal(t.ok, true);
  assert.deepEqual(await C.methods.setThreadArchived({ threadId: t.threadId, archived: true }), { ok: true });
  assert.equal((await C.methods.createThread({ channelId: IDS.news, name: "talk" })).ok, true);
  assert.deepEqual(await C.methods.deleteMessage({ channelId: IDS.news, messageId: posted.messageId }), { ok: true });
});

test("chosen channels: the refusal is a channel refusal (it never turns the card red), the bot of another server is still refused first", async () => {
  const C = await choose(mk(), [IDS.news]);
  assert.deepEqual(await C.methods.postMessage({ channelId: IDS.general, content: "x" }), FORBIDDEN);
  connectorModule.resetCache();
  assert.equal((await render(C))[0].state, "configured");
  assert.equal(await connectorDef.adminBadge(C.ctx), 0);
  assert.deepEqual(await C.methods.postMessage({ channelId: OTHER_CHANNEL, content: "x" }), FORBIDDEN);
  assert.deepEqual(await C.methods.postMessage({ channelId: "400000000000000003", content: "x" }), FORBIDDEN, "a voice channel stays refused even if somebody listed it");
});

test("chosen channels: a channel number that is not a number is invalid input, not a refusal, and nothing is read", async () => {
  const C = await choose(mk(), [IDS.general]);
  d.log.length = 0;
  assert.equal((await C.methods.postMessage({ channelId: "abc", content: "x" })).reason, "invalid_input");
  assert.equal(d.log.length, 0);
});

test("threads follow their parent channel: a thread of a chosen channel works, a thread of another channel is refused without a write", async () => {
  const C = mk();
  const inGeneral = await C.methods.createThread({ channelId: IDS.general, name: "in general" });
  const inNews = await C.methods.createThread({ channelId: IDS.news, name: "in news" });
  const privateNews = await C.methods.createPrivateThread({ channelId: IDS.news, name: "private news", userId: IDS.person });
  await choose(C, [IDS.general]);
  connectorModule.resetCache();   // nothing remembered about the threads: the parent is read again
  const before = writes().length;
  assert.equal((await C.methods.postMessage({ channelId: inGeneral.threadId, content: "hi" })).ok, true, "a message in a thread of a chosen channel");
  assert.equal((await C.methods.upsertManagedMessage({ owner: "planning", key: "t", channelId: inGeneral.threadId, content: "hi" })).ok, true);
  assert.deepEqual(await C.methods.setThreadArchived({ threadId: inGeneral.threadId, archived: true }), { ok: true });
  const after = writes().length;
  assert.ok(after > before);
  assert.deepEqual(await C.methods.postMessage({ channelId: inNews.threadId, content: "hi" }), FORBIDDEN);
  assert.deepEqual(await C.methods.postMessage({ channelId: privateNews.threadId, content: "hi" }), FORBIDDEN);
  assert.deepEqual(await C.methods.setThreadArchived({ threadId: inNews.threadId, archived: true }), FORBIDDEN);
  assert.deepEqual(await C.methods.createThread({ channelId: inGeneral.threadId, name: "x" }), FORBIDDEN, "a thread is not a parent for a new thread (as in 1.0.0)");
  assert.equal(writes().length, after, "no write for the threads of another channel");
  // the thread whose parent is NOT in the list is also refused when it is a thread the list names itself? only channels are listed: a thread number in the list is never a way in
  await choose(C, [inNews.threadId]);
  assert.deepEqual(await C.methods.postMessage({ channelId: IDS.general, content: "x" }), FORBIDDEN);
});

test("editMessage and deleteMessage: the channel of the message must be chosen too, and a message of a person is still refused first", async () => {
  const C = mk();
  const a = await C.methods.postMessage({ channelId: IDS.general, content: "a" });
  const foreign = d.foreign(IDS.news, "a person");
  await choose(C, [IDS.general]);
  assert.equal((await C.methods.editMessage({ channelId: IDS.general, messageId: a.messageId, content: "a2" })).ok, true);
  assert.equal((await C.methods.editMessage({ channelId: IDS.news, messageId: foreign, content: "x" })).reason, "forbidden");
  assert.equal((await C.methods.deleteMessage({ channelId: IDS.news, messageId: foreign })).reason, "forbidden");
  assert.equal((await C.methods.deleteMessage({ channelId: IDS.general, messageId: a.messageId })).ok, true);
});

test("clearing up what the bot wrote stays possible after a channel leaves the list (nothing is orphaned): forgetManagedMessage and a move delete the old message", async () => {
  const C = mk();
  const k = await C.methods.upsertManagedMessage({ owner: "planning", key: "week", channelId: IDS.general, content: "x" });
  await choose(C, [IDS.news]);
  assert.deepEqual(await C.methods.forgetManagedMessage({ owner: "planning", key: "week" }), { ok: true });
  assert.ok(!d.postedIn(IDS.general).some((m) => m.id === k.messageId), "the old message is deleted");
  await choose(C, []);
  const first = await C.methods.upsertManagedMessage({ owner: "planning", key: "w2", channelId: IDS.general, content: "x" });
  await choose(C, [IDS.news]);
  const moved = await C.methods.upsertManagedMessage({ owner: "planning", key: "w2", channelId: IDS.news, content: "x" });
  assert.equal(moved.ok, true);
  assert.ok(!d.postedIn(IDS.general).some((m) => m.id === first.messageId), "moved: the old copy in the channel that left the list is deleted");
});

// ── Reads, the picker, status ────────────────────────────────────────────────

test("reads are not limited; the picker of other modules only offers the chosen channels; a chosen channel that was picked earlier still shows its name", async () => {
  const C = await choose(mk(), [IDS.news]);
  assert.deepEqual((await C.methods.listChannels({})).channels.map((c) => c.name), ["general", "news"], "listChannels is a read: the whole server");
  assert.deepEqual(Object.keys((await C.methods.listChannels({})).channels[0]).sort(), ["id", "name"], "still { id, name } (the category is for the page only)");
  assert.deepEqual((await C.methods.channelChoices({})).items, [{ id: IDS.news, label: "#news" }]);
  assert.deepEqual((await C.methods.channelChoices({ q: "gen" })).items, [], "a channel outside the list is not offered, even when searched");
  assert.deepEqual((await C.methods.channelChoices({ q: "NEW" })).items, [{ id: IDS.news, label: "#news" }]);
  const byIds = await C.methods.channelsByIds({ ids: [IDS.general, IDS.news, "400000000000000555"] });
  assert.deepEqual(byIds.items.map((i) => i.id), [IDS.general, IDS.news], "an earlier choice is never reported as gone because of the limit");
  assert.deepEqual(byIds.missing, ["400000000000000555"]);
  assert.deepEqual(await C.methods.status({}), { ok: true, bot: true, oauth: false, guildId: IDS.guild, channelLimit: 1 });
});

test("a list that cannot be read stops the writes and the picker (fail closed), a damaged list can only shrink what is allowed", async () => {
  const C = await choose(mk(), [IDS.general]);
  const real = C.ctx.api.store.list;
  C.ctx.api.store.list = async (col, o) => { if (col === "discordAllow") throw new Error("db down"); return real(col, o); };
  const before = writes().length;
  assert.deepEqual(await C.methods.postMessage({ channelId: IDS.general, content: "x" }), { ok: false, reason: "unavailable" });
  assert.deepEqual(await C.methods.editMessage({ channelId: IDS.general, messageId: "400000000000000555", content: "x" }), { ok: false, reason: "forbidden" }, "not ours: refused before the list is read");
  await assert.rejects(() => C.methods.channelChoices({}), /store_unavailable/);
  assert.equal((await C.methods.status({})).ok, true, "status needs no list");
  assert.equal(writes().length, before);
  C.ctx.api.store.list = real;
  // numbers that are not numbers are dropped, and the list is capped
  const doc = (await real("discordAllow"))[0];
  await C.ctx.api.store.update(doc.id, { channelIds: ["not a number", IDS.news, IDS.news, 5, null] });
  assert.deepEqual(await chosenOf(C), [IDS.news]);
  await C.ctx.api.store.update(doc.id, { channelIds: Array.from({ length: 150 }, (_, i) => String(480000000000000000n + BigInt(i))) });
  assert.equal((await chosenOf(C)).length, store.LIMITS.allow);
});

// ── Changing the list: the owner only ────────────────────────────────────────

test("changing the list needs the sensitive right bot.manage: declared on every action, refused in code for anybody else, nothing changes", async () => {
  for (const n of ["setChannel", "chooseUsed", "allowAll"]) assert.equal(connectorDef.adminActions[n].right, "bot.manage", n);
  assert.ok(manifest.rights.find((r) => r.id === "bot.manage").sensitive);
  const C = await choose(mk({ owner: false }), [IDS.news]);
  assert.equal((await act(C, "setChannel", { id: IDS.general, enabled: "1" })).error, en.err_owner_only);
  assert.equal((await act(C, "setChannel", { id: IDS.news, enabled: "0" })).error, en.err_owner_only);
  assert.equal((await act(C, "allowAll")).error, en.err_owner_only);
  assert.equal((await act(C, "chooseUsed")).error, en.err_owner_only);
  assert.deepEqual(await chosenOf(C), [IDS.news], "unchanged");
  assert.match(manifest.rights.find((r) => r.id === "bot.manage").help.en, /choose its channels/);
  assert.match(manifest.rights.find((r) => r.id === "bot.manage").help.fr, /choisir ses salons/);
});

test("a switch says the state wanted: on adds, off removes, twice is the same, the answer says what is true now", async () => {
  const C = mk();
  assert.deepEqual(await act(C, "setChannel", { id: IDS.news, enabled: "1" }), { ok: "Writes limited to 1 channel." });
  assert.deepEqual(await act(C, "setChannel", { id: IDS.news, enabled: "1" }), { ok: "Writes limited to 1 channel." }, "a double click never undoes the first");
  assert.deepEqual(await act(C, "setChannel", { id: IDS.general, enabled: "1" }), { ok: "Writes limited to 2 channels." });
  assert.deepEqual(await chosenOf(C), [IDS.news, IDS.general]);
  assert.deepEqual(await act(C, "setChannel", { id: IDS.news, enabled: "0" }), { ok: "Writes limited to 1 channel." });
  assert.deepEqual(await act(C, "setChannel", { id: IDS.general, enabled: "0" }), { ok: en.limit_off }, "the last one off lifts the limit");
  assert.deepEqual(await chosenOf(C), []);
  assert.equal((await C.ctx.api.store.list("discordAllow")).length, 0, "no document left");
  assert.equal((await C.methods.postMessage({ channelId: IDS.news, content: "x" })).ok, true, "writes work everywhere again");
});

test("the effect is immediate for the writes (no restart, no cache of the list)", async () => {
  const C = mk();
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, content: "1" })).ok, true);
  await act(C, "setChannel", { id: IDS.news, enabled: "1" });
  assert.deepEqual(await C.methods.postMessage({ channelId: IDS.general, content: "2" }), FORBIDDEN);
  await act(C, "setChannel", { id: IDS.general, enabled: "1" });
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, content: "3" })).ok, true);
  await act(C, "allowAll");
  assert.equal((await C.methods.postMessage({ channelId: IDS.news, content: "4" })).ok, true);
});

test("a switch refuses what is not a channel of the server, with the error and an example; a switch off always works; the list is capped", async () => {
  const C = mk();
  assert.match((await act(C, "setChannel", { id: "abc", enabled: "1" })).error, /for example #general/);
  assert.match((await act(C, "setChannel", { id: IDS.news })).error, /for example #general/, "no state wanted");
  assert.equal((await act(C, "setChannel", { id: "400000000000000003", enabled: "1" })).error, en.err_channel_gone, "a voice channel is not a channel of the list");
  assert.equal((await act(C, "setChannel", { id: "400000000000000555", enabled: "1" })).error, en.err_channel_gone);
  assert.deepEqual(await chosenOf(C), []);
  await store.setAllowed(C.ctx, Array.from({ length: store.LIMITS.allow }, (_, i) => String(480000000000000000n + BigInt(i))));
  assert.equal((await act(C, "setChannel", { id: IDS.news, enabled: "1" })).error, en.err_too_many.replace("{n}", String(store.LIMITS.allow)));
  assert.deepEqual(await act(C, "setChannel", { id: "480000000000000000", enabled: "0" }), { ok: "Writes limited to 99 channels." }, "a channel that is gone can be switched off");
  d.state.code = "OTHER"; connectorModule.resetCache();
  assert.equal((await act(C, "setChannel", { id: IDS.general, enabled: "1" })).error, en.why_forbidden, "Discord cannot be asked: said in words, nothing saved");
});

test("two quick switches never lose one (the changes go one after the other)", async () => {
  const C = mk();
  await Promise.all([act(C, "setChannel", { id: IDS.news, enabled: "1" }), act(C, "setChannel", { id: IDS.general, enabled: "1" })]);
  assert.deepEqual((await chosenOf(C)).sort(), [IDS.general, IDS.news].sort());
});

test("a damaged list never means \"no limit\": a document with no valid channel stops the writes; \"allow all\" removes the document and never saves an empty list", async () => {
  for (const damaged of [{ channelIds: "x" }, { channelIds: [5] }, { channelIds: [] }, { channelIds: [4.6e17] }, {}, { channelIds: null }]) {
    const C = mk({ rows: { discordAllow: [damaged] } });
    const before = writes().length;
    assert.deepEqual(await C.methods.postMessage({ channelId: IDS.general, content: "x" }), { ok: false, reason: "unavailable" }, JSON.stringify(damaged));
    assert.deepEqual(await C.methods.upsertManagedMessage({ owner: "planning", key: "k", channelId: IDS.news, content: "x" }), { ok: false, reason: "unavailable" });
    await assert.rejects(() => C.methods.channelChoices({}), /store_unavailable/);
    assert.equal(writes().length, before, "no write");
    assert.equal((await C.methods.status({})).channelLimit, undefined);
  }
  const C = await choose(mk(), [IDS.news]);
  await act(C, "allowAll");
  assert.equal((await C.ctx.api.store.list("discordAllow")).length, 0, "no document, not an empty one");
  await act(C, "setChannel", { id: IDS.news, enabled: "1" });
  await act(C, "setChannel", { id: IDS.news, enabled: "0" });
  assert.equal((await C.ctx.api.store.list("discordAllow")).length, 0);
  await store.setAllowed(C.ctx, []);
  assert.equal((await C.ctx.api.store.list("discordAllow")).length, 0);
  assert.equal((await C.methods.postMessage({ channelId: IDS.general, content: "x" })).ok, true, "unrestricted again");
});

test("the suggestion never widens or replaces a list that exists; lifting the limit says so", async () => {
  const C = await choose(mk(), [IDS.general]);
  await C.methods.upsertManagedMessage({ owner: "planning", key: "w", channelId: IDS.general, content: "x" });
  assert.equal((await act(C, "chooseUsed")).error, en.err_already_limited);
  assert.deepEqual(await chosenOf(C), [IDS.general]);
  assert.match(en.limit_off, /^Limit lifted/);
  assert.deepEqual(await act(C, "setChannel", { id: IDS.general, enabled: "0" }), { ok: en.limit_off });
});

test("the suggestion: the channels where modules already keep a message, in one click; nothing to suggest says so", async () => {
  const C = mk();
  assert.match((await act(C, "chooseUsed")).error, /No module keeps a message/);
  await C.methods.upsertManagedMessage({ owner: "planning", key: "week", channelId: IDS.news, content: "x" });
  await C.methods.upsertManagedMessage({ owner: "other-module", key: "k", channelId: IDS.news, content: "x" });
  assert.deepEqual(await act(C, "chooseUsed"), { ok: "Writes limited to 1 channel.", redirect: "?" });
  assert.deepEqual(await chosenOf(C), [IDS.news]);
});

// ── The page ─────────────────────────────────────────────────────────────────

test("card: the line 'Writes limited to N channels' only when a limit exists; the three states still obey the core's rules", async () => {
  const none = mk({ app: null });
  const limited = await choose(mk(), [IDS.news, IDS.general]);
  const bad = await choose(mk({ app: { applicationId: IDS.app, guildId: IDS.guild, botToken: "WRONGCODE.abcdefghij.0123456789_ABC" } }), [IDS.news]);
  const one = await choose(mk(), [IDS.news]);
  const [notConfigured, configured, degraded] = [await render(none), await render(limited), await render(bad)];
  assertConnectionStates({ notConfigured, configured, degraded });
  assert.equal(configured[0].summary, `Application …${IDS.app.slice(-4)} · Writes limited to 2 channels`);
  assert.equal((await render(one))[0].summary, `Application …${IDS.app.slice(-4)} · Writes limited to 1 channel`);
  assert.deepEqual(configured[0].menu.map((m) => m.action), ["test", "allowAll", "removeBot"]);
  assert.equal(configured[0].menu[1].confirm, en.allow_all_confirm);
  assert.deepEqual((await render(mk()))[0].menu.map((m) => m.action), ["test", "removeBot"], "nothing to lift when nothing is limited");
  assert.ok(configured[0].summary.length <= 200);
});

test("page, nothing chosen: one link to choose, no field, no table of channels", async () => {
  const C = mk();
  const blocks = await render(C);
  assert.deepEqual(blocks.map((b) => b.type), ["connection", "links"]);
  assert.deepEqual(blocks[1].items, [{ label: en.limit_open, href: "?edit=channels" }]);
  assert.ok(en.limit_open.length <= 60);
});

test("page, choosing: every channel of the server in one searchable list with a switch each, the chosen first, then the ones modules use, with the category", async () => {
  const C = mk();
  await C.methods.upsertManagedMessage({ owner: "planning", key: "week", channelId: IDS.news, content: "x", label: "Week" });
  const blocks = await render(C, { edit: "channels" });
  assert.deepEqual(blocks.map((b) => b.type), ["connection", "links", "table", "adminForm", "table"]);
  assert.deepEqual(blocks[1].items, [{ label: en.limit_done, href: "?" }]);
  const list = blocks[2];
  assert.equal(list.title, en.pick_title); assert.equal(list.searchable, true); assert.equal(list.pageSize, 50);
  assert.deepEqual(list.columns, [en.col_channel, en.col_category, en.col_used, en.col_chosen]);
  assert.deepEqual(list.rows.map((r) => r[0]), ["#news", "#general"], "the one a module writes in comes first");
  assert.deepEqual(list.rows.map((r) => r[1]), ["Info", "Info"]);
  assert.equal(list.rows[0][2], "planning", "who uses it");
  assert.deepEqual(list.rowIds, [IDS.news, IDS.general]);
  for (const r of list.rows) { assert.equal(r[3].switch.action, "setChannel"); assert.equal(r[3].switch.on, false); assert.match(r[3].switch.label, /^The bot may write in #?\w+/); }
  assert.equal(blocks[3].action, "chooseUsed"); assert.deepEqual(blocks[3].fields, []); assert.equal(blocks[3].submitStyle, "secondary");
  assert.equal(blocks[3].submitLabel, en.choose_used);
  for (const b of blocks) assert.ok(!JSON.stringify(b).includes(BOT_CODE));
  assert.ok(list.rows.every((r) => r[3].text === ""), "no repeated label on every row when nothing is chosen (R14)");
});

test("page, chosen: the chosen channels only, a switch on each, a link to add or remove; opened, the chosen come first and the suggestion form is gone", async () => {
  const C = await choose(mk(), [IDS.general]);
  const closed = await render(C);
  assert.deepEqual(closed.map((b) => b.type), ["connection", "table", "links"]);
  assert.equal(closed[1].title, en.chosen_title);
  assert.deepEqual(closed[1].rows.map((r) => r[0]), ["#general"]);
  assert.equal(closed[1].rows[0][3].switch.on, true);
  assert.deepEqual(closed[2].items, [{ label: en.limit_more, href: "?edit=channels" }]);
  const opened = await render(C, { edit: "channels" });
  assert.deepEqual(opened.map((b) => b.type), ["connection", "links", "table"]);
  assert.deepEqual(opened[2].rows.map((r) => r[0]), ["#general", "#news"]);
  assert.deepEqual(opened[2].rows.map((r) => r[3].switch.on), [true, false]);
});

test("page, a chosen channel that no longer exists stays visible so that it can be switched off; the list of a larger server stays searchable, 50 per page", async () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: String(410000000000000000n + BigInt(i)), type: 0, name: `salon-${String(i).padStart(2, "0")}`, position: 10 + i, parent_id: "450000000000000001" }));
  d = fakeDiscord({ moreChannels: many }); globalThis.fetch = (u, i) => d.fetch(u, i); connectorModule.resetCache();
  const C = await choose(mk(), ["400000000000000555", many[3].id]);
  const opened = await render(C, { edit: "channels" });
  const list = opened.find((b) => b.type === "table");
  assert.equal(list.rows.length, 63, "the 62 channels plus the one that is gone");
  assert.equal(list.searchable, true); assert.equal(list.pageSize, 50);
  assert.deepEqual(list.rows[0][0], { text: `${en.gone_name} …0555`, title: en.gone_help }, "the chosen come first, the one that is gone with them");
  assert.equal(list.rows[0][3].switch.on, true);
  assert.equal(list.rows[1][0], "#salon-03");
  assert.equal((await act(C, "setChannel", { id: "400000000000000555", enabled: "0" })).ok, "Writes limited to 1 channel.");
});

test("page, somebody who may open the page but not change the bot: the chosen channels read-only (no switch, no link, no form), nothing when nothing is chosen", async () => {
  const none = await render(mk({ owner: false }), { edit: "channels" });
  assert.deepEqual(none.map((b) => b.type), ["connection"]);
  const C = await choose(mk({ owner: false }), [IDS.news]);
  const blocks = await render(C, { edit: "channels" });
  assert.deepEqual(blocks.map((b) => b.type), ["connection", "table"]);
  assert.deepEqual(blocks[1].columns, [en.col_channel, en.col_category, en.col_used], "no column that repeats \"Chosen\" on every row");
  assert.deepEqual(blocks[1].rows[0].length, 3);
  assert.equal(JSON.stringify(blocks).includes("switch"), false);
  assert.equal(blocks[1].rowActions, undefined);
});

test("page: Discord does not answer: the chosen channels are listed by their last digits, the picker says what to do", async () => {
  const C = await choose(mk(), [IDS.news]);
  d.state.down = true; connectorModule.resetCache();
  const blocks = await render(C, { edit: "channels" });
  const list = blocks.find((b) => b.type === "table");
  assert.equal(list.rows.length, 1);
  assert.equal(list.rows[0][0], "…0002", "unknown name: the end of its number");
  assert.equal(list.empty, en.pick_empty);
});

// ── Test the connection ──────────────────────────────────────────────────────

test("Test the connection: names the chosen channels where the bot cannot write (a channel permission taken away, a channel that is gone), reusing the one check", async () => {
  const SEND = 1n << 11n, VIEW = 1n << 10n;
  d = fakeDiscord({ overwrites: { [IDS.news]: [{ id: IDS.guild, type: 0, allow: "0", deny: String(SEND) }], [IDS.general]: [{ id: IDS.guild, type: 0, allow: "0", deny: String(VIEW) }, { id: IDS.bot, type: 1, allow: String(VIEW), deny: "0" }] } });
  globalThis.fetch = (u, i) => d.fetch(u, i); connectorModule.resetCache();
  const C = mk();
  assert.deepEqual(await act(C, "test"), { ok: en.test_ok }, "nothing chosen: the same answer as 1.0.0, even though a channel denies posting");
  await store.setAllowed(C.ctx, [IDS.news, IDS.general, "400000000000000555"]);
  const r = await act(C, "test");
  assert.match(r.error, /^The bot cannot write in: #news \(send messages\) · …0555 \(no longer on the server\)\. Change the permissions/);
  assert.ok(!r.error.includes("#general"), "the overwrite of the bot itself gives the permission back");
  await store.setAllowed(C.ctx, [IDS.general]);
  assert.deepEqual(await act(C, "test"), { ok: en.test_ok });
  const calls = d.calls("GET").map((c) => c.path).filter((p) => /channels$/.test(p));
  assert.ok(calls.length >= 3, "the list of channels the check already reads is reused: no call per channel");
  assert.equal(d.log.filter((c) => /^\/channels\/\d+$/.test(c.path)).length, 0);
});

test("Test the connection: server-wide and channel problems come in one answer; an administrator is never blocked", async () => {
  d = fakeDiscord({ permissions: String(1n << 10n), overwrites: { [IDS.news]: [{ id: IDS.guild, type: 0, allow: "0", deny: String(1n << 10n) }] } });
  globalThis.fetch = (u, i) => d.fetch(u, i); connectorModule.resetCache();
  const C = await choose(mk(), [IDS.news]);
  const r = await act(C, "test");
  assert.match(r.error, /lacks on the whole server/);
  assert.match(r.error, /The bot cannot write in: #news \(see channels\)/);
  d = fakeDiscord({ permissions: String(1n << 3n), overwrites: { [IDS.news]: [{ id: IDS.guild, type: 0, allow: "0", deny: String((1n << 10n) | (1n << 11n)) }] } });
  globalThis.fetch = (u, i) => d.fetch(u, i); connectorModule.resetCache();
  assert.deepEqual(await act(C, "test"), { ok: en.test_ok });
});

test("channel permissions: the order of Discord (server, @everyone, the roles of the bot, the bot itself); only what an overwrite takes away is reported", () => {
  const G = "200000000000000001", B = "300000000000000001", R = "500000000000000001";
  const SEND = 1n << 11n, VIEW = 1n << 10n, EMBED = 1n << 14n;
  const all = String(VIEW | SEND | EMBED);
  const roles = new Set([G, R]);
  const lost = (overwrites, base = all) => dc.lostInChannel(base, { permission_overwrites: overwrites }, G, B, roles);
  assert.deepEqual(lost([]), []);
  assert.deepEqual(lost([{ id: G, type: 0, allow: "0", deny: String(SEND) }]), ["send"]);
  assert.deepEqual(lost([{ id: G, type: 0, allow: "0", deny: String(SEND) }, { id: R, type: 0, allow: String(SEND), deny: "0" }]), [], "a role of the bot gives it back");
  assert.deepEqual(lost([{ id: R, type: 0, allow: "0", deny: String(EMBED) }, { id: B, type: 1, allow: String(EMBED), deny: "0" }]), [], "the bot itself has the last word");
  assert.deepEqual(lost([{ id: "999999999999999999", type: 0, allow: "0", deny: String(SEND) }]), [], "a role the bot does not have");
  assert.deepEqual(lost([{ id: G, type: 0, allow: "0", deny: String(SEND) }], String(VIEW)), [], "missing on the whole server already: said elsewhere");
  assert.deepEqual(lost([{ id: G, type: 0, allow: "0", deny: String(VIEW) }]), ["view"]);
  assert.deepEqual(lost([{ id: G, type: 0, allow: "0", deny: "banana" }]), [], "an unreadable number is ignored");
  assert.deepEqual(dc.lostInChannel(String(1n << 3n), { permission_overwrites: [{ id: G, type: 0, allow: "0", deny: all }] }, G, B, roles), []);
});

test("the MCP status says how many channels the writing is limited to, only when it is", async () => {
  const C = mk();
  assert.equal("writesLimitedToChannels" in (await connectorDef.mcp.connector_discord_status(C.ctx)), false);
  await store.setAllowed(C.ctx, [IDS.news, IDS.general]);
  const out = await connectorDef.mcp.connector_discord_status(C.ctx);
  assert.equal(out.writesLimitedToChannels, 2);
  assert.ok(!JSON.stringify(out).includes(BOT_CODE));
});

// ── Words: FR/EN parity, ergonomics ─────────────────────────────────────────

test("texts: every key the page uses exists in English and French with the same {variables}; labels short, no colon, no forbidden word", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (t) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of Object.keys(en)) assert.equal(vars(fr[k]), vars(en[k]), k);
  const source = fs.readFileSync(`${DIR}/panel.mjs`, "utf8");
  const used = new Set([...source.matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]));   // a key written as a string in the code of the page (also the ones chosen by a condition)
  for (const k of ["limited_one", "limited_many", "limit_off", "allow_all", "allow_all_confirm", "limit_open", "limit_more", "limit_done", "chosen_title", "pick_title", "pick_empty", "col_category", "col_used", "col_chosen", "err_already_limited", "switch_label", "choose_used", "gone_name", "gone_help", "gone_short", "err_channel", "err_channel_gone", "err_too_many", "err_no_used", "test_channels"]) {
    assert.ok(en[k] && fr[k], k);
    assert.ok(used.has(k), `${k} is used`);
  }
  for (const k of ["limit_open", "limit_more", "limit_done", "chosen_title", "pick_title", "col_category", "col_used", "col_chosen", "choose_used", "allow_all", "switch_label"]) {
    for (const t of [en[k], fr[k]]) { assert.ok(t.length <= 60, `${k}: ${t.length}`); assert.ok(!/[:：]\s*$/.test(t), `${k} ends with a colon`); }
  }
  const words = /\b(key|slug|instance|topic|token|jeton|webhook|route|identifiant|payload|api|json|cache|hash|oauth|clé)\b/i;
  for (const k of ["limit_open", "limit_more", "chosen_title", "pick_title", "pick_empty", "gone_help", "err_channel", "err_channel_gone", "err_too_many", "err_no_used", "test_channels", "allow_all_confirm"]) { assert.ok(!words.test(en[k]), `en ${k}`); assert.ok(!words.test(fr[k]), `fr ${k}`); assert.ok(!/!/.test(en[k] + fr[k]), `${k} exclamation`); }
  assert.ok(en.err_channel.includes("for example")); assert.ok(fr.err_channel.includes("par exemple"));
  assert.equal(manifest.version, "1.1.1");
});

test("blockedText: names in words, the end of the number for a channel that is gone", () => {
  const ctx = { t: (k, v) => { let s = en[k] ?? k; for (const [n, x] of Object.entries(v ?? {})) s = s.replaceAll(`{${n}}`, String(x)); return s; } };
  assert.equal(panel.blockedText(ctx, [{ id: IDS.news, name: "news", permissions: ["send", "send", "embed"] }, { id: "400000000000000555", gone: true }]), "#news (send messages, embed links) · …0555 (no longer on the server)");
});
