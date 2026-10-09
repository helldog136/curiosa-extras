import test from "node:test";
import assert from "node:assert/strict";
import { assertValidManifest, assertDefinitionMatchesManifest, assertSettingsSane } from "./helpers/builtinChecks.mjs";
import { listModuleDirs, loadModule } from "./helpers/moduleLoader.mjs";

// Tous les modules du dépôt, chargés comme Curiosa les charge (manifeste + code + textes).
const BUILTIN_MODULES = await Promise.all(listModuleDirs().map(async ({ dir }) => loadModule(dir)));
const byId = Object.fromEntries(BUILTIN_MODULES.map((m) => [m.manifest.id, m]));
const { blog, links, codes, pages, collection } = byId;
const { effectiveType, hasPage } = await import("@/core/modules/manifest");

const content = { blog, links, codes, pages, collection };

test("dépôt : identifiants uniques, les 10 modules de base (ex-livrés avec le cœur) présents", () => {
  const ids = BUILTIN_MODULES.map((m) => m.manifest.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["hero", "blog", "links", "codes", "pages", "collection", "contact-form", "live-status", "ticker-overlay", "press-kit"]) {
    assert.ok(ids.includes(id), id);
  }
  assert.ok(!ids.includes("blocks"), "« Blocs de page » est une fonction du cœur, plus un module (migration automatique)");
  assert.equal(ids.length, 43, "10 modules de base + 11 modules + 20 réseaux sociaux + 2 exemples");
});

test("dépôt : chaque module a manifeste valide, sections/permissions cohérentes, pas de MCP orphelin", async () => {
  for (const m of BUILTIN_MODULES) {
    await assertValidManifest(m.manifest);
    assertDefinitionMatchesManifest(m.manifest, m.definition);
    assertSettingsSane(m.manifest);
    assert.equal(m.manifest.apiVersion, 2);
    assert.ok(m.manifest.name.en && m.manifest.name.fr, m.manifest.id);
    assert.ok(m.manifest.description.en && m.manifest.description.fr, m.manifest.id);
  }
});

test("dépôt : aucune permission dangereuse ni MCP par défaut dans les modules livrés", () => {
  for (const m of BUILTIN_MODULES) {
    for (const a of m.manifest.mcp ?? []) assert.ok(!(a.destructive && a.default), `${m.manifest.id}.${a.name}`);
  }
});

for (const [name, m] of Object.entries(content)) {
  test(`contenu « ${name} » : manifeste valide passant parseManifest`, async () => {
    const parsed = await assertValidManifest(m.manifest);
    assert.equal(parsed.id, name);
    assert.equal(parsed.instances, name === "pages" ? "single" : "multiple");
    assert.ok(parsed.content, "bloc content requis");
    assert.equal(effectiveType(parsed), "content");
    assert.ok(hasPage(parsed), "un module de contenu a une page publique");
  });

  test(`contenu « ${name} » : pas de code (définition vide) donc aucune section déclarée sans implémentation`, () => {
    assert.deepEqual(m.definition, {});
    assert.deepEqual(m.manifest.sections, []);
    assertDefinitionMatchesManifest(m.manifest, m.definition);
  });
}

test("contenu : basePath minuscule/tiret, pages à la racine, et « features » sans doublon", () => {
  for (const [name, m] of Object.entries(content)) {
    const c = m.manifest.content;
    assert.equal(new Set(c.features).size, c.features.length, name);
    if (c.basePath !== undefined) assert.match(c.basePath, /^[a-z0-9-]*$/);
  }
  assert.equal(pages.manifest.content.basePath, "");
  assert.equal(blog.manifest.content.basePath, "blog");
  assert.equal(links.manifest.content.basePath, "links");
  assert.equal(codes.manifest.content.basePath, "codes");
});

test("contenu : cohérence affichage / action / fonctionnalités", () => {
  assert.equal(links.manifest.content.display, "links");
  assert.equal(links.manifest.content.clickAction, "external");
  assert.ok(links.manifest.content.features.includes("url"));
  assert.equal(codes.manifest.content.display, "codes");
  for (const f of ["code", "expiresAt", "url"]) assert.ok(codes.manifest.content.features.includes(f), f);
  assert.equal(blog.manifest.content.clickAction, "detail");
  assert.ok(blog.manifest.content.features.includes("body"));
  // un clic « externe » exige une URL dans les entrées
  for (const m of Object.values(content)) {
    if (m.manifest.content.clickAction === "external") assert.ok(m.manifest.content.features.includes("url"), m.manifest.id);
  }
});

test("contenu : liens courts (/go) seulement pour les modules à clic externe", () => {
  assert.equal(links.manifest.content.allowGoLinks, true);
  assert.equal(codes.manifest.content.allowGoLinks, true);
  for (const m of [blog, pages, collection]) assert.ok(!m.manifest.content.allowGoLinks, m.manifest.id);
});

test("contenu : onboarding — sections d'accueil existantes (« latest ») et compte raisonnable", () => {
  for (const m of Object.values(content)) {
    const home = m.manifest.onboarding?.home;
    if (!home) continue;
    assert.equal(home.section, "latest");
    assert.ok(Number.isInteger(home.count) && home.count >= 1 && home.count <= 50, m.manifest.id);
  }
  assert.equal(blog.manifest.onboarding.home.count, 3);
  assert.equal(links.manifest.onboarding.collectsLinks, true);
});

test("contenu : l'article d'exemple du blog est bilingue, sans balise HTML ni script", () => {
  const s = blog.manifest.onboarding.sample;
  for (const f of [s.title, s.summary, s.body]) {
    assert.ok(f.en.trim() && f.fr.trim());
    assert.doesNotMatch(f.en + f.fr, /<[a-z/]/i);
    assert.doesNotMatch(f.en + f.fr, /javascript:/i);
  }
});

test("contenu : aucun drapeau d'assistant dans les manifestes (la suggestion vit dans catalogue/suggested.json) ; la collection vierge n'a pas d'accueil prévu", () => {
  for (const m of [blog, links, codes, pages]) assert.ok(!("starter" in m.manifest) && !("preselected" in (m.manifest.onboarding ?? {})), m.manifest.id);
  assert.ok(!collection.manifest.onboarding);
});

test("contenu : permissions limitées à pages + sections (rien de stockage/route)", () => {
  for (const m of Object.values(content)) assert.deepEqual([...m.manifest.permissions].sort(), ["pages", "sections"]);
});

test("contenu : manifeste invalide détecté (garde-fous de parseManifest sur une copie modifiée)", async () => {
  const { parseManifest } = await import("@/core/modules/manifest");
  const copy = JSON.parse(JSON.stringify(blog.manifest));
  assert.equal(parseManifest({ ...copy, apiVersion: 1 }).ok, false);
  assert.equal(parseManifest({ ...copy, id: "Blog!" }).ok, false);
  assert.equal(parseManifest({ ...copy, content: { ...copy.content, basePath: "../x" } }).ok, false);
  assert.equal(parseManifest({ ...copy, version: "1" }).ok, false);
});
