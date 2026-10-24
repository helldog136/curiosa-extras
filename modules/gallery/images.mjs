// Galeries photos : vérifier et nettoyer une image reçue, SANS aucune bibliothèque (le module n'importe rien du cœur).
//
// Ce que fait `sanitizeImage` d'un fichier envoyé :
//   1. reconnaît le format par le CONTENU (JPEG, PNG ou WebP ; jamais par l'extension ni par le type annoncé) ;
//   2. relit la structure du fichier et en RECONSTRUIT une copie qui ne garde que ce qu'il faut pour afficher l'image :
//      tout le reste (EXIF dont la position GPS, XMP, commentaires, vignette intégrée, profils, texte PNG, données après la fin du fichier…) est ÉCARTÉ ;
//   3. refuse ce qui est abîmé, animé (PNG animé, WebP animé), trop grand (côté ou nombre de pixels) ou trop lourd.
// Rien n'est jamais exécuté : le fichier n'est qu'une suite d'octets lue par des fonctions bornées.
// Le navigateur de la personne qui envoie fait déjà le plus gros du travail (réduction, ré-encodage qui supprime les métadonnées) ;
// ce fichier est la ceinture ET les bretelles côté serveur : il ne fait confiance à aucun navigateur.

const { HARD } = await import(new URL(`./text.mjs${new URL(import.meta.url).search}`, import.meta.url).href);

const MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Le format d'après les premiers octets (ou null). */
export function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return "png";
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

/** Du texte en base64 STRICT vers des octets (ou null). La taille maximale est vérifiée AVANT de décoder. */
export function decodeBase64(text, maxBytes) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (!t || t.length > Math.ceil((maxBytes * 4) / 3) + 8 || t.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(t)) return null;
  const buf = Buffer.from(t, "base64");
  return buf.length > 0 && buf.length <= maxBytes ? buf : null;
}

const fail = (reason) => ({ ok: false, reason });

// ── JPEG ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

function cleanJpeg(buf) {
  const out = [Buffer.from([0xff, 0xd8])];
  let i = 2;
  let width = 0, height = 0, sawFrame = false, sawScan = false, ended = false;
  const n = buf.length;
  while (i < n && !ended) {
    if (buf[i] !== 0xff) return fail("corrupt");
    while (i < n && buf[i] === 0xff) i++; // octets de remplissage
    if (i >= n) return fail("corrupt");
    const m = buf[i++];
    if (m === 0xd9) { ended = true; break; }
    if (m === 0xd8) return fail("corrupt"); // un second début de fichier : pas une photo ordinaire
    if (m === 0x00 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue; // marqueurs sans contenu
    if (i + 2 > n) return fail("corrupt");
    const len = buf.readUInt16BE(i);
    if (len < 2 || i + len > n) return fail("corrupt");
    const seg = buf.subarray(i - 2, i + len); // FF m + longueur + contenu
    const isFrame = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (isFrame) {
      if (len < 8) return fail("corrupt");
      height = buf.readUInt16BE(i + 3);
      width = buf.readUInt16BE(i + 5);
      sawFrame = true;
    }
    if (m === 0xda) { // début des données de l'image : on les copie jusqu'au prochain vrai marqueur
      if (!sawFrame) return fail("corrupt");
      sawScan = true;
      out.push(seg);
      i += len;
      const start = i;
      while (i < n) {
        if (buf[i] === 0xff) {
          const next = buf[i + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { i += 2; continue; }
          if (next === 0xff) { i++; continue; }
          break;
        }
        i++;
      }
      out.push(buf.subarray(start, i));
      continue;
    }
    // On garde les tables et l'en-tête de l'image ; on écarte les blocs d'applications (EXIF, XMP, profils, vignette…) et les commentaires.
    // Seul le bloc « Adobe » (APP14) reste : il dit comment lire les couleurs de certains fichiers.
    const keep = (m >= 0xc0 && m <= 0xcf && m !== 0xc8) || (m >= 0xdb && m <= 0xdf) || m === 0xee;
    if (keep) out.push(seg);
    i += len;
  }
  if (!sawFrame || !sawScan) return fail("corrupt");
  out.push(Buffer.from([0xff, 0xd9]));
  return { ok: true, bytes: Buffer.concat(out), width, height };
}

// ── PNG ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let k = 0; k < 256; k++) { let c = k; for (let b = 0; b < 8; b++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[k] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "bKGD", "hIST"]);

function cleanPng(buf) {
  const out = [buf.subarray(0, 8)];
  let i = 8;
  let width = 0, height = 0, sawData = false, ended = false, first = true;
  const n = buf.length;
  while (i + 12 <= n && !ended) {
    const len = buf.readUInt32BE(i);
    if (len > n - i - 12) return fail("corrupt");
    const type = buf.toString("latin1", i + 4, i + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) return fail("corrupt");
    if (first && (type !== "IHDR" || len !== 13)) return fail("corrupt");
    if (type === "acTL" || type === "fcTL" || type === "fdAT") return fail("animated");
    const whole = buf.subarray(i, i + 12 + len);
    if (PNG_KEEP.has(type)) {
      if (buf.readUInt32BE(i + 8 + len) !== crc32(buf.subarray(i + 4, i + 8 + len))) return fail("corrupt");
      if (type === "IHDR") { width = buf.readUInt32BE(i + 8); height = buf.readUInt32BE(i + 12); }
      if (type === "IDAT") sawData = true;
      out.push(whole);
    }
    first = false;
    if (type === "IEND") ended = true;
    i += 12 + len;
  }
  if (!ended || !sawData || !width || !height) return fail("corrupt");
  return { ok: true, bytes: Buffer.concat(out), width, height };
}

// ── WebP ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

function cleanWebp(buf) {
  const declared = buf.readUInt32LE(4) + 8;
  const end = Math.min(buf.length, declared);
  if (declared < 20) return fail("corrupt");
  const chunks = [];
  let i = 12;
  while (i + 8 <= end) {
    const type = buf.toString("latin1", i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    if (i + 8 + len > end) return fail("corrupt");
    chunks.push({ type, payload: buf.subarray(i + 8, i + 8 + len) });
    i += 8 + len + (len & 1);
  }
  if (chunks.some((c) => c.type === "ANIM" || c.type === "ANMF")) return fail("animated");
  const image = chunks.find((c) => c.type === "VP8 " || c.type === "VP8L");
  if (!image) return fail("corrupt");
  const head = chunks.find((c) => c.type === "VP8X");
  const alph = chunks.find((c) => c.type === "ALPH");
  let width = 0, height = 0;
  if (head) {
    if (head.payload.length < 10) return fail("corrupt");
    if (head.payload[0] & 0x02) return fail("animated");
    width = 1 + head.payload.readUIntLE(4, 3);
    height = 1 + head.payload.readUIntLE(7, 3);
  } else if (image.type === "VP8 ") {
    const p = image.payload;
    if (p.length < 10 || p[3] !== 0x9d || p[4] !== 0x01 || p[5] !== 0x2a) return fail("corrupt");
    width = p.readUInt16LE(6) & 0x3fff;
    height = p.readUInt16LE(8) & 0x3fff;
  } else {
    const p = image.payload;
    if (p.length < 5 || p[0] !== 0x2f) return fail("corrupt");
    const bits = p.readUInt32LE(1);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  }
  const keep = [];
  const hasAlpha = !!(head && head.payload[0] & 0x10);
  if (head && (alph || hasAlpha)) { // l'en-tête étendu ne sert que pour la transparence : on retire les drapeaux ICC, EXIF, XMP
    const payload = Buffer.from(head.payload);
    payload[0] = payload[0] & 0x10;
    keep.push({ type: "VP8X", payload });
  }
  if (alph) keep.push(alph);
  keep.push(image);
  const body = Buffer.concat(keep.map((c) => {
    const header = Buffer.alloc(8);
    header.write(c.type, 0, "latin1");
    header.writeUInt32LE(c.payload.length, 4);
    return Buffer.concat([header, c.payload, c.payload.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  }));
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write("WEBP", 8, "latin1");
  return { ok: true, bytes: Buffer.concat([riff, body]), width, height };
}

// ── Le point d'entrée ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Vérifie et nettoie une image. `limits` : { maxBytes, maxSide, maxPixels }.
 * Succès : { ok: true, kind, mime, bytes (Buffer nettoyé), width, height, stripped (octets écartés) }.
 * Échec : { ok: false, reason } avec reason ∈ type | corrupt | animated | toolarge | dimensions.
 */
export function sanitizeImage(input, limits = {}) {
  let buf;
  try { buf = Buffer.isBuffer(input) ? input : input instanceof Uint8Array || Array.isArray(input) ? Buffer.from(input) : null; } catch { buf = null; }
  if (!buf) return fail("type");
  const maxBytes = limits.maxBytes ?? HARD.photoBytes;
  const maxSide = limits.maxSide ?? HARD.side;
  const maxPixels = limits.maxPixels ?? HARD.pixels;
  if (buf.length > maxBytes) return fail("toolarge");
  const kind = sniff(buf);
  if (!kind) return fail("type");
  let r;
  try { r = kind === "jpeg" ? cleanJpeg(buf) : kind === "png" ? cleanPng(buf) : cleanWebp(buf); } catch { return fail("corrupt"); }
  if (!r.ok) return r;
  if (!(r.width >= 1 && r.height >= 1) || r.width > maxSide || r.height > maxSide || r.width * r.height > maxPixels) return fail("dimensions");
  if (r.bytes.length > maxBytes) return fail("toolarge");
  return { ok: true, kind, mime: MIME[kind], bytes: r.bytes, width: r.width, height: r.height, stripped: Math.max(0, buf.length - r.bytes.length) };
}
