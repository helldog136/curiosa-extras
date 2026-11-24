// Planning 2.10.0: "Post the week's planning to Discord". The connector is a stub that records every call (the real one is tested in discord-connector.test.mjs).
// Checked: off by default and no call, one message edited in place (same key, silent by default), no network call while nothing changed, a burst of edits
// gives one edit, the week rollover rewrites the message, the optional short message (added, moved, cancelled; nothing at the first pass), a connector
// that is missing or failing never breaks the schedule, nobody can be mentioned from a title, and the manifest (settings, FR/EN parity, no forbidden word).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const rd = (m, l) => JSON.parse(fs.readFileSync(new URL(`../modules/${m}/${l}`, import.meta.url), "utf8"));
const planning = await import("../modules/planning/index.mjs");
const entry = await import("../modules/planning/appearances/entry.mjs");
const D = await import("../modules/planning/discord.mjs");
const def = planning.default;
const CHANNEL = "400000000000000001";
// A Monday noon, so that "this week" is the 15th to the 21st of June 2026.
const NOW = Date.parse("2026-06-15T10:00:00Z");
const at = (day, hour) => new Date(Date.UTC(2026, 5, day, hour)).toISOString();
const slot = (id, day, hour, extra = {}) => ({ id, title: `Soirée ${id}`, start: at(day, hour), end: at(day, hour + 2), allDay: false, status: "confirmed", timezone: "UTC", games: [], ...extra });

let calls, items, discordAnswer;
beforeEach(() => { calls = []; items = []; readLog = []; showCancelled = false; discordAnswer = () => ({ ok: true, messageId: "700000000000000001", action: "created" }); D.timing.settleMs = 0; });
const connector = () => ({ "discord.api": new Proxy({}, { get: (_, method) => async (args) => { calls.push({ method, args }); return discordAnswer(method, args); } }) });
const live = (over = {}) => { const S = { days: 7, timezone: "UTC", discordPost: true, discordChannel: CHANNEL, ...over }; return { S, ctx: fakeCtx({ key: "pl", settings: S, topics: { "planning.slot": () => items }, messages: rd("planning", "locales/en.json"), locale: "en", services: connector() }) }; };
const mk = (settings = {}, over = {}) => fakeCtx({ key: "pl", settings: { days: 7, timezone: "UTC", discordPost: true, discordChannel: CHANNEL, ...settings }, topics: { "planning.slot": () => items }, messages: rd("planning", "locales/en.json"), locale: "en", services: connector(), ...over });
let readLog;
const deps = (ctx) => ({ read: async (from, to) => { readLog.push([from, to]); return { items, failed: false }; }, toSlots: planning.toSlots, displayZone: planning.displayZone, sleep: async () => {}, weekStart: entry.weekStartOf, showCancelled: () => showCancelled });
let showCancelled;
const pass = (ctx, now = NOW) => D.syncDiscord(ctx, deps(ctx), now);
const upserts = () => calls.filter((c) => c.method === "upsertManagedMessage");
const posts = () => calls.filter((c) => c.method === "postMessage");

test("off by default: no call at all, and the task exists", async () => {
  const m = rd("planning", "module.json");
  assert.equal(m.settings.find((s) => s.key === "discordPost").default, false);
  assert.equal(typeof def.tasks.discord.run, "function");
  items = [slot("a", 16, 19)];
  assert.equal(await pass(mk({ discordPost: false })), "off");
  assert.equal(await pass(mk({ discordChannel: "" })), "no_channel");
  assert.deepEqual(calls, []);
});

test("one message with the week, silent by default, same key every time", async () => {
  items = [slot("a", 16, 19, { games: ["Celeste"] }), slot("b", 18, 20), slot("c", 25, 20)];
  const ctx = mk();
  assert.equal(await pass(ctx), "posted");
  assert.equal(upserts().length, 1);
  const { args } = upserts()[0];
  assert.deepEqual([args.owner, args.key, args.channelId, args.silent], ["planning", "week-pl", CHANNEL, true]);
  const text = JSON.stringify(args.embeds);
  assert.match(text, /Soirée a/); assert.match(text, /Celeste/); assert.match(text, /Soirée b/);
  assert.ok(!/Soirée c/.test(text), "a stream of next week is not in this week's message");
  assert.match(args.embeds[0].title, /June/);
  assert.match(args.embeds[0].description, /<t:\d+:t>/, "hours are timestamps each member reads in their own zone");
  assert.equal(args.content, undefined);
});

test("notify chooses a notification at creation; an unknown value stays silent", async () => {
  items = [slot("a", 16, 19)];
  await pass(mk({ discordNotify: "notify" }));
  assert.equal(upserts()[0].args.silent, false);
  calls.length = 0;
  await pass(mk({ discordNotify: "loud" }));
  assert.equal(upserts()[0].args.silent, true);
});

test("nothing changed: no call; a change: one edit; a burst of edits gives one edit", async () => {
  items = [slot("a", 16, 19)];
  const ctx = mk();
  assert.equal(await pass(ctx), "posted");
  assert.equal(await pass(ctx), "same"); assert.equal(await pass(ctx), "same");
  assert.equal(calls.length, 1, "no network call while the week is the same");
  items = [slot("a", 16, 19), slot("b", 17, 19)];
  assert.equal(await pass(ctx), "posted");
  assert.equal(upserts().length, 2);
  // a burst: the calendar still moves during the pause
  let n = 0;
  const moving = { ...deps(ctx), read: async () => ({ items: [slot("a", 16, 19), slot("b", 17, 19), slot("x" + (n++ % 2 ? "1" : "2"), 19, 19)], failed: false }) };
  assert.equal(await D.syncDiscord(ctx, moving, NOW), "settling");
  assert.equal(upserts().length, 2, "nothing is posted while it moves");
});

test("the week rollover rewrites the message with no other trigger", async () => {
  items = [slot("a", 16, 19), slot("n", 23, 19)];
  const ctx = mk();
  await pass(ctx);
  assert.equal(await pass(ctx, NOW + 1800_000), "same");
  assert.equal(await pass(ctx, Date.parse("2026-06-22T00:30:00Z")), "posted");
  assert.match(JSON.stringify(upserts().at(-1).args.embeds), /Soirée n/);
  assert.ok(!/Soirée a/.test(JSON.stringify(upserts().at(-1).args.embeds)));
});

test("an empty week and a cancelled stream are said in plain words", async () => {
  const ctx = mk();
  await pass(ctx);
  assert.match(upserts()[0].args.embeds[0].description, /No stream planned/);
  items = [slot("a", 16, 19, { status: "cancelled" })];
  showCancelled = true;
  await pass(ctx);
  assert.match(upserts()[1].args.embeds[0].description, /~~.*Soirée a.*~~ \(cancelled\)/);
});

test("the short message: nothing at the first pass, then added, moved, cancelled; one message, silent by default", async () => {
  items = [slot("a", 16, 19), slot("b", 17, 19)];
  const ctx = mk({ discordEvents: true });
  await pass(ctx);
  assert.equal(posts().length, 0, "the first snapshot is silent");
  items = [slot("a", 16, 21), slot("c", 18, 19, { title: "Nouveau" }), slot("b", 17, 19, { status: "cancelled" })];
  await pass(ctx);
  assert.equal(posts().length, 1);
  const { content, silent, channelId } = posts()[0].args;
  assert.deepEqual([silent, channelId], [true, CHANNEL]);
  assert.match(content, /Stream moved — \*\*Soirée a\*\*/); assert.match(content, /New stream — \*\*Nouveau\*\*/); assert.match(content, /Stream cancelled — \*\*Soirée b\*\*/);
  await pass(ctx);
  assert.equal(posts().length, 1, "said once");
});

test("the short message is off by default and never sent when its setting is off", async () => {
  assert.equal(rd("planning", "module.json").settings.find((s) => s.key === "discordEvents").default, false);
  items = [slot("a", 16, 19)];
  const ctx = mk();
  await pass(ctx);
  items = [slot("a", 16, 21)];
  await pass(ctx);
  assert.equal(posts().length, 0);
});

test("a title cannot mention anybody and cannot format the message", async () => {
  items = [slot("a", 16, 19, { title: "@everyone **hi** [x](https://e.org) <@123456789012345678>" })];
  await pass(mk());
  const d = upserts()[0].args.embeds[0].description;
  assert.ok(!/\*\*hi\*\*/.test(d.replace(/\\\*/g, "")) || /\\\*\\\*hi/.test(d), "markdown is escaped");
  assert.match(d, /\\\[x\\\]\\\(https:\/\/e\.org\\\)/);
  assert.equal(upserts()[0].args.content, undefined);
});

test("a missing or failing connector never breaks anything: the schedule page still renders; the failure is kept for the admin page", async () => {
  items = [slot("a", 16, 19)];
  const none = mk({}, { services: {} });
  assert.equal(await pass(none), "failed");
  const page = await def.page(none);
  assert.ok(page.blocks.length > 0);
  discordAnswer = () => ({ ok: false, reason: "forbidden" });
  const ctx = mk();
  assert.equal(await pass(ctx), "failed");
  assert.deepEqual((await D.lastResult(ctx)).reason, "forbidden");
  const admin = JSON.stringify((await def.adminPanel(ctx)).filter((b) => b.type === "markdown" || b.type === "heading"));
  assert.match(admin, /Discord refuses the bot/);
  assert.ok(!/forbidden|400000000000000001/.test(admin), "no code word, no number");
  discordAnswer = () => { throw new Error("boom"); };
  assert.equal(await pass(mk()), "failed");
});

test("calendars that do not answer: the message stays as it is", async () => {
  const ctx = mk();
  const down = { ...deps(ctx), read: async () => ({ items: [], failed: true }) };
  assert.equal(await D.syncDiscord(ctx, down, NOW), "no_read");
  assert.deepEqual(calls, []);
});

test("manifest: optional need, 3 simple settings plus 1 advanced, a channel picker on the service, FR and EN, short labels", () => {
  const m = rd("planning", "module.json");
  assert.deepEqual(m.requires.find((r) => r.service === "discord.api").optional, true);
  const ch = m.settings.find((s) => s.key === "discordChannel");
  assert.deepEqual(ch.source, { kind: "service", service: "discord.api", list: "channelChoices", get: "channelsByIds" });
  const ds = m.settings.filter((s) => s.key.startsWith("discord"));
  assert.deepEqual(ds.map((s) => [s.key, !!s.advanced]), [["discordPost", false], ["discordChannel", false], ["discordNotify", false], ["discordEvents", true]]);
  assert.equal(m.settings.filter((s) => !s.tab && !s.advanced).length <= 7, true);
  for (const s of ds) for (const l of ["en", "fr"]) { assert.ok(s.label[l].length <= 60 && !/:$/.test(s.label[l]), s.key); if (s.help) assert.ok(s.help[l].length <= 60, s.key); }
  const en = rd("planning", "locales/en.json"), fr = rd("planning", "locales/fr.json");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  for (const k of Object.keys(en)) assert.deepEqual((en[k].match(/\{\w+\}/g) ?? []).sort(), (fr[k].match(/\{\w+\}/g) ?? []).sort(), k);
});

// ───────────── Review follow-up: the week, the false cancellations, the repost, the limits, the back-off ─────────────
const THU = Date.parse("2026-06-18T10:00:00Z");

test("on a Thursday the message still holds Monday to Wednesday: the calendars are read from the first day of the week, not from 24 hours ago", async () => {
  items = [slot("mon", 15, 19), slot("wed", 17, 19), slot("fri", 19, 19), slot("next", 22, 19)];
  assert.equal(await pass(mk(), THU), "posted");
  const text = JSON.stringify(upserts()[0].args.embeds);
  for (const id of ["mon", "wed", "fri"]) assert.match(text, new RegExp(`Soirée ${id}`));
  assert.ok(!/Soirée next/.test(text));
  assert.ok(readLog[0][0].getTime() <= Date.parse("2026-06-15T00:00:00Z"), "the read starts before Monday");
});

test("the week follows the page's first-day setting (Sunday)", async () => {
  items = [slot("sun", 14, 19), slot("sat", 20, 19), slot("mon", 15, 19)];
  await pass(mk({ weekStart: "0" }), NOW);
  const text = JSON.stringify(upserts()[0].args.embeds);
  assert.match(text, /Soirée sun/); assert.match(text, /Soirée sat/);
  calls.length = 0;
  await pass(mk({ weekStart: "1" }), NOW);
  assert.ok(!/Soirée sun/.test(JSON.stringify(upserts()[0].args.embeds)), "Monday start: Sunday the 14th is last week");
});

test("a cancelled stream is in the message only when the page option shows cancelled streams", async () => {
  items = [slot("a", 16, 19), slot("b", 17, 19, { status: "cancelled" })];
  await pass(mk());
  assert.ok(!/Soirée b/.test(JSON.stringify(upserts()[0].args.embeds)));
  showCancelled = true; calls.length = 0;
  await pass(mk());
  assert.match(JSON.stringify(upserts()[0].args.embeds), /Soirée b/);
});

test("no false cancellation: not at the week rollover, not for a stream that already started, and a real removal is still said", async () => {
  items = [slot("a", 16, 19), slot("b", 18, 19)];
  const ctx = mk({ discordEvents: true });
  await pass(ctx, NOW);
  items = [slot("n", 23, 19)];
  assert.equal(await pass(ctx, Date.parse("2026-06-22T00:30:00Z")), "posted");
  assert.equal(posts().length, 0, "rollover says nothing");
  items = [slot("n", 23, 19), slot("x", 24, 8), slot("y", 25, 19)];
  await pass(ctx, Date.parse("2026-06-22T01:00:00Z")); const before = posts().length;
  items = [slot("n", 23, 19), slot("y", 25, 19)];
  await pass(ctx, Date.parse("2026-06-24T12:00:00Z"));
  assert.equal(posts().length, before, "a started stream that disappears is silent");
  items = [slot("n", 23, 19)];
  await pass(ctx, Date.parse("2026-06-24T12:05:00Z"));
  assert.equal(posts().length, before + 1);
  assert.match(posts().at(-1).args.content, /Stream cancelled — \*\*Soirée y\*\*/);
});

test("another channel or the option switched off and on writes the message again; a deleted message is found within the hour", async () => {
  items = [slot("a", 16, 19)];
  const { S, ctx } = live();
  await pass(ctx);
  assert.equal(await pass(ctx), "same");
  S.discordChannel = "400000000000000002";
  assert.equal(await pass(ctx), "posted");
  assert.equal(upserts().at(-1).args.channelId, "400000000000000002");
  const n = upserts().length;
  S.discordPost = false;
  assert.equal(await pass(ctx), "off");
  S.discordPost = true;
  assert.equal(await pass(ctx), "posted");
  assert.equal(upserts().length, n + 1);
  assert.equal(await pass(ctx, NOW + 30 * 60_000), "same");
  const m = upserts().length;
  assert.equal(await pass(ctx, NOW + 61 * 60_000), "posted");
  assert.equal(upserts().length, m + 1); assert.equal(upserts().at(-1).args.verify, true);
});

test("the admin page does not say 'posted' about a channel that has not been written yet", async () => {
  items = [slot("a", 16, 19)];
  const { S, ctx } = live();
  await pass(ctx);
  assert.ok(await D.lastResult(ctx));
  S.discordChannel = "400000000000000002";
  assert.equal(await D.lastResult(ctx), null);
});

test("a long week and hostile titles stay inside Discord's limits and cannot become a timestamp, channel, command or emoji", async () => {
  const evil = "<t:1:R> <#123456789012345678> </ban:1> <:x:1> <a:y:1> <@&123456789012345678> " + "é".repeat(300);
  items = Array.from({ length: 70 }, (_, i) => slot("s" + i, 15 + (i % 7), 8 + (i % 12), { title: evil, games: [evil, evil, evil] }));
  const ctxE = mk({ discordEvents: true });
  await pass(ctxE);
  const e = upserts()[0].args.embeds[0];
  assert.ok(e.description.length <= 4096 && e.title.length <= 256, `${e.description.length}`);
  assert.ok(!/<t:1:R>|<#|<\/|<:|<a:|<@/.test(e.description), "no raw Discord syntax");
  items = items.map((s, i) => ({ ...s, start: at(15 + (i % 7), 9 + (i % 12)) }));
  await pass(ctxE);
  const c = posts().at(-1)?.args.content ?? "";
  assert.ok(c.length > 0 && c.length <= 2000, `${c.length}`);
  assert.ok(!/<t:1:R>|<#|<\/|<:|<a:|<@/.test(c));
});

test("after a failure the module waits (1, 5, 15, 60 minutes) instead of failing every minute; the admin page says when it tries again", async () => {
  items = [slot("a", 16, 19)];
  discordAnswer = () => ({ ok: false, reason: "unavailable" });
  const ctx = mk();
  assert.equal(await pass(ctx, NOW), "failed");
  const n = calls.length;
  assert.equal(await pass(ctx, NOW + 30_000), "backoff");
  assert.equal(calls.length, n, "no call during the wait");
  assert.equal(await pass(ctx, NOW + 61_000), "failed");
  assert.equal(await pass(ctx, NOW + 61_000 + 200_000), "backoff", "the wait grew to 5 minutes");
  discordAnswer = () => ({ ok: true, messageId: "700000000000000001", action: "created" });
  assert.equal(await pass(ctx, NOW + 61_000 + 301_000), "posted");
  discordAnswer = () => ({ ok: false, reason: "unavailable" });
  items = [slot("a", 16, 19), slot("b", 17, 19)];
  await pass(ctx, Date.now());
  const admin = JSON.stringify(await def.adminPanel(ctx));
  assert.match(admin, /Discord does not answer/); assert.match(admin, /Next try at/);
});

test("two passes at once never run together and never leave two state rows", async () => {
  items = [slot("a", 16, 19)];
  let release; const gate = new Promise((r) => { release = r; });
  discordAnswer = async () => { await gate; return { ok: true, messageId: "700000000000000001", action: "created" }; };
  const ctx = mk();
  const first = pass(ctx);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(await pass(ctx), "busy");
  release();
  assert.equal(await first, "posted");
  assert.equal((await ctx.api.store.listByKey("discordSync", "state")).items.length, 1);
});

test("dates are written in the site's default language, not the language of whoever triggered the pass", async () => {
  items = [slot("a", 16, 19)];
  await pass(mk({}, { locale: "en", defaultLocale: "fr" }));
  assert.match(upserts()[0].args.embeds[0].description, /mardi/i);
});

test("a pause given by the connector as an ISO date is honoured: no call before it, 'Next try at' on the page", async () => {
  items = [slot("a", 16, 19)];
  const until = new Date(NOW + 20 * 60_000).toISOString();
  discordAnswer = () => ({ ok: false, reason: "rate_limited", retryAt: until });
  const ctx = mk();
  assert.equal(await pass(ctx, NOW), "failed");
  const n = calls.length;
  assert.equal(await pass(ctx, NOW + 19 * 60_000), "backoff");
  assert.equal(calls.length, n, "no call before the date Discord gave");
  discordAnswer = () => ({ ok: true, messageId: "700000000000000001", action: "created" });
  assert.equal(await pass(ctx, NOW + 20 * 60_000 + 1000), "posted");
  // the page, with a pause in the future
  discordAnswer = () => ({ ok: false, reason: "rate_limited", retryAt: new Date(Date.now() + 20 * 60_000).toISOString() });
  items = [slot("a", 16, 19), slot("b", 17, 19)];
  await pass(ctx, Date.now());
  const admin = JSON.stringify(await def.adminPanel(ctx));
  assert.match(admin, /Discord asks to wait/); assert.match(admin, /Next try at/);
  assert.ok(!/NaN|Invalid/.test(admin));
});

test("when only the short line fails, the module waits and the page says so instead of retrying every minute", async () => {
  items = [slot("a", 16, 19)];
  const ctx = mk({ discordEvents: true });
  await pass(ctx, NOW);
  items = [slot("a", 16, 21)];
  discordAnswer = (m) => (m === "postMessage" ? { ok: false, reason: "unavailable" } : { ok: true, messageId: "700000000000000001", action: "edited" });
  assert.equal(await pass(ctx, NOW + 60_000), "failed");
  const n = calls.length;
  assert.equal(await pass(ctx, NOW + 90_000), "backoff");
  assert.equal(calls.length, n, "no new call during the wait");
  assert.equal((await D.lastResult(ctx)).ok, false, "the page does not keep saying the week was posted");
  discordAnswer = () => ({ ok: true, messageId: "700000000000000001", action: "edited" });
  assert.equal(await pass(ctx, NOW + 200_000), "posted");
  assert.equal(posts().filter((c) => /Stream moved/.test(c.args.content)).length >= 1, true);
  assert.equal((await D.lastResult(ctx)).ok, true);
});

test("a refusal about the channel is not told as a wrong secret code", async () => {
  items = [slot("a", 16, 19)];
  discordAnswer = () => ({ ok: false, reason: "forbidden", scope: "channel" });
  const ctx = mk();
  await pass(ctx, Date.now());
  assert.equal((await D.lastResult(ctx)).reason, "forbidden_channel");
  const admin = JSON.stringify(await def.adminPanel(ctx));
  assert.match(admin, /refuses this channel/); assert.ok(!/secret code/.test(admin));
  const en = rd("planning", "locales/en.json"), fr = rd("planning", "locales/fr.json");
  assert.ok(en.discordReason_forbidden_channel && fr.discordReason_forbidden_channel);
});

test("titles lose direction controls and marks: no override can reorder the line", async () => {
  items = [slot("a", 16, 19, { title: "ab‮cd⁦ef‎gh‏ij؜kl" })];
  await pass(mk());
  const d = upserts()[0].args.embeds[0].description;
  assert.ok(!/[‪-‮⁦-⁩‎‏؜]/.test(d));
  assert.match(d, /ab cd ef gh ij kl/);
});
