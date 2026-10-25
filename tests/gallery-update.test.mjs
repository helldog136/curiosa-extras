// Galeries photos : mise à jour DANS UN SITE QUI TOURNE. Le cœur importe `index.mjs?v=<version>` ; Node garde en mémoire chaque adresse déjà importée,
// donc un `import … from "./data.mjs"` SANS cette version reprendrait l'ANCIEN fichier. Le module a plusieurs fichiers serveur : tous importent leurs voisins avec la version.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(here, "../modules/gallery");
const load = (dir, file, v) => import(`${pathToFileURL(path.join(dir, file)).href}?v=${v}`);

test("aucun fichier du module n'importe un voisin sans la version du fichier principal (pas d'import statique)", () => {
  for (const f of fs.readdirSync(SRC).filter((n) => n.endsWith(".mjs"))) {
    const code = fs.readFileSync(path.join(SRC, f), "utf8");
    assert.ok(!/^\s*(import|export)\b[^\n]*\bfrom\s+["']\.\.?\//m.test(code), `${f} : import statique d'un fichier voisin (sans ?v=)`);
    for (const line of code.split("\n").filter((l) => /\bimport\(/.test(l) && /\.mjs|\$\{name\}/.test(l))) assert.match(line, /\.search|\$\{q\}/, `${f} : l'import dynamique de voisin porte la version : ${line.trim().slice(0, 90)}`);
  }
});

test("mise à jour dans le même processus : chaque version a SES fichiers voisins (ni mélange, ni ancien code resté en mémoire)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gallery-update-"));
  try {
    fs.cpSync(SRC, dir, { recursive: true });
    const before = (await load(dir, "index.mjs", "ancien")).default;
    fs.cpSync(SRC, dir, { recursive: true }); // le cœur remplace les fichiers du dossier (même adresse), puis importe avec la nouvelle version
    const after = (await load(dir, "index.mjs", "nouveau")).default;
    assert.notEqual(before, after);
    for (const def of [before, after]) {
      assert.equal(typeof def.page, "function");
      assert.equal(typeof def.routes.removal, "function");
      assert.equal(typeof def.services["gallery.albums"].list, "function");
    }
    const oldData = await load(dir, "data.mjs", "ancien");
    const newData = await load(dir, "data.mjs", "nouveau");
    assert.notEqual(oldData, newData, "deux versions, deux fichiers en mémoire");
    // Le nouveau code travaille avec le nouveau fichier de données : sa mémoire (cache des albums) est celle de `newData`, pas de `oldData`.
    const ctx = fakeCtx({ key: "maj", moduleId: "gallery", basePath: "galeries", locale: "fr", defaultLocale: "fr", locales: ["fr"], siteUrl: "https://example.test" });
    const id = await ctx.api.store.add("gallery_albums", { title: "Avant", slug: "avant", status: "published", mode: "external", link: "https://photos.example.org/x", pid: "x", desc: "", date: "", cover: "", pos: 1, bytes: 0, total: 0, shown: 0, coverThumb: {}, preview: "" });
    const list = () => after.services["gallery.albums"].list(ctx, {});
    assert.equal((await list()).albums[0].title, "Avant");
    const row = ctx.dumpStore().find((r) => r.id === id);
    await ctx.api.store.update(id, { ...row.data, title: "Après" });
    assert.equal((await list()).albums[0].title, "Avant", "servi depuis la mémoire du nouveau fichier de données");
    oldData.invalidate(ctx);
    assert.equal((await list()).albums[0].title, "Avant", "vider la mémoire de l'ANCIEN fichier ne touche pas le nouveau");
    newData.invalidate(ctx);
    assert.equal((await list()).albums[0].title, "Après");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("mise à jour à chaud : le nouveau code garde et supprime les fichiers avec SON ops.mjs (la permission files, l'API files)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gallery-update-files-"));
  try {
    fs.cpSync(SRC, dir, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8"));
    assert.ok(manifest.permissions.includes("files"));
    const oldOps = await load(dir, "ops.mjs", "ancien");
    const newOps = await load(dir, "ops.mjs", "nouveau");
    assert.notEqual(oldOps, newOps);
    const full = "/uploads/aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb.jpg";
    const thumb = "/uploads/cccccccc-1111-2222-3333-dddddddddddd.jpg";
    const ctx = fakeCtx({ key: "maj-files", moduleId: "gallery", basePath: "galeries", locale: "fr", defaultLocale: "fr", locales: ["fr"], permissions: manifest.permissions, uploads: [full, thumb] });
    const album = await newOps.createAlbum(ctx, { title: "A", status: "published", mode: "hosted" });
    const photo = await newOps.addUploadedPhoto(ctx, album.id, { full, thumb });
    assert.ok(photo.ok);
    assert.equal(ctx.dumpFiles().filter((f) => f.owner === "me").length, 2);
    const gone = await newOps.deletePhoto(ctx, album.id, photo.id);
    assert.deepEqual(gone.files, { removed: 2, legacy: 0, failed: 0 });
    assert.equal(ctx.dumpFiles().length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
