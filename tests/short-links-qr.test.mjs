// Liens courts — le générateur de QR code, vérifié de quatre façons qui ne reposent pas sur le générateur lui-même :
//   1. des valeurs connues de la norme (octets de correction, informations de format et de version, capacités) ;
//   2. une relecture par un décodeur écrit à part (tests/helpers/short-links-qr-decode.mjs), y compris sur des codes abîmés exprès ;
//   3. la comparaison module par module avec la bibliothèque « qrcode » du cœur, pour toutes les versions, tous les niveaux et tous les masques ;
//   4. le choix du masque recalculé par une seconde implémentation de la pénalité.
// (Lecteurs indépendants — OpenCV et jsQR — passés une fois à la main : voir docs/ideas/short-links.md.)
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { blockLayout, byteCapacity, encodeQr, formatBits, maxBytes, reedSolomon, versionBits } from "../modules/short-links/qr.mjs";
import { qrToPng, qrToSvg, scaleFor } from "../modules/short-links/qr-render.mjs";
import { crc32, decodeMatrix, matrixFromPng, matrixFromSvg, readPng } from "./helpers/short-links-qr-decode.mjs";

const LEVELS = ["L", "M", "Q"];
/** Un texte de `length` octets, varié (pas de motif qui flatterait un défaut). */
const sample = (length, seed = 0) => Array.from({ length }, (_, i) => String.fromCharCode(33 + ((i * 13 + seed * 7 + (i >> 3) * 5) % 90))).join("");

// ── 1. Valeurs connues ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("octets de correction : exemples de la norme (« 01234567 » en 1-M) et de « HELLO WORLD » (1-M)", () => {
  assert.deepEqual(reedSolomon([0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11], 10), [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
  assert.deepEqual(reedSolomon([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test("informations de format et de version : valeurs de la norme", () => {
  assert.equal(formatBits("M", 0), 0b101010000010010);
  assert.equal(formatBits("L", 0), 0b111011111000100);
  assert.equal(formatBits("Q", 0), 0b011010101011111);
  assert.equal(formatBits("L", 5), 0b110001100011000);
  assert.equal(formatBits("M", 5), 0b100000011001110);
  assert.equal(versionBits(7), 0b000111110010010100);
  assert.equal(versionBits(8), 0b001000010110111100);
  assert.equal(versionBits(9), 0b001001101010011001);
  assert.equal(versionBits(10), 0b001010010011010011);
});

test("capacités en mode octet : tableau de la norme, versions 1 à 10, et 346 octets au total à la version 10 quel que soit le niveau", () => {
  const table = { L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271], M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213], Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151] };
  const totals = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
  for (const level of LEVELS) {
    for (let v = 1; v <= 10; v++) {
      assert.equal(byteCapacity(v, level), table[level][v - 1], `v${v}-${level}`);
      const { ecPer, blocks, dataTotal } = blockLayout(v, level);
      assert.equal(dataTotal + ecPer * blocks.length, totals[v - 1], `octets au total, v${v}-${level}`);
    }
  }
  assert.equal(maxBytes("L"), 271);
  assert.equal(maxBytes("Q"), 151);
});

// ── 2. Relecture par un décodeur indépendant ────────────────────────────────────────────────────────────────────────────────
test("relecture : chaque version et chaque niveau, au plus rempli puis à moitié", () => {
  for (const level of LEVELS) {
    for (let v = 1; v <= 10; v++) {
      for (const length of [byteCapacity(v, level), Math.max(1, Math.floor(byteCapacity(v, level) / 2))]) {
        const text = sample(length, v);
        const qr = encodeQr(text, { level });
        const read = decodeMatrix(qr.modules);
        assert.equal(read.text, text, `v${v}-${level} (${length} octets)`);
        assert.equal(read.level, level);
        assert.equal(read.mask, qr.mask);
        assert.equal(read.corrected, 0);
        if (length === byteCapacity(v, level)) assert.equal(qr.version, v, "le texte le plus long d'une version la remplit");
      }
    }
  }
});

test("relecture : une adresse courte typique, au niveau choisi, avec les accents et l'euro (UTF-8)", () => {
  for (const level of LEVELS) {
    const url = "https://www.example.org/m/short-links/go?c=merch";
    assert.equal(decodeMatrix(encodeQr(url, { level }).modules).text, url);
  }
  const accents = "Élodie – 5 € à la fête";
  assert.equal(decodeMatrix(encodeQr(accents, { level: "Q" }).modules).text, accents);
});

test("relecture : un code abîmé exprès se lit encore (autant de modules retournés que la correction peut en réparer)", () => {
  let seed = 12345;
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (const level of LEVELS) {
    for (const v of [1, 3, 5, 7, 10]) {
      const text = sample(byteCapacity(v, level), v + 3);
      const qr = encodeQr(text, { level });
      const size = qr.size;
      const t = Math.floor(blockLayout(qr.version, level).ecPer / 2);
      const damaged = qr.modules.map((row) => row.slice());
      const seen = new Set();
      while (seen.size < t) {
        const r = Math.floor(random() * size), c = Math.floor(random() * size);
        const inFunction = r === 6 || c === 6 || (r < 9 && (c < 9 || c >= size - 8)) || (r >= size - 8 && c < 9) || (qr.version >= 7 && ((r < 6 && c >= size - 11) || (c < 6 && r >= size - 11)));
        if (inFunction || seen.has(r * 1000 + c)) continue; // les motifs de repérage ne font pas partie de ce qu'on abîme ici
        seen.add(r * 1000 + c);
        damaged[r][c] = !damaged[r][c];
      }
      const read = decodeMatrix(damaged);
      assert.equal(read.text, text, `v${v}-${level} avec ${t} modules retournés`);
      assert.ok(read.corrected > 0 && read.corrected <= t);
    }
  }
});

test("relecture : trop de dégâts, le décodeur le dit au lieu de rendre n'importe quoi", () => {
  const qr = encodeQr(sample(40), { level: "L" });
  const damaged = qr.modules.map((row) => row.slice());
  for (let r = 10; r < 24; r++) for (let c = 10; c < 24; c++) damaged[r][c] = (r * 7 + c * 3) % 2 === 0;
  assert.throws(() => decodeMatrix(damaged));
});

// ── 3. Comparaison avec une bibliothèque de référence ─────────────────────────────────────────────────────────────────────────
function reference() {
  try {
    return createRequire(path.join(process.cwd(), "package.json"))("qrcode");
  } catch {
    return null;
  }
}

test("référence : mêmes modules, au module près, pour toutes les versions, tous les niveaux et les 8 masques", { skip: reference() ? false : "bibliothèque de référence absente" }, () => {
  const QR = reference();
  let compared = 0;
  for (const level of LEVELS) {
    for (let v = 1; v <= 10; v++) {
      const text = sample(byteCapacity(v, level), v);
      for (let mask = 0; mask < 8; mask++) {
        const mine = encodeQr(text, { level, mask });
        const ref = QR.create([{ data: Buffer.from(text), mode: "byte" }], { errorCorrectionLevel: level, maskPattern: mask });
        assert.equal(mine.version, ref.version, `version v${v}-${level}`);
        for (let r = 0; r < mine.size; r++) for (let c = 0; c < mine.size; c++) if (mine.modules[r][c] !== Boolean(ref.modules.get(r, c))) assert.fail(`module (${r},${c}) différent, v${v}-${level} masque ${mask}`);
        compared++;
      }
    }
  }
  assert.equal(compared, 240);
});

// ── 4. Le masque est celui de moindre pénalité ───────────────────────────────────────────────────────────────────────────────
/** Seconde implémentation des quatre règles de la norme, écrite autrement (lignes en texte, motifs cherchés dans le texte). */
function refPenalty(modules) {
  const n = modules.length;
  const rows = modules.map((row) => row.map((v) => (v ? "1" : "0")).join(""));
  const cols = Array.from({ length: n }, (_, c) => modules.map((row) => (row[c] ? "1" : "0")).join(""));
  let score = 0;
  for (const line of [...rows, ...cols]) {
    for (const run of line.match(/0+|1+/g)) if (run.length >= 5) score += 3 + run.length - 5;
    const padded = `0000${line}0000`;
    for (let i = 0; i + 11 <= padded.length; i++) {
      const w = padded.slice(i, i + 11);
      if (w === "00001011101") score += 40;
      if (w === "10111010000") score += 40;
    }
  }
  for (let r = 0; r + 1 < n; r++) for (let c = 0; c + 1 < n; c++) if (rows[r][c] === rows[r][c + 1] && rows[r][c] === rows[r + 1][c] && rows[r][c] === rows[r + 1][c + 1]) score += 3;
  const dark = rows.join("").split("1").length - 1;
  const percent = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

test("masque : celui de moindre pénalité (seconde implémentation des règles), le plus petit en cas d'égalité", () => {
  const seen = new Set();
  for (const level of LEVELS) {
    for (const length of [10, 30, 60, 100, 150]) {
      if (length > byteCapacity(10, level)) continue;
      const text = sample(length, length);
      const chosen = encodeQr(text, { level });
      const scores = Array.from({ length: 8 }, (_, mask) => refPenalty(encodeQr(text, { level, mask }).modules));
      assert.deepEqual(chosen.penalties, scores, `pénalités, ${level} ${length}`);
      assert.equal(chosen.mask, scores.indexOf(Math.min(...scores)), `masque, ${level} ${length}`);
      seen.add(chosen.mask);
    }
  }
  assert.ok(seen.size >= 3, "les essais ne retombent pas toujours sur le même masque");
});

// ── Limites ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("limites : le texte juste trop long passe à la version suivante, trop long pour la version 10 est refusé, vide aussi", () => {
  for (const level of LEVELS) {
    for (let v = 1; v < 10; v++) assert.equal(encodeQr(sample(byteCapacity(v, level) + 1), { level }).version, v + 1, `${level} v${v}`);
    assert.throws(() => encodeQr(sample(byteCapacity(10, level) + 1), { level }), /trop long/);
  }
  assert.throws(() => encodeQr(""), /vide/);
  assert.throws(() => encodeQr("x", { level: "H" }), /niveau/);
  assert.throws(() => encodeQr("x", { mask: 8 }), /masque/);
  assert.equal(encodeQr("x").version, 1);
  assert.equal(encodeQr("x").size, 21);
});

// ── SVG ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("SVG : zone de silence de 4 modules, noir sur blanc plein, un seul tracé, texte alternatif échappé, relisible", () => {
  const url = "https://www.example.org/m/short-links/go?c=merch";
  const qr = encodeQr(url, { level: "M" });
  const svg = qrToSvg(qr, { label: 'QR "A" <b>&', pixels: 800 });
  const full = qr.size + 8;
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes(`viewBox="0 0 ${full} ${full}"`), "la zone de silence (4 modules de chaque côté) est dans l'image");
  assert.ok(svg.includes('width="800" height="800"'));
  assert.ok(svg.includes(`<rect width="${full}" height="${full}" fill="#ffffff"/>`), "fond blanc plein, jamais transparent");
  assert.equal([...svg.matchAll(/<path /g)].length, 1, "un seul tracé");
  assert.ok(svg.includes('fill="#000000"'));
  assert.ok(!/opacity|gradient|filter|<script|onload|href=/i.test(svg));
  assert.ok(svg.includes('role="img"') && svg.includes("<title>"));
  assert.ok(svg.includes("QR &quot;A&quot; &lt;b&gt;&amp;") && !svg.includes("<b>"), "le texte alternatif est échappé");
  // chaque module du tracé est dans la zone des données, jamais dans la zone de silence
  for (const m of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, len] = [Number(m[1]), Number(m[2]), Number(m[3])];
    assert.ok(x >= 4 && y >= 4 && x + len <= full - 4 && y < full - 4);
  }
  assert.equal(decodeMatrix(matrixFromSvg(svg)).text, url, "le SVG se relit");
  assert.ok(!/^<svg[^>]* width=/.test(qrToSvg(qr)), "sans taille demandée, l'image s'adapte à son conteneur");
  const open = (svg.match(/</g) ?? []).length;
  assert.equal(open, (svg.match(/>/g) ?? []).length, "balises équilibrées");
});

// ── PNG ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("PNG : signature, sommes de contrôle, 1 bit par pixel, zone de silence blanche, taille exacte, relisible à toutes les échelles", () => {
  const url = "https://www.example.org/m/short-links/go?c=merch";
  for (const level of LEVELS) {
    const qr = encodeQr(url, { level });
    for (const scale of [1, 3, 10, 24]) {
      const png = qrToPng(qr, { scale });
      const { header } = readPng(png);
      assert.equal(header.w, (qr.size + 8) * scale);
      assert.equal(header.depth, 1);
      const read = matrixFromPng(png);
      assert.equal(read.scale, scale);
      assert.equal(decodeMatrix(read.modules).text, url, `échelle ${scale}, niveau ${level}`);
    }
  }
  // IEND en dernier, pHYs à 300 points par pouce
  const png = qrToPng(encodeQr("x"), { scale: 4 });
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString("ascii"), "IEND");
  assert.ok(png.includes(Buffer.from("pHYs")));
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926, "somme de contrôle de référence");
  assert.ok(png.length < 400, "un petit QR code pèse quelques centaines d'octets");
});

test("PNG : la taille visée donne une échelle entière raisonnable", () => {
  const qr = encodeQr("https://www.example.org/m/short-links/go?c=merch", { level: "M" });
  for (const target of [300, 600, 1500]) {
    const scale = scaleFor(qr, target);
    const side = (qr.size + 8) * scale;
    assert.ok(Math.abs(side - target) <= qr.size + 8, `${target} px visés, ${side} obtenus`);
  }
  assert.equal(scaleFor(qr, 1), 1);
  assert.equal(scaleFor(qr, 100000), 40);
});

test("référence PNG : une bibliothèque de lecture d'images relit aussi notre fichier", { skip: (() => { try { return createRequire(path.join(process.cwd(), "package.json"))("pngjs") ? false : true; } catch { return true; } })() ? "pngjs absent" : false }, () => {
  const { PNG } = createRequire(path.join(process.cwd(), "package.json"))("pngjs");
  const qr = encodeQr("https://www.example.org/m/short-links/go?c=merch", { level: "Q" });
  const image = PNG.sync.read(qrToPng(qr, { scale: 5 }));
  assert.equal(image.width, (qr.size + 8) * 5);
  const dark = (x, y) => image.data[(y * image.width + x) * 4] < 128;
  assert.equal(dark(0, 0), false, "coin de la zone de silence : blanc");
  assert.equal(dark(4 * 5 + 2, 4 * 5 + 2), true, "premier module du repère en haut à gauche : noir");
});
