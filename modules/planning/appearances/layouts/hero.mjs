// Apparence « À la une + à suivre » : le prochain stream en grand (jaquette, « Dans X h » ou « En cours », bouton vers la chaîne), puis la suite en
// liste compacte (Apple TV « À suivre »). Le « compte à rebours » est le texte « Dans 3 h » calculé à l'affichage : pas de script. Fonction pure.
const V = new URL(import.meta.url).search;
const { esc, timeTag, statusChips, gamesHtml, sourceHtml, artHtml, whenText, emptyHtml, footHtml, minify, chip } = await import(`../kit.mjs${V}`);

function heroHtml(s, day, model) {
  const t = model.t, l = day.label;
  const art = artHtml(s, model, { fallback: true, cls: "pa-hr-art" });
  const chips = statusChips(s, t);
  const btn = model.channelUrl ? `<a class="pa-btn" href="${esc(model.channelUrl)}" target="_blank" rel="noopener noreferrer">${esc(t("watch"))}</a>` : "";
  return `<article class="pa-hr${s.live ? " is-live" : ""}">${art}<div class="pa-hr-body"><p class="pa-hr-eyebrow">${esc(t("nextUp"))}</p>${chips ? `<p class="pa-hr-chips">${chips}</p>` : ""}` +
    `<h${model.headingLevel} class="pa-hr-title pa-title">${esc(s.title)}</h${model.headingLevel}>` +
    `<p class="pa-hr-when">${timeTag(s, whenText(s, model.opts.showEnd), "pa-hr-hour")} <span class="pa-hr-day">${esc(l.weekdayLong)} ${esc(l.dayNum)} ${esc(l.monthLong)}</span></p>${gamesHtml(s, t)}${btn}</div></article>`;
}

function rowHtml(s, day, model) {
  const l = day.label, chips = statusChips(s, model.t);
  return `<li class="pa-hr-row${s.cancelled ? " pa-cancelled" : ""}"><time class="pa-hr-date" datetime="${esc(day.key)}"><span>${esc(l.weekdayShort)}</span><b>${esc(l.dayNum)}</b></time>${artHtml(s, model, { fallback: true })}` +
    `<div class="pa-hr-txt"><p class="pa-title">${esc(s.title)}</p><p class="pa-hr-meta">${timeTag(s, whenText(s, model.opts.showEnd))}${s.games.length ? ` · ${s.games.map(esc).join(", ")}` : ""}</p>${sourceHtml(s)}</div>${chips}</li>`;
}

export function render(model, options = {}) {
  const pairs = model.days.flatMap((d) => d.slots.map((s) => [s, d]));
  const lead = pairs.find(([s]) => !s.cancelled && s.endMs >= model.now.getTime());
  if (!lead) return { html: pairs.length ? `<ul class="pa-hr-list">${pairs.map(([s, d]) => rowHtml(s, d, model)).join("")}</ul>` : emptyHtml(model), css: CSS };
  const rest = pairs.filter((p) => p !== lead).slice(0, options.heroUpNext ?? 5);
  const more = rest.length ? `<h${model.headingLevel} class="pa-hr-sub">${esc(model.t("upNext"))}</h${model.headingLevel}><ul class="pa-hr-list">${rest.map(([s, d]) => rowHtml(s, d, model)).join("")}</ul>` : "";
  return { html: `${heroHtml(lead[0], lead[1], model)}${more}${footHtml(model)}`, css: CSS };
}

const CSS = minify(`
.pa-hr{position:relative;display:flex;flex-direction:column;gap:1rem;padding:var(--pa-pad);background:var(--pa-surface);border:1px solid var(--pa-hair);border-radius:calc(var(--pa-radius) + .25rem);overflow:hidden}
.pa-hr::before{content:"";position:absolute;inset:0 0 auto 0;height:4px;background:var(--v-gradient,var(--pa-hl))}
.pa-hr-art{--pa-cw:5.5rem;align-self:flex-start}
.pa-hr-art.pa-covers img+img{margin-left:calc(var(--pa-cw)*-.5)}
.pa-hr-body{display:flex;flex-direction:column;align-items:flex-start;gap:.4rem;min-width:0}
.pa-hr-eyebrow{font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--pa-muted)}
.pa-hr-chips{display:flex;flex-wrap:wrap;gap:.3rem}
.pa-hr-title{font-size:1.5rem;line-height:1.2;font-weight:750}
.pa-hr-when{display:flex;flex-wrap:wrap;align-items:baseline;gap:.1rem .75rem}
.pa-hr-hour{font-size:2rem;font-weight:800;line-height:1.1}
.pa-hr-day{color:var(--pa-muted);text-transform:capitalize}
.pa-hr .pa-btn{margin-top:.5rem}
.pa-hr-sub{margin:1.5rem 0 .25rem;font-size:.8125rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--pa-muted)}
.pa-hr-list{display:flex;flex-direction:column}
.pa-hr-row{display:flex;align-items:center;gap:.75rem;padding:.6rem 0}
.pa-hr-row+.pa-hr-row{border-top:1px solid var(--pa-hair)}
.pa-hr-date{flex:0 0 2.75rem;display:flex;flex-direction:column;align-items:center;line-height:1.15;text-transform:uppercase;font-size:.65rem;letter-spacing:.05em;color:var(--pa-muted)}
.pa-hr-date b{font-size:1.2rem;color:var(--pa-fg);letter-spacing:0}
.pa-hr-txt{flex:1 1 0;min-width:0;display:flex;flex-direction:column}
.pa-hr-row .pa-title{font-size:1rem}
.pa-hr-meta{color:var(--pa-muted);font-size:.875rem;overflow-wrap:anywhere}
.pa-hr-meta time{color:var(--pa-fg);font-weight:700}
@container (min-width:36rem){.pa-hr{flex-direction:row;align-items:center;gap:1.75rem;padding:1.5rem}.pa-hr-art{--pa-cw:9rem}.pa-hr-title{font-size:2rem}.pa-hr-hour{font-size:2.5rem}}
`);
export default { id: "hero", render };
