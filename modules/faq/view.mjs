// Questions fréquentes : ce que voit le visiteur (la page, la section d'accueil), construit en HTML simple.
// Le HTML des questions est de vrai HTML (`details` / `summary`) : il s'ouvre et se referme sans JavaScript.
// Le JavaScript (client.mjs) n'ajoute que du confort : recherche, « tout ouvrir », lien copié, avis envoyé sans recharger la page.

import { loadThemes, loadItems, flag } from "./data.mjs";
import { esc, renderAnswer, faqMarkup, safeJson, safeLang, safeSlug, num } from "./text.mjs";

/** Adresse de la page de l'instance (null si elle n'est pas montée sur un chemin). Préfixe la langue si ce n'est pas la langue par défaut. */
export function pageHref(ctx, localized = true) {
  const base = ctx.instance.basePath;
  if (base === null || base === undefined) return null;
  const prefix = localized && ctx.locale !== ctx.defaultLocale ? `/${ctx.locale}` : "";
  return `${prefix}${base ? `/${base}` : ""}` || "/";
}

/** Le texte d'une question pour la langue du visiteur ; à défaut, avec le réglage « montrer aussi les autres langues », celui d'une autre langue (signalé). */
export function pickText(ctx, tr, fallback) {
  const has = (l) => tr?.[l] && tr[l].q && tr[l].a;
  if (has(ctx.locale)) return { lang: ctx.locale, other: false, q: tr[ctx.locale].q, a: tr[ctx.locale].a };
  if (!fallback) return null;
  for (const l of [ctx.defaultLocale, ...(ctx.locales ?? []), ...Object.keys(tr ?? {})]) if (has(l)) return { lang: l, other: true, q: tr[l].q, a: tr[l].a };
  return null;
}

/** Le nom d'un thème dans la langue du visiteur, sinon dans la langue du site, sinon dans la première qui existe. */
export function themeName(ctx, theme) {
  const n = theme?.names ?? {};
  return n[ctx.locale] || n[ctx.defaultLocale] || Object.values(n)[0] || "";
}

/** Tout ce qui est publié et lisible dans la langue du visiteur, rangé par thème (dans l'ordre choisi par l'équipe). */
export async function buildView(ctx) {
  const [themes, items] = await Promise.all([loadThemes(ctx), loadItems(ctx)]);
  const fallback = flag(ctx, "fallback", true);
  const known = new Map(themes.map((t) => [t.id, { id: t.id, name: themeName(ctx, t), items: [] }]));
  const loose = { id: "", name: ctx.t("otherTheme"), items: [] };
  let total = 0;
  for (const it of items) {
    if (it.status !== "published") continue;
    const text = pickText(ctx, it.tr, fallback);
    const html = text ? renderAnswer(text.a) : "";
    if (!text || !html || !text.q) continue;
    (known.get(it.theme) ?? loose).items.push({ id: it.id, slug: it.slug, q: text.q, html, lang: text.lang, other: text.other, y: it.y, n: it.n });
    total++;
  }
  const groups = [...known.values(), loose].filter((g) => g.items.length);
  return { groups, total, flat: groups.length === 1 && groups[0].id === "" };
}

const VOTE_MIN_PUBLIC = 3; // le nombre de personnes aidées ne s'affiche qu'à partir de là (un « 1 » ferait pauvre)

export const CSS = `
.faq{max-width:46rem;margin:0 auto;color:var(--v-fg)}
.faq *,.faq *::before,.faq *::after{box-sizing:border-box}
.faq [hidden]{display:none!important}
.faq-intro{margin:0 0 1.25rem;color:var(--v-muted)}
.faq-intro p{margin:0 0 .5rem}
.faq-intro a,.faq-a a,.faq-empty a,.faq-hint a{color:var(--v-fg);text-decoration:underline;text-decoration-color:var(--v-accent);text-decoration-thickness:2px;text-underline-offset:3px}
.faq-search{margin:0 0 1rem}
.faq-search label,.faq-ask label{display:block;margin:0 0 .35rem;font-weight:600}
.faq-search input,.faq-ask textarea{display:block;width:100%;min-height:44px;padding:.6rem .9rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface);color:var(--v-fg);font:inherit}
.faq-ask textarea{min-height:96px;background:var(--v-bg);resize:vertical}
.faq-search input::placeholder,.faq-ask textarea::placeholder{color:var(--v-muted);opacity:1}
.faq input:focus-visible,.faq textarea:focus-visible,.faq button:focus-visible,.faq a:focus-visible,.faq summary:focus-visible{outline:2px solid var(--v-accent);outline-offset:2px}
.faq-status{min-height:1.5em;margin:.35rem 0 0;color:var(--v-muted);font-size:.9rem}
.faq-tools{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 1rem}
.faq-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 1rem;border:1px solid var(--v-line);border-radius:999px;background:var(--v-bg);color:var(--v-fg);font:inherit;cursor:pointer;text-decoration:none}
.faq-btn:hover{border-color:var(--v-accent)}
.faq-btn:disabled{opacity:.6;cursor:default}
.faq-btn-main{border-color:transparent;background:var(--v-accent);color:var(--v-accent-fg);font-weight:600}
.faq-chips{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 1.25rem;padding:0;list-style:none}
.faq-chips a{display:inline-flex;align-items:center;min-height:44px;padding:0 .9rem;border:1px solid var(--v-line);border-radius:999px;background:var(--v-surface);color:var(--v-fg);text-decoration:none}
.faq-chips a:hover{border-color:var(--v-accent)}
.faq-theme{margin:0 0 1.5rem;scroll-margin-top:5rem}
.faq-theme[hidden]{display:none}
.faq-theme>h2{margin:1.5rem 0 .75rem;font-size:1.25rem;font-weight:600;line-height:1.3}
.faq-q{margin:0 0 .5rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface);scroll-margin-top:5rem}
.faq-q[hidden]{display:none}
.faq-q:target{border-color:var(--v-accent);box-shadow:0 0 0 2px var(--v-accent)}
.faq-q>summary{display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:44px;padding:.7rem 1rem;border-radius:12px;font-weight:600;cursor:pointer;list-style:none}
.faq-q>summary::-webkit-details-marker{display:none}
.faq-q>summary::after{content:"";flex:none;width:.55rem;height:.55rem;margin-top:-.25rem;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg)}
.faq-q[open]>summary::after{margin-top:.25rem;transform:rotate(-135deg)}
.faq-a{padding:0 1rem 1rem;line-height:1.6;overflow-wrap:anywhere}
.faq-a p,.faq-a ul,.faq-a ol{margin:0 0 .75rem}
.faq-a ul,.faq-a ol{padding-left:1.4rem}
.faq-lang{margin:0 0 .75rem;color:var(--v-muted);font-size:.9rem}
.faq-meta{display:flex;flex-wrap:wrap;align-items:center;gap:0 1rem;margin-top:.25rem;padding-top:.35rem;border-top:1px solid var(--v-line);color:var(--v-muted);font-size:.9rem}
.faq-meta a{display:inline-flex;align-items:center;min-height:44px;color:var(--v-muted);text-decoration:underline;text-underline-offset:3px}
.faq-copied{min-height:1.2em}
.faq-vote{padding-top:.5rem}
.faq-vote p{margin:0 0 .5rem}
.faq-vote form{display:flex;flex-wrap:wrap;gap:.5rem}
.faq-count{color:var(--v-muted);font-size:.9rem}
.faq-empty,.faq-none{padding:1rem;border:1px dashed var(--v-line);border-radius:12px;color:var(--v-muted)}
.faq-empty[hidden]{display:none}
.faq-empty p,.faq-none p{margin:0 0 .5rem}
.faq-ask{margin-top:2rem;padding:1rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface)}
.faq-ask h2{margin:0 0 .35rem;font-size:1.25rem;font-weight:600}
.faq-hint{margin:.35rem 0 .75rem;color:var(--v-muted);font-size:.9rem}
.faq-result{min-height:1.5em;margin:.75rem 0 0}
.faq-trap{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.faq-note{display:none;position:fixed;right:1rem;bottom:1rem;left:1rem;z-index:50;max-width:30rem;margin:0 auto;padding:.75rem 1rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface);color:var(--v-fg);box-shadow:0 4px 18px rgba(0,0,0,.25)}
.faq-note:target{display:block}
.faq-note a{margin-left:.75rem;color:var(--v-fg);text-decoration:underline}
.faq-top .faq-q{margin-bottom:.4rem}
@media (prefers-reduced-motion:no-preference){.faq-q>summary::after{transition:transform .15s}}
`.replace(/\n/g, "");

/** Les textes que le navigateur affiche sans recharger la page, posés en attributs (le script n'a aucun texte en dur). */
function attrs(ctx) {
  const t = (k) => esc(ctx.t(k));
  return `data-faq data-faq-store="${esc(ctx.instance.key)}" data-t-none="${t("searchNone")}" data-t-one="${t("searchOne")}" data-t-many="${t("searchMany")}" data-t-copied="${t("linkCopied")}"`
    + ` data-t-thanks="${t("voteThanks")}" data-t-busy="${t("voteBusy")}" data-t-error="${t("formError")}" data-t-help-many="${t("helpfulMany")}"`
    + ` data-t-asked="${t("askSent")}" data-t-ask-limit="${t("askLimit")}" data-t-ask-invalid="${t("askInvalid")}" data-t-ask-full="${t("askFull")}"`;
}

function itemHtml(ctx, it, o) {
  const slug = safeSlug(it.slug) || "question";
  const lang = it.other ? safeLang(it.lang) : null;
  const key = esc(ctx.instance.key);
  let body = it.html;
  if (it.other) body = `<p class="faq-lang">${esc(ctx.t("otherLanguage", { lang: o.langName(it.lang) }))}</p>${body}`;
  let extra = "";
  if (o.full) {
    const helpful = o.votes && it.y >= VOTE_MIN_PUBLIC ? `<p class="faq-count" data-faq-count>${esc(ctx.t("helpfulMany", { n: it.y }))}</p>` : o.votes ? `<p class="faq-count" data-faq-count></p>` : "";
    const vote = o.votes
      ? `<div class="faq-vote" data-faq-vote-box data-faq-id="${esc(it.id)}"><p class="faq-vote-q">${esc(ctx.t("voteQuestion"))}</p>`
        + `<form method="post" action="/m/${key}/vote?lang=${esc(ctx.locale)}" data-faq-vote aria-label="${esc(ctx.t("voteQuestion"))}"><input type="hidden" name="q" value="${esc(it.id)}">`
        + `<button class="faq-btn" type="submit" name="v" value="up">${esc(ctx.t("voteYes"))}</button><button class="faq-btn" type="submit" name="v" value="down">${esc(ctx.t("voteNo"))}</button></form>`
        + `<p class="faq-thanks" role="status" data-faq-thanks></p>${helpful}</div>`
      : "";
    extra = `${vote}<div class="faq-meta"><a href="#q-${esc(slug)}" data-faq-link>${esc(ctx.t("permalink"))}</a><span class="faq-copied" role="status" data-faq-copied></span></div>`;
  }
  return `<details class="faq-q" id="${o.full ? "q" : "top"}-${esc(slug)}"${o.full ? " data-faq-item" : ""}${lang ? ` lang="${esc(lang)}"` : ""}><summary><span data-faq-title>${esc(it.q)}</span></summary><div class="faq-a" data-faq-body>${body}${extra}</div></details>`;
}

function langNamer(ctx) {
  return (code) => { try { return new Intl.DisplayNames([ctx.locale], { type: "language" }).of(code) || code; } catch { return code; } };
}

/** Les données FAQPage des questions affichées (balise sûre, ou texte vide). */
export function markupHtml(ctx, view) {
  if (!flag(ctx, "markup", true)) return { html: "", count: 0, omitted: 0 };
  const flat = view.groups.flatMap((g) => g.items);
  const { doc, count, omitted } = faqMarkup(flat, ctx.locale);
  if (!doc) return { html: "", count, omitted };
  const tag = ctx.api?.seo?.jsonLd ? ctx.api.seo.jsonLd(doc) : null; // le cœur borne la taille et refuse ce qui est inutilisable
  if (!tag?.jsonLd) return { html: "", count: 0, omitted: flat.length };
  return { html: `<script type="application/ld+json">${safeJson(tag.jsonLd)}</script>`, count, omitted };
}

/** La page publique : introduction, recherche, thèmes, questions, boîte « posez votre question ». */
export async function renderPage(ctx) {
  const view = await buildView(ctx);
  const votes = flag(ctx, "votes", true);
  const allowAsk = flag(ctx, "allowQuestions", true);
  const o = { votes, full: true, langName: langNamer(ctx) };
  const key = esc(ctx.instance.key);
  const t = (k, v) => esc(ctx.t(k, v));
  const intro = renderAnswer(ctx.setting("intro"));
  const parts = [`<style>${CSS}</style><noscript><style>.faq-needs-js{display:none!important}</style></noscript>`, `<div class="faq" ${attrs(ctx)}>`];
  if (intro) parts.push(`<div class="faq-intro">${intro}</div>`);

  if (view.total > 0) {
    parts.push(
      `<div class="faq-search faq-needs-js" role="search"><label for="faq-search-${key}">${t("searchLabel")}</label>`
      + `<input id="faq-search-${key}" type="search" autocomplete="off" enterkeyhint="search" placeholder="${t("searchPlaceholder")}" data-faq-q>`
      + `<p class="faq-status" role="status" data-faq-status></p></div>`,
    );
    if (view.groups.length > 1) {
      parts.push(`<nav aria-label="${t("themesNav")}"><ul class="faq-chips">${view.groups.map((g, i) => `<li><a href="#faq-t-${i + 1}">${esc(g.name)}</a></li>`).join("")}</ul></nav>`);
    }
    if (view.total > 3) {
      parts.push(`<div class="faq-tools faq-needs-js"><button type="button" class="faq-btn" data-faq-all="open">${t("openAll")}</button><button type="button" class="faq-btn" data-faq-all="close">${t("closeAll")}</button></div>`);
    }
    view.groups.forEach((g, i) => {
      parts.push(`<section class="faq-theme" id="faq-t-${i + 1}" data-faq-theme${view.flat ? "" : ` aria-labelledby="faq-th-${i + 1}"`}>${view.flat ? "" : `<h2 id="faq-th-${i + 1}">${esc(g.name)}</h2>`}${g.items.map((it) => itemHtml(ctx, it, o)).join("")}</section>`);
    });
    parts.push(`<div class="faq-empty" data-faq-empty hidden><p>${t("searchEmpty")}</p>${allowAsk ? `<p><a href="#ask" data-faq-prefill>${t("searchEmptyAsk")}</a></p>` : ""}</div>`);
  } else {
    parts.push(`<div class="faq-none"><p>${t(allowAsk ? "noneYetAsk" : "noneYet")}</p></div>`);
  }

  if (allowAsk) {
    parts.push(
      `<section class="faq-ask" id="ask" aria-labelledby="faq-ask-title"><h2 id="faq-ask-title">${t("askTitle")}</h2><p class="faq-hint">${t("askIntro")}</p>`
      + `<form method="post" action="/m/${key}/ask?lang=${esc(ctx.locale)}" data-faq-ask><label for="faq-ask-q-${key}">${t("askLabel")}</label>`
      + `<textarea id="faq-ask-q-${key}" name="question" required minlength="3" maxlength="300" rows="3" placeholder="${t("askPlaceholder")}"></textarea>`
      + `<p class="faq-hint">${t("askPrivacy")}</p>`
      + `<div class="faq-trap" aria-hidden="true"><label>${t("trapLabel")} <input name="website" tabindex="-1" autocomplete="off"></label></div>`
      + `<button class="faq-btn faq-btn-main" type="submit">${t("askSubmit")}</button><p class="faq-result" role="status" data-faq-ask-result></p></form></section>`,
    );
  }

  // Messages affichés quand la page revient d'un envoi sans JavaScript (l'adresse se termine par #faq-…).
  for (const [id, k] of [["sent", "askSent"], ["limit", "askLimit"], ["invalid", "askInvalid"], ["full", "askFull"], ["thanks", "voteThanks"], ["busy", "voteBusy"], ["problem", "formError"]]) {
    parts.push(`<p class="faq-note" id="faq-${id}" role="status">${t(k)}<a href="#faq-top">${t("close")}</a></p>`);
  }
  parts.push(`</div>`);
  const { html } = markupHtml(ctx, view);
  if (html) parts.push(html);
  return { html: parts.join(""), view };
}

/** La section d'accueil : les questions les plus utiles (à égalité, dans l'ordre choisi par l'équipe). */
export async function renderTop(ctx, options) {
  const view = await buildView(ctx);
  if (!view.total) return null;
  const count = num(options?.count, 5, 1, 10);
  const flat = view.groups.flatMap((g) => g.items);
  const best = [...flat.keys()].sort((a, b) => flat[b].y - flat[a].y || a - b).slice(0, count).map((i) => flat[i]);
  const href = pageHref(ctx);
  const o = { votes: false, full: false, langName: langNamer(ctx) };
  const cards = best.map((it) => itemHtml(ctx, it, o));
  const blocks = [{ type: "heading", text: ctx.t("topTitle") }, { type: "html", html: `<style>${CSS}</style><div class="faq faq-top">${cards.join("")}</div>` }];
  if (href) blocks.push({ type: "links", items: [{ label: ctx.t("topAll"), href }] });
  return blocks;
}

