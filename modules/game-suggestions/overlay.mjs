// Suggestions de jeux — l'ÉLÉMENT « Top des jeux proposés » proposé aux pages d'overlay du cœur (clé `overlayElements`, cœur 0.5.0) : pendant un segment « on joue à quoi après ? »,
// les jeux les plus proposés (ou les plus votés « rejoue-le »), en grand, pour OBS.
//
// RIEN DE PLUS QUE LA PAGE PUBLIQUE. La seule lecture est `publicRows` (index.mjs) : les mêmes lignes que la page des suggestions (« rejeté » n'y est pas). On n'en tire que le NOM du jeu,
// le nombre de fois où il a été proposé (des lignes de même nom, que la page montre une à une) et, pour les jeux déjà joués, le nombre de votes « rejoue-le » (que la page montre). Jamais
// un pseudo, jamais une note, jamais une jaquette (aucune image, donc aucun chargement chez un tiers). L'adresse de l'élément est publique (pas de secret).
//
// Plusieurs lecteurs : une seule lecture du stockage sert tous les lecteurs pendant `ttlMs`, et rien n'est consommé ni retenu par lecteur. Aucune tâche de fond ; la page s'interroge elle-même,
// de plus en plus lentement quand rien ne change, avec un nombre d'interrogations borné. Style : jetons --ov-* et attributs data-ov-part ; jamais le skin du site.
export const ELEMENTS = ["top"];
export const STATUSES = ["proposed", "planned", "accepted", "already_played", "finished"];   // les statuts publics, dans l'ordre de la page
export const CACHE = { ttlMs: 30_000, failedTtlMs: 8_000, maxKeys: 20 };   // dans un objet pour que les tests puissent les raccourcir
export const MAX_ENTRIES = 10;

const int = (x, min, max, def) => { const n = Math.trunc(Number(x)); return Number.isFinite(n) && String(x ?? "").trim() !== "" ? Math.min(max, Math.max(min, n)) : def; };

/** Les paramètres reçus (`ov-*` du cœur, `opt-*` de l'élément), TOUS validés : une valeur absurde ou inconnue retombe sur le défaut. */
export function readParams(params) {
  const get = (k) => params.get(k) ?? undefined;
  const status = get("opt-status");
  return {
    width: int(get("ov-w"), 16, 7680, 600), height: int(get("ov-h"), 16, 7680, 400),
    style: params.has("ov-text") ? { text: get("ov-text") === "dark" ? "dark" : "light", surface: get("ov-surface") === "soft" ? "soft" : "transparent", corners: get("ov-corners") === "square" ? "square" : "round" } : null,
    demo: get("ov-demo") === "1", status: STATUSES.includes(status) ? status : "proposed", count: int(get("opt-count"), 1, MAX_ENTRIES, 3),
  };
}

/** Style commun -> jetons --ov-* (valeurs de docs/OVERLAY-ELEMENTS.md). Sans style (adresse ouverte à la main) : texte clair, fond transparent. */
export function tokensCss(style) {
  const light = style?.text !== "dark", soft = style?.surface === "soft";
  const border = soft ? (light ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.14)") : "transparent";
  return `--ov-fg:${light ? "#ffffff" : "#111111"};--ov-surface:${soft ? (light ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.7)") : "transparent"};--ov-radius:${style?.corners === "square" ? "0px" : "12px"};--ov-border:${border};`;
}

/* ───────────────────────────── Classement ───────────────────────────── */

const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Le classement de chaque statut public : les jeux de même nom sont regroupés (`times` = nombre de lignes, `votes` = votes « rejoue-le », qui n'existent que pour « déjà joué »).
 * « Déjà joué » : les plus votés d'abord ; les autres statuts : les plus proposés d'abord. À égalité : le plus récent, puis l'ordre alphabétique. `MAX_ENTRIES` par statut.
 * `list` : les lignes publiques de `publicRows` ({ title, status, at, votes }). Pur : même entrée, même sortie.
 */
export function rank(list) {
  const out = {};
  for (const status of STATUSES) {
    const groups = new Map();
    for (const g of list) {
      if (g.status !== status) continue;
      const key = fold(g.title);
      if (!key) continue;
      const at = new Date(g.at).getTime() || 0;
      const hit = groups.get(key);
      if (!hit) groups.set(key, { title: g.title, times: 1, votes: status === "already_played" ? Number(g.votes) || 0 : 0, at, first: at });
      else { hit.times++; if (status === "already_played") hit.votes += Number(g.votes) || 0; if (at > hit.at) hit.at = at; if (at < hit.first) { hit.first = at; hit.title = g.title; } }   // le nom est écrit comme la PREMIÈRE proposition
    }
    const primary = status === "already_played" ? (e) => e.votes : (e) => e.times;
    out[status] = [...groups.values()].sort((a, b) => primary(b) - primary(a) || b.times - a.times || b.at - a.at || a.title.localeCompare(b.title)).slice(0, MAX_ENTRIES).map(({ title, times, votes }) => ({ title, times, votes }));
  }
  return out;
}

/* ───────────────────────────── Lecture partagée ───────────────────────────── */

const cache = new Map();   // clé d'instance -> { at, ttl, promise }
export const resetOverlayCache = () => cache.clear();

/** UNE lecture partagée par tous les lecteurs de l'instance, et une seule à la fois (les demandes simultanées attendent la même promesse). `read(ctx)` : les lignes publiques. */
export function sharedRanking(ctx, read) {
  const key = ctx.instance?.key ?? "";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;
  const entry = { at: Date.now(), ttl: CACHE.ttlMs, promise: null };
  entry.promise = Promise.resolve().then(() => read(ctx)).then(rank).catch(() => { entry.ttl = CACHE.failedTtlMs; return rank([]); });
  cache.set(key, entry);
  while (cache.size > CACHE.maxKeys) cache.delete(cache.keys().next().value);
  return entry.promise;
}

/* ───────────────────────────── Rendu ───────────────────────────── */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const plural = (ctx, key, n) => ctx.t(n === 1 ? `${key}_one` : key, { n });

/** La phrase qui accompagne un jeu : « 12 votes » pour un jeu déjà joué, « proposé 3 fois » pour un jeu proposé plusieurs fois ; sinon rien (jamais un chiffre inventé). */
export function scoreText(ctx, status, e) {
  if (status === "already_played") return e.votes > 0 ? plural(ctx, "ovVotes", e.votes) : "";
  if (status === "proposed") return e.times > 1 ? ctx.t("ovTimes", { n: e.times }) : "";
  return "";
}

/** Colonnes × rangées qui donnent les plus grandes lignes pour `n` jeux dans `w` × `h` (ligne idéale : environ 6 fois plus large que haute). */
export function layoutFor(n, w, h) {
  let best = { cols: 1, rows: n, score: -1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const rw = (w - 24 - (cols - 1) * 16) / cols, rh = (h - 24 - (rows - 1) * 8) / rows;
    const score = Math.min(rh, rw / 6);
    if (score > best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

const SAMPLE_VOTES = [12, 9, 7, 5, 4, 3, 3, 2, 2, 1];

/** Le contenu : pur (même entrée, même sortie). `ranking` : ce que `sharedRanking` rend (déjà limité à ce que la page publique montre). */
export function renderContent(ctx, p, ranking) {
  const t = ctx.t;
  let entries = (ranking?.[p.status] ?? []).slice(0, p.count);
  if (!entries.length) {
    if (!p.demo) return "";   // en direct : un cadre vide et silencieux
    entries = Array.from({ length: p.count }, (_, i) => ({ title: t("ovDemoGame", { n: i + 1 }), times: Math.max(1, 4 - i), votes: SAMPLE_VOTES[i] }));
  }
  const head = p.height >= 150 ? `<p data-ov-part="title" class="gs-head">${esc(t(`ovHeading_${p.status}`))}</p>` : "";
  const headPx = head ? 44 : 0;
  const { cols, rows } = layoutFor(entries.length, p.width, p.height - headPx);
  // Hauteur d'une ligne : elle partage la place, sans jamais devenir une grande boîte à petit texte (au plus un quart de sa largeur) ; la liste reste en haut du cadre.
  const colW = (p.width - 24 - (cols - 1) * 16) / cols;
  const rowH = Math.max(28, Math.min(Math.floor((p.height - headPx - 24 - (rows - 1) * 8) / rows), Math.floor(colW / 4), 140));
  const items = entries.map((e, i) => {
    const score = scoreText(ctx, p.status, e);
    return `<li data-ov-part="game" class="gs-row"><div class="gs-in"><span data-ov-part="rank" class="gs-rank">${i + 1}</span><span data-ov-part="name" class="gs-name">${esc(e.title)}</span>${score ? `<span data-ov-part="score" class="gs-score">${esc(score)}</span>` : ""}</div></li>`;
  }).join("");
  return `${head}<ol data-ov-part="list" class="gs-list" style="--cols:${cols};--rows:${rows};--rh:${rowH}px">${items}</ol>`;
}

const BASE = `
html,body{margin:0;height:100%;overflow:hidden;background:transparent}
body{font:600 16px/1.25 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ov-fg,#fff)}
body.ov-shadow{text-shadow:0 1px 3px rgba(0,0,0,.55)}
#p{box-sizing:border-box;height:100%;overflow:hidden;padding:12px;background:var(--ov-surface,transparent);border:1px solid var(--ov-border,transparent);border-radius:var(--ov-radius,0)}
#r{height:100%;display:flex;flex-direction:column;gap:8px}
.gs-head{margin:0;flex:0 0 auto;font-size:clamp(14px,4.2vmin,30px);font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:color-mix(in srgb,var(--ov-fg,#fff) 78%,transparent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gs-list{flex:1 1 0;min-height:0;margin:0;padding:0;list-style:none;display:grid;grid-auto-flow:column;grid-template-columns:repeat(var(--cols,1),minmax(0,1fr));grid-template-rows:repeat(var(--rows,1),var(--rh,48px));align-content:start;gap:8px 16px}
.gs-row{container-type:size;box-sizing:border-box;min-width:0;min-height:0;overflow:hidden;
 background:color-mix(in srgb,var(--ov-fg,#fff) 9%,transparent);border:1px solid color-mix(in srgb,var(--ov-fg,#fff) 22%,transparent);border-radius:var(--ov-radius,0)}
.gs-in{box-sizing:border-box;height:100%;display:flex;align-items:center;gap:.55em;padding:0 .6em;font-size:clamp(12px,min(40cqh,6cqw),64px)}
.gs-rank{flex:0 0 auto;min-width:1.1em;text-align:center;font-weight:800;font-variant-numeric:tabular-nums;color:color-mix(in srgb,var(--ov-fg,#fff) 70%,transparent)}
.gs-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:800}
.gs-score{flex:0 0 auto;font-size:.62em;font-weight:600;white-space:nowrap;color:color-mix(in srgb,var(--ov-fg,#fff) 78%,transparent)}
@container (max-width:240px){.gs-score{display:none}}
`;

const SCRIPT = `(function(){var R=document.getElementById('r'),u=location.pathname+location.search+(location.search?'&':'?')+'frag=1',v=R.getAttribute('data-v'),n=0,wait=120000;
function poll(){if(n++>=200)return;fetch(u,{credentials:'omit',cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(j){
if(j&&j.v!==v){v=j.v;R.innerHTML=j.html;R.setAttribute('data-v',v);wait=120000}else wait=Math.min(900000,Math.round(wait*1.5))}).catch(function(){wait=Math.min(900000,wait*2)}).then(function(){setTimeout(poll,wait)})}
setTimeout(poll,wait)})();`;

const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };

/** La réponse de la route `element/:slug` : une page entière, ou (avec `frag=1`) le contenu et son empreinte. Jamais d'erreur visible : au pire, un cadre vide. */
export async function elementResponse(request, ctx, read) {
  if (!ELEMENTS.includes(ctx.params?.slug)) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const p = readParams(url.searchParams);
  let content = "";
  try { content = renderContent(ctx, p, await sharedRanking(ctx, read)); } catch { content = ""; }
  const vv = hash(content);
  const headers = { "cache-control": "no-store", "content-security-policy": CSP, "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
  if (url.searchParams.get("frag") === "1") return Response.json({ v: vv, html: content }, { headers });
  const lang = String(ctx.locale ?? "en").replace(/[^A-Za-z-]/g, "").slice(0, 8) || "en";
  const shadow = p.style?.text !== "dark" && p.style?.surface !== "soft";
  const html = `<!doctype html><html lang="${esc(lang)}" data-ov-region="element"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(ctx.t("ovTitle"))}</title><style>:root{${tokensCss(p.style)}}${BASE}</style></head>` +
    `<body${shadow ? ' class="ov-shadow"' : ""}><div id="p" data-ov-part="panel"><div id="r" data-ov-part="content" data-v="${esc(vv)}">${content}</div></div><script>${SCRIPT}</script></body></html>`;
  return new Response(html, { headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
}

/** L'adresse d'un élément : un chemin du site, sans secret (la page ne donne que ce que la page publique montre déjà). */
export function elementAddress(ctx, id, request) {
  if (!ELEMENTS.includes(id)) return null;
  const lang = /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(String(request?.lang ?? "")) ? `?lang=${request.lang}` : "";
  return { url: `/m/${ctx.instance.key}/element/${id}${lang}` };
}
