// Protection générale contre les mises à jour à chaud qui cassent : ce test s'applique à CHAQUE module du dépôt, sans qu'il faille y penser. Voir docs/HOT-UPDATE.md.
//   1. Analyse du code : aucun fichier chargé par le serveur n'importe un voisin avec un `import … from "./x.mjs"` statique, et tout import dynamique de voisin porte la version.
//   2. Rejeu de la mise à jour N-1 → N dans UN SEUL processus (comme un site qui tourne), avec un état existant : tous les fichiers sont rechargés, sans exception ni mélange.
// Les tests propres à un module (tests/live-status-update.test.mjs…) vérifient en plus ses comportements ; celui-ci ne les remplace pas, il garantit le minimum partout.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { publishedTags, previousRelease, extractRelease, serverGraph, staticImporters, replayUpdate } from "./helpers/hotUpdate.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const REPO = process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, "..");
const MODULES = path.join(REPO, "modules");
const CORE = path.resolve(process.env.CURIOSA_DIR ?? process.cwd());
const ids = fs.readdirSync(MODULES, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(MODULES, e.name, "module.json"))).map((e) => e.name).sort();

/**
 * Liste blanche des imports relatifs statiques TOLÉRÉS dans un fichier que le serveur charge. Clé « module/fichier » → raison (une vraie raison, pas « ça marche »).
 * (Un import statique n'est sans danger que si le voisin ne change jamais d'une version à l'autre, ce qu'on ne peut pas promettre : préférez `await import(…)` avec la version.)
 */
const ALLOWED_STATIC = {
  "maze-overlay/web/generate.js": "tracé du labyrinthe partagé avec le navigateur (même fichier servi à la page) : ses imports de types.js et random.js doivent rester des imports ESM relatifs pour que le navigateur les trouve. Le serveur l'importe avec la version (index.mjs) ; types.js (constantes) et random.js ne changent que rarement",
};

/**
 * Fichiers .mjs qui contiennent des imports statiques mais que le serveur ne charge PAS : ils sont envoyés tels quels au navigateur (où `import … from "./x.mjs"` est la bonne forme).
 * Clé « module/fichier.mjs » → raison. Tout autre fichier .mjs non atteint depuis le fichier principal et contenant un import statique fait échouer le test : soit il est chargé
 * d'une façon que l'analyse ne voit pas, soit il faut l'ajouter ici avec sa raison.
 */
const BROWSER_ONLY = {
  "faq/client.mjs": "texte recopié dans scripts/faq.js (script de confort envoyé au navigateur) ; le serveur ne l'importe pas",
  "stream-story/app.mjs": "envoyé au navigateur (liste LIB de page.mjs) ; le serveur ne l'importe pas",
  "stream-story/scenes.mjs": "envoyé au navigateur (liste LIB de page.mjs) ; le serveur ne l'importe pas",
  "stream-story/encode.mjs": "envoyé au navigateur (liste LIB de page.mjs) ; le serveur ne l'importe pas",
};

const info = Object.fromEntries(ids.map((id) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(MODULES, id, "module.json"), "utf8"));
  return [id, { manifest, graph: manifest.main ? serverGraph(path.join(MODULES, id), manifest.main) : { files: new Set(), statics: [], unversioned: [], missing: [] } }];
}));

// ── 1. Analyse du code ──────────────────────────────────────────────────────────────────────────────────────────────

test("l'analyse voit bien les imports (commentaires, chaînes et gabarits ne comptent pas ; les formes multi-lignes comptent)", async () => {
  const { relativeImports } = await import("./helpers/hotUpdate.mjs");
  const code = [
    '// import { a } from "./commentaire.mjs";',
    'const doc = `import { b } from "./gabarit.mjs"`;',
    'const s = "import { c } from \\"./chaine.mjs\\"";',
    'import fs from "node:fs";',
    'import {',
    '  one,', '  two,', '} from "./multi.mjs";',
    'export * from "./reexport.mjs";',
    'import "./effet.mjs";',
    'const v = new URL(import.meta.url).search;',
    'const ok = await import(`./bon.mjs${v}`);',
    'const ok2 = await import(new URL("./bon2.mjs" + q, import.meta.url).href);',
    'const mauvais = await import("./sans-version.mjs");',
    'const re = /import x from "\\.\\/regex.mjs"/;',
    'const tout = await import(`./layouts/${id}.mjs${v}`);',
  ].join("\n");
  const r = relativeImports(code);
  assert.deepEqual(r.statics.map((s) => s.spec), ["./multi.mjs", "./reexport.mjs", "./effet.mjs"]);
  assert.deepEqual(r.dynamics.map((d) => [d.specs[0], d.versioned]), [["./bon.mjs${}", true], ["./bon2.mjs", true], ["./sans-version.mjs", false], ["./layouts/${}.mjs${}", true]]);
});

test("les modules existent et ont un fichier principal", () => {
  assert.ok(ids.length >= 60, `modules trouvés : ${ids.length}`);
  const noCode = ids.filter((id) => !info[id].manifest.main); // types « contenu » : aucun code, rien à recharger
  for (const id of ids) if (info[id].manifest.main) assert.ok(info[id].graph.files.has(info[id].manifest.main), `${id} : fichier principal introuvable`);
  assert.ok(noCode.length < ids.length / 2, `modules sans code : ${noCode.join(", ")}`);
});

for (const id of ids) {
  test(`${id} : aucun import relatif statique dans les fichiers chargés par le serveur, imports dynamiques versionnés`, () => {
    const { graph } = info[id];
    const problems = [];
    for (const s of graph.statics) {
      const key = `${id}/${s.file}`;
      if (ALLOWED_STATIC[key]) continue;
      problems.push(`${s.file}:${s.line} : import statique « ${s.spec} » : après une mise à jour à chaud le processus garderait l'ANCIENNE version de ce fichier. Écrivez \`const v = new URL(import.meta.url).search;\` puis \`const X = await import(\`${s.spec}\${v}\`);\``);
    }
    for (const u of graph.unversioned) problems.push(`${u.file}:${u.line} : import dynamique « ${u.raw} » sans version : ajoutez la version du fichier principal (\`\${v}\` ou \`+ q\`)`);
    for (const m of graph.missing) problems.push(`${m.file} : le fichier « ${m.target} » importé n'existe pas`);
    // Les fichiers que le serveur ne charge pas (envoyés au navigateur) : seulement ceux qui sont déclarés comme tels.
    for (const f of staticImporters(path.join(MODULES, id))) {
      if (graph.files.has(f) || BROWSER_ONLY[`${id}/${f}`] || ALLOWED_STATIC[`${id}/${f}`]) continue;
      problems.push(`${f} : import statique dans un fichier que le serveur ne charge pas (d'après l'analyse). S'il est envoyé au navigateur, déclarez-le dans BROWSER_ONLY (tests/hot-update-all.test.mjs) avec la raison ; sinon importez-le avec la version`);
    }
    assert.deepEqual(problems, []);
  });
}

test("les listes blanches ne contiennent rien d'inutile", () => {
  for (const [key, why] of Object.entries(ALLOWED_STATIC)) {
    const [id, ...file] = key.split("/");
    assert.ok(why.length > 20, `${key} : raison trop courte`);
    assert.ok(info[id]?.graph.statics.some((s) => s.file === file.join("/")), `${key} : plus d'import statique à tolérer, retirez cette ligne`);
  }
  for (const [key, why] of Object.entries(BROWSER_ONLY)) {
    const [id, ...file] = key.split("/");
    const f = file.join("/");
    assert.ok(why.length > 20, `${key} : raison trop courte`);
    assert.ok(info[id], `${key} : module inconnu`);
    assert.ok(fs.existsSync(path.join(MODULES, key)), `${key} : fichier absent, retirez cette ligne`);
    assert.ok(!info[id].graph.files.has(f), `${key} : ce fichier est chargé par le serveur : il n'a rien à faire dans BROWSER_ONLY`);
    assert.ok(staticImporters(path.join(MODULES, id)).includes(f), `${key} : plus d'import statique, retirez cette ligne`);
  }
});

// ── 2. Rejeu de la mise à jour N-1 → N ──────────────────────────────────────────────────────────────────────────────

const history = publishedTags(REPO);
const needHistory = process.env.HOT_UPDATE_REQUIRE_HISTORY === "1";

test("historique git des versions publiées disponible (nécessaire pour rejouer N-1 → N)", (t) => {
  if (!history.tags.length) {
    if (needHistory) assert.fail(`historique git indisponible : ${history.reason}`);
    t.skip(`historique git indisponible : ${history.reason}. Le rejeu se fait alors de la version courante sur elle-même (sans version précédente).`);
    return;
  }
  assert.ok(history.tags.length > 0);
});

const multi = ids.filter((id) => info[id].graph.files.size > 1);
const cache = new Map();
const tmpRoot = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), "hot-update-all-"));
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const coreKit = async (name) => import(pathToFileURL(path.join(CORE, "testsupport", name)).href);

test("modules à plusieurs fichiers serveur couverts par le rejeu", () => {
  assert.ok(multi.length >= 25, `modules à plusieurs fichiers serveur : ${multi.length}`);
  console.log(`# rejeu N-1 → N : ${multi.length} modules à plusieurs fichiers serveur sur ${ids.length} (${ids.length - multi.length} n'ont qu'un fichier : rien à mélanger)`);
});

for (const id of multi) {
  test(`${id} : mise à jour N-1 → N à chaud dans le même processus (état existant, aucun mélange de versions)`, async (t) => {
    const core = await (await coreKit("core.mjs")).loadCore();
    const probes = await coreKit("probes.mjs");
    const current = path.join(MODULES, id);
    const version = info[id].manifest.version;
    const prev = history.tags.length ? previousRelease(REPO, id, version, history.tags, cache) : null;
    const work = fs.mkdtempSync(path.join(tmpRoot, `${id}-`));
    const oldDir = path.join(work, "precedente");
    let label;
    let extracted = false;
    if (prev) {
      try { extractRelease(REPO, prev.tag, id, oldDir); extracted = true; } catch (e) { t.diagnostic(`historique incomplet (${String(e.message).split("\n")[0].slice(0, 120)}) : rejeu sur la version courante`); }
    }
    if (extracted) label = `${prev.version} (${prev.tag}) → ${version}${prev.differs ? "" : " [même version : rejeu sur le même code]"}`;
    else { fs.rmSync(oldDir, { recursive: true, force: true }); fs.cpSync(current, oldDir, { recursive: true }); label = `${version} → ${version} [aucune version publiée avant : rejeu de la version courante sur elle-même]`; }
    t.diagnostic(label);
    // Fichiers dont un import statique est admis par la liste blanche : le rejeu ne les reproche pas non plus.
    const tolerated = new Set(info[id].graph.statics.filter((s) => ALLOWED_STATIC[`${id}/${s.file}`]).map((s) => path.normalize(path.join(path.dirname(s.file), s.spec))));
    const r = await replayUpdate({ core, probes, oldDir, newDir: current, tmp: work, tolerated });
    if (r.oldBroken) { t.diagnostic(`ancienne version ignorée : ${r.oldBroken}`); return; }
    assert.deepEqual(r.problems, [], `${id} ${label}`);
    t.diagnostic(`${r.stats.files} fichiers rechargés, ${r.stats.oldCalls} appels avant (${r.stats.rows} enregistrements créés), ${r.stats.calls} appels après`);
  });
}
