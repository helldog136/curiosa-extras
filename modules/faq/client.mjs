// Questions fréquentes : le petit script envoyé au navigateur (route « client.js »).
// Il n'est qu'un CONFORT : sans lui, les questions s'ouvrent et se referment (balises natives), les avis et les questions
// partent par un formulaire ordinaire, et un lien vers une question amène à la bonne ligne.
// Avec lui : recherche en tapant (accents et majuscules ignorés), « tout ouvrir », question ouverte par son lien, lien copié,
// avis et question envoyés sans recharger la page. Aucun texte en dur (les phrases sont des attributs de la page), aucun innerHTML.
// Rien n'est stocké dans le navigateur avant que la personne clique sur un avis ; et seulement la liste des questions notées.

import { fold } from "./text.mjs";

/** Doit rester AUTONOME : sa source est envoyée telle quelle au navigateur. `fold` lui est passée en paramètre. */
function faqClient(fold) {
  "use strict";
  var w = window;
  var D = document;
  if (w.__faqBoot) return;
  w.__faqBoot = 1;
  var cache = typeof WeakMap === "function" ? new WeakMap() : null;

  function one(sel, el) { return (el || D).querySelector(sel); }
  function all(sel, el) { return Array.prototype.slice.call((el || D).querySelectorAll(sel)); }
  function rootOf(el) { return el && el.closest ? el.closest("[data-faq]") : null; }
  function text(el, value) { if (el) el.textContent = value || ""; }

  // ── Recherche ──────────────────────────────────────────────────────────────────────
  function haystack(item) {
    var known = cache && cache.get(item);
    if (known) return known;
    var title = one("[data-faq-title]", item);
    var body = one("[data-faq-body]", item);
    var value = fold((title ? title.textContent : "") + " " + (body ? body.textContent : ""));
    if (cache) cache.set(item, value);
    return value;
  }
  function filter(r) {
    var input = one("[data-faq-q]", r);
    if (!input) return;
    var terms = fold(input.value).split(/\s+/).filter(Boolean);
    var shown = 0;
    all("[data-faq-item]", r).forEach(function (item) {
      var ok = terms.every(function (t) { return haystack(item).indexOf(t) > -1; });
      item.hidden = !ok;
      if (ok) shown++;
    });
    all("[data-faq-theme]", r).forEach(function (s) { s.hidden = !one("[data-faq-item]:not([hidden])", s); });
    var d = r.dataset;
    text(one("[data-faq-status]", r), !terms.length ? "" : shown === 0 ? d.tNone : shown === 1 ? d.tOne : (d.tMany || "").replace("{n}", shown));
    var empty = one("[data-faq-empty]", r);
    if (empty) empty.hidden = !(terms.length && shown === 0);
  }

  // ── Mémoire des avis donnés (dans ce navigateur seulement, jamais envoyée) ─────────────
  function storeKey(r) { return "faq:" + (r.getAttribute("data-faq-store") || ""); }
  function readVotes(r) {
    try { var v = JSON.parse(w.localStorage.getItem(storeKey(r)) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function remember(r, id) {
    try {
      var list = readVotes(r);
      if (list.indexOf(id) < 0) list.push(id);
      w.localStorage.setItem(storeKey(r), JSON.stringify(list.slice(-600)));
    } catch (e) { /* stockage refusé : l'avis est compté quand même */ }
  }
  function thanks(r, box) {
    var form = one("[data-faq-vote]", box);
    if (form) form.hidden = true;
    var q = one(".faq-vote-q", box);
    if (q) q.hidden = true;
    text(one("[data-faq-thanks]", box), r.dataset.tThanks);
  }
  function markVoted(r) {
    var list = readVotes(r);
    if (!list.length) return;
    all("[data-faq-vote-box]", r).forEach(function (box) { if (list.indexOf(box.getAttribute("data-faq-id")) > -1) thanks(r, box); });
  }

  // ── Envois sans recharger la page ──────────────────────────────────────────────────
  function busy(form, on) {
    form.setAttribute("aria-busy", on ? "true" : "false");
    all("button", form).forEach(function (b) { b.disabled = on; });
  }
  function send(form, extra) {
    var data = new FormData(form);
    if (extra) data.set(extra[0], extra[1]);
    return w.fetch(form.action, { method: "POST", body: data, headers: { accept: "application/json" }, credentials: "omit" }).then(function (res) {
      return res.json().then(function (j) { return { status: res.status, json: j }; }, function () { return { status: res.status, json: null }; });
    });
  }
  function vote(r, form, button) {
    var box = form.closest("[data-faq-vote-box]");
    if (!box) return;
    var notice = one("[data-faq-thanks]", box);
    busy(form, true);
    send(form, ["v", button.value]).then(function (o) {
      busy(form, false);
      if (o.status >= 200 && o.status < 300) {
        remember(r, box.getAttribute("data-faq-id"));
        thanks(r, box);
        var n = o.json && Number(o.json.y);
        if (n >= 3) text(one("[data-faq-count]", box), (r.dataset.tHelpMany || "").replace("{n}", n));
      } else text(notice, o.status === 429 ? r.dataset.tBusy : r.dataset.tError);
    }, function () { busy(form, false); text(notice, r.dataset.tError); });
  }
  function ask(r, form) {
    var out = one("[data-faq-ask-result]", form);
    var d = r.dataset;
    busy(form, true);
    send(form).then(function (o) {
      busy(form, false);
      if (o.status >= 200 && o.status < 300) { form.reset(); text(out, d.tAsked); }
      else text(out, o.status === 429 ? d.tAskLimit : o.status === 400 ? d.tAskInvalid : o.status === 503 ? d.tAskFull : d.tError);
    }, function () { busy(form, false); text(out, d.tError); });
  }

  // ── Une question ouverte par son lien (#q-…) ───────────────────────────────────────
  function openHash() {
    var h = w.location.hash;
    if (h.length < 4) return;
    var el = null;
    try { el = D.getElementById(decodeURIComponent(h.slice(1))); } catch (e) { return; }
    if (!el || !el.matches || !el.matches("[data-faq-item]")) return;
    var r = rootOf(el);
    if (el.hidden && r) { var input = one("[data-faq-q]", r); if (input) { input.value = ""; filter(r); } }
    el.open = true;
    if (el.scrollIntoView) el.scrollIntoView({ block: "start" });
  }

  // ── Écouteurs posés une seule fois sur la page (ils servent toutes les FAQ, même après un changement de page sans rechargement) ──
  D.addEventListener("input", function (e) {
    var t = e.target;
    if (t && t.matches && t.matches("[data-faq-q]")) { var r = rootOf(t); if (r) filter(r); }
  });
  D.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var toggle = t.closest("[data-faq-all]");
    if (toggle) {
      var open = toggle.getAttribute("data-faq-all") === "open";
      all("[data-faq-item]:not([hidden])", rootOf(toggle)).forEach(function (d) { d.open = open; });
      return;
    }
    var link = t.closest("[data-faq-link]");
    if (link) {
      var item = link.closest("[data-faq-item]");
      var note = item && one("[data-faq-copied]", item);
      if (w.navigator && w.navigator.clipboard && w.navigator.clipboard.writeText) {
        w.navigator.clipboard.writeText(link.href).then(function () {
          var r = rootOf(link);
          text(note, r && r.dataset.tCopied);
          w.setTimeout(function () { text(note, ""); }, 2500);
        }, function () { /* copie refusée : le lien reste ouvert dans la barre d'adresse */ });
      }
      return;
    }
    var pre = t.closest("[data-faq-prefill]");
    if (pre) {
      var root = rootOf(pre);
      var input = root && one("[data-faq-q]", root);
      var area = root && one("[data-faq-ask] textarea", root);
      if (input && area && input.value && !area.value) area.value = input.value.slice(0, 300);
    }
  });
  D.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || !form.matches || !w.fetch || !w.FormData) return;
    var r = rootOf(form);
    if (!r) return;
    if (form.matches("[data-faq-vote]")) {
      var button = e.submitter;
      if (!button || !button.name) return;
      e.preventDefault();
      vote(r, form, button);
    } else if (form.matches("[data-faq-ask]")) {
      e.preventDefault();
      ask(r, form);
    }
  }, true);
  w.addEventListener("hashchange", openHash);

  // ── Mise en route : à l'arrivée sur la page, y compris par un lien interne du site (la page arrive sans rechargement) ──
  function boot() {
    var fresh = all("[data-faq]:not([data-faq-on])");
    if (!fresh.length) return;
    fresh.forEach(function (r) { r.setAttribute("data-faq-on", ""); markVoted(r); });
    openHash();
  }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", boot); else boot();
  if (w.MutationObserver) {
    var waiting = false;
    new w.MutationObserver(function () {
      if (waiting) return;
      waiting = true;
      (w.requestAnimationFrame || w.setTimeout)(function () { waiting = false; boot(); });
    }).observe(D.documentElement, { childList: true, subtree: true });
  }
}

export const CLIENT_JS = `(${faqClient.toString()})(${fold.toString()});\n`;
