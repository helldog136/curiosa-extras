// Règles de kit du dépôt : `requires[].optional` transporté par l'index du catalogue, et `dataVersion` qui ne baisse jamais (scripts/rules.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { dataVersionProblems, manifestsAt, optionalNeedsProblems, previousTag, readManifests, serviceList } from "../scripts/rules.mjs";
import { makeTempDir } from "./helpers/tmp.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

test("index : `optional: true` d'un besoin est recopié, et seulement la valeur true ; les offres et les besoins durs gardent leur forme", () => {
  assert.deepEqual(serviceList([{ service: "twitch.api", min: 3, optional: true }], "min"), [{ service: "twitch.api", min: 3, optional: true }]);
  assert.deepEqual(serviceList([{ service: "twitch.api", optional: true }], "min"), [{ service: "twitch.api", optional: true }]);
  for (const bad of [false, "true", 1, null, "yes", {}]) assert.deepEqual(serviceList([{ service: "a.b", min: 2, optional: bad }], "min"), [{ service: "a.b", min: 2 }], JSON.stringify(bad));
  assert.deepEqual(serviceList([{ service: "a.b" }, "c.d"], "min"), ["a.b", "c.d"], "un besoin dur sans version reste une simple chaîne");
  assert.deepEqual(serviceList([{ service: "a.b", version: 2, each: true, optional: true }], "version"), [{ service: "a.b", version: 2, each: true }], "pas de facultatif pour une offre");
});

test("règle needs.optional : facultatif dans le manifeste ⇔ facultatif dans l'index ; valeur autre que true refusée", () => {
  const manifests = [{ id: "m", requires: [{ service: "a.b", min: 3, optional: true }, { service: "c.d" }] }];
  const good = { modules: [{ id: "m", needs: [{ service: "a.b", min: 3, optional: true }, "c.d"] }] };
  assert.deepEqual(optionalNeedsProblems(manifests, good), []);
  const lost = { modules: [{ id: "m", needs: [{ service: "a.b", min: 3 }, "c.d"] }] };
  assert.match(optionalNeedsProblems(manifests, lost).join("\n"), /facultatif dans le manifeste mais dur/);
  const invented = { modules: [{ id: "m", needs: [{ service: "a.b", min: 3, optional: true }, { service: "c.d", optional: true }] }] };
  assert.match(optionalNeedsProblems(manifests, invented).join("\n"), /dur dans le manifeste mais facultatif/);
  assert.match(optionalNeedsProblems([{ id: "m", requires: [{ service: "a.b", optional: false }] }], { modules: [{ id: "m", needs: ["a.b"] }] }).join("\n"), /seule la valeur true/);
  assert.match(optionalNeedsProblems([{ id: "m", requires: [{ service: "a.b", optional: "yes" }] }], { modules: [{ id: "m", needs: ["a.b"] }] }).join("\n"), /seule la valeur true/);
  assert.match(optionalNeedsProblems(manifests, { modules: [] }).join("\n"), /absent de catalogue/);
  assert.match(optionalNeedsProblems(manifests, { modules: [{ id: "m", needs: [] }] }).join("\n"), /manque dans l'index/);
});

test("catalogue/index.json de ce dépôt respecte la règle needs.optional", () => {
  const manifests = Object.entries(readManifests(root)).map(([id, m]) => ({ id, requires: m.requires }));
  assert.ok(manifests.length > 10);
  assert.deepEqual(optionalNeedsProblems(manifests, JSON.parse(fs.readFileSync(path.join(root, "catalogue/index.json"), "utf8"))), []);
});

test("build-index --check échoue quand un besoin facultatif manque dans l'index, et réussit une fois l'index régénéré", () => {
  const tmp = makeTempDir("idx-");
  try {
    fs.cpSync(path.join(root, "scripts"), path.join(tmp, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "catalogue")); fs.mkdirSync(path.join(tmp, "examples"));
    fs.copyFileSync(path.join(root, "package.json"), path.join(tmp, "package.json"));
    fs.mkdirSync(path.join(tmp, "modules/zed"), { recursive: true });
    const manifest = { id: "zed", name: "Zed", description: "d", version: "1.0.0", apiVersion: 2, author: "x", icon: "z", requires: [{ service: "twitch.api", min: 3, optional: true }, { service: "x.y" }] };
    fs.writeFileSync(path.join(tmp, "modules/zed/module.json"), JSON.stringify(manifest));
    const run = (...a) => spawnSync(process.execPath, [path.join(tmp, "scripts/build-index.mjs"), ...a], { encoding: "utf8" });
    assert.equal(run().status, 0);
    const index = JSON.parse(fs.readFileSync(path.join(tmp, "catalogue/index.json"), "utf8"));
    assert.deepEqual(index.modules[0].needs, [{ service: "twitch.api", min: 3, optional: true }, "x.y"]);
    assert.equal(run("--check").status, 0);
    delete index.modules[0].needs[0].optional;   // un index écrit à la main, ou par un ancien script
    fs.writeFileSync(path.join(tmp, "catalogue/index.json"), JSON.stringify(index, null, 2) + "\n");
    assert.equal(run("--check").status, 1);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("règle data.versionMonotonic : jamais en dessous de la version précédente (absente = 1) ; module nouveau libre ; dataFloor ≤ dataVersion", () => {
  const prev = { a: { dataVersion: 3 }, b: {}, c: { dataVersion: 2 } };
  assert.deepEqual(dataVersionProblems({ a: { dataVersion: 3 }, b: { dataVersion: 2 }, c: { dataVersion: 5 }, d: { dataVersion: 1 } }, prev), []);
  assert.match(dataVersionProblems({ a: { dataVersion: 2 }, b: {}, c: { dataVersion: 2 } }, prev).join("\n"), /a : dataVersion 3 → 2/);
  assert.match(dataVersionProblems({ a: {}, b: {}, c: { dataVersion: 2 } }, prev).join("\n"), /a : dataVersion 3 → 1/, "retirer la clé = redescendre à 1");
  assert.deepEqual(dataVersionProblems({ a: { dataVersion: 3, dataFloor: 3 } }, prev), []);
  assert.match(dataVersionProblems({ a: { dataVersion: 3, dataFloor: 4 } }, prev).join("\n"), /dataFloor/);
  assert.match(dataVersionProblems({ a: { dataVersion: 3, dataFloor: 0 } }, prev).join("\n"), /dataFloor/);
});

test("dataVersion de ce dépôt face à l'étiquette précédente : aucune baisse", { skip: previousTag(root, JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version) ? false : "aucune étiquette précédente dans ce clone" }, () => {
  const tag = previousTag(root, JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version);
  const before = manifestsAt(root, tag);
  assert.ok(Object.keys(before).length > 10, `manifestes lus à ${tag}`);
  assert.deepEqual(dataVersionProblems(readManifests(root), before), []);
});

test("previousTag : la plus haute étiquette strictement inférieure, jamais celle de la version elle-même", () => {
  const tag = previousTag(root, "9.9.9");
  if (!tag) return;   // clone sans étiquettes
  assert.match(tag, /^v\d+\.\d+\.\d+$/);
  assert.equal(previousTag(root, tag.slice(1)) === tag, false);
});
