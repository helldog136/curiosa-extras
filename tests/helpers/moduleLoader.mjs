import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

/** Charge un module du dépôt comme le fait Curiosa : manifeste (module.json), code (index.mjs, absent pour un module de contenu), textes (locales/*.json). */
export async function loadModule(dir) {
  const full = path.join(root, dir);
  const manifest = JSON.parse(fs.readFileSync(path.join(full, "module.json"), "utf8"));
  const definition = manifest.main ? (await import(pathToFileURL(path.join(full, manifest.main)).href)).default : {};
  const locales = {};
  const localeDir = path.join(full, "locales");
  if (fs.existsSync(localeDir)) for (const f of fs.readdirSync(localeDir)) if (f.endsWith(".json")) locales[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(localeDir, f), "utf8"));
  return { manifest, definition, locales };
}

/** Tous les dossiers de modules du dépôt : [{ dir: "modules/blog", id: "blog" }…]. */
export function listModuleDirs() {
  return ["modules", "examples"].flatMap((group) => {
    const base = path.join(root, group);
    return fs.existsSync(base) ? fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => ({ dir: `${group}/${e.name}`, id: e.name })) : [];
  });
}
