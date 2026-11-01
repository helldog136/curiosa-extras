#!/usr/bin/env node
// La base du CLIQUET d'ergonomie (docs/ERGONOMIE-ADMIN.md, règles [auto]) : tests/ergonomics-baseline.json liste, par module, ses écarts CONNUS.
// Un écart de la base est un avertissement ; un NOUVEL écart fait échouer le test (tests/ergonomics.test.mjs) ; un écart disparu doit être retiré de la base.
// La base ne peut que RÉTRÉCIR.
//
//   node scripts/ergonomics-baseline.mjs --write           crée la base (première fois) ou la fait rétrécir ; refuse d'ajouter un écart (ajoutez --reset pour tout réécrire)
//   node scripts/ergonomics-baseline.mjs --report [--top N] [--md]   le tableau « module → nombre d'écarts par règle »
//   node scripts/ergonomics-baseline.mjs --check           comme le test : code 1 s'il y a un nouvel écart ou un écart disparu
//   --root <dossier>    un autre dépôt de modules (modules/, examples/, tests/) ; par défaut, ce dépôt
//
// L'analyse est celle du kit du cœur (testsupport/ergonomics.mjs), recopiée dans tests/helpers/ergonomics.mjs : ce dépôt ne dépend d'aucune version du cœur.
import fs from "node:fs";
import path from "node:path";
import { analyzeModule, baselineGrowth, bubbleCount, compareToBaseline, countByRule, ratchetMessages, RULES } from "../tests/helpers/ergonomics.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const root = path.resolve(value("--root") ?? new URL("..", import.meta.url).pathname);
const BASELINE = path.join(root, "tests", "ergonomics-baseline.json");
const COMMENT = "Écarts d'ergonomie CONNUS par module (docs/ERGONOMIE-ADMIN.md, règles [auto]). Ce fichier ne peut que rétrécir : corrigez un écart, puis node scripts/ergonomics-baseline.mjs --write. Ne rajoutez jamais une ligne à la main.";

/** Les modules du dépôt : [{ name, dir, manifest, locales }] (dossiers de modules/ et examples/ qui ont un module.json). */
export function readModules(base = root) {
  return ["modules", "examples"].flatMap((group) => {
    const parent = path.join(base, group);
    if (!fs.existsSync(parent)) return [];
    return fs.readdirSync(parent, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(parent, e.name, "module.json"))).map((e) => {
      const dir = path.join(parent, e.name);
      const locales = {};
      const localeDir = path.join(dir, "locales");
      if (fs.existsSync(localeDir)) for (const f of fs.readdirSync(localeDir)) if (f.endsWith(".json")) locales[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(localeDir, f), "utf8"));
      return { name: e.name, group, dir, manifest: JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8")), locales };
    });
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export const readBaseline = (file = BASELINE) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);
const render = (modules) => `${JSON.stringify({ $comment: COMMENT, version: 1, modules }, null, 2)}\n`;

/** { name: écarts[] } pour tous les modules du dépôt. */
export function currentGaps(base = root) {
  return Object.fromEntries(readModules(base).map((m) => [m.name, analyzeModule({ id: m.manifest.id ?? m.name, manifest: m.manifest, locales: m.locales })]));
}

/** Le tableau « module → nombre d'écarts par règle », du plus fautif au moins fautif. */
export function reportRows(base = root) {
  const mods = readModules(base);
  return mods.map((m) => {
    const gaps = analyzeModule({ id: m.manifest.id ?? m.name, manifest: m.manifest, locales: m.locales });
    return { name: m.name, group: m.group, total: gaps.length, byRule: countByRule(gaps), bubble: bubbleCount(m) };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

export function formatReport(rows, { md = false, top } = {}) {
  const shown = top ? rows.slice(0, top) : rows;
  const cols = Object.keys(RULES).filter((r) => rows.some((x) => x.byRule[r]));
  const head = ["module", ...cols, "total", "bulle"];
  const line = (x) => [x.name, ...cols.map((r) => x.byRule[r] ?? 0), x.total, x.bubble];
  const sum = { name: "TOUS", byRule: Object.fromEntries(cols.map((r) => [r, rows.reduce((n, x) => n + (x.byRule[r] ?? 0), 0)])), total: rows.reduce((n, x) => n + x.total, 0), bubble: rows.reduce((n, x) => n + x.bubble, 0) };
  const table = [head, ...shown.map(line), line(sum)].map((r) => r.map(String));
  if (md) return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...table.slice(1).map((r) => `| ${r.join(" | ")} |`)].join("\n");
  const widths = head.map((_, i) => Math.max(...table.map((r) => r[i].length)));
  return table.map((r) => r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ")).join("\n")
    + `\n\n${rows.length} module(s), ${sum.total} écart(s). « bulle » : aides de plus de 60 caractères, qui passent dans la bulle « ? » du cœur (information, pas un écart).\n${cols.map((r) => `${r} : ${RULES[r]}`).join("\n")}`;
}

function main() {
  const gaps = currentGaps();
  if (flag("--report")) {
    console.log(formatReport(reportRows(), { md: flag("--md"), top: value("--top") ? Number(value("--top")) : undefined }));
    return 0;
  }
  const previous = readBaseline();
  if (flag("--check")) {
    if (!previous) { console.error("tests/ergonomics-baseline.json est absent : node scripts/ergonomics-baseline.mjs --write"); return 1; }
    let bad = 0;
    for (const [name, list] of Object.entries(gaps)) {
      const msgs = ratchetMessages(compareToBaseline(list, previous.modules?.[name]));
      for (const m of msgs) { console.error(`${name} : ${m}`); bad++; }
    }
    for (const name of Object.keys(previous.modules ?? {})) if (!(name in gaps)) { console.error(`${name} : module absent du dépôt, retirez-le de la base`); bad++; }
    console.log(bad ? `${bad} problème(s).` : "Base à jour : aucun nouvel écart, aucun écart disparu.");
    return bad ? 1 : 0;
  }
  if (flag("--write")) {
    const next = Object.fromEntries(Object.entries(gaps).filter(([, list]) => list.length).map(([name, list]) => [name, list.map((g) => g.key).sort()]));
    if (previous && !flag("--reset")) {
      // la base ne peut que rétrécir : on garde seulement les écarts déjà connus qui existent encore ; un écart nouveau est refusé
      const added = baselineGrowth(previous, { modules: next });
      if (added.length) {
        console.error(`Refus : ${added.length} NOUVEL écart(s) ne peuvent pas entrer dans la base (corrigez-les, la base ne s'allonge pas) :\n${added.slice(0, 30).map((a) => `  • ${a}`).join("\n")}${added.length > 30 ? `\n  … et ${added.length - 30} autre(s)` : ""}`);
        return 1;
      }
    }
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, render(next));
    const count = (m) => Object.values(m).reduce((n, l) => n + l.length, 0);
    console.log(`${path.relative(root, BASELINE)} écrit : ${count(next)} écart(s) connu(s)${previous ? ` (avant : ${count(previous.modules ?? {})})` : ""} dans ${Object.keys(next).length} module(s).`);
    return 0;
  }
  console.error("Usage : node scripts/ergonomics-baseline.mjs --write | --report [--top N] [--md] | --check   [--root <dossier>]");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) process.exit(main());
