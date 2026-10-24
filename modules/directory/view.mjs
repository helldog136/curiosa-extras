// Annuaire — la page publique. Aucune saisie de visiteur stockée : tout ce qui s'affiche vient de Contacts (noms, photos, comptes), de la propriétaire (présentations, titres de l'équipe,
// libellés) ou du texte cherché (échappé, jamais gardé). Tout est échappé. Pas de cookie, pas de script, pas de requête vers un autre site : une photo hébergée ailleurs n'est chargée
// qu'APRÈS une action du visiteur (le lien « Afficher les photos »), sauf si la propriétaire en décide autrement dans les réglages.
// Chemins (tout fonctionne sans JavaScript) :
//   /                      la liste (équipe en tête de la première page)        /c/a+b            filtrée par catégories (l'une OU l'autre)
//   /q/helene              recherche (sans accents)                              /s/new            tri : az · new · mix
//   /after/12.3fa09c21b7   page suivante (curseur)                               /photos           montre les photos hébergées ailleurs
//   /p/helene-martin-3fa09c21b7   la fiche d'une personne                        /team             l'équipe          /print/…   version imprimable
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const C = await import(`./contacts.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const Dir = await import(`./directory.mjs${v}`);
const { esc, LIMITS, clean } = P;

const CSS = `
.dr{font-family:var(--v-font,inherit);color:var(--v-fg,inherit);max-width:72rem;margin:0 auto}
.dr *{box-sizing:border-box}
.dr h2,.dr h3,.dr p,.dr ul{margin:0;padding:0}
.dr ul{list-style:none}
.dr .dr-intro{color:var(--v-muted,#aaa);font-size:1.05rem;max-width:42rem;margin:0 0 1.25rem;overflow-wrap:anywhere;white-space:pre-line}
.dr-search{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 .9rem}
.dr-search label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.dr-in{flex:1 1 14rem;min-width:0;min-height:2.75rem;padding:.55rem .9rem;border-radius:.7rem;border:1px solid var(--v-line,#444);background:var(--v-surface,#1c1c1f);color:var(--v-fg,inherit);font:inherit}
.dr-in:focus-visible,.dr-btn:focus-visible,.dr-link:focus-visible,.dr-chip:focus-visible,.dr-card a:focus-visible{outline:2px solid var(--v-fg,currentColor);outline-offset:3px}
.dr-btn{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;padding:.55rem 1.1rem;border-radius:.7rem;border:0;font:inherit;font-weight:600;text-decoration:none;cursor:pointer;background:var(--v-accent,#e8a23b);color:var(--v-accent-fg,#111)}
[data-accent2] .dr-btn{background:var(--v-accent2,#e8a23b);color:var(--v-accent2-fg,#111)}
.dr-btn[aria-disabled]{opacity:.45;cursor:default}
.dr-btn.dr-ghost{background:transparent;color:var(--v-fg,inherit);border:1px solid var(--v-line,#444)}
.dr-link{display:inline-flex;align-items:center;min-height:2.75rem;color:var(--v-fg,inherit);text-decoration:underline;text-underline-offset:.2em}
.dr-bar{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .6rem;margin:0 0 .6rem}
.dr-bar-t{color:var(--v-muted,#aaa);font-size:.9rem}
.dr-chips{display:flex;flex-wrap:wrap;gap:.45rem}
.dr-chip{display:inline-flex;align-items:center;gap:.4rem;min-height:2.75rem;padding:.35rem .9rem;border-radius:999px;border:1px solid var(--v-line,#444);background:var(--v-surface,#1c1c1f);color:var(--v-fg,inherit);text-decoration:none;font-size:.95rem}
.dr-chip small{color:var(--v-muted,#aaa);font-size:.8rem}
.dr-chip[aria-current]{background:var(--v-accent,#e8a23b);color:var(--v-accent-fg,#111);border-color:transparent;font-weight:700}
.dr-chip[aria-current] small{color:inherit;opacity:.8}
[data-accent2] .dr-chip[aria-current]{background:var(--v-accent2,#e8a23b);color:var(--v-accent2-fg,#111)}
.dr-count{margin:.9rem 0 1rem;color:var(--v-muted,#aaa);font-size:.95rem}
.dr-sec{margin:0 0 2rem}
.dr-sec>h2{font-size:1.35rem;font-weight:800;line-height:1.25;margin:0 0 .9rem;overflow-wrap:anywhere}
.dr-grid{display:grid;gap:.75rem;grid-template-columns:repeat(2,minmax(0,1fr))}
.dr-card{display:flex;flex-direction:column;align-items:center;gap:.5rem;padding:1rem .6rem .9rem;text-align:center;background:var(--v-surface,#1c1c1f);border:1px solid var(--v-line,#333);border-radius:1rem;min-width:0}
.dr-av{position:relative;flex:0 0 auto;width:5rem;aspect-ratio:1;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--v-accent,#e8a23b) 24%,var(--v-surface,#1c1c1f));border:2px solid var(--v-line,#333);font-weight:800;font-size:1.45rem;color:var(--v-fg,inherit)}
.dr-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.dr-name{font-weight:700;line-height:1.3;overflow-wrap:anywhere;max-width:100%}
.dr-name a{color:inherit;text-decoration:none;display:inline-block;padding:.35rem .1rem;min-height:2.75rem}
.dr-name a:hover{text-decoration:underline}
.dr-sub{color:var(--v-muted,#aaa);font-size:.9rem;line-height:1.35;overflow-wrap:anywhere}
.dr-role{font-weight:600;color:var(--v-fg,inherit);font-size:.92rem;line-height:1.3;overflow-wrap:anywhere}
.dr-tags{display:flex;flex-wrap:wrap;justify-content:center;gap:.3rem}
.dr-tag{display:inline-block;padding:.12rem .6rem;border-radius:999px;border:1px solid var(--v-line,#444);font-size:.78rem;line-height:1.5;color:var(--v-muted,#aaa);overflow-wrap:anywhere}
.dr-links{display:flex;flex-wrap:wrap;justify-content:center;gap:0 .7rem}
.dr-links a{display:inline-flex;align-items:center;min-height:2.75rem;color:var(--v-fg,inherit);font-size:.88rem;text-decoration:underline;text-underline-offset:.2em;overflow-wrap:anywhere}
.dr-team .dr-card{border-color:color-mix(in srgb,var(--v-accent,#e8a23b) 55%,var(--v-line,#333))}
.dr .dr-nav{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin:1.5rem 0 0;max-width:28rem}.dr-pg{grid-column:1/-1;order:-1;color:var(--v-muted,#aaa)}
.dr-empty{padding:2.25rem 1.25rem;text-align:center;border:1px dashed var(--v-line,#333);border-radius:1rem;background:var(--v-surface,#1c1c1f)}
.dr-empty-t{font-size:1.15rem;font-weight:700}
.dr .dr-empty-s{color:var(--v-muted,#aaa);margin:.35rem 0 .9rem}
.dr-foot{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem 1.2rem;margin:2rem 0 0;padding:1rem 0 0;border-top:1px solid var(--v-line,#333)}
.dr-person{display:flex;flex-direction:column;align-items:center;gap:1.1rem;text-align:center;padding:1.75rem 1.25rem;margin:0 0 2rem;background:var(--v-surface,#1c1c1f);border:1px solid var(--v-line,#333);border-radius:1.25rem;position:relative;overflow:hidden}
.dr-person::before{content:"";position:absolute;inset:0 0 auto 0;height:5px;background:var(--v-gradient,var(--v-accent,#e8a23b))}
.dr-person .dr-av{width:8rem;font-size:2.2rem}
.dr-person h2{font-size:1.7rem;font-weight:800;line-height:1.2;overflow-wrap:anywhere}
.dr-bio{max-width:36rem;font-size:1.05rem;line-height:1.55;overflow-wrap:anywhere;white-space:pre-line}
.dr-back{margin:0 0 1rem}
.dr-table{width:100%;border-collapse:collapse;font-size:.95rem}
.dr-table th,.dr-table td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid var(--v-line,#444);vertical-align:top;overflow-wrap:anywhere}
@media (min-width:36rem){.dr-grid{grid-template-columns:repeat(auto-fill,minmax(10rem,1fr));gap:1rem}.dr-card{padding:1.15rem .75rem 1rem}.dr-av{width:5.5rem}.dr-person{flex-direction:row;text-align:left;align-items:flex-start;gap:2rem;padding:2rem}.dr-person .dr-tags,.dr-person .dr-links{justify-content:flex-start}}
@media (prefers-reduced-motion:no-preference){.dr-card{transition:transform .15s ease,border-color .15s ease}.dr-card:hover{transform:translateY(-2px);border-color:var(--v-accent,#e8a23b)}}
@media print{.dr{max-width:none;color:#000}.dr-noprint{display:none!important}.dr-table th,.dr-table td{border-bottom:1px solid #999}.dr-card,.dr-person{break-inside:avoid;background:#fff;border-color:#999}.dr a{color:#000;text-decoration:none}}
`.replace(/\n/g, "");

const EMAIL = /^[^@\s<>"',;()]{1,64}@[^@\s<>"',;()]{1,200}\.[^@\s<>"',;()]{2,40}$/;

/* ───────────── Les réglages d'affichage, bornés ───────────── */

/** Les réglages d'affichage de l'annuaire. */
export function displayOf(ctx) {
  const photosRaw = ctx.setting("photos");
  const linksRaw = ctx.setting("links");
  return {
    perPage: P.int(ctx.setting("perPage"), LIMITS.perPageDefault, 6, LIMITS.perPageMax),
    sort: P.SORTS.includes(ctx.setting("sort")) ? ctx.setting("sort") : "az",
    photos: ["request", "always", "never"].includes(photosRaw) ? photosRaw : "request",
    links: ["list", "detail", "none"].includes(linksRaw) ? linksRaw : "detail",
    bio: P.bool(ctx.setting("bio"), true),
    structured: P.bool(ctx.setting("structured"), false),
    downloads: P.bool(ctx.setting("downloads"), true),
  };
}

/** Les mots de la page : le réglage de la propriétaire, sinon le mot du gabarit choisi, sinon le mot neutre de la langue. */
export function wordsOf(ctx, config) {
  const starter = config?.vocab?.[ctx.locale] ?? config?.vocab?.[ctx.defaultLocale] ?? {};
  const pick = (key, fallback) => clean(ctx.setting(key), 80) || starter[key] || ctx.t(fallback);
  // Les clés de réglage et celles du gabarit portent le même nom (title, noun, nouns) sauf l'équipe : `teamTitle` (réglage) · `team` (gabarit).
  return { title: pick("title", "pageTitle"), noun: pick("noun", "nounOne"), nouns: pick("nouns", "nounMany"), team: clean(ctx.setting("teamTitle"), 80) || starter.team || ctx.t("teamTitle") };
}

export const baseOf = (ctx) => P.sitePath(ctx.instance.basePath);
const path = (ctx, rest = "") => `${baseOf(ctx)}${rest}` || "/";

/* ───────────── Charger l'annuaire ───────────── */

/** Tout ce qu'il faut pour répondre : { state: "ok", model, view, data, words, display } ou { state: "absent" | "unready" | "slow", reason? }. */
export async function load(ctx, opts = {}) {
  const model = await C.getModel(ctx, opts);
  if (model.state !== "ok") return { state: model.state, reason: model.reason };
  const data = await D.readData(ctx);
  const view = Dir.getView(ctx, model, data);
  const words = wordsOf(ctx, data.config);
  return { state: "ok", model, view, data, words, display: displayOf(ctx) };
}

/* ───────────── Le lien « Proposer ma fiche » ───────────── */

/** Une destination permise pour le bouton : une page du site (« /contact »), une adresse https ou un e-mail (« mailto: »). Rien d'autre. */
export function safeTarget(v2) {
  const t = clean(v2, 300);
  if (/^\/(?![/\\])[^\s<>"'`]*$/.test(t)) return t;
  if (/^https:\/\/[^\s/?#]+\.[^\s/?#]+[^\s<>"'`]*$/i.test(t)) return t;
  const m = /^mailto:(.+)$/i.exec(t);
  return m && EMAIL.test(m[1]) ? `mailto:${m[1]}` : null;
}

/**
 * Où envoyer quelqu'un qui veut proposer, corriger ou retirer sa fiche : la page réglée par la propriétaire (par exemple celle de son formulaire de contact), sinon la page d'un module
 * « Formulaire de contact » s'il en a une, sinon l'e-mail réglé, sinon celui du site, sinon rien. { href, external } ou null.
 */
export async function proposeTarget(ctx, { subjectKey = "proposeSubject", body = "" } = {}) {
  const chosen = safeTarget(ctx.setting("proposeLink"));
  if (chosen) return { href: chosen, external: !chosen.startsWith("/") };
  try {
    const list = await C.within(Promise.resolve(ctx.api?.instances?.list?.({ module: "contact-form", locale: ctx.locale })), 1000, []);
    const form = Array.isArray(list) ? list.find((i) => typeof i?.basePath === "string" && i.basePath !== "") : null;
    if (form) return { href: `/${String(form.basePath).replace(/^\/+|\/+$/g, "")}`, external: false };
  } catch { /* pas de formulaire */ }
  let email = clean(ctx.setting("proposeEmail"), 200);
  if (!EMAIL.test(email)) {
    try { const b = ctx.api?.brand ? await ctx.api.brand(ctx.locale) : null; email = clean(b?.contactEmail, 200); } catch { email = ""; }
  }
  if (!EMAIL.test(email)) return null;
  return { href: `mailto:${email}?subject=${encodeURIComponent(ctx.t(subjectKey))}${body ? `&body=${encodeURIComponent(body)}` : ""}`, external: true };
}

/* ───────────── Les morceaux de page ───────────── */

/** Les photos hébergées ailleurs ne sont chargées qu'avec l'accord du visiteur (lien « photos ») ou si la propriétaire l'a décidé. */
function photoFor(e, display, flags) {
  if (!e.photo || display.photos === "never") return null;
  return e.photo.own || display.photos === "always" || flags.photos ? e.photo.src : null;
}
function avatar(e, src) {
  const img = src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="96" height="96" onerror="this.remove()">` : "";
  return `<div class="dr-av"><span aria-hidden="true">${esc(P.initials(e.name))}</span>${img}</div>`;
}
const linkText = (l) => { const n = P.NETWORK_NAMES[l.n]; return n ? (l.h ? `${n} · ${l.h}` : n) : (l.h || new URL(l.u).hostname); };
function linkList(e, max) {
  const items = e.links.slice(0, max).map((l) => `<a href="${esc(l.u)}" target="_blank" rel="noopener noreferrer nofollow">${esc(linkText(l))}</a>`);
  return items.length ? `<div class="dr-links">${items.join("")}</div>` : "";
}
const tagsOf = (ctx, view, e) => {
  const names = e.catSlugs.map((s) => view.cats.find((c) => c.slug === s)).filter(Boolean).slice(0, 4).map((c) => `<span class="dr-tag">${esc(Dir.catLabel(ctx, c))}</span>`);
  return names.length ? `<div class="dr-tags">${names.join("")}</div>` : "";
};

function card(ctx, e, st) {
  const role = P.pickText(e.role, ctx.locale, ctx.defaultLocale);
  const src = photoFor(e, st.display, st.flags);
  const href = path(ctx, `/p/${e.slug}${st.flags.photos ? "/photos" : ""}`);
  return `<li class="dr-card">${avatar(e, src)}<p class="dr-name"><a href="${esc(href)}">${esc(e.name)}</a></p>${role ? `<p class="dr-role">${esc(role)}</p>` : ""}${e.city && st.showCity ? `<p class="dr-sub">${esc(e.city)}</p>` : ""}${st.showTags ? tagsOf(ctx, st.view, e) : ""}${st.display.links === "list" ? linkList(e, 3) : ""}</li>`;
}

const empty = (title, sub, extra = "") => `<div class="dr-empty" role="status"><p class="dr-empty-t">${esc(title)}</p><p class="dr-empty-s">${esc(sub)}</p>${extra}</div>`;
const wrap = (inner) => ({ type: "html", html: `<div class="dr"><style>${CSS}</style>${inner}</div>` });

function plural(ctx, n, words) { return `${n} ${n === 1 ? words.noun : words.nouns}`; }

/** Une page qui n'est pas prête : message aimable, jamais une erreur. */
function notReady(ctx, title, state) {
  const unready = state === "unready";
  return { title, blocks: [wrap(empty(ctx.t(unready ? "pubEmptyTitle" : "pubSoonTitle"), ctx.t(unready ? "pubEmptyText" : "pubSoonText")))] };
}

/* ───────────── Les routes de la page ───────────── */

/** / · c/… q/… s/… after/… photos (liste) · p/<adresse>[/photos] · team[/photos] · print/… : l'objet décrivant la page, ou null (introuvable). */
export function parseRoute(segments, slugs) {
  const s = Array.isArray(segments) ? segments.filter((x) => x !== "") : [];
  const first = s[0];
  if (first === "p") {
    if (s.length < 2 || s.length > 3 || (s[2] !== undefined && s[2] !== "photos") || !P.slugOk(s[1]) || !P.hashOfSlug(s[1])) return null;
    return { kind: "person", hash: P.hashOfSlug(s[1]), photos: s[2] === "photos" };
  }
  if (first === "team") {
    if (s.length > 2 || (s[1] !== undefined && s[1] !== "photos")) return null;
    return { kind: "team", photos: s[1] === "photos" };
  }
  if (first === "print") {
    const l = Dir.parseList(s.slice(1), slugs);
    return l && !l.cursor ? { kind: "print", ...l } : null;
  }
  const l = Dir.parseList(s, slugs);
  return l ? { kind: "list", ...l } : null;
}

/** La page publique. `segments` : ce qui suit le chemin de l'instance, en minuscules. */
export async function render(ctx, segments) {
  const first = await load(ctx, {});
  const config = first.state === "ok" ? first.data.config : (await D.readData(ctx).catch(() => ({ config: D.blankConfig() }))).config;
  const words = first.state === "ok" ? first.words : wordsOf(ctx, config);
  const route = parseRoute(segments, new Set(config.cats.map((c) => c.slug)));
  if (!route) return { notFound: true };
  if (first.state !== "ok") return notReady(ctx, words.title, first.state);
  const st = { ...first, flags: { photos: !!route.photos }, showCity: true, showTags: true };
  if (route.kind === "person") return personPage(ctx, route, st);
  if (route.kind === "team") return teamPage(ctx, route, st);
  if (route.kind === "print") return printPage(ctx, route, st);
  return listPage(ctx, route, st);
}

function metaDescription(ctx, st) {
  const intro = clean(ctx.setting("intro"), 160);
  return intro || ctx.t("pubDescription", { nouns: st.words.nouns });
}

/* ───────────── La liste ───────────── */

function toolbar(ctx, st, route) {
  const base = baseOf(ctx);
  const { view, words, display } = st;
  const here = { cats: route.cats, q: route.q, sort: route.sort, photos: route.photos };
  const href = (over) => Dir.listPath(base, { ...here, ...over });
  const hidden = [...route.cats.length ? [["c", route.cats.join("+")]] : [], ...route.sort ? [["s", route.sort]] : [], ...route.photos ? [["ph", "1"]] : []].map(([n, val]) => `<input type="hidden" name="${n}" value="${esc(val)}">`).join("");
  const search = `<form class="dr-search" role="search" method="get" action="/m/${esc(ctx.instance.key)}/go"><label for="dr-q">${esc(ctx.t("searchLabel", { nouns: words.nouns }))}</label><input class="dr-in" id="dr-q" type="search" name="q" value="${esc(route.q)}" maxlength="${LIMITS.q}" autocomplete="off" enterkeyhint="search" placeholder="${esc(ctx.t("searchPlaceholder"))}">${hidden}<button class="dr-btn" type="submit">${esc(ctx.t("searchButton"))}</button></form>`;
  const catsShown = view.cats.filter((c) => c.live && c.count > 0);
  let chips = "";
  if (catsShown.length > 1 || route.cats.length) {
    const items = catsShown.map((c) => {
      const on = route.cats.includes(c.slug);
      const next = on ? route.cats.filter((x) => x !== c.slug) : [...route.cats, c.slug];
      return `<li><a class="dr-chip" href="${esc(href({ cats: next }))}"${on ? ' aria-current="true"' : ""}>${esc(Dir.catLabel(ctx, c))} <small>${c.count}</small></a></li>`;
    });
    const all = `<li><a class="dr-chip" href="${esc(href({ cats: [] }))}"${route.cats.length ? "" : ' aria-current="true"'}>${esc(ctx.t("allCategories"))}</a></li>`;
    chips = `<nav class="dr-bar" aria-label="${esc(ctx.t("filterNav"))}"><ul class="dr-chips">${all}${items.join("")}</ul></nav>`;
  }
  const effective = route.sort || display.sort;
  const sortItem = (s, label) => `<li><a class="dr-chip" href="${esc(href({ sort: s === display.sort ? "" : s }))}"${effective === s ? ' aria-current="true"' : ""}>${esc(label)}</a></li>`;
  const sorts = `<nav class="dr-bar" aria-label="${esc(ctx.t("sortNav"))}"><span class="dr-bar-t">${esc(ctx.t("sortLabel"))}</span><ul class="dr-chips">${sortItem("az", ctx.t("sortAz"))}${sortItem("new", ctx.t("sortNew"))}${sortItem("mix", ctx.t("sortMix"))}</ul></nav>`;
  return search + chips + sorts;
}

async function listPage(ctx, route, st) {
  const { view, words, display } = st;
  const base = baseOf(ctx);
  const effSort = route.sort || display.sort;
  const q = Dir.query(view, { cats: route.cats, q: route.q, sort: route.q && !route.sort ? "" : effSort, cursor: route.cursor, perPage: display.perPage });
  const filtered = route.cats.length > 0 || !!route.q;
  const parts = [];
  const intro = clean(ctx.setting("intro"), 2000, true);
  if (intro) parts.push(`<p class="dr-intro">${esc(intro)}</p>`);
  const cfg = { ...st, showCity: true, showTags: true };

  // L'équipe, en tête de la première page, quand on ne cherche rien.
  if (!filtered && !route.cursor && view.team.length) {
    const shown = view.team.slice(0, 12);
    parts.push(`<section class="dr-sec dr-team" aria-labelledby="dr-team-t"><h2 id="dr-team-t">${esc(words.team)}</h2><ul class="dr-grid">${shown.map((e) => card(ctx, e, { ...cfg, showTags: false })).join("")}</ul>${view.team.length > shown.length ? `<p class="dr-more"><a class="dr-btn dr-ghost" href="${esc(path(ctx, `/team${route.photos ? "/photos" : ""}`))}">${esc(ctx.t("teamAll", { n: view.team.length }))}</a></p>` : ""}</section>`);
  }

  parts.push(`<section class="dr-sec" aria-labelledby="dr-list-t"><h2 id="dr-list-t">${esc(words.nouns.charAt(0).toLocaleUpperCase(ctx.locale) + words.nouns.slice(1))}</h2><div>${toolbar(ctx, st, route)}</div>`);
  const countText = filtered ? ctx.t("countFound", { n: q.count, total: view.entries.length, nouns: q.count === 1 ? words.noun : words.nouns }) : plural(ctx, q.total, words);
  if (!view.entries.length) {
    const extra = await proposeButton(ctx);
    parts.push(empty(ctx.t("pubEmptyTitle"), ctx.t("pubEmptyText"), extra));
  } else if (!q.rows.length) {
    parts.push(`<p class="dr-count" role="status">${esc(countText)}</p>`, empty(ctx.t("noMatchTitle"), ctx.t("noMatchText"), `<a class="dr-btn" href="${esc(path(ctx, route.photos ? "/photos" : ""))}">${esc(ctx.t("clearSearch"))}</a>`));
  } else {
    parts.push(`<p class="dr-count" role="status">${esc(countText)}</p>`);
    parts.push(`<ul class="dr-grid">${q.rows.map((e) => card(ctx, e, cfg)).join("")}</ul>`);
    const pageHref = (cursor) => Dir.listPath(base, { cats: route.cats, q: route.q, sort: route.sort, photos: route.photos, cursor });
    if (q.next || q.prev !== null) {
      const prev = q.prev !== null ? `<a class="dr-btn dr-ghost" rel="prev" href="${esc(pageHref(q.prev))}">${esc(ctx.t("pubPrev"))}</a>` : `<span class="dr-btn dr-ghost" aria-disabled="true">${esc(ctx.t("pubPrev"))}</span>`;
      const next = q.next ? `<a class="dr-btn dr-ghost" rel="next" href="${esc(pageHref(q.next))}">${esc(ctx.t("pubNext"))}</a>` : `<span class="dr-btn dr-ghost" aria-disabled="true">${esc(ctx.t("pubNext"))}</span>`;
      parts.push(`<nav class="dr-nav" aria-label="${esc(ctx.t("pubPages"))}">${prev}<span class="dr-pg">${esc(ctx.t("pubRange", { from: q.start + 1, to: q.start + q.rows.length, n: q.count }))}</span>${next}</nav>`);
    }
  }
  parts.push("</section>");
  parts.push(await footer(ctx, st, route));
  const title = route.q || route.cats.length ? `${words.title}: ${route.q || route.cats.map((s) => { const c = view.cats.find((x) => x.slug === s); return c ? Dir.catLabel(ctx, c) : s; }).join(", ")}` : words.title;
  return { title, description: metaDescription(ctx, st), blocks: [wrap(parts.join(""))] };
}

async function proposeButton(ctx) {
  const t = await proposeTarget(ctx);
  if (!t) return "";
  const label = clean(ctx.setting("proposeLabel"), 60) || ctx.t("proposeButton");
  return `<a class="dr-btn" href="${esc(t.href)}">${esc(label)}</a>`;
}

/** Le pied de page : proposer sa fiche, imprimer, télécharger, afficher les photos. */
async function footer(ctx, st, route) {
  const { display, view } = st;
  const items = [];
  const t = await proposeTarget(ctx);
  if (t) items.push(`<a class="dr-btn" href="${esc(t.href)}">${esc(clean(ctx.setting("proposeLabel"), 60) || ctx.t("proposeButton"))}</a>`);
  if (display.photos === "request" && !route.photos && view.entries.some((e) => e.photo && !e.photo.own)) {
    const withPhotos = Dir.listPath(baseOf(ctx), { cats: route.cats, q: route.q, sort: route.sort, photos: true, cursor: route.cursor });
    items.push(`<a class="dr-link" href="${esc(withPhotos)}">${esc(ctx.t("showPhotos"))}</a>`);
  }
  if (display.downloads && view.entries.length) {
    const printLink = Dir.listPath(`${baseOf(ctx)}/print`, { cats: route.cats, q: route.q, sort: route.sort });
    const qs = new URLSearchParams();
    if (route.cats.length) qs.set("c", route.cats.join("+"));
    if (route.q) qs.set("q", route.q);
    if (route.sort) qs.set("s", route.sort);
    items.push(`<a class="dr-link" href="${esc(printLink)}">${esc(ctx.t("printLink"))}</a>`, `<a class="dr-link" href="/m/${esc(ctx.instance.key)}/csv${qs.toString() ? `?${esc(qs.toString())}` : ""}" download>${esc(ctx.t("csvLink"))}</a>`);
  }
  return items.length ? `<div class="dr-foot dr-noprint">${items.join("")}</div>` : "";
}

/* ───────────── L'équipe ───────────── */

async function teamPage(ctx, route, st) {
  const { view, words } = st;
  if (!view.team.length) return { notFound: true };
  const cfg = { ...st, showCity: true, showTags: false };
  const html = `<section class="dr-sec dr-team" aria-labelledby="dr-team-t"><h2 id="dr-team-t">${esc(words.team)}</h2><ul class="dr-grid">${view.team.map((e) => card(ctx, e, cfg)).join("")}</ul></section><p class="dr-back"><a class="dr-link" href="${esc(path(ctx, route.photos ? "/photos" : ""))}">${esc(ctx.t("pubBack", { title: words.title }))}</a></p>`;
  return { title: `${words.team} — ${words.title}`, description: metaDescription(ctx, st), blocks: [wrap(html)] };
}

/* ───────────── La fiche d'une personne ───────────── */

async function personPage(ctx, route, st) {
  const { view, words, display } = st;
  const e = view.bySlug.get(route.hash);
  if (!e) return { notFound: true };
  const role = P.pickText(e.role, ctx.locale, ctx.defaultLocale);
  const bio = display.bio ? P.pickText(e.bio, ctx.locale, ctx.defaultLocale) : "";
  const src = photoFor(e, display, { photos: route.photos });
  const base = baseOf(ctx);
  const cats = e.catSlugs.map((s) => view.cats.find((c) => c.slug === s)).filter(Boolean);
  const tags = cats.length ? `<ul class="dr-tags">${cats.map((c) => `<li><a class="dr-chip" href="${esc(Dir.listPath(base, { cats: [c.slug], photos: route.photos }))}">${esc(Dir.catLabel(ctx, c))}</a></li>`).join("")}</ul>` : "";
  const links = display.links !== "none" && e.links.length ? `<div class="dr-links">${e.links.map((l) => `<a href="${esc(l.u)}" target="_blank" rel="noopener noreferrer nofollow">${esc(linkText(l))}</a>`).join("")}</div>` : "";
  const here = `${base}/p/${e.slug}`;
  const neighbours = Dir.neighbours(view, e);
  const cfg = { ...st, flags: { photos: route.photos }, showCity: true, showTags: false };
  const same = neighbours.rows.length ? `<section class="dr-sec" aria-labelledby="dr-same-t"><h2 id="dr-same-t">${esc(ctx.t("sameTitle", { category: Dir.catLabel(ctx, view.cats.find((c) => c.slug === neighbours.slug)) }))}</h2><ul class="dr-grid">${neighbours.rows.map((n) => card(ctx, n, cfg)).join("")}</ul></section>` : "";
  const withdraw = await proposeTarget(ctx, { subjectKey: "withdrawSubject", body: `${ctx.api?.siteUrl ?? ""}${here}` });
  const inner = `<p class="dr-back dr-noprint"><a class="dr-link" href="${esc(path(ctx, route.photos ? "/photos" : ""))}">${esc(ctx.t("pubBack", { title: words.title }))}</a></p>`
    + `<article class="dr-person" aria-labelledby="dr-person-t">${avatar(e, src)}<div><h2 id="dr-person-t">${esc(e.name)}</h2>${role ? `<p class="dr-role">${esc(role)}</p>` : ""}${e.city ? `<p class="dr-sub">${esc(e.city)}</p>` : ""}${tags}${bio ? `<p class="dr-bio">${esc(bio)}</p>` : ""}${links}</div></article>`
    + same
    + (withdraw ? `<div class="dr-foot dr-noprint"><a class="dr-link" href="${esc(withdraw.href)}">${esc(ctx.t("withdrawLink"))}</a></div>` : "");
  const blocks = [wrap(inner)];
  const ld = display.structured ? personMarkup(ctx, e, { role, bio, url: `${ctx.api?.siteUrl ?? ""}${here}`, photo: src && (e.photo?.own || display.photos === "always") ? (src.startsWith("/") ? `${ctx.api?.siteUrl ?? ""}${src}` : src) : null }) : null;
  if (ld) blocks.push({ type: "html", html: ld });
  const desc = bio ? clean(bio, 160) : role ? `${e.name}, ${role}` : ctx.t("personDescription", { name: e.name, title: words.title });
  return { title: `${e.name} — ${words.title}`, description: desc, blocks };
}

/** Les données structurées Person / Organization d'une fiche (facultatif, réglage « données structurées »). Seulement ce qui est affiché sur la page. */
export function personMarkup(ctx, e, { role, bio, url, photo }) {
  if (!ctx.api?.seo?.jsonLd) return null;
  const doc = {
    "@type": e.kind === "org" ? "Organization" : "Person", name: e.name, ...(url ? { url } : {}), ...(photo ? { image: photo } : {}),
    ...(role && e.kind !== "org" ? { jobTitle: role } : {}), ...(bio ? { description: bio } : {}),
    ...(e.links.length ? { sameAs: e.links.map((l) => l.u) } : {}), ...(e.city && e.kind !== "org" ? { homeLocation: { "@type": "Place", name: e.city } } : e.city ? { location: { "@type": "Place", name: e.city } } : {}),
  };
  const tag = ctx.api.seo.jsonLd(doc);
  if (!tag?.jsonLd) return null;
  return `<script type="application/ld+json">${JSON.stringify(tag.jsonLd).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")}</script>`;
}

/* ───────────── La version imprimable ───────────── */

function printPage(ctx, route, st) {
  const { view, words, display } = st;
  const q = Dir.query(view, { cats: route.cats, q: route.q, sort: route.q && !route.sort ? "" : route.sort || display.sort, perPage: LIMITS.printMax });
  const all = q.all.slice(0, LIMITS.printMax);
  const rows = all.map((e) => {
    const role = P.pickText(e.role, ctx.locale, ctx.defaultLocale);
    const cats = e.catSlugs.map((s) => view.cats.find((c) => c.slug === s)).filter(Boolean).map((c) => Dir.catLabel(ctx, c)).join(", ");
    const links = display.links === "none" ? "" : e.links.map((l) => l.u).join(" ");
    return `<tr><td>${esc(e.name)}</td><td>${esc(role)}</td><td>${esc(cats)}</td><td>${esc(e.city)}</td><td>${esc(links)}</td></tr>`;
  });
  const back = Dir.listPath(baseOf(ctx), { cats: route.cats, q: route.q, sort: route.sort });
  const more = q.count > all.length ? `<p class="dr-sub">${esc(ctx.t("printCut", { n: all.length, total: q.count }))}</p>` : "";
  const html = `<h2>${esc(words.title)}</h2><p class="dr-count">${esc(plural(ctx, q.count, words))}</p>${more}`
    + `<p class="dr-noprint"><button class="dr-btn" type="button" onclick="window.print()">${esc(ctx.t("printNow"))}</button> <a class="dr-link" href="${esc(back)}">${esc(ctx.t("pubBack", { title: words.title }))}</a></p>`
    + `<table class="dr-table"><thead><tr><th scope="col">${esc(ctx.t("colName"))}</th><th scope="col">${esc(ctx.t("colRole"))}</th><th scope="col">${esc(ctx.t("colCategories"))}</th><th scope="col">${esc(ctx.t("colCity"))}</th><th scope="col">${esc(ctx.t("colLinks"))}</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  return { title: `${words.title} — ${ctx.t("printTitle")}`, description: metaDescription(ctx, st), blocks: [wrap(html)] };
}
