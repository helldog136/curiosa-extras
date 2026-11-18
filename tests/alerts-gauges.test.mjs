// Alerts overlay 1.20.0: the Twitch data the gauges need (progress inside a hype level and its countdown kept, the end of a subscription listened to) and the
// two animated elements (hype train, session counter). Existing alerts must not change: a sub end never makes an alert, the Test of "sub" stays one sub.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { world, deliver, EV, B, NOW, es, S, P, mod, manifest, TWO } from "./helpers/eventsWorld.mjs";

const H = await import("../modules/alerts-overlay/twitch/hype.mjs");
const G = await import("../modules/alerts-overlay/gauges.mjs");

const subEnd = { user_id: "8", user_login: "lune_douce", user_name: "Lune_Douce", broadcaster_user_id: B, broadcaster_user_login: "emma_test", broadcaster_user_name: "Emma_Test", tier: "1000", is_gift: false };
const ex = (min) => new Date(NOW + min * 60_000).toISOString();

test("EventSub: the end of a subscription is listened to with the 'sub' switch (same permission), normalised, never an alert; the Test of sub stays one sub", () => {
  const sub = es.TYPES.find((t) => t.id === "sub");
  assert.deepEqual(sub.subs.map((s) => [s.type, s.version]), [["channel.subscribe", "1"], ["channel.subscription.end", "1"]]);
  assert.deepEqual(sub.scopes, ["channel:read:subscriptions"]);
  const ev = es.normalise("channel.subscription.end", subEnd, new Date(NOW).toISOString());
  assert.deepEqual({ ...ev, at: undefined }, { kind: "sub_end", name: "Lune_Douce", login: "lune_douce", tier: "1", at: undefined });
  assert.equal(es.groupOf("sub_end"), "sub");
  assert.deepEqual(P.testKinds("sub"), ["sub"]);
  assert.equal(TWO.typeOf({ type: "sub_end" }), null, "no alert type: the overlay skips it as unknown");
  assert.equal(TWO.alertFor({ id: "x", type: "sub_end", at: new Date(NOW).toISOString(), name: "Lune_Douce" }, { config: { types: {} }, text: () => "", title: () => "", now: NOW }).skip, "unknown");
});

test("hype: begin/progress keep `expiresAt`; every progress moves the live state (one journal line per NEW level only, as before)", async () => {
  const { ctx } = world();
  await S.ensureSecret(ctx);
  await S.updateState(ctx, (d) => { d.enabled = { hype: true }; });
  assert.equal((await deliver(ctx, "channel.hype_train.begin", { ...EV.hypeBegin, expires_at: ex(5) }, { id: "hb", version: "2" })).status, 204);
  await deliver(ctx, "channel.hype_train.progress", { ...EV.hypeProgress(1), total: 900, progress: 900, goal: 1800, expires_at: ex(6) }, { id: "hp1", version: "2", now: NOW + 30_000 });
  await deliver(ctx, "channel.hype_train.progress", { ...EV.hypeProgress(1), total: 1200, progress: 1200, goal: 1800, expires_at: ex(7) }, { id: "hp2", version: "2", now: NOW + 60_000 });
  await deliver(ctx, "channel.hype_train.progress", { ...EV.hypeProgress(2), total: 2000, progress: 200, goal: 2000, expires_at: ex(8) }, { id: "hp3", version: "2", now: NOW + 90_000 });
  const lines = await S.recent(ctx, 10);
  assert.deepEqual(lines.map((l) => l.kind).sort(), ["hype_begin", "hype_progress"], "the journal keeps one line per new level: its size and retention do not change");
  assert.equal(lines.find((l) => l.kind === "hype_begin").expiresAt, Date.parse(ex(5)));
  const h = (await S.readState(ctx)).hype;
  assert.deepEqual([h.level, h.progress, h.goal, h.expiresAt, h.ended], [2, 200, 2000, Date.parse(ex(8)), false]);
  assert.deepEqual(h.events.map((e) => [e.id, e.kind, e.amount]), [["hb", "begin", 600], ["hp1", "step", 300], ["hp2", "step", 300], ["hp3", "level", 800]]);
  // the same message again (Twitch delivers at least once) changes nothing
  await deliver(ctx, "channel.hype_train.progress", { ...EV.hypeProgress(1), total: 1200, progress: 1200, goal: 1800, expires_at: ex(7) }, { id: "hp2", version: "2", now: NOW + 95_000 });
  assert.equal((await S.readState(ctx)).hype.events.length, 4);
  await deliver(ctx, "channel.hype_train.end", { ...EV.hypeEnd, level: 2 }, { id: "he", version: "2", now: NOW + 120_000 });
  const e = (await S.readState(ctx)).hype;
  assert.equal(e.ended, true); assert.equal(e.events.at(-1).kind, "end");
  // the topic item carries the countdown for other modules (additive field)
  const items = await P.topicItems(ctx, { limit: 10 }, NOW + 200_000);
  assert.equal(items.find((i) => i.type === "hype_begin").expiresAt, Date.parse(ex(5)));
});

test("hype: an older state (no `hype` key, lines without countdown) is rebuilt from the journal; a train without an end is over after its countdown", () => {
  const lines = [
    { id: "l3", kind: "hype_progress", level: 3, total: 4200, goal: 5400, progress: 1400, source: "twitch", at: NOW - 60_000, receivedAt: NOW - 60_000 },
    { id: "l1", kind: "hype_begin", level: 1, total: 600, goal: 1800, progress: 600, source: "twitch", at: NOW - 120_000, receivedAt: NOW - 120_000 },
    { id: "old", kind: "hype_end", level: 2, total: 3000, source: "twitch", at: NOW - 3_600_000, receivedAt: NOW - 3_600_000 },
  ];
  const h = H.fromJournal(lines);
  assert.deepEqual([h.level, h.progress, h.goal, h.ended, h.expiresAt], [3, 1400, 5400, false, undefined]);
  const s = G.hypeState(h, { now: NOW, label: "Hype" });
  assert.equal(s.genre, "levels"); assert.equal(s.level, 3); assert.equal(s.timer, undefined, "no countdown without the Twitch time");
  assert.equal(G.hypeState(h, { now: NOW + 10 * 60_000 }), null, "five minutes without a message: over, and hidden after its celebration");
  const ended = H.noteHype(h, { kind: "hype_end", level: 3, total: 6000 }, { id: "e", receivedAt: NOW });
  assert.equal(G.hypeState(ended, { now: NOW + 1000 }).ended, true);
  assert.equal(G.hypeState(ended, { now: NOW + G.ENDED_SHOW_MS + 1 }), null);
  assert.equal(H.fromJournal([]), null);
});

test("hype element: a live train is a `levels` state with its countdown and one highlight per contribution, 1.6 s after arrival; a test is a short demonstration", () => {
  const h = { level: 2, total: 2000, goal: 2000, progress: 500, expiresAt: NOW + 200_000, updatedAt: NOW, ended: false, events: [{ id: "a", at: NOW, kind: "step", amount: 100 }, { id: "b", at: NOW + 50, kind: "level", amount: 0 }] };
  const s = G.hypeState(h, { now: NOW, label: "Hype" });
  assert.deepEqual(s.timer, { endsAt: NOW + 200_000, total: 300_000 });
  assert.deepEqual(s.highlights.map((x) => [x.id, x.kind, x.at]), [["a", "step", NOW + 1600], ["b", "milestone", NOW + 1650]]);
  const kit = fakeCtx({}).overlay;
  if (kit?.checkAnimateState) assert.deepEqual(kit.checkAnimateState(s).problems, []);
  const tests = [{ id: "t1", kind: "hype_begin", level: 1, total: 600, goal: 1800, progress: 600, source: "test", at: NOW, receivedAt: NOW }, { id: "t2", kind: "hype_end", level: 4, total: 9100, source: "test", at: NOW + 1, receivedAt: NOW + 1 }];
  const demo = G.hypeState(null, { tests, now: NOW + 2000 });
  assert.equal(demo.ended, true); assert.equal(demo.level, 4);
  assert.equal(G.hypeState(null, { tests, now: NOW + G.TEST_SHOW_MS + 10 }), null);
});

test("session: the window starts at the last 'online' (a drop and restart within 10 minutes is the same session), ends at its 'offline'", () => {
  const L = (kind, minutes, o = {}) => ({ id: `${kind}${minutes}`, kind, at: NOW + minutes * 60_000, receivedAt: NOW + minutes * 60_000, source: "twitch", ...o });
  assert.deepEqual(G.sessionWindow([L("online", 0)], NOW + 60_000), { from: NOW, to: null, live: true });
  assert.deepEqual(G.sessionWindow([L("online", 0), L("offline", 30), L("online", 35)], NOW + 40 * 60_000), { from: NOW, to: null, live: true }, "flapping: the same session");
  assert.deepEqual(G.sessionWindow([L("online", 0), L("offline", 30), L("online", 60)], NOW + 70 * 60_000), { from: NOW + 60 * 60_000, to: null, live: true });
  assert.deepEqual(G.sessionWindow([L("online", 0), L("offline", 30)], NOW + 40 * 60_000), { from: NOW, to: NOW + 30 * 60_000, live: false });
  assert.deepEqual(G.sessionWindow([L("online", 0, { source: "test" })], NOW), { from: NOW - G.ROLLING_MS, to: null, live: false }, "a test 'online' does not start a session");
});

test("session counter: subs (new + renewed + gifts, gifted subs not twice), bits, follows (once per login); tests rehearse and come back", () => {
  const L = (id, kind, s, o = {}) => ({ id, kind, at: NOW + s * 1000, receivedAt: NOW + s * 1000, source: "twitch", ...o });
  const lines = [L("on", "online", 0), L("a", "sub", 10), L("b", "resub", 20), L("c", "gift", 30, { count: 5 }), L("d", "sub", 31, { gifted: true }), L("e", "cheer", 40, { amount: 500 }), L("f", "follow", 50, { login: "camille" }), L("g", "follow", 60, { login: "camille" }), L("h", "sub_end", 70), L("t", "sub", 80, { source: "test" })];
  const now = NOW + 81_000;
  const subs = G.sessionState(lines, { metric: "subs", now });
  assert.equal(subs.value, 7);
  const t = subs.highlights.filter((h) => h.id.startsWith("t"));
  assert.deepEqual(t.map((h) => [h.kind, h.amount, h.at - (NOW + 80_000)]), [["step", 1, G.SHOW_DELAY_MS], ["drop", -1, G.SHOW_DELAY_MS + G.TEST_HOLD_MS]]);
  assert.equal(G.sessionState(lines, { metric: "bits", now }).value, 500);
  assert.equal(G.sessionState(lines, { metric: "follows", now }).value, 1);
  const kit = fakeCtx({}).overlay;
  if (kit?.animateScript) {
    const win = {}; new Function("window", kit.animateScript())(win);
    const A = win.CuriosaAnimate;
    assert.deepEqual(kit.checkAnimateState(subs).problems, []);
    const d = [now, now + 1600 + 2000, now + 1600 + G.TEST_HOLD_MS + 3000].map((x) => Math.round(A.view(subs, x).display * 100) / 100);
    assert.deepEqual(d, [7, 8, 7], "the test lifts the counter, then it glides back; nothing replayed after");
    assert.equal(A.view(subs, now + 120_000).highlights.length, 0);
  }
});

test("elements: two animated elements after the alerts, routes with the core's engine, read-only state; demo mode for the overlay editor", async () => {
  assert.deepEqual(manifest.overlayElements.map((e) => e.id), ["alerts", "alerts-stage", "hype-train", "session-counter"]);
  for (const id of ["hype-train", "session-counter"]) {
    const el = manifest.overlayElements.find((e) => e.id === id);
    assert.deepEqual(el.options.slice(-2).map((o) => o.id), ["animQuality", "animCalm"]);
    const engineOpts = fakeCtx({}).overlay?.animateOptions?.();
    if (engineOpts) assert.deepEqual(el.options.slice(-2), engineOpts);
  }
  const { ctx } = world({ locale: "en" });
  assert.equal(mod.overlayElements["hype-train"](ctx, { lang: "en" }).url, "/m/ev/gauge/hype?lang=en");
  const page = await mod.routes["gauge/:slug"](new Request("https://site.example.org/m/ev/gauge/session?opt-count=bits&ov-demo=1"), Object.assign(ctx, { params: { slug: "session" } }));
  const html = await page.text();
  assert.ok(html.includes("CuriosaAnimate") || html.includes("Curiosa"));
  assert.match(page.headers.get("content-security-policy"), /connect-src 'self'/);
  assert.ok(html.includes("/m/ev/gauge-state/session?opt-count=bits&amp;demo=1") || html.includes("/m/ev/gauge-state/session?opt-count=bits&demo=1"));
  const r = await mod.routes["gauge-state/:slug"](new Request("https://site.example.org/m/ev/gauge-state/session?opt-count=bits&demo=1"), Object.assign(ctx, { params: { slug: "session" } }));
  const j = await r.json();
  assert.equal(j.state.genre, "counter"); assert.equal(typeof j.now, "number");
  const none = await mod.routes["gauge-state/:slug"](new Request("https://site.example.org/m/ev/gauge-state/nope"), Object.assign(ctx, { params: { slug: "nope" } }));
  assert.equal(none.status, 404);
});
