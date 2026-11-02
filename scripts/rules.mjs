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

/**
 * VISUELS D'UNE FICHE (`previews` de module.json, cœur 0.6.x) : les MÊMES bornes que le cœur (src/core/modules/previews.ts) pour que ce dépôt refuse ce que le cœur écarterait.
 * Les images restent dans le dépôt du module (`previews/`) : l'index du catalogue n'en recopie que la déclaration (file, type, caption, alt), jamais les octets.
 */
export const PREVIEW_LIMITS = { max: 6, bytes: 150 * 1024, minSide: 240, maxSide: 2400, maxPixels: 4_000_000, caption: 140, alt: 250 };
export const PREVIEW_TYPES = ["public", "admin", "overlay"];
const PREVIEW_FILE_RE = /^previews\/[a-z0-9][a-z0-9._-]{0,63}\.(webp|png)$/;
const LOCALE_RE = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;

/** Type RÉEL et dimensions d'après les octets (jamais l'extension) : PNG ou WebP (lossy, lossless, étendu) ; null pour tout le reste. */
export function sniffImage(b) {
  if (b.length > 33 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && b.subarray(12, 16).toString("latin1") === "IHDR") return { type: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 30 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") {
    const kind = b.subarray(12, 16).toString("latin1");
    if (kind === "VP8 " && b.readUInt8(23) === 0x9d && b.readUInt8(24) === 0x01 && b.readUInt8(25) === 0x2a) return { type: "webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L" && b.readUInt8(20) === 0x2f) { const v = b.readUInt32LE(21); return { type: "webp", width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
    if (kind === "VP8X") return { type: "webp", width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return null;
}

/**
 * Problèmes d'une déclaration `previews` (liste vide = valide). `dir` : le dossier du module ; s'il est donné, chaque fichier doit y exister, peser 150 Ko au plus,
 * être un vrai PNG/WebP du type de son extension et avoir des dimensions admises. Sans `dir`, seule la déclaration est vérifiée.
 */
export function previewProblems(previews, dir) {
  if (previews === undefined) return [];
  if (!Array.isArray(previews)) return ["previews doit être une liste."];
  const problems = [];
  if (previews.length > PREVIEW_LIMITS.max) problems.push(`previews : ${previews.length} visuels, ${PREVIEW_LIMITS.max} au plus.`);
  const seen = new Set();
  for (const [i, p] of previews.entries()) {
    const at = `previews[${i}]`;
    if (!p || typeof p !== "object") { problems.push(`${at} : doit être un objet { file, type, caption, alt }.`); continue; }
    if (typeof p.file !== "string" || !PREVIEW_FILE_RE.test(p.file)) { problems.push(`${at}.file : « ${p.file} » doit être previews/<nom>.webp ou .png (minuscules, chiffres, ., _, -).`); continue; }
    if (seen.has(p.file)) problems.push(`${at} : « ${p.file} » est déclaré deux fois.`);
    seen.add(p.file);
    if (!PREVIEW_TYPES.includes(p.type)) problems.push(`${at}.type : « ${p.type} » doit être public, admin ou overlay.`);
    for (const [key, max] of [["caption", PREVIEW_LIMITS.caption], ["alt", PREVIEW_LIMITS.alt]]) {
      const v = p[key];
      if (!v || typeof v !== "object" || Array.isArray(v)) { problems.push(`${at}.${key} : doit donner le texte en français ET en anglais.`); continue; }
      for (const lang of ["fr", "en"]) if (typeof v[lang] !== "string" || !v[lang].trim()) problems.push(`${at}.${key}.${lang} : texte obligatoire${key === "alt" ? " (texte alternatif pour les lecteurs d'écran)" : ""}.`);
      for (const [lang, text] of Object.entries(v)) {
        if (!LOCALE_RE.test(lang)) problems.push(`${at}.${key} : langue « ${lang} » invalide.`);
        else if (typeof text === "string" && text.trim().length > max) problems.push(`${at}.${key}.${lang} : ${text.trim().length} caractères, ${max} au plus.`);
      }
    }
    if (!dir) continue;
    const file = path.join(dir, p.file);
    let st;
    try { st = fs.lstatSync(file); } catch { problems.push(`${at}.file : « ${p.file} » n'existe pas dans le module.`); continue; }
    if (!st.isFile()) { problems.push(`${at}.file : « ${p.file} » n'est pas un fichier.`); continue; }
    if (st.size > PREVIEW_LIMITS.bytes) { problems.push(`${p.file} : ${Math.round(st.size / 1024)} Ko, ${PREVIEW_LIMITS.bytes / 1024} Ko au plus.`); continue; }
    const info = sniffImage(fs.readFileSync(file));
    if (!info) { problems.push(`${p.file} : ce n'est ni un PNG ni un WebP lisible.`); continue; }
    if (!p.file.endsWith(`.${info.type}`)) problems.push(`${p.file} : l'extension annonce un autre type que le contenu (${info.type}).`);
    const { width: w, height: h } = info;
    if (w < PREVIEW_LIMITS.minSide || h < PREVIEW_LIMITS.minSide || w > PREVIEW_LIMITS.maxSide || h > PREVIEW_LIMITS.maxSide) problems.push(`${p.file} : ${w}×${h} px, entre ${PREVIEW_LIMITS.minSide} et ${PREVIEW_LIMITS.maxSide} px attendus.`);
    else if (w * h > PREVIEW_LIMITS.maxPixels) problems.push(`${p.file} : ${w}×${h} px, ${PREVIEW_LIMITS.maxPixels} pixels au plus.`);
  }
  return problems;
}

/** Ce que l'index du catalogue recopie de `previews` : la déclaration seulement (file, type, caption, alt), dans l'ordre d'affichage, jamais les images. */
export const previewIndex = (previews) => (Array.isArray(previews) ? previews.map((p) => ({ file: p.file, type: p.type, caption: p.caption, alt: p.alt })) : []);
