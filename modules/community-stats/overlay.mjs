// Statistiques de la communauté — l'ÉLÉMENT « Compteurs » proposé aux pages d'overlay du cœur (clé `overlayElements`, cœur 0.5.0) : les chiffres de vos réseaux
// (followers, abonnements payants, publications, vues) et leur évolution, en grand, pour OBS.
//
// RIEN N'EST MONTRÉ SANS VOTRE ACCORD. Le seul chemin vers les données est `publicStats` (publicRead.mjs) : les chiffres pour lesquels la personne a choisi « Montrer sur mon site »,
// et eux seuls. L'option de l'élément (quel type de chiffre) ne fait que CHOISIR PARMI eux, jamais en ajouter. Un chiffre privé n'apparaît ni dans la page, ni dans le fragment de mise à jour,
// ni dans le mode test. L'adresse de l'élément est publique (pas de secret : elle ne donne que ce qui est déjà montrable).
//
// Plusieurs lecteurs : une seule lecture du stockage (chiffres + évolution) sert tous les lecteurs pendant `ttlMs`. Aucune tâche de fond ; la page s'interroge elle-même, de plus en plus lentement
// quand rien ne change, avec un nombre d'interrogations borné. Style : jetons --ov-* et attributs data-ov-part ; jamais le skin du site.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins
const { METRICS, platformName } = await import(`./model.mjs${v}`);
const { publicStats } = await import(`./publicRead.mjs${v}`);
const { changesOf, formatValue } = await import(`./evolution.mjs${v}`);

export const ELEMENTS = ["counters"];
export const SHOWS = ["all", ...METRICS];
export const CHANGES = ["none", "week", "month"];
export const CACHE = { ttlMs: 30_000, failedTtlMs: 8_000, maxKeys: 20 };   // dans un objet pour que les tests puissent les raccourcir
export const MAX_TILES = 12;

const int = (x, min, max, def) => { const n = Math.trunc(Number(x)); return Number.isFinite(n) && String(x ?? "").trim() !== "" ? Math.min(max, Math.max(min, n)) : def; };

/** Les paramètres reçus (`ov-*` du cœur, `opt-*` de l'élément), TOUS validés : une valeur absurde ou inconnue retombe sur le défaut. */
export function readParams(params) {
  const get = (k) => params.get(k) ?? undefined;
  const show = get("opt-show"), change = get("opt-change");
  return {
    width: int(get("ov-w"), 16, 7680, 1000), height: int(get("ov-h"), 16, 7680, 600),
    style: params.has("ov-text") ? { text: get("ov-text") === "dark" ? "dark" : "light", surface: get("ov-surface") === "soft" ? "soft" : "transparent", corners: get("ov-corners") === "square" ? "square" : "round" } : null,
    demo: get("ov-demo") === "1", show: SHOWS.includes(show) ? show : "all", change: CHANGES.includes(change) ? change : "week",
  };
}

/** Style commun -> jetons --ov-* (valeurs de docs/OVERLAY-ELEMENTS.md). Sans style (adresse ouverte à la main) : texte clair, fond transparent. */
export function tokensCss(style) {
  const light = style?.text !== "dark", soft = style?.surface === "soft";
  const border = soft ? (light ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.14)") : "transparent";
  return `--ov-fg:${light ? "#ffffff" : "#111111"};--ov-surface:${soft ? (light ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.7)") : "transparent"};--ov-radius:${style?.corners === "square" ? "0px" : "12px"};--ov-border:${border};`;
}

/* ───────────────────────────── Lecture partagée ───────────────────────────── */

const cache = new Map();   // clé d'instance -> { at, ttl, promise }
export const resetOverlayCache = () => cache.clear();

/** Le résumé de ce qu'on a le droit de montrer : les 4 chiffres de base, dans l'ordre des types puis du réseau, 12 au plus, chacun avec son évolution. Ne lève jamais. */
async function readSummary(ctx) {
  const shown = (await publicStats(ctx)).filter((s) => METRICS.includes(s.metric))
    .sort((a, b) => METRICS.indexOf(a.metric) - METRICS.indexOf(b.metric) || platformName(a).localeCompare(platformName(b)) || a.account.localeCompare(b.account))
    .slice(0, MAX_TILES * 2);
  const out = [];
  for (const s of shown) {
    const { week, month } = await changesOf(ctx, s);
    const pick = (c) => (c ? { delta: c.delta, percent: c.percent } : null);
    out.push({ id: s.id, metric: s.metric, platform: s.platform, platformName: platformName(s), account: s.account, value: s.lastValue, week: pick(week), month: pick(month) });
  }
  return out;
}

/** UNE lecture partagée par tous les lecteurs de l'instance, et une seule à la fois (les demandes simultanées attendent la même promesse). */
export function sharedSummary(ctx) {
  const key = ctx.instance?.key ?? "";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;
  const entry = { at: Date.now(), ttl: CACHE.ttlMs, promise: null };
  entry.promise = readSummary(ctx).catch(() => { entry.ttl = CACHE.failedTtlMs; return []; });
  cache.set(key, entry);
  while (cache.size > CACHE.maxKeys) cache.delete(cache.keys().next().value);
  return entry.promise;
}

/* ───────────────────────────── Rendu ───────────────────────────── */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Colonnes × rangées qui donnent les plus grandes tuiles pour `n` compteurs dans `w` × `h` (tuile idéale : environ 1,7 fois plus large que haute). */
export function gridFor(n, w, h) {
  let best = { cols: 1, rows: n, score: -1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const tw = (w - 24 - (cols - 1) * 12) / cols, th = (h - 24 - (rows - 1) * 12) / rows;
    const score = Math.min(th, tw / 1.7);
    if (score > best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

/** « ▲ +120 cette semaine » : l'évolution d'un compteur, ou rien quand on n'a pas assez d'historique (jamais un chiffre inventé). */
function changeText(ctx, c, which) {
  if (!c) return "";
  const days = which === "week" ? "7" : "30";
  return ctx.t(`ov${c.delta > 0 ? "Up" : c.delta < 0 ? "Down" : "Flat"}${days}`, { n: formatValue(ctx, Math.abs(c.delta)) });
}

/** Le contenu : pur (même entrée, même sortie). `summary` : ce que `sharedSummary` rend (déjà limité à ce qui est montrable). */
export function renderContent(ctx, p, summary) {
  const t = ctx.t;
  const chosen = (summary ?? []).filter((s) => p.show === "all" || s.metric === p.show).slice(0, MAX_TILES);
  if (!chosen.length) return p.demo ? `<p data-ov-part="empty" class="sc-empty">${esc(t("ovEmptyHint"))}</p>` : "";
  const { cols, rows } = gridFor(chosen.length, p.width, p.height);
  const dup = (s) => chosen.filter((o) => o.platform === s.platform && o.metric === s.metric).length > 1;
  const tiles = chosen.map((s) => {
    const value = formatValue(ctx, s.value);
    const ch = p.change === "none" ? "" : changeText(ctx, p.change === "week" ? s.week : s.month, p.change);
    return `<div data-ov-part="counter" class="sc-tile" data-metric="${esc(s.metric)}"><span data-ov-part="source" class="sc-src">${esc(dup(s) ? `${s.platformName} · ${s.account}` : s.platformName)}</span>` +
      `<span data-ov-part="value" class="sc-val" style="--n:${value.length}">${esc(value)}</span><span data-ov-part="label" class="sc-lab">${esc(t(`metric_${s.metric}`))}</span>${ch ? `<span data-ov-part="change" class="sc-chg">${esc(ch)}</span>` : ""}</div>`;
  }).join("");
  return `<div data-ov-part="counters" class="sc-grid" style="--cols:${cols};--rows:${rows}">${tiles}</div>`;
}

const BASE = `
html,body{margin:0;height:100%;overflow:hidden;background:transparent}
body{font:600 16px/1.25 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ov-fg,#fff)}
body.ov-shadow{text-shadow:0 1px 3px rgba(0,0,0,.55)}
#p{box-sizing:border-box;height:100%;overflow:hidden;padding:12px;background:var(--ov-surface,transparent);border:1px solid var(--ov-border,transparent);border-radius:var(--ov-radius,0)}
#r{height:100%}
.sc-grid{box-sizing:border-box;height:100%;display:grid;grid-template-columns:repeat(var(--cols,1),minmax(0,1fr));grid-template-rows:repeat(var(--rows,1),minmax(0,1fr));gap:12px}
.sc-tile{container-type:size;box-sizing:border-box;min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.15em;padding:4px 8px;text-align:center;
 background:color-mix(in srgb,var(--ov-fg,#fff) 9%,transparent);border:1px solid color-mix(in srgb,var(--ov-fg,#fff) 22%,transparent);border-radius:var(--ov-radius,0)}
.sc-src{font-size:clamp(10px,min(9cqh,5.5cqw),26px);color:color-mix(in srgb,var(--ov-fg,#fff) 72%,transparent);text-transform:uppercase;letter-spacing:.06em;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-val{font-size:clamp(14px,min(34cqh,calc(92cqw / (var(--n,5) * .62))),200px);font-weight:800;line-height:1.05;font-variant-numeric:tabular-nums;white-space:nowrap}
.sc-lab{font-size:clamp(11px,min(11cqh,6.5cqw),30px);color:var(--ov-fg,#fff)}
.sc-chg{font-size:clamp(10px,min(9cqh,5cqw),24px);color:color-mix(in srgb,var(--ov-fg,#fff) 78%,transparent);white-space:nowrap}
@container (max-height:120px){.sc-chg{display:none}}
@container (max-height:80px){.sc-src{display:none}}
.sc-empty{margin:0;padding:12px;font-weight:600;color:color-mix(in srgb,var(--ov-fg,#fff) 80%,transparent)}
`;

const SCRIPT = `(function(){var R=document.getElementById('r'),u=location.pathname+location.search+(location.search?'&':'?')+'frag=1',v=R.getAttribute('data-v'),n=0,wait=120000;
function poll(){if(n++>=200)return;fetch(u,{credentials:'omit',cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(j){
if(j&&j.v!==v){v=j.v;R.innerHTML=j.html;R.setAttribute('data-v',v);wait=120000}else wait=Math.min(900000,Math.round(wait*1.5))}).catch(function(){wait=Math.min(900000,wait*2)}).then(function(){setTimeout(poll,wait)})}
setTimeout(poll,wait)})();`;

const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };

/** La réponse de la route `element/:slug` : une page entière, ou (avec `frag=1`) le contenu et son empreinte. Jamais d'erreur visible : au pire, un cadre vide. */
export async function elementResponse(request, ctx) {
  if (!ELEMENTS.includes(ctx.params?.slug)) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const p = readParams(url.searchParams);
  let content = "";
  try { content = renderContent(ctx, p, await sharedSummary(ctx)); } catch { content = ""; }
  const vv = hash(content);
  const headers = { "cache-control": "no-store", "content-security-policy": CSP, "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
  if (url.searchParams.get("frag") === "1") return Response.json({ v: vv, html: content }, { headers });
  const lang = String(ctx.locale ?? "en").replace(/[^A-Za-z-]/g, "").slice(0, 8) || "en";
  const shadow = p.style?.text !== "dark" && p.style?.surface !== "soft";
  const html = `<!doctype html><html lang="${esc(lang)}" data-ov-region="element"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(ctx.t("ovTitle"))}</title><style>:root{${tokensCss(p.style)}}${BASE}</style></head>` +
    `<body${shadow ? ' class="ov-shadow"' : ""}><div id="p" data-ov-part="panel"><div id="r" data-ov-part="content" data-v="${esc(vv)}">${content}</div></div><script>${SCRIPT}</script></body></html>`;
  return new Response(html, { headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
}

/** L'adresse d'un élément : un chemin du site, sans secret (la page ne donne que ce qui est déjà montrable). */
export function elementAddress(ctx, id, request) {
  if (!ELEMENTS.includes(id)) return null;
  const lang = /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(String(request?.lang ?? "")) ? `?lang=${request.lang}` : "";
  return { url: `/m/${ctx.instance.key}/element/${id}${lang}` };
}
