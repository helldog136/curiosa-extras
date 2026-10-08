// Règles de ce dépôt (autrefois vérifiées par le cœur, qui n'a plus aucun module) : un module n'a que l'API publique, rien d'autre.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { listModuleDirs, loadModule } from "./helpers/moduleLoader.mjs";

const root = new URL("..", import.meta.url).pathname;
const core = process.cwd(); // les tests tournent dans le dossier de Curiosa
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
const importsOf = (text) => [...text.matchAll(/(?:import|export)\s[^'"]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
const dirs = listModuleDirs();
const manifests = dirs.map(({ dir }) => ({ dir, ...JSON.parse(read(`${dir}/module.json`)) }));
const codeFiles = dirs.flatMap(({ dir }) => walk(path.join(root, dir)).filter((f) => /\.(mjs|js)$/.test(f)));

test("chaque dossier est un module cohérent : id = nom du dossier, fichier principal présent, licence déclarée", () => {
  assert.ok(manifests.length >= 20);
  for (const m of manifests) {
    assert.equal(m.id, path.basename(m.dir), m.dir);
    assert.match(m.version, /^\d+\.\d+\.\d+/, m.dir);
    assert.ok(m.license, `${m.dir} : licence absente de module.json`);
    if (m.main) assert.ok(fs.existsSync(path.join(root, m.dir, m.main)), `${m.dir} : ${m.main} introuvable`);
  }
});

test("la version de l'API visée est celle du cœur", () => {
  const v = Number(fs.readFileSync(path.join(core, "src/core/config.ts"), "utf8").match(/MODULE_API_VERSION = (\d+)/)[1]);
  for (const m of manifests) assert.equal(m.apiVersion, v, m.dir);
});

test("les modules n'importent rien du cœur : un module n'a que ctx.api", () => {
  for (const file of codeFiles) for (const spec of importsOf(fs.readFileSync(file, "utf8"))) assert.ok(!spec.startsWith("@/") && !spec.includes("/src/"), `${file} importe du cœur (« ${spec} »)`);
});

test("les modules n'appellent jamais Prisma ni le disque du cœur : tout passe par ctx.api", () => {
  for (const file of codeFiles) assert.ok(!/prisma|@prisma\/client/.test(fs.readFileSync(file, "utf8")), `${file} accède directement à la base`);
});

test("le kit presse ne stocke rien : il lit l'identité du cœur (ctx.api.brand) et c'est tout", () => {
  const code = read("modules/press-kit/index.mjs");
  assert.ok(code.includes("ctx.api.brand"), "le kit presse doit lire l'identité via ctx.api.brand");
  for (const forbidden of ["ctx.api.store", "adminActions", "adminPanel", "setSetting", "prisma"]) assert.ok(!code.includes(forbidden), `le kit presse ne doit pas utiliser « ${forbidden} »`);
});

test("sujets : ceux de nos modules sont en anglais, en minuscules, et listés dans docs/MODULES.md du cœur", () => {
  const doc = fs.readFileSync(path.join(core, "docs/MODULES.md"), "utf8");
  const used = new Set();
  for (const { dir } of dirs) {
    for (const m of read(`${dir}/module.json`).matchAll(/"topic": *"([^"]+)"/g)) used.add(m[1]);
    const main = JSON.parse(read(`${dir}/module.json`)).main;
    if (main) for (const m of read(`${dir}/${main}`).matchAll(/\btopic: "([^"]+)"/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 5, "des sujets doivent être trouvés");
  for (const topic of used) {
    assert.match(topic, /^[a-z]+(\.[a-z]+)+$/, `sujet « ${topic} » : minuscules, domaine.objet`);
    assert.ok(doc.includes(`\`${topic}\``), `sujet « ${topic} » absent du tableau « Sujets connus » de docs/MODULES.md (cœur)`);
  }
});

test("les réglages avancés ne sont jamais obligatoires pour le mode simple", () => {
  for (const m of manifests) for (const s of m.settings ?? []) if (s.advanced) assert.ok(s.default !== undefined || s.type !== "number", `${m.id}.${s.key} : un réglage avancé numérique doit avoir une valeur par défaut`);
});

test("les modules qui déclarent des actions MCP les implémentent ; les actions irréversibles sont désactivées par défaut", () => {
  for (const m of manifests) {
    if (!m.mcp) continue;
    const code = read(`${m.dir}/${m.main}`);
    for (const action of m.mcp) {
      assert.ok(new RegExp(`\\b${action.name}\\b`).test(code), `${m.id}.${action.name} n'est pas implémentée`);
      if (/delete|remove|publish|destroy|purge/.test(action.name)) {
        assert.equal(action.destructive, true, `${m.id}.${action.name} doit être déclarée destructive`);
        assert.notEqual(action.default, true, `${m.id}.${action.name} ne doit pas être active par défaut`);
      }
      if (action.destructive) assert.notEqual(action.default, true, `${m.id}.${action.name} : destructive ⇒ jamais par défaut`);
      if (action.readOnly) assert.ok(!action.destructive, `${m.id}.${action.name} : lecture seule ne peut être destructive`);
    }
  }
});

test("le formulaire de contact déclare ce qu'il collecte (politique de confidentialité), le bandeau d'accueil la vidéo qu'il accepte", () => {
  assert.ok((manifests.find((m) => m.id === "contact-form").privacy ?? {}).en, "contact-form : privacy absent");
  const hero = read("modules/hero/index.mjs");
  assert.ok(manifests.find((m) => m.id === "hero").settings.some((s) => s.type === "video"), "hero : réglage de type video");
  assert.match(hero, /\^\\\/uploads\\\/\[0-9a-f-\]\{36\}\\\.\(mp4\|webm\)\$/, "jamais d'adresse externe");
  assert.match(read("modules/contacts/index.mjs"), /async adminBadge[\s\S]*to_review/);
});

// Les descriptions du catalogue : celles des modules (les exemples pour développeurs sont hors règle).
const mods = manifests.filter((m) => m.dir.startsWith("modules/") && !m.content && m.main);
const text = (v) => (typeof v === "string" ? [v] : Object.values(v ?? {}).map(String));
const norm = (s) => s.toLowerCase().replace(/\s*\((obs|interne|internal)\)\s*/g, " ").replace(/\s+/g, " ").trim();

test("catalogue : la description d'un module dit ce que fait CE module — jamais un autre module, ni ce qui le consomme ou l'alimente", () => {
  assert.ok(mods.length >= 8);
  for (const m of mods) {
    const own = new Set(text(m.name).map(norm));
    for (const description of text(m.description)) {
      assert.ok(!/\bmodules?\b/i.test(description), `${m.id} : le mot « module » désigne un autre module → « ${description} »`);
      for (const other of mods) {
        if (other.id === m.id) continue;
        for (const name of text(other.name).map(norm)) {
          if (own.has(name) || !name.includes(" ")) continue;
          assert.ok(!norm(description).includes(name), `${m.id} cite « ${name} » (module ${other.id}) → « ${description} »`);
        }
      }
    }
  }
});

test("catalogue : pas de jargon technique dans une description (sujets d'échange, noms d'API)", () => {
  for (const m of mods) for (const description of text(m.description)) assert.ok(!/\b(topic|sujet [a-z]+\.[a-z]+|overlay\.item|feed\.item|ctx\.api|mcp)\b/i.test(description), `${m.id} → « ${description} »`);
});

test("aucune donnée personnelle ni métier d'un site précis dans ce dépôt", () => {
  const banned = [/helldog136\.be/i, /hotmail\.com/i, /gmail\.com/i];
  for (const file of dirs.flatMap(({ dir }) => walk(path.join(root, dir)))) {
    const text = fs.readFileSync(file, "utf8");
    for (const re of banned) assert.ok(!re.test(text), `${file} contient ${re}`);
  }
});

test("chaque module a un README.md (il est affiché dans le Catalogue avant l'installation)", () => {
  for (const { dir } of dirs) {
    const readme = path.join(root, dir, "README.md");
    assert.ok(fs.existsSync(readme) && fs.readFileSync(readme, "utf8").trim().length > 80, `${dir} : README.md absent ou vide`);
  }
});

test("l'index du Catalogue (catalogue/index.json) est valide : chaque entrée passe la validation de Curiosa et pointe son dossier", async () => {
  const { sanitizeEntries } = await import("@/core/modules/recognized");
  const index = JSON.parse(read("catalogue/index.json"));
  assert.equal(index.version, 1);
  const kept = sanitizeEntries(index);
  assert.equal(kept.length, index.modules.length, "toutes les entrées sont valides");
  for (const e of kept) assert.ok(fs.existsSync(path.join(root, e.subdir, "module.json")), `${e.id} : dossier ${e.subdir} introuvable`);
});
