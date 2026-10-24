// Événements : ce que voit le visiteur — la liste des événements à venir, le calendrier du mois, la rétrospective, la fiche d'un événement, la section d'accueil.
// Tout est du HTML simple construit ici ; chaque texte venu d'ailleurs (titre, lieu, intervenants…) est échappé. Rien n'a besoin de JavaScript :
// le petit script de la page (scripts/events.js) ajoute seulement l'heure chez le visiteur et le chargement d'une vidéo YouTube après son clic.
const q = new URL(import.meta.url).search;
const X = await import(`./text.mjs${q}`);
const T = await import(`./time.mjs${q}`);
const M = await import(`./model.mjs${q}`);
const D = await import(`./data.mjs${q}`);
const Q = await import(`./query.mjs${q}`);
const U = await import(`./urls.mjs${q}`);
const L = await import(`./links.mjs${q}`);
const TPL = await import(`./templates.mjs${q}`);

const { esc } = X;

export const CSS = `
.ev{max-width:62rem;margin:0;color:var(--v-fg)}
.ev *,.ev *::before,.ev *::after{box-sizing:border-box}
.ev [hidden]{display:none!important}
.ev a{color:inherit}
.ev a:focus-visible,.ev button:focus-visible,.ev input:focus-visible,.ev select:focus-visible{outline:2px solid var(--v-accent);outline-offset:2px}
.ev-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.ev-intro{margin:0 0 1.25rem;color:var(--v-muted)}
.ev-intro p{margin:0 0 .5rem}
.ev-intro a,.ev-text a,.ev-note a{text-decoration:underline;text-decoration-color:var(--v-accent);text-decoration-thickness:2px;text-underline-offset:3px}
.ev-views{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 1rem;padding:0;list-style:none}
.ev-views a,.ev-chips a,.ev-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 1rem;border:1px solid var(--v-line);border-radius:999px;background:var(--v-surface);color:var(--v-fg);font:inherit;text-decoration:none;cursor:pointer}
.ev-views a:hover,.ev-chips a:hover,.ev-btn:hover{border-color:var(--v-accent)}
.ev-views a[aria-current],.ev-chips a[aria-current]{border-color:var(--v-accent);box-shadow:inset 0 0 0 1px var(--v-accent);font-weight:600}
.ev-btn-main{border-color:transparent;background:var(--v-accent);color:var(--v-accent-fg);font-weight:600}
.ev-btn-main:hover{border-color:transparent;filter:brightness(1.08)}
.ev-search{margin:0 0 1rem}
.ev-search label{display:block;margin:0 0 .35rem;font-weight:600}
.ev-searchrow{display:flex;gap:.5rem}
.ev-searchrow input[type=search]{flex:1 1 auto;min-width:0;min-height:44px;padding:.6rem .9rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface);color:var(--v-fg);font:inherit}
.ev-searchrow input::placeholder{color:var(--v-muted);opacity:1}
.ev-chips{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 1.25rem;padding:0;list-style:none}
.ev-chips .ev-dot{margin-right:.45rem}
.ev-list{display:grid;gap:.75rem;margin:0 0 1.25rem;padding:0;list-style:none}
.ev-card{position:relative;display:flex;gap:1rem;align-items:flex-start;padding:1rem;border:1px solid var(--v-line);border-radius:14px;background:var(--v-surface)}
.ev-card:hover{border-color:var(--v-accent)}
.ev-card:focus-within{outline:2px solid var(--v-accent);outline-offset:2px}
.ev-badge{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;width:3.75rem;min-height:3.75rem;padding:.35rem 0;border:1px solid var(--v-line);border-radius:12px;background:var(--v-bg);line-height:1.1;text-align:center}
.ev-badge-m{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--v-muted)}
.ev-badge-d{font-size:1.5rem;font-weight:700}
.ev-card-body{flex:1 1 auto;min-width:0}
.ev-card-title{margin:0 0 .25rem;font-size:1.15rem;line-height:1.3;overflow-wrap:anywhere}
.ev-card-link{text-decoration:none}
.ev-card-link::after{content:"";position:absolute;inset:0;border-radius:14px}
.ev-card-link:focus-visible{outline:none}
.ev-meta{margin:0 0 .35rem;color:var(--v-muted);overflow-wrap:anywhere}
.ev-tags{display:flex;flex-wrap:wrap;gap:.4rem;margin:0;padding:0;list-style:none}
.ev-type,.ev-chip{display:inline-flex;align-items:center;min-height:28px;padding:0 .7rem;border:1px solid var(--v-line);border-radius:999px;background:var(--v-bg);font-size:.85rem;line-height:1.2}
.ev-dot{display:inline-block;width:.7rem;height:.7rem;border-radius:50%;background:var(--ev-c,var(--v-accent));flex:0 0 auto;margin-right:.4rem}
.ev-chip-warn{border-color:var(--v-warning);background:var(--v-bg);font-weight:600}
.ev-chip-danger{border-color:var(--v-danger);background:var(--v-bg);font-weight:600}
.ev-chip-ok{border-color:var(--v-success);background:var(--v-bg)}
.ev-card.ev-is-cancelled .ev-card-title a{text-decoration:line-through;text-decoration-thickness:2px}
.ev-card.ev-is-past:not(:hover){opacity:.92}
.ev-empty-state{padding:1.25rem;border:1px dashed var(--v-line);border-radius:14px;color:var(--v-muted)}
.ev-empty-state p{margin:0 0 .5rem}
.ev-pager{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem;margin:0 0 1rem}
.ev-pager span{color:var(--v-muted)}
.ev-pager a{display:inline-flex;align-items:center;min-height:44px;padding:0 1rem;border:1px solid var(--v-line);border-radius:999px;background:var(--v-surface);text-decoration:none}
.ev-pager a:hover{border-color:var(--v-accent)}
.ev-calnav{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin:0 0 .75rem}
.ev-calnav h2{margin:0;font-size:1.25rem;text-align:center}
.ev-calnav a{display:inline-flex;align-items:center;min-height:44px;padding:0 1rem;border:1px solid var(--v-line);border-radius:999px;background:var(--v-surface);text-decoration:none}
.ev-calnav a:hover{border-color:var(--v-accent)}
.ev-calsub{display:flex;justify-content:center;margin:0 0 .75rem}
.ev-cal{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;border:1px solid var(--v-line);border-radius:14px;overflow:hidden;background:var(--v-surface)}
.ev-cal th{padding:.5rem .25rem;border-bottom:1px solid var(--v-line);font-size:.85rem;font-weight:600;color:var(--v-muted);text-align:center}
.ev-cal th abbr{text-decoration:none}
.ev-cal td{vertical-align:top;height:6.5rem;padding:.35rem;border-right:1px solid var(--v-line);border-bottom:1px solid var(--v-line)}
.ev-cal td:last-child{border-right:0}
.ev-cal tr:last-child td{border-bottom:0}
.ev-day.ev-out{background:var(--v-bg);color:var(--v-muted)}
.ev-day.ev-today .ev-dnum{display:inline-block;min-width:1.7rem;padding:0 .35rem;border-radius:999px;background:var(--v-accent);color:var(--v-accent-fg);font-weight:700;text-align:center}
.ev-dnum{display:block;margin:0 0 .25rem;font-size:.9rem;font-weight:600}
.ev-dname{display:none}
.ev-dev{margin:0;padding:0;list-style:none;display:grid;gap:.2rem}
.ev-dev a{display:block;padding:.2rem .35rem;border-left:3px solid var(--ev-c,var(--v-accent));border-radius:4px;background:var(--v-bg);font-size:.8rem;line-height:1.25;text-decoration:none;overflow-wrap:anywhere}
.ev-dev a:hover{background:var(--v-line)}
.ev-dev a.ev-is-cancelled{text-decoration:line-through}
@media (max-width:640px){
  .ev-cal,.ev-cal tbody,.ev-cal tr,.ev-cal td{display:block;width:100%}
  .ev-cal thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  .ev-cal td{height:auto;border-right:0}
  .ev-cal td.ev-nothing{display:none}
  .ev-cal tr{border-bottom:0}
  .ev-dname{display:inline;margin-right:.35rem;color:var(--v-muted);font-weight:400}
  .ev-dev a{padding:.5rem .6rem;font-size:.95rem}
  .ev-card{padding:.85rem;gap:.75rem}
  .ev-badge{width:3.25rem;min-height:3.25rem}
}
.ev-banner{margin:0 0 1rem;padding:.8rem 1rem;border:1px solid var(--v-line);border-left-width:6px;border-radius:12px;background:var(--v-surface);font-weight:600}
.ev-banner-warn{border-left-color:var(--v-warning)}
.ev-banner-danger{border-left-color:var(--v-danger)}
.ev-banner-info{border-left-color:var(--v-accent)}
.ev-hero{display:block;width:100%;max-height:26rem;object-fit:cover;margin:0 0 1rem;border-radius:14px;background:var(--v-surface)}
.ev-info{display:grid;gap:.9rem;margin:0 0 1.25rem;padding:1rem;border:1px solid var(--v-line);border-radius:14px;background:var(--v-surface)}
.ev-info dt{margin:0 0 .15rem;font-size:.85rem;font-weight:600;color:var(--v-muted)}
.ev-info dd{margin:0;overflow-wrap:anywhere}
.ev-local{margin:.2rem 0 0;font-weight:600}
.ev-actions{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 1.5rem}
.ev-h{margin:1.75rem 0 .6rem;font-size:1.2rem;line-height:1.3}
.ev-text p{margin:0 0 .75rem}
.ev-text ul,.ev-text ol{margin:0 0 .75rem;padding-left:1.4rem}
.ev-text ul{list-style:disc}.ev-text ol{list-style:decimal}
.ev-program{margin:0;padding:0;list-style:none;display:grid;gap:.5rem}
.ev-program li{display:flex;gap:1rem;padding:.7rem .9rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface)}
.ev-slot-time{flex:0 0 7.5rem;font-weight:700}
.ev-slot-body{min-width:0;overflow-wrap:anywhere}
.ev-slot-body small{display:block;color:var(--v-muted);font-size:.9rem}
.ev-slot-local{display:block;color:var(--v-muted);font-size:.85rem;font-weight:400}
.ev-speakers{margin:0;padding:0;list-style:none;display:grid;gap:.5rem}
.ev-speakers li{padding:.6rem .9rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface)}
.ev-speakers a{font-weight:600;text-decoration-color:var(--v-accent);text-underline-offset:3px}
.ev-speakers span{display:block;color:var(--v-muted);font-size:.9rem}
.ev-video{margin:0 0 1rem}
.ev-video video,.ev-video iframe{display:block;width:100%;aspect-ratio:16/9;border:0;border-radius:14px;background:var(--v-surface)}
.ev-note{margin:.4rem 0 0;color:var(--v-muted);font-size:.9rem}
.ev-souvenirs{padding:1rem;border:1px solid var(--v-line);border-radius:14px;background:var(--v-surface)}
.ev-souvenirs .ev-actions{margin:0}
.ev-home-list{display:grid;gap:.5rem;margin:0 0 .75rem;padding:0;list-style:none}
@media (prefers-reduced-motion:reduce){.ev *{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
`;

// ── Les mots du site : viennent des réglages, jamais du code ──────────────────────────────────────────────────────────

export function vocab(ctx) {
  const one = X.clean(ctx.setting("wordOne"), 40) || ctx.t("wordOneDefault");
  const many = X.clean(ctx.setting("wordMany"), 40) || ctx.t("wordManyDefault");
  return { one, many, oneLower: inSentence(one), manyLower: inSentence(many) };
}

/** Un mot du site au milieu d'une phrase : « Ateliers » devient « ateliers », mais « Les Rencontres » reste tel que la propriétaire l'a écrit. */
export const inSentence = (word) => (/^\p{Lu}\p{Ll}*$/u.test(word) ? word.toLowerCase() : word);

/** Le nom de la page des rendez-vous passés : celui du réglage, sinon « Rétrospective ». */
export const pastLabel = (ctx) => X.clean(ctx.setting("pastTitle"), 80) || ctx.t("pastTitleDefault");

export const typeNames = (ctx, data) => new Map(data.types.map((t) => [t.key, M.typeName(t, ctx.locale, ctx.defaultLocale)]));

const lang = (ctx) => (X.safeLang(ctx.locale) ? ctx.locale : "en");

/** Le jour et l'heure d'un événement, écrits pour la langue, DANS LE FUSEAU DE L'ÉVÉNEMENT (c'est ce que lit un visiteur sans JavaScript). */
export function whenText(ctx, ev, { withZone = false, short = false } = {}) {
  const l = lang(ctx);
  const dayOpts = short ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "long", day: "numeric", month: "long", year: "numeric" };
  const noYear = { weekday: "long", day: "numeric", month: "long" };
  const sameYear = ev.date.slice(0, 4) === ev.lastDay.slice(0, 4);
  const day = T.cap(T.dayText(ev.date, l, dayOpts));
  const zone = withZone && !ev.allDay ? ` (${T.zoneName(ev.startMs, ev.zone, l)})` : "";
  if (ev.allDay) {
    if (ev.lastDay === ev.date) return day;
    return ctx.t("whenMulti", { from: T.dayText(ev.date, l, sameYear ? noYear : dayOpts), to: T.dayText(ev.lastDay, l, dayOpts) });
  }
  const from = T.timeText(ev.time, l);
  const endDay = T.dayIn(ev.endMs - 1, ev.zone);
  const endWall = T.zoneParts(ev.endMs, ev.zone);
  const endTime = T.clockText(endWall.h, endWall.mi, l);
  const explicitEnd = !!(ev.endTime || ev.endDate);
  if (!explicitEnd) return `${ctx.t("whenAt", { day, time: from })}${zone}`;
  if (endDay === ev.date) return `${ctx.t("whenRange", { day, from, to: endTime })}${zone}`;
  return `${ctx.t("whenMultiTimed", { from: `${T.dayText(ev.date, l, sameYear ? noYear : dayOpts)} ${ctx.t("atWord")} ${from}`, to: `${T.dayText(endDay, l, dayOpts)} ${ctx.t("atWord")} ${endTime}` })}${zone}`;
}

/** La date d'une carte, sur une ligne courte : « sam. 14 nov. · 21 h ». */
function shortWhen(ctx, ev) {
  const l = lang(ctx);
  const day = ev.lastDay !== ev.date ? `${T.dayText(ev.date, l, { day: "numeric", month: "short" })} – ${T.dayText(ev.lastDay, l, { day: "numeric", month: "short" })}` : T.dayText(ev.date, l, { weekday: "short", day: "numeric", month: "short" });
  return ev.allDay ? T.cap(day) : `${T.cap(day)} · ${T.timeText(ev.time, l)}`;
}

/** Les places : « Complet », « Il reste 1 place », « Il reste 4 places sur 20 » ; vide quand on ne sait pas ou que ça n'a plus de sens. */
export function seatsText(ctx, ev, now) {
  if (ev.state === "cancelled" || ev.endMs <= now) return "";
  if (ev.state === "full" || ev.seatsLeft === 0) return ctx.t("seatsFull");
  if (ev.seatsLeft === null) return "";
  if (ev.seatsTotal !== null && ev.seatsTotal >= ev.seatsLeft) return ctx.t("seatsOfTotal", { n: ev.seatsLeft, total: ev.seatsTotal });
  return ctx.t(ev.seatsLeft === 1 ? "seatsOne" : "seatsMany", { n: ev.seatsLeft });
}

const typeChip = (ctx, data, ev) => {
  const t = data.typeByKey.get(ev.type);
  if (!t) return "";
  const name = M.typeName(t, ctx.locale, ctx.defaultLocale);
  return `<li><span class="ev-type" style="--ev-c:${TPL.colorCss(t.color)}"><span class="ev-dot" aria-hidden="true"></span>${t.icon ? `<span aria-hidden="true">${esc(t.icon)}&nbsp;</span>` : ""}${esc(name)}</span></li>`;
};

function stateChips(ctx, ev, now) {
  const out = [];
  if (ev.state === "cancelled") out.push(`<li><span class="ev-chip ev-chip-danger">${esc(ctx.t("stateCancelled"))}</span></li>`);
  else if (ev.state === "postponed") out.push(`<li><span class="ev-chip ev-chip-warn">${esc(ctx.t("statePostponed"))}</span></li>`);
  const seats = seatsText(ctx, ev, now);
  if (seats) out.push(`<li><span class="ev-chip ${ev.state === "full" || ev.seatsLeft === 0 ? "ev-chip-warn" : "ev-chip-ok"}">${esc(seats)}</span></li>`);
  return out.join("");
}

function card(ctx, data, ev, now, { retro = false } = {}) {
  const href = U.eventHref(ctx, ev);
  const l = lang(ctx);
  const day = T.parseDate(ev.date);
  const month = T.dayText(ev.date, l, { month: "short" });
  const has = retro && (ev.albumId || ev.albumLink || ev.videoId);
  const tags = typeChip(ctx, data, ev) + stateChips(ctx, ev, now) + (has ? `<li><span class="ev-chip">${esc(ctx.t("cardMemories"))}</span></li>` : "");
  return `<li class="ev-card ev-is-${esc(ev.state)}${ev.endMs <= now ? " ev-is-past" : ""}">`
    + `<time class="ev-badge" datetime="${esc(ev.date)}"><span class="ev-badge-m">${esc(month)}</span><span class="ev-badge-d">${day ? day.d : ""}</span></time>`
    + `<div class="ev-card-body"><h2 class="ev-card-title"><a class="ev-card-link" href="${esc(href ?? "#")}">${esc(ev.title)}</a></h2>`
    + `<p class="ev-meta">${esc(shortWhen(ctx, ev))}${ev.place ? ` · ${esc(ev.place)}` : ""}</p>`
    + (tags ? `<ul class="ev-tags">${tags}</ul>` : "")
    + `</div></li>`;
}

// ── Les barres du haut : vues, recherche, types ─────────────────────────────────────────────────────────────────────

function toolbar(ctx, data, req, v, { search = true, types = true } = {}) {
  const link = (mode, label, extra = {}) => {
    const r = { mode, type: req.type, words: req.words, page: 1, ...extra };
    const current = req.mode === mode;
    return `<li><a href="${esc(U.hrefFor(ctx, r) ?? "#")}"${current ? ' aria-current="page"' : ""}>${esc(label)}</a></li>`;
  };
  const views = `<ul class="ev-views" aria-label="${esc(ctx.t("viewsLabel"))}">${link("list", ctx.t("viewUpcoming"))}${link("cal", ctx.t("viewCalendar"), { words: [] })}${D.flag(ctx, "showPast", true) ? link("past", pastLabel(ctx)) : ""}</ul>`;
  const form = search ? `<form class="ev-search" role="search" method="get" action="${esc(U.routeHref(ctx, "find"))}">`
    + `<input type="hidden" name="v" value="${esc(req.mode === "event" ? "list" : req.mode)}">${req.type ? `<input type="hidden" name="t" value="${esc(req.type)}">` : ""}${req.month ? `<input type="hidden" name="m" value="${esc(req.month)}">` : ""}`
    + `<label for="ev-q">${esc(ctx.t("searchLabel", { many: v.manyLower }))}</label>`
    + `<div class="ev-searchrow"><input id="ev-q" name="q" type="search" maxlength="${X.LIMITS.query}" value="${esc(req.words.join(" "))}" placeholder="${esc(ctx.t("searchPlaceholder"))}" autocomplete="off"><button class="ev-btn ev-btn-main" type="submit">${esc(ctx.t("searchGo"))}</button></div></form>` : "";
  let chips = "";
  if (types && data.types.length) {
    const used = new Set(data.events.filter((e) => e.status === "published").map((e) => e.type));
    const shown = data.types.filter((t) => used.has(t.key) || t.key === req.type);
    if (shown.length) {
      const one = (key, label, color) => {
        const r = { mode: req.mode === "event" ? "list" : req.mode, type: key, words: req.words, page: 1, month: req.month };
        return `<li><a href="${esc(U.hrefFor(ctx, r) ?? "#")}"${req.type === key ? ' aria-current="true"' : ""}>${color ? `<span class="ev-dot" style="--ev-c:${color}" aria-hidden="true"></span>` : ""}${esc(label)}</a></li>`;
      };
      chips = `<ul class="ev-chips" aria-label="${esc(ctx.t("typesLabel"))}">${one("", ctx.t("typeAll"))}${shown.map((t) => one(t.key, `${t.icon ? `${t.icon} ` : ""}${M.typeName(t, ctx.locale, ctx.defaultLocale)}`, TPL.colorCss(t.color))).join("")}</ul>`;
    }
  }
  return views + form + chips;
}

function pager(ctx, req, p) {
  if (p.pages <= 1) return "";
  const at = (n) => esc(U.hrefFor(ctx, { ...req, page: n }) ?? "#");
  return `<nav class="ev-pager" aria-label="${esc(ctx.t("pagerLabel"))}">${p.page > 1 ? `<a rel="prev" href="${at(p.page - 1)}">${esc(ctx.t("pagerPrev"))}</a>` : "<span></span>"}<span>${esc(ctx.t("pagerPage", { page: p.page, pages: p.pages }))}</span>${p.page < p.pages ? `<a rel="next" href="${at(p.page + 1)}">${esc(ctx.t("pagerNext"))}</a>` : "<span></span>"}</nav>`;
}

function emptyState(ctx, req, v, kind) {
  const filtered = req.type || req.words.length;
  const clear = filtered ? `<p><a href="${esc(U.hrefFor(ctx, { mode: kind, type: "", words: [], page: 1, month: req.month }) ?? "#")}">${esc(ctx.t("emptyClear"))}</a></p>` : "";
  const key = filtered ? "emptyFiltered" : kind === "past" ? "emptyPast" : "emptyUpcoming";
  return `<div class="ev-empty-state"><p>${esc(ctx.t(key))}</p>${clear}</div>`;
}

const wrap = (ctx, inner, extra = "") => `<div class="ev" lang="${esc(lang(ctx))}" data-ev-cfg="${esc(clientConfig(ctx))}"><style>${CSS}</style>${extra}${inner}</div>`;

/** Les phrases dont le petit script a besoin (écrites ici, dans la langue du visiteur : le script ne contient aucun texte). */
function clientConfig(ctx) {
  return JSON.stringify({ lang: lang(ctx), today: ctx.t("jsToday"), tomorrow: ctx.t("jsTomorrow"), at: ctx.t("atWord"), local: ctx.t("jsLocal"), slot: ctx.t("jsSlot"), video: ctx.t("jsVideoFrame") });
}

// ── Les pages ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function listPage(ctx, data, req, now) {
  const v = vocab(ctx);
  const names = typeNames(ctx, data);
  const filter = { type: req.type, words: req.words };
  const all = Q.upcoming(D.visible(data), now, filter, names);
  const p = Q.paginate(all, req.page, D.perPage(ctx));
  if (req.page > p.pages && req.page > 1) return null;
  const intro = X.renderText(ctx.setting("intro"), 2000);
  const body = p.items.length ? `<ol class="ev-list">${p.items.map((e) => card(ctx, data, e, now)).join("")}</ol>${pager(ctx, req, p)}` : emptyState(ctx, req, v, "list");
  const feed = D.flag(ctx, "subscribe", true) && all.length ? `<p class="ev-note"><a href="${esc(U.routeHref(ctx, "feed.ics"))}">${esc(ctx.t("subscribeLink"))}</a></p>` : "";
  const html = wrap(ctx, `${intro ? `<div class="ev-intro">${intro}</div>` : ""}${toolbar(ctx, data, req, v)}${body}${feed}`);
  return { title: X.clean(ctx.instance.name, 80) || v.many, description: X.plainText(ctx.setting("intro"), 160) || ctx.t("pageDescription", { many: v.manyLower }), html };
}

export function pastPage(ctx, data, req, now) {
  const v = vocab(ctx);
  const names = typeNames(ctx, data);
  const all = Q.past(D.visible(data), now, { type: req.type, words: req.words }, names);
  const p = Q.paginate(all, req.page, D.perPage(ctx));
  if (req.page > p.pages && req.page > 1) return null;
  const body = p.items.length ? `<ol class="ev-list">${p.items.map((e) => card(ctx, data, e, now, { retro: true })).join("")}</ol>${pager(ctx, req, p)}` : emptyState(ctx, req, v, "past");
  return { title: pastLabel(ctx), description: ctx.t("pastDescription"), html: wrap(ctx, `${toolbar(ctx, data, req, v)}${body}`) };
}

export function calendarPage(ctx, data, req, now) {
  const v = vocab(ctx);
  const names = typeNames(ctx, data);
  const l = lang(ctx);
  const todayKey = T.dayIn(now, data.zone);
  const monthStr = req.month || todayKey.slice(0, 7);
  const m = T.parseMonth(monthStr);
  if (!m) return null;
  const weeks = T.monthWeeks(m.y, m.mo, D.weekStart(ctx));
  const first = weeks[0][0].date, last = weeks[weeks.length - 1][6].date;
  const map = Q.byDay(D.visible(data), first, last, { type: req.type, words: req.words }, names);
  const head = weeks[0].map((c) => `<th scope="col"><abbr title="${esc(T.dayText(c.date, l, { weekday: "long" }))}">${esc(T.dayText(c.date, l, { weekday: "short" }))}</abbr></th>`).join("");
  let inMonth = 0;
  const rows = weeks.map((w) => `<tr>${w.map((c) => {
    const evs = map.get(c.date) ?? [];
    if (c.inMonth) inMonth += evs.length;
    const cls = ["ev-day", c.inMonth ? "" : "ev-out", c.date === todayKey ? "ev-today" : "", evs.length ? "" : "ev-nothing"].filter(Boolean).join(" ");
    const dn = Number(c.date.slice(8));
    const items = evs.map((e) => {
      const t = data.typeByKey.get(e.type);
      const when = e.allDay || e.date !== c.date ? "" : `${T.timeText(e.time, l)} `;
      return `<li><a class="ev-is-${esc(e.state)}" style="--ev-c:${t ? TPL.colorCss(t.color) : "var(--v-accent)"}" href="${esc(U.eventHref(ctx, e) ?? "#")}">${esc(when)}${esc(e.title)}${e.state === "cancelled" ? ` <span class="ev-sr">(${esc(ctx.t("stateCancelled"))})</span>` : ""}</a></li>`;
    }).join("");
    return `<td class="${cls}"><span class="ev-dnum"><span class="ev-dname">${esc(T.dayText(c.date, l, { weekday: "short" }))}</span><time datetime="${esc(c.date)}">${dn}</time></span>${items ? `<ul class="ev-dev">${items}</ul>` : ""}</td>`;
  }).join("")}</tr>`).join("");
  const title = T.cap(T.dayText(`${monthStr}-01`, l, { month: "long", year: "numeric" }));
  const prev = T.shiftMonth(monthStr, -1), next = T.shiftMonth(monthStr, 1);
  const href = (month) => esc(U.hrefFor(ctx, { mode: "cal", type: req.type, words: req.words, month, page: 1 }) ?? "#");
  const nav = `<nav class="ev-calnav" aria-label="${esc(ctx.t("calNavLabel"))}"><a rel="prev" href="${href(prev)}">${esc(ctx.t("calPrev"))}</a><h2>${esc(title)}</h2><a rel="next" href="${href(next)}">${esc(ctx.t("calNext"))}</a></nav>`
    + (monthStr !== todayKey.slice(0, 7) ? `<p class="ev-calsub"><a href="${esc(U.hrefFor(ctx, { mode: "cal", type: req.type, words: req.words, month: "", page: 1 }) ?? "#")}">${esc(ctx.t("calToday"))}</a></p>` : "");
  const empty = inMonth === 0 ? `<p class="ev-note">${esc(ctx.t("calEmpty"))}</p>` : "";
  const table = `<table class="ev-cal"><caption class="ev-sr">${esc(ctx.t("calCaption", { month: title }))}</caption><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  return { title: X.clean(ctx.instance.name, 80) || v.many, description: ctx.t("calDescription", { month: title }), html: wrap(ctx, `${toolbar(ctx, data, { ...req, mode: "cal" }, v)}${nav}${table}${empty}`) };
}

// ── La fiche d'un événement ────────────────────────────────────────────────────────────────────────────────────────

function mapLink(ctx, ev) {
  if (ev.lat === null || ev.lng === null || !D.flag(ctx, "mapLink", true)) return "";
  const la = ev.lat.toFixed(6), lo = ev.lng.toFixed(6);
  return `<a href="https://www.openstreetmap.org/?mlat=${la}&amp;mlon=${lo}#map=16/${la}/${lo}" rel="noopener noreferrer" target="_blank">${esc(ctx.t("seeOnMap"))}<span class="ev-sr"> (${esc(ctx.t("newTab"))})</span></a>`;
}

function programHtml(ctx, ev) {
  if (!ev.program.length) return "";
  const l = lang(ctx);
  const items = ev.program.map((s) => {
    const d = T.parseDate(ev.date);
    const t = T.splitTime(s.time);
    const ms = d && t ? T.zonedToUtc(d.y, d.mo, d.d, t.h, t.mi, ev.zone).ms : NaN;
    const range = s.end ? `${T.timeText(s.time, l)} – ${T.timeText(s.end, l)}` : T.timeText(s.time, l);
    const local = Number.isFinite(ms) ? `<span class="ev-slot-local" data-ev-slot="${ms}" data-tz="${esc(ev.zone)}" hidden></span>` : "";
    return `<li><div class="ev-slot-time"><time datetime="${esc(s.time)}">${esc(range)}</time>${local}</div><div class="ev-slot-body">${esc(s.title)}${s.text ? `<small>${esc(s.text)}</small>` : ""}</div></li>`;
  }).join("");
  return `<h2 class="ev-h">${esc(ctx.t("programTitle"))}</h2><ol class="ev-program">${items}</ol>`;
}

function speakersHtml(ctx, ev) {
  if (!ev.speakers.length) return "";
  const items = ev.speakers.map((s) => `<li>${s.link ? `<a href="${esc(s.link)}"${s.link.startsWith("/") ? "" : ' rel="noopener noreferrer"'}>${esc(s.name)}</a>` : `<strong>${esc(s.name)}</strong>`}${s.role ? `<span>${esc(s.role)}</span>` : ""}</li>`).join("");
  return `<h2 class="ev-h">${esc(ctx.t("speakersTitle"))}</h2><ul class="ev-speakers">${items}</ul>`;
}

function videoHtml(ctx, ev) {
  const yt = X.youtubeId(ev.videoUrl);
  if (yt) {
    return `<div class="ev-video" data-ev-yt="${esc(yt)}"><a class="ev-btn" href="https://www.youtube.com/watch?v=${esc(yt)}" rel="noopener noreferrer" target="_blank">▶&nbsp;${esc(ctx.t("videoPlay"))}<span class="ev-sr"> (${esc(ctx.t("newTab"))})</span></a><p class="ev-note">${esc(ctx.t("videoPrivacy"))}</p></div>`;
  }
  const file = X.videoFile(ev.videoUrl);
  if (file) return `<div class="ev-video"><video controls preload="none" src="${esc(file)}"><a href="${esc(file)}">${esc(ctx.t("videoFallback"))}</a></video></div>`;
  return "";
}

/** Les souvenirs d'un événement passé : l'album photo et la vidéo liés (relus chez leur propriétaire, jamais copiés). */
async function memories(ctx, ev) {
  const buttons = [];
  let unavailable = false;
  if (ev.albumId) {
    const r = await L.albumById(ctx, ev.albumId);
    if (r.album) buttons.push(`<a class="ev-btn ev-btn-main" href="${esc(r.album.url)}">${esc(ctx.t("memPhotos", { title: r.album.title }))}</a>`);
    else if (r.state !== "ok") unavailable = !ev.albumLink;
  }
  if (!buttons.length && ev.albumLink) buttons.push(`<a class="ev-btn ev-btn-main" href="${esc(ev.albumLink)}">${esc(ctx.t("memPhotosLink"))}</a>`);
  if (ev.videoId) {
    const r = await L.videoById(ctx, ev.videoId, ev.videoHint);
    if (r.item) buttons.push(`<a class="ev-btn" href="${esc(r.item.url)}">${esc(ctx.t("memVideo", { title: r.item.title }))}</a>`);
    else if (r.state !== "ok") unavailable = true;
  }
  if (!buttons.length && !unavailable) return "";
  return `<h2 class="ev-h">${esc(ctx.t("memTitle"))}</h2><div class="ev-souvenirs">${buttons.length ? `<div class="ev-actions">${buttons.join("")}</div>` : ""}${unavailable ? `<p class="ev-note">${esc(ctx.t("memUnavailable"))}</p>` : ""}</div>`;
}

/** Les données pour les moteurs de recherche (schema.org « Event »), bornées par le cœur. */
export function structured(ctx, ev, siteName = "") {
  const doc = {
    "@type": "Event",
    name: ev.title,
    startDate: ev.allDay ? ev.date : T.isoWithOffset(ev.startMs, ev.zone),
    eventStatus: `https://schema.org/${ev.state === "cancelled" ? "EventCancelled" : ev.state === "postponed" ? "EventPostponed" : "EventScheduled"}`,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    url: U.eventUrl(ctx, ev) || undefined,
    inLanguage: X.safeLang(ctx.locale) || undefined,
  };
  doc.endDate = ev.allDay ? ev.lastDay : T.isoWithOffset(ev.endMs, ev.zone);
  const description = X.plainText(ev.text, 600);
  if (description) doc.description = description;
  if (ev.place || ev.lat !== null) {
    doc.location = { "@type": "Place", name: ev.place || ev.title };
    if (ev.place) doc.location.address = ev.place;
    if (ev.lat !== null) doc.location.geo = { "@type": "GeoCoordinates", latitude: ev.lat, longitude: ev.lng };
  }
  const image = U.absolute(ctx, ev.image);
  if (image) doc.image = [image];
  if (ev.speakers.length) doc.performer = ev.speakers.slice(0, 20).map((s) => ({ "@type": "Person", name: s.name }));
  if (siteName) doc.organizer = { "@type": "Organization", name: siteName };
  const tag = ctx.api?.seo?.jsonLd ? ctx.api.seo.jsonLd(JSON.parse(JSON.stringify(doc))) : null;
  return tag?.jsonLd ? `<script type="application/ld+json">${X.safeJson(tag.jsonLd)}</script>` : "";
}

export async function eventPage(ctx, data, ev, now) {
  const v = vocab(ctx);
  const past = ev.endMs <= now;
  const banners = [];
  if (ev.state === "cancelled") banners.push(`<p class="ev-banner ev-banner-danger" role="status">${esc(ctx.t("bannerCancelled"))}</p>`);
  else if (ev.state === "postponed") banners.push(`<p class="ev-banner ev-banner-warn" role="status">${esc(ctx.t("bannerPostponed"))}</p>`);
  else if (past) banners.push(`<p class="ev-banner ev-banner-info" role="status">${esc(ctx.t("bannerPast"))}</p>`);
  const t = data.typeByKey.get(ev.type);
  const typeLine = t ? `<dt>${esc(ctx.t("infoType"))}</dt><dd><span class="ev-type" style="--ev-c:${TPL.colorCss(t.color)}"><span class="ev-dot" aria-hidden="true"></span>${t.icon ? `<span aria-hidden="true">${esc(t.icon)}&nbsp;</span>` : ""}${esc(M.typeName(t, ctx.locale, ctx.defaultLocale))}</span></dd>` : "";
  const local = ev.allDay ? "" : `<p class="ev-local" data-ev-local data-start="${ev.startMs}" data-tz="${esc(ev.zone)}" hidden></p>`;
  const where = ev.place || mapLink(ctx, ev) ? `<dt>${esc(ctx.t("infoWhere"))}</dt><dd>${esc(ev.place)}${ev.place && mapLink(ctx, ev) ? " · " : ""}${mapLink(ctx, ev)}</dd>` : "";
  const seats = seatsText(ctx, ev, now);
  const signup = ev.signupUrl && !past && ev.state !== "cancelled" && ev.state !== "full" && ev.seatsLeft !== 0;
  const signupBlock = signup || seats ? `<dt>${esc(ctx.t("infoSignup"))}</dt><dd>${seats ? `<strong>${esc(seats)}</strong>` : ""}${seats && signup ? "<br>" : ""}${signup ? `<a class="ev-btn ev-btn-main" href="${esc(ev.signupUrl)}"${ev.signupUrl.startsWith("/") ? "" : ' rel="noopener noreferrer"'}>${esc(ctx.t("signupButton"))}</a>` : ""}</dd>` : "";
  const info = `<dl class="ev-info"><div><dt>${esc(ctx.t("infoWhen"))}</dt><dd><time datetime="${esc(ev.allDay ? ev.date : T.isoWithOffset(ev.startMs, ev.zone))}">${esc(whenText(ctx, ev, { withZone: true }))}</time>${local}</dd></div>${where ? `<div>${where}</div>` : ""}${typeLine ? `<div>${typeLine}</div>` : ""}${signupBlock ? `<div>${signupBlock}</div>` : ""}</dl>`;
  const actions = ev.state === "cancelled" ? "" : `<div class="ev-actions"><a class="ev-btn" href="${esc(U.routeHref(ctx, "ics", `e=${ev.slug}`))}" download>${esc(ctx.t("addToCalendar"))}</a></div>`;
  const img = ev.image ? `<img class="ev-hero" src="${esc(ev.image)}" alt="${esc(ev.imageAlt || ev.title)}" loading="lazy" decoding="async">` : "";
  const text = X.renderText(ev.text);
  const back = U.pageHref(ctx);
  const pastBack = D.flag(ctx, "showPast", true) && past ? U.hrefFor(ctx, { mode: "past", type: "", words: [], page: 1 }) : null;
  const backLinks = `<p class="ev-actions">${back ? `<a class="ev-btn" href="${esc(U.hrefFor(ctx, { mode: "list", type: "", words: [], page: 1 }))}">${esc(ctx.t("backToList", { many: v.manyLower }))}</a>` : ""}${pastBack ? `<a class="ev-btn" href="${esc(pastBack)}">${esc(ctx.t("backToPast"))}</a>` : ""}</p>`;
  const mem = past && ev.state !== "cancelled" ? await memories(ctx, ev) : "";
  let siteName = "";
  try { siteName = X.clean((await ctx.api.site?.(ctx.locale))?.name ?? "", 120); } catch { siteName = ""; }
  const ld = ev.status === "published" ? structured(ctx, ev, siteName) : "";
  const inner = `${banners.join("")}${img}${info}${actions}${text ? `<div class="ev-text">${text}</div>` : ""}${programHtml(ctx, ev)}${speakersHtml(ctx, ev)}${ev.videoUrl ? `<h2 class="ev-h">${esc(ctx.t("videoTitle"))}</h2>${videoHtml(ctx, ev)}` : ""}${mem}${backLinks}${ld}`;
  return { title: ev.title, description: X.plainText(ev.text, 160) || whenText(ctx, ev), html: wrap(ctx, inner) };
}

// ── La section d'accueil ────────────────────────────────────────────────────────────────────────────────────────────

export function nextSection(ctx, data, now, count) {
  const v = vocab(ctx);
  const list = Q.upcoming(D.visible(data), now, { type: "", words: [] }, new Map()).filter((e) => e.state !== "cancelled").slice(0, count);
  if (!list.length) return null;
  const items = list.map((e) => `<li><a class="ev-card ev-home" href="${esc(U.eventHref(ctx, e) ?? "#")}" style="text-decoration:none"><time class="ev-badge" datetime="${esc(e.date)}"><span class="ev-badge-m">${esc(T.dayText(e.date, lang(ctx), { month: "short" }))}</span><span class="ev-badge-d">${Number(e.date.slice(8))}</span></time><span class="ev-card-body"><strong class="ev-card-title" style="display:block">${esc(e.title)}</strong><span class="ev-meta" style="display:block;margin:0">${esc(shortWhen(ctx, e))}${e.place ? ` · ${esc(e.place)}` : ""}</span></span></a></li>`).join("");
  const href = U.hrefFor(ctx, { mode: "list", type: "", words: [], page: 1 });
  return `<div class="ev" lang="${esc(lang(ctx))}"><style>${CSS}</style><ul class="ev-home-list">${items}</ul>${href ? `<p><a class="ev-btn" href="${esc(href)}">${esc(ctx.t("homeSeeAll", { many: v.manyLower }))}</a></p>` : ""}</div>`;
}
