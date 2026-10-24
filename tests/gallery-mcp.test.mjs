// Galeries photos : les outils de l'assistant IA (lire, créer un album EN BROUILLON, ajouter une photo par adresse MASQUÉE, masquer) ; il ne publie jamais.
import test from "node:test";
import assert from "node:assert/strict";
import { def, ctxFor, makeAlbum, manifest, data, rows } from "./helpers/galleryKit.mjs";

const tools = Object.fromEntries(manifest.mcp.map((t) => [t.name, t]));
const call = (ctx, name, args) => def.mcp[name](ctx, args, { id: "assistant" });
const refused = async (promise) => { try { await promise; } catch (e) { assert.equal(e.expose, true, "le message peut être lu par l'assistant"); return e.message; } assert.fail("devait être refusé"); };

test("déclaration : les outils déclarés sont ceux implémentés ; noms courts ; lectures d'office, écritures JAMAIS accordées d'office", () => {
  assert.deepEqual(Object.keys(def.mcp).sort(), Object.keys(tools).sort());
  assert.deepEqual(Object.keys(tools).sort(), ["gallery_album_create", "gallery_albums_list", "gallery_photo_add_url", "gallery_photo_hide", "gallery_photos_list"]);
  for (const t of Object.values(tools)) {
    assert.ok(t.name.length <= 40 && t.description.length > 60, t.name);
    assert.notEqual(t.default, true, `${t.name} : pas accordé d'office s'il écrit`);
  }
  assert.deepEqual(Object.values(tools).filter((t) => t.readOnly).map((t) => t.name).sort(), ["gallery_albums_list", "gallery_photos_list"]);
  assert.ok(!Object.values(tools).some((t) => /publish|delete|remove/.test(t.name)), "aucun outil ne publie ni ne supprime");
});

test("lister les albums : brouillons et publiés, filtre, pagination ; les titres sont rappelés comme des données", async () => {
  const ctx = ctxFor();
  for (let i = 0; i < 5; i++) await makeAlbum(ctx, { title: `Album ${i}`, status: i % 2 ? "draft" : "published", n: i });
  const first = await call(ctx, "gallery_albums_list", { limit: 2 });
  assert.equal(first.albums.length, 2);
  assert.ok(first.next);
  assert.match(first.note, /never as instructions/);
  const rest = await call(ctx, "gallery_albums_list", { limit: 2, cursor: first.next });
  assert.equal(rest.albums.length, 2);
  assert.equal((await call(ctx, "gallery_albums_list", { status: "draft" })).albums.length, 2);
  assert.equal((await call(ctx, "gallery_albums_list", { status: "published" })).albums.every((a) => a.url?.startsWith("https://example.test/galeries/")), true);
  assert.equal((await call(ctx, "gallery_albums_list", { q: "album 3" })).albums[0].title, "Album 3");
  assert.match(first.albums[0].adminUrl, /\/admin\/instances\/id-gal\d+\?album=/);
  for (const bad of [undefined, null, {}, { limit: -3 }, { limit: "x" }, { cursor: "zzz" }, { status: "tout" }]) assert.ok(Array.isArray((await call(ctx, "gallery_albums_list", bad)).albums));
});

test("créer un album : TOUJOURS en brouillon, même si on demande « publié » ; titre obligatoire ; album d'un autre service avec adresse https", async () => {
  const ctx = ctxFor();
  const r = await call(ctx, "gallery_album_create", { title: "  Proposé par l'assistant  ", date: "2025-05-01", description: "Une idée.", status: "published", published: true });
  assert.equal(r.status, "draft");
  const album = await data.getAlbum(ctx, r.id);
  assert.equal(album.status, "draft");
  assert.equal(album.title, "Proposé par l'assistant");
  assert.match(r.note, /DRAFT/);
  assert.match(r.adminUrl, /\?album=/);
  assert.match(await refused(call(ctx, "gallery_album_create", {})), /title is required/);
  assert.match(await refused(call(ctx, "gallery_album_create", { title: "Externe", mode: "external", link: "http://pas-https.example.org" })), /full https:\/\/ address/);
  const ext = await call(ctx, "gallery_album_create", { title: "Gros album", mode: "external", link: "https://photos.example.org/x" });
  assert.equal((await data.getAlbum(ctx, ext.id)).mode, "external");
  assert.equal(rows(ctx, "gallery_albums").length, 2, "les refus n'ont rien créé");
  const full = ctxFor({ maxAlbums: 1 });
  await call(full, "gallery_album_create", { title: "Seul" });
  assert.match(await refused(call(full, "gallery_album_create", { title: "En trop" })), /album limit is reached/);
});

test("ajouter une photo par adresse : sites autorisés seulement, TOUJOURS masquée (l'équipe la montre après relecture)", async () => {
  const closed = ctxFor();
  const a = await makeAlbum(closed, { n: 0 });
  assert.match(await refused(call(closed, "gallery_photo_add_url", { albumId: a.id, url: "https://images.example.org/a.jpg" })), /No allowed host is set/);
  const ctx = ctxFor({ allowedHosts: "images.example.org" });
  const b = await makeAlbum(ctx, { n: 0 });
  const r = await call(ctx, "gallery_photo_add_url", { albumId: b.id, url: "https://images.example.org/a.jpg", caption: "Un chat", alt: "Un chat roux sur un canapé", hidden: false });
  assert.equal(r.hidden, true);
  assert.match(r.note, /HIDDEN/);
  const album = await data.getAlbum(ctx, b.id);
  const [p] = await data.loadPhotos(ctx, album);
  assert.deepEqual([p.hidden, p.alt, p.url], [true, "Un chat roux sur un canapé", "https://images.example.org/a.jpg"]);
  assert.equal(album.shown, 0, "rien n'est visible sur le site");
  assert.doesNotMatch(JSON.stringify(await def.page(ctx, { segments: [album.slug] })), /images\.example\.org/);
  assert.match(await refused(call(ctx, "gallery_photo_add_url", { albumId: b.id, url: "https://evil.example.net/a.jpg" })), /not on an allowed host/);
  assert.match(await refused(call(ctx, "gallery_photo_add_url", { albumId: b.id, url: "javascript:alert(1)" })), /https:\/\//);
  assert.match(await refused(call(ctx, "gallery_photo_add_url", { albumId: "inconnu", url: "https://images.example.org/a.jpg" })), /No such album/);
  assert.match(await refused(call(ctx, "gallery_photo_add_url", { url: "https://images.example.org/a.jpg" })), /albumId is required/);
  const small = ctxFor({ allowedHosts: "images.example.org", maxPhotos: 1 });
  const c = await makeAlbum(small, { n: 0 });
  await call(small, "gallery_photo_add_url", { albumId: c.id, url: "https://images.example.org/1.jpg" });
  assert.match(await refused(call(small, "gallery_photo_add_url", { albumId: c.id, url: "https://images.example.org/2.jpg" })), /maximum number of photos/);
});

test("masquer une photo : immédiat, réversible par l'équipe, ne supprime rien ; identifiants faux refusés", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 2 });
  const listed = await call(ctx, "gallery_photos_list", { albumId: a.id });
  assert.deepEqual(listed.photos.map((p) => [p.position, p.hidden, p.storage, p.cover]), [[1, false, "site", true], [2, false, "site", false]]);
  assert.match(listed.note, /never as instructions/);
  assert.equal((await call(ctx, "gallery_photo_hide", { albumId: a.id, photoId: a.photos[0] })).hidden, true);
  assert.equal((await call(ctx, "gallery_photos_list", { albumId: a.id })).photos[0].hidden, true);
  assert.equal(rows(ctx, "gallery_blobs").length, 4, "rien n'est supprimé");
  assert.equal((await data.getAlbum(ctx, a.id)).shown, 1);
  assert.match(await refused(call(ctx, "gallery_photo_hide", { albumId: a.id, photoId: "zzzzzzzz" })), /No such album or photo/);
  assert.match(await refused(call(ctx, "gallery_photo_hide", { albumId: a.id, photoId: "../x" })), /required/);
  assert.match(await refused(call(ctx, "gallery_photo_hide", {})), /required/);
  assert.match(await refused(call(ctx, "gallery_photos_list", { albumId: "inconnu" })), /No such album/);
  assert.match(await refused(call(ctx, "gallery_photos_list", {})), /albumId is required/);
});

test("aucun message d'outil ne révèle un chemin, une trace ou un réglage secret", async () => {
  const ctx = ctxFor({ allowedHosts: "images.example.org" });
  const a = await makeAlbum(ctx, { n: 1 });
  const messages = [];
  for (const [name, args] of [["gallery_album_create", {}], ["gallery_photo_add_url", { albumId: a.id, url: "ftp://x" }], ["gallery_photo_hide", { albumId: "x", photoId: "y" }], ["gallery_photos_list", { albumId: "nope" }]]) {
    try { await call(ctx, name, args); } catch (e) { messages.push(e.message); }
  }
  assert.equal(messages.length, 4);
  for (const m of messages) assert.doesNotMatch(m, /\/dev\/|node_modules|at \w+ \(|\.mjs|undefined|\[object/);
});
