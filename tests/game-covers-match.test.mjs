// Ressemblance de titres du module Jaquettes de jeux (port du service du cœur) : fonctions pures, aucune base ni réseau.
import test from "node:test";
import assert from "node:assert/strict";

const M = await import("../modules/game-covers/match.mjs");

test("titres identiques à la casse, aux accents, à la ponctuation, aux articles et aux chiffres romains près : score 1", () => {
  for (const [a, b] of [
    ["Hades", "HADES"], ["Pokémon Rouge", "Pokemon rouge"], ["The Witcher 3", "Witcher 3"], ["Portal 2", "Portal II"], ["Final Fantasy VII", "Final Fantasy 7"],
    ["Final Fantasy X", "Final Fantasy 10"], ["Grand Theft Auto V", "Grand Theft Auto 5"], ["God of War: Ragnarök", "God of War Ragnarok"], ["Mario & Luigi", "Mario and Luigi"],
    ["Baldur's Gate 3", "Baldurs Gate 3"], ["Doom (2016)", "DOOM"], ["  Hollow   Knight ", "hollow knight"], ["L'Ombre du Mordor", "Ombre du Mordor"], ["Cyberpunk 2077", "Cyberpunk 2077 (2020)"],
  ]) assert.equal(M.titleScore(a, b), 1, `${a} / ${b}`);
});

test("titres à chiffres : un autre numéro est un autre jeu (jamais « quasi identique »)", () => {
  for (const [a, b] of [["Portal", "Portal 2"], ["Hades", "Hades II"], ["Final Fantasy VII", "Final Fantasy VIII"], ["Resident Evil 4", "Resident Evil 2"], ["Cyberpunk 2077", "Cyberpunk 2078"]]) {
    assert.ok(M.titleScore(a, b) <= 0.6, `${a} / ${b} = ${M.titleScore(a, b)}`);
  }
});

test("sous-titres : un seul des deux a un sous-titre = proche mais pas identique ; deux sous-titres différents = autres jeux", () => {
  assert.equal(M.titleScore("Hollow Knight", "Hollow Knight: Silksong"), 0.9);
  assert.equal(M.titleScore("Hollow Knight: Silksong", "Hollow Knight"), 0.9);
  assert.equal(M.titleScore("Zelda: Breath of the Wild", "Zelda: Tears of the Kingdom"), 0.6);
  assert.equal(M.titleScore("God of War", "God of War - Ragnarök"), 0.9);
  assert.ok(M.titleScore("Hollow Knight", "Hollow Knight: Silksong") < M.NEAR_SCORE);
});

test("cas « Playrooms » : les autres jeux au nom voisin ne sont jamais « quasi identiques »", () => {
  for (const other of ["Astro's Playroom", "The Playroom", "Playroom Mania", "Playrooms of Fear", "Playroom"]) assert.ok(M.titleScore("Playrooms", other) < M.NEAR_SCORE, other);
  assert.equal(M.titleScore("Playrooms", "Playrooms"), 1);
});

test("scores bornés, symétriques pour les cas simples, et sans exception sur des entrées absurdes", () => {
  for (const [a, b] of [["", "x"], ["x", ""], ["!!!", "???"], ["a".repeat(5000), "a".repeat(5000)], ["😀", "😀"], [undefined, null]]) {
    const s = M.titleScore(a, b);
    assert.ok(Number.isFinite(s) && s >= 0 && s <= 1, `${String(a).slice(0, 5)} → ${s}`);
  }
  assert.equal(M.titleScore("", ""), 0);
  assert.equal(M.titleKey("!!!"), "");
  assert.equal(M.titleKey("The Witcher III: Wild Hunt"), "witcher 3 wild hunt");
  assert.ok(M.titleKey("a ".repeat(500)).length <= 120);
  const t0 = Date.now();
  M.titleScore("x ".repeat(2500), "y ".repeat(2500));
  assert.ok(Date.now() - t0 < 500, "la comparaison reste bornée (longueur × longueur plafonnée)");
});

test("rank : du plus ressemblant au moins ressemblant, l'ordre de RAWG est gardé à égalité", () => {
  const r = M.rank("Hades", [{ name: "Hades II" }, { name: "Hades: Battle out of Hell" }, { name: "Hades" }, { name: "HADES" }]);
  assert.deepEqual(r.map((c) => c.name), ["Hades", "HADES", "Hades: Battle out of Hell", "Hades II"]);
});

test("isAmbiguous : (a) meilleur pas quasi identique, (b) un second à égalité avec une autre image ; sinon sûr", () => {
  const c = (score, image) => ({ score, image });
  assert.equal(M.isAmbiguous([]), false);
  assert.equal(M.isAmbiguous([c(1, "a")]), false);
  assert.equal(M.isAmbiguous([c(1, "a"), c(0.6, "b")]), false, "un exact et un autre bien plus loin");
  assert.equal(M.isAmbiguous([c(0.9, "a")]), true, "(a) pas quasi identique");
  assert.equal(M.isAmbiguous([c(1, "a"), c(1, "b")]), true, "(b) deux exacts, deux images");
  assert.equal(M.isAmbiguous([c(1, "a"), c(0.97, "b")]), true, "(b) écart de 0,03");
  assert.equal(M.isAmbiguous([c(1, "a"), c(1, "a")]), false, "même image : pas un autre choix");
  assert.equal(M.isAmbiguous([c(1, "a"), c(1, null)]), false, "un second sans image n'est pas un choix");
});
