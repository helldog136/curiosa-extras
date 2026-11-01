#!/usr/bin/env node
// Écrit (ou vérifie, avec --check) tout ce que la table scripts/social-networks.mjs décide pour les 20 modules de réseau social :
//   • modules/<id>/index.mjs   le bloc « adresse du profil » (le fichier entier pour les réseaux sans statistiques) ;
//   • modules/<id>/module.json le réglage `profile` (libellé, aide courte, exemple), la description et `minCore` ;
//   • modules/<id>/README.md   la ligne « Réglage ».
// Sans option : écrit. --check : n'écrit rien, liste les fichiers qui ne correspondent plus à la table (code retour 1).
import fs from "node:fs";
import path from "node:path";
import { BEGIN, END, MIN_CORE, NETWORKS, description, hasStats, profileSetting, readmeSetting, renderBlock, renderWhole } from "./social-networks.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** Le bloc d'un fichier à statistiques : entre les marqueurs ; sinon (première fois) de « const NAME » à la fin de `profile()`. */
function replaceBlock(source, block) {
  const a = source.indexOf(BEGIN), b = source.indexOf(END);
  if (a >= 0 && b > a) return source.slice(0, a) + block + source.slice(b + END.length);
  const start = source.indexOf("const NAME =");
  const fn = source.indexOf("export function profile(", start);
  const end = fn < 0 ? -1 : source.indexOf("\n}\n", fn);
  if (start < 0 || end < 0) throw new Error("bloc d'adresse introuvable");
  return source.slice(0, start) + block + source.slice(end + 3);
}

export function expected(n) {
  const dir = path.join(root, "modules", n.id);
  const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
  const index = hasStats(n) ? replaceBlock(read("index.mjs"), renderBlock(n)) : renderWhole(n);
  const manifest = JSON.parse(read("module.json"));
  const at = manifest.settings.findIndex((s) => s.key === "profile");
  if (at < 0) throw new Error(`${n.id} : pas de réglage « profile »`);
  manifest.settings[at] = profileSetting(n);
  manifest.description = description(n);
  manifest.minCore = MIN_CORE;
  const readme = read("README.md").replace(/^- \*\*Réglage\*\* :.*$/m, readmeSetting(n));
  return { "index.mjs": index, "module.json": JSON.stringify(manifest, null, 2) + "\n", "README.md": readme };
}

const check = process.argv.includes("--check");
const stale = [];
for (const n of NETWORKS) {
  for (const [file, text] of Object.entries(expected(n))) {
    const p = path.join(root, "modules", n.id, file);
    if (fs.readFileSync(p, "utf8") === text) continue;
    stale.push(`modules/${n.id}/${file}`);
    if (!check) fs.writeFileSync(p, text);
  }
}
if (check) {
  if (stale.length) { console.error(`Fichiers qui ne correspondent plus à scripts/social-networks.mjs (lancez node scripts/gen-social.mjs) :\n- ${stale.join("\n- ")}`); process.exit(1); }
  console.log(`${NETWORKS.length} réseaux à jour.`);
} else console.log(stale.length ? `Écrit : ${stale.length} fichier(s).` : "Rien à changer.");
