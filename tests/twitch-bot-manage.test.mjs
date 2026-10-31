// Bot Twitch : !addcom, !editcom, !delcom, !commands depuis le chat — réservé à la modération et à la chaîne, seulement si la personne l'a permis,
// mêmes vérifications que l'administration, jamais d'écrasement, journal.
import test from "node:test";
import assert from "node:assert/strict";
import { world, say, sent, logOf, NOW, S, C } from "./helpers/botWorld.mjs";

const MOD = { badges: ["moderator"], chatterId: "300", login: "marie_mod", name: "Marie_Mod" };
const OWNER = { badges: ["broadcaster"], chatterId: "100", login: "emma", name: "Emma" };
const SUB = { badges: ["subscriber"], chatterId: "400", login: "paul", name: "Paul" };
const on = (o = {}) => world({ settings: { chatManage: true, ...o.settings }, ...o });
const customs = async (ctx) => (await C.loadConfig(ctx)).data.custom;
let k = 0;
const as = (ctx, who, text, now = NOW) => say(ctx, text, { ...who, messageId: `g${++k}` }, now + k * 3000);

test("par défaut c'est éteint : la modération n'obtient rien tant que la personne ne l'a pas permis", async () => {
  const { ctx, tw } = world();
  assert.deepEqual(await as(ctx, MOD, "!addcom test coucou"), { handled: false, why: "unknown_command" });
  assert.equal(tw.chat.length, 0);
  assert.equal((await customs(ctx)).length, 0);
  const manifest = JSON.parse((await import("node:fs")).readFileSync(new URL("../modules/twitch-bot/module.json", import.meta.url), "utf8"));
  const s = manifest.settings.find((x) => x.key === "chatManage");
  assert.deepEqual([s.default, s.advanced], [false, undefined]);
});

test("droits : la modération et la chaîne peuvent ; une personne abonnée ou ordinaire n'obtient aucune réponse (on ne révèle rien) et rien n'est écrit", async () => {
  const { ctx, tw } = on();
  for (const who of [MOD, OWNER]) assert.equal((await as(ctx, who, `!addcom c${who.login} Bonjour`)).result, "sent");
  assert.equal((await customs(ctx)).length, 2);
  for (const who of [SUB, { chatterId: "500", login: "x", name: "X", badges: [] }]) {
    for (const t of ["!addcom pirate hop", "!editcom cmarie_mod hop", "!delcom cmarie_mod", "!commands"]) { const r = await as(ctx, who, t); assert.deepEqual([r.result, r.reason], ["refused", "role"], t); }
  }
  assert.equal(tw.chat.length, 2, "aucune réponse aux personnes sans droit");
  assert.equal((await customs(ctx)).length, 2);
  assert.ok((await logOf(ctx)).some((e) => e.command === "addcom" && e.reason === "role" && e.user === "paul"), "le journal garde qui a essayé");
});

test("!addcom : crée la commande (mêmes règles que l'administration), avec -cd= et -ul= ; elle répond ensuite pour tout le monde", async () => {
  const { ctx, tw } = on();
  await as(ctx, MOD, "!addcom -cd=45 -ul=mods secret Mot de passe : {utilisateur}");
  assert.match(tw.chat.at(-1).message, /Marie_Mod, la commande !secret est ajoutée\./);
  const c = (await customs(ctx))[0];
  assert.deepEqual([c.name, c.text, c.role, c.cdGlobal, c.enabled], ["secret", "Mot de passe : {utilisateur}", "mods", 45, true]);
  await as(ctx, MOD, "!addcom !Merch Boutique : exemple.org");
  assert.equal((await customs(ctx))[1].name, "merch", "préfixe retiré, minuscules");
  const reply = await say(ctx, "!merch", { chatterId: "9", login: "z", name: "Z" }, NOW + 500_000);
  assert.equal(reply.result, "sent");
  assert.equal(tw.chat.at(-1).message, "Boutique : exemple.org");
});

test("!addcom : refus clairs dans le chat — nom pris (commande à soi, toute prête, alias), nom invalide, texte vide, / ou . au début, variable inconnue, option fausse, trop de commandes", async () => {
  const { ctx, tw } = on();
  const say_ = async (t) => { await as(ctx, MOD, t); return tw.chat.at(-1).message; };
  assert.match(await say_("!addcom"), /pour ajouter : !addcom nom texte de la réponse\. Par exemple/);
  assert.match(await say_("!addcom seul"), /pour ajouter/);
  await as(ctx, MOD, "!addcom merch Boutique");
  assert.match(await say_("!addcom merch Autre"), /la commande !merch existe déjà\. Pour la changer, tapez !editcom merch/);
  assert.match(await say_("!addcom jeu Zelda"), /!jeu est déjà pris par une commande toute prête/);
  assert.match(await say_("!addcom game Zelda"), /déjà pris par une commande toute prête/, "un alias compte aussi");
  assert.match(await say_("!addcom stop Zelda"), /pas enregistré|déjà pris/, "mot réservé");
  assert.match(await say_("!addcom /ban Texte"), /ne convient pas/);
  assert.match(await say_("!addcom .x Texte"), /ne convient pas/);
  assert.match(await say_("!addcom deux&mots Texte"), /ne convient pas/);
  assert.match(await say_("!addcom bad /ban toto"), /ne peut pas commencer par \//);
  assert.match(await say_("!addcom bad2 Salut {pseudo}"), /ne connaît pas : \{pseudo\}/);
  assert.match(await say_("!addcom bad3 {calcul 2+}"), /Par exemple \{calcul 2\+3\*4\}/);
  assert.match(await say_("!addcom -zz=3 bad4 Texte"), /l'option « -zz=3 » n'existe pas/);
  assert.match(await say_("!addcom -cd=abc bad5 Texte"), /nombre de secondes entre 0 et 3600/);
  assert.match(await say_("!addcom -ul=roi bad6 Texte"), /le niveau doit être/);
  assert.match(await say_(`!addcom long ${"a".repeat(451)}`), /pas enregistré/);
  assert.equal((await customs(ctx)).length, 1, "rien de tout cela n'a rien écrit");
  for (let i = 0; i < 99; i++) await C.mutate(ctx, (cfg) => { cfg.custom.push({ id: `f${i}`, name: `f${i}`, aliases: [], text: "x", role: "everyone", enabled: true, cdGlobal: null, cdUser: null }); return { ok: true }; });
  assert.match(await say_("!addcom unde Texte"), /déjà 100 commandes personnalisées/);
});

test("!editcom : change le texte et/ou le niveau et l'attente d'une commande à soi ; refuse une commande toute prête, inconnue, ou un texte faux ; ne crée jamais", async () => {
  const { ctx, tw } = on();
  const say_ = async (t) => { await as(ctx, MOD, t); return tw.chat.at(-1).message; };
  await as(ctx, MOD, "!addcom merch Boutique");
  assert.match(await say_("!editcom merch Nouvelle boutique"), /la commande !merch est modifiée/);
  assert.equal((await customs(ctx))[0].text, "Nouvelle boutique");
  assert.match(await say_("!editcom -ul=subscriber -cd=10 merch"), /modifiée/);
  const c = (await customs(ctx))[0];
  assert.deepEqual([c.text, c.role, c.cdGlobal], ["Nouvelle boutique", "subscribers", 10], "le texte reste quand on ne change que le niveau");
  assert.match(await say_("!editcom jeu Autre"), /!jeu est une commande toute prête : elle se change dans l'administration/);
  assert.match(await say_("!editcom nope Autre"), /je ne trouve pas de commande !nope/);
  assert.equal((await customs(ctx)).length, 1, "!editcom ne crée rien");
  assert.match(await say_("!editcom merch /ban x"), /pas enregistré/);
  assert.match(await say_("!editcom merch"), /pour modifier : !editcom nom nouveau texte/);
  assert.equal((await customs(ctx))[0].text, "Nouvelle boutique");
  assert.equal(S && (await C.loadConfig(ctx)).data.builtin.jeu, undefined, "la commande toute prête n'a pas bougé");
});

test("!delcom : supprime une commande à soi (et son compteur) ; refuse les autres ; !commands liste les commandes à soi (modération seulement), coupée avant 400 caractères", async () => {
  const { ctx, tw } = on();
  const say_ = async (t) => { await as(ctx, MOD, t); return tw.chat.at(-1).message; };
  assert.match(await say_("!commands"), /aucune commande personnalisée/);
  await as(ctx, MOD, "!addcom a Un {compteur}"); await as(ctx, MOD, "!addcom b Deux");
  await say(ctx, "!a", { chatterId: "9", login: "z" }, NOW + 900_000);
  assert.match(await say_("!commands"), /les commandes : !a !b$/);
  assert.match(await say_("!delcom a"), /!a est supprimée/);
  assert.deepEqual((await customs(ctx)).map((c) => c.name), ["b"]);
  assert.deepEqual(await S.readCounters(ctx), {}, "le compteur de la commande supprimée est effacé");
  assert.match(await say_("!delcom a"), /je ne trouve pas/);
  assert.match(await say_("!delcom jeu"), /commande toute prête/);
  assert.match(await say_("!delcom"), /pour supprimer : !delcom nom/);
  assert.ok((await customs(ctx)).length === 1 && (await C.loadConfig(ctx)).data.builtin.jeu === undefined);
  for (let i = 0; i < 60; i++) await C.mutate(ctx, (cfg) => { cfg.custom.push({ id: `f${i}`, name: `commande${i}`, aliases: [], text: "x", role: "everyone", enabled: true, cdGlobal: null, cdUser: null }); return { ok: true }; });
  const list = await say_("!commands");
  assert.ok(list.length <= 400 && /\(\+\d+\)$/.test(list), list);
});

test("une commande qui porte déjà ce nom l'emporte (la gestion ne la masque pas) ; l'arrêt d'urgence, le bot pas prêt et l'attente bloquent la gestion ; la limite de réponses s'applique", async () => {
  const { ctx, tw } = on();
  await C.mutate(ctx, (cfg) => { cfg.custom.push({ id: "x1", name: "commands", aliases: [], text: "Ma liste à moi", role: "everyone", enabled: true, cdGlobal: 0, cdUser: 0 }); return { ok: true }; });
  await as(ctx, MOD, "!commands");
  assert.equal(tw.chat.at(-1).message, "Ma liste à moi");
  await S.setMuted(ctx, true);
  assert.equal((await as(ctx, MOD, "!addcom a x")).reason, "muted");
  await S.setMuted(ctx, false);
  const n = tw.chat.length;
  const r1 = await say(ctx, "!addcom z1 un", { ...MOD, messageId: "q1" }, NOW + 800_000);
  const r2 = await say(ctx, "!addcom z2 deux", { ...MOD, messageId: "q2" }, NOW + 800_500);
  assert.deepEqual([r1.result, r2.reason], ["sent", "cooldown"], "deux demandes en quelques secondes : la seconde attend");
  assert.equal(tw.chat.length, n + 1);
  const off = world({ settings: { chatManage: true }, tw: { mainStatus: "none" } });
  assert.equal((await as(off.ctx, MOD, "!addcom a x")).reason, "not_ready");
  const lim = world({ settings: { chatManage: true, maxPer30s: 1 } });
  await as(lim.ctx, MOD, "!addcom a1 x");
  assert.equal((await as(lim.ctx, OWNER, "!addcom a2 x")).reason, "rate");
});

test("journal : qui a ajouté, modifié ou supprimé quoi, avec le résultat ; jamais d'écrasement silencieux", async () => {
  const { ctx } = on();
  await as(ctx, MOD, "!addcom a Un"); await as(ctx, MOD, "!addcom a Deux"); await as(ctx, OWNER, "!delcom a");
  const log = (await logOf(ctx)).filter((e) => ["addcom", "delcom"].includes(e.command)).reverse();
  assert.deepEqual(log.map((e) => [e.command, e.user, e.result, e.reason]), [["addcom", "marie_mod", "sent", "ok"], ["addcom", "marie_mod", "refused", "invalid"], ["delcom", "emma", "sent", "ok"]]);
  assert.match(log[0].text, /!a est ajoutée/);
});
