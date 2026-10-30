// Planning : les ÉLÉMENTS proposés aux pages d'overlay du cœur (clé `overlayElements`, cœur 0.5.0) : « Planning de la semaine » (`week`) et « Prochain stream » (`next`).
// Ils n'existent que dans les pages d'overlay : le Planning n'a pas d'overlay propre. Ils REUTILISENT les apparences du module (liste classique, semaine en grille, timeline,
// affiches, à la une…) : même modèle, même rendu, seule l'enveloppe change (fond transparent, jetons --ov-*, jamais le skin du site, aucun lien).
//
// Données : les streams du jour sont déjà publics (page du planning), aucun secret n'est donc nécessaire. LECTURE PARTAGÉE : une seule lecture des agendas (et des jaquettes) sert tous les
// lecteurs, pendant `ttlMs` ; dix pages d'overlay qui montrent le même élément ne font jamais dix lectures de Google Agenda. Aucune tâche de fond : la page de l'élément s'interroge
// elle-même, de plus en plus lentement quand rien ne change (bornée). Fonctions pures pour tout ce qui n'est pas lecture.
const V = new URL(import.meta.url).search;
const { normalizeOptions, DEFAULT_APPEARANCE } = await import(`./appearances/options.mjs${V}`);
const { buildModel } = await import(`./appearances/model.mjs${V}`);
const { renderFragment } = await import(`./appearances/registry.mjs${V}`);
const { BASE_CSS, minify, esc } = await import(`./appearances/kit.mjs${V}`);
const { sampleData } = await import(`./appearances/preview.mjs${V}`);

export const ELEMENTS = ["week", "next"];
export const LOOKS = ["auto", "week", "classic", "alternating", "timeline", "posters"];
export const CACHE = { ttlMs: 45_000, failedTtlMs: 10_000, maxKeys: 40 };   // dans un objet pour que les tests puissent les raccourcir
const WINDOW_DAYS = 14;
const MAX_NEXT_MORE = 5;

const int = (v, min, max, def) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.min(max, Math.max(min, n)) : def; };
const flag = (v, def) => (v === "1" || v === "true" ? true : v === "0" || v === "false" ? false : def);

/** Les paramètres reçus (`ov-*` du cœur, `opt-*` de l'élément), TOUS validés : une valeur absurde retombe sur un défaut sûr, une inconnue est ignorée. */
export function readParams(id, params) {
  const get = (k) => params.get(k) ?? undefined;
  const style = params.has("ov-text") ? { text: get("ov-text") === "dark" ? "dark" : "light", surface: get("ov-surface") === "soft" ? "soft" : "transparent", corners: get("ov-corners") === "square" ? "square" : "round" } : null;
  const out = { id, width: int(get("ov-w"), 16, 7680, 1000), height: int(get("ov-h"), 16, 7680, 600), style, demo: get("ov-demo") === "1", covers: flag(get("opt-covers"), true) };
  if (id === "week") {
    const look = get("opt-look");
    out.look = LOOKS.includes(look) ? look : "auto";
    out.days = int(get("opt-days"), 1, WINDOW_DAYS, 7);
  } else {
    out.more = int(get("opt-more"), 0, MAX_NEXT_MORE, 0);
  }
  return out;
}

/** Style commun -> jetons --ov-* (valeurs de docs/OVERLAY-ELEMENTS.md). Sans style (adresse ouverte à la main), une valeur sûre : texte clair, fond transparent. */
export function tokensCss(style) {
  const light = style?.text !== "dark", soft = style?.surface === "soft";
  const border = soft ? (light ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.14)") : "transparent";
  return `--ov-fg:${light ? "#ffffff" : "#111111"};--ov-surface:${soft ? (light ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.7)") : "transparent"};--ov-radius:${style?.corners === "square" ? "0px" : "12px"};--ov-border:${border};`;
}

/* ───────────────────────────── Lecture partagée ───────────────────────────── */

const cache = new Map();   // clé d'instance|annulés -> { at, ttl, promise }
export const resetOverlayCache = () => cache.clear();

/**
 * Les streams des 14 prochains jours + leurs jaquettes + le visuel de repli : UNE lecture partagée par tous les lecteurs de l'instance (`ttlMs`), et une seule lecture à la fois
 * (les demandes simultanées attendent la même promesse). `deps` : { loadSlots, coversForSlots, brandVisual, wantsCancelled } fournis par index.mjs. Ne lève jamais.
 */
export function sharedSlots(ctx, deps) {
  const cancelled = !!deps.wantsCancelled(ctx);
  const key = `${ctx.instance?.key ?? ""}|${cancelled ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;
  const entry = { at: Date.now(), ttl: CACHE.ttlMs, promise: null };
  entry.promise = (async () => {
    try {
      const { slots, timeZone, failed } = await deps.loadSlots(ctx, WINDOW_DAYS, { cancelled });
      if (failed) entry.ttl = CACHE.failedTtlMs;
      const tz = timeZone ?? "UTC";
      const covers = (await deps.coversForSlots(ctx, slots.slice(0, 20))).covers;
      const vis = slots.length ? await deps.brandVisual(ctx).catch(() => null) : null;
      return { slots, tz, covers, vis };
    } catch {
      entry.ttl = CACHE.failedTtlMs;
      return { slots: [], tz: "UTC", covers: new Map(), vis: null };
    }
  })();
  cache.set(key, entry);
  while (cache.size > CACHE.maxKeys) cache.delete(cache.keys().next().value);
  return entry.promise;
}

/* ───────────────────────────── Rendu ───────────────────────────── */

/** Pas de pied de page, pas de lien, pas de bouton : dans OBS rien ne se clique, et l'adresse de la chaîne n'a rien à faire dans un overlay. */
const SURFACE = "overlay";

/** L'apparence réellement utilisée par l'élément « semaine » : au choix, ou d'après la taille du cadre (grille sur 7 colonnes si elle a la place, sinon liste). */
export function lookFor(p) {
  if (p.id === "next") return "hero";
  if (p.look !== "auto") return p.look;
  return p.width >= 704 && p.height >= 260 ? "week" : "classic";
}

/** Combien de streams tiennent dans la hauteur (rangées de 64 px environ, 120 pour les affiches) : borne le rendu avant même de le dessiner. */
function fitCount(p, look) {
  const row = look === "posters" ? 150 : look === "timeline" ? 84 : 66;
  return Math.max(1, Math.min(20, Math.floor((p.height - 24) / row)));
}

/** Les réglages d'apparence du module, adaptés au cadre : lus tels que la personne les a réglés (heures, jaquettes, jours…), sauf ce qui dépend de la taille. */
function optionsFor(ctx, p, look) {
  const compact = p.height < 420 || p.width < 520;
  const forced = { weekMode: "rolling", classicHideEmpty: true, heroUpNext: Math.min(p.more ?? 0, Math.max(0, Math.floor((p.height - 190) / 70))), showTimezone: false };
  if (!p.covers || (look === "week" && p.height < 380)) forced.showCovers = false;   // une grille trop basse n'a pas la place des jaquettes
  if (compact) forced.density = "compact";
  return normalizeOptions((k) => (k in forced ? forced[k] : ctx.setting(k)), look);
}

/** Le contenu de l'élément (HTML + style des apparences), pur : même entrée, même sortie. */
export function renderContent(ctx, p, data, now = new Date()) {
  const look = lookFor(p);
  const opts = optionsFor(ctx, p, look);
  const grid = look === "week";
  const days = p.id === "week" ? p.days : WINDOW_DAYS;
  const until = now.getTime() + days * 86_400_000;
  const slots = (data.slots ?? []).filter((s) => (opts.cancelled || !s.cancelled) && (grid || s.start.getTime() <= until));
  const model = buildModel({
    slots, covers: data.covers ?? new Map(), now, tz: data.tz ?? "UTC", locale: ctx.locale, t: ctx.t, opts,
    mode: grid ? "days" : "list", days, count: p.id === "next" ? 1 + (p.more ?? 0) : fitCount(p, look), surface: SURFACE,
    allowData: !!p.demo, planningHref: null, channelUrl: null, vis: opts.covers ? data.vis ?? null : null,
  });
  const frag = renderFragment(look, model, ctx);
  return `<div class="pa pa-${esc(frag.id)}" data-density="${esc(opts.density)}" data-ov-part="planning"><style>${BASE_CSS}${minify(frag.css)}</style>${frag.html}</div>`;
}

/** Contenu d'exemple du mode test (`ov-demo=1`) : les créneaux de l'aperçu de l'administration, rien d'inventé qui parte ailleurs. */
export function demoData(ctx, now = new Date()) {
  const { slots, covers } = sampleData(ctx.t, now);
  return { slots: slots.map((s) => ({ ...s, cancelled: false })), tz: "UTC", covers, vis: null };
}

/* ───────────────────────────── La page de l'élément ───────────────────────────── */

const BASE = `
html,body{margin:0;height:100%;overflow:hidden;background:transparent}
body{font:16px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ov-fg,#fff)}
body.ov-shadow{text-shadow:0 1px 3px rgba(0,0,0,.55)}
#p{box-sizing:border-box;height:100%;overflow:hidden;padding:12px;background:var(--ov-surface,transparent);border:1px solid var(--ov-border,transparent);border-radius:var(--ov-radius,0)}
#r{width:100%}
#r :where(img){height:auto}
#r.cut{-webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(to bottom,#000 calc(100% - 28px),transparent)}
/* Jetons du Planning (--v-*, lus par les apparences) déduits des jetons communs --ov-* : le skin du site n'est jamais chargé. */
#r{--v-fg:var(--ov-fg,#fff);--v-muted:color-mix(in srgb,var(--ov-fg,#fff) 72%,transparent);--v-surface:color-mix(in srgb,var(--ov-fg,#fff) 9%,transparent);--v-line:color-mix(in srgb,var(--ov-fg,#fff) 22%,transparent);--v-bg:transparent;--v-accent:#9146ff;--v-accent-fg:#ffffff;--v-font:inherit}
[data-ov-region="element"] #r .pa{--pa-radius:var(--ov-radius,1rem)}
[data-ov-region="element"] #r .pa :where(.pa-wk-day,.pa-dh-tile,.pa-empty,.pa-hr){border-radius:var(--ov-radius,.6rem)}
.pa-empty{border-color:var(--v-line)}
`;

const SCRIPT = `(function(){
var P=document.getElementById('p'),R=document.getElementById('r'),MIN=.55;
function fit(){R.style.zoom='';R.classList.remove('cut');var avail=P.clientHeight-24,s=1;
for(var i=0;i<4;i++){var h=R.getBoundingClientRect().height;if(h<=avail+1||h===0)break;s=Math.max(MIN,s*avail/h);R.style.zoom=s;if(s<=MIN)break}
if(R.getBoundingClientRect().height>avail+1)R.classList.add('cut')}
fit();window.addEventListener('resize',fit);
var u=location.pathname+location.search+(location.search?'&':'?')+'frag=1',v=R.getAttribute('data-v'),n=0,wait=60000;
function poll(){if(n++>=300)return;fetch(u,{credentials:'omit',cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(j){
if(j&&j.v!==v){v=j.v;R.innerHTML=j.html;R.setAttribute('data-v',v);wait=60000;fit()}else wait=Math.min(600000,Math.round(wait*1.5))}).catch(function(){wait=Math.min(600000,wait*2)}).then(function(){setTimeout(poll,wait)})}
setTimeout(poll,wait)})();`;

const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };

/**
 * La réponse de la route `element/:slug`. Une page entière, ou (avec `frag=1`) seulement le contenu et son empreinte, pour la mise à jour douce.
 * Jamais d'erreur visible : au pire, un cadre vide.
 */
export async function elementResponse(request, ctx, deps) {
  const slug = ctx.params?.slug;
  if (!ELEMENTS.includes(slug)) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const p = readParams(slug, url.searchParams);
  let content = "";
  try {
    const data = p.demo ? demoData(ctx) : await sharedSlots(ctx, deps);
    content = renderContent(ctx, p, data);
  } catch { content = ""; }
  const v = hash(content);
  const headers = { "cache-control": "no-store", "content-security-policy": CSP, "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
  if (url.searchParams.get("frag") === "1") return Response.json({ v, html: content }, { headers });
  const lang = String(ctx.locale ?? "en").replace(/[^A-Za-z-]/g, "").slice(0, 8) || "en";
  const light = p.style?.text !== "dark";
  const html = `<!doctype html><html lang="${esc(lang)}" data-ov-region="element"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(ctx.t("title"))}</title><style>:root{${tokensCss(p.style)}}${BASE}</style></head>` +
    `<body${light && p.style?.surface !== "soft" ? ' class="ov-shadow"' : ""}><div id="p" data-ov-part="panel"><div id="r" data-ov-part="content" data-v="${esc(v)}">${content}</div></div><script>${SCRIPT}</script></body></html>`;
  return new Response(html, { headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
}

/** L'adresse d'un élément (chemin du site, sans secret : les streams sont déjà publics). La langue demandée suit si elle est valable. */
export function elementAddress(ctx, id, request) {
  if (!ELEMENTS.includes(id)) return null;
  const lang = /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(String(request?.lang ?? "")) ? `?lang=${request.lang}` : "";
  return { url: `/m/${ctx.instance.key}/element/${id}${lang}` };
}

export { DEFAULT_APPEARANCE };
