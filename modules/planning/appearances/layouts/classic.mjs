// Apparence « Liste classique » : un agenda sobre, un jour par rangée (Apple Calendrier, Dieter Rams : tout ce qui est là sert).
// Heure à gauche, titre et jeux au centre, jaquettes à droite. Fonction pure : render(model, options, ctx) → { html, css }.
const V = new URL(import.meta.url).search;
const K = await import(`../kit.mjs${V}`);
const { esc, timeTag, statusChips, gamesHtml, artHtml, dayLabel, whenText, emptyHtml, footHtml, minify } = K;

function slotHtml(s, model) {
  const t = model.t;
  const chips = statusChips(s, t);
  return `<li class="pa-cl-slot${s.cancelled ? " pa-cancelled" : ""}${s.live ? " is-live" : ""}">` +
    `<p class="pa-cl-when${s.allDay ? " is-allday" : ""}">${timeTag(s, s.timeText)}${model.opts.showEnd && s.endText ? `<span class="pa-cl-end"><span class="pa-sr"> – </span>${esc(s.endText)}</span>` : ""}</p>` +
    `<div class="pa-cl-main"><p class="pa-title">${esc(s.title)}</p>${gamesHtml(s, t)}${chips ? `<p class="pa-cl-chips">${chips}</p>` : ""}</div>` +
    `${artHtml(s, model, { fallback: true })}</li>`;
}

function dayHtml(day, model) {
  const t = model.t, L = model.headingLevel;
  const head = `<h${L} class="pa-cl-h"><time datetime="${esc(day.key)}">${dayLabel(day, model.opts.dayStyle)}</time>${day.isToday ? `<span class="pa-chip pa-chip-plain">${esc(t("relToday"))}</span>` : ""}</h${L}>`;
  const body = day.slots.length ? `<ul class="pa-cl-list">${day.slots.map((s) => slotHtml(s, model)).join("")}</ul>` : `<p class="pa-cl-none">${esc(t("none"))}</p>`;
  return `<li class="pa-cl-day${day.isToday ? " is-today" : ""}${day.slots.length ? "" : " is-empty"}">${head}${body}</li>`;
}

export function render(model, options = {}) {
  if (model.empty) return { html: emptyHtml(model), css: "" };
  const days = options.classicHideEmpty ? model.days.filter((d) => d.slots.length) : model.days;
  const html = `<ol class="pa-cl" data-ds="${esc(model.opts.dayStyle)}">${days.map((d) => dayHtml(d, model)).join("")}</ol>${footHtml(model)}`;
  return { html, css: CSS };
}

const CSS = minify(`
.pa-cl{display:flex;flex-direction:column}
.pa-cl-day{padding:var(--pa-gap) 0;border-top:1px solid var(--pa-hair)}
.pa-cl-day:first-child{border-top:0;padding-top:0}
.pa-cl-h{display:flex;flex-wrap:wrap;align-items:center;gap:.25rem .6rem;margin-bottom:.1rem;font-size:.9375rem}
.is-empty>.pa-cl-h .pa-dh-wd{color:var(--pa-muted);font-weight:600}
.is-today>.pa-cl-h::before{content:"";width:.5rem;height:.5rem;border-radius:50%;background:var(--pa-hl);flex:0 0 auto}
.pa-cl-none{color:var(--pa-muted);font-size:.9rem;padding:.1rem 0}
.pa-cl-slot{display:flex;align-items:flex-start;gap:.75rem;padding:.55rem 0}
.pa-cl-slot+.pa-cl-slot{border-top:1px dotted var(--pa-hair)}
.pa-cl-when{flex:0 0 4.5rem;font-weight:700;font-size:.9375rem;line-height:1.5}
.pa-cl-when.is-allday{font-size:.72rem;line-height:1.3;padding-top:.2rem;text-transform:uppercase;letter-spacing:.03em}
.pa-cl-end{display:block;color:var(--pa-muted);font-weight:500;font-size:.8125rem;font-variant-numeric:tabular-nums}
.pa-cl-main{flex:1 1 0;display:flex;flex-direction:column;gap:.15rem;min-width:0}
.pa-cl-chips{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.15rem}
.pa-cl-slot>.pa-covers,.pa-cl-slot>.pa-ph{align-self:center;order:3}
.is-live .pa-cl-when time{box-shadow:inset 0 -.2em 0 var(--pa-hl)}
.pa-cl[data-ds=tile] .pa-cl-day{display:grid;grid-template-columns:3.5rem minmax(0,1fr);gap:0 .75rem;align-items:start}
.pa-cl[data-ds=tile] .pa-cl-h{flex-direction:column;align-items:flex-start;margin:0;grid-row:1/span 2}
.pa-cl[data-ds=tile] .pa-cl-day>:not(.pa-cl-h){grid-column:2}
@container (min-width:40rem){
 .pa-cl-day{display:grid;grid-template-columns:11rem minmax(0,1fr);gap:0 1.25rem;padding:var(--pa-pad) 0}
 .pa-cl-day:first-child{padding-top:var(--pa-pad)}
 .pa-cl-h{display:block;margin:0;padding-top:.55rem;font-size:1rem}
 .pa-cl-h .pa-chip{margin-left:.5rem}
 .pa-cl-when{flex-basis:5.5rem}
 .pa-cl-slot:first-child{padding-top:.4rem}
 .pa-cl-none{padding-top:.6rem}
 .pa-cl-slot>.pa-covers,.pa-cl-slot>.pa-ph{order:0}
 .pa-cl-slot>.pa-covers,.pa-cl-slot>.pa-ph{align-self:flex-start}
 .pa-cl-main{order:1}
 .pa-cl[data-ds=tile] .pa-cl-day{grid-template-columns:4.5rem minmax(0,1fr)}
}
`);
export default { id: "classic", render };
