// Écriture neutre — test de non-régression.
// Aucun texte lu par une personne (manifestes, textes FR/EN, textes écrits dans le code, README, index du Catalogue, documents pour les auteurs,
// module de départ et exemples) ne doit supposer le genre de la personne qui utilise le site ni celui de son public.
// Exemples à ne pas écrire : « créatrices », « clientes », « visiteurs », « le propriétaire », « quelqu'un », « connecté(e) », « she », « his ».
// À écrire à la place : « personne qui crée », « personnes qui commandent », « public », « personne propriétaire », « une personne », « session ouverte », « they ».
//
// Ce que le test lit : les VALEURS des fichiers .json (pas les clés), les .md, et le code .mjs / .js sans ses commentaires (les commentaires
// ne sont pas lus par le public). Ce qu'il ne lit pas : tests/, CHANGELOG.md (l'historique n'est jamais réécrit), docs/ideas/ (notes de conception),
// docs/changelog-parts/ (brouillons de CHANGELOG, qui citent forcément les anciens mots) et le moteur 3D maze-overlay/web/engine.js.
//
// POUR AJOUTER UN TERME : une ligne dans FORBIDDEN (nom court, expression, pourquoi).
// POUR AUTORISER UN CAS : une ligne dans ALLOWED, avec le fichier, le terme et une VRAIE raison. Une entrée devenue inutile fait échouer le test
// (comme la liste blanche de tests/hot-update-all.test.mjs) : la liste ne grossit pas en silence.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

/* ───────────────────────── Termes qui supposent un genre (modifiable) ───────────────────────── */
const W = (s) => `(?<![\\p{L}\\p{N}_])(?:${s})(?![\\p{L}\\p{N}_])`;   // « mot entier » avec lettres accentuées
export const FORBIDDEN = [
  // Noms de personnes au féminin ou au masculin « par défaut »
  ["créateur·rice", W("cr[ée]at(?:eur|rice)s?"), "dire « la personne qui crée », « les artistes », « la création »"],
  ["client·e", W("clientes?|(?:vos|tes|nos|les|aux|des|chaque)\\s+clients?"), "dire « la personne qui commande », « la clientèle »"],
  ["vendeur·se", W("vendeu(?:r|se)s?"), "dire « la personne qui vend »"],
  ["streameur·se", W("streameu(?:r|se)s?"), "dire « la chaîne », « la personne qui diffuse » (« streamer » seul est épicène)"],
  ["utilisateur·rice", `(?<![{\\p{L}\\p{N}_])${"utilisat(?:eur|rice)s?"}(?![}\\p{L}\\p{N}_:])`, "dire « la personne », « le compte », « l'identifiant »"],
  ["visiteur·se", W("visiteu(?:r|se)s?"), "dire « le public », « la personne qui visite »"],
  ["spectateur·rice", W("spectat(?:eur|rice)s?|téléspectat(?:eur|rice)s?"), "dire « le public », « l'audience », « les personnes qui regardent »"],
  ["abonné·e", W("(?<!personnes? )abonn[ée]e?s?"), "dire « followers », « abonnements », « les personnes abonnées »"],
  ["inscrit·e", W("(?:les|des|aux|vos|nos|ces|tous les)\\s+inscrits|(?:un|le|mon|ton|son)\\s+inscrit"), "dire « inscription », « les personnes inscrites »"],
  ["joueur·se", W("joueu(?:r|se)s?"), "dire « pseudo », « les personnes qui jouent »"],
  ["lecteur·rice (personne)", W("lectrices?"), "« lecteur » (appareil, vidéo) reste permis ; « lectrice » désigne une personne"],
  ["modérateur·rice", W("modérat(?:eur|rice)s?"), "dire « l'équipe de modération », « les personnes qui modèrent »"],
  ["intervenant·e", W("intervenant(?:e)?s?"), "dire « personnes invitées »"],
  ["participant·e", W("participant(?:e)?s?"), "dire « personnes qui participent » (en anglais « participants » est neutre)", "fr"],
  ["organisateur·rice", W("organisat(?:eur|rice)s?"), "dire « équipe d'organisation »"],
  ["ami·e", W("(?:l['’]\\s*|(?:un|une|mon|ma|ton|ta|son|sa|nos|vos|des|les|ses|tes|mes)\\s+)amie?s?"), "dire « personne amie », « proche », « contact »"],
  ["gagnant·e", W("(?<!choix )gagnante?s?"), "dire « choix gagnant » (un choix de vote) ; pour une personne : « personne gagnante »"],
  ["vainqueur", W("vainqueurs?"), "dire « choix gagnant »"],
  ["auteur·rice", W("auteurs?|autrices?"), "dire « la personne qui a écrit »"],
  ["donateur·rice", W("donat(?:eur|rice)s?"), "dire « les personnes qui donnent »"],
  ["acheteur·se", W("acheteu(?:r|se)s?"), "dire « la personne qui achète »"],
  ["illustrateur·rice", W("illustrat(?:eur|rice)s?"), "dire « illustration »"],
  ["propriétaire + article genré", W("(?:le|la|au|du|cette|un|une|sa|son)\\s+propriétaire"), "dire « la personne propriétaire » ; « Propriétaire » seul reste le nom du rôle"],
  ["quelqu'un", W("quelqu['’]un"), "dire « une personne »"],
  ["doublets lourds", W("celles et ceux|ceux et celles|toutes et tous|tous et toutes|toutes et à tous|elles et eux|ils et elles|elles ou eux"), "préférer un nom collectif (« tout le monde », « le public »)"],
  // Écriture typographique et marques de genre entre parenthèses : le propriétaire veut un français simple, sans point médian
  ["point médian", "[\\p{L}]·[\\p{L}]", "pas de point médian : reformuler"],
  ["(e) entre parenthèses", "(?<=[éèiuntlrsfcdv])\\((?:e|es|ne|le|ve|trice|rice|euse|ère|se)\\)(?![\\p{L}])", "reformuler (« session ouverte », « inscription »…)", "fr", true],
  // Accords sur la personne qui lit
  ["« vous seul(e) »", W("vous\\s+seule?|pour\\s+vous\\s+seule?"), "dire « vous uniquement », « la seule personne à… »"],
  ["« vous êtes + adjectif accordé »", `${"(?<![\\p{L}\\p{N}_])vous\\s+(?:vous\\s+)?(?:êtes|étiez|serez)\\s+(?:\\p{L}+\\s+){0,2}"}(?:prêt|prête|connecté|connectée|inscrit|inscrite|invité|invitée|seul|seule|sûr|sûre|content|contente|désolé|désolée|ravi|ravie|affilié|affiliée|nombreux|nombreuses)(?![\\p{L}\\p{N}_])(?!\\s+personne)`, "reformuler sans adjectif accordé"],
  ["« vous vous êtes + participe »", `(?<![\\p{L}\\p{N}_])vous\\s+vous\\s+êtes\\s+\\p{L}+(?![\\p{L}\\p{N}_])`, "reformuler (« la connexion s'est faite avec… »)"],
  ["salutation genrée", W("chère?s?|madame|monsieur|mesdames|messieurs|mme|mlle"), "dire « Bonjour », « Bonjour {nom} »"],
  // Anglais
  ["he/she/his/her", W("he|she|hers?|his|him|himself|herself|he/she|s/he"), "écrire « they / their » ou reformuler"],
  ["mots anglais genrés", W("chairman|chairwoman|spokesman|spokeswoman|businessman|salesman|mankind|manpower|waitress|actress|policeman|fireman|stewardess|ladies|gentlemen"), "écrire « chair », « spokesperson », « people »…"],
  // Emojis de personnes au genre marqué (🧑 et 👤 restent permis)
  ["emoji de personne genré", "[👩👨👧👦🧔👱🤵👰🙋💁🙆🙅🤷🧙🧚🧛🧜🧝🧞]", "préférer 🧑, 👤 ou un objet"],
].map(([name, re, fix, lang = "any", textOnly = false]) => ({ name, re: new RegExp(re, "giu"), fix, lang, textOnly }));   // lang "fr" : textes français seulement ; textOnly : pas dans le code (où « f(e) » est un appel de fonction)

/* ───────────────────────── Liste blanche, avec la raison de chaque entrée ───────────────────────── */
// file : début du chemin (ou chemin exact) ; term : nom court de FORBIDDEN ; text (facultatif) : le mot exact autorisé, en minuscules.
export const ALLOWED = [
  { file: "modules/audience/lib.mjs", term: "streameur·se", text: "streameuse",
    why: "liste de pseudos RÉSERVÉS (« streamer », « streameuse »…) : pour empêcher de se faire passer pour l'équipe, il faut bloquer les deux formes. Ce n'est pas un texte lu." },
  { file: "modules/audience/module.json", term: "streameur·se", text: "streameuse",
    why: "valeur par défaut de la liste de mots interdits dans les pseudos : « streameuse » doit être bloqué comme « streamer »." },
  { file: "modules/twitch-bot/variables.mjs", term: "utilisateur·rice", text: "utilisateur",
    why: "nom de la variable de gabarit {utilisateur}, citée comme chaîne dans la liste des variables permises : les commandes déjà enregistrées par les sites l'utilisent, la renommer les casserait." },
  { file: "modules/audience/client.mjs", term: "participant·e", text: "participant",
    why: "propriété `participant` de la réponse JSON de la route, lue par le script envoyé au navigateur : nom technique d'un contrat, pas un texte lu." },
  { file: "modules/daily-game/packs.mjs", term: "joueur·se", text: "joueur",
    why: "développement officiel des sigles du jeu vidéo : PNJ = « personnage non joueur », PvP = « joueur contre joueur ». Ce sont des termes de métier, pas des personnes." },
  { file: "modules/events/csv.mjs", term: "intervenant·e", text: "intervenant",
    why: "noms de colonnes ACCEPTÉS à l'import d'un fichier (ceux que des sites ont déjà dans leurs fichiers) : on lit « intervenants », on n'écrit plus ce mot." },
  { file: "modules/events/csv.mjs", term: "intervenant·e", text: "intervenants",
    why: "même liste de noms de colonnes acceptés à l'import." },
  { file: "modules/polls/locales/fr.json", term: "gagnant·e", text: "gagnant",
    why: "badge « Gagnant » à côté du choix qui l'emporte dans un vote : il désigne un CHOIX, jamais une personne." },
  { file: "modules/polls/README.md", term: "gagnant·e", text: "gagnant",
    why: "même badge « Gagnant » (un choix de vote), cité dans la description de l'accessibilité." },
  { file: "modules/twitch-raid/locales/fr.json", term: "spectateur·rice", text: "spectateur",
    why: "texte du DOCK (« {n} spectateur ») figé par les empreintes de la 2.1 (tests/helpers/twitch-raid-golden.mjs, « le dock n'a pas bougé ») : à reprendre dans un lot qui régénère ces empreintes." },
  { file: "modules/twitch-raid/locales/fr.json", term: "spectateur·rice", text: "spectateurs",
    why: "textes du DOCK (« Plus / Moins de spectateurs », « {n} spectateurs ») figés par les empreintes de la 2.1 : voir l'entrée précédente." },
  { file: "modules/twitch-raid/locales/fr.json", term: "streameur·se", text: "streameur",
    why: "libellé du bouton « Trouver un streameur en ligne au hasard » du DOCK, figé par les empreintes de la 2.1 ; les textes d'administration qui citent ce bouton doivent l'écrire à l'identique." },
  { file: "modules/twitch-raid/README.md", term: "streameur·se", text: "streameur",
    why: "cite le libellé exact du bouton du dock (voir l'entrée précédente)." },
  { file: "modules/twitch-raid/locales/fr.json", term: "« vous êtes + adjectif accordé »", text: "vous êtes nombreux",
    why: "phrase d'introduction du bouton « au hasard » du DOCK, figée par les empreintes de la 2.1 (voir plus haut). À reformuler (« Votre liste est longue ! ») dans le lot qui régénère les empreintes." },
  { file: "modules/legal-pages/locales/fr.json", term: "auteur·rice", text: "auteur",
    why: "« droit d'auteur » : expression juridique figée (copyright), sans équivalent courant." },
];

/* ───────────────────────── Lecture des textes ───────────────────────── */
const SKIP_DIRS = new Set(["node_modules", ".git", "tests", "ideas", "changelog-parts"]);
const SKIP_FILES = new Set(["CHANGELOG.md", "package-lock.json", "modules/maze-overlay/web/engine.js"]);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

// Seuls ces dossiers et fichiers sont lus (la CI clone le cœur dans ./core : il ne fait pas partie de ce dépôt).
const ROOTS = ["modules", "examples", "starter", "docs", "catalogue", "README.md", "package.json"];
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(json|md|mjs|js|html|txt|yml)$/.test(e.name) && !SKIP_FILES.has(rel(p))) out.push(p);
  }
  return out;
}
const allFiles = () => ROOTS.flatMap((r) => { const p = path.join(ROOT, r); return !fs.existsSync(p) ? [] : fs.statSync(p).isDirectory() ? walk(p) : [p]; });

/** Valeurs texte d'un JSON (les clés sont des identifiants, pas des textes) avec leur langue : « fr » / « en » d'après la clé ou le nom du fichier, sinon « ? ». */
function jsonValues(value, lang, out = []) {
  if (typeof value === "string") out.push({ text: value, lang });
  else if (Array.isArray(value)) value.forEach((v) => jsonValues(v, lang, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) jsonValues(v, k === "fr" || k === "en" ? k : lang, out);
  return out;
}

/**
 * Textes écrits dans le code : le CONTENU des chaînes ('…', "…", `…`) et rien d'autre. Les commentaires, les noms de variables et de propriétés
 * ne sont pas lus par le public. On suit les chaînes pour ne pas prendre le « // » d'une adresse https:// pour un commentaire.
 */
function startsRegex(src, i) {   // un « / » ouvre une expression régulière s'il suit un opérateur, une parenthèse ouvrante ou un mot comme return
  let k = i - 1;
  while (k >= 0 && /\s/.test(src[k])) k--;
  if (k < 0) return true;
  if ("(,=:;!&|?{}[+-*%<>~^".includes(src[k])) return true;
  return /(?:^|[^\p{L}\p{N}_$])(?:return|typeof|case|in|of|else|do|void|yield|await)$/u.test(src.slice(Math.max(0, k - 8), k + 1));
}

export function stringsOf(src) {
  const out = [];
  const n = src.length;
  // scan(i, inExpr) lit du code à partir de i ; dans un ${ … } (inExpr), s'arrête à l'accolade fermante qui le ferme et renvoie sa position.
  const scan = (i, inExpr) => {
    let depth = 0;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === "/" && d === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
      if (c === "`") { i = template(i + 1); continue; }
      if (c === '"' || c === "'") {
        let s = ""; i++;
        while (i < n && src[i] !== c && src[i] !== "\n") { if (src[i] === "\\") { s += src[i + 1] ?? ""; i += 2; continue; } s += src[i++]; }
        i++; out.push(s); continue;
      }
      if (c === "/" && startsRegex(src, i)) {   // expression régulière : on la saute, ses guillemets ne sont pas des chaînes
        let j = i + 1, inClass = false;
        while (j < n && src[j] !== "\n") { if (src[j] === "\\") j++; else if (src[j] === "[") inClass = true; else if (src[j] === "]") inClass = false; else if (src[j] === "/" && !inClass) break; j++; }
        if (src[j] === "/") { i = j + 1; continue; }
      }
      if (inExpr) { if (c === "{") depth++; else if (c === "}") { if (depth === 0) return i; depth--; } }
      i++;
    }
    return i;
  };
  // template(i) : i est juste après la « ` » ouvrante ; renvoie la position après la « ` » fermante ; le texte fixe est ajouté à out.
  const template = (i) => {
    let s = "";
    while (i < n && src[i] !== "`") {
      if (src[i] === "\\") { s += src[i + 1] ?? ""; i += 2; continue; }
      if (src[i] === "$" && src[i + 1] === "{") { i = scan(i + 2, true) + 1; s += " "; continue; }
      s += src[i++];
    }
    out.push(s);
    return i + 1;
  };
  scan(0, false);
  return out;
}

function textsOf(file) {
  const raw = fs.readFileSync(file, "utf8");
  if (file.endsWith(".json")) {
    const lang = /(^|\/)fr\.json$/.test(file) ? "fr" : /(^|\/)en\.json$/.test(file) || /(^|\/)module\.json$/.test(file) ? "en" : "?";   // module.json : ce qui n'est pas sous une clé « fr » est en anglais (outils MCP…)
    try { return jsonValues(JSON.parse(raw), lang); } catch { return [{ text: raw, lang: "?" }]; }
  }
  if (file.endsWith(".mjs") || file.endsWith(".js")) return stringsOf(raw).map((text) => ({ text, lang: "?" }));
  return [{ text: raw, lang: "?" }];
}

const allowed = (file, term, text) => ALLOWED.find((a) => (file === a.file || file.startsWith(a.file)) && a.term === term && (!a.text || a.text === text.toLowerCase()));

const used = new Set();
function findings() {
  const out = [];
  for (const file of allFiles()) {
    const f = rel(file);
    for (const { text, lang } of textsOf(file)) {
      for (const rule of FORBIDDEN) {
        if (rule.lang === "fr" && lang === "en") continue;
        if (rule.textOnly && /\.(?:mjs|js)$/.test(f)) continue;
        rule.re.lastIndex = 0;
        for (const m of text.matchAll(rule.re)) {
          const ok = allowed(f, rule.name, m[0]);
          if (ok) { used.add(ok); continue; }
          const a = Math.max(0, m.index - 40), b = Math.min(text.length, m.index + m[0].length + 40);
          out.push(`${f} : « ${m[0]} » (${rule.name}) … ${text.slice(a, b).replace(/\s+/g, " ")} …  → ${rule.fix}`);
        }
      }
    }
  }
  return out;
}

/* ───────────────────────── Tests ───────────────────────── */
test("aucun texte visible ne suppose le genre de la personne qui utilise le site ni de son public", () => {
  const bad = findings();
  assert.equal(bad.length, 0, `\n${bad.slice(0, 40).join("\n")}${bad.length > 40 ? `\n… et ${bad.length - 40} autres` : ""}\n`);
});

test("la liste blanche ne garde rien d'inutile", () => {
  findings();
  const unused = ALLOWED.filter((a) => !used.has(a));
  assert.deepEqual(unused.map((a) => `${a.file} / ${a.term} / ${a.text ?? "*"}`), [], "retirez les entrées qui ne servent plus");
  for (const a of ALLOWED) assert.ok(a.why && a.why.length > 20, `une raison est obligatoire : ${a.file} / ${a.term}`);
});

test("le test sait reconnaître ce qu'il doit refuser (garde-fou du test lui-même)", () => {
  const hits = (s) => FORBIDDEN.filter((r) => { r.re.lastIndex = 0; return r.re.test(s); }).map((r) => r.name);
  assert.ok(hits("Une file de commandes claire pour les créatrices").includes("créateur·rice"));
  assert.ok(hits("un lien de suivi privé pour chaque cliente").includes("client·e"));
  assert.ok(hits("Demandez au propriétaire du site").includes("propriétaire + article genré"));
  assert.ok(hits("Vous n'êtes pas connecté·e").includes("point médian"));
  assert.ok(hits("Vous n'êtes pas connecté(e)").includes("(e) entre parenthèses"));
  assert.ok(hits("vous seule le pouvez").includes("« vous seul(e) »"));
  assert.ok(hits("Allumez la page quand vous êtes prête").includes("« vous êtes + adjectif accordé »"));
  assert.ok(hits("she gets a confirmation with her link").includes("he/she/his/her"));
  assert.ok(hits("les visiteurs voient").includes("visiteur·se"));
  // …et ce qu'il doit laisser passer
  assert.deepEqual(hits("Une file de commandes claire pour toute personne qui crée sur commande ; la personne propriétaire du site ; une personne ; they get their link"), []);
  assert.deepEqual(hits("Merci {utilisateur} ! Le lecteur vidéo, l'ID client Google, 3 photo(s) et le rôle Propriétaire."), []);
});

test("stringsOf lit le contenu des chaînes, pas les commentaires, ni les noms de variables", () => {
  const src = 'const visiteur = "https://x.test/a"; // les clientes\n/* le propriétaire */ const b = `les ${"ok"} gens`; const re = /clientes?/g; const o = { participant: 1 };\n';
  const out = stringsOf(src);
  assert.deepEqual(out.filter((s) => s !== "ok"), ["https://x.test/a", "les   gens"]);
  assert.ok(out.includes("ok"));
});
