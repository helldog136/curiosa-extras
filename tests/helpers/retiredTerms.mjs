// R34 (docs/ERGONOMIE-ADMIN.md, core ADR 0011): « module » is the only word for a piece installed from the catalogue.
// The checker itself (RETIRED_TERMS, retiredTerms) now lives in the kit tests/helpers/ergonomics.mjs, the copy of the published core (0.52.0 and later).
// This file keeps what the kit does not have: collecting the visible texts of a module directory, and ignoring link targets.
import fs from "node:fs";
import path from "node:path";

import { retiredTerms as kitRetiredTerms } from "./ergonomics.mjs";

export { RETIRED_TERMS } from "./ergonomics.mjs";

/** Retired words of one visible text, by the kit's checker. Markup and link targets are not read by people: « [Modules](/admin/extensions) » keeps the historical address. */
export const retiredTerms = (text, lang = "*") => kitRetiredTerms(String(text).replace(/<[^>]*>/g, " ").replace(/\]\([^)]*\)/g, "]"), lang);

/** Every visible text of a manifest: the strings of its `{ fr, en }` objects, with their path and language. */
export function manifestTexts(node, p = "$", out = []) {
  if (Array.isArray(node)) node.forEach((v, i) => manifestTexts(v, `${p}[${i}]`, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if ((k === "fr" || k === "en") && typeof v === "string") out.push({ path: p, lang: k, text: v });
      else manifestTexts(v, `${p}.${k}`, out);
    }
  }
  return out;
}

/** Visible texts of one module directory: manifest `{ fr, en }` strings and every string of locales/*.json (en and fr). */
export function moduleTexts(dir) {
  const out = [];
  const man = path.join(dir, "module.json");
  if (fs.existsSync(man)) for (const t of manifestTexts(JSON.parse(fs.readFileSync(man, "utf8")))) out.push({ id: `module.json ${t.path}`, lang: t.lang, text: t.text });
  const loc = path.join(dir, "locales");
  if (fs.existsSync(loc)) for (const f of ["en", "fr"]) {
    const file = path.join(loc, `${f}.json`);
    if (!fs.existsSync(file)) continue;
    for (const [key, text] of Object.entries(JSON.parse(fs.readFileSync(file, "utf8")))) if (typeof text === "string") out.push({ id: `locales/${f}.json ${key}`, lang: f, text });
  }
  return out;
}
