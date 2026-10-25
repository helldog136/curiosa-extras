// Aides du test « mise à jour à chaud de TOUS les modules » (tests/hot-update-all.test.mjs). Voir docs/HOT-UPDATE.md.
//
// Pourquoi : le cœur importe `index.mjs?v=<version>` ; Node garde en mémoire chaque adresse DÉJÀ importée. Un `import … from "./x.mjs"` (sans version) dans un fichier
// chargé par le serveur reprend donc l'ANCIEN x.mjs après une mise à jour à chaud, et le module peut devenir « impossible à charger » (Statut du live 1.3.2 → 1.16.0).
//
// Deux parties :
//   1. l'ANALYSE du code (sans l'exécuter) : quels fichiers le serveur charge à partir du fichier principal, et lesquels contiennent un import relatif statique ;
//   2. le REJEU de la mise à jour N-1 → N dans UN SEUL processus, avec un état existant, et la preuve que chaque fichier de la nouvelle version a bien été rechargé.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ── 1. Analyse du code ──────────────────────────────────────────────────────────────────────────────────────────────

const REGEX_PREV = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const REGEX_WORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "void", "delete", "throw", "new", "yield", "await"]);

/**
 * Découpe un fichier JavaScript : `masked` est le code où les commentaires et le CONTENU des chaînes sont remplacés par des espaces (mêmes positions) ;
 * `strings` liste chaque chaîne ou gabarit `{ start, raw }` (`raw` : le texte, chaque `${…}` y devient `${}`).
 */
export function lex(code) {
  const n = code.length;
  const masked = code.split("");
  const strings = [];
  const tplStack = []; // gabarits en cours : { tok, depth }
  let i = 0;
  let lastSig = "";
  let lastWord = "";
  const blank = (from, to) => { for (let k = from; k < to; k++) if (code[k] !== "\n") masked[k] = " "; };
  const scanTemplate = () => {
    const top = tplStack[tplStack.length - 1];
    while (i < n) {
      const ch = code[i];
      if (ch === "\\") { top.tok.raw += code.slice(i, i + 2); blank(i, i + 2); i += 2; continue; }
      if (ch === "`") { i++; tplStack.pop(); strings.push(top.tok); lastSig = '"'; lastWord = ""; return; }
      if (ch === "$" && code[i + 1] === "{") { top.tok.raw += "${}"; i += 2; top.depth = 0; lastSig = "{"; lastWord = ""; return; }
      top.tok.raw += ch; blank(i, i + 1); i++;
    }
  };
  while (i < n) {
    const c = code[i];
    if (c === "/" && code[i + 1] === "/") { const e = code.indexOf("\n", i); const end = e < 0 ? n : e; blank(i, end); i = end; continue; }
    if (c === "/" && code[i + 1] === "*") { const e = code.indexOf("*/", i + 2); const end = e < 0 ? n : e + 2; blank(i, end); i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && code[j] !== c && code[j] !== "\n") j += code[j] === "\\" ? 2 : 1;
      strings.push({ start: i, raw: code.slice(i + 1, j) });
      blank(i + 1, j); i = j + 1; lastSig = '"'; lastWord = ""; continue;
    }
    if (c === "`") { tplStack.push({ tok: { start: i, raw: "" }, depth: 0 }); i++; scanTemplate(); continue; }
    if (c === "{" && tplStack.length) tplStack[tplStack.length - 1].depth++;
    if (c === "}" && tplStack.length) {
      const top = tplStack[tplStack.length - 1];
      if (top.depth === 0) { i++; scanTemplate(); continue; }
      top.depth--;
    }
    if (c === "/" && (REGEX_PREV.has(lastSig) || REGEX_WORDS.has(lastWord))) { // expression régulière
      let j = i + 1; let inClass = false;
      while (j < n && code[j] !== "\n") {
        if (code[j] === "\\") { j += 2; continue; }
        if (code[j] === "[") inClass = true; else if (code[j] === "]") inClass = false; else if (code[j] === "/" && !inClass) break;
        j++;
      }
      blank(i + 1, j); i = j + 1; lastSig = '"'; lastWord = ""; continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < n && /[\w$]/.test(code[j])) j++; lastWord = code.slice(i, j); lastSig = "a"; i = j; continue; }
    lastSig = c; lastWord = ""; i++;
  }
  return { masked: masked.join(""), strings };
}

const lineOf = (code, offset) => code.slice(0, offset).split("\n").length;

/** Position de la parenthèse fermante qui répond à celle de `open` (dans le code masqué). */
function closingParen(masked, open) {
  let depth = 0;
  for (let k = open; k < masked.length; k++) {
    if (masked[k] === "(") depth++;
    else if (masked[k] === ")" && --depth === 0) return k;
  }
  return masked.length;
}

/**
 * Imports relatifs d'un fichier :
 *   statics   `import … from "./x"`, `export … from "./x"`, `import "./x"`           → [{ spec, line }]
 *   dynamics  `import(<expression qui nomme ./x>)`                                   → [{ specs, raw, versioned, line }]
 * Un import dynamique est « versionné » quand la chaîne se termine par une expression (`./x.mjs${v}`, `./${name}${q}`) ou est suivie d'une concaténation.
 */
export function relativeImports(code) {
  const { masked, strings } = lex(code);
  const statics = [];
  for (const t of strings) {
    if (!/^\.\.?\//.test(t.raw) || t.raw.includes("${")) continue;
    const before = masked.slice(Math.max(0, t.start - 60), t.start);
    if (/(^|[^.\w$])from\s*$/.test(before) || /(^|[;}\s])import\s*$/.test(before)) statics.push({ spec: t.raw, line: lineOf(code, t.start) });
  }
  const dynamics = [];
  for (const m of masked.matchAll(/(^|[^.\w$])import\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = closingParen(masked, open);
    const inside = strings.filter((t) => t.start > open && t.start < close && /^\.\.?\//.test(t.raw));
    if (!inside.length) continue;
    const raw = inside[0].raw;
    const isTemplate = code[inside[0].start] === "`";
    const versioned = isTemplate ? /(\.m?js|\$\{\})\$\{\}$/.test(raw) : /^\s*\+/.test(masked.slice(inside[0].start + raw.length + 2, close));
    dynamics.push({ specs: inside.map((t) => t.raw), raw, versioned, line: lineOf(code, open) });
  }
  return { statics, dynamics };
}

/** Fichier(s) visé(s) par la chaîne d'un import dynamique : `./x.mjs${v}` → x.mjs ; `./${name}${q}` ou `./layouts/${id}.mjs${V}` → tous les fichiers du dossier qui conviennent. */
function dynamicTargets(fromFile, raw, root) {
  const clean = raw.replace(/\$\{\}$/, ""); // la version finale
  const dir = path.dirname(fromFile);
  if (!clean.includes("${}")) return [path.resolve(dir, clean)];
  const [prefix, ...rest] = clean.split("${}");
  const suffix = rest[rest.length - 1] ?? "";
  const folder = path.resolve(dir, path.dirname(prefix + "x"));
  const base = path.basename(prefix + "x").slice(0, -1);
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true }).filter((e) => e.isFile() && /\.m?js$/.test(e.name) && e.name.startsWith(base) && e.name.endsWith(suffix)).map((e) => path.join(folder, e.name)).filter((f) => f.startsWith(root + path.sep));
}

const resolveFile = (from, spec) => path.resolve(path.dirname(from), spec);

/**
 * Les fichiers que le SERVEUR charge à partir du fichier principal (imports statiques et dynamiques relatifs, de proche en proche).
 * Renvoie { files: Set<chemin relatif>, statics: [{ file, spec, line }], unversioned: [{ file, raw, line }], missing: [{ file, target }] }.
 */
export function serverGraph(moduleDir, main = "index.mjs") {
  const root = path.resolve(moduleDir);
  const files = new Set();
  const statics = [];
  const unversioned = [];
  const missing = [];
  const queue = [path.join(root, main)];
  while (queue.length) {
    const file = queue.shift();
    const rel = path.relative(root, file);
    if (files.has(rel)) continue;
    if (!fs.existsSync(file)) continue;
    files.add(rel);
    const { statics: st, dynamics } = relativeImports(fs.readFileSync(file, "utf8"));
    for (const s of st) { statics.push({ file: rel, spec: s.spec, line: s.line }); queue.push(resolveFile(file, s.spec)); }
    for (const d of dynamics) {
      if (!d.versioned) unversioned.push({ file: rel, raw: d.raw, line: d.line });
      const targets = dynamicTargets(file, d.raw, root);
      if (!targets.length) missing.push({ file: rel, target: d.raw });
      for (const t of targets) { if (!fs.existsSync(t)) missing.push({ file: rel, target: path.relative(root, t) }); else queue.push(t); }
    }
  }
  return { files, statics, unversioned, missing };
}

/** Fichiers .mjs du module (hors dossiers de scripts/navigateur) qui contiennent un import relatif statique. */
export function staticImporters(moduleDir) {
  const root = path.resolve(moduleDir);
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.mjs$/.test(e.name) && relativeImports(fs.readFileSync(full, "utf8")).statics.length) out.push(path.relative(root, full));
    }
  };
  walk(root);
  return out;
}

// ── 2. Historique git ───────────────────────────────────────────────────────────────────────────────────────────────

const git = (cwd, args, opts = {}) => spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });

/** Les étiquettes de version (les plus récentes d'abord) accessibles dans ce dépôt, ou une raison claire si l'historique manque. */
export function publishedTags(repo) {
  const inside = git(repo, ["rev-parse", "--git-dir"]);
  if (inside.status !== 0) return { tags: [], reason: "le dossier n'est pas un dépôt git (aucun historique)" };
  const tags = git(repo, ["tag", "--list", "v[0-9]*", "--sort=-v:refname"]).stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!tags.length) return { tags: [], reason: "aucune étiquette de version (vX.Y.Z) dans le dépôt : récupérez-les avec « git fetch --tags --unshallow » (dans la CI : actions/checkout avec fetch-depth: 0)" };
  return { tags, reason: "" };
}

/** { module → version } du dossier modules/ à une étiquette (un seul appel git). */
export function versionsAt(repo, tag) {
  const r = git(repo, ["grep", "-n", "-e", '^  "version": "', tag, "--", "modules/*/module.json"]);
  const out = new Map();
  for (const line of r.stdout.split("\n")) {
    const m = /^[^:]+:modules\/([^/]+)\/module\.json:\d+:\s+"version": "([^"]+)"/.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/**
 * La version « N-1 » d'un module : l'étiquette la plus récente où sa version DIFFÈRE de la courante ; à défaut, la plus récente étiquette qui le contient
 * (même version : la mise à jour est alors rejouée sur le même code) ; sinon `null` (module encore jamais publié).
 */
export function previousRelease(repo, id, current, tags, cache = new Map()) {
  let sameVersionTag = null;
  for (const tag of tags) {
    if (!cache.has(tag)) cache.set(tag, versionsAt(repo, tag));
    const v = cache.get(tag).get(id);
    if (!v) continue;
    if (v !== current) return { tag, version: v, differs: true };
    sameVersionTag ??= { tag, version: v, differs: false };
  }
  return sameVersionTag;
}

/** Extrait modules/<id> d'une étiquette dans `dest` (git archive + tar, sans toucher au dépôt). */
export function extractRelease(repo, tag, id, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const archive = git(repo, ["archive", "--format=tar", tag, `modules/${id}`], { encoding: "buffer" });
  if (archive.status !== 0) throw new Error(`git archive ${tag} modules/${id} : ${String(archive.stderr).slice(0, 200)}`);
  const tmp = fs.mkdtempSync(path.join(path.dirname(dest), "arch-"));
  try {
    const x = spawnSync("tar", ["-x", "-C", tmp], { input: archive.stdout });
    if (x.status !== 0) throw new Error(`tar : ${String(x.stderr).slice(0, 200)}`);
    fs.cpSync(path.join(tmp, "modules", id), dest, { recursive: true });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ── 3. Rejeu de la mise à jour dans un seul processus ───────────────────────────────────────────────────────────────

const LOG = "__curiosaHotUpdateLog";

/** Recopie un module dans `dest` et ajoute à chaque .mjs une ligne qui note « ce fichier vient d'être évalué » (adresse complète, avec son `?v=`). */
function installInstrumented(from, dest, origin) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(from, dest, { recursive: true });
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.mjs$/.test(e.name)) fs.appendFileSync(full, `\n;(globalThis.${LOG} ??= []).push([import.meta.url, ${JSON.stringify(origin)}]);\n`);
    }
  };
  walk(dest);
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/** Le « module chargé » que les sondes du kit de test attendent (comme testsupport/loader.mjs), mais chargé avec NOTRE adresse `?v=`. */
async function loadAs(core, dir, version) {
  const manifest = readJson(path.join(dir, "module.json"));
  const sources = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(mjs|js)$/.test(e.name)) sources.push(fs.readFileSync(f, "utf8")); } };
  walk(dir);
  const locales = {};
  const localeDir = path.join(dir, "locales");
  if (fs.existsSync(localeDir)) for (const f of fs.readdirSync(localeDir)) if (f.endsWith(".json")) locales[f.slice(0, -5)] = readJson(path.join(localeDir, f));
  const mod = await import(`${pathToFileURL(path.join(dir, manifest.main ?? "index.mjs")).href}?v=${version}`);
  return { dir, name: path.basename(dir), exists: true, manifest, parsed: core.parseManifest(JSON.parse(JSON.stringify(manifest))), locales, code: sources.join("\n"), definition: mod.default ?? {}, loadErrors: [], network: [] };
}

const rowsFromStore = (store) => {
  const rows = {};
  for (const r of store) (rows[r.collection] ??= []).push(r.data);
  return rows;
};

const outputKey = (o) => `${o.kind} ${o.name}`;

/**
 * Rejoue, dans CE processus, la mise à jour d'un module :
 *   1. la version précédente (`oldDir`) est chargée avec `?v=ancien`, puis utilisée (réglages remplis : pages, routes, administration…) pour créer un état ;
 *   2. ses fichiers sont REMPLACÉS par ceux de la version courante (comme le fait le cœur : même dossier, mêmes adresses) ;
 *   3. la version courante est chargée avec `?v=nouveau`, et utilisée avec l'état qui existait ;
 *   4. une version TÉMOIN de la version courante est chargée dans un dossier neuf, sans historique, avec le même état : c'est la référence de ce qui doit se produire.
 * `tolerated` : fichiers (chemins relatifs) dont l'import statique est admis par la liste blanche du test ; ils ne sont pas reprochés ici non plus.
 * Renvoie la liste des problèmes (vide : la mise à jour est propre).
 */
export async function replayUpdate({ core, probes, oldDir, newDir, tmp, scenario = { mode: "filled" }, tolerated = new Set() }) {
  const problems = [];
  const live = path.join(tmp, "live");
  const control = path.join(tmp, "control");
  const log = () => (globalThis[LOG] ??= []);
  const mark = () => log().length;
  const since = (from) => log().slice(from);

  // 1. avant la mise à jour
  installInstrumented(oldDir, live, "ancien");
  let before;
  try { before = await loadAs(core, live, "ancien"); } catch (e) { return { problems: [], oldBroken: `la version précédente ne se charge pas dans le cœur de test : ${String(e?.message ?? e).split("\n")[0].slice(0, 160)}`, stats: {} }; }
  const oldRun = await probes.runScenario(before, scenario);
  const state = rowsFromStore(oldRun.store);

  // 2-3. la mise à jour
  installInstrumented(newDir, live, "nouveau");
  const m1 = mark();
  let after;
  try { after = await loadAs(core, live, "nouveau"); } catch (e) { return { problems: [`la nouvelle version ne se charge pas après la mise à jour à chaud : ${String(e?.message ?? e).split("\n")[0].slice(0, 200)}`], stats: {} }; }
  const newRun = await probes.runScenario(after, { ...scenario, rows: state });
  const evaluatedLive = since(m1);

  // 4. le témoin
  installInstrumented(newDir, control, "témoin");
  const m2 = mark();
  const ctl = await loadAs(core, control, "temoin");
  const ctlRun = await probes.runScenario(ctl, { ...scenario, rows: state });
  const evaluatedControl = since(m2);

  const relOf = (url, dir) => path.relative(dir, decodeURIComponent(new URL(url).pathname));
  const wantedFiles = new Set(evaluatedControl.map(([url]) => relOf(url, control)));
  const reloaded = new Set(evaluatedLive.filter(([, origin]) => origin === "nouveau").map(([url]) => relOf(url, live)));
  for (const f of [...wantedFiles].sort()) if (!reloaded.has(f) && !tolerated.has(f)) problems.push(`${f} : gardé en mémoire à l'ancienne version après la mise à jour (importé sans le « ?v= » du fichier principal) ; la nouvelle version n'a pas rechargé ce fichier`);
  // Le témoin prouve ce que fait le code : un fichier évalué SANS « ?v= » y est importé sans version (le même import, rejoué sur l'ancienne mémoire, reprendrait l'ancien fichier).
  for (const [url] of evaluatedControl) if (!/[?&]v=temoin\b/.test(url) && !tolerated.has(relOf(url, control))) problems.push(`${relOf(url, control)} : importé sans la version du fichier principal (import statique ou dynamique sans « ?v= ») : après une mise à jour à chaud, c'est l'ancien code qui resterait`);
  for (const [url, origin] of evaluatedLive) {
    if (origin === "ancien") problems.push(`${relOf(url, live)} : du code de l'ANCIENNE version a tourné après la mise à jour`);
    else if (!/[?&]v=nouveau\b/.test(url)) problems.push(`${relOf(url, live)} : chargé sans la version du fichier principal (${new URL(url).search || "adresse sans « ?v= »"})`);
  }

  // aucune exception de plus que chez le témoin
  const ctlOk = new Map(ctlRun.outputs.map((o) => [outputKey(o), o.ok]));
  for (const o of newRun.outputs) if (!o.ok && ctlOk.get(outputKey(o)) !== false) problems.push(`${outputKey(o)} : exception après la mise à jour (état existant) : ${o.error}`);
  if (newRun.fatal) problems.push(`la sonde a échoué après la mise à jour : ${newRun.fatal}`);

  return { problems, stats: { files: wantedFiles.size, calls: newRun.outputs.length, oldCalls: oldRun.outputs.length, rows: Object.values(state).reduce((n, a) => n + a.length, 0) } };
}
