// Migrations 2 et 3 du Planning (TEMPORAIRES, à retirer en 0.3.0) : l'ancienne adresse iCal (`legacySettings`, jamais affichée) devient une instance de l'Agenda en ligne (semée par le cœur), puis elle est effacée.
// Le faux contexte de migration enregistre les appels (`calls.seeds`, `calls.cleared`) ; le cœur, lui, garantit « rien d'effacé si le semis n'a pas abouti » et « tout défait si la migration échoue ».
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const mod = await import("../modules/planning/index.mjs");
const migrate = mod.default.migrations[2];
const migrate3 = mod.default.migrations[3];
const manifest = JSON.parse(fs.readFileSync(new URL("../modules/planning/module.json", import.meta.url), "utf8"));
const fr = JSON.parse(fs.readFileSync(new URL("../modules/planning/locales/fr.json", import.meta.url), "utf8"));
const SECRET = "https://calendar.google.com/calendar/ical/moi%40exemple.test/private-TOP-SECRET-TOKEN/basic.ics";
const OTHER = "https://calendar.google.com/calendar/ical/autre/private-AUTRE-TOKEN/basic.ics";
/** Une instance d'avant : l'adresse est dans `legacy` (clé héritée), plus dans les réglages. `settings.icsUrl` (rétro-compatibilité des appels) devient la valeur héritée. */
const old = (given = {}, over = {}) => { const { icsUrl, ...settings } = given; return fakeCtx({ migration: true, legacy: { icsUrl: "icsUrl" in given ? icsUrl : SECRET }, settings: { timezone: "Europe/Paris", days: 7, ...settings }, messages: fr, locale: "fr", ...over }); };

test("manifeste : dataVersion 3, migrations 2 et 3, adresse d'avant seulement en legacySettings (secret), seeds calendar-ical ; lien par le SUJET (aucun requires) et la cible fournit bien le sujet consommé", () => {
  assert.equal(manifest.dataVersion, 3);
  assert.deepEqual(Object.keys(mod.default.migrations), ["2", "3"]);
  assert.deepEqual(manifest.legacySettings, [{ key: "icsUrl", secret: true }]);
  assert.ok(!manifest.settings.some((s) => s.key === "icsUrl"), "plus de champ visible");
  assert.equal(manifest.requires, undefined, "aucune dépendance forte : le Planning marche sans agenda");
  assert.equal(manifest.seeds.length, 1);
  assert.equal(manifest.seeds[0].module, "calendar-ical");
  assert.ok(manifest.seeds[0].reason.fr && manifest.seeds[0].reason.en);
  const target = JSON.parse(fs.readFileSync(new URL("../modules/calendar-ical/module.json", import.meta.url), "utf8"));
  assert.ok(target.provides.some((p) => p.topic === "planning.slot") && manifest.consumes.some((c) => c.topic === "planning.slot"));
  assert.equal(manifest.minCore, "0.2.0", "ctx.legacy (réglages hérités) arrive avec le cœur 0.2.0");
  const url = target.settings.map((s) => s.key);
  assert.ok(url.includes("url") && url.includes("timezone"), "les réglages semés existent chez la cible");
  assert.equal(target.settings.find((s) => s.key === "url").type, "secret");
});

test("ancienne adresse → une instance du Calendrier iCal avec la même adresse (secrète) et le même fuseau, puis l'ancien réglage effacé APRÈS le semis", async () => {
  const ctx = old();
  const order = [];
  const seed = ctx.seedInstance, clear = ctx.legacy.clear;
  ctx.seedInstance = async (...a) => { order.push("seed"); return seed(...a); };
  ctx.legacy.clear = async (...a) => { order.push("clear"); return clear(...a); };
  await migrate(ctx);
  assert.deepEqual(order, ["seed", "clear"]);
  assert.equal(ctx.calls.seeds.length, 1);
  const [target, req] = ctx.calls.seeds[0];
  assert.equal(target, "calendar-ical");
  assert.equal(req.settings.url, SECRET);
  assert.equal(req.settings.timezone, "Europe/Paris");
  assert.deepEqual(Object.keys(req.settings).sort(), ["timezone", "url"]);
  assert.equal(req.nickname, "Agenda en ligne");
  assert.deepEqual(ctx.calls.legacyCleared, ["icsUrl"]);
  assert.equal(await ctx.legacy.get("icsUrl"), null);
  assert.deepEqual(ctx.calls.cleared, [], "pas de clearSetting : l'adresse n'est plus un réglage");
  assert.equal(ctx.setting("days"), 7, "les autres réglages sont intacts");
});

test("la clé de graine est un hachage : jamais l'adresse (ni un morceau), stable, valide pour le cœur, différente pour une autre adresse", async () => {
  const a = old(), b = old(), c = old({ icsUrl: OTHER }), d = old({ icsUrl: `  ${SECRET}\n` });
  for (const x of [a, b, c, d]) await migrate(x);
  const key = (x) => x.calls.seeds[0][1].seedKey;
  assert.match(key(a), /^[a-z][a-z0-9._-]{0,40}$/, "forme exigée par le cœur");
  assert.equal(key(a), key(b), "deux plannings avec la même adresse : la même clé");
  assert.equal(key(a), key(d), "espaces autour de l'adresse sans effet");
  assert.notEqual(key(a), key(c));
  for (const x of [a, c]) {
    const all = JSON.stringify(x.calls.seeds[0][1]).replace(x.calls.seeds[0][1].settings.url, "");
    assert.ok(!/SECRET|TOKEN|google|exemple/i.test(all), "ni la clé, ni le surnom ne contiennent l'adresse");
  }
});

test("adresse vide ou absente : rien n'est semé, rien n'est effacé", async () => {
  for (const settings of [{ icsUrl: "" }, { icsUrl: "   " }, { icsUrl: undefined }]) {
    const ctx = old(settings);
    await migrate(ctx);
    assert.deepEqual([ctx.calls.seeds.length, ctx.calls.legacyCleared.length], [0, 0], JSON.stringify(settings));
  }
});

test("fuseau absent ou absurde : l'agenda reçoit « UTC » explicitement — exactement ce que lisait l'ancien Planning (jamais l'annonce de l'agenda, jamais une valeur refusée par le cœur)", async () => {
  for (const timezone of [undefined, "", "   ", "Mars/Olympe"]) {
    const ctx = old({ timezone }); await migrate(ctx);
    assert.deepEqual(ctx.calls.seeds[0][1].settings, { url: SECRET, timezone: "UTC" }, String(timezone));
  }
});

test("échec du semis : la migration échoue (le cœur remet tout comme avant) et RIEN n'est effacé", async () => {
  const ctx = old({}, { seedResult: () => { throw new Error("cible indisponible"); } });
  await assert.rejects(() => migrate(ctx), /cible indisponible/);
  assert.deepEqual(ctx.calls.legacyCleared, []);
  assert.equal(await ctx.legacy.get("icsUrl"), SECRET);
});

test("relance (déjà semé, même si l'instance a été supprimée depuis) : aucun doublon demandé par le module, l'ancien réglage est quand même effacé", async () => {
  const ctx = old({}, { seedResult: { created: false, instanceKey: "agenda-en-ligne" } });
  await migrate(ctx);
  assert.equal(ctx.calls.seeds.length, 1, "un seul appel : c'est le cœur qui reconnaît la graine déjà semée");
  assert.deepEqual(ctx.calls.legacyCleared, ["icsUrl"]);
  // idempotence côté module : une seconde exécution sur l'état migré (réglage effacé) ne fait rien
  const again = old({ icsUrl: undefined }, { seedResult: { created: false, instanceKey: "agenda-en-ligne" } });
  await migrate(again);
  assert.deepEqual([again.calls.seeds.length, again.calls.legacyCleared.length], [0, 0]);
});

test("deux plannings, deux adresses : une instance par adresse, chacun efface son propre réglage", async () => {
  const one = old(), two = old({ icsUrl: OTHER });
  await migrate(one); await migrate(two);
  assert.notEqual(one.calls.seeds[0][1].seedKey, two.calls.seeds[0][1].seedKey);
  assert.equal(one.calls.seeds[0][1].settings.url, SECRET); assert.equal(two.calls.seeds[0][1].settings.url, OTHER);
  assert.deepEqual([one.calls.legacyCleared, two.calls.legacyCleared], [["icsUrl"], ["icsUrl"]]);
});

test("sans contexte de migration (appel hors migration) : le module n'a pas de seedInstance, la migration lève plutôt que d'effacer", async () => {
  const ctx = fakeCtx({ legacy: { icsUrl: SECRET } });
  await assert.rejects(() => migrate(ctx));
  assert.equal(await ctx.legacy.get("icsUrl"), SECRET);
});

test("le planning migré montre les mêmes évènements : l'agenda semé (même adresse, même fuseau) sert ce que lisait l'ancien Planning, et le fuseau d'affichage suit", async () => {
  const { feedTopics, calendar, vevent, hoursFromNow } = await import("./helpers/icalFeed.mjs");
  const text = calendar(vevent("1", hoursFromNow(2), hoursFromNow(3), "Soirée", ["DESCRIPTION:Jeu: Celeste"]), vevent("2", hoursFromNow(30), hoursFromNow(31), "Demain"));
  // état après migration : plus d'icsUrl, plus de fuseau d'affichage (il suit l'agenda, qui a reçu l'ancien fuseau)
  const after = fakeCtx({ settings: { days: 7 }, topics: feedTopics(() => text, { timeZone: "Europe/Paris" }), messages: fr, locale: "fr", rawgConfigured: false });
  const rows = await mod.default.mcp.planning_upcoming(after, { days: 7 });
  assert.deepEqual(rows.map((r) => [r.title, r.games]), [["Soirée", ["Celeste"]], ["Demain", []]]);
  assert.equal(after.legacy, undefined);
  assert.match((await mod.default.page(after)).blocks[0].text, /Europe\/Paris/, "l'intitulé « heure Europe/Paris » vient de l'agenda, comme avant il venait du réglage");
});

test("graine : un hachage stable de l'adresse (jamais l'adresse), valide pour le cœur", () => {
  const k = mod.seedKeyOf(SECRET);
  assert.match(k, /^ical-[0-9a-f]{16}$/);
  assert.equal(k, mod.seedKeyOf(`  ${SECRET} `));
  assert.notEqual(k, mod.seedKeyOf(OTHER));
  assert.ok(!k.includes("TOKEN"));
});

test("catalogue : le module que la migration doit installer (calendar-ical) est dans l'index, annonce le sujet que le Planning lit et vise la même étiquette — sinon la mise à jour mettrait le Planning à l'écart", () => {
  const index = JSON.parse(fs.readFileSync(new URL("../catalogue/index.json", import.meta.url), "utf8")).modules;
  const planning = index.find((m) => m.id === "planning");
  for (const seed of manifest.seeds) {
    const target = index.find((m) => m.id === seed.module);
    assert.ok(target, `${seed.module} absent de catalogue/index.json`);
    assert.ok(target.provides?.includes("planning.slot"), "l'index annonce le sujet : c'est lui que le cœur vérifie avant de télécharger");
    assert.equal(target.ref, planning.ref, "même étiquette que le Planning : publiés ensemble");
    assert.ok(!target.requires || target.requires.core <= planning.requires.core);
  }
});

test("migration 3 : même reprise (site déjà en version 2 qui a gardé une adresse) ; rejouée deux fois après la 2, elle ne fait rien de plus", async () => {
  const ctx = old();
  await migrate(ctx);
  await migrate3(ctx); await migrate3(ctx);
  assert.equal(ctx.calls.seeds.length, 1, "une seule graine demandée : la 3 trouve l'adresse déjà effacée");
  assert.deepEqual(ctx.calls.legacyCleared, ["icsUrl"]);
  const kept = old({}, { seedResult: { created: false, instanceKey: "agenda-en-ligne" } });
  await migrate3(kept);
  assert.deepEqual([kept.calls.seeds.length, kept.calls.legacyCleared], [1, ["icsUrl"]]);
  const none = old({ icsUrl: "" }); await migrate3(none);
  assert.deepEqual([none.calls.seeds.length, none.calls.legacyCleared.length], [0, 0]);
});

test("l'adresse (secret) n'est jamais affichée, journalisée ni écrite par la migration : ni message, ni écriture, ni état de la graine", async () => {
  const ctx = old();
  await migrate(ctx);
  const seen = JSON.stringify({ ...ctx.calls, seeds: ctx.calls.seeds.map(([t, r]) => [t, r.nickname, r.seedKey]) });
  assert.ok(!seen.includes("TOP-SECRET"), "hors réglage semé chez la cible, l'adresse n'apparaît nulle part");
  assert.ok(!JSON.stringify(await mod.default.adminPanel(ctx)).includes("TOP-SECRET"));
});
