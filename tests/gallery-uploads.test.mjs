// Galeries photos : les photos sont envoyées par le mécanisme d'envoi du CŒUR ; le module ne garde que des adresses /uploads/… (aucun octet d'image).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { def, ctxFor, makeAlbum, data, text, ops, rows, uploadUrl, photoFields, view, DIR } from "./helpers/galleryKit.mjs";

const act = (ctx, name, values) => def.adminActions[name].run(ctx, values);

test("adresses envoyées : seulement /uploads/<uuid>.jpg|png|webp ; jamais un GIF, un SVG, un autre site, un chemin piégé", () => {
  const ok = uploadUrl("jpg");
  assert.equal(text.uploadPath(ok), ok);
  assert.equal(text.uploadPath(uploadUrl("png")).endsWith(".png"), true);
  assert.equal(text.uploadPath(uploadUrl("webp")).endsWith(".webp"), true);
  for (const bad of [uploadUrl("gif"), uploadUrl("svg"), uploadUrl("mp4"), "https://evil.example.net/x.jpg", "//evil.example.net/uploads/x.jpg", "/uploads/../etc/passwd", "/uploads/abc.jpg", `${ok}?c=1`, `x${ok}`, "javascript:alert(1)", "", null, undefined, 42, {}]) assert.equal(text.uploadPath(bad), "", String(bad));
  assert.equal(text.cleanUpload(ok), `${ok}?c=o_1_0.5_0.5_ffffff`);
});

test("la version « propre » demandée au cœur est un cadrage valide sans rognage (pas d'information cachée, redressée par le moteur d'images)", async () => {
  const { parseCrop, splitImageRef } = await import(`${process.cwd()}/src/core/imageCrop.ts`);
  const ref = text.cleanUpload(uploadUrl());
  const split = splitImageRef(ref);
  assert.ok(split.crop, "le cœur reconnaît ce cadrage");
  assert.deepEqual(split.crop, { ratio: null, zoom: 1, x: 0.5, y: 0.5, fill: "ffffff" });
  assert.ok(parseCrop("o_1_0.5_0.5_ffffff"));
});

test("action « addPhoto » : le module ne garde que les adresses, les tailles annoncées sont rognées, aucun octet d'image n'est stocké", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx);
  const f = photoFields(a.id, { name: "../../évil<script>.jpg", caption: " Ouverture  ", alt: "Deux personnes", w: "99999", h: "-5", bytes: "999999999", tbytes: "abc" });
  assert.equal((await act(ctx, "addPhoto", f)).ok, "Photo ajoutée.");
  const [p] = await data.loadPhotos(ctx, await data.getAlbum(ctx, a.id));
  assert.deepEqual([p.full, p.thumb], [f.full, f.thumb]);
  assert.deepEqual([p.caption, p.alt, p.name], ["Ouverture", "Deux personnes", "évil_script_.jpg"]);
  assert.deepEqual([p.w, p.h, p.bytes, p.tbytes], [4096, 0, 4_000_000, 0]);
  const stored = JSON.stringify(ctx.dumpStore());
  assert.doesNotMatch(stored, /b64|base64|"mime"/);
  assert.equal(rows(ctx, "gallery_blobs").length, 0);
});

test("action « addPhoto » : adresses refusées avec une phrase lisible sous le champ ; doublon, album plein et site plein refusés", async () => {
  const ctx = ctxFor({ maxPhotos: 2 });
  const a = await makeAlbum(ctx);
  for (const bad of [{ full: "https://evil.example.net/x.jpg" }, { thumb: uploadUrl("gif") }, { full: "" }, { thumb: "/uploads/../x.jpg" }]) {
    const r = await act(ctx, "addPhoto", photoFields(a.id, bad));
    assert.match(r.errors.photo, /pas été reconnue comme une image envoyée/);
    assert.equal(r.error, r.errors.photo);
  }
  const good = photoFields(a.id);
  assert.equal((await act(ctx, "addPhoto", good)).ok, "Photo ajoutée.");
  assert.match((await act(ctx, "addPhoto", { ...photoFields(a.id), full: good.full })).errors.photo, /déjà dans l'album/);
  assert.equal((await act(ctx, "addPhoto", photoFields(a.id))).ok, "Photo ajoutée.");
  assert.match((await act(ctx, "addPhoto", photoFields(a.id))).errors.photo, /album est plein \(2 photos\).*autre service/);
  assert.match((await act(ctx, "addPhoto", photoFields("inconnu"))).error, /Introuvable/);
  const site = ctxFor({ maxTotalPhotos: 10, maxPhotos: 300 });
  const b = await makeAlbum(site, { n: 10 });
  assert.match((await act(site, "addPhoto", photoFields(b.id))).errors.photo, /nombre maximal de photos \(10\)/);
  assert.equal(data.limitsOf(ctxFor({ maxTotalPhotos: 999999 })).totalPhotos, 10_000);
  assert.equal(data.limitsOf(ctxFor({ maxPhotoKB: 99999 })).photoBytes, 4_000_000);
});

test("les pages publiques n'affichent que la version propre fabriquée par le cœur (jamais l'original) ; les photos d'un autre site restent telles quelles", async () => {
  const ctx = ctxFor({ allowedHosts: "images.example.org" });
  const a = await makeAlbum(ctx, { n: 2 });
  await ops.addExternalPhoto(ctx, a.id, { url: "https://images.example.org/a.jpg" });
  const page = await def.page(ctx, { segments: [a.album.slug] });
  const html = page.blocks[0].html;
  const [p1] = await data.loadPhotos(ctx, a.album);
  assert.match(html, new RegExp(`data-full="${p1.full}\\?c=o_1_0\\.5_0\\.5_ffffff"`));
  assert.match(html, new RegExp(`<img src="${p1.thumb}\\?c=o_1_0\\.5_0\\.5_ffffff"`));
  assert.equal([...html.matchAll(/\/uploads\/[0-9a-f-]{36}\.jpg(?![?\w])/g)].length, 0, "aucune adresse d'original sans cadrage");
  assert.match(html, /src="https:\/\/images\.example\.org\/a\.jpg"/);
});

test("le module ne garde, ne lit et ne sert plus aucune image : pas de route d'image, pas d'import de fichiers, pas de base64", () => {
  assert.deepEqual(Object.keys(def.routes), ["removal"]);
  assert.equal(fs.existsSync(`${DIR}/images.mjs`), false);
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith(".mjs"))) {
    const code = fs.readFileSync(`${DIR}/${f}`, "utf8").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\bb64\b|toString\("base64"\)|from\("[^"]*", "base64"\)|node:fs/, f);
  }
});

test("retirer une photo ou un album : la liste est mise à jour, le module le dit honnêtement (les fichiers du cœur restent sur le disque)", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 2 });
  const blocks = await def.adminPanel(ctx, { query: { album: a.id, photo: `${a.id}.${a.photos[0]}` } });
  assert.match(JSON.stringify(blocks), /Retirer cette photo de l'album/);
  assert.match(JSON.stringify(blocks), /reste sur le disque du site/);
  assert.match((await act(ctx, "removePhoto", { id: `${a.id}.${a.photos[0]}` })).ok, /son fichier reste sur le disque/);
  assert.equal((await data.getAlbum(ctx, a.id)).total, 1);
  assert.match((await act(ctx, "removeAlbum", { id: a.id })).ok, /supprimé/);
  assert.equal(rows(ctx, "gallery_photos").length, 0);
  assert.equal(view.imgSrc(ctx, { full: "" , url: "", thumb: "", turl: "" }, "full"), "");
});
