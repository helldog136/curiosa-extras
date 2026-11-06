// Six more styles for « Story d'annonce » (2.7.0): broadcast, kinetic, cinema, arcade, collage, geometric.
// Same contract as scenes.mjs: every image is a PURE FUNCTION OF TIME (same t, same pixels: grain, paper, jitter and weave are seeded by the time or by a constant, never by a clock),
// text is drawn with fillText only, nothing here knows the page, the network or the browser. `createScene` (scenes.mjs) hands over a `kit` (sizes, content, fonts, small drawing tools)
// and gets back the layout and a `draw(ctx, t)`; it adds the "Made with Curiosa" mention itself, so the watermark never depends on a style.
// Craft rules shared by the six: real easing (ease-out in, ease-in-out for moves, restrained overshoot), staggered entrances that all END before `restTime` (78 % of the video),
// then a deliberate hold: the composition is still and readable for the last 22 %. Every duration below is a fraction of the video length, so 5 s and 15 s both read well.
import { wrapText, ellipsize, solveScale, layoutCostreamers, initials, mix, rgba, readableOn, ensureContrast, contrast, luminance, parseHex, toHex, clamp01, easeOutCubic, easeInOutCubic, progress, seeded } from "./pure.mjs";

export const EXTRA_STYLES = ["broadcast", "kinetic", "cinema", "arcade", "collage", "geometric"];
/** The few words these styles write themselves (the rest comes from the editor). Neutral, and given for both languages. */
export const EXTRA_WORDS = { fr: { next: "À SUIVRE", start: "START" }, en: { next: "UP NEXT", start: "START" } };

/* ───────────── Time and easing ───────────── */
const xOutQuart = (x) => 1 - (1 - clamp01(x)) ** 4;
const xOutExpo = (x) => { const t = clamp01(x); return t >= 1 ? 1 : 1 - 2 ** (-10 * t); };
const xInOutQuart = (x) => { const t = clamp01(x); return t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2; };
const xInOutSine = (x) => -(Math.cos(Math.PI * clamp01(x)) - 1) / 2;
/** Overshoot kept small (s = 1.0 is about 3 %): only where the style asks for it (a stamp, a slap). */
const xOutBack = (x, s = 1.0) => { const t = clamp01(x); return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2; };
/** Eased progress of a move that starts at `at` and lasts `len` seconds. */
const xSeg = (t, at, len, ease = easeOutCubic) => ease(progress(t, at, len));
/** One entrance length for the whole video: 0.42 s at 5 s, 0.85 s at 15 s and more. */
const xLen = (D) => Math.min(0.85, Math.max(0.42, D * 0.05));
/** The start times of `n` entrances spread over [from, to] (fractions of the video); the last one ENDS at `to`. */
function xStarts(D, n, len, from = 0.04, to = 0.66) {
  const a = from * D, b = Math.max(a, to * D - len), step = n > 1 ? Math.min((b - a) / (n - 1), 0.07 * D + 0.1) : 0;   // never slower than about one beat per second at 15 s
  return Array.from({ length: n }, (_, i) => a + step * i);
}

/* ───────────── Colours ───────────── */
function xToHsl(hex) {
  const [r, g, b] = (parseHex(hex) ?? [0, 0, 0]).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function xFromHsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}
/** A fill that carries text well (4.8:1 for white or for near-black): the colour itself unless it sits in the grey zone where neither reads, then nudged just enough. */
function xFill(c) {
  const best = (x) => Math.max(contrast(x, "#ffffff"), contrast(x, "#111111"));
  if (best(c) >= 4.8) return c;
  const toward = contrast(c, "#ffffff") >= contrast(c, "#111111") ? "#000000" : "#ffffff";
  for (let i = 1; i <= 10; i++) { const m = mix(c, toward, i / 10); if (best(m) >= 4.8) return m; }
  return toward;
}
/** The second colour of the site; when it is (nearly) the same as the first, a partner colour is derived by turning the hue, so a one-colour site still gets two voices. */
function xPartner(accent, accent2) {
  const a = parseHex(accent), b = parseHex(accent2), near = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 70;
  if (!near) return accent2;
  const [h, s, l] = xToHsl(accent);
  return xFromHsl((h + 150) % 360, Math.max(0.45, Math.min(0.8, s)), Math.max(0.4, Math.min(0.62, l)));
}
/** A colour made vivid enough to show on a dark ground. */
const xBoost = (c, against, ratio = 4.5) => ensureContrast(luminance(c) < 0.25 ? mix(c, "#ffffff", 0.4) : c, against, ratio);

export function extraPalette(style, input = {}) {
  const ok = (c) => /^#[0-9a-f]{6}$/i.test(c ?? "");
  const accent = ok(input.accent) ? input.accent : "#7c5cff", accent2 = ok(input.accent2) ? input.accent2 : accent, bg = ok(input.bg) ? input.bg : "#111111";
  const partner = xPartner(accent, accent2);
  const done = (p) => ({ ring: p.accent, bg0: p.base, bg1: p.base, ...p });
  if (style === "broadcast") {
    const base = mix("#06080c", accent, 0.13), accentC = xBoost(accent, base, 4.5), b = xBoost(partner, base, 4.5), text = "#f4f6f9";
    return done({ base, text, accent: accentC, accent2: b, soft: ensureContrast(mix(text, base, 0.36), base, 4.5), panel: mix(base, "#ffffff", 0.08), line: mix(base, "#ffffff", 0.24), fill: xFill(accentC), fill2: xFill(b) });
  }
  if (style === "kinetic") {
    const field = xFill(accent), text = readableOn(field), alt = ensureContrast(xPartner(accent, accent2), field, 3);
    return done({ base: field, text: ensureContrast(text, field, 7), accent: ensureContrast(alt, field, 4.5), accent2: alt, soft: ensureContrast(mix(text, field, 0.3), field, 4.5), ink: text });
  }
  if (style === "cinema") {
    const base = mix("#0a0908", accent, 0.05), text = mix("#f3eee4", accent, 0.05);
    return done({ base, text, accent: ensureContrast(mix(accent, "#ffffff", luminance(accent) < 0.35 ? 0.4 : 0.15), base, 4.5), accent2: ensureContrast(partner, base, 4.5), soft: ensureContrast(mix(text, base, 0.42), base, 4.5) });
  }
  if (style === "arcade") {
    const base = mix("#07070f", accent, 0.2), c1 = xBoost(accent, base, 4.5), c2 = xBoost(partner, base, 4.5), text = "#f7f1de";
    return done({ base, text, accent: c1, accent2: c2, soft: ensureContrast(mix(text, base, 0.3), base, 4.5), panel: mix(base, "#ffffff", 0.07), shade: mix(base, "#000000", 0.55), hi: mix(c1, "#ffffff", 0.45), lo: mix(c1, "#000000", 0.45), fill: xFill(c1), fill2: xFill(c2) });
  }
  if (style === "collage") {
    const paper = mix("#efe6d2", bg, 0.08), ink = "#1b1814", accentC = xFill(accent), b = xFill(partner);
    return done({ base: paper, text: ensureContrast(ink, paper, 7), accent: ensureContrast(accent, paper, 4.5), accent2: ensureContrast(partner, paper, 4.5), soft: ensureContrast(mix(ink, paper, 0.38), paper, 4.5), paper, ink, cream: "#f8f3e6", kraft: mix("#c8a878", accent, 0.1), s1: accentC, s2: b });
  }
  // geometric
  const dark = luminance(bg) < 0.3, field = dark ? mix(bg, "#000000", 0.3) : mix(bg, "#ffffff", 0.55), ink = readableOn(field);
  const need = dark ? 3 : 1.9, c1 = ensureContrast(accent, field, need), c2 = ensureContrast(partner, field, need);   // shapes are not text: a pale accent on a light field stays pale instead of turning muddy
  return done({ base: field, text: ensureContrast(ink, field, 7), accent: ensureContrast(accent, field, 4.5), accent2: ensureContrast(partner, field, 4.5), soft: ensureContrast(mix(ink, field, 0.34), field, 4.5), ink, c1, c2, dark });
}

/* ───────────── Text tools ───────────── */
/** No text below 20 px (on 1080 of width), whatever the scale: a crowded layout shrinks its pictures and gaps before its words. */
const xFont = (K, weight, px, italic, fam) => `${italic ? "italic " : ""}${weight} ${Math.max(20, Math.round(px))}px ${fam ?? K.family}`;
const xMeasure = (K, f) => (s) => { K.mctx.font = f; return K.mctx.measureText(s).width; };
/** Width of a string drawn glyph by glyph with `tr` pixels of tracking between glyphs. */
const xTW = (m, s, tr) => { const g = [...s]; let w = 0; for (const c of g) w += m(c); return w + tr * Math.max(0, g.length - 1); };
function xDrawTracked(ctx, str, x, y, tr, align = "left") {
  const g = [...str], ws = g.map((c) => ctx.measureText(c).width), tw = ws.reduce((a, b) => a + b, 0) + tr * Math.max(0, g.length - 1);
  let cx = align === "center" ? x - tw / 2 : align === "right" ? x - tw : x;
  ctx.textAlign = "left";
  g.forEach((c, i) => { ctx.fillText(c, cx, y); cx += ws[i] + tr; });
  return tw;
}
/** Baseline of a line of capitals or figures sitting optically in the middle of a line box. */
const xBase = (top, lh, px) => top + lh / 2 + px * 0.36;
/**
 * Wraps `text` into at most `maxLines` lines that fit `width`; a long text shrinks (down to `minFrac`) rather than being cut.
 * o: { fam, weight, px, italic, track (em), lhr, width, maxLines, okLines, minFrac, upper, shrink }.
 */
function xFit(K, text, o) {
  const src = xGlue(o.upper ? String(text).toLocaleUpperCase(K.lang) : String(text));
  let res = null;
  for (let f = 1; f >= (o.shrink === false ? 1 : o.minFrac ?? 0.5) - 1e-9; f -= 0.05) {
    const px = o.px * f, font = xFont(K, o.weight, px, o.italic, o.fam), m0 = xMeasure(K, font), tr = (o.track || 0) * px, mm = tr ? (s) => xTW(m0, s, tr) : m0, m = (s) => mm(s.replaceAll(XGLUE, " "));
    const lines = wrapText(m, src, o.width, o.maxLines).map((l) => l.replaceAll(XGLUE, " "));
    const cut = lines.length > 0 && lines[lines.length - 1].endsWith("…") && !src.endsWith("…");
    res = { lines, px, lh: px * (o.lhr ?? 1.1), tw: Math.max(0, ...lines.map(m)), tr, font, f, m };
    if (!cut && lines.length <= (o.okLines ?? o.maxLines)) {
      if (o.balance && lines.length > 1) {   // centred titles: even lines, no orphan word on the last one (the narrowest width that keeps the same number of lines)
        let lo = res.tw * 0.5, hi = o.width;
        for (let k = 0; k < 9; k++) { const mid = (lo + hi) / 2, ls = wrapText(m, src, mid, o.maxLines); if (ls.length === lines.length && !ls[ls.length - 1].endsWith("…")) hi = mid; else lo = mid; }
        res.lines = wrapText(m, src, hi, o.maxLines).map((l) => l.replaceAll(XGLUE, " ")); res.tw = Math.max(0, ...res.lines.map(m));
      }
      break;
    }
  }
  return res;
}
/** One line fitted to `width` by shrinking the size (never cut) down to `minFrac`, then ellipsized as the very last resort. */
function xFitLine(K, text, o) {
  const src = o.upper ? String(text).toLocaleUpperCase(K.lang) : String(text);
  let px = o.px, font, m0, tr, m;
  for (let f = 1; f >= (o.minFrac ?? 0.6) - 1e-9; f -= 0.04) {
    px = o.px * f; font = xFont(K, o.weight, px, o.italic, o.fam); m0 = xMeasure(K, font); tr = (o.track || 0) * px; m = tr ? (s) => xTW(m0, s, tr) : m0;
    if (m(src) <= o.width) return { text: src, px, font, tr, w: m(src), m };
  }
  const t = ellipsize(m, src, o.width);
  return { text: t, px, font, tr, w: m(t), m };
}
/** A line never starts with « : », « ! », « ? » or « ; » and never ends on « « »: those spaces are glued (a private mark that wrapping cannot split, turned back into a space after). */
const XGLUE = "\uE000";
const xGlue = (s) => s.replace(/ ([:;!?»])/g, `${XGLUE}$1`).replace(/(«) /g, `$1${XGLUE}`);
/** The name under a co-streamer: the size shrinks (to 20 px at the least) before the name is cut with « … ». Sets the font; returns the text to draw. */
function xNameFit(ctx, K, weight, px, text, maxW, fam) {
  ctx.font = xFont(K, weight, px, false, fam);
  const w = ctx.measureText(text).width;
  if (w > maxW && w > 0) ctx.font = xFont(K, weight, Math.max(20, (px * maxW) / w), false, fam);
  return ellipsize((s) => ctx.measureText(s).width, text, maxW);
}
/** Draws `fn` clipped to a rectangle (a crisp mask). */
function xClip(ctx, x, y, w, h, fn) { ctx.save(); ctx.beginPath(); ctx.rect(x, y, Math.max(0, w), Math.max(0, h)); ctx.clip(); fn(); ctx.restore(); }
/** A rectangle revealed by a wipe: p 0..1 from the left ("r"), the right ("l"), the bottom edge upward ("u") or the top edge downward ("d"). */
function xWipe(ctx, x, y, w, h, p, dir, fn) {
  if (p <= 0) return;
  if (dir === "r") xClip(ctx, x, y, w * p, h, fn);
  else if (dir === "l") xClip(ctx, x + w * (1 - p), y, w * p, h, fn);
  else if (dir === "u") xClip(ctx, x, y + h * (1 - p), w, h * p, fn);
  else xClip(ctx, x, y, w, h * p, fn);
}
const xImg = (img) => (img ? { w: img.naturalWidth || img.width || 0, h: img.naturalHeight || img.height || 0 } : { w: 0, h: 0 });
function xCover(ctx, img, x, y, w, h) {
  const s = xImg(img), k = Math.max(w / s.w, h / s.h), dw = s.w * k, dh = s.h * k;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); ctx.restore();
}
/** The photo of a co-streamer, or (no photo) a block of colour with the initials. `shape`: "circle" | "square". */
function xAvatar(ctx, K, cell, m, img, { shape = "circle", ring = null, ringW = 5, fg = "#ffffff", frame = 0 } = {}) {
  const r = cell.d / 2, x = cell.cx - r, y = cell.cy - r;
  const path = (inset) => { ctx.beginPath(); if (shape === "circle") ctx.arc(cell.cx, cell.cy, r - inset, 0, Math.PI * 2); else ctx.rect(x + inset, y + inset, cell.d - inset * 2, cell.d - inset * 2); };
  ctx.save();
  if (ring) { path(-ringW); ctx.fillStyle = ring; ctx.fill(); }
  if (frame) { path(-frame); ctx.fillStyle = "#ffffff"; ctx.fill(); }
  ctx.save(); path(0); ctx.clip();
  if (m.more) { ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(x, y, cell.d, cell.d); }
  else if (img && xImg(img).w > 0) { const s = xImg(img), k = Math.max(cell.d / s.w, cell.d / s.h); ctx.drawImage(img, cell.cx - (s.w * k) / 2, cell.cy - (s.h * k) / 2, s.w * k, s.h * k); }
  else { const hue = [...m.login].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7); ctx.fillStyle = `hsl(${hue},45%,34%)`; ctx.fillRect(x, y, cell.d, cell.d); }
  ctx.restore();
  if (m.more || !(img && xImg(img).w > 0)) { ctx.fillStyle = fg; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = xFont(K, 800, Math.max(20, cell.d * (m.more ? 0.34 : 0.38)), false); ctx.fillText(m.more ? m.name : initials(m.name || m.login), cell.cx, cell.cy + cell.d * 0.02); }
  ctx.restore();
}

/* ───────────── The layout engine (shared) ───────────── */
/**
 * Stacks the blocks a style builds, from top to bottom, in the area left by `reserveTop` / `reserveBottom`. `build(u, area)` returns blocks `{ id, h, … }` for the scale `u`;
 * the biggest `u` for which everything fits is found by bisection (little content = bigger elements, as in the first four styles). `gapAfter` (a multiplier) lets a style group blocks.
 */
function xLayout(K, spec) {
  const A = { ...K.A, y: K.A.y + (spec.reserveTop || 0), h: K.A.h - (spec.reserveTop || 0) - (spec.reserveBottom || 0) };
  if (spec.shrink && spec.shrink < 1) { const s = spec.shrink, cx = A.x + A.w / 2, cy = A.y + A.h / 2; A.w *= s; A.h *= s; A.x = cx - A.w / 2; A.y = cy - A.h / 2; }   // room for a slow push-in that never leaves the safe area
  const gapOf = (b, u) => spec.gap * u * (b.gapAfter ?? 1);
  const totalAt = (u) => { const bs = spec.build(u, A); return bs.reduce((s, b, i) => s + b.h + (i < bs.length - 1 ? gapOf(b, u) : 0), 0); };
  const u = solveScale(totalAt, A.h, spec.maxScale ?? 1.5, 0.25);
  const blocks = spec.build(u, A), n = blocks.length;
  const gaps = blocks.map((b) => gapOf(b, u)), used = blocks.reduce((s, b, i) => s + b.h + (i < n - 1 ? gaps[i] : 0), 0);
  const extra = Math.max(0, A.h - used), grow = n > 1 ? Math.min(extra / (n - 1), spec.gap * u * (spec.stretch ?? 1.4)) : 0, total = used + grow * Math.max(0, n - 1);
  let cursor = A.y + (spec.anchor === "top" ? 0 : spec.anchor === "bottom" ? Math.max(0, A.h - total) : Math.max(0, (A.h - total) / 2));
  blocks.forEach((b, i) => { b.x = A.x; b.w = A.w; b.y = cursor; cursor += b.h + gaps[i] + grow; });
  return { blocks, u, A };
}

/* ───────────── Which blocks exist ───────────── */
function xHas(K) {
  const c = K.content;
  return { brand: !!(c.brand || K.hasLogo), title: !!c.title, when: !!(c.dayLine || c.timeLine), countdown: !!c.countdown, game: !!c.game, text: !!c.text, costreamers: K.members.length > 0 };
}

/**
 * The entry point. `K`: { style, W, H, A (area left by the watermark), duration, content, assets, lang, words, family, pal, members, hasLogo, mctx, tools }.
 * Returns { blocks, boxes, scale, draw(ctx, t) } (no watermark: scenes.mjs draws it on top).
 */
export function createExtraScene(K) {
  K.D = K.duration; K.has = xHas(K); K.xw = EXTRA_WORDS[K.lang] ?? EXTRA_WORDS.en;   // `lang` is already "fr" or "en" (createScene)
  const spec = STYLE_IMPL[K.style](K);
  const { blocks, u, A } = xLayout(K, spec);
  K.u = u;
  spec.place?.(blocks, u, A);
  const boxes = blocks.map((b) => { const bw = Math.min(K.A.w, b.bw ?? b.w), bx = Math.min(Math.max(K.A.x, b.bx ?? b.x), K.A.x + K.A.w - bw); return { id: b.id, x: bx, y: b.y, w: bw, h: b.h }; });
  for (const e of spec.extraBoxes?.(blocks, u, A) ?? []) boxes.push(e);
  const draw = (ctx, t) => { ctx.save(); spec.bg?.(ctx, t, u); ctx.save(); spec.begin?.(ctx, t, u); blocks.forEach((b, i) => spec.block(ctx, b, t, i, u)); ctx.restore(); spec.fg?.(ctx, t, u); ctx.restore(); };
  return { blocks, boxes, scale: u, draw };
}

/* ═════════════════════════ 1. BROADCAST ═════════════════════════
 * A TV channel graphic: a strip of flat colour bars wipes in, lower-thirds follow with crisp masks, and a thin ticker at the bottom carries the day and the countdown.
 * Flat colour only, one grotesque sans, everything on a left edge. Calm and authoritative: nothing bounces. */
function styleBroadcast(K) {
  const { pal, content, assets, members, D, has } = K, L = xLen(D), A0 = K.A;
  const order = ["brand", "title", "when", "game", "text", "costreamers"].filter((id) => has[id]);
  const starts = xStarts(D, order.length, L, 0.07, 0.6), at = (id) => starts[order.indexOf(id)];
  const tickerOn = !!(content.dayLine || content.countdown), tickerH = 68, tickerY = A0.y + A0.h - tickerH;
  const tickerStart = Math.max(0.5 * D, D * 0.62 - L);
  const spec = { gap: 36, maxScale: 1.45, stretch: 1.3, reserveTop: 46, reserveBottom: tickerOn ? tickerH + 46 : 0 };
  const bars = [[5, pal.accent], [2, pal.accent2], [1, pal.text], [3, pal.line]], barsTotal = bars.reduce((s, b) => s + b[0], 0);

  spec.build = (u, Ar) => order.map((id) => {
    if (id === "brand") {
      const px = 30 * u, logo = K.hasLogo ? 64 * u : 0, gap = logo ? 20 * u : 0, f = xFont(K, 700, px), m0 = xMeasure(K, f), tr = px * 0.16;
      const name = content.brand ? ellipsize((s) => xTW(m0, s, tr), content.brand.toLocaleUpperCase(K.lang), Ar.w - logo - gap) : "";
      return { id, h: Math.max(logo, px * 1.5), logo, gap, name, px, tr, tw: logo + gap + (name ? xTW(m0, name, tr) : 0), gapAfter: 1.15 };
    }
    if (id === "title") {
      const bar = 14 * u, padX = 38 * u, padY = 32 * u, fit = xFit(K, content.title, { weight: 800, px: 104 * u, lhr: 1.04, width: Ar.w - bar - padX * 2, maxLines: 4, okLines: 3 });
      return { id, bar, padX, padY, fit, h: fit.lines.length * fit.lh + padY * 2, gapAfter: 0.55 };
    }
    if (id === "when") {
      const padX = 34 * u, padY = 24 * u, line = xFitLine(K, content.timeLine || content.dayLine, { weight: 800, px: 172 * u, width: Ar.w - padX * 2, minFrac: 0.4 });
      return { id, padX, padY, line, h: line.px * 0.72 + padY * 2, tw: line.w + padX * 2 };
    }
    if (id === "game") {
      const px = 62 * u, cover = K.tools.usable(assets.cover), cw = cover ? 180 * u : 0, ch = cover ? 240 * u : 0, gap = cover ? 34 * u : 0, bar = 8 * u;
      const fit = xFit(K, content.game, { weight: 800, px, lhr: 1.12, width: Ar.w - cw - gap, maxLines: 3, okLines: 3, minFrac: 0.6 });
      const th = fit.lines.length * fit.lh + bar + 16 * u;
      return { id, cover, cw, ch, gap, bar, fit, th, h: Math.max(ch, th), tw: cw + gap + fit.tw };
    }
    if (id === "text") {
      const px = 42 * u, fit = xFit(K, content.text, { weight: 500, px, lhr: 1.3, width: Ar.w - 8 * u, maxLines: 3, shrink: false });
      return { id, fit, h: fit.lines.length * fit.lh + 26 * u };
    }
    const rows = members.length <= 3 ? 1 : 2, d = 168 * u, labelH = Math.max(42 * u, 36), head = 46 * u;
    return { id, rows, d, labelH, head, h: head + rows * (d + labelH + 8) + (rows - 1) * Math.min(28 * u, 20) };
  });
  spec.place = (blocks) => blocks.forEach((b) => { b.bx = b.x; b.bw = b.tw ? Math.min(b.w, b.tw) : b.w; });
  spec.extraBoxes = () => (tickerOn ? [{ id: "ticker", x: A0.x, y: tickerY, w: A0.w, h: tickerH }] : []);

  spec.bg = (ctx, t) => {
    ctx.fillStyle = pal.base; ctx.fillRect(0, 0, K.W, K.H);
    // the colour bars: flat segments that wipe in one after the other, left to right
    let x = A0.x; const gap = 6, unit = (A0.w - gap * (bars.length - 1)) / barsTotal;
    bars.forEach(([k, col], i) => {
      const w = unit * k, p = xSeg(t, 0.05 * D + i * L * 0.22, L * 0.9, xInOutQuart);
      xWipe(ctx, x, A0.y, w, 14, p, "r", () => { ctx.fillStyle = col; ctx.fillRect(x, A0.y, w, 14); });
      x += w + gap;
    });
  };
  spec.block = (ctx, b, t, i) => {
    const s = at(b.id);
    if (b.id === "brand") {
      const p = xSeg(t, s, L, xOutQuart);
      xClip(ctx, b.x, b.y, b.w, b.h, () => {
        ctx.translate(0, (1 - p) * b.h);
        if (b.logo) xCover(ctx, assets.logo, b.x, b.y + (b.h - b.logo) / 2, b.logo, b.logo);
        if (b.name) { ctx.font = xFont(K, 700, b.px); ctx.fillStyle = pal.soft; ctx.textBaseline = "alphabetic"; xDrawTracked(ctx, b.name, b.x + b.logo + b.gap, xBase(b.y, b.h, b.px), b.tr); }
      });
    } else if (b.id === "title") {
      const p = xSeg(t, s, L * 1.1, xInOutQuart), f = b.fit;
      xWipe(ctx, b.x, b.y, b.w, b.h, p, "r", () => {
        ctx.fillStyle = pal.panel; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.fillStyle = pal.accent; ctx.fillRect(b.x, b.y, b.bar, b.h);
        ctx.font = f.font; ctx.fillStyle = pal.text; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
        f.lines.forEach((line, k) => {
          const top = b.y + b.padY + k * f.lh, lp = xSeg(t, s + L * 0.4 + k * 0.08, L * 0.8, xOutQuart);
          xClip(ctx, b.x + b.bar, top, b.w - b.bar, f.lh, () => ctx.fillText(line, b.x + b.bar + b.padX, xBase(top, f.lh, f.px) + (1 - lp) * f.lh));
        });
      });
    } else if (b.id === "when") {
      const p = xSeg(t, s, L, xInOutQuart), w = b.tw, l = b.line;
      xWipe(ctx, b.x, b.y, w, b.h, p, "r", () => {
        ctx.fillStyle = pal.fill; ctx.fillRect(b.x, b.y, w, b.h);
        const lp = xSeg(t, s + L * 0.45, L * 0.8, xOutQuart);
        xClip(ctx, b.x, b.y, w, b.h, () => { ctx.font = l.font; ctx.fillStyle = readableOn(pal.fill); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillText(l.text, b.x + b.padX, xBase(b.y, b.h, l.px) + (1 - lp) * b.h); });
      });
    } else if (b.id === "game") {
      const p = xSeg(t, s, L, xInOutQuart), f = b.fit;
      xWipe(ctx, b.x, b.y, b.w, b.h, p, "r", () => {
        if (b.cover) { xCover(ctx, assets.cover, b.x, b.y + (b.h - b.ch) / 2, b.cw, b.ch); ctx.strokeStyle = pal.line; ctx.lineWidth = 2; ctx.strokeRect(b.x + 1, b.y + (b.h - b.ch) / 2 + 1, b.cw - 2, b.ch - 2); }
        const tx = b.x + b.cw + b.gap, top = b.y + (b.h - b.th) / 2;
        ctx.fillStyle = pal.accent2; ctx.fillRect(tx, top, 64 * K.u, b.bar);
        ctx.font = f.font; ctx.fillStyle = pal.text; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        f.lines.forEach((line, k) => ctx.fillText(line, tx, xBase(top + b.bar + 16 * K.u + k * f.lh, f.lh, f.px)));
      });
    } else if (b.id === "text") {
      const p = xSeg(t, s, L, xInOutQuart), f = b.fit;
      xWipe(ctx, b.x, b.y, b.w, b.h, p, "r", () => {
        ctx.fillStyle = pal.line; ctx.fillRect(b.x, b.y, b.w, 2);
        ctx.font = f.font; ctx.fillStyle = pal.soft; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        f.lines.forEach((line, k) => ctx.fillText(line, b.x, xBase(b.y + 26 * K.u + k * f.lh, f.lh, f.px) - 8 * K.u));
      });
    } else if (b.id === "costreamers") {
      const p = xSeg(t, s, L, xInOutQuart), px = Math.max(22, b.head * 0.6);
      xWipe(ctx, b.x, b.y, b.w, b.h, p, "r", () => {
        ctx.fillStyle = pal.accent; ctx.font = xFont(K, 800, px); ctx.textBaseline = "alphabetic"; xDrawTracked(ctx, K.words.with, b.x, xBase(b.y, b.head, px), px * 0.18);
        const cols = b.rows === 1 ? members.length : Math.ceil(members.length / 2), gap = 28 * K.u, box = { x: b.x, y: b.y + b.head, w: Math.min(b.w, cols * (b.d + gap + 30)), h: b.h - b.head };
        const cells = layoutCostreamers(members.length, box, { maxD: b.d, gap, labelH: b.labelH }), shift = b.x - Math.min(...cells.map((c) => c.cx - Math.max(c.d, c.labelW) / 2));
        cells.forEach((cell, k) => {
          cell.cx += shift; const m = members[k]; xAvatar(ctx, K, cell, m, assets.avatars?.[m.login], { ring: pal.accent, ringW: 4 });
          ctx.fillStyle = pal.text; ctx.textAlign = "center"; ctx.textBaseline = "top";
          ctx.fillText(m.more ? "" : xNameFit(ctx, K, 700, Math.min(30 * K.u, cell.d * 0.2), m.name, cell.labelW), cell.cx, cell.labelY);
        });
      });
    }
  };
  spec.fg = (ctx, t) => {
    if (!tickerOn) return;
    const w = A0.w, x0 = A0.x, y0 = tickerY, h = tickerH, tabPx = 26, tabTr = tabPx * 0.18, f = xFont(K, 800, tabPx);
    ctx.font = f; const tabW = xTW((s) => ctx.measureText(s).width, K.xw.next, tabTr) + 52;
    const p1 = xSeg(t, tickerStart, L * 0.9, xInOutQuart), p2 = xSeg(t, tickerStart + L * 0.25, L * 1.1, xInOutQuart), p3 = xSeg(t, tickerStart + L * 0.6, L * 0.9, xOutQuart);
    xWipe(ctx, x0, y0, w, h, p2, "r", () => { ctx.fillStyle = pal.panel; ctx.fillRect(x0, y0, w, h); ctx.fillStyle = pal.line; ctx.fillRect(x0, y0, w, 2); });
    xWipe(ctx, x0, y0, tabW, h, p1, "r", () => {
      ctx.fillStyle = pal.fill; ctx.fillRect(x0, y0, tabW, h);
      ctx.font = f; ctx.fillStyle = readableOn(pal.fill); ctx.textBaseline = "alphabetic"; xDrawTracked(ctx, K.xw.next, x0 + 26, xBase(y0, h, tabPx), tabTr);
    });
    xClip(ctx, x0 + tabW, y0 + 2, w - tabW, h - 2, () => {
      ctx.translate(0, (1 - p3) * h);
      const px = 30, tr = px * 0.1, inner = w - tabW - 56, cd = content.countdown ? xFitLine(K, content.countdown, { weight: 800, px, upper: true, track: 0.1, width: inner * 0.5, minFrac: 0.7 }) : null;
      const day = content.dayLine ? xFitLine(K, content.dayLine, { weight: 700, px, upper: true, track: 0.1, width: inner - (cd ? cd.w + 40 : 0), minFrac: 0.7 }) : null;
      ctx.textBaseline = "alphabetic";
      if (day) { ctx.font = day.font; ctx.fillStyle = pal.text; xDrawTracked(ctx, day.text, x0 + tabW + 28, xBase(y0 + 2, h - 2, px), day.tr); }
      if (cd) { ctx.font = cd.font; ctx.fillStyle = pal.accent; xDrawTracked(ctx, cd.text, x0 + w - 28, xBase(y0 + 2, h - 2, px), cd.tr, "right"); }
    });
  };
  return spec;
}

/* ═════════════════════════ 2. KINETIC TYPE ═════════════════════════
 * The typography IS the picture: a flat field of the site colour, flush-left capitals set tight, every line slamming up through its own rectangular mask, every other line cut in
 * a little to the right. The time is set as big as the width allows, with an outlined echo of it cropped by the bottom of its block. One bar, no other decoration. */
function styleKinetic(K) {
  const { pal, content, assets, members, D, has } = K, L = xLen(D), ink = pal.ink, field = pal.base;
  const order = ["brand", "title", "when", "game", "text", "costreamers"].filter((id) => has[id]);
  const starts = xStarts(D, order.length, L, 0.04, 0.6), at = (id) => starts[order.indexOf(id)];
  const spec = { gap: 40, maxScale: 1.35, stretch: 1.2 };
  const slam = 0.62 * L;   // a slam is quick: the settling is what the eye reads

  spec.build = (u, Ar) => order.map((id) => {
    if (id === "brand") {
      const px = 28 * u, logo = K.hasLogo ? 56 * u : 0, gap = logo ? 18 * u : 0, f = xFont(K, 800, px), m0 = xMeasure(K, f), tr = px * 0.16;
      const name = content.brand ? ellipsize((s) => xTW(m0, s, tr), content.brand.toLocaleUpperCase(K.lang), Ar.w - logo - gap) : "";
      return { id, h: Math.max(logo, px * 1.5), logo, gap, name, px, tr, tw: logo + gap + (name ? xTW(m0, name, tr) : 0) };
    }
    if (id === "title") {
      const ind = Ar.w * 0.055, fit = xFit(K, content.title, { weight: 900, px: 150 * u, lhr: 0.92, track: -0.02, upper: true, width: Ar.w - ind, maxLines: 4, okLines: 3, minFrac: 0.4 }), barH = 22 * u, barGap = 30 * u;
      return { id, ind, fit, barH, barGap, h: fit.lines.length * fit.lh + barGap + barH, gapAfter: 1.1 };
    }
    if (id === "when") {
      const day = content.timeLine && content.dayLine ? xFitLine(K, content.dayLine, { weight: 700, px: 44 * u, upper: true, track: 0.14, width: Ar.w, minFrac: 0.6 }) : null;
      if (content.timeLine) {
        const main = xFitLine(K, content.timeLine, { weight: 900, px: 380 * u, track: -0.03, width: Ar.w, minFrac: 0.3 }), dayH = day ? day.px * 1.7 : 0;
        return { id, day, dayH, main, echo: true, h: dayH + main.px * 0.74 + main.px * 0.56, gapAfter: 1.1 };
      }
      const main = xFitLine(K, content.dayLine, { weight: 900, px: 120 * u, upper: true, track: -0.02, width: Ar.w, minFrac: 0.4 });
      return { id, day: null, dayH: 0, main, echo: false, h: main.px * 0.82, gapAfter: 1.1 };
    }
    if (id === "game") {
      const cover = K.tools.usable(assets.cover), cw = cover ? 190 * u : 0, ch = cover ? 254 * u : 0, gap = cover ? 36 * u : 0;
      const fit = xFit(K, content.game, { weight: 900, px: 78 * u, lhr: 0.98, track: -0.01, upper: true, width: Ar.w - cw - gap, maxLines: 3, okLines: 3, minFrac: 0.55 });
      return { id, cover, cw, ch, gap, fit, h: Math.max(ch, fit.lines.length * fit.lh + fit.px * 0.14), tw: Ar.w };
    }
    if (id === "text") {
      const fit = xFit(K, content.text, { weight: 600, px: 46 * u, lhr: 1.28, width: Ar.w, maxLines: 3, shrink: false });
      return { id, fit, h: fit.lines.length * fit.lh };
    }
    const rows = members.length <= 3 ? 1 : 2, d = 150 * u, labelH = Math.max(40 * u, 36), head = 44 * u;
    return { id, rows, d, labelH, head, h: head + rows * (d + labelH + 8) + (rows - 1) * Math.min(24 * u, 18) };
  });
  spec.place = (blocks) => blocks.forEach((b) => { b.bx = b.x; b.bw = b.tw ? Math.min(b.w, b.tw) : b.w; });
  spec.bg = (ctx) => { ctx.fillStyle = field; ctx.fillRect(0, 0, K.W, K.H); };

  const lineMask = (ctx, x, top, w, h, p, fn) => xClip(ctx, x, top, w, h, () => { ctx.translate(0, (1 - p) * h * 1.3); fn(); });
  spec.block = (ctx, b, t) => {
    const s = at(b.id);
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    if (b.id === "brand") {
      const p = xSeg(t, s, L * 0.8, xOutExpo);
      xClip(ctx, b.x, b.y, b.w, b.h, () => {
        ctx.translate(-(1 - p) * 60, 0); ctx.globalAlpha = clamp01(p * 2);
        if (b.logo) xCover(ctx, assets.logo, b.x, b.y + (b.h - b.logo) / 2, b.logo, b.logo);
        if (b.name) { ctx.font = xFont(K, 800, b.px); ctx.fillStyle = pal.soft; xDrawTracked(ctx, b.name, b.x + b.logo + b.gap, xBase(b.y, b.h, b.px), b.tr); }
      });
    } else if (b.id === "title") {
      const f = b.fit;
      f.lines.forEach((line, k) => {
        const top = b.y + k * f.lh, p = xSeg(t, s + k * 0.11 * (D / 15 + 0.4), slam, xOutExpo), x = b.x + (k % 2 ? b.ind : 0);
        lineMask(ctx, b.x, top, b.w, f.lh * 1.04, p, () => { ctx.font = f.font; ctx.fillStyle = pal.text; xDrawTracked(ctx, line, x, xBase(top, f.lh, f.px) + f.px * 0.03, f.tr); });
      });
      const by = b.y + f.lines.length * f.lh + b.barGap, bp = xSeg(t, s + f.lines.length * 0.11 + 0.12, L * 1.1, xOutExpo);
      ctx.fillStyle = pal.accent; ctx.fillRect(b.x, by, b.w * 0.34 * bp, b.barH);
    } else if (b.id === "when") {
      const m = b.main;
      if (b.day) { const p = xSeg(t, s, slam, xOutExpo); lineMask(ctx, b.x, b.y, b.w, b.dayH, p, () => { ctx.font = b.day.font; ctx.fillStyle = pal.soft; xDrawTracked(ctx, b.day.text, b.x, xBase(b.y, b.dayH, b.day.px), b.day.tr); }); }
      const base = b.y + b.dayH + m.px * 0.74, p = xSeg(t, s + 0.08, slam * 1.3, xOutExpo);
      xClip(ctx, b.x, b.y + b.dayH - 4, b.w, m.px * 0.74 + 8, () => { ctx.translate(0, (1 - p) * m.px * 0.85); ctx.font = m.font; ctx.fillStyle = pal.text; xDrawTracked(ctx, m.text, b.x, base, m.tr); });
      if (b.echo) {
        // the echo: the same figures as an outline, sliding in from the right to its place, cropped by the bottom edge of the block
        const ep = xSeg(t, s + 0.2, L * 1.8, xInOutQuart), ex = b.x + (1 - ep) * (b.w * 0.5), top = base + m.px * 0.17;
        xClip(ctx, b.x, top, b.w, b.y + b.h - top, () => {
          ctx.font = m.font; ctx.strokeStyle = pal.text; ctx.lineWidth = Math.max(3, m.px * 0.012); ctx.globalAlpha = clamp01(ep * 3) * 0.9; ctx.lineJoin = "round";
          let cx = ex; for (const c of [...m.text]) { ctx.strokeText(c, cx, base + m.px * 0.9); cx += ctx.measureText(c).width + m.tr; }
        });
      }
    } else if (b.id === "game") {
      const p = xSeg(t, s, slam * 1.3, xOutExpo), f = b.fit, top = b.y + (b.cover ? (b.h - f.lines.length * f.lh - f.px * 0.14) / 2 : 0);
      f.lines.forEach((line, k) => lineMask(ctx, b.x, top + k * f.lh, b.w - b.cw - b.gap, f.lh * 1.04, xSeg(t, s + k * 0.09, slam, xOutExpo), () => { ctx.font = f.font; ctx.fillStyle = pal.text; xDrawTracked(ctx, line, b.x, xBase(top + k * f.lh, f.lh, f.px), f.tr); }));
      if (b.cover) { const cx = b.x + b.w - b.cw; xClip(ctx, cx, b.y, b.cw, b.h, () => { ctx.translate((1 - p) * b.cw, 0); xCover(ctx, assets.cover, cx, b.y + (b.h - b.ch) / 2, b.cw, b.ch); }); }
    } else if (b.id === "text") {
      const f = b.fit;
      f.lines.forEach((line, k) => lineMask(ctx, b.x, b.y + k * f.lh, b.w, f.lh, xSeg(t, s + k * 0.1, slam, xOutExpo), () => { ctx.font = f.font; ctx.fillStyle = pal.soft; ctx.fillText(line, b.x, xBase(b.y + k * f.lh, f.lh, f.px) - f.px * 0.08); }));
    } else if (b.id === "costreamers") {
      const p = xSeg(t, s, slam, xOutExpo), px = Math.max(22, b.head * 0.62);
      lineMask(ctx, b.x, b.y, b.w, b.head, p, () => { ctx.fillStyle = pal.accent; ctx.font = xFont(K, 800, px); xDrawTracked(ctx, K.words.with, b.x, xBase(b.y, b.head, px), px * 0.18); });
      const cols = b.rows === 1 ? members.length : Math.ceil(members.length / 2), gap = 24 * K.u, box = { x: b.x, y: b.y + b.head, w: Math.min(b.w, cols * (b.d + gap + 30)), h: b.h - b.head };
      const cells = layoutCostreamers(members.length, box, { maxD: b.d, gap, labelH: b.labelH }), shift = b.x - Math.min(...cells.map((c) => c.cx - Math.max(c.d, c.labelW) / 2));
      cells.forEach((cell, k) => {
        cell.cx += shift; const m = members[k], q = xSeg(t, s + 0.1 + k * 0.08, slam, xOutExpo), top = cell.cy - cell.d / 2;
        xClip(ctx, cell.cx - cell.labelW / 2, top - 2, cell.labelW, cell.d + b.labelH + 12, () => {
          ctx.translate(0, (1 - q) * (cell.d + b.labelH + 24));
          xAvatar(ctx, K, cell, m, assets.avatars?.[m.login], { shape: "square" });
          ctx.fillStyle = pal.text; ctx.textAlign = "center"; ctx.textBaseline = "top";
          ctx.fillText(m.more ? "" : xNameFit(ctx, K, 800, Math.min(28 * K.u, cell.d * 0.19), m.name.toLocaleUpperCase(K.lang), cell.labelW), cell.cx, cell.labelY);
        });
      });
    }
  };
  return spec;
}

/* ═════════════════════════ 3. CINEMA ═════════════════════════
 * A film title card. Letterbox bars close in, everything fades up slowly in a serif, the details are set in tracked capitals like the credits of a film, and the co-streamers
 * roll as end credits (two columns of names around the centre axis). A slow push-in (it settles before the hold), a hair of gate weave and seeded 24 fps grain keep the
 * picture alive; the grain never touches the text, which is perfectly still from `restTime` on. */
const XSERIF = 'Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", serif';
function styleCinema(K) {
  const { pal, content, assets, members, D, has, W, H } = K, A0 = K.A, Lf = Math.min(1.5, Math.max(0.7, D * 0.09)), barLen = Math.min(2.2, Math.max(1.0, D * 0.12)), PUSH = 0.04;
  const order = ["brand", "title", "when", "countdown", "game", "text", "costreamers"].filter((id) => has[id]);
  const starts = xStarts(D, order.length, Lf, (barLen * 0.55) / D, 0.66), at = (id) => starts[order.indexOf(id)];
  const barH = Math.round(Math.min(210, Math.max(44, A0.y - 30)));
  const spec = { gap: 40, maxScale: 1.4, stretch: 1.3, shrink: 1 / (1 + PUSH) };
  const rest = D * 0.78;

  spec.build = (u, Ar) => order.map((id) => {
    if (id === "brand") {
      const px = 26 * u, logo = K.hasLogo ? 60 * u : 0, gap = logo ? 20 * u : 0, f = xFont(K, 400, px, false, XSERIF), m0 = xMeasure(K, f), tr = px * 0.32;
      const name = content.brand ? ellipsize((s) => xTW(m0, s, tr), content.brand.toLocaleUpperCase(K.lang), Ar.w - logo - gap) : "";
      return { id, h: Math.max(logo, px * 1.5), logo, gap, name, px, tr, tw: logo + gap + (name ? xTW(m0, name, tr) : 0), gapAfter: 1.2 };
    }
    if (id === "title") {
      const fit = xFit(K, content.title, { fam: XSERIF, weight: 400, px: 104 * u, lhr: 1.12, width: Ar.w, maxLines: 4, okLines: 3, minFrac: 0.42, balance: true });
      return { id, fit, h: fit.lines.length * fit.lh, tw: fit.tw, gapAfter: 1.25 };
    }
    if (id === "when") {
      const day = content.dayLine ? xFitLine(K, content.dayLine, { fam: XSERIF, weight: 400, px: 32 * u, upper: true, track: 0.28, width: Ar.w, minFrac: 0.6 }) : null;
      const time = content.timeLine ? xFitLine(K, content.timeLine, { fam: XSERIF, weight: 400, italic: true, px: 112 * u, width: Ar.w, minFrac: 0.5 }) : null;
      const dh = day ? day.px * 1.9 : 0, th = time ? time.px * 1.1 : 0;
      return { id, day, time, dh, th, h: dh + th, tw: Math.max(day?.w ?? 0, time?.w ?? 0) };
    }
    if (id === "countdown") {
      const line = xFitLine(K, content.countdown, { fam: XSERIF, weight: 400, italic: true, px: 46 * u, width: Ar.w, minFrac: 0.6 });
      return { id, line, h: line.px * 1.3, tw: line.w };
    }
    if (id === "game") {
      const cover = K.tools.usable(assets.cover), cw = cover ? 200 * u : 0, ch = cover ? 280 * u : 0;
      const fit = xFit(K, content.game, { fam: XSERIF, weight: 400, px: 34 * u, upper: true, track: 0.24, lhr: 1.5, width: Ar.w, maxLines: 2, okLines: 2, minFrac: 0.6 });
      return { id, cover, cw, ch, fit, gapIn: cover ? 26 * u : 0, h: ch + (cover ? 26 * u : 0) + fit.lines.length * fit.lh, tw: Math.max(cw, fit.tw) };
    }
    if (id === "text") {
      const fit = xFit(K, content.text, { fam: XSERIF, weight: 400, italic: true, px: 44 * u, lhr: 1.3, width: Ar.w * 0.86, maxLines: 3, shrink: false, balance: true });
      return { id, fit, h: fit.lines.length * fit.lh, tw: fit.tw };
    }
    const n = members.length, rows = n <= 3 ? n : Math.ceil(n / 2), px = 32 * u, lh = px * 1.75, head = 26 * u * 2.1;
    const f = xFont(K, 400, px, false, XSERIF), m0 = xMeasure(K, f), tr = px * 0.2, nameOf = (m) => ellipsize((s) => xTW(m0, s, tr), m.name.toLocaleUpperCase(K.lang), Ar.w * (n <= 3 ? 0.8 : 0.42));
    const names = members.map(nameOf), two = n > 3;
    return { id, rows, px, lh, head, tr, names, two, h: head + rows * lh, tw: Ar.w * (two ? 0.9 : Math.max(...names.map((s) => xTW(m0, s, tr)), 100) / Ar.w) };
  });
  spec.place = (blocks) => blocks.forEach((b) => { b.bw = Math.min(b.w, b.tw ?? b.w); b.bx = b.x + (b.w - b.bw) / 2; });

  spec.bg = (ctx) => { ctx.fillStyle = pal.base; ctx.fillRect(0, 0, W, H); };
  const cxA = A0.x + A0.w / 2, cyA = A0.y + A0.h / 2;
  spec.begin = (ctx, t) => {
    // slow push-in that has settled when the hold begins, plus a hair of gate weave (under one pixel)
    const k = 1 + PUSH * xInOutSine(progress(t, 0, rest)), wx = 0.5 * Math.sin(t * 2.3) + 0.25 * Math.sin(t * 7.9 + 1), wy = 0.4 * Math.sin(t * 1.9 + 2) + 0.2 * Math.sin(t * 6.3);
    ctx.translate(cxA + wx, cyA + wy); ctx.scale(k, k); ctx.translate(-cxA, -cyA);
  };
  const fadeIn = (ctx, p, rise, fn) => { ctx.save(); ctx.globalAlpha *= clamp01(p); ctx.translate(0, (1 - clamp01(p)) * rise); fn(); ctx.restore(); };
  spec.block = (ctx, b, t) => {
    const s = at(b.id), p = xSeg(t, s, Lf, xInOutSine), cx = b.x + b.w / 2, rise = 18;
    ctx.textBaseline = "alphabetic";
    if (b.id === "brand") {
      fadeIn(ctx, p, 0, () => {
        const x0 = cx - b.tw / 2;
        if (b.logo) xCover(ctx, assets.logo, x0, b.y + (b.h - b.logo) / 2, b.logo, b.logo);
        if (b.name) { ctx.font = xFont(K, 400, b.px, false, XSERIF); ctx.fillStyle = pal.soft; xDrawTracked(ctx, b.name, x0 + b.logo + b.gap, xBase(b.y, b.h, b.px), b.tr); }
      });
    } else if (b.id === "title") {
      const f = b.fit;
      f.lines.forEach((line, k) => fadeIn(ctx, xSeg(t, s + k * 0.22 * Lf, Lf * 1.2, xInOutSine), rise, () => { ctx.font = f.font; ctx.fillStyle = pal.text; ctx.textAlign = "center"; ctx.fillText(line, cx, xBase(b.y + k * f.lh, f.lh, f.px) - f.px * 0.04); }));
    } else if (b.id === "when") {
      if (b.day) fadeIn(ctx, p, rise, () => { ctx.font = b.day.font; ctx.fillStyle = pal.accent; xDrawTracked(ctx, b.day.text, cx, xBase(b.y, b.dh, b.day.px), b.day.tr, "center"); });
      if (b.time) fadeIn(ctx, xSeg(t, s + 0.3 * Lf, Lf, xInOutSine), rise, () => { ctx.font = b.time.font; ctx.fillStyle = pal.text; ctx.textAlign = "center"; ctx.fillText(b.time.text, cx, xBase(b.y + b.dh, b.th, b.time.px) - b.time.px * 0.06); });
    } else if (b.id === "countdown") {
      fadeIn(ctx, p, rise, () => { ctx.font = b.line.font; ctx.fillStyle = pal.soft; ctx.textAlign = "center"; ctx.fillText(b.line.text, cx, xBase(b.y, b.h, b.line.px)); });
    } else if (b.id === "game") {
      fadeIn(ctx, p, rise, () => {
        if (b.cover) { const x = cx - b.cw / 2; xCover(ctx, assets.cover, x, b.y, b.cw, b.ch); ctx.strokeStyle = rgba(pal.text, 0.35); ctx.lineWidth = 2; ctx.strokeRect(x - 1, b.y - 1, b.cw + 2, b.ch + 2); }
        ctx.font = b.fit.font; ctx.fillStyle = pal.soft;
        b.fit.lines.forEach((line, k) => xDrawTracked(ctx, line, cx, xBase(b.y + b.ch + b.gapIn + k * b.fit.lh, b.fit.lh, b.fit.px), b.fit.tr, "center"));
      });
    } else if (b.id === "text") {
      fadeIn(ctx, p, rise, () => { ctx.font = b.fit.font; ctx.fillStyle = pal.soft; ctx.textAlign = "center"; b.fit.lines.forEach((line, k) => ctx.fillText(line, cx, xBase(b.y + k * b.fit.lh, b.fit.lh, b.fit.px) - b.fit.px * 0.06)); });
    } else if (b.id === "costreamers") {
      const lpx = 24 * K.u;
      fadeIn(ctx, p, rise, () => {
        ctx.font = xFont(K, 400, lpx, false, XSERIF); ctx.fillStyle = pal.accent;
        const w = xDrawTracked(ctx, K.words.with, cx, xBase(b.y, b.head, lpx), lpx * 0.34, "center");
        ctx.fillStyle = rgba(pal.accent, 0.55); const ly = b.y + b.head * 0.5 - 2; ctx.fillRect(cx - w / 2 - 20 * K.u - 64 * K.u, ly, 64 * K.u, 2); ctx.fillRect(cx + w / 2 + 20 * K.u, ly, 64 * K.u, 2);
      });
      b.names.forEach((name, k) => {
        const row = b.two ? Math.floor(k / 2) : k, side = b.two ? (k % 2 ? 1 : -1) : 0, y = xBase(b.y + b.head + row * b.lh, b.lh, b.px);
        fadeIn(ctx, xSeg(t, s + (0.25 + k * 0.16) * Lf, Lf, xInOutSine), 10, () => {
          ctx.font = xFont(K, 400, b.px, false, XSERIF); ctx.fillStyle = pal.text;
          if (!b.two) xDrawTracked(ctx, name, cx, y, b.tr, "center"); else xDrawTracked(ctx, name, cx + side * 40 * K.u, y, b.tr, side < 0 ? "right" : "left");
        });
      });
    }
  };
  spec.fg = (ctx, t) => {
    // vignette (fixed), grain (seeded by the 24 fps frame, so the same t always gives the same grain), then the bars
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.34)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const r = seeded(7919 + Math.floor(t * 24) * 104729);
    for (let i = 0; i < 1100; i++) { const x = r() * W, y = r() * H, light = r() < 0.62, z = 1.2 + r() * 1.6; ctx.fillStyle = light ? `rgba(255,248,235,${0.03 + r() * 0.06})` : `rgba(0,0,0,${0.08 + r() * 0.1})`; ctx.fillRect(x, y, z, z); }
    const p = xSeg(t, 0, barLen, easeInOutCubic), h = barH * p;
    ctx.fillStyle = "#000000"; ctx.fillRect(-4, -4, W + 8, h + 4); ctx.fillRect(-4, H - h, W + 8, h + 4);
  };
  return spec;
}

/* ═════════════════════════ 4. ARCADE ═════════════════════════
 * 8-bit: everything lives on an 8 px grid and moves in steps (the whole animation is sampled at 10 steps a second, positions snapped to the grid), in monospaced capitals with a
 * chunky hard shadow. Panels have notched corners and a bevel, like the frame of a game menu, and slide in from alternating sides in whole-pixel steps. Pictures arrive as a mosaic
 * that sharpens in four steps. Palette: the site colours, flat, no gradient. From `restTime` on nothing moves. */
const XMONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", "Courier New", monospace';
const XSTEPS = 10;
function xMosaic(ctx, img, x, y, w, h, cell) {
  const s = xImg(img), k = Math.max(w / s.w, h / s.h), vw = w / k, vh = h / k, sx0 = (s.w - vw) / 2, sy0 = (s.h - vh) / 2;
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  for (let j = 0; j * cell < h; j++) for (let i = 0; i * cell < w; i++) {
    const tw = Math.min(cell, w - i * cell), th = Math.min(cell, h - j * cell), px = Math.min(s.w - 1, Math.max(0, sx0 + ((i * cell + tw / 2) / w) * vw)), py = Math.min(s.h - 1, Math.max(0, sy0 + ((j * cell + th / 2) / h) * vh));
    ctx.drawImage(img, Math.floor(px), Math.floor(py), 1, 1, x + i * cell, y + j * cell, tw, th);
  }
  ctx.restore();
}
function styleArcade(K) {
  const { pal, content, assets, members, D, has, W, H } = K, L = xLen(D), g = 8, snap = (v) => Math.round(v / g) * g, rest = D * 0.78, ay = K.A.y, sy = (v) => ay + Math.round((v - ay) / g) * g, su = (v) => Math.ceil(v / g) * g;   // the grid starts at the top of the safe area; heights round UP, so nothing leaves it
  const order = ["brand", "title", "when", "countdown", "game", "text", "costreamers"].filter((id) => has[id]);
  const starts = xStarts(D, order.length, L * 1.3, 0.05, 0.62), at = (id) => starts[order.indexOf(id)];
  const spec = { gap: 40, maxScale: 1.75, stretch: 1.25 };
  const font = (w, px) => xFont(K, w, px, false, XMONO);
  /** The frame of a panel: hard drop shadow, notched outer edge, inner fill, bevel (light top-left, dark bottom-right). */
  const panel = (ctx, x, y, w, h, fill = pal.panel, edge = pal.accent) => {
    x = snap(x); y = sy(y); w = snap(w); h = su(h);
    const notched = (px, py, pw, ph, col) => { ctx.fillStyle = col; ctx.fillRect(px + g, py, pw - 2 * g, ph); ctx.fillRect(px, py + g, pw, ph - 2 * g); };
    notched(x + g, y + g, w, h, pal.shade); notched(x, y, w, h, edge); notched(x + g, y + g, w - 2 * g, h - 2 * g, fill);
    ctx.fillStyle = pal.hi; ctx.fillRect(x + 2 * g, y + g, w - 4 * g, g / 2); ctx.fillRect(x + g, y + 2 * g, g / 2, h - 4 * g);
    ctx.fillStyle = pal.lo; ctx.fillRect(x + 2 * g, y + h - g * 1.5, w - 4 * g, g / 2); ctx.fillRect(x + w - g * 1.5, y + 2 * g, g / 2, h - 4 * g);
  };
  const shadowText = (ctx, str, x, y, col, sh) => { ctx.fillStyle = sh; for (const k of [2, 1]) ctx.fillText(str, x + (g / 2) * k, y + (g / 2) * k); ctx.fillStyle = col; ctx.fillText(str, x, y); };

  spec.build = (u, Ar) => order.map((id) => {
    const pad = 3 * g;
    if (id === "brand") {
      const px = 30 * u, logo = K.hasLogo ? snap(64 * u) : 0, f = font(800, px), m0 = xMeasure(K, f), tag = "1UP", tagW = m0(tag) + 2 * g, gap = 2 * g;
      const name = content.brand ? ellipsize(m0, content.brand.toLocaleUpperCase(K.lang), Ar.w - tagW - logo - gap * 2) : "";
      return { id, h: su(Math.max(logo, px * 1.7)), logo, name, px, tag, tagW, gap, tw: tagW + gap + logo + (logo ? gap : 0) + (name ? m0(name) : 0) };
    }
    if (id === "title") {
      const fit = xFit(K, content.title, { fam: XMONO, weight: 800, px: 104 * u, lhr: 1.12, upper: true, width: Ar.w - 2 * pad - 2 * g, maxLines: 4, okLines: 3, minFrac: 0.42 });
      return { id, pad, fit, h: su(fit.lines.length * fit.lh + 2 * pad) };
    }
    if (id === "when") {
      const tabPx = 26 * u, tab = K.xw.start, day = content.dayLine ? xFitLine(K, content.dayLine, { fam: XMONO, weight: 700, px: 40 * u, upper: true, width: Ar.w - 2 * pad - 2 * g, minFrac: 0.5 }) : null;
      const time = content.timeLine ? xFitLine(K, content.timeLine, { fam: XMONO, weight: 800, px: 200 * u, upper: true, width: Ar.w - 2 * pad - 2 * g, minFrac: 0.4 }) : null;
      const head = content.timeLine ? tabPx * 1.9 : 0;
      return { id, pad, tabPx, tab, day, time, head, h: su(pad * 1.4 + head + (time ? time.px * 1.12 : 0) + (day ? day.px * 1.5 : 0)) };
    }
    if (id === "countdown") {
      const px = 34 * u, f = font(800, px), m0 = xMeasure(K, f), text = ellipsize(m0, content.countdown.toLocaleUpperCase(K.lang), Ar.w - 6 * g);
      return { id, text, px, h: su(px * 2), tw: snap(m0(text) + 4 * g) };
    }
    if (id === "game") {
      const cover = K.tools.usable(assets.cover), cw = cover ? snap(190 * u) : 0, ch = cover ? snap(250 * u) : 0, gap = cover ? 3 * g : 0;
      const fit = xFit(K, content.game, { fam: XMONO, weight: 800, px: 62 * u, lhr: 1.18, upper: true, width: Ar.w - 2 * pad - cw - gap - 2 * g, maxLines: 3, okLines: 3, minFrac: 0.55 });
      return { id, pad, cover, cw, ch, gap, fit, h: su(Math.max(ch, fit.lines.length * fit.lh) + 2 * pad) };
    }
    if (id === "text") {
      const fit = xFit(K, content.text, { fam: XMONO, weight: 600, px: 40 * u, lhr: 1.4, width: Ar.w - 2 * pad - 2 * g, maxLines: 3, shrink: false });
      return { id, pad, fit, h: su(fit.lines.length * fit.lh + 2 * pad - g) };
    }
    const rows = members.length <= 3 ? 1 : 2, d = snap(160 * u), labelH = Math.max(44 * u, 36), head = snap(48 * u);
    return { id, rows, d, labelH, head, h: su(head + rows * (d + labelH + 8) + (rows - 1) * 16) };
  });
  spec.place = (blocks) => blocks.forEach((b) => { b.x = snap(b.x); b.y = ay + Math.floor((b.y - ay) / g) * g; b.w = Math.floor(b.w / g) * g; b.bw = b.tw ? Math.min(b.w, b.tw) : b.w; b.bx = b.x; });

  spec.bg = (ctx, t) => {
    ctx.fillStyle = pal.base; ctx.fillRect(0, 0, W, H);
    // six hard bands of slightly lighter colour, with a checkerboard dither on each seam; they drift down a little, then stop at the hold
    const bands = 7, bh = snap(H / 6), drift = snap(48 * (1 - xOutQuart(progress(t, 0, rest))));
    for (let i = 0; i < bands; i++) {
      const y = i * bh + drift - bh; ctx.fillStyle = mix(pal.base, pal.accent, 0.018 * (i + 1)); ctx.fillRect(0, y, W, bh);
      ctx.fillStyle = mix(pal.base, pal.accent, 0.018 * (i + 2)); for (let x = 0; x < W; x += g * 2) { ctx.fillRect(x, y + bh - g, g, g); ctx.fillRect(x + g, y + bh - 2 * g, g, g); }
    }
  };
  spec.block = (ctx, b, t, i) => {
    const tq = Math.floor(t * XSTEPS + 1e-6) / XSTEPS, s = at(b.id), Lp = L * 1.3, p = progress(tq, s, Lp), pe = xOutQuart(p), arrive = s + Lp;
    if (p <= 0) return;
    const dir = i % 2 ? 1 : -1, off = snap((1 - pe) * W * dir), blink = !(tq >= arrive + 0.05 && tq < arrive + 0.15) && !(tq >= arrive + 0.25 && tq < arrive + 0.35) || tq >= rest;
    const mos = (img, x, y, w, h, q) => { const steps = [64, 32, 16, 8]; const k = Math.floor(clamp01(q) * 4.999); if (q >= 1 || k >= 4) xCover(ctx, img, x, y, w, h); else xMosaic(ctx, img, x, y, w, h, steps[k]); };
    const q = progress(tq, arrive - 0.1, L * 1.6);
    ctx.save(); ctx.translate(off, 0); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    if (b.id === "brand") {
      ctx.font = font(800, b.px); ctx.fillStyle = pal.fill2; ctx.fillRect(b.x, b.y + (b.h - b.px * 1.5) / 2, b.tagW, b.px * 1.5);
      ctx.fillStyle = readableOn(pal.fill2); ctx.fillText(b.tag, b.x + g, xBase(b.y, b.h, b.px));
      let x = b.x + b.tagW + b.gap;
      if (b.logo) { ctx.fillStyle = pal.text; ctx.fillRect(x - 4, b.y + (b.h - b.logo) / 2 - 4, b.logo + 8, b.logo + 8); xCover(ctx, assets.logo, x, b.y + (b.h - b.logo) / 2, b.logo, b.logo); x += b.logo + b.gap; }
      if (b.name) { ctx.fillStyle = pal.text; ctx.fillText(b.name, x, xBase(b.y, b.h, b.px)); }
    } else if (b.id === "title") {
      panel(ctx, b.x, b.y, b.w, b.h);
      if (blink) { const f = b.fit; ctx.font = f.font; f.lines.forEach((line, k) => shadowText(ctx, line, b.x + b.pad + g, sy(xBase(b.y + b.pad + k * f.lh, f.lh, f.px)), pal.text, pal.accent)); }
    } else if (b.id === "when") {
      panel(ctx, b.x, b.y, b.w, b.h);
      if (b.head) { ctx.font = font(800, b.tabPx); const tw = ctx.measureText(b.tab).width + 3 * g; ctx.fillStyle = pal.fill2; ctx.fillRect(b.x + b.pad, b.y + b.pad * 0.7, tw, b.head - 8); ctx.fillStyle = readableOn(pal.fill2); ctx.fillText(b.tab, b.x + b.pad + 1.5 * g, xBase(b.y + b.pad * 0.7, b.head - 8, b.tabPx)); }
      if (blink) {
        let y = b.y + b.pad * 0.7 + b.head;
        if (b.time) { ctx.font = b.time.font; shadowText(ctx, b.time.text, b.x + b.pad + g, snap(y + b.time.px * 0.85), pal.accent, pal.shade); y += b.time.px * 1.12; }
        if (b.day) { ctx.font = b.day.font; ctx.fillStyle = pal.text; ctx.fillText(b.day.text, b.x + b.pad + g, xBase(y, b.day.px * 1.5, b.day.px)); }
      }
    } else if (b.id === "countdown") {
      ctx.fillStyle = pal.shade; ctx.fillRect(b.x + g / 2, b.y + g / 2, b.tw, b.h); ctx.fillStyle = pal.fill2; ctx.fillRect(b.x, b.y, b.tw, b.h);
      if (blink) { ctx.font = font(800, b.px); ctx.fillStyle = readableOn(pal.fill2); ctx.fillText(b.text, b.x + 2 * g, xBase(b.y, b.h, b.px)); }
    } else if (b.id === "game") {
      panel(ctx, b.x, b.y, b.w, b.h);
      let x = b.x + b.pad + g;
      if (b.cover) { const cy = b.y + (b.h - b.ch) / 2; ctx.fillStyle = pal.text; ctx.fillRect(x - 4, cy - 4, b.cw + 8, b.ch + 8); mos(assets.cover, x, cy, b.cw, b.ch, q); x += b.cw + b.gap; }
      if (blink) { const f = b.fit; ctx.font = f.font; const top = b.y + (b.h - f.lines.length * f.lh) / 2; f.lines.forEach((line, k) => shadowText(ctx, line, x, sy(xBase(top + k * f.lh, f.lh, f.px)), pal.text, pal.shade)); }
    } else if (b.id === "text") {
      panel(ctx, b.x, b.y, b.w, b.h, pal.panel, pal.accent2);
      if (blink) { const f = b.fit; ctx.font = f.font; ctx.fillStyle = pal.text; f.lines.forEach((line, k) => ctx.fillText(line, b.x + b.pad + g, sy(xBase(b.y + b.pad - g / 2 + k * f.lh, f.lh, f.px)))); }
    } else if (b.id === "costreamers") {
      const px = Math.max(22, b.head * 0.6); ctx.font = font(800, px); const tw = ctx.measureText(K.words.with).width + 3 * g;
      ctx.fillStyle = pal.fill2; ctx.fillRect(b.x, b.y, tw, b.head); ctx.fillStyle = readableOn(pal.fill2); ctx.fillText(K.words.with, b.x + 1.5 * g, xBase(b.y, b.head, px));
      const cols = b.rows === 1 ? members.length : Math.ceil(members.length / 2), gap = 3 * g, box = { x: b.x, y: b.y + b.head + 8, w: Math.min(b.w, cols * (b.d + gap + 30)), h: b.h - b.head - 8 };
      const cells = layoutCostreamers(members.length, box, { maxD: b.d, gap, labelH: b.labelH }), shift = b.x - Math.min(...cells.map((c) => c.cx - Math.max(c.d, c.labelW) / 2));
      cells.forEach((cell, k) => {
        const d0 = cell.d; cell.d = Math.floor(d0 / g) * g; cell.cx = snap(cell.cx + shift - cell.d / 2) + cell.d / 2; cell.cy = sy(cell.cy - d0 / 2) + cell.d / 2; const m = members[k], x = cell.cx - cell.d / 2, y = cell.cy - cell.d / 2, qk = progress(tq, arrive - 0.1 + k * 0.1, L * 1.4);
        ctx.fillStyle = pal.shade; ctx.fillRect(x + g / 2, y + g / 2, cell.d + 8, cell.d + 8); ctx.fillStyle = pal.text; ctx.fillRect(x - 4, y - 4, cell.d + 8, cell.d + 8);
        const img = assets.avatars?.[m.login];
        if (!m.more && img && xImg(img).w > 0) mos(img, x, y, cell.d, cell.d, qk); else xAvatar(ctx, K, cell, m, img, { shape: "square" });
        ctx.fillStyle = pal.text; ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.fillText(m.more ? "" : xNameFit(ctx, K, 700, Math.min(26 * K.u, cell.d * 0.165), m.name.toUpperCase(), cell.labelW - 6, XMONO), cell.cx, cell.labelY);
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      });
    }
    ctx.restore();
  };
  return spec;
}

/* ═════════════════════════ 5. PAPER COLLAGE (ZINE) ═════════════════════════
 * Cut paper on a paper table: strips with torn or scissor-cut edges, a white rim where the paper tore, soft contact shadows, tape, a print with a white border, and the time as an
 * ink stamp (rough, with the ink missing in places). Everything sits a little crooked, and moves like stop motion: 8 steps a second, position and angle jittering by a few
 * pixels while pieces slap in, calming down to nothing at the hold. All texture is procedural and seeded by constants: the same t always gives the same picture. */
const XTYPE = '"Courier New", Courier, "Liberation Mono", monospace';
const XHEAD = 'Georgia, "Times New Roman", "Liberation Serif", serif';
const XHAND = '"Bradley Hand", "Segoe Print", "Marker Felt", "Chalkboard SE", "Comic Sans MS", "Comic Neue", cursive';
function xTear(r, n, w, y0, amp) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([-w / 2 + (w * i) / n, y0 + (r() - 0.5) * amp + Math.sin(i * 1.7 + r() * 2) * amp * 0.35]);
  return pts;
}
const xPoly = (ctx, pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
/** A piece of paper centred on the origin: `torn` = "t", "b" or "tb" for ragged edges (with a pale rim), the others are cut with scissors (slightly out of square). */
function xPaper(ctx, w, h, seed, { fill, torn = "", rim = "#f7f2e6", shadow = 0.34, fibres = true, at = [0, 0] }) {
  ctx.save(); ctx.translate(at[0], at[1]);
  const r = seeded(seed), n = Math.max(3, Math.round(w / 15)), tt = torn.includes("t"), tb = torn.includes("b");
  const top = tt ? xTear(r, n, w, -h / 2, 8) : [[-w / 2 + r() * 3, -h / 2 + r() * 2], [w / 2 - r() * 3, -h / 2 + r() * 2]];
  const bot = tb ? xTear(r, n, w, h / 2, 8).reverse() : [[w / 2 - r() * 3, h / 2 - r() * 2], [-w / 2 + r() * 3, h / 2 - r() * 2]];
  ctx.save();
  ctx.shadowColor = `rgba(45,30,12,${shadow})`; ctx.shadowBlur = 12; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 6;
  xPoly(ctx, [...top, ...bot]); ctx.fillStyle = tt || tb ? rim : fill; ctx.fill();
  ctx.restore();
  if (tt || tb) {
    const top2 = tt ? top.map(([x, y]) => [x, y + 3 + r() * 3.5]) : top, bot2 = tb ? bot.map(([x, y]) => [x, y - 3 - r() * 3.5]) : bot;
    xPoly(ctx, [...top2, ...bot2]); ctx.fillStyle = fill; ctx.fill();
  }
  if (fibres) {   // a few fibres inside the sheet
    ctx.save(); xPoly(ctx, [...top, ...bot]); ctx.clip();
    const f = seeded(seed * 3 + 11); ctx.lineWidth = 1; ctx.strokeStyle = luminance(fill) > 0.4 ? "rgba(90,70,40,0.09)" : "rgba(255,255,255,0.07)"; ctx.beginPath();
    for (let k = 0; k < Math.min(90, w / 7); k++) { const x = (f() - 0.5) * w, y = (f() - 0.5) * h, a = f() * 6.28, l = 4 + f() * 14; ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); }
    ctx.stroke(); ctx.restore();
  }
  ctx.restore();
}
/** A strip of translucent tape with zig-zag ends, centred on the origin. */
function xTape(ctx, w, h, col, at = [0, 0]) {
  ctx.save(); ctx.translate(at[0], at[1]); ctx.fillStyle = col; ctx.beginPath();
  const z = h / 4; ctx.moveTo(-w / 2, -h / 2);
  for (let i = 0; i < 4; i++) ctx.lineTo(-w / 2 + (i % 2 ? 0 : z * 0.7), -h / 2 + z * (i + 1));
  ctx.lineTo(w / 2, h / 2);
  for (let i = 3; i >= 0; i--) ctx.lineTo(w / 2 - (i % 2 ? 0 : z * 0.7), -h / 2 + z * i);
  ctx.closePath(); ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
}
function styleCollage(K) {
  const { pal, content, assets, members, D, has, W, H } = K, L = xLen(D), rest = D * 0.78;
  const order = ["brand", "title", "when", "countdown", "game", "text", "costreamers"].filter((id) => has[id]);
  const starts = xStarts(D, order.length, L * 1.1, 0.04, 0.62), at = (id) => starts[order.indexOf(id)];
  const spec = { gap: 30, maxScale: 2.4, stretch: 1.8 };
  const tapeCol = rgba(mix(pal.kraft, "#ffffff", 0.45), 0.62), ANG = [-1.7, 1.2, -2.6, 2.2, -1.1, 1.6, -2.1];
  const rot = (i) => (ANG[i % ANG.length] * Math.PI) / 180;
  const swing = (w, a) => Math.ceil(Math.abs(Math.sin(a)) * w / 2) + 8;
  const strips = [pal.ink, pal.s1, pal.cream, pal.s2];

  spec.build = (u, Ar) => order.map((id, i) => {
    const a = rot(i);
    if (id === "brand") {
      const px = 30 * u, logo = K.hasLogo ? 64 * u : 0, gap = logo ? 18 * u : 0, padX = 24 * u, f = xFont(K, 700, px, false, XTYPE), m0 = xMeasure(K, f);
      const name = content.brand ? ellipsize(m0, content.brand.toLocaleUpperCase(K.lang), Ar.w * 0.8 - logo - gap - padX * 2) : "", tw = logo + gap + (name ? m0(name) : 0) + padX * 2, h0 = Math.max(logo + 20 * u, px * 2);
      return { id, a, px, logo, gap, name, padX, tw, h0, h: h0 + swing(tw, a) * 2 };
    }
    if (id === "title") {
      const padX = 28 * u, fit = xFit(K, content.title, { fam: XHEAD, weight: 900, px: 96 * u, lhr: 1, upper: true, width: Ar.w - padX * 2 - 24 * u, maxLines: 4, okLines: 3, minFrac: 0.42 });
      const hk = fit.lh + 30 * u, over = 6 * u, ws = fit.lines.map((l) => fit.m(l) + padX * 2);
      return { id, fit, padX, hk, over, ws, a, h: fit.lines.length * (hk - over) + over + swing(Math.max(...ws), 0.03) * 2, tw: Math.max(...ws) + 24 * u };
    }
    if (id === "when") {
      const sp = 26 * u, inner = Ar.w * 0.8 - sp * 2 - 24 * u;
      const day = content.dayLine ? xFitLine(K, content.dayLine, { fam: XTYPE, weight: 700, px: 36 * u, upper: true, width: inner, minFrac: 0.5 }) : null;
      const time = content.timeLine ? xFitLine(K, content.timeLine, { fam: XTYPE, weight: 800, px: 150 * u, upper: true, width: inner, minFrac: 0.4 }) : null;
      const iw = Math.max(day?.w ?? 0, time?.w ?? 0) + sp * 2, ih = sp * 1.4 + (day ? day.px * 1.5 : 0) + (time ? time.px * 1.0 : 0), tag = 22 * u;
      return { id, sp, day, time, iw, ih, tag, a: -0.07, h: ih + tag * 2 + swing(iw + tag * 2, 0.07) * 2, tw: iw + tag * 2 };
    }
    if (id === "countdown") {
      const px = 36 * u, f = xFont(K, 800, px, false, XTYPE), m0 = xMeasure(K, f), text = ellipsize(m0, content.countdown.toLocaleUpperCase(K.lang), Ar.w * 0.8), tw = m0(text) + 56 * u;
      return { id, px, text, tw, h0: px * 2, a: 0.04, h: px * 2 + swing(tw, 0.04) * 2 + 8 };
    }
    if (id === "game") {
      const cover = K.tools.usable(assets.cover), fr = 14 * u, cw = cover ? 190 * u : 0, ch = cover ? 240 * u : 0, pw = cover ? cw + fr * 2 : 0, ph = cover ? ch + fr * 2 + 36 * u : 0, gap = cover ? 12 * u : 0, padX = 24 * u;
      const fit = xFit(K, content.game, { fam: XTYPE, weight: 800, px: 46 * u, lhr: 1.18, upper: true, width: Ar.w - pw - gap - padX * 2 - 24 * u, maxLines: 3, okLines: 3, minFrac: 0.55 }), lw = fit.tw + padX * 2, lh = fit.lines.length * fit.lh + 36 * u;
      return { id, cover, fr, cw, ch, pw, ph, gap, padX, fit, lw, lh, a, h: Math.max(ph, lh) + 30 * u, tw: pw + gap + lw };
    }
    if (id === "text") {
      const padX = 30 * u, fit = xFit(K, content.text, { fam: XHAND, weight: 600, px: 44 * u, lhr: 1.34, width: Ar.w * 0.86 - padX * 2, maxLines: 3, shrink: false }), tw = Math.min(Ar.w * 0.9, fit.tw + padX * 2), h0 = fit.lines.length * fit.lh + 40 * u;
      return { id, fit, padX, tw, h0, a: -0.02, h: h0 + swing(tw, 0.02) * 2 };
    }
    const n = members.length, rows = n <= 3 ? 1 : 2, d = 150 * u, labelH = Math.max(42 * u, 36), head = 52 * u;
    return { id, rows, d, labelH, head, h: head + rows * (d + labelH + 30 * u) };
  });
  spec.place = (blocks, u, Ar) => blocks.forEach((b, i) => {
    b.bw = Math.min(b.w, b.tw ?? b.w);
    // hand-placed: the pieces sit on a loose left / right / left rhythm instead of one axis
    const slack = b.w - b.bw, bias = { brand: 0.0, title: 0.0, when: 1, countdown: 0.35, game: 0.12, text: 0.8, costreamers: 0 }[b.id] ?? 0;
    b.bx = b.x + slack * bias;
  });

  const bgFibres = (() => {
    const r = seeded(20260), dark = [], light = [];
    for (let i = 0; i < 900; i++) { const x = r() * W, y = r() * H, a = r() * 6.28, l = 5 + r() * 16, seg = [x, y, x + Math.cos(a) * l, y + Math.sin(a) * l]; (r() < 0.62 ? dark : light).push(seg); }
    const blots = []; for (let i = 0; i < 14; i++) blots.push([r() * W, r() * H, 90 + r() * 200, 0.02 + r() * 0.03]);
    return { dark, light, blots };
  })();
  spec.bg = (ctx) => {
    ctx.fillStyle = pal.paper; ctx.fillRect(0, 0, W, H);
    for (const [x, y, rad, a] of bgFibres.blots) { const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, `rgba(120,90,40,${a})`); g.addColorStop(1, "rgba(120,90,40,0)"); ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    ctx.lineWidth = 1.2; ctx.strokeStyle = "rgba(95,72,40,0.10)"; ctx.beginPath(); for (const s of bgFibres.dark) { ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); } ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.beginPath(); for (const s of bgFibres.light) { ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); } ctx.stroke();
  };

  const jit = (i, tq) => {
    const env = 1 - xInOutSine(progress(tq, 0.56 * D, 0.22 * D));
    if (env <= 0) return { x: 0, y: 0, r: 0 };
    const r = seeded(i * 7919 + Math.round(tq * 8) * 104729);
    return { x: (r() - 0.5) * 7 * env, y: (r() - 0.5) * 7 * env, r: (r() - 0.5) * 0.026 * env };
  };
  /** Runs `fn` with the origin on the centre of a piece: placed (slap-in from the side, then jitter and its own angle). */
  const piece = (ctx, i, tq, s, cx, cy, a, fn, k = 0) => {
    const p = xOutQuart(progress(tq, s + k * 0.12, L * 1.1)); if (p <= 0) return;
    const j = jit(i * 13 + k, tq), dir = (i + k) % 2 ? 1 : -1;
    ctx.save(); ctx.translate(cx + j.x + (1 - p) * dir * W * 0.75, cy + j.y + (1 - p) * H * 0.06); ctx.rotate(a + j.r + (1 - p) * dir * 0.12); ctx.translate(-cx, -cy); fn(p); ctx.restore();   // drawing coordinates stay those of the resting place
  };
  spec.block = (ctx, b, t, i) => {
    const tq = Math.floor(t * 8 + 1e-6) / 8, s = at(b.id), cx = b.bx + b.bw / 2, cy = b.y + b.h / 2, c = [cx, cy];
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    if (b.id === "brand") {
      piece(ctx, i, tq, s, cx, cy, b.a, () => {
        xPaper(ctx, b.tw, b.h0, 101 + i, { fill: pal.cream, shadow: 0.28, at: c });
        let x = cx - b.tw / 2 + b.padX;
        if (b.logo) { ctx.fillStyle = "#ffffff"; ctx.fillRect(x - 5, cy - b.logo / 2 - 5, b.logo + 10, b.logo + 10); xCover(ctx, assets.logo, x, cy - b.logo / 2, b.logo, b.logo); x += b.logo + b.gap; }
        if (b.name) { ctx.font = xFont(K, 700, b.px, false, XTYPE); ctx.fillStyle = pal.ink; ctx.fillText(b.name, x, cy + b.px * 0.36); }
        xTape(ctx, 70 * K.u, 26 * K.u, tapeCol, [cx - b.tw / 2 + 4, cy - b.h0 / 2 + 2]);
      });
    } else if (b.id === "title") {
      const f = b.fit; let y = b.y + (b.h - (f.lines.length * (b.hk - b.over) + b.over)) / 2;
      f.lines.forEach((line, k) => {
        const w = b.ws[k], fill = strips[k % 2 ? 1 : 0], sx = b.bx + (k % 2 ? 36 * K.u : 0) + w / 2, sy = y + b.hk / 2, a = ((k % 2 ? 0.9 : -1.2) + (k % 3) * 0.25) * Math.PI / 180;
        piece(ctx, i, tq, s, sx, sy, a, () => {
          xPaper(ctx, w, b.hk, 200 + k * 17, { fill, torn: k % 2 ? "t" : "b", shadow: 0.32, at: [sx, sy] });
          ctx.font = f.font; ctx.fillStyle = readableOn(fill); ctx.textAlign = "center"; ctx.fillText(line, sx, xBase(sy - b.hk / 2, b.hk, f.px) - f.px * 0.02);
        }, k);
        y += b.hk - b.over;
      });
    } else if (b.id === "when") {
      piece(ctx, i, tq, s, cx, cy, b.a, () => {
        xPaper(ctx, b.iw + b.tag * 2, b.ih + b.tag * 2, 303, { fill: pal.cream, shadow: 0.3, at: c });
        const st = 1 + 0.35 * (1 - xOutBack(progress(tq, s + L * 0.5, 0.3))), ink = pal.accent2;   // the stamp presses down: a restrained overshoot, the only one of the six styles
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.05); ctx.scale(st, st); ctx.translate(-cx, -cy); ctx.globalAlpha = clamp01(progress(tq, s + L * 0.45, 0.2)) * 0.94;
        const w = b.iw, h = b.ih, bw = Math.max(5, b.sp * 0.22);
        ctx.strokeStyle = ink; ctx.lineWidth = bw; ctx.strokeRect(cx - w / 2, cy - h / 2, w, h); ctx.lineWidth = Math.max(2, bw * 0.4); ctx.strokeRect(cx - w / 2 + bw * 2, cy - h / 2 + bw * 2, w - bw * 4, h - bw * 4);
        ctx.fillStyle = ink; ctx.textAlign = "center";
        let y = cy - h / 2 + b.sp * 0.7;
        if (b.day) { ctx.font = b.day.font; ctx.fillText(b.day.text, cx, y + b.day.px * 0.8); y += b.day.px * 1.5; }
        if (b.time) { ctx.font = b.time.font; ctx.fillText(b.time.text, cx, y + b.time.px * 0.78); }
        // the ink is missing in places: small paper-coloured specks over the print (seeded, always the same)
        const r = seeded(4242); ctx.fillStyle = pal.cream; ctx.globalAlpha = 1;
        for (let k = 0; k < 260; k++) { const x = cx + (r() - 0.5) * (w + 6), yy = cy + (r() - 0.5) * (h + 6), z = 1 + r() * 3.2; ctx.fillRect(x, yy, z * (r() < 0.5 ? 1 : 2.2), z); }
        ctx.restore();
      });
    } else if (b.id === "countdown") {
      piece(ctx, i, tq, s, cx, cy, b.a, () => {
        xPaper(ctx, b.tw, b.h0, 404, { fill: pal.kraft, torn: "t", shadow: 0.3, at: c });
        ctx.font = xFont(K, 800, b.px, false, XTYPE); ctx.fillStyle = readableOn(pal.kraft); ctx.textAlign = "center"; ctx.fillText(b.text, cx, cy + b.px * 0.36);
      });
    } else if (b.id === "game") {
      const x0 = b.bx, ym = b.y + b.h / 2;
      if (b.cover) { const px = x0 + b.pw / 2; piece(ctx, i, tq, s, px, ym, -0.05, () => {
        xPaper(ctx, b.pw, b.ph, 505, { fill: "#fbf8ef", shadow: 0.36, fibres: false, at: [px, ym] });
        xCover(ctx, assets.cover, px - b.cw / 2, ym - b.ph / 2 + b.fr, b.cw, b.ch);
        ctx.save(); ctx.translate(px, ym - b.ph / 2); ctx.rotate(0.12); xTape(ctx, 84 * K.u, 28 * K.u, tapeCol); ctx.restore();
      }); }
      const lx = x0 + b.pw + b.gap + b.lw / 2, ly = ym + (b.cover ? 14 * K.u : 0);
      piece(ctx, i, tq, s, lx, ly, 0.025, () => {
        xPaper(ctx, b.lw, b.lh, 506, { fill: pal.cream, shadow: 0.3, at: [lx, ly] });
        ctx.font = b.fit.font; ctx.fillStyle = pal.ink; ctx.textAlign = "center"; b.fit.lines.forEach((line, k) => ctx.fillText(line, lx, xBase(ly - b.lh / 2 + 18 * K.u + k * b.fit.lh, b.fit.lh, b.fit.px)));
      }, 1);
    } else if (b.id === "text") {
      piece(ctx, i, tq, s, cx, cy, b.a, () => {
        xPaper(ctx, b.tw, b.h0, 606, { fill: "#fbf6e4", torn: "t", shadow: 0.28, at: c });
        ctx.strokeStyle = "rgba(70,110,160,0.22)"; ctx.lineWidth = 1.5; ctx.beginPath();
        for (let k = 0; k < b.fit.lines.length; k++) { const y = cy - b.h0 / 2 + 20 * K.u + (k + 1) * b.fit.lh - b.fit.px * 0.08; ctx.moveTo(cx - b.tw / 2 + 12, y); ctx.lineTo(cx + b.tw / 2 - 12, y); }
        ctx.stroke();
        ctx.font = b.fit.font; ctx.fillStyle = pal.ink; ctx.textAlign = "left"; b.fit.lines.forEach((line, k) => ctx.fillText(line, cx - b.tw / 2 + b.padX, cy - b.h0 / 2 + 20 * K.u + (k + 1) * b.fit.lh - b.fit.px * 0.28));
      });
    } else if (b.id === "costreamers") {
      const px = Math.max(22, b.head * 0.5), wx = b.bx + 90 * K.u, wy = b.y + b.head / 2;
      piece(ctx, i, tq, s, wx, wy, -0.035, () => {
        ctx.font = xFont(K, 800, px, false, XTYPE); const w = ctx.measureText(K.words.with).width + 48 * K.u;
        xPaper(ctx, w, b.head, 707, { fill: pal.s2, shadow: 0.28, at: [wx, wy] }); ctx.fillStyle = readableOn(pal.s2); ctx.textAlign = "center"; ctx.fillText(K.words.with, wx, wy + px * 0.36);
      });
      const cols = b.rows === 1 ? members.length : Math.ceil(members.length / 2), gap = 26 * K.u, box = { x: b.x, y: b.y + b.head + 14 * K.u, w: Math.min(b.w, cols * (b.d + gap + 40)), h: b.h - b.head - 14 * K.u };
      const cells = layoutCostreamers(members.length, box, { maxD: b.d, gap, labelH: b.labelH }), shift = b.bx - Math.min(...cells.map((c2) => c2.cx - Math.max(c2.d, c2.labelW) / 2));
      cells.forEach((cell, k) => {
        const m = members[k], cxk = cell.cx + shift, a = ((k % 2 ? 2.2 : -2.6) + k * 0.3) * Math.PI / 180;
        piece(ctx, i, tq, s + 0.1, cxk, cell.cy, a, () => {
          const d = cell.d, fr = 10 * K.u;
          xPaper(ctx, d + fr * 2, d + fr * 2 + 8, 800 + k, { fill: "#fbf8ef", shadow: 0.34, fibres: false, at: [cxk, cell.cy] });
          xAvatar(ctx, K, { cx: cxk, cy: cell.cy - 4, d }, m, assets.avatars?.[m.login], { shape: "square" });
          ctx.save(); ctx.translate(cxk, cell.cy - d / 2 - fr); ctx.rotate(-0.1); xTape(ctx, 56 * K.u, 22 * K.u, tapeCol); ctx.restore();
        }, k);
        const ly = cell.labelY + 18 * K.u;
        piece(ctx, i, tq, s + 0.1, cxk, ly, -a * 0.8, () => {
          const label = m.more ? "" : xNameFit(ctx, K, 700, Math.min(26 * K.u, cell.d * 0.17), m.name.toUpperCase(), cell.labelW - 8, XTYPE), lpx = Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 20);
          if (label) { const w = ctx.measureText(label).width + 22 * K.u; xPaper(ctx, w, Math.max(38 * K.u, lpx * 1.5), 900 + k, { fill: pal.cream, shadow: 0.25, fibres: false, at: [cxk, ly] }); ctx.fillStyle = pal.ink; ctx.textAlign = "center"; ctx.fillText(label, cxk, ly + lpx * 0.34); }
        }, k + 3);
      });
    }
  };
  return spec;
}

/* ═════════════════════════ 6. GEOMETRIC (BAUHAUS / SWISS) ═════════════════════════
 * Flat shapes on a strict grid: a circle, a quarter circle and a bar, built from the site colours, frame the text, which is set flush left in a plain grotesque with big
 * numerals. Everything moves on one rhythm: each shape and each line LANDS exactly on a beat (the beat is a fraction of the video length), nothing overshoots, nothing glows. */
function styleGeometric(K) {
  const { pal, content, assets, members, D, has, W } = K, A0 = K.A;
  const order = ["brand", "title", "when", "countdown", "game", "text", "costreamers"].filter((id) => has[id]);
  const items = 3 + order.length, beat = Math.min(0.1 * D, (0.66 * D) / (items + 0.1)), land = (k) => (k + 0.1) * beat;   // the k-th landing (1-based)
  const slide = 0.85 * beat, beatOf = (id) => 3 + order.indexOf(id) + 1;
  const bandH = Math.round(A0.h * 0.16), spec = { gap: 36, maxScale: 1.45, stretch: 1.3, reserveTop: bandH + 40 };
  const xr = A0.x + A0.w, y0 = A0.y;

  spec.build = (u, Ar) => order.map((id) => {
    if (id === "brand") {
      const px = 28 * u, logo = K.hasLogo ? 56 * u : 0, gap = logo ? 18 * u : 0, f = xFont(K, 700, px), m0 = xMeasure(K, f), tr = px * 0.14;
      const name = content.brand ? ellipsize((s) => xTW(m0, s, tr), content.brand.toLocaleUpperCase(K.lang), Ar.w - logo - gap) : "";
      return { id, h: Math.max(logo, px * 1.5), logo, gap, name, px, tr, tw: logo + gap + (name ? xTW(m0, name, tr) : 0) };
    }
    if (id === "title") {
      const fit = xFit(K, content.title, { weight: 800, px: 112 * u, lhr: 1.02, track: -0.012, width: Ar.w * 0.94, maxLines: 4, okLines: 3, minFrac: 0.42 }), barGap = 26 * u, barH = 16 * u;
      return { id, fit, barGap, barH, h: fit.lines.length * fit.lh + barGap + barH, gapAfter: 1.1 };
    }
    if (id === "when") {
      const day = content.dayLine && content.timeLine ? xFitLine(K, content.dayLine, { weight: 700, px: 36 * u, upper: true, track: 0.14, width: Ar.w, minFrac: 0.6 }) : null;
      if (content.timeLine) {
        const main = xFitLine(K, content.timeLine, { weight: 800, px: 330 * u, track: -0.04, width: Ar.w, minFrac: 0.3 }), dayH = day ? day.px * 1.8 : 0;
        return { id, day, dayH, main, h: dayH + main.px * 0.74 + 8 * u, gapAfter: 1.1 };
      }
      const main = xFitLine(K, content.dayLine, { weight: 800, px: 96 * u, track: -0.01, width: Ar.w, minFrac: 0.4 });
      return { id, day: null, dayH: 0, main, h: main.px * 0.9, gapAfter: 1.1 };
    }
    if (id === "countdown") {
      const px = 34 * u, padX = 26 * u, line = xFitLine(K, content.countdown, { weight: 700, px, upper: true, track: 0.1, width: Ar.w - padX * 2, minFrac: 0.6 });
      return { id, line, padX, h: px * 2, tw: line.w + padX * 2 };
    }
    if (id === "game") {
      const cover = K.tools.usable(assets.cover), cw = cover ? 170 * u : 0, ch = cover ? 226 * u : 0, gap = cover ? 34 * u : 0;
      const fit = xFit(K, content.game, { weight: 800, px: 64 * u, lhr: 1.06, track: -0.01, width: Ar.w - cw - gap, maxLines: 3, okLines: 3, minFrac: 0.55 });
      return { id, cover, cw, ch, gap, fit, h: Math.max(ch, fit.lines.length * fit.lh + fit.px * 0.14), tw: cw + gap + fit.tw };
    }
    if (id === "text") {
      const bar = 8 * u, ind = 30 * u, fit = xFit(K, content.text, { weight: 500, px: 44 * u, lhr: 1.3, width: Ar.w - ind - bar, maxLines: 3, shrink: false });
      return { id, bar, ind, fit, h: fit.lines.length * fit.lh };
    }
    const rows = members.length <= 3 ? 1 : 2, d = 150 * u, labelH = Math.max(40 * u, 36), head = 44 * u;
    return { id, rows, d, labelH, head, h: head + rows * (d + labelH + 8) + (rows - 1) * Math.min(24 * u, 18) };
  });
  spec.place = (blocks) => blocks.forEach((b) => { b.bx = b.x; b.bw = b.tw ? Math.min(b.w, b.tw) : b.w; });
  spec.extraBoxes = () => [];

  /** A landing: eased progress of a move of length `slide` that ENDS on beat k. */
  const lands = (t, k) => progress(t, land(k) - slide, slide);
  const rise = (ctx, x, y, w, h, p, fn) => xClip(ctx, x, y, w, h, () => { ctx.translate(0, (1 - p) * h * 1.15); fn(); });

  spec.bg = (ctx, t) => {
    ctx.fillStyle = pal.base; ctx.fillRect(0, 0, W, K.H);
    const s = bandH;
    // 1. the circle slides in from the right edge
    const p1 = xInOutQuart(lands(t, 1));
    if (p1 > 0) { ctx.fillStyle = pal.c1; ctx.beginPath(); ctx.arc(xr - s / 2 + (1 - p1) * (s * 2.2 + (W - xr)), y0 + s / 2, s / 2, 0, Math.PI * 2); ctx.fill(); }
    // 2. the quarter circle turns a quarter turn around the corner of its cell
    const p2 = xInOutQuart(lands(t, 2));
    if (p2 > 0) { ctx.save(); ctx.translate(xr - 2 * s, y0 + s); ctx.rotate(-(1 - p2) * Math.PI / 2); ctx.fillStyle = pal.c2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, s, -Math.PI / 2, 0); ctx.closePath(); ctx.fill(); ctx.restore(); }
    // 3. the bar grows to its full length from the left
    const p3 = xInOutQuart(lands(t, 3));
    if (p3 > 0) { ctx.fillStyle = pal.ink; ctx.fillRect(xr - 3 * s, y0 + s / 2, s * p3, s / 2); }
  };
  spec.block = (ctx, b, t) => {
    const k = beatOf(b.id), p = xOutQuart(lands(t, k));
    if (p <= 0) return;
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    if (b.id === "brand") {
      rise(ctx, b.x, b.y, b.w, b.h, p, () => {
        if (b.logo) xCover(ctx, assets.logo, b.x, b.y + (b.h - b.logo) / 2, b.logo, b.logo);
        if (b.name) { ctx.font = xFont(K, 700, b.px); ctx.fillStyle = pal.soft; xDrawTracked(ctx, b.name, b.x + b.logo + b.gap, xBase(b.y, b.h, b.px), b.tr); }
      });
    } else if (b.id === "title") {
      const f = b.fit;
      f.lines.forEach((line, j) => rise(ctx, b.x, b.y + j * f.lh, b.w, f.lh * 1.02, xOutQuart(progress(t, land(k) - slide + j * 0.1 * beat, slide)), () => { ctx.font = f.font; ctx.fillStyle = pal.text; xDrawTracked(ctx, line, b.x, xBase(b.y + j * f.lh, f.lh, f.px), f.tr); }));
      const by = b.y + f.lines.length * f.lh + b.barGap, bp = xInOutQuart(progress(t, land(k) - slide * 0.7, slide));
      ctx.fillStyle = pal.c1; ctx.fillRect(b.x, by, (W - b.x) * bp, b.barH);
    } else if (b.id === "when") {
      if (b.day) rise(ctx, b.x, b.y, b.w, b.dayH, p, () => { ctx.font = b.day.font; ctx.fillStyle = pal.soft; xDrawTracked(ctx, b.day.text, b.x, xBase(b.y, b.dayH, b.day.px), b.day.tr); });
      const m = b.main, base = b.y + b.dayH + m.px * 0.74;
      xClip(ctx, b.x, b.y + b.dayH - 4, b.w, m.px * 0.74 + 12, () => { ctx.translate(-(1 - p) * b.w * 0.35, 0); ctx.globalAlpha = clamp01(p * 3); ctx.font = m.font; ctx.fillStyle = pal.text; xDrawTracked(ctx, m.text, b.x, base, m.tr); });
    } else if (b.id === "countdown") {
      const w = b.tw * p; ctx.fillStyle = pal.ink; ctx.fillRect(b.x, b.y, w, b.h);
      xClip(ctx, b.x, b.y, w, b.h, () => { ctx.font = b.line.font; ctx.fillStyle = pal.base; xDrawTracked(ctx, b.line.text, b.x + b.padX, xBase(b.y, b.h, b.line.px), b.line.tr); });
    } else if (b.id === "game") {
      const f = b.fit, top = b.y + (b.cover ? (b.h - f.lines.length * f.lh - f.px * 0.14) / 2 : 0);
      if (b.cover) xClip(ctx, b.x, b.y, b.cw, b.h, () => { ctx.translate(0, (1 - p) * b.h); xCover(ctx, assets.cover, b.x, b.y + (b.h - b.ch) / 2, b.cw, b.ch); });
      f.lines.forEach((line, j) => rise(ctx, b.x + b.cw + b.gap, top + j * f.lh, b.w - b.cw - b.gap, f.lh * 1.02, xOutQuart(progress(t, land(k) - slide + j * 0.1 * beat, slide)), () => { ctx.font = f.font; ctx.fillStyle = pal.text; xDrawTracked(ctx, line, b.x + b.cw + b.gap, xBase(top + j * f.lh, f.lh, f.px), f.tr); }));
    } else if (b.id === "text") {
      const f = b.fit; ctx.fillStyle = pal.c2; ctx.fillRect(b.x, b.y + 4, b.bar, (b.h - 8) * p);
      f.lines.forEach((line, j) => rise(ctx, b.x + b.bar + b.ind, b.y + j * f.lh, b.w, f.lh, xOutQuart(progress(t, land(k) - slide + j * 0.1 * beat, slide)), () => { ctx.font = f.font; ctx.fillStyle = pal.soft; ctx.fillText(line, b.x + b.bar + b.ind, xBase(b.y + j * f.lh, f.lh, f.px) - f.px * 0.06); }));
    } else if (b.id === "costreamers") {
      const px = Math.max(22, b.head * 0.6); ctx.font = xFont(K, 700, px); ctx.fillStyle = pal.accent;
      rise(ctx, b.x, b.y, b.w, b.head, p, () => xDrawTracked(ctx, K.words.with, b.x, xBase(b.y, b.head, px), px * 0.18));
      const cols = b.rows === 1 ? members.length : Math.ceil(members.length / 2), gap = 24 * K.u, box = { x: b.x, y: b.y + b.head, w: Math.min(b.w, cols * (b.d + gap + 30)), h: b.h - b.head };
      const cells = layoutCostreamers(members.length, box, { maxD: b.d, gap, labelH: b.labelH }), shift = b.x - Math.min(...cells.map((c) => c.cx - Math.max(c.d, c.labelW) / 2));
      cells.forEach((cell, j) => {
        cell.cx += shift; const m = members[j], q = xOutQuart(progress(t, land(k) - slide + j * 0.12 * beat, slide));
        xClip(ctx, cell.cx - cell.labelW / 2, cell.cy - cell.d / 2 - 2, cell.labelW, cell.d + b.labelH + 12, () => {
          ctx.translate(0, (1 - q) * (cell.d + b.labelH + 24)); xAvatar(ctx, K, cell, m, assets.avatars?.[m.login], { shape: "circle" });
          ctx.fillStyle = pal.text; ctx.textAlign = "center"; ctx.textBaseline = "top";
          ctx.fillText(m.more ? "" : xNameFit(ctx, K, 700, Math.min(26 * K.u, cell.d * 0.17), m.name, cell.labelW), cell.cx, cell.labelY);
        });
      });
    }
  };
  return spec;
}

/* ───────────── The styles, by id (declared last: the functions above are hoisted) ───────────── */
const STYLE_IMPL = { broadcast: styleBroadcast, kinetic: styleKinetic, cinema: styleCinema, arcade: styleArcade, collage: styleCollage, geometric: styleGeometric };
