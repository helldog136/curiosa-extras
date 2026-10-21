// Contacts (lot K2) — « dézoom permanent » : 2 000, 10 000 puis 100 000 fiches. Import par pas (lecture une seule fois, paquets de 200, jamais tout en mémoire),
// export en flux de pages de 500, aller-retour sans perte, réimport sans doublon, détecteur de doublons. Chaque taille tourne dans son propre processus.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const run = (n) => {
  const r = spawnSync(process.execPath, ["--expose-gc", "--max-old-space-size=4096", new URL("./helpers/contactsVolume.mjs", import.meta.url).pathname, String(n)], { encoding: "utf8", maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").pop());
};

for (const [n, timeout, limits] of [[2000, 120_000, { stage: 5000, run: 20_000, export: 10_000, heap: 600 }], [10_000, 240_000, { stage: 10_000, run: 40_000, export: 20_000, heap: 900 }], [100_000, 900_000, { stage: 30_000, run: 300_000, export: 120_000, heap: 3000 }]]) {
  test(`${n.toLocaleString("en")} fiches : import par pas, export en flux, aller-retour, réimport sans doublon, doublons`, { timeout }, () => {
    const m = run(n);
    assert.equal(m.limits.maxContacts, 100_000);
    // Lecture du fichier une seule fois : toutes les lignes sont rangées.
    assert.equal(m.staged, m.rows, "toutes les lignes du fichier sont lues et rangées");
    assert.deepEqual(m.previewCounts, m.runCounts, "l'aperçu annonce exactement ce que fait l'import");
    assert.deepEqual(m.runCounts, { created: n, linked: 0, skipped: 0, error: 0 }, "100 000 lignes : le plafond du fichier et celui du carnet, atteints exactement");
    assert.equal(m.cards, n);
    assert.equal(m.stagingLeft, 0, "les lignes rangées sont effacées à la fin");
    assert.ok(m.jobBytes < 30_000, `le document de l'import reste petit : ${m.jobBytes} octets`);
    assert.ok(m.logDocs <= 14, `journal borné : ${m.logDocs} documents`);
    assert.ok(m.ms.stageMs < limits.stage, `lecture : ${m.ms.stageMs} ms`);
    assert.ok(m.ms.runMs < limits.run, `import : ${m.ms.runMs} ms en ${m.runSteps} pas`);
    // Export : un titre + des pages de 500 fiches au plus.
    assert.equal(m.export.lines, n + 1);
    assert.ok(m.export.maxLinesPerChunk <= 500, `${m.export.maxLinesPerChunk} lignes par morceau`);
    assert.equal(m.export.chunks, 1 + Math.ceil(n / 500));
    assert.ok(m.ms.exportMs < limits.export, `export : ${m.ms.exportMs} ms`);
    // Aller-retour et réimport.
    assert.deepEqual(m.roundTripCounts, { created: n, linked: 0, skipped: 0, error: 0 });
    assert.equal(m.roundTripCards, n);
    assert.deepEqual(m.reimportCounts, { created: 0, linked: 0, skipped: n, error: 0 }, "réimporter ne crée rien");
    // Bornes du stockage : aucune lecture de plus de 1 000, aucune écriture groupée de plus de 5 000, notes par 500 au plus.
    assert.ok(m.spy.maxPage <= 1000 && m.spy.maxAddMany <= 5000 && m.spy.maxListByKey <= 500, JSON.stringify(m.spy));
    assert.equal(m.dupGroups, 0, "aucun faux doublon dans des noms tous différents");
    assert.ok(m.ms.dedupeMs < 30_000, `doublons : ${m.ms.dedupeMs} ms`);
    assert.ok(m.heapEndMB < limits.heap, `mémoire : ${m.heapEndMB} Mo`);
  });
}
