import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/twitch-channel", import.meta.url).pathname;
const manifestJson = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const source = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
const mod = await import("../modules/twitch-channel/index.mjs");
const def = mod.default;
const realFetch = globalThis.fetch;
beforeEach(() => mod.resetCache());
afterEach(() => { globalThis.fetch = realFetch; });

function mockTwitch({ live = true, authOk = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); calls.push({ u, init });
    const json = (o, ok = true) => ({ ok, status: ok ? 200 : 401, json: async () => o });
    if (u.includes("id.twitch.tv/oauth2/token")) return authOk ? json({ access_token: "tok", expires_in: 3600 }) : json({}, false);
    if (u.includes("/helix/streams")) return json({ data: live ? [{ id: "42", title: "Soirée", started_at: "2030-01-01T10:00:00Z", game_name: "Zelda" }] : [] });
    if (u.includes("/helix/users")) return json({ data: [{ id: "777" }] });
    if (u.includes("/helix/clips")) return json({ data: [{ title: "Beau clip", url: "https://clips.twitch.tv/abc", thumbnail_url: "https://static-cdn.jtvnw.net/x.jpg", created_at: "2030-01-01T00:00:00Z" }, { title: "Piège", url: "javascript:alert(1)", thumbnail_url: "javascript:x", created_at: "2030-01-01T00:00:00Z" }] });
    return json({}, false);
  };
  return calls;
}
const ctx = (settings = {}) => fakeCtx({ key: "tw", settings: { channel: "MaChaine", clientId: "cid", clientSecret: "sec", ...settings } });

test("manifeste valide ; réglages lus déclarés", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  const declared = new Set(manifestJson.settings.map((s) => s.key));
  for (const m of source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(declared.has(m[1]), m[1]);
});

test("stream.live : le live en cours, avec le jeu et l'adresse de la chaîne ; vide hors ligne", async () => {
  mockTwitch();
  assert.deepEqual(await def.exports["stream.live"](ctx()), [{ id: "42", title: "Soirée", url: "https://twitch.tv/machaine", startedAt: "2030-01-01T10:00:00Z", game: "Zelda" }]);
  mod.resetCache(); mockTwitch({ live: false });
  assert.deepEqual(await def.exports["stream.live"](ctx()), []);
});

test("sans identifiants valides ou si l'authentification échoue : vide, jamais d'erreur ; aucune requête si la chaîne est invalide", async () => {
  const calls = mockTwitch({ authOk: false });
  assert.deepEqual(await def.exports["stream.live"](ctx()), []);
  mod.resetCache();
  const calls2 = mockTwitch();
  assert.deepEqual(await def.exports["stream.live"](ctx({ channel: "a b!" })), []);
  assert.deepEqual(await def.exports["stream.live"](ctx({ clientSecret: "" })), []);
  assert.equal(calls2.length, 0);
  assert.ok(calls.length >= 1);
});

test("clips : affiches https Twitch uniquement, miniature non http(s) écartée, cache 10 min", async () => {
  const calls = mockTwitch();
  const posters = await def.exports["maze.poster"](ctx(), { limit: 10 });
  assert.deepEqual(posters, [{ title: "Beau clip", url: "https://clips.twitch.tv/abc", image: "https://static-cdn.jtvnw.net/x.jpg", kind: "clip" }]);
  const n = calls.length;
  await def.exports["maze.poster"](ctx(), { limit: 10 });
  assert.equal(calls.length, n, "second appel servi par le cache");
});

test("le jeton est transmis en en-tête, jamais dans l'adresse", async () => {
  const calls = mockTwitch();
  await def.exports["stream.live"](ctx());
  const helix = calls.find((c) => c.u.includes("/helix/streams"));
  assert.equal(helix.init.headers.Authorization, "Bearer tok");
  assert.ok(!helix.u.includes("tok") && !helix.u.includes("sec"));
});
