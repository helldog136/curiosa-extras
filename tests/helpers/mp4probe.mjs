// Un petit analyseur de fichier MP4 pour les tests : lit la structure (boîtes ftyp / moov / mdat, avcC, durée, nombre d'images, index des images) sans rien décoder.
// Sert à vérifier un fichier produit par « Story d'annonce » même quand ni ffprobe ni lecteur vidéo n'est disponible.
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const tag = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "dinf", "edts"]);

/** Liste plate des boîtes : [{ type, start, size, depth, path }]. */
export function boxes(bytes, start = 0, end = bytes.length, depth = 0, path = "") {
  const out = [];
  let o = start;
  while (o + 8 <= end) {
    const size = u32(bytes, o), type = tag(bytes, o + 4);
    if (size < 8 || o + size > end) throw new Error(`boîte ${type} invalide à ${o} (taille ${size})`);
    out.push({ type, start: o, size, depth, path: `${path}/${type}` });
    if (CONTAINERS.has(type)) out.push(...boxes(bytes, o + 8, o + size, depth + 1, `${path}/${type}`));
    o += size;
  }
  if (o !== end && depth === 0) throw new Error("octets en trop à la fin du fichier");
  return out;
}

/** { topLevel, brand, width, height, timescale, duration (s), frames, keyFrames, sampleSizes, offsets, codec: { type, profile, level }, hasCtts, hasElst, moovBeforeMdat, mdat: { start, size } } */
export function probeMp4(bytes) {
  const all = boxes(bytes), top = all.filter((b) => b.depth === 0);
  const find = (p) => all.find((b) => b.path === p);
  const need = (p) => { const b = find(p); if (!b) throw new Error(`boîte absente : ${p}`); return b; };
  const ftyp = need("/ftyp"), moov = need("/moov"), mdat = need("/mdat");
  const mdhd = need("/moov/trak/mdia/mdhd"), mvhd = need("/moov/trak/../mvhd".replace("/trak/..", ""));
  const timescale = u32(bytes, mdhd.start + 20), mediaDuration = u32(bytes, mdhd.start + 24);
  const stsz = need("/moov/trak/mdia/minf/stbl/stsz"), n = u32(bytes, stsz.start + 16);
  const sizes = Array.from({ length: n }, (_, i) => u32(bytes, stsz.start + 20 + i * 4));
  const stss = need("/moov/trak/mdia/minf/stbl/stss"), nk = u32(bytes, stss.start + 12);
  const keyFrames = Array.from({ length: nk }, (_, i) => u32(bytes, stss.start + 16 + i * 4));
  const stco = need("/moov/trak/mdia/minf/stbl/stco"), nc = u32(bytes, stco.start + 12);
  const offsets = Array.from({ length: nc }, (_, i) => u32(bytes, stco.start + 16 + i * 4));
  const avc1 = need("/moov/trak/mdia/minf/stbl/stsd").start + 16;   // début de l'entrée d'échantillon
  const sample = { type: tag(bytes, avc1 + 4), width: u16(bytes, avc1 + 8 + 24), height: u16(bytes, avc1 + 8 + 26) };
  // la boîte avcC est dans l'entrée d'échantillon (après 78 octets d'en-tête)
  let o = avc1 + 8 + 78, avcC = null;
  while (o + 8 <= avc1 + u32(bytes, avc1)) { if (tag(bytes, o + 4) === "avcC") { avcC = { profile: bytes[o + 9], level: bytes[o + 11], size: u32(bytes, o) }; break; } o += u32(bytes, o); }
  const mvhdDur = u32(bytes, mvhd.start + 24), mvTimescale = u32(bytes, mvhd.start + 20);
  return {
    topLevel: top.map((b) => b.type), brand: tag(bytes, ftyp.start + 8), moovBeforeMdat: moov.start < mdat.start,
    width: sample.width, height: sample.height, timescale, duration: mediaDuration / timescale, movieDuration: mvhdDur / mvTimescale,
    frames: n, keyFrames, sampleSizes: sizes, offsets, codec: { type: sample.type, ...(avcC ?? {}) }, hasCtts: !!find("/moov/trak/mdia/minf/stbl/ctts"), hasElst: !!find("/moov/trak/edts/elst"),
    mdat: { start: mdat.start, size: u32(bytes, mdat.start) }, bytes: bytes.length,
  };
}
