// Overlay sponsors (OBS) — module communautaire de Curiosa. Porté du bandeau « lower third » de
// Un bandeau existant : carte à découpe diagonale qui glisse depuis la droite, légère flottaison, QR code.
//
// Il ne connaît aucun module : il digère le sujet « sponsor.card » (fourni par le module Sponsors)
// ou « core.entry » (n'importe quelle liste de codes promo / d'articles). Les QR codes sont générés par
// le cœur (ctx.api.qr).
const color = (v, def) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : def);
const num = (v, def, min, max) => Math.min(max, Math.max(min, Number(v) || def));
const safeImage = (v) => (typeof v === "string" && /^(https?:\/\/|\/uploads\/)/.test(v) ? v : null);

// Mode développeur : ?dev=1&seed=N — ignoré tant que le réglage n'est pas activé.
function devOptions(query) {
  const seed = query.get("seed");
  return { fast: query.get("dev") === "1", seed: seed !== null && Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : null };
}

// ── Aides pures (aussi recopiées dans le script de la page : voir `script` plus bas) ──────────────
/** Taille du titre. `natural` = largeur du titre sur UNE ligne à 22 px, `maxW` = largeur de la colonne de texte.
 *  Il tient → 22 px ; sinon on le réduit jusqu'à 18 px sur une ligne ; sinon 2 lignes (réduites jusqu'à 16 px) ; au-delà, points de suspension. */
export function fitTitle(natural, maxW) {
  if (!(natural > 0) || !(maxW > 0) || natural <= maxW) return { size: 22, lines: 1 };
  const one = Math.floor(((22 * maxW) / natural) * 2) / 2;
  if (one >= 18) return { size: one, lines: 1 };
  const two = Math.floor(((22 * 1.7 * maxW) / natural) * 2) / 2;
  return { size: Math.min(22, Math.max(16, two)), lines: 2 };
}
/** Échelle de la carte pour qu'elle tienne dans la source navigateur (marge de 2 % de chaque côté) ; jamais plus de 1. */
export function fitScale(cardW, cardH, viewW, viewH) {
  if (!(cardW > 0) || !(cardH > 0) || !(viewW > 0) || !(viewH > 0)) return 1;
  return Math.max(0.05, Math.floor(Math.min(1, (viewW * 0.96) / cardW, (viewH * 0.96) / cardH) * 1000) / 1000);
}
/** Légende du QR : nom de domaine lisible, sans « www. » ; trop long (> max), coupé au milieu en gardant le début et la fin (« .com »). */
export function shortDomain(url, max = 22) {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./i, ""); } catch (e) { return ""; }
  if (host.length <= max) return host;
  const tail = 9;
  return host.slice(0, max - tail - 1) + "\u2026" + host.slice(-tail);
}

/** Texte posé sur la couleur d'accent : noir ou blanc, le plus contrasté (utile quand l'accent est choisi à la main, donc hors thème). */
export function onAccent(hex) {
  const lum = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const l = lum(hex);
  return (l + 0.05) / (0.0056 + 0.05) >= 1.05 / (l + 0.05) ? "#111111" : "#ffffff";
}

const safeLink = (v) => (typeof v === "string" && /^(https?:\/\/|\/(?!\/))/i.test(v.trim()) ? v.trim() : null);

export default {
  routes: {
    // JSON rafraîchi par la page de l'overlay : l'état courant, rien n'est mis en cache côté serveur.
    async items(_request, ctx) {
      const site = ctx.api.siteUrl;
      const [cards, entries] = await Promise.all([ctx.api.topics.collect("sponsor.card", { limit: 60 }), ctx.api.topics.collect("core.entry", { limit: 60 })]);
      const raw = [
        ...cards.map((c) => ({ id: `s:${c.id ?? c.name}`, name: String(c.name), text: String(c.text ?? ""), url: safeLink(c.url), code: c.code ?? null, logo: safeImage(c.logo), publishedAt: c.publishedAt ?? null })),
        // Les entrées sans code ni lien ne sont pas des sponsors : on ne garde que ce qui a de quoi être montré.
        ...entries.filter((e) => e.code || e.url).map((e) => ({ id: `e:${e.path}`, name: String(e.title), text: String(e.summary ?? ""), url: safeLink(e.url) ?? `${site}${e.path}`, code: e.code ?? null, logo: safeImage(e.cover), publishedAt: e.publishedAt ?? null })),
      ];
      const items = await Promise.all(raw.map(async (i) => ({ ...i, qrSvg: i.url ? await ctx.api.qr(i.url) : null })));
      return Response.json({ items }, { headers: { "cache-control": "no-store" } });
    },
  },

  overlay(ctx, { query }) {
    const dev = ctx.setting("devMode") ? devOptions(query) : null;
    const cfg = {
      itemsUrl: `/m/${ctx.instance.key}/items?lang=${ctx.locale}`,
      period: dev?.fast ? 4 : num(ctx.setting("periodSeconds"), 90, 5, 3600),
      hold: dev?.fast ? 2.5 : num(ctx.setting("holdSeconds"), 10, 3, 120),
      startDelay: dev?.fast ? 0.5 : 5,
      visual: ["neon", "cine", "broadcast"].includes(ctx.setting("visual")) ? ctx.setting("visual") : "neon",
      showQr: ctx.setting("showQr") !== false,
      seed: dev?.seed ?? null,
      badge: ctx.t("badge"),
      isNew: ctx.t("new"),
    };
    const custom = color(ctx.setting("accentColor"), null);
    const accent = custom ?? ctx.theme.accent;
    // Les couleurs de la carte suivent le thème du site (fond, texte, texte atténué, texte sur l'accent).
    const t = ctx.theme;
    // `<` échappé : la config est insérée dans un <script>, aucun réglage ne doit pouvoir en sortir.
    const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
    return {
      title: ctx.instance.name,
      html: `<div id="tk-stage" style="--ticker-accent:${accent};--tk-bg:${t.surface};--tk-fg:${t.fg};--tk-muted:${t.muted};--tk-on-accent:${custom ? onAccent(custom) : t.accentFg}"><div class="ticker-slider" id="tk-slider"></div></div>`,
      css: `
        html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:system-ui,"Segoe UI",sans-serif}
        #tk-stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:2vh 2vw;box-sizing:border-box}
        .ticker-slider{position:relative;flex:none;transform:translateX(135%) scale(var(--tk-s,1));opacity:0;transition:transform .58s cubic-bezier(.2,.9,.32,1.15),opacity .45s ease;will-change:transform}
        .ticker-slider.on{transform:translateX(0) scale(var(--tk-s,1));opacity:1}
        .ticker-card{position:relative;display:flex;align-items:center;overflow:hidden;min-height:96px;padding-right:26px;clip-path:polygon(3.5% 0,100% 0,96.5% 100%,0 100%);box-shadow:0 14px 34px rgba(0,0,0,.55)}
        .ticker-card--cine{background:linear-gradient(100deg,color-mix(in srgb,var(--tk-bg) 96%,#000),color-mix(in srgb,var(--tk-bg) 88%,#fff));backdrop-filter:blur(10px);animation:tickerFloat 4.6s ease-in-out infinite}
        .ticker-card--neon{background:linear-gradient(100deg,color-mix(in srgb,var(--tk-bg) 96%,#000),color-mix(in srgb,var(--tk-bg) 88%,#fff));backdrop-filter:blur(10px);box-shadow:0 14px 34px rgba(0,0,0,.55),0 0 24px color-mix(in srgb,var(--ticker-accent) 35%,transparent);animation:tickerFloat 4.6s ease-in-out infinite}
        .ticker-card--broadcast{background:var(--ticker-accent)}
        .ticker-card--broadcast .ticker-badge,.ticker-card--broadcast .ticker-name,.ticker-card--broadcast .ticker-blurb{color:var(--tk-on-accent)}
        .ticker-card--broadcast .ticker-blurb{opacity:.75}
        .ticker-card--broadcast .ticker-bar{background:var(--tk-on-accent);box-shadow:none}
        .ticker-card--broadcast .ticker-new{color:var(--tk-on-accent);background:color-mix(in srgb,var(--tk-on-accent) 12%,transparent);border-color:color-mix(in srgb,var(--tk-on-accent) 40%,transparent)}
        .ticker-card--broadcast .ticker-divider{background:color-mix(in srgb,var(--tk-on-accent) 22%,transparent)}
        .ticker-card--broadcast .ticker-domain{color:var(--tk-on-accent);opacity:.75}
        .ticker-bar{width:9px;align-self:stretch;flex:none;margin-right:22px;background:var(--ticker-accent);box-shadow:0 0 16px color-mix(in srgb,var(--ticker-accent) 60%,transparent)}
        .ticker-logo{width:60px;height:60px;object-fit:contain;flex:none;margin-right:18px;border-radius:8px}
        .ticker-text-col{display:flex;flex-direction:column;gap:5px;flex:none;max-width:430px;padding:10px 0}
        .ticker-eyebrow{display:flex;align-items:center;gap:8px}
        .ticker-badge{font-weight:700;font-size:12px;letter-spacing:.18em;color:var(--tk-muted);text-transform:uppercase}
        .ticker-new{font-weight:700;font-size:10.5px;letter-spacing:.1em;color:var(--ticker-accent);background:color-mix(in srgb,var(--ticker-accent) 14%,transparent);border:1px solid color-mix(in srgb,var(--ticker-accent) 50%,transparent);border-radius:3px;padding:1px 6px}
        .ticker-name{font-weight:700;font-size:22px;letter-spacing:.02em;color:var(--tk-fg);line-height:1.05;overflow:hidden;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
        .ticker-code{display:inline-block;max-width:100%;overflow-wrap:anywhere;font:700 13px ui-monospace,monospace;letter-spacing:.08em;color:var(--ticker-accent)}
        .ticker-card--broadcast .ticker-code{color:var(--tk-on-accent)}
        .ticker-blurb{font-weight:500;font-size:13px;line-height:1.28;color:var(--tk-muted);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
        .ticker-divider{width:1px;height:60px;background:rgba(255,255,255,.14);margin:0 20px;flex:none}
        .ticker-qr-wrap{display:flex;flex-direction:column;align-items:center;gap:4px;flex:none}
        .ticker-qr{width:62px;height:62px;background:#fff;border-radius:8px;padding:5px;box-sizing:border-box}
        .ticker-qr svg{width:100%;height:100%;display:block}
        .ticker-domain{font-size:9.5px;letter-spacing:.04em;color:var(--tk-muted);max-width:150px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .ticker-shine{position:absolute;top:0;left:0;width:26%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.10),transparent);animation:tickerShine 5.5s ease-in-out infinite;pointer-events:none}
        .ticker-card--broadcast .ticker-shine{display:none}
        @keyframes tickerFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
        @keyframes tickerShine{0%{transform:translateX(-160%)}55%,100%{transform:translateX(430%)}}
        @media (prefers-reduced-motion:reduce){.ticker-card,.ticker-shine{animation:none}}`,
      script: `(function(){var c=${json},slider=document.getElementById("tk-slider"),items=[],last=null,hold;
        // Hasard : Math.random, ou un petit générateur à graine en mode développeur (?seed=N).
        var rnd=Math.random;if(c.seed!==null){var a=c.seed>>>0;rnd=function(){a=(a+0x6d2b79f5)>>>0;var t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}
        function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
        ${fitTitle.toString()}
        ${fitScale.toString()}
        ${shortDomain.toString()}
        function load(){return fetch(c.itemsUrl,{cache:"no-store"}).then(function(r){return r.json()}).then(function(d){if(Array.isArray(d.items))items=d.items}).catch(function(){})}
        function pick(){if(!items.length)return null;if(items.length===1)return items[0];var s=items[Math.floor(rnd()*items.length)],g=0;while(s.id===last&&g++<8)s=items[Math.floor(rnd()*items.length)];return s}
        function build(s){
          var card=el("div","ticker-card ticker-card--"+c.visual);card.append(el("div","ticker-bar"));
          if(s.logo){var img=el("img","ticker-logo");img.src=s.logo;img.alt="";card.append(img)}
          var col=el("div","ticker-text-col"),eb=el("div","ticker-eyebrow");eb.append(el("span","ticker-badge",c.badge));
          if(s.publishedAt&&Date.now()-Date.parse(s.publishedAt)<14*864e5)eb.append(el("span","ticker-new",c.isNew));
          col.append(eb,el("div","ticker-name",s.name));
          if(s.code)col.append(el("div","ticker-code","CODE "+s.code));
          if(s.text)col.append(el("div","ticker-blurb",s.text));
          card.append(col);
          if(c.showQr&&s.url&&s.qrSvg){card.append(el("div","ticker-divider"));var w=el("div","ticker-qr-wrap"),q=el("div","ticker-qr");q.innerHTML=s.qrSvg;w.append(q);var dm=shortDomain(s.url);if(dm)w.append(el("div","ticker-domain",dm));card.append(w)}
          card.append(el("div","ticker-shine"));return card}
        // La carte doit toujours tenir dans la source navigateur : on essaie 3 largeurs de texte et on garde celle qui laisse le titre le plus lisible une fois mise à l'échelle.
        var cur=null;
        function fit(card){var col=card.querySelector(".ticker-text-col"),nm=card.querySelector(".ticker-name"),best=null,vw=window.innerWidth,vh=window.innerHeight;
          function apply(w){col.style.maxWidth=w+"px";nm.style.cssText="white-space:nowrap;font-size:22px";var t=fitTitle(nm.scrollWidth,w);nm.style.cssText=t.size===22?"":"font-size:"+t.size+"px";return {w:w,t:t,s:fitScale(card.offsetWidth,card.offsetHeight,vw,vh)}}
          [430,330,250].forEach(function(w){if(best&&best.s>=1)return;var r=apply(w);r.score=r.t.size*r.s;if(!best||r.score>best.score*1.03)best=r});
          apply(best.w);slider.style.setProperty("--tk-s",best.s<1?String(best.s):"1")}
        window.addEventListener("resize",function(){if(cur)fit(cur)});
        function cycle(){load().then(function(){var s=pick();if(s){last=s.id;cur=build(s);slider.replaceChildren(cur);fit(cur);slider.classList.add("on");clearTimeout(hold);hold=setTimeout(function(){slider.classList.remove("on")},c.hold*1000)}
          setTimeout(cycle,Math.max(c.period,c.hold+2)*1000)})}
        load().then(function(){setTimeout(cycle,c.startDelay*1000)})})();`,
    };
  },
};
