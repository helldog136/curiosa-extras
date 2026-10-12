// Apparence « Liste en alternance » : l'en-tête de jour en zigzag, gauche puis droite d'un jour à l'autre — la présentation de l'ancien site
// (gabarit : étiquette de 7 à 8 rem, case arrondie d'au moins 7 rem, jaquettes jusqu'à 3 par stream, « semaine vide » en un seul message compact).
// Sur mobile, retombe en colonne en gardant l'alternance par l'alignement de l'étiquette. Fonction pure.
const V = new URL(import.meta.url).search;
const K = await import(`../kit.mjs${V}`);
const { esc, timeTag, statusChips, gamesHtml, artHtml, whenText, emptyHtml, footHtml, minify } = K;

function streamHtml(s, model) {
  const chips = statusChips(s, model.t);
  return `<div class="pa-alt-s${s.cancelled ? " pa-cancelled" : ""}${s.live ? " is-live" : ""}">${artHtml(s, model, { fallback: true })}` +
    `<div class="pa-alt-txt"><p class="pa-alt-time">${timeTag(s, whenText(s, model.opts.showEnd))}</p><p class="pa-title">${esc(s.title)}</p>${gamesHtml(s, model.t)}${chips ? `<p class="pa-alt-chips">${chips}</p>` : ""}</div></div>`;
}

function labelHtml(day, model) {
  const l = day.label, style = model.opts.dayStyle;
  const inner = style === "tile"
    ? `<span class="pa-dh pa-dh-tile"><span class="pa-dh-wd">${esc(l.weekdayShort)}</span><span class="pa-dh-n">${esc(l.dayNum)}</span><span class="pa-dh-m">${esc(l.monthShort)}</span></span>`
    : style === "short"
      ? `<span class="pa-alt-wd">${esc(l.weekdayShort)}</span><span class="pa-alt-d">${esc(l.dayNum)} ${esc(l.monthShort)}</span>`
      : `<span class="pa-alt-wd">${esc(l.weekdayLong)}</span><span class="pa-alt-d">${esc(l.dayNum)} ${esc(l.monthShort)}</span>`;
  const L = model.headingLevel;
  return `<h${L} class="pa-alt-label"><time datetime="${esc(day.key)}">${inner}</time>${day.isToday ? `<span class="pa-chip pa-chip-plain">${esc(model.t("relToday"))}</span>` : ""}</h${L}>`;
}

export function render(model, options = {}) {
  if (model.quiet && model.days.every((d) => !d.slots.length)) return { html: emptyHtml(model), css: "" };   // « semaine vide » : un seul message compact
  const flip = options.altFirstSide === "right" ? 1 : 0;
  const rows = model.days.map((day, i) => {
    const side = (i + flip) % 2 === 0 ? "left" : "right";
    const box = day.slots.length ? day.slots.map((s) => streamHtml(s, model)).join("") : `<p class="pa-alt-none">${esc(model.t("none"))}</p>`;
    return `<li class="pa-alt-day is-${side}${day.isToday ? " is-today" : ""}">${labelHtml(day, model)}<div class="pa-alt-box">${box}</div></li>`;
  }).join("");
  return { html: `<ol class="pa-alt">${rows}</ol>${footHtml(model)}`, css: CSS };
}

const CSS = minify(`
.pa-alt{display:flex;flex-direction:column;gap:var(--pa-gap)}
.pa-alt-day{display:flex;flex-direction:column;gap:.35rem}
.pa-alt-label{display:flex;flex-wrap:wrap;align-items:center;gap:.25rem .6rem}
.is-right>.pa-alt-label{justify-content:flex-end;text-align:right}
.pa-alt-label time{display:flex;flex-direction:column;line-height:1.2}
.pa-alt-wd{font-family:var(--v-font,inherit);font-size:1.15rem;font-weight:700;text-transform:capitalize}
.pa-alt-d{font-size:.875rem;color:var(--pa-muted)}
.pa-alt-box{display:flex;flex-direction:column;justify-content:center;gap:var(--pa-gap);min-height:5rem;padding:var(--pa-pad);background:var(--pa-surface);border:1px solid var(--pa-hair);border-radius:var(--pa-radius)}
.is-today>.pa-alt-box{border-color:var(--pa-hl);box-shadow:0 0 0 1px var(--pa-hl)}
.pa-alt-s{display:flex;align-items:center;gap:.75rem;min-width:0}
.pa-alt-s+.pa-alt-s{padding-top:var(--pa-gap);border-top:1px solid var(--pa-hair)}
.pa-alt-txt{display:flex;flex-direction:column;gap:.1rem;min-width:0}
.pa-alt-time{font-weight:700;font-size:.9375rem}
.pa-alt-time time{border-bottom:2px solid var(--pa-hl);padding-bottom:.05rem}
.pa-alt-s .pa-title{font-size:1.0625rem;font-weight:550}
.pa-alt-chips{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.2rem}
.pa-alt-none{color:var(--pa-muted)}
.pa-alt .pa-covers{gap:.25rem}
.pa-alt .pa-covers img+img{margin-left:0}
@container (min-width:32rem){
 .pa-alt-day{flex-direction:row;align-items:stretch;gap:.75rem}
 .pa-alt-day.is-right{flex-direction:row-reverse}
 .pa-alt-label{flex:0 0 7rem;flex-direction:column;justify-content:center;gap:.4rem;text-align:center}
 .pa-alt-label time{align-items:center}
 .is-right>.pa-alt-label{justify-content:center;text-align:center}
 .pa-alt-box{flex:1 1 0;min-width:0;min-height:7rem}
}
@container (min-width:44rem){.pa-alt-label{flex-basis:8rem}.pa-alt-wd{font-size:1.25rem}}
`);
export default { id: "alternating", render };
