// Phase 2, robustness: catch-up after a gap (followers with their date, subscribers against the names we know), no duplicates with what the webhook already delivered,
// the one-minute watch, silence while live, the e-mail to the owner (once per problem, again after a day, once when it is back, never for a fresh install), graceful answers.
import test from "node:test";
import assert from "node:assert/strict";
import { world, deliver, EV, TYPES, NOW, S, L, C, CU, HE, P, mod, manifest } from "./helpers/eventsWorld.mjs";

const MIN = 60_000, HOUR = 3_600_000;
const S0 = { channel: "", retentionDays: 30, silentHours: 3, healthMail: true };
const lines = (ctx) => S.recent(ctx, 1000);
/** Brings the world to "everything works" at `at`. */
async function up(w, at = NOW) {
  w.tw.autoEnable = true;
  await L.ensureListening(w.ctx, S0);               // creates the subscriptions (pending)
  return C.check(w.ctx, S0, { now: at });           // Twitch verified them: listening
}
const fol = (login, at, id = login) => ({ user_id: id, user_login: login, user_name: login, followed_at: new Date(at).toISOString() });

test("a normal minute does nothing more than one check; the first listening learns who subscribes, without inventing a sub", async () => {
  const w = world(); w.tw.subscribers = [{ user_login: "etoile_nord", user_name: "Etoile_Nord", tier: "1000", is_gift: false }];
  const r = await up(w);
  assert.equal(r.code, "listening");
  const st = await S.readState(w.ctx);
  assert.deepEqual(st.subLogins, ["etoile_nord"]); assert.equal(st.okAt, NOW); assert.equal(st.checkedAt, NOW);
  assert.equal((await lines(w.ctx)).length, 0, "nothing invented");
  const calls = w.tw.calls.length;
  await C.check(w.ctx, S0, { now: NOW + MIN });
  assert.equal(w.tw.calls.slice(calls).filter((c) => c.path === "eventsub/subscriptions" && c.method === "GET").length, 1, "one list call a minute");
  assert.equal(w.tw.calls.slice(calls).filter((c) => c.path === "channels/followers" || c.path === "subscriptions").length, 0, "no catch-up without a gap");
  assert.equal(manifest.tabs.length > 0 && mod.tasks.listen.everyMinutes, 1);
});

test("catch-up after the site was away: new followers with their real date, new subscribers once, flagged missed, nothing twice", async () => {
  const w = world(); w.tw.subscribers = [{ user_login: "etoile_nord", user_name: "Etoile_Nord", tier: "1000" }];
  await up(w);
  await S.ensureSecret(w.ctx);
  // before the gap the webhook delivered one follow, and one sub
  await deliver(w.ctx, TYPES.follow, { ...EV.follow, user_login: "known_one", user_name: "Known_One", followed_at: new Date(NOW + 2 * MIN).toISOString() }, { id: "f-known", now: NOW + 2 * MIN, at: NOW + 2 * MIN });
  await deliver(w.ctx, TYPES.sub, { ...EV.sub, user_login: "lune_douce", user_name: "Lune_Douce" }, { id: "s-known", now: NOW + 2 * MIN, at: NOW + 2 * MIN });
  // 20 minutes without any check (restart, update); meanwhile Twitch got new followers and subscribers
  const later = NOW + 25 * MIN;
  w.tw.followers = [fol("camille", NOW + 20 * MIN, "11"), fol("known_one", NOW + 2 * MIN, "12"), fol("old_one", NOW - 3 * HOUR, "13")];
  w.tw.subscribers = [...w.tw.subscribers, { user_login: "lune_douce", user_name: "Lune_Douce", tier: "1000" }, { user_login: "nova_pomme", user_name: "Nova_Pomme", tier: "2000", is_gift: true }];
  const r = await C.check(w.ctx, S0, { now: later });
  assert.equal(r.code, "listening");
  assert.deepEqual([r.caught.follows, r.caught.subs], [1, 1]);
  const all = await lines(w.ctx);
  const missed = all.filter((l) => l.missed);
  assert.deepEqual(missed.map((l) => `${l.kind}:${l.login}`).sort(), ["follow:camille", "sub:nova_pomme"]);
  const follow = missed.find((l) => l.kind === "follow");
  assert.equal(follow.at, NOW + 20 * MIN, "a follower keeps the real date Twitch gives");
  assert.equal(follow.source, "catchup");
  assert.equal(missed.find((l) => l.kind === "sub").gifted, true);
  assert.equal(missed.find((l) => l.kind === "sub").tier, "2");
  assert.ok(!all.some((l) => l.login === "known_one" && l.missed), "already delivered: not added again");
  assert.ok(!all.some((l) => l.login === "lune_douce" && l.missed), "a sub the webhook delivered is known");
  assert.ok(!all.some((l) => l.login === "old_one"), "before the gap: left alone");
  // the topic carries the flag
  const items = await P.topicItems(w.ctx, { limit: 20 }, later + 1000);
  assert.equal(items.filter((i) => i.missed).length, 2);
  // a second pass: no gap any more, nothing more
  await C.check(w.ctx, S0, { now: later + MIN });
  assert.equal((await lines(w.ctx)).filter((l) => l.missed).length, 2);
  // the same gap replayed (a retry) cannot add the same lines
  const again = await CU.catchUp(w.ctx, await L.diagnose(w.ctx, S0, { declare: false }), { since: NOW, now: later });
  assert.deepEqual([again.follows, again.subs], [0, 0]);
  const st = await S.readState(w.ctx);
  assert.equal(st.catchup.follows, 0);
  assert.ok(st.gapSince === undefined);
});

test("catch-up also follows a PROBLEM: the token expires, the listening drops, comes back, and what was missed is looked up from when it was last fine", async () => {
  const w = world(); w.tw.subscribers = [{ user_login: "etoile_nord", user_name: "E", tier: "1000" }];
  await up(w);
  w.tw.status = "reconnect";
  const down = await C.check(w.ctx, S0, { now: NOW + 5 * MIN });
  assert.equal(down.code, "need_reconnect");
  assert.equal((await S.readState(w.ctx)).gapSince, NOW, "the gap starts at the last time all was fine");
  w.tw.followers = [fol("camille", NOW + 3 * MIN, "21")];
  await C.check(w.ctx, S0, { now: NOW + 30 * MIN });                       // still down
  assert.equal((await lines(w.ctx)).length, 0);
  w.tw.status = "ok";
  const back = await C.check(w.ctx, S0, { now: NOW + 40 * MIN });
  assert.equal(back.code, "listening"); assert.equal(back.caught.follows, 1);
  assert.equal((await lines(w.ctx))[0].login, "camille");
});

test("catch-up is bounded and polite: no permission, Twitch not answering, and a big channel do not break the check", async () => {
  const w = world({ tw: { scopes: ["channel:read:subscriptions"] } });
  await up(w);
  const d = await L.diagnose(w.ctx, S0, { declare: false });
  const r = await CU.catchUp(w.ctx, d, { since: NOW - HOUR, now: NOW + 10 * MIN });
  assert.ok(r.skipped.includes("follow:scope"));
  const w2 = world(); await up(w2); w2.tw.helixDown = true;
  const r2 = await CU.catchUp(w2.ctx, await L.diagnose(w2.ctx, S0, { declare: false }), { since: NOW - HOUR, now: NOW + 10 * MIN });
  assert.deepEqual([r2.follows, r2.subs], [0, 0]); assert.ok(r2.skipped.length >= 1);
  const w3 = world(); await up(w3);
  w3.tw.followers = Array.from({ length: 120 }, (_, i) => fol(`fan_${i}`, NOW + 5 * MIN + i * 1000, `${i}`));
  const r3 = await CU.catchUp(w3.ctx, await L.diagnose(w3.ctx, S0, { declare: false }), { since: NOW, now: NOW + 10 * MIN });
  assert.equal(r3.follows, CU.LIMITS.lines, "at most 50 lines a gap");
});

test("silence while live: said once the stream has been quiet for the chosen hours; never when offline or switched off", () => {
  const live = { liveSince: NOW, lastEventAt: NOW + HOUR };
  assert.equal(HE.silent(live, { silentHours: 3 }, NOW + 3 * HOUR), false);
  assert.equal(HE.silent(live, { silentHours: 3 }, NOW + 4 * HOUR + 1), true);
  assert.equal(HE.silent({ lastEventAt: 0 }, { silentHours: 3 }, NOW + 99 * HOUR), false, "offline: a quiet night is normal");
  assert.equal(HE.silent(live, { silentHours: 0 }, NOW + 99 * HOUR), false);
  assert.equal(HE.assess({ listen: { code: "listening" }, ...live }, { silentHours: 3 }, NOW + 5 * HOUR), "silent");
  assert.equal(HE.assess({ listen: { code: "need_reconnect" } }, { silentHours: 3 }, NOW), "need_reconnect");
  assert.equal(HE.assess({ listen: { code: "pending" } }, { silentHours: 3 }, NOW), "ok");
});

test("e-mail to the owner: once per problem after the grace delay, again after a day, once when it is back; none for a fresh install or a short blip", async () => {
  const w = world(); await up(w);
  const sent = () => w.ctx.calls.mail;
  w.tw.status = "reconnect";
  await C.check(w.ctx, S0, { now: NOW + MIN });
  assert.equal(sent().length, 0, "the grace delay: nobody is woken for a blip");
  await C.check(w.ctx, S0, { now: NOW + 5 * MIN });
  assert.equal(sent().length, 0);
  await C.check(w.ctx, S0, { now: NOW + 13 * MIN });
  assert.equal(sent().length, 1);
  assert.equal(sent()[0].to, "owner");
  assert.match(sent()[0].subject, /ne reçoit plus/);
  assert.match(sent()[0].text, /La connexion à Twitch a expiré/); assert.match(sent()[0].text, /\/admin\/instances\/id-ev/);
  assert.ok(!/secret|token|jeton/i.test(sent()[0].text), "nothing private in the mail");
  await C.check(w.ctx, S0, { now: NOW + 3 * HOUR });
  assert.equal(sent().length, 1, "once per problem");
  await C.check(w.ctx, S0, { now: NOW + 26 * HOUR });
  assert.equal(sent().length, 2, "again after a day if it is still there");
  w.tw.status = "ok";
  await C.check(w.ctx, S0, { now: NOW + 27 * HOUR });
  assert.equal(sent().length, 3); assert.match(sent()[2].subject, /de nouveau/);
  await C.check(w.ctx, S0, { now: NOW + 28 * HOUR });
  assert.equal(sent().length, 3, "no more mail once it is back");
  assert.equal((await S.readState(w.ctx)).health, undefined);
  // a fresh install that never worked: no mail
  const fresh = world({ tw: { status: "none" } });
  await C.check(fresh.ctx, S0, { now: NOW }); await C.check(fresh.ctx, S0, { now: NOW + 3 * HOUR });
  assert.equal(fresh.ctx.calls.mail.length, 0);
  // a blip of Twitch (down for 20 minutes) stays quiet (30 minute grace), the setting switches the mail off, no mail server is said
  const blip = world(); await up(blip); blip.tw.listDown = true;
  await C.check(blip.ctx, S0, { now: NOW + MIN }); await C.check(blip.ctx, S0, { now: NOW + 20 * MIN });
  assert.equal(blip.ctx.calls.mail.length, 0);
  const off = world(); await up(off); off.tw.status = "reconnect";
  await C.check(off.ctx, { ...S0, healthMail: false }, { now: NOW + MIN }); await C.check(off.ctx, { ...S0, healthMail: false }, { now: NOW + 30 * MIN });
  assert.equal(off.ctx.calls.mail.length, 0);
  const nomail = world({ mailConfigured: false }); await up(nomail); nomail.tw.status = "reconnect";
  await C.check(nomail.ctx, S0, { now: NOW + MIN }); await C.check(nomail.ctx, S0, { now: NOW + 30 * MIN });
  assert.equal(nomail.ctx.calls.mail.length, 0);
  assert.equal((await S.readState(nomail.ctx)).health.mail, "off");
  const blocks = await mod.adminPanel(nomail.ctx, { query: {} });
  assert.ok(blocks.some((b) => b.type === "markdown" && /e-mail/.test(b.text)), "the page says the e-mail is not set up");
});

test("silence while live warns by e-mail at once and the page says it", async () => {
  const w = world(); await up(w); await S.ensureSecret(w.ctx);
  await deliver(w.ctx, TYPES.online, EV.online, { now: NOW, at: NOW });
  await S.updateState(w.ctx, (d) => { d.liveSince = NOW; d.lastEventAt = NOW; });
  const r = await C.check(w.ctx, S0, { now: NOW + 4 * HOUR });
  assert.equal(r.health, "silent");
  assert.equal(w.ctx.calls.mail.length, 1); assert.match(w.ctx.calls.mail[0].text, /3 heures/);
  const blocks = await mod.adminPanel(w.ctx, { query: {} });
  assert.ok(blocks.some((b) => b.type === "banner" && /3 heures/.test(b.text)));
  assert.equal(await mod.adminBadge(w.ctx), 1);
  const status = await mod.mcp.twitch_events_status(w.ctx);
  assert.equal(status.health.state, "silent"); assert.equal(status.health.warnedByMail, true);
  assert.ok(!JSON.stringify(status).match(/secret|token/i));
});

test("graceful: the webhook asks Twitch to try again (503, Retry-After) when the site cannot store, never loses an event, and answers 204 to a replay", async () => {
  const { ctx } = world(); await S.ensureSecret(ctx);
  const add = ctx.api.store.add;
  ctx.api.store.add = async (c, ...r) => { if (c === "events") throw new Error("updating"); return add(c, ...r); };
  const bad = await mod.routes.webhook(await signed(ctx, "m1"), ctx);
  assert.equal(bad.status, 503); assert.equal(bad.headers.get("retry-after"), "30");
  ctx.api.store.add = add;
  assert.equal((await mod.routes.webhook(await signed(ctx, "m1"), ctx)).status, 204);
  assert.equal((await mod.routes.webhook(await signed(ctx, "m1"), ctx)).status, 204);
  assert.equal((await lines(ctx)).length, 1);
});
async function signed(ctx, id) {
  const { es } = await import("./helpers/eventsWorld.mjs");
  const secret = (await S.readState(ctx)).secret, body = JSON.stringify({ subscription: { type: "channel.follow", version: "2" }, event: EV.follow }), ts = new Date().toISOString();
  return new Request("https://site.example.org/m/ev/webhook", { method: "POST", body, headers: { "twitch-eventsub-message-id": id, "twitch-eventsub-message-type": "notification", "twitch-eventsub-message-timestamp": ts, "twitch-eventsub-message-signature": es.sign(secret, id, ts, body) } });
}

test("manifest: permission mail, two settings (one advanced), one-minute watch, FR and EN texts", async () => {
  assert.equal(manifest.version, "1.2.0");
  assert.ok(manifest.permissions.includes("mail"));
  assert.deepEqual(manifest.settings.map((s) => s.key), ["retentionDays", "channel", "healthMail", "silentHours"]);
  assert.equal(manifest.settings.find((s) => s.key === "silentHours").advanced, true);
  const { fr, en } = await import("./helpers/eventsWorld.mjs");
  for (const k of ["health_silent", "catchup_note", "health_mail_off", "mail_subject_problem", "mail_body_problem", "mail_subject_back", "mail_body_back"]) assert.ok(en[k] && fr[k], k);
});
