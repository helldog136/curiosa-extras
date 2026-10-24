// Galeries photos : ce que voit le visiteur (liste des albums, album, photo, demande de retrait, outil d'envoi de l'équipe), en HTML simple.
// Tout marche SANS JavaScript : chaque miniature est un vrai lien vers une page de photo, avec « précédente / suivante ».
// Le script (scripts/gallery.js) ajoute le confort : visionneuse plein écran (clavier, balayage, compteur, légende), lien copié, demande envoyée sans recharger.

const { flag, loadAlbums, loadMeta, loadPhotos, hasImage, limitsOf, showDates, sortMode } = await import(new URL(`./data.mjs${new URL(import.meta.url).search}`, import.meta.url).href);
const { clean, cleanUpload, dayLabel, esc, hostOf, plainText, renderText, safeJson } = await import(new URL(`./text.mjs${new URL(import.meta.url).search}`, import.meta.url).href);

export const PAGE_SIZE = 12;

// ── Adresses ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Adresse de la page de l'instance (null si elle n'est pas montée sur un chemin). Préfixe la langue si ce n'est pas la langue par défaut. */
export function pageHref(ctx, localized = true) {
  const base = ctx.instance.basePath;
  if (base === null || base === undefined) return null;
  const prefix = localized && ctx.locale !== ctx.defaultLocale ? `/${ctx.locale}` : "";
  return `${prefix}${base ? `/${base}` : ""}` || "/";
}

const join = (root, ...parts) => `${root === "/" ? "" : root}/${parts.join("/")}`;
export const albumHref = (ctx, a, localized = true) => { const r = pageHref(ctx, localized); return r === null ? null : join(r, a.slug); };
export const photoHref = (ctx, a, p, localized = true) => { const r = pageHref(ctx, localized); return r === null ? null : join(r, a.slug, p.id); };
export const removalHref = (ctx, a, p) => { const r = pageHref(ctx); return r === null ? null : a ? join(r, "retrait", a.slug, ...(p ? [p.id] : [])) : join(r, "retrait"); };
export const previewHref = (ctx, a) => { const r = pageHref(ctx, false); return r === null || !a.preview ? null : join(r, "apercu", a.id, a.preview); };
export const studioHref = (ctx, a) => { const r = pageHref(ctx, false); return r === null ? null : join(r, "studio", a.id); };

/** L'adresse d'une image : envoyée par le cœur (version propre, sans informations cachées, fabriquée et gardée par le cœur) ou gardée chez un site autorisé. */
export function imgSrc(ctx, p, kind) {
  if (p.full) return esc(cleanUpload(kind === "thumb" ? p.thumb || p.full : p.full));
  return esc((kind === "thumb" && p.turl) || p.url);
}
const isExternal = (p) => !p.full && !!p.url;
/** Une image qui vient d'un autre site ne doit pas dire d'où l'on vient. */
const refAttr = (p) => (isExternal(p) ? ' referrerpolicy="no-referrer"' : "");

export function altOf(ctx, a, p, n) {
  return p.alt || p.caption || ctx.t("altFallback", { album: a.title, n });
}

const countLabel = (ctx, n) => (n <= 0 ? ctx.t("countNone") : n === 1 ? ctx.t("countOne") : ctx.t("countMany", { n }));

// ── Réglages de vocabulaire ──────────────────────────────────────────────────────────────────────────────────────────

/** Les mots du public : le réglage de l'instance, sinon le texte du gabarit choisi, sinon un texte neutre. */
export function words(ctx, meta) {
  const tpl = meta?.template || "empty";
  const own = (key) => clean(ctx.setting(key), 300);
  return {
    title: own("title") || ctx.t(`tpl_${tpl}_title`),
    intro: clean(ctx.setting("intro"), 1500, true) || ctx.t(`tpl_${tpl}_intro`),
    back: own("backLabel") || ctx.t(`tpl_${tpl}_back`),
    removal: own("removalLabel") || ctx.t("removalLink"),
    consent: clean(ctx.setting("consent"), 600, true) || ctx.t("consentDefault"),
  };
}

// ── Style ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const CSS = `
.gal{color:var(--v-fg)}
.gal *,.gal *::before,.gal *::after{box-sizing:border-box}
.gal [hidden]{display:none!important}
.gal a{color:var(--v-fg);text-decoration-color:var(--v-accent);text-decoration-thickness:2px;text-underline-offset:3px}
.gal a:focus-visible,.gal button:focus-visible,.gal input:focus-visible,.gal textarea:focus-visible,.gal select:focus-visible{outline:3px solid var(--v-accent);outline-offset:2px}
.gal-intro{max-width:46rem;margin:0 0 1.25rem;color:var(--v-muted)}
.gal-intro p{margin:0 0 .5rem}
.gal-crumb{margin:0 0 1rem}
.gal-crumb a{display:inline-flex;align-items:center;min-height:44px}
.gal-meta{margin:0 0 .75rem;color:var(--v-muted)}
.gal-desc{max-width:46rem;margin:0 0 1rem;line-height:1.6;overflow-wrap:anywhere}
.gal-desc p{margin:0 0 .75rem}
.gal-consent{max-width:46rem;margin:0 0 1.25rem;padding:.85rem 1rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface);font-size:.95rem}
.gal-consent p{margin:0}
.gal-consent a{display:inline-flex;align-items:center;min-height:44px;font-weight:600}
.gal-preview{margin:0 0 1rem;padding:.75rem 1rem;border-radius:12px;background:var(--v-warning);color:var(--v-warning-fg);font-weight:600}
.gal-cards,.gal-grid{display:grid;margin:0 0 1.5rem;padding:0;list-style:none;gap:.75rem}
.gal-cards{grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr));gap:1rem}
.gal-grid{grid-template-columns:repeat(auto-fill,minmax(min(46%,9.5rem),1fr))}
@media (min-width:700px){.gal-grid{grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))}}
.gal-card{margin:0}
.gal-card>a{display:flex;flex-direction:column;height:100%;overflow:hidden;border:1px solid var(--v-line);border-radius:14px;background:var(--v-surface);color:var(--v-fg);text-decoration:none}
.gal-card>a:hover{border-color:var(--v-accent)}
.gal-cover{display:block;aspect-ratio:4/3;overflow:hidden;background:var(--v-line)}
.gal-cover img{display:block;width:100%;height:100%;object-fit:cover}
.gal-nocover{display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:var(--v-muted);font-size:2rem}
.gal-card-body{display:flex;flex-direction:column;gap:.25rem;padding:.75rem 1rem 1rem}
.gal-card-title{margin:0;font-size:1.1rem;font-weight:600;line-height:1.3;overflow-wrap:anywhere}
.gal-sub{color:var(--v-muted);font-size:.9rem}
.gal-out{font-size:.9rem;font-weight:600}
.gal-tile{display:block;aspect-ratio:1;overflow:hidden;border:1px solid var(--v-line);border-radius:10px;background:var(--v-line)}
.gal-tile:hover{border-color:var(--v-accent)}
.gal-tile img{display:block;width:100%;height:100%;object-fit:cover}
.gal-more{margin:0 0 1.5rem;padding:1rem;border:1px dashed var(--v-line);border-radius:12px}
.gal-more a{display:inline-flex;align-items:center;min-height:44px;font-weight:600}
.gal-more p{margin:.25rem 0 0;color:var(--v-muted);font-size:.9rem}
.gal-btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:44px;padding:0 1.1rem;border:1px solid var(--v-line);border-radius:999px;background:var(--v-bg);color:var(--v-fg);font:inherit;text-decoration:none;cursor:pointer}
.gal-btn:hover{border-color:var(--v-accent)}
.gal-btn:disabled{opacity:.6;cursor:default}
.gal-btn-main{border-color:transparent;background:var(--v-accent);color:var(--v-accent-fg);font-weight:600}
.gal-pager{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1rem;margin:0 0 1.5rem}
.gal-pager .gal-btn[aria-disabled=true]{opacity:.5;pointer-events:none}
.gal-empty{padding:1rem;border:1px dashed var(--v-line);border-radius:12px;color:var(--v-muted)}
.gal-photo{max-width:60rem}
.gal-stage{margin:0 0 1rem}
.gal-stage img{display:block;width:auto;max-width:100%;max-height:80vh;margin:0 auto;border-radius:10px;background:var(--v-line)}
.gal-stage figcaption{margin:.75rem auto 0;max-width:46rem;text-align:center;overflow-wrap:anywhere}
.gal-pn{display:flex;flex-wrap:wrap;gap:.75rem;margin:0 0 1rem}
.gal-pn .gal-btn{min-width:8.5rem}
.gal-tools{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1rem;margin:0 0 1rem}
.gal-status{min-height:1.5em;margin:.5rem 0 0;color:var(--v-muted)}
.gal-form{max-width:36rem}
.gal-form label{display:block;margin:0 0 .35rem;font-weight:600}
.gal-form input[type=text],.gal-form textarea{display:block;width:100%;min-height:44px;margin:0 0 1rem;padding:.6rem .9rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface);color:var(--v-fg);font:inherit}
.gal-form textarea{min-height:8rem;resize:vertical}
.gal-hint{margin:-.5rem 0 1rem;color:var(--v-muted);font-size:.9rem}
.gal-picked{display:flex;align-items:center;gap:.75rem;margin:0 0 1rem;padding:.5rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface)}
.gal-picked img{display:block;width:4.5rem;height:4.5rem;object-fit:cover;border-radius:8px}
.gal-trap{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.gal-viewer{position:fixed;inset:0;width:100%;max-width:none;height:100%;max-height:none;margin:0;padding:0;border:0;background:var(--v-bg);color:var(--v-fg)}
.gal-viewer::backdrop{background:var(--v-bg)}
.gal-viewer[open]{display:flex;flex-direction:column}
.gal-v-bar{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;padding:.5rem .75rem;border-bottom:1px solid var(--v-line)}
.gal-v-count{flex:1 1 auto;font-weight:600}
.gal-v-stage{position:relative;display:flex;flex:1 1 auto;align-items:center;justify-content:center;min-height:0;padding:.5rem 3.75rem;touch-action:pan-y pinch-zoom}
.gal-v-fig{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;min-height:0;margin:0}
.gal-v-img{display:block;max-width:100%;min-height:0;flex:1 1 0;object-fit:contain}
.gal-v-cap{flex:none;max-height:5.5rem;margin:.5rem 0 0;overflow:auto;text-align:center;overflow-wrap:anywhere}
.gal-v-nav{position:absolute;top:50%;z-index:2;display:flex;align-items:center;justify-content:center;width:3.5rem;height:3.5rem;margin-top:-1.75rem;padding:0;border:3px solid var(--v-fg);border-radius:50%;background:var(--v-bg);color:var(--v-fg);font-size:1.75rem;line-height:1;cursor:pointer;box-shadow:0 0 0 2px var(--v-bg)}
.gal-v-nav:hover{border-color:var(--v-accent)}
.gal-v-nav[disabled]{opacity:.35;cursor:default}
.gal-v-prev{left:.4rem}
.gal-v-next{right:.4rem}
.gal-v-foot{display:flex;flex-wrap:wrap;align-items:center;gap:.25rem 1rem;padding:.25rem .75rem .75rem}
.gal-v-foot .gal-status{margin:0}
.gal-v-loading .gal-v-img{opacity:.4}
body:has(.gal-viewer[open]){overflow:hidden}
@media (max-width:600px){.gal-v-stage{padding:.25rem 0}.gal-v-nav{top:auto;bottom:.75rem;margin-top:0;width:3.75rem;height:3.75rem;background:var(--v-surface)}.gal-v-prev{left:.75rem}.gal-v-next{right:.75rem}.gal-v-fig{padding-bottom:4.75rem}}
@media (prefers-reduced-motion:no-preference){.gal-v-img{transition:opacity .15s}.gal-tile img,.gal-cover img{transition:opacity .2s}}
.gal-studio{max-width:44rem}
.gal-studio ul{margin:0;padding:0;list-style:none}
.gal-sfile{margin:0 0 .75rem;padding:.75rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface)}
.gal-sfile-head{display:flex;align-items:center;gap:.75rem}
.gal-sfile img{flex:none;width:4rem;height:4rem;object-fit:cover;border-radius:8px;background:var(--v-line)}
.gal-sname{flex:1 1 auto;min-width:0;font-weight:600;overflow-wrap:anywhere}
.gal-sfile progress{display:block;width:100%;height:.6rem;margin:.5rem 0 0}
.gal-sfile label{display:block;margin:.5rem 0 .25rem;font-weight:600;font-size:.95rem}
.gal-sfile input[type=text]{display:block;width:100%;min-height:44px;padding:.5rem .75rem;border:1px solid var(--v-line);border-radius:10px;background:var(--v-bg);color:var(--v-fg);font:inherit}
.gal-sstate{margin:.5rem 0 0;font-size:.95rem}
.gal-serror{margin:.5rem 0 0;font-weight:600;color:var(--v-danger)}
.gal-sok{color:var(--v-success)}
.gal-sfile .gal-hint{margin:.25rem 0 0}
`.replace(/\n/g, "");

/** Les textes que le script affiche sans recharger la page, posés en attributs (le script n'a aucun texte en dur). */
function attrs(ctx) {
  const t = (k, v) => esc(ctx.t(k, v));
  return `data-gal data-t-close="${t("closeViewer")}" data-t-prev="${t("prevPhoto")}" data-t-next="${t("nextPhoto")}" data-t-of="${t("photoOf")}" data-t-copy="${t("copyLink")}" data-t-copied="${t("linkCopied")}"`
    + ` data-t-share="${t("share")}" data-t-removal="${esc(clean(ctx.setting("removalLabel"), 300) || ctx.t("removalLink"))}" data-t-viewer="${t("viewerLabel")}" data-t-error="${t("imageError")}" data-t-loading="${t("imageLoading")}"`
    + ` data-t-sent="${t("removalSent")}" data-t-limit="${t("removalLimit")}" data-t-invalid="${t("removalInvalid")}" data-t-full="${t("removalFull")}" data-t-fail="${t("removalError")}"`;
}

const wrap = (ctx, inner, cls = "") => `<style>${CSS}</style><div class="gal${cls ? ` ${cls}` : ""}" ${attrs(ctx)}>${inner}</div>`;

// ── Les albums ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Les albums à montrer au public : publiés, avec au moins une photo visible (ou un lien vers un album d'un autre service). */
export async function publicAlbums(ctx, meta) {
  const all = await loadAlbums(ctx, sortMode(ctx, meta));
  return all.filter((a) => a.status === "published" && (a.mode === "external" ? !!a.link : true));
}

function coverImg(ctx, a) {
  const c = a.coverThumb;
  if (c.src) return `<img src="${esc(cleanUpload(c.src))}" alt="" loading="lazy" decoding="async" width="400" height="300">`;
  if (c.url) return `<img src="${esc(c.url)}" alt="" loading="lazy" decoding="async" width="400" height="300" referrerpolicy="no-referrer">`;
  return `<span class="gal-nocover" aria-hidden="true">▣</span>`;
}

function cardHtml(ctx, a, dates) {
  const when = dates ? dayLabel(a.date, ctx.locale) : "";
  const external = a.mode === "external" && a.link;
  const host = external ? hostOf(a.link) : "";
  const sub = [when, a.mode === "external" ? "" : countLabel(ctx, a.shown)].filter(Boolean).join(" · ");
  const out = external ? `<span class="gal-out">↗ ${esc(ctx.t("externalOut", { host }))}</span>` : "";
  const href = external ? esc(a.link) : esc(albumHref(ctx, a) ?? "#");
  const ext = external ? ` target="_blank" rel="noopener noreferrer"` : "";
  return `<li class="gal-card"><a href="${href}"${ext}><span class="gal-cover">${coverImg(ctx, a)}</span><span class="gal-card-body"><h2 class="gal-card-title">${esc(a.title)}</h2>${sub ? `<span class="gal-sub">${esc(sub)}</span>` : ""}${out}</span></a></li>`;
}

/** La page des albums (page n, 12 par page). */
export async function renderList(ctx, pageNo) {
  const meta = await loadMeta(ctx);
  const albums = await publicAlbums(ctx, meta);
  const w = words(ctx, meta);
  const pages = Math.max(1, Math.ceil(albums.length / PAGE_SIZE));
  if (pageNo < 1 || pageNo > pages) return null;
  const dates = showDates(ctx, meta);
  const part = albums.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE);
  const root = pageHref(ctx) ?? "/";
  const parts = [];
  if (w.intro) parts.push(`<div class="gal-intro">${renderText(w.intro)}</div>`);
  if (!part.length) parts.push(`<p class="gal-empty">${esc(ctx.t("listEmpty"))}</p>`);
  else parts.push(`<ul class="gal-cards">${part.map((a) => cardHtml(ctx, a, dates)).join("")}</ul>`);
  if (pages > 1) {
    const at = (n) => (n <= 1 ? root : join(root, "page", n));
    parts.push(
      `<nav class="gal-pager" aria-label="${esc(ctx.t("pagination"))}">`
      + `<a class="gal-btn" rel="prev" href="${esc(at(pageNo - 1))}"${pageNo <= 1 ? ' aria-disabled="true" tabindex="-1"' : ""}>${esc(ctx.t("prevPage"))}</a>`
      + `<span>${esc(ctx.t("pageOf", { n: pageNo, total: pages }))}</span>`
      + `<a class="gal-btn" rel="next" href="${esc(at(pageNo + 1))}"${pageNo >= pages ? ' aria-disabled="true" tabindex="-1"' : ""}>${esc(ctx.t("nextPage"))}</a></nav>`,
    );
  }
  if (flag(ctx, "people", true) && flag(ctx, "removal", true) && albums.some((a) => a.mode !== "external")) parts.push(consentHtml(ctx, w, null, null));
  return { title: w.title, description: plainText(w.intro, 160) || ctx.t("pageDescription"), html: wrap(ctx, parts.join("")), pages, meta };
}

function consentHtml(ctx, w, a, p) {
  const href = removalHref(ctx, a, p);
  const link = flag(ctx, "removal", true) && href ? ` <a href="${esc(href)}">${esc(w.removal)}</a>` : "";
  return `<aside class="gal-consent" aria-label="${esc(ctx.t("consentLabel"))}"><p>${esc(w.consent)}${link}</p></aside>`;
}

/** Les photos montrables d'un album, numérotées. */
export async function visiblePhotos(ctx, a) {
  const all = await loadPhotos(ctx, a);
  return all.filter((p) => !p.hidden && hasImage(p));
}

/** Données ImageGallery (facultatives) : balise sûre, ou texte vide. */
function galleryMarkup(ctx, a, items) {
  if (!flag(ctx, "markup", false) || a.status !== "published") return "";
  const site = ctx.api.siteUrl;
  const abs = (p, kind) => (p.full ? `${site}${cleanUpload(kind === "thumb" ? p.thumb || p.full : p.full)}` : (kind === "thumb" && p.turl) || p.url);
  const images = items.slice(0, 50).map((p, i) => ({ "@type": "ImageObject", contentUrl: abs(p, "full"), thumbnailUrl: abs(p, "thumb"), name: plainText(p.caption || altOf(ctx, a, p, i + 1), 150), ...(p.alt ? { description: plainText(p.alt, 300) } : {}) }));
  const doc = { "@type": "ImageGallery", name: a.title, ...(a.desc ? { description: plainText(a.desc, 300) } : {}), ...(a.date ? { dateCreated: a.date } : {}), url: `${site}${albumHref(ctx, a, false) ?? ""}`, image: images };
  const tag = ctx.api?.seo?.jsonLd ? ctx.api.seo.jsonLd(doc) : null;
  return tag?.jsonLd ? `<script type="application/ld+json">${safeJson(tag.jsonLd)}</script>` : "";
}

/** La page d'un album. `preview` : aperçu d'un album non publié (la clé d'aperçu a été vérifiée par l'appelant). */
export async function renderAlbum(ctx, a, { preview = false } = {}) {
  const meta = await loadMeta(ctx);
  const w = words(ctx, meta);
  const dates = showDates(ctx, meta);
  const parts = [];
  const root = pageHref(ctx) ?? "/";
  if (preview) parts.push(`<p class="gal-preview" role="status">${esc(ctx.t("previewBanner"))}</p>`);
  parts.push(`<p class="gal-crumb"><a href="${esc(root)}">← ${esc(w.back)}</a></p>`);
  const when = dates ? dayLabel(a.date, ctx.locale) : "";
  let items = [];
  if (a.mode === "hosted") items = await visiblePhotos(ctx, a);
  const meta2 = [when, a.mode === "hosted" ? countLabel(ctx, items.length) : ""].filter(Boolean).join(" · ");
  if (meta2) parts.push(`<p class="gal-meta">${esc(meta2)}</p>`);
  if (a.desc) parts.push(`<div class="gal-desc">${renderText(a.desc)}</div>`);
  const people = flag(ctx, "people", true);

  if (a.mode === "external") {
    const host = hostOf(a.link);
    const first = (await visiblePhotos(ctx, a))[0];
    if (first) parts.push(`<p class="gal-stage"><img src="${imgSrc(ctx, first, "full")}" alt="${esc(altOf(ctx, a, first, 1))}"${refAttr(first)}></p>`);
    if (a.link) {
      parts.push(`<p class="gal-tools"><a class="gal-btn gal-btn-main" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${esc(ctx.t("externalOpen", { host }))} ↗</a></p><p class="gal-hint">${esc(ctx.t("externalOut", { host }))}</p>`);
    }
  } else {
    if (people && items.length) parts.push(consentHtml(ctx, w, a, null));
    if (!items.length) parts.push(`<p class="gal-empty">${esc(ctx.t("albumEmpty"))}</p>`);
    else {
      parts.push(`<ul class="gal-grid" data-gal-grid>${items.map((p, i) => {
        const href = photoHref(ctx, a, p) ?? "#";
        const rm = flag(ctx, "removal", true) && people ? removalHref(ctx, a, p) : null;
        return `<li><a class="gal-tile" href="${esc(href)}" data-gal-photo data-n="${i + 1}" data-full="${imgSrc(ctx, p, "full")}" data-caption="${esc(p.caption)}" data-alt="${esc(altOf(ctx, a, p, i + 1))}"${rm ? ` data-removal="${esc(rm)}"` : ""}>`
          + `<img src="${imgSrc(ctx, p, "thumb")}" alt="${esc(altOf(ctx, a, p, i + 1))}" loading="lazy" decoding="async" width="${p.w && p.h ? Math.round((p.w / Math.max(p.w, p.h)) * 480) : 480}" height="${p.w && p.h ? Math.round((p.h / Math.max(p.w, p.h)) * 480) : 480}"${refAttr(p)}></a></li>`;
      }).join("")}</ul>`);
    }
    if (a.link) {
      const host = hostOf(a.link);
      parts.push(`<div class="gal-more"><a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${esc(ctx.t("moreElsewhere", { host }))} ↗</a><p>${esc(ctx.t("externalOut", { host }))}</p></div>`);
    }
  }
  const markup = galleryMarkup(ctx, a, items);
  return { title: a.title, description: plainText(a.desc, 160) || ctx.t("albumDescription", { title: a.title }), html: wrap(ctx, parts.join(""), "gal-album") + markup, count: items.length };
}

/** La page d'une photo (adresse à partager). Sans JavaScript : grande image, précédente, suivante, retour. */
export async function renderPhoto(ctx, a, photoId, { preview = false } = {}) {
  const meta = await loadMeta(ctx);
  const w = words(ctx, meta);
  const items = await visiblePhotos(ctx, a);
  const at = items.findIndex((p) => p.id === photoId);
  if (at < 0 || a.mode !== "hosted") return null;
  const p = items[at];
  const prev = items[at - 1];
  const next = items[at + 1];
  const albumUrl = albumHref(ctx, a) ?? "/";
  const nav = (q, label, rel) => (q ? `<a class="gal-btn" rel="${rel}" href="${esc(photoHref(ctx, a, q) ?? "#")}">${esc(label)}</a>` : `<span class="gal-btn" aria-disabled="true" style="opacity:.4">${esc(label)}</span>`);
  const people = flag(ctx, "people", true) && flag(ctx, "removal", true);
  const rm = people ? removalHref(ctx, a, p) : null;
  const parts = [
    preview ? `<p class="gal-preview" role="status">${esc(ctx.t("previewBanner"))}</p>` : "",
    `<p class="gal-crumb"><a href="${esc(albumUrl)}">← ${esc(ctx.t("backToAlbum", { title: a.title }))}</a></p>`,
    `<figure class="gal-stage"><img src="${imgSrc(ctx, p, "full")}" alt="${esc(altOf(ctx, a, p, at + 1))}"${refAttr(p)}${p.w && p.h ? ` width="${p.w}" height="${p.h}"` : ""}>${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}</figure>`,
    `<p class="gal-meta" role="status">${esc(ctx.t("photoOf", { n: at + 1, total: items.length }))}</p>`,
    `<nav class="gal-pn" aria-label="${esc(ctx.t("photoNav"))}">${nav(prev, ctx.t("prevPhoto"), "prev")}${nav(next, ctx.t("nextPhoto"), "next")}</nav>`,
    `<p class="gal-tools"><button type="button" class="gal-btn" data-gal-copy="${esc(photoHref(ctx, a, p, false) ?? "")}">${esc(ctx.t("copyLink"))}</button>${rm ? `<a href="${esc(rm)}">${esc(w.removal)}</a>` : ""}</p><p class="gal-status" role="status" data-gal-copied></p>`,
  ];
  return { title: p.caption || a.title, description: plainText(p.caption || a.desc, 160) || ctx.t("albumDescription", { title: a.title }), html: wrap(ctx, parts.join(""), "gal-photo"), index: at, total: items.length };
}

// ── Demande de retrait ───────────────────────────────────────────────────────────────────────────────────────────────

/** Le formulaire « Demander le retrait d'une photo ». `target` : { album, photo } si la photo est déjà connue. */
export async function renderRemoval(ctx, target) {
  const meta = await loadMeta(ctx);
  const w = words(ctx, meta);
  const key = esc(ctx.instance.key);
  const parts = [`<p class="gal-crumb"><a href="${esc(pageHref(ctx) ?? "/")}">← ${esc(w.back)}</a></p>`, `<p class="gal-desc">${esc(ctx.t("removalIntro"))}</p>`];
  let hidden = "";
  if (target) {
    const items = await visiblePhotos(ctx, target.album);
    const at = items.findIndex((p) => p.id === target.photo.id);
    hidden = `<input type="hidden" name="album" value="${esc(target.album.id)}"><input type="hidden" name="photo" value="${esc(target.photo.id)}">`;
    parts.push(`<div class="gal-picked"><img src="${imgSrc(ctx, target.photo, "thumb")}" alt="" ${refAttr(target.photo)}><p>${esc(ctx.t("removalPicked", { album: target.album.title, n: at + 1 }))}</p></div>`);
  }
  const which = target ? "" : `<label for="gal-which-${key}">${esc(ctx.t("removalWhich"))}</label><input id="gal-which-${key}" type="text" name="which" maxlength="160" autocomplete="off" required><p class="gal-hint">${esc(ctx.t("removalWhichHint"))}</p>`;
  parts.push(
    `<form class="gal-form" method="post" action="/m/${key}/removal?lang=${esc(ctx.locale)}" data-gal-removal>${hidden}${which}`
    + `<label for="gal-msg-${key}">${esc(ctx.t("removalMessage"))}</label><textarea id="gal-msg-${key}" name="message" required minlength="5" maxlength="1000" rows="5"></textarea><p class="gal-hint">${esc(ctx.t("removalMessageHint"))}</p>`
    + `<label for="gal-contact-${key}">${esc(ctx.t("removalContact"))}</label><input id="gal-contact-${key}" type="text" name="contact" maxlength="120" autocomplete="email" inputmode="email"><p class="gal-hint">${esc(ctx.t("removalContactHint"))}</p>`
    + `<div class="gal-trap" aria-hidden="true"><label>${esc(ctx.t("trapLabel"))} <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>`
    + `<button class="gal-btn gal-btn-main" type="submit">${esc(ctx.t("removalSubmit"))}</button><p class="gal-status" role="status" data-gal-removal-result></p></form>`,
  );
  return { title: ctx.t("removalTitle"), description: ctx.t("removalIntro"), html: wrap(ctx, parts.join("")) };
}

export function renderRemovalDone(ctx, ok) {
  const root = pageHref(ctx) ?? "/";
  const html = `<p class="gal-desc" role="status">${esc(ctx.t(ok ? "removalThanksText" : "removalFailText"))}</p><p><a class="gal-btn" href="${esc(root)}">← ${esc(ctx.t("backToStart"))}</a></p>`;
  return { title: ctx.t(ok ? "removalThanksTitle" : "removalFailTitle"), description: "", html: wrap(ctx, html) };
}

// ── L'outil d'envoi de l'équipe ──────────────────────────────────────────────────────────────────────────────────────

/** La coquille de l'outil d'envoi : elle ne montre rien de privé (le titre de l'album et les bornes sont demandés au cœur, connecté). */
export function renderStudio(ctx, albumId) {
  const limits = limitsOf(ctx);
  const t = (k, v) => ctx.t(k, v);
  const texts = Object.fromEntries([
    "studioLoading", "studioLogin", "studioLoginLink", "studioNoAlbum", "studioReady", "studioPreparing", "studioSending", "studioSaving", "studioDone", "studioRetry", "studioRemove", "studioCaption", "studioAlt", "studioAltHelp",
    "studioErrType", "studioErrDecode", "studioErrSize", "studioErrFull", "studioErrNetwork", "studioErrDenied", "studioErrOther", "studioSend", "studioSendOne", "studioSummary", "studioAllDone", "studioWaiting", "studioPickMore", "studioHeic", "studioGif",
    "studioProgress", "studioOpenAlbum", "studioCapacity", "studioTooMany",
  ].map((k) => [k, t(k)]));
  const data = { endpoint: "/api/admin/modules/", upload: "/api/admin/upload", instance: ctx.instance.id, album: albumId, texts };
  const html = `<div class="gal-studio" data-gal-studio data-config="${esc(JSON.stringify(data))}">`
    + `<p class="gal-desc">${esc(t("studioIntro", { kb: Math.round(limits.photoBytes / 1000) }))}</p>`
    + `<noscript><p class="gal-empty">${esc(t("studioNoScript"))}</p></noscript>`
    + `<p class="gal-status" role="status" data-studio-info>${esc(t("studioLoading"))}</p>`
    + `<div data-studio-body hidden><p><label class="gal-btn gal-btn-main" for="gal-studio-file">${esc(t("studioPick"))}</label><input id="gal-studio-file" class="gal-trap" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic" data-studio-input></p>`
    + `<p class="gal-hint">${esc(t("studioPickHelp"))}</p><ul data-studio-list></ul>`
    + `<p class="gal-tools"><button type="button" class="gal-btn gal-btn-main" data-studio-send disabled>${esc(t("studioSend", { n: 0 }))}</button><a class="gal-btn" data-studio-back href="/admin" hidden>${esc(t("studioOpenAlbum"))}</a></p>`
    + `<p class="gal-status" role="status" data-studio-summary></p></div></div>`;
  return { title: t("studioTitle"), description: "", html: `<style>${CSS}</style><div class="gal">${html}</div>` };
}

// ── Accueil ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Les derniers albums, en cartes. */
export async function renderLatest(ctx, count) {
  const meta = await loadMeta(ctx);
  const albums = (await publicAlbums(ctx, meta)).slice(0, count);
  if (!albums.length) return null;
  const href = pageHref(ctx);
  const dates = showDates(ctx, meta);
  const w = words(ctx, meta);
  const blocks = [{ type: "heading", text: w.title }, { type: "html", html: wrap(ctx, `<ul class="gal-cards">${albums.map((a) => cardHtml(ctx, a, dates)).join("")}</ul>`) }];
  if (href) blocks.push({ type: "links", items: [{ label: w.back, href }] });
  return blocks;
}
