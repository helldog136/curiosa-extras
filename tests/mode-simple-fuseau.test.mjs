// Mode simple : le fuseau horaire n'est plus demandé aux personnes (Sondages, Événements, Jeu du jour, Compte à rebours). Le réglage passe en avancé,
// garde sa valeur par défaut (« Europe/Paris ») et sa valeur déjà saisie ; si elle manque ou est abîmée, le module lit le fuseau du site (ctx.timezone, cœur 0.6.4), puis son repli d'avant.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const manifest = (id) => JSON.parse(fs.readFileSync(path.join(root, "modules", id, "module.json"), "utf8"));

for (const id of ["polls", "events", "daily-game", "countdown"]) {
  test(`[${id}] le fuseau est un réglage avancé, avec la même valeur par défaut et les mêmes choix`, () => {
    const s = manifest(id).settings.find((f) => f.key === "timezone");
    assert.equal(s.advanced, true);
    assert.ok(!s.rare);
    assert.equal(s.default, "Europe/Paris", "un site qui n'a rien réglé garde exactement son fuseau d'avant");
    assert.equal(s.type, "select");
    assert.ok(s.options.some((o) => o.value === "Europe/Paris"));
    const simple = manifest(id).settings.filter((f) => !f.advanced && !f.rare).map((f) => f.key);
    assert.ok(!simple.includes("timezone"), "plus de question de fuseau en mode simple");
  });
}

const stub = (timezone, value) => ({ timezone, setting: (k) => (k === "timezone" ? value : undefined) });
const { tzOf: pollsTz } = await import("../modules/polls/index.mjs");
const { tzOf: dailyTz } = await import("../modules/daily-game/data.mjs");
const { siteZone: eventsZone } = await import("../modules/events/data.mjs");
const { defaultZone: countdownZone } = await import("../modules/countdown/admin.mjs");

const CASES = [
  ["polls", pollsTz, "Europe/Paris"],
  ["daily-game", dailyTz, "Europe/Paris"],
  ["events", eventsZone, "UTC"],
  ["countdown", countdownZone, "Europe/Paris"],
];
for (const [name, fn, before] of CASES) {
  test(`[${name}] fuseau : la valeur saisie gagne, puis le fuseau du site, puis le repli d'avant`, () => {
    assert.equal(fn(stub("America/Montreal", "Asia/Tokyo")), "Asia/Tokyo", "valeur déjà saisie : gardée");
    assert.equal(fn(stub("America/Montreal", "Europe/Paris")), "Europe/Paris", "valeur par défaut enregistrée : gardée");
    assert.equal(fn(stub("America/Montreal", "")), "America/Montreal", "réglage vide : fuseau du site");
    assert.equal(fn(stub("America/Montreal", "Pas/Un_Fuseau")), "America/Montreal", "réglage abîmé : fuseau du site");
    assert.equal(fn(stub(undefined, "")), before, "cœur plus ancien (pas de ctx.timezone) : repli d'avant, inchangé");
    assert.equal(fn(stub(undefined, "Asia/Tokyo")), "Asia/Tokyo", "cœur plus ancien : valeur saisie gardée");
    assert.equal(fn(stub("Pas/Un_Fuseau", "")), before, "ctx.timezone illisible : repli d'avant");
  });
}
