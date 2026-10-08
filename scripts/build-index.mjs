// Génère catalogue/index.json (le Catalogue de Curiosa le relit) à partir des module.json du dépôt.
//   node scripts/build-index.mjs            écrit le fichier
//   node scripts/build-index.mjs --check    échoue s'il n'est pas à jour (utilisé par la CI)
// REF épingle l'étiquette ou le commit proposé à l'installation (défaut : master). REPO : adresse de ce dépôt.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const repo = process.env.REPO ?? "https://github.com/helldog136/curiosa-extras";
const ref = process.env.REF ?? "master";
const pick = (v) => (typeof v === "string" ? v : v?.fr ?? v?.en ?? Object.values(v ?? {})[0] ?? "");
const modules = [];
for (const group of ["modules", "examples"]) {
  for (const id of fs.readdirSync(path.join(root, group)).sort()) {
    const m = JSON.parse(fs.readFileSync(path.join(root, group, id, "module.json"), "utf8"));
    if (m.content) continue; // les modules « à contenu » de base sont proposés par l'assistant de départ, pas par le Catalogue
    modules.push({ id: m.id, name: pick(m.name), description: pick(m.description), repo, subdir: `${group}/${id}`, ref, version: m.version, apiVersion: m.apiVersion, author: m.author, icon: m.icon });
  }
}
const out = JSON.stringify({ version: 1, modules }, null, 2) + "\n";
const file = path.join(root, "catalogue/index.json");
if (process.argv.includes("--check")) {
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== out) { console.error("catalogue/index.json n'est pas à jour : lancez « node scripts/build-index.mjs »."); process.exit(1); }
} else fs.writeFileSync(file, out);
