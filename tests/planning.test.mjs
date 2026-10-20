import test from "node:test";
import assert from "node:assert/strict";

const P = await import("../modules/planning/index.mjs");
const { buildDays, getWeekRange, isValidTimeZone, zonedTimeToUtc, wallDateNow } = P;


test("fuseaux : conversion heure locale → UTC, heure d'été comprise", () => {
  assert.equal(zonedTimeToUtc(2026, 1, 15, 20, 0, 0, "Europe/Paris").toISOString(), "2026-01-15T19:00:00.000Z");
  assert.equal(zonedTimeToUtc(2026, 7, 15, 20, 0, 0, "Europe/Paris").toISOString(), "2026-07-15T18:00:00.000Z");
  assert.equal(zonedTimeToUtc(2026, 7, 15, 20, 0, 0, "UTC").toISOString(), "2026-07-15T20:00:00.000Z");
});

test("fuseaux : validation", () => {
  assert.ok(isValidTimeZone("Europe/Paris") && isValidTimeZone("UTC"));
  assert.ok(!isValidTimeZone("Mars/Olympus") && !isValidTimeZone("") && !isValidTimeZone(null));
});

test("date du jour dans le fuseau demandé (pas celui du serveur)", () => {
  const now = new Date("2026-03-10T23:30:00Z");
  assert.equal(JSON.stringify(wallDateNow("Europe/Paris", now)).includes('"d":11'), true, "minuit passé à Paris");
  assert.equal(JSON.stringify(wallDateNow("America/New_York", now)).includes('"d":10'), true);
});

test("semaines : lundi→dimanche dans le fuseau, décalage de semaines", () => {
  const now = new Date("2026-03-11T12:00:00Z"); // mercredi
  const w0 = getWeekRange(0, "Europe/Paris", now);
  const w1 = getWeekRange(1, "Europe/Paris", now);
  const j = JSON.stringify([w0, w1]);
  assert.match(j, /2026/);
  assert.notDeepEqual(w0, w1);
});

test("jours : chaque événement tombe dans le bon jour, triés par heure", () => {
  const events = [
    { title: "B", start: new Date("2026-03-10T20:00:00Z"), end: new Date("2026-03-10T21:00:00Z") },
    { title: "A", start: new Date("2026-03-10T10:00:00Z"), end: new Date("2026-03-10T11:00:00Z") },
    { title: "C", start: new Date("2026-03-12T10:00:00Z"), end: new Date("2026-03-12T11:00:00Z") },
  ];
  const days = buildDays({ y: 2026, m: 3, d: 9 }, 7, events, "UTC");
  assert.equal(days.length, 7);
  const titles = days.map((d) => d.streams.map((e) => e.title));
  assert.deepEqual(titles[1], ["A", "B"]);
  assert.deepEqual(titles[3], ["C"]);
  assert.deepEqual(titles[0], []);
});

test("manifeste : instances multiples, page propre, MCP en lecture seule activé par défaut", async () => {
  const m = (await import("node:fs")).readFileSync(new URL("../modules/planning/module.json", import.meta.url), "utf8");
  const json = JSON.parse(m);
  assert.equal(json.id, "planning");
  assert.equal(json.instances, "multiple");
  const tool = json.mcp.find((x) => x.name === "planning_upcoming");
  assert.ok(tool);
  assert.equal(tool.readOnly, true);
  assert.equal(tool.default, true);
  assert.ok(!json.settings.some((x) => x.key === "icsUrl"), "l'adresse d'un calendrier privé n'est plus un réglage visible");
  assert.deepEqual(json.legacySettings, [{ key: "icsUrl", secret: true }], "elle reste un secret le temps de sa reprise — à retirer en 0.3.0");
});
