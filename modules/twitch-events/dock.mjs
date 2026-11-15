// The OBS dock: a full page (not a block of the site) added to OBS as a "custom browser dock", or opened in a tab. It holds NO data: it asks `dock-data` (same secret address) every few
// seconds, backs off when the site does not answer, and says so (a dot AND words). Everything shown comes from `textContent`; the only sentences of the server are those of the locales.
// Look: only the tokens of the administration (--cur-*), no colour and no font written here; dark by default (OBS), `?scheme=light` forces light.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const pure = await import(`./dockpure.mjs${v}`);
const kit = await import(`./dockkit.mjs${v}`);
const { randomBytes } = await import("node:crypto");

/** The sentences the page needs (keys `dock_…` of the locales, without the prefix). */
export const KEYS = [
  "title", "scope_stream", "scope_day", "scope_all", "scope_label", "all_types", "search", "search_none", "empty", "empty_hint", "loading", "pause", "resume", "clear", "test", "test_label", "test_none",
  "replay", "replayed", "replay_label", "waiting", "state_live", "state_retry", "state_off", "no_alerts", "paused_note", "held", "cleared", "paused_ok", "resumed_ok", "tested", "err_rate", "err_unknown",
  "err_site", "denied", "clear_confirm", "listening_off", "types_label", "updated",
  "controls", "sw_alerts", "sw_voice", "sw_mute", "sw_on", "sw_off", "sw_paused", "stop_speech", "skip", "no_voice", "voice_on_ok", "voice_off_ok", "muted_ok", "unmuted_ok", "stopped", "skipped",
  "texts_title", "text_held", "text_hidden", "accept", "dismiss", "accept_label", "dismiss_label", "accepted", "dismissed",
];
export const labelsOf = (ctx) => Object.fromEntries(KEYS.map((k) => [k, ctx.t(`dock_${k}`)]));

const shared = [pure.relTime, pure.nextDelay, pure.visible].map((f) => f.toString()).join("\n");

const CLIENT = `
(function () {
  "use strict";
  var C = __CONFIG__, L = C.labels;
  __SHARED__
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (s, vars) { return String(s).replace(/\\{(\\w+)\\}/g, function (m, k) { return vars && vars[k] !== undefined ? vars[k] : m; }); };
  var st = { events: [], scope: C.scope, type: "", q: "", fails: 0, ok: false, ready: false, linked: false, paused: false, held: 0, live: false, types: [], busy: {}, timer: null, last: 0, toastTimer: null, listening: true, ctl: false, voice: { available: false, on: false, muted: false }, texts: [] };
  try { st.ctl = localStorage.getItem("events-dock-controls") === "1"; } catch (e) { /* no matter */ }
  try { var saved = localStorage.getItem("events-dock-scope"); if (saved && C.scopes.indexOf(saved) >= 0) st.scope = saved; var savedT = localStorage.getItem("events-dock-type"); if (savedT !== null) st.type = savedT; } catch (e) { /* the memory of the browser may be unavailable: no matter */ }

  function toast(text, kind) {
    var t = $("toast"); t.textContent = text; t.className = "toast show " + (kind || "");
    clearTimeout(st.toastTimer); st.toastTimer = setTimeout(function () { t.className = "toast"; }, 4500);
  }
  function strip() {
    var s = $("strip"), up = $("updated");
    var text = st.ok ? (st.live ? L.state_live : L.updated) : (st.ready ? fmt(L.state_retry, { n: Math.round(pure_next() / 1000) }) : L.loading);
    s.className = "strip" + (st.ok ? "" : " off"); up.textContent = text;
  }
  function pure_next() { return nextDelay(st.fails); }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  /** Small line icons (inline SVG, drawn with the text colour): every button that uses one also has a text name and a tooltip. */
  var VOL = "M11 5 6 9H2v6h4l5 4V5z", BELL = "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", MIC = ["M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 19v3"];
  var ICONS = {
    replay: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5"], check: ["M20 6 9 17l-5-5"], bell: [BELL, "M10.3 21a1.94 1.94 0 0 0 3.4 0"], bellOff: [BELL, "M10.3 21a1.94 1.94 0 0 0 3.4 0", "M3 3l18 18"],
    mic: MIC, micOff: MIC.concat(["M3 3l18 18"]), volume: [VOL, "M15.5 8.5a5 5 0 0 1 0 7", "M19 5a9 9 0 0 1 0 14"], volumeX: [VOL, "M22 9l-6 6", "M16 9l6 6"],
    stop: ["M6 6h12v12H6z"], skip: ["M5 4l10 8-10 8V4z", "M19 5v14"], trash: ["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6", "M10 11v6", "M14 11v6"],
    send: ["M22 2 11 13", "M22 2l-7 20-4-9-9-4 20-7z"], sliders: ["M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M1 14h6", "M9 8h6", "M17 16h6"]
  };
  function icon(name) {
    var ns = "http://www.w3.org/2000/svg", s = document.createElementNS(ns, "svg"), d = ICONS[name] || [];
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", "20"); s.setAttribute("height", "20"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false"); s.setAttribute("class", "ic");
    for (var i = 0; i < d.length; i++) { var p = document.createElementNS(ns, "path"); p.setAttribute("d", d[i]); s.appendChild(p); }
    return s;
  }
  /** An icon button: the icon alone on a narrow dock, icon + words from 520 px; the name is always there (aria-label) and in the tooltip. */
  function ib(id, ic, label) { var b = $(id); b.setAttribute("aria-label", label); b.title = label; b.replaceChildren(icon(ic), el("span", "t", label)); }
  function when(at) { try { return new Date(at).toLocaleString(C.locale); } catch (e) { return ""; } }

  function row(e) {
    var li = el("li", "row tone-" + e.tone);
    var badge = el("span", "badge", e.label); badge.setAttribute("data-tone", e.tone); badge.title = e.label;
    var name = e.name || e.detail || "", more = e.name ? (e.detail || "") : "";
    var who = el("span", "who", name); who.title = name;
    var det = el("span", "det", more); det.title = more;
    var time = el("span", "time"); time.setAttribute("data-at", String(e.at)); time.title = when(e.at); time.append(el("span", "tf", relTime(e.at, Date.now(), C.locale)), el("span", "ts", relTime(e.at, Date.now(), C.locale, true)));
    var done = !!st.busy[e.id];
    var btn = el("button", "replay"); btn.type = "button"; btn.replaceChildren(icon(done ? "check" : "replay"));
    btn.setAttribute("aria-label", fmt(L.replay_label, { type: e.label, name: e.name || "" }));
    btn.title = !st.linked ? L.no_alerts : done ? L.replayed : L.replay;
    btn.disabled = !st.linked || done;
    btn.addEventListener("click", function () { replay(e, btn); });
    var l1 = el("span", "l1"); l1.append(who, time);
    var l2 = el("span", "l2"); l2.append(badge, det);
    var main = el("span", "main"); main.append(l1, l2);
    li.append(main, btn);
    return li;
  }

  function render() {
    var list = $("list"), shown = visible(st.events, { type: st.type, q: st.q });
    list.replaceChildren();
    for (var i = 0; i < shown.length; i++) list.appendChild(row(shown[i]));
    var msg = $("msg");
    if (!shown.length) {
      msg.hidden = false; msg.replaceChildren();
      var main = el("p", "msg-main", !st.ready ? L.loading : st.events.length ? L.search_none : L.empty); msg.appendChild(main);
      if (st.ready && !st.events.length) msg.appendChild(el("p", "msg-hint", L.empty_hint));
    } else msg.hidden = true;
    sw("pause", L.sw_alerts, !st.paused, st.paused ? L.sw_paused : L.sw_on, !st.linked, st.linked ? "" : L.no_alerts, st.paused ? "bellOff" : "bell");
    var vo = st.voice, vOk = st.linked && vo.available;
    sw("voice", L.sw_voice, vo.on, vo.on ? L.sw_on : L.sw_off, !vOk, vOk ? "" : (st.linked ? L.no_voice : L.no_alerts), vo.on ? "mic" : "micOff");
    sw("mute", L.sw_mute, vo.muted, vo.muted ? L.sw_on : L.sw_off, !vOk, vOk ? "" : (st.linked ? L.no_voice : L.no_alerts), vo.muted ? "volumeX" : "volume");
    $("pausedpill").hidden = !(st.linked && st.paused); $("pausedpill").textContent = L.sw_paused;
    $("stopspeech").disabled = !vOk; $("skip").disabled = !st.linked;
    held();
    $("clear").disabled = !st.linked; $("test").disabled = !st.linked || !$("testtype").value; $("testtype").disabled = !st.linked;
    // One short notice at most, the most important first; the one about the listening is a link to the page of the module.
    var b = $("banner"), note = function (t) { b.hidden = false; b.className = "banner"; b.textContent = t; b.title = t; };
    if (!st.linked) note(L.no_alerts);
    else if (st.paused) note(fmt(L.paused_note, { n: st.held }));
    else if (!st.listening && C.adminHref) { var a = el("a", "banner-link", L.listening_off); a.href = C.adminHref; a.target = "_blank"; a.rel = "noopener"; b.hidden = false; b.className = "banner link"; b.textContent = ""; b.title = ""; b.replaceChildren(a); }
    else if (!st.listening) note(L.listening_off);
    else b.hidden = true;
    $("scope").value = st.scope; $("typesel").value = st.type;
    ctlOpen(st.ctl, true);
    strip();
  }

  /** A switch shows the state it is in (the words, not only the position): label, then "On" / "Off" / "Paused". */
  function sw(id, label, on, stateText, off, why, ic) {
    var b = $(id); b.className = "sw" + (id === "pause" && !on ? " warn" : ""); b.disabled = !!off; b.title = why || (label + " · " + stateText); b.setAttribute("aria-checked", on ? "true" : "false"); b.setAttribute("aria-label", label);
    b.replaceChildren(icon(ic), el("span", "t", label), el("span", "sws", stateText));
  }
  /** The controls are folded by default (the list is the page); the choice is remembered in this dock. */
  function ctlOpen(open, quiet) {
    st.ctl = !!open; $("controls").hidden = !st.ctl; $("ctltoggle").setAttribute("aria-expanded", st.ctl ? "true" : "false");
    if (!quiet && st.ctl && $("controls").scrollIntoView) $("controls").scrollIntoView({ block: "nearest" });   // a short dock: the controls come into view
    if (!quiet) { try { localStorage.setItem("events-dock-controls", st.ctl ? "1" : "0"); } catch (e) { /* no matter */ } }
  }
  function held() {
    var box = $("held"), list = $("heldlist"); list.replaceChildren();
    box.hidden = !st.texts.length;
    $("heldtitle").textContent = fmt(L.texts_title, { n: st.texts.length });
    for (var i = 0; i < st.texts.length; i++) list.appendChild(heldRow(st.texts[i]));
  }
  function heldRow(x) {
    var li = el("li", "held-row");
    var top = el("span", "held-top"); top.append(el("span", "badge", x.label), el("span", "who", x.name), el("span", "why", x.why + " · " + (x.held ? L.text_held : L.text_hidden)));
    var txt = el("span", "held-text", x.text); txt.title = x.text;
    var main = el("span", "main"); main.append(top, txt);
    var a = el("button", "decide", L.accept); a.type = "button"; a.setAttribute("aria-label", fmt(L.accept_label, { name: x.name }));
    var d = el("button", "decide", L.dismiss); d.type = "button"; d.setAttribute("aria-label", fmt(L.dismiss_label, { name: x.name }));
    var go = function (action) { if (st.busy["t" + x.id]) return; st.busy["t" + x.id] = true; a.disabled = true; d.disabled = true;
      post("decide", { id: x.id, choice: action }).then(function (r) { delete st.busy["t" + x.id]; if (r.ok) toast(action === "accept" ? L.accepted : L.dismissed, "ok"); else toast(why(r.code), "warn"); refresh(); }); };
    a.addEventListener("click", function () { go("accept"); }); d.addEventListener("click", function () { go("dismiss"); });
    li.append(main, a, d);
    return li;
  }

  function types() {
    var f = $("typesel"); f.replaceChildren();
    var all = el("option", "", L.all_types); all.value = ""; f.appendChild(all);
    for (var i = 0; i < st.types.length; i++) { var o = el("option", "", st.types[i].name); o.value = st.types[i].id; f.appendChild(o); }
    f.value = st.type;
    var sel = $("testtype"); var cur = sel.value; sel.replaceChildren();
    for (var j = 0; j < st.types.length; j++) { var t = el("option", "", st.types[j].name); t.value = st.types[j].id; sel.appendChild(t); }
    if (cur) sel.value = cur;
  }

  function post(action, extra) {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, C.fetchMs);
    return fetch(C.actUrl, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ action: action }, extra || {})), signal: ctl.signal })
      .then(function (r) { return r.json().catch(function () { return { ok: false, code: "err_site" }; }); }).catch(function () { return { ok: false, code: "err_site" }; }).then(function (x) { clearTimeout(t); return x; });
  }
  function why(code) { return code === "rate" ? L.err_rate : code === "no_alerts" ? L.no_alerts : code === "no_voice" ? L.no_voice : code === "unknown" ? L.err_unknown : L.err_site; }

  function replay(e, btn) {
    if (st.busy[e.id]) return;                                  // a double click never sends twice
    st.busy[e.id] = true; btn.disabled = true; btn.replaceChildren(icon("check")); btn.title = L.replayed; toast(L.replayed, "ok");
    post("replay", { id: e.id }).then(function (r) {
      if (!r.ok) { toast(why(r.code), "warn"); delete st.busy[e.id]; render(); return; }
      setTimeout(function () { delete st.busy[e.id]; render(); }, 1800);
      refresh();
    });
  }

  /** A short dock (under 420 px high) scrolls the title and the filters away with the list: the first time, start where the list (or the notice or the open controls above it) begins. */
  function place() {
    var h = typeof innerHeight === "number" ? innerHeight : 1e9, app = $("app");
    if (h > 420 || !app.getBoundingClientRect) return;
    var t = st.ctl ? $("controls") : !$("banner").hidden ? $("banner") : $("stage");
    app.scrollTop += t.getBoundingClientRect().top - app.getBoundingClientRect().top;
  }
  function url() { return C.dataUrl + "&scope=" + encodeURIComponent(st.scope); }
  function refresh() {
    clearTimeout(st.timer);
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, C.fetchMs);
    fetch(url(), { cache: "no-store", signal: ctl.signal }).then(function (r) { if (r.status === 403) { st.denied = true; throw new Error("denied"); } if (!r.ok) throw new Error("http"); return r.json(); }).then(function (d) {
      clearTimeout(t); st.fails = 0; st.ok = true; st.ready = true; st.events = d.events || []; st.linked = !!(d.alerts && d.alerts.linked); st.paused = !!(d.alerts && d.alerts.paused); st.held = (d.alerts && d.alerts.held) || 0; st.live = !!d.live; st.listening = d.listening !== false; st.voice = (d.alerts && d.alerts.voice) || st.voice; st.texts = (d.alerts && d.alerts.texts) || [];
      if (!st.types.length && d.types) { st.types = d.types; types(); }
      if (d.scope && d.scope !== st.scope) st.scope = d.scope;
      render();
      if (!st.placed) { st.placed = true; place(); }
    }).catch(function () { clearTimeout(t); st.fails++; st.ok = false; st.ready = true; render(); }).then(function () {
      if (st.denied) { document.body.textContent = L.denied; return; }
      st.timer = setTimeout(refresh, nextDelay(st.fails));
    });
  }

  $("scope").addEventListener("change", function () { st.scope = $("scope").value; try { localStorage.setItem("events-dock-scope", st.scope); } catch (e) { /* no matter */ } refresh(); });
  $("typesel").addEventListener("change", function () { st.type = $("typesel").value; try { localStorage.setItem("events-dock-type", st.type); } catch (e) { /* no matter */ } render(); });
  $("ctltoggle").addEventListener("click", function () { ctlOpen(!st.ctl); });
  $("q").addEventListener("input", function () { st.q = $("q").value; render(); });
  $("pause").addEventListener("click", function () {
    var b = $("pause"); if (b.disabled) return; b.disabled = true; var action = st.paused ? "resume" : "pause";
    post(action).then(function (r) { if (r.ok) { toast(action === "pause" ? L.paused_ok : fmt(L.resumed_ok, { n: r.released || 0 }), "ok"); } else toast(why(r.code), "warn"); refresh(); });
  });
  $("voice").addEventListener("click", function () {
    var b = $("voice"); if (b.disabled) return; b.disabled = true; var on = !st.voice.on;
    post("voiceOn", { on: on }).then(function (r) { if (r.ok) toast(on ? L.voice_on_ok : L.voice_off_ok, "ok"); else toast(why(r.code), "warn"); refresh(); });
  });
  $("mute").addEventListener("click", function () {
    var b = $("mute"); if (b.disabled) return; b.disabled = true; var muted = !st.voice.muted;
    post("mute", { muted: muted }).then(function (r) { if (r.ok) toast(muted ? L.muted_ok : L.unmuted_ok, "ok"); else toast(why(r.code), "warn"); refresh(); });
  });
  $("stopspeech").addEventListener("click", function () {
    var b = $("stopspeech"); if (b.disabled) return; b.disabled = true; setTimeout(function () { render(); }, 1200);
    post("stopSpeech").then(function (r) { toast(r.ok ? L.stopped : why(r.code), r.ok ? "ok" : "warn"); });
  });
  $("skip").addEventListener("click", function () {
    var b = $("skip"); if (b.disabled) return; b.disabled = true; setTimeout(function () { render(); }, 1200);
    post("skip").then(function (r) { toast(r.ok ? L.skipped : why(r.code), r.ok ? "ok" : "warn"); });
  });
  $("clear").addEventListener("click", function () {
    var b = $("clear"); if (b.disabled) return;
    if (typeof confirm === "function" && !confirm(L.clear_confirm)) return;
    b.disabled = true;
    post("clear").then(function (r) { if (r.ok) toast(fmt(L.cleared, { n: r.dropped || 0 }), "ok"); else toast(why(r.code), "warn"); refresh(); });
  });
  $("test").addEventListener("click", function () {
    var b = $("test"); if (b.disabled) return; b.disabled = true; setTimeout(function () { b.disabled = false; }, 1500);
    post("test", { type: $("testtype").value }).then(function (r) { if (r.ok) { toast(L.tested, "ok"); refresh(); } else toast(why(r.code), "warn"); });
  });
  $("testtype").addEventListener("change", render);
  setInterval(function () { var ts = document.querySelectorAll ? document.querySelectorAll(".time") : []; for (var i = 0; i < ts.length; i++) { var at = Number(ts[i].getAttribute("data-at")); if (ts[i].children && ts[i].children.length > 1) { ts[i].children[0].textContent = relTime(at, Date.now(), C.locale); ts[i].children[1].textContent = relTime(at, Date.now(), C.locale, true); } } }, 20000);
  ib("ctltoggle", "sliders", L.controls); ib("stopspeech", "stop", L.stop_speech); ib("skip", "skip", L.skip); ib("clear", "trash", L.clear); ib("test", "send", L.test);
  render(); refresh();
})();`;

// The page is ONE full-height grid that never scrolls (only the list does): the top (title, filters, folded controls, one notice), the list, a one-line status strip.
// Built for a NARROW OBS dock (220 to 360 px) and fine from there up to a wide screen: two-line rows (name + detail, then type + time) with one 44 px icon button, icon buttons for the controls
// (words appear from 520 px), selects instead of rows of tabs and chips, nothing scrolls sideways. In a short dock (under 420 px high) the title and the filters scroll away with the list.
export const CSS = `
*{box-sizing:border-box}
html,body{height:100%;margin:0;overflow:hidden;overscroll-behavior:none}
html{-webkit-text-size-adjust:100%}
body{background:var(--cur-bg);color:var(--cur-fg);font:14px/1.3 var(--cur-font);padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
button,select,input{font:inherit;color:inherit}
[hidden]{display:none!important}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:focus-visible{outline:2px solid var(--cur-focus);outline-offset:2px}
.app{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto;height:100%;min-width:0}
.top{position:relative;min-width:0;max-height:62vh;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain}
.head{display:flex;align-items:center;gap:6px;padding:4px 8px 0 10px;min-width:0}
.head h1{flex:1;min-width:0;margin:0;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pill{flex:none;padding:2px 8px;border-radius:999px;border:1px solid var(--cur-warn);color:var(--cur-warn);font-size:12px;font-weight:700;white-space:nowrap}
.bar{display:flex;flex-wrap:wrap;gap:6px;padding:4px 8px;min-width:0}
.find,.pick{min-width:0;min-height:44px;padding:0 10px;border:1px solid var(--cur-line);border-radius:var(--cur-radius);background:var(--cur-bg);text-overflow:ellipsis}
.find{flex:1 1 100%}
.pick{flex:1 1 120px}
.ctl{gap:4px 6px;padding-bottom:8px}
.ctl button,.ctl select,.ib{min-height:44px;padding:0 10px;border:1px solid var(--cur-line);border-radius:var(--cur-radius);background:var(--cur-surface);cursor:pointer;touch-action:manipulation}
.ib,.ctl button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-width:44px}
.ic{flex:none}
.t,.sws{display:none;white-space:nowrap}
.sws{padding:2px 8px;border-radius:999px;border:1px solid var(--cur-line);font-size:12px;font-weight:700}
.head .ib[aria-expanded="true"]{border-color:var(--cur-accent);color:var(--cur-accent)}
.ctl button:disabled,.ctl select:disabled,.replay:disabled{opacity:.55;cursor:default}
.sw[aria-checked="true"]{border-color:var(--cur-ok);color:var(--cur-ok)}
.sw[aria-checked="true"] .sws{border-color:var(--cur-ok)}
.sw.warn{border-color:var(--cur-warn);color:var(--cur-warn)}
.sw.warn .sws{border-color:var(--cur-warn)}
.testbox{display:flex;gap:6px;flex:1 1 100%;min-width:0}
.testbox select{flex:1 1 auto;min-width:0}
.held{margin:0 0 8px}
.held h2{margin:4px 0;font-size:13px;color:var(--cur-muted)}
.held-row{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--cur-warn);border-radius:var(--cur-radius);background:var(--cur-surface);min-width:0}
.held-row .main{grid-column:1/-1}
.held-top{display:flex;gap:6px;align-items:center;min-width:0}
.held-top .badge{flex:none}
.held-top .who{flex:0 1 auto;min-width:0}
.why{flex:1 1 0;min-width:0;color:var(--cur-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.held-text{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.decide{min-width:44px;min-height:44px;padding:2px 8px;line-height:1.15;border:1px solid var(--cur-line);border-radius:var(--cur-radius);background:var(--cur-bg);cursor:pointer;touch-action:manipulation}
.banner{margin:2px 8px;padding:6px 10px;border-radius:var(--cur-radius);background:color-mix(in srgb,var(--cur-warn) 14%,var(--cur-surface));border:1px solid var(--cur-warn);font-size:13px;overflow-wrap:anywhere}
.banner.link{padding:0 10px}
.banner-link{display:flex;align-items:center;min-height:44px;padding:2px 0;color:inherit;text-decoration:underline;text-underline-offset:2px}
.stage{min-height:0;overflow:auto;padding:4px 8px;overscroll-behavior:contain}
.msg{margin:16px 4px;text-align:center}
.msg-main{margin:0 0 6px;font-size:15px;overflow-wrap:anywhere}
.msg-hint{margin:0;color:var(--cur-muted);font-size:13px;overflow-wrap:anywhere}
.list{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:6px;height:52px;padding:0 4px 0 8px;border:1px solid var(--cur-line);border-radius:var(--cur-radius);background:var(--cur-surface);min-width:0}
.main{display:flex;flex-direction:column;gap:2px;min-width:0}
.l1,.l2{display:flex;align-items:center;gap:6px;min-width:0}
.badge{flex:none;padding:2px 8px;border-radius:999px;border:1px solid var(--cur-line);font-size:12px;font-weight:700;white-space:nowrap}
.badge[data-tone="ok"]{border-color:var(--cur-ok);color:var(--cur-ok)}
.badge[data-tone="warn"]{border-color:var(--cur-warn);color:var(--cur-warn)}
.badge[data-tone="danger"]{border-color:var(--cur-danger);color:var(--cur-danger)}
.badge[data-tone="accent"],.badge[data-tone="info"]{border-color:var(--cur-accent);color:var(--cur-accent)}
.who{flex:0 1 auto;min-width:0;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.det{flex:1 1 0;min-width:0;color:var(--cur-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.det:empty{display:none}
.time{flex:none;margin-left:auto;color:var(--cur-muted);font-size:12px;white-space:nowrap}
.ts{display:none}
@media (max-width:339px){.tf{display:none}.ts{display:inline}.stage{padding-left:4px;padding-right:4px}}
.replay{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:0;border:1px solid var(--cur-line);border-radius:var(--cur-radius);background:var(--cur-bg);cursor:pointer;touch-action:manipulation}
.strip{display:flex;align-items:center;gap:8px;min-height:28px;padding:3px 10px;border-top:1px solid var(--cur-line);background:var(--cur-surface);color:var(--cur-muted);font-size:12px}
.strip span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.strip::before{content:"";flex:none;width:8px;height:8px;border-radius:50%;background:var(--cur-ok)}
.strip.off{color:var(--cur-fg)}
.strip.off::before{background:var(--cur-warn)}
.toast{position:fixed;left:8px;right:8px;bottom:34px;max-width:560px;margin:0 auto;padding:8px 12px;border-radius:var(--cur-radius);background:var(--cur-surface);color:var(--cur-fg);border:2px solid var(--cur-line);opacity:0;transform:translateY(8px);transition:opacity .15s,transform .15s;pointer-events:none}
.toast.show{opacity:1;transform:none}
.toast.ok{border-color:var(--cur-ok)}.toast.warn{border-color:var(--cur-warn)}
@media (min-width:340px){.pick{flex-basis:140px}}
@media (min-width:520px){
  .head,.bar,.stage{padding-left:12px;padding-right:12px}
  .find{flex:2 1 200px}.pick{flex:1 1 150px}
  .ctl button,.ib{padding:0 12px}
  .ctl .t,.ctl .sws,.head .t{display:inline}
  .testbox{flex:1 1 280px}
  .row{grid-template-columns:auto minmax(0,auto) minmax(0,1fr) auto auto;grid-template-areas:"pill who det time rep";column-gap:10px;padding-left:10px}
  .main,.l1,.l2{display:contents}
  .badge{grid-area:pill}.who{grid-area:who}.det{grid-area:det}.time{grid-area:time;margin-left:0}.replay{grid-area:rep}
}
@media (max-height:420px){
  .app{display:block;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain}
  .top{max-height:none;overflow:visible}
  .stage{overflow:visible}
  .strip{position:sticky;bottom:0}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}}`;

/** The complete answer: the page, with a security policy that only allows its own script and style and only contacts the site itself. */
export function dockPage(ctx, { dataUrl, actUrl, scheme = null, scope = "day" }) {
  const nonce = randomBytes(16).toString("base64");
  const L = labelsOf(ctx), esc = kit.esc;
  const config = { dataUrl, actUrl, adminHref: ctx.instance?.id ? `/admin/instances/${encodeURIComponent(ctx.instance.id)}` : "", labels: L, scope, scopes: ["stream", "day", "all"], fetchMs: 10_000, locale: ctx.locale || "en" };
  const script = CLIENT.replace("__SHARED__", () => shared).replace("__CONFIG__", () => JSON.stringify(config).replace(/</g, "\\u003c"));
  const html = `<!doctype html>
<html lang="${esc(ctx.locale || "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="${scheme ?? "dark"}">
<title>${esc(L.title)}</title><link rel="icon" href="data:,"><style nonce="${nonce}">${kit.themeCss(ctx, scheme)}\n${CSS}</style></head>
<body><div class="app" id="app">
<div class="top">
<header class="head"><h1>${esc(L.title)}</h1><span class="pill" id="pausedpill" hidden>${esc(L.sw_paused)}</span><button type="button" class="ib" id="ctltoggle" aria-expanded="false" aria-controls="controls" aria-label="${esc(L.controls)}" title="${esc(L.controls)}"><span class="t">${esc(L.controls)}</span></button></header>
<div class="bar"><label class="sr" for="q">${esc(L.search)}</label><input class="find" id="q" type="search" placeholder="${esc(L.search)}" autocomplete="off"><label class="sr" for="scope">${esc(L.scope_label)}</label><select class="pick" id="scope"><option value="stream">${esc(L.scope_stream)}</option><option value="day">${esc(L.scope_day)}</option><option value="all">${esc(L.scope_all)}</option></select><label class="sr" for="typesel">${esc(L.types_label)}</label><select class="pick" id="typesel"><option value="">${esc(L.all_types)}</option></select></div>
<div class="bar ctl" id="controls" role="group" aria-label="${esc(L.controls)}" hidden><button type="button" class="sw" role="switch" id="pause" aria-checked="true"><span class="t">${esc(L.sw_alerts)}</span><span class="sws">${esc(L.sw_on)}</span></button><button type="button" class="sw" role="switch" id="voice" aria-checked="false"><span class="t">${esc(L.sw_voice)}</span><span class="sws">${esc(L.sw_off)}</span></button><button type="button" class="sw" role="switch" id="mute" aria-checked="false"><span class="t">${esc(L.sw_mute)}</span><span class="sws">${esc(L.sw_off)}</span></button><button type="button" id="stopspeech"><span class="t">${esc(L.stop_speech)}</span></button><button type="button" id="skip"><span class="t">${esc(L.skip)}</span></button><button type="button" id="clear"><span class="t">${esc(L.clear)}</span></button><div class="testbox"><label class="sr" for="testtype">${esc(L.test_label)}</label><select id="testtype"></select><button type="button" id="test"><span class="t">${esc(L.test)}</span></button></div></div>
<div class="banner" id="banner" role="status" hidden></div>
</div>
<main class="stage" id="stage"><section class="held" id="held" hidden aria-labelledby="heldtitle"><h2 id="heldtitle"></h2><ul class="list" id="heldlist"></ul></section><div class="msg" id="msg" role="status">${esc(L.loading)}</div><ul class="list" id="list" aria-live="off"></ul></main>
<footer class="strip" id="strip"><span id="updated">${esc(L.loading)}</span></footer>
</div><div class="toast" id="toast" role="status" aria-live="polite"></div>
<script nonce="${nonce}">${script}</script></body></html>`;
  return new Response(html, { headers: kit.pageHeaders(nonce) });
}
