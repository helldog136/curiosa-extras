// Planning : l'aperçu des apparences pour l'admin. Rend VRAIMENT chaque apparence avec des créneaux d'exemple (jaquettes dessinées en SVG,
// aucune image distante), réduite dans un cadre ; les couleurs sont celles du thème du site. Fonction pure (l'horloge est donnée).
const V = new URL(import.meta.url).search;
const { APPEARANCE_IDS, DEFAULT_APPEARANCE, normalizeOptions } = await import(`./options.mjs${V}`);
const { buildModel } = await import(`./model.mjs${V}`);
const { renderAppearance, hasAppearance } = await import(`./registry.mjs${V}`);
const { esc, minify } = await import(`./kit.mjs${V}`);

const poster = (h1, h2) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1},70%,48%)"/><stop offset="1" stop-color="hsl(${h2},65%,24%)"/></linearGradient></defs><rect width="120" height="160" fill="url(#g)"/><circle cx="84" cy="44" r="24" fill="hsla(${h2},80%,75%,.4)"/></svg>`)}`;
const GAMES = [["sampleGameA", 265], ["sampleGameB", 150], ["sampleGameC", 20]];

/** Créneaux et jaquettes d'exemple (textes traduits par `t`). */
export function sampleData(t, now = new Date()) {
  const h = (n) => new Date(now.getTime() + n * 3_600_000);
  const g = (i) => t(GAMES[i][0]);
  const slots = [
    { uid: "s1", title: t("sampleLive"), description: `Jeu: ${g(0)}`, start: h(-0.4), end: h(1.2), allDay: false },
    { uid: "s2", title: t("sampleA"), description: `Jeu: ${g(1)}, ${g(2)}`, start: h(5), end: h(7), allDay: false },
    { uid: "s3", title: t("sampleB"), description: `Jeu: ${g(2)}`, start: h(27), end: h(29), allDay: false },
    { uid: "s4", title: t("sampleC"), description: "", start: h(31), end: h(34), allDay: false },
    { uid: "s5", title: t("sampleD"), description: `Jeu: ${g(0)}`, start: h(75), end: h(77), allDay: false },
  ];
  const covers = new Map(GAMES.map(([k, hue]) => [t(k), poster(hue, (hue + 60) % 360)]));
  return { slots, covers };
}

const hex = (v) => (typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v) ? v : null);
const themeStyle = (th = {}) => [["fg", th.fg], ["muted", th.muted], ["surface", th.surface], ["line", th.line], ["bg", th.bg], ["accent", th.accent], ["accent-fg", th.accentFg], ["accent2", th.accent2], ["accent2-fg", th.accent2Fg]]
  .flatMap(([k, v]) => (hex(v) ? [`--v-${k}:${v}`] : [])).join(";");

/** Miniature de « Liste simple » (le rendu d'origine est fait de blocs du cœur : on en dessine l'allure). */
function originalMini(t, slots, tz, locale) {
  const f = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: tz });
  const tf = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: tz });
  return `<div class="pa-pv-orig">${slots.slice(0, 3).map((s) => `<h4>${esc(f.format(s.start))}</h4><ul><li><strong>${esc(tf.format(s.start))}</strong> — ${esc(s.title)}</li></ul>`).join("")}</div>`;
}

const CSS = minify(`
.pa-pv{display:grid;grid-template-columns:repeat(auto-fill,minmax(17.5rem,1fr));gap:1rem;margin:.5rem 0 1rem}
.pa-pv-card{display:flex;flex-direction:column;gap:.5rem;padding:.6rem;border:1px solid var(--v-line,currentColor);border-radius:.9rem}
.pa-pv-card.is-current{border-width:2px}
.pa-pv-frame{position:relative;height:12.5rem;overflow:hidden;border-radius:.6rem;background:var(--v-bg,transparent);color:var(--v-fg,inherit);font-family:var(--v-font,inherit)}
.pa-pv-inner{width:46rem;transform:scale(.36);transform-origin:top left;pointer-events:none;padding:1rem}
.pa-pv-orig{font-size:1rem;line-height:1.5}
.pa-pv-orig h4{margin:.8rem 0 .2rem;font-size:1.25rem;font-weight:600}.pa-pv-orig ul{margin:0;padding-left:1.2rem;list-style:disc}
.pa-pv-name{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;font-weight:700}
.pa-pv-cur{padding:.05rem .6rem;border-radius:999px;border:1px solid currentColor;font-size:.75rem}
.pa-pv-desc{font-size:.875rem;opacity:.8;margin:0}
`);

/** Grille d'aperçus : une carte par apparence, la choisie marquée « Choisie ». */
export function previewHtml({ t, locale = "fr", tz = "UTC", theme, current = DEFAULT_APPEARANCE, now = new Date() }) {
  const { slots, covers } = sampleData(t, now);
  const opts = normalizeOptions(() => undefined);
  const accent2 = hex(theme?.accent2) && theme.accent2 !== theme.accent ? " data-accent2=\"1\"" : "";
  const cards = APPEARANCE_IDS.filter((id) => id === DEFAULT_APPEARANCE || hasAppearance(id)).map((id) => {
    let inner;
    if (id === DEFAULT_APPEARANCE) inner = originalMini(t, slots, tz, locale);
    else {
      const model = buildModel({ slots, covers, now, tz, locale, t, opts: { ...opts, appearance: id }, mode: "days", days: 7, surface: "preview", allowData: true });
      inner = renderAppearance(id, model, { t, locale });
    }
    const on = id === current;
    return `<li class="pa-pv-card${on ? " is-current" : ""}"><div class="pa-pv-frame" aria-hidden="true"><div class="pa-pv-inner">${inner}</div></div>` +
      `<p class="pa-pv-name">${esc(t(`ap_${id}`))}${on ? ` <span class="pa-pv-cur">${esc(t("apCurrent"))}</span>` : ""}</p><p class="pa-pv-desc">${esc(t(`apd_${id}`))}</p></li>`;
  }).join("");
  return `<div class="pa-pv-root"${accent2} style="${themeStyle(theme)}"><style>${CSS}</style><p>${esc(t("apIntro"))}</p><ul class="pa-pv">${cards}</ul></div>`;
}
