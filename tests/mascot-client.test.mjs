// Mascotte — le script des visiteurs, essayé dans un navigateur factice avec une horloge qu'on avance à la main :
// délai, une apparition par visite, limite du jour, jamais deux fois la même phrase, fermer / réduire / couper, petit écran, mouvement réduit,
// pages concernées, stockage refusé, texte jamais pris pour du HTML.
import test from "node:test";
import assert from "node:assert/strict";
import { client, face, model as M, publishedCtx, assets } from "./helpers/mascotKit.mjs";
import { makeBrowser } from "./helpers/mascotDom.mjs";

const UI = { x: "Fermer", p: "Réduire en pastille", u: "Se montrer normalement", m: "Ne plus afficher", g: "Voir", o: "Parler avec Pixel" };
const CFG = { k: "mascot", l: "fr", b: "/m/mascot", c: "/m/mascot/mascot.css?v=t", p: "r", w: "all", g: [], d: 8, s: 8, m: 3, n: "Pixel", i: null, u: UI };
const codeFor = (over = {}) => `(${client.mascotClient.toString()})(${JSON.stringify({ ...CFG, ...over })},${face.drawFace.toString()},${M.pathMatches.toString()});`;
const LINES = [
  { id: "p1", kind: "hello", text: "Bonjour" }, { id: "p2", kind: "hello", text: "Salut" },
  { id: "p3", kind: "tip", text: "Astuce un" }, { id: "p4", kind: "tip", text: "Astuce deux" },
  { id: "p5", kind: "news", text: "Annonce {{t:2026-11-14T19:30:00.000Z}}", href: "https://example.org/x" },
];
const boot = (cfg = {}, browser = {}) => { const env = makeBrowser({ lines: LINES, ...browser }); env.load(codeFor(cfg)); return env; };
const S = 1000;

test("elle attend le délai (8 s), demande les phrases UNE fois, dit bonjour puis une annonce, puis se range", async () => {
  const env = boot();
  await env.advance(7 * S);
  assert.equal(env.fetches.length, 0);
  assert.equal(env.root(), null);
  await env.advance(1 * S + 50);
  assert.equal(env.fetches.length, 1);
  assert.match(env.fetches[0].url, /^\/m\/mascot\/lines\?lang=fr&path=%2F$/);
  assert.equal(env.fetches[0].opts.credentials, "omit");
  assert.ok(["Bonjour", "Salut"].includes(env.bubbleText()));
  assert.equal(env.body.querySelector(".mc-n").textContent, "Pixel");
  assert.equal(env.root().getAttribute("aria-label"), "Pixel");
  assert.ok(env.root().has("mc-r"));
  await env.advance(9 * S);
  assert.match(env.bubbleText(), /^Annonce .*novembre/);
  const link = env.body.querySelector(".mc-a");
  assert.deepEqual([link.href, link.rel, link.textContent], ["https://example.org/x", "noopener noreferrer", "Voir"]);
  await env.advance(30 * S);
  assert.equal(env.root(), null);
  assert.equal(env.fetches.length, 1);
  const L = JSON.parse(env.ls.getItem("mascot.mascot"));
  assert.equal(L.n, 2);
  assert.equal(L.seen.length, 2);
  assert.equal(JSON.parse(env.ss.getItem("mascot.mascot")).done, 1);
});

test("une apparition par visite : sur les pages suivantes de la même visite, elle ne revient pas", async () => {
  const first = boot();
  await first.advance(60 * S);
  const next = boot({}, { local: first.ls.dump(), session: first.ss.dump(), now: first.now + 60 * S });
  await next.advance(120 * S);
  assert.equal(next.fetches.length, 0);
  assert.equal(next.root(), null);
});

test("deux onglets : pas de nouvelle apparition avant 20 minutes ; plus tard, pas de nouvelle salutation", async () => {
  const first = boot();
  await first.advance(60 * S);
  const other = boot({}, { local: first.ls.dump(), session: {}, now: first.now + 5 * 60 * S });
  await other.advance(60 * S);
  assert.equal(other.fetches.length, 0);
  const later = boot({}, { local: first.ls.dump(), session: {}, now: first.now + 25 * 60 * S });
  await later.advance(9 * S);
  assert.equal(later.fetches.length, 1);
  assert.ok(later.root());
  assert.ok(!["Bonjour", "Salut"].includes(later.bubbleText()));
});

test("limite du jour : 3 messages au plus ; le lendemain, le compteur repart ; réglable", async () => {
  const base = boot();
  await base.advance(60 * S);
  const v2 = boot({}, { local: base.ls.dump(), session: {}, now: base.now + 30 * 60 * S });
  await v2.advance(60 * S);
  assert.equal(JSON.parse(v2.ls.getItem("mascot.mascot")).n, 3);
  const v3 = boot({}, { local: v2.ls.dump(), session: {}, now: v2.now + 30 * 60 * S });
  await v3.advance(60 * S);
  assert.equal(v3.fetches.length, 0);
  const tomorrow = boot({}, { local: v2.ls.dump(), session: {}, now: v2.now + 24 * 3600 * S });
  await tomorrow.advance(20 * S);
  assert.ok(tomorrow.root());
  const one = boot({ m: 1 });
  await one.advance(60 * S);
  assert.equal(JSON.parse(one.ls.getItem("mascot.mascot")).n, 1);
});

test("jamais deux fois de suite la même chose : 60 visites avec très peu de phrases", async () => {
  let local = {}, now = Date.UTC(2026, 9, 1, 9, 0, 0);
  const said = [];
  for (let i = 0; i < 60; i++) {
    const env = boot({}, { local, session: {}, now, lines: [{ id: "a", kind: "tip", text: "A" }, { id: "b", kind: "tip", text: "B" }, { id: "c", kind: "hello", text: "C" }] });
    await env.advance(8 * S + 50);
    const seen = [];
    for (let k = 0; k < 4; k++) { const t = env.bubbleText(); if (t && seen[seen.length - 1] !== t) seen.push(t); await env.advance(12 * S); }
    said.push(...seen);
    local = env.ls.dump();
    now += 26 * 3600 * S;
  }
  assert.ok(said.length > 60);
  for (let i = 1; i < said.length; i++) assert.notEqual(said[i], said[i - 1], `répétition à ${i}`);
});

test("une seule phrase possible, déjà dite en dernier : elle se tait", async () => {
  const env = boot({}, { lines: [{ id: "a", kind: "tip", text: "Seule" }], local: { "mascot.mascot": JSON.stringify({ day: "2026-10-24", n: 1, last: "a", seen: ["a"], at: 0 }) } });
  await env.advance(60 * S);
  assert.equal(env.root(), null);
});

test("coupée pour toujours : rien du tout ; le bouton « Ne plus afficher » coupe pour toujours dans le navigateur seulement", async () => {
  const muted = boot({}, { local: { "mascot.mascot": JSON.stringify({ mute: 1 }) } });
  await muted.advance(120 * S);
  assert.equal(muted.fetches.length, 0);
  assert.equal(muted.root(), null);
  const env = boot();
  await env.advance(9 * S);
  env.buttonByLabel("Ne plus afficher").click();
  await env.advance(1 * S);
  assert.equal(env.root(), null);
  assert.equal(JSON.parse(env.ls.getItem("mascot.mascot")).mute, 1);
  const again = boot({}, { local: env.ls.dump(), session: {}, now: env.now + 48 * 3600 * S });
  await again.advance(60 * S);
  assert.equal(again.fetches.length, 0);
});

test("la croix ferme pour la visite (nom accessible), sans rien couper pour toujours", async () => {
  const env = boot();
  await env.advance(9 * S);
  const x = env.body.querySelector(".mc-x");
  assert.equal(x.getAttribute("aria-label"), "Fermer");
  x.click();
  await env.advance(1 * S);
  assert.equal(env.root(), null);
  assert.ok(!JSON.parse(env.ls.getItem("mascot.mascot")).mute);
  const same = boot({}, { local: env.ls.dump(), session: env.ss.dump(), now: env.now + 5 * S });
  await same.advance(60 * S);
  assert.equal(same.fetches.length, 0);
});

test("pastille : reste endormie sans bulle ; page suivante sans rien demander ; un clic la réveille sans compter dans la limite du jour", async () => {
  const env = boot();
  await env.advance(9 * S);
  env.buttonByLabel("Réduire en pastille").click();
  assert.equal(env.bubble(), null);
  assert.ok(env.root().has("mc-pill"));
  assert.equal(JSON.parse(env.ls.getItem("mascot.mascot")).pill, 1);
  const page2 = boot({}, { local: env.ls.dump(), session: env.ss.dump(), now: env.now + 60 * S, path: "/autre" });
  await page2.advance(2 * S);
  assert.ok(page2.root().has("mc-pill"));
  assert.equal(page2.fetches.length, 0);
  page2.body.querySelector(".mc-av").click();
  await page2.advance(10);
  assert.equal(page2.fetches.length, 1);
  assert.ok(page2.bubble());
  assert.equal(JSON.parse(page2.ls.getItem("mascot.mascot")).n, JSON.parse(env.ls.getItem("mascot.mascot")).n);
  page2.buttonByLabel("Se montrer normalement").click();
  await page2.advance(1 * S);
  assert.equal(JSON.parse(page2.ls.getItem("mascot.mascot")).pill, 0);
  assert.equal(page2.root(), null);
});

test("petit écran : jamais de bulle seule — pastille avec un point qui s'efface ; la bulle s'ouvre au toucher", async () => {
  const env = boot({}, { small: true });
  await env.advance(9 * S);
  assert.equal(env.bubble(), null);
  assert.ok(env.root().has("mc-pill") && env.body.querySelector(".mc-dot"));
  assert.equal(JSON.parse(env.ls.getItem("mascot.mascot") || "{}").n ?? 0, 0);
  await env.advance(16 * S);
  assert.equal(env.root(), null);
  const touched = boot({}, { small: true });
  await touched.advance(9 * S);
  touched.body.querySelector(".mc-av").click();
  assert.ok(touched.bubble() && !touched.root().has("mc-pill"));
  assert.ok(["Bonjour", "Salut"].includes(touched.bubbleText()));
  assert.equal(JSON.parse(touched.ls.getItem("mascot.mascot")).n, 1);
});

test("mouvement réduit : aucune classe d'animation, disparition immédiate", async () => {
  const env = boot({}, { reduced: true });
  await env.advance(9 * S);
  assert.ok(!env.root().has("mc-in") && !env.root().has("mc-hi"));
  env.body.querySelector(".mc-x").click();
  assert.equal(env.root(), null);
  const normal = boot();
  await normal.advance(9 * S);
  assert.ok(normal.root().has("mc-in"));
  normal.body.querySelector(".mc-x").click();
  assert.ok(normal.root().has("mc-out"));
  await normal.advance(400);
  assert.equal(normal.root(), null);
});

test("pages : accueil seulement, certaines pages, préfixe de langue ignoré", async () => {
  let env = boot({ w: "home" }, { path: "/faq" });
  await env.advance(60 * S);
  assert.equal(env.fetches.length, 0);
  env = boot({ w: "home" }, { path: "/" });
  await env.advance(9 * S);
  assert.ok(env.root());
  env = boot({ w: "home", l: "en" }, { path: "/en" });
  await env.advance(9 * S);
  assert.ok(env.root());
  env = boot({ w: "some", g: ["/blog/*"], l: "en" }, { path: "/en/blog/article/" });
  await env.advance(9 * S);
  assert.ok(env.root());
  assert.match(env.fetches[0].url, /path=%2Fblog%2Farticle/);
  env = boot({ w: "some", g: ["/blog/*"] }, { path: "/boutique" });
  await env.advance(60 * S);
  assert.equal(env.fetches.length, 0);
});

test("stockage refusé : elle ne se montre pas, sans erreur", async () => {
  const env = boot({}, { storage: false });
  await env.advance(120 * S);
  assert.equal(env.fetches.length, 0);
  assert.equal(env.root(), null);
});

test("le site ne répond pas ou n'a rien à dire : discrète, et ne redemande pas pendant la visite", async () => {
  for (const browser of [{ fetchOk: false }, { lines: [] }, { lines: [{ id: "x" }, null, { id: "y", kind: "inconnu", text: "?" }] }]) {
    const env = boot({}, browser);
    await env.advance(30 * S);
    assert.equal(env.root(), null);
    assert.equal(env.fetches.length, 1);
    const next = boot({}, { ...browser, local: env.ls.dump(), session: env.ss.dump(), now: env.now });
    await next.advance(60 * S);
    assert.equal(next.fetches.length, 0);
  }
});

test("la bulle ne se ferme pas pendant le survol ; Échap la ferme", async () => {
  const env = boot();
  await env.advance(9 * S);
  const bub = env.bubble();
  bub.dispatch("mouseenter");
  await env.advance(90 * S);
  assert.ok(env.bubble());
  bub.dispatch("mouseleave");
  await env.advance(4 * S);
  assert.notEqual(env.bubble(), bub);
  const again = boot();
  await again.advance(9 * S);
  again.bubble().dispatch("keydown", { key: "Escape" });
  await again.advance(1 * S);
  assert.equal(again.root(), null);
});

test("onglet caché : elle attend ; bandeau des cookies présent : elle attend qu'il parte", async () => {
  let env = boot({}, { hidden: true });
  await env.advance(60 * S);
  assert.equal(env.fetches.length, 0);
  env.visibility(false);
  await env.advance(2 * S);
  assert.equal(env.fetches.length, 1);
  env = boot({}, { cookieTray: true });
  await env.advance(20 * S);
  assert.equal(env.fetches.length, 0);
  env.tray = false;
  await env.advance(4 * S);
  assert.ok(env.root());
});

test("?mascot=voir : tout de suite, oublie les choix du navigateur, nettoie l'adresse", async () => {
  const env = boot({}, { search: "?mascot=voir", local: { "mascot.mascot": JSON.stringify({ mute: 1, pill: 1, n: 9, day: "2026-10-24" }) } });
  await env.advance(1 * S);
  assert.ok(env.root());
  assert.deepEqual(env.history.replaced[0].slice(1), ["", "/"]);
  const L = JSON.parse(env.ls.getItem("mascot.mascot"));
  assert.ok(!L.mute && !L.pill);
  assert.equal(boot({}, { search: "?a=1&mascot=voir", path: "/page" }).history.replaced[0][2], "/page?a=1");
});

test("la phrase est du TEXTE : jamais de HTML venu du site, jamais de lien dangereux", async () => {
  const env = boot({}, { lines: [{ id: "h", kind: "hello", text: "<img src=x onerror=alert(1)> <b>gras</b>", href: "javascript:alert(1)" }] });
  await env.advance(9 * S);
  assert.equal(env.bubbleText(), "<img src=x onerror=alert(1)> <b>gras</b>");
  assert.equal(env.body.querySelector(".mc-a"), null);
  let n = 0;
  env.bubble().walk((c) => { if (c.tag === "img" || c.tag === "b") n++; });
  assert.equal(n, 0);
  const odd = boot({ n: "<script>x</script>" }, { lines: [{ id: "h", kind: "hello", text: "A", href: "//evil.example" }] });
  await odd.advance(9 * S);
  assert.equal(odd.body.querySelector(".mc-n").textContent, "<script>x</script>");
  assert.equal(odd.body.querySelector(".mc-a"), null);
});

test("sa propre image : image avec description, ronde ou carrée ; dessin inclus : SVG", async () => {
  let img = null;
  const find = (env) => env.root().walk((c) => { if (c.tag === "img") img = c; });
  const env = boot({ i: { s: "https://example.org/a.png", a: "Un renard", r: true } });
  await env.advance(9 * S);
  find(env);
  assert.deepEqual([img.alt, img.src], ["Un renard", "https://example.org/a.png"]);
  assert.ok(img.has("mc-rd"));
  assert.equal(env.body.querySelector(".mc-av").getAttribute("aria-label"), "Parler avec Pixel");
  const sq = boot({ i: { s: "https://example.org/a.png", a: "Un renard", r: false } });
  await sq.advance(9 * S);
  find(sq);
  assert.ok(img.has("mc-sq"));
  const drawn = boot();
  await drawn.advance(9 * S);
  assert.match(drawn.body.querySelector(".mc-av").innerHTML, /^<svg class="mc-svg" viewBox="0 0 64 64" aria-hidden="true"/);
});

test("la feuille de style n'est chargée qu'au moment de se montrer ; un clic sur la mascotte ferme la bulle", async () => {
  const env = boot();
  await env.advance(7 * S);
  assert.equal(env.document.getElementById("mc-css"), null);
  await env.advance(2 * S);
  assert.equal(env.document.getElementById("mc-css").href, "/m/mascot/mascot.css?v=t");
  env.body.querySelector(".mc-av").click();
  assert.equal(env.bubble(), null);
});

test("le script est petit et ne fait rien de dangereux", async () => {
  const built = await assets.buildClient(await publishedCtx());
  assert.ok(Buffer.byteLength(built.code) <= 12 * 1024, `${Buffer.byteLength(built.code)} octets`);
  assert.ok(!/\b(eval|Function\s*\(|document\.write|XMLHttpRequest|WebSocket|sendBeacon|document\.cookie|new Audio|\.play\()/.test(built.code));
  assert.ok(!/innerHTML\s*=(?!=)/.test(client.mascotClient.toString().replace("av.innerHTML = face(mood)", "")));
  assert.ok(!/(<script|<\/script)/i.test(built.code));
  new (await import("node:vm")).Script(built.code);
});
