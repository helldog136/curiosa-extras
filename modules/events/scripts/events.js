/* Événements : le petit script de confort de la page. Il n'ajoute que deux choses ; sans lui, tout reste lisible et utilisable.
   1. L'heure CHEZ LE VISITEUR, en toutes lettres (« Samedi à 20 h chez vous »), seulement quand elle diffère de l'heure de l'événement.
   2. Une vidéo YouTube ne se charge qu'APRÈS un clic (avant, YouTube ne reçoit rien du visiteur ; sans le script, le bouton est un simple lien).
   Aucun texte n'est écrit ici : les phrases viennent de la page (attribut data-ev-cfg). Aucun minuteur, aucune requête, rien n'est gardé. */
(function () {
  "use strict";
  var root = document.querySelector(".ev");
  if (!root) return;
  var cfg = {};
  try { cfg = JSON.parse(root.getAttribute("data-ev-cfg") || "{}"); } catch (e) { cfg = {}; }
  var lang = String(cfg.lang || "en");
  var base = lang.slice(0, 2).toLowerCase();
  var viewerTz = "";
  try { viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { viewerTz = ""; }

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function cap(s) { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); }
  function parts(ms, tz) {
    var f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
    var p = {};
    f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
  }
  function fmt(ms, tz, opts) {
    var o = {};
    for (var k in opts) o[k] = opts[k];
    o.timeZone = tz;
    try { return new Intl.DateTimeFormat(lang, o).format(new Date(ms)); } catch (e) { return new Intl.DateTimeFormat("en", o).format(new Date(ms)); }
  }
  function clock(h, mi) {
    if (base === "fr") {
      if (mi === 0 && h === 0) return "minuit";
      if (mi === 0 && h === 12) return "midi";
      return mi === 0 ? h + " h" : h + " h " + pad2(mi);
    }
    if (base === "en") {
      if (mi === 0 && h === 0) return "midnight";
      if (mi === 0 && h === 12) return "noon";
      var hh = h % 12 === 0 ? 12 : h % 12;
      return (mi === 0 ? hh : hh + ":" + pad2(mi)) + " " + (h < 12 ? "am" : "pm");
    }
    return pad2(h) + ":" + pad2(mi);
  }
  function sameWall(ms, a, b) {
    var x = parts(ms, a), y = parts(ms, b);
    return x.y === y.y && x.mo === y.mo && x.d === y.d && x.h === y.h && x.mi === y.mi;
  }
  /* « aujourd'hui à 20 h » · « demain à 20 h » · « samedi à 20 h » (dans la semaine) · « samedi 14 novembre à 20 h » */
  function when(ms, tz) {
    var p = parts(ms, tz), n = parts(Date.now(), tz);
    var diff = Math.round((Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(n.y, n.mo - 1, n.d)) / 86400000);
    var day;
    if (diff === 0) day = cfg.today;
    else if (diff === 1) day = cfg.tomorrow;
    else if (diff > 1 && diff < 7) day = fmt(ms, tz, { weekday: "long" });
    else day = fmt(ms, tz, { weekday: "long", day: "numeric", month: "long" });
    return day + " " + cfg.at + " " + clock(p.h, p.mi);
  }

  function showLocal() {
    if (!viewerTz) return;
    var list = document.querySelectorAll("[data-ev-local]");
    for (var i = 0; i < list.length; i++) {
      var el = list[i], ms = +el.getAttribute("data-start"), tz = el.getAttribute("data-tz") || "UTC";
      if (!isFinite(ms) || sameWall(ms, tz, viewerTz)) continue;
      el.textContent = cap(String(cfg.local || "{when}").replace("{when}", when(ms, viewerTz)));
      el.hidden = false;
    }
    var slots = document.querySelectorAll("[data-ev-slot]");
    for (var j = 0; j < slots.length; j++) {
      var s = slots[j], t = +s.getAttribute("data-ev-slot"), zone = s.getAttribute("data-tz") || "UTC";
      if (!isFinite(t) || sameWall(t, zone, viewerTz)) continue;
      var w = parts(t, viewerTz);
      s.textContent = String(cfg.slot || "{time}").replace("{time}", clock(w.h, w.mi));
      s.hidden = false;
    }
  }

  function wireVideos() {
    var boxes = document.querySelectorAll("[data-ev-yt]");
    for (var i = 0; i < boxes.length; i++) (function (box) {
      var a = box.querySelector("a");
      if (!a) return;
      a.addEventListener("click", function (e) {
        var id = box.getAttribute("data-ev-yt");
        if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;
        e.preventDefault();
        var f = document.createElement("iframe");
        f.src = "https://www.youtube-nocookie.com/embed/" + id + "?autoplay=1&rel=0";
        f.title = String(cfg.video || "YouTube");
        f.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
        f.setAttribute("allowfullscreen", "");
        f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
        box.textContent = "";
        box.appendChild(f);
        if (f.focus) f.focus();
      });
    })(boxes[i]);
  }

  try { showLocal(); } catch (e) { /* l'heure locale est un plus : la page reste correcte sans elle */ }
  wireVideos();
})();
