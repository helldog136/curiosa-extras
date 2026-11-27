// Non-régression de Suggestions de jeux et du Mur des remerciements à l'arrivée de leurs éléments d'overlay (cœur 0.5.0) : pages publiques, administration, outils MCP, vote, suggestion, réglages,
// tâches et manifeste (hors version, minCore, clé overlayElements et droit « routes ») identiques, OCTET POUR OCTET, à ceux du dépôt 1.26.0 (commit 363a6e5).
// Les fichiers tests/golden/game-suggestions-1.5.1.json et thanks-wall-1.0.2.json ont été produits avec 363a6e5, avant toute modification des modules.
import test, { after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gamesSnapshot, thanksSnapshot, NOW, fingerprint } from "./helpers/overlayNonRegWave2.mjs";
import { reset, restore } from "./helpers/thanks-wall-world.mjs";

mock.timers.enable({ apis: ["Date"], now: NOW });
after(() => { mock.timers.reset(); restore(); });
const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, "..");
const golden = (f) => JSON.parse(fs.readFileSync(path.join(here, "golden", f), "utf8"));

test("Suggestions de jeux : page publique (tous les statuts), administration, MCP, vote, suggestion, tâches et manifeste identiques à la 1.5.1", async () => {
  const before = golden("game-suggestions-1.5.1.json"), now = await gamesSnapshot(ROOT);
  // Suggestions de jeux 1.7.0 (administration refaite) : le manifeste ne change que par version, minCore, overlayElements, description et textes d'aide des deux réglages de la page ;
  // la phrase de remerciement perd son point d'exclamation (règle R13) ; l'administration est un autre écran (voir game-suggestions-add.test.mjs). Tout le reste est identique.
  const rest = (m) => { const { description, settings, dashboard, offers, ...r } = m;   // 1.9.0 : `offers` (service game.played)
   return { ...r, settings: settings.map((x) => x.key) }; };
  assert.deepEqual(rest(now.manifest), rest(before.manifest), "le manifeste n'a changé que par version, minCore, overlayElements, description et textes des réglages");
  assert.deepEqual(now.top.filter((k) => k !== "dashboard" && k !== "services"), before.top);   // « services » : game.played, 1.9.0
   assert.deepEqual(now.routes, before.routes, "aucune route ajoutée à part celle de l'élément"); assert.deepEqual(now.tasks, before.tasks);
  const thanks = (v) => JSON.parse(JSON.stringify(v).replaceAll("Merci ! Votre suggestion", "Merci. Votre suggestion"));
  for (const k of Object.keys(before.pages)) assert.deepEqual(now.pages[k], thanks(before.pages[k]), `page « ${k} »`);
  assert.deepEqual(now.pageEmpty, thanks(before.pageEmpty));
  for (const k of ["mcpList", "mcpListPlanned", "voteOk", "voteRefused", "suggest"]) assert.deepEqual(now[k], before[k], k);
  assert.deepEqual(now.admin.map((b) => b.type).filter((t) => t === "table").length, 1, "l'administration affiche toujours un tableau");
  assert.equal(fingerprint(thanks(now.pages)), fingerprint(thanks(before.pages)), "empreinte des pages publiques");
  assert.ok(Object.keys(before.pages).length >= 9 && JSON.stringify(before.pages.all).includes("Hollow Knight"), "les empreintes couvrent de vraies pages");
});

test("Mur des remerciements : page publique (mur, groupes, pages, mise à l'honneur, petits mots), administration, état MCP et mur sans Contacts identiques à la 1.0.2", async () => {
  reset();
  const before = golden("thanks-wall-1.0.2.json"), now = await thanksSnapshot(ROOT);
  // La description du catalogue a été raccourcie et simplifiée (mode simple, R9) : elle ne fait plus partie de ce qui doit rester identique.
  // 1.5.0: the minimum core moved (live search of the message list, 0.38.0) and rare settings are folded (`rare`): neither changes what the wall renders.
  const noDescription = (m) => { const { description, minCore, ...rest } = m; return { ...rest, settings: (rest.settings ?? []).map(({ rare, ...x }) => x) }; };
  // 1.5.1 (tone rules R10, R11, R13, text only): the exact texts that were rewritten are mapped here, so the golden stays pinned for everything else.
  // The five titles of the extra groups gained a short help (an example); the rewritten texts of the page are listed below.
  const REWRITTEN = [
    ["(une catégorie de Contacts)", "(catégorie Contacts)"],
    ["A person who asks not to appear: put their card in this Contacts category and they disappear from the wall within two minutes. Left empty, a category named “Do not show” (or “Ne pas montrer”) is used if it exists.", "Cards in this Contacts category leave the wall within two minutes. Left empty, a category named “Do not show” or “Ne pas montrer” is used."],
    ["Une personne qui demande à ne pas apparaître : rangez sa fiche dans cette catégorie de Contacts et elle disparaît du mur en moins de deux minutes. Laissé vide, une catégorie qui s'appelle « Ne pas montrer » (ou « Do not show ») est utilisée si elle existe.", "Les fiches de cette catégorie de Contacts quittent le mur en moins de deux minutes. Laissé vide, la catégorie « Ne pas montrer » ou « Do not show » est utilisée."],
    ["Left empty, the page is titled “Thank you!”.", "Left empty, the page is titled “Thank you”."],
    ["Laissé vide, la page s'appelle « Merci ! ».", "Laissé vide, la page s'appelle « Merci »."],
    ["— Merci !", "— Merci"], ["— Thank you!", "— Thank you"], [">Merci !<", ">Merci<"], [">Thank you!<", ">Thank you<"], ["Un grand merci !", "Un grand merci."], ["A big thank you!", "A big thank you."],
    ["\"title\":\"Merci !\"", "\"title\":\"Merci\""], ["\"title\":\"Thank you!\"", "\"title\":\"Thank you\""],
  ];
  const rewritten = (v) => REWRITTEN.reduce((j, [a, b]) => j.replaceAll(a, b), JSON.stringify(v));
  const withoutNewHelp = (m) => { const o = noDescription(m); return { ...o, settings: o.settings.map((x) => { if (/^groupTitle[2-6]$/.test(x.key)) { const { help, ...y } = x; return y; } return x; }) }; };
  assert.deepEqual(JSON.parse(JSON.stringify(withoutNewHelp(now.manifest))), JSON.parse(rewritten(noDescription(before.manifest))), "le manifeste n'a changé que par version, minCore, overlayElements, description, le droit « routes » et les textes réécrits (REWRITTEN)");
  assert.deepEqual(now.manifest.settings.filter((x) => /^groupTitle[2-6]$/.test(x.key)).every((x) => x.help?.en && x.help?.fr), true, "the five extra group titles carry an example");
  assert.deepEqual(now.top, before.top); assert.deepEqual(now.routes, before.routes, "aucune page publique ajoutée : seule la route de l'élément est nouvelle");
  for (const k of Object.keys(before.pages)) assert.deepEqual(JSON.parse(JSON.stringify(now.pages[k])), JSON.parse(rewritten(before.pages[k])), `page « ${k} »`);
  for (const k of ["mcpStatus", "mcpPeople", "noBook"]) assert.deepEqual(JSON.parse(JSON.stringify(now[k])), JSON.parse(rewritten(before[k])), k);
  assert.equal(now.admin.filter((b) => b.type === "table").length, before.admin.filter((b) => b.type === "table").length, "the administration shows the same tables (the list now carries its live search)");
  assert.equal(fingerprint(now.pages), fingerprint(JSON.parse(rewritten(before.pages))), "empreinte des pages publiques");
  const wall = JSON.stringify(before.pages.wall);
  assert.ok(wall.includes("Toujours là, merci") && /À l(?:'|&#39;)honneur/.test(wall), "les empreintes couvrent le petit mot et la mise à l'honneur");
});
