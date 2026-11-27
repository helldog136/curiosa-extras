// Content notebook: the screen pieces made of HTML: tabs, cards, chips, pages. Every text that comes from the person (title, notes, networks, documents…) is
// escaped here, and only here: admin.mjs and docsAdmin.mjs never build HTML by hand.
// The colours are the site's (--v-* variables), so dark mode and the theme follow by themselves.
const v = new URL(import.meta.url).search; // the module version travels to the sibling files
const { placeOf, stepsDone, isLate, PLACES } = await import(`./data.mjs${v}`);

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Relative address of a screen of the notebook (`?col=doing&page=2`): only the known keys, always encoded. */
export function href(params = {}) {
  const u = new URLSearchParams();
  for (const k of ["idea", "col", "q", "page", "doc", "newDoc", "editDoc", "versionDoc"]) {
    const val = params[k];
    if (val === undefined || val === null || val === "" || (k === "page" && Number(val) <= 1) || (k === "col" && val === "idea" && !params.idea)) continue;
    u.set(k, String(val));
  }
  const s = u.toString();
  return s ? `?${s}` : "?";
}

export function fmtDate(ctx, iso) {
  try {
    return new Intl.DateTimeFormat(String(ctx.locale ?? "en"), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  } catch {
    return String(iso);
  }
}

export const CSS = `
.cp-nav{display:flex;flex-wrap:wrap;gap:.5rem;list-style:none;margin:0;padding:0}
.cp-tab,.cp-link{display:inline-flex;align-items:center;gap:.5rem;min-height:2.75rem;padding:0 .9rem;border:1px solid var(--v-line);border-radius:.75rem;background:var(--v-surface);color:var(--v-fg);font-size:.9375rem;line-height:1.2;text-decoration:none}
.cp-tab:hover,.cp-link:hover,.cp-card:hover{border-color:var(--v-accent)}
.cp-tab[aria-current="page"]{background:var(--v-accent);border-color:var(--v-accent);color:var(--v-accent-fg);font-weight:600}
.cp-tab:focus-visible,.cp-link:focus-visible,.cp-card:focus-visible{outline:2px solid var(--v-accent);outline-offset:2px}
.cp-n{min-width:1.5rem;padding:0 .4rem;border-radius:999px;background:color-mix(in srgb,currentColor 14%,transparent);font-size:.8125rem;text-align:center;line-height:1.5rem}
.cp-list{display:grid;gap:.75rem;list-style:none;margin:0;padding:0}
.cp-card{display:block;padding:1rem;border:1px solid var(--v-line);border-radius:1rem;background:var(--v-surface);color:var(--v-fg);text-decoration:none}
.cp-title{display:block;font-weight:600;font-size:1.0625rem;line-height:1.35;overflow-wrap:anywhere}
.cp-sum{display:block;margin-top:.25rem;color:var(--v-muted);font-size:.9375rem;line-height:1.4;overflow-wrap:anywhere}
.cp-chips{display:flex;flex-wrap:wrap;gap:.375rem;margin-top:.625rem}
.cp-chip{display:inline-flex;align-items:center;gap:.25rem;max-width:100%;padding:.125rem .6rem;border:1px solid var(--v-line);border-radius:999px;font-size:.8125rem;line-height:1.4;overflow-wrap:anywhere;color:var(--v-fg)}
.cp-late{border-color:var(--v-warning);background:color-mix(in srgb,var(--v-warning) 20%,transparent)}
.cp-bar{display:block;height:.375rem;margin-top:.625rem;border-radius:999px;background:var(--v-line);overflow:hidden}
.cp-bar>i{display:block;height:100%;background:var(--v-accent)}
.cp-pager{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.cp-empty{padding:1.25rem;border:1px dashed var(--v-line);border-radius:1rem;color:var(--v-muted);line-height:1.5}
.cp-note{padding:.875rem 1rem;border:1px solid var(--v-line);border-left:4px solid var(--v-accent);border-radius:.75rem;background:var(--v-surface);line-height:1.5}
.cp-note p{margin:0}.cp-note p+p{margin-top:.375rem}
.cp-sub{margin:0;color:var(--v-muted);line-height:1.5;overflow-wrap:anywhere}
.cp-notes{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
.cp-btn{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;padding:0 1.1rem;border:1px solid var(--v-accent);border-radius:.75rem;background:var(--v-accent);color:var(--v-accent-fg);font-size:.9375rem;font-weight:600;line-height:1.2;text-decoration:none}
.cp-btn:hover{filter:brightness(1.08)}
.cp-btn:focus-visible{outline:2px solid var(--v-accent);outline-offset:2px}
.cp-btn-quiet{background:var(--v-surface);color:var(--v-fg);border-color:var(--v-line);font-weight:400}
.cp-actions{display:flex;flex-wrap:wrap;gap:.5rem}
.cp-doc{padding:1rem;border:1px solid var(--v-line);border-radius:1rem;background:var(--v-surface);font:inherit;line-height:1.6;max-width:100%;overflow-x:hidden}
.cp-steps{margin:0;padding-left:1.25rem;line-height:1.7}
form:has(#f_quickTitle)>.grid{grid-template-columns:minmax(0,1fr)}
form:has(#f_quickTitle) button[type="submit"]{width:100%;min-height:3.5rem;font-size:1.125rem}
@media (min-width:640px){form:has(#f_quickTitle) button[type="submit"]{width:auto;min-width:16rem}}
@media (prefers-reduced-motion:no-preference){.cp-card,.cp-tab,.cp-link,.cp-btn{transition:border-color .15s}}
`;
export const styleBlock = () => ({ type: "html", html: `<style>${CSS}</style>` });

export const chipHtml = (text) => `<span class="cp-chip">${esc(text)}</span>`;
const chip = (text, cls = "") => `<span class="cp-chip${cls ? ` ${cls}` : ""}">${esc(text)}</span>`;

/** The chips of an idea: steps, date, publication, networks. `withPlace`: the place too (search results). */
export function chipsOf(ctx, idea, today, { withPlace = false, maxNetworks = 4 } = {}) {
  const t = ctx.t;
  const out = [];
  if (withPlace) out.push(chip(t(`place_${placeOf(idea)}`)));
  if (idea.steps.length) out.push(chip(t("chipSteps", { done: stepsDone(idea), total: idea.steps.length })));
  if (idea.column === "published" && idea.publishedAt) out.push(chip(t("chipPublished", { date: fmtDate(ctx, idea.publishedAt) })));
  else if (idea.targetDate) out.push(isLate(idea, today) ? chip(t("chipLate", { date: fmtDate(ctx, idea.targetDate) }), "cp-late") : chip(t("chipTarget", { date: fmtDate(ctx, idea.targetDate) })));
  for (const n of idea.networks.slice(0, maxNetworks)) out.push(chip(n));
  if (idea.networks.length > maxNetworks) out.push(chip(`+${idea.networks.length - maxNetworks}`));
  return out.length ? `<span class="cp-chips">${out.join("")}</span>` : "";
}

/** A card of the list: the whole card is the link to the idea. */
export function card(ctx, idea, today, link, opts = {}) {
  const t = ctx.t;
  const total = idea.steps.length;
  const bar = total && !idea.archived && idea.column !== "published" ? `<span class="cp-bar" aria-hidden="true"><i style="width:${Math.round((stepsDone(idea) / total) * 100)}%"></i></span>` : "";
  return `<li><a class="cp-card" href="${esc(link)}"><span class="cp-title">${esc(idea.title || t("untitled"))}</span>${idea.summary ? `<span class="cp-sub cp-sum">${esc(idea.summary)}</span>` : ""}${chipsOf(ctx, idea, today, opts)}${bar}</a></li>`;
}

/** The four places, with their count; the open place is marked (`aria-current`). */
export function tabs(ctx, current, counts, linkFor) {
  const t = ctx.t;
  const items = PLACES.map((p) => `<li><a class="cp-tab" href="${esc(linkFor(p))}"${p === current ? ' aria-current="page"' : ""}>${esc(t(`tab_${p}`))}${counts[p] ? `<span class="cp-n">${counts[p]}</span>` : ""}</a></li>`);
  return { type: "html", html: `<nav aria-label="${esc(t("tabsLabel"))}"><ul class="cp-nav">${items.join("")}</ul></nav>` };
}

export function pager(ctx, page, pages, linkFor) {
  if (pages <= 1) return null;
  const t = ctx.t;
  const prev = page > 1 ? `<a class="cp-link" rel="prev" href="${esc(linkFor(page - 1))}">← ${esc(t("pagePrev"))}</a>` : "";
  const next = page < pages ? `<a class="cp-link" rel="next" href="${esc(linkFor(page + 1))}">${esc(t("pageNext"))} →</a>` : "";
  return { type: "html", html: `<nav class="cp-pager" aria-label="${esc(t("pagerLabel"))}">${prev}<span class="cp-sub">${esc(t("pageOf", { page, pages }))}</span>${next}</nav>` };
}

/** A small box: one or more sentences (already plain text, escaped here). */
export const note = (lines) => ({ type: "html", html: `<div class="cp-note" role="status">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>` });
export const empty = (text) => ({ type: "html", html: `<div class="cp-empty">${esc(text)}</div>` });
export const backLink = (ctx, link, label) => ({ type: "html", html: `<p style="margin:0"><a class="cp-link" href="${esc(link)}">← ${esc(label)}</a></p>` });
