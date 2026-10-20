// Un Twitch « trou noir » (une réponse qui ne vient JAMAIS, même pas après le signal d'abandon) ne doit bloquer personne :
//   - Ma Chaîne Twitch 2.0 : chaque appel au Connecteur est borné, et un travail partagé n'est jamais éternel (helix.timing.sharedMs) ;
//   - Connecteur Twitch : chaque appel réseau passe par ctx.api.net (délai dur du cœur) et un appel complet du service est borné (oauth.timing.sharedMs).
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeLive, T0 } from "./helpers/fakeLive.mjs";
import { connector, connectorModule } from "./helpers/twitchConnector.mjs";

const helix = await import("../modules/twitch-channel/helix.mjs");
const oauth = await import("../modules/twitch-connector/oauth.mjs");
const realFetch = globalThis.fetch;
const HUNG = Symbol("hung");
/** Résultat de p, ou HUNG s'il n'est pas arrivé après `ms` millisecondes réelles. */
const within = (p, ms = 1500) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(HUNG), ms); })]).finally(() => clearTimeout(t)); };
const blackHole = () => new Promise(() => {});
const saved = { helix: { ...helix.timing }, oauth: { ...oauth.timing } };
beforeEach(() => { helix.resetCache(); connectorModule.resetCache(); Object.assign(helix.timing, { sharedMs: 120 }); });
afterEach(() => { globalThis.fetch = realFetch; Object.assign(helix.timing, saved.helix); Object.assign(oauth.timing, saved.oauth); });

/** Un « client » de Ma Chaîne Twitch dont le Connecteur ne répond jamais. */
const hungClient = { channel: "machaine", call: blackHole, account: blackHole };

// ── Ma Chaîne Twitch : un Connecteur qui ne répond pas ───────────────────────────────────────────────────────────────────────────────

test("liveStatus : un Connecteur muet rend « network » dans la borne, pour tous les appelants ; la demande suivante repart de zéro", async () => {
  const t0 = Date.now();
  const [a, b] = await Promise.all([within(helix.liveStatus(hungClient)), within(helix.liveStatus(hungClient))]);
  assert.deepEqual([a, b], [{ error: "network" }, { error: "network" }]);
  assert.ok(Date.now() - t0 < 1400, "doit se terminer à la borne, pas attendre");
  helix.resetCache();
  const ok = { channel: "machaine", call: async () => ({ status: 200, json: { data: [] } }), account: async () => ({}) };
  assert.deepEqual(await within(helix.liveStatus(ok)), { stream: null });
});

test("userStat, channelVideos, channelClips, streamNow : bornés, et gardent les dernières valeurs connues", async () => {
  assert.equal((await within(helix.userStat(hungClient, "followers"))).error, "network");
  assert.equal((await within(helix.userStat(hungClient, "followers"))).error, "network", "servi par le cache d'erreur, sans rien attendre");
  const v = await within(helix.channelVideos(hungClient), 4000);
  assert.deepEqual([v.items, v.error], [[], "network"]);
  const c = await within(helix.channelClips(hungClient), 1500);
  assert.deepEqual([c.items, c.error], [[], "network"]);
  assert.deepEqual(await within(helix.recentClips(hungClient)), []);
});

test("quand tout répond, le minuteur de la borne ne retient pas le processus", () => {
  const code = `
    const helix = await import(${JSON.stringify(new URL("../modules/twitch-channel/helix.mjs", import.meta.url).href)});
    console.log(JSON.stringify(await helix.liveStatus({ channel: "machaine", call: async () => ({ status: 200, json: { data: [] } }), account: async () => ({}) })));`;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", timeout: 10_000 });
  assert.equal(r.stdout.trim(), '{"stream":null}', r.stderr);
  assert.ok(Date.now() - t0 < 5000, "le processus doit se terminer sans attendre les 15 s du minuteur");
});

test("le service du Connecteur ne répond jamais (ctx.api.services.call muet) : chaque appel de Ma Chaîne Twitch est borné", async () => {
  const mod = await import("../modules/twitch-channel/index.mjs");
  mod.resetCache();
  const ctx = fakeCtx({ key: "tw", settings: { channel: "MaChaine", trackStats: true } });
  ctx.api.services.call = blackHole;
  const t0 = Date.now();
  assert.deepEqual(await within(mod.default.exports["stream.live"](ctx), 3000), []);
  assert.notEqual(await within(mod.default.services["twitch.live"].status(ctx), 3000), HUNG);
  assert.notEqual(await within(mod.default.adminPanel(ctx), 3000), HUNG);
  assert.ok(Date.now() - t0 < 3000);
});

// ── Connecteur Twitch : un réseau muet ───────────────────────────────────────────────────────────────────────────────────────────────

test("Connecteur : GET streams vers un Twitch muet (jeton ou réponse qui ne viennent jamais) rend « network » dans la borne, pour tous les appelants", async () => {
  Object.assign(oauth.timing, { requestMs: 20_000, sharedMs: 150 });   // seule la borne de l'ensemble de l'appel joue
  const C = connector();
  const ask = () => C.methods.request({ as: "app", method: "GET", path: "streams", query: { user_login: ["alice", "bob_x"], first: 100 } });
  globalThis.fetch = blackHole;
  const t0 = Date.now();
  const [a, b] = await Promise.all([within(ask()), within(ask())]);
  assert.deepEqual([a, b], [{ ok: false, error: "network" }, { ok: false, error: "network" }]);
  assert.ok(Date.now() - t0 < 1400, "la borne joue, pas l'attente");
  // le jeton arrive, mais la liste des directs ne vient jamais : c'est la borne de l'ensemble qui protège
  connectorModule.resetCache();
  const D = connector();
  globalThis.fetch = async (u) => (String(u).includes("oauth2/token") ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { headers: { "content-type": "application/json" } }) : blackHole());
  const t1 = Date.now();
  assert.deepEqual(await within(D.methods.request({ as: "app", method: "GET", path: "streams", query: { user_login: ["alice"] } })), { ok: false, error: "network" });
  assert.ok(Date.now() - t1 < 1400);
  // Twitch revenu : la demande suivante repart de zéro
  connectorModule.resetCache();
  const E = connector();
  globalThis.fetch = async (u) => new Response(JSON.stringify(String(u).includes("oauth2/token") ? { access_token: "t", expires_in: 3600 } : { data: [{ user_login: "alice", type: "live" }] }), { headers: { "content-type": "application/json" } });
  const r = await within(E.methods.request({ as: "app", method: "GET", path: "streams", query: { user_login: ["alice"] } }));
  assert.notEqual(r, HUNG);
  assert.equal(r.ok, true);
});

test("Connecteur : échange, renouvellement, validation, révocation et jeton d'application muets rendent une erreur dans le délai du client réseau", async () => {
  Object.assign(oauth.timing, { requestMs: 60 });
  const C = connector();
  globalThis.fetch = blackHole;
  const net = C.ctx.api.net;
  const args = { clientId: "cid", secret: "s", code: "c", redirectUri: "https://x.test/cb", refresh: "r" };
  assert.equal((await within(oauth.exchangeCode(net, args))).error, "network");
  assert.equal((await within(oauth.refreshTokens(net, args))).error, "network");
  assert.equal((await within(oauth.validate(net, "tok"))).error, "network");
  assert.equal((await within(oauth.appToken(net, args))).error, "network");
  assert.equal(await within(oauth.revoke(net, { clientId: "cid", token: "t" })), false);
});

test("enregistreur de directs : un Twitch muet ne laisse pas le verrou « busy » à jamais ; le passage suivant mesure normalement", async () => {
  const DIR = new URL("../modules/twitch-channel", import.meta.url).pathname;
  const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
  const mod = await import("../modules/twitch-channel/index.mjs");
  const live = await import("../modules/twitch-channel/live.mjs");
  mod.resetCache();
  Object.assign(oauth.timing, { requestMs: 40, sharedMs: 200 });
  Object.assign(helix.timing, { sharedMs: 60_000 });
  const L = fakeLive();
  const C = connector();
  const ctx = fakeCtx({ key: "tw", locale: "fr", messages: fr, settings: { channel: "MaChaine", trackStats: true, statsFollowers: false }, services: { "twitch.api": C.methods } });
  const tick = async (min) => { L.at(min); await mod.default.tasks["record-lives"].run(ctx); };
  try {
    L.install(); globalThis.fetch = blackHole;
    assert.notEqual(await within(tick(0), 3000), HUNG, "le passage ne doit pas attendre Twitch indéfiniment");
    assert.equal((await live.trackingState(ctx)).lastError?.code, "network");
    L.install(); L.live("777", { viewer_count: 12, started_at: new Date(T0 - 60_000).toISOString() });
    connectorModule.resetCache();
    const fresh = connector();
    ctx.api.services.call = async (s, m, a) => ({ ok: true, value: await fresh.methods[m](a) });
    assert.notEqual(await within(tick(5), 3000), HUNG);
    const d = await live.trackingState(ctx);
    assert.equal(d.lastError, null, "plus « busy » : la mesure suivante a eu lieu");
    assert.ok(d.openId, "le direct est enregistré");
  } finally { L.restore(realFetch); }
});
