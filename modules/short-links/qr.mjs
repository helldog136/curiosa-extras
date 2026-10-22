// Générateur de QR code en JavaScript pur, sans aucune dépendance (norme ISO/IEC 18004).
//
// Ce que fait ce fichier : mode « octet » (le texte est lu en UTF-8), niveaux de correction d'erreur L, M et Q, versions 1 à 10
// (de 21×21 à 57×57 modules : largement assez pour une adresse courte), correction d'erreur Reed-Solomon, placement des
// motifs de repérage / d'alignement / de synchronisation, informations de format et de version (codes BCH), choix du masque
// par la pénalité de la norme (règles N1 à N4). Il ne fait rien d'autre : le dessin (SVG, PNG) est dans qr-render.mjs.
//
// Ce qui est vérifié (tests/short-links-qr.test.mjs) : relecture par un décodeur indépendant écrit pour les tests (avec des modules
// abîmés volontairement), comparaison module par module avec une bibliothèque de référence quand elle est présente, vecteurs connus
// de la norme (octets de correction, informations de format et de version).

/** Niveaux de correction : bits de format et index. (H n'est pas proposé : à 30 % de redondance, l'adresse courte n'y gagne rien.) */
const LEVELS = { L: { bits: 1, index: 0 }, M: { bits: 0, index: 1 }, Q: { bits: 3, index: 2 } };

/**
 * Découpage en blocs, par version puis par niveau : [octets de correction par bloc, [[nombre de blocs, octets de données par bloc], …]].
 * Vérifié par le total : version 10 = 346 octets au total, quel que soit le niveau (données + blocs × correction).
 */
const BLOCKS = [
  null,
  { L: [7, [[1, 19]]], M: [10, [[1, 16]]], Q: [13, [[1, 13]]] },
  { L: [10, [[1, 34]]], M: [16, [[1, 28]]], Q: [22, [[1, 22]]] },
  { L: [15, [[1, 55]]], M: [26, [[1, 44]]], Q: [18, [[2, 17]]] },
  { L: [20, [[1, 80]]], M: [18, [[2, 32]]], Q: [26, [[2, 24]]] },
  { L: [26, [[1, 108]]], M: [24, [[2, 43]]], Q: [18, [[2, 15], [2, 16]]] },
  { L: [18, [[2, 68]]], M: [16, [[4, 27]]], Q: [24, [[4, 19]]] },
  { L: [20, [[2, 78]]], M: [18, [[4, 31]]], Q: [18, [[2, 14], [4, 15]]] },
  { L: [24, [[2, 97]]], M: [22, [[2, 38], [2, 39]]], Q: [22, [[4, 18], [2, 19]]] },
  { L: [30, [[2, 116]]], M: [22, [[3, 36], [2, 37]]], Q: [20, [[4, 16], [4, 17]]] },
  { L: [18, [[2, 68], [2, 69]]], M: [26, [[4, 43], [1, 44]]], Q: [24, [[6, 19], [2, 20]]] },
];
export const MAX_VERSION = 10;

/** Centres des motifs d'alignement, par version. */
const ALIGNMENT = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// ── Corps de Galois GF(256), polynôme 0x11D ─────────────────────────────────────────────────────────────────────────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Polynôme générateur de degré `degree` (premier coefficient = 1). */
function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Octets de correction Reed-Solomon d'un bloc de données. */
export function reedSolomon(data, ecCount) {
  const gen = generator(ecCount);
  const rem = new Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift();
    rem.push(0);
    for (let i = 0; i < ecCount; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

// ── Capacités ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
function layout(version, level) {
  const [ecPer, groups] = BLOCKS[version][level];
  const blocks = groups.flatMap(([count, size]) => Array.from({ length: count }, () => size));
  return { ecPer, blocks, dataTotal: blocks.reduce((a, b) => a + b, 0) };
}

/** Nombre d'octets qu'une version et un niveau peuvent contenir en mode octet. */
export function byteCapacity(version, level) {
  const { dataTotal } = layout(version, level);
  const countBits = version < 10 ? 8 : 16;
  return Math.floor((dataTotal * 8 - 4 - countBits) / 8);
}

/** Plus grande taille (en octets) qu'on peut encoder au niveau donné : celle de la version 10. */
export const maxBytes = (level = "M") => byteCapacity(MAX_VERSION, level);

// ── Construction du flux de bits ────────────────────────────────────────────────────────────────────────────────────────────
function pushBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

function buildCodewords(bytes, version, level) {
  const { ecPer, blocks, dataTotal } = layout(version, level);
  const bits = [];
  pushBits(bits, 0b0100, 4); // mode octet
  pushBits(bits, bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) pushBits(bits, b, 8);
  const capacityBits = dataTotal * 8;
  pushBits(bits, 0, Math.min(4, capacityBits - bits.length)); // terminateur
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < dataTotal; pad ^= 0xec ^ 0x11) data.push(pad);

  // découpage en blocs, correction par bloc, puis entrelacement (données d'abord, correction ensuite)
  const dataBlocks = [];
  let at = 0;
  for (const size of blocks) {
    dataBlocks.push(data.slice(at, at + size));
    at += size;
  }
  const ecBlocks = dataBlocks.map((block) => reedSolomon(block, ecPer));
  const out = [];
  const longest = Math.max(...blocks);
  for (let i = 0; i < longest; i++) for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  for (let i = 0; i < ecPer; i++) for (const block of ecBlocks) out.push(block[i]);
  return out;
}

// ── Matrice ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const maskTest = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Bits d'information de format (15 bits : niveau + masque + code BCH, puis le masque 0x5412 de la norme). */
export function formatBits(level, mask) {
  const data = (LEVELS[level].bits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** Bits d'information de version (18 bits : version + code BCH), seulement à partir de la version 7. */
export function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

function blank(size) {
  return Array.from({ length: size }, () => new Array(size).fill(false));
}

/** Motifs fixes (repérage, synchronisation, alignement, module sombre) et zones réservées. Rend { modules, fixed }. */
function baseMatrix(version) {
  const size = 17 + 4 * version;
  const modules = blank(size);
  const fixed = blank(size);
  const set = (r, c, dark) => {
    modules[r][c] = dark;
    fixed[r][c] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cr, cc] of [[3, 3], [3, size - 4], [size - 4, 3]]) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const r = cr + dr, c = cc + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const dist = Math.max(Math.abs(dr), Math.abs(dc));
        set(r, c, dist !== 2 && dist !== 4);
      }
    }
  }
  const pos = ALIGNMENT[version];
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(pos[i] + dr, pos[j] + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }
  // zones de format (réservées, remplies plus tard) et module sombre
  for (let i = 0; i < 9; i++) {
    fixed[8][i] = true;
    fixed[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    fixed[8][size - 1 - i] = true;
    fixed[size - 1 - i][8] = true;
  }
  set(size - 8, 8, true);
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
  return { size, modules, fixed };
}

/** Écrit les 15 bits de format aux deux endroits prévus par la norme. */
function drawFormat(modules, size, level, mask) {
  const bits = formatBits(level, mask);
  const bit = (i) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let i = 9; i < 15; i++) modules[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = bit(i);
  modules[size - 8][8] = true; // module sombre, toujours
}

/** Place les octets en zigzag, par colonnes de deux, de bas en haut puis de haut en bas, en sautant la colonne de synchronisation. */
function placeData(modules, fixed, size, codewords) {
  let n = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (fixed[r][c] || n >= total) continue;
        modules[r][c] = ((codewords[n >>> 3] >>> (7 - (n & 7))) & 1) === 1;
        n++;
      }
    }
  }
}

// ── Pénalité (règles N1 à N4 de la norme) ──────────────────────────────────────────────────────────────────────────────────
// N1 : 3 points par suite de 5 modules identiques, +1 par module de plus (lignes et colonnes)
// N2 : 3 points par carré de 2×2 modules identiques
// N3 : 40 points par motif sombre-clair-sombre-sombre-sombre-clair-sombre (1:1:3:1:1) précédé ou suivi de 4 modules clairs ;
//      ce qui dépasse du symbole compte comme clair (c'est la zone de silence)
// N4 : 10 points par tranche de 5 % d'écart entre la part de modules sombres et 50 %
const FINDER_A = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
const FINDER_B = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];

function linePenalty(line) {
  let score = 0;
  let run = 1;
  for (let i = 1; i <= line.length; i++) {
    if (i < line.length && line[i] === line[i - 1]) run++;
    else {
      if (run >= 5) score += 3 + (run - 5);
      run = 1;
    }
  }
  const padded = [0, 0, 0, 0, ...line, 0, 0, 0, 0];
  for (let i = 0; i + 11 <= padded.length; i++) {
    let a = true, b = true;
    for (let k = 0; k < 11 && (a || b); k++) {
      if (padded[i + k] !== FINDER_A[k]) a = false;
      if (padded[i + k] !== FINDER_B[k]) b = false;
    }
    if (a) score += 40;
    if (b) score += 40;
  }
  return score;
}

export function penalty(modules) {
  const size = modules.length;
  let score = 0;
  let dark = 0;
  for (let r = 0; r < size; r++) {
    score += linePenalty(modules[r].map(Number));
    for (let c = 0; c < size; c++) if (modules[r][c]) dark++;
  }
  for (let c = 0; c < size; c++) score += linePenalty(modules.map((row) => Number(row[c])));
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3;
    }
  }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

// ── Point d'entrée ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Encode un texte.
 * @param {string} text           le texte (une adresse, en pratique)
 * @param {{ level?: "L"|"M"|"Q", mask?: number, minVersion?: number }} [options]  `mask` force un masque (essais) ; sinon le moins pénalisé
 * @returns {{ version: number, level: string, mask: number, size: number, modules: boolean[][], penalties: number[] }}
 */
export function encodeQr(text, options = {}) {
  const level = options.level ?? "M";
  if (!LEVELS[level]) throw new Error("qr: niveau inconnu");
  const bytes = [...new TextEncoder().encode(String(text))];
  if (bytes.length === 0) throw new Error("qr: texte vide");
  let version = Math.max(1, options.minVersion ?? 1);
  while (version <= MAX_VERSION && byteCapacity(version, level) < bytes.length) version++;
  if (version > MAX_VERSION) throw new Error("qr: texte trop long");

  const codewords = buildCodewords(bytes, version, level);
  const { size, modules: base, fixed } = baseMatrix(version);
  placeData(base, fixed, size, codewords);

  const attempt = (mask) => {
    const modules = base.map((row) => row.slice());
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fixed[r][c] && maskTest[mask](r, c)) modules[r][c] = !modules[r][c];
    drawFormat(modules, size, level, mask);
    return modules;
  };
  if (options.mask !== undefined) {
    if (!Number.isInteger(options.mask) || options.mask < 0 || options.mask > 7) throw new Error("qr: masque inconnu");
    const modules = attempt(options.mask);
    return { version, level, mask: options.mask, size, modules, penalties: [] };
  }
  const penalties = [];
  let best = 0, bestModules = null;
  for (let mask = 0; mask < 8; mask++) {
    const modules = attempt(mask);
    penalties.push(penalty(modules));
    if (bestModules === null || penalties[mask] < penalties[best]) {
      best = mask;
      bestModules = modules;
    }
  }
  return { version, level, mask: best, size, modules: bestModules, penalties };
}
