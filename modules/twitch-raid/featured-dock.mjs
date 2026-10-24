// LE DOCK DE LA SÉLECTION (2.2) : une page complète à ajouter dans OBS (« dock de navigateur personnalisé ») ou à ouvrir dans un onglet. Elle montre la sélection du moment
// (moment.mjs) : les N membres en direct tirés au hasard, les MÊMES que ceux de la page publique. Un clic sur un membre copie `/raid pseudo` (comme le dock ordinaire), et
// « Tirer de nouveau » demande une nouvelle sélection pour tout le monde (au plus une fois toutes les 5 secondes).
// Comme le dock ordinaire : l'adresse est secrète (la MÊME clé, voir data.mjs), la page ne contient AUCUNE donnée (elle lit `featured-data`), tout ce qui s'affiche vient de
// `textContent`, la politique de sécurité n'autorise que son propre script. Le dock ordinaire (dock.mjs) n'est pas modifié : seuls son style et ses en-têtes sont réutilisés.
import { randomBytes } from "node:crypto";
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const pure = await import(`./pure.mjs${v}`);
const dock = await import(`./dock.mjs${v}`);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const FD_KEYS = ["title", "again", "again_busy", "until", "rerolled", "wait", "empty", "empty_hint", "stale", "list_label"];
/** Les phrases de la page : celles du dock ordinaire (copier, erreurs, adresse refusée… sans le préfixe `dock_`) et celles de la sélection (clés `fd_…`). */
export const labelsOf = (ctx) => ({ ...dock.labelsOf(ctx), ...Object.fromEntries(FD_KEYS.map((k) => [`fd_${k}`, ctx.t(`fd_${k}`)])) });

const shared = [pure.raidCommand, pure.durationText].map((f) => f.toString()).join("\n");

const CLIENT = `
(function () {
  "use strict";
  var C = __CONFIG__, L = C.labels;
  __SHARED__
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (s, vars) { return String(s).replace(/\\{(\\w+)\\}/g, function (m, k) { return vars && vars[k] !== undefined ? vars[k] : m; }); };
  var st = { picks: [], ready: false, rows: {}, busy: false, rerolling: false, timer: null, toastTimer: null, lastFetch: 0, failed: false, denied: false, offset: 0, endsAt: 0, lastReroll: 0 };

  function toast(text, kind) {
    var t = $("toast"); t.textContent = text; t.className = "toast show " + (kind || "");
    clearTimeout(st.toastTimer); st.toastTimer = setTimeout(function () { t.className = "toast"; }, 6000);
  }
  function banner(text) { var b = $("banner"); b.textContent = text || ""; b.hidden = !text; }
  function message(text, hint) {
    var m = $("msg"); m.replaceChildren();
    if (!text) { m.hidden = true; return; }
    var p = document.createElement("p"); p.className = "msg-main"; p.textContent = text; m.appendChild(p);
    if (hint) { var h = document.createElement("p"); h.className = "msg-hint"; h.textContent = hint; m.appendChild(h); }
    m.hidden = false;
  }
  function clock(ms) { try { return new Date(ms).toLocaleTimeString(C.locale, { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }

  /* Copier : l'API moderne d'abord (bornée à 1,5 s), puis l'ancienne méthode par un champ caché, puis la commande est montrée à copier à la main. */
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
  function showManual(cmd) { var box = $("manual"), input = $("manual-input"); input.value = cmd; box.hidden = false; input.focus(); input.select(); toast(L.copy_failed, "warn"); }
  function copyCommand(it) {
    var cmd = raidCommand(it.login);
    if (!cmd) return;
    copyText(cmd).then(function (ok) {
      if (!ok) { showManual(cmd); return; }
      $("manual").hidden = true; toast(fmt(L.copied, { command: cmd }), "ok");
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
    b.addEventListener("click", function () { copyCommand(li._it); });
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
  }
  function renderList() {
    var list = $("list"), seen = {};
    st.picks.forEach(function (it, i) {
      var li = st.rows[it.login] || (st.rows[it.login] = makeRow(it));
      fillRow(li, it); seen[it.login] = 1;
      if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
    });
    Object.keys(st.rows).forEach(function (l) { if (!seen[l]) { st.rows[l].remove(); delete st.rows[l]; } });
    list.hidden = !st.picks.length;
    $("count").textContent = st.ready ? String(st.picks.length) : "";
  }

  function reasonText(d) {
    if (d.state === "not_ready") return L["nr_" + d.reason] || L.nr_setup;
    if (d.state === "no_partners") return L.no_partners;
    if (d.state === "denied") return L.denied;
    return d.reason === "rate" ? L.err_rate : d.reason === "site" ? L.err_site : d.reason === "contacts" ? L.nr_contacts_down : L.err_twitch;
  }
  function apply(d, status) {
    if (status === 403 || (d && d.state === "denied")) d = { state: "denied" };
    if (d && typeof d.now === "number") st.offset = d.now - Date.now();
    st.failed = false; st.denied = d.state === "denied";
    if (d.state === "ok") {
      st.picks = d.picks.map(function (p, i) { p.pos = i; return p; }); st.ready = true; st.lastFetch = Date.now(); st.endsAt = d.endsAt || 0;
      banner(d.stale ? fmt(L.fd_stale, { time: clock(d.stale) }) : "");
      message(d.picks.length ? "" : L.fd_empty, d.picks.length ? "" : L.fd_empty_hint);
      $("updated").textContent = d.endsAt ? fmt(L.fd_until, { time: clock(d.endsAt) }) : "";
    } else if (d.state === "error") {
      st.failed = true; st.lastFetch = Date.now();
      if (st.ready) { banner(reasonText(d) + " " + L.retry); }
      else { banner(""); message(reasonText(d), L.retry); }
    } else {
      st.picks = []; st.ready = false; st.failed = d.state === "not_ready"; banner(""); message(reasonText(d), d.state === "not_ready" ? L.retry : "");
      $("updated").textContent = "";
    }
    renderList();
  }

  function schedule() {
    clearTimeout(st.timer);
    if (st.denied) return;
    st.timer = setTimeout(function () { refresh(); }, (st.failed ? C.retryMs : C.intervalMs) + Math.floor(Math.random() * 2000));
  }
  function refresh() {
    if (st.busy) return; st.busy = true; $("refresh").classList.add("spin");
    var ctl = new AbortController(), cut = setTimeout(function () { ctl.abort(); }, C.fetchMs);
    fetch(C.dataUrl, { cache: "no-store", signal: ctl.signal, credentials: "omit" })
      .then(function (r) { return r.json().then(function (j) { apply(j, r.status); }, function () { apply({ state: "error", reason: "site" }, r.status); }); })
      .catch(function () { apply({ state: "error", reason: "site" }, 0); })
      .then(function () { clearTimeout(cut); st.busy = false; $("refresh").classList.remove("spin"); schedule(); });
  }

  /* « Tirer de nouveau » : une nouvelle sélection pour tout le monde. Une demande à la fois, jamais deux à moins de 2 secondes d'écart ; le serveur limite aussi (5 s). */
  function again() {
    if (st.rerolling || Date.now() - st.lastReroll < 2000) return;
    st.rerolling = true; st.lastReroll = Date.now();
    var b = $("again"); b.disabled = true; b.setAttribute("aria-busy", "true"); b.querySelector(".label").textContent = L.fd_again_busy;
    var ctl = new AbortController(), cut = setTimeout(function () { ctl.abort(); }, C.fetchMs);
    fetch(C.againUrl, { method: "POST", cache: "no-store", signal: ctl.signal, credentials: "omit" })
      .then(function (r) { return r.json().then(function (j) { return { j: j, status: r.status }; }, function () { return { j: { state: "error", reason: "site" }, status: r.status }; }); })
      .catch(function () { return { j: { state: "error", reason: "site" }, status: 0 }; })
      .then(function (x) {
        clearTimeout(cut); st.rerolling = false;
        apply(x.j, x.status);
        if (x.j && x.j.state === "ok") toast(x.j.wait ? L.fd_wait : L.fd_rerolled, x.j.wait ? "warn" : "ok");
        else toast(reasonText(x.j || { state: "error" }), "warn");
        b.querySelector(".label").textContent = L.fd_again; b.removeAttribute("aria-busy");
        setTimeout(function () { b.disabled = false; }, 2000);
        schedule();
      });
  }

  $("again").addEventListener("click", again);
  $("refresh").addEventListener("click", refresh);
  $("manual-input").addEventListener("focus", function () { this.select(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && Date.now() - st.lastFetch > 20000) refresh(); });
  setInterval(function () { if (st.picks.length) renderList(); }, 30000);   // la durée des directs avance sans rien redemander
  message(L.loading, ""); refresh();
})();`;

/** La page du dock de sélection. `dataUrl` et `againUrl` portent la clé secrète. */
export function featuredPage(ctx, { dataUrl, againUrl }) {
  const nonce = randomBytes(16).toString("base64");
  const L = labelsOf(ctx);
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(ctx.theme?.accent ?? "")) ? ctx.theme.accent : "#9147ff";
  const config = { dataUrl, againUrl, labels: L, retryMs: 20_000, intervalMs: 45_000, fetchMs: 14_000, locale: ctx.locale || "en" };
  const script = CLIENT.replace("__SHARED__", () => shared).replace("__CONFIG__", () => JSON.stringify(config).replace(/</g, "\\u003c"));
  const html = `<!doctype html>
<html lang="${esc(ctx.locale || "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>${esc(L.fd_title)}</title><link rel="icon" href="data:,"><style nonce="${nonce}">${dock.CSS(accent)}</style></head>
<body><div class="wrap">
<header class="head"><h1><span>${esc(L.fd_title)}</span><span class="count" id="count"></span></h1>
<div class="bar"><button type="button" class="primary" id="again"><span aria-hidden="true">🎲 </span><span class="label">${esc(L.fd_again)}</span></button>
<button type="button" class="icon" id="refresh" title="${esc(L.refresh)}" aria-label="${esc(L.refresh)}"><span aria-hidden="true">↻</span></button></div></header>
<div class="banner" id="banner" role="status" hidden></div>
<main><div class="msg" id="msg" role="status"></div>
<ul class="list" id="list" aria-label="${esc(L.fd_list_label)}" hidden></ul>
<div class="manual" id="manual" hidden><label for="manual-input">${esc(L.manual_label)}</label><input id="manual-input" readonly></div></main>
<p class="foot" id="updated"></p>
</div><div class="toast" id="toast" role="status" aria-live="polite"></div>
<script nonce="${nonce}">${script}</script></body></html>`;
  return new Response(html, { headers: dock.headers(nonce) });
}

/** Ce que la page lit : la sélection, avec tout ce qu'il faut pour l'afficher (jamais d'identifiant de fiche). */
export function dataPayload(r, now = Date.now()) {
  if (r.state === "ok") return { state: "ok", picks: r.picks, count: r.count, minutes: r.minutes, endsAt: r.endsAt, pool: r.pool, asOf: r.asOf, now, ...(r.stale ? { stale: r.stale } : {}), ...(r.partial ? { partial: true } : {}), ...(r.wait ? { wait: true } : {}), ...(r.rerolled ? { rerolled: true } : {}) };
  return { ...r, now };
}
