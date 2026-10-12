// Apparence « Affiches » : cartes verticales façon affiche (Apple TV, Netflix, Spotify). Jaquette sur toute la hauteur, dégradé vers la couleur
// des cartes pour la lisibilité, date en pastille, titre en surimpression. Sans jeu : le logo du site sur le mauve Twitch. Une affiche par stream. Fonction pure.
const V = new URL(import.meta.url).search;
const { esc, timeTag, statusChips, gamesHtml, placeholderHtml, emptyHtml, footHtml, minify } = await import(`../kit.mjs${V}`);

function cardHtml(s, day, model) {
  const t = model.t, l = day.label;
  const art = model.opts.covers && s.covers.length ? `<img class="pa-po-img" src="${esc(s.covers[0].url)}" alt="${esc(t("coverAlt", { game: s.covers[0].name }))}" loading="lazy" decoding="async" width="300" height="400">` : model.opts.covers ? placeholderHtml(model.vis, "pa-po-ph") : "";
  const chips = statusChips(s, t);
  return `<li class="pa-po${s.cancelled ? " pa-cancelled" : ""}${s.live ? " is-live" : ""}${art ? "" : " is-bare"}">${art}` +
    `<time class="pa-po-date" datetime="${esc(s.iso)}"><span class="pa-po-wd">${esc(l.weekdayShort)}</span><span class="pa-po-n">${esc(l.dayNum)}</span><span class="pa-po-m">${esc(l.monthShort)}</span></time>` +
    `${chips ? `<p class="pa-po-chips">${chips}</p>` : ""}` +
    `<div class="pa-po-txt"><p class="pa-po-time">${timeTag(s, model.opts.showEnd && s.endText ? `${s.timeText} – ${s.endText}` : s.timeText)}</p><p class="pa-title">${esc(s.title)}</p>${gamesHtml(s, t)}</div></li>`;
}

export function render(model) {
  const cards = model.days.flatMap((d) => d.slots.map((s) => cardHtml(s, d, model)));
  if (!cards.length) return { html: emptyHtml(model), css: "" };
  return { html: `<ul class="pa-po-grid">${cards.join("")}</ul>${footHtml(model)}`, css: CSS };
}

const CSS = minify(`
.pa-po-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--pa-gap)}
.pa-po{position:relative;display:flex;flex-direction:column;justify-content:flex-end;min-height:15rem;aspect-ratio:3/4;overflow:hidden;border-radius:var(--pa-radius);background:var(--pa-sunk);border:1px solid var(--pa-hair)}
.pa-po-img,.pa-po-ph{position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:cover;border-radius:0;aspect-ratio:auto}
.pa-po-ph{font-size:3rem}
.pa-po-ph img{max-height:45%}
.pa-po::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,var(--pa-surface) 4%,color-mix(in srgb,var(--pa-surface) 80%,transparent) 38%,transparent 68%)}
.pa-po-date{position:absolute;z-index:2;top:.6rem;left:.6rem;display:flex;flex-direction:column;align-items:center;min-width:2.9rem;padding:.3rem .45rem;border-radius:.6rem;background:var(--pa-surface);color:var(--pa-fg);border:1px solid var(--pa-hair);line-height:1.1;text-align:center}
.pa-po-wd,.pa-po-m{font-size:.62rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--pa-muted)}
.pa-po-n{font-size:1.25rem;font-weight:800}
.pa-po-chips{position:absolute;z-index:2;top:.6rem;right:.6rem;display:flex;flex-direction:column;align-items:flex-end;gap:.25rem}
.pa-po-txt{position:relative;z-index:1;display:flex;flex-direction:column;gap:.15rem;padding:.75rem;color:var(--pa-fg)}
.pa-po-time{font-weight:700;font-size:.875rem}
.pa-po .pa-title{font-size:1.0625rem;line-height:1.2;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:5;overflow:hidden}
.pa-po .pa-games{font-size:.8125rem;color:var(--pa-muted)}
.pa-po.is-live{box-shadow:0 0 0 2px var(--pa-hl)}
.pa-po.pa-cancelled .pa-po-img,.pa-po.pa-cancelled .pa-po-ph{filter:grayscale(1)}
@container (min-width:36rem){.pa-po-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@container (min-width:56rem){.pa-po-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.pa-po .pa-title{font-size:1.125rem}}
`);
export default { id: "posters", render };
