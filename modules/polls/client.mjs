// Sondages — petit script du navigateur des visiteurs (servi par la route « vp.js »).
// Il fait quatre choses : garder un code anonyme au hasard dans le navigateur (localStorage, jamais un cookie ; le même code que Participation, pour ne pas voter deux fois),
// envoyer le vote, remplacer la zone des résultats par ce que le site répond, et — pour la page « en cours » — compter à rebours et suivre le direct (avec Participation).
// Il ne charge rien d'extérieur ; ses mises à jour sont douces (planifiées APRÈS la réponse précédente) et se mettent en pause quand la page est cachée.
export const CLIENT_REV = 2;

export const CLIENT_JS = String.raw`(function () {
  "use strict";
  var els = document.querySelectorAll("[data-vp]");
  var cds = document.querySelectorAll("[data-vp-cd]");
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
  // Compte à rebours d'une manche : calculé depuis ce qu'il restait au moment où la page a été préparée (donc juste, même si l'horloge du téléphone est fausse).
  var now0 = Date.now(), reloading = false;
  function reloadSoon() { if (reloading) return; reloading = true; setTimeout(function () { window.location.reload(); }, 1000 + Math.floor(Math.random() * 4000)); }
  function mmss(ms) { var s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60); return (m < 10 ? "0" : "") + m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }
  function tickCd() {
    var alive = false;
    for (var q = 0; q < cds.length; q++) {
      var left = Number(cds[q].getAttribute("data-left")) - (Date.now() - now0);
      cds[q].textContent = mmss(left);
      if (left > 0) alive = true; else if (cds[q].getAttribute("data-reload")) reloadSoon();
    }
    if (alive && !document.hidden) setTimeout(tickCd, 1000);
  }
  if (cds.length) { tickCd(); document.addEventListener("visibilitychange", function () { if (!document.hidden) { tickCd(); } }); }
  if (!els.length && !document.querySelector("[data-vp-live]")) return;
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
  try { token = LS && (LS.getItem("aud-id") || LS.getItem("vp-id")); } catch (x) {}
  if (!token || !/^[A-Za-z0-9_-]{22,64}$/.test(token)) token = rnd();
  try { if (LS) { LS.setItem("vp-id", token); LS.setItem("aud-id", token); } } catch (x) {}
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
      if (j && j.html && res) { res.innerHTML = j.html; res.setAttribute("data-shown", "1"); res.setAttribute("data-mine", JSON.stringify(j.mine || [])); }
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

  // La page « en cours » avec Participation : les chiffres se mettent à jour tout seuls (sans rien redemander pour chaque voix), et la page se recharge quand la manche change.
  function bars(res, d, el) {
    var mine = []; try { mine = JSON.parse(res.getAttribute("data-mine") || "[]"); } catch (x) {}
    var closed = d.state === "closed";
    var frag = document.createDocumentFragment();
    var hint = document.createElement("p"); hint.className = "vp-hint";
    hint.textContent = el.getAttribute(closed ? "data-t-final" : "data-t-live") + " · " + el.getAttribute(d.voters === 1 ? "data-t-voters1" : "data-t-votersn").replace("{n}", d.voters);
    frag.appendChild(hint);
    var ol = document.createElement("ol"); ol.className = "vp-bars";
    for (var i = 0; i < d.rows.length; i++) {
      var r = d.rows[i];
      var li = document.createElement("li"); li.className = "vp-row" + (r.lead ? " vp-lead" : "");
      var line = document.createElement("div"); line.className = "vp-line";
      var lab = document.createElement("span"); lab.className = "vp-label"; lab.textContent = r.text; line.appendChild(lab);
      var num = document.createElement("span"); num.className = "vp-num";
      var st = document.createElement("strong"); st.textContent = r.pct + " %"; num.appendChild(st);
      num.appendChild(document.createTextNode(" · " + el.getAttribute(r.count === 1 ? "data-t-voice1" : "data-t-voicen").replace("{n}", r.count)));
      line.appendChild(num); li.appendChild(line);
      var track = document.createElement("div"); track.className = "vp-track"; track.setAttribute("aria-hidden", "true");
      var fill = document.createElement("div"); fill.className = "vp-fill"; fill.style.width = r.pct + "%"; track.appendChild(fill); li.appendChild(track);
      if (r.lead) { var tg = document.createElement("span"); tg.className = "vp-tag"; tg.textContent = el.getAttribute(closed ? "data-t-winner" : "data-t-leading"); li.appendChild(tg); }
      if (mine.indexOf(r.id) >= 0) { var my = document.createElement("span"); my.className = "vp-tag"; my.textContent = "✓ " + el.getAttribute("data-t-yours"); li.appendChild(my); }
      ol.appendChild(li);
    }
    frag.appendChild(ol);
    res.replaceChildren(frag);
  }
  function live(box) {
    if (!window.AudienceDirect) return;
    var cfg; try { cfg = JSON.parse(box.getAttribute("data-vp-live")); } catch (x) { return; }
    var el = box.querySelector("[data-vp]"), res = el ? el.querySelector("[data-vp-res]") : null;
    var dec = box.querySelector("[data-vp-decision]");
    window.AudienceDirect.watch({
      url: cfg.url, base: cfg.base, max: cfg.max,
      onData: function (d) {
        if (!d || d.empty || (d.slug || "") !== (cfg.slug || "") || (d.state === "closed") !== (cfg.state === "closed")) { if (cfg.slug || (d && d.slug)) reloadSoon(); }
        if (dec && d) {
          var w = d.decision;
          if (w && w.showUntil && Date.parse(w.showUntil) > Date.now()) { dec.textContent = (w.winner ? cfg.t.decided.replace("{winner}", w.winner) : cfg.t.nodecision) + (w.tie && w.tie.length > 1 ? " " + cfg.t.tie.replace("{list}", w.tie.join(", ")).replace("{winner}", w.winner || "") : ""); dec.hidden = false; }
          else dec.hidden = true;
        }
        if (el && res && d && d.rows && res.getAttribute("data-shown") === "1") bars(res, d, el);
        return d && d.state === "closed" ? 30000 : 0;
      },
      onEmpty: function () { if (cfg.slug) reloadSoon(); }
    });
  }
  var lives = document.querySelectorAll("[data-vp-live]");
  for (var l = 0; l < lives.length; l++) live(lives[l]);
})();
`;

/**
 * Script de la source navigateur OBS : une mise à jour douce, jamais de boucle serrée (voir README).
 * Il lit soit la route du module, soit le point de direct de Participation (réponse { ok, rev, data } / { ok, unchanged } / { ok, empty } et un conseil `next` pour ralentir) ;
 * si ce point de direct ne répond plus trois fois de suite, il retombe sur la route du module.
 */
export const OVERLAY_JS = String.raw`(function () {
  "use strict";
  var c = window.__VO;
  var box = document.getElementById("vo-box");
  var timer = null, clockTimer = null, rev = "", delay = c.base, errors = 0, skew = 0, url = c.url, cur = null;
  function el(tag, cls, text, part) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; if (part) n.setAttribute("data-ov-part", part); return n; }
  function now() { return Date.now() + skew; }
  function clock(ms) { var s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60); return (m < 10 ? "0" : "") + m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }
  function decisionNode(dec) {
    var n = el("div", "vo-decision", undefined, "decision");
    n.setAttribute("data-until", dec.showUntil || "");
    n.appendChild(el("p", "vo-dtitle", dec.winner ? c.t.decided : c.t.nodecision, "decision-title"));
    if (dec.winner) n.appendChild(el("p", "vo-dwin", dec.winner, "decision-winner"));
    if (dec.tie && dec.tie.length > 1) n.appendChild(el("p", "vo-dtie", c.t.tie.replace("{list}", dec.tie.join(", ")).replace("{winner}", dec.winner || ""), "decision-tie"));
    return n;
  }
  function render(d) {
    cur = d;
    // Dans une page d'overlay (c.el), tout est rangé dans un « corps » centré, et l'en-tête (état, question, pied) est regroupé : la mise en page change selon la taille du cadre (voir la feuille de style).
    if (d.kind === "decision") {
      var only = el("div", "vo-card", undefined, "panel");
      if (c.el) { var ob = el("div", "vo-body", undefined, "body"); ob.appendChild(decisionNode(d.decision)); only.appendChild(ob); } else only.appendChild(decisionNode(d.decision));
      box.replaceChildren(only); schedClock(); fit(); return;
    }
    var f = el("div", "vo-card" + (d.state === "closed" ? " closed" : ""), undefined, "panel");
    var body = c.el ? el("div", "vo-body", undefined, "body") : f;
    var side = c.el ? el("div", "vo-side", undefined, "summary") : f;
    var head = el("p", "vo-state", d.state === "closed" ? c.t.final : (d.quick ? c.t.quick : c.t.live), "status");
    if (d.round) head.appendChild(document.createTextNode(" · " + c.t.round + " " + d.round.n));
    if (d.endsAt && d.state === "open") { var clk = el("span", "vo-clock", clock(Date.parse(d.endsAt) - now()), "clock"); clk.setAttribute("data-end", d.endsAt); head.appendChild(clk); }
    side.appendChild(head);
    if (d.decision) side.appendChild(decisionNode(d.decision));
    side.appendChild(el("h1", "vo-q", d.question, "question"));
    var ol = el("ol", "vo-list", undefined, "choices"); if (c.el && d.rows.length > 4) { ol.setAttribute("data-many", "1"); body.setAttribute("data-many", "1"); }
    for (var i = 0; i < d.rows.length; i++) {
      var r = d.rows[i];
      var li = el("li", "vo-row" + (r.lead ? " lead" : ""), undefined, "choice"); if (r.lead) li.setAttribute("data-lead", "1");
      var line = el("div", "vo-line", undefined, "choice-line");
      line.appendChild(el("span", "vo-label", r.text, "choice-label"));
      var n = el("span", "vo-num", undefined, "choice-count");
      n.appendChild(el("strong", "", r.pct + " %"));
      n.appendChild(document.createTextNode(" · " + r.count + " " + (r.count === 1 ? c.t.one : c.t.many)));
      line.appendChild(n);
      li.appendChild(line);
      var track = el("div", "vo-track", undefined, "bar"); track.setAttribute("aria-hidden", "true");
      var fill = el("div", "vo-fill", undefined, "bar-fill"); fill.style.width = r.pct + "%";
      track.appendChild(fill); li.appendChild(track);
      if (r.lead) li.appendChild(el("span", "vo-tag", c.t.lead, "tag"));
      ol.appendChild(li);
    }
    if (!c.el) f.appendChild(ol);
    var foot = d.voters + " " + (d.voters === 1 ? c.t.person : c.t.people);
    if (d.endsAt && d.state === "open" && !d.round && !d.quick) {
      try { foot += " · " + c.t.ends + " " + new Date(d.endsAt).toLocaleString(c.lang, { weekday: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }); } catch (x) {}
    }
    (c.el ? side : f).appendChild(el("p", "vo-foot", foot, "foot"));
    if (c.el) { body.appendChild(side); body.appendChild(ol); f.appendChild(body); }
    box.replaceChildren(f);
    schedClock();
    fit();
  }
  // Le compte à rebours et la décision à l'écran se mettent à jour chez nous, sans rien demander au site ; la boucle s'arrête quand il n'y a plus rien à compter.
  function schedClock() { clearTimeout(clockTimer); if (box.querySelector("[data-end],[data-until]") && !document.hidden) clockTimer = setTimeout(tickClock, 1000); }
  function tickClock() {
    var ends = box.querySelectorAll("[data-end]");
    for (var i = 0; i < ends.length; i++) ends[i].textContent = clock(Date.parse(ends[i].getAttribute("data-end")) - now());
    var decs = box.querySelectorAll("[data-until]");
    for (var j = 0; j < decs.length; j++) {
      var u = Date.parse(decs[j].getAttribute("data-until"));
      if (u && now() >= u) { if (cur && cur.kind === "decision") box.replaceChildren(); else decs[j].remove(); }
    }
    schedClock();
  }
  // Dans une page d'overlay (élément « fluide ») : la police s'ajuste à la taille réelle du cadre, de façon que rien ne déborde (recherche entre 9 et 44 px).
  function fit() {
    if (!c.el) return;
    var p = box.firstElementChild, b = p && p.firstElementChild;
    if (!b) return;
    var lo = 10, hi = 44;
    for (var i = 0; i < 7; i++) {
      var mid = (lo + hi) / 2;
      box.style.setProperty("--vo-fs", mid + "px");
      // l'espace disponible est relu à CHAQUE essai : les marges de la carte sont en « em », elles changent avec la taille de la police
      var cs = getComputedStyle(p), w = p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h = p.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (b.offsetHeight <= h + 1 && b.scrollWidth <= w + 1) lo = mid; else hi = mid;
    }
    box.style.setProperty("--vo-fs", lo + "px");
  }
  if (c.el) addEventListener("resize", function () { fit(); });
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(tick, ms); }
  function tick() {
    if (document.hidden) { schedule(c.base * 4); return; }
    fetch(url + (url.indexOf("?") < 0 ? "?" : "&") + "rev=" + encodeURIComponent(rev), { cache: "no-store", credentials: "omit", signal: (typeof AbortSignal !== "undefined" && AbortSignal.timeout) ? AbortSignal.timeout(15000) : undefined })
      .then(function (r) {
        var h = r.headers.get("date"), t = h ? Date.parse(h) : NaN;
        if (!isNaN(t)) skew = t - Date.now();
        if (!r.ok) throw new Error("http");
        return r.json();
      })
      .then(function (j) {
        errors = 0;
        var d = j && j.data ? j.data : j;
        if ((j && j.empty) || (d && d.empty)) { box.replaceChildren(); rev = ""; cur = null; delay = Math.min(c.max, Math.max(delay, c.base) * 2); }
        else if (j && j.unchanged) { delay = Math.min(c.max, Math.round(delay * 1.5)); }
        else { rev = String(j.rev !== undefined ? j.rev : d.rev); render(d); delay = c.base; }
        if (d && d.state === "closed") delay = Math.max(delay, 30000);
        if (j && j.next) delay = Math.max(delay, Math.min(60000, j.next));
      })
      .catch(function () {
        errors++; delay = Math.min(60000, Math.max(delay, c.base) * 2);
        if (errors >= 3 && c.alt && url !== c.alt) { url = c.alt; rev = ""; errors = 0; delay = c.base; }
      })
      .then(function () { schedule(delay); });
  }
  if (c.demo) { render(c.demo); return; }   // mode test d'une page d'overlay : un sondage d'exemple, rien n'est demandé au site
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { schedule(300); schedClock(); } });
  tick();
})();
`;
