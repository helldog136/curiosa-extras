// Décodeur de QR code POUR LES TESTS (mode octet, versions 1 à 10), écrit à part du générateur : il part d'une matrice de modules (ou d'un SVG, ou d'un PNG)
// et retrouve le texte, comme le ferait un lecteur. Il corrige les erreurs (Reed-Solomon : syndromes, Berlekamp-Massey, Chien, Forney), ce qui permet
// d'abîmer volontairement un code et de vérifier qu'il se lit encore.
//
// Ce qui est volontairement refait ici plutôt que repris du générateur : la carte des modules de fonction (calculée par formule, pas par tableau),
// la lecture et le décodage du format (distance de Hamming sur les 32 combinaisons possibles), la lecture en zigzag, le corps de Galois.
// Seul le découpage en blocs est repris du générateur (blockLayout) : il est vérifié à part, contre une bibliothèque de référence et des lecteurs indépendants.
import { inflateSync } from "node:zlib";
import { blockLayout } from "../../modules/short-links/qr.mjs";

// ── Galois ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const exp = new Array(512).fill(0);
const log = new Array(256).fill(0);
for (let i = 0, x = 1; i < 255; i++) {
  exp[i] = x;
  log[x] = i;
  x = x * 2 > 255 ? (x * 2) ^ 0x11d : x * 2;
}
for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
const gmul = (a, b) => (a && b ? exp[log[a] + log[b]] : 0);
const gdiv = (a, b) => (a === 0 ? 0 : exp[(log[a] + 255 - log[b]) % 255]);

/** Corrige un bloc (données puis correction). Rend { data, errors } ou lève si le bloc est trop abîmé. */
export function rsCorrect(received, ecCount) {
  const n = received.length;
  const r = received.slice();
  const synd = [];
  for (let j = 0; j < ecCount; j++) {
    let s = 0;
    for (let k = 0; k < n; k++) s ^= gmul(r[k], exp[(j * (n - 1 - k)) % 255]);
    synd.push(s);
  }
  if (synd.every((s) => s === 0)) return { data: r.slice(0, n - ecCount), errors: 0 };

  // Berlekamp-Massey : polynôme localisateur C (C[0] = 1)
  let C = [1], B = [1], L = 0, m = 1, b = 1;
  for (let i = 0; i < ecCount; i++) {
    let d = synd[i];
    for (let k = 1; k <= L; k++) d ^= gmul(C[k] ?? 0, synd[i - k]);
    if (d === 0) { m++; continue; }
    const T = C.slice();
    const coef = gdiv(d, b);
    const shifted = new Array(m).fill(0).concat(B.map((v) => gmul(v, coef)));
    C = Array.from({ length: Math.max(C.length, shifted.length) }, (_, k) => (C[k] ?? 0) ^ (shifted[k] ?? 0));
    if (2 * L <= i) { L = i + 1 - L; B = T; b = d; m = 1; } else m++;
  }
  while (C.length > 1 && C[C.length - 1] === 0) C.pop();
  if (C.length - 1 !== L || L > ecCount / 2) throw new Error("bloc trop abîmé");

  // Chien : positions p (puissance de x) où C(α^-p) = 0
  const evalPoly = (coeffs, x) => {
    let v = 0;
    for (let k = coeffs.length - 1; k >= 0; k--) v = gmul(v, x) ^ coeffs[k];
    return v;
  };
  const positions = [];
  for (let p = 0; p < n; p++) if (evalPoly(C, exp[(255 - (p % 255)) % 255]) === 0) positions.push(p);
  if (positions.length !== L) throw new Error("bloc trop abîmé");

  // Forney (racines de départ α^0) : Ω = S·C mod x^ec ; erreur = X·Ω(X⁻¹) / C'(X⁻¹)
  const omega = Array.from({ length: ecCount }, (_, i) => {
    let v = 0;
    for (let k = 0; k <= i; k++) v ^= gmul(synd[k], C[i - k] ?? 0);
    return v;
  });
  const derivative = [];
  for (let i = 1; i < C.length; i++) derivative[i - 1] = i % 2 === 1 ? C[i] : 0;
  for (const p of positions) {
    const xInv = exp[(255 - (p % 255)) % 255];
    const den = evalPoly(derivative, xInv);
    if (den === 0) throw new Error("bloc trop abîmé");
    r[n - 1 - p] ^= gmul(exp[p % 255], gdiv(evalPoly(omega, xInv), den));
  }
  // contrôle : plus aucune erreur
  for (let j = 0; j < ecCount; j++) {
    let s = 0;
    for (let k = 0; k < n; k++) s ^= gmul(r[k], exp[(j * (n - 1 - k)) % 255]);
    if (s !== 0) throw new Error("bloc trop abîmé");
  }
  return { data: r.slice(0, n - ecCount), errors: positions.length };
}

// ── Carte des modules de fonction, par formule ─────────────────────────────────────────────────────────────────────────────
function alignmentCenters(version) {
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const last = 4 * version + 10;
  const step = Math.ceil((4 * version + 4) / (2 * n - 2)) * 2;
  const out = [6];
  for (let p = last - (n - 2) * step; p <= last; p += step) out.push(p);
  return out;
}

function functionMap(version) {
  const size = 17 + 4 * version;
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if ((r < 9 && c < 9) || (r < 9 && c >= size - 8) || (r >= size - 8 && c < 9)) fn[r][c] = true; // repères, séparateurs, format
      if (r === 6 || c === 6) fn[r][c] = true;
      if (version >= 7 && ((r < 6 && c >= size - 11) || (c < 6 && r >= size - 11))) fn[r][c] = true;
    }
  }
  const centers = alignmentCenters(version);
  for (const a of centers) for (const b of centers) {
    if ((a === 6 && b === 6) || (a === 6 && b === centers[centers.length - 1]) || (a === centers[centers.length - 1] && b === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) fn[a + dr][b + dc] = true;
  }
  return fn;
}

// ── Format ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const LEVEL_OF_BITS = { 1: "L", 0: "M", 3: "Q", 2: "H" };
function bch15(data5) {
  let v = data5 << 10;
  for (let i = 14; i >= 10; i--) if ((v >> i) & 1) v ^= 0x537 << (i - 10);
  return ((data5 << 10) | v) ^ 0x5412;
}
const popcount = (x) => { let n = 0; while (x) { n += x & 1; x >>>= 1; } return n; };

function readFormat(modules, size) {
  const bit = (r, c) => (modules[r][c] ? 1 : 0);
  // Bit i (0 = poids faible) de la première copie, autour du repère en haut à gauche, puis de la seconde (en bas à gauche et en haut à droite).
  const firstAt = (i) => (i <= 5 ? [i, 8] : i === 6 ? [7, 8] : i === 7 ? [8, 8] : i === 8 ? [8, 7] : [8, 14 - i]);
  const secondAt = (i) => (i < 8 ? [size - 1 - i, 8] : [8, size - 15 + i]);
  let copy1 = 0, copy2 = 0;
  for (let i = 0; i < 15; i++) {
    copy1 |= bit(...firstAt(i)) << i;
    copy2 |= bit(...secondAt(i)) << i;
  }
  let best = null;
  for (let d = 0; d < 32; d++) {
    const word = bch15(d);
    const dist = Math.min(popcount(word ^ copy1), popcount(word ^ copy2));
    if (!best || dist < best.dist) best = { dist, d };
  }
  if (best.dist > 3) throw new Error("format illisible");
  return { level: LEVEL_OF_BITS[best.d >> 3], mask: best.d & 7 };
}

const maskBit = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/**
 * Décode une matrice de modules (booléens, sans la zone de silence).
 * @returns {{ text: string, version: number, level: string, mask: number, corrected: number }}
 */
export function decodeMatrix(modules) {
  const size = modules.length;
  if (size < 21 || size > 57 || (size - 17) % 4 !== 0) throw new Error("taille inconnue");
  const version = (size - 17) / 4;
  const { level, mask } = readFormat(modules, size);
  if (level === "H") throw new Error("niveau H non pris en charge");
  const fn = functionMap(version);

  // lecture en zigzag
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - v : v;
        if (fn[r][c]) continue;
        bits.push((modules[r][c] ? 1 : 0) ^ (maskBit[mask](r, c) ? 1 : 0));
      }
    }
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8).join(""), 2));

  const { ecPer, blocks, dataTotal } = blockLayout(version, level);
  if (bytes.length !== dataTotal + ecPer * blocks.length) throw new Error(`nombre d'octets inattendu (${bytes.length})`);
  // désentrelacement
  const dataBlocks = blocks.map(() => []);
  let at = 0;
  const longest = Math.max(...blocks);
  for (let i = 0; i < longest; i++) blocks.forEach((size2, b) => { if (i < size2) dataBlocks[b].push(bytes[at++]); });
  const ecBlocks = blocks.map(() => []);
  for (let i = 0; i < ecPer; i++) blocks.forEach((_, b) => ecBlocks[b].push(bytes[at++]));
  let corrected = 0;
  const data = [];
  blocks.forEach((_, b) => {
    const fixed = rsCorrect([...dataBlocks[b], ...ecBlocks[b]], ecPer);
    corrected += fixed.errors;
    data.push(...fixed.data);
  });

  // flux de bits : mode, longueur, octets
  const stream = data.map((x) => x.toString(2).padStart(8, "0")).join("");
  if (stream.slice(0, 4) !== "0100") throw new Error("ce n'est pas le mode octet");
  const countBits = version < 10 ? 8 : 16;
  const count = parseInt(stream.slice(4, 4 + countBits), 2);
  const out = [];
  for (let i = 0; i < count; i++) out.push(parseInt(stream.slice(4 + countBits + i * 8, 4 + countBits + i * 8 + 8), 2));
  return { text: new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(out)), version, level, mask, corrected };
}

// ── Lire un SVG ou un PNG produit par le module ────────────────────────────────────────────────────────────────────────────
/** Retrouve la matrice (sans zone de silence) d'un SVG du module : un seul tracé de rectangles « M x y h n v 1 h -n z ». */
export function matrixFromSvg(svg) {
  const view = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!view) throw new Error("pas de viewBox");
  const full = Number(view[1]);
  const quiet = 4;
  const n = full - quiet * 2;
  const modules = Array.from({ length: n }, () => new Array(n).fill(false));
  const d = /<path fill="#000000" d="([^"]*)"/.exec(svg)?.[1] ?? "";
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, len] = [Number(m[1]) - quiet, Number(m[2]) - quiet, Number(m[3])];
    for (let i = 0; i < len; i++) modules[y][x + i] = true;
  }
  return modules;
}

/** Lit un PNG 1 bit du module (sans filtre) et rend { pixels, side }. */
export function readPng(buf) {
  if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new Error("signature PNG absente");
  let at = 8, header = null;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString("ascii", at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    const crc = buf.readUInt32BE(at + 8 + len);
    if (crc32(buf.subarray(at + 4, at + 8 + len)) !== crc) throw new Error(`CRC faux (${type})`);
    if (type === "IHDR") header = { w: body.readUInt32BE(0), h: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    if (type === "IDAT") idat.push(body);
    at += 12 + len;
  }
  if (!header || header.depth !== 1 || header.color !== 0 || header.interlace !== 0 || header.w !== header.h) throw new Error("PNG inattendu");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil(header.w / 8) + 1;
  if (raw.length !== stride * header.h) throw new Error("taille des données inattendue");
  const pixels = Array.from({ length: header.h }, (_, y) => {
    if (raw[y * stride] !== 0) throw new Error("filtre inattendu");
    return Array.from({ length: header.w }, (_, x) => ((raw[y * stride + 1 + (x >> 3)] >> (7 - (x & 7))) & 1) === 0); // vrai = noir
  });
  return { pixels, side: header.w, header };
}

/** Matrice (sans zone de silence) d'un PNG du module : le facteur d'échelle est retrouvé d'après la taille. */
export function matrixFromPng(buf) {
  const { pixels, side } = readPng(buf);
  for (let version = 1; version <= 10; version++) {
    const n = 17 + 4 * version;
    if (side % (n + 8) !== 0) continue;
    const scale = side / (n + 8);
    const modules = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => pixels[(r + 4) * scale + (scale >> 1)][(c + 4) * scale + (scale >> 1)]));
    // la zone de silence doit être entièrement claire
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const inside = y >= 4 * scale && y < (n + 4) * scale && x >= 4 * scale && x < (n + 4) * scale;
      if (!inside && pixels[y][x]) throw new Error("la zone de silence n'est pas claire");
    }
    return { modules, scale };
  }
  throw new Error("taille de PNG inconnue");
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
