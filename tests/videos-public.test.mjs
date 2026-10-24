// Vidéothèque : ce que voit le visiteur. Catalogue, catégories, recherche, pagination par curseur, page d'une vidéo (lecteur seulement après un clic), séries, données structurées, vie privée.
import test from "node:test";
import assert from "node:assert/strict";
import { blockNetwork } from "/dev/shm/core-assoc/testsupport/index.mjs";
import { ctxFor, def, P, D, seedVideos, seedCategory, seedSeries, keepThumb, pageHtml, id, messages } from "./helpers/videosKit.mjs";

const page = (ctx, segments = []) => def.page(ctx, { segments });
const srcs = (html) => [...html.matchAll(/\ssrc="([^"]*)"/g)].map((m) => m[1]);

test("un site neuf : page vide aimable, pas d'erreur", async () => {
  const r = await page(ctxFor());
  assert.equal(r.title, "Vidéos"); assert.match(r.blocks[0].html, /Pas encore de vidéos/); assert.ok(!r.notFound);
});

test("le catalogue : grille, titre échappé, durée, catégorie, étiquette gratuite ; brouillons et masquées absentes", async () => {
  const ctx = ctxFor();
  const cat = await seedCategory(ctx, "Tutoriels");
  await seedVideos(ctx, [
    { ext: id(1), title: "Premier <script>alert(1)</script>", cat, dur: 754, date: "2026-10-01", free: true },
    { ext: id(2), title: "Brouillon secret", status: "draft" }, { ext: id(3), title: "Masquée", status: "hidden" },
  ]);
  const html = await pageHtml(ctx);
  assert.match(html, /Premier &lt;script&gt;/); assert.ok(!html.includes("<script>alert"));
  assert.match(html, /12:34/); assert.match(html, /Tutoriels/); assert.match(html, />Gratuit</);
  assert.ok(!html.includes("Brouillon secret") && !html.includes("Masquée"));
  assert.ok(!html.includes('class="vl-count"'), "pas de compteur hors filtre");
});

test("RIEN ne part vers la plateforme avant le clic : ni cadre, ni image, ni script venus de YouTube ; le réseau n'est même pas appelé", async () => {
  const ctx = ctxFor();
  const [a] = await seedVideos(ctx, [{ ext: id(1), title: "Atelier" }, { ext: id(2), title: "Deux" }]);
  await keepThumb(ctx, a.n);
  await seedSeries(ctx, "Cycle", [a.n]);
  const { value: out, calls } = await blockNetwork(async () => [await page(ctx), await page(ctx, ["v", String(a.n)]), await page(ctx, ["v", String(a.n), "in", "1"]), await page(ctx, ["p", "1"])]);
  assert.equal(calls.length, 0, "aucun appel réseau pendant l'affichage");
  for (const r of out) {
    const html = r.blocks.map((b) => b.html).join("");
    assert.ok(!/<iframe/i.test(html), "pas de cadre de lecture avant le clic");
    for (const s of srcs(html)) assert.ok(s.startsWith("/"), `ressource du site seulement : ${s}`);
    assert.ok(!/ytimg|googlevideo|ggpht/i.test(html));
    assert.ok(!/<link[^>]+href="https?:/i.test(html) && !/<script[^>]+src=/i.test(html));
  }
  const one = out[1].blocks[0].html;
  assert.match(one, /class="vl-poster" href="\/videos\/v\/1-atelier\/play"/);
  assert.match(one, /data-embed="https:\/\/www\.youtube-nocookie\.com\/embed\/abcdefg0001\?rel=0&amp;playsinline=1&amp;autoplay=1"/);
  assert.match(one, /<a class="vl-btn" href="https:\/\/www\.youtube\.com\/watch\?v=abcdefg0001" target="_blank" rel="noopener noreferrer">Regarder sur YouTube<\/a>/);
  assert.deepEqual(out[1].scripts, ["videos.js"]);
});

test("la page « lecture » (sans JavaScript) a UN cadre : nocookie, identifiant exact, sandbox, droits minimaux", async () => {
  const ctx = ctxFor();
  const [a] = await seedVideos(ctx, [{ ext: id(1), title: "Atelier" }]);
  const frames = [...(await pageHtml(ctx, ["v", String(a.n), "play"])).matchAll(/<iframe[^>]*>/g)].map((m) => m[0]);
  assert.equal(frames.length, 1);
  const f = frames[0];
  assert.match(f, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/abcdefg0001\?rel=0&amp;playsinline=1&amp;autoplay=1"/);
  assert.match(f, /sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"/);
  assert.match(f, /allow="autoplay; fullscreen"/); assert.match(f, /referrerpolicy="strict-origin-when-cross-origin"/);
  assert.ok(!/allow-top-navigation|allow-forms|allow-modals/.test(f));
});

test("jamais d'adresse arbitraire dans le cadre : une vidéo à identifiant piégé n'a pas de lecteur", async () => {
  const ctx = ctxFor();
  const [a] = await seedVideos(ctx, [{ ext: id(1), title: "Normale" }]);
  const row = ctx.dumpStore().find((r) => r.collection === "vid_items" && r.data.n === a.n);
  await ctx.api.store.update(row.id, { ...row.data, ext: 'x"><script>alert(1)</script>' });
  D.invalidate(ctx);
  assert.equal(await pageHtml(ctx, ["v", String(a.n), "play"]), null);
  assert.ok(!(await pageHtml(ctx)).includes("Normale"));
});

test("une vidéo dont le lecteur est interdit n'a que le bouton « Regarder sur YouTube »", async () => {
  const ctx = ctxFor();
  const [a] = await seedVideos(ctx, [{ ext: id(1), title: "Privée", noEmbed: true }]);
  const html = await pageHtml(ctx, ["v", String(a.n)]);
  assert.ok(!/data-embed|<iframe|vl-poster" href/.test(html));
  assert.match(html, /ne permet pas de lire cette vidéo ici/);
  assert.match(html, /vl-btn vl-btn-main" href="https:\/\/www\.youtube\.com\/watch/);
  assert.ok(!/<iframe/.test(await pageHtml(ctx, ["v", String(a.n), "play"])));
});

test("brouillon, masquée, inconnue, adresses piégées : 404", async () => {
  const ctx = ctxFor();
  const [pub, draft, hidden] = await seedVideos(ctx, [{ ext: id(1), title: "A" }, { ext: id(2), title: "B", status: "draft" }, { ext: id(3), title: "C", status: "hidden" }]);
  assert.ok(!(await page(ctx, ["v", String(pub.n)])).notFound);
  for (const segs of [["v", String(draft.n)], ["v", String(hidden.n)], ["v", "999"], ["v", "abc"], ["v"], ["v", "1", "play", "x"], ["v", "1", "in"], ["v", "1", "in", "x"], ["x"], ["c", "inconnue"], ["c"], ["s"], ["after", "oups"], ["p", "9"], ["p", "x"], ["v", "1.5"], ["v", "../1"], ["v", "1e3"], ["c", "A B"], ["c", "x".repeat(60)]]) {
    assert.ok((await page(ctx, segs)).notFound, `${segs.join("/")} → 404`);
  }
});

test("filtre par catégorie, recherche (accents et majuscules), et leur combinaison, par l'adresse", async () => {
  const ctx = ctxFor();
  const masters = await seedCategory(ctx, "Masterclass"), tutos = await seedCategory(ctx, "Tutoriels");
  await seedVideos(ctx, [{ ext: id(1), title: "Éclairage doux", cat: masters, date: "2026-03-01" }, { ext: id(2), title: "Cadrage serré", cat: tutos, date: "2026-03-02" }, { ext: id(3), title: "Éclairage dur", cat: tutos, date: "2026-03-03" }]);
  const all = await pageHtml(ctx);
  assert.match(all, /aria-current="page">Toutes</); assert.match(all, /href="\/videos\/c\/masterclass"/);
  const m = await pageHtml(ctx, ["c", "masterclass"]);
  assert.match(m, /Éclairage doux/); assert.ok(!m.includes("Cadrage") && !m.includes("Éclairage dur")); assert.match(m, /aria-current="page">Masterclass</);
  const s = await pageHtml(ctx, ["s", "eclairage"]);
  assert.match(s, /Éclairage doux/); assert.match(s, /Éclairage dur/); assert.ok(!s.includes("Cadrage")); assert.match(s, /2 vidéos pour « eclairage »/);
  const both = await pageHtml(ctx, ["c", "tutoriels", "s", "eclairage"]);
  assert.ok(!both.includes("Éclairage doux") && both.includes("Éclairage dur"));
  const none = await pageHtml(ctx, ["s", "zzz"]);
  assert.match(none, /Aucun résultat/); assert.match(none, /Revenir à la liste complète/);
  const multi = await pageHtml(ctx, ["s", "eclairage-dur"]);
  assert.ok(multi.includes("Éclairage dur") && !multi.includes("Éclairage doux"));
});

test("pagination par curseur : 12 par page, chaque vidéo une seule fois, ordre stable, retour au début", async () => {
  const ctx = ctxFor();
  await seedVideos(ctx, Array.from({ length: 30 }, (_, i) => ({ ext: id(i + 1), title: `Vidéo ${String(i + 1).padStart(2, "0")}`, date: `2026-01-${String((i % 9) + 1).padStart(2, "0")}` })));
  const seen = [];
  let segs = [];
  for (let guard = 0; guard < 6; guard++) {
    const html = (await page(ctx, segs)).blocks[0].html;
    const titles = [...html.matchAll(/class="vl-ct">Vidéo (\d\d)</g)].map((m) => m[1]);
    assert.ok(titles.length <= 12);
    seen.push(...titles);
    const next = /rel="next" href="([^"]+)"/.exec(html);
    if (!next) break;
    assert.match(next[1], /^\/videos\/after\/\d{8}-\d+$/);
    segs = next[1].split("/").slice(2);
    if (guard > 0) assert.match(html, /Revenir au début/); else assert.ok(!html.includes("Revenir au début"));
  }
  assert.equal(seen.length, 30); assert.equal(new Set(seen).size, 30);
  assert.deepEqual(seen, (await D.snapshot(ctx)).items.map((x) => x.title.slice(-2)));
});

test("réglage « vidéos par page » borné (6 à 50) ; vocabulaire réglable en français et en anglais", async () => {
  const ctx = ctxFor({ perPage: 1000 });
  await seedVideos(ctx, Array.from({ length: 60 }, (_, i) => ({ ext: id(i + 1), title: `V${i + 1}` })));
  assert.equal([...(await pageHtml(ctx)).matchAll(/class="vl-ct"/g)].length, 50);
  const small = ctxFor({ perPage: 1 });
  await seedVideos(small, Array.from({ length: 10 }, (_, i) => ({ ext: id(i + 1), title: `V${i + 1}` })));
  assert.equal([...(await pageHtml(small)).matchAll(/class="vl-ct"/g)].length, 6);
  const replays = ctxFor({ vocabPlural: "Replays", vocabOne: "Replay", vocabSeries: "Parcours", vocabSeriesOne: "Parcours", vocabFree: "Offert" });
  const [a] = await seedVideos(replays, [{ ext: id(1), title: "Atelier", free: true }]);
  await seedSeries(replays, "Cycle", [a.n]);
  const r = await page(replays);
  assert.equal(r.title, "Replays"); assert.match(r.blocks[0].html, /<h2 id="vl-series-t">Parcours<\/h2>/); assert.match(r.blocks[0].html, /aria-label="Replays"/); assert.match(r.blocks[0].html, />Offert</);
  const en = ctxFor({}, { locale: "en" });
  await seedVideos(en, [{ ext: id(1), title: "Workshop" }]);
  assert.equal((await page(en)).title, "Videos"); assert.match(await pageHtml(en), /Search the videos/);
});

test("séries : ordre, précédent/suivant, « suivant » garde le mode lecture, série brouillon invisible", async () => {
  const ctx = ctxFor();
  const [a, b, c, hidden] = await seedVideos(ctx, [{ ext: id(1), title: "Un" }, { ext: id(2), title: "Deux" }, { ext: id(3), title: "Trois" }, { ext: id(4), title: "Caché", status: "hidden" }]);
  const p = await seedSeries(ctx, "Cycle", [c.n, a.n, hidden.n, b.n]);
  const draftSeries = await seedSeries(ctx, "Pas prête", [a.n], "draft");
  const sp = await page(ctx, ["p", String(p)]);
  assert.equal(sp.title, "Cycle");
  assert.deepEqual([...sp.blocks[0].html.matchAll(/class="vl-ct">([^<]+)</g)].map((m) => m[1]), ["Trois", "Un", "Deux"]);
  assert.match(sp.blocks[0].html, new RegExp(`href="/videos/v/${c.n}-trois/in/${p}/play"`));
  assert.ok((await page(ctx, ["p", String(draftSeries)])).notFound);
  const mid = await pageHtml(ctx, ["v", String(a.n), "in", String(p)]);
  assert.match(mid, /\(2 sur 3\)/);
  assert.match(mid, new RegExp(`rel="prev" href="/videos/v/${c.n}-trois/in/${p}"`)); assert.match(mid, new RegExp(`rel="next" href="/videos/v/${b.n}-deux/in/${p}"`));
  assert.match(await pageHtml(ctx, ["v", String(a.n), "in", String(p), "play"]), new RegExp(`rel="next" href="/videos/v/${b.n}-deux/in/${p}/play"`));
  const last = await pageHtml(ctx, ["v", String(b.n), "in", String(p)]);
  assert.ok(!/rel="next"/.test(last)); assert.match(last, /C&#39;est la fin|C'est la fin/);
  const outside = await pageHtml(ctx, ["v", String(a.n)]);
  assert.match(outside, /Fait partie de :/); assert.ok(!outside.includes("Pas prête"));
  assert.ok(!(await page(ctx, ["p"])).blocks[0].html.includes("Pas prête"));
  assert.equal(await pageHtml(ctx, ["v", String(hidden.n), "in", String(p)]), null);
});

test("page d'une vidéo : description, transcription repliable, partage, données structurées VideoObject", async () => {
  const ctx = ctxFor();
  const [a] = await seedVideos(ctx, [{ ext: id(1), title: 'Titre "guillemets" & <b>', desc: "Première ligne.\n\nVoir https://example.org/doc.", dur: 3723, date: "2026-10-24" }]);
  await D.updateVideo(ctx, a.n, {}, { text: "Bonjour à toutes.\nEt bienvenue <i>ici</i>." });
  await keepThumb(ctx, a.n);
  const r = await page(ctx, ["v", String(a.n)]);
  const html = r.blocks[0].html;
  assert.match(html, /<details class="vl-det"><summary>Transcription<\/summary>/);
  assert.match(html, /Bonjour à toutes\.<br>Et bienvenue &lt;i&gt;ici&lt;\/i&gt;\./);
  assert.match(html, /<a href="https:\/\/example\.org\/doc"/); assert.match(html, /1:02:03/); assert.match(html, /24 octobre 2026/);
  for (const name of ["WhatsApp", "Facebook", ">X<", "E-mail", "Copier le lien"]) assert.ok(html.includes(name), name);
  const ld = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html);
  assert.ok(ld);
  assert.ok(!ld[1].includes("<") && !ld[1].includes(">") && !ld[1].includes("&"));
  const doc = JSON.parse(ld[1]);
  assert.equal(doc["@type"], "VideoObject"); assert.equal(doc.name, 'Titre "guillemets" & <b>'); assert.equal(doc.uploadDate, "2026-10-24"); assert.equal(doc.duration, "PT1H2M3S");
  assert.equal(doc.embedUrl, "https://www.youtube-nocookie.com/embed/abcdefg0001?rel=0&playsinline=1");
  assert.match(doc.thumbnailUrl, /^https:\/\/example\.test\/m\/vid\d+\/thumb\?v=1$/); assert.match(doc.url, /^https:\/\/example\.test\/videos\/v\/1-/);
  assert.equal(r.title, 'Titre "guillemets" & <b>');
  const quiet = ctxFor({ share: false, structured: false });
  const [b] = await seedVideos(quiet, [{ ext: id(1), title: "Calme" }]);
  const q = await pageHtml(quiet, ["v", String(b.n)]);
  assert.ok(!q.includes('class="vl-share"') && !q.includes("application/ld+json"));
});

test("miniatures : copie gardée du site ; « fond sobre » = jamais d'image ; photo perso du site acceptée", async () => {
  const ctx = ctxFor();
  const [a, b] = await seedVideos(ctx, [{ ext: id(1), title: "Avec copie" }, { ext: id(2), title: "Sans copie" }]);
  await keepThumb(ctx, a.n);
  let html = await pageHtml(ctx);
  assert.equal([...html.matchAll(/<img /g)].length, 1); assert.match(html, new RegExp(`src="/m/${ctx.instance.key}/thumb\\?v=${a.n}"`));
  await D.updateVideo(ctx, b.n, { cover: "/uploads/11111111-2222-4333-8444-555555555555.jpg" });
  assert.match(await pageHtml(ctx), /src="\/uploads\/11111111-2222-4333-8444-555555555555\.jpg"/);
  const plain = ctxFor({ thumbs: "plain" });
  const [c] = await seedVideos(plain, [{ ext: id(1), title: "Sobre" }]);
  await keepThumb(plain, c.n);
  assert.equal([...(await pageHtml(plain)).matchAll(/<img /g)].length, 0);
});

test("la section d'accueil : les dernières vidéos, rien du tout s'il n'y en a pas", async () => {
  const ctx = ctxFor();
  assert.equal(await def.sections.latest(ctx, { count: 3 }), null);
  await seedVideos(ctx, Array.from({ length: 5 }, (_, i) => ({ ext: id(i + 1), title: `V${i + 1}`, date: `2026-01-0${i + 1}` })));
  const html = (await def.sections.latest(ctx, { count: 3 }))[0].html;
  assert.deepEqual([...html.matchAll(/class="vl-ct">([^<]+)</g)].map((m) => m[1]), ["V5", "V4", "V3"]);
  assert.match(html, /Tout voir/);
  assert.equal([...(await def.sections.latest(ctx, { count: 999 }))[0].html.matchAll(/class="vl-ct"/g)].length, 5);
});

test("sans chemin public, aucune page (404) ni section ; à la racine, des adresses valides ; deux instances sans rien en commun", async () => {
  const none = ctxFor({}, { basePath: null });
  await seedVideos(none, [{ ext: id(1), title: "A" }]);
  assert.ok((await page(none)).notFound); assert.equal(await def.sections.latest(none, { count: 3 }), null);
  const root = ctxFor({}, { basePath: "" });
  const [a] = await seedVideos(root, [{ ext: id(1), title: "Racine" }]);
  assert.match(await pageHtml(root), new RegExp(`href="/v/${a.n}-racine"`)); assert.ok(!(await page(root, ["v", String(a.n)])).notFound);
  const one = ctxFor(), two = ctxFor();
  await seedVideos(one, [{ ext: id(1), title: "Chez un" }]);
  assert.ok(!(await pageHtml(two)).includes("Chez un")); assert.equal(P.base(one), "/videos");
});

test("les traductions du module ont la même forme en français et en anglais", () => {
  assert.deepEqual(Object.keys(messages("fr")).sort(), Object.keys(messages("en")).sort());
});
