// Vidéothèque : mise à jour DANS UN SITE QUI TOURNE. Le cœur importe `index.mjs?v=<version>` ; Node garde en mémoire chaque adresse déjà importée, donc un `import … from "./x.mjs"` sans cette version
// reprendrait l'ANCIEN fichier. Ce test rejoue l'ordre réel dans UN processus (voir tests/live-status-update.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(here, "../modules/videos");
const load = (dir, v) => import(`${pathToFileURL(path.join(dir, "index.mjs")).href}?v=${v}`);
const SERVER_FILES = fs.readdirSync(SRC).filter((f) => f.endsWith(".mjs"));
const fr = () => JSON.parse(fs.readFileSync(path.join(SRC, "locales/fr.json"), "utf8"));

test("aucun fichier du module n'importe un voisin sans la version du fichier principal", () => {
  assert.ok(SERVER_FILES.length >= 10);
  for (const f of SERVER_FILES) {
    const code = fs.readFileSync(path.join(SRC, f), "utf8");
    assert.ok(!/^\s*(import|export)\b[^\n]*\bfrom\s+["']\.\.?\//m.test(code), `${f} : import statique d'un fichier voisin`);
    for (const m of code.matchAll(/await import\(`(\.\/[a-z]+\.mjs)([^`]*)`\)/g)) assert.equal(m[2], "${v}", `${f} : ${m[1]} importé sans la version`);
    if (f !== "pure.mjs") assert.match(code, /const v = new URL\(import\.meta\.url\)\.search/, `${f} lit la version`);
  }
});

test("une mise à jour dans le même processus charge le nouveau code, y compris celui des fichiers voisins", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "videos-update-"));
  try {
    fs.cpSync(SRC, dir, { recursive: true });
    const before = (await load(dir, "ancien")).default;
    const mk = async (key) => {
      const ctx = fakeCtx({ key, basePath: "videos", locale: "fr", defaultLocale: "fr", locales: ["fr"], messages: fr() });
      for (let i = 0; i < 20; i++) await ctx.api.store.add("vid_items", { n: i + 1, provider: "youtube", ext: `abcdefg${String(i).padStart(4, "0")}`, title: `V${i + 1}`, status: "published", date: "2026-01-01" });
      return ctx;
    };
    const cards = async (def, ctx) => ((await def.page(ctx, { segments: [] })).blocks[0].html.match(/class="vl-ct"/g) ?? []).length;
    const ctxA = await mk("u1");
    assert.equal(await cards(before, ctxA), 12);
    const pure = path.join(dir, "pure.mjs");
    fs.writeFileSync(pure, fs.readFileSync(pure, "utf8").replace("perPage: 12,", "perPage: 7,"));
    const after = (await load(dir, "nouveau")).default;
    assert.equal(await cards(after, await mk("u2")), 7, "le nouveau code des fichiers voisins sert tout de suite");
    assert.equal(await cards(before, ctxA), 12, "l'ancienne version, restée en mémoire, n'est pas touchée");
    assert.equal((await import(`${pathToFileURL(pure).href}?v=nouveau`)).LIMITS.perPage, 7);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("le script de page est un vrai fichier du module, léger, sans adresse codée en dur ni évaluation de code", () => {
  const file = path.join(SRC, "scripts/videos.js");
  const code = fs.readFileSync(file, "utf8");
  assert.ok(fs.statSync(file).size < 8 * 1024);
  assert.ok(!/\beval\b|new Function|document\.write|innerHTML|outerHTML/.test(code));
  assert.ok(!/https?:\/\//.test(code.replace(/\/\*[\s\S]*?\*\//g, "")), "aucune adresse en dur dans le script");
  assert.match(code, /EMBED = \/\^https:\\\/\\\/www\\\.youtube-nocookie\\\.com\\\/embed\\\/\[A-Za-z0-9_-\]\{11\}/);
  assert.match(code, /setAttribute\("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"\)/);
  assert.match(code, /setAttribute\("allow", "autoplay; fullscreen"\)/);
});
