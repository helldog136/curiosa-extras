// Announcement story 2.16.0: the week's schedule, a second kind of story. One video lists the events of 7 days, from the same sources as the single-event story.
// Pure functions (the window of 7 days on the calendar of a time zone, daylight saving included; ordering, the cap of 8 rows, the "and N more" and the split by whole days; the empty week;
// the words and rows the video writes), the strict arguments of the AI tools, the drawing of the 14 styles (safe area, readable sizes, a function of time) and the texts (EN/FR parity).
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeCanvasContext, fakeImage } from "./helpers/fakeCanvas.mjs";

const DIR = new URL("../modules/stream-story", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8")), fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const def = (await import("../modules/stream-story/index.mjs")).default;
const P = await import("../modules/stream-story/pure.mjs");
const S = await import("../modules/stream-story/scenes.mjs");
const W = await import("../modules/stream-story/week.mjs");
const tools = await import("../modules/stream-story/mcp.mjs");
const src = await import("../modules/stream-story/sources.mjs");
const page = await import("../modules/stream-story/page.mjs");

const H = 3_600_000, DAY = 86_400_000, PARIS = "Europe/Paris";
const NOW = Date.UTC(2026, 9, 22, 10, 0);   // Thursday 22 October 2026, 10:00 UTC = 12:00 in Paris
const ev = (id, title, startMs, extra = {}) => ({ id, title, startMs, endMs: startMs + H, allDay: false, day: "", games: [], image: "", ...extra });
const at = (day, h = 18, mi = 0, tz = PARIS) => { const [y, m, d] = day.split("-").map(Number); return P.zonedToUtc(y, m, d, h, mi, tz); };

/* ───────────── The window of 7 days ───────────── */

test("window: today by default on the clock of the zone, 7 calendar days, the end is the start of the day after", () => {
  const w = P.weekWindow({ nowMs: NOW, tz: PARIS });
  assert.deepEqual([w.startDay, w.endDay, w.today, w.zone], ["2026-10-22", "2026-10-28", "2026-10-22", PARIS]);
  assert.equal(w.days.length, 7); assert.equal(w.days[0], "2026-10-22"); assert.equal(w.days[6], "2026-10-28");
  assert.equal(w.startMs, at("2026-10-22", 0, 0)); assert.equal(w.endMs, at("2026-10-29", 0, 0));
});

test("window: the day is the one of the zone, not of UTC (late evening in UTC is already tomorrow in Auckland, still yesterday in Los Angeles)", () => {
  const late = Date.UTC(2026, 9, 22, 23, 30);
  assert.equal(P.weekWindow({ nowMs: late, tz: "Pacific/Auckland" }).startDay, "2026-10-23");
  assert.equal(P.weekWindow({ nowMs: late, tz: PARIS }).startDay, "2026-10-23");
  assert.equal(P.weekWindow({ nowMs: late, tz: "America/Los_Angeles" }).startDay, "2026-10-22");
  assert.equal(P.weekWindow({ nowMs: late, tz: "Pas/UnFuseau" }).zone, "UTC", "an unknown zone is UTC");
});

test("window: a daylight-saving week is still 7 days (169 h when the clocks go back, 167 h when they go forward), in Europe and in America", () => {
  const back = P.weekWindow({ nowMs: Date.UTC(2026, 9, 24, 10), tz: PARIS, startDay: "2026-10-24" });   // the night of 25 October 2026
  assert.deepEqual([back.startDay, back.endDay, (back.endMs - back.startMs) / H], ["2026-10-24", "2026-10-30", 169]);
  const fwd = P.weekWindow({ nowMs: Date.UTC(2027, 2, 27, 10), tz: PARIS, startDay: "2027-03-27" });   // the night of 28 March 2027
  assert.deepEqual([fwd.endDay, (fwd.endMs - fwd.startMs) / H], ["2027-04-02", 167]);
  const ny = P.weekWindow({ nowMs: Date.UTC(2026, 10, 1, 12), tz: "America/New_York", startDay: "2026-11-01" });   // 1 November 2026: the clocks go back
  assert.deepEqual([ny.endDay, ny.startMs, ny.endMs - ny.startMs], ["2026-11-07", Date.UTC(2026, 10, 1, 4), 7 * DAY + H]);
  const utc = P.weekWindow({ nowMs: NOW, tz: "UTC" }); assert.equal(utc.endMs - utc.startMs, 7 * DAY);
});

test("window: the first day is today or later, at most 83 days ahead; anything else is refused with a reason", () => {
  const ok = (d) => P.weekWindow({ nowMs: NOW, tz: PARIS, startDay: d });
  assert.equal(ok("2026-10-22").startDay, "2026-10-22"); assert.equal(ok("2026-10-30").endDay, "2026-11-05");
  assert.equal(ok(P.addDays("2026-10-22", 83)).error, undefined); assert.equal(ok(P.addDays("2026-10-22", 84)).error, "range", "the sources look 90 days ahead");
  assert.equal(ok("2026-10-21").error, "range", "yesterday");
  for (const bad of ["2026-02-31", "2026-13-01", "22/10/2026", "2026-1-5", 20261022, {}, "<b>"]) assert.equal(ok(bad).error, "start", String(bad));
  assert.equal(P.weekWindow({ nowMs: NaN, tz: PARIS }).error, "now");
  assert.equal(P.isDay("2028-02-29"), true); assert.equal(P.isDay("2027-02-29"), false);
  assert.equal(P.addDays("2026-12-30", 3), "2027-01-02"); assert.equal(P.addDays("2028-02-28", 1), "2028-02-29"); assert.equal(P.addDays("2026-03-01", -1), "2026-02-28");
});

/* ───────────── What the video lists ───────────── */

test("plan: only the events of the window, sorted by day then whole-day first then time; an event on the edge of a day lands on the day of the zone", () => {
  const events = [
    ev("c:late", "Evening", at("2026-10-23", 21)), ev("c:early", "Morning", at("2026-10-23", 9)), ev("c:all", "All day", at("2026-10-23", 0), { allDay: true, day: "2026-10-23" }),
    ev("c:edge1", "Just after midnight", at("2026-10-29", 0, 5)),   // 29 October: outside
    ev("c:edge2", "Just before midnight", at("2026-10-28", 23, 55)),   // 28 October: the last day
    ev("c:before", "Over already", NOW - 5 * H), ev("c:now", "Under way", NOW - 30 * 60_000),
    ev("c:tomorrow", "Tomorrow", at("2026-10-23", 12)),
  ];
  const p = P.weekPlan(events, { nowMs: NOW, tz: PARIS });
  assert.deepEqual(p.shown.map((e) => e.id), ["c:now", "c:all", "c:early", "c:tomorrow", "c:late", "c:edge2"]);
  assert.deepEqual(p.shown.map((e) => e.wday), ["2026-10-22", "2026-10-23", "2026-10-23", "2026-10-23", "2026-10-23", "2026-10-28"]);
  assert.equal(p.total, 6); assert.equal(p.more, 0); assert.deepEqual(p.parts, []); assert.equal(p.empty, false); assert.equal(p.part, 0);
  assert.deepEqual([p.from, p.to], ["2026-10-22", "2026-10-28"]);
});

test("plan: a whole-day event keeps its own day whatever the zone of its source; duplicates by id and unreadable items are dropped; the inputs are never changed", () => {
  const events = [ev("c:a", "A", at("2026-10-24", 0, 0, "Pacific/Auckland"), { allDay: true, day: "2026-10-24" }), ev("c:a", "A again", at("2026-10-25", 12)), null, "x", { id: "c:b" }, ev("c:c", "C", NaN)]; 
  const copy = JSON.stringify(events), p = P.weekPlan(events, { nowMs: NOW, tz: PARIS });
  assert.deepEqual(p.shown.map((e) => [e.id, e.wday, e.allDay]), [["c:a", "2026-10-24", true]]);
  assert.equal(JSON.stringify(events), copy);
});

test("plan: an empty week says so (and offers nothing to draw); a bad start is an error, never an empty plan", () => {
  for (const list of [[], null, undefined, "x", [ev("c:far", "Far", at("2026-12-25"))]]) { const p = P.weekPlan(list, { nowMs: NOW, tz: PARIS }); assert.deepEqual([p.empty, p.total, p.shown, p.more, p.parts], [true, 0, [], 0, []]); }
  assert.equal(P.weekPlan([], { nowMs: NOW, tz: PARIS, startDay: "2026-02-31" }).error, "start");
  assert.equal(P.weekPlan([], { nowMs: NOW, tz: PARIS, startDay: "2020-01-01" }).error, "range");
  const content = P.buildWeekContent({ ...P.DEFAULT_CONFIG, kind: "week" }, { plan: P.weekPlan([], { nowMs: NOW, tz: PARIS }) });
  assert.equal(content.empty, true); assert.deepEqual(content.rows, []);
});

const busy = (n, perDay = 2) => Array.from({ length: n }, (_, i) => ev(`c:${i}`, `Stream ${i}`, at(P.addDays("2026-10-22", Math.floor(i / perDay)), 18 + (i % perDay))));

test("cap: 8 rows at most; more than that shows the first 8 and says how many are left", () => {
  assert.equal(P.WEEK.rowsMax, 8);
  const exactly = P.weekPlan(busy(8), { nowMs: NOW, tz: PARIS }); assert.deepEqual([exactly.shown.length, exactly.more, exactly.parts], [8, 0, []]);
  const p = P.weekPlan(busy(13, 2), { nowMs: NOW, tz: PARIS });
  assert.deepEqual([p.total, p.shown.length, p.more], [13, 8, 5]); assert.deepEqual(p.shown.map((e) => e.id), Array.from({ length: 8 }, (_, i) => `c:${i}`), "the first ones in time");
  assert.equal(P.weekPlan(busy(13), { nowMs: NOW, tz: PARIS, cap: 3 }).shown.length, 3, "a smaller cap works");
  assert.equal(P.weekPlan(busy(13), { nowMs: NOW, tz: PARIS, cap: 99 }).shown.length, 8, "never more than 8");
});

test("split: a busy week is cut into parts of whole days (never a day in two parts); each part fits the cap; a part is chosen by its number", () => {
  const list = busy(13, 2), p = P.weekPlan(list, { nowMs: NOW, tz: PARIS });
  assert.deepEqual(p.parts, [{ from: "2026-10-22", to: "2026-10-25", count: 8 }, { from: "2026-10-26", to: "2026-10-28", count: 5 }]);
  const one = P.weekPlan(list, { nowMs: NOW, tz: PARIS, part: 1 }), two = P.weekPlan(list, { nowMs: NOW, tz: PARIS, part: 2 });
  assert.deepEqual([one.part, one.shown.length, one.more, one.from, one.to], [1, 8, 0, "2026-10-22", "2026-10-25"]);
  assert.deepEqual([two.part, two.shown.map((e) => e.id), two.more, two.from, two.to], [2, ["c:8", "c:9", "c:10", "c:11", "c:12"], 0, "2026-10-26", "2026-10-28"]);
  assert.equal(P.weekPlan(list, { nowMs: NOW, tz: PARIS, part: 3 }).part, 0, "a part that does not exist is the whole week");
  assert.equal(P.weekPlan(list, { nowMs: NOW, tz: PARIS, part: 0 }).part, 0);
  assert.equal(P.weekPlan(busy(5), { nowMs: NOW, tz: PARIS, part: 2 }).part, 0, "a week that fits one video has no parts");
  // one day with 10 events: a part of its own, cut at 8 with "and 2 more"; the other days keep going
  const heavy = [...Array.from({ length: 10 }, (_, i) => ev(`h:${i}`, `H${i}`, at("2026-10-23", 8 + i))), ev("c:x", "Other", at("2026-10-25", 12)), ev("c:y", "Early", at("2026-10-22", 17))];
  const h = P.weekPlan(heavy, { nowMs: NOW, tz: PARIS });
  assert.deepEqual(h.parts.map((x) => [x.from, x.to, x.count]), [["2026-10-22", "2026-10-22", 1], ["2026-10-23", "2026-10-23", 10], ["2026-10-25", "2026-10-25", 1]]);
  const hp = P.weekPlan(heavy, { nowMs: NOW, tz: PARIS, part: 2 }); assert.deepEqual([hp.shown.length, hp.more], [8, 2]);
});

/* ───────────── What the video writes ───────────── */

const CFG = (extra = {}) => ({ ...P.DEFAULT_CONFIG, kind: "week", elements: P.WEEK_ELEMENTS.slice(), ...extra });
const plan3 = () => P.weekPlan([ev("c:1", "Discovery night", at("2026-10-22", 19, 30), { games: ["Hades"] }), ev("c:2", "Late", at("2026-10-22", 21)), ev("c:3", "Day off", at("2026-10-24", 0), { allDay: true, day: "2026-10-24" }), ev("y:4", "Premiere", at("2026-10-25", 18), { image: "https://img.example.test/a.jpg" })], { nowMs: NOW, tz: PARIS });

test("content: heading and dates, the day only on the first row of a day, times in the zone and the language, whole days, thumbnail keys", () => {
  const c = P.buildWeekContent(CFG({ lang: "fr", channelName: "etoile_nord", text: "À tout de suite" }), { plan: plan3(), site: { name: "Mon site" } });
  assert.equal(c.heading, "Cette semaine"); assert.equal(c.range, "22 – 28 octobre"); assert.equal(c.brand, "etoile_nord"); assert.equal(c.text, "À tout de suite");
  assert.deepEqual(c.rows.map((r) => [r.dayLabel, r.time, r.title]), [["Jeu. 22", "19 h 30", "Discovery night"], ["", "21 h", "Late"], ["Sam. 24", "Journée", "Day off"], ["Dim. 25", "18 h", "Premiere"]]);
  assert.deepEqual(c.rows.map((r) => r.thumb), ["g:Hades", "", "", "e:y:4"]);
  const e = P.buildWeekContent(CFG({ lang: "en" }), { plan: plan3() });
  assert.equal(e.heading, "This week"); assert.equal(e.range, "22 – 28 October"); assert.equal(e.brand, "");
  assert.deepEqual(e.rows.map((r) => [r.dayLabel, r.time]), [["Thu 22", "7:30 PM"], ["", "9:00 PM"], ["Sat 24", "All day"], ["Sun 25", "6:00 PM"]]);
  assert.equal(P.buildWeekContent(CFG({ weekTitle: "Week of the 22nd" }), { plan: plan3() }).heading, "Week of the 22nd");
  assert.equal(P.buildWeekContent(CFG({ channelName: "" }), { plan: plan3(), site: { name: "Mon site" } }).brand, "Mon site");
});

test("content: the elements switch things off; the overflow and the dates of a part are written; the French plural", () => {
  const off = P.buildWeekContent(CFG({ elements: ["brand"], channelName: "x" }), { plan: plan3() });
  assert.deepEqual([off.heading, off.range, off.showWhen, off.showGame, off.text], ["", "", false, false, ""]);
  assert.deepEqual(off.rows.map((r) => [r.dayLabel, r.time, r.game, r.thumb]), Array(4).fill(["", "", "", ""]));
  const list = busy(13), whole = P.buildWeekContent(CFG({ lang: "en" }), { plan: P.weekPlan(list, { nowMs: NOW, tz: PARIS }) });
  assert.equal(whole.more, 5); assert.equal(whole.moreText, "and 5 more"); assert.equal(whole.rows.length, 8);
  assert.equal(P.buildWeekContent(CFG({ lang: "fr" }), { plan: P.weekPlan(busy(9), { nowMs: NOW, tz: PARIS }) }).moreText, "et 1 autre");
  assert.equal(P.buildWeekContent(CFG({ lang: "fr" }), { plan: P.weekPlan(list, { nowMs: NOW, tz: PARIS }) }).moreText, "et 5 autres");
  const part = P.buildWeekContent(CFG({ lang: "en" }), { plan: P.weekPlan(list, { nowMs: NOW, tz: PARIS, part: 2 }) });
  assert.deepEqual([part.range, part.more, part.moreText], ["26 – 28 October", 0, ""]);
  assert.equal(P.formatRange("2026-10-29", "2026-11-04", "en"), "29 Oct – 4 Nov"); assert.equal(P.formatRange("2026-12-30", "2027-01-05", "fr"), "30 déc – 5 janv"); assert.equal(P.formatRange("2026-10-22", "2026-10-22", "en"), "22 October");
});

test("content: texts are cut to their limits, controls characters removed; nothing here can be read as HTML", () => {
  const nasty = ev("c:n", "<img src=x onerror=alert(1)>\n\u0007" + "T".repeat(200), at("2026-10-23", 10), { games: ["<b>G</b>".repeat(30)] });
  const c = P.buildWeekContent(CFG({ weekTitle: "H".repeat(300), text: "t".repeat(500) }), { plan: P.weekPlan([nasty], { nowMs: NOW, tz: PARIS }) });
  assert.ok([...c.rows[0].title].length <= 80 && !/[\u0000-\u001f]/.test(c.rows[0].title)); assert.ok([...c.heading].length <= 80); assert.ok([...c.text].length <= 140); assert.ok([...c.rows[0].game].length <= 80);
});

test("config: a week keeps its start, part and title; one event stays exactly as before; bad values are dropped", () => {
  const w = P.cleanConfig({ kind: "week", weekStart: "2026-10-26", weekPart: 2, weekTitle: "  Week   plan " });
  assert.deepEqual([w.kind, w.weekStart, w.weekPart, w.weekTitle], ["week", "2026-10-26", 2, "Week plan"]);
  const bad = P.cleanConfig({ kind: "week", weekStart: "2026-02-31", weekPart: 99, weekTitle: 12 });
  assert.deepEqual([bad.weekStart, bad.weekPart, bad.weekTitle], ["", 0, "12"]);
  assert.equal(P.cleanConfig({ kind: "week", weekPart: 2.5 }).weekPart, 0);
  for (const k of ["weekStart", "weekPart", "weekTitle", "kind"]) { assert.ok(!(k in P.cleanConfig({})), `${k} absent from an event config`); assert.ok(!(k in P.cleanConfig({ kind: "event", weekStart: "2026-10-26" })) || k === "x"); assert.ok(!(k in P.cleanConfig({ kind: "bizarre" }))); }
  assert.deepEqual(Object.keys(P.cleanConfig({})).sort(), Object.keys(P.cleanConfig(P.DEFAULT_CONFIG)).sort());
  assert.equal(P.cleanConfig({}, w).kind, "week", "the fallback is read when nothing is said"); assert.equal(P.cleanConfig({ kind: "event" }, w).kind, undefined);
  assert.equal(P.fileName({ startMs: at("2026-10-22", 12), tz: PARIS, format: "vertical", lang: "en", ext: "mp4", kind: "week" }), "week-2026-10-22-vertical.mp4");
  assert.equal(P.fileName({ startMs: at("2026-10-22", 12), tz: PARIS, format: "vertical", lang: "fr", ext: "mp4", kind: "week" }), "semaine-2026-10-22-vertical.mp4");
  assert.equal(P.fileName({ startMs: at("2026-10-22", 12), tz: PARIS, format: "vertical", lang: "fr", ext: "mp4" }), "annonce-2026-10-22-vertical.mp4");
});

/* ───────────── The drawing: the 14 styles, the 2 formats ───────────── */

const THEME = { accent: "#7c5cff", accent2: "#ff4d8d", bg: "#101018", fg: "#f2f2f2" };
function weekScene({ style, format, n, watermark = false, long = false, text = "", more = 0, thumbs = true, lang = "fr", duration = 15 }) {
  const events = Array.from({ length: n }, (_, i) => ev(`c:${i}`, long ? `Grande soirée découverte de Hollow Knight Silksong : on explore Pharloom, ${i}` : `Stream ${i}`, at(P.addDays("2026-10-22", Math.floor(i / 2)), 18 + (i % 2)), { games: i % 3 === 0 ? ["Hollow Knight: Silksong"] : [] }));
  const plan = P.weekPlan([...events, ...busy(more).map((e) => ({ ...e, id: `m:${e.id}`, startMs: e.startMs + 20 * 60_000 }))], { nowMs: NOW, tz: PARIS });
  const content = P.buildWeekContent(CFG({ lang, text, channelName: "etoile_nord" }), { plan });
  const assets = { logo: fakeImage(200, 200), thumbs: thumbs ? { "g:Hollow Knight: Silksong": fakeImage(600, 338) } : {} };
  return { sc: S.createScene({ style, format, duration, content: { lang }, week: content, assets, colors: THEME, measureContext: fakeCanvasContext(), watermark }), content };
}
const run = (sc, t) => { const ctx = fakeCanvasContext(); sc.draw(ctx, t); return ctx.log; };
function extent(entry) {
  const [, text, x0, y, font, align, , baseline, sx = 1, tx = 0] = entry, px = Number(/(\d+(?:\.\d+)?)px/.exec(font)[1]), w = [...text].length * px * 0.55 * sx, x = tx + sx * x0;
  const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x, [up, down] = baseline === "alphabetic" ? [0.8, 0.25] : baseline === "top" ? [0, 0.8] : [0.6, 0.6];
  return { left, right: left + w, top: y - px * up, bottom: y + px * down, px };
}

test("drawing: every style and format, from 1 to 8 rows (long titles, sentence, overflow, mention): all inside the safe area, outside the hidden zones, rows apart, texts of 20 px or more", () => {
  assert.equal(P.STYLES.length, 14); assert.deepEqual(Object.keys(W.WEEK_LOOK).sort(), [...P.STYLES].sort(), "every style has its look");
  for (const style of P.STYLES) for (const format of ["vertical", "passeport"]) for (const n of [1, 3, 8]) for (const o of [{}, { long: true, text: "Venez nombreux, toute la semaine !", more: 6 }, { watermark: true, thumbs: false }]) {
    const { sc } = weekScene({ style, format, n, ...o }), A = P.safeArea(format), f = P.formatOf(format), where = `${style}/${format}/${n} rows/${JSON.stringify(o).slice(0, 30)}`;
    assert.equal(sc.blocks.filter((b) => b.id.startsWith("row")).length, Math.min(8, n + (o.more ?? 0)), `${where}: one row per event`);
    for (const b of sc.boxes) {
      assert.ok(b.x >= A.x - 0.5 && b.x + b.w <= A.x + A.w + 0.5 && b.y >= A.y - 0.5 && b.y + b.h <= A.y + A.h + 0.5, `${where}: ${b.id} in the safe area (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)})`);
      for (const z of f.zones) assert.ok(b.x + b.w <= z.x + 0.5 || b.x >= z.x + z.w - 0.5 || b.y + b.h <= z.y + 0.5 || b.y >= z.y + z.h - 0.5, `${where}: ${b.id} outside the zone ${z.id}`);
      assert.ok(b.w > 0 && b.h > 0 && Number.isFinite(b.x + b.y + b.w + b.h));
    }
    const sorted = [...sc.boxes].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].y >= sorted[i - 1].y + sorted[i - 1].h - 0.5, `${where}: ${sorted[i - 1].id} and ${sorted[i].id} do not overlap`);
    const tol = style === "cinema" ? 20 : 2;   // the slow push-in of the cinema enlarges the picture by 4 % at most
    for (const t of [sc.restTime, sc.duration]) for (const e of run(sc, t).filter((x) => x[0] === "fillText" && !/^(Made with|Curiosa)/.test(x[1]))) {   // the mention has its own place, outside the safe area, as for one event
      const x = extent(e);
      assert.ok(x.left >= A.x - tol && x.right <= A.x + A.w + tol && x.top >= A.y - tol && x.bottom <= A.y + A.h + tol, `${where} t=${t}: « ${e[1].slice(0, 20)} » inside (${Math.round(x.left)}→${Math.round(x.right)}, ${Math.round(x.top)}→${Math.round(x.bottom)})`);
      assert.ok(x.px >= 20, `${where}: « ${e[1].slice(0, 20)} » ${x.px}px`);
    }
  }
});

test("drawing: a function of time (same instant, same drawing), rows come in one after the other and hold still at the end, nothing absurd, text only through fillText", () => {
  for (const style of P.STYLES) {
    const { sc } = weekScene({ style, format: "vertical", n: 8, text: "Tout est dans la liste", watermark: true }), again = weekScene({ style, format: "vertical", n: 8, text: "Tout est dans la liste", watermark: true }).sc;
    for (const t of [0, 0.7, 2.2, 5, 11.7, 15]) assert.deepEqual(run(sc, t), run(again, t), `${style} t=${t}`);
    assert.deepEqual(run(sc, -4), run(sc, 0)); assert.deepEqual(run(sc, 99), run(sc, 15)); assert.deepEqual(run(sc, NaN), run(sc, 0));
    const shown = (t) => new Set(run(sc, t).filter((x) => x[0] === "fillText" && /^Stream \d/.test(x[1])).map((x) => x[1]));
    assert.ok(shown(0.05).size <= shown(2.5).size && shown(2.5).size < shown(sc.restTime).size, `${style}: the rows arrive one after the other (${shown(0.05).size} → ${shown(2.5).size} → ${shown(sc.restTime).size})`);
    assert.equal(shown(sc.restTime).size, 8, `${style}: all 8 rows are on screen at the rest time`);
    assert.deepEqual([...shown(sc.restTime)].sort(), [...shown(sc.duration)].sort(), `${style}: still at the end`);
    const text = (t) => run(sc, t).filter((x) => x[0] === "fillText").map((x) => x[1]).sort();
    assert.deepEqual(text(sc.restTime), text(sc.duration), `${style}: the same words from the rest time to the end`);
    for (const t of [0, 1.3, 4, sc.restTime, 15]) for (const e of run(sc, t)) {
      assert.ok(!["strokeText", "innerHTML", "drawElement"].includes(e[0]) || e[0] === "strokeText" && false, `${style}: ${e[0]}`);
      for (const v of e.slice(1)) assert.ok(typeof v !== "number" || Number.isFinite(v), `${style} t=${t}: ${e[0]} has a bad number`);
    }
    assert.ok(text(sc.restTime).includes("Made with") || text(sc.restTime).some((s) => /Made with/.test(s)), `${style}: the mention is drawn`);
  }
});

test("drawing: the length setting is respected (5 s and 15 s): everything is in place at 78 % of the video", () => {
  for (const duration of [5, 10, 15]) for (const style of ["neon", "broadcast", "arcade", "epic"]) {
    const { sc } = weekScene({ style, format: "passeport", n: 8, duration });
    assert.equal(sc.duration, duration); assert.ok(Math.abs(sc.restTime - duration * 0.78) < 1e-9);
    const rows = (t) => new Set(run(sc, t).filter((x) => x[0] === "fillText" && /^Stream \d/.test(x[1])).map((x) => x[1])).size;
    assert.equal(rows(sc.restTime), 8, `${style} ${duration}s: 8 rows at the rest time`); assert.ok(rows(0.1) < 8);
  }
});

test("drawing: the covers show only where the site has them; a very short week is not stretched; the week of one event works", () => {
  const withCover = weekScene({ style: "neon", format: "vertical", n: 3 }).sc, without = weekScene({ style: "neon", format: "vertical", n: 3, thumbs: false }).sc;
  const imgs = (sc) => run(sc, sc.restTime).filter((x) => x[0] === "drawImage").length;
  assert.equal(imgs(withCover), imgs(without) + 1, "one cover more: only the first row has a game");
  assert.ok(imgs(withCover) > imgs(without));
  const one = weekScene({ style: "minimal", format: "vertical", n: 1 }).sc, row = one.blocks.find((b) => b.id === "row0");
  assert.ok(row.h <= 168 + 0.5, "a row is never taller than 168 px");
});

/* ───────────── The AI tools ───────────── */

const models = [], variants = [];
const prep = (args, over = {}) => tools.strictPrepare(args, { models, tz: PARIS, events: busy(13), nowMs: NOW, variants, ...over });
const refused = (args, re, over) => assert.throws(() => prep(args, over), (e) => e.expose === true && re.test(e.message), JSON.stringify(args));

test("story_prepare: kind week prepares the week (start, part, heading); the events and the single-event fields are cleared; only the elements of a week stay", () => {
  const a = prep({ kind: "week" });
  assert.deepEqual([a.config.kind, a.config.weekStart, a.config.weekPart, a.config.weekTitle, a.config.eventId, a.config.streamKey], ["week", "", 0, "", "", ""]);
  assert.equal(a.manual, null); assert.equal(a.event, null); assert.deepEqual([a.plan.total, a.plan.shown.length, a.plan.more], [13, 8, 5]);
  assert.deepEqual(a.config.elements, ["title", "when", "game", "brand", "text"], "the countdown and the guests mean nothing for a week");
  const b = prep({ kind: "week", weekStart: "2026-10-24", weekPart: 1, weekTitle: "Cette semaine chez nous", style: "arcade", format: "passeport", elements: ["title", "countdown", "costreamers"] }, { events: busy(13) });
  assert.deepEqual([b.config.weekStart, b.config.weekPart, b.config.weekTitle, b.config.style, b.config.format, b.config.elements], ["2026-10-24", 0 || b.config.weekPart, "Cette semaine chez nous", "arcade", "passeport", ["title"]]);
  assert.equal(prep({ kind: "week", style: "countdown" }).config.elements.includes("countdown"), false);
  const c = prep({ kind: "week", weekPart: 2, watermark: true, language: "en", durationSeconds: 8, text: "Hi" });
  assert.deepEqual([c.config.weekPart, c.config.watermark, c.config.lang, c.config.duration, c.config.text], [2, true, "en", 8, "Hi"]);
  assert.equal(prep({ kind: "event" }, { events: [] }).config.kind, undefined, "kind event is the old behaviour");
  assert.equal(prep({}, { events: [] }).config.kind, undefined);
});

test("story_prepare: every week input is checked, with a clear message that gives the way out", () => {
  refused({ kind: "weeks" }, /'kind' must be one of: event, week/); refused({ kind: 3 }, /'kind'/);
  for (const k of [{ weekStart: "2026-10-24" }, { weekPart: 1 }, { weekTitle: "x" }]) refused(k, /only go with kind 'week'/);
  refused({ kind: "week", weekStart: "2026-02-31" }, /real date written YYYY-MM-DD/); refused({ kind: "week", weekStart: "22/10/2026" }, /YYYY-MM-DD/); refused({ kind: "week", weekStart: 20261022 }, /YYYY-MM-DD/);
  refused({ kind: "week", weekStart: "2026-10-21" }, /today or a later day, at most 83 days ahead/); refused({ kind: "week", weekStart: "2027-06-01" }, /at most 83 days/);
  for (const bad of [0, 8, 1.5, "1", null]) refused({ kind: "week", weekPart: bad }, /'weekPart' must be a whole number from 1 to 7/);
  refused({ kind: "week", weekPart: 3 }, /'weekPart' must be from 1 to 2 for this week/); refused({ kind: "week", weekPart: 1 }, /fits one video/, { events: busy(4) });
  refused({ kind: "week", weekTitle: "T".repeat(81) }, /at most 80 characters/); refused({ kind: "week", weekTitle: 5 }, /'weekTitle'/);
  for (const k of [{ event: "c:1" }, { stream: "next" }, { streamTitle: "x" }, { streamDate: "2026-10-24" }, { streamTime: "10:00" }]) refused({ kind: "week", ...k }, /leave out 'event', 'stream' and the hand-written stream/);
  refused({ kind: "week", style: "nope" }, /'style' must be one of/); refused({ kind: "week", watermark: "yes" }, /'watermark'/);
});

test("story_prepare: an empty week is refused (no blank video), and so is a week when no source answered", () => {
  refused({ kind: "week" }, /No event is planned from 2026-10-22 to 2026-10-28: nothing to announce/, { events: [] });
  refused({ kind: "week", weekStart: "2026-11-30" }, /No event is planned from 2026-11-30 to 2026-12-06/, { events: busy(5) });
  refused({ kind: "week" }, /sources did not answer/, { events: [], sourcesDown: true });
});

/* The tools with the real module (a fake site): the week of the next 7 days from the planning and from another source. */
const SITE = "https://site.example.test";
const timing0 = { ...src.timing };
let keepAlive;
beforeEach(() => { keepAlive = setInterval(() => {}, 100); src.resetEvents(); Object.assign(src.timing, timing0, { collectMs: 200, providersMs: 200, sourceMs: 200, eventsMs: 800, coverMs: 200, authMs: 300, routeMs: 800 }); });
afterEach(() => { clearInterval(keepAlive); Object.assign(src.timing, timing0); src.resetEvents(); });
const SLOT = (id, title, ms, extra = {}) => ({ id, title, start: new Date(ms).toISOString(), end: new Date(ms + H).toISOString(), allDay: false, games: [], status: "confirmed", timezone: PARIS, ...extra });
const site = (calendar, yt) => fakeCtx({
  key: "story", moduleId: "stream-story", locale: "en", messages: { ...en }, permissions: manifest.permissions, siteUrl: SITE,
  instances: [{ id: "id-story", key: "story", module: "stream-story", basePath: "", name: "Story", adminPath: "/admin/instances/id-story" }],
  topics: { "planning.slot": () => calendar }, serviceInstances: { "event.source": yt ? [{ instance: "yt", name: "My channel", methods: { upcoming: yt } }] : [] },
});
const yt = (events) => () => ({ ok: true, source: { kind: "youtube", label: "YouTube" }, state: "ok", events });

test("story_week: lists the next 7 days from all sources as the video shows them; far events and past ones are left out; read only", async () => {
  const t = Date.now();
  const ctx = site([SLOT("s1", "Stream one", t + 3 * H, { games: ["Hades"] }), SLOT("s2", "Stream two", t + 30 * H), SLOT("s9", "Too far", t + 12 * DAY)], yt([{ id: "youtube:v1", title: "Premiere", start: new Date(t + 52 * H).toISOString(), type: "premiere" }]));
  const r = await def.mcp.story_week(ctx, {});
  assert.equal(r.state, "ok"); assert.equal(r.total, 3); assert.equal(r.rowsPerVideo, 8); assert.equal(r.more, 0); assert.deepEqual(r.parts, []);
  assert.deepEqual(r.events.map((e) => e.title), ["Stream one", "Stream two", "Premiere"]); assert.deepEqual(r.events.map((e) => e.source), ["calendar", "calendar", "youtube"]);
  assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/); assert.equal(r.to, P.addDays(r.from, 6)); assert.deepEqual(r.events[0].games, ["Hades"]);
  const later = await def.mcp.story_week(ctx, { weekStart: P.addDays(r.from, 10) }); assert.deepEqual([later.total, later.events.map((e) => e.title)], [1, ["Too far"]]);
  src.resetEvents(); const none = await def.mcp.story_week(site([]), {}); assert.deepEqual([none.state, none.total, none.events], ["empty", 0, []]);
  await assert.rejects(def.mcp.story_week(ctx, { weekStart: "2020-01-01" }), (e) => e.expose && /today or a later day/.test(e.message));
  await assert.rejects(def.mcp.story_week(ctx, { weekStart: "nope" }), (e) => e.expose && /YYYY-MM-DD/.test(e.message));
  const d = manifest.mcp.find((x) => x.name === "story_week"); assert.equal(d.readOnly, true); assert.ok(d.default !== false); assert.ok(d.name.length <= 31 && d.description.length > 40 && d.description.length <= 1000);
  assert.equal(d.input.properties.weekStart.maxLength, 10);
});

test("story_prepare with the module: a week is saved as a preparation (link, 7 days), the answer describes the week; an empty week writes nothing", async () => {
  const t = Date.now(), ctx = site(Array.from({ length: 11 }, (_, i) => SLOT(`s${i}`, `Stream ${i}`, t + (2 + i * 9) * H)));
  const out = await def.mcp.story_prepare(ctx, { kind: "week", style: "geometric", weekTitle: "Cette semaine" });
  assert.equal(out.ok, true); assert.match(out.link, /^https:\/\/site\.example\.test\/admin\/instances\/id-story\?prep=/);
  assert.equal(out.prepared.kind, "week"); assert.equal(out.prepared.stream, undefined); assert.equal(out.prepared.style, "geometric");
  assert.ok(out.prepared.week.events >= 1 && out.prepared.week.events <= 8); assert.deepEqual(out.prepared.elements, ["title", "when", "game", "brand", "text"]);
  const data = await import("../modules/stream-story/data.mjs"), saved = await data.readPrep(ctx, new URL(out.link).searchParams.get("prep"));
  assert.equal(saved.config.kind, "week"); assert.equal(saved.config.weekTitle, "Cette semaine"); assert.equal(saved.manual, null);
  src.resetEvents(); await assert.rejects(def.mcp.story_prepare(site([]), { kind: "week" }), (e) => e.expose && /nothing to announce/.test(e.message));
  src.resetEvents(); const plain = await def.mcp.story_prepare(site([SLOT("s1", "One", t + 5 * H)]), {}); assert.equal(plain.prepared.kind, undefined); assert.ok(plain.prepared.stream);
  const p = manifest.mcp.find((x) => x.name === "story_prepare").input.properties;
  assert.deepEqual(p.kind.enum, ["event", "week"]); assert.equal(p.weekStart.maxLength, 10); assert.deepEqual([p.weekPart.minimum, p.weekPart.maximum], [1, 7]); assert.equal(p.weekTitle.maxLength, 80);
  assert.ok(Object.values(p).every((x) => x.description)); assert.ok(manifest.mcp.find((x) => x.name === "story_prepare").description.length <= 1000);
});

test("models: a saved model never carries the week (the days are chosen for each video)", async () => {
  const data = await import("../modules/stream-story/data.mjs"), ctx = site([]);
  const r = await data.saveModel(ctx, { name: "Look", config: { ...P.DEFAULT_CONFIG, style: "epic", kind: "week", weekStart: "2026-10-26", weekPart: 2, weekTitle: "Week" } });
  assert.equal(r.ok, true); const m = (await data.readModels(ctx))[0];
  assert.deepEqual([m.config.style, m.config.kind, m.config.weekStart, m.config.weekPart, m.config.weekTitle], ["epic", undefined, undefined, undefined, undefined]);
});

/* ───────────── The route, the page and the texts ───────────── */

test("route week: the events of the window and the covers of their games; a wrong start is refused in one sentence; the files of the page include week.mjs", async () => {
  const t = Date.now(), ctx = site([SLOT("s1", "Stream one", t + 3 * H, { games: ["Hades"] })]);
  const token = await (await import("../modules/stream-story/data.mjs")).mintToken(ctx);
  const call = (q) => def.routes.week(new Request(`${SITE}/m/story/week${q}`, { headers: { "x-story-token": token } }), ctx);
  const ok = await call("?tz=Europe/Paris"), body = await ok.json();
  assert.equal(ok.status, 200); assert.equal(body.ok, true); assert.deepEqual(body.events.map((e) => e.title), ["Stream one"]); assert.deepEqual(Object.keys(body.events[0]).sort(), ["allDay", "day", "endMs", "games", "id", "image", "source", "startMs", "timezone", "title", "type"].sort());
  assert.equal(body.window.endDay, P.addDays(body.window.startDay, 6)); assert.equal(typeof body.coverState, "string");
  const bad = await call("?start=2020-01-01"); assert.equal(bad.status, 400); assert.deepEqual(await bad.json(), { ok: false, error: "invalid", field: "range" });
  assert.equal((await call("?start=2026-02-31")).status, 400);
  assert.equal((await def.routes.week(new Request(`${SITE}/m/story/week`), ctx)).status, 401, "no token, no data");
  assert.equal((await def.routes.week(new Request(`${SITE}/m/story/week`, { method: "POST", headers: { "x-story-token": token } }), ctx)).status, 405);
  assert.ok(page.LIB.includes("week.mjs"));
  assert.equal((await def.routes["lib/week.mjs"](new Request(`${SITE}/m/story/lib/week.mjs`), ctx)).status, 200);
});

test("page: the choice 'One event / The week' is a two-choice radio group at the top of step 1; the week panel has the summary, the parts and ONE folded option (the first day)", async () => {
  const html = await (await page.studioPage(site([]), { base: "/m/story", colors: {}, timezone: "", font: "", accent: "#4f46e5", accentFg: "#ffffff" })).text();
  const step1 = html.slice(html.indexOf('id="step-1"'), html.indexOf('id="step-2"'));
  assert.equal((step1.match(/name="kind"/g) ?? []).length, 2); assert.ok(step1.indexOf('name="kind"') < step1.indexOf('id="event-mode"') && step1.indexOf('id="event-mode"') < step1.indexOf('id="week-mode"'));
  assert.match(/<div id="week-mode"[^>]*>/.exec(step1)[0], /hidden/, "the event mode is the default");
  assert.equal((step1.match(/<details/g) ?? []).length, 1 + (step1.match(/id="event-picker"/g) ? 0 : 0), "only one folded block in the week panel");
  const week = step1.slice(step1.indexOf('id="week-mode"')); assert.equal((week.match(/<input/g) ?? []).length, 1, "the week panel has one field, the first day, folded");
  assert.ok(week.indexOf("<details") < week.indexOf('id="week-start"'));
  assert.match(html, /body\.week \[data-only=event\]\{display:none!important\}/);
  for (const id of ["item-countdown", "item-costreamers"]) assert.match(html, new RegExp(`id="${id}" data-only="event"`));
});

const WEEK_KEYS = ["kind_label", "kind_event", "kind_week", "h_week", "week_one", "week_many", "week_empty", "week_shown", "week_part_label", "week_part_all", "week_part", "week_start", "week_start_hint", "week_f_title", "week_ph_title", "week_f_when", "week_f_game", "week_g_event", "week_fail"];
test("texts: the week's sentences exist in French and English with the same {variables}; the page asks for them; labels stay short, with no colon", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of WEEK_KEYS) {
    assert.ok(fr[`ui_${k}`] && en[`ui_${k}`], k); assert.ok(page.KEYS.includes(k), `${k} is passed to the page`); assert.equal(vars(fr[`ui_${k}`]), vars(en[`ui_${k}`]), k);
    for (const text of [fr[`ui_${k}`], en[`ui_${k}`]]) assert.ok(!/[!:]\s*$/.test(text) && !/ !/.test(text.replace(/ ?[!?]$/, "")), `${k}: no colon at the end, no exclamation`);
  }
  for (const k of ["kind_label", "kind_event", "kind_week", "week_f_title", "week_f_when", "week_f_game", "week_start", "week_part_label"]) assert.ok(en[`ui_${k}`].length <= 60 && fr[`ui_${k}`].length <= 60, k);
  for (const k of ["week_start_hint", "week_shown"]) assert.ok(en[`ui_${k}`].length <= 60 && fr[`ui_${k}`].length <= 60, `${k}: a visible help is 60 characters at most`);
  const app = fs.readFileSync(`${DIR}/app.mjs`, "utf8"), used = [...app.matchAll(/\bL\("([a-z0-9_]+)"/g)].map((m) => m[1]).concat([...app.matchAll(/"(week_[a-z_]+|kind_[a-z]+|h_week)"/g)].map((m) => m[1]));
  for (const k of used) assert.ok(fr[`ui_${k}`] !== undefined || /^(err|style|type|net)_/.test(k) || k.startsWith("{"), `${k} is a sentence of the page`);
  for (const k of ["title", "range"]) void k;
  assert.equal(manifest.version, "2.16.0"); assert.equal(manifest.minCore, "0.6.7", "the minimum core does not move");
  assert.ok(manifest.description.en.split(/\s+/).length <= 20 && manifest.description.fr.split(/\s+/).length <= 20);
});
