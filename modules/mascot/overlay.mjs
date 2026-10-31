// Mascotte : l'ÉLÉMENT proposé aux pages d'overlay du cœur (clé `overlayElements`, cœur 0.5.0) : « Mascotte » (`mascot`), une VERSION RÉDUITE de la mascotte du site.
//
// Ce qui n'est PAS repris, parce que cela n'a pas de sens dans un cadre d'overlay : tout ce qui tient à l'affichage d'une page de site (coin de page, pages concernées, « une fois par visite »,
// délai, nombre de messages par jour, fermer / réduire en pastille / couper pour toujours, mémoire du navigateur : localStorage, sessionStorage, cookies). Le script de la mascotte du site
// (`mascot.js`, `client.mjs`) n'est jamais chargé ici. L'élément n'utilise ni stockage du navigateur ni cookie.
//
// Ce qui est repris : le dessin (ou l'image) et le nom choisis dans le module, et les PHRASES. Pour un écran de stream, les phrases ne viennent QUE de ce que la personne propriétaire a écrit pour son site :
//   - les phrases publiées de l'onglet « Phrases » (jamais un brouillon), dans la langue demandée ;
//   - avec seulement deux variables : {nom_du_site} (le nom public du site) et {nom} (le nom de la mascotte). Une phrase qui emploie une autre variable (prochain événement, direct, nouveauté)
//     n'est pas dite : ces informations viennent d'autres modules et ne sont pas des mots écrits par la personne pour la mascotte ;
//   - jamais les nouveautés confiées par d'autres modules (`mascot.hint`), jamais le sujet `feed.item`, jamais un événement, jamais un direct ;
//   - une phrase réservée à certaines pages du site n'est pas dite (il n'y a pas de page dans un cadre d'overlay).
// Mascotte en brouillon (pas publiée) : le cadre reste vide, comme les pages du site ne la montrent pas.
//
// PLUSIEURS LECTEURS : rien n'est consommé. La phrase du moment se déduit de l'HEURE (créneau = heure / durée, phrase = liste[créneau % taille]) : toutes les pages d'overlay affichent la même phrase au même instant.
// La lecture est partagée (gardée `ttlMs`, une seule à la fois) ; aucune tâche de fond.
const v = new URL(import.meta.url).search;
const M = await import(new URL(`./model.mjs${v}`, import.meta.url).href);
const S = await import(new URL(`./store.mjs${v}`, import.meta.url).href);
const F = await import(new URL(`./face.mjs${v}`, import.meta.url).href);

export const ELEMENTS = ["mascot"];
export const CACHE = { ttlMs: 30_000, failedTtlMs: 10_000, maxKeys: 20 };   // dans un objet pour que les tests puissent les raccourcir
export const SECONDS = [4, 60, 10];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const int = (raw, [min, max, def]) => { const n = Math.trunc(Number(raw)); return Number.isFinite(n) && String(raw ?? "").trim() !== "" ? Math.min(max, Math.max(min, n)) : def; };

/** Les paramètres reçus (`ov-*` du cœur, `opt-*` de l'élément), TOUS revalidés : une valeur absurde retombe sur un défaut sûr, une inconnue est ignorée. */
export function readParams(params) {
  const get = (k) => params.get(k) ?? undefined;
  const style = params.has("ov-text") ? { text: get("ov-text") === "dark" ? "dark" : "light", surface: get("ov-surface") === "soft" ? "soft" : "transparent", corners: get("ov-corners") === "square" ? "square" : "round" } : null;
  return { style, demo: get("ov-demo") === "1", seconds: int(get("opt-seconds"), SECONDS) };
}

/** Style commun -> jetons --ov-* (valeurs de docs/OVERLAY-ELEMENTS.md). Sans style (adresse ouverte à la main) : texte clair, fond transparent. */
export function tokensCss(style) {
  const light = style?.text !== "dark", soft = style?.surface === "soft";
  const border = soft ? (light ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.18)") : "transparent";
  return `--ov-fg:${light ? "#ffffff" : "#111111"};--ov-surface:${soft ? (light ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.7)") : "transparent"};--ov-radius:${style?.corners === "square" ? "0px" : "12px"};--ov-border:${border};`;
}

/**
 * Les phrases que l'écran de stream a le droit de dire. Fonction PURE : `phrases` sont les phrases écrites par la personne (store.mjs), `facts` ne contient que le nom du site et celui de la mascotte.
 * Une phrase qui a besoin d'autre chose (variable inconnue d'ici) est écartée par `fillText`.
 */
export function ownLines(phrases, { lang, defaultLang, site, name }) {
  const published = phrases.filter((p) => p.state === "published" && p.pages.length === 0);
  const own = published.filter((p) => p.lang === "" || p.lang === lang);
  const pool = own.length ? own : published.filter((p) => p.lang === "" || p.lang === defaultLang);
  const facts = { site: M.outside(site, 80), name };
  const out = [];
  for (const p of pool) {
    const text = M.fillText(p.text, facts);
    if (text !== null && text) out.push({ kind: p.kind === "hello" ? "hello" : p.kind === "news" ? "news" : "tip", text: text.slice(0, M.LIMITS.line) });
    if (out.length >= M.LIMITS.items) break;
  }
  return out;
}

/* ───────────────────────────── Lecture partagée ───────────────────────────── */

const cache = new Map();   // « instance|langue » -> { at, ttl, promise }
export const resetOverlayCache = () => cache.clear();

/** { published, name, image, lines } : UNE lecture pour tous les lecteurs de l'instance (`ttlMs`), une seule à la fois. Ne lève jamais. */
export function sharedMascot(ctx) {
  const key = `${ctx.instance?.key ?? ""}|${ctx.locale}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;
  const entry = { at: Date.now(), ttl: CACHE.ttlMs, promise: null };
  entry.promise = (async () => {
    try {
      const [config, phrases] = [await S.loadConfig(ctx), await S.loadPhrases(ctx)];
      const name = S.nameFor(ctx, config);
      if (!config.published) return { published: false, name, image: null, lines: [] };
      const alt = S.altFor(ctx, config);
      const image = config.look === "image" && config.image && alt ? { src: config.image, alt, round: config.crop !== "square" } : null;
      const site = ctx.api.site ? await Promise.resolve().then(() => ctx.api.site(ctx.locale)).catch(() => null) : null;
      return { published: true, name, image, lines: ownLines(phrases, { lang: ctx.locale, defaultLang: ctx.defaultLocale, site: site?.name, name }) };
    } catch {
      entry.ttl = CACHE.failedTtlMs;
      return hit ? hit.promise : { published: false, name: "", image: null, lines: [] };
    }
  })();
  cache.set(key, entry);
  while (cache.size > CACHE.maxKeys) cache.delete(cache.keys().next().value);
  return entry.promise;
}

/**
 * Ce que montre l'élément. Mode test (`ov-demo=1`) : s'il n'y a rien à dire (brouillon, aucune phrase publiable), une phrase d'EXEMPLE avec le dessin inclus — rien qui vienne de la personne.
 * Brouillon hors mode test : rien du tout.
 */
export async function contentFor(ctx, p) {
  const data = await sharedMascot(ctx);
  if (data.lines.length) return data;
  if (!p.demo) return { ...data, lines: [] };
  return { published: data.published, name: data.published ? data.name : ctx.t("defaultName"), image: data.published ? data.image : null, lines: [{ kind: "hello", text: ctx.t("elementDemo") }] };
}

/* ───────────────────────────── La page de l'élément ───────────────────────────── */

// Le dessin est celui du module (face.mjs) ; ses couleurs viennent d'ici et pas du thème du site : un cadre d'overlay ne charge jamais le skin du site.
const BASE = `
html,body{margin:0;height:100%;overflow:hidden;background:transparent}
body{font:16px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ov-fg,#fff)}
:root{--mc-bubble:rgba(0,0,0,.6);--mc-bubble-line:rgba(255,255,255,.22);--mc-body:#7c6bf0;--mc-tuft:#41b48a;--mc-face:#ffffff;--mc-ink:#1f2430}
:root.dark{--mc-bubble:rgba(255,255,255,.85);--mc-bubble-line:rgba(0,0,0,.2)}
:root.soft{--mc-bubble:var(--ov-surface,rgba(0,0,0,.55));--mc-bubble-line:var(--ov-border,rgba(255,255,255,.18))}
#stage{position:fixed;inset:0;box-sizing:border-box;padding:8px;display:flex;flex-direction:column;justify-content:flex-end;align-items:flex-start}
[data-ov-part="bubble"]{position:relative;box-sizing:border-box;flex:0 1 auto;min-height:0;max-width:100%;padding:12px 18px;overflow:hidden;background:var(--mc-bubble);border:1px solid var(--mc-bubble-line);
  border-radius:var(--ov-radius,12px);opacity:0;transition:opacity .45s}
[data-ov-part="bubble"].on{opacity:1}
[data-ov-part="bubble-tail"]{flex:none;width:0;height:0;margin:0 0 0 44px;border-left:10px solid transparent;border-right:10px solid transparent;border-top:12px solid var(--mc-bubble);opacity:0;transition:opacity .45s}
[data-ov-part="bubble-tail"].on{opacity:1}
[data-ov-part="name"]{margin:0 0 3px;font-size:15px;font-weight:700;opacity:.8}
[data-ov-part="text"]{margin:0;font-size:24px;line-height:1.3;overflow-wrap:anywhere}
[data-ov-part="avatar"]{flex:none;position:relative;width:116px;height:116px;margin:4px 0 0 12px}
[data-ov-part="avatar"] svg,[data-ov-part="avatar"] img{display:block;width:100%;height:100%}
[data-ov-part="avatar"] img{object-fit:cover}
[data-ov-part="avatar"] img.sq{border-radius:var(--ov-radius,12px)}
[data-ov-part="avatar"] img.rd{border-radius:50%}
[data-ov-part="avatar"] [data-mood]{display:none;width:100%;height:100%}
[data-ov-part="avatar"][data-mood="happy"] [data-mood="happy"],[data-ov-part="avatar"][data-mood="curious"] [data-mood="curious"]{display:block}
.mc-b{fill:var(--mc-body);stroke:rgba(0,0,0,.28);stroke-width:1}
.mc-t{fill:var(--mc-tuft)}
.mc-s{fill:var(--mc-face)}
.mc-f{fill:var(--mc-ink)}
.mc-l{fill:none;stroke:var(--mc-ink);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.mc-c{fill:var(--mc-tuft);opacity:.45}
@media (prefers-reduced-motion:no-preference){[data-ov-part="avatar"].bob{animation:mc-bob 1.2s ease-in-out 1}}
@keyframes mc-bob{0%,100%{transform:rotate(0)}25%{transform:rotate(-7deg)}60%{transform:rotate(5deg)}}
@media (prefers-reduced-motion:reduce){[data-ov-part="bubble"],[data-ov-part="bubble-tail"]{transition:none}}
`;

// La phrase du moment se déduit de l'heure ; la taille du texte s'ajuste au cadre ; mise à jour douce et bornée (de plus en plus lente quand rien ne change, 300 fois au plus).
const SCRIPT = `(function(){
var d=JSON.parse(document.getElementById('d').textContent),B=document.getElementById('b'),T=document.getElementById('t'),N=document.getElementById('n'),Y=document.getElementById('y'),A=document.getElementById('a'),shown=null;
function fit(){var size=24;T.style.fontSize=size+'px';var k=0;while(k++<40&&size>11&&B.scrollHeight>B.clientHeight+1){size-=1;T.style.fontSize=size+'px'}}
function show(){var l=d.lines;if(!l.length){B.classList.remove('on');Y.classList.remove('on');A.hidden=true;shown=null;return}A.hidden=false;
var ms=d.seconds*1000,r=l[Math.floor(Date.now()/ms)%l.length],id=JSON.stringify(r);if(id===shown&&B.classList.contains('on'))return;
var swap=function(){T.textContent=r.text;N.textContent=d.name;N.hidden=!d.name;A.setAttribute('data-mood',r.kind==='hello'?'happy':'curious');
B.classList.add('on');Y.classList.add('on');fit();A.classList.remove('bob');void A.offsetWidth;A.classList.add('bob')};
shown=id;if(B.classList.contains('on')){B.classList.remove('on');Y.classList.remove('on');setTimeout(swap,450)}else swap()}
function next(){var ms=d.seconds*1000;setTimeout(function(){show();next()},ms-(Date.now()%ms)+30)}
window.addEventListener('resize',fit);show();next();
var u=location.pathname+location.search+(location.search?'&':'?')+'data=1',n=0,wait=60000;
function poll(){if(n++>=300)return;var x=new XMLHttpRequest();x.open('GET',u);x.responseType='json';x.timeout=15000;
function done(j){if(j&&Array.isArray(j.lines)){var same=JSON.stringify(j.lines)===JSON.stringify(d.lines)&&j.name===d.name;d.lines=j.lines;d.name=j.name;if(!same){wait=60000;show()}else wait=Math.min(600000,Math.round(wait*1.5))}else wait=Math.min(600000,wait*2);setTimeout(poll,wait)}
x.onload=function(){done(x.status===200?x.response:null)};x.onerror=x.ontimeout=function(){wait=Math.min(600000,wait*2);setTimeout(poll,wait)};x.send()}
setTimeout(poll,wait)})();`;

const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const HEADERS = { "cache-control": "no-store", "content-security-policy": CSP, "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };

const avatarHtml = (content) => content.image
  ? `<img class="${content.image.round ? "rd" : "sq"}" src="${esc(content.image.src)}" alt="${esc(content.image.alt)}">`
  : `<span data-mood="happy">${F.drawFace("happy")}</span><span data-mood="curious">${F.drawFace("curious")}</span>`;

/**
 * La réponse de la route `element/:slug`. Une page entière, ou (avec `data=1`) seulement les phrases, pour la mise à jour douce.
 * Jamais d'erreur visible : au pire, un cadre vide.
 */
export async function elementResponse(request, ctx) {
  const slug = ctx.params?.slug;
  if (!ELEMENTS.includes(slug)) return new Response("Not found", { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  const url = new URL(request.url);
  const p = readParams(url.searchParams);
  let content = { published: false, name: "", image: null, lines: [] };
  try { content = await contentFor(ctx, p); } catch { /* cadre vide */ }
  if (url.searchParams.get("data") === "1") return Response.json({ name: content.name, lines: content.lines }, { headers: HEADERS });
  const data = JSON.stringify({ name: content.name, lines: content.lines, seconds: p.seconds }).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, " ");
  const lang = String(ctx.locale ?? "en").replace(/[^A-Za-z-]/g, "").slice(0, 8) || "en";
  const cls = p.style?.surface === "soft" ? "soft" : p.style?.text === "dark" ? "dark" : "";
  const html = `<!doctype html><html lang="${esc(lang)}" class="${cls}" data-ov-region="element"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(ctx.t("elementTitle"))}</title><style>:root{${tokensCss(p.style)}}${BASE}</style></head>` +
    `<body><div id="stage"><div id="b" data-ov-part="bubble" role="status" aria-live="polite"><p id="n" data-ov-part="name" hidden></p><p id="t" data-ov-part="text"></p></div>` +
    `<div id="y" data-ov-part="bubble-tail" aria-hidden="true"></div>` +
    `<div id="a" data-ov-part="avatar" data-mood="happy"${content.lines.length ? "" : " hidden"}>${avatarHtml(content)}</div></div>` +
    `<script type="application/json" id="d">${data}</script><script>${SCRIPT}</script></body></html>`;
  return new Response(request.method === "HEAD" ? null : html, { headers: { ...HEADERS, "content-type": "text/html; charset=utf-8" } });
}

/** L'adresse d'un élément (chemin du site, sans secret : rien de privé ne passe par cette page). La langue demandée suit si elle est valable. */
export function elementAddress(ctx, id, request) {
  if (!ELEMENTS.includes(id)) return null;
  const lang = /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(String(request?.lang ?? "")) ? `?lang=${request.lang}` : "";
  return { url: `/m/${ctx.instance.key}/element/${id}${lang}` };
}
