// Twitch bot 1.13.0: the bot panel of the remote control (phone and OBS dock) of Audience.
// The bot OFFERS "audience.remote"; Audience (which holds the secret address, the rate limit and the journal) CALLS it. Invented names only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseManifest } from "@/core/modules/manifest";
import { remoteWorld, botDef, audDef, AR, S, C, NOW } from "./helpers/botRemoteWorld.mjs";
import { say, chat, fr as botFr, en as botEn, SRC } from "./helpers/botWorld.mjs";
import { forbiddenWords, toneProblems, labelProblems } from "./helpers/ergonomics.mjs";

const DIR = new URL("../modules/twitch-bot", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const T = await import("../modules/twitch-bot/timers.mjs");
const TA = await import("../modules/twitch-bot/timersAdmin.mjs");
const D = await import("../modules/twitch-bot/draw.mjs");
const A = await import("../modules/twitch-bot/admin.mjs");
const RM = await import("../modules/twitch-bot/remote.mjs");
const { fakeAudienceDraw } = await import("./helpers/fakeAudienceDraw.mjs");
const botPanel = (panels) => panels.find((p) => p.id === "id-bot");

/* ───────────── The contract: it appears only with Audience, and nothing new is reachable ───────────── */

test("manifest: the bot offers audience.remote (one panel per bot), declares its journal events, adds no permission, no route and no right", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.version, "1.13.0"); assert.equal(manifest.minCore, "0.6.7");
  assert.deepEqual(manifest.offers, [{ service: "audience.remote", version: 1, each: true }]);
  assert.deepEqual(manifest.permissions, ["routes", "storage", "admin", "topics", "mcp"], "no new permission");
  assert.ok(!manifest.requires.some((x) => x.service === "audience.remote"), "no dependency on Audience: the bot works without it");
  assert.deepEqual(manifest.rights.map((x) => x.id), ["rewards.manage", "timers.manage"], "no new right: the secret address is the protection");
  assert.deepEqual(Object.keys(botDef.routes).sort(), ["kit", "webhook"], "no new route: the only way in is Audience's own protected routes");
  assert.deepEqual(Object.keys(botDef.services["audience.remote"]).sort(), ["describe", "press"]);
  for (const k of ["bot.paused", "bot.resumed", "command.quickadded", "command.quickremoved"]) assert.ok(manifest.logEvents.some((e) => e.key === k), k);
});

test("without Audience there is no panel and nothing else changes; with Audience the bot panel is there, next to the others, sanitized", async () => {
  const alone = await remoteWorld({ audience: false });
  assert.equal(alone.aud, null);
  assert.equal((await C.loadConfig(alone.bot)).data.custom.length, 0, "the bot alone just works");
  assert.equal((await say(alone.bot, "!planning")).handled !== undefined, true);
  const w = await remoteWorld();
  const panels = await w.panels();
  const p = botPanel(panels);
  assert.ok(p, "the panel appears with both installed");
  assert.deepEqual([p.title, p.tab, p.badge, p.alert], ["Twitch bot", "Bot", "", false]);
  assert.equal(p.toggles.length, 1);
  assert.deepEqual(p.toggles[0], { id: "pause", label: "Bot answers", on: true, text: "On, answering your chat", hint: "Paused: no replies, timers or reward reactions.", values: {} });
  assert.equal(p.forms.length, 1); assert.equal(p.forms[0].id, "addcom");
  assert.deepEqual(p.forms[0].fields.map((f) => [f.name, f.required, f.type, f.example]), [["name", true, "text", "hello"], ["text", true, "text", "Welcome, make yourself at home"]], "two fields, each with an example");
  assert.equal(p.forms[0].submit, "Add the command");
  assert.deepEqual(p.buttons, [], "no undo button before anything was added");
  assert.ok(!panels.some((x) => x.id !== "id-bot" && x.title === "Twitch bot"));
  assert.ok(panels.some((x) => x.id === "audience"), "the giveaway panel of Audience itself is still there");
});

test("two bots on the same site: each has its own panel and its own switch", async () => {
  const w = await remoteWorld({ bots: 2 });
  const panels = await w.panels();
  assert.deepEqual(panels.map((p) => p.id).filter((id) => id.startsWith("id-bot")).sort(), ["id-bot", "id-bot2"]);
  assert.equal((await w.press("pause", {}, "id-bot2")).ok, true);
  assert.equal(await S.isMuted(w.bots[1].ctx), true); assert.equal(await S.isMuted(w.bots[0].ctx), false);
  assert.equal(botPanel(await w.panels()).toggles[0].on, true, "the other bot is untouched");
});

/* ───────────── Pause and resume ───────────── */

test("the switch shows the CURRENT state and carries the action that flips it; the tab says 'Paused' while paused; a repeated press changes nothing", async () => {
  const w = await remoteWorld();
  const on = botPanel(await w.panels());
  assert.deepEqual([on.toggles[0].id, on.toggles[0].on, on.badge, on.alert], ["pause", true, "", false]);
  const r = await w.press("pause");
  assert.deepEqual([r.ok, r.message], [true, "The bot is paused: it answers nobody."]);
  assert.equal(await w.muted(), true);
  const off = botPanel(await w.panels());
  assert.deepEqual([off.toggles[0].id, off.toggles[0].on, off.toggles[0].text, off.badge, off.alert], ["resume", false, "Paused, silent in your chat", "Paused", true]);
  const since = (await S.readState(w.bot)).mutedAt;
  assert.equal((await w.press("pause")).ok, true, "a second tap on a stale screen is harmless");
  assert.equal((await S.readState(w.bot)).mutedAt, since, "the date of the pause does not move");
  assert.deepEqual([(await w.press("resume")).message, await w.muted()], ["The bot answers again.", false]);
  assert.equal(botPanel(await w.panels()).toggles[0].id, "pause");
  assert.equal((await w.press("resume")).ok, true, "idempotent too");
});

test("it is the existing emergency stop: the administration shows it, says it came from the remote control, and the audit has who pressed what", async () => {
  const w = await remoteWorld();
  await w.press("pause");
  const state = await S.readState(w.bot);
  assert.deepEqual([state.muted, state.mutedBy], [true, "remote"]);
  const blocks = await A.panel(w.bot, { query: {} });
  const bar = JSON.stringify(blocks.slice(0, 4));
  assert.match(bar, /The bot is switched off/); assert.match(bar, /from the remote control/); assert.match(bar, /Switch answers back on/);
  // the administration's own button still works on the same flag, and says nothing about the remote
  await A.actions.unmute(w.bot);
  assert.equal(await w.muted(), false);
  await A.actions.mute(w.bot);
  assert.equal((await S.readState(w.bot)).mutedBy, "admin");
  assert.doesNotMatch(JSON.stringify((await A.panel(w.bot, { query: {} })).slice(0, 4)), /from the remote control/);
  // audit: the site's journal (declared events) and Audience's own journal (who: remote)
  const w2 = await remoteWorld();
  await w2.press("pause"); await w2.press("resume"); await w2.press("resume");
  assert.deepEqual(w2.bot.dumpLog().map((l) => l.action), ["bot.paused", "bot.resumed"], "only real changes are written");
  const audit = (await w2.aud.api.store.list("audit")).map((r) => r.data).filter((r) => r.what.endsWith(".pause") || r.what.endsWith(".resume"));
  assert.deepEqual(audit.map((r) => [r.who, r.what.split(".")[1], r.detail]).sort(), [["remote", "pause", "ok"], ["remote", "resume", "ok"], ["remote", "resume", "ok"]]);
});

test("a failure is said in plain words, under the switch, and nothing changes", async () => {
  const w = await remoteWorld();
  const real = w.bot.api.store.add.bind(w.bot.api.store), upd = w.bot.api.store.update.bind(w.bot.api.store);
  w.bot.api.store.add = async () => { throw new Error("disk full"); };
  w.bot.api.store.update = async () => { throw new Error("disk full"); };
  const r = await RM.press(w.bot, { action: "pause" });
  assert.deepEqual([r.ok, r.error, r.field], [false, "failed", "tg"]);
  assert.equal(r.message, "The bot was not changed. Check your connection, then tap again.");
  assert.doesNotMatch(r.message, /disk|error|Error/);
  w.bot.api.store.add = real; w.bot.api.store.update = upd;
  assert.equal(await w.muted(), false);
  assert.deepEqual(w.bot.dumpLog(), [], "nothing is written to the journal for a failed press");
  // through Audience the message and the field reach the page
  w.bot.api.store.add = async () => { throw new Error("x"); }; w.bot.api.store.update = async () => { throw new Error("x"); };
  const via = await w.press("pause");
  assert.equal(via.ok, false); assert.equal(via.field, "tg"); assert.match(via.message, /not changed/);
});

test("'Stop everything' on the remote does not silence the bot (it closes polls and sign-ups)", async () => {
  const w = await remoteWorld();
  const r = await RM.press(w.bot, { action: "panic", values: {} });
  assert.deepEqual([r.ok, r.error], [false, "invalid"], "not counted as 'stopped' by Audience");
  assert.equal(await w.muted(), false);
  await AR.panic(w.aud);
  assert.equal(await w.muted(), false);
});

test("paused means paused on EVERY path that writes in the chat or acts: commands, !addcom, repeating commands, 'Send now', the giveaway, !stop / !start replies; resumed, they work again", async () => {
  const w = await remoteWorld({ botOptions: { draw: fakeAudienceDraw({ open: true, keyword: "!tirage", level: "all", expiresAt: "2026-10-14T21:00:00Z" }).service, settings: { chatManage: true } } });
  const { bot, tw } = w;
  await C.saveCommand(bot, { kind: "custom" }, { name: "hello", text: "Welcome {utilisateur}", enabled: true, role: "everyone" }, { src: SRC.noSources(), t: bot.t, prefix: "!" });
  const info = await A.context(bot, { declare: false });
  const rep = await C.saveCommand(bot, { kind: "custom" }, { name: "rappel", text: "Remember to hydrate", enabled: true, role: "everyone", timerOnly: true, repeat: { minutes: 1, lines: 0, when: "always", enabled: true } }, info.env);
  assert.equal(rep.ok, true);
  const MOD = { badges: ["moderator"], chatterId: "300", login: "marie_mod", name: "Marie_Mod" };
  const OWNER = { badges: ["broadcaster"], chatterId: "100", login: "emma", name: "Emma" };
  let n = 0, at = NOW;
  const as = (text, who = {}) => say(bot, text, { messageId: `p${++n}`, chatterId: `v${n}`, login: `viewer${n}`, ...who }, (at += 120_000));
  // running: it answers
  assert.equal((await as("!hello")).result, "sent");
  const before = tw.chat.length;
  await w.press("pause");
  // 1. chat commands
  assert.deepEqual([(await as("!hello")).reason, (await as("!hello")).result], ["muted", "refused"]);
  // 2. management commands from the chat
  assert.equal((await as("!addcom nope Hi", MOD)).reason, "muted");
  assert.equal((await C.loadConfig(bot)).data.custom.some((c) => c.name === "nope"), false);
  // 3. repeating commands (timers), by a chat line and by the one-minute task
  T.resetTimersMemory?.();
  const tr = await T.processTimers(bot, chat("hi", { messageId: "t1" }), { now: at + 10 * 60_000 });
  const tr2 = await T.processTimers(bot, chat("hi", { messageId: "t2" }), { now: at + 20 * 60_000 });
  assert.ok(![tr.sent, tr2.sent].includes(true));
  const tick = await T.processTimers(bot, null, { now: at + 30 * 60_000, tick: true });
  assert.equal(tick.sent, false);
  // 4. 'Send now' of a repeating command
  const key = (await C.loadConfig(bot)).data.custom.find((c) => c.name === "rappel");
  assert.equal((await T.sendNow(bot, `custom:${key.id}`, { now: at })).code, "muted");
  // 5. the giveaway fed from the chat
  const drawn = await D.feedDraw(bot, chat("!tirage", { messageId: "d1", chatterId: "u1", login: "user1", name: "User1" }), { now: NOW });
  assert.deepEqual([drawn.entered, drawn.why], [false, "muted"]);
  // 6. the replies of the home emergency words (!stop / !start) stay silent
  await as("!stop", OWNER);
  assert.equal(tw.chat.length, before, "not one message was written while paused");
  // resumed: they all work again
  await w.press("resume");
  assert.equal((await as("!hello")).result, "sent");
  assert.equal((await as("!addcom nope Hi", MOD)).result, "sent");
  assert.equal(tw.chat.length > before, true);
});

/* ───────────── Quick add ───────────── */

test("quick add: a name and a reply create a text-only command with the defaults of the bot (everyone, usual delays, enabled); it answers; the panel shows it", async () => {
  const w = await remoteWorld();
  const r = await w.press("addcom", { name: "!Hello", text: "Welcome {utilisateur}, make yourself at home" });
  assert.deepEqual([r.ok, r.message], [true, "Command !hello added."]);
  const [c] = await w.commands();
  assert.deepEqual([c.name, c.text, c.enabled, c.role, c.cdGlobal, c.cdUser, c.aliases, c.period ?? null, c.repeat ?? null, c.timerOnly ?? false],
    ["hello", "Welcome {utilisateur}, make yourself at home", true, "everyone", null, null, [], null, null, false]);
  const reply = await say(w.bot, "!hello", { chatterId: "9", login: "lune_douce", name: "lune_douce" }, NOW);
  assert.equal(reply.result, "sent");
  assert.equal(w.tw.chat.at(-1).message, "Welcome lune_douce, make yourself at home");
  const p = botPanel(await w.panels());
  assert.deepEqual(p.buttons.map((b) => [b.id, b.label, b.group, b.values.id === c.id]), [["undo", "Delete !hello", "Just added", true]]);
  assert.deepEqual(w.bot.dumpLog().map((l) => [l.action, l.data?.name]), [["command.quickadded", "hello"]]);
  // the typed prefix, case and spaces are forgiven, like in the administration
  assert.equal((await w.press("addcom", { name: "  MERCH ", text: "Shop: example.org/shop" })).ok, true);
  assert.deepEqual((await w.commands()).map((x) => x.name), ["hello", "merch"]);
});

test("quick add: refusals are plain, give an example, and name the field (so the page keeps what was typed and puts the cursor there)", async () => {
  const w = await remoteWorld();
  await w.press("addcom", { name: "hello", text: "Hi" });
  const cases = [
    [{ name: "", text: "Hi" }, "name", /Write a name for the command, for example hello\./],
    [{ name: "!", text: "Hi" }, "name", /Write a name/],
    [{ name: "two words", text: "Hi" }, "name", /“two words” cannot be a name\. Use letters and digits, no space, for example hello\./],
    [{ name: "bad/name", text: "Hi" }, "name", /cannot be a name/],
    [{ name: "x".repeat(26), text: "Hi" }, "name", /cannot be a name/],
    [{ name: "hello", text: "Other" }, "name", /!hello is already used\. Pick another name, for example !hello2\./],
    [{ name: "HELLO", text: "Other" }, "name", /already used/],
    [{ name: "game", text: "Other" }, "name", /already used/],       // an alias of a ready-made command
    [{ name: "planning", text: "Other" }, "name", /already used/],    // a ready-made command
    [{ name: "stop", text: "Other" }, "name", /already used/],        // a reserved word
    [{ name: "addcom", text: "Other" }, "name", /already used/],
    [{ name: "fresh", text: "" }, "text", /Write the reply, for example: Welcome, make yourself at home\./],
    [{ name: "fresh", text: "   " }, "text", /Write the reply/],
    [{ name: "fresh", text: "/ban someone" }, "text", /cannot start with/],
    [{ name: "fresh", text: ".something" }, "text", /cannot start with/],
    [{ name: "fresh", text: "!hello again" }, "text", /cannot start with/],
    [{ name: "fresh", text: "Hi {nothing}" }, "text", /“\{nothing\}” is not known by the bot\. Write plain text, or remove the curly braces\./],
    [{ name: "fresh", text: "Read {urlfetch https://example.org/a}" }, "text", /calls a website\. Add that kind of command in the administration\./],
    [{ name: "fresh", text: "Read {  URLFETCH https://example.org/a}" }, "text", /calls a website/],
    [{ name: "fresh", text: "Read {calcul {urlfetch https://example.org/a}}" }, "text", /calls a website/],
  ];
  for (const [values, field, re] of cases) {
    const r = await w.press("addcom", values);
    assert.equal(r.ok, false, JSON.stringify(values));
    assert.equal(r.field, field, JSON.stringify(values)); assert.match(r.message, re, JSON.stringify(values));
    assert.doesNotMatch(r.message, /undefined|\[object|Error|exception|code \d/i);
    assert.ok(r.message.split(/\s+/).length <= 24, `short: ${r.message}`);
  }
  assert.deepEqual((await w.commands()).map((c) => c.name), ["hello"], "not one refused command was kept");
});

test("quick add: nothing more dangerous than the defaults can come out of this form (no role, delay, alias, period, repeat, timer, action: extra values are ignored)", async () => {
  const w = await remoteWorld();
  const r = await w.press("addcom", { name: "sneaky", text: "Hi", role: "owner", cdGlobal: "0", cdUser: "0", aliases: "a,b", repeat: "1", repeatEvery: "60", timerOnly: "on", enabled: "off", action: "lights:red", kind: "builtin", id: "x" });
  assert.equal(r.ok, true);
  const [c] = await w.commands();
  assert.deepEqual([c.role, c.cdGlobal, c.cdUser, c.aliases, c.enabled, c.repeat ?? null, c.timerOnly ?? false, c.period ?? null], ["everyone", null, null, [], true, null, false, null]);
  assert.deepEqual(Object.keys(c).sort(), ["aliases", "cdGlobal", "cdUser", "enabled", "id", "name", "role", "text"]);
  // what the viewers type is cleaned by the bot as for every command (no braces, no command words reinjected)
  await C.saveCommand(w.bot, { kind: "custom" }, { name: "say", text: "{requete}", enabled: true }, { src: SRC.noSources(), t: w.bot.t, prefix: "!" });
  const out = await say(w.bot, "!say /ban {jeu} !stop .x", { chatterId: "9", login: "v9" }, NOW);
  assert.equal(out.result, "sent");
  assert.ok(!/^[/.!]/.test(w.tw.chat.at(-1).message) && !/[{}]/.test(w.tw.chat.at(-1).message), w.tw.chat.at(-1).message);
});

test("quick add: the hundred-command limit is told in words; a very long reply is cut by Audience before the bot sees it (200 characters)", async () => {
  const w = await remoteWorld();
  for (let i = 0; i < C.MAX_CUSTOM; i++) assert.equal((await RM.press(w.bot, { action: "addcom", values: { name: `c${i}`, text: "x" } })).ok, true);
  const full = await w.press("addcom", { name: "onemore", text: "x" });
  assert.deepEqual([full.ok, full.error], [false, "full"]);
  assert.match(full.message, /maximum number of commands/);
  const w2 = await remoteWorld();
  const r = await w2.press("addcom", { name: "long", text: "y".repeat(400) });
  assert.equal(r.ok, true);
  assert.equal((await w2.commands())[0].text.length, 200);
});

test("undo: removes the command just added, its counter and its entry; refused once it was changed in the administration; gone once deleted there", async () => {
  const w = await remoteWorld();
  await w.press("addcom", { name: "one", text: "First" }); await w.press("addcom", { name: "two", text: "Second" }); await w.press("addcom", { name: "three", text: "Third" }); await w.press("addcom", { name: "four", text: "Fourth" });
  let p = botPanel(await w.panels());
  assert.deepEqual(p.buttons.map((b) => b.label), ["Delete !four", "Delete !three", "Delete !two"], "the last three, newest first");
  const id = (name) => p.buttons.find((b) => b.label === `Delete !${name}`).values.id;
  const undone = await w.press("undo", { id: id("four") });
  assert.deepEqual([undone.ok, undone.message], [true, "Command !four deleted."]);
  assert.deepEqual((await w.commands()).map((c) => c.name), ["one", "two", "three"]);
  assert.deepEqual(w.bot.dumpLog().map((l) => l.action).slice(-1), ["command.quickremoved"]);
  // changed since in the administration: it is theirs now, the button is gone and the press is refused in words
  const three = (await w.commands()).find((c) => c.name === "three");
  const info = await A.context(w.bot, { declare: false });
  await C.saveCommand(w.bot, { kind: "custom", id: three.id }, { text: "Third, edited", role: "mods" }, info.env);
  p = botPanel(await w.panels());
  assert.deepEqual(p.buttons.map((b) => b.label), ["Delete !two", "Delete !one"]);
  const stale = await w.press("undo", { id: three.id });
  assert.deepEqual([stale.ok, stale.error, stale.message], [false, "changed", "!three was changed since. Delete it in the administration."]);
  // deleted in the administration: gone
  await A.actions.remove(w.bot, { id: `custom:${(await w.commands()).find((c) => c.name === "two").id}` });
  const missing = await w.press("undo", { id: id("two") });
  assert.deepEqual([missing.ok, missing.error, missing.message], [false, "gone", "This command no longer exists."]);
});

test("undo: only what was added from the remote can be removed this way; unknown, forged or repeated presses change nothing", async () => {
  const w = await remoteWorld();
  const info = await A.context(w.bot, { declare: false });
  const mine = await C.saveCommand(w.bot, { kind: "custom" }, { name: "mine", text: "From the admin", enabled: true }, info.env);
  await w.press("addcom", { name: "quick", text: "From the remote" });
  const quick = (await w.commands()).find((c) => c.name === "quick");
  for (const values of [{}, { id: "" }, { id: "nope" }, { id: mine.key.slice(7) }, { id: mine.key }, { id: "../quick" }]) {
    const r = await w.press("undo", values);
    assert.equal(r.ok, false, JSON.stringify(values));
  }
  assert.deepEqual((await w.commands()).map((c) => c.name).sort(), ["mine", "quick"], "the command made in the administration cannot be removed from here");
  assert.equal((await w.press("undo", { id: quick.id })).ok, true);
  const again = await w.press("undo", { id: quick.id });
  assert.deepEqual([again.ok, again.error], [false, "gone"]);
  assert.deepEqual((await w.commands()).map((c) => c.name), ["mine"]);
});

test("a stale 'changed' undo explains itself, and a command edited then reverted by hand to the same content is still the same", async () => {
  const w = await remoteWorld();
  await w.press("addcom", { name: "solo", text: "Alone" });
  const c = (await w.commands())[0];
  const info = await A.context(w.bot, { declare: false });
  await C.saveCommand(w.bot, { kind: "custom", id: c.id }, { cdGlobal: 5 }, info.env);
  const r = await RM.press(w.bot, { action: "undo", values: { id: c.id } });
  assert.deepEqual([r.ok, r.error, r.message], [false, "changed", "!solo was changed since. Delete it in the administration."]);
  await C.saveCommand(w.bot, { kind: "custom", id: c.id }, { cdGlobal: "" }, info.env);
  assert.equal((await RM.press(w.bot, { action: "undo", values: { id: c.id } })).ok, true);
});

test("unknown gestures are refused in words", async () => {
  const w = await remoteWorld();
  for (const action of ["delete", "rm", "settings", "mute", "unmute", "reset", "stop", "start", "pause2", ""]) {
    const r = await RM.press(w.bot, { action, values: {} });
    assert.deepEqual([r.ok, r.error], [false, "invalid"], action);
  }
  assert.deepEqual([(await RM.press(w.bot, null)).ok, (await RM.press(w.bot, { action: "addcom", values: null })).ok], [false, false]);
  assert.equal(await w.muted(), false); assert.deepEqual(await w.commands(), []);
});

/* ───────────── Authentication: the secret address of the remote, its rate limit, its allow-list ───────────── */

test("the buttons are as protected as the rest of the remote: no secret address, a wrong one, or a forged panel → nothing happens", async () => {
  const w = await remoteWorld();
  const body = { panel: "id-bot", action: "pause", values: {} };
  for (const k of [null, "", "wrong", w.key.slice(0, -1), `${w.key}x`, w.key.toUpperCase()]) {
    const r = await w.route(body, { k });
    assert.equal(r.status, 404, String(k));
  }
  assert.equal(await w.muted(), false, "not one of them paused the bot");
  const add = await w.route({ panel: "id-bot", action: "addcom", values: { name: "intruder", text: "Hi" } }, { k: "wrong" });
  assert.equal(add.status, 404); assert.deepEqual(await w.commands(), []);
  // the right address works, through the real route, with the real answers
  const ok = await w.route(body);
  assert.deepEqual([ok.status, (await ok.json()).ok], [200, true]);
  assert.equal(await w.muted(), true);
  // a panel that is not a plugged-in module is "gone"; an action name that is not a plain word is "invalid"
  const gone = await w.route({ panel: "id-nobody", action: "pause" });
  assert.equal(gone.status, 404);
  for (const action of ["Pause", "pause now", "../pause", "x".repeat(40), 5]) assert.equal((await w.route({ panel: "id-bot", action })).status, 400, String(action));
  // GET is not a press
  const get = await audDef.routes["remote-press"](new Request(w.url("remote-press"), { method: "GET" }), w.aud);
  assert.equal(get.status, 405);
});

test("the existing rate limit covers the new gestures: 60 presses a minute for the whole remote, then 'limit' with a plain message, and the wrong-address limit still applies", async () => {
  const w = await remoteWorld();
  let last;
  for (let i = 0; i < 60; i++) last = await w.route({ panel: "id-bot", action: i % 2 ? "resume" : "pause" });
  assert.equal(last.status, 200);
  const over = await w.route({ panel: "id-bot", action: "pause" });
  assert.equal(over.status, 429);
  const j = await over.json();
  assert.deepEqual([j.ok, j.error], [false, "limit"]); assert.match(j.message, /Too many presses/);
  const w2 = await remoteWorld();
  let st = 0;
  for (let i = 0; i < 45; i++) st = (await w2.route({ panel: "id-bot", action: "pause" }, { k: "guess" + i })).status;
  assert.equal(st, 429, "guessing the address is slowed down for the new gestures too");
  assert.equal(await w2.muted(), false);
});

test("the journal of Audience names the gestures in words, and keeps the others as they were", async () => {
  const w = await remoteWorld();
  await w.press("pause"); await w.press("resume"); await w.press("addcom", { name: "one", text: "x" });
  const id = (await w.commands())[0].id;
  await w.press("undo", { id });
  const page = await audDef.adminPanel(w.aud, { query: { tab: "use" } });
  const text = JSON.stringify(page);
  for (const label of ["Twitch bot paused", "Twitch bot answering again", "Chat command added", "Chat command deleted"]) assert.match(text, new RegExp(label), label);
});

/* ───────────── Words: EN and FR on par, plain, short ───────────── */

const rcKeys = (d) => Object.keys(d).filter((k) => k.startsWith("rc_") || k === "mute_since_remote" || k === "rw_reason_muted");
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("texts: EN and FR have the same keys and the same {variables}; every key the code uses exists", () => {
  assert.deepEqual(Object.keys(botFr).sort(), Object.keys(botEn).sort());
  for (const k of Object.keys(botFr)) assert.equal(vars(botFr[k]), vars(botEn[k]), k);
  const used = new Set([...fs.readFileSync(`${DIR}/remote.mjs`, "utf8").matchAll(/\bt\(\s*(?:"([a-z0-9_]+)"|[^"]*?"([a-z0-9_]+)")/g)].flatMap((m) => [m[1], m[2]]).filter(Boolean));
  for (const k of used) assert.ok(k in botEn, k);
  assert.ok(rcKeys(botEn).length >= 25);
});

test("texts: ergonomics rules on the words of the panel, in both languages (no jargon, labels and hints short, no colon, polite 'vous', short sentences, no shouting)", () => {
  const labels = ["rc_title", "rc_tab", "rc_badge_paused", "rc_switch", "rc_add_title", "rc_add_btn", "rc_f_name", "rc_f_text", "rc_recent", "rc_state_on", "rc_state_paused"];
  const hints = ["rc_switch_hint", "rc_note", "rc_f_name_ex", "rc_f_text_ex"];
  for (const [lang, d] of [["en", botEn], ["fr", botFr]]) {
    for (const k of rcKeys(d)) {
      assert.deepEqual(forbiddenWords(d[k], "twitch-bot"), [], `${lang} ${k}: jargon`);
      assert.deepEqual(toneProblems(d[k], lang), [], `${lang} ${k}: tone`);
    }
    for (const k of labels) { assert.deepEqual(labelProblems(d[k]), [], `${lang} ${k}`); assert.ok(d[k].length <= 40, `${lang} ${k}: ${d[k].length} > 40 (a label of the remote)`); }
    for (const k of ["rc_switch_hint"]) assert.ok(d[k].length <= 60, `${lang} ${k}: ${d[k].length} > 60`);
    for (const k of hints) assert.ok(d[k].length <= 120, k);
    assert.ok(d.rc_undo.replace("{command}", "!" + "x".repeat(25)).length <= 40 + 5, "the undo label fits (cut at 40 by Audience, never hides the name)");
  }
  for (const k of rcKeys(botFr)) assert.doesNotMatch(botFr[k], /\btu\b|\bton\b|\bta\b|\btes\b|!/, `fr ${k}: vouvoiement, no exclamation`);
  for (const k of rcKeys(botEn)) assert.doesNotMatch(botEn[k], /!|\bPlease\b/, `en ${k}`);
  for (const e of manifest.logEvents.filter((x) => /^(bot|command)\./.test(x.key))) for (const l of ["fr", "en"]) { assert.deepEqual(forbiddenWords(e.label[l], "twitch-bot"), [], e.key); assert.deepEqual(toneProblems(e.label[l], l), [], e.key); }
});
