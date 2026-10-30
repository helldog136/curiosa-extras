// Ticker overlay (OBS) — module de Curiosa.
/**
 * Overlay OBS : une carte qui fait défiler des informations. Il ne sait rien des
 * blogs, des codes promo ou des sponsors : il déclare deux sujets qu'il digère
 * (`core.entry` — les entrées de n'importe quelle instance à contenu — et
 * `overlay.item`, un format simple que n'importe quel module peut fournir) et
 * l'admin choisit quelles instances l'alimentent.
 */
const safeImage = (v) => typeof v === "string" && /^(https?:\/\/|\/uploads\/)/.test(v) ? v : undefined;
const fromEntry = (e) => ({
    title: String(e.title),
    subtitle: e.code ? `Code ${String(e.code)}` : String(e.summary ?? ""),
    image: safeImage(e.cover),
});
const fromItem = (e) => ({ title: String(e.title), subtitle: String(e.text ?? ""), image: safeImage(e.image) });
async function cards(ctx) {
    const [entries, items] = await Promise.all([ctx.api.topics.collect("core.entry"), ctx.api.topics.collect("overlay.item")]);
    return [...entries.map(fromEntry), ...items.map(fromItem)];
}

// ── Éléments des pages d'overlay (cœur 0.5.0) ──────────────────────────────────────────────────────────────────────
// L'élément « Bandeau défilant » réutilise l'overlay ci-dessous : la page passe en « mode élément » quand son adresse porte `ov-w` (taille du cadre, réservée au cœur).
// Rien n'est consommé à la lecture : la carte montrée se déduit de l'HEURE (même carte au même instant pour toutes les pages qui montrent le bandeau), la liste est lue UNE fois
// pour tous les lecteurs (gardée quelques dizaines de secondes, une seule lecture à la fois), aucune tâche de fond.
export const ELEMENT_CACHE = { ttlMs: 30_000, failedTtlMs: 10_000, maxKeys: 40 };   // dans un objet pour que les tests puissent les raccourcir
const shared = new Map();                                                           // « instance » -> { at, ttl, promise }
export const resetElementCache = () => shared.clear();
const SHOWN = ["all", "codes", "news"];

/** Ce que la page reçoit quand elle sert un ÉLÉMENT : `ov-w`, `ov-demo` et les options `opt-show`, `opt-image` (réservés au cœur), revalidés ici. Sinon null : l'overlay habituel. */
export function elementRequest(query) {
    if (!query?.has?.("ov-w")) return null;
    const show = query.get("opt-show");
    return { demo: query.get("ov-demo") === "1", show: SHOWN.includes(show) ? show : "all", image: query.get("opt-image") !== "0" };
}

/** Jetons --ov-* du style commun (valeurs de docs/OVERLAY-ELEMENTS.md), avec repli ; jamais le thème ni le skin du site. */
function elementTokens(query) {
    const light = query.get("ov-text") !== "dark";
    const soft = query.get("ov-surface") === "soft";
    return `--ov-fg:${light ? "#ffffff" : "#111111"};--ov-surface:${soft ? (light ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.7)") : "transparent"};--ov-radius:${query.get("ov-corners") === "square" ? "0px" : "12px"};--ov-border:${soft ? (light ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.18)") : "transparent"}`;
}

/** Les cartes de l'élément, avec leur genre (code promo ou annonce) : UNE lecture partagée par tous les lecteurs de l'instance. Ne lève jamais. */
function sharedCards(ctx) {
    const key = ctx.instance.key;
    const hit = shared.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;
    const entry = { at: Date.now(), ttl: ELEMENT_CACHE.ttlMs, promise: null };
    entry.promise = (async () => {
        try {
            const [entries, items] = await Promise.all([ctx.api.topics.collect("core.entry"), ctx.api.topics.collect("overlay.item")]);
            return [...entries.map((e) => ({ ...fromEntry(e), kind: e.code ? "code" : "news" })), ...items.map((e) => ({ ...fromItem(e), kind: "news" }))];
        } catch {
            entry.ttl = ELEMENT_CACHE.failedTtlMs;
            return hit ? hit.promise : [];
        }
    })();
    shared.set(key, entry);
    while (shared.size > ELEMENT_CACHE.maxKeys) shared.delete(shared.keys().next().value);
    return entry.promise;
}
async function elementItems(request, ctx) {
    const params = new URL(request.url).searchParams;
    const show = SHOWN.includes(params.get("show")) ? params.get("show") : "all";
    let list = (await sharedCards(ctx)).filter((c) => show === "all" || (show === "codes") === (c.kind === "code"));
    if (params.get("image") === "0") list = list.map(({ image, ...rest }) => rest);
    // Mode test d'une page d'overlay (?demo=1) : sans aucune carte, une carte d'exemple pour voir le bandeau (jamais mélangée aux vraies).
    if (!list.length && params.get("demo") === "1") list = [{ title: ctx.t("demoTitle"), subtitle: show === "news" ? ctx.t("demoText") : ctx.t("demoCode"), kind: show === "news" ? "news" : "code" }];
    return list.slice(0, 60);
}

const color = (v, fallback) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback);

/** La page de l'ÉLÉMENT : la carte remplit tout le cadre, style par les jetons --ov-* et les attributs data-ov-part (jamais le thème du site, jamais la place ni la couleur réglées pour l'overlay). */
function elementOverlay(ctx, query, element) {
    const interval = Math.min(120, Math.max(2, Number(ctx.setting("interval")) || 8));   // la durée par carte reste celle du module
    const config = JSON.stringify({ url: `/m/${ctx.instance.key}/items?lang=${encodeURIComponent(ctx.locale)}&el=1&show=${element.show}${element.image ? "" : "&image=0"}${element.demo ? "&demo=1" : ""}`, ms: interval * 1000 }).replace(/</g, "\\u003c");
    return {
        title: ctx.instance.name,
        html: `<div id="vt-stage" data-ov-region="element"><div id="vt-card" role="status" aria-live="polite" data-ov-part="panel"><img id="vt-img" data-ov-part="image" alt="" hidden><div data-ov-part="text"><strong id="vt-title" data-ov-part="title"></strong><span id="vt-sub" data-ov-part="subtitle"></span></div></div></div>`,
        css: `
        :root{${elementTokens(query)}}
        html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:system-ui,"Segoe UI",sans-serif}
        #vt-stage{position:fixed;inset:0}
        [data-ov-part="panel"]{position:absolute;inset:0;box-sizing:border-box;display:flex;gap:18px;align-items:center;padding:14px 22px;overflow:hidden;
          border:1px solid var(--ov-border,transparent);border-radius:var(--ov-radius,12px);background:var(--ov-surface,transparent);color:var(--ov-fg,#fff);
          text-shadow:${query.get("ov-text") === "dark" ? "none" : "0 1px 3px rgba(0,0,0,.35)"};opacity:0;transform:translateY(8px);transition:opacity .5s,transform .5s}
        [data-ov-part="panel"].on{opacity:1;transform:none}
        [data-ov-part="image"]{flex:none;width:92px;height:92px;object-fit:cover;border-radius:min(var(--ov-radius,12px),12px)}
        [data-ov-part="text"]{min-width:0;flex:1}
        [data-ov-part="title"]{display:block;font-size:30px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        [data-ov-part="subtitle"]{display:-webkit-box;margin-top:4px;font-size:21px;line-height:1.25;opacity:.85;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical}
        [data-ov-part="subtitle"][data-kind="code"]{font-weight:700;letter-spacing:.04em;opacity:1}
        @media (prefers-reduced-motion:reduce){[data-ov-part="panel"]{transition:none;transform:none}}`,
        // Le repère est l'HEURE : la carte du moment est `liste[créneau % taille]`, la même pour toutes les pages ; aucun état gardé, rien de consommé.
        script: `(function(){var c=${config},card=document.getElementById("vt-card"),img=document.getElementById("vt-img"),t=document.getElementById("vt-title"),s=document.getElementById("vt-sub"),items=[],shown=null;
        function fill(it){t.textContent=it.title;s.textContent=it.subtitle||"";s.setAttribute("data-kind",it.kind||"");if(it.image){img.src=it.image;img.hidden=false}else{img.removeAttribute("src");img.hidden=true}}
        function show(){if(!items.length){card.classList.remove("on");shown=null;return}
          var it=items[Math.floor(Date.now()/c.ms)%items.length],id=JSON.stringify(it);if(id===shown&&card.classList.contains("on"))return;
          shown=id;card.classList.remove("on");setTimeout(function(){fill(it);card.classList.add("on")},card.classList.contains("on")?500:0)}
        function load(){fetch(c.url).then(function(r){return r.json()}).then(function(d){items=d.items||[];show()}).catch(function(){})}
        function next(){setTimeout(function(){show();next()},c.ms-(Date.now()%c.ms)+30)}
        load();setInterval(load,60000);next()})();`,
    };
}

export default ({
    routes: {
        // Rafraîchi régulièrement par la page de l'overlay (aucun état côté serveur).
        async items(request, ctx) {
            if (new URL(request.url).searchParams.get("el") === "1") return Response.json({ items: await elementItems(request, ctx) }, { headers: { "cache-control": "no-store" } });
            return Response.json({ items: await cards(ctx) }, { headers: { "cache-control": "no-store" } });
        },
    },
    // ÉLÉMENT DE PAGE D'OVERLAY : « Bandeau défilant ». On réutilise l'overlay ci-dessous ; le cœur ajoute la taille du cadre, le style commun (ov-text…) et les options. Aucun secret : cet overlay n'en a pas.
    overlayElements: {
        banner: (ctx, request) => ({ url: `/overlays/${ctx.instance.key}?lang=${encodeURIComponent(request?.lang ?? ctx.locale)}` }),
    },
    overlay(ctx, { query } = {}) {
        const element = query ? elementRequest(query) : null;
        if (element) return elementOverlay(ctx, query, element);
        const interval = Math.min(120, Math.max(2, Number(ctx.setting("interval")) || 8));
        const pos = String(ctx.setting("position") ?? "bottom-left");
        const side = pos.endsWith("right") ? "right" : "left";
        const vert = pos.startsWith("top") ? "top" : "bottom";
        const text = color(ctx.setting("textColor"), ctx.theme.fg);
        const bg = color(ctx.setting("cardColor"), ctx.theme.surface);
        const config = JSON.stringify({ url: `/m/${ctx.instance.key}/items?lang=${ctx.locale}`, ms: interval * 1000 }).replace(/</g, "\\u003c"); // jamais de « </script » dans le script en ligne
        return {
            title: ctx.instance.name,
            html: `<div id="vt-card" role="status" aria-live="polite"><img id="vt-img" alt="" hidden><div><strong id="vt-title"></strong><span id="vt-sub"></span></div></div>`,
            css: `
        html,body{margin:0;background:transparent;overflow:hidden;font-family:system-ui,sans-serif}
        #vt-card{position:fixed;${side}:32px;${vert}:32px;display:flex;gap:16px;align-items:center;max-width:520px;padding:16px 20px;
          border-radius:16px;background:${bg};color:${text};box-shadow:0 8px 32px rgba(0,0,0,.4);opacity:0;transform:translateY(12px);transition:opacity .5s,transform .5s}
        #vt-card.on{opacity:1;transform:none}
        #vt-img{width:72px;height:72px;object-fit:cover;border-radius:12px}
        #vt-title{display:block;font-size:26px;line-height:1.2}
        #vt-sub{display:block;margin-top:4px;font-size:18px;opacity:.8}`,
            script: `(function(){var c=${config},card=document.getElementById("vt-card"),img=document.getElementById("vt-img"),t=document.getElementById("vt-title"),s=document.getElementById("vt-sub"),items=[],i=0;
        function load(){fetch(c.url).then(function(r){return r.json()}).then(function(d){items=d.items||[]}).catch(function(){})}
        function show(){if(!items.length){card.classList.remove("on");return}
          card.classList.remove("on");
          setTimeout(function(){var it=items[i++%items.length];t.textContent=it.title;s.textContent=it.subtitle||"";
            if(it.image){img.src=it.image;img.hidden=false}else{img.hidden=true}
            card.classList.add("on")},500)}
        load();setInterval(load,60000);setInterval(show,c.ms);setTimeout(show,800)})();`,
        };
    },
});
