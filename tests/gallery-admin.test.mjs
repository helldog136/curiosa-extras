// Galeries photos : l'administration (panneau, albums, photos, envoi, point de départ, demandes de retrait, droits, sauvegarde lisible).
import test from "node:test";
import assert from "node:assert/strict";
import { def, ctxFor, makeAlbum, breakLink, data, ops, rows, photoFields, manifest, admin } from "./helpers/galleryKit.mjs";

const act = (ctx, name, values) => {
  const a = def.adminActions[name];
  return (typeof a === "function" ? a : a.run)(ctx, values);
};
const panel = (ctx, query = {}) => def.adminPanel(ctx, { query });
const text = (blocks) => JSON.stringify(blocks);

test("droits : chaque action déclare le droit du module, et tous existent dans module.json", () => {
  const declared = new Set(manifest.rights.map((r) => r.id));
  for (const [name, a] of Object.entries(def.adminActions)) {
    assert.equal(typeof a, "object", `${name} : forme { right, run }`);
    assert.ok(declared.has(a.right), `${name} : droit « ${a.right} » déclaré`);
  }
  assert.equal(def.adminActions.publish.right, "publish");
  assert.equal(def.adminActions.maskRequest.right, "requests");
  assert.equal(def.adminActions.addPhoto.right, "edit");
  assert.equal(def.adminActions.studioInfo.right, "edit");
});

test("point de départ : trois choix, un album d'exemple en brouillon invisible, rien de supprimé, l'ordre et les dates suivent", async () => {
  const ctx = ctxFor();
  const first = await panel(ctx);
  assert.match(text(first), /Par où commencer/);
  for (const name of ["Rétrospectives", "Portfolio", "Vide"]) assert.match(text(first), new RegExp(name));
  assert.equal((await act(ctx, "chooseTemplate", { id: "nimporte" })).error.includes("Introuvable"), true);
  const r = await act(ctx, "chooseTemplate", { id: "retro" });
  assert.equal(r.ok, "Point de départ choisi.");
  const albums = await data.freshAlbums(ctx);
  assert.equal(albums.length, 2);
  assert.ok(albums.every((a) => a.status === "draft"), "les exemples sont des brouillons");
  assert.deepEqual(albums.map((a) => a.mode).sort(), ["external", "hosted"]);
  assert.match(text(await panel(ctx)), /Mes albums \(2\)/);
  assert.doesNotMatch(text(await panel(ctx)), /Par où commencer/);
  await act(ctx, "chooseTemplate", { id: "portfolio" });
  assert.equal((await data.freshAlbums(ctx)).length, 2);
  assert.equal((await data.loadMeta(ctx)).template, "portfolio");
  const empty = ctxFor();
  await act(empty, "chooseTemplate", { id: "empty" });
  assert.equal((await data.freshAlbums(empty)).length, 0);
  const pf = ctxFor();
  await act(pf, "chooseTemplate", { id: "portfolio" });
  assert.equal((await data.freshAlbums(pf)).length, 1);
});

test("sans le droit de modifier : ni formulaire, ni point de départ, ni lien d'ajout", async () => {
  const ctx = ctxFor({}, { rights: [] });
  const a = await makeAlbum(ctx, { n: 1 });
  const t = text(await panel(ctx));
  assert.doesNotMatch(t, /Par où commencer|Créer un album|adminForm/);
  const album = text(await panel(ctx, { album: a.id }));
  assert.doesNotMatch(album, /Ajouter des photos|Modifier l'album|adminForm/);
});

test("album : erreurs écrites SOUS le champ avec un exemple ; création en brouillon ; titre, date et lien nettoyés", async () => {
  const ctx = ctxFor();
  let r = await act(ctx, "saveAlbum", { title: "  ", mode: "hosted" });
  assert.match(r.errors.title, /Écrivez un titre\. Exemple/);
  r = await act(ctx, "saveAlbum", { title: "Bon", mode: "external", link: "" });
  assert.match(r.errors.link, /collez son adresse complète, par exemple https:\/\//);
  r = await act(ctx, "saveAlbum", { title: "Bon", mode: "hosted", link: "javascript:alert(1)" });
  assert.match(r.errors.link, /commence par https:\/\//);
  r = await act(ctx, "saveAlbum", { title: "Bon", mode: "hosted", date: "14/03/2025" });
  assert.match(r.errors.date, /2025-03-14/);
  assert.equal((await data.freshAlbums(ctx)).length, 0, "rien n'est créé tant qu'il y a une erreur");
  r = await act(ctx, "saveAlbum", { title: "  Fête   <b>d'été</b>\u202e  ", date: "2025-07-05", desc: "Joli.\r\n\r\n\r\n\r\nSuite", mode: "hosted", status: "draft" });
  assert.match(r.ok, /Album créé/);
  const [a] = await data.freshAlbums(ctx);
  assert.equal(a.title, "Fête <b>d'été</b>", "espaces réduits, caractère de contrôle retiré (l'échappement se fait à l'affichage)");
  assert.equal(a.status, "draft");
  assert.equal(a.slug, "fete-b-d-ete-b");
  assert.equal(a.desc, "Joli.\n\nSuite");
  assert.equal(r.redirect, `?album=${a.id}`);
});

test("album : publier demande le droit de publier ; renommer ne change jamais l'adresse ; adresses uniques et mots réservés évités", async () => {
  const ctx = ctxFor({}, { rights: ["edit"] });
  let r = await act(ctx, "saveAlbum", { title: "Public", status: "published", mode: "hosted" });
  assert.match(r.errors.status, /pas le droit de publier/);
  r = await act(ctx, "saveAlbum", { title: "Mon album", status: "draft", mode: "hosted" });
  const id = r.redirect.split("=")[1];
  const first = await data.getAlbum(ctx, id);
  r = await act(ctx, "saveAlbum", { id, title: "Tout autre titre", status: "published", mode: "hosted" });
  assert.match(r.errors.status, /pas le droit/);
  r = await act(ctx, "saveAlbum", { id, title: "Tout autre titre", status: "draft", mode: "hosted" });
  assert.match(r.ok, /Enregistré/);
  assert.equal((await data.getAlbum(ctx, id)).slug, first.slug);
  const pub = ctxFor();
  const a1 = await makeAlbum(pub, { title: "Même titre" });
  const a2 = await makeAlbum(pub, { title: "Même titre" });
  const a3 = await makeAlbum(pub, { title: "Studio" });
  const a4 = await makeAlbum(pub, { title: "Page" });
  assert.deepEqual([a1.album.slug, a2.album.slug], ["meme-titre", "meme-titre-2"]);
  assert.equal(a3.album.slug, "studio-album");
  assert.equal(a4.album.slug, "page-album");
  assert.match((await act(pub, "publish", { id: a1.id })).ok, /publié/);
  const ext = await ops.createAlbum(pub, { title: "Externe", mode: "external", link: "https://photos.example.org/x", status: "draft" });
  await breakLink(pub, ext.id);
  assert.match((await act(pub, "publish", { id: ext.id })).error, /adresse complète/, "une carte sans adresse ne peut pas être publiée");
});

test("limites : nombre d'albums (réglable, 500 au plus) ; suppression d'un album : la liste de ses photos est effacée", async () => {
  const ctx = ctxFor({ maxAlbums: 2 });
  await makeAlbum(ctx, { title: "Un" });
  const b = await makeAlbum(ctx, { title: "Deux", n: 2 });
  const full = await act(ctx, "saveAlbum", { title: "Trois", mode: "hosted" });
  assert.match(full.error, /nombre maximal d'albums \(2\)/);
  assert.equal(data.limitsOf(ctxFor({ maxAlbums: 99999 })).albums, 500);
  assert.equal(data.limitsOf(ctxFor({ maxAlbums: -4 })).albums, 1);
  assert.equal(data.limitsOf(ctxFor({ maxPhotos: 99999 })).photos, 300);
  assert.equal(data.limitsOf(ctxFor({ maxPhotoKB: 99999 })).photoBytes, 4_000_000);
  assert.equal(data.limitsOf(ctxFor({ maxTotalPhotos: 99999 })).totalPhotos, 10_000);
  assert.equal(data.limitsOf(ctxFor({ maxSide: 99999 })).side, 4096);
  assert.equal(data.limitsOf(ctxFor({ maxPhotoKB: "pas un nombre" })).photoBytes, 300_000, "valeur illisible : la valeur sûre");
  assert.match((await act(ctx, "removeAlbum", { id: b.id })).ok, /supprimé/);
  assert.equal(rows(ctx, "gallery_photos").length, 1, "la ligne des photos de l'album part aussi");
  assert.match((await act(ctx, "removeAlbum", { id: b.id })).error, /Introuvable/);
});

test("envoi : la page d'envoi demande ses bornes et le titre à l'administration (réservé aux personnes autorisées)", async () => {
  const ctx = ctxFor({ maxPhotoKB: 250, maxSide: 1200, maxPhotos: 50 });
  const d = await makeAlbum(ctx, { title: "Brouillon", n: 3, status: "draft" });
  const info = JSON.parse((await act(ctx, "studioInfo", { album: d.id })).ok);
  assert.deepEqual([info.title, info.count, info.max, info.kb, info.side, info.thumbSide, info.room], ["Brouillon", 3, 50, 250, 1200, 480, 47]);
  assert.equal(info.back, `/admin/instances/id-${ctx.instance.key}?album=${d.id}`);
  assert.match((await act(ctx, "studioInfo", { album: "inconnu" })).error, /Introuvable/);
});

test("album vers un autre service : on peut aussi y envoyer une couverture", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { title: "Gros", mode: "external", link: "https://photos.example.org/x" });
  assert.equal((await act(ctx, "addPhoto", photoFields(a.id))).ok, "Photo ajoutée.");
  assert.equal((await data.getAlbum(ctx, a.id)).shown, 1);
});

test("photos : masquer / afficher, monter / descendre / en premier (bords inclus), couverture, légende et description, suppression", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 4 });
  const id = (i) => `${a.id}.${a.photos[i]}`;
  const order = async () => (await data.loadPhotos(ctx, await data.getAlbum(ctx, a.id))).map((p) => p.id);
  assert.deepEqual(await order(), a.photos);
  assert.match((await act(ctx, "photoDown", { id: id(0) })).ok, /Ordre changé/);
  assert.deepEqual(await order(), [a.photos[1], a.photos[0], a.photos[2], a.photos[3]]);
  assert.match((await act(ctx, "photoUp", { id: id(0) })).ok, /Ordre changé/);
  assert.deepEqual(await order(), a.photos);
  assert.match((await act(ctx, "photoUp", { id: id(0) })).ok, /déjà le premier/);
  assert.match((await act(ctx, "photoDown", { id: id(3) })).ok, /déjà le dernier/);
  await act(ctx, "photoFirst", { id: id(3) });
  assert.equal((await order())[0], a.photos[3]);
  assert.match((await act(ctx, "toggleHidden", { id: id(2) })).ok, /Photo masquée/);
  assert.equal((await data.getAlbum(ctx, a.id)).shown, 3);
  assert.match((await act(ctx, "toggleHidden", { id: id(2) })).ok, /Photo affichée/);
  assert.equal((await data.getAlbum(ctx, a.id)).shown, 4);
  assert.match((await act(ctx, "makeCover", { id: id(2) })).ok, /Couverture choisie/);
  assert.equal((await data.getAlbum(ctx, a.id)).cover, a.photos[2]);
  await act(ctx, "toggleHidden", { id: id(2) });
  assert.notEqual((await data.getAlbum(ctx, a.id)).cover, a.photos[2], "une photo masquée n'est plus la couverture");
  assert.match((await act(ctx, "makeCover", { id: id(2) })).error, /masquée ne peut pas être la couverture/);
  const saved = await act(ctx, "savePhoto", { id: id(0), caption: "Nouvelle légende", alt: "Nouvelle description", hidden: "on" });
  assert.match(saved.ok, /Enregistré/);
  const p = (await data.loadPhotos(ctx, await data.getAlbum(ctx, a.id))).find((x) => x.id === a.photos[0]);
  assert.deepEqual([p.caption, p.alt, p.hidden], ["Nouvelle légende", "Nouvelle description", true]);
  assert.match((await act(ctx, "removePhoto", { id: id(0) })).ok, /retirée de l.album/);
  assert.equal((await data.getAlbum(ctx, a.id)).total, 3);
  assert.match((await act(ctx, "removePhoto", { id: id(0) })).error, /Introuvable/);
});

test("photos : des identifiants mal formés ou d'un autre album ne font rien (et ne plantent pas)", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 1 });
  const b = await makeAlbum(ctx, { title: "Autre", n: 1 });
  for (const id of ["", "x", "../../x", `${a.id}`, `${a.id}.`, `${a.id}.${a.photos[0]}.extra`, `${a.id}.A B`, `${b.id}.${a.photos[0]}`, undefined, null, 42]) {
    for (const name of ["photoUp", "photoDown", "photoFirst", "toggleHidden", "makeCover", "removePhoto", "savePhoto"]) {
      const r = await act(ctx, name, { id });
      assert.ok(r.error && !r.ok, `${name} ${String(id)}`);
    }
  }
  assert.equal((await data.getAlbum(ctx, a.id)).total, 1);
  assert.equal((await data.getAlbum(ctx, b.id)).total, 1);
});

test("ordre des albums à la main : monter / descendre ; en ordre par date, la vue d'ordre n'est pas proposée", async () => {
  const ctx = ctxFor({ sort: "manual" });
  const [a, b, c] = [await makeAlbum(ctx, { title: "A" }), await makeAlbum(ctx, { title: "B" }), await makeAlbum(ctx, { title: "C" })];
  const names = async () => (await data.freshAlbums(ctx, "manual")).map((x) => x.title);
  assert.deepEqual(await names(), ["A", "B", "C"]);
  await act(ctx, "albumDown", { id: a.id });
  assert.deepEqual(await names(), ["B", "A", "C"]);
  await act(ctx, "albumUp", { id: c.id });
  assert.deepEqual(await names(), ["B", "C", "A"]);
  assert.match((await act(ctx, "albumUp", { id: b.id })).ok, /déjà le premier/);
  assert.match(text(await panel(ctx, { order: "albums" })), /Ordre des albums/);
  const byDate = ctxFor();
  await makeAlbum(byDate, { title: "A" });
  await makeAlbum(byDate, { title: "B" });
  assert.doesNotMatch(text(await panel(byDate)), /Changer l'ordre des albums/);
  assert.match(text(await panel(byDate)), /Les albums sont montrés par date/);
});

test("panneau d'un album : grille des miniatures (version propre du cœur), photos sans description signalées, liens d'envoi et d'aperçu, place restante", async () => {
  const ctx = ctxFor();
  const d = await makeAlbum(ctx, { title: "Brouillon", n: 3, status: "draft", hidden: [1] });
  await act(ctx, "savePhoto", { id: `${d.id}.${d.photos[2]}`, caption: "", alt: "", hidden: "" });
  const blocks = await panel(ctx, { album: d.id });
  const t = text(blocks);
  const grid = blocks.find((b) => b.type === "html");
  assert.match(grid.html, /\/uploads\/[0-9a-f-]{36}\.jpg\?c=o_1_0\.5_0\.5_ffffff/);
  assert.match(grid.html, /Masquée/);
  assert.match(t, /1 photo\(s\) sans description/);
  assert.match(t, new RegExp(`/galeries/studio/${d.id}`));
  assert.match(t, new RegExp(`/galeries/apercu/${d.id}/${d.album.preview}`));
  assert.match(t, /3 photo\(s\) sur 120 au plus dans cet album/);
  const table = blocks.find((b) => b.type === "table" && b.rowIds?.[0]?.includes("."));
  assert.deepEqual(table.rowIds, d.photos.map((p) => `${d.id}.${p}`));
  assert.match(text(blocks), /Publier/);
  const photo = await panel(ctx, { album: d.id, photo: `${d.id}.${d.photos[0]}` });
  assert.match(text(photo), /Pensez à l'accessibilité/);
  assert.equal(photo.find((b) => b.type === "adminForm").fields.find((f) => f.name === "alt").value, "Description 1");
  const order = await panel(ctx, { album: d.id, order: "1" });
  assert.match(text(order), /Ordre des photos/);
  assert.match(text(order), /En premier/);
  const published = await makeAlbum(ctx, { title: "Public", n: 1 });
  assert.match(text(await panel(ctx, { album: published.id })), new RegExp(`/galeries/${published.album.slug}`));
  assert.match(text(await panel(ctx, { album: published.id })), /Retirer du site/);
});

test("panneau : plus de 50 photos : pages de 50 avec liens précédent / suivant", async () => {
  const ctx = ctxFor({ maxPhotos: 300 });
  const a = await makeAlbum(ctx, { n: 0 });
  const album = await data.getAlbum(ctx, a.id);
  const items = Array.from({ length: 120 }, (_, i) => ({ id: `p${String(i).padStart(4, "0")}`, caption: `Photo ${i + 1}`, alt: "x", hidden: false, full: "", thumb: "", url: `https://images.example.org/${i}.jpg`, turl: "", w: 0, h: 0, bytes: 0, tbytes: 0, name: "", at: Date.now() }));
  await data.writePhotos(ctx, album, items);
  await data.refreshAlbum(ctx, album, items);
  const rowsOf = (blocks) => blocks.find((b) => b.type === "table" && b.rowIds?.[0]?.includes(".")).rowIds.length;
  const one = await panel(ctx, { album: a.id });
  assert.equal(rowsOf(one), 50);
  assert.match(text(one), /Page 1 sur 3/);
  const two = await panel(ctx, { album: a.id, pg: "3" });
  assert.equal(rowsOf(two), 20);
  assert.match(text(two), /Page précédente/);
  assert.doesNotMatch(text(two), /Page suivante/);
  assert.equal(rowsOf(await panel(ctx, { album: a.id, pg: "999" })), 20, "page hors limites : la dernière");
});

test("photo par adresse : réservée aux sites autorisés ; l'erreur apparaît sous le champ « adresse »", async () => {
  const closed = ctxFor();
  const a = await makeAlbum(closed);
  assert.doesNotMatch(text(await panel(closed, { album: a.id })), /Ajouter une photo par adresse/);
  const ctx = ctxFor({ allowedHosts: "images.example.org, *.cdn.example.net" });
  const b = await makeAlbum(ctx);
  assert.match(text(await panel(ctx, { album: b.id })), /Ajouter une photo par adresse/);
  let r = await act(ctx, "addByUrl", { album: b.id, url: "ftp://x" });
  assert.match(r.errors.url, /commence par https:\/\//);
  r = await act(ctx, "addByUrl", { album: b.id, url: "https://evil.example.net/a.jpg" });
  assert.match(r.errors.url, /pas dans la liste des sites autorisés \(images\.example\.org, \*\.cdn\.example\.net\)/);
  r = await act(ctx, "addByUrl", { album: b.id, url: "https://images.example.org/a.jpg", alt: "Un chat" });
  assert.match(r.ok, /Photo ajoutée/);
  assert.equal((await data.getAlbum(ctx, b.id)).shown, 1);
});

test("demandes de retrait : liste, masquer la photo en un clic (e-mail effacé), écarter, effacer ; l'onglet et la pastille suivent", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 2 });
  const add = (over) => ctx.api.store.add("gallery_requests", { album: a.id, photo: a.photos[0], label: "Soirée de printemps #1", message: "Je suis dessus <script>alert(1)</script>", contact: "jeanne@example.org", at: new Date().toISOString(), status: "new", ...over });
  const r1 = await add({});
  const r2 = await add({ photo: "", album: "", label: "Fête d'été" });
  assert.equal(await def.adminBadge(ctx), 2);
  const t = await panel(ctx);
  const tables = t.filter((b) => b.tab === "requests" && b.type === "table");
  assert.deepEqual(tables[0].rowIds.sort(), [r1, r2].sort());
  assert.deepEqual(tables[0].rowActions.map((x) => x.action), ["maskRequest"]);
  assert.deepEqual(tables[1].rowActions.map((x) => x.action), ["dismissRequest"]);
  assert.ok([...tables[0].rowActions, ...tables[1].rowActions].every((x) => x.confirm), "chaque action demande confirmation");
  assert.match(text(t), /2 demande\(s\) de retrait/);
  assert.match((await act(ctx, "maskRequest", { id: r1 })).ok, /Photo masquée et demande traitée/);
  const photos = await data.loadPhotos(ctx, await data.getAlbum(ctx, a.id));
  assert.equal(photos.find((p) => p.id === a.photos[0]).hidden, true);
  const done = rows(ctx, "gallery_requests").find((r) => r.id === r1);
  assert.equal(done.status, "done");
  assert.equal(done.contact, undefined, "l'e-mail est effacé dès que la demande est traitée");
  assert.match((await act(ctx, "maskRequest", { id: r2 })).ok, /ne désignait pas de photo précise/);
  assert.equal(await def.adminBadge(ctx), 0);
  const r3 = await add({});
  assert.match((await act(ctx, "dismissRequest", { id: r3 })).ok, /écartée/);
  assert.equal(rows(ctx, "gallery_requests").find((r) => r.id === r3).contact, undefined);
  assert.match((await act(ctx, "eraseRequest", { id: r3 })).ok, /effacée/);
  assert.equal(rows(ctx, "gallery_requests").some((r) => r.id === r3), false);
  assert.match((await act(ctx, "eraseRequest", { id: "inconnue" })).error, /Introuvable/);
  assert.match((await act(ctx, "eraseRequest", { id: a.id })).error, /Introuvable/, "l'identifiant d'une autre sorte de ligne est refusé");
  const r4 = await add({});
  await act(ctx, "removeAlbum", { id: a.id });
  assert.match(text(await panel(ctx)), /photo ou album supprimé/);
  assert.match((await act(ctx, "maskRequest", { id: r4 })).ok, /Photo masquée|ne désignait/);
});

test("demandes de retrait : le texte des visiteurs est affiché en texte simple (jamais en HTML brut)", async () => {
  const ctx = ctxFor();
  await ctx.api.store.add("gallery_requests", { album: "", photo: "", label: `<img src=x onerror=alert(1)>`, message: `<script>alert(1)</script>`, at: new Date().toISOString(), status: "new" });
  const blocks = await panel(ctx);
  assert.equal(blocks.filter((b) => b.type === "html").length, 0, "aucun bloc HTML brut dans le panneau sans photo");
  const album = await makeAlbum(ctx, { title: `<b>x</b>`, n: 2 });
  const html = (await panel(ctx, { album: album.id })).filter((b) => b.type === "html").map((b) => b.html).join("");
  assert.doesNotMatch(html, /<b>x<\/b>|onerror/);
});

test("sauvegarde lisible : albums et photos en tableur (cellules protégées contre les formules), sans demande de retrait ni image", async () => {
  const ctx = ctxFor();
  await makeAlbum(ctx, { title: "=HYPERLINK(\"x\")", n: 1 });
  await ctx.api.store.add("gallery_requests", { album: "", photo: "", label: "secret", message: "confidentiel", contact: "jeanne@example.org", at: new Date().toISOString(), status: "new" });
  const files = await def.backup.readable(ctx);
  assert.deepEqual(files.map((f) => f.path), ["albums.csv", "photos.csv"]);
  const all = files.map((f) => f.content).join("");
  assert.match(all, /"'=HYPERLINK/);
  assert.doesNotMatch(all, /confidentiel|jeanne@example\.org|secret/);
  assert.doesNotMatch(all, /\/9j\//, "pas d'image dans la sauvegarde lisible");
});

test("hors liste : appeler l'administration avec des paramètres absurdes ne plante pas", async () => {
  const ctx = ctxFor();
  const blocks = await panel(ctx, { album: "inexistant", photo: "x.y", order: "albums", edit: "nope", new: "1", pg: "-3", starter: "1" });
  assert.ok(Array.isArray(blocks) && blocks.length > 0);
  assert.ok(admin.reasonText(ctx, { error: "full_albums", max: 5 }).includes("5"));
});
