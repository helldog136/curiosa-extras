// Mascotte — mise à jour DANS UN SITE QUI TOURNE : version A chargée, fichiers remplacés, version B chargée — B doit voir ses propres fichiers voisins.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { makeTempDir } from "./helpers/tmp.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const source = path.join(here, "../modules/mascot");
const load = (dir, v) => import(`${pathToFileURL(path.join(dir, "index.mjs")).href}?v=${v}`);
const manifest = JSON.parse(fs.readFileSync(path.join(source, "module.json"), "utf8"));
const messages = JSON.parse(fs.readFileSync(path.join(source, "locales/fr.json"), "utf8"));
const ctx = (key) => fakeCtx({ key, moduleId: "mascot", locale: "fr", defaultLocale: "fr", locales: ["fr"], messages, permissions: manifest.permissions, settings: {} });

test("mise à jour à chaud : la nouvelle version utilise SES fichiers voisins (phrases de départ, style)", async () => {
  const dir = makeTempDir("mascot-update-");
  try {
    fs.cpSync(source, dir, { recursive: true });
    const before = (await load(dir, "a")).default;
    const a = ctx("m1");
    await before.hooks.onInstanceCreate(a);
    const textsOf = (c) => c.dumpStore().filter((r) => r.collection === "phrases").map((r) => r.data.text);
    assert.ok(textsOf(a).includes("Bonjour, prenez votre temps et regardez autour de vous."));
    const starters = path.join(dir, "starters.mjs");
    fs.writeFileSync(starters, fs.readFileSync(starters, "utf8").replace("Bonjour, prenez votre temps et regardez autour de vous.", "Version B : bonjour."));
    const style = path.join(dir, "style.mjs");
    fs.writeFileSync(style, fs.readFileSync(style, "utf8").replace(".mc-n{", ".mc-n-b{"));
    const after = (await load(dir, "b")).default;
    const b = ctx("m2");
    await after.hooks.onInstanceCreate(b);
    assert.ok(textsOf(b).includes("Version B : bonjour."));
    assert.match(await (await after.routes["mascot.css"](new Request("https://example.test/x"), b)).text(), /\.mc-n-b\{/);
    assert.doesNotMatch(await (await before.routes["mascot.css"](new Request("https://example.test/x"), a)).text(), /\.mc-n-b\{/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
