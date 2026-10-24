// Événements : les liens FACULTATIFS avec la galerie photo (gallery.albums) et la bibliothèque de vidéos (videos.library).
// Chaque service est essayé absent, en panne, lent, muet et illisible : la page reste correcte et ne dépasse jamais son délai.
import test from "node:test";
import assert from "node:assert/strict";
import { ctxFor, addEvent, html, L, A, rows } from "./helpers/eventsKit.mjs";
import { fakeGallery } from "./helpers/fakeGalleryEvents.mjs";
import { fakeVideos } from "./helpers/fakeVideosEvents.mjs";

const ALBUMS = [{ id: "a1", title: "Soirée d'ouverture", count: 24, url: "/galerie/ouverture" }, { id: "a2", title: "Atelier d'été", count: 8, url: "https://photos.example.org/ete" }];
const VIDEOS = [{ id: "v1", title: "Masterclass d'ouverture", url: "/videos/ouverture" }];
const past = (extra = {}) => ({ slug: "passe", title: "Soirée passée", date: "2020-06-10", ...extra });
const quick = () => { L.timing.callMs = 150; L.timing.failMs = 10_000; L.forgetLinks(); };
const UNAVAILABLE = /ne sont pas disponibles pour l(?:'|&#39;)instant/;

test("album lié : le bouton « Voir les photos » apparaît sur la fiche d'un événement passé, relu chez la galerie (rien n'est recopié)", async () => {
  quick();
  const g = fakeGallery({ albums: ALBUMS });
  const ctx = ctxFor({}, { services: g.services });
  const id = await addEvent(ctx, past({ albumId: "a1" }));
  const h = await html(ctx, ["e", "passe"]);
  assert.match(h, /<a class="ev-btn ev-btn-main" href="\/galerie\/ouverture">Voir les photos : Soirée d&#39;ouverture<\/a>/);
  assert.match(h, /<h2 class="ev-h">Souvenirs<\/h2>/);
  const stored = rows(ctx, "ev_events").find((r) => r.id === id);
  assert.equal(stored.albumId, "a1");
  assert.ok(!JSON.stringify(stored).includes("galerie"));
  const calls = g.calls.length;
  await html(ctx, ["e", "passe"]);
  assert.equal(g.calls.length, calls, "relu au plus toutes les 5 minutes");
});

test("album : pas de souvenirs avant la fin de l'événement, ni pour un événement annulé", async () => {
  quick();
  const ctx = ctxFor({}, { services: fakeGallery({ albums: ALBUMS }).services });
  await addEvent(ctx, { slug: "futur", title: "Futur", date: "2031-06-10", albumId: "a1" });
  await addEvent(ctx, past({ slug: "annule", state: "cancelled", albumId: "a1" }));
  assert.ok(!(await html(ctx, ["e", "futur"])).includes("Souvenirs"));
  assert.ok(!(await html(ctx, ["e", "annule"])).includes("Souvenirs"));
});

test("album : absent, en panne, muet, lent, illisible → la page s'affiche quand même, vite, avec une phrase honnête", async () => {
  for (const fault of ["absent", "throw", "hang", "slow", "garbage", "notOk"]) {
    quick();
    const g = fakeGallery({ albums: ALBUMS });
    if (fault !== "absent") { if (fault === "slow") g.faults.slow.set("get", 2000); else g.faults[fault].add("get"); }
    const ctx = ctxFor({}, { services: fault === "absent" ? {} : g.services });
    await addEvent(ctx, past({ albumId: "a1" }));
    const t0 = Date.now();
    const h = await html(ctx, ["e", "passe"]);
    assert.ok(Date.now() - t0 < 1500, `${fault} : la page n'attend pas sans fin (${Date.now() - t0} ms)`);
    assert.match(h, /Soirée passée/);
    assert.ok(!h.includes("Voir les photos"), fault);
    if (fault !== "absent") assert.match(h, UNAVAILABLE, `${fault} : dit la vérité`);
  }
});

test("album : un lien libre sert quand le service ne répond pas ; un album supprimé ne casse rien", async () => {
  quick();
  const g = fakeGallery({ albums: ALBUMS });
  g.faults.hang.add("get");
  const ctx = ctxFor({}, { services: g.services });
  await addEvent(ctx, past({ albumId: "a1", albumLink: "https://photos.example.org/mes-photos" }));
  const h = await html(ctx, ["e", "passe"]);
  assert.match(h, /href="https:\/\/photos\.example\.org\/mes-photos">Voir les photos</);
  assert.ok(!h.includes("ne sont pas disponibles"));
  quick();
  const ok = ctxFor({}, { services: fakeGallery({ albums: [] }).services });
  await addEvent(ok, past({ albumId: "disparu" }));
  const h2 = await html(ok, ["e", "passe"]);
  assert.match(h2, /Soirée passée/); assert.ok(!h2.includes("Souvenirs"));
  const free = ctxFor();
  await addEvent(free, past({ albumLink: "javascript:alert(1)" }));
  assert.ok(!(await html(free, ["e", "passe"])).includes("javascript:"));
});

test("panne retenue une minute : une page n'attend pas à chaque visite un service qui ne répond pas", async () => {
  quick();
  const g = fakeGallery({ albums: ALBUMS });
  g.faults.hang.add("get");
  const ctx = ctxFor({}, { services: g.services });
  await addEvent(ctx, past({ albumId: "a1" }));
  await html(ctx, ["e", "passe"]);
  const t0 = Date.now();
  await html(ctx, ["e", "passe"]);
  assert.ok(Date.now() - t0 < 100);
  assert.equal(g.calls.filter(([m]) => m === "get").length, 1);
});

test("vidéo de la bibliothèque : retrouvée par son identifiant, jamais recopiée ; panne = phrase honnête", async () => {
  quick();
  const v = fakeVideos({ items: VIDEOS });
  const ctx = ctxFor({}, { services: v.services });
  await addEvent(ctx, past({ videoId: "v1", videoHint: "Masterclass" }));
  assert.match(await html(ctx, ["e", "passe"]), /href="\/videos\/ouverture">Voir la vidéo : Masterclass d&#39;ouverture</);
  for (const fault of ["throw", "hang", "garbage", "notOk"]) {
    quick();
    const bad = fakeVideos({ items: VIDEOS });
    bad.faults[fault].add("list");
    const c = ctxFor({}, { services: bad.services });
    await addEvent(c, past({ videoId: "v1" }));
    const out = await html(c, ["e", "passe"]);
    assert.match(out, /Soirée passée/); assert.match(out, UNAVAILABLE, fault);
  }
});

test("modules de liaison : réponses lues champ par champ (adresse dangereuse, identifiant bizarre, trop long)", async () => {
  quick();
  const g = fakeGallery({ albums: [{ id: "ok", title: "Bon", count: 3, url: "/g/ok" }, { id: "x y", title: "Mauvais id", count: 1, url: "/g/x" }, { id: "dang", title: "Dangereux", count: 1, url: "javascript:alert(1)" }, { id: "t", title: "<b>Titre</b>", count: "beaucoup", url: "https://example.org/a" }] });
  const ctx = ctxFor({}, { services: g.services });
  const r = await L.albums(ctx);
  assert.equal(r.state, "ok");
  assert.deepEqual(r.albums.map((a) => a.id), ["ok", "t"]);
  assert.equal(r.albums[1].count, 0);
  assert.equal((await L.albumById(ctx, "x y")).album, null);
  const none = ctxFor();
  assert.equal((await L.albums(none)).state, "absent");
  assert.equal((await L.videos(none)).state, "absent");
});

test("administration : l'album se choisit dans une liste, le choix est gardé quand le service ne répond pas, un lien libre existe toujours", async () => {
  quick();
  const g = fakeGallery({ albums: ALBUMS });
  const v = fakeVideos({ items: VIDEOS });
  const ctx = ctxFor({}, { services: { ...g.services, ...v.services } });
  const id = await addEvent(ctx, past({ albumId: "a2" }));
  const blocks = await A.panel(ctx, { query: { edit: id, more: "1" } });
  const form = blocks.find((b) => b.type === "adminForm" && b.fields.some((f) => f.name === "albumId"));
  const albumField = form.fields.find((f) => f.name === "albumId");
  assert.equal(albumField.kind, "select"); assert.equal(albumField.value, "a2");
  assert.deepEqual(albumField.options.map((o) => o.value), ["", "a1", "a2"]);
  assert.ok(form.fields.some((f) => f.name === "albumLink" && f.kind === "url"));
  assert.equal(form.fields.find((f) => f.name === "videoId").kind, "select");
  quick();
  g.faults.hang.add("list");
  const down = await A.panel(ctx, { query: { edit: id, more: "1" } });
  const f2 = down.find((b) => b.type === "adminForm" && b.fields.some((f) => f.name === "albumLink"));
  assert.equal(f2.fields.find((f) => f.name === "albumId").kind, "hidden");
  assert.equal(f2.fields.find((f) => f.name === "albumId").value, "a2");
  assert.ok(down.some((b) => b.type === "banner" && /ne répondent pas/.test(b.text)));
  quick();
  const bare = ctxFor();
  const id3 = await addEvent(bare, past());
  const abs = await A.panel(bare, { query: { edit: id3, more: "1" } });
  assert.ok(abs.some((b) => b.type === "suggestInstall" && b.service === "gallery.albums"));
  assert.ok(abs.some((b) => b.type === "suggestInstall" && b.service === "videos.library"));
  assert.ok(abs.some((b) => b.type === "adminForm" && b.fields.some((f) => f.name === "albumLink")));
});
