// Carte : ce que voit le visiteur (page, fiche d'un lieu, morceaux envoyés au navigateur), construit en HTML simple.
// La LISTE est toujours là, avec ou sans JavaScript, avec ou sans lecteur d'écran : c'est la version de base. La carte et « Près de moi » s'y ajoutent
// par le script de la page, et seulement après un clic (aucune requête vers un serveur de tuiles avant).
// Les fichiers voisins sont importés avec la même « version » que celui-ci.

const q = new URL(import.meta.url).search;
const { esc, clean, flag, fold, paragraphs, shorten, hostOf, safeHref, isCode, safeId, LIMITS } = await import(new URL(`./text.mjs${q}`, import.meta.url).href);
const { visible, typeInfo, sizeLimit } = await import(new URL(`./data.mjs${q}`, import.meta.url).href);

/** Les fonds de carte : OpenStreetMap, sans clé. Le navigateur les charge lui-même, après le clic « Afficher la carte ». */
export const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAX_ZOOM = 18;
export const RADII = [5, 20, 50, 100];

/** Adresse de la page de l'instance (null si elle n'est pas montée sur un chemin). Préfixe la langue si ce n'est pas la langue par défaut. */
export function pageHref(ctx, localized = true) {
  const base = ctx.instance.basePath;
  if (base === null || base === undefined) return null;
  const prefix = localized && ctx.locale !== ctx.defaultLocale ? `/${ctx.locale}` : "";
  return `${prefix}${base ? `/${base}` : ""}` || "/";
}

/**
 * Lit le chemin de la page : [] (liste), ["p", code] (fiche), et des paires t/<type>, q/<recherche>, page/<n> dans n'importe quel ordre.
 * Tout autre chemin est refusé (null → page introuvable).
 */
export function parseSegments(segments) {
  const s = Array.isArray(segments) ? segments.map(String) : [];
  if (s.length === 0) return { kind: "list", t: "", q: "", page: 1 };
  if (s[0] === "p") return s.length === 2 && isCode(s[1]) ? { kind: "place", code: s[1] } : null;
  if (s.length % 2 !== 0 || s.length > 6) return null;
  const out = { kind: "list", t: "", q: "", page: 1 };
  const seen = new Set();
  for (let i = 0; i < s.length; i += 2) {
    const k = s[i], v = s[i + 1];
    if (seen.has(k)) return null;
    seen.add(k);
    if (k === "t") { if (!/^[a-z0-9-]{1,40}$/.test(v)) return null; out.t = v; }
    else if (k === "q") { const t = clean(v, LIMITS.search); if (!t) return null; out.q = t; }
    else if (k === "page") { if (!/^[1-9]\d{0,3}$/.test(v)) return null; out.page = Number(v); }
    else return null;
  }
  return out;
}

/** Chemin d'une liste filtrée (le module construit toujours lui-même ses adresses). */
export function listHref(ctx, { t = "", q: text = "", page = 1 } = {}) {
  const base = pageHref(ctx);
  if (base === null) return null;
  const parts = [];
  if (t) parts.push("t", encodeURIComponent(t));
  if (text) parts.push("q", encodeURIComponent(text));
  if (page > 1) parts.push("page", String(page));
  return parts.length ? `${base === "/" ? "" : base}/${parts.join("/")}` : base;
}
export const placeHref = (ctx, code) => { const b = pageHref(ctx); return b === null ? null : `${b === "/" ? "" : b}/p/${code}`; };

/** Les mots du site (réglables), avec des valeurs neutres. */
export function word(ctx, n) {
  const own = clean(ctx.setting(n === 1 ? "wordOne" : "wordMany"), 40);
  return own || ctx.t(n === 1 ? "wordOne" : "wordMany");
}
export const countText = (ctx, n) => ctx.t("count", { n, word: word(ctx, n) });
const label = (ctx, setting, key) => clean(ctx.setting(setting), 60) || ctx.t(key);

/** Lieux de la liste filtrés par type et par recherche (comparaison sans accents ni majuscules, tous les mots doivent être présents). */
export function filterPlaces(all, { t = "", q: text = "" } = {}) {
  let list = t ? all.filter((p) => p.type === t) : all;
  const terms = fold(text).split(/\s+/).filter(Boolean).slice(0, 6);
  if (terms.length) list = list.filter((p) => terms.every((w) => p.hay.includes(w)));
  return list;
}

/** Lien « itinéraire » vers l'application de cartes choisie dans les réglages (jamais une adresse venue d'un visiteur : seulement des nombres). */
export function directionsHref(ctx, p) {
  const to = `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const app = String(ctx.setting("directions") ?? "osm");
  if (app === "google") return `https://www.google.com/maps/dir/?api=1&destination=${to}`;
  if (app === "apple") return `https://maps.apple.com/?daddr=${to}`;
  return `https://www.openstreetmap.org/directions?route=%3B${encodeURIComponent(to)}`;
}

function dateText(ctx, at) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(at ?? "");
  if (!m) return "";
  try { return new Intl.DateTimeFormat(ctx.locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))); } catch { return `${m[3]}/${m[2]}/${m[1]}`; }
}

/** Une fiche : nom, type, adresse (texte), description, horaires (texte libre), lien, itinéraire. `full` : tout le texte ; sinon une description abrégée. */
function details(ctx, w, p, { full, heading = "h2", link }) {
  const info = typeInfo(ctx, w, p.type);
  const parts = [];
  const name = link ? `<a href="${esc(link)}">${esc(p.name)}</a>` : esc(p.name);
  parts.push(`<${heading} class="cm-name"${full ? ' tabindex="-1" data-cm-focus' : ""}>${name}</${heading}>`);
  parts.push(`<p class="cm-meta"><span class="cm-type"><span aria-hidden="true">${esc(info.sym)}</span> ${esc(info.name)}</span>${p.ext && p.from ? `<span class="cm-pill">${esc(ctx.t("fromSource", { name: p.from }))}</span>` : ""}</p>`);
  if (p.ext && p.at) { const d = dateText(ctx, p.at); if (d) parts.push(`<p class="cm-date"><strong>${esc(ctx.t("date"))}</strong> ${esc(d)}</p>`); }
  if (p.address) parts.push(`<p class="cm-address"><strong>${esc(ctx.t("address"))}</strong> ${esc(p.address)}</p>`);
  if (p.desc) parts.push(`<div class="cm-desc">${full ? paragraphs(p.desc) : `<p>${esc(shorten(p.desc, 220))}</p>`}</div>`);
  if (p.hours) parts.push(`<div class="cm-hours"><strong>${esc(ctx.t("hours"))}</strong>${full ? paragraphs(p.hours) : `<p>${esc(shorten(p.hours, 160))}</p>`}</div>`);
  const links = [];
  const url = safeHref(p.url);
  if (url) links.push(`<a class="cm-link" href="${esc(url)}" rel="noopener noreferrer nofollow"${/^https?:/i.test(url) ? ' target="_blank"' : ""}>${esc(hostOf(url) || ctx.t("website"))}<span class="cm-sr"> ${esc(ctx.t("newWindow"))}</span></a>`);
  links.push(`<a class="cm-link" href="${esc(directionsHref(ctx, p))}" target="_blank" rel="noopener noreferrer">${esc(ctx.t("directions"))}<span class="cm-sr"> ${esc(ctx.t("newWindow"))}</span></a>`);
  links.push(`<button type="button" class="cm-link cm-js" data-cm-onmap="${esc(p.code)}" hidden>${esc(ctx.t("seeOnMap"))}</button>`);
  parts.push(`<p class="cm-links">${links.join("")}</p>`);
  return parts.join("");
}

/** Un lieu dans la liste. */
export function itemHtml(ctx, w, p) {
  return `<li class="cm-item" id="p-${esc(p.code)}" data-code="${esc(p.code)}"><article>${details(ctx, w, p, { full: false, link: placeHref(ctx, p.code) })}</article></li>`;
}

/** La fiche complète d'un lieu (page du lieu, panneau sous la carte). */
export function ficheHtml(ctx, w, p, { heading = "h2" } = {}) {
  return `<article class="cm-card" data-code="${esc(p.code)}">${details(ctx, w, p, { full: true, heading })}</article>`;
}

function pagerHtml(ctx, f, page, pages) {
  if (pages <= 1) return "";
  const prev = page > 1 ? `<a class="cm-btn" rel="prev" href="${esc(listHref(ctx, { ...f, page: page - 1 }))}">${esc(ctx.t("prev"))}</a>` : "";
  const next = page < pages ? `<a class="cm-btn" rel="next" href="${esc(listHref(ctx, { ...f, page: page + 1 }))}">${esc(ctx.t("next"))}</a>` : "";
  return `<nav class="cm-pager" aria-label="${esc(ctx.t("pagerLabel"))}">${prev}<span class="cm-pageno">${esc(ctx.t("pageOf", { page, pages }))}</span>${next}</nav>`;
}

/** Les morceaux de la liste (utilisés par la page et par la recherche sans rechargement). */
export function listParts(ctx, vis, f, page) {
  const list = filterPlaces(vis.all, f);
  const per = sizeLimit(ctx);
  const pages = Math.max(1, Math.ceil(list.length / per));
  const at = Math.min(Math.max(1, page), pages);
  const slice = list.slice((at - 1) * per, at * per);
  return {
    total: list.length, page: at, pages,
    count: countText(ctx, list.length),
    items: slice.map((p) => itemHtml(ctx, vis.world, p)).join(""),
    pager: pagerHtml(ctx, f, at, pages),
  };
}

/** Les textes que le navigateur affiche sans recharger la page : posés dans UN attribut (le script n'a aucun texte en dur). */
function config(ctx, vis, f, extra = {}) {
  const key = encodeURIComponent(ctx.instance.key);
  const lang = encodeURIComponent(ctx.locale);
  const qs = `lang=${lang}${f.t ? `&t=${encodeURIComponent(f.t)}` : ""}${f.q ? `&q=${encodeURIComponent(f.q)}` : ""}`;
  const t = (k, v) => ctx.t(k, v);
  return {
    tiles: TILES, maxZoom: MAX_ZOOM, locale: ctx.locale, radii: RADII, key: ctx.instance.key,
    urls: { points: `/m/${key}/points?${qs}`, place: `/m/${key}/place?lang=${lang}&c=`, list: `/m/${key}/list?lang=${lang}`, base: pageHref(ctx) },
    ...extra,
    t: {
      showMap: label(ctx, "showMapLabel", "showMap"), hideMap: t("hideMap"), mapLoading: t("mapLoading"), mapFailed: t("mapFailed"), tilesFailed: t("tilesFailed"),
      zoomIn: t("zoomIn"), zoomOut: t("zoomOut"), mapLabel: t("mapLabel", { places: word(ctx, 2) }), mapHelp: t("mapHelp"), attr: t("attribution"), group: t("group"), you: t("you"),
      nearSearching: t("nearSearching"), nearDenied: t("nearDenied"), nearUnavailable: t("nearUnavailable"), nearFound: t("nearFound"), nearNone: t("nearNone"), nearNoneAt: t("nearNoneAt"),
      fromHere: t("nearFromHere"), city: t("cityChoose"), coordsBad: t("coordsInvalid"), loadFailed: t("loadFailed"), noPoints: t("noPoints"), close: t("close"),
      wordOne: word(ctx, 1), wordMany: word(ctx, 2),
    },
  };
}

export const CSS = `
.cm{max-width:60rem;margin:0;color:var(--v-fg)}
.cm *,.cm *::before,.cm *::after{box-sizing:border-box}
.cm [hidden]{display:none!important}
.cm-intro{margin:0 0 1.25rem;color:var(--v-muted)}
.cm-intro p{margin:0 0 .5rem}
.cm a{color:var(--v-fg);text-decoration:underline;text-decoration-color:var(--v-accent);text-decoration-thickness:2px;text-underline-offset:3px}
.cm :focus-visible{outline:2px solid var(--v-accent);outline-offset:2px}
.cm-actions{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 .75rem}
.cm-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 1rem;border:1px solid var(--v-line);border-radius:999px;background:var(--v-bg);color:var(--v-fg);font:inherit;text-decoration:none;cursor:pointer}
.cm a.cm-btn{text-decoration:none}
.cm-btn:hover{border-color:var(--v-accent)}
.cm-btn:disabled{opacity:.6;cursor:default}
.cm-btn-main{border-color:transparent;background:var(--v-accent);color:var(--v-accent-fg);font-weight:600}
.cm a.cm-btn-main{color:var(--v-accent-fg)}
.cm-privacy,.cm-help,.cm-status{margin:0 0 .75rem;color:var(--v-muted);font-size:.9rem}
.cm-mapbox{margin:0 0 1rem}
.cm-map{position:relative;height:clamp(320px,62vh,560px)}
.cm-view{position:absolute;inset:0;overflow:hidden;touch-action:none;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface);cursor:grab;user-select:none;-webkit-user-select:none}
.cm-drag .cm-view{cursor:grabbing}
.cm-world,.cm-tiles,.cm-pins{position:absolute;inset:0}
.cm-pins{pointer-events:none}
.cm-tile{position:absolute;left:0;top:0;width:256px;height:256px;max-width:none;pointer-events:none;-webkit-user-drag:none}
.cm-tile.cm-miss{visibility:hidden}
.cm-pin,.cm-grp{position:absolute;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;display:flex;align-items:center;justify-content:center;border-radius:50%;border:3px solid var(--v-bg);font:inherit;font-size:1.15rem;line-height:1;cursor:pointer;pointer-events:auto;box-shadow:0 1px 5px rgba(0,0,0,.45)}
.cm-pin{background:var(--v-accent);color:var(--v-accent-fg)}
.cm-pin.cm-sel{outline:3px solid var(--v-fg);outline-offset:2px;z-index:2}
.cm-grp{background:var(--v-fg);color:var(--v-bg);font-weight:700;font-size:1rem}
.cm-me{position:absolute;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;border:3px solid var(--v-bg);background:var(--v-accent2);box-shadow:0 0 0 2px var(--v-accent2)}
.cm-ctl{position:absolute;top:.5rem;right:.5rem;display:flex;flex-direction:column;gap:.35rem}
.cm-ctl button{width:44px;height:44px;border:1px solid var(--v-line);border-radius:10px;background:var(--v-bg);color:var(--v-fg);font:inherit;font-size:1.4rem;line-height:1;cursor:pointer}
.cm-ctl button:disabled{opacity:.5;cursor:default}
.cm-attr{position:absolute;right:1px;bottom:1px;z-index:3;margin:0;padding:.2rem .55rem;border-radius:8px 0 11px 0;background:var(--v-bg);color:var(--v-fg);font-size:.75rem}
.cm-help{margin-top:.5rem}
.cm-fiche{margin:0 0 1rem}
.cm-card{padding:1rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface)}
.cm-fiche .cm-card{border-color:var(--v-accent)}
.cm-near{margin:0 0 1.25rem;padding:1rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface)}
.cm-near h2,.cm-h{margin:0 0 .5rem;font-size:1.2rem;font-weight:600;line-height:1.3}
.cm-field{display:block;margin:0 0 .5rem}
.cm-field label,.cm-search label{display:block;margin:0 0 .3rem;font-weight:600}
.cm-field select,.cm-field input,.cm-search input{display:block;width:100%;max-width:24rem;min-height:44px;padding:.5rem .8rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-bg);color:var(--v-fg);font:inherit}
.cm-search input{max-width:none}
.cm-row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:flex-end}
.cm-row .cm-field{margin:0}
.cm-city,.cm-coords{margin:.75rem 0 0}
.cm-coords summary{min-height:44px;display:flex;align-items:center;cursor:pointer}
.cm-results{margin:.75rem 0 0;padding:0;list-style:none}
.cm-results li{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.25rem .75rem;padding:.2rem 0;border-top:1px solid var(--v-line)}
.cm-results button{min-height:44px;padding:0;border:0;background:none;color:var(--v-fg);font:inherit;text-align:left;text-decoration:underline;text-decoration-color:var(--v-accent);text-decoration-thickness:2px;text-underline-offset:3px;cursor:pointer}
.cm-dist{color:var(--v-muted);white-space:nowrap}
.cm-chips{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 1rem;padding:0;list-style:none}
.cm-chips a{display:inline-flex;align-items:center;min-height:44px;padding:0 .9rem;border:1px solid var(--v-line);border-radius:999px;background:var(--v-surface);text-decoration:none}
.cm-chips a[aria-current] .cm-dist{color:inherit}
.cm-chips a[aria-current]{border-color:var(--v-accent);background:var(--v-accent);color:var(--v-accent-fg);font-weight:600}
.cm-search{margin:0 0 1rem}
.cm-search .cm-row{align-items:flex-end}
.cm-search .cm-field{flex:1 1 14rem}
.cm-count{margin:0 0 .75rem;color:var(--v-muted)}
.cm-list{margin:0;padding:0;list-style:none}
.cm-item{margin:0 0 .75rem}
.cm-item article{padding:1rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface)}
.cm-item.cm-flash article{border-color:var(--v-accent);box-shadow:0 0 0 2px var(--v-accent)}
.cm-name{margin:0 0 .25rem;font-size:1.15rem;font-weight:600;line-height:1.3;overflow-wrap:anywhere}
.cm-meta{display:flex;flex-wrap:wrap;gap:.35rem .6rem;align-items:center;margin:0 0 .5rem;color:var(--v-muted);font-size:.95rem}
.cm-pill{display:inline-block;padding:.1rem .6rem;border:1px solid var(--v-line);border-radius:999px;font-size:.85rem}
.cm-card p,.cm-item p{margin:0 0 .5rem;overflow-wrap:anywhere}
.cm-desc p,.cm-hours p{margin:0 0 .35rem}
.cm-links{display:flex;flex-wrap:wrap;gap:0 1.25rem;margin:.25rem 0 0!important}
.cm-link{display:inline-flex;align-items:center;min-height:44px}
button.cm-link{padding:0;border:0;background:none;color:var(--v-fg);font:inherit;text-decoration:underline;text-decoration-color:var(--v-accent);text-decoration-thickness:2px;text-underline-offset:3px;cursor:pointer}
.cm-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.cm-pager{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1rem;margin:1rem 0}
.cm-empty{padding:1rem;border:1px dashed var(--v-line);border-radius:12px;color:var(--v-muted)}
.cm-empty p{margin:0 0 .5rem}
.cm-back{display:inline-flex;align-items:center;min-height:44px;margin:0 0 .75rem}
@media (prefers-reduced-motion:no-preference){.cm-btn,.cm-chips a{transition:border-color .15s}}
`.replace(/\n/g, "");

/** Le haut de la page : boutons et zones (cachés tant que le script de la page n'est pas là : sans lui ils ne serviraient à rien). */
function actionsHtml(ctx, vis, { near = true } = {}) {
  const key = esc(ctx.instance.key);
  const map = flag(ctx, "showMap", true);
  const nearOn = near && flag(ctx, "showNear", true);
  if (!map && !nearOn) return "";
  const buttons = [];
  if (map) buttons.push(`<button type="button" class="cm-btn cm-btn-main" data-cm-show aria-expanded="false" aria-controls="cm-map-${key}">${esc(label(ctx, "showMapLabel", "showMap"))}</button>`);
  if (nearOn) buttons.push(`<button type="button" class="cm-btn" data-cm-near aria-controls="cm-near-${key}">${esc(label(ctx, "nearLabel", "nearMe"))}</button>`);
  return `<div class="cm-actions cm-js" hidden>${buttons.join("")}</div>`
    + (map ? `<p class="cm-privacy cm-js" hidden>${esc(ctx.t("mapPrivacy"))}</p>` : "")
    + (map ? `<div class="cm-mapbox" data-cm-mapbox hidden><div class="cm-map" id="cm-map-${key}" data-cm-map></div><p class="cm-status" role="status" data-cm-mapstatus></p></div>` : "")
    + `<section class="cm-fiche" data-cm-fiche aria-label="${esc(ctx.t("ficheLabel"))}" aria-live="polite" hidden></section>`
    + (nearOn ? nearHtml(ctx, vis) : "");
}

function nearHtml(ctx, vis) {
  const key = esc(ctx.instance.key);
  const cities = vis.world.cities;
  const radius = RADII.map((r) => `<option value="${r}"${r === 20 ? " selected" : ""}>${esc(ctx.t("kmOption", { n: r }))}</option>`).join("");
  const cityBlock = cities.length
    ? `<div class="cm-city"><div class="cm-row"><div class="cm-field"><label for="cm-city-${key}">${esc(ctx.t("cityLabel"))}</label><select id="cm-city-${key}" data-cm-city><option value="">${esc(ctx.t("cityChoose"))}</option>`
      + cities.map((c, i) => `<option value="${i}" data-lat="${c.lat}" data-lng="${c.lng}">${esc(c.name)}</option>`).join("")
      + `</select></div><button type="button" class="cm-btn" data-cm-usecity>${esc(ctx.t("cityUse"))}</button></div></div>`
    : "";
  const coords = `<details class="cm-coords"><summary>${esc(ctx.t("coordsSummary"))}</summary><p class="cm-status">${esc(ctx.t("coordsHelp"))}</p><div class="cm-row">`
    + `<div class="cm-field"><label for="cm-lat-${key}">${esc(ctx.t("latLabel"))}</label><input id="cm-lat-${key}" data-cm-lat inputmode="decimal" autocomplete="off" placeholder="12.3456"></div>`
    + `<div class="cm-field"><label for="cm-lng-${key}">${esc(ctx.t("lngLabel"))}</label><input id="cm-lng-${key}" data-cm-lng inputmode="decimal" autocomplete="off" placeholder="34.5678"></div>`
    + `<button type="button" class="cm-btn" data-cm-usecoords>${esc(ctx.t("coordsUse"))}</button></div></details>`;
  return `<section class="cm-near" id="cm-near-${key}" data-cm-nearbox aria-labelledby="cm-near-h-${key}" hidden><h2 id="cm-near-h-${key}" tabindex="-1">${esc(label(ctx, "nearLabel", "nearMe"))}</h2>`
    + `<p class="cm-status">${esc(ctx.t("nearPrivacy"))}</p>`
    + `<p class="cm-status" role="status" data-cm-nearstatus></p>`
    + `<div class="cm-field" data-cm-radiusbox hidden><label for="cm-rad-${key}">${esc(ctx.t("radiusLabel"))}</label><select id="cm-rad-${key}" data-cm-radius>${radius}</select></div>`
    + `<ol class="cm-results" data-cm-results></ol><p><button type="button" class="cm-btn" data-cm-more hidden>${esc(ctx.t("showMore"))}</button></p>`
    + `<div data-cm-fallback hidden>${cityBlock}${coords}</div></section>`;
}

/** La page : introduction, boutons, filtres par type, recherche, liste. */
export async function renderPage(ctx, route) {
  const vis = await visible(ctx);
  const f = { t: safeId(route.t), q: route.q };
  const key = esc(ctx.instance.key);
  const parts = [`<style>${CSS}</style><noscript><style>.cm-js{display:none!important}</style></noscript>`];
  const intro = clean(ctx.setting("intro"), 2000, true);
  const filtered = listParts(ctx, vis, f, route.page);
  parts.push(`<div class="cm" data-cm data-cfg="${esc(JSON.stringify(config(ctx, vis, f, { total: vis.all.length })))}">`);
  if (intro) parts.push(`<div class="cm-intro">${paragraphs(intro)}</div>`);

  if (vis.all.length === 0) {
    parts.push(`<div class="cm-empty"><p>${esc(ctx.t("noneYet", { places: word(ctx, 2) }))}</p></div></div>`);
    return { vis, html: parts.join("") };
  }
  parts.push(actionsHtml(ctx, vis));

  // Filtres par type : de vrais liens (la liste marche sans JavaScript)
  const typeOf = (id) => typeInfo(ctx, vis.world, id);
  const counts = new Map();
  for (const p of vis.all) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
  const kinds = [...vis.types.map((t) => t.id), ...vis.virtual];
  if (kinds.length > 1) {
    const chip = (id, text, n) => `<li><a href="${esc(listHref(ctx, { t: id, q: f.q }) ?? "#")}"${f.t === id ? ' aria-current="true"' : ""}>${esc(text)} <span class="cm-dist">(${n})</span></a></li>`;
    parts.push(`<nav aria-label="${esc(ctx.t("typesNav"))}"><ul class="cm-chips">${chip("", ctx.t("allTypes"), vis.all.length)}${kinds.map((id) => chip(id, `${typeOf(id).sym} ${typeOf(id).name}`, counts.get(id) ?? 0)).join("")}</ul></nav>`);
  }

  // Recherche : un formulaire ordinaire (sans JavaScript, il renvoie vers /q/…) que le script améliore
  parts.push(
    `<form class="cm-search" method="get" action="/m/${key}/go" role="search" data-cm-search><div class="cm-row"><div class="cm-field"><label for="cm-q-${key}">${esc(ctx.t("searchLabel"))}</label>`
    + `<input id="cm-q-${key}" type="search" name="q" value="${esc(f.q)}" maxlength="${LIMITS.search}" autocomplete="off" enterkeyhint="search" placeholder="${esc(ctx.t("searchPlaceholder"))}" data-cm-q></div>`
    + `<input type="hidden" name="t" value="${esc(f.t)}"><input type="hidden" name="lang" value="${esc(ctx.locale)}"><button class="cm-btn" type="submit">${esc(ctx.t("searchButton"))}</button></div></form>`,
  );
  parts.push(`<p class="cm-count" role="status" data-cm-count>${esc(filtered.count)}</p>`);
  if (filtered.total === 0) {
    parts.push(`<ul class="cm-list" data-cm-list></ul><div class="cm-empty" data-cm-empty><p>${esc(ctx.t("searchNone"))}</p>${(f.t || f.q) ? `<p><a href="${esc(pageHref(ctx) ?? "#")}">${esc(ctx.t("showAll"))}</a></p>` : ""}</div>`);
  } else {
    parts.push(`<ul class="cm-list" data-cm-list>${filtered.items}</ul><div class="cm-empty" data-cm-empty hidden><p>${esc(ctx.t("searchNone"))}</p></div><div data-cm-pager>${filtered.pager}</div>`);
  }
  if (!vis.extOk) parts.push(`<p class="cm-status">${esc(ctx.t("externalDown"))}</p>`);
  parts.push("</div>");
  return { vis, html: parts.join(""), page: filtered.page };
}

/** La page d'un lieu (adresse partageable). Rend null si le lieu n'est pas (ou plus) visible. */
export async function renderPlace(ctx, code) {
  const vis = await visible(ctx);
  const p = vis.byCode.get(code);
  if (!p) return null;
  const key = esc(ctx.instance.key);
  const base = pageHref(ctx);
  const parts = [`<style>${CSS}</style><noscript><style>.cm-js{display:none!important}</style></noscript>`];
  parts.push(`<div class="cm" data-cm data-cfg="${esc(JSON.stringify(config(ctx, vis, { t: "", q: "" }, { focus: p.code, total: vis.all.length })))}">`);
  if (base !== null) parts.push(`<a class="cm-back" href="${esc(base)}">${esc(ctx.t("backToList", { places: word(ctx, 2) }))}</a>`);
  parts.push(ficheHtml(ctx, vis.world, p, { heading: "h2" }));
  parts.push(`<div class="cm-actions cm-js" hidden>${flag(ctx, "showMap", true) ? `<button type="button" class="cm-btn cm-btn-main" data-cm-show aria-expanded="false" aria-controls="cm-map-${key}">${esc(label(ctx, "showMapLabel", "showMap"))}</button>` : ""}</div>`);
  if (flag(ctx, "showMap", true)) {
    parts.push(`<p class="cm-privacy cm-js" hidden>${esc(ctx.t("mapPrivacy"))}</p><div class="cm-mapbox" data-cm-mapbox hidden><div class="cm-map" id="cm-map-${key}" data-cm-map></div><p class="cm-status" role="status" data-cm-mapstatus></p></div>`);
  }
  parts.push("</div>");
  return { vis, place: p, html: parts.join("") };
}

/** Le texte d'introduction de la page pour les moteurs de recherche. */
export const metaDescription = (ctx) => shorten(clean(ctx.setting("intro"), 400), 160) || ctx.t("pageDescription", { places: word(ctx, 2) });
