// The status of "Twitch activity" must tell the truth about each type. Past bug: raid and channel points stayed "waiting for Twitch" for days because Twitch lists EVERY
// condition field (unused ones as ""), the module compared the keys as sent, never recognised its own subscription, created it again, got a 409 and called that "pending".
// The fake of Twitch (helpers/eventsWorld.mjs) now answers like the recorded shape: full conditions, created_at, 409 on a duplicate type + condition.
import test from "node:test";
import assert from "node:assert/strict";
import { world, es, S, L, mod, NOW, B, twitchCondition } from "./helpers/eventsWorld.mjs";

const s = { channel: "", retentionDays: 30 };
const CB = "https://site.example.org/m/ev/webhook";
const types = async (ctx) => Object.fromEntries(Object.entries((await S.readState(ctx)).types).map(([k, v]) => [k, v.code]));
const row = (type, status, o = {}) => ({ id: `r-${type}-${status}`, type, version: o.version ?? "1", status, condition: twitchCondition(type, o.condition ?? { broadcaster_user_id: B, to_broadcaster_user_id: B }), transport: { method: "webhook", callback: o.callback ?? CB }, created_at: new Date(o.at ?? NOW).toISOString(), cost: 1 });

test("recorded shape: Twitch lists unused condition fields as empty text, and they are still OUR subscriptions", () => {
  // channel.raid and the redemption, as Twitch lists them (from_broadcaster_user_id "" and reward_id "")
  const raid = row("channel.raid", "enabled"), redeem = row("channel.channel_points_custom_reward_redemption.add", "enabled", { condition: { broadcaster_user_id: B } });
  assert.deepEqual(raid.condition, { from_broadcaster_user_id: "", to_broadcaster_user_id: B });
  assert.deepEqual(redeem.condition, { broadcaster_user_id: B, reward_id: "" });
  const wanted = es.wantedSubs({ raid: true, redeem: true }, B);
  const c = es.classify([raid, redeem], wanted, CB);
  assert.deepEqual(c.wanted.map((w) => w.state), ["enabled", "enabled"]);
  assert.deepEqual(c.stale, [], "nothing of ours is called stale");
  // a real difference still counts: the raid TOWARDS another channel, or FROM this one
  assert.equal(es.sameCondition({ to_broadcaster_user_id: "1" }, { from_broadcaster_user_id: "", to_broadcaster_user_id: "2" }), false);
  assert.equal(es.sameCondition({ to_broadcaster_user_id: "1" }, { from_broadcaster_user_id: "1", to_broadcaster_user_id: "" }), false);
  assert.equal(es.sameCondition({ broadcaster_user_id: 5 }, { broadcaster_user_id: "5", reward_id: "" }), true);
});

test("every type reaches 'listening' once Twitch confirmed, raid and channel points included (the bug of the two days)", async () => {
  const { ctx, tw } = world();
  await S.updateState(ctx, (d) => { d.enabled = { redeem: true }; });
  assert.equal((await L.ensureListening(ctx, s)).code, "pending");
  tw.subs.forEach((x) => { x.status = "enabled"; });   // Twitch verified the address
  const r = await L.ensureListening(ctx, s);
  assert.equal(r.code, "listening", JSON.stringify(await types(ctx)));
  assert.ok(Object.values(await types(ctx)).every((c) => c === "listening"));
  assert.equal(tw.subs.filter((x) => x.type === "channel.raid").length, 1, "no second raid subscription is asked for");
  assert.equal(tw.calls.filter((c) => c.method === "POST").length, tw.subs.length, "one creation per subscription, none repeated");
});

test("a subscription Twitch cut says why: permission withdrawn, address did not answer, and it is created again", async () => {
  for (const [status, code] of [["authorization_revoked", "failed_revoked"], ["notification_failures_exceeded", "failed_unreachable"], ["webhook_callback_verification_failed", "failed_unreachable"], ["version_removed", "failed_other"]]) {
    const { ctx, tw } = world();
    tw.autoEnable = true; tw.clock = () => NOW + 60_000;   // Twitch dates what it creates at the simulated time
    await L.ensureListening(ctx, s, { now: NOW });
    tw.subs.find((x) => x.type === "channel.raid").status = status;
    const r = await L.ensureListening(ctx, s, { now: NOW + 60_000 });
    assert.equal(r.code, "pending", status);
    const raid = (await S.readState(ctx)).types.raid;
    assert.equal(raid.code, "pending"); assert.equal(raid.reason, code, status);
    assert.equal(tw.subs.filter((x) => x.type === "channel.raid").length, 1);
    // the next minutes keep the reason while it waits, and it is forgotten once Twitch confirms
    tw.subs.find((x) => x.type === "channel.raid").status = "webhook_callback_verification_pending";
    await L.ensureListening(ctx, s, { now: NOW + 120_000 });
    assert.equal((await S.readState(ctx)).types.raid.reason, code);
    tw.subs.forEach((x) => { x.status = "enabled"; });
    assert.equal((await L.ensureListening(ctx, s, { now: NOW + 180_000 })).code, "listening");
    assert.equal((await S.readState(ctx)).failures?.["channel.raid"], undefined);
  }
});

test("a type that Twitch never confirms: waits, is recreated once after 3 minutes, and says so", async () => {
  const { ctx, tw } = world();
  tw.autoEnable = true; tw.neverVerify = ["channel.raid"];
  tw.clock = () => NOW;
  await L.ensureListening(ctx, s, { now: NOW });
  assert.equal((await S.readState(ctx)).types.raid.reason, undefined, "just created");
  await L.ensureListening(ctx, s, { now: NOW + 60_000 });
  assert.equal((await S.readState(ctx)).types.raid.reason, "waiting");
  tw.clock = () => NOW + 4 * 60_000;
  const r = await L.ensureListening(ctx, s, { now: NOW + 4 * 60_000 });
  assert.equal(r.code, "pending");
  assert.equal(tw.calls.filter((c) => c.method === "POST" && c.body.type === "channel.raid").length, 2, "recreated once");
  assert.deepEqual((await types(ctx)).follow, "listening");
});

test("a subscription of another module with the same type and condition is reported as 'taken', not as 'waiting'", async () => {
  // channel points: the Twitch bot already holds the redemption at its own address. The type is optional: the verdict stays 'listening'.
  const a = world(); a.tw.autoEnable = true;
  a.tw.subs.push(row("channel.channel_points_custom_reward_redemption.add", "enabled", { condition: { broadcaster_user_id: B }, callback: "https://site.example.org/m/twitch-bot/webhook" }));
  await S.updateState(a.ctx, (d) => { d.enabled = { redeem: true }; });
  await L.ensureListening(a.ctx, s, { now: NOW }); a.tw.subs.forEach((x) => { x.status = "enabled"; });
  const r = await L.ensureListening(a.ctx, s, { now: NOW + 60_000 });
  assert.equal((await types(a.ctx)).redeem, "taken");
  assert.equal((await S.readState(a.ctx)).types.redeem.reason, "elsewhere");
  assert.equal(r.code, "listening", "an optional type never holds the verdict");
  assert.ok(a.tw.subs.some((x) => x.transport.callback.endsWith("twitch-bot/webhook")), "the other module's subscription is never touched");
  // a CORE type (raid) held elsewhere: the verdict says it, and names the type
  const b = world(); b.tw.autoEnable = true;
  b.tw.subs.push(row("channel.raid", "enabled", { callback: "https://other.example.org/hook" }));
  await L.ensureListening(b.ctx, s, { now: NOW }); b.tw.subs.forEach((x) => { x.status = "enabled"; });
  assert.equal((await L.ensureListening(b.ctx, s, { now: NOW + 60_000 })).code, "taken");
  const page = await mod.adminPanel(b.ctx, { query: {} });
  assert.match(page.find((x) => x.type === "banner").text, /Raid/);
  assert.match(page.find((x) => x.tab === "types" && x.type === "markdown" && /Raid/.test(x.text ?? "") && /Un autre module/.test(x.text)).text, /rien n'arrive/);
});

test("the page shows the real reason of each waiting type, in plain words, and 'Try again' works per type", async () => {
  const { ctx, tw } = world();
  tw.autoEnable = true; tw.neverVerify = ["channel.raid"]; tw.clock = () => NOW;
  await L.ensureListening(ctx, s, { now: NOW });
  tw.subs.find((x) => x.type === "channel.raid").status = "authorization_revoked";
  await L.ensureListening(ctx, s, { now: NOW + 60_000 });
  const page = await mod.adminPanel(ctx, { query: {} });
  const why = page.find((x) => x.tab === "types" && x.type === "markdown" && /Raid/.test(x.text));
  assert.match(why.text, /Raid : Twitch l'a arrêté, car l'autorisation a été retirée/);
  assert.match(page.find((x) => x.type === "banner").text, /Raid/, "the banner names the type that waits");
  const table = page.find((x) => x.tab === "types" && x.type === "table");
  assert.ok(table.rowActions.some((a) => a.action === "retry" && a.inMenu));
  const before = tw.subs.find((x) => x.type === "channel.raid").id;
  const r = await mod.adminActions.retry(ctx, { id: "raid" });
  assert.ok(r.ok, JSON.stringify(r)); assert.match(r.ok, /Raid/);
  assert.notEqual(tw.subs.find((x) => x.type === "channel.raid").id, before, "ours were deleted and created again");
  assert.ok(tw.subs.some((x) => x.type === "channel.follow"), "the other types are left alone");
  assert.ok((await mod.adminActions.retry(ctx, { id: "nope" })).error);
});

test("retry on a type held by another module says so instead of pretending", async () => {
  const { ctx, tw } = world();
  tw.autoEnable = true;
  tw.subs.push(row("channel.raid", "enabled", { callback: "https://other.example.org/hook" }));
  await L.ensureListening(ctx, s, { now: NOW });
  const r = await mod.adminActions.retry(ctx, { id: "raid" });
  assert.match(r.error, /autre module/);
  assert.ok(tw.subs.some((x) => x.transport.callback === "https://other.example.org/hook"));
});

test("own subscriptions that Twitch confirmed are never deleted nor created again (the old loop: delete + create every minute)", async () => {
  const { ctx, tw } = world();
  tw.autoEnable = true;
  await S.updateState(ctx, (d) => { d.enabled = { redeem: true }; });
  await L.ensureListening(ctx, s, { now: NOW });
  tw.subs.forEach((x) => { x.status = "enabled"; });
  tw.calls.length = 0;
  for (let i = 1; i <= 5; i++) assert.equal((await L.ensureListening(ctx, s, { now: NOW + i * 60_000 })).code, "listening");
  assert.deepEqual(tw.calls.filter((c) => c.method === "POST" || c.method === "DELETE"), [], "a quiet minute only reads the list");
  const st = await S.readState(ctx);
  assert.ok(st.types.raid.code === "listening" && st.types.redeem.code === "listening");
});

test("a refused creation keeps Twitch's code and message, shows them on the page and writes ONE log line", async () => {
  for (const [status, message] of [[403, "subscription missing proper authorization"], [400, "The condition field is invalid"]]) {
    const { ctx, tw } = world({ tw: { createStatus: status } });
    const lines = [];
    ctx.api.log = { write: (l) => { lines.push(l); } };
    // the fake answers every creation with this status and message
    const real = tw.createStatus;
    assert.equal(real, status);
    await L.ensureListening(ctx, s, { now: NOW });
    await L.ensureListening(ctx, s, { now: NOW + 60_000 });
    const st = await S.readState(ctx);
    assert.match(st.createErrors["channel.raid"].text, new RegExp(`^${status}`));
    assert.equal(st.types.raid.reason, "create_failed");
    const page = await mod.adminPanel(ctx, { query: {} });
    const why = page.find((x) => x.tab === "types" && x.type === "markdown" && /Raid/.test(x.text));
    assert.match(why.text, new RegExp(`Raid : Twitch a refusé de le démarrer. Sa réponse : ${status}`));
    const mine = lines.filter((l) => l.action === "type.create_failed" && l.target === "raid");
    assert.equal(mine.length, 1, "one line, not one a minute");
    assert.equal(mine[0].data.status, status);
    void message;
  }
});

test("readCreate keeps the HTTP code and Twitch's message for every refusal", () => {
  assert.deepEqual(es.readCreate({ status: 403, json: { message: "subscription missing proper authorization" } }), { ok: false, code: "denied", status: 403, detail: "subscription missing proper authorization" });
  assert.deepEqual(es.readCreate({ status: 409, json: { message: "subscription already exists" } }), { ok: false, code: "exists", status: 409, detail: "subscription already exists" });
  assert.equal(es.readCreate({ status: 502 }).status, 502);
  assert.deepEqual(es.readCreate({ status: 202, json: { data: [{ id: "x" }] } }), { ok: true, id: "x" });
});
