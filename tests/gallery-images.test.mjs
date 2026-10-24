// Galeries photos : vérifier et nettoyer une image reçue (type par le contenu, informations cachées retirées, refus des fichiers abîmés, animés ou trop grands).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { IMAGES, images } from "./helpers/galleryKit.mjs";

const { sanitizeImage, sniff, decodeBase64 } = images;
const has = (buf, s) => buf.includes(Buffer.from(s));

// Le moteur d'images du cœur (s'il est là) sert à vérifier que le fichier nettoyé est toujours une vraie image ; sinon on saute ces vérifications.
let sharp = null;
try { sharp = createRequire(`${process.cwd()}/package.json`)("sharp"); } catch { /* pas de moteur : vérifications de structure seulement */ }
const decodes = async (buf, w, h) => {
  if (!sharp) return;
  const meta = await sharp(buf).metadata();
  assert.deepEqual([meta.width, meta.height], [w, h]);
  await sharp(buf).raw().toBuffer(); // décode tous les pixels : lève si le fichier est abîmé
};

const crc = (() => {
  const t = new Uint32Array(256);
  for (let k = 0; k < 256; k++) { let c = k; for (let b = 0; b < 8; b++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[k] = c >>> 0; }
  return (buf) => { let c = 0xffffffff; for (const x of buf) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();
/** Insère un bloc PNG juste après l'en-tête. */
function pngWith(buf, type, payload) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), payload]);
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc(body), 8 + payload.length);
  return Buffer.concat([buf.subarray(0, 33), chunk, buf.subarray(33)]);
}

test("le type se reconnaît au CONTENU, jamais au nom ni au type annoncé", () => {
  assert.equal(sniff(IMAGES.jpegPlain), "jpeg");
  assert.equal(sniff(IMAGES.png), "png");
  assert.equal(sniff(IMAGES.webpPlain), "webp");
  assert.equal(sniff(IMAGES.gif), null);
  assert.equal(sniff(Buffer.from("<html><script>alert(1)</script></html>")), null);
  assert.equal(sniff(Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff")), null);
  assert.equal(sniff(Buffer.alloc(0)), null);
});

test("JPEG : l'EXIF (appareil, droits, position GPS) est retiré, l'image reste lisible et de même taille", async () => {
  assert.ok(has(IMAGES.jpegGps, "Exif") && has(IMAGES.jpegGps, "SecretCam") && has(IMAGES.jpegGps, "Jane Doe"), "le fichier d'essai porte bien des informations cachées");
  const r = sanitizeImage(IMAGES.jpegGps);
  assert.equal(r.ok, true);
  assert.equal(r.kind, "jpeg");
  assert.equal(r.mime, "image/jpeg");
  assert.deepEqual([r.width, r.height], [16, 12]);
  for (const secret of ["Exif", "SecretCam", "Jane Doe", "GPS"]) assert.equal(has(r.bytes, secret), false, `« ${secret} » doit avoir disparu`);
  assert.ok(r.stripped > 0 && r.bytes.length < IMAGES.jpegGps.length);
  assert.deepEqual([r.bytes[0], r.bytes[1], r.bytes.at(-2), r.bytes.at(-1)], [0xff, 0xd8, 0xff, 0xd9]);
  await decodes(r.bytes, 16, 12);
});

test("JPEG : commentaires, blocs d'application et octets ajoutés après la fin du fichier sont écartés", async () => {
  const j = IMAGES.jpegPlain;
  const com = Buffer.from([0xff, 0xfe, 0x00, 0x0b, ...Buffer.from("secret!!!")]);
  const app13 = Buffer.from([0xff, 0xed, 0x00, 0x0a, ...Buffer.from("photoshp")]);
  const dirty = Buffer.concat([j.subarray(0, 2), com, app13, j.subarray(2), Buffer.from("PAYLOAD-APRES-LA-FIN")]);
  const r = sanitizeImage(dirty);
  assert.equal(r.ok, true);
  for (const s of ["secret!!!", "photoshp", "PAYLOAD"]) assert.equal(has(r.bytes, s), false, s);
  await decodes(r.bytes, 32, 24);
});

test("PNG : texte, EXIF, date et octets ajoutés après la fin sont retirés ; les pixels restent", async () => {
  const dirty = Buffer.concat([pngWith(pngWith(IMAGES.png, "tEXt", Buffer.from("Comment\0position 50.85,4.35")), "eXIf", Buffer.from("SecretCam")), Buffer.from("TRAILING")]);
  const r = sanitizeImage(dirty);
  assert.equal(r.ok, true);
  assert.equal(r.kind, "png");
  for (const s of ["tEXt", "eXIf", "position", "SecretCam", "TRAILING"]) assert.equal(has(r.bytes, s), false, s);
  await decodes(r.bytes, 8, 8);
});

test("WebP : EXIF et métadonnées retirés, l'image reste lisible", async () => {
  assert.ok(has(IMAGES.webpExif, "EXIF") && has(IMAGES.webpExif, "SecretCam"));
  const r = sanitizeImage(IMAGES.webpExif);
  assert.equal(r.ok, true);
  assert.equal(r.kind, "webp");
  for (const s of ["EXIF", "SecretCam", "Jane Doe", "XMP "]) assert.equal(has(r.bytes, s), false, s);
  assert.equal(r.bytes.readUInt32LE(4) + 8, r.bytes.length, "la taille annoncée par l'en-tête est juste");
  await decodes(r.bytes, 16, 16);
  const plain = sanitizeImage(IMAGES.webpPlain);
  assert.equal(plain.ok, true);
  await decodes(plain.bytes, 16, 16);
});

test("refus : image animée, GIF, texte déguisé, fichier tronqué, bloc PNG abîmé", () => {
  assert.deepEqual(sanitizeImage(IMAGES.webpAnim), { ok: false, reason: "animated" });
  assert.equal(sanitizeImage(IMAGES.gif).reason, "type");
  assert.equal(sanitizeImage(Buffer.from("<script>alert(1)</script>............")).reason, "type");
  assert.equal(sanitizeImage(IMAGES.jpegPlain.subarray(0, 60)).reason, "corrupt");
  assert.equal(sanitizeImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0xff, 0xd9])])).reason, "corrupt", "pas d'image dedans");
  const bad = Buffer.from(IMAGES.png);
  bad[bad.length - 20] ^= 0xff; // un octet change dans les données : la somme de contrôle ne correspond plus
  assert.equal(sanitizeImage(bad).reason, "corrupt");
  const apng = pngWith(IMAGES.png, "acTL", Buffer.from([0, 0, 0, 2, 0, 0, 0, 0]));
  assert.equal(sanitizeImage(apng).reason, "animated");
  assert.equal(sanitizeImage(IMAGES.webpAnim.subarray(0, 40)).ok, false);
});

test("bornes : poids, plus grand côté et nombre de pixels", () => {
  assert.equal(sanitizeImage(IMAGES.jpegGps, { maxBytes: 100 }).reason, "toolarge");
  assert.equal(sanitizeImage(IMAGES.jpegPlain, { maxSide: 20 }).reason, "dimensions");
  assert.equal(sanitizeImage(IMAGES.jpegPlain, { maxPixels: 100 }).reason, "dimensions");
  assert.equal(sanitizeImage(IMAGES.jpegPlain, { maxSide: 32, maxPixels: 768 }).ok, true);
});

test("jamais d'exception, quel que soit le fichier : entrées abîmées au hasard (reproductibles)", () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (const base of [IMAGES.jpegGps, IMAGES.png, IMAGES.webpExif, IMAGES.webpAnim, IMAGES.jpegPlain]) {
    for (let i = 0; i < 300; i++) {
      const buf = Buffer.from(base);
      const flips = 1 + Math.floor(rnd() * 6);
      for (let k = 0; k < flips; k++) buf[Math.floor(rnd() * buf.length)] = Math.floor(rnd() * 256);
      const cut = rnd() < 0.3 ? buf.subarray(0, Math.floor(rnd() * buf.length)) : buf;
      const r = sanitizeImage(cut);
      assert.equal(typeof r.ok, "boolean");
      if (r.ok) assert.ok(Buffer.isBuffer(r.bytes) && r.width >= 1 && r.height >= 1);
    }
  }
  for (const odd of [undefined, null, "texte", 42, [], {}, Buffer.alloc(3), new Uint8Array(40)]) assert.equal(sanitizeImage(odd).ok, false);
});

test("base64 : strict (alphabet, longueur, taille vérifiée AVANT de décoder)", () => {
  const ok = IMAGES.jpegPlain.toString("base64");
  assert.ok(decodeBase64(ok, 100_000).equals(IMAGES.jpegPlain));
  assert.equal(decodeBase64(ok, 10), null, "trop gros");
  assert.equal(decodeBase64(`${ok}!`, 100_000), null);
  assert.equal(decodeBase64(ok.slice(1), 100_000), null, "longueur qui n'est pas un multiple de 4");
  assert.equal(decodeBase64("data:image/jpeg;base64," + ok, 100_000), null);
  assert.equal(decodeBase64("", 10), null);
  assert.equal(decodeBase64(null, 10), null);
  assert.equal(decodeBase64("A".repeat(10_000_000), 1000), null, "refusé sans rien décoder");
});
