#!/usr/bin/env node
// Garde-fou avant d'ouvrir ou de fusionner la PR de release (dev → master).
// Échoue si : des commits locaux ne sont pas poussés, l'arbre n'est pas propre,
// la version de package.json n'a pas sa section dans CHANGELOG.md, ou l'index est périmé.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const sh = (c) => execSync(c, { encoding: "utf8" }).trim();
const problems = [];

sh("git fetch -q origin dev");
if (sh("git status --porcelain")) problems.push("Des fichiers ne sont pas commités.");
const head = sh("git rev-parse HEAD");
const remote = sh("git rev-parse origin/dev");
if (head !== remote) problems.push(`HEAD (${head.slice(0, 7)}) n'est pas origin/dev (${remote.slice(0, 7)}) : poussez dev avant d'ouvrir la PR.`);

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
if (!new RegExp(`^## ${version.replace(/\./g, "\\.")}$`, "m").test(readFileSync("CHANGELOG.md", "utf8"))) problems.push(`CHANGELOG.md n'a pas de section « ## ${version} ».`);
try { sh("node scripts/build-index.mjs --check"); } catch { problems.push("catalogue/index.json est périmé : lancez node scripts/build-index.mjs."); }

if (problems.length) { console.error("Release non prête :\n- " + problems.join("\n- ")); process.exit(1); }
console.log(`Release ${version} prête : HEAD ${head.slice(0, 7)} == origin/dev.`);
