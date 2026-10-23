// Actions du live YouTube : le moteur, de bout en bout, avec les VRAIS modules (Connecteur YouTube, Chaîne YouTube, Home Assistant) et un faux YouTube.
// Page ouverte / fermée, un seul curseur, cadence, budget de la limite du jour, pannes, règles, délai de recharge, doublons, « !stop »…
import test from "node:test";
import assert from "node:assert/strict";
import { world, E, S, R, B, ALL_RIGHTS } from "./helpers/ytLiveWorld.mjs";

const rule = async (w, over = {}) => {
  const r = R.validateRule({ name: "Rouge", type: "superchat", currency: "EUR", min: "5", cooldownSec: "30", action: "lumieres:rouge", ...over });
  assert.ok(r.ok, JSON.stringify(r.errors));
  return S.saveRule(w.ctx, null, { ...r.rule, lastAt: 0 });
};
const live = (w, o) => w.yt.goLive(o);
/** Un tour de lecture puis Home Assistant vient chercher ce qui attend. */
const play = async (w, ms = 0) => { const st = await w.read(ms); await w.ha.step(); return st; };
const sc = (w, o = {}) => w.yt.superChat({ who: "Léa", micros: 5_000_000, currency: "EUR", at: Date.now(), ...o });

test("un Super Chat de 5 € : la règle se déclenche, Home Assistant exécute, le journal passe de « confié » à « joué »", async () => {
  const w = await world();
  await rule(w);
  live(w); w.yt.say(sc(w));
  const st = await w.read();
  assert.equal(st.status, "reading");
  let [line] = await w.journal();
  assert.equal(line.status, "sent"); assert.equal(line.key, "lumieres:rouge"); assert.equal(line.micros, 5_000_000); assert.equal(line.who, "Léa");
  const step = await w.ha.step();
  assert.deepEqual(step.actions.map((a) => a.key), ["lumieres:rouge"]);
  assert.equal(w.ha.executed.length, 1);
  await E.reconcile(w.ctx);
  [line] = await w.journal();
  assert.equal(line.status, "done");
  w.done();
});

test("le message d'un Super Chat est lu à voix haute (tts:lire), après la vérification de Home Assistant ; sans la case, la voix dit seulement merci", async () => {
  const w = await world();
  await rule(w, { name: "Voix", action: "tts:lire", readMessage: "on", min: "1" });
  live(w); w.yt.say(sc(w, { micros: 12_000_000, comment: "Bravo pour le live", who: "Léa" }));
  await play(w);
  assert.equal(w.ha.executed.length, 1);
  assert.equal(w.ha.executed[0].key, "tts:lire");
  assert.match(w.ha.executed[0].text, /Bravo pour le live/);
  assert.match(w.ha.executed[0].text, /Léa/, "le pseudo, comme le règle Home Assistant");
  w.done();
  const w2 = await world();
  await rule(w2, { name: "Merci", action: "tts:lire", min: "1" });   // pas de case « lire le message »
  live(w2); w2.yt.say(sc(w2, { micros: 12_000_000, comment: "Bravo pour le live" }));
  await play(w2);
  assert.equal(w2.ha.executed.length, 1);
  assert.match(w2.ha.executed[0].text, /Merci pour votre soutien/);
  assert.ok(!/Bravo/.test(w2.ha.executed[0].text), "le message n'est pas lu sans la case");
  w2.done();
});

test("message refusé par la modération de la maison : « ne pas le lire » (défaut) laisse jouer les autres règles ; « merci à la place » dit un merci", async () => {
  for (const mode of ["silent", "thanks"]) {
    const w = await world({ settings: { ifRefused: mode } });
    await rule(w, { name: "Lumière", action: "lumieres:rouge", min: "1" });
    await rule(w, { name: "Voix", action: "tts:lire", readMessage: "on", min: "1" });
    live(w); w.yt.say(sc(w, { comment: "what the shit" }));
    await play(w);
    const keys = w.ha.executed.map((a) => a.key);
    assert.ok(keys.includes("lumieres:rouge"), "l'effet joue quand même");
    const voices = w.ha.executed.filter((a) => a.key === "tts:lire");
    if (mode === "silent") assert.equal(voices.length, 0, "rien n'est lu");
    else { assert.equal(voices.length, 1); assert.ok(/Merci pour votre soutien/.test(voices[0].text) && !/shit/.test(voices[0].text)); }
    const lines = await w.journal();
    const voice = lines.find((l) => l.rule === "Voix");
    assert.equal(voice.status, mode === "silent" ? "refused" : "sent");
    if (mode === "silent") { assert.equal(voice.reason, "blocked"); assert.equal(voice.voiceRefused, true); } else assert.equal(voice.thanks, true);
    assert.ok(!w.dump().includes("what the shit"), "le texte refusé n'est jamais gardé");
    w.done();
  }
});

test("refus de la maison : le motif est journalisé et rien n'est joué (coupé, pas en direct, ne répond plus, pas associé, service absent)", async () => {
  const cases = [
    ["off", async (w) => { await w.bridge.stop({ by: "test" }); }],
    ["not_live", null, { twitchLive: { known: true, live: false } }],
    ["offline", async (w) => { w.tick(70_000); }],
    ["not_paired", null, { paired: false }],
    ["not_installed", null, { noBridge: true }],
  ];
  for (const [reason, prepare, opts] of cases) {
    const w = await world(opts ?? {});
    await rule(w);
    live(w);
    if (prepare) await prepare(w);
    if (reason === "not_installed") {
      const st = await w.read();
      assert.equal(st.status, "no_bridge", "sans le pont, rien n'est lu");
      assert.equal(w.yt.calls.all.length, 0, "et YouTube n'est pas interrogé");
      w.done(); continue;
    }
    w.yt.say(sc(w));
    await w.read();
    const [line] = await w.journal();
    assert.equal(line.status, "refused", reason); assert.equal(line.reason, reason);
    await w.ha.step();
    assert.equal(w.ha.executed.length, 0, "rien n'est joué chez vous");
    w.done();
  }
});

test("seuil en micros de la devise annoncée, sans conversion : 5 EUR au moins ne se déclenche ni à 4,99 € ni pour des dollars ; « toutes devises » n'a pas de seuil", async () => {
  const w = await world();
  await rule(w, { name: "EUR5", min: "5", cooldownSec: "0" });
  await rule(w, { name: "Tous", currency: "*", action: "lumieres:vert", cooldownSec: "0" });
  live(w);
  w.yt.say(sc(w, { id: "a", micros: 4_990_000, currency: "EUR" }), sc(w, { id: "b", micros: 5_000_000, currency: "EUR" }), sc(w, { id: "c", micros: 50_000_000, currency: "USD" }), sc(w, { id: "d", micros: 500_000_000, currency: "JPY" }));
  await w.read();
  const lines = await w.journal();
  const by = (micros, cur) => lines.filter((l) => l.micros === micros && l.currency === cur).map((l) => l.rule).sort();
  assert.deepEqual(by(4_990_000, "EUR"), ["Tous"]);
  assert.deepEqual(by(5_000_000, "EUR"), ["EUR5", "Tous"]);
  assert.deepEqual(by(50_000_000, "USD"), ["Tous"], "des dollars ne passent pas un seuil en euros");
  assert.deepEqual(by(500_000_000, "JPY"), ["Tous"]);
  w.done();
});

test("Super Sticker, nouvelle adhésion, adhésions offertes (nombre minimum) ; le reçu d'une adhésion offerte n'est pas compté deux fois", async () => {
  const w = await world();
  await rule(w, { name: "Sticker", type: "supersticker", min: "2", action: "lumieres:vert", cooldownSec: "0" });
  await rule(w, { name: "Membre", type: "member", action: "lumieres:bleu", cooldownSec: "0" });
  await rule(w, { name: "Cadeaux", type: "gift", min: "5", action: "lumieres:rouge", cooldownSec: "0" });
  live(w);
  w.yt.say(w.yt.superSticker({ micros: 2_000_000, at: Date.now() }), w.yt.member({ at: Date.now() }), w.yt.gift({ count: 3, at: Date.now() }), w.yt.gift({ count: 5, at: Date.now() }), w.yt.received({ at: Date.now() }));
  await w.read();
  const lines = await w.journal();
  const matched = lines.filter((l) => l.rule).map((l) => `${l.kind}:${l.rule}`).sort();
  assert.deepEqual(matched, ["gift:Cadeaux", "member:Membre", "supersticker:Sticker"]);
  assert.equal(lines.filter((l) => l.kind === "gift" && l.status === "skipped").length, 1, "le cadeau de 3 : aucune règle ne correspond");
  assert.equal(lines.length, 4, "le reçu n'ajoute aucune ligne");
  w.done();
});

test("délai de recharge d'une règle : le second don arrive trop tôt (journalisé), puis la règle rejoue", async () => {
  const w = await world();
  await rule(w, { cooldownSec: "30" });
  live(w);
  w.yt.say(sc(w, { id: "1" })); await w.read();
  w.yt.say(sc(w, { id: "2" })); await w.read(16_000);
  let lines = await w.journal();
  assert.equal(lines.find((l) => l.reason === "cooldown").seconds > 0, true);
  assert.equal(lines.filter((l) => l.status === "sent").length, 1);
  w.yt.say(sc(w, { id: "3" })); await w.read(16_000);
  lines = await w.journal();
  assert.equal(lines.filter((l) => l.status === "sent" || l.status === "refused").length, 2, "rejoué après 30 s");
  w.done();
});

test("aucune règle ne correspond : une ligne claire dans le journal, rien n'est envoyé à la maison", async () => {
  const w = await world();
  live(w); w.yt.say(sc(w));
  await w.read();
  const [line] = await w.journal();
  assert.equal(line.status, "skipped"); assert.equal(line.reason, "no_rule");
  assert.equal((await w.ha.step()).actions.length, 0);
  w.done();
});

test("le même message n'est joué qu'une fois, même si YouTube le renvoie ou si le curseur est perdu", async () => {
  const w = await world();
  await rule(w, { cooldownSec: "0" });
  live(w);
  const m = sc(w, { id: "same-id-1" });
  w.yt.say(m);
  await w.read();
  // le curseur est perdu (état effacé) : YouTube rend le même message
  await S.updateState(w.ctx, (d) => { d.cursor = null; d.nextPollAt = 0; });
  await w.read(16_000);
  // et une autre fois, avec l'empreinte oubliée aussi : Home Assistant reconnaît la référence
  await S.updateState(w.ctx, (d) => { d.cursor = null; d.seen = []; d.nextPollAt = 0; });
  await w.read(16_000);
  await w.ha.step();
  assert.equal(w.ha.executed.length, 1, "une seule exécution chez vous");
  w.done();
});

test("page rouverte en plein direct : les dons trop anciens ne rallument rien (une seule ligne les résume)", async () => {
  const w = await world();
  await rule(w, { cooldownSec: "0" });
  live(w);
  w.yt.say(sc(w, { id: "old1", at: Date.now() - 20 * 60_000 }), sc(w, { id: "old2", at: Date.now() - 10 * 60_000 }), sc(w, { id: "new1", at: Date.now() - 5_000 }));
  await w.read();
  const lines = await w.journal();
  assert.equal(lines.filter((l) => l.kind === "system" && l.event === "old")[0].count, 2);
  assert.equal(lines.filter((l) => l.status === "sent").length, 1);
  w.done();
});

/* ───────────── « !stop » / « !start » ───────────── */

const cmd = (w, text, o) => w.yt.text({ text, at: Date.now(), ...o });
const houseOn = async (w) => (await w.bridge.status()).enabled;

test("!stop : la propriétaire et les modérateurs (indicateurs de YouTube) coupent ; un faux modérateur par pseudo ne coupe rien", async () => {
  const w = await world();
  live(w);
  w.yt.say(cmd(w, "!stop", { who: "Moderateur", id: "f1" }), cmd(w, "!stop", { who: "Emma (modo)", id: "f2" }), cmd(w, "!stop", { who: "Admin", member: true, id: "f3" }));
  await w.read();
  assert.equal(await houseOn(w), true, "aucun faux modérateur ne coupe");
  let lines = await w.journal();
  assert.equal(lines.filter((l) => l.kind === "command" && l.status === "refused" && l.reason === "role").length, 3);
  w.yt.say(cmd(w, "!stop", { who: "Vrai modo", mod: true, id: "m1" }));
  await w.read(16_000);
  assert.equal(await houseOn(w), false, "un vrai modérateur coupe");
  lines = await w.journal();
  assert.ok(lines.some((l) => l.kind === "command" && l.status === "done" && l.command === "stop" && l.who === "Vrai modo"));
  w.done();
});

test("!stop d'un modérateur est refusé si le réglage l'interdit ; !start est réservé à la propriétaire", async () => {
  const w = await world({ settings: { modsStop: false } });
  live(w);
  w.yt.say(cmd(w, "!stop", { who: "Modo", mod: true, id: "a" }));
  await w.read();
  assert.equal(await houseOn(w), true);
  w.yt.say(cmd(w, "!stop", { who: "Emma", owner: true, id: "b" }));
  await w.read(16_000);
  assert.equal(await houseOn(w), false, "la propriétaire coupe toujours");
  w.yt.say(cmd(w, "!start", { who: "Modo", mod: true, id: "c" }));
  await w.read(16_000);
  assert.equal(await houseOn(w), false, "un modérateur ne reprend pas");
  w.yt.say(cmd(w, "!start", { who: "Emma", owner: true, id: "d" }));
  await w.read(16_000);
  assert.equal(await houseOn(w), true, "la propriétaire reprend");
  w.done();
});

test("un vieux « !stop » ou « !start » relu dans l'historique est ignoré (jamais rejoué)", async () => {
  const w = await world();
  live(w);
  w.yt.say(cmd(w, "!stop", { who: "Emma", owner: true, id: "oldstop", at: Date.now() - 5 * 60_000 }));
  await w.read();
  assert.equal(await houseOn(w), true);
  w.done();
});

test("réponse dans le chat : seulement si le connecteur sait écrire ; sinon rien, sans erreur", async () => {
  const w = await world();
  live(w);
  const posted = [];
  const real = w.conn.methods.status;
  w.ctx.api.services.call = ((orig) => async (name, method, args, opts) => {
    if (name === "youtube.api" && method === "chatPost") { posted.push(args); return { ok: true, value: { ok: true } }; }
    if (name === "youtube.api" && method === "status" && w.writable) { const r = await real(); return { ok: true, value: { ...r, chat: { read: true, write: true } } }; }
    return orig(name, method, args, opts);
  })(w.ctx.api.services.call);
  w.yt.say(cmd(w, "!stop", { who: "Emma", owner: true, id: "s1" }));
  await w.read();
  assert.equal(await houseOn(w), false);
  assert.deepEqual(posted, [], "le connecteur ne sait pas écrire : aucune réponse, aucune erreur");
  w.writable = true;
  w.yt.say(cmd(w, "!start", { who: "Emma", owner: true, id: "s2" }));
  await w.read(16_000);
  assert.equal(await houseOn(w), true);
  assert.equal(posted.length, 1); assert.equal(posted[0].liveChatId, "Cg0KC2xpdmVjaGF0MQ"); assert.ok(/reprit|repris/i.test(posted[0].text));
  w.done();
});

/* ───────────── Page ouverte ou fermée ───────────── */

test("page fermée : aucun appel à YouTube, rien ne tourne ; la page ouverte lit, plusieurs onglets ne doublent jamais les appels", async () => {
  const w = await world();
  await rule(w);
  live(w); w.yt.say(sc(w));
  w.tick(10 * 60_000);   // personne n'a ouvert la page, dix minutes passent
  assert.equal(w.yt.calls.all.length, 0);
  assert.equal(w.ctx.calls.net.length, 0);
  // cinq onglets se rechargent en même temps
  await Promise.all([1, 2, 3, 4, 5].map(() => E.tick(w.ctx)));
  assert.equal(w.yt.calls.chat.length, 1, "un seul appel de lecture pour cinq onglets");
  assert.equal(w.yt.calls.detect, 2, "et une seule recherche du direct (2 appels)");
  // ils se rechargent encore avant l'heure : rien de plus
  for (let i = 0; i < 4; i++) { w.tick(1000); await Promise.all([E.tick(w.ctx), E.tick(w.ctx)]); }
  assert.equal(w.yt.calls.chat.length, 1);
  const o = await E.overview(w.ctx);
  assert.equal(o.open, true); assert.equal(o.reading, true);
  w.tick(100_000);
  const closed = await E.overview(w.ctx);
  assert.equal(closed.open, false, "plus de battement de cœur depuis 100 s : la page est fermée");
  assert.equal(closed.reading, false);
  w.done();
});

test("cadence : jamais avant le réglage, et jamais avant pollingIntervalMillis quand YouTube demande plus lent ; un seul curseur d'un tour à l'autre", async () => {
  const w = await world({ yt: { pollingMs: 30_000 } });
  live(w);
  await w.read();
  assert.equal(w.yt.calls.chat.length, 1);
  assert.equal(w.yt.calls.chat[0].pageToken, null);
  await w.read(15_000); assert.equal(w.yt.calls.chat.length, 1, "YouTube demande 30 s : à 15 s, rien");
  await w.read(15_001); assert.equal(w.yt.calls.chat.length, 2);
  assert.match(w.yt.calls.chat[1].pageToken, /^t\d+$/, "le curseur de la page précédente est repris");
  assert.ok(w.yt.calls.chat.every((c) => c.maxResults === 500));
  w.done();
  const w2 = await world({ yt: { pollingMs: 1000 }, settings: { intervalSec: 5 } });
  live(w2);
  await w2.read(); await w2.read(4_900); assert.equal(w2.yt.calls.chat.length, 1, "le réglage borne aussi (5 s au plus souvent)");
  await w2.read(200); assert.equal(w2.yt.calls.chat.length, 2);
  w2.done();
});

test("hors direct : aucune lecture du chat ; le direct est cherché chaque minute seulement", async () => {
  const w = await world();
  let st = await w.read();
  assert.equal(st.status, "idle");
  assert.equal(w.yt.calls.chat.length, 0);
  assert.equal(w.yt.calls.detect, 2);
  await w.read(30_000); await w.read(29_000);
  assert.equal(w.yt.calls.detect, 2, "pas de nouvelle recherche avant une minute");
  live(w);
  st = await w.read(2_000);
  assert.equal(st.status, "reading"); assert.equal(w.yt.calls.chat.length, 1);
  assert.equal(st.title, "Mon direct");
  w.done();
});

test("page rouverte après une longue absence : le curseur est oublié, on repart du chat actuel", async () => {
  const w = await world();
  live(w); await w.read();
  await w.read(16_000);
  assert.ok(w.yt.calls.chat[1].pageToken);
  await w.read(10 * 60_000);
  assert.equal(w.yt.calls.chat[2].pageToken, null);
  w.done();
});

test("direct sans chat : « pas de chat », aucune lecture ; direct terminé : retour à la recherche", async () => {
  const w = await world();
  live(w, { noChat: true });
  let st = await w.read();
  assert.equal(st.status, "no_chat"); assert.equal(w.yt.calls.chat.length, 0);
  w.yt.endLive(); live(w);
  st = await w.read(61_000);
  assert.equal(st.status, "reading");
  w.yt.next = w.yt.reasonBody(403, "liveChatEnded");
  st = await w.read(16_000);
  assert.equal(st.status, "idle", "le chat est fini : retour à la recherche d'un direct");
  assert.equal(st.error, null, "ce n'est pas une panne");
  w.done();
});

/* ───────────── Limite du jour de YouTube ───────────── */

test("coût compté (5 par lecture, 2 par recherche) ; à la part du jour atteinte, la lecture s'arrête doucement, sans appel, et reprend le lendemain", async () => {
  const w = await world({ settings: { budgetPercent: 5 } });   // 5 % = 500 unités
  live(w);
  await w.read();
  let st = await w.state();
  assert.equal(st.usage.units, 2 + 5, "une recherche (2) et une lecture (5)");
  await S.updateState(w.ctx, (d) => { d.usage.units = 497; });
  const before = w.yt.calls.chat.length;
  st = await w.read(16_000);
  assert.equal(st.status, "budget");
  assert.equal(w.yt.calls.chat.length, before, "aucun appel quand le budget est atteint");
  w.tick(24 * 3600_000 + 1000);
  st = await w.read();
  assert.equal(st.status, "reading"); assert.ok(st.usage.units < 100, "nouveau jour, compteur remis à zéro");
  w.done();
});

test("la limite de YouTube elle-même est atteinte (403 quota) : pause jusqu'à la remise à zéro, aucun appel entre-temps", async () => {
  const w = await world();
  live(w);
  await w.read();
  w.yt.next = w.yt.fail.quota();
  let st = await w.read(16_000);
  assert.equal(st.status, "backoff"); assert.equal(st.error.code, "quota");
  const n = w.yt.calls.all.length;
  for (let i = 0; i < 20; i++) await w.read(60_000);   // 20 minutes de rechargements
  assert.equal(w.yt.calls.all.length, n, "aucun appel pendant la pause");
  w.done();
});

/* ───────────── Pannes : jamais de boucle ───────────── */

test("YouTube en panne (5xx) : la pause double jusqu'à 10 minutes, le nombre d'appels reste petit", async () => {
  const w = await world();
  live(w);
  await w.read();
  w.yt.next = () => w.yt.fail.server(503);
  const t0 = w.yt.calls.chat.length;
  for (let i = 0; i < 120; i++) await w.read(10_000);   // 20 minutes, une page qui se recharge toutes les 10 s
  const attempts = w.yt.calls.chat.length - t0;
  assert.ok(attempts >= 4 && attempts <= 12, `${attempts} essais en 20 minutes`);
  const st = await w.state();
  assert.equal(st.error.code, "network");
  assert.ok(st.backoffUntil - Date.now() <= 10 * 60_000 + 1000);
  w.yt.next = null;
  await w.read(10 * 60_000);
  assert.equal((await w.state()).status, "reading", "YouTube revient : la lecture reprend toute seule");
  w.done();
});

test("YouTube refuse le chat avec la seule clé : pause de 10 minutes pour le chat, sans déclarer la clé refusée (les autres lectures marchent)", async () => {
  const w = await world();
  live(w);
  await w.read();
  w.yt.next = w.yt.fail.denied();
  const st = await w.read(16_000);
  assert.equal(st.status, "backoff"); assert.equal(st.error.code, "chat_denied");
  assert.ok(st.backoffUntil - Date.now() >= 9 * 60_000);
  const status = await w.conn.methods.status();
  assert.equal(status.key, "set", "la clé n'est pas déclarée refusée");
  const ch = await w.conn.methods.request({ endpoint: "videos.list", params: { part: "snippet", id: "LIVEvideo01" } });
  assert.equal(ch.ok, true, "les autres lectures de YouTube continuent");
  w.done();
});

test("clé refusée au départ (recherche du direct) : message clair, pause longue, pas de boucle", async () => {
  const w = await world();
  w.yt.detectFail = w.yt.fail.keyInvalid();
  const st = await w.read();
  assert.equal(st.status, "backoff"); assert.equal(st.error.code, "auth");
  const n = w.yt.calls.all.length;
  for (let i = 0; i < 10; i++) await w.read(30_000);
  assert.equal(w.yt.calls.all.length, n);
  w.done();
});

test("trou noir : la page rend la main dans le temps imparti, le tour se termine ensuite en erreur « ne répond pas »", async () => {
  const w = await world();
  live(w);
  await w.read();
  E.timing.requestMs = 300; B.timing.apiMs = 600; E.timing.renderBudgetMs = 200;
  try {
    w.yt.next = () => w.yt.fail.silence();
    w.tick(16_000);
    const t = Date.now();   // l'horloge est simulée : on mesure en vrai avec performance
    const t0 = performance.now();
    const blocks = await w.panel();
    assert.ok(performance.now() - t0 < 1500, "la page n'attend pas YouTube");
    assert.ok(Array.isArray(blocks) && blocks.length > 3);
    void t;
    await new Promise((r) => setTimeout(r, 900));   // le tour continue en arrière-plan de la requête, puis finit
    const st = await w.state();
    assert.ok(["backoff", "reading"].includes(st.status), st.status);
  } finally { E.timing.requestMs = 8000; B.timing.apiMs = 12_000; E.timing.renderBudgetMs = 4500; w.done(); }
});

test("réponse de chat tronquée : traitée comme une panne passagère, jamais comme un don", async () => {
  const w = await world();
  await rule(w);
  live(w); await w.read();
  w.yt.next = { status: 200, text: '{"items":[{"id":1},{"id":', headers: { "content-type": "application/json" } };
  const st = await w.read(16_000);
  assert.equal(st.status, "backoff");
  assert.equal((await w.journal()).filter((l) => l.status === "sent").length, 0);
  w.done();
});

/* ───────────── Branchements ───────────── */

test("services absents : le module le dit (pas de pont, pas de connecteur, pas de chaîne) et n'appelle rien", async () => {
  for (const [opts, status] of [[{ noConnector: true }, "no_api"], [{ noChannel: true }, "no_channel"], [{ choice: { status: "ambiguous" } }, "ambiguous"], [{ settings: { readChat: false } }, "off"]]) {
    const w = await world(opts);
    live(w);
    const st = await w.read();
    assert.equal(st.status, status);
    assert.equal(w.yt.calls.all.length, 0);
    w.done();
  }
});

test("rien ne se perd entre deux onglets : l'état partagé, jamais deux fois la même ligne de journal", async () => {
  const w = await world();
  await rule(w, { cooldownSec: "0" });
  live(w); w.yt.say(sc(w, { id: "x1" }), sc(w, { id: "x2" }));
  await Promise.all([E.tick(w.ctx), E.tick(w.ctx), E.tick(w.ctx)]);
  const lines = await w.journal();
  assert.equal(lines.length, 2);
  w.done();
});

test("le journal est borné à 50 lignes, le texte des messages n'est jamais gardé, aucune clé ne fuit dans le stockage", async () => {
  const w = await world();
  await rule(w, { cooldownSec: "0", action: "tts:lire", readMessage: "on", min: "0" });
  live(w);
  for (let i = 0; i < 70; i++) w.yt.say(sc(w, { id: `bulk-${i}`, comment: `secret-message-${i}` }));
  await w.read();
  const lines = await w.journal();
  assert.equal(lines.length, 50);
  const dump = w.dump();
  assert.ok(!/secret-message/.test(dump), "le texte d'un message n'est pas gardé");
  assert.ok(!/FAKE-YT-KEY/.test(dump), "pas de clé");
  assert.ok(!dump.includes("UCaaaaaaaaaaaaaaaaaaaaaa"), "pas de copie de l'identifiant de chaîne (il appartient à Chaîne YouTube)");
  assert.ok((await w.state()).seen.length <= 600);
  w.done();
});

test("la clé YouTube ne voyage que dans l'en-tête du connecteur : jamais dans une adresse, un journal ou un message d'erreur de ce module", async () => {
  const w = await world();
  live(w);
  await w.read();
  assert.ok(w.yt.fetch.calls.length > 0);
  for (const c of w.yt.fetch.calls) assert.ok(!c.url.includes("FAKE-YT-KEY"), c.url);
  assert.ok(!JSON.stringify(w.ctx.calls.netLog).includes("FAKE-YT-KEY"));
  w.done();
});

test("droits : aucune permission réseau directe ; tout passe par le service du connecteur (jamais ctx.api.net dans ce module)", async () => {
  const fs = await import("node:fs");
  const dir = new URL("../modules/youtube-live-actions/", import.meta.url).pathname;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
    const src = fs.readFileSync(`${dir}${f}`, "utf8").replace(/\/\/.*$/gm, "");
    assert.ok(!/api\.net|\bfetch\(|setInterval|node:http|node:https/.test(src), `${f} : réseau direct ou minuteur répétitif`);
  }
  assert.ok(ALL_RIGHTS.includes("yt.manage") && ALL_RIGHTS.includes("yt.test"));
});
