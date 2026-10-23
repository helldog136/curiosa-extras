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
const dirs = listModuleDirs();
const manifests = dirs.map(({ dir }) => ({ dir, ...JSON.parse(read(`${dir}/module.json`)) }));

test("chaque dossier est un module cohérent : id = nom du dossier, licence déclarée (version, fichier principal, API : suite de conformité)", () => {
  assert.ok(manifests.length >= 20);
  for (const m of manifests) {
    assert.equal(m.id, path.basename(m.dir), m.dir);
    assert.ok(m.license, `${m.dir} : licence absente de module.json`);
  }
});

test("le kit presse ne stocke rien : il lit l'identité du cœur (ctx.api.brand) et c'est tout", () => {
  const code = read("modules/press-kit/index.mjs");
  assert.ok(code.includes("ctx.api.brand"), "le kit presse doit lire l'identité via ctx.api.brand");
  for (const forbidden of ["ctx.api.store", "adminActions", "adminPanel", "setSetting", "prisma"]) assert.ok(!code.includes(forbidden), `le kit presse ne doit pas utiliser « ${forbidden} »`);
});

// Exception EXPLIQUÉE : sujets déjà utilisés ici et pas encore dans le tableau « Sujets connus » du cœur (0.1.16). À retirer dès que le cœur les documente.

test("sujets : ceux de nos modules sont en anglais, en minuscules, et listés dans docs/MODULES.md du cœur", () => {
  const doc = fs.readFileSync(path.join(core, "docs/MODULES.md"), "utf8");
  const used = new Set();
  for (const { dir } of dirs) {
    for (const m of read(`${dir}/module.json`).matchAll(/"topic": *"([^"]+)"/g)) used.add(m[1]);
    const main = JSON.parse(read(`${dir}/module.json`)).main;
    if (main) for (const m of read(`${dir}/${main}`).matchAll(/\btopic: "([^"]+)"/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 5, "des sujets doivent être trouvés");
  // Sujets que le cœur publié (0.1.27) ne liste pas encore dans son tableau : une entrée = une exception expliquée, à retirer quand le cœur les documente.
  // (vide : le sujet « stream.partner » a été retiré avec Story 2.0)
  const NOT_YET_DOCUMENTED = new Set(["ha.result", "ha.state", "live.event"]);   // pont Home Assistant (home-assistant, lus par twitch-bot et youtube-live-actions) : documentés par la branche `core/docs-sujets-ha` du cœur (0.2.8) ; RETIRER cette exception dès que le cœur publié les liste ; « live.event » (dons et adhésions du direct, publié par youtube-live-actions, lu par alerts-overlay) : à ajouter au tableau « Sujets connus » du cœur, puis retirer
  for (const topic of used) {
    assert.match(topic, /^[a-z]+(\.[a-z]+)+$/, `sujet « ${topic} » : minuscules, domaine.objet`);
    assert.ok(NOT_YET_DOCUMENTED.has(topic) || doc.includes(`\`${topic}\``), `sujet « ${topic} » absent du tableau « Sujets connus » de docs/MODULES.md (cœur)`);
  }
});

test("le bandeau d'accueil n'accepte que la vidéo envoyée au site, Contacts signale les messages à vérifier", () => {
  const hero = read("modules/hero/index.mjs");
  assert.ok(manifests.find((m) => m.id === "hero").settings.some((s) => s.type === "video"), "hero : réglage de type video");
  assert.match(hero, /\^\\\/uploads\\\/\[0-9a-f-\]\{36\}\\\.\(mp4\|webm\)\$/, "jamais d'adresse externe");
  assert.match(read("modules/contacts/admin.mjs"), /async adminBadge[\s\S]*to_review/);
});

// Les descriptions du catalogue : celles des modules (les exemples pour développeurs sont hors règle).
const mods = manifests.filter((m) => m.dir.startsWith("modules/") && !m.content && m.main);
const text = (v) => (typeof v === "string" ? [v] : Object.values(v ?? {}).map(String));
const norm = (s) => s.toLowerCase().replace(/\s*\((obs|interne|internal)\)\s*/g, " ").replace(/\s+/g, " ").trim();

// Noms de modules qui sont aussi de simples mots d'une phrase (« live status » dans la description de Ma Chaîne Twitch désigne l'état du direct, pas le module Statut du live).
const PLAIN_WORDS = new Set(["live status"]);

test("catalogue : la description d'un module dit ce que fait CE module — jamais un autre module, ni ce qui le consomme ou l'alimente", () => {
  assert.ok(mods.length >= 8);
  for (const m of mods) {
    const own = new Set(text(m.name).map(norm));
    for (const description of text(m.description)) {
      assert.ok(!/\bmodules?\b/i.test(description), `${m.id} : le mot « module » désigne un autre module → « ${description} »`);
      for (const other of mods) {
        if (other.id === m.id) continue;
        for (const name of text(other.name).map(norm)) {
          if (own.has(name) || !name.includes(" ") || PLAIN_WORDS.has(name)) continue;
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

test("l'index du Catalogue (catalogue/index.json) est valide : chaque entrée passe la validation de Curiosa et pointe son dossier", async () => {
  const { sanitizeEntries } = await import("@/core/modules/recognized");
  const index = JSON.parse(read("catalogue/index.json"));
  assert.equal(index.version, 1);
  const kept = sanitizeEntries(index);
  assert.equal(kept.length, index.modules.length, "toutes les entrées sont valides");
  for (const e of kept) assert.ok(fs.existsSync(path.join(root, e.subdir, "module.json")), `${e.id} : dossier ${e.subdir} introuvable`);
});

test("modules suggérés (catalogue/suggested.json) : des modules qui existent, sans dépendance, et le manifeste ne porte aucun drapeau d'assistant", () => {
  const suggested = JSON.parse(read("catalogue/suggested.json"));
  assert.ok(Array.isArray(suggested) && suggested.length > 0);
  for (const id of suggested) {
    const m = manifests.find((x) => x.id === id && x.dir.startsWith("modules/"));
    assert.ok(m, `${id} : module introuvable dans modules/`);
    assert.deepEqual(m.requires ?? [], [], `${id} : un module suggéré à l'assistant ne doit pas exiger un autre module`);
  }
  for (const m of manifests) assert.ok(!("starter" in m) && !("always" in (m.onboarding ?? {})) && !("preselected" in (m.onboarding ?? {})), `${m.id} : drapeaux d'assistant retirés (la suggestion est dans suggested.json)`);
});

test("index du Catalogue épinglé : chaque entrée pointe l'étiquette de la version du dépôt (jamais une branche), et le CHANGELOG a sa section", () => {
  const version = JSON.parse(read("package.json")).version;
  const index = JSON.parse(read("catalogue/index.json"));
  assert.ok(index.modules.length > 0);
  for (const e of index.modules) assert.equal(e.ref, `v${version}`, `${e.id} : ref épinglée sur v${version}`);
  // Tant que la version n'est pas publiée, ses notes sont sous « Prochaine version (non publiée) » : le publieur la renomme (scripts/release-check.mjs, lui, exige toujours « ## <version> »).
  assert.match(read("CHANGELOG.md"), new RegExp(`^## (?:${version.replace(/\./g, "\\.")}|Prochaine version \\(non publiée\\))$`, "m"), `CHANGELOG.md : section « ## ${version} »`);
});
