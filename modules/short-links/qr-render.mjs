// Dessin d'un QR code (voir qr.mjs) : SVG propre et PNG, prêts à imprimer.
//
// Règles qui rendent le code lisible partout :
//  - une zone de silence de 4 modules (la norme) autour du code, DANS l'image : posé sur un fond sombre ou sur une affiche colorée,
//    le code garde son cadre blanc ;
//  - noir sur blanc, jamais transparent : le contraste est maximal et ne dépend ni du thème du site ni du papier ;
//  - des modules entiers (pas de coins arrondis, pas de dégradé) ; le SVG est dessiné en un seul tracé, sans flou entre les modules.
import { deflateSync } from "node:zlib";

export const QUIET_ZONE = 4;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * QR code en SVG.
 * @param {{ modules: boolean[][] }} qr         résultat de encodeQr
 * @param {{ label?: string, pixels?: number, quiet?: number }} [options]
 *   `label` : texte alternatif (lu par les lecteurs d'écran), `pixels` : largeur et hauteur (sinon l'image s'adapte à son conteneur)
 */
export function qrToSvg(qr, options = {}) {
  const quiet = options.quiet ?? QUIET_ZONE;
  const n = qr.modules.length;
  const full = n + quiet * 2;
  let path = "";
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules[r][c]) {
        c++;
        continue;
      }
      let end = c;
      while (end < n && qr.modules[r][end]) end++;
      path += `M${c + quiet} ${r + quiet}h${end - c}v1h-${end - c}z`;
      c = end;
    }
  }
  const label = esc(options.label || "QR code");
  const size = options.pixels ? ` width="${Math.round(options.pixels)}" height="${Math.round(options.pixels)}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}"${size} role="img" aria-label="${label}" shape-rendering="crispEdges"><title>${label}</title><rect width="${full}" height="${full}" fill="#ffffff"/><path fill="#000000" d="${path}"/></svg>`;
}

// ── PNG ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Nombre de pixels par module pour que l'image fasse à peu près `target` pixels de côté (au moins 1, au plus 40). */
export function scaleFor(qr, target, quiet = QUIET_ZONE) {
  const full = qr.modules.length + quiet * 2;
  return Math.max(1, Math.min(40, Math.round(target / full)));
}

/**
 * QR code en PNG : noir et blanc sur 1 bit par pixel (quelques centaines d'octets), chaque module fait `scale` × `scale` pixels,
 * zone de silence comprise. Les logiciels d'impression reçoivent aussi la taille physique (300 points par pouce).
 * @returns {Buffer}
 */
export function qrToPng(qr, options = {}) {
  const quiet = options.quiet ?? QUIET_ZONE;
  const scale = Math.max(1, Math.min(40, Math.floor(options.scale ?? 10)));
  const n = qr.modules.length;
  const side = (n + quiet * 2) * scale;
  const rowBytes = Math.ceil(side / 8);
  const raw = Buffer.alloc((rowBytes + 1) * side); // chaque ligne : un octet de filtre (0) puis les pixels ; 1 = blanc
  for (let y = 0; y < side; y++) {
    const module = Math.floor(y / scale) - quiet;
    const base = y * (rowBytes + 1);
    for (let x = 0; x < side; x++) {
      const col = Math.floor(x / scale) - quiet;
      const dark = module >= 0 && module < n && col >= 0 && col < n && qr.modules[module][col];
      if (!dark) raw[base + 1 + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 1; // 1 bit par pixel
  header[9] = 0; // niveaux de gris
  const dpi = Buffer.alloc(9);
  dpi.writeUInt32BE(11811, 0); // 300 points par pouce, en points par mètre
  dpi.writeUInt32BE(11811, 4);
  dpi[8] = 1;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("pHYs", dpi),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
