// Sondages : ce qui va au journal du cœur (Historique). Le cœur note déjà la page d'administration et l'assistant ; la télécommande et les décisions automatiques, non.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { pollsStore } from "./helpers/pollsStore.mjs";
import { pollsMod, pollsDef, pollsFr, pollsEn, tok } from "./helpers/audienceWorld.mjs";
import { parseManifest } from "@/core/modules/manifest";

const manifest = JSON.parse(fs.readFileSync(new URL("../modules/polls/module.json", import.meta.url), "utf8"));
const T0 = Math.floor(Date.now() / 60_000) * 60_000;
const MIN = 60_000;
let n = 0;
const mk = (extra = {}) => {
  const c = fakeCtx({ moduleId: "polls", key: `pj${++n}`, name: "Sondages", basePath: "polls", locale: "fr", messages: pollsFr, settings: {}, logEvents: manifest.logEvents, ...extra });
  c.api.store = pollsStore(); c.can = () => true;
  return c;
};
const press = (c, action, values = {}) => pollsDef.services["audience.remote"].press(c, { action, values });
const log = (c) => c.dumpLog();

test("manifeste : événements valides, minCore inchangé, deux langues", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.minCore, "0.11.0");
  assert.deepEqual(Object.keys(pollsFr).sort(), Object.keys(pollsEn).sort());
  assert.equal(manifest.logEvents.find((e) => e.key === "round.decided").frequent, true);
});

test("la page d'administration et l'assistant n'ajoutent rien (le cœur les note déjà)", async () => {
  const c = mk();
  assert.deepEqual(await pollsMod.startSeries(c, T0), { ok: true });
  assert.ok((await pollsMod.stopSeries(c, T0 + 1000)).ok);
  assert.deepEqual(log(c), []);
});

test("télécommande : lancer, arrêter, sondage rapide sont notés une fois, sans texte", async () => {
  const c = mk();
  assert.equal((await press(c, "start")).ok, true);
  assert.equal((await press(c, "start")).ok, false, "déjà lancé : rien à noter");
  assert.equal((await press(c, "quick", { a: "Pizza", b: "Pâtes" })).ok, true);
  assert.equal((await press(c, "stop")).ok, true);
  const l = log(c);
  assert.deepEqual(l.map((x) => x.action), ["round.started", "poll.quick", "round.stopped"]);
  assert.doesNotMatch(JSON.stringify(l), /Pizza|Pâtes/);
});

test("décision d'une manche : numéro, vainqueur et nombre de votes, jamais les codes des votants", async () => {
  const c = mk();
  await pollsMod.startSeries(c, T0);
  const cur = (await c.api.store.list("polls")).map((r) => ({ id: r.id, ...r.data })).find((p) => p.round);
  for (let i = 1; i <= 3; i++) await pollsMod.castVote(c, { slug: cur.slug, token: tok(i), ids: ["c2"], now: T0 + i * 1000 });
  await pollsMod.advance(c, T0 + 10 * MIN + 5000);
  const l = log(c);
  assert.equal(l.length, 1);
  assert.equal(l[0].action, "round.decided");
  assert.deepEqual(l[0].data, { n: 1, winner: pollsFr.roundChoice2, voters: 3 });
  assert.doesNotMatch(JSON.stringify(l), /tok0/);
});

test("sans journal du cœur (cœur plus ancien) les manches marchent comme avant", async () => {
  const c = mk();
  delete c.api.log;
  assert.equal((await press(c, "start")).ok, true);
  await pollsMod.advance(c, T0 + 11 * MIN);
});
