// Migration 1.x → 2.0.0 du Planning : l'ancienne adresse iCal devient une instance du Calendrier iCal (semée par le cœur), puis l'ancien réglage est effacé.
// Le faux contexte de migration enregistre les appels (`calls.seeds`, `calls.cleared`) ; le cœur, lui, garantit « rien d'effacé si le semis n'a pas abouti » et « tout défait si la migration échoue ».
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const mod = await import("../modules/planning/index.mjs");
const migrate = mod.default.migrations[2];
const manifest = JSON.parse(fs.readFileSync(new URL("../modules/planning/module.json", import.meta.url), "utf8"));
const fr = JSON.parse(fs.readFileSync(new URL("../modules/planning/locales/fr.json", import.meta.url), "utf8"));
const SECRET = "https://calendar.google.com/calendar/ical/moi%40exemple.test/private-TOP-SECRET-TOKEN/basic.ics";
const OTHER = "https://calendar.google.com/calendar/ical/autre/private-AUTRE-TOKEN/basic.ics";
const old = (settings = {}, over = {}) => fakeCtx({ migration: true, settings: { icsUrl: SECRET, timezone: "Europe/Paris", days: 7, ...settings }, messages: fr, locale: "fr", ...over });

test("manifeste : dataVersion 2, requires calendar.provider, seeds calendar-ical, une migration 2 ; la cible offre bien le service requis", () => {
  assert.equal(manifest.dataVersion, 2);
  assert.deepEqual(Object.keys(mod.default.migrations), ["2"]);
  assert.deepEqual(manifest.requires, [{ service: "calendar.provider" }]);
  assert.equal(manifest.seeds.length, 1);
  assert.equal(manifest.seeds[0].module, "calendar-ical");
  assert.ok(manifest.seeds[0].reason.fr && manifest.seeds[0].reason.en);
  const target = JSON.parse(fs.readFileSync(new URL("../modules/calendar-ical/module.json", import.meta.url), "utf8"));
  assert.ok(target.offers.some((o) => o.service === "calendar.provider"));
});

test("ancienne adresse → une instance du Calendrier iCal avec la même adresse (secrète) et le même fuseau, puis l'ancien réglage effacé APRÈS le semis", async () => {
  const ctx = old();
  const order = [];
  const seed = ctx.seedInstance, clear = ctx.clearSetting;
  ctx.seedInstance = async (...a) => { order.push("seed"); return seed(...a); };
  ctx.clearSetting = async (...a) => { order.push("clear"); return clear(...a); };
  await migrate(ctx);
  assert.deepEqual(order, ["seed", "clear"]);
  assert.equal(ctx.calls.seeds.length, 1);
  const [target, req] = ctx.calls.seeds[0];
  assert.equal(target, "calendar-ical");
  assert.equal(req.settings.url, SECRET);
  assert.equal(req.settings.timezone, "Europe/Paris");
  assert.deepEqual(Object.keys(req.settings).sort(), ["timezone", "url"]);
  assert.equal(req.nickname, "Agenda iCal");
  assert.deepEqual(ctx.calls.cleared, ["icsUrl"]);
  assert.equal(ctx.setting("icsUrl"), undefined);
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
    assert.deepEqual([ctx.calls.seeds.length, ctx.calls.cleared.length], [0, 0], JSON.stringify(settings));
  }
});

test("fuseau absent ou absurde : seule l'adresse est semée (le fournisseur retombe sur UTC) — jamais une valeur refusée par le cœur", async () => {
  for (const timezone of [undefined, "", "Mars/Olympe"]) {
    const ctx = old({ timezone }); await migrate(ctx);
    assert.deepEqual(Object.keys(ctx.calls.seeds[0][1].settings), ["url"], String(timezone));
  }
});

test("échec du semis : la migration échoue (le cœur remet tout comme avant) et RIEN n'est effacé", async () => {
  const ctx = old({}, { seedResult: () => { throw new Error("cible indisponible"); } });
  await assert.rejects(() => migrate(ctx), /cible indisponible/);
  assert.deepEqual(ctx.calls.cleared, []);
  assert.equal(ctx.setting("icsUrl"), SECRET);
});

test("relance (déjà semé, même si l'instance a été supprimée depuis) : aucun doublon demandé par le module, l'ancien réglage est quand même effacé", async () => {
  const ctx = old({}, { seedResult: { created: false, instanceKey: "agenda-ical" } });
  await migrate(ctx);
  assert.equal(ctx.calls.seeds.length, 1, "un seul appel : c'est le cœur qui reconnaît la graine déjà semée");
  assert.deepEqual(ctx.calls.cleared, ["icsUrl"]);
  // idempotence côté module : une seconde exécution sur l'état migré (réglage effacé) ne fait rien
  const again = old({ icsUrl: undefined }, { seedResult: { created: false, instanceKey: "agenda-ical" } });
  await migrate(again);
  assert.deepEqual([again.calls.seeds.length, again.calls.cleared.length], [0, 0]);
});

test("deux plannings, deux adresses : une instance par adresse, chacun efface son propre réglage", async () => {
  const one = old(), two = old({ icsUrl: OTHER });
  await migrate(one); await migrate(two);
  assert.notEqual(one.calls.seeds[0][1].seedKey, two.calls.seeds[0][1].seedKey);
  assert.equal(one.calls.seeds[0][1].settings.url, SECRET); assert.equal(two.calls.seeds[0][1].settings.url, OTHER);
  assert.deepEqual([one.calls.cleared, two.calls.cleared], [["icsUrl"], ["icsUrl"]]);
});

test("sans contexte de migration (appel hors migration) : le module n'a pas de seedInstance, la migration lève plutôt que d'effacer", async () => {
  const ctx = fakeCtx({ settings: { icsUrl: SECRET } });
  await assert.rejects(() => migrate(ctx));
  assert.equal(ctx.setting("icsUrl"), SECRET);
});

test("le planning migré montre les mêmes évènements : le fournisseur semé (même adresse) lui sert ce que lisait l'ancien Planning", async () => {
  const { feedOptions, calendar, vevent, hoursFromNow } = await import("./helpers/icalFeed.mjs");
  const text = calendar(vevent("1", hoursFromNow(2), hoursFromNow(3), "Soirée", ["DESCRIPTION:Jeu: Celeste"]), vevent("2", hoursFromNow(30), hoursFromNow(31), "Demain"));
  const after = fakeCtx({ ...feedOptions(() => [{ text }]), settings: { days: 7, timezone: "UTC" }, messages: fr, locale: "fr", rawgConfigured: false });   // état après migration : plus d'icsUrl
  const rows = await mod.default.mcp.planning_upcoming(after, { days: 7 });
  assert.deepEqual(rows.map((r) => [r.title, r.games]), [["Soirée", ["Celeste"]], ["Demain", []]]);
  assert.equal(after.setting("icsUrl"), undefined);
});
