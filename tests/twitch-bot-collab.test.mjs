// Twitch bot 1.14.0: the collaboration mode (the bot talks less on its own in a shared chat). Invented names only.
// Timers are thinned out (1 in 2 or 3, counted per timer and kept) or paused; commands still answer; the mode ends by itself; the switch is on the page, the remote control and the assistant tools.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseManifest } from "@/core/modules/manifest";
import { remoteWorld } from "./helpers/botRemoteWorld.mjs";
import { world, chat, say, NOW, S, C, fr, en } from "./helpers/botWorld.mjs";
import { formOfBlocks } from "./helpers/ui.mjs";
import { assertAdminPageErgonomics, labelProblems, forbiddenWords, toneProblems } from "./helpers/ergonomics.mjs";

const DIR = new URL("../modules/twitch-bot", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const CO = await import("../modules/twitch-bot/collab.mjs");
const T = await import("../modules/twitch-bot/timers.mjs");
const A = await import("../modules/twitch-bot/admin.mjs");
const tools = (await import("../modules/twitch-bot/tools.mjs")).default;
const def = (await import("../modules/twitch-bot/index.mjs")).default;
const MIN = 60_000, H = 3_600_000;

const fresh = (o = {}) => { T.resetTimersMemory(); return world({ locale: "en", ...o }); };
const add = async (ctx, name, o = {}) => {
  const { minutes = 10, lines = 0, when = "always", ...rest } = o;
  const info = await A.context(ctx, { declare: false });
  const r = await C.saveCommand(ctx, { kind: "custom" }, { name, text: `Message ${name}`, role: "everyone", enabled: true, repeat: { minutes, lines, when, enabled: true }, ...rest }, info.env);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.key;
};
let n = 0;
const line = (ctx, now) => T.processTimers(ctx, chat("bonjour", { messageId: `L${++n}`, chatterId: `c${n % 7}`, login: `viewer${n % 7}` }), { now });
const texts = (tw) => tw.chat.map((m) => m.message);

/* ───────────── The pure part ───────────── */

test("choices: defaults are thin 1 in 3, delays unchanged, other messages kept, automatic end after 6 hours; damaged values fall back", () => {
  assert.deepEqual(CO.choicesOf({}), { mode: "thin", ratio: 3, factor: 1, quiet: false, hours: 6 });
  assert.deepEqual(CO.choicesOf({ collabCfg: { mode: "x", ratio: 7, factor: 99, quiet: "yes", hours: -1 } }), CO.DEFAULTS);
  const off = CO.effective({}, NOW);
  assert.deepEqual([off.on, off.since, off.until, off.by], [false, null, null, null]);
});

test("an automatic end that has passed counts as off even before anybody wrote it down; a mode without end stays on", () => {
  const st = { collab: { on: true, since: NOW, by: "admin", until: NOW + H } };
  assert.equal(CO.effective(st, NOW + H - 1).on, true);
  const gone = CO.effective(st, NOW + H);
  assert.deepEqual([gone.on, gone.expired], [false, true]);
  assert.equal(CO.effective({ collab: { on: true, since: NOW, by: "remote", until: null } }, NOW + 99 * H).on, true);
  assert.equal(CO.effective({ collab: { on: true } }, NOW).on, false, "no start date: not on");
});

test("check: values outside the bounds are refused with the field that holds them; an empty field takes its default", () => {
  assert.equal(CO.check({ mode: "thin", ratio: "3", factor: "3", hours: "6", quiet: "on" }, CO.DEFAULTS).ok, true);
  const bad = CO.check({ mode: "x", ratio: "5", factor: "9", hours: "30" }, CO.DEFAULTS);
  assert.deepEqual(Object.keys(bad.errors).sort(), ["collabFactor", "collabHours", "collabMode", "collabRatio"]);
  const empty = CO.check({ mode: "pause", ratio: "2", factor: "", hours: "", quiet: "off" }, CO.DEFAULTS);
  assert.deepEqual(empty.value, { mode: "pause", ratio: 2, factor: 1, hours: 6, quiet: false });
  assert.equal(CO.check({ mode: "thin", ratio: "3", factor: "2.5", hours: "0" }, CO.DEFAULTS).ok, false);
  assert.equal(CO.check({ mode: "thin", ratio: "3", factor: "2", hours: "0" }, CO.DEFAULTS).value.hours, 0);
});

/* ───────────── The switch: state, journal, restart ───────────── */

test("switch: off by default; on keeps who and since when; a repeated press changes nothing; off clears; the journal and the history have each change once", async () => {
  const { ctx } = fresh();
  assert.equal((await CO.current(ctx, NOW)).on, false);
  assert.deepEqual(await CO.setOn(ctx, true, "remote", { now: NOW }), { changed: true, on: true });
  assert.deepEqual(await CO.setOn(ctx, true, "admin", { now: NOW + 5 * MIN }), { changed: false, on: true });
  const e = await CO.current(ctx, NOW + 10 * MIN);
  assert.deepEqual([e.on, e.since, e.by, e.until], [true, NOW, "remote", NOW + 6 * H], "6 hours by default; the second press did not move the date");
  S.resetMemory();   // a restart: the memory is gone, the state is stored
  assert.equal((await CO.current(ctx, NOW + 20 * MIN)).on, true, "survives a restart");
  await CO.setOn(ctx, false, "admin", { now: NOW + 30 * MIN });
  assert.equal((await CO.current(ctx, NOW + 31 * MIN)).on, false);
  assert.deepEqual((await CO.current(ctx, NOW + 31 * MIN)).history.map((h) => [h.on, h.by]), [[false, "admin"], [true, "remote"]]);
  assert.deepEqual(ctx.dumpLog().filter((l) => l.action.startsWith("collab.")).map((l) => [l.action, l.data.by]), [["collab.on", "remote"], ["collab.off", "admin"]]);
});

test("automatic end: the clock ends the mode, writes it down once as 'auto', and a new start is a fresh run; 0 hours means never", async () => {
  const { ctx } = fresh();
  await CO.saveChoices(ctx, { ...CO.DEFAULTS, hours: 2 });
  await CO.setOn(ctx, true, "admin", { now: NOW });
  assert.equal((await CO.current(ctx, NOW + 2 * H - 1)).on, true);
  const after = await CO.current(ctx, NOW + 2 * H);
  assert.equal(after.on, false);
  assert.deepEqual((await S.readState(ctx)).collabLog.slice(0, 2).map((h) => [h.on, h.by]), [[false, "auto"], [true, "admin"]]);
  assert.equal((await CO.current(ctx, NOW + 3 * H)).history.filter((h) => h.by === "auto").length, 1, "written once");
  await CO.saveChoices(ctx, { ...CO.DEFAULTS, hours: 0 });
  await CO.setOn(ctx, true, "admin", { now: NOW + 4 * H });
  assert.equal((await CO.current(ctx, NOW + 90 * H)).on, true, "no end");
  // the end moves with the choice while the mode is on
  await CO.saveChoices(ctx, { ...CO.DEFAULTS, hours: 1 });
  assert.equal((await CO.current(ctx, NOW + 4 * H + 30 * MIN)).until, NOW + 5 * H);
});

/* ───────────── Timers ───────────── */

test("thin out 1 in 3: one send out of three due turns, per timer; the others wait their next turn", async () => {
  const { ctx, tw } = fresh();
  await add(ctx, "rappel");
  await CO.setOn(ctx, true, "admin", { now: NOW });
  await line(ctx, NOW);   // arms the timer
  const sent = [];
  for (let i = 1; i <= 9; i++) { const r = await line(ctx, NOW + i * 10 * MIN); sent.push(r.sent); }
  assert.deepEqual(sent, [false, false, true, false, false, true, false, false, true]);
  assert.equal(texts(tw).length, 3);
});

test("thin out 1 in 2: every 2nd due turn of a timer sends, and a second timer is not starved by the first", async () => {
  const { ctx, tw } = fresh();
  await CO.saveChoices(ctx, { ...CO.DEFAULTS, ratio: 2 });
  await add(ctx, "alpha"); await add(ctx, "beta", { minutes: 20 });
  await CO.setOn(ctx, true, "admin", { now: NOW });
  await line(ctx, NOW);
  for (let i = 1; i <= 12; i++) await line(ctx, NOW + i * 10 * MIN);
  const out = texts(tw);
  assert.equal(out.filter((x) => x === "Message alpha").length, 6, "alpha: due 12 times, 6 sent");
  assert.ok(out.includes("Message beta"), "beta is sent too (one timer per message, the other waits its turn)");
});

test("the count is written down: after a restart the timer goes on counting where it was", async () => {
  const { ctx, tw } = fresh();
  await add(ctx, "rappel");
  await CO.setOn(ctx, true, "admin", { now: NOW });
  await line(ctx, NOW);
  await line(ctx, NOW + 10 * MIN);   // counted 1, skipped
  await line(ctx, NOW + 20 * MIN);   // counted 2, skipped (this one flushes: the pass is 10 s after the last write)
  assert.equal(tw.chat.length, 0);
  const stored = (await ctx.api.store.list("botTimers", { limit: 1 }))[0].data.items;
  assert.equal(Object.values(stored)[0].thin, 2);
  T.resetTimersMemory(); S.resetMemory();   // a restart
  const r = await line(ctx, NOW + 30 * MIN);
  assert.deepEqual([r.sent, texts(tw)], [true, ["Message rappel"]], "the third turn sends");
});

test("pause: no timer goes out, and when the mode ends the timers wait a full interval again (no burst)", async () => {
  const { ctx, tw } = fresh();
  await add(ctx, "rappel");
  await CO.saveChoices(ctx, { ...CO.DEFAULTS, mode: "pause" });
  await CO.setOn(ctx, true, "admin", { now: NOW });
  await line(ctx, NOW);
  for (let i = 1; i <= 6; i++) assert.equal((await line(ctx, NOW + i * 10 * MIN)).sent, false);
  assert.equal(tw.chat.length, 0);
  await CO.setOn(ctx, false, "admin", { now: NOW + 61 * MIN });
  assert.equal((await line(ctx, NOW + 62 * MIN)).sent, false, "no burst at the end");
  assert.equal((await line(ctx, NOW + 69 * MIN)).sent, false);
  assert.equal((await line(ctx, NOW + 70 * MIN)).sent, true, "the interval counted from the last restart (minute 60)");
});

test("mode off again: the counters are forgotten, and a mode switched on later starts from zero", async () => {
  const { ctx, tw } = fresh();
  await add(ctx, "rappel");
  await CO.setOn(ctx, true, "admin", { now: NOW });
  await line(ctx, NOW);
  await line(ctx, NOW + 10 * MIN); await line(ctx, NOW + 20 * MIN);   // counted 2
  await CO.setOn(ctx, false, "admin", { now: NOW + 21 * MIN });
  assert.equal((await line(ctx, NOW + 30 * MIN)).sent, true, "off: the timer is normal again (the 10 minutes since the last restart are over)");
  assert.equal(tw.chat.length, 1);
  await CO.setOn(ctx, true, "admin", { now: NOW + 31 * MIN });
  assert.equal((await line(ctx, NOW + 40 * MIN)).sent, false, "a new run counts 1, not 3");
  assert.equal((await line(ctx, NOW + 50 * MIN)).sent, false);
  assert.equal((await line(ctx, NOW + 60 * MIN)).sent, true);
});

test("toggled in the middle of a wait: the timer keeps its schedule; 'Send now' is never thinned; the emergency stop still wins", async () => {
  const { ctx, tw } = fresh();
  const key = await add(ctx, "rappel");
  await line(ctx, NOW);
  await CO.setOn(ctx, true, "admin", { now: NOW + 5 * MIN });   // 5 minutes into a 10-minute wait
  assert.equal((await line(ctx, NOW + 9 * MIN)).sent, false);
  assert.equal((await line(ctx, NOW + 10 * MIN)).sent, false, "due, but thinned");
  const now = await T.sendNow(ctx, key, { now: NOW + 11 * MIN });
  assert.equal(now.ok, true, "a manual send goes out");
  await S.setMuted(ctx, true);
  assert.equal((await line(ctx, NOW + 90 * MIN)).why, "muted");
});

/* ───────────── Commands ───────────── */

test("commands still answer; delays are stretched only while the mode is on and only by the factor; the mode alone changes no delay", async () => {
  const { ctx, tw } = fresh();
  assert.equal((await say(ctx, "!jeu", { chatterId: "c1", login: "lune_douce" }, NOW)).result, "sent");
  await CO.setOn(ctx, true, "admin", { now: NOW + MIN });
  assert.equal((await say(ctx, "!jeu", { chatterId: "c2", login: "etoile_nord" }, NOW + 2 * MIN)).result, "sent", "the mode alone: a command still answers");
  await CO.saveChoices(ctx, { ...CO.DEFAULTS, factor: 3 });
  assert.equal((await say(ctx, "!jeu", { chatterId: "c3", login: "camille" }, NOW + 3 * MIN)).result, "sent");
  // the default delay for one person is 60 s: at 90 s it is over, but 3 x 60 s = 180 s is not
  const again = await say(ctx, "!jeu", { chatterId: "c3", login: "camille" }, NOW + 3 * MIN + 90_000);
  assert.deepEqual([again.result, again.reason], ["refused", "cooldown"]);
  assert.equal((await say(ctx, "!jeu", { chatterId: "c3", login: "camille" }, NOW + 3 * MIN + 181_000)).result, "sent");
  await CO.setOn(ctx, false, "admin", { now: NOW + 10 * MIN });
  assert.equal((await say(ctx, "!jeu", { chatterId: "c4", login: "c4" }, NOW + 11 * MIN)).result, "sent");
  assert.equal((await say(ctx, "!jeu", { chatterId: "c4", login: "c4" }, NOW + 11 * MIN + 90_000)).result, "sent", "off: the usual delay again");
  assert.equal(tw.chat.length, 6);
});

test("messages from the other side of a shared chat are still ignored, with the mode on", async () => {
  const { ctx, tw } = fresh();
  await CO.setOn(ctx, true, "admin", { now: NOW });
  const r = await say(ctx, "!jeu", { foreign: true }, NOW + MIN);
  assert.deepEqual([r.handled, r.why], [false, "foreign"]);
  assert.equal(tw.chat.length, 0);
});

/* ───────────── The page ───────────── */

const barOf = async (ctx) => (await A.panel(ctx, { query: {} })).filter((b) => b.type === "html").map((b) => b.html).join("\n");

test("page: the line under the status bar says off by default, then on with since when, what it does and when it ends; one button each way; the choices form has two visible fields", async () => {
  const { ctx } = fresh();
  let html = await barOf(ctx);
  assert.match(html, /Collaboration mode off/); assert.match(html, /Start collaboration mode/); assert.doesNotMatch(html, /Stop collaboration mode/);
  const r = await A.actions.collabOn(ctx);
  assert.match(r.ok, /Collaboration mode is on/);
  html = await barOf(ctx);
  assert.match(html, /Collaboration mode on/); assert.match(html, /Since /); assert.match(html, /1 timer in 3 goes out/); assert.match(html, /Ends by itself at/); assert.match(html, /Stop collaboration mode/);
  const blocks = await A.panel(ctx, { query: {} });
  const form = blocks.find((b) => b.type === "adminForm" && b.action === "collabSave");
  assert.deepEqual(form.fields.filter((f) => !f.folded).map((f) => f.name), ["collabMode", "collabRatio"], "two visible choices");
  assert.deepEqual(form.fields.filter((f) => f.folded).map((f) => f.name), ["collabFactor", "collabQuiet", "collabHours"], "the rare ones are folded");
  assert.deepEqual(form.fields[0].options.map((o) => o.label), ["Thin out", "Pause"]);
  assert.equal(form.submitLabel, "Save the choices");
  assert.equal((await A.actions.collabOff(ctx)).ok.startsWith("Collaboration mode is off"), true);
  assert.equal((await A.actions.collabOff(ctx)).ok.startsWith("Collaboration mode is off"), true, "idempotent");
});

test("page: saving the choices keeps them; a wrong value is said under its field with an example and nothing is saved", async () => {
  const { ctx } = fresh();
  const ok = await A.actions.collabSave(ctx, { collabMode: "pause", collabRatio: "2", collabFactor: "2", collabQuiet: "on", collabHours: "4" });
  assert.equal(ok.ok, "Choices saved.");
  assert.deepEqual(CO.choicesOf(await S.readState(ctx)), { mode: "pause", ratio: 2, factor: 2, quiet: true, hours: 4 });
  const bad = await A.actions.collabSave(ctx, { collabMode: "thin", collabRatio: "3", collabFactor: "9", collabHours: "30" });
  assert.match(bad.errors.collabFactor, /for example 3/); assert.match(bad.errors.collabHours, /for example 6/);
  assert.equal(CO.choicesOf(await S.readState(ctx)).factor, 2, "nothing saved");
  assert.equal(formOfBlocks(await A.panel(ctx, { query: {} }), "collabSave").fields.find((f) => f.name === "collabMode").value, "pause", "the saved choices are shown");
});

test("page: ergonomics (field budget, labels, helps) and the same page in French", async () => {
  const { ctx } = fresh();
  await add(ctx, "salut", { repeat: undefined, minutes: 5 });
  await CO.setOn(ctx, true, "admin");
  assertAdminPageErgonomics(await A.panel(ctx, { query: {} }), { errors: [] });
  const keys = Object.keys(en).filter((k) => k.startsWith("co_") || k.startsWith("rc_collab") || k === "rc_badge_collab" || k === "rc_e_collab" || k === "rw_reason_collab");
  assert.ok(keys.length >= 36);
  for (const k of keys) {
    assert.ok(k in fr, `fr has ${k}`);
    assert.deepEqual([...en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...fr[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), `variables of ${k}`);
    for (const [lang, d] of [["en", en], ["fr", fr]]) { assert.deepEqual(forbiddenWords(d[k], "twitch-bot"), [], `${lang} ${k}`); assert.deepEqual(toneProblems(d[k], lang), [], `${lang} ${k}`); }
  }
  for (const k of ["co_f_mode", "co_f_ratio", "co_f_factor", "co_f_quiet", "co_f_hours", "co_start_btn", "co_stop_btn", "co_pill_on"]) for (const d of [en, fr]) assert.deepEqual(labelProblems(d[k]), [], k);
  for (const k of ["co_f_ratio_help", "co_f_factor_help", "co_f_quiet_help", "co_f_hours_help"]) for (const d of [en, fr]) assert.ok(d[k].length <= 60, `${k} (${d[k].length})`);
});

/* ───────────── Remote control and assistant ───────────── */

test("remote: a second switch shows the CURRENT state and carries the action that flips it; the tab says 'Collab'; the presses are journaled; the pause keeps the first place", async () => {
  const w = await remoteWorld();
  let p = (await w.panels()).find((x) => x.id === "id-bot");
  assert.deepEqual(p.toggles.map((t) => [t.id, t.on]), [["pause", true], ["collabon", false]]);
  assert.equal(p.toggles[1].text, "Off, the bot talks as usual");
  const r = await w.press("collabon");
  assert.deepEqual([r.ok, r.message], [true, "Collaboration mode is on: the bot talks less on its own."]);
  p = (await w.panels()).find((x) => x.id === "id-bot");
  assert.deepEqual([p.toggles[1].id, p.toggles[1].on, p.toggles[1].text, p.badge, p.alert], ["collaboff", true, "On, 1 timer in 3 goes out", "Collab", false]);
  assert.equal((await CO.current(w.bot)).by, "remote");
  assert.equal((await w.press("collabon")).ok, true, "a stale second tap is harmless");
  await w.press("pause");
  assert.equal((await w.panels()).find((x) => x.id === "id-bot").badge, "Paused", "the emergency stop outranks");
  assert.equal((await w.press("collaboff")).ok, true);
  assert.equal((await CO.current(w.bot)).on, false);
});

test("assistant tool: collaboration_mode_set is a write tool, off by default; it saves choices, switches the mode, refuses bad values; bot_commands_list gives the state", async () => {
  const t = manifest.mcp.find((x) => x.name === "collaboration_mode_set");
  assert.ok(t && t.default === false && !t.readOnly && !t.destructive);
  assert.equal(typeof tools.collaboration_mode_set, "function");
  assert.ok(parseManifest(manifest).ok);
  const { ctx } = fresh();
  assert.equal((await tools.bot_commands_list(ctx, {})).collaborationMode.enabled, false);
  const r = await tools.collaboration_mode_set(ctx, { enabled: true, mode: "thin", ratio: 2, commandDelayFactor: 2, muteOtherAutomaticMessages: true, autoEndHours: 3 });
  assert.equal(r.updated, true);
  assert.deepEqual([r.collaborationMode.enabled, r.collaborationMode.changedFrom, r.collaborationMode.timers, r.collaborationMode.commandDelayFactor, r.collaborationMode.muteOtherAutomaticMessages, r.collaborationMode.autoEndHours], [true, "assistant", "thinned out: 1 in 2 is sent", 2, true, 3]);
  assert.equal((await tools.bot_commands_list(ctx, {})).collaborationMode.enabled, true);
  await assert.rejects(() => tools.collaboration_mode_set(ctx, { enabled: true, commandDelayFactor: 9 }), /whole number from 1 to 5/);
  assert.equal(CO.choicesOf(await S.readState(ctx)).factor, 2, "refused: nothing changed");
  const off = await tools.collaboration_mode_set(ctx, { enabled: false });
  assert.equal(off.collaborationMode.enabled, false);
  assert.deepEqual(CO.choicesOf(await S.readState(ctx)).ratio, 2, "choices are kept for the next time");
});

test("manifest: version, history events, no new permission, route or right; the tick task settles the automatic end", async () => {
  assert.equal(manifest.version, "1.14.0"); assert.equal(manifest.minCore, "0.6.7");
  for (const k of ["collab.on", "collab.off"]) assert.ok(manifest.logEvents.some((e) => e.key === k && e.label.fr && e.label.en), k);
  assert.deepEqual(manifest.permissions, ["routes", "storage", "admin", "topics", "mcp"]);
  assert.deepEqual(manifest.rights.map((x) => x.id), ["rewards.manage", "timers.manage"]);
  assert.deepEqual(Object.keys(def.routes).sort(), ["kit", "webhook"]);
  const { ctx } = fresh();
  await CO.saveChoices(ctx, { ...CO.DEFAULTS, hours: 1 });
  await CO.setOn(ctx, true, "admin", { now: Date.now() - 2 * H });
  await def.tasks.tick.run(ctx);
  assert.equal((await S.readState(ctx)).collab.on, false, "written down by the one-minute task");
  assert.equal((await S.readState(ctx)).collab.by, "auto");
});
