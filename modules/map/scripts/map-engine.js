/* Carte : petit moteur de cartes à tuiles glissantes (projection Web Mercator), sans bibliothèque.
 * Deux parties : (1) des fonctions de calcul pures (projection, distance, regroupement), essayées hors navigateur par les tests ;
 * (2) createMap(), qui dessine les tuiles et les marqueurs, et gère souris, doigts, clavier et boutons +/−.
 * Aucune requête n'est faite avant l'appel de createMap() : la page ne l'appelle qu'après le clic « Afficher la carte ». */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (root) root.CuriosaMap = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  var TILE = 256, MAXLAT = 85.0511287798, PI = Math.PI, RAD = PI / 180;
  var DEFAULTS = { maxZoom: 18, cell: 72, maxMarkers: 200 };

  // ── Calculs ─────────────────────────────────────────────────────────────────────────────────
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clampLat(lat) { return clamp(lat, -MAXLAT, MAXLAT); }
  function worldSize(z) { return TILE * Math.pow(2, z); }
  /** Position (latitude, longitude) → pixel du « monde » au zoom z (origine : coin haut-gauche à −180°, 85,05°). */
  function project(lat, lng, z) {
    var s = worldSize(z), la = clampLat(lat) * RAD;
    return { x: (lng + 180) / 360 * s, y: (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / PI) / 2 * s };
  }
  function unproject(x, y, z) {
    var s = worldSize(z), n = PI - 2 * PI * y / s;
    return { lat: 180 / PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng: x / s * 360 - 180 };
  }
  /** Distance en kilomètres entre deux positions (haversine, rayon terrestre moyen). */
  function haversine(lat1, lng1, lat2, lng2) {
    var dLat = (lat2 - lat1) * RAD, dLng = (lng2 - lng1) * RAD;
    var a = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  /** Adresse d'une tuile : x revient dans [0, 2^z[ (le monde se répète), y hors limites n'existe pas (null). */
  function tileUrl(tpl, z, x, y) {
    var n = Math.pow(2, z);
    if (y < 0 || y >= n) return null;
    x = ((x % n) + n) % n;
    return tpl.replace("{z}", z).replace("{x}", x).replace("{y}", y);
  }
  /**
   * Regroupe des points (tableaux [lat, lng, …] ou objets {lat, lng}) en grappes sur une grille de pixels fixée au monde (stable quand on déplace la carte).
   * o.bounds {x0,y0,x1,y1} : seuls les points de cette zone (pixels du monde au zoom z) comptent ; o.cell : côté d'une case ; o.max : nombre de marqueurs au plus.
   * Quand il y aurait plus de `max` marqueurs, les cases grossissent jusqu'à y tenir (regroupement forcé).
   * Rend [{ lat, lng, n, ids: [indices] }] ; une grappe d'un seul point (n = 1) est un marqueur simple.
   */
  function cluster(points, z, o) {
    o = o || {};
    var cell = o.cell || DEFAULTS.cell, max = o.max || DEFAULTS.maxMarkers, b = o.bounds, items = [], i, p, la, ln;
    for (i = 0; i < points.length; i++) {
      p = points[i]; la = p.lat !== undefined ? p.lat : p[0]; ln = p.lng !== undefined ? p.lng : p[1];
      if (typeof la !== "number" || typeof ln !== "number" || !(la >= -90 && la <= 90 && ln >= -180 && ln <= 180)) continue;
      var w = project(la, ln, z);
      if (b && (w.x < b.x0 || w.x > b.x1 || w.y < b.y0 || w.y > b.y1)) continue;
      items.push({ i: i, x: w.x, y: w.y, la: la, ln: ln });
    }
    var groups, size = cell, guard = 0;
    for (;;) {
      var grid = {}, order = [];
      for (i = 0; i < items.length; i++) {
        var k = Math.floor(items[i].x / size) + ":" + Math.floor(items[i].y / size);
        if (!grid[k]) { grid[k] = []; order.push(k); }
        grid[k].push(items[i]);
      }
      groups = order.map(function (key) { return grid[key]; });
      if (groups.length <= max || ++guard > 40) break;
      size *= 1.5;
    }
    return groups.map(function (g) {
      var sa = 0, so = 0, ids = [];
      for (var j = 0; j < g.length; j++) { sa += g[j].la; so += g[j].ln; ids.push(g[j].i); }
      return { lat: sa / g.length, lng: so / g.length, n: g.length, ids: ids };
    });
  }
  /** Le zoom le plus fort et le centre qui montrent tous les points dans une vue de w × h pixels (marge pad). */
  function fit(points, w, h, o) {
    o = o || {};
    var pad = o.pad === undefined ? 40 : o.pad, minZ = o.minZoom || 1, maxZ = o.maxZoom || DEFAULTS.maxZoom, i, p;
    var a = 90, b = -90, c = 180, d = -180;
    for (i = 0; i < points.length; i++) {
      p = points[i]; var la = p.lat !== undefined ? p.lat : p[0], ln = p.lng !== undefined ? p.lng : p[1];
      if (la < a) a = la; if (la > b) b = la; if (ln < c) c = ln; if (ln > d) d = ln;
    }
    if (!points.length) return { lat: 20, lng: 0, zoom: minZ };
    if (a === b && c === d) return { lat: a, lng: c, zoom: Math.min(maxZ, o.single || 15) };
    for (var z = maxZ; z >= minZ; z--) {
      var p1 = project(b, c, z), p2 = project(a, d, z);
      if (p2.x - p1.x <= w - 2 * pad && p2.y - p1.y <= h - 2 * pad) {
        var mid = unproject((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, z);
        return { lat: mid.lat, lng: mid.lng, zoom: z };
      }
    }
    var m = unproject((project(b, c, minZ).x + project(a, d, minZ).x) / 2, (project(b, c, minZ).y + project(a, d, minZ).y) / 2, minZ);
    return { lat: m.lat, lng: m.lng, zoom: minZ };
  }
  /** Les points à moins de radiusKm de l'origine, du plus proche au plus lointain : [{ i, d }]. */
  function within(points, lat, lng, radiusKm) {
    var out = [];
    for (var i = 0; i < points.length; i++) {
      var p = points[i], d = haversine(lat, lng, p.lat !== undefined ? p.lat : p[0], p.lng !== undefined ? p.lng : p[1]);
      if (radiusKm === undefined || radiusKm === null || d <= radiusKm) out.push({ i: i, d: d });
    }
    out.sort(function (x, y) { return x.d - y.d || x.i - y.i; });
    return out;
  }
  /** « 850 m », « 3,2 km », « 42 km » selon la langue. */
  function formatDistance(km, locale) {
    var nf = function (n, digits) { try { return new Intl.NumberFormat(locale || undefined, { maximumFractionDigits: digits }).format(n); } catch (e) { return String(n); } };
    if (km < 1) return nf(Math.max(10, Math.round(km * 100) * 10), 0) + " m";
    if (km < 10) return nf(Math.round(km * 10) / 10, 1) + " km";
    return nf(Math.round(km), 0) + " km";
  }

  // ── La carte ────────────────────────────────────────────────────────────────────────────────
  function el(tag, cls, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    return e;
  }
  function button(cls, label, text) { var b = el("button", cls, { type: "button", "aria-label": label }); b.textContent = text; return b; }

  /**
   * createMap(conteneur, options) → { setPoints, setView, fitAll, select, setUser, zoomBy, resize, state, destroy }
   * options : tiles (adresse avec {z}/{x}/{y}), maxZoom, points (tableaux [lat, lng, …]), label(i) (nom d'un point), symbol(i), selected,
   *           onSelect(i), onGroup(indices), onTileError(), t = { zoomIn, zoomOut, help, map, group(n), attr } (textes déjà traduits).
   */
  function createMap(box, opt) {
    opt = opt || {};
    var t = opt.t || {}, maxZ = Math.min(19, opt.maxZoom || DEFAULTS.maxZoom), tpl = opt.tiles;
    var points = opt.points || [], selected = opt.selected === undefined ? -1 : opt.selected, user = null;
    var tiles = {}, marks = {}, failed = 0, reported = false, raf = 0, dead = false, nTiles = 0;
    var cLat = 20, cLng = 0, zoom = 2, W = 0, H = 0;

    var view = el("div", "cm-view", { tabindex: "0", role: "application", "aria-roledescription": "map", "aria-label": t.map || "Map", "aria-describedby": box.id ? box.id + "-help" : "" });
    var world = el("div", "cm-world");
    var layer = el("div", "cm-tiles", { "aria-hidden": "true" });
    var pins = el("div", "cm-pins");
    world.appendChild(layer); world.appendChild(pins); view.appendChild(world);
    var ctl = el("div", "cm-ctl"), zin = button("cm-zin", t.zoomIn || "+", "+"), zout = button("cm-zout", t.zoomOut || "−", "−");
    ctl.appendChild(zin); ctl.appendChild(zout);
    var help = el("p", "cm-help", { id: box.id ? box.id + "-help" : "" }); help.textContent = t.help || "";
    var attr = el("p", "cm-attr"); attr.appendChild(document.createTextNode("© "));
    var a = el("a", "", { href: "https://www.openstreetmap.org/copyright", target: "_blank", rel: "noopener" }); a.textContent = "OpenStreetMap";
    attr.appendChild(a); attr.appendChild(document.createTextNode(" " + (t.attr || "contributors")));
    box.appendChild(view); box.appendChild(ctl); box.appendChild(attr); box.appendChild(help);

    function minZoom() { return clamp(Math.ceil(Math.log(Math.max(W, H, TILE) / TILE) / Math.LN2), 1, maxZ); }
    function center() { return project(cLat, cLng, zoom); }
    function keepInside() {
      var s = worldSize(zoom), c = center(), x = s <= W ? s / 2 : clamp(c.x, W / 2, s - W / 2), y = s <= H ? s / 2 : clamp(c.y, H / 2, s - H / 2);
      var u = unproject(x, y, zoom); cLat = u.lat; cLng = u.lng;
    }
    function schedule() { if (!raf && !dead) raf = (window.requestAnimationFrame || setTimeout)(function () { raf = 0; draw(); }); }

    function draw() {
      if (dead) return;
      W = view.clientWidth; H = view.clientHeight;
      if (!W || !H) return;
      zoom = clamp(zoom, minZoom(), maxZ); keepInside();
      var c = center(), tx = c.x - W / 2, ty = c.y - H / 2, n = Math.pow(2, zoom), need = {};
      var x0 = Math.floor(tx / TILE), x1 = Math.floor((tx + W - 1) / TILE), y0 = Math.max(0, Math.floor(ty / TILE)), y1 = Math.min(n - 1, Math.floor((ty + H - 1) / TILE));
      for (var x = x0; x <= x1 && nTiles < 400; x++) {
        for (var y = y0; y <= y1; y++) {
          var key = zoom + "/" + x + "/" + y;
          need[key] = 1;
          var img = tiles[key];
          if (!img) {
            var url = tpl && tileUrl(tpl, zoom, x, y);
            if (!url) continue;
            img = new Image(TILE, TILE);
            img.alt = ""; img.draggable = false; img.decoding = "async"; img.className = "cm-tile";
            img.onerror = function () { this.className = "cm-tile cm-miss"; failed++; if (!reported && failed >= 3 && opt.onTileError) { reported = true; opt.onTileError(); } };
            img.src = url; // le Referer par défaut du navigateur est conservé (règle d usage d OpenStreetMap)
            layer.appendChild(img); tiles[key] = img; nTiles++;
          }
          img.style.transform = "translate(" + Math.round(x * TILE - tx) + "px," + Math.round(y * TILE - ty) + "px)";
        }
      }
      for (var k in tiles) if (!need[k]) { if (tiles[k].parentNode) tiles[k].parentNode.removeChild(tiles[k]); delete tiles[k]; nTiles--; }
      drawPins(tx, ty);
      zin.disabled = zoom >= maxZ; zout.disabled = zoom <= minZoom();
      box.setAttribute("data-z", zoom); box.setAttribute("data-lat", cLat.toFixed(5)); box.setAttribute("data-lng", cLng.toFixed(5));
      box.setAttribute("data-tiles", nTiles); box.setAttribute("data-pins", Object.keys(marks).length);
    }

    function drawPins(tx, ty) {
      var m = 48, groups = cluster(points, zoom, { bounds: { x0: tx - m, y0: ty - m, x1: tx + W + m, y1: ty + H + m }, max: DEFAULTS.maxMarkers }), seen = {};
      groups.forEach(function (g) {
        var single = g.n === 1, i = g.ids[0], key = single ? "p" + i : "g" + g.ids[0] + "_" + g.n, e = marks[key], w = project(g.lat, g.lng, zoom);
        if (!e) {
          e = single ? button("cm-pin", (opt.label ? opt.label(i) : "") || "", (opt.symbol && opt.symbol(i)) || "•") : button("cm-grp", t.group ? t.group(g.n) : String(g.n), String(g.n));
          if (single) e.setAttribute("data-i", i); else e.setAttribute("data-ids", g.ids.length > 60 ? "" : g.ids.join(","));
          e.__ids = g.ids; e.__n = g.n;
          pins.appendChild(e); marks[key] = e;
        }
        e.className = (single ? "cm-pin" : "cm-grp") + (single && i === selected ? " cm-sel" : "");
        if (single) { e.setAttribute("aria-pressed", i === selected ? "true" : "false"); }
        e.style.transform = "translate(" + Math.round(w.x - tx) + "px," + Math.round(w.y - ty) + "px)";
        seen[key] = 1;
      });
      for (var k in marks) if (k !== "me" && !seen[k]) { if (marks[k].parentNode) marks[k].parentNode.removeChild(marks[k]); delete marks[k]; }
      if (user) {
        var u = project(user.lat, user.lng, zoom), me = marks.me;
        if (!me) { me = el("span", "cm-me", { role: "img", "aria-label": t.you || "You" }); pins.appendChild(me); marks.me = me; }
        me.style.transform = "translate(" + Math.round(u.x - tx) + "px," + Math.round(u.y - ty) + "px)";
      }
    }

    // ── Déplacements ────────────────────────────────────────────────────────────────────────────
    function panBy(dx, dy) { var c = center(), u = unproject(c.x + dx, c.y + dy, zoom); cLat = u.lat; cLng = u.lng; keepInside(); schedule(); }
    function dropTiles() { for (var k in tiles) { if (tiles[k].parentNode) tiles[k].parentNode.removeChild(tiles[k]); delete tiles[k]; } nTiles = 0; }
    /** Change de zoom en gardant fixe le point (px, py) de la vue (par défaut son centre). */
    function zoomTo(z, px, py) {
      z = clamp(Math.round(z), minZoom(), maxZ);
      if (z === zoom) return;
      if (px === undefined) { px = W / 2; py = H / 2; }
      var c = center(), gx = c.x - W / 2 + px, gy = c.y - H / 2 + py, g = unproject(gx, gy, zoom);
      zoom = z;
      var q = project(g.lat, g.lng, zoom), u = unproject(q.x - px + W / 2, q.y - py + H / 2, zoom);
      cLat = u.lat; cLng = u.lng; keepInside(); dropTiles(); schedule();
    }
    var ptr = {}, pinch = null, drag = null, lastWheel = 0;
    function dist(a1, b1) { return Math.sqrt(Math.pow(a1.x - b1.x, 2) + Math.pow(a1.y - b1.y, 2)); }
    function rel(e) { var r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    view.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      ptr[e.pointerId] = rel(e);
      var ids = Object.keys(ptr);
      if (ids.length === 1) drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
      else if (ids.length === 2) { drag = null; pinch = { d: dist(ptr[ids[0]], ptr[ids[1]]), s: 1, mid: { x: (ptr[ids[0]].x + ptr[ids[1]].x) / 2, y: (ptr[ids[0]].y + ptr[ids[1]].y) / 2 } }; }
    });
    view.addEventListener("pointermove", function (e) {
      if (!ptr[e.pointerId]) return;
      var p = rel(e), old = ptr[e.pointerId]; ptr[e.pointerId] = p;
      if (pinch) {
        var ids = Object.keys(ptr); if (ids.length < 2) return;
        pinch.s = clamp(dist(ptr[ids[0]], ptr[ids[1]]) / (pinch.d || 1), 0.4, 2.5);
        world.style.transformOrigin = pinch.mid.x + "px " + pinch.mid.y + "px"; world.style.transform = "scale(" + pinch.s + ")";
        return;
      }
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.moved) {
        if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 6) return;
        drag.moved = true; box.classList.add("cm-drag");
        try { view.setPointerCapture(e.pointerId); } catch (x) { /* navigateur sans capture : le glisser marche quand même dans la zone */ }
      }
      panBy(old.x - p.x, old.y - p.y);
    });
    function release(e) {
      if (!ptr[e.pointerId]) return;
      delete ptr[e.pointerId];
      if (pinch) {
        var s = pinch.s, mid = pinch.mid; pinch = null; drag = null;
        world.style.transform = ""; world.style.transformOrigin = "";
        var dz = Math.round(Math.log(s) / Math.LN2);
        if (dz) zoomTo(zoom + dz, mid.x, mid.y);
        return;
      }
      if (drag && drag.id === e.pointerId) { drag = null; box.classList.remove("cm-drag"); }
    }
    view.addEventListener("pointerup", release); view.addEventListener("pointercancel", release);
    view.addEventListener("wheel", function (e) {
      e.preventDefault();
      var now = Date.now(); if (now - lastWheel < 140) return; lastWheel = now;
      var p = rel(e); zoomTo(zoom + (e.deltaY < 0 ? 1 : -1), p.x, p.y);
    }, { passive: false });
    view.addEventListener("dblclick", function (e) { if (e.target.closest && e.target.closest("button")) return; var p = rel(e); zoomTo(zoom + 1, p.x, p.y); });
    view.addEventListener("keydown", function (e) {
      if (e.target !== view || e.altKey || e.ctrlKey || e.metaKey) return;
      var step = e.shiftKey ? 320 : 100, k = e.key;
      if (k === "ArrowLeft") panBy(-step, 0); else if (k === "ArrowRight") panBy(step, 0); else if (k === "ArrowUp") panBy(0, -step); else if (k === "ArrowDown") panBy(0, step);
      else if (k === "+" || k === "=") zoomTo(zoom + 1); else if (k === "-" || k === "_") zoomTo(zoom - 1);
      else return;
      e.preventDefault();
    });
    pins.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("button") : null; if (!b || !pins.contains(b)) return;
      if (b.hasAttribute("data-i")) { if (opt.onSelect) opt.onSelect(Number(b.getAttribute("data-i"))); return; }
      var ids = b.__ids || [], c = ids.map(function (j) { return points[j]; });
      var f = fit(c, W, H, { minZoom: minZoom(), maxZoom: maxZ, pad: 60 });
      if (f.zoom > zoom && zoom < maxZ) { setView(f.lat, f.lng, Math.max(f.zoom, zoom + 1)); } else if (opt.onGroup) opt.onGroup(ids);
    });
    zin.addEventListener("click", function () { zoomTo(zoom + 1); });
    zout.addEventListener("click", function () { zoomTo(zoom - 1); });
    var ro = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    if (ro) ro.observe(view); else window.addEventListener("resize", schedule);

    function setView(lat, lng, z) {
      cLat = lat; cLng = lng;
      var changed = z !== undefined && z !== zoom;
      if (z !== undefined) zoom = clamp(Math.round(z), minZoom(), maxZ);
      if (changed) dropTiles();
      schedule();
    }
    function fitAll(list) {
      W = view.clientWidth || W; H = view.clientHeight || H;
      var f = fit(list || points, W || 320, H || 240, { minZoom: minZoom(), maxZoom: maxZ - 3, pad: 36, single: 15 });
      setView(f.lat, f.lng, f.zoom);
    }
    W = view.clientWidth; H = view.clientHeight; schedule();

    return {
      setPoints: function (list) { points = list || []; for (var k in marks) if (k !== "me") { if (marks[k].parentNode) marks[k].parentNode.removeChild(marks[k]); delete marks[k]; } schedule(); },
      setView: setView, fitAll: fitAll, resize: schedule, draw: draw,
      select: function (i) { selected = i; schedule(); },
      setUser: function (lat, lng) { user = lat === null ? null : { lat: lat, lng: lng }; if (!user && marks.me) { marks.me.parentNode.removeChild(marks.me); delete marks.me; } schedule(); },
      zoomBy: function (d) { zoomTo(zoom + d); },
      state: function () { return { lat: cLat, lng: cLng, zoom: zoom, tiles: nTiles, pins: Object.keys(marks).length }; },
      focus: function () { view.focus(); },
      destroy: function () {
        dead = true; if (ro) ro.disconnect(); else window.removeEventListener("resize", schedule);
        tiles = {}; marks = {}; nTiles = 0;
        while (box.firstChild) box.removeChild(box.firstChild);
      },
    };
  }

  return { project: project, unproject: unproject, haversine: haversine, tileUrl: tileUrl, cluster: cluster, fit: fit, within: within, formatDistance: formatDistance, createMap: createMap, worldSize: worldSize, MAXLAT: MAXLAT };
});
