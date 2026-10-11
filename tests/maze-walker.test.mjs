// Le marcheur du labyrinthe ne doit jamais se figer (retour du propriétaire : « le marcheur s'arrête à un moment »).
// Le moteur (web/engine.js) tourne ici sous node, sans navigateur : faux canvas, horloge simulée (voir maze-sim.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { gridFromAscii, walk, makeEngine, setClock, restoreClock } from "./maze-sim.mjs";

const { generateMaze } = await import("../modules/maze-overlay/web/generate.js");
const { configureRandom, random } = await import("../modules/maze-overlay/web/random.js");
const { MazeEngine } = await import("../modules/maze-overlay/web/engine.js");
test.after(restoreClock);

// Tracé personnalisé du propriétaire (23×23), transcrit de la capture de l'éditeur : # mur, . chemin, A affiche, P portail.
const OWNER = [
  "#A#A################A##", "#.......#...A.........#", "A.###...P...#.#A#.###.#", "A.A.#...#...A.#...A...A",
  "#.#.#.#A#.###.#...#...#", "A.A...A...A...#.......A", "#.A#A.A.A.#.###...#...#", "A...#...#.#.......A...#",
  "###.##.######.#A#.#.###", "#...A.........A...A...A", "#.#.A.#AA....#A..##AA.#", "#.#.....A.............#",
  "A.A.A.#.A####.#AA##.#.A", "A.....#...#..A....#.#.#", "A.###.#...A..##.#A#.#.A", "#...#.....A.P...#...#.#",
  "#A###A.A###.#####.#A#.#", "#...........A.....#.A.#", "#.#A#######AA.#####.#.#", "A...#...#.....#.......A",
  "#...P...P.####A..##...#", "#...#...#.............A", "##A##A#A#A##A###AA#A#A#",
];

// Tracés bricolés comme en dessine un humain (cul-de-sac, couloir d'une case, affiches en impasse, portails seuls ou
// côte à côte, salles reliées par un seul passage, 5×5 minimal…).
const HAND = {
  minimal5: ["#####", "#...#", "#.#.#", "#...#", "#####"],
  corridor1: ["#######", "#.....#", "#######"],
  deadends: ["#########", "#.#.#.#.#", "#.#.#.#.#", "#.......#", "#########"],
  posterDeadEnd: ["#A#####", "#.#...#", "#.#.#.#", "#...#.#", "#####A#"],
  portalDeadEnd: ["#######", "#.###P#", "#.#...#", "#...#.#", "#####.#", "#######"],
  singlePortal: ["#########", "#...#...#", "#.#.#.#.#", "#.#...#P#", "#########"],
  threePortals: ["#########", "#P..#..P#", "#.#.#.#.#", "#.#...#.#", "#...#P..#", "#########"],
  portalAdjPoster: ["#######", "#.AP..#", "#.###.#", "#.....#", "#######"],
  roomsOneDoor: ["###########", "#...#.....#", "#...#.....#", "#...#.....#", "#.........#", "#########.#", "#########.#", "###########"],
  roomsOneDoor2: ["###############", "#....#........#", "#....#........#", "#.............#", "#....#........#", "#....##########", "###############"],
  openHall: ["#########", "#.......#", "#.......#", "#.......#", "#.......#", "#########"],
  openHallPosters: ["#A#A#A#A#", "A.......A", "#.......#", "A.......A", "#A#A#A#A#"],
  hallExitsPosters: ["###A###", "#.....#", "A.....A", "#.....#", "###.###", "###.###", "###A###"],
  edgePortal: ["P...#", "#.#.#", "#...#", "#####"],
  twoPortalsAdjacent: ["#####", "#.PP#", "#...#", "#####"],
  // Pièces fermées ou cases isolées : le marcheur ne peut pas en sortir, mais ne doit ni planter ni traverser les murs.
  isolatedPath: ["#######", "#..#..#", "#..#..#", "#######"],
  closedRoom: ["#####", "#...#", "#...#", "#...#", "#####"],
  closedRoomPosters: ["#A#A#", "#...#", "A...A", "#...#", "#A#A#"],
  isolatedPortal: ["#######", "#...#P#", "#...###", "#######"],
  isolatedPortal2: ["#######", "#...#P#", "#...#.#", "###.###", "#######"],
};
// Deux cas où NOTHING ne peut bouger quoi qu'on fasse (une seule case, ou une case + un portail qui ramène à elle-même).
const UNMOVABLE = { singleCell: ["###", "#.#", "###"] };

const noFault = (r, label) => {
  assert.equal(r.blocked, null, `${label} : blocage ${JSON.stringify(r.blocked)}`);
  assert.equal(r.wallFrames, 0, `${label} : la caméra a rendu depuis un mur (${r.wallFrames} images)`);
};

test("régression : une salle à plusieurs sorties avec une affiche ne fait plus planter le marcheur (ReferenceError « roll » masqué)", () => {
  // Cause racine : pickNewRoomTarget déclarait `let roll = random() * total` — ce qui masquait la fonction importée `roll()`
  // appelée plus haut dans la même fonction (zone morte temporelle) : exception à la première entrée dans une telle salle,
  // la boucle d'animation s'arrêtait et le marcheur se figeait pour toujours.
  const grid = gridFromAscii(["##A####", "#...###", "......#", "#...###", "#######"]);
  for (let seed = 1; seed <= 10; seed++) noFault(walk(grid, { seed, seconds: 200, posters: 2 }), `graine ${seed}`);
});

test("régression : affiche posée sur la case de sortie d'une impasse — le marcheur ressort au lieu de foncer dans le mur nord", () => {
  // Cause racine : après l'arrêt, la nouvelle cible (la sortie) est la case où l'on se trouve ; le chemin est vide et
  // pickRoomDirection renvoyait 0 (le nord, ici un mur) — le marcheur marchait dans le mur sans fin.
  const grid = gridFromAscii(["######", "#...##", "#...##", "....##", "#A####", "######"]);
  for (let seed = 1; seed <= 10; seed++) {
    const r = walk(grid, { seed, seconds: 200, posters: 2 });
    noFault(r, `graine ${seed}`);
    assert.ok(r.focus.includes("P0") || r.focus.includes("P1"), "il s'arrête bien devant l'affiche");
  }
});

test("régression : salle fermée (aucune sortie) ou portail muré ne lèvent plus d'exception", () => {
  for (const name of ["closedRoom", "closedRoomPosters", "isolatedPath", "isolatedPortal", "isolatedPortal2"]) {
    for (let seed = 1; seed <= 6; seed++) noFault(walk(gridFromAscii(HAND[name]), { seed, seconds: 120, posters: 2 }), `${name} graine ${seed}`);
  }
});

test("banc d'essai : tracés générés (3 tailles × 120 graines) — jamais de blocage", () => {
  for (const size of ["small", "medium", "large"]) {
    for (let seed = 1; seed <= 120; seed++) {
      configureRandom({ seed });
      noFault(walk(generateMaze(size), { seed, seconds: 600, luck: seed % 3 === 0 ? 0.55 : "always", fast: seed % 2 === 0 }), `${size} graine ${seed}`);
    }
  }
});

test("banc d'essai : le tracé personnalisé du propriétaire — jamais de blocage, y compris sans affiches et avec des arrêts réalistes", () => {
  const grid = gridFromAscii(OWNER);
  for (let seed = 1; seed <= 60; seed++) noFault(walk(grid, { seed, seconds: 900, posters: seed % 5, luck: seed % 2 ? 0.55 : "always", fast: seed % 4 === 0 }), `propriétaire graine ${seed}`);
  // Il visite bien plusieurs endroits et s'arrête devant des affiches.
  const r = walk(grid, { seed: 4, seconds: 900, posters: 4, fast: false, luck: 0.55 });
  assert.ok(new Set(r.trace.map((p) => `${Math.floor(p.x)},${Math.floor(p.y)}`)).size > 40, "il se promène partout");
  assert.ok(r.focus.filter(Boolean).length >= 5, "il s'arrête devant des affiches");
});

test("banc d'essai : tracés bricolés (culs-de-sac, impasses, portails, salles, 5×5…) — jamais de blocage", () => {
  for (const [name, rows] of Object.entries(HAND)) {
    for (const posters of [0, 3]) for (let seed = 1; seed <= 12; seed++) noFault(walk(gridFromAscii(rows), { seed, seconds: 300, posters, fast: seed % 2 === 0, luck: seed % 3 === 0 ? "never" : "always" }), `${name} graine ${seed}`);
  }
});

test("banc d'essai : 300 tracés dessinés au hasard comme un humain maladroit (murs, chemins, affiches, portails) — jamais de blocage", () => {
  for (let s = 1; s <= 300; s++) {
    configureRandom({ seed: s * 7919 });
    const w = 5 + Math.floor(random() * 19), h = 5 + Math.floor(random() * 19);
    const walls = new Uint8Array(w * h);
    const p = 0.3 + random() * 0.5, closed = random() < 0.5;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) walls[y * w + x] = closed && (x === 0 || y === 0 || x === w - 1 || y === h - 1) ? 0 : random() < p ? 1 : 0;
    const pPoster = random() * 0.5, portals = Math.floor(random() * 5);
    for (let i = 0; i < w * h; i++) if (walls[i] === 0 && random() < pPoster) walls[i] = 2;
    for (let k = 0; k < portals; k++) { const i = Math.floor(random() * w * h); if (walls[i] !== 1) walls[i] = 3; }
    if (!walls.includes(1)) walls[Math.floor(random() * w * h)] = 1;
    // Une case de chemin isolée seule dans tout le tracé ne peut pas bouger : voir le test « immobile par construction ».
    const grid = { width: w, height: h, walls };
    const probe = makeEngine(grid, { seed: s });
    if (probe.wdGaveUp) continue;
    noFault(walk(grid, { seed: s, seconds: 300, posters: s % 4 }), `tracé ${s} (${w}×${h})`);
  }
});

test("tracé sans aucune case d'où partir : le marcheur reste en place, sans erreur ni mur traversé", () => {
  for (const rows of Object.values(UNMOVABLE)) {
    const eng = makeEngine(gridFromAscii(rows), { seed: 1 });
    for (let i = 1; i <= 900; i++) { setClock(i / 30); eng.update(1 / 30, i / 30); }
    assert.ok(Number.isFinite(eng.pos.x) && Number.isFinite(eng.pos.y));
    assert.equal(eng.grid.walls[Math.floor(eng.pos.y) * eng.grid.width + Math.floor(eng.pos.x)], 1);
  }
});

// Empreintes (cases traversées toutes les 0,1 s) calculées avec le moteur 1.0.1 sur des graines qui ne bloquaient pas :
// le correctif ne doit RIEN changer au trajet visible quand rien n'était cassé.
const FINGERPRINTS = [
  ["small", 1, 40083418], ["small", 4, 204269456], ["small", 7, 689742468], ["small", 14, 469432150], ["small", 15, 75320224],
  ["medium", 2, 614767068], ["medium", 3, 403767197], ["medium", 9, 412253210], ["medium", 10, 99977853], ["medium", 11, 316541721],
  ["large", 1, 846543226], ["large", 2, 439896509], ["large", 3, 855264110], ["large", 4, 108288067], ["large", 5, 646767173],
];
test("reproductibilité : à graine égale et tracé non bloquant, le trajet est identique à celui d'avant le correctif", () => {
  for (const [size, seed, expected] of FINGERPRINTS) {
    configureRandom({ seed });
    const r = walk(generateMaze(size), { seed, seconds: 300 });
    noFault(r, `${size} ${seed}`);
    assert.equal(r.fingerprint, expected, `${size} graine ${seed} : le trajet a changé`);
  }
  // Et deux exécutions de la même graine donnent le même trajet.
  const grid = gridFromAscii(OWNER);
  assert.equal(walk(grid, { seed: 5, seconds: 300 }).fingerprint, walk(grid, { seed: 5, seconds: 300 }).fingerprint);
});

test("chien de garde : un moteur figé artificiellement (plus aucun déplacement pendant 40 s) est replanifié et repart", () => {
  let recoveries = 0;
  class Frozen extends MazeEngine {
    step(dt, now) { if (now > 20 && now < 60) return; super.step(dt, now); }
    recoverWalker() { recoveries++; return super.recoverWalker(); }
  }
  const grid = gridFromAscii(OWNER);
  const r = walk(grid, { seed: 3, seconds: 300, posters: 0, engineClass: Frozen, stuckSeconds: 200, continueAfterBlock: true });
  assert.ok(recoveries >= 1, "le chien de garde est intervenu");
  const after = r.trace.filter((p) => p.t > 70);
  assert.ok(new Set(after.map((p) => `${p.x},${p.y}`)).size > 100, "il marche à nouveau");
  assert.equal(r.wallFrames, 0);
});

test("chien de garde : un marcheur dans un mur, état incohérent, est replacé sur une case de chemin valide", () => {
  const grid = gridFromAscii(OWNER);
  let recoveries = 0;
  class Spy extends MazeEngine { recoverWalker() { recoveries++; return super.recoverWalker(); } }
  const r = walk(grid, {
    seed: 2, seconds: 200, posters: 0, engineClass: Spy, continueAfterBlock: true, stuckSeconds: 500,
    hook: (e, t, i) => {
      if (i === 30 * 30) { // à 30 s : cases de départ/arrivée dans un mur, position NaN
        e.cellFrom = { x: 0, y: 0 }; e.cellTo = { x: 0, y: 0 }; e.pos = { x: NaN, y: NaN }; e.t = 0.5;
      }
    },
  });
  assert.ok(recoveries >= 1);
  const last = r.engine;
  assert.ok(Number.isFinite(last.pos.x) && Number.isFinite(last.pos.y));
  assert.equal(grid.walls[Math.floor(last.pos.y) * grid.width + Math.floor(last.pos.x)] === 1 || grid.walls[Math.floor(last.pos.y) * grid.width + Math.floor(last.pos.x)] === 3, true);
  assert.ok(r.trace.filter((p) => p.t > 60 && p.state === "wander").length > 50, "il marche à nouveau");
});

test("chien de garde : un arrêt devant une affiche qui ne se termine jamais est interrompu, sans compter comme blocage en marche", () => {
  const grid = gridFromAscii(OWNER);
  const r = walk(grid, {
    seed: 4, seconds: 200, posters: 3, continueAfterBlock: true, stuckSeconds: 500,
    hook: (e, t, i) => { if (i === 10 * 30) { e.state = "looking"; e.lookUntil = Infinity; e.focusedItem = { title: "figé" }; } },
  });
  assert.equal(r.blocked, null);
  assert.ok(r.trace.filter((p) => p.t > 60 && p.state === "wander").length > 40);
  assert.ok(r.focus.includes(null), "la carte focus est retirée");
});

test("arrêts devant les affiches : un arrêt volontaire (8 s) n'est jamais pris pour un blocage", () => {
  const grid = gridFromAscii(["#A###", "#...#", "#.#.#", "#...#", "#####"]);
  const eng = makeEngine(grid, { seed: 1, hold: 30 });
  let recoveries = 0;
  eng.recoverWalker = () => { recoveries++; };
  eng.opts.lookHoldSeconds = 30;
  for (let i = 1; i <= 30 * 400; i++) { setClock(i / 30); eng.update(1 / 30, i / 30); }
  assert.equal(recoveries, 0);
});

test("boucle d'animation : une exception est journalisée une seule fois et la boucle reprend au tour suivant", () => {
  const grid = gridFromAscii(OWNER);
  const eng = makeEngine(grid, { seed: 6, posters: 0 });
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a);
  const frames = [];
  const origRaf = globalThis.requestAnimationFrame, origCaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    let boom = 6;
    const realStep = eng.step.bind(eng);
    eng.step = (dt, now) => { if (boom-- > 0) throw new Error("boum"); return realStep(dt, now); };
    setClock(0);
    eng.start();
    const before = { ...eng.pos };
    let now = 0;
    for (let i = 0; i < 900; i++) {
      now += 16.7; setClock(now / 1000);
      const cb = frames.pop();
      assert.ok(cb, "le tour suivant est toujours planifié, même après une exception");
      cb(now);
    }
    assert.equal(errors.length, 1, "journalisé une seule fois");
    assert.match(String(errors[0][0]), /maze-overlay/);
    assert.ok(Math.hypot(eng.pos.x - before.x, eng.pos.y - before.y) > 0.5 || eng.t > 0, "le marcheur avance de nouveau");
    assert.ok(eng.running);
    eng.stop();
  } finally {
    console.error = origError; globalThis.requestAnimationFrame = origRaf; globalThis.cancelAnimationFrame = origCaf;
  }
});

test("boucle d'animation : un temps négatif, absent ou énorme (onglet OBS en veille) ne produit jamais de NaN ni de saut", () => {
  const grid = gridFromAscii(OWNER);
  const eng = makeEngine(grid, { seed: 8, posters: 0 });
  eng.render = () => {};
  const times = [100, 50, NaN, 1e9, 1e9 + 16, 1e9 + 33, undefined, 5e9];
  let prev = { ...eng.pos };
  for (const t of times) {
    setClock((Number.isFinite(t) ? t : 0) / 1000);
    eng.tick(t);
    assert.ok(Number.isFinite(eng.pos.x) && Number.isFinite(eng.pos.y) && Number.isFinite(eng.camAngle), `NaN après ${t}`);
    assert.ok(Math.hypot(eng.pos.x - prev.x, eng.pos.y - prev.y) < 1.5, "pas de saut");
    prev = { ...eng.pos };
  }
});
