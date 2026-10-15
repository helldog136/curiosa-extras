// Un réglage dont le texte dit « facultatif » doit le déclarer (`optional: true`) : sinon le site l'affiche « à remplir » et met l'extension « À configurer ».
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "modules");
const SAYS_OPTIONAL = /facultatif|optionnel|\boptional\b/i;

for (const id of fs.readdirSync(root)) {
  const file = path.join(root, id, "module.json");
  if (!fs.existsSync(file)) continue;
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  test(`${id} : les réglages « facultatifs » le déclarent`, () => {
    const bad = (manifest.settings ?? [])
      .filter((s) => !s.optional && SAYS_OPTIONAL.test(JSON.stringify([s.label, s.help])))
      .map((s) => s.key);
    assert.deepEqual(bad, [], `Ajoutez "optional": true (et minCore ≥ 0.1.22) à : ${bad.join(", ")}`);
  });
}
