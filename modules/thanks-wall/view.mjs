// Mur des remerciements — la page publique. Aucune saisie de visiteur : tout ce qui s'affiche vient de Contacts (noms, photos) ou de la propriétaire (messages, mots),
// et tout est échappé. Pas de cookie, pas de script, pas de requête vers un autre site, sauf les photos que le navigateur charge lui-même (voir pure.photoSrc).
// Chemins : / (le mur : la mise à l'honneur, puis chaque groupe en aperçu) · /g/2 (tout le groupe 2) · /g/2/page/3 (50 cartes par page).
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const C = await import(`./contacts.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const { esc, LIMITS } = P;

const CSS = `
.tw{font-family:var(--v-font,inherit);color:var(--v-fg,inherit);max-width:72rem;margin:0 auto}
.tw *{box-sizing:border-box}
.tw h2,.tw p,.tw ul{margin:0;padding:0}
.tw ul{list-style:none}
.tw .tw-intro{color:var(--v-muted,#aaa);font-size:1.05rem;max-width:42rem;margin:0 0 1.5rem;overflow-wrap:anywhere}
.tw-spot{position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:center;gap:1rem;text-align:center;padding:1.75rem 1.25rem 1.5rem;margin:0 0 2.25rem;background:var(--v-surface,#1c1c1f);border:1px solid var(--v-line,#333);border-radius:1.25rem;box-shadow:0 1px 2px color-mix(in srgb,var(--v-fg,#000) 12%,transparent),0 14px 34px -16px color-mix(in srgb,var(--v-fg,#000) 40%,transparent)}
.tw-spot::before{content:"";position:absolute;inset:0 0 auto 0;height:5px;background:var(--v-gradient,var(--v-accent,#e8a23b))}
.tw-spot .tw-av{width:8rem}
.tw .tw-eyebrow{display:inline-block;padding:.2rem .75rem;border-radius:999px;background:var(--v-accent,#e8a23b);color:var(--v-accent-fg,#111);font-size:.8rem;font-weight:700;letter-spacing:.02em;line-height:1.5}
[data-accent2] .tw-eyebrow{background:var(--v-accent2,#e8a23b);color:var(--v-accent2-fg,#111)}
.tw-spot-name{font-size:1.6rem;font-weight:800;line-height:1.2;overflow-wrap:anywhere}
.tw-spot-why{max-width:34rem;font-size:1.05rem;overflow-wrap:anywhere;white-space:pre-line}
.tw-group{margin:0 0 2.25rem}
.tw-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:.25rem .75rem;margin:0 0 1rem}
.tw-head h2{font-size:1.4rem;font-weight:800;line-height:1.25;overflow-wrap:anywhere}
.tw-count{color:var(--v-muted,#aaa);font-size:.95rem}
.tw-grid{display:grid;gap:.75rem;grid-template-columns:repeat(2,minmax(0,1fr))}
.tw-card{display:flex;flex-direction:column;align-items:center;gap:.6rem;padding:1rem .6rem .9rem;text-align:center;background:var(--v-surface,#1c1c1f);border:1px solid var(--v-line,#333);border-radius:1rem;min-width:0}
.tw-av{position:relative;flex:0 0 auto;width:5.25rem;aspect-ratio:1;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--v-accent,#e8a23b) 24%,var(--v-surface,#1c1c1f));border:2px solid var(--v-line,#333);font-weight:800;font-size:1.5rem;color:var(--v-fg,inherit)}
.tw-spot .tw-av{font-size:2.25rem}
.tw-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
.tw-name{font-weight:700;line-height:1.3;overflow-wrap:anywhere;max-width:100%}
.tw-msg{color:var(--v-muted,#aaa);font-size:.9rem;line-height:1.4;overflow-wrap:anywhere}
.tw .tw-more{margin:1.25rem 0 0}
.tw-btn{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;padding:.55rem 1.1rem;border-radius:.7rem;font-weight:600;text-decoration:none;background:var(--v-accent,#e8a23b);color:var(--v-accent-fg,#111)}
[data-accent2] .tw-btn{background:var(--v-accent2,#e8a23b);color:var(--v-accent2-fg,#111)}
.tw-link{display:inline-flex;align-items:center;min-height:2.75rem;color:var(--v-fg,inherit);text-decoration:underline;text-underline-offset:.2em}
.tw-btn:focus-visible,.tw-link:focus-visible{outline:2px solid var(--v-fg,currentColor);outline-offset:3px}
.tw .tw-nav{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem 1rem;margin:1.5rem 0 0}
.tw-nav [aria-disabled]{opacity:.45}
.tw-empty{padding:2.25rem 1.25rem;text-align:center;border:1px dashed var(--v-line,#333);border-radius:1rem;background:var(--v-surface,#1c1c1f)}
.tw-empty-t{font-size:1.15rem;font-weight:700}
.tw .tw-empty-s{color:var(--v-muted,#aaa);margin-top:.35rem}
@media (min-width:36rem){.tw-grid{grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr));gap:1rem}.tw-card{padding:1.15rem .75rem 1rem}.tw-av{width:5.75rem}.tw-spot{flex-direction:row;text-align:left;gap:1.75rem;padding:2rem}.tw-spot .tw-av{width:9rem}}
@media (prefers-reduced-motion:no-preference){.tw-card{transition:transform .15s ease,border-color .15s ease}.tw-card:hover{transform:translateY(-2px);border-color:var(--v-accent,#e8a23b)}}
`.replace(/\n/g, "");

const basePath = (ctx) => (ctx.instance.basePath ? `/${String(ctx.instance.basePath).replace(/^\/+|\/+$/g, "")}` : "");

/** Un rond avec la photo si elle est permise, sinon les initiales. L'image se retire d'elle-même si elle ne charge pas (les initiales restent dessous). */
function avatar(p, shown, withPhoto) {
  const img = withPhoto && p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="96" height="96" onerror="this.remove()">` : "";
  return `<div class="tw-av"><span aria-hidden="true">${esc(P.initials(shown))}</span>${img}</div>`;
}

function card(ctx, p, o) {
  const msg = o.messages.get(p.id);
  const text = msg ? P.pickText(msg.texts, ctx.locale, ctx.defaultLocale) : "";
  return `<li class="tw-card">${avatar(p, p.shown, o.photos)}<p class="tw-name">${esc(p.shown)}</p>${text ? `<p class="tw-msg">${esc(text)}</p>` : ""}</li>`;
}

function spotlight(ctx, honor, person, o) {
  const msg = o.messages.get(person.id);
  const why = P.pickText(honor.why, ctx.locale, ctx.defaultLocale) || (msg ? P.pickText(msg.texts, ctx.locale, ctx.defaultLocale) : "");
  const shown = P.shownName(person, o.style);
  return `<section class="tw-spot" aria-labelledby="tw-spot-t">${avatar(person, shown, o.photos)}<div><p class="tw-eyebrow">${esc(ctx.t("spotlightEyebrow", { month: P.monthName(honor.month, ctx.locale) }))}</p><h2 class="tw-spot-name" id="tw-spot-t">${esc(shown)}</h2>${why ? `<p class="tw-spot-why">${esc(why)}</p>` : ""}</div></section>`;
}

const empty = (ctx, title, sub) => ({ type: "html", html: `<div class="tw"><style>${CSS}</style><div class="tw-empty" role="status"><p class="tw-empty-t">${esc(title)}</p><p class="tw-empty-s">${esc(sub)}</p></div></div>` });

/** Les réglages d'affichage, bornés. */
export function displayOf(ctx) {
  const style = P.NAME_STYLES.includes(ctx.setting("nameStyle")) ? ctx.setting("nameStyle") : "card";
  const order = P.ORDERS.includes(ctx.setting("order")) ? ctx.setting("order") : "alpha";
  const photos = ctx.setting("photos") !== false && ctx.setting("photos") !== "false" && ctx.setting("photos") !== 0;
  const preview = P.int(ctx.setting("preview"), LIMITS.previewDefault, 4, LIMITS.previewMax);
  return { style, order, photos, preview };
}

/** Les personnes d'un groupe, avec le nom à montrer et dans l'ordre choisi. */
export function shownPeople(ctx, group, display) {
  return P.sortPeople(group.people.map((p) => ({ ...p, shown: P.shownName(p, display.style) })), display.order, ctx.locale);
}

const count = (ctx, n) => (n === 1 ? ctx.t("pubCountOne") : ctx.t("pubCount", { n }));
const pageTitle = (ctx) => P.clean(ctx.setting("title"), 120) || ctx.t("pageTitle");

/** La page publique. `segments` : ce qui suit le chemin de l'instance, en minuscules. */
export async function render(ctx, segments) {
  const title = pageTitle(ctx), display = displayOf(ctx), base = basePath(ctx);
  const route = parseRoute(segments);
  if (!route) return { notFound: true };
  const wall = await C.getWall(ctx);
  const groups = wall.state === "ok" ? wall.groups.filter((g) => !g.problem) : [];
  // Un mur qui n'est pas prêt, ou que Contacts ne peut pas donner : un message aimable, jamais une erreur.
  if (wall.state !== "ok") return { title, blocks: [empty(ctx, ctx.t("pubSoonTitle"), ctx.t("pubSoonText"))] };
  const data = await D.readData(ctx).catch(() => ({ messages: new Map(), honors: [] }));
  const o = { ...display, messages: data.messages };
  const intro = P.clean(ctx.setting("intro"), 2000, true);

  if (route.kind === "group") {
    const group = groups.find((g) => g.n === route.n);
    if (!group) return { notFound: true };
    const all = shownPeople(ctx, group, display);
    const pages = Math.max(1, Math.ceil(all.length / LIMITS.perPage));
    if (route.page > pages) return { notFound: true };
    const slice = all.slice((route.page - 1) * LIMITS.perPage, route.page * LIMITS.perPage);
    const href = (p) => `${base}/g/${group.n}${p > 1 ? `/page/${p}` : ""}`;
    const nav = pages > 1 ? `<nav class="tw-nav" aria-label="${esc(ctx.t("pubPages"))}">${route.page > 1 ? `<a class="tw-btn" rel="prev" href="${esc(href(route.page - 1))}">${esc(ctx.t("pubPrev"))}</a>` : `<span class="tw-btn" aria-disabled="true">${esc(ctx.t("pubPrev"))}</span>`}<span>${esc(ctx.t("pubPageOf", { page: route.page, pages }))}</span>${route.page < pages ? `<a class="tw-btn" rel="next" href="${esc(href(route.page + 1))}">${esc(ctx.t("pubNext"))}</a>` : `<span class="tw-btn" aria-disabled="true">${esc(ctx.t("pubNext"))}</span>`}</nav>` : "";
    const html = `<div class="tw"><style>${CSS}</style><section class="tw-group" aria-labelledby="tw-g"><div class="tw-head"><h2 id="tw-g">${esc(group.title)}</h2><span class="tw-count">${esc(count(ctx, all.length))}</span></div>${slice.length ? `<ul class="tw-grid">${slice.map((p) => card(ctx, p, o)).join("")}</ul>` : ""}${nav}<p class="tw-more"><a class="tw-link" href="${esc(base || "/")}">${esc(ctx.t("pubBack"))}</a></p></section></div>`;
    return { title: `${group.title} — ${title}`, description: ctx.t("pubDescription"), blocks: [{ type: "html", html }] };
  }

  // La page principale : la personne à l'honneur de ce mois, puis chaque groupe en aperçu.
  const parts = [];
  const month = P.monthKey();
  const honor = data.honors.find((h) => h.month === month);
  if (honor) {
    const found = await C.publicCard(ctx, honor.contactId, wall.hideId);
    if (found.card) parts.push(spotlight(ctx, honor, found.card, o));
  }
  for (const group of groups) {
    const all = shownPeople(ctx, group, display);
    if (!all.length) continue;
    const shownCards = all.slice(0, display.preview);
    const more = all.length > shownCards.length;
    const href = `${base}/g/${group.n}`;
    parts.push(`<section class="tw-group" aria-labelledby="tw-g${group.n}"><div class="tw-head"><h2 id="tw-g${group.n}">${esc(group.title)}</h2><span class="tw-count">${esc(count(ctx, all.length))}</span></div><ul class="tw-grid">${shownCards.map((p) => card(ctx, p, o)).join("")}</ul>${more ? `<p class="tw-more"><a class="tw-btn" href="${esc(href)}">${esc(ctx.t("pubSeeAll", { n: all.length }))}</a></p>` : ""}</section>`);
  }
  const blocks = [];
  if (intro) blocks.push({ type: "markdown", text: intro });
  if (!parts.length) blocks.push(empty(ctx, ctx.t("pubEmptyTitle"), ctx.t("pubEmptyText")));
  else blocks.push({ type: "html", html: `<div class="tw"><style>${CSS}</style>${parts.join("")}</div>` });
  return { title, description: P.clean(ctx.setting("intro"), 160) || ctx.t("pubDescription"), blocks };
}

/** / · /g/2 · /g/2/page/3 → { kind: "wall" } | { kind: "group", n, page } ; autre chose : null (page introuvable). */
export function parseRoute(segments) {
  const s = Array.isArray(segments) ? segments.filter((x) => x !== "") : [];
  if (!s.length) return { kind: "wall" };
  if (s[0] !== "g" || !/^[1-6]$/.test(s[1] ?? "")) return null;
  if (s.length === 2) return { kind: "group", n: Number(s[1]), page: 1 };
  if (s.length === 4 && s[2] === "page" && /^[1-9]\d{0,3}$/.test(s[3])) return { kind: "group", n: Number(s[1]), page: Number(s[3]) };
  return null;
}
