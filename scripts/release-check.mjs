#!/usr/bin/env node
// Garde-fou avant d'ouvrir ou de fusionner la PR de release (dev → master).
// Échoue si : des commits locaux ne sont pas poussés, l'arbre n'est pas propre,
// la version de package.json n'a pas sa section dans CHANGELOG.md, ou l'index est périmé.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dataVersionProblems, manifestsAt, optionalNeedsProblems, previousTag, readManifests } from "./rules.mjs";

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


// Règles de kit : `requires[].optional` transporté par l'index, et dataVersion qui ne baisse jamais depuis l'étiquette précédente.
const manifests = readManifests(".");
problems.push(...optionalNeedsProblems(Object.entries(manifests).map(([id, m]) => ({ id, requires: m.requires })), JSON.parse(readFileSync("catalogue/index.json", "utf8"))));
try { sh("git fetch -q --tags origin"); } catch { /* hors ligne : on se contente des étiquettes locales */ }
const before = previousTag(".", version);
if (before) problems.push(...dataVersionProblems(manifests, manifestsAt(".", before)));
else console.warn("Aucune étiquette précédente trouvée : règle data.versionMonotonic ignorée.");

if (problems.length) { console.error("Release non prête :\n- " + problems.join("\n- ")); process.exit(1); }
console.log(`Release ${version} prête : HEAD ${head.slice(0, 7)} == origin/dev.`);
