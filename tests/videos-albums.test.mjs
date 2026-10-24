// Vidéothèque : le lien FACULTATIF avec un module de galeries (`gallery.albums`). Absent, en panne, lent, illisible : la page de la vidéo s'affiche toujours.
import test from "node:test";
import assert from "node:assert/strict";
import { ctxFor, def, Albums, seedVideos, id } from "./helpers/videosKit.mjs";

const album = (n = 1) => ({ id: `a${n}`, title: `Rétrospective <${n}>`, count: 24, url: `/galerie/a${n}` });
const gallery = (albums) => ({ list: async ({ q } = {}) => ({ ok: true, albums: albums.filter((a) => !q || a.title.includes(q)) }), get: async ({ id } = {}) => ({ ok: true, album: albums.find((a) => a.id === id) ?? null }) });
const withGallery = (g) => ctxFor({}, { services: g ? { "gallery.albums": g } : {} });
const watch = async (ctx, albumId) => { const [v] = await seedVideos(ctx, [{ ext: id(1), title: "Atelier", album: albumId }]); return def.page(ctx, { segments: ["v", String(v.n)] }); };

test("album relié : un lien vers la galerie, texte échappé", async () => {
  Albums.resetAlbums();
  assert.match((await watch(withGallery(gallery([album(1)])), "a1")).blocks[0].html, /href="\/galerie\/a1">📷 Voir les photos : Rétrospective &lt;1&gt;<\/a>/);
});

test("pas de galerie installée : la page s'affiche sans le lien, l'administration invite à en installer une (facultatif)", async () => {
  Albums.resetAlbums();
  const ctx = withGallery(null);
  const r = await watch(ctx, "a1");
  assert.ok(r.blocks[0].html.includes("Atelier") && !r.blocks[0].html.includes("Voir les photos"));
  const panel = await def.adminPanel(ctx, { query: { edit: "1" } });
  assert.ok(panel.some((b) => b.type === "suggestInstall" && b.service === "gallery.albums"));
  assert.ok(!panel.find((b) => b.action === "save").fields.some((f) => f.name === "album" && f.kind === "select"));
});

test("galerie en panne, lente ou illisible : jamais d'erreur ni d'attente longue", async () => {
  const saved = Albums.timing.waitMs;
  Albums.timing.waitMs = 60;
  try {
    const cases = {
      panne: { list: async () => { throw new Error("boom"); }, get: async () => { throw new Error("boom"); } },
      lente: { list: () => new Promise((r) => setTimeout(r, 5000)), get: () => new Promise((r) => setTimeout(r, 5000)) },
      illisible: { list: async () => "pas du json", get: async () => ({ ok: true, album: { title: 42, url: "javascript:alert(1)" } }) },
      "adresse dangereuse": gallery([{ id: "a1", title: "X", count: 1, url: "javascript:alert(1)" }]),
      vide: { list: async () => null, get: async () => null },
    };
    for (const [name, g] of Object.entries(cases)) {
      Albums.resetAlbums();
      const ctx = withGallery(g);
      const t0 = Date.now();
      const r = await watch(ctx, "a1");
      assert.ok(Date.now() - t0 < 1500, `${name} : rapide`);
      assert.ok(r.blocks[0].html.includes("Atelier") && !r.blocks[0].html.includes("Voir les photos") && !r.blocks[0].html.includes("javascript:"), name);
      assert.ok((await def.adminPanel(ctx, { query: { edit: "1" } })).length, `${name} : l'administration s'ouvre`);
    }
  } finally { Albums.timing.waitMs = saved; }
});

test("album disparu de la galerie : plus de lien ; dernier album connu gardé quand la galerie se tait", async () => {
  Albums.resetAlbums();
  let up = true;
  const g = { list: async () => ({ ok: true, albums: [album(1)] }), get: async ({ id }) => { if (!up) throw new Error("down"); return { ok: true, album: id === "a1" ? album(1) : null }; } };
  const ctx = withGallery(g);
  const [v] = await seedVideos(ctx, [{ ext: id(1), title: "A", album: "a1" }, { ext: id(2), title: "B", album: "a2" }]);
  assert.match((await def.page(ctx, { segments: ["v", String(v.n)] })).blocks[0].html, /Voir les photos/);
  Albums.timing.freshMs = 0; up = false;
  try { assert.match((await def.page(ctx, { segments: ["v", String(v.n)] })).blocks[0].html, /Voir les photos/); } finally { Albums.timing.freshMs = 60_000; }
  up = true;
  assert.ok(!(await def.page(ctx, { segments: ["v", String(v.n + 1)] })).blocks[0].html.includes("Voir les photos"));
});

test("l'administration propose les albums (100 au plus) et garde l'album choisi même s'il est introuvable", async () => {
  Albums.resetAlbums();
  const many = Array.from({ length: 80 }, (_, i) => album(i + 1));
  const g = { list: async ({ cursor } = {}) => (cursor ? { ok: true, albums: many.slice(50, 80) } : { ok: true, albums: many.slice(0, 50), next: "c2" }), get: async () => ({ ok: true, album: null }) };
  const ctx = withGallery(g);
  const [v] = await seedVideos(ctx, [{ ext: id(1), title: "A", album: "disparu" }]);
  const select = (await def.adminPanel(ctx, { query: { edit: String(v.n) } })).find((b) => b.action === "save").fields.find((f) => f.name === "album");
  assert.equal(select.options.length, 82); assert.equal(select.options.at(-1).value, "disparu");
  assert.ok((await def.adminActions.save.run(ctx, { id: String(v.n), title: "A", album: "a5", state: "published" })).ok);
});
