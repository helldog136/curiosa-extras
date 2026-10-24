// Vidéothèque : le parcours d'Emma. Coller une adresse (titre et miniature qui se remplissent), erreurs sous le champ, ajout en lot avec aperçu, catégories, séries, publier, masquer.
import test from "node:test";
import assert from "node:assert/strict";
import { withFakeFetch, netReplies } from "/dev/shm/core-assoc/testsupport/index.mjs";
import { ctxFor, def, D, P, R, manifest, platform, seedVideos, seedCategory, seedSeries, keepThumb, id, messages } from "./helpers/videosKit.mjs";

/** Lance une action d'administration comme le cœur : droit déclaré dans le manifeste, vérifié pour la personne, puis `run`. */
async function act(ctx, name, values = {}) {
  const a = def.adminActions[name];
  assert.ok(a, `action ${name}`);
  if (a.right) { assert.ok(manifest.rights.some((r) => r.id === a.right)); if (!ctx.can(a.right)) return { denied: true }; }
  return a.run(ctx, values);
}
const panel = (ctx, query = {}) => def.adminPanel(ctx, { query });
const textOf = (blocks) => JSON.stringify(blocks);
const YT = "dQw4w9WgXcQ";

test("premier passage : un accueil avec un seul champ, le gabarit de départ dans l'autre onglet, rien d'obligatoire", async () => {
  const blocks = await panel(ctxFor());
  assert.match(textOf(blocks), /Bienvenue ! Ajoutez votre première vidéo/);
  const form = blocks.find((b) => b.type === "adminForm" && b.action === "add");
  assert.deepEqual(form.fields.filter((f) => f.required).map((f) => f.name), ["url"]);
  assert.ok(form.fields.find((f) => f.name === "url").help.includes("https://www.youtube.com/watch?v="));
  assert.equal(form.fields.find((f) => f.name === "state").value, "draft");
  assert.ok(blocks.filter((b) => b.tab === "shelves").some((b) => b.type === "adminForm" && b.action === "applyTemplate"));
  assert.ok(!blocks.some((b) => b.type === "table" && !b.tab));
  assert.deepEqual(manifest.tabs.map((t) => t.id), ["use", "shelves"]);
});

test("coller une adresse : titre et miniature via YouTube, brouillon, l'écran de modification s'ouvre", async () => {
  const ctx = ctxFor();
  const fake = platform({ [YT]: { title: "Atelier lumière, épisode 1" } });
  const r = await withFakeFetch(fake.routes, () => act(ctx, "add", { url: `https://youtu.be/${YT}?si=tracking&t=10`, title: "", cat: "", state: "draft" }));
  assert.match(r.ok, /Atelier lumière, épisode 1/); assert.match(r.ok, /brouillon/); assert.match(r.redirect, /^\?edit=\d+$/);
  const x = (await D.snapshot(ctx, { fresh: true })).items[0];
  assert.deepEqual([x.provider, x.ext, x.title, x.status, x.thumb], ["youtube", YT, "Atelier lumière, épisode 1", "draft", true]);
  assert.ok((await D.getThumb(ctx, x.n)).bytes.length > 100);
  assert.deepEqual(fake.calls.map((u) => new URL(u).hostname).sort(), ["i.ytimg.com", "www.youtube.com"]);
  assert.ok(fake.calls.every((u) => !u.includes("tracking") && !u.includes("t=10")));
  assert.match(textOf(await panel(ctx, { edit: String(x.n) })), /Modifier : Atelier lumière/);
});

test("choisir « publiée » dès l'ajout ; sans le droit de publier, tout reste brouillon", async () => {
  const fake = platform({ [YT]: { title: "T" } });
  const a = ctxFor();
  await withFakeFetch(fake.routes, () => act(a, "add", { url: `https://youtu.be/${YT}`, state: "published" }));
  assert.equal((await D.snapshot(a, { fresh: true })).items[0].status, "published");
  const b = ctxFor({}, { rights: ["edit"] });
  assert.ok(!(await panel(b)).find((x) => x.action === "add").fields.some((f) => f.name === "state"));
  await withFakeFetch(fake.routes, () => act(b, "add", { url: `https://youtu.be/${YT}`, state: "published" }));
  assert.equal((await D.snapshot(b, { fresh: true })).items[0].status, "draft");
  assert.deepEqual(await act(ctxFor({}, { rights: [] }), "add", { url: `https://youtu.be/${YT}` }), { denied: true });
});

test("erreurs SOUS le champ, avec un exemple et quoi faire", async () => {
  const ctx = ctxFor();
  const fake = platform({ [YT]: { title: "Un titre" } });
  await withFakeFetch(fake.routes, async () => {
    const bad = await act(ctx, "add", { url: "bonjour" });
    assert.deepEqual(Object.keys(bad.errors), ["url"]); assert.match(bad.errors.url, /ne ressemble pas à une vidéo YouTube.*https:\/\/www\.youtube\.com\/watch\?v=/);
    assert.match((await act(ctx, "add", { url: "https://vimeo.com/123" })).errors.url, /Seules les vidéos YouTube/);
    assert.match((await act(ctx, "add", { url: "https://www.youtube.com/playlist?list=PL1" })).errors.url, /liste de lecture/);
    assert.match((await act(ctx, "add", { url: "https://www.youtube.com/@moi" })).errors.url, /chaîne/);
    assert.match((await act(ctx, "add", { url: "" })).errors.url, /Exemple/);
    assert.match((await act(ctx, "add", { url: "https://www.youtube.com/watch?v=AAAAAAAAAAA" })).errors.url, /ne trouve pas cette vidéo/);
    assert.equal(fake.calls.length, 1, "une adresse refusée n'appelle jamais YouTube");
    await act(ctx, "add", { url: `https://youtu.be/${YT}` });
    assert.match((await act(ctx, "add", { url: `https://www.youtube.com/watch?v=${YT}&feature=share` })).errors.url, /déjà dans votre vidéothèque \(« Un titre »\)/);
  });
  assert.equal((await D.snapshot(ctx, { fresh: true })).items.length, 1);
});

test("YouTube ne répond pas : repli propre, le titre se saisit à la main", async () => {
  const ctx = ctxFor();
  await withFakeFetch(platform({}, { down: true }).routes, async () => {
    const r = await act(ctx, "add", { url: `https://youtu.be/${YT}`, title: "" });
    assert.deepEqual(Object.keys(r.errors), ["title"]); assert.match(r.errors.title, /YouTube ne répond pas pour le moment.*Exemple/);
    assert.equal((await D.snapshot(ctx, { fresh: true })).items.length, 0);
    const ok = await act(ctx, "add", { url: `https://youtu.be/${YT}`, title: "  Mon titre écrit à la main " });
    assert.match(ok.ok, /titre que vous avez écrit/); assert.match(ok.ok, /miniature n'a pas pu être gardée/);
  });
  const x = (await D.snapshot(ctx, { fresh: true })).items[0];
  assert.deepEqual([x.title, x.thumb, x.noEmbed], ["Mon titre écrit à la main", false, false]);
});

test("YouTube lent, illisible ou en panne : jamais de plantage ni d'attente infinie", async () => {
  const saved = R.timing.oembedMs;
  R.timing.oembedMs = 80;
  try {
    for (const reply of [netReplies.silence(), netReplies.truncatedJson(), netReplies.status(503), netReplies.rateLimited(60), netReplies.quotaExceeded(), netReplies.down()]) {
      const ctx = ctxFor();
      const t0 = Date.now();
      const r = await withFakeFetch({ "*": reply }, () => act(ctx, "add", { url: `https://youtu.be/${YT}` }));
      assert.ok(Date.now() - t0 < 2500);
      assert.deepEqual(Object.keys(r.errors ?? {}), ["title"]);
    }
  } finally { R.timing.oembedMs = saved; }
});

test("vidéo privée ou lecture ailleurs interdite : le titre se saisit, le lecteur est coupé", async () => {
  const ctx = ctxFor();
  await withFakeFetch(platform({ [YT]: { title: "x", embeddable: false } }).routes, async () => {
    assert.match((await act(ctx, "add", { url: `https://youtu.be/${YT}` })).errors.title, /privée, ou lecture ailleurs interdite/);
    assert.ok((await act(ctx, "add", { url: `https://youtu.be/${YT}`, title: "Privée" })).ok);
  });
  const x = (await D.snapshot(ctx, { fresh: true })).items[0];
  assert.equal(x.noEmbed, true);
  assert.match(textOf(await panel(ctx, { edit: String(x.n) })), /ne permet pas de lire cette vidéo sur d'autres sites/);
});

test("ajout en lot : aperçu avant validation, doublons et erreurs signalés, rien n'est ajouté avant de confirmer", async () => {
  const ctx = ctxFor();
  const cat = await seedCategory(ctx, "Tutoriels");
  await seedVideos(ctx, [{ ext: "aaaaaaaaa01", title: "Déjà là" }]);
  const lines = ["https://youtu.be/aaaaaaaaa02", "https://www.youtube.com/watch?v=aaaaaaaaa03&list=x", "https://youtu.be/aaaaaaaaa02", "https://youtu.be/aaaaaaaaa01", "pasuneadresse", "https://vimeo.com/1", "https://www.youtube.com/playlist?list=PL1"];
  const fake = platform({ aaaaaaaaa02: { title: "Deux" }, aaaaaaaaa03: { title: "Trois" } });
  await withFakeFetch(fake.routes, async () => {
    assert.equal((await act(ctx, "bulkPreview", { urls: lines.join("\n"), cat: String(cat), state: "draft" })).redirect, "?bulk=1");
    assert.equal(fake.calls.length, 0);
    assert.equal((await D.snapshot(ctx, { fresh: true })).items.length, 1);
    const screen = await panel(ctx, { bulk: "1" });
    const table = screen.find((b) => b.type === "table");
    assert.deepEqual(table.rows.map((r) => r[0].split(" — ").slice(1).join(" — ")), ["Nouvelle vidéo", "Nouvelle vidéo", "Répétée dans votre liste", "Déjà dans la vidéothèque (« Déjà là »)", "Pas une adresse YouTube", "Pas YouTube : non pris en charge", "Liste de lecture : collez une seule vidéo"]);
    assert.match(textOf(screen), /2 adresse\(s\) prête\(s\) sur 7/);
    assert.match(screen.find((b) => b.action === "bulkConfirm").submitLabel, /Ajouter 2 vidéos/);
    assert.match((await act(ctx, "bulkConfirm", { go: "1" })).ok, /2 vidéos ajoutées/);
  });
  const snap = await D.snapshot(ctx, { fresh: true });
  assert.deepEqual(snap.items.map((x) => x.title).sort(), ["Deux", "Déjà là", "Trois"]);
  assert.ok(snap.items.filter((x) => x.ext !== "aaaaaaaaa01").every((x) => x.cat === cat && x.status === "draft" && x.thumb));
  assert.match(textOf(await panel(ctx, { bulk: "1" })), /L'aperçu a expiré/);
});

test("ajout en lot : plus de 100 adresses refusées ; une panne n'empêche pas l'ajout, les titres se complètent ensuite", async () => {
  const ctx = ctxFor({}, { netLimits: { circuitFailures: 100000 } });
  assert.match((await act(ctx, "bulkPreview", { urls: Array.from({ length: 101 }, (_, i) => `https://youtu.be/${id(i)}`).join("\n") })).errors.urls, /101 adresses : 100 au plus/);
  assert.match((await act(ctx, "bulkPreview", { urls: "   " })).errors.urls, /Collez au moins une adresse/);
  assert.match((await act(ctx, "bulkPreview", { urls: "x".repeat(P.LIMITS.bulkText + 1) })).errors.urls, /100 adresses au plus/);
  const list = Array.from({ length: 45 }, (_, i) => `https://youtu.be/${id(i)}`).join(" ");
  await withFakeFetch(platform({}, { down: true }).routes, async () => {
    await act(ctx, "bulkPreview", { urls: list });
    const done = await act(ctx, "bulkConfirm", { go: "1" });
    assert.match(done.ok, /45 vidéos ajoutées/); assert.match(done.ok, /YouTube ne répond pas.*45 vidéos à compléter/);
  });
  let snap = await D.snapshot(ctx, { fresh: true });
  assert.ok(snap.items.length === 45 && snap.items.every((x) => !x.title && x.status === "draft"));
  assert.match(textOf(await panel(ctx)), /Titres à compléter : 45/);
  const up = platform(Object.fromEntries(Array.from({ length: 45 }, (_, i) => [id(i), { title: `Titre ${i}` }])));
  await withFakeFetch(up.routes, async () => {
    const left = [];
    for (let i = 0; i < 3; i++) { assert.ok((await act(ctx, "complete", { go: "1" })).ok); left.push((await D.snapshot(ctx, { fresh: true })).items.filter((x) => !x.title).length); }
    assert.deepEqual(left, [25, 5, 0]);
  });
  snap = await D.snapshot(ctx, { fresh: true });
  assert.ok(snap.items.every((x) => x.title && x.thumb));
  assert.ok(!textOf(await panel(ctx)).includes("Titres à compléter"));
});

test("modifier une vidéo : validations sous chaque champ, enregistrement, transcription", async () => {
  const ctx = ctxFor();
  const cat = await seedCategory(ctx, "Tutoriels");
  const [a] = await seedVideos(ctx, [{ ext: id(1), title: "Avant", status: "draft" }]);
  const base = { id: String(a.n), title: "Après", desc: "Texte", cat: String(cat), date: "2026-05-04", dur: "1:02:03", free: "on", cover: "", album: "", transcript: "Mot un.\n\nMot deux.", state: "published" };
  assert.match((await act(ctx, "save", { ...base, date: "demain" })).errors.date, /2026-10-24/);
  assert.match((await act(ctx, "save", { ...base, dur: "beaucoup" })).errors.dur, /12:34/);
  assert.match((await act(ctx, "save", { ...base, cover: "https://evil.test/x.jpg" })).errors.cover, /bouton d'envoi/);
  assert.match((await act(ctx, "save", { ...base, title: "" })).errors.title, /Écrivez un titre avant de publier/);
  assert.match((await act(ctx, "save", { ...base, desc: "x".repeat(P.LIMITS.desc + 1) })).errors.desc, /3000 caractères au plus/);
  assert.match((await act(ctx, "save", { ...base, transcript: "x".repeat(P.LIMITS.transcript + 1) })).errors.transcript, /Trop long/);
  assert.equal((await D.snapshot(ctx, { fresh: true })).byN.get(a.n).title, "Avant");
  assert.match((await act(ctx, "save", base)).ok, /« Après » est enregistrée/);
  const x = (await D.snapshot(ctx, { fresh: true })).byN.get(a.n);
  assert.deepEqual([x.title, x.desc, x.cat, x.date, x.dur, x.free, x.status], ["Après", "Texte", cat, "2026-05-04", 3723, true, "published"]);
  assert.equal(await D.getText(ctx, a.n), "Mot un.\n\nMot deux.");
  await act(ctx, "save", { ...base, transcript: "" });
  assert.equal(await D.getText(ctx, a.n), "");
  const noPublish = ctxFor({}, { rights: ["edit"] });
  const [b] = await seedVideos(noPublish, [{ ext: id(2), title: "Publiée" }]);
  await act(noPublish, "save", { id: String(b.n), title: "Retouchée", state: "draft" });
  const y = (await D.snapshot(noPublish, { fresh: true })).byN.get(b.n);
  assert.deepEqual([y.title, y.status], ["Retouchée", "published"]);
  assert.equal((await act(ctx, "save", { id: "999", title: "x" })).error, messages("fr").goneVideo);
});

test("publier, masquer, rafraîchir, supprimer ; une vidéo sans titre ne se publie pas", async () => {
  const ctx = ctxFor();
  const [a, b] = await seedVideos(ctx, [{ ext: id(1), title: "A", status: "draft" }, { ext: id(2), title: "", status: "draft" }]);
  assert.match((await act(ctx, "publish", { id: String(b.n) })).error, /n'a pas de titre/);
  assert.match((await act(ctx, "publish", { id: String(a.n) })).ok, /« A » est publiée/);
  assert.match((await act(ctx, "hide", { id: String(a.n) })).ok, /masquée/);
  assert.equal((await D.snapshot(ctx, { fresh: true })).byN.get(a.n).status, "hidden");
  assert.match((await withFakeFetch(platform({ [id(2)]: { title: "Rempli" } }).routes, () => act(ctx, "refresh", { id: String(b.n) }))).ok, /Mis à jour depuis YouTube/);
  assert.equal((await D.snapshot(ctx, { fresh: true })).byN.get(b.n).title, "Rempli");
  assert.match((await withFakeFetch(platform({}, { down: true }).routes, () => act(ctx, "refresh", { id: String(b.n) }))).error, /YouTube ne répond pas/);
  await keepThumb(ctx, a.n);
  const p = await seedSeries(ctx, "Série", [a.n, b.n]);
  assert.match((await act(ctx, "remove", { id: String(a.n) })).ok, /supprimée/);
  const snap = await D.snapshot(ctx, { fresh: true });
  assert.equal(snap.byN.has(a.n), false); assert.deepEqual(snap.series.find((s) => s.p === p).items, [b.n]);
  assert.equal(await D.getThumb(ctx, a.n), null);
  assert.equal((await act(ctx, "remove", { id: String(a.n) })).error, messages("fr").goneVideo);
  assert.deepEqual(await act(ctxFor({}, { rights: ["edit"] }), "publish", { id: "1" }), { denied: true });
});

test("catégories : gabarit en un clic (une seule fois), « Vide », ajout, renommage, ordre par boutons, suppression sans perdre les vidéos", async () => {
  const ctx = ctxFor();
  assert.match((await act(ctx, "applyTemplate", { template: "talks" })).ok, /3 catégories créées/);
  let snap = await D.snapshot(ctx, { fresh: true });
  assert.deepEqual(snap.cats.map((c) => c.names.fr), ["Masterclass", "Rétrospectives", "Tutoriels"]);
  assert.deepEqual(snap.cats.map((c) => c.names.en), ["Masterclass", "Retrospectives", "Tutorials"]);
  assert.deepEqual(snap.cats.map((c) => c.slug), ["masterclass", "retrospectives", "tutoriels"]);
  assert.match((await act(ctx, "applyTemplate", { template: "talks" })).error, /déjà des catégories/);
  assert.equal((await D.snapshot(ctx, { fresh: true })).cats.length, 3);
  assert.match((await act(ctxFor(), "applyTemplate", { template: "empty" })).ok, /aucune catégorie créée/);
  assert.ok((await act(ctx, "applyTemplate", { template: "n'importe quoi" })).error);
  assert.match((await act(ctx, "catAdd", { name_fr: "", name_en: "" })).errors.name_fr, /Écrivez un nom/);
  assert.match((await act(ctx, "catAdd", { name_fr: "Présentations", name_en: "Presentations" })).ok, /Présentations/);
  snap = await D.snapshot(ctx, { fresh: true });
  const [m, r, t, pr] = snap.cats;
  await act(ctx, "catDown", { id: String(m.k) }); await act(ctx, "catUp", { id: String(pr.k) });
  assert.deepEqual((await D.snapshot(ctx, { fresh: true })).cats.map((c) => c.names.fr), ["Rétrospectives", "Masterclass", "Présentations", "Tutoriels"]);
  assert.match((await act(ctx, "catSave", { id: String(t.k), name_fr: "Tutos", name_en: "How-tos" })).ok, /enregistrée/);
  assert.equal((await D.snapshot(ctx, { fresh: true })).cats.find((c) => c.k === t.k).slug, "tutoriels");
  const [v] = await seedVideos(ctx, [{ ext: id(1), title: "A", cat: r.k }]);
  assert.match((await act(ctx, "catRemove", { id: String(r.k) })).ok, /Ses vidéos n'ont plus de catégorie/);
  snap = await D.snapshot(ctx, { fresh: true });
  assert.equal(snap.byN.get(v.n).cat, 0); assert.equal(snap.cats.length, 3);
  assert.equal((await act(ctx, "catRemove", { id: String(r.k) })).error, messages("fr").goneCategory);
  const old = P.LIMITS.categories; P.LIMITS.categories = 3;
  try { assert.match((await act(ctx, "catAdd", { name_fr: "Trop", name_en: "Too" })).error, /limite de 3 catégories/); } finally { P.LIMITS.categories = old; }
});

test("séries : créer, ajouter des vidéos (jamais deux fois, 100 au plus), ordre par boutons, publier", async () => {
  const ctx = ctxFor();
  const vids = await seedVideos(ctx, Array.from({ length: 4 }, (_, i) => ({ ext: id(i + 1), title: `Épisode ${i + 1}` })));
  const p = Number(/series=(\d+)/.exec((await act(ctx, "seriesAdd", { name_fr: "Formation", name_en: "Course" })).redirect)[1]);
  assert.match((await act(ctx, "seriesAdd", { name_fr: "", name_en: "" })).errors.name_fr, /Écrivez un nom/);
  for (const v of vids) assert.match((await act(ctx, "seriesItemAdd", { id: `${p}:${v.n}` })).ok, /ajoutée à la série/);
  assert.match((await act(ctx, "seriesItemAdd", { id: `${p}:${vids[0].n}` })).error, /déjà dans la série/);
  assert.match((await act(ctx, "seriesItemAdd", { id: `${p}:999` })).error, /n'existe plus/);
  assert.match((await act(ctx, "seriesItemAdd", { id: "n'importe quoi" })).error, /n'existe plus/);
  await act(ctx, "seriesItemDown", { id: `${p}:${vids[0].n}` }); await act(ctx, "seriesItemUp", { id: `${p}:${vids[3].n}` }); await act(ctx, "seriesItemUp", { id: `${p}:${vids[3].n}` });
  assert.deepEqual((await D.snapshot(ctx, { fresh: true })).series[0].items, [vids[1].n, vids[3].n, vids[0].n, vids[2].n]);
  await act(ctx, "seriesItemRemove", { id: `${p}:${vids[1].n}` });
  const old = P.LIMITS.inSeries; P.LIMITS.inSeries = 3;
  try { assert.match((await act(ctx, "seriesItemAdd", { id: `${p}:${vids[1].n}` })).error, /3 vidéos au plus/); } finally { P.LIMITS.inSeries = old; }
  assert.match((await act(ctx, "seriesSave", { id: String(p), name_fr: "La formation", name_en: "The course", desc_fr: "Présentation", desc_en: "", state: "published" })).ok, /enregistrée/);
  const s = (await D.snapshot(ctx, { fresh: true })).series[0];
  assert.deepEqual([s.names.fr, s.names.en, s.descs.fr, s.descs.en, s.status], ["La formation", "The course", "Présentation", undefined, "published"]);
  assert.match((await act(ctx, "seriesSave", { id: String(p), name_fr: "x", name_en: "x", desc_fr: "y".repeat(P.LIMITS.seriesDesc + 1) })).errors.desc_fr, /Trop long/);
  const onlyEdit = ctxFor({}, { rights: ["edit"] });
  const [w] = await seedVideos(onlyEdit, [{ ext: id(9), title: "W" }]);
  const q = Number(/series=(\d+)/.exec((await act(onlyEdit, "seriesAdd", { name_fr: "S", name_en: "S" })).redirect)[1]);
  await act(onlyEdit, "seriesItemAdd", { id: `${q}:${w.n}` });
  await act(onlyEdit, "seriesSave", { id: String(q), name_fr: "S2", name_en: "S2", state: "published" });
  assert.equal((await D.snapshot(onlyEdit, { fresh: true })).series[0].status, "draft");
  await act(ctx, "seriesAdd", { name_fr: "Deux", name_en: "Two" }); await act(ctx, "seriesDown", { id: String(p) });
  assert.deepEqual((await D.snapshot(ctx, { fresh: true })).series.map((x) => x.names.fr), ["Deux", "La formation"]);
  assert.match((await act(ctx, "seriesRemove", { id: String(p) })).ok, /supprimée/);
  assert.equal((await D.snapshot(ctx, { fresh: true })).items.length, 4);
});

test("la limite de 5000 vidéos est vérifiée à l'écriture : refus clair, rien n'est perdu", async () => {
  const ctx = ctxFor();
  const old = P.LIMITS.videos; P.LIMITS.videos = 3;
  try {
    await seedVideos(ctx, [{ ext: id(1), title: "A" }, { ext: id(2), title: "B" }]);
    await withFakeFetch(platform({ [id(3)]: { title: "C" }, [id(4)]: { title: "D" } }).routes, async () => {
      assert.ok((await act(ctx, "add", { url: `https://youtu.be/${id(3)}` })).ok);
      assert.match((await act(ctx, "add", { url: `https://youtu.be/${id(4)}` })).error, /pleine : 3 vidéos au plus/);
    });
    const batch = await D.addVideos(ctx, [{ provider: "youtube", ext: id(5), title: "E" }]);
    assert.deepEqual([batch.added.length, batch.full], [0, 1]);
  } finally { P.LIMITS.videos = old; }
  assert.equal((await D.snapshot(ctx, { fresh: true })).items.length, 3);
});

test("le panneau : la liste (25 par page, filtres, recherche) et les écrans se construisent ; chaque bouton vise une action qui existe", async () => {
  const ctx = ctxFor();
  const cat = await seedCategory(ctx, "Tutoriels");
  const vids = await seedVideos(ctx, Array.from({ length: 60 }, (_, i) => ({ ext: id(i + 1), title: `Vidéo ${i + 1}`, status: i % 3 === 0 ? "draft" : i % 3 === 1 ? "published" : "hidden", cat: i % 2 ? cat : 0 })));
  const p = await seedSeries(ctx, "Série", [vids[0].n, vids[1].n]);
  const ids = (blocks) => blocks.flatMap((b) => [b.action, ...(b.rowActions ?? []).map((a) => a.action)]).filter(Boolean);
  for (const q of [{}, { page: "2" }, { st: "draft" }, { st: "published", page: "2" }, { q: "Vidéo 5" }, { q: "zzz" }, { edit: String(vids[0].n) }, { edit: "999" }, { bulk: "new" }, { bulk: "1" }, { cat: String(cat) }, { cat: "999" }, { series: String(p) }, { series: String(p), vq: "Vidéo 3" }, { series: "999" }, { edit: "abc" }, { page: "-5" }, { page: "x".repeat(50) }]) {
    const blocks = await panel(ctx, q);
    assert.ok(Array.isArray(blocks) && blocks.length, JSON.stringify(q));
    for (const a of ids(blocks)) assert.ok(def.adminActions[a], `${JSON.stringify(q)} : l'action ${a} existe`);
  }
  assert.equal((await panel(ctx, {})).find((b) => b.type === "table" && b.columns.includes("Titre")).rows.length, 25);
  assert.ok((await panel(ctx, { st: "draft" })).find((b) => b.type === "table").rowActions.some((a) => a.action === "publish"));
  assert.ok((await panel(ctx, { st: "published" })).find((b) => b.type === "table").rowActions.some((a) => a.action === "hide"));
  assert.match(textOf(await panel(ctx, { q: "zzz" })), /Aucune vidéo ne correspond/);
  const viewer = ctxFor({}, { rights: [] });
  await seedVideos(viewer, [{ ext: id(1), title: "A" }]);
  assert.ok(!(await panel(viewer)).some((b) => b.type === "adminForm"));
  assert.match(textOf(await panel(viewer, { edit: "1" })), /pas le droit/);
});

test("l'écran de modification propose les bons boutons et, sans galerie, une invitation facultative", async () => {
  const ctx = ctxFor();
  const [a] = await seedVideos(ctx, [{ ext: id(1), title: "A", status: "published" }]);
  const screen = await panel(ctx, { edit: String(a.n) });
  const form = screen.find((b) => b.action === "save");
  assert.deepEqual(form.fields.map((f) => f.name), ["id", "title", "desc", "date", "dur", "free", "cover", "transcript", "state"]);
  assert.equal(form.fields.find((f) => f.name === "cover").kind, "image");
  assert.ok(screen.some((b) => b.type === "suggestInstall" && b.service === "gallery.albums"));
  assert.ok(screen.some((b) => b.type === "adminForm" && b.action === "hide"));
  assert.ok(screen.some((b) => b.type === "links" && b.items.some((i) => i.href === `https://www.youtube.com/watch?v=${id(1)}`)));
});

test("les droits du module sont déclarés et relus", () => {
  assert.deepEqual(manifest.rights.map((r) => r.id).sort(), ["edit", "publish"]);
  for (const [name, a] of Object.entries(def.adminActions)) assert.ok(typeof a === "object" && ["edit", "publish"].includes(a.right), `${name} a un droit`);
});
