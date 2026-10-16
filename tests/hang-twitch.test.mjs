// Chaîne Twitch 1.5.1 : un réseau « trou noir » (un fetch qui ne se termine JAMAIS, qui ignore même le signal d'abandon) ne doit plus bloquer personne.
// Avant le correctif : la promesse partagée restait dans `inflight` et chaque demande suivante l'attendait jusqu'au redémarrage (page d'accueil en 504).
import test, { afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeLive, T0, MIN } from "./helpers/fakeLive.mjs";

const helix = await import("../modules/twitch-channel/helix.mjs");
const oauth = await import("../modules/twitch-channel/oauth.mjs");
const realFetch = globalThis.fetch;
const C = { channel: "machaine", clientId: "cid", secret: "SEC-RET" };
const HUNG = Symbol("hung");
/** Résultat de p, ou HUNG s'il n'est pas arrivé après `ms` millisecondes réelles. */
const within = (p, ms = 1500) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(HUNG), ms); })]).finally(() => clearTimeout(t)); };
const blackHole = () => new Promise(() => {});
const timing = helix.timing ?? {};   // (avant le correctif, ce réglage n’existait pas : le test doit alors échouer sur le blocage lui-même)
const saved = { ...timing };
beforeEach(() => { helix.resetCache(); Object.assign(timing, { requestMs: 60_000, sharedMs: 120 }); });   // par défaut seule la borne du travail partagé joue
afterEach(() => { globalThis.fetch = realFetch; Object.assign(timing, saved); mock.timers.reset(); });

test("liveStatus : un fetch qui ne se termine jamais rend « network » dans le délai, pour tous les appelants", async () => {
  globalThis.fetch = blackHole;
  const t0 = Date.now();
  const [a, b] = await Promise.all([within(helix.liveStatus(C)), within(helix.liveStatus(C))]);
  assert.deepEqual(a, { error: "network" });
  assert.deepEqual(b, { error: "network" });
  assert.ok(Date.now() - t0 < 1400, "doit se terminer à la borne, pas attendre");
});

test("liveStatus : après l'expiration l'entrée partagée est retirée : la demande suivante repart de zéro et réussit", async () => {
  globalThis.fetch = blackHole;
  assert.deepEqual(await within(helix.liveStatus(C)), { error: "network" });
  await new Promise((r) => setTimeout(r, 60));   // le jeton, demandé en dessous, expire lui aussi à la même borne
  globalThis.fetch = async (u) => new Response(JSON.stringify(String(u).includes("oauth2/token") ? { access_token: "t", expires_in: 3600 } : { data: [] }));
  mock.timers.enable({ apis: ["Date"], now: Date.now() + 60_000 });   // l'erreur gardée 20 s est périmée
  const r = await within(helix.liveStatus(C));
  assert.notEqual(r, HUNG, "ne doit plus attendre l'ancienne promesse");
  assert.deepEqual(r, { stream: null });
});

test("liveStatus : un corps de réponse qui ne se termine jamais est borné lui aussi", async () => {
  globalThis.fetch = async (u) => (String(u).includes("oauth2/token")
    ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }))
    : { ok: true, status: 200, json: blackHole, text: blackHole });
  assert.deepEqual(await within(helix.liveStatus(C)), { error: "network" });
});

test("liveStatus : quand tout répond, le comportement est inchangé (et le minuteur ne retient pas le processus)", () => {
  const code = `
    const helix = await import(${JSON.stringify(new URL("../modules/twitch-channel/helix.mjs", import.meta.url).href)});
    globalThis.fetch = async (u) => new Response(JSON.stringify(String(u).includes("oauth2/token") ? { access_token: "t", expires_in: 3600 } : { data: [] }));
    console.log(JSON.stringify(await helix.liveStatus({ channel: "machaine", clientId: "cid", secret: "s" })));`;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", timeout: 10_000 });
  assert.equal(r.stdout.trim(), '{"stream":null}', r.stderr);
  assert.ok(Date.now() - t0 < 5000, "le processus doit se terminer sans attendre les 15 s du minuteur");
});

test("userStat : un renouvellement ou une lecture sans fin rend « network » et ne bloque pas la suivante", async () => {
  const doc = { access: "a", refresh: "r", expiresAt: Date.now() - 1000, scopes: ["moderator:read:followers"], userId: "7", clientId: "cid", status: "ok" };
  const conn = { ...C, key: "k", load: async () => doc, save: async () => {} };
  globalThis.fetch = blackHole;
  const r = await within(helix.userStat(conn, "followers"));
  assert.equal(r.error, "network");
  const r2 = await within(helix.userStat(conn, "followers"));   // servie par le cache d'erreur (20 s), sans rien attendre
  assert.equal(r2.error, "network");
});

test("channelVideos et channelClips : bornés, et gardent les dernières valeurs connues", async () => {
  globalThis.fetch = blackHole;
  const v = await within(helix.channelVideos(C), 4000);
  assert.deepEqual([v.items, v.error], [[], "network"]);
  const c = await within(helix.channelClips(C), 1500);
  assert.deepEqual([c.items, c.error], [[], "network"]);
});

test("appCall / streamNow : un fetch sans fin est borné par la borne dure (même hors travail partagé)", async () => {
  Object.assign(timing, { requestMs: 25, sharedMs: 60_000 });
  globalThis.fetch = blackHole;
  const t0 = Date.now();
  const r = await within(helix.appCall(C, { path: "users", query: {} }), 3000);
  assert.deepEqual(r, { error: "network" });
  assert.deepEqual(await within(helix.streamNow(C), 3000), { error: "network" });
  assert.ok(Date.now() - t0 < 2500);
});

test("oauth : échange, renouvellement, validation et révocation sans fin rendent une erreur « network » dans le délai", async () => {
  Object.assign(timing, { requestMs: 25 });
  globalThis.fetch = blackHole;
  const args = { clientId: "cid", secret: "s", code: "c", redirectUri: "https://x.test/cb", refresh: "r" };
  assert.equal((await within(oauth.exchangeCode(args))).error, "network");
  assert.equal((await within(oauth.refreshTokens(args))).error, "network");
  assert.equal((await within(oauth.validate("tok"))).error, "network");
  assert.equal(await within(oauth.revoke({ clientId: "cid", token: "t" })), false);
});

test("enregistreur de directs : un Twitch qui ne répond pas ne laisse pas le verrou « busy » à jamais ; le passage suivant mesure normalement", async () => {
  const DIR = new URL("../modules/twitch-channel", import.meta.url).pathname;
  const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
  const mod = await import("../modules/twitch-channel/index.mjs");
  const live = await import("../modules/twitch-channel/live.mjs");
  mod.resetCache();
  Object.assign(timing, { requestMs: 25, sharedMs: 60_000 });
  const L = fakeLive();
  const ctx = fakeCtx({ key: "tw", locale: "fr", messages: fr, settings: { channel: "MaChaine", clientId: "cid", clientSecret: "SEC-RET", trackStats: true, statsFollowers: false } });
  const tick = async (min) => { L.at(min); await mod.default.tasks["record-lives"].run(ctx); };
  try {
    L.install(); globalThis.fetch = blackHole;
    L.at(0);
    assert.notEqual(await within(tick(0), 3000), HUNG, "le passage ne doit pas attendre Twitch indéfiniment");
    assert.equal((await live.trackingState(ctx)).lastError?.code, "network");
    L.install(); L.live("777", { viewer_count: 12, started_at: new Date(T0 - 60_000).toISOString() });
    assert.notEqual(await within(tick(5), 3000), HUNG);
    const d = await live.trackingState(ctx);
    assert.equal(d.lastError, null, "plus « busy » : la mesure suivante a eu lieu");
    assert.ok(d.openId, "le direct est enregistré");
  } finally { L.restore(realFetch); }
});
