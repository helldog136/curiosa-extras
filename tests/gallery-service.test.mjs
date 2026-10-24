// Galeries photos : le service « gallery.albums » (version 1, lecture seule) et son faux fournisseur de test ;
// un consommateur de référence (`readAlbums`) vérifie « absent / en panne / lent / réponse illisible ».
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { def, ctxFor, makeAlbum, manifest, ops, data } from "./helpers/galleryKit.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { ALBUM, cleanAlbum, fakeGalleryAlbums, fakeGalleryInstances, readAlbums } from "./helpers/fakeGallery.mjs";

const svc = def.services["gallery.albums"];
/** Un consommateur qui appelle le VRAI fournisseur (le service reçoit le contexte du fournisseur, pas celui de l'appelant). */
const consumerOf = (provider) => fakeCtx({ key: "events", services: { "gallery.albums": { list: (a) => svc.list(provider, a), get: (a) => svc.get(provider, a) } } });

test("contrat : offert en version 1, une réponse par instance (plusieurs galeries), seules méthodes list et get, en lecture seule", () => {
  const offer = manifest.offers.find((o) => o.service === "gallery.albums");
  assert.deepEqual([offer.version, offer.each, offer.readOnly], [1, true, ["list", "get"]]);
  assert.ok(offer.label.fr && offer.label.en);
  assert.equal(manifest.instances, "multiple");
  assert.deepEqual(Object.keys(svc).sort(), ["get", "list"]);
  assert.equal(manifest.requires.find((r) => r.service === "contact.store").optional, true, "seul besoin : facultatif");
});

test("list : seulement les albums publiés, avec id, titre, couverture complète, nombre de photos visibles et adresse complète", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { title: "Soirée de printemps", n: 3, hidden: [2] });
  await makeAlbum(ctx, { title: "Brouillon", n: 1, status: "draft" });
  const ext = await makeAlbum(ctx, { title: "Gros album", mode: "external", link: "https://photos.example.org/x" });
  const r = await svc.list(ctx, {});
  assert.equal(r.ok, true);
  assert.equal(r.next, undefined);
  assert.equal(r.albums.length, 2);
  const mine = r.albums.find((x) => x.id === a.id);
  assert.deepEqual(Object.keys(mine).sort(), ["count", "cover", "id", "title", "url"]);
  assert.equal(mine.count, 2, "les photos masquées ne comptent pas");
  assert.equal(mine.url, "https://example.test/galeries/soiree-de-printemps");
  assert.match(mine.cover, /^https:\/\/example\.test\/uploads\/[0-9a-f-]{36}\.jpg\?c=o_1_0\.5_0\.5_ffffff$/);
  const other = r.albums.find((x) => x.id === ext.id);
  assert.equal(other.count, 0, "une carte vers un autre service n'a pas de photos chez nous");
  assert.equal(other.url, "https://example.test/galeries/gros-album", "l'adresse est celle de la page du site, qui dit qu'on le quitte");
  assert.equal(r.albums.some((x) => x.title === "Brouillon"), false);
  assert.ok(r.albums.every((x) => cleanAlbum(x)), "chaque album passe la validation de référence d'un consommateur");
});

test("list : pagination par curseur, recherche sans accents, bornes de la taille de page, arguments absurdes", async () => {
  const ctx = ctxFor();
  for (let i = 0; i < 7; i++) await makeAlbum(ctx, { title: i === 3 ? "Été à la mer" : `Album ${i}`, date: `2025-01-0${i + 1}` });
  const seen = [];
  let cursor;
  let pages = 0;
  do {
    const r = await svc.list(ctx, { limit: 3, cursor });
    seen.push(...r.albums.map((a) => a.title));
    cursor = r.next;
    pages++;
  } while (cursor && pages < 10);
  assert.equal(pages, 3);
  assert.equal(new Set(seen).size, 7);
  assert.deepEqual((await svc.list(ctx, { q: "ete a la" })).albums.map((a) => a.title), ["Été à la mer"]);
  assert.equal((await svc.list(ctx, { limit: 0 })).albums.length, 1, "au moins 1");
  assert.equal((await svc.list(ctx, { limit: 1e9 })).albums.length, 7, "50 au plus");
  for (const args of [undefined, null, 42, "texte", [], { limit: "beaucoup" }, { cursor: "pas un curseur" }, { cursor: "99999999" }, { q: {} }]) {
    const r = await svc.list(ctx, args);
    assert.equal(r.ok, true, JSON.stringify(args));
    assert.ok(Array.isArray(r.albums));
  }
});

test("get : un album publié, null pour un brouillon, un inconnu ou n'importe quoi ; jamais d'exception", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 2 });
  const d = await makeAlbum(ctx, { title: "Brouillon", status: "draft" });
  assert.equal((await svc.get(ctx, a.id)).album.id, a.id, "l'identifiant seul");
  assert.equal((await svc.get(ctx, { id: a.id })).album.title, "Soirée de printemps");
  assert.deepEqual(await svc.get(ctx, d.id), { ok: true, album: null });
  for (const bad of ["inconnu", "", "../x", undefined, null, 42, [], {}, { id: {} }, `${a.id}.extra`]) assert.deepEqual(await svc.get(ctx, bad), { ok: true, album: null }, JSON.stringify(bad));
  const photosRow = ctx.dumpStore().find((r) => r.collection === "gallery_photos");
  assert.deepEqual(await svc.get(ctx, photosRow.id), { ok: true, album: null }, "la ligne d'une autre sorte n'est pas un album");
});

test("lecture seule : appeler le service ne modifie rien dans le stockage", async () => {
  const ctx = ctxFor();
  await makeAlbum(ctx, { n: 2 });
  const before = JSON.stringify(ctx.dumpStore());
  const writes = ctx.calls.writes.length;
  await svc.list(ctx, {});
  await svc.get(ctx, "x");
  assert.equal(JSON.stringify(ctx.dumpStore()), before);
  assert.equal(ctx.calls.writes.length, writes);
});

test("pas de lancer : si le stockage répond mal, { ok: false, error: \"busy\" } (le contrat des services du carnet d'adresses)", async () => {
  const ctx = ctxFor();
  ctx.api.store = { count: async () => { throw new Error("base fermée"); }, list: async () => { throw new Error("x"); }, get: async () => { throw new Error("x"); } };
  assert.deepEqual(await svc.list(ctx, {}), { ok: false, error: "busy" });
  assert.deepEqual(await svc.get(ctx, "abc"), { ok: false, error: "busy" });
});

test("plusieurs instances (portfolio, événements) : chacune répond pour elle-même", async () => {
  const portfolio = ctxFor();
  const events = ctxFor();
  await makeAlbum(portfolio, { title: "Projet A" });
  await makeAlbum(events, { title: "Fête 1" });
  await makeAlbum(events, { title: "Fête 2" });
  assert.deepEqual((await svc.list(portfolio, {})).albums.map((a) => a.title), ["Projet A"]);
  assert.equal((await svc.list(events, {})).albums.length, 2);
  const ctxA = fakeCtx({ serviceInstances: { "gallery.albums": [{ instance: "portfolio", methods: { list: (a) => svc.list(portfolio, a) } }, { instance: "events", methods: { list: (a) => svc.list(events, a) } }] } });
  const all = await ctxA.api.services.callAll("gallery.albums", "list", {});
  assert.deepEqual(all.map((x) => x.value.albums.length), [1, 2]);
});

test("faux fournisseur : même contrat que le vrai, mêmes formes de réponse", async () => {
  const fake = fakeCtx({ services: fakeGalleryAlbums({ albums: [ALBUM, { ...ALBUM, id: "c2", title: "Autre" }] }) });
  const r = await readAlbums(fake, {});
  assert.equal(r.state, "ok");
  assert.deepEqual(r.albums[0], ALBUM);
  assert.equal((await readAlbums(fake, { q: "autre" })).albums.length, 1);
  assert.equal((await readAlbums(fake, "c1abc", { method: "get" })).album.title, "Soirée de printemps");
  assert.equal((await readAlbums(fake, "inconnu", { method: "get" })).album, null);
  const real = ctxFor();
  await makeAlbum(real, { n: 1 });
  const viaReal = await readAlbums(consumerOf(real), {});
  assert.equal(viaReal.state, "ok");
  assert.deepEqual(Object.keys(viaReal.albums[0]).sort(), Object.keys(r.albums[0]).sort());
});

test("consommateur de référence : fournisseur absent, en panne, occupé, illisible, vide : un état clair, jamais d'exception", async () => {
  assert.equal((await readAlbums(fakeCtx({}), {})).state, "absent");
  for (const [mode, state] of [["down", "down"], ["busy", "down"], ["garbage", "unreadable"], ["empty", "ok"]]) {
    const r = await readAlbums(fakeCtx({ services: fakeGalleryAlbums({ mode }) }), {});
    assert.equal(r.state, state, mode);
    assert.deepEqual(r.albums, [], mode);
  }
  const mixed = await readAlbums(fakeCtx({ services: fakeGalleryAlbums({ mode: "garbage-fields" }) }), {});
  assert.equal(mixed.state, "ok");
  assert.deepEqual(mixed.albums.map((a) => a.id), ["ok1"], "seuls les albums valables sont gardés (adresse dangereuse, types faux, nulls : écartés)");
});

test("consommateur de référence : un fournisseur lent est abandonné au bout du délai", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const pending = readAlbums(fakeCtx({ services: fakeGalleryAlbums({ mode: "slow" }) }), {}, { timeoutMs: 2000 });
    for (let i = 0; i < 25; i++) { await new Promise((resolve) => setImmediate(resolve)); mock.timers.tick(100); }
    assert.equal((await pending).state, "slow");
  } finally { mock.timers.reset(); }
});

test("plusieurs fournisseurs fictifs : callAll rend une réponse par instance, dont une en panne", async () => {
  const ctx = fakeCtx({ serviceInstances: fakeGalleryInstances({ portfolio: { albums: [ALBUM] }, evenements: { mode: "down" } }) });
  const all = await ctx.api.services.callAll("gallery.albums", "list", {});
  assert.equal(all.length, 2);
  assert.equal(all[0].ok, true);
  assert.equal(all[1].ok, false);
});

test("un album créé par l'assistant ou en brouillon n'apparaît jamais dans le service", async () => {
  const ctx = ctxFor();
  const made = await ops.createAlbum(ctx, { title: "Proposé", status: "published" }, { by: "assistant" });
  assert.equal((await data.getAlbum(ctx, made.id)).status, "draft");
  assert.equal((await svc.list(ctx, {})).albums.length, 0);
  assert.equal((await svc.get(ctx, made.id)).album, null);
});
