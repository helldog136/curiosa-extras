// Stream goals 1.1.0: the goal bar and the subathon countdown. The pure rules first (dedup, rebase, subathon arithmetic), then the module with a fake
// context (sources, concurrency, reload), then the engine of the core drawing the states frame by frame (the same engine OBS runs, from its page text).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, "..");
const DIR = path.join(ROOT, "modules/stream-goals");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(DIR, p), "utf8"));
const manifest = readJson("module.json");
const en = readJson("locales/en.json"), fr = readJson("locales/fr.json");
const M = await import("../modules/stream-goals/model.mjs");
const S = await import("../modules/stream-goals/store.mjs");
const P = await import("../modules/stream-goals/page.mjs");
const def = (await import("../modules/stream-goals/index.mjs")).default;
after(() => S.resetMemory());

const T0 = Date.UTC(2026, 10, 18, 20, 0, 0);
const iso = (ms) => new Date(ms).toISOString();
let seq = 0;
const item = (type, at, o = {}) => ({ id: o.id ?? `msg-${++seq}`, type, at: iso(at), ...o });
const follow = (login, at, o) => item("follow", at, { login, ...o });
const sub = (login, at, o) => item("sub", at, { login, tier: "1", ...o });

/** A start written in UTC (the site zone of `world({ timezone: "UTC" })`), `minutes` from the real clock. */
const startIn = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString().slice(0, 16);
function world({ settings = {}, events = [], stats = null, providers = ["alerts.queue", "twitch.live"], key = `sg${++seq}`, timezone = "Europe/Brussels" } = {}) {
  const box = { events, stats };
  const ctx = fakeCtx({
    moduleId: "stream-goals", key, permissions: manifest.permissions, messages: en, timezone,
    settings: { goalMetric: "followers", subathonLength: 3600, secondsPerSub: 300, secondsPerHundredBits: 60, secondsPerFollow: 0, subathonCap: 0, ...settings },
    topics: { "twitch.event": () => box.events.slice().reverse(), "social.stat": () => (box.stats ? [box.stats] : []) },
    serviceInstances: Object.fromEntries(providers.map((p) => [p, [{ instance: "x", methods: {} }]])),
    requires: manifest.requires,
  });
  return { ctx, box };
}
const stat = (metric, value, asOf) => ({ id: `twitch-channel:c:${metric}`, platform: "twitch", account: "camille", accountKey: "c", metric, label: metric, value, asOf: iso(asOf) });

/* ───────────── Manifest, words ───────────── */
test("manifest: valid for the core, optional sources only, two animated elements with the engine's two options, write tools off, FR/EN parity", () => {
  const r = parseManifest(manifest);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.minCore, "0.30.0");
  assert.ok(manifest.requires.every((x) => x.optional === true), "nothing is required: it installs and works without Twitch");
  assert.deepEqual(manifest.overlayElements.map((e) => e.id), ["goal", "subathon"]);
  for (const e of manifest.overlayElements) assert.deepEqual(e.options.map((o) => o.id), ["animQuality", "animCalm"]);
  const tools = Object.fromEntries(manifest.mcp.map((t) => [t.name, t]));
  for (const n of ["goal_get", "subathon_get"]) assert.equal(tools[n].readOnly, true);
  for (const n of ["goal_set", "goal_test", "subathon_add_time", "subathon_pause"]) assert.equal(tools[n].default, false, `${n} is off until the owner switches it on`);
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  for (const k of Object.keys(en)) assert.deepEqual((en[k].match(/\{\w+\}/g) ?? []).sort(), (fr[k].match(/\{\w+\}/g) ?? []).sort(), k);
  assert.deepEqual(manifest.places.map((p) => [p.place, p.fromTab]), [["live.goals.goal", "goal"], ["live.goals.subathon", "subathon"]]);
  // R2: the short path of each tab shows two fields, the rest is folded
  const visible = (tab) => manifest.settings.filter((s) => s.tab === tab && !s.rare && !s.advanced).map((s) => s.key);
  assert.deepEqual(visible("goal"), ["goalMetric", "goalTarget"]);
  assert.deepEqual(visible("subathon"), ["subathonStart", "subathonLength"]);
  const engineOpts = fakeCtx({}).overlay?.animateOptions?.();
  if (engineOpts) assert.deepEqual(manifest.overlayElements[0].options, engineOpts, "the same two options, with the same words, as every animated element");
});

/* ───────────── The rule against double counting ───────────── */
test("dedup: by message id first, then by person (follow once per login, sub once per login in 10 min, gift/cheer once per amount in 10 s)", () => {
  const ev = ({ type, at, ...o }) => M.eventOf(item(type, at, o));
  const a = ev({ type: "follow", at: T0, login: "etoile_nord", id: "m1" });
  const row = { eid: a.eid, fp: M.fingerprint(a), at: a.at };
  assert.equal(M.isDuplicate(a, [row]), true, "same message id");
  assert.equal(M.isDuplicate(ev({ type: "follow", at: T0 + 86_400_000, login: "etoile_nord", id: "m2" }), [row]), true, "unfollow and follow again: once");
  assert.equal(M.isDuplicate(ev({ type: "follow", at: T0, login: "lune_douce", id: "m3" }), [row]), false);
  const s = ev({ type: "sub", at: T0, login: "camille", tier: "1", id: "s1" }), srow = { eid: "s1", fp: M.fingerprint(s), at: T0 };
  assert.equal(M.isDuplicate(ev({ type: "sub", at: T0 + 2000, login: "camille", tier: "1", id: "s2" }), [srow]), true, "the same sub delivered to two listening modules");
  assert.equal(M.isDuplicate(ev({ type: "sub", at: T0 + 700_000, login: "camille", tier: "1", id: "s3" }), [srow]), false, "another sub later is another sub");
  const g = ev({ type: "gift", at: T0, login: "", count: 5, id: "g1" }), grow = { eid: "g1", fp: M.fingerprint(g), at: T0 };
  assert.equal(M.isDuplicate(ev({ type: "gift", at: T0 + 3000, count: 5, id: "g2" }), [grow]), true);
  assert.equal(M.isDuplicate(ev({ type: "gift", at: T0 + 3000, count: 3, id: "g3" }), [grow]), false);
  assert.equal(M.isDuplicate(ev({ type: "gift", at: T0 + 30_000, count: 5, id: "g4" }), [grow]), false);
  assert.equal(M.eventOf(item("raid", T0, {})), null, "raids are not counted");
});

test("displayed = reference + events after its asOf; an event at or before asOf is already in the reference", () => {
  const rows = [{ kind: "follow", at: T0 - 5000 }, { kind: "follow", at: T0 }, { kind: "follow", at: T0 + 1 }, { kind: "sub", at: T0 + 2 }];
  assert.equal(M.goalValue({ value: 100, asOf: T0 }, rows, "followers"), 101);
  assert.equal(M.goalValue({ value: 10, asOf: T0 }, [...rows, { kind: "sub_end", at: T0 + 3 }, { kind: "gift", count: 5, at: T0 + 4 }], "subs"), 10, "subs: +1 sub, -1 end, the gift line is not counted again (its subs come one by one)");
});

test("rebase: a new reading glides from the shown value (up or down), never celebrates; an older reading is ignored", () => {
  const st = {}, rows = [{ kind: "follow", at: T0 + 10 }, { kind: "follow", at: T0 + 20 }];
  assert.equal(S.applyBase(st, "followers", { value: 100, asOf: T0 }, rows, T0 + 30), true);
  assert.equal(st.rebases?.followers, undefined, "the first reading is not a change");
  assert.equal(M.goalValue(st.bases.followers, rows, "followers"), 102);
  // a fresh reading at T0+25 counts both follows and two unfollows we never saw: 100 → shown 102 → now 100 (it goes down)
  assert.equal(S.applyBase(st, "followers", { value: 100, asOf: T0 + 25 }, rows, T0 + 40), true);
  assert.deepEqual(st.rebases.followers, { from: 102, at: T0 + 40 });
  assert.equal(S.applyBase(st, "followers", { value: 50, asOf: T0 }, rows, T0 + 50), false, "an older reading changes nothing");
  const view = M.goalView({ value: 100, min: 90, target: 200, rows: [], rebase: st.rebases.followers, tests: [], label: "x", now: T0 + 41, metric: "followers" });
  assert.deepEqual(view.rebase, { from: 102, at: T0 + 40 });
  assert.equal(view.highlights.length, 0, "no highlight on a rebase");
});

test("automatic target and ticks; crossings celebrate only on the way up", () => {
  assert.deepEqual([9, 63, 512, 1234, 5000].map(M.nextRound), [10, 70, 550, 1500, 5500]);
  assert.deepEqual(M.milestonesOf(1000, 1100), [1025, 1050, 1075]);
  assert.equal(M.crossing(1099, 1100, { min: 1000, target: 1100 }), "complete");
  assert.equal(M.crossing(1049, 1050, { min: 1000, target: 1100 }), "milestone");
  assert.equal(M.crossing(1051, 1052, { min: 1000, target: 1100 }), null);
  assert.equal(M.crossing(1100, 1099, { min: 1000, target: 1100 }), null, "going down never celebrates");
  const st = {};
  const sp = S.spanOf(st, { metric: "followers", target: null }, 63, T0);
  assert.deepEqual(sp, { min: 63, target: 70 });
  assert.deepEqual(S.spanOf(st, { metric: "followers", target: null }, 66, T0 + 1), { min: 63, target: 70 }, "the automatic target stays while you approach it");
  S.spanOf(st, { metric: "followers", target: null }, 70, T0 + 2);
  assert.deepEqual(S.spanOf(st, { metric: "followers", target: null }, 71, T0 + 2 + 3_600_001), { min: 71, target: 80 }, "an hour after it is reached, the next round number");
});

/* ───────────── Subathon arithmetic ───────────── */
const R = M.rulesOf({ subathonLength: 3600, secondsPerSub: 300, secondsPerHundredBits: 60, secondsPerFollow: 10, subathonCap: 0 });
const rowsSub = (list) => list.map((r, i) => ({ id: r.id ?? `r${i}`, showAt: r.at + 1600, tier: 1, ...r }));

test("subathon: tiers, gifts, bits, follows; gifted subs counted once (by the gift); before the start nothing counts", () => {
  const rows = rowsSub([
    { kind: "sub", at: T0 - 1000 },                 // before the start
    { kind: "sub", at: T0 + 1000, tier: 2 },        // 600
    { kind: "resub", at: T0 + 2000, tier: 3 },      // 1500
    { kind: "gift", at: T0 + 3000, count: 5 },      // 1500
    { kind: "sub", at: T0 + 3001, gifted: true },   // 0 (in the gift)
    { kind: "cheer", at: T0 + 4000, bits: 250 },    // 150
    { kind: "follow", at: T0 + 5000 },              // 10
  ]);
  const f = M.subathonFold({ startAt: T0, rules: R, rows, now: T0 + 10_000 });
  assert.equal(f.addedS, 600 + 1500 + 1500 + 150 + 10);
  assert.equal(f.endsAt, T0 + (3600 + f.addedS) * 1000);
  assert.equal(f.remainingS, 3600 + f.addedS - 10);
  assert.deepEqual(f.applied.map((a) => a.seconds), [600, 1500, 1500, 150, 10]);
});

test("subathon: the cap bounds the whole length (the rest is noted, not added); a negative correction never goes below 'ends now'", () => {
  const capped = M.rulesOf({ subathonLength: 3600, secondsPerSub: 300, subathonCap: 4000 });
  const f = M.subathonFold({ startAt: T0, rules: capped, rows: rowsSub([{ kind: "sub", at: T0 + 1000 }, { kind: "sub", at: T0 + 2000 }]), now: T0 + 3000 });
  assert.equal(f.addedS, 400);
  assert.equal(f.capped, 200);
  assert.deepEqual(f.applied.map((a) => [a.seconds, a.want]), [[300, 300], [100, 300]]);
  const v = M.subathonView({ fold: f, rules: capped, tests: [], label: "S", now: T0 + 3000 });
  assert.equal(v.target, 4000, "the bar's span is the cap");
  const neg = M.subathonFold({ startAt: T0, rules: R, rows: rowsSub([{ kind: "manual", at: T0 + 3000_000, seconds: -36_000 }]), now: T0 + 3000_001 });
  assert.equal(neg.applied[0].seconds, -600, "only the 600 s that were left");
  assert.equal(neg.ended, true);
  const late = M.subathonFold({ startAt: T0, rules: R, rows: rowsSub([{ kind: "manual", at: T0 + 3000_000, seconds: -36_000 }, { kind: "sub", at: T0 + 3000_500 }]), now: T0 + 3001_000 });
  assert.equal(late.addedS, -600, "a sub after the end adds nothing");
});

test("subathon: a pause holds the time left (engine: endsAt - pausedAt), events during the pause still add; resuming continues", () => {
  const pauses = [{ from: T0 + 600_000, to: null }];
  const during = M.subathonFold({ startAt: T0, rules: R, rows: rowsSub([{ kind: "sub", at: T0 + 700_000 }]), pauses, now: T0 + 900_000 });
  assert.equal(during.pausedAt, T0 + 600_000);
  assert.equal(during.remainingS, 3000 + 300, "50 minutes left at the pause, plus the sub");
  assert.equal(M.subathonFold({ startAt: T0, rules: R, rows: [], pauses, now: T0 + 2_000_000 }).remainingS, 3000, "still 50 minutes much later");
  const resumed = M.subathonFold({ startAt: T0, rules: R, rows: [], pauses: [{ from: T0 + 600_000, to: T0 + 900_000 }], now: T0 + 960_000 });
  assert.equal(resumed.pausedAt, null);
  assert.equal(resumed.remainingS, 3000 - 60);
  const view = M.subathonView({ fold: during, rules: R, tests: [], label: "S", now: T0 + 900_000 });
  assert.equal(view.timer.pausedAt, T0 + 600_000);
  assert.equal((view.timer.endsAt - view.timer.pausedAt) / 1000, 3300);
  const before = M.subathonView({ fold: M.subathonFold({ startAt: T0 + 3600_000, rules: R, rows: [], now: T0 }), rules: R, tests: [], label: "S", now: T0 });
  assert.equal((before.timer.endsAt - before.timer.pausedAt) / 1000, 3600, "before the start: the full length, held");
});

test("site time: a start written in the site's zone, daylight saving included", () => {
  assert.equal(M.siteTime("2026-11-30T18:30", "Europe/Brussels"), Date.UTC(2026, 10, 30, 17, 30));
  assert.equal(M.siteTime("2026-07-01T18:30", "Europe/Brussels"), Date.UTC(2026, 6, 1, 16, 30));
  assert.ok(Number.isNaN(M.siteTime("", "UTC")));
});

/* ───────────── The module with its sources ───────────── */
test("live: an event moves the bar within the poll (highlight 1.6 s after it was seen); test lines only rehearse; resume after reload replays nothing", async () => {
  const { ctx, box } = world();
  const now0 = T0;
  box.stats = stat("followers", 1000, now0 - 60_000);
  await S.sync(ctx, { now: now0, force: true });
  let g = await S.goalNow(ctx, now0);
  assert.equal(g.value, 1000);
  assert.deepEqual([g.min, g.target], [1000, 1500]);
  box.events.push(follow("etoile_nord", now0 + 500));
  box.events.push(item("follow", now0 + 600, { login: "lune_douce", test: true }));
  await S.sync(ctx, { now: now0 + 1500 });
  g = await S.goalNow(ctx, now0 + 1500);
  assert.equal(g.value, 1001, "the real follow counts; the test does not");
  const st = await S.goalState(ctx, now0 + 1500);
  const steps = st.highlights.filter((h) => h.kind === "step");
  assert.equal(steps.length, 2, "one step for the follow, one for the rehearsal");
  assert.ok(steps.every((h) => h.at === now0 + 1500 + M.SHOW_DELAY_MS), "both start 1.6 s after being seen: every page polling every 1.5 s shows them");
  assert.ok(st.highlights.some((h) => h.kind === "drop" && h.amount === -1), "the rehearsal goes back by itself");
  // reload long after: the same state, nothing in progress
  S.resetMemory();
  const later = await S.goalState(ctx, now0 + 120_000);
  assert.equal(later.value, 1001);
  assert.equal(later.highlights.length, 0, "old highlights are not sent again");
});

test("an event older than a minute when first seen (catch-up, first reading after install) counts silently", async () => {
  const { ctx, box } = world();
  box.stats = stat("followers", 10, T0 - 3_600_000);
  box.events.push(follow("camille", T0 - 1_800_000));
  await S.sync(ctx, { now: T0, force: true });
  const st = await S.goalState(ctx, T0);
  assert.equal(st.value, 11);
  assert.equal(st.highlights.length, 0);
});

test("concurrency: two overlay pages asking at once count each event once and show the same state", async () => {
  const { ctx, box } = world({ timezone: "UTC", settings: { subathonStart: startIn(-10) } });
  const t = Date.now() - 5000;   // the route reads the real clock
  box.stats = stat("followers", 500, t - 10_000);
  for (let i = 0; i < 6; i++) box.events.push(follow(`fan_${i}`, t + i * 100));
  box.events.push(sub("etoile_nord", t + 700));
  const ask = (slug) => def.routes["state/:slug"](new Request(`https://example.test/m/x/state/${slug}?k=${encodeURIComponent(ctx.__k)}`), Object.assign(ctx, { params: { slug } }));
  ctx.__k = await S.secretOf(ctx);
  S.memoryOf(ctx).syncedAt = 0;
  const [a, b] = await Promise.all([ask("goal"), ask("goal")]);
  const ja = await a.json(), jb = await b.json();
  assert.equal(ja.state.value, 506); assert.equal(jb.state.value, 506);
  assert.equal(ctx.dumpStore().filter((r) => r.collection === S.LEDGER).length, 7, "each event once in the ledger");
  const sa = await (await ask("subathon")).json();
  assert.equal(sa.state.format, "time");
  assert.equal(sa.state.highlights.filter((h) => h.kind === "extend").length, 1, "one +5:00 for the sub");
  assert.equal(sa.state.highlights[0].amount, 300);
  // a subathon with no start: nothing to say, the element shows nothing
  const idle = world({ timezone: "UTC" });
  idle.ctx.__k = await S.secretOf(idle.ctx);
  const none = await (await def.routes["state/:slug"](new Request(`https://example.test/m/x/state/subathon?k=${encodeURIComponent(idle.ctx.__k)}`), Object.assign(idle.ctx, { params: { slug: "subathon" } }))).json();
  assert.equal(none.visible, false);
  const denied = await def.routes["state/:slug"](new Request("https://example.test/m/x/state/goal?k=wrong"), Object.assign(ctx, { params: { slug: "goal" } }));
  assert.equal(denied.status, 403, "the numbers need the secret of the element address");
});

test("without any Twitch module: manual value, add time, pause; the admin suggests the modules that would feed it (never installs)", async () => {
  const { ctx } = world({ providers: [], timezone: "UTC", settings: { goalMetric: "manual", goalTarget: 50, subathonStart: startIn(-10) } });
  const panel = await def.adminPanel(ctx);
  assert.ok(panel.some((b) => b.type === "adminForm" && b.action === "setValue"));
  assert.equal(panel.filter((b) => b.type === "suggestInstall").length, 1, "manual goal: only the events are suggested, for the subathon");
  assert.ok((await def.adminActions.setValue(ctx, { value: "12" })).ok);
  assert.ok((await def.adminActions.setValue(ctx, { value: "-3" })).errors?.value, "an error under the field, with an example");
  assert.equal((await S.goalNow(ctx)).value, 12);
  const fol = world({ providers: [] });
  const p2 = await def.adminPanel(fol.ctx);
  assert.deepEqual(p2.filter((b) => b.type === "suggestInstall").map((b) => b.service).sort(), ["alerts.queue", "alerts.queue", "twitch.live"].sort());
  assert.ok((await def.adminActions.addTime(ctx, { minutes: "5" })).ok);
  const x = await S.subathonNow(ctx);
  assert.equal(x.fold.addedS, 300);
  assert.ok((await def.adminActions.addTime(ctx, { minutes: "abc" })).errors?.minutes);
});

test("assistant tools: reading, setting a value, pausing, adding time (bounded)", async () => {
  const { ctx } = world({ timezone: "UTC", settings: { subathonStart: startIn(-10), subathonLength: 3600 } });
  const g = await def.mcp.goal_get(ctx);
  assert.equal(g.metric, "followers");
  assert.equal((await def.mcp.goal_set(ctx, { value: 42 })).value, 42);
  await assert.rejects(def.mcp.goal_set(ctx, { value: -1 }), (e) => e.expose === true);
  const before = await def.mcp.subathon_get(ctx);
  assert.equal(typeof before.remainingSeconds, "number");
  assert.equal((await def.mcp.subathon_pause(ctx, { paused: true })).paused, true);
  assert.equal((await def.mcp.subathon_add_time(ctx, { minutes: 10 })).addedSeconds, 600);
  await assert.rejects(def.mcp.subathon_add_time(ctx, { minutes: 601 }), (e) => e.expose === true);
  assert.equal((await def.mcp.goal_test(ctx, { gauge: "subathon" })).gauge, "subathon");
});

test("element page: the core's engine and the state address with the secret; an older core shows a sentence; CSP has no outside address", async () => {
  const { ctx } = world();
  const r = await def.overlayElements.goal(ctx, { lang: "fr" });
  assert.match(r.url, /^\/m\/sg\d+\/element\/goal\?k=[\w-]{16,}&lang=fr$/);
  const html = P.elementPage(ctx, "goal", new URL(`https://example.test${r.url}`).searchParams);
  assert.ok(html.includes("CuriosaAnimate"));
  assert.ok(html.includes(`/state/goal?k=`));
  const old = P.elementPage({ ...ctx, overlay: undefined, t: (k) => k, locale: "en", instance: ctx.instance }, "goal", new URLSearchParams());
  assert.ok(old.includes("update_core") && !old.includes("<script>"));
  assert.ok(!/https?:\/\//.test(P.CSP));
});

/* ───────────── Frames: the core's engine, the same text as in OBS ───────────── */
const engine = (ctx) => { const win = {}; new Function("window", ctx.overlay.animateScript())(win); return win.CuriosaAnimate; };
test("frames: states pass the engine's checker; a burst of five follows is ONE reaction (+5); the subathon writes +5:00; a reload shows no replay", { skip: typeof fakeCtx({}).overlay?.animateScript !== "function" && "core without the animation engine" }, () => {
  const ctx = fakeCtx({});
  const A = engine(ctx);
  const rows = Array.from({ length: 5 }, (_, i) => ({ eid: `f${i}`, kind: "follow", at: T0 + i * 100, showAt: T0 + 1600 + i * 300 }));
  const st = M.goalView({ value: 105, min: 100, target: 200, rows, rebase: null, tests: [], label: "Follower goal", now: T0 + 1600, metric: "followers" });
  assert.deepEqual(ctx.overlay.checkAnimateState(st).problems, []);
  const v = A.view(st, T0 + 3000);
  assert.equal(v.highlights.length, 1); assert.equal(v.highlights[0].amount, 5);
  assert.equal(A.view(st, T0 + 1500).display, 100, "before the reaction starts, the value has not jumped");
  assert.equal(A.view(st, T0 + 10_000).display, 105);
  const f = M.subathonFold({ startAt: T0, rules: R, rows: rowsSub([{ id: "s1", kind: "sub", at: T0 + 1000 }]), now: T0 + 1000 });
  const sv = M.subathonView({ fold: f, rules: R, tests: [], label: "Subathon", now: T0 + 1000 });
  assert.deepEqual(ctx.overlay.checkAnimateState(sv).problems, []);
  const frame = A.frame(sv, null, T0 + 2600 + 300, { w: 1764, h: 717 }, { quality: "full" });
  assert.ok(frame.ops.some((o) => o.k === "text" && o.t === "+5:00"), "the time added is written");
  const late = A.frame({ ...sv, highlights: sv.highlights }, null, T0 + 120_000, { w: 1764, h: 717 }, { calm: true });
  assert.equal(late.view.highlights.length, 0, "a page opened later shows the current state, nothing replayed");
  // a rehearsal goes up then comes back without a jump
  const reh = M.goalView({ value: 100, min: 0, target: 200, rows: [], rebase: null, tests: [{ id: "t1", at: T0, for: "goal", amount: 1 }], label: "x", now: T0, metric: "followers" });
  const d = [T0 - 100, T0 + 2000, T0 + M.TEST_HOLD_MS + 3000].map((t) => Math.round(A.view(reh, t).display * 100) / 100);
  assert.deepEqual(d, [100, 101, 100]);
  // two engines, the same instant: the same picture (two overlay pages)
  assert.deepEqual(JSON.stringify(engine(ctx).frame(st, null, T0 + 2000, { w: 800, h: 200 }, {})), JSON.stringify(A.frame(st, null, T0 + 2000, { w: 800, h: 200 }, {})));
});

/* ───────────── Tier factors (1.1.0): configurable, defaults unchanged ───────────── */
const tierField = (n) => manifest.settings.find((s) => s.key === `tierFactor${n}`);
const secondsFor = (rules, tier) => M.subathonSeconds({ kind: "sub", tier }, rules);

test("tier factors: the defaults are 1, 2 and 5, so a site that never touched them counts exactly as before", () => {
  const unset = M.rulesOf({ secondsPerSub: 300 });
  assert.deepEqual(unset.tiers, { 1: 1, 2: 2, 3: 5 });
  assert.deepEqual([1, 2, 3].map((t) => secondsFor(unset, t)), [300, 600, 1500]);
  for (const n of [1, 2, 3]) assert.equal(tierField(n).default, [1, 2, 5][n - 1], `manifest default of tier ${n}`);
  // an empty or unreadable stored value is the default too
  assert.deepEqual(M.rulesOf({ secondsPerSub: 300, tierFactor1: "", tierFactor2: "abc", tierFactor3: null }).tiers, { 1: 1, 2: 2, 3: 5 });
  // the same rows give the same total as the fixed table of 1.0.0 (sub, resub, gift of 5)
  const rows = rowsSub([{ kind: "sub", at: T0 + 1000, tier: 2 }, { kind: "resub", at: T0 + 2000, tier: 3 }, { kind: "gift", at: T0 + 3000, count: 5 }]);
  assert.equal(M.subathonFold({ startAt: T0, rules: unset, rows, now: T0 + 10_000 }).addedS, 600 + 1500 + 1500);
});

test("tier factors: custom factors change the time of a sub, a renewal and a gift; gifted subs are still counted once, by the gift", () => {
  const r = M.rulesOf({ secondsPerSub: 300, tierFactor1: 1, tierFactor2: 3, tierFactor3: 10 });
  assert.deepEqual(r.tiers, { 1: 1, 2: 3, 3: 10 });
  assert.equal(M.subathonSeconds({ kind: "sub", tier: 2 }, r), 900);
  assert.equal(M.subathonSeconds({ kind: "resub", tier: 3 }, r), 3000);
  assert.equal(M.subathonSeconds({ kind: "gift", tier: 2, count: 4 }, r), 3600);
  assert.equal(M.subathonSeconds({ kind: "sub", tier: 3, gifted: true }, r), 0, "a gifted sub is in its gift line");
  const half = M.rulesOf({ secondsPerSub: 300, tierFactor1: 0.5, tierFactor2: 0, tierFactor3: 20 });
  assert.deepEqual([1, 2, 3].map((t) => secondsFor(half, t)), [150, 0, 6000], "fractions are allowed, 0 adds nothing");
  assert.equal(M.subathonSeconds({ kind: "sub", tier: 1 }, M.rulesOf({ secondsPerSub: 301, tierFactor1: 1.5 })), 452, "rounded to the second");
  assert.equal(M.subathonSeconds({ kind: "cheer", bits: 200 }, r), 120, "bits and follows ignore the tier factors");
  const f = M.subathonFold({ startAt: T0, rules: r, rows: rowsSub([{ kind: "sub", at: T0 + 1000, tier: 3 }, { kind: "sub", at: T0 + 2000, tier: 1 }]), now: T0 + 5000 });
  assert.deepEqual(f.applied.map((a) => a.seconds), [3000, 300]);
});

test("tier factors: out-of-range readings are kept within the bounds (the core refuses them at the form)", () => {
  const r = M.rulesOf({ secondsPerSub: 300, tierFactor1: -4, tierFactor2: 999, tierFactor3: "2,5" });
  assert.equal(r.tiers[1], 0);
  assert.equal(r.tiers[2], 20);
  assert.equal(r.tiers[3], 5, "an unreadable text is the default");
});

test("tier factors: the settings sit in the subathon fold with a unit, a visible default, bounds and an example; EN/FR; short path unchanged", () => {
  for (const n of [1, 2, 3]) {
    const f = tierField(n);
    assert.ok(f, `tierFactor${n}`);
    assert.equal(f.type, "number");
    assert.equal(f.tab, "subathon");
    assert.equal(f.rare, true, "folded, not in the short path");
    assert.deepEqual([f.min, f.max, f.step], [0, 20, 0.5]);
    assert.ok(f.unit.en && f.unit.fr, "a unit in both languages");
    assert.equal(f.example, String(f.default), "an example under the field");
    for (const lang of ["en", "fr"]) {
      assert.ok(f.label[lang].length <= 60 && !/:/.test(f.label[lang]), "R10");
      assert.ok(f.help[lang].length <= 60, "R11");
      assert.doesNotMatch(`${f.label[lang]} ${f.help[lang]} ${f.unit[lang]}`, /\b(token|webhook|api|json|cache|slug|jeton|clé|identifiant)\b/i, "R9");
    }
  }
  const visible = (tab) => manifest.settings.filter((s) => s.tab === tab && !s.rare && !s.advanced).map((s) => s.key);
  assert.deepEqual(visible("subathon"), ["subathonStart", "subathonLength"]);
  assert.ok(manifest.settings.filter((s) => s.tab === "subathon" && !s.rare).length <= 7, "R5");
  assert.equal(manifest.minCore, "0.30.0");
  assert.equal(manifest.version, "1.1.1");
  assert.deepEqual(manifest.places.map((p) => p.place), ["live.goals.goal", "live.goals.subathon"], "same place, two sections");
  assert.equal(manifest.tabs.filter((t) => !t.hidden).length, 2);
});

test("tier factors: the core refuses a bad value under the field, with a bound and an example", async () => {
  const { checkFieldInput } = await import("@/core/modules/settingValues");
  const field = tierField(2);
  for (const ok of ["0", "1", "2", "2,5", "2.5", "20"]) assert.equal(checkFieldInput(field, ok).ok, true, ok);
  assert.deepEqual(checkFieldInput(field, "2,5"), { ok: true, value: 2.5 });
  for (const bad of ["-1", "21", "2.3", "abc", "1e99"]) assert.equal(checkFieldInput(field, bad).ok, false, bad);
  assert.equal(checkFieldInput(field, "21").reason, "range");
  assert.equal(checkFieldInput(field, "abc").reason, "number");
  const core = process.env.CURIOSA_DIR;
  for (const lang of ["en", "fr"]) {
    const msgs = JSON.parse(fs.readFileSync(`${core}/src/locales/${lang}.json`, "utf8"));
    assert.match(msgs["instances.error.range"], /\{min\}.*\{max\}.*\{example\}/, `${lang}: bounds and an example in the message`);
  }
});

test("tier factors: a custom factor reaches the countdown through the settings, and the assistant reads them", async () => {
  const { ctx } = world({ timezone: "UTC", settings: { subathonStart: startIn(-10), subathonLength: 3600, tierFactor2: 4, tierFactor3: 0 } });
  const g = await def.mcp.subathon_get(ctx);
  assert.deepEqual(g.rules.tierFactors, { 1: 1, 2: 4, 3: 0 });
  const dflt = await def.mcp.subathon_get(world({ timezone: "UTC", settings: { subathonStart: startIn(-10) } }).ctx);
  assert.deepEqual(dflt.rules.tierFactors, { 1: 1, 2: 2, 3: 5 });
});
