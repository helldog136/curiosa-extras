// Les deux extensions que « Actions du live YouTube » demande : Connecteur YouTube 1.2.0 (lecture du chat d'un direct, demande « à jour ») et Chaîne YouTube 1.4.0 (service youtube.live).
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseManifest } from "@/core/modules/manifest";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { makeConnector, connectorApi as api, connectorModule } from "./helpers/fakeYoutube.mjs";
import { fakeYoutubeLive, CHANNEL, UPLOADS } from "./helpers/fakeYoutubeLive.mjs";

const realFetch = globalThis.fetch;
const CHAT = "Cg0KC2xpdmVjaGF0MQ";
const chatReq = (extra = {}) => ({ endpoint: "liveChatMessages.list", params: { liveChatId: CHAT, ...extra } });
let yt;
const setup = (o = {}) => { api.resetState(); yt = fakeYoutubeLive(); yt.goLive(); globalThis.fetch = yt.fetch; return makeConnector(o); };
const done = () => { globalThis.fetch = realFetch; };

/* ───────────── Connecteur YouTube 1.2.0 ───────────── */

test("connecteur : version 1.2.0, manifeste valide, coûts anciens inchangés (search.list reste exclu), le chat coûte 5", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../modules/youtube-connector/module.json", import.meta.url), "utf8"));
  assert.ok(parseManifest(manifest).ok);
  assert.equal(manifest.version, "1.2.0");
  assert.deepEqual(api.COSTS, { "channels.list": 1, "playlistItems.list": 1, "videos.list": 1 });
  assert.equal(api.LIVE_CHAT_COST, 5);
  assert.equal(api.normalize("search.list", { q: "x" }), null);
});

test("liveChatMessages.list : demande validée (identifiant, pages, 200 à 500 résultats), adresse sans clé, refus sans réseau", () => {
  const ok = api.normalize("liveChatMessages.list", { liveChatId: CHAT, pageToken: "t12", maxResults: 500 });
  assert.equal(ok.cost, 5); assert.equal(ok.chat, true);
  const u = new URL(ok.url);
  assert.equal(u.pathname, "/youtube/v3/liveChat/messages");
  assert.equal(u.searchParams.get("part"), "authorDetails,snippet");
  assert.ok(!/key=/.test(ok.url), "la clé voyage dans l'en-tête");
  for (const bad of [{}, { liveChatId: "" }, { liveChatId: "x" }, { liveChatId: "a b c d e f" }, { liveChatId: CHAT, maxResults: 100 }, { liveChatId: CHAT, maxResults: 501 }, { liveChatId: CHAT, maxResults: "x" }, { liveChatId: CHAT, part: "id" }, { liveChatId: CHAT, pageToken: "a b" }, { liveChatId: CHAT, pageToken: "x".repeat(401) }]) assert.equal(api.normalize("liveChatMessages.list", bad), null, JSON.stringify(bad));
});

test("lecture du chat : 5 unités comptées, jamais en cache (deux demandes = deux appels), aucune réponse périmée en cas de panne", async () => {
  const c = setup();
  yt.say(yt.text({ text: "salut" }));
  const a = await c.methods.request(chatReq());
  assert.equal(a.ok, true); assert.equal(a.cost, 5); assert.equal(a.json.items.length, 1);
  assert.equal(a.cached, undefined);
  const b = await c.methods.request(chatReq());
  assert.equal(b.cost, 5); assert.equal(yt.calls.chat.length, 2, "pas de cache");
  assert.equal((await c.methods.status()).quota.used, 10);
  yt.next = () => yt.fail.server(503);
  const c3 = await c.methods.request(chatReq());
  assert.equal(c3.ok, false, "pas de chat périmé servi à la place");
  assert.equal(c3.error, "network");
  yt.next = null;
  const c4 = await c.methods.request(chatReq({ pageToken: "t1" }));
  assert.equal(c4.ok, true, "une panne du chat n'impose pas de pause à l'appel suivant : l'appelant gère son propre repli");
  done();
});

test("erreurs du chat : direct fini, chat désactivé, accès refusé — chacune a son code et AUCUNE ne déclare la clé refusée", async () => {
  const c = setup();
  yt.next = () => yt.fail.chatEnded();
  assert.equal((await c.methods.request(chatReq())).error, "chat_ended");
  yt.next = () => yt.reasonBody(404, "liveChatNotFound");
  assert.equal((await c.methods.request(chatReq())).error, "chat_ended");
  yt.next = () => yt.fail.chatDisabled();
  assert.equal((await c.methods.request(chatReq())).error, "chat_disabled");
  assert.equal((await c.methods.status()).key, "set");
  yt.next = () => yt.fail.denied();
  const d = await c.methods.request(chatReq());
  assert.equal(d.error, "chat_denied"); assert.ok(d.retryAt > Date.now() + 9 * 60_000);
  const n = yt.calls.chat.length;
  yt.next = null;
  assert.equal((await c.methods.request(chatReq())).error, "chat_denied", "pause de 10 minutes pour le chat");
  assert.equal(yt.calls.chat.length, n, "sans appel");
  const st = await c.methods.status();
  assert.equal(st.key, "set"); assert.equal(st.chat.read, false, "le statut dit que la lecture du chat est suspendue");
  const other = await c.methods.request({ endpoint: "videos.list", params: { part: "snippet", id: "LIVEvideo01" } });
  assert.equal(other.ok, true, "les autres lectures ne sont pas touchées");
  done();
});

test("une vraie clé refusée, ou la limite du jour de YouTube, gardent leur comportement d'avant pour le chat aussi", async () => {
  const c = setup();
  yt.next = () => yt.fail.keyInvalid();
  assert.equal((await c.methods.request(chatReq())).error, "auth");
  assert.equal((await c.methods.status()).key, "refused");
  done();
  const q = setup();
  yt.next = () => yt.fail.quota();
  const r = await q.methods.request(chatReq());
  assert.equal(r.error, "quota");
  const n = yt.calls.all.length;
  assert.equal((await q.methods.request(chatReq())).error, "quota");
  assert.equal(yt.calls.all.length, n);
  done();
});

test("budget du connecteur : un appel de chat qui dépasserait la part accordée est refusé AVANT de partir", async () => {
  const c = setup({ settings: { dailyBudget: 100 } });   // 100 unités, dont 11 gardées pour l'administration
  for (let i = 0; i < 17; i++) assert.equal((await c.methods.request(chatReq({ pageToken: `t${i}` }))).ok, true, `appel ${i}`);   // 85 unités
  const before = yt.calls.chat.length;
  const r = await c.methods.request(chatReq({ pageToken: "t99" }));
  assert.equal(r.ok, false); assert.equal(r.error, "quota"); assert.equal(r.budget, true);
  assert.equal(yt.calls.chat.length, before);
  done();
});

test("la clé YouTube ne voyage jamais dans l'adresse du chat, et le connecteur dit qu'il ne sait pas écrire dans un chat", async () => {
  const c = setup();
  await c.methods.request(chatReq());
  const call = yt.fetch.calls.at(-1);
  assert.ok(!call.url.includes("FAKE-YT-KEY"));
  assert.equal(call.init.headers["x-goog-api-key"], "FAKE-YT-KEY-0001");
  const st = await c.methods.status();
  assert.deepEqual(st.chat, { read: true, write: false });
  assert.equal(st.costs["liveChatMessages.list"], 5);
  assert.deepEqual(Object.keys(connectorModule.default.services["youtube.api"]).sort(), ["adopt", "channels", "request", "status"], "la liste des méthodes n'a pas changé");
  done();
});

test("demande « à jour » (fresh) : ni lue ni gardée en cache, aucune réponse de repli ; sans elle, le cache de 10 minutes reste", async () => {
  const c = setup();
  const req = { endpoint: "videos.list", params: { part: "snippet,liveStreamingDetails", id: "LIVEvideo01" } };
  await c.methods.request(req); await c.methods.request(req);
  assert.equal(yt.calls.detect, 1, "deux demandes ordinaires : un seul appel");
  await c.methods.request({ ...req, fresh: true }); await c.methods.request({ ...req, fresh: true });
  assert.equal(yt.calls.detect, 3, "deux demandes à jour : deux appels de plus");
  yt.detectFail = () => yt.fail.server(503);
  const stale = await c.methods.request({ ...req, fresh: true });
  assert.equal(stale.ok, false, "pas de réponse périmée pour une demande à jour");
  const normal = await c.methods.request(req);
  assert.equal(normal.cached, true, "la demande ordinaire garde son cache");
  done();
});

/* ───────────── Chaîne YouTube 1.4.0 : youtube.live ───────────── */

const channelDef = (await import("../modules/youtube-channel/index.mjs")).default;
const live = await import("../modules/youtube-channel/live.mjs");
const chanManifest = JSON.parse(fs.readFileSync(new URL("../modules/youtube-channel/module.json", import.meta.url), "utf8"));
const chanMessages = JSON.parse(fs.readFileSync(new URL("../modules/youtube-channel/locales/fr.json", import.meta.url), "utf8"));
const channel = (c, channelId = CHANNEL) => {
  const ctx = fakeCtx({ moduleId: "youtube-channel", key: "chaine", settings: { channelId }, services: c ? c.services : {}, messages: chanMessages, permissions: ["sections", "topics", "admin"] });
  return { ctx, current: (args) => channelDef.services["youtube.live"].current(ctx, args) };
};

test("chaîne : version 1.4.0, service youtube.live (chaque chaîne répond pour elle-même, lecture seule), les anciens services intacts", () => {
  assert.ok(parseManifest(chanManifest).ok);
  assert.equal(chanManifest.version, "1.4.0");
  const o = chanManifest.offers.find((x) => x.service === "youtube.live");
  assert.deepEqual([o.version, o.each, o.readOnly], [1, true, ["current"]]);
  assert.ok(chanManifest.offers.some((x) => x.service === "event.source"));
  assert.deepEqual(Object.keys(channelDef.services).sort(), ["event.source", "youtube.live"]);
});

test("youtube.live : pas en direct, puis en direct avec le chat ; deux appels (2 unités) par vérification, la liste « envois » est déduite sans appel", async () => {
  mock.timers.reset(); mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-14T20:00:00Z") });
  const c = setup(); live.resetLive(); yt.endLive();
  const ch = channel(c);
  let r = await ch.current({});
  assert.deepEqual([r.ok, r.live, r.channelId], [true, false, CHANNEL]);
  assert.equal(yt.calls.detect, 2); assert.equal(r.cost, 2);
  assert.ok(yt.calls.all.some((u) => u.includes(`playlistId=${UPLOADS}`)));
  assert.ok(!yt.calls.all.some((u) => u.includes("/channels")), "aucun appel pour connaître la liste des envois");
  yt.goLive({ title: "En direct maintenant" });
  mock.timers.tick(46_000);
  r = await ch.current({});
  assert.equal(r.live, true); assert.equal(r.videoId, "LIVEvideo01"); assert.equal(r.chatId, CHAT); assert.equal(r.title, "En direct maintenant"); assert.ok(r.startedAt);
  done(); mock.timers.reset();
});

test("youtube.live : gardé 45 secondes (plusieurs modules ou onglets = une vérification), refait sur demande « fresh »", async () => {
  const c = setup(); live.resetLive();
  const ch = channel(c);
  await ch.current({}); await ch.current({}); await ch.current({});
  assert.equal(yt.calls.detect, 2, "une seule vérification");
  await ch.current({ fresh: true });
  assert.equal(yt.calls.detect, 4);
  done();
});

test("youtube.live : direct sans chat → chatId null ; vidéo terminée ignorée ; plusieurs directs → le plus récent", async () => {
  const c = setup(); live.resetLive();
  yt.goLive({ noChat: true });
  assert.equal((await channel(c).current({ fresh: true })).chatId, null);
  const items = [
    { id: "AAAAAAAAAAA", snippet: { title: "ancien", liveBroadcastContent: "live" }, liveStreamingDetails: { actualStartTime: "2026-10-14T10:00:00Z", activeLiveChatId: "chatAAAAAA" } },
    { id: "BBBBBBBBBBB", snippet: { title: "récent", liveBroadcastContent: "live" }, liveStreamingDetails: { actualStartTime: "2026-10-14T19:00:00Z", activeLiveChatId: "chatBBBBBB" } },
    { id: "CCCCCCCCCCC", snippet: { title: "fini", liveBroadcastContent: "live" }, liveStreamingDetails: { actualStartTime: "2026-10-14T19:30:00Z", actualEndTime: "2026-10-14T19:40:00Z", activeLiveChatId: "chatCCCCCC" } },
    { id: "DDDDDDDDDDD", snippet: { title: "à venir", liveBroadcastContent: "upcoming" }, liveStreamingDetails: { scheduledStartTime: "2026-10-15T19:30:00Z" } },
  ];
  const picked = live.pickLive(items);
  assert.deepEqual([picked.videoId, picked.chatId], ["BBBBBBBBBBB", "chatBBBBBB"]);
  assert.equal(live.pickLive([]), null); assert.equal(live.pickLive(null), null); assert.equal(live.pickLive([{ id: "bad", snippet: { liveBroadcastContent: "live" } }]), null);
  done();
});

test("youtube.live : pannes et réglages — jamais d'exception, jamais de direct inventé", async () => {
  const c = setup(); live.resetLive();
  assert.deepEqual((await channel(c, "").current({})), { ok: false, error: "channel" });
  assert.deepEqual((await channel(c, "pas-une-chaine").current({})), { ok: false, error: "channel" });
  yt.detectFail = () => yt.fail.server(503);
  assert.equal((await channel(c).current({ fresh: true })).error, "network");
  yt.detectFail = () => yt.fail.quota();
  api.resetState(); live.resetLive();
  assert.equal((await channel(c).current({ fresh: true })).error, "quota");
  yt.detectFail = null; api.resetState();
  const none = await channel(makeConnector({ apiKey: null })).current({ fresh: true });
  assert.equal(none.error, "config");
  const noConn = await channel(null).current({ fresh: true });
  assert.equal(noConn.error, "unavailable");
  yt.detectFail = () => yt.fail.silence();
  api.resetState(); live.resetLive();
  const t0 = performance.now();
  // le fournisseur ne répond jamais : borné
  const timing = (await import("../modules/youtube-channel/index.mjs")).timing;
  const saved = timing.serviceMs; timing.serviceMs = 300;
  try { const r = await channel(c).current({ fresh: true }); assert.equal(r.ok, false); assert.ok(performance.now() - t0 < 3000); } finally { timing.serviceMs = saved; }
  done();
});
