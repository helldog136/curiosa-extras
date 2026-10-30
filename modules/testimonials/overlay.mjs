// Témoignages : l'ÉLÉMENT proposé aux pages d'overlay du cœur (clé `overlayElements`, cœur 0.5.0) : « Avis de la communauté » (`reviews`).
// Un avis publié s'affiche à tour de rôle dans le cadre. Les avis sont ceux de la page publique : validés par vous ET avec l'accord de leur auteur enregistré (`isPublic`).
// Ni adresse e-mail, ni lien privé, ni avis en attente ou refusé ne passent jamais par ici : la liste est construite champ par champ (nom, texte, note, favori).
//
// PLUSIEURS LECTEURS : rien n'est consommé à la lecture. L'avis montré se déduit de l'HEURE (créneau = heure / durée, avis = liste[créneau % taille]) : toutes les pages d'overlay qui
// montrent l'élément affichent le même avis au même instant, sans état côté serveur. La liste est lue UNE fois pour tous les lecteurs (gardée `ttlMs`, une seule lecture à la fois) ;
// aucune tâche de fond : la page de l'élément se met à jour elle-même, de plus en plus lentement quand rien ne change.
const v = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const { esc } = L;

export const ELEMENTS = ["reviews"];
export const CACHE = { ttlMs: 30_000, failedTtlMs: 10_000, maxKeys: 40 };   // dans un objet pour que les tests puissent les raccourcir
export const LIMITS = { seconds: [4, 120, 12], count: [1, 20, 10], text: 260 };

const int = (raw, [min, max, def]) => { const n = Math.trunc(Number(raw)); return Number.isFinite(n) && String(raw ?? "").trim() !== "" ? Math.min(max, Math.max(min, n)) : def; };

/** Les paramètres reçus (`ov-*` du cœur, `opt-*` de l'élément), TOUS revalidés : une valeur absurde retombe sur un défaut sûr, une inconnue est ignorée. */
export function readParams(params) {
  const get = (k) => params.get(k) ?? undefined;
  const style = params.has("ov-text") ? { text: get("ov-text") === "dark" ? "dark" : "light", surface: get("ov-surface") === "soft" ? "soft" : "transparent", corners: get("ov-corners") === "square" ? "square" : "round" } : null;
  return { style, demo: get("ov-demo") === "1", seconds: int(get("opt-seconds"), LIMITS.seconds), count: int(get("opt-count"), LIMITS.count) };
}

/** Style commun -> jetons --ov-* (valeurs de docs/OVERLAY-ELEMENTS.md). Sans style (adresse ouverte à la main) : texte clair, fond transparent. */
export function tokensCss(style) {
  const light = style?.text !== "dark", soft = style?.surface === "soft";
  const border = soft ? (light ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.18)") : "transparent";
  return `--ov-fg:${light ? "#ffffff" : "#111111"};--ov-surface:${soft ? (light ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.7)") : "transparent"};--ov-radius:${style?.corners === "square" ? "0px" : "12px"};--ov-border:${border};`;
}

/** Un avis long est coupé à un mot entier, avec « … » : dans un cadre de stream, on lit une phrase, pas un roman. */
export function shorten(text, max = LIMITS.text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const word = cut.replace(/\s+\S*$/, "");
  return `${(word.length >= max * 0.6 ? word : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

/** Ce qui sort vers la page : champ par champ, jamais l'avis entier. */
export const publicView = (r) => ({ name: String(r.name), text: shorten(r.text), rating: r.rating ?? 0, favorite: r.featured === true });

/* ───────────────────────────── Lecture partagée ───────────────────────────── */

const cache = new Map();   // clé d'instance -> { at, ttl, promise }
export const resetOverlayCache = () => cache.clear();

/** Les avis publics rangés dans l'ordre choisi dans le module (favoris d'abord par défaut) : UNE lecture pour tous les lecteurs, une seule à la fois. Ne lève jamais. */
export function sharedReviews(ctx) {
  const key = ctx.instance?.key ?? "";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;
  const entry = { at: Date.now(), ttl: CACHE.ttlMs, promise: null };
  entry.promise = (async () => {
    try {
      return L.orderReviews(await D.readPublic(ctx), L.config(ctx).order).slice(0, LIMITS.count[1]).map(publicView);
    } catch {
      entry.ttl = CACHE.failedTtlMs;
      return hit ? hit.promise : [];
    }
  })();
  cache.set(key, entry);
  while (cache.size > CACHE.maxKeys) cache.delete(cache.keys().next().value);
  return entry.promise;
}

/** Contenu d'exemple du mode test (`ov-demo=1`), seulement quand aucun avis n'est public : un avis inventé, jamais celui d'une vraie personne. */
export const demoReviews = (ctx) => [{ name: ctx.t("demoName"), text: ctx.t("demoReview"), rating: 5, favorite: false }];

/* ───────────────────────────── La page de l'élément ───────────────────────────── */

const BASE = `
html,body{margin:0;height:100%;overflow:hidden;background:transparent}
body{font:16px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ov-fg,#fff)}
#stage{position:fixed;inset:0}
[data-ov-part="panel"]{position:absolute;inset:0;box-sizing:border-box;margin:0;padding:3.5vmin 4.5vmin;display:flex;flex-direction:column;justify-content:center;gap:1.6vmin;overflow:hidden;
  background:var(--ov-surface,transparent);border:1px solid var(--ov-border,transparent);border-radius:var(--ov-radius,12px);text-shadow:0 1px 3px rgba(0,0,0,.35);
  opacity:0;transition:opacity .5s}
[data-ov-part="panel"].on{opacity:1}
body.soft [data-ov-part="panel"]{text-shadow:none}
[data-ov-part="quote"]{margin:0;overflow-wrap:anywhere;font-weight:500;line-height:1.3}
[data-ov-part="quote"]::before{content:"\\201C"}
[data-ov-part="quote"]::after{content:"\\201D"}
[data-ov-part="footer"]{display:flex;align-items:center;gap:1.8vmin;min-width:0;font-size:max(12px,min(3.4vmin,22px))}
[data-ov-part="avatar"]{flex:none;display:grid;place-items:center;width:2.4em;height:2.4em;border-radius:50%;background:var(--ov-accent,#9146ff);color:#fff;font-weight:700;text-shadow:none}
[data-ov-part="author"]{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
[data-ov-part="stars"]{flex:none;color:var(--ov-star,#f5b301);letter-spacing:.12em;white-space:nowrap}
@media (prefers-reduced-motion:reduce){[data-ov-part="panel"]{transition:none}}
`;

// Le script : l'avis du moment se déduit de l'heure ; la taille du texte s'ajuste au cadre (grand si le cadre est grand, réduite jusqu'à ce que tout tienne) ; mise à jour douce et bornée.
const SCRIPT = `(function(){
var d=JSON.parse(document.getElementById('d').textContent),P=document.getElementById('p'),Q=document.getElementById('q'),A=document.getElementById('a'),I=document.getElementById('i'),S=document.getElementById('s'),F=document.getElementById('f'),shown=null;
function fit(){var w=P.clientWidth,h=P.clientHeight,size=Math.max(14,Math.min(h/3.1,w/9,54));Q.style.fontSize=size+'px';var n=0;
while(n++<60&&size>12&&P.scrollHeight>P.clientHeight+1){size-=Math.max(1,size*.06);Q.style.fontSize=size+'px'}}
function show(){var l=d.reviews;if(!l.length){P.classList.remove('on');shown=null;return}
var r=l[Math.floor(Date.now()/(d.seconds*1000))%l.length],id=JSON.stringify(r);if(id===shown&&P.classList.contains('on'))return;
var swap=function(){Q.textContent=r.text;A.textContent=r.name;I.textContent=Array.from(r.name)[0]||'';S.textContent=r.rating?'\\u2605'.repeat(r.rating)+'\\u2606'.repeat(5-r.rating):'';
S.setAttribute('aria-label',r.rating?d.starsLabel.replace('{n}',r.rating):'');S.hidden=!r.rating;P.classList.add('on');fit()};
shown=id;if(P.classList.contains('on')){P.classList.remove('on');setTimeout(swap,500)}else swap()}
function next(){setTimeout(function(){show();next()},d.seconds*1000-(Date.now()%(d.seconds*1000))+30)}
window.addEventListener('resize',fit);show();next();
var u=location.pathname+location.search+(location.search?'&':'?')+'data=1',n=0,wait=60000;
function poll(){if(n++>=300)return;var x=new XMLHttpRequest();x.open('GET',u);x.responseType='json';x.timeout=15000;
function done(j){if(j&&Array.isArray(j.reviews)){var same=JSON.stringify(j.reviews)===JSON.stringify(d.reviews);d.reviews=j.reviews;if(!same){wait=60000;show()}else wait=Math.min(600000,Math.round(wait*1.5))}else wait=Math.min(600000,wait*2);setTimeout(poll,wait)}
x.onload=function(){done(x.status===200?x.response:null)};x.onerror=x.ontimeout=function(){wait=Math.min(600000,wait*2);setTimeout(poll,wait)};x.send()}
setTimeout(poll,wait)})();`;

const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const HEADERS = { "cache-control": "no-store", "content-security-policy": CSP, "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };

/** Les avis de l'élément : ceux de la page publique, ou (mode test, sans aucun avis public) un avis d'exemple. Au plus `count`. */
async function reviewsFor(ctx, p) {
  const list = await sharedReviews(ctx);
  return (list.length || !p.demo ? list : demoReviews(ctx)).slice(0, p.count);
}

/**
 * La réponse de la route `element/:slug`. Une page entière, ou (avec `data=1`) seulement la liste des avis, pour la mise à jour douce.
 * Jamais d'erreur visible : au pire, un cadre vide.
 */
export async function elementResponse(request, ctx) {
  const slug = ctx.params?.slug;
  if (!ELEMENTS.includes(slug)) return new Response("Not found", { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  const url = new URL(request.url);
  const p = readParams(url.searchParams);
  let reviews = [];
  try { reviews = await reviewsFor(ctx, p); } catch { reviews = []; }
  if (url.searchParams.get("data") === "1") return Response.json({ reviews }, { headers: HEADERS });
  const data = JSON.stringify({ reviews, seconds: p.seconds, starsLabel: ctx.t("starsLabel", { n: "{n}" }) }).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, " ");
  const lang = String(ctx.locale ?? "en").replace(/[^A-Za-z-]/g, "").slice(0, 8) || "en";
  const soft = p.style?.surface === "soft";
  const html = `<!doctype html><html lang="${esc(lang)}" data-ov-region="element"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(ctx.t("elementTitle"))}</title><style>:root{${tokensCss(p.style)}}${BASE}</style></head>` +
    `<body${soft ? ' class="soft"' : ""}><div id="stage"><figure id="p" data-ov-part="panel" role="status" aria-live="polite"><blockquote id="q" data-ov-part="quote"></blockquote>` +
    `<figcaption data-ov-part="footer"><span id="i" data-ov-part="avatar" aria-hidden="true"></span><span id="a" data-ov-part="author"></span><span id="s" data-ov-part="stars" role="img" hidden></span></figcaption></figure></div>` +
    `<script type="application/json" id="d">${data}</script><script>${SCRIPT}</script></body></html>`;
  return new Response(request.method === "HEAD" ? null : html, { headers: { ...HEADERS, "content-type": "text/html; charset=utf-8" } });
}

/** L'adresse d'un élément (chemin du site, sans secret : ce sont des avis publics). La langue demandée suit si elle est valable. */
export function elementAddress(ctx, id, request) {
  if (!ELEMENTS.includes(id)) return null;
  const lang = /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(String(request?.lang ?? "")) ? `?lang=${request.lang}` : "";
  return { url: `/m/${ctx.instance.key}/element/${id}${lang}` };
}
