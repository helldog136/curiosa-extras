// The support floor of the modules (docs/MIGRATIONS.md): every module that declares a `dataFloor` above 1 is in the table of that page, with a bridge tag
// that exists in the git history, and its floor and data version are the ones written there.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { readManifests } from "../scripts/rules.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const doc = fs.readFileSync(path.join(root, "docs/MIGRATIONS.md"), "utf8");
const manifests = readManifests(root);
const floors = Object.entries(manifests).filter(([, m]) => (m.dataFloor ?? 1) > 1);

/** The rows of the "Floors in force" table: module, data version, floor, since, bridge tag. */
function table() {
  const section = doc.slice(doc.indexOf("## Floors in force"));
  return section.split("\n").filter((l) => /^\| [a-z0-9-]+ \|/.test(l) && !l.startsWith("| Module")).map((l) => {
    const c = l.split("|").map((x) => x.trim());
    return { id: c[1], dataVersion: Number(c[2]), floor: Number(c[3]), bridge: /`(v\d+\.\d+\.\d+)`/.exec(c[5])?.[1] ?? "" };
  });
}

const tags = (() => { try { return execSync("git tag", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean); } catch { return []; } })();

test("every module with a data floor above 1 is in the table of docs/MIGRATIONS.md with the same numbers, and the table lists nothing else", () => {
  const rows = table();
  assert.deepEqual(rows.map((r) => r.id).sort(), floors.map(([id]) => id).sort());
  for (const [id, m] of floors) {
    const row = rows.find((r) => r.id === id);
    assert.deepEqual([row.dataVersion, row.floor], [m.dataVersion, m.dataFloor], id);
    assert.match(row.bridge, /^v\d+\.\d+\.\d+$/, `${id} : a bridge tag is written`);
  }
});

test("a floor never exceeds the data version, and the module keeps one migration entry for it (the kit rule data.version)", async () => {
  for (const [id, m] of floors) {
    assert.ok(m.dataFloor <= (m.dataVersion ?? 1), id);
    const def = (await import(path.join(root, "modules", id, m.main ?? "index.mjs"))).default;
    assert.equal(typeof def.migrations?.[m.dataVersion], "function", `${id} : migration ${m.dataVersion}`);
  }
});

test("the bridge tag of each floor exists, and its version of the module still has the conversion that the floor leaves out",
  { skip: tags.length ? false : "no git tags in this clone (the CI fetches them)" }, () => {
    for (const row of table()) {
      assert.ok(tags.includes(row.bridge), `${row.id} : the tag ${row.bridge} exists`);
      const manifest = JSON.parse(execSync(`git show ${row.bridge}:modules/${row.id}/module.json`, { cwd: root, encoding: "utf8" }));
      assert.ok((manifest.dataVersion ?? 1) >= row.floor, `${row.id} : the bridge writes data version ${manifest.dataVersion}`);
      assert.equal(manifest.dataFloor, undefined, `${row.id} : the bridge has no floor, it still converts`);
      const files = execSync(`git ls-tree -r --name-only ${row.bridge} modules/${row.id}`, { cwd: root, encoding: "utf8" }).split("\n");
      assert.ok(files.some((f) => /\/migrate\.mjs$/.test(f)), `${row.id} : the bridge still carries migrate.mjs`);
    }
  });
