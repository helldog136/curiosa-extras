/* Raid Twitch 2.2 : rafraîchit doucement la page publique « En direct chez nos membres ».
   La page est déjà complète sans ce script (écrite par le serveur). Ici : une lecture de /m/<clé>/members environ chaque minute, la mise à jour des seules valeurs qui
   changent (aucun clignotement, les cartes déjà là sont réutilisées : le focus reste en place), la dernière sélection connue gardée si Twitch ne répond pas, et le bouton
   « Afficher les aperçus » : les images de Twitch ne se chargent QU'APRÈS ce clic. Tout le texte vient de textContent (jamais de HTML) ; aucun cookie ; seul le stockage du
   navigateur retient le choix des aperçus. */
(function () {
  "use strict";
  var root = document.querySelector(".tr[data-src]");
  if (!root || !window.fetch) return;
  var d = root.dataset;
  var q = function (s) { return root.querySelector(s); };
  var grid = q(".tr-grid"), empty = q(".tr-empty:not(.tr-unavail)"), unavail = q(".tr-unavail"), loading = q(".tr-loading"), note = q(".tr-note"), live = q("#tr-changed");
  var tools = q(".tr-tools"), toggle = q(".tr-toggle"), hint = q(".tr-hint:not(.tr-loading)");
  var interval = Math.max(20000, Number(d.interval) || 60000);
  var thumbsAllowed = d.thumbs === "1";
  var st = { last: 0, ok: false, asOf: 0, signature: "", timer: null, busy: false, thumbsOn: false };
  try { st.thumbsOn = thumbsAllowed && localStorage.getItem("tr-thumbs") === "1"; } catch (e) { /* stockage indisponible : sans importance */ }

  function fmt(s, vars) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] !== undefined ? vars[k] : m; }); }
  function duration(ms) {
    var m = Math.floor(Math.max(0, Number(ms) || 0) / 60000);
    if (m < 1) return "< 1 min";
    if (m < 60) return m + " min";
    var mm = m % 60;
    return Math.floor(m / 60) + " h " + (mm < 10 ? "0" : "") + mm;
  }
  function clock(ms) { try { return new Date(ms).toLocaleTimeString(d.locale || undefined, { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
  function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  function makeCard(p) {
    var li = el("li", "tr-card"); li.dataset.login = p.login;
    var body = el("div", "tr-body");
    body.appendChild(el("h3", "tr-name"));
    var meta = el("p", "tr-meta"); ["tr-game", "tr-dur", "tr-viewers"].forEach(function (c) { meta.appendChild(el("span", c)); });
    body.appendChild(meta); body.appendChild(el("p", "tr-title"));
    li.appendChild(body);
    var a = el("a", "tr-btn"); a.target = "_blank"; a.rel = "noopener noreferrer";
    a.appendChild(document.createTextNode("")); a.appendChild(el("span", "tr-sr"));
    li.appendChild(a);
    return li;
  }
  function fillCard(li, p, now) {
    li.dataset.started = String(p.startedAt || 0);
    setText(li.querySelector(".tr-name"), p.name);
    setText(li.querySelector(".tr-game"), p.game || "");
    setText(li.querySelector(".tr-dur"), fmt(d.liveFor, { d: duration(now - p.startedAt) }));
    setText(li.querySelector(".tr-viewers"), fmt(p.viewers === 1 ? d.viewersOne : d.viewersOther, { n: p.viewers }));
    setText(li.querySelector(".tr-title"), p.title || "");
    var a = li.querySelector(".tr-btn");
    if (a.getAttribute("href") !== p.url) a.setAttribute("href", p.url);
    if (a.firstChild.nodeValue !== d.watch) a.firstChild.nodeValue = d.watch;
    setText(a.querySelector(".tr-sr"), " : " + p.name + " " + d.watchSr);
    var th = li.querySelector(".tr-thumb");
    if (thumbsAllowed && p.thumb) {
      if (!th) { th = el("div", "tr-thumb"); th.hidden = true; var img = el("img"); img.alt = ""; img.width = 320; img.height = 180; img.decoding = "async"; img.referrerPolicy = "no-referrer"; th.appendChild(img); li.insertBefore(th, li.firstChild); }
      var im = th.firstChild; if (im.getAttribute("data-src") !== p.thumb) { im.setAttribute("data-src", p.thumb); if (im.getAttribute("src")) im.setAttribute("src", p.thumb); }
    } else if (th) th.remove();
  }
  function applyThumbs() {
    var any = !!root.querySelector(".tr-thumb img");
    tools.hidden = !(thumbsAllowed && any);
    toggle.setAttribute("aria-pressed", st.thumbsOn ? "true" : "false");
    setText(toggle, st.thumbsOn ? d.thumbsHide : d.thumbsShow);
    hint.hidden = st.thumbsOn;
    root.querySelectorAll(".tr-thumb").forEach(function (box) {
      var img = box.firstChild;
      if (st.thumbsOn) { if (img.getAttribute("src") !== img.getAttribute("data-src")) img.setAttribute("src", img.getAttribute("data-src")); box.hidden = false; }
      else { img.removeAttribute("src"); box.hidden = true; }
    });
  }
  function show(which) {
    grid.hidden = which !== "list"; empty.hidden = which !== "empty"; unavail.hidden = which !== "unavailable"; loading.hidden = which !== "loading";
  }
  function render(list, now) {
    var seen = {};
    list.forEach(function (p, i) {
      var li = grid.querySelector('li[data-login="' + p.login + '"]');
      if (!li) li = makeCard(p);
      fillCard(li, p, now); seen[p.login] = 1;
      if (grid.children[i] !== li) grid.insertBefore(li, grid.children[i] || null);
    });
    Array.prototype.slice.call(grid.children).forEach(function (li) { if (!seen[li.dataset.login]) li.remove(); });
    applyThumbs();
  }
  function say(text) { if (note) { note.textContent = text || ""; note.hidden = !text; } }

  function apply(j) {
    var now = Date.now();
    if (j && j.state === "ok") {
      var sig = j.picks.map(function (p) { return p.login; }).join(",");
      render(j.picks, now);
      show(j.picks.length ? "list" : "empty");
      if (st.ok && st.signature !== sig && live) { live.textContent = ""; setTimeout(function () { live.textContent = d.changed; }, 50); }
      st.signature = sig; st.ok = true; st.asOf = j.asOf || now;
      say(j.stale ? fmt(d.stale, { time: clock(j.stale) }) : "");
      return true;
    }
    if (st.ok) { say(fmt(d.failed, { time: clock(st.asOf) })); return false; }   // on garde la dernière sélection connue à l'écran
    show("unavailable"); say("");
    return false;
  }
  function refresh() {
    if (st.busy) return; st.busy = true; st.last = Date.now();
    var ctl = new AbortController(), cut = setTimeout(function () { ctl.abort(); }, 15000);
    var lang = (document.documentElement.lang || d.locale || "").slice(0, 2);
    fetch(d.src + (lang ? "?lang=" + encodeURIComponent(lang) : ""), { signal: ctl.signal, credentials: "omit" })
      .then(function (r) { return r.json().then(function (j) { return r.ok ? j : null; }, function () { return null; }); })
      .catch(function () { return null; })
      .then(function (j) { clearTimeout(cut); st.busy = false; apply(j); schedule(); });
  }
  function schedule() { clearTimeout(st.timer); if (document.hidden) return; st.timer = setTimeout(refresh, interval + Math.floor(Math.random() * 5000)); }

  if (thumbsAllowed) {
    toggle.addEventListener("click", function () {
      st.thumbsOn = !st.thumbsOn;
      try { localStorage.setItem("tr-thumbs", st.thumbsOn ? "1" : "0"); } catch (e) { /* tant pis */ }
      applyThumbs();
    });
  }
  document.addEventListener("visibilitychange", function () { if (document.hidden) clearTimeout(st.timer); else if (Date.now() - st.last > interval) refresh(); else schedule(); });
  setInterval(function () { var now = Date.now(); root.querySelectorAll("li.tr-card").forEach(function (li) { setText(li.querySelector(".tr-dur"), fmt(d.liveFor, { d: duration(now - Number(li.dataset.started)) })); }); }, 30000);

  st.ok = !grid.hidden || !empty.hidden;   // la page est arrivée avec une sélection : c'est la dernière connue
  if (st.ok) { st.signature = Array.prototype.map.call(grid.children, function (li) { return li.dataset.login; }).join(","); st.asOf = Date.now(); }
  applyThumbs();
  if (!st.ok) refresh(); else schedule();
})();
