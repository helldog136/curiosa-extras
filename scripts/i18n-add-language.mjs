#!/usr/bin/env node
// Adds a language to the modules with FILES ONLY: writes `modules/<id>/locales/<code>.json` (a skeleton: every key to translate, empty texts) for every module.
// The script itself lives in the core (one source): this wrapper calls it with this repository as `--modules`. See docs/TRANSLATING.md of the core.
//
//   CURIOSA_DIR=../Curiosa node scripts/i18n-add-language.mjs nl                  every module
//   CURIOSA_DIR=../Curiosa node scripts/i18n-add-language.mjs nl --module blog    one module
//   CURIOSA_DIR=../Curiosa node scripts/i18n-add-language.mjs nl --only manifest.name,manifest.description    only these keys
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const here = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const core = path.resolve(process.env.CURIOSA_DIR ?? path.join(here, "..", "Curiosa"));
const script = path.join(core, "scripts/i18n-add-language.mjs");
if (!fs.existsSync(script)) {
  console.error(`The core (Curiosa) was not found in "${core}". Clone it next to this repository, or set CURIOSA_DIR=/path/to/Curiosa.`);
  process.exit(2);
}
const r = spawnSync(process.execPath, [script, ...process.argv.slice(2), "--modules", here, "--no-core"], { stdio: "inherit", cwd: core });
process.exit(r.status ?? 1);
