// Vidéothèque : le service offert `videos.library` (lecture seule, version 1). Le même contrat est vérifié sur la vraie vidéothèque ET sur son faux fournisseur.
import test from "node:test";
import assert from "node:assert/strict";
import { manifest, seedCategory, id } from "./helpers/videosKit.mjs";
import { makeLibrary, fakeVideosProvider } from "./helpers/fakeVideos.mjs";

async function realWith(n) {
  const lib = makeLibrary();
  const cat = await seedCategory(lib.ctx, "Masterclass");
  await lib.add(Array.from({ length: n }, (_, i) => ({ ext: id(i + 1), title: `Atelier ${i + 1}`, date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, cat: i % 2 ? cat : 0 })));
  return lib;
}
const fakeWith = (n) => fakeVideosProvider(Array.from({ length: n }, (_, i) => ({ id: i + 1, title: `Atelier ${i + 1}`, url: `/videos/v/${i + 1}-atelier`, thumb: `/m/x/thumb?v=${i + 1}`, category: i % 2 ? "masterclass" : "" })));

for (const [name, make] of [["la vraie vidéothèque", async () => (await realWith(75)).methods], ["le faux fournisseur", async () => fakeWith(75)]]) {
  test(`contrat videos.library sur ${name} : forme, bornes, curseur sans trou ni doublon`, async () => {
    const m = await make();
    const first = await m.list({});
    assert.equal(first.ok, true); assert.equal(first.items.length, 20); assert.equal(typeof first.next, "string");
    for (const it of first.items) {
      assert.equal(typeof it.id, "string"); assert.equal(typeof it.title, "string"); assert.match(it.url, /^\//);
      assert.ok(it.thumb === undefined || /^\//.test(it.thumb));
      assert.ok(Object.keys(it).every((k) => ["id", "title", "thumb", "url"].includes(k)));
    }
    assert.equal((await m.list({ limit: 1000 })).items.length, 50); assert.equal((await m.list({ limit: 0 })).items.length, 1); assert.equal((await m.list({ limit: "7" })).items.length, 7);
    const seen = [];
    let cursor;
    for (let guard = 0; guard < 10; guard++) {
      const page = await m.list({ limit: 30, ...(cursor ? { cursor } : {}) });
      seen.push(...page.items.map((x) => x.id));
      if (!page.next) break;
      cursor = page.next;
    }
    assert.equal(seen.length, 75); assert.equal(new Set(seen).size, 75);
    assert.equal((await m.get({ id: seen[3] })).item?.id, seen[3]);
    assert.deepEqual(await m.get({ id: "999999" }), { ok: true, item: null });
  });
}

test("vraie vidéothèque : seules les vidéos publiées, recherche, catégorie (nom, numéro ou morceau d'adresse), curseur invalide", async () => {
  const lib = makeLibrary();
  const cat = await seedCategory(lib.ctx, "Masterclass");
  const [a, , c] = await lib.add([{ ext: id(1), title: "Éclairage", cat }, { ext: id(2), title: "Brouillon", status: "draft" }, { ext: id(3), title: "Cadrage" }, { ext: id(4), title: "Masquée", status: "hidden" }]);
  const m = lib.methods;
  assert.deepEqual((await m.list({})).items.map((x) => x.title).sort(), ["Cadrage", "Éclairage"]);
  assert.deepEqual((await m.list({ q: "eclairage" })).items.map((x) => x.title), ["Éclairage"]);
  for (const ref of ["masterclass", "Masterclass", String(cat)]) assert.deepEqual((await m.list({ category: ref })).items.map((x) => x.id), [String(a.n)], ref);
  assert.deepEqual((await m.list({ category: "inconnue" })).items, []); assert.deepEqual((await m.list({ cursor: "oups" })).items, []);
  assert.equal((await m.get({ id: String(c.n) })).item.title, "Cadrage"); assert.equal((await m.get({ id: "2" })).item, null); assert.deepEqual((await m.get({ id: "abc" })).item, null);
  assert.deepEqual(await m.list(null), await m.list({}));
  const item = (await m.get({ id: String(a.n) })).item;
  assert.equal(item.url, `/videos/v/${a.n}-eclairage`); assert.equal(item.thumb, undefined);
});

test("le service est déclaré en lecture seule, version 1, une réponse par instance", () => {
  const offer = manifest.offers.find((o) => o.service === "videos.library");
  assert.deepEqual([offer.version, offer.each, offer.readOnly], [1, true, ["list", "get"]]);
});

test("les pannes du faux fournisseur existent pour tester les consommateurs", async () => {
  await assert.rejects(() => fakeVideosProvider.failing().list({}));
  assert.equal(typeof (await fakeVideosProvider.garbled().list({})), "string");
  assert.ok(fakeVideosProvider.slow(10).list);
});
