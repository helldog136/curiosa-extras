// Mascotte — la feuille de style envoyée aux visiteurs (route « mascot.css », chargée seulement au moment où la mascotte va se montrer).
// Toutes les couleurs, la police et les traits viennent des jetons du thème du site (--v-*) ; les valeurs après la virgule ne sont qu'un repli
// si un jeton manquait. Aucune animation sous « mouvement réduit ». Tout est préfixé « mc- » pour ne jamais heurter le style du site.

export const CSS = `
.mc{position:fixed;bottom:max(16px,env(safe-area-inset-bottom));z-index:40;display:flex;flex-direction:column;gap:8px;width:max-content;max-width:min(330px,calc(100vw - 32px));pointer-events:none;font:15px/1.4 var(--v-font,system-ui,sans-serif);color:var(--v-fg,#1f2430)}
.mc-r{right:max(16px,env(safe-area-inset-right));align-items:flex-end}
.mc-w{left:max(16px,env(safe-area-inset-left));align-items:flex-start}
.mc>*{pointer-events:auto}
.mc-bub{position:relative;box-sizing:border-box;width:100%;padding:12px 48px 10px 14px;background:var(--v-surface,#fff);color:var(--v-fg,#1f2430);border:1px solid var(--v-line,#d5d8e0);border-radius:16px;box-shadow:0 8px 28px rgba(0,0,0,.18)}
.mc-bub[hidden]{display:none}
.mc-bub:after{content:"";position:absolute;bottom:-7px;width:12px;height:12px;background:var(--v-surface,#fff);border:1px solid var(--v-line,#d5d8e0);border-top:0;border-left:0;transform:rotate(45deg)}
.mc-r .mc-bub:after{right:30px}
.mc-w .mc-bub:after{left:30px}
.mc-n{margin:0 0 2px;font-size:12px;font-weight:600;color:var(--v-muted,#566070)}
.mc-p{margin:0;overflow-wrap:anywhere}
.mc-a{display:inline-flex;align-items:center;min-height:44px;margin-top:2px;color:var(--v-accent,#3b4cca);font-weight:600;text-decoration:underline;text-underline-offset:3px}
.mc-a[hidden]{display:none}
.mc-o{display:flex;flex-wrap:wrap;gap:0 14px;margin-top:2px}
.mc button{font:inherit;color:inherit;cursor:pointer}
.mc-o button{min-height:44px;padding:0;border:0;background:none;color:var(--v-muted,#566070);font-size:13px;text-decoration:underline;text-underline-offset:3px}
.mc-x{position:absolute;top:0;right:0;width:44px;height:44px;border:0;background:none;border-radius:16px;color:var(--v-muted,#566070);font-size:22px;line-height:1}
.mc-av{position:relative;display:block;box-sizing:border-box;width:76px;height:76px;padding:0;border:0;border-radius:50%;background:none}
.mc-r .mc-av{margin-right:2px}
.mc-pill .mc-av{width:52px;height:52px;padding:4px;background:var(--v-surface,#fff);border:1px solid var(--v-line,#d5d8e0);box-shadow:0 4px 14px rgba(0,0,0,.18)}
.mc-svg,.mc-i{display:block;width:100%;height:100%}
.mc-i{object-fit:cover}
.mc-rd{border-radius:50%}
.mc-sq{border-radius:12px}
.mc-dot{position:absolute;top:2px;right:2px;width:14px;height:14px;border-radius:50%;background:var(--v-accent,#3b4cca);border:2px solid var(--v-surface,#fff)}
.mc button:focus-visible,.mc a:focus-visible{outline:3px solid var(--v-accent,#3b4cca);outline-offset:2px}
.mc-b{fill:var(--v-accent,#5865d6);stroke:var(--v-line,#d5d8e0);stroke-width:1}
.mc-t{fill:var(--v-accent2,var(--v-accent,#3f9f7a))}
.mc-s{fill:var(--v-surface,#fff)}
.mc-f{fill:var(--v-fg,#1f2430)}
.mc-l{fill:none;stroke:var(--v-fg,#1f2430);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.mc-c{fill:var(--v-accent2,var(--v-accent,#5865d6));opacity:.4}
@media (prefers-reduced-motion:no-preference){
.mc{transition:opacity .3s ease,transform .3s ease}
.mc-in{animation:mc-in .4s cubic-bezier(.2,.9,.3,1.2)}
.mc-out{opacity:0;transform:translateY(24px)}
.mc-bub:not([hidden]){animation:mc-pop .25s ease-out}
.mc-hi .mc-av{animation:mc-wave 1.1s ease-in-out 1}
.mc-dot{animation:mc-pulse 1.8s ease-in-out 3}
}
@keyframes mc-in{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:none}}
@keyframes mc-pop{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}
@keyframes mc-wave{0%,100%{transform:rotate(0)}25%{transform:rotate(-9deg)}60%{transform:rotate(7deg)}}
@keyframes mc-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.3)}}
@media print{.mc{display:none}}
`.trim();
