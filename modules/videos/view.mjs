// Vidéothèque — les pages publiques. Aucune saisie de visiteur n'est affichée telle quelle : tout est échappé ; les adresses sont fabriquées ici à partir de nombres et d'identifiants validés.
// RIEN ne part vers la plateforme tant que la personne n'a pas cliqué : la miniature vient de la copie gardée par le site (ou d'un fond sobre), le lecteur est créé au clic.
//
// Chemins (jamais de « ?x=y » : une page de module ne les reçoit pas) :
//   /                                  le catalogue (12 par page, plus récentes d'abord)
//   /c/<catégorie>[/s/<mots>][/after/<curseur>]   catalogue filtré ; /s/<mots>[/after/<curseur>] : recherche seule ; « after » : la page suivante
//   /v/<n>[-titre][/in/<p>][/play]     une vidéo ; « in » : dans une série ; « play » : avec le lecteur déjà ouvert (sans JavaScript)
//   /p                                 toutes les séries · /p/<p>[-titre] : une série
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const R = await import(`./providers.mjs${v}`);
const A = await import(`./albums.mjs${v}`);
const { esc, LIMITS } = P;

const CSS = `
.vl{font-family:var(--v-font,inherit);color:var(--v-fg,inherit);max-width:72rem;margin:0 auto}
.vl *{box-sizing:border-box}
.vl h2,.vl h3,.vl p,.vl ul,.vl ol{margin:0;padding:0}
.vl ul,.vl ol{list-style:none}
.vl a{color:inherit}
.vl-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.vl .vl-intro{color:var(--v-muted,#aaa);font-size:1.05rem;max-width:42rem;margin:0 0 1.25rem;overflow-wrap:anywhere}
.vl-tools{display:flex;flex-direction:column;gap:.75rem;margin:0 0 1.25rem}
.vl-chips{display:flex;flex-wrap:wrap;gap:.5rem}
.vl-chip{display:inline-flex;align-items:center;min-height:2.75rem;padding:.4rem 1rem;border-radius:999px;border:1px solid var(--v-line,#333);background:var(--v-surface,#1c1c1f);text-decoration:none;font-weight:600;overflow-wrap:anywhere}
.vl-chip[aria-current]{background:var(--v-accent,#e8a23b);color:var(--v-accent-fg,#111);border-color:transparent}
[data-accent2] .vl-chip[aria-current]{background:var(--v-accent2,#e8a23b);color:var(--v-accent2-fg,#111)}
.vl-search{display:flex;gap:.5rem;max-width:34rem}
.vl-search input[type=search]{flex:1 1 auto;min-width:0;min-height:2.75rem;padding:.5rem .9rem;border-radius:.7rem;border:1px solid var(--v-line,#333);background:var(--v-surface,#1c1c1f);color:var(--v-fg,inherit);font:inherit}
.vl-btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:2.75rem;padding:.5rem 1.1rem;border-radius:.7rem;border:1px solid var(--v-line,#333);background:var(--v-surface,#1c1c1f);color:var(--v-fg,inherit);font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
.vl-btn-main{background:var(--v-accent,#e8a23b);color:var(--v-accent-fg,#111);border-color:transparent}
[data-accent2] .vl-btn-main{background:var(--v-accent2,#e8a23b);color:var(--v-accent2-fg,#111)}
.vl a:focus-visible,.vl button:focus-visible,.vl input:focus-visible,.vl summary:focus-visible{outline:2px solid var(--v-fg,currentColor);outline-offset:3px}
.vl-count{color:var(--v-muted,#aaa);margin:0 0 1rem}
.vl-grid{display:grid;gap:1.1rem;grid-template-columns:repeat(auto-fill,minmax(min(100%,16rem),1fr))}
.vl-card{min-width:0}
.vl-card>a{display:flex;flex-direction:column;gap:.55rem;height:100%;text-decoration:none}
.vl-img{position:relative;display:block;aspect-ratio:16/9;overflow:hidden;border-radius:.8rem;border:1px solid var(--v-line,#333);background:linear-gradient(135deg,color-mix(in srgb,var(--v-accent,#e8a23b) 30%,var(--v-surface,#1c1c1f)),var(--v-surface,#1c1c1f))}
.vl-img::before{content:"";position:absolute;left:50%;top:50%;width:3.2rem;height:3.2rem;transform:translate(-50%,-50%);border-radius:50%;background:color-mix(in srgb,var(--v-bg,#000) 60%,transparent)}
.vl-img::after{content:"";position:absolute;left:50%;top:50%;transform:translate(-30%,-50%);border-style:solid;border-width:.7rem 0 .7rem 1.1rem;border-color:transparent transparent transparent var(--v-fg,#fff)}
.vl-img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1}
.vl-dur{position:absolute;right:.45rem;bottom:.45rem;z-index:2;padding:.1rem .45rem;border-radius:.4rem;font-size:.82rem;font-weight:700;background:color-mix(in srgb,var(--v-bg,#000) 82%,transparent);color:var(--v-fg,#fff)}
.vl-num{position:absolute;left:.45rem;top:.45rem;z-index:2;min-width:1.8rem;padding:.1rem .45rem;border-radius:.4rem;font-size:.82rem;font-weight:700;text-align:center;background:color-mix(in srgb,var(--v-bg,#000) 82%,transparent);color:var(--v-fg,#fff)}
.vl-ct{font-weight:700;line-height:1.3;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.vl-meta{display:flex;flex-wrap:wrap;gap:.25rem .6rem;color:var(--v-muted,#aaa);font-size:.9rem;align-items:center}
.vl-badge{display:inline-block;padding:.05rem .6rem;border-radius:999px;font-size:.8rem;font-weight:700;background:var(--v-accent,#e8a23b);color:var(--v-accent-fg,#111)}
[data-accent2] .vl-badge{background:var(--v-accent2,#e8a23b);color:var(--v-accent2-fg,#111)}
.vl-more{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;margin:1.5rem 0 0}
.vl-sec{margin:0 0 2rem}
.vl-sec h2{font-size:1.3rem;font-weight:800;margin:0 0 .75rem}
.vl-empty{padding:2.25rem 1.25rem;text-align:center;border:1px dashed var(--v-line,#333);border-radius:1rem;background:var(--v-surface,#1c1c1f)}
.vl-empty-t{font-size:1.15rem;font-weight:700}
.vl .vl-empty-s{color:var(--v-muted,#aaa);margin-top:.35rem}
.vl-crumb{margin:0 0 1rem}
.vl-crumb a{display:inline-flex;align-items:center;min-height:2.75rem}
.vl-player{position:relative;aspect-ratio:16/9;width:100%;overflow:hidden;border-radius:.9rem;border:1px solid var(--v-line,#333);background:var(--v-surface,#1c1c1f)}
.vl-player iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.vl-poster{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:flex-start;text-decoration:none}
.vl-poster .vl-img{position:absolute;inset:0;aspect-ratio:auto;border:0;border-radius:0}
.vl-poster .vl-img::before{width:4.6rem;height:4.6rem}
.vl-poster .vl-img::after{border-width:1rem 0 1rem 1.6rem}
.vl-playlabel{position:relative;z-index:3;margin:.75rem;padding:.55rem 1rem;border-radius:.7rem;font-weight:700;background:var(--v-accent,#e8a23b);color:var(--v-accent-fg,#111)}
[data-accent2] .vl-playlabel{background:var(--v-accent2,#e8a23b);color:var(--v-accent2-fg,#111)}
.vl .vl-note{color:var(--v-muted,#aaa);font-size:.88rem;margin:.5rem 0 0}
.vl-actions{display:flex;flex-wrap:wrap;gap:.6rem;margin:1rem 0}
.vl-body{margin:1rem 0;max-width:46rem;line-height:1.6;overflow-wrap:anywhere}
.vl-body p+p{margin-top:.8rem}
.vl-body a{text-decoration:underline;text-underline-offset:.2em}
.vl-det{margin:1rem 0;max-width:46rem;border:1px solid var(--v-line,#333);border-radius:.8rem;background:var(--v-surface,#1c1c1f)}
.vl-det summary{cursor:pointer;min-height:2.75rem;display:flex;align-items:center;padding:.5rem 1rem;font-weight:700}
.vl-det .vl-body{padding:0 1rem 1rem;margin:0}
.vl-series{margin:1.25rem 0;padding:1rem;border:1px solid var(--v-line,#333);border-radius:.9rem;background:var(--v-surface,#1c1c1f)}
.vl-series h2{font-size:1.1rem;font-weight:800;overflow-wrap:anywhere}
.vl-pn{display:flex;flex-wrap:wrap;gap:.6rem;margin:.75rem 0}
.vl-list{display:flex;flex-direction:column;gap:.25rem}
.vl-list a{display:flex;gap:.6rem;align-items:center;min-height:2.75rem;padding:.3rem .5rem;border-radius:.6rem;text-decoration:none;overflow-wrap:anywhere}
.vl-list a[aria-current]{background:color-mix(in srgb,var(--v-accent,#e8a23b) 24%,transparent);font-weight:700}
.vl-list .vl-i{flex:0 0 auto;min-width:1.8rem;color:var(--v-muted,#aaa);text-align:right}
.vl-share{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:1rem 0}
.vl-share .vl-btn{font-weight:500}
@media (prefers-reduced-motion:no-preference){.vl-card>a .vl-img{transition:border-color .15s ease}.vl-card>a:hover .vl-img{border-color:var(--v-accent,#e8a23b)}}
@media (min-width:36rem){.vl-tools{flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:space-between}}
`.replace(/\n/g, "");

const html = (ctx, inner, cls = "") => ({ type: "html", html: `<div class="vl${cls ? ` ${cls}` : ""}"><style>${CSS}</style>${inner}</div>` });
const empty = (title, sub, extra = "") => `<div class="vl-empty" role="status"><p class="vl-empty-t">${esc(title)}</p>${sub ? `<p class="vl-empty-s">${esc(sub)}</p>` : ""}${extra}</div>`;

// ── Lire l'adresse ─────────────────────────────────────────────────────────────────────────────────────────────────

const NUM = /^(\d{1,7})(?:-[a-z0-9-]{0,80})?$/;
/** Les segments de l'adresse → ce qu'il faut montrer, ou null (page introuvable). */
export function parseRoute(segments) {
  const s = (Array.isArray(segments) ? segments : []).filter((x) => x !== "");
  if (!s.length) return { kind: "list", cat: "", q: "", after: "" };
  if (s[0] === "v") {
    const m = NUM.exec(s[1] ?? "");
    if (!m || s.length > 5) return null;
    const out = { kind: "video", n: Number(m[1]), p: 0, play: false };
    let i = 2;
    if (s[i] === "in") { const q = NUM.exec(s[i + 1] ?? ""); if (!q) return null; out.p = Number(q[1]); i += 2; }
    if (s[i] === "play") { out.play = true; i++; }
    return i === s.length ? out : null;
  }
  if (s[0] === "p") {
    if (s.length === 1) return { kind: "seriesIndex" };
    const m = NUM.exec(s[1]);
    return m && s.length === 2 ? { kind: "series", p: Number(m[1]) } : null;
  }
  const out = { kind: "list", cat: "", q: "", after: "" };
  let i = 0;
  if (s[i] === "c") { if (!/^[a-z0-9-]{1,40}$/.test(s[i + 1] ?? "")) return null; out.cat = s[i + 1]; i += 2; }
  if (s[i] === "s") { if (!/^[\p{L}\p{N}-]{1,60}$/u.test(s[i + 1] ?? "")) return null; out.q = s[i + 1]; i += 2; }
  if (s[i] === "after") { if (!P.parseCursor(s[i + 1])) return null; out.after = s[i + 1]; i += 2; }
  return i === s.length && i > 0 ? out : null;
}

// ── Morceaux de page ───────────────────────────────────────────────────────────────────────────────────────────────

/** Le chemin de la miniature d'une vidéo, ou "" (fond sobre). `thumbs: plain` : jamais d'image de la plateforme. */
function imgSrc(ctx, x, cfg) {
  if (cfg.thumbs === "plain") return x.cover || "";
  return x.cover || (x.thumb ? P.thumbPath(ctx, x) : "");
}
const imgBox = (ctx, x, cfg, extra = "") => {
  const src = imgSrc(ctx, x, cfg);
  return `<span class="vl-img">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" width="320" height="180">` : ""}${extra}</span>`;
};

function card(ctx, snap, x, cfg, voc, opts = {}) {
  const href = P.videoPath(ctx, x, opts.series ? { series: opts.series } : {});
  if (!href) return "";
  const cat = x.cat ? D.catName(ctx, snap.cats.find((c) => c.k === x.cat)) : "";
  const date = P.formatDate(x.date, ctx.locale);
  const dur = P.formatDuration(x.dur);
  const extra = (opts.num ? `<span class="vl-num">${opts.num}</span>` : "") + (dur ? `<span class="vl-dur">${esc(dur)}</span>` : "");
  const metas = [cat && `<span>${esc(cat)}</span>`, date && `<span>${esc(date)}</span>`, x.free && `<span class="vl-badge">${esc(voc.free)}</span>`].filter(Boolean).join("");
  return `<li class="vl-card"><a href="${esc(href)}">${imgBox(ctx, x, cfg, extra)}<span class="vl-ct">${esc(x.title)}</span>${metas ? `<span class="vl-meta">${metas}</span>` : ""}</a></li>`;
}

const grid = (ctx, snap, list, cfg, voc, opts) => `<ul class="vl-grid">${list.map((x, i) => card(ctx, snap, x, cfg, voc, { ...opts, num: opts?.numbered ? i + 1 : 0 })).join("")}</ul>`;

function seriesCard(ctx, snap, s, cfg, voc) {
  const href = P.seriesPath(ctx, s);
  const vids = D.seriesVideos(snap, s);
  if (!href || !vids.length) return "";
  const n = vids.length;
  return `<li class="vl-card"><a href="${esc(href)}">${imgBox(ctx, vids[0], cfg, `<span class="vl-dur">${esc(ctx.t("count", { n, word: n === 1 ? voc.one : voc.plural }).toLowerCase())}</span>`)}<span class="vl-ct">${esc(D.seriesName(ctx, s))}</span></a></li>`;
}

// ── Le catalogue ───────────────────────────────────────────────────────────────────────────────────────────────────

function toolbar(ctx, snap, route, voc) {
  const cats = snap.cats.filter((c) => snap.items.some((x) => x.cat === c.k && D.isPublic(x)));
  const chip = (label, href, current) => `<a class="vl-chip" href="${esc(href)}"${current ? ' aria-current="page"' : ""}>${esc(label)}</a>`;
  const chips = cats.length > 0 ? `<nav aria-label="${esc(ctx.t("filterBy"))}"><div class="vl-chips">${chip(ctx.t("all"), P.listPath(ctx, {}) ?? "/", !route.cat)}${cats.map((c) => chip(D.catName(ctx, c), P.listPath(ctx, { cat: c.slug }) ?? "/", route.cat === c.slug)).join("")}</div></nav>` : "";
  const label = ctx.t("searchLabel", { word: voc.plural.toLowerCase() });
  const search = `<form class="vl-search" method="get" action="/m/${esc(encodeURIComponent(ctx.instance.key))}/find" role="search"><label class="vl-sr" for="vl-q">${esc(label)}</label><input id="vl-q" type="search" name="q" maxlength="${LIMITS.searchMax}" value="${esc(route.q.replace(/-/g, " "))}" placeholder="${esc(label)}" autocomplete="off">${route.cat ? `<input type="hidden" name="c" value="${esc(route.cat)}">` : ""}<button class="vl-btn" type="submit">${esc(ctx.t("search"))}</button></form>`;
  return `<div class="vl-tools">${chips}${search}</div>`;
}

async function renderList(ctx, route, cfg, voc) {
  const snap = await D.snapshot(ctx);
  const cat = route.cat ? D.catByRef(snap, route.cat) : null;
  if (route.cat && !cat) return { notFound: true };
  const words = P.searchWords(route.q.replace(/-/g, " "));
  const cursor = route.after ? P.parseCursor(route.after) : null;
  const found = D.findPublic(snap, { cat: cat?.k ?? 0, words, cursor, limit: cfg.perPage });
  const filtered = !!(cat || words.length);
  const parts = [];
  if (cfg.intro && !filtered && !cursor) parts.push(`<div class="vl-intro">${P.paragraphs(cfg.intro)}</div>`);
  const anyPublic = snap.items.some(D.isPublic);
  if (!anyPublic) {
    parts.push(empty(ctx.t("emptyTitle", { word: voc.plural.toLowerCase() }), ctx.t("emptyText")));
    return { title: voc.plural, description: ctx.t("pageDescription", { word: voc.plural.toLowerCase() }), blocks: [html(ctx, parts.join(""))] };
  }
  parts.push(toolbar(ctx, snap, route, voc));
  // Les séries : seulement sur la première page du catalogue entier.
  if (!filtered && !cursor) {
    const shown = snap.series.filter((s) => s.status === "published").map((s) => seriesCard(ctx, snap, s, cfg, voc)).filter(Boolean).slice(0, 12);
    if (shown.length) parts.push(`<section class="vl-sec" aria-labelledby="vl-series-t"><h2 id="vl-series-t">${esc(voc.series)}</h2><ul class="vl-grid">${shown.join("")}</ul></section>`);
  }
  const countText = ctx.t("count", { n: found.total, word: found.total === 1 ? voc.one.toLowerCase() : voc.plural.toLowerCase() });
  if (filtered) parts.push(`<p class="vl-count" role="status">${esc(words.length ? ctx.t("resultsFor", { count: countText, q: route.q.replace(/-/g, " ") }) : countText)}</p>`);
  if (!found.items.length) {
    parts.push(empty(ctx.t("noResultTitle"), ctx.t("noResultText"), `<p style="margin-top:1rem"><a class="vl-btn" href="${esc(P.homeHref(ctx))}">${esc(ctx.t("backToAll"))}</a></p>`));
  } else {
    parts.push(`<section aria-label="${esc(voc.plural)}">${grid(ctx, snap, found.items, cfg, voc)}</section>`);
    const moreLinks = [];
    if (found.next) moreLinks.push(`<a class="vl-btn vl-btn-main" rel="next" href="${esc(P.listPath(ctx, { cat: cat?.slug ?? "", q: words.length ? route.q : "", after: found.next }) ?? "/")}">${esc(ctx.t("seeMore"))}</a>`);
    if (cursor) moreLinks.push(`<a class="vl-btn" href="${esc(P.listPath(ctx, { cat: cat?.slug ?? "", q: words.length ? route.q : "" }) ?? "/")}">${esc(ctx.t("backToStart"))}</a>`);
    if (moreLinks.length) parts.push(`<p class="vl-more">${moreLinks.join("")}</p>`);
  }
  const catTitle = cat ? `${D.catName(ctx, cat)} — ${voc.plural}` : voc.plural;
  return { title: catTitle, description: cfg.intro ? P.clean(cfg.intro, 160) : ctx.t("pageDescription", { word: voc.plural.toLowerCase() }), blocks: [html(ctx, parts.join(""))] };
}

// ── Les séries ─────────────────────────────────────────────────────────────────────────────────────────────────────

async function renderSeriesIndex(ctx, cfg, voc) {
  const snap = await D.snapshot(ctx);
  const cards = snap.series.filter((s) => s.status === "published").map((s) => seriesCard(ctx, snap, s, cfg, voc)).filter(Boolean);
  const inner = cards.length ? `<ul class="vl-grid">${cards.join("")}</ul>` : empty(ctx.t("seriesEmptyTitle", { word: voc.series.toLowerCase() }), ctx.t("seriesEmptyText"));
  return { title: voc.series, description: ctx.t("seriesDescription"), blocks: [html(ctx, `<p class="vl-crumb"><a href="${esc(P.homeHref(ctx))}">← ${esc(voc.plural)}</a></p>${inner}`)] };
}

async function renderSeries(ctx, route, cfg, voc) {
  const snap = await D.snapshot(ctx);
  const s = snap.series.find((x) => x.p === route.p && x.status === "published");
  if (!s) return { notFound: true };
  const vids = D.seriesVideos(snap, s);
  if (!vids.length) return { notFound: true };
  const desc = P.pickName(s.descs, ctx.locale, ctx.defaultLocale);
  const first = P.videoPath(ctx, vids[0], { series: s, play: true });
  const parts = [`<p class="vl-crumb"><a href="${esc(P.homeHref(ctx))}">← ${esc(voc.plural)}</a></p>`];
  if (desc) parts.push(`<div class="vl-body">${P.paragraphs(desc)}</div>`);
  parts.push(`<p class="vl-count">${esc(ctx.t("count", { n: vids.length, word: vids.length === 1 ? voc.one.toLowerCase() : voc.plural.toLowerCase() }))}</p>`);
  if (first) parts.push(`<p class="vl-actions"><a class="vl-btn vl-btn-main" href="${esc(first)}">${esc(ctx.t("playAll"))}</a></p>`);
  parts.push(grid(ctx, snap, vids, cfg, voc, { series: s, numbered: true }));
  return { title: D.seriesName(ctx, s), description: desc ? P.clean(desc, 160) : ctx.t("seriesDescription"), blocks: [html(ctx, parts.join(""))] };
}

// ── Une vidéo ──────────────────────────────────────────────────────────────────────────────────────────────────────

const SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox";

/** Le cadre du lecteur. N'existe que pour une vidéo dont l'adresse du lecteur a pu être fabriquée (identifiant valide). */
function playerFrame(ctx, x) {
  const src = R.embedSrc(x, { autoplay: true });
  return src ? `<iframe src="${esc(src)}" title="${esc(x.title)}" sandbox="${SANDBOX}" allow="autoplay; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>` : "";
}

function shareLinks(ctx, x, url) {
  const e = encodeURIComponent;
  const text = `${x.title} ${url}`;
  const link = (label, href) => `<a class="vl-btn" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
  return `<div class="vl-share" role="group" aria-label="${esc(ctx.t("shareTitle"))}"><span>${esc(ctx.t("shareTitle"))}</span>`
    + `<button class="vl-btn" type="button" hidden data-vl-copy="${esc(url)}" data-done="${esc(ctx.t("shareCopied"))}">${esc(ctx.t("shareCopy"))}</button>`
    + `<a class="vl-btn" href="${esc(`mailto:?subject=${e(x.title)}&body=${e(url)}`)}">${esc(ctx.t("shareMail"))}</a>`
    + link("WhatsApp", `https://wa.me/?text=${e(text)}`)
    + link("Facebook", `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`)
    + link("X", `https://x.com/intent/post?url=${e(url)}&text=${e(x.title)}`)
    + `</div>`;
}

/** Les données structurées VideoObject (même texte que celui de la page). Vide si le cœur ne peut pas les faire. */
function videoMarkup(ctx, x, url, cfg) {
  if (!cfg.structured || typeof ctx.api?.seo?.jsonLd !== "function") return "";
  const p = R.providerOf(x);
  const doc = { "@type": "VideoObject", name: x.title, description: x.desc ? P.clean(x.desc, 500) : x.title, uploadDate: x.date, url };
  const img = imgSrc(ctx, x, cfg);
  if (img) doc.thumbnailUrl = img.startsWith("/") ? `${ctx.api.siteUrl}${img}` : img;
  if (x.dur) doc.duration = P.isoDuration(x.dur);
  const embed = R.embedSrc(x);
  if (embed && p) doc.embedUrl = embed;
  const tag = ctx.api.seo.jsonLd(doc);
  return tag?.jsonLd ? `<script type="application/ld+json">${P.safeJson(tag.jsonLd)}</script>` : "";
}

async function renderVideo(ctx, route, cfg, voc) {
  const snap = await D.snapshot(ctx);
  const x = snap.byN.get(route.n);
  if (!x || !D.isPublic(x)) return { notFound: true };
  const p = R.providerOf(x);
  const series = route.p ? snap.series.find((s) => s.p === route.p && s.status === "published") : null;
  const seriesList = series ? D.seriesVideos(snap, series) : [];
  const inSeries = series && seriesList.some((y) => y.n === x.n) ? series : null;
  const cat = x.cat ? snap.cats.find((c) => c.k === x.cat) : null;
  const here = P.videoPath(ctx, x, inSeries ? { series: inSeries } : {});
  const url = `${ctx.api.siteUrl}${here}`;
  const frame = route.play ? playerFrame(ctx, x) : "";
  const embed = R.embedSrc(x, { autoplay: true });
  const playHref = P.videoPath(ctx, x, { series: inSeries ?? undefined, play: true });
  const parts = [];
  // Fil d'Ariane : retour à la série ou au catalogue
  parts.push(`<p class="vl-crumb"><a href="${esc(inSeries ? P.seriesPath(ctx, inSeries) : P.homeHref(ctx))}">← ${esc(inSeries ? D.seriesName(ctx, inSeries) : voc.plural)}</a></p>`);
  // Le lecteur : sans clic, rien ne part vers la plateforme.
  if (frame) parts.push(`<div class="vl-player">${frame}</div>`);
  else if (embed) {
    parts.push(`<div class="vl-player" data-vl-player data-embed="${esc(embed)}" data-title="${esc(x.title)}"><a class="vl-poster" href="${esc(playHref)}">${imgBox(ctx, x, cfg)}<span class="vl-playlabel">${esc(ctx.t("playHere"))}</span></a></div><p class="vl-note">${esc(ctx.t("playNote", { service: p.label }))}</p>`);
  } else {
    parts.push(`<div class="vl-player"><span class="vl-poster">${imgBox(ctx, x, cfg)}</span></div><p class="vl-note">${esc(ctx.t("noEmbedNote", { service: p.label }))}</p>`);
  }
  const metas = [cat && `<a href="${esc(P.listPath(ctx, { cat: cat.slug }) ?? "/")}">${esc(D.catName(ctx, cat))}</a>`, P.formatDate(x.date, ctx.locale) && `<span>${esc(P.formatDate(x.date, ctx.locale))}</span>`, x.dur && `<span>${esc(P.formatDuration(x.dur))}</span>`, x.free && `<span class="vl-badge">${esc(voc.free)}</span>`].filter(Boolean);
  if (metas.length) parts.push(`<p class="vl-meta" style="margin-top:.9rem">${metas.join("")}</p>`);
  // Regarder chez la plateforme, ou continuer la série
  parts.push(`<div class="vl-actions"><a class="vl-btn${embed ? "" : " vl-btn-main"}" href="${esc(p.watchUrl(x.ext))}" target="_blank" rel="noopener noreferrer">${esc(ctx.t("watchOn", { service: p.label }))}</a></div>`);
  if (inSeries) {
    const i = seriesList.findIndex((y) => y.n === x.n);
    const prev = seriesList[i - 1], next = seriesList[i + 1];
    const link = (y, cls, label, rel) => `<a class="vl-btn ${cls}" rel="${rel}" href="${esc(P.videoPath(ctx, y, { series: inSeries, play: route.play }))}">${esc(label)}</a>`;
    parts.push(`<nav class="vl-series" aria-labelledby="vl-st"><h2 id="vl-st">${esc(D.seriesName(ctx, inSeries))} <span class="vl-meta" style="display:inline">${esc(ctx.t("seriesPos", { i: i + 1, n: seriesList.length }))}</span></h2>`
      + `<div class="vl-pn">${prev ? link(prev, "", ctx.t("prevVideo"), "prev") : ""}${next ? link(next, "vl-btn-main", ctx.t("nextVideo"), "next") : `<span class="vl-meta">${esc(ctx.t("seriesEnd"))}</span>`}</div>`
      + `<ol class="vl-list">${seriesList.map((y, k) => `<li><a href="${esc(P.videoPath(ctx, y, { series: inSeries, play: route.play }))}"${y.n === x.n ? ' aria-current="page"' : ""}><span class="vl-i">${k + 1}</span><span>${esc(y.title)}</span></a></li>`).join("")}</ol></nav>`);
  } else {
    const parents = snap.series.filter((s) => s.status === "published" && s.items.includes(x.n) && D.seriesVideos(snap, s).some((y) => y.n === x.n)).slice(0, 3);
    if (parents.length) parts.push(`<p class="vl-meta">${esc(ctx.t("partOf"))} ${parents.map((s) => `<a href="${esc(P.videoPath(ctx, x, { series: s }))}">${esc(D.seriesName(ctx, s))}</a>`).join(" · ")}</p>`);
  }
  if (x.desc) parts.push(`<div class="vl-body">${P.paragraphs(x.desc)}</div>`);
  const transcript = await D.getText(ctx, x.n).catch(() => "");
  if (transcript) parts.push(`<details class="vl-det"><summary>${esc(ctx.t("transcript"))}</summary><div class="vl-body">${P.paragraphs(transcript)}</div></details>`);
  if (x.album) {
    const album = await A.info(ctx, x.album);
    if (album.state === "ok") parts.push(`<p class="vl-actions"><a class="vl-btn" href="${esc(album.album.url)}">${esc(ctx.t("albumLink", { title: album.album.title }))}</a></p>`);
  }
  if (cfg.share) parts.push(shareLinks(ctx, x, url));
  parts.push(videoMarkup(ctx, x, url, cfg));
  return { title: x.title, description: x.desc ? P.clean(x.desc, 160) : ctx.t("videoDescription"), blocks: [html(ctx, parts.join(""))], scripts: ["videos.js"] };
}

// ── La page ────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function render(ctx, segments) {
  const route = parseRoute(segments);
  if (!route) return { notFound: true };
  const cfg = D.settings(ctx), voc = D.vocab(ctx);
  if (P.base(ctx) === null) return { notFound: true };
  if (route.kind === "list") return renderList(ctx, route, cfg, voc);
  if (route.kind === "video") return renderVideo(ctx, route, cfg, voc);
  if (route.kind === "series") return renderSeries(ctx, route, cfg, voc);
  return renderSeriesIndex(ctx, cfg, voc);
}

/** Le morceau d'accueil : les dernières vidéos publiées. */
export async function latest(ctx, options) {
  const cfg = D.settings(ctx), voc = D.vocab(ctx);
  if (P.base(ctx) === null) return null;
  const count = P.int(options?.count, 3, 1, 12);
  const snap = await D.snapshot(ctx);
  const found = D.findPublic(snap, { limit: count });
  if (!found.items.length) return null;
  const inner = `<section aria-labelledby="vl-h"><h2 class="vl-sec-t" id="vl-h" style="font-size:1.3rem;font-weight:800;margin:0 0 .75rem">${esc(ctx.instance.name || voc.plural)}</h2>${grid(ctx, snap, found.items, cfg, voc)}<p class="vl-more"><a class="vl-btn" href="${esc(P.homeHref(ctx))}">${esc(ctx.t("seeAll"))}</a></p></section>`;
  return [html(ctx, inner)];
}
