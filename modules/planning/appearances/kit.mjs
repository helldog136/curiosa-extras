// Planning : petits outils PURS partagés par les apparences (échappement, balises répétées, feuille de style de base).
// Rien ici ne touche au réseau ni au stockage ; aucune couleur codée en dur : tout passe par les variables du thème (--v-*).

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Adresse https sans espace ni guillemet, sinon null (jamais injectée dans un attribut). */
export const safeHttps = (v) => { const u = String(v ?? "").trim(); return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null; };

/** Écrit une feuille de style lisible puis la tasse sur une ligne (commentaires retirés). */
export const minify = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").replace(/\s*([{};,])\s*/g, "$1").trim();

/** <time> d'un créneau : l'attribut datetime est toujours renseigné. */
export const timeTag = (slot, text, cls = "") => `<time${cls ? ` class="${cls}"` : ""} datetime="${esc(slot.iso)}">${esc(text)}</time>`;

/** Texte réservé aux lecteurs d'écran. */
export const srOnly = (text) => `<span class="pa-sr">${esc(text)}</span>`;

/** Pastille d'état : toujours un texte (et un symbole), jamais la seule couleur. kind : live · cancelled · rel · plain. */
export function chip(kind, text) {
  if (!text) return "";
  const sym = kind === "live" ? `<span class="pa-dot" aria-hidden="true"></span>` : kind === "cancelled" ? `<span class="pa-x" aria-hidden="true">×</span>` : "";
  return `<span class="pa-chip pa-chip-${kind}">${sym}${esc(text)}</span>`;
}

/** Les pastilles d'un créneau : « Annulé » (prioritaire), « En cours » ou l'indication relative. */
export function statusChips(slot, t) {
  if (slot.cancelled) return chip("cancelled", t("cancelled"));
  if (slot.live) return chip("live", t("relLive"));
  return slot.rel ? chip("rel", slot.rel) : "";
}

/** Jaquettes d'un créneau (empilées en éventail). `size` : classe de taille facultative. */
export function coversHtml(slot, t, cls = "") {
  if (!slot.covers.length) return "";
  return `<span class="pa-covers${cls ? ` ${cls}` : ""}">${slot.covers.map((c) => `<img src="${esc(c.url)}" alt="${esc(t("coverAlt", { game: c.name }))}" loading="lazy" decoding="async" width="120" height="160">`).join("")}</span>`;
}

/** Visuel de repli d'un stream sans jeu : logo du site (ou initiale) sur le mauve Twitch, mêmes proportions qu'une jaquette. Décoratif. */
export function placeholderHtml(vis, cls = "") {
  const inner = vis?.src
    ? (vis.light ? `<img src="${esc(vis.src)}" alt="" loading="lazy" decoding="async" width="120" height="120">` : `<span class="pa-ph-disc"><img src="${esc(vis.src)}" alt="" loading="lazy" decoding="async" width="120" height="120"></span>`)
    : `<span>${esc(vis?.initial ?? "▶")}</span>`;
  return `<span class="pa-ph${cls ? ` ${cls}` : ""}" aria-hidden="true">${inner}</span>`;
}

/** Jaquettes, ou le visuel de repli quand `fallback` est donné et que le créneau n'a pas de jeu illustré. Vide si les jaquettes sont désactivées. */
export function artHtml(slot, model, { fallback = false, cls = "" } = {}) {
  if (!model.opts.covers) return "";
  if (slot.covers.length) return coversHtml(slot, model.t, cls);
  return fallback && model.vis ? placeholderHtml(model.vis, cls) : "";
}

/** Noms des jeux (texte), avec une étiquette lisible par les lecteurs d'écran. */
export function gamesHtml(slot, t, cls = "pa-games") {
  return (slot.games.length ? `<p class="${cls}">${srOnly(t("gamesLabel"))} ${slot.games.map(esc).join(", ")}</p>` : "") + sourceHtml(slot);
}

/**
 * Pastille de la source du créneau (calendrier d'origine) : petit rond de SA couleur + son nom. Vide si le réglage « Montrer la source » est
 * désactivé (le créneau n'a alors pas de `source`) ou si la source n'a ni nom ni couleur. Styles en ligne : identique dans toutes les apparences.
 * La couleur n'est jamais seule : le nom est du texte ; le rond est décoratif.
 */
export function sourceHtml(slot) {
  const src = slot.source;
  if (!src || (!src.label && !src.color)) return "";
  const color = /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(String(src.color ?? "")) ? src.color : null;
  const dot = `<i aria-hidden="true" style="display:inline-block;flex:none;width:.65em;height:.65em;border-radius:50%;background:${color ?? "var(--pa-muted,currentColor)"}"></i>`;
  return `<p class="pa-src" style="display:flex;align-items:center;gap:.4em;margin:.2rem 0 0;font-size:.8em;opacity:.85">${dot}${src.label ? `<span>${esc(src.label)}</span>` : ""}</p>`;
}

/** En-tête d'un jour dans l'un des trois styles : text · tile · short. */
export function dayLabel(day, style) {
  const l = day.label;
  if (style === "tile") return `<span class="pa-dh pa-dh-tile"><span class="pa-dh-wd">${esc(l.weekdayShort)}</span><span class="pa-dh-n">${esc(l.dayNum)}</span><span class="pa-dh-m">${esc(l.monthShort)}</span></span>`;
  if (style === "short") return `<span class="pa-dh pa-dh-short"><span class="pa-dh-wd">${esc(l.weekdayShort)}</span> <span class="pa-dh-d">${esc(l.dayNum)} ${esc(l.monthShort)}</span></span>`;
  return `<span class="pa-dh pa-dh-text"><span class="pa-dh-wd">${esc(l.weekdayLong)}</span> <span class="pa-dh-d">${esc(l.dayNum)} ${esc(l.monthLong)}</span></span>`;
}

/** Heure d'un créneau : « 21:30 » ou « 21:30 – 23:30 » ; « Toute la journée » pour un événement sans heure. */
export const whenText = (slot, showEnd) => (showEnd && slot.endText ? `${slot.timeText} – ${slot.endText}` : slot.timeText);

/** État vide soigné (aucun créneau du tout). */
export function emptyHtml(model) {
  const t = model.t;
  const href = model.planningHref;
  return `<div class="pa-empty" role="status"><svg class="pa-empty-i" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false"><rect x="6" y="10" width="36" height="32" rx="6" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M6 20h36M16 6v8M32 6v8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="24" cy="31" r="3.5" fill="currentColor"/></svg>` +
    `<p class="pa-empty-t">${esc(t("noStream"))}</p><p class="pa-empty-s">${esc(t("noStreamHint"))}</p>${href ? `<a class="pa-link" href="${esc(href)}">${esc(t("fullPlanning"))}</a>` : ""}</div>`;
}

/** Lien « voir le planning complet » (seulement dans les morceaux d'accueil, et si le module a une page). */
export function footHtml(model) {
  const parts = [];
  if (model.surface === "section" && model.planningHref) parts.push(`<a class="pa-link" href="${esc(model.planningHref)}">${esc(model.t("fullPlanning"))}</a>`);
  if (model.opts.timezone) parts.push(`<p class="pa-tz">${esc(model.t("tzNote", { tz: model.tzName }))}</p>`);
  return parts.length ? `<div class="pa-foot">${parts.join("")}</div>` : "";
}

/* ───────────── Feuille de style de base (jetons, pastilles, jaquettes, états) ───────────── */

export const BASE_CSS = minify(`
.pa{--pa-fg:var(--v-fg,#f4f4f5);--pa-muted:var(--v-muted,#a1a1a3);--pa-surface:var(--v-surface,#1b1b1d);--pa-line:var(--v-line,#2e2e30);--pa-bg:var(--v-bg,#121214);
  --pa-accent:var(--v-accent,#e8a23b);--pa-accent-fg:var(--v-accent-fg,#111111);--pa-hl:var(--pa-accent);--pa-hl-fg:var(--pa-accent-fg);
  --pa-sunk:color-mix(in srgb,var(--pa-fg) 5%,var(--pa-surface));--pa-hair:color-mix(in srgb,var(--pa-fg) 14%,transparent);
  --pa-pad:1rem;--pa-gap:.75rem;--pa-radius:1rem;--pa-cw:2.75rem;
  container-type:inline-size;width:100%;font-family:var(--v-font,inherit);color:var(--pa-fg);line-height:1.4}
[data-accent2] .pa{--pa-hl:var(--v-accent2,var(--pa-accent));--pa-hl-fg:var(--v-accent2-fg,var(--pa-accent-fg))}
.pa[data-density=compact]{--pa-pad:.6rem;--pa-gap:.5rem;--pa-radius:.75rem;--pa-cw:2.25rem}
.pa *,.pa *::before,.pa *::after{box-sizing:border-box}
.pa :where(h2,h3,h4,p,ul,ol,li,dl,dd,figure){margin:0;padding:0}
.pa :where(ul,ol){list-style:none}
.pa :where(h2,h3,h4){font-size:inherit;font-weight:inherit;line-height:inherit}
.pa time{font-variant-numeric:tabular-nums}
.pa-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.pa-title{overflow-wrap:anywhere;hyphens:auto;font-weight:650}
.pa-cancelled .pa-title{text-decoration:line-through;text-decoration-thickness:.1em;color:var(--pa-muted)}
.pa-games{color:var(--pa-muted);font-size:.875em;font-style:italic;overflow-wrap:anywhere}
.pa-chip{display:inline-flex;align-items:center;gap:.35em;padding:.1em .6em;border-radius:999px;border:1px solid var(--pa-hair);font-size:.75rem;font-weight:650;line-height:1.5;white-space:nowrap;color:var(--pa-fg);background:var(--pa-sunk)}
.pa-chip-live{background:var(--pa-hl);color:var(--pa-hl-fg);border-color:transparent}
.pa-chip-cancelled{border-style:dashed;color:var(--pa-fg)}
.pa-dot{width:.55em;height:.55em;border-radius:50%;background:currentColor}
.pa-x{font-weight:800;line-height:1}
.pa-covers{display:inline-flex;flex:0 0 auto;align-items:flex-start}
.pa-covers img{display:block;flex:0 0 auto;max-width:none;width:var(--pa-cw);aspect-ratio:3/4;object-fit:cover;border-radius:.4rem;background:var(--pa-line);border:2px solid var(--pa-surface);box-shadow:0 2px 8px -3px color-mix(in srgb,var(--pa-fg) 55%,transparent)}
.pa-covers img+img{margin-left:calc(var(--pa-cw)*-.45)}
.pa-ph{--pa-twitch:#9146ff;--pa-on:#ffffff;position:relative;display:flex;flex:0 0 auto;align-items:center;justify-content:center;width:var(--pa-cw);aspect-ratio:3/4;overflow:hidden;border-radius:.4rem;color:var(--pa-on);font-weight:800;font-size:1.1rem;line-height:1;background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--pa-on) 7%,transparent) 0 .4rem,transparent .4rem .8rem),linear-gradient(160deg,var(--pa-twitch),color-mix(in srgb,var(--pa-twitch) 72%,black))}
.pa-ph img{display:block;width:72%;height:auto;max-height:72%;object-fit:contain}
.pa-ph-disc{display:flex;align-items:center;justify-content:center;width:70%;aspect-ratio:1;border-radius:50%;background:var(--pa-on);padding:12%}
.pa-ph-disc img{width:100%;max-height:100%}
.pa-dh-wd{text-transform:capitalize}
.pa-dh-text .pa-dh-wd,.pa-dh-short .pa-dh-wd{font-weight:700}
.pa-dh-text .pa-dh-d,.pa-dh-short .pa-dh-d{color:var(--pa-muted);font-weight:500}
.pa-dh-m{text-transform:uppercase}
.pa-dh-tile{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;min-width:3.25rem;padding:.3rem .4rem;border:1px solid var(--pa-hair);border-radius:.6rem;background:var(--pa-sunk);line-height:1.1;text-align:center}
.pa-dh-tile .pa-dh-wd,.pa-dh-tile .pa-dh-m{font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;color:var(--pa-muted);font-weight:600}
.pa-dh-tile .pa-dh-n{font-size:1.4rem;font-weight:800}
.pa-link{display:inline-flex;align-items:center;min-height:2.75rem;color:var(--pa-fg);font-weight:600;text-decoration:underline;text-underline-offset:.2em}
.pa-link:focus-visible,.pa-btn:focus-visible{outline:2px solid var(--pa-fg);outline-offset:3px;border-radius:.3rem}
.pa-btn{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;padding:.55rem 1.1rem;border-radius:.7rem;background:var(--pa-hl);color:var(--pa-hl-fg);font-weight:650;text-decoration:none}
.pa-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.25rem 1rem;margin-top:.5rem}
.pa-tz{color:var(--pa-muted);font-size:.8125rem}
.pa-empty{display:flex;flex-direction:column;align-items:center;gap:.25rem;padding:2rem 1rem 1.5rem;text-align:center;border:1.5px dashed var(--pa-hair);border-radius:var(--pa-radius);background:var(--pa-sunk)}
.pa-empty-i{color:var(--pa-muted);margin-bottom:.5rem}
.pa-empty-t{font-size:1.1rem;font-weight:700}
.pa-empty-s{color:var(--pa-muted);margin-bottom:.5rem}
@media (prefers-reduced-motion:no-preference){.pa-btn{transition:transform .15s ease,filter .15s ease}.pa-btn:hover{transform:translateY(-1px);filter:brightness(1.08)}}
@media (forced-colors:active){.pa-chip,.pa-dh-tile,.pa-empty{border:1px solid CanvasText}.pa-chip-live{forced-color-adjust:none;background:Highlight;color:HighlightText}}
`);
