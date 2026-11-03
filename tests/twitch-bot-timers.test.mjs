// Bot Twitch : les timers. Aucun minuteur de fond : un timer n'est regardé qu'à l'arrivée d'un message du chat. On vérifie l'intervalle, le nombre de lignes, l'ordre,
// l'arrêt d'urgence, le direct, la limite de réponses, l'état borné, « Envoyer maintenant », la saisie et la période de validité des timers.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHmac } from "node:crypto";
import { htmlOf, rowsOf, configOf, formOfBlocks, plain } from "./helpers/ui.mjs";
import { world, chat, NOW, S, SRC, C, es } from "./helpers/botWorld.mjs";

const T = await import("../modules/twitch-bot/timers.mjs");
const TA = await import("../modules/twitch-bot/timersAdmin.mjs");
const W = await import("../modules/twitch-bot/webhook.mjs");
const def = (await import("../modules/twitch-bot/index.mjs")).default;
const A = await import("../modules/twitch-bot/admin.mjs");
const tools = (await import("../modules/twitch-bot/tools.mjs")).default;
const MIN = 60_000;

const fresh = (o = {}) => { T.resetTimersMemory(); return world(o); };
// Un « timer » est le réglage « Répéter automatiquement » d'une commande : on crée la commande (sa réponse est « Message <nom> ») avec sa répétition. Rend la clé de la commande.
const add = async (ctx, name, o = {}) => {
  const { text = `Message ${name}`, minutes = 10, lines = 3, when = "live", enabled = true, ...rest } = o;
  const info = await A.context(ctx, { declare: false });
  const r = await C.saveCommand(ctx, { kind: "custom" }, { name: name.toLowerCase().replace(/\s+/g, ""), text, role: "everyone", enabled: true, repeat: { minutes, lines, when, enabled }, ...rest }, info.env);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.key;
};
let n = 0;
const line = (ctx, now, over = {}) => T.processTimers(ctx, chat("bonjour", { messageId: `L${++n}`, chatterId: `c${n % 7}`, login: `viewer${n % 7}`, ...over }), { now });
const lines = async (ctx, count, now) => { let last; for (let i = 0; i < count; i++) last = await line(ctx, now); return last; };
const texts = (tw) => tw.chat.map((m) => m.message);

test("intervalle ET lignes : rien au premier message, rien avant l'intervalle, rien sans assez de lignes ; puis UN message, et l'état repart de zéro", async () => {
  const { ctx, tw } = fresh();
  await add(ctx, "Rappel");
  assert.deepEqual((await line(ctx, NOW)).sent, false, "le premier message ne fait qu'armer le timer");
  await lines(ctx, 5, NOW + 5 * MIN);
  assert.equal(tw.chat.length, 0, "intervalle pas écoulé");
  const t0 = NOW + 10 * MIN;
  const r = await line(ctx, t0 - 1000);
  assert.equal(r.sent, false);
  assert.equal(texts(tw).length, 0);
  const ok = await line(ctx, t0);
  assert.deepEqual([ok.sent, texts(tw)], [true, ["Message Rappel"]], "dû exactement à l'intervalle (borne incluse)");
  const again = await lines(ctx, 50, t0 + 5 * MIN);
  assert.equal(again.sent, false);
  assert.equal(tw.chat.length, 1, "l'intervalle repart du dernier envoi");
  assert.equal((await line(ctx, t0 + 10 * MIN)).sent, true);
  assert.equal(tw.chat.length, 2);
});

test("lignes minimum : l'intervalle écoulé ne suffit pas, il faut aussi assez de lignes DEPUIS le dernier envoi", async () => {
  const { ctx, tw } = fresh();
  await add(ctx, "Rappel", { minutes: 1, lines: 5 });
  await line(ctx, NOW);   // ce premier message arme le timer et compte pour une ligne
  assert.equal((await line(ctx, NOW + 2 * MIN)).sent, false);
  assert.equal((await line(ctx, NOW + 2 * MIN + 1)).sent, false);
  assert.equal((await line(ctx, NOW + 2 * MIN + 2)).sent, false, "4 lignes");
  assert.equal((await line(ctx, NOW + 2 * MIN + 3)).sent, true, "5 lignes");
  assert.equal(tw.chat.length, 1);
  assert.equal((await line(ctx, NOW + 4 * MIN)).sent, false, "les lignes d'avant l'envoi ne comptent plus");
  const zero = fresh();
  await add(zero.ctx, "Sans minimum", { minutes: 1, lines: 0 });
  await line(zero.ctx, NOW);
  assert.equal((await line(zero.ctx, NOW + MIN)).sent, true, "0 ligne minimum : l'intervalle suffit");
});

test("plusieurs timers dus en même temps : UN message par message du chat, dans l'ordre de la liste ; les autres attendent le suivant", async () => {
  const { ctx, tw } = fresh();
  for (const nm of ["A", "B", "C"]) await add(ctx, nm, { minutes: 1, lines: 0 });
  await line(ctx, NOW);
  const due = NOW + MIN;
  const outs = [];
  for (let i = 0; i < 4; i++) { const r = await line(ctx, due + i); outs.push(r.sent); }
  assert.deepEqual(outs, [true, true, true, false]);
  assert.deepEqual(texts(tw), ["Message A", "Message B", "Message C"]);
  assert.equal(tw.chat.length, 3);
});

test("arrêt d'urgence : rien n'est envoyé pendant l'arrêt, et pas de rafale au retour (les compteurs repartent de zéro)", async () => {
  const { ctx, tw } = fresh();
  await add(ctx, "A", { minutes: 1, lines: 0 }); await add(ctx, "B", { minutes: 1, lines: 0 });
  await line(ctx, NOW);
  await S.setMuted(ctx, true);
  const r = await line(ctx, NOW + 5 * MIN);
  assert.deepEqual([r.sent, r.why, tw.chat.length], [false, "muted", 0]);
  await S.setMuted(ctx, false);
  assert.equal((await line(ctx, NOW + 5 * MIN + 1000)).sent, false, "l'attente repart au retour : pas de rafale");
  assert.equal(tw.chat.length, 0);
  assert.equal((await line(ctx, NOW + 6 * MIN + 1000)).sent, true);
});

test("le bot coupé ou pas prêt : un timer n'écrit jamais ; un message d'une autre chaîne ne compte pas", async () => {
  const { ctx, tw } = fresh({ tw: { mainStatus: "none" } });
  await add(ctx, "A", { minutes: 1, lines: 0, when: "always" });
  await line(ctx, NOW);
  assert.deepEqual([(await line(ctx, NOW + MIN)).why, tw.chat.length], ["not_ready", 0]);
  const w = fresh();
  await add(w.ctx, "A", { minutes: 1, lines: 0, when: "always" });
  await line(w.ctx, NOW);
  assert.equal((await line(w.ctx, NOW + MIN, { broadcasterId: "999" })).sent, false);
  assert.equal(w.tw.chat.length, 0);
});

test("en direct seulement : rien hors direct (les lignes ne comptent pas) ; le début du direct repart de zéro ; « toujours » écrit hors direct", async () => {
  const { ctx, tw } = fresh({ tw: { live: { channel: "emma", configured: true, known: true, live: false, title: "", game: "", startedAt: null } } });
  const A_ = await add(ctx, "Live", { minutes: 1, lines: 2, when: "live" });
  const B_ = await add(ctx, "Toujours", { minutes: 1, lines: 2, when: "always" });
  void A_; void B_;
  await line(ctx, NOW);
  await lines(ctx, 5, NOW + 3 * MIN);
  assert.deepEqual(texts(tw), ["Message Toujours"], "hors direct, seul le timer « toujours » écrit");
  const live = { channel: "emma", configured: true, known: true, live: true, title: "T", game: "G", startedAt: new Date(NOW).toISOString() };
  const w = tw; void w;
  SRC.resetSources();
  const live2 = fresh();
  await add(live2.ctx, "Live", { minutes: 1, lines: 2, when: "live" });
  live2.tw.live = { ...live, live: false };
  await line(live2.ctx, NOW);
  await lines(live2.ctx, 10, NOW + 2 * MIN);
  assert.equal(live2.tw.chat.length, 0);
  live2.tw.live = live; SRC.resetSources();
  assert.equal((await line(live2.ctx, NOW + 3 * MIN)).sent, false, "le direct vient de commencer : on repart de zéro");
  await lines(live2.ctx, 2, NOW + 3 * MIN + 1);
  assert.equal(live2.tw.chat.length, 0, "l'intervalle repart du début du direct");
  assert.equal((await line(live2.ctx, NOW + 4 * MIN + 10)).sent, true);
});

test("limite de réponses du bot : un timer ne dépasse jamais la limite, et ne se perd pas (il écrit au message suivant)", async () => {
  const { ctx, tw } = fresh({ settings: { maxPer30s: 1 } });
  await add(ctx, "A", { minutes: 1, lines: 0 }); await add(ctx, "B", { minutes: 1, lines: 0 });
  await line(ctx, NOW);
  const E = await import("../modules/twitch-bot/engine.mjs");
  await C.mutate(ctx, (cfg) => { cfg.custom.push({ id: "c1", name: "salut", aliases: [], text: "Salut", role: "everyone", enabled: true, cdGlobal: 0, cdUser: 0 }); return { ok: true }; });
  assert.equal((await E.processChat(ctx, chat("!salut", { messageId: "cmd1" }), { now: NOW + MIN })).result, "sent");
  assert.equal((await line(ctx, NOW + MIN + 1)).why, "rate");
  assert.equal(tw.chat.length, 1, "seule la commande a écrit");
  assert.equal((await line(ctx, NOW + MIN + 31_000)).sent, true);
  assert.equal(texts(tw)[1], "Message A");
});

test("une commande qui vient de répondre à ce message : les timers attendent le message suivant", async () => {
  const { ctx, tw } = fresh();
  await add(ctx, "A", { minutes: 1, lines: 0 });
  await line(ctx, NOW);
  const r = await T.processTimers(ctx, chat("!x", { messageId: "z1" }), { now: NOW + MIN, commandSent: true });
  assert.equal(r.sent, false);
  assert.equal((await line(ctx, NOW + MIN + 1)).sent, true);
  assert.equal(tw.chat.length, 1);
});

test("les messages du bot lui-même, des bots connus et des autres chaînes ne comptent pas comme des lignes", async () => {
  const { ctx, tw } = fresh();
  await add(ctx, "A", { minutes: 1, lines: 4 });
  await line(ctx, NOW);
  S.rememberSent(ctx, "own1");
  for (const over of [{ messageId: "own1" }, { login: "nightbot" }, { foreign: true }, { login: "streamelements" }]) await line(ctx, NOW + 2 * MIN, over);
  assert.equal((await lines(ctx, 2, NOW + 2 * MIN)).sent, false, "2 vraies lignes seulement");
  assert.equal((await line(ctx, NOW + 2 * MIN)).sent, true, "la 4e vraie ligne (avec celle qui arme)");
  assert.equal(tw.chat.length, 1);
});

test("un envoi refusé par Twitch ne perd pas le timer : il reste dû et réessaie plus tard (pas à chaque message)", async () => {
  const { ctx, tw } = fresh();
  await add(ctx, "A", { minutes: 1, lines: 0 });
  await line(ctx, NOW);
  tw.chatReply = { ok: true, status: 200, json: { data: [{ is_sent: false, drop_reason: { code: "msg_duplicate" } }] } };
  const r = await line(ctx, NOW + MIN);
  assert.deepEqual([r.sent, r.why], [false, "send_dropped"]);
  const calls = tw.calls.length;
  await line(ctx, NOW + MIN + 1000);
  assert.equal(tw.calls.length, calls, "pas de nouvel essai tout de suite");
  tw.chatReply = null;
  assert.equal((await line(ctx, NOW + MIN + 31_000)).sent, true);
  assert.equal((await S.readLog(ctx)).find((e) => e.result === "error").command, "⏱ !a");
});

test("état borné : 20 timers au plus, état écrit au plus toutes les 10 s, timers supprimés oubliés, rien d'écrit pour ce que les gens disent", async () => {
  const { ctx, tw } = fresh();
  for (let i = 0; i < 20; i++) await add(ctx, `T${i}`, { minutes: 1440, lines: 200, when: "always" });
  const info = await A.context(ctx, { declare: false });
  const r = await C.saveCommand(ctx, { kind: "custom" }, { name: "t21", text: "x", repeat: { minutes: 5, lines: 0, when: "always" } }, info.env);
  assert.deepEqual([r.ok, r.code], [false, "timer_many"]);
  const writes = () => ctx.calls.writes.filter((w) => w.collection === "botTimers").length;
  await line(ctx, NOW);
  const w0 = writes();
  for (let i = 0; i < 200; i++) await line(ctx, NOW + 1000 + i * 10, { text: "mot secret du public" });
  assert.ok(writes() - w0 <= 1, `pas d'écriture à chaque message (${writes() - w0})`);
  await line(ctx, NOW + 12_000);
  const doc = (await ctx.api.store.list("botTimers", { limit: 5 }));
  assert.equal(doc.length, 1);
  const items = doc[0].data.items;
  assert.ok(Object.keys(items).length <= 20);
  assert.ok(Object.values(items).every((x) => Object.keys(x).sort().join() === "lastAt,lines" && Number.isInteger(x.lines)));
  assert.ok(!JSON.stringify(await ctx.dumpStore()).includes("mot secret"), "aucun message du chat n'est gardé");
  const first = (await C.loadConfig(ctx)).data.custom[0];
  const id = `custom:${first.id}`;
  assert.ok(id in (await ctx.api.store.list("botTimers", { limit: 5 }))[0].data.items);
  await T.setRepeat(ctx, { kind: "custom", id: first.id }, null, info.env);
  await line(ctx, NOW + 30_000);
  await line(ctx, NOW + 60_000);
  assert.ok(!(id in (await ctx.api.store.list("botTimers", { limit: 5 }))[0].data.items), "le timer supprimé n'a plus d'état");
  assert.equal(tw.chat.length, 0);
});

test("l'état survit à un redémarrage (lu dans le stockage) et aucun minuteur de fond n'existe", async () => {
  const { ctx, tw } = fresh();
  await add(ctx, "A", { minutes: 1, lines: 2, when: "always" });
  await line(ctx, NOW);
  await line(ctx, NOW + 20_000); await line(ctx, NOW + 40_000);   // 2 lignes : écrites au plus tard à la prochaine écriture
  await line(ctx, NOW + 50_000);
  T.resetTimersMemory();   // « redémarrage »
  const r = await line(ctx, NOW + MIN + 1);
  assert.equal(r.sent, true, "intervalle et lignes relus depuis le stockage");
  assert.equal(tw.chat.length, 1);
  assert.deepEqual(Object.keys(def.tasks).sort(), ["listen", "tidy"], "aucune tâche de timers");
  const dir = new URL("../modules/twitch-bot/", import.meta.url).pathname;
  for (const f of ["timers.mjs", "draw.mjs", "manage.mjs", "engine.mjs", "webhook.mjs"]) assert.ok(!/setInterval\(/.test(fs.readFileSync(dir + f, "utf8")), `${f} : pas de setInterval`);
});

test("« Envoyer maintenant » : sans attendre l'intervalle, hors direct si besoin ; jamais pendant l'arrêt d'urgence ni si le bot n'est pas prêt ; la limite de réponses compte", async () => {
  const { ctx, tw } = fresh({ tw: { live: { channel: "emma", configured: true, known: true, live: false, title: "", game: "", startedAt: null } } });
  const id = await add(ctx, "Pub", { minutes: 1440, lines: 200, when: "live" });
  const ok = await TA.actions.timerSend.run(ctx, { id });
  assert.deepEqual([ok.ok, texts(tw)], [ctx.t("tm_sent"), ["Message Pub"]]);
  assert.match((await S.readLog(ctx))[0].command, /^⏱ !pub/);
  await S.setMuted(ctx, true);
  assert.equal((await TA.actions.timerSend.run(ctx, { id })).error, ctx.t("tm_send_muted"));
  await S.setMuted(ctx, false);
  assert.equal((await TA.actions.timerSend.run(ctx, { id: "nope" })).error, ctx.t("tm_send_unknown"));
  const bad = fresh({ tw: { mainStatus: "none" } });
  const id2 = await add(bad.ctx, "Pub");
  assert.equal((await TA.actions.timerSend.run(bad.ctx, { id: id2 })).error, bad.ctx.t("tm_send_not_ready"));
  const lim = fresh({ settings: { maxPer30s: 1 } });
  const id3 = await add(lim.ctx, "Pub");
  assert.ok((await TA.actions.timerSend.run(lim.ctx, { id: id3 })).ok);
  assert.equal((await TA.actions.timerSend.run(lim.ctx, { id: id3 })).error, lim.ctx.t("tm_send_rate"));
});

/* ───────────── Saisie, droits, administration, outils ───────────── */

test("« Ajouter un timer » : créer une nouvelle commande (nom + réponse), erreurs sous le champ avec un exemple ; la commande se répète déjà", async () => {
  const { ctx } = fresh();
  const ok = await TA.actions.timerNew.run(ctx, { name: "Discord", text: "Rejoignez le Discord.", repeatEvery: "900" });
  assert.equal(ok.ok, ctx.t("tm_created"));
  assert.match(ok.redirect, /^\?tab=use&edit=custom%3A.+&repeat=1#edit$/);
  const c = (await C.loadConfig(ctx)).data.custom[0];
  assert.deepEqual([c.name, c.timerOnly, c.repeat], ["discord", undefined, { minutes: 15, lines: 5, when: "live", enabled: true }]);
  const err = async (over) => (await TA.actions.timerNew.run(ctx, { name: "Autre", text: "Salut", ...over }));
  assert.match((await err({ name: "discord" })).errors.name, /discord/, "nom déjà pris : sous le champ");
  assert.match((await err({ name: "!!" })).errors.name, /./, "nom invalide : sous le champ");
  assert.match((await err({ text: "" })).errors.text, /./);
  assert.match((await err({ repeatEvery: "90" })).errors.repeatEvery, /entre 1 et 1440.*15/, "pas un nombre entier de minutes");
  assert.match((await err({ repeatEvery: "100000" })).errors.repeatEvery, /entre 1 et 1440/);
  const only = await TA.actions.timerNew.run(ctx, { name: "Pub", text: "Pensez à boire.", timerOnly: "on", repeatEvery: "1800" });
  assert.equal(only.ok, ctx.t("tm_created"));
  const pub = (await C.loadConfig(ctx)).data.custom.find((x) => x.name === "pub");
  assert.deepEqual([pub.timerOnly, pub.repeat.minutes], [true, 30]);
  assert.equal((await C.loadConfig(ctx)).data.custom.length, 2, "les erreurs n'ont rien créé");
  for (const k of ["timerNew", "timerToggle", "timerRemove", "timerSend"]) assert.equal(TA.actions[k].right, "timers.manage", k);
  for (const k of Object.keys(TA.actions)) assert.equal(A.actions[k], TA.actions[k]);
});

test("réglage sur la page d'une commande : durée en secondes (minutes entières, 1 à 1440), lignes 0 à 200, interrupteur = pause ; « Seulement pour le timer » exige une répétition", async () => {
  const { ctx } = fresh();
  const key = await add(ctx, "Rappel", { minutes: 20, lines: 4, when: "always" });
  const base = { key, name: "rappel", text: "Message Rappel", role: "everyone", aliases: "", repeatOn: "on", repeatEvery: "1200", repeatLines: "4", repeatWhen: "always" };
  const cmd = async () => (await C.loadConfig(ctx)).data.custom[0];
  assert.equal((await A.actions.save(ctx, { ...base, repeatEvery: "3600", repeatLines: "0", repeatWhen: "live" })).ok, ctx.t("saved"));
  assert.deepEqual((await cmd()).repeat, { minutes: 60, lines: 0, when: "live", enabled: true });
  assert.match((await A.actions.save(ctx, { ...base, repeatEvery: "30" })).errors.repeatEvery, /entre 1 et 1440.*15/);
  assert.match((await A.actions.save(ctx, { ...base, repeatEvery: "90000" })).errors.repeatEvery, /entre 1 et 1440/);
  assert.match((await A.actions.save(ctx, { ...base, repeatLines: "201" })).errors.repeatLines, /entre 0 et 200.*5/);
  assert.equal((await cmd()).repeat.minutes, 60, "la saisie refusée ne change rien");
  // interrupteur éteint (absent du formulaire) : pause, les réglages restent
  const { repeatOn, ...off } = base;
  assert.equal((await A.actions.save(ctx, { ...off, repeatEvery: "3600", repeatLines: "0" })).ok, ctx.t("saved"));
  assert.deepEqual((await cmd()).repeat, { minutes: 60, lines: 0, when: "live", enabled: false });
  // réservée au timer : refusée sans aucune répétition
  const info = await A.context(ctx, { declare: false });
  await C.saveCommand(ctx, { kind: "custom" }, { name: "ordinaire", text: "Texte" }, info.env);
  const ord = (await C.loadConfig(ctx)).data.custom.find((x) => x.name === "ordinaire");
  assert.match((await A.actions.save(ctx, { key: `custom:${ord.id}`, name: "ordinaire", text: "Texte", role: "everyone", repeatEvery: "900", timerOnly: "on" })).errors.timerOnly, /Allumez/);
  assert.equal((await A.actions.save(ctx, { ...base, repeatEvery: "3600", timerOnly: "on" })).ok, ctx.t("saved"));
  assert.equal((await cmd()).timerOnly, true);
  // sans le droit : la répétition n'est pas modifiable depuis le formulaire (le reste l'est)
  const ro = fresh({ can: false });
  const k2 = await add(ro.ctx, "Ro", { minutes: 10 });
  await A.actions.save(ro.ctx, { key: k2, name: "ro", text: "Message Ro", role: "everyone", repeatOn: "on", repeatEvery: "6000" });
  assert.equal((await C.loadConfig(ro.ctx)).data.custom[0].repeat.minutes, 10);
});

test("administration : l'onglet Timers est UN tableau des commandes qui se répètent (recherche, pastilles, interrupteur, 2 actions), l'état dit quand ça part ; sans le droit, rien à modifier", async () => {
  const { ctx } = fresh();
  const key = await add(ctx, "Rappel", { text: "Allez sur {chaine} : {calcul 2+3}", minutes: 10, lines: 3 });
  await add(ctx, "Pause", { enabled: false, minutes: 90, lines: 5 });
  const page = await A.panel(ctx, { query: { tab: "timers" } });
  const tab = page.filter((b) => b.tab === "timers");
  assert.ok(tab.length >= 2 && tab.every((b) => b.tab === "timers"));
  assert.match(JSON.stringify(tab), /Les commandes que le bot répète tout seul/);
  const html = htmlOf(tab, "timers"), rows = rowsOf(html), row = rows.find((r) => r.cells.name === "!rappel");
  assert.equal(rows.length, 2);
  assert.match(html, /data-ck-q/, "recherche dès le départ");
  assert.match(row.html, /data-ck-act="timerSend"[^>]*data-ck-confirm/);
  assert.equal((row.html.match(/class="ck-btn small/g) ?? []).length, 2, "au plus deux actions visibles");
  assert.ok(row.html.includes(`href="?tab=use&amp;edit=${encodeURIComponent(key)}&amp;repeat=1#edit"`), "Modifier ouvre la commande sur son bloc");
  assert.equal(row.cells.org, "toutes les 10 min Au moins 3 messages");
  assert.match(row.html, /title="Prêt : il compte à partir du prochain message du chat"/);
  assert.match(rows.find((r) => r.cells.name === "!pause").html, /aria-checked="false"[^>]*data-ck-act="timerToggle"/);
  assert.equal(rows.find((r) => r.cells.name === "!pause").cells.org, "toutes les 90 min", "5 messages en direct = l'ordinaire : rien de plus (R14)");
  assert.ok(!/ck-origin timer/.test(html), "aucune pastille quand rien ne sort de l'ordinaire");
  assert.match(html, /data-ck-val="off"[^>]*>En pause <b>1<\/b>/);
  const ro = fresh({ can: false });
  await add(ro.ctx, "Rappel");
  const roTab = (await A.panel(ro.ctx, { query: { tab: "timers", timerAdd: "1" } })).filter((b) => b.tab === "timers");
  assert.ok(!roTab.some((b) => b.type === "adminForm") && !/Ajouter un timer/.test(JSON.stringify(roTab)));
  assert.match(rowsOf(htmlOf(roTab, "timers"))[0].html, /disabled/);
  const manifest = JSON.parse(fs.readFileSync(new URL("../modules/twitch-bot/module.json", import.meta.url), "utf8"));
  assert.ok(manifest.rights.some((r) => r.id === "timers.manage" && r.sensitive && r.default.editor === false));
  assert.ok(manifest.tabs.some((t) => t.id === "timers" && t.panel));
});

test("état vide et « Ajouter un timer » : une phrase + un bouton ; deux voies (choisir une commande avec recherche, ou en créer une : 2 champs visibles) ; les commandes qui se répètent déjà ne sont pas proposées", async () => {
  const { ctx } = fresh();
  const empty = plain((await A.panel(ctx, { query: { tab: "timers" } })).filter((b) => b.tab === "timers").map((b) => b.html ?? "").join(""));
  assert.match(empty, /Aucun timer pour l'instant\. Ajoutez-en un/);
  assert.match(empty, /Ajouter un timer/);
  const info = await A.context(ctx, { declare: false });
  await C.saveCommand(ctx, { kind: "custom" }, { name: "deja", text: "Déjà", repeat: { minutes: 5 } }, info.env);
  await C.saveCommand(ctx, { kind: "custom" }, { name: "libre", text: "Libre" }, info.env);
  const tab = (await A.panel(ctx, { query: { tab: "timers", timerAdd: "1" } })).filter((b) => b.tab === "timers");
  const pick = rowsOf(htmlOf(tab, "timer-pick"));
  const names = pick.map((r) => r.cells.name);
  assert.ok(names.includes("!libre") && names.includes("!jeu") && !names.includes("!deja"), names.join());
  assert.match(pick.find((r) => r.cells.name === "!libre").html, /href="\?tab=use&amp;edit=custom%3A[^"]+&amp;repeat=1#edit"[^>]*>Ajouter ce timer</);
  const html = htmlOf(tab, "timer-pick");
  assert.match(html, /data-ck-q/);
  const form = formOfBlocks(tab, "timerNew");
  assert.equal(form.submitLabel, "Créer la commande et son timer");
  assert.deepEqual(form.fields.filter((f) => !f.folded).map((f) => f.name), ["name", "text"], "chemin court : deux champs visibles");
  assert.deepEqual(form.fields.filter((f) => f.folded).map((f) => f.name), ["timerOnly", "repeatEvery"]);
  assert.ok(form.fields.every((f) => !f.example || !/:$/.test(f.label)));
});

test("outils : lister, créer, modifier un timer (= une commande qui se répète) ; les noms d'outils ne changent pas ; jamais accordés d'office", async () => {
  const { ctx } = fresh();
  assert.deepEqual((await tools.timers_list(ctx, {})).timers, []);
  assert.deepEqual(await tools.timer_create(ctx, { name: "Rappel", text: "Suivez {chaine}", everyMinutes: 20, minChatLines: 4, when: "always" }), { created: true, name: "Rappel" });
  const l = await tools.timers_list(ctx, {});
  assert.deepEqual(l.timers[0], { name: "Rappel", command: "rappel", text: "Suivez {chaine}", everyMinutes: 20, minChatLines: 4, when: "always", enabled: true, timerOnly: true });
  assert.equal(l.maximum, 20);
  assert.deepEqual(await tools.timer_update(ctx, { name: "rappel", enabled: false, everyMinutes: 30 }), { updated: true, name: "Rappel" });
  assert.deepEqual([(await tools.timers_list(ctx, {})).timers[0].enabled, (await tools.timers_list(ctx, {})).timers[0].everyMinutes], [false, 30]);
  await assert.rejects(tools.timer_create(ctx, { name: "Rappel", text: "x", everyMinutes: 5 }), (e) => e.expose && /déjà ce nom/.test(e.message));
  await assert.rejects(tools.timer_create(ctx, { name: "Z", text: "x", everyMinutes: 0 }), (e) => e.expose);
  await assert.rejects(tools.timer_update(ctx, { name: "inconnu", enabled: true }), (e) => e.expose);
  await assert.rejects(tools.timer_update(ctx, { name: "Rappel" }), (e) => e.expose);
  // les outils de commandes lisent et écrivent la répétition
  await tools.bot_command_create(ctx, { name: "merch", text: "La boutique", repeatEveryMinutes: 45, repeatMinChatLines: 2, repeatWhen: "always" });
  const merch = (await tools.bot_commands_list(ctx, {})).commands.find((c) => c.name === "merch");
  assert.deepEqual([merch.repeatEveryMinutes, merch.repeatMinChatLines, merch.repeatWhen, merch.repeatEnabled], [45, 2, "always", true]);
  await tools.bot_command_update(ctx, { name: "jeu", repeatEveryMinutes: 10 });
  assert.equal((await tools.timers_list(ctx, {})).timers.length, 3);
  await tools.bot_command_update(ctx, { name: "merch", clearRepeat: true });
  assert.equal((await tools.bot_commands_list(ctx, {})).commands.find((c) => c.name === "merch").repeatEveryMinutes, undefined);
  await assert.rejects(tools.bot_command_update(ctx, { name: "merch", timerOnly: true }), (e) => e.expose);
  const manifest = JSON.parse(fs.readFileSync(new URL("../modules/twitch-bot/module.json", import.meta.url), "utf8"));
  const m = Object.fromEntries(manifest.mcp.map((x) => [x.name, x]));
  assert.equal(m.timers_list.readOnly, true);
  for (const k of ["timer_create", "timer_update"]) assert.deepEqual([m[k].default, m[k].readOnly, !!m[k].destructive], [false, undefined, false], k);
  for (const k of ["bot_command_create", "bot_command_update"]) for (const p of ["repeatEveryMinutes", "repeatMinChatLines", "repeatWhen", "repeatEnabled", "timerOnly"]) assert.ok(m[k].input.properties[p], `${k}.${p}`);
});

/* ───────────── Par la porte d'entrée : chaque message de Twitch évalue les timers ───────────── */

test("par le webhook : le message de Twitch compte, un timer dû écrit dans le chat (un seul), et un message déjà vu n'est pas compté deux fois", async () => {
  const { ctx, tw } = fresh();
  const secret = await S.ensureSecret(ctx);
  await add(ctx, "Rappel", { minutes: 1, lines: 1, when: "always" });
  const body = (id, text) => JSON.stringify({ subscription: { type: es.TYPE, status: "enabled" }, event: { broadcaster_user_id: "100", chatter_user_id: "200", chatter_user_login: "viewer", chatter_user_name: "Viewer", message_id: id, message: { text }, message_type: "text", badges: [] } });
  const post = async (id, text, at) => {
    const b = body(id, text), ts = new Date(at).toISOString(), mid = `h${id}`;
    const req = new Request("https://site.example.org/m/bot/webhook", { method: "POST", headers: new Headers({ "twitch-eventsub-message-id": mid, "twitch-eventsub-message-timestamp": ts, "twitch-eventsub-message-type": "notification", "twitch-eventsub-message-signature": `sha256=${createHmac("sha256", secret).update(`${mid}${ts}${b}`).digest("hex")}` }), body: b });
    const { response, done } = await W.handle(req, ctx, { now: at }); await done; return response.status;
  };
  assert.equal(await post("a1", "salut", NOW), 204);
  assert.equal(tw.chat.length, 0);
  assert.equal(await post("a2", "coucou", NOW + MIN + 1), 204);
  assert.deepEqual(texts(tw), ["Message Rappel"]);
});
