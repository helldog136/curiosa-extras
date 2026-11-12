// My Twitch channel 2.3.2: when the Twitch authorization stops working, the page and the figures say so and give the way out.
// Real connector behind the fake Twitch; the channel module reads the connector's state (no copy of it).
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeTwitch } from "./helpers/fakeTwitch.mjs";
import { connector, connectorModule, connectorCallback } from "./helpers/twitchConnector.mjs";

const DIR = new URL("../modules/twitch-channel", import.meta.url).pathname;
const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const mod = await import("../modules/twitch-channel/index.mjs");
const def = mod.default;
const hl = await import("../modules/twitch-connector/health.mjs");
const realFetch = globalThis.fetch;
let tw, C;
beforeEach(() => {
  hl.timing.cacheMs = 0; hl.timing.reportMs = 0;
  mod.resetCache(); connectorModule.resetCache();
  tw = fakeTwitch({ redirects: new Set([connectorCallback()]), login: "etoile_nord" });
  globalThis.fetch = (u, i) => tw.fetch(u, i);
  C = connector({ messages: en, locale: "en" });
});
afterEach(() => { globalThis.fetch = realFetch; });

const mk = (extra = {}) => fakeCtx({ key: "tw", locale: "en", messages: en, settings: { channel: "etoile_nord", trackStats: true, statsFollowers: true, statsPaying: true, ...extra }, services: { "twitch.api": C.methods } });
const unesc = (v) => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const button = (blocks) => { const b = blocks.find((x) => x.type === "html" && x.html.includes("data-twitch-connect")); return b ? { href: unesc(/href="([^"]+)"/.exec(b.html)[1]), label: unesc(/>([^<]+)<\/a>/.exec(b.html)[1]) } : null; };
const stat = (ctx) => def.exports["social.stat"](ctx, { limit: 50 });
const byMetric = (items, m) => items.find((i) => i.metric === m);
async function authorize(ctx) { const b = button(await def.adminPanel(ctx)); assert.ok(b, "button expected"); await C.callback(new Request(tw.approve(b.href))); }

test("the figures flow, then the authorization is revoked at Twitch: the page says it at once and offers the button", async () => {
  const ctx = mk(); await authorize(ctx);
  assert.equal(byMetric(await stat(ctx), "followers").value, 1234);
  const [e] = await C.ctx.api.store.list("twitchConnections");
  for (const t of [e.data.access, e.data.refresh]) for (const m of [tw.access, tw.refresh]) if (m.has(t)) m.get(t).valid = false;
  await C.methods.health({ channel: "etoile_nord", check: true });   // the connector's own check (task, page, report)
  mod.resetCache();
  const items = await stat(ctx);
  assert.equal(byMetric(items, "followers").error, "auth"); assert.equal(byMetric(items, "followers").value, undefined);
  const panel = await def.adminPanel(ctx);
  assert.ok(panel.some((b) => b.type === "banner" && /no longer accepts your authorization/.test(b.text)));
  assert.equal(button(panel).label, "Authorize again with Twitch");
});

test("the permission was never granted and nobody declared it: found by the first call, the page asks for it (no dead end), the new authorization heals it", async () => {
  const first = mk({ statsFollowers: false }); await authorize(first);   // the connector token has the subscriptions permission only
  const ctx = mk();
  const items = await stat(ctx);
  assert.equal(byMetric(items, "followers").error, "auth");
  assert.equal(byMetric(items, "paying").value, 56, `what works keeps working ${JSON.stringify(byMetric(items, "paying"))}`);
  const h = await C.methods.health({ channel: "etoile_nord" });
  assert.equal(h.state, "scopes"); assert.deepEqual(h.missing, ["moderator:read:followers"]);
  const panel = await def.adminPanel(ctx);
  assert.ok(panel.some((b) => b.type === "banner" && /permission is missing/.test(b.text)));
  await authorize(ctx);
  mod.resetCache();
  assert.equal(byMetric(await stat(ctx), "followers").value, 1234);
});

test("a stat that fails with auth while the connector still says ok shows the frozen notice and an Authorize again button", async () => {
  const ctx = mk(); await authorize(ctx);
  // Twitch refuses the call with a 403 although the authorization checks out
  const realFetch2 = globalThis.fetch;
  globalThis.fetch = (u, i) => (String(u).includes("/helix/channels/followers") ? Promise.resolve(new Response('{"status":403}', { status: 403, headers: { "content-type": "application/json" } })) : tw.fetch(u, i));
  try {
    const items = await stat(ctx);
    assert.equal(byMetric(items, "followers").error, "auth");
    const panel = await def.adminPanel(ctx);
    assert.ok(panel.some((b) => b.type === "banner" && /frozen/.test(b.text)));
    assert.equal(button(panel).label, "Authorize again with Twitch");
  } finally { globalThis.fetch = realFetch2; }
});

test("the assistant tool says why followers gained is missing", async () => {
  const ctx = mk(); await authorize(ctx);
  const [e] = await C.ctx.api.store.list("twitchConnections");
  await C.ctx.api.store.update(e.id, { ...e.data, status: "reconnect" });
  const r = await def.mcp.twitch_streams(ctx, {});
  assert.match(r.connectionProblem, /Authorize again with Twitch/);
});

test("texts: FR and EN have the same keys and variables", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of ["err_auth_renew", "err_auth_scope", "err_auth_denied", "frozen", "authorizeAgain"]) assert.ok(fr[k] && en[k], k);
});
