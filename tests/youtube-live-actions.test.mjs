// Actions du live YouTube : manifeste, langues, règles (formulaire, seuils, délai), lecture d'un message du chat, droits, outils pour les assistants.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseManifest } from "@/core/modules/manifest";
import { world, manifest, messages, def, R, C, E, T, SET, ALL_RIGHTS, S } from "./helpers/ytLiveWorld.mjs";
import { fakeYoutubeLive } from "./helpers/fakeYoutubeLive.mjs";

const DIR = new URL("../modules/youtube-live-actions", import.meta.url).pathname;

/* ───────────── Manifeste et langues ───────────── */

test("le manifeste est valide et déclare ce qu'il faut : une seule instance, cœur 0.2.6, besoins facultatifs, sujet consommé, aucun minuteur", () => {
  const r = parseManifest(manifest);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.id, "youtube-live-actions"); assert.equal(manifest.version, "1.1.0"); assert.equal(manifest.instances, "single"); assert.equal(manifest.minCore, "0.2.6");
  assert.equal(manifest.platform, "youtube"); assert.equal(manifest.type, "integration"); assert.equal(manifest.page, false);
  assert.deepEqual(manifest.requires.map((x) => [x.service, !!x.optional]).sort(), [["home-assistant.bridge", true], ["youtube.api", true], ["youtube.live", true]]);
  assert.deepEqual(manifest.consumes.map((x) => x.topic), ["ha.result"]);
  assert.equal(manifest.name.fr, "Actions du live YouTube");
  assert.deepEqual(manifest.rights.map((x) => x.id).sort(), ["yt.manage", "yt.stop", "yt.test"]);
  assert.equal(def.tasks, undefined, "aucune tâche en arrière-plan"); assert.equal(def.routes, undefined, "aucune route publique"); assert.equal(def.services, undefined);
  assert.deepEqual(manifest.tabs, [{ id: "use", label: { fr: "En direct", en: "Live" } }]);
  assert.deepEqual(manifest.permissions.slice().sort(), ["admin", "mcp", "storage", "topics"]);
});

test("français et anglais : mêmes clés, mêmes variables, rien de vide ; le manifeste est traduit partout", () => {
  const { fr, en } = messages;
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join();
  for (const k of Object.keys(fr)) { assert.ok(fr[k] && en[k], k); assert.equal(vars(fr[k]), vars(en[k]), k); }
  const walk = (o, path) => { if (o && typeof o === "object" && ("fr" in o || "en" in o)) { assert.ok(o.fr && o.en, `${path} : fr et en`); return; } if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`); };
  for (const k of ["name", "description", "privacy", "settings", "rights", "requires", "consumes", "mcp"]) walk(manifest[k], k);
  assert.ok(manifest.mcp.every((t) => typeof t.description === "string" && t.description.length > 20));
});

test("jamais d'argent « en points » : le vocabulaire des dons n'emploie pas « point » ; pas de jargon visible", () => {
  const all = JSON.stringify([messages.fr, messages.en, manifest.description, manifest.settings.filter((s) => !s.advanced)]);
  assert.ok(!/\bpoints?\b/i.test(all), "un don n'est pas un point");
  assert.ok(!/webhook|token|jeton|oauth|\bquota\b|endpoint|payload/i.test(JSON.stringify([messages.fr, messages.en])), "pas de jargon");
});

test("outils pour les assistants : noms courts, trois lectures accordées d'office, la simulation n'est jamais accordée d'office", () => {
  const impl = Object.keys(def.mcp).sort(), decl = manifest.mcp.map((t) => t.name).sort();
  assert.deepEqual(impl, decl);
  for (const t of manifest.mcp) assert.ok(`youtube-live-actions__${t.name}`.length <= 64 && t.name.length <= 40);
  assert.deepEqual(manifest.mcp.filter((t) => t.readOnly).map((t) => t.name).sort(), ["youtube_live_journal", "youtube_live_rules", "youtube_live_status"]);
  const sim = manifest.mcp.find((t) => t.name === "youtube_action_simulate");
  assert.ok(!sim.readOnly && !sim.default && !sim.destructive);
  assert.equal(manifest.mcp.length, 4, "aucun outil ne coupe, ne reprend, n'écrit une règle ou ne lit le chat");
});

test("réglages : valeurs par défaut sensées, avancés marqués, bornes respectées même avec des valeurs absurdes", () => {
  const set = (k) => manifest.settings.find((s) => s.key === k);
  assert.equal(set("readChat").default, true); assert.equal(set("modsStop").default, true); assert.equal(set("ifRefused").default, "silent");
  assert.equal(set("budgetPercent").default, 50); assert.equal(set("intervalSec").default, 15); assert.equal(set("maxAgeSec").default, 120);
  for (const k of ["thanks", "intervalSec", "budgetPercent", "maxAgeSec", "extraCurrencies"]) assert.equal(set(k).advanced, true, k);
  const ctx = (settings) => ({ setting: (k) => settings[k] });
  const d = SET.settingsOf(ctx({}));
  assert.equal(d.intervalMs, 15_000); assert.equal(d.budgetPercent, 50); assert.equal(d.maxAgeMs, 120_000); assert.equal(d.ifRefused, "silent"); assert.equal(d.readChat, true);
  const wild = SET.settingsOf(ctx({ intervalSec: "0", budgetPercent: 5000, maxAgeSec: "abc", thanks: "<b>x</b>\n\nmerci", ifRefused: "n'importe quoi", extraCurrencies: "PLN" }));
  assert.equal(wild.intervalMs, 15_000); assert.equal(wild.budgetPercent, 50); assert.equal(wild.maxAgeMs, 120_000); assert.equal(wild.ifRefused, "silent"); assert.ok(!/[<>]/.test(wild.thanks));
  assert.equal(SET.budgetUnits(wild), 5000);
});

/* ───────────── Règles ───────────── */

test("formulaire d'une règle : valeurs valides, erreurs PAR CHAMP avec un exemple, bornes (64 caractères, 3600 s, grammaire de l'action)", () => {
  const ok = R.validateRule({ name: "  Rouge   pour les gros dons ", type: "superchat", currency: "eur", min: "2,50", cooldownSec: "45", action: "lumieres:rouge" });
  assert.ok(ok.ok); assert.equal(ok.rule.name, "Rouge pour les gros dons"); assert.equal(ok.rule.currency, "EUR"); assert.equal(ok.rule.minMicros, 2_500_000); assert.equal(ok.rule.cooldownSec, 45);
  const bad = R.validateRule({ name: "", type: "nope", min: "abc", cooldownSec: "9999", action: "Lumières Rouge!" });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ["action", "cooldownSec", "name", "type"]);
  const bad2 = R.validateRule({ name: "x", type: "superchat", currency: "EUR", min: "cinq", cooldownSec: "30", action: "lumieres:rouge" });
  assert.deepEqual(Object.keys(bad2.errors), ["min"]);
  assert.equal(R.validateRule({ name: "x".repeat(200), type: "member", cooldownSec: "0", action: "a" }).rule.name.length, 64);
  assert.equal(R.validateRule({ name: "x", type: "superchat", currency: "EURO", min: "1", cooldownSec: "1", action: "a" }).errors.currency, "err_currency");
  assert.equal(R.validateRule({ name: "x", type: "gift", min: "0", cooldownSec: "1", action: "a" }).errors.min, "err_count");
  assert.equal(R.validateRule({ name: "x", type: "gift", min: "7", cooldownSec: "1", action: "a" }).rule.minCount, 7);
  const custom = R.validateRule({ name: "x", type: "member", cooldownSec: "1", action: "lumieres:rouge", customAction: "Lumieres:Violet" });
  assert.equal(custom.rule.action, "lumieres:violet", "l'autre nom l'emporte, en minuscules");
  assert.equal(R.validateRule({ name: "x", type: "superchat", currency: "*", cooldownSec: "1", action: "tts:lire", readMessage: "on" }).rule.readMessage, true);
  assert.equal(R.validateRule({ name: "x", type: "member", cooldownSec: "1", action: "tts:lire", readMessage: "on" }).rule.readMessage, false, "seul un Super Chat a un message");
  assert.equal(R.validateRule({ name: "x", type: "superchat", currency: "*", min: "99", cooldownSec: "1", action: "a1" }).rule.minMicros, 0, "toutes devises : pas de minimum");
});

test("les messages d'erreur de règle existent dans les deux langues et donnent un exemple", () => {
  for (const lang of ["fr", "en"]) for (const k of ["err_name", "err_type", "err_currency", "err_min", "err_count", "err_cooldown", "err_action"]) assert.ok(messages[lang][k].length > 20, k);
  assert.match(messages.fr.err_action, /lumieres:rouge/); assert.match(messages.en.err_min, /2\.50/);
});

test("montants : « 5 », « 2,50 », « 2.5 » en micros ; le reste est refusé", () => {
  assert.equal(R.toMicros("5"), 5_000_000); assert.equal(R.toMicros("2,50"), 2_500_000); assert.equal(R.toMicros("2.5"), 2_500_000); assert.equal(R.toMicros("0,000001"), 1);
  for (const bad of ["", "abc", "-1", "1e3", "5 €", "1,2,3", "9999999999"]) assert.equal(R.toMicros(bad), null, bad);
  assert.equal(R.fromMicros(2_500_000, "fr"), "2,5"); assert.equal(R.fromMicros(5_000_000, "en"), "5");
  assert.match(R.formatMoney(5_000_000, "EUR", "fr"), /5,00\s?€/); assert.match(R.formatMoney(5_000_000, "USD", "en"), /\$5\.00/);
  assert.match(R.formatMoney(5_000_000, "XYZ", "fr"), /5/, "devise inconnue : on écrit tout de même");
});

test("quelles règles s'appliquent : genre, devise, seuil exact, pause, trois au plus", () => {
  const mk = (o) => ({ id: o.name, enabled: true, minMicros: 0, minCount: 1, currency: "EUR", ...o });
  const rules = [mk({ name: "a", type: "superchat", minMicros: 5_000_000 }), mk({ name: "b", type: "superchat", currency: "*" }), mk({ name: "c", type: "superchat", currency: "USD", minMicros: 1_000_000 }), mk({ name: "off", type: "superchat", currency: "*", enabled: false }), mk({ name: "d", type: "superchat", currency: "*" }), mk({ name: "e", type: "superchat", currency: "*" })];
  const names = (ev) => R.matching(rules, ev).map((r) => r.name);
  assert.deepEqual(names({ kind: "superchat", micros: 5_000_000, currency: "EUR" }), ["a", "b", "d"], "trois au plus, la règle en pause est sautée");
  assert.deepEqual(names({ kind: "superchat", micros: 4_999_999, currency: "EUR" }), ["b", "d", "e"]);
  assert.deepEqual(names({ kind: "supersticker", micros: 9e9, currency: "EUR" }), []);
  assert.equal(R.cooldownLeft({ cooldownSec: 30, lastAt: 1000 }, 11_000), 20); assert.equal(R.cooldownLeft({ cooldownSec: 30, lastAt: 1000 }, 40_000), 0); assert.equal(R.cooldownLeft({ cooldownSec: 0, lastAt: 1000 }, 1001), 0);
});

test("au plus 20 règles", async () => {
  const w = await world();
  const add = (i) => S.saveRule(w.ctx, null, { ...R.validateRule({ name: `r${i}`, type: "member", cooldownSec: "0", action: "lumieres:rouge" }).rule, lastAt: 0 });
  for (let i = 0; i < 20; i++) assert.ok(await add(i));
  assert.equal(await add(21), null);
  assert.equal((await S.listRules(w.ctx)).length, 20);
  w.done();
});

/* ───────────── Un message du chat ───────────── */

test("lecture d'un message de YouTube : chaque genre, les valeurs absurdes écartées, les indicateurs de l'auteur", () => {
  const yt = fakeYoutubeLive();
  const sc = C.parseItem(yt.superChat({ who: "Léa", micros: 5_000_000, currency: "EUR", comment: "Bravo\u0000 <b>x</b>", mod: true }));
  assert.equal(sc.kind, "superchat"); assert.equal(sc.micros, 5_000_000); assert.equal(sc.currency, "EUR"); assert.equal(sc.isMod, true); assert.equal(sc.isOwner, false); assert.ok(!sc.text.includes("\u0000"));
  assert.equal(C.parseItem(yt.superSticker({})).kind, "supersticker");
  assert.equal(C.parseItem(yt.member({})).kind, "member");
  assert.deepEqual([C.parseItem(yt.gift({ count: 12 })).kind, C.parseItem(yt.gift({ count: 12 })).count], ["gift", 12]);
  assert.equal(C.parseItem(yt.received({})), null, "le reçu d'un cadeau n'est pas un don");
  assert.equal(C.parseItem(yt.text({ text: "bonjour tout le monde" })), null);
  assert.equal(C.parseItem(yt.text({ text: " !STOP " })).command, "stop");
  assert.equal(C.parseItem(yt.text({ text: "!stop maintenant" })), null, "le mot seul, rien d'autre");
  assert.equal(C.parseItem(yt.superChat({ micros: "abc" })).kind, "invalid");
  assert.equal(C.parseItem(yt.superChat({ micros: 5e18, currency: "EUR" })).kind, "invalid");
  assert.equal(C.parseItem(yt.superChat({ currency: "euros" })).kind, "invalid");
  for (const junk of [null, 5, "x", {}, { id: "a" }, { id: "a", snippet: {} }, { id: "a", snippet: { type: "superChatEvent" } }]) assert.ok([null, "invalid"].includes(C.parseItem(junk)?.kind ?? null));
});

test("qui peut donner un ordre : les indicateurs de YouTube, jamais le pseudo", () => {
  const yt = fakeYoutubeLive();
  const ev = (o) => C.parseItem(yt.text({ text: "!stop", ...o }));
  const may = (e, modsStop = true) => C.mayCommand(e, { modsStop });
  assert.equal(may(ev({ owner: true })), true);
  assert.equal(may(ev({ mod: true })), true);
  assert.equal(may(ev({ mod: true }), false), false);
  assert.equal(may(ev({ who: "Moderateur" })), false); assert.equal(may(ev({ who: "Emma (propriétaire)" })), false); assert.equal(may(ev({ member: true })), false);
  const start = (o) => C.parseItem(yt.text({ text: "!start", ...o }));
  assert.equal(may(start({ owner: true })), true); assert.equal(may(start({ mod: true })), false);
});

/* ───────────── Outils pour les assistants ───────────── */

test("outils en lecture : ne demandent rien à YouTube, n'écrivent rien ; l'état dit que le chat n'est lu que page ouverte", async () => {
  const w = await world();
  w.yt.goLive();
  await S.addJournal(w.ctx, [{ kind: "superchat", who: "Léa", micros: 5_000_000, currency: "EUR", rule: "Rouge", key: "lumieres:rouge", status: "done" }]);
  const before = w.dump();
  const calls = w.yt.calls.all.length;
  const st = await T.youtube_live_status(w.ctx);
  assert.equal(st.readingNow, false); assert.equal(st.pageOpen, false); assert.match(st.note, /only read while a page/);
  const jr = await T.youtube_live_journal(w.ctx, { limit: 5 });
  assert.equal(jr.length, 1); assert.equal(jr[0].amount, 5); assert.equal(jr[0].currency, "EUR"); assert.equal(jr[0].action, "lumieres:rouge");
  assert.deepEqual(await T.youtube_live_rules(w.ctx), []);
  assert.equal(w.dump(), before, "aucune écriture");
  assert.equal(w.yt.calls.all.length, calls, "aucun appel à YouTube");
  assert.equal(w.ctx.calls.net.length, 0);
  assert.ok(!JSON.stringify([st, jr]).includes("FAKE-YT-KEY"));
  w.done();
});

test("outil de simulation : même chemin que la page, refus clairs, aucune lecture de YouTube", async () => {
  const w = await world();
  await S.saveRule(w.ctx, null, { ...R.validateRule({ name: "Rouge", type: "superchat", currency: "EUR", min: "5", cooldownSec: "30", action: "lumieres:rouge" }).rule, lastAt: 0 });
  const r = await T.youtube_action_simulate(w.ctx, { type: "superchat", amount: "5", currency: "EUR" });
  assert.equal(r.results[0].rule, "Rouge"); assert.equal(r.results[0].status, "sent");
  await assert.rejects(() => T.youtube_action_simulate(w.ctx, { amount: "5" }), (e) => e.expose === true && /too fast/.test(e.message));
  w.tick(4000);
  await assert.rejects(() => T.youtube_action_simulate(w.ctx, { amount: "abc" }), (e) => e.expose === true && /invalid input/.test(e.message));
  assert.equal(w.yt.calls.all.length, 0);
  w.done();
  const w2 = await world({ noBridge: true });
  await assert.rejects(() => T.youtube_action_simulate(w2.ctx, {}), (e) => /not installed/.test(e.message));
  w2.done();
});

test("README, description complète et journal des changements présents", () => {
  for (const f of ["README.md"]) assert.ok(fs.readFileSync(`${DIR}/${f}`, "utf8").length > 1500);
  const docs = new URL("../docs/ideas/", import.meta.url).pathname;
  assert.ok(fs.readFileSync(`${docs}youtube-live-actions.md`, "utf8").length > 3000);
  const ch = fs.readFileSync(`${docs}youtube-live-actions.changelog.md`, "utf8");
  for (const h of ["Nouveautés", "Améliorations", "Pour les développeurs"]) assert.ok(ch.includes(h), h);
});
void E; void ALL_RIGHTS;
