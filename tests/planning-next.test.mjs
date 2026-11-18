// "Next stream" never shows a stream that has already started (Planning 2.8.1). A stream under way is "live" (lists keep it, with that mark) but is not "next".
// Surfaces covered: the home card, the overlay element, the "À la une" look (model.next), the MCP tool flag. Clock mocked; boundaries: -1 min, +1 min, +29 min, +31 min,
// midnight crossing, clock-change days, whole-day streams, streams without an end.
import test, { after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-14T10:00:00Z") });
after(() => mock.timers.reset());

const def = (await import("../modules/planning/index.mjs")).default;
const { notStarted, nextSlot, toSlots } = await import("../modules/planning/slots.mjs");
const overlay = await import("../modules/planning/overlay.mjs");
const { buildModel } = await import("../modules/planning/appearances/model.mjs");
const { normalizeOptions } = await import("../modules/planning/appearances/options.mjs");
const { renderAppearance } = await import("../modules/planning/appearances/registry.mjs");
const fr = JSON.parse(fs.readFileSync(new URL("../modules/planning/locales/fr.json", import.meta.url), "utf8"));
const en = JSON.parse(fs.readFileSync(new URL("../modules/planning/locales/en.json", import.meta.url), "utf8"));

const MIN = 60_000;
const START = Date.parse("2026-10-14T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const item = (id, startMs, over = {}) => ({ id, title: `T-${id}`, start: iso(startMs), end: iso(startMs + 2 * 3_600_000), ...over });
const ctxFor = (items, settings = {}) => fakeCtx({ settings: { days: 7, timezone: "UTC", ...settings }, messages: fr, locale: "fr", rawgConfigured: false, topics: { "planning.slot": () => items } });
const setNow = (ms) => mock.timers.setTime(ms);
const card = async (items, settings) => (await def.sections.next(ctxFor(items, settings), {}))[1].html;

test("pure rule: timed stream is next only while its start is later than now (-1 min, start, +1 min, +29 min, +31 min)", () => {
  const slot = { start: new Date(START), allDay: false };
  for (const [delta, expected] of [[-1, true], [0, false], [1, false], [29, false], [31, false]]) assert.equal(notStarted(slot, new Date(START + delta * MIN), "UTC"), expected, `now = start ${delta >= 0 ? "+" : ""}${delta} min`);
  assert.equal(notStarted(null, new Date()), false); assert.equal(notStarted({ start: new Date("x") }, new Date()), false); assert.equal(notStarted(slot, NaN), false);
});

test("home card: a stream under way is never the next one, whatever the minutes since its start", async () => {
  const items = [item("run", START), item("later", START + 5 * 3_600_000)];
  for (const [delta, shown] of [[-1, "run"], [1, "later"], [29, "later"], [31, "later"]]) {
    setNow(START + delta * MIN);
    const html = await card(items);
    assert.match(html, new RegExp(`T-${shown}`), `now = start ${delta} min`);
    if (shown === "later") assert.ok(!html.includes("T-run"), "the stream under way is not listed as 'also today' either");
  }
  setNow(START + MIN);
  assert.ok(!(await card(items)).includes("T-run"), "start +1 min: the running stream is gone from the card");
  { const only = await card([item("run", START)]); assert.match(only, /Pas de stream planifié/); assert.ok(!only.includes("T-run"), "only a running stream: the empty card, not the running stream"); }
  setNow(START - MIN);
  assert.ok((await card([item("run", START)])).includes("T-run"));
});

test("home card: the other streams of the day are the ones after the next one only", async () => {
  setNow(START + MIN);
  const html = await card([item("run", START), item("n1", START + 3_600_000), item("n2", START + 2 * 3_600_000)]);
  const also = /cpl-also[^>]*>([^<]*(?:<[^p][^>]*>[^<]*)*)<\/p>/.exec(html)?.[0] ?? "";
  assert.match(html, /T-n1/); assert.match(also, /T-n2/); assert.ok(!html.includes("T-run"));
});

test("stream without an end: default one-hour length, still live in lists but never next after its start", async () => {
  const noEnd = { id: "ne", title: "T-ne", start: iso(START) };
  setNow(START + 30 * MIN);
  assert.ok(!(await card([noEnd])).includes("T-ne"));
  const list = (await def.sections.upcoming(ctxFor([noEnd]), { count: 5 }))[1].html;
  assert.match(list, /T-ne/, "the generic list still shows it (under way)");
  setNow(START - MIN);
  assert.match(await card([noEnd]), /T-ne/);
});

test("midnight crossing: 23:50 local, a stream at 00:30 the next day is next until 00:30 and not a minute later", async () => {
  const s = Date.parse("2026-10-14T22:30:00Z");   // 00:30 Europe/Paris on the 15th
  const items = [item("night", s, { timezone: "Europe/Paris" })];
  setNow(Date.parse("2026-10-14T21:50:00Z"));
  assert.match(await card(items, { timezone: "Europe/Paris" }), /T-night/);
  setNow(s + MIN);
  assert.ok(!(await card(items, { timezone: "Europe/Paris" })).includes("T-night"));
});

test("clock-change days (Europe/Paris): the rule follows the real instant, not the wall clock", () => {
  const tz = "Europe/Paris";
  for (const startIso of ["2026-10-25T01:30:00Z" /* 02:30 CET, the hour that happens twice locally */, "2026-03-29T01:30:00Z" /* 03:30 CEST, right after the gap */]) {
    const slot = { start: new Date(startIso), allDay: false };
    assert.equal(notStarted(slot, new Date(Date.parse(startIso) - MIN), tz), true, `${startIso} -1 min`);
    assert.equal(notStarted(slot, new Date(Date.parse(startIso) + MIN), tz), false, `${startIso} +1 min`);
    assert.equal(notStarted(slot, new Date(Date.parse(startIso) + 31 * MIN), tz), false, `${startIso} +31 min`);
  }
  const day = toSlots([{ id: "d", title: "Day", start: "2026-10-24T22:00:00Z", end: "2026-10-25T23:00:00Z", allDay: true, day: "2026-10-25" }], tz);
  assert.equal(notStarted(day[0], new Date("2026-10-25T20:00:00Z"), tz), true, "whole day: still to come all through its own day (25 h long)");
  assert.equal(notStarted(day[0], new Date("2026-10-25T23:30:00Z"), tz), false, "the next local day: past");
  assert.equal(notStarted(day[0], new Date("2026-10-24T21:00:00Z"), tz), true, "the evening before");
});

test("nextSlot skips cancelled and started streams, never throws", () => {
  const slots = toSlots([item("a", START - 10 * MIN), item("b", START + MIN, { status: "cancelled" }), item("c", START + 10 * MIN)]);
  assert.equal(nextSlot(slots, new Date(START), "UTC").title, "T-c");
  assert.equal(nextSlot(undefined, new Date(START)), null);
});

test("overlay element 'next': the stream under way never takes the place of the next one; nothing at all when only a running stream remains", () => {
  const p = overlay.readParams("next", new URLSearchParams({ "ov-w": "1000", "ov-h": "600", "ov-lang": "fr" }));
  const ctx = ctxFor([]);
  const slots = toSlots([item("run", START), item("later", START + 3 * 3_600_000)]);
  for (const delta of [1, 29, 31]) {
    const html = overlay.renderContent(ctx, p, { slots, tz: "UTC" }, new Date(START + delta * MIN));
    assert.match(html, /T-later/, `+${delta} min`); assert.ok(!html.includes("T-run"), `+${delta} min`);
  }
  assert.match(overlay.renderContent(ctx, p, { slots, tz: "UTC" }, new Date(START - MIN)), /T-run/);
  assert.equal(overlay.renderContent(ctx, p, { slots: slots.slice(0, 1), tz: "UTC" }, new Date(START + MIN)), "", "nothing next: nothing on screen");
  const more = overlay.renderContent(ctx, { ...p, more: 1 }, { slots: toSlots([item("run", START), item("n1", START + 3_600_000), item("n2", START + 7_200_000)]), tz: "UTC" }, new Date(START + MIN));
  assert.ok(!more.includes("T-run") && /T-n1/.test(more) && /T-n2/.test(more), "the 'more' list counts upcoming streams only");
});

test("'À la une' look: the lead is the next stream; the one under way stays listed below with its live mark", () => {
  const opts = normalizeOptions((k) => (k === "appearance" ? "hero" : undefined));
  const slots = toSlots([item("run", START), item("later", START + 3 * 3_600_000)]);
  const model = buildModel({ slots, now: new Date(START + MIN), tz: "UTC", locale: "en", t: (k) => en[k] ?? k, opts, mode: "list", count: 5 });
  assert.equal(model.next.title, "T-later");
  assert.equal(model.slots.find((s) => s.title === "T-run").live, true);
  const html = renderAppearance("hero", model, { t: (k) => en[k] ?? k, locale: "en" });
  assert.ok(html.indexOf("pa-hr-title") > -1 && /pa-hr-title[^>]*>T-later/.test(html), "lead = later");
  assert.match(html, /pa-hr-row[\s\S]*T-run/, "running one in the list");
  const page = buildModel({ slots, now: new Date(START + MIN), tz: "UTC", locale: "en", t: (k) => en[k] ?? k, opts, mode: "list", count: 5, surface: "section" });
  const pageHtml = renderAppearance("hero", page, { t: (k) => en[k] ?? k, locale: "en" });
  assert.match(pageHtml, /pa-hr-title[^>]*>T-later/, "page and home section: same rule");
  const only = buildModel({ slots: slots.slice(0, 1), now: new Date(START + MIN), tz: "UTC", locale: "en", t: (k) => en[k] ?? k, opts, mode: "list", count: 5 });
  assert.equal(only.next, null); assert.equal(only.upcoming.length, 1, "the live stream is still 'upcoming' for the generic lists");
});

test("MCP planning_upcoming keeps listing the streams under way (its answer is unchanged); the caller compares start with now", async () => {
  setNow(START + MIN);
  const out = await def.mcp.planning_upcoming(ctxFor([item("run", START), item("later", START + 3 * 3_600_000)]), { days: 7 });
  assert.deepEqual(out.map((o) => o.title), ["T-run", "T-later"]);
});
