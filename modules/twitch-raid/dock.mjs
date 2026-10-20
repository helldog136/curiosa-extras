// La page du dock : une page complète (pas un bloc du site) que l'on ajoute à OBS comme « dock de navigateur personnalisé », ou que l'on ouvre dans un onglet.
// Elle ne contient AUCUNE donnée : elle demande la liste des partenaires en direct à la route `live` du module (même adresse secrète) et se met à jour toute seule.
// Tout ce qui s'affiche vient de `textContent` (jamais de HTML) ; les seules phrases du serveur sont celles de locales/.
import { randomBytes } from "node:crypto";
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const pure = await import(`./pure.mjs${v}`);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Les phrases dont la page a besoin (clés `dock_…` des locales), sans le préfixe. */
const KEYS = [
  "title", "random", "random_again", "sort", "refresh", "updated", "copied", "copy_failed", "random_toast", "none_to_pick", "empty", "empty_hint", "loading",
  "no_partners", "nr_no_channel", "nr_channel_unknown", "nr_setup", "nr_refused", "nr_outdated", "err_twitch", "err_rate", "err_site", "retry", "denied", "viewers_one", "viewers_other", "hint", "list_label",
  "sort_viewers_asc", "sort_viewers_desc", "sort_newest", "sort_oldest", "sort_mine", "manual_label",
];
export const labelsOf = (ctx) => Object.fromEntries(KEYS.map((k) => [k, ctx.t(`dock_${k}`)]));

/** Les mêmes fonctions que celles testées, recopiées dans la page. */
const shared = [pure.raidCommand, pure.sortPartners, pure.pickRandom, pure.durationText].map((f) => f.toString()).join("\n");

const CLIENT = `
(function () {
  "use strict";
  var C = __CONFIG__, L = C.labels;
  __SHARED__
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (s, vars) { return String(s).replace(/\\{(\\w+)\\}/g, function (m, k) { return vars && vars[k] !== undefined ? vars[k] : m; }); };
  var st = { live: [], listed: 0, offset: 0, sort: C.sorts[0], picked: null, rows: {}, busy: false, timer: null, toastTimer: null, lastFetch: 0, failed: false, denied: false, ready: false, first: true };
  try { var saved = localStorage.getItem("raid-dock-sort"); if (saved && C.sorts.indexOf(saved) >= 0) st.sort = saved; } catch (e) { /* mémoire du navigateur indisponible : sans importance */ }

  function toast(text, kind) {
    var t = $("toast"); t.textContent = text; t.className = "toast show " + (kind || "");
    clearTimeout(st.toastTimer); st.toastTimer = setTimeout(function () { t.className = "toast"; }, 7000);
  }
  function banner(text) { var b = $("banner"); b.textContent = text || ""; b.hidden = !text; }
  function message(text, hint) {
    var m = $("msg"); m.replaceChildren();
    if (!text) { m.hidden = true; return; }
    var p = document.createElement("p"); p.className = "msg-main"; p.textContent = text; m.appendChild(p);
    if (hint) { var h = document.createElement("p"); h.className = "msg-hint"; h.textContent = hint; m.appendChild(h); }
    m.hidden = false;
  }

  /* Copier : l'API moderne d'abord (bornée à 1,5 s), puis l'ancienne méthode par un champ caché, puis, en dernier recours, la commande est montrée à copier à la main. */
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.setAttribute("aria-hidden", "true");
      ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
      document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
      var ok = document.execCommand("copy"); ta.remove(); return !!ok;
    } catch (e) { return false; }
  }
  function copyText(text) {
    return new Promise(function (resolve) {
      var done = false, finish = function (ok) { if (!done) { done = true; resolve(ok); } };
      var timer = setTimeout(function () { finish(legacyCopy(text)); }, 1500);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { clearTimeout(timer); finish(true); }, function () { clearTimeout(timer); finish(legacyCopy(text)); });
          return;
        }
      } catch (e) { /* on essaie l'autre méthode */ }
      clearTimeout(timer); finish(legacyCopy(text));
    });
  }
  function showManual(cmd) {
    var box = $("manual"), input = $("manual-input");
    input.value = cmd; box.hidden = false; input.focus(); input.select();
    toast(L.copy_failed, "warn");
  }
  function copyCommand(it, viaRandom) {
    var cmd = raidCommand(it.login);
    if (!cmd) return Promise.resolve();
    return copyText(cmd).then(function (ok) {
      if (!ok) { showManual(cmd); return; }
      $("manual").hidden = true;
      toast(viaRandom ? fmt(L.random_toast, { name: it.name, command: cmd }) : fmt(L.copied, { command: cmd }), "ok");
      var li = st.rows[it.login];
      if (li) { li.classList.add("copied"); li.querySelector(".c").textContent = "\\u2713 " + fmt(L.copied, { command: cmd }); setTimeout(function () { li.classList.remove("copied"); }, 3500); }
    });
  }

  function now() { return Date.now() + st.offset; }
  function makeRow(it) {
    var li = document.createElement("li"), b = document.createElement("button");
    b.type = "button"; b.className = "row"; b.dataset.login = it.login;
    ["n", "v", "m", "t", "c", "sr"].forEach(function (c) { var s = document.createElement("span"); s.className = c; b.appendChild(s); });
    b.querySelector(".c").setAttribute("aria-hidden", "true");
    b.addEventListener("click", function () { copyCommand(li._it, false); });
    li.appendChild(b); return li;
  }
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  function fillRow(li, it) {
    li._it = it; var b = li.firstChild, cmd = raidCommand(it.login);
    setText(b.querySelector(".n"), it.name);
    setText(b.querySelector(".v"), fmt(it.viewers === 1 ? L.viewers_one : L.viewers_other, { n: it.viewers }));
    setText(b.querySelector(".m"), (it.game ? it.game + " \\u00b7 " : "") + durationText(now() - it.startedAt));
    setText(b.querySelector(".t"), it.title);
    setText(b.querySelector(".sr"), fmt(L.hint, { command: cmd }));
    b.title = (it.title ? it.title + "\\n" : "") + fmt(L.hint, { command: cmd });
    li.classList.toggle("picked", st.picked === it.login);
  }
  function renderList() {
    var list = $("list"), sorted = sortPartners(st.live, st.sort), seen = {}, active = document.activeElement, focus = active && active.dataset ? active.dataset.login : null;
    sorted.forEach(function (it, i) {
      var li = st.rows[it.login] || (st.rows[it.login] = makeRow(it));
      fillRow(li, it); seen[it.login] = 1;
      if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
    });
    Object.keys(st.rows).forEach(function (l) { if (!seen[l]) { st.rows[l].remove(); delete st.rows[l]; } });
    if (focus && st.rows[focus] && document.activeElement !== st.rows[focus].firstChild) st.rows[focus].firstChild.focus({ preventScroll: true });
    list.hidden = !sorted.length;
    $("count").textContent = st.ready ? String(sorted.length) : "";
    $("rand").querySelector(".label").textContent = st.picked ? L.random_again : L.random;
  }

  function reasonText(d) {
    if (d.state === "not_ready") return L["nr_" + d.reason] || L.nr_setup;
    if (d.state === "no_partners") return L.no_partners;
    if (d.state === "denied") return L.denied;
    return d.reason === "rate" ? L.err_rate : d.reason === "site" ? L.err_site : L.err_twitch;
  }
  function apply(d, status) {
    if (status === 403 || (d && d.state === "denied")) d = { state: "denied" };
    if (d && typeof d.now === "number") st.offset = d.now - Date.now();
    st.failed = false; st.denied = d.state === "denied";
    if (d.state === "ok") {
      st.live = d.live; st.listed = d.listed; st.ready = true; st.lastFetch = Date.now();
      banner(""); message(d.live.length ? "" : L.empty, d.live.length ? "" : fmt(L.empty_hint, { n: d.listed }));
      $("updated").textContent = fmt(L.updated, { time: new Date(Date.now()).toLocaleTimeString(C.locale, { hour: "2-digit", minute: "2-digit" }) });
    } else if (d.state === "error") {
      st.failed = true; st.lastFetch = Date.now();
      if (d.stale) { st.live = d.stale.live; st.listed = d.stale.listed; st.ready = true; }
      if (st.ready) { banner(reasonText(d) + " " + L.retry); message(st.live.length ? "" : L.empty, st.live.length ? "" : fmt(L.empty_hint, { n: st.listed })); }
      else { banner(""); message(reasonText(d), L.retry); }
    } else {
      st.live = []; st.ready = false; st.failed = d.state === "not_ready"; banner(""); message(reasonText(d), d.state === "not_ready" ? L.retry : "");
    }
    if (st.picked && !st.live.some(function (x) { return x.login === st.picked; })) st.picked = null;
    renderList();
  }

  function schedule() {
    clearTimeout(st.timer);
    var wait = st.failed ? C.retryMs : C.intervalMs;
    st.timer = setTimeout(function () { refresh(); }, wait + Math.floor(Math.random() * 2000));
  }
  function refresh() {
    if (st.busy) return; st.busy = true; $("refresh").classList.add("spin");
    var ctl = new AbortController(), cut = setTimeout(function () { ctl.abort(); }, C.fetchMs);
    fetch(C.liveUrl, { cache: "no-store", signal: ctl.signal, credentials: "omit" })
      .then(function (r) { return r.json().then(function (j) { apply(j, r.status); }, function () { apply({ state: "error", reason: "site" }, r.status); }); })
      .catch(function () { apply({ state: "error", reason: "site" }, 0); })
      .then(function () { clearTimeout(cut); st.busy = false; $("refresh").classList.remove("spin"); if (!st.denied) schedule(); });
  }

  function random() {
    var pick = pickRandom(st.live, Math.random, st.picked);
    if (!pick) { toast(L.none_to_pick, "info"); return; }
    st.picked = pick.login; renderList();
    var li = st.rows[pick.login]; if (li) li.scrollIntoView({ block: "nearest" });
    copyCommand(pick, true);
  }

  var sel = $("sort"); sel.value = st.sort;
  sel.addEventListener("change", function () { st.sort = sel.value; try { localStorage.setItem("raid-dock-sort", st.sort); } catch (e) { /* tant pis */ } renderList(); });
  $("rand").addEventListener("click", random);
  $("refresh").addEventListener("click", refresh);
  $("manual-input").addEventListener("focus", function () { this.select(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && Date.now() - st.lastFetch > 20000) refresh(); });
  setInterval(function () { if (st.live.length) renderList(); }, 30000);   // la durée des directs avance sans rien redemander
  message(L.loading, ""); refresh();
})();`;

const CSS = (accent) => `
:root{color-scheme:dark;--bg:#0e0e10;--panel:#18181b;--panel2:#1f1f23;--line:#2f2f35;--fg:#efeff1;--muted:#adadb8;--accent:${accent};--ok:#3ddc84;--warn:#f5b041}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.35 system-ui,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
.wrap{max-width:560px;margin:0 auto;padding:0 12px 84px}
.head{position:sticky;top:0;z-index:2;background:var(--bg);padding:10px 0 8px;border-bottom:1px solid var(--line)}
h1{margin:0 0 8px;font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px}
h1 .count{min-width:1.6em;padding:0 .45em;border-radius:99px;background:var(--accent);color:#fff;font-size:12px;text-align:center;line-height:1.6}
h1 .count:empty{display:none}
.bar{display:flex;gap:8px;flex-wrap:wrap}
button,select,input{font:inherit;color:inherit}
.primary{flex:1 1 100%;min-height:44px;border:0;border-radius:10px;background:var(--accent);color:#fff;font-weight:700;font-size:15px;cursor:pointer}
.primary:hover{filter:brightness(1.1)}
.sortbox{flex:1 1 0;min-width:0;display:flex}
select{width:100%;min-height:40px;border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:0 8px}
.icon{flex:0 0 44px;min-height:40px;border:1px solid var(--line);border-radius:10px;background:var(--panel);cursor:pointer;font-size:18px;line-height:1}
.icon.spin{opacity:.55}
.sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:focus-visible{outline:2px solid #fff;outline-offset:2px}
.banner{margin:10px 0 0;padding:8px 10px;border-radius:8px;background:#3b2a05;border:1px solid #6b4d0e;color:#ffd98a}
.msg{margin:22px 4px;text-align:center}
.msg-main{margin:0 0 6px;font-size:15px}
.msg-hint{margin:0;color:var(--muted);font-size:13px}
.list{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:8px}
.row{width:100%;display:grid;grid-template-columns:1fr auto;column-gap:10px;row-gap:2px;text-align:left;padding:10px 12px;border:1px solid var(--line);border-left:4px solid var(--line);border-radius:10px;background:var(--panel);cursor:pointer}
.row:hover{background:var(--panel2);border-left-color:var(--accent)}
.n{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.v{color:var(--ok);font-weight:600;white-space:nowrap;font-size:13px}
.m{grid-column:1/-1;color:var(--muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t{grid-column:1/-1;font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.t:empty{display:none}
.c{grid-column:1/-1;display:none;color:var(--ok);font-weight:600;font-size:13px}
.copied .c{display:block}
.picked .row{border-color:var(--accent);border-left-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 45%,transparent)}
.manual{margin:12px 0 0;padding:10px;border:1px solid var(--warn);border-radius:10px;background:var(--panel)}
.manual label{display:block;margin-bottom:6px;color:var(--warn)}
.manual input{width:100%;min-height:40px;padding:0 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);font-family:ui-monospace,Consolas,monospace}
.foot{margin-top:12px;color:var(--muted);font-size:12px;text-align:center}
.toast{position:fixed;left:12px;right:12px;bottom:12px;max-width:536px;margin:0 auto;padding:10px 12px;border-radius:10px;background:var(--panel2);border:1px solid var(--line);opacity:0;pointer-events:none;transform:translateY(8px);transition:opacity .2s,transform .2s;overflow-wrap:anywhere}
.toast.show{opacity:1;transform:none}
.toast.ok{border-color:var(--ok)}.toast.warn{border-color:var(--warn)}
[hidden]{display:none!important}
@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}`;

/** La réponse complète : la page, avec une politique de sécurité qui n'autorise que ses propres scripts et ne contacte que le site lui-même. */
export function dockPage(ctx, { sorts = pure.SORTS, liveUrl }) {
  const nonce = randomBytes(16).toString("base64");
  const L = labelsOf(ctx);
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(ctx.theme?.accent ?? "")) ? ctx.theme.accent : "#9147ff";
  const config = { liveUrl, labels: L, sorts: [...sorts], intervalMs: 45_000, retryMs: 20_000, fetchMs: 12_000, locale: ctx.locale || "en" };
  const script = CLIENT.replace("__SHARED__", () => shared).replace("__CONFIG__", () => JSON.stringify(config).replace(/</g, "\\u003c"));
  const options = sorts.map((s) => `<option value="${esc(s)}">${esc(L[`sort_${s}`])}</option>`).join("");
  const html = `<!doctype html>
<html lang="${esc(ctx.locale || "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>${esc(L.title)}</title><link rel="icon" href="data:,"><style nonce="${nonce}">${CSS(accent)}</style></head>
<body><div class="wrap">
<header class="head"><h1><span>${esc(L.title)}</span><span class="count" id="count"></span></h1>
<div class="bar"><button type="button" class="primary" id="rand"><span aria-hidden="true">🎲 </span><span class="label">${esc(L.random)}</span></button>
<label class="sortbox"><span class="sr">${esc(L.sort)}</span><select id="sort">${options}</select></label>
<button type="button" class="icon" id="refresh" title="${esc(L.refresh)}" aria-label="${esc(L.refresh)}"><span aria-hidden="true">↻</span></button></div></header>
<div class="banner" id="banner" role="status" hidden></div>
<main><div class="msg" id="msg" role="status"></div>
<ul class="list" id="list" aria-label="${esc(L.list_label)}" hidden></ul>
<div class="manual" id="manual" hidden><label for="manual-input">${esc(L.manual_label)}</label><input id="manual-input" readonly></div></main>
<p class="foot" id="updated"></p>
</div><div class="toast" id="toast" role="status" aria-live="polite"></div>
<script nonce="${nonce}">${script}</script></body></html>`;
  return new Response(html, { headers: headers(nonce) });
}

const baseHeaders = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const headers = (nonce) => ({
  ...baseHeaders, "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
});
export const jsonHeaders = { ...baseHeaders, "Content-Type": "application/json; charset=utf-8" };

/** La page affichée quand l'adresse est incomplète ou n'est plus la bonne : une phrase simple, rien d'autre. */
export function deniedPage(ctx) {
  const L = labelsOf(ctx);
  const html = `<!doctype html><html lang="${esc(ctx.locale || "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(L.title)}</title>
<style>:root{color-scheme:dark}body{margin:0;padding:24px 16px;background:#0e0e10;color:#efeff1;font:15px/1.4 system-ui,sans-serif}p{max-width:34em;margin:0 auto}</style></head><body><p>${esc(L.denied)}</p></body></html>`;
  return new Response(html, { status: 403, headers: { ...baseHeaders, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });
}
