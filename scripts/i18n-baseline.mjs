#!/usr/bin/env node
// The i18n BASELINE (docs/TRANSLATING.md in the core): tests/i18n-baseline.json lists, per module, the translation gaps that are KNOWN.
// English and French are always required. A gap of the baseline is tolerated; a NEW gap fails the test (tests/module-i18n.test.mjs); a gap that disappeared must be
// removed from the baseline. The baseline can only SHRINK: every counter may only go down.
//
//   node scripts/i18n-baseline.mjs --write           creates the baseline, or shrinks it; refuses to add a gap (--reset rewrites everything)
//   node scripts/i18n-baseline.mjs --report [--md]   the table "module -> gaps" and the phase-2 plan (batches of modules to migrate)
//   node scripts/i18n-baseline.mjs --check           like the test: exit code 1 on a new gap or a gap that disappeared
//   --root <folder>   another modules repository (modules/, examples/, tests/); default: this repository
//
// Four counters, per module:
//   manifest        texts of module.json that are not declared in English AND French (a plain string, a missing language, an empty text, other {variables}, a bad code): BLOCKING
//   agentTools      MCP tool descriptions with no French translation in the `i18n` block (written for an AI assistant, in English): advisory
//   localeFiles     keys of locales/en.json and locales/fr.json that are missing, empty or use other {variables} in one of the two: BLOCKING
//   frenchDefaults  places in the code that choose French for every language but English (`locale === "en" ? ... : "fr"`): a Dutch admin would read French
import fs from "node:fs";
import path from "node:path";
import { auditDictionaries, auditManifest, applyTranslations } from "./i18n-audit.mjs";
import { readModules } from "./ergonomics-baseline.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const root = path.resolve(value("--root") ?? new URL("..", import.meta.url).pathname);
const BASELINE = path.join(root, "tests", "i18n-baseline.json");
const COMMENT = "Known translation gaps per module (English and French are always required). This file can only shrink: translate, then node scripts/i18n-baseline.mjs --write. See docs/TRANSLATING.md of the core.";
export const COUNTERS = ["manifest", "agentTools", "localeFiles", "frenchDefaults"];

/** `locale === "en" ? <english> : <french>`: every other language falls to French. */
const FRENCH_DEFAULT = /(?:locale|lang)\s*===?\s*["']en["']\s*\?[^:;\n]*:\s*["']fr(?:-FR)?["']|(?:locale|lang)\s*!==?\s*["']fr["']\s*\?[^:;\n]*:\s*["']fr(?:-FR)?["']|\?\?\s*["']fr["']\s*\)\s*;?\s*\/\/\s*default/;

function codeFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "locales" || e.name === "node_modules" || e.name === "previews") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...codeFiles(p)); else if (/\.(mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The status of one module: { manifest: keys[], agentTools, localeFiles, frenchDefaults, languages }. */
export function moduleStatus(m) {
  const audit = auditManifest(applyTranslations(structuredClone(m.manifest), m.locales));
  let localeFiles = 0;
  if (Object.keys(m.locales).length) {
    const union = { ...(m.locales.fr ?? {}), ...(m.locales.en ?? {}) };
    const result = auditDictionaries({ ...m.locales, _union: union }, { reference: "_union" });
    for (const lang of ["en", "fr"]) localeFiles += result[lang].missing.length + result[lang].empty.length + result[lang].variables.length;
  }
  const frenchDefaults = codeFiles(m.dir).reduce((n, f) => n + fs.readFileSync(f, "utf8").split("\n").filter((l) => FRENCH_DEFAULT.test(l)).length, 0);
  return { manifest: audit.errors.map((g) => g.key).sort(), agentTools: audit.advisories.length, localeFiles, frenchDefaults, languages: audit.languages };
}

export function currentStatus(base = root) {
  return Object.fromEntries(readModules(base).map((m) => [m.name, moduleStatus(m)]));
}

export const readBaseline = (file = BASELINE) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);

/** The baseline for a status: only modules with a gap are listed. */
export function toBaseline(status) {
  const pick = (c) => Object.fromEntries(Object.entries(status).filter(([, s]) => s[c] > 0).map(([id, s]) => [id, s[c]]));
  const totals = Object.fromEntries(COUNTERS.map((c) => [c, Object.values(status).reduce((n, s) => n + (c === "manifest" ? s.manifest.length : s[c]), 0)]));
  return {
    $comment: COMMENT, version: 1, totals,
    modules: Object.fromEntries(Object.entries(status).filter(([, s]) => s.manifest.length).map(([id, s]) => [id, s.manifest])),
    agentTools: pick("agentTools"), localeFiles: pick("localeFiles"), frenchDefaults: pick("frenchDefaults"),
  };
}

/** What is wrong when a status is compared to a baseline: new gaps (fail) and gaps that disappeared (the baseline must shrink). */
export function ratchetProblems(status, baseline) {
  const out = [];
  for (const [id, s] of Object.entries(status)) {
    const known = new Set(baseline?.modules?.[id] ?? []);
    for (const key of s.manifest) if (!known.has(key)) out.push(`${id}: NEW gap ${key}`);
    for (const key of known) if (!s.manifest.includes(key)) out.push(`${id}: the gap "${key}" is fixed: remove it from tests/i18n-baseline.json (node scripts/i18n-baseline.mjs --write)`);
    for (const c of ["agentTools", "localeFiles", "frenchDefaults"]) {
      const was = baseline?.[c]?.[id] ?? 0;
      if (s[c] > was) out.push(`${id}: ${c} went up (${was} -> ${s[c]})`);
      else if (s[c] < was) out.push(`${id}: ${c} went down (${was} -> ${s[c]}): shrink the baseline (node scripts/i18n-baseline.mjs --write)`);
    }
  }
  return out;
}

/** Modules still listed in the baseline although they no longer exist. */
export function staleModules(status, baseline) {
  return [...new Set(["modules", "agentTools", "localeFiles", "frenchDefaults"].flatMap((c) => Object.keys(baseline?.[c] ?? {})))].filter((id) => !status[id]).sort();
}

/** Growth of a baseline compared to a previous one (the base branch): [] when it only shrank. */
export function baselineGrowth(previous, next) {
  const out = [];
  const keys = (b, id) => new Set(b?.modules?.[id] ?? []);
  for (const [id, list] of Object.entries(next?.modules ?? {})) for (const k of list) if (!keys(previous, id).has(k)) out.push(`${id}: ${k}`);
  for (const c of COUNTERS.filter((x) => x !== "manifest")) for (const [id, n] of Object.entries(next?.[c] ?? {})) if (n > (previous?.[c]?.[id] ?? 0)) out.push(`${id}: ${c} ${previous?.[c]?.[id] ?? 0} -> ${n}`);
  return out;
}

/** The report: one row per module that has a gap, from the most to the least, and the phase-2 plan in batches. */
export function reportRows(status) {
  return Object.entries(status).map(([name, s]) => ({ name, manifest: s.manifest.length, agentTools: s.agentTools, localeFiles: s.localeFiles, frenchDefaults: s.frenchDefaults, blocking: s.manifest.length + s.localeFiles, total: s.manifest.length + s.agentTools + s.localeFiles + s.frenchDefaults }))
    .filter((r) => r.total > 0).sort((a, b) => b.blocking - a.blocking || b.frenchDefaults - a.frenchDefaults || b.total - a.total || a.name.localeCompare(b.name));
}

/** Phase 2: batches of modules, most blocking first, each batch about `size` modules (a pull request per batch). */
export function phaseTwoPlan(rows, size = 10) {
  const batches = [];
  for (let i = 0; i < rows.length; i += size) batches.push(rows.slice(i, i + size));
  return batches;
}

export function formatReport(status, { md = false } = {}) {
  const rows = reportRows(status);
  const modules = Object.keys(status).length;
  const head = ["module", "manifest", "agent tools", "locale files", "French defaults"];
  const table = [head, ...rows.map((r) => [r.name, r.manifest, r.agentTools, r.localeFiles, r.frenchDefaults])];
  const sum = COUNTERS.map((c) => rows.reduce((n, r) => n + r[c], 0));
  table.push(["TOTAL", ...sum]);
  const text = md ? [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...table.slice(1).map((r) => `| ${r.join(" | ")} |`)].join("\n")
    : (() => { const w = head.map((_, i) => Math.max(...table.map((r) => String(r[i]).length))); return table.map((r) => r.map((c, i) => (i === 0 ? String(c).padEnd(w[i]) : String(c).padStart(w[i]))).join("  ")).join("\n"); })();
  const plan = phaseTwoPlan(rows).map((b, i) => `  batch ${i + 1}: ${b.map((r) => r.name).join(", ")}`);
  const blocking = rows.filter((r) => r.blocking > 0).length;
  return `${text}\n\n${modules} modules, ${rows.length} with at least one gap (${blocking} with a blocking English/French gap).\nPhase 2 (one pull request per batch of 10, blocking gaps first):\n${plan.join("\n") || "  nothing to migrate"}\n`;
}

function main() {
  const status = currentStatus();
  if (flag("--report")) { console.log(formatReport(status, { md: flag("--md") })); return 0; }
  const previous = readBaseline();
  const next = toBaseline(status);
  if (flag("--check")) {
    if (!previous) { console.error("tests/i18n-baseline.json is missing: node scripts/i18n-baseline.mjs --write"); return 1; }
    const problems = [...ratchetProblems(status, previous), ...staleModules(status, previous).map((id) => `${id}: removed module still listed in the baseline`)];
    for (const p of problems) console.error(p);
    return problems.length ? 1 : 0;
  }
  if (flag("--write")) {
    const growth = previous && !flag("--reset") ? baselineGrowth(previous, next) : [];
    if (growth.length) { console.error(`Refused: the baseline cannot grow.\n- ${growth.join("\n- ")}\nFix the gap instead (or --reset to rewrite everything).`); return 1; }
    fs.writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Wrote tests/i18n-baseline.json: ${COUNTERS.map((c) => `${c} ${next.totals[c]}`).join(", ")}.`);
    return 0;
  }
  console.error("usage: node scripts/i18n-baseline.mjs --write | --report [--md] | --check");
  return 2;
}
if (import.meta.url === new URL(process.argv[1] ?? "", "file://").href) process.exit(main());
