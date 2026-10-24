// Galeries photos : ce que voit le visiteur (liste, album, photo, aperçu, album vers un autre service, mots réglables, gabarits, accueil, outil d'envoi).
import test from "node:test";
import assert from "node:assert/strict";
import { def, ctxFor, makeAlbum, breakLink, data, ops, rows } from "./helpers/galleryKit.mjs";

const page = (ctx, ...segments) => def.page(ctx, { segments });
const html = (r) => r.blocks[0].html;
const body = (r) => html(r).replace(/<style>.*?<\/style>/g, "");
const PAYLOAD = `<script>alert("x")</script><img src=x onerror=alert(1)>`;

test("page vide : une phrase claire, aucun plantage, le script de confort est annoncé", async () => {
  const ctx = ctxFor();
  const r = await page(ctx);
  assert.equal(r.title, "Galeries photos");
  assert.match(body(r), /Aucun album pour l(?:'|&#39;)instant/);
  assert.deepEqual(r.scripts, ["gallery.js"]);
  assert.doesNotMatch(body(r), /gal-consent/, "pas de mention de consentement sans photo à montrer");
});

test("liste : seuls les albums publiés, avec couverture, date et nombre de photos ; un brouillon est introuvable", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 3 });
  const draft = await makeAlbum(ctx, { title: "Secret", n: 1, status: "draft" });
  const r = await page(ctx);
  assert.match(body(r), /Soirée de printemps/);
  assert.match(body(r), /14 mars 2025 · 3 photos/);
  assert.match(body(r), new RegExp(`href="/galeries/${a.album.slug}"`));
  assert.doesNotMatch(body(r), /Secret/);
  assert.match(body(r), /<img src="\/uploads\/[0-9a-f-]{36}\.jpg\?c=o_1_0\.5_0\.5_ffffff" alt="" loading="lazy"/, "couverture décorative (le titre nomme l'album), version propre du cœur");
  assert.equal((await page(ctx, draft.album.slug)).notFound, true);
  assert.equal((await page(ctx, "n-existe-pas")).notFound, true);
  assert.equal((await page(ctx, a.album.slug, "inconnue")).notFound, true);
  assert.equal((await page(ctx, a.album.slug, a.photos[0], "trop")).notFound, true);
});

test("liste : 12 albums par page, pagination avec précédent / suivant, page hors limites introuvable", async () => {
  const ctx = ctxFor();
  for (let i = 0; i < 30; i++) await ops.createAlbum(ctx, { title: `Album ${i}`, status: "published", mode: "external", link: "https://photos.example.org/a", date: `2025-01-${String((i % 28) + 1).padStart(2, "0")}` });
  const first = await page(ctx);
  assert.equal((body(first).match(/class="gal-card"/g) ?? []).length, 12);
  assert.match(body(first), /rel="next" href="\/galeries\/page\/2"/);
  assert.match(body(first), /Page 1 sur 3/);
  assert.match(body(first), /rel="prev" href="\/galeries"[^>]*aria-disabled="true"/);
  const last = await page(ctx, "page", "3");
  assert.equal((body(last).match(/class="gal-card"/g) ?? []).length, 6);
  assert.equal((await page(ctx, "page", "4")).notFound, true);
  assert.equal((await page(ctx, "page", "abc")).notFound, true);
  assert.equal((await page(ctx, "page", "0")).notFound, true);
  assert.equal((await page(ctx, "page", "1")).notFound, true, "la première page est l'adresse sans /page/");
});

test("album : miniatures à chargement progressif, tailles connues, descriptions, photos masquées absentes, mention de consentement et lien de retrait", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 4, hidden: [1], desc: `Ligne un\n\nLigne deux ${PAYLOAD}` });
  const r = await page(ctx, a.album.slug);
  const b = body(r);
  assert.equal((b.match(/data-gal-photo/g) ?? []).length, 3, "la photo masquée n'est pas dans la grille");
  assert.match(b, /loading="lazy" decoding="async" width="\d+" height="\d+"/);
  assert.match(b, /Description 1/);
  assert.doesNotMatch(b, /Légende 2"/, "la légende de la photo masquée n'apparaît nulle part");
  assert.match(b, /3 photos/);
  assert.match(b, /Les personnes visibles sur ces photos ont donné leur accord/);
  assert.match(b, new RegExp(`href="/galeries/retrait/${a.album.slug}">Demander le retrait d&#39;une photo`));
  assert.match(b, /data-removal="\/galeries\/retrait\//);
  assert.doesNotMatch(b, /<script>alert/, "le contenu saisi est échappé");
  assert.match(b, /&lt;script&gt;/);
  assert.match(b, /<p>Ligne un<\/p><p>Ligne deux/);
  assert.deepEqual(r.scripts, ["gallery.js"]);
  assert.equal(r.title, "Soirée de printemps");
});

test("album : sans personnes sur les photos, ni mention ni lien de retrait ; retrait coupé : plus de lien", async () => {
  const ctx = ctxFor({ people: false });
  const a = await makeAlbum(ctx, { n: 2 });
  const b = body(await page(ctx, a.album.slug));
  assert.doesNotMatch(b, /class="gal-consent"|href="[^"]*retrait|data-removal=/);
  const ctx2 = ctxFor({ removal: false });
  const a2 = await makeAlbum(ctx2, { n: 2 });
  const b2 = body(await page(ctx2, a2.album.slug));
  assert.match(b2, /gal-consent/, "la mention reste");
  assert.doesNotMatch(b2, /href="[^"]*retrait|data-removal=/);
  assert.equal((await page(ctx2, "retrait")).notFound, true);
});

test("photo : page à partager avec grande image, légende, précédente / suivante, copie du lien, retrait ; masquée ou inconnue : introuvable", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 3, hidden: [2] });
  const mid = await page(ctx, a.album.slug, a.photos[1]);
  const b = body(mid);
  assert.equal(mid.title, "Légende 2");
  assert.match(b, /<figcaption>Légende 2<\/figcaption>/);
  assert.match(b, new RegExp(`rel="prev" href="/galeries/${a.album.slug}/${a.photos[0]}"`));
  assert.doesNotMatch(b, /rel="next" href/, "la photo suivante est masquée : il n'y a pas de suivante");
  assert.match(b, /Photo 2 sur 2/);
  assert.match(b, new RegExp(`data-gal-copy="/galeries/${a.album.slug}/${a.photos[1]}"`));
  assert.match(b, /Demander le retrait/);
  assert.equal((await page(ctx, a.album.slug, a.photos[2])).notFound, true, "photo masquée");
  assert.equal((await page(ctx, a.album.slug, "zzzzzzzz")).notFound, true);
});

test("album vers un autre service : une carte claire (on quitte le site), un lien sûr, jamais d'adresse dangereuse", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { title: "Gros album", mode: "external", link: "https://photos.example.org/mon-album", n: 0 });
  const list = body(await page(ctx));
  assert.match(list, /href="https:\/\/photos\.example\.org\/mon-album" target="_blank" rel="noopener noreferrer"/);
  assert.match(list, /Ce lien ouvre photos\.example\.org dans un nouvel onglet : vous quittez ce site\./);
  const one = body(await page(ctx, a.album.slug));
  assert.match(one, /Voir l&#39;album sur photos\.example\.org/);
  assert.match(one, /vous quittez ce site/);
  assert.doesNotMatch(one, /data-gal-photo|gal-consent/);
  const bad = await ops.createAlbum(ctx, { title: "Piège", mode: "external", link: "javascript:alert(1)", status: "published" });
  assert.equal(bad.error, "link_needed", "une adresse dangereuse n'est jamais gardée");
  assert.doesNotMatch(body(await page(ctx)), /javascript:/);
  const ghost = await makeAlbum(ctx, { title: "Sans lien", mode: "external", link: "https://photos.example.org/y" });
  await breakLink(ctx, ghost.id);
  assert.doesNotMatch(body(await page(ctx)), /Sans lien/, "une carte sans adresse valide n'est pas montrée");
});

test("album avec un lien « toutes les photos ailleurs » : sentence de sortie du site sous les miniatures", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 2, link: "https://photos.example.org/tout" });
  const b = body(await page(ctx, a.album.slug));
  assert.match(b, /Voir toutes les photos sur photos\.example\.org ↗/);
  assert.match(b, /vous quittez ce site/);
});

test("aperçu d'un brouillon : seulement avec la bonne clé, bandeau visible", async () => {
  const ctx = ctxFor();
  const d = await makeAlbum(ctx, { title: "Brouillon", n: 2, status: "draft" });
  assert.equal((await page(ctx, "apercu", d.id, "mauvaise")).notFound, true);
  assert.equal((await page(ctx, "apercu", "inconnu", d.album.preview)).notFound, true);
  const r = await page(ctx, "apercu", d.id, d.album.preview);
  assert.match(body(r), /Aperçu : cet album n&#39;est pas encore publié/);
  assert.match(body(r), /<img src="\/uploads\/[0-9a-f-]{36}\.jpg\?c=/);
  assert.doesNotMatch(body(r), new RegExp(d.album.preview), "la clé d'aperçu n'est écrite nulle part dans la page");
  const p = await page(ctx, "apercu", d.id, d.album.preview, d.photos[0]);
  assert.match(body(p), /Aperçu/);
  assert.equal((await page(ctx, "apercu", d.id)).notFound, true);
});

test("mots réglables : titre, introduction, lien de retour, mention, lien de retrait ; texte échappé", async () => {
  const ctx = ctxFor({ title: "Nos souvenirs", intro: `Bienvenue ${PAYLOAD}`, backLabel: "Tous les souvenirs", consent: "Accord donné par tous.", removalLabel: "Retirer ma photo" });
  const a = await makeAlbum(ctx, { n: 1 });
  const list = await page(ctx);
  assert.equal(list.title, "Nos souvenirs");
  assert.match(body(list), /Bienvenue &lt;script&gt;/);
  assert.doesNotMatch(body(list), /<script>alert/);
  const one = body(await page(ctx, a.album.slug));
  assert.match(one, /← Tous les souvenirs/);
  assert.match(one, /Accord donné par tous\. <a href="[^"]+">Retirer ma photo<\/a>/);
  assert.match(one, /data-t-removal="Retirer ma photo"/);
});

test("gabarits : le point de départ change les mots, l'ordre et les dates PAR DÉFAUT, sans écraser un réglage rempli", async () => {
  const ctx = ctxFor();
  await makeAlbum(ctx, { title: "Ancien", date: "2024-01-01", n: 1 });
  await makeAlbum(ctx, { title: "Récent", date: "2025-06-01", n: 1 });
  const r = body(await page(ctx));
  assert.ok(r.indexOf("Récent") < r.indexOf("Ancien"), "sans gabarit : du plus récent au plus ancien");
  assert.match(body(await page(ctx)), /1 juin 2025/);
  await data.saveMeta(ctx, "portfolio");
  const pf = await page(ctx);
  assert.equal(pf.title, "Portfolio");
  assert.doesNotMatch(body(pf), /juin 2025/, "le portfolio n'affiche pas de date");
  await data.saveMeta(ctx, "retro");
  assert.equal((await page(ctx)).title, "Rétrospectives");
  const ctx2 = ctxFor({ title: "Titre à moi", dates: "no", sort: "manual" });
  await makeAlbum(ctx2, { title: "Premier", date: "2024-01-01", n: 1 });
  await makeAlbum(ctx2, { title: "Second", date: "2025-06-01", n: 1 });
  await data.saveMeta(ctx2, "retro");
  const mine = await page(ctx2);
  assert.equal(mine.title, "Titre à moi");
  assert.ok(body(mine).indexOf("Premier") < body(mine).indexOf("Second"), "ordre à la main : celui des positions");
  assert.doesNotMatch(body(mine), /juin 2025/);
});

test("anglais : la page, la visionneuse et les mentions parlent anglais (parité des textes)", async () => {
  const ctx = ctxFor({}, { locale: "en" });
  const a = await makeAlbum(ctx, { n: 2 });
  assert.equal((await page(ctx)).title, "Photo galleries");
  const b = body(await page(ctx, a.album.slug));
  assert.match(b, /The people shown in these photos agreed/);
  assert.match(b, /Ask for a photo to be removed/);
  assert.match(b, /data-t-close="Close"/);
  assert.match(b, /href="\/en\/galeries\/retrait\//, "les liens gardent la langue");
});

test("données structurées ImageGallery : éteintes d'office, échappées quand on les active, jamais pour un brouillon", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { title: `Titre </script><b>`, n: 2 });
  assert.doesNotMatch(html(await page(ctx, a.album.slug)), /ld\+json/);
  const on = ctxFor({ markup: true });
  const b = await makeAlbum(on, { title: `Titre </script><b>`, n: 2 });
  const h = html(await page(on, b.album.slug));
  const m = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(h);
  assert.ok(m, "la balise est là");
  assert.doesNotMatch(m[1], /<\/script>|<b>/, "rien ne peut fermer la balise");
  const doc = JSON.parse(m[1]);
  assert.equal(doc["@type"], "ImageGallery");
  assert.equal(doc.image.length, 2);
  assert.match(doc.image[0].contentUrl, /^https:\/\/example\.test\/uploads\/[0-9a-f-]{36}\.jpg\?c=/);
  const d = await makeAlbum(on, { title: "Brouillon", n: 1, status: "draft" });
  assert.doesNotMatch(html(await page(on, "apercu", d.id, d.album.preview)), /ld\+json/);
});

test("accueil : les derniers albums, rien si rien à montrer", async () => {
  const ctx = ctxFor();
  assert.equal(await def.sections.latest(ctx, { count: 3 }), null);
  for (let i = 0; i < 5; i++) await makeAlbum(ctx, { title: `Album ${i}`, date: `2025-0${i + 1}-01`, n: 1 });
  const blocks = await def.sections.latest(ctx, { count: 2 });
  assert.equal(blocks[0].type, "heading");
  assert.equal((blocks[1].html.match(/class="gal-card"/g) ?? []).length, 2);
  assert.match(blocks[1].html, /Album 4/);
  assert.equal(blocks.at(-1).type, "links");
  assert.equal((await def.sections.latest(ctx, { count: "n'importe quoi" }))[1].html.match(/class="gal-card"/g).length, 3);
  assert.equal((await def.sections.latest(ctx, { count: 999 }))[1].html.match(/class="gal-card"/g).length, 5, "6 au plus");
});

test("photos chez un autre site : adresses autorisées seulement, l'origine du visiteur n'est pas transmise", async () => {
  const ctx = ctxFor({ allowedHosts: "images.example.org" });
  const made = await ops.createAlbum(ctx, { title: "Dehors", status: "published" });
  assert.equal((await ops.addExternalPhoto(ctx, made.id, { url: "https://images.example.org/a.jpg", alt: "Un chat", hidden: false })).ok, true);
  assert.equal((await ops.addExternalPhoto(ctx, made.id, { url: "https://evil.example.net/a.jpg" })).error, "host_not_allowed");
  assert.equal((await ops.addExternalPhoto(ctx, made.id, { url: "http://images.example.org/a.jpg" })).error, "bad_url");
  assert.equal((await ops.addExternalPhoto(ctx, made.id, { url: "javascript:alert(1)" })).error, "bad_url");
  const closed = ctxFor();
  const m2 = await ops.createAlbum(closed, { title: "Fermé", status: "published" });
  assert.equal((await ops.addExternalPhoto(closed, m2.id, { url: "https://images.example.org/a.jpg" })).error, "no_hosts");
  const slug = (await data.getAlbum(ctx, made.id)).slug;
  assert.match(body(await page(ctx, slug)), /src="https:\/\/images\.example\.org\/a\.jpg"[^>]*referrerpolicy="no-referrer"/);
  const wild = ctxFor({ allowedHosts: "*.example.org" });
  const m3 = await ops.createAlbum(wild, { title: "Joker", status: "published" });
  assert.equal((await ops.addExternalPhoto(wild, m3.id, { url: "https://cdn.example.org/x.jpg" })).ok, true);
  assert.equal((await ops.addExternalPhoto(wild, m3.id, { url: "https://example.org/x.jpg" })).error, "host_not_allowed", "le domaine nu n'est pas un sous-domaine");
  assert.equal((await ops.addExternalPhoto(wild, m3.id, { url: "https://notexample.org/x.jpg" })).error, "host_not_allowed");
});

test("outil d'envoi : une coquille sans donnée privée (ni titre d'album), avec l'identifiant de l'instance et de l'album", async () => {
  const ctx = ctxFor();
  const d = await makeAlbum(ctx, { title: "TITRE-SECRET-DU-BROUILLON", n: 0, status: "draft" });
  const r = await page(ctx, "studio", d.id);
  assert.deepEqual(r.scripts, ["gallery-studio.js"]);
  assert.doesNotMatch(html(r), /TITRE-SECRET/);
  const cfg = JSON.parse(/data-config="([^"]*)"/.exec(html(r))[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
  assert.equal(cfg.instance, ctx.instance.id);
  assert.equal(cfg.album, d.id);
  assert.equal(cfg.endpoint, "/api/admin/modules/");
  assert.ok(cfg.texts.studioSend && cfg.texts.studioErrType);
  assert.equal((await page(ctx, "studio")).notFound, true);
  assert.equal((await page(ctx, "studio", "a b")).notFound, true);
  assert.equal(rows(ctx, "gallery_albums").length, 1);
});

test("demande de retrait : formulaire général, formulaire pour une photo, pages de réponse ; photo inconnue introuvable", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 2, hidden: [1] });
  const general = body(await page(ctx, "retrait"));
  assert.match(general, /name="which"/);
  assert.match(general, /name="website"/, "champ piège");
  assert.match(general, /action="\/m\/gal\d+\/removal\?lang=fr"/);
  const one = body(await page(ctx, "retrait", a.album.slug, a.photos[0]));
  assert.match(one, /type="hidden" name="photo" value="/);
  assert.match(one, /Photo concernée : Soirée de printemps, photo 1/);
  assert.doesNotMatch(one, /name="which"/);
  assert.equal((await page(ctx, "retrait", a.album.slug, a.photos[1])).notFound, true, "photo masquée");
  assert.equal((await page(ctx, "retrait", "inconnu", "abcd")).notFound, true);
  assert.match(body(await page(ctx, "retrait", "merci")), /Votre demande est bien arrivée/);
  assert.match(body(await page(ctx, "retrait", "erreur")), /n&#39;a pas pu être envoyée/);
  assert.equal((await page(ctx, "retrait", a.album.slug)).notFound, undefined);
});

test("le visiteur n'apprend rien de privé : ni clé d'aperçu, ni adresse de l'administration, ni titre d'un brouillon", async () => {
  const ctx = ctxFor();
  const pub = await makeAlbum(ctx, { n: 1 });
  const d = await makeAlbum(ctx, { title: "Brouillon discret", n: 1, status: "draft" });
  const all = [body(await page(ctx)), body(await page(ctx, pub.album.slug)), body(await page(ctx, pub.album.slug, pub.photos[0])), body(await page(ctx, "retrait"))].join("\n");
  assert.ok(!all.includes(d.album.preview) && !all.includes(pub.album.preview));
  assert.doesNotMatch(all, /\/admin\//);
  assert.doesNotMatch(all, /Brouillon discret/);
});
