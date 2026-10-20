// De l'animation au fichier vidéo, DANS LE NAVIGATEUR (rien n'est installé sur le serveur, rien n'est envoyé nulle part).
//   1. On regarde ce que le navigateur sait faire (`detectCapabilities`) AVANT de commencer.
//   2. Voie normale : chaque image est dessinée à partir du temps (`scene.draw(ctx, t)`), donnée à l'encodeur H.264 du navigateur (WebCodecs), puis emballée en MP4 (mp4.mjs).
//      Une seule image est en mémoire à la fois : on ne garde que le résultat compressé.
//   3. Repli : l'enregistreur du navigateur (MediaRecorder), en temps réel ; MP4 si le navigateur sait, sinon WebM.
// Tout ce que le navigateur fournit arrive par `env` (testable avec de faux objets) ; les erreurs sont des codes courts (`Error.code`), traduits par la page.
import { muxMp4, splitAnnexB, avcCFromAnnexB, annexBToAvc } from "./mp4.mjs";

/** Les délais (en millisecondes), dans un objet pour que les tests puissent les raccourcir. */
export const timing = { flushMs: 30_000, stopMs: 10_000, detectMs: 3000 };
const BITRATE = 8_000_000;
const H264 = ["avc1.640028", "avc1.4d0028", "avc1.42e028", "avc1.64002a", "avc1.4d002a"];   // High 4.0, Main 4.0, Baseline 4.0, High 4.2, Main 4.2
// Un « video/mp4 » sans codec peut cacher du VP9 (refusé par Instagram) : on ne prend un MP4 que s'il est annoncé en H.264.
const RECORDER = ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1.4d0028", "video/mp4;codecs=avc1.42e028", "video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

export const fail = (code, extra) => Object.assign(new Error(code), { code, ...extra });
const within = (p, ms, fallback) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(t)); };
const tick = (env) => new Promise((r) => (env.setTimeout ?? setTimeout)(r, 0));

/**
 * Ce que le navigateur sait faire pour ce format : { mode: "h264" | "recorder" | "none", config?, mime?, mp4: boolean }.
 * `mode: "h264"` : fichier MP4 H.264 sûr pour Instagram. `recorder` : enregistrement en temps réel (`mp4` dit si le fichier sera un MP4). `none` : rien ne marche.
 */
export async function detectCapabilities({ width, height, fps = 30 }, env = globalThis) {
  const canvasOk = typeof env.OffscreenCanvas === "function" || !!env.document?.createElement;
  if (typeof env.VideoEncoder === "function" && typeof env.VideoFrame === "function" && canvasOk) {
    for (const codec of H264) {
      try {
        const r = await within(env.VideoEncoder.isConfigSupported({ codec, width, height, bitrate: BITRATE, framerate: fps, avc: { format: "avc" } }), timing.detectMs, null);
        if (r?.supported) return { mode: "h264", mp4: true, config: { codec, width, height, bitrate: BITRATE, framerate: fps, avc: { format: "avc" }, latencyMode: "quality" } };
      } catch { /* ce codec n'est pas accepté : on essaie le suivant */ }
    }
  }
  if (typeof env.MediaRecorder === "function" && typeof env.document?.createElement === "function") {
    const mime = RECORDER.find((m) => { try { return env.MediaRecorder.isTypeSupported(m); } catch { return false; } });
    if (mime) return { mode: "recorder", mp4: mime.startsWith("video/mp4"), mime };
  }
  return { mode: "none", mp4: false };
}

const makeCanvas = (w, h, env) => {
  if (typeof env.OffscreenCanvas === "function") return new env.OffscreenCanvas(w, h);
  const c = env.document.createElement("canvas"); c.width = w; c.height = h; return c;
};
const checkAbort = (signal) => { if (signal?.aborted) throw fail("aborted"); };

/** Voie normale : H.264 (WebCodecs) + MP4. Rend { bytes: Uint8Array, mime: "video/mp4", ext: "mp4", frames }. */
export async function renderMp4({ scene, caps, env = globalThis, onProgress = () => {}, signal }) {
  const fps = scene.fps, total = Math.round(scene.duration * fps);
  const canvas = makeCanvas(scene.width, scene.height, env), ctx = canvas.getContext("2d");
  if (!ctx) throw fail("canvas");
  const chunks = []; let description = null, error = null, annexB = false;
  const encoder = new env.VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      const d = meta?.decoderConfig?.description;
      if (!description && d) description = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice();
      chunks.push({ data, timestamp: chunk.timestamp, key: chunk.type === "key" });
    },
    error: (e) => { error = e; },
  });
  try {
    encoder.configure(caps.config);
    for (let i = 0; i < total; i++) {
      checkAbort(signal);
      if (error) throw fail("encoder", { detail: String(error?.message ?? error) });
      scene.draw(ctx, i / fps);
      const frame = new env.VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      try { encoder.encode(frame, { keyFrame: i % fps === 0 }); } finally { frame.close(); }
      // l'encodeur ne doit pas prendre d'avance : sinon les images en attente s'accumulent en mémoire
      let waited = 0;
      while (encoder.encodeQueueSize > 6 && waited < 4000) { await tick(env); waited++; checkAbort(signal); }
      if (i % 3 === 0) { onProgress(i / total, "frames"); await tick(env); }
    }
    checkAbort(signal);
    onProgress(0.98, "finish");
    await within(encoder.flush().then(() => true), timing.flushMs, null).then((r) => { if (r === null) throw fail("encoder", { detail: "timeout" }); });
    if (error) throw fail("encoder", { detail: String(error?.message ?? error) });
  } finally { try { encoder.close(); } catch { /* déjà fermé */ } }
  if (!chunks.length) throw fail("encoder", { detail: "empty" });
  let frames = chunks;
  if (!description) {
    // un navigateur qui rend du « Annex B » (sans description) : on fabrique l'avcC nous-mêmes
    annexB = true;
    description = avcCFromAnnexB(splitAnnexB(chunks[0].data));
    if (!description) throw fail("encoder", { detail: "no_description" });
    frames = chunks.map((c) => ({ ...c, data: annexBToAvc(c.data) }));
  }
  const bytes = muxMp4({ width: scene.width, height: scene.height, fps, frames, description });
  onProgress(1, "done");
  return { bytes, mime: "video/mp4", ext: "mp4", frames: frames.length, annexB };
}

/** Repli : l'enregistreur du navigateur, en temps réel (la page doit rester visible). Rend { bytes, mime, ext, frames: 0 }. */
export async function renderRecorded({ scene, caps, env = globalThis, onProgress = () => {}, signal }) {
  const canvas = env.document.createElement("canvas"); canvas.width = scene.width; canvas.height = scene.height;
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof canvas.captureStream !== "function") throw fail("canvas");
  const stream = canvas.captureStream(scene.fps);
  const parts = []; let error = null;
  const rec = new env.MediaRecorder(stream, { mimeType: caps.mime, videoBitsPerSecond: BITRATE });
  rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
  rec.onerror = (e) => { error = e; };
  const stopped = new Promise((resolve) => { rec.onstop = resolve; });
  const now = () => (env.performance ?? performance).now();
  try {
    scene.draw(ctx, 0);
    rec.start(1000);
    const t0 = now();
    for (;;) {
      checkAbort(signal);
      if (error) throw fail("encoder", { detail: String(error?.error?.message ?? "") });
      const t = (now() - t0) / 1000;
      scene.draw(ctx, Math.min(t, scene.duration));
      onProgress(Math.min(1, t / scene.duration), "frames");
      if (t >= scene.duration) break;
      await new Promise((r) => (env.setTimeout ?? setTimeout)(r, 1000 / scene.fps));
    }
    rec.stop();
    await within(stopped, timing.stopMs, null);
    if (error) throw fail("encoder", { detail: String(error?.error?.message ?? "") });
  } finally { try { if (rec.state !== "inactive") rec.stop(); } catch { /* déjà arrêté */ } stream.getTracks?.().forEach((tr) => tr.stop()); }
  const type = String(caps.mime).split(";")[0];
  const blob = new env.Blob(parts, { type });
  if (!blob.size) throw fail("encoder", { detail: "empty" });
  onProgress(1, "done");
  return { blob, mime: type, ext: type === "video/mp4" ? "mp4" : "webm", frames: 0 };
}

/** Fabrique la vidéo avec la meilleure voie disponible. */
export async function renderVideo(args) {
  const caps = args.caps ?? (await detectCapabilities({ width: args.scene.width, height: args.scene.height, fps: args.scene.fps }, args.env ?? globalThis));
  if (caps.mode === "h264") return { ...(await renderMp4({ ...args, caps })), mode: "h264" };
  if (caps.mode === "recorder") return { ...(await renderRecorded({ ...args, caps })), mode: "recorder", mp4: caps.mp4 };
  throw fail("unsupported");
}
