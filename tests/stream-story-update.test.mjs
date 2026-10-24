// Mise à jour de Story d'annonce DANS UN SITE QUI TOURNE (2.1.0 chargée, puis la version courante) : le cœur importe `index.mjs?v=<commit>` ; Node garde en mémoire chaque adresse déjà importée,
// donc un `import … from "./x.mjs"` SANS cette version reprendrait l'ANCIEN fichier (sans les exports ajoutés en 2.2.0, ex. WATERMARK_TEXT de pure.mjs) et le module deviendrait « non chargeable ».
// Les autres tests chargent le module dans un processus neuf : ils ne voient pas ce piège (voir tests/live-status-update.test.mjs, 1.16.1). Celui-ci rejoue l'ordre réel des choses dans UN processus.
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
// Fichiers chargés par le SERVEUR (les autres, listés dans page.mjs, ne sont servis qu'au navigateur : « Cache-Control: no-cache »).
const BROWSER = new Set(["pure.mjs", "scenes.mjs", "mp4.mjs", "encode.mjs", "app.mjs"]);

test("mise à jour 2.1.0 → version courante dans le même processus : le module se recharge et expose les nouveautés", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-update-"));
  try {
    copy(path.join(here, "fixtures/stream-story-2.1.0"), dir);
    const before = (await load(dir, "ancien")).default;
    assert.ok(before.routes && typeof before.routes.studio === "function", "l'ancienne version se charge");
    assert.equal(before.routes.wordmark, undefined, "2.1.0 n'a pas la route wordmark");

    // Le cœur remplace les fichiers du dossier (même adresse), puis importe avec la nouvelle version.
    copy(path.join(here, "../modules/stream-story"), dir);
    const after = (await load(dir, "nouveau")).default;
    assert.equal(typeof after.routes.wordmark, "function", "la version courante expose la route wordmark");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8"));
    assert.ok(manifest.version.startsWith("2."), "manifeste de la version courante");

    // Les fichiers voisins viennent bien de la NOUVELLE version (pure.mjs porte WATERMARK_TEXT ; DEFAULT_CONFIG.watermark existe).
    const pure = await import(`${pathToFileURL(path.join(dir, "pure.mjs")).href}?v=nouveau`);
    assert.equal(typeof pure.WATERMARK_TEXT, "string");
    assert.equal(pure.DEFAULT_CONFIG.watermark, false);
    const data = await import(`${pathToFileURL(path.join(dir, "data.mjs")).href}?v=nouveau`);
    assert.equal(typeof data.setWatermarkPref, "function");
    // La route wordmark répond avec la police du dossier.
    const res = await after.routes.wordmark(new Request("http://x/wordmark"), {});
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "font/woff2");
    assert.ok((await res.arrayBuffer()).byteLength > 500);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("aucun fichier de Story d'annonce chargé par le serveur n'importe un voisin sans la version du fichier principal", () => {
  const dir = path.join(here, "../modules/stream-story");
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".mjs") && !BROWSER.has(n))) {
    const code = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!/^\s*(import|export)\b[^\n]*\bfrom\s+["']\.\.?\//m.test(code), `${f} : import statique d'un fichier voisin (sans ?v=) ; utiliser await import(\`./x.mjs\${v}\`)`);
  }
});
