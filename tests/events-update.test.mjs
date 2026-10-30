// Événements : mise à jour À CHAUD dans un site qui tourne (même processus). Le cœur importe `index.mjs?v=<version>` ; Node garde en mémoire chaque adresse déjà importée,
// donc un `import "./x.mjs"` SANS cette version reprendrait l'ANCIEN fichier voisin. Ce test rejoue l'ordre réel des choses : ancien code chargé, fichiers remplacés, nouveau code chargé.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { makeTempDir } from "./helpers/tmp.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(here, "../modules/events");
const copy = (from, to) => { fs.rmSync(to, { recursive: true, force: true }); fs.cpSync(from, to, { recursive: true }); };
const load = (dir, v) => import(`${pathToFileURL(path.join(dir, "index.mjs")).href}?v=${v}`);
const messages = JSON.parse(fs.readFileSync(path.join(SRC, "locales/fr.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "module.json"), "utf8"));
const ctxOf = (key) => fakeCtx({ key, basePath: "agenda", moduleId: "events", name: "Agenda", locale: "fr", defaultLocale: "fr", locales: ["fr"], messages, permissions: manifest.permissions, settings: { timezone: "Europe/Paris" } });

test("mise à jour dans le même processus : le nouveau code des fichiers voisins est celui qui sert (pas l'ancien resté en mémoire)", async () => {
  const dir = makeTempDir("events-update-");
  try {
    copy(SRC, dir);
    const before = (await load(dir, "ancien")).default;
    const created = await before.mcp.agenda_create_event(ctxOf("maj1"), { title: "T".repeat(110), date: "2031-03-15" });
    assert.equal(created.event.title.length, 110, "ancien code : 120 caractères permis");
    const text = fs.readFileSync(path.join(dir, "text.mjs"), "utf8");
    assert.match(text, /title: 120,/);
    fs.writeFileSync(path.join(dir, "text.mjs"), text.replace("title: 120,", "title: 20,"));
    const after = (await load(dir, "nouveau")).default;
    const created2 = await after.mcp.agenda_create_event(ctxOf("maj2"), { title: "T".repeat(110), date: "2031-03-15" });
    assert.equal(created2.event.title.length, 20, "nouveau code : le fichier voisin remplacé est bien celui qui est lu");
    const created3 = await before.mcp.agenda_create_event(ctxOf("maj3"), { title: "T".repeat(110), date: "2031-03-15" });
    assert.equal(created3.event.title.length, 110);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("aucun fichier ne charge un voisin autrement qu'avec la version du fichier principal", () => {
  for (const f of fs.readdirSync(SRC).filter((n) => n.endsWith(".mjs"))) {
    const code = fs.readFileSync(path.join(SRC, f), "utf8");
    assert.ok(!/^\s*(import|export)\b[^\n]*\bfrom\s+["']\.\.?\//m.test(code), `${f} : import statique d'un voisin`);
    assert.ok(!/\bimport\(\s*["']\.\//.test(code), `${f} : import dynamique sans version`);
  }
  assert.ok(fs.readdirSync(SRC).filter((n) => n.endsWith(".mjs")).length >= 15);
});
