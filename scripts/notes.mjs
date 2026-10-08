// Texte de la release GitHub d'une version : sa section du CHANGELOG.md.   node scripts/notes.mjs 1.0.0
import fs from "node:fs";
const version = String(process.argv[2] ?? "").replace(/^v/, "");
const md = fs.readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const m = new RegExp(`^## ${version.replace(/\./g, "\\.")}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(md);
if (!m?.[1].trim()) { console.error(`CHANGELOG.md : aucune section « ## ${version} ».`); process.exit(1); }
console.log(m[1].trim());
