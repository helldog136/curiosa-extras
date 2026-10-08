// Ticker overlay (OBS) — module de Curiosa.
/**
 * Overlay OBS : une carte qui fait défiler des informations. Il ne sait rien des
 * blogs, des codes promo ou des sponsors : il déclare deux sujets qu'il digère
 * (`core.entry` — les entrées de n'importe quelle instance à contenu — et
 * `overlay.item`, un format simple que n'importe quel module peut fournir) et
 * l'admin choisit quelles instances l'alimentent.
 */
const safeImage = (v) => typeof v === "string" && /^(https?:\/\/|\/uploads\/)/.test(v) ? v : undefined;
async function cards(ctx) {
    const [entries, items] = await Promise.all([ctx.api.topics.collect("core.entry"), ctx.api.topics.collect("overlay.item")]);
    const fromEntry = (e) => ({
        title: String(e.title),
        subtitle: e.code ? `Code ${String(e.code)}` : String(e.summary ?? ""),
        image: safeImage(e.cover),
    });
    const fromItem = (e) => ({ title: String(e.title), subtitle: String(e.text ?? ""), image: safeImage(e.image) });
    return [...entries.map(fromEntry), ...items.map(fromItem)];
}
const color = (v, fallback) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback);
export default ({
    routes: {
        // Rafraîchi régulièrement par la page de l'overlay (aucun état côté serveur).
        async items(_request, ctx) {
            return Response.json({ items: await cards(ctx) }, { headers: { "cache-control": "no-store" } });
        },
    },
    overlay(ctx) {
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
