/* Carte : le comportement de la page (le moteur de carte est dans map-engine.js).
 * Tout ce qui est ajouté ici est du confort : la liste des lieux marche sans ce script.
 *  - « Afficher la carte » : AUCUNE requête vers le serveur de fonds de carte avant ce clic ;
 *  - « Près de moi » : la position vient du navigateur après un clic, reste dans cette page (une variable), n'est ni envoyée ni gardée ;
 *  - recherche dans la liste sans recharger la page ; fiche d'un lieu sous la carte.
 * Les textes viennent de la page (attribut data-cfg) : ce fichier n'en contient aucun. Rien de ce qui vient du serveur n'est inséré autrement qu'en texte,
 * sauf les fiches et la liste, que le serveur a déjà échappées. */
(function () {
  "use strict";
  var w = window, D = document, CM = w.CuriosaMap;
  if (!CM || w.__cmPage) return;
  w.__cmPage = 1;

  function one(sel, el) { return (el || D).querySelector(sel); }
  function all(sel, el) { return Array.prototype.slice.call((el || D).querySelectorAll(sel)); }
  function fmt(s, o) { return String(s == null ? "" : s).replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] !== undefined ? o[k] : m; }); }
  function text(el, v) { if (el) el.textContent = v || ""; }
  function mk(tag, cls, txt) { var e = D.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  function num(v) { var n = Number(String(v == null ? "" : v).trim().replace(",", ".")); return String(v).trim() === "" || !isFinite(n) ? null : n; }
  function reveal(scope) { all(".cm-js", scope).forEach(function (n) { n.hidden = false; }); }
  function getJson(url) {
    if (!w.fetch) return Promise.reject(new Error("no fetch"));
    return w.fetch(url, { credentials: "same-origin", headers: { accept: "application/json" } }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    });
  }

  function start(root) {
    var cfg;
    try { cfg = JSON.parse(root.getAttribute("data-cfg") || "{}"); } catch (e) { return; }
    var T = cfg.t || {}, urls = cfg.urls || {}, key = cfg.key || "";
    reveal(root);

    var showBtn = one("[data-cm-show]", root), mapbox = one("[data-cm-mapbox]", root), mapEl = one("[data-cm-map]", root), mapStatus = one("[data-cm-mapstatus]", root);
    var fiche = one("[data-cm-fiche]", root), nearBtn = one("[data-cm-near]", root), nearBox = one("[data-cm-nearbox]", root);
    var qInput = one("[data-cm-q]", root);
    var P = null, byCode = {}, types = [], loading = null, map = null, shown = false, wantQ = qInput && qInput.value ? qInput.value.trim() : "";

    // ── Les points (une seule requête vers NOTRE serveur, et seulement quand on en a besoin) ──────────────────────────
    function pointsUrl() { return urls.points.replace(/&q=[^&]*/, "") + (wantQ ? "&q=" + encodeURIComponent(wantQ) : ""); }
    function loadPoints() {
      if (P) return Promise.resolve(P);
      if (loading) return loading;
      loading = getJson(pointsUrl()).then(function (j) {
        if (!j || !j.ok || !Array.isArray(j.pts)) throw new Error("bad");
        types = j.types || [];
        // [lat, lng, code, type, nom, venu d'ailleurs ?] : lat et lng d'abord, comme le moteur les attend
        P = j.pts.map(function (p) { return [p[1], p[2], p[0], p[3], p[4], p[5]]; });
        byCode = {}; P.forEach(function (p, i) { byCode[p[2]] = i; });
        loading = null;
        return P;
      }, function (e) { loading = null; throw e; });
      return loading;
    }

    // ── La fiche d'un lieu ────────────────────────────────────────────────────────────────────────────────────────────
    function closeFiche() { if (fiche) { fiche.hidden = true; fiche.textContent = ""; } if (map) map.select(-1); }
    function showFiche(code) {
      if (!fiche) return;
      return getJson(urls.place + encodeURIComponent(code)).then(function (j) {
        if (!j || !j.ok) throw new Error("none");
        fiche.innerHTML = j.html; // HTML déjà échappé par le serveur
        reveal(fiche);
        var x = mk("button", "cm-btn", T.close); x.type = "button"; x.setAttribute("data-cm-close", ""); fiche.appendChild(x);
        fiche.hidden = false;
        var h = one("[data-cm-focus]", fiche); if (h && h.focus) h.focus();
      }, function () { fiche.hidden = false; text(fiche, T.loadFailed); });
    }
    function showGroup(ids) {
      if (!fiche) return;
      fiche.textContent = "";
      var h = mk("h2", "cm-h", fmt(T.group, { n: ids.length })); h.tabIndex = -1; fiche.appendChild(h);
      var ul = mk("ul", "cm-results");
      ids.slice(0, 50).forEach(function (i) { var li = mk("li"), b = mk("button", "", P[i][4]); b.type = "button"; b.setAttribute("data-cm-pick", P[i][2]); li.appendChild(b); ul.appendChild(li); });
      fiche.appendChild(ul); fiche.hidden = false; h.focus();
    }
    function pick(code, fromMap) {
      var i = byCode[code];
      if (map && i !== undefined) { map.select(i); if (!fromMap) map.setView(P[i][0], P[i][1], Math.max(map.state().zoom, 15)); }
      return showFiche(code);
    }

    // ── La carte (créée seulement après le clic) ──────────────────────────────────────────────────────────────────────
    function symbol(i) { var t = types[P[i][3]]; return (t && t[2]) || "•"; }
    function label(i) { var t = types[P[i][3]]; return P[i][4] + (t ? " — " + t[1] : ""); }
    var origin = null, originName = "", limit = 50;
    function fitAround() {
      if (!map || !origin) return;
      var radius = Number(radiusSel && radiusSel.value) || 20, near = CM.within(P, origin.lat, origin.lng, radius).slice(0, 20).map(function (x) { return P[x.i]; });
      map.fitAll(near.concat([[origin.lat, origin.lng]]));
    }
    function openMap(focus) {
      if (!mapbox || !mapEl) return Promise.resolve();
      shown = true;
      mapbox.hidden = false; showBtn.setAttribute("aria-expanded", "true"); text(showBtn, T.hideMap);
      text(mapStatus, T.mapLoading);
      return loadPoints().then(function () {
        if (!shown) return;
        text(mapStatus, "");
        if (!map) {
          mapEl.id = mapEl.id || "cm-map-" + key;
          map = CM.createMap(mapEl, {
            tiles: cfg.tiles, maxZoom: cfg.maxZoom, points: P, label: label, symbol: symbol,
            onSelect: function (i) { pick(P[i][2], true); },
            onGroup: showGroup,
            onTileError: function () { text(mapStatus, T.tilesFailed); },
            t: { zoomIn: T.zoomIn, zoomOut: T.zoomOut, map: T.mapLabel, help: T.mapHelp, attr: T.attr, group: function (n) { return fmt(T.group, { n: n }); }, you: T.you },
          });
        }
        if (origin) map.setUser(origin.lat, origin.lng);
        if (focus !== undefined && byCode[focus] !== undefined) { var i = byCode[focus]; map.setView(P[i][0], P[i][1], 15); map.select(i); }
        else if (origin) fitAround();
        else if (P.length) map.fitAll(); else text(mapStatus, T.noPoints);
      }, function () { text(mapStatus, T.mapFailed); });
    }
    function closeMap() {
      shown = false;
      if (map) { map.destroy(); map = null; }
      mapbox.hidden = true; showBtn.setAttribute("aria-expanded", "false"); text(showBtn, T.showMap); text(mapStatus, "");
    }
    if (showBtn) showBtn.addEventListener("click", function () { if (shown) { closeMap(); showBtn.focus(); } else openMap(cfg.focus); });
    if (cfg.focus && D.location && /#map$/.test(D.location.hash || "")) openMap(cfg.focus);

    // ── Près de moi ───────────────────────────────────────────────────────────────────────────────────────────────────
    var nearStatus = nearBox && one("[data-cm-nearstatus]", nearBox), radiusBox = nearBox && one("[data-cm-radiusbox]", nearBox), radiusSel = nearBox && one("[data-cm-radius]", nearBox);
    var results = nearBox && one("[data-cm-results]", nearBox), moreBtn = nearBox && one("[data-cm-more]", nearBox), fallback = nearBox && one("[data-cm-fallback]", nearBox);
    function renderNear() {
      if (!origin || !P) return;
      var radius = Number(radiusSel.value) || 20, list = CM.within(P, origin.lat, origin.lng, radius);
      results.textContent = "";
      list.slice(0, limit).forEach(function (x) {
        var li = mk("li"), b = mk("button", "", P[x.i][4]); b.type = "button"; b.setAttribute("data-cm-pick", P[x.i][2]);
        li.appendChild(b); li.appendChild(mk("span", "cm-dist", CM.formatDistance(x.d, cfg.locale))); results.appendChild(li);
      });
      moreBtn.hidden = list.length <= limit;
      if (list.length) text(nearStatus, fmt(T.nearFound, { count: list.length + " " + (list.length === 1 ? T.wordOne : T.wordMany), radius: radius, from: originName }));
      else {
        var every = CM.within(P, origin.lat, origin.lng), first = every[0];
        text(nearStatus, fmt(T.nearNone, { radius: radius, from: originName }) + (first ? " " + fmt(T.nearNoneAt, { distance: CM.formatDistance(first.d, cfg.locale), name: P[first.i][4] }) : ""));
      }
    }
    function setOrigin(lat, lng, name) {
      origin = { lat: lat, lng: lng }; originName = name; limit = 50; // la position reste ici, dans cette variable : ni envoyée, ni stockée
      radiusBox.hidden = false;
      if (map) map.setUser(lat, lng);
      renderNear();
      if (map) fitAround();
    }
    function nearFail(code) {
      nearBtn.disabled = false;
      text(nearStatus, code === 1 ? T.nearDenied : T.nearUnavailable);
      if (fallback) fallback.hidden = false;
    }
    if (nearBtn && nearBox) {
      nearBtn.addEventListener("click", function () {
        nearBox.hidden = false;
        var h = one("h2", nearBox); if (h && h.focus) h.focus();
        text(nearStatus, T.nearSearching);
        var pointsReady = loadPoints();
        if (!w.navigator || !w.navigator.geolocation) { pointsReady.then(function () { nearFail(0); }, function () { text(nearStatus, T.loadFailed); }); return; }
        nearBtn.disabled = true;
        w.navigator.geolocation.getCurrentPosition(function (pos) {
          pointsReady.then(function () { nearBtn.disabled = false; if (fallback) fallback.hidden = true; setOrigin(pos.coords.latitude, pos.coords.longitude, T.fromHere); },
            function () { nearBtn.disabled = false; text(nearStatus, T.loadFailed); });
        }, function (err) { nearFail(err && err.code); }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
      });
      if (radiusSel) radiusSel.addEventListener("change", function () { limit = 50; renderNear(); if (map) fitAround(); });
      if (moreBtn) moreBtn.addEventListener("click", function () { limit += 50; renderNear(); });
      var cityBtn = one("[data-cm-usecity]", nearBox), citySel = one("[data-cm-city]", nearBox);
      if (cityBtn) cityBtn.addEventListener("click", function () {
        var o = citySel && citySel.options[citySel.selectedIndex];
        if (!o || !o.value) { text(nearStatus, T.city); return; }
        loadPoints().then(function () { setOrigin(Number(o.getAttribute("data-lat")), Number(o.getAttribute("data-lng")), o.textContent); }, function () { text(nearStatus, T.loadFailed); });
      });
      var coordBtn = one("[data-cm-usecoords]", nearBox);
      if (coordBtn) coordBtn.addEventListener("click", function () {
        var la = num(one("[data-cm-lat]", nearBox).value), ln = num(one("[data-cm-lng]", nearBox).value);
        if (la === null || ln === null || Math.abs(la) > 90 || Math.abs(ln) > 180) { text(nearStatus, T.coordsBad); return; }
        loadPoints().then(function () { setOrigin(la, ln, la + ", " + ln); }, function () { text(nearStatus, T.loadFailed); });
      });
    }

    // ── Clics sur la page : « Voir sur la carte », un lieu d'une liste, « Fermer » ────────────────────────────────────
    root.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("button") : null;
      if (!t || !root.contains(t)) return;
      if (t.hasAttribute("data-cm-onmap")) {
        openMap(t.getAttribute("data-cm-onmap")).then(function () { if (mapbox) mapbox.scrollIntoView({ block: "nearest" }); });
      } else if (t.hasAttribute("data-cm-pick")) {
        var c = t.getAttribute("data-cm-pick");
        loadPoints().then(function () { if (map) pick(c, false); else showFiche(c); });
      } else if (t.hasAttribute("data-cm-close")) {
        closeFiche();
        if (map) map.focus();
      }
    });

    // ── Recherche sans recharger la page ──────────────────────────────────────────────────────────────────────────────
    var form = one("[data-cm-search]", root), input = qInput, list = one("[data-cm-list]", root), pager = one("[data-cm-pager]", root);
    var count = one("[data-cm-count]", root), empty = one("[data-cm-empty]", root), seq = 0, timer = 0, last = input ? input.value.trim() : "";
    function search() {
      var q = input.value.trim();
      if (q === last) return;
      last = q; wantQ = q;
      var mine = ++seq, tf = form.elements.t ? form.elements.t.value : "";
      getJson(urls.list + "&q=" + encodeURIComponent(q) + (tf ? "&t=" + encodeURIComponent(tf) : "")).then(function (j) {
        if (mine !== seq || !j || !j.ok) return;
        list.innerHTML = j.items; reveal(list); // HTML déjà échappé par le serveur
        if (pager) pager.innerHTML = j.pager || "";
        text(count, j.count);
        if (empty) empty.hidden = j.total > 0;
        // la carte suit la recherche : on relit les points
        P = null; byCode = {};
        if (shown && map) loadPoints().then(function () { map.setPoints(P); if (P.length) map.fitAll(); });
      }, function () { if (mine === seq) text(count, T.loadFailed); });
    }
    if (form && input && list) {
      form.addEventListener("submit", function (e) { if (!w.fetch) return; e.preventDefault(); w.clearTimeout(timer); search(); });
      input.addEventListener("input", function () { w.clearTimeout(timer); timer = w.setTimeout(search, 280); });
    }
  }

  function boot() {
    all("[data-cm]:not([data-cm-on])").forEach(function (r) { r.setAttribute("data-cm-on", ""); start(r); });
  }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", boot); else boot();
  // La page peut arriver par un lien interne du site, sans rechargement : un observateur léger la met en route.
  if (w.MutationObserver) {
    var waiting = false;
    new w.MutationObserver(function () {
      if (waiting) return;
      waiting = true;
      (w.requestAnimationFrame || w.setTimeout)(function () { waiting = false; boot(); });
    }).observe(D.documentElement, { childList: true, subtree: true });
  }
})();
