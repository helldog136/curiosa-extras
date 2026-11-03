// Garde-fou d'architecture : le cœur ne connaît qu'UN segment libre dans l'adresse d'une route de module, TOUJOURS nommé `slug`, en dernière position
// (`matchModuleRoute` de src/core/modules/pageMeta.ts : clé « …/:slug », `params` = { slug } et rien d'autre). Une clé « cover/:id » n'est jamais trouvée
// (« Not found » du cœur) et un `ctx.params.id` vaut toujours `undefined`. Ce défaut a cassé la photo des partenaires du Planning (2.7.2) puis les jaquettes (1.3.1) :
// ce test lit les routes RÉELLES de tous les modules du dépôt (modules/, examples/, starter/) et leur code, pour qu'il ne revienne pas.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.env.CURIOSA_EXTRAS_DIR ?? path.join(path.dirname(new URL(import.meta.url).pathname), ".."));
const moduleDirs = [
  ...["modules", "examples"].flatMap((g) => fs.existsSync(path.join(root, g)) ? fs.readdirSync(path.join(root, g), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(root, g, e.name)) : []),
  path.join(root, "starter"),
].filter((d) => fs.existsSync(path.join(d, "module.json")));

/** Une clé de route est valable si elle n'a aucun « : », ou si son SEUL « : » est le dernier segment, exactement « :slug » (un seul segment libre). */
function badRouteKey(key) {
  if (!key.includes(":")) return null;
  const segs = key.split("/");
  const free = segs.filter((s) => s.includes(":"));
  if (free.length !== 1 || free[0] !== ":slug" || segs[segs.length - 1] !== ":slug") return `« ${key} » : seul le dernier segment peut être libre, et il s'écrit exactement « :slug »`;
  return null;
}

const sourcesOf = (dir) => fs.readdirSync(dir, { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile() && /\.(mjs|js)$/.test(e.name) && !/(^|[\\/])(node_modules|test|tests)([\\/]|$)/.test(path.relative(dir, path.join(e.parentPath ?? e.path, e.name))))
  .map((e) => path.join(e.parentPath ?? e.path, e.name));

test("le contrôle sait reconnaître une clé fautive (cover/:id, :slug au milieu, deux segments libres)", () => {
  for (const bad of ["cover/:id", "photo/:key", "a/:slug/b", ":id", "a/:slug/:slug", "x/y:slug", "a/:slug?"]) assert.ok(badRouteKey(bad), bad);
  for (const ok of ["cover/:slug", ":slug", "element/:slug", "photo", "lib/pure.mjs", "oauth/callback", "feed.ics"]) assert.equal(badRouteKey(ok), null, ok);
});

test("aucun module ne déclare une route dont le paramètre n'est pas exactement « :slug » en dernière position", async () => {
  assert.ok(moduleDirs.length > 20, "les modules du dépôt sont trouvés");
  let withRoutes = 0;
  const problems = [];
  for (const dir of moduleDirs) {
    const file = ["index.mjs", "index.js"].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
    if (!file) continue;
    const routes = (await import(pathToFileURL(file).href)).default?.routes;
    if (!routes) continue;
    withRoutes++;
    for (const key of Object.keys(routes)) { const p = badRouteKey(key); if (p) problems.push(`${path.relative(root, dir)} : ${p}`); }
  }
  assert.ok(withRoutes > 10, "des routes de modules ont bien été lues");
  assert.deepEqual(problems, []);
});

test("aucun code de module ne lit un paramètre de route autre que `slug` (ctx.params.id, params.key, params['id'], { id } = ctx.params…)", () => {
  const problems = [];
  for (const dir of moduleDirs) for (const f of sourcesOf(dir)) {
    const code = fs.readFileSync(f, "utf8").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    const rel = path.relative(root, f);
    for (const m of code.matchAll(/\bctx\??\.params\??\.([A-Za-z_$][\w$]*)/g)) if (m[1] !== "slug") problems.push(`${rel} : ctx.params.${m[1]}`);
    for (const m of code.matchAll(/\bctx\??\.params\??\[\s*(['"`])([^'"`]*)\1\s*\]/g)) if (m[2] !== "slug") problems.push(`${rel} : ctx.params[${m[1]}${m[2]}${m[1]}]`);
    for (const m of code.matchAll(/\{([^{}]*)\}\s*=\s*(?:ctx\.)?params\b(?!\s*\.)/g)) {
      const names = m[1].split(",").map((s) => s.trim().split(/[:=\s]/)[0]).filter(Boolean);
      for (const n of names) if (n !== "slug") problems.push(`${rel} : { ${n} } = params`);
    }
    for (const m of code.matchAll(/\b(?:const|let|var)\s+\w+\s*=\s*ctx\.params\b(?!\s*[?.\[])/g)) problems.push(`${rel} : ctx.params copié entier (lire ctx.params?.slug)`);
  }
  assert.deepEqual(problems, []);
});
