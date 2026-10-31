// Bot Twitch : les dates de validité des commandes et des timers — période récurrente chaque année (même à cheval sur l'année), période unique, 29 février, fuseau,
// bornes incluses, hors période (la commande reste visible et modifiable, l'interrupteur « activée » l'emporte), timers, outils des assistants, migration.
import test from "node:test";
import assert from "node:assert/strict";
import { world, say, sent, logOf, chat, NOW, S, SRC, C } from "./helpers/botWorld.mjs";

const P = await import("../modules/twitch-bot/period.mjs");
const A = await import("../modules/twitch-bot/admin.mjs");
const T = await import("../modules/twitch-bot/timers.mjs");
const tools = (await import("../modules/twitch-bot/tools.mjs")).default;
const def = (await import("../modules/twitch-bot/index.mjs")).default;

const yearly = (a, b) => ({ yearly: true, from: { d: a[0], m: a[1] }, to: { d: b[0], m: b[1] } });
const per = (a, b) => P.parsePeriod(yearly(a, b)).value;
const at = (iso) => Date.parse(iso);
const ymd = (x) => (x ? `${x.y}-${String(x.m).padStart(2, "0")}-${String(x.d).padStart(2, "0")}` : null);

test("saisie : jours et mois vérifiés (31 février n'existe pas), période vide = toujours active, années exigées pour une période unique, fin après le début", () => {
  assert.deepEqual(P.parsePeriod({ yearly: true, from: {}, to: {} }), { ok: true, value: null });
  assert.deepEqual(P.parsePeriod(null), { ok: true, value: null });
  assert.deepEqual(P.parsePeriod(yearly([31, 2], [1, 3])), { ok: false, field: "fromDay", reason: "nodate", month: 2, day: 31 });
  assert.equal(P.parsePeriod(yearly([1, 3], [31, 4])).field, "toDay");
  assert.equal(P.parsePeriod(yearly([31, 6], [1, 7])).reason, "nodate");
  assert.equal(P.parsePeriod(yearly([1, 13], [1, 3])).field, "fromMonth");
  assert.equal(P.parsePeriod(yearly([0, 3], [1, 4])).field, "fromDay");
  assert.equal(P.parsePeriod({ yearly: true, from: { d: 1 }, to: { d: 2, m: 3 } }).field, "fromMonth", "début incomplet");
  assert.equal(P.parsePeriod(yearly([29, 2], [1, 3])).ok, true, "le 29 février est permis chaque année");
  const once = (a, b) => P.parsePeriod({ yearly: false, from: { d: a[0], m: a[1], y: a[2] }, to: { d: b[0], m: b[1], y: b[2] } });
  assert.equal(once([1, 11, 2026], [30, 11, 2026]).ok, true);
  assert.deepEqual([once([29, 2, 2027], [1, 3, 2027]).field, once([29, 2, 2027], [1, 3, 2027]).reason], ["fromDay", "nodate"], "pas de 29 février en 2027");
  assert.equal(once([29, 2, 2028], [1, 3, 2028]).ok, true);
  assert.equal(once([1, 11, undefined], [30, 11, 2026]).field, "fromYear");
  assert.equal(once([1, 11, 2026], [30, 10, 2026]).reason, "order");
  assert.equal(once([1, 11, 1999], [30, 11, 2026]).field, "fromYear");
  assert.equal(P.readPeriod({ junk: 1 }), null, "un document abîmé ne casse rien");
});

test("récurrence annuelle : bornes incluses, toutes les années ; à cheval sur le changement d'année (15 décembre → 15 janvier)", () => {
  const nov = per([1, 11], [30, 11]);
  const open = (p, iso, tz) => P.isOpen(p, at(iso), tz);
  assert.deepEqual(["2026-10-31T12:00:00Z", "2026-11-01T00:00:00Z", "2026-11-15T12:00:00Z", "2026-11-30T23:59:00Z", "2026-12-01T00:00:00Z", "2027-11-10T12:00:00Z", "2031-11-30T12:00:00Z", "2031-12-01T12:00:00Z"].map((d) => open(nov, d)), [false, true, true, true, false, true, true, false]);
  const wrap = per([15, 12], [15, 1]);
  assert.deepEqual(["2026-12-14T12:00:00Z", "2026-12-15T12:00:00Z", "2026-12-31T12:00:00Z", "2027-01-01T12:00:00Z", "2027-01-15T12:00:00Z", "2027-01-16T12:00:00Z", "2027-07-01T12:00:00Z", "2028-12-20T12:00:00Z"].map((d) => open(wrap, d)), [false, true, true, true, true, false, false, true]);
  assert.equal(open(null, "2026-01-01T00:00:00Z"), true, "pas de période : toujours");
  assert.equal(open(per([5, 5], [5, 5]), "2026-05-05T10:00:00Z"), true, "un seul jour");
  assert.equal(open(per([5, 5], [5, 5]), "2026-05-06T10:00:00Z"), false);
});

test("29 février : année bissextile = actif ce jour-là ; année ordinaire = le 28 février fermé/ouvert selon le côté, et réouverture le 1er mars", () => {
  const fromLeap = per([29, 2], [31, 3]);
  assert.equal(P.isOpen(fromLeap, at("2028-02-29T12:00:00Z")), true);
  assert.equal(P.isOpen(fromLeap, at("2027-02-28T12:00:00Z")), false);
  assert.equal(P.isOpen(fromLeap, at("2027-03-01T12:00:00Z")), true);
  assert.equal(ymd(P.nextOpening(fromLeap, at("2027-01-10T12:00:00Z"))), "2027-03-01", "année ordinaire : le 1er mars");
  assert.equal(ymd(P.nextOpening(fromLeap, at("2027-04-10T12:00:00Z"))), "2028-02-29", "l'année suivante est bissextile");
  const toLeap = per([1, 2], [29, 2]);
  assert.equal(P.isOpen(toLeap, at("2027-02-28T12:00:00Z")), true);
  assert.equal(P.isOpen(toLeap, at("2027-03-01T12:00:00Z")), false);
  assert.equal(P.isOpen(toLeap, at("2028-02-29T12:00:00Z")), true);
});

test("fuseau : la date est celle du fuseau réglé (UTC sans fuseau), pas celle du serveur", () => {
  const nov = per([1, 11], [30, 11]);
  const instant = "2026-10-31T23:30:00Z";
  assert.equal(P.isOpen(nov, at(instant), "UTC"), false);
  assert.equal(P.isOpen(nov, at(instant), "Europe/Paris"), true, "il est déjà le 1er novembre à Paris");
  assert.equal(P.isOpen(nov, at(instant), "America/Montreal"), false);
  assert.equal(P.isOpen(nov, at("2026-12-01T03:00:00Z"), "America/Montreal"), true, "encore le 30 novembre à Montréal");
  assert.equal(P.isOpen(nov, at("2026-12-01T03:00:00Z"), "UTC"), false);
});

test("période unique : avec ses années, une seule fois ; réouverture calculée, ou « terminée »", () => {
  const p = P.parsePeriod({ yearly: false, from: { d: 1, m: 11, y: 2026 }, to: { d: 30, m: 11, y: 2026 } }).value;
  assert.deepEqual(["2026-10-31T12:00:00Z", "2026-11-01T12:00:00Z", "2026-11-30T12:00:00Z", "2026-12-01T12:00:00Z", "2027-11-10T12:00:00Z"].map((d) => P.isOpen(p, at(d))), [false, true, true, false, false]);
  assert.equal(ymd(P.nextOpening(p, at("2026-09-01T12:00:00Z"))), "2026-11-01");
  assert.equal(P.nextOpening(p, at("2027-01-01T12:00:00Z")), null);
  assert.equal(P.nextOpening(p, at("2026-11-05T12:00:00Z")), null, "ouverte : pas de réouverture");
  const nov = per([1, 11], [30, 11]);
  assert.equal(ymd(P.nextOpening(nov, at("2026-12-01T12:00:00Z"))), "2027-11-01");
  assert.equal(ymd(P.nextOpening(nov, at("2026-03-01T12:00:00Z"))), "2026-11-01");
  assert.equal(ymd(P.nextOpening(per([15, 12], [15, 1]), at("2027-02-01T12:00:00Z"))), "2027-12-15");
});

test("formes de saisie : « 01/11 - 30/11 », avec années, « MM-JJ » des outils ; erreurs avec exemple", () => {
  assert.deepEqual(P.parsePeriodText("01/11 - 30/11").value, per([1, 11], [30, 11]));
  assert.deepEqual(P.parsePeriodText("1/11 au 30/11").value, per([1, 11], [30, 11]));
  assert.equal(P.parsePeriodText("01/11/2026 - 30/11/2026").value.yearly, false);
  assert.equal(P.parsePeriodText("").value, null);
  for (const bad of ["bientôt", "01/11", "31/02 - 01/03", "01/11/2026 - 30/11"]) assert.equal(P.parsePeriodText(bad).ok, false, bad);
  assert.deepEqual(P.parsePeriodIso("11-01", "11-30").value, per([1, 11], [30, 11]));
  assert.equal(P.parsePeriodIso("2026-11-01", "2026-11-30").value.yearly, false);
  assert.equal(P.parsePeriodIso("2026-11-01", "2026-11-30", true).value.yearly, true, "le drapeau yearly l'emporte… mais sans années gardées");
  assert.equal(P.parsePeriodIso("11-01", undefined).ok, false);
  assert.equal(P.parsePeriodIso("1 novembre", "30 novembre").ok, false);
});

/* ───────────── Les commandes ───────────── */

const NOV = { fromDay: "1", fromMonth: "11", toDay: "30", toMonth: "11", yearly: "on" };
const make = async (ctx, name, extra = {}) => {
  const env = { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" };
  const r = await C.saveCommand(ctx, { kind: "custom" }, { name, text: `${name} ok`, enabled: true, cdGlobal: 0, cdUser: 0, ...extra }, env);
  assert.equal(r.ok, true, JSON.stringify(r)); return r;
};
const OCT = Date.parse("2026-10-14T20:00:00Z"), IN = Date.parse("2026-11-10T20:00:00Z");

test("hors période : la commande ne répond pas, le journal dit quand elle revient ; dans la période elle répond ; chaque année", async () => {
  const { ctx, tw } = world();
  await make(ctx, "movember", { period: P.parsePeriod(yearly([1, 11], [30, 11])).value });
  const out = await say(ctx, "!movember", {}, OCT);
  assert.deepEqual([out.result, out.reason, out.reopen], ["refused", "outside", "2026-11-01"]);
  assert.equal(tw.chat.length, 0);
  assert.equal((await say(ctx, "!movember", { chatterId: "2" }, IN)).result, "sent");
  assert.equal(sent(tw)[0], "movember ok");
  assert.equal((await say(ctx, "!movember", { chatterId: "3" }, Date.parse("2027-11-30T10:00:00Z"))).result, "sent", "l'année suivante, sans rien faire");
  assert.equal((await say(ctx, "!movember", { chatterId: "4" }, Date.parse("2027-12-01T10:00:00Z"))).reason, "outside");
  const page = await A.panel(ctx, { query: {} });
  const table = page.find((b) => b.type === "table" && b.columns[0] === "Commande");
  const row = table.rows.find((r) => r[0].includes("!movember"));
  assert.match(row[1], /./);
  const logTable = page.find((b) => b.type === "table" && b.columns[0].startsWith("Heure"));
  assert.match(JSON.stringify(logTable.rows), /Hors période : se réactive le 1er novembre 2028.*Hors période : se réactive le 1er novembre 2026/s);
});

test("l'administration dit « Hors période : se réactive le … », distinct de « désactivée » ; l'interrupteur « activée » à faux l'emporte toujours ; la commande reste modifiable", async () => {
  const { ctx } = world();
  const r = await make(ctx, "movember", { period: P.parsePeriod(yearly([1, 11], [30, 11])).value });
  const state = async (now) => { const list = C.catalog((await C.loadConfig(ctx)).data, await SRC.gather(ctx, "emma"), ctx.t, { now, timeZone: "Europe/Paris" }); return list.find((c) => c.key === r.key); };
  const out = await state(OCT);
  assert.deepEqual([out.state, out.why, ymd(out.reopen)], ["outside", "outside_period", "2026-11-01"]);
  assert.equal((await state(IN)).state, "on");
  await C.saveCommand(ctx, { kind: "custom", id: r.key.slice(7) }, { enabled: false }, { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" });
  assert.equal((await state(OCT)).state, "off", "désactivée : « désactivée » l'emporte sur « hors période »");
  assert.equal((await state(IN)).state, "off", "et dans la période aussi");
  await C.saveCommand(ctx, { kind: "custom", id: r.key.slice(7) }, { enabled: true }, { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" });
  const info = await A.context(ctx, { declare: false });
  const edit = await A.panel(ctx, { query: { edit: r.key } });
  const text = JSON.stringify(edit);
  assert.match(text, /Active du 1(er)? novembre au 30 novembre, chaque année/);
  assert.ok(edit.some((b) => b.type === "adminForm" && b.action === "save"), "modifiable hors période");
  void info;
});

test("l'aperçu de la période dit le fuseau : UTC quand aucun n'est réglé", async () => {
  const utc = world({ settings: { timezone: "UTC" } });
  const r = await make(utc.ctx, "m", { period: per([1, 11], [30, 11]) });
  assert.match(JSON.stringify(await A.panel(utc.ctx, { query: { edit: r.key } })), /heure UTC/);
  const paris = world();
  const r2 = await make(paris.ctx, "m", { period: per([1, 11], [30, 11]) });
  assert.ok(!/heure UTC/.test(JSON.stringify(await A.panel(paris.ctx, { query: { edit: r2.key } }))));
  assert.match(P.describe(paris.ctx, P.parsePeriod({ yearly: false, from: { d: 1, m: 11, y: 2026 }, to: { d: 30, m: 11, y: 2026 } }).value, "Europe/Paris"), /une seule fois/);
  assert.match(P.describe(paris.ctx, null, "UTC"), /Toujours active/);
});

test("formulaire : deux sélecteurs jour/mois, une case « chaque année », erreurs sous le champ avec exemple ; enregistré, relu, effaçable", async () => {
  const { ctx } = world();
  const form = (await A.panel(ctx, { query: {} })).find((b) => b.type === "adminForm" && b.action === "create");
  const names = form.fields.map((f) => f.name);
  for (const k of ["fromDay", "fromMonth", "toDay", "toMonth", "yearly", "fromYear", "toYear"]) assert.ok(names.includes(k), k);
  assert.equal(form.fields.find((f) => f.name === "fromMonth").options.length, 13);
  assert.equal(form.fields.find((f) => f.name === "yearly").kind, "checkbox");
  const base = { name: "movember", text: "Moustaches", role: "everyone", aliases: "", cdGlobal: "", cdUser: "" };
  const bad = await A.actions.create(ctx, { ...base, ...NOV, fromDay: "31", fromMonth: "2" });
  assert.match(bad.errors.fromDay, /Le 31 février n'existe pas\. Choisissez un autre jour, par exemple le 1er février/);
  assert.match((await A.actions.create(ctx, { ...base, fromDay: "1" })).errors.fromMonth, /Choisissez le jour ET le mois/);
  assert.match((await A.actions.create(ctx, { ...base, ...NOV, yearly: "" })).errors.fromYear, /Indiquez l'année, par exemple 2026/);
  assert.equal((await C.loadConfig(ctx)).data.custom.length, 0);
  assert.deepEqual(await A.actions.create(ctx, { ...base, ...NOV }), { ok: ctx.t("created") });
  const c = (await C.loadConfig(ctx)).data.custom[0];
  assert.deepEqual(c.period, { yearly: true, from: { m: 11, d: 1 }, to: { m: 11, d: 30 } });
  const edit = (await A.panel(ctx, { query: { edit: `custom:${c.id}` } })).find((b) => b.type === "adminForm" && b.action === "save");
  assert.deepEqual(["fromDay", "fromMonth", "toDay", "toMonth", "yearly"].map((k) => edit.fields.find((f) => f.name === k).value), ["1", "11", "30", "11", "on"]);
  await A.actions.save(ctx, { key: `custom:${c.id}`, name: "movember", text: "Moustaches", enabled: "on", role: "everyone", aliases: "", cdGlobal: "", cdUser: "", yearly: "on" });
  assert.equal((await C.loadConfig(ctx)).data.custom[0].period, undefined, "tout vider = toujours active");
});

test("les commandes existantes n'ont pas de période : toujours actives ; « activer / désactiver » ne touche pas à la période", async () => {
  const { ctx } = world();
  await C.mutate(ctx, (cfg) => { cfg.custom.push({ id: "old", name: "ancienne", aliases: [], text: "Toujours là", role: "everyone", enabled: true, cdGlobal: 0, cdUser: 0 }); return { ok: true }; });
  for (const now of [OCT, IN, Date.parse("2030-02-29T10:00:00Z")]) assert.equal((await say(ctx, "!ancienne", { chatterId: `u${now}` }, now)).result, "sent", String(now));
  const r = await make(ctx, "nov", { period: per([1, 11], [30, 11]) });
  await A.actions.toggle(ctx, { id: r.key }); await A.actions.toggle(ctx, { id: r.key });
  assert.ok((await C.loadConfig(ctx)).data.custom.find((c) => c.name === "nov").period);
});

test("les commandes toutes prêtes et le groupe ont aussi une période", async () => {
  const { ctx } = world();
  const env = { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" };
  assert.equal((await C.saveCommand(ctx, { kind: "builtin", id: "jeu" }, { period: per([1, 11], [30, 11]) }, env)).ok, true);
  assert.equal((await say(ctx, "!jeu", {}, OCT)).reason, "outside");
  assert.equal((await say(ctx, "!jeu", { chatterId: "2" }, IN)).result, "sent");
  assert.equal((await C.saveCommand(ctx, { kind: "builtin", id: "jeu" }, { period: null }, env)).ok, true);
  assert.equal((await C.loadConfig(ctx)).data.builtin.jeu.period, undefined);
});

/* ───────────── Les timers ───────────── */

test("timers : hors période ils ne comptent ni n'écrivent (pas de rafale à la réouverture) ; dans la période ils écrivent ; l'état dit quand ils reviennent", async () => {
  T.resetTimersMemory();
  const { ctx, tw } = world({ tw: { live: { channel: "emma", configured: true, known: true, live: true, title: "T", game: "G", startedAt: new Date(OCT).toISOString() } } });
  const saved = await T.saveTimer(ctx, {}, { name: "Subtember", text: "Septembre en or", minutes: 1, lines: 0, when: "always", period: per([1, 9], [30, 9]) });
  assert.equal(saved.ok, true);
  const line = (now) => T.processTimers(ctx, chat("coucou", { messageId: `p${now}` }), { now });
  await line(OCT);
  assert.equal((await line(OCT + 120_000)).sent, false);
  assert.equal(tw.chat.length, 0, "octobre : hors période");
  const sep = Date.parse("2027-09-10T10:00:00Z");
  assert.equal((await line(sep)).sent, false, "le premier message de la période arme le timer (pas de rafale)");
  assert.equal((await line(sep + 61_000)).sent, true);
  assert.deepEqual(sent(tw), ["Septembre en or"]);
  const page = await A.panel(ctx, { query: { tab: "timers" } });
  const table = page.find((b) => b.tab === "timers" && b.type === "table");
  assert.match(table.rows[0][1], /Hors période : se réactive le 1(er)? septembre \d{4}\./);
  const off = await T.saveTimer(ctx, { id: (await C.loadConfig(ctx)).data.timers[0].id }, { enabled: false });
  assert.equal(off.ok, true);
  assert.equal((await A.panel(ctx, { query: { tab: "timers" } })).find((b) => b.tab === "timers" && b.type === "table").rows[0][1], ctx.t("tm_state_off"), "désactivé l'emporte");
  const err = await T.saveTimer(ctx, {}, { name: "X", text: "x", minutes: 5, period: yearly([31, 2], [1, 3]) });
  assert.deepEqual([err.ok, err.code, err.field], [false, "period", "fromDay"]);
  const form = await (await import("../modules/twitch-bot/timersAdmin.mjs")).actions.timerCreate.run(ctx, { name: "Z", text: "z", minutes: "5", lines: "0", when: "always", fromDay: "31", fromMonth: "4", toDay: "1", toMonth: "5", yearly: "on" });
  assert.match(form.errors.fromDay, /Le 31 avril n'existe pas/);
});

/* ───────────── Outils des assistants ───────────── */

test("outils : activeFrom / activeUntil / yearly pour les commandes et les timers ; clearPeriod ; la liste montre la période et la réouverture", async () => {
  const { ctx } = world();
  assert.deepEqual(await tools.bot_command_create(ctx, { name: "subtember", text: "Septembre", activeFrom: "09-01", activeUntil: "09-30" }), { created: true, name: "subtember" });
  const c = (await C.loadConfig(ctx)).data.custom[0];
  assert.deepEqual(c.period, per([1, 9], [30, 9]));
  const view = (await tools.bot_commands_list(ctx, { kind: "custom" })).commands[0];
  assert.deepEqual([view.activeFrom, view.activeUntil, view.yearly], ["09-01", "09-30", true]);
  await tools.bot_command_update(ctx, { name: "subtember", activeFrom: "2026-09-01", activeUntil: "2026-09-30" });
  assert.equal((await C.loadConfig(ctx)).data.custom[0].period.yearly, false, "avec les années : une seule fois");
  await assert.rejects(tools.bot_command_update(ctx, { name: "subtember", activeFrom: "02-31", activeUntil: "03-01" }), (e) => e.expose && /n'existe pas/.test(e.message));
  await assert.rejects(tools.bot_command_update(ctx, { name: "subtember", activeFrom: "septembre", activeUntil: "09-30" }), (e) => e.expose && /11-01/.test(e.message));
  await assert.rejects(tools.bot_command_update(ctx, { name: "subtember", activeFrom: "09-01" }), (e) => e.expose);
  await tools.bot_command_update(ctx, { name: "subtember", clearPeriod: true });
  assert.equal((await C.loadConfig(ctx)).data.custom[0].period, undefined);
  await tools.timer_create(ctx, { name: "Rappel", text: "Hop", everyMinutes: 5, activeFrom: "12-15", activeUntil: "01-15" });
  const t = (await tools.timers_list(ctx, {})).timers[0];
  assert.deepEqual([t.activeFrom, t.activeUntil, t.yearly], ["12-15", "01-15", true], "à cheval sur l'année");
  await tools.timer_update(ctx, { name: "Rappel", clearPeriod: true });
  assert.equal((await tools.timers_list(ctx, {})).timers[0].activeFrom, undefined);
  const manifest = JSON.parse((await import("node:fs")).readFileSync(new URL("../modules/twitch-bot/module.json", import.meta.url), "utf8"));
  for (const k of ["bot_command_create", "bot_command_update", "timer_create", "timer_update"]) for (const p of ["activeFrom", "activeUntil", "yearly"]) assert.ok(manifest.mcp.find((m) => m.name === k).input.properties[p], `${k}.${p}`);
});

/* ───────────── Migration ───────────── */

test("migration des données 4 : une configuration d'avant (sans timers ni période) gagne une liste de timers vide, rien d'autre ne bouge ; rejouable", async () => {
  const { ctx } = world({});
  const before = { v: 1, custom: [{ id: "c1", name: "ancienne", aliases: ["old"], text: "Texte", role: "mods", enabled: true, cdGlobal: 5, cdUser: null }], builtin: { jeu: { enabled: false, role: "everyone", cdGlobal: null, cdUser: null } }, partners: {}, networks: {}, group: {} };
  await ctx.api.store.add("botConfig", structuredClone(before));
  await def.migrations[4](ctx);
  const row = (await ctx.api.store.list("botConfig", { limit: 1 }))[0].data;
  assert.deepEqual(row, { ...before, timers: [] });
  await def.migrations[4](ctx);
  assert.deepEqual((await ctx.api.store.list("botConfig", { limit: 1 }))[0].data, { ...before, timers: [] }, "rejouable sans effet");
  const none = world({});
  await def.migrations[4](none.ctx);
  assert.equal((await none.ctx.api.store.list("botConfig", { limit: 1 })).length, 0, "pas de configuration : rien n'est créé");
  assert.equal((await say(ctx, "!old", { badges: ["moderator"] }, OCT)).result, "sent", "la commande d'avant répond comme avant, sans période");
  const manifest = JSON.parse((await import("node:fs")).readFileSync(new URL("../modules/twitch-bot/module.json", import.meta.url), "utf8"));
  assert.equal(manifest.dataVersion, 4);
  const rows = C.readConfig({ ...before });
  assert.deepEqual(rows.timers, [], "relire une ancienne configuration sans timers ne casse rien");
});
