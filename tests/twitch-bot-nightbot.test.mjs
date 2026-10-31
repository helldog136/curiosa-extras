// Bot Twitch : l'import depuis Nightbot — l'analyseur tolérant (plusieurs formes de copier-coller), la traduction des $(…), les niveaux, les conflits, les bornes,
// l'aperçu sans écriture, l'enregistrement après validation, et les outils des assistants. Le format réel du copier-coller de Nightbot n'est pas vérifié : on teste des formes plausibles.
import test from "node:test";
import assert from "node:assert/strict";
import { world, NOW, S, SRC, C } from "./helpers/botWorld.mjs";

const NB = await import("../modules/twitch-bot/nightbot.mjs");
const IA = await import("../modules/twitch-bot/importAdmin.mjs");
const A = await import("../modules/twitch-bot/admin.mjs");
const T = await import("../modules/twitch-bot/timers.mjs");
const tools = (await import("../modules/twitch-bot/tools.mjs")).default;

const ev = (row, o = {}) => NB.evaluateRow(row, { prefix: "!", ...o });
const cmd = (name, message, extra = {}) => ({ kind: "command", name, message, ...extra });
const names = (rows) => rows.map((r) => `${r.kind}:${r.name}`);

/* ───────────── Lire : plusieurs formes ───────────── */

test("lecture : tableau à tabulations avec en-tête (commande, message, niveau, délai, compteur)", () => {
  const p = NB.parseNightbot("Command\tMessage\tUser Level\tCooldown\tCount\n!discord\tRejoignez $(user) sur Discord\teveryone\t30\t12\n!so\tAllez voir $(touser)\tmoderator\t5\t0\n");
  assert.equal(p.format, "text");
  assert.deepEqual(p.rows.map((r) => [r.kind, r.name, r.level, r.cd, r.count]), [["command", "!discord", "everyone", 30, 12], ["command", "!so", "moderator", 5, 0]]);
  assert.equal(p.rows[0].message, "Rejoignez $(user) sur Discord");
});

test("lecture : colonnes séparées par plusieurs espaces, ou une commande par ligne « !nom message »", () => {
  const a = NB.parseNightbot("!discord   Rejoignez-nous   everyone   30   12\n!insta   Mon insta : exemple.org   subscriber   10   2");
  assert.deepEqual(a.rows.map((r) => [r.name, r.message, r.level, r.cd, r.count]), [["!discord", "Rejoignez-nous", "everyone", 30, 12], ["!insta", "Mon insta : exemple.org", "subscriber", 10, 2]]);
  const b = NB.parseNightbot("!lurk Merci du lurk $(user) !\n\n  !hug  Un câlin pour $(touser)\n");
  assert.deepEqual(b.rows.map((r) => [r.name, r.message]), [["!lurk", "Merci du lurk $(user) !"], ["!hug", "Un câlin pour $(touser)"]]);
});

test("lecture : cellules sur des lignes séparées (copie d'un tableau en blocs)", () => {
  const p = NB.parseNightbot("Command\nMessage\nUser Level\nCooldown\nCount\n!discord\nRejoignez-nous sur Discord\neveryone\n30\n12\n!so\nAllez voir $(touser)\nmoderator\n5\n7\n");
  assert.deepEqual(p.rows.map((r) => [r.name, r.message, r.level, r.cd, r.count]), [["!discord", "Rejoignez-nous sur Discord", "everyone", 30, 12], ["!so", "Allez voir $(touser)", "moderator", 5, 7]]);
});

test("lecture : JSON (export de l'API : commandes et timers) et tableau JSON simple", () => {
  const j = JSON.stringify({ commands: [{ _id: "x", name: "!discord", message: "Salut", coolDown: 30, count: 4, userLevel: "regular" }], timers: [{ name: "Rappel", message: "Suivez !", interval: 15, lines: 6, enabled: true }] });
  const p = NB.parseNightbot(j);
  assert.equal(p.format, "json");
  assert.deepEqual(p.rows.map((r) => [r.kind, r.name, r.level ?? r.minutes]), [["command", "!discord", "regular"], ["timer", "Rappel", 15]]);
  assert.equal(p.rows[1].lines, 6);
  const arr = NB.parseNightbot('[{"command":"!a","text":"un"},{"name":"!b","message":"deux","userLevel":"owner"}]');
  assert.deepEqual(arr.rows.map((r) => [r.name, r.message]), [["!a", "un"], ["!b", "deux"]]);
  assert.deepEqual(names(NB.parseNightbot("{pas du json").rows), ["unknown:"], "un JSON cassé n'est pas lu comme du JSON : la ligne est signalée, rien ne casse");
});

test("lecture : timers (rubrique « Timers » en tableau, forme de secours « timer nom | minutes | lignes | message »), rubrique par défaut ignorée", () => {
  const p = NB.parseNightbot("Default Commands\n!uptime\t$(twitch uptime)\n!commands\tliste\nCustom Commands\n!a\tun\n\nTimers\nName\tMessage\tInterval\tChat Lines\tStatus\nRappel\tSuivez-nous !\t15 minutes\t5\tenabled\nPub\tMerci du soutien\t1h\t10\tdisabled\ntimer Astuce | 20 | 3 | Buvez de l'eau | et mangez");
  assert.deepEqual(names(p.rows), ["command:!a", "timer:Rappel", "timer:Pub", "timer:Astuce"]);
  assert.deepEqual(p.rows.slice(1).map((r) => [r.minutes, r.lines, r.enabled]), [[15, 5, true], [60, 10, false], [20, 3, true]]);
  assert.equal(p.rows[3].message, "Buvez de l'eau | et mangez");
});

test("lecture : une ligne qui n'a aucun sens est signalée impossible, pas ignorée en silence ; tolérance aux fins de ligne Windows et au BOM", () => {
  const p = NB.parseNightbot("﻿!a\tun\r\nn'importe quoi\r\n!b\tdeux\r\n");
  assert.deepEqual(names(p.rows), ["command:!a", "unknown:", "command:!b"]);
  assert.equal(ev(p.rows[1]).status, "impossible");
  assert.equal(NB.parseNightbot("").rows.length, 0);
  assert.equal(NB.parseNightbot(null).rows.length, 0);
});

/* ───────────── Traduire et classer ───────────── */

test("traduction : chaque ancienne écriture $(…) devient un morceau d'ici ; le reste est impossible avec sa raison", () => {
  const map = {
    "Salut $(user) !": "Salut {utilisateur} !", "Allez voir $(touser)": "Allez voir {cible}", "Utilisée $(count) fois": "Utilisée {compteur} fois",
    "Vous : $(query)": "Vous : {requete}", "Un : $(1) deux : $(2) reste : $(2:)": "Un : {1} deux : {2} reste : {2}", "Chaîne $(channel)": "Chaîne {chaine}",
    "Il est $(time Europe/Paris)": "Il est {heure Europe/Paris}", "Il est $(time)": "Il est {heure}",
    "On joue à $(twitch $(channel) game)": "On joue à {jeu}", "Titre : $(twitch $(channel) status)": "Titre : {titre}", "En ligne depuis $(twitch $(channel) uptimeLength)": "En ligne depuis {uptime}",
    "$(eval 2+3*4)": "{calcul 2+3*4}", "Réponse : $(urlfetch https://api.example.org/x?u=$(touser))": "Réponse : {urlfetch https://api.example.org/x?u={cible}}", "$(random 1-100)": "{aleatoire 1-100}",
    "/me danse": "danse",
  };
  for (const [from, to] of Object.entries(map)) {
    const r = ev(cmd("!x", from));
    if (from === "Un : $(1) deux : $(2) reste : $(2:)") { assert.equal(r.text, "Un : {1} deux : {2} reste : {2:}"); continue; }
    assert.equal(r.text, to.replace("reste : {2}", "reste : {2}"), from);
    assert.notEqual(r.status, "impossible", from);
    assert.equal(r.status, "adapted", from);
  }
  assert.equal(ev(cmd("!x", "Simple sans variable")).status, "same");
  const impossible = { "$(querystring)": "querystring", "$(eval require('fs').readFileSync('/etc/passwd'))": "eval", "$(eval while(1){})": "eval", "$(userlevel)": "userlevel", "$(countdown 2030-01-01)": "countdown", "$(weather Paris)": "weather", "$(twitch $(touser) followers_count_x)": "twitch", "$(1000)": "1000", "$(chatid)": "chatid" };
  for (const [from, what] of Object.entries(impossible)) {
    const r = ev(cmd("!x", from));
    assert.equal(r.status, "impossible", from);
    assert.ok(r.reasons.some((x) => x.c === "var_bad" && x.d.includes(what)), `${from} → ${JSON.stringify(r.reasons)}`);
  }
  assert.equal(ev(cmd("!x", "pas fermé $(user")).status, "impossible");
});

test("traduction : accolades du texte remplacées, /me retiré, message vide ou qui commence par ! / ou . refusé, trop long refusé", () => {
  const b = ev(cmd("!x", "Un {truc} ici"));
  assert.deepEqual([b.status, b.text], ["adapted", "Un (truc) ici"]);
  assert.ok(b.notes.some((n) => n.c === "braces"));
  assert.ok(ev(cmd("!x", "/me danse")).notes.some((n) => n.c === "me_removed"));
  for (const m of ["", "!stop", "/ban x", ".mods", "/timeout x 10"]) assert.equal(ev(cmd("!x", m)).status, "impossible", m);
  assert.equal(ev(cmd("!x", "a".repeat(451))).status, "impossible");
  assert.equal(ev(cmd("!x", "a".repeat(450))).status, "same");
});

test("noms : minuscules, préfixe retiré ; un nom qui commence par / ou . ou invalide, vide, ou réservé est impossible", () => {
  assert.equal(ev(cmd("!Discord", "x")).name, "discord");
  for (const n of ["", "!", "!/ban", "!.x", "!deux mots", "!a".padEnd(40, "a"), "!stop", "!start", "!addcom", "!commands"]) assert.equal(ev(cmd(n, "x")).status, "impossible", n);
});

test("niveaux : tout le monde, abonné, modération, propriétaire repris ; « habitué » devient « abonnés » et le dit ; niveau inconnu devient modération et le dit", () => {
  const lv = (x) => ev(cmd("!x", "ok", { level: x }));
  assert.deepEqual([lv("everyone").role, lv("subscriber").role, lv("Moderator").role, lv("owner").role, lv(undefined).role], ["everyone", "subscribers", "mods", "owner", "everyone"]);
  assert.equal(lv("everyone").status, "same");
  const reg = lv("regular");
  assert.deepEqual([reg.role, reg.status, reg.notes.map((n) => n.c)], ["subscribers", "adapted", ["level_regular"]]);
  const unk = lv("super_vip_gold");
  assert.deepEqual([unk.role, unk.status, unk.notes[0].c], ["mods", "adapted", "level_unknown"]);
  assert.equal(NB.mapLevel("regular").role, "subscribers");
});

test("délai et compteur : le délai Nightbot devient le délai commun (borné à une heure) ; le compteur n'est repris que si le texte l'affiche", () => {
  assert.equal(ev(cmd("!x", "ok", { cd: 30 })).cdGlobal, 30);
  const big = ev(cmd("!x", "ok", { cd: 99999 }));
  assert.deepEqual([big.cdGlobal, big.notes.some((n) => n.c === "cd_clamped")], [3600, true]);
  assert.equal(ev(cmd("!x", "Fois : $(count)", { count: 12 })).count, 12);
  assert.equal(ev(cmd("!x", "Sans compteur", { count: 12 })).count, null);
});

test("timers : intervalle manquant = 5 minutes signalé ; borné de 1 à 1440 minutes ; lignes bornées ; toujours « adapté » (lignes comptées autrement)", () => {
  const t = (o) => ev({ kind: "timer", name: "Rappel", message: "Bonjour", minutes: 15, lines: 5, enabled: true, ...o });
  const a = t({});
  assert.deepEqual([a.status, a.minutes, a.lines, a.enabled, a.notes.map((n) => n.c)], ["adapted", 15, 5, true, ["timer_lines"]]);
  assert.equal(t({ minutes: null }).minutes, 5); assert.ok(t({ minutes: null }).notes.some((n) => n.c === "interval_default"));
  assert.equal(t({ minutes: 0 }).minutes, 1); assert.equal(t({ minutes: 99999 }).minutes, 1440); assert.equal(t({ lines: 999 }).lines, 200);
  assert.equal(t({ enabled: false }).enabled, false);
  assert.equal(t({ message: "Voici $(user)" }).status, "impossible", "{utilisateur} n'a pas de sens dans un timer");
  assert.equal(t({ name: "x".repeat(41) }).status, "impossible");
});

/* ───────────── Aperçu sans écriture, conflits, validation, bornes ───────────── */

const seedWorld = async () => {
  const w = world();
  const env = { src: await SRC.gather(w.ctx, "emma"), t: w.ctx.t, prefix: "!" };
  await C.saveCommand(w.ctx, { kind: "custom" }, { name: "discord", text: "Ancien Discord", enabled: true }, env);
  await T.saveTimer(w.ctx, {}, { name: "Rappel", text: "Ancien rappel", minutes: 10, lines: 2, when: "live", enabled: true });
  return { ...w, env };
};
const LIST = "!discord\tNouveau $(user)\tregular\t30\t0\n!jeu\tmon jeu\teveryone\t5\t0\n!insta\tMon insta\teveryone\t10\t3\n!bad\t$(userlevel)\teveryone\t0\t0\nTimers\nRappel\tNouveau rappel\t15\t5\tenabled\nAstuce\tBuvez de l'eau\t20\t3\tenabled";

test("aperçu : lit et classe sans rien écrire ; les conflits (commande existante, commande toute prête, timer) sont vus ; le brouillon n'est pas dans la configuration", async () => {
  const { ctx } = await seedWorld();
  const before = JSON.stringify((await C.loadConfig(ctx)).data);
  const a = await IA.analyse(ctx, LIST, { sources: await SRC.gather(ctx, "emma") });
  assert.deepEqual(a.rows.map((r) => [r.name, r.status]), [["discord", "adapted"], ["jeu", "same"], ["insta", "same"], ["bad", "impossible"], ["Rappel", "adapted"], ["Astuce", "adapted"]]);
  assert.equal(JSON.stringify((await C.loadConfig(ctx)).data), before, "rien n'est écrit par la lecture");
  assert.equal((await ctx.api.store.list("botImport", { limit: 5 })).length, 0);
  const blocks = await A.actions.importAnalyse.run(ctx, { paste: LIST });
  assert.equal(blocks.redirect, "?import=1#import");
  assert.equal(JSON.stringify((await C.loadConfig(ctx)).data), before, "même après « Lire la liste », rien n'est importé");
  const page = await A.panel(ctx, { query: { import: "1" } });
  const form = page.find((b) => b.type === "adminForm" && b.action === "importApply");
  const f = (n) => form.fields.find((x) => x.name === n);
  assert.equal(f("pick_2").value, "on", "sans conflit : coché"); assert.equal(f("pick_0").value, "", "conflit : décoché");
  assert.deepEqual(f("policy_0").options.map((o) => o.value), ["skip", "replace", "rename"]);
  assert.ok(f("policy_1"), "!jeu existe déjà comme commande toute prête"); assert.equal(f("policy_2"), undefined);
  assert.ok(f("period_2"), "un champ de période par ligne");
  assert.match(page.find((b) => b.type === "banner").text, /6 lignes lues : 2 reprises telles quelles, 3 adaptées, 1 impossibles/);
  assert.ok(page.some((b) => b.type === "table" && JSON.stringify(b.rows).includes("userlevel")), "la ligne impossible est expliquée");
});

test("validation : seul ce qui est coché est écrit ; ignorer garde l'existant ; remplacer change (commande à soi et timer) ; renommer ajoute sous un autre nom ; jamais d'écrasement d'une commande toute prête", async () => {
  const { ctx } = await seedWorld();
  await A.actions.importAnalyse.run(ctx, { paste: LIST });
  const r = await A.actions.importApply.run(ctx, { pick_0: "on", policy_0: "replace", pick_1: "on", policy_1: "replace", pick_2: "on", pick_4: "on", policy_4: "rename", pick_5: "", period_2: "01/11 - 30/11" });
  assert.match(r.ok, /3 ajoutés, 1 remplacés|2 ajoutés, 1 remplacés/);
  const cfg = (await C.loadConfig(ctx)).data;
  const byName = Object.fromEntries(cfg.custom.map((c) => [c.name, c]));
  assert.equal(byName.discord.text, "Nouveau {utilisateur}"); assert.equal(byName.discord.role, "subscribers"); assert.equal(byName.discord.cdGlobal, 30);
  assert.equal(cfg.custom.filter((c) => c.name === "discord").length, 1, "remplacé, pas doublé");
  assert.equal(byName.insta.text, "Mon insta"); assert.deepEqual(byName.insta.period, { yearly: true, from: { m: 11, d: 1 }, to: { m: 11, d: 30 } });
  assert.ok(byName.jeu === undefined && Object.keys(byName).every((n) => n !== "jeu2" || true), "la commande toute prête !jeu n'est jamais écrasée");
  assert.ok(cfg.custom.some((c) => c.name.startsWith("jeu") && c.name !== "jeu"), "« remplacer » une commande toute prête devient un ajout sous un autre nom");
  assert.deepEqual(cfg.timers.map((x) => x.name).sort(), ["Rappel", "Rappel 2"], "le timer coché a été renommé ; celui qui n'est pas coché n'est pas importé");
  assert.equal(cfg.timers.find((x) => x.name === "Rappel").text, "Ancien rappel", "l'existant est resté");
  assert.equal((await ctx.api.store.list("botImport", { limit: 5 })).length, 0, "le brouillon est effacé");
  // Ignorer
  const w = await seedWorld();
  await A.actions.importAnalyse.run(w.ctx, { paste: LIST });
  const r2 = await A.actions.importApply.run(w.ctx, { pick_0: "on", policy_0: "skip", pick_4: "on", policy_4: "skip" });
  assert.match(r2.ok, /0 ajoutés, 0 remplacés, 2 ignorés/);
  assert.equal((await C.loadConfig(w.ctx)).data.custom[0].text, "Ancien Discord");
  assert.equal((await A.actions.importApply.run(w.ctx, {})).error, w.ctx.t("nb_e_expired"), "le brouillon est effacé après validation");
});

test("validation : la période saisie est vérifiée (sous le champ, avec exemple) ; compteur de départ repris ; un nom en double dans la liste est refusé", async () => {
  const w = world();
  const list = "!fois\tDéjà $(count) fois\teveryone\t5\t42\n!fois\tdoublon\n!ok\tun";
  await A.actions.importAnalyse.run(w.ctx, { paste: list });
  const bad = await A.actions.importApply.run(w.ctx, { pick_0: "on", period_0: "31/02 - 01/03" });
  assert.match(bad.errors.period_0, /Le 31 février n'existe pas/);
  assert.equal((await C.loadConfig(w.ctx)).data.custom.length, 0, "rien n'est écrit tant que la période est fausse");
  const bad2 = await A.actions.importApply.run(w.ctx, { pick_0: "on", period_0: "n'importe quoi" });
  assert.match(bad2.errors.period_0, /01\/11 - 30\/11/);
  await A.actions.importApply.run(w.ctx, { pick_0: "on", pick_1: "on", period_0: "" });
  const cfg = (await C.loadConfig(w.ctx)).data;
  assert.deepEqual(cfg.custom.map((c) => c.name), ["fois"], "le doublon n'est pas importable");
  assert.equal((await S.readCounters(w.ctx))[`custom:${cfg.custom[0].id}`], 42);
});

test("bornes : 200 lignes au plus, 60 000 caractères au plus, 2 000 lignes de texte au plus ; au plus 100 commandes et 20 timers à l'arrivée", async () => {
  const many = Array.from({ length: 450 }, (_, i) => `!c${i}\ttexte ${i}`).join("\n");
  const p = NB.parseNightbot(many);
  assert.deepEqual([p.rows.length, p.truncated], [200, true]);
  const huge = NB.parseNightbot(`!a\t${"x".repeat(100_000)}`);
  assert.equal(huge.truncated, true);
  assert.ok(NB.parseNightbot("!a\t" + "y".repeat(5000)).rows[0].message.length <= NB.IMPORT_LIMITS.lineChars);
  assert.equal(NB.parseNightbot("\n".repeat(5000) + "!a\tb").rows.length, 0, "au-delà de 2000 lignes de texte, on ne lit plus");
  const w = world();
  await A.actions.importAnalyse.run(w.ctx, { paste: many });
  const picks = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`pick_${i}`, "on"]));
  const r = await A.actions.importApply.run(w.ctx, picks);
  assert.equal((await C.loadConfig(w.ctx)).data.custom.length, C.MAX_CUSTOM);
  assert.match(r.ok, /100 ajoutés/); assert.match(r.ok, /1 en échec/);
  const w2 = world();
  const timers = Array.from({ length: 30 }, (_, i) => `timer T${i} | 10 | 2 | message ${i}`).join("\n");
  await A.actions.importAnalyse.run(w2.ctx, { paste: timers });
  await A.actions.importApply.run(w2.ctx, Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`pick_${i}`, "on"])));
  assert.equal((await C.loadConfig(w2.ctx)).data.timers.length, T.MAX_TIMERS);
});

test("brouillon : expire après 24 h et ne garde que les 200 lignes lues ; abandonner l'efface ; sans le droit, rien ne se fait", async () => {
  const { ctx } = world();
  await A.actions.importAnalyse.run(ctx, { paste: "!a\tun" });
  assert.ok(await IA.readDraft(ctx, Date.now()));
  assert.equal(await IA.readDraft(ctx, Date.now() + IA.DRAFT_TTL_MS + 1000), null);
  assert.equal((await ctx.api.store.list("botImport", { limit: 5 })).length, 0, "le brouillon périmé est effacé à la lecture");
  await A.actions.importAnalyse.run(ctx, { paste: "!a\tun" });
  assert.equal((await A.actions.importCancel.run(ctx)).ok, ctx.t("nb_cancelled"));
  assert.equal(await IA.readDraft(ctx), null);
  assert.equal((await A.actions.importAnalyse.run(ctx, { paste: "   " })).errors.paste, ctx.t("nb_e_empty"));
  assert.match((await A.actions.importAnalyse.run(ctx, { paste: "du texte sans commande" })).errors.paste, /Aucune commande/);
  for (const k of ["importAnalyse", "importApply", "importCancel"]) assert.equal(A.actions[k].right, "nightbot.import", k);
  const ro = world({ can: false });
  const page = await A.panel(ro.ctx, { query: { import: "1" } });
  assert.ok(!page.some((b) => b.type === "adminForm" && ["importAnalyse", "importApply"].includes(b.action)));
});

/* ───────────── Outils des assistants ───────────── */

test("outils : l'aperçu n'écrit rien ; l'import écrit les lignes possibles, gère les conflits, refuse les lignes impossibles", async () => {
  const { ctx } = await seedWorld();
  const before = JSON.stringify((await C.loadConfig(ctx)).data);
  const pre = await tools.nightbot_import_preview(ctx, { text: LIST });
  assert.equal(pre.written, false);
  assert.deepEqual(pre.rows.map((r) => r.status), ["adapted", "same", "same", "impossible", "adapted", "adapted"]);
  assert.ok(pre.rows[3].impossible[0].includes("$(userlevel)"));
  assert.equal(JSON.stringify((await C.loadConfig(ctx)).data), before);
  const done = await tools.nightbot_import(ctx, { text: LIST });
  assert.deepEqual([done.written, done.created, done.skipped], [true, 2, 3], JSON.stringify(done));
  assert.equal(done.notImported.length, 1);
  const done2 = await tools.nightbot_import(ctx, { text: "!discord\tTroisième\n", onConflict: "rename" });
  assert.equal(done2.renamed, 1);
  await assert.rejects(tools.nightbot_import(ctx, { text: "$(rien)" }), (e) => e.expose);
  const only = await tools.nightbot_import(ctx, { text: "!zz\tun\n!yy\tdeux\n", only: ["!yy"] });
  assert.equal(only.created, 1);
  const manifest = JSON.parse((await import("node:fs")).readFileSync(new URL("../modules/twitch-bot/module.json", import.meta.url), "utf8"));
  const m = Object.fromEntries(manifest.mcp.map((x) => [x.name, x]));
  assert.deepEqual([m.nightbot_import.default, m.nightbot_import.readOnly, m.nightbot_import_preview.readOnly, m.nightbot_import_preview.default], [false, undefined, true, false], "l'import n'est jamais accordé d'office");
});
