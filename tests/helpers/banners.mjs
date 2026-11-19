// Informational banners that ask for nothing (docs/ERGONOMIE-ADMIN.md, R32): a banner with the tone "info" or "success" (or a tone known only at run time) and no link
// states something that is neither a problem nor a step. It belongs in a one-word status (badge) with a tooltip, or nowhere. This scans the module sources (static text,
// no run), lists those banners, and tests/banners-baseline.json keeps the KNOWN ones: the list only shrinks (see tests/ergonomics.test.mjs).
//
//   node tests/helpers/banners.mjs            prints the banners found
//   node tests/helpers/banners.mjs --write    rewrites tests/banners-baseline.json (refuses to grow it unless --reset)
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const BASELINE = path.join(root, "tests", "banners-baseline.json");

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));

/** The object literal that starts at the `{` before `at` (braces balanced; strings and template literals skipped). */
function objectAround(src, at) {
  let start = src.lastIndexOf("{", at);
  const scan = (from) => {
    let depth = 0, quote = null;
    for (let i = from; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return src.slice(from, i + 1);
    }
    return null;
  };
  // Walk outwards until the literal contains the position (a `{` inside a template string is not the object).
  for (let guard = 0; start >= 0 && guard < 20; guard++, start = src.lastIndexOf("{", start - 1)) {
    const lit = scan(start);
    if (lit && start + lit.length > at) return lit;
  }
  return null;
}

/** [{ id, module, file, tone, text }] : the banners without a link that are neither warnings nor errors. `id` is stable (no line number). */
export function bannersWithoutAction(base = root) {
  const out = new Map();
  const modulesDir = path.join(base, "modules");
  for (const mod of fs.readdirSync(modulesDir)) {
    for (const file of walk(path.join(modulesDir, mod)).filter((f) => /\.(mjs|js|ts)$/.test(f))) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/type:\s*"banner"/g)) {
        const lit = objectAround(src, m.index);
        if (!lit) continue;
        const toneMatch = lit.match(/\btone:\s*("[a-z]+"|[^,}\n]+)/);
        const tone = toneMatch ? toneMatch[1].trim().replace(/^"|"$/g, "") : "info";
        if (tone === "warning") continue;
        if (/\bhref\b/.test(lit)) continue;
        const textMatch = lit.match(/\btext:\s*([^\n]*?)(?:\s*\}\s*[,;)\]]*\s*$|,\s*(?:tab|tone|href):|$)/);
        const key = lit.match(/\bt\(\s*(`[^`]*`|"[^"]*")/)?.[1]?.replace(/^["`]|["`]$/g, "") ?? (textMatch?.[1] ?? "?").slice(0, 60);
        const rel = path.relative(path.join(modulesDir, mod), file).split(path.sep).join("/");
        const id = `${mod}/${rel} ${key}`;
        out.set(id, { id, module: mod, file: rel, tone: ["info", "success"].includes(tone) ? tone : "dynamic", text: key });
      }
    }
  }
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

export const readBannerBaseline = () => { try { return JSON.parse(fs.readFileSync(BASELINE, "utf8")); } catch { return null; } };

/** { fresh: ids not in the baseline, gone: baseline ids no longer found } */
export function compareBanners(found, known) {
  const have = new Set(found.map((b) => b.id)), wanted = new Set(known);
  return { fresh: [...have].filter((id) => !wanted.has(id)), gone: [...wanted].filter((id) => !have.has(id)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const found = bannersWithoutAction();
  if (process.argv.includes("--write")) {
    const prev = readBannerBaseline()?.known ?? [];
    const ids = found.map((b) => b.id);
    const kept = Object.fromEntries(Object.entries(readBannerBaseline()?.justified ?? {}).filter(([id]) => ids.includes(id)));
    const { fresh } = compareBanners(found, prev);
    if (fresh.length && prev.length && !process.argv.includes("--reset")) { console.error(`Refused: ${fresh.length} new banner(s) without an action:\n- ${fresh.join("\n- ")}\nFix them (a link, a status badge, a tooltip) instead of listing them.`); process.exit(1); }
    fs.writeFileSync(BASELINE, `${JSON.stringify({ comment: "KNOWN informational banners without a link (R32). This list only shrinks: fix one, then node tests/helpers/banners.mjs --write.", known: ids, ...(Object.keys(kept).length ? { justified: kept } : {}) }, null, 2)}\n`);
    console.log(`${ids.length} known banner(s) written.`);
  } else for (const b of found) console.log(`${b.tone.padEnd(8)} ${b.id}`);
}
