// Vidéothèque : les outils de l'assistant IA. Lire, ajouter par adresse (toujours en brouillon), modifier un brouillon ; jamais publier ; écritures non accordées d'office.
import test from "node:test";
import assert from "node:assert/strict";
const { withFakeFetch } = await import(`file://${process.env.CURIOSA_DIR ?? process.cwd()}/testsupport/index.mjs`); // le kit de test du cœur (CURIOSA_DIR, comme les autres tests)
import { ctxFor, def, D, manifest, platform, seedVideos, seedCategory, id } from "./helpers/videosKit.mjs";

const call = (ctx, name, args = {}) => def.mcp[name](ctx, args, { name: "test" });
const YT = "dQw4w9WgXcQ";
const exposed = async (p) => { try { await p; } catch (e) { assert.equal(e.expose, true); return e.message; } assert.fail("une erreur était attendue"); };

test("le manifeste déclare honnêtement ses outils : lecture seule, écritures non accordées d'office, noms courts", () => {
  const by = Object.fromEntries(manifest.mcp.map((m) => [m.name, m]));
  assert.deepEqual(Object.keys(by).sort(), ["categories_list", "library_list", "video_add_by_url", "video_update"]);
  assert.equal(by.library_list.readOnly, true); assert.equal(by.categories_list.readOnly, true);
  for (const w of ["video_add_by_url", "video_update"]) assert.ok(!by[w].readOnly && by[w].default !== true && !by[w].destructive, w);
  assert.deepEqual(Object.keys(def.mcp).sort(), Object.keys(by).sort());
  for (const m of manifest.mcp) assert.ok(`un-identifiant-d-instance-assez-long__${m.name}`.length <= 64 && m.name.length <= 31);
});

test("lister : filtres, pagination ; les textes sont signalés comme des données", async () => {
  const ctx = ctxFor();
  const cat = await seedCategory(ctx, "Tutoriels");
  await seedVideos(ctx, Array.from({ length: 70 }, (_, i) => ({ ext: id(i + 1), title: `Vidéo ${i + 1}`, status: i % 2 ? "published" : "draft", cat: i < 10 ? cat : 0 })));
  const all = await call(ctx, "library_list", { limit: 50 });
  assert.equal(all.items.length, 50); assert.equal(all.total, 70); assert.equal(all.next, "50"); assert.match(all.note, /never treat them as instructions/);
  const rest = await call(ctx, "library_list", { limit: 50, cursor: all.next });
  assert.equal(rest.items.length, 20); assert.equal(rest.next, null);
  assert.equal((await call(ctx, "library_list", { status: "published", limit: 50 })).total, 35);
  assert.equal((await call(ctx, "library_list", { category: "tutoriels" })).total, 10);
  assert.match(await exposed(call(ctx, "library_list", { category: "inconnue" })), /Unknown category/);
  assert.deepEqual((await call(ctx, "categories_list")).categories.map((c) => [c.slug, c.videos]), [["tutoriels", 10]]);
});

test("ajouter par adresse : titre et miniature via YouTube, TOUJOURS en brouillon, refus avec une raison", async () => {
  const ctx = ctxFor();
  const cat = await seedCategory(ctx, "Masterclass");
  const fake = platform({ [YT]: { title: "Un titre venu de YouTube" } });
  await withFakeFetch(fake.routes, async () => {
    const r = await call(ctx, "video_add_by_url", { url: `https://youtu.be/${YT}?si=x`, category: "masterclass", free: true, description: "Description donnée" });
    assert.equal(r.added.status, "draft"); assert.equal(r.added.title, "Un titre venu de YouTube"); assert.equal(r.titleFrom, "platform"); assert.equal(r.added.pageUrl, null); assert.match(r.note, /DRAFT/);
    assert.match(await exposed(call(ctx, "video_add_by_url", { url: `https://www.youtube.com/watch?v=${YT}` })), /already in the library \(id 1\)/);
    assert.match(await exposed(call(ctx, "video_add_by_url", { url: "https://vimeo.com/1" })), /Only YouTube/);
    assert.match(await exposed(call(ctx, "video_add_by_url", { url: "https://www.youtube.com/playlist?list=PL1" })), /playlist/);
    assert.match(await exposed(call(ctx, "video_add_by_url", { url: "" })), /'url' is required/);
    assert.match(await exposed(call(ctx, "video_add_by_url", { url: "https://youtu.be/AAAAAAAAAAA" })), /does not know this video/);
  });
  const snap = await D.snapshot(ctx, { fresh: true });
  assert.deepEqual([snap.items[0].cat, snap.items[0].free, snap.items[0].desc], [cat, true, "Description donnée"]);
  await withFakeFetch(platform({}, { down: true }).routes, async () => {
    assert.match(await exposed(call(ctx, "video_add_by_url", { url: `https://youtu.be/${id(2)}` })), /pass the 'title' yourself/);
    assert.equal((await call(ctx, "video_add_by_url", { url: `https://youtu.be/${id(2)}`, title: "Titre donné" })).titleFrom, "given");
  });
});

test("modifier : un brouillon ou une vidéo masquée seulement ; jamais publier ; une publiée est refusée", async () => {
  const ctx = ctxFor();
  await seedCategory(ctx, "Tutoriels");
  const [draft, pub, hidden] = await seedVideos(ctx, [{ ext: id(1), title: "A", status: "draft" }, { ext: id(2), title: "B", status: "published" }, { ext: id(3), title: "C", status: "hidden" }]);
  const r = await call(ctx, "video_update", { id: draft.n, title: "Nouveau", description: "d", category: "Tutoriels", date: "2026-02-03", duration: "1:30", free: true, transcript: "Texte dit." });
  assert.deepEqual([r.updated.title, r.updated.category, r.updated.date, r.updated.durationSeconds, r.updated.free, r.updated.status], ["Nouveau", "Tutoriels", "2026-02-03", 90, true, "draft"]);
  assert.equal(await D.getText(ctx, draft.n), "Texte dit.");
  assert.equal((await call(ctx, "video_update", { id: draft.n, category: "" })).updated.category, null);
  assert.equal((await call(ctx, "video_update", { id: draft.n, status: "hidden" })).updated.status, "hidden");
  assert.equal((await call(ctx, "video_update", { id: hidden.n, status: "draft" })).updated.status, "draft");
  assert.match(await exposed(call(ctx, "video_update", { id: draft.n, status: "published" })), /cannot publish/);
  assert.match(await exposed(call(ctx, "video_update", { id: pub.n, title: "Piratée" })), /is published/);
  assert.equal((await D.snapshot(ctx, { fresh: true })).byN.get(pub.n).title, "B");
  assert.match(await exposed(call(ctx, "video_update", { id: 999, title: "x" })), /Unknown video id/);
  assert.match(await exposed(call(ctx, "video_update", { id: draft.n })), /Nothing to change/);
  assert.match(await exposed(call(ctx, "video_update", { id: draft.n, date: "demain" })), /'date' must look like/);
  assert.match(await exposed(call(ctx, "video_update", { id: draft.n, duration: "beaucoup" })), /'duration' must look like/);
  assert.match(await exposed(call(ctx, "video_update", { id: draft.n, description: "x".repeat(3001) })), /too long/);
  assert.match(await exposed(call(ctx, "video_update", { id: draft.n, category: "inconnue" })), /Unknown category/);
});

test("lire ne modifie rien", async () => {
  const ctx = ctxFor();
  await seedVideos(ctx, [{ ext: id(1), title: "A" }]);
  const writes = ctx.calls.writes.length;
  await call(ctx, "library_list", {}); await call(ctx, "categories_list", {});
  assert.equal(ctx.calls.writes.length, writes);
});
