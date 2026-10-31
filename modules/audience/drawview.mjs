// Participation — le tirage au sort : ce que l'on voit. L'onglet d'administration, la page d'inscription du site et l'écran du stream (overlay et élément des pages d'overlay).
const V = new URL(import.meta.url).search;   // le cœur recharge ce fichier avec ?v=… : les fichiers voisins suivent
const L = await import(`./lib.mjs${V}`);
const K = await import(`./core.mjs${V}`);
const P = await import(`./drawlib.mjs${V}`);
const D = await import(`./draw.mjs${V}`);
const { esc } = L;

export const TAB = "draw";
const stamp = (ctx, iso) => { try { return new Intl.DateTimeFormat(ctx.locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return String(iso ?? ""); } };
const SOURCE_NAMES = { twitch: "Twitch", youtube: "YouTube", kick: "Kick", site: null };
const sourceText = (ctx, src) => (src === "site" ? ctx.t("drawSrcSite") : SOURCE_NAMES[src] ?? String(src || "—"));
const levelText = (ctx, lv) => ctx.t(`drawLevel_${P.LEVELS.includes(lv) ? lv : "all"}`);

/** Un code d'erreur du formulaire → le texte sous le champ (avec un exemple). */
export const fieldErrors = (ctx, errors) => Object.fromEntries(Object.entries(errors).map(([f, code]) => [f, ctx.t(`drawErr_${code}`)]));

/* ───────────── L'onglet « Tirage au sort » ───────────── */

function newFormFields(ctx, v) {
  return [
    { name: "title", label: ctx.t("drawFTitle"), kind: "text", required: true, value: v.title ?? "", help: ctx.t("drawFTitleHelp") },
    { name: "keyword", label: ctx.t("drawFKeyword"), kind: "text", value: v.keyword ?? "", help: ctx.t("drawFKeywordHelp") },
    { name: "level", label: ctx.t("drawFLevel"), kind: "select", value: v.level ?? "all", options: P.LEVELS.map((x) => ({ value: x, label: levelText(ctx, x) })), help: ctx.t("drawFLevelHelp") },
    { name: "site", label: ctx.t("drawFSite"), kind: "select", value: v.site === false ? "0" : "1", options: [{ value: "1", label: ctx.t("drawYes") }, { value: "0", label: ctx.t("drawNo") }], help: ctx.t("drawFSiteHelp") },
    { name: "minutes", label: ctx.t("drawFMinutes"), kind: "number", value: v.minutes ? String(v.minutes) : "", help: ctx.t("drawFMinutesHelp") },
    { name: "winners", label: ctx.t("drawFWinners"), kind: "number", value: String(v.winners ?? 1), help: ctx.t("drawFWinnersHelp") },
  ];
}

/** Les blocs de l'onglet. Rien n'est montré sans le droit « draw.manage ». */
export async function adminBlocks(ctx, { query, can, now = Date.now() }) {
  const tab = TAB, out = [];
  out.push({ type: "heading", text: ctx.t("drawTitle"), tab }, { type: "markdown", text: ctx.t("drawIntro"), tab });
  if (!can) return [...out, { type: "markdown", text: ctx.t("drawNoRight"), tab }];
  await D.sweep(ctx, now).catch(() => {});
  const d = await D.current(ctx, now);
  const st = P.stateOf(d, now);

  // ── Le tirage en cours ──
  out.push({ type: "heading", text: ctx.t("drawNowTitle"), tab });
  if (!d) out.push({ type: "markdown", text: ctx.t("drawNone"), tab });
  else {
    const lines = [ctx.t("drawSumState", { title: d.title.replace(/[\[\]\\*_`]/g, ""), state: ctx.t(`drawState_${st}`) }), ctx.t("drawSumCount", { n: d.purged ? d.total || 0 : d.count || 0 })];
    lines.push(d.keyword ? ctx.t("drawSumKeyword", { keyword: d.keyword.replace(/[\\*_`]/g, ""), level: levelText(ctx, d.level) }) : ctx.t("drawSumNoChat"));
    lines.push(ctx.t(d.site ? "drawSumSiteOn" : "drawSumSiteOff"));
    if (st === "open") lines.push(d.untilClosed ? ctx.t("drawSumUntilClosed") : ctx.t("drawSumEnds", { when: stamp(ctx, new Date(P.deadlineOf(d)).toISOString()) }));
    const names = D.latestBatch(d).map((w) => w.pseudo.replace(/[\\*_`]/g, "")).join(", ");
    if (names) lines.push(ctx.t("drawSumWinners", { names }));
    out.push({ type: "markdown", text: lines.map((l) => `- ${l}`).join("\n"), tab });
    if (d.site) out.push({ type: "copy", label: ctx.t("drawPageAddress"), text: `${ctx.api.siteUrl}/participation/tirage`, tab });
  }

  // ── Les gestes ──
  if (st === "open") out.push({ type: "adminForm", action: "drawClose", title: ctx.t("drawCloseTitle"), submitLabel: ctx.t("drawCloseBtn"), fields: [], tab });
  if (st === "closed" && d && !d.purged && !(d.picked ?? []).length) out.push({ type: "adminForm", action: "drawReopen", title: ctx.t("drawReopenTitle"), submitLabel: ctx.t("drawReopenBtn"), fields: [], tab });
  if (d && !d.purged && D.eligibleLeft(d) > 0) {
    out.push({ type: "adminForm", action: "drawPick", title: ctx.t("drawPickTitle"), submitLabel: ctx.t("drawPickBtn"), tab,
      fields: [{ name: "count", label: ctx.t("drawFPickCount"), kind: "number", value: String(P.winnersCount(d.winners)), help: ctx.t("drawFPickCountHelp") }] });
  }
  const newV = d ? { title: d.title, keyword: d.keyword, level: d.level, site: d.site, minutes: d.minutes, winners: d.winners } : { title: "", keyword: "", level: "all", site: true, minutes: "", winners: 1 };
  out.push(st === "open"
    ? { type: "markdown", text: ctx.t("drawNewBlocked"), tab }
    : { type: "adminForm", action: "drawNew", title: ctx.t("drawNewTitle"), submitLabel: ctx.t("drawNewBtn"), fields: newFormFields(ctx, newV), tab });
  if (d) out.push({ type: "adminForm", action: "drawClear", title: ctx.t("drawClearTitle"), submitLabel: ctx.t("drawClearBtn"), tab, fields: [{ name: "confirm", kind: "checkbox", label: ctx.t("drawClearConfirm"), help: ctx.t("drawClearHelp") }] });

  // ── Les personnes tirées au sort ──
  const won = d ? (d.picked ?? []).filter((w) => !w.absent) : [];
  if (won.length) {
    out.push({ type: "heading", text: ctx.t("drawWinnersTitle"), tab });
    out.push({ type: "table", tab, columns: [ctx.t("colPseudo"), ctx.t("drawColSource"), ctx.t("drawColDrawnAt")], rows: won.map((w) => [w.pseudo, sourceText(ctx, w.src), stamp(ctx, w.at)]), rowIds: won.map((w) => w.k),
      rowActions: [{ label: ctx.t("drawRedrawBtn"), action: "drawRedraw", confirm: ctx.t("drawRedrawConfirm") }] });
  }

  // ── Les personnes inscrites (50 par page, équipe d'administration seulement) ──
  out.push({ type: "heading", text: ctx.t("drawPeopleTitle"), tab }, { type: "markdown", text: ctx.t("drawPeopleIntro"), tab });
  if (d && d.purged) out.push({ type: "markdown", text: ctx.t("drawPurged"), tab });
  else {
    const cursor = typeof query?.c === "string" && query.c.length < 400 ? query.c : null;
    const page = await D.entriesPage(ctx, d, cursor, P.DRAW.pageSize);
    out.push(page.items.length
      ? { type: "table", tab, columns: [ctx.t("colPseudo"), ctx.t("drawColSource"), ctx.t("drawColAt"), ctx.t("drawColState")], rows: page.items.map((p) => [p.pseudo || ctx.t("anon"), sourceText(ctx, p.src), stamp(ctx, p.at), p.won ? ctx.t("drawWonTag") : "—"]), rowIds: page.items.map((p) => p.id),
        rowActions: [{ label: ctx.t("drawRemoveBtn"), action: "drawRemove", confirm: ctx.t("drawRemoveConfirm"), danger: true }, { label: ctx.t("drawRemoveMuteBtn"), action: "drawRemoveMute", confirm: ctx.t("drawRemoveMuteConfirm"), danger: true }] }
      : { type: "markdown", text: ctx.t("drawPeopleEmpty"), tab });
    if (page.next) out.push({ type: "markdown", text: `[${ctx.t("nextPage")}](?tab=${TAB}&c=${encodeURIComponent(page.next)})`, tab });
  }

  // ── L'historique ──
  const hist = await D.history(ctx, now);
  out.push({ type: "heading", text: ctx.t("drawHistoryTitle"), tab });
  out.push(hist.length
    ? { type: "table", tab, columns: [ctx.t("drawColTitle"), ctx.t("colWhen"), ctx.t("drawColWinners"), ctx.t("colPeople")], rows: hist.map((h) => [h.title, stamp(ctx, h.at), h.winners.length ? h.winners.join(", ") : "—", String(h.participants)]) }
    : { type: "markdown", text: ctx.t("drawHistoryEmpty"), tab });

  // ── L'écran du stream ──
  const key = await D.screenKey(ctx);
  out.push({ type: "heading", text: ctx.t("drawScreenTitle"), tab }, { type: "markdown", text: ctx.t("drawScreenHelp"), tab },
    { type: "copy", label: ctx.t("drawScreenAddress"), text: `${ctx.api.siteUrl}/overlays/${ctx.instance.key}?k=${key}`, tab },
    { type: "markdown", text: ctx.t("drawScreenSecret"), tab },
    { type: "adminForm", action: "drawKeyRegen", title: ctx.t("drawKeyTitle"), submitLabel: ctx.t("drawKeyBtn"), tab, fields: [{ name: "confirm", kind: "checkbox", label: ctx.t("drawKeyConfirm"), help: ctx.t("drawKeyHelp") }] });
  return out;
}

/* ───────────── La page d'inscription du site ───────────── */

const DRAW_CODES = ["closed", "no_site", "already", "muted", "full"];
const SHARED_CODES = ["limit", "busy", "invalid", "net", "unknown_participant", "pseudo_short", "pseudo_long", "pseudo_chars", "pseudo_banned", "pseudo_taken"];

/** La page publique : un champ pseudo, un bouton, des messages clairs. Le script (client.mjs) la remplit avec l'état réel dès qu'elle s'ouvre. */
export async function publicPage(ctx, css, now = Date.now()) {
  const cfg = K.cfgOf(ctx);
  const d = await D.current(ctx, now);
  const st = P.stateOf(d, now), open = st === "open" && d.site;
  const n = st === "open" ? d.count || 0 : 0;
  const say = (k, v) => ctx.t(k, v);
  const attrs = [
    ...DRAW_CODES.map((c) => [`data-m-${c}`, say(`dm_${c}`)]),
    ...SHARED_CODES.map((c) => [`data-m-${c}`, say(`pm_${c}`, { min: cfg.min, max: cfg.max })]),
    ["data-m-busy", say("sending")],
    ["data-s-none", say("drawStateNone")], ["data-s-closed", say("drawStateClosed")], ["data-s-nosite", say("drawStateNoSite")], ["data-s-in", say("drawStateIn")],
    ["data-c-one", say("drawCountOne", { n: "{n}" })], ["data-c-many", say("drawCountMany", { n: "{n}" })],
  ].map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
  const first = st === "none" ? say("drawStateNone") : st !== "open" ? say("drawStateClosed") : !d.site ? say("drawStateNoSite", { keyword: d.keyword }) : "";
  return `<style>${css}</style><section class="au" data-aud-draw data-api="/m/${esc(ctx.instance.key)}" data-lang="${esc(ctx.locale)}" ${attrs}>` +
    `<h2 data-aud-title>${esc(st === "open" ? d.title : ctx.t("drawPageTitle"))}</h2><p>${esc(ctx.t("drawPageIntro"))}</p>` +
    `<p class="au-cur" data-aud-state role="status"${first ? "" : " hidden"}>${esc(first)}</p>` +
    `<p class="au-muted" data-aud-count${open ? "" : " hidden"}>${esc(st === "open" ? say(n === 1 ? "drawCountOne" : "drawCountMany", { n }) : "")}</p>` +
    `<form data-aud-form novalidate${open ? "" : " hidden"}><label for="au-name">${esc(ctx.t("pseudoLabel"))}</label>` +
    `<input class="au-in" id="au-name" name="name" data-aud-name type="text" maxlength="${cfg.max + 10}" autocomplete="nickname" autocapitalize="off" spellcheck="false" aria-describedby="au-help au-err">` +
    `<p class="au-muted" id="au-help">${esc(ctx.t("pseudoHelp", { min: cfg.min, max: cfg.max }))}</p><p class="au-err" id="au-err" data-aud-err role="alert" hidden></p>` +
    `<div class="au-hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>` +
    `<p style="margin-top:12px"><button class="au-btn" type="submit">${esc(ctx.t("drawJoin"))}</button></p><p class="au-ok" data-aud-ok role="status" hidden></p></form>` +
    `<noscript><p class="au-muted">${esc(ctx.t("needScript"))}</p></noscript></section>`;
}

/* ───────────── L'écran du stream : l'overlay et l'élément « Tirage au sort » ───────────── */

export const OVERLAY_JS = String.raw`(function () {
  "use strict";
  var c = window.__DW;
  var box = document.getElementById("dw-box");
  var timer = null, clockTimer = null, flip = null, rev = "", delay = c.base, skew = 0, cur = null;
  function el(tag, cls, text, part) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; if (part) n.setAttribute("data-ov-part", part); return n; }
  function now() { return Date.now() + skew; }
  function clock(ms) { var s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60); return (m < 10 ? "0" : "") + m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }
  function plural(n, one, many) { return (n === 1 ? one : many).replace("{n}", n); }
  function winnersShown(d) {
    if (d.state !== "drawn" || !d.winners || !d.winners.length) return false;
    if (c.el && c.keep) return true;
    return !!d.showUntil && now() < Date.parse(d.showUntil);
  }
  function render(d) {
    cur = d; clearTimeout(flip);
    var win = winnersShown(d);
    if (!win && (!c.el || d.state === "none")) { box.replaceChildren(); return; }
    var card = el("div", "dw-card", undefined, "panel"), body = el("div", "dw-body", undefined, "body");
    if (win) {
      body.appendChild(el("p", "dw-state", d.winners.length === 1 ? c.t.winner : c.t.winners, "status"));
      var ul = el("ul", "dw-list", undefined, "winners");
      for (var i = 0; i < d.winners.length; i++) ul.appendChild(el("li", "dw-name", d.winners[i], "winner"));
      body.appendChild(ul);
      body.appendChild(el("p", "dw-foot", d.title, "foot"));
      if (!(c.el && c.keep) && d.showUntil) flip = setTimeout(function () { render(cur); }, Math.max(50, Date.parse(d.showUntil) - now() + 50));
    } else {
      var head = el("p", "dw-state", d.state === "open" ? c.t.open : (d.state === "drawn" ? c.t.done : c.t.closed), "status");
      if (d.state === "open" && d.until) { var clk = el("span", "dw-clock", clock(Date.parse(d.until) - now()), "clock"); clk.setAttribute("data-end", d.until); head.appendChild(clk); }
      body.appendChild(head);
      body.appendChild(el("h1", "dw-title", d.title, "title"));
      if (d.state === "open") {
        var how = d.keyword && d.site ? c.t.both : (d.keyword ? c.t.chat : c.t.site);
        body.appendChild(el("p", "dw-how", how.replace("{keyword}", d.keyword || ""), "how"));
      }
      body.appendChild(el("p", "dw-foot", plural(d.count, c.t.one, c.t.many), "foot"));
    }
    card.appendChild(body); box.replaceChildren(card);
    schedClock(); fit();
  }
  function schedClock() { clearTimeout(clockTimer); if (box.querySelector("[data-end]") && !document.hidden) clockTimer = setTimeout(tickClock, 1000); }
  function tickClock() {
    var ends = box.querySelectorAll("[data-end]");
    for (var i = 0; i < ends.length; i++) ends[i].textContent = clock(Date.parse(ends[i].getAttribute("data-end")) - now());
    schedClock();
  }
  // Dans une page d'overlay : la police s'ajuste à la taille réelle du cadre, de façon que rien ne déborde (recherche entre 10 et 48 px).
  function fit() {
    if (!c.el) return;
    var p = box.firstElementChild, b = p && p.firstElementChild;
    if (!b) return;
    var lo = 10, hi = 48;
    for (var i = 0; i < 7; i++) {
      var mid = (lo + hi) / 2;
      box.style.setProperty("--dw-fs", mid + "px");
      var cs = getComputedStyle(p), w = p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h = p.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (b.offsetHeight <= h + 1 && b.scrollWidth <= w + 1) lo = mid; else hi = mid;
    }
    box.style.setProperty("--dw-fs", lo + "px");
  }
  if (c.el) addEventListener("resize", function () { fit(); });
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(tick, ms); }
  function tick() {
    if (document.hidden) { schedule(c.base * 4); return; }
    fetch(c.url + (c.url.indexOf("?") < 0 ? "?" : "&") + "rev=" + encodeURIComponent(rev), { cache: "no-store", credentials: "omit", signal: (typeof AbortSignal !== "undefined" && AbortSignal.timeout) ? AbortSignal.timeout(15000) : undefined })
      .then(function (r) {
        var h = r.headers.get("date"), t = h ? Date.parse(h) : NaN;
        if (!isNaN(t)) skew = t - Date.now();
        if (!r.ok) throw new Error("http");
        return r.json();
      })
      .then(function (j) {
        if (j && j.empty) { box.replaceChildren(); rev = ""; cur = null; delay = Math.min(c.max, Math.max(delay, c.base) * 2); }
        else if (j && j.unchanged) { delay = Math.min(c.max, Math.round(delay * 1.5)); }
        else if (j && j.data) { rev = String(j.rev); render(j.data); delay = c.base; }
        else throw new Error("shape");
        if (j && j.next) delay = Math.max(delay, Math.min(60000, j.next));
      })
      .catch(function () { delay = Math.min(60000, Math.max(delay, c.base) * 2); })
      .then(function () { schedule(delay); });
  }
  if (c.demo) { render(c.demo); return; }   // mode test d'une page d'overlay : un tirage d'exemple, rien n'est demandé au site
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { schedule(300); schedClock(); } });
  tick();
})();
`;

/** La feuille de style : jetons --ov-* de la page d'overlay (avec repli sur les couleurs du site pour l'overlay seul), morceaux décrits par data-ov-part, jamais le skin du site. */
export function overlayCss(query, { accent, fg, card, font, el }) {
  const given = query.has("ov-text"), dark = query.get("ov-text") === "dark", soft = query.get("ov-surface") === "soft", square = query.get("ov-corners") === "square";
  const tokens = given ? `:root{--ov-fg:${dark ? "#111111" : "#ffffff"};--ov-surface:${soft ? (dark ? "rgba(255,255,255,.7)" : "rgba(0,0,0,.55)") : "transparent"};--ov-radius:${square ? "0px" : "12px"};--ov-border:${soft ? (dark ? "rgba(0,0,0,.2)" : "rgba(255,255,255,.25)") : "transparent"}}` : "";
  const shadow = given && !soft ? (dark ? "text-shadow:0 0 .2em rgba(255,255,255,.85);" : "text-shadow:0 .05em .2em rgba(0,0,0,.8);") : "";
  const base = `${tokens}
html,body{margin:0;background:transparent;overflow:hidden;font-family:${font || "system-ui,sans-serif"}}
[data-ov-part="winners"]{list-style:none;margin:0;padding:0;display:grid;gap:.2em}
[data-ov-part="winner"]{font-weight:800;line-height:1.15;overflow-wrap:anywhere}
[data-ov-part="status"]{margin:0;font-size:.8em;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--dw-accent)}
[data-ov-part="clock"]{margin-left:.5em;font-variant-numeric:tabular-nums}
[data-ov-part="title"]{margin:0;font-weight:700;line-height:1.2;overflow-wrap:anywhere;text-wrap:balance}
[data-ov-part="how"]{margin:0;font-weight:600}
[data-ov-part="foot"]{margin:0;font-size:.8em;opacity:.85;overflow-wrap:anywhere}`;
  if (el) {
    return `${base}
[data-ov-region="element"]{position:fixed;inset:0;overflow:hidden;font-size:var(--dw-fs,18px);line-height:1.25;color:var(--ov-fg,${fg});${shadow}--dw-accent:${accent}}
[data-ov-part="panel"]{box-sizing:border-box;height:100%;display:flex;flex-direction:column;padding:.6em .8em;background:var(--ov-surface,${card});border:1px solid var(--ov-border,transparent);border-radius:var(--ov-radius,.9em);overflow:hidden}
[data-ov-part="body"]{margin:auto 0;display:flex;flex-direction:column;gap:.5em;min-width:0}
[data-ov-part="title"]{font-size:1.3em}[data-ov-part="winner"]{font-size:1.5em}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}`;
  }
  return `${base}
#dw-box{position:fixed;left:32px;bottom:32px;width:min(640px,calc(100vw - 64px));--dw-accent:${accent};color:${fg}}
.dw-card{background:${card};color:${fg};border-radius:20px;padding:22px 26px;box-shadow:0 8px 32px rgba(0,0,0,.45);animation:dw-in .4s ease-out}
.dw-body{display:grid;gap:10px}
[data-ov-part="status"]{font-size:18px}[data-ov-part="winner"]{font-size:38px}[data-ov-part="title"]{font-size:30px}[data-ov-part="how"]{font-size:22px}[data-ov-part="foot"]{font-size:18px}
@keyframes dw-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.dw-card{animation:none}}`;
}

/** La page de l'écran (secret en `k`). `el` : élément d'une page d'overlay (le cœur ajoute ov-* et opt-*). */
export async function overlayPage(ctx, { query }) {
  const key = await D.screenKey(ctx);
  const el = query.has("ov-fit"), demo = el && query.get("ov-demo") === "1";
  if (!L.sameSecret(query.get("k"), key)) return el ? { title: ctx.instance.name, html: "" } : { title: ctx.instance.name, html: `<p style="margin:24px;padding:16px 20px;max-width:560px;border-radius:12px;background:#222;color:#fff;font:18px/1.4 system-ui,sans-serif">${esc(ctx.t("drawScreenIncomplete"))}</p>` };
  const cfg = K.cfgOf(ctx);
  if (!demo) await D.syncLive(ctx).catch(() => {});
  const color = (v, d) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
  const t = (k) => ctx.t(k);
  const conf = {
    url: `/m/${ctx.instance.key}/direct?room=${P.DRAW.room}&channel=${P.DRAW.channel}&k=${encodeURIComponent(query.get("k"))}`,
    base: cfg.directMin, max: 30000, lang: ctx.locale, el, keep: el && query.get("opt-keep") === "1",
    t: { winner: t("drawOvWinner"), winners: t("drawOvWinners"), open: t("drawOvOpen"), closed: t("drawOvClosed"), done: t("drawOvDone"), both: t("drawOvBoth"), chat: t("drawOvChat"), site: t("drawOvSiteOnly"), one: t("drawCountOne").replace("{n}", "{n}"), many: t("drawCountMany") },
    ...(demo ? { demo: { v: 1, state: "open", title: t("drawDemoTitle"), keyword: "!cadeau", site: true, count: 42, until: null, winners: [], showUntil: null } } : {}),
  };
  const json = JSON.stringify(conf).replace(/</g, "\\u003c");
  const style = { accent: color(ctx.theme?.accent, "#e8a23b"), fg: color(ctx.theme?.fg, "#ffffff"), card: color(ctx.theme?.surface, "#1b1b1d"), font: ctx.theme?.font, el };
  return { title: ctx.instance.name, html: `<div id="dw-box" role="status" aria-live="polite"${el ? ' data-ov-region="element"' : ""}></div>`, css: overlayCss(query, style), script: `window.__DW=${json};${OVERLAY_JS}` };
}
