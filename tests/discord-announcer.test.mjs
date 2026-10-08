import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/discord-announcer", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifestJson = readJson("module.json");
const source = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
const mod = await import("../modules/discord-announcer/index.mjs");
const def = mod.default;
const HOOK = "https://discord.com/api/webhooks/123456/abc-DEF_9";
const NOW = Date.parse("2030-06-01T12:00:00Z");
const ago = (h) => new Date(NOW - h * 3600_000).toISOString();

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
function mockFetch(handler = () => ({ ok: true, status: 204 })) {
  const calls = [];
  globalThis.fetch = async (url, init) => { const body = JSON.parse(init.body); calls.push({ url, body }); const r = handler(calls.length, body); return { ok: r.ok, status: r.status, statusText: "x", text: async () => r.text ?? "" }; };
  return calls;
}
const ctxWith = (topics, settings = {}) => fakeCtx({ key: "discord", messages: readJson("locales/en.json"), settings: { webhookUrl: HOOK, ...settings }, topics });
const entry = (title, path, publishedAt) => ({ title, path, publishedAt, source: { instance: "blog", module: "blog", name: "Blog" } });

test("manifeste valide, réglages lus déclarés, parité en/fr, clés ctx.t existantes", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  const declared = new Set(manifestJson.settings.map((s) => s.key));
  for (const m of source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(declared.has(m[1]), m[1]);
  const en = readJson("locales/en.json"), fr = readJson("locales/fr.json");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const m of source.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in en, m[1]);
});

test("seules les adresses de webhook Discord sont acceptées", () => {
  assert.ok(mod.isWebhook(HOOK));
  for (const bad of ["http://discord.com/api/webhooks/1/x", "https://evil.example/api/webhooks/1/x", "https://discord.com.evil.io/api/webhooks/1/x", "https://discord.com/api/webhooks/abc/x", "", null]) assert.equal(mod.isWebhook(bad), false, String(bad));
});

test("annonce un élément récent une seule fois ; un ancien est noté comme vu sans être annoncé", async () => {
  const calls = mockFetch();
  const ctx = ctxWith({ "core.entry": [entry("Nouveau", "/blog/nouveau", ago(2)), entry("Vieux", "/blog/vieux", ago(100))] });
  const first = await mod.announce(ctx, NOW);
  assert.deepEqual(first, { sent: 1, skipped: 1 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.content, /Nouveau\nhttps:\/\/example\.test\/blog\/nouveau/);
  assert.deepEqual(calls[0].body.allowed_mentions, { parse: [] }, "aucun ping sans mention configurée");
  assert.deepEqual(await mod.announce(ctx, NOW + 60_000), { sent: 0, skipped: 0 }, "rien de nouveau au passage suivant");
  assert.equal(calls.length, 1);
});

test("feed.item : adresse relative rendue absolue, schéma non http(s) écarté ; mention → ping autorisé", async () => {
  const calls = mockFetch();
  const ctx = ctxWith({ "feed.item": [{ id: "a1", title: "Concert", url: "/agenda/1", publishedAt: ago(1), source: {} }, { id: "a2", title: "Piège", url: "javascript:alert(1)", publishedAt: ago(1), source: {} }] }, { mention: "@everyone" });
  assert.equal((await mod.announce(ctx, NOW)).sent, 1);
  assert.match(calls[0].body.content, /^@everyone .*Concert\nhttps:\/\/example\.test\/agenda\/1$/);
  assert.deepEqual(calls[0].body.allowed_mentions, { parse: ["everyone", "roles"] });
});

test("échec d'envoi : retenté au passage suivant, une seule ligne de journal qui compte les tentatives", async () => {
  let fail = true;
  const calls = mockFetch(() => (fail ? { ok: false, status: 500, text: "boum" } : { ok: true, status: 204 }));
  const ctx = ctxWith({ "core.entry": [entry("Nouveau", "/blog/n", ago(1))] });
  assert.equal((await mod.announce(ctx, NOW)).sent, 0);
  assert.equal((await mod.announce(ctx, NOW + 60_000)).sent, 0);
  const log = await ctx.api.store.list("log");
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].data.ok, log[0].data.attempts, log[0].data.status], [false, 2, 500]);
  fail = false;
  assert.equal((await mod.announce(ctx, NOW + 120_000)).sent, 1);
  assert.equal(calls.length, 3);
});

test("jamais plus de 5 annonces par passage ; limite de débit (429) : on s'arrête", async () => {
  const many = Array.from({ length: 8 }, (_, i) => entry(`E${i}`, `/e/${i}`, ago(1)));
  const calls = mockFetch();
  const ctx = ctxWith({ "core.entry": many });
  assert.equal((await mod.announce(ctx, NOW)).sent, 5);
  assert.equal((await mod.announce(ctx, NOW + 60_000)).sent, 3);
  assert.equal(calls.length, 8);
  const calls429 = mockFetch(() => ({ ok: false, status: 429, text: "rate" }));
  await mod.announce(ctxWith({ "core.entry": many }), NOW);
  assert.equal(calls429.length, 1, "arrêt dès le premier 429");
});

test("sans webhook valide : rien n'est envoyé ; le bouton de test refuse", async () => {
  const calls = mockFetch();
  const ctx = ctxWith({ "core.entry": [entry("N", "/n", ago(1))] }, { webhookUrl: "https://evil.example/x" });
  assert.deepEqual(await mod.announce(ctx, NOW), { sent: 0, skipped: 0 });
  assert.equal(calls.length, 0);
  assert.deepEqual(await def.adminActions.test(ctx), { error: "No valid webhook configured." });
});

test("panneau d'admin : état, bouton de test, journal ; le test envoie un message sans ping", async () => {
  const calls = mockFetch();
  const ctx = ctxWith({});
  const out = await def.adminActions.test(ctx);
  assert.equal(out.ok, "Test message sent.");
  assert.deepEqual(calls[0].body.allowed_mentions, { parse: [] });
  const blocks = await def.adminPanel(ctx);
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "test"));
  assert.ok(blocks.some((b) => b.type === "table"));
  assert.ok(def.tasks.announce.everyMinutes >= 1);
});

test("live : annoncé une fois, titre + jeu, 🔴 ; un live relancé dans le délai compte pour le même", async () => {
  const calls = mockFetch();
  const live = (id, startedAt) => ({ id, title: "Soirée jeux", url: "https://twitch.tv/moi", startedAt, game: "Zelda", source: {} });
  const ctx = ctxWith({ "stream.live": [live("s1", ago(0.1))] });
  assert.equal((await mod.announce(ctx, NOW)).sent, 1);
  assert.match(calls[0].body.content, /^🔴 Soirée jeux \(Zelda\)\nhttps:\/\/twitch\.tv\/moi$/);
  // coupure de connexion : nouveau stream 30 min plus tard
  ctx.api.topics.collect = async (t) => (t === "stream.live" ? [live("s2", new Date(NOW + 30 * 60_000).toISOString())] : []);
  assert.deepEqual(await mod.announce(ctx, NOW + 31 * 60_000), { sent: 0, skipped: 1 });
  assert.equal(calls.length, 1);
  // un vrai nouveau live, 3 h plus tard
  ctx.api.topics.collect = async (t) => (t === "stream.live" ? [live("s3", new Date(NOW + 3 * 3600_000).toISOString())] : []);
  assert.equal((await mod.announce(ctx, NOW + 3 * 3600_000 + 60_000)).sent, 1);
});
