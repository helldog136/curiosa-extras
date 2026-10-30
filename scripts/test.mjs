// Lance les tests des modules avec le chargeur de test de Curiosa (il fournit les alias « @/core/… » et le TypeScript du cœur).
//   CURIOSA_DIR=../Curiosa npm test
// Les aides de test (faux contexte de module, vérifications de manifeste) et la suite de conformité viennent du cœur, toujours à jour (dossier testsupport/ du cœur) :
// les aides sont recopiées avant chaque lancement pour les tests qui les importent depuis ./helpers.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const core = path.resolve(process.env.CURIOSA_DIR ?? path.join(here, "..", "Curiosa"));
if (!fs.existsSync(path.join(core, "tests/helpers/register.mjs")) || !fs.existsSync(path.join(core, "testsupport/index.mjs"))) {
  console.error(`Curiosa (avec son dossier testsupport/) introuvable dans « ${core} ». Clonez-le à côté de ce dépôt, ou indiquez son dossier : CURIOSA_DIR=/chemin/vers/Curiosa npm test`);
  process.exit(2);
}
// Passerelles du cœur (fakeCtx.mjs, builtinChecks.mjs) : elles retrouvent testsupport/ par le dossier courant, qui est celui du cœur.
for (const f of ["fakeCtx.mjs", "builtinChecks.mjs"]) fs.copyFileSync(path.join(core, "tests/helpers", f), path.join(here, "tests/helpers", f));
const args = process.argv.slice(2); // fichiers de test à lancer (par défaut : tous) : node scripts/test.mjs tests/x.test.mjs
const files = args.length ? args.map((f) => path.resolve(f)) : fs.readdirSync(path.join(here, "tests")).filter((f) => f.endsWith(".test.mjs")).map((f) => path.join(here, "tests", f));
// TMPDIR PROPRE À CETTE EXÉCUTION : un dossier racine unique, supprimé à la fin (même en cas d'échec), hérité par tous les processus de test.
// Garde-fou : ce que les tests y laissent est listé en clair. KEEP_TEST_TMP=1 : on garde tout (et on dit où) pour déboguer.
const keep = process.env.KEEP_TEST_TMP === "1";
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-extras-tests-"));
const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", path.join(core, "tests/helpers/register.mjs"), "--test", ...files], { cwd: core, stdio: "inherit", env: { ...process.env, TMPDIR: runRoot, TMP: runRoot, TEMP: runRoot, CURIOSA_DIR: core, CURIOSA_EXTRAS_DIR: here } } // CURIOSA_DIR : le kit de conformité ; CURIOSA_EXTRAS_DIR : les modules lus sont ceux de CE dépôt
);
let code = r.status ?? 1;
const leftovers = fs.readdirSync(runRoot).filter((n) => n !== "node-compile-cache"); // cache de Node lui-même, pas un dossier de test
if (leftovers.length) {
  const byKind = new Map();
  for (const name of leftovers) { const kind = name.replace(/[A-Za-z0-9]{6}$/, "*"); byKind.set(kind, (byKind.get(kind) ?? 0) + 1); }
  // Un cœur publié avant l'aide tmp (testsupport/tmp.mjs) laisse lui-même des dossiers (ses aides de test) : on avertit sans faire échouer.
  const coreIsClean = fs.existsSync(path.join(core, "testsupport/tmp.mjs"));
  console.error(`\n${coreIsClean ? "✖" : "⚠"} Garde-fou TMPDIR : ${leftovers.length} dossier(s)/fichier(s) laissé(s) par les tests dans ${runRoot}`);
  for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) console.error(`    ${String(n).padStart(5)} × ${kind}`);
  console.error("  → créez vos dossiers temporaires avec makeTempDir() (tests/helpers/tmp.mjs), jamais avec fs.mkdtempSync(os.tmpdir()…) ; voir README.md, section Tests.");
  if (!coreIsClean) console.error("  (le cœur testé est antérieur à l'aide tmp : ses propres aides de test peuvent être en cause ; avertissement seulement)");
  else if (code === 0) code = 1;
}
if (keep) console.error(`KEEP_TEST_TMP=1 : ${runRoot} conservé (à supprimer à la main quand vous avez fini).`);
else fs.rmSync(runRoot, { recursive: true, force: true });
process.exit(code);
