// Banc d'essai du marcheur du labyrinthe : fait tourner web/engine.js sous node, sans navigateur,
// avec un faux canvas et une horloge simulée (le rendu est neutralisé). Aide de test, pas un test.
import { MazeEngine } from "../modules/maze-overlay/web/engine.js";
import { configureRandom } from "../modules/maze-overlay/web/random.js";
import { CELL_PATH, CELL_PORTAL, CELL_PROMO, CELL_VOID } from "../modules/maze-overlay/web/types.js";

const ASCII = { "#": CELL_VOID, ".": CELL_PATH, A: CELL_PROMO, P: CELL_PORTAL };

/** Tracé depuis un dessin ASCII : # mur, . chemin, A affiche, P portail. */
export function gridFromAscii(rows) {
  const lines = Array.isArray(rows) ? rows : rows.trim().split("\n");
  const width = lines[0].length;
  const walls = new Uint8Array(width * lines.length);
  lines.forEach((l, y) => {
    assert(l.length === width, "lignes de longueur inégale");
    [...l].forEach((c, x) => (walls[y * width + x] = ASCII[c]));
  });
  return { width, height: lines.length, walls };
}
function assert(c, m) {
  if (!c) throw new Error(m);
}

const fakeCanvas = () => ({
  clientWidth: 640,
  clientHeight: 360,
  width: 0,
  height: 0,
  getContext: () => ({ imageSmoothingEnabled: false, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, drawImage() {} }),
});

const realNow = performance.now.bind(performance);
let clockMs = 0;

/**
 * Fait marcher le moteur `seconds` secondes simulées (pas de 1/30 s, horloge simulée partout) et renvoie
 * { trace, fingerprint, blocked, ... }. `blocked` : { at, state, cell } au premier blocage détecté, sinon null.
 * Un blocage = la position ne bouge plus de 0,5 case pendant `stuckSeconds` hors arrêt volontaire, ou un arrêt qui dure
 * bien plus que sa durée prévue, ou un marcheur dont la caméra rend depuis une case non praticable.
 */
/** Moteur sur faux canvas, rendu neutralisé, avec `posters` affiches fictives. Horloge simulée : voir setClock. */
export function makeEngine(grid, o = {}) {
  const { seed = 1, posters = 3, moveSpeed = 1.4, stopMin = 12, stopMax = 25, hold = 8, engineClass = MazeEngine, focus = [] } = o;
  configureRandom({ seed, luck: o.luck ?? "always", fast: o.fast ?? true });
  performance.now = () => clockMs;
  clockMs = 0;
  const eng = new engineClass({
    canvas: fakeCanvas(), grid, wallTextures: [], floorTextures: [], portalTextures: [],
    moveSpeed, turnSpeedDegrees: 220, fovDegrees: 66, stopMinSeconds: stopMin, stopMaxSeconds: stopMax, lookHoldSeconds: hold,
    onFocusChange: (i) => focus.push(i ? i.title : null),
  });
  eng.render = () => {};
  const items = Array.from({ length: posters }, (_, i) => ({ title: `P${i}`, kind: "article" }));
  eng.setPromos(items, items.map(() => ({ data: { data: new Uint8ClampedArray(4) }, width: 1, height: 1 })));
  return eng;
}
export function setClock(seconds) { clockMs = seconds * 1000; }

export function walk(grid, o = {}) {
  const { seconds = 600, stuckSeconds = 25, step = 1 / 30, hold = 8, hook } = o;
  const focus = [];
  const eng = makeEngine(grid, { ...o, focus });
  const trace = [];
  let fp = 7;
  let blocked = null;
  let anchor = { x: eng.pos.x, y: eng.pos.y, t: 0 };
  let stateSince = 0, lastState = eng.state, wallFrames = 0;
  const total = Math.round(seconds / step);
  for (let i = 1; i <= total; i++) {
    const t = i * step;
    setClock(t);
    const dt = Math.min(step, 0.1);
    if (hook) hook(eng, t, i);
    try {
      eng.update(dt, t);
    } catch (e) {
      blocked ??= { at: t, why: "exception", message: String(e?.message ?? e), state: eng.state };
      if (!o.continueAfterBlock) break;
    }
    const cx = Math.floor(eng.pos.x), cy = Math.floor(eng.pos.y);
    const v = cx >= 0 && cy >= 0 && cx < grid.width && cy < grid.height ? grid.walls[cy * grid.width + cx] : CELL_VOID;
    if (v !== CELL_PATH && v !== CELL_PORTAL) wallFrames++;
    if (!Number.isFinite(eng.pos.x) || !Number.isFinite(eng.pos.y) || !Number.isFinite(eng.camAngle)) {
      blocked ??= { at: t, why: "NaN", state: eng.state };
    }
    if (eng.state !== lastState) { lastState = eng.state; stateSince = t; }
    if (i % 3 === 0) {
      fp = (fp * 31 + cx * 53 + cy * 7 + (eng.state === "wander" ? 1 : 2)) % 1000000007;
      if (i % 30 === 0) trace.push({ t: Math.round(t), x: +eng.pos.x.toFixed(2), y: +eng.pos.y.toFixed(2), state: eng.state });
    }
    if (eng.state === "wander") {
      if (Math.hypot(eng.pos.x - anchor.x, eng.pos.y - anchor.y) > 0.5) anchor = { x: eng.pos.x, y: eng.pos.y, t };
      else if (t - anchor.t > stuckSeconds) blocked ??= { at: t, why: "immobile", state: eng.state, cell: [cx, cy] };
    } else {
      anchor = { x: eng.pos.x, y: eng.pos.y, t };
      if (t - stateSince > hold + 20) blocked ??= { at: t, why: "arrêt interminable", state: eng.state, cell: [cx, cy] };
    }
    if (blocked && !o.continueAfterBlock) break;
  }
  return { trace, fingerprint: fp, blocked, wallFrames, focus, engine: eng };
}
export function restoreClock() { performance.now = realNow; }
