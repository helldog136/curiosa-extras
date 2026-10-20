// Règles du dépôt, en fonctions pures (aucun réseau, aucune écriture) : partagées par build-index.mjs, release-check.mjs et les tests.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Services offerts / requis annoncés par l'index du catalogue : le cœur choisit et annonce un fournisseur AVANT de télécharger le module (« installe aussi… »).
 * `field` : « version » (offres) ou « min » (besoins). Pour un besoin, `optional: true` du manifeste est recopié (et SEULEMENT la valeur booléenne true) :
 * sans lui, un cœur 0.2.0 traiterait un besoin facultatif comme dur et installerait d'office son fournisseur.
 */
export const serviceList = (list, field) => (Array.isArray(list) ? list.map((x) => (typeof x === "string" ? { service: x } : x)).filter((x) => x?.service).map((x) => {
  const o = {
    service: x.service,
    ...(Number.isInteger(x[field]) && x[field] > 1 ? { [field]: x[field] } : {}),
    ...(field === "version" && x.each === true ? { each: true } : {}),   // `each` : chaque instance répond pour elle-même (offres seulement)
    ...(field === "min" && x.optional === true ? { optional: true } : {}),   // besoin facultatif (besoins seulement)
  };
  return Object.keys(o).length === 1 ? o.service : o;
}) : []);

const needOf = (n) => (typeof n === "string" ? { service: n } : n);

/**
 * Règle `needs.optional` : chaque `requires[].optional` d'un manifeste est dans l'index, tel quel (true) ; une valeur autre que true (false, texte…) est refusée
 * dans le manifeste (elle serait ignorée par l'index mais lue comme « dur » ou « facultatif » selon le cœur) ; l'index ne déclare jamais un facultatif absent du manifeste.
 * `manifests` : [{ id, requires }] ; `index` : le contenu de catalogue/index.json.
 */
export function optionalNeedsProblems(manifests, index) {
  const problems = [];
  const entries = new Map((index?.modules ?? []).map((e) => [e.id, e]));
  for (const m of manifests) {
    const declared = (Array.isArray(m.requires) ? m.requires : []).filter((r) => r && typeof r === "object");
    for (const r of declared) if ("optional" in r && r.optional !== true) problems.push(`${m.id} : requires[${r.service}].optional vaut ${JSON.stringify(r.optional)} : seule la valeur true est permise (retirez la clé pour un besoin dur).`);
    const entry = entries.get(m.id);
    if (!entry) { problems.push(`${m.id} : absent de catalogue/index.json.`); continue; }
    const needs = (entry.needs ?? []).map(needOf);
    for (const r of declared) {
      const hit = needs.find((n) => n.service === r.service);
      if (!hit) problems.push(`${m.id} : le besoin « ${r.service} » manque dans l'index (needs).`);
      else if ((r.optional === true) !== (hit.optional === true)) problems.push(`${m.id} : « ${r.service} » est ${r.optional === true ? "facultatif dans le manifeste mais dur" : "dur dans le manifeste mais facultatif"} dans l'index.`);
    }
    for (const n of needs) if (n.optional !== undefined && n.optional !== true) problems.push(`${m.id} : l'index porte optional=${JSON.stringify(n.optional)} pour « ${n.service} ».`);
  }
  return problems;
}

/** `dataVersion` d'un manifeste (absent = 1, comme le cœur). */
export const dataVersionOf = (m) => (Number.isInteger(m?.dataVersion) && m.dataVersion >= 1 ? m.dataVersion : 1);

/**
 * Règle `data.versionMonotonic` : un module ne baisse JAMAIS sa `dataVersion` entre deux versions publiées (sinon le cœur voit les données de ses instances
 * « plus récentes que le module » et les met à l'écart). Un module absent de la version précédente est nouveau : rien à comparer.
 * `current` / `previous` : { [id]: manifeste }. Vérifie aussi `dataFloor` ≤ `dataVersion`.
 */
export function dataVersionProblems(current, previous) {
  const problems = [];
  for (const [id, m] of Object.entries(current)) {
    const now = dataVersionOf(m);
    const before = previous?.[id] ? dataVersionOf(previous[id]) : null;
    if (before !== null && now < before) problems.push(`${id} : dataVersion ${before} → ${now} : elle ne baisse jamais (data.versionMonotonic).`);
    if (m.dataFloor !== undefined && !(Number.isInteger(m.dataFloor) && m.dataFloor >= 1 && m.dataFloor <= now)) problems.push(`${id} : dataFloor (${JSON.stringify(m.dataFloor)}) doit être un entier entre 1 et dataVersion (${now}).`);
  }
  return problems;
}

/** Manifestes de ce dépôt : { [id]: module.json lu } pour modules/* et examples/*. */
export function readManifests(root) {
  const out = {};
  for (const group of ["modules", "examples"]) {
    const base = path.join(root, group);
    if (!fs.existsSync(base)) continue;
    for (const id of fs.readdirSync(base).sort()) {
      const f = path.join(base, id, "module.json");
      if (fs.existsSync(f)) out[id] = JSON.parse(fs.readFileSync(f, "utf8"));
    }
  }
  return out;
}

const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const semver = (t) => t.slice(1).split(".").map(Number);
const cmp = (a, b) => { const x = semver(a), y = semver(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

/**
 * Étiquette PRÉCÉDENTE : la plus haute étiquette vX.Y.Z strictement inférieure à `version` (celle du package.json). null si le dépôt n'a pas d'étiquette utilisable
 * (clone sans étiquettes, pas de git) : la règle est alors ignorée, jamais inventée.
 */
export function previousTag(root, version) {
  try {
    const tags = git(root, ["tag", "--list", "v*.*.*"]).split("\n").filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
    const below = tags.filter((t) => cmp(t, `v${version}`) < 0).sort(cmp);
    return below.length ? below[below.length - 1] : null;
  } catch { return null; }
}

/** Manifestes tels qu'ils étaient à `tag` : { [id]: module.json }. Un module sans manifeste à cette étiquette est simplement absent. */
export function manifestsAt(root, tag) {
  const out = {};
  for (const group of ["modules", "examples"]) {
    let ids = [];
    try { ids = git(root, ["ls-tree", "--name-only", tag, `${group}/`]).split("\n").filter(Boolean); } catch { continue; }
    for (const p of ids) {
      try { out[path.basename(p)] = JSON.parse(execFileSync("git", ["show", `${tag}:${p}/module.json`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); } catch { /* module sans manifeste à cette étiquette */ }
    }
  }
  return out;
}
