// Un petit « emballeur » de fichier MP4 (H.264) : il reçoit les images déjà compressées (celles de l'encodeur du navigateur) et écrit le fichier que lit Instagram.
// Pas de bibliothèque : ~200 lignes, sans aucune dépendance, exécutées telles quelles par le navigateur et par les tests.
// Fichier « à plat » : ftyp, moov (l'index) PUIS mdat (les images) : il se lit dès le début, sans rien attendre.
// Entrées : width, height, fps, frames[{ data (Uint8Array, une image sans en-tête de début de code : 4 octets de longueur devant chaque unité), timestamp (µs, ordre d'affichage), key (image clé) }]
//   dans l'ORDRE DE CODAGE, et description (l'enregistrement « avcC » donné par l'encodeur).

const TIMESCALE = 90000;
const u8 = (...a) => Uint8Array.from(a);
const be32 = (n) => u8((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const be16 = (n) => u8((n >>> 8) & 255, n & 255);
const str = (s) => u8(...[...s].map((c) => c.charCodeAt(0)));
const zeros = (n) => new Uint8Array(n);
function cat(parts) {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const box = (type, ...parts) => { const body = cat(parts); return cat([be32(8 + body.length), str(type), body]); };
const full = (type, version, flags, ...parts) => box(type, u8(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...parts);
const fixed1616 = (n) => be32(Math.round(n * 65536));

/** Les unités « Annex B » (00 00 01 / 00 00 00 01) d'un flux → liste de morceaux (sans les codes de début). */
export function splitAnnexB(bytes) {
  const out = []; let start = -1;
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      if (start >= 0) { let end = i; while (end > start && bytes[end - 1] === 0) end--; out.push(bytes.subarray(start, end)); }
      start = i + 3; i += 2;
    }
  }
  if (start >= 0) out.push(bytes.subarray(start));
  return out;
}
/** L'enregistrement avcC (profil, niveau, SPS, PPS) à partir des unités d'un flux Annex B. Rend null s'il manque l'un des deux. */
export function avcCFromAnnexB(units) {
  const sps = units.find((n) => n.length && (n[0] & 31) === 7), pps = units.find((n) => n.length && (n[0] & 31) === 8);
  if (!sps || !pps || sps.length < 4) return null;
  return cat([u8(1, sps[1], sps[2], sps[3], 0xff, 0xe1), be16(sps.length), sps, u8(1), be16(pps.length), pps]);
}
/** Une image en Annex B → une image « avc » (longueur de 4 octets devant chaque unité ; sans SPS, PPS ni séparateur : ils sont dans l'avcC). */
export function annexBToAvc(bytes) {
  const keep = splitAnnexB(bytes).filter((n) => n.length && ![7, 8, 9].includes(n[0] & 31));
  return cat(keep.flatMap((n) => [be32(n.length), n]));
}
/** Profil et niveau lus dans un avcC : { profile, compat, level } (pour les messages et les tests). */
export function readAvcC(desc) {
  const d = desc instanceof Uint8Array ? desc : new Uint8Array(desc);
  if (d.length < 7 || d[0] !== 1) return null;
  return { profile: d[1], compat: d[2], level: d[3] };
}

/** Le fichier MP4, en un seul tableau d'octets. Lève une erreur claire si l'entrée est inutilisable. */
export function muxMp4({ width, height, fps = 30, frames, description, creationTime = 0 }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16) throw new Error("size");
  if (!Array.isArray(frames) || !frames.length) throw new Error("no_frames");
  const avcC = description instanceof Uint8Array ? description : description ? new Uint8Array(description) : null;
  if (!avcC || avcC.length < 8 || avcC[0] !== 1) throw new Error("no_description");
  const n = frames.length, step = Math.round(TIMESCALE / fps);
  const dts = frames.map((_, i) => i * step);
  const pts = frames.map((f) => Math.round((f.timestamp * TIMESCALE) / 1e6));
  const minOff = Math.min(...pts.map((p, i) => p - dts[i])), shift = Math.max(0, -minOff);
  const off = pts.map((p, i) => p - dts[i] + shift);
  const reordered = off.some((o) => o !== shift) ;
  const mediaDuration = n * step, movieMs = Math.round((mediaDuration * 1000) / TIMESCALE);
  const sizes = frames.map((f) => f.data.length);
  const CHUNK = Math.max(1, Math.round(fps));
  const chunks = []; for (let i = 0; i < n; i += CHUNK) chunks.push({ first: i, count: Math.min(CHUNK, n - i) });
  const ftyp = box("ftyp", str("isom"), be32(512), str("isom"), str("iso2"), str("avc1"), str("mp41"));

  const entries = (list) => cat(list);
  const buildMoov = (mdatStart) => {
    // chunk offsets (absolute)
    const offsets = []; let pos = mdatStart;
    for (const c of chunks) { offsets.push(pos); for (let i = c.first; i < c.first + c.count; i++) pos += sizes[i]; }
    const avc1 = box("avc1", zeros(6), be16(1), zeros(16), be16(width), be16(height), be32(0x00480000), be32(0x00480000), zeros(4), be16(1), zeros(32), be16(0x18), u8(0xff, 0xff), box("avcC", avcC));
    const stsd = full("stsd", 0, 0, be32(1), avc1);
    const stts = full("stts", 0, 0, be32(1), be32(n), be32(step));
    const ctts = reordered ? full("ctts", 0, 0, be32(n), entries(off.flatMap((o) => [be32(1), be32(o)]))) : null;
    const keys = frames.flatMap((f, i) => (f.key ? [i + 1] : []));
    const stss = full("stss", 0, 0, be32(keys.length), entries(keys.map(be32)));
    const stsc = full("stsc", 0, 0, be32(chunks.length > 1 && chunks[chunks.length - 1].count !== CHUNK ? 2 : 1), be32(1), be32(chunks[0].count), be32(1), ...(chunks.length > 1 && chunks[chunks.length - 1].count !== CHUNK ? [be32(chunks.length), be32(chunks[chunks.length - 1].count), be32(1)] : []));
    const stsz = full("stsz", 0, 0, be32(0), be32(n), entries(sizes.map(be32)));
    const stco = full("stco", 0, 0, be32(offsets.length), entries(offsets.map(be32)));
    const stbl = box("stbl", stsd, stts, ...(ctts ? [ctts] : []), stss, stsc, stsz, stco);
    const minf = box("minf", full("vmhd", 0, 1, zeros(8)), box("dinf", full("dref", 0, 0, be32(1), full("url ", 0, 1))), stbl);
    const mdhd = full("mdhd", 0, 0, be32(creationTime), be32(creationTime), be32(TIMESCALE), be32(mediaDuration), be16(0x55c4), be16(0));
    const hdlr = full("hdlr", 0, 0, be32(0), str("vide"), zeros(12), str("VideoHandler"), u8(0));
    const mdia = box("mdia", mdhd, hdlr, minf);
    const matrix = cat([be32(0x10000), be32(0), be32(0), be32(0), be32(0x10000), be32(0), be32(0), be32(0), be32(0x40000000)]);
    const tkhd = full("tkhd", 0, 3, be32(creationTime), be32(creationTime), be32(1), be32(0), be32(movieMs), zeros(8), be16(0), be16(0), be16(0), be16(0), matrix, fixed1616(width), fixed1616(height));
    // liste d'édition : seulement si l'ordre d'affichage décale les images (le début de la vidéo reste alors à zéro)
    const edts = shift > 0 ? box("edts", full("elst", 0, 0, be32(1), be32(movieMs), be32(shift), be16(1), be16(0))) : null;
    const trak = box("trak", tkhd, ...(edts ? [edts] : []), mdia);
    const mvhd = full("mvhd", 0, 0, be32(creationTime), be32(creationTime), be32(1000), be32(movieMs), fixed1616(1), be16(0x0100), be16(0), zeros(8), matrix, zeros(24), be32(2));
    return box("moov", mvhd, trak);
  };
  const first = buildMoov(0), mdatStart = ftyp.length + first.length + 8;
  const moov = buildMoov(mdatStart);
  const mdatSize = 8 + sizes.reduce((a, b) => a + b, 0);
  if (mdatSize > 0xffffffff) throw new Error("too_big");
  return cat([ftyp, moov, be32(mdatSize), str("mdat"), ...frames.map((f) => f.data)]);
}
