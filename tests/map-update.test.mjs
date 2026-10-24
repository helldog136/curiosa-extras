// Mise à jour de Carte DANS UN SITE QUI TOURNE : le cœur importe `index.mjs?v=<version>` ; Node garde en mémoire chaque adresse déjà importée,
// donc un `import … from "./x.mjs"` SANS cette version reprendrait l'ANCIEN fichier. Ce test rejoue l'ordre réel des choses dans UN processus.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fullStore } from "./helpers/mapKit.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(here, "../modules/map");
const copy = (from, to) => { fs.rmSync(to, { recursive: true, force: true }); fs.cpSync(from, to, { recursive: true }); };
const load = (dir, v) => import(`${pathToFileURL(path.join(dir, "index.mjs")).href}?v=${v}`);
const ctx = (key = "upd") => {
  const c = fakeCtx({ key, basePath: "map", moduleId: "map", name: "Carte", locale: "fr", defaultLocale: "fr", locales: ["fr"], messages: JSON.parse(fs.readFileSync(`${SRC}/locales/fr.json`, "utf8")), settings: { sort: "order", directions: "osm" } });
  c.api.store = fullStore(); c.can = () => true;
  return c;
};

test("mise à jour dans le même processus : l'ancien code tourne, puis le nouveau se recharge avec TOUS ses fichiers voisins", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "map-update-"));
  try {
    copy(SRC, dir);
    const dataFile = path.join(dir, "data.mjs");
    fs.writeFileSync(dataFile, fs.readFileSync(dataFile, "utf8").replace("export const C =", "export const VERSION_MARK = \"ancien\"; export const C ="));
    const before = (await load(dir, "ancien")).default;
    const c1 = ctx();
    await before.hooks.onInstanceCreate(c1);
    assert.match((await before.page(c1, { segments: [] })).blocks[0].html, /cm-empty/);
    assert.equal((await import(`${pathToFileURL(dataFile).href}?v=ancien`)).VERSION_MARK, "ancien");

    copy(SRC, dir);
    const after = (await load(dir, "nouveau")).default;
    const c2 = ctx();
    await after.hooks.onInstanceCreate(c2);
    assert.equal((await import(`${pathToFileURL(dataFile).href}?v=nouveau`)).VERSION_MARK, undefined, "le nouveau data.mjs est bien celui de la nouvelle version");
    assert.equal((await after.mcp.map_place_add(c2, { name: "Après mise à jour", lat: 10.5, lng: 20.5 })).created, true);
    await after.adminActions.publishDrafts.run(c2, {});
    assert.match((await after.page(c2, { segments: [] })).blocks[0].html, /Après mise à jour/);
    const pts = await after.routes.points(new Request("https://example.org/m/upd/points", { headers: { "x-forwarded-for": "203.0.113.5" } }), c2);
    assert.equal((await pts.json()).n, 1);
    assert.ok((await after.adminPanel(c2, { query: {} })).length > 5);
    const same = ctx("upd-bis");
    await before.hooks.onInstanceCreate(same);
    await before.mcp.map_place_add(same, { name: "Avant", lat: 11.5, lng: 21.5 });
    await before.adminActions.publishDrafts.run(same, {});
    assert.match((await after.page(same, { segments: [] })).blocks[0].html, /Avant/, "les données d'avant restent lisibles");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("aucun fichier de Carte n'importe un voisin sans la version du fichier principal (ni statiquement)", () => {
  for (const f of fs.readdirSync(SRC).filter((n) => n.endsWith(".mjs"))) {
    const code = fs.readFileSync(path.join(SRC, f), "utf8");
    assert.ok(!/^\s*(import|export)\b[^\n]*\bfrom\s+["']\.\.?\//m.test(code), `${f} : import statique d'un fichier voisin (sans ?v=)`);
    for (const m of code.matchAll(/await import\(([^)]*)\)/g)) {
      if (/node:/.test(m[1])) continue;
      assert.match(m[1], /\$\{q\}/, `${f} : import dynamique sans la version : ${m[1]}`);
    }
    if (/await import\(new URL/.test(code)) assert.match(code, /const q = new URL\(import\.meta\.url\)\.search;/, `${f} lit la version de son propre fichier`);
  }
});
