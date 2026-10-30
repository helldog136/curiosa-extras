// Hygiène des dossiers temporaires : l'aide makeTempDir, son filet de sécurité à la sortie, le garde-fou de `npm test` (scripts/test.mjs),
// et l'interdiction de créer un dossier temporaire sans l'enregistrer (c'est ce qui laissait des dizaines de milliers de dossiers dans /tmp).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeTempDir, cleanupAll, removeTempDir, registeredTempDirs } from "./helpers/tmp.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const TMP_MODULE = path.join(repo, "tests/helpers/tmp.mjs");
// NODE_TEST_CONTEXT : sans le retirer, un « node --test » lancé d'ici croirait être déjà dans un test et ne lancerait rien.
const baseEnv = { ...process.env };
delete baseEnv.NODE_TEST_CONTEXT;
const node = (args, env = {}) => spawnSync(process.execPath, args, { cwd: repo, encoding: "utf8", env: { ...baseEnv, KEEP_TEST_TMP: "", ...env } });
// Le cache de compilation de Node (node-compile-cache) n'est pas un dossier de test.
const entries = (dir) => fs.readdirSync(dir).filter((n) => n !== "node-compile-cache");

test("makeTempDir : crée un dossier unique sous le TMPDIR, cleanupAll / removeTempDir le suppriment", () => {
  const a = makeTempDir("hyg-a-");
  const b = makeTempDir("hyg-b-");
  assert.ok(path.basename(a).startsWith("hyg-a-") && fs.statSync(a).isDirectory());
  assert.notEqual(a, b);
  removeTempDir(a);
  assert.ok(!fs.existsSync(a) && fs.existsSync(b));
  cleanupAll();
  assert.ok(!fs.existsSync(b) && registeredTempDirs().length === 0);
});

test("makeTempDir : avec le contexte du test, le dossier disparaît à la fin de CE test", async (t) => {
  let dir;
  await t.test("sous-test", (st) => { dir = makeTempDir("hyg-t-", { t: st }); assert.ok(fs.existsSync(dir)); });
  assert.ok(!fs.existsSync(dir), "supprimé dès la fin du sous-test");
});

test("filet de sécurité : un processus qui oublie de nettoyer ne laisse rien à sa sortie ; KEEP_TEST_TMP=1 garde pour déboguer", () => {
  const scratch = makeTempDir("hyg-scratch-");
  const script = `import(${JSON.stringify(TMP_MODULE)}).then((m) => { console.log(m.makeTempDir("hyg-leak-")); });`;
  const r = node(["-e", script], { TMPDIR: scratch });
  assert.ok(r.stdout.trim().startsWith(scratch), r.stderr);
  assert.deepEqual(entries(scratch), [], "supprimé par process.on('exit')");
  node(["-e", script], { TMPDIR: scratch, KEEP_TEST_TMP: "1" });
  assert.equal(entries(scratch).length, 1, "KEEP_TEST_TMP=1 : conservé");
});

// scripts/test.mjs a besoin du cœur (CURIOSA_DIR) : sans lui ces deux tests sont ignorés (le lanceur sort avec le code 2).
const core = path.resolve(process.env.CURIOSA_DIR ?? path.join(repo, "..", "Curiosa"));
const hasCore = fs.existsSync(path.join(core, "tests/helpers/register.mjs")) && fs.existsSync(path.join(core, "testsupport/index.mjs"));

// Un faux fichier de test passé à scripts/test.mjs : avec ou sans fuite. Le « cœur testé » est un faux cœur qui possède testsupport/tmp.mjs (garde-fou strict).
function runWrapper(body, env = {}) {
  const scratch = makeTempDir("hyg-wrap-");
  const file = path.join(scratch, "fake.test.mjs");
  fs.writeFileSync(file, `import test from "node:test";\nimport fs from "node:fs";\nimport os from "node:os";\nimport path from "node:path";\ntest("faux", () => { ${body} });\n`);
  const r = node(["scripts/test.mjs", file], { TMPDIR: scratch, ...env });
  return { r, remaining: () => entries(scratch).filter((n) => n !== "fake.test.mjs") };
}

test("npm test : un dossier laissé par un test est nommé en clair et (cœur récent) fait échouer l'exécution ; la racine est supprimée", { skip: !hasCore }, () => {
  const { r, remaining } = runWrapper(`fs.mkdtempSync(path.join(os.tmpdir(), "fuite-"));`);
  assert.match(r.stdout, /# pass 1\b/, "le faux test a bien tourné");
  assert.match(r.stderr, /Garde-fou TMPDIR : 1 dossier/);
  assert.match(r.stderr, /1 × fuite-\*/);
  if (fs.existsSync(path.join(core, "testsupport/tmp.mjs"))) assert.equal(r.status, 1, r.stdout + r.stderr);
  else assert.equal(r.status, 0, "cœur antérieur à l'aide tmp : avertissement seulement");
  assert.deepEqual(remaining(), [], "la racine curiosa-extras-tests-* est supprimée malgré la fuite");
});

test("npm test : aucun résidu → succès ; KEEP_TEST_TMP=1 conserve la racine de l'exécution et dit où", { skip: !hasCore }, () => {
  const ok = runWrapper(`const d = fs.mkdtempSync(path.join(os.tmpdir(), "propre-")); fs.rmSync(d, { recursive: true });`);
  assert.equal(ok.r.status, 0, ok.r.stdout + ok.r.stderr);
  assert.match(ok.r.stdout, /# pass 1\b/, "le faux test a bien tourné");
  assert.deepEqual(ok.remaining(), []);
  const kept = runWrapper(`fs.mkdtempSync(path.join(os.tmpdir(), "garde-"));`, { KEEP_TEST_TMP: "1" });
  assert.match(kept.r.stderr, /KEEP_TEST_TMP=1 : .*curiosa-extras-tests-\w+ conservé/);
  assert.equal(kept.remaining().length, 1);
});

test("aucun test ne crée de dossier temporaire sans passer par makeTempDir (tests/helpers/tmp.mjs)", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); continue; }
      if (!/\.(mjs|js)$/.test(e.name) || p === import.meta.filename || p === TMP_MODULE) continue;
      fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => { if (/mkdtemp(Sync)?\s*\(/.test(line) && !line.includes("// tmp-ok")) offenders.push(`${path.relative(repo, p)}:${i + 1}`); });
    }
  };
  walk(path.join(repo, "tests"));
  assert.deepEqual(offenders, [], "utilisez makeTempDir() (tests/helpers/tmp.mjs) ; exception voulue : commentaire « // tmp-ok » sur la ligne");
});
