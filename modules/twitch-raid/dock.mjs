// La page du dock : une page complète (pas un bloc du site) que l'on ajoute à OBS comme « dock de navigateur personnalisé », ou que l'on ouvre dans un onglet.
// Elle ne contient AUCUNE donnée : elle demande la liste des partenaires en direct à la route `live` du module (même adresse secrète) et se met à jour toute seule.
// Les délais du navigateur (14 s pour `live`, 18 s pour `pick`) couvrent la lecture de la liste dans Contacts (4,5 s au plus) PLUS les demandes à Twitch (9 s, 12 s).
// Tout ce qui s'affiche vient de `textContent` (jamais de HTML) ; les seules phrases du serveur sont celles de locales/.
import { randomBytes } from "node:crypto";
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const pure = await import(`./pure.mjs${v}`);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Les phrases dont la page a besoin (clés `dock_…` des locales), sans le préfixe. */
const KEYS = [
  "title", "random", "random_again", "sort", "refresh", "updated", "copied", "copy_failed", "random_toast", "none_to_pick", "empty", "empty_hint", "loading",
  "no_partners", "nr_no_channel", "nr_channel_unknown", "nr_setup", "nr_refused", "nr_outdated", "err_twitch", "err_rate", "err_site", "retry", "denied", "viewers_one", "viewers_other", "hint", "list_label",
  "sort_viewers_asc", "sort_viewers_desc", "sort_newest", "sort_oldest", "sort_mine", "manual_label", "rm_button", "rm_intro", "rm_searching", "rm_none", "limited", "partial",
  // 2.0 : la liste vient de Contacts (voir source.mjs) ; ce qui peut manquer de ce côté
  "nr_contacts_missing", "nr_contacts_old", "nr_contacts_down", "nr_category_gone", "nr_no_category", "nr_choose",
  // 2.3 : the look of the administration, the offline line, the Confirm / Undo pattern
  "offline", "confirm", "undo",
];
/** `{label}` : le nom de la catégorie par défaut (« Cible de raid »), dans la langue de la page. */
export const labelsOf = (ctx) => { const label = ctx.t("default_category"); return Object.fromEntries(KEYS.map((k) => [k, ctx.t(`dock_${k}`, { label })])); };

/** Les mêmes fonctions que celles testées, recopiées dans la page. */
const shared = [pure.raidCommand, pure.sortPartners, pure.pickRandom, pure.durationText, pure.canSearch].map((f) => f.toString()).join("\n");

const CLIENT = `
(function () {
  "use strict";
  var C = __CONFIG__, L = C.labels;
  __SHARED__
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (s, vars) { return String(s).replace(/\\{(\\w+)\\}/g, function (m, k) { return vars && vars[k] !== undefined ? vars[k] : m; }); };
  var st = { mode: "full", searching: false, lastPick: 0, live: [], listed: 0, offset: 0, sort: C.sorts[0], picked: null, rows: {}, busy: false, timer: null, toastTimer: null, lastFetch: 0, failed: false, denied: false, ready: false, first: true };
  try { var saved = localStorage.getItem("raid-dock-sort"); if (saved && C.sorts.indexOf(saved) >= 0) st.sort = saved; } catch (e) { /* mémoire du navigateur indisponible : sans importance */ }

  function toast(text, kind) {
    var t = $("toast"); t.textContent = text; t.className = "toast show " + (kind || "");
    clearTimeout(st.toastTimer); st.toastTimer = setTimeout(function () { t.className = "toast"; }, 7000);
  }
  function banner(text) { var b = $("banner"); b.textContent = text || ""; b.hidden = !text; }
  /* The status strip (last update, or "Offline"): a dot AND words, never colour alone. */
  function setStrip(text, off) { var s = $("strip"); s.hidden = !text; s.className = off ? "strip off" : "strip"; $("updated").textContent = text || ""; }
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
    $("count").textContent = st.ready && st.mode === "full" ? String(sorted.length) : "";
    if (!st.searching) $("rand").querySelector(".label").textContent = st.mode === "random" ? (st.picked ? L.random_again : L.rm_button) : (st.picked ? L.random_again : L.random);
  }
  /* Le mode « au hasard » (plus de 500 chaînes) : pas de liste ni de tri ni d'actualisation, un grand bouton. */
  function setMode(mode) {
    st.mode = mode;
    var big = mode === "random";
    $("sortbox").hidden = big; $("refresh").hidden = big; $("rand").classList.toggle("big", big);
    document.body.classList.toggle("rmode", big);
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
    if (d.state === "ok" && d.mode === "random") {
      setMode("random"); st.listed = d.listed; st.ready = true; st.lastFetch = Date.now(); st.failed = false;
      banner(""); if (!st.live.length && !st.noneShown) message(L.rm_intro, "");
      setStrip("", false);
    } else if (d.state === "ok") {
      setMode("full");
      st.live = d.live; st.listed = d.listed; st.ready = true; st.lastFetch = Date.now();
      banner(d.partial ? L.partial : ""); message(d.live.length ? "" : L.empty, d.live.length ? "" : fmt(L.empty_hint, { n: d.listed }));
      st.updatedText = fmt(L.updated, { time: new Date(Date.now()).toLocaleTimeString(C.locale, { hour: "2-digit", minute: "2-digit" }) });
      setStrip(st.updatedText, false);
    } else if (d.state === "error") {
      st.failed = true; st.lastFetch = Date.now();
      setStrip(d.reason === "site" ? L.offline : (st.updatedText || ""), true);   // clear offline state: the site itself cannot be reached
      if (d.stale) { st.live = d.stale.live; st.listed = d.stale.listed; st.ready = true; }
      if (st.ready && st.mode === "random") { banner(reasonText(d)); }
      else if (st.ready) { banner(reasonText(d) + " " + L.retry); message(st.live.length ? "" : L.empty, st.live.length ? "" : fmt(L.empty_hint, { n: st.listed })); }
      else { banner(""); message(reasonText(d), L.retry); }
    } else {
      st.live = []; st.ready = false; st.failed = d.state === "not_ready"; banner(""); message(reasonText(d), d.state === "not_ready" ? L.retry : ""); setStrip("", false);
    }
    if (st.mode === "full" && st.picked && !st.live.some(function (x) { return x.login === st.picked; })) st.picked = null;
    renderList();
  }

  function schedule() {
    clearTimeout(st.timer);
    if (st.mode === "random") return;   // « au hasard » : Twitch n'est interrogé que sur un clic
    if (document.hidden) return;   // hidden (another OBS dock tab, a locked phone): no news asked; the page asks again when it is shown
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

  /* « Au hasard » (plus de 500 chaînes) : le serveur cherche, un clic = une recherche. Une seule à la fois, et jamais deux à moins de 2 secondes d'écart. */
  function setBusy(on) {
    var b = $("rand"); b.disabled = on; b.setAttribute("aria-busy", on ? "true" : "false");
    if (on) b.querySelector(".label").textContent = L.rm_searching;
  }
  function handlePick(d, status) {
    if (status === 403 || (d && d.state === "denied")) { st.live = []; st.picked = null; renderList(); message(L.denied, ""); return; }
    if (d && typeof d.now === "number") st.offset = d.now - Date.now();
    if (d.state === "found" && d.pick) {
      st.noneShown = false; st.live = [{ login: d.pick.login, name: d.pick.name, game: d.pick.game, title: d.pick.title, viewers: d.pick.viewers, startedAt: d.pick.startedAt, pos: 0 }];
      st.picked = d.pick.login; banner(""); message("", ""); renderList();
      var li = st.rows[d.pick.login]; if (li) li.scrollIntoView({ block: "nearest" });
      copyCommand(st.live[0], true);
    } else if (d.state === "none") {
      st.noneShown = true; st.live = []; st.picked = null; banner(""); renderList(); message(L.rm_none, "");
    } else if (d.state === "limited") {
      banner(L.limited); toast(L.limited, "warn");
    } else if (d.state === "not_ready" || d.state === "no_partners") {
      st.live = []; st.picked = null; renderList(); message(reasonText(d), "");
    } else banner(reasonText(d));
  }
  function search() {
    if (!canSearch(Date.now(), st.lastPick, st.searching, C.searchMinMs)) return;
    st.searching = true; st.lastPick = Date.now(); setBusy(true);
    var ctl = new AbortController(), cut = setTimeout(function () { ctl.abort(); }, C.pickMs);
    fetch(C.pickUrl, { method: "POST", cache: "no-store", signal: ctl.signal, credentials: "omit", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ avoid: st.picked || "" }) })
      .then(function (r) { return r.json().then(function (j) { handlePick(j, r.status); }, function () { handlePick({ state: "error", reason: "site" }, r.status); }); })
      .catch(function () { handlePick({ state: "error", reason: "site" }, 0); })
      .then(function () {
        clearTimeout(cut); st.searching = false; st.lastPick = Date.now(); renderList();
        var b = $("rand"); b.disabled = true; setTimeout(function () { b.disabled = false; b.removeAttribute("aria-busy"); }, C.searchMinMs);   // 2 s avant la recherche suivante
      });
  }

  function random() {
    if (st.mode === "random") { search(); return; }
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
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { clearTimeout(st.timer); return; }
    if (Date.now() - st.lastFetch > 20000) refresh(); else if (!st.denied) schedule();
    renderList();
  });
  setInterval(function () { if (!document.hidden && st.live.length) renderList(); }, 30000);   // la durée des directs avance sans rien redemander
  message(L.loading, ""); refresh();
})();`;

// ───────────── The look: the administration's (the same variables --cur-*, given by `ctx.api.adminTheme()`) ─────────────
// The stylesheet below writes NO colour and NO font: only the tokens (tests/twitch-raid-dock-look.test.mjs enforces it). A core without `adminTheme` (before 0.6.6) gets the fallback
// declared first, with the same names and the administration's dark palette; the theme CSS, when there is one, comes after and wins.
export const FALLBACK_TOKENS = ":root{--cur-bg:#15141a;--cur-fg:#ecebf2;--cur-muted:#9d9bad;--cur-surface:#1e1d26;--cur-line:#2d2b38;--cur-accent:#9b8cff;--cur-accent-fg:#15141a;--cur-ok:#6ee7b7;--cur-ok-fg:#052e1c;--cur-warn:#fcd34d;--cur-warn-fg:#2a2000;--cur-danger:#fca5a5;--cur-danger-fg:#3a0a0a;--cur-focus:#9b8cff;--cur-radius:.5rem;--cur-radius-lg:1rem;--cur-shadow:0 1px 2px #0000000d;--cur-space:.25rem;--cur-font:ui-sans-serif,system-ui,sans-serif;color-scheme:dark}";

/** `?scheme=light` or `?scheme=dark` forces the look; anything else: null (the dock is dark, as OBS expects). */
export const wantsScheme = (url) => { try { const s = new URL(url).searchParams.get("scheme"); return s === "light" || s === "dark" ? s : null; } catch { return null; } };

/** The tokens of the page (fallback first, then the core's theme). A failing or missing theme never blocks the dock. */
export function themeCss(ctx, scheme) {
  let theme = null;
  try { theme = typeof ctx.api?.adminTheme === "function" ? ctx.api.adminTheme({ scheme: scheme ?? "dark" }) : null; } catch { theme = null; }
  const tokens = typeof theme?.css === "string" ? theme.css.replace(/[<>]/g, "") : "";   // the theme text can never close the <style>
  return FALLBACK_TOKENS + tokens;
}

// The page is ONE full-height grid that never scrolls: head (title, the main action, sort, refresh), an optional banner, the stage (the list: it only scrolls inside itself
// when there are more channels than the height allows), and a one-line status strip. Rows are 46 px high, in columns when the dock is wide; targets are at least 44 px.
export const CSS = `
*{box-sizing:border-box}
html,body{height:100%;margin:0;overflow:hidden;overscroll-behavior:none}
html{-webkit-text-size-adjust:100%}
body{background:var(--cur-bg);color:var(--cur-fg);font:14px/1.3 var(--cur-font);padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
button,select,input{font:inherit;color:inherit}
[hidden]{display:none!important}
.sr{position:absolute!important;top:0;left:0;margin:0;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:focus-visible{outline:3px solid var(--cur-focus);outline-offset:2px}
.app{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto minmax(0,1fr) auto;height:100dvh;max-height:100dvh;overflow:hidden}
.head{grid-row:1;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"t t" "p r" "s s";gap:4px 6px;padding:6px 10px;background:var(--cur-surface);border-bottom:1px solid var(--cur-line)}
h1{grid-area:t;margin:0;font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px;min-width:0;line-height:1.3}
h1 span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
h1 .count{flex:none;min-width:1.6em;padding:0 .45em;border-radius:99px;background:var(--cur-accent);color:var(--cur-accent-fg);font-size:12px;text-align:center;line-height:1.6}
h1 .count:empty{display:none}
.primary{grid-area:p;position:relative;overflow:hidden;min-height:48px;min-width:0;padding:4px 12px;border:0;border-radius:var(--cur-radius);background:var(--cur-accent);color:var(--cur-accent-fg);font-weight:700;font-size:15px;line-height:1.2;cursor:pointer;touch-action:manipulation}
.primary:hover{background:color-mix(in srgb,var(--cur-accent) 88%,var(--cur-fg))}
.primary:disabled{opacity:.6;cursor:default}
.primary.big{min-height:72px;font-size:17px}
.primary.arm{background:var(--cur-warn);color:var(--cur-warn-fg);display:grid;gap:1px;align-content:center;justify-items:center}
.primary.arm .loss{font-size:11px;font-weight:400;white-space:normal}
.primary.arm::after{content:"";position:absolute;left:0;bottom:0;height:4px;width:100%;background:currentColor;opacity:.55;transform-origin:left;animation:arm 3s linear forwards}
@keyframes arm{from{transform:scaleX(1)}to{transform:scaleX(0)}}
.undo{grid-area:r;min-height:48px;min-width:64px;padding:0 14px;border:2px solid var(--cur-fg);border-radius:var(--cur-radius);background:transparent;font-weight:700;cursor:pointer;touch-action:manipulation}
.sortbox{grid-area:s;display:flex;min-width:0}
select{width:100%;min-height:44px;border:1px solid var(--cur-line);border-radius:var(--cur-radius);background:var(--cur-bg);padding:0 8px}
.icon{grid-area:r;min-width:44px;min-height:48px;border:1px solid var(--cur-line);border-radius:var(--cur-radius);background:var(--cur-bg);cursor:pointer;font-size:18px;line-height:1;touch-action:manipulation}
.icon.spin{opacity:.55}
.banner{grid-row:2;margin:6px 10px 0;padding:6px 10px;border-radius:var(--cur-radius);background:color-mix(in srgb,var(--cur-warn) 14%,var(--cur-surface));border:1px solid var(--cur-warn);color:var(--cur-fg);font-size:13px;overflow-wrap:anywhere}
.stage{grid-row:3;min-height:0;overflow:auto;padding:6px 10px;overscroll-behavior:contain}
.msg{margin:16px 4px;text-align:center}
.rmode .msg{margin-top:22px}
.msg-main{margin:0 0 6px;font-size:15px;overflow-wrap:anywhere}
.msg-hint{margin:0;color:var(--cur-muted);font-size:13px;overflow-wrap:anywhere}
.list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr));gap:4px}
.row{width:100%;height:100%;min-height:44px;display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:8px;row-gap:0;align-content:center;text-align:left;padding:4px 10px;border:1px solid var(--cur-line);border-left:4px solid var(--cur-line);border-radius:var(--cur-radius);background:var(--cur-surface);cursor:pointer;touch-action:manipulation}
.row:hover{background:color-mix(in srgb,var(--cur-fg) 6%,var(--cur-surface));border-left-color:var(--cur-accent)}
.n{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.v{color:var(--cur-ok);font-weight:600;white-space:nowrap;font-size:13px}
.m,.c{grid-row:2;grid-column:1/-1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.m{color:var(--cur-muted)}
.c{visibility:hidden;color:var(--cur-ok);font-weight:600}
.copied .c{visibility:visible}
.copied .m{visibility:hidden}
.t{display:none;grid-column:1/-1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (min-height:640px){.t{display:block}.t:empty{display:none}}
.picked .row{border-color:var(--cur-accent);border-left-color:var(--cur-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--cur-accent) 45%,transparent)}
.picked .n::before{content:"★ ";color:var(--cur-accent)}
.manual{margin:8px 0 0;padding:10px;border:1px solid var(--cur-warn);border-radius:var(--cur-radius);background:var(--cur-surface)}
.manual label{display:block;margin-bottom:6px}
.manual input{width:100%;min-height:44px;padding:0 10px;border:1px solid var(--cur-line);border-radius:var(--cur-radius);background:var(--cur-bg)}
.strip{grid-row:4;display:flex;align-items:center;gap:8px;min-height:28px;padding:3px 10px;border-top:1px solid var(--cur-line);background:var(--cur-surface);color:var(--cur-muted);font-size:12px;line-height:1.25}
.strip .dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--cur-ok)}
.strip.off{color:var(--cur-fg)}
.strip.off .dot{background:var(--cur-warn)}
.toast{position:fixed;left:8px;right:8px;bottom:6px;max-width:560px;margin:0 auto;padding:8px 12px;border-radius:var(--cur-radius);background:var(--cur-surface);color:var(--cur-fg);border:2px solid var(--cur-line);box-shadow:var(--cur-shadow);opacity:0;pointer-events:none;transform:translateY(8px);transition:opacity .2s,transform .2s;overflow-wrap:anywhere}
.toast.show{opacity:1;transform:none}
.toast.ok{border-color:var(--cur-ok)}.toast.warn{border-color:var(--cur-warn)}
@media (min-width:640px){
  .head{grid-template-columns:auto minmax(200px,340px) 1fr auto auto;grid-template-areas:"t p . s r";align-items:center;column-gap:12px}
  .sortbox{min-width:170px}
  .undo{grid-area:s}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}.primary.arm::after{animation:none;transform:none;opacity:.35}}`;

/** The strip and the toast, shared by both pages. */
const STRIP = `<footer class="strip" id="strip" hidden><span class="dot" aria-hidden="true"></span><span id="updated"></span></footer>`;

/** The complete answer: the page, with a security policy that only allows its own script and style and only contacts the site itself. */
export function dockPage(ctx, { sorts = pure.SORTS, liveUrl, pickUrl, scheme = null }) {
  const nonce = randomBytes(16).toString("base64");
  const L = labelsOf(ctx);
  const config = { liveUrl, labels: L, sorts: [...sorts], pickUrl, searchMinMs: 2000, pickMs: 18_000, intervalMs: 45_000, retryMs: 20_000, fetchMs: 14_000, locale: ctx.locale || "en" };
  const script = CLIENT.replace("__SHARED__", () => shared).replace("__CONFIG__", () => JSON.stringify(config).replace(/</g, "\\u003c"));
  const options = sorts.map((s) => `<option value="${esc(s)}">${esc(L[`sort_${s}`])}</option>`).join("");
  const html = `<!doctype html>
<html lang="${esc(ctx.locale || "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light dark">
<title>${esc(L.title)}</title><link rel="icon" href="data:,"><style nonce="${nonce}">${themeCss(ctx, scheme)}\n${CSS}</style></head>
<body><div class="app" id="app">
<header class="head"><h1><span>${esc(L.title)}</span><span class="count" id="count"></span></h1>
<button type="button" class="primary" id="rand"><span aria-hidden="true">🎲 </span><span class="label">${esc(L.random)}</span></button>
<label class="sortbox" id="sortbox"><span class="sr">${esc(L.sort)}</span><select id="sort">${options}</select></label>
<button type="button" class="icon" id="refresh" title="${esc(L.refresh)}" aria-label="${esc(L.refresh)}"><span aria-hidden="true">↻</span></button></header>
<div class="banner" id="banner" role="status" hidden></div>
<main class="stage" id="stage"><div class="msg" id="msg" role="status"></div>
<ul class="list" id="list" aria-label="${esc(L.list_label)}" hidden></ul>
<div class="manual" id="manual" hidden><label for="manual-input">${esc(L.manual_label)}</label><input id="manual-input" readonly></div></main>
${STRIP}
</div><div class="toast" id="toast" role="status" aria-live="polite"></div>
<script nonce="${nonce}">${script}</script></body></html>`;
  return new Response(html, { headers: headers(nonce) });
}

const baseHeaders = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export const headers = (nonce) => ({
  ...baseHeaders, "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
});
export const jsonHeaders = { ...baseHeaders, "Content-Type": "application/json; charset=utf-8" };
export { STRIP };

/** The page shown when the address is incomplete or no longer the right one: one plain sentence, in the same look, nothing else. */
export function deniedPage(ctx, scheme = null) {
  const nonce = randomBytes(16).toString("base64");
  const L = labelsOf(ctx);
  const html = `<!doctype html><html lang="${esc(ctx.locale || "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>${esc(L.title)}</title>
<style nonce="${nonce}">${themeCss(ctx, scheme)}\nbody{margin:0;padding:24px 16px;background:var(--cur-bg);color:var(--cur-fg);font:15px/1.4 var(--cur-font)}p{max-width:34em;margin:0 auto}</style></head><body><p>${esc(L.denied)}</p></body></html>`;
  return new Response(html, { status: 403, headers: { ...baseHeaders, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'` } });
}
