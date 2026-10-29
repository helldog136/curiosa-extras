// Connecteur Twitch 1.2.0 : les appels aux points de chaîne (récompenses) avec le jeton de la chaîne. Formes fermées, autorisation exigée, 429, trou noir, aucun jeton rendu.
// Le faux Twitch de fakeTwitch.mjs répond aux jetons ; les routes des récompenses sont ajoutées ici par-dessus (fakeRewards.mjs), derrière le VRAI client réseau du cœur.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeTwitch } from "./helpers/fakeTwitch.mjs";
import { fakeRewardsApi } from "./helpers/fakeRewards.mjs";
import { connector, connectorModule, connectorCallback } from "./helpers/twitchConnector.mjs";

const oauth = await import("../modules/twitch-connector/oauth.mjs");
const helix = await import("../modules/twitch-connector/helix.mjs");
const OWN = connectorCallback();
const MANAGE = "channel:manage:redemptions";
const realFetch = globalThis.fetch, saved = { ...oauth.timing };
let tw, rw, extra;
beforeEach(() => {
  connectorModule.resetCache();
  tw = fakeTwitch({ redirects: new Set([OWN]) });
  rw = fakeRewardsApi();
  extra = { silence: false, rate: false };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === "api.twitch.tv" && u.pathname.startsWith("/helix/channel_points/")) {
      tw.log.push({ method: init.method ?? "GET", path: u.pathname, headers: init.headers });
      if (extra.silence) return new Promise((_, reject) => init.signal?.addEventListener?.("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }));
      if (extra.rate) return new Response("{}", { status: 429, headers: { "content-type": "application/json", "retry-after": "60" } });
      const h = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      const tok = tw.access.get(String(h.authorization ?? "").replace(/^Bearer /, ""));
      if (!tok?.valid) return new Response("{}", { status: 401 });
      if (!tok.scopes.includes(MANAGE)) return new Response(JSON.stringify({ message: "Missing scope" }), { status: 401 });
      const q = {}; for (const [k, v] of u.searchParams) (q[k] ??= []).push(v);
      const r = rw.request({ as: "user", method: init.method, path: u.pathname.replace("/helix/", ""), query: q, body: init.body ? JSON.parse(init.body) : undefined });
      return new Response(r.json === null ? null : JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
    }
    return tw.fetch(url, init);
  };
});
afterEach(() => { globalThis.fetch = realFetch; Object.assign(oauth.timing, saved); });

const B = "777", RID = "00000000-0000-4000-8000-000000000001";
const ok = (args) => assert.ok(!helix.check(args).error, JSON.stringify(args));
const no = (args, error) => assert.equal(helix.check(args).error, error, JSON.stringify(args));
const u = (method, path, query, body) => ({ as: "user", method, path, query, ...(body ? { body } : {}) });
async function connect(C, scopes) {
  await C.methods.register({ channel: "machaine" });
  const link = await C.methods.connectLink({ channel: "machaine", slot: "main", scopes });
  assert.ok(link.url, link.reason);
  await C.callback(new Request(tw.approve(link.url)));
}

test("liste fermée : les cinq appels des récompenses passent avec leur forme exacte ; tout le reste est refusé sans réseau", () => {
  const base = "channel_points/custom_rewards";
  ok(u("GET", base, { broadcaster_id: B, only_manageable_rewards: "true" }));
  ok(u("POST", base, { broadcaster_id: B }, { title: "Rouge", cost: 500, prompt: "", is_enabled: true, is_user_input_required: false, is_global_cooldown_enabled: true, global_cooldown_seconds: 60, should_redemptions_skip_request_queue: false }));
  ok(u("PATCH", base, { broadcaster_id: B, id: RID }, { is_paused: true }));
  ok(u("DELETE", base, { broadcaster_id: B, id: RID }));
  ok(u("PATCH", `${base}/redemptions`, { id: RID, broadcaster_id: B, reward_id: RID }, { status: "CANCELED" }));
  ok(u("PATCH", `${base}/redemptions`, { id: RID, broadcaster_id: B, reward_id: RID }, { status: "FULFILLED" }));
  // refusés : jeton d'application, route voisine, champs en trop, valeurs hors bornes, corps manquant ou de trop
  no({ as: "app", method: "POST", path: base, query: { broadcaster_id: B }, body: { title: "x", cost: 1 } }, "forbidden");
  no(u("PUT", base, { broadcaster_id: B }), "forbidden");
  no(u("GET", "channel_points/custom_rewards/redemptions", { broadcaster_id: B }), "forbidden");
  no(u("POST", base, { broadcaster_id: B }, { title: "x", cost: 1, evil: true }), "invalid");
  no(u("POST", base, { broadcaster_id: B }, { title: "x".repeat(46), cost: 1 }), "invalid");
  no(u("POST", base, { broadcaster_id: B }, { title: "x", cost: 0 }), "invalid");
  no(u("POST", base, { broadcaster_id: B }, { title: "x", cost: 1.5 }), "invalid");
  no(u("POST", base, { broadcaster_id: B }, { title: "x", cost: 1, prompt: "p".repeat(201) }), "invalid");
  no(u("POST", base, { broadcaster_id: B }), "invalid");
  no(u("POST", base, { broadcaster_id: "abc" }, { title: "x", cost: 1 }), "invalid");
  no(u("POST", base, {}, { title: "x", cost: 1 }), "invalid");
  no(u("PATCH", base, { broadcaster_id: B }, { is_paused: true }), "invalid");
  no(u("PATCH", base, { broadcaster_id: B, id: "../x" }, { is_paused: true }), "invalid");
  no(u("PATCH", base, { broadcaster_id: B, id: RID }, {}), "invalid");
  no(u("DELETE", base, { broadcaster_id: B, id: RID }, { a: 1 }), "invalid");
  no(u("PATCH", `${base}/redemptions`, { id: RID, broadcaster_id: B, reward_id: RID }, { status: "UNFULFILLED" }), "invalid");
  no(u("PATCH", `${base}/redemptions`, { id: RID, broadcaster_id: B }, { status: "CANCELED" }), "invalid");
  assert.deepEqual(helix.check(u("DELETE", base, { broadcaster_id: B, id: RID })).scopes, [MANAGE]);
});

test("autorisation : sans « gérer les échanges » l'appel est refusé (scope) sans partir chez Twitch ; avec elle il passe, et rien de secret n'est rendu", async () => {
  const C = connector({});
  await connect(C, ["moderator:read:followers"]);
  const calls = () => tw.log.filter((c) => c.path.includes("channel_points")).length;
  assert.deepEqual(await C.methods.request(u("GET", "channel_points/custom_rewards", { broadcaster_id: B })), { ok: false, error: "scope" });
  assert.equal(calls(), 0, "aucun appel avec un jeton trop faible");
  await C.methods.wantScopes({ channel: "machaine", consumer: "bot", slot: "main", scopes: [MANAGE] });
  assert.equal((await C.methods.account({ channel: "machaine" })).status, "more", "le Connecteur sait qu'il manque une autorisation");
  await connect(C, [MANAGE]);
  const made = await C.methods.request(u("POST", "channel_points/custom_rewards", { broadcaster_id: B }, { title: "Rouge", cost: 500 }));
  assert.equal(made.status, 200);
  assert.equal(made.json.data[0].title, "Rouge");
  const dump = JSON.stringify([made, await C.methods.account({ channel: "machaine" }), await C.methods.connections()]);
  assert.ok(!/at_\d|rt_\d|SEC-RET/.test(dump), "aucun jeton ni secret");
});

test("compte sans points de chaîne : Twitch répond 403, le Connecteur le rend tel quel (à l'appelant de le dire en mots simples)", async () => {
  const C = connector({});
  await connect(C, [MANAGE]);
  rw.state.affiliate = false;
  const r = await C.methods.request(u("POST", "channel_points/custom_rewards", { broadcaster_id: B }, { title: "Rouge", cost: 500 }));
  assert.equal(r.status, 403);
  assert.match(r.json.message, /affiliate/);
});

test("429 : « rate » puis plus aucun appel ; Twitch muet : « network » dans la borne", async () => {
  Object.assign(oauth.timing, { requestMs: 150, sharedMs: 400 });
  const C = connector({});
  await connect(C, [MANAGE]);
  extra.rate = true;
  assert.deepEqual(await C.methods.request(u("GET", "channel_points/custom_rewards", { broadcaster_id: B })), { ok: false, error: "rate" });
  const n = tw.log.length;
  assert.deepEqual(await C.methods.request(u("GET", "channel_points/custom_rewards", { broadcaster_id: B })), { ok: false, error: "rate" });
  assert.equal(tw.log.length, n, "pause partagée : aucun appel de plus");
});

test("Twitch muet (trou noir) sur une récompense : « network » dans la borne", async () => {
  Object.assign(oauth.timing, { requestMs: 150, sharedMs: 400 });
  const C = connector({});
  await connect(C, [MANAGE]);
  extra.silence = true;
  const t0 = Date.now();
  const r = await C.methods.request(u("PATCH", "channel_points/custom_rewards/redemptions", { id: RID, broadcaster_id: B, reward_id: RID }, { status: "FULFILLED" }));
  assert.deepEqual(r, { ok: false, error: "network" });
  assert.ok(Date.now() - t0 < 1500);
});

test("la liste des autorisations demandables contient la nouvelle, et le module reste en 1.2.1", async () => {
  const store = await import("../modules/twitch-connector/store.mjs");
  assert.ok(store.EXTRA_SCOPES.includes(MANAGE));
  const m = JSON.parse((await import("node:fs")).readFileSync(new URL("../modules/twitch-connector/module.json", import.meta.url), "utf8"));
  assert.equal(m.version, "1.2.1");
});
