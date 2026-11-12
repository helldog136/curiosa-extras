// Mascot: the ELEMENT offered to the overlay pages of the core (key `overlayElements`, core 0.5.0): "Mascot" (`mascot`), a REDUCED VERSION of the mascot of the site.
//
// What is NOT taken over, because it makes no sense in an overlay frame: everything that belongs to the display of a site page (corner, pages concerned, "once per visit", delay, number of
// messages a day, close / reduce to a badge / switch off for good, browser memory: localStorage, sessionStorage, cookies). The script of the mascot of the site (`mascot.js`, `client.mjs`)
// is never loaded here. The element uses neither browser storage nor cookie.
//
// What is taken over: the drawing (or the picture) and the name chosen in the module, and the SENTENCES. For a stream screen, the sentences come ONLY from what the owner wrote for the site:
//   - the published sentences of the "Sentences" tab (never a draft), in the requested language;
//   - with only two variables: {site_name} (the public name of the site) and {name} (the name of the mascot). A sentence that uses another variable (next event, live, news)
//     is not said: that information comes from other modules and is not words the person wrote for the mascot;
//   - never the news handed over by other modules (`mascot.hint`), never the topic `feed.item`, never an event, never a live;
//   - a sentence reserved for some pages of the site is not said (there is no page in an overlay frame).
// Mascot in draft (not published): the frame stays empty, as the pages of the site do not show it.
//
// SEVERAL READERS: nothing is consumed. The sentence of the moment is worked out from the TIME (slot = time / duration, sentence = list[slot % size]): all the overlay pages show the same sentence at the same moment.
// Reading is shared (kept `ttlMs`, one at a time); no background task.
//
// 1.2.0: animation (idle and talking), reading time, voice, "only while speaking". All of it lives in `motionPage` below and exists only when something is set: otherwise the page is
// byte for byte the page of 1.1.1.
const v = new URL(import.meta.url).search;
const M = await import(new URL(`./model.mjs${v}`, import.meta.url).href);
const S = await import(new URL(`./store.mjs${v}`, import.meta.url).href);
const F = await import(new URL(`./face.mjs${v}`, import.meta.url).href);
const P = await import(new URL(`./play.mjs${v}`, import.meta.url).href);
const { ovTransition, transitionConfig } = await import(new URL(`./transition.mjs${v}`, import.meta.url).href);

export const ELEMENTS = ["mascot"];
export const CACHE = { ttlMs: 30_000, failedTtlMs: 10_000, maxKeys: 20 };   // in an object so that the tests can shorten them
export const SECONDS = [4, 60, 10];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const int = (raw, [min, max, def]) => { const n = Math.trunc(Number(raw)); return Number.isFinite(n) && String(raw ?? "").trim() !== "" ? Math.min(max, Math.max(min, n)) : def; };

/** The parameters received (`ov-*` of the core, `opt-*` of the element), ALL checked again: an absurd value falls back to a safe default, an unknown one is ignored. */
export function readParams(params) {
  const get = (k) => params.get(k) ?? undefined;
  const style = params.has("ov-text") ? { text: get("ov-text") === "dark" ? "dark" : "light", surface: get("ov-surface") === "soft" ? "soft" : "transparent", corners: get("ov-corners") === "square" ? "square" : "round" } : null;
  return {
    style, demo: get("ov-demo") === "1", seconds: int(get("opt-seconds"), SECONDS),
    // 1.2.0: "always" (the default, as before) or "speaking" (hidden between two sentences); `test` is the panel of the administration preview, never used on stream.
    visibility: get("opt-visibility") === "speaking" ? "speaking" : "always", test: get("ov-test") === "1" && get("ov-demo") === "1",
    transitionIn: get("opt-transitionIn"), transitionOut: get("opt-transitionOut"),
  };
}

/** Common style -> --ov-* tokens (values of docs/OVERLAY-ELEMENTS.md). Without style (address opened by hand): light text, transparent background. */
export function tokensCss(style) {
  const light = style?.text !== "dark", soft = style?.surface === "soft";
  const border = soft ? (light ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.18)") : "transparent";
  return `--ov-fg:${light ? "#ffffff" : "#111111"};--ov-surface:${soft ? (light ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.7)") : "transparent"};--ov-radius:${style?.corners === "square" ? "0px" : "12px"};--ov-border:${border};`;
}

/**
 * The sentences the stream screen may say. PURE function: `phrases` are the sentences written by the person (store.mjs), `facts` holds only the name of the site and that of the mascot.
 * A sentence that needs anything else (a variable unknown here) is dropped by `fillText`.
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

/* ───────────────────────────── Shared read ───────────────────────────── */

const cache = new Map();   // "instance|language" -> { at, ttl, promise }
export const resetOverlayCache = () => cache.clear();

/** What moves and speaks (1.2.0): the two animations, the reading time and the voice, as the page needs them. Nothing configured gives the plain page of before. */
export function effects(ctx, config, name) {
  const idle = M.animForPage(config.anim.idle), talk = M.animForPage(config.anim.talk);
  const voice = M.voiceForPage(config.voice, ctx.setting("voiceFile"), ctx.locale);
  return { idle, talk, voice, reading: config.reading, alt: S.altFor(ctx, config) || name };
}

/** { published, name, image, lines, fx }: ONE read for all the readers of the instance (`ttlMs`), one at a time. Never throws. */
export function sharedMascot(ctx) {
  const key = `${ctx.instance?.key ?? ""}|${ctx.locale}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;
  const entry = { at: Date.now(), ttl: CACHE.ttlMs, promise: null };
  entry.promise = (async () => {
    try {
      const [config, phrases] = [await S.loadConfig(ctx), await S.loadPhrases(ctx)];
      const name = S.nameFor(ctx, config);
      const fx = effects(ctx, config, name);
      if (!config.published) return { published: false, name, image: null, lines: [], fx };
      const alt = S.altFor(ctx, config);
      const image = config.look === "image" && config.image && alt ? { src: config.image, alt, round: config.crop !== "square" } : null;
      const site = ctx.api.site ? await Promise.resolve().then(() => ctx.api.site(ctx.locale)).catch(() => null) : null;
      return { published: true, name, image, lines: ownLines(phrases, { lang: ctx.locale, defaultLang: ctx.defaultLocale, site: site?.name, name }), fx };
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
 * What the element shows. Test mode (`ov-demo=1`): when there is nothing to say (draft, no sentence that can be published), an EXAMPLE sentence with the included drawing — nothing that comes from the person.
 * Draft outside test mode: nothing at all.
 */
export async function contentFor(ctx, p) {
  const data = await sharedMascot(ctx);
  if (data.lines.length) return data;
  if (!p.demo) return { ...data, lines: [] };
  return { published: data.published, name: data.published ? data.name : ctx.t("defaultName"), image: data.published ? data.image : null, lines: [{ kind: "hello", text: ctx.t("elementDemo") }], fx: data.fx };
}

/* ───────────────────────────── The page of the element ───────────────────────────── */

// The drawing is the one of the module (face.mjs); its colours come from here and not from the theme of the site: an overlay frame never loads the skin of the site.
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

// The sentence of the moment is worked out from the time; the size of the text fits the frame; soft update, bounded (slower and slower when nothing changes, 300 times at most).
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

/* ─────────────── 1.2.0: the page that moves and speaks (only when something is set) ─────────────── */

const X_CSS = `
#w{display:flex;flex-direction:column;align-items:flex-start;flex:0 1 auto;min-height:0;max-width:100%;opacity:0;transform:translateY(8px);transition:opacity var(--tr-ms,.45s),transform var(--tr-ms,.45s)}
#w.on{opacity:1;transform:none}
#w[hidden]{display:none}
[data-ov-part="avatar"] img.an{object-fit:contain}
[data-ov-part="avatar"] img[hidden]{display:none}
[data-ov-part="avatar"].anim [data-mood]{display:none}
[data-ov-part="foot"]{position:absolute;bottom:8px;right:8px;max-width:52%;display:flex;flex-direction:column;gap:6px;align-items:stretch;padding:8px;border-radius:10px;font:13px/1.35 system-ui,sans-serif;background:rgba(255,255,255,.92);color:#1f2430;border:1px solid rgba(0,0,0,.2)}
[data-ov-part="foot"] button{min-height:44px;padding:6px 10px;font:inherit;font-weight:600;cursor:pointer;border-radius:8px;border:1px solid #3b4cca;background:#3b4cca;color:#fff}
[data-ov-part="foot"] button+button{background:#fff;color:#3b4cca}
[data-ov-part="foot"] button:focus-visible{outline:3px solid #f5a623;outline-offset:2px}
[data-ov-part="foot"] p{margin:0}
@media (prefers-color-scheme:dark){[data-ov-part="foot"]{background:rgba(24,26,34,.95);color:#f0f1f5;border-color:rgba(255,255,255,.25)}[data-ov-part="foot"] button{background:#8a97ff;border-color:#8a97ff;color:#10131c}[data-ov-part="foot"] button+button{background:transparent;color:#c8cfff}}
@media (prefers-reduced-motion:reduce){#w{transition:none;transform:none}}
`;

// Same rhythm as the plain page (the sentence of the moment comes from the clock, every reader says the same thing at the same time), plus: the talking animation and the voice last as long as the
// sentence is read (talkSeconds), then the idle animation comes back and, when the mascot is only visible while it speaks, it leaves. The sentence never outlives its slot.
const SCRIPT_X = `(function(){
var d=JSON.parse(document.getElementById('d').textContent),X=d.x,B=document.getElementById('b'),T=document.getElementById('t'),N=document.getElementById('n'),Y=document.getElementById('y'),A=document.getElementById('a'),W=document.getElementById('w'),AI=document.getElementById('ai'),
calm=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches),shown=null,cur='',token=0,endT=0,speaking=X.vis==='speaking',
Pl=mascotPlayer(AI,calm),V=X.voice.mode==='none'?null:mascotVoice(window,X.voice,blipPlan);
Pl.preload(X.idle);Pl.preload(X.talk);
function fit(){var size=24;T.style.fontSize=size+'px';var k=0;while(k++<40&&size>11&&B.scrollHeight>B.clientHeight+1){size-=1;T.style.fontSize=size+'px'}}
function anim(kind,restart){var key=kind==='talk'&&X.talk?'talk':'idle',s=key==='talk'?X.talk:X.idle;if(key===cur&&!(restart&&key==='talk'))return A.classList.contains('anim');cur=key;var ok=s?Pl.play(s,restart&&key==='talk'):false;A.classList.toggle('anim',ok);if(!ok)AI.hidden=true;return ok}
function secs(r){return Math.min(talkSeconds(r.text,X.cps,X.min,X.max),Math.max(1,d.seconds-0.6))}
function leave(){var t=++token;if(W.hidden)return;ovTransition(W,'out',X.tr.out,{ms:X.tr.ms,cls:'on',side:'bottom'}).then(function(){if(t===token)W.hidden=true})}
function enter(){++token;W.hidden=false;void W.offsetWidth;return ovTransition(W,'in',X.tr.in,{ms:X.tr.ms,cls:'on',side:'bottom'})}
function endTalk(){clearTimeout(endT);if(V)V.stop();A.classList.remove('talk');anim('idle',false);if(speaking)leave()}
function startTalk(r,elapsed,withVoice){var left=secs(r)-elapsed;clearTimeout(endT);if(left<=0){endTalk();return 0}
A.classList.add('talk');anim('talk',true);if(!X.talk){A.classList.remove('bob');void A.offsetWidth;A.classList.add('bob')}
if(V&&withVoice)V.say(r.text,left);endT=setTimeout(endTalk,left*1000);return left}
function fill(r){T.textContent=r.text;N.textContent=d.name;N.hidden=!d.name;A.setAttribute('data-mood',r.kind==='hello'?'happy':'curious');B.classList.add('on');Y.classList.add('on');fit()}
function show(){var l=d.lines;if(!l.length){B.classList.remove('on');Y.classList.remove('on');A.hidden=true;shown=null;if(speaking)W.hidden=true;return}
A.hidden=false;var ms=d.seconds*1000,now=Date.now(),idx=Math.floor(now/ms),r=l[idx%l.length],id=idx+JSON.stringify(r),el=(now-idx*ms)/1000;
if(id===shown)return;shown=id;
if(speaking){if(secs(r)-el<=0)return;fill(r);enter();startTalk(r,el,el<1.2);return}
var go=function(){fill(r);startTalk(r,Math.max(0,(Date.now()-idx*ms)/1000),el<1.2)};
if(B.classList.contains('on')){B.classList.remove('on');Y.classList.remove('on');setTimeout(go,450)}else go()}
function next(){var ms=d.seconds*1000;setTimeout(function(){show();next()},ms-(Date.now()%ms)+30)}
window.addEventListener('resize',fit);
if(V)document.addEventListener('click',function(){V.unlock()});
anim('idle',false);show();next();
if(X.test){var TP=document.getElementById('tp'),TV=document.getElementById('tv'),TN=document.getElementById('tn'),R=function(){var r=d.lines[0]||{kind:'hello',text:''};return r};
function report(){var r=R(),s=V?V.state():'none',k=s==='speech'?X.t.sSpeech.replace('{name}',V.voice()):X.t['s'+s.charAt(0).toUpperCase()+s.slice(1)]||'';
TN.textContent=(k?k+' ':'')+X.t.sRead.replace('{n}',Array.from(r.text).length).replace('{s}',talkSeconds(r.text,X.cps,X.min,X.max))}
TN.textContent=V?X.t.click:X.t.sNone;
TP.onclick=function(){var r=R();if(V)V.unlock();A.hidden=false;fill(r);if(W.hidden){enter()}startTalk(r,0,true);report()};
TV.onclick=function(){var r=R();if(!V){TN.textContent=X.t.sNone;return}V.unlock();V.say(r.text,talkSeconds(r.text,X.cps,X.min,X.max));report()}}
var u=location.pathname+location.search+(location.search?'&':'?')+'data=1',n=0,wait=60000;
function poll(){if(n++>=300)return;var x=new XMLHttpRequest();x.open('GET',u);x.responseType='json';x.timeout=15000;
function done(j){if(j&&Array.isArray(j.lines)){var same=JSON.stringify(j.lines)===JSON.stringify(d.lines)&&j.name===d.name;d.lines=j.lines;d.name=j.name;if(!same){wait=60000;show()}else wait=Math.min(600000,Math.round(wait*1.5))}else wait=Math.min(600000,wait*2);setTimeout(poll,wait)}
x.onload=function(){done(x.status===200?x.response:null)};x.onerror=x.ontimeout=function(){wait=Math.min(600000,wait*2);setTimeout(poll,wait)};x.send()}
setTimeout(poll,wait)})();`;

const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const HEADERS_X = { "cache-control": "no-store", "content-security-policy": CSP.replace("img-src 'self' https:;", "img-src 'self' https:; media-src 'self';"), "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
const HEADERS = { "cache-control": "no-store", "content-security-policy": CSP, "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };

const avatarHtml = (content) => content.image
  ? `<img class="${content.image.round ? "rd" : "sq"}" src="${esc(content.image.src)}" alt="${esc(content.image.alt)}">`
  : `<span data-mood="happy">${F.drawFace("happy")}</span><span data-mood="curious">${F.drawFace("curious")}</span>`;

/**
 * The answer of the route `element/:slug`. A whole page, or (with `data=1`) only the sentences, for the soft update.
 * Never a visible error: at worst, an empty frame.
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
  if (content.lines.length && needsMotion(p, content.fx)) return motionPage(request, ctx, p, content);
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

/** Does this page need the moving version? Only when something is set: an animation, a voice, "only while speaking" or the preview panel. Otherwise the plain page of before, byte for byte. */
export const needsMotion = (p, fx) => p.visibility === "speaking" || p.test || Boolean(fx && (fx.idle || fx.talk || fx.voice.mode !== "none"));

/** The page that moves and speaks (see SCRIPT_X). */
function motionPage(request, ctx, p, content) {
  const fx = content.fx;
  const r = M.readingOf(fx.reading);
  const tr = transitionConfig({ inOpt: p.transitionIn, inSetting: ctx.setting("transitionIn"), outOpt: p.transitionOut, outSetting: ctx.setting("transitionOut"), seconds: ctx.setting("transitionSeconds") }, 500);
  const x = { vis: p.visibility, tr, cps: M.SPEEDS[r.speed], min: r.min, max: r.max, idle: fx.idle, talk: fx.talk, voice: fx.voice, test: p.test };
  if (p.test) x.t = Object.fromEntries(["click", "sNone", "sBlips", "sSpeech", "sNospeech", "sCustom", "sBlocked", "sSilent", "sRead"].map((k) => [k, ctx.t(`test_${k}`)]));
  const data = JSON.stringify({ name: content.name, lines: content.lines, seconds: p.seconds, x }).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, " ");
  const lang = String(ctx.locale ?? "en").replace(/[^A-Za-z-]/g, "").slice(0, 8) || "en";
  const cls = p.style?.surface === "soft" ? "soft" : p.style?.text === "dark" ? "dark" : "";
  const hidden = p.visibility === "speaking";
  const avatar = `${avatarHtml(content)}<img id="ai" class="an" alt="${esc(fx.alt)}" hidden>`;
  const panel = p.test ? `<div data-ov-part="foot"><button type="button" id="tp">${esc(ctx.t("testPlay"))}</button><button type="button" id="tv">${esc(ctx.t("testVoice"))}</button><p id="tn" role="status" aria-live="polite"></p></div>` : "";
  const html = `<!doctype html><html lang="${esc(lang)}" class="${cls}" data-ov-region="element"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(ctx.t("elementTitle"))}</title><style>:root{${tokensCss(p.style)}--tr-ms:${tr.ms}ms}${BASE}${X_CSS}</style></head>` +
    `<body><div id="stage"><div id="w"${hidden ? " hidden" : ' class="on"'}><div id="b" data-ov-part="bubble" role="status" aria-live="polite"><p id="n" data-ov-part="name" hidden></p><p id="t" data-ov-part="text"></p></div>` +
    `<div id="y" data-ov-part="bubble-tail" aria-hidden="true"></div>` +
    `<div id="a" data-ov-part="avatar" data-mood="happy">${avatar}</div></div>${panel}</div>` +
    `<script type="application/json" id="d">${data}</script><script>${[ovTransition, M.talkSeconds, M.blipPlan, P.mascotPlayer, P.mascotVoice].map((f) => f.toString()).join("\n")}\n${SCRIPT_X}</script></body></html>`;
  return new Response(request.method === "HEAD" ? null : html, { headers: { ...HEADERS_X, "content-type": "text/html; charset=utf-8" } });
}

/** The address of an element (path of the site, no secret: nothing private goes through this page). The requested language follows when it is valid. */
export function elementAddress(ctx, id, request) {
  if (!ELEMENTS.includes(id)) return null;
  const lang = /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(String(request?.lang ?? "")) ? `?lang=${request.lang}` : "";
  return { url: `/m/${ctx.instance.key}/element/${id}${lang}` };
}
