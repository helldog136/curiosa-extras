// Story d'annonce 1.0.0 — de l'animation au fichier : l'emballeur MP4 (essayé avec de VRAIES images H.264 produites par ffmpeg, relues par ffprobe et décodées par ffmpeg),
// la chaîne de rendu (image par image → encodeur → MP4) avec un encodeur factice qui rend ces vraies images, les repli et les erreurs.
// Le vrai encodeur H.264 du navigateur n'est pas dans ce bac à sable : il est vérifié à la main dans Chrome ou Safari (voir CHANGELOG du dépôt).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fakeCanvasContext, fakeImage } from "./helpers/fakeCanvas.mjs";
import { probeMp4, boxes } from "./helpers/mp4probe.mjs";

const mp4 = await import("../modules/stream-story/mp4.mjs");
const enc = await import("../modules/stream-story/encode.mjs");
const P = await import("../modules/stream-story/pure.mjs");
const S = await import("../modules/stream-story/scenes.mjs");

const has = (cmd) => spawnSync(cmd, ["-version"]).status === 0;
const FFMPEG = has("ffmpeg") && has("ffprobe");
const needs = { skip: FFMPEG ? false : "ffmpeg et ffprobe ne sont pas installés sur cette machine : l'analyseur de structure (mp4probe) reste vérifié ailleurs" };
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "story-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28 }); if (r.status !== 0) throw new Error(`${cmd} : ${String(r.stderr).slice(0, 300)}`); return r.stdout; };

/** De vraies images H.264 (x264) : { units (tout le flux), aus [[unités]] dans l'ordre de codage, pts (µs, ordre d'affichage) }. */
function h264({ w, h, seconds, bf = 0, name }) {
  const ref = path.join(tmp, `${name}.mp4`), raw = path.join(tmp, `${name}.h264`);
  sh("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc=size=${w}x${h}:rate=30`, "-t", String(seconds), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.0", "-bf", String(bf), "-x264-params", "aud=1:keyint=30", ref]);
  sh("ffmpeg", ["-v", "error", "-y", "-i", ref, "-c", "copy", "-bsf:v", "h264_mp4toannexb", "-f", "h264", raw]);
  const packets = JSON.parse(sh("ffprobe", ["-v", "error", "-show_packets", "-select_streams", "v", "-of", "json", ref])).packets;
  const units = mp4.splitAnnexB(new Uint8Array(fs.readFileSync(raw)));
  const aus = []; let cur = [];
  for (const u of units) { if ((u[0] & 31) === 9 && cur.length) { aus.push(cur); cur = []; } cur.push(u); }
  aus.push(cur);
  const real = aus.filter((au) => au.some((u) => [1, 5].includes(u[0] & 31)));
  assert.equal(real.length, packets.length, "autant d'images que de paquets");
  const annexB = (au) => Uint8Array.from(au.flatMap((u) => [0, 0, 0, 1, ...u]));
  return { units, aus: real, annexB, pts: packets.map((p) => Math.round(Number(p.pts_time) * 1e6)), avcC: mp4.avcCFromAnnexB(units) };
}
const framesOf = (v, { avc = true } = {}) => v.aus.map((au, i) => ({ data: avc ? mp4.annexBToAvc(v.annexB(au)) : v.annexB(au), timestamp: v.pts[i], key: au.some((u) => (u[0] & 31) === 5) }));
const probeFile = (file) => JSON.parse(sh("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=codec_name,profile,level,width,height,pix_fmt,nb_read_frames,r_frame_rate,duration,nb_frames:format=duration,format_name", "-of", "json", file]));
const decodes = (file) => { const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"], { encoding: "utf8" }); return r.status === 0 && !String(r.stderr).trim(); };

/* ───────────── L'emballeur ───────────── */

test("MP4 : de vraies images H.264 1080×1920 sont emballées en un fichier que ffprobe lit (h264 High 4.0, 30 i/s, durée exacte) et que ffmpeg décode sans erreur", needs, () => {
  const v = h264({ w: 1080, h: 1920, seconds: 4, name: "a" });
  const out = mp4.muxMp4({ width: 1080, height: 1920, fps: 30, frames: framesOf(v), description: v.avcC });
  const file = path.join(tmp, "a-out.mp4"); fs.writeFileSync(file, out);
  const pr = probeFile(file), st = pr.streams[0];
  assert.deepEqual([st.codec_name, st.profile, st.level, st.width, st.height, st.pix_fmt, st.r_frame_rate], ["h264", "High", 40, 1080, 1920, "yuv420p", "30/1"]);
  assert.equal(Number(st.nb_read_frames), 120); assert.equal(Number(st.nb_frames), 120);
  assert.equal(Number(pr.format.duration).toFixed(3), "4.000");
  assert.ok(decodes(file), "ffmpeg décode tout le fichier sans erreur");
  assert.ok(pr.format.format_name.includes("mp4"));
  const info = probeMp4(out);
  assert.deepEqual(info.topLevel, ["ftyp", "moov", "mdat"], "à plat : l'index avant les images (lisible dès le début)");
  assert.equal(info.brand, "isom"); assert.equal(info.moovBeforeMdat, true);
  assert.deepEqual([info.width, info.height, info.frames, info.timescale, info.duration, info.movieDuration], [1080, 1920, 120, 90000, 4, 4]);
  assert.deepEqual(info.codec, { type: "avc1", profile: 100, level: 40, size: v.avcC.length + 8 });
  assert.deepEqual(info.keyFrames, [1, 31, 61, 91], "une image clé par seconde");
  assert.equal(info.hasCtts, false); assert.equal(info.hasElst, false);
  // chaque morceau d'images est dans le mdat, et les tailles font exactement la taille du mdat
  assert.equal(info.sampleSizes.reduce((a, b) => a + b, 0), info.mdat.size - 8);
  for (const o of info.offsets) assert.ok(o >= info.mdat.start + 8 && o < info.mdat.start + info.mdat.size);
  assert.equal(info.offsets[0], info.mdat.start + 8, "le premier morceau commence au début du mdat");
  assert.equal(info.bytes, info.mdat.start + info.mdat.size, "aucun octet en trop");
});

test("MP4 : un encodeur qui réordonne les images (B-frames) : temps d'affichage conservés (ctts + liste d'édition), le fichier se décode et la durée reste exacte", needs, () => {
  const v = h264({ w: 320, h: 568, seconds: 3, bf: 3, name: "b" });
  assert.ok(v.pts.some((p, i) => i && p < v.pts[i - 1]), "le flux est bien réordonné");
  const out = mp4.muxMp4({ width: 320, height: 568, fps: 30, frames: framesOf(v), description: v.avcC });
  const file = path.join(tmp, "b-out.mp4"); fs.writeFileSync(file, out);
  const info = probeMp4(out);
  assert.equal(info.hasCtts, true); assert.equal(info.hasElst, true);
  assert.ok(decodes(file));
  const pr = probeFile(file);
  assert.equal(Number(pr.streams[0].nb_read_frames), 90); assert.equal(Number(pr.format.duration).toFixed(2), "3.00");
  const shown = sh("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "frame=pts_time", "-of", "csv=p=0", file]).trim().split("\n").map(Number).sort((a, b) => a - b);
  assert.equal(shown.length, 90); assert.ok(Math.abs(shown[0]) < 1e-6, "la première image s'affiche à 0"); assert.ok(Math.abs(shown[89] - 89 / 30) < 1e-3, "la dernière à 2,967 s");
});

test("MP4 : les images « Annex B » (un navigateur sans description) sont converties : avcC refabriqué, SPS/PPS retirés des images, fichier identique en effet", needs, () => {
  const v = h264({ w: 320, h: 568, seconds: 2, name: "c" });
  assert.deepEqual(Array.from(v.avcC.subarray(0, 4)), [1, 100, 0, 40]);
  const one = mp4.annexBToAvc(v.annexB(v.aus[0]));
  let o = 0; const types = [];
  while (o < one.length) { const n = (one[o] << 24) | (one[o + 1] << 16) | (one[o + 2] << 8) | one[o + 3]; types.push(one[o + 4] & 31); o += 4 + n; }
  assert.equal(o, one.length); assert.ok(!types.some((t) => [7, 8, 9].includes(t)) && types.includes(5), `types ${types}`);
  assert.deepEqual(mp4.readAvcC(v.avcC), { profile: 100, compat: 0, level: 40 });
  assert.equal(mp4.readAvcC(new Uint8Array([2, 0, 0, 0, 0, 0, 0])), null);
  assert.equal(mp4.avcCFromAnnexB([new Uint8Array([0x65, 1, 2, 3])]), null, "sans SPS ni PPS : pas d'avcC");
});

test("MP4 : entrées inutilisables refusées par une erreur claire (aucune image, taille absurde, description absente) ; le fichier est reproductible (mêmes octets)", () => {
  const frame = { data: new Uint8Array([0, 0, 0, 2, 0x65, 1]), timestamp: 0, key: true }, desc = new Uint8Array([1, 100, 0, 40, 255, 225, 0, 4, 0x67, 100, 0, 40, 1, 0, 1, 0x68]);
  assert.throws(() => mp4.muxMp4({ width: 1080, height: 1920, frames: [], description: desc }), /no_frames/);
  assert.throws(() => mp4.muxMp4({ width: 0, height: 1920, frames: [frame], description: desc }), /size/);
  assert.throws(() => mp4.muxMp4({ width: 1080, height: 1920, frames: [frame], description: null }), /no_description/);
  assert.throws(() => mp4.muxMp4({ width: 1080, height: 1920, frames: [frame], description: new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9]) }), /no_description/);
  const a = mp4.muxMp4({ width: 1080, height: 1920, frames: [frame, { ...frame, timestamp: 33333, key: false }], description: desc }), b = mp4.muxMp4({ width: 1080, height: 1920, frames: [frame, { ...frame, timestamp: 33333, key: false }], description: desc });
  assert.deepEqual(a, b);
  assert.ok(boxes(a).length > 10);
  assert.throws(() => probeMp4(new Uint8Array([0, 0, 0, 4, 1, 2, 3, 4])), /invalide/);
});

/* ───────────── La chaîne de rendu, avec un encodeur factice ───────────── */

function fakeEnv({ v, avc = true, queue = 0, failAt = -1, hangFlush = false, supported = true, record = null } = {}) {
  const st = { frames: 0, closed: 0, keyFrames: [], maxQueue: 0, configured: null, encoderClosed: false, timestamps: [], sizes: [] };
  class Canvas { constructor(w, h) { this.width = w; this.height = h; } getContext() { return fakeCanvasContext(); } }
  class Frame { constructor(source, init) { st.sizes.push([source.width, source.height]); this.timestamp = init.timestamp; this.duration = init.duration; st.frames++; } close() { st.closed++; } }
  class Encoder {
    static async isConfigSupported(c) { return { supported: supported && c.codec.startsWith("avc1"), config: c }; }
    constructor({ output, error }) { this.output = output; this.error = error; this.n = 0; this.pending = 0; }
    configure(c) { st.configured = c; }
    get encodeQueueSize() { return this.pending; }
    encode(frame, opts) {
      const i = this.n++; st.keyFrames.push(!!opts?.keyFrame); st.timestamps.push(frame.timestamp);
      if (i === failAt) { setTimeout(() => this.error(new Error("encodeur en panne")), 0); return; }
      this.pending += queue; st.maxQueue = Math.max(st.maxQueue, this.pending);
      setTimeout(() => { this.pending = Math.max(0, this.pending - queue); const f = v.aus[i], data = avc ? mp4.annexBToAvc(v.annexB(f)) : v.annexB(f), key = f.some((u) => (u[0] & 31) === 5); this.output({ type: key ? "key" : "delta", timestamp: frame.timestamp, byteLength: data.length, copyTo: (b) => b.set(data) }, avc && i === 0 ? { decoderConfig: { description: v.avcC.buffer.slice(v.avcC.byteOffset, v.avcC.byteOffset + v.avcC.byteLength) } } : {}); }, 0);
    }
    flush() { return hangFlush ? new Promise(() => {}) : new Promise((r) => setTimeout(r, 5)); }
    close() { st.encoderClosed = true; }
  }
  return { st, env: { VideoEncoder: Encoder, VideoFrame: Frame, OffscreenCanvas: Canvas, setTimeout: (fn, ms) => setTimeout(fn, 0) } };
}
const smallScene = (duration = 5, format = "vertical") => S.createScene({ style: "minimal", format, duration, content: P.buildContent(P.DEFAULT_CONFIG, { stream: { title: "Soirée", startMs: Date.parse("2026-10-22T17:30:00Z"), allDay: false, games: [], timezone: "Europe/Brussels" }, coStreamers: [], site: { name: "Emma" }, nowMs: Date.parse("2026-10-22T10:00:00Z"), tz: "Europe/Brussels" }), assets: {}, colors: { accent: "#7c5cff", accent2: "#7c5cff", bg: "#101018", fg: "#ffffff" }, measureContext: fakeCanvasContext() });

test("chaîne de rendu : 5 s à 30 i/s = 150 images dessinées à partir du temps, données à l'encodeur (clé chaque seconde, mémoire bornée), emballées en MP4 ; 1080×1920 vérifié par ffprobe", needs, async () => {
  const v = h264({ w: 1080, h: 1920, seconds: 5, name: "d" }), { st, env } = fakeEnv({ v, queue: 1 });
  const sc = smallScene(5);
  const steps = [];
  const caps = await enc.detectCapabilities({ width: 1080, height: 1920, fps: 30 }, env);
  assert.equal(caps.mode, "h264");
  assert.deepEqual([caps.config.codec, caps.config.bitrate, caps.config.framerate, caps.config.width, caps.config.height, caps.config.avc], ["avc1.640028", 8_000_000, 30, 1080, 1920, { format: "avc" }]);
  const out = await enc.renderVideo({ scene: sc, caps, env, onProgress: (f, phase) => steps.push([f, phase]) });
  assert.deepEqual([out.mime, out.ext, out.frames, out.mode, out.annexB], ["video/mp4", "mp4", 150, "h264", false]);
  assert.equal(st.frames, 150); assert.equal(st.closed, 150, "chaque image est libérée tout de suite : rien ne s'accumule");
  assert.equal(st.keyFrames.filter(Boolean).length, 5); assert.deepEqual(st.keyFrames.map((k, i) => k === (i % 30 === 0)).every(Boolean), true);
  assert.deepEqual(st.timestamps.slice(0, 3), [0, 33333, 66667]); assert.equal(st.timestamps[149], Math.round(149 * 1e6 / 30));
  assert.ok(st.sizes.every(([w, h]) => w === 1080 && h === 1920), "le canvas de rendu fait la taille du format");
  assert.equal(st.encoderClosed, true); assert.ok(st.maxQueue <= 7, `file d'attente bornée (${st.maxQueue})`);
  assert.equal(steps.at(-1)[0], 1); assert.ok(steps.some(([, p]) => p === "finish")); assert.ok(steps.every(([f], i) => i === 0 || f >= steps[i - 1][0]), "la progression ne recule jamais");
  const file = path.join(tmp, "d-out.mp4"); fs.writeFileSync(file, out.bytes);
  const pr = probeFile(file);
  assert.deepEqual([pr.streams[0].codec_name, pr.streams[0].width, pr.streams[0].height, Number(pr.streams[0].nb_read_frames), Number(pr.format.duration).toFixed(2)], ["h264", 1080, 1920, 150, "5.00"]);
  assert.ok(decodes(file));
});

test("chaîne de rendu : format Passeport 1080×1350, et un encodeur qui rend de l'Annex B (sans description) : le fichier est quand même valide", needs, async () => {
  const v = h264({ w: 1080, h: 1350, seconds: 5, name: "e" }), { st, env } = fakeEnv({ v, avc: false });
  const sc = smallScene(5, "passeport");
  const out = await enc.renderVideo({ scene: sc, env });
  assert.equal(out.annexB, true); assert.deepEqual(st.sizes[0], [1080, 1350]);
  const file = path.join(tmp, "e-out.mp4"); fs.writeFileSync(file, out.bytes);
  const pr = probeFile(file);
  assert.deepEqual([pr.streams[0].width, pr.streams[0].height, Number(pr.streams[0].nb_read_frames)], [1080, 1350, 150]);
  assert.ok(decodes(file));
});

test("chaîne de rendu : annuler arrête tout (aucune image de plus, encodeur fermé, erreur « aborted ») ; un encodeur en panne ou qui ne finit jamais donne un message, pas une attente sans fin", needs, async () => {
  const v = h264({ w: 320, h: 568, seconds: 2, name: "f" });
  const a = fakeEnv({ v }), ctl = new AbortController();
  const p = enc.renderVideo({ scene: smallScene(5), env: a.env, signal: ctl.signal, onProgress: (f) => { if (f > 0.2) ctl.abort(); } });
  await assert.rejects(p, (e) => e.code === "aborted");
  assert.ok(a.st.frames < 150 && a.st.frames > 0); assert.equal(a.st.closed, a.st.frames); assert.equal(a.st.encoderClosed, true);
  const b = fakeEnv({ v, failAt: 10 });
  await assert.rejects(enc.renderVideo({ scene: smallScene(5), env: b.env }), (e) => e.code === "encoder" && /panne/.test(e.detail));
  assert.equal(b.st.encoderClosed, true);
  const saved = { ...enc.timing }; enc.timing.flushMs = 80;
  try {
    const c = fakeEnv({ v: h264({ w: 320, h: 568, seconds: 5, name: "g" }), hangFlush: true }), t0 = Date.now();
    await assert.rejects(enc.renderVideo({ scene: smallScene(5), env: c.env }), (e) => e.code === "encoder");
    assert.ok(Date.now() - t0 < 3000, "borné");
  } finally { Object.assign(enc.timing, saved); }
});

test("capacités : H.264 si le navigateur sait, sinon l'enregistreur (MP4 si possible, sinon WebM), sinon « aucune » — décidé AVANT de commencer ; un navigateur qui ne répond pas ne bloque rien", async () => {
  const cfg = { width: 1080, height: 1920, fps: 30 };
  const recorder = (types) => class { static isTypeSupported(m) { return types.includes(m); } };
  const doc = { createElement: () => ({}) };
  const none = await enc.detectCapabilities(cfg, {});
  assert.deepEqual(none, { mode: "none", mp4: false });
  const webm = await enc.detectCapabilities(cfg, { document: doc, MediaRecorder: recorder(["video/webm;codecs=vp9", "video/webm"]) });
  assert.deepEqual([webm.mode, webm.mp4, webm.mime], ["recorder", false, "video/webm;codecs=vp9"]);
  const asMp4 = await enc.detectCapabilities(cfg, { document: doc, MediaRecorder: recorder(["video/mp4", "video/mp4;codecs=avc1", "video/webm"]) });
  assert.deepEqual([asMp4.mode, asMp4.mp4, asMp4.mime], ["recorder", true, "video/mp4;codecs=avc1"]);
  const hidden = await enc.detectCapabilities(cfg, { document: doc, MediaRecorder: recorder(["video/mp4", "video/webm"]) });
  assert.deepEqual([hidden.mp4, hidden.mime], [false, "video/webm"], "un « video/mp4 » sans codec (peut-être du VP9) n'est jamais pris pour un MP4 H.264");
  class NoH264 { static async isConfigSupported(c) { return { supported: !c.codec.startsWith("avc1") }; } }
  const vp9only = await enc.detectCapabilities(cfg, { VideoEncoder: NoH264, VideoFrame: class {}, OffscreenCanvas: class {}, document: doc, MediaRecorder: recorder(["video/webm"]) });
  assert.equal(vp9only.mode, "recorder", "VP9 seul : pas de MP4 H.264 par WebCodecs, on passe à l'enregistreur");
  class Throws { static async isConfigSupported() { throw new Error("non"); } }
  assert.equal((await enc.detectCapabilities(cfg, { VideoEncoder: Throws, VideoFrame: class {}, OffscreenCanvas: class {} })).mode, "none");
  const saved = { ...enc.timing }; enc.timing.detectMs = 50;
  try {
    class Hangs { static isConfigSupported() { return new Promise(() => {}); } }
    const t0 = Date.now();
    assert.equal((await enc.detectCapabilities(cfg, { VideoEncoder: Hangs, VideoFrame: class {}, OffscreenCanvas: class {} })).mode, "none");
    assert.ok(Date.now() - t0 < 2000, "un navigateur muet ne bloque pas la détection");
  } finally { Object.assign(enc.timing, saved); }
  await assert.rejects(enc.renderVideo({ scene: smallScene(5), caps: { mode: "none" }, env: {} }), (e) => e.code === "unsupported");
});

test("repli (enregistreur du navigateur) : le fichier est celui de l'enregistreur, MP4 si le navigateur sait, sinon WebM (et la page le dit) ; annulation propre ; aucune image gardée", async () => {
  let t = 0; const drawn = [];
  const make = (mime, { fail = false } = {}) => {
    class Rec { constructor(stream, o) { this.state = "inactive"; this.opts = o; Rec.last = this; } start() { this.state = "recording"; setTimeout(() => this.ondataavailable({ data: { size: 100 } }), 0); } stop() { if (this.state === "inactive") return; this.state = "inactive"; setTimeout(() => { if (fail) this.onerror({ error: { message: "x" } }); this.onstop(); }, 0); } static isTypeSupported(m) { return m === mime; } }
    const stopped = []; const canvas = { getContext: () => ({}), captureStream: () => ({ getTracks: () => [{ stop: () => stopped.push(1) }] }) };
    return { Rec, stopped, env: { MediaRecorder: Rec, Blob: class { constructor(parts, o) { this.size = parts.length * 100; this.type = o.type; } }, document: { createElement: () => canvas }, performance: { now: () => (t += 500) }, setTimeout: (fn) => setTimeout(fn, 0) } };
  };
  const sc = { ...smallScene(5), draw: (ctx, tt) => drawn.push(tt) };
  const a = make("video/webm"); const caps = await enc.detectCapabilities({ width: 1080, height: 1920, fps: 30 }, a.env);
  const out = await enc.renderVideo({ scene: sc, caps, env: a.env });
  assert.deepEqual([out.mode, out.mime, out.ext, out.mp4], ["recorder", "video/webm", "webm", false]);
  assert.equal(a.Rec.last.opts.videoBitsPerSecond, 8_000_000); assert.ok(Math.max(...drawn) <= 5 && drawn.at(-1) <= 5, "le temps dessiné ne dépasse jamais la durée");
  assert.ok(a.stopped.length >= 1, "les pistes sont arrêtées");
  const b = make("video/mp4;codecs=avc1"); const out2 = await enc.renderVideo({ scene: sc, env: b.env });
  assert.deepEqual([out2.mime, out2.ext, out2.mp4], ["video/mp4", "mp4", true]);
  const c = make("video/webm"), ctl = new AbortController(); ctl.abort();
  await assert.rejects(enc.renderVideo({ scene: sc, env: c.env, signal: ctl.signal }), (e) => e.code === "aborted");
  assert.equal(c.Rec.last.state, "inactive");
  const d = make("video/webm", { fail: true });
  await assert.rejects(enc.renderVideo({ scene: sc, env: d.env }), (e) => e.code === "encoder");
});

test("aucune bibliothèque tierce ni chargement depuis un CDN : tout le code navigateur est dans le module, sans adresse externe", () => {
  const dir = new URL("../modules/stream-story", import.meta.url).pathname;
  for (const f of ["pure.mjs", "scenes.mjs", "mp4.mjs", "encode.mjs", "app.mjs"]) {
    const code = fs.readFileSync(`${dir}/${f}`, "utf8");
    assert.ok(!/https?:\/\//.test(code.replace(/\/\/.*$/gm, "")), `${f} ne contient aucune adresse http(s) (hors commentaires)`);
    assert.ok(!/\bimport\s*\(|from\s+["'](?!\.\/)/.test(code), `${f} n'importe que des fichiers du module`);
  }
});
