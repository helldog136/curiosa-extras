// Lance les tests des modules avec le chargeur de test de Curiosa (il fournit les alias « @/core/… » et le TypeScript du cœur).
//   CURIOSA_DIR=../Curiosa npm test
// Les aides de test (faux contexte de module, vérifications de manifeste) viennent du cœur, toujours à jour : elles sont recopiées avant chaque lancement.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const here = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const core = path.resolve(process.env.CURIOSA_DIR ?? path.join(here, "..", "Curiosa"));
if (!fs.existsSync(path.join(core, "tests/helpers/register.mjs"))) {
  console.error(`Curiosa introuvable dans « ${core} ». Clonez-le à côté de ce dépôt, ou indiquez son dossier : CURIOSA_DIR=/chemin/vers/Curiosa npm test`);
  process.exit(2);
}
for (const f of ["fakeCtx.mjs", "builtinChecks.mjs"]) fs.copyFileSync(path.join(core, "tests/helpers", f), path.join(here, "tests/helpers", f));
const files = fs.readdirSync(path.join(here, "tests")).filter((f) => f.endsWith(".test.mjs")).map((f) => path.join(here, "tests", f));
const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", path.join(core, "tests/helpers/register.mjs"), "--test", ...files], { cwd: core, stdio: "inherit", env: { ...process.env, CURIOSA_EXTRAS_DIR: here } } // Curiosa lit les modules livrés dans CURIOSA_EXTRAS_DIR (ici : ce dépôt, comme son instantané `extras/`)
);
process.exit(r.status ?? 1);
