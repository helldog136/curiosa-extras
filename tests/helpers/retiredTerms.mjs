// R34 (docs/ERGONOMIE-ADMIN.md, core ADR 0011): « module » is the only word for a piece installed from the catalogue.
// Local mirror of RETIRED_TERMS / retiredTerms() of the core kit (testsupport/ergonomics.mjs, core dev). The kit copy tests/helpers/ergonomics.mjs
// must stay identical to the PUBLISHED core (tests/ergonomics.test.mjs), so it cannot carry R34 before the core release that ships it.
// When that release exists: sync tests/helpers/ergonomics.mjs, delete this file and import retiredTerms from the kit.
import fs from "node:fs";
import path from "node:path";

const LETTER = "\\p{L}\\p{N}_";
const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’‘]/g, "'");
export const RETIRED_TERMS = {
  en: ["extension", "extensions", "plugin", "plugins", "add-on", "add-ons", "addon", "addons", "feature", "features"],
  fr: ["extension", "extensions", "plugin", "plugins", "add-on", "add-ons", "addon", "addons", "fonctionnalite", "fonctionnalites"],
};
const re = (list) => new RegExp(`(?<![${LETTER}])(${list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![${LETTER}])`, "giu");
const RE = { en: re(RETIRED_TERMS.en), fr: re(RETIRED_TERMS.fr) };

/** Retired words found in one visible text (`lang`: "fr", "en", or "*" for both lists). */
export function retiredTerms(text, lang = "*") {
  const langs = lang === "*" ? ["fr", "en"] : [lang === "fr" ? "fr" : "en"];
  // markup and link targets are not read by people: « [Modules](/admin/extensions) » keeps the historical address
  const body = fold(String(text).replace(/<[^>]*>/g, " ").replace(/\]\([^)]*\)/g, "]"));
  return [...new Set(langs.flatMap((l) => [...body.matchAll(RE[l])].map((m) => m[1])))];
}

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
