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
  "sw_alerts", "sw_voice", "sw_mute", "sw_on", "sw_off", "sw_paused", "stop_speech", "skip", "no_voice", "voice_on_ok", "voice_off_ok", "muted_ok", "unmuted_ok", "stopped", "skipped",
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
  var st = { events: [], scope: C.scope, type: "", q: "", fails: 0, ok: false, ready: false, linked: false, paused: false, held: 0, live: false, types: [], busy: {}, timer: null, last: 0, toastTimer: null, listening: true, voice: { available: false, on: false, muted: false }, texts: [] };
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

  function row(e) {
    var li = el("li", "row tone-" + e.tone);
    var badge = el("span", "badge", e.label); badge.setAttribute("data-tone", e.tone);
    var who = el("span", "who", e.name || "");
    var det = el("span", "det", e.detail || "");
    var time = el("span", "time", relTime(e.at, Date.now(), C.locale)); time.setAttribute("data-at", String(e.at));
    var btn = el("button", "replay", st.busy[e.id] ? L.replayed : L.replay); btn.type = "button";
    btn.setAttribute("aria-label", fmt(L.replay_label, { type: e.label, name: e.name || "" }));
    btn.disabled = !st.linked || !!st.busy[e.id];
    if (!st.linked) btn.title = L.no_alerts;
    btn.addEventListener("click", function () { replay(e, btn); });
    var main = el("span", "main"); main.append(who, det);
    li.append(badge, main, time, btn);
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
    sw("pause", L.sw_alerts, !st.paused, st.paused ? L.sw_paused : L.sw_on, !st.linked, st.linked ? "" : L.no_alerts);
    var vo = st.voice, vOk = st.linked && vo.available;
    sw("voice", L.sw_voice, vo.on, vo.on ? L.sw_on : L.sw_off, !vOk, vOk ? "" : (st.linked ? L.no_voice : L.no_alerts));
    sw("mute", L.sw_mute, vo.muted, vo.muted ? L.sw_on : L.sw_off, !vOk, vOk ? "" : (st.linked ? L.no_voice : L.no_alerts));
    $("stopspeech").disabled = !vOk; $("skip").disabled = !st.linked;
    held();
    $("clear").disabled = !st.linked; $("test").disabled = !st.linked || !$("testtype").value; $("testtype").disabled = !st.linked;
    var b = $("banner");
    if (!st.linked) { b.hidden = false; b.textContent = L.no_alerts; }
    else if (st.paused) { b.hidden = false; b.textContent = fmt(L.paused_note, { n: st.held }); }
    else if (!st.listening) { b.hidden = false; b.textContent = L.listening_off; }
    else b.hidden = true;
    var chips = $("chips").children;
    for (var c = 0; c < chips.length; c++) chips[c].setAttribute("aria-pressed", chips[c].getAttribute("data-type") === st.type ? "true" : "false");
    var sc = $("scopes").children;
    for (var k = 0; k < sc.length; k++) sc[k].setAttribute("aria-checked", sc[k].getAttribute("data-scope") === st.scope ? "true" : "false");
    strip();
  }

  /** A switch shows the state it is in (the words, not only the position): label, then "On" / "Off" / "Paused". */
  function sw(id, label, on, stateText, off, why) {
    var b = $(id); b.className = "sw" + (id === "pause" && !on ? " warn" : ""); b.disabled = !!off; b.title = why || ""; b.setAttribute("aria-checked", on ? "true" : "false");
    b.replaceChildren(el("span", "swl", label), el("span", "sws", stateText));
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
    var chips = $("chips"); chips.replaceChildren();
    var all = el("button", "chip", L.all_types); all.type = "button"; all.setAttribute("data-type", ""); chips.appendChild(all);
    for (var i = 0; i < st.types.length; i++) { var b = el("button", "chip", st.types[i].name); b.type = "button"; b.setAttribute("data-type", st.types[i].id); chips.appendChild(b); }
    var sel = $("testtype"); var cur = sel.value; sel.replaceChildren();
    for (var j = 0; j < st.types.length; j++) { var o = el("option", "", st.types[j].name); o.value = st.types[j].id; sel.appendChild(o); }
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
    st.busy[e.id] = true; btn.disabled = true; btn.textContent = L.replayed;
    post("replay", { id: e.id }).then(function (r) {
      if (!r.ok) { toast(why(r.code), "warn"); delete st.busy[e.id]; render(); return; }
      setTimeout(function () { delete st.busy[e.id]; render(); }, 1800);
      refresh();
    });
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
    }).catch(function () { clearTimeout(t); st.fails++; st.ok = false; st.ready = true; render(); }).then(function () {
      if (st.denied) { document.body.textContent = L.denied; return; }
      st.timer = setTimeout(refresh, nextDelay(st.fails));
    });
  }

  $("scopes").addEventListener("click", function (ev) { var b = ev.target.closest ? ev.target.closest("[data-scope]") : null; if (!b) return; st.scope = b.getAttribute("data-scope"); try { localStorage.setItem("events-dock-scope", st.scope); } catch (e) { /* no matter */ } refresh(); });
  $("chips").addEventListener("click", function (ev) { var b = ev.target.closest ? ev.target.closest("[data-type]") : null; if (!b) return; st.type = b.getAttribute("data-type"); try { localStorage.setItem("events-dock-type", st.type); } catch (e) { /* no matter */ } render(); });
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
  setInterval(function () { var ts = document.querySelectorAll ? document.querySelectorAll(".time") : []; for (var i = 0; i < ts.length; i++) ts[i].textContent = relTime(Number(ts[i].getAttribute("data-at")), Date.now(), C.locale); }, 20000);
  render(); refresh();
})();`;

// The page is ONE full-height grid that never scrolls (only the list does): head, scope + search, chips, controls, banner, the list, a one-line status strip.
// Rows are 52 px high on any width, targets are at least 44 px, and from ~280 px up nothing overflows (the chips row scrolls on its own).
export const CSS = `
*{box-sizing:border-box}
html,body{height:100%;margin:0;overflow:hidden;overscroll-behavior:none}
html{-webkit-text-size-adjust:100%}
body{background:var(--cur-bg);color:var(--cur-fg);font:14px/1.3 var(--cur-font);padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
button,select,input{font:inherit;color:inherit}
[hidden]{display:none!important}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:focus-visible{outline:2px solid var(--cur-focus);outline-offset:2px}
.app{display:grid;grid-template-rows:auto auto auto auto auto minmax(0,1fr) auto;height:100%;min-width:0}
.head{display:flex;align-items:center;gap:8px;padding:8px 10px 4px;min-width:0}
.head h1{flex:1;margin:0;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar{display:flex;flex-wrap:wrap;gap:6px;padding:4px 10px;min-width:0}
.seg{display:inline-flex;border:1px solid var(--cur-line);border-radius:var(--cur-radius);overflow:hidden;flex:1 1 250px;min-width:0}
.seg button{flex:1 1 0;min-width:0;min-height:44px;padding:0 8px;border:0;border-right:1px solid var(--cur-line);background:var(--cur-bg);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;touch-action:manipulation}
.seg button:last-child{border-right:0}
.seg button[aria-checked="true"]{background:var(--cur-accent);color:var(--cur-accent-fg);font-weight:700}
.find{flex:1 1 180px;min-width:0;min-height:44px;padding:0 10px;border:1px solid var(--cur-line);border-radius:var(--cur-radius);background:var(--cur-bg)}
.chips{display:flex;gap:6px;overflow-x:auto;padding:4px 10px;scrollbar-width:thin;min-width:0}
.chip{flex:none;min-height:44px;padding:0 12px;border:1px solid var(--cur-line);border-radius:999px;background:var(--cur-bg);cursor:pointer;white-space:nowrap;touch-action:manipulation}
.chip[aria-pressed="true"]{border-color:var(--cur-accent);background:var(--cur-accent);color:var(--cur-accent-fg);font-weight:700}
.ctl button,.ctl select{min-height:44px;padding:0 12px;border:1px solid var(--cur-line);border-radius:var(--cur-radius);background:var(--cur-surface);cursor:pointer;touch-action:manipulation}
.testbox{display:flex;gap:6px;flex:1 1 200px;min-width:0}
.testbox select{flex:1 1 auto;min-width:0}
.ctl button:disabled,.ctl select:disabled,.replay:disabled{opacity:.55;cursor:default}
.ctl .sw{display:inline-flex;align-items:center;gap:8px;flex:1 1 130px;min-width:0;justify-content:space-between}
.swl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sws{flex:none;padding:2px 8px;border-radius:999px;border:1px solid var(--cur-line);font-size:12px;font-weight:700}
.sw[aria-checked="true"]{border-color:var(--cur-ok)}
.sw[aria-checked="true"] .sws{border-color:var(--cur-ok);color:var(--cur-ok)}
.sw.warn{border-color:var(--cur-warn)}
.sw.warn .sws{border-color:var(--cur-warn);color:var(--cur-warn)}
.held{margin:0 0 8px}
.held h2{margin:4px 0;font-size:13px;color:var(--cur-muted)}
.held-row{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--cur-warn);border-radius:var(--cur-radius);background:var(--cur-surface);min-width:0}
.held-row .main{grid-column:1/-1}
.held-top{display:flex;gap:6px;align-items:center;min-width:0}
.held-top .badge{flex:none}
.held-top .who{flex:0 1 auto;min-width:0}
.why{flex:1 1 0;min-width:0;color:var(--cur-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.held-text{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.decide{min-width:44px;min-height:44px;padding:0 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid var(--cur-line);border-radius:var(--cur-radius);background:var(--cur-bg);cursor:pointer;touch-action:manipulation}

.banner{margin:2px 10px;padding:6px 10px;border-radius:var(--cur-radius);background:color-mix(in srgb,var(--cur-warn) 14%,var(--cur-surface));border:1px solid var(--cur-warn);font-size:13px;overflow-wrap:anywhere}
.stage{min-height:0;overflow:auto;padding:4px 10px;overscroll-behavior:contain}
.msg{margin:16px 4px;text-align:center}
.msg-main{margin:0 0 6px;font-size:15px;overflow-wrap:anywhere}
.msg-hint{margin:0;color:var(--cur-muted);font-size:13px;overflow-wrap:anywhere}
.list{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;column-gap:8px;height:52px;padding:0 6px 0 8px;border:1px solid var(--cur-line);border-radius:var(--cur-radius);background:var(--cur-surface);min-width:0}
.badge{padding:2px 8px;border-radius:999px;border:1px solid var(--cur-line);font-size:12px;font-weight:700;white-space:nowrap;max-width:14em;overflow:hidden;text-overflow:ellipsis}
.badge[data-tone="ok"]{border-color:var(--cur-ok);color:var(--cur-ok)}
.badge[data-tone="warn"]{border-color:var(--cur-warn);color:var(--cur-warn)}
.badge[data-tone="danger"]{border-color:var(--cur-danger);color:var(--cur-danger)}
.badge[data-tone="accent"],.badge[data-tone="info"]{border-color:var(--cur-accent);color:var(--cur-accent)}
.main{display:flex;flex-direction:column;min-width:0}
.who{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.det{color:var(--cur-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.det:empty{display:none}
.time{color:var(--cur-muted);font-size:12px;white-space:nowrap}
.replay{min-width:44px;min-height:44px;padding:0 10px;border:1px solid var(--cur-line);border-radius:var(--cur-radius);background:var(--cur-bg);cursor:pointer;white-space:nowrap;touch-action:manipulation}
@media (max-width:340px){.time{display:none}.replay{padding:0 6px}}
.strip{display:flex;align-items:center;gap:8px;min-height:28px;padding:3px 10px;border-top:1px solid var(--cur-line);background:var(--cur-surface);color:var(--cur-muted);font-size:12px}
.strip::before{content:"";flex:none;width:8px;height:8px;border-radius:50%;background:var(--cur-ok)}
.strip.off{color:var(--cur-fg)}
.strip.off::before{background:var(--cur-warn)}
.toast{position:fixed;left:8px;right:8px;bottom:34px;max-width:560px;margin:0 auto;padding:8px 12px;border-radius:var(--cur-radius);background:var(--cur-surface);color:var(--cur-fg);border:2px solid var(--cur-line);opacity:0;transform:translateY(8px);transition:opacity .15s,transform .15s;pointer-events:none}
.toast.show{opacity:1;transform:none}
.toast.ok{border-color:var(--cur-ok)}.toast.warn{border-color:var(--cur-warn)}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}}`;

/** The complete answer: the page, with a security policy that only allows its own script and style and only contacts the site itself. */
export function dockPage(ctx, { dataUrl, actUrl, scheme = null, scope = "day" }) {
  const nonce = randomBytes(16).toString("base64");
  const L = labelsOf(ctx), esc = kit.esc;
  const config = { dataUrl, actUrl, labels: L, scope, scopes: ["stream", "day", "all"], fetchMs: 10_000, locale: ctx.locale || "en" };
  const script = CLIENT.replace("__SHARED__", () => shared).replace("__CONFIG__", () => JSON.stringify(config).replace(/</g, "\\u003c"));
  const html = `<!doctype html>
<html lang="${esc(ctx.locale || "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="${scheme ?? "dark"}">
<title>${esc(L.title)}</title><link rel="icon" href="data:,"><style nonce="${nonce}">${kit.themeCss(ctx, scheme)}\n${CSS}</style></head>
<body><div class="app" id="app">
<header class="head"><h1>${esc(L.title)}</h1></header>
<div class="bar"><div class="seg" id="scopes" role="radiogroup" aria-label="${esc(L.scope_label)}"><button type="button" role="radio" data-scope="stream" aria-checked="false">${esc(L.scope_stream)}</button><button type="button" role="radio" data-scope="day" aria-checked="false">${esc(L.scope_day)}</button><button type="button" role="radio" data-scope="all" aria-checked="false">${esc(L.scope_all)}</button></div>
<label class="sr" for="q">${esc(L.search)}</label><input class="find" id="q" type="search" placeholder="${esc(L.search)}" autocomplete="off"></div>
<div class="chips" id="chips" role="group" aria-label="${esc(L.types_label)}"></div>
<div class="bar ctl"><button type="button" class="sw" role="switch" id="pause" aria-checked="true"><span class="swl">${esc(L.sw_alerts)}</span><span class="sws">${esc(L.sw_on)}</span></button><button type="button" class="sw" role="switch" id="voice" aria-checked="false"><span class="swl">${esc(L.sw_voice)}</span><span class="sws">${esc(L.sw_off)}</span></button><button type="button" class="sw" role="switch" id="mute" aria-checked="false"><span class="swl">${esc(L.sw_mute)}</span><span class="sws">${esc(L.sw_off)}</span></button><button type="button" id="stopspeech">${esc(L.stop_speech)}</button><button type="button" id="skip">${esc(L.skip)}</button><button type="button" id="clear">${esc(L.clear)}</button><div class="testbox"><label class="sr" for="testtype">${esc(L.test_label)}</label><select id="testtype"></select><button type="button" id="test">${esc(L.test)}</button></div></div>
<div class="banner" id="banner" role="status" hidden></div>
<main class="stage" id="stage"><section class="held" id="held" hidden aria-labelledby="heldtitle"><h2 id="heldtitle"></h2><ul class="list" id="heldlist"></ul></section><div class="msg" id="msg" role="status">${esc(L.loading)}</div><ul class="list" id="list" aria-live="off"></ul></main>
<footer class="strip" id="strip"><span id="updated">${esc(L.loading)}</span></footer>
</div><div class="toast" id="toast" role="status" aria-live="polite"></div>
<script nonce="${nonce}">${script}</script></body></html>`;
  return new Response(html, { headers: kit.pageHeaders(nonce) });
}
