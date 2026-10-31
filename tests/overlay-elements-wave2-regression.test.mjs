// Non-régression de Suggestions de jeux et du Mur des remerciements à l'arrivée de leurs éléments d'overlay (cœur 0.5.0) : pages publiques, administration, outils MCP, vote, suggestion, réglages,
// tâches et manifeste (hors version, minCore, clé overlayElements et droit « routes ») identiques, OCTET POUR OCTET, à ceux du dépôt 1.26.0 (commit 363a6e5).
// Les fichiers tests/golden/game-suggestions-1.5.1.json et thanks-wall-1.0.2.json ont été produits avec 363a6e5, avant toute modification des modules.
import test, { after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gamesSnapshot, thanksSnapshot, NOW, fingerprint } from "./helpers/overlayNonRegWave2.mjs";
import { reset, restore } from "./helpers/thanks-wall-world.mjs";

mock.timers.enable({ apis: ["Date"], now: NOW });
after(() => { mock.timers.reset(); restore(); });
const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, "..");
const golden = (f) => JSON.parse(fs.readFileSync(path.join(here, "golden", f), "utf8"));

test("Suggestions de jeux : page publique (tous les statuts), administration, MCP, vote, suggestion, tâches et manifeste identiques à la 1.5.1", async () => {
  const before = golden("game-suggestions-1.5.1.json"), now = await gamesSnapshot(ROOT);
  assert.deepEqual(now.manifest, before.manifest, "le manifeste n'a changé que par version, minCore et overlayElements");
  assert.deepEqual(now.top, before.top); assert.deepEqual(now.routes, before.routes, "aucune route ajoutée à part celle de l'élément"); assert.deepEqual(now.tasks, before.tasks);
  for (const k of Object.keys(before.pages)) assert.deepEqual(now.pages[k], before.pages[k], `page « ${k} »`);
  assert.deepEqual(now.pageEmpty, before.pageEmpty);
  for (const k of ["admin", "adminPage2", "mcpList", "mcpListPlanned", "voteOk", "voteRefused", "suggest"]) assert.deepEqual(now[k], before[k], k);
  assert.equal(fingerprint(now.pages), fingerprint(before.pages), "empreinte des pages publiques");
  assert.ok(Object.keys(before.pages).length >= 9 && JSON.stringify(before.pages.all).includes("Hollow Knight"), "les empreintes couvrent de vraies pages");
});

test("Mur des remerciements : page publique (mur, groupes, pages, mise à l'honneur, petits mots), administration, état MCP et mur sans Contacts identiques à la 1.0.2", async () => {
  reset();
  const before = golden("thanks-wall-1.0.2.json"), now = await thanksSnapshot(ROOT);
  assert.deepEqual(now.manifest, before.manifest, "le manifeste n'a changé que par version, minCore, overlayElements et le droit « routes »");
  assert.deepEqual(now.top, before.top); assert.deepEqual(now.routes, before.routes, "aucune page publique ajoutée : seule la route de l'élément est nouvelle");
  for (const k of Object.keys(before.pages)) assert.deepEqual(now.pages[k], before.pages[k], `page « ${k} »`);
  for (const k of ["admin", "mcpStatus", "mcpPeople", "noBook"]) assert.deepEqual(now[k], before[k], k);
  assert.equal(fingerprint(now.pages), fingerprint(before.pages), "empreinte des pages publiques");
  const wall = JSON.stringify(before.pages.wall);
  assert.ok(wall.includes("Toujours là, merci") && /À l(?:'|&#39;)honneur/.test(wall), "les empreintes couvrent le petit mot et la mise à l'honneur");
});
