// Participation — petits scripts du navigateur (servis par les routes du module ; aucun n'est chargé d'ailleurs).
//  - DIRECT_JS  : la mise à jour « en direct » douce et ralentissante, que les autres modules intègrent à leurs pages et à leurs overlays.
//  - CLIENT_JS  : le code anonyme au hasard du navigateur (stockage local, jamais un cookie) et la page « Mon pseudo ».
//  - REMOTE_JS  : la télécommande (grands boutons pour le téléphone, ou présentation « dock » étroite pour OBS : le même script, `window.__AR.dock` choisit les phrases).
// Aucun n'a de boucle serrée : chaque interrogation est planifiée APRÈS la réponse de la précédente, et se met en pause quand la page est cachée.
export const CLIENT_REV = 1;

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
  if (!els.length) return;
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
})();
`;

/** La télécommande. Configuration dans window.__AR : { state, press, lang, base, t: { textes } }. */
export const REMOTE_JS = String.raw`(function () {
  "use strict";
  var C = window.__AR;
  var root = document.getElementById("ar-root");
  var toast = document.getElementById("ar-toast");
  var live = document.getElementById("ar-live");
  var data = null, timer = null, delay = 4000, inflight = false, skew = 0, armed = null, armTimer = null, seq = 0, pendingFk = null;
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function signal() { try { return typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined; } catch (x) { return undefined; } }
  function say(text, bad) { toast.textContent = text || ""; toast.className = "ar-toast" + (bad ? " bad" : ""); toast.hidden = !text; }
  function clock(until) {
    var ms = Date.parse(until) - (Date.now() + skew);
    if (!(ms > 0)) return "00:00";
    var s = Math.round(ms / 1000), m = Math.floor(s / 60);
    return (m < 10 ? "0" : "") + m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }
  function api(path, body) {
    var init = body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store", credentials: "omit", signal: signal() } : { cache: "no-store", credentials: "omit", signal: signal() };
    return fetch(path, init).then(function (r) { return r.json().then(function (j) { j.status = r.status; return j; }, function () { return { ok: false, "error": "net", status: r.status }; }); });
  }
  // Au clavier, la page se redessine sous les doigts : on retrouve le bouton qui avait le focus grâce à son repère (data-fk).
  function fk(n, key) { n.setAttribute("data-fk", key); return n; }
  function focusFk(key) { if (!key) return; var n = root.querySelector('[data-fk="' + key + '"]'); if (n && !n.disabled) n.focus({ preventScroll: true }); }
  function press(panel, action, values, btn, label) {
    if (btn.disabled) return;
    var hadFocus = document.activeElement === btn, key = btn.getAttribute("data-fk");
    if (hadFocus) pendingFk = key;
    btn.disabled = true; btn.setAttribute("aria-busy", "true");
    var old = btn.textContent; btn.textContent = C.t.busy;
    say("");
    api(C.press, { k: C.k, panel: panel, action: action, values: values || {} }).then(function (j) {
      if (j && j.ok) { say(j.message || C.t.done, false); delay = 4000; refresh(); }
      else { say((j && j.message) || C.t["e_" + ((j && j.error) || "net")] || C.t.e_net, true); if (j && j.field) fieldError(panel, j.field, j.message); }
    }, function () { say(C.t.e_net, true); }).then(function () {
      btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = old;
      if (hadFocus) { if (document.body.contains(btn)) btn.focus({ preventScroll: true }); else focusFk(key); }
      pendingFk = null;
    });
  }
  function fieldError(panel, field, message) {
    var n = root.querySelector('[data-err="' + panel + ":" + field + '"]');
    if (n) { n.textContent = message || ""; n.hidden = !message; var i = root.querySelector('[data-in="' + panel + ":" + field + '"]'); if (i) { i.setAttribute("aria-invalid", "true"); i.focus(); } }
  }
  function disarm() { if (armed) { armed.btn.textContent = armed.label; armed.btn.classList.remove("armed"); armed = null; } clearTimeout(armTimer); }
  function button(panel, b) {
    var n = fk(el("button", "ar-btn " + (b.tone || "plain"), b.label), "b:" + (panel.provider || panel.id) + ":" + b.id);
    n.type = "button";
    if (b.disabled) n.disabled = true;
    n.addEventListener("click", function () {
      if (b.confirm && !(armed && armed.btn === n)) {
        disarm();
        armed = { btn: n, label: b.label };
        n.textContent = b.confirm + " — " + C.t.again;
        n.classList.add("armed");
        armTimer = setTimeout(disarm, 5000);
        return;
      }
      disarm();
      press(panel.provider || panel.id, b.id, {}, n);
    });
    return n;
  }
  function form(panel, f) {
    var box = el("form", "ar-form"); box.noValidate = true;
    box.appendChild(el("h3", "ar-h3", f.title));
    var hint = f.fields.length ? null : null;
    f.fields.forEach(function (fd) {
      var id = "f" + (++seq);
      var wrap = el("div", "ar-field");
      var lab = el("label", "", fd.label); lab.setAttribute("for", id);
      wrap.appendChild(lab);
      var input;
      if (fd.type === "select") {
        input = el("select", "ar-in");
        fd.options.forEach(function (o) { var op = el("option", "", o.label); op.value = o.value; if (o.value === fd.value) op.selected = true; input.appendChild(op); });
      } else {
        input = el("input", "ar-in");
        input.type = fd.type === "number" ? "number" : "text";
        if (fd.type === "number") input.inputMode = "numeric"; else input.maxLength = fd.max || 60;
        input.autocomplete = "off"; input.autocapitalize = "off"; input.spellcheck = false;
        if (fd.placeholder) input.placeholder = fd.placeholder;
        if (fd.value) input.value = fd.value;
      }
      input.id = id; input.name = fd.name; input.setAttribute("data-in", (panel.provider || panel.id) + ":" + fd.name);
      wrap.appendChild(input);
      var er = el("p", "ar-err"); er.hidden = true; er.setAttribute("role", "alert"); er.setAttribute("data-err", (panel.provider || panel.id) + ":" + fd.name); er.id = id + "e";
      input.setAttribute("aria-describedby", er.id);
      wrap.appendChild(er);
      box.appendChild(wrap);
    });
    var go = fk(el("button", "ar-btn primary", f.submit), "f:" + (panel.provider || panel.id) + ":" + f.id); go.type = "submit";
    box.appendChild(go);
    box.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var values = {}, ins = box.querySelectorAll("input,select");
      for (var i = 0; i < ins.length; i++) { values[ins[i].name] = ins[i].value; ins[i].removeAttribute("aria-invalid"); }
      var errs = box.querySelectorAll(".ar-err"); for (var e = 0; e < errs.length; e++) errs[e].hidden = true;
      press(panel.provider || panel.id, f.id, values, go);
    });
    return box;
  }
  function draw() {
    var keepOpen = {};
    var opened = root.querySelectorAll("details[open]"); for (var o = 0; o < opened.length; o++) keepOpen[opened[o].getAttribute("data-id")] = true;
    var typing = document.activeElement && root.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName);
    if (typing) return;   // jamais de redessin pendant que la personne écrit
    var focusKey = document.activeElement && root.contains(document.activeElement) ? document.activeElement.getAttribute("data-fk") : pendingFk;
    var frag = document.createDocumentFragment();
    if (!data.panels.length) {
      var empty = el("section", "ar-card"); empty.appendChild(el("p", "ar-muted", C.t.nopanels)); frag.appendChild(empty);
    }
    data.panels.forEach(function (p) {
      var card = el("section", "ar-card");
      card.appendChild(el("h2", "ar-h2", p.title));
      if (p.state) {
        var st = el("p", "ar-state " + (p.state.tone || "idle"));
        st.appendChild(document.createTextNode(p.state.text));
        if (p.state.until) { var cd = el("strong", "ar-clock", clock(p.state.until)); cd.setAttribute("data-until", p.state.until); st.appendChild(document.createTextNode(" ")); st.appendChild(cd); }
        card.appendChild(st);
      }
      if (p.buttons.length) { var row = el("div", "ar-row"); p.buttons.forEach(function (b) { row.appendChild(button(p, b)); }); card.appendChild(row); }
      p.forms.forEach(function (f) { card.appendChild(form(p, f)); });
      frag.appendChild(card);
    });
    var mod = el("section", "ar-card");
    mod.appendChild(el("h2", "ar-h2", C.t.rooms));
    if (!data.rooms.length) mod.appendChild(el("p", "ar-muted", C.t.noRooms));
    data.rooms.forEach(function (r) {
      var d = el("details", "ar-room"); d.setAttribute("data-id", r.key); if (keepOpen[r.key]) d.open = true;
      var sum = fk(el("summary", "", r.label + " · " + r.count + " " + (r.count === 1 ? C.t.person : C.t.people)), "r:" + r.key);
      d.appendChild(sum);
      if (!r.recent.length) d.appendChild(el("p", "ar-muted", C.t.noOne));
      r.recent.forEach(function (m) {
        var line = el("div", "ar-person");
        line.appendChild(el("span", "ar-name" + (m.muted ? " muted" : ""), (m.pseudo || C.t.anon) + (m.muted ? " · " + C.t.mutedTag : "")));
        var b = fk(el("button", "ar-mini", m.muted ? C.t.unmute : C.t.mute), "m:" + r.key + ":" + m.id); b.type = "button";
        b.addEventListener("click", function () { press("audience", "mute", { room: r.key, id: m.id, muted: m.muted ? "0" : "1" }, b); });
        line.appendChild(b);
        d.appendChild(line);
      });
      var clear = fk(el("button", "ar-btn danger", C.t.clear), "c:" + r.key); clear.type = "button";
      clear.addEventListener("click", function () {
        if (!(armed && armed.btn === clear)) { disarm(); armed = { btn: clear, label: C.t.clear }; clear.textContent = C.t.clearConfirm + " — " + C.t.again; clear.classList.add("armed"); armTimer = setTimeout(disarm, 5000); return; }
        disarm(); press("audience", "clear", { room: r.key }, clear);
      });
      d.appendChild(clear);
      mod.appendChild(d);
    });
    frag.appendChild(mod);
    root.replaceChildren(frag);
    armed = null;
    focusFk(focusKey);
  }
  function tickClock() {
    if (!document.hidden) { var cs = root.querySelectorAll("[data-until]"); for (var i = 0; i < cs.length; i++) cs[i].textContent = clock(cs[i].getAttribute("data-until")); }
    setTimeout(tickClock, 1000);
  }
  function refresh() {
    clearTimeout(timer);
    if (inflight) return;
    inflight = true;
    api(C.state + "&lang=" + encodeURIComponent(C.lang)).then(function (j) {
      if (j && j.ok) {
        skew = j.now - Date.now();
        var sig = JSON.stringify(j.panels) + JSON.stringify(j.rooms);
        if (!data || data.sig !== sig) { data = { panels: j.panels, rooms: j.rooms, sig: sig }; delay = 4000; draw(); } else delay = Math.min(15000, Math.round(delay * 1.4));
        live.textContent = C.t.connected; live.className = "ar-dot ok";
      } else if (j && j.status === 404) { live.textContent = C.t.denied; live.className = "ar-dot bad"; delay = 60000; }
      else throw new Error("state");
    }).catch(function () { live.textContent = C.t.offline; live.className = "ar-dot bad"; delay = Math.min(30000, delay * 2); })
      .then(function () { inflight = false; schedule(); });
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(function () { if (document.hidden) { schedule(); return; } refresh(); }, document.hidden ? 15000 : delay); }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { delay = 4000; refresh(); } });
  tickClock();
  refresh();
})();
`;
