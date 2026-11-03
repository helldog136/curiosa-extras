// Bot Twitch : la migration des anciens timers (titre + message + rythme) vers les commandes qui se répètent. Additive, sans perte, rejouable, bornée.
// Chaque ancien timer doit continuer à envoyer EXACTEMENT le même message, au même rythme ; l'ancien enregistrement n'est jamais effacé.
import test from "node:test";
import assert from "node:assert/strict";
import { world, chat, NOW, S, C } from "./helpers/botWorld.mjs";

const T = await import("../modules/twitch-bot/timers.mjs");
const M = await import("../modules/twitch-bot/timersMigrate.mjs");
const def = (await import("../modules/twitch-bot/index.mjs")).default;
const MIN = 60_000;

const yearly = (f, t) => ({ yearly: true, from: { d: f[0], m: f[1] }, to: { d: t[0], m: t[1] } });
/** Des timers d'avant, tels qu'un vrai site en avait (avec et sans conditions, titres en double, caractères spéciaux, message vide ou très long, désactivé). */
const LEGACY = [
  { id: "t1", name: "Rappel du Discord", text: "Rejoignez le Discord : lien en description.", minutes: 20, lines: 5, when: "live", enabled: true },
  { id: "t2", name: "Hydratation", text: "Pensez à boire un verre d'eau.", minutes: 30, lines: 0, when: "always", enabled: false },
  { id: "t3", name: "Rappel du Discord", text: "Un autre rappel, avec {chaine} et {calcul 2+3}.", minutes: 45, lines: 12, when: "live", enabled: true },
  { id: "t4", name: "Été — 100 % fun !!", text: "C'est l'été sur {chaine}.", minutes: 10, lines: 3, when: "always", enabled: true, period: yearly([21, 6], [21, 9]) },
  { id: "t5", name: "!!!", text: "Titre sans lettre.", minutes: 15, lines: 5, when: "live", enabled: true },
  { id: "t6", name: "Stop", text: "Un titre réservé.", minutes: 60, lines: 5, when: "live", enabled: true },
  { id: "t7", name: "Vide", text: "", minutes: 5, lines: 1, when: "live", enabled: true },
  { id: "t8", name: "Très long", text: "x".repeat(2000), minutes: 1440, lines: 200, when: "always", enabled: true },
  { id: "t9", name: "Boutique", text: "La boutique est ouverte.", minutes: 25, lines: 5, when: "live", enabled: true },
];
const seed = async (ctx, timers = LEGACY, custom = []) => {
  await ctx.api.store.add("botConfig", { v: 1, custom, builtin: {}, partners: {}, networks: {}, group: {}, timers: structuredClone(timers) });
};
const cfgOf = async (ctx) => (await C.loadConfig(ctx)).data;
const byTitle = (cfg, title) => cfg.custom.find((c) => c.title === title);

test("migration : chaque ancien timer devient une commande réservée au timer ou se rattache à la commande qui dit déjà la même chose ; l'ancien enregistrement reste, inerte et marqué", async () => {
  const { ctx } = world();
  const homonym = { id: "c1", name: "rappeldudiscord", aliases: [], text: "Le Discord, c'est ici.", role: "everyone", enabled: true, cdGlobal: null, cdUser: null };
  const twin = { id: "c2", name: "boutique", aliases: [], text: "La boutique est ouverte.", role: "mods", enabled: true, cdGlobal: 5, cdUser: null };
  await seed(ctx, LEGACY, [homonym, twin]);
  const r = await M.migrateTimers(ctx, { now: NOW });
  assert.deepEqual(r, { migrated: 9, attached: 1, created: 8 });
  const cfg = await cfgOf(ctx);
  // l'ancien enregistrement : tout est là, marqué
  assert.equal(cfg.timers.length, 9);
  for (const old of LEGACY) {
    const kept = cfg.timers.find((x) => x.id === old.id);
    const { migrated, ...rest } = kept;
    assert.deepEqual(rest, old, `${old.id} : rien de l'ancien timer n'a bougé`);
    assert.ok(migrated.into.startsWith("custom:") && ["created", "attached"].includes(migrated.mode) && migrated.at === NOW);
  }
  // rattaché : la commande à vous garde son rôle, son attente, son nom ; elle gagne la répétition
  const t9 = cfg.custom.find((c) => c.id === "c2");
  assert.deepEqual([t9.name, t9.role, t9.cdGlobal, t9.timerOnly, t9.repeat], ["boutique", "mods", 5, undefined, { minutes: 25, lines: 5, when: "live", enabled: true }]);
  assert.equal(cfg.timers.find((x) => x.id === "t9").migrated.into, "custom:c2");
  // créées : message mot pour mot, rythme, état, période ; réservées au timer ; titres gardés
  const d1 = cfg.custom.find((c) => c.id === "t1");
  assert.deepEqual([d1.title, d1.text, d1.timerOnly, d1.repeat, d1.enabled, d1.role], ["Rappel du Discord", LEGACY[0].text, true, { minutes: 20, lines: 5, when: "live", enabled: true }, true, "everyone"]);
  assert.equal(cfg.custom.find((c) => c.id === "t2").repeat.enabled, false, "un timer désactivé reste en pause");
  assert.equal(cfg.custom.find((c) => c.id === "t2").repeat.when, "always");
  assert.deepEqual(cfg.custom.find((c) => c.id === "t4").period, yearly([21, 6], [21, 9]), "la période suit");
  assert.equal(cfg.custom.find((c) => c.id === "t8").text, "x".repeat(2000), "un message très long n'est pas coupé");
  assert.equal(cfg.custom.find((c) => c.id === "t7").text, "", "un message vide n'est pas perdu");
  // noms : uniques, valides, jamais un mot réservé, jamais celui d'une commande qui existe
  const names = cfg.custom.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, names.join());
  assert.ok(names.every((n) => C.NAME_RE.test(n)));
  assert.equal(cfg.custom.find((c) => c.id === "t1").name, "rappeldudiscord2", "homonyme existant : un chiffre en plus");
  assert.equal(cfg.custom.find((c) => c.id === "t3").name, "rappeldudiscord3", "titre en double");
  assert.equal(cfg.custom.find((c) => c.id === "t4").name, "ete100fun");
  assert.equal(cfg.custom.find((c) => c.id === "t5").name, "timer", "aucune lettre : un nom neutre");
  assert.equal(cfg.custom.find((c) => c.id === "t6").name, "stop2", "« stop » est réservé");
  assert.equal(cfg.custom.find((c) => c.id === "t3").title, "Rappel du Discord");
  // journal central : des nombres, jamais de contenu
  const logged = ctx.calls.log.filter((l) => l.action === "timers.migrated");
  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0].data, { count: 9, attached: 1, created: 8 });
  assert.ok(!JSON.stringify(ctx.calls.log).includes("Discord"));
  // JAMAIS déclenchable dans le chat : ni par son nom, ni par son titre
  const E = await import("../modules/twitch-bot/engine.mjs");
  for (const c of cfg.custom.filter((x) => x.timerOnly)) {
    assert.deepEqual(c.aliases, []);
    for (const word of [c.name]) assert.equal((await E.processChat(ctx, chat(`!${word}`, { messageId: `z${c.id}${word}` }), { now: NOW })).handled, false, `!${word}`);
  }
});

test("migration rejouable : un second passage ne change rien, une commande supprimée ensuite n'est pas recréée ; sans ancien timer rien n'est écrit", async () => {
  const { ctx } = world();
  await seed(ctx, LEGACY.slice(0, 3));
  await M.migrateTimers(ctx, { now: NOW });
  const after = structuredClone(await cfgOf(ctx));
  const writes = ctx.calls.writes.length;
  assert.deepEqual(await M.migrateTimers(ctx, { now: NOW + 1 }), { migrated: 0, attached: 0, created: 0 });
  await def.migrations[6](ctx);
  assert.deepEqual(await cfgOf(ctx), after, "idempotente");
  assert.equal(ctx.calls.writes.length, writes, "rien n'est réécrit");
  await C.removeCustom(ctx, "t2");
  await M.migrateTimers(ctx);
  assert.ok(!(await cfgOf(ctx)).custom.some((c) => c.id === "t2"), "la personne l'avait supprimée : elle reste supprimée");
  const none = world();
  await def.migrations[6](none.ctx);
  assert.equal((await none.ctx.api.store.list("botConfig", { limit: 1 })).length, 0, "pas de configuration : rien n'est créé");
  assert.equal(none.ctx.calls.log.length, 0);
  assert.equal(typeof def.migrations[6], "function");
});

test("borné : 20 anciens timers au plus par passage, les commandes réservées au timer ne comptent pas dans la limite des 100 commandes", async () => {
  const { ctx } = world();
  const many = Array.from({ length: 25 }, (_, i) => ({ id: `m${i}`, name: `Timer ${i}`, text: `Message ${i}`, minutes: 10, lines: 0, when: "always", enabled: true }));
  const custom = Array.from({ length: 100 }, (_, i) => ({ id: `k${i}`, name: `cmd${i}`, aliases: [], text: `Texte ${i}`, role: "everyone", enabled: true, cdGlobal: null, cdUser: null }));
  await seed(ctx, many, custom);
  assert.equal((await M.migrateTimers(ctx)).migrated, 20);
  assert.equal((await M.migrateTimers(ctx)).migrated, 5, "le passage suivant reprend la suite");
  const cfg = await cfgOf(ctx);
  assert.equal(cfg.custom.length, 125);
  assert.equal(cfg.custom.filter((c) => c.timerOnly).length, 25);
  const info = await (await import("../modules/twitch-bot/admin.mjs")).context(ctx, { declare: false });
  const r = await C.saveCommand(ctx, { kind: "custom" }, { name: "encore", text: "x" }, info.env);
  assert.equal(r.code, "too_many", "100 commandes à vous au plus, les réservées au timer en plus");
});

/* ───────────── Le moteur : le même message, au même rythme ───────────── */

let n = 0;
const line = (ctx, now) => T.processTimers(ctx, chat("bonjour", { messageId: `M${++n}`, chatterId: `c${n % 5}`, login: `viewer${n % 5}` }), { now });

test("après la migration, un ancien timer envoie EXACTEMENT le même message au même rythme (intervalle, lignes, direct) ; l'attente en cours est reprise", async () => {
  T.resetTimersMemory();
  const { ctx, tw } = world();
  await seed(ctx, [LEGACY[0], { ...LEGACY[1], enabled: true, lines: 2 }]);
  await ctx.api.store.add("botTimers", { items: { t1: { lastAt: NOW - 19 * MIN, lines: 9 }, t2: { lastAt: NOW - 29 * MIN, lines: 0 } } });
  await M.migrateTimers(ctx, { now: NOW });
  const items = (await ctx.api.store.list("botTimers", { limit: 1 }))[0].data.items;
  assert.ok(items.t1 && items["custom:t1"] && items["custom:t2"], "l'ancien état reste, le nouveau le reprend");
  assert.deepEqual(items["custom:t1"], items.t1);
  assert.equal((await line(ctx, NOW)).sent, false, "pas encore l'heure");
  assert.equal((await line(ctx, NOW + MIN)).sent, true, "20 minutes depuis le dernier envoi : part tout de suite");
  assert.equal(tw.chat.at(-1).message, LEGACY[0].text);
  assert.equal((await line(ctx, NOW + MIN + 1)).sent, false, "2 lignes minimum : pas encore");
  assert.equal((await line(ctx, NOW + MIN + 2)).sent, true);
  assert.equal(tw.chat.at(-1).message, LEGACY[1].text);
  const log = await S.readLog(ctx);
  assert.deepEqual(log.slice(0, 2).map((e) => e.command), ["⏱ Hydratation", "⏱ Rappel du Discord"], "le journal garde le titre d'avant");
  assert.ok(log.every((e) => e.user === "timer" && e.result === "sent"));
});

test("filet de sécurité : si la migration des données n'a pas tourné, le premier message du chat la fait (une fois) et le timer continue d'écrire", async () => {
  T.resetTimersMemory();
  const { ctx, tw } = world();
  await seed(ctx, [{ ...LEGACY[0], minutes: 1, lines: 0, when: "always" }]);
  assert.equal((await line(ctx, NOW)).sent, false);
  assert.ok((await cfgOf(ctx)).timers[0].migrated, "migré au passage");
  assert.equal((await line(ctx, NOW + MIN)).sent, true);
  assert.equal(tw.chat.length, 1);
  assert.equal(tw.chat[0].message, LEGACY[0].text);
  assert.equal((await cfgOf(ctx)).custom.length, 1, "une seule commande créée");
});

test("l'ancienne liste est inerte : modifier ou supprimer l'ancien enregistrement n'a plus d'effet ; un message vide ne part pas ; une commande réservée au timer ne répond jamais dans le chat", async () => {
  T.resetTimersMemory();
  const { ctx, tw } = world();
  await seed(ctx, [{ ...LEGACY[6], minutes: 1, lines: 0, when: "always" }, { ...LEGACY[0], minutes: 1, lines: 0, when: "always" }]);
  await M.migrateTimers(ctx, { now: NOW });
  await C.mutate(ctx, (cfg) => { cfg.timers = cfg.timers.map((x) => ({ ...x, text: "CHANGÉ", enabled: false })); return { ok: true }; });
  T.resetTimersMemory();
  await line(ctx, NOW);
  const r = await line(ctx, NOW + MIN);
  assert.equal(tw.chat.length, 1, "le message vide n'est pas envoyé, l'autre l'est");
  assert.equal(tw.chat[0].message, LEGACY[0].text);
  assert.ok(r.sent);
  assert.ok((await S.readLog(ctx)).some((e) => e.result === "refused" && e.reason === "empty"));
  const E = await import("../modules/twitch-bot/engine.mjs");
  const out = await E.processChat(ctx, chat("!rappeldudiscord", { messageId: "x1" }), { now: NOW + 2 * MIN });
  assert.equal(out.handled, false);
  assert.equal(tw.chat.length, 1);
});

test("une commande qui se répète respecte sa période et son état : désactivée, hors période ou incomplète, elle n'est pas rappelée ; {utilisateur} devient « tout le monde »", async () => {
  T.resetTimersMemory();
  const { ctx, tw } = world();
  const info = await (await import("../modules/twitch-bot/admin.mjs")).context(ctx, { declare: false });
  const ok = await C.saveCommand(ctx, { kind: "custom" }, { name: "salut", text: "Bonjour {utilisateur}", repeat: { minutes: 1, lines: 0, when: "always" } }, info.env);
  const off = await C.saveCommand(ctx, { kind: "custom" }, { name: "muette", text: "Je suis coupée", enabled: false, repeat: { minutes: 1, lines: 0, when: "always" } }, info.env);
  const out = await C.saveCommand(ctx, { kind: "custom" }, { name: "hiver", text: "Brrr", period: yearly([1, 12], [31, 12]), repeat: { minutes: 1, lines: 0, when: "always" } }, info.env);
  assert.deepEqual([ok.ok, off.ok, out.ok], [true, true, true]);
  await C.saveCommand(ctx, { kind: "builtin", id: "planning" }, { enabled: true, repeat: { minutes: 1, lines: 0, when: "always" } }, info.env);
  await line(ctx, NOW);
  assert.equal((await line(ctx, NOW + MIN)).sent, true);
  assert.deepEqual(tw.chat.map((m) => m.message), ["Bonjour tout le monde"]);
  assert.equal((await line(ctx, NOW + MIN + 1)).sent, false, "« planning » sans le module Planning : masquée, pas rappelée");
  assert.equal(tw.chat.length, 1);
  await S.setMuted(ctx, true);
  assert.equal((await line(ctx, NOW + 5 * MIN)).why, "muted");
});
