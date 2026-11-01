// Aucun libellé visible d'un module ne parle d'« ancien réglage » (contrat 10, 0.2.0) : ce qui sert à une reprise va dans `legacySettings`,
// jamais affiché. Et chaque réglage déclaré est lu par le code du module (sinon c'est un champ mort à retirer ou à passer en `legacySettings`).
// COPIE (adaptée) du test du cœur 0.2.0 (tests/core/legacy-labels.test.mjs) : ici il lit CE dépôt par défaut (CURIOSA_EXTRAS_DIR le remplace). Garder les règles
// (FORBIDDEN, visibleStrings) identiques à celles du cœur ; seule la liste blanche ci-dessous est propre à ce dépôt (plus aucune liste temporaire : Partenariats 2.0 n'a plus de libellé hérité).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const here = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const candidates = [process.env.CURIOSA_EXTRAS_DIR, here].filter(Boolean);
const root = candidates.find((d) => fs.existsSync(path.join(d, "modules")));
const skip = root ? false : "dépôt de modules absent (CURIOSA_EXTRAS_DIR) : rien à vérifier";

/** Mots interdits dans un libellé ou une aide visible (français et anglais). Mot entier : « anciens chiffres » (pluriel, au sens « plus vieux ») reste permis. */
export const FORBIDDEN = [
  { id: "ancien", re: /(?<!\p{L})ancien(?:ne)?(?!\p{L})/iu },
  { id: "anciennes versions", re: /anciennes versions/iu },
  { id: "reprise automatiquement", re: /repris(?:e|es)? automatiquement/iu },
  { id: "legacy", re: /(?<!\p{L})legacy/iu },
  { id: "old version", re: /(?<!\p{L})old(?:er)? versions?(?!\p{L})/iu },
  { id: "old setting", re: /(?<!\p{L})old settings?(?!\p{L})/iu },
  { id: "taken over automatically", re: /(?:taken|carried) over automatically/iu },
];

/**
 * LISTE BLANCHE EXPLICITE : (module, fichier, clé ou chemin, mot) — un sens courant (« le chiffre devient ancien », « éléments plus anciens »),
 * pas un réglage hérité. Toute autre occurrence fait échouer le test.
 */
export const ALLOWED = [
  { module: "community-stats", file: "locales/fr.json", key: "manualHelp", term: "ancien" },
  { module: "discord-announcer", file: "module.json", key: "*", term: "ancien" },
];

const VISIBLE_KEYS = new Set(["name", "label", "help", "description", "reason", "title", "summary", "body"]);

/** Les textes visibles d'un manifeste : `[chemin, texte]`. Hors `legacySettings` (jamais affiché) et `mcp` (destiné aux assistants). */
export function visibleStrings(node, at = "") {
  const out = [];
  const walk = (v, p, visible) => {
    if (typeof v === "string") { if (visible) out.push([p, v]); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`, visible)); return; }
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (!p && (k === "legacySettings" || k === "mcp")) continue;
      walk(x, p ? `${p}.${k}` : k, visible || VISIBLE_KEYS.has(k));
    }
  };
  walk(node, at, false);
  return out;
}

export function violations(module, file, entries) {
  const out = [];
  for (const [key, text] of entries) {
    for (const f of FORBIDDEN) {
      if (!f.re.test(text)) continue;
      const ok = ALLOWED.some((a) => a.module === module && a.file === file && (a.key === "*" || a.key === key) && a.term === f.id);
      if (!ok) out.push(`${module}/${file} ${key} : « ${f.id} » dans « ${text.slice(0, 80)} »`);
    }
  }
  return out;
}

test("règles : mots entiers, français et anglais, liste blanche par module/fichier/clé", () => {
  assert.equal(violations("x", "module.json", [["settings[0].label", "Chaîne Twitch (ancien réglage)"]]).length, 1);
  assert.equal(violations("x", "module.json", [["a", "Ancienne adresse du calendrier (reprise automatiquement)"]]).length, 2);
  assert.equal(violations("x", "locales/en.json", [["a", "Client secret (legacy)"], ["b", "Older versions of Curiosa only"]]).length, 2);
  assert.deepEqual(violations("x", "locales/fr.json", [["a", "les anciens chiffres sont effacés"], ["b", "les streams les plus anciens"]]), []);
  assert.deepEqual(violations("community-stats", "locales/fr.json", [["manualHelp", "quand le chiffre devient ancien"]]), []);
  assert.equal(violations("community-stats", "locales/fr.json", [["autre", "quand le chiffre devient ancien"]]).length, 1, "la liste blanche vise une clé précise");
  const strings = visibleStrings({ name: "N", version: "1", settings: [{ key: "k", label: { fr: "L" }, help: "H", default: "ancien" }], legacySettings: [{ key: "ancien" }], mcp: [{ description: "legacy" }] });
  assert.deepEqual(strings.map(([p]) => p), ["name", "settings[0].label.fr", "settings[0].help"]);
});

test("plus aucune liste blanche temporaire : un module qui parle d'« ancien » ou de « legacy » dans un libellé fait échouer le test (Partenariats compris)", () => {
  assert.equal(violations("partnerships", "locales/fr.json", [["x", "Revenir à l'ancien carnet"]]).length, 1);
  assert.equal(violations("partnerships", "locales/en.json", [["x", "Revert to the legacy address book"]]).length, 1);
  assert.equal(violations("planning", "locales/fr.json", [["x", "l'ancien site"]]).length, 1, "un autre module reste contrôlé");
  assert.ok(ALLOWED.every((a) => a.module !== "partnerships"), "aucune entrée pour Partenariats");
});

const modules = root ? fs.readdirSync(path.join(root, "modules")).filter((id) => fs.existsSync(path.join(root, "modules", id, "module.json"))).sort() : [];
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const walkFiles = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === "node_modules" || e.name === ".git" ? [] : e.isDirectory() ? walkFiles(path.join(d, e.name)) : [path.join(d, e.name)]));

test("dépôt de modules : aucun libellé ni aide visible ne dit « ancien », « legacy », « reprise automatiquement »…", { skip }, () => {
  const found = [];
  for (const id of modules) {
    const dir = path.join(root, "modules", id);
    found.push(...violations(id, "module.json", visibleStrings(readJson(path.join(dir, "module.json")))));
    const locales = path.join(dir, "locales");
    if (!fs.existsSync(locales)) continue;
    for (const f of fs.readdirSync(locales).filter((x) => x.endsWith(".json")).sort()) {
      const dict = readJson(path.join(locales, f));
      found.push(...violations(id, `locales/${f}`, Object.entries(dict).filter(([, v]) => typeof v === "string")));
    }
  }
  assert.deepEqual(found, [], `Libellés à revoir (passer le réglage en legacySettings, ou reformuler) :\n${found.join("\n")}`);
});

test("dépôt de modules : chaque clé de `settings` est lue par le code du module", { skip }, () => {
  const unread = [];
  for (const id of modules) {
    const dir = path.join(root, "modules", id);
    const manifest = readJson(path.join(dir, "module.json"));
    const code = walkFiles(dir).filter((f) => /\.(m?js|cjs|tsx?)$/.test(f) && !/(^|[\\/])tests?[\\/]/.test(path.relative(dir, f)) && !/\.test\./.test(f)).map((f) => fs.readFileSync(f, "utf8")).join("\n");
    // `shortLink` (cœur après 0.6.3) : ces réglages sont lus par le cœur, qui crée l'adresse courte pour le module ; le code du module n'a rien à en faire.
    const readByCore = new Set([manifest.shortLink?.enabled, manifest.shortLink?.name, manifest.shortLink?.target?.setting].filter(Boolean));
    for (const s of manifest.settings ?? []) if (!readByCore.has(s.key) && !new RegExp(`["'\`.]${s.key}\\b`).test(code)) unread.push(`${id} : ${s.key}`);
  }
  assert.deepEqual(unread, [], `Réglages déclarés mais jamais lus (à retirer, ou à passer en legacySettings) :\n${unread.join("\n")}`);
});
