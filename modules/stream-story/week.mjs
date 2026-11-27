// The week's schedule video: ONE list layout shared by the fourteen styles. Each style lends its colours (palette), its background and its frames (the same `bg` / `begin` / `fg` as in its
// announcement), and a few lines of "look" below (shape of the rows, kind of entrance, letters). Same contract as scenes.mjs: every image is a PURE FUNCTION OF TIME (same t, same pixels),
// text is drawn with `fillText` only (never HTML), nothing here knows the page, the network or the clock. `createScene` (scenes.mjs) hands over a kit and adds the "Made with Curiosa" mention itself.
//
// The picture: a header (channel name, heading, the dates), then one row per event (day and time on the left, title and game in the middle, a small cover on the right), then, when needed,
// "and N more" and the free sentence. The rows come in one after the other and the picture then holds still for the last 22 % of the video (`restTime`), like the other scenes.
const v = new URL(import.meta.url).search; // the module version spreads to the neighbouring files (otherwise the old code would stay in cache after a hot update)
const { wrapText, ellipsize, rgba, clamp01, easeOutCubic, progress, solveScale } = await import(`./pure.mjs${v}`);
const { EXTRA_FONTS } = await import(`./scenes-extra.mjs${v}`);

/**
 * How each style writes its rows. `shape`: round (soft panel), square (hard panel), slab (slanted panel), line (a rule under the row, no panel). `motion`: slide (in from the left),
 * wipe (revealed from the left), rise (up and in), steps (a few jumps, like a screen with few frames). `head` / `body`: the letters ("site" = the font of the site, or the style's own).
 * `upper`: capitals for the day. `edge`: a bar on the left of each row in the accent colour. `glow`: a soft light around the text (neon).
 */
const LOOK = {
  neon: { shape: "round", motion: "slide", glow: true, edge: false },
  poster: { shape: "square", motion: "slide", edge: true },
  countdown: { shape: "round", motion: "rise", edge: false },
  minimal: { shape: "line", motion: "rise", edge: false },
  broadcast: { shape: "square", motion: "wipe", edge: true, upper: true },
  kinetic: { shape: "line", motion: "slide", edge: false, upper: true },
  cinema: { shape: "line", motion: "rise", head: "serif", body: "serif", edge: false },
  arcade: { shape: "square", motion: "steps", head: "mono", body: "mono", edge: true, upper: true },
  collage: { shape: "square", motion: "rise", head: "head", body: "type", edge: false },
  geometric: { shape: "square", motion: "wipe", edge: true },
  epic: { shape: "square", motion: "rise", head: "serif", body: "serif", edge: false, upper: true },
  arena: { shape: "slab", motion: "wipe", edge: false, upper: true },
  abyss: { shape: "square", motion: "wipe", head: "mono", body: "mono", edge: true, upper: true },
  haunt: { shape: "line", motion: "rise", edge: false },
};
export const WEEK_LOOK = LOOK;

/** The most room one row takes, whatever the number of rows (a week of two events is not stretched over the whole video). */
const ROW_MAX = 168, ROW_MIN = 78, GAP = 10;

export function createWeekScene(K) {
  const { W, H, duration: D, content: C, assets, pal, family, mctx, backdrop } = K, look = LOOK[K.style] ?? LOOK.neon;
  const fam = (key) => (key && EXTRA_FONTS[key]) || family;
  const headFam = fam(look.head), bodyFam = fam(look.body);
  const font = (weight, px, f = bodyFam, italic = false) => `${italic ? "italic " : ""}${weight} ${Math.max(20, Math.round(px))}px ${f}`;
  const measure = (f) => (s) => { mctx.font = f; return mctx.measureText(s).width; };
  const usable = K.tools.usable;
  const rows = Array.isArray(C.rows) ? C.rows : [], n = rows.length;
  // The area really free: the style's own bars and frames (reserve, inset) and a slow push-in (shrink) are kept out of it.
  const R = backdrop.reserve ?? { top: 0, bottom: 0 }, inset = backdrop.inset ?? 0, shrink = backdrop.shrink && backdrop.shrink < 1 ? backdrop.shrink : 1;
  let Ar = { x: K.A.x + inset, y: K.A.y + R.top, w: K.A.w - inset * 2, h: K.A.h - R.top - R.bottom };
  if (shrink < 1) { const cx = Ar.x + Ar.w / 2, cy = Ar.y + Ar.h / 2; Ar = { x: cx - (Ar.w * shrink) / 2, y: cy - (Ar.h * shrink) / 2, w: Ar.w * shrink, h: Ar.h * shrink }; }
  const upper = (s) => (look.upper ? String(s).toLocaleUpperCase(C.lang) : String(s));

  /* ───────── The pieces, at scale u (1 = the biggest) ───────── */
  const hasBrand = !!(C.brand || K.hasLogo), hasHead = !!C.heading, hasMore = !!C.moreText, hasText = !!C.text;
  const hasThumbs = rows.some((r) => r.thumb && assets.thumbs?.[r.thumb] && usable(assets.thumbs[r.thumb]));

  function build(u) {
    const parts = {};
    if (hasBrand) {
      const px = 34 * u, logo = K.hasLogo ? 60 * u : 0, gap = logo && C.brand ? 18 * u : 0, m = measure(font(700, px));
      const name = C.brand ? ellipsize(m, upper(C.brand), Ar.w - logo - gap) : "";
      parts.brand = { id: "brand", h: Math.max(logo, px * 1.4), px, logo, gap, name, tw: logo + gap + (name ? m(name) : 0) };
    }
    if (hasHead) {
      let px = 92 * u, f = font(900, px, headFam), m = measure(f);
      const text = upper(C.heading);
      while (m(text) > Ar.w && px > 40) { px -= 4; f = font(900, px, headFam); m = measure(f); }
      const shown = m(text) > Ar.w ? ellipsize(m, text, Ar.w) : text;
      parts.head = { id: "head", h: px * 1.12, px, text: shown, font: f, tw: m(shown) };
      if (C.range) { const rp = 38 * u, rm = measure(font(600, rp)); parts.range = { id: "range", h: rp * 1.3, px: rp, text: ellipsize(rm, C.range, Ar.w) }; }
    }
    if (hasMore) { const px = 36 * u, m = measure(font(800, px)); parts.more = { id: "more", h: px * 1.5, px, text: ellipsize(m, C.moreText, Ar.w) }; }
    if (hasText) {
      const px = 34 * u, f = font(500, px, bodyFam, true), m = measure(f), lines = wrapText(m, C.text, Ar.w - 36 * u, 2);
      parts.text = { id: "text", h: lines.length * px * 1.3 + 6 * u, px, lines, font: f, lh: px * 1.3, bar: 6 * u };
    }
    return parts;
  }
  /** Height of everything but the rows, and the gaps between the pieces. */
  const chrome = (u) => {
    const p = build(u), head = [p.brand, p.head, p.range].filter(Boolean), foot = [p.more, p.text].filter(Boolean);
    const hh = head.reduce((s, b) => s + b.h, 0) + Math.max(0, head.length - 1) * 10 * u + (head.length ? 26 * u : 0);
    const fh = foot.reduce((s, b) => s + b.h, 0) + Math.max(0, foot.length - 1) * 8 * u + (foot.length ? 22 * u : 0);
    return { p, hh, fh };
  };
  const totalAt = (u) => { const c = chrome(u); return c.hh + c.fh + n * ROW_MIN + Math.max(0, n - 1) * GAP; };
  const u = n ? solveScale(totalAt, Ar.h, 1.25, 0.4) : 1;
  const { p: parts, hh, fh } = chrome(u);
  const rowGap = GAP;
  // The rows share what is left, between ROW_MIN (two lines of 24 px and the breathing room) and ROW_MAX each.
  const rowsAvail = Math.max(0, Ar.h - hh - fh), rowH = n ? Math.max(Math.min(ROW_MIN, rowsAvail / n), Math.min(ROW_MAX, (rowsAvail - Math.max(0, n - 1) * rowGap) / n)) : 0;
  const rowsH = n ? n * rowH + (n - 1) * rowGap : 0, used = hh + rowsH + fh, top = Ar.y + Math.max(0, (Ar.h - used) / 2);

  /* ───────── The rows ───────── */
  const pad = Math.max(10, rowH * 0.12), inner = rowH - pad * 2, thumb = hasThumbs ? Math.min(inner, 112 * u) : 0, thumbGap = thumb ? 16 * u : 0;
  const timePx = Math.max(22, Math.min(40 * u, rowH * 0.3)), dayPx = Math.max(20, timePx * 0.8);
  const fDay = font(800, dayPx), fTime = font(800, timePx), mDay = measure(fDay), mTime = measure(fTime);
  const colW = C.showWhen ? Math.min(Ar.w * 0.34, Math.max(0, ...rows.map((r) => Math.max(r.dayLabel ? mDay(upper(r.dayLabel)) : 0, r.time ? mTime(r.time) : 0)))) : 0, colGap = colW ? 22 * u : 0;
  const textX = pad + (look.edge ? 10 * u : 0) + colW + colGap, textW = Math.max(60, Ar.w - textX - pad - (thumb ? thumb + thumbGap : 0));
  const titlePxMax = Math.max(24, Math.min(46 * u, rowH * 0.34));
  const laid = rows.map((r, i) => {
    let px = titlePxMax, lines = [], fT = font(700, px), mT = measure(fT);
    for (; px >= 24; px -= 2) {
      fT = font(700, px); mT = measure(fT); lines = wrapText(mT, r.title, textW, 2);
      const cut = lines.length > 0 && lines[lines.length - 1].endsWith("…") && !r.title.endsWith("…");
      if (!cut && lines.length * px * 1.12 <= inner) break;
    }
    if (px < 24 || lines.length * px * 1.12 > inner) { px = Math.max(20, Math.min(px + 2, 24)); fT = font(700, px); mT = measure(fT); lines = wrapText(mT, r.title, textW, Math.max(1, Math.floor(inner / (px * 1.12)))); }
    const gpx = Math.max(20, px * 0.74), gm = measure(font(600, gpx));
    const room = inner - lines.length * px * 1.12;
    const game = r.game && lines.length === 1 && room >= gpx * 1.1 && !new RegExp(r.game.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(r.title) ? { text: ellipsize(gm, r.game, textW), px: gpx } : null;
    return { i, r, y: top + hh + i * (rowH + rowGap), lines, px, fT, game, thumb: r.thumb && assets.thumbs?.[r.thumb] && usable(assets.thumbs[r.thumb]) ? assets.thumbs[r.thumb] : null };
  });
  const headY = top, footY = top + hh + rowsH + (rowsH ? 22 * u : 0);

  /* ───────── The timeline ───────── */
  const rest = D * 0.78, L = Math.min(0.7, Math.max(0.4, D * 0.05)), t0 = 0.5;
  const step = n > 1 ? Math.min(0.5, Math.max(0.09, (rest - L - 0.35 - t0) / (n - 1))) : 0;
  const startOfRow = (i) => t0 + i * step, headStart = 0.12, footStart = Math.min(rest - L, t0 + n * step);

  /* ───────── The boxes (what really takes room, for the safe-area check) ───────── */
  const blocks = [];
  let cursor = headY;
  for (const b of [parts.brand, parts.head, parts.range]) if (b) { blocks.push({ id: b.id, x: Ar.x, y: cursor, w: b.id === "head" ? Math.min(Ar.w, b.tw) : b.id === "brand" ? Math.min(Ar.w, b.tw) : Ar.w, h: b.h }); cursor += b.h + 10 * u; }
  laid.forEach((l) => blocks.push({ id: `row${l.i}`, x: Ar.x, y: l.y, w: Ar.w, h: rowH }));
  cursor = footY;
  for (const b of [parts.more, parts.text]) if (b) { blocks.push({ id: b.id, x: Ar.x, y: cursor, w: Ar.w, h: b.h }); cursor += b.h + 8 * u; }

  /* ───────── Drawing ───────── */
  function shapePath(ctx, x, y, w, h) {
    ctx.beginPath();
    if (look.shape === "round") { const r = Math.min(h / 2, 22 * u); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    else if (look.shape === "slab") { const s = 0.2 * h; ctx.moveTo(x + s, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - s, y + h); ctx.lineTo(x, y + h); ctx.closePath(); }
    else ctx.rect(x, y, w, h);
  }
  function text(ctx, s, x, y, f, color, align = "left", glow = false) {
    ctx.font = f; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle";
    if (glow) { ctx.save(); ctx.shadowColor = pal.accent; ctx.shadowBlur = 22; ctx.fillText(s, x, y); ctx.restore(); }
    ctx.fillText(s, x, y);
  }
  function thumbPic(ctx, img, x, y, size) {
    const w = img.naturalWidth || img.width || 1, h = img.naturalHeight || img.height || 1, k = Math.max(size / w, size / h), sw = size / k, sh = size / k;
    ctx.save(); shapePathRound(ctx, x, y, size, size, look.shape === "round" ? 16 * u : look.shape === "line" ? 10 * u : 4 * u); ctx.clip();
    ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh, x, y, size, size); ctx.restore();
  }
  function shapePathRound(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  /** The entrance of a piece: returns { a (opacity), dx, dy, clip (0 to 1, how much of its width is shown, or 1) }. */
  function enter(t, s) {
    const p = easeOutCubic(progress(t, s, L)), raw = progress(t, s, L);
    if (look.motion === "wipe") return { a: clamp01(raw * 3), dx: 0, dy: 0, clip: p };
    if (look.motion === "rise") return { a: clamp01(raw * 1.6), dx: 0, dy: (1 - p) * 34 * u, clip: 1 };
    if (look.motion === "steps") { const q = Math.floor(raw * 5) / 5; return { a: q > 0 ? 1 : 0, dx: (1 - q) * -60 * u, dy: 0, clip: 1 }; }
    return { a: clamp01(raw * 1.6), dx: (1 - p) * -90 * u, dy: 0, clip: 1 };
  }
  function withEnter(ctx, e, box, fn) {
    if (e.a <= 0.001 || e.clip <= 0.001) return;
    ctx.save(); ctx.globalAlpha *= e.a; ctx.translate(e.dx, e.dy);
    if (e.clip < 1) { ctx.beginPath(); ctx.rect(box.x - 40, box.y - 40, (box.w + 80) * e.clip, box.h + 80); ctx.clip(); }
    fn(); ctx.restore();
  }
  const edgeColor = pal.accent;

  function drawRow(ctx, l, t) {
    const e = enter(t, startOfRow(l.i)), box = { x: Ar.x, y: l.y, w: Ar.w, h: rowH };
    withEnter(ctx, e, box, () => {
      const x = Ar.x, y = l.y;
      if (look.shape === "line") {
        ctx.fillStyle = rgba(pal.text, 0.28); ctx.fillRect(x, y + rowH - 2, Ar.w, 2);
      } else {
        shapePath(ctx, x, y, Ar.w, rowH); ctx.fillStyle = rgba(pal.text, K.style === "collage" ? 0.12 : 0.085); ctx.fill();
        if (K.style === "neon" || K.style === "epic" || K.style === "abyss" || K.style === "arcade") { ctx.strokeStyle = rgba(K.style === "epic" ? (pal.gold ?? pal.accent) : pal.accent, 0.55); ctx.lineWidth = 2; ctx.stroke(); }
      }
      if (look.edge) { ctx.fillStyle = edgeColor; ctx.fillRect(x, y, 8 * u, rowH); }
      const cy = y + rowH / 2, gx = x + textX;
      if (C.showWhen && colW) {
        const dayLabel = l.r.dayLabel ? upper(l.r.dayLabel) : "";
        const both = dayLabel && l.r.time, tx = x + pad + (look.edge ? 10 * u : 0);
        if (dayLabel) text(ctx, dayLabel, tx, both ? cy - timePx * 0.62 : cy, fDay, pal.accent, "left", look.glow);
        if (l.r.time) text(ctx, l.r.time, tx, both ? cy + dayPx * 0.62 : cy, fTime, pal.text, "left");
      }
      const lh = l.px * 1.12, gh = l.game ? l.game.px * 1.2 : 0, blockH = l.lines.length * lh + gh, ty = cy - blockH / 2;
      l.lines.forEach((line, k) => text(ctx, line, gx, ty + lh * k + lh / 2, l.fT, pal.text, "left", look.glow));
      if (l.game) text(ctx, l.game.text, gx, ty + l.lines.length * lh + gh / 2, font(600, l.game.px), pal.soft, "left");
      if (l.thumb) thumbPic(ctx, l.thumb, x + Ar.w - pad - thumb, cy - thumb / 2, thumb);
    });
  }
  function drawHeader(ctx, t) {
    let y = headY;
    const items = [parts.brand, parts.head, parts.range].filter(Boolean);
    items.forEach((b, k) => {
      const e = enter(t, headStart + k * 0.12), box = { x: Ar.x, y, w: Ar.w, h: b.h };
      withEnter(ctx, e, box, () => {
        if (b.id === "brand") {
          if (b.logo) { ctx.save(); shapePathRound(ctx, Ar.x, y + (b.h - b.logo) / 2, b.logo, b.logo, b.logo * 0.22); ctx.clip(); const img = assets.logo, w = img.naturalWidth || img.width || 1, h = img.naturalHeight || img.height || 1, k2 = Math.max(b.logo / w, b.logo / h); ctx.drawImage(img, (w - b.logo / k2) / 2, (h - b.logo / k2) / 2, b.logo / k2, b.logo / k2, Ar.x, y + (b.h - b.logo) / 2, b.logo, b.logo); ctx.restore(); }
          if (b.name) text(ctx, b.name, Ar.x + b.logo + b.gap, y + b.h / 2, font(700, b.px), pal.soft, "left");
        } else if (b.id === "head") text(ctx, b.text, Ar.x, y + b.h / 2, b.font, pal.text, "left", look.glow);
        else text(ctx, b.text, Ar.x, y + b.h / 2, font(600, b.px), pal.accent, "left");
      });
      y += b.h + 10 * u;
    });
  }
  function drawFooter(ctx, t) {
    let y = footY;
    for (const b of [parts.more, parts.text]) {
      if (!b) continue;
      const e = enter(t, footStart + (b.id === "text" ? 0.15 : 0)), box = { x: Ar.x, y, w: Ar.w, h: b.h };
      withEnter(ctx, e, box, () => {
        if (b.id === "more") text(ctx, b.text, Ar.x, y + b.h / 2, font(800, b.px), pal.accent, "left");
        else {
          ctx.fillStyle = pal.accent; ctx.fillRect(Ar.x, y + 3 * u, b.bar, b.h - 6 * u);
          b.lines.forEach((line, k) => text(ctx, line, Ar.x + 30 * u, y + b.lh * k + b.lh / 2 + 3 * u, b.font, pal.soft, "left"));
        }
      });
      y += b.h + 8 * u;
    }
  }
  function draw(ctx, t) {
    ctx.save();
    backdrop.bg(ctx, t);
    ctx.save(); backdrop.begin(ctx, t);
    drawHeader(ctx, t);
    laid.forEach((l) => drawRow(ctx, l, t));
    drawFooter(ctx, t);
    ctx.restore();
    backdrop.fg(ctx, t);
    ctx.restore();
  }
  return { boxes: blocks, blocks, scale: u, draw, rowH, rows: n };
}
