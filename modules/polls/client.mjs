// Sondages — petit script du navigateur des visiteurs (servi par la route « vp.js »).
// Il fait trois choses : garder un code anonyme au hasard dans le navigateur (localStorage, jamais un cookie), envoyer le vote, et
// remplacer la zone des résultats par ce que le site répond. Il ne charge rien d'extérieur et ne fait aucune boucle.
export const CLIENT_REV = 1;

export const CLIENT_JS = String.raw`(function () {
  "use strict";
  var els = document.querySelectorAll("[data-vp]");
  var ends = document.querySelectorAll("time[data-vp-end]");
  for (var e = 0; e < ends.length; e++) {
    try {
      var t = ends[e], d = new Date(t.getAttribute("datetime"));
      var slot = t.parentNode && t.parentNode.querySelector("[data-vp-local]");
      if (slot && !isNaN(d.getTime())) {
        slot.textContent = " · " + (t.getAttribute("data-label") || "") + d.toLocaleString(document.documentElement.lang || undefined, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
        slot.hidden = false;
      }
    } catch (x) {}
  }
  if (!els.length) return;
  var LS = null;
  try { LS = window.localStorage; } catch (x) { LS = null; }
  function rnd() {
    var b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    var s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  var token = null;
  try { token = LS && LS.getItem("vp-id"); } catch (x) {}
  if (!token || !/^[A-Za-z0-9_-]{22,64}$/.test(token)) {
    token = rnd();
    try { if (LS) LS.setItem("vp-id", token); } catch (x) {}
  }
  function doneMap() { try { return JSON.parse((LS && LS.getItem("vp-done")) || "{}") || {}; } catch (x) { return {}; } }
  function markDone(id) {
    var m = doneMap(); m[id] = Date.now();
    var k = Object.keys(m);
    if (k.length > 100) { k.sort(function (a, b) { return m[a] - m[b]; }); for (var i = 0; i < k.length - 100; i++) delete m[k[i]]; }
    try { if (LS) LS.setItem("vp-done", JSON.stringify(m)); } catch (x) {}
  }
  function timeoutSignal() { try { return typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined; } catch (x) { return undefined; } }
  function post(el, path, body) {
    var url = el.getAttribute("data-api") + "/" + path + "?lang=" + encodeURIComponent(el.getAttribute("data-lang") || "");
    return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "omit", signal: timeoutSignal() })
      .then(function (r) { return r.json().then(function (j) { j.status = r.status; return j; }, function () { return { ok: false, reason: "net", status: r.status }; }); });
  }
  function msg(el, code) { return el.getAttribute("data-m-" + code) || el.getAttribute("data-m-net") || ""; }

  function init(el) {
    var slug = el.getAttribute("data-poll");
    var form = el.querySelector("[data-vp-form]");
    var res = el.querySelector("[data-vp-res]");
    var err = el.querySelector("[data-vp-err]");
    var ok = el.querySelector("[data-vp-ok]");
    if (!form) return;
    var btn = form.querySelector("button[type=submit]");
    var max = parseInt(el.getAttribute("data-max") || "1", 10) || 1;
    function say(node, text) { if (node) { node.textContent = text || ""; node.hidden = !text; } }
    function showResults(j) {
      if (j && j.html && res) res.innerHTML = j.html;
      form.hidden = true;
    }
    function ask() {
      return post(el, "results", { poll: slug, t: token }).then(function (j) {
        if (j && j.ok) { showResults(j); return true; }
        return false;
      }, function () { return false; });
    }
    function reveal() { form.hidden = false; }
    if (doneMap()[slug]) { ask().then(function (shown) { if (!shown) reveal(); }); } else { reveal(); }

    var boxes = form.querySelectorAll("input[name=c]");
    function limit() {
      if (max <= 1) return;
      var n = 0, i;
      for (i = 0; i < boxes.length; i++) if (boxes[i].checked) n++;
      for (i = 0; i < boxes.length; i++) boxes[i].disabled = n >= max && !boxes[i].checked;
    }
    for (var b = 0; b < boxes.length; b++) boxes[b].addEventListener("change", function () { say(err, ""); limit(); });

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (btn && btn.disabled) return;
      var picked = [];
      for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) picked.push(boxes[i].value);
      if (!picked.length) { say(err, msg(el, "pick")); return; }
      say(err, "");
      var label = btn ? btn.textContent : "";
      if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = el.getAttribute("data-m-busy") || label; }
      var hp = form.querySelector("input[name=website]");
      post(el, "vote", { poll: slug, t: token, c: picked, website: hp ? hp.value : "" }).then(function (j) {
        if (j && j.ok) { markDone(slug); showResults(j); say(ok, msg(el, "thanks")); return; }
        var code = (j && j.reason) || "net";
        if (code === "already") { markDone(slug); ask().then(function (shown) { if (!shown) say(err, msg(el, "already")); else say(ok, msg(el, "already")); }); return; }
        say(err, msg(el, code));
      }, function () { say(err, msg(el, "net")); }).then(function () {
        if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = label; }
      });
    });
  }
  for (var i = 0; i < els.length; i++) init(els[i]);
})();
`;

/** Script de la source navigateur OBS : une mise à jour douce, jamais de boucle serrée (voir README). */
export const OVERLAY_JS = String.raw`(function () {
  "use strict";
  var c = window.__VO;
  var box = document.getElementById("vo-box");
  var timer = null, rev = "", delay = c.base, errors = 0;
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function render(d) {
    var f = el("div", "vo-card" + (d.state === "closed" ? " closed" : ""));
    f.appendChild(el("p", "vo-state", d.state === "closed" ? c.t.final : c.t.live));
    f.appendChild(el("h1", "vo-q", d.question));
    var ol = el("ol", "vo-list");
    for (var i = 0; i < d.rows.length; i++) {
      var r = d.rows[i];
      var li = el("li", "vo-row" + (r.lead ? " lead" : ""));
      var line = el("div", "vo-line");
      line.appendChild(el("span", "vo-label", r.text));
      var n = el("span", "vo-num");
      n.appendChild(el("strong", "", r.pct + " %"));
      n.appendChild(document.createTextNode(" · " + r.count + " " + (r.count === 1 ? c.t.one : c.t.many)));
      line.appendChild(n);
      li.appendChild(line);
      var track = el("div", "vo-track"); track.setAttribute("aria-hidden", "true");
      var fill = el("div", "vo-fill"); fill.style.width = r.pct + "%";
      track.appendChild(fill); li.appendChild(track);
      if (r.lead) li.appendChild(el("span", "vo-tag", c.t.lead));
      ol.appendChild(li);
    }
    f.appendChild(ol);
    var foot = d.voters + " " + (d.voters === 1 ? c.t.person : c.t.people);
    if (d.endsAt && d.state === "open") {
      try { foot += " · " + c.t.ends + " " + new Date(d.endsAt).toLocaleString(c.lang, { weekday: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }); } catch (x) {}
    }
    f.appendChild(el("p", "vo-foot", foot));
    box.replaceChildren(f);
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(tick, ms); }
  function tick() {
    if (document.hidden) { schedule(c.base * 4); return; }
    fetch(c.url + "&rev=" + encodeURIComponent(rev), { cache: "no-store", credentials: "omit", signal: (typeof AbortSignal !== "undefined" && AbortSignal.timeout) ? AbortSignal.timeout(15000) : undefined })
      .then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); })
      .then(function (d) {
        errors = 0;
        if (d.empty) { box.replaceChildren(); rev = ""; delay = Math.min(c.max, Math.max(delay, c.base) * 2); return; }
        if (d.unchanged) { delay = Math.min(c.max, Math.round(delay * 1.5)); }
        else { rev = d.rev; render(d); delay = c.base; }
        if (d.state === "closed") delay = Math.max(delay, 30000);
      })
      .catch(function () { errors++; delay = Math.min(60000, Math.max(delay, c.base) * 2); })
      .then(function () { schedule(delay); });
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) schedule(300); });
  tick();
})();
`;
