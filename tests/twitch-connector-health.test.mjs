// Twitch connector 1.5.0: the connection health. The page and the other modules must never say "connected" for an authorization Twitch no longer accepts.
// Real connector module behind the fake Twitch (tests/helpers/fakeTwitch.mjs): 401 on validate, refresh refused, revoked token, missing permission, backoff,
// the site log, the e-mails (grace delay, once per problem, once on recovery, never when the setting is off), the admin page and the MCP tool.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeTwitch } from "./helpers/fakeTwitch.mjs";
import { connector, connectorModule, connectorDef } from "./helpers/twitchConnector.mjs";

const DIR = new URL("../modules/twitch-connector", import.meta.url).pathname;
const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const hl = await import("../modules/twitch-connector/health.mjs");
const helix = await import("../modules/twitch-connector/helix.mjs");
const realFetch = globalThis.fetch;
const FOL = "moderator:read:followers", SUB = "channel:read:subscriptions";
let tw;
beforeEach(() => { hl.timing.cacheMs = 0; hl.timing.reportMs = 0; connectorModule.resetCache(); tw = fakeTwitch({ redirects: new Set(["https://example.test/m/twitch-connector/oauth/callback"]) }); globalThis.fetch = (u, i) => tw.fetch(u, i); });
afterEach(() => { globalThis.fetch = realFetch; });

const mk = (o = {}) => connector({ messages: en, locale: "en", ...o });
async function connect(C, scopes = [FOL, SUB]) {
  await C.methods.register({ channel: "etoile_nord" });
  await C.methods.wantScopes({ channel: "etoile_nord", consumer: "twitch-channel", slot: "main", scopes });
  tw.state.login = "etoile_nord";
  const link = await C.methods.connectLink({ channel: "etoile_nord", slot: "main", scopes });
  assert.ok(link.url, link.reason);
  await C.callback(new Request(tw.approve(link.url)));
}
const entry = async (C) => (await C.ctx.api.store.list("twitchConnections"))[0];
const revokeAtTwitch = async (C) => { const e = await entry(C); for (const m of [tw.access, tw.refresh]) for (const t of [e.data.access, e.data.refresh]) if (m.has(t)) m.get(t).valid = false; };
const followers = (C) => C.methods.request({ as: "user", slot: "main", method: "GET", path: "channels/followers", query: { broadcaster_id: ["777"] }, channel: "etoile_nord" });
const sweep = (C, now) => hl.sweep(C.ctx, { userToken: helix.userToken, now });
const lines = (C) => C.ctx.dumpLog();

test("healthy account: the check says ok, nothing is logged, no e-mail, no red dot", async () => {
  const C = mk(); await connect(C);
  const h = await C.methods.health({ channel: "etoile_nord", check: true });
  assert.equal(h.state, "ok"); assert.deepEqual(h.missing, []);
  assert.deepEqual(lines(C), []);
  assert.equal(await connectorDef.adminBadge(C.ctx), 0);
});

test("token revoked at Twitch: nobody called yet, the check finds it; state renew, status reconnect, one error line in the log, red dot", async () => {
  const C = mk(); await connect(C);
  assert.equal((await C.methods.account({ channel: "etoile_nord" })).status, "ok");
  await revokeAtTwitch(C);
  // before any check the stored flag still says ok: this is exactly why a real check is needed
  assert.equal((await C.methods.account({ channel: "etoile_nord" })).status, "ok");
  const h = await C.methods.health({ channel: "etoile_nord", check: true });
  assert.equal(h.state, "renew");
  assert.equal((await C.methods.account({ channel: "etoile_nord" })).status, "reconnect");
  assert.equal((await C.methods.connections())[0].health.state, "renew");
  const log = lines(C);
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].action, log[0].level, log[0].target], ["connection.problem", "error", "etoile_nord"]);
  assert.equal(await connectorDef.adminBadge(C.ctx), 1);
  await C.methods.health({ channel: "etoile_nord", check: true }); await C.methods.health({ channel: "etoile_nord", check: true });
  assert.equal(lines(C).length, 1, "once per state change, never per check");
  const secrets = JSON.stringify(lines(C));
  const e = await entry(C);
  assert.ok(!secrets.includes(e.data.access) && !secrets.includes(e.data.refresh) && !secrets.includes("SEC-RET"));
});

test("access token refused but the refresh token works: renewed silently, still ok", async () => {
  const C = mk(); await connect(C);
  const e = await entry(C); tw.expireAccess(e.data.access);
  const h = await C.methods.health({ channel: "etoile_nord", check: true });
  assert.equal(h.state, "ok");
  assert.deepEqual(lines(C), []);
  assert.equal((await followers(C)).ok, true);
});

test("a request that gets 401 twice records the problem at once (no waiting for the next check)", async () => {
  const C = mk(); await connect(C);
  await revokeAtTwitch(C);
  const e = await entry(C); await C.ctx.api.store.update(e.id, { ...e.data, expiresAt: Date.now() + 3_600_000 });   // the stored expiry does not know
  assert.deepEqual(await followers(C), { ok: false, error: "auth" });
  assert.equal((await C.methods.health({ channel: "etoile_nord" })).state, "renew");
  assert.equal(lines(C).filter((l) => l.action === "connection.problem").length, 1);
});

test("a missing permission found by a call is recorded, shown in plain words, asked again, and healed by the new authorization", async () => {
  const C = mk(); await connect(C, [SUB]);   // the followers permission was never granted and nobody had asked for it
  assert.equal((await C.methods.account({ channel: "etoile_nord" })).status, "ok", "the old behaviour: connected");
  assert.deepEqual(await followers(C), { ok: false, error: "scope" });
  const h = await C.methods.health({ channel: "etoile_nord" });
  assert.equal(h.state, "scopes"); assert.deepEqual(h.missing, [FOL]);
  assert.equal((await C.methods.account({ channel: "etoile_nord" })).status, "more");
  const link = await C.methods.connectLink({ channel: "etoile_nord", slot: "main" });
  assert.ok(new URL(link.url).searchParams.get("scope").split(" ").includes(FOL), "the link asks for the missing permission");
  assert.equal(lines(C).at(-1).level, "warn");
  await C.callback(new Request(tw.approve(link.url)));
  assert.equal((await C.methods.health({ channel: "etoile_nord", check: true })).state, "ok");
  assert.equal(lines(C).at(-1).action, "connection.back");
  assert.equal((await followers(C)).ok, true);
});

test("a permission lost on Twitch's side is found by the check (the stored list is refreshed from Twitch)", async () => {
  const C = mk(); await connect(C);
  const e = await entry(C); tw.access.get(e.data.access).scopes = [SUB];
  const h = await C.methods.health({ channel: "etoile_nord", check: true });
  assert.equal(h.state, "scopes"); assert.deepEqual(h.missing, [FOL]);
  assert.deepEqual((await entry(C)).data.scopes, [SUB]);
});

test("report: a module that saw a 403 makes the connector check; the answer is the truth, never the report", async () => {
  const C = mk(); await connect(C);
  const fine = await C.methods.report({ channel: "etoile_nord", consumer: "twitch-channel", problem: "denied" });
  assert.equal(fine.state, "ok");
  await revokeAtTwitch(C);
  const bad = await C.methods.report({ channel: "etoile_nord", consumer: "twitch-channel", problem: "denied" });
  assert.equal(bad.state, "renew");
  assert.equal((await C.methods.report({ channel: "etoile_nord", consumer: "BAD NAME" })).ok, false);
});

test("a refresh Twitch refuses for good is never retried; a temporary failure backs off instead of asking on every call", async () => {
  const C = mk(); await connect(C);
  const e = await entry(C); await C.ctx.api.store.update(e.id, { ...e.data, expiresAt: Date.now() });
  tw.state.down = true;
  const refreshes = () => tw.log.filter((c) => c.body?.grant_type === "refresh_token").length;
  for (let i = 0; i < 5; i++) assert.equal((await followers(C)).error, "network");
  assert.equal(refreshes(), 1, "one try, then the backoff answers");
  assert.equal((await C.methods.account({ channel: "etoile_nord" })).status, "ok", "an outage is not a verdict");
  assert.equal((await C.methods.health({ channel: "etoile_nord", check: true })).state, "ok", "nor for the check");
  assert.deepEqual(lines(C), []);
});

test("Twitch refusing the application secret at refresh is the application's problem, not a new authorization", async () => {
  const C = mk(); await connect(C);
  const e = await entry(C); await C.ctx.api.store.update(e.id, { ...e.data, expiresAt: Date.now() });
  tw.state.clientSecret = "OTHER";
  assert.equal((await followers(C)).error, "config");
  const h = await C.methods.health({ channel: "etoile_nord" });
  assert.equal(h.state, "app");
  assert.equal((await C.methods.account({ channel: "etoile_nord" })).status, "ok", "the account itself is not to be authorized again");
});

test("e-mails: nothing during the grace delay, one for the problem, none repeated, one when all is back; a failed one is retried later", async () => {
  const C = mk(); await connect(C);
  const t0 = Date.now();
  await revokeAtTwitch(C);
  await sweep(C, t0);
  assert.equal(C.ctx.calls.mail.length, 0, "inside the grace delay");
  await sweep(C, t0 + 11 * 60_000);
  assert.equal(C.ctx.calls.mail.length, 1);
  assert.equal(C.ctx.calls.mail[0].to, "owner");
  assert.match(C.ctx.calls.mail[0].text, /no longer accepts the authorization of etoile_nord/);
  assert.ok(!/SEC-RET|at_\d|rt_\d/.test(JSON.stringify(C.ctx.calls.mail)));
  await sweep(C, t0 + 30 * 60_000); await sweep(C, t0 + 5 * 3_600_000);
  assert.equal(C.ctx.calls.mail.length, 1, "one per problem");
  // the owner authorizes again
  const link = await C.methods.connectLink({ channel: "etoile_nord", slot: "main", force: true });
  await C.callback(new Request(tw.approve(link.url)));
  await sweep(C, t0 + 6 * 3_600_000);
  assert.equal(C.ctx.calls.mail.length, 2);
  assert.match(C.ctx.calls.mail[1].subject, /again/);
  await sweep(C, t0 + 7 * 3_600_000);
  assert.equal(C.ctx.calls.mail.length, 2, "one on recovery");
});

test("e-mails: never when the setting is off, and not when the site has no mail server (retried only later)", async () => {
  const off = mk({ settings: { appClientId: "cid", appSecret: "SEC-RET", healthMail: false } }); await connect(off);
  await revokeAtTwitch(off);
  const t0 = Date.now();
  await sweep(off, t0); await sweep(off, t0 + 20 * 60_000);
  assert.equal(off.ctx.calls.mail.length, 0);
  assert.equal(lines(off).filter((l) => l.action === "connection.problem").length, 1, "the log still tells");
  const none = mk({ mailConfigured: false }); await connect(none); await revokeAtTwitch(none);
  await sweep(none, t0); await sweep(none, t0 + 20 * 60_000);
  assert.equal(none.ctx.calls.mail.length, 0);
  assert.equal((await entry(none)).data.health.mail, "off");
  const flaky = mk({ mailResult: { ok: false, reason: "failed" } }); await connect(flaky); await revokeAtTwitch(flaky);
  await sweep(flaky, t0); await sweep(flaky, t0 + 20 * 60_000); await sweep(flaky, t0 + 30 * 60_000);
  assert.equal(flaky.ctx.calls.mail.length, 1, "a failed mail waits an hour before the next try");
  await sweep(flaky, t0 + 100 * 60_000);
  assert.equal(flaky.ctx.calls.mail.length, 2);
});

test("admin page: a refused authorization shows an error banner and ONE primary button; an account that works shows neither", async () => {
  const C = mk(); await connect(C);
  const html = (blocks) => blocks.filter((b) => b.type === "html" && b.html.includes("data-twitch-connect"));
  let page = await connectorDef.adminPanel(C.ctx);
  assert.equal(html(page).length, 0);
  assert.ok(!page.some((b) => b.type === "banner" && b.tone === "warning"));
  assert.ok(JSON.stringify(page).includes('"Connected"'));
  await revokeAtTwitch(C);
  page = await connectorDef.adminPanel(C.ctx);
  const banner = page.find((b) => b.type === "banner" && b.tone === "warning");
  assert.match(banner.text, /no longer accepts the authorization of etoile_nord/);
  assert.equal(html(page).length, 1);
  assert.match(html(page)[0].html, /Authorize again with Twitch/);
  assert.match(html(page)[0].html, /href="https:\/\/id\.twitch\.tv\/oauth2\/authorize\?/);
  assert.ok(!JSON.stringify(page).includes('"Connected"'), "no more green words for a refused authorization");
  assert.ok(JSON.stringify(page).includes("To renew"));
});

test("admin page: missing permissions are listed in plain words", async () => {
  const C = mk(); await connect(C, [SUB]); await followers(C);
  const page = await connectorDef.adminPanel(C.ctx);
  const banner = page.find((b) => b.type === "banner" && b.tone === "warning");
  assert.match(banner.text, /see your followers/);
  assert.ok(!/moderator:read/.test(banner.text));
  assert.ok(JSON.stringify(page).includes("Missing permissions"));
});

test("MCP tool: states the truth and what to do", async () => {
  const C = mk(); await connect(C);
  await revokeAtTwitch(C); await C.methods.health({ channel: "etoile_nord", check: true });
  const r = await connectorDef.mcp.connector_twitch_status(C.ctx);
  assert.equal(r.connections[0].state, "renew");
  assert.match(r.connections[0].whatToDo, /Authorize again with Twitch/);
  assert.ok(!JSON.stringify(r).includes("SEC-RET"));
});

test("manifest and texts: mail permission, declared log events, service health is read-only, FR/EN parity, plain words only", () => {
  for (const p of ["mail", "mcp", "storage", "admin", "routes"]) assert.ok(manifest.permissions.includes(p), p);
  assert.deepEqual(manifest.logEvents.map((e) => e.key), ["connection.problem", "connection.back"]);
  assert.ok(manifest.offers[0].readOnly.includes("health"));
  assert.ok(manifest.mcp.some((m) => m.name === "connector_twitch_status" && m.readOnly === true));
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of Object.keys(en)) assert.equal(vars(fr[k]), vars(en[k]), k);
  for (const s of ["moderator:read:followers", SUB, "user:read:chat", "user:write:chat", "user:bot", "channel:bot", "channel:manage:redemptions", "bits:read", "channel:read:hype_train", "channel:read:redemptions"]) assert.ok(`scope_${s.replace(/:/g, "_")}` in en, s);
  for (const k of ["health_renew", "health_scopes", "health_app", "mail_body_problem", "mail_body_back"]) assert.ok(!/\b(token|jeton|api|webhook|scope)\b/i.test(en[k] + fr[k]), k);
});

test("several modules failing at the same moment write one log line, not one each", async () => {
  const C = mk(); await connect(C);
  await revokeAtTwitch(C);
  const e = await entry(C); await C.ctx.api.store.update(e.id, { ...e.data, expiresAt: Date.now() + 3_600_000 });
  const rs = await Promise.all([followers(C), followers(C), followers(C)]);
  assert.ok(rs.every((r) => r.error === "auth"));
  assert.equal(lines(C).filter((l) => l.action === "connection.problem").length, 1);
});
