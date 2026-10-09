import test from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./helpers/moduleLoader.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { assertValidManifest, assertDefinitionMatchesManifest, assertSettingsSane, assertLocalesParity, settingsDefaults } from "./helpers/builtinChecks.mjs";

const hero = await loadModule("modules/hero");

// ───────── hero ─────────
test("hero : manifeste valide, section « hero » déclarée et implémentée, onboarding sur l'accueil", async () => {
  const m = await assertValidManifest(hero.manifest);
  assertDefinitionMatchesManifest(m, hero.definition);
  assertSettingsSane(m);
  assert.deepEqual(m.sections.map((s) => s.id), ["hero"]);
  assert.deepEqual(m.onboarding, { home: { section: "hero" } });
  assert.ok(m.onboarding.home.section === m.sections[0].id, "l'onboarding pointe vers une section existante");
  assert.deepEqual(hero.locales, {});
  assertLocalesParity(hero.locales);
});

test("hero : réglages — title/text traduisibles, showLogo vrai par défaut", async () => {
  const m = await assertValidManifest(hero.manifest);
  const by = Object.fromEntries(m.settings.map((s) => [s.key, s]));
  assert.equal(by.title.translatable, true);
  assert.equal(by.text.translatable, true);
  assert.equal(by.showLogo.default, true);
  assert.deepEqual(Object.keys(settingsDefaults(m)).sort(), ["showLogo", "text", "title", "videoSound"]);
  assert.equal(by.video.type, "video");
  assert.equal(by.videoSound.default, false);
});

test("hero : sans réglages, retombe sur le nom, l'accroche et le logo du site", async () => {
  const ctx = fakeCtx({ settings: { showLogo: true }, site: { name: "Mon Site", tagline: "Une accroche", logo: "/uploads/logo.png" } });
  const [b] = await hero.definition.sections.hero(ctx);
  assert.deepEqual(b, { type: "hero", title: "Mon Site", text: "Une accroche", image: "/uploads/logo.png" });
});

test("hero : les réglages priment sur le site", async () => {
  const ctx = fakeCtx({ settings: { title: "Salut", text: "Bienvenue", showLogo: true }, site: { name: "S", tagline: "T", logo: "/l.png" } });
  const [b] = await hero.definition.sections.hero(ctx);
  assert.equal(b.title, "Salut");
  assert.equal(b.text, "Bienvenue");
});

test("hero : showLogo=false ou pas de logo → pas d'image ; pas d'accroche → texte indéfini", async () => {
  let [b] = await hero.definition.sections.hero(fakeCtx({ settings: { showLogo: false }, site: { name: "S", tagline: "", logo: "/l.png" } }));
  assert.equal(b.image, undefined);
  assert.equal(b.text, undefined);
  [b] = await hero.definition.sections.hero(fakeCtx({ settings: { showLogo: true }, site: { name: "S", tagline: "x", logo: null } }));
  assert.equal(b.image, undefined);
  // réglage absent (undefined) : pas d'image tant que le défaut n'est pas appliqué par le cœur
  [b] = await hero.definition.sections.hero(fakeCtx({ settings: {}, site: { name: "S", tagline: "", logo: "/l.png" } }));
  assert.equal(b.image, undefined);
});

test("hero : la locale du contexte est transmise à api.site", async () => {
  const seen = [];
  const ctx = fakeCtx({ locale: "fr", settings: {} });
  const orig = ctx.api.site;
  ctx.api.site = async (l) => { seen.push(l); return orig(l); };
  await hero.definition.sections.hero(ctx);
  assert.deepEqual(seen, ["fr"]);
});

test("hero : le texte saisi est renvoyé tel quel comme donnée (jamais du HTML préfabriqué)", async () => {
  const evil = `<img src=x onerror=alert(1)>`;
  const [b] = await hero.definition.sections.hero(fakeCtx({ settings: { title: evil, text: evil }, site: { name: "S", tagline: "", logo: null } }));
  assert.equal(b.type, "hero");
  assert.equal(b.title, evil, "le bloc est une donnée ; le rendu React échappe");
  assert.equal(Object.keys(b).some((k) => /html/i.test(k)), false);
});


const col = (key, name, basePath = key) => ({ key, name, basePath });
const entry = (o = {}) => ({ title: "T", path: "/blog/a", summary: "S", publishedAt: new Date("2026-01-02T03:04:05Z"), ...o });


test("hero : vidéo de fond — seulement un fichier envoyé sur le site ; son = simple possibilité ; adresse externe ignorée", async () => {
  const U = "/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.mp4";
  let [b] = await hero.definition.sections.hero(fakeCtx({ settings: { video: U, videoSound: true, poster: "/uploads/p.png", showLogo: false }, site: { name: "S", tagline: "", logo: "" } }));
  assert.equal(b.video, U);
  assert.equal(b.videoSound, true);
  assert.equal(b.videoPoster, "/uploads/p.png");
  [b] = await hero.definition.sections.hero(fakeCtx({ settings: { video: "https://evil.example/x.mp4", showLogo: false }, site: { name: "S", tagline: "", logo: "" } }));
  assert.equal(b.video, undefined);
  assert.equal("videoSound" in b, false);
});

test("hero : ligne d'accroche et bouton — recopiés ; le lien du bouton doit être une page du site ou https/mailto, sinon pas de bouton", async () => {
  let [b] = await hero.definition.sections.hero(fakeCtx({ settings: { eyebrow: "L'association", buttonLabel: "Devenir membre", buttonUrl: "/membres", showLogo: false }, site: { name: "S", tagline: "", logo: "" } }));
  assert.equal(b.eyebrow, "L'association");
  assert.deepEqual(b.button, { label: "Devenir membre", href: "/membres" });
  for (const bad of ["javascript:alert(1)", "//evil.example", "ftp://x", ""]) {
    [b] = await hero.definition.sections.hero(fakeCtx({ settings: { buttonLabel: "Go", buttonUrl: bad, showLogo: false }, site: { name: "S", tagline: "", logo: "" } }));
    assert.equal(b.button, undefined, bad);
  }
  [b] = await hero.definition.sections.hero(fakeCtx({ settings: { buttonLabel: "", buttonUrl: "/x", showLogo: false }, site: { name: "S", tagline: "", logo: "" } }));
  assert.equal(b.button, undefined, "sans libellé, pas de bouton");
  assert.equal("eyebrow" in b, false);
});

test("hero : manifeste 1.0.1 — défauts du site, lien du bouton de type link, groupes facultatifs cohérents", async () => {
  const m = await assertValidManifest(hero.manifest);
  assert.equal(m.version, "1.0.1");
  const by = Object.fromEntries(m.settings.map((s) => [s.key, s]));
  assert.equal(by.title.default, "site:name");
  assert.equal(by.text.default, "site:tagline");
  assert.equal(by.buttonUrl.type, "link");
  const keys = new Set(m.settings.map((s) => s.key));
  const seen = new Set();
  assert.deepEqual(m.optionalGroups.map((g) => g.id), ["button", "background"]);
  for (const g of m.optionalGroups) {
    for (const f of g.fields) { assert.ok(keys.has(f), `${g.id} : ${f} inconnu`); assert.ok(!seen.has(f), `${f} dans deux groupes`); seen.add(f); }
    for (const r of g.required) assert.ok(g.fields.includes(r), `${g.id} : ${r} requis hors du groupe`);
  }
  assert.deepEqual(m.optionalGroups[0].fields, ["buttonLabel", "buttonUrl"]);
  assert.deepEqual(m.optionalGroups[1].fields, ["video", "poster", "videoSound"]);
});

test("hero : tant que non réglés, ni bouton ni vidéo ; texte seul ou lien seul → pas de bouton ; vidéo absente → ni son ni affiche", async () => {
  const site = { name: "S", tagline: "T", logo: "" };
  let [b] = await hero.definition.sections.hero(fakeCtx({ settings: { showLogo: false, videoSound: true, poster: "/uploads/p.png" }, site }));
  for (const k of ["button", "video", "videoSound", "videoPoster"]) assert.equal(k in b, false, k);
  [b] = await hero.definition.sections.hero(fakeCtx({ settings: { buttonLabel: "Go", showLogo: false }, site }));
  assert.equal(b.button, undefined);
  [b] = await hero.definition.sections.hero(fakeCtx({ settings: { buttonUrl: "mailto:a@b.fr", showLogo: false }, site }));
  assert.equal(b.button, undefined);
  [b] = await hero.definition.sections.hero(fakeCtx({ settings: { buttonLabel: "Écrire", buttonUrl: "mailto:a@b.fr", showLogo: false }, site }));
  assert.deepEqual(b.button, { label: "Écrire", href: "mailto:a@b.fr" });
});
