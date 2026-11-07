import test from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./helpers/moduleLoader.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { assertValidManifest, settingsDefaults } from "./helpers/builtinChecks.mjs";

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
  assert.equal(m.page, true);
  assert.equal(m.basePath, "press-kit");
  assert.equal(m.type, "widget");
  assert.equal(m.instances, "single");
  assert.deepEqual(m.permissions, ["pages"]);
  assert.deepEqual(m.sections, []);
  assert.deepEqual(settingsDefaults(m), { tagline: "site:tagline", brandSource: "site", showTypography: true, showContact: true });
  assert.equal(m.version, "1.1.1");
  assert.equal(m.minCore, "0.6.0");
  assert.deepEqual(m.settings.filter((s) => s.advanced).map((s) => s.key), ["showTypography", "showContact"], "the two historical options stay advanced");
  assert.deepEqual(Object.keys(def).sort(), ["page"], "rien d'autre que la page : ni routes, ni stockage, ni admin");
});

test("press-kit : locales en/fr identiques (variable {name} conservée)", () => {
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

/* ───────────── Settings (1.1.0): a person and an assistant can fill the kit ───────────── */
const settingOf = (key) => manifest.settings.find((s) => s.key === key);
const text = (p) => p.blocks.map((b) => b.text ?? "").join("\n");
const swatches = (p) => p.blocks.find((b) => b.type === "swatches").items;
const logosOf = (p) => p.blocks.find((b) => b.type === "downloads")?.items;
const own = (extra = {}) => ({ brandSource: "own", ...extra });

test("press-kit settings: at most 7 simple settings, the rest folded or advanced, nothing mandatory", () => {
  const simple = manifest.settings.filter((s) => !s.advanced && !s.rare);
  assert.deepEqual(simple.map((s) => s.key), ["about", "tagline", "facts", "contactName", "brandSource"]);
  assert.ok(simple.length <= 7);
  assert.ok(manifest.settings.filter((s) => s.rare).every((s) => s.key.startsWith("own") && s.optional === true), "own values are folded and optional");
  assert.ok(manifest.settings.filter((s) => !s.advanced && s.type !== "boolean" && s.type !== "select" && s.default === undefined).every((s) => s.optional === true), "an empty setting never marks the extension as to be configured");
  assert.ok(manifest.settings.every((s) => s.type !== "secret"), "an assistant can set everything");
});

test("press-kit settings: every setting has an EN and FR label (60 characters, no colon) and help (60 characters); free fields have an example", () => {
  for (const s of manifest.settings) {
    for (const lang of ["en", "fr"]) {
      const label = s.label[lang];
      assert.ok(label && label.length <= 60 && !label.trim().endsWith(":"), `${s.key} label ${lang}`);
      if (s.help) assert.ok(s.help[lang] && s.help[lang].length <= 60, `${s.key} help ${lang}`);
      if (s.example) assert.ok(s.example[lang] || typeof s.example === "string", `${s.key} example ${lang}`);
    }
    if (["text", "textarea"].includes(s.type) && !s.advanced) assert.ok(s.example, `${s.key} needs an example`);
  }
  assert.equal(settingOf("ownColors").example.en, "Night blue #1B1A2E");
  assert.equal(settingOf("brandSource").display, "segmented");
  assert.deepEqual(settingOf("brandSource").options.map((o) => o.value), ["site", "own"]);
  assert.equal(settingOf("about").translatable, true);
  assert.equal(settingOf("tagline").translatable, true);
});

test("press-kit settings: the core accepts the manifest and checks the image and choice settings", async () => {
  const { checkFieldInput } = await import("@/core/modules/settingValues");
  assert.deepEqual(checkFieldInput(settingOf("brandSource"), "own"), { ok: true, value: "own" });
  assert.equal(checkFieldInput(settingOf("brandSource"), "mine").ok, false);
  assert.equal(checkFieldInput(settingOf("ownLogoWide"), "/uploads/logo.png").ok, true);
  assert.equal(checkFieldInput(settingOf("ownLogoWide"), "javascript:alert(1)").ok, false);
});

test("press-kit: without any setting the page shows the site brand (unchanged)", async () => {
  const p = await run({ settings: {} });
  assert.deepEqual(swatches(p).map((c) => c.hex), ["#ff66aa", "#111111"]);
  assert.deepEqual(logosOf(p), [{ src: "/uploads/logo.png", label: "Logo" }]);
  assert.match(text(p), /\*\*Lora\*\* — `Lora, serif`/);
  assert.equal(p.description, "Créatrice");
});

test("press-kit: presentation, tagline, facts and contact name come from the settings; empty ones fall back to the site", async () => {
  const p = await run({ settings: { about: "We make **puzzle** games.", tagline: "Cosy puzzles", facts: "- Created in 2021\n\nBased in Lyon\n* 12 games", contactName: "Camille" } });
  assert.equal(p.description, "Cosy puzzles");
  const [short, long] = p.blocks.filter((b) => b.type === "copy");
  assert.equal(short.text, "Cosy puzzles");
  assert.equal(long.text, "We make puzzle games.");
  assert.match(text(p), /We make \*\*puzzle\*\* games\./);
  assert.match(text(p), /- Created in 2021\n- Based in Lyon\n- 12 games/);
  assert.match(text(p), /\*\*Camille\*\*\n\n\[pro@example.org\]\(mailto:pro@example.org\)/);
  const fallback = await run({ settings: { about: "  ", tagline: "", facts: "", contactName: "" } });
  assert.equal(fallback.description, "Créatrice");
  assert.match(text(fallback), /Je \*\*stream\*\*/);
  assert.ok(!text(fallback).includes(T.facts));
});

test("press-kit: a contact name alone is shown without an e-mail; showContact=false hides both", async () => {
  const noMail = { ...brandFull, contactEmail: "" };
  assert.match(text(await run({ brand: noMail, settings: { contactName: "Camille" } })), /\*\*Camille\*\*/);
  assert.ok(!text(await run({ brand: noMail, settings: {} })).includes(T.contact));
  const hidden = await run({ settings: { contactName: "Camille", showContact: false } });
  assert.ok(!text(hidden).includes("Camille"));
});

test("press-kit: own values are ignored while the choice is “from the site”", async () => {
  const p = await run({ settings: { brandSource: "site", ownColors: "Night #1B1A2E", ownHeadingFont: "Lora", ownLogoWide: "/uploads/a.png" } });
  assert.equal(swatches(p)[0].name, "Rose");
  assert.deepEqual(logosOf(p), [{ src: "/uploads/logo.png", label: "Logo" }]);
});

test("press-kit: own colors — name and code, validated; invalid lines are skipped; 8 at most", async () => {
  const lines = ["Night blue #1B1A2E", "#abc", "Sun: #ffcc00", "no code here", "Bad #12345", "Red #GG0000", "<b>Grey</b> - #888888", ...Array.from({ length: 10 }, (_, i) => `C${i} #00000${i}`)];
  const p = await run({ settings: own({ ownColors: lines.join("\n") }) });
  const sw = swatches(p);
  assert.deepEqual(sw.slice(0, 4), [
    { name: "Night blue", hex: "#1B1A2E", role: undefined },
    { name: "#AABBCC", hex: "#AABBCC", role: undefined },
    { name: "Sun", hex: "#FFCC00", role: undefined },
    { name: "Grey", hex: "#888888", role: undefined },
  ]);
  assert.equal(sw.length, 8);
  assert.ok(sw.every((c) => /^#[0-9A-F]{6}$/.test(c.hex)));
});

test("press-kit: own colors empty or all invalid fall back to the site colors", async () => {
  for (const ownColors of [undefined, "", "nothing\nvalid #zzz"]) {
    const p = await run({ settings: own({ ownColors }) });
    assert.deepEqual(swatches(p).map((c) => c.name), ["Rose", "Nuit"]);
  }
});

test("press-kit: own fonts — names only, titles and text, otherwise the site font", async () => {
  let p = await run({ settings: own({ ownHeadingFont: "Lora", ownTextFont: "Open Sans" }) });
  assert.match(text(p), new RegExp(`- ${T.fontTitles} — \\*\\*Lora\\*\\*\\n- ${T.fontText} — \\*\\*Open Sans\\*\\*`));
  p = await run({ settings: own({ ownHeadingFont: "  Lora , \"Georgia\" ,<script>, " }) });
  assert.match(text(p), /\*\*Lora, Georgia\*\*/);
  assert.ok(!text(p).includes("script"));
  p = await run({ settings: own({ ownHeadingFont: "x".repeat(80), ownTextFont: "a;b" }) });
  assert.match(text(p), /\*\*Lora\*\* — `Lora, serif`/, "invalid names fall back to the site font");
  p = await run({ settings: own({ ownHeadingFont: "Lora", showTypography: false }) });
  assert.ok(!text(p).includes(T.typography));
});

test("press-kit: own logos — only files uploaded to the site; others are dropped (no third-party load)", async () => {
  const p = await run({ settings: own({ ownLogoWide: "/uploads/wide.svg", ownLogoSquare: "https://cdn.example.net/icon.png", ownLogoWideDark: "/uploads/../secret", ownLogoSquareDark: "//evil.example/x.png" }) });
  assert.deepEqual(logosOf(p), [{ src: "/uploads/wide.svg", label: T["logo.wide"] }]);
  const none = await run({ settings: own({ ownLogoWide: "https://cdn.example.net/icon.png" }) });
  assert.deepEqual(logosOf(none), [{ src: "/uploads/logo.png", label: "Logo" }], "falls back to the site logo");
  const all = await run({ settings: own({ ownLogoWide: "/uploads/a.png", ownLogoSquare: "/uploads/b.png", ownLogoWideDark: "/uploads/c.png", ownLogoSquareDark: "/uploads/d.png" }) });
  assert.deepEqual(logosOf(all).map((l) => l.label), [T["logo.wide"], T["logo.square"], T["logo.wideDark"], T["logo.squareDark"]]);
});

test("press-kit: nothing the page returns can make a visitor's browser contact a third party", async () => {
  const p = await run({ settings: own({
    about: "Hello ![pixel](https://tracker.example.net/p.gif) world ![](https://tracker.example.net/q.gif)",
    facts: "![x](https://tracker.example.net/r.gif) Founded 2021",
    ownColors: "A #112233", ownLogoWide: "/uploads/a.png",
  }) });
  assert.ok(!/!\[[^\]]*\]\(/.test(text(p)), "no Markdown image survives");
  for (const item of logosOf(p)) assert.match(item.src, /^\/uploads\//);
});

test("press-kit: FR and EN texts stay in parity with the new keys", () => {
  assert.deepEqual(Object.keys(locales.en).sort(), Object.keys(locales.fr).sort());
  for (const k of ["facts", "fontTitles", "fontText"]) assert.ok(locales.en[k] && locales.fr[k]);
});
