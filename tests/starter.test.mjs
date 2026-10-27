// Le dossier `starter/` : le module de départ qu'un auteur externe copie dans son propre dépôt (voir docs/PUBLIER-SON-MODULE.md du cœur).
// Il est volontairement HORS de modules/ et examples/ : tout ce qui s'y trouve entre dans le Catalogue (catalogue/index.json), pas lui.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const core = path.resolve(process.env.CURIOSA_DIR ?? process.cwd());
const root = path.resolve(process.env.CURIOSA_EXTRAS_DIR ?? path.join(path.dirname(new URL(import.meta.url).pathname), ".."));
const dir = path.join(root, "starter");
const { registerConformanceTests } = await import(pathToFileURL(path.join(core, "testsupport/index.mjs")).href);

// La suite de conformité du cœur, comme pour chaque module du dépôt.
registerConformanceTests(dir, { test });

test("starter : tout ce qu'un auteur doit pouvoir copier est là", () => {
  for (const f of ["module.json", "index.mjs", "locales/en.json", "locales/fr.json", "README.md", "LICENSE", "package.json", ".gitignore", "test/module.test.mjs", ".github/workflows/ci.yml"]) assert.ok(fs.existsSync(path.join(dir, f)), f);
});

test("starter : n'entre pas dans le Catalogue (ni index, ni dossier modules/ ou examples/)", () => {
  const id = JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8")).id;
  const index = JSON.parse(fs.readFileSync(path.join(root, "catalogue/index.json"), "utf8"));
  assert.ok(!index.modules.some((m) => m.id === id || m.subdir?.startsWith("starter")), "le module de départ ne doit pas être proposé à l'installation");
  for (const g of ["modules", "examples"]) assert.ok(!fs.existsSync(path.join(root, g, "starter")), g);
});

test("starter : ses propres tests (ceux que l'auteur lancera) réussissent contre ce cœur", () => {
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--test", path.join(dir, "test/module.test.mjs")], { cwd: dir, env: { ...process.env, CURIOSA_DIR: core }, encoding: "utf8" });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-1500));
});

test("starter : le workflow d'exemple teste contre la dernière étiquette publiée du cœur", () => {
  const wf = fs.readFileSync(path.join(dir, ".github/workflows/ci.yml"), "utf8");
  assert.match(wf, /git ls-remote --tags --refs/);
  assert.match(wf, /testsupport\/check\.mjs/);
  assert.match(wf, /CURIOSA_DIR/);
});
