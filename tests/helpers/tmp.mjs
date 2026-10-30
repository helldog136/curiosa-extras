// AIDE « tmp » UNIQUE des tests de ce dépôt : tout dossier temporaire passe par makeTempDir(). (Même contrat que testsupport/tmp.mjs du cœur,
// copié ici pour que ces tests ne dépendent pas d'une version précise du cœur.)
//
//   import { makeTempDir } from "./helpers/tmp.mjs";
//   const dir = makeTempDir("mon-module-");          // créé sous os.tmpdir(), enregistré
//   test("…", (t) => { const d = makeTempDir("x-", { t }); … });   // supprimé dès la fin de CE test
//
// Chaque dossier est supprimé (1) en fin de test si `t` est donné, (2) par cleanupAll() (à appeler dans un `after`),
// (3) en filet de sécurité à la sortie du processus (process.on("exit"), synchrone). KEEP_TEST_TMP=1 : rien n'est supprimé (débogage).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const made = new Set();
let hooked = false;

/** Vrai quand KEEP_TEST_TMP=1 : on garde les dossiers pour les inspecter. */
export const keepTestTmp = () => process.env.KEEP_TEST_TMP === "1";

function remove(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* déjà parti ou verrouillé : le dossier racine du lancement (scripts/test.mjs) fait le ménage */ }
}

/** Supprime un dossier enregistré (et l'oublie). */
export function removeTempDir(dir) {
  made.delete(dir);
  if (!keepTestTmp()) remove(dir);
}

/** Supprime tous les dossiers enregistrés par ce processus. */
export function cleanupAll() {
  for (const dir of [...made]) removeTempDir(dir);
}

/**
 * Crée un dossier temporaire unique `<prefix>XXXXXX` et l'enregistre.
 * @param {string} prefix préfixe du nom (ex. « curiosa-repo- »)
 * @param {object} [opts]
 * @param {import("node:test").TestContext} [opts.t] contexte du test : le dossier est supprimé à la fin de ce test
 * @param {string} [opts.in] dossier parent (par défaut os.tmpdir(), qui suit TMPDIR)
 */
export function makeTempDir(prefix, opts = {}) {
  if (!hooked) { hooked = true; process.on("exit", cleanupAll); }
  const dir = fs.mkdtempSync(path.join(opts.in ?? os.tmpdir(), prefix));
  made.add(dir);
  opts.t?.after?.(() => removeTempDir(dir));
  return dir;
}

/** Dossiers actuellement enregistrés (pour les tests de l'aide elle-même). */
export const registeredTempDirs = () => [...made];
