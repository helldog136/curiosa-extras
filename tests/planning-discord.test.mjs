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
const D = await import("../modules/planning/discord.mjs");
const def = planning.default;
const CHANNEL = "400000000000000001";
// A Monday noon, so that "this week" is the 15th to the 21st of June 2026.
const NOW = Date.parse("2026-06-15T10:00:00Z");
const at = (day, hour) => new Date(Date.UTC(2026, 5, day, hour)).toISOString();
const slot = (id, day, hour, extra = {}) => ({ id, title: `Soirée ${id}`, start: at(day, hour), end: at(day, hour + 2), allDay: false, status: "confirmed", timezone: "UTC", games: [], ...extra });

let calls, items, discordAnswer;
beforeEach(() => { calls = []; items = []; discordAnswer = () => ({ ok: true, messageId: "700000000000000001", action: "created" }); D.timing.settleMs = 0; });
const connector = () => ({ "discord.api": new Proxy({}, { get: (_, method) => async (args) => { calls.push({ method, args }); return discordAnswer(method, args); } }) });
const mk = (settings = {}, over = {}) => fakeCtx({ key: "pl", settings: { days: 7, timezone: "UTC", discordPost: true, discordChannel: CHANNEL, ...settings }, topics: { "planning.slot": () => items }, messages: rd("planning", "locales/en.json"), locale: "en", services: connector(), ...over });
const deps = (ctx) => ({ read: async () => ({ items, failed: false }), toSlots: planning.toSlots, displayZone: planning.displayZone, sleep: async () => {} });
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
  assert.equal(await pass(ctx, NOW + 3600_000), "same");
  assert.equal(await pass(ctx, Date.parse("2026-06-22T00:30:00Z")), "posted");
  assert.match(JSON.stringify(upserts().at(-1).args.embeds), /Soirée n/);
  assert.ok(!/Soirée a/.test(JSON.stringify(upserts().at(-1).args.embeds)));
});

test("an empty week and a cancelled stream are said in plain words", async () => {
  const ctx = mk();
  await pass(ctx);
  assert.match(upserts()[0].args.embeds[0].description, /No stream planned/);
  items = [slot("a", 16, 19, { status: "cancelled" })];
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
