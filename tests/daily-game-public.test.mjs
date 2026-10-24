// Jeu du jour — ce que voit le visiteur : la page, le bloc d'accueil, le petit script. La bonne réponse n'est JAMAIS dans la page.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { def, DIR, V, D, C, ctxFor, addQuestion, addMany, pageHtml, NOON } from "./helpers/dailyGameKit.mjs";

const clockAt = (ms) => { D.clock.now = () => ms; };
test.afterEach(() => { D.clock.now = () => Date.now(); });
const textsOf = (html) => JSON.parse(/<script type="application\/json" data-dg-texts>(.*?)<\/script>/s.exec(html)[1]);

test("page : la question et ses réponses sont là ; la bonne réponse, son explication et son numéro n'y sont PAS", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  await addQuestion(ctx, { q: "Capitale du pays-test ?", a: ["Ville-test-A", "Ville-test-B", "Ville-test-C"], correct: 2, e: "EXPLICATION-SECRETE-42" });
  const html = (await pageHtml(ctx)).replace(/<style>.*?<\/style>/s, "");
  for (const wanted of ["Capitale du pays-test ?", "Ville-test-A", "Ville-test-B", "Ville-test-C"]) assert.ok(html.includes(wanted), wanted);
  for (const leak of ["EXPLICATION-SECRETE-42", "is-correct", "data-correct", "data-answer", "(bonne réponse)", "goodAnswer"]) assert.ok(!html.includes(leak), `fuite : ${leak}`);
  assert.ok(!/"correct"|correct\s*[:=]\s*\d/.test(html));
  assert.ok(!/type="radio"[^>]*checked/.test(html), "aucune réponse cochée d'avance");
  assert.match(html, /<fieldset/);
  assert.match(html, /<legend/);
  const page = await def.page(ctx, { segments: [] });
  assert.equal(page.title, "Quiz du jour");
  assert.deepEqual(page.scripts, ["daily-game.js"]);
  assert.ok(!JSON.stringify(page).includes("EXPLICATION-SECRETE-42"));
});

test("page : un autre chemin est une 404", async () => {
  assert.deepEqual(await def.page(ctxFor(), { segments: ["x"] }), { notFound: true, blocks: [] });
});

test("page : le jour est celui du fuseau du site, calculé par le serveur", async () => {
  const late = Date.UTC(2026, 9, 24, 23, 30);
  const paris = ctxFor({ timezone: "Europe/Paris" });
  const utc = ctxFor({ timezone: "UTC" });
  await addMany(paris, 3); await addMany(utc, 3);
  clockAt(late);
  assert.match(await pageHtml(paris, late), /data-day="2026-10-25" data-prev="2026-10-24"/);
  assert.match(await pageHtml(utc, late), /data-day="2026-10-24" data-prev="2026-10-23"/);
});

test("page : sans question prête, un message aimable ; un brouillon n'est jamais joué", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  assert.match(await pageHtml(ctx), /Pas de question aujourd(?:'|&#39;)hui/);
  await addQuestion(ctx, { status: "draft" });
  const html = await pageHtml(ctx);
  assert.match(html, /Pas de question aujourd(?:'|&#39;)hui/);
  assert.ok(!html.includes("data-dg-form"));
});

test("page : question écrite dans une seule langue — affichée à l'autre langue avec une mention et le bon lang", async () => {
  clockAt(NOON);
  const ctx = ctxFor({}, { locale: "en" });
  await addQuestion(ctx, { q: "Question en français ?", a: ["Oui", "Non"] });
  const html = await pageHtml(ctx);
  assert.match(html, /does not exist in your language yet: it is shown in French/);
  assert.match(html, /<fieldset class="dg-set" lang="fr">/);
  const both = ctxFor({}, { locale: "en" });
  await addQuestion(both, { q: "Question ?", a: ["Oui", "Non"], en: { q: "English question?", a: ["Yes", "No"], e: "", alt: "" } });
  const html2 = await pageHtml(both);
  assert.match(html2, /English question\?/);
  assert.ok(!html2.includes("does not exist in your language"));
});

test("page : tout texte venu des données est échappé", async () => {
  clockAt(NOON);
  const bad = `</script><script>alert("x")</script><img src=x onerror=alert(1)>"'`;
  const ctx = ctxFor({ title: bad, intro: bad, playLabel: bad, streakText: `${bad} {n}`, comeBack: bad });
  await addQuestion(ctx, { q: bad, a: [bad, `${bad}2`, `${bad}3`], e: bad, cat: bad, lvl: "easy", img: "/uploads/ok.png", alt: bad });
  const html = await pageHtml(ctx);
  const card = (await V.renderCard(ctx, NOON))[1].html;
  for (const out of [html, card]) {
    assert.ok(!out.includes("<script>alert"));
    assert.ok(!/<img src=x/.test(out));
    assert.ok(!out.includes("</script><script>"));
    assert.equal((out.match(/<script/g) ?? []).length, 1, "une seule balise script : le bloc de textes");
  }
  assert.ok(textsOf(html).streakMany.includes("alert"));
});

test("page : une image n'est reprise que si elle vient du site, avec sa description", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  await addQuestion(ctx, { img: "/uploads/chat.png", alt: "Un chat noir sur un clavier" });
  assert.match(await pageHtml(ctx), /<img src="\/uploads\/chat.png" alt="Un chat noir sur un clavier"/);
  for (const img of ["https://autre.example/x.png", "javascript:alert(1)"]) {
    const other = ctxFor();
    await addQuestion(other, { img, alt: "x" });
    const h = await pageHtml(other);
    assert.ok(!h.includes("<img") && !h.includes("javascript:"));
  }
});

test("vocabulaire réglable ; par défaut des mots neutres en deux langues", async () => {
  clockAt(NOON);
  const plain = ctxFor();
  await addMany(plain, 2);
  assert.equal(textsOf(await pageHtml(plain)).comeBack, "Revenez demain pour une nouvelle question.");
  assert.equal(textsOf(await pageHtml(plain)).streakMany, "{n} jours de suite !");
  const en = ctxFor({}, { locale: "en" });
  await addMany(en, 2);
  assert.equal(textsOf(await pageHtml(en)).streakMany, "{n} days in a row!");
  assert.equal((await def.page(en, { segments: [] })).title, "Daily quiz");
  const own = ctxFor({ title: "Le défi du jour", intro: "Une question par jour.\n\nBonne chance !", streakText: "{n} jours d'affilée", comeBack: "À demain !", playLabel: "Relever le défi" });
  await addMany(own, 2);
  const mine = await pageHtml(own);
  assert.equal((await def.page(own, { segments: [] })).title, "Le défi du jour");
  assert.match(mine, /<p>Une question par jour\.<\/p><p>Bonne chance !<\/p>/);
  assert.equal(textsOf(mine).streakMany, "{n} jours d'affilée");
  assert.match(JSON.stringify(await V.renderCard(own, NOON)), /Relever le défi/);
  const noN = ctxFor({ streakText: "sans variable" });
  await addMany(noN, 1);
  assert.equal(textsOf(await pageHtml(noN)).streakMany, "{n} jours de suite !");
});

test("chronomètre : proposé et coché, décoché, ou absent ; partage décochable", async () => {
  clockAt(NOON);
  const on = ctxFor({ timerMode: "on" }); await addMany(on, 1);
  assert.match(await pageHtml(on), /data-dg-timer checked/);
  const off = ctxFor({ timerMode: "off" }); await addMany(off, 1);
  const h = await pageHtml(off);
  assert.match(h, /data-dg-timer>/);
  assert.ok(!/data-dg-timer checked/.test(h));
  const none = ctxFor({ timerMode: "none" }); await addMany(none, 1);
  assert.ok(!(await pageHtml(none)).includes("data-dg-timerbox"));
  const noShare = ctxFor({ shareButton: false }); await addMany(noShare, 1);
  assert.ok(!(await pageHtml(noShare)).includes("data-dg-copy"));
  assert.match(await pageHtml(on), /data-dg-copy/);
});

test("accessibilité : légende, cases natives, messages annoncés, bonus décochable, mouvement réduit", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  await addMany(ctx, 1);
  const html = await pageHtml(ctx);
  assert.match(html, /<legend class="dg-qtext">/);
  assert.match(html, /<label for="dg-c-[^"]+-0">/);
  assert.match(html, /role="alert"/);
  assert.match(html, /role="status"/);
  assert.match(html, /<h2 class="dg-verdict"[^>]*tabindex="-1"/);
  assert.match(html, /<input type="checkbox" data-dg-timer/);
  assert.ok(!/tabindex="[1-9]/.test(html));
  assert.match(V.CSS, /prefers-reduced-motion:no-preference/);
  assert.match(V.CSS, /:focus-visible/);
  assert.ok(!/animation:[^;}]*;/.test(V.CSS.split("@media (prefers-reduced-motion:no-preference){")[0]));
  assert.match(V.CSS, /min-height:5\d/);
});

test("habillage : couleurs du thème du site, aucune couleur codée en dur", () => {
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(V.CSS));
  assert.ok(!/\b(rgb|hsl)a?\(/.test(V.CSS));
  for (const token of ["--v-fg", "--v-bg", "--v-surface", "--v-line", "--v-accent", "--v-accent-fg", "--v-success", "--v-danger", "--v-muted"]) assert.ok(V.CSS.includes(`var(${token}`), token);
});

test("les phrases du navigateur : chaque texte que le script lit existe dans la page, en français comme en anglais", async () => {
  clockAt(NOON);
  const used = new Set([...C.CLIENT_JS.matchAll(/\btexts\.(\w+)/g)].map((m) => m[1]));
  for (const lang of ["fr", "en"]) {
    const ctx = ctxFor({}, { locale: lang });
    await addMany(ctx, 1);
    const have = textsOf(await pageHtml(ctx));
    for (const key of used) assert.ok(typeof have[key] === "string" && have[key], `${lang} : texte « ${key} » absent`);
    for (const reason of ["limit", "invalid", "busy", "net", "pick", "muted", "already", "boardNeedPseudo", "pseudo_taken", "pseudo_short", "pseudo_long", "pseudo_chars", "pseudo_banned"]) assert.ok(have[reason], `${lang} : raison « ${reason} »`);
  }
  const card = ctxFor();
  await addMany(card, 1);
  const t = JSON.parse(/data-dg-cardtexts>(.*?)<\/script>/s.exec((await V.renderCard(card, NOON))[1].html)[1]);
  for (const key of [...C.CARD_JS.matchAll(/\bt\.(\w+)/g)].map((m) => m[1])) assert.ok(t[key], `bloc d'accueil : « ${key} »`);
});

test("bloc d'accueil : invitation avec l'adresse de la page ; rien sans question ni sans page", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  assert.equal(await def.sections.today(ctx), null);
  await addMany(ctx, 2);
  const blocks = await def.sections.today(ctx);
  assert.equal(blocks[0].text, "Quiz du jour");
  assert.match(blocks[1].html, /href="\/jeu-du-jour"/);
  assert.match(blocks[1].html, /data-dg-card data-key="dg\d+" data-day="2026-10-24" data-prev="2026-10-23"/);
  assert.ok(!JSON.stringify(blocks).includes("Q1 ?"));
  const en = ctxFor({}, { locale: "en" });
  en.instance.basePath = "daily";
  await addMany(en, 1);
  assert.match((await def.sections.today(en))[1].html, /href="\/en\/daily"/);
  const none = ctxFor();
  none.instance.basePath = null;
  await addMany(none, 1);
  assert.equal(await def.sections.today(none), null);
});

test("bloc d'accueil : le petit script n'est annoncé que si on le veut, en différé", () => {
  const ctx = ctxFor();
  const slot = def.slots["layout.head"](ctx);
  assert.equal(slot[0].tags[0].src, `/m/${ctx.instance.key}/card.js?v=${C.CARD_REV}`);
  assert.equal(slot[0].tags[0].defer, true);
  assert.equal(def.slots["layout.head"](ctxFor({ homeState: false })), null);
  const nopage = ctxFor();
  nopage.instance.basePath = null;
  assert.equal(def.slots["layout.head"](nopage), null);
});

test("route card.js : GET seulement, mis en cache", async () => {
  const ctx = ctxFor();
  const get = await def.routes["card.js"](new Request("https://example.org/m/x/card.js"), ctx);
  assert.equal(get.status, 200);
  assert.match(get.headers.get("content-type"), /javascript/);
  assert.equal(get.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await get.text(), C.CARD_JS);
  assert.equal((await def.routes["card.js"](new Request("https://example.org/m/x/card.js", { method: "POST" }), ctx)).status, 405);
});

test("script de page (cœur 0.2.6) : scripts/daily-game.js est un vrai fichier de moins de 32 Ko, exactement le script du navigateur", () => {
  const file = `${DIR}/scripts/daily-game.js`;
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.ok(stat.size <= 32 * 1024);
  assert.equal(fs.readFileSync(file, "utf8"), C.CLIENT_JS, "scripts/daily-game.js doit être la copie exacte de CLIENT_JS (client.mjs) : le régénérer si client.mjs change");
});

test("script : se compile, ni cookie, ni innerHTML, ni eval, aucun autre site, rien avant la réponse", () => {
  for (const [name, code] of [["jeu", C.CLIENT_JS], ["bloc d'accueil", C.CARD_JS]]) {
    assert.doesNotThrow(() => new vm.Script(code), name);
    assert.ok(!/document\.cookie/.test(code), `${name} : cookie`);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code), `${name} : HTML construit à la main`);
    assert.ok(!/\beval\s*\(|new Function|setTimeout\(\s*["'`]/.test(code), `${name} : code dynamique`);
    assert.ok(!/https?:\/\//.test(code), `${name} : adresse d'un autre site`);
    assert.ok(!/XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts/.test(code), `${name} : autre canal réseau`);
    assert.ok(!/[^\x00-\x7f]/.test(code), `${name} : ASCII pur`);
  }
  assert.equal([...C.CLIENT_JS.matchAll(/credentials: "omit"/g)].length, 1);
  assert.equal([...C.CLIENT_JS.matchAll(/w\.fetch\(/g)].length, 1);
  assert.ok(!/fetch\(/.test(C.CARD_JS));
  const keys = [...C.CLIENT_JS.matchAll(/(?:setItem|removeItem|getItem)\(\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(keys)].sort(), ["aud-id", "dg:"].sort());
  assert.equal(C.CARD_JS.includes("setItem"), false);
});

test("script : le code de participation n'est créé que quand la personne choisit d'apparaître au classement", () => {
  assert.equal([...C.CLIENT_JS.matchAll(/token\(true\)/g)].length, 2);
  assert.ok(C.CLIENT_JS.includes("token(false)"));
});

test("pas de texte en dur dans le script : aucune phrase (elles viennent de la page, dans la langue du visiteur)", () => {
  for (const [name, code] of [["jeu", C.CLIENT_JS], ["bloc d'accueil", C.CARD_JS]]) {
    const sentences = [...code.matchAll(/"([^"\\]|\\.)*"/g)].map((m) => m[0]).filter((x) => /[a-z]{3,}\s+[a-z]{3,}\s+[a-z]{3,}/i.test(x));
    assert.deepEqual(sentences, [], `${name} : phrase en dur`);
  }
});
