// INTÉGRATION : les DEUX VRAIS modules chargés ensemble, sans double. Le Bot Twitch reçoit des messages du chat comme Twitch les envoie (webhook signé) et
// transmet les inscriptions au VRAI service « audience.draw » de Participation 1.2.0 ; le tirage (ouverture, fermeture, tirage) se fait côté Participation.
import test from "node:test";
import assert from "node:assert/strict";
import { world, NOW, S, SRC, es, sent } from "./helpers/botWorld.mjs";
import { audienceCtx, def } from "./helpers/audienceHarness.mjs";

const D = await import("../modules/audience/draw.mjs");
const P = await import("../modules/audience/drawlib.mjs");
const K = await import("../modules/audience/core.mjs");
const BD = await import("../modules/twitch-bot/draw.mjs");
const W = await import("../modules/twitch-bot/webhook.mjs");

const FORM = { title: "Cadeau du jour", keyword: "!cadeau", level: "all", site: true, minutes: null, winners: 1 };

/** Un site avec Participation ET le Bot Twitch : le service du bot « audience.draw » EST celui de Participation (mêmes méthodes, même contexte, comme le fait le cœur). */
function both({ botOver = {}, audOver = {} } = {}) {
  BD.resetDrawMemory(); SRC.resetSources();
  const aud = audienceCtx(audOver);
  const calls = [];
  const svc = Object.fromEntries(Object.keys(def.services["audience.draw"]).map((m) => [m, async (a) => { calls.push([m, a]); return def.services["audience.draw"][m](aud, a); }]));
  const bot = world({ draw: svc, ...botOver });
  return { aud, calls, ...bot };
}
let seq = 0;
const eventBody = (text, { login = "viewer", name = "Viewer", id = "200", badges = [] } = {}) => JSON.stringify({ subscription: { type: es.TYPE, status: "enabled" }, event: { broadcaster_user_id: "100", chatter_user_id: id, chatter_user_login: login, chatter_user_name: name, message_id: `mm${++seq}`, message: { text }, message_type: "text", badges: badges.map((set_id) => ({ set_id })) } });
/** Un message du chat, par la porte d'entrée du bot (webhook signé), à l'heure `at` du bot. */
async function chatSays(w, text, who = {}, at = NOW) {
  const body = eventBody(text, who), ts = new Date(at).toISOString(), mid = `evt-${++seq}`;
  const request = new Request("https://site.example.org/m/bot/webhook", { method: "POST", body, headers: new Headers({ "twitch-eventsub-message-id": mid, "twitch-eventsub-message-timestamp": ts, "twitch-eventsub-message-type": "notification", "twitch-eventsub-message-signature": es.sign(w.secret, mid, ts, body) }) });
  const r = await W.handle(request, w.ctx, { now: at });
  assert.equal(r.response.status, 204);
  await r.done;
}
const open = async (aud, over = {}) => { const r = await D.openNew(aud, { ...FORM, ...over }); assert.ok(r.ok, JSON.stringify(r)); return r.draw; };
const entryNames = async (aud) => { const d = await D.current(aud); return aud.api.store.dump(`de-${d.k}-${d.gen || 0}`).map((r) => r.data.pseudo).sort(); };
const ready = async (o) => { const w = both(o); w.secret = await S.ensureSecret(w.ctx); return w; };

test("intégration : mot-clé exact + niveau suffisant inscrit, autre message non, une seule fois, sourdine refusée, rien pendant l'arrêt d'urgence ; puis fermeture et tirage ; le bot ne répond jamais", async () => {
  const w = await ready();
  const { aud, ctx, tw } = w;
  // 1. Pas de tirage ouvert : le message ne fait rien.
  await chatSays(w, "!cadeau", { login: "tot", name: "Tot", id: "1", badges: ["subscriber"] });
  assert.equal((await D.current(aud)), null);
  // 2. Tirage ouvert, réservé aux personnes abonnées. Le bot relit l'état au plus toutes les 10 s : on avance l'heure du bot.
  let at = NOW + 20_000;
  await open(aud, { level: "sub" });
  await chatSays(w, "!cadeau", { login: "ada", name: "Ada", id: "10", badges: ["subscriber"] }, at);
  await chatSays(w, "  !CADEAU ", { login: "mod1", name: "Capu", id: "11", badges: ["moderator"] }, at);
  await chatSays(w, "!cadeau", { login: "bob", name: "Bob", id: "12", badges: [] }, at);                 // niveau insuffisant
  await chatSays(w, "je veux le !cadeau", { login: "cleo", name: "Cleo", id: "13", badges: ["subscriber"] }, at);   // pas le mot-clé exact
  await chatSays(w, "!cadeaux", { login: "cleo", name: "Cleo", id: "13", badges: ["subscriber"] }, at);
  await chatSays(w, "cadeau", { login: "cleo", name: "Cleo", id: "13", badges: ["subscriber"] }, at);
  assert.deepEqual(await entryNames(aud), ["Ada", "Capu"]);
  // 3. Une même personne une seule fois (même en changeant de casse ou de pseudo affiché).
  await chatSays(w, "!cadeau", { login: "ada", name: "Ada", id: "10", badges: ["subscriber"] }, at + 1000);
  await chatSays(w, "!Cadeau", { login: "ada", name: "ADA_bis", id: "10", badges: ["subscriber"] }, at + 2000);
  assert.deepEqual(await entryNames(aud), ["Ada", "Capu"]);
  assert.equal((await D.current(aud)).count, 2);
  // 4. Une personne en sourdine dans la salle du tirage : refusée par Participation, qui seule connaît la sourdine.
  const room = await D.ensureDrawRoom(aud);
  const j = await K.joinRoom(aud, room, P.chatToken("twitch", "mutee"), Date.now());
  await K.setMuted(aud, room, { id: j.participant.id }, true);
  await chatSays(w, "!cadeau", { login: "mutee", name: "Mutee", id: "14", badges: ["subscriber"] }, at + 3000);
  assert.deepEqual(await entryNames(aud), ["Ada", "Capu"], "la personne en sourdine n'est pas inscrite");
  // 5. Arrêt d'urgence du bot : rien n'est envoyé à Participation.
  await S.setMuted(ctx, true);
  const before = w.calls.filter((c) => c[0] === "enter").length;
  await chatSays(w, "!cadeau", { login: "dan", name: "Dan", id: "15", badges: ["subscriber"] }, at + 4000);
  assert.equal(w.calls.filter((c) => c[0] === "enter").length, before, "aucun appel pendant l'arrêt d'urgence");
  assert.deepEqual(await entryNames(aud), ["Ada", "Capu"]);
  await S.setMuted(ctx, false);
  await chatSays(w, "!cadeau", { login: "dan", name: "Dan", id: "15", badges: ["subscriber"] }, at + 5000);
  assert.deepEqual(await entryNames(aud), ["Ada", "Capu", "Dan"], "l'arrêt levé, la personne peut s'inscrire");
  // 6. Fermeture côté Participation, puis plus personne ne peut s'inscrire (même si le bot a encore l'état « ouvert » en mémoire).
  assert.ok((await D.close(aud)).ok);
  await chatSays(w, "!cadeau", { login: "eve", name: "Eve", id: "16", badges: ["subscriber"] }, at + 6000);
  assert.deepEqual(await entryNames(aud), ["Ada", "Capu", "Dan"]);
  // 7. Le tirage, côté Participation, parmi les personnes inscrites seulement.
  const r = await D.pick(aud, { count: 2 });
  assert.ok(r.ok, JSON.stringify(r));
  const won = (await D.current(aud)).picked.map((x) => x.pseudo).sort();
  assert.equal(won.length, 2);
  for (const n of won) assert.ok(["Ada", "Capu", "Dan"].includes(n), `${n} était inscrite`);
  // 8. Le bot ne répond JAMAIS dans le chat pour une inscription.
  assert.deepEqual(sent(tw), []);
  assert.equal(tw.chat.length, 0);
});

test("intégration : un second tirage avec le même mot-clé, ouvert juste après le premier, inscrit de nouveau les mêmes personnes", async () => {
  const w = await ready();
  const { aud } = w;
  let at = NOW;
  await open(aud);
  await chatSays(w, "!cadeau", { login: "ada", name: "Ada", id: "10" }, at);
  assert.deepEqual(await entryNames(aud), ["Ada"]);
  await D.close(aud);
  // le bot n'a pas le temps de voir « fermé » : le tirage suivant est ouvert tout de suite, avec le même mot-clé et sans durée
  at += 3000;
  await open(aud);
  at += 11_000;   // l'état du bot est relu
  await chatSays(w, "!cadeau", { login: "ada", name: "Ada", id: "10" }, at);
  assert.deepEqual(await entryNames(aud), ["Ada"], "le nouveau tirage a bien reçu Ada");
  assert.equal(w.tw.chat.length, 0);
});

test("intégration : le Bot Twitch SANS Participation ne change pas (besoin facultatif absent : aucune erreur, aucun appel de service, les commandes marchent)", async () => {
  BD.resetDrawMemory(); SRC.resetSources();
  const errors = []; const orig = console.error; console.error = (...a) => errors.push(a.join(" "));
  try {
    const w = world();   // aucun service « audience.draw »
    w.secret = await S.ensureSecret(w.ctx);
    for (let i = 0; i < 5; i++) await chatSays(w, "!cadeau", { login: `u${i}`, name: `U${i}`, id: `${50 + i}`, badges: ["subscriber"] }, NOW + i * 12_000);
    await chatSays(w, "!jeu", { login: "ada", name: "Ada", id: "99" }, NOW + 70_000);
    assert.deepEqual(sent(w.tw), ["On joue à Zelda !"], "les commandes marchent comme avant");
    assert.deepEqual(errors, [], "aucune erreur");
    assert.deepEqual(w.ctx.calls.services.filter((c) => JSON.stringify(c).includes("audience.draw")), [], "aucun appel au service absent");
  } finally { console.error = orig; }
});
