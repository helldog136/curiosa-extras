// Apparence « Semaine en grille » : sept colonnes, du premier jour de la semaine au dernier, comme une page d'agenda papier (Apple Calendrier, vue semaine).
// Les créneaux s'empilent dans la case de leur jour. Sous 44 rem de large, les colonnes deviennent une liste verticale (les jours vides hors
// semaine sont masqués). Pas de rôle « grid » ARIA (il promet une navigation au clavier) : des titres et des listes, lus dans l'ordre. Fonction pure.
const V = new URL(import.meta.url).search;
const { esc, timeTag, statusChips, gamesHtml, artHtml, emptyHtml, footHtml, minify } = await import(`../kit.mjs${V}`);

function slotHtml(s, model) {
  const chips = statusChips(s, model.t);
  return `<li class="pa-wk-s${s.cancelled ? " pa-cancelled" : ""}${s.live ? " is-live" : ""}"><p class="pa-wk-time">${timeTag(s, model.opts.showEnd && s.endText ? `${s.timeText} – ${s.endText}` : s.timeText)}</p>` +
    `<div class="pa-wk-body">${artHtml(s, model, { fallback: true })}<div class="pa-wk-txt"><p class="pa-title" title="${esc(s.title)}">${esc(s.title)}</p>${gamesHtml(s, model.t)}${chips ? `<p class="pa-wk-chips">${chips}</p>` : ""}</div></div></li>`;
}

function dayHtml(day, model) {
  const L = model.headingLevel + 1, l = day.label, style = model.opts.dayStyle;
  const head = style === "tile"
    ? `<span class="pa-dh pa-dh-tile"><span class="pa-dh-wd">${esc(l.weekdayShort)}</span><span class="pa-dh-n">${esc(l.dayNum)}</span><span class="pa-dh-m">${esc(l.monthShort)}</span></span>`
    : `<span class="pa-wk-wd">${esc(style === "text" ? l.weekdayLong : l.weekdayShort)}</span> <span class="pa-wk-dn">${esc(l.dayNum)}<span class="pa-wk-mo"> ${esc(l.monthShort)}</span></span>`;
  const body = day.slots.length ? `<ul class="pa-wk-list">${day.slots.map((s) => slotHtml(s, model)).join("")}</ul>` : `<p class="pa-wk-none"><span aria-hidden="true">–</span><span class="pa-sr">${esc(model.t("none"))}</span></p>`;
  const cls = `pa-wk-day${day.isToday ? " is-today" : ""}${day.isPast ? " is-past" : ""}${day.outside ? " is-outside" : ""}${day.slots.length ? "" : " is-empty"}`;
  return `<li class="${cls}"><h${L} class="pa-wk-h"><time datetime="${esc(day.key)}">${head}</time>${day.isToday ? `<span class="pa-chip pa-chip-plain">${esc(model.t("relToday"))}</span>` : ""}</h${L}>${body}</li>`;
}

export function render(model) {
  if (model.empty) return { html: emptyHtml(model), css: "" };
  const L = model.headingLevel;
  const weeks = model.weeks.map((w) => `<section class="pa-wk"><h${L} class="pa-wk-title">${esc(model.t("weekOf", { date: `${w.label.from.dayNum} ${w.label.from.monthShort}` }))}</h${L}><ol class="pa-wk-grid">${w.days.map((d) => dayHtml(d, model)).join("")}</ol></section>`).join("");
  return { html: `<div class="pa-wk-wrap">${weeks}</div>${footHtml(model)}`, css: CSS };
}

const CSS = minify(`
.pa-wk-wrap{display:flex;flex-direction:column;gap:1.5rem}
.pa-wk-title{margin-bottom:.5rem;font-size:.8125rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--pa-muted)}
.pa-wk-grid{display:flex;flex-direction:column;gap:.5rem}
.pa-wk-day{padding:var(--pa-gap);background:var(--pa-surface);border:1px solid var(--pa-hair);border-radius:var(--pa-radius)}
.pa-wk-day.is-outside{display:none}
.pa-wk-day.is-past.is-empty{display:none}
.pa-wk-day.is-today{border-color:var(--pa-hl);box-shadow:0 0 0 1px var(--pa-hl)}
.pa-wk-h{display:flex;flex-wrap:wrap;align-items:center;gap:.25rem .5rem;margin-bottom:.4rem;font-size:.9375rem}
.pa-wk-wd{font-weight:700;text-transform:capitalize}
.pa-wk-dn{color:var(--pa-muted)}
.pa-wk-day.is-empty .pa-wk-h{margin-bottom:0}
.pa-wk-none{display:none}
.pa-wk-list{display:flex;flex-direction:column;gap:.6rem}
.pa-wk-s+.pa-wk-s{padding-top:.6rem;border-top:1px dotted var(--pa-hair)}
.pa-wk-time{font-weight:700;font-size:.875rem}
.pa-wk-body{display:flex;gap:.6rem;align-items:flex-start;margin-top:.15rem}
.pa-wk-txt{display:flex;flex-direction:column;gap:.1rem;min-width:0}
.pa-wk-chips{display:flex;flex-wrap:wrap;gap:.25rem;margin-top:.15rem}
.pa-wk-s .pa-title{font-size:.9375rem;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:6;overflow:hidden}
@container (min-width:44rem){
 .pa-wk-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:.4rem;align-items:stretch}
 .pa-wk-day{padding:.6rem .5rem;min-height:9rem}
 .pa-wk-day.is-outside,.pa-wk-day.is-past.is-empty{display:block;background:transparent;border-style:dashed}
 .pa-wk-day.is-outside .pa-wk-h,.pa-wk-day.is-past .pa-wk-h{color:var(--pa-muted)}
 .pa-wk-h{flex-direction:column;align-items:flex-start;gap:.2rem}
 .pa-wk-h time{display:flex;flex-direction:column;gap:.1rem}
 .pa-wk-wd{font-size:.75rem;letter-spacing:.04em;text-transform:uppercase}
 .pa-wk-dn{font-size:1.25rem;font-weight:800;color:var(--pa-fg);line-height:1}
 .pa-wk-mo{font-size:.7rem;font-weight:500;color:var(--pa-muted);text-transform:uppercase}
 .pa-wk-none{display:block;color:var(--pa-muted)}
 .pa-wk-body{flex-direction:column;gap:.3rem}
 .pa-wk-s .pa-covers,.pa-wk-s .pa-ph{--pa-cw:2rem}
 .pa-wk-s .pa-title{font-size:.8125rem;line-height:1.3}
 .pa-wk-time{font-size:.75rem}
 .pa-wk .pa-chip{font-size:.65rem;padding:.05em .45em}
}
`);
export default { id: "week", render };
