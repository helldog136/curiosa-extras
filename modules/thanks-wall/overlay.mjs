// Mur des remerciements — l'ÉLÉMENT « Remerciements » proposé aux pages d'overlay du cœur (clé `overlayElements`, cœur 0.5.0) : les dernières personnes à remercier, qui défilent, pour OBS.
//
// RIEN DE PLUS QUE LE MUR PUBLIC. Les personnes viennent de la MÊME lecture que la page publique (`getWall`, contacts.mjs) : mêmes catégories, même règle « Ne pas montrer », mêmes fiches
// « à relire » écartées, même choix de nom (comme sur la fiche, prénom seulement ou pseudo) et mêmes petits mots (data.mjs). L'élément n'en tire que le NOM montré, les initiales et le petit mot :
// jamais un identifiant de fiche dans la page, jamais d'e-mail ni de compte, et AUCUNE PHOTO (rien n'est chargé chez un tiers : un rond d'initiales à la place). L'adresse est publique (pas de secret).
//
// Plusieurs lecteurs : la lecture du mur est déjà partagée (une reconstruction à la fois, 2 minutes) ; ce fichier ajoute une petite mémoire de `ttlMs` pour que tous les lecteurs d'une instance
// se partagent aussi le calcul. Rien n'est consommé ni retenu par lecteur. Aucune tâche de fond ; la page s'interroge elle-même, de plus en plus lentement quand rien ne change.
// Le défilement est une animation CSS ajoutée par la page quand la liste dépasse le cadre. Style : jetons --ov-* et attributs data-ov-part ; jamais le skin du site.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins
const P = await import(`./pure.mjs${v}`);
const C = await import(`./contacts.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const View = await import(`./view.mjs${v}`);

export const ELEMENTS = ["thanks"];
export const GROUPS = ["all", "1", "2", "3", "4", "5", "6"];
export const CACHE = { ttlMs: 30_000, failedTtlMs: 8_000, maxKeys: 20 };   // dans un objet pour que les tests puissent les raccourcir
export const MAX_PEOPLE = 30;

const int = (x, min, max, def) => { const n = Math.trunc(Number(x)); return Number.isFinite(n) && String(x ?? "").trim() !== "" ? Math.min(max, Math.max(min, n)) : def; };
const bool = (x, def) => (x === "1" ? true : x === "0" ? false : def);

/** Les paramètres reçus (`ov-*` du cœur, `opt-*` de l'élément), TOUS validés : une valeur absurde ou inconnue retombe sur le défaut. */
export function readParams(params) {
  const get = (k) => params.get(k) ?? undefined;
  const group = get("opt-group");
  return {
    width: int(get("ov-w"), 16, 7680, 500), height: int(get("ov-h"), 16, 7680, 600),
    style: params.has("ov-text") ? { text: get("ov-text") === "dark" ? "dark" : "light", surface: get("ov-surface") === "soft" ? "soft" : "transparent", corners: get("ov-corners") === "square" ? "square" : "round" } : null,
    demo: get("ov-demo") === "1", group: GROUPS.includes(group) ? group : "all", count: int(get("opt-count"), 1, MAX_PEOPLE, 10),
    scroll: bool(get("opt-scroll"), true), messages: bool(get("opt-messages"), true),
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

/**
 * Ce qu'on a le droit de montrer, du plus récent au plus ancien, par groupe : [{ n, title, people: [{ id, shown, texts }] }] (30 personnes au plus par groupe).
 * Le mur et les petits mots sont ceux de la page publique ; un mur pas prêt, ou que Contacts ne peut pas donner, ne montre personne. Ne lève jamais.
 */
async function readGroups(ctx) {
  const wall = await C.getWall(ctx);
  if (wall.state !== "ok") return [];
  const display = View.displayOf(ctx);
  const data = await D.readData(ctx).catch(() => ({ messages: new Map() }));
  return wall.groups.filter((g) => !g.problem).map((g) => ({
    n: g.n, title: g.title,
    // Contacts rend la fiche la plus ancienne d'abord : « les dernières personnes » sont donc les dernières de la liste.
    people: [...g.people].reverse().slice(0, MAX_PEOPLE).map((p) => ({ id: p.id, shown: P.shownName(p, display.style), texts: data.messages.get(p.id)?.texts ?? null })),
  })).filter((g) => g.people.length);
}

/** UNE lecture partagée par tous les lecteurs de l'instance, et une seule à la fois (les demandes simultanées attendent la même promesse). */
export function sharedGroups(ctx) {
  const key = ctx.instance?.id ?? ctx.instance?.key ?? "";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;
  const entry = { at: Date.now(), ttl: CACHE.ttlMs, promise: null };
  entry.promise = readGroups(ctx).catch(() => { entry.ttl = CACHE.failedTtlMs; return []; });
  cache.set(key, entry);
  while (cache.size > CACHE.maxKeys) cache.delete(cache.keys().next().value);
  return entry.promise;
}

/** Les personnes à montrer : le groupe choisi, ou tous les groupes tour à tour (une personne rangée dans deux groupes n'apparaît qu'une fois), `count` au plus. Pur. */
export function pick(groups, p) {
  const chosen = p.group === "all" ? groups : groups.filter((g) => String(g.n) === p.group);
  const out = [], seen = new Set();
  for (let i = 0; out.length < p.count; i++) {
    let any = false;
    for (const g of chosen) {
      const person = g.people[i];
      if (!person) continue;
      any = true;
      if (seen.has(person.id)) continue;
      seen.add(person.id);
      if (out.length < p.count) out.push(person);
    }
    if (!any) break;
  }
  return { people: out, title: p.group !== "all" ? chosen[0]?.title ?? "" : "" };
}

/* ───────────────────────────── Rendu ───────────────────────────── */

const esc = P.esc;
/** Le contenu : pur (même entrée, même sortie). `groups` : ce que `sharedGroups` rend (déjà limité à ce que montre le mur public). */
export function renderContent(ctx, p, groups) {
  let { people, title } = pick(groups ?? [], p);
  if (!people.length) {
    if (!p.demo) return "";   // en direct : un cadre vide et silencieux
    people = Array.from({ length: p.count }, (_, i) => ({ shown: ctx.t("ovDemoName", { n: i + 1 }), texts: i % 2 === 0 ? { [ctx.locale]: ctx.t("ovDemoMessage") } : null }));
    title = "";
  }
  const horizontal = p.width >= p.height * 2.5;
  const head = !horizontal && p.height >= 160 ? `<p data-ov-part="title" class="tw-head">${esc(title || ctx.t("ovHeading"))}</p>` : "";
  const headPx = head ? 44 : 0;
  // L'unité de taille : le texte suit le cadre (une rangée de ~6 personnes en hauteur, ou ~11 « lettres » de large), entre 14 et 44 pixels.
  const u = Math.max(14, Math.min(44, Math.floor(Math.min(horizontal ? (p.height - 24) / 2.6 : (p.height - headPx - 24) / (p.messages ? 5 : 6), (p.width - 24) / (horizontal ? 8 : 11)))));
  const items = people.map((x) => {
    const msg = p.messages ? P.clean(P.pickText(x.texts, ctx.locale, ctx.defaultLocale), P.LIMITS.message) : "";
    return `<li data-ov-part="person" class="tw-item"><span data-ov-part="avatar" class="tw-av" aria-hidden="true">${esc(P.initials(x.shown))}</span><span class="tw-txt"><span data-ov-part="name" class="tw-name">${esc(x.shown)}</span>${msg ? `<span data-ov-part="message" class="tw-msg">${esc(msg)}</span>` : ""}</span></li>`;
  }).join("");
  return `${head}<div class="tw-view" data-ov-part="view"><div class="tw-track" data-ov-part="track" data-dir="${horizontal ? "h" : "v"}" data-scroll="${p.scroll ? "1" : "0"}" style="--u:${u}px"><ul class="tw-list" data-ov-part="list">${items}</ul></div></div>`;
}

const BASE = `
html,body{margin:0;height:100%;overflow:hidden;background:transparent}
body{font:600 16px/1.25 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ov-fg,#fff)}
body.ov-shadow{text-shadow:0 1px 3px rgba(0,0,0,.55)}
#p{box-sizing:border-box;height:100%;overflow:hidden;padding:12px;background:var(--ov-surface,transparent);border:1px solid var(--ov-border,transparent);border-radius:var(--ov-radius,0)}
#r{height:100%;display:flex;flex-direction:column;gap:8px}
.tw-head{margin:0;flex:0 0 auto;font-size:clamp(14px,4.2vmin,30px);font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:color-mix(in srgb,var(--ov-fg,#fff) 78%,transparent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tw-view{flex:1 1 0;min-height:0;min-width:0;overflow:hidden}
.tw-track{display:flex;flex-direction:column;will-change:transform}
.tw-track[data-dir="h"]{flex-direction:row;height:100%;align-items:center;width:max-content}
.tw-list{flex:0 0 auto;margin:0;padding:0 0 calc(var(--u) * .5);list-style:none;display:flex;flex-direction:column;gap:calc(var(--u) * .5)}
.tw-track[data-dir="h"] .tw-list{flex-direction:row;padding:0 calc(var(--u) * .5) 0 0;gap:calc(var(--u) * .9);align-items:center}
.tw-item{display:flex;align-items:center;gap:calc(var(--u) * .5);min-width:0;font-size:var(--u);line-height:1.15}
.tw-av{flex:0 0 auto;box-sizing:border-box;width:calc(var(--u) * 1.9);height:calc(var(--u) * 1.9);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:calc(var(--u) * .8);font-weight:800;
 background:color-mix(in srgb,var(--ov-fg,#fff) 14%,transparent);border:1px solid color-mix(in srgb,var(--ov-fg,#fff) 30%,transparent)}
.tw-txt{display:flex;flex-direction:column;min-width:0}
.tw-name{font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tw-msg{font-size:.62em;font-weight:600;color:color-mix(in srgb,var(--ov-fg,#fff) 78%,transparent);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.tw-track[data-dir="h"] .tw-name,.tw-track[data-dir="h"] .tw-msg{white-space:nowrap;max-width:16em;display:block;overflow:hidden;text-overflow:ellipsis}
@keyframes tw-y{from{transform:translateY(0)}to{transform:translateY(calc(var(--len) * -1))}}
@keyframes tw-x{from{transform:translateX(0)}to{transform:translateX(calc(var(--len) * -1))}}
`;

// Le défilement : seulement si la liste dépasse le cadre ET que l'option est active. On double la liste (la copie est cachée aux lecteurs d'écran) et on la fait glisser d'une longueur de liste, en boucle.
const SCRIPT = `(function(){var R=document.getElementById('r'),u=location.pathname+location.search+(location.search?'&':'?')+'frag=1',v=R.getAttribute('data-v'),n=0,wait=120000;
function fit(){var t=R.querySelector('.tw-track');if(!t)return;var d=t.querySelector('[data-dup]');if(d)d.remove();t.style.animation='none';var w=t.parentNode,h=t.getAttribute('data-dir')==='h',l=t.firstElementChild;
var len=h?l.offsetWidth:l.offsetHeight,room=h?w.clientWidth:w.clientHeight;if(t.getAttribute('data-scroll')!=='1'||len<=room+1){t.style.animation='';return}
var c=l.cloneNode(true);c.setAttribute('data-dup','1');c.setAttribute('aria-hidden','true');t.appendChild(c);t.style.setProperty('--len',len+'px');t.style.animation='tw-'+(h?'x':'y')+' '+Math.max(10,Math.round(len/45))+'s linear infinite'}
function poll(){if(n++>=200)return;fetch(u,{credentials:'omit',cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(j){
if(j&&j.v!==v){v=j.v;R.innerHTML=j.html;R.setAttribute('data-v',v);wait=120000;fit()}else wait=Math.min(900000,Math.round(wait*1.5))}).catch(function(){wait=Math.min(900000,wait*2)}).then(function(){setTimeout(poll,wait)})}
fit();setTimeout(poll,wait)})();`;

const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };

/** La réponse de la route `element/:slug` : une page entière, ou (avec `frag=1`) le contenu et son empreinte. Jamais d'erreur visible : au pire, un cadre vide. */
export async function elementResponse(request, ctx) {
  if (!ELEMENTS.includes(ctx.params?.slug)) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const p = readParams(url.searchParams);
  let content = "";
  try { content = renderContent(ctx, p, await sharedGroups(ctx)); } catch { content = ""; }
  const vv = hash(content);
  const headers = { "cache-control": "no-store", "content-security-policy": CSP, "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
  if (url.searchParams.get("frag") === "1") return Response.json({ v: vv, html: content }, { headers });
  const lang = String(ctx.locale ?? "en").replace(/[^A-Za-z-]/g, "").slice(0, 8) || "en";
  const shadow = p.style?.text !== "dark" && p.style?.surface !== "soft";
  const html = `<!doctype html><html lang="${esc(lang)}" data-ov-region="element"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(ctx.t("ovTitle"))}</title><style>:root{${tokensCss(p.style)}}${BASE}</style></head>` +
    `<body${shadow ? ' class="ov-shadow"' : ""}><div id="p" data-ov-part="panel"><div id="r" data-ov-part="content" data-v="${esc(vv)}">${content}</div></div><script>${SCRIPT}</script></body></html>`;
  return new Response(html, { headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
}

/** L'adresse d'un élément : un chemin du site, sans secret (la page ne donne que ce que le mur public montre déjà). */
export function elementAddress(ctx, id, request) {
  if (!ELEMENTS.includes(id)) return null;
  const lang = /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(String(request?.lang ?? "")) ? `?lang=${request.lang}` : "";
  return { url: `/m/${ctx.instance.key}/element/${id}${lang}` };
}
