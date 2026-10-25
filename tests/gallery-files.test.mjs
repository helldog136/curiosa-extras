// Galeries photos : les fichiers envoyés sont gardés à l'envoi (ctx.api.files.claim) et supprimés avec la photo ou l'album (ctx.api.files.remove).
import test from "node:test";
import assert from "node:assert/strict";
import { def, ctxFor, makeAlbum, addLegacyPhoto, data, ops, rows, photoFields, uploadUrl, legacyUrl, manifest, messages, DIR } from "./helpers/galleryKit.mjs";
import fs from "node:fs";

const act = (ctx, name, values) => def.adminActions[name].run(ctx, values);
const gone = (ctx, ...urls) => urls.every((u) => !ctx.dumpFiles().some((f) => f.url === u));
const here = (ctx, url) => ctx.dumpFiles().find((f) => f.url === url);

test("le manifeste demande la permission « files », le cœur 0.2.13, et le dit dans la déclaration de vie privée (500 caractères au plus, FR et EN)", () => {
  assert.ok(manifest.permissions.includes("files"));
  assert.equal(manifest.minCore, "0.2.13");
  assert.equal(manifest.version, "1.1.0");
  for (const lang of ["fr", "en"]) assert.ok(manifest.privacy[lang].length <= 500, `${lang} : ${manifest.privacy[lang].length}`);
  assert.match(manifest.privacy.fr, /supprimés du serveur avec la photo ou l'album/);
  assert.match(manifest.privacy.en, /deleted from the server with the photo or album/);
});

test("envoi : les deux fichiers (original et miniature) sont revendiqués juste après l'envoi, par ce module", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx);
  const f = photoFields(a.id);
  assert.equal((await act(ctx, "addPhoto", f)).ok, "Photo ajoutée.");
  assert.deepEqual(ctx.calls.files.map((c) => [c.op, c.url, c.result.ok]), [["claim", f.full, true], ["claim", f.thumb, true]]);
  assert.equal(here(ctx, f.full).owner, "me");
  assert.equal(here(ctx, f.thumb).owner, "me");
});

test("suppression d'une photo : elle sort d'abord des données, puis l'original ET la miniature disparaissent du disque", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 2 });
  const [p0, p1] = await data.loadPhotos(ctx, a.album);
  assert.equal(ctx.dumpFiles().filter((f) => f.owner === "me").length >= 4, true);
  const r = await act(ctx, "removePhoto", { id: `${a.id}.${p0.id}` });
  assert.match(r.ok, /Photo supprimée\. Ses fichiers ont été effacés du disque\.$/);
  assert.ok(gone(ctx, p0.full, p0.thumb), "les deux fichiers ont disparu");
  assert.ok(here(ctx, p1.full) && here(ctx, p1.thumb), "l'autre photo est intacte");
  const order = ctx.calls.files.filter((c) => c.op === "remove").map((c) => c.url);
  assert.deepEqual(order.sort(), [p0.full, p0.thumb].sort());
  assert.deepEqual((await data.loadPhotos(ctx, await data.getAlbum(ctx, a.id))).map((p) => p.id), [p1.id]);
  // Supprimer encore la même photo : introuvable, aucun autre fichier touché.
  assert.match((await act(ctx, "removePhoto", { id: `${a.id}.${p0.id}` })).error, /Introuvable/);
  assert.ok(here(ctx, p1.full));
});

test("la photo est retirée des données AVANT la suppression des fichiers", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 1 });
  const [p] = await data.loadPhotos(ctx, a.album);
  const real = ctx.api.files.remove;
  let seen = null;
  ctx.api.files = { ...ctx.api.files, owns: ctx.api.files.owns, remove: async (u) => { seen ??= (await data.loadPhotos(ctx, await data.getAlbum(ctx, a.id))).length; return real(u); } };
  await ops.deletePhoto(ctx, a.id, p.id);
  assert.equal(seen, 0, "au moment de la suppression du fichier, la photo n'est déjà plus dans l'album");
});

test("suppression d'un album : tous les fichiers de ses photos (visibles ou masquées) et de sa couverture disparaissent ; ceux d'un autre album restent", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 5, hidden: [1] });
  const other = await makeAlbum(ctx, { title: "Autre", n: 1 });
  const mine = (await data.loadPhotos(ctx, a.album)).flatMap((p) => [p.full, p.thumb]);
  const keep = (await data.loadPhotos(ctx, other.album)).flatMap((p) => [p.full, p.thumb]);
  assert.ok((await data.getAlbum(ctx, a.id)).coverThumb.src, "l'album a une couverture");
  const r = await act(ctx, "removeAlbum", { id: a.id });
  assert.match(r.ok, /Album supprimé\. Les fichiers de ses photos ont été effacés du disque\.$/);
  assert.ok(gone(ctx, ...mine), "10 fichiers disparus");
  assert.equal(mine.length, 10);
  assert.ok(keep.every((u) => here(ctx, u)), "l'autre album est intact");
  assert.equal(rows(ctx, "gallery_albums").length, 1);
});

test("suppression d'un gros album : par lots bornés (au plus 8 suppressions en même temps), sans minuteur", async () => {
  const ctx = ctxFor({ maxPhotos: 300, maxTotalPhotos: 300 });
  const a = await makeAlbum(ctx, { n: 40 });
  const real = ctx.api.files.remove;
  let now = 0, peak = 0;
  ctx.api.files = { ...ctx.api.files, owns: ctx.api.files.owns, remove: async (u) => { now++; peak = Math.max(peak, now); await new Promise((r) => setImmediate(r)); now--; return real(u); } };
  const r = await ops.deleteAlbum(ctx, a.id);
  assert.deepEqual(r.files, { removed: 80, legacy: 0, failed: 0 });
  assert.ok(peak <= 8 && peak > 1, `pic ${peak}`);
  assert.equal(ctx.dumpFiles().length >= 0, true);
  assert.equal(ctx.dumpFiles().filter((f) => f.owner === "me").length, 0);
  const src = fs.readFileSync(`${DIR}/ops.mjs`, "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(src, /setInterval|setTimeout/);
});

test("« Masquer » reste un masquage : aucun fichier n'est supprimé, la photo se remontre", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 1 });
  const [p] = await data.loadPhotos(ctx, a.album);
  const before = ctx.dumpFiles().length;
  assert.match((await act(ctx, "toggleHidden", { id: `${a.id}.${p.id}` })).ok, /masquée/);
  assert.equal(ctx.dumpFiles().length, before);
  assert.equal(ctx.calls.files.filter((c) => c.op === "remove").length, 0);
  // Une demande de retrait traitée masque la photo, sans rien effacer non plus.
  const req = await ctx.api.store.add("gallery_requests", { album: a.id, photo: p.id, label: "x", status: "new", at: Date.now() });
  await act(ctx, "maskRequest", { id: req });
  assert.equal(ctx.calls.files.filter((c) => c.op === "remove").length, 0);
  assert.equal(ctx.dumpFiles().length, before);
  assert.equal((await act(ctx, "toggleHidden", { id: `${a.id}.${p.id}` })).ok.includes("affichée"), true);
});

test("anciennes photos (avant la 0.2.13) : suppression sans erreur, dite honnêtement ; leurs fichiers restent, ceux des nouvelles photos disparaissent", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 1 });
  const old = await addLegacyPhoto(ctx, a.id);
  const [fresh] = await data.loadPhotos(ctx, a.album);
  // L'écran d'une ancienne photo le dit avant la suppression ; celui d'une nouvelle photo ne le dit pas.
  const panel = (id) => def.adminPanel(ctx, { query: { album: a.id, photo: `${a.id}.${id}` } }).then((b) => JSON.stringify(b));
  assert.match(await panel(old), /Photo envoyée avant la mise à jour du site : si vous la supprimez/);
  assert.doesNotMatch(await panel(fresh.id), /avant la mise à jour du site/);
  const r = await act(ctx, "removePhoto", { id: `${a.id}.${old}` });
  assert.ok(r.ok, "pas d'erreur");
  assert.match(r.ok, /avait été envoyée avant la mise à jour du site : ce module ne peut pas effacer son fichier d'origine, qui reste sur le disque du site/);
  assert.doesNotMatch(r.ok, /ont été effacés/);
  assert.equal(ctx.calls.files.filter((c) => c.op === "remove").length, 0, "rien à supprimer, aucun appel inutile");
  // Album mélangé : nouvelles photos effacées, anciennes comptées.
  await addLegacyPhoto(ctx, a.id);
  await addLegacyPhoto(ctx, a.id);
  const mixed = await act(ctx, "removeAlbum", { id: a.id });
  assert.match(mixed.ok, /Album supprimé\. Les fichiers de ses photos ont été effacés du disque\. Fichiers de photos envoyées avant la mise à jour du site restés sur le disque : 4\. Ce module ne peut pas les effacer\./);
  assert.ok(gone(ctx, fresh.full, fresh.thumb));
});

test("fichier déjà supprimé ou inconnu au cœur : remove rend removed:false, accepté sans erreur", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 1 });
  const [p] = await data.loadPhotos(ctx, a.album);
  await ctx.api.files.remove(p.full); // déjà supprimé ailleurs (sauvegarde restaurée, autre outil)
  assert.deepEqual(await ctx.api.files.remove(p.full), { ok: true, removed: false });
  const r = await act(ctx, "removePhoto", { id: `${a.id}.${p.id}` });
  assert.match(r.ok, /Photo supprimée/);
  assert.ok(gone(ctx, p.thumb));
});

test("un refus de suppression du cœur ne casse rien : la photo a déjà quitté l'album, le message dit que le fichier reste", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 1 });
  const [p] = await data.loadPhotos(ctx, a.album);
  ctx.api.files = { ...ctx.api.files, owns: ctx.api.files.owns, remove: async () => ({ ok: false, reason: "failed" }) };
  const r = await act(ctx, "removePhoto", { id: `${a.id}.${p.id}` });
  assert.match(r.ok, /Photo supprimée\. Fichiers qui n'ont pas pu être effacés pour l'instant : 2\./);
  assert.equal((await data.getAlbum(ctx, a.id)).total, 0);
  ctx.api.files = { ...ctx.api.files, owns: async () => { throw new Error("boum"); } };
  const b = await makeAlbum(ctx, { title: "B", n: 0 });
  assert.ok((await ops.deleteAlbum(ctx, b.id)).ok, "même si le cœur plante, la suppression des données réussit");
});

// ── Chaque raison de refus à l'envoi ────────────────────────────────────────────────────────────────────────────────

const REFUSALS = {
  expired: { uploads: (u) => [{ url: u, ageMs: 31 * 60_000 }], fr: /plus de 30 minutes.*Réessayer/, en: /more than 30 minutes.*Try again/ },
  taken: { uploads: (u) => [{ url: u, owner: "autre-module" }], fr: /déjà utilisé ailleurs/, en: /already used elsewhere/ },
  "not-uploader": { uploads: (u) => [{ url: u, by: "u2" }], fr: /envoyée par une autre personne/, en: /uploaded by someone else/ },
  quota: { uploads: (u) => [u], quota: { files: 0 }, fr: /place maximale sur le disque/, en: /maximum space on the disk/ },
  unknown: { uploads: () => [], fr: /ne retrouve pas cet envoi/, en: /cannot find this upload/ },
};

for (const [reason, spec] of Object.entries(REFUSALS)) {
  for (const locale of ["fr", "en"]) {
    test(`envoi refusé (${reason}, ${locale}) : phrase simple sous le fichier, rien n'est enregistré, rien n'est resté revendiqué`, async () => {
      const f = { full: uploadUrl(), thumb: uploadUrl() };
      const ctx = ctxFor({}, { locale, uploads: [...spec.uploads(f.full).map((x) => x), f.thumb], filesQuota: spec.quota ?? {} });
      const a = await makeAlbum(ctx);
      const r = await act(ctx, "addPhoto", photoFields(a.id, f));
      assert.equal(r.ok, undefined);
      assert.match(r.errors.photo, spec[locale]);
      assert.equal(r.error, r.errors.photo);
      assert.equal((await data.loadPhotos(ctx, await data.getAlbum(ctx, a.id))).length, 0, "aucune photo à moitié enregistrée");
      assert.equal(ctx.dumpFiles().filter((x) => x.owner === "me").length, 0, "rien n'est resté revendiqué");
    });
  }
}

test("envoi refusé pour la miniature seule : l'original déjà revendiqué est rendu (rien ne reste à moitié)", async () => {
  const f = { full: uploadUrl(), thumb: uploadUrl() };
  const ctx = ctxFor({}, { uploads: [f.full, { url: f.thumb, ageMs: 31 * 60_000 }] });
  const a = await makeAlbum(ctx);
  const r = await act(ctx, "addPhoto", photoFields(a.id, f));
  assert.match(r.errors.photo, /plus de 30 minutes/);
  assert.equal(ctx.dumpFiles().filter((x) => x.owner === "me").length, 0, "l'original revendiqué a été rendu, rien ne reste au module");
  assert.equal((await data.getAlbum(ctx, a.id)).total, 0);
  assert.deepEqual(ctx.calls.files.map((c) => c.op), ["claim", "claim", "remove"]);
});

test("envoi : invalid (adresse piégée), missing, no-person et no-permission ont leur phrase", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx);
  assert.match((await act(ctx, "addPhoto", photoFields(a.id, { full: "/uploads/../x.jpg" }))).errors.photo, /pas été reconnue comme une image envoyée/);
  // missing / no-person : le cœur répond, le module traduit.
  for (const [reason, re] of [["missing", /n'est plus sur le disque/], ["no-person", /depuis l'administration/]]) {
    const c = ctxFor();
    const b = await makeAlbum(c);
    c.api.files = { ...c.api.files, claim: async () => ({ ok: false, reason }) };
    const r = await act(c, "addPhoto", photoFields(b.id));
    assert.match(r.errors.photo, re, reason);
    assert.equal((await data.getAlbum(c, b.id)).total, 0);
  }
  // Sans la permission, le vrai faux-contexte répond no-permission.
  const bare = ctxFor({}, { permissions: manifest.permissions.filter((p) => p !== "files") });
  const album = await makeAlbum(bare);
  assert.equal(album.photos.length, 0);
  const r = await act(bare, "addPhoto", photoFields(album.id));
  assert.match(r.errors.photo, /n'a pas le droit de garder des fichiers/);
  // Réponse inattendue du cœur : phrase générale, jamais de plantage.
  const odd = ctxFor();
  const c2 = await makeAlbum(odd);
  odd.api.files = { ...odd.api.files, claim: async () => { throw new Error("x"); } };
  assert.match((await act(odd, "addPhoto", photoFields(c2.id))).errors.photo, /ne retrouve pas cet envoi/);
});

test("envoi : un fichier déjà gardé par une autre photo de ce module est un doublon et n'est jamais supprimé par cette tentative", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 1 });
  const b = await makeAlbum(ctx, { title: "Autre album" });
  const [p] = await data.loadPhotos(ctx, a.album);
  const r = await act(ctx, "addPhoto", photoFields(b.id, { full: p.full, thumb: p.thumb }));
  assert.match(r.errors.photo, /déjà dans l'album/);
  assert.ok(here(ctx, p.full) && here(ctx, p.thumb), "les fichiers de la première photo sont intacts");
  assert.equal(ctx.calls.files.filter((c) => c.op === "remove").length, 0);
});

test("envoi : une écriture qui échoue ne laisse ni photo à moitié enregistrée ni fichier revendiqué", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx);
  const f = photoFields(a.id);
  const realUpdate = ctx.api.store.update;
  ctx.api.store = { ...ctx.api.store, update: async () => { throw new Error("disque plein"); } };
  await assert.rejects(() => ops.addUploadedPhoto(ctx, a.id, { full: f.full, thumb: f.thumb }), /disque plein/);
  ctx.api.store = { ...ctx.api.store, update: realUpdate };
  assert.equal(ctx.dumpFiles().filter((x) => x.owner === "me").length, 0);
});

test("les phrases de refus existent en français ET en anglais, avec les mêmes clés ; le bouton « Réessayer » qu'elles citent existe", () => {
  const fr = messages("fr"), en = messages("en");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of ["errFileExpired", "errFileTaken", "errFileNotUploader", "errFileQuota", "errFileUnknown", "errFileMissing", "errFileNoPerson", "errFileNoPermission", "okFilesGonePhoto", "okFilesGoneAlbum", "okFilesOldPhoto", "okFilesOldAlbum", "okFilesFailed", "legacyPhotoNote"]) {
    assert.ok(fr[k] && en[k], k);
  }
  assert.equal(fr.studioRetry, "Réessayer");
  assert.equal(en.studioRetry, "Try again");
  assert.doesNotMatch(JSON.stringify(fr) + JSON.stringify(en), /le site de base ne sait pas|the core cannot|base site cannot/i);
});

test("neutralité : ni nom de site ni nom propre dans les textes ajoutés", () => {
  const added = ["errFileExpired", "errFileQuota", "okFilesOldAlbum", "legacyPhotoNote"].map((k) => messages("fr")[k] + messages("en")[k]).join(" ");
  assert.doesNotMatch(added, /helldog|rosalia|belgi|\.be\b/i);
});

test("après une suppression l'écran change : le résultat honnête voyage dans l'adresse et s'affiche en bandeau (le message de l'action serait perdu par la redirection)", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 1 });
  const old = await addLegacyPhoto(ctx, a.id);
  const [fresh] = await data.loadPhotos(ctx, a.album);
  const r1 = await act(ctx, "removePhoto", { id: `${a.id}.${fresh.id}` });
  assert.equal(r1.redirect, `?album=${a.id}&gone=p-2-0-0`);
  const banner = (blocks) => blocks.find((b) => b.type === "banner" && /supprimée/i.test(b.text));
  assert.match(banner(await def.adminPanel(ctx, { query: { album: a.id, gone: "p-2-0-0" } })).text, /Photo supprimée\. Ses fichiers ont été effacés du disque\./);
  const r2 = await act(ctx, "removePhoto", { id: `${a.id}.${old}` });
  assert.equal(r2.redirect, `?album=${a.id}&gone=p-0-2-0`);
  const b2 = banner(await def.adminPanel(ctx, { query: { album: a.id, gone: "p-0-1-0" } }));
  assert.match(b2.text, /avant la mise à jour du site : ce module ne peut pas effacer son fichier d'origine/);
  assert.equal(b2.tone, "info");
  const failed = banner(await def.adminPanel(ctx, { query: { gone: "p-0-0-2" } }));
  assert.equal(failed.tone, "warning");
  const r3 = await act(ctx, "removeAlbum", { id: a.id });
  assert.match(r3.redirect, /^\?gone=a-0-0-0$/);
  // Une valeur piégée dans l'adresse ne fabrique aucun bandeau.
  for (const bad of ["<script>", "p-1-2", "x-1-1-1", "p-99999-0-0", "p-1-1-1-1", "", undefined]) {
    assert.equal((await def.adminPanel(ctx, { query: { gone: bad } })).some((b) => b.type === "banner" && /supprim/i.test(b.text)), false, String(bad));
  }
});

test("les textes visibles n'emploient pas « ancien » ni « legacy » (règle du dépôt) et ne citent aucun nom propre", () => {
  const all = { ...messages("fr"), ...messages("en") };
  for (const [k, v] of Object.entries(messages("fr")).concat(Object.entries(messages("en")))) {
    if (!/^(err|ok|legacy|confirm|act)/.test(k) && k !== "legacyPhotoNote") continue;
    assert.doesNotMatch(String(v), /\b(ancien\w*|legacy|older|old)\b/i, k);
  }
  assert.ok(all.legacyPhotoNote);
});
