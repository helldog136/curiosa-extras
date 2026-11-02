// Boîte à idées — la page publique : proposer une idée, chercher, trier, soutenir.
// Tout marche sans JavaScript (formulaires ordinaires, tri par l'adresse) ; le petit script de la page ne fait que la recherche en direct.
// Le texte du public est toujours échappé et mis dans un bloc `html` : jamais dans un bloc Markdown.
const v = new URL(import.meta.url).search;   // chaque fichier voisin est importé avec la version du module (voir index.mjs)
const { PUBLIC_MAX, VOTABLE, esc, excerpt, isPublic, loadAll, pageHref, settings, sortIdeas } = await import(`./lib.mjs${v}`);

const CSS = `
.ib{max-width:46rem}
.ib h2{margin:0 0 .5rem;font-size:1.25rem;font-weight:600}
.ib-new,.ib-card{border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface);padding:1rem}
.ib-new{margin:0 0 2rem}
.ib label{display:block;margin:0 0 .35rem;font-weight:600}
.ib textarea,.ib input[type=search],.ib input[type=text]{display:block;width:100%;box-sizing:border-box;min-height:44px;padding:.6rem .9rem;border:1px solid var(--v-line);border-radius:10px;background:var(--v-bg);color:var(--v-fg);font:inherit}
.ib textarea{resize:vertical}
.ib ::placeholder{color:var(--v-muted);opacity:1}
.ib-hint{margin:.35rem 0 0;color:var(--v-muted);font-size:.9rem}
.ib-more{margin:.75rem 0}
.ib-more>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;color:var(--v-muted);list-style:none}.ib-more>summary::-webkit-details-marker{display:none}.ib-more>summary::before{content:"+";display:inline-block;width:1.25rem;font-weight:700}.ib-more[open]>summary::before{content:"\\2212"}
.ib-btn{cursor:pointer;min-height:44px;padding:0 1rem;border:1px solid var(--v-line);border-radius:10px;background:transparent;color:var(--v-fg);font:inherit}
.ib-main{margin-top:.75rem;border-color:var(--v-accent);background:var(--v-accent);color:var(--v-accent-fg);font-weight:600}
.ib :focus-visible{outline:2px solid var(--v-accent);outline-offset:2px}
.ib-trap{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.ib-tools{display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;justify-content:space-between;margin:.75rem 0 1rem}
.ib-sort{display:flex;flex-wrap:wrap;gap:.5rem;margin:0;padding:0;list-style:none}
.ib-sort a{display:inline-flex;align-items:center;min-height:44px;padding:0 .9rem;border:1px solid var(--v-line);border-radius:999px;color:var(--v-fg);text-decoration:none}
.ib-sort a[aria-current=page]{border-color:var(--v-accent);background:var(--v-accent);color:var(--v-accent-fg)}
.ib-search{margin:0 0 .5rem}
.ib-status-line{min-height:1.4em;margin:0;color:var(--v-muted);font-size:.9rem}
.ib-list{display:grid;gap:.75rem;margin:0;padding:0;list-style:none}
.ib-card[hidden],.ib-empty[hidden]{display:none}
.ib-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.ib-foot{display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;justify-content:space-between;margin:.6rem 0 0}.ib-meta{display:flex;flex-wrap:wrap;gap:.25rem .75rem;align-items:center;margin:0;font-size:.9rem;color:var(--v-muted)}
.ib-badge{display:inline-flex;align-items:center;padding:.1rem .6rem;border:1px solid var(--v-line);border-radius:999px;color:var(--v-fg);font-weight:600}
.ib-s-planned .ib-badge{border-color:var(--v-accent)}
.ib-s-done .ib-badge{border-color:var(--v-accent);background:var(--v-accent);color:var(--v-accent-fg)}
.ib-s-dismissed .ib-text{color:var(--v-muted)}
.ib-reply{margin:.6rem 0 0;padding:.5rem .75rem;border-left:3px solid var(--v-accent);background:var(--v-bg);overflow-wrap:anywhere}
.ib-vote{display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;margin:0}
.ib-vote form{margin:0}
.ib-count{font-weight:600}
.ib-none,.ib-empty{padding:1rem;border:1px dashed var(--v-line);border-radius:12px}
.ib-note{display:none;position:fixed;right:1rem;bottom:1rem;left:1rem;z-index:50;max-width:30rem;margin:0 auto;padding:.75rem 1rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface);color:var(--v-fg);box-shadow:0 4px 18px rgba(0,0,0,.25)}
.ib-note:target{display:block}
.ib-note a{margin-left:.75rem;color:var(--v-fg);text-decoration:underline}
@media (max-width:480px){.ib-new,.ib-card{padding:.75rem}.ib-tools{display:block}}
`.replace(/\n/g, "");

const NOTES = [["sent", "noteSent"], ["review", "noteReview"], ["limit", "noteLimit"], ["invalid", "noteInvalid"], ["long", "noteLong"], ["links", "noteLinks"], ["full", "noteFull"],
  ["dup", "noteDup"], ["voted", "noteVoted"], ["again", "noteAgain"], ["off", "noteOff"], ["problem", "noteProblem"]];

function card(ctx, i, s) {
  const t = (k, v) => esc(ctx.t(k, v));
  const nick = i.nick ? `<span class="ib-by" data-ib-text>${t("by", { name: i.nick })}</span>` : "";
  const reply = i.reply ? `<p class="ib-reply" data-ib-text><strong>${t("reply")}</strong> — ${esc(i.reply)}</p>` : "";
  const count = `<span class="ib-count">${esc(ctx.t(i.votes === 1 ? "supportCount_one" : "supportCount", { n: i.votes }))}</span>`;
  const button = s.votes && VOTABLE.includes(i.status)
    ? `<form method="post" action="/m/${esc(ctx.instance.key)}/support?lang=${esc(ctx.locale)}"><input type="hidden" name="id" value="${esc(i.id)}"><button class="ib-btn" type="submit" aria-label="${t("supportAria", { idea: excerpt(i.text, 60) })}">${t("support")}</button></form>`
    : "";
  return `<li class="ib-card ib-s-${i.status}" data-ib-item id="idea-${esc(i.id)}"><p class="ib-text" data-ib-text>${esc(i.text)}</p>${reply}`
    + `<div class="ib-foot"><p class="ib-meta"><span class="ib-badge" data-ib-text>${t(`status_${i.status}`)}</span>${nick}</p><div class="ib-vote">${count}${button}</div></div></li>`;
}

/** La page : { html, shown, total }. `order` : « top » (les plus soutenues) ou « recent ». */
export async function renderPage(ctx, order) {
  const s = settings(ctx);
  const all = (await loadAll(ctx)).filter((i) => isPublic(i, s.showDismissed));
  const sorted = sortIdeas(all, order);
  const list = sorted.slice(0, PUBLIC_MAX);
  const base = pageHref(ctx) ?? "/";
  const root = base === "/" ? "" : base;
  const key = esc(ctx.instance.key);
  const t = (k, v) => esc(ctx.t(k, v));
  const parts = [`<style>${CSS}</style><noscript><style>.ib-needs-js{display:none!important}</style></noscript>`,
    `<div class="ib" id="ib-top" data-ib data-t-none="${t("searchNone")}" data-t-one="${t("searchOne")}" data-t-many="${t("searchMany")}">`];

  parts.push(`<section class="ib-new" aria-labelledby="ib-new-title"><h2 id="ib-new-title">${t("newTitle")}</h2>`
    + `<form method="post" action="/m/${key}/propose?lang=${esc(ctx.locale)}">`
    + `<label for="ib-idea-${key}">${t("ideaLabel")}</label>`
    + `<textarea id="ib-idea-${key}" name="idea" required minlength="3" maxlength="${s.textMax}" rows="3" placeholder="${t("ideaPlaceholder")}"></textarea>`
    + `<details class="ib-more"><summary>${t("moreOptions")}</summary><label for="ib-nick-${key}">${t("nickLabel")}</label>`
    + `<input id="ib-nick-${key}" type="text" name="nick" maxlength="30" autocomplete="off" placeholder="${t("nickPlaceholder")}"><p class="ib-hint">${t("nickHelp")}</p></details>`
    + `<div class="ib-trap" aria-hidden="true"><label>${t("trapLabel")} <input name="website" tabindex="-1" autocomplete="off"></label></div>`
    + `<button class="ib-btn ib-main" type="submit">${t("submit")}</button>`
    + `<p class="ib-hint">${t(s.autoPublish ? "hintOpen" : "hintReview")}</p></form></section>`);

  parts.push(`<section aria-labelledby="ib-list-title"><h2 id="ib-list-title">${t("listTitle")}</h2>`);
  if (!all.length) {
    parts.push(`<p class="ib-none">${t("none")}</p>`);
  } else {
    parts.push(`<div class="ib-search ib-needs-js" role="search"><label for="ib-q-${key}">${t("searchLabel")}</label>`
      + `<input id="ib-q-${key}" type="search" autocomplete="off" enterkeyhint="search" placeholder="${t("searchPlaceholder")}" data-ib-q><p class="ib-status-line" role="status" data-ib-status></p></div>`);
    parts.push(`<nav aria-label="${t("sortLabel")}"><ul class="ib-sort"><li><a href="${esc(base)}"${order === "top" ? ' aria-current="page"' : ""}>${t("sortTop")}</a></li>`
      + `<li><a href="${esc(root)}/recent"${order === "recent" ? ' aria-current="page"' : ""}>${t("sortRecent")}</a></li></ul></nav>`);
    parts.push(`<ul class="ib-list" style="margin-top:1rem">${list.map((i) => card(ctx, i, s)).join("")}</ul>`);
    parts.push(`<div class="ib-empty" data-ib-empty hidden><p>${t("noMatch")}</p><button type="button" class="ib-btn" data-ib-clear>${t("clearSearch")}</button></div>`);
    if (all.length > list.length) parts.push(`<p class="ib-hint">${t("truncated", { n: list.length })}</p>`);
  }
  parts.push(`</section>`);
  for (const [id, k] of NOTES) parts.push(`<p class="ib-note" id="ib-${id}" role="status">${t(k, { max: s.textMax })}<a href="#ib-top">${t("close")}</a></p>`);
  parts.push(`</div>`);
  return { html: parts.join(""), shown: list.length, total: all.length };
}
