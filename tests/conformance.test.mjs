// Conformité de chaque module de ce dépôt : la suite du cœur (testsupport/), lancée sur modules/* et examples/*.
// Remplace, pour ces vérifications, les tests qui les répétaient un à un (voir README.md de ce dossier).
//
// Le cœur est trouvé par CURIOSA_DIR (positionné par scripts/test.mjs) ; les tests tournent dans son dossier, qui sert de repli.
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const core = path.resolve(process.env.CURIOSA_DIR ?? process.cwd());
const root = path.resolve(process.env.CURIOSA_EXTRAS_DIR ?? path.join(path.dirname(new URL(import.meta.url).pathname), ".."));
const { registerConformanceTests } = await import(pathToFileURL(path.join(core, "testsupport/index.mjs")).href);

const moduleDirs = ["modules", "examples"].flatMap((group) => {
  const base = path.join(root, group);
  return fs.existsSync(base) ? fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(base, e.name, "module.json"))).map((e) => path.join(base, e.name)) : [];
});

// Défauts CONNUS : une entrée = « module → exigence → raison ». À corriger puis à retirer (le test échoue quand l'exception n'a plus lieu d'être).
const KNOWN = {};

for (const dir of moduleDirs) registerConformanceTests(dir, { test, siblings: moduleDirs, known: KNOWN[path.basename(dir)] });
