import test from "node:test";
import assert from "node:assert/strict";
import { world, deliver, EV, TYPES, NOW, es, S, W, L, P, A, mod, manifest } from "./helpers/eventsWorld.mjs";

const lines = async (ctx) => (await S.recent(ctx, 1000));

test("normalise: each event keeps public data only, cleaned and bounded", () => {
  const r = es.normalise("channel.subscription.message", EV.resub, new Date(NOW).toISOString());
  assert.deepEqual({ kind: r.kind, name: r.name, tier: r.tier, months: r.months, streak: r.streak }, { kind: "resub", name: "Lune_Douce", tier: "1", months: 12, streak: 6 });
  assert.equal(r.text, "Thank you <b>all</b>", "control and direction characters are removed");
  const g = es.normalise("channel.subscription.gift", EV.anonGift, "2026-11-12T20:00:00Z");
  assert.equal(g.anonymous, true); assert.equal(g.name, undefined); assert.equal(g.count, 5);
  assert.equal(es.normalise("channel.subscription.gift", { ...EV.gift, total: -3 }, "2026-11-12T20:00:00Z"), null, "an impossible count is refused");
  assert.equal(es.normalise("channel.cheer", { ...EV.cheer, bits: 0 }, "2026-11-12T20:00:00Z"), null);
  const e = es.normalise("channel.follow", { ...EV.follow, user_name: "x".repeat(500), email: "a@b.c", token: "secret" }, "2026-11-12T20:00:00Z");
  assert.equal(e.name.length, 60); assert.equal(e.email, undefined); assert.equal(e.token, undefined);
  assert.equal(es.normalise("channel.follow", EV.follow, "x").at, Date.parse("2026-11-12T19:59:00Z"), "the follow date is the event's own");
  assert.equal(es.normalise("stream.online", EV.online, "x").streamType, "live");
  assert.equal(es.normalise("channel.raid", EV.raid, "2026-11-12T20:00:00Z").viewers, 120);
  assert.equal(es.normalise("channel.unknown", {}, "x"), null);
});

test("subscriptions wanted: conditions and versions follow the Twitch reference", () => {
  const all = Object.fromEntries(es.TYPE_IDS.map((i) => [i, true]));
  const w = es.wantedSubs(all, "100");
  const by = Object.fromEntries(w.map((x) => [x.type, x]));
  assert.deepEqual(by["channel.follow"].condition, { broadcaster_user_id: "100", moderator_user_id: "100" }); assert.equal(by["channel.follow"].version, "2");
  assert.deepEqual(by["channel.raid"].condition, { to_broadcaster_user_id: "100" });
  assert.equal(by["channel.hype_train.end"].version, "2");
  assert.equal(w.filter((x) => x.typeId === "hype").length, 3);
  assert.deepEqual(es.scopesFor({ raid: true, online: true }), []);
  assert.deepEqual(es.scopesFor({ cheer: true, hype: true }), ["bits:read", "channel:read:hype_train"]);
});

test("webhook: signature, stale timestamp, replay protection, bad requests", async () => {
  const { ctx } = world();
  await S.ensureSecret(ctx);
  assert.equal((await deliver(ctx, TYPES.follow, EV.follow, { badSig: true })).status, 403);
  assert.equal((await deliver(ctx, TYPES.follow, EV.follow, { at: NOW - 11 * 60_000 })).status, 403, "older than 10 minutes: refused");
  assert.equal((await deliver(ctx, TYPES.follow, EV.follow, { at: NOW + 11 * 60_000 })).status, 403, "dated in the future: refused");
  assert.equal((await deliver(ctx, TYPES.follow, EV.follow, { secret: "another-secret-value" })).status, 403);
  assert.equal((await lines(ctx)).length, 0);
  const ch = await deliver(ctx, TYPES.follow, "abc123", { messageType: "verification" });
  assert.equal(ch.status, 204, "an unknown message type is ignored");
  const v = await deliver(ctx, TYPES.follow, "challenge-xyz", { messageType: "webhook_callback_verification" });
  assert.deepEqual([v.status, v.text], [200, "challenge-xyz"]);
  assert.equal((await W.handle(new Request("https://x/m/ev/webhook"), ctx)).response.status, 405);
  const noSecret = world().ctx;
  assert.equal((await deliver(noSecret, TYPES.follow, EV.follow, { secret: "whatever-it-is-secret" })).status, 404, "no secret yet: 404");
});

test("webhook: every type is journalled once, with a durable idempotent key", async () => {
  const { ctx } = world();
  await S.ensureSecret(ctx);
  for (const [k, ev] of Object.entries({ follow: EV.follow, sub: EV.sub, resub: EV.resub, gift: EV.gift, cheer: EV.cheer, raid: EV.raid, online: EV.online, offline: EV.offline })) assert.equal((await deliver(ctx, TYPES[k], ev)).status, 204, k);
  await deliver(ctx, "channel.hype_train.begin", EV.hypeBegin, { version: "2" });
  await deliver(ctx, "channel.hype_train.end", EV.hypeEnd, { version: "2" });
  const kinds = (await lines(ctx)).map((l) => l.kind).sort();
  assert.deepEqual(kinds, ["cheer", "follow", "gift", "hype_begin", "hype_end", "offline", "online", "raid", "resub", "sub"]);
  // the same message twice: once; and after a "restart" (memory cleared) still once, because the journal is the memory
  const first = await deliver(ctx, TYPES.follow, EV.follow, { id: "dup-1" });
  const again = await deliver(ctx, TYPES.follow, EV.follow, { id: "dup-1" });
  S.resetMemory();
  const afterRestart = await deliver(ctx, TYPES.follow, EV.follow, { id: "dup-1" });
  assert.deepEqual([first.status, again.status, afterRestart.status], [204, 204, 204]);
  assert.equal((await lines(ctx)).filter((l) => l.id === "dup-1").length, 1);
  assert.ok((await S.recent(ctx, 1))[0].receivedAt > 0);
  assert.equal((await S.readState(ctx)).lastEventAt, NOW);
});

test("webhook: a disabled type is acknowledged but not stored; hype progress only on a new level", async () => {
  const { ctx } = world();
  await S.ensureSecret(ctx);
  await S.updateState(ctx, (d) => { d.enabled = { cheer: false }; });
  assert.equal((await deliver(ctx, TYPES.cheer, EV.cheer)).status, 204);
  assert.equal((await lines(ctx)).length, 0);
  await deliver(ctx, "channel.hype_train.begin", EV.hypeBegin, { version: "2" });
  for (const lv of [1, 1, 2, 2, 3]) await deliver(ctx, "channel.hype_train.progress", EV.hypeProgress(lv), { version: "2" });
  assert.deepEqual((await lines(ctx)).filter((l) => l.kind === "hype_progress").map((l) => l.level).sort(), [2, 3]);
});

test("webhook: a gifted sub is flagged so that the gift line is the one to announce", async () => {
  const { ctx } = world();
  await S.ensureSecret(ctx);
  await deliver(ctx, TYPES.sub, EV.giftedSub);
  const items = await P.topicItems(ctx, {}, NOW + 5000);
  assert.equal(items[0].gifted, true);
});

test("webhook: rate limit answers 429 and refused requests are counted", async () => {
  const { ctx } = world();
  await S.ensureSecret(ctx);
  for (let i = 0; i < W.LIMITS.badPerMinute; i++) await deliver(ctx, TYPES.follow, EV.follow, { badSig: true });
  const r = await deliver(ctx, TYPES.follow, EV.follow);
  assert.equal(r.status, 429, "after 30 refused requests a minute, even a good one waits");
  const later = await deliver(ctx, TYPES.follow, EV.follow, { now: NOW + 61_000, at: NOW + 61_000 });
  assert.equal(later.status, 204);
});

test("a storage failure answers 503 with Retry-After and the message is NOT taken for a duplicate when Twitch retries", async () => {
  const { ctx } = world();
  await S.ensureSecret(ctx);
  const add = ctx.api.store.add;
  ctx.api.store.add = async (c, ...r) => { if (c === "events") throw new Error("disk full"); return add(c, ...r); };
  const bad = await deliver(ctx, TYPES.follow, EV.follow, { id: "retry-1" });
  assert.equal(bad.status, 503);
  ctx.api.store.add = add;
  const good = await deliver(ctx, TYPES.follow, EV.follow, { id: "retry-1" });
  assert.equal(good.status, 204);
  assert.equal((await lines(ctx)).filter((l) => l.id === "retry-1").length, 1);
});

test("burst: 200 simultaneous deliveries, all stored once", async () => {
  const { ctx } = world();
  await S.ensureSecret(ctx);
  await Promise.all(Array.from({ length: 200 }, (_, i) => deliver(ctx, TYPES.follow, { ...EV.follow, user_name: `fan_${i}` }, { id: `b${i % 150}` })));
  assert.equal((await lines(ctx)).length, 150);
});

test("topic: items are plain, newest first, flagged tests and replays, public data only", async () => {
  const { ctx } = world();
  await S.ensureSecret(ctx);
  await deliver(ctx, TYPES.cheer, EV.cheer, { id: "c1" });
  const t = await P.sendTest(ctx, "raid", { now: NOW });
  assert.equal(t.ok, true);
  const rep = await P.replay(ctx, "c1", { now: NOW + 10_000 });
  const items = await P.topicItems(ctx, { limit: 10 }, NOW + 20_000);
  assert.deepEqual(items.map((i) => i.type), ["cheer", "raid", "cheer"]);
  assert.equal(items[0].replay, true); assert.equal(items[0].of, "c1"); assert.equal(items[0].amount, 500);
  assert.equal(items[1].test, true); assert.equal(items[2].test, false);
  assert.match(items[0].at, /^\d{4}-\d{2}-\d{2}T/);
  for (const i of items) for (const [k, val] of Object.entries(i)) assert.ok(["string", "number", "boolean"].includes(typeof val) || Array.isArray(val), k);
  assert.ok(!JSON.stringify(items).match(/secret|token|email/i));
  assert.equal(rep.ok, true);
  assert.equal((await P.topicItems(ctx, { limit: 1 }, NOW + 20_000)).length, 1);
  assert.equal((await P.topicItems(ctx, { from: new Date(NOW + 5000) }, NOW + 20_000)).length, 1, "period filter");
});

test("replay: de-bounced, rate limited, unknown line refused; a double click sends one alert", async () => {
  const { ctx } = world();
  await S.ensureSecret(ctx);
  await deliver(ctx, TYPES.follow, EV.follow, { id: "f1" });
  const a = await P.replay(ctx, "f1", { now: NOW }), b = await P.replay(ctx, "f1", { now: NOW + 500 });
  assert.equal(b.again, true); assert.equal(a.id, b.id);
  assert.equal((await lines(ctx)).filter((l) => l.source === "replay").length, 1);
  assert.deepEqual(await P.replay(ctx, "nope", { now: NOW }), { ok: false, code: "unknown" });
  let rate = 0;
  for (let i = 0; i < 15; i++) { const r = await P.replay(ctx, "f1", { now: NOW + 10_000 + i * 4000 - (i > 10 ? 0 : 0) }); if (!r.ok) rate++; }
  assert.ok(rate > 0, "more than 10 replays in a minute: refused");
  const t = world().ctx; let tr = 0;
  for (let i = 0; i < 25; i++) if (!(await P.sendTest(t, "follow", { now: NOW })).ok) tr++;
  assert.equal(tr, 5);
});

test("tests work even when the type is switched off, and hype sends two lines", async () => {
  const { ctx } = world();
  await S.updateState(ctx, (d) => { d.enabled = { hype: false }; });
  assert.deepEqual(P.testKinds("hype"), ["hype_begin", "hype_end"]);
  assert.equal((await P.sendTest(ctx, "hype")).ids.length, 2);
  assert.deepEqual(await P.sendTest(ctx, "nothing"), { ok: false, code: "unknown" });
});

test("purge: retention, test lines after a day, size cap", async () => {
  const { ctx } = world();
  await S.ensureSecret(ctx);
  await S.record(ctx, "old", { kind: "follow", name: "Camille", at: NOW - 40 * 86_400_000 }, { now: NOW - 40 * 86_400_000 });
  await S.record(ctx, "new", { kind: "follow", name: "Camille", at: NOW }, { now: NOW });
  await S.record(ctx, "t-old", { kind: "follow", name: "Camille", at: NOW }, { now: NOW - 2 * 86_400_000, source: "test" });
  assert.equal(await S.purge(ctx, { retentionDays: 30, now: NOW }), 2);
  assert.deepEqual((await lines(ctx)).map((l) => l.id), ["new"]);
  assert.equal(await S.purge(ctx, { retentionDays: 30, now: NOW }), 0);
});

test("listening: creates every wanted subscription, repairs the cut ones, drops the stale, asks for missing permissions", async () => {
  const { ctx, tw } = world({ tw: { scopes: ["channel:read:subscriptions", "moderator:read:followers"] } });
  const s = { channel: "", retentionDays: 30 };
  const r = await L.ensureListening(ctx, s);
  assert.equal(r.code, "need_more", "bits and hype permissions are missing");
  assert.deepEqual(tw.wants.at(-1).scopes, ["bits:read", "channel:read:hype_train", "channel:read:subscriptions", "moderator:read:followers"]);
  assert.equal(tw.wants.at(-1).consumer, "ev");
  const types = tw.subs.map((x) => x.type).sort();
  assert.ok(types.includes("channel.follow") && types.includes("channel.raid") && types.includes("stream.online"));
  assert.ok(!types.includes("channel.cheer") && !types.some((x) => x.startsWith("channel.hype")), "types lacking a permission are not subscribed");
  assert.ok(tw.subs.every((x) => x.transport.callback === "https://site.example.org/m/ev/webhook"));
  const st = await S.readState(ctx);
  assert.equal(st.types.cheer.code, "need_more"); assert.equal(st.types.follow.code, "pending");
  assert.deepEqual(st.listen.missing, ["bits:read", "channel:read:hype_train"]);
  // Twitch verified the address: all become enabled; the user grants the rest; stale and failed ones are repaired
  tw.subs.forEach((x) => { x.status = "enabled"; });
  tw.subs.push({ id: "old", type: "channel.follow", version: "2", status: "enabled", condition: { broadcaster_user_id: "999", moderator_user_id: "999" }, transport: { method: "webhook", callback: "https://site.example.org/m/ev/webhook" } });
  tw.subs.push({ id: "other", type: "channel.chat.message", version: "1", status: "enabled", condition: {}, transport: { method: "webhook", callback: "https://site.example.org/m/twitch-bot/webhook" } });
  tw.subs.find((x) => x.type === "channel.raid").status = "notification_failures_exceeded";
  tw.scopes.push("bits:read", "channel:read:hype_train");
  const r2 = await L.ensureListening(ctx, s);
  assert.ok(!tw.subs.some((x) => x.id === "old"), "stale subscription removed");
  assert.ok(tw.subs.some((x) => x.id === "other"), "another module's subscription is never touched");
  assert.equal(tw.subs.filter((x) => x.type === "channel.raid").length, 1);
  assert.ok(tw.subs.some((x) => x.type === "channel.cheer"));
  assert.equal(r2.code, "pending");
  tw.subs.forEach((x) => { if (x.id !== "other") x.status = "enabled"; });
  assert.equal((await L.ensureListening(ctx, s)).code, "listening");
  assert.equal(tw.subs.filter((x) => x.type.startsWith("channel.hype")).length, 3);
});

test("listening: switching a type off removes its subscription; renew starts again with a new secret", async () => {
  const { ctx, tw } = world();
  const s = { channel: "", retentionDays: 30 };
  tw.autoEnable = true;
  assert.equal((await L.ensureListening(ctx, s)).code, "pending", "just created: Twitch has not verified the address yet");
  assert.equal((await L.ensureListening(ctx, s)).code, "listening");
  assert.equal(tw.subs.length, 11);
  await S.updateState(ctx, (d) => { d.enabled = { hype: false, redeem: false }; });
  await L.ensureListening(ctx, s);
  assert.equal(tw.subs.length, 8);
  const before = (await S.readState(ctx)).secret;
  await L.ensureListening(ctx, s, { renew: true });
  assert.notEqual((await S.readState(ctx)).secret, before);
  assert.equal(tw.lastSecret, (await S.readState(ctx)).secret, "Twitch got the new secret");
  assert.equal(tw.subs.length, 8);
});

test("listening: private site, expired token, Twitch down, refusal, nothing switched on", async () => {
  assert.equal((await L.ensureListening(world({ siteUrl: "http://localhost:3000" }).ctx, { channel: "" })).code, "site_private");
  assert.equal((await L.ensureListening(world({ tw: { status: "reconnect" } }).ctx, { channel: "" })).code, "need_reconnect");
  assert.equal((await L.ensureListening(world({ tw: { listDown: true } }).ctx, { channel: "" })).code, "twitch_down");
  const w = world({ tw: { createStatus: 400 } });
  assert.equal((await L.ensureListening(w.ctx, { channel: "" })).code, "refused");
  const n = world();
  await S.updateState(n.ctx, (d) => { d.enabled = Object.fromEntries(es.TYPE_IDS.map((i) => [i, false])); });
  assert.equal((await L.ensureListening(n.ctx, { channel: "" })).code, "nothing_on");
});

test("revocation: noted, and the listening is repaired", async () => {
  const { ctx, tw } = world();
  await S.ensureSecret(ctx);
  await deliver(ctx, "channel.follow", "authorization_revoked", { messageType: "revocation" });
  const st = await S.readState(ctx);
  assert.equal(st.revoked.status, "authorization_revoked");
  assert.ok(tw.subs.length > 0, "subscriptions were recreated");
});

test("admin page: journal table with search and filters, types with switches, status line", async () => {
  const { ctx } = world({ alerts: true });
  await S.ensureSecret(ctx);
  await deliver(ctx, TYPES.resub, EV.resub);
  const blocks = await mod.adminPanel(ctx, { query: {} });
  const table = blocks.find((b) => b.type === "table" && !b.tab);
  assert.equal(table.searchable, true); assert.ok(table.filters.length === 1);
  assert.equal(table.rows[0][1].badge, "accent"); assert.match(table.rows[0][1].text, /Réabonnement/);
  assert.match(table.rows[0][3].text, /12 mois/);
  const types = blocks.find((b) => b.tab === "types" && b.type === "table");
  assert.equal(types.rows.length, es.TYPES.length); assert.ok(types.rows.every((r) => r[3].switch));
  assert.equal(blocks.find((b) => b.type === "links")?.items[0].href, "/admin/instances/alerts");
  assert.ok(blocks.some((b) => b.type === "banner"));
});

test("admin actions: switch says the state wanted, test, replay, remove", async () => {
  const { ctx, tw } = world({ tw: { scopes: ["channel:read:subscriptions"] } });
  const off = await mod.adminActions.setEnabled(ctx, { id: "cheer", enabled: "0" });
  assert.ok(off.ok); assert.equal(S.enabledOf(await S.readState(ctx)).cheer, false);
  await mod.adminActions.setEnabled(ctx, { id: "cheer", enabled: "0" });
  assert.equal(S.enabledOf(await S.readState(ctx)).cheer, false, "a repeated press changes nothing");
  const on = await mod.adminActions.setEnabled(ctx, { id: "cheer", enabled: "1" });
  assert.match(on.ok, /accord de Twitch/);
  assert.ok(tw.wants.at(-1).scopes.includes("bits:read"));
  assert.ok((await mod.adminActions.setEnabled(ctx, { id: "zzz", enabled: "1" })).error);
  assert.ok((await mod.adminActions.test(ctx, { id: "follow" })).ok);
  const id = (await S.recent(ctx, 1))[0].id;
  assert.ok((await mod.adminActions.replay(ctx, { id })).ok);
  assert.ok((await mod.adminActions.replay(ctx, { id: "x" })).error);
  assert.ok((await mod.adminActions.remove(ctx, { id })).ok);
  assert.ok((await mod.adminActions.remove(ctx, { id })).error);
});

test("MCP tools: read the journal, status, bounded replay", async () => {
  const { ctx } = world();
  await S.ensureSecret(ctx);
  await deliver(ctx, TYPES.cheer, EV.cheer, { id: "c9" });
  await P.sendTest(ctx, "follow");
  const list = await mod.mcp.twitch_events_list(ctx, { limit: 5 });
  assert.deepEqual(list.map((i) => i.type), ["cheer"], "tests are left out by default");
  assert.equal((await mod.mcp.twitch_events_list(ctx, { includeTests: true })).length, 2);
  assert.equal((await mod.mcp.twitch_events_list(ctx, { type: "raid" })).length, 0);
  const status = await mod.mcp.twitch_events_status(ctx);
  assert.equal(status.types.length, 10); assert.equal(status.journalLines, 2);
  assert.ok(!JSON.stringify(status).match(/secret/i));
  assert.equal((await mod.mcp.twitch_event_replay(ctx, { id: "c9" })).ok, true);
  assert.equal((await mod.mcp.twitch_event_replay(ctx, { testType: "raid" })).ok, true);
  await assert.rejects(mod.mcp.twitch_event_replay(ctx, {}), (e) => e.expose === true);
  await assert.rejects(mod.mcp.twitch_event_replay(ctx, { id: "nope" }), (e) => e.expose === true);
  const names = manifest.mcp.map((m) => m.name);
  assert.deepEqual(names, Object.keys(mod.mcp));
  assert.ok(manifest.mcp.filter((m) => !m.readOnly).every((m) => m.default === false && !m.destructive));
});

test("instance deletion removes our subscriptions and permission requests, nothing else", async () => {
  const { ctx, tw } = world();
  tw.autoEnable = true;
  await L.ensureListening(ctx, { channel: "" });
  tw.subs.push({ id: "bot", type: "channel.chat.message", status: "enabled", condition: {}, transport: { method: "webhook", callback: "https://site.example.org/m/twitch-bot/webhook" } });
  await mod.hooks.onInstanceDelete(ctx);
  assert.deepEqual(tw.subs.map((x) => x.id), ["bot"]);
  assert.deepEqual(tw.wants.at(-1).scopes, []);
});

test("admin page passes the page ergonomics (R3 R4 R9 R10 R11 R14 R15 R17 R22), empty and filled, both languages, with errors", async () => {
  const { assertAdminPageErgonomics } = await import("./helpers/ergonomics.mjs");
  for (const locale of ["fr", "en"]) {
    const { ctx } = world({ locale, alerts: true });
    await S.ensureSecret(ctx);
    const errors = [];
    for (const [a, v] of [["setEnabled", { id: "zzz" }], ["replay", { id: "zzz" }], ["remove", { id: "zzz" }], ["test", { id: "zzz" }]]) errors.push((await mod.adminActions[a](ctx, v)).error);
    assertAdminPageErgonomics(await mod.adminPanel(ctx, { query: {} }), { errors });
    for (const k of ["follow", "sub", "gift", "cheer", "raid", "online"]) await deliver(ctx, TYPES[k], EV[k === "sub" ? "sub" : k]);
    await P.sendTest(ctx, "hype");
    assertAdminPageErgonomics(await mod.adminPanel(ctx, { query: {} }));
    const bad = world({ locale, tw: { scopes: [] }, siteUrl: "http://localhost" });
    assertAdminPageErgonomics(await mod.adminPanel(bad.ctx, { query: {} }));
  }
});
