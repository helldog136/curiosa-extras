/* Galeries photos : le petit script de confort des pages publiques.
 * Sans lui, tout marche : chaque miniature est un lien vers une page de photo (précédente, suivante, retour), la demande de retrait part par un formulaire ordinaire.
 * Avec lui : visionneuse plein écran (flèches et Échap au clavier, balayage au doigt, compteur, légende, lien copié, pas de piège au focus,
 * mouvement réduit respecté), flèches et balayage aussi sur la page d'une photo, demande de retrait envoyée sans recharger la page.
 * Aucun texte en dur (les phrases sont des attributs de la page), aucun innerHTML, rien n'est stocké dans le navigateur, aucun appel à un autre site. */
(function () {
  "use strict";
  var w = window;
  var D = document;
  if (w.__galBoot) return;
  w.__galBoot = 1;

  function one(sel, el) { return (el || D).querySelector(sel); }
  function qa(sel, el) { return Array.prototype.slice.call((el || D).querySelectorAll(sel)); }
  function rootOf(el) { return el && el.closest ? el.closest("[data-gal]") : null; }
  function text(el, value) { if (el) el.textContent = value || ""; }
  function el(tag, cls, label) {
    var n = D.createElement(tag);
    if (cls) n.className = cls;
    if (label) n.textContent = label;
    return n;
  }
  function fill(template, vars) {
    return String(template || "").replace(/\{(\w+)\}/g, function (m, k) { return vars[k] === undefined ? m : vars[k]; });
  }
  function copy(value, done) {
    if (w.navigator && w.navigator.clipboard && w.navigator.clipboard.writeText) {
      w.navigator.clipboard.writeText(value).then(function () { done(true); }, function () { done(false); });
    } else done(false);
  }

  // ── La visionneuse ─────────────────────────────────────────────────────────────────
  var V = null; // { dlg, img, cap, count, status, prev, next, removal, items, i, opener, pushed, root }

  function items(root) {
    return qa("[data-gal-photo]", root).map(function (a) {
      return { href: a.getAttribute("href"), full: a.getAttribute("data-full"), caption: a.getAttribute("data-caption") || "", alt: a.getAttribute("data-alt") || "", removal: a.getAttribute("data-removal") || "", node: a };
    });
  }

  function build(root) {
    var d = root.dataset;
    var dlg = el("dialog", "gal-viewer");
    dlg.setAttribute("aria-label", d.tViewer || "");
    var bar = el("div", "gal-v-bar");
    var count = el("span", "gal-v-count");
    count.setAttribute("role", "status");
    var copyBtn = el("button", "gal-btn", d.tCopy);
    copyBtn.type = "button";
    var shareBtn = null;
    if (w.navigator && typeof w.navigator.share === "function") { shareBtn = el("button", "gal-btn", d.tShare); shareBtn.type = "button"; }
    var close = el("button", "gal-btn gal-btn-main", d.tClose);
    close.type = "button";
    bar.appendChild(count);
    bar.appendChild(copyBtn);
    if (shareBtn) bar.appendChild(shareBtn);
    bar.appendChild(close);
    var stage = el("div", "gal-v-stage");
    var prev = el("button", "gal-v-nav gal-v-prev", "‹");
    prev.type = "button";
    prev.setAttribute("aria-label", d.tPrev || "");
    var next = el("button", "gal-v-nav gal-v-next", "›");
    next.type = "button";
    next.setAttribute("aria-label", d.tNext || "");
    var fig = el("figure", "gal-v-fig");
    var img = el("img", "gal-v-img");
    var cap = el("figcaption", "gal-v-cap");
    fig.appendChild(img);
    fig.appendChild(cap);
    stage.appendChild(prev);
    stage.appendChild(fig);
    stage.appendChild(next);
    var foot = el("div", "gal-v-foot");
    var removal = el("a", "gal-v-removal");
    var status = el("p", "gal-status");
    status.setAttribute("role", "status");
    foot.appendChild(removal);
    foot.appendChild(status);
    dlg.appendChild(bar);
    dlg.appendChild(stage);
    dlg.appendChild(foot);
    D.body.appendChild(dlg);
    V = { dlg: dlg, img: img, cap: cap, count: count, status: status, prev: prev, next: next, removal: removal, items: [], i: 0, opener: null, pushed: false, root: root, startX: 0, startY: 0, tracking: false };

    prev.addEventListener("click", function () { go(-1); });
    next.addEventListener("click", function () { go(1); });
    close.addEventListener("click", closeUi);
    copyBtn.addEventListener("click", function () {
      var it = V.items[V.i];
      copy(new w.URL(it.href, w.location.href).href, function (ok) { text(V.status, ok ? d.tCopied : ""); });
    });
    if (shareBtn) shareBtn.addEventListener("click", function () {
      var it = V.items[V.i];
      try { w.navigator.share({ url: new w.URL(it.href, w.location.href).href, title: it.caption || D.title }); } catch (e) { /* partage annulé */ }
    });
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); closeUi(); });
    dlg.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "Home") { e.preventDefault(); show(0); }
      else if (e.key === "End") { e.preventDefault(); show(V.items.length - 1); }
    });
    // Balayage au doigt : un geste surtout horizontal change de photo (le zoom à deux doigts et le défilement vertical restent au navigateur).
    stage.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      V.tracking = true; V.startX = e.clientX; V.startY = e.clientY;
    });
    stage.addEventListener("pointerup", function (e) {
      if (!V.tracking) return;
      V.tracking = false;
      var dx = e.clientX - V.startX;
      var dy = e.clientY - V.startY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    });
    stage.addEventListener("pointercancel", function () { V.tracking = false; });
    img.addEventListener("load", function () { dlg.classList.remove("gal-v-loading"); text(V.status, ""); });
    img.addEventListener("error", function () { dlg.classList.remove("gal-v-loading"); text(V.status, d.tError); });
  }

  function preload(i) {
    var it = V.items[i];
    if (it && it.full) { var p = new w.Image(); p.src = it.full; }
  }

  function show(i, replace) {
    if (!V.items.length) return;
    V.i = Math.max(0, Math.min(V.items.length - 1, i));
    var it = V.items[V.i];
    var d = V.root.dataset;
    V.dlg.classList.add("gal-v-loading");
    text(V.status, d.tLoading);
    V.img.alt = it.alt;
    V.img.src = it.full;
    text(V.cap, it.caption);
    V.cap.hidden = !it.caption;
    text(V.count, fill(d.tOf, { n: V.i + 1, total: V.items.length }));
    V.prev.disabled = V.i === 0;
    V.next.disabled = V.i === V.items.length - 1;
    if (it.removal && d.tRemoval) { V.removal.href = it.removal; V.removal.textContent = d.tRemoval; V.removal.hidden = false; }
    else V.removal.hidden = true;
    if (replace !== false) { try { w.history.replaceState({ gal: 1 }, "", it.href); } catch (e) { /* adresse non modifiable */ } }
    preload(V.i + 1);
    preload(V.i - 1);
  }

  function go(step) { show(V.i + step); }

  function open(root, list, i, opener) {
    if (!V) build(root);
    V.root = root; V.items = list; V.opener = opener;
    V.dlg.showModal();
    try { w.history.pushState({ gal: 1 }, "", list[i].href); V.pushed = true; } catch (e) { V.pushed = false; }
    show(i, false);
    var focus = V.dlg.querySelector(".gal-v-bar .gal-btn-main");
    if (focus) focus.focus();
  }

  function finish() {
    if (!V || !V.dlg.open) return;
    V.dlg.close();
    var back = V.opener;
    V.opener = null;
    if (back && back.focus) back.focus();
  }
  function closeUi() {
    if (V && V.pushed) { V.pushed = false; try { w.history.back(); return; } catch (e) { /* pas d'historique */ } }
    finish();
  }
  w.addEventListener("popstate", function () { if (V && V.dlg.open) { V.pushed = false; finish(); } });

  // ── Page d'une photo : flèches et balayage vont à la photo voisine ─────────────────
  function photoPage(root) {
    var prev = one("a[rel=prev]", root);
    var next = one("a[rel=next]", root);
    var go2 = function (a) { if (a) w.location.assign(a.href); };
    D.addEventListener("keydown", function (e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "ArrowLeft") go2(prev);
      else if (e.key === "ArrowRight") go2(next);
    });
    var sx = 0, sy = 0, on = false;
    root.addEventListener("pointerdown", function (e) { if (e.pointerType === "mouse" || !e.isPrimary) return; on = true; sx = e.clientX; sy = e.clientY; });
    root.addEventListener("pointerup", function (e) {
      if (!on) return;
      on = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go2(dx < 0 ? next : prev);
    });
  }

  // ── Écouteurs posés une seule fois sur la page ─────────────────────────────────────
  D.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var tile = t.closest("[data-gal-photo]");
    if (tile && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
      var root = rootOf(tile);
      if (root && typeof D.createElement("dialog").showModal === "function") {
        var list = items(root);
        var at = -1;
        for (var k = 0; k < list.length; k++) if (list[k].node === tile) { at = k; break; }
        if (at > -1) { e.preventDefault(); open(root, list, at, tile); }
      }
      return;
    }
    var copyBtn = t.closest("[data-gal-copy]");
    if (copyBtn) {
      var r = rootOf(copyBtn);
      var url = new w.URL(copyBtn.getAttribute("data-gal-copy") || w.location.pathname, w.location.href).href;
      copy(url, function (ok) { text(one("[data-gal-copied]", r), ok ? r.dataset.tCopied : ""); });
    }
  });

  D.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || !form.matches || !form.matches("[data-gal-removal]") || !w.fetch || !w.FormData) return;
    var r = rootOf(form);
    var out = one("[data-gal-removal-result]", form);
    var d = r.dataset;
    e.preventDefault();
    var buttons = qa("button", form);
    form.setAttribute("aria-busy", "true");
    buttons.forEach(function (b) { b.disabled = true; });
    w.fetch(form.action, { method: "POST", body: new w.FormData(form), headers: { accept: "application/json" }, credentials: "omit" }).then(function (res) {
      return res.json().then(function (j) { return { status: res.status, json: j }; }, function () { return { status: res.status, json: null }; });
    }).then(function (o) {
      form.setAttribute("aria-busy", "false");
      buttons.forEach(function (b) { b.disabled = false; });
      if (o.status >= 200 && o.status < 300) { form.reset(); text(out, d.tSent); }
      else text(out, o.status === 429 ? d.tLimit : o.status === 400 ? d.tInvalid : o.status === 503 ? d.tFull : d.tFail);
    }, function () {
      form.setAttribute("aria-busy", "false");
      buttons.forEach(function (b) { b.disabled = false; });
      text(out, d.tFail);
    });
  }, true);

  function boot() {
    var page = one(".gal-photo[data-gal]");
    if (page && !page.getAttribute("data-gal-on")) { page.setAttribute("data-gal-on", ""); photoPage(page); }
  }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", boot); else boot();
})();
