// Mascotte — le petit script envoyé aux visiteurs (route « mascot.js »). Il est volontairement PETIT, sans bibliothèque, et ne fait RIEN d'utile avant la fin du chargement de la page.
//
// Ce qu'il fait : décide en local (coupée ? déjà venue dans cette session ? assez de messages aujourd'hui ? bonne page ?), attend le délai choisi, demande alors UNE fois les phrases
// du moment au site, se montre, dit une ou deux phrases courtes, puis se range. Le visiteur peut la fermer (×), la réduire en pastille ou la couper pour toujours.
//
// Ce qu'il garde, dans le NAVIGATEUR seulement (localStorage / sessionStorage ; aucun cookie, rien n'est envoyé) : « coupée », « en pastille », le jour et le nombre de messages du jour,
// les dernières phrases dites (pour ne jamais se répéter) et « déjà venue dans cette session ». Si le navigateur refuse tout stockage, la mascotte ne se montre pas du tout.
//
// Écriture : texte uniquement (jamais de HTML venu du site), sauf le dessin inclus, qui est une constante de ce module. Pas de son.
// `mascotClient` doit rester AUTONOME : sa source est envoyée telle quelle au navigateur, avec la configuration (C), le dessin (face) et la règle des pages (matches).

/* eslint-disable no-var */
export function mascotClient(C, face, matches) {
  "use strict";
  var w = window, D = document;
  if (w.__mascotBoot) return;
  w.__mascotBoot = 1;
  var KEY = "mascot." + C.k, ls, ss;
  try { ls = w.localStorage; ss = w.sessionStorage; ls.getItem(KEY); ss.getItem(KEY); } catch (e) { return; }
  function read(s) { try { var v = JSON.parse(s.getItem(KEY)); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } }
  function save(s, o) { try { s.setItem(KEY, JSON.stringify(o)); } catch (e) { /* stockage plein ou refusé : on continue sans */ } }
  var L = read(ls), T = read(ss);
  var force = /[?&]mascot=voir(&|$)/.test(location.search);
  if (force) {
    L = {}; T = {}; save(ls, L); save(ss, T);
    try { history.replaceState(null, "", location.pathname + location.search.replace(/([?&])mascot=voir&?/, "$1").replace(/[?&]$/, "") + location.hash); } catch (e) { /* ignoré */ }
  }
  var d = new Date(), today = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  if (L.day !== today) { L.day = today; L.n = 0; }
  if (L.mute) return;
  var path = (function () {
    var p = location.pathname.replace(/\/+$/, "") || "/", m = /^\/([a-z]{2}(?:-[a-z]{2})?)(\/.*)?$/i.exec(p);
    if (m && m[1].toLowerCase() === String(C.l).toLowerCase()) p = m[2] || "/";
    return p.toLowerCase();
  })();
  if (!(C.w === "all" || (C.w === "home" && path === "/") || (C.w === "some" && matches(C.g, path)))) return;
  var mm = w.matchMedia ? function (q) { return w.matchMedia(q).matches; } : function () { return false; };
  var small = mm("(max-width:600px),(max-height:480px)"), calm = mm("(prefers-reduced-motion:reduce)");
  var root, bub, av, queue = [], timer = 0, paused = false, dotTimer = 0, auto = false;

  function el(tag, cls, txt) { var e = D.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; }
  function btn(cls, txt, fn) { var b = el("button", cls, txt); b.type = "button"; b.onclick = fn; return b; }
  function okHref(h) { return typeof h === "string" && h.length < 400 && (/^\/(?!\/)/.test(h) || /^https:\/\//.test(h)); }
  function fmt(t) {
    return String(t).replace(/\{\{([td]):([0-9T:.+\-Z]{8,32})\}\}/g, function (all, k, iso) {
      try {
        var x = new Date(iso);
        if (isNaN(x)) return "";
        return new Intl.DateTimeFormat(C.l, k === "d" ? { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" } : { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(x);
      } catch (e) { return ""; }
    });
  }
  function css(then) {
    if (D.getElementById("mc-css")) return then();
    var l = el("link"); l.id = "mc-css"; l.rel = "stylesheet"; l.href = C.c; l.onload = then; D.head.appendChild(l);
  }
  function setFace(mood) { if (!C.i && av) av.innerHTML = face(mood); }
  function build() {
    root = el("div", "mc " + (C.p === "l" ? "mc-w" : "mc-r"));
    root.setAttribute("role", "region"); root.setAttribute("aria-label", C.n);
    av = btn("mc-av", "", function () { call(); });
    av.setAttribute("aria-label", C.u.o);
    if (C.i) {
      var im = el("img", "mc-i " + (C.i.r ? "mc-rd" : "mc-sq")); im.src = C.i.s; im.alt = C.i.a; im.width = 76; im.height = 76; im.decoding = "async"; av.appendChild(im);
    } else setFace("happy");
    root.appendChild(av);
    root.addEventListener("keydown", function (e) { if (e.key === "Escape" && bub) close(); });
    D.body.appendChild(root);
    root.className += calm ? "" : " mc-in mc-hi";
  }
  function dropBubble() { if (bub && bub.parentNode) bub.parentNode.removeChild(bub); bub = null; clearTimeout(timer); }
  function vanish() {
    clearTimeout(timer); clearTimeout(dotTimer); queue = []; dropBubble();
    if (!root) return;
    var r = root; root = null;
    if (calm) { if (r.parentNode) r.parentNode.removeChild(r); return; }
    r.className += " mc-out";
    setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 320);
  }
  function toPill() { dropBubble(); queue = []; if (root) { root.className = root.className.replace(" mc-in", "").replace(" mc-hi", "") + " mc-pill"; setFace("sleepy"); } }
  function close() { if (L.pill) toPill(); else vanish(); }
  function reduce() { L.pill = 1; save(ls, L); toPill(); }
  function normal() { L.pill = 0; save(ls, L); vanish(); }
  function mute() { L.mute = 1; save(ls, L); vanish(); }
  function wait(ms) { clearTimeout(timer); timer = setTimeout(function () { if (!paused) next(); }, ms); }
  function show(it) {
    dropBubble();
    bub = el("div", "mc-bub"); bub.setAttribute("role", "status");
    bub.appendChild(el("p", "mc-n", C.n));
    bub.appendChild(el("p", "mc-p", fmt(it.text)));
    if (okHref(it.href)) { var a = el("a", "mc-a", C.u.g); a.href = it.href; if (it.href.charAt(0) !== "/") a.rel = "noopener noreferrer"; bub.appendChild(a); }
    var o = el("div", "mc-o");
    o.appendChild(btn("", L.pill ? C.u.u : C.u.p, L.pill ? normal : reduce));
    o.appendChild(btn("", C.u.m, mute));
    bub.appendChild(o);
    var x = btn("mc-x", "×", close); x.setAttribute("aria-label", C.u.x); bub.appendChild(x);
    bub.addEventListener("mouseenter", function () { paused = true; clearTimeout(timer); });
    bub.addEventListener("mouseleave", function () { paused = false; wait(3000); });
    bub.addEventListener("focusin", function () { paused = true; clearTimeout(timer); });
    bub.addEventListener("focusout", function () { paused = false; wait(3000); });
    root.insertBefore(bub, av);
    var dot = av.querySelector(".mc-dot"); if (dot) dot.parentNode.removeChild(dot);
    setFace(it.kind === "hello" ? "happy" : "curious");
  }
  function remember(it, counted) {
    if (counted) L.n = (L.n || 0) + 1;
    L.last = it.id; L.seen = (L.seen || []).concat(it.id).slice(-8); L.at = Date.now();
    save(ls, L);
  }
  function next() {
    var it = queue.shift();
    if (!it) { if (L.pill) toPill(); else vanish(); return; }
    remember(it, auto);
    show(it);
    wait(Math.max(C.s * 1000, 2500 + it.text.length * 60));
  }
  function valid(i) { return i && typeof i.id === "string" && i.id.length < 120 && typeof i.text === "string" && i.text.length < 400 && (i.kind === "hello" || i.kind === "tip" || i.kind === "news"); }
  function load(cb) {
    if (!w.fetch) return;
    w.fetch(C.b + "/lines?lang=" + encodeURIComponent(C.l) + "&path=" + encodeURIComponent(path), { credentials: "omit", headers: { accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { cb(j && Array.isArray(j.items) ? j.items.filter(valid).slice(0, 30) : []); })
      .catch(function () { /* le site ne répond pas : elle reste discrète */ });
  }
  /** Parmi les phrases, celle qui a le moins été dite récemment ; jamais celle qu'elle vient de dire. */
  function choose(items, kinds, unseenOnly) {
    var seen = L.seen || [];
    var c = items.filter(function (i) { return kinds.indexOf(i.kind) > -1 && i.id !== L.last && (!unseenOnly || seen.indexOf(i.id) < 0); });
    if (!c.length) return null;
    var best = Math.min.apply(null, c.map(function (i) { return seen.indexOf(i.id); }));
    c = c.filter(function (i) { return seen.indexOf(i.id) === best; });
    return c[Math.floor(Math.random() * c.length)];
  }
  function pick(items) {
    var out = [], h = L.n ? null : choose(items, ["hello"]);
    if (force && !h) h = choose(items, ["hello"]);
    if (h) out.push(h);
    var e = choose(items, ["news"], true) || choose(items, ["tip"], true) || choose(items, ["news", "tip"]);
    if (e) out.push(e);
    return out.slice(0, force ? 2 : Math.max(0, C.m - (L.n || 0)));
  }
  /** Le visiteur appelle la mascotte (clic sur elle) : une phrase de plus, qui ne compte pas dans la limite du jour. */
  function call() {
    if (bub) { close(); return; }
    if (queue.length) { next(); return; }
    load(function (items) {
      var it = choose(items, ["news", "tip"], true) || choose(items, ["news", "tip"]) || choose(items, ["hello"]);
      if (!it || !root) return;
      auto = false; queue = [it]; next();
    });
  }
  function mount() { css(function () { build(); toPill(); }); }
  function go() {
    load(function (items) {
      var chosen = pick(items);
      if (!chosen.length) { T.none = 1; save(ss, T); return; }
      if (T.done && !force) return;
      T.done = 1; save(ss, T); L.at = Date.now(); save(ls, L);
      css(function () {
        build();
        auto = true;
        if (small) {
          // Petit écran : jamais de bulle qui s'ouvre toute seule. Une pastille avec un point ; la bulle s'ouvre si on la touche.
          av.appendChild(el("span", "mc-dot"));
          queue = chosen; root.className += " mc-pill";
          dotTimer = setTimeout(vanish, 15000);
          av.addEventListener("click", function () { clearTimeout(dotTimer); root.className = root.className.replace(" mc-pill", ""); }, { once: true });
        } else { queue = chosen; next(); }
      });
    });
  }
  function start() {
    if (L.pill) { setTimeout(mount, 1200); return; }
    if ((T.done || T.none) && !force) return;
    if (!force && (L.n >= C.m || (L.at && Date.now() - L.at < 20 * 60000))) return;
    var tries = 0;
    function wake() {
      if (D.hidden) { var again = function () { if (!D.hidden) { D.removeEventListener("visibilitychange", again); setTimeout(wake, 1500); } }; D.addEventListener("visibilitychange", again); return; }
      if (D.querySelector(".cookie-tray") && tries++ < 8) { setTimeout(wake, 3000); return; }
      go();
    }
    setTimeout(wake, force ? 300 : C.d * 1000);
  }
  if (D.readyState === "complete") start(); else w.addEventListener("load", start);
}
