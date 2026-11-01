// Ergonomie des pages d'administration (docs/ERGONOMIE-ADMIN.md, règles [auto]) : le CLIQUET.
// Chaque module est lu (module.json + locales/*.json) par l'analyse du kit (tests/helpers/ergonomics.mjs, COPIE de testsupport/ergonomics.mjs du cœur : ce dépôt ne dépend
// d'aucune version du cœur). tests/ergonomics-baseline.json liste les écarts CONNUS de chaque module :
//   • un écart de la base          → avertissement (diagnostic du test) ;
//   • un NOUVEL écart              → échec (nouveau réglage, nouveau texte, texte modifié qui reste fautif) ;
//   • un écart disparu             → échec « retirez cette ligne de la base » : node scripts/ergonomics-baseline.mjs --write ;
//   • la base ne grossit jamais    → comparée à la branche de base du dépôt quand elle est disponible.
// Une fois le cœur qui porte l'exigence `admin.ergonomics` publié, tests/conformance.test.mjs la lance aussi (même base, même résultat).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeTempDir } from "./helpers/tmp.mjs";
import {
  analyzeModule, assertAdminPageErgonomics, adminPageErgonomicsProblems, baselineGrowth, compareToBaseline, ratchetMessages, countByRule, forbiddenWords, toneProblems, labelProblems, hasExample,
} from "./helpers/ergonomics.mjs";
import { readModules, readBaseline, reportRows, formatReport } from "../scripts/ergonomics-baseline.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const modules = readModules(root);
const baseline = readBaseline();
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT"));

test("la base d'ergonomie existe et ne parle que de modules du dépôt", () => {
  assert.ok(baseline, "tests/ergonomics-baseline.json est absent : node scripts/ergonomics-baseline.mjs --write");
  assert.equal(baseline.version, 1);
  const names = new Set(modules.map((m) => m.name));
  assert.deepEqual(Object.keys(baseline.modules).filter((n) => !names.has(n)), [], "module disparu : retirez-le de la base");
  for (const [name, keys] of Object.entries(baseline.modules)) assert.deepEqual([...keys].sort(), keys, `${name} : les lignes de la base sont triées`);
});

for (const m of modules) {
  test(`[${m.name}] ergonomie — aucun nouvel écart, aucun écart disparu`, (t) => {
    const gaps = analyzeModule({ id: m.manifest.id ?? m.name, manifest: m.manifest, locales: m.locales });
    const r = compareToBaseline(gaps, baseline?.modules?.[m.name] ?? []);
    const problems = ratchetMessages(r);
    if (r.tolerated.length) t.diagnostic(`⚠ ${r.tolerated.length} écart(s) connu(s) à résorber : ${Object.entries(countByRule(r.tolerated)).map(([k, n]) => `${k}×${n}`).join(" ")}`);
    assert.deepEqual(problems, [], `\n${problems.join("\n")}\nAide : docs/ERGONOMIE-ADMIN.md ; la base se met à jour avec node scripts/ergonomics-baseline.mjs --write (elle ne peut que rétrécir).`);
  });
}

test("la base ne s'allonge pas : comparée à la branche de base du dépôt (quand elle est disponible)", () => {
  const ref = process.env.ERGONOMICS_BASE_REF ?? "origin/master";
  const shown = spawnSync("git", ["show", `${ref}:tests/ergonomics-baseline.json`], { cwd: root, encoding: "utf8" });
  if (shown.status !== 0) return; // pas de git, pas de branche de base, ou base pas encore publiée : rien à comparer
  const growth = baselineGrowth(JSON.parse(shown.stdout), baseline);
  assert.deepEqual(growth, [], `la base d'ergonomie ne peut que rétrécir (par rapport à ${ref}) :\n${growth.slice(0, 20).join("\n")}`);
});

test("la copie de l'aide est identique à celle du cœur quand le cœur l'a (testsupport/ergonomics.mjs)", () => {
  const core = path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport", "ergonomics.mjs");
  if (!fs.existsSync(core)) return; // cœur plus ancien que le kit d'ergonomie : la copie de ce dépôt fait foi
  assert.equal(fs.readFileSync(path.join(root, "tests/helpers/ergonomics.mjs"), "utf8"), fs.readFileSync(core, "utf8"), "recopiez testsupport/ergonomics.mjs du cœur dans tests/helpers/ergonomics.mjs");
});

/* ───────────── Chaque règle : un module factice fautif ET un conforme ───────────── */
const L = (fr, en = fr) => ({ fr, en });
const field = (key, extra = {}) => ({ key, type: "text", default: "x", label: L(`Réglage ${key}`, `Setting ${key}`), ...extra });
const fake = (manifest, locales = {}) => ({ id: "demo", manifest: { id: "demo", name: L("Démo", "Demo"), ...manifest }, locales });
const rulesOf = (m) => new Set(analyzeModule(m).map((g) => g.rule));
const many = (n, extra = {}) => Array.from({ length: n }, (_, i) => field(`k${i}`, extra));

const CASES = {
  R5: [fake({ settings: many(8) }), fake({ settings: many(7) })],
  R9: [fake({ settings: [field("a", { label: L("Jeton d'accès", "Access token") })] }), fake({ settings: [field("a", { label: L("Code d'accès", "Access code") })] })],
  R10: [fake({ settings: [field("a", { label: L("Nom :", "Name:") })] }), fake({ settings: [field("a", { label: L("Nom", "Name") })] })],
  R11: [fake({ settings: [field("a", { default: undefined, help: L("Le nom.", "The name.") })] }), fake({ settings: [field("a", { default: undefined, help: L("Par exemple : Marie.", "For example: Marie.") })] })],
  R13: [fake({}, { fr: { a: "Veuillez patienter !" }, en: { a: "Please wait" } }), fake({}, { fr: { a: "Patientez un instant" }, en: { a: "Please wait" } })],
  R17: [fake({}, { fr: { a: "Activer / désactiver" }, en: { a: "Enable / disable" } }), fake({}, { fr: { a: "Activée" }, en: { a: "On" } })],
  R19: [fake({ settings: [field("a", { type: "boolean", label: L("Ne pas afficher", "Do not show") })] }), fake({ settings: [field("a", { type: "boolean", label: L("Afficher", "Show") })] })],
  R29: [fake({}, { fr: { a: "A {x}" }, en: { a: "A {y}" } }), fake({}, { fr: { a: "A {x}" }, en: { a: "A {x}" } })],
};
for (const [rule, [bad, good]] of Object.entries(CASES)) {
  test(`${rule} : le module fautif est détecté, le conforme passe`, () => {
    assert.ok(rulesOf(bad).has(rule), `${rule} aurait dû être signalée`);
    assert.ok(!rulesOf(good).has(rule), `${rule} ne devrait pas être signalée : ${JSON.stringify(analyzeModule(good).filter((g) => g.rule === rule))}`);
  });
}

test("R9, R10, R11, R13 : les mêmes mesures sur les petits textes", () => {
  assert.deepEqual(forbiddenWords("Le webhook de votre chaîne"), ["webhook"]);
  assert.deepEqual(forbiddenWords("L'adresse de votre chaîne"), []);
  assert.ok(labelProblems("a".repeat(61)).length && labelProblems("Nom :").length && !labelProblems("Nom").length);
  assert.ok(hasExample("Par exemple : insta, ig", "text") && !hasExample("Le nom", "text"));
  assert.ok(toneProblems("Tu peux")[0] && toneProblems("LE BOT EST COUPÉ")[0] && !toneProblems("Tapez !stop ici.").length);
});

test("neutral-wording : l'aide d'ergonomie refuse le point médian et « (e) » et laisse les textes neutres", () => {
  assert.ok(toneProblems("Les créateur·rices", "fr").length);
  assert.ok(toneProblems("Connecté(e)", "fr").length);
  assert.deepEqual(toneProblems("Une personne connectée", "fr"), []);
  assert.deepEqual(toneProblems("address(es) ready", "en"), []);
});

test("parité FR/EN : clés, {variables}, langue manquante", () => {
  const m = fake({ settings: [field("a", { label: { fr: "Titre" } })] }, { fr: { a: "x", b: "y {n}" }, en: { a: "x", b: "y {m}", c: "z" } });
  const msgs = analyzeModule(m).filter((g) => g.rule === "R29").map((g) => g.message).join("\n");
  assert.match(msgs, /anglais manquant/);
  assert.match(msgs, /absente en FR/);
  assert.match(msgs, /\{variables\}/);
});

test("pages produites par du code : assertAdminPageErgonomics (R3, R4, R14, R15, R17, R22)", () => {
  const rows = (n, cell) => Array.from({ length: n }, (_, i) => cell(i));
  const form = (n) => ({ type: "adminForm", action: "add", submitLabel: "Ajouter la personne", fields: rows(n, (i) => ({ name: `c${i}`, label: `Champ ${i}`, kind: "text" })) });
  const rulesOfPage = (blocks, opts) => adminPageErgonomicsProblems(blocks, opts).map((p) => p.rule);
  assert.deepEqual(rulesOfPage([form(6)]), ["R4"]);
  assert.deepEqual(rulesOfPage([form(5)]), []);
  assert.deepEqual(rulesOfPage([{ type: "table", columns: ["Nom"], rows: rows(12, (i) => [`n${i}`]) }]), ["R15"]);
  assert.deepEqual(rulesOfPage([{ type: "html", html: '<input type="search">' }, { type: "table", columns: ["Nom"], rows: rows(12, (i) => [`n${i}`]) }]), []);
  assert.deepEqual(rulesOfPage([{ type: "table", columns: ["Nom"], rows: [["a"]], rowIds: ["1"], rowActions: [{ label: "Activer / désactiver", action: "toggle" }] }]), ["R17"]);
  assert.deepEqual(rulesOfPage([{ type: "table", columns: ["Nom", "Origine"], rows: rows(7, (i) => [`n${i}`, "La vôtre"]) }]), ["R14"]);
  assert.deepEqual(rulesOfPage([], { errors: ["Valeur invalide"] }), ["R22"]);
  assert.deepEqual(rulesOfPage([], { errors: ["Écrivez un nombre entier, par exemple 500."] }), []);
  assert.throws(() => assertAdminPageErgonomics([form(9)]), /R4/);
  assert.doesNotThrow(() => assertAdminPageErgonomics([form(3)]));
});

/* ───────────── Le script : écrire, rétrécir, refuser de grossir, rapporter ───────────── */
function miniRepo(modulesSpec) {
  const repo = makeTempDir("ergo-script-");
  for (const [name, { manifest, locales }] of Object.entries(modulesSpec)) {
    const dir = path.join(repo, "modules", name);
    fs.mkdirSync(path.join(dir, "locales"), { recursive: true });
    fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify({ id: name, name: L(name, name), ...manifest }));
    for (const [lang, obj] of Object.entries(locales ?? {})) fs.writeFileSync(path.join(dir, "locales", `${lang}.json`), JSON.stringify(obj));
  }
  return repo;
}
const run = (repo, ...args) => spawnSync(process.execPath, [path.join(root, "scripts/ergonomics-baseline.mjs"), "--root", repo, ...args], { encoding: "utf8", env: cleanEnv });

test("script : --write crée la base, --check la valide, la base rétrécit mais ne grossit pas", () => {
  const repo = miniRepo({
    propre: { manifest: { settings: [field("a", { label: L("Nom", "Name") })] } },
    fautif: { manifest: { settings: [field("a", { label: L("Nom :", "Name:") })] }, locales: { fr: { a: "Bravo !" }, en: { a: "Great" } } },
  });
  assert.equal(run(repo, "--check").status, 1, "sans base : --check échoue");
  const w = run(repo, "--write");
  assert.equal(w.status, 0, w.stderr);
  const file = path.join(repo, "tests/ergonomics-baseline.json");
  const base = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(Object.keys(base.modules), ["fautif"], "un module sans écart n'est pas dans la base");
  assert.equal(base.modules.fautif.length, 3);
  assert.equal(run(repo, "--check").status, 0);
  // nouvel écart (un nouveau texte fautif) : --check échoue, --write refuse
  const mf = path.join(repo, "modules/fautif/module.json");
  const man = JSON.parse(fs.readFileSync(mf, "utf8"));
  man.settings.push(field("b", { label: L("Autre :", "Other:") }));
  fs.writeFileSync(mf, JSON.stringify(man));
  const bad = run(repo, "--check");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /NOUVEL écart R10/);
  const refused = run(repo, "--write");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Refus/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), base, "la base n'a pas changé");
  // un écart corrigé : --check demande de retirer la ligne, --write la retire
  man.settings.pop();
  man.settings[0].label = L("Nom", "Name");
  fs.writeFileSync(mf, JSON.stringify(man));
  const stale = run(repo, "--check");
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /retirez cette ligne de la base/);
  assert.equal(run(repo, "--write").status, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).modules.fautif.length, 1);
  assert.equal(run(repo, "--check").status, 0);
});

test("script : --report donne le tableau module → écarts par règle (le plus fautif en tête)", () => {
  const repo = miniRepo({
    propre: { manifest: { settings: [field("a", { label: L("Nom", "Name") })] } },
    fautif: { manifest: { settings: [field("a", { label: L("Nom :", "Name:") }), field("b", { label: L("Clé", "Key") })] } },
  });
  const out = run(repo, "--report");
  assert.equal(out.status, 0, out.stderr);
  const lines = out.stdout.split("\n");
  assert.match(lines[0], /module\s+R9\s+R10\s+total/);
  assert.match(lines[1], /^fautif\s+2\s+2\s+4/);
  assert.match(lines[2], /^propre\s+0\s+0\s+0/);
  assert.match(out.stdout, /TOUS\s+2\s+2\s+4/);
  assert.match(run(repo, "--report", "--md").stdout, /^\| module \| R9 \| R10 \| total \| bulle \|/);
});

test("les 70 modules du dépôt : le tableau --report est cohérent avec la base", () => {
  const rows = reportRows(root);
  assert.ok(rows.length >= 70);
  const total = rows.reduce((n, r) => n + r.total, 0);
  assert.equal(total, Object.values(baseline.modules).reduce((n, l) => n + l.length, 0), "la base contient exactement les écarts constatés");
  assert.match(formatReport(rows, { top: 10 }), /TOUS/);
});
