// Témoignages — ce que voit le public : cartes d'avis, étoiles, grille ou défilement lent, formulaire, pagination.
// Le bloc « html » du cœur est BRUT : tout ce qui vient d'un visiteur (nom, avis, adresse) passe par esc() avant d'entrer ici.
// Aucun script : le bouton « pause » du défilement est une case à cocher, le formulaire est un vrai formulaire de navigateur.
const v = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${v}`);
const { esc } = L;

// ── Adresses de la page ────────────────────────────────────────────────────────────────────────────────────────
/** Début de l'adresse publique de l'instance ("" = racine du site), préfixé par la langue si ce n'est pas la langue par défaut. */
export function base(ctx) {
  const b = ctx.instance.basePath;
  if (b === null || b === undefined) return null;
  const prefix = ctx.locale !== ctx.defaultLocale ? `/${ctx.locale}` : "";
  return `${prefix}${b ? `/${b}` : ""}`;
}
export function href(ctx, ...segments) {
  const b = base(ctx);
  if (b === null) return null;
  return `${b}${segments.length ? `/${segments.join("/")}` : ""}` || "/";
}
const privacyHref = (ctx) => `${ctx.locale !== ctx.defaultLocale ? `/${ctx.locale}` : ""}/privacy`;

// ── Style : suit le thème du site (variables --v-*), aucune couleur en dur ─────────────────────────────────────────
export const CSS = `
.tm{color:var(--v-fg);display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
.tm-scroll{min-width:0;max-width:100%}
.tm *{box-sizing:border-box}
.tm a{color:inherit}
.tm-sr{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.tm-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));align-items:start}
.tm-card{margin:0;padding:16px;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface);display:flex;flex-direction:column;gap:8px;min-width:0}
.tm-fav{border-color:var(--v-accent)}
.tm-badge{margin:0;font-size:.8em;font-weight:600;color:var(--v-fg)}
.tm-head{display:flex;align-items:center;gap:10px;min-width:0}
.tm-avatar{width:40px;height:40px;border-radius:50%;flex:none;display:grid;place-items:center;background:var(--v-accent);color:var(--v-accent-fg);font-weight:700;overflow:hidden}
.tm-avatar img{width:100%;height:100%;object-fit:cover;display:block}
.tm-name{font-weight:600;overflow-wrap:anywhere}
.tm-date{font-size:.8em;color:var(--v-muted)}
.tm-rating{display:inline-flex;align-items:center;gap:8px}
.tm-stars{color:var(--v-warning);letter-spacing:2px;font-size:1.1em}
.tm-score{font-size:.85em;color:var(--v-muted)}
.tm-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.tm-bar{display:flex;flex-wrap:wrap;align-items:center;gap:12px 20px}
.tm-big{font-size:2em;font-weight:700;line-height:1}
.tm-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 22px;border:0;border-radius:999px;background:var(--v-accent);color:var(--v-accent-fg)!important;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
.tm-btn.tm-alt{background:transparent;color:var(--v-fg)!important;border:1px solid var(--v-line)}
.tm-nav{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.tm-chip{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1px solid var(--v-line);border-radius:999px;text-decoration:none;color:var(--v-fg)!important;background:var(--v-surface)}
.tm-chip[aria-current=page]{background:var(--v-accent);color:var(--v-accent-fg)!important;border-color:var(--v-accent)}
.tm a:focus-visible,.tm button:focus-visible,.tm input:focus-visible+.tm-box,.tm-pause:has(input:focus-visible){outline:3px solid var(--v-fg);outline-offset:2px}
.tm-muted{color:var(--v-muted);margin:0}
.tm-form{display:grid;gap:18px;max-width:560px}
.tm-field{display:grid;gap:6px;border:0;margin:0;padding:0;min-width:0}
.tm-field label,.tm-field legend{font-weight:600;padding:0}
.tm-opt{font-weight:400;color:var(--v-muted)}
.tm-hint{margin:0;font-size:.9em;color:var(--v-muted)}
.tm-in{width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--v-line);border-radius:10px;background:var(--v-bg);color:var(--v-fg);font:inherit}
textarea.tm-in{min-height:140px;resize:vertical}
.tm-in[aria-invalid=true]{border-color:var(--v-danger);border-width:2px}
.tm-err{margin:0;color:var(--v-danger);font-weight:600}
.tm-errsum{padding:12px 16px;border:2px solid var(--v-danger);border-radius:12px;background:var(--v-surface)}
.tm-errsum p{margin:0 0 6px;font-weight:700;color:var(--v-danger)}
.tm-errsum ul{margin:0;padding-left:20px}
.tm-pills{display:flex;flex-wrap:wrap;gap:8px}
.tm-pill{position:relative;display:inline-flex}
.tm-pill input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.tm-box{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:56px;min-height:48px;padding:0 14px;border:1px solid var(--v-line);border-radius:999px;background:var(--v-surface);font-weight:600}
.tm-pill input:checked+.tm-box{background:var(--v-accent);color:var(--v-accent-fg);border-color:var(--v-accent)}
.tm-check{display:flex;gap:12px;align-items:flex-start;min-height:44px;font-weight:400!important}
.tm-check input{width:26px;height:26px;margin:2px 0 0;flex:none}
.tm-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.tm-panel{padding:16px;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface);display:grid;gap:10px}
.tm-link{word-break:break-all}
.tm-viewport{overflow:hidden}
.tm-track{display:flex;flex-wrap:wrap;gap:12px;align-items:stretch}
.tm-track .tm-card{flex:1 1 260px;min-width:0}
.tm-dup,.tm-pause{display:none}
.tm-pause{align-items:center;gap:10px;min-height:44px;padding:0 16px;margin-bottom:10px;border:1px solid var(--v-line);border-radius:999px;background:var(--v-surface);cursor:pointer;position:relative}
.tm-pause input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.tm-pause .tm-ico::before{content:"\\23F8"}
.tm-pause:has(input:checked) .tm-ico::before{content:"\\25B6"}
@media (prefers-reduced-motion:no-preference){
.tm-pause{display:inline-flex}
.tm-dup{display:flex}
.tm-viewport{-webkit-mask-image:linear-gradient(to right,transparent,#000 4%,#000 96%,transparent);mask-image:linear-gradient(to right,transparent,#000 4%,#000 96%,transparent)}
.tm-track{flex-wrap:nowrap;width:max-content;animation:tm-slide var(--tm-dur,60s) linear infinite}
.tm-track .tm-card{flex:none;width:min(78vw,300px)}
.tm-scroll:has(.tm-pause input:checked) .tm-track,.tm-viewport:hover .tm-track,.tm-viewport:focus-within .tm-track{animation-play-state:paused}
}
@keyframes tm-slide{to{transform:translateX(calc(-50% - 6px))}}
`;
export const style = () => ({ type: "html", html: `<style>${CSS}</style>` });

// ── Étoiles : un texte pour chaque personne, jamais seulement des icônes ───────────────────────────────────────────
/** « Note : 4 sur 5 » lu à voix haute ; ★★★★☆ et « 4/5 » pour les yeux. */
export function stars(ctx, rating) {
  if (!L.isRating(rating)) return "";
  const label = ctx.t("starsLabel", { n: rating });
  return `<span class="tm-rating" role="img" aria-label="${esc(label)}"><span class="tm-stars" aria-hidden="true">${"★".repeat(rating)}${"☆".repeat(5 - rating)}</span><span class="tm-score" aria-hidden="true">${rating}/5</span></span>`;
}

function avatar(r) {
  if (r.photo) return `<span class="tm-avatar"><img src="${esc(r.photo)}" alt="" width="40" height="40" loading="lazy"></span>`;
  return `<span class="tm-avatar" aria-hidden="true">${esc((Array.from(r.name)[0] ?? "?").toUpperCase())}</span>`;
}

/** Une carte d'avis. `dup` : la copie cachée qui permet au défilement de boucler (ignorée par les lecteurs d'écran). */
export function card(ctx, r, dup = false) {
  const when = r.publishedAt || r.at;
  return `<article class="tm-card${r.featured ? " tm-fav" : ""}"${dup ? ' aria-hidden="true"' : ""}>` +
    (r.featured ? `<p class="tm-badge">★ ${esc(ctx.t("favorite"))}</p>` : "") +
    `<div class="tm-head">${avatar(r)}<div style="min-width:0"><div class="tm-name">${esc(r.name)}</div><div class="tm-date"><time datetime="${esc(L.isoDay(when))}">${esc(L.day(when, ctx.locale))}</time></div></div></div>` +
    (r.rating ? stars(ctx, r.rating) : "") +
    `<p class="tm-text">${esc(r.text)}</p></article>`;
}

export const grid = (ctx, list) => `<div class="tm-grid">${list.map((r) => card(ctx, r)).join("")}</div>`;

/** Défilement lent : seulement pour les personnes qui n'ont pas demandé « moins de mouvement » (le style s'en charge), avec un vrai bouton pause. */
export function scroller(ctx, list) {
  if (list.length < L.MIN_SCROLL) return grid(ctx, list);
  const seconds = Math.min(180, Math.max(40, list.length * 9));
  return `<div class="tm-scroll"><label class="tm-pause"><input type="checkbox"><span class="tm-ico" aria-hidden="true"></span><span>${esc(ctx.t("pause"))}</span></label>` +
    `<div class="tm-viewport" role="group" aria-label="${esc(ctx.t("scrollLabel"))}"><div class="tm-track" style="--tm-dur:${seconds}s">${list.map((r) => card(ctx, r)).join("")}${list.map((r) => card(ctx, r, true).replace("tm-card", "tm-card tm-dup")).join("")}</div></div></div>`;
}

// ── En-tête : moyenne, nombre d'avis, bouton « Laisser un avis » ────────────────────────────────────────────────────
export function summaryBar(ctx, stats, { cta = true } = {}) {
  const showAvg = L.config(ctx).showAverage && stats.rated >= L.MIN_AVERAGE;
  const link = href(ctx, "laisser");
  const parts = [];
  if (showAvg) {
    const avg = L.formatAverage(stats.average, ctx.locale);
    parts.push(`<div class="tm-rating" role="img" aria-label="${esc(ctx.t("averageLabel", { avg, count: stats.rated }))}"><span class="tm-big" aria-hidden="true">${esc(avg)}</span><span aria-hidden="true"><span class="tm-stars">${"★".repeat(Math.round(stats.average))}${"☆".repeat(5 - Math.round(stats.average))}</span><br><span class="tm-score">${esc(ctx.t("averageOf", { count: stats.rated }))}</span></span></div>`);
  } else if (stats.total) parts.push(`<p class="tm-muted">${esc(ctx.t("countReviews", { count: stats.total }))}</p>`);
  if (cta && link) parts.push(`<a class="tm-btn" href="${esc(link)}">${esc(ctx.t("leaveReview"))}</a>`);
  return parts.length ? `<div class="tm-bar">${parts.join("")}</div>` : "";
}

/** Filtre par étoiles (à partir de 6 notes) : « Toutes · 5 étoiles (12) · 4 étoiles (3)… » */
export function chips(ctx, stats, current) {
  if (stats.rated < L.MIN_FILTER) return "";
  const all = `<a class="tm-chip" href="${esc(href(ctx) ?? "/")}"${current === null ? ' aria-current="page"' : ""}>${esc(ctx.t("allStars"))}</a>`;
  const each = [5, 4, 3, 2, 1].filter((n) => stats.distribution[n] > 0 || n === current).map((n) =>
    `<a class="tm-chip" href="${esc(href(ctx, "etoiles", String(n)) ?? "/")}"${current === n ? ' aria-current="page"' : ""}>${esc(ctx.t("nStars", { n, count: stats.distribution[n] }))}</a>`);
  return `<nav class="tm-nav" aria-label="${esc(ctx.t("filterLabel"))}">${[all, ...each].join("")}</nav>`;
}

/** Pagination : précédent / suivant et « page 2 sur 5 ». */
export function pager(ctx, current, pages, hrefFor) {
  if (pages <= 1) return "";
  const prev = current > 1 ? `<a class="tm-btn tm-alt" rel="prev" href="${esc(hrefFor(current - 1))}">${esc(ctx.t("newer"))}</a>` : "";
  const next = current < pages ? `<a class="tm-btn tm-alt" rel="next" href="${esc(hrefFor(current + 1))}">${esc(ctx.t("older"))}</a>` : "";
  return `<nav class="tm-nav" aria-label="${esc(ctx.t("pagesLabel"))}">${prev}<span class="tm-muted">${esc(ctx.t("pageOf", { page: current, pages }))}</span>${next}</nav>`;
}

// ── Données pour les moteurs de recherche ───────────────────────────────────────────────────────────────────────
const LD_TYPES = ["Service", "Product", "SoftwareApplication", "Course"];
/**
 * Seulement quand l'administrateur l'a choisi (réglage avancé), qu'il y a au moins 5 notes réelles, et sur la page où ces avis sont visibles.
 * La moyenne compte TOUS les avis publiés ; les avis cités sont ceux de la page. Une donnée structurée ne dit jamais plus que ce qu'on lit à l'écran.
 */
export function ldBlock(ctx, stats, shown) {
  if (ctx.setting("structuredData") !== true || stats.rated < L.MIN_MARKUP) return null;
  const type = LD_TYPES.includes(ctx.setting("aboutType")) ? ctx.setting("aboutType") : "Service";
  const name = L.clean(ctx.setting("aboutName"), 120);
  if (!name) return null;
  const data = {
    "@context": "https://schema.org", "@type": type, name,
    aggregateRating: { "@type": "AggregateRating", ratingValue: stats.average.toFixed(1), ratingCount: stats.rated, reviewCount: stats.rated, bestRating: 5, worstRating: 1 },
    review: shown.filter((r) => r.rating).slice(0, 10).map((r) => ({
      "@type": "Review", author: { "@type": "Person", name: r.name }, datePublished: L.isoDay(r.publishedAt || r.at), reviewBody: r.text,
      reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5, worstRating: 1 },
    })),
  };
  return { type: "html", html: `<script type="application/ld+json">${L.ldJson(data)}</script>` };
}

// ── Le formulaire ───────────────────────────────────────────────────────────────────────────────────────────────
const FIELD_IDS = { name: "tm-name", rating: "tm-rating", text: "tm-text", email: "tm-email", consent: "tm-consent" };
/**
 * Un vrai formulaire de navigateur (aucun script) : envoyé à /m/<clé>/send. S'il y a une erreur, la personne revient ici avec ce qu'elle avait écrit
 * (`values`), un message SOUS chaque champ à corriger (`errors`), et le premier problème reçoit le focus.
 */
export function form(ctx, { values = {}, errors = {} } = {}) {
  const cfg = L.config(ctx);
  const mode = cfg.ratingMode, max = cfg.maxLength, wantEmail = cfg.askEmail;
  const order = ["name", "rating", "text", "email", "consent"].filter((k) => errors[k]);
  const err = (k) => {
    if (!errors[k]) return "";
    const code = String(errors[k]);
    return `<p class="tm-err" id="${FIELD_IDS[k]}-e">${esc(ctx.t(`err_${code}`, { max, example: "Camille" }))}</p>`;
  };
  const attrs = (k, hintId) => ` aria-describedby="${esc([hintId, errors[k] ? `${FIELD_IDS[k]}-e` : ""].filter(Boolean).join(" "))}"${errors[k] ? ' aria-invalid="true"' : ""}`;
  const summary = order.length ? `<div class="tm-errsum" role="alert" tabindex="-1" autofocus><p>${esc(ctx.t("errSummary", { count: order.length }))}</p><ul>${order.map((k) => `<li><a href="#${FIELD_IDS[k]}">${esc(ctx.t(`field_${k}`))}</a></li>`).join("")}</ul></div>` : "";
  const sel = values.rating ?? null;
  const pills = [
    ...(mode === "optional" ? [`<label class="tm-pill"><input type="radio" name="rating" value=""${sel === null ? " checked" : ""}><span class="tm-box">${esc(ctx.t("noRating"))}</span></label>`] : []),
    ...[1, 2, 3, 4, 5].map((n) => `<label class="tm-pill"><input type="radio" name="rating" value="${n}"${sel === n ? " checked" : ""}><span class="tm-box"><span aria-hidden="true">${n} ★</span><span class="tm-sr">${esc(ctx.t("ratingChoice", { n }))}</span></span></label>`),
  ].join("");
  const html =
    `<form class="tm-form" method="post" action="/m/${esc(ctx.instance.key)}/send?lang=${esc(ctx.locale)}" novalidate>${summary}` +
    `<div class="tm-field"><label for="tm-name">${esc(ctx.t("field_name"))}</label><p class="tm-hint" id="tm-name-h">${esc(ctx.t("hintName"))}</p>` +
    `<input class="tm-in" id="tm-name" name="name" type="text" maxlength="${L.FIELD_MAX.name}" autocomplete="given-name" required value="${esc(values.name ?? "")}"${attrs("name", "tm-name-h")}>${err("name")}</div>` +
    (mode === "none" ? "" : `<fieldset class="tm-field" id="tm-rating" tabindex="-1"><legend>${esc(ctx.t("field_rating"))}${mode === "optional" ? ` <span class="tm-opt">${esc(ctx.t("optional"))}</span>` : ""}</legend><p class="tm-hint" id="tm-rating-h">${esc(ctx.t("hintRating"))}</p><div class="tm-pills" role="radiogroup" aria-describedby="${esc(["tm-rating-h", errors.rating ? "tm-rating-e" : ""].filter(Boolean).join(" "))}">${pills}</div>${err("rating")}</fieldset>`) +
    `<div class="tm-field"><label for="tm-text">${esc(ctx.t("field_text"))}</label><p class="tm-hint" id="tm-text-h">${esc(ctx.t("hintText", { max }))}</p>` +
    `<textarea class="tm-in" id="tm-text" name="text" rows="6" maxlength="${max}" required${attrs("text", "tm-text-h")}>${esc(values.text ?? "")}</textarea>${err("text")}</div>` +
    (wantEmail ? `<div class="tm-field"><label for="tm-email">${esc(ctx.t("field_email"))} <span class="tm-opt">${esc(ctx.t("optional"))}</span></label><p class="tm-hint" id="tm-email-h">${esc(ctx.t("hintEmail", { days: cfg.emailDays }))}</p>` +
      `<input class="tm-in" id="tm-email" name="email" type="email" maxlength="${L.FIELD_MAX.email}" autocomplete="email" inputmode="email" value="${esc(values.email ?? "")}"${attrs("email", "tm-email-h")}>${err("email")}</div>` : "") +
    `<div class="tm-field"><label class="tm-check" for="tm-consent"><input id="tm-consent" name="consent" type="checkbox" value="yes" required${attrs("consent", "tm-consent-h")}><span>${esc(ctx.t("consentText"))}</span></label>` +
    `<p class="tm-hint" id="tm-consent-h">${esc(ctx.t("consentHint"))} <a href="${esc(privacyHref(ctx))}">${esc(ctx.t("privacyLink"))}</a></p>${err("consent")}</div>` +
    `<div class="tm-hp" aria-hidden="true"><label>${esc(ctx.t("trap"))}<input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>` +
    `<div class="tm-field"><button class="tm-btn" type="submit">${esc(ctx.t("send"))}</button><p class="tm-hint">${esc(ctx.t("sendHint"))}</p></div></form>`;
  return { type: "html", html };
}
