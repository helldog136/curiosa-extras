// Mise à jour de Statut du live DANS UN SITE QUI TOURNE (1.3.2 chargé, puis 1.4.x) : le cœur importe `index.mjs?v=<commit>` ; Node garde en mémoire chaque adresse déjà importée,
// donc un `import … from "./source.mjs"` SANS cette version reprendrait l'ANCIEN source.mjs (celui de 1.3.2, sans `askAll`) et le module deviendrait « non chargeable ».
// Les autres tests chargent le module dans un processus neuf, sans `?v=` : ils ne peuvent pas voir ce piège. Celui-ci rejoue l'ordre réel des choses dans UN processus.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const copy = (from, to) => { fs.rmSync(to, { recursive: true, force: true }); fs.cpSync(from, to, { recursive: true }); };
/** Comme registry.ts du cœur : l'adresse du fichier principal porte `?v=<version>`. */
const load = (dir, v) => import(`${pathToFileURL(path.join(dir, "index.mjs")).href}?v=${v}`);

test("mise à jour 1.3.2 → version courante dans le même processus : le module se recharge, et YouTube répond", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-status-update-"));
  try {
    // Avant la mise à jour : l'ancien code tourne (son adopt.mjs importe ./source.mjs, qui reste en mémoire).
    copy(path.join(here, "fixtures/live-status-1.3.2"), dir);
    const before = (await load(dir, "ancien")).default;
    assert.equal(typeof before.slots["layout.banner"], "function");

    // Le cœur remplace les fichiers du dossier (même adresse), puis importe avec la nouvelle version.
    copy(path.join(here, "../modules/live-status"), dir);
    const after = (await load(dir, "nouveau")).default;
    assert.equal(typeof after.slots["layout.banner"], "function");

    // Le fichier YouTube utilise bien le source.mjs de la NOUVELLE version (askAll existe) : un direct YouTube est vu.
    const yt = await import(`${pathToFileURL(path.join(dir, "youtube.mjs")).href}?v=nouveau`);
    yt.resetYoutube();
    const ctx = { instance: { key: "live-status" }, api: { services: { callAll: async () => [{ ok: true, instance: "a", name: "Ma chaîne", value: { ok: true, live: true, videoId: "abcdefghijk", title: "Soirée" } }] } } };
    const r = await yt.youtubeLives(ctx);
    assert.equal(r.state, "live");
    assert.equal(r.lives[0].videoId, "abcdefghijk");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("aucun fichier de Statut du live n'importe un voisin sans la version du fichier principal", () => {
  const dir = path.join(here, "../modules/live-status");
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".mjs"))) {
    const code = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!/^\s*(import|export)\b[^\n]*\bfrom\s+["']\.\.?\//m.test(code), `${f} : import statique d'un fichier voisin (sans ?v=) ; utiliser await import(new URL(\`./x.mjs\${q}\`, import.meta.url).href)`);
  }
});
