// Soutiens — mise à jour À CHAUD (le cœur importe `index.mjs?v=<version>` ; Node garde en mémoire chaque adresse déjà importée, donc un import statique d'un fichier voisin reprendrait
// l'ANCIEN fichier), neutralité (aucun nom de site, d'association, de lieu ni de couleur dans le module), réseau fermé (aucune adresse hors de la liste blanche des fournisseurs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { formRequest, manifest } from "./helpers/supporters-world.mjs";
import { makeTempDir } from "./helpers/tmp.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(here, "../modules/supporters");
const copy = (from, to) => { fs.rmSync(to, { recursive: true, force: true }); fs.cpSync(from, to, { recursive: true }); };
const load = (dir, v) => import(`${pathToFileURL(path.join(dir, "index.mjs")).href}?v=${v}`);
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");
const sources = () => fs.readdirSync(SRC).filter((n) => n.endsWith(".mjs"));

test("aucun fichier de Soutiens n'importe un voisin sans la version du fichier principal, ni statiquement ni autrement", () => {
  for (const f of sources()) {
    const code = read(f);
    assert.ok(!/^\s*(import|export)\b[^\n]*\bfrom\s+["']\.\.?\//m.test(code), `${f} : import statique d'un fichier voisin (sans ?v=) ; utiliser await import(\`./x.mjs\${v}\`)`);
    for (const m of code.matchAll(/await import\(([^)]*)\)/g)) assert.ok(/\$\{(v|q)\}/.test(m[1]), `${f} : import dynamique sans version : ${m[1]}`);
  }
});

test("mise à jour à chaud : v1 chargée, puis les fichiers sont remplacés et v2 importée dans le MÊME processus → tout le module suit le nouveau code (la page d'accord applique la nouvelle longueur de pseudo)", async () => {
  const dir = makeTempDir("supporters-update-");
  try {
    copy(SRC, dir);
    const before = (await load(dir, "v1")).default;
    const mk = (def) => {
      const ctx = fakeCtx({ key: "soutiens", moduleId: "supporters", basePath: "soutiens", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], permissions: manifest.permissions, settings: { provider: "csv", publicPage: true, review: false }, messages: JSON.parse(fs.readFileSync(path.join(dir, "locales/fr.json"), "utf8")), siteUrl: "https://site.example.test" });
      return { ctx, def };
    };
    const run = async (def) => {
      const { ctx } = mk(def);
      const imp = await import(`${pathToFileURL(path.join(dir, "ops.mjs")).href}?v=${def === before ? "v1" : "v2"}`);
      await imp.importText(ctx, "nom\nAda");
      const snap = await (await import(`${pathToFileURL(path.join(dir, "data.mjs")).href}?v=${def === before ? "v1" : "v2"}`)).snapshot(ctx, { fresh: true });
      const p = [...snap.people.values()][0].data;
      const link = await imp.consentLink(ctx, p.pid);
      const res = await def.routes.consent(formRequest("https://site.example.test/m/soutiens/consent", { pid: p.pid, t: link.path.split("/").pop(), loc: "fr", act: "accept", pseudo: "x".repeat(30), agree: "yes" }), ctx);
      return res.headers.get("location").split("/").pop();
    };
    assert.equal(await run(before), "ok-shown", "version 1 : 30 caractères acceptés");
    // « Mise à jour » : le cœur remplace les fichiers du dossier, puis importe avec la nouvelle version.
    const pure = path.join(dir, "pure.mjs");
    fs.writeFileSync(pure, fs.readFileSync(pure, "utf8").replace("pseudo: 40,", "pseudo: 25,"));
    const after = (await load(dir, "v2")).default;
    assert.equal(typeof after.page, "function");
    assert.equal(await run(after), "e-long", "version 2 : le nouveau pure.mjs est bien celui utilisé par la route (aucun ancien fichier gardé en mémoire)");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("neutralité : aucun nom de site, d'association, de lieu ni de couleur propre dans le module, ses textes, ses tests et sa documentation (les noms de plateformes sont des données des fournisseurs)", () => {
  // Termes locaux facultatifs : NEUTRALITY_TERMS_FILE, sinon .neutrality-terms du cœur de test (CURIOSA_DIR) ; absents, seules les règles ci-dessous s'appliquent.
  const termsFile = process.env.NEUTRALITY_TERMS_FILE ?? (process.env.CURIOSA_DIR ? path.join(process.env.CURIOSA_DIR, ".neutrality-terms") : "");
  const rules = [/rosali/i, /helldog/i, /bruxelles/i, /brussels/i, /belgi/i, /asbl/i, /\bvzw\b/i, /association/i, /\bnpo\b/i];
  const extra = termsFile && fs.existsSync(termsFile) ? fs.readFileSync(termsFile, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => new RegExp(l.split("=>")[0].trim(), "i")) : [];
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
  walk(SRC);
  for (const f of ["tests/supporters.test.mjs", "tests/supporters-contacts.test.mjs", "tests/supporters-admin.test.mjs", "tests/supporters-update.test.mjs", "tests/supporters-browser.test.mjs", "tests/helpers/supporters-world.mjs", "tests/helpers/fakePatreon.mjs", "docs/ideas/supporters.md", "docs/ideas/supporters.changelog.md", "docs/changelog-parts/supporters.md"]) if (fs.existsSync(path.join(here, "..", f))) files.push(path.join(here, "..", f));
  const bad = [];
  for (const f of files) {
    if (f.endsWith("supporters-update.test.mjs")) continue;   // ce fichier-ci énumère les termes interdits
    let text = fs.readFileSync(f, "utf8");
    if (f.endsWith("module.json")) text = text.replace(/"author":\s*"[^"]*"/, "");
    for (const re of [...rules, ...extra]) if (re.test(text)) bad.push(`${path.relative(path.join(here, ".."), f)} : ${re}`);
  }
  assert.deepEqual(bad, []);
});

test("réseau fermé : les seules adresses https écrites dans le code sont celles d'une plateforme de la table (et des textes d'aide), jamais ailleurs ; aucun fetch direct", () => {
  const allowed = new Set(["www.patreon.com", "patreon.com", "ko-fi.com"]);
  for (const f of sources()) {
    const code = read(f);
    assert.ok(!/\bfetch\(/.test(code.replace(/\/\/.*$/gm, "")), `${f} : aucun fetch direct (tout passe par ctx.api.net)`);
    for (const m of code.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) { const host = m[1].toLowerCase(); if (["example.org", "example.test", "x.example", "pub.example"].includes(host) || host === "") continue; assert.ok(allowed.has(host) || /^\$\{/.test(m[1]), `${f} : adresse inattendue ${m[0]}`); }
  }
  const providers = read("providers.mjs");
  assert.match(providers, /ctx\.api\.net\.request/);
  assert.equal([...providers.matchAll(/ctx\.api\.net\.request/g)].length, 1, "un seul endroit appelle le réseau : getJson, qui contrôle la liste blanche avant d'appeler");
  for (const f of sources().filter((n) => n !== "providers.mjs")) assert.ok(!/api\.net\b/.test(read(f)), `${f} n'appelle pas le réseau lui-même`);
});

test("vie privée : la déclaration « privacy » existe en FR et EN, dit que s'inscrire n'est pas un accord, et le module n'utilise ni cookie ni stockage du navigateur ni script", () => {
  assert.ok(manifest.privacy.fr.length > 100 && manifest.privacy.en.length > 100);
  assert.match(manifest.privacy.fr, /n'est PAS un accord/);
  assert.match(manifest.privacy.en, /NOT agreement/);
  for (const f of sources()) { const code = read(f); assert.ok(!/document\.cookie|localStorage|sessionStorage|set-cookie/i.test(code), f); }
  assert.equal(fs.existsSync(path.join(SRC, "scripts")), false, "aucun script envoyé au navigateur");
  assert.ok(!/<script/i.test(read("view.mjs")));
  assert.equal(manifest.offers.some((o) => o.service === "privacy.subject" && o.each === true), true);
});
