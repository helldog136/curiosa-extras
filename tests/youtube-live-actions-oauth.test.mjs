// Actions du live YouTube avec la connexion au compte YouTube du Connecteur 1.3.0 : « Connectez votre compte YouTube » quand le chat ne peut pas être lu, lecture avec le compte,
// réponses à « !stop » / « !start » seulement quand le Connecteur dit qu'il sait écrire (chat.write). Les VRAIS modules, un faux direct YouTube et un faux Google devant lui.
import test from "node:test";
import assert from "node:assert/strict";
import { world, E, S, def } from "./helpers/ytLiveWorld.mjs";
import { connectorApi, connectorMessages } from "./helpers/fakeYoutube.mjs";
import { fakeGoogle, CLIENT_ID, CLIENT_SECRET, SCOPE_READ, SCOPE_MANAGE, SECRET_RE } from "./helpers/fakeGoogleAuth.mjs";
import { messages } from "./helpers/ytLiveWorld.mjs";

const SETTINGS = { oauthClientId: CLIENT_ID, oauthClientSecret: CLIENT_SECRET };
const flat = (v) => JSON.stringify(v);
const cmd = (w, text, o) => w.yt.text({ text, at: Date.now(), ...o });

/** Un site où YouTube refuse la clé seule pour le chat (l'hypothèse de la propriétaire), avec un faux Google devant le faux direct. */
async function site({ chatReply = true, grant, extra = {} } = {}) {
  const w = await world({ connectorSettings: { ...SETTINGS, ...(chatReply ? { chatReply: true } : {}) }, ...extra });
  const g = fakeGoogle();
  g.grant = grant ?? null;
  globalThis.fetch = g.in_front_of(w.yt.fetch);
  w.yt.next = () => w.yt.fail.denied();   // la clé seule est refusée pour le chat, à chaque fois
  w.yt.goLive();
  g.messages = w.yt.messages;
  w.ctx.api.instances = { list: async () => [{ id: "i1", key: "youtube-connector", module: "youtube-connector", adminPath: "/admin/instances/i1" }] };
  const connect = async () => {
    w.tick(11_000);
    assert.ok((await connectorApi.accountStart(w.conn.ctx, { write: chatReply })).ok);
    g.decision = "approved"; w.tick(6000);
    return connectorApi.accountCheck(w.conn.ctx);
  };
  return { w, g, connect };
}
const text = (m) => messages.fr[m];

test("compte non connecté et chat refusé avec la clé : l'écran dit « Connectez votre compte YouTube » avec un lien vers le Connecteur, et plus aucune demande ne part", async () => {
  const { w, g } = await site();
  await w.read();                                           // la lecture est refusée
  assert.equal((await S.readState(w.ctx)).error.code, "chat_denied");
  const calls = w.yt.calls.chat.length;
  const st = await w.read(20_000);
  assert.equal(st.status, "connect");
  assert.equal(w.yt.calls.chat.length, calls, "rien ne repart tant que le compte n'est pas connecté");
  const panel = await w.panel();
  const first = panel[0];
  assert.deepEqual([first.type, first.text], ["banner", text("st_connect")]);
  assert.match(first.text, /^Connectez votre compte YouTube dans le Connecteur YouTube/);
  assert.deepEqual(panel.find((b) => b.type === "links").items, [{ label: text("connect_link"), href: "/admin/instances/i1" }]);
  assert.equal(g.calls.chatList.length, 0);
  w.done();
});

test("après la connexion : la pause du refus tombe aussitôt, le chat est lu avec le compte (jamais la clé), les dons déclenchent les règles", async () => {
  const { w, g, connect } = await site();
  await w.read(); await w.read(20_000);
  assert.equal((await S.readState(w.ctx)).status, "connect");
  assert.equal((await connect()).connected, true);
  const r = E.timing;
  w.yt.say(w.yt.superChat({ micros: 5_000_000, currency: "EUR", at: Date.now() }));
  await S.saveRule(w.ctx, null, { name: "Rouge", type: "superchat", currency: "EUR", minMicros: 5_000_000, minCount: 1, cooldownSec: 30, action: "lumieres:rouge", enabled: true, lastAt: 0 });
  const st = await w.read();
  assert.equal(st.status, "reading", "pas d'attente de 10 minutes après la connexion");
  const line = (await w.journal())[0];
  assert.equal(line.kind, "superchat"); assert.equal(line.status, "sent");
  const call = g.calls.chatList.at(-1);
  assert.match(call.headers.authorization, /^Bearer /); assert.equal(call.headers["x-goog-api-key"], undefined);
  assert.ok(r.idleMs > 0);
  w.done();
});

test("« !stop » / « !start » de la propriétaire : le site répond dans le chat QUAND le connecteur sait écrire (compte connecté + autorisation + réglage), une fois par ordre, jamais pour autre chose", async () => {
  const { w, g, connect } = await site();
  await connect();
  assert.deepEqual((await w.conn.methods.status()).chat, { read: true, write: true });
  w.yt.say(cmd(w, "!stop", { who: "Emma", owner: true, id: "s1" }));
  await w.read();
  assert.deepEqual(g.posted.map((p) => p.text), [text("chat_stopped")]);
  assert.equal(g.posted[0].liveChatId, w.yt.live.chatId);
  assert.ok(text("chat_stopped").length <= 190);
  w.yt.say(cmd(w, "!start", { who: "Emma", owner: true, id: "s2" }));
  await w.read(20_000);
  assert.deepEqual(g.posted.map((p) => p.text), [text("chat_stopped"), text("chat_started")]);
  // Un don, un simple message, un faux modérateur, une commande refusée : aucune réponse.
  w.yt.say(w.yt.superChat({ micros: 5_000_000, currency: "EUR", at: Date.now() }), cmd(w, "bonjour !stop", { id: "t1" }), cmd(w, "!start", { who: "Intrus", id: "t2" }), cmd(w, "!stop", { who: "Intrus", id: "t3" }));
  await w.read(20_000);
  assert.equal(g.posted.length, 2, "rien d'autre n'est écrit dans le chat");
  assert.equal(g.calls.chatInsert.length, 2);
  w.done();
});

test("sans l'autorisation d'écrire, ou avec « répondre dans le chat » coupé (défaut) : l'ordre est exécuté, rien n'est écrit dans le chat, aucun appel d'écriture, aucune erreur", async () => {
  for (const o of [{ chatReply: false }, { chatReply: true, grant: [SCOPE_READ] }]) {
    const { w, g, connect } = await site(o);
    await connect();
    assert.equal((await w.conn.methods.status()).chat.write, false);
    w.yt.say(cmd(w, "!stop", { who: "Emma", owner: true, id: "s1" }));
    await w.read();
    const [line] = await w.journal();
    assert.deepEqual([line.kind, line.command, line.status], ["command", "stop", "done"], "la maison est bien coupée");
    assert.equal(g.calls.chatInsert.length, 0);
    assert.deepEqual(g.posted, []);
    w.done();
  }
});

test("sans compte connecté (chat lisible avec la clé) : tout marche comme avant, aucune demande de connexion, aucune écriture", async () => {
  const w = await world({ connectorSettings: SETTINGS });
  const g = fakeGoogle();
  globalThis.fetch = g.in_front_of(w.yt.fetch);
  w.yt.goLive();
  w.yt.say(cmd(w, "!stop", { who: "Emma", owner: true, id: "s1" }));
  const st = await w.read();
  assert.equal(st.status, "reading");
  assert.equal(g.calls.chatInsert.length, 0);
  assert.deepEqual((await w.panel()).filter((b) => b.type === "links"), []);
  w.done();
});

test("un ancien Connecteur (sans « chat » dans son statut) : on lit comme avant, sans bannière ; jamais d'écriture", async () => {
  const w = await world();
  w.conn.methods.status = async () => ({ ready: true, key: "set", quota: { used: 0, budget: 9000 } });
  w.yt.goLive(); w.yt.say(cmd(w, "!stop", { who: "Emma", owner: true, id: "s1" }));
  const st = await w.read();
  assert.equal(st.status, "reading");
  w.done();
});

test("aucun jeton, code d'appareil ni code secret dans le panneau, le journal, l'état ou les outils de l'assistant d'Actions du live", async () => {
  const { w, connect } = await site();
  await w.read(); await w.read(20_000); await connect();
  w.yt.say(cmd(w, "!stop", { who: "Emma", owner: true, id: "s1" }));
  await w.read();
  const T = (await import("./helpers/ytLiveWorld.mjs")).T;
  const out = flat([await w.panel(), await w.journal(), await w.state(), await T.youtube_live_status(w.ctx), await T.youtube_live_journal(w.ctx, {}), w.dump()]);
  assert.ok(!SECRET_RE.test(out) && !out.includes(CLIENT_SECRET));
  w.done();
});

test("textes : « Connectez votre compte YouTube » dans les deux langues, sans jargon", () => {
  assert.match(messages.fr.st_connect, /^Connectez votre compte YouTube/);
  assert.match(messages.en.st_connect, /^Connect your YouTube account/);
  assert.equal(messages.fr.err_chat_denied, messages.fr.st_connect);
  assert.ok(!/oauth|token|jeton|\bscope\b/i.test(flat([messages.fr.st_connect, messages.en.st_connect, messages.fr.connect_link, messages.en.connect_link])));
  assert.ok(connectorMessages("fr").btn_connect);
});

test("sans Home Assistant : la clé seule est tentée d'abord ; refusée, l'écran dit « Connectez votre compte » ; une fois connecté, le don va à l'overlay SEULEMENT (« alerte seulement »), rien n'est envoyé à la maison", async () => {
  const EVT = await import("../modules/youtube-live-actions/events.mjs");
  EVT.resetEvents();
  const { w, g, connect } = await site({ chatReply: false, extra: { noBridge: true, settings: { readWithoutHouse: true } } });
  const st0 = await w.read();                                 // sans compte : la lecture par la clé est tentée (et refusée ici)
  assert.equal(w.yt.calls.chat.length, 1, "la lecture par clé a bien été tentée");
  assert.equal(st0.error.code, "chat_denied");
  assert.equal((await w.read(20_000)).status, "connect");
  assert.equal((await connect()).connected, true);
  w.yt.say(w.yt.superChat({ who: "Léa", micros: 5_000_000, currency: "EUR", at: Date.now() }));
  assert.equal((await w.read()).status, "reading");
  assert.match(g.calls.chatList.at(-1).headers.authorization, /^Bearer /);
  const [line] = await w.journal();
  assert.deepEqual([line.status, line.reason], ["skipped", "alert_only"]);
  const list = await def.exports["live.event"](w.ctx, {});
  assert.equal(list.length, 1); assert.equal(list[0].who, "Léa");
  w.done();
});
