// Jeu du jour — mise à jour DANS UN SITE QUI TOURNE : le cœur importe `index.mjs?v=<version>` ; Node garde en mémoire chaque adresse déjà importée.
// Un `import … from "./x.mjs"` sans cette version reprendrait l'ANCIEN fichier voisin. Les autres tests chargent le module dans un processus neuf et ne peuvent pas voir ce piège.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.join(here, "../modules/daily-game");
const load = (dir, v) => import(`${pathToFileURL(path.join(dir, "index.mjs")).href}?v=${v}`);

test("mise à jour dans le même processus : le nouveau code des fichiers voisins est bien celui qui tourne", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-game-update-"));
  try {
    fs.cpSync(src, dir, { recursive: true });
    const before = (await load(dir, "ancien")).default;
    assert.equal(typeof before.routes.answer, "function");
    const lib = path.join(dir, "lib.mjs");
    fs.writeFileSync(lib, fs.readFileSync(lib, "utf8").replace("questions: 2000,", "questions: 7,"));
    const after = (await load(dir, "nouveau")).default;
    const manifest = JSON.parse(fs.readFileSync(path.join(src, "module.json"), "utf8"));
    const messages = JSON.parse(fs.readFileSync(path.join(src, "locales/fr.json"), "utf8"));
    const mk = () => { const c = fakeCtx({ key: "maj", basePath: "jeu", moduleId: "daily-game", locale: "fr", defaultLocale: "fr", locales: ["fr"], messages, permissions: manifest.permissions, settings: { timezone: "UTC" } }); c.can = () => true; return c; };
    const fill = async (c) => { for (let i = 0; i < 7; i++) await c.api.store.add("dg_questions", { type: "quiz", status: "draft", pos: i, by: "admin", d: { tr: { fr: { q: `Q${i}`, a: ["a", "b"] } }, correct: 0 } }); };
    const one = { state: "draft", q_fr: "Une de trop ?", a1_fr: "a", a2_fr: "b", correct: "1" };
    const ctx = mk(); await fill(ctx);
    assert.match((await after.adminActions.saveQuestion.run(ctx, one)).error, /La banque est pleine \(7 questions\)/);
    const oldCtx = mk(); await fill(oldCtx);
    assert.equal((await before.adminActions.saveQuestion.run(oldCtx, one)).ok, "Enregistré.", "l'ancienne version garde son ancienne borne");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("aucun fichier du module n'importe un voisin sans la version du fichier principal", () => {
  for (const f of fs.readdirSync(src).filter((n) => n.endsWith(".mjs"))) {
    const code = fs.readFileSync(path.join(src, f), "utf8");
    assert.ok(!/^\s*(import|export)\b[^\n]*\bfrom\s+["']\.\.?\//m.test(code), `${f} : import statique d'un fichier voisin (sans ?v=)`);
    for (const m of code.matchAll(/import\(\s*([`"'])(\.\/[^`"']*)\1\s*\)/g)) assert.ok(m[2].includes("${q}"), `${f} : import dynamique de ${m[2]} sans version`);
  }
});
