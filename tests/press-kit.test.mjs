import test from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./helpers/moduleLoader.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { assertValidManifest, assertDefinitionMatchesManifest, assertSettingsSane, assertLocalesParity, settingsDefaults } from "./helpers/builtinChecks.mjs";

const pk = await loadModule("modules/press-kit");
const { definition: def, manifest, locales } = pk;

const T = Object.fromEntries(Object.keys(locales.fr).map((k) => [k, locales.fr[k]]));
const brandFull = {
  name: "Jane", tagline: "Créatrice", about: "Je **stream** [ici](https://x.test) et `code`.\n\n> citation",
  logo: "/uploads/logo.png", contactEmail: "pro@example.org",
  colors: [{ name: "Rose", hex: "#ff66aa", role: "primary" }, { name: "Nuit", hex: "#111111" }],
  font: { key: "serif", name: "Lora", stack: "Lora, serif" }, defaultLocale: "fr", locales: ["fr", "en"],
};
const run = (opts = {}) => def.page(fakeCtx({ locale: "fr", messages: T, brand: brandFull, ...opts }));
const types = (p) => p.blocks.map((b) => b.type);

test("press-kit : manifeste valide, page publique /press-kit, widget à instance unique, permission pages seule", async () => {
  const m = await assertValidManifest(manifest);
  assertDefinitionMatchesManifest(m, def);
  assertSettingsSane(m);
  assert.equal(m.page, true);
  assert.equal(m.basePath, "press-kit");
  assert.equal(m.type, "widget");
  assert.equal(m.instances, "single");
  assert.deepEqual(m.permissions, ["pages"]);
  assert.deepEqual(m.sections, []);
  assert.deepEqual(settingsDefaults(m), { showTypography: true, showContact: true });
  assert.ok(m.settings.every((s) => s.advanced));
  assert.deepEqual(Object.keys(def).sort(), ["page"], "rien d'autre que la page : ni routes, ni stockage, ni admin");
});

test("press-kit : locales en/fr identiques (variable {name} conservée)", () => {
  assertLocalesParity(locales);
  assert.match(locales.fr.intro, /\{name\}/);
});

test("press-kit : page complète — titre, description, blocs dans l'ordre", async () => {
  const p = await run();
  assert.equal(p.title, "Kit presse");
  assert.equal(p.description, "Créatrice");
  assert.deepEqual(types(p), ["markdown", "heading", "markdown", "copy", "copy", "heading", "downloads", "heading", "markdown", "swatches", "heading", "markdown", "heading", "markdown"]);
  assert.match(p.blocks[0].text, /Jane/);
});

test("press-kit : n'affiche que les données de la marque du cœur (logo, couleurs, police, email)", async () => {
  const p = await run();
  const dl = p.blocks.find((b) => b.type === "downloads");
  assert.deepEqual(dl.items, [{ src: "/uploads/logo.png", label: "Logo" }]);
  const sw = p.blocks.find((b) => b.type === "swatches");
  assert.deepEqual(sw.items, [{ name: "Rose", hex: "#ff66aa", role: "primary" }, { name: "Nuit", hex: "#111111", role: undefined }]);
  const md = p.blocks.map((b) => b.text ?? "").join("\n");
  assert.match(md, /\*\*Lora\*\* — `Lora, serif`/);
  assert.match(md, /\[pro@example.org\]\(mailto:pro@example.org\)/);
});

test("press-kit : copies — courte = accroche, longue = Markdown aplati en texte brut", async () => {
  const p = await run();
  const [short, long] = p.blocks.filter((b) => b.type === "copy");
  assert.equal(short.text, "Créatrice");
  assert.equal(long.text, "Je stream ici et code. citation");
  assert.ok(!/[*_`>#\[\]]/.test(long.text));
});

test("press-kit : marque minimale — pas d'à-propos, copies, logo, ni contact", async () => {
  const p = await run({ brand: { ...brandFull, about: "", tagline: "", logo: null, contactEmail: "", colors: [] } });
  assert.equal(p.description, undefined);
  assert.deepEqual(types(p), ["markdown", "heading", "markdown", "swatches", "heading", "markdown"]);
  assert.deepEqual(p.blocks.find((b) => b.type === "swatches").items, []);
});

test("press-kit : showTypography=false / showContact=false masquent les sections ; absent = affichées", async () => {
  let p = await run({ settings: { showTypography: false, showContact: false } });
  assert.ok(!p.blocks.some((b) => b.text === T.typography || b.text === T.contact));
  assert.ok(!p.blocks.some((b) => /mailto:/.test(b.text ?? "")));
  p = await run({ settings: {} });
  assert.ok(p.blocks.some((b) => b.text === T.typography));
  assert.ok(p.blocks.some((b) => b.text === T.contact));
});

test("press-kit : ne stocke rien et n'écrit pas (store et topics intacts)", async () => {
  const ctx = fakeCtx({ locale: "fr", messages: T, brand: brandFull });
  await def.page(ctx);
  assert.equal(await ctx.api.store.count("anything"), 0);
  assert.deepEqual(ctx.calls.topics, []);
  assert.deepEqual(ctx.calls.entries, []);
});

test("press-kit : la locale du contexte est transmise à api.brand", async () => {
  const seen = [];
  const ctx = fakeCtx({ locale: "en", messages: T, brand: brandFull });
  const orig = ctx.api.brand;
  ctx.api.brand = async (l) => { seen.push(l); return orig(l); };
  await def.page(ctx);
  assert.deepEqual(seen, ["en"]);
});

test("press-kit : le nom de marque dans l'intro est substitué, sans markup supplémentaire généré", async () => {
  const p = await run({ brand: { ...brandFull, name: `<b>X</b>` } });
  assert.equal(p.blocks[0].text, T.intro.replace("{name}", "<b>X</b>"), "texte Markdown rendu par le cœur (HTML brut non interprété)");
});

test("press-kit : l'email de contact n'est lié qu'en mailto: (jamais javascript:)", async () => {
  const p = await run({ brand: { ...brandFull, contactEmail: "javascript:alert(1)" } });
  const link = p.blocks.map((b) => b.text ?? "").find((t) => t.includes("javascript:"));
  assert.ok(!link || /\]\(mailto:javascript:alert\(1\)\)/.test(link), "le schéma reste mailto:");
});
