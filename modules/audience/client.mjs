// Participation — petits scripts du navigateur (servis par les routes du module ; aucun n'est chargé d'ailleurs).
//  - DIRECT_JS  : la mise à jour « en direct » douce et ralentissante, que les autres modules intègrent à leurs pages et à leurs overlays.
//  - CLIENT_JS  : le code anonyme au hasard du navigateur (stockage local, jamais un cookie) et la page « Mon pseudo ».
//  - REMOTE_JS  : la télécommande (grands boutons pour le téléphone, ou présentation « dock » étroite pour OBS : le même script, `window.__AR.dock` choisit les phrases).
// Aucun n'a de boucle serrée : chaque interrogation est planifiée APRÈS la réponse de la précédente, et se met en pause quand la page est cachée.
export const CLIENT_REV = 2;

/** La bibliothèque du direct. `AudienceDirect.watch({ url, base, max, onData(data, meta), onEmpty(), onError() })` → { stop(), poke() }. */
export const DIRECT_JS = String.raw`(function (g) {
  "use strict";
  if (g.AudienceDirect) return;
  function signal() { try { return typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined; } catch (x) { return undefined; } }
  g.AudienceDirect = {
    watch: function (o) {
      var timer = null, rev = "", delay = o.base, stopped = false;
      function schedule(ms) { clearTimeout(timer); if (!stopped) timer = setTimeout(tick, ms); }
      function tick() {
        if (stopped) return;
        if (document.hidden) { schedule(o.base * 4); return; }
        fetch(o.url + (o.url.indexOf("?") < 0 ? "?" : "&") + "rev=" + encodeURIComponent(rev), { cache: "no-store", credentials: "omit", signal: signal() })
          .then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); })
          .then(function (d) {
            if (d && d.empty) { rev = ""; if (o.onEmpty) o.onEmpty(); delay = Math.min(o.max, Math.max(delay, o.base) * 2); }
            else if (d && d.unchanged) { delay = Math.min(o.max, Math.round(delay * 1.5)); }
            else if (d && d.ok) { rev = d.rev; var hold = o.onData ? o.onData(d.data, d) : 0; delay = Math.max(o.base, typeof hold === "number" ? hold : 0); }
            else { throw new Error("shape"); }
            if (d && d.next) delay = Math.max(delay, Math.min(60000, d.next));
          })
          .catch(function () { delay = Math.min(60000, Math.max(delay, o.base) * 2); if (o.onError) o.onError(); })
          .then(function () { schedule(delay); });
      }
      function onVis() { if (!document.hidden) schedule(300); }
      document.addEventListener("visibilitychange", onVis);
      tick();
      return {
        stop: function () { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); },
        poke: function () { delay = o.base; schedule(50); }
      };
    }
  };
})(window);
`;

/** Le code anonyme du navigateur et la page « Mon pseudo ». */
export const CLIENT_JS = String.raw`(function () {
  "use strict";
  var LS = null;
  try { LS = window.localStorage; } catch (x) { LS = null; }
  function rnd() {
    var b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    var s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  var OK = /^[A-Za-z0-9_-]{22,64}$/;
  // Un seul code pour tous les modules de participation (et celui des sondages d'avant, repris tel quel : on ne revote pas).
  function token() {
    var t = null;
    try { t = LS && (LS.getItem("aud-id") || LS.getItem("vp-id")); } catch (x) {}
    if (!t || !OK.test(t)) t = rnd();
    try { if (LS) { LS.setItem("aud-id", t); } } catch (x) {}
    return t;
  }
  window.Audience = window.Audience || { token: token };
  var els = document.querySelectorAll("[data-aud]");
  var draws = document.querySelectorAll("[data-aud-draw]");
  if (!els.length && !draws.length) return;
  function signal() { try { return typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined; } catch (x) { return undefined; } }
  function post(el, path, body) {
    var url = el.getAttribute("data-api") + "/" + path + "?lang=" + encodeURIComponent(el.getAttribute("data-lang") || "");
    return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "omit", signal: signal() })
      .then(function (r) { return r.json().then(function (j) { j.status = r.status; return j; }, function () { return { ok: false, "error": "net", status: r.status }; }); });
  }
  function init(el) {
    var room = el.getAttribute("data-room");
    var form = el.querySelector("[data-aud-form]");
    var input = el.querySelector("[data-aud-name]");
    var err = el.querySelector("[data-aud-err]");
    var ok = el.querySelector("[data-aud-ok]");
    var who = el.querySelector("[data-aud-who]");
    var forget = el.querySelector("[data-aud-forget]");
    var btn = form ? form.querySelector("button[type=submit]") : null;
    var t = token();
    function msg(code) { return el.getAttribute("data-m-" + code) || el.getAttribute("data-m-net") || ""; }
    function say(node, text) { if (node) { node.textContent = text || ""; node.hidden = !text; } if (input && node === err) { if (text) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid"); } }
    function busy(on, label) { if (!btn) return; btn.disabled = on; if (on) { btn.setAttribute("aria-busy", "true"); btn.setAttribute("data-label", btn.textContent); btn.textContent = label || btn.textContent; } else { btn.removeAttribute("aria-busy"); if (btn.getAttribute("data-label")) btn.textContent = btn.getAttribute("data-label"); } }
    function show(p) {
      if (who) { who.textContent = p && p.pseudo ? p.pseudo : ""; who.hidden = !(p && p.pseudo); }
      var line = el.querySelector("[data-aud-current]");
      if (line) { line.hidden = !(p && p.pseudo); }
      if (input && p && p.pseudo && !input.value) input.value = p.pseudo;
    }
    post(el, "me", { room: room, t: t }).then(function (j) { if (j && j.ok && j.participant) show(j.participant); });
    if (form) form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (btn && btn.disabled) return;
      say(err, ""); say(ok, "");
      var hp = form.querySelector("input[name=website]");
      busy(true, el.getAttribute("data-m-busy"));
      post(el, "pseudo", { room: room, t: t, name: input ? input.value : "", website: hp ? hp.value : "" }).then(function (j) {
        if (j && j.ok) { show(j.participant); say(ok, msg("saved")); return; }
        say(err, msg((j && j.error) || "net"));
        if (input) input.focus();
      }, function () { say(err, msg("net")); }).then(function () { busy(false); });
    });
    if (forget) forget.addEventListener("click", function () {
      if (forget.disabled) return;
      say(err, ""); say(ok, "");
      forget.disabled = true; forget.setAttribute("aria-busy", "true");
      post(el, "forget", { t: t }).then(function (j) {
        if (j && j.ok) {
          try { if (LS) { LS.removeItem("aud-id"); LS.removeItem("vp-id"); LS.removeItem("vp-done"); } } catch (x) {}
          if (input) input.value = "";
          show(null);
          say(ok, msg("forgotten"));
        } else say(err, msg((j && j.error) || "net"));
      }, function () { say(err, msg("net")); }).then(function () { forget.disabled = false; forget.removeAttribute("aria-busy"); });
    });
  }
  for (var i = 0; i < els.length; i++) init(els[i]);
  // La page d'inscription au tirage au sort : même code anonyme, mêmes limites. Le serveur dit si la personne participe déjà ; la page ne demande rien d'autre.
  function initDraw(el) {
    var form = el.querySelector("[data-aud-form]");
    var input = el.querySelector("[data-aud-name]");
    var err = el.querySelector("[data-aud-err]");
    var ok = el.querySelector("[data-aud-ok]");
    var state = el.querySelector("[data-aud-state]");
    var count = el.querySelector("[data-aud-count]");
    var title = el.querySelector("[data-aud-title]");
    var btn = form ? form.querySelector("button[type=submit]") : null;
    var t = token();
    function msg(code) { return el.getAttribute("data-m-" + code) || el.getAttribute("data-m-net") || ""; }
    function say(node, text) { if (node) { node.textContent = text || ""; node.hidden = !text; } if (input && node === err) { if (text) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid"); } }
    function busy(on) { if (!btn) return; btn.disabled = on; if (on) { btn.setAttribute("aria-busy", "true"); btn.setAttribute("data-label", btn.textContent); btn.textContent = el.getAttribute("data-m-busy") || btn.textContent; } else { btn.removeAttribute("aria-busy"); if (btn.getAttribute("data-label")) btn.textContent = btn.getAttribute("data-label"); } }
    function paint(j) {
      var can = !!(j && j.open && j.site);
      var text = !j || !j.open ? (j && j.title ? el.getAttribute("data-s-closed") : el.getAttribute("data-s-none")) : (!j.site ? (el.getAttribute("data-s-nosite") || "").replace("{keyword}", j.keyword || "") : (j.in ? el.getAttribute("data-s-in") : ""));
      say(state, text);
      if (title && j && j.open && j.title) title.textContent = j.title;
      if (count) { var n = j && j.open ? j.count : 0; count.hidden = !(j && j.open); count.textContent = (n === 1 ? el.getAttribute("data-c-one") : el.getAttribute("data-c-many") || "").replace("{n}", String(n)); }
      if (form) form.hidden = !can || !!(j && j.in);
      if (input && j && j.pseudo && !input.value) input.value = j.pseudo;
    }
    post(el, "draw-me", { t: t }).then(function (j) { if (j && j.ok) paint(j); });
    if (form) form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (btn && btn.disabled) return;
      say(err, ""); say(ok, "");
      var hp = form.querySelector("input[name=website]");
      busy(true);
      post(el, "draw-enter", { t: t, name: input ? input.value : "", website: hp ? hp.value : "" }).then(function (j) {
        if (j && j.ok) { paint({ open: true, site: true, in: true, pseudo: j.pseudo, count: j.count, title: j.title }); say(state, el.getAttribute("data-s-in")); return; }
        say(err, msg((j && j.error) || "net"));
        if (input) input.focus();
      }, function () { say(err, msg("net")); }).then(function () { busy(false); });
    });
  }
  for (var d = 0; d < draws.length; d++) initDraw(draws[d]);
})();
`;

/**
 * The control dock (phone and OBS dock: the same script). Configuration in window.__AR: { k, dock, state, press, lang, t: { texts } }.
 * It draws what the modules describe (`panel.view`, see lib.mjs): tabs at the top with live badges, one stage, one status line, a "stop everything" button.
 * No scrolling anywhere (the page is a 100dvh grid); no interval timer (each poll is planned AFTER the previous answer; paused when the page is hidden).
 */
export const REMOTE_JS = String.raw`(function () {
  "use strict";
  var C = window.__AR, T = C.t;
  var $ = function (id) { return document.getElementById(id); };
  var elTabs = $("tabs"), elStage = $("stage"), elStrip = $("strip"), elMsg = $("msg"), elSt = $("st"), elSr = $("sr"), elPanic = $("panic"), elTop = $("top");
  var data = null, skew = 0, sel = null, timer = null, delay = 3000, inflight = false, net = "connecting", retryAt = 0, hidden = false;
  var ui = { compose: {}, sheet: null, armed: null, page: {}, room: null, drafts: {}, errors: {} };
  var again = false, seq = 0, msgTimer = null, armTimer = null, typing = false, dirty = false, lastStage = {}, tabs = [];
  function h(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
  function fmt(s, vars) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] !== undefined ? vars[k] : m; }); }
  function signal() { try { return typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined; } catch (x) { return undefined; } }
  function api(path, body) {
    var init = body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store", credentials: "omit", signal: signal() } : { cache: "no-store", credentials: "omit", signal: signal() };
    return fetch(path, init).then(function (r) { return r.json().then(function (j) { j.status = r.status; return j; }, function () { return { ok: false, error: "net", status: r.status }; }); });
  }
  function keep(k, v) { try { if (v === undefined) return window.sessionStorage.getItem(k); window.sessionStorage.setItem(k, v); } catch (x) { /* storage unavailable: harmless */ } return null; }
  function clock(until) {
    var ms = Date.parse(until) - (Date.now() + skew);
    if (!(ms > 0)) return "00:00";
    var s = Math.round(ms / 1000), m = Math.floor(s / 60), hh = Math.floor(m / 60);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return hh > 0 ? hh + ":" + p(m % 60) + ":" + p(s % 60) : p(m) + ":" + p(s % 60);
  }
  /* ───────── status line and announcements ───────── */
  function paintStrip() {
    var cls = "strip", text = "", st = "";
    if (net === "online") { cls += " ok"; st = T.connected; } else if (net === "offline") { cls += " bad"; text = "⚠ " + fmt(T.retry, { n: Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) }); } else if (net === "denied") { cls += " err"; text = T.denied; } else { st = T.connecting; }
    if (msgTimer && elMsg.getAttribute("data-say")) { return; }
    elStrip.className = cls; elMsg.textContent = text; elSt.textContent = st;
  }
  function say(text, tone) {
    clearTimeout(msgTimer);
    elStrip.className = "strip" + (tone === "err" ? " err" : tone === "ok" ? " ok" : "");
    elMsg.textContent = text || ""; elMsg.setAttribute("data-say", "1"); elSt.textContent = "";
    msgTimer = setTimeout(function () { msgTimer = null; elMsg.removeAttribute("data-say"); paintStrip(); }, tone === "err" ? 8000 : 5000);
  }
  function announce(text) { elSr.textContent = ""; setTimeout(function () { elSr.textContent = text; }, 30); }
  /* ───────── the tabs model ───────── */
  function buildTabs() {
    var out = [], used = {};
    (data.panels || []).forEach(function (p) {
      var t = p.view && p.view.type, id = t && !used[t] ? t : "p:" + (p.provider || p.id);
      if (t && !used[t]) used[t] = 1;
      out.push({ id: id, label: id === "poll" ? T.tabPoll : id === "draw" ? T.tabDraw : (p.tab || p.title), panel: p, view: id === "poll" || id === "draw" ? p.view : null, pid: p.provider || p.id });
    });
    var order = { poll: 0, draw: 1 };
    out.sort(function (a, b) { return (order[a.id] === undefined ? 2 : order[a.id]) - (order[b.id] === undefined ? 2 : order[b.id]); });
    var people = 0; (data.rooms || []).forEach(function (r) { people += r.count || 0; });
    out.push({ id: "chat", label: T.tabChat, chat: true, people: people });
    return out;
  }
  /* The badge of a tab: the dot (decoration), the remaining time, the count. It is rebuilt every second. */
  function fillBadge(node, t) {
    var v = t.view, kids = [];
    function part(cls, text) { kids.push(h("span", cls, text)); }
    if (t.chat) { if (t.people) { part("g", "👥"); part("", " " + t.people); } }
    else if (v && v.stage === "live") { part("g", "●"); if (v.until) part("", clock(v.until)); if (v.count !== null) part("c", (v.until ? " · " : " ") + v.count); }
    else if (v && v.stage === "done") { part("g", "✓"); if (v.count !== null) part("", " " + v.count); }
    node.replaceChildren.apply(node, kids);
  }
  function paintTabs() {
    var old = elTabs.querySelector("[data-fk]:focus"), fk = document.activeElement && elTabs.contains(document.activeElement) ? document.activeElement.getAttribute("data-fk") : null;
    var frag = document.createDocumentFragment();
    tabs.forEach(function (t, i) {
      var on = t.id === sel, live = t.view && t.view.stage === "live";
      var b = h("button", "tab" + (live ? " live" : ""));
      b.type = "button"; b.id = "tab-" + i; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", on ? "true" : "false"); b.setAttribute("tabindex", on ? "0" : "-1"); b.setAttribute("data-fk", "t:" + t.id); b.setAttribute("data-tab", t.id);
      b.setAttribute("aria-label", t.label + (live ? ", " + T.live : t.view && t.view.stage === "done" ? ", " + T.finished : ""));
      b.appendChild(h("span", "tl", t.label));
      var bg = h("span", "tb"); fillBadge(bg, t); bg.setAttribute("aria-hidden", "true"); b.appendChild(bg);
      b.addEventListener("click", function () { pick(t.id); });
      b.addEventListener("keydown", function (ev) { tabKey(ev, i); });
      frag.appendChild(b);
    });
    elTabs.replaceChildren(frag);
    if (fk) { var n = elTabs.querySelector('[data-fk="' + fk + '"]'); if (n) n.focus({ preventScroll: true }); }
  }
  function tickBadges() {
    var bs = elTabs.querySelectorAll(".tab");
    for (var i = 0; i < bs.length && i < tabs.length; i++) { var tb = bs[i].querySelector(".tb"); if (tb && tabs[i].view && tabs[i].view.stage === "live") fillBadge(tb, tabs[i]); }
  }
  function pick(id) { sel = id; keep("ar-tab", id); ui.sheet = null; disarm(); paintTabs(); renderStage(); }
  function tabKey(ev, i) {
    var k = ev.key, n = tabs.length, to = -1;
    if (k === "ArrowRight") to = (i + 1) % n; else if (k === "ArrowLeft") to = (i + n - 1) % n; else if (k === "Home") to = 0; else if (k === "End") to = n - 1;
    if (to < 0) return;
    ev.preventDefault(); pick(tabs[to].id); var b = elTabs.querySelector('[data-tab="' + tabs[to].id + '"]'); if (b) b.focus({ preventScroll: true });
  }
  /* ───────── the confirm / undo pattern (3 seconds, on the same row) ───────── */
  function disarm() { clearTimeout(armTimer); if (ui.armed) { ui.armed = null; if (!typing) { renderStage(); renderPanic(); } } }
  function arm(key, run, loss, tab) { disarm(); ui.armed = { key: key, run: run, loss: loss || "", tab: tab || "" }; armTimer = setTimeout(disarm, 3000); renderStage(); renderPanic(); announce((loss ? loss + ". " : "") + T.armed); }
  /* ───────── buttons ───────── */
  function btn(b, cls, run) {
    var n = h("button", "btn" + (cls ? " " + cls : "")); n.type = "button";
    n.appendChild(h("span", "lb l", b.label)); n.appendChild(h("span", "lb s", b.short || b.label));
    if (b.key && C.dock) { var k = h("kbd", "", b.key); k.setAttribute("aria-hidden", "true"); n.appendChild(k); }
    n.title = b.label + (b.key ? " (" + T.keys + " " + b.key + ")" : "");
    n.setAttribute("data-fk", "b:" + b.id + (b.values && b.values.pid ? ":" + b.values.pid : ""));
    if (b.key) n.setAttribute("aria-keyshortcuts", b.key);
    if (b.disabled) n.disabled = true;
    n.addEventListener("click", function () { run(b, n); });
    return n;
  }
  function press(pid, action, values, node, after) {
    if (node && node.disabled) return;
    if (node) { node.disabled = true; node.setAttribute("aria-busy", "true"); }
    return api(C.press, { k: C.k, panel: pid, action: action, values: values || {} }).then(function (j) {
      if (j && j.ok) {
        say(j.message || T.done, "ok"); if (after) after(); delay = 1500;
        var ae = document.activeElement; if (ae && elStage.contains(ae) && ae.tagName === "INPUT" && ae.type !== "radio") { ae.blur(); typing = false; dirty = false; }   // Enter in a field: the form is done, the stage must be drawn again
        refresh();
      }
      else if (j && j.status === 404) { net = "denied"; paintStrip(); }
      else if (!j || j.error === "net" || j.status >= 500) { say(T.notSent, "err"); net = "offline"; retryAt = Date.now() + 3000; paintStrip(); }
      else { say((j && j.message) || T["e_" + ((j && j.error) || "net")] || T.e_net, "err"); if (j && j.field) fieldError(pid, j.field, j.message); }
    }, function () { say(T.notSent, "err"); }).then(function () { if (node && document.body.contains(node)) { node.disabled = false; node.removeAttribute("aria-busy"); } });
  }
  function fieldError(pid, field, message) {
    typing = false; dirty = false;   // the answer is in: draw it even if the person was still in a field (Enter)
    ui.errors[pid + ":" + field] = message || ""; ui.sheet = ui.sheet && ui.sheet.moreFields && ui.sheet.moreFields.indexOf(field) >= 0 ? ui.sheet : null; renderStage();
    var i = elStage.querySelector('[data-in="' + pid + ":" + field + '"]'); if (i) i.focus();
  }
  /* ───────── forms ───────── */
  function draftKey(pid, f, fd) { return pid + ":" + f.id + ":" + fd.name; }
  function valueOf(pid, f, fd) { var k = draftKey(pid, f, fd); return ui.drafts[k] !== undefined ? ui.drafts[k] : (fd.value || ""); }
  function control(pid, f, fd) {
    var id = "f" + (++seq), dk = draftKey(pid, f, fd), cur = valueOf(pid, f, fd), err = ui.errors[pid + ":" + fd.name];
    var wrap = h("div", "fld" + (fd.low ? " wide" : ""));
    if (fd.type === "select" && fd.seg) {
      var lab0 = h("span", "seglab", fd.label); wrap.appendChild(lab0);
      var seg = h("div", "seg"); seg.setAttribute("role", "radiogroup"); seg.setAttribute("aria-label", fd.label);
      var customOpt = fd.options.filter(function (o) { return o.custom; })[0], cin = null, ck = dk + "~c";
      function syncCustom(focus) {   // the "Other" chip turns into ONE compact field in the same row; the "Last" chip makes room for it
        if (!customOpt) return;
        var on = (ui.drafts[dk] !== undefined ? ui.drafts[dk] : cur) === customOpt.value;
        seg.classList.toggle("oth", on); cin.hidden = !on;
        if (on && cin.clientWidth >= 150 && cin.getAttribute("data-ex")) cin.placeholder = cin.getAttribute("data-ex");
        if (on && focus) cin.focus();
      }
      fd.options.forEach(function (o, i) {
        var rid = id + "r" + i, r = h("input"); r.type = "radio"; r.name = id; r.id = rid; r.value = o.value; if (o.value === cur) r.checked = true;
        r.addEventListener("change", function () { ui.drafts[dk] = o.value; syncCustom(true); });
        var l = h("label", o.last ? "lastopt" : "", o.short || o.label); l.setAttribute("for", rid); if (o.short && o.short !== o.label) l.title = o.label;
        if (o.last) l.setAttribute("aria-label", o.label);
        seg.appendChild(r); seg.appendChild(l);
        if (o.custom) {
          r.className = "cr";
          cin = h("input", "in cust"); cin.type = "text"; cin.autocomplete = "off"; cin.spellcheck = false; cin.setAttribute("autocapitalize", "off"); cin.setAttribute("autocorrect", "off");
          cin.inputMode = "text"; cin.setAttribute("enterkeyhint", "go"); cin.setAttribute("pattern", "[0-9:msMS ]*"); cin.maxLength = 20;
          cin.placeholder = fd.placeholder || fd.example || ""; cin.title = fd.example || ""; cin.setAttribute("data-ex", fd.example || ""); cin.setAttribute("aria-label", fd.label + " – " + o.label); cin.setAttribute("data-in", pid + ":" + fd.name); cin.name = fd.name + "_other";
          cin.value = ui.drafts[ck] || "";
          cin.addEventListener("input", function () { ui.drafts[ck] = cin.value; if (ui.errors[pid + ":" + fd.name]) { delete ui.errors[pid + ":" + fd.name]; cin.removeAttribute("aria-invalid"); var e0 = wrap.querySelector(".err"); if (e0) e0.hidden = true; } });
          seg.appendChild(cin);
        }
      });
      if (customOpt || fd.options.length >= 6) seg.classList.add("many");   // six chips on a narrow row: no room for the tick, the chosen one is marked by a thick bar instead
      wrap.appendChild(seg);
      if (customOpt) {
        var er = h("p", "err", err || ""); er.hidden = !err; er.setAttribute("role", "alert"); er.id = id + "e"; cin.setAttribute("aria-describedby", er.id); if (err) cin.setAttribute("aria-invalid", "true");
        wrap.appendChild(er); syncCustom(false);
      }
      return wrap;
    }
    var lab = h("label", "", fd.label); lab.setAttribute("for", id); wrap.appendChild(lab);
    var input;
    if (fd.type === "select") {
      input = h("select", "in");
      fd.options.forEach(function (o) { var op = h("option", "", o.label); op.value = o.value; if (o.value === cur) op.selected = true; input.appendChild(op); });
    } else {
      input = h("input", "in"); input.type = "text"; input.autocomplete = "off"; input.spellcheck = false; input.setAttribute("autocapitalize", "off");
      if (fd.type === "number") input.inputMode = "numeric"; else input.maxLength = fd.max || 60;
      input.placeholder = fd.example || fd.label;
      input.value = cur;
    }
    input.id = id; input.name = fd.name; input.setAttribute("data-in", pid + ":" + fd.name);
    input.addEventListener("input", function () { ui.drafts[dk] = input.value; if (ui.errors[pid + ":" + fd.name]) { delete ui.errors[pid + ":" + fd.name]; input.removeAttribute("aria-invalid"); var e = wrap.querySelector(".err"); if (e) e.hidden = true; } });
    input.addEventListener("change", function () { ui.drafts[dk] = input.value; });
    if (fd.recall && fd.type === "text") {   // "Last: …": the previous text, offered again in one tap, in the same row as the field
      var rowIn = h("div", "recallrow"), rb = h("button", "btn recall", fd.recallLabel || fd.recall); rb.type = "button"; rb.title = fd.recallLabel || fd.recall; rb.setAttribute("data-fk", "recall:" + fd.name);
      rb.addEventListener("click", function () { ui.drafts[dk] = fd.recall; input.value = fd.recall; input.focus(); });
      rowIn.appendChild(input); rowIn.appendChild(rb); wrap.appendChild(rowIn);
    } else wrap.appendChild(input);
    var e = h("p", "err", err || ""); e.hidden = !err; e.setAttribute("role", "alert"); e.id = id + "e"; input.setAttribute("aria-describedby", e.id); if (err) input.setAttribute("aria-invalid", "true");
    wrap.appendChild(e);
    return wrap;
  }
  function submitValues(pid, f) {
    var v = {};
    f.fields.forEach(function (fd) {
      v[fd.name] = valueOf(pid, f, fd);
      var oc = fd.type === "select" && fd.seg ? fd.options.filter(function (o) { return o.custom; })[0] : null;
      if (oc && v[fd.name] === oc.value) v[fd.name] = (ui.drafts[draftKey(pid, f, fd) + "~c"] || "").trim() || oc.value;   // the typed time goes as typed: the site reads it ("other" alone is refused with a message under the field)
    });
    return v;
  }
  function clearDrafts(pid, f) { f.fields.forEach(function (fd) { delete ui.drafts[draftKey(pid, f, fd)]; delete ui.drafts[draftKey(pid, f, fd) + "~c"]; }); }
  /* A short stage has no room for the optional "low" fields: they move to the options sheet. */
  function shortStage() { return elStage.clientHeight <= 440; }
  function isMore(fd) { return fd.more || (fd.low && shortStage()); }
  function formBody(t, f, moreHost) {
    var box = h("div", "form"), more = f.fields.filter(isMore);
    f.fields.forEach(function (fd) { if (!isMore(fd)) box.appendChild(control(t.pid, f, fd)); });
    if (more.length) {
      var mb = h("button", "btn chip more", moreHost ? "⋯" : T.more); mb.type = "button"; mb.setAttribute("data-fk", "more"); mb.title = T.more; mb.setAttribute("aria-label", T.more);
      mb.addEventListener("click", function () { ui.sheet = { tab: t.id, moreFields: more.map(function (x) { return x.name; }) }; renderStage(); });
      (moreHost || box).appendChild(mb);
    }
    return box;
  }
  function sheet(t, f) {
    var box = h("div", "sheet"), top = h("p", "ttl", f.title);
    var rows = h("div", "rows");
    f.fields.forEach(function (fd) { if (isMore(fd)) rows.appendChild(control(t.pid, f, fd)); });
    var done = h("button", "btn primary", T.done2); done.type = "button"; done.setAttribute("data-fk", "sheet-done");
    done.addEventListener("click", function () { ui.sheet = null; renderStage(); });
    box.appendChild(top); box.appendChild(rows); box.appendChild(done);
    return box;
  }
  /* ───────── the stage: one view ───────── */
  function runBtn(t, b, node) {
    if (b.id === "compose") { ui.compose[t.id] = true; renderStage(); return; }
    if (b.loss) { arm("b:" + b.id + (b.values && b.values.pid ? ":" + b.values.pid : ""), function () { press(t.pid, b.id, b.values, null); }, b.loss, t.id); return; }
    press(t.pid, b.id, withTyped(t, b), node, function () {   // a one-tap start from the start form: what was typed for it is used up, and the form is closed
      var f = t.view && t.view.form; if (f && b.with) f.fields.forEach(function (fd) { if (b.with.indexOf(fd.name) >= 0) delete ui.drafts[draftKey(t.pid, f, fd)]; });
      delete ui.compose[t.id];
    });
  }
  /* A button may carry what was typed in the start form (the question of a Yes / No poll). */
  function withTyped(t, b) {
    if (!b.with || !b.with.length) return b.values;
    var f = t.view && t.view.form, v = {}, k;
    for (k in (b.values || {})) v[k] = b.values[k];
    if (f) f.fields.forEach(function (fd) { if (b.with.indexOf(fd.name) >= 0) v[fd.name] = valueOf(t.pid, f, fd); });
    return v;
  }
  function viewEl(t) {
    var v = t.view, form = (v.stage === "idle" || ui.compose[t.id]) && v.form ? v.form : null;
    var root = h(form ? "form" : "div", "view"); if (form) root.noValidate = true;
    var hd = h("div", "hd"), ttl = h("p", "ttl", form && v.stage !== "idle" ? form.title : v.title); ttl.title = v.title; hd.appendChild(ttl);
    if (v.sub && !(form && v.stage !== "idle")) hd.appendChild(h("p", "sub", v.sub));
    if (v.note) hd.appendChild(h("p", "sub", v.note));
    root.appendChild(hd);
    var meter = h("div", "meter");
    if (!form && v.stage === "live" && v.until) { var cl = h("span", "clock", clock(v.until)); cl.setAttribute("data-until", v.until); meter.appendChild(cl); }
    if (!form && v.count !== null && v.stage !== "idle") { var ct = h("div", "cnt"); ct.appendChild(h("b", "", String(v.count))); ct.appendChild(h("span", "", v.unit)); meter.appendChild(ct); }
    if (!form && v.stage === "live" && v.until && v.from) { var pr = h("div", "prog"); pr.setAttribute("aria-hidden", "true"); var pi = h("i"); pi.setAttribute("data-from", v.from); pi.setAttribute("data-until", v.until); pr.appendChild(pi); meter.appendChild(pr); }
    root.appendChild(meter);
    var bd = h("div", "bd" + (form ? " start" : ""));
    if (form) {
      var chips = null;
      if (v.chips && v.chips.length) { chips = h("div", "chips"); v.chips.forEach(function (c) { chips.appendChild(btn(c, "chip", function (b, n) { runBtn(t, b, n); })); }); bd.appendChild(chips); }
      bd.appendChild(formBody(t, form, chips));
    } else {
      if (v.word) { var w = h("p", "word", v.word); bd.appendChild(w); }
      if (v.bars.length) {
        var bars = h("div", "bars"); bars.setAttribute("data-n", String(v.bars.length)); bars.style.setProperty("--n", String(v.bars.length));
        bars.setAttribute("role", "list");
        v.bars.forEach(function (x) {
          var r = h("div", "bar" + (x.lead ? " lead" : "")); r.style.setProperty("--p", x.pct + "%"); r.setAttribute("role", "listitem");
          var tt = h("span", "bt", x.text); tt.title = x.text; r.appendChild(tt);
          var vv = h("span", "bv", x.pct + "%"); vv.appendChild(h("small", "", String(x.n))); r.appendChild(vv);
          if (x.lead) r.setAttribute("aria-label", x.text + ", " + T.leading + ", " + x.pct + "%, " + x.n);
          bars.appendChild(r);
        });
        bd.appendChild(bars);
      }
      if (v.names.length) {
        var ws = h("div", "winners"); ws.setAttribute("data-n", String(v.names.length));
        v.names.forEach(function (x) {
          var b = h("button", "win"); b.type = "button"; b.title = x.text + (x.label ? " — " + x.label : ""); b.setAttribute("data-fk", "w:" + (x.values && x.values.pid || x.text));
          b.setAttribute("aria-label", x.text + (x.label ? ", " + x.label : ""));
          b.appendChild(h("span", "wn", x.text));
          if (x.action) { b.appendChild(h("span", "nh", x.label)); var g = h("span", "gl", "↻"); g.setAttribute("aria-hidden", "true"); b.appendChild(g); b.addEventListener("click", function () { runBtn(t, { id: x.action, label: x.label, values: x.values, loss: x.loss || x.label }, b); }); }
          ws.appendChild(b);
        });
        bd.appendChild(ws);
      }
    }
    root.appendChild(bd);
    var acts = h("div", "acts");
    if (form) {
      var go = h("button", "btn primary"); go.type = "submit"; go.setAttribute("data-fk", "f:" + form.id);
      go.appendChild(h("span", "lb l", form.submit)); go.appendChild(h("span", "lb s", form.submit));
      acts.appendChild(go);
      if (ui.compose[t.id]) { var cb = h("button", "btn", T.back); cb.type = "button"; cb.addEventListener("click", function () { delete ui.compose[t.id]; renderStage(); }); acts.appendChild(cb); }
      root.addEventListener("submit", function (ev) {
        ev.preventDefault();
        if (go.disabled) return;
        ui.errors = {};
        press(t.pid, form.id, submitValues(t.pid, form), go, function () { clearDrafts(t.pid, form); delete ui.compose[t.id]; });
      });
    } else {
      if (v.primary) acts.appendChild(btn(v.primary, "primary", function (b, n) { runBtn(t, b, n); }));
      var list = (v.actions || []).slice(); if (v.danger) list.push(v.danger);
      if (list.length || (ui.armed && ui.armed.tab === t.id)) {
        var armedHere = ui.armed && ui.armed.tab === t.id;
        var row = h("div", "row"); row.setAttribute("data-n", String(list.length));
        if (armedHere) {
          var ok = h("button", "btn danger go arm"); ok.type = "button"; ok.setAttribute("data-fk", "confirm");
          var col = h("span", "col"); col.appendChild(h("span", "", T.confirm)); var ls = h("span", "loss", ui.armed.loss); col.appendChild(ls); ok.appendChild(col);
          ok.addEventListener("click", function () { var run = ui.armed.run; clearTimeout(armTimer); ui.armed = null; run(); renderStage(); });
          var un = h("button", "btn undo", T.undo); un.type = "button"; un.setAttribute("data-fk", "undo"); un.addEventListener("click", disarm);
          row.appendChild(ok); row.appendChild(un);
        } else {
          list.forEach(function (b) { row.appendChild(btn(b, v.danger && b === v.danger ? "danger" : "", function (bb, n) { runBtn(t, bb, n); })); });
        }
        acts.appendChild(row);
      }
    }
    root.appendChild(acts);
    return root;
  }
  /* A panel without a live view (a module that only gives buttons and forms): plain, but usable. */
  function genericEl(t) {
    var p = t.panel, root = h("div", "view"); root.appendChild(h("p", "ttl", p.title));
    if (p.state) root.appendChild(h("p", "sub", p.state.text));
    var bd = h("div", "bd"); root.appendChild(bd);
    var acts = h("div", "acts");
    (p.buttons || []).forEach(function (b) {
      var d = { id: b.id, label: b.label, short: b.label, disabled: b.disabled, loss: b.confirm };
      acts.appendChild(btn(d, b.tone === "primary" ? "primary" : b.tone === "danger" ? "danger" : "", function (bb, n) { if (b.confirm) arm("g:" + b.id, function () { press(t.pid, b.id, {}, null); }, b.confirm, t.id); else press(t.pid, b.id, {}, n); }));
    });
    (p.forms || []).forEach(function (f) { var fm = formBody(t, f); var go = h("button", "btn primary", f.submit); go.type = "button"; go.addEventListener("click", function () { ui.errors = {}; press(t.pid, f.id, submitValues(t.pid, f), go, function () { clearDrafts(t.pid, f); }); }); bd.appendChild(fm); acts.appendChild(go); });
    root.appendChild(acts);
    return root;
  }
  /* ───────── the chat tab: rooms and people, mute, clear ───────── */
  function chatEl() {
    var rooms = data.rooms || [], root = h("div", "chat");
    if (!rooms.length) { root.appendChild(h("p", "empty", T.noRooms)); return root; }
    if (!ui.room || !rooms.some(function (r) { return r.key === ui.room; })) ui.room = rooms[0].key;
    var room = rooms.filter(function (r) { return r.key === ui.room; })[0];
    var head = h("div", "hd");
    if (rooms.length > 1) {
      var sl = h("select", "in"); sl.setAttribute("aria-label", T.rooms); sl.setAttribute("data-fk", "room");
      rooms.forEach(function (r) { var o = h("option", "", r.label + " · " + r.count); o.value = r.key; if (r.key === ui.room) o.selected = true; sl.appendChild(o); });
      sl.addEventListener("change", function () { ui.room = sl.value; ui.page = {}; renderStage(); });
      head.appendChild(sl);
    } else head.appendChild(h("p", "ttl", room.label + " · " + room.count + " " + (room.count === 1 ? T.person : T.people)));
    root.appendChild(head);
    var per = ui.per || 3, list = room.recent || [], pages = Math.max(1, Math.ceil(list.length / per)), pg = Math.min(ui.page[room.key] || 0, pages - 1);
    var ppl = h("div", "people");
    if (!list.length) ppl.appendChild(h("p", "empty", T.noOne));
    list.slice(pg * per, pg * per + per).forEach(function (m) {
      var line = h("div", "pp"), nm = h("span", "pn" + (m.muted ? " m" : ""), m.pseudo || T.anon); nm.title = m.pseudo || T.anon;
      if (m.muted) nm.appendChild(h("span", "tag", T.mutedTag));
      line.appendChild(nm);
      var b = btn({ id: "mute", label: m.muted ? T.unmute : T.mute, short: m.muted ? T.unmute : T.mute, values: { room: room.key, id: m.id, muted: m.muted ? "0" : "1" } }, "", function (bb, n) { press("audience", "mute", bb.values, n); });
      b.setAttribute("data-fk", "m:" + m.id); line.appendChild(b); ppl.appendChild(line);
    });
    root.appendChild(ppl);
    var foot = h("div", "foot");
    if (pages > 1) {
      var pgr = h("div", "pager"), pv = h("button", "btn", "‹"), nx = h("button", "btn", "›");
      pv.type = nx.type = "button"; pv.setAttribute("aria-label", T.prev); nx.setAttribute("aria-label", T.next); pv.disabled = pg === 0; nx.disabled = pg >= pages - 1;
      pv.addEventListener("click", function () { ui.page[room.key] = pg - 1; renderStage(); }); nx.addEventListener("click", function () { ui.page[room.key] = pg + 1; renderStage(); });
      pgr.appendChild(pv); pgr.appendChild(h("span", "", fmt(T.pageOf, { a: pg + 1, b: pages }))); pgr.appendChild(nx); foot.appendChild(pgr);
    }
    var armedClear = ui.armed && ui.armed.key === "clear:" + room.key;
    if (armedClear) {
      var rw = h("div", "row"), ok = h("button", "btn danger go arm"); ok.type = "button"; ok.setAttribute("data-fk", "confirm");
      var col = h("span", "col"); col.appendChild(h("span", "", T.confirm)); col.appendChild(h("span", "loss", T.clearLoss)); ok.appendChild(col);
      ok.addEventListener("click", function () { var run = ui.armed.run; clearTimeout(armTimer); ui.armed = null; run(); renderStage(); });
      var un = h("button", "btn undo", T.undo); un.type = "button"; un.addEventListener("click", disarm); rw.appendChild(ok); rw.appendChild(un); foot.appendChild(rw);
    } else {
      var cl = btn({ id: "clear", label: T.clear, short: T.clear, key: "X", loss: T.clearLoss }, "danger", function () { arm("clear:" + room.key, function () { press("audience", "clear", { room: room.key }, null); }, T.clearLoss, "chat"); });
      foot.appendChild(cl);
    }
    root.appendChild(foot);
    return root;
  }
  function renderStage() {
    if (!data) return;
    if (typing) { dirty = true; return; }
    var t = tabs.filter(function (x) { return x.id === sel; })[0] || tabs[0]; if (!t) return;
    var ae = document.activeElement, fk = ae && elStage.contains(ae) ? ae.getAttribute("data-fk") : null;
    var node = t.chat ? chatEl() : t.view ? viewEl(t) : genericEl(t);
    var kids = [node];
    if (ui.sheet && ui.sheet.tab === t.id && t.view && t.view.form) kids.push(sheet(t, t.view.form));
    elStage.replaceChildren.apply(elStage, kids);
    elStage.setAttribute("aria-busy", "false");
    var cu = elStage.querySelectorAll(".seg .cust"); for (var ci = 0; ci < cu.length; ci++) if (cu[ci].clientWidth >= 150 && cu[ci].getAttribute("data-ex")) cu[ci].placeholder = cu[ci].getAttribute("data-ex");   // the whole example when the field is wide enough, the short one otherwise
    if (t.chat) {   // how many people fit: measured once the list is in the page (rows are 52 px), then drawn again if the guess was wrong
      var pp = elStage.querySelector(".people"), fit = pp ? Math.max(1, Math.floor(pp.clientHeight / 52)) : 0;
      if (pp && fit !== ui.per && !ui.measuring) { ui.per = fit; ui.measuring = true; renderStage(); ui.measuring = false; return; }
    }
    if (fk) { var n = elStage.querySelector('[data-fk="' + fk + '"]'); if (n && !n.disabled) n.focus({ preventScroll: true }); }
    else if (ui.armed) { var c = elStage.querySelector('[data-fk="confirm"]'); if (c) c.focus({ preventScroll: true }); }
    tickClocks();
  }
  function renderPanic() {
    var old = elTop.querySelector(".armbar"); if (old) elTop.removeChild(old);
    if (!(ui.armed && ui.armed.key === "panic")) { elPanic.hidden = false; return; }
    var bar = h("div", "armbar"), ok = h("button", "btn danger go arm"); ok.type = "button"; ok.setAttribute("data-fk", "confirm");
    var col = h("span", "col"); col.appendChild(h("span", "", T.confirm + " · " + T.panic)); col.appendChild(h("span", "loss", T.panicLoss)); ok.appendChild(col);
    ok.addEventListener("click", function () { var run = ui.armed.run; clearTimeout(armTimer); ui.armed = null; run(); renderPanic(); renderStage(); });
    var un = h("button", "btn undo", T.undo); un.type = "button"; un.addEventListener("click", disarm);
    bar.appendChild(ok); bar.appendChild(un); elTop.appendChild(bar); ok.focus({ preventScroll: true });
  }
  elPanic.addEventListener("click", function () { arm("panic", function () { press("audience", "panic", {}, null); }, T.panicLoss, ""); });
  /* ───────── clocks ───────── */
  function tickClocks() {
    var cs = elStage.querySelectorAll("[data-until]"), now = Date.now() + skew, expired = false;
    for (var i = 0; i < cs.length; i++) {
      var u = cs[i].getAttribute("data-until"), f = cs[i].getAttribute("data-from");
      if (f) { var span = Date.parse(u) - Date.parse(f), done = span > 0 ? Math.min(1, Math.max(0, (now - Date.parse(f)) / span)) : 1; cs[i].style.width = Math.round((1 - done) * 100) + "%"; }
      else { cs[i].textContent = clock(u); var left = Date.parse(u) - now; if (left < 10000) cs[i].classList.add("end"); if (left <= 0) expired = true; }
    }
    return expired;
  }
  function loopClock() {
    if (!hidden) {
      var expired = tickClocks(); tickBadges();
      if (net === "offline") paintStrip();
      if (expired && !inflight) { delay = 800; refresh(); }
    }
    setTimeout(loopClock, 1000);
  }
  /* ───────── keyboard (desktop docks): one letter per action, shown as a hint on the button ───────── */
  function currentView() { var t = tabs.filter(function (x) { return x.id === sel; })[0]; return t && t.view ? t : null; }
  document.addEventListener("keydown", function (ev) {
    var tg = ev.target, tag = tg && tg.tagName;
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (ev.key === "Escape") { if (ui.armed) { ev.preventDefault(); disarm(); } else if (ui.sheet) { ui.sheet = null; renderStage(); } return; }
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    var k = String(ev.key || "").toUpperCase();
    if (ui.armed && (k === "ENTER" || k === "Y")) { var c = document.querySelector('[data-fk="confirm"]'); if (c && tg !== c) { ev.preventDefault(); c.click(); } return; }
    if (/^[1-9]$/.test(k) && Number(k) <= tabs.length) { ev.preventDefault(); pick(tabs[Number(k) - 1].id); return; }
    if (k === "S") { ev.preventDefault(); elPanic.click(); return; }
    var t = currentView(); if (!t || ui.sheet) return;
    var v = t.view, all = (v.stage === "idle" || ui.compose[t.id]) ? (v.chips || []) : [v.primary].concat(v.actions || [], [v.danger]);
    var hit = null;
    all.forEach(function (b) { if (b && !b.disabled && ((b.key && b.key === k) || (k === " " && b === v.primary))) hit = b; });
    if (hit) { if (tag === "BUTTON" && k === " ") return; ev.preventDefault(); runBtn(t, hit, null); }
  });
  document.addEventListener("focusin", function (ev) { var tg = ev.target; typing = !!(tg && /^(INPUT|SELECT)$/.test(tg.tagName) && elStage.contains(tg) && tg.type !== "radio"); });
  document.addEventListener("focusout", function () { setTimeout(function () { var a = document.activeElement; typing = !!(a && /^(INPUT|SELECT)$/.test(a.tagName) && elStage.contains(a) && a.type !== "radio"); if (!typing && dirty) { dirty = false; renderStage(); } }, 0); });
  window.addEventListener("resize", function () { var low = shortStage(); if (sel === "chat" || low !== ui.low) { ui.low = low; renderStage(); } });
  /* ───────── polling: planned AFTER each answer; slower when nothing changes; paused when hidden ───────── */
  function anyLive() { return tabs.some(function (t) { return t.view && t.view.stage === "live"; }); }
  function refresh() {
    clearTimeout(timer);
    if (inflight) { again = true; return; }   // an answer is on its way but may be older than what was just done: ask again as soon as it lands
    inflight = true;
    api(C.state + "&lang=" + encodeURIComponent(C.lang)).then(function (j) {
      if (j && j.ok) {
        skew = j.now - Date.now(); net = "online";
        var sig = JSON.stringify([j.panels, j.rooms]);
        if (!data || data.sig !== sig) {
          data = { panels: j.panels, rooms: j.rooms, sig: sig }; tabs = buildTabs();
          if (sel === null) sel = keep("ar-tab") || null;
          if (!tabs.some(function (t) { return t.id === sel; })) { var live = tabs.filter(function (t) { return t.view && t.view.stage === "live"; })[0]; sel = (live || tabs[0]).id; }
          tabs.forEach(function (t) { if (t.view) { var was = lastStage[t.id]; if (was && was !== t.view.stage) announce(t.label + ": " + (t.view.stage === "live" ? T.live : t.view.stage === "done" ? T.finished : "")); lastStage[t.id] = t.view.stage; } });
          paintTabs(); renderStage();
        }
        delay = anyLive() ? 2000 : 4000;
        paintStrip();
      } else if (j && j.status === 404) { net = "denied"; delay = 60000; paintStrip(); }
      else if (j && j.status === 429) { net = "online"; delay = 10000; }
      else throw new Error("state");
    }).catch(function () { net = "offline"; delay = Math.min(30000, Math.max(3000, delay * 2)); retryAt = Date.now() + delay; paintStrip(); })
      .then(function () { inflight = false; if (again) { again = false; refresh(); } else schedule(); });
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(function () { if (hidden) { schedule(); return; } refresh(); }, hidden ? 15000 : delay); }
  document.addEventListener("visibilitychange", function () { hidden = document.hidden; if (!hidden) { delay = 1500; refresh(); } });
  hidden = !!document.hidden;
  paintStrip(); loopClock(); refresh();
})();
`;
