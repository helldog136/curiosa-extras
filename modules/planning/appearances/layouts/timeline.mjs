// Apparence « Timeline » : un rail vertical, des points, des dates ancrées à gauche (fil de versions de Linear, journal de bord de Stripe).
// Plus aérée que la liste : jaquettes en vignettes. Par défaut, seuls les jours avec stream ont un point ; les autres se résument en une ligne. Fonction pure.
const V = new URL(import.meta.url).search;
const { esc, timeTag, statusChips, gamesHtml, artHtml, dayLabel, whenText, emptyHtml, footHtml, minify } = await import(`../kit.mjs${V}`);

function slotHtml(s, model) {
  const chips = statusChips(s, model.t);
  return `<li class="pa-tl-s${s.cancelled ? " pa-cancelled" : ""}${s.live ? " is-live" : ""}">${artHtml(s, model, { fallback: true })}` +
    `<div class="pa-tl-txt"><p class="pa-tl-time">${timeTag(s, whenText(s, model.opts.showEnd))}${chips}</p><p class="pa-title">${esc(s.title)}</p>${gamesHtml(s, model.t)}</div></li>`;
}

export function render(model, options = {}) {
  if (model.empty) return { html: emptyHtml(model), css: "" };
  const L = model.headingLevel;
  const shown = model.days.filter((d) => d.slots.length || options.timelineEmpty);
  const quiet = model.days.length - shown.length;
  const items = shown.map((day) => `<li class="pa-tl-day${day.isToday ? " is-today" : ""}${day.slots.length ? "" : " is-empty"}"><span class="pa-tl-pin" aria-hidden="true"></span>` +
    `<h${L} class="pa-tl-h"><time datetime="${esc(day.key)}">${dayLabel(day, model.opts.dayStyle)}</time>${day.isToday ? `<span class="pa-chip pa-chip-plain">${esc(model.t("relToday"))}</span>` : ""}</h${L}>` +
    (day.slots.length ? `<ul class="pa-tl-list">${day.slots.map((s) => slotHtml(s, model)).join("")}</ul>` : `<p class="pa-tl-none">${esc(model.t("none"))}</p>`) + `</li>`).join("");
  const note = quiet > 0 ? `<p class="pa-tl-note">${esc(model.t("quietDays", { n: quiet }))}</p>` : "";
  return { html: `<ol class="pa-tl">${items}</ol>${note}${footHtml(model)}`, css: CSS };
}

const CSS = minify(`
.pa-tl{position:relative;display:flex;flex-direction:column;gap:1.75rem;padding-left:1.75rem}
.pa-tl::before{content:"";position:absolute;left:.4rem;top:.6rem;bottom:.6rem;width:2px;background:var(--pa-hair);border-radius:2px}
.pa-tl-day{position:relative}
.pa-tl-pin{position:absolute;left:-1.75rem;top:.3rem;width:.85rem;height:.85rem;border-radius:50%;background:var(--pa-bg);border:2px solid var(--pa-muted)}
.is-today>.pa-tl-pin{background:var(--pa-hl);border-color:var(--pa-hl);box-shadow:0 0 0 4px color-mix(in srgb,var(--pa-hl) 25%,transparent)}
.pa-tl-h{padding-right:.25rem;display:flex;flex-wrap:wrap;align-items:center;gap:.25rem .6rem;margin-bottom:.6rem;font-size:1.0625rem}
.pa-tl-list{display:flex;flex-direction:column;gap:1rem}
.pa-tl-s{display:flex;gap:.9rem;align-items:flex-start}
.pa-tl-txt{display:flex;flex-direction:column;gap:.15rem;min-width:0}
.pa-tl-time{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;font-weight:700;font-size:.875rem;color:var(--pa-muted)}
.pa-tl-time time{color:var(--pa-fg)}
.pa-tl-s .pa-title{font-size:1.0625rem}
.pa-tl-s .pa-covers{--pa-cw:3rem}.pa-tl-s .pa-ph{--pa-cw:3rem}
.pa-tl-none{color:var(--pa-muted)}
.pa-tl-note{margin:1.25rem 0 0 1.75rem;color:var(--pa-muted);font-size:.875rem}
@container (min-width:40rem){
 .pa-tl{padding-left:0;gap:2.25rem}
 .pa-tl::before{left:9.5rem}
 .pa-tl-day{display:grid;grid-template-columns:9rem minmax(0,1fr);column-gap:2rem}
 .pa-tl-pin{left:calc(9.5rem - .425rem + 1px);top:.35rem}
 .pa-tl-h{display:block;text-align:right;margin:0;padding-right:1.6rem}
 .pa-tl-h .pa-chip{margin-top:.3rem}
 .pa-tl-note{margin-left:11.5rem}
 .pa-tl-s .pa-covers,.pa-tl-s .pa-ph{--pa-cw:3.5rem}
 .pa-tl-day>.pa-tl-list,.pa-tl-day>.pa-tl-none{grid-column:2;padding-left:.25rem}
}
`);
export default { id: "timeline", render };
