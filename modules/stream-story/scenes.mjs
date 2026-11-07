// The animations of "Announcement story" (neon, poster, countdown, minimal here; broadcast, kinetic, cinema, arcade, collage, geometric in scenes-extra.mjs). Each one is a FUNCTION OF TIME: `scene.draw(ctx, t)` draws the image needed at second `t`, always the same
// for the same `t` (no hazard that cannot be reproduced, no clock): this is what lets the video be made image by image, as fast as the computer can.
// This file knows neither the page nor the network: it receives a 2D drawing context (canvas) and draws with `fillText` (never HTML).
import { formatOf, safeArea, STYLES, LIMITS, WATERMARK_TEXT, WATERMARK_LEAD, WATERMARK_NAME, WORDMARK, wrapText, ellipsize, solveScale, layoutCostreamers, initials, mix, rgba, readableOn, ensureContrast, contrast, luminance, clamp01, easeOutCubic, easeInOutCubic, easeOutBack, progress, seeded } from "./pure.mjs";
import { EXTRA_STYLES, extraPalette, createExtraScene } from "./scenes-extra.mjs";

const FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const cleanFamily = (f) => (typeof f === "string" && /^[A-Za-z0-9 ,'"\-_.]{1,200}$/.test(f) ? f : FAMILY);
/** The few words written in the video itself (the rest comes from the editor). */
const WORDS = { fr: { with: "AVEC", days: "JOURS", hours: "HEURES", minutes: "MIN" }, en: { with: "WITH", days: "DAYS", hours: "HOURS", minutes: "MIN" } };   // the words specific to the six other styles: EXTRA_WORDS (scenes-extra.mjs)
const imgSize = (img) => (img ? { w: img.naturalWidth || img.width || 0, h: img.naturalHeight || img.height || 0 } : { w: 0, h: 0 });
const usable = (img) => { const s = imgSize(img); return s.w > 0 && s.h > 0; };

/* ───────────── Small drawing tools ───────────── */
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr); ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
}
/** An image that fills the rectangle (cropped in the centre, never distorted), with rounded corners. */
function drawCover(ctx, img, x, y, w, h, r) {
  ctx.save(); roundRectPath(ctx, x, y, w, h, r); ctx.clip();
  const s = imgSize(img), k = Math.max(w / s.w, h / s.h), dw = s.w * k, dh = s.h * k;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}
function drawAvatar(ctx, cell, member, img, pal, alpha) {
  const r = cell.d / 2;
  ctx.save(); ctx.globalAlpha *= alpha;
  ctx.beginPath(); ctx.arc(cell.cx, cell.cy, r + 6, 0, Math.PI * 2); ctx.fillStyle = pal.ring; ctx.fill();
  if (member.more) {
    // the "+N" badge: the extra people, who do not fit in the video
    ctx.beginPath(); ctx.arc(cell.cx, cell.cy, r, 0, Math.PI * 2); ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fill();
    ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `800 ${Math.round(cell.d * 0.34)}px ${pal.family}`;
    ctx.fillText(member.name, cell.cx, cell.cy + cell.d * 0.02);
  } else if (usable(img)) {
    ctx.save(); ctx.beginPath(); ctx.arc(cell.cx, cell.cy, r, 0, Math.PI * 2); ctx.clip();
    const s = imgSize(img), k = Math.max(cell.d / s.w, cell.d / s.h);
    ctx.drawImage(img, cell.cx - (s.w * k) / 2, cell.cy - (s.h * k) / 2, s.w * k, s.h * k); ctx.restore();
  } else {
    // no image: a coloured circle (specific to this handle) with the initials
    const hue = [...member.login].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
    ctx.beginPath(); ctx.arc(cell.cx, cell.cy, r, 0, Math.PI * 2); ctx.fillStyle = `hsl(${hue},55%,38%)`; ctx.fill();
    ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `800 ${Math.round(cell.d * 0.38)}px ${pal.family}`;
    ctx.fillText(initials(member.name || member.login), cell.cx, cell.cy + cell.d * 0.02);
  }
  ctx.restore();
}

/* ───────────── The colours of each style ───────────── */
function darkenUntil(color, against, ratio) {
  let c = color;
  for (let i = 0; i < 12 && contrast(c, against) < ratio; i++) c = mix(c, "#000000", 0.2);
  return c;
}
export function paletteFor(style, input = {}) {
  if (EXTRA_STYLES.includes(style)) return extraPalette(style, input);
  const accent = /^#[0-9a-f]{6}$/i.test(input.accent ?? "") ? input.accent : "#7c5cff";
  const accent2 = /^#[0-9a-f]{6}$/i.test(input.accent2 ?? "") ? input.accent2 : accent;
  const bg = /^#[0-9a-f]{6}$/i.test(input.bg ?? "") ? input.bg : "#111111";
  const fg = /^#[0-9a-f]{6}$/i.test(input.fg ?? "") ? input.fg : readableOn(bg);
  if (style === "neon") {
    const base = "#07060f", boost = (c) => (luminance(c) < 0.25 ? mix(c, "#ffffff", 0.5) : c);
    const a = ensureContrast(boost(accent), base, 4.5), b = ensureContrast(boost(accent2), base, 4.5);
    return { base, bg0: base, bg1: base, text: "#f6f4ff", accent: a, accent2: b, soft: "#c9c4e6", ring: a };
  }
  if (style === "poster") {
    const b0 = mix(accent, "#000000", 0.78), b1 = "#050507", mid = mix(b0, b1, 0.5);
    return { base: mid, bg0: b0, bg1: b1, text: "#ffffff", accent: ensureContrast(luminance(accent) < 0.25 ? mix(accent, "#ffffff", 0.4) : accent, mid, 4.5), accent2: ensureContrast(accent2, mid, 3), soft: "#d9d9e3", ring: "#ffffff" };
  }
  if (style === "countdown") {
    const g0 = darkenUntil(mix(accent, "#000000", 0.4), "#ffffff", 5), g1 = darkenUntil(mix(accent2 === accent ? mix(accent, "#000000", 0.35) : accent2, "#000000", 0.45), "#ffffff", 5);
    return { base: mix(g0, g1, 0.5), bg0: g0, bg1: g1, text: "#ffffff", accent: "#ffffff", accent2: mix(g0, "#ffffff", 0.82), soft: "#f1eeff", ring: "#ffffff" };
  }
  const text = ensureContrast(fg, bg, 7), a = ensureContrast(accent, bg, 4.5);
  return { base: bg, bg0: bg, bg1: bg, text, accent: a, accent2: a, soft: ensureContrast(mix(text, bg, 0.35), bg, 4.5), ring: a };
}

/* ───────────── The layout (the same logic for the four first styles) ───────────── */
const ORDER = {
  neon: ["brand", "title", "when", "countdown", "game", "text", "costreamers"],
  poster: ["brand", "game", "title", "when", "countdown", "text", "costreamers"],
  countdown: ["brand", "digits", "when", "title", "game", "text", "costreamers"],
  minimal: ["brand", "title", "when", "countdown", "game", "text", "costreamers"],
};
/** Biggest enlargement: little content = bigger elements, so that the composition fills the safe area instead of staying small at the top. */
const MAX_SCALE = 1.7;
const STYLE_PARAMS = {
  neon: { align: "center", title: 100, weight: 800, gap: 40, cover: "thumb" },
  poster: { align: "center", title: 112, weight: 900, gap: 36, cover: "hero" },
  countdown: { align: "center", title: 76, weight: 800, gap: 34, cover: "thumb" },
  minimal: { align: "left", title: 92, weight: 700, gap: 44, cover: "thumb" },
};

export function createScene(opts = {}) {
  const fmt = formatOf(opts.format), W = fmt.width, H = fmt.height, safe = safeArea(fmt);
  // The "Made with Curiosa" mention (only if the box is ticked: an explicit `true`). It takes the bottom of the safe area; the content is laid out above it.
  // The mention sits at the very bottom of the frame (60 px from the edge, like the passport margins), even below the safe area; the content only gives up room if they would meet.
  const wmOn = opts.watermark === true, WM = { px: 30, h: 54, padX: 26, gap: 28, alpha: 0.6, edge: 60 };
  const wmY = H - WM.edge - WM.h;
  const A = wmOn ? { ...safe, h: Math.min(safe.h, wmY - WM.gap - safe.y) } : safe;
  const style = STYLES.includes(opts.style) ? opts.style : "neon";
  const duration = Math.min(LIMITS.durationMax, Math.max(LIMITS.durationMin, Number(opts.duration) || LIMITS.durationDefault));
  const content = opts.content ?? {}, assets = opts.assets ?? {}, lang = content.lang === "en" ? "en" : "fr", words = WORDS[lang];
  const family = cleanFamily(opts.font), pal = { ...paletteFor(style, opts.colors), family }, sp = STYLE_PARAMS[style];
  const mctx = opts.measureContext;
  const font = (weight, px, italic) => `${italic ? "italic " : ""}${weight} ${Math.max(6, Math.round(px))}px ${family}`;
  const measureWith = (f) => { mctx.font = f; return (s) => mctx.measureText(s).width; };
  /* The mention: placed in the centre, at the very bottom of the video (60 px from the edge). In vertical that is inside the zone Instagram's interface covers, by the owner's choice. Same font as the rest of the video, medium bold, 30 px at 1080 wide.
     The colours come from the background of the model: the text is the white or the near-black that contrasts best with the colours of the BOTTOM background (start, end of the gradient and average), on a
     semi-transparent pill of the background colour. No motion: the same image at every instant, from the first to the last frame. */
  const watermark = (() => {
    if (!wmOn) return null;
    // Two segments on the SAME baseline: "Made with" in the video's font, then "Curiosa" in Fraunces italic 600 (1.15 times bigger, like the site's logo). If the font
    // of the name could not be loaded (`wordmarkFont` empty), the canvas falls back to Georgia italic, same weight.
    const fam = typeof opts.wordmarkFont === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(opts.wordmarkFont) ? `"${opts.wordmarkFont}", ${WORDMARK.fallback}` : WORDMARK.fallback;
    const f1 = font(600, WM.px), f2 = `italic ${WORDMARK.weight} ${Math.round(WM.px * WORDMARK.scale * 10) / 10}px ${fam}`;
    const w1 = measureWith(f1)(WATERMARK_LEAD), w2 = measureWith(f2)(WATERMARK_NAME), tw = Math.ceil(w1 + w2), w = Math.ceil((tw + WM.padX * 2) / 2) * 2;   // even width: centred on a whole pixel
    const left = Math.round((W - tw) / 2), base = Math.round(wmY + WM.h / 2 + WM.px * 0.35);
    const parts = [{ text: WATERMARK_LEAD, font: f1, x: left, y: base }, { text: WATERMARK_NAME, font: f2, x: left + Math.round(w1), y: base }];
    const bgs = [...new Set([pal.base, pal.bg0, pal.bg1])];
    const worst = (c, pill = null) => Math.min(...bgs.map((b) => contrast(c, pill ? mix(b, pill, WM.alpha) : b)));
    const color = worst("#ffffff") >= worst("#111111") ? "#ffffff" : "#111111";
    // the pill has the background colour; if the background is a mid grey where neither white nor black reaches 4.5:1, it darkens (or lightens) just as much as needed
    const toward = color === "#ffffff" ? "#000000" : "#ffffff";
    let pill = pal.base;
    for (let k = 1; k <= 10 && worst(color, pill) < 4.5; k++) pill = mix(pal.base, toward, k / 10);
    return { text: WATERMARK_TEXT, parts, color, pill, ratio: worst(color, pill), x: Math.round((W - w) / 2), y: wmY, w, h: WM.h };
  })();
  function drawWatermark(ctx) {
    const m = watermark;
    ctx.save();
    ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.shadowColor = "rgba(0,0,0,0)"; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    roundRectPath(ctx, m.x, m.y, m.w, m.h, m.h / 2); ctx.fillStyle = rgba(m.pill, WM.alpha); ctx.fill();
    ctx.strokeStyle = rgba(m.color, 0.28); ctx.lineWidth = 2; ctx.stroke();
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = m.color;
    for (const q of m.parts) { ctx.font = q.font; ctx.fillText(q.text, q.x, q.y); }
    ctx.restore();
  }
  const hasLogo = usable(assets.logo);
  const members = (content.costreamers ?? []).slice(0, LIMITS.costreamers);
  const digitsOn = style === "countdown" && !!content.parts && !!content.countdown;
  const pack = (draw, boxes, u, blocks) => ({ width: W, height: H, duration, fps: LIMITS.fps, style, format: fmt.id, draw, boxes, scale: u, palette: pal, blocks: blocks.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h })), restTime: duration * 0.78, watermark: watermark ? { text: watermark.text, x: watermark.x, y: watermark.y, w: watermark.w, h: watermark.h, color: watermark.color, parts: watermark.parts.map((q) => ({ ...q })), background: watermark.pill, contrast: watermark.ratio } : null });
  if (EXTRA_STYLES.includes(style)) {
    // the six styles of scenes-extra.mjs: same contract, the mention is drawn here, on top, whatever the style
    const ex = createExtraScene({ style, W, H, A, duration, content, assets, lang, words, family, pal, members, hasLogo, mctx, tools: { usable } });
    const drawExtra = (ctx, rawT) => { const t = Math.min(duration, Math.max(0, Number(rawT) || 0)); ctx.save(); ex.draw(ctx, t); if (watermark) drawWatermark(ctx); ctx.restore(); };
    return pack(drawExtra, ex.boxes, ex.scale, ex.blocks);
  }
  const has = {
    brand: !!(content.brand || hasLogo), title: !!content.title, when: !!(content.dayLine || content.timeLine),
    countdown: !digitsOn && !!content.countdown, digits: digitsOn, game: !!content.game, text: !!content.text, costreamers: members.length > 0,
  };
  const order = ORDER[style].filter((id) => has[id]);
  const heroCover = sp.cover === "hero" && usable(assets.cover);

  /* The blocks at scale u: their size only depends on u (1 = maximum size). */
  function build(u) {
    const blocks = [];
    for (const id of order) {
      let b = null;
      if (id === "brand") {
        const px = 44 * u, m = measureWith(font(700, px)), logo = hasLogo ? 88 * u : 0, gap = logo && content.brand ? 22 * u : 0;
        const name = content.brand ? ellipsize(m, content.brand, A.w - logo - gap) : "";
        b = { id, h: Math.max(logo, px * 1.3), logo, gap, name, px, tw: (name ? m(name) : 0) + logo + gap };
      } else if (id === "title") {
        let f = 1, lines = [], px = 0, m;
        for (; f >= 0.5; f -= 0.05) {   // a long title shrinks (down to half) rather than being cut
          px = sp.title * u * f; m = measureWith(font(sp.weight, px)); lines = wrapText(m, content.title, A.w, 4);
          const cut = lines.length > 0 && lines[lines.length - 1].endsWith("…") && !content.title.endsWith("…");
          if (!cut && (lines.length <= 3 || f <= 0.8)) break;
        }
        b = { id, lines, px, lh: px * 1.1, h: lines.length * px * 1.1, tw: Math.max(...lines.map((l) => m(l)), 0) };
      } else if (id === "when") {
        const dpx = 52 * u, tpx = 150 * u, dm = measureWith(font(600, dpx));
        const day = content.dayLine ? ellipsize(dm, content.dayLine, A.w) : "";
        b = { id, day, dpx, tpx, time: content.timeLine || "", h: (day ? dpx * 1.3 : 0) + (content.timeLine ? tpx * 1.05 : 0), tw: A.w };
      } else if (id === "countdown") {
        const px = 50 * u, m = measureWith(font(800, px)), pad = 38 * u, text = ellipsize(m, content.countdown, A.w - pad * 2);
        b = { id, text, px, pad, h: px * 2, tw: m(text) + pad * 2 };
      } else if (id === "digits") {
        const p = content.parts, groups = [...(p.days > 0 ? [["days", p.days]] : []), ["hours", p.hours], ["minutes", p.minutes]];
        const px = 230 * u, cell = px * 0.62, gw = cell * 2 + 14 * u, colon = 64 * u, tw = groups.length * gw + (groups.length - 1) * colon;
        b = { id, groups, px, cell, gw, colon, h: px * 1.12 + 62 * u, tw };
      } else if (id === "game") {
        const px = 56 * u, m = measureWith(font(800, px));
        if (heroCover) {
          const cw = 400 * u, ch = 540 * u, lines = wrapText(m, content.game, A.w, 2);
          b = { id, hero: true, cw, ch, lines, px, h: ch + 22 * u + lines.length * px * 1.15, tw: Math.max(cw, ...lines.map((l) => m(l))) };
        } else if (usable(assets.cover)) {
          const cw = 220 * u, ch = 300 * u, lines = wrapText(m, content.game, A.w - cw - 40 * u, 3);
          b = { id, hero: false, cw, ch, lines, px, h: Math.max(ch, lines.length * px * 1.15), tw: cw + 40 * u + Math.max(...lines.map((l) => m(l))) };
        } else {
          const lines = wrapText(m, content.game, A.w - 40 * u, 2);
          b = { id, hero: false, cw: 0, ch: 0, lines, px, h: lines.length * px * 1.15 + 10 * u, tw: Math.max(...lines.map((l) => m(l))) + 30 * u };
        }
      } else if (id === "text") {
        const px = 46 * u, m = measureWith(font(500, px, true)), lines = wrapText(m, content.text, A.w - 40 * u, 3);
        b = { id, lines, px, h: lines.length * px * 1.28 + 8 * u, tw: Math.max(...lines.map((l) => m(l))) + 40 * u };
      } else if (id === "costreamers") {
        const rows = members.length <= 3 ? 1 : 2, d = 190 * u, labelH = 44 * u, head = 52 * u;
        b = { id, head, d, labelH, rows, h: head + rows * (d + labelH + 8) + (rows - 1) * Math.min(28 * u, 20), tw: A.w };
      }
      if (b) blocks.push(b);
    }
    return blocks;
  }
  const gapFor = (u) => sp.gap * u;
  const totalAt = (u) => { const bs = build(u); return bs.reduce((s, b) => s + b.h, 0) + Math.max(0, bs.length - 1) * gapFor(u); };
  // the scale: the biggest one for which everything fits in height AND in width
  const widthCap = (() => { const bs = build(1); return bs.reduce((k, b) => (b.id === "digits" || b.id === "game" || b.id === "brand" || b.id === "countdown" ? Math.min(k, (A.w * 0.99) / Math.max(1, b.tw)) : k), MAX_SCALE); })();
  const u = solveScale(totalAt, A.h, widthCap, 0.25);
  const blocks = build(u), gap = gapFor(u);
  const used = blocks.reduce((s, b) => s + b.h, 0) + Math.max(0, blocks.length - 1) * gap;
  const extra = Math.max(0, A.h - used), stretch = blocks.length > 1 ? Math.min(extra / (blocks.length - 1), gap * 1.6) : 0;
  let cursor = A.y + Math.max(0, (A.h - (used + stretch * Math.max(0, blocks.length - 1))) / 2);
  for (const b of blocks) { b.x = A.x; b.w = A.w; b.y = cursor; cursor += b.h + gap + stretch; }
  // the rectangle really occupied by each block (for the safe-area check)
  const boxes = blocks.map((b) => {
    const tw = Math.min(A.w, b.tw ?? A.w), left = sp.align === "center" || b.id === "digits" || b.id === "costreamers" || b.hero ? A.x + (A.w - tw) / 2 : A.x;
    return { id: b.id, x: left, y: b.y, w: tw, h: b.h };
  });

  /* ───────────── The motion of each style ───────────── */
  const stagger = style === "countdown" ? 0.45 : style === "minimal" ? 0 : 0.38;
  const startOf = (i) => 0.25 + i * stagger;
  // minimal: writing letter by letter, block after block
  const typing = (() => {
    const counts = blocks.map((b) => (b.id === "brand" ? (b.name || "").length : b.id === "title" || b.id === "game" || b.id === "text" ? b.lines.join("").length : b.id === "when" ? (b.day || "").length + (b.time || "").length : b.id === "countdown" ? b.text.length : 1));
    const total = counts.reduce((s, c) => s + c, 0), budget = Math.max(2, duration * 0.62 - blocks.length * 0.18);
    const rate = Math.max(22, total / budget), starts = [];
    let at = 0.3;
    for (const c of counts) { starts.push(at); at += c / rate + 0.18; }
    return { starts, rate, counts };
  })();

  function fxFor(i, t) {
    const b = blocks[i], s0 = startOf(i);
    if (style === "neon") {
      const p = progress(t, s0, 0.7);
      // sizzling switch-on: a few "flickers" before staying on
      const rnd = seeded(i * 977 + Math.floor(t * 24)), on = p >= 1 ? 1 : p <= 0 ? 0 : (rnd() < 0.35 + p * 0.6 ? 1 : 0.12);
      const idle = p >= 1 && rnd() < 0.015 ? 0.55 : 1;
      return { alpha: on * idle, dx: 0, dy: 0, reveal: 1, glitch: glitchAt(t, i), scale: 1 };
    }
    if (style === "poster") {
      const p = easeOutCubic(progress(t, s0, 0.85)), from = b.id === "game" ? 1 : b.id === "title" ? -1 : 0;
      return { alpha: clamp01(p * 1.4), dx: from * (1 - p) * 760, dy: from === 0 ? (1 - p) * 110 : 0, reveal: 1, glitch: 0, scale: 1 };
    }
    if (style === "countdown") {
      const p = easeOutBack(progress(t, s0, 0.7)), a = clamp01(progress(t, s0, 0.45) * 1.6);
      return { alpha: a, dx: 0, dy: (1 - p) * 90, reveal: 1, glitch: 0, scale: 0.9 + 0.1 * clamp01(p) };
    }
    const s = typing.starts[i], n = typing.counts[i];
    return { alpha: t >= s ? 1 : 0, dx: 0, dy: 0, reveal: n <= 1 ? (t >= s ? 1 : 0) : clamp01((t - s) * typing.rate / n), glitch: 0, scale: 1 };
  }
  // "interference" at fixed moments of the video (reproducible)
  const bursts = (() => { const r = seeded(4242), out = []; for (let k = 0; k < 8; k++) out.push(1.3 + k * 2.1 + r() * 0.7); return out; })();
  function glitchAt(t, i) { for (const s of bursts) if (t >= s && t < s + 0.16 + (i % 3) * 0.03) return 0.35 + ((i * 7 + Math.floor(s * 10)) % 5) * 0.12; return 0; }

  /* ───────────── The backgrounds ───────────── */
  function background(ctx, t) {
    ctx.save();
    if (style === "neon") {
      ctx.fillStyle = pal.base; ctx.fillRect(0, 0, W, H);
      const pulse = 0.75 + 0.25 * Math.sin(t * 1.6);
      for (const [cx, cy, col, k] of [[W * 0.15, H * 0.12, pal.accent, 1], [W * 0.9, H * 0.88, pal.accent2, 0.85]]) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.7);
        g.addColorStop(0, rgba(col, 0.42 * pulse * k)); g.addColorStop(1, rgba(col, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      // a grid that moves toward the horizon
      ctx.strokeStyle = rgba(pal.accent2, 0.22); ctx.lineWidth = 2; ctx.beginPath();
      const hz = H * 0.62, off = (t * 0.45) % 1;
      for (let k = 0; k < 9; k++) { const y = hz + (H - hz) * ((k + off) / 9) ** 2; ctx.moveTo(0, y); ctx.lineTo(W, y); }
      for (let k = -8; k <= 8; k++) { ctx.moveTo(W / 2 + k * 40, hz); ctx.lineTo(W / 2 + k * 190, H); }
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.22)"; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let y = 0; y < H; y += 6) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
    } else if (style === "poster") {
      const g = ctx.createLinearGradient(0, 0, W * 0.4, H); g.addColorStop(0, pal.bg0); g.addColorStop(1, pal.bg1); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // a glint of light that crosses the poster
      const sx = -W + ((t / duration) * 2.4) * W, band = ctx.createLinearGradient(sx, 0, sx + W * 0.6, H * 0.5);
      band.addColorStop(0, rgba("#ffffff", 0)); band.addColorStop(0.5, rgba("#ffffff", 0.07)); band.addColorStop(1, rgba("#ffffff", 0));
      ctx.fillStyle = band; ctx.fillRect(0, 0, W, H);
      const r = seeded(Math.floor(t * 12) + 5); ctx.fillStyle = "rgba(255,255,255,0.05)";
      for (let k = 0; k < 140; k++) ctx.fillRect(r() * W, r() * H, 3, 3);
      ctx.fillStyle = pal.accent; { const bw = 120 * easeOutCubic(progress(t, 0.1, 0.8)); ctx.fillRect(W / 2 - bw / 2, A.y - 28, bw, 8); }
    } else if (style === "countdown") {
      const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, pal.bg0); g.addColorStop(1, pal.bg1); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      for (let k = 0; k < 5; k++) {
        const x = W * (0.1 + 0.2 * k) + Math.sin(t * 0.7 + k) * 60, y = H * (0.2 + 0.15 * ((k * 3) % 5)) + Math.cos(t * 0.5 + k * 2) * 80, r = 160 + k * 38;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = rgba("#ffffff", 0.045); ctx.fill();
      }
    } else {
      ctx.fillStyle = pal.bg0; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = pal.accent; ctx.fillRect(A.x, A.y - 30, 90, 8);
    }
    ctx.restore();
  }

  /* ───────────── Text drawing (one single place for all the styles) ───────────── */
  function drawLines(ctx, lines, x, top, lh, f, color, align, fx, boxW) {
    ctx.font = f; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    let left = Math.floor((fx.reveal >= 1 ? 1e9 : fx.reveal * lines.join("").length) + 1e-9);
    lines.forEach((line, k) => {
      const full = ctx.measureText(line).width;
      const x0 = align === "center" ? x + (boxW - full) / 2 : x;
      const shown = fx.reveal >= 1 ? line : [...line].slice(0, Math.max(0, left)).join("");
      left -= [...line].length;
      if (!shown) return;
      const y = top + lh * k + lh / 2;
      textFx(ctx, shown, x0, y, color, fx, full);
      if (fx.reveal < 1 && style === "minimal" && left <= 0 && left > -[...line].length && Math.floor(fx.cursorT * 2) % 2 === 0) { ctx.fillStyle = pal.accent; ctx.fillRect(x0 + ctx.measureText(shown).width + 6, y - lh * 0.4, 6, lh * 0.8); }
    });
  }
  function textFx(ctx, str, x, y, color, fx, fullW) {
    if (style === "neon") {
      ctx.save();
      if (fx.glitch > 0) {
        const r = seeded(Math.floor(fx.t * 30) * 31 + str.length), g = fx.glitch * 22, ph = parseInt(ctx.font.match(/(\d+)px/)?.[1] ?? "40", 10);
        for (const [col, dx] of [["#ff2d6f", -g], ["#19e6ff", g]]) { ctx.globalAlpha = 0.65 * fx.alpha; ctx.fillStyle = col; ctx.fillText(str, x + dx, y); }
        const bands = 3;
        for (let k = 0; k < bands; k++) {   // slices that slide sideways
          ctx.save(); ctx.beginPath(); ctx.rect(x - 60, y - ph * 0.6 + (k * ph * 1.2) / bands, fullW + 120, (ph * 1.2) / bands); ctx.clip();
          ctx.globalAlpha = fx.alpha; ctx.fillStyle = color; ctx.fillText(str, x + (r() - 0.5) * g * 3, y); ctx.restore();
        }
      }
      ctx.globalAlpha = fx.alpha; ctx.shadowColor = pal.accent; ctx.shadowBlur = 26; ctx.fillStyle = color; ctx.fillText(str, x, y);
      ctx.shadowBlur = 0; ctx.fillText(str, x, y); ctx.restore();
      return;
    }
    ctx.save(); ctx.globalAlpha = fx.alpha; ctx.fillStyle = color; ctx.fillText(str, x, y); ctx.restore();
  }

  /* ───────────── The blocks ───────────── */
  const al = sp.align;
  function drawBlock(ctx, b, fx, t) {
    ctx.save();
    ctx.translate(fx.dx, fx.dy);
    if (fx.scale !== 1) { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; ctx.translate(cx, cy); ctx.scale(fx.scale, fx.scale); ctx.translate(-cx, -cy); }
    fx = { ...fx, t, cursorT: t };
    if (b.id === "brand") {
      const x0 = al === "center" ? b.x + (b.w - b.tw) / 2 : b.x;
      if (b.logo) {
        ctx.save(); ctx.globalAlpha *= fx.alpha; drawCover(ctx, assets.logo, x0, b.y + (b.h - b.logo) / 2, b.logo, b.logo, b.logo * 0.22); ctx.restore();
      }
      if (b.name) drawLines(ctx, [b.name], x0 + b.logo + b.gap, b.y, b.h, font(700, b.px), pal.soft, "left", fx, b.tw);
    } else if (b.id === "title") {
      drawLines(ctx, b.lines, b.x, b.y, b.lh, font(sp.weight, b.px), pal.text, al, fx, b.w);
    } else if (b.id === "when") {
      let y = b.y;
      if (b.day) { drawLines(ctx, [b.day], b.x, y, b.dpx * 1.3, font(600, b.dpx), pal.soft, al, fx, b.w); y += b.dpx * 1.3; }
      if (b.time) drawLines(ctx, [b.time], b.x, y, b.tpx * 1.05, font(900, b.tpx), pal.accent, al, fx, b.w);
    } else if (b.id === "countdown") {
      const x0 = al === "center" ? b.x + (b.w - b.tw) / 2 : b.x;
      ctx.save(); ctx.globalAlpha *= fx.alpha;
      roundRectPath(ctx, x0, b.y + b.px * 0.25, b.tw, b.px * 1.5, b.px * 0.75);
      if (style === "neon") { ctx.strokeStyle = pal.accent2; ctx.lineWidth = 4; ctx.shadowColor = pal.accent2; ctx.shadowBlur = 22; ctx.stroke(); } else { ctx.fillStyle = pal.accent; ctx.fill(); }
      ctx.restore();
      const onPill = style === "neon" ? pal.text : readableOn(pal.accent);
      drawLines(ctx, [b.text], x0 + b.pad, b.y + b.px * 0.25, b.px * 1.5, font(800, b.px), onPill, "left", fx, b.tw);
    } else if (b.id === "digits") drawDigits(ctx, b, fx, t);
    else if (b.id === "game") {
      if (b.hero) {
        const x0 = b.x + (b.w - b.cw) / 2, k = 1 + 0.05 * (t / duration);
        ctx.save(); ctx.globalAlpha *= fx.alpha; ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
        ctx.translate(x0 + b.cw / 2, b.y + b.ch / 2); ctx.rotate(-0.025 * (1 - clamp01(progress(t, 0.2, 1.2)))); ctx.scale(k, k); ctx.translate(-(x0 + b.cw / 2), -(b.y + b.ch / 2));
        drawCover(ctx, assets.cover, x0, b.y, b.cw, b.ch, 22); ctx.restore();
        drawLines(ctx, b.lines, b.x, b.y + b.ch + 22 * u, b.px * 1.15, font(800, b.px), pal.text, "center", fx, b.w);
      } else if (b.cw) {
        const x0 = al === "center" ? b.x + (b.w - b.tw) / 2 : b.x;
        ctx.save(); ctx.globalAlpha *= fx.alpha; drawCover(ctx, assets.cover, x0, b.y + (b.h - b.ch) / 2, b.cw, b.ch, 18); ctx.restore();
        drawLines(ctx, b.lines, x0 + b.cw + 40 * u, b.y + (b.h - b.lines.length * b.px * 1.15) / 2, b.px * 1.15, font(800, b.px), pal.text, "left", fx, b.w);
      } else {
        ctx.save(); ctx.globalAlpha *= fx.alpha; ctx.fillStyle = pal.accent; ctx.fillRect(al === "center" ? b.x + (b.w - b.tw) / 2 : b.x, b.y + 4, 8 * u, b.h - 8); ctx.restore();
        drawLines(ctx, b.lines, (al === "center" ? b.x + (b.w - b.tw) / 2 : b.x) + 30 * u, b.y + 5 * u, b.px * 1.15, font(800, b.px), pal.text, "left", fx, b.w);
      }
    } else if (b.id === "text") {
      const x0 = al === "center" ? b.x + (b.w - b.tw) / 2 : b.x;
      ctx.save(); ctx.globalAlpha *= fx.alpha; ctx.fillStyle = pal.accent; ctx.fillRect(x0, b.y + 4, 7 * u, b.h - 8); ctx.restore();
      drawLines(ctx, b.lines, x0 + 40 * u, b.y + 4 * u, b.px * 1.28, font(500, b.px, true), pal.text, "left", fx, b.w);
    } else if (b.id === "costreamers") {
      drawLines(ctx, [words.with], b.x, b.y, b.head, font(800, Math.max(22, b.head * 0.62)), pal.accent, "center", fx, b.w);
      const cells = layoutCostreamers(members.length, { x: b.x, y: b.y + b.head, w: b.w, h: b.h - b.head }, { maxD: b.d, gap: 28 * u, labelH: b.labelH });
      cells.forEach((cell, k) => {
        const a = clamp01(progress(t, startOf(blocks.indexOf(b)) + 0.15 * k, 0.5)) * fx.alpha, m = members[k];
        drawAvatar(ctx, cell, m, assets.avatars?.[m.login], pal, style === "minimal" ? fx.alpha : Math.max(a, 0));
        const px = Math.max(20, Math.min(34 * u, cell.d * 0.22));
        ctx.save(); ctx.font = font(700, px);
        // a slightly long name shrinks (down to 20 px) before being cut with "…": "Lune Douce" stays whole when there is room
        if (!m.more) { const w0 = ctx.measureText(m.name).width; if (w0 > cell.labelW && w0 > 0) ctx.font = font(700, Math.max(20, (px * cell.labelW) / w0)); }
        const label = m.more ? "" : ellipsize((s) => ctx.measureText(s).width, m.name, cell.labelW);
        ctx.globalAlpha = style === "minimal" ? fx.alpha : a; ctx.fillStyle = pal.text; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(label, cell.cx, cell.labelY); ctx.restore();
      });
    }
    ctx.restore();
  }

  function drawDigits(ctx, b, fx, t) {
    const settle = easeInOutCubic(progress(t, 0.5, duration * 0.5));
    const x0 = b.x + (b.w - b.tw) / 2, cellH = b.px * 1.12;
    ctx.save(); ctx.globalAlpha *= fx.alpha;
    b.groups.forEach(([unit, value], gi) => {
      const gx = x0 + gi * (b.gw + b.colon);
      for (let d = 0; d < 2; d++) {
        const digit = d === 0 ? Math.floor(value / 10) : value % 10, cx = gx + d * (b.cell + 14 * u);
        const spins = 6 + gi * 3 + d * 2, pos = digit + spins * (1 - settle);   // each digit "rolls" up to its value
        ctx.save(); roundRectPath(ctx, cx, b.y, b.cell, cellH, b.px * 0.12); ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.fill(); ctx.clip();
        ctx.fillStyle = pal.text; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = font(900, b.px * 0.92);
        const base = Math.floor(pos);
        for (let k = base - 1; k <= base + 2; k++) if (Math.abs((pos - k) * 1.04) < 0.95) ctx.fillText(String(((k % 10) + 10) % 10), cx + b.cell / 2, b.y + cellH / 2 + (pos - k) * cellH * 1.04);
        ctx.restore();
      }
      ctx.fillStyle = pal.soft; ctx.font = font(700, 40 * u); ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(words[unit], gx + b.gw / 2 - 7 * u, b.y + cellH + 10 * u);
      if (gi < b.groups.length - 1) {
        ctx.fillStyle = rgba(pal.text, 0.5 + 0.5 * Math.abs(Math.sin(t * Math.PI)));
        ctx.font = font(900, b.px * 0.8); ctx.textBaseline = "middle"; ctx.fillText(":", gx + b.gw + b.colon / 2 - 4 * u, b.y + cellH / 2 - 8 * u);
      }
    });
    ctx.restore();
  }

  function draw(ctx, rawT) {
    const t = Math.min(duration, Math.max(0, Number(rawT) || 0));
    ctx.save();
    background(ctx, t);
    blocks.forEach((b, i) => { const fx = fxFor(i, t); if (fx.alpha > 0.001) drawBlock(ctx, b, fx, t); });
    if (watermark) drawWatermark(ctx);
    ctx.restore();
  }

  return pack(draw, boxes, u, blocks);
}
