// Tests du module. Lancer :  CURIOSA_DIR=/chemin/vers/Curiosa npm test      (voir README.md)
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");        // le dossier du module
const core = process.env.CURIOSA_DIR ?? path.resolve(here, "..", "Curiosa");            // le cœur, cloné à côté par défaut
const { registerConformanceTests, fakeCtx, loadModuleDir } = await import(pathToFileURL(path.join(core, "testsupport/index.mjs")).href);

// 1) La suite de conformité du cœur : une exigence = un test nommé. Les « obligatoires » font échouer le test.
registerConformanceTests(here, { test });

// 2) Le comportement propre à ce module : à remplacer par les vôtres.
const { definition: def, locales } = await loadModuleDir(here);

test("la section affiche le message réglé", async () => {
  const ctx = fakeCtx({ settings: { message: "Coucou" } });
  assert.deepEqual(await def.sections.welcome(ctx), [{ type: "html", html: "<p>Coucou</p>" }]);
});

test("un texte hostile est échappé", async () => {
  const ctx = fakeCtx({ settings: { message: "<script>alert(1)</script>", signature: '"><img src=x>' } });
  const [block] = await def.sections.welcome(ctx);
  assert.ok(!block.html.includes("<script>") && !block.html.includes("<img"), block.html);
});

test("sans message réglé, le texte de repli traduit s'affiche", async () => {
  const ctx = fakeCtx({ settings: { message: "" }, messages: locales.fr });
  assert.match((await def.sections.welcome(ctx))[0].html, /Bienvenue/);
});
