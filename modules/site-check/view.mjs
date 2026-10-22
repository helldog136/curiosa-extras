// Santé du site — ce que voit Emma : un résumé rassurant, des remarques regroupées, ce qui n'a pas pu être regardé, l'historique.
// Tout texte venu du site (titres, adresses…) passe par esc() avant d'entrer dans du HTML ; les tableaux (`table`) échappent seuls.
import { esc, clip } from "./urls.mjs";
import { visibleGroups, tally, progressOf, weightOf } from "./run.mjs";
import { LIMITS, fixHref } from "./scan.mjs";

const SHOWN = 8;   // remarques montrées d'abord dans chaque groupe ; « Voir les autres » déplie jusqu'à 60

const STYLE = `<style>
.sc{display:grid;gap:1rem;color:var(--v-fg)}
.sc *{box-sizing:border-box}
.sc-hero{border:1px solid var(--v-line);border-left-width:6px;border-radius:1rem;padding:1.1rem 1.25rem;background:var(--v-surface)}
.sc-ok{border-left-color:var(--v-success)}
.sc-some{border-left-color:var(--v-warning)}
.sc-wait{border-left-color:var(--v-accent)}
.sc-hero h2{margin:0 0 .3rem;font-size:1.4rem;line-height:1.25;font-weight:700}
.sc-hero p{margin:.2rem 0 0;max-width:62ch;overflow-wrap:anywhere}
.sc-meta{color:var(--v-muted);font-size:.9rem}
.sc-counts{display:flex;flex-wrap:wrap;gap:.5rem;margin:.8rem 0 0;padding:0;list-style:none}
.sc-chip{display:inline-flex;align-items:center;gap:.45rem;border:1px solid var(--v-line);border-radius:999px;padding:.25rem .75rem;font-size:.85rem;background:var(--v-bg)}
.sc-dot{width:.7rem;height:.7rem;border-radius:50%;flex:none;background:var(--v-muted)}
.sc-d-important{background:var(--v-warning)}
.sc-d-advised{background:var(--v-accent)}
.sc-d-info{background:var(--v-muted)}
.sc-bar{height:.9rem;border-radius:999px;border:1px solid var(--v-line);background:var(--v-bg);overflow:hidden;margin:.6rem 0 .3rem}
.sc-bar span{display:block;height:100%;background:var(--v-accent);min-width:2px}
@media (prefers-reduced-motion:no-preference){.sc-bar span{transition:width .4s ease}}
.sc-group{border:1px solid var(--v-line);border-radius:1rem;padding:.95rem 1.1rem .85rem;background:var(--v-surface);scroll-margin-top:5rem}
.sc-group h3{margin:.35rem 0 .15rem;font-size:1.05rem;line-height:1.35;font-weight:650;overflow-wrap:anywhere}
.sc-group p{margin:.15rem 0 0;color:var(--v-muted);font-size:.9rem;max-width:66ch;overflow-wrap:anywhere}
.sc-group a{color:var(--v-accent);text-decoration:underline;text-underline-offset:2px;display:inline-block;padding:.5rem 0}
.sc-sev{display:inline-flex;align-items:center;gap:.4rem;font-size:.8rem;font-weight:600;letter-spacing:.02em}
.sc-details{border:1px solid var(--v-line);border-radius:1rem;background:var(--v-surface);padding:.2rem 1.1rem}
.sc-details summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:600}
.sc-details ul{margin:.2rem 0 .8rem;padding-left:1.2rem;display:grid;gap:.4rem}
.sc-details li{overflow-wrap:anywhere}
.sc-details a{color:var(--v-accent);text-decoration:underline}
.sc-help{color:var(--v-muted);font-size:.9rem;max-width:66ch;margin:0}
.sc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
</style>`;

const wrap = (inner, first = false) => ({ type: "html", html: `${first ? STYLE : ""}<div class="sc">${inner}</div>` });

/** « il y a 5 minutes » (la date complète en infobulle). */
export function ago(ctx, iso, nowMs = Date.now()) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const diff = Math.round((at - nowMs) / 1000);
  const rtf = new Intl.RelativeTimeFormat(ctx.locale, { numeric: "auto" });
  const a = Math.abs(diff);
  if (a < 45) return rtf.format(0, "second");
  if (a < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}
const longDate = (ctx, iso) => { try { return new Intl.DateTimeFormat(ctx.locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return ""; } };
const langName = (ctx, code) => { try { return new Intl.DisplayNames([ctx.locale], { type: "language" }).of(code) || code; } catch { return code; } };
/** Les phrases qui changent avec le nombre : [singulier, pluriel] (clés écrites en toutes lettres). */
const PLURAL = {
  alt: ["g_alt_one", "g_alt_other"], title_empty: ["g_title_empty_one", "g_title_empty_other"], summary: ["g_summary_one", "g_summary_other"],
  title_dup: ["g_title_dup_one", "g_title_dup_other"], translation: ["g_translation_one", "g_translation_other"], internal: ["g_internal_one", "g_internal_other"],
  link_gone: ["g_link_gone_one", "g_link_gone_other"], img_gone: ["g_img_gone_one", "g_img_gone_other"], link_down: ["g_link_down_one", "g_link_down_other"],
  link_loop: ["g_link_loop_one", "g_link_loop_other"], link_blocked: ["g_link_blocked_one", "g_link_blocked_other"], link_moved: ["g_link_moved_one", "g_link_moved_other"],
  link_insecure: ["g_link_insecure_one", "g_link_insecure_other"], link_unverified: ["g_link_unverified_one", "g_link_unverified_other"],
  imgs: ["d_imgs_one", "d_imgs_other"], some: ["hero_some_text_one", "hero_some_text_other"], ignored: ["ignored_line_one", "ignored_line_other"], unlisted: ["unlisted_one", "unlisted_other"],
};
const plural = (ctx, name, n, vars = {}) => ctx.t(PLURAL[name][n === 1 ? 0 : 1], { count: n, ...vars });

/* ───────────── Phrases ───────────── */

export function sentence(ctx, g) {
  const where = g.loc && g.loc !== ctx.defaultLocale ? ` (${langName(ctx, g.loc)})` : "";
  const lang = g.loc ? langName(ctx, g.loc) : "";
  switch (g.id) {
    case "alt": return plural(ctx, "alt", g.count, { where });
    case "title_empty": return plural(ctx, "title_empty", g.count, { where });
    case "summary": return plural(ctx, "summary", g.count, { where });
    case "title_dup": return plural(ctx, "title_dup", g.count, { where });
    case "translation": return plural(ctx, "translation", g.count, { lang });
    case "internal": return plural(ctx, "internal", g.count, { where });
    case "home": return ctx.t("g_home");
    case "contact": return ctx.t("g_contact");
    case "empty": return ctx.t("g_empty");
    case "link_gone": return plural(ctx, "link_gone", g.count);
    case "img_gone": return plural(ctx, "img_gone", g.count);
    case "link_down": return plural(ctx, "link_down", g.count);
    case "link_loop": return plural(ctx, "link_loop", g.count);
    case "link_blocked": return plural(ctx, "link_blocked", g.count);
    case "link_moved": return plural(ctx, "link_moved", g.count);
    case "link_insecure": return plural(ctx, "link_insecure", g.count);
    default: return plural(ctx, "link_unverified", g.count);
  }
}
const WHY = new Set(["alt", "title_empty", "summary", "title_dup", "translation", "internal", "home", "contact", "empty", "link_gone", "img_gone", "link_down", "link_loop", "link_blocked", "link_moved", "link_insecure", "link_unverified"]);
export function why(ctx, g) {
  if (!WHY.has(g.id)) return "";
  return ctx.t(`w_${g.id}`, { lang: g.loc ? langName(ctx, g.loc) : "" });
}

/** Le détail d'une remarque (deuxième ligne d'une rangée). */
export function detail(ctx, g, item) {
  const d = Array.isArray(item.d) ? item.d : [];
  switch (d[0]) {
    case "imgs": return plural(ctx, "imgs", Number(d[1]) || 1);
    case "same": return ctx.t("d_same");
    case "absent": return ctx.t("d_absent");
    case "dup": return ctx.t("d_dup", { n: Number(d[1]) || 2 });
    case "path": return clip(d[1], 120);
    case "gone": return ctx.t("d_gone", { code: d[1] || 404 });
    case "down": return ctx.t(`d_down_${["timeout", "server", "badredirect"].includes(d[1]) ? d[1] : "network"}`, { code: d[1] });
    case "loop": return ctx.t("d_loop");
    case "blocked": return ctx.t("d_blocked", { code: d[1] || "" });
    case "moved": return ctx.t("d_moved", { to: clip(d[2], 120) });
    case "ok": return ctx.t("d_insecure");
    case "paused": return ctx.t("d_paused");
    case "skipped": return ctx.t(d[1] === "ignored" ? "d_skipped_ignored" : "d_skipped_perhost");
    case "refused": return ctx.t("d_refused");
    case "unverified": return ctx.t("d_unverified");
    default: return "";
  }
}

const rowText = (ctx, g, item) => {
  const place = item.w ? (item.u ? ctx.t("in_place", { place: clip(item.w, 70) }) : clip(item.w, 70)) : "";
  const second = [item.u ? clip(item.u.replace(/^https?:\/\//, ""), 80) : "", item.u ? "" : place, detail(ctx, g, item)].filter(Boolean).join(" · ");
  const third = item.u && place ? place : "";
  return [clip(item.t, 90), second, third].filter(Boolean).join("\n");
};

/* ───────────── Le résumé ───────────── */

function hero(ctx, st, groups, counts) {
  const { report, run } = st;
  if (!report) return `<section class="sc-hero sc-wait"><h2>${esc(ctx.t("hero_never_title"))}</h2><p>${esc(ctx.t("hero_never_text"))}</p></section>`;
  const prog = run ? progressOf(run) : null;
  const when = report.finished ? report.doneAt || report.at : report.at;
  const meta = `<p class="sc-meta" title="${esc(longDate(ctx, when))}">${esc(ctx.t(report.finished ? "hero_when" : "hero_started", { when: ago(ctx, when) }))}</p>`;
  const chips = ["important", "advised", "info"].map((s) => `<li class="sc-chip"><span class="sc-dot sc-d-${s}" aria-hidden="true"></span>${esc(ctx.t(`sev_${s}`))} : <b>${counts[s]}</b></li>`).join("");
  if (prog && !report.finished) {
    return `<section class="sc-hero sc-wait"><h2>${esc(ctx.t("hero_running_title"))}</h2><p>${esc(ctx.t("hero_running_text"))}</p>${meta}<ul class="sc-counts" aria-label="${esc(ctx.t("counts_label"))}">${chips}</ul></section>`;
  }
  const s = report.stats ?? {};
  const seen = ctx.t("hero_seen", { pages: s.pages ?? 0, images: s.images ?? 0, links: s.links ?? 0 });
  if (counts.important + counts.advised === 0) {
    const extra = counts.info ? ` ${ctx.t("hero_ok_info", { n: counts.info })}` : "";
    return `<section class="sc-hero sc-ok"><h2>${esc(ctx.t("hero_ok_title"))}</h2><p>${esc(`${seen} ${ctx.t("hero_ok_text")}${extra}`)}</p>${meta}${counts.info ? `<ul class="sc-counts" aria-label="${esc(ctx.t("counts_label"))}">${chips}</ul>` : ""}</section>`;
  }
  const n = counts.important + counts.advised;
  return `<section class="sc-hero sc-some"><h2>${esc(ctx.t("hero_some_title"))}</h2><p>${esc(`${seen} ${plural(ctx, "some", n)}`)}</p>${meta}<ul class="sc-counts" aria-label="${esc(ctx.t("counts_label"))}">${chips}</ul></section>`;
}

function progressHtml(ctx, run) {
  const { done, total } = progressOf(run);
  const pct = total ? Math.max(0, Math.min(100, Math.floor((done * 100) / total))) : 0;
  const label = ctx.t("progress_label", { done, total });
  return `<section class="sc-group" aria-live="polite"><b>${esc(label)}</b><div class="sc-bar" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span style="width:${pct}%"></span></div><p class="sc-help">${esc(ctx.t("progress_help"))}</p></section>`;
}

/* ───────────── Les groupes de remarques ───────────── */

function groupBlocks(ctx, g, expanded) {
  const key = `${g.id}-${g.loc ?? "all"}`;
  const showAll = expanded === key;
  const shown = showAll ? g.items : g.items.slice(0, SHOWN);
  const hidden = g.items.length - shown.length;
  const unlisted = Math.max(0, g.count - g.items.reduce((n, i) => n + weightOf(i), 0));
  const more = hidden > 0 ? `<a href="?all=${encodeURIComponent(key)}#sc-${esc(key)}">${esc(ctx.t("see_more", { n: hidden }))}</a>` : showAll && g.items.length > SHOWN ? `<a href="?#sc-${esc(key)}">${esc(ctx.t("see_less"))}</a>` : "";
  const tail = unlisted > 0 ? `<p>${esc(plural(ctx, "unlisted", unlisted))}</p>` : "";
  const head = `<section class="sc-group" id="sc-${esc(key)}"><span class="sc-sev"><span class="sc-dot sc-d-${g.sev}" aria-hidden="true"></span>${esc(ctx.t(`sev_${g.sev}`))}</span><h3>${esc(sentence(ctx, g))}</h3><p>${esc(why(ctx, g))}</p>${more}${tail}</section>`;
  return [
    wrap(head),
    {
      type: "table", columns: [ctx.t("col_item")], rows: shown.map((i) => [rowText(ctx, g, i)]), rowIds: shown.map((i) => i.k),
      rowActions: [{ label: ctx.t("btn_fix"), action: "fix" }, { label: ctx.t("btn_ignore"), action: "ignore", confirm: ctx.t("ignore_confirm") }],
    },
  ];
}

/* ───────────── Ce qui n'a pas pu être regardé ───────────── */

export function notChecked(ctx, report) {
  const out = [];
  const names = (list) => list.slice(0, 5).map((n) => clip(n, 40)).join(", ") + (list.length > 5 ? "…" : "");
  const n = report?.notes ?? {};
  out.push({ text: ctx.t("nc_menu"), href: "/admin/navigation", label: ctx.t("nc_menu_link") });
  out.push({ text: ctx.t("nc_other_pages") });
  out.push({ text: ctx.t("nc_files") });
  out.push({ text: ctx.t("nc_internal") });
  if (report?.linksOff) out.push({ text: ctx.t("nc_links_off") });
  if (n.multi === false) out.push({ text: ctx.t("nc_one_language") });
  if (n.capped?.length) out.push({ text: ctx.t("nc_capped", { names: names(n.capped), max: LIMITS.entries }) });
  if (n.unreadable?.length) out.push({ text: ctx.t("nc_unreadable", { names: names(n.unreadable) }) });
  if (n.cutInstances > 0) out.push({ text: ctx.t("nc_cut", { n: n.cutInstances }) });
  const t = report?.linkTotals;
  if (t?.window) out.push({ text: ctx.t("nc_window", { from: t.from + 1, to: Math.min(t.found, t.from + t.count), total: t.found }) });
  return out;
}

function notCheckedHtml(ctx, report) {
  const items = notChecked(ctx, report).map((i) => `<li>${esc(i.text)}${i.href ? ` <a href="${esc(i.href)}">${esc(i.label)}</a>` : ""}</li>`).join("");
  return `<details class="sc-details"><summary>${esc(ctx.t("nc_title"))}</summary><p class="sc-help">${esc(ctx.t("nc_intro"))}</p><ul>${items}</ul></details>`;
}

/* ───────────── Le panneau ───────────── */

export function panelBlocks(ctx, st, query = {}) {
  const { report, run, history, ignored, ignoredCount } = st;
  const groups = visibleGroups(report, ignored);
  const counts = tally(groups);
  const running = !!(run && report && !report.finished);
  const blocks = [];
  blocks.push(wrap(hero(ctx, st, groups, counts), true));
  if (running) blocks.push(wrap(progressHtml(ctx, run)));
  const label = running ? ctx.t("btn_restart") : report ? ctx.t("btn_check_again") : ctx.t("btn_check");
  if (running) {
    const { done, total } = progressOf(run);
    blocks.push({ type: "adminForm", action: "more", title: ctx.t("form_more_title"), submitLabel: ctx.t("btn_more", { done, total }), fields: [{ name: "go", kind: "hidden", value: "1" }] });
  }
  blocks.push({ type: "adminForm", action: "check", ...(running ? {} : { title: ctx.t("form_check_title") }), submitLabel: label, fields: [{ name: "go", kind: "hidden", value: "1" }] });
  blocks.push(wrap(`<p class="sc-help">${esc(ctx.t("check_help"))}</p>`));
  if (report && groups.length === 0 && report.finished) blocks.push(wrap(`<p class="sc-help">${esc(ctx.t("nothing_to_do"))}</p>`));
  const expanded = typeof query.all === "string" ? query.all.slice(0, 80) : "";
  for (const g of groups) blocks.push(...groupBlocks(ctx, g, expanded));
  if (ignoredCount > 0) {
    blocks.push(wrap(`<p class="sc-help">${esc(plural(ctx, "ignored", ignoredCount))}</p>`));
    blocks.push({ type: "adminForm", action: "unignore", submitLabel: ctx.t("btn_unignore"), fields: [{ name: "go", kind: "hidden", value: "1" }] });
  }
  blocks.push(wrap(notCheckedHtml(ctx, report)));
  if (history.length) {
    blocks.push({ type: "heading", text: ctx.t("history_title") });
    blocks.push({
      type: "table", columns: [ctx.t("col_date"), ctx.t("col_result"), ctx.t("col_seen")],
      rows: history.map((h) => [ago(ctx, h.doneAt || h.at), h.ok ? (h.counts?.info ? ctx.t("hist_ok_info", { n: h.counts.info }) : ctx.t("hist_ok")) : ctx.t("hist_some", { n: (h.counts?.important ?? 0) + (h.counts?.advised ?? 0), important: h.counts?.important ?? 0 }), ctx.t("hist_seen", { pages: h.pages ?? 0, links: h.links ?? 0 })]),
    });
  }
  return blocks;
}

/** Le même constat, en texte, pour un assistant : phrases, exemples, liens d'administration. */
export function describe(ctx, st) {
  const { report, run, history, ignored } = st;
  if (!report) return { checked: false, message: ctx.t("hero_never_text") };
  const groups = visibleGroups(report, ignored);
  const counts = tally(groups);
  return {
    checked: true, finished: !!report.finished, startedAt: report.at, finishedAt: report.doneAt ?? null,
    allGood: counts.important + counts.advised === 0, counts,
    progress: run && !report.finished ? progressOf(run) : null,
    seen: report.stats,
    remarks: groups.map((g) => ({ importance: g.sev, sentence: sentence(ctx, g), count: g.count, examples: g.items.slice(0, 5).map((i) => ({ title: clip(i.t, 90), detail: detail(ctx, g, i), fixPath: fixPath(ctx, i) })) })),
    notChecked: notChecked(ctx, report).map((i) => i.text),
    history: history.map((h) => ({ at: h.doneAt || h.at, allGood: !!h.ok, counts: h.counts })),
  };
}
const fixPath = (ctx, i) => fixHref(i.f, ctx.defaultLocale);
