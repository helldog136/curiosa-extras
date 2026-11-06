#!/usr/bin/env node
// Writes showcase-bundle-<version>.json: everything the website needs to publish the module showcase of one release, in one file.
//   node scripts/showcase-bundle.mjs 1.47.0 [--out <folder>]
// Content: the index and the categories, then for every module its entry.json, its two texts (Markdown) and its screenshots with path, size,
// sha256 and the address to download each one at the tag v<version> (see showcase/README.md). It runs the showcase check first and refuses a showcase with problems.
// The release workflow attaches the file to the GitHub release.
import fs from "node:fs";
import path from "node:path";
import { checkShowcase, sha256 } from "./showcase-check.mjs";

export const REPO = "helldog136/curiosa-extras";
export const rawBase = (version) => `https://raw.githubusercontent.com/${REPO}/v${version}/showcase/modules`;

export function buildBundle(root, version) {
  const r = checkShowcase(root);
  if (r.problems.length) throw new Error(`the showcase has ${r.problems.length} problem(s); run node scripts/showcase-check.mjs\n${r.problems.slice(0, 10).join("\n")}`);
  const dir = path.join(root, "showcase");
  const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
  const modules = index.modules.map((m) => {
    const base = path.join(dir, "modules", m.id);
    const entry = JSON.parse(fs.readFileSync(path.join(base, "entry.json"), "utf8"));
    const shots = entry.screenshots.map((s) => {
      const buf = fs.readFileSync(path.join(base, "shots", s.file));
      return { file: s.file, kind: s.kind, path: `showcase/modules/${m.id}/shots/${s.file}`, bytes: buf.length, sha256: sha256(buf), url: `${rawBase(version)}/${m.id}/shots/${s.file}` };
    });
    return { id: m.id, entry, texts: { en: fs.readFileSync(path.join(base, "entry.en.md"), "utf8"), fr: fs.readFileSync(path.join(base, "entry.fr.md"), "utf8") }, shots };
  });
  return { version, tag: `v${version}`, repository: REPO, rawBase: rawBase(version), categories: index.categories, index: index.modules, modules };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));
  if (!version) { console.error("Usage: node scripts/showcase-bundle.mjs <version> [--out <folder>]"); process.exit(2); }
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const outDir = path.resolve(args.includes("--out") ? args[args.indexOf("--out") + 1] : process.cwd());
  const bundle = buildBundle(root, version);
  const out = path.join(outDir, `showcase-bundle-${version}.json`);
  fs.writeFileSync(out, JSON.stringify(bundle, null, 1) + "\n");
  console.log(`${out}: ${bundle.modules.length} modules, ${bundle.modules.reduce((n, m) => n + m.shots.length, 0)} screenshots, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}
